// ===========================================================================
// === region:factory — quality — FAFF-418: per-run quality/outcome telemetry (the mirror of economics). ===
// The quality half of the cost/quality loop. economics answers "what did this run
// cost?"; quality answers "how well did it go?" — park rate, rework rate, and the
// distribution of which gate caught a defect. PURE, read-only (parity with economics /
// budget check / runcheck): no tracker, no network, no LLM. It COMPOSES data faff
// already produces — the run ledger's terminal outcomes (authoritative) and the FAFF-35
// events.jsonl issue-outcome events' FAFF-418 gate/rework tags — into a QualityReport.
//
// PAIRS WITH economics BY CONSTRUCTION (ADR-0051): quality and economics are separate
// commands sharing the same run ledger, run_id, and the EXACT shipped/attempt
// denominators (ECONOMICS_BUCKET_ORDER + BUDGET_NON_ATTEMPT_OUTCOMES), so a `$/quality`
// read = economics.cost_per_shipped beside quality.park_rate on one run, and the two can
// never drift on how many builds a run attempted. No cost is duplicated into quality.
//
// NON-LEAK (parity with economics): outcome-names, gate-names, counts and rates only —
// never any finding, spec, or transcript payload.
// ===========================================================================

// Fixed render order for the gate-catch distribution (kept in step with the
// QUALITY_GATE_CATCHES validator vocab in the governance region).

const fs = require("node:fs");
const path = require("node:path");
const { BUDGET_NON_ATTEMPT_OUTCOMES } = require("./budget");
const { ECONOMICS_BUCKET_ORDER, readRunEvents } = require("./economics");
const { findRoot, latestRunDir, readLedger } = require("./shared-infra");

const QUALITY_GATE_ORDER = ["structural", "adversarial", "holdout", "ci"];

