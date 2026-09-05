// ===========================================================================
// === region:factory — commissaire — FAFF-828: the external Commissaire facade (schema:3 governed records, verb-3 protected-effect decisions) ===
//
// The minimal external governance facade a SECOND producer (not faff's own runner)
// drives to produce authenticated governed facts, request a Commissaire-signed
// protected-effect decision, reconcile observed-minus-declared, and — via boundary
// stubs — request a terminal verdict and a sealed bundle. Verb 3 (request-decision)
// is built to depth; verbs 5/6 delegate to existing anchor/bundle handlers.
//
// Six conceptual facade verbs → SEVEN CLI subcommands: verb 4 ("Observe + reconcile") is
// exposed as two atomic ops (`observe` + `reconcile`) rather than one compound command — the
// compound-verb split the spec's U1 defers (decides: architecture). The mapping:
//   1 Admission        -> admit
//   2 Declare          -> declare
//   3 Request decision -> request-decision   (built to depth)
//   4 Observe+reconcile-> observe, reconcile  (two atomic ops)
//   5 Terminal verdict -> terminal-verdict    (boundary stub)
//   6 Seal+bundle      -> seal-bundle         (boundary stub)
//
// The facade delivers a DECISION, not an enforcement: it makes a grant unforgeable
// and verifiable (Commissaire signs with Ed25519; a producer holds only a symmetric
// HMAC key). PREVENTION is a separate act a chokepoint on the effect path performs by
// verifying that signed decision (the worked chokepoint is merge-gate's pre-merge
// floor). Detection (observe-and-reconcile, computeEscapes) runs alongside.
//
// Region FACTORY: the shell (external CLI, admission, key delivery, PK publication)
// requires the governance cores (producer-auth.js, events.js, effects.js) — a
// factory→governance edge is legal; the reverse is not, which is why the pure
// split-key cores live in governance and this shell in factory. Zero-dependency,
// node:crypto via producer-auth only.
// ===========================================================================

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  deriveKey, signRecord, verifyRecord,
  mintGovernorKeypair, pkFingerprint, signDecision, verifyDecision,
  producerAuthSelftest,
} = require("./producer-auth");
const { appendRecordsUnderLock, verifyEffectsChain, sha256Hex, parseJsonlEntries } = require("./events");
const { effectDescriptorViolations, normEffect, effectTargetMatches, computeEscapes } = require("./effects");
const { ENTRYPOINT, findRoot } = require("./shared-infra");
// FAFF-1000 — `audit seal`/`export` build and read the run-close recovery bundle IN-PROCESS via the
// denylist-clean sealing core (never `faff bundle publish`, never `./bundle`, `./config`, or
// `./contract-defs`, all of which reach the standalone-commissaire DENYLIST). This is the ONLY new
// require the seal/export depth adds; its whole transitive graph is proven clean by FAFF-999's
// import-independence walk (test/commissaire-standalone.test.mjs).
const { buildBundle, localBundleStore, requiredMembersFor } = require("./bundle-seal-core");

// The verb-typed record kinds the schema:3 envelope carries, and which author writes each.
const KIND_AUTHOR = {
  admission: "commissaire",
  declare: "producer",
  observe: "producer",
  "effect-decision-request": "producer",
  "effect-decision-verdict": "commissaire",
  reconcile: "producer",
  accepted_under_contract: "commissaire",
};
const DECISION_VERDICTS = new Set(["grant", "deny"]);

// The declared-effects ledger the schema:3 records chain into — SAME file + lock as the
// schema:2 effects ledger, so computeEscapes (verb-4 detection) reads them unchanged and the
// integrity leg re-hashes one chain. A fresh schema:3 run uses a fresh run dir ⇒ a distinct
// run_id / genesis, so it never shares a canonical history with a pre-cutover schema:2 ledger.
const LEDGER_CFG = { ledgerFile: "declared-effects.jsonl", lock: { code: "EFFECTS_LOCKED", label: "effects lock" } };

const governorDirOf = (runDir, override) => override || path.join(runDir, "commissaire", "governor");
const producerDirOf = (runDir, override) => override || path.join(runDir, "commissaire", "producer");
const producerFileOf = (producerDir, id) => path.join(producerDir, "producers", `${id}.json`);
const pkFileOf = (producerDir) => path.join(producerDir, "pk.json");
const governorFileOf = (governorDir) => path.join(governorDir, "governor.json");

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const writeJson = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n"); };
const readLedgerEntries = (runDir) => {
  const p = path.join(runDir, LEDGER_CFG.ledgerFile);
  if (!fs.existsSync(p)) return [];
  return parseJsonlEntries(fs.readFileSync(p, "utf8"));
};

// --- Ledger append: mint schema:3 records, signing each inside the lock -------------------

// Build the common schema:3 envelope (WITHOUT the auth field), given the seq/prev the lock
// assigned. `body` carries the verb-specific fields (kind_of_entry, issue, step, effect|payload).
function buildEnvelope(runId, seq, prevHash, author, producerId, contractRevision, body, ts) {
  const rec = {
    schema: 3, run_id: runId, seq, ts: ts || new Date().toISOString(),
    author, producer_id: producerId, contract_revision: contractRevision,
    kind_of_entry: body.kind_of_entry, issue: body.issue, step: body.step, prev: prevHash,
  };
  if (body.effect !== undefined) rec.effect = body.effect;
  if (body.payload !== undefined) rec.payload = body.payload;
  return rec;
}

// Append N producer-authored records (HMAC'd under K_producer) as one atomic chained batch.
function appendProducerRecords(runDir, key, producerId, contractRevision, bodies, ts, opts) {
  const runId = path.basename(runDir);
  return appendRecordsUnderLock(runDir, LEDGER_CFG, bodies.length, (index, seq, _prev, prevHash) => {
    const rec = buildEnvelope(runId, seq, prevHash, "producer", producerId, contractRevision, bodies[index], ts);
    rec.producer_hmac = signRecord(rec, key);
    return rec;
  }, opts);
}

// Append one Commissaire-authored record (Ed25519-signed under SK) as a chained record.
function appendCommissaireRecord(runDir, sk, producerId, contractRevision, body, ts) {
  const runId = path.basename(runDir);
  const written = appendRecordsUnderLock(runDir, LEDGER_CFG, 1, (_i, seq, _prev, prevHash) => {
    const rec = buildEnvelope(runId, seq, prevHash, "commissaire", producerId, contractRevision, body, ts);
    rec.commissaire_sig = signDecision(rec, sk);
    return rec;
  });
  return written === null ? null : written[0];
}

// --- Pure core: evaluate a protected-effect decision request (verb 3) --------------------

