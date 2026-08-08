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
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, rmSync, existsSync, readFileSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
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
// FAFF-690: the stub also answers the Contents-API anchor read (`gh api …/contents/…?ref=<sha>
// --jq .content`) — resolveAnchorLevel's fallback path. With STUB_SHA a fake 40-hex sha, merge-gate's
// PRIMARY `git show <sha>:<anchorPath>` in repoRoot fails (no such object) and falls to this API, so
// every stubbed test resolves its level from STUB_ANCHOR_CONTENT (base64 of the committed ledger) or
// the fail-closed STUB_ANCHOR_MODE (missing→404 / unreadable→403). The money-fixture + smoke test use
// a REAL git repo instead, exercising the git-show primary path.
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
      *contents*)
        case "\${STUB_ANCHOR_MODE:-ok}" in
          missing)    printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1 ;;
          unreadable) printf 'gh: Resource not accessible by integration (HTTP 403)\\n' >&2; exit 1 ;;
          *)          printf '%s' "$STUB_ANCHOR_CONTENT"; exit 0 ;;
        esac ;;
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
// FAFF-690: `anchorLevel` (default "L3", agreeing with baseArgs' --level L3) is the level the
// committed anchor reports via the Contents-API fallback. `anchorMode` selects the fail-closed
// variants: "ok" serves anchorLevel; "missing"/"unreadable" make the API 404/403; "malformed"/
// "no-level" serve content that decodes to a bad/level-less ledger (→ anchor-malformed).
// The stub emits the REAL `gh api …/contents/…` response shape (a JSON object with a base64
// `content` field) — resolveAnchorLevel fetches the full object (no `--jq`) and extracts `.content`
// in JS. (An earlier version returned a pre-extracted JSON-quoted base64 string, which real
// `gh api` never produces — that fiction masked the raw-mode `--jq` bug the code now avoids.)
function anchorContentFor(anchorMode, anchorLevel) {
  let body = null;
  if (anchorMode === "malformed") body = "{not valid json";
  else if (anchorMode === "no-level") body = JSON.stringify({ run_id: "anchored" });
  else if (anchorMode === "ok" || anchorMode === undefined) body = JSON.stringify({ run_id: "anchored", level: anchorLevel });
  if (body === null) return "";
  return JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(body).toString("base64") });
}

function stubGhEnv({ prState = "OPEN", ci = "green", headRefName = "stub-head-branch", sha = SHA, anchorLevel = "L3", anchorMode = "ok" } = {}) {
  const stubDir = mkTmp("mg-gh-");
  const ghPath = join(stubDir, "gh");
  writeFileSync(ghPath, STUB_GH);
  chmodSync(ghPath, 0o755);
  const sentinel = join(stubDir, "merge-sentinel");
  const checkRuns = ci === "green" ? '[{"status":"completed","conclusion":"success"}]' : "[]";
  const status = ci === "green" ? '{"state":"success","count":1}' : '{"state":"pending","count":0}';
  // The API stub only distinguishes missing/unreadable from "serve content"; malformed/no-level ride
  // the "ok" mode but with content that decodes to a bad ledger.
  const stubAnchorMode = anchorMode === "missing" || anchorMode === "unreadable" ? anchorMode : "ok";
  const env = {
    ...process.env,
    PATH: `${stubDir}:${process.env.PATH}`,
    STUB_REPO: REPO,
    STUB_SHA: sha,
    STUB_PR_STATE: prState,
    STUB_HEAD_REF_NAME: headRefName,
    STUB_CHECK_RUNS: checkRuns,
    STUB_STATUS: status,
    STUB_MERGE_SENTINEL: sentinel,
    STUB_ANCHOR_MODE: stubAnchorMode,
    STUB_ANCHOR_CONTENT: anchorContentFor(anchorMode, anchorLevel),
  };
  return { env, sentinel };
}

