// FAFF-1081 — `faff native-map set` is the pure faff-type→tracker-template-identity writer.
// It persists the confirmed mapping (discovered over MCP by /faff-onboard step 2) to the committed
// `.faff/templates/native-templates.yaml` (FAFF-1300). These drive the REAL CLI against a throwaway dir (the
// whole write path — stdin JSON → validate → emit through the real YAML encoder → round-trip
// self-verify → fs.writeFileSync) and assert the observable DONE checks: exact round-trip,
// injection safety (a crafted name/id injects NO sibling key), unknown-type refusal, empty no-op.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const SHARED_INFRA = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "shared-infra.js");
const MAP_REL = join(".faff", "templates", "native-templates.yaml");
const DEPRECATED_MAP_REL = join(".faff-templates", "native-templates.yaml");

function run(cwd, args, input) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
}

// Success-path stderr is not surfaced by `run` (execFileSync), so notice and advisory assertions
// use this. Each call is a fresh process, so the once-per-process notice latch never carries over.
function runFull(cwd, args, input) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
  const err = r.stderr;
  return { code: r.status, out: r.stdout, err };
}

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "faff1081-"));
}

async function parseMapFile(dir) {
  const { parseYamlSubset } = await import(SHARED_INFRA);
  return parseYamlSubset(readFileSync(join(dir, MAP_REL), "utf8"));
}

// ---------------------------------------------------------------------------
// Round-trip: two normal mappings read back exactly, identity only (no body text).
// ---------------------------------------------------------------------------

test("round-trip: writes a file parseYamlSubset reads back to the exact keys/values", async () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: {
    bug: { id: "tmpl_bug_123", name: "Bug Report" },
    feature: { id: "tmpl_feat_456", name: "Feature Request" },
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(dir, MAP_REL)), "the map file must exist");

  const parsed = await parseMapFile(dir);
  assert.equal(parsed.tracker, "linear");
  assert.equal(parsed.team_key, "FAFF");
  assert.deepEqual(Object.keys(parsed.mappings).sort(), ["bug", "feature"]);
  assert.equal(parsed.mappings.bug.name, "Bug Report");
  assert.equal(parsed.mappings.bug.id, "tmpl_bug_123");
  assert.equal(parsed.mappings.feature.name, "Feature Request");
  assert.equal(parsed.mappings.feature.id, "tmpl_feat_456");
  // identity only — each entry is exactly { id, name }, no body/description leaked in.
  assert.deepEqual(Object.keys(parsed.mappings.bug).sort(), ["id", "name"]);
  assert.ok(parsed.mappings.bug.id.length > 0 && parsed.mappings.feature.id.length > 0);
  const raw = readFileSync(join(dir, MAP_REL), "utf8");
  assert.doesNotMatch(raw, /description|body/i, "no template body/description text is persisted");
});

// ---------------------------------------------------------------------------
// Injection safety (the key security AC): a crafted `name`/`id` — a newline + `key:` and an
// embedded colon — round-trips as a single scalar value, injecting NO sibling key and altering
// no structure. A string-built writer (`name: ${name}`) would fail this.
// ---------------------------------------------------------------------------

test("injection safety: a crafted name/id injects no sibling key and alters no structure", async () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: {
    bug: { id: "tmpl_1", name: "x\nevil: 1" },        // newline + `key:` — the classic YAML injection
    feature: { id: "tmpl_2", name: "a: b" },          // embedded colon
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.equal(r.code, 0, r.err);

  const parsed = await parseMapFile(dir);
  // Top-level structure is exactly the three intended keys — no injected sibling.
  assert.deepEqual(Object.keys(parsed).sort(), ["mappings", "team_key", "tracker"]);
  // mappings has EXACTLY the intended faff-type keys — the crafted `evil: 1` did not become a key.
  assert.deepEqual(Object.keys(parsed.mappings).sort(), ["bug", "feature"]);
  assert.ok(!("evil" in parsed), "no `evil` sibling at top level");
  assert.ok(!("evil" in parsed.mappings), "no `evil` key inside mappings");
  assert.ok(!("evil" in parsed.mappings.bug), "no `evil` key inside the bug entry");
  // The embedded-colon name round-trips whole as a single scalar value.
  assert.equal(parsed.mappings.feature.name, "a: b");
  // The newline name round-trips as a single scalar value carrying the crafted content
  // (the fixed block-scalar reader appends one trailing newline; it never fragments into structure).
  assert.equal(typeof parsed.mappings.bug.name, "string");
  assert.equal(parsed.mappings.bug.name, "x\nevil: 1\n");
  assert.deepEqual(Object.keys(parsed.mappings.bug).sort(), ["id", "name"]);
});