// Given the admission record, the producer's (already-built, HMAC'd) request record, the
// master-derived key, and the ledger entries so far, decide grant/deny with the first failing
// leg's reason. PURE — no I/O. This is the born-verifiable heart of verb 3.
function evaluateDecisionRequest(admission, requestRecord, key, ledgerEntries) {
  // Leg 1 — admitted?
  if (!admission || admission.status === "revoked") return { verdict: "deny", reason: "producer-not-admitted" };
  // Assurance floor (step 6) — a weaker-class record (a J-D self-declaration, an E-C observation)
  // MUST NOT stand in for an E-B grant request. Only a genuine effect-decision-request qualifies.
  if (!requestRecord || requestRecord.kind_of_entry !== "effect-decision-request") {
    return { verdict: "deny", reason: "assurance-floor" };
  }
  // Leg 2 — the producer's request authenticates under its own key.
  if (!verifyRecord(requestRecord, key)) return { verdict: "deny", reason: "producer-auth-failed" };
  const effect = requestRecord.payload && requestRecord.payload.effect;
  // Leg 4 — descriptor validity (run before scope so a malformed kind is named precisely).
  const viol = effectDescriptorViolations(effect);
  if (viol.length) return { verdict: "deny", reason: "invalid-effect-descriptor" };
  // Leg 3 — scope.
  const scope = Array.isArray(admission.admitted_scope) ? admission.admitted_scope : [];
  if (!scope.includes(effect.kind)) return { verdict: "deny", reason: "effect-out-of-scope" };
  // Leg 5a — freshness: a request resting on evidence older than the latest observation for
  // (issue, step) is stale.
  const issue = requestRecord.issue, step = requestRecord.step;
  let latestObserveSeq = -1;
  for (const e of ledgerEntries) {
    if (e.kind_of_entry === "observe" && e.issue === issue && e.step === step && Number.isInteger(e.seq)) {
      latestObserveSeq = Math.max(latestObserveSeq, e.seq);
    }
  }
  const evidenceSeq = requestRecord.payload && requestRecord.payload.evidence_seq;
  if (Number.isInteger(evidenceSeq) && latestObserveSeq >= 0 && evidenceSeq < latestObserveSeq) {
    return { verdict: "deny", reason: "stale-evidence" };
  }
  // Leg 5b — coverage: the granted effect must be declared or wildcard-covered for (issue, step).
  const covered = ledgerEntries.some((e) =>
    e.kind_of_entry === "declare" && e.issue === issue && e.step === step &&
    e.effect && e.effect.kind === effect.kind && effectTargetMatches(e.effect.target, effect.target));
  if (!covered) return { verdict: "deny", reason: "effect-not-declared" };
  // Every leg passes → grant.
  return { verdict: "grant", reason: "all-legs-pass" };
}

// --- Pure core: chokepoint_permit -------------------------------------------------------

// Where prevention happens (e.g. merge-gate). Holds only PK. Verifies a signed decision covers
// the effect before permitting it. Returns { permit, reason }. A producer-authored or unverified
// or wrong-fingerprint or non-grant or non-covering decision is REFUSED.
function chokepointPermit(effect, verdictRecord, pk, pinnedFingerprint) {
  if (!verdictRecord || verdictRecord.author !== "commissaire") return { permit: false, reason: "not-a-commissaire-decision" };
  if (!verifyDecision(verdictRecord, pk)) return { permit: false, reason: "decision-signature-invalid" };
  // Fingerprint pin: the verdict carries no fingerprint of its own; the pin lives on the held PK.
  if (pinnedFingerprint != null) {
    let fp;
    try { fp = pkFingerprint(pk); } catch { return { permit: false, reason: "pk-unreadable" }; }
    if (fp !== pinnedFingerprint) return { permit: false, reason: "pk-fingerprint-mismatch" };
  }
  const p = verdictRecord.payload || {};
  if (p.verdict !== "grant") return { permit: false, reason: "decision-not-a-grant" };
  const granted = p.effect;
  if (!granted || granted.kind !== effect.kind || !effectTargetMatches(granted.target, effect.target)) {
    return { permit: false, reason: "grant-does-not-cover-effect" };
  }
  return { permit: true, reason: "valid-grant" };
}

// --- Auth leg (consumed by governance-check.js, factory→governance is legal) --------------

// Re-authenticate every schema:3 record in a run dir's ledger: producer records verify under
// the master-re-derived key AND their producer must be admitted (non-revoked); commissaire
// records verify under PK. Records at schema < 3 are skipped (frozen pre-cutover history —
// classified, never re-authenticated). Returns { pass, failures: [{seq, reason}], unverifiable: [] }.
//
// The honest symmetric limit is NON-GATING: verifying a producer CLAIM needs the symmetric key,
// so when the governor material (master) is absent — e.g. a committed anchor that deliberately
// never carries the secret master — producer records are recorded as `unverifiable`, not failures,
// and `pass` stays true. Commissaire DECISIONS are always checkable (PK is public), so a forged or
// tampered decision fails-closed regardless. When the master IS present (a local run dir), a
// producer-auth mismatch or a revoked/unadmitted producer fails-closed. `pass` = no GATING failures.
function verifyAuthLeg(runDir, governorDir, producerDir) {
  const entries = readLedgerEntries(runDir);
  const gov = readJson(governorFileOf(governorDirOf(runDir, governorDir)));
  const pkRec = readJson(pkFileOf(producerDirOf(runDir, producerDir)));
  // FAFF-978: the governor file is the AUTHORITATIVE source of PK_commissaire — prefer it. The
  // producer-dir pk.json is producer-writable (the less-trusted custodian), so it must never be
  // the source of truth for verifying Commissaire signatures; a producer could otherwise swap it
  // for their own key and self-sign a "commissaire" verdict. Fall back to it only when no governor
  // material is present (a pure-audit context reading a published PK). When BOTH exist, cross-check
  // the producer-dir fingerprint against the governor's and fail closed on a mismatch (tamper signal).
  const pk = gov ? gov.pk : (pkRec ? pkRec.pk : null);
  const failures = [];
  const unverifiable = [];
  if (gov && pkRec) {
    let fp = null;
    try { fp = pkFingerprint(pkRec.pk); } catch { fp = null; }
    if (fp !== gov.pk_fingerprint) failures.push({ seq: null, reason: "pk-fingerprint-tampered" });
  }
  for (const e of entries) {
    if (e.schema !== 3) continue; // frozen pre-cutover line — never re-authenticated
    if (e.author === "producer") {
      if (!gov || gov.master_secret == null) { unverifiable.push({ seq: e.seq, reason: "no-master" }); continue; }
      const key = deriveKey(gov.master_secret, e.producer_id, e.contract_revision);
      if (!verifyRecord(e, key)) { failures.push({ seq: e.seq, reason: "producer-auth-mismatch" }); continue; }
      const admission = readJson(producerFileOf(producerDirOf(runDir, producerDir), e.producer_id));
      if (!admission || admission.status === "revoked") { failures.push({ seq: e.seq, reason: "producer-not-admitted" }); }
    } else if (e.author === "commissaire") {
      if (!pk || !verifyDecision(e, pk)) { failures.push({ seq: e.seq, reason: "commissaire-sig-invalid" }); }
    }
  }
  return { pass: failures.length === 0, failures, unverifiable };
}

