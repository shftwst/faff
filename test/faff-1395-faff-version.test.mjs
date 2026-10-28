// FAFF-1395 — runs, preps and grafts record which faff release wrote them.
//
// The resolver (`faff-version.js`), the `faff version` command, and the optional `faff_version`
// field every durable record carries. Value assertions read `plugin/.claude-plugin/plugin.json`
// itself, so they stay true across release bumps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCli } from "./helpers/run-cli.mjs";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const LIB = path.join(PLUGIN, "bin", "lib");
const { resolveFaffVersion, stampFaffVersion } = require(path.join(LIB, "faff-version.js"));
const { emitGenesisRunStart, verifyChain, verifyExitCode } = require(path.join(LIB, "events.js"));
const { applyResumeToLedger } = require(path.join(LIB, "resume.js"));
const { buildInteractiveLedger, buildSelfDrainLedger } = require(path.join(LIB, "run-ledger.js"));
const { classifySchemaChange, validateEvidenceDocument } = require(path.join(LIB, "evidence.js"));
const { writeMergeRecord } = require(path.join(LIB, "merge-gate-floor.js"));
const { buildIssueSubtree } = require(path.join(LIB, "judge-trail.js"));
const { buildHoldoutRecord } = require(path.join(LIB, "holdout-record.js"));

const RELEASE = JSON.parse(readFileSync(path.join(REPO, "plugin", ".claude-plugin", "plugin.json"), "utf8")).version;
const FRAGMENT_DESCRIPTION = "faff plugin release version that wrote this document (FAFF-1395); \"unknown\" when unresolved; absent on documents written before FAFF-1395";

const mkTmp = (p) => mkdtempSync(path.join(tmpdir(), p));
const cleanEnv = () => ({ PATH: process.env.PATH, HOME: process.env.HOME, FAFF_HARNESS_MODEL: "test-model" });
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readEvents = (runDir) => readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// ---------------------------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------------------------

const MODULE_DIR = path.join(path.sep, "x", "plugin", "skills", "faff", "bin", "lib");
const resolveWith = (manifest, extra = {}) => resolveFaffVersion({
  moduleDir: MODULE_DIR,
  readFile: () => (typeof manifest === "string" ? manifest : JSON.stringify(manifest)),
  ...extra,
});
const UNKNOWN = { version: "unknown", source: "default" };

test("resolver: this checkout resolves the plugin.json release", () => {
  assert.deepEqual(resolveFaffVersion(), { version: RELEASE, source: "plugin-json" });
});

test("resolver: a valid and a prerelease version resolve", () => {
  assert.deepEqual(resolveWith({ name: "faff", version: "0.42.0" }), { version: "0.42.0", source: "plugin-json" });
  assert.deepEqual(resolveWith({ name: "faff", version: "0.43.0-rc.1" }), { version: "0.43.0-rc.1", source: "plugin-json" });
});

test("resolver: every unusable manifest degrades to unknown without throwing", () => {
  const cases = {
    "missing file": () => resolveFaffVersion({ moduleDir: MODULE_DIR, readFile: () => { throw new Error("ENOENT"); } }),
    "not JSON": () => resolveWith("not json"),
    "array": () => resolveWith("[1]"),
    "null": () => resolveWith("null"),
    "wrong name": () => resolveWith({ name: "other", version: "0.42.0" }),
    "missing version": () => resolveWith({ name: "faff" }),
    "non-string version": () => resolveWith({ name: "faff", version: 42 }),
    "two-part version": () => resolveWith({ name: "faff", version: "0.42" }),
    "dangling prerelease": () => resolveWith({ name: "faff", version: "0.42.0-" }),
    "word": () => resolveWith({ name: "faff", version: "latest" }),
    "empty": () => resolveWith({ name: "faff", version: "" }),
  };
  for (const [label, run] of Object.entries(cases)) assert.deepEqual(run(), UNKNOWN, label);
});

test("resolver: a module directory that does not end in skills/faff/bin/lib is unknown, however deep", () => {
  const valid = JSON.stringify({ name: "faff", version: "0.42.0" });
  for (const moduleDir of [
    path.join(path.sep, "x", "ctx", "lib"),
    path.join(path.sep, "opt", "commissaire", "abc123"),
    path.join(path.sep, "repo", "plugin", "skills", "faff", "bin", "lib", "ctx", "lib"),
  ]) {
    assert.deepEqual(resolveFaffVersion({ moduleDir, readFile: () => valid }), UNKNOWN, moduleDir);
  }
});

