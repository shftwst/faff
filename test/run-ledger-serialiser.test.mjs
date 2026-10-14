// FAFF-1258 — the run-ledger serialiser: mutateLedgerUnderLock stamps schema_version, validates against the
// v0.3 run-ledger schema and refuses only the violations the current mutation introduces.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const hb = require("../plugin/skills/faff/bin/lib/heartbeat.js");
const evidence = require("../plugin/skills/faff/bin/lib/evidence.js");
const { mutateLedgerUnderLock } = hb;

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const NOW = "2026-10-14T00:00:00.000Z";

function validLedger(extra = {}) {
  return {
    run_id: "RUN-S", level: "L3", admitted: ["FAFF-1", "FAFF-2"], outcomes: {},
    owner: { status: "running", session_id: "S", pid: 1, started_at: NOW, last_heartbeat: NOW },
    ...extra,
  };
}

function mkRunDir() {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1258-ser-"));
  const runDir = path.join(root, ".faff", "runs", "RUN-S");
  mkdirSync(runDir, { recursive: true });
  return { root, runDir };
}

const ledgerPath = (runDir) => path.join(runDir, "run-ledger.json");
const readLedger = (runDir) => JSON.parse(readFileSync(ledgerPath(runDir), "utf8"));
const bytesOf = (file) => (existsSync(file) ? readFileSync(file) : null);

function captureStderr(fn) {
  const chunks = [];
  const real = process.stderr.write.bind(process.stderr);
  process.stderr.write = (c, ...rest) => { chunks.push(String(c)); return true; };
  try { return { result: fn(), stderr: () => chunks.join("") }; }
  catch (e) { e.stderrText = chunks.join(""); throw e; }
  finally { process.stderr.write = real; }
}

// A minted, valid, stamped ledger on disk (events chain included).
function minted(extra = {}) {
  const dir = mkRunDir();
  mutateLedgerUnderLock(dir.runDir, () => validLedger(extra));
  return dir;
}

function writeRaw(runDir, doc) {
  writeFileSync(ledgerPath(runDir), JSON.stringify(doc, null, 2) + "\n");
}

