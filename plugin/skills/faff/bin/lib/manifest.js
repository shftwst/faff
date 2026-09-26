// ===========================================================================
// === region:factory — manifest — FAFF-1103: Tier-1 binding manifest schema + validator ===
//   manifest validate [--file PATH]   validate a binding manifest (stdin or --file): 0 valid / 1 invalid / 2 malformed
//
// The Tier-1 binding manifest is the declarative descriptor a project commits so the
// code-blind holdout (FAFF-1104 adapter, over the FAFF-1102 wire) can drive a plain
// code interface with no project bridge code. Its security-critical property is that
// it names real symbols only: no field can carry a body, a script, an expression, a
// canned return value, or a mock. validateManifest proves that structurally.
//
// Descriptor class, not contract class (see records/specs/…faff-1103…): the manifest
// is human/project-authored, so it is validated by this bespoke verb, mirroring
// `faff profile validate` — NOT registered in CONTRACTS and NOT reachable via
// `faff contract`. The names-only identifier grammar lives here in JS because the
// schema-subset validator (contract-engine.js) has no `pattern`.
// ===========================================================================

const fs = require("node:fs");
const { parseArgs, usageError } = require("./argv");

const MANIFEST_SPEC = { flags: { "--selftest": { arity: 0 }, "--file": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const MANIFEST_SURFACE = {
  kind: "subcommand_dispatch",
  spec: MANIFEST_SPEC,
  subcommands: {
    validate: { required_flags: [] },
  },
};

// The exact fence a stored/handed manifest may carry, mirroring infra-profile's form.
const MANIFEST_FENCE_OPEN = "```faff-contract:tier1-binding-manifest";
const MANIFEST_FENCE_CLOSE = "```";

// Names-only grammar. A single-segment bare identifier (runtime, binding name, instance
// op); a dotted path of such segments (entry, factory, static op). Anything carrying a
// `(`, `;`, whitespace, `=`, or any other non-identifier character — i.e. anything that
// could form an expression or statement — fails.
const BARE_ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTTED_PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
function isBareId(s) { return typeof s === "string" && BARE_ID_RE.test(s); }
function isDottedPath(s) { return typeof s === "string" && DOTTED_PATH_RE.test(s); }
function isNonNegInt(n) { return Number.isInteger(n) && n >= 0; }

// Declared field sets — the key-allowlist floor of the names-only guarantee. Any key
// outside a record's set is a violation, so a smuggled `returns`/`body`/`script`/
// `mock`/`expr` field is rejected as unknown at every nesting level.
const MANIFEST_KEYS = new Set(["schema", "runtime", "bindings"]);
const BINDING_KEYS = new Set(["name", "entry", "construction", "instance_ops", "static_ops"]);
const CONSTRUCTION_KEYS = new Set(["kind", "factory", "arity"]);
const OPDECL_KEYS = new Set(["op", "arity"]);
const ARITY_KEYS = new Set(["required", "optional", "types"]);
const CONSTRUCTION_KINDS = new Set(["ctor", "factory"]);
const TYPE_HINTS = new Set(["string", "number", "integer", "boolean", "object", "array", "null", "any"]);

function isPlainObject(o) { return o !== null && typeof o === "object" && !Array.isArray(o); }

function checkKeys(o, allowed, pathLabel, v) {
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) v.push(`${pathLabel}: unknown field '${k}' — the manifest carries names only`);
  }
}

function validateArity(a, pathLabel, v) {
  if (!isPlainObject(a)) { v.push(`${pathLabel} must be an object`); return; }
  checkKeys(a, ARITY_KEYS, pathLabel, v);
  if (!isNonNegInt(a.required)) v.push(`${pathLabel}.required must be an integer >= 0`);
  if (a.optional !== undefined && !isNonNegInt(a.optional)) v.push(`${pathLabel}.optional must be an integer >= 0`);
  if (a.types !== undefined) {
    if (!Array.isArray(a.types)) { v.push(`${pathLabel}.types must be an array of type hints`); }
    else a.types.forEach((t, k) => { if (!TYPE_HINTS.has(t)) v.push(`${pathLabel}.types[${k}] '${t}' is not a valid type hint`); });
  }
}

function validateOp(op, pathLabel, dotted, v) {
  if (!isPlainObject(op)) { v.push(`${pathLabel} must be an object`); return; }
  checkKeys(op, OPDECL_KEYS, pathLabel, v);
  const ok = dotted ? isDottedPath(op.op) : isBareId(op.op);
  if (!ok) v.push(`${pathLabel}.op must be a ${dotted ? "bare-identifier-or-dotted-path" : "single-segment bare-identifier"} symbol`);
  validateArity(op.arity, `${pathLabel}.arity`, v);
}