// Whether a run dir carries a schema:3 governance context at all (any schema:3 record). Cheap
// gate the integrity leg / merge chokepoint uses to stay a no-op on ordinary ungoverned runs.
function hasGovernanceContext(runDir) {
  return readLedgerEntries(runDir).some((e) => e.schema === 3);
}

// FAFF-977: `audit verify` — the secret-free external replay entry point, the first operation
// under the ADR-0123 `audit` object namespace. A thin READ-ONLY projection of verifyAuthLeg onto
// a stable, versioned JSON contract (AuditVerifyOutput) that FAFF-360's independent portable
// verifier reproduces by hand and is tested against as the conformance oracle. It writes NO
// signature or HMAC logic of its own — verifyAuthLeg is the one core, called exactly once. The
// three-way producer classification (verified / unverifiable_without_secret / failed) maps
// directly onto that core's { pass, failures, unverifiable } return; unverifiable is NEVER folded
// into a pass, because a claim the secret-free consumer cannot check is not authenticated.
//
// Exit contract (a public part of the oracle, deliberately distinct from the sibling verbs' 0/2/3):
//   0  valid decisions, honest producer classification (auth.pass true, a governance context exists)
//   1  verification failure (any verifyAuthLeg failure — a failed record, or a record-less
//      ledger-level failure such as pk-fingerprint-tampered)
//   2  invalid invocation or setup (missing/non-directory --run-dir, or no schema-3 governance
//      context) — nothing is written to stdout, the diagnostic goes to stderr
function cmdAuditVerify(flags) {
  const runDir = flags["--run-dir"];
  if (!runDir || !fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    process.stderr.write("faff commissaire audit verify: --run-dir <dir> is required and must be an existing directory\n");
    return 2;
  }
  if (!hasGovernanceContext(runDir)) {
    process.stderr.write(`faff commissaire audit verify: no schema-3 governance context in ${runDir} — nothing to replay\n`);
    return 2;
  }
  // The ONE core call. governor/producer dir overrides pass straight through; a secret-free
  // consumer supplies neither and the defaults resolve to <run-dir>/commissaire/{governor,producer}.
  const auth = verifyAuthLeg(runDir, flags["--governor-dir"], flags["--producer-dir"]);
  // Split the core's failures into record-level (a seq) and ledger-level (seq == null, e.g. the
  // FAFF-978 pk-fingerprint-tampered cross-check) — the latter matches no ledger record, so it is
  // surfaced under ledger_failures rather than silently dropped from the projection.
  const ledgerFailures = [];
  const failBySeq = new Map();
  for (const f of auth.failures) {
    if (f.seq == null) ledgerFailures.push({ reason: f.reason });
    else failBySeq.set(f.seq, f.reason);
  }
  const unverBySeq = new Map();
  for (const u of auth.unverifiable) unverBySeq.set(u.seq, u.reason);

  const entries = readLedgerEntries(runDir).filter((e) => e.schema === 3);
  const records = [];
  const producer = { verified: 0, unverifiable_without_secret: 0, failed: 0 };
  const commissaire = { verified: 0, failed: 0 };
  for (const e of entries) {
    let cls;
    let reason = null;
    if (e.author === "producer") {
      if (unverBySeq.has(e.seq)) { cls = "unverifiable_without_secret"; reason = unverBySeq.get(e.seq); }
      else if (failBySeq.has(e.seq)) { cls = "failed"; reason = failBySeq.get(e.seq); }
      else { cls = "verified"; }
      producer[cls]++;
    } else if (e.author === "commissaire") {
      // A public-key decision is always checkable — it never lands in `unverifiable`.
      if (failBySeq.has(e.seq)) { cls = "failed"; reason = failBySeq.get(e.seq); }
      else { cls = "verified"; }
      commissaire[cls]++;
    } else {
      continue; // no other author writes a schema:3 record; skip defensively rather than misclassify
    }
    records.push({ seq: e.seq, author: e.author, kind_of_entry: e.kind_of_entry, classification: cls, reason });
  }
  const pkRec = readJson(pkFileOf(producerDirOf(runDir, flags["--producer-dir"])));
  const out = {
    version: 1,
    result: auth.pass ? "pass" : "fail",
    governance_context: true,
    producer_claims: producer,
    commissaire_decisions: commissaire,
    pk_fingerprint: pkRec ? (pkRec.pk_fingerprint ?? null) : null,
    ledger_failures: ledgerFailures,
    records,
  };
  console.log(JSON.stringify(out));
  return auth.pass ? 0 : 1;
}

// --- CLI shell --------------------------------------------------------------------------

function usage() {
  process.stderr.write(
    "usage: faff commissaire <object> <action> ...  (ADR-0123 object-verb grammar; the flat verbs are retained aliases)\n" +
    "  contract admit    --run-dir DIR --producer ID --contract-revision R [--scope kind,kind] [--governor-dir D] [--producer-dir D] [--force]   (alias: admit)\n" +
    "  effect declare    --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])   (alias: declare)\n" +
    "  effect authorize  --run-dir DIR --producer ID --issue I --step S   (stdin: {effect, evidence_seq?})   (alias: request-decision)\n" +
    "  effect observe    --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])   (alias: observe)\n" +
    "  effect reconcile  --run-dir DIR --issue I   (alias: reconcile)\n" +
    "  verdict conclude  --run-dir DIR --issue I [--producer ID] [--governor-dir D] [--producer-dir D] [--ts T]   (append the signed accepted_under_contract record, or a refusal; alias: terminal-verdict)\n" +
    "  audit seal        --run-dir DIR [--root R] [--bundle-store local]   (build + write the run-close recovery bundle in-process; alias: seal-bundle)\n" +
    "  audit export      --run-dir DIR --dest DIR [--root R] [--bundle-store local]   (copy an already-sealed bundle's manifest + members to DIR)\n" +
    "  audit verify      --run-dir DIR [--governor-dir D] [--producer-dir D] [--json]   (secret-free replay of the auth leg; exit 0 pass / 1 verify-fail / 2 setup)\n");
}

function parseCommissaireArgs(args) {
  const flags = {};
  const rest = [];
  const single = new Set(["--run-dir", "--run", "--producer", "--contract-revision", "--scope", "--issue", "--step", "--governor-dir", "--producer-dir", "--ts", "--root", "--dest", "--bundle-store"]);
  for (let i = 0; i < args.length; i++) {
    if (single.has(args[i])) flags[args[i]] = args[++i];
    else if (args[i] === "--json") flags["--json"] = true;
    else if (args[i] === "--force") flags["--force"] = true;
    else rest.push(args[i]);
  }
  return { flags, rest };
}

function readStdinJson() {
  let raw;
  try { raw = fs.readFileSync(0, "utf8"); } catch { return { err: "cannot read payload from stdin" }; }
  try { return { value: JSON.parse(raw) }; } catch { return { err: "malformed payload (invalid JSON)" }; }
}

