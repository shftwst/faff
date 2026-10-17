// ===========================================================================
// === region:governance — holdout-record — FAFF-1259: the one writer of the v0.3 holdout-anchored record. ===
//
// The evaluator reports, per criterion, what it exercised, what it expected and what it
// observed. This module turns that block into the fixed `holdout-anchored` shape, for both
// callers: `faff holdout record` (inline path) and the caged `evaluate-call.mjs` spawner.
// It shapes and refuses; it never recomputes `aggregate`, `verdict` or `evidence_present`, so
// the gate (computeHoldoutVerdict, readHoldout, merge-gate) routes exactly as before.
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

const SCHEMA_PATH = path.resolve(HERE, "..", "contracts", "evidence-v0.3", "schema", "holdout-anchored.schema.json");
const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ID_RE = /^(scenarios|done):[1-9][0-9]*$/;
const MAX_DETAIL = 2000;
const TRUNCATION_SUFFIX = "…[truncated]";
const DETAIL_KEYS = ["text", "exercised", "expected", "observed", "evidence_ref", "reason"];
const NULLABLE_STRING_KEYS = ["exercised", "expected", "observed", "evidence_ref", "reason"];

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

// Pure. The writer-only constraints the schema cannot express (id pattern, met/unmet detail, needs-human
// reason, length). Messages name key paths, never values. Anchor validation calls this alone, since it
// has already run the (possibly candidate) schema.
function holdoutConstraintViolations(doc) {
  const found = [];
  if (!isObject(doc) || !Array.isArray(doc.criteria)) return found;
  doc.criteria.forEach((c, i) => {
    if (!isObject(c)) return;
    const at = `criteria[${i}]`;
    if (typeof c.id === "string" && !ID_RE.test(c.id)) found.push(`${at}.id: does not match pattern ${ID_RE.source}`);
    if (c.verdict === "met" || c.verdict === "unmet") {
      for (const key of ["exercised", "expected", "observed"]) {
        if (c[key] === null || c[key] === undefined) found.push(`${at}.${key}: required (non-null) when verdict is met or unmet`);
      }
    }
    if (c.verdict === "needs-human" && (c.reason === null || c.reason === undefined)) {
      found.push(`${at}.reason: required (non-null) when verdict is needs-human`);
    }
    for (const key of DETAIL_KEYS) {
      if (typeof c[key] === "string" && c[key].length > MAX_DETAIL) found.push(`${at}.${key}: longer than ${MAX_DETAIL} characters`);
    }
  });
  return found;
}

