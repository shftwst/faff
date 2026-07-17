// FAFF-367 — merge-gate SHELL control-flow tests (the branches decideFloor cannot see).
//
// mergeGateSelftest covers the pure cores and merge-gate.test.mjs covers arg validation; this file
// exercises the impure ROUTING past the gh calls — the `--check-only` short-circuit, the plain-refuse
// exit, the already-MERGED idempotent no-op, and the FAFF-375 human-override TTY fence — by injecting a
// stub `gh` on PATH and driving the REAL `faff merge-gate` entrypoint via runCli. No network; the stub
// answers only from canned env-parameterised data and records `gh pr merge` via a sentinel file.
// Assert-at-seam per ADR 0002: exit code, `--json` stdout, on-disk artifacts — never narrative text.
//
// DRIFT (FAFF-375, PR #285, merged ~1h before this build): `--human-override`/`--allow-no-ci` are now
// fenced on `process.stdin.isTTY === true AND --interactive`, returning exit 2 BEFORE any gh call. A
// runCli child is non-TTY by construction, so the spec's original "override recorded + merge falls
// through" scenario is unreachable here — the fence fires first. These tests assert the CURRENT
// behaviour (exit 2 + no override file). Separately, the shipped refuse-return precedes the
// `--check-only` short-circuit, so `--check-only` on a REFUSE floor returns exit 1 refuse (not a
// false-green merge-ok) — the code is safer than the spec's test-case prose implied; tests follow code.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

const ISSUE = "FAFF-1";
const SHA = "deadbeefcafe1234567890abcdef1234567890ab";
const REPO = "owner/repo";

// Track every temp dir so a single after-hook cleans the lot (leave-no-residue).
const tmpDirs = [];
const mkTmp = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// A stub `gh`: answers exactly the subcommands the merge-gate shell issues, from env-supplied canned
// data, and touches STUB_MERGE_SENTINEL on any `pr merge`. An unhandled subcommand exits 3 so a shell
// change that issues a new gh call fails LOUDLY rather than silently passing.
const STUB_GH = `#!/usr/bin/env bash
case "$1" in
  repo)
    [ "$2" = "view" ] && { printf '{"nameWithOwner":"%s"}' "$STUB_REPO"; exit 0; } ;;
  pr)
    case "$2" in
      view)   printf '{"headRefOid":"%s","headRefName":"%s","state":"%s","url":"https://example.test/pr/1"}' "$STUB_SHA" "\${STUB_HEAD_REF_NAME:-stub-head-branch}" "$STUB_PR_STATE"; exit 0 ;;
      checks) printf '[]'; exit 0 ;;
      merge)  printf '%s' "$*" > "$STUB_MERGE_SENTINEL"; exit 0 ;;
    esac ;;
  api)
    case "$*" in
      *check-runs*) printf '%s' "$STUB_CHECK_RUNS"; exit 0 ;;
      *status*)     printf '%s' "$STUB_STATUS"; exit 0 ;;
    esac ;;
esac
printf 'stub gh: unhandled subcommand: %s\\n' "$*" >&2
exit 3
`;

// Build a doctored env whose PATH shadows the real gh with the stub, plus the canned-response vars.
// ci:"green" → one completed/success check-run + a legacy success status ⇒ classifyHeadShaChecks → ci-green.
// headRefName (FAFF-383): the PR-view stub's headRefName field — the branch-delete observe target.
function stubGhEnv({ prState = "OPEN", ci = "green", headRefName = "stub-head-branch" } = {}) {
  const stubDir = mkTmp("mg-gh-");
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, STUB_GH);
  chmodSync(ghPath, 0o755);
  const sentinel = join(stubDir, "merge-sentinel");
  const checkRuns = ci === "green" ? '[{"status":"completed","conclusion":"success"}]' : "[]";
  const status = ci === "green" ? '{"state":"success","count":1}' : '{"state":"pending","count":0}';
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    STUB_REPO: REPO,
    STUB_SHA: SHA,
    STUB_PR_STATE: prState,
    STUB_HEAD_REF_NAME: headRefName,
    STUB_CHECK_RUNS: checkRuns,
    STUB_STATUS: status,
    STUB_MERGE_SENTINEL: sentinel,
  };
  return { env, sentinel };
}

