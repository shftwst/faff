// FAFF-49 — Sentry (1): live-run derailment detection + hard kill-switch.
// The L4 supervisory lane READS a live run's append-only surface (events.jsonl +
// run-ledger.json + owner.last_heartbeat + a CONSUMED `faff budget check`) without
// mutating it, emits DerailmentVerdicts + a v1 intervention (continue|pause|abort),
// and `abort` leaves resumable state. Covers all six acceptance criteria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { actsOnSentryAbort, sentryActingFromConfig } from "../plugin/skills/faff/bin/lib/sentry.js";
import { parseYamlSubset } from "../plugin/skills/faff/bin/lib/shared-infra.js";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "faff");
// FAFF-441: the sentry implementation now lives in its own module; source-structure
// assertions read it there rather than the thin entrypoint.
const SENTRY_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "lib", "sentry.js");

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

// FAFF-301: compare two verdict arrays order-insensitively (signal is the stable
// identity), mirroring AC1's `signals.sort()`. Sorting reorders, never drops — a
// genuinely different verdict (extra signal / drifted evidence) still fails.
function assertSameVerdicts(a, b, msg) {
  const bySignal = (xs) => xs.slice().sort((x, y) => (x.signal < y.signal ? -1 : x.signal > y.signal ? 1 : 0));
  assert.deepEqual(bySignal(a), bySignal(b), msg);
}

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

    // FAFF-301: pin a deterministic clock so this never depends on wall-clock time of
    // day (the budget-breach assertion is attempts-based and clock-independent, but
    // pinning future-proofs against the same flake the AC5 fixture hit).
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(Date.parse("2026-06-29T00:00:00Z"))]).out);
    const bb = out.verdicts.find((v) => v.signal === "budget-breach");
    assert.ok(bb, "budget-breach verdict present");
    // The evidence is byte-identical to the budget CLI's reading — consumed, not re-derived.
    assert.equal(bb.evidence.budget_outcome, budget.outcome);
    assert.deepEqual(bb.evidence.breached, budget.breached);
    assert.equal(bb.severity, "trip");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC2: the sentry source carries no token/cost counter — it shells `budget check`", () => {
  const src = readFileSync(SENTRY_SRC, "utf8");
  const start = src.indexOf("function cmdSentry");
  const end = src.indexOf("function sentrySelftest");
  // Anchor on the section-name fragment, agnostic of the banner's region-tag framing.
  const region = src.slice(src.indexOf("sentry — FAFF-49"), end > start ? end : undefined);
  assert.ok(/\[ENTRYPOINT, "budget", "check"/.test(region), "consumes `faff budget check` via a child invocation");
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
    // FAFF-355: no heartbeat FILE exists in this fixture, so the overlay falls back
    // to the ledger field — evidence names that true source, not a hardcoded string.
    assert.equal(wc.evidence.heartbeat_source, "owner.last_heartbeat");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-355: a fresh heartbeat FILE overrides a stale ledger field — no wall-clock-runaway trip; evidence names heartbeat_source", () => {
  const dir = tmp();
  try {
    const staleField = new Date(Date.now() - 2_000_000).toISOString(); // well past the 900s default window
    const recentStart = new Date(Date.now() - 60_000).toISOString(); // 1 min — well under the 4h run-elapsed ceiling
    const rd = mkRun(dir, "r", {
      run_id: "r", admitted: [], outcomes: {},
      owner: { status: "running", started_at: recentStart, last_heartbeat: staleField },
    });
    writeFileSync(join(rd, "heartbeat"), new Date().toISOString() + "\n");
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(out.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined,
      "the fresher heartbeat-file overlay prevents a false trip on a stale legacy field");
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

// ===========================================================================
// FAFF-447 — budget-metering-degraded: closes FAFF-428's named follow-up. A live
// L4 run reading tokens_source:"estimate" (the FAFF-428 degrade) past a
// configurable exposure window (sentry.estimate_metering_exposure_secs, default
// 1800s) trips a `pause` — never abort/correct (a blind meter is a blind spot,
// not a proven breach). --budget-json is the hermetic test hook (mirrors the
// AC2 pattern) — production reads it off the consumed `faff budget check` JSON.
// ===========================================================================

test("FAFF-447: a running L4 ledger + estimate-only tokens past the exposure window trips budget-metering-degraded → pause", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 40 * 60 * 1000).toISOString(); // 40 min ago > 1800s default
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--budget-json", JSON.stringify({ breached: [], outcome: "none", tokens_source: "estimate" })]).out);
    const v = out.verdicts.find((x) => x.signal === "budget-metering-degraded");
    assert.ok(v, "budget-metering-degraded verdict present");
    assert.equal(v.severity, "trip");
    assert.equal(v.evidence.tokens_source, "estimate");
    assert.equal(out.intervention, "pause");
    assert.equal(out.tripped, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: the SAME ledger WELL WITHIN the exposure window carries no budget-metering-degraded verdict", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 10 * 1000).toISOString(); // 10s ago, well under 1800s
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--budget-json", JSON.stringify({ breached: [], outcome: "none", tokens_source: "estimate" })]).out);
    assert.equal(out.verdicts.find((v) => v.signal === "budget-metering-degraded"), undefined);
    assert.equal(out.intervention, "continue");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: the same aged-past-threshold L4 ledger with a MEASURED transcript (tokens_source:transcript) carries no verdict", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--budget-json", JSON.stringify({ breached: [], outcome: "none", tokens_source: "transcript" })]).out);
    assert.equal(out.verdicts.find((v) => v.signal === "budget-metering-degraded"), undefined,
      "a measured meter is never a blind spot, regardless of elapsed time");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: the same aged-past-threshold ledger with NO level field (or level:L3) carries no verdict (L1-L3 unaffected)", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const budgetJson = JSON.stringify({ breached: [], outcome: "none", tokens_source: "estimate" });

    const rdNoLevel = mkRun(dir, "no-level", { run_id: "no-level", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const outNoLevel = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rdNoLevel, "--json", "--budget-json", budgetJson]).out);
    assert.equal(outNoLevel.verdicts.find((v) => v.signal === "budget-metering-degraded"), undefined, "no level field at all -> unaffected");

    const rdL3 = mkRun(dir, "l3", { run_id: "l3", level: "L3", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const outL3 = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rdL3, "--json", "--budget-json", budgetJson]).out);
    assert.equal(outL3.verdicts.find((v) => v.signal === "budget-metering-degraded"), undefined, "level:L3 -> unaffected");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: sentry.estimate_metering_exposure_secs is a config value (tightens the window)", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, ".faffrc.yaml"), "sentry:\n  estimate_metering_exposure_secs: 5\n");
    const started = new Date(Date.now() - 10 * 1000).toISOString(); // 10s ago > tightened 5s window
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--budget-json", JSON.stringify({ breached: [], outcome: "none", tokens_source: "estimate" })]).out);
    assert.equal(out.thresholds.estimate_metering_exposure_secs, 5, "config value resolved");
    assert.ok(out.verdicts.some((v) => v.signal === "budget-metering-degraded"), "10s-old estimate-only run trips a tightened 5s window");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: a co-tripping genuine budget-breach still wins the ladder-max (abort) over the degrade's pause; the degrade verdict is still present", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--budget-json", JSON.stringify({ breached: ["max_attempts"], outcome: "escalate", tokens_source: "estimate" })]).out);
    assert.equal(out.intervention, "abort", "budget-breach's mapped abort wins the ladder-max");
    assert.ok(out.verdicts.some((v) => v.signal === "budget-metering-degraded"), "the co-tripping degrade verdict is still reported, just outranked");
    assert.ok(out.verdicts.some((v) => v.signal === "budget-breach"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-447: authority:'available' never upgrades budget-metering-degraded past pause (only fix-review-thrash upgrades)", () => {
  const dir = tmp();
  try {
    const started = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", level: "L4", admitted: [], outcomes: {}, owner: { status: "running", started_at: started, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--authority", "available",
      "--budget-json", JSON.stringify({ breached: [], outcome: "none", tokens_source: "estimate" })]).out);
    assert.equal(out.intervention, "pause");
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
    // A genuine budget-breach trip on the orchestrator-owned surface. The fixture's
    // absolute start may stay absolute — FAFF-301 pins the clock per call (via the
    // hermetic --now-ms seam), so the test no longer depends on the wall-clock time
    // of day it runs at. Two ambient Date.now() samples drifting ~1s was the flake.
    const fixtureStart = "2026-06-29T00:00:00Z";
    const startMs = Date.parse(fixtureStart);
    const HOUR = 3_600_000;
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: fixtureStart, last_heartbeat: fixtureStart },
    };
    const rd = mkRun(dir, "r", ledger);

    // Multiple simulated late-day clocks (start +1h / +6h / +21h): each pins `now`
    // to the SAME instant across the base and hostile calls, so their time-based
    // evidence is identical and the compare is deterministic at any time of day.
    for (const offset of [1 * HOUR, 6 * HOUR, 21 * HOUR]) {
      const now = String(startMs + offset);
      const base = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", now]).out);
      assert.equal(base.intervention, "abort", `pinned clock +${offset / HOUR}h trips abort`);
      // The build subagent returns only a terminal token; it has NO flag on `sentry check`.
      // FAFF-576: fail-closed flag parsing now REJECTS token-shaped junk args with a usage exit (2)
      // rather than silently ignoring them — a strictly stronger form of "no subagent-controlled CLI
      // input can flip the trip": the hostile invocation refuses outright, producing no verdict to flip.
      const hostile = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", now,
        "--intervention", "continue", "--suppress", "--outcome", "shipped", "--override", "continue"]);
      assert.equal(hostile.code, 2, "hostile subagent-shaped args are rejected fail-closed (exit 2), never silently ignored");
      assert.match(hostile.err, /unknown-flag/, "the rejection names the unknown flag(s)");
    }

    // The clock seam itself cannot suppress the abort. FAFF-576: a duplicated non-repeatable
    // --now-ms is now a duplicate-flag usage error (exit 2) rather than silent first-/last-wins,
    // so a second clock value can't even be smuggled in — a strictly stronger guarantee. (That
    // budget-breach is clock-independent is covered by the pinned-clock abort asserted above.)
    const evenNow = run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--now-ms", String(startMs + HOUR), "--now-ms", String(startMs)]);
    assert.equal(evenNow.code, 2, "a duplicated clock flag is rejected fail-closed, never silently first/last-wins");
    assert.match(evenNow.err, /duplicate-flag/, "the rejection names the duplicated flag");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- FAFF-425: check's own ledger-read fault is a loud "indeterminate", never a --
