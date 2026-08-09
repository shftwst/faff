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
// FAFF-673: the PR-path human-merge landing check reuses the SAME escape core `faff effects check`
// uses (governance→governance import; the require-graph invariant only forbids governance→factory).
const { computeEscapes } = require("./effects");
const { parseArgs, usageError } = require("./argv");
const AUDIT_SPEC = { flags: { "--selftest": { arity: 0 }, "--json": { arity: 0 }, "--root": { arity: 1 }, "--issue": { arity: 1 } }, positionals: { min: 0, max: 1, name: "run-id" } };
// FAFF-354: the containment recompute reads the SAME pure primitives `contain`
// computed the original verdict with — sourced from shared-infra (not contain.js
// directly), since governance (this file) may reference shared-infra only, never a
// factory module like contain.js (ADR 0042; `faff regions check` enforces this).
const { CONTAIN_ROOT, decideSelfIntake, findRoot, parseAncestry, readLedger, subtreeContains } = require("./shared-infra");
// FAFF-700: the dispatch-observability recompute reads the SAME child-transcript
// primitives budget.js's own attribution walk uses (transcriptBaseDir/
// childOwningSession — the FAFF-229 ownership gate). budget.js is governance, same
// as this file, so this is a same-region reference (never governance→factory).
const { childOwningSession, transcriptBaseDir } = require("./budget");

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

// FAFF-673: account for a sanctioned human non-graft merge from its three substrates — the extended
// merge-gate-override.json (`overrideRec`), the per-issue merge-record.json (`mergeRecord`), and the
// run's declared-effects entries (`effectsEntries`). PURE. Returns null (no accounting) when no
// override exists for the issue; otherwise a HumanMergeAccounting record. The landing check is
// PATH-AWARE (spec §1 PR/local observe asymmetry): a PR-path override (pr present) requires the merge
// observe to be COVERED (not an escaped side-effect), evidenced via the same computeEscapes core; a
// local-path override (no pr, no observe emitted) is evidenced by merge-record.json alone. `accounted_for`
// additionally requires a non-empty reason AND a covering merge declaration — a present-but-incomplete
// record is the `human_merge_unexplained` finding the caller raises (fail-closed: a dangling override,
// a missing declaration, or an empty reason all read as unexplained, never silently clean).
function accountHumanMerge(issue, overrideRec, mergeRecord, effectsEntries) {
  if (!overrideRec || typeof overrideRec !== "object") return null;
  const entries = Array.isArray(effectsEntries) ? effectsEntries : [];
  const declare_present = entries.some((e) =>
    e && e.issue === issue && e.step === "merge" && e.kind_of_entry === "declare"
    && e.effect && e.effect.kind === "merge");
  const merged = !!(mergeRecord && typeof mergeRecord === "object" && mergeRecord.merged === true);
  const prPath = overrideRec.pr !== undefined && overrideRec.pr !== null;
  let landing_covered;
  if (prPath) {
    // PR path: the merge observe must be covered by a declaration — an uncovered/escaped merge observe
    // is exactly the orphaned "escaped side-effect" this ticket forbids. Keyed on the same (issue, step
    // "merge") escape the effects ledger computes.
    const escapes = computeEscapes(entries, issue).escapes;
    const mergeEscaped = escapes.some((x) => x.step === "merge" && (x.escaped || []).some((k) => k && k.kind === "merge"));
    landing_covered = merged && !mergeEscaped;
  } else {
    // Local path: cmdMergeGateLocal emits NO merge observe (spec §1) — merge-record.json IS the landing.
    landing_covered = merged;
  }
  const reason_present = typeof overrideRec.reason === "string" && overrideRec.reason.trim() !== "";
  const accounted_for = reason_present && declare_present && landing_covered;
  return { present: true, reason: reason_present ? overrideRec.reason : null, reason_present, declare_present, landing_covered, accounted_for };
}

// FAFF-700: the ONE per-cluster stamp token this recompute matches — EXACT, never
// substring (a cluster "R1" must never cross-count a child stamped "R12" or a UUID
// that happens to start with "R1"). Anchored on non-whitespace id-safe characters
// only (cluster ids are fresh-minted tokens, never containing the delimiter or
// whitespace — the FAFF-700 spec's constraint on cluster_id), so a match's captured
// group is always the FULL id, never a truncated prefix.
const DISPATCH_STAMP_RE = /subagent-cluster:([A-Za-z0-9_-]+)/g;

