// FAFF-130 — judgement-eval orchestrator.
//
// Loads EvalCases, drives K reps of faff-tidy via an INJECTABLE driver, grades each rep
// deterministically (grader.mjs), escalates wobbly cases toward ~50 reps, and aggregates
// per-case stability + accuracy + cost. The driver is a dependency so tests inject a mock
// (no frontier calls); the default is the real `claude -p` frontier driver, run by FAFF-131.
//
// eval/ is NOT matched by `node --test` globs, so CI never imports/runs this orchestrator.
// Zero-dependency: node builtins only.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, appendFileSync, renameSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";
import { execSync, spawnSync } from "node:child_process";
import { grade, aggregateCase, validateCase, hasDisagreement, erroredRep, CLOSED_SET_KINDS } from "./grader.mjs";
import { parseJudgementEnvelope, EnvelopeError } from "./envelope.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE_REPS = 20;     // spec Decision 4 — ~88% power vs a 10% flip rate
export const MAX_REPS = 50;      // adaptive-escalation ceiling

// FAFF-320 — durable per-rep raw-judgement capture (advisory-only; NEVER a grading input — ADR-0004).
// Each completed rep (happy path + both error branches) appends one JudgementRecord JSONL line to
// `.faff/eval-runs/<run-id>/judgements.jsonl` the instant it finishes — before the next rep's driver
// call — so a SIGKILL mid-sweep loses at most the in-flight rep and calibration reads captured data
// instead of re-running. Capture is opt-in: a `judgementsPath` threaded from the CLI entry point,
// defaulting to null so the pure mock-driver test path stays I/O-free (the deadlineMs = null pattern).
export const RAW_CAP = 16384; // bytes — bounds a pathological model dump × ~1,300 reps; envelopes are tiny.

// PURE — cap rawText to RAW_CAP bytes, keeping the leading (envelope/parse-relevant) head. Returns
// { raw_text, raw_truncated }; null rawText (e.g. the driver threw) → { null, false }.
export function capRaw(rawText, cap = RAW_CAP) {
  if (rawText == null) return { raw_text: null, raw_truncated: false };
  const buf = Buffer.from(String(rawText), "utf8");
  if (buf.length <= cap) return { raw_text: String(rawText), raw_truncated: false };
  return { raw_text: buf.subarray(0, cap).toString("utf8"), raw_truncated: true };
}

// PURE — build one JudgementRecord from the values already in hand at a rep's completion point.
export function buildJudgementRecord(c, i, runId, { status, rawText = null, env = null, graded = null, score = null, signature = null }) {
  const { raw_text, raw_truncated } = capRaw(rawText);
  return {
    run_id: runId,
    ts: new Date().toISOString(),
    case_id: c.id,
    kind: c.kind,
    rep: i,
    status,
    raw_text,
    raw_truncated,
    envelope: env,
    graded,
    score,
    signature,
    oracle: c.oracle,
  };
}

// Guarded synchronous append — mirrors `bin/faff events append` (inline, NOT imported: the eval
// harness stays node-builtins-only). Synchronous by design: the record is flushed to disk before the
// call returns, hence before the next rep's driver call — the crash-salvage guarantee.
export function appendJudgement(judgementsPath, record) {
  if (judgementsPath == null) return;                          // opt-out / test path
  mkdirSync(dirname(judgementsPath), { recursive: true });     // lazy, idempotent
  appendFileSync(judgementsPath, JSON.stringify(record) + "\n");
}

