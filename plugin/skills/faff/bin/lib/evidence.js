// ===========================================================================
// === region:governance — evidence — FAFF-1256: read-only anchor validation against the v0.3 evidence schemas. ===
//
// `faff evidence validate <anchor-dir>` reports pass, fail or legacy for one per-PR anchor
// directory. It reads the BUNDLED copy of verification/evidence/v0.3/ (contracts/evidence-v0.3),
// never the anchor's or the working checkout's verification/ directory: in an adopter run
// the working checkout belongs to the party being audited. Nothing here refuses a mint, fails a
// governance-check leg or changes merge-gate routing; slices 5 and 6 of FAFF-1255 call
// validateAnchorDir for that.
//
// `faff evidence write spec-review-verdict` (FAFF-1267) is the writer: it reads a carried
// `## Spec-review evidence` comment (or a committed spec holding one), verifies its sha256 line, and
// writes the v0.3 `spec-review-verdict.json` into a run dir. The path guards and the atomic file write
// are shared cores (`guardWriterPaths`, `writeEvidenceFile`) any later evidence writer reuses.
// `faff evidence write ac-checklist` and `faff evidence write review-verdict --terminal-only`
// (FAFF-1277) write graft's other two verdict files in the v0.3 shape through the same cores.
// `faff evidence record-review-round` (FAFF-1268) records each code-review pass as
// `review-rounds/round-<n>.json`, and `faff evidence write review-verdict` collates the recorded
// rounds, with `--park` and `--judge-admitted` for the verdicts no reviewer pass produced.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { validateAgainstSchema, validateAgainstSchemaDetailed } = require("./contract-engine");
const { appendEventRecord, eventViolations, splitPhysicalLines } = require("./events");
const { declaredEffectViolations } = require("./effects");
const { HERE, findRoot, mainWorktreeRoot } = require("./shared-infra");
const { DELIVERY_PROFILE, activeProfile } = require("./governance-profile");
const { REVIEW_DISPOSITIONS, REVIEW_FINDING_SOURCES, REVIEW_SEVERITIES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES } = require("./review-vocab");
const { EvidenceRefusal, collateReviewRounds, parseSpecReviewComment, resolvedRoundIds } = require("./evidence-collate");
const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");
const { assignFindingIds, normaliseFindingPath, normaliseFindingTitle } = require("./finding-id");
const { parseAcId } = require("./ac-id");
const { readLeafNoFollow } = require("./leaf-read");
const crypto = require("node:crypto");

const SPEC_VERSION = "v0.3";
const BUNDLE_DIR = path.resolve(HERE, "..", "contracts", "evidence-v0.3");

const EVIDENCE_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 }, "--require-evidence-schema": { arity: 0 },
  "--run-dir": { arity: 1 }, "--issue": { arity: 1 }, "--terminal-only": { arity: 0 },
  "--candidate-schemas": { arity: 1 }, "--park": { arity: 1 }, "--judge-admitted": { arity: 0 }, "--prior-dir": { arity: 1 }, "--against-ledger": { arity: 0 },
}, positionals: { min: 0, max: null, name: "argument(s)" } };

// Per-line validators for the JSONL files the schema subset cannot fully express. A jsonl
// manifest entry with no validator here is a schema-unavailable error (fail closed).
const LINE_VALIDATORS = {
  "events.jsonl": (rec) => eventViolations(rec, true),
  "declared-effects.jsonl": (rec) => declaredEffectViolations(rec),
};

class SchemaUnavailable extends Error {
  constructor(where) {
    super(`schema-unavailable ${where}`);
    this.where = where;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const tidy = (message) => message.replace(/^<root>: /, "");

function readJsonFile(file, where) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new SchemaUnavailable(where);
  }
}

function loadBundle(bundleDir) {
  const manifest = readJsonFile(path.join(bundleDir, "anchor-manifest.json"), "anchor-manifest.json");
  const manifestSchema = readJsonFile(path.join(bundleDir, "schema", "anchor-manifest.schema.json"), "schema/anchor-manifest.schema.json");
  if (validateAgainstSchema(manifest, manifestSchema).length > 0) throw new SchemaUnavailable("anchor-manifest.json");
  const schemas = new Map();
  for (const entry of Object.values(manifest.files)) {
    if (!schemas.has(entry.schema)) schemas.set(entry.schema, readJsonFile(path.join(bundleDir, entry.schema), entry.schema));
  }
  for (const [anchorPath, entry] of Object.entries(manifest.files)) {
    if (entry.format === "jsonl" && !LINE_VALIDATORS[anchorPath]) throw new SchemaUnavailable(anchorPath);
  }
  return { manifest, schemas };
}

function listFiles(root) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) walk(path.join(dir, dirent.name), rel);
      else if (dirent.isFile()) out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

function parseJson(buf) {
  try {
    return { ok: true, value: JSON.parse(buf.toString("utf8")) };
  } catch {
    return { ok: false };
  }
}

function readBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

function carriesSchemaVersion(file) {
  const bytes = readBytes(file);
  const parsed = bytes ? parseJson(bytes) : { ok: false };
  return parsed.ok && isObject(parsed.value) && "schema_version" in parsed.value;
}

function validateJsonFile(file, schema) {
  const bytes = readBytes(file);
  if (!bytes) return { violations: ["unreadable file"] };
  const parsed = parseJson(bytes);
  if (!parsed.ok) return { violations: ["not valid JSON"] };
  return { violations: validateAgainstSchema(parsed.value, schema).map(tidy) };
}

function validateJsonlFile(file, schema, lineValidator) {
  const bytes = readBytes(file);
  if (!bytes) return { violations: ["unreadable file"] };
  const { lines, lastHasNewline } = splitPhysicalLines(bytes);
  const violations = [];
  let tornTail = false;
  lines.forEach((buf, index) => {
    const n = index + 1;
    const parsed = parseJson(buf);
    if (!parsed.ok) {
      if (index === lines.length - 1 && !lastHasNewline) tornTail = true;
      else violations.push(`line ${n}: not valid JSON`);
      return;
    }
    if (!isObject(parsed.value)) {
      violations.push(`line ${n}: not a JSON object`);
      return;
    }
    const found = [...validateAgainstSchema(parsed.value, schema).map(tidy), ...lineValidator(parsed.value)];
    for (const message of new Set(found)) violations.push(`line ${n}: ${message}`);
  });
  return tornTail ? { violations, torn_tail: true } : { violations };
}

// ---------------------------------------------------------------------------
// Shared document validator (FAFF-1258). The bundled manifest and schemas load once per
// process; a load fault is cached too, so the in-lock callers never retry file I/O.
// ---------------------------------------------------------------------------

let bundleCache = null;

function bundleFor(bundleDir) {
  if (bundleDir !== BUNDLE_DIR) return loadBundle(bundleDir);
  if (!bundleCache) {
    try {
      bundleCache = { bundle: loadBundle(BUNDLE_DIR) };
    } catch (e) {
      if (!(e instanceof SchemaUnavailable)) throw e;
      bundleCache = { unavailable: e.where };
    }
  }
  if (bundleCache.unavailable) throw new SchemaUnavailable(bundleCache.unavailable);
  return bundleCache.bundle;
}

// Warms the cache so no file I/O happens inside a writer's lock. Never throws.
function preloadEvidenceSchemas() {
  try { bundleFor(BUNDLE_DIR); } catch { /* the cached fault surfaces as `unavailable` at validation */ }
}

function resetEvidenceSchemaCache() {
  bundleCache = null;
}

