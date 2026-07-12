// ===========================================================================
// === region:governance — audit — FAFF-289: read-only run-reconstruction forensics view. Joins the three ===
// substrates a finished run leaves on disk — the timeline (events.jsonl), the
// final-state ledger (run-ledger.json), and per-issue intake proofs
// (.faff/provenance/<ISSUE>.json) — into one who/what/why reconstruction of a
// completed run. PURE (no tracker/network/LLM/live recompute), degrade-don't-crash:
// reconstructs from whatever substrates exist and REPORTS the gaps as coherence
// findings rather than erroring. Reuses readLedger + auditLedger verbatim; adds only
// the cross-substrate join + rendering. Coherence is reported, never gated (a readable
// run exits 0 even when incoherent). Sibling of `runcheck` / `events read`.
// ===========================================================================

// Load events.jsonl into records, noting malformed lines (never throws on a bad line).

const fs = require("node:fs");
const path = require("node:path");
const { auditLedger } = require("./runcheck");
const { findRoot, readLedger } = require("./shared-infra");

function readEvents(runDir) {
  const p = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(p)) return { present: false, records: [], malformed: [] };
  const raw = fs.readFileSync(p, "utf8");
  const records = [];
  const malformed = [];
  raw.split("\n").forEach((line, idx) => {
    if (line.trim() === "") return;
    try { records.push(JSON.parse(line)); }
    catch { malformed.push(idx + 1); }
  });
  return { present: true, records, malformed };
}

// Read + flatten one issue's intake-provenance marker (schema 2: {intake:{via,ts,reason?},initiated?}).
// Absent / unreadable / malformed ⇒ {absent:true} (legacy or never-stamped — not an error).
function readProvenance(root, issue) {
  const p = path.join(root, ".faff", "provenance", `${issue}.json`);
  if (!fs.existsSync(p)) return { absent: true };
  let d;
  try { d = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return { absent: true }; }
  if (d === null || typeof d !== "object" || Array.isArray(d)) return { absent: true };
  const intake = d.intake && typeof d.intake === "object" ? d.intake : {};
  const out = {};
  if (intake.via !== undefined) out.via = intake.via;
  if (intake.ts !== undefined) out.ts = intake.ts;
  if (intake.reason !== undefined) out.reason = intake.reason;
  if (d.initiated !== undefined) out.initiated = d.initiated;
  return out;
}

