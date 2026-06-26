// FAFF-26 — infra-profile schema + `faff profile` CLI (slice 1 of 2).
// validate: 0 valid / 1 invalid+reasons / 2 malformed. show: effective profile
// (.faff/infra-profile.json ⊕ .faffrc.yaml infra:, override wins per field); exit 3 when none.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
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

function tmp() { return mkdtempSync(join(tmpdir(), "faff26-")); }
function writeStored(dir, obj) {
  mkdirSync(join(dir, ".faff"), { recursive: true });
  writeFileSync(join(dir, ".faff", "infra-profile.json"), typeof obj === "string" ? obj : JSON.stringify(obj));
}

const VALID = {
  schema: 1, acquired_at: "2026-06-26T00:00:00Z", acquired_by: "faffter-x-infra-mine",
  runtimes: [{ name: "node", version: "20", evidence: ".github/workflows/ci.yml" }],
  ci: [{ name: "github-actions", evidence: ".github/workflows/ci.yml" }],
};

test("profile --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["profile", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: valid profile → exit 0", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["profile", "validate"], JSON.stringify(VALID)).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: sparse-but-complete profile (empty lists) → exit 0", () => {
  const dir = tmp();
  try {
    const sparse = { schema: 1, acquired_at: "t", acquired_by: "x", notes: ["no infra artifacts discovered; minimal profile"] };
    assert.equal(run(dir, ["profile", "validate"], JSON.stringify(sparse)).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: missing acquired_by → exit 1, names the violation", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profile", "validate"], JSON.stringify({ schema: 1, acquired_at: "t" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /acquired_by/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: wrong schema version → exit 1", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profile", "validate"], JSON.stringify({ schema: 2, acquired_at: "t", acquired_by: "x" }));
    assert.equal(r.code, 1);
    assert.match(r.err, /schema must be 1/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: acquirer-sourced datastore with empty evidence → exit 1", () => {
  const dir = tmp();
  try {
    const bad = { schema: 1, acquired_at: "t", acquired_by: "x", datastores: [{ kind: "mongo" }] };
    const r = run(dir, ["profile", "validate"], JSON.stringify(bad));
    assert.equal(r.code, 1);
    assert.match(r.err, /evidence/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("validate: malformed JSON → exit 2 (fail-loud)", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["profile", "validate"], "{ not json");
    assert.equal(r.code, 2);
    assert.match(r.err, /malformed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: no stored profile + no override → exit 3", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["profile", "show"]).code, 3); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: stored only → prints stored profile", () => {
  const dir = tmp();
  try {
    writeStored(dir, { schema: 1, acquired_at: "t", acquired_by: "x", datastores: [{ kind: "postgres", evidence: "docker-compose.yml" }] });
    const r = run(dir, ["profile", "show"]);
    assert.equal(r.code, 0);
    const eff = JSON.parse(r.out);
    assert.equal(eff.datastores[0].kind, "postgres");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: human override wins per field + records 'override applied'", () => {
  const dir = tmp();
  try {
    writeStored(dir, { schema: 1, acquired_at: "t", acquired_by: "x", datastores: [{ kind: "postgres", evidence: "docker-compose.yml" }] });
    writeFileSync(join(dir, ".faffrc.yaml"), 'infra:\n  datastores: ["mongo"]\n');
    const r = run(dir, ["profile", "show"]);
    assert.equal(r.code, 0);
    const eff = JSON.parse(r.out);
    assert.deepEqual(eff.datastores, ["mongo"]);          // override replaced the stored field wholesale
    assert.ok(eff.notes.some((n) => /override applied/.test(n)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: override present, no stored file → effective = override alone", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), 'infra:\n  prefs: {"region":"eu"}\n');
    const r = run(dir, ["profile", "show"]);
    assert.equal(r.code, 0);
    const eff = JSON.parse(r.out);
    assert.deepEqual(eff.prefs, { region: "eu" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("show: malformed stored JSON → exit 2 (never silently empty)", () => {
  const dir = tmp();
  try {
    writeStored(dir, "{ not json");
    const r = run(dir, ["profile", "show"]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get --json returns structured data for the infra block", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), 'infra:\n  datastores: ["mongo"]\n  paas_available: ["netlify"]\n');
    const r = run(dir, ["config", "get", "--json", "infra"]);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { datastores: ["mongo"], paas_available: ["netlify"] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get --json on an absent non-registry key → null, exit 3", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["config", "get", "--json", "infra"]);
    assert.equal(r.code, 3);
    assert.equal(r.out, "null");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("config get (non-json) is unchanged for scalar keys", () => {
  const dir = tmp();
  try {
    assert.deepEqual(run(dir, ["config", "get", "logging"]), { code: 0, out: "full", err: "" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
