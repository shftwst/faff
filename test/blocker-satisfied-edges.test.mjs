// FAFF-279 — read-side consequence of the "Satisfied blockers — edges to terminal
// work" gateway rule (plugin/skills/faff/SKILL.md Shared Rules), asserted at the
// real `faff next` seam, analogous to test/faff-tidy.test.mjs Scenario B.
//
// Scope (per the FAFF-279 spec, HOW / Failure modes): the harness scripts the
// tracker reads and hard-resolves the `--blocked` flag itself, so this proves
// the CLI SEAM — "an issue whose only blockedBy target is Done resolves
// --blocked=false, and faff next routes it to graft" — a proof-of-mechanism,
// NOT a proof that an LLM pass correctly computed the satisfied-edge filter
// from raw tracker state. That judgement is deferred to the live driver, same
// stance as faff-tidy's Scenario B.
//
// Fixture: reuses test/fixtures/tracker/sample.json (ISS-A blockedBy [ISS-B],
// ISS-B stateCategory "completed") — the exact Done-target blocker shape the
// spec calls out as reusable.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill, scriptedDriver } from "./helpers/skill-harness.mjs";
import { expectCliResult } from "./helpers/decision-assert.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "tracker", "sample.json");

test("only-Done-blocker resolves --blocked=false and faff next routes to graft (no tracker write)", (t) => {
  // ISS-A blockedBy [ISS-B]; ISS-B is Done (stateCategory "completed"). Per the
  // gateway's satisfied-blockers rule, an edge to a terminal-complete target is
  // not a live/open blocker, so an agent computing --blocked for ISS-A resolves
  // false — the edge is satisfied, not counted.
  const tracker = loadFixture(fixturePath);
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "ISS-A", location: "committed", body: "# spec\nconfidence: high\n" }],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-map",
    tracker,
    repo,
    driver: scriptedDriver([
      { read: { method: "getIssue", args: { id: "ISS-A" } } },
      // Resolve the blocker target's live status before computing --blocked
      // (gateway -> Satisfied blockers -- edges to terminal work).
      { read: { method: "getIssue", args: { id: "ISS-B" } } }, // Done -> satisfied edge
      // The satisfied edge is dropped, so no --blocked flag is passed: this is
      // the deterministic collapse point the spec's HOW section names (faff
      // next's existing --blocked flag; no new CLI verb, no bin/faff change).
      { cli: ["next", "--status", "todo", "--spec", "high"] }, // REAL -> graft
      { verdict: { issue: "ISS-A", token: "graft", source: "faff next" } },
    ]),
  });

  // --- real CLI computation: the only-Done-blocker issue is NOT --blocked ---
  expectCliResult(rec, "next", { exit: 0, json: { next: "graft" } });

  // --- both reads were served (the source issue + its Done-target blocker) ---
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["getIssue", "getIssue"]);
  assert.ok(rec.trackerReads.every((r) => r.resultCount === 1));

  // --- non-effects boundary: read-side only, no tracker write recorded ---
  assert.deepEqual(rec.mutations, []);

  // --- the frozen tracker model is untouched (ISS-B stays visible/Done, not
  //     hidden -- the rule nulls the edge's force, never the target node) ---
  assert.equal(tracker.getIssue("ISS-B").state, "Done");
  assert.equal(tracker.getIssue("ISS-B").stateCategory, "completed");
});

test("discriminating negative: an open (non-terminal) blocker still resolves --blocked=true", () => {
  // Same shape, but the blocker is NOT terminal-complete: the edge is live, so
  // --blocked=true is passed and faff next routes to "blocked", not "graft".
  // This proves the assertion above discriminates on live vs. satisfied status.
  const tracker = loadFixture({
    version: 1,
    labels: [],
    issues: [
      {
        id: "ISS-A",
        title: "Build a thing",
        state: "Todo",
        stateCategory: "unstarted",
        labels: [],
        relations: { blocks: [], blockedBy: ["ISS-B"], relatedTo: [] },
      },
      {
        id: "ISS-B",
        title: "Prereq still open",
        state: "Todo",
        stateCategory: "unstarted",
        labels: [],
        relations: { blocks: ["ISS-A"], blockedBy: [], relatedTo: [] },
      },
    ],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });

  const rec = runSkill({
    skill: "faff-map",
    tracker,
    repo,
    driver: scriptedDriver([
      { read: { method: "getIssue", args: { id: "ISS-A" } } },
      { read: { method: "getIssue", args: { id: "ISS-B" } } }, // still Todo -> live edge
      { cli: ["next", "--status", "todo", "--spec", "high", "--blocked"] }, // REAL -> blocked
      { verdict: { issue: "ISS-A", token: "blocked", source: "faff next" } },
    ]),
  });

  expectCliResult(rec, "next", { exit: 0, json: { next: "blocked" } });
  repo.teardown();
});