// Pure validator over a parsed manifest object (no I/O). Returns a violations array;
// empty means valid. A non-object top level is a violation (→ exit 1), matching
// validateProfile — exit 2 is reserved for a JSON PARSE failure, caught before this runs.
function validateManifest(obj) {
  if (!isPlainObject(obj)) return ["manifest must be a JSON object"];
  const v = [];
  checkKeys(obj, MANIFEST_KEYS, "manifest", v);

  if (obj.schema !== 1) v.push("schema must be 1");
  if (!isBareId(obj.runtime)) v.push("runtime must be a non-empty bare identifier");

  if (!Array.isArray(obj.bindings) || obj.bindings.length === 0) {
    v.push("bindings must be a non-empty array");
    return v;
  }

  const names = [];
  obj.bindings.forEach((b, i) => {
    const bp = `bindings[${i}]`;
    if (!isPlainObject(b)) { v.push(`${bp} must be an object`); return; }
    checkKeys(b, BINDING_KEYS, bp, v);

    if (!isBareId(b.name)) v.push(`${bp}.name must be a single-segment bare identifier`);
    else names.push(b.name);
    if (!isDottedPath(b.entry)) v.push(`${bp}.entry must be a bare-identifier-or-dotted-path symbol`);

    if (b.instance_ops !== undefined && !Array.isArray(b.instance_ops)) v.push(`${bp}.instance_ops must be an array`);
    if (b.static_ops !== undefined && !Array.isArray(b.static_ops)) v.push(`${bp}.static_ops must be an array`);
    const hasInstance = Array.isArray(b.instance_ops) && b.instance_ops.length > 0;
    const hasStatic = Array.isArray(b.static_ops) && b.static_ops.length > 0;
    if (!hasInstance && !hasStatic) v.push(`${bp} must declare at least one non-empty of instance_ops or static_ops`);
    if (b.instance_ops !== undefined && b.construction === undefined) v.push(`${bp}: instance_ops present requires construction`);

    if (b.construction !== undefined) {
      const c = b.construction;
      const cp = `${bp}.construction`;
      if (!isPlainObject(c)) { v.push(`${cp} must be an object`); }
      else {
        checkKeys(c, CONSTRUCTION_KEYS, cp, v);
        if (!CONSTRUCTION_KINDS.has(c.kind)) v.push(`${cp}.kind must be one of ctor, factory`);
        if (c.kind === "factory" && !isDottedPath(c.factory)) v.push(`${cp}.factory must be a bare-identifier-or-dotted-path symbol when kind is factory`);
        if (c.kind === "ctor" && c.factory !== undefined) v.push(`${cp}: factory must not be present when kind is ctor`);
        validateArity(c.arity, `${cp}.arity`, v);
      }
    }

    if (Array.isArray(b.instance_ops)) b.instance_ops.forEach((op, j) => validateOp(op, `${bp}.instance_ops[${j}]`, false, v));
    if (Array.isArray(b.static_ops)) b.static_ops.forEach((op, j) => validateOp(op, `${bp}.static_ops[${j}]`, true, v));
  });

  const seen = new Set();
  const dup = new Set();
  for (const n of names) { if (seen.has(n)) dup.add(n); else seen.add(n); }
  for (const n of dup) v.push(`duplicate binding name '${n}' — names must be unique across bindings`);

  return v;
}

// Fence-tolerant manifest-input parser, mirroring parseProfileInput: strips at most one
// leading `faff-contract:tier1-binding-manifest` fence, else parses raw JSON. Throws
// exactly as JSON.parse does on unparseable input, so the caller maps that to exit 2.
function parseManifestInput(raw) {
  const trimmed = String(raw).replace(/^\s+/, "");
  if (trimmed.startsWith(MANIFEST_FENCE_OPEN)) {
    const afterOpen = trimmed.slice(MANIFEST_FENCE_OPEN.length);
    const closeIdx = afterOpen.lastIndexOf(MANIFEST_FENCE_CLOSE);
    const body = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
    return JSON.parse(body);
  }
  return JSON.parse(raw);
}

