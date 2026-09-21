// FAFF-1052 — the additive-only regression floor named in the spec's DONE list (§8, "From
// WHY / principles"): `spec-review-convergence.js`, `spec-review-churn.js`, the `round-<n>.json`
// reader, and the `spec-review-verdict` contract fixture stayed BYTE-UNCHANGED by FAFF-1052's OWN
// fix. The whole design rested on "the reviewer-blind detectors are untouched — this is entirely
// about which round range is fed to them and whether a pin exists, not how they score" (§1,
// principle "Additive only"); this test makes that claim mechanically checkable rather than a
// matter of trust, the same class of gap FAFF-1051 named for a golden's provenance.
//
// The round-<n>.json READER lives inside spec-review-convergence.js (`roundFilesInDir`), so
// hashing that one file covers both the reader and the detector it backs; spec-review-churn.js
// is the sibling detector; contract-defs.js is where the `spec-review-verdict` schema (and every
// other faff-contract schema — INCLUDING unrelated ones like ci-triage) is defined.
//
// PINNED, not dynamic (FAFF-1050 fix): this asserts a HISTORICAL fact about FAFF-1052's own merge
// diff, not a standing constraint on every future PR. The original version diffed `mergeBase...HEAD`
// against a freshly-resolved "origin/main"/"main" — which re-targets itself at whatever branch is
// currently under test, so it silently became "no PR may ever touch contract-defs.js again" (a file
// shared by every contract, not just spec-review-verdict) the moment any *other* commit changed one
// of these files. Pinning to FAFF-1052's own merge commit (af1a6e134bbc106d0a4c81acf3f24f0afc056a5a)
// and its parent (6647f57ce7635566b5bcd6f26371d2ce25808de8) keeps the original claim — proven true
// once, permanently — without blocking unrelated future work on a shared file. See FAFF-1050.
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

const FAFF_1052_MERGE_PARENT = "6647f57ce7635566b5bcd6f26371d2ce25808de8";
const FAFF_1052_MERGE_COMMIT = "af1a6e134bbc106d0a4c81acf3f24f0afc056a5a";

function commitsResolvable() {
  // Both pinned shas are ordinary ancestors of every branch built off current main, so they resolve
  // in any normal checkout. A genuinely shallow/partial clone that lacks them is an environment
  // limitation, not evidence either way — skip rather than manufacture a false pass or false fail,
  // the same posture FAFF-1051's golden-provenance test takes on a shallow clone.
  for (const sha of [FAFF_1052_MERGE_PARENT, FAFF_1052_MERGE_COMMIT]) {
    try {
      execFileSync("git", ["cat-file", "-e", sha], { cwd: REPO, stdio: "pipe" });
    } catch {
      return false;
    }
  }
  return true;
}

test("additive-only invariant: convergence/churn detectors + the spec-review-verdict contract fixture were byte-unchanged by FAFF-1052's own merge", () => {
  if (!commitsResolvable()) return;
  for (const file of PROTECTED_FILES) {
    let diff;
    try {
      diff = execFileSync("git", ["diff", `${FAFF_1052_MERGE_PARENT}..${FAFF_1052_MERGE_COMMIT}`, "--", file], { cwd: REPO, stdio: "pipe" }).toString();
    } catch (e) {
      assert.fail(`git diff failed for ${file}: ${e && e.message}`);
    }
    assert.equal(diff, "", `${file} must have been byte-unchanged by FAFF-1052's own merge (additive-only principle) — got a non-empty diff between the pinned parent and merge commit`);
  }
});
