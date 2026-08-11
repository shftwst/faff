// ===========================================================================
// === region:factory — run-ledger — FAFF-761: the standalone-interactive L2 mint. ===
//
// `faff run-ledger init-interactive` is the L2 SIBLING of `faff lights-out`'s L4
// `mintLightsOut` (lights-out.js ~899): it creates a fresh interactive run dir with a
// minimal, HONEST `run-ledger.json` (level "L2") + a genesis `events.jsonl` chain, so a
// directly-invoked `/faff-graft` (no beep-boop orchestrator above it) has the SAME anchor
// substrate `faff events anchor` (Step 9b) already knows how to byte-copy — and
// `faff merge-gate`'s fail-closed anchor floor is satisfied HONESTLY, never weakened.
//
// Load-bearing invariants (the merge-floor trust machinery — do not soften):
//   * level is the CONSTANT "L2", written UNCONDITIONALLY. There is NO flag that
//     sets/raises/lowers it (exactly as mintLightsOut hardcodes "L4"). The anchored
//     `level` is the merge-gate ceiling (FAFF-690) — never operator-settable at mint.
//   * every chain hash (the genesis `prev`, each link, the anchor's chain-head.json
//     witness) is CLI-computed inside appendRecordUnderLock / computeChainHead — the
//     caller never supplies a hash. Because the run dir's basename IS the run_id, the
//     genesis `prev` = SHA-256(run_id), so the chain still verifies after `events anchor`
//     relocates it under `.faff/anchors/<run-id>/<issue>/` (FAFF-568 verifier rule).
//   * CLI-LEVEL trust guard (defense-in-depth, infosec): the mint REFUSES (exit 3) +
//     emits a refusal observe when FAFF_RUN_DIR (or --root's newest run dir) already
//     resolves a LIVE run at a level ABOVE L2 (L3/L4, owner.status:"running") — an
//     interactive L2 mint must never silently downgrade a live higher-level run. The
//     boundary is enforced HERE in the deterministic CLI, not only in swappable graft
//     prose. It grants no new capability; it only forecloses the one concrete downgrade a
//     stray/duplicate invocation could cause, and it never authenticates the caller.
// ===========================================================================

"use strict";

const fs = require("fs");
const path = require("path");

const { parseArgs, usageError } = require("./argv");
const { findRoot, latestRunDir } = require("./shared-infra");
const { mutateLedgerUnderLock } = require("./heartbeat");
const { appendRecordUnderLock, appendEventRecord, computeChainHead, verifyChain, verifyExitCode, EVENT_LEDGER_OUTCOMES } = require("./events");

// The one level this verb ever writes — a FLOOR_LEVELS member (contract-defs.js), read by
// merge-gate's resolveAnchorLevel. A CONSTANT, never flag-derived (see the module header).
const INTERACTIVE_LEVEL = "L2";
// Levels ABOVE L2 that the guard refuses to silently downgrade when live.
const HIGHER_LEVELS = new Set(["L3", "L4"]);
// The bare-issue-id shape merge-gate.js / `events anchor` --issue already enforce (a shared
// floor, never a forked rule): reject anything that could walk a path outside the run dir.
const ISSUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// PURE — the minimal honest L2 ledger object. Single-sourced here so the shape, the `level`
// constant, and the empty `outcomes` (the terminal is NOT yet known at mint — §4 sequencing)
// are testable and cannot drift into graft prose. Mirrors the beep-boop/lights-out ledger
// keys `runcheck` + the Stop hook already read (admitted/outcomes/owner/budget), so no reader
// needs a new shape and resolveAnchorLevel reads only `level`.
function buildInteractiveLedger({ runId, issue, nowIso, sessionId, pid }) {
  return {
    run_id: runId,
    level: INTERACTIVE_LEVEL, // CONSTANT — never operator-settable
    admitted: [issue], // exactly the one issue this graft builds
    outcomes: {}, // EMPTY at mint — written only at the genuine terminal (graft step 6)
    budget: { envelope: { ceilings: {}, at_ceiling: "stop" } }, // minimal honest shape; no L4 governor
    owner: {
      status: "running", // → "done" at the graft terminal
      session_id: sessionId || runId,
      pid,
      started_at: nowIso,
      last_heartbeat: nowIso,
    },
  };
}

