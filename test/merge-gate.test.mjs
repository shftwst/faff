// FAFF-350 — merge-gate + branch-protection-check CLI surface.
// Exercises the deterministic seam (exit codes / --selftest tables / arg validation) of the
// new mechanical merge floor. The impure gh/git path (observe CI, execute merge) is covered by
// the spec's integration smoke test, not here — parity with container-check's pure-only tests.
// Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli, repoRoot } from "./helpers/run-cli.mjs";

// --- pure --selftest tables (no network) ---
test("merge-gate --selftest: the pure cores pass (decideFloor + classify + parseMergeArgs + classifyPostMerge FAFF-365)", () => {
  const { code } = runCli(["merge-gate", "--selftest"]);
  assert.equal(code, 0);
});

test("branch-protection-check --selftest: the pure classifier passes", () => {
  const { code } = runCli(["branch-protection-check", "--selftest"]);
  assert.equal(code, 0);
});

test("github-auth-check --selftest: the pure classifier passes (FAFF-728)", () => {
  const { code } = runCli(["github-auth-check", "--selftest"]);
  assert.equal(code, 0);
});

test("classifyGithubAuth: the closed classification (FAFF-728)", async () => {
  const { classifyGithubAuth } = await import("../plugin/skills/faff/bin/lib/merge-gate.js");
  // authed — exit 0 + parseable .login
  const authed = classifyGithubAuth({ error: null, status: 0, stdout: JSON.stringify({ login: "octocat" }), stderr: "" });
  assert.equal(authed.status, "authed");
  assert.equal(authed.login, "octocat");
  // auth-failed — the API rejected the credential (keys on the HTTP status)
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" }).status, "auth-failed");
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "HTTP 403: Forbidden" }).status, "auth-failed");
  // indeterminate — gh missing / non-auth error / unparseable body all fail OPEN, never a re-auth claim
  assert.equal(classifyGithubAuth({ error: new Error("spawnSync gh ENOENT"), status: null, stdout: "", stderr: "" }).status, "indeterminate");
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: server error (HTTP 500)" }).status, "indeterminate");
  assert.equal(classifyGithubAuth({ error: null, status: 0, stdout: "not json", stderr: "" }).status, "indeterminate");
  // fail-open boundary: a non-auth fault mentioning "authentication" must NOT become auth-failed
  // (a proxy 407, a transient auth-service 5xx) — the spec anti-pattern; a real 401 still classifies.
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: request failed: 407 Proxy Authentication Required" }).status, "indeterminate");
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: authentication service temporarily unavailable (HTTP 500)" }).status, "indeterminate");
  assert.equal(classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Requires authentication (HTTP 401)" }).status, "auth-failed");
  // token-safety: an auth-failed basis never carries the token — only the gh stderr line (no token in it)
  const badTok = classifyGithubAuth({ error: null, status: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" });
  assert.ok(!/ghp_|github_pat_/.test(badTok.basis));
});

test("contract integrity-floor --selftest: the pure floor decision table passes", () => {
  const { code } = runCli(["contract", "integrity-floor", "--selftest"]);
  assert.equal(code, 0);
});

// --- integrity-floor contract: the born-verifiable floor decisions (pure, via stdin) ---
const floorBase = { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" };
const floorCase = (over) => JSON.stringify({ ...floorBase, ...over });
const floorCases = [
  ["all-green → merge-ok (exit 0)", {}, 0],
  ["stale green (head-sha mismatch) → refuse", { head_sha_matches: false }, 1],
  ["no-ci-coverage default → refuse (not a vacuous pass)", { ci_state: "no-ci-coverage" }, 1],
  ["no-ci-coverage + allow → merge-ok", { ci_state: "no-ci-coverage", no_ci_policy: "allow" }, 0],
  ["ci-red → refuse", { ci_state: "ci-red" }, 1],
  ["indeterminate CI → refuse (fail-closed)", { ci_state: "indeterminate" }, 1],
  ["absent review verdict → refuse", { review_verdict: "missing" }, 1],
  ["unavailable review verdict → refuse, never merge-ok (FAFF-405)", { review_verdict: "unavailable" }, 1],
  ["L4 holdout missing → refuse (fail-closed)", { level: "L4", holdout: "missing", integrity: "asserted" }, 1],
  // FAFF-690 (F2): an L4 floor now needs an explicit integrity leg to merge — absent, it defaults
  // fail-closed to unasserted-refuse and blocks (see the l4-integrity-absent-refuses fixture).
  ["L4 holdout meets-spec + integrity asserted → merge-ok", { level: "L4", holdout: "meets-spec", integrity: "asserted" }, 0],
  ["L4 holdout meets-spec but integrity absent → refuse (F2 fail-closed default)", { level: "L4", holdout: "meets-spec" }, 1],
  ["integrity violated at L3 → refuse (leg is live, not dead code)", { integrity: "violated" }, 1],
  ["bad ci_state enum → fail-loud (exit 2, never a pass)", { ci_state: "greenish" }, 2],
];
for (const [label, over, want] of floorCases) {
  test(`integrity-floor: ${label}`, () => {
    const { code } = runCli(["contract", "integrity-floor"], { input: floorCase(over) });
    assert.equal(code, want);
  });
}

// --- merge-gate arg validation (fail-loud before any gh call) ---
test("merge-gate: missing required flags → exit 2", () => {
  const { code } = runCli(["merge-gate", "--pr", "1"]);
  assert.equal(code, 2);
});

test("merge-gate: an unrecognised --merge-args token → exit 2 (no untrusted free-text reaches the shell)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--merge-args", "--squash; rm -rf /"]);
  assert.equal(code, 2);
  assert.match(stderr, /unrecognised --merge-args/);
});

