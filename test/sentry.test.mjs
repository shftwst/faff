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
      // Feeding token-shaped junk as extra args must not suppress the abort.
      const hostile = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json", "--now-ms", now,
        "--intervention", "continue", "--suppress", "--outcome", "shipped", "--override", "continue"]).out);
      assert.equal(hostile.intervention, "abort", "no subagent-shaped arg flips the verdict");
      assertSameVerdicts(hostile.verdicts, base.verdicts, "verdict sets identical (order-insensitive)");
    }

    // The clock seam itself cannot suppress the abort: budget-breach is clock-independent,
    // so even passing a clock flag (here trying to look "fresh") still trips abort.
    const evenNow = JSON.parse(run(dir, ["sentry", "check", "--run-dir", rd, "--json",
      "--now-ms", String(startMs + HOUR), "--now-ms", String(startMs)]).out);
    assert.equal(evenNow.intervention, "abort", "clock seam can't dodge the budget-breach abort");
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