// PURE — the honest terminal-outcome edit (§4 step 6): records `outcomes[issue]` = the
// terminal-state string and flips `owner.status` to "done" (clearing runcheck completeness).
// Single-sourced here so the terminal shape is testable and graft prose never hand-edits the
// ledger (the anti-pattern the spec forbids). Mutates a copy-in-place object under the lock.
function applyTerminalOutcome(ledger, issue, outcome, nowIso) {
  if (!ledger || typeof ledger !== "object") return ledger;
  ledger.outcomes = (ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  ledger.outcomes[issue] = outcome;
  ledger.owner = (ledger.owner && typeof ledger.owner === "object") ? ledger.owner : {};
  ledger.owner.status = "done";
  ledger.owner.last_heartbeat = nowIso;
  return ledger;
}

// PURE — the guard predicate: does this ledger describe a LIVE run at a level ABOVE L2?
// Fail-safe: a null/shapeless/level-absent ledger is NOT a live higher-level run (never
// blocks a legitimate mint on a malformed foreign ledger).
function isLiveHigherLevel(ledger) {
  return !!(
    ledger &&
    typeof ledger === "object" &&
    HIGHER_LEVELS.has(ledger.level) &&
    ledger.owner &&
    typeof ledger.owner === "object" &&
    ledger.owner.status === "running"
  );
}

// Resolve the run dir the guard inspects: an explicit FAFF_RUN_DIR carrying a run-ledger.json
// takes precedence (the dispatch/orchestrator-supplied dir); otherwise the newest run dir under
// root (latestRunDir only ever returns a dir already carrying run-ledger.json). Returns null
// when neither resolves — the common interactive case (graft only mints when FAFF_RUN_DIR is
// unset), so the guard is inert on a clean standalone graft.
function guardCandidateDir(root, env) {
  const explicit = env && typeof env.FAFF_RUN_DIR === "string" ? env.FAFF_RUN_DIR : "";
  if (explicit) {
    return fs.existsSync(path.join(explicit, "run-ledger.json")) ? explicit : null;
  }
  return latestRunDir(root);
}

// Read a run dir's ledger, tolerating any read/parse fault (a foreign/malformed ledger must
// never crash the mint — it simply isn't a live-higher-level run for the guard's purposes).
function readLedgerSafe(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "run-ledger.json"), "utf8"));
  } catch {
    return null;
  }
}

// Derive the UTC run stamp — the SAME derivation mintLightsOut uses (lights-out.js:907).
function utcStamp(nowIso) {
  return nowIso.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-"); // YYYYMMDD-HHMMSS
}

const RUN_LEDGER_SPEC = {
  flags: {
    "--issue": { arity: 1 },
    "--outcome": { arity: 1, enum: [...EVENT_LEDGER_OUTCOMES] },
    "--root": { arity: 1 },
    "--run-dir": { arity: 1 },
    "--id": { arity: 1 },
    "--json": { arity: 0 },
    "--selftest": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "subcommand" },
};

// The declared CLI grammar (FAFF-628). NB: there is deliberately NO --level flag; level is
// the CONSTANT above. `record-outcome` is the honest terminal write on the interactive-minted
// LIVE ledger (post-anchor) — the committed anchor is an immutable pre-merge snapshot.
const RUN_LEDGER_SURFACE = {
  kind: "subcommand_dispatch",
  spec: RUN_LEDGER_SPEC,
  subcommands: {
    "init-interactive": { required_flags: ["--issue"] },
    "record-outcome": { required_flags: ["--issue", "--outcome"] },
  },
};

const USAGE = "usage: faff run-ledger <init-interactive --issue <ISSUE-ID> [--root DIR] [--id RUN-ID] | record-outcome --issue <ISSUE-ID> --outcome <TERMINAL> [--run-dir DIR]> [--json] [--selftest]";

function cmdRunLedger(args) {
  if (args.includes("--selftest")) return runLedgerSelftest();
  const { values, positionals, errors } = parseArgs(args, RUN_LEDGER_SPEC);
  if (errors.length) return usageError(errors, USAGE);

  const sub = positionals[0];
  if (sub === "init-interactive") return initInteractive(values);
  if (sub === "record-outcome") return recordOutcome(values);
  process.stderr.write(`faff run-ledger: expected subcommand 'init-interactive' | 'record-outcome'${sub ? ` (got ${JSON.stringify(sub)})` : ""}\n${USAGE}\n`);
  return 2;
}

