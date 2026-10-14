// ===========================================================================
// === region:governance — evidence — FAFF-1256: read-only anchor validation against the v0.3 evidence schemas. ===
//
// `faff evidence validate <anchor-dir>` reports pass, fail or legacy for one per-PR anchor
// directory. It reads the BUNDLED copy of verification/evidence/v0.3/ (contracts/evidence-v0.3),
// never the anchor's or the working checkout's verification/ directory: in an adopter run
// the working checkout belongs to the party being audited. Nothing here refuses a mint, fails a
// governance-check leg or changes merge-gate routing; slices 5 and 6 of FAFF-1255 call
// validateAnchorDir for that.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { validateAgainstSchema } = require("./contract-engine");
const { eventViolations, splitPhysicalLines } = require("./events");
const { declaredEffectViolations } = require("./effects");
const { HERE } = require("./shared-infra");

const SPEC_VERSION = "v0.3";
const BUNDLE_DIR = path.resolve(HERE, "..", "contracts", "evidence-v0.3");

const EVIDENCE_SPEC = { flags: {
  "--json": { arity: 0 }, "--selftest": { arity: 0 }, "--require-evidence-schema": { arity: 0 },
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

function carriesSchemaVersion(file) {
  const parsed = parseJson(fs.readFileSync(file));
  return parsed.ok && isObject(parsed.value) && "schema_version" in parsed.value;
}

function validateJsonFile(file, schema) {
  const parsed = parseJson(fs.readFileSync(file));
  if (!parsed.ok) return { violations: ["not valid JSON"] };
  return { violations: validateAgainstSchema(parsed.value, schema).map(tidy) };
}

function validateJsonlFile(file, schema, lineValidator) {
  const { lines, lastHasNewline } = splitPhysicalLines(fs.readFileSync(file));
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

// Pure of side effects beyond reading the anchor directory. Throws SchemaUnavailable when the
// bundled manifest or a schema it names cannot be used.
function validateAnchorDir(anchorDir, opts = {}) {
  const { manifest, schemas } = loadBundle(opts.bundleDir || BUNDLE_DIR);
  const files = listFiles(anchorDir);
  const report = (status, entries) => ({ status, anchor_dir: anchorDir, spec_version: SPEC_VERSION, files: entries });

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
    check("every manifest entry has a bundled schema", Object.keys(manifest.files).length === 12);
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

const USAGE = "usage: faff evidence validate <anchor-dir> [--require-evidence-schema] [--json]\n       faff evidence --selftest\n";

function cmdEvidence(args) {
  const parsed = parseArgs(args, EVIDENCE_SPEC);
  if (parsed.errors.length) return usageError(parsed.errors, USAGE.trim());
  const values = parsed.values;
  try {
    if (values["--selftest"]) return evidenceSelftest();
    const [sub, anchorDir, ...rest] = parsed.positionals;
    if (sub !== "validate" || !anchorDir || rest.length > 0) {
      process.stderr.write(USAGE);
      return 2;
    }
    if (!fs.existsSync(anchorDir) || !fs.statSync(anchorDir).isDirectory()) {
      process.stderr.write(`evidence validate: ${anchorDir} is not a directory\n`);
      return 2;
    }
    const report = validateAnchorDir(anchorDir);
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

module.exports = { EVIDENCE_SPEC, SchemaUnavailable, cmdEvidence, evidenceSelftest, exitCodeFor, validateAnchorDir };
