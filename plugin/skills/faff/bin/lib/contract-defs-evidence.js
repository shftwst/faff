// ===========================================================================
// === region:factory — contract-defs-evidence — contract definitions: holdout verdict, lane boundary, custody verdict, bundle verdict, recovery disposition, scenario record and the holdout DoD map ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { schemaCheck } = require("./contract-engine");
const { HOLDOUT_REASON_CODES, delegationViolations, deriveHoldoutAggregate } = require("./holdout-record");   // FAFF-1291: factory -> governance is the legal direction


// --- holdout-verdict (FAFF-34) ---
// The code-blind holdout verdict the `evaluator` slot producer (default faffter-noon-evaluate) emits after
// exercising a built feature against its spec's DoD in a provisioned env. Validates SHAPE + the cross-field
// consistency rules, never the exercise strategy (which lives in the producer). PURE: a function over the
// verdict object, no I/O. Fail-loud ONLY on a non-object (no safe coerce target — faff's own producer emits
// it). The enums for aggregate/class/verdict are enforced via violations (the env-handle precedent), so an
// echoed bad value is exit 1, not a spurious schemaCheck fail-loud (exit 2). The fail-safe coercion target
// for a bad aggregate is `needs-human` — NEVER `meets-spec` (mirrors review-verdict). The load-bearing gates
// (exit 0 only when ALL hold): code_blind===true (a non-blind verdict is structurally inadmissible — ADR-0032);
// a `prose` criterion is never machine-judged (verdict MUST be needs-human — ADR-0029); a met/unmet criterion
// MUST carry evidence; and the aggregate MUST match the derivation from the criteria (no hand-waved meets-spec).
const HOLDOUT_AGGREGATES = ["meets-spec", "gaps", "fails", "needs-human"];
const HOLDOUT_CLASSES = ["scenario", "assertion", "prose"];
const HOLDOUT_VERDICTS = ["met", "unmet", "needs-human"];

// FAFF-384: shape-validate the spawner `attestation` record (present iff spawner_attested:true). The
// withheld-set is the BASIS code_blind is derived from, so `repo` MUST be provably withheld and the in-cage
// preflight MUST have passed for an attested-blind verdict to mean anything. Returns the normalised record
// (pushing any shape violation), or null on a non-object. PURE.
function validateSpawnerAttestation(att, violations) {
  if (att === null || typeof att !== "object" || Array.isArray(att)) {
    violations.push("spawner_attested is true but attestation is missing or not an object");
    return null;
  }
  const spawner = typeof att.spawner === "string" && att.spawner.trim() ? att.spawner : "";
  if (!spawner) violations.push("attestation.spawner is missing or not a non-empty string");
  const w = (att.withheld && typeof att.withheld === "object" && !Array.isArray(att.withheld)) ? att.withheld : null;
  if (!w) violations.push("attestation.withheld is missing or not an object");
  const withheld = { repo: !!(w && w.repo === true), worktree_cwd: !!(w && w.worktree_cwd === true), diff: !!(w && w.diff === true) };
  if (!withheld.repo) violations.push("attestation.withheld.repo is not true — the codebase was not provably withheld, so the blindness is not spawner-derived");
  const preflight = typeof att.preflight === "string" ? att.preflight : "";
  if (preflight !== "pass") violations.push(`attestation.preflight ${JSON.stringify(att.preflight)} is not "pass" — the in-cage preflight did not confirm the boundary`);
  return { spawner, withheld, preflight };
}

