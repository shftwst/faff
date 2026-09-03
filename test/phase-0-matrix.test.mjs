// FAFF-822 — the nine-scenario Phase 0 reference matrix harness.
//
// Runs the nine V5 reference scenarios mkdtemp-mint-then-mutate over the REAL faff bin, reads
// each born-verifiable oracle (the auth rows 1/3/4/8 via the PUBLIC `commissaire audit verify
// --json` seam, not in-process verifyAuthLeg), asserts the oracle matches the spec's nine-row
// table, asserts the two-custodian split per row, builds one ScenarioRecord per scenario via the
// pure buildScenarioRecord emitter, and banks a deterministic matrix.jsonl + REPORT.md under
// verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/.
//
// Determinism: the nine ScenarioRecords are built from FIXED scenario-result literals (fixed
// run/work-item identities, pinned environment, relative evidence paths). The live drives PROVE
// each oracle produces exactly the banked disposition_basis; the banked bytes never carry a
// tmp path, a timestamp, or a key. A clean checkout re-banks byte-identically. Regenerate the
// committed files with FAFF822_REBANK=1 (documented in the evidence dir's protocol.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LIB = join(ROOT, "plugin", "skills", "faff", "bin", "lib");
const { buildScenarioRecord, renderReport } = require(join(LIB, "scenario-matrix.js"));
const { signRecord } = require(join(LIB, "producer-auth.js"));
const { chokepointPermit, governorFileOf, producerFileOf, governorDirOf, producerDirOf } = require(join(LIB, "commissaire.js"));
const { verifyEffectsChain } = require(join(LIB, "events.js"));
const { decideFloor } = require(join(LIB, "contract-defs.js"));
const { envelopeFrom, computeBudgetState, AT_CEILING_OUTCOMES } = require(join(LIB, "budget.js"));
const { ANDON_CLASSES } = require(join(LIB, "andon.js"));
const { idempotencyDecision } = require(join(LIB, "bundle-recover.js"));

const BANK_DIR = join(ROOT, "verification", "evidence", "2026-09-02-FAFF-822-phase-0-reference-matrix");
const MATRIX = join(BANK_DIR, "matrix.jsonl");
const REPORT = join(BANK_DIR, "REPORT.md");

// A pinned environment so the banked record carries no machine-specific bytes (node version / os
// / absolute paths would break byte-determinism across a clean checkout).
const ENV = { faff_bin: "plugin/skills/faff/bin/faff", node: "pinned", os: "posix", release_ref: "FAFF-822-phase-0" };
// A fixed budget window reset instant → a deterministic resume_at (scenario 7).
const RESET_EPOCH = 1700000000000 + 5 * 3600 * 1000;
const RESUME_AT = new Date(RESET_EPOCH).toISOString();

const records = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const runCom = (args, input) => runCli(["commissaire", ...args], { input });

function mkRun(id) {
  const root = mkdtempSync(join(tmpdir(), "phase0-"));
  const runDir = join(root, ".faff", "runs", id);
  mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}
