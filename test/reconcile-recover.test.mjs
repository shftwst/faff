// FAFF-797 — `faff reconcile-recover`: the auto-close half of the FAFF-782
// merged-but-unclosed seam. A thin composition over shipped primitives — no new
// detection/liveness/gate logic — that closes a verifiably-merged, verifiably-stale,
// unclosed run to `shipped`, gated on a fresh `post-merge-check` returning
// `verified-ok`. Drives the real entrypoint end-to-end over filesystem fixtures
// (mirrors disposition.test.mjs); the pure `admitRecovery` admission core is
// additionally covered by `faff reconcile-recover --selftest`. This file adds the
// INTEGRATION half the spec calls for: a real git repo + a real merge, exercised
// through the full gate+write pipeline (parity with post-merge.js's own selftest,
// which builds real git repos the same way).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const STALE_ISO = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago > 900s default
const FRESH_ISO = new Date().toISOString();

function fixture({ ledger } = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-recover-"));
  const runDir = join(root, ".faff", "runs", "run-t");
  mkdirSync(runDir, { recursive: true });
  if (ledger !== undefined) writeFileSync(join(runDir, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
  return { root, runDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeMergeRecord(runDir, issue, body) {
  mkdirSync(join(runDir, issue), { recursive: true });
  writeFileSync(join(runDir, issue, "merge-record.json"), typeof body === "string" ? body : JSON.stringify(body));
}

function readLedger(runDir) {
  return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8"));
}

// ---------------------------------------------------------------------------
// Admission branches, driven through the real CLI (mirrors disposition.test.mjs).
// ---------------------------------------------------------------------------

test("not-merged: no merge-record at all → exit 3 no-op, nothing written", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: {}, owner: { status: "running", last_heartbeat: STALE_ISO } } });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-1", "--level", "L3", "--json"]);
    assert.equal(code, 3);
    const rep = JSON.parse(out);
    assert.equal(rep.admission, "not-merged");
    assert.equal(rep.recovered, false);
    assert.equal(readLedger(f.runDir).outcomes["FAFF-1"], undefined);
  } finally { f.cleanup(); }
});

// NB: the "not-unclosed via never-admitted" branch of admitRecovery (issue not in
// ledger.admitted, with merged:true) is unreachable through the real CLI shell —
// readMergedMap(runDir, admitted) only ever checks merge-record.json for issues already
// IN `admitted`, so a non-admitted issue always reads merged:false (→ "not-merged") before
// admitRecovery's admitted-membership check is ever reached. It stays a defensive branch of
// the pure core, exercised directly by `--selftest`'s "not-unclosed: issue never admitted"
// fixture (which drives admitRecovery with a crafted merged:true input) — not duplicated here.

test("not-unclosed (already closed) → exit 0 idempotent clean, recovered:false", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { status: "done", last_heartbeat: STALE_ISO } } });
  writeMergeRecord(f.runDir, "FAFF-1", { pr: 1, head_sha: "abc123", merged: true });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-1", "--level", "L3", "--json"]);
    assert.equal(code, 0);
    const rep = JSON.parse(out);
    assert.equal(rep.admission, "not-unclosed");
    assert.equal(rep.recovered, false);
  } finally { f.cleanup(); }
});

test("live: merged + unclosed but a FRESH heartbeat → exit 3 no-op, never races a live run", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: {}, owner: { status: "running", last_heartbeat: FRESH_ISO } } });
  writeMergeRecord(f.runDir, "FAFF-1", { pr: 1, head_sha: "abc123", merged: true });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-1", "--level", "L3", "--json"]);
    assert.equal(code, 3);
    const rep = JSON.parse(out);
    assert.equal(rep.admission, "live");
    assert.equal(readLedger(f.runDir).outcomes["FAFF-1"], undefined);
  } finally { f.cleanup(); }
});

test("usage: missing --run-dir/--issue/--level → exit 2", () => {
  const { code, err } = run(["reconcile-recover", "--issue", "FAFF-1"]);
  assert.equal(code, 2);
  assert.match(err, /required/);
});

test("usage: invalid --issue → exit 2", () => {
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-1"], outcomes: {} } });
  try {
    const { code, err } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "not an id", "--level", "L3"]);
    assert.equal(code, 2);
    assert.match(err, /not a valid issue id/);
  } finally { f.cleanup(); }
});

test("no run-ledger.json under --run-dir → exit 2 (never a verdict about another run)", () => {
  const f = fixture({});
  try {
    const { code, err } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-1", "--level", "L3"]);
    assert.equal(code, 2);
    assert.match(err, /no run-ledger\.json/);
  } finally { f.cleanup(); }
});

test("malformed run-ledger.json → exit 2 naming the file", () => {
  const f = fixture({ ledger: "{ not json" });
  try {
    const { code, err } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-1", "--level", "L3"]);
    assert.equal(code, 2);
    assert.match(err, /malformed ledger/);
  } finally { f.cleanup(); }
});

// ---------------------------------------------------------------------------
// INTEGRATION — a real git repo + a real merge, exercised through the full
// gate+write pipeline (parity with post-merge.js's own --selftest git-repo build).
// ---------------------------------------------------------------------------

