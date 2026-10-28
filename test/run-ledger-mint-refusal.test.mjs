// FAFF-1280 — a refused `faff run-ledger init-interactive` / `init-self-drain` removes the
// empty run dir it created, so nothing is left under .faff/runs/. A refusal is forced through
// the CLI with a plugin copy missing the evidence manifest (LEDGER_SCHEMA_UNAVAILABLE), and
// in-process for the `written: false` and LEDGER_LOCKED exits the CLI cannot reach.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(REPO, "plugin", "skills", "faff");
const REAL_CLI = path.join(PLUGIN, "bin", "faff");
const { discardUnmintedRunDir } = require(path.join(PLUGIN, "bin", "lib", "run-ledger.js"));

let scratch;
let brokenCli;

before(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "faff-1280-"));
  const copy = path.join(scratch, "faff");
  cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  rmSync(path.join(copy, "contracts", "evidence-v0.3", "anchor-manifest.json"));
  brokenCli = path.join(copy, "bin", "faff");
});

after(() => rmSync(scratch, { recursive: true, force: true }));

function cleanEnv() {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_SESSION_ID;
  return e;
}

function mkRepo() {
  const dir = mkdtempSync(path.join(scratch, "repo-"));
  spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], { encoding: "utf8" });
  return dir;
}

const runsOf = (repo) => path.join(repo, ".faff", "runs");
const run = (cli, args) => spawnSync("node", [cli, "run-ledger", ...args], { encoding: "utf8", env: cleanEnv() });

test("a refused init-self-drain leaves no run dir, and a retry with the schema restored mints", () => {
  const repo = mkRepo();
  const refused = run(brokenCli, ["init-self-drain", "--id", "RUN-B", "--root", repo]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /faff run-ledger init-self-drain: run-ledger schema unavailable: .* — no ledger minted\n$/);
  assert.equal(refused.stdout, "");
  assert.deepEqual(readdirSync(runsOf(repo)), []);

  const retry = run(REAL_CLI, ["init-self-drain", "--id", "RUN-B", "--root", repo]);
  assert.equal(retry.status, 0, retry.stderr);
  assert.ok(existsSync(path.join(runsOf(repo), "RUN-B", "run-ledger.json")));
});

test("a refused init-interactive on a fresh id leaves no run dir and prints nothing on stdout", () => {
  const repo = mkRepo();
  const refused = run(brokenCli, ["init-interactive", "--issue", "FAFF-1", "--id", "RUN-A", "--root", repo]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /faff run-ledger init-interactive: run-ledger schema unavailable: .* — no ledger minted\n$/);
  assert.equal(refused.stdout, "");
  assert.deepEqual(readdirSync(runsOf(repo)), []);
});

