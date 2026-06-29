// FAFF-49 — Sentry (1): live-run derailment detection + hard kill-switch.
// The L4 supervisory lane READS a live run's append-only surface (events.jsonl +
// run-ledger.json + owner.last_heartbeat + a CONSUMED `faff budget check`) without
// mutating it, emits DerailmentVerdicts + a v1 intervention (continue|pause|abort),
// and `abort` leaves resumable state. Covers all six acceptance criteria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");

// run the CLI in `cwd`; returns { code, out, err }
function run(cwd, args, input) {
  try {
    const out = execFileSync("node", [CLI, ...args], { cwd, encoding: "utf8", input: input ?? "" });
    return { code: 0, out: out.trim(), err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").toString().trim(), err: (e.stderr ?? "").toString().trim() };
  }
}
function git(cwd, args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim(); }
function tmp() { return mkdtempSync(join(tmpdir(), "faff49-")); }

// Provision a run dir with a ledger + optional events under <dir>/.faff/runs/<id>.
function mkRun(dir, id, ledger, eventLines) {
  const rd = join(dir, ".faff", "runs", id);
  mkdirSync(rd, { recursive: true });
  writeFileSync(join(rd, "run-ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
  if (eventLines && eventLines.length) {
    writeFileSync(join(rd, "events.jsonl"), eventLines.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }
  return rd;
}
const STALE = "2020-01-01T00:00:00Z"; // far past → heartbeat age >> any window

// --- selftest (drives every pure core, incl. the AC5 no-write-path case) ---------

test("sentry --selftest passes", () => {
  const dir = tmp();
  try { assert.equal(run(dir, ["sentry", "--selftest"]).code, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC1: reads the surface without mutating, a verdict per trigger ---------------

test("AC1: check reads events+ledger+budget+heartbeat and emits a verdict per trigger, mutating nothing", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["X1", "X2"], outcomes: { X1: "shipped" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: STALE, last_heartbeat: STALE },
    };
    const rd = mkRun(dir, "r", ledger, [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "X2" },
      { schema: 1, run_id: "r", seq: 1, ts: "t", phase: "build", type: "build-start", issue: "X2" },
      { schema: 1, run_id: "r", seq: 2, ts: "t", phase: "build", type: "build-start", issue: "X2" },
    ]);
    const ledgerBefore = readFileSync(join(rd, "run-ledger.json"), "utf8");
    const eventsBefore = readFileSync(join(rd, "events.jsonl"), "utf8");

    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.out);
    const signals = out.verdicts.map((v) => v.signal).sort();
    assert.deepEqual(signals, ["budget-breach", "fix-review-thrash", "wall-clock-runaway"]);
    for (const v of out.verdicts) assert.ok(v.signal && v.severity && v.evidence, "each verdict carries signal/severity/evidence");

    // READ-ONLY: the surface is byte-identical after the check.
    assert.equal(readFileSync(join(rd, "run-ledger.json"), "utf8"), ledgerBefore, "ledger not mutated");
    assert.equal(readFileSync(join(rd, "events.jsonl"), "utf8"), eventsBefore, "events not mutated");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC2: budget-breach is the CONSUMED `faff budget check`, not an own counter ----

test("AC2: budget-breach mirrors `faff budget check` exactly (Sentry consumes the CLI)", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: "2026-06-29T00:00:00Z", last_heartbeat: "2026-06-29T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    const budget = JSON.parse(run(dir, ["budget", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(budget.breached.includes("max_attempts") && budget.outcome === "escalate", "fixture drives a real budget breach");

    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    const bb = out.verdicts.find((v) => v.signal === "budget-breach");
    assert.ok(bb, "budget-breach verdict present");
    // The evidence is byte-identical to the budget CLI's reading — consumed, not re-derived.
    assert.equal(bb.evidence.budget_outcome, budget.outcome);
    assert.deepEqual(bb.evidence.breached, budget.breached);
    assert.equal(bb.severity, "trip");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC2: the sentry source carries no token/cost counter — it shells `budget check`", () => {
  const src = readFileSync(CLI, "utf8");
  const start = src.indexOf("function cmdSentry");
  const end = src.indexOf("function sentrySelftest");
  const region = src.slice(src.indexOf("// sentry — FAFF-49"), end > start ? end : undefined);
  assert.ok(/\[__filename, "budget", "check"/.test(region), "consumes `faff budget check` via a child invocation");
  assert.ok(!/measureTokens|tokens_at_start|price_per_mtok|est_tokens_per_attempt/.test(region), "no budget math re-implemented in sentry");
});

// --- AC3: wall-clock-runaway trips on heartbeat staleness beyond the window --------

test("AC3: wall-clock-runaway trips when heartbeat staleness exceeds the configured window", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: STALE, last_heartbeat: STALE } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    const wc = out.verdicts.find((v) => v.signal === "wall-clock-runaway");
    assert.ok(wc && wc.severity === "trip");
    assert.equal(wc.evidence.tripped_on, "heartbeat-staleness");
    assert.equal(wc.evidence.ledger_field, "owner.last_heartbeat");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC3: a fresh heartbeat does NOT trip wall-clock-runaway", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(out.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined);
    assert.equal(out.tripped, false);
    assert.equal(out.intervention, "continue");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC3: the stall window is a config value (sentry.stall_window_secs tightens it)", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), "sentry:\n  stall_window_secs: 5\n");
    const ago10 = new Date(Date.now() - 10_000).toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: ago10, last_heartbeat: ago10 } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(out.thresholds.stall_window_secs, 5, "config value resolved");
    assert.ok(out.verdicts.some((v) => v.signal === "wall-clock-runaway"), "10s-old heartbeat trips a 5s window");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC4: trip→abort commits WIP, marks aborted-resumable, run is re-enterable -----

test("AC4: abort commits worktree WIP to its branch, marks the ledger aborted-resumable, run re-enterable", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["FAFF-9"], outcomes: {}, owner: { status: "running", started_at: STALE, last_heartbeat: STALE } });
    // a worktree-like git repo with a committed base + uncommitted WIP
    const wt = join(dir, "wt"); mkdirSync(wt);
    git(wt, ["init", "-q"]); git(wt, ["config", "user.email", "a@b.c"]); git(wt, ["config", "user.name", "t"]);
    writeFileSync(join(wt, "base.txt"), "base"); git(wt, ["add", "-A"]); git(wt, ["commit", "-qm", "base"]);
    const baseSha = git(wt, ["rev-parse", "HEAD"]);
    writeFileSync(join(wt, "feature.txt"), "wip"); // uncommitted WIP
    assert.notEqual(git(wt, ["status", "--porcelain"]), "", "worktree dirty before abort");

    const r = run(dir, ["sentry", "abort", "--run-dir", rd, "--issue", "FAFF-9", "--signal", "budget-breach", "--worktree", wt, "--json"]);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.out);
    assert.equal(out.status, "aborted-resumable");
    assert.ok(out.wip_commit, "a WIP commit sha is returned");

    // WIP committed to the branch; worktree clean; NEVER force-reset (base still reachable).
    assert.equal(git(wt, ["status", "--porcelain"]), "", "worktree clean after WIP commit");
    assert.equal(git(wt, ["rev-parse", "HEAD~1"]), baseSha, "base commit is the WIP commit's parent — no force-reset");
    assert.match(git(wt, ["log", "-1", "--pretty=%s"]), /sentry abort \(resumable\)/);

    // ledger marked aborted-resumable; outcomes preserved (FAFF-9 stays undispatched → resumable).
    const led = JSON.parse(readFileSync(join(rd, "run-ledger.json"), "utf8"));
    assert.equal(led.abort.status, "aborted-resumable");
    assert.equal(led.abort.wip_commit, out.wip_commit);
    assert.equal(led.owner.status, "aborted-resumable");
    assert.deepEqual(led.admitted, ["FAFF-9"]);
    assert.deepEqual(led.outcomes, {}, "no terminal outcome forced — the run is re-enterable");

    // re-enterable: runcheck parses it and shows FAFF-9 still to-dispatch, no invalid outcome (no corrupt half-state).
    const rc = JSON.parse(run(dir, ["runcheck", "--json", rd]).out);
    assert.deepEqual(rc.undispatched, ["FAFF-9"]);
    assert.deepEqual(rc.invalid_outcomes, [], "aborted-resumable is not written as a bogus terminal outcome");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC4: abort with no worktree still marks the ledger (WIP commit is best-effort)", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["Z"], outcomes: {}, owner: { status: "running", started_at: STALE, last_heartbeat: STALE } });
    const out = JSON.parse(run(dir, ["sentry", "abort", "--run-dir", rd, "--json"]).out);
    assert.equal(out.status, "aborted-resumable");
    assert.equal(out.wip_commit, null);
    assert.equal(JSON.parse(readFileSync(join(rd, "run-ledger.json"), "utf8")).abort.status, "aborted-resumable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC4: abort on a missing run dir → exit 3; malformed ledger → exit 2", () => {
  const dir = tmp();
  try {
    assert.equal(run(dir, ["sentry", "abort", "--run-dir", join(dir, "nope")]).code, 3);
    const rd = join(dir, ".faff", "runs", "bad"); mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "run-ledger.json"), "{ not json");
    assert.equal(run(dir, ["sentry", "abort", "--run-dir", rd]).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC5: the stop is at the dispatch boundary; the subagent has no write-path ------

test("AC5: no CLI input the build subagent controls can flip a trip — the kill reads only the orchestrator surface", () => {
  const dir = tmp();
  try {
    // A genuine budget-breach trip on the orchestrator-owned surface.
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: "2026-06-29T00:00:00Z", last_heartbeat: "2026-06-29T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    // The build subagent returns only a terminal token; it has NO flag on `sentry check`.
    // Feeding token-shaped junk as extra args must not suppress the abort.
    const base = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(base.intervention, "abort");
    const hostile = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--intervention", "continue", "--suppress", "--outcome", "shipped", "--override", "continue"]).out);
    assert.equal(hostile.intervention, "abort", "no subagent-shaped arg flips the verdict");
    assert.deepEqual(hostile.verdicts, base.verdicts);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC6: corrective-redirect / fleet / who-watches-the-watcher are NOT here -------

test("AC6: the v1 intervention ladder stops at abort — `correct` is deferred, not present", () => {
  const dir = tmp();
  try {
    // No reachable code path or output ever yields `correct`; the ladder is continue|pause|abort.
    const src = readFileSync(CLI, "utf8");
    assert.ok(/const SENTRY_INTERVENTIONS = \["continue", "pause", "abort"\]/.test(src), "ladder is exactly continue|pause|abort");
    // exercised live: the worst aggregate Sentry can route to is abort.
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: STALE, last_heartbeat: STALE },
    };
    const rd = mkRun(dir, "r", ledger);
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(["continue", "pause", "abort"].includes(out.intervention));
    assert.notEqual(out.intervention, "correct");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