function git(cwd, ...args) {
  return spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function buildRepo() {
  const tmpRoot = mkdtempSync(join(tmpdir(), "faff-recover-repo-"));
  const repo = join(tmpRoot, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "true" } }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "green");
  const greenSha = git(repo, "rev-parse", "HEAD").stdout.trim();

  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { test: "false" } }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "red");
  const redSha = git(repo, "rev-parse", "HEAD").stdout.trim();

  return { tmpRoot, repo, greenSha, redSha, cleanup: () => rmSync(tmpRoot, { recursive: true, force: true }) };
}

test("INTEGRATION: recoverable + verified-ok → closes to shipped, idempotent re-run, disposition goes clean", () => {
  const repoFx = buildRepo();
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-417"], outcomes: {}, owner: { status: "running", last_heartbeat: STALE_ISO } } });
  writeMergeRecord(f.runDir, "FAFF-417", { pr: 641, head_sha: repoFx.greenSha, merged: true });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-417", "--level", "L3", "--root", repoFx.repo, "--json"]);
    assert.equal(code, 0);
    const rep = JSON.parse(out);
    assert.equal(rep.admission, "recoverable");
    assert.equal(rep.recovered, true);
    assert.equal(rep.post_merge_check, "verified-ok");
    assert.deepEqual(rep.wrote, { outcome: "shipped", owner_status: "done" });

    const ledgerAfter = readLedger(f.runDir);
    assert.equal(ledgerAfter.outcomes["FAFF-417"], "shipped");
    assert.equal(ledgerAfter.owner.status, "done");

    // an issue-outcome close event was appended (record-outcome's shipped-path behaviour)
    const events = readFileSync(join(f.runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(events.some((e) => e.type === "issue-outcome" && e.issue === "FAFF-417" && e.data && e.data.outcome === "shipped"));

    // idempotent re-run: already closed → exit 0, recovered:false, no double-write
    const second = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-417", "--level", "L3", "--root", repoFx.repo, "--json"]);
    assert.equal(second.code, 0);
    const secondRep = JSON.parse(second.out);
    assert.equal(secondRep.admission, "not-unclosed");
    assert.equal(secondRep.recovered, false);

    // a re-run faff disposition on the run is clean
    const disp = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(disp.code, 0);
    assert.equal(JSON.parse(disp.out).disposition, "clean");
  } finally { f.cleanup(); repoFx.cleanup(); }
});

test("INTEGRATION: recoverable + verified-fail (post-merge regression) → BLOCKED, nothing written, still merged-unclosed", () => {
  const repoFx = buildRepo();
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-418"], outcomes: {}, owner: { status: "running", last_heartbeat: STALE_ISO } } });
  writeMergeRecord(f.runDir, "FAFF-418", { pr: 642, head_sha: repoFx.redSha, merged: true });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-418", "--level", "L3", "--root", repoFx.repo, "--json"]);
    assert.equal(code, 1);
    const rep = JSON.parse(out);
    assert.equal(rep.admission, "recoverable");
    assert.equal(rep.recovered, false);
    assert.equal(rep.post_merge_check, "verified-fail");
    assert.equal(rep.wrote, null);

    const ledgerAfter = readLedger(f.runDir);
    assert.equal(ledgerAfter.outcomes["FAFF-418"], undefined);
    assert.equal(ledgerAfter.owner.status, "running");

    // faff disposition still reports the merged-unclosed attention item for a human
    const disp = run(["disposition", "--run-dir", f.runDir, "--json"]);
    assert.equal(disp.code, 1);
    assert.ok(JSON.parse(disp.out).attention.some((i) => i.kind === "merged-unclosed" && i.issue === "FAFF-418"));
  } finally { f.cleanup(); repoFx.cleanup(); }
});

test("INTEGRATION: --dry-run reports the would-be recovery without writing", () => {
  const repoFx = buildRepo();
  const f = fixture({ ledger: { run_id: "run-t", admitted: ["FAFF-419"], outcomes: {}, owner: { status: "running", last_heartbeat: STALE_ISO } } });
  writeMergeRecord(f.runDir, "FAFF-419", { pr: 643, head_sha: repoFx.greenSha, merged: true });
  try {
    const { code, out } = run(["reconcile-recover", "--run-dir", f.runDir, "--issue", "FAFF-419", "--level", "L3", "--root", repoFx.repo, "--dry-run", "--json"]);
    assert.equal(code, 0);
    const rep = JSON.parse(out);
    assert.equal(rep.dry_run, true);
    assert.equal(rep.recovered, false);
    assert.equal(rep.post_merge_check, "verified-ok");
    assert.equal(readLedger(f.runDir).outcomes["FAFF-419"], undefined);
  } finally { f.cleanup(); repoFx.cleanup(); }
});

test("--selftest runs the pure admitRecovery fixture table and passes", () => {
  const { code, out } = run(["reconcile-recover", "--selftest"]);
  assert.equal(code, 0);
  assert.match(out, /RESULT: PASS/);
});
