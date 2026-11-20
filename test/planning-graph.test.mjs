import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));

function invoke(mode, facts) {
  return spawnSync(process.execPath, [cli, "planning-graph", ...[].concat(mode)], {
    input: JSON.stringify(facts), encoding: "utf8",
  });
}

function graph(mode, facts) {
  const result = invoke(mode, facts);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

test("diagnostics retain every cyclic member and witness only real links", () => {
  const issues = ["CORE-2", "API-1", "CORE-1", "SELF-1", "TAIL-1", 10, "10"];
  const live_edges = [
    ["API-1", "CORE-1"], ["CORE-1", "API-1"], ["CORE-2", "API-1"],
    ["API-1", "CORE-2"], ["TAIL-1", "API-1"], ["SELF-1", "SELF-1"],
    ["TAIL-1", "OUTSIDE-1"], [10, "10"], ["10", 10],
  ];
  const shown = graph("--cycles", { issues, live_edges });
  assert.equal(shown, graph("--cycles", { issues: [...issues].reverse(), live_edges: [...live_edges].reverse() }));
  const { dependency_cycles } = JSON.parse(shown);
  assert.deepEqual(dependency_cycles.map(cycle => cycle.members), [[10, "10"], ["API-1", "CORE-1", "CORE-2"], ["SELF-1"]]);
  for (const { members, witness } of dependency_cycles) {
    assert.equal(witness[0], witness.at(-1));
    assert.ok(witness.length >= 2);
    for (const [index, id] of witness.slice(0, -1).entries()) {
      assert.ok(members.includes(id));
      assert.ok(live_edges.some(([issue, blocker]) => issue === id && blocker === witness[index + 1]));
    }
  }
  // Map decorates a rendered chain and tidy/routing retain even unpictured members of a cycle.
  const cyclesTouching = ids => dependency_cycles.filter(cycle => cycle.members.some(id => ids.includes(id)));
  assert.equal(cyclesTouching(["CORE-2"])[0], dependency_cycles[1]);
  assert.deepEqual(cyclesTouching(["TAIL-1"]), []);
});

test("unlock counts are distinct transitive dependents, including through non-candidates", () => {
  const issues = ["b", "a", "c", "d", "e", "isolated"];
  const live_edges = [["b", "a"], ["c", "a"], ["d", "b"], ["d", "c"], ["d", "c"], ["e", "d"], ["d", "external"]];
  const { unlock_counts } = JSON.parse(graph("--unlock", { issues, live_edges, roots: ["isolated", "a", "c"] }));
  assert.deepEqual(unlock_counts, [["a", 4], ["c", 2], ["isolated", 0]]);
  // The methodology can keep human priority primary and creation time as its final key.
  const counts = new Map(unlock_counts);
  const choices = [{ id: "c", priority: 2 }, { id: "isolated", priority: 1 }, { id: "a", priority: 2 }];
  choices.sort((left, right) => left.priority - right.priority || counts.get(right.id) - counts.get(left.id));
  assert.deepEqual(choices.map(choice => choice.id), ["isolated", "a", "c"]);
});

test("cyclic paths count each downstream issue once and never count the root", () => {
  const facts = { issues: ["a", "b", "c"], live_edges: [["a", "b"], ["b", "a"], ["c", "b"]] };
  assert.deepEqual(JSON.parse(graph("--unlock", facts)).unlock_counts, [["a", 2], ["b", 2], ["c", 0]]);
});

test("rejects malformed or incomplete graph facts without publishing a result", () => {
  const cases = [
    { issues: ["a", "a"], live_edges: [] },
    { issues: ["a"], live_edges: [["x", "a"]] },
    { issues: ["a"], live_edges: [["a"]] },
    { issues: ["a"], live_edges: [], roots: ["x"] },
    { issues: ["a"] },
  ];
  for (const facts of cases) {
    const run = invoke("--unlock", facts);
    assert.equal(run.status, 2, run.stderr);
    assert.equal(run.stdout, "");
  }
});

test("answers batched diagnostics and ordering with one graph", () => {
  const facts = { issues: ["a", "b", "c"], live_edges: [["a", "b"], ["b", "a"], ["c", "b"]] };
  const combined = JSON.parse(graph(["--cycles", "--unlock"], { ...facts, roots: ["a"] }));
  assert.deepEqual(combined, {
    ...JSON.parse(graph("--cycles", facts)),
    ...JSON.parse(graph("--unlock", { ...facts, roots: ["a"] })),
  });
});
