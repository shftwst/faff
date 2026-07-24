// FAFF-598 — `faff contract <name> --describe` surface tests.
//
// Covers the CLI dispatch (index / named markdown / named JSON / usage errors / no-stdin) and the
// selftest's describe-coverage checks (contractSelftest folds in describeChecks per contract — this
// asserts the negative behaviour the DoD names: a mutated describe entry with a missing semantics
// key, or a rendered output missing a value, reports a FAIL row and a non-zero exit).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const faffBin = path.join(repoRoot, "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);
const contractDefs = require("../plugin/skills/faff/bin/lib/contract-defs.js");

function run(args, opts = {}) {
  return spawnSync("node", [faffBin, ...args], { encoding: "utf8", ...opts });
}

// --- CLI dispatch ---

test("--describe (unnamed) lists all 22 dispatcher-known contracts, one line each, exit 0", () => {
  const r = run(["contract", "--describe"]);
  assert.equal(r.status, 0);
  const lines = r.stdout.trim().split("\n");
  assert.equal(lines.length, Object.keys(contractDefs.CONTRACTS).length);
  for (const name of Object.keys(contractDefs.CONTRACTS)) {
    assert.ok(lines.some((l) => l.startsWith(`${name} — `)), `index is missing ${name}`);
  }
});

test("<name> --describe renders markdown enumerating every described enum value verbatim, exit 0", () => {
  const r = run(["contract", "spec-review-verdict", "--describe"]);
  assert.equal(r.status, 0);
  for (const v of ["approve", "revise", "reject-approach", "needs-human", "architectural", "infosec", "methodology", "QA", "blocker", "major", "minor"]) {
    assert.ok(r.stdout.includes(v), `describe output missing enum value ${v}`);
  }
  assert.match(r.stdout, /^# faff contract spec-review-verdict/);
  assert.match(r.stdout, /## Envelope/);
});

test("<name> --describe --json parses and values[*].semantics keys equal the enum exactly", () => {
  const r = run(["contract", "spec-review-verdict", "--describe", "--json"]);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.name, "spec-review-verdict");
  assert.ok(parsed.purpose.length > 0);
  for (const group of parsed.values) {
    const semKeys = Object.keys(group.semantics).sort();
    const enumKeys = [...group.enum].sort();
    assert.deepEqual(semKeys, enumKeys, `values[].semantics keys must equal enum for ${group.field}`);
  }
});

test("every dispatcher-known contract's --describe completes without reading stdin (no tty hang)", () => {
  for (const name of Object.keys(contractDefs.CONTRACTS)) {
    const r = spawnSync("node", [faffBin, "contract", name, "--describe"], { encoding: "utf8", input: "", timeout: 5000 });
    assert.equal(r.status, 0, `${name} --describe should exit 0`);
    assert.ok(!r.error, `${name} --describe should not time out waiting on stdin`);
  }
});

test("--json without --describe is a usage error (exit 2)", () => {
  const r = run(["contract", "spec-review-verdict", "--json"], { input: '{"verdict":"approve","objections":[]}' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json requires --describe/);
});

test("--describe --in FILE is a usage error (exit 2)", () => {
  const r = run(["contract", "spec-review-verdict", "--describe", "--in", "/tmp/whatever"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--describe takes no input/);
});

test("--selftest precedence is unchanged (fires before --describe)", () => {
  const r = run(["contract", "spec-review-verdict", "--selftest"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RESULT: PASS/);
});

test("unknown <name> --describe exits 2 naming the known set", () => {
  const r = run(["contract", "bogus-contract-name", "--describe"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown contract 'bogus-contract-name'/);
  assert.match(r.stderr, /spec-review-verdict/);
});

test("the validation path is byte-identical to today for a golden case (describe never touches it)", () => {
  const r = run(["contract", "spec-review-verdict"], { input: '{"verdict":"approve","objections":[]}' });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { verdict: "approve", objections: [], conformant: true, violations: [] });
});

// --- selftest describe-coverage checks (negative behaviour) ---

test("selftest FAILs when a describe entry's semantics is missing a key for an enum value", () => {
  const CONTRACTS = contractDefs.CONTRACTS;
  const saved = CONTRACTS["spec-review-verdict"].describe;
  const mutated = JSON.parse(JSON.stringify(saved));
  delete mutated.values[0].semantics[mutated.values[0].enum[0]];
  CONTRACTS["spec-review-verdict"].describe = mutated;
  try {
    // contractSelftest logs to stdout and returns a status; call it directly via the module to avoid
    // a second process spawn re-requiring a fresh (unmutated) copy of contract-defs.js.
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let status;
    try { status = contractDefs.contractSelftest("spec-review-verdict"); }
    finally { console.log = origLog; }
    assert.equal(status, 1, "a semantics gap must fail the selftest (exit 1)");
    assert.ok(logs.some((l) => l.includes("FAIL") && l.includes("semantics-covers-every-enum-value")), "expected a FAIL row naming the semantics gap");
  } finally {
    CONTRACTS["spec-review-verdict"].describe = saved;
  }
});

test("selftest FAILs when a describe entry's purpose is empty", () => {
  const CONTRACTS = contractDefs.CONTRACTS;
  const saved = CONTRACTS["automation-routing"].describe;
  CONTRACTS["automation-routing"].describe = { ...saved, purpose: "" };
  try {
    const logs = [];
    const origLog = console.log;
    console.log = (...a) => logs.push(a.join(" "));
    let status;
    try { status = contractDefs.contractSelftest("automation-routing"); }
    finally { console.log = origLog; }
    assert.equal(status, 1);
    assert.ok(logs.some((l) => l.includes("FAIL") && l.includes("purpose-present")));
  } finally {
    CONTRACTS["automation-routing"].describe = saved;
  }
});

test("unnamed --selftest still runs the describe checks for all 22 and stays green on shipped data", () => {
  const r = run(["contract", "--selftest"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RESULT: PASS/);
  assert.match(r.stdout, /describe\/purpose-present/);
});
