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
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { validateAgainstSchema, validateAgainstSchemaDetailed } = require("./contract-engine");
const { eventViolations, splitPhysicalLines } = require("./events");
const { declaredEffectViolations } = require("./effects");
const { HERE, findRoot, mainWorktreeRoot } = require("./shared-infra");
const { REVIEW_DISPOSITIONS, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES } = require("./review-vocab");
const { EvidenceRefusal, parseSpecReviewComment } = require("./evidence-collate");
const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");

const SPEC_VERSION = "v0.3";
const BUNDLE_DIR = path.resolve(HERE, "..", "contracts", "evidence-v0.3");

const EVIDENCE_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 }, "--require-evidence-schema": { arity: 0 },
  "--run-dir": { arity: 1 }, "--issue": { arity: 1 },
  "--candidate-schemas": { arity: 1 },
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
// properties, items and a schema-valued additionalProperties, and every object node closed.
function closedSubschema(node) {
  if (!isObject(node)) return false;
  if (Object.keys(node).some((k) => !SUBSET_KEYWORDS.has(k) && !ANNOTATION_KEYWORDS.has(k))) return false;
  if ("discriminator" in node || typesOf(node).length === 0) return false;
  const types = typesOf(node);
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
  const { schemas, manifest } = loadBundle(BUNDLE_DIR);
  const schema = schemas.get(manifest.files["spec-review-verdict.json"].schema);
  const violations = [...validateAgainstSchema(doc, schema).map(tidy), ...specReviewWriterViolations(doc)];
  if (violations.length > 0) return { refused: violations };
  return { written: writeEvidenceFile(issueDir, "spec-review-verdict.json", doc) };
}

function cmdEvidenceWrite(values, name) {
  const fail = (code, message) => { process.stderr.write(`faff evidence write ${name}: ${message}\n`); return code; };
  if (name !== "spec-review-verdict") return fail(2, "expected: spec-review-verdict");
  if (values["--run-dir"] == null || values["--issue"] == null) return fail(2, "--run-dir and --issue are required");
  try {
    guardWriterPaths(values["--run-dir"], values["--issue"]);
    let secrets;
    try { secrets = resolveKnownSecretValues(findRoot()); } catch { return fail(2, "the redaction config could not be read; nothing written"); }
    const result = writeSpecReviewVerdict(values["--run-dir"], values["--issue"], fs.readFileSync(0, "utf8"), secrets);
    if (result.refused) {
      for (const message of result.refused) process.stderr.write(`faff evidence write ${name}: refused: ${message}\n`);
      return 1;
    }
    process.stdout.write(`${result.written}\n`);
    return 0;
  } catch (e) {
    if (e instanceof WriterFault || e instanceof SchemaUnavailable) return fail(2, e.message);
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

  for (const file of fs.readdirSync(exampleDir).sort()) {
    const invalid = file.endsWith(".invalid.example.json");
    const schema = readJsonFile(path.join(BUNDLE_DIR, "schema", `${exampleSchemaName(file)}.schema.json`), file);
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

const USAGE = "usage: faff evidence validate <anchor-dir> [--require-evidence-schema] [--json] [--candidate-schemas <dir>]\n       faff evidence write spec-review-verdict --run-dir <dir> --issue <id>   (comment or spec text on stdin)\n       faff evidence --selftest\n";

function cmdEvidence(args) {
  const parsed = parseArgs(args, EVIDENCE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, USAGE.trim());
  const values = parsed.values;
  try {
    if (values["--selftest"] && parsed.positionals.length === 0) return evidenceSelftest();
    const [sub, anchorDir, ...rest] = parsed.positionals;
    if (sub === "write" && anchorDir && rest.length === 0) return cmdEvidenceWrite(values, anchorDir);
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
  EVIDENCE_SPEC, SchemaUnavailable, WriterFault, classifySchemaChange, cmdEvidence, evidenceSelftest, exitCodeFor,
  guardWriterPaths, introducedViolations, preloadEvidenceSchemas, resetEvidenceSchemaCache, validateAnchorDir,
  validateEvidenceDocument, writeEvidenceFile, writeSpecReviewVerdict,
};
