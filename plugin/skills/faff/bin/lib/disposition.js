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
const { readLedger } = require("./shared-infra");
const { classifyCustodyVerdictBytes } = require("./contract-defs");

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
function computeDisposition(ledger, parksMap, eventMap, mergedMap, runId, custodyMap) {
  const audit = auditLedger(ledger, ledger.run_id);   // throws on malformed → exit 2 shell-side
  parksMap = parksMap || {};
  eventMap = eventMap || {};
  // issue → true iff merge-record.json proved merged (FAFF-782). Coerce a non-object to {} so an
  // old 4-arg caller (…, eventMap, runId) that misbinds a string runId as mergedMap degrades LOUDLY
  // to "no merge evidence" rather than silently relying on string-index falsiness.
  mergedMap = (mergedMap && typeof mergedMap === "object" && !Array.isArray(mergedMap)) ? mergedMap : {};
  // issue → custody classification (FAFF-784), PRESENT files only — readCustodyMap never includes an
  // issue with no on-disk custody-verdict.json (missing alone never retroactively marks a legacy/
  // interactive run; see the item below). Coerce a non-object the same defensive way as mergedMap.
  custodyMap = (custodyMap && typeof custodyMap === "object" && !Array.isArray(custodyMap)) ? custodyMap : {};
  const outcomes = (ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes))
    ? ledger.outcomes : {};
  const items = [];

  // 3. per-issue terminal outcomes in the attention set → one issue-outcome item each.
  // FAFF-842: `pr-open` is written to the SAME outcome bucket by two graft return tokens — the
  // resumable `landing-resumable` (a 25-minute landing-time-budget hold; a later L3 executor can
  // pick it back up via the endgame-only recovery-claim resume) and the hard-parked 3-cycle
  // `pr-open-for-human` (a genuine human handoff). The raw outcome string can't tell them apart —
  // `ledger.landing_resumable` is the additive disambiguator beep-boop writes ONLY on the resumable
  // token, mirroring the shipped `review_outage_pending` array's own Array.isArray coercion
  // (mergedMap/custodyMap above). A resumable pr-open is skipped here (not attention, the next drain
  // may land it); pr-open-for-human is NEVER added to the array, so it always falls through and reds.
  const landingResumable = Array.isArray(ledger.landing_resumable) ? new Set(ledger.landing_resumable) : new Set();
  for (const [issue, outcome] of Object.entries(outcomes)) {
    if (!ATTENTION_OUTCOMES.has(outcome)) continue;
    if (outcome === "pr-open" && landingResumable.has(issue)) continue;
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

  // 5b. FAFF-854: an owner left "running" is a NON-TERMINAL run-end — the detective half of the
  // turn-survival invariant (turncheck is the preventive half). computeDisposition is a post-mortem
  // verb (the container has died by the time it runs), so owner.status === "running" is itself the
  // "left mid-flight, never closed" signal — pure + clock-free, mirroring ownerAborted above (no
  // heartbeat consulted). Fires INDEPENDENTLY of incomplete-ledger: a mid-prep death with an empty
  // admitted array is `clean` for the completeness audit (nothing admitted) yet still owner.status
  // "running" — the exact blind spot the empty-run selftest below used to codify green. "done" /
  // "aborted-resumable" / a legacy no-owner ledger never fire it.
  const ownerStillRunning = !!(ledger.owner && ledger.owner.status === "running");
  if (ownerStillRunning) {
    items.push({ kind: "owner-still-running", issue: null, outcome: null, cause: "running-not-closed" });
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

  // 7. FAFF-784: a PRESENT, non-clean per-issue custody-verdict.json → a custody-non-clean item,
  // independent of the issue's own outcome bucket — tamper / verification-unavailable / a malformed
  // present record / a run-or-issue identity mismatch all surface needs-attention EVEN for an
  // otherwise-clean shipped/Done outcome (a dispatched merge that DID land cannot silently stay
  // green if its custody evidence says otherwise). A MISSING verdict file is never in custodyMap at
  // all (readCustodyMap omits it) — absence alone never retroactively marks a legacy/interactive run;
  // only a verdict file that actually exists and reads non-clean raises this item.
  for (const [issue, cls] of Object.entries(custodyMap)) {
    if (cls === "clean") continue;
    items.push({ kind: "custody-non-clean", issue, outcome: (issue in outcomes ? outcomes[issue] : null), cause: cls });
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

// FAFF-784: best-effort issue→custody classification from each admitted issue's
// custody-verdict.json, gathered in the impure shell (the same read-substrate-in-the-shell pattern
// as readMergedMap) and fed to the pure core. `classifyCustodyVerdictBytes` (contract-defs.js) does
// the actual parsing/shape/identity work — never forked here. A MISSING file is OMITTED entirely
// (never mapped to any classification) — this is the mechanism behind "missing alone does not
// retroactively mark legacy/interactive runs": computeDisposition only ever sees issues whose
// custody-verdict.json genuinely exists on disk. A present-but-unreadable/malformed/identity-
// mismatched file still yields an entry (mapped to disposition's own "malformed-present" /
// "identity-mismatch" labels) — a BROKEN present record is exactly the case that must surface, never
// silently omitted like a genuinely absent one.
function readCustodyMap(runDir, admitted, expectedRunId) {
  const result = {};
  if (!Array.isArray(admitted)) return result;
  const runId = expectedRunId || path.basename(runDir);
  for (const issue of admitted) {
    if (typeof issue !== "string" || !ISSUE_ID_RE.test(issue)) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(runDir, issue, "custody-verdict.json"), "utf8"); }
    catch { continue; } // absent/unreadable-as-ENOENT → omit (missing alone is never attention)
    const cls = classifyCustodyVerdictBytes(raw, { expectedRunId: runId, expectedIssue: issue });
    if (cls.classification === "malformed") result[issue] = "malformed-present";
    else result[issue] = cls.classification; // "identity-mismatch" | "clean" | "tamper" | "verification-unavailable"
  }
  return result;
}

// FAFF-782: best-effort issue→{pr,sha} from the same merge-records, for shell-side render
// enrichment (never fed to the pure core). Non-load-bearing here: absent details leave the
// item's cause as the plain stable token. FAFF-797: also reused verbatim by
// `reconcile-recover.js`'s impure shell to supply `pr` to a re-run `post-merge-check` — the
// same "reuse the read-only detector, never re-derive" posture, a second shell-side consumer,
// still never fed to any pure core.
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
const DISPOSITION_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--run-dir": { arity: 1 } } };

function cmdDisposition(args) {
  if (args.includes("--selftest")) return dispositionSelftest();
  const { values, errors } = parseArgs(args, DISPOSITION_SPEC);
  if (errors.length) return usageError(errors, "usage: faff disposition [--run-dir DIR] [--json]");
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const asJson = !!values["--json"];

  // Run-dir resolution: explicit --run-dir → $FAFF_RUN_DIR → none. FAFF-858: the
  // newest-ledger guess is removed outright — with the L4 drain now reusing its
  // inherited FAFF_RUN_DIR end to end (no second mint), "read the newest" is not a
  // safe operator fallback (several unclosed `*-lights-out` ledgers can legitimately
  // coexist). An EXPLICIT --run-dir is still honoured as-is (never silently redirected
  // when its ledger is missing — a wrapper naming a dir with no ledger must see exit 3,
  // not a verdict about a different run); with neither supplied, fail explicitly.
  const explicit = get("--run-dir");
  const runDir = explicit || process.env.FAFF_RUN_DIR || null;
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
  const runId = ledger.run_id || path.basename(runDir);
  const admitted = Array.isArray(ledger.admitted) ? ledger.admitted : [];
  const mergedMap = readMergedMap(runDir, admitted);
  const custodyMap = readCustodyMap(runDir, admitted, runId);

  let report;
  try { report = computeDisposition(ledger, parksMap, eventMap, mergedMap, runId, custodyMap); }
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
  // FAFF-784 — custody-non-clean surfaces needs-attention from a PRESENT verdict file, even for a
  // shipped/Done outcome; a missing verdict (absent from custodyMap) never retroactively attention.
  ["FAFF-784: tamper custody verdict on a SHIPPED issue → needs-attention (custody overrides a clean outcome)",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "custody-non-clean" && i.issue === "FAFF-A" && i.outcome === "shipped" && i.cause === "tamper"),
    { "FAFF-A": "tamper" }],
  ["FAFF-784: verification-unavailable custody verdict → needs-attention",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "custody-non-clean" && i.cause === "verification-unavailable"),
    { "FAFF-A": "verification-unavailable" }],
  ["FAFF-784: malformed-present custody verdict → needs-attention",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "custody-non-clean" && i.cause === "malformed-present"),
    { "FAFF-A": "malformed-present" }],
  ["FAFF-784: identity-mismatch custody verdict → needs-attention",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "custody-non-clean" && i.cause === "identity-mismatch"),
    { "FAFF-A": "identity-mismatch" }],
  ["FAFF-784: clean custody verdict adds nothing",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "clean", (a) => a.length === 0,
    { "FAFF-A": "clean" }],
  ["FAFF-784: MISSING custody verdict (absent from custodyMap) never retroactively marks a shipped/Done outcome",
    { run_id: "R", admitted: ["FAFF-A"], outcomes: { "FAFF-A": "shipped" } },
    {}, {}, {}, "clean", (a) => a.length === 0,
    {}],
  // FAFF-854 — owner-still-running: the detective half of the turn-survival invariant. The
  // mid-prep-death case (admitted:[] + owner.status running) is `clean` for the completeness
  // audit yet needs-attention here — the exact blind spot the empty-run case above codified green.
  ["FAFF-854: owner.status running + admitted:[] (mid-prep death) → needs-attention with owner-still-running",
    { run_id: "R", admitted: [], outcomes: {}, owner: { status: "running" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "owner-still-running" && i.cause === "running-not-closed")],
  ["FAFF-854: owner.status done + clean queue → clean (a properly-closed run does not fire it)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" }, owner: { status: "done" } },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["FAFF-854: legacy ledger (no owner) → no owner-still-running item (no false fire)",
    { run_id: "R", admitted: ["A"], outcomes: { A: "shipped" } },
    {}, {}, {}, "clean", (a) => !has(a, (i) => i.kind === "owner-still-running")],
  // FAFF-842 — landing_resumable: a pr-open recorded as a resumable landing is not itself
  // attention; a pr-open NOT in the array (incl. the hard-parked pr-open-for-human) still reds.
  ["FAFF-842 Scenario 4: pr-open IN landing_resumable → clean (a resumable landing is not attention)",
    { run_id: "R", admitted: ["FAFF-X"], outcomes: { "FAFF-X": "pr-open" }, landing_resumable: ["FAFF-X"] },
    {}, {}, {}, "clean", (a) => a.length === 0],
  ["FAFF-842 Scenario 4: pr-open NOT in landing_resumable → needs-attention (unchanged default)",
    { run_id: "R", admitted: ["FAFF-Y"], outcomes: { "FAFF-Y": "pr-open" } },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.issue === "FAFF-Y" && i.outcome === "pr-open")],
  ["FAFF-842 Scenario 4: pr-open-for-human (hard-park) is never in landing_resumable → still reds even with an unrelated entry present",
    { run_id: "R", admitted: ["FAFF-Z"], outcomes: { "FAFF-Z": "pr-open" }, landing_resumable: ["FAFF-OTHER"] },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.kind === "issue-outcome" && i.issue === "FAFF-Z" && i.outcome === "pr-open")],
  ["FAFF-842: a mixed run — one resumable pr-open skipped, one non-resumable pr-open reds — both present/absent correctly",
    { run_id: "R", admitted: ["FAFF-A", "FAFF-B"], outcomes: { "FAFF-A": "pr-open", "FAFF-B": "pr-open" }, landing_resumable: ["FAFF-A"] },
    {}, {}, {}, "needs-attention",
    (a) => !has(a, (i) => i.issue === "FAFF-A") && has(a, (i) => i.issue === "FAFF-B" && i.kind === "issue-outcome")],
  ["FAFF-842: landing_resumable non-array (malformed) degrades to no resumable issues, never throws",
    { run_id: "R", admitted: ["FAFF-X"], outcomes: { "FAFF-X": "pr-open" }, landing_resumable: "FAFF-X" },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.issue === "FAFF-X" && i.kind === "issue-outcome")],
  ["FAFF-842: landing_resumable is inert for a non-pr-open outcome (e.g. parked) even if the issue id is listed",
    { run_id: "R", admitted: ["FAFF-X"], outcomes: { "FAFF-X": "parked" }, landing_resumable: ["FAFF-X"] },
    {}, {}, {}, "needs-attention",
    (a) => has(a, (i) => i.issue === "FAFF-X" && i.outcome === "parked")],
];

function dispositionSelftest() {
  let fail = 0;
  for (const [name, ledger, parksMap, eventMap, mergedMap, wantDisp, attnCheck, custodyMap] of DISPOSITION_SELFTEST_CASES) {
    let ok = true;
    let detail = "";
    try {
      const report = computeDisposition(ledger, parksMap, eventMap, mergedMap, undefined, custodyMap);
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
  readCustodyMap, readIssueOutcomeEvents, readMergedDetails, readMergedMap, readParksMap,
  renderDisposition,
};