// Pure join: build the Reconstruction from already-loaded substrates. No filesystem —
// the wrapper reads events/ledger/provenance and hands them in, so the selftest drives
// this directly. `eventsResult` = {present, records, malformed}; `ledger` = parsed object
// or null; `provenanceMap` = { issue: provenanceObject }.
function buildReconstruction(runId, runDir, eventsResult, ledger, provenanceMap) {
  const events = eventsResult.records;
  const missing_substrates = [];
  if (!eventsResult.present) missing_substrates.push("events");
  if (!ledger) missing_substrates.push("ledger");

  // lifecycle: run-start/run-end events, falling back to ledger.owner for started_at.
  const runStart = events.find((e) => e.type === "run-start");
  const runEnd = events.find((e) => e.type === "run-end");
  const owner = ledger && ledger.owner ? ledger.owner : null;
  const started_at = (runStart && runStart.ts) || (owner && owner.started_at) || null;
  const ended_at = (runEnd && runEnd.ts) || null;
  let duration_secs = null;
  if (started_at && ended_at) {
    const a = Date.parse(started_at), b = Date.parse(ended_at);
    if (Number.isFinite(a) && Number.isFinite(b)) duration_secs = Math.round((b - a) / 1000);
  }
  const phases_seen = [];
  for (const e of events) if (e.phase && !phases_seen.includes(e.phase)) phases_seen.push(e.phase);
  const lifecycle = { started_at, ended_at, duration_secs, complete: !!runEnd, phases_seen, owner };

  // issue set: union of ledger.admitted + issues appearing in events (sorted, deterministic).
  const admitted = ledger && Array.isArray(ledger.admitted) ? ledger.admitted : [];
  const eventIssues = events.filter((e) => e.issue).map((e) => e.issue);
  const issueSet = [...new Set([...admitted, ...eventIssues])].sort();

  const outcomes = ledger && ledger.outcomes && typeof ledger.outcomes === "object" && !Array.isArray(ledger.outcomes)
    ? ledger.outcomes : {};

  const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);
  const issues = issueSet.map((issue) => {
    const evs = events.filter((e) => e.issue === issue).sort(bySeq)
      .map((e) => { const r = { seq: e.seq, ts: e.ts, phase: e.phase, type: e.type }; if (e.data !== undefined) r.data = e.data; return r; });
    const parkEvents = events.filter((e) => e.issue === issue && e.type === "park").sort(bySeq);
    const lastPark = parkEvents.length ? parkEvents[parkEvents.length - 1] : null;
    const park_cause = lastPark && lastPark.data && typeof lastPark.data === "object"
      ? (lastPark.data.cause ?? lastPark.data.reason ?? null) : null;
    return {
      issue,
      provenance: (provenanceMap && provenanceMap[issue]) || { absent: true },
      events: evs,
      outcome: issue in outcomes ? outcomes[issue] : null,
      park_cause,
    };
  });

  // budget: ledger envelope + tokens_at_start + budget-checkpoint events (never recomputed).
  const bl = ledger && ledger.budget && typeof ledger.budget === "object" ? ledger.budget : null;
  const checkpoints = events.filter((e) => e.type === "budget-checkpoint").sort(bySeq)
    .map((e) => ({ seq: e.seq, ts: e.ts, data: e.data }));
  const budget = {
    envelope: bl && bl.envelope !== undefined ? bl.envelope : null,
    tokens_at_start: bl && bl.tokens_at_start !== undefined ? bl.tokens_at_start : null,
    checkpoints,
  };

  // supervision (FAFF-352): sibling of the budget block, same shape — sentry-checkpoint
  // events (never live recompute) prove a `faff sentry check` consult ran at every
  // between-units checkpoint. last_intervention is the LAST checkpoint's (seq order)
  // data.intervention, or null when there are no checkpoints at all (a legacy run, or
  // one where the bridge never fired) — that null is the honest reading, not a gap.
  const supervisionCheckpoints = events.filter((e) => e.type === "sentry-checkpoint").sort(bySeq)
    .map((e) => ({ seq: e.seq, ts: e.ts, data: e.data }));
  const lastCheckpoint = supervisionCheckpoints.length ? supervisionCheckpoints[supervisionCheckpoints.length - 1] : null;
  const supervision = {
    checkpoints: supervisionCheckpoints,
    last_intervention: (lastCheckpoint && lastCheckpoint.data && typeof lastCheckpoint.data === "object")
      ? (lastCheckpoint.data.intervention ?? null) : null,
  };

  // coherence: reuse auditLedger for undispatched/invalid, add cross-substrate checks.
  let undispatched = [], invalid_outcomes = [];
  if (ledger) {
    try {
      const a = auditLedger(ledger, runId);
      undispatched = a.undispatched;
      invalid_outcomes = a.invalid_outcomes.map((s) => {
        const i = s.indexOf("=");
        return { issue: s.slice(0, i), outcome: s.slice(i + 1) };
      });
    } catch { /* malformed outcomes → surfaced via missing/empty; clean flips below */ }
  }
  const mismatches = [];
  for (const issue of issueSet) {
    const ledgerOutcome = issue in outcomes ? outcomes[issue] : null;
    const outcomeEvents = events.filter((e) => e.issue === issue && e.type === "issue-outcome").sort(bySeq);
    const last = outcomeEvents.length ? outcomeEvents[outcomeEvents.length - 1] : null;
    const eventOutcome = last && last.data && typeof last.data === "object" ? (last.data.outcome ?? null) : null;
    if (ledgerOutcome !== null && eventOutcome !== null && ledgerOutcome !== eventOutcome) {
      mismatches.push({ issue, ledger_outcome: ledgerOutcome, event_outcome: eventOutcome });
    }
  }
  const malformed_event_lines = eventsResult.malformed || [];
  const coherence = {
    clean: undispatched.length === 0 && invalid_outcomes.length === 0 && mismatches.length === 0
      && missing_substrates.length === 0 && malformed_event_lines.length === 0,
    undispatched, invalid_outcomes, mismatches, missing_substrates,
  };
  if (malformed_event_lines.length) coherence.malformed_event_lines = malformed_event_lines;

  return {
    run_id: runId,
    run_dir: runDir,
    lifecycle,
    issues,
    budget,
    supervision,
    coherence,
    discovered_scope_filed: ledger && ledger.discovered_scope_filed !== undefined ? ledger.discovered_scope_filed : null,
  };
}