function requireRunDir(flags, verb) {
  const dir = flags["--run-dir"];
  if (!dir) { process.stderr.write(`faff commissaire ${verb}: --run-dir <dir> is required\n`); return null; }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    process.stderr.write(`faff commissaire ${verb}: run dir missing (${dir}) — initialise the run first\n`); return null;
  }
  return dir;
}

function cmdAdmit(flags) {
  const runDir = requireRunDir(flags, "admit");
  if (!runDir) return 3;
  const producerId = flags["--producer"];
  const contractRevision = flags["--contract-revision"];
  if (!producerId || !contractRevision) { process.stderr.write("faff commissaire admit: --producer and --contract-revision are required\n"); return 2; }
  const scope = (flags["--scope"] || "").split(",").map((s) => s.trim()).filter((s) => s !== "");
  const governorDir = governorDirOf(runDir, flags["--governor-dir"]);
  const producerDir = producerDirOf(runDir, flags["--producer-dir"]);
  if (path.resolve(governorDir) === path.resolve(producerDir)) {
    process.stderr.write("faff commissaire admit: --governor-dir and --producer-dir must differ (the SK and a producer key must never share one custodian)\n"); return 2;
  }
  // FAFF-978: admit is NOT idempotent by construction — a second admit mints a fresh keypair +
  // master, which would silently orphan every record already signed under the old material (the
  // whole audit trail becomes unverifiable). Refuse when governor OR this producer's material
  // already exists, unless --force is given (a deliberate key rotation the operator owns).
  if (!flags["--force"] && (fs.existsSync(governorFileOf(governorDir)) || fs.existsSync(producerFileOf(producerDir, producerId)))) {
    process.stderr.write(`faff commissaire admit: producer ${producerId} (or its governor) is already admitted — re-admitting mints a new keypair + master and orphans every record signed under the old material. Pass --force to rotate deliberately.\n`);
    return 2;
  }
  // Governor half: mint the keypair + master, hold SK + master in the governor dir only.
  const kp = mintGovernorKeypair();
  const masterSecret = require("node:crypto").randomBytes(32).toString("hex");
  writeJson(governorFileOf(governorDir), { sk: kp.sk, pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, master_secret: masterSecret });
  // Producer half: derive + deliver K_producer (never SK, never master); publish PK.
  const key = deriveKey(masterSecret, producerId, contractRevision);
  const admittedAt = flags["--ts"] || new Date().toISOString();
  writeJson(producerFileOf(producerDir, producerId), {
    producer_id: producerId, contract_revision: contractRevision, key_hex: key.toString("hex"),
    pk: kp.pk, pk_fingerprint: kp.pk_fingerprint, admitted_scope: scope, status: "admitted", admitted_at: admittedAt,
  });
  writeJson(pkFileOf(producerDir), { pk: kp.pk, pk_fingerprint: kp.pk_fingerprint });
  // Append a signed admission record to the ledger (author = commissaire) for the audit trail.
  appendCommissaireRecord(runDir, kp.sk, producerId, contractRevision, {
    kind_of_entry: "admission", issue: "-", step: "admit",
    payload: { producer_id: producerId, contract_revision: contractRevision, admitted_scope: scope, pk_fingerprint: kp.pk_fingerprint, admitted_at: admittedAt },
  }, flags["--ts"]);
  const out = { admitted: true, producer_id: producerId, admitted_scope: scope, pk_fingerprint: kp.pk_fingerprint, governor_dir: governorDir, producer_dir: producerDir };
  console.log(JSON.stringify(out));
  return 0;
}

function loadProducerKey(runDir, flags, producerId, verb) {
  const producerDir = producerDirOf(runDir, flags["--producer-dir"]);
  const admission = readJson(producerFileOf(producerDir, producerId));
  if (!admission) { process.stderr.write(`faff commissaire ${verb}: producer ${producerId} is not admitted (run \`admit\` first)\n`); return null; }
  // FAFF-978: refuse a REVOKED producer here, BEFORE any ledger append — otherwise a revoked
  // producer's request/declare/observe record lands in the ledger (polluting the audit trail) and
  // is only rejected later by evaluateDecisionRequest / the auth leg. This does NOT change the
  // killed-producer property: records written BEFORE revocation still fail the auth leg fail-closed.
  if (admission.status === "revoked") { process.stderr.write(`faff commissaire ${verb}: producer ${producerId} is revoked — no further records may be written\n`); return null; }
  return { admission, key: Buffer.from(admission.key_hex, "hex"), producerDir };
}

function cmdProducerLedger(flags, verb, kindOfEntry) {
  const runDir = requireRunDir(flags, verb);
  if (!runDir) return 3;
  const producerId = flags["--producer"], issue = flags["--issue"], step = flags["--step"];
  if (!producerId || !issue || !step) { process.stderr.write(`faff commissaire ${verb}: --producer, --issue and --step are required\n`); return 2; }
  const loaded = loadProducerKey(runDir, flags, producerId, verb);
  if (!loaded) return 2;
  const payload = readStdinJson();
  if (payload.err) { process.stderr.write(`faff commissaire ${verb}: ${payload.err}\n`); return 2; }
  const descriptors = Array.isArray(payload.value) ? payload.value : [payload.value];
  if (descriptors.length === 0) { process.stderr.write(`faff commissaire ${verb}: no effect descriptors in payload\n`); return 1; }
  for (let i = 0; i < descriptors.length; i++) {
    const v = effectDescriptorViolations(descriptors[i]);
    if (v.length) { for (const x of v) process.stderr.write(`- descriptor[${i}]: ${x}\n`); return 1; }
  }
  const bodies = descriptors.map((d) => ({ kind_of_entry: kindOfEntry, issue, step, effect: normEffect(d) }));
  const written = appendProducerRecords(runDir, loaded.key, producerId, loaded.admission.contract_revision, bodies, flags["--ts"]);
  console.log(JSON.stringify(written.length === 1 ? written[0] : written));
  return 0;
}

