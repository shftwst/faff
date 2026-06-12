// FAFF-97 — Rendering-adaptor routing assertion.
//
// Drives the FAFF-93 harness to produce real DecisionRecords (real seq/seamLog), then
// asserts the FAFF-95 `expectRoutedThroughRendering` matcher over them. This proves the
// universal-routing rule behaviourally — that a driven skill routed every DECLARED
// human-facing output surface through the rendering pass — complementing the static
// `validate-adapters` lint (which never runs a skill).
//
// Scope boundary (gateway + FAFF-96): this asserts ROUTING (presence + completeness +
// ordering of the rendering seam), never CONTENT. The harness records {seq, surface,
// routes?} for a rendering and never captures the rendered body; body goldens are FAFF-96.

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers/mock-tracker.mjs";
import { seedRepo } from "./helpers/seed-repo.mjs";
import { runSkill, scriptedDriver } from "./helpers/skill-harness.mjs";
import { expectRoutedThroughRendering } from "./helpers/decision-assert.mjs";

// Drive the harness over a bare script and return the frozen DecisionRecord. The fixture
// content is irrelevant here — the matcher reads only the rendering/mutation seams the
// script emits — so a single-issue fixture + one-commit repo is enough.
function run(t, actions) {
  const tracker = loadFixture({
    version: 1,
    labels: [],
    issues: [{ id: "ISS-X", title: "x", state: "Backlog", stateCategory: "backlog", labels: [] }],
    comments: [],
  });
  const repo = seedRepo({ commits: [{ message: "init", files: { "README.md": "x" } }] });
  t.after(() => repo.teardown());
  return runSkill({ skill: "faff-tidy", tracker, repo, driver: scriptedDriver(actions) });
}

test("Scenario 1 — terminal render present: default emits returns undefined", (t) => {
  const rec = run(t, [{ render: { surface: "tidy-report" } }]);
  assert.equal(
    expectRoutedThroughRendering(rec, { surface: "tidy-report" }),
    undefined,
    "a present terminal render routes (returns undefined)",
  );
});

test("Scenario 2 — comment write preceded by a routing render returns undefined", (t) => {
  const rec = run(t, [
    { render: { surface: "tidy-report", routes: "addComment" } },
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "normalised body" } } },
  ]);
  assert.equal(
    expectRoutedThroughRendering(rec, {
      surface: "tidy-report",
      emits: [{ kind: "mutation", op: "addComment" }],
    }),
    undefined,
    "a comment normalised before being written routes (returns undefined)",
  );
});

test("Scenario 3 — un-normalised write (no render of the surface) throws", (t) => {
  const rec = run(t, [
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "raw body" } } },
  ]);
  assert.throws(
    () =>
      expectRoutedThroughRendering(rec, {
        surface: "tidy-report",
        emits: [{ kind: "mutation", op: "addComment" }],
      }),
    /no rendering with that surface/,
    "a human-facing write with no rendering at all is a routing violation",
  );
});

test("Scenario 4 — render exists but emits AFTER the write throws (ordering)", (t) => {
  const rec = run(t, [
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "raw body" } } },
    { render: { surface: "tidy-report", routes: "addComment" } },
  ]);
  assert.throws(
    () =>
      expectRoutedThroughRendering(rec, {
        surface: "tidy-report",
        emits: [{ kind: "mutation", op: "addComment" }],
      }),
    /un-normalised write violates the universal-routing rule/,
    "routing requires the render to PRECEDE the write in seq",
  );
});

test("Default emits with no terminal render throws (the missing-render guard)", (t) => {
  const rec = run(t, [{ mutate: { op: "setStatus", issue: "ISS-X", args: { status: "Todo" } } }]);
  assert.throws(
    () => expectRoutedThroughRendering(rec, { surface: "tidy-report" }),
    /no rendering with that surface/,
  );
});

test("Strict binding — a render that routes a DIFFERENT op does not bind", (t) => {
  const rec = run(t, [
    { render: { surface: "tidy-report", routes: "setStatus" } }, // binds setStatus, not addComment
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "raw body" } } },
  ]);
  assert.throws(
    () =>
      expectRoutedThroughRendering(rec, {
        surface: "tidy-report",
        emits: [{ kind: "mutation", op: "addComment" }],
      }),
    /un-normalised write violates the universal-routing rule/,
    "a routes-tagged render only binds its own op",
  );
});

test("Lenient binding — an untagged render (routes undefined) binds any same-surface emit", (t) => {
  const rec = run(t, [
    { render: { surface: "tidy-report" } }, // no routes => lenient
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "normalised body" } } },
  ]);
  assert.equal(
    expectRoutedThroughRendering(rec, {
      surface: "tidy-report",
      emits: [{ kind: "mutation", op: "addComment" }],
    }),
    undefined,
    "an untagged render preceding the emit binds leniently",
  );
});

test("Issue selector — the emit is matched on op AND issue when issue is given", (t) => {
  const rec = run(t, [
    { render: { surface: "tidy-report", routes: "addComment" } },
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "normalised body" } } },
  ]);
  // matching issue routes
  assert.equal(
    expectRoutedThroughRendering(rec, {
      surface: "tidy-report",
      emits: [{ kind: "mutation", op: "addComment", issue: "ISS-X" }],
    }),
    undefined,
  );
  // a different issue has no matching emit at all
  assert.throws(
    () =>
      expectRoutedThroughRendering(rec, {
        surface: "tidy-report",
        emits: [{ kind: "mutation", op: "addComment", issue: "ISS-OTHER" }],
      }),
    /no human-facing emit matched/,
  );
});

test("Non-functional — reads the frozen record without mutating it", (t) => {
  const rec = run(t, [
    { render: { surface: "tidy-report", routes: "addComment" } },
    { mutate: { op: "addComment", issue: "ISS-X", args: { body: "normalised body" } } },
  ]);
  assert.ok(Object.isFrozen(rec), "runSkill returns a frozen record");
  const before = JSON.stringify(rec.seamLog);
  expectRoutedThroughRendering(rec, {
    surface: "tidy-report",
    emits: [{ kind: "rendering" }, { kind: "mutation", op: "addComment" }],
  });
  assert.equal(JSON.stringify(rec.seamLog), before, "the matcher must not mutate the record");
});

test("A non-empty surface is required (guards a malformed call)", (t) => {
  const rec = run(t, [{ render: { surface: "tidy-report" } }]);
  assert.throws(
    () => expectRoutedThroughRendering(rec, {}),
    /a non-empty `surface` is required/,
  );
});