function initInteractive(values) {
  const issue = values["--issue"];
  if (!issue) {
    process.stderr.write(`faff run-ledger init-interactive: --issue is required\n${USAGE}\n`);
    return 2;
  }
  // Bad --issue → exit 2, mint NOTHING (no partial dir). Same shape check as `events anchor`.
  if (!ISSUE_ID_RE.test(issue) || issue.includes("..")) {
    process.stderr.write(`faff run-ledger init-interactive: --issue ${JSON.stringify(issue)} is not a valid issue id\n`);
    return 2;
  }

  const root = values["--root"] || findRoot();

  // CLI-LEVEL trust guard (defense-in-depth): refuse (exit 3) + observe when a LIVE L3/L4 run
  // is already resolved — never silently downgrade it to an L2 mint. Runs BEFORE any dir is
  // created, so a refusal mints no partial dir.
  const candidate = guardCandidateDir(root, process.env);
  if (candidate) {
    const liveLedger = readLedgerSafe(candidate);
    if (isLiveHigherLevel(liveLedger)) {
      // Best-effort refusal observe onto the LIVE run's own timeline — this attempted-then-
      // refused L2 mint is a legitimate part of that run's history. A `sentry-trip` is the
      // honest event type for a guard that fired. Never let an emit fault change the exit-3
      // refusal (the refusal is the load-bearing behaviour; the observe is the record of it).
      try {
        appendRecordUnderLock(candidate, (seq, _prev, prevHash) => ({
          schema: 2,
          run_id: liveLedger.run_id || path.basename(candidate),
          seq,
          ts: new Date().toISOString(),
          prev: prevHash,
          phase: "run",
          type: "sentry-trip",
          data: {
            guard: "run-ledger-init-interactive-downgrade-refused",
            live_level: liveLedger.level,
            attempted_issue: issue,
          },
        }));
      } catch { /* observe is best-effort; the refusal below is unconditional */ }
      process.stderr.write(
        `faff run-ledger init-interactive: refusing — a live ${liveLedger.level} run (${liveLedger.run_id || path.basename(candidate)}) is already resolved; ` +
        `an L2 interactive mint must not downgrade a live higher-level run\n`
      );
      return 3;
    }
  }

  // MINT — mirror mintLightsOut's tail (create run dir, write ledger under lock, emit genesis).
  const nowIso = new Date().toISOString();
  const runId = values["--id"] || `run-${utcStamp(nowIso)}-graft-${issue}`;
  const runDir = path.join(root, ".faff", "runs", runId);
  // The run dir's basename IS the run_id — load-bearing for the genesis `prev` = SHA-256(run_id).
  fs.mkdirSync(runDir, { recursive: true });

  const ledger = buildInteractiveLedger({
    runId,
    issue,
    nowIso,
    sessionId: process.env.FAFF_SESSION_ID || null,
    pid: process.pid,
  });
  // Route through the SAME locked core every ledger write uses (uniformity; a just-minted
  // dir cannot contend). The trivial mutate ignores the fresh read (initial creation).
  const mintWriteRes = mutateLedgerUnderLock(runDir, () => ledger);

  // Emit the genesis run-start onto the events chain — the caller supplies only the payload;
  // the seq (0) and `prev` (SHA-256(run_id), for the empty log) are minted by the locked core.
  appendRecordUnderLock(runDir, (seq, _prevRecord, prevHash) => ({
    schema: 2,
    run_id: runId,
    seq,
    ts: nowIso,
    prev: prevHash,
    phase: "run",
    type: "run-start",
  }));

  if (values["--json"]) {
    process.stdout.write(
      JSON.stringify({
        proceed: true,
        level: INTERACTIVE_LEVEL,
        run_id: runId,
        run_dir: runDir,
        ledger_sha256_before: mintWriteRes.before_sha256, // always null on a mint
        ledger_sha256_after: mintWriteRes.after_sha256,
      }) + "\n"
    );
  } else {
    // The bare-mode stdout is JUST the absolute run dir path — so the caller can
    // `export FAFF_RUN_DIR="$(faff run-ledger init-interactive --issue …)"`.
    process.stdout.write(runDir + "\n");
  }
  return 0;
}

