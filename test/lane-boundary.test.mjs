// FAFF-859 — the lane-isolation DECLARED field: config-declares → `faff lane-boundary emit` →
// (assert-in in evaluator-preflight). Exercises the emit command via the real entrypoint (arg
// parsing, config resolution, exit codes, the written file), the pure emitLaneBoundary seam
// in-process, the two config-axis validators, and the merge-gate fail-safe invariants the slice
// must preserve byte-for-byte (host excluded from the cage predicate; live runs stay dispatch-absent).
// Per ADR 0002 — assert the deterministic seam, never prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";
import { emitLaneBoundary, buildLaneBoundaryIntent } from "../plugin/skills/faff/bin/lib/lane-boundary.js";
import { laneBoundaryPromisesCage, laneBoundaryDispatchState } from "../plugin/skills/faff/bin/lib/merge-gate.js";
import { computeLaneBoundary } from "../plugin/skills/faff/bin/lib/contract-defs.js";

const mkTmp = () => mkdtempSync(path.join(os.tmpdir(), "faff-859-"));
const writeRc = (dir, body) => writeFileSync(path.join(dir, ".faffrc.yaml"), body);

// --- pure emit seam (validate-then-write, no real fs) ---

test("emitLaneBoundary: assembles a valid host-carrying intent and writes it (own/remote)", () => {
  const calls = [];
  const deps = { writeFileSync: (p, d) => calls.push({ p, d }), mkdirSync: () => {} };
  const res = emitLaneBoundary("evaluator", "/run/x", { container: "own", host: "remote" }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.path, "/run/x/lane-boundary.json");
  const written = JSON.parse(calls[0].d);
  assert.equal(written.host, "remote");
  assert.equal(written.container, "own");
  assert.equal(written.violations.length, 0);
  // the written bytes re-validate clean through the same contract validator
  const { contractData, failLoud } = computeLaneBoundary(written);
  assert.equal(failLoud, null);
  assert.equal(contractData.violations.length, 0);
});

test("emitLaneBoundary: refuses to write an intent that fails its own contract (off-vocab container)", () => {
  const calls = [];
  const deps = { writeFileSync: (p, d) => calls.push({ p, d }), mkdirSync: () => {} };
  const res = emitLaneBoundary("evaluator", "/run/x", { container: "vm", host: "local" }, deps);
  assert.equal(res.ok, false);
  assert.match(res.error, /never write a broken promise/);
  assert.equal(calls.length, 0, "no file written on a refused intent");
});

test("buildLaneBoundaryIntent: own → repo absent (cage-shaped); shared → repo present", () => {
  assert.deepEqual(buildLaneBoundaryIntent("evaluator", "own", "local").accesses, { repo: "absent", host_socket: "absent" });
  assert.deepEqual(buildLaneBoundaryIntent("evaluator", "shared", "local").accesses, { repo: "present", host_socket: "present" });
});

// --- CLI seam (the real entrypoint, real config resolution) ---

test("lane-boundary emit: reads a declared own/remote config and writes a valid file (the spec smoke test)", () => {
  const dir = mkTmp();
  writeRc(dir, "lanes:\n  evaluator:\n    isolation:\n      container: own\n      host: remote\n");
  const runDir = path.join(dir, "run");
  const { stdout, code } = runCli(["lane-boundary", "emit", "--lane", "evaluator", "--run-dir", runDir, "--json"], { cwd: dir });
  assert.equal(code, 0, stdout);
  const out = JSON.parse(stdout);
  assert.equal(out.ok, true);
  const onDisk = JSON.parse(readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"));
  assert.equal(onDisk.host, "remote");
  assert.equal(onDisk.container, "own");
  // validates clean through the contract
  const { code: vcode } = runCli(["contract", "lane-boundary"], { input: JSON.stringify(onDisk) });
  assert.equal(vcode, 0);
  rmSync(dir, { recursive: true, force: true });
});

test("lane-boundary emit: with no isolation declared → the baked defaults (shared/local)", () => {
  const dir = mkTmp();
  const runDir = path.join(dir, "run");
  const { stdout, code } = runCli(["lane-boundary", "emit", "--run-dir", runDir, "--json"], { cwd: dir });
  assert.equal(code, 0, stdout);
  const onDisk = JSON.parse(readFileSync(path.join(runDir, "lane-boundary.json"), "utf8"));
  assert.equal(onDisk.container, "shared");
  assert.equal(onDisk.host, "local");
  rmSync(dir, { recursive: true, force: true });
});

test("lane-boundary emit: missing --run-dir → usage exit 2", () => {
  const { code } = runCli(["lane-boundary", "emit"]);
  assert.equal(code, 2);
});

test("lane-boundary: unknown/missing subcommand → usage exit 2", () => {
  assert.equal(runCli(["lane-boundary"]).code, 2);
  assert.equal(runCli(["lane-boundary", "wobble"]).code, 2);
});

test("lane-boundary --selftest: the fixture table passes (exit 0)", () => {
  const { stdout, code } = runCli(["lane-boundary", "--selftest"]);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /RESULT: PASS/);
});

