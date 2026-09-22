// ===========================================================================
// === region:factory — native-map — FAFF-1081: the pure faff-type→template-identity writer ===
//   native-map get [--type <t>] [--json] [--root DIR]   (FAFF-1083: the pure, offline reader —
//     returns { type, id, name } for a mapped type, { type, mapping:null } for an unmapped one,
//     or the whole { tracker, team_key, mappings } map; absence/malformed → exit 0, never throws.
//     The create-skill's MCP lane calls this for the id, then fetches the body via get_template.)
//   native-map set --team <key> --tracker <token> [--dry-run] [--force] [--json] [--root DIR]
//     confirmed pairs arrive as JSON on STDIN — deliberately NOT a `<type>=<id>:<name>`
//     colon grammar (a tracker template name may contain colons/newlines, so a delimiter
//     grammar is unsafe to parse):
//        {"mappings": {"bug": {"id": "tmpl_123", "name": "Bug Report"}, ...}}
//     Writes/overwrites the committed `.faff-templates/native-templates.yaml` — a sibling of
//     the per-type override files, keyed by faff type, each value a { id, name } identity ref.
//
// Persist-only / PURE: NO MCP, NO network, NO env discovery, NO git — it parses stdin,
// validates against the closed faff-type taxonomy, and emits the file through the REAL
// structured YAML scalar encoder (config.js emitScalar for single-line values, a block
// literal for any value carrying a newline) — never string concatenation of an untrusted
// value into the file text. That is what stops a crafted `name`/`id` (a newline + `key:`,
// or an embedded colon) from injecting a sibling key or altering the file's structure. The
// discovery/proposal that produces the pairs is the skill's job (faff-onboard step 2), exactly
// as team-list is (the MCP/CLI split; config.js "NO MCP, NO env reads" invariant).
//
// The write is round-trip self-verified against the real reader (parseYamlSubset/dig) before
// it touches disk, mirroring `config init`'s discipline — a written file that does not read
// back to the exact intended structure aborts (exit 2), never persists a corrupt/injected map.
//
// Store IDENTITY ONLY (id + name); never a template body/description — that is what keeps the
// map from going stale against a maintained tracker template set (FAFF-1083 re-fetches the body
// via the stored id at create time). The filename is neither `.md` nor a faff-type name, so it
// never collides with create.md's tier-2 `<type>.md` override resolution.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot, parseYamlSubset, dig } = require("./shared-infra");
const { emitScalar } = require("./config");

// The closed create-taxonomy (create.md:11-18). A `mappings` key outside this set is refused.
const FAFF_TYPES = ["bug", "feature", "spike", "chore", "epic", "default"];
const FAFF_TYPE_SET = new Set(FAFF_TYPES);

const NATIVE_MAP_DIR = ".faff-templates";
const NATIVE_MAP_REL = `${NATIVE_MAP_DIR}/native-templates.yaml`;
const NATIVE_MAP_HEADER =
  "# .faff-templates/native-templates.yaml — faff-type → tracker-native template map (written by `faff native-map set`)\n";

const NATIVE_MAP_SPEC = {
  flags: {
    "--team": { arity: 1 },
    "--tracker": { arity: 1 },
    "--type": { arity: 1 },
    "--dry-run": { arity: 0 },
    "--force": { arity: 0 },
    "--json": { arity: 0 },
    "--root": { arity: 1 },
    "--selftest": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "verb" },
};

// `--type` is a get-only flag: it lives in the shared spec so parseArgs accepts it before
// dispatch, but `set` refuses it explicitly (cmdNativeMapSet) so it is never accepted-but-ignored.
const NATIVE_MAP_SURFACE = {
  kind: "subcommand_dispatch",
  spec: NATIVE_MAP_SPEC,
  subcommands: {
    set: { required_flags: ["--team", "--tracker"] },
    get: { required_flags: [] },
  },
};