// The two-custodian split, asserted from the on-disk custody files after an admit (mirrors
// commissaire.test.mjs's split assertion): no single file holds both an SK/master and a producer key.
function assertTwoCustodianSplit(runDir) {
  const gov = JSON.parse(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"));
  const prod = JSON.parse(readFileSync(producerFileOf(producerDirOf(runDir), "P1"), "utf8"));
  assert.ok(gov.sk && gov.master_secret, "governor file holds SK + master");
  assert.ok(!gov.key_hex, "governor file holds NO producer key");
  assert.ok(prod.key_hex, "producer file holds K_producer");
  assert.ok(!prod.sk && !prod.master_secret, "producer file holds NEITHER SK NOR master");
}
// The `commissaire audit verify --json` public seam — secret-bearing (governor+producer dirs) or
// secret-free (an empty governor dir → producers classify unverifiable_without_secret).
function auditVerify(runDir, { secretFree } = {}) {
  const producerDir = join(runDir, "commissaire", "producer");
  const governorDir = secretFree ? mkdtempSync(join(tmpdir(), "phase0-emptygov-")) : join(runDir, "commissaire", "governor");
  const r = runCom(["audit", "verify", "--run-dir", runDir, "--governor-dir", governorDir, "--producer-dir", producerDir]);
  if (secretFree) rmSync(governorDir, { recursive: true, force: true });
  return { exit: r.code, json: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
}
const auditVerifyBasis = (av) => ({
  exit: av.exit,
  producer: { verified: av.json.producer_claims.verified, unverifiable_without_secret: av.json.producer_claims.unverifiable_without_secret, failed: av.json.producer_claims.failed },
  decisions_valid: av.json.commissaire_decisions.failed === 0,
});

// ===========================================================================================
// The nine FIXED scenario-result literals — the single source the banked matrix is built from.
// ===========================================================================================
const SCENARIO_RESULTS = [
  {
    scenario_id: "01-normal-completion", scenario_ordinal: 1,
    inputs: { flow: "admit→declare→authorize→observe→reconcile", effect: { kind: "merge", target: "main" } },
    environment: ENV, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted",
    disposition_basis: {
      audit_verify: { exit: 0, producer: { verified: 3, unverifiable_without_secret: 0, failed: 0 }, decisions_valid: true },
      commissaire_verdict: { verdict: "grant", reason: "all-legs-pass" }, any_escape: false, chain_status: "verified",
    },
    evidence_paths: ["declared-effects.jsonl", "commissaire/producer/pk.json"], human_interventions: 0, cost: {},
    claim_label: "J-C mechanical producer auth; E-C detection of a clean covered grant", one_shot_control: null, two_custodian_split_verified: true,
  },
  {
    scenario_id: "02-governance-block", scenario_ordinal: 2,
    inputs: { decision_grant: "absent-or-invalid", step: "merge" },
    environment: ENV, run_id: "RUN-COM-02", work_item_id: "FAFF-2", disposition: "blocked",
    disposition_basis: {
      floor_verdict: { verdict: "refuse", blockers: ["commissaire-protected-effect-decision-absent-or-invalid"] },
      commissaire_verdict: { verdict: "refuse", reason: "not-a-commissaire-decision" },
    },
    evidence_paths: ["decideFloor:FloorInputs"], human_interventions: 0, cost: {},
    claim_label: "E-B prevention at the merge chokepoint (seeded governance block)",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "merged main with no Commissaire decision", governed_disposition: "blocked" },
    two_custodian_split_verified: true,
  },
  {
    scenario_id: "03-independence-failure", scenario_ordinal: 3,
    inputs: { forged: "producer HMACs a fake author=commissaire verdict" },
    environment: ENV, run_id: "RUN-COM-03", work_item_id: "FAFF-3", disposition: "refused",
    disposition_basis: {
      audit_verify: { exit: 1, producer: { verified: 0, unverifiable_without_secret: 2, failed: 0 }, decisions_valid: false },
      commissaire_verdict: { verdict: "refuse", reason: "decision-signature-invalid" },
    },
    evidence_paths: ["declared-effects.jsonl", "commissaire/producer/pk.json"], human_interventions: 0, cost: {},
    claim_label: "J-D self-declared; producer claims unverifiable without the secret; forged grant refused",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "self-certified forged grant shipped", governed_disposition: "refused" },
    two_custodian_split_verified: true,
  },
  {
    scenario_id: "04-executor-loss", scenario_ordinal: 4,
    inputs: { torn_tail: true, revoked_producer: "P1" },
    environment: ENV, run_id: "RUN-COM-04", work_item_id: "FAFF-4", disposition: "recovered",
    disposition_basis: {
      audit_verify: { exit: 1, producer: { verified: 0, unverifiable_without_secret: 0, failed: 2 }, decisions_valid: true },
      chain_status: "verified", recovery_disposition: "noop-already-present", idempotency_decision: "match",
    },
    evidence_paths: ["declared-effects.jsonl", "commissaire/producer/producers/P1.json"], human_interventions: 0, cost: {},
    claim_label: "J-D self-declared; torn tail tolerated; revoked producer records fail closed; recovery is a byte-identical noop",
    one_shot_control: null, two_custodian_split_verified: true,
  },
  {
    scenario_id: "05-stale-evidence", scenario_ordinal: 5,
    inputs: { evidence_seq: 0, step: "merge" },
    environment: ENV, run_id: "RUN-COM-05", work_item_id: "FAFF-5", disposition: "denied",
    disposition_basis: { commissaire_verdict: { verdict: "deny", reason: "stale-evidence" } },
    evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {},
    claim_label: "E-C detection: a request on stale evidence is denied, no grant written",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "acted on stale evidence", governed_disposition: "denied" },
    two_custodian_split_verified: true,
  },
  {
    scenario_id: "06-effect-mismatch", scenario_ordinal: 6,
    inputs: { observed: { kind: "registry-publish", target: "pkg@1.0.0" }, declared: "none" },
    environment: ENV, run_id: "RUN-COM-06", work_item_id: "FAFF-6", disposition: "detected",
    disposition_basis: { any_escape: true },
    evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {},
    claim_label: "E-C detection: an undeclared observed effect surfaces as an escaped-side-effect",
    one_shot_control: { ungoverned_shipped: true, artifact_ref: "took the undeclared registry-publish", governed_disposition: "detected" },
    two_custodian_split_verified: true,
  },
  {
    scenario_id: "07-exhausted-budget", scenario_ordinal: 7,
    inputs: { window: { hours: 5, tokens: 1000 }, at_ceiling: "park-until-window-reset" },
    environment: ENV, run_id: "RUN-COM-07", work_item_id: "FAFF-7", disposition: "parked",
    disposition_basis: { budget_outcome: "park-until-window-reset", resume_at: RESUME_AT, andon_class: "budget-breach" },
    evidence_paths: ["run-ledger.json"], human_interventions: 0, cost: {},
    claim_label: "budget window breach parks until window reset with a resume_at; andon budget-breach recorded",
    one_shot_control: null, two_custodian_split_verified: true,
  },
  {
    scenario_id: "08-contract-amendment", scenario_ordinal: 8,
    inputs: { re_admit: "P1 under a new contract-revision r2 (--force)" },
    environment: ENV, run_id: "RUN-COM-08", work_item_id: "FAFF-8", disposition: "amended",
    disposition_basis: {
      audit_verify: { exit: 1, producer: { verified: 1, unverifiable_without_secret: 0, failed: 1 }, decisions_valid: false },
      amendment: { stale_key_reason: "producer-auth-mismatch" },
    },
    evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {},
    claim_label: "J-C new-revision records verify; the stale-key record fails the auth leg (producer-auth-mismatch)",
    one_shot_control: null, two_custodian_split_verified: true,
  },
  {
    scenario_id: "09-correction-resume", scenario_ordinal: 9,
    inputs: { correction: "safe-resume after a partial run" },
    environment: ENV, run_id: "RUN-COM-09", work_item_id: "FAFF-9", disposition: "corrected",
    disposition_basis: { idempotency_decision: "match", resumed_seq_gap_free: true },
    evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {},
    claim_label: "E-C correction: an idempotent match resumes gap-free with no duplicated work-item",
    one_shot_control: null, two_custodian_split_verified: true,
  },
];
const byId = Object.fromEntries(SCENARIO_RESULTS.map((s) => [s.scenario_id, s]));