// anchorPath is a manifest key such as "run-ledger.json". Violation messages are exactly the
// strings validateAgainstSchema returns; paths are segment lists from the document root.
function validateEvidenceDocument(anchorPath, doc) {
  let loaded;
  try {
    loaded = bundleFor(BUNDLE_DIR);
  } catch (e) {
    if (e instanceof SchemaUnavailable) return { ok: false, violations: [], unavailable: e.where };
    throw e;
  }
  const entry = loaded.manifest.files[anchorPath];
  const schema = entry && loaded.schemas.get(entry.schema);
  if (!entry || !schema) return { ok: false, violations: [], unavailable: anchorPath };
  const violations = validateAgainstSchemaDetailed(doc, schema);
  return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Log-writer payload check (FAFF-1260). Every writer of events.jsonl and declared-effects.jsonl
// runs this on each minted record inside its append lock. Payload schemas describe the delivery
// profile only, so a $FAFF_GOVERNANCE_PROFILE override skips the check.
// ---------------------------------------------------------------------------

const SCHEMA_UNAVAILABLE_MARKER = "evidence-schema-unavailable.json";
const announcedUnavailable = new Set();

// Takes the resolved profile (default: resolves it) and warms the schema cache; call it before the lock. Returns null
// when no check applies, else a function from a record to { ok, violations, unavailable? } with
// violations as plain message strings. The record is checked as the bytes that land (a key whose
// value is undefined is not written).
function logRecordChecker(anchorPath, profile = activeProfile()) {
  if (profile !== DELIVERY_PROFILE) return null;
  preloadEvidenceSchemas();
  return (record) => {
    const r = validateEvidenceDocument(anchorPath, JSON.parse(JSON.stringify(record)));
    return { ...r, violations: r.violations.map((v) => tidy(v.message)) };
  };
}

// One stderr line per unavailable path per process, whichever writer meets it first.
function announceSchemaUnavailable(where, line = `schema-unavailable ${where}`) {
  if (announcedUnavailable.has(where)) return;
  announcedUnavailable.add(where);
  process.stderr.write(`${line}\n`);
}

// A degraded write: the record went out under the line validator alone. Leaves a run-dir marker
// (first write only, never anchored) and one stderr line per process.
function noteSchemaUnavailable(runDir, writer, where) {
  announceSchemaUnavailable(where);
  const marker = JSON.stringify({ first_at: new Date().toISOString(), writer, path: where }) + "\n";
  try { fs.writeFileSync(path.join(runDir, SCHEMA_UNAVAILABLE_MARKER), marker, { flag: "wx" }); } catch { /* already marked, or no run dir to mark */ }
}

// The top-level data keys the bundled run-event schema allows for one event type, or null when
// the bundle is unavailable or the type has no mapping (the writer's own check then decides).
function eventDataKeys(type) {
  let loaded;
  try { loaded = bundleFor(BUNDLE_DIR); } catch (e) { if (e instanceof SchemaUnavailable) return null; throw e; }
  const entry = loaded.manifest.files["events.jsonl"];
  const schema = entry && loaded.schemas.get(entry.schema);
  const byType = schema && schema.discriminator && schema.discriminator.mapping["2"];
  const mapped = byType && byType.discriminator && Object.hasOwn(byType.discriminator.mapping, type) ? byType.discriminator.mapping[type] : null;
  const data = mapped && mapped.properties && mapped.properties.data;
  return data && data.properties ? Object.keys(data.properties) : null;
}

const stripVersion = (doc) => {
  if (!isObject(doc)) return doc;
  const { schema_version: _ignored, ...rest } = doc;
  return rest;
};

const kindOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

// Minimal differing paths between two documents, as segment lists.
function changedPaths(a, b, segs, out) {
  const ka = kindOf(a);
  if (ka !== kindOf(b)) {
    out.push(segs);
    return out;
  }
  if (ka === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (key in a && key in b) changedPaths(a[key], b[key], [...segs, key], out);
      else out.push([...segs, key]);
    }
  } else if (ka === "array") {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i < a.length && i < b.length) changedPaths(a[i], b[i], [...segs, i], out);
      else out.push([...segs, i]);
    }
  } else if (a !== b) {
    out.push(segs);
  }
  return out;
}

const sameSegs = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);
const isPrefixOf = (a, b) => a.length <= b.length && a.every((s, i) => s === b[i]);

// The violations the current write is answerable for. before/after are in written form (stamped,
// redacted) and are what gets validated; rawBefore/rawAfter are the same documents pre-redaction
// and are what gets diffed. before and rawBefore are null on a mint.
function introducedViolations(anchorPath, before, after, violations, rawBefore, rawAfter) {
  void after;
  if (before === null || before === undefined || rawBefore === null || rawBefore === undefined || kindOf(rawBefore) !== kindOf(rawAfter)) {
    return violations.map((v) => v.message);
  }
  const prior = validateEvidenceDocument(anchorPath, before).violations;
  const changed = changedPaths(stripVersion(rawBefore), stripVersion(rawAfter), [], []);
  return violations
    .filter((v) => !prior.some((p) => p.message === v.message && sameSegs(p.path, v.path))
      || changed.some((c) => isPrefixOf(c, v.path) || isPrefixOf(v.path, c)))
    .map((v) => v.message);
}

// ---------------------------------------------------------------------------
// Additive schema evolution (FAFF-1258). An allowlist: anything not named below is non-additive.
// Reasons name a JSON pointer and a rule, never a data value.
// ---------------------------------------------------------------------------

const ANNOTATION_KEYWORDS = new Set(["description", "title", "$comment", "examples"]);
const SUBSET_KEYWORDS = new Set([
  "$schema", "$id", "type", "required", "properties", "enum", "additionalProperties", "items",
  "minItems", "pattern", "discriminator",
]);

const deepEqual = (a, b) => {
  const ka = kindOf(a);
  if (ka !== kindOf(b)) return false;
  if (ka === "array") return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  if (ka === "object") {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && deepEqual(a[k], b[k]));
  }
  return a === b;
};

const pointerOf = (segs) => segs.map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1")).map((s) => `/${s}`).join("");

const typesOf = (node) => (Array.isArray(node.type) ? node.type : node.type ? [node.type] : []);

// A new optional property's sub-schema must be closed: typed at every node reached through
// properties, items and a schema-valued additionalProperties, every object node closed and every
// array node carrying an items schema.
function closedSubschema(node) {
  if (!isObject(node)) return false;
  if (Object.keys(node).some((k) => !SUBSET_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k))) return false;
  if ("discriminator" in node || typesOf(node).length === 0) return false;
  const types = typesOf(node);
  if (types.includes("array") && !("items" in node)) return false;
  if (types.includes("object")) {
    const extra = node.additionalProperties;
    if (extra !== false && !(isObject(extra) && closedSubschema(extra))) return false;
  }
  if (isObject(node.properties) && !Object.values(node.properties).every(closedSubschema)) return false;
  if ("items" in node && !closedSubschema(node.items)) return false;
  if (isObject(node.additionalProperties) && !closedSubschema(node.additionalProperties)) return false;
  return true;
}

function walkSchemaChange(base, head, segs, reasons) {
  const at = pointerOf(segs) || "/";
  if (!isObject(base) || !isObject(head)) {
    if (!deepEqual(base, head)) reasons.push(`${at}: schema node changed`);
    return;
  }
  for (const key of Object.keys(head)) {
    if (!SUBSET_KEYWORDS.has(key) && !ANNOTATION_KEYWORDS.has(key)) reasons.push(`${at}: keyword "${key}" is outside the supported subset`);
  }
  const keys = new Set([...Object.keys(base), ...Object.keys(head)].filter((k) => !ANNOTATION_KEYWORDS.has(k)));
  for (const key of keys) {
    if (!(key in head)) { reasons.push(`${at}: keyword "${key}" removed`); continue; }
    if (!(key in base)) { reasons.push(`${at}: keyword "${key}" added`); continue; }
    const b = base[key];
    const h = head[key];
    if (key === "properties" && isObject(b) && isObject(h)) {
      for (const name of new Set([...Object.keys(b), ...Object.keys(h)])) {
        const where = [...segs, "properties", name];
        if (name in b && name in h) walkSchemaChange(b[name], h[name], where, reasons);
        else if (name in b) reasons.push(`${pointerOf(where)}: property removed`);
        else if (base.additionalProperties !== false) reasons.push(`${pointerOf(where)}: property added where additionalProperties is not false`);
        else if (Array.isArray(head.required) && head.required.includes(name)) reasons.push(`${pointerOf(where)}: new property is required`);
        else if (!closedSubschema(h[name])) reasons.push(`${pointerOf(where)}: new property is not closed`);
      }
    } else if ((key === "items" || key === "additionalProperties") && isObject(b) && isObject(h)) {
      walkSchemaChange(b, h, [...segs, key], reasons);
    } else if (!deepEqual(b, h)) {
      reasons.push(`${pointerOf([...segs, key])}: ${key} changed`);
    }
  }
}

function classifySchemaChange(base, head) {
  const reasons = [];
  try {
    if (!isObject(head)) return { additive: false, reasons: ["/: head schema is not an object"] };
    walkSchemaChange(base, head, [], reasons);
  } catch {
    return { additive: false, reasons: ["/: schema comparison failed"] };
  }
  return { additive: reasons.length === 0, reasons };
}

const MANIFEST_DIFFERS = { path: "anchor-manifest.json", reasons: ["manifest differs"] };

function insideRealpath(root, file) {
  const real = fs.realpathSync(file);
  return real === root || real.startsWith(root + path.sep) ? real : null;
}

// Resolves which schema each manifest entry is checked against. Candidate faults only fall back
// to the base set; they are listed, never an error.
function resolveSchemaSet(base, candidateDir) {
  const sourceOf = new Map();
  const schemas = new Map(base.schemas);
  const rejected = [];
  for (const entry of Object.values(base.manifest.files)) sourceOf.set(entry.schema, "base");
  if (!candidateDir) return { schemas, sourceOf, rejected };
  let root;
  try {
    root = fs.realpathSync(candidateDir);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "anchor-manifest.json"), "utf8"));
    if (!deepEqual(manifest, base.manifest)) throw new Error("differs");
  } catch {
    rejected.push(MANIFEST_DIFFERS);
    return { schemas, sourceOf, rejected };
  }
  for (const schemaPath of sourceOf.keys()) {
    let head = null;
    try {
      const file = insideRealpath(root, path.join(root, schemaPath));
      if (file) head = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch { head = null; }
    if (head === null) {
      rejected.push({ path: schemaPath, reasons: ["candidate schema unloadable"] });
      continue;
    }
    const verdict = classifySchemaChange(base.schemas.get(schemaPath), head);
    if (verdict.additive) {
      schemas.set(schemaPath, head);
      sourceOf.set(schemaPath, "candidate");
    } else {
      rejected.push({ path: schemaPath, reasons: verdict.reasons });
    }
  }
  return { schemas, sourceOf, rejected };
}

