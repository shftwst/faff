// ===========================================================================
// === region:factory — fixtures — FAFF-31: dataset-manifest schema + `faff fixtures` CLI (slice 1 of 2) ===
//   fixtures validate [--file PATH]   validate a manifest JSON (stdin or --file): 0 valid / 1 invalid / 2 malformed
//   fixtures show                     print the effective manifest (.faff/fixtures/manifest.json ⊕ .faffrc.yaml fixtures:); exit 3 when none
//   fixtures realise [--file PATH] [--out DIR]   trivial reference generator — deterministically realise a dataset from (manifest, seed)
// The MANIFEST is the load-bearing contract FAFF-34 consumes; the generation STRATEGY is a
// separate `fixtures` slot (deferred slice). Mirrors `faff profile` (FAFF-26): schema + merge
// live here, not in skill prose. Storage-split + conflict-authority per docs/adr/0013.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("./config");
const { parseArgs, usageError } = require("./argv");
const FIXTURES_SPEC = { flags: { "--selftest": { arity: 0 }, "--root": { arity: 1 }, "--file": { arity: 1 }, "--out": { arity: 1 } }, positionals: { min: 0, max: null, name: "verb" } };
const { dig, findRoot } = require("./shared-infra");

const FIELD_TYPES = new Set(["string", "int", "bool", "timestamp", "uuid"]);

// Pure validator over a parsed manifest object. The manifest is the fixed, reproducible
// description of a synthetic dataset: a target schema, a determinism seed, per-entity volumes.
// A sparse-but-complete manifest (required fields, no volumes) is valid.
function validateFixtures(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return ["manifest must be a JSON object"];
  }
  const v = [];
  if (obj.schema !== 1) v.push("schema must be 1");
  for (const k of ["schema", "authored_at", "authored_by", "seed", "target_schema"]) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") v.push(`missing required field: ${k}`);
  }
  const entityNames = new Set();
  const ts = obj.target_schema;
  if (ts !== undefined && ts !== null) {
    if (typeof ts !== "object" || Array.isArray(ts)) {
      v.push("target_schema must be an object");
    } else if (!Array.isArray(ts.entities) || ts.entities.length === 0) {
      v.push("target_schema.entities must be a non-empty list");
    } else {
      const seenEntity = new Set();
      ts.entities.forEach((e, i) => {
        if (e === null || typeof e !== "object" || Array.isArray(e)) {
          v.push(`target_schema.entities[${i}] must be an object`); return;
        }
        const en = e.name;
        if (!en || String(en).trim() === "") {
          v.push(`target_schema.entities[${i}] missing required key 'name'`);
        } else {
          if (seenEntity.has(en)) v.push(`duplicate entity name: ${en}`);
          seenEntity.add(en); entityNames.add(en);
        }
        const label = en || `[${i}]`;
        if (!Array.isArray(e.fields) || e.fields.length === 0) {
          v.push(`entity '${label}' fields must be a non-empty list`);
        } else {
          const seenField = new Set();
          e.fields.forEach((f, j) => {
            if (f === null || typeof f !== "object" || Array.isArray(f)) {
              v.push(`entity '${label}' field[${j}] must be an object`); return;
            }
            const fn = f.name;
            if (!fn || String(fn).trim() === "") {
              v.push(`entity '${label}' field[${j}] missing required key 'name'`);
            } else {
              if (seenField.has(fn)) v.push(`entity '${label}' duplicate field name: ${fn}`);
              seenField.add(fn);
            }
            if (!FIELD_TYPES.has(f.type)) {
              v.push(`entity '${label}' field '${fn || `[${j}]`}' type '${f.type}' ∉ FIELD_TYPES {${[...FIELD_TYPES].join(", ")}}`);
            }
          });
        }
      });
    }
  }
  const vol = obj.volumes;
  if (vol !== undefined && vol !== null) {
    if (typeof vol !== "object" || Array.isArray(vol)) {
      v.push("volumes must be a map of entity-name → count");
    } else {
      for (const [k, val] of Object.entries(vol)) {
        if (!entityNames.has(k)) v.push(`volumes key '${k}' is a dangling entity (not a target_schema entity)`);
        if (!Number.isInteger(val) || val < 0) v.push(`volumes['${k}'] must be an integer >= 0`);
      }
    }
  }
  return v;
}

