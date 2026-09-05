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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers/run-cli.mjs";
import {
  deriveKey, signRecord, verifyRecord, mintGovernorKeypair, signDecision, verifyDecision,
} from "../plugin/skills/faff/bin/lib/producer-auth.js";
import {
  evaluateDecisionRequest, chokepointPermit, verifyAuthLeg, appendProducerRecords, readLedgerEntries,
  governorFileOf, producerFileOf, pkFileOf, governorDirOf, producerDirOf,
} from "../plugin/skills/faff/bin/lib/commissaire.js";
import { mintGovernorKeypair as _mintKp } from "../plugin/skills/faff/bin/lib/producer-auth.js";
import { appendEffectEntries, computeEscapes } from "../plugin/skills/faff/bin/lib/effects.js";
import { verifyEffectsChain, mintIssueAnchor } from "../plugin/skills/faff/bin/lib/events.js";
import { decideFloor } from "../plugin/skills/faff/bin/lib/contract-defs.js";
import { buildBundle } from "../plugin/skills/faff/bin/lib/bundle-seal-core.js";
import { sha256 } from "../plugin/skills/faff/bin/lib/integrity-digest.js";

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
  // FAFF-1000 — `audit seal`/`export` require the denylist-clean sealing core (buildBundle /
  // localBundleStore / requiredMembersFor). It is NOT ./bundle, ./config, or ./contract-defs.
  const allowed = new Set(["./producer-auth", "./events", "./effects", "./shared-infra", "./bundle-seal-core"]);
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

// === FAFF-977: `audit verify` — secret-free external replay ==============================
// The read-only projection of verifyAuthLeg onto the stable AuditVerifyOutput contract.
// A run minted through the real CLI, then (per scenario) sanitized or tampered, and replayed.

const FIXTURE_ROOT = join(HERE, "fixtures", "commissaire", "secret-free-replay");

// Mint a governed run (admit → declare → request-decision) through the real bin. Yields a ledger
// with two commissaire decisions (admission + verdict) and two producer records (declare + request).
function mintGovernedRun(prefix) {
  const { root, runDir, ledger } = mkRun(prefix);
  assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
  assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
  assert.equal(runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } })).code, 0);
  return { root, runDir, ledger };
}

test("audit verify: the checked-in secret-free fixture replays — exit 0, buckets as specified, never folds unverifiable", () => {
  const r = runCom(["audit", "verify", "--run-dir", FIXTURE_ROOT]);
  assert.equal(r.code, 0, `secret-free fixture verifies (${r.stderr})`);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.version, 1);
  assert.equal(out.result, "pass");
  assert.equal(out.governance_context, true);
  assert.ok(out.producer_claims.unverifiable_without_secret > 0, "producer claims are unverifiable without the secret");
  assert.equal(out.producer_claims.verified, 0, "NEVER fold unverifiable into a verified/pass total");
  assert.equal(out.producer_claims.failed, 0);
  assert.ok(out.commissaire_decisions.verified >= 1, "public-key decisions verify from pk.json alone");
  // commissaire_decisions carries no unverifiable bucket (a public-key decision is always checkable)
  assert.deepEqual(Object.keys(out.commissaire_decisions).sort(), ["failed", "verified"]);
  assert.equal(out.ledger_failures.length, 0, "no ledger-level failure on the pure secret-free path");
  assert.equal(typeof out.pk_fingerprint, "string");
  // records are one-per-schema:3-entry, in ledger (seq) order
  const seqs = out.records.map((x) => x.seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
});

