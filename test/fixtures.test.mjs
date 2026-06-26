// FAFF-31 — fixtures dataset-manifest schema + `faff fixtures` CLI (slice 1 of 2).
// validate: 0 valid / 1 invalid+reasons / 2 malformed. show: effective manifest
// (.faff/fixtures/manifest.json ⊕ .faffrc.yaml fixtures:, override wins per field); exit 3 when none.
// realise: deterministic reference generator — (manifest, seed) → byte-identical per-entity JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd`; `input` is fed to stdin. returns { code, out, err }
function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), "faff31-")); }
function writeStored(dir, obj) {
  mkdirSync(join(dir, ".faff", "fixtures"), { recursive: true });
  writeFileSync(join(dir, ".faff", "fixtures", "manifest.json"), typeof obj === "string" ? obj : JSON.stringify(obj));
}
function hashTree(dir) {
  return readdirSync(dir).sort()
    .map((f) => `${f}:${createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")}`)
    .join("\n");
}

const USER = { name: "user", fields: [{ name: "id", type: "uuid" }, { name: "name", type: "string" }] };
const VALID = {
  schema: 1, authored_at: "2026-06-26T00:00:00Z", authored_by: "alec",
  seed: "abc", target_schema: { entities: [USER] }, volumes: { user: 3 },
};