// Pure of side effects beyond reading the anchor directory. Throws SchemaUnavailable when the
// bundled manifest or a schema it names cannot be used.
function validateAnchorDir(anchorDir, opts = {}) {
  const base = loadBundle(opts.bundleDir || BUNDLE_DIR);
  const { manifest } = base;
  const withCandidate = !!opts.candidateDir;
  const { schemas, sourceOf, rejected } = resolveSchemaSet(base, opts.candidateDir);
  const files = listFiles(anchorDir);
  const report = (status, entries) => {
    const out = { status, anchor_dir: anchorDir, spec_version: SPEC_VERSION, files: entries };
    if (withCandidate) out.candidate_rejected = rejected;
    return out;
  };

  const evidenceDocs = files.filter((f) => manifest.files[f] && manifest.files[f].versioned_by === "field");
  if (!evidenceDocs.some((f) => carriesSchemaVersion(path.join(anchorDir, f)))) {
    return report("legacy", files.map((f) => ({ path: f, status: "legacy", violations: [] })));
  }

  const entries = files.map((rel) => {
    const entry = manifest.files[rel];
    if (!entry) return { path: rel, status: "unschemaed", violations: ["no manifest entry for this file"] };
    const file = path.join(anchorDir, rel);
    const schema = schemas.get(entry.schema);
    const result = entry.format === "jsonl" ? validateJsonlFile(file, schema, LINE_VALIDATORS[rel]) : validateJsonFile(file, schema);
    const out = { path: rel, status: result.violations.length === 0 ? "ok" : "fail", violations: result.violations };
    if (withCandidate) out.schema_source = sourceOf.get(entry.schema);
    if (result.torn_tail) out.torn_tail = true;
    return out;
  });
  return report(entries.every((e) => e.status === "ok") ? "pass" : "fail", entries);
}

// --- warn-only observation (FAFF-1263) ---------------------------------------
//
// checkAnchorDir never throws and never prints. It folds validateAnchorDir into a small summary the
// mint, the governance-check leg and `faff evidence-readiness` share, carrying paths, statuses and
// violation counts only: no violation text and no exception message ever leaves this function, so a
// later change to a message cannot leak evidence content into a CI log.

// Anchor file names are PR-authored. Control characters (CR and LF included) become a space and "::"
// becomes ": :", so no rendered line can be read as a GitHub Actions workflow command.
function sanitiseDisplay(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replaceAll("::", ": :");
}

const SCHEMA_UNAVAILABLE_PREFIX = "schema-unavailable";
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$]{0,63}$/;

// The reason an error is reported: the bundled path for a schema-unavailable fault, else the
// exception's class name only, never its message.
function errorReason(e) {
  if (e instanceof SchemaUnavailable) return sanitiseDisplay(`${SCHEMA_UNAVAILABLE_PREFIX} ${e.where}`);
  const name = e && typeof e.name === "string" && SAFE_ERROR_NAME.test(e.name) ? e.name : "Error";
  return name;
}

function schemaUnavailableResultReason(result) {
  if (!isObject(result)) return null;
  const message = [result.message, result.error, result.reason].find((m) => typeof m === "string" && m.startsWith(SCHEMA_UNAVAILABLE_PREFIX));
  if (message === undefined && result.status !== "error") return null;
  return sanitiseDisplay(message === undefined ? SCHEMA_UNAVAILABLE_PREFIX : message.split("\n")[0]);
}

function checkAnchorDir(anchorDir, opts = {}) {
  let report;
  try {
    report = module.exports.validateAnchorDir(anchorDir, opts); // via exports so a test double is honoured
  } catch (e) {
    return { status: "error", files: [], reason: errorReason(e), schema_unavailable: e instanceof SchemaUnavailable };
  }
  const unavailable = schemaUnavailableResultReason(report);
  if (unavailable !== null) return { status: "error", files: [], reason: unavailable, schema_unavailable: true };
  if (!isObject(report) || !["pass", "legacy", "fail"].includes(report.status) || !Array.isArray(report.files)) {
    return { status: "error", files: [], reason: "unrecognised validator result", schema_unavailable: false };
  }
  const files = report.files
    .filter((f) => f.status !== "ok")
    .map((f) => ({ path: sanitiseDisplay(f.path), status: f.status, violations: Array.isArray(f.violations) ? f.violations.length : 0 }));
  return { status: report.status, files, reason: null, schema_unavailable: false };
}

// The file paths the bundled manifest names; throws SchemaUnavailable when the manifest cannot be used.
function manifestFileNames(opts = {}) {
  return Object.keys(loadBundle(opts.bundleDir || BUNDLE_DIR).manifest.files);
}

function exitCodeFor(report, requireEvidenceSchema) {
  if (report.status === "pass") return 0;
  if (report.status === "legacy") return requireEvidenceSchema ? 1 : 0;
  return 1;
}

function renderHuman(report) {
  const out = [`evidence validate ${report.anchor_dir}: ${report.status}`];
  for (const f of report.files) {
    if (f.status === "ok") continue;
    out.push(`  ${f.path}: ${f.status}${f.torn_tail ? " (torn tail skipped)" : ""}`);
    f.violations.slice(0, 5).forEach((v) => out.push(`    - ${v}`));
    if (f.violations.length > 5) out.push(`    (+${f.violations.length - 5} more)`);
  }
  return out.join("\n") + "\n";
}

// --- writers ----------------------------------------------------------------

class WriterFault extends Error {}

const ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);

function realpathOrNull(p) {
  try { return fs.realpathSync(p); } catch { return null; }
}

// guardWriterPaths(runDir, issue) -> the real per-issue directory the writer may write into. Throws
// WriterFault (exit 2) before anything is read or written: the issue id must be a bare token, the run
// dir must resolve inside <root>/.faff/runs/ for the working checkout or its main checkout (graft runs
// in a linked worktree whose run dir may sit in either), and the issue directory must stay inside it.
function guardWriterPaths(runDir, issue) {
  if (typeof issue !== "string" || !ISSUE_ID_RE.test(issue) || issue.includes("..")) throw new WriterFault("--issue is not a valid issue id");
  if (typeof runDir !== "string" || runDir === "") throw new WriterFault("--run-dir is required");
  const realRunDir = realpathOrNull(runDir);
  if (realRunDir === null || !fs.statSync(realRunDir).isDirectory()) throw new WriterFault("--run-dir is not a directory");
  const root = findRoot();
  const roots = [root];
  const main = mainWorktreeRoot(root);
  if (main && path.resolve(main) !== path.resolve(root)) roots.push(main);
  const runsDirs = roots.map((r) => realpathOrNull(path.join(r, ".faff", "runs"))).filter((d) => d !== null);
  if (!runsDirs.some((d) => realRunDir !== d && within(d, realRunDir))) throw new WriterFault("--run-dir is not inside .faff/runs/");
  const issueDir = path.join(realRunDir, issue);
  const realIssueDir = realpathOrNull(issueDir);
  if (realIssueDir !== null && (realIssueDir === realRunDir || !within(realRunDir, realIssueDir))) throw new WriterFault("the issue directory resolves outside --run-dir");
  return issueDir;
}