// `opts.requireSpawnerAttested` (default false) is CALLER-RESOLVED from the run's lane-boundary cage promise;
// the validator itself stays PURE — it never reads the intent artifact off disk (that is the caller's job at
// the dispatch boundary). Threading an optional 2nd arg keeps every existing 1-arg caller byte-for-byte.
function computeHoldoutVerdict(extraction, opts = {}) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];

  // code_blind — the by-construction attestation; MUST be exactly true to gate-pass.
  const code_blind = extraction.code_blind === true;
  if (extraction.code_blind !== true) violations.push("code_blind is not true — a non-blind verdict is structurally inadmissible");

  const rawCriteria = Array.isArray(extraction.criteria) ? extraction.criteria : [];
  if (!Array.isArray(extraction.criteria)) violations.push("criteria is missing or not an array");
  // FAFF-1291: the delegation rules run on the RAW block, before the contractData mapping drops `id`.
  violations.push(...delegationViolations(extraction));
  const criteria = rawCriteria.map((c, i) => {
    const obj = c && typeof c === "object" && !Array.isArray(c) ? c : {};
    const klass = HOLDOUT_CLASSES.includes(obj.class) ? obj.class : "";
    if (!HOLDOUT_CLASSES.includes(obj.class)) violations.push(`criteria[${i}].class ${JSON.stringify(obj.class)} not in {scenario,assertion,prose}`);
    const verdict = HOLDOUT_VERDICTS.includes(obj.verdict) ? obj.verdict : "";
    if (!HOLDOUT_VERDICTS.includes(obj.verdict)) violations.push(`criteria[${i}].verdict ${JSON.stringify(obj.verdict)} not in {met,unmet,needs-human}`);
    const evidence_present = obj.evidence_present === true;
    if (klass === "prose" && obj.verdict !== "needs-human") violations.push(`criteria[${i}] is prose but verdict is ${JSON.stringify(obj.verdict)} — prose must be needs-human (ADR-0029)`);
    if ((obj.verdict === "met" || obj.verdict === "unmet") && !evidence_present) violations.push(`criteria[${i}] verdict ${obj.verdict} has no evidence (evidence_present false)`);
    const mapped = { class: klass, verdict, evidence_present };
    // FAFF-1292: reason_code is additive — it rides into contractData ONLY when the input carries one
    // (the delegated/spawner_attested precedent). The CONTRACT layer is TOLERANT of an ABSENT code on a
    // needs-human criterion so a pre-change cross-run record re-validates as the needs-human it always
    // carried (the writer is the strict half). A PRESENT code is still rule-checked.
    const hasReasonCode = Object.prototype.hasOwnProperty.call(obj, "reason_code") && obj.reason_code !== null && obj.reason_code !== undefined;
    if (hasReasonCode) {
      const rc = obj.reason_code;
      mapped.reason_code = rc;
      if (!HOLDOUT_REASON_CODES.includes(rc)) violations.push(`criteria[${i}].reason_code ${JSON.stringify(rc)} not in {${HOLDOUT_REASON_CODES.join(",")}}`);
      if (obj.verdict === "met" || obj.verdict === "unmet") violations.push(`criteria[${i}] verdict ${obj.verdict} carries a reason_code — a judged criterion has no "why unjudged"`);
      if (klass === "prose" && rc !== "human-only") violations.push(`criteria[${i}] is prose but reason_code is ${JSON.stringify(rc)} — prose must be human-only`);
      if ((klass === "scenario" || klass === "assertion") && obj.verdict === "needs-human" && rc === "human-only") violations.push(`criteria[${i}] is born-verifiable (${klass}) but reason_code is human-only — a born-verifiable criterion is never human-only`);
    }
    return mapped;
  });

  // aggregate — an out-of-enum echoed value coerces to needs-human (NEVER meets-spec).
  let aggregate = extraction.aggregate;
  if (!HOLDOUT_AGGREGATES.includes(aggregate)) {
    violations.push(`aggregate ${JSON.stringify(aggregate)} not in {meets-spec,gaps,fails,needs-human} — coerced to needs-human`);
    aggregate = "needs-human";
  }
  // Consistency: the declared aggregate must match the derivation from the criteria. Only checkable when
  // every verdict is well-formed (an out-of-enum verdict already pushed its own violation above).
  if (criteria.every((c) => HOLDOUT_VERDICTS.includes(c.verdict))) {
    const expected = deriveHoldoutAggregate(criteria.map((c) => c.verdict));
    if (aggregate !== expected) violations.push(`aggregate is "${aggregate}" but criteria derive "${expected}"`);
  }

  // Surface any producer-declared violations (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }

  // FAFF-384: spawner attestation (ADDITIVE, the rung-2 second slice). The two fields appear in contractData
  // ONLY when the input carries `spawner_attested`, so a legacy (uncaged) verdict validates byte-for-byte with
  // the ratchet OFF — the additive-only invariant. `spawner_attested:true` sets code_blind from what the
  // spawner PROVABLY withheld (not the judged party's self-claim); a claimed attestation is shape-checked. The
  // ratchet (opts.requireSpawnerAttested, caller-resolved from the cage promise) makes a self-attested verdict
  // a violation — the lying-evaluator hole. A non-boolean spawner_attested is itself a violation.
  const hasSpawnerField = Object.prototype.hasOwnProperty.call(extraction, "spawner_attested");
  const spawner_attested = extraction.spawner_attested === true;
  let attestation = null;
  if (hasSpawnerField) {
    if (spawner_attested) attestation = validateSpawnerAttestation(extraction.attestation, violations);
    else if (extraction.spawner_attested !== false) violations.push(`spawner_attested ${JSON.stringify(extraction.spawner_attested)} is not a boolean`);
  }
  if (opts && opts.requireSpawnerAttested && !spawner_attested) {
    violations.push("spawner attestation required (the run's lane-boundary intent promised an evaluator cage) but the verdict is not spawner-attested — a self-attested code_blind is inadmissible");
  }

  const contractData = { aggregate, code_blind, criteria, violations };
  if (hasSpawnerField) {
    contractData.spawner_attested = spawner_attested;
    if (attestation) contractData.attestation = attestation;
  }
  // FAFF-1291: `delegated` rides along only when the input carries an array (the spawner_attested precedent).
  // Rows are normalised to the schema's types; any shape or pairing fault is already a violation above.
  if (Array.isArray(extraction.delegated)) {
    contractData.delegated = extraction.delegated.map((r) => {
      const o = r && typeof r === "object" && !Array.isArray(r) ? r : {};
      return { id: typeof o.id === "string" ? o.id : "", text: typeof o.text === "string" ? o.text : "", holdout: o.holdout === true, verification_tier: typeof o.verification_tier === "string" ? o.verification_tier : "", verifier: typeof o.verifier === "string" ? o.verifier : "", ac_id: typeof o.ac_id === "string" ? o.ac_id : null };
    });
  }
  return { contractData, failLoud: null };
}

