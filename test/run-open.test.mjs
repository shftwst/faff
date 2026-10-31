// FAFF-1437 — `faff run open`: beep-boop's run-start bracket as one verb.
// The procedure is driven through `runOpen` with an injected `faff` spawner (each subcommand's reply
// is scripted, every call recorded) and an in-memory ledger; the flag rules and output modes through
// `cmdRunOpen`; and one run through the shipped CLI in a temp repo. Case names are the ones the
// spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const ro = require("../plugin/skills/faff/bin/lib/run-open.js");

const ROOT = "/repo";
const RUN_ID = "run-20260101-000000-beepboop-full-abc123";
const RUN_DIR = join(ROOT, ".faff", "runs", RUN_ID);

const ok = (obj = {}) => ({ status: 0, stdout: typeof obj === "string" ? obj : JSON.stringify(obj), stderr: "" });
const fail = (status = 1, stdout = "") => ({ status, stdout, stderr: "boom" });

function baseLedger(over = {}) {
  return { run_id: RUN_ID, level: "L3", admitted: [], outcomes: {}, owner: { status: "running", pid: 1, session_id: RUN_ID, started_at: "2026-01-01T00:00:00Z", last_heartbeat: "2026-01-01T00:00:00Z", faff_version: "0.44.0", utc_offset_min: 60 }, ...over };
}

// The reply key: the subcommand words before the first flag (three for the Commissaire contract verbs).
function key(args) {
  if (args[0] === "commissaire" && args[1] === "contract") return args.slice(0, 3).join(" ");
  return args[1] === undefined || args[1].startsWith("--") ? args[0] : `${args[0]} ${args[1]}`;
}

// A scripted `faff` spawner over an in-memory ledger: replies keyed by "<cmd> <sub>" (or the
// three-word Commissaire verbs), every call recorded.
function fakeDeps(replies = {}, opts = {}) {
  const calls = [];
  const state = { ledger: opts.ledger === undefined ? null : structuredClone(opts.ledger), sentinel: null, writes: 0 };
  const base = {
    "run-ledger init-self-drain": () => { state.ledger = baseLedger(); return ok(`${RUN_DIR}\n`); },
    "harness identify": ok({ harness: "claude-code", model: "unknown", source: "env" }),
    "events append": ok(),
    "budget baseline": ok(),
    "commissaire contract status": ok({ governed: false, custody: null }),
    "commissaire contract admit": ok({ admitted: true }),
    "commissaire admit-required": ok({ governance_required: false }),
    "hooks-ensure": ok("hooks already present"),
    "sentry-poller start": ok(),
    "andon pump": ok(),
  };
  const table = { ...base, ...replies };
  return {
    calls,
    state,
    faff: (args, o) => {
      calls.push({ args, input: o.input, cwd: o.cwd, timeoutMs: o.timeoutMs });
      const r = table[key(args)];
      if (r === undefined) throw new Error(`unscripted faff ${args.join(" ")}`);
      return typeof r === "function" ? r(args, o) : r;
    },
    readConfig: opts.readConfig ?? (() => opts.config ?? {}),
    mutateLedger: opts.mutateLedger ?? ((runDir, mutate) => {
      const fresh = state.ledger === null ? null : structuredClone(state.ledger);
      const next = mutate(fresh);
      if (next === null || next === undefined) return { written: false };
      state.ledger = next;
      state.writes += 1;
      return { written: true };
    }),
    readLedger: () => (state.ledger === null ? undefined : structuredClone(state.ledger)),
    writeSentinel: (runDir, body) => { state.sentinel = { runDir, body }; },
    env: opts.env ?? {},
  };
}
const called = (deps, k) => deps.calls.filter((c) => key(c.args) === k);
const appended = (deps) => called(deps, "events append").map((c) => JSON.parse(c.input).type);

function open(deps, over = {}) {
  return ro.runOpen({ mode: "full", adoptRunDir: null, until: null, max: null, root: ROOT, sessionId: "S", ...over }, deps);
}
function adopt(deps, over = {}) {
  return open(deps, { mode: null, adoptRunDir: RUN_DIR, ...over });
}

