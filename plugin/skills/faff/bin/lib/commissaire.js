// ===========================================================================
// === region:factory — commissaire — FAFF-828: the external Commissaire facade (schema:3 governed records, verb-3 protected-effect decisions) ===
//
// The minimal external governance facade a SECOND producer (not faff's own runner)
// drives to produce authenticated governed facts, request a Commissaire-signed
// protected-effect decision, reconcile observed-minus-declared, and — via boundary
// stubs — request a terminal verdict and a sealed bundle. Verb 3 (request-decision)
// is built to depth; verbs 5/6 delegate to existing anchor/bundle handlers.
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
const { appendRecordsUnderLock, verifyEffectsChain, sha256Hex } = require("./events");
const { effectDescriptorViolations, normEffect, effectTargetMatches, computeEscapes } = require("./effects");
const { ENTRYPOINT } = require("./shared-infra");

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
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim() !== "")
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
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
function appendProducerRecords(runDir, key, producerId, contractRevision, bodies, ts) {
  const runId = path.basename(runDir);
  return appendRecordsUnderLock(runDir, LEDGER_CFG, bodies.length, (index, seq, _prev, prevHash) => {
    const rec = buildEnvelope(runId, seq, prevHash, "producer", producerId, contractRevision, bodies[index], ts);
    rec.producer_hmac = signRecord(rec, key);
    return rec;
  });
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
  const pk = pkRec ? pkRec.pk : (gov ? gov.pk : null);
  const failures = [];
  const unverifiable = [];
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

// --- CLI shell --------------------------------------------------------------------------

function usage() {
  process.stderr.write(
    "usage: faff commissaire <admit|declare|request-decision|observe|reconcile|terminal-verdict|seal-bundle> ...\n" +
    "  admit            --run-dir DIR --producer ID --contract-revision R [--scope kind,kind] [--governor-dir D] [--producer-dir D]\n" +
    "  declare          --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])\n" +
    "  request-decision --run-dir DIR --producer ID --issue I --step S   (stdin: {effect, evidence_seq?})\n" +
    "  observe          --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])\n" +
    "  reconcile        --run-dir DIR --producer ID --issue I\n" +
    "  terminal-verdict --run-dir DIR --issue I   (boundary stub over `faff events anchor`)\n" +
    "  seal-bundle      --run-dir DIR             (boundary stub over `faff bundle`)\n");
}

function parseCommissaireArgs(args) {
  const flags = {};
  const rest = [];
  const single = new Set(["--run-dir", "--run", "--producer", "--contract-revision", "--scope", "--issue", "--step", "--governor-dir", "--producer-dir", "--ts"]);
  for (let i = 0; i < args.length; i++) {
    if (single.has(args[i])) flags[args[i]] = args[++i];
    else if (args[i] === "--json") flags["--json"] = true;
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
  const [requestRecord] = appendProducerRecords(runDir, loaded.key, producerId, contractRevision, [requestBody], flags["--ts"]);
  // Commissaire half: re-derive the key from master, authenticate, evaluate, sign the verdict.
  const key = deriveKey(gov.master_secret, producerId, contractRevision);
  const decision = evaluateDecisionRequest(loaded.admission, requestRecord, key, readLedgerEntries(runDir));
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

// Verbs 5/6 — boundary stubs that delegate to the existing anchor/bundle handlers via a child
// spawn of this same bin (a process boundary, invisible to the region lint by design). Built
// only at the facade boundary this slice; NOT to depth (ADR-0122 scopes Phase 2A to verb 3).
function cmdBoundaryStub(flags, verb, childArgs) {
  const runDir = requireRunDir(flags, verb);
  if (!runDir) return 3;
  const r = spawnSync(process.execPath, [ENTRYPOINT, ...childArgs], { encoding: "utf8", stdio: "inherit" });
  if (r.status === 0) return 0;
  process.stderr.write(`faff commissaire ${verb}: boundary stub delegated to \`faff ${childArgs.join(" ")}\` (exit ${r.status === null ? "error" : r.status})\n`);
  return r.status === null ? 1 : r.status;
}

function cmdCommissaire(args) {
  if (args.includes("--selftest")) return commissaireSelftest();
  const { flags, rest } = parseCommissaireArgs(args);
  const verb = rest[0];
  switch (verb) {
    case "admit": return cmdAdmit(flags);
    case "declare": return cmdProducerLedger(flags, "declare", "declare");
    case "observe": return cmdProducerLedger(flags, "observe", "observe");
    case "request-decision": return cmdRequestDecision(flags);
    case "reconcile": return cmdReconcile(flags);
    case "terminal-verdict": {
      const runDir = flags["--run-dir"], issue = flags["--issue"];
      if (!runDir || !issue) { process.stderr.write("faff commissaire terminal-verdict: --run-dir and --issue are required\n"); return 2; }
      return cmdBoundaryStub(flags, "terminal-verdict", ["events", "anchor", "--run-dir", runDir, "--issue", issue]);
    }
    case "seal-bundle": {
      const runDir = flags["--run-dir"];
      if (!runDir) { process.stderr.write("faff commissaire seal-bundle: --run-dir is required\n"); return 2; }
      return cmdBoundaryStub(flags, "seal-bundle", ["bundle", "publish", "--run-dir", runDir, "--boundary-kind", "run-close", "--boundary-key", path.basename(runDir)]);
    }
    default:
      usage();
      return 2;
  }
}

// The CLI surface grammar (cli-surface.js DISPATCH_SURFACES entry).
const COMMISSAIRE_SPEC = { flags: {
  "--run-dir": { arity: 1 }, "--run": { arity: 1 }, "--producer": { arity: 1 }, "--contract-revision": { arity: 1 },
  "--scope": { arity: 1 }, "--issue": { arity: 1 }, "--step": { arity: 1 }, "--governor-dir": { arity: 1 },
  "--producer-dir": { arity: 1 }, "--ts": { arity: 1 }, "--json": { arity: 0 }, "--selftest": { arity: 0 },
} };
const COMMISSAIRE_SURFACE = {
  kind: "subcommand_dispatch",
  spec: COMMISSAIRE_SPEC,
  subcommands: {
    admit: { required_flags: ["--producer", "--contract-revision"] },
    declare: { required_flags: ["--producer", "--issue", "--step"] },
    "request-decision": { required_flags: ["--producer", "--issue", "--step"] },
    observe: { required_flags: ["--producer", "--issue", "--step"] },
    reconcile: { required_flags: ["--producer", "--issue"] },
    "terminal-verdict": { required_flags: ["--issue"] },
    "seal-bundle": { required_flags: [] },
  },
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

  // --- full CLI round trip (admit → declare → request-decision → reconcile) ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-commissaire-"));
  try {
    const runDir = path.join(tmp, ".faff", "runs", "RUN-C1");
    fs.mkdirSync(runDir, { recursive: true });
    const run = (a, input) => spawnSync(process.execPath, [ENTRYPOINT, "commissaire", ...a], { encoding: "utf8", input: input ?? "" });
    let r = run(["admit", "--run-dir", runDir, "--producer", "P1", "--contract-revision", "r1", "--scope", "merge"]);
    if (r.status !== 0) fail(`admit exited ${r.status}: ${r.stderr}`);
    r = run(["declare", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify([{ kind: "merge", target: "main" }]));
    if (r.status !== 0) fail(`declare exited ${r.status}: ${r.stderr}`);
    r = run(["request-decision", "--run-dir", runDir, "--producer", "P1", "--issue", "FAFF-1", "--step", "merge"], JSON.stringify({ effect: { kind: "merge", target: "main" } }));
    if (r.status !== 0) fail(`request-decision exited ${r.status}: ${r.stderr}`);
    let verdict = null; try { verdict = JSON.parse(r.stdout.trim()); } catch { /* */ }
    if (!verdict || verdict.verdict !== "grant") fail(`request-decision granted on the covered path (got ${r.stdout.trim()})`);
    // the ledger chain verifies
    if (verifyEffectsChain(runDir, {}).status !== "verified") fail("the schema:3 ledger verifies");
    // the auth leg passes over the whole run
    if (!verifyAuthLeg(runDir).pass) fail(`the auth leg passes on a clean run (${JSON.stringify(verifyAuthLeg(runDir).failures)})`);
    // split-key custody: the governor file holds SK + master, never a producer key; the producer
    // file holds K_producer, never SK/master.
    const govJson = readJson(governorFileOf(governorDirOf(runDir)));
    const prodJson = readJson(producerFileOf(producerDirOf(runDir), "P1"));
    if (!govJson.sk || !govJson.master_secret) fail("governor file holds SK + master");
    if (govJson.key_hex) fail("governor file must NOT hold a producer key");
    if (!prodJson.key_hex) fail("producer file holds K_producer");
    if (prodJson.sk || prodJson.master_secret) fail("producer file must NOT hold SK or master");
    // reconcile reports no escape on the fully-declared/observed-free run
    r = run(["reconcile", "--run-dir", runDir, "--issue", "FAFF-1"]);
    if (r.status !== 0) fail(`reconcile exited ${r.status}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  if (failed) return 1;
  console.log("commissaire selftest: ok");
  return 0;
}

module.exports = {
  KIND_AUTHOR, DECISION_VERDICTS, LEDGER_CFG, COMMISSAIRE_SPEC, COMMISSAIRE_SURFACE,
  buildEnvelope, appendProducerRecords, appendCommissaireRecord,
  evaluateDecisionRequest, chokepointPermit, verifyAuthLeg, hasGovernanceContext,
  readLedgerEntries, governorDirOf, producerDirOf, governorFileOf, producerFileOf, pkFileOf,
  cmdCommissaire, commissaireSelftest,
};
