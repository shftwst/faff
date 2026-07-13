// FAFF-152 — repeat-park scripted-driver test (deterministic — test/, not eval/).
//
// faff-tidy's repeat-park demotion (>=3 same-root-cause parks in a rolling 21-day
// window -> demote Todo->Backlog + tag `faff-repeat-parked`) is load-bearing structural-
// diagnostic logic. Its *counting* half is purely deterministic, so it belongs in a
// scripted `test/` case — NOT in `eval/` (the per-park root-cause CLASSIFICATION is the
// LLM-judgement half, assigned by the routing_adaptor at park time and read back here,
// never re-derived; see the FAFF-152 spec OUT OF SCOPE).
//
// The non-tautological core: each case drives the REAL `faff park-history` CLI seam
// (added in this ticket) via ctx.cli over a seeded `.faff/runs/*/summary.md` tree and
// asserts the PARSED computation with expectCliResult — exactly as the FAFF-94 cases
// assert `faff next` / `faff eligible`. A test that hand-authored BOTH the parks AND the
// "repeat-parked" bucket would assert its own input (the tautology the harness header
// forbids); here the bucket + demote/tag mutations are proof-of-mechanism only — the
// seam's `repeat_parked` output is the load-bearing assertion.
//
// `--now` is injected (no ambient clock) so the 21-day window is deterministic, the
// same way seed-repo neutralises git author/committer dates.

import { test } from "node:test";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill, scriptedDriver } from "./helpers/skill-harness.mjs";
import {
  expectBucket,
  expectNoBucket,
  expectMutation,
  expectNoMutation,
  expectCliResult,
  expectSeamOrder,
} from "./helpers/decision-assert.mjs";

// The fixed window end every case drives the seam against. All park timestamps below
// are positioned relative to this instant, never relative to wall-clock now.
const FIXED_NOW = "2026-06-16T00:00:00Z";

// A minimal tracker carrying just the candidate issue: the repeat-park signal is
// computed off the LOCAL .faff/runs summaries (the CLI seam), so the tracker is only
// the demote/tag target, not the signal source.
function trackerWith(issueId) {
  return loadFixture({
    version: 1,
    labels: [{ name: "faff-repeat-parked", color: "#e8a33d" }],
    issues: [
      {
        id: issueId,
        title: "repeat-park candidate",
        state: "Todo",
        stateCategory: "unstarted",
        labels: [],
      },
    ],
    comments: [],
  });
}

// Build a run record (summary + a one-park faff-parks block) for the seed-repo `runs[]`.
function parkRun(runId, park) {
  return { runId, summary: `# run ${runId}\nDigest prose coexists with the parks block.\n`, parks_meta: [park] };
}

test("FLAG — 3 same-class parks in 21d: the real seam flags repeat_parked, demote+tag follow", (t) => {
  // ISS-RP parked 3x with root_cause_class "punt-not-closed", all within 21d of --now.
  const tracker = trackerWith("ISS-RP");
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    runs: [
      parkRun("2026-06-01-beep-boop-09-00-00", { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-01T09:00:00Z" }),
      parkRun("2026-06-08-beep-boop-09-00-00", { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-08T09:00:00Z" }),
      parkRun("2026-06-15-beep-boop-09-00-00", { issue_id: "ISS-RP", root_cause_class: "punt-not-closed", timestamp: "2026-06-15T09:00:00Z" }),
    ],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { cli: ["park-history", "--issue", "ISS-RP", "--now", FIXED_NOW] }, // REAL -> repeat_parked:["ISS-RP"]
      { verdict: { issue: "ISS-RP", token: "repeat-parked", source: "faff park-history" } },
      { bucket: { name: "repeat-parked", issues: ["ISS-RP"] } },
      { mutate: { op: "setStatus", issue: "ISS-RP", args: { status: "Backlog" } } },
      { mutate: { op: "addLabel", issue: "ISS-RP", args: { label: "faff-repeat-parked" } } },
      { render: { surface: "tidy-report" } },
    ]),
  });

  // --- real CLI computation (the non-tautological assertion) ---
  expectCliResult(rec, "park-history", { exit: 0, json: { repeat_parked: ["ISS-RP"] } });

  // --- proof-of-mechanism: the demote+tag the flag drives ---
  expectBucket(rec, "repeat-parked", ["ISS-RP"]);
  expectMutation(rec, { op: "setStatus", issue: "ISS-RP", args: { status: "Backlog" } });
  expectMutation(rec, { op: "addLabel", issue: "ISS-RP", args: { label: "faff-repeat-parked" } });

  // --- cross-seam ordering: the seam computation precedes the bucket it informed ---
  expectSeamOrder(rec, { kind: "cliCall", argvHead: "park-history" }, { kind: "bucket", name: "repeat-parked" });
});