function cmdRequestDecision(flags) {
  const runDir = requireRunDir(flags, "request-decision");
  if (!runDir) return 3;
  const producerId = flags["--producer"], issue = flags["--issue"], step = flags["--step"];
  if (!producerId || !issue || !step) { process.stderr.write("faff commissaire request-decision: --producer, --issue and --step are required\n"); return 2; }
  const loaded = loadProducerKey(runDir, flags, producerId, "request-decision");
  if (!loaded) return 2;
  const gov = readJson(governorFileOf(governorDirOf(runDir, flags["--governor-dir"])));
  if (!gov) { process.stderr.write("faff commissaire request-decision: no governor material (run `admit` first)\n"); return 2; }
  const payload = readStdinJson();
  if (payload.err) { process.stderr.write(`faff commissaire request-decision: ${payload.err}\n`); return 2; }
  const req = payload.value || {};
  const contractRevision = loaded.admission.contract_revision;
  // Producer half: build + HMAC the request record, append it (author = producer).
  const requestBody = { kind_of_entry: "effect-decision-request", issue, step, payload: { effect: req.effect, declared_ref: req.declared_ref ?? null, evidence_seq: req.evidence_seq } };
  // FAFF-979: read the full-ledger snapshot INSIDE the same append lock as the request record,
  // so the freshness/coverage legs evaluate exactly the ledger as it stood the instant the
  // request was chained (no unlocked re-read that a concurrent append could slip into).
  const { minted, snapshot } = appendProducerRecords(runDir, loaded.key, producerId, contractRevision, [requestBody], flags["--ts"], { withSnapshot: true });
  const requestRecord = minted[0];
  // FAFF-979 test seam: FAFF_TEST_LEDGER_INTERLEAVE names a file whose raw bytes are appended
  // to the ledger AFTER the lock released, simulating a concurrent append landing in the old
  // interleave window. Because evaluation uses the pinned `snapshot` (captured under the lock,
  // excluding this append), the verdict is unaffected. Test-only; a no-op unless the env is set.
  if (process.env.FAFF_TEST_LEDGER_INTERLEAVE) {
    try { fs.appendFileSync(path.join(runDir, LEDGER_CFG.ledgerFile), fs.readFileSync(process.env.FAFF_TEST_LEDGER_INTERLEAVE)); } catch { /* seam is best-effort */ }
  }
  // Commissaire half: re-derive the key from master, authenticate, evaluate, sign the verdict.
  const key = deriveKey(gov.master_secret, producerId, contractRevision);
  const decision = evaluateDecisionRequest(loaded.admission, requestRecord, key, snapshot);
  const verdictBody = {
    kind_of_entry: "effect-decision-verdict", issue, step,
    payload: { request_seq: requestRecord.seq, verdict: decision.verdict, reason: decision.reason, effect: req.effect },
  };
  const verdictRecord = appendCommissaireRecord(runDir, gov.sk, producerId, contractRevision, verdictBody, flags["--ts"]);
  console.log(JSON.stringify({ verdict: decision.verdict, reason: decision.reason, verdict_seq: verdictRecord.seq, request_seq: requestRecord.seq }));
  return 0;
}

function cmdReconcile(flags) {
  const runDir = requireRunDir(flags, "reconcile");
  if (!runDir) return 3;
  const issue = flags["--issue"] || null;
  const result = computeEscapes(readLedgerEntries(runDir), issue);
  console.log(JSON.stringify(result));
  return 0;
}

// --- verb 5: `verdict conclude` (in-process, FAFF-1000) ----------------------------------
// A refusal is a COMPLETED evaluation that concluded "not yet", not an error: it is printed and
// exits 0 (mirroring evaluateDecisionRequest's grant/deny-is-not-an-error convention) and writes
// NOTHING to the ledger (a negative `outcome_rejected` record is out of scope — spec §2). The one
// setup error, `no-governor` (admit was never run), exits 2, matching cmdRequestDecision.
function refuseVerdict(reason, issue, detail) {
  console.log(JSON.stringify({ verdict: "refused", reason, issue, ...(detail || {}) }));
  return reason === "no-governor" ? 2 : 0;
}

// `verdict conclude` — the record only Commissaire may issue (V5 master doc). Validate the run dir
// and governor, resolve which producer's contract this concludes, check the three preconditions the
// issue names against the EXISTING ledger (producer admitted, no unreconciled escape, evidence
// present), and — only if all three pass — append one signed schema:3 `accepted_under_contract`
// record. Idempotent: a repeat call for an already-concluded issue returns the existing seq.
function cmdTerminalVerdict(flags) {
  const runDir = requireRunDir(flags, "verdict conclude");
  if (!runDir) return 3;
  const issue = flags["--issue"];
  if (!issue) { process.stderr.write("faff commissaire verdict conclude: --issue is required\n"); return 2; }
  const entries = readLedgerEntries(runDir).filter((e) => e.issue === issue);
  if (entries.length === 0) return refuseVerdict("no-evidence", issue);
  // Idempotent re-conclude: a prior `accepted_under_contract` for this issue is returned, never doubled.
  const existing = entries.find((e) => e.kind_of_entry === "accepted_under_contract");
  if (existing) { console.log(JSON.stringify({ verdict: "accepted_under_contract", issue, idempotent: true, seq: existing.seq })); return 0; }
  const producerIds = [...new Set(entries.map((e) => e.producer_id).filter((x) => x != null && x !== "-"))];
  let producerId;
  if (flags["--producer"]) {
    if (!producerIds.includes(flags["--producer"])) return refuseVerdict("no-evidence", issue, { producer_id: flags["--producer"] });
    producerId = flags["--producer"];
  } else if (producerIds.length === 1) {
    producerId = producerIds[0];
  } else {
    return refuseVerdict("ambiguous-producer", issue, { producers: producerIds });
  }
  const admission = readJson(producerFileOf(producerDirOf(runDir, flags["--producer-dir"]), producerId));
  if (!admission || admission.status === "revoked") return refuseVerdict("producer-not-admitted", issue, { producer_id: producerId });
  const escapeResult = computeEscapes(entries, issue);
  if (escapeResult.any_escape) return refuseVerdict("unreconciled-escape", issue, { escapes: escapeResult.escapes });
  const gov = readJson(governorFileOf(governorDirOf(runDir, flags["--governor-dir"])));
  if (!gov) return refuseVerdict("no-governor", issue); // setup error — exit 2, not a governed refusal
  // FAFF-1008 item 2: fail closed at conclude time when the admission and governor custodians
  // disagree on the public-key fingerprint (a missing fingerprint on either side counts as a
  // mismatch). The audit-leg check in verifyAuthLeg stays the authority; this catches the common
  // mismatched-dirs case before the record is signed rather than at audit.
  if (admission.pk_fingerprint == null || gov.pk_fingerprint == null || admission.pk_fingerprint !== gov.pk_fingerprint) {
    return refuseVerdict("pk-fingerprint-mismatch", issue, {
      producer_id: producerId,
      producer_pk_fingerprint: admission.pk_fingerprint ?? null,
      governor_pk_fingerprint: gov.pk_fingerprint ?? null,
    });
  }
  // FAFF-1008 item 1: label the terminal record from the signed ledger, not the live admission
  // file. A single distinct revision over the issue's entries is the honest label; more than one
  // means the evidence spans revisions and there is no honest label to stamp — refuse rather than
  // guess. The `> 1` guard (not `!= 1`) lets an empty set fall back to the admission's revision so a
  // non-governed edge (no entry carries a revision) cannot crash conclude.
  const revs = [...new Set(entries.map((e) => e.contract_revision).filter((x) => x != null))];
  if (revs.length > 1) return refuseVerdict("ambiguous-contract-revision", issue, { contract_revisions: revs.slice().sort() });
  const concludedRevision = revs.length === 1 ? revs[0] : admission.contract_revision;
  const seqs = entries.map((e) => e.seq).filter((s) => Number.isInteger(s));
  const body = {
    kind_of_entry: "accepted_under_contract", issue, step: "conclude",
    payload: {
      producer_id: producerId, contract_revision: concludedRevision,
      evidence_seq_range: [Math.min(...seqs), Math.max(...seqs)], escapes_checked: true,
    },
  };
  const record = appendCommissaireRecord(runDir, gov.sk, producerId, concludedRevision, body, flags["--ts"]);
  console.log(JSON.stringify({ verdict: "accepted_under_contract", issue, producer_id: producerId, seq: record.seq }));
  return 0;
}