test("injection safety: a crafted id is equally protected (whole mappings emitted through one encoder)", async () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: {
    bug: { id: "id\nnope: 1", name: "Bug" },
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.equal(r.code, 0, r.err);
  const parsed = await parseMapFile(dir);
  assert.deepEqual(Object.keys(parsed).sort(), ["mappings", "team_key", "tracker"]);
  assert.deepEqual(Object.keys(parsed.mappings).sort(), ["bug"]);
  assert.ok(!("nope" in parsed) && !("nope" in parsed.mappings) && !("nope" in parsed.mappings.bug));
  assert.equal(parsed.mappings.bug.id, "id\nnope: 1\n");
});

// ---------------------------------------------------------------------------
// Unknown faff type → non-zero exit, no file written.
// ---------------------------------------------------------------------------

test("unknown faff type in mappings → non-zero exit, no file written", () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: {
    bug: { id: "t1", name: "Bug Report" },
    banana: { id: "t2", name: "Not A Faff Type" },
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /unknown faff type 'banana'/);
  assert.equal(existsSync(join(dir, MAP_REL)), false, "no file must be written on an unknown type");
});

// ---------------------------------------------------------------------------
// Empty mappings → exit 0, no file written.
// ---------------------------------------------------------------------------

test("empty mappings → exit 0, no file written", () => {
  const dir = tmpDir();
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], JSON.stringify({ mappings: {} }));
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(join(dir, MAP_REL)), false, "an empty mappings object writes nothing");
});

// ---------------------------------------------------------------------------
// --dry-run prints the exact file text and writes nothing; the printed text parses.
// ---------------------------------------------------------------------------

test("--dry-run prints the exact file text and writes nothing", async () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: { bug: { id: "t1", name: "Bug Report" } } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear", "--dry-run"], payload);
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(join(dir, MAP_REL)), false, "dry-run must not create the file");
  const { parseYamlSubset } = await import(SHARED_INFRA);
  const parsed = parseYamlSubset(r.out);
  assert.equal(parsed.mappings.bug.name, "Bug Report");
  assert.equal(parsed.tracker, "linear");
});

// ---------------------------------------------------------------------------
// A duplicate template id across two faff types is refused (one template → one type).
// ---------------------------------------------------------------------------

test("a template id mapped to two faff types is refused, no file written", () => {
  const dir = tmpDir();
  const payload = JSON.stringify({ mappings: {
    bug: { id: "same", name: "One" },
    feature: { id: "same", name: "Two" },
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /more than one faff type/);
  assert.equal(existsSync(join(dir, MAP_REL)), false);
});

// ---------------------------------------------------------------------------
// Missing required flags and malformed stdin are usage errors (exit 2), no file written.
// ---------------------------------------------------------------------------

test("malformed stdin JSON → exit 2, no file written", () => {
  const dir = tmpDir();
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], "not json");
  assert.equal(r.code, 2);
  assert.match(r.err, /invalid JSON/);
  assert.equal(existsSync(join(dir, MAP_REL)), false);
});

// ---------------------------------------------------------------------------
// The pure-helper self-test (encoder + round-trip + injection counter-proof), run via the CLI.
// ---------------------------------------------------------------------------

