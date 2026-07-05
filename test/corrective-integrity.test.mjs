// FAFF-373 — the corrective-integrity fail-safe gate: distrust-by-default over the
// FAFF-278 forge surface. Exercises the pure functions in-process (injected `fsq`,
// zero real fs/network) and the CLI seam via runCli. Per ADR 0002 — assert the
// deterministic seam (returned object / exit / parsed JSON), never prose.
//
// The bin is an extensionless CommonJS file; imported from ESM it exposes only the
// default export, so we destructure the three exported pure functions off it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import faff from "../plugin/skills/faff/bin/faff";

const { correctiveIntegrityProbe, integrityGate, correctiveIntegrityDirs } = faff;

// The probe defaults asserted:false for EVERY input — the trusting `signal`
// channel is FAFF-325; here no trusted source exists, so nothing flips it.
test("probe → asserted:false / no-boundary-signal for all inputs", () => {
  const realish = { exists: () => false, readEnviron: () => "" };
  for (const [env, sig] of [
    [{}, undefined],
    [{ FAFF_RUN_DIR: "/run" }, undefined],
    [{ container: "lxc" }, null],
    [{}, "trust-me"],
    [{}, { asserted: true }],
  ]) {
    const p = correctiveIntegrityProbe(env, realish, sig);
    assert.equal(p.asserted, false, JSON.stringify({ env, sig }));
    assert.equal(p.basis, "no-boundary-signal");
  }
});

// THE security-critical case: a `signal` sourced from a build-lane-writable
// (shared-fs) location must NOT flip the probe to trusted — that would re-open the
// exact forge this gate closes.
test("probe: a shared-fs-sourced signal does NOT flip to trusted", () => {
  const sharedFsFsq = { exists: () => true, readEnviron: () => "container=forged\0FAFF_ASSERTED=1" };
  const forgedSignal = { asserted: true, source: "shared-fs", path: "/run/forged" };
  const p = correctiveIntegrityProbe({ FAFF_ASSERTED: "1" }, sharedFsFsq, forgedSignal);
  assert.equal(p.asserted, false);
  assert.equal(p.basis, "no-boundary-signal");
});

// Unasserted gate dispositions: corrective degrades to Channel D, detection to
// reconcile-only.
test("gate: unasserted corrective → channel-D", () => {
  const g = integrityGate({ asserted: false, basis: "no-boundary-signal" }, "corrective");
  assert.deepEqual(g, { trusted: false, disposition: "channel-D" });
});

test("gate: unasserted detection → reconcile-only", () => {
  const g = integrityGate({ asserted: false, basis: "no-boundary-signal" }, "detection");
  assert.deepEqual(g, { trusted: false, disposition: "reconcile-only" });
});

// An unknown consumer fails safe to Channel D — never trusted.
test("gate: unknown consumer → not trusted / channel-D", () => {
  for (const consumer of ["wat", "", undefined, null, "ledger"]) {
    const g = integrityGate({ asserted: false }, consumer);
    assert.equal(g.trusted, false, `consumer=${consumer}`);
    assert.equal(g.disposition, "channel-D");
  }
});

// The asserted:true → trusted branch is the FAFF-325 seam — reachable only from a
// SYNTHETIC probe result, never from the probe in this ticket.
test("gate: synthetic asserted:true → trusted (the FAFF-325 seam)", () => {
  assert.deepEqual(integrityGate({ asserted: true }, "corrective"), { trusted: true, disposition: "trusted" });
  assert.deepEqual(integrityGate({ asserted: true }, "detection"), { trusted: true, disposition: "trusted" });
});

// Fail-safe against a malformed probe result: only a strict === true asserts.
test("gate: truthy-but-not-true asserted is NOT trusted (fail-safe)", () => {
  for (const bad of [{ asserted: 1 }, { asserted: "true" }, {}, null, undefined]) {
    const g = integrityGate(bad, "corrective");
    assert.equal(g.trusted, false, JSON.stringify(bad));
    assert.equal(g.disposition, "channel-D");
  }
});

// The integrity-dir set is single-sourced from the run-dir layout: every path is
// under the run dir, and it includes both the ledger path and the corrective dir.
test("correctiveIntegrityDirs: all paths under runDir, includes the ledger path", () => {
  const runDir = path.join("/tmp", "faff", "runs", "20260705-lights-out");
  const dirs = correctiveIntegrityDirs(runDir);
  assert.ok(Array.isArray(dirs) && dirs.length >= 2);
  for (const d of dirs) {
    assert.ok(d === runDir || d.startsWith(runDir + path.sep), `not under runDir: ${d}`);
  }
  assert.ok(dirs.includes(path.join(runDir, "run-ledger.json")), "missing the ledger path");
  assert.ok(dirs.includes(path.join(runDir, "corrective")), "missing the corrective-artifact dir");
});

// CLI seam: the selftest table passes (exit 0).
test("corrective-integrity --selftest: table passes (exit 0)", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

// CLI seam: default consumer (corrective) → asserted:false, channel-D, exit 0.
test("corrective-integrity --json: asserted:false / channel-D, exit 0", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--json"]);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.asserted, false);
  assert.equal(out.basis, "no-boundary-signal");
  assert.equal(out.trusted, false);
  assert.equal(out.disposition, "channel-D");
});

// CLI seam: consumer=detection → reconcile-only, still exit 0 (degrade, not refuse).
test("corrective-integrity --consumer detection --json: reconcile-only, exit 0", () => {
  const { stdout, code } = runCli(["corrective-integrity", "--consumer", "detection", "--json"]);
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.asserted, false);
  assert.equal(out.trusted, false);
  assert.equal(out.disposition, "reconcile-only");
});