// Skimmable default text rendering — lists/tables, never run-on prose.
function renderAuditText(recon) {
  const L = recon.lifecycle;
  console.log(`run ${recon.run_id}`);
  console.log(`  dir:      ${recon.run_dir}`);
  const span = L.complete
    ? `${L.started_at ?? "?"} → ${L.ended_at ?? "?"}${L.duration_secs != null ? `  (${L.duration_secs}s)` : ""}`
    : `${L.started_at ?? "?"} → (incomplete / no clean end)`;
  console.log(`  span:     ${span}`);
  console.log(`  phases:   ${L.phases_seen.length ? L.phases_seen.join(", ") : "(none)"}`);
  if (L.owner) console.log(`  owner:    ${L.owner.status ?? "?"}${L.owner.session_id ? `  (${L.owner.session_id})` : ""}`);

  console.log(`issues (${recon.issues.length}):`);
  if (!recon.issues.length) {
    console.log("  (none)");
  } else {
    for (const r of recon.issues) {
      const prov = r.provenance.absent
        ? "provenance:absent"
        : `${r.provenance.via ?? "?"}${r.provenance.initiated ? `/${r.provenance.initiated}` : ""}`;
      const tail = r.park_cause ? `  [park: ${r.park_cause}]` : "";
      console.log(`  ${r.issue}  ${prov}  ${r.outcome ?? "(no outcome)"}${tail}  (${r.events.length} event${r.events.length === 1 ? "" : "s"})`);
    }
  }

  const ceilings = recon.budget.envelope && recon.budget.envelope.ceilings
    ? Object.keys(recon.budget.envelope.ceilings) : [];
  console.log(`budget:   ceilings ${ceilings.length ? ceilings.join(",") : "(none)"}  ·  ${recon.budget.checkpoints.length} checkpoint(s)`
    + (recon.budget.tokens_at_start != null ? `  ·  tokens_at_start ${recon.budget.tokens_at_start}` : ""));

  // FAFF-352: always render, mirroring the budget line — "0 checkpoint(s)" on a
  // pre-existing/legacy run is the honest reading ("no recorded supervision"), which
  // is exactly the visibility this block exists to create.
  console.log(`supervision: ${recon.supervision.checkpoints.length} checkpoint(s)  ·  last intervention: ${recon.supervision.last_intervention ?? "—"}`);

  const c = recon.coherence;
  if (c.clean) {
    console.log("coherence: clean");
  } else {
    console.log("coherence: findings");
    if (c.missing_substrates.length) console.log(`  missing substrates: ${c.missing_substrates.join(", ")}`);
    if (c.undispatched.length) console.log(`  undispatched: ${c.undispatched.join(", ")}`);
    if (c.invalid_outcomes.length) console.log(`  invalid outcomes: ${c.invalid_outcomes.map((x) => `${x.issue}=${x.outcome}`).join(", ")}`);
    if (c.mismatches.length) console.log(`  mismatches: ${c.mismatches.map((m) => `${m.issue} (ledger ${m.ledger_outcome} vs event ${m.event_outcome})`).join(", ")}`);
    if (c.malformed_event_lines && c.malformed_event_lines.length) console.log(`  malformed event lines: ${c.malformed_event_lines.join(", ")}`);
  }
}

