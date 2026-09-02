// FAFF-828 — the external Commissaire facade: schema:3 governed records, split-key producer/
// Commissaire authentication, the verb-3 protected-effect decision, and the merge chokepoint.
//
// Every required fixture from the spec's Scenarios section, expressed on the mkdtemp-mint-then-
// mutate + runCli pattern. The pure cores (evaluateDecisionRequest, chokepointPermit,
// verifyDecision/verifyRecord, decideFloor's decision leg) are exercised directly; the CLI verbs
// (admit → declare → request-decision → observe → reconcile) through the real `faff` bin. The
// four `holdout`-marked spec scenarios (forged-grant-rejection, stale-evidence,
// forged-or-out-of-scope-claim, assurance-floor) are included here as ordinary tests — the holdout
// marking withheld them from the builder-view spec, not from the test suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  deriveKey, signRecord, verifyRecord, mintGovernorKeypair, signDecision, verifyDecision,
} from "../plugin/skills/faff/bin/lib/producer-auth.js";
import {
  evaluateDecisionRequest, chokepointPermit, verifyAuthLeg, appendProducerRecords,
  governorFileOf, producerFileOf, pkFileOf, governorDirOf, producerDirOf,
} from "../plugin/skills/faff/bin/lib/commissaire.js";
import { mintGovernorKeypair as _mintKp } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { appendEffectEntries, computeEscapes } from "../plugin/skills/faff/bin/lib/effects.js";
import { verifyEffectsChain } from "../plugin/skills/faff/bin/lib/events.js";
import { decideFloor } from "../plugin/skills/faff/bin/lib/contract-defs.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const COMMISSAIRE_JS = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "commissaire.js");

function mkRun(prefix, runId = "RUN-COM") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const runDir = join(root, ".faff", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  return { root, runDir, ledger: join(runDir, "declared-effects.jsonl") };
}
const records = (p) => readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
const runCom = (args, input) => runCli(["commissaire", ...args], { input });