test("UNDER — only 2 same-class parks: the real seam does NOT flag, no demote/tag", (t) => {
  // ISS-UNDER parked only twice (same class) in the window -> below the >=3 threshold.
  const tracker = trackerWith("ISS-UNDER");
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    runs: [
      parkRun("2026-06-08-beep-boop-09-00-00", { issue_id: "ISS-UNDER", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" }),
      parkRun("2026-06-15-beep-boop-09-00-00", { issue_id: "ISS-UNDER", root_cause_class: "gap", timestamp: "2026-06-15T09:00:00Z" }),
    ],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { cli: ["park-history", "--issue", "ISS-UNDER", "--now", FIXED_NOW] }, // REAL -> repeat_parked:[]
      { render: { surface: "tidy-report" } },
    ]),
  });

  expectCliResult(rec, "park-history", { exit: 0, json: { repeat_parked: [] } });
  expectNoBucket(rec, "repeat-parked");
  expectNoMutation(rec);
});

test("UNDER (window) — a 3rd same-class park dated >21d before --now is out of window", (t) => {
  // Same class three times, but the oldest is > 21 days before --now -> only 2 count.
  const tracker = trackerWith("ISS-WIN");
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    runs: [
      parkRun("2026-05-01-beep-boop-09-00-00", { issue_id: "ISS-WIN", root_cause_class: "cycle", timestamp: "2026-05-01T09:00:00Z" }), // > 21d before now
      parkRun("2026-06-08-beep-boop-09-00-00", { issue_id: "ISS-WIN", root_cause_class: "cycle", timestamp: "2026-06-08T09:00:00Z" }),
      parkRun("2026-06-15-beep-boop-09-00-00", { issue_id: "ISS-WIN", root_cause_class: "cycle", timestamp: "2026-06-15T09:00:00Z" }),
    ],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { cli: ["park-history", "--issue", "ISS-WIN", "--now", FIXED_NOW] }, // REAL -> repeat_parked:[]
      { render: { surface: "tidy-report" } },
    ]),
  });

  expectCliResult(rec, "park-history", { exit: 0, json: { repeat_parked: [] } });
  expectNoBucket(rec, "repeat-parked");
});

test("MIXED — 3 parks across 3 different classes: the real seam does NOT flag (per-class)", (t) => {
  // ISS-MIXED parked 3x in window but each a DIFFERENT class -> no class reaches 3.
  const tracker = trackerWith("ISS-MIXED");
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    runs: [
      parkRun("2026-06-01-beep-boop-09-00-00", { issue_id: "ISS-MIXED", root_cause_class: "punt-not-closed", timestamp: "2026-06-01T09:00:00Z" }),
      parkRun("2026-06-08-beep-boop-09-00-00", { issue_id: "ISS-MIXED", root_cause_class: "gap", timestamp: "2026-06-08T09:00:00Z" }),
      parkRun("2026-06-15-beep-boop-09-00-00", { issue_id: "ISS-MIXED", root_cause_class: "cycle", timestamp: "2026-06-15T09:00:00Z" }),
    ],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { cli: ["park-history", "--issue", "ISS-MIXED", "--now", FIXED_NOW] }, // REAL -> repeat_parked:[]
      { render: { surface: "tidy-report" } },
    ]),
  });

  expectCliResult(rec, "park-history", { exit: 0, json: { repeat_parked: [] } });
  expectNoBucket(rec, "repeat-parked");
});