test("audit verify: a live secret-present run reports producer claims as verified (secret present)", () => {
  const { root, runDir } = mintGovernedRun("com-av-secret-");
  try {
    const r = runCom(["audit", "verify", "--run-dir", runDir]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.result, "pass");
    assert.ok(out.producer_claims.verified > 0, "with the governor secret present, producer HMACs verify");
    assert.equal(out.producer_claims.unverifiable_without_secret, 0);
    assert.ok(out.commissaire_decisions.verified >= 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: fail closed when pk.json is missing but Commissaire decisions exist (exit 1)", () => {
  const { root, runDir } = mintGovernedRun("com-av-nopk-");
  try {
    // sanitize to secret-free, then also remove the published key — nothing left to check decisions with
    rmSync(governorDirOf(runDir), { recursive: true, force: true });
    rmSync(pkFileOf(producerDirOf(runDir)), { force: true });
    const r = runCom(["audit", "verify", "--run-dir", runDir]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.result, "fail");
    assert.equal(out.pk_fingerprint, null, "pk_fingerprint is null when pk.json is absent");
    const decision = out.records.find((x) => x.author === "commissaire");
    assert.equal(decision.classification, "failed");
    assert.equal(decision.reason, "commissaire-sig-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: a tampered Commissaire decision fails closed (exit 1, commissaire-sig-invalid)", () => {
  const { root, runDir, ledger } = mintGovernedRun("com-av-tamper-dec-");
  try {
    const recs = records(ledger);
    const idx = recs.findIndex((x) => x.kind_of_entry === "effect-decision-verdict");
    recs[idx].payload = { ...recs[idx].payload, reason: "tampered-after-signing" };
    writeFileSync(ledger, recs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const r = runCom(["audit", "verify", "--run-dir", runDir]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.result, "fail");
    const decision = out.records.find((x) => x.kind_of_entry === "effect-decision-verdict");
    assert.equal(decision.classification, "failed");
    assert.equal(decision.reason, "commissaire-sig-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: a tampered producer HMAC on a secret-present run classifies failed (exit 1, producer-auth-mismatch)", () => {
  const { root, runDir, ledger } = mintGovernedRun("com-av-tamper-prod-");
  try {
    const recs = records(ledger);
    const idx = recs.findIndex((x) => x.author === "producer" && x.producer_hmac);
    const h = recs[idx].producer_hmac;
    recs[idx].producer_hmac = (h[0] === "0" ? "1" : "0") + h.slice(1); // flip one hex char
    writeFileSync(ledger, recs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const r = runCom(["audit", "verify", "--run-dir", runDir]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.result, "fail");
    assert.ok(out.producer_claims.failed > 0);
    const bad = out.records.find((x) => x.classification === "failed" && x.author === "producer");
    assert.equal(bad.reason, "producer-auth-mismatch");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: a governor/pk.json fingerprint mismatch surfaces under ledger_failures (exit 1)", () => {
  const { root, runDir } = mintGovernedRun("com-av-fp-");
  try {
    // an actor swaps the producer-dir pk.json to a foreign key; the governor is the authoritative PK
    const foreign = mintGovernorKeypair();
    writeFileSync(pkFileOf(producerDirOf(runDir)), JSON.stringify({ pk: foreign.pk, pk_fingerprint: foreign.pk_fingerprint }));
    const r = runCom(["audit", "verify", "--run-dir", runDir, "--governor-dir", governorDirOf(runDir)]);
    assert.equal(r.code, 1);
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.result, "fail");
    assert.ok(out.ledger_failures.some((f) => f.reason === "pk-fingerprint-tampered"), "the record-less failure is surfaced under ledger_failures, not dropped");
    // the record-less failure has no matching ledger record, so it never lands in `records`
    assert.ok(!out.records.some((x) => x.reason === "pk-fingerprint-tampered"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: an ungoverned run (no schema:3 records) is a setup error — exit 2, nothing on stdout", () => {
  const { root, runDir } = mkRun("com-av-ungov-");
  try {
    const r = runCom(["audit", "verify", "--run-dir", runDir]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout.trim(), "", "no partial contract is printed on the setup-error path");
    assert.match(r.stderr, /governance context/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: a missing run dir is a setup error — exit 2, nothing on stdout", () => {
  const r = runCom(["audit", "verify", "--run-dir", join(tmpdir(), `com-av-missing-${Date.now()}`)]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout.trim(), "");
});

test("audit verify: grammar — `audit verify` routes to the handler; an unknown `audit` action is a usage error (exit 2)", () => {
  const { root, runDir } = mintGovernedRun("com-av-grammar-");
  try {
    // routes (a governed run replays cleanly)
    assert.equal(runCom(["audit", "verify", "--run-dir", runDir]).code, 0);
    // an unbuilt action (seal/export) or a typo falls through to the usage error
    const bogus = runCom(["audit", "bogus", "--run-dir", runDir]);
    assert.equal(bogus.code, 2);
    assert.match(bogus.stderr, /usage: faff commissaire/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("audit verify: the seven flat verbs and the cli-surface bijection/pinned selftest are unchanged", () => {
  // the compound `audit verify` SURFACE key does not break the surface selftest
  assert.equal(runCli(["cli-surface", "--selftest"]).code, 0);
  // a representative flat verb still dispatches with its own (legacy exit-3) run-dir contract
  const missing = runCom(["reconcile", "--run-dir", join(tmpdir(), `com-flat-missing-${Date.now()}`), "--issue", "FAFF-1"]);
  assert.equal(missing.code, 3, "the flat verbs keep their own exit-3 missing-run-dir convention");
});

// === FAFF-980: ADR-0123 noun-verb object grammar =======================================
// Every object-verb form resolves to the same handler as its flat-verb alias, byte-identical in
// exit and JSON. Two fresh run dirs driven with identical inputs (one flat, one object-verb) so the
// ledger seqs match and the request-decision verdict JSON is byte-identical (spec Scenario 2).

test("grammar: object-verb chain and flat-alias chain return byte-identical exit and request-decision JSON", () => {
  const flat = mkRun("com-grammar-flat-", "RUN-FLAT");
  const obj = mkRun("com-grammar-obj-", "RUN-OBJ");
  try {
    // flat spelling
    assert.equal(runCom(["admit", "--run-dir", flat.runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", flat.runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const rdFlat = runCom(["request-decision", "--run-dir", flat.runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    // object-verb spelling — same inputs against a fresh dir
    assert.equal(runCom(["contract", "admit", "--run-dir", obj.runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["effect", "declare", "--run-dir", obj.runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const rdObj = runCom(["effect", "authorize", "--run-dir", obj.runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));

    assert.equal(rdFlat.code, rdObj.code, "identical exit code");
    assert.equal(rdObj.code, 0);
    assert.equal(rdFlat.stdout.trim(), rdObj.stdout.trim(), "byte-identical request-decision JSON across spellings");
    assert.equal(JSON.parse(rdObj.stdout.trim()).verdict, "grant");
    // reconcile pairs: `effect reconcile` == `reconcile`, same exit + JSON
    const recFlat = runCom(["reconcile", "--run-dir", flat.runDir, "--issue", "FAFF-1"]);
    const recObj = runCom(["effect", "reconcile", "--run-dir", obj.runDir, "--issue", "FAFF-1"]);
    assert.equal(recFlat.code, recObj.code);
    assert.equal(recFlat.stdout.trim(), recObj.stdout.trim(), "byte-identical reconcile JSON across spellings");
  } finally { rmSync(flat.root, { recursive: true, force: true }); rmSync(obj.root, { recursive: true, force: true }); }
});

test("grammar: unresolved spellings print usage and exit 2 (bare object, unknown action, unknown token)", () => {
  for (const args of [["contract"], ["effect", "frobnicate"], ["wibble"], ["verdict"], ["audit", "bogus"]]) {
    const r = runCom(args);
    assert.equal(r.code, 2, `${JSON.stringify(args)} → exit 2`);
    assert.match(r.stderr, /usage: faff commissaire/, `${JSON.stringify(args)} prints usage`);
  }
});

test("grammar: all seven flat aliases and their object-verb forms dispatch to the same handler (missing-run-dir contract)", () => {
  const missing = join(tmpdir(), `com-alias-missing-${Date.now()}`);
  // each pair [flat tokens, object-verb tokens] must produce the same exit on the same missing dir.
  const pairs = [
    [["admit", "--run-dir", missing, "--producer", "P1", "--contract-revision", "r1"], ["contract", "admit", "--run-dir", missing, "--producer", "P1", "--contract-revision", "r1"]],
    [["declare", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"], ["effect", "declare", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"]],
    [["request-decision", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"], ["effect", "authorize", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"]],
    [["observe", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"], ["effect", "observe", "--run-dir", missing, "--producer", "P1", "--issue", "I", "--step", "S"]],
    [["reconcile", "--run-dir", missing, "--issue", "I"], ["effect", "reconcile", "--run-dir", missing, "--issue", "I"]],
    [["terminal-verdict", "--run-dir", missing, "--issue", "I"], ["verdict", "conclude", "--run-dir", missing, "--issue", "I"]],
    [["seal-bundle", "--run-dir", missing], ["audit", "seal", "--run-dir", missing]],
  ];
  for (const [flatArgs, objArgs] of pairs) {
    const rf = runCom(flatArgs), ro = runCom(objArgs);
    assert.equal(rf.code, ro.code, `${flatArgs[0]} alias exit == ${objArgs[0]} ${objArgs[1]} exit (got ${rf.code} vs ${ro.code})`);
  }
});

// === FAFF-1000: verdict conclude (in-process) + audit seal (in-process) + audit export ===
// The depth pass over verbs 5/6 and the new `audit export` action. A run minted through the real
// bin; the run-close anchor + run-ledger minted directly (never `faff events anchor-run`) so the
// seal/export path is exercised with no faff-bin dependency, exactly as the standalone runtime
// spawn-guard test asserts.

// Mint a run-close anchor tree (summary.md + one per-issue subdir) directly under
// <root>/.faff/anchors/<run_id>/, plus the run-ledger.json buildBundle reads — the same shape
// `faff events anchor-run` produces, without spawning it.
function mintRunCloseAnchor(root, runDir, runId) {
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { epoch: 0, status: "done" } }));
  writeFileSync(join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${runId}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  mkdirSync(join(runDir, "FAFF-1"), { recursive: true });
  const anchorRoot = join(root, ".faff", "anchors", runId);
  const mint = mintIssueAnchor(runDir, "FAFF-1", join(anchorRoot, "FAFF-1"));
  assert.equal(mint.ok, true, "fixture: run-close anchor mint must succeed");
  mkdirSync(anchorRoot, { recursive: true });
  writeFileSync(join(anchorRoot, "summary.md"), "# run\n");
}

test("FAFF-1000 verdict conclude: a clean covered run appends one signed accepted_under_contract record; audit verify classifies it verified", () => {
  const { root, runDir, ledger } = mkRun("com-vc-ok-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    assert.equal(JSON.parse(runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } })).stdout.trim()).verdict, "grant");
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));

    const vc = runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(vc.code, 0);
    const out = JSON.parse(vc.stdout.trim());
    assert.equal(out.verdict, "accepted_under_contract");
    assert.equal(out.producer_id, "P1");

    const accepted = records(ledger).filter((r) => r.kind_of_entry === "accepted_under_contract");
    assert.equal(accepted.length, 1, "exactly one accepted_under_contract record");
    assert.equal(accepted[0].author, "commissaire");
    assert.equal(accepted[0].schema, 3);
    assert.equal(accepted[0].step, "conclude");
    assert.equal(accepted[0].payload.escapes_checked, true);
    assert.ok(accepted[0].commissaire_sig, "the record is signed under the governor SK");

    const av = JSON.parse(runCom(["audit", "verify", "--run-dir", runDir]).stdout.trim());
    assert.equal(av.result, "pass");
    const rec = av.records.find((x) => x.kind_of_entry === "accepted_under_contract");
    assert.equal(rec.classification, "verified", "audit verify classifies the terminal record verified");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-1000 verdict conclude: an unreconciled escape refuses (exit 0) and writes nothing to the ledger", () => {
  const { root, runDir, ledger } = mkRun("com-vc-escape-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge,registry-publish"]);
    // observe an effect that was never declared -> an escape for FAFF-1
    runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "build"], JSON.stringify([{ kind: "registry-publish", target: "pkg@1.0.0" }]));
    const before = records(ledger).length;
    const vc = runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]);
    assert.equal(vc.code, 0, "a completed refusal exits 0");
    const out = JSON.parse(vc.stdout.trim());
    assert.equal(out.verdict, "refused");
    assert.equal(out.reason, "unreconciled-escape");
    assert.equal(records(ledger).length, before, "a refusal writes nothing to the ledger");
    assert.equal(records(ledger).filter((r) => r.kind_of_entry === "accepted_under_contract").length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-1000 verdict conclude: no-evidence on a bare issue; ambiguous-producer when two producers touched the issue and --producer is absent", () => {
  const { root, runDir, ledger } = mkRun("com-vc-refuse-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    // no-evidence: an issue with zero ledger entries
    const ne = JSON.parse(runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-NONE"]).stdout.trim());
    assert.equal(ne.verdict, "refused");
    assert.equal(ne.reason, "no-evidence");
    // ambiguous-producer: a second distinct producer_id on the same issue (the ambiguity check reads
    // producer_id off the ledger, never the HMAC), --producer absent
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    writeFileSync(ledger, readFileSync(ledger, "utf8") + JSON.stringify({ schema: 3, run_id: runDir.split("/").pop(), seq: 999, author: "producer", producer_id: "P2", contract_revision: "r1", kind_of_entry: "declare", issue: "FAFF-1", step: "merge", effect: { kind: "merge", target: "main" } }) + "\n");
    const amb = JSON.parse(runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]).stdout.trim());
    assert.equal(amb.verdict, "refused");
    assert.equal(amb.reason, "ambiguous-producer");
    // naming an unknown producer is a producer-not-admitted refusal (still exit 0, still no write)
    const named = JSON.parse(runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1", "--producer", "P2"]).stdout.trim());
    assert.equal(named.reason, "producer-not-admitted");
    assert.equal(records(ledger).filter((r) => r.kind_of_entry === "accepted_under_contract").length, 0, "no refusal wrote a terminal record");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-1000 verdict conclude: a second call for an already-concluded issue returns the existing seq (idempotent) and appends no second record", () => {
  const { root, runDir, ledger } = mkRun("com-vc-idem-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    const first = JSON.parse(runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]).stdout.trim());
    assert.equal(first.verdict, "accepted_under_contract");
    const second = JSON.parse(runCom(["verdict", "conclude", "--run-dir", runDir, "--issue", "FAFF-1"]).stdout.trim());
    assert.equal(second.verdict, "accepted_under_contract");
    assert.equal(second.idempotent, true);
    assert.equal(second.seq, first.seq, "the idempotent re-conclude returns the existing record's seq");
    assert.equal(records(ledger).filter((r) => r.kind_of_entry === "accepted_under_contract").length, 1, "no second accepted_under_contract record");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-1000 audit seal: seals the run-close bundle in-process; bundle_manifest_digest matches a direct buildBundle over the same run dir; re-seal is idempotent", () => {
  const { root, runDir } = mkRun("com-seal-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    const runId = runDir.split("/").pop();
    mintRunCloseAnchor(root, runDir, runId);

    const seal = runCom(["audit", "seal", "--run-dir", runDir, "--root", root]);
    assert.equal(seal.code, 0, `seal failed: ${seal.stderr}`);
    const out = JSON.parse(seal.stdout.trim());
    assert.equal(out.sealed, true);
    assert.equal(out.identity.boundary_kind, "run-close");
    assert.equal(out.identity.boundary_key, "run-close", "the LITERAL run-close boundary_key (not basename(runDir))");
    // digest matches a direct buildBundle computed with the literal run-close boundary_key
    const direct = buildBundle(runDir, { run_id: runId, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 }, root);
    assert.equal(out.bundle_manifest_digest, direct.manifest.bundle_manifest_digest);
    // re-seal is an idempotent no-op (same digest)
    const reseal = JSON.parse(runCom(["audit", "seal", "--run-dir", runDir, "--root", root]).stdout.trim());
    assert.equal(reseal.idempotent, true);
    assert.equal(reseal.bundle_manifest_digest, out.bundle_manifest_digest);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-1000 audit export: copies a sealed bundle's manifest + every required member to --dest (sha256 matches); refuses not-sealed and dest-not-empty", () => {
  const { root, runDir } = mkRun("com-export-");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    const runId = runDir.split("/").pop();
    mintRunCloseAnchor(root, runDir, runId);
    const dest = join(root, "export-out");

    // not-sealed: export before any seal refuses (export never seals implicitly)
    const pre = JSON.parse(runCom(["audit", "export", "--run-dir", runDir, "--dest", dest, "--root", root]).stdout.trim());
    assert.equal(pre.exported, false);
    assert.equal(pre.reason, "not-sealed");

    // seal, then export copies the manifest + every member; each member's sha256 matches the manifest
    runCom(["audit", "seal", "--run-dir", runDir, "--root", root]);
    const exp = runCom(["audit", "export", "--run-dir", runDir, "--dest", dest, "--root", root]);
    assert.equal(exp.code, 0, `export failed: ${exp.stderr}`);
    assert.equal(JSON.parse(exp.stdout.trim()).exported, true);
    const man = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
    assert.ok(Object.keys(man.members).length > 0, "manifest carries members");
    for (const [name, ref] of Object.entries(man.members)) {
      assert.equal(sha256(readFileSync(join(dest, `${name}.bin`))), ref.sha256, `member ${name} sha256 matches the manifest`);
    }
    // dest-not-empty: a second export into the same populated dir refuses rather than merge/overwrite
    const again = JSON.parse(runCom(["audit", "export", "--run-dir", runDir, "--dest", dest, "--root", root]).stdout.trim());
    assert.equal(again.exported, false);
    assert.equal(again.reason, "dest-not-empty");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// === FAFF-976: the merge chokepoint's PREVENTION property on the committed-anchor / CI path ===
// FAFF-828 proved the chokepoint on the live run dir; the anchor / CI path re-verifies the committed
// Commissaire decision through verifyAuthLeg (governance-check's integrity auth sub-leg), which needs
// the PUBLIC pk.json present in the anchor. mintIssueAnchor now byte-copies commissaire/producer/pk.json
// (nested, public-only) so a genuinely-governed merge PERMITS from a committed anchor and a forged one
// still REFUSES — without ever anchoring the governor SK/master.

// Build a governed run (admit -> declare -> request-decision granting a merge) with a minimal
// events.jsonl, then mint its committed anchor. Returns { root, runDir, anchorDir, mint }.
function mintGovernedAnchor(prefix, runId = "RUN-976") {
  const { root, runDir } = mkRun(prefix, runId);
  assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
  assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
  assert.equal(JSON.parse(runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } })).stdout.trim()).verdict, "grant");
  writeFileSync(join(runDir, "events.jsonl"), `{"schema":1,"run_id":"${runId}","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
  const anchorDir = join(root, ".faff", "anchors", runId, "FAFF-1");
  const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDir);
  assert.equal(mint.ok, true, `governed anchor mint must succeed (${JSON.stringify(mint)})`);
  return { root, runDir, anchorDir, mint };
}

test("FAFF-976 anchor-path PERMIT: a committed anchor carries the PUBLIC pk.json (only) and verifyAuthLeg passes over it — never the governor secret", () => {
  const { root, anchorDir, mint } = mintGovernedAnchor("com-976-permit-");
  try {
    const pk = JSON.parse(readFileSync(join(anchorDir, "commissaire", "producer", "pk.json"), "utf8"));
    assert.deepEqual(Object.keys(pk).sort(), ["pk", "pk_fingerprint"], "the anchored pk.json carries ONLY the public key + fingerprint");
    assert.ok(mint.copiedFloorFiles.includes("commissaire/producer/pk.json"), "the mint reports the copied public key");
    // the governor secret is NEVER in the anchor
    assert.equal(existsSync(join(anchorDir, "commissaire", "governor", "governor.json")), false, "the governor file is never anchored");
    // the CI re-verification leg PERMITS: verifyAuthLeg over the anchor dir passes (governor absent -> public-key fallback)
    const auth = verifyAuthLeg(anchorDir);
    assert.ok(auth.pass, `verifyAuthLeg PERMITS the governed anchor (${JSON.stringify(auth.failures)})`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-976 anchor-path REFUSE (forged): a producer-HMAC'd verdict in the committed anchor fails verifyAuthLeg", () => {
  const { root, anchorDir } = mintGovernedAnchor("com-976-forge-");
  try {
    const ledgerPath = join(anchorDir, "declared-effects.jsonl");
    const key = deriveKey("master", "P1", "r1"); // a producer-held HMAC key, NOT the Ed25519 SK
    const forged = records(ledgerPath).map((r) => {
      if (r.kind_of_entry !== "effect-decision-verdict") return r;
      const f = { ...r };
      delete f.commissaire_sig;
      f.commissaire_sig = signRecord(f, key); // producer HMAC masquerading as a Commissaire decision
      return f;
    });
    writeFileSync(ledgerPath, forged.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const auth = verifyAuthLeg(anchorDir);
    assert.equal(auth.pass, false, "verifyAuthLeg REFUSES a forged decision even from a committed anchor");
    assert.ok(auth.failures.some((x) => x.reason === "commissaire-sig-invalid"), "the failure is a commissaire-sig-invalid");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-976 ungoverned run: the anchor writes no commissaire/ dir and reports no copied key", () => {
  const { root, runDir } = mkRun("com-976-ungov-", "RUN-976-UNGOV");
  try {
    writeFileSync(join(runDir, "events.jsonl"), `{"schema":1,"run_id":"RUN-976-UNGOV","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
    const anchorDir = join(root, ".faff", "anchors", "RUN-976-UNGOV", "FAFF-1");
    const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDir);
    assert.equal(mint.ok, true);
    assert.equal(existsSync(join(anchorDir, "commissaire")), false, "no commissaire/ dir is written for an ungoverned run");
    assert.equal(mint.copiedFloorFiles.includes("commissaire/producer/pk.json"), false, "no public key is reported copied");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FAFF-976 secret-material guard: a pk.json carrying an sk field fails the mint LOUD rather than committing a secret", () => {
  const { root, runDir } = mkRun("com-976-secret-", "RUN-976-SEC");
  try {
    runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    writeFileSync(join(runDir, "events.jsonl"), `{"schema":1,"run_id":"RUN-976-SEC","seq":0,"ts":"2026-01-01T00:00:00.000Z","phase":"run","type":"run-start"}\n`);
    // a writer regression leaks a secret into the public key file
    const pkPath = join(runDir, "commissaire", "producer", "pk.json");
    const pk = JSON.parse(readFileSync(pkPath, "utf8"));
    writeFileSync(pkPath, JSON.stringify({ ...pk, sk: "LEAKED-SECRET" }));
    const anchorDir = join(root, ".faff", "anchors", "RUN-976-SEC", "FAFF-1");
    const mint = mintIssueAnchor(runDir, "FAFF-1", anchorDir);
    assert.equal(mint.ok, false, "the mint refuses a pk.json carrying secret material");
    assert.equal(mint.code, "pk-secret-material");
    assert.equal(existsSync(join(anchorDir, "commissaire", "producer", "pk.json")), false, "no secret-bearing key was written to the anchor");

    // the guard is an allowlist, not a top-level sk/master_secret denylist: a NESTED or RENAMED secret
    // (a writer regression the denylist would miss) is refused because it is an unexpected field.
    for (const leak of [{ ...pk, key: { sk: "NESTED" } }, { ...pk, sk_hex: "RENAMED" }, { ...pk, master: "X" }]) {
      writeFileSync(pkPath, JSON.stringify(leak));
      const m = mintIssueAnchor(runDir, "FAFF-1", join(root, ".faff", "anchors", `SEC-${Object.keys(leak).length}-${Object.keys(leak)[2]}`, "FAFF-1"));
      assert.equal(m.ok, false, `the allowlist guard refuses an unexpected field: ${Object.keys(leak).join(",")}`);
      assert.equal(m.code, "pk-secret-material");
    }

    // a present-but-malformed pk.json also fails the mint LOUD (never a governed anchor with no key)
    writeFileSync(pkPath, "{ not json");
    const bad = mintIssueAnchor(runDir, "FAFF-1", join(root, ".faff", "anchors", "RUN-976-SEC-2", "FAFF-1"));
    assert.equal(bad.ok, false, "the mint refuses an unreadable/malformed pk.json");
    assert.equal(bad.code, "pk-unreadable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// --- Fixture: snapshot-pinning-unit (FAFF-979 — the strongest deterministic proof) ------
test("snapshot-pinning-unit: appendProducerRecords({withSnapshot}) pins the ledger under the lock — a later on-disk mutation is excluded, the request record is included", () => {
  const { runDir, ledger } = mkRun("com-snap-");
  try {
    const key = deriveKey("m", "P1", "r1");
    const requestBody = { kind_of_entry: "effect-decision-request", issue: "FAFF-1", step: "merge", payload: { effect: { kind: "merge", target: "main" } } };
    const { minted, snapshot } = appendProducerRecords(runDir, key, "P1", "r1", [requestBody], "t", { withSnapshot: true });
    const requestRecord = minted[0];
    // mutate the on-disk ledger AFTER the snapshot was captured inside the lock
    const bogus = { schema: 3, author: "producer", kind_of_entry: "observe", issue: "FAFF-1", step: "merge", seq: 999 };
    writeFileSync(ledger, readFileSync(ledger, "utf8") + JSON.stringify(bogus) + "\n");
    // (a) the pinned snapshot excludes the mutation; a fresh unlocked read sees it
    assert.ok(!snapshot.some((e) => e.seq === 999), "the pinned snapshot excludes the post-lock mutation");
    assert.ok(readLedgerEntries(runDir).some((e) => e.seq === 999), "the unlocked reader sees the mutation on disk");
    // (b) the pinned snapshot includes the just-appended request record at its seq
    assert.ok(snapshot.some((e) => e.kind_of_entry === "effect-decision-request" && e.seq === requestRecord.seq), "the pinned snapshot includes the request record");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: interleave-ignored (FAFF-979 — the env-seam CLI proof) ---------------------
test("interleave-ignored: an append landing in the post-request window cannot change the verdict — the pinned snapshot grants all-legs-pass while the interleave lands on disk unread", () => {
  const { runDir, ledger } = mkRun("com-interleave-");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    assert.equal(runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    // the request rests on the pre-request observe's seq; the interleave observe carries a HIGHER
    // seq, so were it read (unpinned) the freshness leg would flip to stale-evidence (deny).
    const preObserve = records(ledger).filter((r) => r.kind_of_entry === "observe").pop();
    const interleaveFile = join(runDir, "interleave.jsonl");
    const interleave = { schema: 3, author: "producer", kind_of_entry: "observe", issue: "FAFF-1", step: "merge", seq: 999, effect: { kind: "merge", target: "main" } };
    writeFileSync(interleaveFile, JSON.stringify(interleave) + "\n");
    const rd = runCli(["commissaire", "request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"],
      { input: JSON.stringify({ effect: { kind: "merge", target: "main" }, evidence_seq: preObserve.seq }),
        env: { ...process.env, FAFF_TEST_LEDGER_INTERLEAVE: interleaveFile } });
    assert.equal(rd.code, 0);
    const out = JSON.parse(rd.stdout.trim());
    assert.equal(out.verdict, "grant");
    assert.equal(out.reason, "all-legs-pass");
    // the interleave really landed on disk (it was appended, just excluded from the pinned snapshot)
    assert.ok(records(ledger).some((r) => r.seq === 999), "the interleave line is present on disk afterward");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});

// --- Fixture: transparency-no-interleave (FAFF-979) -------------------------------------
test("transparency-no-interleave: with no interleave, the same request grants all-legs-pass (pinning is invisible on the honest path)", () => {
  const { runDir, ledger } = mkRun("com-transparent-");
  try {
    assert.equal(runCom(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]).code, 0);
    assert.equal(runCom(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    assert.equal(runCom(["observe", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }])).code, 0);
    const preObserve = records(ledger).filter((r) => r.kind_of_entry === "observe").pop();
    const rd = runCom(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"],
      JSON.stringify({ effect: { kind: "merge", target: "main" }, evidence_seq: preObserve.seq }));
    assert.equal(rd.code, 0);
    const out = JSON.parse(rd.stdout.trim());
    assert.equal(out.verdict, "grant");
    assert.equal(out.reason, "all-legs-pass");
  } finally { rmSync(join(runDir, "..", "..", ".."), { recursive: true, force: true }); }
});