// --- silent "no derailment" ------------------------------------------------------

test("FAFF-425: a present-but-corrupt ledger at the resolved run dir → exit 3, indeterminate, never 'no derailment'", () => {
  const dir = tmp();
  try {
    const rd = join(dir, ".faff", "runs", "bad");
    mkdirSync(rd, { recursive: true });
    writeFileSync(join(rd, "run-ledger.json"), "{ not json");
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json"]);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.indeterminate, true);
    assert.equal(out.tripped, false);
    assert.equal(out.intervention, "continue");
    assert.deepEqual(out.verdicts, []);
    assert.match(out.reason, /ledger unreadable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-425: an explicit --run-dir naming an absent ledger → exit 3, indeterminate, NEVER falls back to a real latest run", () => {
  const dir = tmp();
  try {
    // A real, healthy run exists as `latest` — proving the resolver does not
    // quietly fall back to it when the EXPLICIT --run-dir's ledger is missing.
    mkRun(dir, "good", { run_id: "good", admitted: [], outcomes: {}, owner: { status: "done" } });
    const missing = join(dir, ".faff", "runs", "does-not-exist");
    const r = run(dir, ["sentry", "check", "--run-dir", missing, "--json"]);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.indeterminate, true);
    assert.match(out.reason, /explicit run named but its ledger is absent/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-425: no run at all in the repo → exit 0, all-clear, unchanged (legitimately empty, not a fault)", () => {
  const dir = tmp();
  try {
    const r = run(dir, ["sentry", "check", "--json"]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.run_dir, null);
    assert.deepEqual(out.verdicts, []);
    assert.equal(out.intervention, "continue");
    assert.equal(out.tripped, false);
    assert.notEqual(out.indeterminate, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-425 (adversarial-review follow-up): an UNPARSEABLE --budget-json is itself an own-fault → indeterminate, never the pre-fix 'none' swallow", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["A"], outcomes: {},
      owner: { status: "running", started_at: "2026-06-29T00:00:00Z", last_heartbeat: "2026-06-29T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--budget-json", "{ not json"]);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.indeterminate, true);
    assert.equal(out.tripped, false);
    assert.equal(out.intervention, "continue");
    assert.match(out.reason, /budget consult indeterminate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-425: a budget consult that hits the same own-fault (indeterminate) propagates through sentry check as its own indeterminate, not a trip", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["A"], outcomes: {},
      owner: { status: "running", started_at: "2026-06-29T00:00:00Z", last_heartbeat: "2026-06-29T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    // hermetic injection hook: simulate sentryReadBudget having consumed an
    // indeterminate budget child (rather than spinning up a real corrupt-ledger
    // child process for this unit).
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--budget-json", JSON.stringify({ breached: [], outcome: "indeterminate" })]);
    assert.equal(r.code, 3, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.indeterminate, true);
    assert.equal(out.tripped, false);
    assert.equal(out.intervention, "continue");
    assert.match(out.reason, /budget consult indeterminate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- AC6: corrective-redirect / fleet / who-watches-the-watcher are NOT here -------
// FAFF-326 (Sentry-2, Channel A) consciously EXTENDS this guard rather than deleting
// it: the ladder now contains `correct` (between pause and abort), but it stays
// UNREACHABLE while unasserted — the only production state this sandbox can ever
// exercise via the CLI (the corrective-integrity gate reads the genuine pid-1
// environ; there is no ambient way to fake asserted:true from a test process).

// --- FAFF-352: the effects→sentry bridge — `--forbidden-side-effect` on `check` -----

test("FAFF-352: --forbidden-side-effect arms forbidden-side-effect-attempt (trip → abort); absent flag → no such verdict, unchanged degraded behaviour", () => {
  const dir = tmp();
  try {
    // A clean surface: fresh heartbeat, no budget breach, no thrash/failures — so the
    // ONLY thing that can trip is the flag itself, isolating its effect.
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });

    const without = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(without.verdicts.find((v) => v.signal === "forbidden-side-effect-attempt"), undefined,
      "absent the flag (and no event-path signal), the trigger degrades to no-signal exactly as before");
    assert.equal(without.intervention, "continue");

    const withFlag = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--forbidden-side-effect"]).out);
    const fse = withFlag.verdicts.find((v) => v.signal === "forbidden-side-effect-attempt");
    assert.ok(fse, "forbidden-side-effect-attempt verdict present with the flag");
    assert.equal(fse.severity, "trip");
    assert.equal(withFlag.intervention, "abort", "forbidden-side-effect-attempt maps to abort per SIGNAL_TRIP_INTERVENTION");

    // FAFF-352 WHAT constraint: the emitted payload carries no TOP-LEVEL
    // forbidden_side_effect key (only nested, if at all, under verdict evidence) — so
    // a future emitter can never smuggle the events-path predicate's key in here.
    assert.ok(!("forbidden_side_effect" in withFlag), "no top-level forbidden_side_effect key in the sentry check payload");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-352 bridge integration: an escaped effect (declared-effects ledger) → `effects check` any_escape:true → flagged `sentry check` → abort", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["FAFF-1"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });

    // Seed an OBSERVED effect with no covering DECLARATION — an escape by construction.
    const observeR = run(dir, ["effects", "observe", "--run", "r", "--issue", "FAFF-1", "--step", "build"],
      JSON.stringify({ kind: "deploy", target: "prod" }));
    assert.equal(observeR.code, 0);

    const checkR = JSON.parse(run(dir, ["effects", "check", "--run", "r", "--json"]).out);
    assert.equal(checkR.any_escape, true, "the observed effect with no declaration is a real escape");

    // The orchestrator passes --forbidden-side-effect IFF any_escape — exercise both
    // sides of that branch against the SAME ledger state.
    const clean = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(clean.verdicts.find((v) => v.signal === "forbidden-side-effect-attempt"), undefined,
      "without the bridged flag, the escape alone does not trip sentry (event-path only, and no event carries it)");

    const bridged = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--forbidden-side-effect"]).out);
    assert.equal(bridged.intervention, "abort", "the bridged escape trips abort at the very next checkpoint");
    assert.ok(bridged.verdicts.some((v) => v.signal === "forbidden-side-effect-attempt" && v.severity === "trip"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AC6 (extended, FAFF-326): the ladder now CONTAINS `correct` (between pause and abort), but stays unreachable while unasserted", () => {
  const dir = tmp();
  try {
    const src = readFileSync(SENTRY_SRC, "utf8");
    assert.ok(/const SENTRY_INTERVENTIONS = \["continue", "pause", "correct", "abort"\]/.test(src), "ladder is exactly continue|pause|correct|abort");
    // exercised live: the worst aggregate Sentry can route to (unasserted) is still abort.
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "shipped", B: "parked" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: STALE, last_heartbeat: STALE },
    };
    const rd = mkRun(dir, "r", ledger);
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(["continue", "pause", "correct", "abort"].includes(out.intervention));
    assert.notEqual(out.intervention, "correct");
    assert.equal(out.authority, "channel-D-only", "the real corrective-integrity gate is unasserted in this sandbox — authority degrades honestly");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-326: a thrash-only trip (no budget/wall-clock competing signal), UNASSERTED (no real declaration) → still pause, `correct` unreachable via the live CLI", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const events = [0, 1, 2].map((seq) => ({ type: "build-start", issue: "A", seq }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } }, events);
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(out.intervention, "pause", "thrash trip, unasserted authority → the v1 default, unchanged");
    assert.equal(out.authority, "channel-D-only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-326: the --authority hermetic test seam is explicit-flag-only — 'available' upgrades a thrash trip to `correct`", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const events = [0, 1, 2].map((seq) => ({ type: "build-start", issue: "A", seq }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } }, events);
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--authority", "available"]).out);
    assert.equal(out.intervention, "correct");
    assert.equal(out.authority, "available");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-326: an unparseable --authority value fails loud (exit 2), never a silent fallback", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "done" } });
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--authority", "yes-please"]);
    assert.equal(r.code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ===========================================================================
// FAFF-324: on-disk CONTENT-forgery probes under the shared-fs container model.
//
// AC5 (above) covers INJECTED-FIELD forgery — extra keys in the in-memory signal
// bundle a caller passes to `evaluateDerailment`. The production build subagent
// has no arg surface to reach that channel at all (it returns only a terminal
// token; `sentry check` is never invoked BY it). That leaves the channel AC5
// doesn't address: a same-uid, same-fs build lane REWRITING the on-disk files
// `sentry check` reads (run-ledger.json, events.jsonl) before the orchestrator's
// next check observes them — no special privilege needed, a plain writeFileSync.
//
// Each probe below demonstrates a genuine trip, then performs the SAME on-disk
// rewrite a build lane could perform, and shows the trip is suppressed. This is
// the evidence base for the ADR-0034 "Re-examination under the shared-fs
// container model (FAFF-324)" amendment (docs/adr/0034-*.md) — each probe name
// maps 1:1 to a row of that amendment's forgery-vector table.
// ===========================================================================

test("FAFF-324 vector 1: forging a fake issue-outcome/shipped event suppresses fix-review-thrash — sentry check has no reconcile-against-git step of its own", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const thrashEvents = [0, 1, 2].map((seq) => ({ schema: 1, run_id: "r", seq, ts: now, phase: "build", type: "build-start", issue: "A" }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } }, thrashEvents);

    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "fix-review-thrash"), "genuine thrash trips before forgery");

    // Same-uid build-lane forgery: append a fabricated issue-outcome:shipped event.
    // No merge ever happened, no merge-record.json exists — just a raw JSONL append.
    const forged = [...thrashEvents, { schema: 1, run_id: "r", seq: 3, ts: now, phase: "build", type: "issue-outcome", issue: "A", data: { outcome: "shipped" } }];
    writeFileSync(join(rd, "events.jsonl"), forged.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "fix-review-thrash"), undefined,
      "the forged shipped event suppresses the genuine thrash trip");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 2: truncating build-start events out of events.jsonl suppresses fix-review-thrash", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const thrashEvents = [0, 1, 2].map((seq) => ({ schema: 1, run_id: "r", seq, ts: now, phase: "build", type: "build-start", issue: "A" }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } }, thrashEvents);
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "fix-review-thrash"));

    // Forgery: rewrite the "append-only" log down to 2 of the 3 real build-start
    // events. events.jsonl is append-only by CONVENTION, not by filesystem enforcement.
    writeFileSync(join(rd, "events.jsonl"), thrashEvents.slice(0, 2).map((e) => JSON.stringify(e)).join("\n") + "\n");
    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "fix-review-thrash"), undefined,
      "truncating events.jsonl below thrash_n suppresses the trip");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 3: rewriting ledger.outcomes suppresses budget-breach (max_attempts) — attemptsFromLedger trusts the file wholesale", () => {
  const dir = tmp();
  try {
    const now = "2026-06-29T00:00:00Z";
    const ledger = {
      run_id: "r", admitted: ["A", "B"], outcomes: { A: "errored", B: "errored" },
      budget: { envelope: { ceilings: { max_attempts: 1 }, at_ceiling: "escalate" } },
      owner: { status: "running", started_at: now, last_heartbeat: now },
    };
    const rd = mkRun(dir, "r", ledger);
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(Date.parse(now))]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "budget-breach"), "genuine max_attempts breach trips before forgery");

    // Forgery: rewrite both real attempt outcomes to "routed-out" — a non-attempt
    // outcome attemptsFromLedger deliberately excludes (an issue that never got a
    // graft invocation shouldn't count). This is the precise forgery attemptsFromLedger
    // cannot distinguish from a genuine routed-out: it counts ledger.outcomes keys
    // wholesale, no cross-check against how many builds the tracker/git actually saw
    // dispatched. (Emptying outcomes to {} entirely does NOT work as a forgery here —
    // attemptsFromLedger's own admitted-count FALLBACK for an empty outcomes object
    // means a forger must leave same-cardinality, wrong-VALUE entries, not delete them.)
    const forgedLedger = { ...ledger, outcomes: { A: "routed-out", B: "routed-out" } };
    writeFileSync(join(rd, "run-ledger.json"), JSON.stringify(forgedLedger, null, 2) + "\n");
    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(Date.parse(now))]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "budget-breach"), undefined,
      "relabelling both real attempts as routed-out suppresses the max_attempts breach the real attempt count would have tripped");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 4: rewriting owner.last_heartbeat to 'now' suppresses wall-clock-runaway (heartbeat staleness) — liveness has no git-truth counterpart", () => {
  const dir = tmp();
  try {
    // A recent started_at (well under the 4h run-elapsed ceiling) so ONLY heartbeat
    // staleness can trip — isolates the vector from vector 5's run-elapsed trip.
    const recentStart = new Date(Date.now() - 60_000).toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: recentStart, last_heartbeat: STALE } });
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.evidence.tripped_on === "heartbeat-staleness"));

    // Forgery: rewrite owner.last_heartbeat directly in run-ledger.json — bypassing
    // the sanctioned `faff heartbeat` write path (FAFF-355), which only ever writes
    // the dedicated heartbeat FILE, never this ledger field, and only while
    // owner.status === "running" (a read-only guard against the very ledger this
    // probe is rewriting — no enforcement barrier against a direct fs write).
    const led = JSON.parse(readFileSync(join(rd, "run-ledger.json"), "utf8"));
    led.owner.last_heartbeat = new Date().toISOString();
    writeFileSync(join(rd, "run-ledger.json"), JSON.stringify(led, null, 2) + "\n");

    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined,
      "a forged fresh heartbeat suppresses staleness detection — no reconcile path exists for liveness");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 4b: ticking the SANCTIONED `faff heartbeat` command (no raw fs bypass) also suppresses wall-clock-runaway (heartbeat-file overlay) — the production-reachable variant of vector 4, not merely a theoretical one", () => {
  const dir = tmp();
  try {
    // Same isolation as vector 4: a recent started_at so ONLY heartbeat staleness can
    // trip, keeping this probe distinct from vector 5's run-elapsed trip.
    const recentStart = new Date(Date.now() - 60_000).toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: recentStart, last_heartbeat: STALE } });
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.evidence.tripped_on === "heartbeat-staleness"));

    // Forgery: call the SANCTIONED `faff heartbeat` command itself — the write path
    // FAFF-355 grants every build subagent legitimately, for real liveness ticking
    // during long steps (gate ladder, adversarial review). No raw fs write, no
    // bypassed guard: `cmdHeartbeat` writes the dedicated heartbeat FILE, which
    // `overlayHeartbeat` prefers over a stale `owner.last_heartbeat` (bin/lib/
    // sentry.js's `cmdSentry` calls `overlayHeartbeat(ledger, readHeartbeatFile(...))`
    // before evaluating any predicate). A build lane that is genuinely stalled but
    // keeps ticking — the exact "gamed liveness" residual ADR-0034's follow-up guard
    // names but does not solve — suppresses the SAME trip via the SAME production
    // code path a legitimate long step uses, no forgery-grade access required at all.
    const tick = run(dir, ["heartbeat", rd, "--json"]);
    assert.equal(tick.code, 0, "the sanctioned heartbeat tick itself must succeed");
    assert.ok(existsSync(join(rd, "heartbeat")), "the tick wrote the dedicated heartbeat file FAFF-355 defines");

    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined,
      "a sanctioned-but-gamed heartbeat tick suppresses staleness detection via the FILE overlay — " +
      "distinct from vector 4's ledger-field bypass, and MORE directly production-reachable since it " +
      "requires no raw fs write at all, only calling a tool the build lane already legitimately has");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 5: rewriting owner.started_at to 'now' suppresses wall-clock-runaway (run-elapsed) — no git-truth counterpart", () => {
  const dir = tmp();
  try {
    // Fresh heartbeat (so ONLY run-elapsed can trip) but started long enough ago to
    // exceed the 4h default run_elapsed_ceiling_secs.
    const now = new Date();
    const longAgo = new Date(now.getTime() - (14400 + 600) * 1000).toISOString(); // ceiling + 10min
    const nowIso = now.toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: longAgo, last_heartbeat: nowIso } });
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.evidence.tripped_on === "run-elapsed"));

    const led = JSON.parse(readFileSync(join(rd, "run-ledger.json"), "utf8"));
    led.owner.started_at = new Date().toISOString();
    writeFileSync(join(rd, "run-ledger.json"), JSON.stringify(led, null, 2) + "\n");

    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined,
      "a forged recent started_at suppresses run-elapsed detection — no git/tracker record of the run's true start exists to reconcile against");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 6: flipping owner.status running→done suppresses wall-clock-runaway entirely — only a running owner is evaluated", () => {
  const dir = tmp();
  try {
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: STALE, last_heartbeat: STALE } });
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "wall-clock-runaway"));

    // Forgery: the run is NOT actually done — the process is still stuck — but a
    // direct ledger rewrite makes evalWallClock's `owner.status !== "running"` guard
    // skip it as if it had legitimately finished.
    const led = JSON.parse(readFileSync(join(rd, "run-ledger.json"), "utf8"));
    led.owner.status = "done";
    writeFileSync(join(rd, "run-ledger.json"), JSON.stringify(led, null, 2) + "\n");

    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "wall-clock-runaway"), undefined,
      "a forged owner.status='done' makes the running-owner guard skip a genuinely-runaway process entirely");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324 vector 7: deleting repeated-failure events suppresses repeated-identical-failure", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const failEvents = [0, 1, 2].map((seq) => ({ schema: 1, run_id: "r", seq, ts: now, phase: "build", type: "issue-outcome", issue: "B", data: { outcome: "errored", fingerprint: "boom" } }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["B"], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } }, failEvents);
    const before = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.ok(before.verdicts.some((v) => v.signal === "repeated-identical-failure"));

    writeFileSync(join(rd, "events.jsonl"), failEvents.slice(0, 2).map((e) => JSON.stringify(e)).join("\n") + "\n");
    const after = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(after.verdicts.find((v) => v.signal === "repeated-identical-failure"), undefined,
      "truncating the failure-event log below failure_k suppresses the trip");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-466: structural guard — `sentry check` now DOES reach integrityGate's 'detection' consumer, via a child spawn only (never a direct require, ADR-0042 region direction) — flipped from FAFF-324's absence-assertion now that the wiring landed. The 'reconcile-only' disposition's ENFORCEMENT behaviour (what sentry DOES with it) is a deliberately separate, still-open question owned by FAFF-511 — this guard only pins the WIRING, not that follow-on decision.", () => {
  const src = readFileSync(SENTRY_SRC, "utf8");
  assert.ok(/"corrective-integrity",\s*"--consumer",\s*"detection"/.test(src),
    "sentry.js spawns `corrective-integrity --consumer detection` (sentryReadDetectionIntegrity) — the " +
    "detection consumer is now reachable from `sentry check`, mirroring the pre-existing `--consumer " +
    "corrective` spawn (sentryReadCorrectiveAuthority) byte-for-byte in pattern.");
  assert.ok(!/correctiveIntegrityProbe|integrityGate/.test(src),
    "sentry.js STILL never in-process-calls the FAFF-373/325 corrective-integrity gate module directly " +
    "— region direction (ADR-0042: a governance span never references a factory identifier) holds even " +
    "though the detection consumer is now wired: both `--consumer corrective` and `--consumer detection` " +
    "reach the gate ONLY via a child spawn of this same bin, never a require of corrective-integrity.js.");
});

