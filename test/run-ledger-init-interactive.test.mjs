// FAFF-761 — standalone-interactive L2 mint → anchor → merge-floor acceptance, and the
// fail-closed / sequencing / guard invariants. Drives the REAL `faff run-ledger` CLI + the
// REAL `faff events anchor`, commits the anchor into a REAL git repo, and reads it back through
// the SAME `resolveAnchorLevel` / `readAcComplete` / `readReviewVerdict` `faff merge-gate` uses
// — so the test asserts against exactly the artifact + readers the shipped merge floor consumes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const { resolveAnchorLevel, anchorRefusal, readAcComplete, readReviewVerdict } =
  require("../plugin/skills/faff/bin/lib/merge-gate.js");
const { verifyChain, verifyExitCode } = require("../plugin/skills/faff/bin/lib/events.js");

const ISSUE = "TEST-1";

// A child env WITHOUT the ambient orchestrator run so the mint's live-higher-level guard is inert
// unless a case sets FAFF_RUN_DIR itself (a plain `node --test` has neither var set anyway).
function cleanEnv(extra = {}) {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_SESSION_ID;
  return { ...e, ...extra };
}

function mkTmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

// A real git repo rooted at a tmp dir — the mint writes .faff/runs/… under it, the anchor commits.
function mkGitRepo() {
  const dir = mkTmp("faff-761-repo-");
  const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  // .faff/anchors is gitignored-except-carveout in the real repo; here nothing is ignored.
  writeFileSync(path.join(dir, "README"), "seed\n");
  g("add", "-A");
  g("commit", "-qm", "seed");
  return dir;
}

// Mint an interactive L2 run under `root`; returns the absolute run dir.
function mint(root, issue = ISSUE, env = cleanEnv()) {
  const r = runCli(["run-ledger", "init-interactive", "--issue", issue, "--root", root, "--json"], { env });
  assert.equal(r.code, 0, `mint failed: ${r.stderr}`);
  return JSON.parse(r.stdout).run_dir;
}