// Seed the run-dir floor artifacts. "merge-ok" → passing AC + a review block computeReviewVerdict
// scores "pass". "refuse" → omit both (readAcComplete→false, readReviewVerdict→"missing").
function seedRunDir(kind) {
  const runDir = mkTmp("mg-run-");
  if (kind === "merge-ok") {
    const issueDir = join(runDir, ISSUE);
    mkdirSync(issueDir, { recursive: true });
    writeFileSync(join(issueDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(join(issueDir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  }
  return runDir;
}

// FAFF-537: the execute path now requires a merge method (the empty-method guard fires before the gh
// spawn). Real callers always pass one (the default ship producer passes `--merge-args "--squash
// --delete-branch"`); baseArgs carries a bare `--squash` — which also exercises the new bare-method
// alias fold-in. A test that itself passes `--merge-args` (extra) composes with it (same method
// dedupes; a distinct modifier like --delete-branch is preserved). check-only/refuse/fence paths
// return before the guard, so the extra flag is inert there.
const baseArgs = (runDir, extra = []) =>
  ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--level", "L3", "--repo", REPO, "--json", "--squash", ...extra];

const overrideFile = (runDir) => join(runDir, ISSUE, "merge-gate-override.json");

// --- --check-only: computes the verdict, NEVER spawns gh pr merge ---

test("check-only on a merge-ok floor → exit 0, verdict merge-ok, merge sentinel ABSENT", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir, ["--check-only"]), { env });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(existsSync(sentinel), false, "check-only must never merge");
});

test("check-only on a refuse floor → exit 1, verdict refuse, merge sentinel ABSENT (refuse precedes the short-circuit)", () => {
  const runDir = seedRunDir("refuse");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir, ["--check-only"]), { env });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stdout).verdict, "refuse");
  assert.equal(existsSync(sentinel), false);
});

// --- execute mode: the positive control that the merge spawn actually fires ---

test("execute on a merge-ok floor → exit 0, merged:true, merge sentinel PRESENT", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(existsSync(sentinel), true, "execute on a passing floor must spawn gh pr merge");
});

// --- FAFF-537: bare merge-method flag folds in; a missing method fails loud BEFORE gh ---

test("FAFF-537: a bare --squash (no --merge-args) is forwarded to gh pr merge, not dropped", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv();
  const { code } = runCli(baseArgs(runDir), { env }); // baseArgs carries the bare --squash
  assert.equal(code, 0);
  assert.equal(existsSync(sentinel), true, "the merge must spawn");
  assert.match(readFileSync(sentinel, "utf8"), /--squash/, "the bare method reaches gh pr merge");
});

test("FAFF-537: execute with NO merge method → exit 2 with merge-gate's own error, BEFORE any gh merge", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv();
  // Manual args WITHOUT the bare --squash baseArgs supplies — the reported no-method invocation.
  const args = ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--level", "L3", "--repo", REPO, "--json"];
  const { code, stderr } = runCli(args, { env });
  assert.equal(code, 2);
  assert.match(stderr, /no merge method/);
  assert.match(stderr, /--merge-args/, "the actionable error names --merge-args");
  assert.equal(existsSync(sentinel), false, "no gh pr merge is spawned when the method is missing");
});

test("FAFF-537: a bare --squash plus --merge-args \"--rebase\" (two methods) → exit 2 conflict, no merge", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv();
  const { code, stderr } = runCli(baseArgs(runDir, ["--merge-args", "--rebase"]), { env });
  assert.equal(code, 2);
  assert.match(stderr, /conflicting merge methods/);
  assert.equal(existsSync(sentinel), false);
});

test("execute on a refuse floor → exit 1, verdict refuse, merge sentinel ABSENT", () => {
  const runDir = seedRunDir("refuse");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(Array.isArray(out.blockers) && out.blockers.length > 0, "a refuse carries blockers");
  assert.equal(existsSync(sentinel), false);
});

// --- already-MERGED PR: idempotent no-op, never a double-merge (regardless of floor) ---