function contractHoldoutVerdict(extraction, opts = {}) {
  const { contractData, failLoud } = computeHoldoutVerdict(extraction, opts);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "holdout-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- lane-boundary (FAFF-276) ---
// The versioned lane-boundary intent the orchestrator authors (intent-out) declaring what physical
// boundary a lane needs — the assert-in counterpart is `faff evaluator-preflight`. A DECLARATION of
// intent, NEVER a trust source: the preflight's refuse decision rests on a physical fsq probe, never on
// this artifact's claim. Validates SHAPE + enums, never the boundary's truth. PURE: a function over the
// intent object, no I/O. Fail-loud ONLY on a non-object input (the structural-malformation case). The
// enums for lane/container/accesses.* and the version>=1 constraint are enforced via violations (the
// env-handle/holdout-verdict precedent), so an echoed out-of-enum value is exit 1, NOT a spurious
// schemaCheck fail-loud (exit 2) — this is what the spec-review note directed (route out-of-enum to
// violations like env-handle/holdout-verdict, reserving fail-loud for structural malformation).
// host_socket + integrity_signal are carried from v1 but NOT asserted by this slice's preflight
// (declaration-only until FAFF-333 / FAFF-325 wire their assertions).
// FAFF-859: a second, ORTHOGONAL axis — `host: local | remote` — the LOCALITY of the lane
// (where it runs), a top-level sibling of `container` (containment), never nested under accesses.
// The two axes are independent: a lane can be own-container-local or own-container-remote.
// `host` obeys the SAME routing as every other enum — an out-of-enum value lands in `violations`
// (exit 1), NEVER fail-loud (which stays reserved for a non-object extraction); routing it to
// fail-loud would make a present-but-invalid promise THROW instead of ARM, breaking the
// merge-gate fail-safe (laneBoundaryPromisesCage). `host: remote` is declaration-only this slice
// (no physical remote-observation seam yet — FAFF-817's transport slot supplies it later).
const LANE_BOUNDARY_LANES = ["evaluator", "build"];
const LANE_BOUNDARY_CONTAINERS = ["shared", "own"];
const LANE_BOUNDARY_HOST = ["local", "remote"];
const LANE_BOUNDARY_ACCESS = ["absent", "present"];
function computeLaneBoundary(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  let version = extraction.version;
  if (!Number.isInteger(version) || version < 1) {
    violations.push(`version ${JSON.stringify(version)} is not an integer >= 1`);
    version = Number.isInteger(version) ? version : 0;
  }
  const lane = typeof extraction.lane === "string" ? extraction.lane : "";
  if (!LANE_BOUNDARY_LANES.includes(extraction.lane)) {
    violations.push(`lane ${JSON.stringify(extraction.lane)} not in {${LANE_BOUNDARY_LANES.join(",")}}`);
  }
  const container = typeof extraction.container === "string" ? extraction.container : "";
  if (!LANE_BOUNDARY_CONTAINERS.includes(extraction.container)) {
    violations.push(`container ${JSON.stringify(extraction.container)} not in {${LANE_BOUNDARY_CONTAINERS.join(",")}}`);
  }
  // FAFF-859: the locality axis, a top-level sibling of container. Same violations routing as
  // container (never fail-loud) — an echoed out-of-enum host is exit 1, not a spurious exit 2.
  const host = typeof extraction.host === "string" ? extraction.host : "";
  if (!LANE_BOUNDARY_HOST.includes(extraction.host)) {
    violations.push(`host ${JSON.stringify(extraction.host)} not in {${LANE_BOUNDARY_HOST.join(",")}}`);
  }
  const acc = (extraction.accesses && typeof extraction.accesses === "object" && !Array.isArray(extraction.accesses)) ? extraction.accesses : null;
  if (!acc) violations.push("accesses is missing or not an object");
  const repo = acc && typeof acc.repo === "string" ? acc.repo : "";
  if (!acc || !LANE_BOUNDARY_ACCESS.includes(acc.repo)) {
    violations.push(`accesses.repo ${JSON.stringify(acc ? acc.repo : undefined)} not in {${LANE_BOUNDARY_ACCESS.join(",")}}`);
  }
  const host_socket = acc && typeof acc.host_socket === "string" ? acc.host_socket : "";
  if (!acc || !LANE_BOUNDARY_ACCESS.includes(acc.host_socket)) {
    violations.push(`accesses.host_socket ${JSON.stringify(acc ? acc.host_socket : undefined)} not in {${LANE_BOUNDARY_ACCESS.join(",")}}`);
  }
  const integrity_signal = extraction.integrity_signal === true;
  if (typeof extraction.integrity_signal !== "boolean") {
    violations.push(`integrity_signal ${JSON.stringify(extraction.integrity_signal)} is not a boolean`);
  }
  // Surface any producer-declared violations (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }
  return { contractData: { version, lane, container, host, accesses: { repo, host_socket }, integrity_signal, violations }, failLoud: null };
}

function contractLaneBoundary(extraction) {
  const { contractData, failLoud } = computeLaneBoundary(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "lane-boundary");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- custody verdict (FAFF-784) ---
// The verification result `integrity-digest verify --record-result` atomically writes OUTSIDE the
// manifest it just verified, at the canonical per-issue path `<run-dir>/<issue>/custody-verdict.json`,
// and the pure gate `faff merge-gate` binds a dispatched merge to. Structural trust, not authorship
// (ADR the spec cites): the digest establishes byte continuity from verify-and-record to merge-gate,
// never a same-uid process-identity claim — so this record NEVER carries an author/actor/signer field,
// enforced below both by an explicit allow-list of keys and (belt-and-braces) the JSON schema's
// additionalProperties:false. `computeCustodyVerdict` is the PURE shape/enum validator (the
// review-verdict/lane-boundary precedent: fail-loud only on a non-object extraction; every other
// malformation is a violation, never a thrown error) — it never touches fs or a digest. Digest/identity
// binding (which DOES need caller-supplied bytes + an externally-held expected sha256) lives in the two
// functions below it, still fs-free and child-process-free: the shell (merge-gate.js) reads the file
// and hashes it via integrity-digest.js's ONE hasher, then hands the raw string + the computed digest
// in here — this stays a pure comparison over caller-supplied values, never a second hashing seam.
const CUSTODY_CLASSIFICATIONS = ["clean", "tamper", "verification-unavailable"];
const CUSTODY_MERGE_STATES = ["pre-merge", "post-merge"];
const CUSTODY_VERDICT_SCHEMA_VERSION = 1;
const CUSTODY_DETAIL_MAX = 4000; // CONSTRAINT: detail is bounded (spec) — generous enough for a diffAgainstManifest path list, never unbounded.
const CUSTODY_VERDICT_FIELDS = ["schema_version", "run_id", "issue", "classification", "paths", "detail", "verified_at", "merge_state_at_verification"];

function computeCustodyVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  // No authorship/actor field, ever (CONSTRAINT) — an unexpected key (author, actor, signer, writer, …)
  // is a shape violation here, defence-in-depth ahead of the JSON schema's additionalProperties:false.
  for (const k of Object.keys(extraction)) {
    if (!CUSTODY_VERDICT_FIELDS.includes(k)) violations.push(`unexpected field ${JSON.stringify(k)} (no authorship/actor field is ever admitted)`);
  }
  const schema_version = extraction.schema_version;
  if (schema_version !== CUSTODY_VERDICT_SCHEMA_VERSION) violations.push(`schema_version ${JSON.stringify(schema_version)} !== ${CUSTODY_VERDICT_SCHEMA_VERSION}`);
  const run_id = (typeof extraction.run_id === "string" && extraction.run_id) ? extraction.run_id : "";
  if (!run_id) violations.push("run_id is missing or not a non-empty string");
  const issue = (typeof extraction.issue === "string" && extraction.issue) ? extraction.issue : "";
  if (!issue) violations.push("issue is missing or not a non-empty string");
  const classification = extraction.classification;
  if (!CUSTODY_CLASSIFICATIONS.includes(classification)) violations.push(`classification ${JSON.stringify(classification)} not in {${CUSTODY_CLASSIFICATIONS.join(",")}}`);
  const rawPaths = extraction.paths;
  const pathsShapeOk = Array.isArray(rawPaths) && rawPaths.every((p) => typeof p === "string");
  if (!pathsShapeOk) violations.push("paths must be an array of strings");
  const paths = pathsShapeOk ? rawPaths : [];
  // CONSTRAINT classification == tamper IMPLIES paths is non-empty; != tamper IMPLIES paths is empty.
  if (classification === "tamper" && paths.length === 0) violations.push("classification is tamper but paths is empty");
  if (classification !== "tamper" && paths.length > 0) violations.push("classification is not tamper but paths is non-empty");
  const detail = typeof extraction.detail === "string" ? extraction.detail : "";
  if (typeof extraction.detail !== "string") violations.push("detail must be a string");
  else if (detail.length > CUSTODY_DETAIL_MAX) violations.push(`detail exceeds the ${CUSTODY_DETAIL_MAX}-char bound`);
  const verified_at = extraction.verified_at;
  if (typeof verified_at !== "string" || Number.isNaN(Date.parse(verified_at))) violations.push("verified_at must be an ISO-8601 timestamp string");
  const merge_state_at_verification = extraction.merge_state_at_verification;
  if (!CUSTODY_MERGE_STATES.includes(merge_state_at_verification)) violations.push(`merge_state_at_verification ${JSON.stringify(merge_state_at_verification)} not in {${CUSTODY_MERGE_STATES.join(",")}}`);
  return {
    contractData: { schema_version, run_id, issue, classification, paths, detail, verified_at, merge_state_at_verification, violations },
    failLoud: null,
  };
}

// PURE classification of a custody-verdict file's raw bytes (string, or non-string when
// absent/unreadable — the shell degrades a failed fs.readFileSync to null/undefined before calling
// this, never throws through). `expectedRunId`/`expectedIssue` are optional (disposition.js's
// per-run/per-issue scan always supplies them; a bare classification probe may omit them). Returns
// one of: absent | malformed | identity-mismatch | clean | tamper | verification-unavailable — the
// exact vocabulary `faff disposition` needs (malformed-present/identity-mismatch are disposition's own
// labels, folded from `malformed`/`identity-mismatch` by its shell — see disposition.js).
function classifyCustodyVerdictBytes(raw, { expectedRunId, expectedIssue } = {}) {
  if (typeof raw !== "string") return { classification: "absent" };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { classification: "malformed", violations: ["not valid JSON"] }; }
  const { contractData, failLoud } = computeCustodyVerdict(parsed);
  if (failLoud || !contractData) return { classification: "malformed", violations: [failLoud || "extraction must be a JSON object"] };
  if (contractData.violations.length > 0) return { classification: "malformed", violations: contractData.violations };
  if (expectedRunId !== undefined && contractData.run_id !== expectedRunId) return { classification: "identity-mismatch", detail: `run_id ${JSON.stringify(contractData.run_id)} !== expected ${JSON.stringify(expectedRunId)}` };
  if (expectedIssue !== undefined && contractData.issue !== expectedIssue) return { classification: "identity-mismatch", detail: `issue ${JSON.stringify(contractData.issue)} !== expected ${JSON.stringify(expectedIssue)}` };
  return { classification: contractData.classification, contractData };
}