// ---------------------------------------------------------------------------
// Encoder. emitScalar (config.js) round-trips every single-line value through the fixed
// parseYamlSubset reader (a bare token when safe, else double-quoted with `\`/`"` escaped)
// — verified for colons, hashes, leading/trailing space and coercible tokens. Its one gap is
// a value carrying a real newline: emitted bare it would spill onto the next line and the
// line-based reader would read the tail as a sibling key. So a multiline value is emitted as
// a block literal (`|`) whose continuation lines the reader gathers by indent — the only
// parseYamlSubset form that carries a newline without escaping structure. The reader appends
// one trailing "\n" to a block scalar (it does not honour chomping), so expectedReadback
// models that exactly for the round-trip self-verify.
// ---------------------------------------------------------------------------

function isMultiline(value) {
  return /[\n\r]/.test(value);
}

// The lines for one `<pad>key: <value>` entry. Pure text — the value is never interpolated
// into a structural position; a multiline value's content lands only on deeper-indented
// continuation lines under a block-literal indicator.
function emitEntryLines(pad, key, value) {
  if (isMultiline(value)) {
    const childPad = pad + "  ";
    const lines = [`${pad}${key}: |`];
    for (const line of value.replace(/\r\n?/g, "\n").split("\n")) lines.push(childPad + line);
    return lines;
  }
  return [`${pad}${key}: ${emitScalar(value)}`];
}

// What parseYamlSubset reads a value back as, given emitEntryLines emitted it. Single-line
// values round-trip exactly; a block literal comes back with CR/CRLF normalised to LF, trailing
// blank lines stripped, and exactly one trailing "\n" (the reader's block-scalar behaviour).
function expectedReadback(value) {
  if (!isMultiline(value)) return value;
  return value.replace(/\r\n?/g, "\n").replace(/\n+$/, "") + "\n";
}

// Emit the whole file. `mappings` is an ordered array of { type, id, name } (faff-type order),
// already validated. Nothing else (no body, no description, no unmapped list) is written.
function emitNativeMap(tracker, teamKey, mappings) {
  const lines = [];
  lines.push(...emitEntryLines("", "tracker", tracker));
  lines.push(...emitEntryLines("", "team_key", teamKey));
  lines.push("mappings:");
  for (const { type, id, name } of mappings) {
    lines.push(`  ${type}:`);
    lines.push(...emitEntryLines("    ", "id", id));
    lines.push(...emitEntryLines("    ", "name", name));
  }
  return NATIVE_MAP_HEADER + lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Validation. Returns { mappings } (ordered array) or { error } — never throws for bad input.
// ---------------------------------------------------------------------------

function nonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function validatePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "payload must be a JSON object with a `mappings` field" };
  }
  const raw = payload.mappings;
  if (raw === undefined || raw === null) return { error: "payload is missing the `mappings` field" };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "`mappings` must be a JSON object keyed by faff type" };

  const mappings = [];
  const seenIds = new Set();
  // Emit in the canonical faff-type order so the file is stable regardless of stdin key order.
  for (const type of FAFF_TYPES) {
    if (!Object.prototype.hasOwnProperty.call(raw, type)) continue;
    const ref = raw[type];
    if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
      return { error: `mapping for '${type}' must be an object { id, name }` };
    }
    if (!nonEmptyString(ref.id)) return { error: `mapping for '${type}' needs a non-empty string id` };
    if (!nonEmptyString(ref.name)) return { error: `mapping for '${type}' needs a non-empty string name` };
    if (seenIds.has(ref.id)) return { error: `template id '${ref.id}' is mapped to more than one faff type (one template maps to one type)` };
    seenIds.add(ref.id);
    mappings.push({ type, id: ref.id, name: ref.name });
  }
  // Any key that is NOT a member of the closed taxonomy is refused (no write).
  for (const key of Object.keys(raw)) {
    if (!FAFF_TYPE_SET.has(key)) {
      return { error: `unknown faff type '${key}' in mappings. Accepted: ${FAFF_TYPES.join(", ")}` };
    }
  }
  return { mappings };
}

