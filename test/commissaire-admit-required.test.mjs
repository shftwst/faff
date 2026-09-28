// FAFF-1140 — fail closed on a Commissaire admit failure when governance is *required*.
//
// Covers the four deterministic changes + the shared-resolver invariant:
//   1. `faff commissaire admit-required` — the pure run-start governance-required read.
//   2. `cmdAdmit` returns exit 4 (nothing written) when the keypair/master mint throws.
//   3. `governance-admit-failed` is an escalate-class stop_reason.
//   4. the merge-floor governance-required sentinel fails closed with no schema:3 records.
//   +  the abort-axis `unattended` is ONE shared function (no second resolver drift).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { resolveAbortAxisUnattended, actsOnSentryAbort } from "../plugin/skills/faff/bin/lib/sentry.js";
import { requiresSelfConsistencyStamp } from "../plugin/skills/faff/bin/lib/shared-infra.js";
import { ESCALATE_STOP_EXACT, isEscalateStopReason } from "../plugin/skills/faff/bin/lib/disposition.js";
import { governanceRequiredSentinelPresent, resolveCommissaireDecisionGrant } from "../plugin/skills/faff/bin/lib/merge-gate.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const require = createRequire(import.meta.url);

function run(args, env = {}) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: { HOME: process.env.HOME, PATH: process.env.PATH, ...env } });
  return { code: r.status ?? 1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? "").toString() };
}

// Provision a run dir with a ledger under <root>/.faff/runs/<id>, optional .faffrc.yaml at <root>.
function mkRun(ledgerText, faffrc) {
  const root = mkdtempSync(join(tmpdir(), "cmsr-1140-"));
  const rd = join(root, ".faff", "runs", "RUN-1140");
  mkdirSync(rd, { recursive: true });
  if (ledgerText != null) writeFileSync(join(rd, "run-ledger.json"), ledgerText);
  if (faffrc != null) writeFileSync(join(root, ".faffrc.yaml"), faffrc);
  return { root, rd };
}

// -----------------------------------------------------------------------------------------------
// 1. admit-required — the pure run-start governance-required read
// -----------------------------------------------------------------------------------------------