test("resolver: a failed read is not memoised and injected calls leave the memo alone", () => {
  // The memo is module-private; observe it through a fresh module instance per case.
  const fresh = () => {
    delete require.cache[require.resolve(path.join(LIB, "faff-version.js"))];
    return require(path.join(LIB, "faff-version.js"));
  };
  try {
    const m = fresh();
    assert.deepEqual(m.resolveFaffVersion({ moduleDir: MODULE_DIR, readFile: () => { throw new Error("EIO"); } }), UNKNOWN);
    assert.equal(m.resolveFaffVersion().version, RELEASE, "a later call still resolves");
    m.resolveFaffVersion({ moduleDir: MODULE_DIR, readFile: () => JSON.stringify({ name: "faff", version: "9.9.9" }) });
    assert.equal(m.resolveFaffVersion().version, RELEASE, "an injected call did not replace the memo");
  } finally {
    fresh();
  }
});

test("stampFaffVersion: second key after schema_version, first without one, never mutates", () => {
  const doc = { schema_version: 1, all_verified: true };
  const out = stampFaffVersion(doc, "0.42.0");
  assert.deepEqual(Object.keys(out), ["schema_version", "faff_version", "all_verified"]);
  assert.deepEqual(Object.keys(doc), ["schema_version", "all_verified"]);
  assert.deepEqual(Object.keys(stampFaffVersion({ a: 1 }, "0.42.0")), ["faff_version", "a"]);
});

// ---------------------------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------------------------

