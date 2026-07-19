// FAFF-557 — `faff prd-checklist <path>`: parse a checklist-style PRD's GFM task-list
// stop-conditions and emit the EXISTING `prd-coverage` contract shape (no new schema).
// Pure CLI: filesystem read of <path> only, no tracker/network/writes. Checkbox state maps
// onto the COMPLETION face (covered is always true for a parsed goal; unchecked -> unmet_or_
// unverified), never the coverage face — see the spec's "two-face mapping" design decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const BIN = join(REPO, "plugin", "skills", "faff", "bin", "faff");

const run = (args, cwd = REPO) => spawnSync(process.execPath, [BIN, "prd-checklist", ...args], { cwd, encoding: "utf8" });

function tmpPrd(body) {
  const root = mkdtempSync(join(tmpdir(), "faff-prd-checklist-it-"));
  const p = join(root, "PRD.md");
  writeFileSync(p, body);
  return { root, p };
}

test("--selftest passes", () => {
  const r = run(["--selftest"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prd-checklist --selftest: ok/);
});

test("usage: missing path -> exit 2, usage diagnostic, no stdout block", () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: faff prd-checklist <path>/);
  assert.equal(r.stdout, "");
});

test("missing / unreadable path -> exit 2, no stdout block", () => {
  const { root } = tmpPrd("- [x] a\n");
  const r = run([join(root, "nope.md")]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cannot read/);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("directory path -> exit 2, no stdout block", () => {
  const { root } = tmpPrd("- [x] a\n");
  const r = run([root]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("all checked -> satisfied:true, covered:true, all_met:true, empty reason, exit 0", () => {
  const { root, p } = tmpPrd("# PRD\n\n- [x] one\n- [X] two\n* [x] three\n");
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v, {
    covered: true,
    uncovered_goals: [],
    satisfied: true,
    reason: "",
    completion: { all_met: true, unmet_or_unverified: [] },
    measure: { total_goals: 3, covered_goals: 3 },
    conformant: true,
    violations: [],
  });
  rmSync(root, { recursive: true, force: true });
});

test("mixed checked/unchecked -> satisfied:false, all_met:false, unmet_or_unverified lists unchecked, non-empty reason", () => {
  const { root, p } = tmpPrd([
    "# Stop conditions",
    "",
    "- [x] alpha done",
    "- [ ] beta pending",
    "- [ ] gamma pending",
    "",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.covered, true);
  assert.deepEqual(v.uncovered_goals, []);
  assert.equal(v.satisfied, false);
  assert.equal(v.completion.all_met, false);
  assert.deepEqual(v.completion.unmet_or_unverified, ["beta pending", "gamma pending"]);
  assert.ok(v.reason.length > 0);
  assert.match(v.reason, /beta pending/);
  assert.match(v.reason, /gamma pending/);
  assert.deepEqual(v.measure, { total_goals: 3, covered_goals: 3 });
  rmSync(root, { recursive: true, force: true });
});

test("nested task-list items are goals too (flattened, fail-safe against a dropped unchecked box)", () => {
  const { root, p } = tmpPrd([
    "- [x] top level done",
    "  - [ ] nested pending",
    "- [x] another top",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.satisfied, false);
  assert.deepEqual(v.completion.unmet_or_unverified, ["nested pending"]);
  assert.equal(v.measure.total_goals, 3);
  rmSync(root, { recursive: true, force: true });
});

test("section headers and plain non-checkbox bullets are not goals", () => {
  const { root, p } = tmpPrd([
    "# Section header",
    "## Another header",
    "- a plain bullet, not a checkbox",
    "- [x] the only real goal",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.measure.total_goals, 1);
  assert.equal(v.satisfied, true);
  rmSync(root, { recursive: true, force: true });
});

test("task-list syntax inside a fenced code block is ignored", () => {
  const { root, p } = tmpPrd([
    "Example checklist syntax:",
    "",
    "```markdown",
    "- [ ] example one",
    "- [ ] example two",
    "```",
    "",
    "Real stop-conditions:",
    "",
    "- [ ] real one",
    "- [ ] real two",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.measure.total_goals, 2);
  assert.deepEqual(v.completion.unmet_or_unverified, ["real one", "real two"]);
  rmSync(root, { recursive: true, force: true });
});

test("tilde-fenced code block is also respected", () => {
  const { root, p } = tmpPrd([
    "~~~",
    "- [ ] example (ignored)",
    "~~~",
    "- [x] real",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.measure.total_goals, 1);
  assert.equal(v.satisfied, true);
  rmSync(root, { recursive: true, force: true });
});

test("malformed checkbox tokens are not counted as goals", () => {
  const { root, p } = tmpPrd([
    "- [y] not a valid checkbox",
    "- [] no space inside",
    "-[ ] no space after marker",
    "- [x] the one real goal",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.measure.total_goals, 1);
  assert.equal(v.satisfied, true);
  rmSync(root, { recursive: true, force: true });
});

test("duplicate labels are kept as distinct entries, never de-duplicated", () => {
  const { root, p } = tmpPrd([
    "- [ ] repeat me",
    "- [ ] repeat me",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v.completion.unmet_or_unverified, ["repeat me", "repeat me"]);
  assert.equal(v.measure.total_goals, 2);
  rmSync(root, { recursive: true, force: true });
});

test("empty file -> exit 2, no stdout block (never a vacuous satisfied:true)", () => {
  const { root, p } = tmpPrd("");
  const r = run([p]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /faff prd-checklist:/);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("whitespace-only file -> exit 2, no stdout block", () => {
  const { root, p } = tmpPrd("   \n\n\t\n");
  const r = run([p]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("prose/headers-only file with no task-list items -> exit 2, no stdout block", () => {
  const { root, p } = tmpPrd([
    "# My PRD",
    "",
    "This document describes the feature in prose.",
    "",
    "## Goals",
    "- a plain bullet",
    "- another plain bullet",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no GFM task-list stop-conditions/);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("checkbox with empty label -> exit 2, no stdout block", () => {
  const { root, p } = tmpPrd([
    "- [x] a real goal",
    "- [ ]",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /empty label/);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("checkbox with whitespace-only label -> exit 2, no stdout block", () => {
  const { root, p } = tmpPrd([
    "- [x] a real goal",
    "- [ ]   ",
  ].join("\n"));
  const r = run([p]);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, "");
  rmSync(root, { recursive: true, force: true });
});

test("output validates against faff contract prd-coverage (all-checked)", () => {
  const { root, p } = tmpPrd("- [x] a\n- [x] b\n");
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const c = spawnSync(process.execPath, [BIN, "contract", "prd-coverage"], { input: r.stdout, encoding: "utf8" });
  assert.equal(c.status, 0, c.stdout + c.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("output validates against faff contract prd-coverage (mixed)", () => {
  const { root, p } = tmpPrd("- [x] a\n- [ ] b\n");
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const c = spawnSync(process.execPath, [BIN, "contract", "prd-coverage"], { input: r.stdout, encoding: "utf8" });
  assert.equal(c.status, 0, c.stdout + c.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("integration smoke: all-checked output feeds `faff run-done --prd-coverage` unchanged -> prd_satisfied true", () => {
  const { root, p } = tmpPrd("- [x] a\n- [x] b\n- [x] c\n");
  const out = run([p]);
  assert.equal(out.status, 0, out.stderr);
  const rd = spawnSync(process.execPath, [BIN, "run-done", "--prd-coverage", out.stdout.trim(), "--queue-empty", "--ledger-clean"], { encoding: "utf8" });
  assert.equal(rd.status, 0, rd.stdout + rd.stderr);
  const verdict = JSON.parse(rd.stdout);
  assert.equal(verdict.signals.prd_satisfied, true);
  assert.equal(verdict.verdict, "run-complete");
  assert.equal(verdict.reason, "drained");
  rmSync(root, { recursive: true, force: true });
});

test("integration smoke: flipping one item to unchecked -> satisfied:false, non-empty reason", () => {
  const { root, p } = tmpPrd("- [x] a\n- [x] b\n- [x] c\n");
  writeFileSync(p, "- [x] a\n- [ ] b\n- [x] c\n");
  const r = run([p]);
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.satisfied, false);
  assert.ok(v.reason.length > 0);
  rmSync(root, { recursive: true, force: true });
});
