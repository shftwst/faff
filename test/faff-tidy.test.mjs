// FAFF-94 — First end-to-end behavioural test: faff-tidy on the skill-run harness.
//
// Scope (decision 1 in the FAFF-94 spec): test faff-tidy's DETERMINISTIC decision
// kernel via REAL `faff` CLI seams (`faff next` / `faff eligible` through ctx.cli ->
// the real binary) — the assertable, non-tautological core — plus end-to-end harness
// capture (buckets / mutations / verdicts) as proof-of-mechanism.
//
// OUT OF SCOPE — deferred to the live driver (FAFF-122): faff-tidy's LLM-judgement
// classifications (vague / dupe / stale / superseded / challenged spec-health,
// "is this cascade-orphan still wanted"), the free-text summary, and pick-ordering.
// The scripted driver cannot generate those; a hand-authored version would be the
// test asserting its own input (a tautology). No such judgement is asserted here.
//
// Every test case asserts >=1 REAL `faff` CLI computation (parsed from recorded
// stdout at exit 0); the captured buckets/mutations are the plumbing ids flow
// through, never sold as the behavioural truth.
//
// FAFF-95: the assertion blocks DECLARE expectations via the decision-assert matchers
// (test/helpers/decision-assert.mjs) instead of hand-rolling record-field access.
// The real-CLI strength is preserved via expectCliResult (same parse/compare, named).
// Two assertion classes stay inline: read-method/resultCount checks (not one of the
// four matcher categories) and tracker-model checks (a tracker property, not a record
// property) — hence `node:assert/strict` is still imported.

import { test } from "node:test";
import assert from "node:assert/strict";

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

// Map the tracker's stateCategory enum onto `faff next`'s orchestration status
// vocabulary. `faff next --status` rejects the raw stateCategory values
// (unstarted/started/completed -> {next:"error"}, exit 2), so this mapping is
// mandatory before any stateCategory reaches a `cli` action.
const NEXT_STATUS = {
  backlog: "backlog",
  unstarted: "todo",
  started: "in-progress",
  completed: "done",
  cancelled: "cancelled",
};

test("Scenario A — ready-promotion is a real `graft` verdict, captured end-to-end", (t) => {
  // A Backlog issue: faff-automate + a high-confidence spec + no blockers => the
  // deterministic kernel FORCES graft. Nothing here is an LLM judgement.
  const tracker = loadFixture({
    version: 1,
    labels: [{ name: "faff-automate", color: "#6fcf97" }],
    issues: [
      {
        id: "ISS-A",
        title: "ready candidate",
        state: "Backlog",
        stateCategory: "backlog",
        labels: ["faff-automate"],
      },
    ],
    comments: [
      { id: "C1", issueId: "ISS-A", body: "# spec\nconfidence: high\n", createdAt: "2026-01-01T00:00:00Z" },
    ],
  });
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "ISS-A", location: "committed", body: "# spec\nconfidence: high\n" }],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { read: { method: "listIssues", args: { stateCategory: "backlog" } } },
      { read: { method: "listComments", args: { issueId: "ISS-A" } } },
      { cli: ["eligible", "--label", "faff-automate"] }, // REAL -> "true"
      { cli: ["next", "--status", NEXT_STATUS.backlog, "--spec", "high"] }, // REAL -> graft
      { verdict: { issue: "ISS-A", token: "graft", source: "faff next" } },
      { bucket: { name: "ready", issues: ["ISS-A"] } },
      { mutate: { op: "setStatus", issue: "ISS-A", args: { status: "Todo" } } },
      { render: { surface: "tidy-report" } },
    ]),
  });

  // --- real CLI computations (the non-tautological assertions) ---
  expectCliResult(rec, "eligible", { exit: 0, stdoutTrim: "true" });
  expectCliResult(rec, "next", { exit: 0, json: { next: "graft" } });

  // --- proof-of-mechanism: the harness drove tidy's seams and the id flowed through ---
  expectBucket(rec, "ready", ["ISS-A"]);
  expectMutation(rec, { op: "setStatus", issue: "ISS-A", args: { status: "Todo" } });

  // --- cross-seam ordering: the `next` computation precedes the bucket it informed ---
  expectSeamOrder(rec, { kind: "cliCall", argvHead: "next" }, { kind: "bucket", name: "ready" });

  // --- mutation was an ATTEMPT: the frozen TRACKER MODEL is unchanged (not a record check) ---
  assert.equal(tracker.getIssue("ISS-A").state, "Backlog");
});

