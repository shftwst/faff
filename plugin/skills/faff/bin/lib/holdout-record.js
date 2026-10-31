// ===========================================================================
// === region:governance — holdout-record — FAFF-1259: the one writer of the v0.3 holdout-anchored record. ===
//
// The evaluator reports, per criterion, what it exercised, what it expected and what it
// observed. This module turns that block into the fixed `holdout-anchored` shape, for both
// callers: `faff holdout record` (inline path) and the caged `evaluate-call.mjs` spawner.
// It shapes and refuses; it refuses an `aggregate` the criteria do not derive and never rewrites
// `aggregate`, `verdict` or `evidence_present`, so the gate (computeHoldoutVerdict, readHoldout,
// merge-gate) routes exactly as before.
//
// A refused block still yields a record: a fail-closed `needs-human` one. Every consumer reads
// an absent holdout verdict as "did not run" and steps aside, so writing nothing would turn a
// malformed verdict into a pass-through.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { validateAgainstSchema } = require("./contract-engine");
const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");
const { HERE } = require("./shared-infra");
const { resolveFaffVersion } = require("./faff-version"); // FAFF-1395

const SCHEMA_PATH = path.resolve(HERE, "..", "contracts", "evidence-v0.3", "schema", "holdout-anchored.schema.json");
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ID_RE = /^(scenarios|done):[1-9][0-9]*$/;
const DONE_ID_RE = /^done:[1-9][0-9]*$/;
const DELEGATED_KEYS = ["id", "text", "holdout", "verification_tier", "verifier", "ac_id"];
const DELEGATED_TIERS = ["delegated", "integration"];
const DELEGATED_VERIFIER_FOR_TIER = { delegated: "ac-checklist", integration: "review-merge-floor" };
const MAX_DETAIL = 2000;
const TRUNCATION_SUFFIX = "…[truncated]";
const DETAIL_KEYS = ["text", "exercised", "expected", "observed", "evidence_ref", "reason"];
const NULLABLE_STRING_KEYS = ["exercised", "expected", "observed", "evidence_ref", "reason", "reason_code"];
// FAFF-1292: the closed reason_code vocabulary. One value — human-only — is "a human must look";
// the other four are environment/infrastructure reachability gaps that fail closed and direct the
// operator to fix the env and re-run. A faithful promotion of the causes the evaluator SKILL already
// enumerates. Defined here (governance region — the writer's home) and re-exported from
// contract-defs-evidence.js so the contract layer and the describe/registry/CLI share one source and
// the factory→governance require direction stays legal.
const HOLDOUT_REASON_CODES = ["human-only", "no-surface", "wire-error", "credentials-unavailable", "env-not-ready"];

let cachedSchema = null;
function loadSchema() {
  if (!cachedSchema) cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  return cachedSchema;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function isSafeHoldoutKey(s) {
  return typeof s === "string" && KEY_RE.test(s) && !s.includes("..");
}

// Containment of `rel` under `base`: the realpath of the deepest existing ancestor plus the
// lexical remainder. Null when the target escapes, or any existing component below base is a
// symlink. Creates nothing.
function realOfDeepestAncestor(target) {
  let head = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(head), ...tail.reverse());
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return path.resolve(target);
      tail.push(path.basename(head));
      head = parent;
    }
  }
}

function resolveContained(base, rel) {
  if (typeof base !== "string" || typeof rel !== "string") return null;
  const lexical = path.relative(path.resolve(base), path.resolve(base, rel));
  if (lexical === ".." || lexical.startsWith(`..${path.sep}`) || path.isAbsolute(lexical)) return null;
  const realBase = realOfDeepestAncestor(base);
  let cur = realBase;
  for (const segment of lexical.split(path.sep).filter(Boolean)) {
    cur = path.join(cur, segment);
    let stat;
    try {
      stat = fs.lstatSync(cur);
    } catch {
      break;
    }
    if (stat.isSymbolicLink()) return null;
  }
  return path.join(realBase, lexical);
}

function writeHoldoutRecord(file, bytes) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    throw e;
  }
}

function truncateDetail(value) {
  if (typeof value !== "string" || value.length <= MAX_DETAIL) return value;
  let cut = MAX_DETAIL - TRUNCATION_SUFFIX.length;
  const last = value.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + TRUNCATION_SUFFIX;
}

