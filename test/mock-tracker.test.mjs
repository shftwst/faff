// FAFF-89 — Mock-tracker fixture format + loader: self-test.
//
// Exercises the committed fixture + loader/query model at the seam consumers bind to.
// One block per acceptance-criteria cluster from the spec's DONE section. Zero-dep:
// node:test + node:assert only, per ADR 0002.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadFixture, FixtureError } from "./helpers/mock-tracker.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(here, "fixtures", "tracker", "sample.json");

// ── Integration smoke test (spec §7 "plumbing is connected" path) ──────────────
test("smoke: schema + loader + validation + query + ordering + deep-copy connected", () => {
  const model = loadFixture(fixturePath);
  assert.deepEqual(model.getIssue("ISS-A").relations.blockedBy, ["ISS-B"]);
  const unstarted = model.listIssues({ stateCategory: "unstarted" });
  assert.equal(unstarted.length, 1);
  assert.equal(unstarted[0].id, "ISS-A");
  const aComments = model.listComments("ISS-A");
  assert.equal(aComments.length, 1);
  assert.match(aComments[0].body, /confidence: high/);
  assert.deepEqual(model.listComments("ISS-B"), []); // empty thread, not an error
  assert.throws(
    () => loadFixture({ version: 1, issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: ["NOPE"], relatedTo: [] } }] }),
    FixtureError,
  );
});

// ── Loading: path and object sources ───────────────────────────────────────────
test("loads from a file path", () => {
  const model = loadFixture(fixturePath);
  assert.equal(model.listIssues().length, 2);
});

test("loads from an already-parsed object", () => {
  const model = loadFixture({ version: 1, issues: [], labels: [], comments: [] });
  assert.deepEqual(model.listIssues(), []);
});

test("minimal valid fixture { version: 1 } loads; all list queries return []", () => {
  const model = loadFixture({ version: 1 });
  assert.deepEqual(model.listIssues(), []);
  assert.deepEqual(model.listProjects(), []);
  assert.deepEqual(model.listInitiatives(), []);
  assert.deepEqual(model.listLabels(), []);
  assert.deepEqual(model.listComments("anything"), []);
  assert.equal(model.getIssue("anything"), null);
});

// ── Validation: fail-loud at load ──────────────────────────────────────────────
test("unknown version is rejected with a FixtureError", () => {
  assert.throws(() => loadFixture({ version: 2 }), FixtureError);
  assert.throws(() => loadFixture({ version: "1" }), /unsupported fixture version/); // string "1" != 1
  assert.doesNotThrow(() => loadFixture({ version: 1 })); // sanity: v1 ok
});

test("duplicate id within a collection is rejected", () => {
  assert.throws(
    () =>
      loadFixture({
        version: 1,
        issues: [
          { id: "DUP", title: "a", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } },
          { id: "DUP", title: "b", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } },
        ],
      }),
    /duplicate id DUP in issues/,
  );
});

test("bad stateCategory is rejected", () => {
  assert.throws(
    () =>
      loadFixture({
        version: 1,
        issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "wat", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } }],
      }),
    /bad stateCategory/,
  );
});

test("dangling reference fails at loadFixture time, not at query time", () => {
  // dangling label
  assert.throws(
    () =>
      loadFixture({
        version: 1,
        issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "unstarted", labels: ["ghost"], relations: { blocks: [], blockedBy: [], relatedTo: [] } }],
      }),
    /dangling label -> ghost/,
  );
  // dangling projectId
  assert.throws(
    () =>
      loadFixture({
        version: 1,
        issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "unstarted", labels: [], projectId: "ghost", relations: { blocks: [], blockedBy: [], relatedTo: [] } }],
      }),
    /dangling projectId -> ghost/,
  );
  // dangling comment.issueId
  assert.throws(
    () => loadFixture({ version: 1, comments: [{ id: "C", issueId: "ghost", body: "x", createdAt: "2026-01-01T00:00:00.000Z" }] }),
    /dangling issueId -> ghost/,
  );
  // dangling project.initiativeId
  assert.throws(
    () => loadFixture({ version: 1, projects: [{ id: "P", name: "p", state: "started", initiativeIds: ["ghost"] }] }),
    /dangling initiativeId -> ghost/,
  );
});

test("a non-array collection is rejected", () => {
  assert.throws(() => loadFixture({ version: 1, issues: {} }), /issues must be an array/);
});