// PURE admission gate: exact valid clean, and NOTHING else. `raw` is the on-disk bytes (string) or
// non-string when absent/unreadable; `actualSha256` is the digest the shell computed over those exact
// bytes via integrity-digest.js's ONE hasher (null when it could not be computed at all — never
// silently treated as a match). Refuses absent, unreadable, malformed, unknown-version,
// digest-mismatched, run/issue-identity-mismatched, tamper, and verification-unavailable — admits ONLY
// an exact valid clean record whose digest matches the caller-retained expectedSha256 byte-for-byte.
function computeCustodyVerdictAdmission({ raw, actualSha256, expectedSha256, expectedRunId, expectedIssue }) {
  if (typeof raw !== "string") return { admitted: false, reason: "custody verdict is absent or unreadable" };
  if (typeof expectedSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedSha256)) return { admitted: false, reason: "no valid retained custody-verdict digest to check against" };
  if (typeof actualSha256 !== "string" || actualSha256 !== expectedSha256) return { admitted: false, reason: "custody verdict digest mismatch (bytes were replaced after recording)" };
  const cls = classifyCustodyVerdictBytes(raw, { expectedRunId, expectedIssue });
  if (cls.classification === "malformed") return { admitted: false, reason: `custody verdict is malformed: ${(cls.violations || []).join("; ") || "invalid record"}` };
  if (cls.classification === "identity-mismatch") return { admitted: false, reason: `custody verdict identity mismatch: ${cls.detail}` };
  if (cls.classification !== "clean") return { admitted: false, reason: `custody verdict classification is ${cls.classification} (need clean)`, classification: cls.classification };
  return { admitted: true, reason: "clean", classification: "clean" };
}

// --- bundle-verdict (FAFF-819) ---
// The SHAPE of `faff bundle verify`'s fail-closed six-value verdict over a published Phase-0
// recovery bundle. Mirrors the ci-triage/custody-verdict idiom: the CLI (bundle.js's
// classifyBundle) already emits a well-formed structured verdict — this is the belt-and-braces
// round-trip conformance check `bundle verify` pipes its own output through before printing, and
// the seam FAFF-820/FAFF-823 pipe an externally-held verdict through via `faff contract
// bundle-verdict`. Coercion target for a malformed/out-of-enum verdict is VERIFICATION_UNAVAILABLE
// (never CLEAN) — the review-verdict/quality-gates never-guess-green precedent, extended to this
// contract's own safe-failure value. Fail-loud only on a non-object extraction.
const BUNDLE_VERDICTS = ["CLEAN", "STALE", "MISSING", "MALFORMED", "TAMPERED", "VERIFICATION_UNAVAILABLE"];
const BUNDLE_BOUNDARY_KINDS = ["issue-merge-floor", "run-close"];
const BUNDLE_IDENTITY_TOKEN_RE = /^[A-Za-z0-9._-]+$/;