// writeEvidenceFile(issueDir, name, document) writes the document as two-space JSON with a trailing
// newline, through a temp file in the same directory and a rename, so a reader never sees a torn file.
function writeEvidenceFile(issueDir, name, document) {
  fs.mkdirSync(issueDir, { recursive: true });
  const target = path.join(issueDir, name);
  const temp = path.join(issueDir, `.${name}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(temp, JSON.stringify(document, null, 2) + "\n");
    fs.renameSync(temp, target);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw new WriterFault(`cannot write ${name}: ${e.code || "io error"}`);
  }
  return target;
}

const nullable = (v) => (typeof v === "string" ? v : null);

// anchoredSpecReview(collated) -> the v1 anchored document: every documented key present, null when
// absent, unknown keys dropped, keys in schema order.
function anchoredSpecReview(collated) {
  return {
    schema_version: 1,
    verdict: collated.verdict,
    final_verdict: collated.final_verdict,
    rounds_total: collated.rounds_total,
    objections: collated.objections.map((o) => ({
      lens: o.lens,
      severity: o.severity,
      claim: nullable(o.claim),
      evidence: nullable(o.evidence),
      predicted_consequence: nullable(o.predicted_consequence),
      spec_anchor: nullable(o.spec_anchor),
      disposition: nullable(o.disposition),
      refutation: nullable(o.refutation),
      disposition_rationale: nullable(o.disposition_rationale),
      first_round: o.first_round,
      last_round: o.last_round,
      occurrences: o.occurrences.map((occ) => ({ round: occ.round, severity: occ.severity, claim: nullable(occ.claim), spec_anchor: nullable(occ.spec_anchor) })),
    })),
  };
}

function specReviewWriterViolations(doc) {
  const out = [];
  if ((doc.verdict === "approve") !== (doc.objections.length === 0)) out.push("verdict: approve exactly when objections is empty");
  doc.objections.forEach((o, i) => {
    const at = `objections[${i}]`;
    if (!SPEC_REVIEW_LENSES.includes(o.lens)) out.push(`${at}.lens: not in the lens enum`);
    if (!SPEC_REVIEW_SEVERITIES.includes(o.severity)) out.push(`${at}.severity: not in the severity enum`);
    if (o.disposition !== null && !REVIEW_DISPOSITIONS.includes(o.disposition)) out.push(`${at}.disposition: not in the disposition enum`);
    if (!(o.first_round >= 1 && o.first_round <= o.last_round && o.last_round <= doc.rounds_total)) out.push(`${at}: needs 1 <= first_round <= last_round <= rounds_total`);
    o.occurrences.forEach((occ, j) => {
      if (!(occ.round >= o.first_round && occ.round <= o.last_round)) out.push(`${at}.occurrences[${j}].round: outside first_round..last_round`);
    });
  });
  return out;
}

function schemaFor(name) {
  const { schemas, manifest } = loadBundle(BUNDLE_DIR);
  return schemas.get(manifest.files[name].schema);
}

// writeSpecReviewVerdict(runDir, issue, text, secrets) -> { written } | { refused: [message] }.
// Throws WriterFault (exit 2) on a path or IO fault. Nothing is written unless every check passes.
function writeSpecReviewVerdict(runDir, issue, text, secrets) {
  const issueDir = guardWriterPaths(runDir, issue);
  let collated;
  try { collated = parseSpecReviewComment(text); } catch (e) {
    if (e instanceof EvidenceRefusal) return { refused: [e.message] };
    throw e;
  }
  const doc = anchoredSpecReview(redactKnownSecrets(collated, secrets));
  const violations = [...validateAgainstSchema(doc, schemaFor("spec-review-verdict.json")).map(tidy), ...specReviewWriterViolations(doc)];
  if (violations.length > 0) return { refused: violations };
  return { written: writeEvidenceFile(issueDir, "spec-review-verdict.json", doc) };
}

// parseStdinObject(text) -> the parsed object, or null. A parse failure is never echoed: the JSON
// parser's message quotes the input, and the input may hold a secret.
function parseStdinObject(text) {
  try {
    const value = JSON.parse(text);
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

const NOT_AN_OBJECT = "stdin: expected one JSON object";
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
const orNull = (v) => (v === undefined ? null : v);

// anchoredAcChecklist(input) -> the v1 document: schema_version stamped, unknown keys dropped,
// `criteria` present only when the input carries it; each criterion carries `ac_id` and
// `verifications`, null when the input omits them.
function anchoredAcChecklist(input) {
  const doc = { schema_version: 1, all_verified: input.all_verified };
  if ("criteria" in input) {
    doc.criteria = Array.isArray(input.criteria)
      ? input.criteria.map((c) => (isObject(c) ? { ...pick(c, ["ac", "verified", "passed"]), ac_id: orNull(c.ac_id), verifications: orNull(c.verifications) } : c))
      : input.criteria;
  }
  return doc;
}

const isOneLine = (v) => typeof v === "string" && !/[\r\n]/.test(v);

// Names the rule a verification method breaks, never the locator itself: the locator may hold a secret.
function verificationViolation(method) {
  if (!isObject(method)) return null;
  const { kind, locator } = method;
  if (kind === "human") return locator === undefined ? null : "a human method carries no locator";
  if (kind === "command") return isOneLine(locator) && locator.trim() !== "" ? null : "a command locator must be a non-empty single line";
  if (kind !== "test") return null;
  if (!isOneLine(locator)) return "a test locator must be a single line <file>::<test title>";
  const split = locator.indexOf("::");
  if (split === -1) return "a test locator must be <file>::<test title>";
  const file = locator.slice(0, split);
  if (file === "" || file.startsWith("/") || file.includes("\\") || file.split("/").includes("..")) return "a test locator file must be a repo-relative path with forward slashes and no .. segment";
  return locator.slice(split + 2).trim() === "" ? "a test locator needs a non-empty test title" : null;
}

function acIdViolations(criteria, issue) {
  const ids = criteria.map((c) => (isObject(c) && typeof c.ac_id === "string" ? c.ac_id : null));
  const present = ids.filter((id) => id !== null);
  if (present.length === 0) return [];
  const out = [];
  if (present.length !== ids.length) out.push("ac_id: every criterion carries one, or none does");
  if (present.some((id) => { const parsed = parseAcId(id); return parsed !== null && parsed.ticket.toLowerCase() !== String(issue).toLowerCase(); })) out.push("ac_id: ticket part must match --issue");
  if (new Set(present).size !== present.length) out.push("ac_id: duplicate");
  return out;
}

function acChecklistWriterViolations(doc, issue) {
  if (!("criteria" in doc)) return [];
  if (!Array.isArray(doc.criteria) || doc.criteria.length === 0) return ["criteria: omit the key for a zero-AC issue, never [] or null"];
  const out = [];
  const everyPassed = doc.criteria.every((c) => isObject(c) && c.passed === true);
  if (doc.all_verified !== everyPassed) out.push("all_verified: must equal every criterion passed");
  out.push(...acIdViolations(doc.criteria, issue));
  doc.criteria.forEach((c, i) => {
    if (!isObject(c)) return;
    if ((typeof c.ac === "string" && !isOneLine(c.ac)) || (typeof c.verified === "string" && !isOneLine(c.verified))) out.push(`criteria[${i}]: ac and verified must be one line`);
    if (!Array.isArray(c.verifications)) return;
    c.verifications.forEach((m, j) => {
      const broken = verificationViolation(m);
      if (broken !== null) out.push(`criteria[${i}].verifications[${j}]: ${broken}`);
    });
  });
  return out;
}

// writeAcChecklist(runDir, issue, text, secrets) -> { written } | { refused: [message] }.
function writeAcChecklist(runDir, issue, text, secrets) {
  const issueDir = guardWriterPaths(runDir, issue);
  const input = parseStdinObject(text);
  if (input === null) return { refused: [NOT_AN_OBJECT] };
  const doc = anchoredAcChecklist(redactKnownSecrets(input, secrets));
  const violations = [...validateAgainstSchema(doc, schemaFor("ac-checklist.json")).map(tidy), ...acChecklistWriterViolations(doc, issue)];
  if (violations.length > 0) return { refused: violations };
  return { written: writeEvidenceFile(issueDir, "ac-checklist.json", doc) };
}

// codeSpan(text) -> text in a Markdown code span whose fence outruns any backtick run inside it.
function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function renderCriterion(c) {
  const id = typeof c.ac_id === "string" ? ` ${codeSpan(c.ac_id)}` : "";
  const lines = [`- [${c.passed ? "x" : " "}]${id} ${c.ac}`, `  Verified: ${c.verified}`];
  for (const m of c.verifications || []) lines.push(m.kind === "human" ? "  Method: human" : `  Method: ${m.kind} ${codeSpan(m.locator)}`);
  return lines;
}

// renderAcChecklist(runDir, issue) -> { block } | { refused: [message] }. Reads the written anchor and
// applies the writer's own checks, so the PR-body list always matches a well-formed anchor.
function renderAcChecklist(runDir, issue) {
  const file = path.join(guardWriterPaths(runDir, issue), "ac-checklist.json");
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    return { refused: [e && e.code === "ENOENT" ? "ac-checklist.json is missing" : "ac-checklist.json is unreadable"] };
  }
  const violations = [...validateAgainstSchema(doc, schemaFor("ac-checklist.json")).map(tidy)];
  if (violations.length === 0) violations.push(...acChecklistWriterViolations(doc, issue));
  if (violations.length > 0) return { refused: violations };
  const body = doc.criteria ? doc.criteria.flatMap(renderCriterion) : ["No acceptance criteria."];
  return { block: ["## Acceptance Criteria", ...body].join("\n") + "\n" };
}

const TERMINAL_ONLY_WRITER = "faff evidence write review-verdict --terminal-only";

// anchoredTerminalReview(block) -> the v1 document for a review whose earlier rounds were not
// recorded: one round, every finding raised and settled in it, every documented key present.
function anchoredTerminalReview(block) {
  const findings = Array.isArray(block.findings) ? block.findings : block.findings === undefined ? [] : block.findings;
  const doc = { schema_version: 1, signal: block.signal };
  if (block.adversarial_outcome !== undefined) doc.adversarial_outcome = block.adversarial_outcome;
  doc.rounds_total = 1;
  doc.round_history = "terminal-only";
  if (!Array.isArray(findings)) return { ...doc, findings };
  const ids = assignFindingIds(findings, 1);
  doc.findings = findings.map((raw, i) => {
    const f = isObject(raw) ? raw : {};
    const title = nullable(f.title);
    const location = nullable(f.location);
    const severity = orNull(f.severity);
    const disposition = orNull(f.disposition);
    return {
      finding_id: ids[i],
      title,
      location,
      action: nullable(f.action),
      location_present: !!f.location_present,
      action_present: !!f.action_present,
      severity,
      source: orNull(f.source),
      model: orNull(f.model),
      disposition,
      refutation: orNull(f.refutation),
      disposition_rationale: orNull(f.disposition_rationale),
      first_round: 1,
      last_round: 1,
      occurrences: [{ round: 1, title, location, severity, disposition }],
    };
  });
  return doc;
}

function terminalReviewRefusal(issueDir, block) {
  if (block.signal === "unavailable") return "signal: unavailable is not a reviewer verdict; the outage park writes through --park unavailable";
  let rounds;
  try { rounds = fs.readdirSync(path.join(issueDir, "review-rounds")).filter((f) => /^round-.*\.json$/.test(f)); } catch (e) {
    rounds = e && e.code === "ENOENT" ? [] : ["unreadable"];
  }
  if (rounds.length > 0) return "review-rounds/: round records exist, so a terminal-only verdict would hide them";
  if (Array.isArray(block.findings) && block.findings.some((f) => !isObject(f))) return "findings: every finding must be a JSON object";
  return null;
}

// writeTerminalReviewVerdict(runDir, issue, text, secrets) -> { written } | { refused: [message] }.
// The evidence-terminal-only event is appended before the file lands, so a written file always has
// its trace; an append failure throws WriterFault (exit 2) with nothing written.
function writeTerminalReviewVerdict(runDir, issue, text, secrets) {
  const issueDir = guardWriterPaths(runDir, issue);
  const block = parseStdinObject(text);
  if (block === null) return { refused: [NOT_AN_OBJECT] };
  const refusal = terminalReviewRefusal(issueDir, block);
  if (refusal !== null) return { refused: [refusal] };
  const doc = anchoredTerminalReview(redactKnownSecrets(block, secrets));
  const violations = validateAgainstSchema(doc, schemaFor("review-verdict.json")).map(tidy);
  if (violations.length > 0) return { refused: violations };
  const realRunDir = path.dirname(issueDir);
  if (!fs.existsSync(path.join(realRunDir, "events.jsonl"))) throw new WriterFault("--run-dir has no events.jsonl to record the evidence-terminal-only event in");
  try {
    appendEventRecord(realRunDir, path.basename(realRunDir), { phase: "build", type: "evidence-terminal-only", issue, data: { issue, writer: TERMINAL_ONLY_WRITER } });
  } catch {
    throw new WriterFault("cannot append the evidence-terminal-only event; nothing written");
  }
  try {
    return { written: writeEvidenceFile(issueDir, "review-verdict.json", doc) };
  } catch (e) {
    throw e instanceof WriterFault ? new WriterFault(`${e.message}; the evidence-terminal-only event was already recorded`) : e;
  }
}

// --- code-review round records and their collation (FAFF-1268) ---------------

const ROUND_FILE_RE = /^round-([1-9]\d*)\.json$/;
const ROUND_SCHEMA = "schema/review-round.schema.json";
const ROUND_SIGNALS = ["pass", "fail", "needs-human"];
const PARK_SIGNALS = ["needs-human", "unavailable"];
const HANDLE_RE = /^P([1-9]\d*)$/;

// A recorded round that cannot be read or fails its schema. The recorder treats it as a run-dir
// fault (exit 2), the verdict writer as a refusal (exit 1); both name the file, never a value.
class RoundRecordFault extends Error {}

// The round schema is not an anchor-manifest entry, so it is loaded by path, not through schemaFor.
let roundSchemaCache = null;
function roundSchema() {
  if (!roundSchemaCache) roundSchemaCache = readJsonFile(path.join(BUNDLE_DIR, ROUND_SCHEMA), ROUND_SCHEMA);
  return roundSchemaCache;
}

// listRoundFiles(dir) -> [{ n, name, file }] ascending by n; a missing directory has none.
function listRoundFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (e) {
    if (e && e.code === "ENOENT") return [];
    throw new WriterFault(`cannot list ${path.basename(dir)}/: ${(e && e.code) || "io error"}`);
  }
  return names
    .map((name) => { const m = name.match(ROUND_FILE_RE); return m ? { n: Number(m[1]), name, file: path.join(dir, name) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

// readRecordedRounds(issueDir) -> every review-rounds/round-<n>.json, ascending, each re-validated.
function readRecordedRounds(issueDir) {
  return listRoundFiles(path.join(issueDir, "review-rounds")).map(({ n, name, file }) => {
    const where = `review-rounds/${name}`;
    let rec;
    try { rec = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new RoundRecordFault(`${where}: unreadable or not valid JSON`); }
    const violations = validateAgainstSchema(rec, roundSchema()).map(tidy);
    if (violations.length > 0) throw new RoundRecordFault(`${where}: ${violations[0]}`);
    if (rec.round !== n) throw new RoundRecordFault(`${where}: round does not match the file name`);
    return rec;
  });
}

function enumOrNull(value, allowed, where, warnings) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && allowed.includes(value)) return value;
  warnings.push(`${where}: not in the enum; written as null`);
  return null;
}

function carriedOrNull(value, where, warnings) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    warnings.push(`${where}: not a string; written as null`);
    return null;
  }
  return value.trim() || null;
}

// priorDirFindings(priorDir, issueDir, secrets) -> the findings of the highest round record in the
// --prior-dir, in record order (the order `faff review-prior` numbers them), or null when it has none.
// A --prior-dir that does not exist yet (a resume into a fresh run dir) has none.
function priorDirFindings(priorDir, issueDir, secrets) {
  if (!fs.existsSync(priorDir)) return null;
  const realIssueDir = realpathOrNull(issueDir);
  const real = realpathOrNull(priorDir);
  if (realIssueDir === null || real === null || real === realIssueDir || !within(realIssueDir, real)) throw new WriterFault("--prior-dir is not inside the issue directory");
  const files = listRoundFiles(real);
  if (files.length === 0) return null;
  const last = files[files.length - 1];
  let rec;
  try { rec = JSON.parse(fs.readFileSync(last.file, "utf8")); } catch { throw new WriterFault(`--prior-dir ${last.name} is unreadable or not valid JSON`); }
  return redactKnownSecrets(isObject(rec) && Array.isArray(rec.findings) ? rec.findings : [], secrets);
}

// translateHandle(carried, src, previous, where, warnings) -> the review-rounds/ handle naming the same
// finding a --prior-dir handle names, matched on exact normalised file and title, else null.
function translateHandle(carried, src, previous, where, warnings) {
  if (src === null) {
    warnings.push(`${where}: --prior-dir has no round record; written as null`);
    return null;
  }
  const m = carried.match(HANDLE_RE);
  const j = m ? Number(m[1]) : 0;
  if (!j || j > src.length) {
    warnings.push(`${where}: not a handle in the --prior-dir round; written as null`);
    return null;
  }
  const f = isObject(src[j - 1]) ? src[j - 1] : {};
  const file = normaliseFindingPath(f.location);
  const title = normaliseFindingTitle(f.title);
  const candidates = previous ? previous.findings : [];
  const hits = file && title
    ? candidates.flatMap((g, i) => (normaliseFindingPath(g.location) === file && normaliseFindingTitle(g.title) === title ? [i] : []))
    : [];
  if (hits.length !== 1) {
    warnings.push(`${where}: no single matching finding in the previous review-rounds record; written as null`);
    return null;
  }
  return `P${hits[0] + 1}`;
}

// roundFinding(f, at, carried, warnings) -> one finding in review-round key order, finding_id unset.
function roundFinding(f, at, carried, warnings) {
  return {
    finding_id: null,
    carried_id: carried,
    title: orNull(f.title),
    location: orNull(f.location),
    action: orNull(f.action),
    location_present: !!f.location_present,
    action_present: !!f.action_present,
    severity: enumOrNull(f.severity, REVIEW_SEVERITIES, `${at}.severity`, warnings),
    source: enumOrNull(f.source, REVIEW_FINDING_SOURCES, `${at}.source`, warnings),
    model: orNull(f.model),
    disposition: enumOrNull(f.disposition, REVIEW_DISPOSITIONS, `${at}.disposition`, warnings),
    refutation: orNull(f.refutation),
    disposition_rationale: orNull(f.disposition_rationale),
  };
}

// writeExclusive(dir, name, document) -> path. Links a complete temp file to the target, so the
// round number is claimed exactly once and a reader never sees a torn file.
function writeExclusive(dir, name, document) {
  const target = path.join(dir, name);
  const temp = path.join(dir, `.${name}.tmp-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(document, null, 2) + "\n");
    fs.linkSync(temp, target);
  } catch (e) {
    throw new WriterFault(e && e.code === "EEXIST" ? `${name} already exists; another pass recorded that round` : `cannot write ${name}: ${(e && e.code) || "io error"}`);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return target;
}