// `record-outcome` — the honest terminal write (§4 step 6) on the interactive-minted LIVE
// ledger, run at the graft terminal AFTER Step 9b already committed the immutable anchor (so
// the anchor stays a pre-merge `outcomes:{}` snapshot; this write lands only on the live dir).
// Sets outcomes[issue] + owner.status:"done" under the lock (which also folds a ledger-write
// event — belt-and-braces chain honesty) and, on the shipped path, appends an issue-outcome
// close event. Fail-closed: an absent/invalid run dir → exit 3; a bad --issue/--outcome → 2.
function recordOutcome(values) {
  const issue = values["--issue"];
  const outcome = values["--outcome"];
  if (!issue || (!ISSUE_ID_RE.test(issue) || issue.includes(".."))) {
    process.stderr.write(`faff run-ledger record-outcome: --issue ${JSON.stringify(issue)} is not a valid issue id\n`);
    return 2;
  }
  // --outcome is enum-guarded by parseArgs (a member of EVENT_LEDGER_OUTCOMES); belt here.
  if (!outcome || !EVENT_LEDGER_OUTCOMES.has(outcome)) {
    process.stderr.write(`faff run-ledger record-outcome: --outcome ${JSON.stringify(outcome)} is not a terminal-state string\n`);
    return 2;
  }
  const root = values["--root"] || findRoot();
  // Resolve the LIVE run dir: explicit --run-dir > FAFF_RUN_DIR > newest run dir under root.
  const runDir = values["--run-dir"] || process.env.FAFF_RUN_DIR || latestRunDir(root);
  if (!runDir || !fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    process.stderr.write(`faff run-ledger record-outcome: no run dir with run-ledger.json resolved (${runDir || "none"}) — pass --run-dir or set FAFF_RUN_DIR\n`);
    return 3;
  }
  const nowIso = new Date().toISOString();
  let runId = path.basename(runDir);
  const res = mutateLedgerUnderLock(runDir, (fresh) => {
    if (!fresh || typeof fresh !== "object") return null; // vanished/malformed → abort (no write)
    if (typeof fresh.run_id === "string") runId = fresh.run_id;
    return applyTerminalOutcome(fresh, issue, outcome, nowIso);
  });
  if (!res.written) {
    process.stderr.write(`faff run-ledger record-outcome: could not write ${path.join(runDir, "run-ledger.json")} (missing/locked/malformed)\n`);
    return 3;
  }
  // On the shipped path, append the issue-outcome close event (CLI-computed hash). Best-effort:
  // a chain-append fault never unwinds the durable ledger write above (surfaced, not fatal).
  if (outcome === "shipped") {
    try {
      appendEventRecord(runDir, runId, { phase: "build", type: "issue-outcome", issue, data: { outcome } }, nowIso);
    } catch (e) {
      process.stderr.write(`faff run-ledger record-outcome: issue-outcome close event append failed in ${runDir}: ${e && e.message} — the ledger IS written\n`);
    }
  }
  if (values["--json"]) {
    process.stdout.write(JSON.stringify({ recorded: true, run_id: runId, run_dir: runDir, issue, outcome, owner_status: "done", ledger_sha256_before: res.before_sha256, ledger_sha256_after: res.after_sha256 }) + "\n");
  } else {
    process.stdout.write(`recorded ${issue}=${outcome} (owner done) in ${runDir}\n`);
  }
  return 0;
}