test("native-map set --selftest passes", () => {
  const dir = tmpDir();
  const r = run(dir, ["native-map", "set", "--selftest"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /RESULT: PASS/);
});

// ===========================================================================
// FAFF-1083 — the `get` reader verb: pure, offline, never-throws-on-absence reader over the
// same map the `set` writer produced. Real-CLI black-box, mirroring the writer tests above.
// ===========================================================================

// Write a two-type map via the real writer, then exercise `get` against it.
function writeMap(dir) {
  const payload = JSON.stringify({ mappings: {
    bug: { id: "tmpl_bug_123", name: "Bug Report" },
    feature: { id: "tmpl_feat_456", name: "Feature Request" },
  } });
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear"], payload);
  assert.equal(r.code, 0, r.err);
}

test("get --type <mapped> --json → { type, id, name }, exit 0", () => {
  const dir = tmpDir();
  writeMap(dir);
  const r = run(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { type: "bug", id: "tmpl_bug_123", name: "Bug Report", path: ".faff/templates/native-templates.yaml" });
});

test("get --type <unmapped> --json → { type, mapping:null }, exit 0", () => {
  const dir = tmpDir();
  writeMap(dir); // has bug + feature but NOT spike
  const r = run(dir, ["native-map", "get", "--type", "spike", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { type: "spike", mapping: null });
});

test("get (no --type) --json → { tracker, team_key, mappings }, exit 0", () => {
  const dir = tmpDir();
  writeMap(dir);
  const r = run(dir, ["native-map", "get", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), {
    tracker: "linear",
    team_key: "FAFF",
    mappings: {
      bug: { id: "tmpl_bug_123", name: "Bug Report" },
      feature: { id: "tmpl_feat_456", name: "Feature Request" },
    },
    path: ".faff/templates/native-templates.yaml",
  });
});

test("get --type against an ABSENT map file → { type, mapping:null }, exit 0, no throw", () => {
  const dir = tmpDir(); // no template directory written at all
  const r = run(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { type: "bug", mapping: null });
});

test("get (no --type) against an ABSENT map file → { mappings:{} }, exit 0, no throw", () => {
  const dir = tmpDir();
  const r = run(dir, ["native-map", "get", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { mappings: {} });
});

test("get against a MALFORMED/unreadable map → absent-shape, exit 0, no throw", () => {
  const dir = tmpDir();
  // A garbage file at the map path parses to no usable mappings → treated as absent.
  mkdirSync(join(dir, ".faff", "templates"), { recursive: true });
  writeFileSync(join(dir, MAP_REL), ":\n\t- [not valid structure}\n::::\n");
  const r = run(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { type: "bug", mapping: null });

  // An UNREADABLE map (a directory where the file is expected → readFileSync throws EISDIR)
  // degrades identically, never a throw.
  const dir2 = tmpDir();
  mkdirSync(join(dir2, MAP_REL), { recursive: true });
  const r2 = run(dir2, ["native-map", "get", "--json"]);
  assert.equal(r2.code, 0, r2.err);
  assert.deepEqual(JSON.parse(r2.out), { mappings: {} });
});

test("get --type outside the closed taxonomy → usageError, exit 2", () => {
  const dir = tmpDir();
  writeMap(dir);
  const r = run(dir, ["native-map", "get", "--type", "banana", "--json"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /unknown faff type 'banana'/);
});

test("--type is get-only: `set` refuses it (never accepted-but-ignored)", () => {
  const dir = tmpDir();
  const r = run(dir, ["native-map", "set", "--team", "FAFF", "--tracker", "linear", "--type", "bug"],
    JSON.stringify({ mappings: { bug: { id: "t1", name: "Bug" } } }));
  assert.equal(r.code, 2);
  assert.match(r.err, /--type/);
  assert.equal(existsSync(join(dir, MAP_REL)), false, "set must not write when it refuses --type");
});

test("get non-json hit prints a tab-separated id/name line", () => {
  const dir = tmpDir();
  writeMap(dir);
  const r = run(dir, ["native-map", "get", "--type", "bug"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), "tmpl_bug_123\tBug Report");
});

// ===========================================================================
// FAFF-1300: the map lives in `.faff/templates/`; `.faff-templates/` is a deprecated, read-only
// fallback. Reads resolve through `faff config templates-path`; the write target never does.
// ===========================================================================

const BUG_PAYLOAD = JSON.stringify({ mappings: { bug: { id: "tmpl_bug_123", name: "Bug Report" } } });
const SET_ARGS = ["native-map", "set", "--team", "FAFF", "--tracker", "linear"];

function writeDeprecatedMap(dir, id = "legacy_id") {
  mkdirSync(join(dir, ".faff-templates"), { recursive: true });
  writeFileSync(join(dir, DEPRECATED_MAP_REL),
    `tracker: linear\nteam_key: FAFF\nmappings:\n  bug:\n    id: ${id}\n    name: Legacy Bug\n`);
}

test("set with no existing map writes the canonical path, creates the directory, and names itself in the header", () => {
  const dir = tmpDir();
  const r = run(dir, SET_ARGS, BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /wrote 1 mapping\(s\) to \.faff\/templates\/native-templates\.yaml\./);
  assert.ok(readFileSync(join(dir, MAP_REL), "utf8").startsWith("# .faff/templates/native-templates.yaml "));
  assert.equal(existsSync(join(dir, ".faff-templates")), false);
});

test("set --json reports the write path in the wrote, empty-mappings and unchanged objects", () => {
  const dir = tmpDir();
  const wrote = JSON.parse(run(dir, [...SET_ARGS, "--json"], BUG_PAYLOAD).out);
  assert.equal(wrote.path, ".faff/templates/native-templates.yaml");
  const unchanged = JSON.parse(run(dir, [...SET_ARGS, "--json"], BUG_PAYLOAD).out);
  assert.deepEqual(unchanged, { wrote: false, reason: "unchanged", path: ".faff/templates/native-templates.yaml" });
  const human = run(dir, SET_ARGS, BUG_PAYLOAD);
  assert.match(human.out, /no changes \(\.faff\/templates\/native-templates\.yaml already up to date\)/);
  const empty = JSON.parse(run(tmpDir(), [...SET_ARGS, "--json"], JSON.stringify({ mappings: {} })).out);
  assert.deepEqual(empty, { wrote: false, reason: "empty-mappings", path: ".faff/templates/native-templates.yaml" });
});

test("set --json with tracking.templates_path reports the configured write path", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, ".faffrc.yaml"), "tracking:\n  templates_path: records/tpl/\n");
  const empty = JSON.parse(run(dir, [...SET_ARGS, "--json"], JSON.stringify({ mappings: {} })).out);
  assert.equal(empty.path, "records/tpl/native-templates.yaml");
  assert.equal(run(dir, SET_ARGS, BUG_PAYLOAD).code, 0);
  assert.ok(existsSync(join(dir, "records", "tpl", "native-templates.yaml")));
});

test("set refuses a differing canonical map without --force, naming the write path", () => {
  const dir = tmpDir();
  assert.equal(run(dir, SET_ARGS, BUG_PAYLOAD).code, 0);
  const r = run(dir, SET_ARGS, JSON.stringify({ mappings: { bug: { id: "other", name: "Other" } } }));
  assert.equal(r.code, 2);
  assert.match(r.err, /\.faff\/templates\/native-templates\.yaml already exists with different content/);
});

test("get reads the canonical map and reports its path", () => {
  const dir = tmpDir();
  writeMap(dir);
  const r = run(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(JSON.parse(r.out).path, ".faff/templates/native-templates.yaml");
});

test("get falls back to the deprecated map: path reported, notice on stderr, stdout still valid JSON", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const r = runFull(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { type: "bug", id: "legacy_id", name: "Legacy Bug", path: ".faff-templates/native-templates.yaml" });
  assert.match(r.err, /template overrides at \.faff-templates\/ are deprecated/);
  assert.ok(r.err.includes("git mv .faff-templates .faff/templates"));
});

test("get with maps in both locations: the canonical one wins", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  mkdirSync(join(dir, ".faff", "templates"), { recursive: true });
  writeFileSync(join(dir, MAP_REL), "tracker: linear\nteam_key: FAFF\nmappings:\n  bug:\n    id: tmpl_bug_123\n    name: Bug Report\n");
  const r = runFull(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(JSON.parse(r.out).id, "tmpl_bug_123");
  assert.match(r.err, /are deprecated and are now ignored/);
});

test("get with no map anywhere is silent on stderr", () => {
  const dir = tmpDir();
  const r = runFull(dir, ["native-map", "get", "--type", "bug", "--json"]);
  assert.equal(r.err, "");
});

test("set with a map only at the deprecated path exits 2 without --force: nothing written, file-level remedy, destination absent", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const r = runFull(dir, SET_ARGS, BUG_PAYLOAD);
  assert.equal(r.code, 2);
  assert.equal(existsSync(join(dir, ".faff")), false);
  assert.ok(r.err.includes(".faff-templates/native-templates.yaml"));
  const guardLine = r.err.split("\n").find((l) => l.startsWith("faff native-map set:"));
  assert.ok(guardLine.includes("mkdir -p .faff/templates && git mv .faff-templates/native-templates.yaml .faff/templates/native-templates.yaml"));
  assert.ok(!guardLine.includes("git mv .faff-templates .faff/templates"));
});