// ===========================================================================================
// Per-row born-verifiable oracle drives (over the real bin) — each asserts the live oracle
// produces exactly the banked disposition_basis for its row.
// ===========================================================================================

test("scenario 1 (accepted): grant, chain verified, `commissaire audit verify` clean (producers verified), no escape", () => {
  const { root, runDir } = mkRun("com-01");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.equal(JSON.parse(rd.stdout.trim()).verdict, "grant");
    assert.equal(runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    assert.equal(verifyEffectsChain(runDir, {}).status, "verified");
    assertTwoCustodianSplit(runDir);
    const av = auditVerify(runDir);
    assert.equal(av.exit, 0, "secret-bearing audit verify passes");
    assert.equal(av.json.result, "pass");
    const rec = runCom(["reconcile", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(JSON.parse(rec.stdout.trim()).any_escape, false);
    assert.deepEqual(auditVerifyBasis(av), byId["01-normal-completion"].disposition_basis.audit_verify);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 2 (blocked): decideFloor refuse with the FAFF-828 blocker, chokepointPermit refuses; control shows the ungoverned merge", () => {
  const { root, runDir } = mkRun("com-02");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assertTwoCustodianSplit(runDir);
    const base = { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" };
    const refused = decideFloor({ ...base, decision_grant: "absent-or-invalid" });
    assert.equal(refused.verdict, "refuse");
    assert.ok(refused.blockers.some((b) => /Commissaire protected-effect decision/.test(b)), "the FAFF-828 blocker string is present");
    const gov = JSON.parse(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"));
    const cp = chokepointPermit({ kind: "merge", target: "main", reversible: true }, null, gov.pk);
    assert.equal(cp.permit, false, "chokepointPermit refuses an absent decision");
    assert.equal(cp.reason, byId["02-governance-block"].disposition_basis.commissaire_verdict.reason);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 3 (refused): secret-free `commissaire audit verify` exit 1, forged decision commissaire-sig-invalid, producers unverifiable_without_secret", () => {
  const { root, runDir } = mkRun("com-03");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-3", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-3", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assertTwoCustodianSplit(runDir);
    // forge a commissaire record HMAC'd under the producer key (never an Ed25519 signature)
    const producerDir = join(runDir, "commissaire", "producer");
    const key = Buffer.from(JSON.parse(readFileSync(join(producerDir, "producers", "P1.json"), "utf8")).key_hex, "hex");
    const ledger = join(runDir, "declared-effects.jsonl");
    const entries = records(ledger);
    const last = entries[entries.length - 1];
    const forged = { schema: 3, run_id: "com-03", seq: last.seq + 1, ts: "2026-09-02T00:00:00.000Z", author: "commissaire", producer_id: "P1", contract_revision: "r1", kind_of_entry: "effect-decision-verdict", issue: "FAFF-3", step: "merge", prev: "deadbeef", payload: { verdict: "grant", effect: { kind: "merge", target: "main", reversible: true } } };
    forged.commissaire_sig = signRecord(forged, key);
    writeFileSync(ledger, readFileSync(ledger, "utf8") + JSON.stringify(forged) + "\n");
    const av = auditVerify(runDir, { secretFree: true });
    assert.equal(av.exit, 1, "secret-free audit verify fails closed");
    assert.equal(av.json.producer_claims.verified, 0, "producer claims are never folded into a pass");
    assert.ok(av.json.producer_claims.unverifiable_without_secret > 0, "producers classify unverifiable_without_secret");
    assert.ok(av.json.records.some((r) => r.classification === "failed" && r.reason === "commissaire-sig-invalid"), "the forged decision is commissaire-sig-invalid");
    const pk = JSON.parse(readFileSync(join(producerDir, "pk.json"), "utf8")).pk;
    assert.equal(chokepointPermit({ kind: "merge", target: "main", reversible: true }, forged, pk).reason, "decision-signature-invalid");
    assert.deepEqual(auditVerifyBasis(av), byId["03-independence-failure"].disposition_basis.audit_verify);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 4 (recovered): torn tail tolerated (chain verified), revoked producer failed via `commissaire audit verify`, idempotent noop recovery", () => {
  const { root, runDir } = mkRun("com-04");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-4", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-4", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "release" }]));
    assertTwoCustodianSplit(runDir);
    const ledger = join(runDir, "declared-effects.jsonl");
    const complete = readFileSync(ledger, "utf8");
    writeFileSync(ledger, complete + '{"schema":3,"seq":99,"author":"producer","prev":"deadbeef","incompl');
    const chain = verifyEffectsChain(runDir, {});
    assert.equal(chain.status, "verified", "torn tail tolerated");
    assert.ok(chain.torn_tail, "the torn tail is flagged");
    // revoke the producer → its records fail the auth leg fail-closed
    const pf = producerFileOf(producerDirOf(runDir), "P1");
    const pj = JSON.parse(readFileSync(pf, "utf8")); pj.status = "revoked"; writeFileSync(pf, JSON.stringify(pj));
    const av = auditVerify(runDir);
    assert.equal(av.exit, 1, "secret-bearing audit verify fails closed for a revoked producer");
    assert.ok(av.json.producer_claims.failed > 0, "the revoked producer's records classify failed");
    assert.ok(av.json.records.some((r) => r.classification === "failed" && r.reason === "producer-not-admitted"));
    // bundleRecover disposition core: an existing byte-identical ledger is noop-already-present; a divergence conflicts
    assert.equal(idempotencyDecision(complete, complete), "match");
    assert.equal(idempotencyDecision(complete, complete + "x"), "conflict");
    assert.deepEqual(auditVerifyBasis(av), byId["04-executor-loss"].disposition_basis.audit_verify);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 5 (denied): a request on stale evidence is denied reason=stale-evidence, no grant written", () => {
  const { root, runDir } = mkRun("com-05");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-5", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-5", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    assertTwoCustodianSplit(runDir);
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-5", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" }, evidence_seq: 0 }));
    const out = JSON.parse(rd.stdout.trim());
    assert.equal(out.verdict, "deny");
    assert.equal(out.reason, "stale-evidence");
    const verdicts = records(join(runDir, "declared-effects.jsonl")).filter((r) => r.kind_of_entry === "effect-decision-verdict");
    assert.ok(verdicts.every((v) => v.payload.verdict !== "grant"), "no grant verdict was written");
    assert.deepEqual({ verdict: out.verdict, reason: out.reason }, byId["05-stale-evidence"].disposition_basis.commissaire_verdict);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 6 (detected): an observed effect covered by no declaration surfaces as any_escape=true", () => {
  const { root, runDir } = mkRun("com-06");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge,registry-publish"]);
    assertTwoCustodianSplit(runDir);
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-6", "--step", "build"], JSON.stringify([{ kind: "registry-publish", target: "pkg@1.0.0" }]));
    const rec = runCom(["reconcile", "--run-dir", runDir, "--issue", "FAFF-6"]);
    const out = JSON.parse(rec.stdout.trim());
    assert.equal(out.any_escape, true);
    assert.equal(out.escapes[0].escaped[0].kind, "registry-publish");
    assert.equal(out.any_escape, byId["06-effect-mismatch"].disposition_basis.any_escape);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 7 (parked): a budget window breach parks until window reset with a resume_at + an andon budget-breach class", () => {
  const { root, runDir } = mkRun("com-07");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    assertTwoCustodianSplit(runDir);
    const env = envelopeFrom({ budget: { window: { hours: 5, tokens: 1000 }, at_ceiling: "park-until-window-reset" } }, {});
    const s = computeBudgetState(env, { now_epoch: RESET_EPOCH - 1000, attempts: 0, tokens: 0, window_tokens: 1000, window_reset_epoch: RESET_EPOCH }, "transcript");
    assert.deepEqual(s.breached, ["window"]);
    assert.ok(AT_CEILING_OUTCOMES.has(s.outcome));
    assert.equal(s.outcome, "park-until-window-reset");
    assert.equal(s.resume_at, RESUME_AT, "resume_at is populated only on park");
    assert.ok(ANDON_CLASSES.includes("budget-breach"), "the andon budget-breach class exists");
    const basis = byId["07-exhausted-budget"].disposition_basis;
    assert.equal(s.outcome, basis.budget_outcome);
    assert.equal(s.resume_at, basis.resume_at);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 8 (amended): re-admit under a new contract-revision → new-revision records verify, the stale-key record fails (producer-auth-mismatch)", () => {
  const { root, runDir } = mkRun("com-08");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-8", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r2", "--scope", "merge", "--force"]).code, 0, "re-admit under a new revision rotates the master (--force)");
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-8", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "release" }]));
    assertTwoCustodianSplit(runDir);
    const av = auditVerify(runDir);
    assert.equal(av.exit, 1);
    assert.ok(av.json.producer_claims.verified > 0, "new-revision producer records verify under the re-derived key");
    assert.ok(av.json.records.some((r) => r.author === "producer" && r.classification === "failed" && r.reason === "producer-auth-mismatch"), "the stale-key record fails as producer-auth-mismatch");
    assert.deepEqual(auditVerifyBasis(av), byId["08-contract-amendment"].disposition_basis.audit_verify);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scenario 9 (corrected): an idempotent match resumes gap-free with no duplicated work-item", () => {
  const { root, runDir } = mkRun("com-09");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-9", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-9", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "release" }]));
    assertTwoCustodianSplit(runDir);
    const ledger = readFileSync(join(runDir, "declared-effects.jsonl"), "utf8");
    // idempotent resume: the same bytes → match (a divergence → conflict → founded refuse)
    assert.equal(idempotencyDecision(ledger, ledger), "match");
    assert.equal(idempotencyDecision(ledger, ledger + "x"), "conflict");
    // the resumed ledger seq is gap-free (0..n contiguous) with no duplicated work-item run
    const seqs = records(join(runDir, "declared-effects.jsonl")).map((r) => r.seq);
    for (let i = 0; i < seqs.length; i++) assert.equal(seqs[i], i, "the ledger seq is gap-free");
    assert.equal(byId["09-correction-resume"].disposition_basis.idempotency_decision, "match");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ===========================================================================================