// In-memory selftest (mirrors lights-out/events): mints into an ephemeral tmp dir and asserts
// the pure ledger shape + the genesis chain verifies. Fail-closed per-case ok/FAIL + RESULT.
function runLedgerSelftest() {
  const os = require("os");
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // --- pure shape assertions over buildInteractiveLedger (no fs) ---
  const nowIso = "2026-08-11T00:00:00.000Z";
  const led = buildInteractiveLedger({ runId: "run-20260811-000000-graft-TEST-1", issue: "TEST-1", nowIso, sessionId: null, pid: 4242 });
  ok("ledger level is the constant L2", led.level === "L2");
  ok("ledger admitted is exactly [issue]", Array.isArray(led.admitted) && led.admitted.length === 1 && led.admitted[0] === "TEST-1");
  ok("ledger outcomes is EMPTY at mint", led.outcomes && typeof led.outcomes === "object" && Object.keys(led.outcomes).length === 0);
  ok("ledger owner is running with the mint fields", led.owner && led.owner.status === "running" && led.owner.pid === 4242 && led.owner.started_at === nowIso && led.owner.last_heartbeat === nowIso);
  ok("ledger owner.session_id falls back to run_id when session unset", led.owner.session_id === "run-20260811-000000-graft-TEST-1");
  ok("ledger carries a minimal honest budget.envelope", led.budget && led.budget.envelope && typeof led.budget.envelope.ceilings === "object" && led.budget.envelope.at_ceiling === "stop");

  // --- guard predicate ---
  ok("guard trips on a live L3 run", isLiveHigherLevel({ level: "L3", owner: { status: "running" } }) === true);
  ok("guard trips on a live L4 run", isLiveHigherLevel({ level: "L4", owner: { status: "running" } }) === true);
  ok("guard does NOT trip on a DONE higher-level run", isLiveHigherLevel({ level: "L4", owner: { status: "done" } }) === false);
  ok("guard does NOT trip on an L2 run", isLiveHigherLevel({ level: "L2", owner: { status: "running" } }) === false);
  ok("guard fail-safe: null/level-absent ledger never trips", isLiveHigherLevel(null) === false && isLiveHigherLevel({ owner: { status: "running" } }) === false);

  // --- terminal-outcome edit (§4 step 6) ---
  const term = applyTerminalOutcome(buildInteractiveLedger({ runId: "r", issue: "TEST-1", nowIso, sessionId: null, pid: 1 }), "TEST-1", "shipped", "2026-08-11T01:00:00.000Z");
  ok("terminal write records outcomes[issue]", term.outcomes["TEST-1"] === "shipped");
  ok("terminal write flips owner.status to done", term.owner.status === "done" && term.owner.last_heartbeat === "2026-08-11T01:00:00.000Z");
  ok("terminal write keeps admitted intact (completeness: admitted ⊆ outcomes.keys)", term.admitted.every((i) => i in term.outcomes));
  const parkedTerm = applyTerminalOutcome({ admitted: ["X"], outcomes: {}, owner: { status: "running" } }, "X", "parked", nowIso);
  ok("terminal write works for a non-shipped terminal (parked)", parkedTerm.outcomes["X"] === "parked" && parkedTerm.owner.status === "done");

  // --- real mint into a tmp dir → genesis chain verifies (basename==run_id ⇒ prev=SHA256(run_id)) ---
  let tmp = null;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "faff-run-ledger-selftest-"));
    const runId = "run-20260811-000000-graft-TEST-1";
    const runDir = path.join(tmp, ".faff", "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    mutateLedgerUnderLock(runDir, () => buildInteractiveLedger({ runId, issue: "TEST-1", nowIso, sessionId: null, pid: process.pid }));
    appendRecordUnderLock(runDir, (seq, _p, prevHash) => ({ schema: 2, run_id: runId, seq, ts: nowIso, prev: prevHash, phase: "run", type: "run-start" }));
    const persisted = JSON.parse(fs.readFileSync(path.join(runDir, "run-ledger.json"), "utf8"));
    ok("persisted ledger round-trips level L2", persisted.level === "L2");
    const lines = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const genesis = lines[0];
    // The physical seq-0 record is the `ledger-write` the ledger fold emits (FAFF-564) —
    // identical to mintLightsOut. The load-bearing genesis invariant is prev == SHA-256(run_id)
    // (why the chain still verifies after `events anchor` relocates the dir), asserted here.
    const runIdHash = require("crypto").createHash("sha256").update(Buffer.from(runId, "utf8")).digest("hex");
    ok("genesis seq is 0 and schema 2", genesis.seq === 0 && genesis.schema === 2 && genesis.phase === "run");
    ok("genesis prev == SHA-256(run_id) (survives anchor relocation)", genesis.prev === runIdHash);
    ok("a run-start event is present in the genesis chain", lines.some((r) => r.type === "run-start"));
    const verify = verifyChain(runDir);
    ok("genesis chain verifies (faff events verify → verified)", verifyExitCode(verify, "fail") === 0);
  } catch (e) {
    ok(`real mint selftest threw: ${e && e.message}`, false);
  } finally {
    if (tmp) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  INTERACTIVE_LEVEL,
  RUN_LEDGER_SURFACE,
  buildInteractiveLedger,
  applyTerminalOutcome,
  isLiveHigherLevel,
  guardCandidateDir,
  cmdRunLedger,
  runLedgerSelftest,
};