// Round-trip self-verify: the written text must read back through the REAL reader to exactly
// the intended structure — the top-level keys are exactly {tracker, team_key, mappings}, the
// mappings keys are exactly the intended faff types (nothing injected), and every id/name reads
// back to its expected value. Returns null on success, else a diagnostic string.
function verifyRoundTrip(text, tracker, teamKey, mappings) {
  const tree = parseYamlSubset(text);
  const topKeys = Object.keys(tree).sort();
  if (JSON.stringify(topKeys) !== JSON.stringify(["mappings", "team_key", "tracker"])) {
    return `top-level keys are ${JSON.stringify(topKeys)}, expected [mappings, team_key, tracker]`;
  }
  if (dig(tree, "tracker") !== expectedReadback(tracker)) return "tracker did not round-trip";
  if (dig(tree, "team_key") !== expectedReadback(teamKey)) return "team_key did not round-trip";
  const treeMap = tree.mappings;
  if (treeMap === null || typeof treeMap !== "object" || Array.isArray(treeMap)) return "mappings did not read back as a map";
  const gotKeys = Object.keys(treeMap).sort();
  const wantKeys = mappings.map((m) => m.type).sort();
  if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) {
    return `mappings keys are ${JSON.stringify(gotKeys)}, expected ${JSON.stringify(wantKeys)} (a sibling key was injected or dropped)`;
  }
  for (const { type, id, name } of mappings) {
    const entry = treeMap[type];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return `mappings.${type} did not read back as a map`;
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify(["id", "name"])) {
      return `mappings.${type} keys are ${JSON.stringify(Object.keys(entry).sort())}, expected [id, name]`;
    }
    if (entry.id !== expectedReadback(id)) return `mappings.${type}.id did not round-trip`;
    if (entry.name !== expectedReadback(name)) return `mappings.${type}.name did not round-trip`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The `set` subcommand.
// ---------------------------------------------------------------------------

