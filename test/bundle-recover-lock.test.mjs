// FAFF-1281 — bundle-recover's existence check and restore run under the run-ledger lock, so two
// concurrent recoveries of one bundle never both restore, and a failed restore removes only what it wrote.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { PLUGIN, bundleFixture, recover } from "./helpers/bundle-recover-fixture.mjs";

const require = createRequire(import.meta.url);
const fs = require("node:fs");
const { bundleRecover } = require("../plugin/skills/faff/bin/lib/bundle-recover.js");

const runDirOf = (fx) => path.dirname(fx.ledgerPath);
const lockOf = (fx) => path.join(runDirOf(fx), "run-ledger.json.lock");
const countLedgerWrites = (file) => readFileSync(file, "utf8").split("\n").filter((l) => /"type":"ledger-write"/.test(l)).length;

function recoverAsync(fx) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.FAFF_RUN_DIR; delete env.FAFF_SESSION_ID;
    const child = spawn("node", [path.join(PLUGIN, "bin", "faff"), "bundle-recover", "--issue", "FAFF-1", "--root", fx.fresh, "--json"], { cwd: fx.fresh, env });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

test("two concurrent recoveries of a legacy snapshot: one reconstructs, one is a no-op, one upgrade event", async () => {
  const fx = bundleFixture();
  try {
    const anchoredEvents = path.join(fx.src, ".faff", "anchors", fx.runId, "FAFF-1", "events.jsonl");
    mkdirSync(runDirOf(fx), { recursive: true });
    writeFileSync(lockOf(fx), "held by the test");
    const both = Promise.all([recoverAsync(fx), recoverAsync(fx)]);
    setTimeout(() => rmSync(lockOf(fx), { force: true }), 250);
    const results = await both;
    for (const r of results) assert.equal(r.code, 0, r.err);
    assert.deepEqual(results.map((r) => JSON.parse(r.out).disposition).sort(), ["noop-already-present", "reconstructed"]);
    assert.equal(JSON.parse(readFileSync(fx.ledgerPath, "utf8")).schema_version, 1);
    const added = countLedgerWrites(path.join(runDirOf(fx), "events.jsonl")) - countLedgerWrites(anchoredEvents);
    assert.equal(added, 1, "exactly one upgrade ledger-write event");
    assert.equal(existsSync(lockOf(fx)), false, "the lock is released");
  } finally { fx.cleanup(); }
});

test("a ledger lock held past the acquire budget refuses the recovery and writes no ledger", () => {
  const fx = bundleFixture();
  try {
    mkdirSync(runDirOf(fx), { recursive: true });
    writeFileSync(lockOf(fx), "held by the test");
    const r = recover(fx);
    assert.equal(r.code, 1, r.err);
    const d = JSON.parse(r.out);
    assert.equal(d.disposition, "refused");
    assert.match(d.reason, /run-ledger lock at .* is held by another writer; nothing restored/);
    assert.equal(existsSync(fx.ledgerPath), false);
    assert.equal(existsSync(lockOf(fx)), true, "another writer's lock is never removed");
    rmSync(lockOf(fx));
    const after = recover(fx);
    assert.equal(after.code, 0, after.err);
    assert.equal(JSON.parse(after.out).disposition, "reconstructed");
  } finally { fx.cleanup(); }
});

test("a run dir that exists with no run-ledger.json restores as reconstructed", () => {
  const fx = bundleFixture();
  try {
    mkdirSync(runDirOf(fx), { recursive: true });
    const r = recover(fx);
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).disposition, "reconstructed");
  } finally { fx.cleanup(); }
});

// The anchors path is a regular file, so the restore fails after the ledger is already written.
function blockAnchors(fx) {
  mkdirSync(path.join(fx.fresh, ".faff", "anchors"), { recursive: true });
  writeFileSync(path.join(fx.fresh, ".faff", "anchors", fx.runId), "not a directory");
}

test("a failed restore removes only what it wrote and keeps a file that was already in the run dir", () => {
  const fx = bundleFixture();
  try {
    blockAnchors(fx);
    mkdirSync(runDirOf(fx), { recursive: true });
    writeFileSync(path.join(runDirOf(fx), "keep.txt"), "pre-existing");
    const r = recover(fx);
    assert.equal(r.code, 1, r.err);
    const d = JSON.parse(r.out);
    assert.equal(d.disposition, "refused");
    assert.match(d.reason, /^reconstruction failed: /);
    assert.equal(existsSync(fx.ledgerPath), false, "the restored ledger is removed");
    assert.equal(existsSync(path.join(runDirOf(fx), "events.jsonl")), false);
    assert.equal(existsSync(lockOf(fx)), false, "the lock is released");
    assert.equal(readFileSync(path.join(runDirOf(fx), "keep.txt"), "utf8"), "pre-existing");
  } finally { fx.cleanup(); }
});

test("a failed restore into an empty run dir leaves no run dir behind", () => {
  const fx = bundleFixture();
  try {
    blockAnchors(fx);
    const r = recover(fx);
    assert.equal(r.code, 1, r.err);
    assert.equal(JSON.parse(r.out).disposition, "refused");
    assert.equal(existsSync(runDirOf(fx)), false);
  } finally { fx.cleanup(); }
});

test("a failed restore never removes an empty run dir it did not create", () => {
  const fx = bundleFixture();
  try {
    blockAnchors(fx);
    mkdirSync(runDirOf(fx), { recursive: true });
    const r = recover(fx);
    assert.equal(r.code, 1, r.err);
    assert.equal(existsSync(runDirOf(fx)), true, "another writer may be about to take its lock in it");
  } finally { fx.cleanup(); }
});

test("a run dir that cannot be created refuses with exit 1, not an uncaught exit 2", () => {
  const fx = bundleFixture();
  try {
    writeFileSync(path.join(fx.fresh, ".faff", "runs"), "not a directory");
    const r = recover(fx);
    assert.equal(r.code, 1, r.err);
    const d = JSON.parse(r.out);
    assert.equal(d.disposition, "refused");
    assert.match(d.reason, /^reconstruction failed: /);
  } finally { fx.cleanup(); }
});

// Simulates a concurrent recovery removing the empty run dir between our mkdir and our lock acquire.
function withLockEnoent(times, fn) {
  const real = fs.openSync;
  let attempts = 0;
  fs.openSync = (p, flags, ...rest) => {
    if (String(p).endsWith("run-ledger.json.lock") && flags === "wx" && attempts++ < times) {
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT" });
    }
    return real(p, flags, ...rest);
  };
  try { return { result: fn(), attempts }; } finally { fs.openSync = real; }
}

test("an ENOENT on lock acquire retries mkdir-then-lock once and then restores", () => {
  const fx = bundleFixture();
  try {
    const { result } = withLockEnoent(1, () => bundleRecover({ issue: "FAFF-1", root: fx.fresh }));
    assert.equal(result.disposition, "reconstructed", result.reason);
    assert.equal(existsSync(fx.ledgerPath), true);
  } finally { fx.cleanup(); }
});

test("a second ENOENT on lock acquire refuses after exactly two attempts", () => {
  const fx = bundleFixture();
  try {
    const { result, attempts } = withLockEnoent(Infinity, () => bundleRecover({ issue: "FAFF-1", root: fx.fresh }));
    assert.equal(result.disposition, "refused");
    assert.match(result.reason, /^reconstruction failed: ENOENT/);
    assert.equal(attempts, 2);
    assert.equal(existsSync(fx.ledgerPath), false);
  } finally { fx.cleanup(); }
});
