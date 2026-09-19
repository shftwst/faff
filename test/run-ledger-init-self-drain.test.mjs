// FAFF-966 — the L3 self-drain mint (`faff run-ledger init-self-drain`), the sibling of
// `init-interactive` (L2, FAFF-761) and `mintLightsOut` (L4). Closes the provisioning gap
// where beep-boop's ordinary self-drain mint wrote a run-ledger.json by hand with no
// `events.jsonl` genesis chain, so the dispatched build lane's Step-9b `faff events anchor`
// failed `anchor-missing`. Drives the REAL `faff run-ledger` CLI + the REAL `faff events
// anchor`, mirroring run-ledger-init-interactive.test.mjs's shape.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { resolveAnchorLevel, readAcComplete, readReviewVerdict } =
  require("../plugin/skills/faff/bin/lib/merge-gate.js");
const { emitGenesisRunStart, verifyChain, verifyExitCode } = require("../plugin/skills/faff/bin/lib/events.js");

// A child env WITHOUT the ambient orchestrator run so the mint's live-higher-level guard is
// inert unless a case sets FAFF_RUN_DIR itself.
function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_SESSION_ID;
  return { ...e, ...extra };
}

function mkTmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function mkGitRepo() {
  const dir = mkTmp("faff-966-repo-");
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  writeFileSync(path.join(dir, "README"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  return dir;
}

// Mint an L3 self-drain run under `root`; returns the absolute run dir.
function mint(root, mode = "full", env = cleanEnv()) {
  const r = runCli(["run-ledger", "init-self-drain", "--mode", mode, "--root", root, "--json"], { env });
  assert.equal(r.code, 0, `mint failed: ${r.stderr}`);
  return JSON.parse(r.stdout).run_dir;
}

function seedFloor(runDir, issue) {
  const d = path.join(runDir, issue);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(d, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

function anchorAndCommit(repo, runDir, issue) {
  const dest = path.join(".faff", "anchors", path.basename(runDir), issue);
  const r = runCli(["events", "anchor", "--run-dir", runDir, "--issue", issue, "--dest", dest], { cwd: repo, env: cleanEnv() });
  assert.equal(r.code, 0, `anchor failed: ${r.stderr}`);
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("add", "-A");
  g("commit", "-qm", `anchor ${issue}`);
  const sha = g("rev-parse", "HEAD").stdout.trim();
  return { anchorDir: path.join(repo, dest), sha };
}

// --- The mint itself ---

test("mint writes an honest L3 ledger + genesis chain; bare stdout is the run dir path", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stderr);
  const runDir = r.stdout.trim();
  assert.match(path.basename(runDir), /^run-\d{8}-\d{6}-beepboop-full-[0-9a-f]{6}$/, "run id follows run-<stamp>-beepboop-<mode>-<entropy>");
  const led = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(led.level, "L3");
  assert.deepEqual(led.admitted, [], "not issue-scoped at mint — admitted starts empty");
  assert.deepEqual(led.outcomes, {});
  assert.equal(led.owner.status, "running");
  assert.ok(led.owner.pid && led.owner.started_at && led.owner.last_heartbeat);
  assert.equal(verifyExitCode(verifyChain(runDir), "fail"), 0, "genesis chain verifies");
  rmSync(root, { recursive: true, force: true });
});

test("the mint's genesis: seq 0 ledger-write (prev == SHA-256(run_id)), seq 1 run-start (data.level L3)", () => {
  const root = mkTmp("faff-966-root-");
  const runDir = mint(root);
  const lines = readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const runId = path.basename(runDir);
  const runIdHash = require("node:crypto").createHash("sha256").update(Buffer.from(runId, "utf8")).digest("hex");
  assert.equal(lines[0].seq, 0);
  assert.equal(lines[0].schema, 2);
  assert.equal(lines[0].prev, runIdHash, "the PHYSICAL seq-0 record's prev is SHA-256(run_id) — the load-bearing genesis invariant (ADR-0084), regardless of its TYPE");
  assert.ok(lines.some((r) => r.type === "run-start"), "a run-start record is present in the genesis window");
  const runStart = lines.find((r) => r.type === "run-start");
  assert.deepEqual(runStart.data, { level: "L3" });
  rmSync(root, { recursive: true, force: true });
});

test("there is NO flag that sets a level other than L3", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--level", "L4", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown-flag|usage/i);
  rmSync(root, { recursive: true, force: true });
});

test("no --mode / --id at all → still mints (both optional), mode defaults to 'full' in the run-id", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout.trim(), /beepboop-full-[0-9a-f]{6}$/);
  rmSync(root, { recursive: true, force: true });
});