// FAFF-1291: the one home for the delegation rules. Pure; reads only `criteria` and `delegated`
// of a holdout block or record, so the contract (raw evaluator block) and the writer (record) share it.
// Messages name key paths and ids minted by `faff dod classify`, never free text.
function delegationViolations(doc) {
  const found = [];
  if (!isObject(doc)) return found;
  const criteria = Array.isArray(doc.criteria) ? doc.criteria : [];
  const judgedIds = new Set();
  criteria.forEach((c, i) => {
    if (!isObject(c)) return;
    if (c.class === "prose" && typeof c.id === "string" && DONE_ID_RE.test(c.id)) {
      found.push(`criteria[${i}] is a delegated prose DONE criterion and must not be judged`);
    }
    if (typeof c.id === "string") {
      if (judgedIds.has(c.id)) found.push(`criteria[${i}].id: ${c.id} appears more than once in criteria`);
      judgedIds.add(c.id);
    }
  });
  if (!Object.prototype.hasOwnProperty.call(doc, "delegated") || doc.delegated === undefined) return found;
  if (!Array.isArray(doc.delegated)) { found.push("delegated: must be an array"); return found; }
  const delegatedIds = new Set();
  doc.delegated.forEach((r, i) => {
    const at = `delegated[${i}]`;
    if (!isObject(r)) { found.push(`${at}: must be an object`); return; }
    for (const key of DELEGATED_KEYS) if (!(key in r)) found.push(`${at}.${key}: required`);
    for (const key of Object.keys(r)) if (!DELEGATED_KEYS.includes(key)) found.push(`${at}.${key}: not a permitted key`);
    if ("id" in r && !(typeof r.id === "string" && ID_RE.test(r.id))) found.push(`${at}.id: does not match pattern ${ID_RE.source}`);
    if ("text" in r && typeof r.text !== "string") found.push(`${at}.text: must be a string`);
    if ("holdout" in r && typeof r.holdout !== "boolean") found.push(`${at}.holdout: must be a boolean`);
    if ("ac_id" in r && r.ac_id !== null && typeof r.ac_id !== "string") found.push(`${at}.ac_id: must be a string or null`);
    const tierOk = DELEGATED_TIERS.includes(r.verification_tier);
    if ("verification_tier" in r && !tierOk) found.push(`${at}.verification_tier: not in {${DELEGATED_TIERS.join(",")}}`);
    if ("verifier" in r && !Object.values(DELEGATED_VERIFIER_FOR_TIER).includes(r.verifier)) found.push(`${at}.verifier: not in {ac-checklist,review-merge-floor}`);
    if (tierOk && "verifier" in r && DELEGATED_VERIFIER_FOR_TIER[r.verification_tier] !== r.verifier) {
      found.push(`${at}: verification_tier ${r.verification_tier} must pair with verifier ${DELEGATED_VERIFIER_FOR_TIER[r.verification_tier]}`);
    }
    if (r.verification_tier === "delegated" && typeof r.id === "string" && !DONE_ID_RE.test(r.id)) {
      found.push(`${at}.id: a delegated-tier row must have a done:N id`);
    }
    if (typeof r.id === "string") {
      if (delegatedIds.has(r.id)) found.push(`${at}.id: ${r.id} appears more than once in delegated`);
      delegatedIds.add(r.id);
      if (judgedIds.has(r.id)) found.push(`${at}.id: ${r.id} appears in both criteria and delegated`);
    }
  });
  return found;
}

// Pure. The writer-only constraints the schema cannot express (id pattern, met/unmet detail, needs-human
// reason, length, prose rule) plus the delegation rules. Messages name key paths, never values. Anchor
// validation calls this alone, since it has already run the (possibly candidate) schema. The delegation
// rules run on a record that carries `delegated`: the writer always emits it from FAFF-1291 on, and a
// record committed before then was valid under its writer and stays valid (anchors are immutable).
function holdoutConstraintViolations(doc) {
  const found = [];
  if (!isObject(doc) || !Array.isArray(doc.criteria)) return found;
  if (Object.prototype.hasOwnProperty.call(doc, "delegated")) found.push(...delegationViolations(doc));
  doc.criteria.forEach((c, i) => {
    if (!isObject(c)) return;
    const at = `criteria[${i}]`;
    if (typeof c.id === "string" && !ID_RE.test(c.id)) found.push(`${at}.id: does not match pattern ${ID_RE.source}`);
    if (c.verdict === "met" || c.verdict === "unmet") {
      for (const key of ["exercised", "expected", "observed"]) {
        if (c[key] === null || c[key] === undefined) found.push(`${at}.${key}: required (non-null) when verdict is met or unmet`);
      }
    }
    if (c.class === "prose" && c.verdict !== "needs-human") found.push(`${at}: a prose criterion must be needs-human (ADR-0029)`);
    if (c.verdict === "needs-human" && (c.reason === null || c.reason === undefined)) {
      found.push(`${at}.reason: required (non-null) when verdict is needs-human`);
    }
    for (const key of DETAIL_KEYS) {
      if (typeof c[key] === "string" && c[key].length > MAX_DETAIL) found.push(`${at}.${key}: longer than ${MAX_DETAIL} characters`);
    }
  });
  return found;
}