function cmdNativeMapSet(values, root) {
  if (values["--type"] !== undefined) {
    process.stderr.write("faff native-map set: --type is a `get`-only flag and is not accepted by `set`\n");
    return 2;
  }
  const team = values["--team"];
  const tracker = values["--tracker"];
  if (!nonEmptyString(team)) { process.stderr.write("faff native-map set: --team <team_key> is required\n"); return 2; }
  if (!nonEmptyString(tracker)) { process.stderr.write("faff native-map set: --tracker <token> is required\n"); return 2; }

  let raw;
  try { raw = fs.readFileSync(0, "utf8"); }
  catch { process.stderr.write("faff native-map set: cannot read the mappings payload from stdin\n"); return 2; }
  let payload;
  try { payload = JSON.parse(raw); }
  catch { process.stderr.write("faff native-map set: malformed payload (invalid JSON on stdin)\n"); return 2; }

  const { mappings, error } = validatePayload(payload);
  if (error) { process.stderr.write(`faff native-map set: ${error}\n`); return 2; }

  // Empty mappings → no-op: write no file, exit success.
  if (mappings.length === 0) {
    if (values["--json"]) console.log(JSON.stringify({ wrote: false, reason: "empty-mappings", path: NATIVE_MAP_REL }));
    else console.log("native-map set: no mappings given — nothing to write.");
    return 0;
  }

  const text = emitNativeMap(tracker, team, mappings);
  const problem = verifyRoundTrip(text, tracker, team, mappings);
  if (problem) {
    process.stderr.write(`faff native-map set: internal error — written text does not round-trip (${problem}); aborting to avoid a corrupt map.\n`);
    return 2;
  }

  if (values["--dry-run"]) {
    process.stdout.write(text);
    return 0;
  }

  const targetPath = path.join(root, NATIVE_MAP_REL);
  if (fs.existsSync(targetPath)) {
    const existing = fs.readFileSync(targetPath, "utf8");
    if (existing === text) {
      if (values["--json"]) console.log(JSON.stringify({ wrote: false, reason: "unchanged", path: NATIVE_MAP_REL }));
      else console.log(`native-map set: no changes (${NATIVE_MAP_REL} already up to date).`);
      return 0;
    }
    if (!values["--force"]) {
      process.stderr.write(`faff native-map set: ${NATIVE_MAP_REL} already exists with different content; re-run with --force to overwrite.\n`);
      return 2;
    }
  }

  fs.mkdirSync(path.join(root, NATIVE_MAP_DIR), { recursive: true });
  fs.writeFileSync(targetPath, text);

  if (values["--json"]) {
    console.log(JSON.stringify({
      wrote: true, path: NATIVE_MAP_REL, tracker, team_key: team,
      mappings: Object.fromEntries(mappings.map((m) => [m.type, { id: m.id, name: m.name }])),
    }));
  } else {
    console.log(`native-map set: wrote ${mappings.length} mapping(s) to ${NATIVE_MAP_REL}.`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// The `get` reader subcommand — PURE, offline: reads the committed map through the same
// parseYamlSubset/dig the writer round-trip-verifies against. NO MCP, network, or git. Never
// throws on absence: a missing / unreadable / malformed map, or a type with no entry, is a clean
// "no mapping" at exit 0. Only a `--type` outside the closed taxonomy is a usageError (exit 2),
// mirroring the writer's unknown-type refusal. The create-skill's MCP lane calls this for the id,
// then fetches the body via get_template itself (create.md tier 1); the CLI stays MCP-free.
// ---------------------------------------------------------------------------

const NATIVE_MAP_GET_USAGE =
  "usage: faff native-map get [--type <bug|feature|spike|chore|epic|default>] [--json] [--root DIR]";

// Emit the "no tier-1 candidate" signal. With --type: { type, mapping: null }; without: the empty
// whole-map shape { mappings: {} }. Non-json is a short human line. Always exit 0.
function emitNativeMapGetMiss(type, json) {
  if (type !== undefined) {
    if (json) console.log(JSON.stringify({ type, mapping: null }));
    else console.log(`${type}\tno mapping`);
  } else if (json) {
    console.log(JSON.stringify({ mappings: {} }));
  } else {
    console.log("no mapping");
  }
  return 0;
}

function cmdNativeMapGet(values, root) {
  const json = !!values["--json"];
  const type = values["--type"];
  if (type !== undefined && !FAFF_TYPE_SET.has(type)) {
    return usageError(
      [{ code: "bad-enum", flag: "--type", detail: `unknown faff type '${type}'. Accepted: ${FAFF_TYPES.join(", ")}` }],
      NATIVE_MAP_GET_USAGE,
    );
  }

  const targetPath = path.join(root, NATIVE_MAP_REL);
  let tree = null;
  try {
    if (fs.existsSync(targetPath)) tree = parseYamlSubset(fs.readFileSync(targetPath, "utf8"));
  } catch {
    tree = null; // unreadable → treated as absent, never a throw
  }
  if (tree === null || typeof tree !== "object" || Array.isArray(tree)) {
    return emitNativeMapGetMiss(type, json);
  }

  if (type !== undefined) {
    const id = dig(tree, `mappings.${type}.id`);
    const name = dig(tree, `mappings.${type}.name`);
    if (id === null || name === null) return emitNativeMapGetMiss(type, json);
    if (json) console.log(JSON.stringify({ type, id, name }));
    else console.log(`${id}\t${name}`);
    return 0;
  }

  const rawMap = tree.mappings;
  const mappings = rawMap !== null && typeof rawMap === "object" && !Array.isArray(rawMap) ? rawMap : {};
  if (json) {
    console.log(JSON.stringify({ tracker: dig(tree, "tracker"), team_key: dig(tree, "team_key"), mappings }));
  } else {
    const types = Object.keys(mappings);
    if (!types.length) console.log("no mapping");
    else for (const t of types) console.log(`${t}\t${dig(mappings, `${t}.id`)}\t${dig(mappings, `${t}.name`)}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// In-memory self-test for the encoder + round-trip contract. Mirrors configSetSelftest's
// shape: per-case ok/FAIL + a RESULT line, non-zero on any fail. The injection cases prove a
// crafted name/id cannot inject a sibling key or corrupt the file structure.
// ---------------------------------------------------------------------------

function nativeMapSelftest() {
  let fail = 0;
  const check = (label, cond) => { if (!cond) fail++; console.log(`${cond ? "ok  " : "FAIL"} ${label}`); };

  // plain: two entries round-trip exactly, identity only.
  {
    const mappings = [{ type: "bug", id: "t1", name: "Bug Report" }, { type: "feature", id: "t2", name: "Feature Request" }];
    const text = emitNativeMap("linear", "FAFF", mappings);
    const tree = parseYamlSubset(text);
    check("plain: round-trip verify passes", verifyRoundTrip(text, "linear", "FAFF", mappings) === null);
    check("plain: bug name reads back", dig(tree, "mappings.bug.name") === "Bug Report");
    check("plain: feature id reads back", dig(tree, "mappings.feature.id") === "t2");
    check("plain: only tracker/team_key/mappings at top", JSON.stringify(Object.keys(tree).sort()) === JSON.stringify(["mappings", "team_key", "tracker"]));
  }

  // injection: a newline + `key:` and an embedded colon must NOT inject a sibling key.
  {
    const mappings = [{ type: "bug", id: "x\nevil: 1", name: "x\nevil: 2" }, { type: "feature", id: "t2", name: "a: b" }];
    const text = emitNativeMap("linear", "FAFF", mappings);
    const tree = parseYamlSubset(text);
    check("injection: round-trip verify passes", verifyRoundTrip(text, "linear", "FAFF", mappings) === null);
    check("injection: no top-level sibling injected", JSON.stringify(Object.keys(tree).sort()) === JSON.stringify(["mappings", "team_key", "tracker"]));
    check("injection: mappings has exactly bug+feature", JSON.stringify(Object.keys(tree.mappings).sort()) === JSON.stringify(["bug", "feature"]));
    check("injection: no `evil` key anywhere", !("evil" in tree) && !("evil" in tree.mappings) && !("evil" in (tree.mappings.bug || {})));
    check("injection: embedded colon name reads back whole", dig(tree, "mappings.feature.name") === "a: b");
  }

  // string-concatenation counter-proof: the naive `name: ${name}` writer WOULD inject a sibling.
  {
    const naive = `mappings:\n  bug:\n    id: t1\n    name: x\nevil: 1\n`;
    const tree = parseYamlSubset(naive);
    check("counter-proof: a string-built writer injects `evil` (this is what emitEntryLines prevents)", "evil" in tree);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (native-map, ${fail} failed)`);
  return fail ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Dispatch. `native-map <set> [flags]`. --root is consumed here (findRoot default) exactly as
// the config/conventions verbs do; every other flag is validated by parseArgs against the spec.
// ---------------------------------------------------------------------------

function cmdNativeMap(args) {
  const gate = parseArgs(args, NATIVE_MAP_SPEC);
  if (gate.errors.length) {
    return usageError(gate.errors, "usage: faff native-map set --team <team_key> --tracker <token> [--dry-run] [--force] [--json] [--root DIR]  (mappings JSON on stdin)\n       faff native-map get [--type <faff-type>] [--json] [--root DIR]");
  }
  if (gate.values["--selftest"]) return nativeMapSelftest();

  const root = gate.values["--root"] || findRoot();
  const verb = gate.positionals[0];
  if (verb === "set") return cmdNativeMapSet(gate.values, root);
  if (verb === "get") return cmdNativeMapGet(gate.values, root);

  process.stderr.write("faff native-map: expected the subcommand 'set' or 'get' (or --selftest)\n");
  return 2;
}

module.exports = {
  FAFF_TYPES, NATIVE_MAP_REL, NATIVE_MAP_SPEC, NATIVE_MAP_SURFACE,
  cmdNativeMap, cmdNativeMapGet, emitNativeMap, emitEntryLines, emitNativeMapGetMiss,
  expectedReadback, validatePayload, verifyRoundTrip, nativeMapSelftest,
};
