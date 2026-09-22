// FAFF-1081 — `faff native-map set` is the pure faff-type→tracker-template-identity writer.
// It persists the confirmed mapping (discovered over MCP by /faff-onboard step 2) to the committed
// `.faff-templates/native-templates.yaml`. These drive the REAL CLI against a throwaway dir (the
// whole write path — stdin JSON → validate → emit through the real YAML encoder → round-trip
// self-verify → fs.writeFileSync) and assert the observable DONE checks: exact round-trip,
// injection safety (a crafted name/id injects NO sibling key), unknown-type refusal, empty no-op.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const SHARED_INFRA = join(HERE, "..", "plugin", "skills", "faff", "bin", "lib", "shared-infra.js");
const MAP_REL = join(".faff-templates", "native-templates.yaml");

function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString(), err: (e.stderr ?? "").toString() };
  }
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
  assert.deepEqual(JSON.parse(r.out), { type: "bug", id: "tmpl_bug_123", name: "Bug Report" });
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
  });
});

test("get --type against an ABSENT map file → { type, mapping:null }, exit 0, no throw", () => {
  const dir = tmpDir(); // no .faff-templates written at all
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
  mkdirSync(join(dir, ".faff-templates"), { recursive: true });
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