// Pure. Schema first, then the writer-only constraints.
function holdoutRecordViolations(doc) {
  const found = validateAgainstSchema(doc, loadSchema()).map((m) => m.replace(/^<root>: /, ""));
  return [...found, ...holdoutConstraintViolations(doc)];
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

function failClosed(top, refusals) {
  const doc = {
    schema_version: 1,
    issue: top.issue,
    aggregate: "needs-human",
    code_blind: top.code_blind === true,
    spawner_attested: top.spawner_attested === true,
    attestation: top.attestation || null,
    violations: refusals.map((r) => `holdout record refused: ${r}`),
    criteria: [],
  };
  return { ok: false, doc, bytes: serialise(doc), refusals };
}

function buildHoldoutRecord(block, opts) {
  const issue = opts.issue;
  const envelope = opts.envelope;
  const base = { issue, code_blind: false, spawner_attested: false, attestation: null };
  if (envelope) {
    base.code_blind = envelope.code_blind === true;
    base.spawner_attested = envelope.spawner_attested === true;
    base.attestation = normaliseAttestation(envelope.attestation);
  }
  if (!isObject(block)) return failClosed(base, ["evaluator block is not a JSON object"]);
  if (!envelope) base.code_blind = block.code_blind === true;

  const secrets = [...(opts.secretValues || resolveKnownSecretValues()), ...(opts.extraSecrets || [])]
    .filter((s) => typeof s === "string" && s.length > 0);
  const violations = Array.isArray(block.violations) ? block.violations.filter((v) => typeof v === "string" && v.trim()) : [];
  const top = {
    schema_version: 1,
    issue,
    aggregate: block.aggregate,
    code_blind: envelope ? envelope.code_blind === true : block.code_blind === true,
    spawner_attested: base.spawner_attested,
    attestation: base.attestation,
    violations: envelope && Array.isArray(envelope.violations) ? [...violations, ...envelope.violations] : violations,
    criteria: (Array.isArray(block.criteria) ? block.criteria : []).map(normaliseCriterion),
  };

  const redacted = redactKnownSecrets(top, secrets);
  redacted.criteria = redacted.criteria.map((c) => {
    const out = { ...c };
    for (const key of DETAIL_KEYS) out[key] = truncateDetail(out[key]);
    return out;
  });

  const refusals = holdoutRecordViolations(redacted);
  if (refusals.length > 0) return failClosed(base, refusals);
  return { ok: true, doc: redacted, bytes: serialise(redacted), refusals: [] };
}

function holdoutRecordSelftest() {
  const failures = [];
  const check = (label, cond) => { if (!cond) failures.push(label); };
  const issue = "FAFF-1";
  const met = { id: "scenarios:1", text: "t", holdout: true, class: "scenario", verdict: "met", evidence_present: true, exercised: "POST /x", expected: "201", observed: "201" };
  const block = (criteria, aggregate = "meets-spec") => ({ aggregate, code_blind: true, violations: [], criteria });
  const opts = { issue, secretValues: [] };

  const ok = buildHoldoutRecord(block([met]), opts);
  check("accepted: ok", ok.ok && ok.refusals.length === 0);
  check("accepted: every key present", ok.doc.criteria[0].evidence_ref === null && ok.doc.criteria[0].reason === null);
  check("accepted: CLI shape is unattested", ok.doc.spawner_attested === false && ok.doc.attestation === null);
  check("accepted: bytes are deterministic", ok.bytes === buildHoldoutRecord(block([met]), opts).bytes);
  check("accepted: bytes end with a newline", ok.bytes.endsWith("\n"));
  check("accepted: passes its own validator", holdoutRecordViolations(ok.doc).length === 0);

  const attested = { code_blind: true, spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" }, violations: [] };
  const att = buildHoldoutRecord({ ...block([met]), spawner_attested: false }, { ...opts, envelope: attested });
  check("attested: envelope stamps the attestation", att.ok && att.doc.spawner_attested === true && att.doc.attestation.preflight === "pass");

  const forged = buildHoldoutRecord({ ...block([met]), spawner_attested: true, attestation: attested.attestation }, opts);
  check("forged: input attestation is ignored", forged.doc.spawner_attested === false && forged.doc.attestation === null);

  const noExercised = buildHoldoutRecord(block([{ ...met, exercised: null }]), opts);
  check("refused: met without exercised", !noExercised.ok && noExercised.doc.aggregate === "needs-human" && noExercised.doc.criteria.length === 0);
  check("refused: violation carries the prefix", noExercised.doc.violations[0].startsWith("holdout record refused:"));
  check("refused: record validates", holdoutRecordViolations(noExercised.doc).length === 0);

  const noReason = buildHoldoutRecord(block([{ id: "done:1", text: "t", class: "prose", verdict: "needs-human", evidence_present: false }], "needs-human"), opts);
  check("refused: needs-human without reason", !noReason.ok);

  check("refused: non-object block", !buildHoldoutRecord("nope", opts).ok);
  check("accepted: env-not-ready block", buildHoldoutRecord(block([], "needs-human"), opts).ok);
  check("refused: bad id", !buildHoldoutRecord(block([{ ...met, id: "scenarios:0" }]), opts).ok);

  const long = buildHoldoutRecord(block([{ ...met, observed: "x".repeat(5000) }]), opts);
  check("truncation: length exactly 2000", long.ok && long.doc.criteria[0].observed.length === 2000 && long.doc.criteria[0].observed.endsWith(TRUNCATION_SUFFIX));
  const pair = buildHoldoutRecord(block([{ ...met, observed: `${"x".repeat(1987)}\u{1F600}${"y".repeat(100)}` }]), opts);
  check("truncation: does not split a surrogate pair", pair.ok && pair.doc.criteria[0].observed.length === 1999);

  const token = "tok-abcdef123456";
  const straddle = buildHoldoutRecord(block([{ ...met, observed: `${"x".repeat(1978)}${token}${"y".repeat(200)}` }]), { ...opts, extraSecrets: [token] });
  check("redaction runs before truncation", straddle.ok && !straddle.bytes.includes(token.slice(0, 6)));
  const scrubbed = buildHoldoutRecord(block([{ ...met, observed: `saw ${token}` }]), { ...opts, extraSecrets: [token] });
  check("redaction: placeholder replaces the secret", scrubbed.doc.criteria[0].observed === "saw [REDACTED]");

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
  buildHoldoutRecord, holdoutConstraintViolations, holdoutRecordViolations, holdoutRecordSelftest, isSafeHoldoutKey, resolveContained, writeHoldoutRecord,
};