// --- --mode / --id validation (both share init-interactive's bare-id allowlist) ---

test("a path-traversal --mode → exit 2 and mints no partial dir", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "../escape", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.equal(existsSync(path.join(root, ".faff", "runs")), false, "no run dir minted on a bad --mode");
  rmSync(root, { recursive: true, force: true });
});

test("a '/' in --mode → exit 2 and mints no partial dir", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "a/b", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.equal(existsSync(path.join(root, ".faff", "runs")), false);
  rmSync(root, { recursive: true, force: true });
});

test("a path-traversal --id → exit 2 and mints no dir", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--id", "../evil", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.equal(existsSync(path.join(root, ".faff", "runs")), false);
  rmSync(root, { recursive: true, force: true });
});

// --- EEXIST refusal (a stale dir, or a re-run with the same --id, is never appended-over) ---

test("EEXIST: an --id colliding with an existing run dir → exit 3, writes nothing into it", () => {
  const root = mkTmp("faff-966-root-");
  const runDir = mint(root, "full", cleanEnv({}));
  const id = path.basename(runDir);
  const before = readFileSync(path.join(runDir, "run-ledger.json"));
  const r = runCli(["run-ledger", "init-self-drain", "--id", id, "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 3, r.stderr);
  const after = readFileSync(path.join(runDir, "run-ledger.json"));
  assert.ok(before.equals(after), "the existing run dir's ledger is byte-unchanged");
  rmSync(root, { recursive: true, force: true });
});

// --- CLI-level trust guard (identical shape to init-interactive's) ---

function seedLiveRun(root, runId, level, status) {
  const rd = path.join(root, ".faff", "runs", runId);
  mkdirSync(rd, { recursive: true });
  writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify({ run_id: runId, level, admitted: [], outcomes: {}, owner: { status } }));
  return rd;
}

test("CLI-guard: a live L4 run resolved via FAFF_RUN_DIR → exit 3 + refusal observe, NO L3 dir minted", () => {
  const root = mkTmp("faff-966-root-");
  const liveL4 = seedLiveRun(root, "run-20260101-000000-lights-out", "L4", "running");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: liveL4 }) });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /refusing/i);
  const minted = readdirSync(path.join(root, ".faff", "runs")).some((n) => n.includes("beepboop-full"));
  assert.equal(minted, false, "the guard minted no L3 dir");
  const ev = readFileSync(path.join(liveL4, "events.jsonl"), "utf8");
  assert.match(ev, /sentry-trip/);
  assert.match(ev, /downgrade-refused/);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: a live L3 run resolved via FAFF_RUN_DIR ALSO refuses (identical HIGHER_LEVELS shape to init-interactive)", () => {
  const root = mkTmp("faff-966-root-");
  const liveL3 = seedLiveRun(root, "run-20260101-000000-beepboop-full-aaaaaa", "L3", "running");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: liveL3 }) });
  assert.equal(r.code, 3, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: a DONE higher-level run does NOT trip the guard — mint proceeds (exit 0)", () => {
  const root = mkTmp("faff-966-root-");
  const doneL4 = seedLiveRun(root, "run-20260101-000000-lights-out", "L4", "done");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: doneL4 }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).level, "L3");
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: a live L2 run does NOT trip the guard (only L3/L4 are 'higher')", () => {
  const root = mkTmp("faff-966-root-");
  const liveL2 = seedLiveRun(root, "run-20260101-000000-graft-OTHER", "L2", "running");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: liveL2 }) });
  assert.equal(r.code, 0, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: no live run present → mint proceeds (exit 0)", () => {
  const root = mkTmp("faff-966-root-");
  const r = runCli(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

// --- E2E accept: mint → anchor → resolveAnchorLevel accepts L3 (+ merge_floor readers pass) ---

test("E2E: self-drain mint → Step-9b-style anchor → resolveAnchorLevel returns {level:L3, status:ok}", () => {
  const repo = mkGitRepo();
  const runDir = mint(repo);
  const ISSUE = "TEST-1";
  seedFloor(runDir, ISSUE);
  const { anchorDir, sha } = anchorAndCommit(repo, runDir, ISSUE);
  const res = resolveAnchorLevel(repo, null, runDir, ISSUE, sha);
  assert.deepEqual({ level: res.level, status: res.status }, { level: "L3", status: "ok" });
  assert.equal(verifyExitCode(verifyChain(anchorDir), "fail"), 0, "anchored chain verifies");
  assert.equal(readAcComplete(runDir, ISSUE), true);
  assert.equal(readReviewVerdict(runDir, ISSUE), "pass");
  rmSync(repo, { recursive: true, force: true });
});

// --- The pure-core decision tables run in-process too (the CLI selftest, shared with init-interactive) ---

test("run-ledger --selftest passes", () => {
  const r = runCli(["run-ledger", "--selftest"], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

// --- emitGenesisRunStart: the ONE shared helper all three mints now call ---
// (DoD: "a named regression assertion that the L4 lights-out mint and the L2
// init-interactive mint still emit their genesis unchanged (seq/prev/data.level
// byte-preserved) after the emitGenesisRunStart extraction". lights-out.test.mjs's own
// L4-mint test drives a hand-rolled fixture that predates and bypasses the real
// `mintLightsOut` (FAFF-325's container gate makes the real CLI unreachable in this test
// environment), so it cannot exercise the shared helper — this asserts the helper itself,
// directly, in both call shapes each real mint uses. run-ledger-init-interactive.test.mjs's
// own mint test drives the REAL CLI and asserts the L2 no-data.level shape end-to-end.)

function mkBareRunDir(root, runId) {
  const runDir = path.join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return runDir;
}

test("emitGenesisRunStart: with a level → schema 2, seq/prev CLI-computed, data:{level}", () => {
  const root = mkTmp("faff-966-helper-");
  const runDir = mkBareRunDir(root, "run-helper-l4");
  const runId = path.basename(runDir);
  const rec = emitGenesisRunStart(runDir, { level: "L4" });
  assert.equal(rec.schema, 2);
  assert.equal(rec.run_id, runId);
  assert.equal(rec.seq, 0);
  assert.equal(rec.phase, "run");
  assert.equal(rec.type, "run-start");
  assert.deepEqual(rec.data, { level: "L4" });
  assert.equal(rec.prev, require("node:crypto").createHash("sha256").update(Buffer.from(runId, "utf8")).digest("hex"));
  assert.equal(verifyExitCode(verifyChain(runDir), "fail"), 0);
  rmSync(root, { recursive: true, force: true });
});

test("emitGenesisRunStart: with NO level (L2's call shape) → no data field at all — byte-preserved", () => {
  const root = mkTmp("faff-966-helper-");
  const runDir = mkBareRunDir(root, "run-helper-l2");
  const rec = emitGenesisRunStart(runDir);
  assert.equal(rec.type, "run-start");
  assert.equal(rec.data, undefined, "L2's genesis has never carried data.level");
  assert.equal(Object.prototype.hasOwnProperty.call(rec, "data"), false, "the key itself is absent, not merely undefined-valued");
  rmSync(root, { recursive: true, force: true });
});

test("emitGenesisRunStart: L3's call shape (init-self-drain) → data:{level:'L3'}", () => {
  const root = mkTmp("faff-966-helper-");
  const runDir = mkBareRunDir(root, "run-helper-l3");
  const rec = emitGenesisRunStart(runDir, { level: "L3" });
  assert.deepEqual(rec.data, { level: "L3" });
  rmSync(root, { recursive: true, force: true });
});