// Seed the per-issue merge-floor markers the anchor best-effort-copies.
function seedFloor(runDir, issue = ISSUE) {
  const d = path.join(runDir, issue);
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
  writeFileSync(path.join(d, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
}

// Anchor + commit; returns { anchorDir, sha }.
function anchorAndCommit(repo, runDir, issue = ISSUE) {
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

test("mint writes an honest L2 ledger + genesis chain; bare stdout is the run dir path", () => {
  const root = mkTmp("faff-761-root-");
  const r = runCli(["run-ledger", "init-interactive", "--issue", ISSUE, "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 0);
  const runDir = r.stdout.trim();
  assert.ok(runDir.includes(`graft-${ISSUE}`), "run id follows the run-…-graft-<issue> convention");
  const led = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(led.level, "L2");
  assert.deepEqual(led.admitted, [ISSUE]);
  assert.deepEqual(led.outcomes, {});
  assert.equal(led.owner.status, "running");
  assert.ok(led.owner.pid && led.owner.started_at && led.owner.last_heartbeat);
  assert.equal(verifyExitCode(verifyChain(runDir), "fail"), 0, "genesis chain verifies");
  rmSync(root, { recursive: true, force: true });
});

test("there is NO flag that sets a level other than L2", () => {
  const root = mkTmp("faff-761-root-");
  // --level is not a declared flag → parseArgs rejects it (exit 2), never mints an off-level ledger.
  const r = runCli(["run-ledger", "init-interactive", "--issue", ISSUE, "--level", "L4", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown-flag|usage/i);
  rmSync(root, { recursive: true, force: true });
});

test("a non-bare-issue-id --issue → exit 2 and mints no partial dir", () => {
  const root = mkTmp("faff-761-root-");
  const r = runCli(["run-ledger", "init-interactive", "--issue", "bad/../x", "--root", root], { env: cleanEnv() });
  assert.equal(r.code, 2);
  assert.equal(existsSync(path.join(root, ".faff", "runs")), false, "no run dir minted on a bad --issue");
  rmSync(root, { recursive: true, force: true });
});

// --- E2E accept: mint → anchor → resolveAnchorLevel accepts L2 (+ merge_floor readers pass) ---

test("E2E: standalone mint → Step-9b anchor → resolveAnchorLevel returns {level:L2, status:ok}", () => {
  const repo = mkGitRepo();
  const runDir = mint(repo);
  seedFloor(runDir);
  const { anchorDir, sha } = anchorAndCommit(repo, runDir);
  const res = resolveAnchorLevel(repo, null, runDir, ISSUE, sha);
  assert.deepEqual({ level: res.level, status: res.status }, { level: "L2", status: "ok" });
  // integrity leg core: the anchored chain still verifies after relocation under .faff/anchors/…
  assert.equal(verifyExitCode(verifyChain(anchorDir), "fail"), 0, "anchored chain verifies");
  // merge_floor: merge-gate's own re-read of the LIVE run dir (runDir/<issue>/…) passes.
  assert.equal(readAcComplete(runDir, ISSUE), true);
  assert.equal(readReviewVerdict(runDir, ISSUE), "pass");
  // the committed anchor carries the flat merge-floor evidence the governance-check leg re-reads.
  const anchoredAc = JSON.parse(readFileSync(path.join(anchorDir, "ac-checklist.json"), "utf8"));
  assert.equal(anchoredAc.all_verified, true);
  const anchoredRv = JSON.parse(readFileSync(path.join(anchorDir, "review-verdict.json"), "utf8"));
  assert.equal(anchoredRv.signal, "pass");
  rmSync(repo, { recursive: true, force: true });
});

// --- Negative / fail-closed: a missing or malformed committed anchor still refuses (exit 2) ---

test("fail-closed: a corrupted anchor (level removed) → anchor-malformed → merge-gate refuses", () => {
  const repo = mkGitRepo();
  const runDir = mint(repo);
  seedFloor(runDir);
  const { anchorDir } = anchorAndCommit(repo, runDir);
  // Corrupt the committed anchor: strip the `level` field, re-commit.
  const ap = path.join(anchorDir, "run-ledger.json");
  const led = JSON.parse(readFileSync(ap, "utf8"));
  delete led.level;
  writeFileSync(ap, JSON.stringify(led));
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  g("add", "-A"); g("commit", "-qm", "corrupt anchor");
  const sha = g("rev-parse", "HEAD").stdout.trim();
  const res = resolveAnchorLevel(repo, null, runDir, ISSUE, sha);
  assert.equal(res.status, "anchor-malformed");
  assert.equal(res.level, null);
  // the refusal string merge-gate emits (exit 2) is produced for a non-ok status.
  assert.match(anchorRefusal(runDir, ISSUE, sha, res.status), /no trusted committed anchor level/);
  rmSync(repo, { recursive: true, force: true });
});

test("fail-closed: no committed anchor at all → anchor-missing (the pre-fix behaviour is preserved)", () => {
  const repo = mkGitRepo();
  const runDir = mint(repo); // minted but NEVER anchored/committed
  const g = (...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });
  const sha = g("rev-parse", "HEAD").stdout.trim();
  const res = resolveAnchorLevel(repo, null, runDir, ISSUE, sha);
  assert.equal(res.status, "anchor-missing");
  assert.equal(res.level, null);
  rmSync(repo, { recursive: true, force: true });
});

// --- Immutability / sequencing: the terminal write lands only on the LIVE ledger ---

test("immutability: a Step-10 terminal write updates the live ledger while the committed anchor stays byte-stable", () => {
  const repo = mkGitRepo();
  const runDir = mint(repo);
  seedFloor(runDir);
  const { anchorDir } = anchorAndCommit(repo, runDir);
  const anchorLedgerPath = path.join(anchorDir, "run-ledger.json");
  const before = readFileSync(anchorLedgerPath); // bytes committed at anchor time
  // Step-10 terminal outcome-write on the LIVE ledger (post-anchor).
  const r = runCli(["run-ledger", "record-outcome", "--issue", ISSUE, "--outcome", "shipped", "--run-dir", runDir], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stderr);
  const live = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(live.outcomes[ISSUE], "shipped");
  assert.equal(live.owner.status, "done");
  // the committed anchor is an immutable pre-merge snapshot: still outcomes:{}, byte-identical.
  const anchored = JSON.parse(readFileSync(anchorLedgerPath, "utf8"));
  assert.deepEqual(anchored.outcomes, {});
  assert.ok(before.equals(readFileSync(anchorLedgerPath)), "committed anchor ledger bytes unchanged by the terminal write");
  rmSync(repo, { recursive: true, force: true });
});

// --- Terminal-state matrix ---

for (const outcome of ["shipped", "parked", "errored"]) {
  test(`terminal-state matrix: record-outcome ${outcome} writes outcomes[issue]=${outcome} + owner.status=done`, () => {
    const root = mkTmp("faff-761-root-");
    const runDir = mint(root);
    const r = runCli(["run-ledger", "record-outcome", "--issue", ISSUE, "--outcome", outcome, "--run-dir", runDir], { env: cleanEnv() });
    assert.equal(r.code, 0, r.stderr);
    const led = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    assert.equal(led.outcomes[ISSUE], outcome);
    assert.equal(led.owner.status, "done");
    rmSync(root, { recursive: true, force: true });
  });
}

test("terminal-state matrix: a genuinely abandoned mid-build leaves owner.status=running (backstop fires)", () => {
  const root = mkTmp("faff-761-root-");
  const runDir = mint(root); // minted, then NO record-outcome (abandoned)
  const led = JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(led.owner.status, "running");
  assert.equal(ISSUE in led.outcomes, false, "admitted-without-outcome ⇒ runcheck completeness backstop fires");
  rmSync(root, { recursive: true, force: true });
});

// --- CLI-level trust guard (infosec) ---

function seedLiveRun(root, runId, level, status) {
  const rd = path.join(root, ".faff", "runs", runId);
  mkdirSync(rd, { recursive: true });
  writeFileSync(path.join(rd, "run-ledger.json"), JSON.stringify({ run_id: runId, level, admitted: [], outcomes: {}, owner: { status } }));
  return rd;
}

test("CLI-guard: a live L4 run resolved via FAFF_RUN_DIR → exit 3 + refusal observe, NO L2 dir minted", () => {
  const root = mkTmp("faff-761-root-");
  const liveL4 = seedLiveRun(root, "run-20260101-000000-lights-out", "L4", "running");
  const r = runCli(["run-ledger", "init-interactive", "--issue", "TEST-2", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: liveL4 }) });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /refusing|downgrade/i);
  assert.equal(existsSync(path.join(root, ".faff", "runs", "run-20260101-000000-lights-out")), true);
  // no NEW graft run dir was minted
  const minted = existsSync(path.join(root, ".faff", "runs")) &&
    require("node:fs").readdirSync(path.join(root, ".faff", "runs")).some((n) => n.includes("graft-TEST-2"));
  assert.equal(minted, false, "the guard minted no L2 dir");
  // a refusal observe was appended to the live L4 run's own timeline.
  const ev = readFileSync(path.join(liveL4, "events.jsonl"), "utf8");
  assert.match(ev, /sentry-trip/);
  assert.match(ev, /downgrade-refused/);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: a DONE higher-level run does NOT trip the guard — mint proceeds (exit 0)", () => {
  const root = mkTmp("faff-761-root-");
  const doneL4 = seedLiveRun(root, "run-20260101-000000-lights-out", "L4", "done");
  const r = runCli(["run-ledger", "init-interactive", "--issue", "TEST-3", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: doneL4 }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).level, "L2");
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: a live L2 run does NOT trip the guard (only L3/L4 are 'higher')", () => {
  const root = mkTmp("faff-761-root-");
  const liveL2 = seedLiveRun(root, "run-20260101-000000-graft-OTHER", "L2", "running");
  const r = runCli(["run-ledger", "init-interactive", "--issue", "TEST-4", "--root", root, "--json"],
    { env: cleanEnv({ FAFF_RUN_DIR: liveL2 }) });
  assert.equal(r.code, 0, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

test("CLI-guard: no live run present → mint proceeds (exit 0)", () => {
  const root = mkTmp("faff-761-root-");
  const r = runCli(["run-ledger", "init-interactive", "--issue", "TEST-5", "--root", root, "--json"], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stderr);
  rmSync(root, { recursive: true, force: true });
});

// --- The pure-core decision tables run in-process too (the CLI selftest). ---

test("run-ledger --selftest passes (pure shape + guard + terminal-outcome + genesis chain)", () => {
  const r = runCli(["run-ledger", "--selftest"], { env: cleanEnv() });
  assert.equal(r.code, 0, r.stdout + r.stderr);
});