// The facade reaches only the LOCAL BundleStore occupant in-process. The git-remote occupant lives
// in bundle.js (it needs node:child_process + config.js), which the denylist-clean facade must never
// require — so `--bundle-store git-remote` is refused here, never silently downgraded to local.
function resolveFacadeStore(flags, verb) {
  const name = flags["--bundle-store"] || "local";
  if (name !== "local") {
    process.stderr.write(`faff commissaire ${verb}: --bundle-store ${name} is not reachable from the standalone facade — only the local occupant runs in-process (the git-remote occupant requires the config-coupled bundle path FAFF-999's import independence excludes)\n`);
    return null;
  }
  const root = flags["--root"] || findRoot();
  return { store: localBundleStore(root), root };
}

// A monotonic boundary_seq scoped to (run_id, run_segment_id), resolved from the store's own listing
// — the same rule publishBundle's nextBoundarySeq applies (a re-seal of the SAME boundary_key gets
// back its OWN seq so the idempotent-no-op digest holds). The seq is one past the max over ALL
// boundaries in the segment, so run-close is 0 only in an otherwise-empty segment — it is max+1 when
// issue-merge-floor siblings coexist, exactly as publishBundle produces (the store keys the bundle
// dir by boundary_key, not boundary_seq, so headDigest/member still find it at any seq — see
// cmdAuditExport). Inlined rather than imported: nextBoundarySeq lives in the denylisted bundle.js,
// and this is a trivial store-listing helper, not forked integrity logic.
function facadeNextBoundarySeq(store, run_id, run_segment_id, boundary_key) {
  const existing = store.listBoundaries(run_id, run_segment_id) || [];
  const mine = existing.find((b) => b.boundary_key === boundary_key);
  if (mine && Number.isInteger(mine.boundary_seq)) return mine.boundary_seq;
  return existing.reduce((max, b) => Math.max(max, Number.isInteger(b.boundary_seq) ? b.boundary_seq : -1), -1) + 1;
}

// --- verb 6: `audit seal` (in-process, FAFF-1000) ----------------------------------------
// Build the run-close bundle from the run dir's own ledger/anchor bytes and write it to the local
// store — the same bytes `faff bundle publish --boundary-kind run-close` would produce, without
// spawning it. boundary_key is the LITERAL constant "run-close" (NOT basename(runDir): buildBundle
// requires boundary_key === "run-close" for a run-close bundle, so the old stub's basename always
// threw and `audit seal` never once sealed a bundle — the reproduced pre-existing bug).
function cmdSealBundle(flags) {
  const runDir = requireRunDir(flags, "audit seal");
  if (!runDir) return 3;
  const resolved = resolveFacadeStore(flags, "audit seal");
  if (!resolved) return 2;
  const { store, root } = resolved;
  const run_id = path.basename(runDir);
  const buildAt = (boundary_seq) => buildBundle(runDir, { run_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq }, root);
  let built;
  try {
    built = buildAt(0); // probe build — learns run_segment_id from buildBundle's own single ledger read
    const seq = facadeNextBoundarySeq(store, run_id, built.manifest.identity.run_segment_id, "run-close");
    if (seq !== 0) built = buildAt(seq);
  } catch (e) {
    process.stderr.write(`faff commissaire audit seal: ${e.message}\n`);
    return 1;
  }
  const { manifest, memberBytes } = built;
  const result = store.put(manifest.identity, memberBytes, manifest);
  console.log(JSON.stringify({
    sealed: result.ok !== false, idempotent: !!result.idempotent,
    identity: manifest.identity, bundle_manifest_digest: manifest.bundle_manifest_digest,
  }));
  // ok (including store_unavailable, which never fails the run — same rule as `bundle publish`) -> 0;
  // a genuine failure (e.g. identity-conflict) -> 1.
  if (result.ok === false && result.reason !== "store_unavailable") return 1;
  return 0;
}

// --- `audit export` (new, FAFF-1000) -----------------------------------------------------
// Copy an ALREADY-sealed run-close bundle's manifest + member bytes to --dest. Never seals
// implicitly (that is `audit seal`'s job): a bundle the store cannot head is `not-sealed`. Refuses a
// non-empty --dest rather than merge/overwrite — an export is a clean, verifiable copy.
function cmdAuditExport(flags) {
  const runDir = requireRunDir(flags, "audit export");
  if (!runDir) return 3;
  const dest = flags["--dest"];
  if (!dest) { process.stderr.write("faff commissaire audit export: --dest <dir> is required\n"); return 2; }
  const resolved = resolveFacadeStore(flags, "audit export");
  if (!resolved) return 2;
  const { store } = resolved;
  const run_id = path.basename(runDir);
  // run_segment_id — the SAME read buildBundle does (owner.epoch off run-ledger.json).
  let run_segment_id;
  try {
    const ledgerObj = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    run_segment_id = Number((ledgerObj.owner && ledgerObj.owner.epoch) || 0);
  } catch (e) {
    process.stderr.write(`faff commissaire audit export: cannot read run-ledger.json (${e.message})\n`);
    return 1;
  }
  const identity = { run_id, run_segment_id, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 0 };
  const head = store.headDigest(identity);
  if (head.status !== "ok") { console.log(JSON.stringify({ exported: false, reason: "not-sealed" })); return 1; }
  // --dest must be absent or empty — never blend a partial prior export with a new one.
  if (fs.existsSync(dest)) {
    let names;
    try { names = fs.readdirSync(dest); } catch { names = ["<unreadable>"]; }
    if (names.length > 0) { console.log(JSON.stringify({ exported: false, reason: "dest-not-empty" })); return 1; }
  }
  fs.mkdirSync(dest, { recursive: true });
  const manifest = { version: head.version, identity: head.identity, members: head.memberRefs, bundle_manifest_digest: head.digest };
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const name of requiredMembersFor(head.version)) {
    const member = store.member(identity, name);
    if (member.status !== "ok") { console.log(JSON.stringify({ exported: false, reason: "not-sealed", member: name })); return 1; }
    fs.writeFileSync(path.join(dest, `${name}.bin`), member.bytes);
  }
  console.log(JSON.stringify({ exported: true, dest, identity: head.identity, bundle_manifest_digest: head.digest }));
  return 0;
}

// === ADR-0123 noun-verb object grammar (FAFF-980) =======================================
// The Commissaire surface is `commissaire <object> <action>` over the governed objects, with the
// seven FAFF-828 flat verbs retained as compatibility aliases. Two module-level tables replace the
// ad-hoc verb switch: a canonical dispatch table (the ONLY place a handler is named) and a flat-
// verb → canonical-key alias map (an alias is a second spelling, never a second implementation).

