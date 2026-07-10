// FAFF-350 — merge-gate + branch-protection-check CLI surface.
// Exercises the deterministic seam (exit codes / --selftest tables / arg validation) of the
// new mechanical merge floor. The impure gh/git path (observe CI, execute merge) is covered by
// the spec's integration smoke test, not here — parity with container-check's pure-only tests.
// Per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  ["L4 holdout missing → refuse (fail-closed)", { level: "L4", holdout: "missing" }, 1],
  ["L4 holdout meets-spec → merge-ok", { level: "L4", holdout: "meets-spec" }, 0],
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