// --- config axes (fail-loud closed vocabulary, both read and write) ---

test("config get lanes.evaluator.isolation.{container,host}: baked defaults resolve", () => {
  const dir = mkTmp();
  assert.equal(runCli(["config", "get", "lanes.evaluator.isolation.container"], { cwd: dir }).stdout.trim(), "shared");
  assert.equal(runCli(["config", "get", "lanes.evaluator.isolation.host"], { cwd: dir }).stdout.trim(), "local");
  rmSync(dir, { recursive: true, force: true });
});

test("config get: off-vocabulary container → exit 2 naming the value + legal set (never a silent fallback)", () => {
  const dir = mkTmp();
  writeRc(dir, "lanes:\n  evaluator:\n    isolation:\n      container: vm\n");
  const { code, stderr } = runCli(["config", "get", "lanes.evaluator.isolation.container"], { cwd: dir });
  assert.equal(code, 2);
  assert.match(stderr, /"vm" not legal — legal set: shared \| own/);
  rmSync(dir, { recursive: true, force: true });
});

test("config get: off-vocabulary host → exit 2 naming the value + legal set", () => {
  const dir = mkTmp();
  writeRc(dir, "lanes:\n  evaluator:\n    isolation:\n      host: moon\n");
  const { code, stderr } = runCli(["config", "get", "lanes.evaluator.isolation.host"], { cwd: dir });
  assert.equal(code, 2);
  assert.match(stderr, /"moon" not legal — legal set: local \| remote/);
  rmSync(dir, { recursive: true, force: true });
});

test("config set: off-vocabulary value refused at write (exit 2), no file mutated", () => {
  const dir = mkTmp();
  const { code } = runCli(["config", "set", "lanes.evaluator.isolation.host", "moon"], { cwd: dir });
  assert.equal(code, 2);
  assert.equal(existsSync(path.join(dir, ".faffrc.yaml")), false, "no config written on a refused set");
  rmSync(dir, { recursive: true, force: true });
});

test("config resolved: a non-default isolation value is surfaced in the echo block", () => {
  const dir = mkTmp();
  writeRc(dir, "lanes:\n  evaluator:\n    isolation:\n      container: own\n");
  const { stdout, code } = runCli(["config", "resolved"], { cwd: dir });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /isolation evaluator\.container: own/);
  rmSync(dir, { recursive: true, force: true });
});

// --- merge-gate fail-safe invariants the slice MUST preserve ---

test("laneBoundaryPromisesCage: own + repo-absent promises the cage regardless of host (host excluded from the predicate)", () => {
  for (const host of ["local", "remote"]) {
    const dir = mkTmp();
    writeFileSync(path.join(dir, "lane-boundary.json"), JSON.stringify(
      { version: 1, lane: "evaluator", container: "own", host, accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }));
    assert.equal(laneBoundaryPromisesCage(dir), true, `host=${host} must not change the cage promise`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SHIP-NOT-WIRE: an ordinary run-dir (no emit) yields laneBoundaryDispatchState 'absent' → custody stays non-mandatory", () => {
  const dir = mkTmp(); // no lane-boundary.json written — the live-run state this slice preserves
  assert.equal(laneBoundaryDispatchState(dir), "absent");
  rmSync(dir, { recursive: true, force: true });
});