// First-token object namespaces.
const OBJECT_TOKENS = new Set(["contract", "effect", "verdict", "audit"]);

// Canonical key (object-verb string) → the single handler invocation. `audit verify` is FAFF-977's
// handler, wired in here so the unified resolver keeps it working; its body is untouched.
const COMMISSAIRE_DISPATCH = {
  "contract admit": (flags) => cmdAdmit(flags),
  "effect declare": (flags) => cmdProducerLedger(flags, "declare", "declare"),
  "effect authorize": (flags) => cmdRequestDecision(flags),
  "effect observe": (flags) => cmdProducerLedger(flags, "observe", "observe"),
  "effect reconcile": (flags) => cmdReconcile(flags),
  "verdict conclude": (flags) => cmdTerminalVerdict(flags),
  "audit seal": (flags) => cmdSealBundle(flags),
  "audit export": (flags) => cmdAuditExport(flags), // FAFF-1000
  "audit verify": (flags) => cmdAuditVerify(flags), // FAFF-977, retained (not this ticket's key)
};

// Flat verb (FAFF-828 spelling) → canonical key. An alias never appears as a COMMISSAIRE_DISPATCH
// key: it resolves to one before dispatch, so there is exactly one handler per operation.
const COMMISSAIRE_ALIASES = {
  "admit": "contract admit",
  "declare": "effect declare",
  "request-decision": "effect authorize",
  "observe": "effect observe",
  "reconcile": "effect reconcile",
  "terminal-verdict": "verdict conclude",
  "seal-bundle": "audit seal",
};

// Required flags per canonical key — the single source COMMISSAIRE_SURFACE.subcommands derives from,
// so the declared grammar cannot drift from dispatch. `effect reconcile` requires only `--issue`
// (FAFF-978 removed the phantom `--producer` requirement; cmdReconcile gates on nothing else).
const REQUIRED_FLAGS_BY_CANONICAL = {
  "contract admit": ["--producer", "--contract-revision"],
  "effect declare": ["--producer", "--issue", "--step"],
  "effect authorize": ["--producer", "--issue", "--step"],
  "effect observe": ["--producer", "--issue", "--step"],
  "effect reconcile": ["--issue"],
  "verdict conclude": ["--issue"],
  "audit seal": [],
  "audit export": ["--dest"], // FAFF-1000
  "audit verify": ["--run-dir"], // FAFF-977, retained
};

// Resolve one or two leading non-flag tokens to a canonical COMMISSAIRE_DISPATCH key, or null.
function resolveCommissaireKey(rest) {
  if (!rest.length) return null;
  if (OBJECT_TOKENS.has(rest[0])) {
    const key = rest[0] + " " + (rest[1] || ""); // "contract admit" — or "contract " when no action
    return Object.prototype.hasOwnProperty.call(COMMISSAIRE_DISPATCH, key) ? key : null;
  }
  if (Object.prototype.hasOwnProperty.call(COMMISSAIRE_ALIASES, rest[0])) return COMMISSAIRE_ALIASES[rest[0]];
  return null;
}

function cmdCommissaire(args) {
  if (args.includes("--selftest")) return commissaireSelftest();
  const { flags, rest } = parseCommissaireArgs(args);
  const key = resolveCommissaireKey(rest);
  if (!key) { usage(); return 2; }
  return COMMISSAIRE_DISPATCH[key](flags);
}

// The CLI surface grammar (cli-surface.js DISPATCH_SURFACES entry).
const COMMISSAIRE_SPEC = { flags: {
  "--run-dir": { arity: 1 }, "--run": { arity: 1 }, "--producer": { arity: 1 }, "--contract-revision": { arity: 1 },
  "--scope": { arity: 1 }, "--issue": { arity: 1 }, "--step": { arity: 1 }, "--governor-dir": { arity: 1 },
  "--producer-dir": { arity: 1 }, "--ts": { arity: 1 },
  "--root": { arity: 1 }, "--dest": { arity: 1 }, "--bundle-store": { arity: 1 }, // FAFF-1000 (audit seal/export)
  "--force": { arity: 0 }, "--json": { arity: 0 }, "--selftest": { arity: 0 },
} };
// Derive the declared surface from the single source (REQUIRED_FLAGS_BY_CANONICAL +
// COMMISSAIRE_ALIASES): every canonical compound key plus every flat alias key, each alias carrying
// its canonical's required_flags. Compound string keys stay on the flat `subcommands` map (mirroring
// the hyphenated `request-decision` key and FAFF-977's `audit verify`), so buildCliSurface /
// acceptedFlags / cliSurfaceSelftest need no change. Listing an alias here is not a second
// implementation — dispatch still resolves it through COMMISSAIRE_ALIASES to one handler.
function buildCommissaireSubcommands() {
  const subs = {};
  for (const [canonical, required] of Object.entries(REQUIRED_FLAGS_BY_CANONICAL)) {
    subs[canonical] = { required_flags: required };
  }
  for (const [alias, canonical] of Object.entries(COMMISSAIRE_ALIASES)) {
    subs[alias] = { required_flags: REQUIRED_FLAGS_BY_CANONICAL[canonical] };
  }
  return subs;
}
const COMMISSAIRE_SURFACE = {
  kind: "subcommand_dispatch",
  spec: COMMISSAIRE_SPEC,
  subcommands: buildCommissaireSubcommands(),
};