// ── Filtering (listIssues) ─────────────────────────────────────────────────────
test("listIssues filters by state / stateCategory / projectId / labels (AND)", () => {
  const model = loadFixture(fixturePath);
  assert.deepEqual(model.listIssues({ state: "Done" }).map((i) => i.id), ["ISS-B"]);
  assert.deepEqual(model.listIssues({ stateCategory: "completed" }).map((i) => i.id), ["ISS-B"]);
  assert.deepEqual(model.listIssues({ projectId: "PROJ-1" }).map((i) => i.id), ["ISS-A", "ISS-B"]);
  assert.deepEqual(model.listIssues({ labels: ["faff-automate"] }).map((i) => i.id), ["ISS-A"]);
  // AND semantics: a label set not fully present matches nothing
  assert.deepEqual(model.listIssues({ labels: ["faff-automate", "missing"] }), []);
});

// ── Deterministic ordering ─────────────────────────────────────────────────────
test("listIssues sorts by id ascending regardless of fixture order", () => {
  const model = loadFixture({
    version: 1,
    issues: [
      { id: "ISS-C", title: "c", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } },
      { id: "ISS-A", title: "a", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } },
      { id: "ISS-B", title: "b", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } },
    ],
  });
  assert.deepEqual(model.listIssues().map((i) => i.id), ["ISS-A", "ISS-B", "ISS-C"]);
});

test("listComments sorts by createdAt asc then id asc", () => {
  const model = loadFixture({
    version: 1,
    issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } }],
    comments: [
      { id: "C-2", issueId: "X", body: "second", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "C-3", issueId: "X", body: "tie-b", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "C-1", issueId: "X", body: "tie-a", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  });
  assert.deepEqual(model.listComments("X").map((c) => c.id), ["C-1", "C-3", "C-2"]);
});

// ── Result shape ───────────────────────────────────────────────────────────────
test("IssueResult resolves labels to {name,color} and carries a project reference", () => {
  const model = loadFixture(fixturePath);
  const a = model.getIssue("ISS-A");
  assert.deepEqual(a.labels, [{ name: "faff-automate", color: "#4ea7fc" }]);
  assert.deepEqual(a.project, { id: "PROJ-1", name: "Deterministic test substrate" });
  // an issue with no project resolves project to null
  const noProj = loadFixture({
    version: 1,
    issues: [{ id: "X", title: "x", state: "Todo", stateCategory: "unstarted", labels: [], relations: { blocks: [], blockedBy: [], relatedTo: [] } }],
  }).getIssue("X");
  assert.equal(noProj.project, null);
});

// ── get* / unknown-id semantics ────────────────────────────────────────────────
test("getIssue / getProject return null for unknown ids; listComments returns [] ", () => {
  const model = loadFixture(fixturePath);
  assert.equal(model.getIssue("NOPE"), null);
  assert.equal(model.getProject("NOPE"), null);
  assert.deepEqual(model.listComments("NOPE"), []);
});

// ── Read-only / determinism guarantees ─────────────────────────────────────────
test("mutating a returned result does not affect a subsequent identical query", () => {
  const model = loadFixture(fixturePath);
  const first = model.getIssue("ISS-A");
  first.title = "MUTATED";
  first.relations.blockedBy.push("HACK");
  first.labels[0].color = "#000000";
  const second = model.getIssue("ISS-A");
  assert.equal(second.title, "Build a thing");
  assert.deepEqual(second.relations.blockedBy, ["ISS-B"]);
  assert.equal(second.labels[0].color, "#4ea7fc");
});

test("the model is frozen", () => {
  const model = loadFixture(fixturePath);
  assert.ok(Object.isFrozen(model));
  assert.throws(() => {
    model.listIssues = () => [];
  }, TypeError);
});

test("loading the same fixture twice yields deep-equal query results (byte-identical, stable order)", () => {
  const a = loadFixture(fixturePath);
  const b = loadFixture(fixturePath);
  assert.deepEqual(a.listIssues(), b.listIssues());
  assert.deepEqual(a.listProjects(), b.listProjects());
  assert.deepEqual(a.listInitiatives(), b.listInitiatives());
  assert.deepEqual(a.listLabels(), b.listLabels());
  assert.deepEqual(a.listComments("ISS-A"), b.listComments("ISS-A"));
  // serialised form is identical too
  assert.equal(JSON.stringify(a.listIssues()), JSON.stringify(b.listIssues()));
});