// ===========================================================================
// FAFF-466 Scenarios 1-3: `detection_trust` on `sentry check --json`. Scenario 1
// (a genuine pid-1 declaration) is not fakeable from an in-process test (no ambient
// way to synthesize asserted:true via the real CLI — same constraint noted for the
// AC6 authority tests above), so Scenarios 1 and 3 exercise the --detection-json
// hermetic seam (mirrors --budget-json: a well-formed value is consumed verbatim, an
// unparseable one is itself a read-fault). Scenario 2 (the common, no-declaration
// case) is exercised with NO override at all — the real, unfaked path.
// ===========================================================================

test("FAFF-466 Scenario 1: asserted-true wiring — a genuine covering declaration (simulated via --detection-json, the hermetic seam) yields detection_trust.disposition === 'trusted'", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--detection-json", JSON.stringify({ trusted: true, disposition: "trusted", basis: "asserted" })]).out);
    assert.equal(out.detection_trust.trusted, true);
    assert.equal(out.detection_trust.disposition, "trusted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-466 Scenario 2: unasserted (the common, no-declaration case, NO override) — detection_trust.disposition === 'reconcile-only', and predicate evaluation (verdicts/intervention) is BYTE-IDENTICAL to the pre-this-ticket payload shape", () => {
  const dir = tmp();
  try {
    const events = [0, 1, 2].map((seq) => ({ type: "build-start", issue: "A", seq }));
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: {}, owner: { status: "running", started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() } }, events);
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json"]).out);
    assert.equal(out.detection_trust.trusted, false);
    assert.equal(out.detection_trust.disposition, "reconcile-only", "no real pid-1 declaration exists in this sandbox — honest unasserted degrade");
    // Same thrash trip as the pre-FAFF-466 "unasserted authority" test above (line ~570)
    // — detection_trust is annotate-only; it changes nothing about verdict evaluation.
    assert.equal(out.intervention, "pause", "thrash trip, unchanged by detection_trust — annotate-only per Scenario 2");
    assert.equal(out.authority, "channel-D-only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-466 Scenario 3: read-fault fail-safe — an unparseable --detection-json (simulating a non-OK spawned child) degrades to {trusted:false, disposition:'reconcile-only', basis:'read-fault'}, and `sentry check` still exits 0", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--detection-json", "{ not json"]);
    assert.equal(r.code, 0, "sentry check still exits 0 on a detection read-fault");
    const out = JSON.parse(r.out);
    assert.deepEqual(out.detection_trust, { trusted: false, disposition: "reconcile-only", basis: "read-fault" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-466: a malformed-but-parseable --detection-json reply (trusted:'yes', a truthy-but-wrong-typed value) is NEVER coerced to trusted", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: [], outcomes: {}, owner: { status: "running", started_at: now, last_heartbeat: now } });
    const out = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--detection-json", JSON.stringify({ trusted: "yes", disposition: "trusted", basis: "asserted" })]).out);
    assert.equal(out.detection_trust.trusted, false, "only a strict === true on the reply's `trusted` field ever asserts trust");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324: `faff reconcile` (FAFF-397, wired at beep-boop run-end) DOES catch a forged TERMINAL 'shipped' claim — the backstop that exists, demonstrated end-to-end. It catches only the terminal claim, never the mid-run event/attempt-count tampering vectors 1-3/7 demonstrate above (those can suppress a real-time trip and let the run keep grinding WITHOUT ever having to fake a final shipped outcome).", () => {
  const dir = tmp();
  try {
    const now = new Date().toISOString();
    const rd = mkRun(dir, "r", { run_id: "r", admitted: ["A"], outcomes: { A: "shipped" }, owner: { status: "done", started_at: now, last_heartbeat: now } });
    // The orchestrator's run-end ReconcileInput for this issue (beep-boop step 11.5):
    // ledger claims "shipped", but no merge-record.json was ever written (no merge-gate
    // run ever happened for a build-lane-forged claim) and the live forge observation
    // shows no merge — exactly what a forged run-ledger.json outcome looks like from
    // the run-end reconcile's point of view.
    const reconcileInput = JSON.stringify({ shipped: [{ issue: "A", recorded: null, observed: { pr_merged: false, merged_head_sha: null } }] });

    const l4 = JSON.parse(run(dir, ["reconcile", "--run-dir", rd, "--level", "L4", "--json"], reconcileInput).out);
    assert.equal(l4.consistent, false);
    assert.equal(l4.divergences[0].class, "claimed-shipped-unmerged");
    assert.equal(l4.disposition, "needs-human", "at L4 (lights-out) the forged-shipped claim hard-blocks");

    const l3 = JSON.parse(run(dir, ["reconcile", "--run-dir", rd, "--level", "L3", "--json"], reconcileInput).out);
    assert.equal(l3.disposition, "warn", "at L3 (the ordinary autonomous default) the SAME divergence is only a non-blocking warn — surfaced, not gated");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-324: structural guard — `faff reconcile`'s divergence classes never inspect owner.*/heartbeat fields (vectors 4-6 have NO reconcile counterpart, not even advisory)", () => {
  const reconcileSrcPath = join(dirname(fileURLToPath(import.meta.url)), "..", "plugin", "skills", "faff", "bin", "lib", "reconcile.js");
  const src = readFileSync(reconcileSrcPath, "utf8");
  assert.ok(!/\bowner\b|last_heartbeat|started_at/.test(src),
    "reconcile.js's three divergence classes (phantom-merge, claimed-shipped-unmerged, unowned-sibling-mutation) " +
    "are defined entirely over shipped-outcome/merge-record/forge state and sibling terminal-state — none of them " +
    "touch a ledger's owner.status/started_at/last_heartbeat fields, so a heartbeat/run-elapsed/owner-status forgery " +
    "(vectors 4-6 above) has no reconcile-against-git counterpart of any kind, blocking or advisory.");
});

// ===========================================================================
// FAFF-327 — fleet (concurrent) member-resolved supervision, end-to-end via the real
// CLI (runCli/execFileSync, not the in-memory selftest above). Deterministic: every
// time-based assertion pins `--now-ms` (the FAFF-301 pattern) rather than depending
// on wall-clock time of day. Member files are written directly (mirroring what
// `faff heartbeat <dir> --unit <issue>` produces) so this exercises the READ side of
// the fleet path against real files on disk.
// ===========================================================================

function writeMemberBeat(runDir, issue, iso) {
  writeFileSync(join(runDir, `heartbeat.${issue}`), iso + "\n");
}

// The documented v1 default (SENTRY_THRESHOLD_DEFAULTS.stall_window_secs === 900,
// mirrors runcheck's RUN_HEARTBEAT_STALE_SECS_DEFAULT) — no `.faffrc` override in
// these fixtures, so this literal matches what `faff sentry check` actually resolves.
const STALL_WINDOW_SECS_DEFAULT = 900;

// FAFF-553: the documented v1 default run-elapsed ceiling
// (SENTRY_THRESHOLD_DEFAULTS.run_elapsed_ceiling_secs) — same no-override reasoning.
const RUN_ELAPSED_CEILING_SECS_DEFAULT = 14400;

test("FAFF-327 fleet fixture: N in-flight members (one stale) -> member-scoped pause end-to-end, run stays healthy", () => {
  const dir = tmp();
  try {
    const fixtureStart = "2026-07-01T00:00:00Z";
    const startMs = Date.parse(fixtureStart);
    const nowMs = startMs + (STALL_WINDOW_SECS_DEFAULT + 120) * 1000;
    const ledger = {
      run_id: "r", admitted: ["HEALTHY-1", "HEALTHY-2", "STALLED"], outcomes: {},
      owner: { status: "running", started_at: fixtureStart, last_heartbeat: new Date(nowMs - 5_000).toISOString() },
    };
    const rd = mkRun(dir, "r", ledger, [
      { schema: 1, run_id: "r", seq: 0, ts: fixtureStart, phase: "build", type: "build-start", issue: "HEALTHY-1" },
      { schema: 1, run_id: "r", seq: 1, ts: fixtureStart, phase: "build", type: "build-start", issue: "HEALTHY-2" },
      { schema: 1, run_id: "r", seq: 2, ts: fixtureStart, phase: "build", type: "build-start", issue: "STALLED" },
    ]);
    // Two members tick their own file recently; STALLED's file (and its build-start)
    // are both older than the stall window.
    writeMemberBeat(rd, "HEALTHY-1", new Date(nowMs - 5_000).toISOString());
    writeMemberBeat(rd, "HEALTHY-2", new Date(nowMs - 5_000).toISOString());
    writeMemberBeat(rd, "STALLED", fixtureStart);

    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(nowMs)]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.intervention, "pause", "one stalled member caps the fleet response at pause, never abort");
    assert.equal(out.tripped, true);
    const memberVerdicts = out.verdicts.filter((v) => v.scope === "member");
    assert.equal(memberVerdicts.length, 1, "exactly the one stalled member trips — the two healthy tickers do not");
    assert.equal(memberVerdicts[0].member, "STALLED");
    assert.equal(memberVerdicts[0].signal, "wall-clock-runaway");
    // The run heartbeat file itself is fresh (ticked by the healthy members) -> no
    // run-scoped wall-clock-runaway alongside the member one.
    assert.ok(!out.verdicts.some((v) => v.signal === "wall-clock-runaway" && v.scope === undefined),
      "the run itself is not runaway — only the one member is");

    // Report-only: no write on any fleet path, and no NEW file beyond the fixture's own.
    const before = ["run-ledger.json", "events.jsonl", "heartbeat.HEALTHY-1", "heartbeat.HEALTHY-2", "heartbeat.STALLED"].sort();
    assert.deepEqual(readdirSync(rd).sort(), before, "sentry check wrote nothing — same file set before and after");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-553 — deliberate contract change: all-members-stalled + a stale run heartbeat
// used to trip run-scoped "abort" unconditionally. Under the in-flight grace the
// run-scoped staleness trip contributes at most "pause" while ≥1 member is in flight
// and run-elapsed is under the ceiling — the verdict still trips (visible), evidence
// names the in-flight members and the grace, and the elapsed ceiling stays the
// unchanged hard backstop (asserted in the companion test below).
test("FAFF-553: ALL members silent past the window, run-elapsed under the ceiling -> run-scoped trip capped at pause (in-flight grace)", () => {
  const dir = tmp();
  try {
    const fixtureStart = "2026-07-01T00:00:00Z";
    const startMs = Date.parse(fixtureStart);
    const nowMs = startMs + (STALL_WINDOW_SECS_DEFAULT + 120) * 1000; // elapsed 1020s << 14400s ceiling
    const ledger = {
      run_id: "r", admitted: ["X", "Y"], outcomes: {},
      owner: { status: "running", started_at: fixtureStart, last_heartbeat: fixtureStart }, // stale run file too
    };
    const rd = mkRun(dir, "r", ledger, [
      { schema: 1, run_id: "r", seq: 0, ts: fixtureStart, phase: "build", type: "build-start", issue: "X" },
      { schema: 1, run_id: "r", seq: 1, ts: fixtureStart, phase: "build", type: "build-start", issue: "Y" },
    ]);
    writeMemberBeat(rd, "X", fixtureStart);
    writeMemberBeat(rd, "Y", fixtureStart);

    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(nowMs)]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.intervention, "pause", "in-flight members soften the run-scoped staleness trip to pause");
    assert.equal(out.tripped, true, "the verdict still TRIPS — only the contributed intervention is capped");
    const rs = out.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
    assert.ok(rs, "a run-scoped (no scope field) wall-clock-runaway verdict is present");
    assert.equal(rs.evidence.tripped_on, "heartbeat-staleness");
    assert.deepEqual(rs.evidence.in_flight.sort(), ["X", "Y"], "evidence names the in-flight members");
    assert.equal(rs.evidence.grace, "in-flight-unit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-553: run-elapsed over the ceiling -> abort regardless of in-flight members (the grace never survives the elapsed backstop)", () => {
  const dir = tmp();
  try {
    const startMs = Date.parse("2026-07-01T00:00:00Z");
    const fixtureStart = new Date(startMs).toISOString();
    const nowMs = startMs + (RUN_ELAPSED_CEILING_SECS_DEFAULT + 60) * 1000; // elapsed over the 14400s ceiling
    const ledger = {
      run_id: "r", admitted: ["X"], outcomes: {},
      owner: { status: "running", started_at: fixtureStart, last_heartbeat: fixtureStart }, // stale AND over-ceiling
    };
    const rd = mkRun(dir, "r", ledger, [
      { schema: 1, run_id: "r", seq: 0, ts: fixtureStart, phase: "build", type: "build-start", issue: "X" },
    ]);
    writeMemberBeat(rd, "X", fixtureStart);

    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(nowMs)]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.intervention, "abort", "the elapsed-ceiling backstop is unchanged — no grace past it");
    const rs = out.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
    assert.ok(rs && rs.evidence.grace === undefined, "no grace annotation on an over-ceiling run");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-327: no member heartbeat files and no build-start events (sequential/legacy) -> payload byte-equivalent to the pre-327 surface", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["A"], outcomes: { A: "shipped" },
      owner: { status: "running", started_at: "2026-07-01T00:00:00Z", last_heartbeat: "2026-07-01T00:00:05Z" },
    };
    const rd = mkRun(dir, "r", ledger); // no events.jsonl at all
    const r = run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(Date.parse("2026-07-01T00:00:10Z"))]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.deepEqual(out.verdicts, []);
    assert.equal(out.intervention, "continue");
    assert.equal(out.tripped, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-327: `faff heartbeat <dir> --unit X` leaves run-ledger.json byte-identical (the FAFF-355 invariant extended to the member tick), and writes both files", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["X"], outcomes: {},
      owner: { status: "running", started_at: "2026-07-01T00:00:00Z", last_heartbeat: "2026-07-01T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    const before = readFileSync(join(rd, "run-ledger.json"), "utf8");
    const r = run(dir, ["heartbeat", rd, "--unit", "X", "--json"]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.written, true);
    assert.equal(out.unit, "X");
    assert.equal(readFileSync(join(rd, "run-ledger.json"), "utf8"), before, "run-ledger.json byte-identical after a --unit tick");
    assert.ok(existsSync(join(rd, "heartbeat")), "the run heartbeat file was written");
    assert.ok(existsSync(join(rd, "heartbeat.X")), "the member heartbeat file was written");
    assert.equal(readFileSync(join(rd, "heartbeat.X"), "utf8").trim(), out.last_heartbeat);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-327: `faff heartbeat` WITHOUT --unit is unchanged from post-FAFF-355 main — no member file, no unit key surprise", () => {
  const dir = tmp();
  try {
    const ledger = {
      run_id: "r", admitted: ["X"], outcomes: {},
      owner: { status: "running", started_at: "2026-07-01T00:00:00Z", last_heartbeat: "2026-07-01T00:00:00Z" },
    };
    const rd = mkRun(dir, "r", ledger);
    const r = run(dir, ["heartbeat", rd, "--json"]);
    assert.equal(r.code, 0, r.err);
    const out = JSON.parse(r.out);
    assert.equal(out.written, true);
    assert.equal(out.unit, null, "unit is null when --unit was never passed");
    assert.ok(existsSync(join(rd, "heartbeat")));
    // No stray member file (a member file is always "heartbeat.<issue>", dot-suffixed —
    // distinct from the bare run-level "heartbeat" file asserted above).
    assert.deepEqual(readdirSync(rd).filter((n) => n.startsWith("heartbeat.")), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FAFF-327/FAFF-553 integration smoke test: mint, tick one member, park the other, then all-stale -> pause (in-flight grace), then no-in-flight -> abort; run-ledger.json bytes unchanged throughout", () => {
  const dir = tmp();
  try {
    // `faff heartbeat --unit` has no clock seam (it always ticks real wall-clock time,
    // by design — FAFF-355), so this fixture pins the CHECK's virtual "now" a few
    // seconds ahead of actual real time instead of pinning a historical date: X's
    // real tick (moments before the check) reads as fresh relative to that virtual
    // now, while Y's explicitly-written stale mark reads as stale — deterministic
    // without depending on wall-clock time OF DAY (the FAFF-301 property), since the
    // offsets are all relative to `checkNowMs`, computed once.
    const checkNowMs = Date.now() + 5_000;
    const staleIso = new Date(checkNowMs - (STALL_WINDOW_SECS_DEFAULT + 60) * 1000).toISOString();
    const ledger = {
      run_id: "r", admitted: ["X", "Y"], outcomes: {},
      owner: { status: "running", started_at: staleIso, last_heartbeat: staleIso },
    };
    const rd = mkRun(dir, "r", ledger, [
      { schema: 1, run_id: "r", seq: 0, ts: staleIso, phase: "build", type: "build-start", issue: "X" },
      { schema: 1, run_id: "r", seq: 1, ts: staleIso, phase: "build", type: "build-start", issue: "Y" },
    ]);
    const ledgerSnapshot = readFileSync(join(rd, "run-ledger.json"), "utf8");

    // 1+2: tick X (real time — also refreshes the run-level file, per --unit's
    // shape); Y's member file is written stale directly (a member that never ticks).
    const t1 = run(dir, ["heartbeat", rd, "--unit", "X", "--json"]);
    assert.equal(t1.code, 0);
    writeMemberBeat(rd, "Y", staleIso);
    assert.equal(readFileSync(join(rd, "run-ledger.json"), "utf8"), ledgerSnapshot, "ledger unchanged after the tick");

    // 3: check at the pinned virtual now — the RUN file (freshly ticked moments ago,
    // real time) is fresh; Y is stale.
    const r3 = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(checkNowMs)]).out);
    assert.equal(r3.intervention, "pause");
    assert.ok(r3.verdicts.some((v) => v.scope === "member" && v.member === "Y"));
    assert.ok(!r3.verdicts.some((v) => v.scope === "member" && v.member === "X"), "X ticked recently — no member verdict for it");
    assert.equal(readFileSync(join(rd, "run-ledger.json"), "utf8"), ledgerSnapshot, "ledger unchanged after the check");

    // 4: overwrite X's member file AND the run-level heartbeat file both stale
    // (simulate nobody ticking anything further) -> the RUN-scoped predicate trips.
    // FAFF-553: X and Y are still IN FLIGHT (build-start, no terminal outcome) and
    // run-elapsed is under the ceiling, so the run-scoped staleness trip is capped
    // at "pause" (in-flight grace) — the verdict still trips, evidence names both.
    writeMemberBeat(rd, "X", staleIso);
    writeFileSync(join(rd, "heartbeat"), staleIso + "\n");
    const r4 = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(checkNowMs)]).out);
    assert.equal(r4.intervention, "pause", "in-flight members grace the run-scoped staleness trip to pause");
    const r4rs = r4.verdicts.find((v) => v.signal === "wall-clock-runaway" && v.scope === undefined);
    assert.ok(r4rs, "run-scoped trip fired");
    assert.deepEqual(r4rs.evidence.in_flight.sort(), ["X", "Y"]);
    assert.equal(r4rs.evidence.grace, "in-flight-unit");

    // 5 (spec smoke test step 5): remove the build-start events -> no in-flight
    // member -> the same staleness now maps to "abort", unchanged from pre-553.
    writeFileSync(join(rd, "events.jsonl"), "");
    const r5 = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", String(checkNowMs)]).out);
    assert.equal(r5.intervention, "abort", "no in-flight member -> staleness aborts exactly as before");

    // 6: run-ledger.json bytes unchanged throughout; no file beyond the two member
    // files + the run heartbeat file was ever created.
    assert.equal(readFileSync(join(rd, "run-ledger.json"), "utf8"), ledgerSnapshot, "ledger unchanged after the checks");
    assert.deepEqual(readdirSync(rd).sort(), ["events.jsonl", "heartbeat", "heartbeat.X", "heartbeat.Y", "run-ledger.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// FAFF-717 — sentryActingFromConfig resolves the L3 Sentry-abort opt-in FAIL-CLOSED
// from a REALLY-parsed config (the same parseYamlSubset the runtime uses), and
// actsOnSentryAbort is the single abort-acting resolver: L4 always acts (LAZILY,
// without reading config), a non-L4 run acts iff the knob is a literal `true`.
const rc = (s) => parseYamlSubset(s);

test("sentryActingFromConfig: bare `true` enables (boolean, the documented form)", () => {
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: true\n")), true);
});
test("sentryActingFromConfig: QUOTED `\"true\"` enables too (the YAML-quoting trap)", () => {
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: \"true\"\n")), true);
});
test("sentryActingFromConfig: `True` (case variant) enables", () => {
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: True\n")), true);
});
test("sentryActingFromConfig is FAIL-CLOSED on every non-affirmative (false/\"false\"/yes/1/typo/unset)", () => {
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: false\n")), false);
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: \"false\"\n")), false);
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: yes\n")), false);
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: 1\n")), false);
  assert.equal(sentryActingFromConfig(rc("autonomous:\n  sentry_acting: ture\n")), false); // a typo must never enable
  assert.equal(sentryActingFromConfig(rc("autonomous: {}\n")), false); // key unset
  assert.equal(sentryActingFromConfig({}), false); // empty config (a fault fails safe here)
});

test("actsOnSentryAbort: an L4 ledger always acts, and does so LAZILY — a config fault can't regress it", () => {
  // A config that would THROW if dug into still leaves L4 acting, because the `||`
  // short-circuits on level before sentryActingFromConfig is consulted.
  assert.equal(actsOnSentryAbort({ level: "L4" }, {}), true);
  assert.equal(actsOnSentryAbort({ level: "L4" }, rc("autonomous:\n  sentry_acting: false\n")), true);
});
test("actsOnSentryAbort: a non-L4 (L3) run acts IFF the knob is set — the FAFF-717 opt-in", () => {
  assert.equal(actsOnSentryAbort({ level: "L3" }, rc("autonomous:\n  sentry_acting: true\n")), true);
  assert.equal(actsOnSentryAbort({ level: "L3" }, rc("autonomous:\n  sentry_acting: false\n")), false);
  assert.equal(actsOnSentryAbort({ level: "L3" }, {}), false); // L3, no knob → advisory (unchanged default)
});
test("actsOnSentryAbort: a null/level-less ledger falls back to the config knob (never throws)", () => {
  assert.equal(actsOnSentryAbort(null, rc("autonomous:\n  sentry_acting: true\n")), true);
  assert.equal(actsOnSentryAbort(null, {}), false);
  assert.equal(actsOnSentryAbort({}, {}), false); // absent level ⇒ non-acting unless the knob is set
});