// FAFF-690: a REAL git repo carrying the committed anchor at .faff/anchors/<basename(runDir)>/<issue>/
// run-ledger.json on HEAD — for tests that must exercise the PRIMARY `git show` read path (the
// money-fixture + smoke test). Returns { repoDir, sha }. Pass cwd:repoDir to runCli + sha to stubGhEnv.
function commitAnchorRepo(runDir, issue, ledgerBody) {
  const repoDir = mkTmp("mg-anchor-repo-");
  const g = (...a) => spawnSync("git", ["-C", repoDir, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t.t");
  g("config", "user.name", "t");
  const abs = join(repoDir, ".faff", "anchors", basename(runDir), issue, "run-ledger.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(ledgerBody));
  g("add", "-A");
  g("commit", "-qm", "commit anchor");
  return { repoDir, sha: g("rev-parse", "HEAD").stdout.trim() };
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

// --- FAFF-690 (F3): already-MERGED reconciliation proves the RETROSPECTIVE floor before writing
// success evidence. The old test asserted an unconditional merge-ok idempotent no-op regardless of
// floor — that minted `merge-ok` (and a merge-record) for a PR whose floor was never proven. It is
// SUPERSEDED: success evidence is now conditional on the re-derived AC/review/(at-L4)holdout/
// integrity floor; a failing floor refuses (exit 1) and writes NO merge-record.json. `gh pr merge`
// is never spawned either way (idempotency preserved). ---

const mergeRecordPath = (runDir) => join(runDir, ISSUE, "merge-record.json");

test("F3: already-MERGED on an UNSATISFIED retrospective floor → exit 1 refuse, blockers name the legs, ci_state not-observed-already-merged, NO merge-record, no gh pr merge", () => {
  const runDir = seedRunDir("refuse"); // AC + review absent → the retrospective floor cannot be proven
  const { env, sentinel } = stubGhEnv({ prState: "MERGED" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.merged, true, "the PR IS merged — but the floor is unproven");
  assert.equal(out.ci_state, "not-observed-already-merged", "the display sentinel proves CI was intentionally not observed");
  assert.ok(out.blockers.some((b) => /ACs not all verified/.test(b)));
  assert.equal(existsSync(mergeRecordPath(runDir)), false, "no success evidence for an unproven merge");
  assert.equal(existsSync(sentinel), false, "an already-merged PR must never re-spawn gh pr merge");
});

test("F3: already-MERGED on a SATISFIED retrospective floor → exit 0 merge-ok (note 'already merged', ci_state not-observed-already-merged), merge-record written, no gh pr merge", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ prState: "MERGED" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(out.note, "already merged");
  assert.equal(out.ci_state, "not-observed-already-merged");
  assert.equal(existsSync(mergeRecordPath(runDir)), true, "a proven already-merged floor writes success evidence");
  assert.equal(existsSync(sentinel), false, "no re-merge");
});

test("F3: already-MERGED at L4 with no fresh meets-spec holdout → exit 1 refuse (the retrospective floor re-derives the L4 holdout leg), NO merge-record", () => {
  const runDir = seedRunDir("merge-ok"); // AC + review pass; no holdout artifact under the run dir
  const { env, sentinel } = stubGhEnv({ prState: "MERGED", anchorLevel: "L4" });
  const { code, stdout } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.equal(out.ci_state, "not-observed-already-merged");
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)), "the retrospective floor re-derives the L4 holdout leg");
  assert.equal(existsSync(mergeRecordPath(runDir)), false);
  assert.equal(existsSync(sentinel), false);
});

test("F3: already-MERGED whose live CI would read RED but whose retrospective floor PASSES → still exit 0 (CI deliberately not observed — ci_state not-observed-already-merged, no CI-observation ran)", () => {
  const runDir = seedRunDir("merge-ok");
  // ci:"red" makes the stub's check-runs empty / status pending — a live observeCi() would refuse.
  // F3 must NOT consult CI on a merged PR, so this still merges-ok and the sentinel value proves it.
  const { env, sentinel } = stubGhEnv({ prState: "MERGED", ci: "red" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0, "CI is not re-observed on a merged PR — the forge gated it at merge time");
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.ci_state, "not-observed-already-merged", "a real observeCi run would have produced ci-red/indeterminate, never this sentinel");
  assert.notEqual(out.ci_state, "ci-red");
  assert.equal(existsSync(sentinel), false);
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

// --- FAFF-690 (F1): merge-gate derives the governing level from the HEAD-SHA-PINNED COMMITTED ANCHOR
// (not the live run-ledger.json), refusing a contradicting --level and failing closed on a missing/
// malformed anchor. These supersede the FAFF-424 "derive level from the live ledger" tests
// (writeLedger + expect-level-from-it): a live ledger is no longer a level source, so the fixtures
// seed the anchor via the Contents-API stub (anchorLevel/anchorMode). The money-fixture below drives
// the PRIMARY git-show path against a real committed anchor. ---

const argsNoLevel = (runDir, extra = []) =>
  ["merge-gate", "--pr", "1", "--issue", ISSUE, "--run-dir", runDir, "--repo", REPO, "--json", ...extra];

test("F1: L4 committed anchor + no --level + no holdout artifact → exit 1, refuse names the L4 holdout (level derived from the anchor, not defaulted)", () => {
  const runDir = seedRunDir("merge-ok"); // AC + review pass; only the (absent) holdout should block
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" });
  const { code, stdout } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)), "refuse must name the L4 holdout leg");
  assert.equal(existsSync(sentinel), false, "an anchor-derived L4 refuse must never reach gh pr merge");
});