// recordReviewRound(runDir, issue, text, secrets, priorDir) -> { written, warnings } | { refused }.
// Throws WriterFault (exit 2) on a path, IO or existing-round fault. Nothing is written unless every
// check passes. A supplied finding_id is ignored: resolveRoundChain decides every id.
function recordReviewRound(runDir, issue, text, secrets, priorDir) {
  const issueDir = guardWriterPaths(runDir, issue);
  const input = parseStdinObject(text);
  if (input === null) return { refused: [NOT_AN_OBJECT] };
  if (!ROUND_SIGNALS.includes(input.signal)) return { refused: ["signal: must be pass, fail or needs-human; an unavailable pass records no round"] };
  if (!Array.isArray(input.findings) || !input.findings.every(isObject)) return { refused: ["findings: must be an array of objects"] };
  const block = redactKnownSecrets(input, secrets);
  let existing;
  try { existing = readRecordedRounds(issueDir); } catch (e) {
    if (e instanceof RoundRecordFault) throw new WriterFault(e.message);
    throw e;
  }
  const previous = existing.length > 0 ? existing[existing.length - 1] : null;
  const n = previous ? previous.round + 1 : 1;
  const warnings = [];
  let src;
  const findings = block.findings.map((f, i) => {
    const at = `findings[${i}]`;
    let carried = carriedOrNull(f.carried_id, `${at}.carried_id`, warnings);
    if (carried !== null && priorDir != null) {
      if (src === undefined) src = priorDirFindings(priorDir, issueDir, secrets);
      carried = translateHandle(carried, src, previous, `${at}.carried_id`, warnings);
    }
    return roundFinding(f, at, carried, warnings);
  });
  const adversarialOutcome = enumOrNull(block.adversarial_outcome, ["chain-outage-skipped"], "adversarial_outcome", warnings);
  const doc = { schema_version: 1, round: n, signal: block.signal, adversarial_outcome: adversarialOutcome, findings };
  const ids = resolvedRoundIds([...existing, doc]).pop();
  findings.forEach((f, i) => { f.finding_id = ids[i]; });
  const violations = validateAgainstSchema(doc, roundSchema()).map(tidy);
  if (violations.length > 0) return { refused: violations };
  return { written: writeExclusive(path.join(issueDir, "review-rounds"), `round-${n}.json`, doc), warnings };
}