test("already-MERGED PR → exit 0, merged:true, merge sentinel ABSENT (idempotent no-op)", () => {
  const runDir = seedRunDir("refuse"); // even on a refuse floor, a merged PR short-circuits before decideFloor
  const { env, sentinel } = stubGhEnv({ prState: "MERGED" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(existsSync(sentinel), false, "an already-merged PR must not re-spawn gh pr merge");
});

// --- FAFF-375 human-override TTY fence: non-TTY runCli child → exit 2 BEFORE any gh call ---

test("--interactive --human-override (non-TTY) → exit 2 fence, NO override file, NO merge (before any gh call)", () => {
  const runDir = seedRunDir("refuse");
  const { env, sentinel } = stubGhEnv();
  const { code, stderr } = runCli(baseArgs(runDir, ["--interactive", "--human-override"]), { env });
  assert.equal(code, 2);
  assert.match(stderr, /--human-override is human-only/);
  assert.match(stderr, /real terminal/);
  assert.equal(existsSync(overrideFile(runDir)), false, "the fence must return before the override is recorded");
  assert.equal(existsSync(sentinel), false);
});

test("--human-override WITHOUT --interactive (non-TTY) → exit 2, NO override file", () => {
  const runDir = seedRunDir("refuse");
  const { env } = stubGhEnv();
  const { code, stderr } = runCli(baseArgs(runDir, ["--human-override"]), { env });
  assert.equal(code, 2);
  assert.match(stderr, /--human-override/);
  assert.equal(existsSync(overrideFile(runDir)), false);
});

// --- FAFF-424: merge-gate derives its level from the run-ledger, refusing a contradicting --level ---

const argsNoLevel = (runDir, extra = []) =>
  ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--repo", REPO, "--json", ...extra];

function writeLedger(runDir, level) {
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: "test-run", level }));
}

test("L4 ledger + no --level + no holdout artifact → exit 1, refuse names the L4 holdout (level derived, not defaulted)", () => {
  const runDir = seedRunDir("merge-ok"); // AC + review pass; only the (absent) holdout artifact should block
  writeLedger(runDir, "L4");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)), "refuse must name the L4 holdout leg");
  assert.equal(existsSync(sentinel), false, "a derived-L4 refuse must never reach gh pr merge");
});

test("L4 ledger + --level L3 → exit 2, mismatch error names both levels and the ledger path, no gh call", () => {
  const runDir = seedRunDir("merge-ok");
  writeLedger(runDir, "L4");
  const { env, sentinel } = stubGhEnv();
  const { code, stderr } = runCli(baseArgs(runDir), { env }); // baseArgs passes --level L3
  assert.equal(code, 2);
  assert.match(stderr, /--level "L3" contradicts run-ledger level "L4"/);
  assert.match(stderr, /run-ledger\.json/);
  assert.equal(existsSync(sentinel), false, "a mismatch must be refused before any gh call");
});

test("L4 ledger + --level L4 (agreement) → proceeds at L4, refuse still names the L4 holdout (no coercion to L3)", () => {
  const runDir = seedRunDir("merge-ok");
  writeLedger(runDir, "L4");
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsNoLevel(runDir, ["--level", "L4"]), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)));
  assert.equal(existsSync(sentinel), false);
});

test("no ledger present + --level L3 → unchanged behaviour (flag/default governs, merge-ok floor merges)", () => {
  const runDir = seedRunDir("merge-ok"); // no run-ledger.json written
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(existsSync(sentinel), true, "no ledger → today's flag-governed path merges exactly as before");
});

test("ledger present with no level field + --level L3 → unchanged behaviour (ledgerLevel normalises to null)", () => {
  const runDir = seedRunDir("merge-ok");
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: "test-run" })); // no `level` key
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(existsSync(sentinel), true);
});

// Adversarial review (FAFF-424): the mismatch check must fire even under --check-only — it is
// malformed input, not a floor verdict the --check-only short-circuit should ever paper over.
test("L4 ledger + --level L3 + --check-only → still exit 2 mismatch (fires before the check-only short-circuit)", () => {
  const runDir = seedRunDir("merge-ok");
  writeLedger(runDir, "L4");
  const { env, sentinel } = stubGhEnv();
  const { code, stderr } = runCli(baseArgs(runDir, ["--check-only"]), { env });
  assert.equal(code, 2);
  assert.match(stderr, /--level "L3" contradicts run-ledger level "L4"/);
  assert.equal(existsSync(sentinel), false);
});

