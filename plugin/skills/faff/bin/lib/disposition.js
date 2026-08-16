// ===========================================================================
// === region:factory — disposition — FAFF-396: the run-end DISPOSITION verdict a ===
// headless (CI/cron/container) wrapper runs as its final step. Reads a single run
// dir's on-disk end state and classifies it into `clean` vs `needs-attention`, so a
// lights-out run whose issues parked/errored/escalated exits NON-ZERO instead of
// reporting green-by-silence. PURE (filesystem reads under the run dir only — no
// tracker/network/LLM, and it writes nothing; parity with runcheck/economics/audit).
// Adds NO second copy of the durable signal: per-issue surfacing (faff-parked label +
// reason comment) already ships in the park protocol, the run summary already ships as
// a hard-floor artifact — this verb adds only the process-exit CONTRACT over them.
// Reuses auditLedger + TERMINAL_STATES (runcheck) and extractParksBlock (park-history)
// verbatim; forks none. Fail toward attention: anything that indicates the run did not
// end cleanly reads as needs-attention, never as clean.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { auditLedger } = require("./runcheck");
const { extractParksBlock } = require("./park-history");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");

// The per-issue terminal outcomes that mean a human must act — one issue-outcome
// attention item each. `shipped` (done) and `routed-out` are CLEAN — counting routed-out
// would make near-every run red and train wrappers to ignore the signal. FAFF-779:
// `routed-out` no longer means "never attempted" across the board — a `needs-decision-first`
// verdict DOES get a bounded resolve-attempt, and a FAILED attempt now records `parked`
// (the shared Park protocol), not `routed-out`. What stays `routed-out` and clean is a
// verdict that never triggers a resolve-attempt at all (`gap-blocked`, `circular-blocked`,
// `repeat-parked` — unchanged by FAFF-779): genuine steady-state backlog triage surfaced by
// /faff-wtf, not an attempted-and-failed disposition. `pr-open` IS attention: a
// PR left open for human review is precisely a "human must act" outcome of this run.
// FAFF-594: "parked-window" (a global 5h budget.window breach, at_ceiling:
// park-until-window-reset) is attention exactly like "unreached-budget" — a
// window-parked run still surfaces for a human to see, never silently clean.
const ATTENTION_OUTCOMES = new Set(["parked", "errored", "unreached-budget", "pr-open", "parked-window"]);

// The escalate-class stop_reason tokens that raise a run-escalation item even when
// every issue shipped. `budget-escalated` carries dimensions (budget-escalated(tokens))
// so it is PREFIX-matched; the rest are exact. A plain budget stop / queue-drained /
// converged / all-remaining-parked is a configured quiet stop and raises nothing (its
// undispatched issues, if any, already surface as unreached-budget issue items).
const ESCALATE_STOP_EXACT = new Set(["non-convergence", "product-incomplete", "sentry-abort"]);
function isEscalateStopReason(stopReason) {
  if (typeof stopReason !== "string") return false;
  if (stopReason.startsWith("budget-escalated")) return true;   // budget-escalated(<dims>)
  return ESCALATE_STOP_EXACT.has(stopReason);
}

// issue → root_cause_class from a summary.md faff-parks block (first record wins per
// issue). The parks block is the FIRST, authoritative source in the cause-joining chain.
function parksCauseMap(parksBlock) {
  const map = {};
  if (!Array.isArray(parksBlock)) return map;
  for (const p of parksBlock) {
    if (!p || typeof p !== "object") continue;
    if (typeof p.issue_id === "string" && !(p.issue_id in map) && p.root_cause_class != null) {
      map[p.issue_id] = p.root_cause_class;
    }
  }
  return map;
}

// Best-effort cause from a latest issue-outcome event's `data` — the SECOND source in
// the chain, consulted only when the parks block has nothing for the issue.
function eventCause(data) {
  if (!data || typeof data !== "object") return null;
  if (data.root_cause_class != null) return data.root_cause_class;
  if (data.cause != null) return data.cause;
  if (data.gate != null) return data.gate;   // which quality gate caught it (FAFF-418)
  return null;
}

// issue → the LATEST issue-outcome event (by seq, else array order) for that issue.
function issueOutcomeEventMap(events) {
  const map = {};
  if (!Array.isArray(events)) return map;
  for (const e of events) {
    if (!e || e.type !== "issue-outcome" || typeof e.issue !== "string") continue;
    const seq = typeof e.seq === "number" ? e.seq : -1;
    const prev = map[e.issue];
    if (!prev || seq >= prev.seq) map[e.issue] = { seq, data: e.data };
  }
  return map;
}

