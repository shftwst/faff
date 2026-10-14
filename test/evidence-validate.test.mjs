// FAFF-1256: `faff evidence validate <anchor-dir>` against the bundled v0.3 schemas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(REPO, "verification", "evidence", "v0.3", "schema", "examples");
const { validateAnchorDir, exitCodeFor } = require("../plugin/skills/faff/bin/lib/evidence.js");
const REAL_ANCHOR = join(REPO, ".faff", "anchors", "run-20261010-213749-graft-FAFF-1213", "FAFF-1213");
const SENTINEL = "S3CR3T-SENTINEL";

const example = (name) => readFileSync(join(EXAMPLES, `${name}.example.json`), "utf8");
const scratch = () => mkdtempSync(join(tmpdir(), "faff-evidence-validate-"));

function copyAnchor() {
  const dir = scratch();
  cpSync(REAL_ANCHOR, dir, { recursive: true });
  return dir;
}

// The real anchor with schema_version stamped into the ledger and the two review files
// replaced by the v0.3 valid examples (scenario 1).
function stampedCopy() {
  const dir = copyAnchor();
  const ledger = JSON.parse(readFileSync(join(dir, "run-ledger.json"), "utf8"));
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ schema_version: 1, ...ledger }, null, 2));
  writeFileSync(join(dir, "ac-checklist.json"), example("ac-checklist"));
  writeFileSync(join(dir, "review-verdict.json"), example("review-verdict-anchored"));
  return dir;
}

const validate = (dir, ...extra) => runCli(["evidence", "validate", dir, "--json", ...extra]);

test("evidence validate: every git-tracked anchor directory is legacy (exit 0, exit 1 under --require-evidence-schema)", () => {
  const tracked = execFileSync("git", ["ls-files", ".faff/anchors"], { cwd: REPO, encoding: "utf8" })
    .split("\n").filter(Boolean)
    .map((f) => f.split("/").slice(0, 4).join("/"));
  const dirs = [...new Set(tracked)].sort();
  assert.ok(dirs.length > 100, `expected the committed anchors, found ${dirs.length}`);
  for (const rel of dirs) {
    const report = validateAnchorDir(join(REPO, rel));
    assert.equal(report.status, "legacy", rel);
    assert.equal(exitCodeFor(report, false), 0, rel);
    assert.equal(exitCodeFor(report, true), 1, rel);
  }
  const sample = join(REPO, dirs[0]);
  assert.equal(validate(sample).code, 0);
  assert.equal(validate(sample, "--require-evidence-schema").code, 1);
});

test("evidence validate: scenario 1, a stamped copy of a real anchor passes with every file ok", () => {
  const dir = stampedCopy();
  const { stdout, code } = validate(dir);
  assert.equal(code, 0, stdout);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "pass");
  assert.equal(report.spec_version, "v0.3");
  assert.equal(report.files.length, 7);
  assert.ok(report.files.every((f) => f.status === "ok"), JSON.stringify(report.files));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: scenario 2, an extra property and a torn tail", () => {
  const dir = stampedCopy();
  const file = join(dir, "events.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const edited = JSON.parse(lines[1]);
  edited.extra = 1;
  lines[1] = JSON.stringify(edited);
  writeFileSync(file, lines.join("\n") + '\n{"sch');
  const { stdout, code } = validate(dir);
  assert.equal(code, 1, stdout);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "fail");
  const events = report.files.find((f) => f.path === "events.jsonl");
  assert.equal(events.status, "fail");
  assert.equal(events.torn_tail, true);
  assert.deepEqual(events.violations, ['line 2: additional property "extra" not allowed']);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a mixed anchor fails on the unstamped evidence document", () => {
  const dir = stampedCopy();
  const ac = JSON.parse(example("ac-checklist"));
  delete ac.schema_version;
  writeFileSync(join(dir, "ac-checklist.json"), JSON.stringify(ac));
  const { stdout, code } = validate(dir);
  assert.equal(code, 1);
  const report = JSON.parse(stdout);
  assert.equal(report.status, "fail");
  assert.ok(report.files.find((f) => f.path === "ac-checklist.json").violations.includes('missing required property "schema_version"'));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a file with no manifest entry is unschemaed", () => {
  const dir = stampedCopy();
  writeFileSync(join(dir, "notes.txt"), "stray");
  const report = JSON.parse(validate(dir).stdout);
  assert.equal(report.status, "fail");
  assert.equal(report.files.find((f) => f.path === "notes.txt").status, "unschemaed");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a mid-file non-JSON line fails", () => {
  const dir = stampedCopy();
  const file = join(dir, "events.jsonl");
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  lines.splice(1, 0, "not json");
  writeFileSync(file, lines.join("\n") + "\n");
  const { stdout, code } = validate(dir);
  assert.equal(code, 1);
  assert.ok(JSON.parse(stdout).files.find((f) => f.path === "events.jsonl").violations.includes("line 2: not valid JSON"));
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a legacy anchor holding an unmanifested file is legacy, not fail", () => {
  const dir = copyAnchor();
  writeFileSync(join(dir, "summary.md"), "stray");
  const { stdout, code } = validate(dir);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).status, "legacy");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: a pk.json-only anchor is legacy", () => {
  const dir = scratch();
  mkdirSync(join(dir, "commissaire", "producer"), { recursive: true });
  writeFileSync(join(dir, "commissaire", "producer", "pk.json"), example("producer-pk"));
  assert.equal(JSON.parse(validate(dir).stdout).status, "legacy");
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: human output prints at most five violations per file", () => {
  const dir = stampedCopy();
  const bad = JSON.parse(example("review-verdict-anchored"));
  for (let i = 0; i < 8; i++) bad[`extra${i}`] = i;
  writeFileSync(join(dir, "review-verdict.json"), JSON.stringify(bad));
  const { stdout, code } = runCli(["evidence", "validate", dir]);
  assert.equal(code, 1);
  assert.match(stdout, /^evidence validate .*: fail$/m);
  assert.equal((stdout.match(/^ {4}- /gm) || []).length, 5);
  assert.match(stdout, /\(\+3 more\)/);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: usage errors and a missing directory exit 2", () => {
  assert.equal(runCli(["evidence"]).code, 2);
  assert.equal(runCli(["evidence", "validate"]).code, 2);
  assert.equal(runCli(["evidence", "validate", join(tmpdir(), "faff-evidence-does-not-exist")]).code, 2);
  assert.equal(runCli(["evidence", "validate", REAL_ANCHOR, "--bogus"]).code, 2);
});

