// FAFF-710 — the deterministic bundled-membership predicate `faff validate-adapters --is-bundled
// <occupant> --slot <slot>` the runtime slot-conformance gate consults before deciding whether to
// run the LLM semantic Validate. Every branch is exercised for its exit code (the contract):
//   0 = bundled first-party in its right slot (exempt) · 1 = foreign OR bundled-but-wrong-slot
//   (validate) · 2 = usage (missing/blank name, or missing/unknown slot).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");

const run = (...args) =>
  spawnSync(process.execPath, [BIN, "validate-adapters", "--is-bundled", ...args], { encoding: "utf8" });

test("bundled first-party in its right slot → exit 0 (exempt)", () => {
  const r = run("faffter-dark-nlspec", "--slot", "spec");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /bundled first-party for slot spec/);
});

test("bundled methodology occupant in the methodology slot → exit 0", () => {
  const r = run("faffter-dark-methodology-agile-delivery", "--slot", "methodology");
  assert.equal(r.status, 0);
});

test("a shipped default is also a REGISTRY member → exit 0 in its slot", () => {
  const r = run("faffter-noon-spec", "--slot", "spec");
  assert.equal(r.status, 0);
});

test("foreign occupant (not in REGISTRY) → exit 1 (validate)", () => {
  const r = run("some-user-skill", "--slot", "spec");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /foreign \(not in REGISTRY\)/);
});

test("bundled skill in the WRONG slot → exit 1 (validate, no widening)", () => {
  // faffter-noon-ship is a REGISTRY member (producer-ship) but the spec slot is producer-spec.
  const r = run("faffter-noon-ship", "--slot", "spec");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /bundled but wrong slot/);
});

test("blank occupant name → exit 2 (usage)", () => {
  const r = run("", "--slot", "spec");
  assert.equal(r.status, 2);
});

test("no --slot flag at all → exit 2 (usage — slot is required)", () => {
  // A valid occupant name but the --slot flag omitted entirely: the predicate cannot classify
  // without a slot, so it is a usage error, distinct from an unknown slot *value* (test below).
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--is-bundled", "faffter-dark-nlspec"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing\/unknown --slot/);
});

test("unknown slot → exit 2 (usage)", () => {
  const r = run("faffter-dark-nlspec", "--slot", "bogus");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing\/unknown --slot/);
});

test("the predicate reads no config — same verdict with no .faffrc in cwd", () => {
  // Run from a directory with no .faffrc; the predicate must still classify (pure REGISTRY lookup).
  const r = spawnSync(process.execPath, [BIN, "validate-adapters", "--is-bundled", "faffter-dark-nlspec", "--slot", "spec"],
    { encoding: "utf8", cwd: HERE });
  assert.equal(r.status, 0);
});