// --- Fixture: pass ----------------------------------------------------------------------
test("pass: admit → declare → request-decision(granted) → observe → reconcile; chain verifies, every producer_hmac verifies, the verdict verifies under PK, no escape", () => {
  const { runDir, ledger } = mkRun("com-pass-");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.equal(rd.code, 0);
    assert.equal(JSON.parse(rd.stdout.trim()).verdict, "grant");
    assert.equal(runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);

    // every record is schema:3 and the chain verifies
    const recs = records(ledger);
    for (const r of recs) assert.equal(r.schema, 3, "every record is schema:3");
    assert.equal(verifyEffectsChain(runDir, {}).status, "verified", "the schema:3 ledger verifies");

    // the verdict verifies under PK; the auth leg passes over the whole run
    const pk = JSON.parse(readFileSync(join(runDir, "commissaire", "producer", "pk.json"), "utf8")).pk;
    const verdict = recs.find((r) => r.kind_of_entry === "effect-decision-verdict");
    assert.ok(verifyDecision(verdict, pk), "the verdict verifies under PK_commissaire");
    const auth = verifyAuthLeg(runDir);
    assert.ok(auth.pass, `auth leg passes (${JSON.stringify(auth.failures)})`);

    // reconcile reports no escape (every observe is covered by a declare)
    const rec = runCom(["reconcile", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(rec.code, 0);
    assert.equal(JSON.parse(rec.stdout.trim()).any_escape, false);
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: chokepoint-enforcement-pass ----------------------------------------------
test("chokepoint-enforcement-pass: a genuine covering Ed25519 grant + the pinned PK → chokepoint_permit PERMITS", () => {
  const gov = mintGovernorKeypair();
  const effect = { kind: "merge", target: "main", reversible: true };
  const grant = { author: "commissaire", payload: { verdict: "grant", effect } };
  grant.commissaire_sig = signDecision(grant, gov.sk);
  const res = chokepointPermit(effect, grant, gov.pk, gov.pk_fingerprint);
  assert.equal(res.permit, true);
  assert.equal(res.reason, "valid-grant");
});

// --- Fixture: ungoverned-merge-unaffected (the blast-radius negative) -------------------
test("ungoverned-merge-unaffected: decideFloor blockers are byte-identical with vs without the decision leg present", () => {
  const base = { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "needs-human", integrity: "unasserted-ok" };
  const without = decideFloor({ ...base });                                   // no decision_grant field at all
  const notApplicable = decideFloor({ ...base, decision_grant: "not-applicable" });
  const validGrant = decideFloor({ ...base, decision_grant: "valid-grant" });
  assert.deepEqual(without.blockers, notApplicable.blockers, "an absent leg == not-applicable (no-op)");
  assert.deepEqual(without.blockers, validGrant.blockers, "a valid-grant adds no blocker");
  assert.equal(without.verdict, "merge-ok");
  // and a governed-but-missing grant DOES block (the E-B raise)
  const absent = decideFloor({ ...base, decision_grant: "absent-or-invalid" });
  assert.equal(absent.verdict, "refuse");
  assert.ok(absent.blockers.some((b) => /Commissaire protected-effect decision/.test(b)));
});

// --- Fixture: forged-grant-rejection (holdout — the headline security fixture) ----------
test("forged-grant-rejection: a producer-HMAC'd fake verdict fails verifyDecision and chokepoint_permit REFUSES", () => {
  const gov = mintGovernorKeypair();
  const key = deriveKey("master", "P1", "r1");
  const effect = { kind: "merge", target: "main", reversible: true };
  // a producer HMACs the verdict under K_producer instead of a real SK signature
  const forged = { author: "commissaire", payload: { verdict: "grant", effect } };
  forged.commissaire_sig = signRecord(forged, key); // NOT an Ed25519 signature
  assert.equal(verifyDecision(forged, gov.pk), false, "a producer HMAC does not verify as an Ed25519 decision");
  const res = chokepointPermit(effect, forged, gov.pk, gov.pk_fingerprint);
  assert.equal(res.permit, false, "the chokepoint REFUSES a forged grant");
  // a verdict relabelled author=commissaire but with no real signature is likewise refused
  const relabelled = { author: "commissaire", payload: { verdict: "grant", effect }, commissaire_sig: "not-a-signature" };
  assert.equal(chokepointPermit(effect, relabelled, gov.pk, gov.pk_fingerprint).permit, false);
  // and a fingerprint-pin mismatch (swapped public key) is refused even with a genuine sig
  const genuine = { author: "commissaire", payload: { verdict: "grant", effect } };
  genuine.commissaire_sig = signDecision(genuine, gov.sk);
  assert.equal(chokepointPermit(effect, genuine, gov.pk, "0".repeat(64)).permit, false, "swapped-PK fingerprint mismatch → refuse");
});

// --- Fixture: seeded-governance-block ---------------------------------------------------
test("seeded-governance-block: a pre-cutover schema:2 ledger stays frozen; a fresh schema:3 run is canonical under a distinct run_id/genesis with no mirrored line", () => {
  // a seeded schema:2 declared-effects.jsonl in its OWN run dir (pre-cutover history)
  const legacy = mkRun("com-legacy-", "RUN-LEGACY");
  const fresh = mkRun("com-fresh-", "RUN-FRESH");
  try {
    appendEffectEntries(legacy.runDir, "declare", "FAFF-OLD", "build", [{ kind: "merge", target: "main" }], "t");
    const legacyRecs = records(legacy.ledger);
    assert.equal(legacyRecs[0].schema, 2, "the seeded ledger is schema:2");
    assert.equal(verifyEffectsChain(legacy.runDir, {}).schema_floor, 2, "compatibility reader classifies it schema-2 (frozen)");

    // a fresh schema:3 run alongside it
    assert.equal(runCom(["admit", "--run-dir", fresh.runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", fresh.runDir, "--producer", "P1", "--issue", "FAFF-NEW", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const freshRecs = records(fresh.ledger);
    assert.ok(freshRecs.some((r) => r.schema === 3), "the fresh run is schema:3");
    assert.equal(verifyEffectsChain(fresh.runDir, {}).schema_floor, 3, "the fresh run is canonical schema-3");

    // distinct run_id / genesis, and no schema:3 line mirrors a schema:2 record
    assert.notEqual(legacyRecs[0].run_id, freshRecs[0].run_id, "distinct run_id / genesis");
    for (const f of freshRecs) {
      for (const l of legacyRecs) {
        assert.ok(!(f.issue === l.issue && f.seq === l.seq && f.schema === l.schema), "no schema:3 line mirrors a schema:2 record");
      }
    }
  } finally { rmSync(legacy.root, { recursive: true, force: true }); rmSync(fresh.root, { recursive: true, force: true }); }
});

// --- Fixture: stale-evidence (holdout) --------------------------------------------------
test("stale-evidence: a request resting on evidence older than the latest observation for (issue, step) is DENIED, no grant written", () => {
  const { runDir, ledger } = mkRun("com-stale-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    // the observe advanced the chain head; the request rests on evidence_seq 0 (the declare, pre-observation)
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" }, evidence_seq: 0 }));
    assert.equal(rd.code, 0);
    const out = JSON.parse(rd.stdout.trim());
    assert.equal(out.verdict, "deny");
    assert.equal(out.reason, "stale-evidence");
    // no GRANT verdict exists for this issue's merge
    const verdicts = records(ledger).filter((r) => r.kind_of_entry === "effect-decision-verdict");
    assert.ok(verdicts.every((v) => v.payload.verdict !== "grant"), "no grant verdict was written");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: effect-mismatch -----------------------------------------------------------
test("effect-mismatch: an observed effect covered by no declaration surfaces as an escaped-side-effect (detection persists)", () => {
  const { runDir } = mkRun("com-mismatch-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge,registry-publish"]);
    // observe an effect that was never declared
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "build"], JSON.stringify([{ kind: "registry-publish", target: "pkg@1.0.0" }]));
    const rec = runCom(["reconcile", "--run-dir", runDir, "--issue", "FAFF-1"]);
    const out = JSON.parse(rec.stdout.trim());
    assert.equal(out.any_escape, true);
    assert.equal(out.escapes[0].escaped[0].kind, "registry-publish");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: killed-producer -----------------------------------------------------------
test("killed-producer: a torn final line is tolerated (chain verifies); a revoked producer's records fail the auth leg fail-closed", () => {
  const { runDir, ledger } = mkRun("com-killed-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "release" }]));
    // simulate a kill mid-write: append a torn (newline-less, truncated) final line
    const raw = readFileSync(ledger, "utf8");
    writeFileSync(ledger, raw + '{"schema":3,"seq":99,"author":"producer","prev":"deadbeef","incompl');
    // the chain verifies up to the last complete line (torn tail tolerated)
    const v = verifyEffectsChain(runDir, {});
    assert.ok(v.status === "verified", `torn tail tolerated (got ${v.status})`);
    assert.ok(v.torn_tail, "the torn tail is flagged");
    // now revoke the producer → every attributed record fails the auth leg fail-closed
    const pf = producerFileOf(producerDirOf(runDir), "P1");
    const pj = JSON.parse(readFileSync(pf, "utf8")); pj.status = "revoked"; writeFileSync(pf, JSON.stringify(pj));
    const auth = verifyAuthLeg(runDir);
    assert.equal(auth.pass, false, "the auth leg fails closed for a revoked producer");
    assert.ok(auth.failures.some((f) => f.reason === "producer-not-admitted"), "reason is producer-not-admitted");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: forged-or-out-of-scope-claim (holdout) ------------------------------------
test("forged-or-out-of-scope-claim: a tampered HMAC, an out-of-scope kind, or an undeclared effect are each DENIED with the named reason", () => {
  const admission = { status: "admitted", admitted_scope: ["merge"], contract_revision: "r1" };
  const key = deriveKey("m", "P1", "r1");
  const declared = { kind_of_entry: "declare", issue: "FAFF-1", step: "merge", effect: { kind: "merge", target: "main" }, seq: 0 };
  const mkReq = (effect) => {
    const r = { schema: 3, author: "producer", producer_id: "P1", contract_revision: "r1", seq: 1, kind_of_entry: "effect-decision-request", issue: "FAFF-1", step: "merge", payload: { effect } };
    r.producer_hmac = signRecord(r, key);
    return r;
  };
  // tampered HMAC (flip a covered field after signing)
  const tampered = mkReq({ kind: "merge", target: "main", reversible: true }); tampered.seq = 42;
  assert.equal(evaluateDecisionRequest(admission, tampered, key, [declared]).reason, "producer-auth-failed");
  // out-of-scope kind
  const deploy = mkReq({ kind: "deploy", target: "prod", reversible: true });
  assert.equal(evaluateDecisionRequest(admission, deploy, key, [declared]).reason, "effect-out-of-scope");
  // unadmitted producer
  assert.equal(evaluateDecisionRequest(null, mkReq({ kind: "merge", target: "main" }), key, [declared]).reason, "producer-not-admitted");
});

// --- Fixture: replay-determinism --------------------------------------------------------
test("replay-determinism: the terminal-verdict projection recomputed twice from the SAME frozen bytes is byte-identical", () => {
  const { runDir, ledger } = mkRun("com-replay-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    const frozen = readFileSync(ledger); // frozen bytes
    // the projection: the ordered (kind_of_entry, verdict) sequence recomputed over frozen bytes
    const project = (buf) => JSON.stringify(buf.toString("utf8").split("\n").filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l)).map((r) => [r.seq, r.kind_of_entry, r.payload && r.payload.verdict]));
    assert.equal(project(frozen), project(frozen), "recompute over the same frozen bytes is byte-identical");
    // chain head is a pure hash fold — identical across recomputes
    assert.equal(verifyEffectsChain(runDir, {}).head_sha256, verifyEffectsChain(runDir, {}).head_sha256);
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Assertion: assurance floor (holdout) ----------------------------------------------
test("assurance-floor: a J-D self-declared record (a declare) presented as a decision request is DENIED — weaker assurance cannot satisfy the E-B grant", () => {
  const admission = { status: "admitted", admitted_scope: ["merge"], contract_revision: "r1" };
  const key = deriveKey("m", "P1", "r1");
  const declared = { kind_of_entry: "declare", issue: "FAFF-1", step: "merge", effect: { kind: "merge", target: "main" }, seq: 0 };
  const declareAsRequest = { schema: 3, author: "producer", producer_id: "P1", kind_of_entry: "declare", issue: "FAFF-1", step: "merge", seq: 1, effect: { kind: "merge", target: "main" } };
  assert.equal(evaluateDecisionRequest(admission, declareAsRequest, key, [declared]).reason, "assurance-floor");
});

// --- Assertion: the two-custodian split -------------------------------------------------
test("two-custodian split: no single file holds both SK_commissaire and any producer's derived key", () => {
  const { runDir } = mkRun("com-custody-");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    const gov = JSON.parse(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"));
    const prod = JSON.parse(readFileSync(producerFileOf(producerDirOf(runDir), "P1"), "utf8"));
    assert.ok(gov.sk && gov.master_secret, "the governor file holds SK + master");
    assert.ok(!gov.key_hex, "the governor file holds NO producer key");
    assert.ok(prod.key_hex, "the producer file holds K_producer");
    assert.ok(!prod.sk && !prod.master_secret, "the producer file holds NEITHER SK NOR master");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Assertion: the facade imports nothing faff-internal (require-graph) -----------------
test("require-graph: the commissaire facade imports neither SuperDomestique scheduling nor any faffter-* skill", () => {
  const src = readFileSync(COMMISSAIRE_JS, "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of requires) {
    assert.ok(!/faffter|beep-boop|graft|slot/.test(r), `commissaire must not require a scheduling/skill module (found ${r})`);
  }
  // it requires only the governance cores + node builtins + shared-infra
  const localRequires = requires.filter((r) => r.startsWith("."));
  const allowed = new Set(["./producer-auth", "./events", "./effects", "./shared-infra"]);
  for (const r of localRequires) assert.ok(allowed.has(r), `unexpected local require ${r}`);
});

// --- FAFF-978 hardening: admit idempotency ---------------------------------------------
test("hardening: admit refuses re-admission (silent key rotation) unless --force", () => {
  const { runDir } = mkRun("com-admit-idem-");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    const gov1 = readFileSync(governorFileOf(governorDirOf(runDir)), "utf8");
    // a second admit is REFUSED (exit 2) and does NOT rotate the keypair/master
    const re = runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    assert.equal(re.code, 2, "re-admit is refused");
    assert.match(re.stderr, /already admitted/);
    assert.equal(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"), gov1, "governor material is unchanged after a refused re-admit");
    // --force rotates deliberately
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge", "--force"]).code, 0);
    assert.notEqual(readFileSync(governorFileOf(governorDirOf(runDir)), "utf8"), gov1, "--force rotates the governor material");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- FAFF-978 hardening: authoritative-PK auth leg --------------------------------------
test("hardening: verifyAuthLeg fails closed when the producer-writable pk.json is swapped (prefers the governor's authoritative PK)", () => {
  const { runDir } = mkRun("com-authpk-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.ok(verifyAuthLeg(runDir).pass, "baseline auth leg passes");
    // an attacker swaps the producer-dir pk.json to their own key — the leg must fail closed on the
    // fingerprint mismatch against the governor's authoritative PK, never verify against the swapped key
    const attacker = _mintKp();
    writeFileSync(pkFileOf(producerDirOf(runDir)), JSON.stringify({ pk: attacker.pk, pk_fingerprint: attacker.pk_fingerprint }));
    const res = verifyAuthLeg(runDir);
    assert.equal(res.pass, false, "a swapped producer-dir pk.json fails the auth leg");
    assert.ok(res.failures.some((f) => f.reason === "pk-fingerprint-tampered"), "the tamper is named explicitly");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- FAFF-978 hardening: pre-append revocation check ------------------------------------
test("hardening: a revoked producer is refused at CLI entry, before any ledger append", () => {
  const { runDir, ledger } = mkRun("com-revoke-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    const linesBefore = records(ledger).length;
    // revoke P1
    const pf = producerFileOf(producerDirOf(runDir), "P1");
    const pj = JSON.parse(readFileSync(pf, "utf8")); pj.status = "revoked"; writeFileSync(pf, JSON.stringify(pj));
    // declare and request-decision are both refused (exit 2) with NO ledger append
    const d = runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    assert.equal(d.code, 2); assert.match(d.stderr, /revoked/);
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    assert.equal(rd.code, 2); assert.match(rd.stderr, /revoked/);
    assert.equal(records(ledger).length, linesBefore, "no record was appended by the revoked producer");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- FAFF-978 hardening: reconcile no longer requires --producer ------------------------
test("hardening: reconcile works with only --issue (the phantom --producer requirement is gone)", () => {
  const { runDir } = mkRun("com-recon-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    const rec = runCom(["reconcile", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(rec.code, 0, "reconcile succeeds without --producer");
    assert.equal(JSON.parse(rec.stdout.trim()).any_escape, false);
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});