function capture(fn) {
  const out = [];
  const err = [];
  const o = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { err.push(String(s)); return true; };
  let code;
  try { code = fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
  return { code, out: out.join(""), err: err.join("") };
}

// --- Mint and adopt ---

test("mint path: init-self-drain mints the run and the full bracket runs in order", () => {
  const deps = fakeDeps();
  const r = open(deps);
  assert.equal(r.code, 0);
  assert.equal(r.result.run_dir, RUN_DIR);
  assert.equal(r.result.governance, "admitted");
  assert.deepEqual(r.result.steps, { mint: "ok", enrich: "ok", envelope: "ok", baseline: "ok", governance: "ok", poller: "ok", hooks: "ok" });
  assert.deepEqual(called(deps, "run-ledger init-self-drain")[0].args, ["run-ledger", "init-self-drain", "--mode", "full", "--root", ROOT]);
  assert.deepEqual(r.result.faults, []);
});

test("order: admit runs after the mint and the enrich, and the poller only after governance and the hooks", () => {
  const deps = fakeDeps();
  open(deps);
  const seq = deps.calls.map((c) => key(c.args));
  const at = (k) => seq.indexOf(k);
  assert.ok(at("run-ledger init-self-drain") < at("harness identify"));
  assert.ok(at("harness identify") < at("commissaire contract admit"));
  assert.ok(at("budget baseline") < at("commissaire contract status"));
  assert.ok(at("commissaire contract admit") < at("hooks-ensure"));
  assert.ok(at("hooks-ensure") < at("sentry-poller start"));
});

test("adopt path: a running run this session holds is adopted, never re-minted", () => {
  const deps = fakeDeps({}, { ledger: baseLedger({ level: "L4", budget: { envelope: { ceilings: { until: null, max_attempts: 3, tokens: null, cost: 5 } } } }), env: { FAFF_RUN_DIR: RUN_DIR } });
  const r = adopt(deps);
  assert.equal(r.code, 0);
  assert.equal(called(deps, "run-ledger init-self-drain").length, 0);
  assert.equal(r.result.steps.mint, "skipped");
  assert.equal(r.result.steps.envelope, "skipped", "a recorded envelope is never rewritten");
  assert.equal(deps.state.ledger.level, "L4");
});

test("adopt enrich: adopt fills absent harness/model and never overwrites one already set", () => {
  const deps = fakeDeps({}, { ledger: baseLedger(), env: { FAFF_RUN_DIR: RUN_DIR } });
  adopt(deps);
  assert.equal(deps.state.ledger.owner.harness, "claude-code");
  const deps2 = fakeDeps({}, { ledger: baseLedger({ owner: { status: "running", harness: "codex", model: "gpt" } }), env: { FAFF_RUN_DIR: RUN_DIR } });
  adopt(deps2);
  assert.equal(deps2.state.ledger.owner.harness, "codex");
  assert.equal(deps2.state.ledger.owner.model, "gpt");
});

test("adopt refused: no ledger, an owner not running, or a run this session was not handed exits 2 with nothing written", () => {
  const cases = [
    [{ ledger: undefined, env: { FAFF_RUN_DIR: RUN_DIR } }, /missing or not a JSON object/],
    [{ ledger: baseLedger({ owner: { status: "done" } }), env: { FAFF_RUN_DIR: RUN_DIR } }, /owner.status is "done"/],
    [{ ledger: baseLedger({ owner: { status: "aborted-resumable" } }), env: { FAFF_RUN_DIR: RUN_DIR } }, /aborted-resumable/],
    [{ ledger: baseLedger(), env: {} }, /FAFF_RUN_DIR does not name this run/],
    [{ ledger: baseLedger(), env: { FAFF_RUN_DIR: "/elsewhere" } }, /FAFF_RUN_DIR does not name this run/],
  ];
  for (const [opts, reason] of cases) {
    const deps = fakeDeps({}, opts);
    const before = JSON.stringify(deps.state.ledger);
    const r = adopt(deps);
    assert.equal(r.code, 2);
    assert.match(r.reason, reason);
    assert.equal(r.result.run_dir, null);
    assert.equal(deps.state.writes, 0);
    assert.equal(JSON.stringify(deps.state.ledger), before);
    assert.equal(deps.calls.length, 0, "nothing is spawned");
  }
});

test("mint failure: a non-zero init-self-drain exits 2 with no run dir", () => {
  const deps = fakeDeps({ "run-ledger init-self-drain": fail(3) });
  const r = open(deps);
  assert.equal(r.code, 2);
  assert.equal(r.result.run_dir, null);
  assert.equal(r.result.steps.mint, "failed:3");
  assert.equal(called(deps, "commissaire contract status").length, 0);
});

// --- Enrich, envelope and baseline ---

test("enrich keeps fields: harness/model are filled and every mint-written owner field survives", () => {
  const deps = fakeDeps();
  open(deps);
  const owner = deps.state.ledger.owner;
  assert.equal(owner.harness, "claude-code");
  assert.equal(owner.model, "unknown");
  for (const k of ["faff_version", "started_at", "pid", "session_id", "utc_offset_min"]) assert.ok(k in owner, `${k} kept`);
  assert.equal(owner.utc_offset_min, 60);
});

test("ledger-write appended: each locked edit is followed by a ledger-write event", () => {
  const deps = fakeDeps();
  open(deps);
  assert.equal(deps.state.writes, 2, "enrich + envelope");
  assert.deepEqual(appended(deps), ["ledger-write", "ledger-write"]);
});

test("envelope precedence: --until and --max win over the config budget block", () => {
  const deps = fakeDeps({}, { config: { budget: { until: "06:00", max_attempts: 9, tokens: 1000 } } });
  const r = open(deps, { until: "07:30", max: "4" });
  assert.equal(r.code, 0);
  const env = deps.state.ledger.budget.envelope;
  assert.equal(env.ceilings.until, "07:30");
  assert.equal(env.ceilings.max_attempts, 4);
  assert.equal(env.ceilings.tokens, 1000);
  assert.equal(deps.state.ledger.budget.measure_root, ROOT);
  assert.deepEqual(r.result.budget_envelope, env);
});

test("malformed until: a malformed --until or budget.until exits 2 before any mint is spawned", () => {
  for (const [over, config] of [[{ until: "25:99" }, {}], [{}, { budget: { until: "noon" } }]]) {
    const deps = fakeDeps({}, { config });
    const r = open(deps, over);
    assert.equal(r.code, 2);
    assert.match(r.reason, /not a valid HH:MM/);
    assert.equal(deps.calls.length, 0);
  }
  for (const max of ["0", "-1", "2.5", "x"]) {
    const deps = fakeDeps();
    assert.equal(open(deps, { max }).code, 2, `--max ${max}`);
    assert.equal(deps.calls.length, 0);
  }
});

test("envelope write-once: a re-run with a different --max exits 2 and the envelope is unchanged; the same --max is 0", () => {
  const ledger = baseLedger({ budget: { envelope: { ceilings: { until: null, max_attempts: 5, tokens: null, cost: null } }, measure_root: ROOT } });
  const deps = fakeDeps({}, { ledger, env: { FAFF_RUN_DIR: RUN_DIR } });
  const r = adopt(deps, { max: "9" });
  assert.equal(r.code, 2);
  assert.match(r.reason, /budget envelope already set/);
  assert.equal(r.result.run_dir, RUN_DIR, "a post-adopt refusal names the run dir");
  assert.equal(deps.state.ledger.budget.envelope.ceilings.max_attempts, 5);
  assert.equal(adopt(fakeDeps({}, { ledger, env: { FAFF_RUN_DIR: RUN_DIR } }), { max: "5" }).code, 0);
});

test("baseline spawned: budget baseline gets the run dir, root and session", () => {
  const deps = fakeDeps();
  open(deps);
  assert.deepEqual(called(deps, "budget baseline")[0].args, ["budget", "baseline", "--run-dir", RUN_DIR, "--root", ROOT, "--session-id", "S"]);
});

// --- Governance (§4.1 step 4) ---

function assertGovernance(r, deps, { code, governance, cause, poller, hooks }) {
  assert.equal(r.code, code);
  assert.equal(r.result.governance, governance);
  assert.equal(r.result.fail_closed_cause, cause);
  assert.equal(called(deps, "sentry-poller start").length, poller ? 1 : 0, "poller spawned?");
  assert.equal(called(deps, "hooks-ensure").length, hooks ? 1 : 0, "hooks spawned?");
}

test("already-governed: a governed run is never re-admitted", () => {
  const deps = fakeDeps({ "commissaire contract status": ok({ governed: true }) });
  const r = open(deps);
  assertGovernance(r, deps, { code: 0, governance: "already-governed", cause: null, poller: true, hooks: true });
  assert.equal(called(deps, "commissaire contract admit").length, 0);
});

test("admit argv: producer run-id, faff-runner-v1, the seven-kind scope; status probed with a 30 s timeout", () => {
  const deps = fakeDeps();
  const r = open(deps);
  assertGovernance(r, deps, { code: 0, governance: "admitted", cause: null, poller: true, hooks: true });
  assert.deepEqual(called(deps, "commissaire contract admit")[0].args, ["commissaire", "contract", "admit", "--run-dir", RUN_DIR, "--producer", RUN_ID, "--contract-revision", "faff-runner-v1", "--scope", "merge,branch-delete,pr-create,push,label-write,file-write,tracker-write"]);
  assert.equal(called(deps, "commissaire contract status")[0].timeoutMs, 30000);
});

test("optional failure: a failed admit on a run not required to be governed proceeds ungoverned", () => {
  const deps = fakeDeps({ "commissaire contract admit": fail(3) });
  const r = open(deps);
  assertGovernance(r, deps, { code: 0, governance: "ungoverned-optional", cause: null, poller: true, hooks: true });
  assert.equal(r.result.steps.governance, "failed:3");
  assert.ok(r.result.faults.includes("admit-failed:3"));
  assert.equal(deps.state.sentinel, null);
});

test("required failure: a required run's failed admit fails closed with sentinel, park event, stop_reason and no poller", () => {
  const deps = fakeDeps({ "commissaire contract admit": fail(4), "commissaire admit-required": ok({ governance_required: true }) });
  const r = open(deps);
  assertGovernance(r, deps, { code: 3, governance: "fail-closed", cause: "governance-required", poller: false, hooks: true });
  assert.deepEqual(deps.state.sentinel.body, { governance_required: true });
  assert.equal(deps.state.ledger.owner.status, "done");
  assert.equal(deps.state.ledger.stop_reason, "governance-admit-failed");
  assert.deepEqual(deps.state.ledger.admitted, []);
  const park = called(deps, "events append").map((c) => JSON.parse(c.input)).find((e) => e.type === "park");
  assert.deepEqual(park, { phase: "run", type: "park", issue: RUN_ID, data: { reason: "needs-human" } });
  assert.equal(called(deps, "andon pump").length, 1);
  assert.equal(r.result.steps.governance, "failed:governance-required");
  assert.equal(r.result.steps.poller, "skipped");
});

test("governor unreachable: a configured unreachable governor fails closed even when admit-required says optional", () => {
  const deps = fakeDeps({ "commissaire contract admit": fail(2, JSON.stringify({ admitted: false, governor_unreachable: true, governor: "127.0.0.1:9" })) });
  const r = open(deps);
  assertGovernance(r, deps, { code: 3, governance: "fail-closed", cause: "governor-unreachable", poller: false, hooks: true });
  assert.deepEqual(deps.state.sentinel.body, { governance_required: true, governor: "127.0.0.1:9" });
  assert.equal(called(deps, "commissaire admit-required").length, 0);
});

test("status × 5: non-zero, timeout, throw, non-object and non-boolean governed all fail closed", () => {
  const replies = [
    fail(1),
    { status: null, stdout: "", stderr: "" },
    () => { throw new Error("spawn EAGAIN"); },
    ok("[1,2]"),
    ok({ governed: "yes" }),
  ];
  for (const reply of replies) {
    const deps = fakeDeps({ "commissaire contract status": reply });
    const r = open(deps);
    assertGovernance(r, deps, { code: 3, governance: "fail-closed", cause: "commissaire-status-failed", poller: false, hooks: true });
    assert.equal(called(deps, "commissaire contract admit").length, 0);
    assert.ok(r.result.faults.some((f) => f.startsWith("commissaire-status-failed")));
  }
});

test("admit-required unparseable: a non-zero or unparseable admit-required reads as required", () => {
  for (const reply of [fail(1), ok("not json"), ok({})]) {
    const deps = fakeDeps({ "commissaire contract admit": fail(3), "commissaire admit-required": reply });
    const r = open(deps);
    assertGovernance(r, deps, { code: 3, governance: "fail-closed", cause: "governance-required", poller: false, hooks: true });
  }
});

test("hooks spawned: hooks-ensure runs once with --root on an ordinary open", () => {
  const deps = fakeDeps();
  const r = open(deps);
  assert.deepEqual(called(deps, "hooks-ensure").map((c) => c.args), [["hooks-ensure", "--root", ROOT]]);
  assert.equal(r.result.steps.hooks, "ok");
});

test("hooks on fail-closed: hooks-ensure still runs on the fail-closed path and the poller does not", () => {
  const deps = fakeDeps({ "commissaire contract status": fail(1) });
  const r = open(deps);
  assert.equal(r.result.steps.hooks, "ok");
  assert.equal(r.result.hooks_report, "hooks already present");
  assert.equal(called(deps, "sentry-poller start").length, 0);
});

// --- Faults that do not stop the open ---

test("poller after governance: poller, hooks, baseline and identify failures are faults with exit 0", () => {
  const deps = fakeDeps({ "sentry-poller start": fail(1), "hooks-ensure": fail(2), "budget baseline": fail(1), "harness identify": fail(1) });
  const r = open(deps);
  assert.equal(r.code, 0);
  assert.equal(r.result.steps.enrich, "failed:1", "a failed identify skips the enrich");
  assert.equal(deps.state.ledger.owner.harness, undefined);
  for (const f of ["sentry-poller-start-failed", "hooks-ensure-failed", "budget-baseline-failed", "harness-identify-failed"]) assert.ok(r.result.faults.includes(f), f);
});

test("hooks report: hooks-ensure's stdout line is returned for the skill to relay", () => {
  const deps = fakeDeps({ "hooks-ensure": ok("added runcheck, prepcheck → .claude/settings.json\n") });
  assert.equal(open(deps).result.hooks_report, "added runcheck, prepcheck → .claude/settings.json");
});

test("post-mint refusal: a ledger write the lock or schema refuses exits 2 naming the run dir", () => {
  const deps = fakeDeps({}, { mutateLedger: () => { throw new Error("schema: owner.harness must be string"); } });
  const r = open(deps);
  assert.equal(r.code, 2);
  assert.equal(r.result.run_dir, RUN_DIR);
  assert.match(r.reason, /ledger write refused/);
  assert.equal(r.result.governance, null);
  assert.equal(called(deps, "commissaire contract status").length, 0);
});

// --- The verb: flags and output modes ---

test("export output: two shell-quoted export lines on 0 and on 3, nothing on 2", () => {
  const r0 = capture(() => ro.cmdRunOpen(["--mode", "full", "--root", ROOT, "--session-id", "S", "--export"], fakeDeps()));
  assert.equal(r0.code, 0);
  assert.equal(r0.out, `export FAFF_RUN_DIR='${RUN_DIR}'\nexport FAFF_SESSION_ID='${RUN_ID}'\n`);
  const r3 = capture(() => ro.cmdRunOpen(["--mode", "full", "--root", ROOT, "--session-id", "S", "--export"], fakeDeps({ "commissaire contract status": fail(1) })));
  assert.equal(r3.code, 3);
  assert.match(r3.out, /^export FAFF_RUN_DIR=/);
  const r2 = capture(() => ro.cmdRunOpen(["--mode", "full", "--root", ROOT, "--session-id", "S", "--export", "--until", "99:99"], fakeDeps()));
  assert.equal(r2.code, 2);
  assert.equal(r2.out, "");
  assert.equal(ro.shellQuote("a'b"), `'a'\\''b'`);
});

test("--json prints the whole OpenResult on every exit", () => {
  const keys = ["budget_envelope", "fail_closed_cause", "faults", "governance", "hooks_report", "run_dir", "steps"];
  for (const [deps, code] of [[fakeDeps(), 0], [fakeDeps({ "commissaire contract status": fail(1) }), 3], [fakeDeps({ "run-ledger init-self-drain": fail(1) }), 2]]) {
    const r = capture(() => ro.cmdRunOpen(["--mode", "full", "--root", ROOT, "--session-id", "S", "--json"], deps));
    assert.equal(r.code, code);
    const out = JSON.parse(r.out);
    assert.deepEqual(Object.keys(out).sort(), keys);
    if (code === 2) {
      assert.equal(out.run_dir, null);
      assert.equal(out.governance, null);
      assert.equal(out.budget_envelope, null);
      assert.equal(out.steps.poller, "skipped");
      assert.match(out.faults.at(-1), /mint failed/);
    }
    if (code === 0) assert.equal(out.fail_closed_cause, null);
  }
});

test("usage: --export with --json, both or neither of --mode/--adopt-run-dir, and a missing --root or --session-id exit 2", () => {
  for (const argv of [
    ["--mode", "full", "--root", ROOT, "--session-id", "S", "--export", "--json"],
    ["--root", ROOT, "--session-id", "S"],
    ["--mode", "full", "--adopt-run-dir", RUN_DIR, "--root", ROOT, "--session-id", "S"],
    ["--mode", "full", "--session-id", "S"],
    ["--mode", "full", "--root", ROOT],
  ]) {
    const deps = fakeDeps();
    assert.equal(capture(() => ro.cmdRunOpen(argv, deps)).code, 2, argv.join(" "));
    assert.equal(deps.calls.length, 0);
  }
});

// --- The shipped CLI ---

function cli(cwd, args, env = {}) {
  const e = { ...process.env, ...env };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID"]) if (!(k in env)) delete e[k];
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env: e });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}
function repo() {
  const root = mkdtempSync(join(tmpdir(), "faff-run-open-"));
  spawnSync("git", ["-C", root, "init", "-q"]);
  mkdirSync(join(root, ".faff"), { recursive: true });
  return root;
}
function stopPoller(runDir) {
  const s = spawnSync("node", [CLI, "sentry-poller", "status", "--run-dir", runDir, "--json"], { encoding: "utf8" });
  try { const pid = JSON.parse(s.stdout).pid; if (pid) process.kill(pid); } catch { /* already gone */ }
}

