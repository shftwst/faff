import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../plugin/skills/faff/bin/faff", import.meta.url));
const issue = (id, fields = {}) => ({
  id, files: [], directories: [], surfaces: [], scope_tags: [], blocked_by: [], ...fields,
});
const match = (producer, consumer, fields = {}) => ({
  producer, consumer, match_kind: "id_reference", confidence: "firm", evidence: `${consumer} expects ${producer}`, ...fields,
});
const facts = (issues, extras = {}) => ({
  issues, inferred: [], non_blocking: [], uncertain_collisions: [], ...extras,
});
function invoke(input, args = ["--facts", "-"]) {
  return spawnSync(process.execPath, [cli, "build-queue-partition", ...args], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
  });
}
function partition(input, args) {
  const result = invoke(input, args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}
const pair = (producer, consumer, source) => ({ producer, consumer, source });

test("connects exact collisions transitively while preserving a dependency-free executor partition", () => {
  const result = partition(facts([
    issue("SHF-5", { files: ["src/auth/other.ts"] }),
    issue("SHF-4", { files: ["src/billing/charge.ts"] }),
    issue("SHF-3", { surfaces: ["TokenService"] }),
    issue("SHF-2", { files: ["./src/auth/issue.ts"], surfaces: ["TokenService"] }),
    issue("SHF-1", { files: ["src/auth/issue.ts"] }),
  ]));
  assert.deepEqual(result.independents, ["SHF-4", "SHF-5"]);
  assert.deepEqual(result.groups, [["SHF-1", "SHF-2", "SHF-3"]]);
  assert.deepEqual(result.dependencies, []);
  assert.deepEqual(result.collisions, [
    { left: "SHF-1", right: "SHF-2", kind: "file", value: "src/auth/issue.ts" },
    { left: "SHF-2", right: "SHF-3", kind: "surface", value: "TokenService" },
  ]);
  // Both executors model exactly one unit per independent and per group.
  const units = [...result.independents.map(id => [id]), ...result.groups];
  assert.equal(new Set(units.flat()).size, 5);
  assert.equal(units.flat().length, 5);
});

test("matches a named directory on full path boundaries and chooses the deepest overlap", () => {
  const result = partition(facts([
    issue("A-1", { directories: ["src/auth/", "src/auth/token"] }),
    issue("A-2", { files: ["src/auth/token/key.ts"] }),
    issue("A-3", { files: ["src/authorization/token/key.ts"] }),
    issue("A-4", { directories: ["src/auth/token/private"] }),
    issue("A-5", { files: ["higher/src/auth/token/key.ts"] }),
  ]));
  assert.deepEqual(result.groups, [["A-1", "A-2", "A-4"]]);
  assert.deepEqual(result.independents, ["A-3", "A-5"]);
  assert.deepEqual(result.collisions, [
    { left: "A-1", right: "A-2", kind: "directory", value: "src/auth/token" },
    { left: "A-1", right: "A-4", kind: "directory", value: "src/auth/token" },
  ]);
});

test("detects a file at the exact path another spec names as a directory", () => {
  const result = partition(facts([issue("A-1", { files: ["src/token"] }), issue("A-2", { directories: ["src/token/"] })]));
  assert.deepEqual(result.groups, [["A-1", "A-2"]]);
  assert.deepEqual(result.collisions, [{ left: "A-1", right: "A-2", kind: "directory", value: "src/token" }]);
});

test("orders declared and firm inferred dependencies, merges groups and retains audit-only matches", () => {
  const declared = match("A-4", "A-2");
  const accepted = match("A-2", "A-1", { match_kind: "paraphrase" });
  const uncertain = match("A-5", "A-1", { confidence: "ambiguous" });
  const overridden = match("A-1", "A-5");
  const sharing = match("A-6", "A-7");
  const sameDirectory = match("A-10", "A-11");
  const sameSurface = match("A-12", "A-13");
  const external = match("EXT-1", "A-1");
  const result = partition(facts([
    issue("A-1", { scope_tags: ["shared"] }),
    issue("A-2", { blocked_by: ["A-4", "EXT-1"] }),
    issue("A-4"), issue("A-5"),
    issue("A-6", { files: ["a.ts"] }), issue("A-7", { files: ["a.ts"] }),
    issue("A-8", { scope_tags: ["shared"] }), issue("A-9"),
    issue("A-10", { directories: ["docs/notes"] }), issue("A-11", { files: ["docs/notes/todo.md"] }),
    issue("A-12", { surfaces: ["fn"] }), issue("A-13", { surfaces: ["fn"] }),
  ], {
    inferred: [external, sharing, sameDirectory, sameSurface, declared, uncertain, accepted, overridden, accepted],
    non_blocking: [{ producer: "A-1", consumer: "A-5" }],
    uncertain_collisions: [["A-9", "A-8"]],
  }));
  assert.deepEqual(result.independents, ["A-5"]);
  assert.deepEqual(result.groups, [["A-10", "A-11"], ["A-12", "A-13"], ["A-4", "A-2", "A-1", "A-8", "A-9"], ["A-6", "A-7"]]);
  assert.deepEqual(result.dependencies, [pair("A-2", "A-1", "inferred"), pair("A-4", "A-2", "declared")]);
  assert.deepEqual(result.inferred, [
    { ...overridden, disposition: "human-non-blocker" },
    { ...accepted, disposition: "serialised" },
    { ...uncertain, disposition: "ambiguous" },
  ]);
});

test("preserves live declared blockers when a non-blocker only overrides an inference", () => {
  const result = partition(facts([issue("A-1"), issue("A-2", { blocked_by: ["A-1"] })], {
    non_blocking: [{ producer: "A-1", consumer: "A-2" }],
    inferred: [match("A-1", "A-2")],
  }));
  assert.deepEqual(result.dependencies, [pair("A-1", "A-2", "declared")]);
  assert.deepEqual(result.groups, [["A-1", "A-2"]]);
  assert.deepEqual(result.inferred, []);
});

test("places each cycle in ticket ID order without moving a downstream dependent ahead of it", () => {
  const result = partition(facts([
    issue("A-1", { blocked_by: ["A-3"] }), issue("A-2"),
    issue("A-3"), issue("A-4"), issue("A-5", { blocked_by: ["A-6"] }), issue("A-6"),
  ], { inferred: [match("A-2", "A-3"), match("A-3", "A-2"), match("A-4", "A-2"), match("A-5", "A-6")] }));
  assert.deepEqual(result.groups, [["A-4", "A-2", "A-3", "A-1"], ["A-5", "A-6"]]);
  assert.deepEqual(result.inferred_cycles, [["A-2", "A-3"]]);
  assert.deepEqual(result.ordering_cycles, [["A-2", "A-3"], ["A-5", "A-6"]]);
});

test("produces identical output for permutations of the same facts", () => {
  const input = facts([
    issue("A-4", { files: ["src/b.ts", "src/a.ts"], scope_tags: ["y", "x"] }),
    issue("A-2", { files: ["src/a.ts", "src/b.ts"], scope_tags: ["x"] }),
    issue("A-1"), issue("A-3"), issue("A-5"),
  ], { inferred: [match("A-5", "A-1"), match("A-1", "A-5")], uncertain_collisions: [["A-4", "A-3"], ["A-5", "A-3"]] });
  const reversed = {
    ...input,
    issues: [...input.issues].reverse().map(row => ({ ...row, files: [...row.files].reverse(), scope_tags: [...row.scope_tags].reverse() })),
    inferred: [...input.inferred].reverse(),
    uncertain_collisions: [...input.uncertain_collisions].reverse().map(([a, b]) => [b, a]),
  };
  const first = invoke(input);
  const second = invoke(reversed);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
});

test("accepts a facts file and preserves an empty queue", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "faff-build-queue-"));
  try {
    const file = path.join(dir, "facts.json");
    writeFileSync(file, JSON.stringify(facts([])));
    assert.deepEqual(partition("", ["--facts", file]), {
      independents: [], groups: [], dependencies: [], collisions: [], inferred: [],
      inferred_cycles: [], ordering_cycles: [],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails closed on malformed facts, duplicate members, invalid paths and stale collision pairs", () => {
  for (const input of [
    "{",
    facts([issue("A-1"), issue("A-1")]),
    facts([issue("A-1", { files: ["../src/a.ts"] })]),
    { issues: [issue("A-1")], inferred: [] },
    facts([issue("A-1")], { uncertain_collisions: [["A-1", "A-2"]] }),
    facts([issue("A-1")], { inferred: [match("A-1", "A-1")] }),
    facts([issue("A-1")], { inferred: [match("A-1", "A-2", { confidence: "guess" })] }),
  ]) {
    const result = invoke(input);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /build-queue-partition:/);
  }
  const invalidFlag = invoke(facts([]), ["--facts", "-", "--unknown"]);
  assert.equal(invalidFlag.status, 2, invalidFlag.stderr);
  assert.equal(invalidFlag.stdout, "");
});

test("logs a linear number of collision witnesses for a dense queue", () => {
  const issues = Array.from({ length: 36 }, (_, i) => issue(`Q-${String(i).padStart(2, "0")}`, { scope_tags: ["shared"] }));
  const result = partition(facts(issues));
  assert.deepEqual(result.independents, []);
  assert.deepEqual(result.groups, [issues.map(row => row.id)]);
  assert.equal(result.collisions.length, issues.length - 1);
  assert.deepEqual(result.dependencies, []);
});