// ---------------------------------------------------------------------------
// The pure classifier core (selftest-driven). Folds the ledger + best-effort cause
// substrates into a DispositionReport. The exit-deciding classification depends ONLY
// on run-ledger.json; the parks/events substrates only enrich `cause` and never change
// the disposition. `auditLedger` throws on a malformed ledger (→ exit 2 in the shell).
// ---------------------------------------------------------------------------
function computeDisposition(ledger, parksMap, eventMap, mergedMap, runId) {
  const audit = auditLedger(ledger, ledger.run_id);   // throws on malformed → exit 2 shell-side
  parksMap = parksMap || {};
  eventMap = eventMap || {};
  // issue → true iff merge-record.json proved merged (FAFF-782). Coerce a non-object to {} so an
  // old 4-arg caller (…, eventMap, runId) that misbinds a string runId as mergedMap degrades LOUDLY
  // to "no merge evidence" rather than silently relying on string-index falsiness.
  mergedMap = (mergedMap && typeof mergedMap === "object" && !Array.isArray(mergedMap)) ? mergedMap : {};
  const outcomes = (ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  const items = [];

  // 3. per-issue terminal outcomes in the attention set → one issue-outcome item each.
  for (const [issue, outcome] of Object.entries(outcomes)) {
    if (!ATTENTION_OUTCOMES.has(outcome)) continue;
    const cause = (issue in parksMap ? parksMap[issue] : null)
      ?? (eventMap[issue] ? eventCause(eventMap[issue].data) : null)
      ?? null;
    items.push({ kind: "issue-outcome", issue, outcome, cause });
  }

  // 4. a recorded escalate-class stop_reason → a run-escalation item (even all-shipped).
  if (isEscalateStopReason(ledger.stop_reason)) {
    items.push({ kind: "run-escalation", issue: null, outcome: null, cause: ledger.stop_reason });
  }

  // 5. a sentry abort marker (ledger.abort or owner.status flipped) → an aborted item.
  const abortEntry = (ledger.abort && typeof ledger.abort === "object") ? ledger.abort : null;
  const ownerAborted = !!(ledger.owner && ledger.owner.status === "aborted-resumable");
  if (abortEntry || ownerAborted) {
    const cause = (abortEntry && abortEntry.signal) ? abortEntry.signal : "sentry-abort";
    items.push({ kind: "aborted", issue: null, outcome: null, cause });
  }

  // 6. an incomplete ledger (undispatched admitted issues, or invalid outcome tokens) →
  // an incomplete-ledger item naming them. An abandoned/killed run must read as
  // needs-attention independently of stop_reason adoption (fail toward attention).
  // FAFF-782: partition undispatched issues by merge evidence — an admitted-but-unrecorded
  // issue whose merge-record.json proved `merged:true` (mergedMap[issue] === true) is a
  // merged-but-unclosed run (the harness killed the orchestrator after a durable merge, before
  // the ledger close), a distinct, less-alarming class than a genuine build failure. It gets its
  // own `merged-unclosed` item; the remaining undispatched issues plus invalid-outcome tokens
  // keep the generic `incomplete-ledger` item (omitted when that remainder is empty). Still
  // attention (exit 1) — the run is not silently green, it just needs closing, not investigating.
  if (!audit.clean) {
    const mergedUnclosed = audit.undispatched.filter((i) => mergedMap[i] === true);
    const remainderUndispatched = audit.undispatched.filter((i) => mergedMap[i] !== true);
    for (const issue of mergedUnclosed) {
      items.push({ kind: "merged-unclosed", issue, outcome: null, cause: "merged-unrecorded" });
    }
    const names = [...remainderUndispatched, ...audit.invalid_outcomes];
    if (names.length) {
      items.push({ kind: "incomplete-ledger", issue: null, outcome: null, cause: names.join(", ") });
    }
  }

  const counts = {};
  for (const o of Object.values(outcomes)) counts[o] = (counts[o] || 0) + 1;

  return {
    run_id: runId != null ? runId : (ledger.run_id ?? null),
    disposition: items.length ? "needs-attention" : "clean",
    attention: items,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Thin impure shell: resolve the run dir, read the substrates degrade-don't-crash,
// classify, print, exit.
// ---------------------------------------------------------------------------

// Best-effort issue→cause map from summary.md's faff-parks block. Absent summary OR a
// malformed faff-parks block (extractParksBlock throws) degrades to {} — a bad substrate
// never fails the verb, it only degrades `cause` to null (the audit posture).
function readParksMap(runDir) {
  try {
    const body = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
    return parksCauseMap(extractParksBlock(body, path.basename(runDir)));
  } catch { return {}; }
}

// Best-effort issue→latest-issue-outcome-event map from events.jsonl. Absent/unreadable
// file or a bad line degrades (blank/unparseable lines skipped, parity with `events read`).
function readIssueOutcomeEvents(runDir) {
  try {
    const raw = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8");
    const events = raw.split("\n").filter((l) => l.trim() !== "")
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    return issueOutcomeEventMap(events);
  } catch { return {}; }
}

// FAFF-782: best-effort issue→true map from each admitted issue's merge-record.json. The
// merge evidence substrate that lets the pure classifier distinguish a merged-but-unclosed run
// (the orchestrator was killed after a durable merge) from a genuine build failure. Gathered in
// the impure shell — never inside computeDisposition, which stays a pure filesystem-free classifier
// (the read-substrate-in-the-shell pattern of readParksMap / readIssueOutcomeEvents). Degrades to
// omission (never throws): an issue is included ONLY when its merge-record.json parses to an object
// with `.merged === true`. Absent / unreadable / malformed / truncated JSON / merged!=true → the
// issue is omitted, so an unprovable merge is never asserted as merged-unclosed (fail-safe).
const ISSUE_ID_RE = /^[A-Z][A-Z0-9]*-\d+$/;
function readMergedMap(runDir, admitted) {
  const result = {};
  if (!Array.isArray(admitted)) return result;
  for (const issue of admitted) {
    // Trusted-input guard: reject any non-issue-id admitted entry before the path.join. Belt-and-
    // braces — admitted is written by the run's own agents to a controlled volume — not a security
    // control (disposition emits only a boolean + issue-id, never file contents).
    if (typeof issue !== "string" || !ISSUE_ID_RE.test(issue)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(runDir, issue, "merge-record.json"), "utf8"));
      if (parsed && typeof parsed === "object" && parsed.merged === true) result[issue] = true;
    } catch { /* absent / unreadable / malformed / truncated → omit (degrade, never crash) */ }
  }
  return result;
}

// FAFF-782: best-effort issue→{pr,sha} from the same merge-records, for the shell-side render
// enrichment only (never fed to the pure core). Non-load-bearing: absent details leave the item's
// cause as the plain stable token.
function readMergedDetails(runDir, issue) {
  if (typeof issue !== "string" || !ISSUE_ID_RE.test(issue)) return null;   // same shape guard as readMergedMap before any path.join (belt-and-braces — callers only pass guarded mergedMap keys today)
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(runDir, issue, "merge-record.json"), "utf8"));
    if (parsed && typeof parsed === "object" && parsed.merged === true) {
      return { pr: parsed.pr, sha: typeof parsed.head_sha === "string" ? parsed.head_sha.slice(0, 8) : null };
    }
  } catch { /* degrade */ }
  return null;
}