test("admit-required: an unattended L4 ledger ⇒ governance_required:true (fail-closed)", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L4", owner: { status: "running" } }));
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { governance_required: true, unattended: true, dispatch_state: "absent" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("admit-required: an attended L3 ledger (no unattended declaration) ⇒ governance_required:false", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L3", owner: { status: "running" } }));
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { governance_required: false, unattended: false, dispatch_state: "absent" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("admit-required: an L3 ledger that declared autonomous.unattended:true ⇒ governance_required:true", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L3", owner: { status: "running" } }), "autonomous:\n  unattended: true\n");
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { governance_required: true, unattended: true, dispatch_state: "absent" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("admit-required: the retained sentry_acting alias also asserts unattended ⇒ governance_required:true", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L3", owner: { status: "running" } }), "autonomous:\n  sentry_acting: true\n");
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).governance_required, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("admit-required: a malformed/unreadable ledger ⇒ governance_required:true (cannot prove optional), exit 0", () => {
  const { root, rd } = mkRun("{ not json");
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { governance_required: true, unattended: true, dispatch_state: "absent" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("admit-required: a missing run-dir ⇒ governance_required:true, exit 0 (pure read, fail-closed)", () => {
  const { root, rd } = mkRun(null);
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", join(rd, "nope"), "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).governance_required, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A readable ledger (L3, non-L4) whose unattendedness is *declared in config* fails closed when the
// governance config is UNREADABLE — the fly-ci-l3-runner case cannot prove itself optional. A
// top-level-sequence base throws `base-parse-error` (FAFF-577), the unreadable-config path.
test("admit-required: an L3 ledger + an UNREADABLE governance config ⇒ governance_required:true (fail-closed)", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L3", owner: { status: "running" } }), "- just\n- a\n- list\n");
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(JSON.parse(r.out), { governance_required: true, unattended: true, dispatch_state: "absent" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The complement (guarding against over-fail-closing): a READABLE config that simply lacks
// autonomous.unattended is legitimately optional ⇒ fail-open, unchanged.
test("admit-required: an L3 ledger + a readable config WITHOUT autonomous.unattended ⇒ governance_required:false (fail-open)", () => {
  const { root, rd } = mkRun(JSON.stringify({ level: "L3", owner: { status: "running" } }), "tracking:\n  repo: x\n");
  try {
    const r = run(["commissaire", "admit-required", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).governance_required, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------------------------------
// The shared abort-axis resolver — ONE function, no second definition
// -----------------------------------------------------------------------------------------------

test("resolveAbortAxisUnattended: abort-axis semantics (L4 OR declared-unattended)", () => {
  assert.equal(resolveAbortAxisUnattended({ level: "L4" }, {}), true);          // L4 short-circuit, no config
  assert.equal(resolveAbortAxisUnattended({ level: "L3" }, {}), false);         // attended L3, unset config
  assert.equal(resolveAbortAxisUnattended({ level: "L3" }, { autonomous: { unattended: true } }), true);
  assert.equal(resolveAbortAxisUnattended({ level: "L3" }, { autonomous: { sentry_acting: true } }), true); // retained alias
  assert.equal(resolveAbortAxisUnattended(null, {}), false);                    // no ledger, no config
});

test("the sentry-poller path is unchanged: actsOnSentryAbort delegates to the SAME shared resolver", () => {
  for (const led of [null, { level: "L4" }, { level: "L3" }]) {
    for (const cfg of [{}, { autonomous: { unattended: true } }, { autonomous: { sentry_acting: true } }]) {
      assert.equal(actsOnSentryAbort(led, cfg), resolveAbortAxisUnattended(led, cfg),
        `drift for ledger=${JSON.stringify(led)} cfg=${JSON.stringify(cfg)}`);
    }
  }
});

// -----------------------------------------------------------------------------------------------
// 2. cmdAdmit exit 4 — a keypair/master mint failure surfaces cleanly, nothing written
// -----------------------------------------------------------------------------------------------

test("cmdAdmit: a randomBytes throw ⇒ exit 4 and NOTHING written (no partial governor.json)", () => {
  const crypto = require("node:crypto");
  const { COMMISSAIRE_DISPATCH } = require("../plugin/skills/faff/bin/lib/commissaire.js");
  const orig = crypto.randomBytes;
  const root = mkdtempSync(join(tmpdir(), "cmsr-1140-mint-"));
  try {
    crypto.randomBytes = () => { throw new Error("mint boom"); };
    const rc = COMMISSAIRE_DISPATCH["contract admit"]({
      "--run-dir": root, "--producer": "P1", "--contract-revision": "r1", "--scope": "merge",
    });
    assert.equal(rc, 4, "exit 4 on mint failure");
    assert.equal(existsSync(join(root, "commissaire", "governor", "governor.json")), false, "no governor.json written");
    assert.equal(existsSync(join(root, "commissaire", "producer", "P1.json")), false, "no producer material written");
    assert.equal(existsSync(join(root, "declared-effects.jsonl")), false, "no admission record appended");
  } finally {
    crypto.randomBytes = orig;
    rmSync(root, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------------------------
// 3. the escalate-class stop_reason token
// -----------------------------------------------------------------------------------------------

test("governance-admit-failed is an escalate-class stop_reason", () => {
  assert.ok(ESCALATE_STOP_EXACT.has("governance-admit-failed"));
  assert.equal(isEscalateStopReason("governance-admit-failed"), true);
  assert.equal(isEscalateStopReason("some-quiet-stop"), false); // control
});

// End-to-end: a run that shipped everything but carries stop_reason:"governance-admit-failed"
// still surfaces a run-escalation item through `faff disposition` (exit 1), so a headless wrapper
// and the operator both see the refusal — not just membership in the set.
test("faff disposition: a governance-admit-failed stop_reason ⇒ a run-escalation item, exit 1", () => {
  const { root, rd } = mkRun(JSON.stringify({
    run_id: "RUN-1140", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" },
    stop_reason: "governance-admit-failed", owner: { status: "done" },
  }));
  try {
    const r = run(["disposition", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 1, r.err);
    const rep = JSON.parse(r.out);
    assert.equal(rep.disposition, "needs-attention");
    assert.ok(rep.attention.some((it) => it.kind === "run-escalation" && it.cause === "governance-admit-failed"),
      `expected a run-escalation item keyed on governance-admit-failed, got ${JSON.stringify(rep.attention)}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------------------------------
// 4. merge-floor governance-required sentinel — fail-closed with no schema:3 records
// -----------------------------------------------------------------------------------------------

test("merge-floor: a run bearing the governance-required sentinel with no schema:3 ⇒ absent-or-invalid (fail-closed)", () => {
  const root = mkdtempSync(join(tmpdir(), "cmsr-1140-sentinel-"));
  try {
    mkdirSync(join(root, "commissaire"), { recursive: true });
    writeFileSync(join(root, "commissaire", "governance-required.json"), JSON.stringify({ governance_required: true }));
    assert.equal(governanceRequiredSentinelPresent(root), true);
    assert.equal(resolveCommissaireDecisionGrant(root, "FAFF-1", "main"), "absent-or-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("merge-floor: an ordinary run with NO sentinel and no schema:3 ⇒ not-applicable (unchanged, no new wedge)", () => {
  const root = mkdtempSync(join(tmpdir(), "cmsr-1140-plain-"));
  try {
    assert.equal(governanceRequiredSentinelPresent(root), false);
    assert.equal(resolveCommissaireDecisionGrant(root, "FAFF-1", "main"), "not-applicable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("governanceRequiredSentinelPresent: absent / malformed / non-true ⇒ false (never throws)", () => {
  const root = mkdtempSync(join(tmpdir(), "cmsr-1140-reader-"));
  try {
    assert.equal(governanceRequiredSentinelPresent(root), false); // absent
    mkdirSync(join(root, "commissaire"), { recursive: true });
    writeFileSync(join(root, "commissaire", "governance-required.json"), "{ not json");
    assert.equal(governanceRequiredSentinelPresent(root), false); // malformed
    writeFileSync(join(root, "commissaire", "governance-required.json"), JSON.stringify({ governance_required: false }));
    assert.equal(governanceRequiredSentinelPresent(root), false); // explicit non-true
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// -----------------------------------------------------------------------------------------------
// the relocated predicate keeps its single definition
// -----------------------------------------------------------------------------------------------

test("requiresSelfConsistencyStamp: unattended AND dispatch_state==absent is the only blocking case", () => {
  assert.equal(requiresSelfConsistencyStamp(true, "absent"), true);
  assert.equal(requiresSelfConsistencyStamp(false, "absent"), false);
  assert.equal(requiresSelfConsistencyStamp(true, "dispatched"), false);
  assert.equal(requiresSelfConsistencyStamp(true, "indeterminate"), false);
});