// Self-contained seeded PRNG (FNV-1a string-hash → mulberry32). Dependency-free, deterministic:
// same seed string → same stream, every run, on every machine. NEVER touches Date.now /
// Math.random / crypto / the network — the seed-repo.mjs determinism discipline applied to data.
function seededPrng(seedStr) {
  let h = 0x811c9dc5;
  const s = String(seedStr);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  let a = h >>> 0;
  const nextFloat = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nextHex = (len) => {
    let out = "";
    while (out.length < len) out += Math.floor(nextFloat() * 16).toString(16);
    return out.slice(0, len);
  };
  return {
    nextFloat,
    nextInt: () => Math.floor(nextFloat() * 1e9),
    nextBool: () => nextFloat() < 0.5,
    nextHex,
  };
}

// Fixed epoch (2020-01-01T00:00:00Z) so generated timestamps are seed-derived, never wall-clock.
const FIXTURES_EPOCH_MS = Date.UTC(2020, 0, 1);

function deterministicValue(type, rng) {
  switch (type) {
    case "string": return "tok-" + rng.nextHex(8);
    case "int": return rng.nextInt();
    case "bool": return rng.nextBool();
    case "timestamp": return new Date(FIXTURES_EPOCH_MS + rng.nextInt() * 1000).toISOString();
    case "uuid": return `${rng.nextHex(8)}-${rng.nextHex(4)}-4${rng.nextHex(3)}-a${rng.nextHex(3)}-${rng.nextHex(12)}`;
    default: return null;
  }
}

function cmdFixtures(args) {
  // FAFF-576: fail-closed flag gate — an unknown flag or a value-flag missing its value
  // exits 2 here (the sub-verb body's --file/--out reads below then run on validated args).
  const gate = parseArgs(args, FIXTURES_SPEC);
  if (gate.errors.length) return usageError(gate.errors, "usage: faff fixtures <validate|show|realise> [--file F] [--out O] [--root DIR]");
  let root = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else rest.push(args[i]);
  }
  root = root || findRoot();
  const cmd = rest[0];

  if (cmd === "--selftest" || rest.includes("--selftest")) return fixturesSelftest();

  // shared manifest read (stdin or --file) → { obj } | { err: exitCode }
  const readManifest = (label) => {
    let raw;
    const fi = rest.indexOf("--file");
    try { raw = fs.readFileSync(fi !== -1 ? rest[fi + 1] : 0, "utf8"); }
    catch { process.stderr.write(`faff fixtures ${label}: cannot read input (no --file PATH and no stdin)\n`); return { err: 2 }; }
    try { return { obj: JSON.parse(raw) }; }
    catch { process.stderr.write(`faff fixtures ${label}: malformed manifest input (invalid JSON)\n`); return { err: 2 }; }
  };

  if (cmd === "validate") {
    const r = readManifest("validate");
    if (r.err) return r.err;
    const violations = validateFixtures(r.obj);
    if (violations.length) { for (const x of violations) process.stderr.write(`- ${x}\n`); return 1; }
    console.log("OK — fixtures manifest valid (schema 1).");
    return 0;
  }

  if (cmd === "show") {
    const manPath = path.join(root, ".faff", "fixtures", "manifest.json");
    const hasStored = fs.existsSync(manPath);
    let stored = {};
    if (hasStored) {
      try { stored = JSON.parse(fs.readFileSync(manPath, "utf8")); }
      catch {
        process.stderr.write(`faff fixtures show: malformed ${path.join(".faff", "fixtures", "manifest.json")} (invalid JSON)\n`);
        return 2;
      }
    }
    let override = null;
    try { override = dig(loadConfig(root)[0], "fixtures"); }
    catch (e) {
      if (e.message === "legacy-config-name" || e.message === "multiple-config") {
        process.stderr.write(`faff fixtures show: ${e.message}\n`); return 2;
      }
      throw e;
    }
    const hasOverride = override !== null && override !== undefined
      && typeof override === "object" && !Array.isArray(override) && Object.keys(override).length > 0;
    if (!hasStored && !hasOverride) {
      process.stderr.write("faff fixtures show: no fixtures manifest\n");
      return 3;
    }
    const effective = Object.assign({}, (stored && typeof stored === "object" && !Array.isArray(stored)) ? stored : {});
    if (hasOverride) {
      const applied = [];
      for (const k of Object.keys(override)) { effective[k] = override[k]; applied.push(k); }
      effective.notes = Array.isArray(effective.notes) ? effective.notes.slice() : [];
      effective.notes.push(`override applied: ${applied.join(", ")}`);
    }
    console.log(JSON.stringify(effective, null, 2));
    return 0;
  }

  if (cmd === "realise") {
    const r = readManifest("realise");
    if (r.err) return r.err;
    const obj = r.obj;
    const violations = validateFixtures(obj);
    if (violations.length) { for (const x of violations) process.stderr.write(`- ${x}\n`); return 1; }
    const oi = rest.indexOf("--out");
    let out = oi !== -1 ? rest[oi + 1]
      : (typeof obj.dataset_path === "string" && obj.dataset_path) ? obj.dataset_path
      : path.join(".faff", "fixtures", "dataset");
    if (!path.isAbsolute(out)) out = path.join(root, out);
    fs.mkdirSync(out, { recursive: true });
    for (const entity of obj.target_schema.entities) {
      const n = (obj.volumes && Number.isInteger(obj.volumes[entity.name])) ? obj.volumes[entity.name] : 0;
      // per-entity stream keyed off the manifest seed: stable, reproducible, independent per entity.
      const rng = seededPrng(`${obj.seed}::${entity.name}`);
      const rows = [];
      for (let i = 0; i < n; i++) {
        const row = {};
        for (const field of entity.fields) row[field.name] = deterministicValue(field.type, rng);
        rows.push(row);
      }
      fs.writeFileSync(path.join(out, `${entity.name}.json`), JSON.stringify(rows, null, 2) + "\n");
    }
    console.log(`OK — realised ${obj.target_schema.entities.length} entit${obj.target_schema.entities.length === 1 ? "y" : "ies"} to ${out}`);
    return 0;
  }

  process.stderr.write("faff fixtures: expected one of validate | show | realise (or --selftest)\n");
  return 2;
}