test("set with a deprecated-only map and a canonical directory already holding another file: same file-level remedy", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  mkdirSync(join(dir, ".faff", "templates"), { recursive: true });
  writeFileSync(join(dir, ".faff", "templates", "adr.md"), "## Context\nx\n");
  const r = runFull(dir, SET_ARGS, BUG_PAYLOAD);
  assert.equal(r.code, 2);
  assert.deepEqual(readdirSync(join(dir, ".faff", "templates")), ["adr.md"]);
  assert.ok(r.err.includes("git mv .faff-templates/native-templates.yaml .faff/templates/native-templates.yaml"));
  assert.ok(!r.err.includes("git mv .faff-templates .faff/templates"));
});

test("set --force with a deprecated-only map writes the canonical path, leaves the old file, and names it", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const r = runFull(dir, [...SET_ARGS, "--force"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.ok(existsSync(join(dir, MAP_REL)));
  assert.ok(existsSync(join(dir, DEPRECATED_MAP_REL)));
  assert.match(r.out, /\.faff-templates\/native-templates\.yaml is deprecated and was left in place/);
});

test("set --force --json on a deprecated-only map carries deprecated_left_in_place in the JSON line", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const r = runFull(dir, [...SET_ARGS, "--force", "--json"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.equal(parsed.wrote, true);
  assert.equal(parsed.deprecated_left_in_place, ".faff-templates/native-templates.yaml");
});

test("set --dry-run --force on a deprecated-only map exits 0, previews, writes nothing, advises the left-in-place outcome, and suppresses the whole-directory notice", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const r = runFull(dir, [...SET_ARGS, "--dry-run", "--force"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(join(dir, ".faff")), false, "a dry run writes nothing — no .faff/ directory");
  assert.ok(r.out.startsWith("# .faff/templates/native-templates.yaml "), "stdout carries the canonical-header preview");
  // FAFF-1319 nit 1: the --dry-run --force preview now predicts the real run's left-in-place outcome.
  assert.match(r.err, /faff native-map set --dry-run \(advisory,/);
  assert.match(r.err, /in place/);
  assert.ok(r.err.includes(".faff/templates/native-templates.yaml"), "names the canonical path to be written");
  assert.ok(r.err.includes(".faff-templates/native-templates.yaml"), "names the deprecated path to be left in place");
  // FAFF-1319 nit 2: no redundant whole-directory migration command in the guard-engages window.
  assert.ok(!r.err.includes("git mv .faff-templates .faff/templates"));
});

test("set --dry-run prints the preview with the canonical header and writes nothing", () => {
  const dir = tmpDir();
  const r = runFull(dir, [...SET_ARGS, "--dry-run"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.startsWith("# .faff/templates/native-templates.yaml "));
  assert.equal(existsSync(join(dir, ".faff")), false);
});

test("set --dry-run on a deprecated-only map exits 0, writes nothing, carries the shadowed-map advisory, and suppresses the whole-directory notice", () => {
  const dir = tmpDir();
  writeDeprecatedMap(dir);
  const real = runFull(dir, SET_ARGS, BUG_PAYLOAD);
  const r = runFull(dir, [...SET_ARGS, "--dry-run"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(join(dir, ".faff")), false);
  assert.match(r.err, /advisory/);
  assert.match(r.err, /a map already exists at \.faff-templates\/native-templates\.yaml/);
  // FAFF-1319: in the guard-engages window the file-level guard names the exact per-file move, so
  // the generic whole-directory directory-level notice is suppressed — the operator sees exactly
  // one, correct migration command, not two.
  assert.ok(r.err.includes("mkdir -p .faff/templates && git mv .faff-templates/native-templates.yaml .faff/templates/native-templates.yaml"));
  assert.ok(!r.err.includes("git mv .faff-templates .faff/templates"));
  const empty = runFull(tmpDir(), [...SET_ARGS, "--dry-run"], BUG_PAYLOAD);
  assert.equal(r.out, empty.out, "the preview is the same text a clean repo's dry run prints");
  assert.equal(real.code, 2);
});

test("set --dry-run against a byte-identical canonical map still prints the preview, with an up-to-date advisory", () => {
  const dir = tmpDir();
  assert.equal(run(dir, SET_ARGS, BUG_PAYLOAD).code, 0);
  const r = runFull(dir, [...SET_ARGS, "--dry-run"], BUG_PAYLOAD);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, readFileSync(join(dir, MAP_REL), "utf8"));
  assert.match(r.err, /already up to date/);
});

test("set --dry-run against a differing canonical map previews and advises that a real run would refuse", () => {
  const dir = tmpDir();
  assert.equal(run(dir, SET_ARGS, BUG_PAYLOAD).code, 0);
  const r = runFull(dir, [...SET_ARGS, "--dry-run"], JSON.stringify({ mappings: { bug: { id: "other", name: "Other" } } }));
  assert.equal(r.code, 0, r.err);
  assert.ok(r.out.includes("other"));
  assert.match(r.err, /already exists with different content/);
});