function cmdAudit(args) {
  if (args.includes("--selftest")) return auditSelftest();
  let root = null, issue = null;
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i];
    else if (args[i] === "--issue") issue = args[++i];
    else rest.push(args[i]);
  }
  const json = rest.includes("--json");
  const runId = rest.find((a) => !a.startsWith("--"));
  if (!runId) { process.stderr.write("faff audit: <run-id> required\n"); return 2; }
  root = root || findRoot();
  const runDir = path.join(root, ".faff", "runs", runId);
  if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
    process.stderr.write(`faff audit: no run dir for ${runId}\n`); return 3;
  }
  const eventsResult = readEvents(runDir);
  let ledger = null;
  if (fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    try { ledger = readLedger(runDir); }
    catch { process.stderr.write(`faff audit: ${runId} has a malformed run-ledger.json\n`); return 1; }
  }
  if (!eventsResult.present && !ledger) {
    process.stderr.write(`faff audit: ${runId} has no events or ledger\n`); return 3;
  }

  const admitted = ledger && Array.isArray(ledger.admitted) ? ledger.admitted : [];
  const eventIssues = eventsResult.records.filter((e) => e && e.issue).map((e) => e.issue);
  const issueSet = [...new Set([...admitted, ...eventIssues])];
  const provenanceMap = {};
  for (const i of issueSet) provenanceMap[i] = readProvenance(root, i);

  const recon = buildReconstruction(runId, runDir, eventsResult, ledger, provenanceMap);

  if (issue) {
    const match = recon.issues.find((r) => r.issue === issue);
    if (!match) { process.stderr.write(`faff audit: ${runId} has no admitted or evented issue ${issue}\n`); return 3; }
    recon.issues = [match];
    recon.filtered_to = issue;
  }

  if (json) { console.log(JSON.stringify(recon)); return 0; }
  renderAuditText(recon);
  return 0;
}