test("F1: L4 anchor + --level L3 → exit 2, mismatch error names the anchor level L4 (the anchor governs), no gh merge", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" });
  const { code, stderr } = runCli(baseArgs(runDir), { env }); // baseArgs passes --level L3
  assert.equal(code, 2);
  assert.match(stderr, /--level "L3" contradicts the committed anchor level "L4"/);
  assert.equal(existsSync(sentinel), false, "a mismatch must be refused before any merge");
});

test("F1: L4 anchor + --level L4 (agreement) → proceeds at L4, refuse still names the L4 holdout (no coercion to L3)", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" });
  const { code, stdout } = runCli(argsNoLevel(runDir, ["--level", "L4"]), { env });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)));
  assert.equal(existsSync(sentinel), false);
});

test("F1: L3 anchor + --level L3 (clean merge-ok floor) → exit 0 merges (no regression on a clean L3-anchored run)", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L3" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "merge-ok");
  assert.equal(out.merged, true);
  assert.equal(existsSync(sentinel), true, "a clean L3-anchored run merges exactly as before");
});

test("F1: NO committed anchor at the head sha → exit 2 anchor-missing, NO live-ledger fallback, no merge", () => {
  const runDir = seedRunDir("merge-ok");
  // A forged live ledger claiming L1 is present but IGNORED — the trust root is the committed anchor.
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: "forged", level: "L1" }));
  const { env, sentinel } = stubGhEnv({ anchorMode: "missing" });
  const { code, stderr } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 2);
  assert.match(stderr, /no trusted committed anchor level/);
  assert.match(stderr, /anchor-missing/);
  assert.equal(existsSync(sentinel), false, "fail-closed: never a live-ledger fallback, never a merge");
});

test("F1: unreadable anchor blob (Contents-API 403 / narrow token) → exit 2 anchor-unreadable with the token remedy", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorMode: "unreadable" });
  const { code, stderr } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 2);
  assert.match(stderr, /anchor-unreadable/);
  assert.match(stderr, /contents:read/);
  assert.equal(existsSync(sentinel), false);
});

test("F1: malformed anchor blob (bad JSON / no usable level) → exit 2 anchor-malformed", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorMode: "malformed" });
  const { code, stderr } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 2);
  assert.match(stderr, /anchor-malformed/);
  assert.equal(existsSync(sentinel), false);
});

test("F1: anchor with no `level` field → exit 2 anchor-malformed (level not in FLOOR_LEVELS)", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorMode: "no-level" });
  const { code, stderr } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 2);
  assert.match(stderr, /anchor-malformed/);
  assert.equal(existsSync(sentinel), false);
});

// FAFF-690: honest coverage of the Contents-API FALLBACK SUCCESS path. STUB_SHA is a fake 40-hex sha
// absent from repoRoot's object store, so merge-gate's PRIMARY `git show <sha>:<anchorPath>` MISSES
// and the fallback is genuinely exercised against the real `gh api …/contents` response shape (a
// base64 `.content` field, no `--jq`). Reverting the code fix (re-adding `--jq .content`) makes
// ghJson's JSON.parse throw on the raw-mode bare base64 → anchor-missing → these tests FAIL.
test("F1 FALLBACK: git-show miss + clean L3 anchor via the Contents-API fallback → exit 0 MERGES (the pre-fix bug wrongly refused this as anchor-missing)", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L3" });
  const { code, stdout } = runCli(baseArgs(runDir), { env });
  assert.equal(code, 0, "a correctly-anchored pure-remote PR must MERGE via the fallback, not refuse anchor-missing");
  assert.equal(JSON.parse(stdout).verdict, "merge-ok");
  assert.equal(existsSync(sentinel), true, "the fallback resolved a usable L3 level and the merge fired");
});

test("F1 FALLBACK: git-show miss + L4 anchor via the Contents-API fallback → level resolves L4 (L4 holdout refuse), proving the fallback returns the real level not a default", () => {
  const runDir = seedRunDir("merge-ok"); // no holdout → the L4 holdout is the sole blocker
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" });
  const { code, stdout } = runCli(argsNoLevel(runDir), { env });
  assert.equal(code, 1);
  assert.ok(JSON.parse(stdout).blockers.some((b) => /L4 holdout/.test(b)), "the L4 level came THROUGH the fallback (not defaulted, not anchor-missing)");
  assert.equal(existsSync(sentinel), false);
});