// PURE — mint a date-prefixed YYYYMMDD-HHMMSS run-id (lexical sort == chronological, matching .faff/runs/).
export function mintRunId(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Resolve the capture path for a full sweep: `.faff/eval-runs/<run-id>/judgements.jsonl` (dir created
// lazily on first append). Minted ONLY at the full-sweep CLI entry points (main, --update-baseline).
export function mintCapturePath(runId = mintRunId()) {
  return join(HERE, "..", ".faff", "eval-runs", runId, "judgements.jsonl");
}

export function loadCases(dir = join(HERE, "cases")) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((f) => validateCase(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

// FAFF-154 — the LIVE-fixture loader (separate from loadCases / the black-box sweep). The
// execution-entangled kinds (reconciliation today; verdict-build to follow) ride the live-driver
// lane: their fixtures carry a non-backlog shape (an issue + spec_comment anchor + thread) the
// black-box CLI driver has no render branch for, so dropping them into `cases/` would fall through
// to the wrong renderer. They live in `cases-live/` and are driven through runSkill + the matching
// live-driver, NEVER through loadCases()'s total-over-`cases/` black-box sweep. `loadCases` is the
// sole reader of `cases/`, so a case here is provably never picked up by the black-box run.
export function loadLiveCases(dir = join(HERE, "cases-live")) {
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((f) => validateCase(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

// Drive one case. `driver(evalCase, repIndex) -> Promise<{ rawText, tokens, transcript? }>`.
// FAFF-320 — `judgementsPath` (default null): when set, each completed rep appends one JudgementRecord
// to it synchronously, before the next rep runs. null (the mock-driver test path) → capture is a no-op.
async function runCase(c, driver, { baseReps, maxReps, judgementsPath = null }) {
  const base = Math.min(c.reps || baseReps, maxReps);
  const reps = [];
  let target = base;
  let escalated = false;
  // FAFF-320 — the run-id is the capture dir's name; derived (not re-threaded) so runCase's contract
  // stays minimal. null path → no capture (records are neither built nor written — clock-free).
  const runId = judgementsPath ? basename(dirname(judgementsPath)) : null;
  for (let i = 0; i < target; i++) {
    let out;
    try {
      out = await driver(c, i);
    } catch (e) {
      reps.push(erroredRep(`driver-error:${e.message}`));
      // FAFF-320 — driver threw: no out, no envelope, no grade. Captured so crash-salvage has no holes.
      if (judgementsPath) appendJudgement(judgementsPath, buildJudgementRecord(c, i, runId, { status: "errored", rawText: null, env: null, graded: "ERRORED" }));
      continue;
    }
    try {
      const env = parseJudgementEnvelope(out.rawText, { expectedCaseId: c.id });
      const rr = grade(c, env);
      rr.tokens = out.tokens ?? rr.tokens ?? 0;
      rr.format = env.format; // FAFF-137: "compliant" | "noncompliant" — feeds format_adherence
      reps.push(rr);
      // FAFF-320 — happy path: envelope + grade in hand. Advisory capture only (never feeds per_kind).
      if (judgementsPath) appendJudgement(judgementsPath, buildJudgementRecord(c, i, runId, { status: "graded", rawText: out.rawText, env, graded: rr.graded, score: rr.score, signature: rr.signature }));
    } catch (e) {
      // FAFF-139: the per-rep cfgDir is removed by the driver, so the errored-rep diagnostic is the
      // malformed-output snippet (the actual judgement text that failed to parse), not a dead path.
      if (e instanceof EnvelopeError) {
        const snippet = out.rawText ? out.rawText.slice(0, 300) : null;
        reps.push(erroredRep(out.transcript ?? snippet ?? e.message));
        // FAFF-320 — envelope-parse failure: the bounded failing rawText is the HIGHEST-value capture
        // (envelope is null, so this is what you inspect to fix a broken contract / miscalibrated oracle).
        if (judgementsPath) appendJudgement(judgementsPath, buildJudgementRecord(c, i, runId, { status: "errored", rawText: out.rawText, env: null, graded: "ERRORED" }));
      } else throw e; // a real grader bug must surface, not masquerade as flakiness
    }
    // Adaptive escalation: once the base reps are in, if they disagree, concentrate reps here.
    if (!escalated && i + 1 >= base && base < maxReps && hasDisagreement(reps)) {
      escalated = true;
      target = maxReps;
    }
  }
  return aggregateCase(c, reps, { escalated });
}

// FAFF-318 — the ONE shared per-kind aggregation. PURE. Both `summarize` and the resume checkpoint
// writer call this so the number they emit for a kind is byte-identical (advisory-to-the-numbers).
// accuracy/stability = mean over the kind's CaseResults; format_adherence = mean over the non-null
// values, else null (FAFF-137). Input order is the caller's; sum order matches, so the means match.
export function aggregateKind(caseResultsForOneKind) {
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
  const fa = caseResultsForOneKind.map((cr) => cr.format_adherence).filter((x) => x != null);
  return {
    accuracy: mean(caseResultsForOneKind.map((cr) => cr.accuracy)),
    stability: mean(caseResultsForOneKind.map((cr) => cr.stability)),
    format_adherence: fa.length ? mean(fa) : null,
  };
}

// FAFF-318 — the resume progress file: read + atomic per-kind checkpoint write. The file ALWAYS
// pre-exists (updateBaseline initialises it fresh, or leaves a prior resumed file in place), so the
// stamp is never minted here. Write is temp-then-rename so a crash mid-write can never corrupt the
// resume anchor (the exact scenario this feature exists for).
export function readProgress(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
export function writeCheckpointKind(path, kind, entry, caseIds) {
  const progress = readProgress(path);
  progress.kinds[kind] = { ...entry, case_ids: [...caseIds].sort(), captured_at: new Date().toISOString() };
  writeFileSync(path + ".tmp", JSON.stringify(progress, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}

// Run all cases. `deadlineMs` (optional) is the wall-clock ceiling checked BETWEEN cases —
// when unset (the test path) no clock is read, so the orchestrator is deterministic.
// FAFF-318 — `progressPath` (default null, exactly like judgementsPath): when set, the instant a
// kind's every expected case-id has completed this session, its aggregate is checkpointed to disk so
// a killed sweep can resume. Kind-completion is by case-id SET MEMBERSHIP, not cr.kind adjacency
// (loadCases sorts by filename — same-kind adjacency is incidental).
export async function runEvals({ cases, driver, baseReps = BASE_REPS, maxReps = MAX_REPS, deadlineMs = null, judgementsPath = null, progressPath = null } = {}) {
  const results = [];
  let incomplete = false;
  const expected = {};                                    // kind -> Set of every expected case-id
  for (const c of cases) (expected[c.kind] ??= new Set()).add(c.id);
  const pending = {};                                     // kind -> remaining case-ids (deep copy)
  for (const k of Object.keys(expected)) pending[k] = new Set(expected[k]);
  const seenResultsByKind = {};                           // kind -> CaseResults accumulated this session
  for (const c of cases) {
    if (deadlineMs != null && Date.now() >= deadlineMs) { incomplete = true; break; }
    const cr = await runCase(c, driver, { baseReps, maxReps, judgementsPath }); // FAFF-320 — opt-in capture
    results.push(cr);
    (seenResultsByKind[cr.kind] ??= []).push(cr);
    pending[cr.kind].delete(cr.case_id);
    if (progressPath != null && pending[cr.kind].size === 0) {                   // kind just completed
      writeCheckpointKind(progressPath, cr.kind, aggregateKind(seenResultsByKind[cr.kind]), expected[cr.kind]);
    }
  }
  return summarize(results, incomplete);
}

export function summarize(caseResults, incomplete = false) {
  const byKind = {};
  for (const cr of caseResults) (byKind[cr.kind] ??= []).push(cr);
  return {
    status: incomplete ? "incomplete (ceiling)" : "complete",
    cases: caseResults,
    per_kind: Object.fromEntries(
      Object.entries(byKind).map(([k, crs]) => [k, aggregateKind(crs)]), // FAFF-318 — one shared helper
    ),
    total_cost_tokens: caseResults.reduce((s, cr) => s + cr.cost_tokens, 0),
    escalated_cases: caseResults.filter((cr) => cr.escalated).map((cr) => cr.case_id),
  };
}

// FAFF-691 — the zero-case guard. A run that resolves to zero cases grades nothing, yet summarize([])
// reports status:"complete" and every entry point maps complete → exit 0 — a hollow green. emptyCaseReason
// is PURE: it returns null when there is something to run, else a message naming the narrowing that
// actually emptied the set. loadedCount is cases.length BEFORE the --only filter, so an empty load
// (empty --cases-dir / a --kind with no fixtures) is told apart from an --only that matched nothing —
// the message must name the real cause, not whichever filter ran last. assertNonEmptyCases is the
// throwing form the paid and gate lanes ride to each file's top-level catch; the always-advisory soft
// gate calls emptyCaseReason directly and warns, so it never throws.
export function emptyCaseReason(cases, { entry, only, casesDir, kind, loadedCount } = {}) {
  if (cases.length > 0) return null; // something to run — no refusal
  const loadedEmpty = loadedCount === 0;
  if (only && !loadedEmpty) return `${entry}: --only '${only}' matched none of the ${loadedCount} loaded case(s)`;
  if (casesDir && loadedEmpty) return `${entry}: --cases-dir '${casesDir}' contains no eval cases`;
  if (kind && loadedEmpty) return `${entry}: --kind '${kind}' has no live fixtures (its adapter loader returned nothing)`;
  return `${entry}: the eval corpus is empty — nothing to run`;
}

export function assertNonEmptyCases(cases, ctx) {
  const reason = emptyCaseReason(cases, ctx);
  if (reason) throw new Error(reason);
}

function argFlag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}

// FAFF-169 — the committed-baseline regression gate. The lean-prompts passes (FAFF-116/117) re-run
// frontier and assert per-kind accuracy/stability haven't dropped below the committed baseline. The
// gate is HUMAN-RUN (frontier costs spend; eval/ is CI-excluded — ADR-0004), never a validate.yml step.

// Default policy when a baseline omits one. Tolerance is keyed by GRADER-CLASS (not the kind name):
// closed-set + ordering grade by exact set-equality / rank-correlation, so any drop is real (tol 0);
// free-text kinds (rubric/coverage) carry inherent generation variance, so a small tolerance absorbs
// a ~1-rep dip. `warn_kinds` is ORTHOGONAL to grader-class: a listed kind is reported-not-failed
// regardless of how it grades (today: confidence — closed-set-graded but empirically flaky per ADR-0004,
// pending fixture widening). `escalated_cases` is NEVER a gate input (which cases escalate is run-to-run noise).
export const DEFAULT_POLICY = { warn_kinds: ["confidence"], tolerances: { closed_set: 0.0, ordering: 0.0, free_text: 0.03, format: 0.0 } };

// PURE: classify a kind to its grader-class tolerance. closed_set ← CLOSED_SET_KINDS; ordering ← its
// rank-correlation kind; everything else (gloss/shaping/decomposition/splittable) is free_text.
export function toleranceFor(kind, tolerances = DEFAULT_POLICY.tolerances) {
  if (CLOSED_SET_KINDS.has(kind)) return tolerances.closed_set ?? 0;
  // FAFF-203 — explanatory-order grades via rankCorrelation (the ordering grader-class), so it carries
  // the ordering tolerance (0.0) — any inversion is a real regression, same as `ordering`.
  if (kind === "ordering" || kind === "explanatory-order") return tolerances.ordering ?? 0;
  return tolerances.free_text ?? 0;
}

// PURE — no I/O, no clock. Diff a current summary's per_kind against a committed baseline. Returns
// { kinds: [{kind, status: "pass"|"warn"|"fail", reason?, acc_delta, stab_delta}], failed, warned, new_kinds }.
// failed=true ⇒ the gate exits non-zero. A baseline kind missing from the run is a FAIL (silently
// dropping a kind is the regression this guards). A run kind absent from the baseline is informational.
export function diffAgainstBaseline(currentSummary, baseline) {
  if (!baseline || typeof baseline !== "object" || !baseline.per_kind) {
    throw new Error("diffAgainstBaseline: baseline missing a per_kind block");
  }
  const policy = baseline.policy ?? DEFAULT_POLICY;
  const warn = new Set(policy.warn_kinds ?? []);
  const tol = policy.tolerances ?? DEFAULT_POLICY.tolerances;
  const cur = currentSummary.per_kind ?? {};
  const kinds = [];
  for (const [kind, base] of Object.entries(baseline.per_kind)) {
    const c = cur[kind];
    if (!c) { kinds.push({ kind, status: "fail", reason: "kind dropped from the run" }); continue; }
    const t = toleranceFor(kind, tol);
    const accDelta = round(c.accuracy - base.accuracy);
    const stabDelta = round(c.stability - base.stability);
    const formatBad = base.format_adherence === 1.0 && c.format_adherence != null && c.format_adherence < 1.0;
    const regressed = (c.accuracy < base.accuracy - t) || (c.stability < base.stability - t) || formatBad;
    let status = "pass", reason;
    if (regressed) {
      reason = formatBad ? "format_adherence dropped below 1.00" : `accuracy/stability below baseline − ${t}`;
      status = warn.has(kind) ? "warn" : "fail";
    }
    kinds.push({ kind, status, reason, acc_delta: accDelta, stab_delta: stabDelta });
  }
  const newKinds = Object.keys(cur).filter((k) => !(k in baseline.per_kind));
  return {
    kinds,
    new_kinds: newKinds,
    warned: kinds.some((k) => k.status === "warn"),
    failed: kinds.some((k) => k.status === "fail"),
  };
}
const round = (x) => Math.round(x * 1000) / 1000;

// Read + parse a committed baseline; fail loud (a gate with no baseline is not a pass, never a silent green).
export function loadBaseline(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { throw new Error(`--against: cannot read baseline ${path}: ${e.message}`); }
  let b;
  try { b = JSON.parse(raw); }
  catch (e) { throw new Error(`--against: baseline ${path} is not valid JSON: ${e.message}`); }
  if (!b.per_kind) throw new Error(`--against: baseline ${path} has no per_kind block`);
  return b;
}

function printGateTable(report, baselinePath) {
  console.log(`\n=== regression gate vs ${baselinePath} ===`);
  for (const k of report.kinds) {
    const tag = k.status.toUpperCase().padEnd(4);
    const d = k.reason ? `  (${k.reason})` : `  Δacc ${fmtDelta(k.acc_delta)} Δstab ${fmtDelta(k.stab_delta)}`;
    console.log(`  ${tag} ${k.kind.padEnd(14)}${d}`);
  }
  if (report.new_kinds.length) console.log(`  (new, un-baselined kinds — informational: ${report.new_kinds.join(", ")})`);
  console.log(`  → ${report.failed ? "FAIL (regression)" : report.warned ? "PASS (with warnings)" : "PASS"}`);
}
const fmtDelta = (x) => (x == null ? "n/a" : (x >= 0 ? `+${x.toFixed(2)}` : x.toFixed(2)));

// --against: run frontier, diff vs the committed baseline, exit non-zero on any FAIL (warns don't fail).
async function gateAgainst(argv, presets, baselinePath) {
  const baseline = loadBaseline(baselinePath); // fail-loud before the (costly) run
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const driver = resolveDriver(argv, presets);
  let cases = loadCases();
  const loadedCount = cases.length; // FAFF-691 — pre-filter count distinguishes an empty load from an --only no-match
  if (only) cases = cases.filter((c) => c.id === only);
  // ctx carries only entry/only/loadedCount here: the dir- and kind-cause keys do not apply to this gate
  // lane (emptyCaseReason treats them as absent → null), and the FAFF-625 source guard also asserts this
  // function never names the plain-sweep-only flag.
  assertNonEmptyCases(cases, { entry: "--against gate", only, loadedCount });
  const summary = await runEvals({ cases, driver, baseReps: repsArg ? Number(repsArg) : BASE_REPS });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "latest.json"), JSON.stringify(summary, null, 2));
  printHeadline(summary);
  const report = diffAgainstBaseline(summary, baseline);
  printGateTable(report, baselinePath);
  // Incomplete runs can't clear the gate either; only a complete, non-failing run exits 0.
  return summary.status === "complete" && !report.failed ? 0 : 1;
}

// --update-baseline: run frontier, write the current per_kind + meta to the baseline path (the
// deliberate re-baseline — never auto on a passing --against run). Preserves the existing policy block.
// FAFF-318 — now checkpoints each kind's aggregate to eval/report/frontier-sweep-progress.json the
// moment it completes, so a killed sweep is resumable via --resume (runs only the missing kinds and
// folds them in). A plain --update-baseline (no --resume) truncates any prior progress → clean sweep.
export async function updateBaseline(argv, presets, baselinePath) {
  const only = argFlag(argv, "--only");
  // FAFF-712 — --kind <comma-separated kinds>: a SCOPED re-baseline. Runs only the named kinds and
  // folds their rows into the existing baseline, retaining every un-named kind. The point is an
  // oracle-only change (e.g. FAFF-615) that moves a couple of kinds' scores without touching any case
  // id — which --resume's case-id-staleness check can't detect, and which a full sweep re-measures 27
  // unchanged kinds to fix. --kind is standalone: mutually exclusive with --only (both narrow), and it
  // never checkpoints/resumes (a short scoped run folds from the summary, like --only).
  const kindArg = argFlag(argv, "--kind");
  const repsArg = argFlag(argv, "--reps");
  const resume = argv.includes("--resume");
  if (only && kindArg) throw new Error("--only and --kind are mutually exclusive (both narrow the sweep)");
  if (kindArg && resume) throw new Error("--kind is a self-contained scoped sweep and does not checkpoint; drop --resume");
  const driver = resolveDriver(argv, presets);
  const baseReps = repsArg ? Number(repsArg) : BASE_REPS;
  const driverName = argFlag(argv, "--driver") ?? "frontier";
  const model = driverName === "frontier" ? resolveEvalModel(argv) : (argFlag(argv, "--model") ?? null);

  let cases = loadCases();
  const loadedCount = cases.length; // FAFF-691 — pre-filter count (the default corpus is always non-empty)
  if (only) cases = cases.filter((c) => c.id === only);
  // FAFF-691 — refuse on the --only/full corpus, BEFORE --resume narrows it: a legitimate complete
  // --resume run reaches here with the (non-empty) full corpus, so it is never false-refused. Placed
  // before foldInAndWriteBaseline so a zero-case run cannot corrupt the baseline's meta.source/captured_at.
  // ctx carries only entry/only/loadedCount: the dir- and kind-cause keys do not apply here (absent →
  // null), which also satisfies the FAFF-625 source guard that this function never names the
  // plain-sweep-only flag.
  assertNonEmptyCases(cases, { entry: "--update-baseline", only, loadedCount });
  const expectedKinds = new Set(cases.map((c) => c.kind)); // BEFORE the resume filter narrows cases
  // FAFF-712 — narrow to --kind AFTER expectedKinds is fixed from the full corpus. This is the
  // load-bearing ordering: foldInAndWriteBaseline's `complete` flag is `expected.every(k in swept)`, so
  // a full expectedKinds against a narrowed swept set is never complete → the OVERLAY branch fires and
  // every un-named kind is retained. Deriving expectedKinds from the narrowed set would flip it to
  // complete and WIPE the other kinds.
  let scopedKinds = null;
  if (kindArg) {
    const wanted = kindArg.split(",").map((s) => s.trim()).filter(Boolean);
    const unknown = wanted.filter((k) => !expectedKinds.has(k));
    if (unknown.length) throw new Error(`--kind: unknown kind(s) ${unknown.join(", ")}; corpus kinds are ${[...expectedKinds].sort().join(", ")}`);
    scopedKinds = wanted;
    const wantedSet = new Set(wanted);
    cases = cases.filter((c) => wantedSet.has(c.kind));
    assertNonEmptyCases(cases, { entry: "--update-baseline --kind", kind: kindArg, loadedCount });
  }
  const stamp = { driver: driverName, model, base_reps: baseReps, started_at: new Date().toISOString() };

  const reportDir = join(HERE, "report");
  let progressPath = join(reportDir, "frontier-sweep-progress.json");
  if (only) progressPath = null; // --only never checkpoints/resumes (a single case can't complete its kind)
  if (scopedKinds) progressPath = null; // FAFF-712 — --kind folds from the summary; a short scoped sweep needs no checkpoint (and would clobber a full sweep's progress file)

  if (progressPath != null) {
    mkdirSync(reportDir, { recursive: true });
    if (resume && existsSync(progressPath)) {
      let prior;
      try { prior = readProgress(progressPath); }
      catch (e) { throw new Error(`--resume: progress file ${progressPath} is corrupt/unparseable (${e.message}); delete it and start fresh`); }
      const ps = prior.stamp ?? {};
      if (ps.driver !== stamp.driver || ps.model !== stamp.model || ps.base_reps !== stamp.base_reps) {
        throw new Error(`--resume: progress stamp ${JSON.stringify({ driver: ps.driver, model: ps.model, base_reps: ps.base_reps })} does not match this run ${JSON.stringify({ driver: stamp.driver, model: stamp.model, base_reps: stamp.base_reps })}; refusing to blend`);
      }
      const expectedIds = {};
      for (const c of cases) (expectedIds[c.kind] ??= []).push(c.id);
      const keep = new Set(); // kinds whose stored case-id set still matches the current expected set
      for (const [k, entry] of Object.entries(prior.kinds ?? {})) {
        const want = [...(expectedIds[k] ?? [])].sort();
        const have = [...(entry.case_ids ?? [])].sort();
        if (want.length && JSON.stringify(want) === JSON.stringify(have)) keep.add(k);
      }
      cases = cases.filter((c) => !keep.has(c.kind)); // run only the missing/stale kinds
      console.log(`[run-evals] --resume: ${keep.size} kind(s) already complete; running ${new Set(cases.map((c) => c.kind)).size} remaining. Prior progress left in place.`);
    } else {
      if (resume) console.warn(`[run-evals] --resume: no progress file at ${progressPath}; running the full sweep.`);
      writeFileSync(progressPath, JSON.stringify({ schema: 1, stamp, kinds: {} }, null, 2) + "\n"); // truncate any stale sweep
    }
  }

  const judgementsPath = mintCapturePath(); // FAFF-320 — durable per-rep capture for this multi-hour sweep
  console.log(`[run-evals] capturing raw judgements → ${judgementsPath} (FAFF-320)`);
  const summary = await runEvals({ cases, driver, baseReps, judgementsPath, progressPath });
  foldInAndWriteBaseline(baselinePath, progressPath, expectedKinds, stamp, summary, { only, scopedKinds });
  printHeadline(summary);
  return summary.status === "complete" ? 0 : 1;
}

// FAFF-318 — the merge that NEVER drops a kind. A complete sweep replaces per_kind cleanly (today's
// semantics, incl. ghost-kind pruning); a partial/resumed/`--only` run overlays swept kinds onto the
// existing baseline so no prior kind is lost (a dropped baseline kind is an unconditional --against
// FAIL). Numbers come from the progress file's per-kind aggregate (or, on the --only path, summary).
export function foldInAndWriteBaseline(baselinePath, progressPath, expectedKinds, stamp, summary, { only, scopedKinds = null } = {}) {
  const progress = progressPath ? readProgress(progressPath) : null;
  const sweptKinds = progress ? Object.keys(progress.kinds) : Object.keys(summary.per_kind); // --only uses summary
  const three = (m) => ({ accuracy: m.accuracy, stability: m.stability, format_adherence: m.format_adherence });
  const sweptPerKind = {};
  for (const k of sweptKinds) sweptPerKind[k] = three(progress ? progress.kinds[k] : summary.per_kind[k]);

  let prevBaseline = null;
  try { prevBaseline = JSON.parse(readFileSync(baselinePath, "utf8")); } catch { /* new baseline */ }
  const prevPolicy = prevBaseline?.policy ?? DEFAULT_POLICY;

  const expected = [...expectedKinds];
  const complete = !only && expected.every((k) => sweptKinds.includes(k));

  let per_kind, source;
  if (complete) {
    per_kind = {}; // ordered by first-appearance so a full non-resumed sweep is byte-identical to today
    for (const k of expected) per_kind[k] = sweptPerKind[k];
    source = "real run via --update-baseline";
  } else {
    per_kind = { ...(prevBaseline?.per_kind ?? {}), ...sweptPerKind }; // overlay — retains un-swept kinds
    const retained = Object.keys(prevBaseline?.per_kind ?? {}).filter((k) => !sweptKinds.includes(k)).length;
    source = scopedKinds
      ? `scoped --update-baseline --kind — refreshed ${sweptKinds.join(", ")}; ${retained} prior kind(s) retained`
      : `partial/resumed --update-baseline — ${sweptKinds.length}/${expected.length} kinds swept this cycle; rest retained`;
  }

  const out = {
    meta: { captured_at: new Date().toISOString().slice(0, 10), driver: stamp.driver, model: stamp.model, base_reps: stamp.base_reps, source },
    per_kind,
    policy: prevPolicy,
  };
  mkdirSync(dirname(baselinePath), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(out, null, 2) + "\n");
  console.log(`\n=== baseline written to ${baselinePath} (${Object.keys(per_kind).length} kinds) ===`);

  if (!complete && !only) {
    if (scopedKinds) {
      const retained = Object.keys(prevBaseline?.per_kind ?? {}).filter((k) => !sweptKinds.includes(k)).length;
      console.log(`[run-evals] scoped re-baseline (--kind): refreshed ${sweptKinds.join(", ")}; ${retained} prior kind(s) retained unchanged.`);
    } else {
      const remaining = expected.filter((k) => !sweptKinds.includes(k));
      console.warn(`[run-evals] ⚠ PARTIAL baseline — kinds still missing this cycle: ${remaining.join(", ") || "(none — some prior kinds retained)"}. Re-run with --resume to complete.`);
    }
    if (!prevBaseline) {
      console.warn(`[run-evals] ⚠ FIRST baseline written from a ${scopedKinds ? "SCOPED --kind" : "PARTIAL/incomplete"} sweep — a first baseline SHOULD be a complete sweep; it holds ONLY the ${scopedKinds ? "named" : "completed"} kinds (${sweptKinds.join(", ")}).`);
    }
  }
}

function printHeadline(s) {
  console.log(`\n=== judgement-eval headline (${s.status}) ===`);
  for (const [kind, m] of Object.entries(s.per_kind)) {
    const fmt = m.format_adherence == null ? "n/a" : m.format_adherence.toFixed(2);
    console.log(`  ${kind.padEnd(11)} accuracy ${m.accuracy.toFixed(2)}  stability ${m.stability.toFixed(2)}  format ${fmt}`);
  }
  if (s.escalated_cases.length) console.log(`  escalated: ${s.escalated_cases.join(", ")}`);
  console.log(`  total tokens (est): ${s.total_cost_tokens}`);
}

// Resolve the local preset's base URL + model: --flag → env → hard error. NO localhost default —
// ollama is served over Tailscale, so a missing base URL is a fail-loud config error, not a default.
export function resolveLocalParams(argv) {
  const baseUrl = argFlag(argv, "--base-url") ?? process.env.FAFF_EVAL_LOCAL_BASE_URL ?? null;
  const model = argFlag(argv, "--model") ?? process.env.FAFF_EVAL_LOCAL_MODEL ?? null;
  if (!baseUrl) throw new Error("--driver local requires --base-url (or FAFF_EVAL_LOCAL_BASE_URL); no localhost default");
  if (!model) throw new Error("--driver local requires --model (or FAFF_EVAL_LOCAL_MODEL)");
  if (/localhost|127\.0\.0\.1/.test(baseUrl)) {
    console.warn("[run-evals] WARN: base URL points at localhost, but ollama is served over Tailscale — is this right?");
  }
  return { baseUrl, model };
}

// Resolve which skills the spawned run loads (FAFF-133): `--plugin-dir <path>` overrides the repo
// plugin; `--no-plugin` disables it for a vanilla skill-less baseline; otherwise undefined lets the
// preset default (the repo's own plugin + --bare) apply.
export function resolvePluginDir(argv) {
  const flag = argFlag(argv, "--plugin-dir");
  if (flag) return flag;
  if (argv.includes("--no-plugin")) return null;
  return undefined; // preset default = the repo plugin
}

// Select the driver from --driver (default frontier). `presets` is injected
// ({ frontierDriver, localDriver }) so this stays pure/testable — it never spawns. Both presets load
// the repo's canonical skills by default (FAFF-133), so frontier and local measure the same prose.
// FAFF-315: the eval frontier lane is PINNED — flag > `faff config get models.eval` > the baked
// fallback — NEVER the account default. Budget guard: eval bulk must not silently bill the
// session/account model (e.g. a fast-burning frontier pool); validity guard: the report names the
// model the numbers belong to (baseline lineage is model-specific). Local/ollama lanes untouched.
export const EVAL_MODEL_FALLBACK = "claude-sonnet-4-6";
// `run(bin, args)` is injectable for tests; the default is an argv-array spawn — no shell, so the
// module-derived path is never subject to shell expansion (adversarial-review hardening).
export function resolveEvalModel(argv, { run } = {}) {
  const flag = argFlag(argv, "--model");
  if (flag) return flag;
  try {
    const bin = join(HERE, "..", "plugin", "skills", "faff", "bin", "faff");
    const doRun = run ?? ((b, a) => {
      const r = spawnSync("node", [b, ...a], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`faff config get failed: ${r.stderr}`);
      return r.stdout;
    });
    const out = doRun(bin, ["config", "get", "models.eval"]).trim();
    if (out) return out;
  } catch { /* config CLI unavailable — fall to the pinned fallback, never the account default */ }
  return EVAL_MODEL_FALLBACK;
}

export function resolveDriver(argv, presets) {
  const which = argFlag(argv, "--driver") ?? "frontier";
  const bin = argFlag(argv, "--bin") ?? "claude";
  const pluginDir = resolvePluginDir(argv);
  if (which === "frontier") {
    if (argFlag(argv, "--base-url")) console.warn("[run-evals] WARN: --base-url is ignored for --driver frontier");
    const model = resolveEvalModel(argv);
    console.log(`[run-evals] frontier model: ${model} (--model flag > models.eval config > pinned default; never the account default — FAFF-315)`);
    return presets.frontierDriver({ bin, pluginDir, model });
  }
  if (which === "local") {
    const { baseUrl, model } = resolveLocalParams(argv);
    return presets.localDriver({ baseUrl, model, bin, pluginDir });
  }
  if (which === "ollama-direct") {
    // FAFF-144: direct /api/chat (no agent loop). think defaults OFF (the local-speed lever); --think to enable.
    const { baseUrl, model } = resolveLocalParams(argv);
    return presets.makeDirectOllamaDriver({ baseUrl, model, pluginDir, think: argv.includes("--think") });
  }
  throw new Error(`unknown --driver: ${which} (expected frontier|local|ollama-direct)`);
}

function printCompareTable(fr, lo) {
  console.log(`\n=== frontier vs local — per-kind accuracy/stability ===`);
  console.log(`  ${"kind".padEnd(11)} ${"frontier".padEnd(16)} local`);
  const kinds = [...new Set([...Object.keys(fr.per_kind), ...Object.keys(lo.per_kind)])].sort();
  for (const k of kinds) {
    const f = fr.per_kind[k] ?? { accuracy: 0, stability: 0 };
    const l = lo.per_kind[k] ?? { accuracy: 0, stability: 0 };
    const cell = (m) => `${m.accuracy.toFixed(2)}/${m.stability.toFixed(2)}`;
    console.log(`  ${k.padEnd(11)} ${cell(f).padEnd(16)} ${cell(l)}`);
  }
  console.log(`  tokens (est): frontier ${fr.total_cost_tokens}  local ${lo.total_cost_tokens}`);
}

// --compare: run BOTH presets over the same cases and tabulate. Real-model run (FAFF-131-class);
// the light affordance, not the measured study. Local params resolved up front so it fails before
// the (costly) frontier pass if the local side is underspecified.
async function compare(argv, presets) {
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const baseReps = repsArg ? Number(repsArg) : BASE_REPS;
  const bin = argFlag(argv, "--bin") ?? "claude";
  const pluginDir = resolvePluginDir(argv);
  const { baseUrl, model } = resolveLocalParams(argv); // fail-loud before any rep
  let cases = loadCases();
  const loadedCount = cases.length; // FAFF-691 — pre-filter count distinguishes an empty load from an --only no-match
  if (only) cases = cases.filter((c) => c.id === only);
  // ctx carries only entry/only/loadedCount: the dir- and kind-cause keys do not apply to --compare
  // (absent → null), which also satisfies the FAFF-625 source guard that this function never names the
  // plain-sweep-only flag.
  assertNonEmptyCases(cases, { entry: "--compare", only, loadedCount });
  const fr = await runEvals({ cases, driver: presets.frontierDriver({ bin, pluginDir }), baseReps });
  const lo = await runEvals({ cases, driver: presets.localDriver({ baseUrl, model, bin, pluginDir }), baseReps });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "compare.json"), JSON.stringify({ frontier: fr, local: lo }, null, 2));
  printCompareTable(fr, lo);
  return fr.status === "complete" && lo.status === "complete" ? 0 : 1;
}

// ─── FAFF-180: the proportionate judgement-eval gate ───────────────────────────
// Selectable driver: `smart` (default) | `local` | `frontier`.
//   local / smart→local  = SOFT  (advisory comparison signal; ALWAYS exits 0; tolerates a sub-par
//                                   or absent local model — a drift/trend tool, never a build blocker)
//   frontier             = HARD  (the real degradation gate; exits non-zero on a baseline regression)
//   smart                = routes by diff surface + local availability; for a substantive diff it runs
//                          local soft AND *recommends* frontier — it NEVER auto-runs the multi-hour
//                          frontier (no silent CI cost). Driver is resolved ONCE (no death loop).

// The local/smoke case-set — the prose-sensitive judgement kinds most likely to move on a skill-prose
// edit (classification + ordering + synthesis-gloss + marker). A subset of grader KINDS.
export const SMOKE_KINDS = new Set(["dupe", "vague", "stale", "superseded", "ordering", "gloss", "marker"]);
export const SMOKE_REPS = 5; // low reps — minutes, not hours

// PURE. Resolve the gate driver string (default `smart`). Resolved ONCE per invocation — the
// idempotence that makes the "route local → unavailable → retry local" death loop unrepresentable.
export function resolveGateDriver(argv) {
  const d = argFlag(argv, "--driver") ?? "smart";
  if (!["smart", "local", "frontier"].includes(d)) {
    throw new Error(`--gate --driver expects smart|local|frontier, got ${JSON.stringify(d)}`);
  }
  return d;
}

// PURE. Classify a changed-file list as `prose` (→ local soft) or `substantive` (→ frontier recommended).
// Advisory only: substantive iff the diff touches code (*.mjs), a contract, the CLI, or the grader.
// A pure skill-prose diff (only *.md) is `prose`. Empty list → `prose` (nothing code-bearing to judge).
export function classifyDiffSurface(files) {
  const substantive = (files ?? []).some((f) =>
    /(^|\/)contracts\//.test(f) || /\/faff\/bin\//.test(f) || /eval\/grader\.mjs$/.test(f) || /\.mjs$/.test(f));
  return substantive ? "substantive" : "prose";
}

// Read changed files vs main (best-effort; the gate degrades to `prose` if git is unavailable).
function changedFilesFromGit() {
  try {
    return execSync("git diff --name-only main...HEAD", { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

// Cheap reachability probe — a single GET to the ollama base URL; resolves true on ANY response,
// false on error/timeout. Injectable so tests never open a socket. ONE shot — never retried.
function defaultProbe(baseUrl, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    let url; try { url = new URL(baseUrl); } catch { return resolve(false); }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "GET", timeout: timeoutMs }, (res) => { res.resume(); resolve(true); });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.end();
  });
}

// Preflight the local backend ONCE. Returns {ok:true, baseUrl, model} | {ok:false, reason}. Unconfigured
// (no --base-url/--model) and unreachable both resolve to {ok:false} — a soft-skip, never a thrown error.
export async function preflightLocal(argv, { probe = defaultProbe } = {}) {
  let baseUrl, model;
  try { ({ baseUrl, model } = resolveLocalParams(argv)); }
  catch (e) { return { ok: false, reason: `local model not configured (${e.message})` }; }
  let reachable = false;
  try { reachable = await probe(baseUrl); } catch { reachable = false; }
  return reachable ? { ok: true, baseUrl, model } : { ok: false, reason: `local model unreachable at ${baseUrl}` };
}

// SOFT local gate — ALWAYS returns 0. Preflight (one shot); unavailable → soft-skip; else run the scoped
// smoke kinds at low reps and print an advisory drift report. A regression is a WARNING, never a failure.
async function softLocalGate(argv, presets, baselinePath, { probe, runEvalsFn = runEvals } = {}) {
  const pf = await preflightLocal(argv, { probe });
  if (!pf.ok) {
    console.log(`[gate] skipped: ${pf.reason} — soft smoke not run (advisory; not a failure). exit 0.`);
    return 0; // ← soft skip; single-shot; NO retry, NO re-route, NO frontier fallback
  }
  const baseline = loadBaseline(baselinePath);
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  const driver = presets.localDriver({
    baseUrl: pf.baseUrl, model: pf.model, bin: argFlag(argv, "--bin") ?? "claude", pluginDir: resolvePluginDir(argv),
  });
  let cases = loadCases().filter((c) => SMOKE_KINDS.has(c.kind));
  const loadedCount = cases.length; // FAFF-691 — smoke-set count BEFORE --only
  if (only) cases = cases.filter((c) => c.id === only);
  // FAFF-691 — the one warn-only site: its contract is always-advisory, always-exit-0, so a zero-case
  // smoke set downgrades the refusal to a warning and never throws.
  const emptyReason = emptyCaseReason(cases, { entry: "--gate soft smoke", only, casesDir: null, kind: null, loadedCount });
  if (emptyReason) {
    console.warn(`[gate] ${emptyReason} — soft smoke not run (advisory; exit 0)`);
    return 0;
  }
  const summary = await runEvalsFn({ cases, driver, baseReps: repsArg ? Number(repsArg) : SMOKE_REPS });
  const report = diffAgainstBaseline(summary, baseline);
  printGateTable(report, baselinePath);
  if (report.failed) {
    console.log(`[gate] ⚠ drift vs baseline (ADVISORY) — review, and run \`--gate --driver frontier\` for the hard gate. NOT blocking (exit 0).`);
  }
  return 0; // ← SOFT: always 0, regardless of drift
}

// The FAFF-180 gate entry. Driver resolved ONCE; soft/hard follows the running driver.
export async function gate(argv, presets, baselinePath, opts = {}) {
  const driver = resolveGateDriver(argv);
  if (driver === "frontier") return gateAgainst(argv, presets, baselinePath);     // HARD
  if (driver === "local") return softLocalGate(argv, presets, baselinePath, opts); // SOFT
  // smart — route by diff surface; ALWAYS soft, never auto-runs frontier
  const files = opts.changedFiles ?? changedFilesFromGit();
  const surface = classifyDiffSurface(files);
  const code = await softLocalGate(argv, presets, baselinePath, opts);
  if (surface === "substantive") {
    console.log(`[gate] substantive change detected — the hard gate is RECOMMENDED: \`--gate --driver frontier\` (a human runs it; smart never auto-incurs the frontier cost).`);
  }
  return code; // 0 — smart inherits the soft path it ran
}

// CLI — the REAL run. Never triggered by a test import (process.argv[1] is the test file).
// `node eval/run-evals.mjs [--driver frontier|local|ollama-direct] [--model M] [--base-url URL] [--think] [--plugin-dir P | --no-plugin] [--only ID] [--reps N] [--cases-dir DIR]`
// `--cases-dir DIR` (FAFF-625): additive, plain-sweep-only — routes loadCases(DIR) instead of the default eval/cases/. Absent, behaviour is byte-identical. NOT read by --gate / --against / --update-baseline / --compare.
// `node eval/run-evals.mjs --compare [--model M] [--base-url URL] [--plugin-dir P | --no-plugin] [--only ID] [--reps N]`
// `node eval/run-evals.mjs --gate [--driver smart|local|frontier] [--against PATH]`   (FAFF-180: proportionate gate — smart default; local/smart soft+exit-0, frontier hard)
// `node eval/run-evals.mjs --driver frontier --against eval/baselines/frontier.json`   (FAFF-169: regression gate — exit non-zero on a per-kind drop)
// `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json [--resume]`   (FAFF-169: deliberate re-baseline; FAFF-318: --resume continues a crashed sweep from its per-kind checkpoint)
// `node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json --kind K1,K2`  (FAFF-712: SCOPED re-baseline — runs only the named kinds and folds their rows into the existing baseline, retaining every un-named kind; for an oracle-only change that --resume's case-id staleness can't detect. Standalone: not with --only/--resume.)
// frontier/local = agentic `claude -p`; ollama-direct = direct /api/chat at local speed (FAFF-144).
// Loads the repo's canonical plugin by default (FAFF-133); --no-plugin runs a vanilla skill-less baseline.
// FAFF-320 — a full sweep (`main`, `--update-baseline`) streams every rep's raw judgement to
// `.faff/eval-runs/<run-id>/judgements.jsonl` (printed at start) for crash-salvage + calibration.
async function main(argv) {
  const cliPresets = await import("./cli-driver.mjs"); // { frontierDriver, localDriver } — pure import, no spawn
  const { makeDirectOllamaDriver } = await import("./ollama-model.mjs"); // FAFF-144 — pure import, no socket
  const presets = { ...cliPresets, makeDirectOllamaDriver };
  // FAFF-625 review finding (major): --cases-dir is plain-sweep-only (below) — every OTHER entry path
  // below calls loadCases() with no argument and silently ignores the flag if present. A silent no-op
  // is a footgun (the codebase's fail-loud convention), so warn loudly here, once, before any entry
  // path's own logic runs — advisory only, never blocks (none of these paths error on an unknown flag).
  if (argv.includes("--cases-dir") && (argv.includes("--gate") || argv.includes("--compare") || argFlag(argv, "--against") || argFlag(argv, "--update-baseline"))) {
    console.warn("[run-evals] WARN: --cases-dir is ignored by --gate / --against / --update-baseline / --compare (plain-sweep-only); this run uses the default eval/cases/.");
  }
  if (argv.includes("--gate")) {                                              // FAFF-180 proportionate gate
    const baselinePath = argFlag(argv, "--against") ?? join(HERE, "baselines", "frontier.json");
    return gate(argv, presets, baselinePath);
  }
  if (argv.includes("--compare")) return compare(argv, presets);
  const againstPath = argFlag(argv, "--against");
  if (againstPath) return gateAgainst(argv, presets, againstPath);           // FAFF-169 regression gate
  const updatePath = argFlag(argv, "--update-baseline");
  if (updatePath) return updateBaseline(argv, presets, updatePath);          // FAFF-169 deliberate re-baseline
  const only = argFlag(argv, "--only");
  const repsArg = argFlag(argv, "--reps");
  // FAFF-625 — additive, plain-sweep-only: routes the already-parameterised loadCases(dir) at a
  // separate corpus dir (e.g. a production seeded-defect corpus) WITHOUT touching --gate / --against /
  // --update-baseline / --compare, each of which still calls loadCases() with no argument (untouched,
  // byte-identical). Absent this flag, `casesDir` is undefined and loadCases() falls back to its own
  // default `cases/` dir exactly as before this change.
  const casesDir = argFlag(argv, "--cases-dir");
  const driver = resolveDriver(argv, presets); // fail-loud before loadCases/runEvals if local underspecified
  let cases = loadCases(casesDir || undefined);
  const loadedCount = cases.length; // FAFF-691 — pre-filter count: empty --cases-dir load vs --only no-match
  if (only) cases = cases.filter((c) => c.id === only);
  // FAFF-691 — refuse before minting a capture path / writing report/latest.json, so a zero-case sweep
  // never leaves a report claiming a "complete" run behind.
  assertNonEmptyCases(cases, { entry: "plain sweep", only, casesDir, kind: null, loadedCount });
  const judgementsPath = mintCapturePath(); // FAFF-320 — durable per-rep capture for the full sweep
  console.log(`[run-evals] capturing raw judgements → ${judgementsPath} (FAFF-320)`);
  const summary = await runEvals({ cases, driver, baseReps: repsArg ? Number(repsArg) : BASE_REPS, judgementsPath });
  const reportDir = join(HERE, "report");
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(join(reportDir, "latest.json"), JSON.stringify(summary, null, 2));
  printHeadline(summary);
  return summary.status === "complete" ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("run-evals.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { console.error(`[run-evals] ${e.message}`); process.exitCode = 1; }); // e.g. --driver local with no base URL
}