// FAFF-1292: the reason_code cross-field rules — the WRITER (strict) half of the split. A fresh
// emission MUST carry a valid reason_code on a needs-human criterion (fail-closed refusal); the
// contract's absent-code tolerance is a read-side re-validation property only, so anchor validation
// (holdoutConstraintViolations alone) never applies these. Messages name key paths, never the value.
function reasonCodeViolations(doc) {
  const found = [];
  if (!isObject(doc) || !Array.isArray(doc.criteria)) return found;
  doc.criteria.forEach((c, i) => {
    if (!isObject(c)) return;
    const at = `criteria[${i}]`;
    const rc = c.reason_code;
    const hasRc = rc !== null && rc !== undefined;
    if (hasRc && !HOLDOUT_REASON_CODES.includes(rc)) found.push(`${at}.reason_code: not in {${HOLDOUT_REASON_CODES.join(",")}}`);
    if ((c.verdict === "met" || c.verdict === "unmet") && hasRc) found.push(`${at}.reason_code: must be null when verdict is met or unmet`);
    if (c.verdict === "needs-human" && !hasRc) found.push(`${at}.reason_code: required (non-null) when verdict is needs-human`);
    if (c.class === "prose" && hasRc && rc !== "human-only") found.push(`${at}.reason_code: a prose criterion must be human-only`);
    if ((c.class === "scenario" || c.class === "assertion") && c.verdict === "needs-human" && hasRc && rc === "human-only") found.push(`${at}.reason_code: a born-verifiable criterion is never human-only`);
  });
  return found;
}

// Pure. Schema first, then the writer-only constraints.
function holdoutRecordViolations(doc) {
  const found = validateAgainstSchema(doc, loadSchema()).map((m) => m.replace(/^<root>: /, ""));
  return [...found, ...holdoutConstraintViolations(doc), ...reasonCodeViolations(doc)];
}