// Adversarial review (FAFF-424, carried into F1): the mismatch check must fire even under
// --check-only — it is malformed input, not a floor verdict the short-circuit should paper over.
test("F1: L4 anchor + --level L3 + --check-only → still exit 2 mismatch (fires before the check-only short-circuit)", () => {
  const runDir = seedRunDir("merge-ok");
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" });
  const { code, stderr } = runCli(baseArgs(runDir, ["--check-only"]), { env });
  assert.equal(code, 2);
  assert.match(stderr, /--level "L3" contradicts the committed anchor level "L4"/);
  assert.equal(existsSync(sentinel), false);
});

// --- FAFF-690 (F1) MONEY FIXTURE: the coordinated-append attack, driven against the PRIMARY git-show
// read path (a REAL committed anchor at the observed head sha). The live run-ledger.json is rewritten
// L4→L1 AND a fresh valid ledger-write is appended to events.jsonl — merge-gate must resolve L4 from
// the committed anchor (ignoring both) and refuse on the L4 holdout, proving the append is inert. ---

test("F1 MONEY: committed anchor L4 + live ledger rewritten to L1 + a fresh valid chain append → resolves L4 from the anchor (git-show primary), refuses on the L4 holdout; the live tamper is inert", () => {
  const runDir = seedRunDir("merge-ok"); // AC + review pass; no holdout artifact → L4 holdout missing
  // The coordinated-append attack on the LIVE, build-lane-writable substrate:
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: "attacked", level: "L1" }));
  const prevHash = "0".repeat(64);
  appendFileSync(join(runDir, "events.jsonl"),
    JSON.stringify({ seq: 1, type: "ledger-write", prev: prevHash, data: { ledger_sha256: "f".repeat(64) } }) + "\n");
  // The committed anchor at the observed head sha records the TRUE level L4:
  const { repoDir, sha } = commitAnchorRepo(runDir, ISSUE, { run_id: "attacked", level: "L4" });
  const { env, sentinel } = stubGhEnv({ sha }); // gh pr view → the real committed sha; git-show resolves the blob
  const { code, stdout } = runCli(argsNoLevel(runDir), { env, cwd: repoDir });
  assert.equal(code, 1);
  const out = JSON.parse(stdout);
  assert.equal(out.verdict, "refuse");
  assert.ok(out.blockers.some((b) => /L4 holdout/.test(b)), "the L4 legs fire — the live L4→L1 rewrite + chain append had no effect");
  assert.equal(existsSync(sentinel), false, "the live tamper cannot downgrade the merge to an ungated L1");
});

// --- FAFF-690 (F1) SMOKE: the plumbing-connected happy path against the git-show primary — a clean
// L4-anchored run whose holdout leg is satisfied (the ONLY residual refuse on this host is the
// FAFF-325 integrity defence-in-depth, unasserted here), proving git-show resolves the committed blob. ---

test("F1 SMOKE: real committed L4 anchor + fresh meets-spec holdout → level resolves L4 via git-show, the holdout leg passes (only the FAFF-325 integrity leg blocks on this host)", () => {
  const runDir = seedRunDir("merge-ok");
  writeCheckpoint(runDir, new Date("2026-07-10T12:00:00.000Z").toISOString());
  writeHoldout(runDir, new Date("2026-07-10T13:00:00.000Z"));
  const { repoDir, sha } = commitAnchorRepo(runDir, ISSUE, { run_id: "clean", level: "L4" });
  const { env, sentinel } = stubGhEnv({ sha });
  const { code, stdout } = runCli(argsNoLevel(runDir), { env, cwd: repoDir });
  const out = JSON.parse(stdout);
  assert.ok(!out.blockers.some((b) => /L4 holdout/.test(b)), "git-show resolved L4 and the fresh meets-spec holdout satisfied the leg");
  assert.equal(code, 1);
  assert.ok(out.blockers.some((b) => /corrective-artifact integrity unasserted at L4/.test(b)), "only the FAFF-325 defence-in-depth leg remains");
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
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" }); // FAFF-690: L4 anchor to agree with --level L4
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
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" }); // FAFF-690: L4 anchor to agree with --level L4
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
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" }); // FAFF-690: L4 anchor to agree with --level L4
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
  const { env, sentinel } = stubGhEnv({ anchorLevel: "L4" }); // FAFF-690: L4 anchor to agree with --level L4
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
