// FAFF-896 — `faff resumecheck`: the Stop-hook member that releases a dead headless-resume
// claim on the turn it dies. A headless `claude -p '… faff lights-out --resume …'` that
// claims the owner (owner.status:"running" + fresh last_heartbeat + a run-resume event)
// then ends its turn with NO work leaves a frozen-fresh claim the next --resume refuses for
// the whole staleness window. This hook — the OWNING session's own Stop hook — stamps
// owner.status running→aborted-resumable and appends a run-claim-abandoned audit event.
// Drives the REAL entrypoint against fixture run-dirs, so the end-to-end
// evidence→fence→stamp→append path is pinned, not only the in-memory decision table (that
// runs via `resumecheck --selftest` through the central regions runner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// spawnSync so we capture BOTH streams: the release WARNS via a non-blocking stderr line and
// (--json) prints the result on stdout. FAFF_RUN_DIR / FAFF_SESSION_ID default to "" so the
// test process's own env never leaks ownership; a case sets them.
function run(args, env) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, FAFF_RUN_DIR: "", FAFF_SESSION_ID: "", ...env },
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

const HEX64 = "a".repeat(64);

// Build a fixture run dir under <root>/.faff/runs/<id> with a run-ledger.json and an
// events.jsonl whose TAIL record is `tailType` (default "run-resume" — the no-work
// evidence). tailReadNextSeq reads the last parseable JSON line; the chain is not verified
// on the read path, so a plausible prev suffices for the fixture.
function mkRun(root, { id = "run-fixture", ownerStatus = "running", epoch = 1, sessionId = "S", tailType = "run-resume", tailTsSecsAgo = 5 } = {}) {
  const runDir = join(root, ".faff", "runs", id);
  mkdirSync(runDir, { recursive: true });
  const nowIso = new Date().toISOString();
  const ledger = {
    run_id: "R", level: "L4", admitted: [], outcomes: {},
    owner: { status: ownerStatus, epoch, session_id: sessionId, pid: 4242, started_at: nowIso, last_heartbeat: nowIso },
  };
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  const tailTs = new Date(Date.now() - tailTsSecsAgo * 1000).toISOString();
  const tail = { schema: 2, run_id: "R", seq: 1, ts: tailTs, prev: HEX64, phase: "run", type: tailType, epoch };
  writeFileSync(join(runDir, "events.jsonl"), JSON.stringify(tail) + "\n");
  return runDir;
}

function readOwnerStatus(runDir) {
  return JSON.parse(readFileSync(join(runDir, "run-ledger.json"), "utf8")).owner.status;
}
function lastEventType(runDir) {
  const lines = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]).type;
}

function freshRoot() {
  const dir = mkdtempSync(join(tmpdir(), "resumecheck-"));
  mkdirSync(join(dir, ".faff"), { recursive: true });
  return dir;
}

test("owned running owner + run-resume tail → hook stamps aborted-resumable + appends run-claim-abandoned + exits 0", () => {
  const root = freshRoot();
  const runDir = mkRun(root, { ownerStatus: "running", tailType: "run-resume" });
  const r = run(["resumecheck", "--hook", "--json", "--root", root], { FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "S" });
  assert.equal(r.code, 0, "the Stop hook never blocks — always exits 0");
  assert.equal(readOwnerStatus(runDir), "aborted-resumable", "owner released to aborted-resumable");
  assert.equal(lastEventType(runDir), "run-claim-abandoned", "the audit event is appended");
  assert.match(r.err, /released unworked resume claim/, "the non-blocking release notice is on stderr");
  const payload = JSON.parse(r.out.trim());
  assert.equal(payload.released, true);
  assert.equal(payload.reason, "no-work-since-run-resume");
  assert.equal(payload.epoch, 1);
});

test("owned running owner + WORK tail → no release (a working run is never disturbed)", () => {
  const root = freshRoot();
  const runDir = mkRun(root, { ownerStatus: "running", tailType: "build-start" });
  const r = run(["resumecheck", "--hook", "--json", "--root", root], { FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "S" });
  assert.equal(r.code, 0);
  assert.equal(readOwnerStatus(runDir), "running", "owner left running");
  assert.equal(lastEventType(runDir), "build-start", "no audit event appended");
  const payload = JSON.parse(r.out.trim());
  assert.equal(payload.released, false);
});

test("owner already aborted-resumable → idempotent no-op (no release, no event)", () => {
  const root = freshRoot();
  const runDir = mkRun(root, { ownerStatus: "aborted-resumable", tailType: "run-resume" });
  const r = run(["resumecheck", "--hook", "--json", "--root", root], { FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "S" });
  assert.equal(r.code, 0);
  assert.equal(readOwnerStatus(runDir), "aborted-resumable");
  assert.equal(lastEventType(runDir), "run-resume", "no run-claim-abandoned appended");
  assert.equal(JSON.parse(r.out.trim()).released, false);
});

test("no FAFF_RUN_DIR pointer at the fixture → silent no-op (never resolves a foreign run to stamp)", () => {
  const root = freshRoot();
  const runDir = mkRun(root, { ownerStatus: "running", tailType: "run-resume" });
  // FAFF_RUN_DIR unset (defaulted "") — resolveRunDir falls back to the latest run under the
  // process cwd's root, NOT this fixture, so the fixture is never touched.
  const r = run(["resumecheck", "--hook", "--json", "--root", root], { FAFF_SESSION_ID: "S" });
  assert.equal(r.code, 0);
  assert.equal(readOwnerStatus(runDir), "running", "fixture owner untouched");
  assert.equal(JSON.parse(r.out.trim()).released, false);
});

test("--selftest passes (pure decision + grace-parse + read-side boundary tables)", () => {
  const r = run(["resumecheck", "--selftest"], {});
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULT: PASS/);
});