// In-memory self-test of the pure validator core (mirrors the `faff profile` selftest style).
function fixturesSelftest() {
  const ent = { name: "user", fields: [{ name: "id", type: "uuid" }, { name: "name", type: "string" }] };
  const valid = { schema: 1, authored_at: "2026-06-26T00:00:00Z", authored_by: "x", seed: "s",
    target_schema: { entities: [ent] }, volumes: { user: 3 } };
  const cases = [
    [valid, 0, "valid manifest"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [ent] } }, 0, "sparse but complete (no volumes)"],
    [{ schema: 2, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [ent] } }, 1, "wrong schema version"],
    [{ schema: 1, authored_at: "t", authored_by: "x", target_schema: { entities: [ent] } }, 1, "missing seed"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s" }, 1, "missing target_schema"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [] } }, 1, "empty entities"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "u", fields: [{ name: "f", type: "blob" }] }] } }, 1, "field type ∉ FIELD_TYPES"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [{ name: "u", fields: [] }] } }, 1, "entity empty fields"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [ent] }, volumes: { order: 2 } }, 1, "dangling volumes entity"],
    [{ schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [ent] }, volumes: { user: -1 } }, 1, "negative volume"],
    [[], 1, "not an object"],
  ];
  let failed = 0;
  for (const [obj, wantViol, label] of cases) {
    const got = validateFixtures(obj).length > 0 ? 1 : 0;
    if (got !== wantViol) { process.stderr.write(`fixtures --selftest FAIL: ${label} (want ${wantViol}, got ${got})\n`); failed++; }
  }
  if (failed) return 1;
  console.log("fixtures --selftest: ok");
  return 0;
}


module.exports = { FIELD_TYPES, FIXTURES_EPOCH_MS, cmdFixtures, deterministicValue, fixturesSelftest, seededPrng, validateFixtures };