test("a refused init-interactive on an existing --id dir leaves the dir and its contents unchanged", () => {
  const repo = mkRepo();
  const runDir = path.join(runsOf(repo), "RUN-A");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(path.join(runDir, "keep.txt"), "keep\n");
  const refused = run(brokenCli, ["init-interactive", "--issue", "FAFF-1", "--id", "RUN-A", "--root", repo]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.deepEqual(readdirSync(runDir), ["keep.txt"]);
  assert.equal(readFileSync(path.join(runDir, "keep.txt"), "utf8"), "keep\n");
});

test("a refused init-interactive never removes an existing empty --id dir it did not create", () => {
  const repo = mkRepo();
  const runDir = path.join(runsOf(repo), "RUN-A");
  mkdirSync(runDir, { recursive: true });
  const refused = run(brokenCli, ["init-interactive", "--issue", "FAFF-1", "--id", "RUN-A", "--root", repo]);
  assert.equal(refused.status, 1, refused.stderr);
  assert.ok(existsSync(runDir));
});

function captureStderr(fn) {
  const real = process.stderr.write;
  let out = "";
  process.stderr.write = (chunk) => { out += chunk; return true; };
  try { fn(); } finally { process.stderr.write = real; }
  return out;
}

test("discardUnmintedRunDir removes an empty dir silently", () => {
  const dir = mkdtempSync(path.join(scratch, "empty-"));
  const err = captureStderr(() => discardUnmintedRunDir(dir, "run-ledger init-self-drain"));
  assert.equal(existsSync(dir), false);
  assert.equal(err, "");
});

test("discardUnmintedRunDir returns silently when the dir is already gone", () => {
  const dir = path.join(scratch, "never-created");
  const err = captureStderr(() => discardUnmintedRunDir(dir, "run-ledger init-self-drain"));
  assert.equal(err, "");
});

test("discardUnmintedRunDir never throws and leaves a non-empty dir and its contents alone", () => {
  const dir = mkdtempSync(path.join(scratch, "full-"));
  writeFileSync(path.join(dir, "run-ledger.json.lock"), "{}");
  let err;
  assert.doesNotThrow(() => { err = captureStderr(() => discardUnmintedRunDir(dir, "run-ledger init-interactive")); });
  assert.deepEqual(readdirSync(dir), ["run-ledger.json.lock"]);
  assert.equal(readFileSync(path.join(dir, "run-ledger.json.lock"), "utf8"), "{}");
  assert.equal(err, `faff run-ledger init-interactive: could not remove ${dir} (ENOTEMPTY); it holds no ledger\n`);
});

test("discardUnmintedRunDir takes the label after \"faff\", so the lights-out mint reports faff lights-out: (FAFF-1306)", () => {
  const dir = mkdtempSync(path.join(scratch, "full-lo-"));
  writeFileSync(path.join(dir, "run-ledger.json.lock"), "{}");
  const err = captureStderr(() => discardUnmintedRunDir(dir, "lights-out"));
  assert.equal(err, `faff lights-out: could not remove ${dir} (ENOTEMPTY); it holds no ledger\n`);
  assert.ok(!err.includes("run-ledger lights-out"));
});

test("discardUnmintedRunDir reports any other rmdir error without throwing", () => {
  const fs = require("node:fs");
  const dir = mkdtempSync(path.join(scratch, "eperm-"));
  const real = fs.rmdirSync;
  fs.rmdirSync = () => { throw Object.assign(new Error("operation not permitted"), { code: "EPERM" }); };
  let err;
  try {
    assert.doesNotThrow(() => { err = captureStderr(() => discardUnmintedRunDir(dir, "run-ledger init-self-drain")); });
  } finally { fs.rmdirSync = real; }
  assert.ok(existsSync(dir));
  assert.equal(err, `faff run-ledger init-self-drain: could not remove ${dir} (EPERM); it holds no ledger\n`);

  // FAFF-1306: the same EPERM failure through each of the three labels — the two existing sites
  // stay byte-identical, and the lights-out site carries its own prefix.
  const cases = [["run-ledger init-interactive", "faff run-ledger init-interactive"], ["run-ledger init-self-drain", "faff run-ledger init-self-drain"], ["lights-out", "faff lights-out"]];
  for (const [label, prefix] of cases) {
    fs.rmdirSync = () => { throw Object.assign(new Error("operation not permitted"), { code: "EPERM" }); };
    let out;
    try { out = captureStderr(() => discardUnmintedRunDir(dir, label)); } finally { fs.rmdirSync = real; }
    assert.equal(out, `${prefix}: could not remove ${dir} (EPERM); it holds no ledger\n`);
  }
});

// run-ledger.js destructures mutateLedgerUnderLock at require time, so the stub goes onto the
// heartbeat.js exports first, in a fresh process.
function runStubbed(stub, args) {
  const lib = path.join(PLUGIN, "bin", "lib");
  const script = `
    const heartbeat = require(${JSON.stringify(path.join(lib, "heartbeat.js"))});
    let calls = 0;
    heartbeat.mutateLedgerUnderLock = () => { calls++; ${stub} };
    const { cmdRunLedger } = require(${JSON.stringify(path.join(lib, "run-ledger.js"))});
    let code;
    try { code = cmdRunLedger(JSON.parse(process.argv[1])); }
    catch (e) { code = "threw:" + e.code; }
    process.stdout.write(JSON.stringify({ code, calls }));
  `;
  const r = spawnSync("node", ["-e", script, JSON.stringify(args)], { encoding: "utf8", env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  return { ...JSON.parse(r.stdout), stderr: r.stderr };
}

const WRITTEN_FALSE = `return { written: false, yielded: false, before_sha256: null, after_sha256: null };`;
const LOCKED = `throw Object.assign(new Error("ledger lock: could not acquire"), { code: "LEDGER_LOCKED" });`;

test("init-self-drain removes the run dir on a written:false exit and keeps exit 3", () => {
  const repo = mkRepo();
  const r = runStubbed(WRITTEN_FALSE, ["init-self-drain", "--id", "RUN-B", "--root", repo]);
  assert.deepEqual([r.code, r.calls], [3, 1]);
  assert.match(r.stderr, /init-self-drain: could not write .* \(lock contention\/abort\) — no ledger minted\n$/);
  assert.deepEqual(readdirSync(runsOf(repo)), []);
});

test("init-self-drain removes the run dir on a LEDGER_LOCKED throw and keeps exit 3", () => {
  const repo = mkRepo();
  const r = runStubbed(LOCKED, ["init-self-drain", "--id", "RUN-B", "--root", repo]);
  assert.deepEqual([r.code, r.calls], [3, 1]);
  assert.deepEqual(readdirSync(runsOf(repo)), []);
});

test("init-interactive removes the run dir on a written:false exit and keeps exit 3", () => {
  const repo = mkRepo();
  const r = runStubbed(WRITTEN_FALSE, ["init-interactive", "--issue", "FAFF-1", "--id", "RUN-A", "--root", repo]);
  assert.deepEqual([r.code, r.calls], [3, 1]);
  assert.match(r.stderr, /init-interactive: could not write .* \(lock contention\/abort\) — no ledger minted\n$/);
  assert.deepEqual(readdirSync(runsOf(repo)), []);
});

test("init-interactive removes the run dir before rethrowing LEDGER_LOCKED", () => {
  const repo = mkRepo();
  const r = runStubbed(LOCKED, ["init-interactive", "--issue", "FAFF-1", "--id", "RUN-A", "--root", repo]);
  assert.deepEqual([r.code, r.calls], ["threw:LEDGER_LOCKED", 1]);
  assert.deepEqual(readdirSync(runsOf(repo)), []);
});