test("real CLI: run open then run close in a temp repo with no governor", () => {
  const root = repo();
  const r = cli(root, ["run", "open", "--mode", "full", "--root", root, "--session-id", "S", "--json"]);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.governance, "admitted");
  assert.equal(out.steps.poller, "ok");
  const ledger = JSON.parse(readFileSync(join(out.run_dir, "run-ledger.json"), "utf8"));
  assert.equal(ledger.owner.status, "running");
  assert.equal(typeof ledger.owner.harness, "string");
  assert.equal(ledger.budget.measure_root, root);
  try {
    const c = cli(root, ["run", "close", "--run-dir", out.run_dir, "--stop-reason", "queue-drained", "--json"]);
    assert.equal(c.code, 0, c.err);
    const closed = JSON.parse(readFileSync(join(out.run_dir, "run-ledger.json"), "utf8"));
    assert.equal(closed.owner.status, "done");
    assert.equal(closed.stop_reason, "queue-drained");
  } finally {
    stopPoller(out.run_dir);
  }
});

test("real CLI: malformed --until exits 2 and mints no run", () => {
  const root = repo();
  const r = cli(root, ["run", "open", "--mode", "full", "--until", "25:99", "--root", root, "--session-id", "S"]);
  assert.equal(r.code, 2);
  assert.equal(existsSync(join(root, ".faff", "runs")) ? readdirSync(join(root, ".faff", "runs")).length : 0, 0);
});

test("real CLI: an unreachable configured governor fails closed with no poller", () => {
  const root = repo();
  writeFileSync(join(root, ".faff", "config.yaml"), "commissaire:\n  governor: 127.0.0.1:9\n");
  const r = cli(root, ["run", "open", "--mode", "full", "--root", root, "--session-id", "S", "--json"]);
  assert.equal(r.code, 3, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.governance, "fail-closed");
  assert.equal(out.fail_closed_cause, "governor-unreachable");
  assert.ok(existsSync(join(out.run_dir, "commissaire", "governance-required.json")));
  const s = spawnSync("node", [CLI, "sentry-poller", "status", "--run-dir", out.run_dir, "--json"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(s.stdout), { running: false });
});

test("unknown verb: faff run with no verb names all four verbs", () => {
  const r = cli(tmpdir(), ["run"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /registered verbs: summary, checkpoint, open, close/);
});