test("evidence validate: an unreadable bundled manifest exits 2 with schema-unavailable", () => {
  const tree = scratch();
  cpSync(join(REPO, "plugin", "skills", "faff"), join(tree, "faff"), { recursive: true, filter: (src) => !src.includes("node_modules") });
  rmSync(join(tree, "faff", "contracts", "evidence-v0.3", "anchor-manifest.json"));
  const r = spawnSync(process.execPath, [join(tree, "faff", "bin", "faff"), "evidence", "validate", REAL_ANCHOR], { encoding: "utf8" });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /schema-unavailable/);
  rmSync(tree, { recursive: true, force: true });
});

test("evidence validate: violation messages never print a data value", () => {
  const dir = stampedCopy();
  const bad = JSON.parse(example("review-verdict-anchored"));
  bad.signal = SENTINEL;
  bad.rounds_total = SENTINEL;
  bad.round_history = SENTINEL;
  writeFileSync(join(dir, "review-verdict.json"), JSON.stringify(bad));
  const { stdout } = validate(dir);
  assert.ok(!stdout.includes(SENTINEL));
  assert.match(stdout, /value not in enum \[pass, fail, needs-human\]/);
  rmSync(dir, { recursive: true, force: true });
});

test("evidence validate: faff evidence --selftest exits 0", () => {
  const { code, stdout } = runCli(["evidence", "--selftest"]);
  assert.equal(code, 0, stdout);
});

test("evidence validate: integration smoke", () => {
  const dir = copyAnchor();
  assert.equal(validate(dir).code, 0);
  assert.equal(JSON.parse(validate(dir).stdout).status, "legacy");
  const ledger = JSON.parse(readFileSync(join(dir, "run-ledger.json"), "utf8"));
  writeFileSync(join(dir, "run-ledger.json"), JSON.stringify({ schema_version: 1, ...ledger }));
  writeFileSync(join(dir, "ac-checklist.json"), example("ac-checklist"));
  writeFileSync(join(dir, "review-verdict.json"), example("review-verdict-anchored"));
  assert.equal(JSON.parse(validate(dir).stdout).status, "pass");
  const ac = JSON.parse(example("ac-checklist"));
  delete ac.schema_version;
  writeFileSync(join(dir, "ac-checklist.json"), JSON.stringify(ac));
  const r = validate(dir);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.stdout).files.find((f) => f.status === "fail").path, "ac-checklist.json");
  assert.ok(existsSync(dir) && readdirSync(dir).length > 0);
  rmSync(dir, { recursive: true, force: true });
});
