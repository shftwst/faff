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

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill, scriptedDriver } from "./helpers/skill-harness.mjs";

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
  const eligibleCall = rec.cliCalls.find((c) => c.argv[0] === "eligible");
  const nextCall = rec.cliCalls.find((c) => c.argv[0] === "next");
  assert.equal(eligibleCall.exit, 0);
  assert.equal(eligibleCall.stdout.trim(), "true");
  assert.equal(nextCall.exit, 0);
  assert.equal(JSON.parse(nextCall.stdout).next, "graft");

  // --- proof-of-mechanism: the harness drove tidy's seams and the id flowed through ---
  assert.deepEqual(rec.buckets.ready, ["ISS-A"]);
  const setStatus = rec.mutations.find((m) => m.op === "setStatus");
  assert.equal(setStatus.issue, "ISS-A");
  assert.deepEqual(setStatus.args, { status: "Todo" });

  // --- cross-seam ordering: the `next` computation precedes the bucket it informed ---
  const bucketSeq = rec.seamLog.find((e) => e.kind === "bucket").seq;
  assert.ok(nextCall.seq < bucketSeq);

  // --- mutation was an ATTEMPT: the frozen model is unchanged ---
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
  const nextCall = rec.cliCalls.find((c) => c.argv[0] === "next");
  assert.equal(nextCall.exit, 0);
  assert.equal(JSON.parse(nextCall.stdout).next, "needs-human");

  // --- both reads were served (the parked issue + its now-Done blocker) ---
  assert.deepEqual(rec.trackerReads.map((r) => r.method), ["getIssue", "getIssue"]);
  assert.ok(rec.trackerReads.every((r) => r.resultCount === 1));

  // --- proof-of-mechanism: the mechanical clear is a recorded removeLabel ATTEMPT ---
  const removeLabel = rec.mutations.find((m) => m.op === "removeLabel");
  assert.equal(removeLabel.issue, "ISS-PARKED");
  assert.equal(removeLabel.args.label, "faff-parked");
  assert.deepEqual(rec.buckets["park-cleared"], ["ISS-PARKED"]);

  // --- attempt only: the frozen model still carries the faff-parked label ---
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
  const eligibleCall = rec.cliCalls.find((c) => c.argv[0] === "eligible");
  const nextCall = rec.cliCalls.find((c) => c.argv[0] === "next");
  assert.equal(eligibleCall.exit, 0);
  assert.equal(eligibleCall.stdout.trim(), "false");
  assert.equal(nextCall.exit, 0);
  assert.equal(JSON.parse(nextCall.stdout).next, "skip-ineligible");

  // --- proof-of-mechanism: on-hold (NOT ready); no promotion mutation recorded ---
  assert.deepEqual(rec.buckets["on-hold"], ["ISS-C"]);
  assert.equal(rec.buckets.ready, undefined);
  assert.equal(rec.mutations.length, 0);
});