// --- FAFF-420: readHoldout is run-dir-relative + freshness-checked (the L4 fourth floor leg) ---
//
// AC + review already pass (seedRunDir("merge-ok")), so each case below isolates the holdout leg: a
// merge-ok overall verdict here means the holdout floor itself passed, not that other legs are lax.

const argsL4 = (runDir, extra = []) =>
  ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--level", "L4", "--repo", REPO, "--json", ...extra];

const MEETS_SPEC_BLOCK = JSON.stringify({
  aggregate: "meets-spec",
  code_blind: true,
  criteria: [{ class: "assertion", verdict: "met", evidence_present: true }],
  violations: [],
});

function writeCheckpoint(runDir, isoTime) {
  const dir = join(runDir, ISSUE);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "build-progress.json"), JSON.stringify({ issue: ISSUE, build: { status: "complete", pushed_at: isoTime }, updated_at: isoTime }));
}

function writeHoldout(runDir, mtimeDate) {
  const dir = join(runDir, ISSUE);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "holdout.json");
  writeFileSync(file, MEETS_SPEC_BLOCK);
  utimesSync(file, mtimeDate, mtimeDate);
}

test("FAFF-420: no holdout artifact under the run-dir (foreign/absent) → refuse, blocker names L4 holdout missing", () => {
  const runDir = seedRunDir("merge-ok"); // AC + review pass; no holdout.json anywhere under this run-dir
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsL4(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout: missing/.test(b)), "an absent/foreign holdout must read as missing, never meets-spec");
  assert.equal(existsSync(sentinel), false);
});

test("FAFF-420: holdout mtime predates the build-complete checkpoint (stale) → refuse, blocked (not missing)", () => {
  const runDir = seedRunDir("merge-ok");
  const checkpointTime = new Date("2026-07-10T12:00:00.000Z");
  const staleHoldoutTime = new Date("2026-07-10T11:00:00.000Z"); // before the checkpoint
  writeCheckpoint(runDir, checkpointTime.toISOString());
  writeHoldout(runDir, staleHoldoutTime);
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsL4(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout: blocked/.test(b)), "a stale verdict must read as blocked, distinct from missing");
  assert.equal(existsSync(sentinel), false, "a stale holdout must never satisfy the L4 floor");
});

// FAFF-325: this test host carries no genuine FAFF_INTEGRITY_BOUNDARY pid-1 declaration (nothing
// in this test harness can fake /proc/1/environ for a really-spawned child), so an L4 run now ALSO
// trips the corrective-integrity defence-in-depth leg — exactly the shipped behaviour: at rung-0,
// with no outer-layer mount+declaration anywhere, the run-start preflight is supposed to have
// refused this L4 run at ADMISSION, long before it ever reached merge-gate; reaching here at all is
// the belt-and-braces case, and it correctly refuses too. This test's original intent — prove the
// HOLDOUT leg itself is satisfied by a fresh, run-scoped verdict — still holds: assert no holdout
// blocker fires, and that integrity is the ONLY reason the overall verdict is refuse (never conflate
// the two legs, and never silently paper over the new gate by loosening this assertion).
test("FAFF-420: holdout mtime postdates the build-complete checkpoint (fresh) → the holdout leg itself is satisfied (no L4-holdout blocker); overall refuse is FAFF-325's corrective-integrity defence-in-depth, unasserted on this host", () => {
  const runDir = seedRunDir("merge-ok");
  const checkpointTime = new Date("2026-07-10T12:00:00.000Z");
  const freshHoldoutTime = new Date("2026-07-10T13:00:00.000Z"); // after the checkpoint
  writeCheckpoint(runDir, checkpointTime.toISOString());
  writeHoldout(runDir, freshHoldoutTime);
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsL4(runDir), { env });
  const out = JSON.parse(stdout);
  assert.ok(!out.blockers.some((b) => /L4 holdout/.test(b)), "the fresh, run-scoped meets-spec verdict must satisfy the holdout leg on its own");
  assert.equal(code, 1);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /corrective-artifact integrity unasserted at L4/.test(b)), "the ONLY remaining blocker must be the FAFF-325 defence-in-depth leg");
  assert.equal(out.integrity, "unasserted", "the result carries the FAFF-325 integrity annotation on the refuse path too");
  assert.equal(existsSync(sentinel), false, "no genuine FAFF_INTEGRITY_BOUNDARY on this host → correctly refused, never merged");
});

