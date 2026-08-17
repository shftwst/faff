// ===========================================================================
// === region:factory — reconcile-recover — FAFF-797: the auto-close half of the ===
// FAFF-782 merged-but-unclosed seam. `faff disposition` (pure/read-only, ADR-0056)
// DETECTS a merged-unclosed run — an admitted issue absent from `outcomes` whose
// `merge-record.json` proves `merged:true` (the harness killed the orchestrator
// after a durable merge, before the ledger close). This verb is the distinct,
// `faff reconcile`-adjacent RECOVERY write that closes it to `shipped`, holding a
// narrowly-scoped exception to "only the run's own agents write owner.status"
// (ADR-0008/0015 lineage) — the third such exception, sibling to ADR-0057 (graft's
// claim-holder self-release) and ADR-0098 (stale-claim reclaim). See
// records/adr/0115-*.md for the full scope: actor (this verb only), operation
// (running->done + outcomes:absent->shipped only), precondition (verifiably-merged
// AND verifiably-stale AND unclosed), pairing (never a bare write — always gated on
// a fresh post-merge-check returning verified-ok; a red or absent verdict blocks).
//
// A THIN COMPOSITION over shipped primitives — no new detection/liveness/gate/write
// logic. detect (read-only) -> gate (post-merge-check) -> write (record-outcome) ->
// report:
//   - merge evidence:  readMergedMap / readMergedDetails (disposition.js, reused verbatim)
//   - liveness:        runIsHeld (runcheck.js) against the overlayHeartbeat-effective
//                       instant (heartbeat.js) — the SAME "is it live?" signal runcheck's
//                       Stop hook trusts; no second liveness rule.
//   - the gate:         verifyPostMerge (post-merge.js) — verified-ok admits, anything
//                       else (verified-fail | unverified) BLOCKS.
//   - the write:        delegated to the existing, single tested ledger-close writer —
//                       `faff run-ledger record-outcome`, invoked as a subprocess (the
//                       same self-invocation pattern sentry.js/sentrycheck.js/events.js
//                       already use) rather than a second, forked writer.
//
// `faff disposition` and `faff reconcile` stay pure/read-only — this file is the ONLY
// place that writes a merged-unclosed ledger's outcome to `shipped`.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseArgs, usageError } = require("./argv");
const { readMergedMap, readMergedDetails } = require("./disposition");
const { runIsHeld } = require("./runcheck");
const { overlayHeartbeat, readHeartbeatFile, isValidIssueId } = require("./heartbeat");
const { verifyPostMerge } = require("./post-merge");
const { findRoot, readLedger, ENTRYPOINT } = require("./shared-infra");

const LEVELS = ["L1", "L2", "L3", "L4"];
const ADMISSIONS = ["recoverable", "not-merged", "not-unclosed", "live"];

// ---------------------------------------------------------------------------
// PURE — the admission predicate (FAFF-797 spec §3). No filesystem I/O; testable in
// isolation, selftest-driven across every branch. `merged`/`held` are pre-computed by
// the impure shell (readMergedMap / runIsHeld against the overlay-effective heartbeat)
// so this stays a pure function over already-gathered evidence, mirroring reconcile.js's
// pure-core-behind-a-thin-shell split.
// ---------------------------------------------------------------------------
function admitRecovery({ ledger, issue, merged, held }) {
  if (merged !== true) return "not-merged";
  const admitted = Array.isArray(ledger && ledger.admitted) ? ledger.admitted : [];
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  if (!admitted.includes(issue) || Object.prototype.hasOwnProperty.call(outcomes, issue)) return "not-unclosed";
  if (held === true) return "live";
  return "recoverable";
}

// PURE — the predicate breakdown surfaced on every result (`{merged, unclosed,
// verifiably_stale}`), independent of the single-token admission above so a reader
// can see WHICH condition(s) failed, not just the folded verdict.
function recoveryPredicate({ ledger, issue, merged, held }) {
  const admitted = Array.isArray(ledger && ledger.admitted) ? ledger.admitted : [];
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  const unclosed = admitted.includes(issue) && !Object.prototype.hasOwnProperty.call(outcomes, issue);
  return { merged: merged === true, unclosed, verifiably_stale: held !== true };
}

