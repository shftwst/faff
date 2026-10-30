// FAFF-1436 — `faff run checkpoint`: beep-boop's between-units checkpoint as one verb.
// The decision table is driven through the pure `decideCheckpoint`; the procedure through
// `runCheckpoint` with an injected `faff` spawner (each subcommand's reply is scripted, every call
// recorded); the exit codes, the root guard and one clean end-to-end run through the shipped CLI.
// Case names are the ones the spec's rule inventory cites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
const rc = require("../plugin/skills/faff/bin/lib/run-checkpoint.js");
const sentry = require("../plugin/skills/faff/bin/lib/sentry.js");

const RUN_ID = "run-20260101-000000-beepboop-list-abc123";

// --- Fixtures ---

function makeRun(ledger = {}) {
  const root = mkdtempSync(join(tmpdir(), "faff-run-checkpoint-"));
  const runDir = join(root, ".faff", "runs", RUN_ID);
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(runDir, "run-ledger.json"), JSON.stringify({ run_id: RUN_ID, level: "L3", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now }, ...ledger }, null, 2));
  return { root, runDir };
}

function budgetFx() {
  const fx = makeRun();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L3", budget: { measure_root: fx.root } }));
  return fx;
}

const ok = (obj) => ({ status: 0, stdout: JSON.stringify(obj), stderr: "" });
const BUDGET_NONE = { spent: { attempts: 0 }, tokens_source: "estimate", breached: [], outcome: "none" };
const CONSULT = (intervention = "continue", verdicts = [], tripped = verdicts.some((v) => v.severity === "trip")) => ({ run_dir: "x", verdicts, intervention, tripped });

// A scripted `faff` spawner: replies keyed by "<cmd> <sub>", every call recorded.
function fakeDeps(replies = {}, config = {}) {
  const calls = [];
  const base = {
    "budget check": ok(BUDGET_NONE),
    "events append": { status: 0, stdout: "{}", stderr: "" },
    "effects check": ok({ escapes: [], any_escape: false }),
    "effects reconcile-merges": ok({ reconciled: true, uncovered: [], any_escape: false, legacy_exempt: true }),
    "sentry check": ok(CONSULT()),
    "sentry abort": { status: 0, stdout: "", stderr: "" },
    "andon pump": { status: 0, stdout: "", stderr: "" },
  };
  const table = { ...base, ...replies };
  return {
    calls,
    faff: (args, opts) => {
      calls.push({ args, input: opts.input, cwd: opts.cwd });
      const r = table[`${args[0]} ${args[1]}`];
      if (!r) throw new Error(`unscripted faff ${args.join(" ")}`);
      return typeof r === "function" ? r(args, opts) : r;
    },
    readConfig: typeof config === "function" ? config : () => config,
  };
}
const called = (deps, cmd) => deps.calls.filter((c) => `${c.args[0]} ${c.args[1]}` === cmd);
const appended = (deps) => called(deps, "events append").map((c) => JSON.parse(c.input).type);

function run(fx, deps, over = {}) {
  return rc.runCheckpoint({ runDir: fx.runDir, phase: "build", root: null, sessionId: null, ...over }, deps);
}