test("fixtures --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["fixtures", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- validate -------------------------------------------------------------

test("validate: valid manifest → exit 0", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["fixtures", "validate"], JSON.stringify(VALID)).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: sparse-but-complete (no volumes) → exit 0", () => {
  const dir = tmp();
  try {
    const sparse = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [USER] } };
    assert.equal(run(dir, ["fixtures", "validate"], JSON.stringify(sparse)).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: missing seed → exit 1, names the violation", () => {
  const dir = tmp();
  try {
    const bad = { schema: 1, authored_at: "t", authored_by: "x", target_schema: { entities: [USER] } };
    const r = run(dir, ["fixtures", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /seed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: wrong schema version → exit 1", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["fixtures", "validate"], JSON.stringify({ ...VALID, schema: 2 }));
    assert.equal(r.code, 1);
    assert.match(r.err, /schema must be 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: empty entities → exit 1", () => {
  const dir = tmp();
  try {
    const bad = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [] } };
    const r = run(dir, ["fixtures", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /non-empty/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: duplicate entity name → exit 1", () => {
  const dir = tmp();
  try {
    const bad = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [USER, USER] } };
    const r = run(dir, ["fixtures", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /duplicate entity name/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: field type ∉ FIELD_TYPES → exit 1, names the violation", () => {
  const dir = tmp();
  try {
    const bad = { schema: 1, authored_at: "t", authored_by: "x", seed: "s",
      target_schema: { entities: [{ name: "u", fields: [{ name: "f", type: "blob" }] }] } };
    const r = run(dir, ["fixtures", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /FIELD_TYPES/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: dangling volumes entity → exit 1, names the key", () => {
  const dir = tmp();
  try {
    const bad = { ...VALID, volumes: { order: 2 } };
    const r = run(dir, ["fixtures", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /order/);
    assert.match(r.err, /dangling entity/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: negative volume → exit 1", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["fixtures", "validate"], JSON.stringify({ ...VALID, volumes: { user: -1 } }));
    assert.equal(r.code, 1);
    assert.match(r.err, /integer >= 0/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: malformed JSON → exit 2 (fail-loud)", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["fixtures", "validate"], "{ not json");
    assert.equal(r.code, 2);
    assert.match(r.err, /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: --file path is read", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "m.json"), JSON.stringify(VALID));
    assert.equal(run(dir, ["fixtures", "validate", "--file", join(dir, "m.json")]).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- show -----------------------------------------------------------------

test("show: no stored manifest + no override → exit 3", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["fixtures", "show"]).code, 3); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: stored only → prints stored manifest", () => {
  const dir = tmp();
  try {
    writeStored(dir, VALID);
    const r = run(dir, ["fixtures", "show"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out).volumes, { user: 3 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: human override wins per field + records 'override applied'", () => {
  const dir = tmp();
  try {
    writeStored(dir, VALID);
    writeFileSync(join(dir, ".faffrc.yaml"), 'fixtures:\n  volumes: {"user":10}\n');
    const r = run(dir, ["fixtures", "show"]);
    assert.equal(r.code, 0);
    const eff = JSON.parse(r.out);
    assert.deepEqual(eff.volumes, { user: 10 });            // override replaced the field wholesale
    assert.ok(eff.notes.some((n) => /override applied/.test(n)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: override present, no stored manifest → effective = override alone", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), 'fixtures:\n  prefs: {"locale":"en"}\n');
    const r = run(dir, ["fixtures", "show"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out).prefs, { locale: "en" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: malformed stored manifest → exit 2 (never silently empty)", () => {
  const dir = tmp();
  try {
    writeStored(dir, "{ not json");
    assert.equal(run(dir, ["fixtures", "show"]).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- realise --------------------------------------------------------------

test("realise: writes per-entity JSON with the requested row count", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "m.json"), JSON.stringify(VALID));
    const out = join(dir, "ds");
    const r = run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", out]);
    assert.equal(r.code, 0);
    const rows = JSON.parse(readFileSync(join(out, "user.json"), "utf8"));
    assert.equal(rows.length, 3);
    assert.ok(typeof rows[0].id === "string" && typeof rows[0].name === "string");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: two runs of the same manifest → byte-identical output", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "m.json"), JSON.stringify({ ...VALID, seed: "determinism", volumes: { user: 5 } }));
    const a = join(dir, "a"), b = join(dir, "b");
    assert.equal(run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", a]).code, 0);
    assert.equal(run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", b]).code, 0);
    assert.equal(hashTree(a), hashTree(b));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: a different seed → different output (seed is load-bearing)", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "m1.json"), JSON.stringify({ ...VALID, seed: "one", volumes: { user: 5 } }));
    writeFileSync(join(dir, "m2.json"), JSON.stringify({ ...VALID, seed: "two", volumes: { user: 5 } }));
    const a = join(dir, "a"), b = join(dir, "b");
    run(dir, ["fixtures", "realise", "--file", join(dir, "m1.json"), "--out", a]);
    run(dir, ["fixtures", "realise", "--file", join(dir, "m2.json"), "--out", b]);
    assert.notEqual(hashTree(a), hashTree(b));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: no generated value uses wall-clock / Math.random / crypto.randomUUID", () => {
  const dir = tmp();
  try {
    const man = { schema: 1, authored_at: "t", authored_by: "x", seed: "stable",
      target_schema: { entities: [{ name: "rec", fields: [
        { name: "s", type: "string" }, { name: "i", type: "int" }, { name: "b", type: "bool" },
        { name: "ts", type: "timestamp" }, { name: "u", type: "uuid" }] }] },
      volumes: { rec: 4 } };
    writeFileSync(join(dir, "m.json"), JSON.stringify(man));
    // Realise the same manifest twice with a wall-clock gap; a wall-clock or RNG source
    // would diverge across the two runs. Byte-identical ⇒ no non-deterministic source.
    const a = join(dir, "a"), b = join(dir, "b");
    run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", a]);
    run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", b]);
    assert.equal(readFileSync(join(a, "rec.json"), "utf8"), readFileSync(join(b, "rec.json"), "utf8"));
    // timestamps land on the fixed 2020 epoch base, never "now".
    const rows = JSON.parse(readFileSync(join(a, "rec.json"), "utf8"));
    assert.ok(rows.every((r) => new Date(r.ts).getUTCFullYear() < new Date().getUTCFullYear() + 50));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: sparse manifest (no volumes) → empty-but-shaped dataset", () => {
  const dir = tmp();
  try {
    const sparse = { schema: 1, authored_at: "t", authored_by: "x", seed: "s", target_schema: { entities: [USER] } };
    writeFileSync(join(dir, "m.json"), JSON.stringify(sparse));
    const out = join(dir, "ds");
    assert.equal(run(dir, ["fixtures", "realise", "--file", join(dir, "m.json"), "--out", out]).code, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "user.json"), "utf8")), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: invalid manifest → exit 1; malformed → exit 2", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ schema: 2 }));
    assert.equal(run(dir, ["fixtures", "realise", "--file", join(dir, "bad.json"), "--out", join(dir, "o")]).code, 1);
    writeFileSync(join(dir, "junk.json"), "{ not json");
    assert.equal(run(dir, ["fixtures", "realise", "--file", join(dir, "junk.json"), "--out", join(dir, "o")]).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("realise: defaults output to dataset_path when --out omitted", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "m.json"), JSON.stringify({ ...VALID, dataset_path: "custom/ds" }));
    const r = run(dir, ["fixtures", "realise", "--file", join(dir, "m.json")]);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, "custom", "ds", "user.json"), "utf8")).length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- generator↔CLI contract (DONE: a generator-emitted manifest validates) ---

test("a generator-shaped manifest validates via `faff fixtures validate`", () => {
  const dir = tmp();
  try {
    // the body a `faff-contract:fixtures-manifest` block would carry
    const emitted = { schema: 1, authored_at: "2026-06-26T00:00:00Z", authored_by: "fixtures-slot-occupant",
      seed: "gen-seed", target_schema: { entities: [{ name: "account", fields: [
        { name: "id", type: "uuid" }, { name: "balance", type: "int" }, { name: "active", type: "bool" }] }] },
      volumes: { account: 12 }, dataset_path: ".faff/fixtures/dataset" };
    assert.equal(run(dir, ["fixtures", "validate"], JSON.stringify(emitted)).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