// A schema-conformant identity is always emitted (safe defaults on any malformed field) — the
// RAW value is what computeBundleIdentityViolations below inspects for the reported violations,
// so a malformed identity is always a violation (exit 1), never a fail-loud (exit 2).
function safeBundleIdentity(raw) {
  const obj = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  return {
    run_id: (typeof obj.run_id === "string" && obj.run_id) ? obj.run_id : "",
    run_segment_id: Number.isInteger(obj.run_segment_id) ? obj.run_segment_id : 0,
    boundary_kind: BUNDLE_BOUNDARY_KINDS.includes(obj.boundary_kind) ? obj.boundary_kind : "issue-merge-floor",
    boundary_key: (typeof obj.boundary_key === "string" && obj.boundary_key) ? obj.boundary_key : "",
    boundary_seq: Number.isInteger(obj.boundary_seq) ? obj.boundary_seq : 0,
  };
}

function computeBundleIdentityViolations(raw, label) {
  const violations = [];
  if (raw === null || raw === undefined) return violations; // absence is reported by the caller (superseded_by is legitimately null)
  if (typeof raw !== "object" || Array.isArray(raw)) { violations.push(`${label} must be an object`); return violations; }
  if (typeof raw.run_id !== "string" || !raw.run_id || !BUNDLE_IDENTITY_TOKEN_RE.test(raw.run_id) || raw.run_id.includes("..")) violations.push(`${label}.run_id must be a non-empty identity-charset string`);
  if (!Number.isInteger(raw.run_segment_id) || raw.run_segment_id < 0) violations.push(`${label}.run_segment_id must be a non-negative integer`);
  if (!BUNDLE_BOUNDARY_KINDS.includes(raw.boundary_kind)) violations.push(`${label}.boundary_kind not in {${BUNDLE_BOUNDARY_KINDS.join(",")}}`);
  if (typeof raw.boundary_key !== "string" || !raw.boundary_key || !BUNDLE_IDENTITY_TOKEN_RE.test(raw.boundary_key) || raw.boundary_key.includes("..")) violations.push(`${label}.boundary_key must be a non-empty identity-charset string`);
  if (!Number.isInteger(raw.boundary_seq) || raw.boundary_seq < 0) violations.push(`${label}.boundary_seq must be a non-negative integer`);
  if (raw.boundary_kind === "run-close" && raw.boundary_key !== "run-close") violations.push(`${label}: boundary_kind "run-close" requires boundary_key === "run-close"`);
  return violations;
}

function computeBundleVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  const verdictOk = BUNDLE_VERDICTS.includes(extraction.verdict);
  if (!verdictOk) violations.push(`verdict ${JSON.stringify(extraction.verdict)} not in {${BUNDLE_VERDICTS.join(",")}} — coerced to VERIFICATION_UNAVAILABLE (never CLEAN)`);
  const verdict = verdictOk ? extraction.verdict : "VERIFICATION_UNAVAILABLE";

  violations.push(...computeBundleIdentityViolations(extraction.identity, "identity"));
  const identity = safeBundleIdentity(extraction.identity);

  const cause = typeof extraction.cause === "string" ? extraction.cause : "";
  if (typeof extraction.cause !== "string") violations.push("cause must be a string");

  let superseded_by = null;
  const rawSuperseded = extraction.superseded_by;
  if (rawSuperseded !== null && rawSuperseded !== undefined) {
    violations.push(...computeBundleIdentityViolations(rawSuperseded, "superseded_by"));
    superseded_by = safeBundleIdentity(rawSuperseded);
  }
  if (verdict === "STALE" && superseded_by === null) violations.push("verdict is STALE but superseded_by is null");
  if (verdict !== "STALE" && superseded_by !== null) violations.push("verdict is not STALE but superseded_by is non-null");

  return {
    contractData: { verdict, identity, cause, superseded_by, conformant: violations.length === 0, violations },
    failLoud: null,
  };
}

function contractBundleVerdict(extraction) {
  const { contractData, failLoud } = computeBundleVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "bundle-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- recovery-disposition (FAFF-820) ---
// The SHAPE of `faff bundle-recover`'s read-only recovery disposition: reconstructed /
// noop-already-present / refused, over a discovered-and-verified Phase 0 recovery bundle,
// mirroring the bundle-verdict idiom exactly. Coercion target for a malformed/out-of-enum
// disposition is `refused` (never `reconstructed`) — the SAME never-guess-green posture
// extended to this contract's own safe-failure value. The one hard safety property this
// contract checks directionally: a non-CLEAN bundle_verdict can never pair with anything
// but `refused` (a CLEAN-only admission gate that must hold even under a hand-altered
// extraction). Fail-loud only on a non-object extraction.
const RECOVERY_DISPOSITIONS = ["reconstructed", "noop-already-present", "refused"];
const RESUME_PLAN_ARRAY_BUCKETS = ["skip", "continue_review", "continue_from_push", "redispatch", "terminal"];

function safeResumePlan(raw) {
  const obj = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    skip: arr(obj.skip), continue_review: arr(obj.continue_review), continue_from_push: arr(obj.continue_from_push),
    redispatch: arr(obj.redispatch), park: arr(obj.park), terminal: arr(obj.terminal),
    drain_remainder: typeof obj.drain_remainder === "boolean" ? obj.drain_remainder : true,
  };
}