test("FAFF-420: holdout present but no build-complete checkpoint under the run-dir → refuse, blocked (freshness unprovable)", () => {
  const runDir = seedRunDir("merge-ok"); // no build-progress.json written
  writeHoldout(runDir, new Date("2026-07-10T13:00:00.000Z"));
  const { env, sentinel } = stubGhEnv();
  const { code, stdout } = runCli(argsL4(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout: blocked/.test(b)), "an unprovable freshness must refuse (blocked), never a silent pass");
  assert.equal(existsSync(sentinel), false);
});

// --- FAFF-383: the merge chokepoint's producer half of the effects ledger — the spec's own
// integration smoke test, end to end through the REAL merge-gate + effects CLIs (stubbed gh only).
//
// `faff effects declare|check` resolve their run dir as <root>/.faff/runs/<run-id> (via --root/--run);
// `merge-gate` takes an arbitrary --run-dir. seedEffectsRunDir nests the run-dir at exactly that path
// so both CLIs read/write the SAME declared-effects.jsonl — the graft-side declare and the mechanical
// observe are provably the same ledger, not two isolated fixtures asserted to "look compatible".

const EFFECTS_ISSUE = "FAFF-9";
const EFFECTS_PR = 9;

function seedEffectsRunDir(kind) {
  const root = mkTmp("mg-effroot-");
  const runId = "run-effects-test";
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  if (kind === "merge-ok") {
    const issueDir = join(runDir, EFFECTS_ISSUE);
    mkdirSync(issueDir, { recursive: true });
    writeFileSync(join(issueDir, "ac-checklist.json"), JSON.stringify({ all_verified: true }));
    writeFileSync(join(issueDir, "review-verdict.json"), JSON.stringify({ signal: "pass", findings: [] }));
  }
  return { root, runId, runDir };
}