test("Scenario B — stale-park routing is real; the mechanical clear is captured as an attempt", (t) => {
  // A parked issue whose blocker is now Done. The MECHANICAL rule (cited blocker
  // completed => clear the stale park) is tidy's own; the REAL CLI computation we
  // assert is that a parked issue routes to needs-human (why the park matters).
  const tracker = loadFixture({
    version: 1,
    labels: [{ name: "faff-parked", color: "#e8a33d" }],
    issues: [
      {
        id: "ISS-PARKED",
        title: "parked, blocker now done",
        state: "Backlog",
        stateCategory: "backlog",
        labels: ["faff-parked"],
        relations: { blocks: [], blockedBy: ["ISS-DONE"], relatedTo: [] },
      },
      {
        id: "ISS-DONE",
        title: "the blocker, now shipped",
        state: "Done",
        stateCategory: "completed",
        labels: [],
        relations: { blocks: ["ISS-PARKED"], blockedBy: [], relatedTo: [] },
      },
    ],
    comments: [
      { id: "C1", issueId: "ISS-PARKED", body: "# spec\nconfidence: high\n", createdAt: "2026-01-01T00:00:00Z" },
    ],
  });
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "ISS-PARKED", location: "committed", body: "# spec\nconfidence: high\n" }],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { read: { method: "getIssue", args: { id: "ISS-PARKED" } } },
      { read: { method: "getIssue", args: { id: "ISS-DONE" } } }, // confirm blocker is completed
      { cli: ["next", "--status", NEXT_STATUS.backlog, "--spec", "high", "--parked"] }, // REAL -> needs-human
      { mutate: { op: "removeLabel", issue: "ISS-PARKED", args: { label: "faff-parked" } } },
      { bucket: { name: "park-cleared", issues: ["ISS-PARKED"] } },
      { render: { surface: "tidy-report" } },
    ]),
  });

  // --- real CLI computation: a parked issue routes to needs-human ---
  expectCliResult(rec, "next", { exit: 0, json: { next: "needs-human" } });

  // --- both reads were served (parked issue + now-Done blocker). Read-method/count is
  //     not one of the four matcher categories, so it stays a direct assert. ---
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["getIssue", "getIssue"]);
  assert.ok(rec.trackerReads.every((r) => r.resultCount === 1));

  // --- proof-of-mechanism: the mechanical clear is a recorded removeLabel ATTEMPT ---
  expectMutation(rec, { op: "removeLabel", issue: "ISS-PARKED", args: { label: "faff-parked" } });
  expectBucket(rec, "park-cleared", ["ISS-PARKED"]);

  // --- attempt only: the frozen TRACKER MODEL still carries faff-parked (not a record check) ---
  const stillParked = tracker.getIssue("ISS-PARKED").labels.some((l) => l.name === "faff-parked");
  assert.ok(stillParked, "removeLabel is an attempt — the read-only model must be unchanged");
});

test("Scenario C — an ineligible issue is skipped by a real `skip-ineligible` verdict", (t) => {
  // Same readiness shape as Scenario A but WITHOUT faff-automate. Under default
  // opt-in eligibility, the real kernel FORCES skip-ineligible — a real computation,
  // not a hand-asserted constant.
  const tracker = loadFixture({
    version: 1,
    labels: [{ name: "faff-automate", color: "#6fcf97" }],
    issues: [
      {
        id: "ISS-C",
        title: "ready-looking but unblessed",
        state: "Backlog",
        stateCategory: "backlog",
        labels: [], // deliberately not faff-automate
      },
    ],
    comments: [
      { id: "C1", issueId: "ISS-C", body: "# spec\nconfidence: high\n", createdAt: "2026-01-01T00:00:00Z" },
    ],
  });
  const repo = seedRepo({
    commits: [{ message: "init", files: { "README.md": "x" } }],
    specs: [{ issue: "ISS-C", location: "committed", body: "# spec\nconfidence: high\n" }],
  });
  t.after(() => repo.teardown());

  const rec = runSkill({
    skill: "faff-tidy",
    tracker,
    repo,
    driver: scriptedDriver([
      { read: { method: "listIssues", args: { stateCategory: "backlog" } } },
      { cli: ["eligible", "--default", "opt-in"] }, // REAL -> "false" (no faff-automate)
      { cli: ["next", "--status", NEXT_STATUS.backlog, "--spec", "high", "--not-eligible"] }, // REAL -> skip-ineligible
      { verdict: { issue: "ISS-C", token: "skip-ineligible", source: "faff next" } },
      { bucket: { name: "on-hold", issues: ["ISS-C"] } },
      { render: { surface: "tidy-report" } },
    ]),
  });

  // --- real CLI computations: ineligible, and the resulting skip-ineligible route ---
  expectCliResult(rec, "eligible", { exit: 0, stdoutTrim: "false" });
  expectCliResult(rec, "next", { exit: 0, json: { next: "skip-ineligible" } });

  // --- proof-of-mechanism: on-hold (NOT ready); no promotion mutation recorded ---
  expectBucket(rec, "on-hold", ["ISS-C"]);
  expectNoBucket(rec, "ready");
  expectNoMutation(rec);
});