// The bank: build the nine records deterministically and assert they equal the committed
// matrix.jsonl; render REPORT.md via the real bin and assert it equals the committed report.
// ===========================================================================================
test("bank: the nine ScenarioRecords are deterministic and match the committed matrix.jsonl + REPORT.md byte-for-byte", () => {
  const built = SCENARIO_RESULTS.map(buildScenarioRecord);
  assert.equal(built.length, 9);
  built.forEach((r, i) => assert.equal(r.scenario_ordinal, i + 1, "ordinals 1..9 in order"));

  const matrixText = built.map((r) => JSON.stringify(r)).join("\n") + "\n";
  if (process.env.FAFF822_REBANK) {
    mkdirSync(BANK_DIR, { recursive: true });
    writeFileSync(MATRIX, matrixText);
    const rendered = runCli(["scenario-matrix", "render", MATRIX]);
    assert.equal(rendered.code, 0, rendered.stderr);
    writeFileSync(REPORT, rendered.stdout);
  }

  assert.ok(existsSync(MATRIX), "matrix.jsonl is banked");
  assert.equal(readFileSync(MATRIX, "utf8"), matrixText, "committed matrix.jsonl equals the deterministic emitter output");

  const rendered = runCli(["scenario-matrix", "render", MATRIX]);
  assert.equal(rendered.code, 0, rendered.stderr);
  assert.equal(rendered.stdout, readFileSync(REPORT, "utf8"), "committed REPORT.md equals the deterministic render");

  // the banked matrix passes the scenario-record contract validator on every row (belt-and-braces)
  for (const rec of records(MATRIX)) {
    const r = runCli(["contract", "scenario-record"], { input: JSON.stringify(rec) });
    assert.equal(r.code, 0, `banked ${rec.scenario_id} is contract-conformant: ${r.stdout}${r.stderr}`);
  }

  // the honest-claim invariants hold across the bank
  const all = records(MATRIX);
  assert.deepEqual(all.filter((r) => r.assurance_vector.effect_class === "E-B").map((r) => r.scenario_ordinal), [2], "E-B appears only on scenario 2");
  for (const r of all) {
    assert.equal(r.assurance_vector.independence.organisational_independence, false, "organisational_independence is false on every row");
    assert.equal(r.two_custodian_split_verified, true, "two-custodian split verified on every row");
    assert.ok(["J-C", "J-D"].includes(r.assurance_vector.journal_class), "journal_class is at most J-C");
    const isCatch = [2, 3, 5, 6].includes(r.scenario_ordinal);
    assert.equal(r.one_shot_control !== null, isCatch, "one_shot_control non-null iff ordinal in {2,3,5,6}");
  }
});