test("faff version prints the bare release and exits 0", () => {
  const r = runCli(["version"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${RELEASE}\n`);
});

test("faff version --json prints version and source", () => {
  const r = runCli(["version", "--json"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${JSON.stringify({ version: RELEASE, source: "plugin-json" })}\n`);
});

test("faff version with an unknown flag is a usage error (exit 2)", () => {
  assert.equal(runCli(["version", "--bogus"]).code, 2);
});

test("faff version --selftest passes", () => {
  const r = runCli(["version", "--selftest"]);
  assert.equal(r.code, 0, r.stderr);
});

// ---------------------------------------------------------------------------------------------
// Copied tree: the integration smoke, step 2 (no plugin.json four levels above bin/lib)
// ---------------------------------------------------------------------------------------------

function copiedPlugin(t) {
  const dir = mkTmp("faff-1395-copy-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dest = path.join(dir, "faff");
  cpSync(PLUGIN, dest, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
  return path.join(dest, "bin", "faff");
}

test("a copied bin/lib has no plugin.json above it: every command still exits 0 and stamps unknown", (t) => {
  const bin = copiedPlugin(t);
  const run = (args, cwd) => spawnSync("node", [bin, ...args], { encoding: "utf8", cwd, env: cleanEnv() });
  const v = run(["version", "--json"], os_tmp());
  assert.equal(v.status, 0);
  assert.deepEqual(JSON.parse(v.stdout), UNKNOWN);

  const root = mkTmp("faff-1395-root-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q", root]);
  const mint = run(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root], root);
  assert.equal(mint.status, 0, mint.stderr);
  const runDir = mint.stdout.trim();
  assert.equal(readJson(path.join(runDir, "run-ledger.json")).owner.faff_version, "unknown");
  assert.deepEqual(readEvents(runDir).find((e) => e.type === "run-start").data, { faff_version: "unknown" });
  assert.equal(run(["events", "verify", "--run-dir", runDir], root).status, 0);

  const ac = spawnSync("node", [bin, "evidence", "write", "ac-checklist", "--run-dir", runDir, "--issue", "FAFF-1"], { encoding: "utf8", cwd: root, env: cleanEnv(), input: JSON.stringify({ all_verified: true }) });
  assert.equal(ac.status, 0, ac.stderr);
  assert.deepEqual(Object.keys(readJson(path.join(runDir, "FAFF-1", "ac-checklist.json"))), ["schema_version", "faff_version", "all_verified"]);
  assert.equal(readJson(path.join(runDir, "FAFF-1", "ac-checklist.json")).faff_version, "unknown");
});

function os_tmp() { return tmpdir(); }

// ---------------------------------------------------------------------------------------------
// Ledger owner, resume, genesis
// ---------------------------------------------------------------------------------------------

test("init-interactive and init-self-drain stamp the release into owner and the genesis data", (t) => {
  const root = mkTmp("faff-1395-mint-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const l2 = runCli(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root], { env: cleanEnv() });
  assert.equal(l2.code, 0, l2.stderr);
  const l2Dir = l2.stdout.trim();
  assert.equal(readJson(path.join(l2Dir, "run-ledger.json")).owner.faff_version, RELEASE);
  assert.deepEqual(readEvents(l2Dir).find((e) => e.type === "run-start").data, { faff_version: RELEASE });
  assert.equal(verifyExitCode(verifyChain(l2Dir), "fail"), 0);

  const l3 = runCli(["run-ledger", "init-self-drain", "--root", root], { env: cleanEnv() });
  assert.equal(l3.code, 0, l3.stderr);
  const l3Dir = l3.stdout.trim();
  assert.equal(readJson(path.join(l3Dir, "run-ledger.json")).owner.faff_version, RELEASE);
  const l3Start = readEvents(l3Dir).find((e) => e.type === "run-start");
  assert.deepEqual(l3Start.data, { level: "L3", faff_version: RELEASE });
  assert.deepEqual(Object.keys(l3Start.data), ["level", "faff_version"]);
  assert.equal(verifyExitCode(verifyChain(l3Dir), "fail"), 0);
});

test("owner.faff_version survives a later ledger write through to the terminal done", (t) => {
  const root = mkTmp("faff-1395-owner-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mint = runCli(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root], { env: cleanEnv() });
  const runDir = mint.stdout.trim();
  const rec = runCli(["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "parked", "--run-dir", runDir], { env: cleanEnv(), cwd: root });
  assert.equal(rec.code, 0, rec.stderr);
  const led = readJson(path.join(runDir, "run-ledger.json"));
  assert.equal(led.owner.status, "done");
  assert.equal(led.owner.faff_version, RELEASE);
});

test("the L4 genesis data is exactly { level, faff_version } and the chain verifies", (t) => {
  const root = mkTmp("faff-1395-l4-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, ".faff", "runs", "run-20991231-000000-l4");
  mkdirSync(runDir, { recursive: true });
  const rec = emitGenesisRunStart(runDir, { level: "L4" });
  assert.deepEqual(rec.data, { level: "L4", faff_version: RELEASE });
  assert.deepEqual(Object.keys(rec.data), ["level", "faff_version"]);
  assert.equal(verifyExitCode(verifyChain(runDir), "fail"), 0);
});

test("ledger builders take the version as a parameter and omit the field when none is supplied", () => {
  const base = { runId: "r", issue: "FAFF-1", nowIso: "2026-01-01T00:00:00.000Z", sessionId: null, pid: 1 };
  assert.deepEqual(Object.keys(buildInteractiveLedger({ ...base, faffVersion: "0.42.0" }).owner), ["status", "session_id", "pid", "started_at", "last_heartbeat", "faff_version"]);
  assert.equal(buildSelfDrainLedger({ ...base, faffVersion: "0.42.0" }).owner.faff_version, "0.42.0");
  assert.equal("faff_version" in buildInteractiveLedger(base).owner, false);
});

test("a resume moves the prior owner (with its version) to owner_history and stamps the resuming release", () => {
  const before = {
    run_id: "R", admitted: ["A"], outcomes: {},
    owner: { status: "aborted-resumable", session_id: "old", epoch: 0, started_at: "t0", faff_version: "0.42.0" },
  };
  const plan = { skip: [], redispatch: [], park: [] };
  const { ledger } = applyResumeToLedger(before, { nowIso: "t1", sessionId: "new", pid: 2, priorState: "aborted-resumable", plan, faffVersion: "0.43.0" });
  assert.deepEqual(ledger.owner_history, [before.owner]);
  assert.equal(ledger.owner_history.at(-1).faff_version, "0.42.0");
  assert.equal(ledger.owner.faff_version, "0.43.0");
  assert.equal(before.owner.faff_version, "0.42.0", "the input is not mutated");
});

test("a ledger with no owner.faff_version takes an ordinary write with no schema error and no added field", (t) => {
  const root = mkTmp("faff-1395-legacy-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mint = runCli(["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root], { env: cleanEnv() });
  const runDir = mint.stdout.trim();
  const file = path.join(runDir, "run-ledger.json");
  const led = readJson(file);
  delete led.owner.faff_version;
  writeFileSync(file, JSON.stringify(led, null, 2) + "\n");
  const rec = runCli(["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "parked", "--run-dir", runDir], { env: cleanEnv(), cwd: root });
  assert.equal(rec.code, 0, rec.stderr);
  assert.equal("faff_version" in readJson(file).owner, false);
});

// ---------------------------------------------------------------------------------------------
// Other writers
// ---------------------------------------------------------------------------------------------

test("build-progress and landing-progress restamp the current writer's release on every write", (t) => {
  const root = mkTmp("faff-1395-prog-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".git"));
  const runDir = path.join(root, ".faff", "runs", "RUN-P");
  mkdirSync(path.join(runDir, "FAFF-1"), { recursive: true });
  const cli = (args) => runCli(args, { cwd: root, env: cleanEnv() });
  assert.equal(cli(["build-progress", "write", runDir, "FAFF-1", "--build-complete", "--diff-hash", "h", "--branch", "b"]).code, 0);
  const build = readJson(path.join(runDir, "FAFF-1", "build-progress.json"));
  assert.deepEqual(Object.keys(build).slice(0, 2), ["schema_version", "faff_version"]);
  assert.equal(build.faff_version, RELEASE);
  assert.deepEqual(validateEvidenceDocument("build-progress.json", build).violations, []);

  // a record stamped by an older release is restamped, not carried
  const landingFile = path.join(runDir, "FAFF-1", "landing-progress.json");
  writeFileSync(landingFile, JSON.stringify({
    schema_version: 1, faff_version: "0.0.1", issue: "FAFF-1", fix_cycles: 0, last_head_sha: "abc", history: [], updated_at: "2026-01-01T00:00:00.000Z",
  }));
  const rc = cli(["landing-progress", "record-fix-cycle", runDir, "FAFF-1", "--kind", "regression", "--head-sha", "def"]);
  assert.equal(rc.code, 0, rc.stderr);
  const landing = readJson(landingFile);
  assert.deepEqual(Object.keys(landing).slice(0, 2), ["schema_version", "faff_version"]);
  assert.equal(landing.faff_version, RELEASE);
  assert.deepEqual(validateEvidenceDocument("landing-progress.json", landing).violations, []);
});

test("writeMergeRecord stamps the release beside harness and model, with an injectable override", (t) => {
  const root = mkTmp("faff-1395-merge-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, "run");
  mkdirSync(runDir, { recursive: true });
  writeMergeRecord(runDir, "FAFF-1", 7, "abc123", "asserted", { harness: "claude-code", model: "m" }, null);
  const rec = readJson(path.join(runDir, "FAFF-1", "merge-record.json"));
  assert.equal(rec.faff_version, RELEASE);
  assert.equal(rec.harness, "claude-code");
  writeMergeRecord(runDir, "FAFF-2", 8, "def456", "asserted", null, null, "unknown");
  assert.equal(readJson(path.join(runDir, "FAFF-2", "merge-record.json")).faff_version, "unknown");
});

test("intake-record stamps the release beside schema, keeps PROVENANCE_SCHEMA 2, and the no-downgrade path writes nothing", (t) => {
  const root = mkTmp("faff-1395-intake-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, ".git"));
  const cli = (args) => runCli(args, { cwd: root, env: cleanEnv() });
  assert.equal(cli(["intake-record", "FAFF-1", "--via", "jot", "--root", root]).code, 0);
  const p = path.join(root, ".faff", "provenance", "FAFF-1.json");
  const m = readJson(p);
  assert.equal(m.schema, 2);
  assert.equal(m.faff_version, RELEASE);
  // an older marker keeps what it had when backfill refuses to downgrade it
  writeFileSync(p, JSON.stringify({ ...m, faff_version: "0.0.1" }));
  const before = readFileSync(p, "utf8");
  assert.equal(cli(["intake-record", "FAFF-1", "--via", "backfill", "--root", root]).code, 0);
  assert.equal(readFileSync(p, "utf8"), before);
});

test("the judge-trail manifest and the holdout record carry the release", (t) => {
  const root = mkTmp("faff-1395-trail-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, "run");
  const specReview = path.join(root, "spec-review");
  const judge = path.join(root, "judge");
  for (const d of [runDir, specReview, judge]) mkdirSync(d, { recursive: true });
  const { manifest } = buildIssueSubtree(runDir, "FAFF-1", specReview, judge);
  assert.deepEqual(Object.keys(manifest).slice(0, 2), ["schema_version", "faff_version"]);
  assert.equal(manifest.faff_version, RELEASE);

  // the fail-closed document (no classification to check against) is stamped like the success one
  const refused = buildHoldoutRecord(null, { issue: "FAFF-1" }).doc;
  assert.equal(refused.faff_version, RELEASE);
  assert.deepEqual(Object.keys(refused).slice(0, 2), ["schema_version", "faff_version"]);
  assert.deepEqual(validateEvidenceDocument("holdout.json", refused).violations, []);
});

// ---------------------------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------------------------

const BUNDLE = path.join(PLUGIN, "contracts", "evidence-v0.3");
const SOURCE = path.join(REPO, "verification", "evidence", "v0.3");
const TOP_LEVEL = ["ac-checklist", "review-verdict-anchored", "review-round", "spec-review-verdict-anchored", "build-progress", "landing-progress", "holdout-anchored"];

function withoutFaffVersion(schema) {
  const copy = JSON.parse(JSON.stringify(schema));
  const strip = (node) => {
    if (node && typeof node === "object") {
      if (node.properties && "faff_version" in node.properties) delete node.properties.faff_version;
      for (const v of Object.values(node)) strip(v);
    }
  };
  strip(copy);
  return copy;
}

test("each changed schema gains exactly the optional faff_version string and classifies as additive", () => {
  const files = [
    ...TOP_LEVEL.map((n) => `${n}.schema.json`),
    "run-ledger.schema.json",
    "events/run-start.schema.json",
  ];
  for (const f of files) {
    const head = readJson(path.join(BUNDLE, "schema", f));
    const base = withoutFaffVersion(head);
    assert.deepEqual(classifySchemaChange(base, head), { additive: true, reasons: [] }, f);
    assert.ok(JSON.stringify(head).includes('"faff_version"'), f);
    assert.deepEqual(head.required ?? [], (base.required ?? []), `${f}: no required change`);
  }
  for (const n of TOP_LEVEL) {
    const prop = readJson(path.join(BUNDLE, "schema", `${n}.schema.json`)).properties.faff_version;
    assert.deepEqual(prop, { type: "string", description: FRAGMENT_DESCRIPTION }, n);
  }
  const ledger = readJson(path.join(BUNDLE, "schema", "run-ledger.schema.json"));
  assert.deepEqual(ledger.properties.owner.properties.faff_version, { type: "string", description: FRAGMENT_DESCRIPTION });
  assert.deepEqual(ledger.properties.owner_history.items.properties.faff_version, { type: "string", description: FRAGMENT_DESCRIPTION });
  // The manifest maps events.jsonl to the generated run-event.schema.json, which inlines every per-type
  // schema under one discriminator mapping; classifySchemaChange compares a discriminator by equality,
  // so it is checked for the property rather than for additivity.
  const runEvent = readJson(path.join(BUNDLE, "schema", "run-event.schema.json"));
  assert.ok(JSON.stringify(runEvent).includes(JSON.stringify({ type: "string", description: FRAGMENT_DESCRIPTION })));
  const runStart = readJson(path.join(BUNDLE, "schema", "events", "run-start.schema.json"));
  assert.deepEqual(runStart.properties.data.properties.faff_version, { type: "string", description: FRAGMENT_DESCRIPTION });
});

test("the bundled evidence tree and the verification source tree are byte-identical", () => {
  const r = spawnSync("diff", ["-rq", SOURCE, BUNDLE], { encoding: "utf8" });
  assert.equal(r.stdout, "");
  assert.equal(r.status, 0);
});

test("no top-level contract schema mentions faff_version, so contract_schema_versions is unchanged", () => {
  const dir = path.join(PLUGIN, "contracts");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".schema.json"))) {
    assert.ok(!readFileSync(path.join(dir, f), "utf8").includes("faff_version"), f);
  }
});

test("no writer other than faff-version.js reads plugin.json", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === "node_modules") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|ts)$/.test(name) || name === "faff") {
        if (readFileSync(full, "utf8").includes("claude-plugin") && name !== "faff-version.js") offenders.push(path.relative(REPO, full));
      }
    }
  };
  for (const skill of readdirSync(path.join(REPO, "plugin", "skills"))) {
    const bin = path.join(REPO, "plugin", "skills", skill, "bin");
    if (existsSync(bin)) walk(bin);
  }
  assert.deepEqual(offenders, []);
});