function computeResumePlanViolations(raw, label) {
  const violations = [];
  if (raw === null || raw === undefined) return violations; // absence is reported by the caller
  if (typeof raw !== "object" || Array.isArray(raw)) { violations.push(`${label} must be an object`); return violations; }
  for (const bucket of RESUME_PLAN_ARRAY_BUCKETS) {
    if (raw[bucket] !== undefined && !Array.isArray(raw[bucket])) violations.push(`${label}.${bucket} must be an array`);
  }
  if (raw.park !== undefined && !Array.isArray(raw.park)) violations.push(`${label}.park must be an array`);
  if (raw.drain_remainder !== undefined && typeof raw.drain_remainder !== "boolean") violations.push(`${label}.drain_remainder must be a boolean`);
  return violations;
}

function computeRecoveryDispositionVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];

  const dispositionOk = RECOVERY_DISPOSITIONS.includes(extraction.disposition);
  if (!dispositionOk) violations.push(`disposition ${JSON.stringify(extraction.disposition)} not in {${RECOVERY_DISPOSITIONS.join(",")}} — coerced to refused (never guess reconstructed)`);
  const disposition = dispositionOk ? extraction.disposition : "refused";

  const verdictOk = BUNDLE_VERDICTS.includes(extraction.bundle_verdict);
  if (!verdictOk) violations.push(`bundle_verdict ${JSON.stringify(extraction.bundle_verdict)} not in {${BUNDLE_VERDICTS.join(",")}} — coerced to VERIFICATION_UNAVAILABLE (never CLEAN)`);
  const bundle_verdict = verdictOk ? extraction.bundle_verdict : "VERIFICATION_UNAVAILABLE";

  let bundle_identity = null;
  const rawIdentity = extraction.bundle_identity;
  if (rawIdentity !== null && rawIdentity !== undefined) {
    violations.push(...computeBundleIdentityViolations(rawIdentity, "bundle_identity"));
    bundle_identity = safeBundleIdentity(rawIdentity);
  }

  const run_id = typeof extraction.run_id === "string" ? extraction.run_id : "";
  if (typeof extraction.run_id !== "string") violations.push("run_id must be a string");

  let run_dir = null;
  if (extraction.run_dir !== null && extraction.run_dir !== undefined) {
    if (typeof extraction.run_dir !== "string" || !extraction.run_dir) violations.push("run_dir must be a non-empty string or null");
    else run_dir = extraction.run_dir;
  }

  const boundaryKindOk = BUNDLE_BOUNDARY_KINDS.includes(extraction.boundary_kind);
  if (!boundaryKindOk) violations.push(`boundary_kind ${JSON.stringify(extraction.boundary_kind)} not in {${BUNDLE_BOUNDARY_KINDS.join(",")}}`);
  const boundary_kind = boundaryKindOk ? extraction.boundary_kind : "issue-merge-floor";

  const reason = typeof extraction.reason === "string" ? extraction.reason : "";
  if (typeof extraction.reason !== "string") violations.push("reason must be a string");

  let resume_preview = null;
  const rawPlan = extraction.resume_preview;
  if (rawPlan !== null && rawPlan !== undefined) {
    violations.push(...computeResumePlanViolations(rawPlan, "resume_preview"));
    resume_preview = safeResumePlan(rawPlan);
  }

  const candidatesOk = Number.isInteger(extraction.candidates_considered) && extraction.candidates_considered >= 0;
  if (!candidatesOk) violations.push("candidates_considered must be a non-negative integer");
  const candidates_considered = candidatesOk ? extraction.candidates_considered : 0;

  // dry_run — optional (absent -> false): whether this disposition was computed against a
  // scratch materialisation rather than the real root (spec §3 --dry-run). Carried at the
  // contract layer so an automated consumer can tell a preview apart from a real reconstruct
  // without re-parsing CLI wrapper output.
  let dry_run = false;
  if (extraction.dry_run !== null && extraction.dry_run !== undefined) {
    if (typeof extraction.dry_run !== "boolean") violations.push("dry_run must be a boolean");
    else dry_run = extraction.dry_run;
  }

  // The load-bearing safety property (spec §3 CONSTRAINT, the forward direction): a non-CLEAN
  // bundle verdict may never resolve to anything but refused — never guess reconstructed/noop
  // off an unproven bundle, even from a hand-altered extraction.
  if (bundle_verdict !== "CLEAN" && disposition !== "refused") {
    violations.push(`bundle_verdict is ${bundle_verdict} (not CLEAN) but disposition is ${disposition} — a non-CLEAN bundle must always refuse`);
  }
  // A claimed reconstruction must carry what it claims to have reconstructed.
  if (disposition === "reconstructed" && (run_dir === null || resume_preview === null)) {
    violations.push("disposition is reconstructed but run_dir and/or resume_preview is null");
  }
  // A refusal writes nothing — a non-null run_dir on a refusal would claim a reconstruction
  // that never happened.
  if (disposition === "refused" && run_dir !== null) {
    violations.push("disposition is refused but run_dir is non-null");
  }

  return {
    contractData: {
      verb: "bundle-recover", disposition, bundle_verdict, bundle_identity, run_id, run_dir, boundary_kind,
      reason, resume_preview, candidates_considered, dry_run, conformant: violations.length === 0, violations,
    },
    failLoud: null,
  };
}

function contractRecoveryDispositionVerdict(extraction) {
  const { contractData, failLoud } = computeRecoveryDispositionVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "recovery-disposition");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- scenario-record (FAFF-822) ---
// The deterministic validator of a ScenarioRecord (schema:1) banked in the nine-scenario Phase 0
// reference matrix. The record is EMITTED by the pure `faff scenario-matrix record` emitter
// (scenario-matrix.js, region governance); this contract re-validates its shape and the honest-
// claim invariants a banked reader depends on, mirroring recovery-disposition's idiom. Fail-loud
// only on a non-object extraction; every other problem is a flagged violation (never a coerce —
// this validates faff's own emitter output, so a shape defect is surfaced, not silently repaired).
const SCENARIO_RECORD_DISPOSITIONS = ["accepted", "blocked", "refused", "recovered", "denied", "detected", "parked", "amended", "corrected"];
const SCENARIO_RECORD_JOURNAL_CLASSES = ["J-A", "J-B", "J-C", "J-D"];
const SCENARIO_RECORD_EFFECT_CLASSES = ["E-A", "E-B", "E-C", "E-D"];
const SCENARIO_RECORD_CATCH_ORDINALS = new Set([2, 3, 5, 6]);
const SCENARIO_RECORD_FIELDS = ["schema", "scenario_id", "scenario_ordinal", "inputs", "environment", "run_id", "work_item_id", "disposition", "disposition_basis", "evidence_paths", "human_interventions", "cost", "assurance_vector", "claim_label", "one_shot_control", "two_custodian_split_verified"];

function computeScenarioRecordVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];

  const schema = Number.isInteger(extraction.schema) ? extraction.schema : null;
  if (schema !== 1) violations.push(`schema must be 1 (got ${JSON.stringify(extraction.schema)})`);

  for (const f of SCENARIO_RECORD_FIELDS) {
    if (!(f in extraction)) violations.push(`missing required field ${f}`);
  }

  const scenario_id = typeof extraction.scenario_id === "string" ? extraction.scenario_id : "";
  if (typeof extraction.scenario_id !== "string" || scenario_id === "") violations.push("scenario_id must be a non-empty string");

  const ordinalOk = Number.isInteger(extraction.scenario_ordinal) && extraction.scenario_ordinal >= 1 && extraction.scenario_ordinal <= 9;
  if (!ordinalOk) violations.push("scenario_ordinal must be an integer in 1..9");
  const scenario_ordinal = ordinalOk ? extraction.scenario_ordinal : 0;

  const dispositionOk = SCENARIO_RECORD_DISPOSITIONS.includes(extraction.disposition);
  if (!dispositionOk) violations.push(`disposition ${JSON.stringify(extraction.disposition)} not in {${SCENARIO_RECORD_DISPOSITIONS.join(",")}}`);
  const disposition = dispositionOk ? extraction.disposition : "";

  if (typeof extraction.run_id !== "string" || extraction.run_id === "") violations.push("run_id must be a non-empty string");
  if (typeof extraction.work_item_id !== "string" || extraction.work_item_id === "") violations.push("work_item_id must be a non-empty string");

  const av = (extraction.assurance_vector && typeof extraction.assurance_vector === "object" && !Array.isArray(extraction.assurance_vector)) ? extraction.assurance_vector : null;
  if (!av) violations.push("assurance_vector must be an object");

  const journalOk = av && SCENARIO_RECORD_JOURNAL_CLASSES.includes(av.journal_class);
  if (av && !journalOk) violations.push(`assurance_vector.journal_class ${JSON.stringify(av.journal_class)} not in {${SCENARIO_RECORD_JOURNAL_CLASSES.join(",")}}`);
  const journal_class = journalOk ? av.journal_class : "";

  const effectOk = av && SCENARIO_RECORD_EFFECT_CLASSES.includes(av.effect_class);
  if (av && !effectOk) violations.push(`assurance_vector.effect_class ${JSON.stringify(av.effect_class)} not in {${SCENARIO_RECORD_EFFECT_CLASSES.join(",")}}`);
  const effect_class = effectOk ? av.effect_class : "";

  const independence = (av && av.independence && typeof av.independence === "object") ? av.independence : null;
  const organisational_independence = independence ? independence.organisational_independence === true : false;

  // The load-bearing honest-claim invariants (the same guards the emitter enforces at build time,
  // re-checked here so a hand-altered banked record is caught):
  // (1) effect_class E-B is claimable ONLY where disposition is blocked (the merge chokepoint).
  if (effect_class === "E-B" && disposition !== "blocked") {
    violations.push("assurance_vector.effect_class is E-B but disposition is not blocked — E-B prevention is claimable only at the merge chokepoint");
  }
  // (2) journal_class is at most J-C on a producer-HMAC leg — never J-A/J-B (producer HMAC is
  //     mechanical detection, not non-repudiation).
  if (journal_class === "J-A" || journal_class === "J-B") {
    violations.push(`assurance_vector.journal_class is ${journal_class} — producer authentication is at most J-C (mechanical detection, never non-repudiation)`);
  }
  // (3) organisational_independence is false on every Phase 0 row (one maintainer).
  if (organisational_independence !== false) {
    violations.push("assurance_vector.independence.organisational_independence must be false in Phase 0 (independence is proved as key-custody mechanism only)");
  }
  // (4) one_shot_control non-null IFF the ordinal is a catch scenario {2,3,5,6}.
  const controlPresent = extraction.one_shot_control !== null && extraction.one_shot_control !== undefined;
  if (ordinalOk) {
    const isCatch = SCENARIO_RECORD_CATCH_ORDINALS.has(scenario_ordinal);
    if (isCatch !== controlPresent) {
      violations.push(`one_shot_control must be non-null iff scenario_ordinal in {2,3,5,6} (ordinal ${scenario_ordinal}, control ${controlPresent ? "present" : "null"})`);
    }
  }

  const two_custodian_split_verified = extraction.two_custodian_split_verified === true;
  if (extraction.two_custodian_split_verified !== true) violations.push("two_custodian_split_verified must be true on every row");

  return {
    contractData: {
      verb: "scenario-record", schema: schema === null ? 0 : schema, scenario_id, scenario_ordinal, disposition,
      journal_class, effect_class, organisational_independence, one_shot_control_present: controlPresent,
      two_custodian_split_verified, conformant: violations.length === 0, violations,
    },
    failLoud: null,
  };
}

function contractScenarioRecordVerdict(extraction) {
  const { contractData, failLoud } = computeScenarioRecordVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "scenario-record");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- holdout verdicts → DoD-verdict map (FAFF-277) ---