function judgeAdmitRefusal(issueDir) {
  const rel = "build-review/judge/admit-result.json";
  const real = realpathOrNull(path.join(issueDir, rel));
  if (real === null) return `${rel} is missing`;
  const realIssueDir = realpathOrNull(issueDir);
  if (realIssueDir === null || !within(realIssueDir, real)) throw new WriterFault(`${rel} resolves outside the issue directory`);
  let result;
  try { result = JSON.parse(fs.readFileSync(real, "utf8")); } catch { return `${rel} is unreadable or not valid JSON`; }
  return isObject(result) && result.admit === true ? null : `${rel} does not record admit: true`;
}

function collatedReviewViolations(doc, highestRound) {
  const out = [];
  if (!(doc.rounds_total >= 0)) out.push("rounds_total: must be at least 0");
  doc.findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!(f.first_round >= 1 && f.first_round <= f.last_round && f.last_round <= highestRound)) out.push(`${at}: needs 1 <= first_round <= last_round <= the highest round`);
    f.occurrences.forEach((o, j) => {
      if (!(o.round >= f.first_round && o.round <= f.last_round)) out.push(`${at}.occurrences[${j}].round: outside first_round..last_round`);
    });
  });
  return out;
}

// writeCollatedReviewVerdict(runDir, issue, secrets, mode) -> { written } | { refused: [message] }.
// mode: { park: "needs-human" | "unavailable" } | { judgeAdmitted: true } | {} (the default).
function writeCollatedReviewVerdict(runDir, issue, secrets, mode) {
  const issueDir = guardWriterPaths(runDir, issue);
  let rounds;
  try { rounds = redactKnownSecrets(readRecordedRounds(issueDir), secrets); } catch (e) {
    if (e instanceof RoundRecordFault) return { refused: [e.message] };
    throw e;
  }
  const terminal = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const park = mode.park !== undefined;
  let signal;
  if (park) {
    signal = mode.park;
  } else if (terminal === null) {
    return { refused: [mode.judgeAdmitted ? "no review rounds recorded; a judge admit needs the reviewer pass it overturned" : "no review rounds recorded; use --park or --terminal-only"] };
  } else if (mode.judgeAdmitted) {
    const refusal = judgeAdmitRefusal(issueDir);
    if (refusal !== null) return { refused: [refusal] };
    signal = "pass";
  } else if (terminal.signal === "fail") {
    return { refused: ["terminal round is fail; the review loop has not finished"] };
  } else {
    signal = terminal.signal;
  }
  const doc = { schema_version: 1, signal };
  if (terminal !== null && terminal.adversarial_outcome === "chain-outage-skipped") doc.adversarial_outcome = terminal.adversarial_outcome;
  if (mode.judgeAdmitted) doc.admitted_by = "build-judge";
  doc.rounds_total = rounds.length;
  doc.round_history = "recorded";
  doc.findings = collateReviewRounds(rounds, signal, park);
  const violations = [
    ...validateAgainstSchema(doc, schemaFor("review-verdict.json")).map(tidy),
    ...collatedReviewViolations(doc, terminal === null ? 0 : terminal.round),
  ];
  if (violations.length > 0) return { refused: violations };
  return { written: writeEvidenceFile(issueDir, "review-verdict.json", doc) };
}

const WRITERS = {
  "spec-review-verdict": writeSpecReviewVerdict,
  "ac-checklist": writeAcChecklist,
  "review-verdict": writeTerminalReviewVerdict,
};

// reviewVerdictMode(values) -> { mode } | { usage: message }. --park, --judge-admitted and
// --terminal-only are mutually exclusive; with none, the recorded rounds are collated.
function reviewVerdictMode(values) {
  const chosen = ["--park", "--judge-admitted", "--terminal-only"].filter((flag) => values[flag] != null && values[flag] !== false);
  if (chosen.length > 1) return { usage: `${chosen.join(" and ")} cannot be combined` };
  if (values["--park"] != null) {
    return PARK_SIGNALS.includes(values["--park"]) ? { mode: { park: values["--park"] } } : { usage: `--park takes one of: ${PARK_SIGNALS.join(", ")}` };
  }
  if (values["--terminal-only"]) return { mode: { terminalOnly: true } };
  return { mode: values["--judge-admitted"] ? { judgeAdmitted: true } : {} };
}

// runWriter(label, values, write) -> exit code. Guards the paths and resolves the redaction secrets
// before write(secrets) reads or writes anything.
function runWriter(label, values, write) {
  const fail = (code, message) => { process.stderr.write(`${label}: ${message}\n`); return code; };
  if (values["--run-dir"] == null || values["--issue"] == null) return fail(2, "--run-dir and --issue are required");
  try {
    guardWriterPaths(values["--run-dir"], values["--issue"]);
    let secrets;
    try { secrets = resolveKnownSecretValues(findRoot()); } catch { return fail(2, "the redaction config could not be read; nothing written"); }
    const result = write(secrets);
    for (const message of result.warnings || []) process.stderr.write(`${label}: warning: ${message}\n`);
    if (result.refused) {
      for (const message of result.refused) process.stderr.write(`${label}: refused: ${message}\n`);
      return 1;
    }
    process.stdout.write(`${result.written}\n`);
    return 0;
  } catch (e) {
    if (e instanceof WriterFault || e instanceof SchemaUnavailable) return fail(2, e.message);
    throw e;
  }
}

const readStdin = () => fs.readFileSync(0, "utf8");

function cmdEvidenceWrite(values, name) {
  const label = `faff evidence write ${name}`;
  const fail = (code, message) => { process.stderr.write(`${label}: ${message}\n`); return code; };
  if (!Object.hasOwn(WRITERS, name)) return fail(2, `expected one of: ${Object.keys(WRITERS).join(", ")}`);
  if (values["--prior-dir"] != null) return fail(2, "--prior-dir applies to record-review-round only");
  if (name !== "review-verdict") {
    const flag = ["--terminal-only", "--park", "--judge-admitted"].find((f) => values[f] != null && values[f] !== false);
    if (flag) return fail(2, `${flag} applies to review-verdict only`);
    return runWriter(label, values, (secrets) => WRITERS[name](values["--run-dir"], values["--issue"], readStdin(), secrets));
  }
  const { mode, usage } = reviewVerdictMode(values);
  if (usage) return fail(2, usage);
  if (mode.terminalOnly) return runWriter(label, values, (secrets) => writeTerminalReviewVerdict(values["--run-dir"], values["--issue"], readStdin(), secrets));
  return runWriter(label, values, (secrets) => writeCollatedReviewVerdict(values["--run-dir"], values["--issue"], secrets, mode));
}

function cmdRecordReviewRound(values) {
  const label = "faff evidence record-review-round";
  const flag = ["--terminal-only", "--park", "--judge-admitted"].find((f) => values[f] != null && values[f] !== false);
  if (flag) {
    process.stderr.write(`${label}: ${flag} applies to write review-verdict only\n`);
    return 2;
  }
  return runWriter(label, values, (secrets) => recordReviewRound(values["--run-dir"], values["--issue"], readStdin(), secrets, values["--prior-dir"]));
}

function cmdEvidenceRender(values, name) {
  const fail = (code, message) => { process.stderr.write(`faff evidence render ${name}: ${message}\n`); return code; };
  if (name !== "ac-checklist") return fail(2, "expected: ac-checklist");
  if (values["--run-dir"] == null || values["--issue"] == null) return fail(2, "--run-dir and --issue are required");
  try {
    const result = renderAcChecklist(values["--run-dir"], values["--issue"]);
    if (result.refused) {
      for (const message of result.refused) process.stderr.write(`faff evidence render ${name}: refused: ${message}\n`);
      return 1;
    }
    process.stdout.write(result.block);
    return 0;
  } catch (e) {
    if (e instanceof WriterFault || e instanceof SchemaUnavailable) return fail(2, e.message);
    throw e;
  }
}