function cmdManifest(args) {
  // FAFF-576-style fail-closed flag gate — unknown flag / missing value exits 2 here.
  const gate = parseArgs(args, MANIFEST_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff manifest validate [--file F]");
  const rest = args.slice();
  const cmd = rest[0];

  if (cmd === "--selftest" || rest.includes("--selftest")) return manifestSelftest();

  if (cmd === "validate") {
    let raw;
    const fi = rest.indexOf("--file");
    try {
      raw = fs.readFileSync(fi !== -1 ? rest[fi + 1] : 0, "utf8");
    } catch {
      process.stderr.write("faff manifest validate: cannot read input (no --file PATH and no stdin)\n");
      return 2;
    }
    let obj;
    try { obj = parseManifestInput(raw); }
    catch { process.stderr.write("faff manifest validate: malformed manifest input (invalid JSON)\n"); return 2; }
    const violations = validateManifest(obj);
    if (violations.length) {
      for (const x of violations) process.stderr.write(`- ${x}\n`);
      return 1;
    }
    console.log("OK — tier-1 binding manifest valid (schema 1).");
    return 0;
  }

  process.stderr.write("faff manifest: expected validate (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure validator core (mirrors profile --selftest style).
function manifestSelftest() {
  const valid = {
    schema: 1, runtime: "python",
    bindings: [{
      name: "Stack", entry: "demo.Stack",
      construction: { kind: "ctor", arity: { required: 0 } },
      instance_ops: [
        { op: "push", arity: { required: 1, types: ["any"] } },
        { op: "pop", arity: { required: 0 } },
      ],
      static_ops: [{ op: "demo.util.drain", arity: { required: 0, optional: 1, types: ["integer"] } }],
    }],
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const smuggled = clone(valid);
  smuggled.bindings[0].instance_ops[1].returns = "[1,2,3]";   // a canned return value

  const nonIdentOp = clone(valid);
  nonIdentOp.bindings[0].instance_ops[1].op = "pop();import os";

  const instanceNoCtor = {
    schema: 1, runtime: "python",
    bindings: [{ name: "Stack", entry: "demo.Stack", instance_ops: [{ op: "push", arity: { required: 1 } }] }],
  };

  const cases = [
    [valid, 0, "conformant names-only manifest"],
    [smuggled, 1, "smuggled 'returns' field (canned value)"],
    [nonIdentOp, 1, "non-identifier instance op"],
    [instanceNoCtor, 1, "instance op without construction"],
    [[], 1, "valid-JSON non-object (array)"],
  ];
  let failed = 0;
  for (const [obj, wantViol, label] of cases) {
    const got = validateManifest(obj).length > 0 ? 1 : 0;
    if (got !== wantViol) { process.stderr.write(`manifest --selftest FAIL: ${label} (want ${wantViol}, got ${got})\n`); failed++; }
  }

  const check = (label, cond) => { if (!cond) { process.stderr.write(`manifest --selftest FAIL: ${label}\n`); failed++; } };

  // A valid-JSON non-object yields exactly the object-shape violation.
  check("non-object top level yields the object-shape violation",
    JSON.stringify(validateManifest([])) === JSON.stringify(["manifest must be a JSON object"]));

  // parseManifestInput — fenced input parses identically to raw; a parse failure throws
  // (the exit-2 malformed case), covering both fenced and non-fenced bodies.
  const rawJson = JSON.stringify(valid);
  const fenced = MANIFEST_FENCE_OPEN + "\n" + rawJson + "\n" + MANIFEST_FENCE_CLOSE + "\n";
  let fromRaw, fromFenced;
  try { fromRaw = parseManifestInput(rawJson); } catch { fromRaw = undefined; }
  try { fromFenced = parseManifestInput(fenced); } catch { fromFenced = undefined; }
  check("parseManifestInput: raw form parses", fromRaw !== undefined && JSON.stringify(fromRaw) === rawJson);
  check("parseManifestInput: fenced form parses to the same object as raw", fromFenced !== undefined && JSON.stringify(fromFenced) === rawJson);
  let malformedThrew = false;
  try { parseManifestInput("{ not json"); } catch { malformedThrew = true; }
  check("parseManifestInput: malformed (non-fenced) input throws (exit-2 path)", malformedThrew);
  let malformedFencedThrew = false;
  try { parseManifestInput(MANIFEST_FENCE_OPEN + "\n{ not json\n" + MANIFEST_FENCE_CLOSE + "\n"); } catch { malformedFencedThrew = true; }
  check("parseManifestInput: malformed fenced body throws", malformedFencedThrew);

  if (failed) return 1;
  console.log("manifest --selftest: ok");
  return 0;
}

module.exports = {
  MANIFEST_FENCE_CLOSE, MANIFEST_FENCE_OPEN, MANIFEST_SPEC, MANIFEST_SURFACE,
  cmdManifest, manifestSelftest, parseManifestInput, validateManifest,
};