// The pure, trust-gated bridge between the evaluator's persisted holdout verdicts and the already-shipped
// `faff prdr coverage --dod-verdicts` flag. Reuses computeHoldoutVerdict VERBATIM as the trust gate (never
// a forked rule). Input: an issue→PRDR `association` {key: prdr-id} (orchestrator-lane data — the evaluator
// stays PRDR-blind) and a SORTED list of `files` {key, text} (raw `.faff/holdout/<key>.json` contents).
// Output: { verdicts: {prdr: "met"|"<aggregate>"}, skipped: [{key, reason}] }. The contract IS the boundary:
// a verdict yields `met` only when it re-passes the gate (conformant ∧ code_blind:true) AND aggregate is
// exactly "meets-spec"; every other aggregate passes through as its own ≠"met" string; untrusted files are
// omitted entirely (their aggregate cannot be believed). Conservative duplicate-PRDR fold: a PRDR is `met`
// only when EVERY trusted file mapping to it is `met` (a single failing re-run is never masked).
function computeHoldoutVerdictsMap(association, files, opts = {}) {
  const contributions = new Map();   // prdr-id -> [trusted value, ...] (insertion order = sorted-key order)
  const skipped = [];
  for (const { key, text, unreadable } of files) {
    if (!Object.prototype.hasOwnProperty.call(association, key)) { skipped.push({ key, reason: "no-association" }); continue; }
    const prdr = association[key];
    if (unreadable) { skipped.push({ key, reason: "unreadable" }); continue; }
    let block;
    try { block = JSON.parse(text); } catch { skipped.push({ key, reason: "unreadable" }); continue; }
    // The trust gate — the SAME compute fn `faff contract holdout-verdict` runs (FAFF-384: incl. the spawner-
    // attestation ratchet when opts.requireSpawnerAttested is set by the caller from the run's cage promise).
    // A fail-loud (non-object), any contract violation, or a non-true code_blind ⇒ untrusted ⇒ never "met".
    const { contractData, failLoud } = computeHoldoutVerdict(block, opts);
    if (failLoud || (contractData && contractData.violations.length > 0) || block.code_blind !== true) {
      skipped.push({ key, reason: "contract-rejected" }); continue;
    }
    const value = (block.aggregate === "meets-spec") ? "met" : block.aggregate;
    if (!contributions.has(prdr)) contributions.set(prdr, []);
    contributions.get(prdr).push(value);
  }
  const verdicts = {};
  for (const [prdr, values] of contributions) {
    // Conservative fold: `met` only when all contributing trusted values are `met`; else the first non-`met`.
    verdicts[prdr] = values.every((v) => v === "met") ? "met" : values.find((v) => v !== "met");
  }
  return { verdicts, skipped };
}

// FAFF-311: the per-issue merge-floor gate result — the SAME `computeHoldoutVerdict` trust gate the
// FAFF-277 run-bridge (computeHoldoutVerdictsMap) applies, reduced to a single pass/block decision for
// the `faff-graft` Step-10 call-site. `pass` ⇔ well-formed ∧ code_blind:true ∧ zero violations ∧
// aggregate==="meets-spec"; EVERYTHING else (fails/gaps/needs-human/non-blind/incoherent/malformed) is
// `block`. Fail-closed by construction — this never returns `pass` on doubt. Pure over the parsed block.
// FAFF-1292: the gate's per-reason rollup. Counts the reason_codes present among the block's
// needs-human criteria; a needs-human criterion with a legacy ABSENT/unknown code counts under
// "unspecified" (so a blocking legacy record is never indistinguishable from a passing one). Decidable
// on every input, legacy records included. Empty object ⇔ zero needs-human criteria. Derived SOLELY from
// contractData.criteria — never a second parse (the one-source rule), and never touches the aggregate or
// the pass/block decision (reporting detail only).
function rollupNeedsHumanReasons(criteria) {
  const counts = {};
  for (const c of criteria) {
    if (c.verdict !== "needs-human") continue;
    const key = HOLDOUT_REASON_CODES.includes(c.reason_code) ? c.reason_code : "unspecified";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function holdoutGateResult(block, opts = {}) {
  const { contractData, failLoud } = computeHoldoutVerdict(block, opts);
  if (failLoud) return { gate: "block", reason: "contract-rejected", detail: failLoud };
  // needs_human_reasons rides along whenever >=1 needs-human criterion exists, regardless of the
  // pass/block decision; it is absent iff there are zero needs-human criteria.
  const needs_human_reasons = rollupNeedsHumanReasons(contractData.criteria);
  const withReasons = (res) => (Object.keys(needs_human_reasons).length > 0 ? { ...res, needs_human_reasons } : res);
  if (contractData.violations.length > 0 || block.code_blind !== true) {
    return withReasons({ gate: "block", reason: "contract-rejected", aggregate: contractData.aggregate, code_blind: contractData.code_blind, violations: contractData.violations });
  }
  if (contractData.aggregate !== "meets-spec") {
    return withReasons({ gate: "block", reason: contractData.aggregate, aggregate: contractData.aggregate, code_blind: true });
  }
  return withReasons({ gate: "pass", reason: "meets-spec", aggregate: "meets-spec", code_blind: true });
}

module.exports = { HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, HOLDOUT_REASON_CODES, rollupNeedsHumanReasons, computeHoldoutVerdict, contractHoldoutVerdict, LANE_BOUNDARY_LANES, LANE_BOUNDARY_CONTAINERS, LANE_BOUNDARY_HOST, LANE_BOUNDARY_ACCESS, computeLaneBoundary, contractLaneBoundary, CUSTODY_CLASSIFICATIONS, CUSTODY_MERGE_STATES, CUSTODY_VERDICT_SCHEMA_VERSION, CUSTODY_DETAIL_MAX, computeCustodyVerdict, classifyCustodyVerdictBytes, computeCustodyVerdictAdmission, BUNDLE_VERDICTS, BUNDLE_BOUNDARY_KINDS, computeBundleVerdict, contractBundleVerdict, RECOVERY_DISPOSITIONS, computeRecoveryDispositionVerdict, contractRecoveryDispositionVerdict, SCENARIO_RECORD_DISPOSITIONS, computeScenarioRecordVerdict, contractScenarioRecordVerdict, computeHoldoutVerdictsMap, holdoutGateResult };