// --- return by digest (FAFF-1397) -------------------------------------------
//
// `faff evidence return` (lane side) prints the per-file leaf sha256 of the two per-issue evidence files;
// `faff evidence verify-return` (dispatcher side) re-hashes them and compares. Both are read-only: they
// write no file, so they add no member to the Class A writer roster and can be re-run before the merge
// locus. The hash is a leaf sha256 of the file's bytes; nothing here compares file bodies.

const EVIDENCE_FILES = [
  { key: "ac_checklist", name: "ac-checklist.json", shaKey: "ac_sha256" },
  { key: "review_verdict", name: "review-verdict.json", shaKey: "review_verdict_sha256" },
];
const HEX64_RE = /^[0-9a-f]{64}$/;
const NO_DIGEST = { present: false, sha256: null };

// One no-follow descriptor read per evidence file (FAFF-1400): presence, regular-ness and the bytes all come
// from the same open, so a swap after any earlier look cannot redirect the hash. Returns
// { kind, sha256 } where sha256 is the leaf sha256 of the bytes (the digest `faff integrity-digest hash`
// reports) iff kind is "regular". In-process, because the governance region may not require the
// factory-region integrity-digest module. A read fault is exit 2, never a verdict.
function readEvidenceLeaf(abs) {
  let leaf;
  try { leaf = readLeafNoFollow(abs); } catch (e) { throw new WriterFault(`cannot hash ${path.basename(abs)}: ${e.code || e.message}`); }
  return { kind: leaf.kind, sha256: leaf.kind === "regular" ? crypto.createHash("sha256").update(leaf.bytes).digest("hex") : null };
}

// Leaf sha256 of a file that must be regular (the selftest fixtures).
function hashRegularFile(abs) {
  const leaf = readEvidenceLeaf(abs);
  if (leaf.kind !== "regular") throw new WriterFault(`${path.basename(abs)} is not a regular file`);
  return leaf.sha256;
}

function evidenceReturn(runDir, issue) {
  const issueDir = guardWriterPaths(runDir, issue);
  const out = { issue };
  for (const { key, name } of EVIDENCE_FILES) {
    const leaf = readEvidenceLeaf(path.join(issueDir, name));
    if (leaf.kind === "absent") { out[key] = { ...NO_DIGEST }; continue; }
    if (leaf.kind !== "regular") throw new WriterFault(`${name} is not a regular file`);
    out[key] = { present: true, sha256: leaf.sha256 };
  }
  return out;
}

const hasExactKeys = (o, keys) => isObject(o) && Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));

function wellFormedReturn(p, issue) {
  if (!hasExactKeys(p, ["issue", "ac_checklist", "review_verdict"]) || p.issue !== issue) return false;
  return EVIDENCE_FILES.every(({ key }) => {
    const d = p[key];
    if (!hasExactKeys(d, ["present", "sha256"]) || typeof d.present !== "boolean") return false;
    return d.present ? typeof d.sha256 === "string" && HEX64_RE.test(d.sha256) : d.sha256 === null;
  });
}

// The claim to verify against: { noClaim, returned } where returned maps each key to an EvidenceDigest.
function claimFromLedger(issueDir, issue) {
  const ledgerPath = path.join(path.dirname(issueDir), "run-ledger.json");
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch (e) {
    throw new WriterFault(`run-ledger.json is missing or does not parse (${e.code || "parse error"})`);
  }
  if (!isObject(ledger) || (ledger.evidence_persisted !== undefined && !Array.isArray(ledger.evidence_persisted))) throw new WriterFault("run-ledger.json is not a ledger object");
  const entry = [...(ledger.evidence_persisted || [])].reverse().find((e) => isObject(e) && e.issue === issue);
  if (!entry) return { noClaim: true, returned: { ac_checklist: { ...NO_DIGEST }, review_verdict: { ...NO_DIGEST } } };
  const returned = {};
  for (const { key, shaKey } of EVIDENCE_FILES) {
    if (entry[shaKey] === undefined) { returned[key] = { ...NO_DIGEST }; continue; }
    if (typeof entry[shaKey] !== "string" || !HEX64_RE.test(entry[shaKey])) throw new WriterFault(`run-ledger.json evidence_persisted entry for ${issue} has a malformed ${shaKey}`);
    returned[key] = { present: true, sha256: entry[shaKey] };
  }
  return { noClaim: false, returned };
}

function claimFromStdin(text, issue) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { malformed: true }; }
  if (parsed === null) return { noClaim: true, returned: { ac_checklist: { ...NO_DIGEST }, review_verdict: { ...NO_DIGEST } } };
  if (!wellFormedReturn(parsed, issue)) return { malformed: true };
  return { noClaim: false, returned: parsed };
}

const RESULT_CAUSE = {
  "presence-disagreement": "presence disagreement",
  "hash-mismatch": "returned copy ≠ on-disk copy",
  "not-regular-file": "on-disk copy is not a regular file",
  "no-claim": "no digest returned for a file on disk",
};

function verifyReturn(issueDir, issue, claim) {
  const base = { issue, files: [], evidence_persisted: null, park_cause: null, paths: [], tampered_paths: [] };
  if (claim.malformed) {
    return { verdict: "malformed", ...base, park_cause: `evidence-return malformed — ${issue}/EvidenceReturn (malformed return)`, paths: EVIDENCE_FILES.map((f) => `${issue}/${f.name}`) };
  }
  const files = [];
  const entry = { issue };
  for (const { key, name, shaKey } of EVIDENCE_FILES) {
    const r = claim.returned[key];
    const abs = path.join(issueDir, name);
    const leaf = readEvidenceLeaf(abs);
    const diskPresent = leaf.kind !== "absent";
    const row = { file: name, returned_present: r.present, disk_present: diskPresent, returned_sha256: r.sha256, disk_sha256: null, result: null };
    if (diskPresent && leaf.kind !== "regular") row.result = "not-regular-file";
    else if (claim.noClaim && diskPresent) row.result = "no-claim";
    else if (r.present !== diskPresent) row.result = "presence-disagreement";
    else if (!diskPresent) row.result = "absent-both";
    else {
      row.disk_sha256 = leaf.sha256;
      row.result = row.disk_sha256 === r.sha256 ? "match" : "hash-mismatch";
      if (row.result === "match") entry[shaKey] = row.disk_sha256;
    }
    files.push(row);
  }
  const failing = files.filter((f) => f.result !== "match" && f.result !== "absent-both");
  if (failing.length === 0) {
    return { verdict: "agree", ...base, files, evidence_persisted: Object.keys(entry).length > 1 ? entry : null };
  }
  const first = failing[0];
  const label = first.result === "no-claim" ? "missing" : "mismatch";
  const rel = (f) => `${issue}/${f.file}`;
  return {
    verdict: "mismatch", ...base, files,
    park_cause: `evidence-return ${label} — ${rel(first)} (${RESULT_CAUSE[first.result]})`,
    paths: failing.map(rel),
    tampered_paths: failing.filter((f) => f.result !== "no-claim").map(rel),
  };
}

function evidenceVerbFail(label, code, message) {
  process.stderr.write(`${label}: ${message}\n`);
  return code;
}

// Flags that belong to other `faff evidence` verbs; the return-by-digest verbs refuse them like their siblings do.
const FOREIGN_RETURN_FLAGS = ["--park", "--judge-admitted", "--terminal-only", "--prior-dir"];
const foreignReturnFlag = (values) => FOREIGN_RETURN_FLAGS.find((f) => values[f] != null && values[f] !== false);

function cmdEvidenceReturn(values) {
  const label = "faff evidence return";
  if (values["--run-dir"] == null || values["--issue"] == null) return evidenceVerbFail(label, 2, "--run-dir and --issue are required");
  if (values["--against-ledger"]) return evidenceVerbFail(label, 2, "--against-ledger applies to verify-return only");
  const foreign = foreignReturnFlag(values);
  if (foreign) return evidenceVerbFail(label, 2, `${foreign} does not apply to evidence return`);
  try {
    process.stdout.write(JSON.stringify(evidenceReturn(values["--run-dir"], values["--issue"])) + "\n");
    return 0;
  } catch (e) {
    if (e instanceof WriterFault) return evidenceVerbFail(label, 2, e.message);
    throw e;
  }
}

function cmdEvidenceVerifyReturn(values) {
  const label = "faff evidence verify-return";
  if (values["--run-dir"] == null || values["--issue"] == null) return evidenceVerbFail(label, 2, "--run-dir and --issue are required");
  const foreign = foreignReturnFlag(values);
  if (foreign) return evidenceVerbFail(label, 2, `${foreign} does not apply to evidence verify-return`);
  try {
    const issue = values["--issue"];
    const issueDir = guardWriterPaths(values["--run-dir"], issue);
    let claim;
    if (values["--against-ledger"]) claim = claimFromLedger(issueDir, issue);
    else {
      if (process.stdin.isTTY) return evidenceVerbFail(label, 2, "expects the EvidenceReturn JSON (or null) on stdin; nothing was piped");
      claim = claimFromStdin(readStdin(), issue);
    }
    const verdict = verifyReturn(issueDir, issue, claim);
    process.stdout.write(JSON.stringify(verdict) + "\n");
    return verdict.verdict === "agree" ? 0 : 1;
  } catch (e) {
    if (e instanceof WriterFault) return evidenceVerbFail(label, 2, e.message);
    throw e;
  }
}