function renderDisposition(report) {
  console.log(`run:          ${report.run_id}`);
  const countStr = Object.entries(report.counts).map(([k, n]) => `${k}=${n}`).join("  ");
  console.log(`outcomes:     ${countStr || "(none)"}`);
  for (const it of report.attention) {
    const parts = [it.kind];
    if (it.issue) parts.push(it.issue);
    if (it.outcome) parts.push(it.outcome);
    if (it.cause) parts.push(`(${it.cause})`);
    console.log(`  attention:  ${parts.join(" ")}`);
  }
  console.log(`disposition:  ${report.disposition}`);
}

const { parseArgs, usageError } = require("./argv");
const DISPOSITION_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 } } };

function cmdDisposition(args) {
  if (args.includes("--selftest")) return dispositionSelftest();
  const { values, errors } = parseArgs(args, DISPOSITION_SPEC);
  if (errors.length) return usageError(errors, "usage: faff disposition [--run-dir DIR] [--root DIR] [--json]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];
  const root = get("--root") || findRoot();

  // Run-dir resolution: explicit --run-dir → $FAFF_RUN_DIR → latest under .faff/runs.
  // An EXPLICIT --run-dir is honoured as-is (never silently redirected to `latest` when
  // its ledger is missing — a wrapper naming a dir with no ledger must see exit 3, not a
  // verdict about a different run).
  const explicit = get("--run-dir");
  const runDir = explicit || process.env.FAFF_RUN_DIR || latestRunDir(root);
  if (!runDir || !fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    process.stderr.write("faff disposition: no run dir / no run-ledger.json (pass --run-dir DIR)\n");
    return 3;
  }

  let ledger;
  try { ledger = readLedger(runDir); }
  catch (e) {
    process.stderr.write(`faff disposition: malformed ledger in ${path.join(runDir, "run-ledger.json")}: ${e.message}\n`);
    return 2;
  }

  const parksMap = readParksMap(runDir);
  const eventMap = readIssueOutcomeEvents(runDir);
  const mergedMap = readMergedMap(runDir, Array.isArray(ledger.admitted) ? ledger.admitted : []);

  let report;
  try { report = computeDisposition(ledger, parksMap, eventMap, mergedMap, ledger.run_id || path.basename(runDir)); }
  catch (e) {
    process.stderr.write(`faff disposition: malformed ledger in ${path.join(runDir, "run-ledger.json")}: ${e.message}\n`);
    return 2;
  }

  // Shell-side render enrichment (non-load-bearing, FAFF-782): surface the shipped PR/sha on each
  // merged-unclosed item so an operator scanning drain.sh output sees the merge at a glance. Only
  // for the (rare) merged-unclosed items — the pure core already decided the classification.
  for (const it of report.attention) {
    if (it.kind !== "merged-unclosed" || !it.issue) continue;
    const d = readMergedDetails(runDir, it.issue);
    if (d && (d.pr != null || d.sha)) {
      it.cause = `merged-unrecorded${d.pr != null ? ` pr#${d.pr}` : ""}${d.sha ? ` ${d.sha}` : ""}`;
    }
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else renderDisposition(report);
  return report.disposition === "needs-attention" ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Selftest — drives computeDisposition as a pure function over a fixture table
// covering every Scenario in the spec plus the degrade paths.
// [name, ledger, parksMap, eventMap, mergedMap, wantDisposition, attentionCheck?]
// ---------------------------------------------------------------------------
const has = (attention, pred) => attention.some(pred);
const DISPOSITION_SELFTEST_CASES = [
  ["parked issue + parks-block cause → needs-attention, issue-outcome cause from parks",
    { run_id: "R", admitted: ["FAFF-X"], outcomes: { "FAFF-X": "parked" } },
    { "FAFF-X": "punt-not-closed" }, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.issue === "FAFF-X" && i.outcome === "parked" && i.cause === "punt-not-closed")],
  ["all shipped/routed-out + queue-drained → clean, no attention",
    { run_id: "R", admitted: ["A", "B"], outcomes: { A: "shipped", B: "routed-out" }, stop_reason: "queue-drained" },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["all shipped + budget-escalated(tokens) → run-escalation item",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, stop_reason: "budget-escalated(tokens)" },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "run-escalation" && i.cause === "budget-escalated(tokens)")],
  ["admitted issue absent from outcomes (killed run) → incomplete-ledger naming it",
    { run_id: "R", admitted: ["A", "B"], outcomes: { A: "shipped" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "incomplete-ledger" && String(i.cause).includes("B"))],
  ["ledger abort entry → aborted item with the abort signal as cause",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, abort: { status: "aborted-resumable", signal: "wall-clock-runaway" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "aborted" && i.cause === "wall-clock-runaway")],
  ["owner.status aborted-resumable (no abort entry) → aborted item, cause sentry-abort",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, owner: { status: "aborted-resumable" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "aborted" && i.cause === "sentry-abort")],
  ["pr-open counts as attention",
    { run_id: "R", admitted: ["A"], outcomes: { A: "pr-open" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.outcome === "pr-open")],
  ["routed-out alone is clean (never attention)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "routed-out" }, stop_reason: "all-remaining-parked" },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["errored + unreached-budget → two issue-outcome items",
    { run_id: "R", admitted: ["A", "B"], outcomes: { A: "errored", B: "unreached-budget" } },
    {}, {}, {}, "needs-attention",
    (a) => a.filter((i) => i.kind === "issue-outcome").length === 2],
  ["cause degrade: no parks + event data has gate → event-derived cause",
    { run_id: "R", admitted: ["A"], outcomes: { A: "errored" } },
    {}, { A: { seq: 1, data: { gate: "ci" } } }, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.cause === "ci")],
  ["cause degrade: absent parks + absent event → cause null",
    { run_id: "R", admitted: ["A"], outcomes: { A: "parked" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.cause === null)],
  ["parks block wins over events (precedence)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "parked" } },
    { A: "gap" }, { A: { seq: 1, data: { gate: "ci" } } }, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.cause === "gap")],
  ["non-escalate stop_reason budget-hit(...) → no run-escalation",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, stop_reason: "budget-hit(tokens)" },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["empty run (no admitted, no outcomes) → clean",
    { run_id: "R", admitted: [], outcomes: {} },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["unknown/future outcome token → incomplete-ledger (fail toward attention)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "weird-token" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "incomplete-ledger" && String(i.cause).includes("weird-token"))],
  ["absent stop_reason (legacy ledger) still detects the abort marker",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, abort: { status: "aborted-resumable" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "aborted" && i.cause === "sentry-abort")],
  ["escalate exact: non-convergence → run-escalation",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, stop_reason: "non-convergence" },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "run-escalation" && i.cause === "non-convergence")],
  ["counts histogram is emitted over outcomes",
    { run_id: "R", admitted: ["A", "B", "C"], outcomes: { A: "shipped", B: "shipped", C: "parked" } },
    {}, {}, {}, "needs-attention", null],
  ["FAFF-571: superseded is clean (accepted by auditLedger AND excluded from attention)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "superseded" } },
    {}, {}, {}, "clean", (a) => a.length === 0],
  // FAFF-782 — merged-unclosed detection (the merge evidence substrate distinguishing a
  // truncated-post-merge run from a genuine build failure).
  ["FAFF-782: undispatched issue WITH merge-record merged:true → merged-unclosed item, NO incomplete-ledger naming it",
    { run_id: "R", admitted: ["FAFF-417"], outcomes: {} },
    {}, {}, { "FAFF-417": true }, "needs-attention",
    (a) => has(a, (i) => i.kind === "merged-unclosed" && i.issue === "FAFF-417" && i.cause === "merged-unrecorded")
        && !has(a, (i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-417"))],
  ["FAFF-782: undispatched issue with NO merge evidence (killed before merge) → generic incomplete-ledger, never merged-unclosed",
    { run_id: "R", admitted: ["FAFF-417"], outcomes: {} },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-417"))
        && !has(a, (i) => i.kind === "merged-unclosed")],
  ["FAFF-782: corrupt/absent merge-record fails safe (omitted from mergedMap) → generic incomplete-ledger, never merged-unclosed",
    { run_id: "R", admitted: ["FAFF-417"], outcomes: {} },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "incomplete-ledger") && !has(a, (i) => i.kind === "merged-unclosed")],
  ["FAFF-782: mixed run — FAFF-A merged-unclosed, FAFF-B genuinely undispatched → BOTH items present in one report",
    { run_id: "R", admitted: ["FAFF-A", "FAFF-B"], outcomes: {} },
    {}, {}, { "FAFF-A": true }, "needs-attention",
    (a) => has(a, (i) => i.kind === "merged-unclosed" && i.issue === "FAFF-A")
        && has(a, (i) => i.kind === "incomplete-ledger" && String(i.cause).includes("FAFF-B") && !String(i.cause).includes("FAFF-A"))],
  ["FAFF-782: merged-unclosed is attention (exit 1), never silently clean",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: {} },
    {}, {}, { "FAFF-A": true }, "needs-attention",
    (a) => a.length > 0 && has(a, (i) => i.kind === "merged-unclosed")],
];

function dispositionSelftest() {
  let fail = 0;
  for (const [name, ledger, parksMap, eventMap, mergedMap, wantDisp, attnCheck] of DISPOSITION_SELFTEST_CASES) {
    let ok = true;
    let detail = "";
    try {
      const report = computeDisposition(ledger, parksMap, eventMap, mergedMap);
      if (report.disposition !== wantDisp) { ok = false; detail = `disposition=${report.disposition} (want ${wantDisp})`; }
      if (ok && attnCheck && !attnCheck(report.attention)) { ok = false; detail = `attention check failed: ${JSON.stringify(report.attention)}`; }
      // counts histogram sanity on the dedicated case: shipped=2, parked=1.
      if (ok && name.startsWith("counts histogram")) {
        if (report.counts.shipped !== 2 || report.counts.parked !== 1) { ok = false; detail = `counts=${JSON.stringify(report.counts)}`; }
      }
    } catch (e) { ok = false; detail = `threw: ${e.message}`; }
    if (!ok) fail++;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${DISPOSITION_SELFTEST_CASES.length} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  ATTENTION_OUTCOMES, DISPOSITION_SELFTEST_CASES, ESCALATE_STOP_EXACT,
  cmdDisposition, computeDisposition, dispositionSelftest, eventCause,
  isEscalateStopReason, issueOutcomeEventMap, parksCauseMap,
  readIssueOutcomeEvents, readMergedMap, readParksMap, renderDisposition,
};
