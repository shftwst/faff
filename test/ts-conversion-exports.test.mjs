// FAFF-1432 — the TypeScript conversions of land, spec-commit and gates-progress keep each module's
// export object: the same names in the same order as the hand-written JavaScript on main before the
// conversion. The baseline is fixed here, so a later change that drops or reorders an export fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const BASELINE = {
  "../plugin/skills/faff/bin/lib/land.js": [
    "DEADLINE_MS", "NO_CI_SETTLE_MS", "RERUN_SETTLE_MS", "LAND_SPEC",
    "initialState", "rerunBudgetRemains", "decide", "routeTriage", "failingRunIds", "statePath", "runLand", "cmdLand", "landSelftest",
  ],
  "../plugin/skills/faff/bin/lib/spec-commit.js": [
    "ISSUE_RE", "SPEC_NAME_RE", "collapseTitle", "slugify", "commitSubject", "matchingSpecNames", "builderBytes", "isInside",
    "runSpecCommit", "runSpecVerify", "defaultDeps", "recordPath", "cmdSpec", "specSelftest",
  ],
  "../plugin/skills/faff/bin/lib/gates-progress.js": [
    "DEFAULT_BUDGET_SECS", "GatesProgressError", "MAX_BUDGET_SECS", "MAX_GRACE_SECS", "PROGRESS_FILE", "PROGRESS_SCHEMA", "STALE_AFTER_MS",
    "checkProgressDir", "clearProgress", "contentIds", "ensureProgressIgnored", "graceSecs", "isGitWorkTree", "judgeProgress", "knownSecrets",
    "parseStatusPaths", "planFingerprint", "progressPath", "readProgress", "redactDetail", "treeFingerprint", "validProgress", "writeProgress",
  ],
};

for (const [mod, names] of Object.entries(BASELINE)) {
  test(`${mod.split("/").pop()} exports the same names, in order, as before its conversion`, () => {
    assert.deepEqual(Object.keys(require(mod)), names);
  });
}
