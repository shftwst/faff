// FAFF-1052 — the additive-only regression floor named in the spec's DONE list (§8, "From
// WHY / principles"): `spec-review-convergence.js`, `spec-review-churn.js`, the `round-<n>.json`
// reader, and the `spec-review-verdict` contract fixture stay BYTE-UNCHANGED by this fix. The
// whole design rests on "the reviewer-blind detectors are untouched — this is entirely about
// which round range is fed to them and whether a pin exists, not how they score" (§1, principle
// "Additive only"); this test makes that claim mechanically checkable rather than a matter of
// trust, the same class of gap FAFF-1051 named for a golden's provenance.
//
// The round-<n>.json READER lives inside spec-review-convergence.js (`roundFilesInDir`), so
// hashing that one file covers both the reader and the detector it backs; spec-review-churn.js
// is the sibling detector; contract-defs.js is where the `spec-review-verdict` schema (and every
// other faff-contract schema) is defined.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

const PROTECTED_FILES = [
  "plugin/skills/faff/bin/lib/spec-review-convergence.js",
  "plugin/skills/faff/bin/lib/spec-review-churn.js",
  "plugin/skills/faff/bin/lib/contract-defs.js",
];

function resolveBase() {
  // Prefer the fetched remote default, then a local main, matching the fail-loud-base-resolution
  // pattern the rest of the repo's diff-hash machinery uses (remote-diff-base.sh). A test file has
  // no network access to fetch — it only tries refs that are ALREADY locally resolvable, and skips
  // the assertion entirely (never a false failure) when none is.
  for (const ref of ["origin/main", "main"]) {
    try {
      return execFileSync("git", ["rev-parse", "--verify", ref], { cwd: REPO, stdio: "pipe" }).toString().trim();
    } catch { /* try the next candidate */ }
  }
  return null;
}

test("additive-only invariant: convergence/churn detectors + the spec-review-verdict contract fixture are byte-unchanged by this PR", () => {
  const base = resolveBase();
  if (!base) {
    // No resolvable base ref locally (e.g. an isolated worktree with no origin remote configured
    // and no local main) — this is an environment limitation, not evidence either way. Skipping
    // is the same posture FAFF-1051's golden-provenance test takes on a shallow clone: assert what
    // is provable, never manufacture a false pass OR a false fail from missing git plumbing.
    return;
  }
  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", "HEAD", base], { cwd: REPO, stdio: "pipe" }).toString().trim();
  } catch {
    return; // base ref present but no common ancestor resolvable locally — skip, don't false-fail
  }
  for (const file of PROTECTED_FILES) {
    let diff;
    try {
      diff = execFileSync("git", ["diff", `${mergeBase}...HEAD`, "--", file], { cwd: REPO, stdio: "pipe" }).toString();
    } catch (e) {
      assert.fail(`git diff failed for ${file}: ${e && e.message}`);
    }
    assert.equal(diff, "", `${file} must be byte-unchanged by FAFF-1052 (additive-only principle) — got a non-empty diff against the merge-base`);
  }
});
