// FAFF-391 — ci-triage CLI surface + contract.
// Exercises the deterministic seam (exit codes / --selftest tables / arg validation / the pure
// classifiers and the flaky-register fold) of the new CI failure-triage mechanism. The impure gh/git
// path (observing the PR head + main head check-runs) is covered by the spec's own integration smoke
// test, not here — parity with merge-gate.test.mjs's own precedent for the identical impure-shell split.
// Per ADR 0002 (assert at the CLI/module seam, never narrative text).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const {
  classifyFaultDomainFromMetadata, classifyOrigin, failingCheckNames,
  flakyRegisterPath, readFlakyRegister, recordFlakyEvent, writeFlakyRegister,
} = require("../plugin/skills/faff/bin/lib/ci-triage.js");
const { deriveTriageAction } = require("../plugin/skills/faff/bin/lib/contract-defs.js");

// --- pure --selftest tables (no network) ---
test("ci-triage --selftest: the pure cores pass (deriveTriageAction table + classifiers + register fold)", () => {
  const { code } = runCli(["ci-triage", "--selftest"]);
  assert.equal(code, 0);
});

test("contract ci-triage --selftest: the fixture table passes", () => {
  const { code } = runCli(["contract", "ci-triage", "--selftest"]);
  assert.equal(code, 0);
});

// --- ci-triage arg validation (fail-loud before any gh call) ---
test("ci-triage: missing --pr/--issue/--run-dir -> exit 2, before any gh call", () => {
  const { code, stderr } = runCli(["ci-triage"]);
  assert.equal(code, 2);
  assert.match(stderr, /--pr, --issue and --run-dir are required/);
});

test("ci-triage: --json is accepted (still exits 2 on missing required flags, never crashes on the flag)", () => {
  const { code } = runCli(["ci-triage", "--issue", "FAFF-1", "--json"]);
  assert.equal(code, 2);
});

// --- deriveTriageAction (contract-defs.js): the CONSTRAINT that action is a pure fn of the 3 axes ---
const AXIS = {
  transience: ["transient", "persistent", "unknown"],
  fault_domain: ["infra", "code", "unknown"],
  origin: ["mine", "main-was-red", "unknown"],
};
function wantAction(transience, fault_domain, origin) {
  if (origin === "main-was-red" || origin === "unknown") return "park-needs-human";
  if (transience === "transient") return "proceed-to-merge-gate";
  if (transience === "unknown") return "park-needs-human";
  if (fault_domain === "infra") return "park-errored";
  if (fault_domain === "code") return "fix-attempt";
  return "park-needs-human";
}
for (const transience of AXIS.transience) {
  for (const fault_domain of AXIS.fault_domain) {
    for (const origin of AXIS.origin) {
      test(`deriveTriageAction(${transience},${fault_domain},${origin})`, () => {
        assert.equal(deriveTriageAction(transience, fault_domain, origin), wantAction(transience, fault_domain, origin));
      });
    }
  }
}
test("deriveTriageAction: main-was-red wins even over a transient result (never spends the fix attempt on a pre-broken main)", () => {
  assert.equal(deriveTriageAction("transient", "code", "main-was-red"), "park-needs-human");
});
test("deriveTriageAction: transient proceeds regardless of an unknown fault domain (the real procedure never asks the fault-domain question on a green re-run)", () => {
  assert.equal(deriveTriageAction("transient", "unknown", "mine"), "proceed-to-merge-gate");
});

// --- classifyFaultDomainFromMetadata: mechanical-first, never guesses "code" ---
test("fault-domain: startup_failure -> infra", () => {
  assert.equal(classifyFaultDomainFromMetadata([{ name: "build", conclusion: "startup_failure" }]), "infra");
});
test("fault-domain: timed_out -> infra", () => {
  assert.equal(classifyFaultDomainFromMetadata([{ name: "build", conclusion: "timed_out" }]), "infra");
});
test("fault-domain: a plain failure conclusion -> unknown, never mechanically guessed as code", () => {
  assert.equal(classifyFaultDomainFromMetadata([{ name: "build", conclusion: "failure" }]), "unknown");
});

// --- classifyOrigin: per-check, fail-closed on an unreadable main ---
test("origin: main unreadable (null) -> unknown, fail-closed (never silently 'mine')", () => {
  assert.equal(classifyOrigin(["build"], null), "unknown");
});
test("origin: main red on the SAME check -> main-was-red", () => {
  assert.equal(classifyOrigin(["build"], [{ name: "build", status: "completed", conclusion: "failure" }]), "main-was-red");
});
test("origin: main red on a DIFFERENT check -> mine (main-was-red is per-check, not per-repo)", () => {
  assert.equal(classifyOrigin(["build"], [{ name: "lint", status: "completed", conclusion: "failure" }]), "mine");
});

// --- failingCheckNames: pending never reads as failing; an unrecognised conclusion fails closed ---
test("failingCheckNames: a pending (non-completed) run is excluded", () => {
  assert.equal(failingCheckNames([{ name: "build", status: "in_progress", conclusion: null }]).length, 0);
});
test("failingCheckNames: an unrecognised terminal conclusion still counts as failing (fail-closed)", () => {
  assert.deepEqual(failingCheckNames([{ name: "build", status: "completed", conclusion: "weird" }]), ["build"]);
});

// --- the flaky register: pure in-memory fold + a real fs round-trip (no network) ---
test("recordFlakyEvent: quarantines at exactly 3 events and never re-quarantines an already-ticketed signature", () => {
  const ev = (n) => ({ observed_at: `t${n}`, head_sha: `sha${n}`, run_ref: `pr:${n}` });
  let reg = { entries: [] };
  let r = recordFlakyEvent(reg, "build", ev(1));
  assert.equal(r.justQuarantined, false);
  r = recordFlakyEvent(r.register, "build", ev(2));
  assert.equal(r.justQuarantined, false);
  r = recordFlakyEvent(r.register, "build", ev(3));
  assert.equal(r.justQuarantined, true);
  const ticket = r.register.entries.find((e) => e.signature === "build").quarantine_ticket;
  assert.ok(ticket);
  const r4 = recordFlakyEvent(r.register, "build", ev(4));
  assert.equal(r4.justQuarantined, false);
  assert.equal(r4.register.entries.find((e) => e.signature === "build").quarantine_ticket, ticket);
});

test("recordFlakyEvent: a different signature gets its own independent entry", () => {
  const reg = { entries: [{ signature: "build", events: [{ observed_at: "t1", head_sha: "s1", run_ref: "pr:1" }], quarantine_ticket: null }] };
  const r = recordFlakyEvent(reg, "lint", { observed_at: "t2", head_sha: "s2", run_ref: "pr:2" });
  assert.equal(r.register.entries.length, 2);
  assert.equal(r.register.entries.find((e) => e.signature === "build").events.length, 1);
});

test("flaky register: absent file -> empty register (never crash), and a write round-trips through the single accessor", () => {
  const tmp = mkdtempSync(join(tmpdir(), "faff-ci-triage-test-"));
  try {
    assert.deepEqual(readFlakyRegister(tmp), { entries: [] });
    const reg = { entries: [{ signature: "build", events: [{ observed_at: "t1", head_sha: "s1", run_ref: "pr:1" }], quarantine_ticket: null }] };
    writeFlakyRegister(tmp, reg);
    assert.deepEqual(readFlakyRegister(tmp), reg);
    assert.equal(flakyRegisterPath(tmp), join(tmp, "docs", "ci", "flaky-register.json"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