// --- selftest ---------------------------------------------------------------

function exampleSchemaName(file) {
  return file.replace(/\.invalid\.example\.json$/, "").replace(/\.example\.json$/, "").replace(/\.schema-\d+$/, "");
}

function evidenceSelftest() {
  const os = require("node:os");
  const failures = [];
  const check = (label, ok) => { if (!ok) failures.push(label); };
  const { manifest } = loadBundle(BUNDLE_DIR);
  const exampleDir = path.join(BUNDLE_DIR, "schema", "examples");

  // FAFF-1260: per-type payload examples sit in subdirectories mirroring schema/events|effects|commissaire.
  for (const file of listFiles(exampleDir)) {
    const invalid = file.endsWith(".invalid.example.json");
    const schemaRel = path.join(path.dirname(file), `${exampleSchemaName(path.basename(file))}.schema.json`);
    const schema = readJsonFile(path.join(BUNDLE_DIR, "schema", schemaRel), file);
    const errs = validateAgainstSchema(readJsonFile(path.join(exampleDir, file), file), schema);
    check(`${file} ${invalid ? "fails" : "passes"} its schema`, invalid ? errs.length > 0 : errs.length === 0);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-evidence-selftest-"));
  const example = (name) => fs.readFileSync(path.join(exampleDir, `${name}.example.json`), "utf8");
  const oneLine = (name) => JSON.stringify(JSON.parse(example(name))) + "\n";
  const build = (label, files) => {
    const dir = path.join(tmp, label);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };
  const stamped = { "run-ledger.json": example("run-ledger"), "events.jsonl": oneLine("run-event"), "declared-effects.jsonl": oneLine("declared-effect") };
  const statusOf = (dir) => validateAnchorDir(dir).status;
  try {
    check("the manifest names twelve files", Object.keys(manifest.files).length === 12);
    check("a stamped anchor passes", statusOf(build("pass", stamped)) === "pass");
    check("an anchor with no stamped document is legacy", statusOf(build("legacy", { "events.jsonl": oneLine("run-event"), "stray.txt": "x" })) === "legacy");
    check("an unmanifested file fails a stamped anchor", statusOf(build("unschemaed", { ...stamped, "stray.txt": "x" })) === "fail");
    check("an extra property fails", statusOf(build("extra", { ...stamped, "events.jsonl": JSON.stringify({ ...JSON.parse(oneLine("run-event")), extra: 1 }) + "\n" })) === "fail");
    const torn = validateAnchorDir(build("torn", { ...stamped, "events.jsonl": oneLine("run-event") + '{"sch' }));
    check("a torn tail is skipped and reported", torn.status === "pass" && torn.files.find((f) => f.path === "events.jsonl").torn_tail === true);
    check("a mid-file unparseable line fails", statusOf(build("mid", { ...stamped, "events.jsonl": "not json\n" + oneLine("run-event") })) === "fail");
    const ac = anchoredAcChecklist({ all_verified: true, criteria: [{ ac: "a", verified: "Verified: t", passed: true, extra: 1 }], ac_complete: true });
    check("the ac-checklist writer's document passes its schema", validateAgainstSchema(ac, schemaFor("ac-checklist.json")).length === 0);
    check("the ac-checklist writer refuses an empty criteria list", acChecklistWriterViolations(anchoredAcChecklist({ all_verified: true, criteria: [] }), "FAFF-1").length === 1);
    const review = anchoredTerminalReview({ signal: "pass", adversarial_outcome: "chain-outage-skipped", findings: [{ title: "x", location: "a.js:1", severity: "minor" }] });
    check("the terminal-only review writer's document passes its schema", validateAgainstSchema(review, schemaFor("review-verdict.json")).length === 0);
    // FAFF-1397: return-by-digest agrees on untouched files and reports a hash mismatch after a change.
    const issueDir = build("return", { "ac-checklist.json": "<unknown> -> &\n", "review-verdict.json": "{}\n" });
    const digests = { issue: "ISSUE-1" };
    for (const { key, name } of EVIDENCE_FILES) digests[key] = { present: true, sha256: hashRegularFile(path.join(issueDir, name)) };
    check("return-by-digest agrees on untouched files", verifyReturn(issueDir, "ISSUE-1", claimFromStdin(JSON.stringify(digests), "ISSUE-1")).verdict === "agree");
    fs.appendFileSync(path.join(issueDir, "ac-checklist.json"), "x");
    const changed = verifyReturn(issueDir, "ISSUE-1", claimFromStdin(JSON.stringify(digests), "ISSUE-1"));
    check("return-by-digest reports a hash mismatch after a change", changed.verdict === "mismatch" && changed.files[0].result === "hash-mismatch" && changed.tampered_paths.length === 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failures.length) {
    process.stderr.write(`evidence selftest FAILED:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write("evidence selftest: OK\n");
  return 0;
}

// What this CLI's `evidence validate` can do. CI reads it from a base commit's CLI, because an unknown
// flag exits 2 just as schema-unavailable does, so probing flags could not tell the two apart.
const CAPABILITIES = { validate: ["require-evidence-schema", "candidate-schemas"] };

const USAGE = "usage: faff evidence validate <anchor-dir> [--require-evidence-schema] [--json] [--candidate-schemas <dir>]\n       faff evidence capabilities --json\n       faff evidence write spec-review-verdict --run-dir <dir> --issue <id>   (comment or spec text on stdin)\n       faff evidence write ac-checklist --run-dir <dir> --issue <id>   ({all_verified, criteria?: [{ac, verified, passed, ac_id?, verifications?}]} on stdin)\n       faff evidence render ac-checklist --run-dir <dir> --issue <id>   (prints the PR-body Acceptance Criteria block)\n       faff evidence record-review-round --run-dir <dir> --issue <id> [--prior-dir <dir>]   (one review-verdict block on stdin)\n       faff evidence write review-verdict --run-dir <dir> --issue <id> [--park needs-human|unavailable | --judge-admitted]   (collates review-rounds/)\n       faff evidence write review-verdict --terminal-only --run-dir <dir> --issue <id>   (terminal review-verdict block on stdin; manual recovery)\n       faff evidence return --run-dir <dir> --issue <id>   (prints the EvidenceReturn digest line for a dispatched lane to return)\n       faff evidence verify-return [--against-ledger] --run-dir <dir> --issue <id>   (verifies the returned digests on stdin, or the ledger entry, against the files on disk)\n       faff evidence --selftest\n";

function cmdEvidence(args) {
  const parsed = parseArgs(args, EVIDENCE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, USAGE.trim());
  const values = parsed.values;
  try {
    if (values["--selftest"] && parsed.positionals.length === 0) return evidenceSelftest();
    const [sub, anchorDir, ...rest] = parsed.positionals;
    if (sub === "capabilities" && !anchorDir) {
      process.stdout.write(JSON.stringify(CAPABILITIES) + "\n");
      return 0;
    }
    if (sub === "write" && anchorDir && rest.length === 0) return cmdEvidenceWrite(values, anchorDir);
    if (sub === "record-review-round" && !anchorDir) return cmdRecordReviewRound(values);
    if (sub === "return" && !anchorDir) return cmdEvidenceReturn(values);
    if (sub === "verify-return" && !anchorDir) return cmdEvidenceVerifyReturn(values);
    if (sub === "render" && anchorDir && rest.length === 0) return cmdEvidenceRender(values, anchorDir);
    if (sub !== "validate" || !anchorDir || rest.length > 0) {
      process.stderr.write(USAGE);
      return 2;
    }
    if (!fs.existsSync(anchorDir) || !fs.statSync(anchorDir).isDirectory()) {
      process.stderr.write(`evidence validate: ${anchorDir} is not a directory\n`);
      return 2;
    }
    const report = validateAnchorDir(anchorDir, { candidateDir: values["--candidate-schemas"] });
    process.stdout.write(values["--json"] ? JSON.stringify(report) + "\n" : renderHuman(report));
    return exitCodeFor(report, !!values["--require-evidence-schema"]);
  } catch (e) {
    if (e instanceof SchemaUnavailable) {
      process.stderr.write(`evidence validate: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

module.exports = {
  CAPABILITIES, EVIDENCE_SPEC, SCHEMA_UNAVAILABLE_MARKER, SchemaUnavailable, WriterFault, acChecklistWriterViolations, announceSchemaUnavailable, anchoredAcChecklist,
  anchoredTerminalReview, checkAnchorDir, classifySchemaChange, cmdEvidence, eventDataKeys, evidenceSelftest, exitCodeFor,
  recordReviewRound, writeCollatedReviewVerdict,
  guardWriterPaths, introducedViolations, logRecordChecker, manifestFileNames, noteSchemaUnavailable, preloadEvidenceSchemas,
  renderAcChecklist, resetEvidenceSchemaCache, sanitiseDisplay, validateAnchorDir, validateEvidenceDocument, writeAcChecklist, writeEvidenceFile,
  writeSpecReviewVerdict, writeTerminalReviewVerdict,
};
