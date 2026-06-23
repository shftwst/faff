// FAFF-219 (Split A of FAFF-217) — `faff contain`: the subtree-of-mandate
// containment primitive. Answers `parent ∈ subtree(mandate)` by walking the
// AGENT-SUPPLIED parentId chain (--ancestry) from <parent> up to <mandate>:
// contained (exit 0) / outward (exit 3, fail-closed) / usage (exit 2). PURE —
// zero tracker/network calls (parity with eligible/next/intakecheck). Drives the
// real entrypoint, like intakecheck.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

function run(...args) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}
const anc = (...pairs) => JSON.stringify(pairs.map(([id, parentId]) => ({ id, parentId })));

test("contain --selftest passes (the contained/outward/fail-closed table)", () => {
  const r = run("contain", "--selftest");
  assert.equal(r.code, 0);
  assert.match(r.out, /RESULT: PASS/);
});

test("direct child is contained, exit 0 (C.parentId = M)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("transitive descendant is contained (G -> C -> M)", () => {
  const r = run("contain", "M", "--parent", "G", "--ancestry", anc(["G", "C"], ["C", "M"]));
  assert.equal(r.code, 0);
});

test("base case mandate == parent is contained without ancestry", () => {
  const r = run("contain", "M", "--parent", "M");
  assert.equal(r.code, 0);
  assert.match(r.out, /contained/);
});

test("out-of-subtree parent is outward, exit 3 (fail-closed)", () => {
  const r = run("contain", "M", "--parent", "U", "--ancestry", anc(["U", "OTHER_ROOT"]));
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
});

test("the mandate's ancestor (expanding upward) is outward", () => {
  // parent P is the mandate's parent — deepening would go down, not up.
  const r = run("contain", "M", "--parent", "P", "--ancestry", anc(["M", "P"]));
  assert.equal(r.code, 3);
});

test("--root (intended new root) is outward, exit 3", () => {
  const r = run("contain", "M", "--root");
  assert.equal(r.code, 3);
  assert.match(r.out, /outward/);
  assert.match(r.out, /new root/);
});

test("unknown/absent parentId is outward (fail-closed)", () => {
  // X has no entry in the supplied chain → the link is unknown → outward.
  const r = run("contain", "M", "--parent", "X", "--ancestry", anc(["Z", "M"]));
  assert.equal(r.code, 3);
});

test("explicit null parentId (a root that isn't the mandate) is outward", () => {
  const r = run("contain", "M", "--parent", "R", "--ancestry", anc(["R", null]));
  assert.equal(r.code, 3);
});

test("a cycle in the supplied ancestry is outward (visited guard, fail-closed)", () => {
  const r = run("contain", "M", "--parent", "A", "--ancestry", anc(["A", "B"], ["B", "A"]));
  assert.equal(r.code, 3);
});

test("--json emits the structured verdict for contained", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]), "--json");
  assert.equal(r.code, 0);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "M", parent: "C", root: false, verdict: "contained" });
});

test("--json emits the structured verdict for an outward root", () => {
  const r = run("contain", "M", "--root", "--json");
  assert.equal(r.code, 3);
  const o = JSON.parse(r.out);
  assert.deepEqual(o, { mandate: "M", parent: null, root: true, verdict: "outward" });
});

// --- usage / malformed-args (exit 2, never a silent verdict) ---

test("missing mandate is a usage error (exit 2)", () => {
  assert.equal(run("contain").code, 2);
});

test("neither --parent nor --root is a usage error (exit 2)", () => {
  const r = run("contain", "M");
  assert.equal(r.code, 2);
  assert.match(r.err, /exactly one of --parent .* or --root/);
});

test("--parent and --root together is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--root");
  assert.equal(r.code, 2);
  assert.match(r.err, /mutually exclusive/);
});

test("malformed --ancestry JSON is a usage error, no verdict (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", "not json");
  assert.equal(r.code, 2);
  assert.match(r.err, /JSON array/);
});

test("--ancestry that isn't an array is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "C", "--ancestry", '{"id":"C"}');
  assert.equal(r.code, 2);
});

test("a non-root --parent (≠ mandate) with no ancestry is a usage error (exit 2)", () => {
  // Can't compute containment for a real parent without the chain → fail loud,
  // never silently outward.
  const r = run("contain", "M", "--parent", "C");
  assert.equal(r.code, 2);
  assert.match(r.err, /--ancestry .* is required/);
});

test("a dangling value flag is a usage error (exit 2)", () => {
  const r = run("contain", "M", "--parent", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 2);
  assert.match(r.err, /needs a value/);
});

test("the command is PURE — no tracker/network call (smoke: succeeds offline)", () => {
  // No tracker env, no network — a real verdict still computes from the supplied
  // ancestry alone. (The CLI makes no MCP call by construction.)
  const r = run("contain", "M", "--parent", "C", "--ancestry", anc(["C", "M"]));
  assert.equal(r.code, 0);
});