const ledgerLines = (runDir) => {
  const p = join(runDir, "declared-effects.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
};

const effArgs = (runDir, extra = []) =>
  ["merge-gate", "--pr", String(EFFECTS_PR), "--issue", EFFECTS_ISSUE, "--run-dir", runDir, "--level", "L3", "--repo", REPO, "--json", "--squash", ...extra];

test("FAFF-383 integration: a covering declare + merge-gate execute → the observe pair lands → effects check reports any_escape:false", () => {
  const { root, runId, runDir } = seedEffectsRunDir("merge-ok");
  const declared = runCli(
    ["effects", "declare", "--root", root, "--run", runId, "--issue", EFFECTS_ISSUE, "--step", "merge"],
    { input: JSON.stringify({ kind: "merge", target: `pr:${EFFECTS_PR}` }) },
  );
  assert.equal(declared.code, 0, "the graft-side declare must succeed before the merge is attempted");

  const { env, sentinel } = stubGhEnv({ headRefName: "faff-9-x" });
  const { code, stdout, stderr } = runCli(effArgs(runDir), { env });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(existsSync(sentinel), true, "the merge must actually have been attempted");
  assert.doesNotMatch(stderr, /no covering declaration/, "a covered observe must never warn");

  const lines = ledgerLines(runDir);
  assert.equal(lines.length, 2, "exactly one declare + one observe, no extras");
  assert.equal(lines[0].kind_of_entry, "declare");
  assert.equal(lines[1].kind_of_entry, "observe");
  assert.deepEqual(lines[1].effect, { kind: "merge", target: `pr:${EFFECTS_PR}`, reversible: true });

  const check = runCli(["effects", "check", "--root", root, "--run", runId, "--json"]);
  assert.equal(check.code, 0);
  const j = JSON.parse(check.stdout);
  assert.equal(j.any_escape, false, "a covered observe must never read as an escape");
  assert.equal(j.escapes.length, 0);
});

test("FAFF-383 integration: NO declare + merge-gate execute → the merge still lands, one stderr warning fires, and effects check reports the escape", () => {
  const { root, runId, runDir } = seedEffectsRunDir("merge-ok"); // no declare written at all

  const { env, sentinel } = stubGhEnv({ headRefName: "faff-9-x" });
  const { code, stdout, stderr } = runCli(effArgs(runDir), { env });
  assert.equal(code, 0, "an uncovered observe must WARN, never refuse the merge");
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(existsSync(sentinel), true);
  assert.match(stderr, /observed merge pr:9 with no covering declaration/, "the warning names the exact effect and the remedy");
  assert.match(stderr, /declare it at graft Step 10/);

  const lines = ledgerLines(runDir);
  assert.equal(lines.length, 1, "an observe with nothing declared is still recorded — detection needs the record to exist");
  assert.equal(lines[0].kind_of_entry, "observe");

  const check = runCli(["effects", "check", "--root", root, "--run", runId, "--json"]);
  const j = JSON.parse(check.stdout);
  assert.equal(j.any_escape, true);
  assert.equal(j.escapes.length, 1);
  assert.equal(j.escapes[0].issue, EFFECTS_ISSUE);
  assert.equal(j.escapes[0].step, "merge");
  assert.deepEqual(j.escapes[0].escaped, [{ kind: "merge", target: `pr:${EFFECTS_PR}`, reversible: true }]);
});

test("FAFF-383 integration: a covering declare including branch-delete + --merge-args \"--squash --delete-branch\" → both merge and branch-delete observed, check clean", () => {
  const { root, runId, runDir } = seedEffectsRunDir("merge-ok");
  runCli(
    ["effects", "declare", "--root", root, "--run", runId, "--issue", EFFECTS_ISSUE, "--step", "merge"],
    { input: JSON.stringify([{ kind: "merge", target: `pr:${EFFECTS_PR}` }, { kind: "branch-delete", target: "faff-9-x" }]) },
  );

  const { env } = stubGhEnv({ headRefName: "faff-9-x" });
  const { code } = runCli(effArgs(runDir, ["--merge-args", "--squash --delete-branch"]), { env });
  assert.equal(code, 0);

  const lines = ledgerLines(runDir);
  const observes = lines.filter((l) => l.kind_of_entry === "observe");
  assert.equal(observes.length, 2, "both the merge and the branch-delete legs are observed");
  assert.ok(observes.some((o) => o.effect.kind === "merge" && o.effect.target === `pr:${EFFECTS_PR}`));
  assert.ok(observes.some((o) => o.effect.kind === "branch-delete" && o.effect.target === "faff-9-x"));

  const check = runCli(["effects", "check", "--root", root, "--run", runId, "--json"]);
  assert.equal(JSON.parse(check.stdout).any_escape, false);
});

test("FAFF-383: --merge-args without --delete-branch never observes a branch-delete leg, even with a covering declare", () => {
  const { root, runId, runDir } = seedEffectsRunDir("merge-ok");
  runCli(
    ["effects", "declare", "--root", root, "--run", runId, "--issue", EFFECTS_ISSUE, "--step", "merge"],
    { input: JSON.stringify({ kind: "merge", target: `pr:${EFFECTS_PR}` }) },
  );
  const { env } = stubGhEnv({ headRefName: "faff-9-x" });
  runCli(effArgs(runDir, ["--merge-args", "--squash"]), { env });
  const lines = ledgerLines(runDir);
  assert.equal(lines.filter((l) => l.kind_of_entry === "observe").length, 1, "no --delete-branch flag => no branch-delete observe, regardless of what was declared");
});

test("FAFF-383: --check-only writes ZERO ledger entries (the short-circuit precedes any observe)", () => {
  const { runDir } = seedEffectsRunDir("merge-ok");
  const { env } = stubGhEnv();
  runCli(effArgs(runDir, ["--check-only"]), { env });
  assert.equal(ledgerLines(runDir).length, 0);
});

test("FAFF-383: a refuse verdict writes ZERO ledger entries", () => {
  const { runDir } = seedEffectsRunDir("refuse");
  const { env } = stubGhEnv();
  runCli(effArgs(runDir), { env });
  assert.equal(ledgerLines(runDir).length, 0);
});

test("FAFF-383: the already-MERGED idempotent no-op writes ZERO ledger entries (this invocation performed nothing)", () => {
  const { runDir } = seedEffectsRunDir("merge-ok");
  const { env } = stubGhEnv({ prState: "MERGED" });
  const { code, stdout } = runCli(effArgs(runDir), { env });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).note, "already merged");
  assert.equal(ledgerLines(runDir).length, 0);
});