function cli(cwd, args) {
  const env = { ...process.env };
  for (const k of ["FAFF_RUN_DIR", "FAFF_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) delete env[k];
  const r = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// --- The pure decision (§4.2) ---

const BUDGET = (outcome = "none", breached = []) => ({ state: { outcome, breached }, outcome, breached });
const CONS = (intervention, verdicts = []) => ({ payload: {}, intervention, verdicts, tripped: verdicts.length > 0 });
const TRIP = (member) => ({ signal: "fix-review-thrash", severity: "trip", scope: "member", member, evidence: { issue: member } });
// The three postures the acting table distinguishes.
const LEVELS = {
  "L4": { level: "L4", acts_abort: true, acts_pause: true },
  "attended L3": { level: "L3", acts_abort: false, acts_pause: false },
  "declared-unattended L3": { level: "L3", acts_abort: true, acts_pause: true },
};
const decide = (posture, over) => rc.decideCheckpoint({ phase: "build", budget: BUDGET(), consult: CONS("continue"), ...LEVELS[posture], ...over });

test("acting matrix", () => {
  const expect = {
    // intervention: [L4, attended L3, declared-unattended L3] → [action, stop_reason, acted]
    "consult-failed": [["fail-closed", null, false], ["continue", null, false], ["fail-closed", null, false]],
    surface: [["continue", null, true], ["continue", null, true], ["continue", null, true]],
    pause: [["park-issues", null, true], ["continue", null, false], ["park-issues", null, true]],
    correct: [["continue", null, true], ["continue", null, false], ["park-issues", null, true]],
    abort: [["abort", "sentry-abort", true], ["continue", null, false], ["abort", "sentry-abort", true]],
  };
  for (const [intervention, rows] of Object.entries(expect)) {
    Object.keys(LEVELS).forEach((posture, i) => {
      const consult = intervention === "consult-failed" ? null : CONS(intervention, [TRIP("FAFF-1")]);
      const d = decide(posture, { consult });
      assert.deepEqual([d.action, d.stop_reason, d.acted], rows[i], `${intervention} at ${posture}`);
    });
  }
});

test("alias honoured: sentry_acting declares unattended exactly as autonomous.unattended", () => {
  const ledger = { level: "L3" };
  for (const cfg of [{ autonomous: { unattended: true } }, { autonomous: { sentry_acting: true } }]) {
    assert.equal(sentry.actsOnSentryAbort(ledger, cfg), true, JSON.stringify(cfg));
    assert.equal(sentry.actsOnSentryPause(ledger, cfg), true, JSON.stringify(cfg));
  }
  assert.equal(sentry.actsOnSentryAbort(ledger, {}), false);
  for (const cfg of [{ autonomous: { unattended: true } }, { autonomous: { sentry_acting: true } }]) {
    const deps = fakeDeps({ "sentry check": ok(CONSULT("abort", [{ signal: "budget-breach", severity: "trip", evidence: {} }])) }, cfg);
    const r = run(budgetFx(), deps);
    assert.equal(r.action, "abort", JSON.stringify(cfg));
    assert.equal(r.acted, true);
  }
});

test("consult fail × 3 levels", () => {
  for (const [posture, action] of [["L4", "fail-closed"], ["attended L3", "continue"], ["declared-unattended L3", "fail-closed"]]) {
    const d = decide(posture, { consult: null });
    assert.equal(d.action, action, posture);
    assert.equal(d.stop_reason, null);
    assert.equal(d.acted, false, "a failed consult acts on no intervention");
  }
});

test("surface continues: surface never parks or aborts, at any posture", () => {
  for (const posture of Object.keys(LEVELS)) {
    const d = decide(posture, { consult: CONS("surface", [{ signal: "budget-metering-degraded", severity: "trip", evidence: {} }]) });
    assert.equal(d.action, "continue");
    assert.equal(d.acted, true);
    assert.equal(d.abort_required, false);
    assert.deepEqual(d.park_issues, []);
  }
});

test("pause matrix", () => {
  assert.deepEqual(decide("L4", { consult: CONS("pause", [TRIP("FAFF-1")]) }).park_issues, ["FAFF-1"]);
  assert.deepEqual(decide("declared-unattended L3", { consult: CONS("pause", [TRIP("FAFF-1")]) }).park_issues, ["FAFF-1"]);
  const attended = decide("attended L3", { consult: CONS("pause", [TRIP("FAFF-1")]) });
  assert.equal(attended.action, "continue");
  assert.deepEqual(attended.park_issues, []);
  assert.equal(attended.acted, false);
});

test("correct L4: continue with a correct-narrowing judgement for the named issue", () => {
  const d = decide("L4", { consult: CONS("correct", [TRIP("FAFF-2")]) });
  assert.equal(d.action, "continue");
  assert.deepEqual(d.needs_judgement, [{ kind: "correct-narrowing", issue: "FAFF-2" }]);
  assert.equal(d.acted, true);
});

test("correct L3 as pause: a declared-unattended L3 parks the issue the upgrade names", () => {
  const d = decide("declared-unattended L3", { consult: CONS("correct", [TRIP("FAFF-3")]) });
  assert.equal(d.action, "park-issues");
  assert.deepEqual(d.park_issues, ["FAFF-3"]);
  const attended = decide("attended L3", { consult: CONS("correct", [TRIP("FAFF-3")]) });
  assert.equal(attended.action, "continue");
  assert.equal(attended.acted, false);
});

test("abort acting / attended", () => {
  const verdicts = [{ signal: "wall-clock-runaway", severity: "trip", evidence: {} }];
  const acting = decide("L4", { consult: CONS("abort", verdicts) });
  assert.deepEqual([acting.action, acting.stop_reason, acting.abort_required, acting.acted], ["abort", "sentry-abort", true, true]);
  const attended = decide("attended L3", { consult: CONS("abort", verdicts) });
  assert.deepEqual([attended.action, attended.abort_required, attended.acted], ["continue", false, false]);
});

test("precedence", () => {
  const abort = CONS("abort", [{ signal: "budget-breach", severity: "trip", evidence: {} }]);
  const esc = decide("L4", { budget: BUDGET("escalate", ["tokens"]), consult: abort });
  assert.deepEqual([esc.action, esc.stop_reason, esc.abort_required], ["escalate", "budget-escalated(tokens)", true], "escalate + abort");
  const stop = decide("L4", { budget: BUDGET("stop", ["tokens"]), consult: abort });
  assert.deepEqual([stop.action, stop.stop_reason], ["abort", "sentry-abort"], "stop + abort");
  const stopPause = decide("L4", { budget: BUDGET("stop", ["tokens"]), consult: CONS("pause", [TRIP("FAFF-4")]) });
  assert.deepEqual([stopPause.action, stopPause.stop_reason], ["stop", "budget-hit(tokens)"], "stop + pause");
  const narrowPause = decide("L4", { budget: BUDGET("narrow", ["tokens"]), consult: CONS("pause", [TRIP("FAFF-4")]) });
  assert.deepEqual([narrowPause.action, narrowPause.park_issues], ["park-issues", ["FAFF-4"]], "narrow + pause");
  const failEsc = decide("L4", { budget: BUDGET("escalate", ["tokens"]), consult: null });
  assert.equal(failEsc.action, "fail-closed", "a failed consult outranks every budget row on an acting run");
});

// --- The procedure (§4.1) ---

test("budget args pinned: root and session forwarded to budget check and the token-tagged event", () => {
  const fx = budgetFx();
  const deps = fakeDeps();
  run(fx, deps, { sessionId: "sess-1", root: fx.root });
  const [b] = called(deps, "budget check");
  assert.deepEqual(b.args, ["budget", "check", "--json", "--run-dir", join(fx.root, ".faff", "runs", RUN_ID), "--root", fx.root, "--session-id", "sess-1"]);
  const [e] = called(deps, "events append");
  assert.deepEqual(e.args, ["events", "append", "--run", RUN_ID, "--root", fx.root, "--tokens", "--session-id", "sess-1"]);
  assert.ok(deps.calls.every((c) => c.cwd === fx.root), "every subcommand runs at the pinned root");
  const noSession = fakeDeps();
  run(fx, noSession);
  assert.ok(!called(noSession, "budget check")[0].args.includes("--session-id"), "an omitted session id is never substituted");
});

test("budget stop", () => {
  const r = run(budgetFx(), fakeDeps({ "budget check": ok({ breached: ["max_attempts"], outcome: "stop" }) }));
  assert.deepEqual([r.action, r.stop_reason, r.budget_in_scope], ["stop", "budget-hit(max_attempts)", ["max_attempts"]]);
});

test("budget narrow", () => {
  const r = run(budgetFx(), fakeDeps({ "budget check": ok({ breached: ["tokens"], outcome: "narrow" }) }));
  assert.equal(r.action, "narrow");
  assert.deepEqual(r.needs_judgement, [{ kind: "narrow-subset" }]);
});

test("budget escalate", () => {
  const r = run(budgetFx(), fakeDeps({ "budget check": ok({ breached: ["cost", "tokens"], outcome: "escalate" }) }));
  assert.deepEqual([r.action, r.stop_reason], ["escalate", "budget-escalated(cost,tokens)"]);
});

test("prep ignores tokens: only until gates the prep phase", () => {
  const deps = () => fakeDeps({ "budget check": ok({ breached: ["tokens"], outcome: "stop" }) });
  const prep = run(budgetFx(), deps(), { phase: "prep" });
  assert.deepEqual([prep.action, prep.budget_in_scope], ["continue", []]);
  const until = run(budgetFx(), fakeDeps({ "budget check": ok({ breached: ["until", "tokens"], outcome: "stop" }) }), { phase: "prep" });
  assert.deepEqual([until.action, until.stop_reason], ["stop", "budget-hit(until)"]);
});

test("phase wave: the wave boundary gates every dimension", () => {
  const r = run(budgetFx(), fakeDeps({ "budget check": ok({ breached: ["tokens"], outcome: "stop" }) }), { phase: "wave" });
  assert.deepEqual([r.action, r.stop_reason], ["stop", "budget-hit(tokens)"]);
});

test("budget fail × 2: acting fails closed, attended continues; both record the fault", () => {
  const failing = { "budget check": { status: 3, stdout: JSON.stringify({ outcome: "indeterminate", breached: [] }), stderr: "" } };
  const fx = budgetFx();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
  const acting = run(fx, fakeDeps(failing));
  assert.deepEqual([acting.action, acting.stop_reason, acting.budget], ["fail-closed", null, null]);
  assert.ok(acting.faults.includes("budget-check-failed"));
  const attended = run(budgetFx(), fakeDeps(failing));
  assert.equal(attended.action, "continue");
  assert.ok(attended.faults.includes("budget-check-failed"));
});

test("budget malformed: an out-of-enum outcome or a non-array breached is a failed read", () => {
  for (const bad of [{ outcome: "maybe", breached: [] }, { outcome: "stop", breached: "tokens" }, { breached: [] }]) {
    const fx = budgetFx();
    writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
    const deps = fakeDeps({ "budget check": ok(bad) });
    const r = run(fx, deps);
    assert.equal(r.action, "fail-closed", JSON.stringify(bad));
    assert.ok(!appended(deps).includes("budget-checkpoint"), "no budget-checkpoint event for a failed read");
  }
});

test("effects check fault: a non-zero or unparseable check reads as no escape and is a fault", () => {
  for (const bad of [{ status: 3, stdout: "", stderr: "run dir missing" }, { status: 0, stdout: "not json", stderr: "" }]) {
    const deps = fakeDeps({ "effects check": bad });
    const r = run(budgetFx(), deps);
    assert.equal(r.forbidden, false);
    assert.ok(r.faults.includes("effects-check-failed"));
    assert.ok(!called(deps, "sentry check")[0].args.includes("--forbidden-side-effect"));
  }
});

test("forbidden combine", () => {
  const cases = [
    [{ "effects check": ok({ escapes: [{}], any_escape: true }) }, true],
    [{ "effects reconcile-merges": ok({ reconciled: true, any_escape: true, legacy_exempt: false }) }, true],
    [{ "effects reconcile-merges": ok({ reconciled: false, any_escape: false, legacy_exempt: false, fault: "no base anchor" }) }, true],
    [{ "effects reconcile-merges": ok({ reconciled: true, any_escape: false, legacy_exempt: false }) }, false],
  ];
  for (const [replies, forbidden] of cases) assert.equal(run(budgetFx(), fakeDeps(replies)).forbidden, forbidden, JSON.stringify(replies));
});

test("legacy exempt: a legacy-exempt reconcile is clean", () => {
  const r = run(budgetFx(), fakeDeps({ "effects reconcile-merges": ok({ reconciled: true, any_escape: false, legacy_exempt: true }) }));
  assert.equal(r.forbidden, false);
  assert.deepEqual(r.faults, []);
});

test("reconcile unparseable: an unreadable reconcile reads as not reconciled", () => {
  for (const bad of [{ status: 0, stdout: "garbage", stderr: "" }, { status: 2, stdout: "", stderr: "bad" }]) {
    const r = run(budgetFx(), fakeDeps({ "effects reconcile-merges": bad }));
    assert.equal(r.forbidden, true);
    assert.ok(r.faults.includes("reconcile-merges-failed"));
  }
});

test("forbidden flag passed: --forbidden-side-effect iff forbidden", () => {
  const flagged = fakeDeps({ "effects check": ok({ escapes: [{}], any_escape: true }) });
  run(budgetFx(), flagged);
  assert.deepEqual(called(flagged, "sentry check")[0].args.slice(-1), ["--forbidden-side-effect"]);
  const clean = fakeDeps();
  run(budgetFx(), clean);
  assert.ok(!called(clean, "sentry check")[0].args.includes("--forbidden-side-effect"));
});

test("indeterminate consult: sentry exit 3 reporting continue fails closed on an acting run", () => {
  const fx = budgetFx();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
  const indeterminate = { status: 3, stdout: JSON.stringify({ run_dir: null, verdicts: [], intervention: "continue", tripped: false, indeterminate: true, reason: "x" }), stderr: "" };
  const r = run(fx, fakeDeps({ "sentry check": indeterminate }));
  assert.deepEqual([r.action, r.intervention, r.verdicts], ["fail-closed", null, []]);
  assert.ok(r.faults.includes("sentry-consult-failed"));
  const exit0 = run(fx, fakeDeps({ "sentry check": ok({ verdicts: [], intervention: "continue", indeterminate: true }) }));
  assert.equal(exit0.action, "fail-closed", "indeterminate:true fails even at exit 0");
});

test("consult malformed: an out-of-enum intervention or non-array verdicts is a failed consult", () => {
  const fx = budgetFx();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
  for (const bad of [{ intervention: "halt", verdicts: [] }, { intervention: "continue", verdicts: {} }, { verdicts: [] }, "not json"]) {
    const deps = fakeDeps({ "sentry check": typeof bad === "string" ? { status: 0, stdout: bad, stderr: "" } : ok(bad) });
    const r = run(fx, deps);
    assert.equal(r.action, "fail-closed", JSON.stringify(bad));
    assert.ok(!appended(deps).includes("sentry-checkpoint"));
  }
});

test("events: budget-checkpoint and sentry-checkpoint on a completed consult, sentry-trip on a trip, none on a failed consult", () => {
  const verdicts = [{ signal: "fix-review-thrash", severity: "trip", member: "FAFF-5", evidence: { issue: "FAFF-5" } }];
  const payload = CONSULT("pause", verdicts);
  const deps = fakeDeps({ "sentry check": ok(payload) });
  run(budgetFx(), deps);
  assert.deepEqual(appended(deps), ["budget-checkpoint", "sentry-checkpoint", "sentry-trip"]);
  const [bc, sc, st] = called(deps, "events append").map((c) => JSON.parse(c.input));
  assert.deepEqual(bc, { phase: "run", type: "budget-checkpoint", data: BUDGET_NONE });
  assert.deepEqual(sc, { phase: "run", type: "sentry-checkpoint", data: payload });
  assert.deepEqual(st, { phase: "run", type: "sentry-trip", data: { verdicts, intervention: "pause" } });
  assert.ok(!called(deps, "events append")[1].args.includes("--tokens"), "only the budget checkpoint is token-tagged");
  const quiet = fakeDeps();
  run(budgetFx(), quiet);
  assert.deepEqual(appended(quiet), ["budget-checkpoint", "sentry-checkpoint"]);
  const failed = fakeDeps({ "sentry check": { status: 1, stdout: "", stderr: "boom" } });
  run(budgetFx(), failed);
  assert.deepEqual(appended(failed), ["budget-checkpoint"]);
  const appendFails = run(budgetFx(), fakeDeps({ "events append": { status: 1, stdout: "", stderr: "" } }));
  assert.equal(appendFails.action, "continue", "a failed append is a fault, never a stop");
  assert.ok(appendFails.faults.includes("budget-checkpoint-append-failed"));
});

test("andon fail-open: a non-zero pump leaves the action unchanged and adds a fault", () => {
  const fx = budgetFx();
  const deps = fakeDeps({ "andon pump": { status: 1, stdout: "", stderr: "down" } });
  const r = run(fx, deps);
  assert.equal(r.action, "continue");
  assert.deepEqual(r.faults, ["andon-pump-failed"]);
  assert.deepEqual(called(deps, "andon pump")[0].args, ["andon", "pump", "--run-dir", join(fx.root, ".faff", "runs", RUN_ID)]);
});

test("abort spawn fails: the action stays abort, sentry_aborted false, fault recorded", () => {
  const fx = budgetFx();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
  const abort = { "sentry check": ok(CONSULT("abort", [{ signal: "budget-breach", severity: "trip", evidence: {} }])) };
  const marked = fakeDeps(abort);
  const r1 = run(fx, marked);
  assert.deepEqual([r1.action, r1.sentry_aborted], ["abort", true]);
  assert.deepEqual(called(marked, "sentry abort")[0].args, ["sentry", "abort", "--run-dir", join(fx.root, ".faff", "runs", RUN_ID)]);
  const r2 = run(fx, fakeDeps({ ...abort, "sentry abort": { status: 2, stdout: "", stderr: "bad" } }));
  assert.deepEqual([r2.action, r2.sentry_aborted], ["abort", false]);
  assert.ok(r2.faults.includes("sentry-abort-failed"));
  const attended = budgetFx();
  const noMark = fakeDeps(abort);
  run(attended, noMark);
  assert.equal(called(noMark, "sentry abort").length, 0, "an attended run never marks the ledger");
});

test("named issues: member, evidence.issue and evidence.in_flight, deduplicated in verdict order, trip only", () => {
  const verdicts = [
    { signal: "fix-review-thrash", severity: "trip", member: "FAFF-1", evidence: { issue: "FAFF-1" } },
    { signal: "scope-drift", severity: "trip", evidence: { issue: "FAFF-2" } },
    { signal: "wall-clock-runaway", severity: "trip", evidence: { in_flight: ["FAFF-3", "FAFF-1"] } },
    { signal: "fix-review-thrash", severity: "warn", member: "FAFF-9", evidence: { issue: "FAFF-9" } },
  ];
  assert.deepEqual(rc.namedIssues(verdicts), ["FAFF-1", "FAFF-2", "FAFF-3"]);
  const fx = budgetFx();
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify({ level: "L4", budget: { measure_root: fx.root } }));
  const r = run(fx, fakeDeps({ "sentry check": ok(CONSULT("pause", verdicts)) }));
  assert.deepEqual([r.action, r.park_issues], ["park-issues", ["FAFF-1", "FAFF-2", "FAFF-3"]]);
});

test("unattributed pause: a pause naming no issue continues with a pause-unattributed judgement", () => {
  const d = decide("L4", { consult: CONS("pause", [{ signal: "scope-drift", severity: "trip", evidence: {} }]) });
  assert.equal(d.action, "continue");
  assert.deepEqual(d.needs_judgement, [{ kind: "pause-unattributed" }]);
});

test("root drift: the pinned ledger root wins over a differing --root, recorded as a fault", () => {
  const fx = budgetFx();
  const other = mkdtempSync(join(tmpdir(), "faff-run-checkpoint-other-"));
  const deps = fakeDeps();
  const r = run(fx, deps, { root: other });
  assert.ok(r.faults.includes("root-drift"));
  assert.equal(called(deps, "budget check")[0].args[6], fx.root);
  assert.ok(!run(fx, fakeDeps(), { root: fx.root }).faults.includes("root-drift"), "an agreeing --root is no drift");
});

test("root inferred: no --root and no pinned root uses the root above the run dir, recorded as a fault", () => {
  const fx = makeRun();
  const deps = fakeDeps();
  const r = run(fx, deps);
  assert.ok(r.faults.includes("root-inferred"));
  assert.equal(called(deps, "budget check")[0].cwd, join(fx.runDir, "..", "..", ".."));
  assert.ok(!run(fx, fakeDeps(), { root: fx.root }).faults.includes("root-inferred"));
});

test("outside root: a run dir not under --root exits 2", () => {
  const fx = makeRun();
  const other = mkdtempSync(join(tmpdir(), "faff-run-checkpoint-other-"));
  const r = cli(fx.root, ["run", "checkpoint", "--run-dir", fx.runDir, "--root", other, "--phase", "build"]);
  assert.equal(r.code, 2, r.err);
  assert.equal(r.out, "", "exit 2 prints no CheckpointResult");
});

test("malformed ledger: a missing or non-object ledger exits 2", () => {
  const fx = makeRun();
  writeFileSync(join(fx.runDir, "run-ledger.json"), "[1,2]");
  assert.equal(cli(fx.root, ["run", "checkpoint", "--run-dir", fx.runDir, "--phase", "build", "--json"]).code, 2);
  writeFileSync(join(fx.runDir, "run-ledger.json"), "{not json");
  assert.equal(cli(fx.root, ["run", "checkpoint", "--run-dir", fx.runDir, "--phase", "build", "--json"]).code, 2);
  assert.equal(cli(fx.root, ["run", "checkpoint", "--run-dir", join(fx.root, ".faff", "runs", "run-none"), "--phase", "build"]).code, 2);
  assert.equal(cli(fx.root, ["run", "checkpoint", "--run-dir", fx.runDir, "--phase", "deploy"]).code, 2, "an unknown phase is a usage error");
});

test("unknown verb: faff run bogus exits 2 naming both verbs", () => {
  const r = cli(tmpdir(), ["run", "bogus"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /registered verbs: summary, checkpoint/);
});

test("human output: without --json, the action line then one fault line per fault, same exit code", () => {
  const fx = budgetFx();
  const deps = fakeDeps({ "budget check": ok({ breached: ["tokens"], outcome: "stop" }), "andon pump": { status: 1, stdout: "", stderr: "" } });
  const writes = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { writes.push(String(s)); return true; };
  let code;
  try { code = rc.cmdRunCheckpoint(["--run-dir", fx.runDir, "--phase", "build", "--root", fx.root], deps); }
  finally { process.stdout.write = orig; }
  assert.equal(code, 3);
  assert.equal(writes.join(""), "checkpoint: stop budget-hit(tokens)\nfault: andon-pump-failed\n");
});

test("CheckpointResult carries every §3 field", () => {
  const r = run(budgetFx(), fakeDeps());
  assert.deepEqual(Object.keys(r).sort(), ["acted", "action", "budget", "budget_in_scope", "faults", "forbidden", "intervention", "needs_judgement", "park_issues", "sentry_aborted", "stop_reason", "verdicts"]);
  assert.ok(rc.ACTIONS.includes(r.action));
});

test("real CLI: a legacy-exempt run with no derailment continues at exit 0", () => {
  const fx = makeRun();
  writeFileSync(join(fx.root, ".faffrc.yaml"), "");
  spawnSync("git", ["-C", fx.root, "init", "-q"]);
  writeFileSync(join(fx.runDir, "events.jsonl"), "");
  writeFileSync(join(fx.runDir, "heartbeat"), new Date().toISOString() + "\n");
  const l = JSON.parse(readFileSync(join(fx.runDir, "run-ledger.json"), "utf8"));
  l.budget = { measure_root: fx.root };
  writeFileSync(join(fx.runDir, "run-ledger.json"), JSON.stringify(l));
  const r = cli(fx.root, ["run", "checkpoint", "--run-dir", fx.runDir, "--phase", "build", "--json"]);
  assert.equal(r.code, 0, r.err);
  const out = JSON.parse(r.out);
  assert.equal(out.action, "continue");
  assert.equal(out.forbidden, false);
  assert.deepEqual(out.faults, []);
  const types = readFileSync(join(fx.runDir, "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).type);
  assert.deepEqual(types, ["budget-checkpoint", "sentry-checkpoint"]);
});