// Is this the "already closed" sub-case of not-unclosed (idempotent-clean, exit 0),
// as opposed to "never admitted to this run at all" (fail-safe no-op, exit 3)? The
// pure admission core folds both under "not-unclosed" (spec §3); the shell decides the
// exit code from this finer read, per §8 DONE: "not-unclosed (already closed) is an
// idempotent exit 0" — the ONLY not-unclosed sub-case that is not a plain fail-safe no-op.
function isAlreadyClosed(ledger, issue) {
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  return Object.prototype.hasOwnProperty.call(outcomes, issue);
}

// ---------------------------------------------------------------------------
// The write — delegated to `faff run-ledger record-outcome` as a subprocess (never a
// second, forked writer). Mirrors the ENTRYPOINT self-invocation pattern already used
// by sentry.js/sentrycheck.js/events.js (spawnSync(process.execPath, [ENTRYPOINT, ...])).
// Returns { written, run_id } — a write failure (non-zero exit from the child) is
// surfaced by the caller as a distinct fault, never silently coerced into any of the
// admission/gate outcomes.
// ---------------------------------------------------------------------------
function writeRecovery(runDir, issue) {
  const r = spawnSync(process.execPath, [
    ENTRYPOINT, "run-ledger", "record-outcome",
    "--issue", issue, "--outcome", "shipped", "--run-dir", runDir, "--json",
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    return { written: false, detail: ((r.stderr || "") + (r.stdout || "")).trim().slice(-500) };
  }
  let runId = null;
  try { runId = JSON.parse(r.stdout).run_id ?? null; } catch { /* best-effort only */ }
  return { written: true, run_id: runId };
}

// ---------------------------------------------------------------------------
// The impure shell (FAFF-797 spec §4 `cmdReconcileRecover`): resolve -> detect ->
// gate -> write -> report. Every read-only step reuses a shipped primitive verbatim;
// this function introduces no new detection/liveness/gate logic of its own.
// ---------------------------------------------------------------------------
const RECONCILE_RECOVER_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--json": { arity: 0 },
    "--dry-run": { arity: 0 },
    "--run-dir": { arity: 1 },
    "--issue": { arity: 1 },
    "--level": { arity: 1, enum: LEVELS },
    "--sha": { arity: 1 },
    "--root": { arity: 1 },
  },
};
const USAGE = "usage: faff reconcile-recover --run-dir DIR --issue ISSUE-ID --level L1|L2|L3|L4 [--json] [--dry-run] [--sha SHA]";

function emit(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const bits = [`issue=${result.issue}`, `admission=${result.admission}`, `recovered=${result.recovered}`];
  if (result.post_merge_check) bits.push(`post_merge_check=${result.post_merge_check}`);
  console.log(`reconcile-recover: ${bits.join(" ")}`);
}