// FAFF-700: read this run's OWNED child transcripts' cluster-id stamps (I/O; kept
// OUT of the pure classification core below, same split as readEvents/readProvenance
// vs buildReconstruction — so the classification stays selftest-driven with fixture
// substrates, never a live disk read). Reads via the SAME session-ownership gate
// budget.js's own per-issue attribution uses (childOwningSession === sid, FAFF-229 —
// never mtime). Returns { reachable, children }: reachable is false when the
// transcript base dir / session id is unavailable (substrate absent — the recompute
// can attribute nothing); otherwise `children` holds one array of cluster-id tokens
// per DISTINCT owned child transcript (a child stamped with no cluster id
// contributes an empty array — it matches nothing, never inflating a count; a
// missing/unparseable sibling meta.json degrades the same way, undercount never
// overcount, mirroring attributePerIssueCosts's own skip-silently posture).
function readDispatchSubstrate(cwd, env) {
  const sid = env && env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return { reachable: false, children: [] };
  const base = transcriptBaseDir(cwd, env);
  if (!fs.existsSync(base)) return { reachable: false, children: [] };
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return { reachable: false, children: [] }; }
  const children = [];
  for (const name of entries) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const f = path.join(base, name);
    if (childOwningSession(f) !== sid) continue; // this run's owned children only (FAFF-229)
    let desc = "";
    try {
      const meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      if (meta && typeof meta.description === "string") desc = meta.description;
    } catch { /* missing/unparseable meta — this child carries no attributable id */ }
    const ids = [...desc.matchAll(DISPATCH_STAMP_RE)].map((m) => m[1]);
    children.push(ids);
  }
  return { reachable: true, children };
}

// FAFF-700: pure per-cluster classification core — the audit "record a claim,
// re-derive it" pattern, sibling of the containment/self-intake recomputes below.
// `dispatchEvents` = already-filtered well-formed `type === "agent-dispatch"`
// records (a malformed line is already diverted to malformed_event_lines by the
// events read, same as every other type here — this never sees one).
// `substrate` = { reachable, children } from readDispatchSubstrate — I/O the caller
// already did, never re-read here, so this function is selftest-driven like the
// rest of the file. See the spec's Appendix A for the full classification table.
function computeDispatchObservability(dispatchEvents, substrate) {
  if (!dispatchEvents.length) return { status: "absent", substrate_reachable: null, clusters: [] };

  // Group by cluster_id: two dispatches sharing an id are a re-dispatch after a
  // partial fan-out — claimed sums, never overwrites.
  const byId = new Map();
  for (const e of dispatchEvents) {
    const d = e.data && typeof e.data === "object" && !Array.isArray(e.data) ? e.data : {};
    const id = d.cluster_id;
    if (typeof id !== "string" || !id) continue; // defensive — events.js already validates this at append time
    const size = Number.isInteger(d.cluster_size) ? d.cluster_size : 0;
    if (!byId.has(id)) byId.set(id, { cluster_id: id, kind: d.kind, claimed: 0 });
    byId.get(id).claimed += size;
  }
  const grouped = [...byId.values()];

  if (!substrate.reachable) {
    const clusters = grouped.map((c) => ({ cluster_id: c.cluster_id, kind: c.kind, claimed: c.claimed, observed: null, status: "unverifiable-substrate" }));
    return { status: "unverifiable-substrate", substrate_reachable: false, clusters };
  }

  const clusters = grouped.map((c) => {
    // Distinct-by-child count of owned children whose stamped ids include this
    // EXACT cluster_id (never a substring match — see DISPATCH_STAMP_RE above).
    const rawObserved = substrate.children.filter((ids) => ids.includes(c.cluster_id)).length;
    if (rawObserved === 0) return { cluster_id: c.cluster_id, kind: c.kind, claimed: c.claimed, observed: null, status: "unverifiable-substrate" };
    const status = rawObserved >= c.claimed ? "verified" : "mismatch";
    return { cluster_id: c.cluster_id, kind: c.kind, claimed: c.claimed, observed: rawObserved, status };
  });

  let overall;
  if (clusters.every((c) => c.status === "verified")) overall = "verified";
  else if (clusters.some((c) => c.status === "mismatch")) overall = "mismatch";
  else overall = "unverifiable-substrate";
  return { status: overall, substrate_reachable: true, clusters };
}