// In-memory selftest of the pure join core (mirrors events/runcheck --selftest):
// drives buildReconstruction with fixture substrates, no filesystem I/O.
function auditSelftest() {
  let failed = 0;
  const check = (label, cond) => { if (!cond) { process.stderr.write(`audit --selftest FAIL: ${label}\n`); failed++; } };
  const evs = (records, malformed = []) => ({ present: true, records, malformed });

  // 1. Clean completed run: run-start → admit+outcome → run-end; matching ledger + provenance.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "2026-06-29T03:00:00Z", phase: "run", type: "run-start" },
      { schema: 1, run_id: "r", seq: 1, ts: "2026-06-29T03:01:00Z", phase: "build", type: "issue-admitted", issue: "FAFF-1" },
      { schema: 1, run_id: "r", seq: 2, ts: "2026-06-29T03:02:00Z", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
      { schema: 1, run_id: "r", seq: 3, ts: "2026-06-29T03:05:00Z", phase: "run", type: "run-end" },
    ];
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, discovered_scope_filed: 0,
      budget: { envelope: { ceilings: {} }, tokens_at_start: 100 } };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, { "FAFF-1": { via: "jot", initiated: "autonomous" } });
    check("clean: complete", rec.lifecycle.complete === true);
    check("clean: duration 300s", rec.lifecycle.duration_secs === 300);
    check("clean: phases run,build", rec.lifecycle.phases_seen.join(",") === "run,build");
    check("clean: one issue", rec.issues.length === 1 && rec.issues[0].issue === "FAFF-1");
    check("clean: provenance via", rec.issues[0].provenance.via === "jot" && rec.issues[0].provenance.initiated === "autonomous");
    check("clean: outcome shipped", rec.issues[0].outcome === "shipped");
    check("clean: issue events in seq order", rec.issues[0].events.map((e) => e.seq).join(",") === "1,2");
    check("clean: budget tokens", rec.budget.tokens_at_start === 100);
    check("clean: coherence clean", rec.coherence.clean === true);
    check("clean: discovered_scope_filed 0", rec.discovered_scope_filed === 0);
    // FAFF-352: N=0 supervision checkpoints (this fixture has none) → the honest
    // "no recorded supervision" reading, never omitted / never a crash on absence.
    check("clean: supervision N=0 checkpoints", rec.supervision.checkpoints.length === 0);
    check("clean: supervision N=0 last_intervention null", rec.supervision.last_intervention === null);
  }

  // 2. Undispatched: admitted with no outcome → unclean, listed.
  {
    const ledger = { run_id: "r", admitted: ["FAFF-1", "FAFF-2"], outcomes: { "FAFF-1": "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {});
    check("undispatched: listed", rec.coherence.undispatched.join(",") === "FAFF-2");
    check("undispatched: not clean", rec.coherence.clean === false);
    check("undispatched: FAFF-2 null outcome", rec.issues.find((r) => r.issue === "FAFF-2").outcome === null);
  }

  // 3. Invalid outcome: outcome not a terminal state → {issue,outcome} object.
  {
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "bogus" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {});
    check("invalid: one object", rec.coherence.invalid_outcomes.length === 1
      && rec.coherence.invalid_outcomes[0].issue === "FAFF-1" && rec.coherence.invalid_outcomes[0].outcome === "bogus");
    check("invalid: not clean", rec.coherence.clean === false);
  }

  // 4. Missing ledger: events present, ledger null → reconstruct, missing_substrates lists ledger.
  {
    const records = [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-9" }];
    const rec = buildReconstruction("r", "/d", evs(records), null, { "FAFF-9": { absent: true } });
    check("missing-ledger: lists ledger", rec.coherence.missing_substrates.join(",") === "ledger");
    check("missing-ledger: issue from events", rec.issues.length === 1 && rec.issues[0].issue === "FAFF-9");
    check("missing-ledger: not clean", rec.coherence.clean === false);
  }

  // 5. events↔ledger mismatch: last issue-outcome event disagrees with ledger.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
    ];
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "parked" } };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("mismatch: named", rec.coherence.mismatches.length === 1
      && rec.coherence.mismatches[0].issue === "FAFF-1"
      && rec.coherence.mismatches[0].ledger_outcome === "parked"
      && rec.coherence.mismatches[0].event_outcome === "shipped");
    check("mismatch: not clean", rec.coherence.clean === false);
  }

  // 6. No run-end: incomplete lifecycle, owner fallback for started_at.
  {
    const records = [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "build-start", issue: "FAFF-1" }];
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" }, owner: { status: "running", started_at: "2026-06-29T03:00:00Z" } };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("no-end: incomplete", rec.lifecycle.complete === false);
    check("no-end: ended null", rec.lifecycle.ended_at === null);
    check("no-end: duration null", rec.lifecycle.duration_secs === null);
    check("no-end: started from owner", rec.lifecycle.started_at === "2026-06-29T03:00:00Z");
  }

  // 7. Provenance absent: no marker for an issue → {absent:true}, not an error.
  {
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {});
    check("prov-absent: marked absent", rec.issues[0].provenance.absent === true);
  }

  // 8. Malformed events line → coherence finding, still reconstructs.
  {
    const rec = buildReconstruction("r", "/d", evs([], [3]), { run_id: "r", admitted: [], outcomes: {} }, {});
    check("malformed: noted", Array.isArray(rec.coherence.malformed_event_lines) && rec.coherence.malformed_event_lines[0] === 3);
    check("malformed: not clean", rec.coherence.clean === false);
  }

  // 9. Park cause surfaced from the issue's park event.
  {
    const records = [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "build", type: "park", issue: "FAFF-1", data: { cause: "needs-decision-first" } }];
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "parked" } };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("park: cause surfaced", rec.issues[0].park_cause === "needs-decision-first");
  }

  // 10. FAFF-352: N>0 sentry-checkpoint events → supervision.checkpoints in seq order,
  // last_intervention = the LAST checkpoint's data.intervention (not the max/worst).
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t0", phase: "run", type: "sentry-checkpoint", data: { intervention: "continue", tripped: false, verdicts: [] } },
      { schema: 1, run_id: "r", seq: 1, ts: "t1", phase: "build", type: "issue-outcome", issue: "FAFF-1", data: { outcome: "shipped" } },
      { schema: 1, run_id: "r", seq: 2, ts: "t2", phase: "run", type: "sentry-checkpoint", data: { intervention: "abort", tripped: true, verdicts: [{ signal: "budget-breach", severity: "trip", evidence: {} }] } },
    ];
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("supervision: N=2 checkpoints in seq order", rec.supervision.checkpoints.length === 2
      && rec.supervision.checkpoints[0].seq === 0 && rec.supervision.checkpoints[1].seq === 2);
    check("supervision: last_intervention is the LAST checkpoint's (seq order), not worst-of", rec.supervision.last_intervention === "abort");
    check("supervision: checkpoints carry the sentry payload verbatim under data", rec.supervision.checkpoints[1].data.tripped === true);
  }

  if (failed) { console.log(`RESULT: audit --selftest FAILED (${failed} failure(s))`); return 1; }
  console.log("RESULT: audit --selftest ok");
  return 0;
}


module.exports = { auditSelftest, buildReconstruction, cmdAudit, readEvents, readProvenance, renderAuditText };
