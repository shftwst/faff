// FAFF-1061 — opt-in interactive high-assurance verification. Exercises the real `verification`
// entrypoint via runCli (the ADR 0002 deterministic seam): the resolver reads the `verification.*`
// config leaves + the on-disk $FAFF_RUN_DIR ledger, so a child-process test with real temp fixtures
// is the correct shape. The load-bearing guarantee under test is the ACTING INVARIANT: enabling a
// verification leg confers NO unattended acting authority, and the resolver short-circuits to
// all-off for any unattended run (a declared-unattended config, or an L4 mint).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers/run-cli.mjs";

// A throwaway repo root with a .git marker (so findRoot anchors here) and a .faffrc.yaml body.
function tmpRoot(rc = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-verif-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".faffrc.yaml"), rc);
  return dir;
}

// Mint a run-ledger.json at the given level under a fresh run dir; returns the run dir.
function mintLedger(level) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "faff-run-"));
  fs.writeFileSync(path.join(runDir, "run-ledger.json"),
    JSON.stringify({ run_id: "fixture", level, owner: { status: "running", last_heartbeat: new Date().toISOString() } }));
  return runDir;
}

// Child env with the ambient run context cleared, then overlaid — so a real session's FAFF_RUN_DIR
// can never leak into a "no ledger" case.
function env(overrides = {}) {
  const e = { ...process.env };
  delete e.FAFF_RUN_DIR;
  delete e.FAFF_APPETITE;
  return { ...e, ...overrides };
}

function resolve(args, opts) {
  const { stdout, code } = runCli(["verification", "resolve", "--json", ...args], opts);
  assert.equal(code, 0, stdout);
  return JSON.parse(stdout.trim());
}

const VERIF_ON = "verification:\n  holdout: true\n  spec_review: true\n  code_review: true\n";

test("attended L2 + all legs opted in → all three legs on, advisory (attended, not unattended)", () => {
  const root = tmpRoot(VERIF_ON);
  const runDir = mintLedger("L2");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.attended, true);
  assert.equal(r.unattended, false);
  assert.deepEqual(r.legs, { holdout: true, spec_review: true, code_review: true });
  assert.equal(r.any, true);
});

test("attended L3 standing posture is level-independent within attended (holdout only)", () => {
  const root = tmpRoot("verification:\n  holdout: true\n");
  const runDir = mintLedger("L3");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.attended, true);
  assert.deepEqual(r.legs, { holdout: true, spec_review: false, code_review: false });
});

test("attended run, no verification config → all legs off (fail-closed default)", () => {
  const root = tmpRoot("appetite: high\n");
  const runDir = mintLedger("L2");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.attended, true);
  assert.equal(r.any, false);
});

test("ACTING INVARIANT: declared-unattended config short-circuits to all-off even with legs on", () => {
  const root = tmpRoot(VERIF_ON + "autonomous:\n  unattended: true\n");
  const runDir = mintLedger("L2");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.unattended, true);
  assert.equal(r.attended, false);
  assert.deepEqual(r.legs, { holdout: false, spec_review: false, code_review: false });
});

test("ACTING INVARIANT: retained FAFF-717 alias (sentry_acting) also short-circuits to all-off", () => {
  const root = tmpRoot(VERIF_ON + "autonomous:\n  sentry_acting: true\n");
  const runDir = mintLedger("L2");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.unattended, true);
  assert.equal(r.any, false);
});

test("ACTING INVARIANT: an L4 ledger is unattended → all-off regardless of verification config", () => {
  const root = tmpRoot(VERIF_ON);
  const runDir = mintLedger("L4");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.unattended, true);
  assert.equal(r.any, false);
});

test("no ledger → not attended, all legs off (no run to attach the posture to)", () => {
  const root = tmpRoot(VERIF_ON);
  const r = resolve([], { cwd: root, env: env() });
  assert.equal(r.attended, false);
  assert.equal(r.any, false);
});

test("per-invocation flag opts a leg in on an attended run (no standing config needed)", () => {
  const root = tmpRoot("appetite: high\n");
  const runDir = mintLedger("L2");
  const r = resolve(["--holdout"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.attended, true);
  assert.deepEqual(r.legs, { holdout: true, spec_review: false, code_review: false });
});

test("ACTING INVARIANT: a per-invocation flag can NOT confer verification on an unattended run", () => {
  const root = tmpRoot("autonomous:\n  unattended: true\n");
  const runDir = mintLedger("L2");
  const r = resolve(["--holdout", "--code-review"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(r.unattended, true);
  assert.equal(r.any, false);
});

test("typo / non-boolean leaf resolves false (fail-closed literalTrue)", () => {
  const root = tmpRoot("verification:\n  holdout: yes\n  spec_review: '1'\n");
  const runDir = mintLedger("L2");
  const r = resolve([], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.deepEqual(r.legs, { holdout: false, spec_review: false, code_review: false });
});

test("ACTING INVARIANT: enabling verification never escalates appetite on an attended run", () => {
  // resolveAppetite returns `full` only for a LIVE L4 ledger; an attended verification opt-in
  // never mints/escalates a ledger, so `config get appetite` still resolves the config value.
  const root = tmpRoot(VERIF_ON + "appetite: medium\n");
  const runDir = mintLedger("L2");
  const { stdout, code } = runCli(["config", "get", "appetite"], { cwd: root, env: env({ FAFF_RUN_DIR: runDir }) });
  assert.equal(code, 0, stdout);
  assert.equal(stdout.trim(), "medium");
});

test("config get echoes each verification leaf as its fail-closed default", () => {
  const root = tmpRoot("appetite: high\n");
  for (const leaf of ["verification.holdout", "verification.spec_review", "verification.code_review"]) {
    const { stdout, code } = runCli(["config", "get", leaf], { cwd: root, env: env() });
    assert.equal(code, 0, stdout);
    assert.equal(stdout.trim(), "false", leaf);
  }
});

test("verification --selftest passes through the real entrypoint", () => {
  const { code, stdout } = runCli(["verification", "--selftest"], { env: env() });
  assert.equal(code, 0, stdout);
});