// PURE QualityReport core — no I/O. Given the run ledger (authoritative terminal
// outcomes) and the parsed events.jsonl record array (gate/rework detail), derive the
// full QualityReport. Run-level RATES (park_rate, rework_rate) use attempt_count
// (dispatched builds — the same exclusion economics' cost_per_attempt uses) as the
// denominator so the two reconcile; mean_turns averages over tagged_attempts (the
// population the report names). A 0 denominator yields null (never 0/0). gate_catch +
// rework derive from issue-outcome events and degrade cleanly to []/null when no
// events.jsonl exists.
function computeQualityReport(ledger, events, opts) {
  opts = opts || {};
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  const evs = Array.isArray(events) ? events : [];

  // Outcome buckets — ledger-authoritative, ECONOMICS_BUCKET_ORDER (shared with
  // economics so both agree on bucket ordering + which outcomes exist).
  const counts = new Map();
  for (const k of Object.keys(outcomes)) counts.set(outcomes[k], (counts.get(outcomes[k]) || 0) + 1);
  const ordered = ECONOMICS_BUCKET_ORDER.filter((b) => counts.has(b))
    .concat([...counts.keys()].filter((b) => !ECONOMICS_BUCKET_ORDER.includes(b)).sort());
  const buckets = ordered.map((b) => ({ bucket: b, count: counts.get(b) }));

  const shipped_count = counts.get("shipped") || 0;
  const parked_count = counts.get("parked") || 0;
  // attempt_count: dispatched builds — every recorded outcome EXCEPT the never-dispatched
  // ones (identical to economics' derivation, BUDGET_NON_ATTEMPT_OUTCOMES).
  let attempt_count = 0;
  for (const k of Object.keys(outcomes)) if (!BUDGET_NON_ATTEMPT_OUTCOMES.has(outcomes[k])) attempt_count++;
  const rate = (num) => attempt_count > 0 ? Number((num / attempt_count).toFixed(4)) : null;

  // Latest issue-outcome event per issue carries the FAFF-418 gate/rework tags.
  const latestByIssue = new Map();
  for (const ev of evs) {
    if (!ev || ev.type !== "issue-outcome" || ev.issue === undefined || ev.issue === null || ev.issue === "") continue;
    const prev = latestByIssue.get(ev.issue);
    // seq is the authoritative monotonic order; keep the highest-seq event for the
    // issue. Strictly greater: on a (malformed) reused seq the FIRST encountered
    // wins, so selection stays seq-deterministic rather than order-dependent.
    if (!prev || (Number.isInteger(ev.seq) && (!Number.isInteger(prev.seq) || ev.seq > prev.seq))) {
      latestByIssue.set(ev.issue, ev);
    }
  }
  const hasEvents = evs.length > 0;

  // gate-catch distribution — count issue-outcome events carrying a valid data.gate,
  // EXCLUDING issues the ledger says shipped: gate_catch is "which gate caught a
  // non-shipped build" (a caught-then-shipped build's gate tag stays visible in
  // per_issue, and its rework still counts in the rework rollup).
  const gateCounts = new Map();
  for (const ev of latestByIssue.values()) {
    if (outcomes[ev.issue] === "shipped") continue;
    const g = ev.data && typeof ev.data === "object" ? ev.data.gate : undefined;
    if (typeof g === "string" && QUALITY_GATE_ORDER.includes(g)) gateCounts.set(g, (gateCounts.get(g) || 0) + 1);
  }
  const gateOrdered = QUALITY_GATE_ORDER.filter((g) => gateCounts.has(g))
    .concat([...gateCounts.keys()].filter((g) => !QUALITY_GATE_ORDER.includes(g)).sort());
  const gate_catch = gateOrdered.map((g) => ({ gate: g, count: gateCounts.get(g) }));

  // rework rollup — over issue-outcome events carrying a data.rework_turns integer.
  let total_turns = 0, reworked_attempts = 0, tagged_attempts = 0;
  for (const ev of latestByIssue.values()) {
    const rt = ev.data && typeof ev.data === "object" ? ev.data.rework_turns : undefined;
    if (!Number.isInteger(rt) || rt < 0) continue;
    tagged_attempts++;
    total_turns += rt;
    if (rt > 0) reworked_attempts++;
  }
  const rework = hasEvents ? {
    total_turns,
    reworked_attempts,
    tagged_attempts,
    // rework_rate is over attempt_count (matching park_rate) so run-level rates
    // share one denominator; null when no build was dispatched. Its numerator is
    // event-derived, so when tags don't cover every attempt it is a LOWER BOUND —
    // the coverage warning below makes that explicit rather than silent.
    rework_rate: rate(reworked_attempts),
    // mean_turns is over tagged_attempts — the population whose size the report
    // states — so mean_turns * tagged_attempts reconstructs total_turns exactly;
    // null when no attempt carried a rework tag (never diluted by untagged builds).
    mean_turns: tagged_attempts > 0 ? Number((total_turns / tagged_attempts).toFixed(4)) : null,
  } : { total_turns: null, reworked_attempts: null, tagged_attempts: 0, rework_rate: null, mean_turns: null };

  // per_issue — ledger-authoritative outcome, enriched with the event's gate/rework.
  const per_issue = Object.keys(outcomes).sort().map((issue) => {
    const row = { issue, outcome: outcomes[issue] };
    const ev = latestByIssue.get(issue);
    const d = ev && ev.data && typeof ev.data === "object" ? ev.data : null;
    if (d && typeof d.gate === "string" && QUALITY_GATE_ORDER.includes(d.gate)) row.gate = d.gate;
    if (d && Number.isInteger(d.rework_turns) && d.rework_turns >= 0) row.rework_turns = d.rework_turns;
    return row;
  });

  const warnings = [];
  if (shipped_count === 0 && attempt_count > 0) warnings.push("zero shipped across " + attempt_count + " attempt(s)");
  // Coverage honesty: rework tags are event-derived while attempt_count is
  // ledger-derived; when tags don't cover every attempt, rework_rate understates.
  if (hasEvents && attempt_count > 0 && tagged_attempts < attempt_count) {
    warnings.push(`rework tags cover ${tagged_attempts} of ${attempt_count} attempt(s) — rework_rate is a lower bound`);
  }

  return {
    run_id: (ledger && typeof ledger.run_id === "string" && ledger.run_id) || opts.run_id || null,
    outcomes: buckets,
    shipped_count,
    attempt_count,
    parked_count,
    park_rate: rate(parked_count),
    rework,
    gate_catch,
    per_issue,
    source: hasEvents ? "ledger+events" : "ledger",
    warnings,
  };
}

