// FAFF-1306 — a refused ledger write or genesis emit in the L4 `faff lights-out` mint is a
// structured `--json` refusal, not an uncaught stack trace, and a ledger that never landed leaves
// no run dir behind. mintLightsOut is not exported and sits behind the L4 preflight, so each case
// drives the exported cmdLightsOut in-process (in a fresh node process, with the two writes stubbed
// on their module exports before lights-out.js destructures them) against the same proceed-path
// fixture test/lights-out.test.mjs's tmpRoot() writes, threading faff's full COMMANDS registry as
// bin/faff does so every CLI-backed guardrail reads present.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const LIB = path.join(PLUGIN, "bin", "lib");
const BIN = path.join(PLUGIN, "bin", "faff");

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

// The proceed-path fixture from test/lights-out.test.mjs's tmpRoot(): coherent dial (adversarial
// review + spec_review slots, fail-closed gates), a budget.tokens ceiling with on_estimate_only:
// warn, and engine_bounded attested so a host docker socket never adds an unrelated refusal.
function tmpRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-lo-1306-"));
  roots.push(dir);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".faffrc.yaml"),
    "slots:\n  review: faffter-dark-adversarial-review\n  spec_review: faffter-dark-spec-review\ngates:\n  fallback: fail-closed\nbudget:\n  tokens: 50000000\n  on_estimate_only: warn\nautonomous:\n  engine_bounded: true\n");
  return dir;
}

const runsOf = (root) => path.join(root, ".faff", "runs");

function cleanEnv() {
  const e = { ...process.env, KUBERNETES_SERVICE_HOST: "10.0.0.1", FAFF_SESSION_ID: "test-lo-1306" };
  delete e.FAFF_RUN_DIR;
  return e;
}