function cmdReconcileRecover(args) {
  if (args.includes("--selftest")) return reconcileRecoverSelftest();
  const { values, errors } = parseArgs(args, RECONCILE_RECOVER_SPEC);
  if (errors.length) return usageError(errors, USAGE);
  const asJson = !!values["--json"];
  const dryRun = !!values["--dry-run"];
  const runDir = values["--run-dir"] || null;
  const issue = values["--issue"] || null;
  const level = values["--level"] || null;
  const shaOverride = values["--sha"] || null;
  const root = values["--root"] || findRoot();

  if (!runDir || !issue || !level) {
    process.stderr.write(`faff reconcile-recover: --run-dir, --issue and --level are all required\n${USAGE}\n`);
    return 2;
  }
  if (!isValidIssueId(issue)) {
    process.stderr.write(`faff reconcile-recover: --issue ${JSON.stringify(issue)} is not a valid issue id\n`);
    return 2;
  }
  if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    process.stderr.write(`faff reconcile-recover: no run-ledger.json under ${runDir} (pass --run-dir DIR)\n`);
    return 2;
  }

  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) {
    process.stderr.write(`faff reconcile-recover: malformed ledger in ${path.join(runDir, "run-ledger.json")}: ${e.message}\n`);
    return 2;
  }

  // Detect (read-only): fold the effective heartbeat, then reuse the shipped
  // merge-evidence + liveness primitives verbatim.
  overlayHeartbeat(ledger, readHeartbeatFile(runDir));
  const admitted = Array.isArray(ledger.admitted) ? ledger.admitted : [];
  const merged = readMergedMap(runDir, admitted)[issue] === true;
  const held = runIsHeld(ledger, Date.now(), process.env);
  const admission = admitRecovery({ ledger, issue, merged, held });
  const predicate = recoveryPredicate({ ledger, issue, merged, held });
  const runId = ledger.run_id || path.basename(runDir);

  const base = { verb: "reconcile-recover", run_id: runId, issue, admission, predicate };

  if (admission !== "recoverable") {
    const exitCode = (admission === "not-unclosed" && isAlreadyClosed(ledger, issue)) ? 0 : 3;
    const result = { ...base, recovered: false, post_merge_check: null, pr: null, merge_sha: null, wrote: null };
    emit(result, asJson);
    return exitCode;
  }

  // Gate: re-run post-merge-check against the merge this issue proved. `pr` comes from
  // the same merge-record.json readMergedMap already trusted (never a second, divergent
  // observation); the sha is resolved by verifyPostMerge itself (post-merge.js's own
  // "never a second sha observation" invariant) unless --sha explicitly overrides it.
  const details = readMergedDetails(runDir, issue);
  const pr = details && details.pr != null ? details.pr : null;
  const { record, exit: pmExit, failLoud } = verifyPostMerge({ issue, pr, runDir, shaOverride, root });
  if (failLoud) {
    process.stderr.write(`faff reconcile-recover: post-merge-check could not resolve a merge sha: ${failLoud}\n`);
    const result = { ...base, recovered: false, post_merge_check: "unverified", pr, merge_sha: null, wrote: null };
    emit(result, asJson);
    return 1; // absent proof of health BLOCKS, exactly as a red/unverified verdict does
  }
  if (record.verdict !== "verified-ok") {
    const result = { ...base, recovered: false, post_merge_check: record.verdict, pr: record.pr, merge_sha: record.merge_sha, wrote: null };
    emit(result, asJson);
    return 1; // verified-fail OR unverified — a red or absent post-merge-check BLOCKS
  }
  void pmExit; // the verdict string is the load-bearing signal; the raw exit is folded into it already

  if (dryRun) {
    const result = { ...base, recovered: false, dry_run: true, post_merge_check: record.verdict, pr: record.pr, merge_sha: record.merge_sha, wrote: null };
    emit(result, asJson);
    return 0;
  }

  // Write: delegate to the existing, single tested ledger-close writer.
  const written = writeRecovery(runDir, issue);
  if (!written.written) {
    process.stderr.write(`faff reconcile-recover: record-outcome write failed: ${written.detail}\n`);
    const result = { ...base, recovered: false, post_merge_check: record.verdict, pr: record.pr, merge_sha: record.merge_sha, wrote: null };
    emit(result, asJson);
    return 2;
  }

  const result = {
    ...base, recovered: true,
    post_merge_check: record.verdict, pr: record.pr, merge_sha: record.merge_sha,
    wrote: { outcome: "shipped", owner_status: "done" },
  };
  emit(result, asJson);
  return 0;
}