// Render a QualityReport as a skimmable text table (the human default; --json emits
// the object). Rates print as percentages; null (no dispatched builds / no events)
// prints as an em dash so "couldn't compute" is never mistaken for 0%.
function renderQualityReport(q) {
  const pct = (r) => (r == null ? "—" : (r * 100).toFixed(1) + "%");
  const lines = [];
  lines.push(`# quality ${q.run_id || ""}  (source: ${q.source})`);
  lines.push(`  shipped=${q.shipped_count}  attempts=${q.attempt_count}  parked=${q.parked_count}  park_rate=${pct(q.park_rate)}`);
  const rw = q.rework;
  if (rw.total_turns == null) {
    lines.push(`  rework: — (no events.jsonl for this run)`);
  } else {
    lines.push(`  rework: turns=${rw.total_turns}  reworked=${rw.reworked_attempts}/${rw.tagged_attempts}  rework_rate=${pct(rw.rework_rate)}  mean_turns=${rw.mean_turns == null ? "—" : rw.mean_turns}`);
  }
  lines.push(`  outcomes: ${q.outcomes.length ? q.outcomes.map((b) => `${b.bucket}=${b.count}`).join("  ") : "(none)"}`);
  lines.push(`  gate-catch: ${q.gate_catch.length ? q.gate_catch.map((g) => `${g.gate}=${g.count}`).join("  ") : "(none)"}`);
  for (const w of q.warnings) lines.push(`  ! ${w}`);
  return lines.join("\n");
}

function cmdQuality(args) {
  if (args.includes("--selftest")) return qualitySelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();

  // Resolve the run dir exactly as economics/budget check do.
  let runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || null;
  if (runDir && !fs.existsSync(path.join(runDir, "run-ledger.json"))) runDir = null;
  if (!runDir) runDir = latestRunDir(root);
  if (!runDir) { process.stderr.write("faff quality: no run dir (pass --run-dir DIR)\n"); return 2; }

  let ledger;
  try { ledger = readLedger(runDir); }
  catch { process.stderr.write(`faff quality: cannot read ${path.join(runDir, "run-ledger.json")}\n`); return 2; }

  const { events } = readRunEvents(runDir);
  const q = computeQualityReport(ledger, events, { run_id: path.basename(runDir) });

  if (args.includes("--json")) { console.log(JSON.stringify(q)); return 0; }
  console.log(renderQualityReport(q));
  return 0;
}

