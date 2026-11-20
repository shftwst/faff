import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

function fixture(t, { level = "L4", admitted = [], outcomes = {}, baseline } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-run-reconcile-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, ".faff", "runs", "run-1");
  const facts = join(runDir, "summary-facts.json");
  const write = (rel, object) => {
    const target = join(runDir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(object));
  };
  write("run-ledger.json", { level, owner: { started_at: "2026-11-18T12:00:00Z" }, admitted, outcomes });
  write("summary-facts.json", { format: 2, tracker: {} });
  if (baseline !== undefined) write("sibling-baseline.json", baseline);
  const args = ["run", "reconcile", "--run-dir", runDir, "--level", level, "--facts", facts, "--root", root, "--json"];
  return { root, runDir, write, args, run: (env) => runCli(args, { cwd: root, env }) };
}

function result(r, code) {
  assert.equal(r.code, code, r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

test("run reconcile reads the right PR head, excludes a later-admitted sibling and emits only the gate result", (t) => {
  const f = fixture(t, { level: "L3", admitted: ["EX-1", "EX-2"], outcomes: { "EX-1": "shipped" },
    baseline: [{ issue: "EX-2", start_state_terminal: false }, { issue: "EX-3", start_state_terminal: false }] });
  f.write("EX-1/merge-record.json", { pr: 9, head_sha: "recorded-head" });
  f.write("summary-facts.json", { format: 2, tracker: { sibling_end_states: {
    "EX-2": { end_state_terminal: true }, "EX-3": { end_state_terminal: true }, "EX-999": { end_state_terminal: true },
  } } });
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const ghLog = join(f.root, "gh.log");
  writeFileSync(join(bin, "gh"), [
    "#!/bin/sh",
    'printf "%s|%s\n" "$PWD" "$*" > "$FAFF_TEST_GH_LOG"',
    'printf \'%s\n\' \'{"number":9,"state":"MERGED","headRefOid":"recorded-head","mergeCommit":{"oid":"different-squash"}}\'',
  ].join("\n"), { mode: 0o755 });
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, FAFF_TEST_GH_LOG: ghLog };
  const r = runCli(f.args, { env });
  const checked = result(r, 1);
  const former = result(runCli(["reconcile", "--run-dir", f.runDir, "--level", "L3", "--json"], {
    input: JSON.stringify({
      shipped: [{ issue: "EX-1", recorded: { head_sha: "recorded-head" }, observed: { pr_merged: true, merged_head_sha: "recorded-head" } }],
      siblings: [{ issue: "EX-3", start_state_terminal: false, end_state_terminal: true, admitted: false }],
      sibling_baseline: { captured: true, entry_count: 2 },
    }),
  }), 1);
  assert.deepEqual(checked, { ...former, warnings: [] });
  assert.equal(checked.divergences[0].issue, "EX-3");
  assert.equal(r.stdout.includes("recorded-head"), false);
  assert.equal(readFileSync(ghLog, "utf8"), f.root + "|pr view 9 --json number,state,headRefOid\n");
});

test("run reconcile will not attest unknown, malformed or duplicate sibling observations", (t) => {
  const f = fixture(t, { baseline: [{ issue: "EX-1", start_state_terminal: false }] });
  let checked = result(f.run(), 1);
  assert.equal(checked.disposition, "needs-human");
  assert.deepEqual(checked.divergences.map((d) => d.class), ["sibling-check-unproven"]);
  assert.match(checked.warnings.join("\n"), /EX-1/);

  f.write("summary-facts.json", { format: 2, tracker: { sibling_end_states: { "EX-1": { end_state_terminal: false } } } });
  assert.equal(result(f.run(), 0).disposition, "pass");
  f.write("sibling-baseline.json", [
    { issue: "EX-1", start_state_terminal: false },
    { issue: "EX-1", start_state_terminal: true },
  ]);
  checked = result(f.run(), 1);
  assert.deepEqual(checked.divergences.map((d) => d.class), ["sibling-check-unproven"]);
  assert.match(checked.warnings.join("\n"), /baseline/i);
});

test("run reconcile distinguishes a genuinely empty baseline from missing evidence", (t) => {
  const f = fixture(t);
  const checked = result(f.run(), 1);
  assert.equal(checked.disposition, "needs-human");
  assert.equal(checked.divergences[0].class, "sibling-check-unproven");
  f.write("sibling-baseline.json", []);
  assert.equal(result(f.run(), 0).disposition, "pass");
  const wrongLevel = f.args.map((v) => v === "L4" ? "L3" : v);
  const mismatch = runCli(wrongLevel);
  assert.equal(mismatch.code, 2);
  assert.match(mismatch.stderr, /level.*contradicts/);
});

test("run reconcile uses the actual delivering issue IDs, including a failed supersession read", (t) => {
  const f = fixture(t, { admitted: ["EX-1"], outcomes: { "EX-1": "superseded" }, baseline: [] });
  f.write("EX-1/supersession.json", { issue: "EX-1", superseded_by: ["EX-2", "EX-3"] });
  f.write("summary-facts.json", { format: 2, tracker: { superseded_delivered: { "EX-1": true },
    supersession_ticket_states: { "EX-2": true, "EX-4": true } } });
  const checked = result(f.run(), 1);
  assert.deepEqual(checked.divergences.map((d) => d.class), ["superseded-unproven"]);
  f.write("summary-facts.json", { format: 2, tracker: { supersession_ticket_states: { "EX-2": true, "EX-3": true } } });
  assert.equal(result(f.run(), 0).disposition, "pass");
});

test("run reconcile proves git-only landing by local base ancestry", (t) => {
  const f = fixture(t, { admitted: ["EX-1"], outcomes: { "EX-1": "shipped" }, baseline: [] });
  const git = (...args) => execFileSync("git", ["-C", f.root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit",
    "--no-gpg-sign", "--allow-empty", "-qm", "initial");
  f.write("EX-1/merge-record.json", { pr: 0, head_sha: git("rev-parse", "HEAD") });
  assert.equal(result(f.run(), 0).disposition, "pass");
  f.write("EX-1/merge-record.json", { pr: 0, head_sha: "1".repeat(40) });
  const checked = result(f.run(), 1);
  assert.deepEqual(checked.divergences.map((d) => d.class), ["claimed-shipped-unmerged"]);
});

test("run reconcile cannot reuse one PR as proof for two shipped issues", (t) => {
  const f = fixture(t, { admitted: ["EX-1", "EX-2"], outcomes: { "EX-1": "shipped", "EX-2": "shipped" }, baseline: [] });
  f.write("EX-1/merge-record.json", { pr: 9, head_sha: "recorded-head" });
  f.write("EX-2/merge-record.json", { pr: 9, head_sha: "recorded-head" });
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  const ghLog = join(f.root, "gh.log");
  writeFileSync(join(bin, "gh"), [
    "#!/bin/sh",
    'printf "%s\n" "$*" >> "$FAFF_TEST_GH_LOG"',
    'printf \'%s\n\' \'{"number":9,"state":"MERGED","headRefOid":"recorded-head"}\'',
  ].join("\n"), { mode: 0o755 });
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, FAFF_TEST_GH_LOG: ghLog };
  const checked = result(f.run(env), 1);
  assert.deepEqual(checked.divergences.map((d) => [d.issue, d.class]), [
    ["EX-1", "claimed-shipped-unmerged"], ["EX-2", "claimed-shipped-unmerged"],
  ]);
  assert.match(checked.warnings.join("\n"), /PR #9.*multiple/i);
  assert.throws(() => readFileSync(ghLog), { code: "ENOENT" }, "ambiguous evidence does not trigger a forge read");
});

test("run reconcile fails closed on wrong PR observations and wrong issue records", (t) => {
  const f = fixture(t, { admitted: ["EX-1", "EX-2"], outcomes: { "EX-1": "shipped", "EX-2": "shipped" }, baseline: [] });
  f.write("EX-1/merge-record.json", { pr: 9, head_sha: "recorded-head" });
  f.write("EX-2/merge-record.json", { issue: "EX-3", pr: 10, head_sha: "recorded-head" });
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), '#!/bin/sh\nprintf \'%s\n\' \'{"number":10,"state":"MERGED","headRefOid":"recorded-head"}\'\n', { mode: 0o755 });
  const checked = result(f.run({ ...process.env, PATH: bin + ":" + process.env.PATH }), 1);
  assert.deepEqual(checked.divergences.map((d) => [d.issue, d.class]), [
    ["EX-1", "claimed-shipped-unmerged"], ["EX-2", "claimed-shipped-unmerged"],
  ]);
  assert.match(checked.warnings.join("\n"), /EX-1 PR #9/);
});

test("run reconcile rejects malformed facts and unsupported flags without a result", (t) => {
  const f = fixture(t, { baseline: [] });
  f.write("summary-facts.json", { format: 1, tracker: {} });
  const missing = f.run();
  assert.equal(missing.code, 2);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /format.*not 2/);
  const duplicate = runCli([...f.args, "--root", f.root]);
  assert.equal(duplicate.code, 2);
  assert.equal(duplicate.stdout, "");
  assert.match(duplicate.stderr, /more than once/);
});

test("normal reporting facts preserve the gate's missing sibling divergence in the summary", (t) => {
  const f = fixture(t, { baseline: [{ issue: "EX-1", start_state_terminal: false }] });
  const facts = join(f.runDir, "summary-facts.json");
  f.write("summary-facts.json", { format: 2, tracker: { supersession_ticket_states: {} } });
  assert.equal(result(f.run(), 1).divergences[0].class, "sibling-check-unproven");
  const summary = runCli(["run", "summary", "--run-dir", f.runDir, "--root", f.root, "--facts", facts], { cwd: f.root });
  assert.equal(summary.code, 0, summary.stderr);
  assert.match(summary.stdout, /\[sibling-check-unproven\] run:/);
  assert.match(summary.stdout, /could not read tracker observations for sibling\(s\): EX-1/);
});