test("merge-gate: a bad --level → exit 2", () => {
  const { code } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L9"]);
  assert.equal(code, 2);
});

// --- FAFF-630: --execute is documented ([--execute|--check-only] in the usage string) but was
// missing from MERGE_GATE_SPEC, so the fail-closed FAFF-576 parser rejected it as unknown-flag.
// Paired with a deliberately-invalid --level so the run hits a KNOWN, network-independent
// exit-2 path (the pre-existing bad-level check) rather than falling through to a real `gh`
// call — a bare --pr/--issue/--run-dir run would reach live PR-observation network I/O, whose
// exit code depends on ambient `gh` auth/repo state (this is exactly what made the flag-only
// version of this test pass locally against an authenticated gh but fail in CI, where PR #1's
// real state/reachability differs — never assert on that path here).
test("merge-gate: --execute is not rejected as unknown-flag — parsing proceeds past argv to the next (known, non-network) validation step (FAFF-630)", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "faff-merge-gate-execute-"));
  try {
    const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", tmp, "--level", "L9", "--execute"]);
    assert.equal(code, 2);
    assert.doesNotMatch(stderr, /unknown[- ]flag/);
    assert.doesNotMatch(stderr, /unknown flag --execute/);
    assert.match(stderr, /--level/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("merge-gate: --execute --check-only together → exit 2 naming the mutual exclusion (FAFF-630)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--execute", "--check-only"]);
  assert.equal(code, 2);
  assert.match(stderr, /--execute and --check-only are mutually exclusive/);
});

// --- FAFF-690 (F1): the trust root for the autonomy level moved from the LIVE, build-lane-writable
// run-ledger.json to the HEAD-SHA-PINNED committed anchor. The two old "forged-ledger-level" tests
// here (FAFF-325/FAFF-424: a forged live run-ledger.json level, guarded only by the --level mismatch
// check) are SUPERSEDED — merge-gate no longer reads the live ledger for level at all, so a forged
// live level is simply ignored, and the mismatch guard now compares --level against the committed
// ANCHOR. Exercising that requires the observed PR head sha (a `gh pr view` call) and a committed
// anchor at it, so the anchor-sourced level + mismatch + anchor-missing/-malformed regression
// coverage now lives in the stubbed-gh + committed-anchor harness of
// test/merge-gate-controlflow.test.mjs (the FAFF-690 block), where it can be driven network-free.

// --- FAFF-375: --admin is off the allowlist; the human-only flags are fenced on a real TTY ---
// runCli spawns a child with piped stdio (non-TTY by construction), so these exercise the exact
// autonomous-lane refusal; the fence returns before any gh call, so no network is reached.
test("merge-gate: --merge-args \"--admin\" → exit 2 naming the rejected token (FAFF-375)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--merge-args", "--admin"]);
  assert.equal(code, 2);
  assert.match(stderr, /unrecognised --merge-args/);
  assert.match(stderr, /--admin/);
});

test("merge-gate: non-TTY --interactive --human-override → exit 2 naming the TTY fence (FAFF-375)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--interactive", "--human-override"]);
  assert.equal(code, 2);
  assert.match(stderr, /--human-override is human-only/);
  assert.match(stderr, /real terminal/);
});

test("merge-gate: non-TTY --interactive --allow-no-ci → exit 2 naming the TTY fence (FAFF-375)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--interactive", "--allow-no-ci"]);
  assert.equal(code, 2);
  assert.match(stderr, /--allow-no-ci is human-only/);
});

// --- FAFF-912: --accept-review-unavailable — the narrow, audited outage-accept, CLI arg surface ---
// runCli spawns a child with piped stdio (non-TTY by construction), so these exercise the exact
// fence refusal before any gh call — no network, no mocking.
test("merge-gate: --accept-review-unavailable is accepted by MERGE_GATE_SPEC (not rejected as unknown-flag)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L9", "--accept-review-unavailable"]);
  // hits the pre-existing bad-level check (exit 2) — proves argv parsing proceeded PAST
  // --accept-review-unavailable rather than rejecting it as an unrecognised flag.
  assert.equal(code, 2);
  assert.doesNotMatch(stderr, /unknown[- ]flag/);
  assert.match(stderr, /--level/);
});