// `heartbeatStub` / `eventsStub` are function bodies replacing mutateLedgerUnderLock /
// emitGenesisRunStart ("" leaves the real export). They are installed on the module exports
// before lights-out.js (and bin/faff, which lazily requires it) is first loaded.
function runMint({ heartbeatStub = "", eventsStub = "" } = {}) {
  const root = tmpRoot();
  const script = `
    const heartbeat = require(${JSON.stringify(path.join(LIB, "heartbeat.js"))});
    const events = require(${JSON.stringify(path.join(LIB, "events.js"))});
    if (${JSON.stringify(heartbeatStub)}) heartbeat.mutateLedgerUnderLock = () => { ${heartbeatStub} };
    if (${JSON.stringify(eventsStub)}) events.emitGenesisRunStart = () => { ${eventsStub} };
    const { COMMANDS } = require(${JSON.stringify(BIN)});
    const { cmdLightsOut } = require(${JSON.stringify(path.join(LIB, "lights-out.js"))});
    const realOut = process.stdout.write.bind(process.stdout);
    let out = "", err = "";
    process.stdout.write = (c) => { out += c; return true; };
    process.stderr.write = (c) => { err += c; return true; };
    let code, threw = null;
    try { code = cmdLightsOut(["--root", ${JSON.stringify(root)}, "--max", "5", "--json"], COMMANDS); }
    catch (e) { threw = String(e && e.stack || e); }
    realOut(JSON.stringify({ code, out, err, threw }));
  `;
  const r = spawnSync("node", ["-e", script], { encoding: "utf8", env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return { root, ...JSON.parse(r.stdout) };
}

const SCHEMA = `throw Object.assign(new Error("run-ledger schema unavailable: test"), { code: "LEDGER_SCHEMA_UNAVAILABLE" });`;
const LOCKED = `throw Object.assign(new Error("ledger lock: could not acquire"), { code: "LEDGER_LOCKED" });`;
const WRITTEN_FALSE = `return { written: false, yielded: false, before_sha256: null, after_sha256: null };`;
const GENESIS_THROWS = `throw new Error("genesis refused");`;

function refusal(r) {
  assert.equal(r.threw, null, `cmdLightsOut must not throw: ${r.threw}`);
  const lines = r.out.trim().split("\n");
  assert.equal(lines.length, 1, r.out);
  const payload = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(payload).sort(), ["error", "level", "proceed"]);
  assert.equal(payload.proceed, false);
  assert.equal(payload.level, "L4");
  assert.equal(typeof payload.error, "string");
  assert.ok(payload.error.length > 0);
  return payload;
}

test("a schema-refused ledger write is a structured exit-1 refusal and leaves no run dir", () => {
  const r = runMint({ heartbeatStub: SCHEMA });
  const payload = refusal(r);
  assert.equal(r.code, 1, r.out);
  assert.match(payload.error, /^faff lights-out: .*schema unavailable.* — no ledger minted$/);
  assert.deepEqual(fs.readdirSync(runsOf(r.root)), []);
});

test("a LEDGER_LOCKED failure is a named exit-3 refusal, not a stack trace, and leaves no run dir", () => {
  const r = runMint({ heartbeatStub: LOCKED });
  const payload = refusal(r);
  assert.equal(r.code, 3, r.out);
  assert.match(payload.error, /^faff lights-out: could not write .*run-ledger\.json \(lock contention\/abort\) — no ledger minted$/);
  assert.ok(!payload.error.includes("    at "), "no stack frames in the refusal");
  assert.deepEqual(fs.readdirSync(runsOf(r.root)), []);
});

test("a non-throwing written:false result is an exit-3 refusal and leaves no run dir", () => {
  const r = runMint({ heartbeatStub: WRITTEN_FALSE });
  refusal(r);
  assert.equal(r.code, 3, r.out);
  assert.deepEqual(fs.readdirSync(runsOf(r.root)), []);
});

test("without --json a refused ledger write names itself on stderr and prints nothing on stdout", () => {
  const root = tmpRoot();
  const script = `
    const heartbeat = require(${JSON.stringify(path.join(LIB, "heartbeat.js"))});
    heartbeat.mutateLedgerUnderLock = () => { ${LOCKED} };
    const { COMMANDS } = require(${JSON.stringify(BIN)});
    const { cmdLightsOut } = require(${JSON.stringify(path.join(LIB, "lights-out.js"))});
    const realOut = process.stdout.write.bind(process.stdout);
    let out = "", err = "";
    process.stdout.write = (c) => { out += c; return true; };
    process.stderr.write = (c) => { err += c; return true; };
    const code = cmdLightsOut(["--root", ${JSON.stringify(root)}, "--max", "5"], COMMANDS);
    realOut(JSON.stringify({ code, out, err }));
  `;
  const r = spawnSync("node", ["-e", script], { encoding: "utf8", env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.equal(res.code, 3);
  assert.match(res.err, /faff lights-out: could not write .*run-ledger\.json \(lock contention\/abort\) — no ledger minted\n$/);
  assert.equal(res.out.includes("Preflight PASS"), false);
  assert.deepEqual(fs.readdirSync(runsOf(root)), []);
});

test("a genesis-emit failure is an exit-3 refusal that keeps the ledger-bearing run dir", () => {
  const r = runMint({ eventsStub: GENESIS_THROWS });
  const payload = refusal(r);
  assert.equal(r.code, 3, r.out);
  assert.match(payload.error, /could not append the genesis run-start event in .*: genesis refused \(ledger written, no chain\) — mint NOT reported successful$/);
  const dirs = fs.readdirSync(runsOf(r.root));
  assert.equal(dirs.length, 1);
  assert.ok(fs.existsSync(path.join(runsOf(r.root), dirs[0], "run-ledger.json")));
  // The locked ledger write folds its own ledger-write event, but no run-start genesis landed.
  const eventsPath = path.join(runsOf(r.root), dirs[0], "events.jsonl");
  const types = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l).type) : [];
  assert.ok(!types.includes("run-start"), JSON.stringify(types));
});

test("a successful lights-out mint is unchanged: exit 0, proceed:true, ledger and genesis chain on disk", () => {
  const r = runMint();
  assert.equal(r.threw, null, r.threw);
  assert.equal(r.code, 0, r.out + r.err);
  const payload = JSON.parse(r.out.trim().split("\n").pop());
  assert.equal(payload.proceed, true);
  assert.equal(payload.level, "L4");
  const runDir = payload.run_dir;
  assert.equal(path.dirname(runDir), runsOf(r.root));
  const ledger = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.level, "L4");
  assert.equal(ledger.owner.status, "running");
  const chain = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const genesis = chain.find((e) => e.type === "run-start");
  assert.ok(genesis, "a run-start genesis event is on the chain");
  assert.equal(genesis.data.level, "L4");
});
