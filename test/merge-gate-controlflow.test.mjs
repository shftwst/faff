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
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
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
      view)   printf '{"headRefOid":"%s","state":"%s","url":"https://example.test/pr/1"}' "$STUB_SHA" "$STUB_PR_STATE"; exit 0 ;;
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
function stubGhEnv({ prState = "OPEN", ci = "green" } = {}) {
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

const baseArgs = (runDir, extra = []) =>
  ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--level", "L3", "--repo", REPO, "--json", ...extra];

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