// ---------------------------------------------------------------------------
// Selftest — drives the pure admitRecovery core across every admission branch
// (mirrors disposition.js's selftest shape: [name, input, wantAdmission]).
// ---------------------------------------------------------------------------
const RECOVERY_SELFTEST_CASES = [
  ["not-merged: no merge evidence at all",
    { ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: false, held: false },
    "not-merged"],
  ["not-merged: merged evidence explicitly false",
    { ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: false, held: true },
    "not-merged"],
  ["not-unclosed: issue never admitted to this run",
    { ledger: { admitted: ["FAFF-OTHER"], outcomes: {} }, issue: "FAFF-1", merged: true, held: false },
    "not-unclosed"],
  ["not-unclosed: already closed (outcomes carries the issue)",
    { ledger: { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } }, issue: "FAFF-1", merged: true, held: false },
    "not-unclosed"],
  ["live: merged + unclosed but the run is still held (fresh heartbeat)",
    { ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: true, held: true },
    "live"],
  ["recoverable: merged + unclosed + verifiably-stale (not held)",
    { ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: true, held: false },
    "recoverable"],
  ["not-merged wins over live: merge evidence absent is checked first regardless of held",
    { ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: false, held: true },
    "not-merged"],
  ["not-unclosed wins over live: an already-closed issue never reads as live even if held",
    { ledger: { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } }, issue: "FAFF-1", merged: true, held: true },
    "not-unclosed"],
];

function reconcileRecoverSelftest() {
  let fail = 0;
  for (const [name, input, want] of RECOVERY_SELFTEST_CASES) {
    let ok = true;
    let detail = "";
    try {
      const got = admitRecovery(input);
      if (got !== want) { ok = false; detail = `admission=${got} (want ${want})`; }
    } catch (e) { ok = false; detail = `threw: ${e.message}`; }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  }

  // Every ADMISSIONS token is reachable (belt-and-braces over the fixture table above).
  const seen = new Set(RECOVERY_SELFTEST_CASES.map(([, input]) => admitRecovery(input)));
  const allSeen = ADMISSIONS.every((a) => seen.has(a));
  console.log(`${allSeen ? "ok  " : "FAIL"} every admission token is exercised by the fixture table`);
  if (!allSeen) fail++;

  // isAlreadyClosed / recoveryPredicate — the shell-level refinements over the folded token.
  const closedLedger = { admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } };
  const neverAdmittedLedger = { admitted: ["FAFF-OTHER"], outcomes: {} };
  const c1 = isAlreadyClosed(closedLedger, "FAFF-1") === true;
  console.log(`${c1 ? "ok  " : "FAIL"} isAlreadyClosed: true when outcomes carries the issue`); if (!c1) fail++;
  const c2 = isAlreadyClosed(neverAdmittedLedger, "FAFF-1") === false;
  console.log(`${c2 ? "ok  " : "FAIL"} isAlreadyClosed: false when the issue was never admitted`); if (!c2) fail++;
  const pred = recoveryPredicate({ ledger: { admitted: ["FAFF-1"], outcomes: {} }, issue: "FAFF-1", merged: true, held: false });
  const c3 = pred.merged === true && pred.unclosed === true && pred.verifiably_stale === true;
  console.log(`${c3 ? "ok  " : "FAIL"} recoveryPredicate: recoverable shape is {merged:true, unclosed:true, verifiably_stale:true}`);
  if (!c3) fail++;

  // cmdReconcileRecover usage-level fail-loud paths (no filesystem needed).
  const usageExit = cmdReconcileRecover(["--issue", "FAFF-1"]);
  const u1 = usageExit === 2;
  console.log(`${u1 ? "ok  " : "FAIL"} cmd: missing --run-dir/--level → exit 2 usage`); if (!u1) fail++;
  const badIdExit = cmdReconcileRecover(["--run-dir", "/nonexistent-faff-selftest", "--issue", "not-an-id!", "--level", "L3"]);
  const u2 = badIdExit === 2;
  console.log(`${u2 ? "ok  " : "FAIL"} cmd: invalid --issue → exit 2 usage`); if (!u2) fail++;
  const noRunDirExit = cmdReconcileRecover(["--run-dir", "/nonexistent-faff-selftest-dir", "--issue", "FAFF-1", "--level", "L3"]);
  const u3 = noRunDirExit === 2;
  console.log(`${u3 ? "ok  " : "FAIL"} cmd: --run-dir with no run-ledger.json → exit 2`); if (!u3) fail++;

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${RECOVERY_SELFTEST_CASES.length + 8} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  ADMISSIONS,
  RECOVERY_SELFTEST_CASES,
  admitRecovery,
  cmdReconcileRecover,
  isAlreadyClosed,
  reconcileRecoverSelftest,
  recoveryPredicate,
  writeRecovery,
};