// Selftest — drives the pure core (computeQualityReport) over in-memory ledgers +
// event arrays; no filesystem, no tracker. Covers: attempt/shipped/park derivation
// shared with economics, the attempt_count exclusion, park/rework rates + null on a
// zero-attempt run, gate-catch distribution, ledger-only degradation, and per_issue
// enrichment.
function qualitySelftest() {
  let fail = 0;
  const ok = (label, cond) => { if (!cond) { fail++; process.stderr.write(`quality --selftest FAIL: ${label}\n`); } };

  const ledger = {
    run_id: "r1",
    outcomes: {
      "FAFF-1": "shipped", "FAFF-2": "shipped", "FAFF-3": "parked",
      "FAFF-4": "errored", "FAFF-5": "routed-out", "FAFF-6": "unreached-budget",
    },
  };
  const events = [
    { type: "issue-outcome", issue: "FAFF-1", seq: 5, data: { outcome: "shipped", rework_turns: 0 } },
    { type: "issue-outcome", issue: "FAFF-2", seq: 6, data: { outcome: "shipped", rework_turns: 2 } },
    { type: "issue-outcome", issue: "FAFF-3", seq: 7, data: { outcome: "parked", gate: "adversarial", rework_turns: 1 } },
    { type: "issue-outcome", issue: "FAFF-4", seq: 8, data: { outcome: "errored", gate: "ci" } },
    { type: "build-start", issue: "FAFF-1", seq: 1, data: {} }, // non-outcome events ignored
  ];
  const q = computeQualityReport(ledger, events, { run_id: "r1" });

  ok("run_id from ledger", q.run_id === "r1");
  ok("shipped_count", q.shipped_count === 2);
  // 6 outcomes minus routed-out + unreached-budget (2 non-attempts) = 4 attempts.
  ok("attempt_count excludes routed-out/unreached-budget", q.attempt_count === 4);
  ok("parked_count", q.parked_count === 1);
  ok("park_rate = 1/4", q.park_rate === 0.25);
  ok("source ledger+events", q.source === "ledger+events");
  ok("rework total_turns (0+2+1)", q.rework.total_turns === 3);
  ok("reworked_attempts (turns>0: FAFF-2, FAFF-3)", q.rework.reworked_attempts === 2);
  ok("tagged_attempts (rework_turns present: FAFF-1/2/3)", q.rework.tagged_attempts === 3);
  ok("rework_rate = 2/4 attempts", q.rework.rework_rate === 0.5);
  ok("mean_turns = 3/3 tagged (not diluted by the untagged FAFF-4)", q.rework.mean_turns === 1);
  ok("gate_catch fixed order (adversarial before ci)",
    q.gate_catch.length === 2 && q.gate_catch[0].gate === "adversarial" && q.gate_catch[1].gate === "ci");
  ok("outcomes bucket count matches ledger",
    q.outcomes.find((b) => b.bucket === "shipped").count === 2 && q.outcomes.find((b) => b.bucket === "parked").count === 1);
  const pi3 = q.per_issue.find((r) => r.issue === "FAFF-3");
  ok("per_issue enriched with gate + rework", pi3 && pi3.outcome === "parked" && pi3.gate === "adversarial" && pi3.rework_turns === 1);
  const pi5 = q.per_issue.find((r) => r.issue === "FAFF-5");
  ok("per_issue includes a never-dispatched outcome, unenriched", pi5 && pi5.outcome === "routed-out" && pi5.gate === undefined);
  // Tags cover 3 of 4 attempts (FAFF-4 has no rework_turns) → coverage warning,
  // and no zero-ship warning since 2 shipped.
  ok("rework-coverage warning fires (3 of 4 attempts tagged)",
    q.warnings.length === 1 && q.warnings[0].includes("rework tags cover 3 of 4"));

  // Ledger-only degradation (no events) — outcome buckets still render, gate/rework null.
  const qLedger = computeQualityReport(ledger, [], { run_id: "r1" });
  ok("ledger-only source", qLedger.source === "ledger");
  ok("ledger-only gate_catch empty", qLedger.gate_catch.length === 0);
  ok("ledger-only rework nulled", qLedger.rework.total_turns === null && qLedger.rework.rework_rate === null);
  ok("ledger-only still has outcome buckets + attempt_count", qLedger.attempt_count === 4 && qLedger.outcomes.length > 0);

  // Zero-attempt run (only never-dispatched outcomes) → rates null, not 0/0.
  const qZero = computeQualityReport({ run_id: "r0", outcomes: { "FAFF-9": "routed-out" } }, []);
  ok("zero-attempt park_rate null", qZero.park_rate === null && qZero.attempt_count === 0);
  ok("zero-attempt rework rates null", qZero.rework.rework_rate === null && qZero.rework.mean_turns === null);

  // Empty ledger → all-empty, no crash.
  const qEmpty = computeQualityReport({}, []);
  ok("empty ledger clean", qEmpty.attempt_count === 0 && qEmpty.outcomes.length === 0 && qEmpty.warnings.length === 0);

  // zero-ship-but-attempted warning fires.
  const qNoShip = computeQualityReport({ run_id: "r", outcomes: { "FAFF-1": "parked", "FAFF-2": "errored" } }, []);
  ok("zero-ship warning fires on attempted-but-none-shipped", qNoShip.warnings.length === 1 && qNoShip.shipped_count === 0);

  // A gate tag on a caught-then-SHIPPED build stays out of gate_catch (the spec's
  // "caught a non-shipped build"), but its rework still counts and full tag
  // coverage means no coverage warning.
  const qShipGate = computeQualityReport(
    { run_id: "r2", outcomes: { "FAFF-7": "shipped" } },
    [{ type: "issue-outcome", issue: "FAFF-7", seq: 1, data: { outcome: "shipped", gate: "ci", rework_turns: 1 } }]
  );
  ok("gate on a shipped build excluded from gate_catch", qShipGate.gate_catch.length === 0);
  ok("rework on a shipped build still counted", qShipGate.rework.reworked_attempts === 1 && qShipGate.rework.mean_turns === 1);
  ok("full tag coverage → no coverage warning", qShipGate.warnings.length === 0);

  // A (malformed) reused seq keeps the FIRST event — selection is seq-deterministic,
  // not encounter-order-dependent.
  const qDup = computeQualityReport(
    { run_id: "r3", outcomes: { "FAFF-8": "parked" } },
    [
      { type: "issue-outcome", issue: "FAFF-8", seq: 1, data: { outcome: "parked", gate: "ci" } },
      { type: "issue-outcome", issue: "FAFF-8", seq: 1, data: { outcome: "parked", gate: "holdout" } },
    ]
  );
  ok("equal-seq duplicate keeps the first event", qDup.gate_catch.length === 1 && qDup.gate_catch[0].gate === "ci");

  // Render smoke — must not throw and must name the run.
  const rendered = renderQualityReport(q);
  ok("render names run + park_rate", rendered.includes("quality r1") && rendered.includes("park_rate=25.0%"));

  console.log(`quality --selftest: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { QUALITY_GATE_ORDER, cmdQuality, computeQualityReport, qualitySelftest, renderQualityReport };
