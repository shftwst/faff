// FAFF-1258 — the production run-ledger writer inventory. Every row drives a real writer (CLI or exported
// function) into a temp run dir, asserts the fields that writer sets are on disk afterwards, and asserts the
// ledger validates against the v0.3 run-ledger schema with no serialiser stderr warning. The static half pins
// the inventory itself: which modules call mutateLedgerUnderLock, who writes run-ledger.json, and who may
// pass warn mode.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedFloor } from "./helpers/evidence-anchor-fixtures.mjs";

const require = createRequire(import.meta.url);
const { validateEvidenceDocument } = require("../plugin/skills/faff/bin/lib/evidence.js");

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO, "plugin", "skills", "faff", "bin", "faff");
const LIB = path.join(REPO, "plugin", "skills", "faff", "bin", "lib");
const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.t" };

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...GIT_ENV };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) delete env[k];
  return { ...env, ...extra };
}

function faff(args, { env = {}, cwd = REPO, input } = {}) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: cleanEnv(env), cwd, input });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function gitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "faff-1258-inv-"));
  spawnSync("git", ["-C", dir, "init", "-q", "-b", "main"], { env: cleanEnv() });
  spawnSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "seed"], { env: cleanEnv() });
  return dir;
}

const ledgerPath = (runDir) => path.join(runDir, "run-ledger.json");
const ledgerOf = (runDir) => JSON.parse(readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
const writeLedger = (runDir, l) => writeFileSync(path.join(runDir, "run-ledger.json"), JSON.stringify(l, null, 2) + "\n");

function assertValid(runDir, label, stderr = "") {
  const r = validateEvidenceDocument("run-ledger.json", ledgerOf(runDir));
  assert.equal(r.unavailable, undefined, `${label}: schema unavailable`);
  assert.deepEqual(r.violations.map((v) => v.message), [], `${label}: ledger must validate against v0.3 run-ledger`);
  assert.doesNotMatch(stderr, /schema (warning|violation)|failed schema|pre-existing/, `${label}: no serialiser warning`);
  assert.equal(ledgerOf(runDir).schema_version, 1, `${label}: stamped`);
  assert.equal(Object.keys(ledgerOf(runDir))[0], "schema_version", `${label}: schema_version is the first key`);
}

function mintL2(root, issue = "FAFF-1") {
  const r = faff(["run-ledger", "init-interactive", "--issue", issue, "--root", root, "--json"]);
  assert.equal(r.code, 0, r.err);
  return JSON.parse(r.out).run_dir;
}

function mintL4(root) {
  writeFileSync(path.join(root, ".faffrc.yaml"),
    "slots:\n  review: faffter-dark-adversarial-review\n  spec_review: faffter-dark-spec-review\ngates:\n  fallback: fail-closed\n" +
    "budget:\n  tokens: 50000000\n  on_estimate_only: warn\nautonomous:\n  engine_bounded: true\n");
  mkdirSync(path.join(root, ".git"), { recursive: true });
  const r = faff(["lights-out", "--root", root, "--json"], { env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } });
  assert.equal(r.code, 0, r.out + r.err);
  return JSON.parse(r.out).run_dir;
}