test("a mint writes schema_version: 1 as the first key and the file validates", () => {
  const { root, runDir } = mkRunDir();
  try {
    const res = mutateLedgerUnderLock(runDir, () => validLedger());
    assert.equal(res.written, true);
    const led = readLedger(runDir);
    assert.equal(Object.keys(led)[0], "schema_version");
    assert.equal(led.schema_version, 1);
    assert.deepEqual(evidence.validateEvidenceDocument("run-ledger.json", led).violations, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a mint with an unlisted key throws LEDGER_SCHEMA and creates no file", () => {
  const { root, runDir } = mkRunDir();
  try {
    assert.throws(() => mutateLedgerUnderLock(runDir, () => validLedger({ scratch: 1 })),
      (e) => e.code === "LEDGER_SCHEMA" && /scratch/.test(e.message));
    assert.equal(existsSync(ledgerPath(runDir)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a mutation adding an unlisted key throws and leaves ledger and events byte-identical, copy or in place", () => {
  const { root, runDir } = minted();
  try {
    const before = [bytesOf(ledgerPath(runDir)), bytesOf(path.join(runDir, "events.jsonl"))];
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, scratch: 1 })), (e) => e.code === "LEDGER_SCHEMA" && /scratch/.test(e.message));
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => { fresh.scratch = 1; return fresh; }), (e) => e.code === "LEDGER_SCHEMA");
    assert.deepEqual([bytesOf(ledgerPath(runDir)), bytesOf(path.join(runDir, "events.jsonl"))], before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("with { schema: 'warn' } the same mutation writes the ledger and warns", () => {
  const { root, runDir } = minted();
  try {
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, scratch: 1 }), undefined, { schema: "warn" }));
    assert.equal(readLedger(runDir).scratch, 1);
    assert.match(stderr(), /schema warning/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("changing an already invalid value to another invalid value at the same path is introduced", () => {
  const { root, runDir } = minted();
  try {
    writeRaw(runDir, { schema_version: 1, ...validLedger({ attempts: "one" }) });
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, attempts: "two" })), (e) => e.code === "LEDGER_SCHEMA");
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, stop_reason: "x" })));
    assert.equal(readLedger(runDir).attempts, "one", "an unrelated write leaves the legacy value alone");
    assert.match(stderr(), /1 pre-existing schema violation\(s\), first: .*attempts/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ledger with outcomes.FAFF-1 = promoted still accepts record-style writes elsewhere in the map", () => {
  const { root, runDir } = minted();
  try {
    writeRaw(runDir, { schema_version: 1, ...validLedger({ outcomes: { "FAFF-1": "promoted" } }) });
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcomes: { ...fresh.outcomes, "FAFF-2": "shipped" } })));
    assert.equal(readLedger(runDir).outcomes["FAFF-2"], "shipped");
    assert.match(stderr(), /pre-existing schema violation.*outcomes\.FAFF-1/);
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcomes: { ...fresh.outcomes, "FAFF-1": "bogus" } })), (e) => e.code === "LEDGER_SCHEMA");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("removing a required key is introduced; an unrelated write onto a ledger already missing one succeeds", () => {
  const { root, runDir } = minted({ outcome_details: {} });
  try {
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => { const next = structuredClone(fresh); delete next.run_id; return next; }),
      (e) => e.code === "LEDGER_SCHEMA" && /run_id/.test(e.message));
    const led = readLedger(runDir);
    delete led.run_id;
    writeRaw(runDir, led);
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, owner: { ...fresh.owner, last_heartbeat: "2026-10-14T01:00:00.000Z" } })));
    assert.match(stderr(), /pre-existing schema violation.*run_id/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a numeric outcome_details entry the mutation added is introduced", () => {
  const { root, runDir } = minted();
  try {
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcome_details: { "FAFF-1": 5 } })), (e) => e.code === "LEDGER_SCHEMA");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an outcome_details entry with an unlisted key and a nested object writes", () => {
  const { root, runDir } = minted();
  try {
    const entry = { merge: { sha: "abc1234", pr: 1 }, superseded_by: ["FAFF-2"] };
    mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcome_details: { "FAFF-1": entry } }));
    assert.deepEqual(readLedger(runDir).outcome_details["FAFF-1"], entry);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a pre-existing unlisted key is reported and left alone; dotted issue keys compare as single segments", () => {
  const { root, runDir } = minted();
  try {
    writeRaw(runDir, { schema_version: 1, ...validLedger({ scratch: 1, outcomes: { "A.B": "shipped" } }) });
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcomes: { ...fresh.outcomes, "C.D": "parked" } })));
    assert.equal(readLedger(runDir).outcomes["A.B"], "shipped");
    assert.equal(readLedger(runDir).outcomes["C.D"], "parked");
    assert.match(stderr(), /1 pre-existing schema violation\(s\), first: .*scratch/);
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, outcomes: { ...fresh.outcomes, "A.B": "bogus" } })), (e) => e.code === "LEDGER_SCHEMA");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a mutation that deletes schema_version, or sets it, still writes the snapshot's version", () => {
  const { root, runDir } = minted();
  try {
    mutateLedgerUnderLock(runDir, (fresh) => { const next = { ...fresh, stop_reason: "a" }; delete next.schema_version; return next; });
    assert.equal(readLedger(runDir).schema_version, 1);
    mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, schema_version: 7, stop_reason: "b" }));
    assert.equal(readLedger(runDir).schema_version, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a fenced-stale or null-returning mutation writes nothing and runs no validation", () => {
  const { root, runDir } = minted();
  try {
    const before = bytesOf(ledgerPath(runDir));
    const evBefore = bytesOf(path.join(runDir, "events.jsonl"));
    const nul = mutateLedgerUnderLock(runDir, () => null);
    assert.equal(nul.written, false);
    const stale = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, scratch: 1 }), { epoch: 5, session_id: "other" }));
    assert.equal(stale.result.yielded, true);
    assert.deepEqual([bytesOf(ledgerPath(runDir)), bytesOf(path.join(runDir, "events.jsonl"))], [before, evBefore]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ledger at schema_version 2 refuses in enforce mode, and warn mode keeps the 2", () => {
  const { root, runDir } = minted();
  try {
    writeRaw(runDir, { ...validLedger(), schema_version: 2 });
    const before = bytesOf(ledgerPath(runDir));
    assert.throws(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, stop_reason: "x" })), (e) => e.code === "LEDGER_SCHEMA_VERSION");
    assert.deepEqual(bytesOf(ledgerPath(runDir)), before);
    const { stderr } = captureStderr(() => mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, stop_reason: "x" }), undefined, { schema: "warn" }));
    assert.equal(readLedger(runDir).schema_version, 2);
    assert.equal(readLedger(runDir).stop_reason, "x");
    assert.match(stderr(), /schema_version is not 1/);
    const rebuilt = validLedger({ stop_reason: "y" });
    mutateLedgerUnderLock(runDir, () => rebuilt, undefined, { schema: "warn" });
    assert.equal(readLedger(runDir).schema_version, 2, "a rebuilt object without schema_version keeps the snapshot's version");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the ledger-write event hashes the stamped bytes (faff events verify reports the fold verified)", () => {
  const { root, runDir } = minted();
  try {
    mutateLedgerUnderLock(runDir, (fresh) => ({ ...fresh, stop_reason: "done" }));
    const r = spawnSync("node", [CLI, "events", "verify", "--run-dir", runDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const events = readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const last = events.filter((e) => e.type === "ledger-write").pop();
    const sha = require("node:crypto").createHash("sha256").update(readFileSync(ledgerPath(runDir))).digest("hex");
    assert.equal(last.data.ledger_sha256, sha);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the schema is loaded before the lock is taken", () => {
  const { root, runDir } = mkRunDir();
  const real = evidence.preloadEvidenceSchemas;
  let lockExistedAtLoad = null;
  evidence.preloadEvidenceSchemas = () => { lockExistedAtLoad = existsSync(path.join(runDir, "run-ledger.json.lock")); return real(); };
  try {
    mutateLedgerUnderLock(runDir, () => validLedger());
    assert.equal(lockExistedAtLoad, false);
  } finally { evidence.preloadEvidenceSchemas = real; rmSync(root, { recursive: true, force: true }); }
});

test("an unavailable schema refuses in enforce mode and writes with a warning in warn mode", () => {
  const plugin = path.join(REPO, "plugin", "skills", "faff");
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-noschema-"));
  try {
    const copy = path.join(tmp, "faff");
    require("node:fs").cpSync(plugin, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    rmSync(path.join(copy, "contracts", "evidence-v0.3", "anchor-manifest.json"));
    const script = `
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(copy, "bin", "lib", "heartbeat.js"))});
      const led = ${JSON.stringify(validLedger())};
      const dir = process.argv[1];
      try { mutateLedgerUnderLock(dir, () => led); console.log("WROTE"); } catch (e) { console.log(e.code, e.message); }
      try { mutateLedgerUnderLock(dir, () => led, undefined, { schema: "warn" }); console.log("WARN-WROTE"); } catch (e) { console.log("WARN-THREW", e.code); }
    `;
    const dir = path.join(tmp, "run");
    mkdirSync(dir);
    const r = spawnSync("node", ["-e", script, dir], { encoding: "utf8", cwd: tmp });
    assert.match(r.stdout, /LEDGER_SCHEMA_UNAVAILABLE .*anchor-manifest\.json/);
    assert.match(r.stdout, /WARN-WROTE/);
    assert.match(r.stderr, /schema unavailable/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("no serialiser message or stderr line contains a field value, including a known secret", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-secret-"));
  try {
    mkdirSync(path.join(tmp, ".git"));
    writeFileSync(path.join(tmp, ".faffrc.yaml"), "andon:\n  token: S3CR3T-SENTINEL\n");
    const runDir = path.join(tmp, ".faff", "runs", "RUN-S");
    mkdirSync(runDir, { recursive: true });
    const script = `
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(REPO, "plugin/skills/faff/bin/lib/heartbeat.js"))});
      const base = ${JSON.stringify(validLedger())};
      const out = [];
      const run = (label, fn, opts) => { try { fn(); out.push(label + ":ok"); } catch (e) { out.push(label + ":" + e.code + ":" + e.message); } };
      mutateLedgerUnderLock(process.argv[1], () => base);
      run("enum", () => mutateLedgerUnderLock(process.argv[1], (f) => ({ ...f, outcomes: { "FAFF-1": "S3CR3T-SENTINEL" } })));
      run("type", () => mutateLedgerUnderLock(process.argv[1], (f) => ({ ...f, attempts: "S3CR3T-SENTINEL" })));
      run("intfield", () => mutateLedgerUnderLock(process.argv[1], (f) => ({ ...f, owner: { ...f.owner, pid: "S3CR3T-SENTINEL" } })));
      require("node:fs").writeFileSync(process.argv[1] + "/run-ledger.json", JSON.stringify({ ...base, schema_version: "S3CR3T-SENTINEL" }));
      run("version", () => mutateLedgerUnderLock(process.argv[1], (f) => ({ ...f, stop_reason: "x" })));
      console.log(out.join("\\n"));
    `;
    const r = spawnSync("node", ["-e", script, runDir], { encoding: "utf8", cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /enum:LEDGER_SCHEMA/);
    assert.match(r.stdout, /version:LEDGER_SCHEMA_VERSION/);
    assert.doesNotMatch(r.stdout + r.stderr, /S3CR3T-SENTINEL/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("two known secrets that redact to the same placeholder in an integer field still count as a change", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-secret2-"));
  try {
    mkdirSync(path.join(tmp, ".git"));
    writeFileSync(path.join(tmp, ".faffrc.yaml"), "andon:\n  token: S3CR3T-SENTINEL\n  url: S3CR3T-OTHER-VALUE\n");
    const runDir = path.join(tmp, ".faff", "runs", "RUN-S");
    mkdirSync(runDir, { recursive: true });
    const script = `
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(REPO, "plugin/skills/faff/bin/lib/heartbeat.js"))});
      const fs = require("node:fs");
      const base = ${JSON.stringify(validLedger())};
      mutateLedgerUnderLock(process.argv[1], () => base);
      fs.writeFileSync(process.argv[1] + "/run-ledger.json", JSON.stringify({ schema_version: 1, ...base, owner: { ...base.owner, pid: "[REDACTED]" } }));
      try { mutateLedgerUnderLock(process.argv[1], (f) => ({ ...f, owner: { ...f.owner, pid: "S3CR3T-SENTINEL" } })); console.log("WROTE"); }
      catch (e) { console.log(e.code); }
    `;
    const r = spawnSync("node", ["-e", script, runDir], { encoding: "utf8", cwd: tmp });
    assert.equal(r.stdout.trim(), "LEDGER_SCHEMA", r.stderr);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("a known secret in a field is written redacted", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-secret3-"));
  try {
    mkdirSync(path.join(tmp, ".git"));
    writeFileSync(path.join(tmp, ".faffrc.yaml"), "andon:\n  token: S3CR3T-SENTINEL\n");
    const runDir = path.join(tmp, ".faff", "runs", "RUN-S");
    mkdirSync(runDir, { recursive: true });
    const script = `
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(REPO, "plugin/skills/faff/bin/lib/heartbeat.js"))});
      mutateLedgerUnderLock(process.argv[1], () => ({ ...${JSON.stringify(validLedger())}, stop_reason: "leaked S3CR3T-SENTINEL here" }));
    `;
    const r = spawnSync("node", ["-e", script, runDir], { encoding: "utf8", cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const raw = readFileSync(path.join(runDir, "run-ledger.json"), "utf8");
    assert.doesNotMatch(raw, /S3CR3T-SENTINEL/);
    assert.match(raw, /leaked \[REDACTED\] here/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("a known secret nested inside an outcome_details entry is written redacted", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1274-secret-"));
  try {
    mkdirSync(path.join(tmp, ".git"));
    writeFileSync(path.join(tmp, ".faffrc.yaml"), "andon:\n  token: S3CR3T-SENTINEL\n");
    const runDir = path.join(tmp, ".faff", "runs", "RUN-S");
    mkdirSync(runDir, { recursive: true });
    const details = { "FAFF-1": { merge: { sha: "abc1234", note: "leaked S3CR3T-SENTINEL here" } } };
    const script = `
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(REPO, "plugin/skills/faff/bin/lib/heartbeat.js"))});
      mutateLedgerUnderLock(process.argv[1], () => ({ ...${JSON.stringify(validLedger())}, outcome_details: ${JSON.stringify(details)} }));
    `;
    const r = spawnSync("node", ["-e", script, runDir], { encoding: "utf8", cwd: tmp });
    assert.equal(r.status, 0, r.stderr);
    const raw = readFileSync(path.join(runDir, "run-ledger.json"), "utf8");
    assert.doesNotMatch(raw, /S3CR3T-SENTINEL/);
    assert.equal(JSON.parse(raw).outcome_details["FAFF-1"].merge.note, "leaked [REDACTED] here");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("the three run-state schemas contain no discriminator keyword", () => {
  const walk = (node) => {
    if (Array.isArray(node)) return node.some(walk);
    if (node && typeof node === "object") return "discriminator" in node || Object.values(node).some(walk);
    return false;
  };
  for (const name of ["run-ledger", "build-progress", "landing-progress"]) {
    const schema = JSON.parse(readFileSync(path.join(REPO, "plugin/skills/faff/contracts/evidence-v0.3/schema", `${name}.schema.json`), "utf8"));
    assert.equal(walk(schema), false, `${name} uses no discriminator`);
  }
});

test("validateEvidenceDocument matches validate-schema.mjs messages and reports unavailable when the manifest is missing", async () => {
  const schema = JSON.parse(readFileSync(path.join(REPO, "plugin/skills/faff/contracts/evidence-v0.3/schema/run-ledger.schema.json"), "utf8"));
  const { validateAgainstSchema } = await import("../plugin/skills/faff/contracts/validate-schema.mjs");
  const table = [
    validLedger({ schema_version: 1 }),
    { ...validLedger(), schema_version: 1, scratch: 1 },
    { schema_version: 2, run_id: "x" },
    { run_id: 5 },
    { schema_version: 1, run_id: "r", outcomes: { a: "bogus" }, owner: { status: 3 } },
    [],
    null,
  ];
  for (const doc of table) {
    const got = evidence.validateEvidenceDocument("run-ledger.json", doc);
    assert.deepEqual(got.violations.map((v) => v.message), validateAgainstSchema(doc, schema));
    assert.equal(got.ok, got.violations.length === 0);
  }
  const unknown = evidence.validateEvidenceDocument("no-such-file.json", {});
  assert.equal(unknown.ok, false);
  assert.ok(unknown.unavailable);
});

test("detailed paths for required and additionalProperties violations end in the property name", () => {
  const { validateAgainstSchemaDetailed, validateAgainstSchema } = require("../plugin/skills/faff/bin/lib/contract-engine.js");
  const schema = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "string" }, list: { type: "array", items: { type: "object", additionalProperties: false, properties: {} } } } };
  const doc = { list: [{ extra: 1 }], zzz: 1 };
  const detailed = validateAgainstSchemaDetailed(doc, schema);
  assert.deepEqual(detailed.map((v) => v.path).sort(), [["a"], ["list", 0, "extra"], ["zzz"]].sort());
  assert.deepEqual(detailed.map((v) => v.message), validateAgainstSchema(doc, schema));
});

test("introducedViolations: ownership is per changed path", () => {
  const before = { schema_version: 1, ...validLedger({ outcomes: { "FAFF-1": "promoted" } }) };
  const afterRaw = validLedger({ outcomes: { "FAFF-1": "promoted", "FAFF-2": "shipped" } });
  const after = { schema_version: 1, ...afterRaw };
  const violations = evidence.validateEvidenceDocument("run-ledger.json", after).violations;
  assert.equal(violations.length, 1);
  assert.deepEqual(evidence.introducedViolations("run-ledger.json", before, after, violations, before, afterRaw), []);
  const changedRaw = validLedger({ outcomes: { "FAFF-1": "bogus" } });
  const changed = { schema_version: 1, ...changedRaw };
  const cv = evidence.validateEvidenceDocument("run-ledger.json", changed).violations;
  assert.equal(evidence.introducedViolations("run-ledger.json", before, changed, cv, before, changedRaw).length, 1);
  assert.equal(evidence.introducedViolations("run-ledger.json", null, after, violations, null, afterRaw).length, 1, "a mint owns every violation");
});

// ---- rules that need a schema with required owner keys and minItems: a narrowed copy of the plugin ----

function withNarrowedSchema(narrow, scriptBody) {
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-narrowed-"));
  try {
    const copy = path.join(tmp, "faff");
    require("node:fs").cpSync(path.join(REPO, "plugin", "skills", "faff"), copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    const p = path.join(copy, "contracts", "evidence-v0.3", "schema", "run-ledger.schema.json");
    const schema = JSON.parse(readFileSync(p, "utf8"));
    narrow(schema.properties);
    writeFileSync(p, JSON.stringify(schema));
    const dir = path.join(tmp, "run");
    mkdirSync(dir);
    const script = `
      const fs = require("node:fs");
      const { mutateLedgerUnderLock } = require(${JSON.stringify(path.join(copy, "bin", "lib", "heartbeat.js"))});
      const base = ${JSON.stringify(validLedger())};
      const dir = process.argv[1];
      const attempt = (label, fn) => { try { fn(); console.log(label + ":ok"); } catch (e) { console.log(label + ":" + e.code + ":" + e.message); } };
      ${scriptBody}
    `;
    const r = spawnSync("node", ["-e", script, dir], { encoding: "utf8", cwd: tmp });
    return { stdout: r.stdout, stderr: r.stderr };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test("removing a required owner key is introduced (path owner.status); a write onto an owner already missing one succeeds", () => {
  const r = withNarrowedSchema((p) => { p.owner.required = ["status"]; }, `
    mutateLedgerUnderLock(dir, () => base);
    attempt("remove", () => mutateLedgerUnderLock(dir, (f) => { const n = structuredClone(f); delete n.owner.status; return n; }));
    const led = JSON.parse(fs.readFileSync(dir + "/run-ledger.json", "utf8"));
    delete led.owner.status;
    fs.writeFileSync(dir + "/run-ledger.json", JSON.stringify(led));
    attempt("heartbeat", () => mutateLedgerUnderLock(dir, (f) => ({ ...f, owner: { ...f.owner, last_heartbeat: "2026-10-14T01:00:00.000Z" } })));
    attempt("clear", () => mutateLedgerUnderLock(dir, (f) => ({ ...f, owner: { ...f.owner, status: 5 } })));
  `);
  assert.match(r.stdout, /remove:LEDGER_SCHEMA:.*owner: missing required property "status"/);
  assert.match(r.stdout, /heartbeat:ok/);
  assert.match(r.stderr, /pre-existing schema violation.*status/);
  assert.match(r.stdout, /clear:LEDGER_SCHEMA/);
});

test("a minItems violation on an array the mutation shrank is introduced", () => {
  const r = withNarrowedSchema((p) => { p.admitted.minItems = 2; }, `
    mutateLedgerUnderLock(dir, () => base);
    attempt("shrink", () => mutateLedgerUnderLock(dir, (f) => ({ ...f, admitted: ["FAFF-1"] })));
    attempt("grow", () => mutateLedgerUnderLock(dir, (f) => ({ ...f, admitted: [...f.admitted, "FAFF-3"] })));
  `);
  assert.match(r.stdout, /shrink:LEDGER_SCHEMA:.*at least 2 items/);
  assert.match(r.stdout, /grow:ok/);
});
