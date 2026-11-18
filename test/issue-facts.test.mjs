import { test } from "node:test";
import assert from "node:assert/strict";
import { runCli } from "./helpers/run-cli.mjs";

function run(source, batch) {
  return runCli(["tracker", "facts", "--source", source], { input: JSON.stringify(batch) });
}
function classify(source, batch) {
  const r = run(source, { complete: true, ...batch });
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("Linear category owns cancellation and completion, including custom names and both category spellings", () => {
  const issues = [
    { id: "work", state: { type: "started", name: "Done" } },
    { id: "visible", state: { name: "Duplicate", stateCategory: "started" } },
    { id: "custom", state: "No longer needed", stateCategory: "canceled" },
    { id: "other", status: { type: "cancelled", name: "Finished" } },
    { id: "fallback", state: "Won't Fix" },
    { id: "legacy", state: "Duplicate" },
    { id: "shipped", state: { type: "completed", name: "In production" } },
    { id: "old-done", state: "Done" },
    { id: "archived", archivedAt: "2026-11-10" },
    { id: "parent", project: { status: { type: "canceled" } } },
    { id: "parent-archived", project: { archived: true } },
    { id: "custom-parent", project: { cancelled: true } },
  ];
  assert.deepEqual(classify("linear", { issues }), {
    hidden: ["custom", "other", "fallback", "legacy", "archived", "parent", "parent-archived", "custom-parent"],
    done: ["shipped", "old-done"], live_edges: [], blocked: [],
  });
});

test("GitHub distinguishes completion, cancellation, an unmerged PR and ambiguous closures", () => {
  const issues = [
    { id: 1, state: "CLOSED", stateReason: "NOT_PLANNED" },
    { id: 2, state: "closed", state_reason: "completed" },
    { id: 3, state: "closed", pull_request: { merged_at: "2026-11-10" } },
    { id: 4, state: "closed", pull_request: { merged_at: null } },
    { id: 5, state: "closed", state_reason: null },
    { id: 6, state: "open", state_reason: "not_planned" },
    { id: 7, state: "MERGED", project: { archived: true } },
  ];
  assert.deepEqual(classify("github", { issues }), {
    hidden: [1, 7], done: [2, 3, 7], live_edges: [], blocked: [],
  });
});

test("computed edges drive the real next CLI and keep internal, unresolved, hidden and mixed cases distinct", () => {
  const issues = [
    { id: "A", state: "Todo" }, { id: "B", state: "Done" }, { id: "C", state: "Active" },
    { id: "D", state: "Todo" }, { id: "X", state: "Duplicate" },
  ];
  const edges = [["A","B"], ["A","C"], ["A","unknown"], ["D","C"], ["X","C"]];
  const before = structuredClone(edges);
  const facts = classify("linear", { issues, edges, queue: ["A","C","D"] });
  assert.deepEqual(facts, { hidden: ["X"], done: ["B"], live_edges: [["A","C"],["A","unknown"],["D","C"]], blocked: ["A"] });
  assert.deepEqual(edges, before);
  for (const [id, route] of [["A","blocked"],["D","graft"]]) {
    const flags = facts.blocked.includes(id) ? ["--blocked"] : [];
    const r = runCli(["next","--status","todo","--spec","high", ...flags]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).next, route);
  }
});

test("a cancelled target alone never certifies that its blocker shipped", () => {
  const facts = classify("github", { issues: [{id:"open",state:"open"},{id:"cancelled",state:"closed",state_reason:"not_planned"}], edges:[["open","cancelled"]] });
  assert.deepEqual(facts.live_edges, [["open","cancelled"]]);
  assert.deepEqual(facts.blocked, ["open"]);
});

test("empty, complete reads are usable and incomplete or malformed reads never emit a partial classification", () => {
  assert.deepEqual(classify("github", { issues: [] }), { hidden: [], done: [], live_edges: [], blocked: [] });
  for (const batch of [
    {issues:[]}, {complete:false,issues:[]}, {complete:true,issues:[{id:"X"},{id:"X"}]},
    {complete:true,issues:[{id:"X",project:"unchecked"}]},
    {complete:true,issues:[{id:"X"}],edges:[["missing","X"]]},
    {complete:true,issues:[{id:"X"}],queue:"X"},
    {complete:true,issues:[{id:"X",state:"closed",state_reason:"not_planned",merged:true}]},
  ]) {
    const r = run("github",batch);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.ok(r.stderr.trim());
  }
  for (const args of [[], ["--source","jira"], ["--source","linear","extra"], ["--source","github","--source","linear"]]) {
    const r = runCli(["tracker","facts",...args],{input:"{}"});
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
  }
});