test("run-ledger.js: init-interactive mint, record-outcome and capture-capability", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    assertValid(runDir, "init-interactive");
    const out = faff(["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "shipped", "--run-dir", runDir]);
    assert.equal(out.code, 0, out.err);
    assert.equal(ledgerOf(runDir).outcomes["FAFF-1"], "shipped");
    assertValid(runDir, "record-outcome", out.err);
    const cap = faff(["run-ledger", "capture-capability", "--issue", "FAFF-1", "--sut-env-stood", "true", "--run-dir", runDir]);
    assert.equal(cap.code, 0, cap.err);
    assert.equal(ledgerOf(runDir).capabilities["FAFF-1"].sut_env_stood, true);
    assertValid(runDir, "capture-capability", cap.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run-ledger.js: init-self-drain mint", () => {
  const root = gitRepo();
  try {
    const r = faff(["run-ledger", "init-self-drain", "--mode", "full", "--root", root, "--json"]);
    assert.equal(r.code, 0, r.err);
    const runDir = JSON.parse(r.out).run_dir;
    assert.ok(ledgerOf(runDir).run_id.includes("beepboop-full"), "the minted run id carries the mode");
    assert.deepEqual(ledgerOf(runDir).admitted, []);
    assertValid(runDir, "init-self-drain", r.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("lights-out.js: the L4 mint and the --resume epoch takeover", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1258-l4-"));
  try {
    const runDir = mintL4(root);
    assert.equal(ledgerOf(runDir).level, "L4");
    assertValid(runDir, "L4 mint");
    const led = ledgerOf(runDir);
    led.owner.status = "aborted-resumable";
    writeLedger(runDir, led);
    const r = faff(["lights-out", "--resume", path.basename(runDir), "--root", root, "--json"], { env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } });
    assert.equal(r.code, 0, r.out + r.err);
    assert.equal(ledgerOf(runDir).owner.status, "running");
    assert.ok(Number(ledgerOf(runDir).owner.epoch) >= 1, "the takeover bumped the owner epoch");
    assertValid(runDir, "lights-out --resume", r.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function budgetFixture(root) {
  const sid = "sess-1258";
  const enc = String(root).replace(/\//g, "-");
  const projdir = path.join(root, "cfg", "projects", enc);
  mkdirSync(projdir, { recursive: true });
  writeFileSync(path.join(projdir, `${sid}.jsonl`),
    JSON.stringify({ type: "assistant", sessionId: sid, message: { usage: { input_tokens: 1000, output_tokens: 500 } } }) + "\n");
  return { sid, env: { CLAUDE_CONFIG_DIR: path.join(root, "cfg"), CLAUDE_CODE_SESSION_ID: sid } };
}

test("budget.js: baseline persists and validates", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const { sid, env } = budgetFixture(root);
    const base = faff(["budget", "baseline", "--run-dir", runDir, "--root", root, "--session-id", sid], { env });
    assert.equal(base.code, 0, base.err);
    assert.equal(ledgerOf(runDir).budget.measure_session_id, sid);
    assertValid(runDir, "budget baseline", base.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("budget.js: the window re-anchor changes budget.window on disk and validates", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const { env } = budgetFixture(root);
    writeFileSync(path.join(root, ".faffrc.yaml"), "budget:\n  window:\n    hours: 5\n    tokens: 500000\n  at_ceiling: park-until-window-reset\n");
    assert.equal(ledgerOf(runDir).budget.window, undefined);
    const now = String(Date.parse("2026-07-24T12:00:00Z"));
    const check = faff(["budget", "check", "--run-dir", runDir, "--root", root, "--now-ms", now], { env });
    assert.equal(check.code, 0, check.err);
    const win = ledgerOf(runDir).budget.window;
    assert.ok(win && win.anchor_epoch === Number(now) && win.reset_epoch === Number(now) + 5 * 3600 * 1000, "the re-anchored window values changed on disk");
    assertValid(runDir, "budget check", check.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("events.js: append --tokens advances the checkpoint through the serialiser", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const runId = path.basename(runDir);
    const sid = "sess-tok";
    const enc = String(root).replace(/\//g, "-");
    const projdir = path.join(root, "cfg", "projects", enc);
    mkdirSync(projdir, { recursive: true });
    writeFileSync(path.join(projdir, `${sid}.jsonl`),
      JSON.stringify({ type: "assistant", sessionId: sid, message: { usage: { input_tokens: 10, output_tokens: 2 } } }) + "\n");
    const r = faff(["events", "append", "--run", runId, "--root", root, "--tokens"],
      { env: { CLAUDE_CONFIG_DIR: path.join(root, "cfg"), CLAUDE_CODE_SESSION_ID: sid }, cwd: root, input: JSON.stringify({ phase: "prep", type: "prep-done", issue: "FAFF-1" }) });
    assert.equal(r.code, 0, r.err);
    assert.ok(ledgerOf(runDir).budget.tokens_at_last_event, "the checkpoint advanced on disk");
    assertValid(runDir, "events append --tokens", r.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("park-reconsider.js, resumecheck.js and run-record-prd.js write valid ledgers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1258-misc-"));
  try {
    const runDir = mintL4(root);
    const prd = faff(["run-record-prd", "--run-dir", runDir, "--prd-creative-licence", "tight", "--json"]);
    assert.equal(prd.code, 0, prd.out + prd.err);
    assert.equal(ledgerOf(runDir).prd_creative_licence, "tight");
    assertValid(runDir, "run-record-prd", prd.err);

    const led = ledgerOf(runDir);
    led.outcomes = { "FAFF-1": "parked" };
    writeLedger(runDir, led);
    const pr = require("../plugin/skills/faff/bin/lib/park-reconsider.js");
    mkdirSync(path.join(root, ".faff", "prep"), { recursive: true });
    const marker = {
      issue: "FAFF-1", spec_produced: true, attached: false, disposition: "parked", owner: { run_dir: runDir },
      park: { reconsider: "machine", cause_class: "config-fault", parked_at: "2026-01-01T00:00:00.000Z",
        cited_input: { kind: "config-file", ref: ".faffrc.yaml", keys: ["k"], fingerprint: "sha256:old" } },
    };
    writeFileSync(path.join(root, ".faff", "prep", "FAFF-1.json"), JSON.stringify(marker));
    const res = pr.apply_git_only_unpark(root, marker, "FAFF-1", marker.park, "resume-reconsider", "sha256:old", "sha256:new", "own-live-run", Date.now());
    assert.equal(res.ledger_cleared, true, JSON.stringify(res));
    assert.equal(ledgerOf(runDir).outcomes["FAFF-1"], undefined);
    assertValid(runDir, "park-reconsider");

    const led2 = ledgerOf(runDir);
    led2.owner = { ...led2.owner, epoch: 1, session_id: "S", status: "running" };
    writeLedger(runDir, led2);
    const nowIso = new Date().toISOString();
    writeFileSync(path.join(runDir, "events.jsonl"),
      JSON.stringify({ schema: 2, run_id: "R", seq: 1, ts: nowIso, prev: "a".repeat(64), phase: "run", type: "run-resume", epoch: 1 }) + "\n");
    const rc = faff(["resumecheck", "--hook", "--json", "--root", root], { env: { FAFF_RUN_DIR: runDir, FAFF_SESSION_ID: "S" } });
    assert.equal(rc.code, 0, rc.err);
    assert.equal(ledgerOf(runDir).owner.status, "aborted-resumable");
    assertValid(runDir, "resumecheck", rc.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("sentry.js: abort writes every abort key and validates", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const wt = path.join(root, "wt");
    mkdirSync(wt);
    const git = (...a) => spawnSync("git", ["-C", wt, ...a], { encoding: "utf8", env: cleanEnv() });
    git("init", "-q");
    writeFileSync(path.join(wt, "base.txt"), "base");
    writeFileSync(path.join(wt, ".env"), "A=1");
    git("add", "-A");
    git("commit", "-qm", "base");
    writeFileSync(path.join(wt, "base.txt"), "wip");
    writeFileSync(path.join(wt, ".env"), "A=2");
    const r = faff(["sentry", "abort", "--run-dir", runDir, "--issue", "FAFF-1", "--signal", "budget-breach", "--worktree", wt, "--json"]);
    assert.equal(r.code, 0, r.err);
    const abort = ledgerOf(runDir).abort;
    for (const key of ["status", "at", "issue", "signal", "wip_commit", "wip_skipped_secret_class"]) assert.ok(key in abort, `abort.${key} is on disk`);
    assertValid(runDir, "sentry abort", r.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the static half: the inventory itself ----

function libFiles() {
  return readdirSync(LIB).filter((f) => f.endsWith(".js")).map((f) => path.join(LIB, f));
}

// Source with line comments dropped, split into top-level functions so selftest bodies can be excluded.
function codeLines(file) {
  const lines = readFileSync(file, "utf8").split("\n");
  let fn = "";
  return lines.map((text, i) => {
    const m = /^(?:async )?function (\w+)/.exec(text);
    if (m) fn = m[1];
    return { n: i + 1, fn, text, code: /^\s*\/\//.test(text) ? "" : text };
  });
}

test("the set of modules calling mutateLedgerUnderLock equals the inventory", () => {
  const callers = libFiles()
    .filter((f) => path.basename(f) !== "heartbeat.js")
    .filter((f) => codeLines(f).some((l) => /\bmutateLedgerUnderLock\(/.test(l.code)))
    .map((f) => path.basename(f, ".js"))
    .sort();
  assert.deepEqual(callers, ["budget", "bundle-recover", "events", "lights-out", "park-reconsider", "resumecheck", "run-ledger", "run-record-prd", "sentry"]);
});

test("no non-selftest code writes run-ledger.json except the serialiser and the bundle-recover restore", () => {
  // events.js copies the live ledger byte for byte into an immutable anchor directory, and bundle.js copies a
  // snapshot into a scratch directory for tamper checks; neither writes a live ledger.
  const allowed = new Set(["heartbeat.js", "bundle-recover.js", "events.js", "bundle.js"]);
  const writers = /(writeFileSync|copyFileSync|renameSync|atomicWriteSingleValueFile)\([^;]*run-ledger\.json/;
  const offenders = [];
  for (const file of libFiles()) {
    for (const l of codeLines(file)) {
      if (!writers.test(l.code) || /selftest/i.test(l.fn)) continue;
      if (path.basename(file) === "governance-check.js" && l.fn === "writeLedger") continue; // selftest fixture helper
      if (!allowed.has(path.basename(file))) offenders.push(`${path.basename(file)}:${l.n}`);
    }
  }
  assert.deepEqual(offenders, []);
  const recover = codeLines(path.join(LIB, "bundle-recover.js")).filter((l) => writers.test(l.code) && !/selftest/i.test(l.fn));
  assert.deepEqual(recover.map((l) => l.fn), ["reconstructProjection"]);
});

test("bundle-recover restores under the shared ledger lock and upgrades only after releasing it", () => {
  const recover = codeLines(path.join(LIB, "bundle-recover.js"));
  const inFn = (name, re) => recover.some((l) => l.fn === name && re.test(l.code));
  assert.equal(recover.some((l) => /run-ledger\.json\.lock/.test(l.code)), false, "no hand-built lock path");
  assert.ok(inFn("bundleRecover", /\brestoreUnderLedgerLock\(/), "bundleRecover restores through the locked section");
  assert.ok(inFn("restoreUnderLedgerLock", /\bwithLedgerLock\(/), "the restore section takes withLedgerLock");
  assert.ok(inFn("restoreUnderLedgerLock", /\breconstructProjection\(/), "the restore writes run inside the section");
  for (const re of [/\bupgradeRestored\(/, /\bmutateLedgerUnderLock\(/]) {
    assert.equal(inFn("restoreUnderLedgerLock", re) || inFn("reconstructProjection", re), false, `${re} never runs under the lock`);
  }
  const heartbeat = codeLines(path.join(LIB, "heartbeat.js"));
  assert.ok(heartbeat.some((l) => l.fn === "mutateLedgerUnderLock" && /\bwithLedgerLock\(/.test(l.code)), "the serialiser takes the same lock");
});

test("sentry abort is the only caller passing warn mode", () => {
  const warnCallers = libFiles()
    .filter((f) => codeLines(f).some((l) => /schema:\s*"warn"/.test(l.code)))
    .map((f) => path.basename(f));
  assert.deepEqual(warnCallers, ["sentry.js"]);
});

test("faff sentry abort on a ledger with an unlisted key still exits 0 and writes the abort mark", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const led = ledgerOf(runDir);
    led.scratch = 1;
    writeLedger(runDir, led);
    const r = faff(["sentry", "abort", "--run-dir", runDir, "--issue", "FAFF-1", "--signal", "budget-breach", "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(ledgerOf(runDir).abort.status, "aborted-resumable");
    assert.equal(ledgerOf(runDir).scratch, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ledger at schema_version 2 still takes the sentry abort mark and keeps its 2", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    writeLedger(runDir, { ...ledgerOf(runDir), schema_version: 2 });
    const r = faff(["sentry", "abort", "--run-dir", runDir, "--json"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(ledgerOf(runDir).abort.status, "aborted-resumable");
    assert.equal(ledgerOf(runDir).schema_version, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- callers map the schema error codes to exit 1 ----

const PLUGIN = path.join(REPO, "plugin", "skills", "faff");

// A copy of the plugin whose bundled run-ledger schema is narrowed so a particular write is refused.
function narrowedCli(tmp, narrow) {
  const copy = path.join(tmp, "faff");
  cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
  const p = path.join(copy, "contracts", "evidence-v0.3", "schema", "run-ledger.schema.json");
  const schema = JSON.parse(readFileSync(p, "utf8"));
  narrow(schema.properties);
  writeFileSync(p, JSON.stringify(schema));
  return path.join(copy, "bin", "faff");
}

function faffWith(cli, args, opts = {}) {
  const r = spawnSync("node", [cli, ...args], { encoding: "utf8", env: cleanEnv(opts.env), cwd: opts.cwd || REPO });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

test("init-interactive and init-self-drain exit 1 on LEDGER_SCHEMA and leave no run-ledger.json", () => {
  const root = gitRepo();
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-cli-"));
  try {
    const cli = narrowedCli(tmp, (p) => { p.level.enum = ["L9"]; });
    const a = faffWith(cli, ["run-ledger", "init-interactive", "--issue", "FAFF-1", "--root", root]);
    const b = faffWith(cli, ["run-ledger", "init-self-drain", "--mode", "full", "--root", root]);
    for (const r of [a, b]) {
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.err, /run-ledger failed schema: .*enum/);
    }
    const runsDir = path.join(root, ".faff", "runs");
    const dirs = existsSync(runsDir) ? readdirSync(runsDir) : [];
    for (const d of dirs) assert.equal(existsSync(path.join(runsDir, d, "run-ledger.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("record-outcome, capture-capability and budget baseline map LEDGER_SCHEMA to exit 1 with the message", () => {
  const root = gitRepo();
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-cli2-"));
  try {
    const runDir = mintL2(root);
    const cli = narrowedCli(tmp, (p) => {
      p.outcomes.additionalProperties.enum = ["parked"];
      p.capabilities.additionalProperties.properties.sut_env_stood.type = "string";
      p.budget.properties.measure_session_id = { type: "integer" };
    });
    const before = readFileSync(ledgerPath(runDir));
    const outcome = faffWith(cli, ["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "shipped", "--run-dir", runDir]);
    const cap = faffWith(cli, ["run-ledger", "capture-capability", "--issue", "FAFF-1", "--sut-env-stood", "true", "--run-dir", runDir]);
    const { sid, env } = (() => {
      const sidv = "sess-map";
      const projdir = path.join(root, "cfg", "projects", String(root).replace(/\//g, "-"));
      mkdirSync(projdir, { recursive: true });
      writeFileSync(path.join(projdir, `${sidv}.jsonl`), JSON.stringify({ type: "assistant", sessionId: sidv, message: { usage: { input_tokens: 5, output_tokens: 1 } } }) + "\n");
      return { sid: sidv, env: { CLAUDE_CONFIG_DIR: path.join(root, "cfg"), CLAUDE_CODE_SESSION_ID: sidv } };
    })();
    const baseline = faffWith(cli, ["budget", "baseline", "--run-dir", runDir, "--root", root, "--session-id", sid], { env });
    for (const r of [outcome, cap, baseline]) {
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(r.err, /run-ledger failed schema/);
    }
    assert.deepEqual(readFileSync(ledgerPath(runDir)), before, "nothing was written");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("lights-out --resume maps LEDGER_SCHEMA to a refusal with exit 1", () => {
  const root = mkdtempSync(path.join(tmpdir(), "faff-1258-resume-"));
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-resume2-"));
  try {
    const runDir = mintL4(root);
    const led = ledgerOf(runDir);
    led.owner.status = "aborted-resumable";
    writeLedger(runDir, led);
    const cli = narrowedCli(tmp, (p) => { p.owner.properties.epoch = { type: "string" }; });
    const r = faffWith(cli, ["lights-out", "--resume", path.basename(runDir), "--root", root, "--json"], { env: { KUBERNETES_SERVICE_HOST: "10.0.0.1" } });
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /run-ledger failed schema/);
    assert.equal(ledgerOf(runDir).owner.status, "aborted-resumable");
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

// ---- the ledger-write path warns on a hand-edited ledger, never refuses ----

function ledgerWriteNote(root, runDir, cli) {
  const r = spawnSync("node", [cli || CLI, "events", "append", "--run", path.basename(runDir), "--root", root], {
    encoding: "utf8", env: cleanEnv(), cwd: root, input: JSON.stringify({ phase: "run", type: "ledger-write" }),
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

const eventTypes = (runDir) => readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).type);

test("a ledger-write note on a ledger with an unlisted key exits 0, appends the event and prints the violation", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    writeLedger(runDir, { ...ledgerOf(runDir), scratch: 1 });
    const before = eventTypes(runDir).length;
    const r = ledgerWriteNote(root, runDir);
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /scratch/);
    assert.equal(eventTypes(runDir).length, before + 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ledger-write note on a legacy ledger prints one line saying so and validates nothing", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const led = ledgerOf(runDir);
    delete led.schema_version;
    led.scratch = 1;
    writeLedger(runDir, led);
    const r = ledgerWriteNote(root, runDir);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err.trim().split("\n").length, 1);
    assert.match(r.err, /no schema_version/);
    assert.doesNotMatch(r.err, /scratch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a ledger-write note with the bundled manifest missing exits 0, appends the event and prints exactly one line naming the path", () => {
  const root = gitRepo();
  const tmp = mkdtempSync(path.join(tmpdir(), "faff-1258-nomanifest-"));
  try {
    const runDir = mintL2(root);
    const copy = path.join(tmp, "faff");
    cpSync(PLUGIN, copy, { recursive: true, filter: (src) => !src.includes("node_modules") });
    rmSync(path.join(copy, "contracts", "evidence-v0.3", "anchor-manifest.json"));
    const before = eventTypes(runDir).length;
    const r = ledgerWriteNote(root, runDir, path.join(copy, "bin", "faff"));
    assert.equal(r.code, 0, r.err);
    assert.equal(r.err.trim().split("\n").length, 1, r.err);
    assert.match(r.err, /anchor-manifest\.json/);
    assert.equal(eventTypes(runDir).length, before + 1);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); }
});

test("faff-beep-boop SKILL.md tells the orchestrator to keep schema_version and add only listed keys", () => {
  const skill = readFileSync(path.join(REPO, "plugin", "skills", "faff-beep-boop", "SKILL.md"), "utf8");
  assert.match(skill, /keep `schema_version` and add only keys the v0\.3 `run-ledger` schema lists/);
});

test("integration smoke: mint, build-progress, record-outcome, anchor, validate, verify", () => {
  const root = gitRepo();
  try {
    const runDir = mintL2(root);
    const bp = faff(["build-progress", "write", runDir, "FAFF-1", "--build-complete", "--diff-hash", "h", "--branch", "b"]);
    assert.equal(bp.code, 0, bp.err);
    const issueDir = path.join(runDir, "FAFF-1");
    seedFloor(runDir, "FAFF-1");
    const done = faff(["run-ledger", "record-outcome", "--issue", "FAFF-1", "--outcome", "shipped", "--run-dir", runDir]);
    assert.equal(done.code, 0, done.err);
    const dest = path.join(root, "anchor-out");
    const anchor = faff(["events", "anchor", "--run-dir", runDir, "--issue", "FAFF-1", "--dest", dest], { cwd: root });
    assert.equal(anchor.code, 0, anchor.err);
    const report = JSON.parse(faff(["evidence", "validate", dest, "--json"]).out);
    const byPath = Object.fromEntries(report.files.map((f) => [f.path, f]));
    assert.equal(byPath["run-ledger.json"].status, "ok", JSON.stringify(byPath["run-ledger.json"]));
    assert.equal(byPath["build-progress.json"].status, "ok", JSON.stringify(byPath["build-progress.json"]));
    for (const floor of ["ac-checklist.json", "review-verdict.json"]) assert.equal(byPath[floor].status, "ok", JSON.stringify(byPath[floor]));
    const verify = faff(["events", "verify", "--run-dir", runDir]);
    assert.equal(verify.code, 0, verify.out + verify.err);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