// In-memory selftest: the split-key cores (delegated to producer-auth) + the facade's own pure
// cores (evaluateDecisionRequest legs, chokepointPermit) + a full mkdtemp round trip through the
// CLI verbs (admit → declare → request-decision → reconcile), asserting the chain verifies and
// the split-key custody holds.
function commissaireSelftest() {
  let failed = 0;
  const fail = (m) => { process.stderr.write(`commissaire selftest FAIL: ${m}\n`); failed++; };

  if (producerAuthSelftest() !== 0) fail("producer-auth cores");

  // --- pure evaluateDecisionRequest legs ---
  const admission = { status: "admitted", admitted_scope: ["merge"], contract_revision: "r1" };
  const key = deriveKey("m", "P1", "r1");
  const mkReq = (extra) => {
    const rec = { schema: 3, author: "producer", producer_id: "P1", contract_revision: "r1", seq: 1,
      kind_of_entry: "effect-decision-request", issue: "FAFF-1", step: "merge",
      payload: { effect: { kind: "merge", target: "main", reversible: true }, ...extra } };
    rec.producer_hmac = signRecord(rec, key);
    return rec;
  };
  const declareEntry = { kind_of_entry: "declare", issue: "FAFF-1", step: "merge", effect: { kind: "merge", target: "main", reversible: true }, seq: 0 };
  // grant on the clean covered path
  if (evaluateDecisionRequest(admission, mkReq(), key, [declareEntry]).verdict !== "grant") fail("clean covered request grants");
  // not admitted
  if (evaluateDecisionRequest({ status: "revoked", admitted_scope: ["merge"] }, mkReq(), key, [declareEntry]).reason !== "producer-not-admitted") fail("revoked → producer-not-admitted");
  // bad HMAC → producer-auth-failed
  const tampered = mkReq(); tampered.seq = 99;
  if (evaluateDecisionRequest(admission, tampered, key, [declareEntry]).reason !== "producer-auth-failed") fail("tampered request → producer-auth-failed");
  // out of scope
  const deployReq = mkReq(); deployReq.payload.effect = { kind: "deploy", target: "prod", reversible: true }; deployReq.producer_hmac = signRecord(deployReq, key);
  if (evaluateDecisionRequest(admission, deployReq, key, [declareEntry]).reason !== "effect-out-of-scope") fail("out-of-scope kind → effect-out-of-scope");
  // not declared → effect-not-declared
  if (evaluateDecisionRequest(admission, mkReq(), key, []).reason !== "effect-not-declared") fail("uncovered effect → effect-not-declared");
  // stale evidence
  const staleLedger = [declareEntry, { kind_of_entry: "observe", issue: "FAFF-1", step: "merge", seq: 5, effect: { kind: "merge", target: "main" } }];
  if (evaluateDecisionRequest(admission, mkReq({ evidence_seq: 0 }), key, staleLedger).reason !== "stale-evidence") fail("evidence older than latest observe → stale-evidence");
  // assurance floor: a declare record presented as a request
  const declareAsReq = { schema: 3, author: "producer", producer_id: "P1", kind_of_entry: "declare", issue: "FAFF-1", step: "merge", seq: 1, effect: { kind: "merge", target: "main" } };
  if (evaluateDecisionRequest(admission, declareAsReq, key, [declareEntry]).reason !== "assurance-floor") fail("J-D declare presented as request → assurance-floor");

  // --- chokepointPermit ---
  const gov = mintGovernorKeypair();
  const effect = { kind: "merge", target: "main", reversible: true };
  const grant = { author: "commissaire", payload: { verdict: "grant", effect } };
  grant.commissaire_sig = signDecision(grant, gov.sk);
  const cp = chokepointPermit(effect, grant, gov.pk, gov.pk_fingerprint);
  if (!cp.permit) fail("chokepoint permits a genuine covering grant");
  // forged (producer HMAC) → refuse
  const forged = { author: "commissaire", payload: { verdict: "grant", effect } };
  forged.commissaire_sig = signRecord(forged, key);
  if (chokepointPermit(effect, forged, gov.pk, gov.pk_fingerprint).permit) fail("chokepoint refuses a producer-HMAC'd forged grant");
  // producer-authored verdict → refuse
  if (chokepointPermit(effect, { author: "producer", payload: { verdict: "grant", effect }, commissaire_sig: "x" }, gov.pk).permit) fail("chokepoint refuses a producer-authored verdict");
  // fingerprint mismatch → refuse
  if (chokepointPermit(effect, grant, gov.pk, "0".repeat(64)).permit) fail("chokepoint refuses on a fingerprint pin mismatch");
  // deny verdict → refuse
  const deny = { author: "commissaire", payload: { verdict: "deny", effect } }; deny.commissaire_sig = signDecision(deny, gov.sk);
  if (chokepointPermit(effect, deny, gov.pk, gov.pk_fingerprint).permit) fail("chokepoint refuses a deny verdict");

  // --- full CLI round trip under BOTH spellings (flat + object-verb) ---
  // The chain admit → declare → request-decision → reconcile is run once with the flat verbs and
  // once with the object-verb forms; both must exit and verdict-match identically, proving each
  // alias resolves to the same handler as its object-verb form (ADR-0123, FAFF-980).
  const spellings = {
    flat: { admit: ["admit"], declare: ["declare"], authorize: ["request-decision"], reconcile: ["reconcile"] },
    "object-verb": { admit: ["contract", "admit"], declare: ["effect", "declare"], authorize: ["effect", "authorize"], reconcile: ["effect", "reconcile"] },
  };
  for (const [label, tok] of Object.entries(spellings)) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-commissaire-"));
    try {
      const runDir = path.join(tmp, ".faff", "runs", "RUN-C1");
      fs.mkdirSync(runDir, { recursive: true });
      const run = (a, input) => spawnSync(process.execPath, [ENTRYPOINT, "commissaire", ...a], { encoding: "utf8", input: input ?? "" });
      let r = run([...tok.admit, "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
      if (r.status !== 0) fail(`[${label}] admit exited ${r.status}: ${r.stderr}`);
      r = run([...tok.declare, "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
      if (r.status !== 0) fail(`[${label}] declare exited ${r.status}: ${r.stderr}`);
      r = run([...tok.authorize, "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
      if (r.status !== 0) fail(`[${label}] request-decision exited ${r.status}: ${r.stderr}`);
      let verdict = null; try { verdict = JSON.parse(r.stdout.trim()); } catch { /* */ }
      if (!verdict || verdict.verdict !== "grant") fail(`[${label}] request-decision granted on the covered path (got ${r.stdout.trim()})`);
      // the ledger chain verifies
      if (verifyEffectsChain(runDir, {}).status !== "verified") fail(`[${label}] the schema:3 ledger verifies`);
      // the auth leg passes over the whole run
      if (!verifyAuthLeg(runDir).pass) fail(`[${label}] the auth leg passes on a clean run (${JSON.stringify(verifyAuthLeg(runDir).failures)})`);
      // split-key custody: the governor file holds SK + master, never a producer key; the producer
      // file holds K_producer, never SK/master.
      const govJson = readJson(governorFileOf(governorDirOf(runDir)));
      const prodJson = readJson(producerFileOf(producerDirOf(runDir), "P1"));
      if (!govJson.sk || !govJson.master_secret) fail(`[${label}] governor file holds SK + master`);
      if (govJson.key_hex) fail(`[${label}] governor file must NOT hold a producer key`);
      if (!prodJson.key_hex) fail(`[${label}] producer file holds K_producer`);
      if (prodJson.sk || prodJson.master_secret) fail(`[${label}] producer file must NOT hold SK or master`);
      // reconcile reports no escape on the fully-declared/observed-free run
      r = run([...tok.reconcile, "--run-dir", runDir, "--issue", "FAFF-1"]);
      if (r.status !== 0) fail(`[${label}] reconcile exited ${r.status}`);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  if (failed) return 1;
  console.log("commissaire selftest: ok");
  return 0;
}

module.exports = {
  KIND_AUTHOR, DECISION_VERDICTS, LEDGER_CFG, COMMISSAIRE_SPEC, COMMISSAIRE_SURFACE,
  OBJECT_TOKENS, COMMISSAIRE_DISPATCH, COMMISSAIRE_ALIASES, REQUIRED_FLAGS_BY_CANONICAL, resolveCommissaireKey,
  buildEnvelope, appendProducerRecords, appendCommissaireRecord,
  evaluateDecisionRequest, chokepointPermit, verifyAuthLeg, hasGovernanceContext,
  readLedgerEntries, governorDirOf, producerDirOf, governorFileOf, producerFileOf, pkFileOf,
  cmdCommissaire, commissaireSelftest,
};