function serialise(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function stringOrNull(v) {
  return v === undefined || v === null ? null : v;
}

function normaliseCriterion(c) {
  const src = isObject(c) ? c : {};
  const out = {
    id: src.id,
    text: src.text,
    holdout: src.holdout === undefined ? false : src.holdout,
    class: src.class,
    verdict: src.verdict,
    evidence_present: src.evidence_present === undefined ? false : src.evidence_present,
  };
  for (const key of NULLABLE_STRING_KEYS) out[key] = stringOrNull(src[key]);
  return out;
}

function normaliseAttestation(att) {
  if (!isObject(att)) return null;
  const w = isObject(att.withheld) ? att.withheld : {};
  return { spawner: att.spawner, withheld: { repo: w.repo, worktree_cwd: w.worktree_cwd, diff: w.diff }, preflight: att.preflight };
}

// `blockViolations` are the evaluator block's own (already redacted) violations, kept after the
// refusal lines so a refused record still says why the evaluator judged nothing (FAFF-1291).
function failClosed(top, refusals, delegated, blockViolations) {
  const doc = {
    schema_version: 1,
    faff_version: resolveFaffVersion().version, // FAFF-1395
    issue: top.issue,
    aggregate: "needs-human",
    code_blind: top.code_blind === true,
    spawner_attested: top.spawner_attested === true,
    attestation: top.attestation || null,
    violations: [...refusals.map((r) => `holdout record refused: ${r}`), ...(Array.isArray(blockViolations) ? blockViolations : [])],
    criteria: [],
    delegated: Array.isArray(delegated) ? delegated : [],
  };
  return { ok: false, doc, bytes: serialise(doc), refusals };
}

// FAFF-1291: the writer-owned `delegated[]`, derived from `faff dod classify` output and never copied
// from the evaluator block. Returns null when `classified` is not usable classify output.
function deriveDelegated(classified) {
  if (!isObject(classified) || !Array.isArray(classified.criteria)) return null;
  return classified.criteria
    .filter((c) => isObject(c) && (c.verification_tier === "delegated" || c.verification_tier === "integration"))
    .map((c) => ({
      id: c.id,
      text: c.text,
      holdout: c.holdout === true,
      verification_tier: c.verification_tier,
      verifier: c.verifier,
      ac_id: typeof c.ac_id === "string" ? c.ac_id : null,
    }));
}

function judgedIdsOf(classified) {
  return classified.criteria.filter((c) => isObject(c) && c.verification_tier === "running-stack").map((c) => c.id);
}

// `opts.classified` is `dodClassify` output over the full-view spec text the evaluator received. It is
// passed in, not computed here: this module is governance-region and must not require admissibility.js.
function buildHoldoutRecord(block, opts) {
  const issue = opts.issue;
  const envelope = opts.envelope;
  const base = { issue, code_blind: false, spawner_attested: false, attestation: null };
  if (envelope) {
    base.code_blind = envelope.code_blind === true;
    base.spawner_attested = envelope.spawner_attested === true;
    base.attestation = normaliseAttestation(envelope.attestation);
  }

  const secrets = [...(opts.secretValues || resolveKnownSecretValues()), ...(opts.extraSecrets || [])]
    .filter((s) => typeof s === "string" && s.length > 0);
  const derived = deriveDelegated(opts.classified);
  // Redacted and truncated like criteria detail, on the success and the fail-closed paths alike.
  const delegated = derived === null ? [] : redactKnownSecrets(derived, secrets).map((r) => ({ ...r, text: truncateDetail(r.text) }));
  if (derived === null) return failClosed(base, ["no `faff dod classify` output to check the criteria against (the spec was not classified)"], []);

  if (!isObject(block)) return failClosed(base, ["evaluator block is not a JSON object"], delegated);
  if (!envelope) base.code_blind = block.code_blind === true;

  const violations = Array.isArray(block.violations) ? block.violations.filter((v) => typeof v === "string" && v.trim()) : [];
  const rawCriteria = Array.isArray(block.criteria) ? block.criteria : [];
  const top = {
    schema_version: 1,
    faff_version: resolveFaffVersion().version, // FAFF-1395
    issue,
    aggregate: block.aggregate,
    code_blind: envelope ? envelope.code_blind === true : block.code_blind === true,
    spawner_attested: base.spawner_attested,
    attestation: base.attestation,
    violations: envelope && Array.isArray(envelope.violations) ? [...violations, ...envelope.violations] : violations,
    criteria: rawCriteria.map(normaliseCriterion),
  };

  const redacted = redactKnownSecrets(top, secrets);
  redacted.criteria = redacted.criteria.map((c) => {
    const out = { ...c };
    for (const key of DETAIL_KEYS) out[key] = truncateDetail(out[key]);
    return out;
  });
  redacted.delegated = delegated;

  const refusals = [];
  const unidentified = redacted.criteria.map((c, i) => (typeof c.id === "string" ? -1 : i)).filter((i) => i >= 0);
  if (unidentified.length > 0) {
    refusals.push(`criteria[${unidentified.join(", ")}].id: missing, so the rows cannot be matched against the judged set from faff dod classify`);
  } else {
    const have = new Set(redacted.criteria.map((c) => c.id));
    const want = new Set(judgedIdsOf(opts.classified));
    const missing = [...want].filter((id) => !have.has(id));
    const unexpected = [...have].filter((id) => !want.has(id));
    if (missing.length > 0 || unexpected.length > 0) {
      refusals.push(`criteria ids do not match the judged set from faff dod classify: missing [${missing.join(", ")}], unexpected [${unexpected.join(", ")}]`);
    }
  }
  const verdicts = redacted.criteria.map((c) => c.verdict);
  if (verdicts.every((v) => v === "met" || v === "unmet" || v === "needs-human")) {
    const expected = deriveHoldoutAggregate(verdicts);
    if (redacted.aggregate !== expected) refusals.push(`aggregate is "${truncateDetail(String(redacted.aggregate))}" but criteria derive "${expected}"`);
  }
  refusals.push(...holdoutRecordViolations(redacted));
  if (refusals.length > 0) return failClosed(base, refusals, delegated, redacted.violations);
  return { ok: true, doc: redacted, bytes: serialise(redacted), refusals: [] };
}

// The aggregate derivation (gateway-normative, ADR-0032). Lives here so the writer and the contract agree.
function deriveHoldoutAggregate(verdicts) {
  if (verdicts.some((v) => v === "needs-human")) return "needs-human";
  if (verdicts.length === 0) return "needs-human";       // nothing judged → needs-human
  if (verdicts.every((v) => v === "met")) return "meets-spec";
  if (verdicts.every((v) => v === "unmet")) return "fails";
  return "gaps";                                          // mixed met/unmet
}

function holdoutRecordSelftest() {
  const failures = [];
  const check = (label, cond) => { if (!cond) failures.push(label); };
  const issue = "FAFF-1";
  const met = { id: "scenarios:1", text: "t", holdout: true, class: "scenario", verdict: "met", evidence_present: true, exercised: "POST /x", expected: "201", observed: "201" };
  const block = (criteria, aggregate = "meets-spec") => ({ aggregate, code_blind: true, violations: [], criteria });
  const row = (id, tier, extra = {}) => ({ id, text: `t ${id}`, class: id.startsWith("done") ? "prose" : "scenario", source: id.split(":")[0], holdout: false, verification_tier: tier, verifier: { "running-stack": "holdout", delegated: "ac-checklist", integration: "review-merge-floor" }[tier], ac_id: null, ...extra });
  const classified = { criteria: [row("scenarios:1", "running-stack"), row("done:1", "delegated", { ac_id: "faff-1#ac-1" }), row("done:2", "integration", { ac_id: "faff-1#ac-2" })] };
  const opts = { issue, secretValues: [], classified };

  const ok = buildHoldoutRecord(block([met]), opts);
  check("accepted: ok", ok.ok && ok.refusals.length === 0);
  check("accepted: every key present", ok.doc.criteria[0].evidence_ref === null && ok.doc.criteria[0].reason === null);
  check("accepted: CLI shape is unattested", ok.doc.spawner_attested === false && ok.doc.attestation === null);
  check("accepted: bytes are deterministic", ok.bytes === buildHoldoutRecord(block([met]), opts).bytes);
  check("accepted: bytes end with a newline", ok.bytes.endsWith("\n"));
  check("accepted: passes its own validator", holdoutRecordViolations(ok.doc).length === 0);
  check("accepted: delegated[] comes from classify", ok.doc.delegated.length === 2 && ok.doc.delegated[0].verifier === "ac-checklist" && ok.doc.delegated[1].verifier === "review-merge-floor" && ok.doc.delegated[0].ac_id === "faff-1#ac-1");
  const own = buildHoldoutRecord({ ...block([met]), delegated: [{ id: "done:9" }] }, opts);
  check("accepted: a block's own delegated key is ignored", own.ok && own.doc.delegated.length === 2 && own.doc.delegated.every((r) => r.id !== "done:9"));
  const noClassify = buildHoldoutRecord(block([met]), { issue, secretValues: [] });
  check("refused: no classify output", !noClassify.ok && Array.isArray(noClassify.doc.delegated) && noClassify.doc.delegated.length === 0);
  const missing = buildHoldoutRecord(block([], "needs-human"), opts);
  check("refused: a missing judged id is named, delegated kept", !missing.ok && missing.doc.violations.some((v) => v.includes("missing [scenarios:1]")) && missing.doc.delegated.length === 2);
  const proseDone = buildHoldoutRecord(block([met, { id: "done:1", text: "t", class: "prose", verdict: "needs-human", evidence_present: false, reason: "prose criterion" }], "needs-human"), opts);
  check("refused: a delegated prose DONE row is named", !proseDone.ok && proseDone.doc.violations.some((v) => v.includes("done:1")));
  const noId = buildHoldoutRecord(block([{ ...met, id: undefined }]), opts);
  check("refused: a row with no id", !noId.ok && noId.doc.delegated.length === 2);
  check("delegationViolations: both-lists id", delegationViolations({ criteria: [{ id: "done:1", class: "assertion" }], delegated: ok.doc.delegated }).some((v) => v.includes("both criteria and delegated")));
  check("delegationViolations: tier and verifier must pair", delegationViolations({ criteria: [], delegated: [{ ...ok.doc.delegated[0], verifier: "review-merge-floor" }] }).length > 0);
  check("delegationViolations: delegated tier needs a done id", delegationViolations({ criteria: [], delegated: [{ ...ok.doc.delegated[0], id: "scenarios:3" }] }).length > 0);
  const secretDelegated = { criteria: [row("scenarios:1", "running-stack"), row("done:1", "delegated", { text: `uses sk-secret-token-123 ${"x".repeat(3000)}` })] };
  const redactedOk = buildHoldoutRecord(block([met]), { ...opts, extraSecrets: ["sk-secret-token-123"], classified: secretDelegated });
  check("delegated text is redacted and truncated (success)", redactedOk.ok && !redactedOk.bytes.includes("sk-secret") && redactedOk.doc.delegated[0].text.length === 2000);
  const redactedRefused = buildHoldoutRecord(block([]), { ...opts, extraSecrets: ["sk-secret-token-123"], classified: secretDelegated });
  check("delegated text is redacted and truncated (fail-closed)", !redactedRefused.ok && !redactedRefused.bytes.includes("sk-secret") && redactedRefused.doc.delegated[0].text.length === 2000);

  const attested = { code_blind: true, spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" }, violations: [] };
  const att = buildHoldoutRecord({ ...block([met]), spawner_attested: false }, { ...opts, envelope: attested });
  check("attested: envelope stamps the attestation", att.ok && att.doc.spawner_attested === true && att.doc.attestation.preflight === "pass");

  const forged = buildHoldoutRecord({ ...block([met]), spawner_attested: true, attestation: attested.attestation }, opts);
  check("forged: input attestation is ignored", forged.doc.spawner_attested === false && forged.doc.attestation === null);

  const noExercised = buildHoldoutRecord(block([{ ...met, exercised: null }]), opts);
  check("refused: met without exercised", !noExercised.ok && noExercised.doc.aggregate === "needs-human" && noExercised.doc.criteria.length === 0);
  check("refused: violation carries the prefix", noExercised.doc.violations[0].startsWith("holdout record refused:"));
  check("refused: record validates", holdoutRecordViolations(noExercised.doc).length === 0);

  const noReason = buildHoldoutRecord(block([met, { id: "scenarios:2", text: "t", class: "prose", verdict: "needs-human", evidence_present: false }], "needs-human"), { ...opts, classified: { criteria: [row("scenarios:1", "running-stack"), row("scenarios:2", "running-stack")] } });
  check("refused: needs-human without reason", !noReason.ok);

  const disagree = buildHoldoutRecord(block([met], "fails"), opts);
  check("refused: aggregate the criteria do not derive", !disagree.ok && disagree.doc.aggregate === "needs-human" && disagree.doc.violations.some((v) => v.includes('aggregate is "fails" but criteria derive "meets-spec"')));
  check("refused: meets-spec over no criteria", !buildHoldoutRecord(block([], "meets-spec"), { ...opts, classified: { criteria: [row("done:1", "delegated")] } }).ok);

  check("refused: non-object block", !buildHoldoutRecord("nope", opts).ok);
  check("accepted: nothing-judged block when classify judges nothing", buildHoldoutRecord(block([], "needs-human"), { ...opts, classified: { criteria: [row("done:1", "delegated")] } }).ok);
  check("refused: bad id", !buildHoldoutRecord(block([{ ...met, id: "scenarios:0" }]), opts).ok);
  check("refused: prose scenario judged met", !buildHoldoutRecord(block([{ ...met, class: "prose" }]), opts).ok);

  const long = buildHoldoutRecord(block([{ ...met, observed: "x".repeat(5000) }]), opts);
  check("truncation: length exactly 2000", long.ok && long.doc.criteria[0].observed.length === 2000 && long.doc.criteria[0].observed.endsWith(TRUNCATION_SUFFIX));
  const pair = buildHoldoutRecord(block([{ ...met, observed: `${"x".repeat(1987)}\u{1F600}${"y".repeat(100)}` }]), opts);
  check("truncation: does not split a surrogate pair", pair.ok && pair.doc.criteria[0].observed.length === 1999);

  const token = "tok-abcdef123456";
  const straddle = buildHoldoutRecord(block([{ ...met, observed: `${"x".repeat(1978)}${token}${"y".repeat(200)}` }]), { ...opts, extraSecrets: [token] });
  check("redaction runs before truncation", straddle.ok && !straddle.bytes.includes(token.slice(0, 6)));
  const scrubbed = buildHoldoutRecord(block([{ ...met, observed: `saw ${token}` }]), { ...opts, extraSecrets: [token] });
  check("redaction: placeholder replaces the secret", scrubbed.doc.criteria[0].observed === "saw [REDACTED]");

  // FAFF-1292: reason_code — acceptance of a valid code + refusal of each writer-layer cross-field violation.
  const rcClassified = { criteria: [row("scenarios:1", "running-stack")] };
  const rcOpts = { issue, secretValues: [], classified: rcClassified };
  const nh = { id: "scenarios:1", text: "t", holdout: true, class: "assertion", verdict: "needs-human", evidence_present: false, reason: "no reachable surface", reason_code: "no-surface" };
  const rcOk = buildHoldoutRecord(block([nh], "needs-human"), rcOpts);
  check("reason_code: accepted needs-human/no-surface stamps the code", rcOk.ok && rcOk.doc.criteria[0].reason_code === "no-surface");
  check("reason_code: accepted record validates", rcOk.ok && holdoutRecordViolations(rcOk.doc).length === 0);
  check("reason_code: met leaves reason_code null", ok.doc.criteria[0].reason_code === null);
  const rcMissing = buildHoldoutRecord(block([{ ...nh, reason_code: undefined }], "needs-human"), rcOpts);
  check("reason_code: refused needs-human without a code", !rcMissing.ok && rcMissing.doc.violations.some((v) => v.includes("reason_code: required")));
  const rcBad = buildHoldoutRecord(block([{ ...nh, reason_code: "bogus" }], "needs-human"), rcOpts);
  check("reason_code: refused out-of-enum code", !rcBad.ok && rcBad.doc.violations.some((v) => v.includes("reason_code: not in")));
  const rcHumanOnly = buildHoldoutRecord(block([{ ...nh, reason_code: "human-only" }], "needs-human"), rcOpts);
  check("reason_code: refused born-verifiable human-only", !rcHumanOnly.ok && rcHumanOnly.doc.violations.some((v) => v.includes("never human-only")));
  const proseClassified = { criteria: [row("scenarios:1", "running-stack")] };
  const rcProse = buildHoldoutRecord(block([{ id: "scenarios:1", text: "t", holdout: true, class: "prose", verdict: "needs-human", evidence_present: false, reason: "taste", reason_code: "no-surface" }], "needs-human"), { issue, secretValues: [], classified: proseClassified });
  check("reason_code: refused prose with a non-human-only code", !rcProse.ok && rcProse.doc.violations.some((v) => v.includes("must be human-only")));
  const rcMet = buildHoldoutRecord(block([{ ...met, reason_code: "no-surface" }]), opts);
  check("reason_code: refused met carrying a code", !rcMet.ok && rcMet.doc.violations.some((v) => v.includes("must be null when verdict is met")));

  const sentinel = "SENTINEL-VALUE-9f3";
  const msgs = holdoutRecordViolations({ ...ok.doc, criteria: [{ ...ok.doc.criteria[0], id: sentinel, text: 5 }] });
  check("violations name key paths, never values", msgs.length > 0 && msgs.every((m) => !m.includes(sentinel)));

  check("key guard", isSafeHoldoutKey("FAFF-1") && !isSafeHoldoutKey("a/b") && !isSafeHoldoutKey("..") && !isSafeHoldoutKey("-x") && !isSafeHoldoutKey("a..b"));
  check("containment: escape is null", resolveContained("/tmp/base", "../x") === null && resolveContained("/tmp/base", "/etc") === null);
  check("containment: child resolves", typeof resolveContained("/tmp/base", "a/b") === "string");

  if (failures.length) {
    process.stderr.write(`holdout-record selftest FAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("holdout-record selftest: OK\n");
  return 0;
}

module.exports = {
  HOLDOUT_REASON_CODES, buildHoldoutRecord, delegationViolations, deriveHoldoutAggregate, holdoutConstraintViolations, holdoutRecordViolations, holdoutRecordSelftest, isSafeHoldoutKey, resolveContained, writeHoldoutRecord,
};