test("merge-gate: non-TTY --interactive --accept-review-unavailable → exit 2 naming the TTY fence (FAFF-912)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--interactive", "--accept-review-unavailable", "--override-reason", "outage; clean graft"]);
  assert.equal(code, 2);
  assert.match(stderr, /--accept-review-unavailable is human-only/);
  assert.match(stderr, /real terminal/);
});

test("merge-gate: --accept-review-unavailable without --interactive → exit 2 (fenced)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--accept-review-unavailable", "--override-reason", "outage; clean graft"]);
  assert.equal(code, 2);
  assert.match(stderr, /--accept-review-unavailable requires --interactive/);
});

test("merge-gate: --accept-review-unavailable with an empty --override-reason → exit 2 naming the reason fence", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--interactive", "--accept-review-unavailable"]);
  assert.equal(code, 2);
  assert.match(stderr, /--accept-review-unavailable requires --override-reason/);
});

test("merge-gate: --human-override + --accept-review-unavailable together → exit 2 naming the mutual exclusion (FAFF-912)", () => {
  const { code, stderr } = runCli(["merge-gate", "--pr", "1", "--issue", "FAFF-1", "--run-dir", "/tmp/x", "--level", "L3", "--interactive", "--human-override", "--accept-review-unavailable", "--override-reason", "x"]);
  assert.equal(code, 2);
  assert.match(stderr, /mutually exclusive/);
});

// --- the sole-sanctioned-path property: graft + default ship carry no raw `gh pr merge` command ---
test("graft Step 10 + default ship producer contain no direct `gh pr merge` command (routes through merge-gate)", () => {
  const files = [
    path.join(repoRoot, "plugin", "skills", "faff-graft", "SKILL.md"),
    path.join(repoRoot, "plugin", "skills", "faffter-noon-ship", "SKILL.md"),
  ];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    // Ban the RUNNABLE form — `gh pr merge` with flags or a PR arg (e.g. the old step-3
    // `gh pr merge --squash --delete-branch`). Bare descriptive mentions ("no longer calls
    // `gh pr merge` directly") are fine; only an executable raw-merge command is the regression.
    const m = text.match(/gh pr merge\s+(--|<|\$|#|\d)/);
    if (m) assert.fail(`${path.basename(f)} still presents a runnable raw merge command: "${m[0]}…"`);
  }
});

// --- FAFF-384: the merge-floor cage-promise resolver that ARMS the spawner-attestation ratchet ---
// laneBoundaryPromisesCage reads <run-dir>/lane-boundary.json and decides whether readHoldout must require
// spawner attestation. Fail-safe toward the strong direction: absent → legacy (OFF); a present-but-broken
// promise → ARM (ON); a valid cage-shaped promise → ARM; a valid non-cage (rung-0) declaration → OFF.
import { laneBoundaryPromisesCage } from "../plugin/skills/faff/bin/lib/merge-gate.js";

function runDirWith(laneBoundary) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "faff-lb-"));
  if (laneBoundary !== undefined) writeFileSync(path.join(dir, "lane-boundary.json"), laneBoundary);
  return dir;
}

test("cage promise: absent lane-boundary.json → NOT armed (byte-for-byte legacy)", () => {
  const dir = runDirWith(undefined);
  assert.equal(laneBoundaryPromisesCage(dir), false);
  rmSync(dir, { recursive: true, force: true });
});

test("cage promise: valid cage-shaped intent (evaluator/own/repo:absent) → ARMED", () => {
  const dir = runDirWith(JSON.stringify({ version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: true }));
  assert.equal(laneBoundaryPromisesCage(dir), true);
  rmSync(dir, { recursive: true, force: true });
});

test("cage promise: valid NON-cage rung-0 declaration (container shared / repo present) → NOT armed", () => {
  const dir = runDirWith(JSON.stringify({ version: 1, lane: "evaluator", container: "shared", host: "local", accesses: { repo: "present", host_socket: "present" }, integrity_signal: false }));
  assert.equal(laneBoundaryPromisesCage(dir), false);
  rmSync(dir, { recursive: true, force: true });
});

test("cage promise: present-but-malformed intent → ARMED (a broken promise never relaxes to self-attestation)", () => {
  const dir = runDirWith("{not valid json");
  assert.equal(laneBoundaryPromisesCage(dir), true);
  rmSync(dir, { recursive: true, force: true });
});

test("cage promise: present but out-of-enum (violations) → ARMED (never relax on an invalid promise)", () => {
  const dir = runDirWith(JSON.stringify({ version: 1, lane: "builder", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
  assert.equal(laneBoundaryPromisesCage(dir), true);
  rmSync(dir, { recursive: true, force: true });
});

test("cage promise: no run dir → NOT armed", () => {
  assert.equal(laneBoundaryPromisesCage(""), false);
  assert.equal(laneBoundaryPromisesCage(null), false);
});