// Pure join: build the Reconstruction from already-loaded substrates. No filesystem —
// the wrapper reads events/ledger/provenance and hands them in, so the selftest drives
// this directly. `eventsResult` = {present, records, malformed}; `ledger` = parsed object
// or null; `provenanceMap` = { issue: provenanceObject }. FAFF-673: `humanMerge` = { overrides:{issue:rec},
// mergeRecords:{issue:rec}, effectsEntries:[…] } — the substrates for the human-merge accounting; an
// omitted/empty object means no override read (byte-for-byte the pre-FAFF-673 reconstruction).
// FAFF-700: `dispatchSubstrate` (optional — defaults to unreachable/no-children so every pre-existing
// call site, including the selftest fixtures below, is unaffected byte-for-byte) = the
// readDispatchSubstrate() result the wrapper already read.
function buildReconstruction(runId, runDir, eventsResult, ledger, provenanceMap, humanMerge = {}, dispatchSubstrate = { reachable: false, children: [] }) {
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

  // FAFF-673: the human-merge substrates the wrapper handed in (mirrors provenanceMap).
  const hmOverrides = (humanMerge && humanMerge.overrides) || {};
  const hmMergeRecords = (humanMerge && humanMerge.mergeRecords) || {};
  const hmEffects = (humanMerge && Array.isArray(humanMerge.effectsEntries)) ? humanMerge.effectsEntries : [];
  const human_merge_unexplained = [];

  const bySeq = (a, b) => (a.seq ?? 0) - (b.seq ?? 0);
  const issues = issueSet.map((issue) => {
    const evs = events.filter((e) => e.issue === issue).sort(bySeq)
      .map((e) => { const r = { seq: e.seq, ts: e.ts, phase: e.phase, type: e.type }; if (e.data !== undefined) r.data = e.data; return r; });
    const parkEvents = events.filter((e) => e.issue === issue && e.type === "park").sort(bySeq);
    const lastPark = parkEvents.length ? parkEvents[parkEvents.length - 1] : null;
    const park_cause = lastPark && lastPark.data && typeof lastPark.data === "object"
      ? (lastPark.data.cause ?? lastPark.data.reason ?? null) : null;
    const entry = {
      issue,
      provenance: (provenanceMap && provenanceMap[issue]) || { absent: true },
      events: evs,
      outcome: issue in outcomes ? outcomes[issue] : null,
      park_cause,
    };
    // FAFF-673: attach the human-merge accounting when this issue has an override record. An
    // accounted-for merge is an explicit reconstruction line, not a coherence finding; a present
    // but not-accounted-for merge (empty reason / no declaration / uncovered-or-absent landing) is
    // the `human_merge_unexplained` finding — the orphaned-evidence the operator ruled out.
    const hm = accountHumanMerge(issue, hmOverrides[issue] || null, hmMergeRecords[issue] || null, hmEffects);
    if (hm) {
      entry.human_merge = hm;
      if (!hm.accounted_for) {
        human_merge_unexplained.push({ issue, reason_present: hm.reason_present, declare_present: hm.declare_present, landing_covered: hm.landing_covered });
      }
    }
    return entry;
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

  // FAFF-354: recompute every recorded `faff contain --record` invocation with the
  // SAME parseAncestry + subtreeContains functions that produced it (same binary —
  // no drift possible), and compare. A mismatch means the recorded line was
  // tampered with or written by something else — never a natural product of this
  // walk. Detective control only: an internally-consistent fabrication (the agent
  // supplies a false-but-well-formed chain AND records exactly what it walked)
  // recomputes clean — the trust this closes is "does the record match what the
  // agent claims it walked", not "is the ancestry true".
  const containment_mismatches = [];
  for (const e of events) {
    if (e.type !== "containment-check") continue;
    const d = e.data && typeof e.data === "object" ? e.data : {};
    let recomputed;
    if (d.ancestry_raw === null || d.ancestry_raw === undefined) {
      recomputed = subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, new Map());
    } else {
      let entryOf;
      try { entryOf = parseAncestry(d.ancestry_raw); }
      catch { containment_mismatches.push({ seq: e.seq, issue: e.issue, recorded: d.verdict, recomputed: "unreproducible" }); continue; }
      recomputed = subtreeContains(d.mandate, d.root ? CONTAIN_ROOT : d.parent, entryOf);
    }
    if (recomputed !== d.verdict) {
      containment_mismatches.push({ seq: e.seq, issue: e.issue, recorded: d.verdict, recomputed });
    }
  }

  // FAFF-539: recompute every recorded `faff self-intake --record` invocation with
  // the SAME pure comparator (decideSelfIntake, shared-infra) that produced it, from
  // the recorded target_raw + recorded self SNAPSHOT (hermetic — config may
  // legitimately change after the run; the detective question is "was the verdict
  // computed honestly from what it claims it saw", not "would it compute the same
  // today"). A {verdict, reason} disagreement is a coherence finding, the
  // containment-mismatch sibling. Same trust boundary as containment: the target is
  // agent-fetched, so an internally-consistent fabrication recomputes clean — this
  // catches tampered/foreign records, never an untrue-but-well-formed target.
  const self_intake_mismatches = [];
  for (const e of events) {
    if (e.type !== "self-intake-check") continue;
    const d = e.data && typeof e.data === "object" ? e.data : {};
    let targetParsed;
    try { targetParsed = JSON.parse(d.target_raw); }
    catch { self_intake_mismatches.push({ seq: e.seq, issue: e.issue, recorded: d.verdict, recomputed: "unreproducible" }); continue; }
    const re = decideSelfIntake(targetParsed, d.self);
    if (re.verdict !== d.verdict || re.reason !== d.reason) {
      self_intake_mismatches.push({ seq: e.seq, issue: e.issue, recorded: d.verdict, recorded_reason: d.reason, recomputed: re.verdict, recomputed_reason: re.reason });
    }
  }

  // FAFF-354: a run whose ledger shows filed discovered-scope tickets but whose
  // timeline holds NO containment-check events at all — the create chokepoint was
  // never recorded (skipped `--record`, or `contain` skipped entirely). This only
  // catches the beep-boop step-10 ledger-counted path; a record-less tidy
  // chain-gap create carries no ledger counter and is invisible here (named v1
  // limitation — see the spec's HOW → limitations).
  const discoveredScopeFiled = ledger && typeof ledger.discovered_scope_filed === "number" ? ledger.discovered_scope_filed : 0;
  const hasContainmentChecks = events.some((e) => e.type === "containment-check");
  const unrecorded_creates = discoveredScopeFiled > 0 && !hasContainmentChecks;

  // FAFF-700: the dispatch-observability recompute — a claim (agent-dispatch events)
  // re-derived against the child transcripts this run owns. Deliberately NOT folded
  // into `coherence.clean`: `absent` (no fan-out claimed) and `unverifiable-substrate`
  // (can't attribute — a different substrate, an unreached transcript dir) are both
  // honest non-failures per the spec's design principle ("a can't-tell is a first-class
  // outcome, distinct from both verified and mismatch") — coherence.clean stays reserved
  // for an actual cross-substrate DISAGREEMENT, which this block reports but does not gate.
  const dispatch_observability = computeDispatchObservability(events.filter((e) => e.type === "agent-dispatch"), dispatchSubstrate);

  const coherence = {
    clean: undispatched.length === 0 && invalid_outcomes.length === 0 && mismatches.length === 0
      && missing_substrates.length === 0 && malformed_event_lines.length === 0
      && containment_mismatches.length === 0 && self_intake_mismatches.length === 0
      && !unrecorded_creates && human_merge_unexplained.length === 0,
    undispatched, invalid_outcomes, mismatches, missing_substrates,
    containment_mismatches, self_intake_mismatches, unrecorded_creates,
    human_merge_unexplained,
    dispatch_observability,
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
      // FAFF-673: an accounted-for human-merge is EXPLAINED on the audit, not flagged — one line,
      // never a coherence finding. The unexplained case surfaces below under coherence findings.
      if (r.human_merge && r.human_merge.accounted_for) {
        console.log(`    human-merge: accounted-for (reason: ${r.human_merge.reason})`);
      }
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

  // FAFF-700: always rendered (mirrors the supervision line above) — dispatch
  // observability is reported unconditionally, not folded into coherence findings.
  const dobs = recon.coherence.dispatch_observability;
  const clusterSummary = dobs.clusters.length
    ? `  ·  ${dobs.clusters.map((cl) => `${cl.cluster_id} (${cl.kind}) claimed ${cl.claimed} observed ${cl.observed ?? "—"} → ${cl.status}`).join(", ")}`
    : "";
  console.log(`dispatch: ${dobs.status}${dobs.substrate_reachable === false ? "  (substrate unreachable)" : ""}${clusterSummary}`);

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
    if (c.containment_mismatches && c.containment_mismatches.length) {
      console.log(`  containment mismatches: ${c.containment_mismatches.map((m) => `seq ${m.seq} (recorded ${m.recorded} vs recomputed ${m.recomputed})`).join(", ")}`);
    }
    if (c.self_intake_mismatches && c.self_intake_mismatches.length) {
      console.log(`  self-intake mismatches: ${c.self_intake_mismatches.map((m) => `seq ${m.seq} (recorded ${m.recorded} vs recomputed ${m.recomputed})`).join(", ")}`);
    }
    if (c.unrecorded_creates) {
      console.log(`  unrecorded creates: ledger filed ${recon.discovered_scope_filed ?? "?"} discovered-scope ticket(s), no containment-check events`);
    }
    if (c.human_merge_unexplained && c.human_merge_unexplained.length) {
      console.log(`  human-merge unexplained: ${c.human_merge_unexplained.map((m) => `${m.issue} (reason ${m.reason_present ? "ok" : "missing"}, declaration ${m.declare_present ? "ok" : "missing"}, landing ${m.landing_covered ? "ok" : "missing"})`).join(", ")}`);
    }
  }
}

function cmdAudit(args) {
  if (args.includes("--selftest")) return auditSelftest();
  const { values, positionals, errors } = parseArgs(args, AUDIT_SPEC);
  if (errors.length) return usageError(errors, "usage: faff audit <run-id> [--issue ID] [--json] [--root DIR]");
  const issue = values["--issue"] === undefined ? null : values["--issue"];
  const json = !!values["--json"];
  const runId = positionals[0];
  if (!runId) { process.stderr.write("faff audit: <run-id> required\n"); return 2; }
  const root = values["--root"] || findRoot();
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

  // FAFF-673: the human-merge substrates — per-issue merge-gate-override.json + merge-record.json,
  // and the run's declared-effects.jsonl once. All optional; absence just means no accounting for
  // that issue (a run with no human merge is byte-for-byte the pre-FAFF-673 reconstruction).
  const readJsonMaybe = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
  const overrides = {}, mergeRecords = {};
  for (const i of issueSet) {
    const o = readJsonMaybe(path.join(runDir, i, "merge-gate-override.json"));
    if (o) overrides[i] = o;
    const m = readJsonMaybe(path.join(runDir, i, "merge-record.json"));
    if (m) mergeRecords[i] = m;
  }
  let effectsEntries = [];
  const ledgerPath = path.join(runDir, "declared-effects.jsonl");
  if (fs.existsSync(ledgerPath)) {
    effectsEntries = fs.readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim() !== "")
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  const humanMerge = { overrides, mergeRecords, effectsEntries };

  // FAFF-700: keyed on the ambient CLAUDE_CODE_SESSION_ID, same as budget.js's own
  // attribution walk — a `verified` this produces is an observation-at-audit-time
  // (this session, this transcript dir), not a run-dir-pure fact (see the spec's
  // "What a verified result actually asserts" design decision).
  const dispatchSubstrate = readDispatchSubstrate(root, process.env);
  const recon = buildReconstruction(runId, runDir, eventsResult, ledger, provenanceMap, humanMerge, dispatchSubstrate);

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

  // 11. FAFF-354: a recorded containment-check event whose verdict agrees with the
  // recompute → no finding, coherence stays clean.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "contained", exit: 0 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {}, discovered_scope_filed: 0 };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("containment clean: no mismatch", rec.coherence.containment_mismatches.length === 0);
    check("containment clean: coherence stays clean", rec.coherence.clean === true);
  }

  // 12. FAFF-354: a recorded containment-check event whose verdict disagrees with the
  // recompute (a tampered/foreign line) → containment_mismatches names it, clean false.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 5, ts: "t", phase: "run", type: "containment-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: '[{"id":"FAFF-2","parentId":"FAFF-1"}]', verdict: "outward", exit: 3 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {} };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("containment mismatch: one finding", rec.coherence.containment_mismatches.length === 1);
    check("containment mismatch: shape", rec.coherence.containment_mismatches[0].seq === 5
      && rec.coherence.containment_mismatches[0].issue === "FAFF-1"
      && rec.coherence.containment_mismatches[0].recorded === "outward"
      && rec.coherence.containment_mismatches[0].recomputed === "contained");
    check("containment mismatch: not clean", rec.coherence.clean === false);
  }

  // 13. FAFF-354: a recorded ancestry_raw that fails to parse → recomputed "unreproducible".
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", parent: "FAFF-2", root: false, ancestry_raw: "not json", verdict: "contained", exit: 0 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {} };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("unreproducible: recomputed marker", rec.coherence.containment_mismatches.length === 1
      && rec.coherence.containment_mismatches[0].recomputed === "unreproducible");
    check("unreproducible: not clean", rec.coherence.clean === false);
  }

  // 14. FAFF-354: ledger filed discovered-scope tickets but the timeline holds zero
  // containment-check events → unrecorded_creates true, clean false.
  {
    const ledger = { run_id: "r", admitted: [], outcomes: {}, discovered_scope_filed: 2 };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {});
    check("unrecorded creates: true", rec.coherence.unrecorded_creates === true);
    check("unrecorded creates: not clean", rec.coherence.clean === false);
  }

  // 15. FAFF-354: discovered_scope_filed > 0 but containment-check events ARE present →
  // unrecorded_creates false (the chokepoint was recorded, even if for other issues).
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "containment-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", parent: "FAFF-1", root: false, ancestry_raw: null, verdict: "contained", exit: 0 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {}, discovered_scope_filed: 1 };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("unrecorded creates: false when checks are present", rec.coherence.unrecorded_creates === false);
  }

  // 16. FAFF-539: a recorded self-intake-check event whose {verdict, reason} agree with
  // the recompute (from the recorded target_raw + recorded self snapshot) → no finding.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "self-intake-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", target_raw: '{"team":null,"repo":"shftwst/faff"}', self: { team: null, repo: "shftwst/faff", lane_on: true }, verdict: "self", reason: "repo-match", exit: 0 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {}, discovered_scope_filed: 0 };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("self-intake clean: no mismatch", rec.coherence.self_intake_mismatches.length === 0);
    check("self-intake clean: coherence stays clean", rec.coherence.clean === true);
  }

  // 17. FAFF-539: a hand-edited verdict (tampered record) → self_intake_mismatches names
  // it, clean false. The recompute is HERMETIC — driven by the recorded snapshot, not
  // live config.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 4, ts: "t", phase: "run", type: "self-intake-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", target_raw: '{"team":"OTHER","repo":"acme/app"}', self: { team: "FAFF", repo: "shftwst/faff", lane_on: true }, verdict: "self", reason: "team-match", exit: 0 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {} };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("self-intake tampered: one finding", rec.coherence.self_intake_mismatches.length === 1);
    check("self-intake tampered: shape", rec.coherence.self_intake_mismatches[0].seq === 4
      && rec.coherence.self_intake_mismatches[0].issue === "FAFF-1"
      && rec.coherence.self_intake_mismatches[0].recorded === "self"
      && rec.coherence.self_intake_mismatches[0].recomputed === "not-self"
      && rec.coherence.self_intake_mismatches[0].recomputed_reason === "mismatch");
    check("self-intake tampered: not clean", rec.coherence.clean === false);
  }

  // 18. FAFF-539: an unparseable recorded target_raw → recomputed "unreproducible",
  // reported (never crashed), clean false.
  {
    const records = [
      { schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "self-intake-check", issue: "FAFF-1",
        data: { mandate: "FAFF-1", target_raw: "not json", self: { team: "FAFF", repo: null, lane_on: true }, verdict: "not-self", reason: "mismatch", exit: 3 } },
    ];
    const ledger = { run_id: "r", admitted: [], outcomes: {} };
    const rec = buildReconstruction("r", "/d", evs(records), ledger, {});
    check("self-intake unreproducible: marker", rec.coherence.self_intake_mismatches.length === 1
      && rec.coherence.self_intake_mismatches[0].recomputed === "unreproducible");
    check("self-intake unreproducible: not clean", rec.coherence.clean === false);
  }

  // 19. FAFF-673: an accounted-for PR-path human-merge (override + reason + merge declaration +
  // covered merge observe + merged record) is reported present/accounted_for and does NOT make
  // coherence unclean.
  {
    const issue = "FAFF-673";
    const overrides = { [issue]: { pr: 5, issue, head_sha: "abc", blockers: ["ACs not all verified", "review verdict is missing"], reason: "spike findings; no floor", source: "human-override" } };
    const mergeRecords = { [issue]: { pr: 5, head_sha: "abc", merged: true } };
    const effectsEntries = [
      { kind_of_entry: "declare", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
      { kind_of_entry: "observe", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
    ];
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    const hm = rec.issues.find((x) => x.issue === issue).human_merge;
    check("hm PR accounted-for: present + accounted_for", !!hm && hm.present === true && hm.accounted_for === true);
    check("hm PR accounted-for: carries the reason", hm.reason === "spike findings; no floor");
    check("hm PR accounted-for: coherence stays clean", rec.coherence.clean === true);
    check("hm PR accounted-for: no unexplained finding", rec.coherence.human_merge_unexplained.length === 0);
  }

  // 20. FAFF-673: an accounted-for LOCAL-path human-merge (no pr, no observe — merge-record IS the
  // landing) is accounted_for and NOT false-flagged as unexplained.
  {
    const issue = "FAFF-673L";
    const overrides = { [issue]: { issue, head_sha: "abc", blockers: [], reason: "docs capture; no floor", source: "human-override" } };
    const mergeRecords = { [issue]: { pr: 0, head_sha: "abc", merged: true } };
    const effectsEntries = [{ kind_of_entry: "declare", issue, step: "merge", effect: { kind: "merge", target: "pr:0" } }];
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    const hm = rec.issues.find((x) => x.issue === issue).human_merge;
    check("hm LOCAL accounted-for: accounted_for true (no observe required)", hm.accounted_for === true);
    check("hm LOCAL accounted-for: coherence clean (no false unexplained)", rec.coherence.clean === true);
  }

  // 21. FAFF-673 unexplained trigger (i): empty reason → human_merge_unexplained, not clean.
  {
    const issue = "FAFF-673E";
    const overrides = { [issue]: { pr: 5, issue, head_sha: "abc", blockers: [], reason: "", source: "human-override" } };
    const mergeRecords = { [issue]: { pr: 5, merged: true } };
    const effectsEntries = [
      { kind_of_entry: "declare", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
      { kind_of_entry: "observe", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
    ];
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    check("hm unexplained (empty reason): one finding for the issue", rec.coherence.human_merge_unexplained.length === 1 && rec.coherence.human_merge_unexplained[0].issue === issue);
    check("hm unexplained (empty reason): reason_present false", rec.coherence.human_merge_unexplained[0].reason_present === false);
    check("hm unexplained (empty reason): not clean", rec.coherence.clean === false);
  }

  // 22. FAFF-673 unexplained trigger (ii): missing merge declaration (local, merged record, no declare)
  // → declare_present false, landing covered, accounted_for false, not clean.
  {
    const issue = "FAFF-673D";
    const overrides = { [issue]: { issue, head_sha: "abc", blockers: [], reason: "docs", source: "human-override" } };
    const mergeRecords = { [issue]: { pr: 0, merged: true } };
    const effectsEntries = []; // no declaration
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    check("hm unexplained (no declaration): declare_present false", rec.coherence.human_merge_unexplained[0].declare_present === false);
    check("hm unexplained (no declaration): landing_covered true (local merged record present)", rec.coherence.human_merge_unexplained[0].landing_covered === true);
    check("hm unexplained (no declaration): not clean", rec.coherence.clean === false);
  }

  // 23. FAFF-673 unexplained trigger (iii-a): no merge landing (dangling override, no merge-record)
  // → landing_covered false, not clean.
  {
    const issue = "FAFF-673N";
    const overrides = { [issue]: { pr: 5, issue, head_sha: "abc", blockers: [], reason: "spike", source: "human-override" } };
    const mergeRecords = {}; // dangling — no merge-record
    const effectsEntries = [
      { kind_of_entry: "declare", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
      { kind_of_entry: "observe", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } },
    ];
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    check("hm unexplained (dangling override): landing_covered false", rec.coherence.human_merge_unexplained[0].landing_covered === false);
    check("hm unexplained (dangling override): not clean", rec.coherence.clean === false);
  }

  // 24. FAFF-673 unexplained trigger (iii-b): uncovered/escaped PR merge observe (observe with no
  // covering declaration, merged record present) → landing_covered false, not clean.
  {
    const issue = "FAFF-673U";
    const overrides = { [issue]: { pr: 5, issue, head_sha: "abc", blockers: [], reason: "spike", source: "human-override" } };
    const mergeRecords = { [issue]: { pr: 5, merged: true } };
    const effectsEntries = [{ kind_of_entry: "observe", issue, step: "merge", effect: { kind: "merge", target: "pr:5" } }]; // escaped — no declare
    const ledger = { run_id: "r", admitted: [issue], outcomes: { [issue]: "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {}, { overrides, mergeRecords, effectsEntries });
    check("hm unexplained (escaped PR merge): landing_covered false (uncovered observe)", rec.coherence.human_merge_unexplained[0].landing_covered === false);
    check("hm unexplained (escaped PR merge): not clean", rec.coherence.clean === false);
  }

  // 25. FAFF-673: NO override for any issue → no human_merge attached, no finding, coherence clean.
  // Also exercises the 5-arg call (default humanMerge) — byte-for-byte the pre-FAFF-673 shape.
  {
    const ledger = { run_id: "r", admitted: ["FAFF-1"], outcomes: { "FAFF-1": "shipped" } };
    const rec = buildReconstruction("r", "/d", evs([]), ledger, {});
    check("hm absent: no human_merge key on the issue", !("human_merge" in rec.issues[0]));
    check("hm absent: human_merge_unexplained empty", rec.coherence.human_merge_unexplained.length === 0);
    check("hm absent: coherence clean", rec.coherence.clean === true);
  }

  // 26. FAFF-673: accountHumanMerge returns null when there is no override for the issue.
  {
    check("accountHumanMerge: no override → null", accountHumanMerge("FAFF-1", null, { merged: true }, []) === null);
  }

  // 27. FAFF-700: dispatch_observability — a run with no agent-dispatch events at all
  // reports "absent" (nothing claimed, nothing to verify — not a failure), and stays
  // out of coherence.clean regardless (never gated).
  {
    const records = [{ schema: 1, run_id: "r", seq: 0, ts: "t", phase: "run", type: "run-start" }];
    const rec = buildReconstruction("r", "/d", evs(records), { run_id: "r", admitted: [], outcomes: {} }, {});
    check("dispatch absent: no dispatch events → status absent", rec.coherence.dispatch_observability.status === "absent");
    check("dispatch absent: clusters empty", rec.coherence.dispatch_observability.clusters.length === 0);
    check("dispatch absent: coherence stays clean", rec.coherence.clean === true);
  }

  // 28. FAFF-700: a reader cluster of 3, all 3 children present and stamped →
  // verified. Direct computeDispatchObservability core check (mirrors the spec's
  // integration smoke test).
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } },
    ];
    const substrate = { reachable: true, children: [["R1"], ["R1"], ["R1"]] };
    const r = computeDispatchObservability(dispatchEvents, substrate);
    check("dispatch verified: overall status", r.status === "verified");
    check("dispatch verified: substrate_reachable", r.substrate_reachable === true);
    check("dispatch verified: cluster shape", r.clusters.length === 1 && r.clusters[0].claimed === 3
      && r.clusters[0].observed === 3 && r.clusters[0].status === "verified");
  }

  // 29. FAFF-700: cluster_size claims 3 but only 2 attributable children ran → mismatch.
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } },
    ];
    const substrate = { reachable: true, children: [["R1"], ["R1"]] };
    const r = computeDispatchObservability(dispatchEvents, substrate);
    check("dispatch mismatch: overall status", r.status === "mismatch");
    check("dispatch mismatch: cluster shape", r.clusters[0].observed === 2 && r.clusters[0].claimed === 3 && r.clusters[0].status === "mismatch");
  }

  // 30. FAFF-700: MIXED-KIND run — a reader cluster (3 stamped, all present) AND a
  // build cluster (claims 2, zero attributable children). The build cluster can never
  // fold into a clean overall — the false-all-clear this ticket exists to close.
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } },
      { seq: 1, type: "agent-dispatch", data: { kind: "build", dispatch_id: "d2", cluster_id: "B1", cluster_size: 2 } },
    ];
    const substrate = { reachable: true, children: [["R1"], ["R1"], ["R1"]] }; // B1 stamped nowhere
    const r = computeDispatchObservability(dispatchEvents, substrate);
    check("dispatch mixed-kind: overall NOT verified", r.status === "unverifiable-substrate");
    const reader = r.clusters.find((c) => c.cluster_id === "R1");
    const build = r.clusters.find((c) => c.cluster_id === "B1");
    check("dispatch mixed-kind: reader verified", reader.status === "verified" && reader.observed === 3);
    check("dispatch mixed-kind: build unverifiable, observed null", build.status === "unverifiable-substrate" && build.observed === null);
  }

  // 31. FAFF-700: substrate unreachable (no session id / transcript dir) → every
  // cluster reports unverifiable-substrate, observed null — never verified, never mismatch.
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 3 } },
    ];
    const r = computeDispatchObservability(dispatchEvents, { reachable: false, children: [] });
    check("dispatch unreachable substrate: overall status", r.status === "unverifiable-substrate");
    check("dispatch unreachable substrate: substrate_reachable false", r.substrate_reachable === false);
    check("dispatch unreachable substrate: observed null", r.clusters[0].observed === null);
  }

  // 32. FAFF-700: two agent-dispatch events sharing cluster_id "R1" (2 then 1 — a
  // re-dispatch after a partial fan-out) sum claimed to 3; 3 distinct stamped
  // children on disk → verified.
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 2 } },
      { seq: 1, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d2", cluster_id: "R1", cluster_size: 1 } },
    ];
    const substrate = { reachable: true, children: [["R1"], ["R1"], ["R1"]] };
    const r = computeDispatchObservability(dispatchEvents, substrate);
    check("dispatch re-dispatch: claimed summed to 3", r.clusters.length === 1 && r.clusters[0].claimed === 3);
    check("dispatch re-dispatch: observed 3, verified", r.clusters[0].observed === 3 && r.clusters[0].status === "verified");
  }

  // 33. FAFF-700: exact-token match — a cluster "R1" must never cross-count a child
  // stamped "R12" (substring, not exact).
  {
    const dispatchEvents = [
      { seq: 0, type: "agent-dispatch", data: { kind: "reader", dispatch_id: "d1", cluster_id: "R1", cluster_size: 1 } },
    ];
    const substrate = { reachable: true, children: [["R12"]] }; // stamped R12, not R1
    const r = computeDispatchObservability(dispatchEvents, substrate);
    check("dispatch exact-token: R12 does not satisfy cluster R1", r.clusters[0].status === "unverifiable-substrate" && r.clusters[0].observed === null);
  }

  if (failed) { console.log(`RESULT: audit --selftest FAILED (${failed} failure(s))`); return 1; }
  console.log("RESULT: audit --selftest ok");
  return 0;
}


module.exports = { accountHumanMerge, auditSelftest, buildReconstruction, cmdAudit, computeDispatchObservability, readDispatchSubstrate, readEvents, readProvenance, renderAuditText };
