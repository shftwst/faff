"use strict";
// ===========================================================================
// === region:factory — shadow-fidelity — FAFF-826: the read-only coordination-fidelity study. ===
//
// FAFF-826 — `faff shadow-fidelity` — the read-only coordination-fidelity study.
//
// It turns a `decision-capture export` bundle into a Gate-1 coordination-fidelity
// result: it replays each captured decision's normalised inputs through the SAME
// versioned pure kernel that produced the capture, compares the kernel's prescribed
// action against the recorded actual action, grades any divergence by decision kind
// and material consequence, joins the surrounding run's orchestration cost, and
// publishes a result reproducible from the committed corpus alone.
//
// region:factory / decision-kernel. PURE-by-construction from canonical state's view:
// it reads files and imports pure kernel functions and does NOTHING else — no
// assignment, no tracker mutation, no protected effect, no merge, no canonical
// decision. Its only writes are the report files under an explicit --out directory.
// It imports the nine in-scope kernels and reimplements none of them.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// The nine in-scope decision kernels — imported, never reimplemented.
const { nextStep } = require("./next");
const { automationEligible } = require("./eligible");
const { computeRunDoneVerdict } = require("./run-done");
const { deriveQueueState } = require("./queue-state");
const { claimVerdict } = require("./claim-verdict");
const { parkVerdict } = require("./park-verdict");
const { projectNext } = require("./project-next");
const { decideOutward } = require("./run-outward");
const { deriveRunTrigger, normalizeRunTriggerSignals } = require("./run-start");
const { KERNEL_REGISTRY } = require("./decision-capture");

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// The replay-adapter table (spec §"Versioned replay"), keyed by kernel name.
// Each entry pins the in-tree version (from KERNEL_REGISTRY — the same version
// string decision-capture stamps), the input adaptation (options object,
// positional args, or normalize-then-derive flat bundle), and the output
// normalisation (`project`) that maps EITHER the kernel's raw return OR a recorded
// `selected_action` (string or object) onto one canonical action token, so a
// prescribed value and an actual value are compared like-for-like.
//
// `readSetSource` names where a kernel's declared input-key set is read for the
// input-uncaptured guard: "signature" derives it structurally from the entry
// function's own parameter destructure/list; "registry" trusts KERNEL_REGISTRY's
// required_inputs as the complete read-set (the two normalize-then-derive kernels,
// whose normalize step reads exactly those keys — verified against source).
// ---------------------------------------------------------------------------

// project helpers — each accepts the kernel's raw return, a recorded selected_action
// object, or a bare recorded string token, and yields one comparable string.
const pStr = (v) => (typeof v === "string" ? v : null);

const REPLAY_ADAPTERS = {
  next: {
    version: KERNEL_REGISTRY.next.version,
    shape: "options",
    signatureFn: nextStep,
    readSetSource: "signature",
    call: (ni) => nextStep(ni),
    project: (v) => {
      if (typeof v === "string") return v;
      if (Array.isArray(v)) return v[0]; // [verdict, reason] tuple → verdict
      if (v && typeof v === "object") return v.verdict ?? null;
      return null;
    },
  },
  eligible: {
    version: KERNEL_REGISTRY.eligible.version,
    shape: "positional",
    signatureFn: automationEligible,
    readSetSource: "signature",
    call: (ni) => automationEligible(ni.labels, ni.automationDefault, ni.trackerPresent),
    project: (v) => {
      if (typeof v === "boolean") return v ? "eligible" : "ineligible";
      if (typeof v === "string") return v;
      if (v && typeof v === "object" && "eligible" in v) return v.eligible ? "eligible" : "ineligible";
      return null;
    },
  },
  "run-done": {
    version: KERNEL_REGISTRY["run-done"].version,
    shape: "normalize-derive",
    // policy (the optional 2nd positional arg) is handled by the run's-methodology
    // protocol rule, not the per-record structural read-set, so trust the registry.
    readSetSource: "registry",
    call: (ni) => computeRunDoneVerdict(ni), // policy omitted ⇒ structural-default ladder
    project: (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.verdict ?? null : null),
  },
  "queue-state": {
    version: KERNEL_REGISTRY["queue-state"].version,
    shape: "options",
    signatureFn: deriveQueueState,
    readSetSource: "signature",
    call: (ni) => deriveQueueState(ni),
    project: (v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return `${v.queue_empty === true}/${v.all_parked === true}`;
      return null;
    },
  },
  "claim-verdict": {
    version: KERNEL_REGISTRY["claim-verdict"].version,
    shape: "positional",
    signatureFn: claimVerdict,
    readSetSource: "signature",
    call: (ni) => claimVerdict(ni.claimedAtISO, ni.nowISO, ni.ttlHours),
    project: (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.verdict ?? null : null),
  },
  "park-verdict": {
    version: KERNEL_REGISTRY["park-verdict"].version,
    shape: "positional",
    signatureFn: parkVerdict,
    readSetSource: "signature",
    call: (ni) => parkVerdict(ni.status, ni.draftPr, ni.parkComment, ni.humanTakeover),
    project: (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.verdict ?? null : null),
  },
  "project-next": {
    version: KERNEL_REGISTRY["project-next"].version,
    shape: "options",
    signatureFn: projectNext,
    readSetSource: "signature",
    call: (ni) => projectNext(ni),
    project: (v) => {
      if (typeof v === "string") return v;
      if (v && typeof v === "object") return v.error ? "error" : `${v.action}:${v.desired}`;
      return null;
    },
  },
  "run-outward": {
    version: KERNEL_REGISTRY["run-outward"].version,
    shape: "positional",
    signatureFn: decideOutward,
    readSetSource: "signature",
    // POSITIONAL: the two resolved references collide on container/repo, so each is
    // passed whole under its argument name (never flattened into one signal bundle).
    call: (ni) => decideOutward(ni.targetRaw, ni.selfRaw),
    project: (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.reason ?? null : null),
  },
  "run-start": {
    version: KERNEL_REGISTRY["run-start"].version,
    shape: "normalize-derive",
    // normalize-then-derive like run-done, but the normalize step runs EXTERNALLY
    // (deriveRunTrigger requires an already-normalized bundle).
    readSetSource: "registry",
    call: (ni) => deriveRunTrigger(normalizeRunTriggerSignals(ni)),
    project: (v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.verdict ?? null : null),
  },
};

const IN_SCOPE_KERNELS = Object.keys(REPLAY_ADAPTERS).sort();

// ---------------------------------------------------------------------------
// declaredInputKeys — structurally extract a function's declared input-key set from
// its source: the first-parameter object-destructure keys for an options kernel, or
// the positional parameter identifiers for a positional kernel. This is what keeps
// the input-uncaptured guard correct as kernels evolve — a new destructured key
// (e.g. next's awaitingSpecReview) is picked up automatically, never hardcoded.
// ---------------------------------------------------------------------------
function declaredInputKeys(fn) {
  const src = String(fn);
  const head = src.slice(0, src.indexOf(")") + 1);
  const destructure = head.match(/\(\s*\{([\s\S]*?)\}/);
  const cleanKeys = (raw) =>
    raw
      .split(",")
      .map((s) => s.trim().split(/[:=]/)[0].trim())
      .filter((s) => s && /^[A-Za-z_$][\w$]*$/.test(s));
  if (destructure) return cleanKeys(destructure[1]);
  const params = head.match(/\(([^)]*)\)/);
  return params ? cleanKeys(params[1]) : [];
}

// optionalInputs — inputs the kernel READS that sit OUTSIDE its required_inputs.
// A replayable record that omits any of these is `input-uncaptured` (excluded).
function optionalInputs(kernel) {
  const adapter = REPLAY_ADAPTERS[kernel];
  if (!adapter || adapter.readSetSource !== "signature") return []; // run-done/run-start ⇒ registry read-set == required
  const declared = declaredInputKeys(adapter.signatureFn);
  const required = KERNEL_REGISTRY[kernel].required_inputs;
  return declared.filter((k) => !required.includes(k));
}

// ---------------------------------------------------------------------------
// Consequence grading (spec §"Coverage strata, then divergence"). The DEFAULT
// rule-set the protocol states for human ratification BEFORE results are read
// (the Punt). Each rule returns "harmless" | "wasteful" | "wrong" for a divergence
// (prescribed !== actual). The default bias is "wasteful"; a rule promotes the
// safety-bearing cases to "wrong" and the equivalent-route cases to "harmless".
// ---------------------------------------------------------------------------
const NEXT_SAFETY = new Set(["needs-human", "blocked", "skip-ineligible"]);
const NEXT_TERMINAL = new Set(["done", "none"]);
const OUTWARD_INWARD = new Set(["self-marked", "self-container", "self-referential", "unresolved-target"]);

const CONSEQUENCE_RULES = {
  next: (p, a) => {
    if (NEXT_TERMINAL.has(p) && NEXT_TERMINAL.has(a)) return "harmless"; // both terminal no-ops
    if (NEXT_SAFETY.has(p) && !NEXT_SAFETY.has(a)) return "wrong"; // bypassed a gate the kernel raised
    return "wasteful";
  },
  eligible: (p, a) => (p === "ineligible" && a === "eligible" ? "wrong" : "wasteful"), // touched an ineligible ticket
  "run-done": (p, a) => (p === "escalate" && a !== "escalate" ? "wrong" : "wasteful"), // bypassed a safety floor
  "queue-state": () => "wasteful", // a read-model pair mismatch is rarely unsafe on its own
  "claim-verdict": (p, a) => (p === "live" && a === "stale" ? "wrong" : "wasteful"), // reclaimed a still-live claim
  "park-verdict": (p, a) => (p === "protect" && a === "strip-ok" ? "wrong" : "wasteful"), // stripped a label to protect
  "project-next": () => "wasteful", // container state-coherence, rarely unsafe
  "run-outward": (p, a) => (OUTWARD_INWARD.has(p) && a === "outward-adopter" ? "wrong" : "wasteful"), // acted outward when it should not
  "run-start": (p, a) => (p === "refuse" && a !== "refuse" ? "wrong" : "wasteful"), // started a run the ladder refused
};

function gradeConsequence(kernel, prescribed, actual) {
  const rule = CONSEQUENCE_RULES[kernel];
  return rule ? rule(prescribed, actual) : "wasteful";
}

// ---------------------------------------------------------------------------
// Set-aside derivation from map + registry (spec §"What" Chosen). NEVER hardcoded:
//   in-scope       = mapDecisionKernelCommands ∩ REPLAY_ADAPTERS  (the replayable nine)
//   set-aside (dk) = mapDecisionKernelCommands − KERNEL_REGISTRY   (decision-kernel per
//                    the map but not instrumented/replayable: state, run-ledger,
//                    decision-capture)
//   set-aside (nk) = KERNEL_REGISTRY − mapDecisionKernelCommands   (instrumented but NOT
//                    decision-kernel per the map: tier, regions)
// ---------------------------------------------------------------------------
const SET_ASIDE_REASONS = {
  state: "read-model producer, not a prescribe-an-action predicate — no verdict to compare against selected_action",
  "run-ledger": "record-mint entry (a record writer), not a pure prescribe-an-action predicate",
  "decision-capture": "the instrumentation itself, not a decision the shadow would replay",
  tier: "instrumented but classified software-delivery-policy by the state-authority map, not a coordinator-transition decision",
  regions: "instrumented but classified harness-and-skill-orchestration by the state-authority map, not a coordinator-transition decision",
};

function deriveScope(mapDecisionKernelCommands) {
  const mapSet = new Set(mapDecisionKernelCommands);
  const registryNames = new Set(Object.keys(KERNEL_REGISTRY));
  const inScope = IN_SCOPE_KERNELS.filter((k) => mapSet.has(k));
  const setAsideDk = [...mapSet].filter((c) => !registryNames.has(c)).sort(); // dk-per-map, not replayable
  const setAsideNonDk = [...registryNames].filter((c) => !mapSet.has(c)).sort(); // instrumented, non-dk
  const setAsideCommands = [...new Set([...setAsideDk, ...setAsideNonDk])].sort();
  return { inScope, setAsideCommands, setAsideDk, setAsideNonDk };
}

// ---------------------------------------------------------------------------
// analyzeCorpus — the PURE study core. `records` are the exported corpus envelopes
// ({run_id, seq, data:{kernel, kernel_version, normalised_inputs, selected_action,
// coverage, missing_inputs}}). Returns the full corpus-derived result (no cost — cost
// is snapshotted separately by the CLI, since its source artifacts are gitignored).
// ---------------------------------------------------------------------------
function analyzeCorpus(records, opts = {}) {
  const mapCommands = opts.mapDecisionKernelCommands || [];
  const nonDefaultPolicyRuns = new Set(opts.knownNonDefaultPolicyRuns || []);
  const { inScope, setAsideCommands, setAsideDk, setAsideNonDk } = deriveScope(mapCommands);

  const coverage = { replayable: 0, uncovered: 0, missing_input: 0 };
  const matrix = {};
  for (const k of inScope) matrix[k] = { agreement: 0, harmless: 0, wasteful: 0, wrong: 0, denominator: 0 };

  const divergences = [];
  const exclusions = { version_skew: [], input_uncaptured: [], replay_error: [] };
  const missingInputRecords = [];
  const uncoveredRecords = [];
  const setAsideCounts = {};
  for (const c of setAsideCommands) setAsideCounts[c] = 0;

  for (const rec of records) {
    const d = rec && rec.data ? rec.data : {};
    const kernel = d.kernel;
    const at = { run_id: rec.run_id ?? null, seq: rec.seq ?? null };

    // Coverage strata (map the capture's non-replayable onto missing-input).
    if (d.coverage === "uncovered") {
      coverage.uncovered++;
      uncoveredRecords.push({ kernel, ...at });
      if (Object.prototype.hasOwnProperty.call(setAsideCounts, kernel)) setAsideCounts[kernel]++;
      continue;
    }
    if (d.coverage === "non-replayable") {
      coverage.missing_input++;
      missingInputRecords.push({ kernel, missing_inputs: d.missing_inputs || [], ...at });
      if (Object.prototype.hasOwnProperty.call(setAsideCounts, kernel)) setAsideCounts[kernel]++;
      continue;
    }
    // From here: coverage === "replayable".
    coverage.replayable++;

    // A replayable record for a kernel outside the replay set (tier/regions, or any
    // non-scope kernel) is set aside — counted, never replayed, never divergence-graded.
    if (!REPLAY_ADAPTERS[kernel]) {
      if (Object.prototype.hasOwnProperty.call(setAsideCounts, kernel)) setAsideCounts[kernel]++;
      continue;
    }
    const adapter = REPLAY_ADAPTERS[kernel];

    // Version skew — the in-tree kernel no longer exports the captured version.
    if (d.kernel_version !== adapter.version) {
      exclusions.version_skew.push({ kernel, captured_version: d.kernel_version, in_tree_version: adapter.version, ...at });
      continue;
    }

    // Input-uncaptured — an optional input the kernel reads but the record omitted.
    const ni = d.normalised_inputs || {};
    let uncaptured = null;
    for (const optKey of optionalInputs(kernel)) {
      if (!Object.prototype.hasOwnProperty.call(ni, optKey)) { uncaptured = optKey; break; }
    }
    // run-done's `policy` is a 2nd positional arg the record has no slot for — flagged
    // only when the run's methodology is independently known to be non-default.
    if (!uncaptured && kernel === "run-done" && nonDefaultPolicyRuns.has(rec.run_id)) uncaptured = "policy";
    if (uncaptured) {
      exclusions.input_uncaptured.push({ kernel, missing_optional: uncaptured, ...at });
      continue;
    }

    // Replay through the real versioned kernel (may throw on malformed input).
    let prescribed;
    try {
      prescribed = adapter.project(adapter.call(ni));
    } catch (e) {
      exclusions.replay_error.push({ kernel, error: e && e.message ? e.message : String(e), ...at });
      continue;
    }
    const actual = adapter.project(d.selected_action);

    matrix[kernel].denominator++;
    if (prescribed === actual) {
      matrix[kernel].agreement++;
    } else {
      const consequence = gradeConsequence(kernel, prescribed, actual);
      matrix[kernel][consequence]++;
      divergences.push({ kernel, prescribed, actual, consequence, ...at });
    }
  }

  const setAside = setAsideCommands.map((c) => ({
    command: c,
    classification: setAsideDk.includes(c) ? "decision-kernel-not-replayable" : "instrumented-non-decision-kernel",
    reason: SET_ASIDE_REASONS[c] || "set aside per the state-authority map + registry derivation",
    captured_count: setAsideCounts[c] || 0,
  }));

  const nullResult = records.length === 0;
  return {
    record_count: records.length,
    null_result: nullResult,
    null_reason: nullResult ? "no captured decisions: capture was off or sparse for the observation window" : null,
    in_scope_kernels: inScope,
    coverage,
    matrix,
    divergences,
    exclusions,
    missing_input_records: missingInputRecords,
    uncovered_records: uncoveredRecords,
    set_aside: setAside,
  };
}

// ---------------------------------------------------------------------------
// Map reader — parse the state-authority map's command table for the commands the
// map classifies `decision-kernel`. The table rows are `| \`cmd\` | region | bucket
// | ... |`; the bucket is the third cell. Derived every run so the in-scope set and
// the set-aside list can never silently drift from the map.
// ---------------------------------------------------------------------------
const STATE_AUTHORITY_MAP_REL = path.join("docs", "rfc", "rfc-superdomestique-runtime", "v5", "STATE-AUTHORITY-MAP-v5.md");

function readMapDecisionKernelCommands(root) {
  const p = path.join(root, STATE_AUTHORITY_MAP_REL);
  const raw = fs.readFileSync(p, "utf8"); // throws if absent — set-aside derivation depends on it (fail-loud)
  const out = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^\|\s*`([a-z][a-z0-9-]*)`\s*\|\s*[a-z-]+\s*\|\s*decision-kernel\s*\|/);
    if (m) out.push(m[1]);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Cost snapshot (spec §"Orchestration cost"). Read from artifacts that already
// exist, joined to each decision by run_id, computed ONCE and frozen into result.json
// (the source run artifacts are gitignored and absent on a clean checkout, so cost is
// a recorded observation, never a content-addressed reproducible output). Every read
// is best-effort: an absent/unreadable artifact yields {available:false, reason}, never
// a fault — the corpus-derived outputs are the reproducibility guarantee.
// ---------------------------------------------------------------------------
function snapshotCost(records, root) {
  const runIds = [...new Set(records.map((r) => r && r.run_id).filter(Boolean))].sort();
  const runs = {};
  let anyArtifact = false;
  for (const runId of runIds) {
    const runDir = path.join(root, ".faff", "runs", runId);
    const ledgerPath = path.join(runDir, "run-ledger.json");
    let ledger = null;
    try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); anyArtifact = true; } catch { ledger = null; }
    const signal = { intervention: null, retry: null, resume: null, latency: null, token_cost: null };
    if (!ledger) {
      runs[runId] = { available: false, reason: "run-ledger.json absent (gitignored / not on this checkout)" };
      continue;
    }
    // retry — attempts per issue in the ledger.
    try {
      const { attemptsFromLedger } = require("./budget");
      signal.retry = attemptsFromLedger(ledger);
    } catch (e) { signal.retry = { available: false, reason: `attemptsFromLedger: ${e && e.message}` }; }
    // token cost — best-effort per-run spend.
    try {
      const { measureRunSpend } = require("./budget");
      signal.token_cost = measureRunSpend({ root, runDir });
    } catch (e) { signal.token_cost = { available: false, reason: `measureRunSpend: ${e && e.message}` }; }
    // intervention — parked/needs-human outcomes recorded on the ledger.
    try {
      const outcomes = ledger && ledger.outcomes && typeof ledger.outcomes === "object" ? Object.values(ledger.outcomes) : [];
      signal.intervention = { parked: outcomes.filter((o) => o === "parked").length, needs_human: outcomes.filter((o) => o === "needs-human").length };
    } catch (e) { signal.intervention = { available: false, reason: String(e && e.message) }; }
    // resume — run-segment records on the ledger.
    try {
      const segs = ledger && Array.isArray(ledger.run_segments) ? ledger.run_segments.length : (ledger && Array.isArray(ledger.segments) ? ledger.segments.length : 0);
      signal.resume = { run_segments: segs };
    } catch (e) { signal.resume = { available: false, reason: String(e && e.message) }; }
    // latency — event ts/seq span from the run's event log.
    try {
      const evLog = path.join(runDir, "events.jsonl");
      const lines = fs.readFileSync(evLog, "utf8").split("\n").filter((l) => l.trim() !== "");
      const evs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const ts = evs.map((e) => Date.parse(e.ts)).filter((n) => Number.isFinite(n));
      signal.latency = { events: evs.length, elapsed_ms: ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : null, max_seq: evs.reduce((m, e) => (Number.isInteger(e.seq) ? Math.max(m, e.seq) : m), 0) };
    } catch (e) { signal.latency = { available: false, reason: String(e && e.message) }; }
    runs[runId] = { available: true, ...signal };
  }
  return {
    note: "cost is a recorded observation joined to the corpus by run_id, NOT a content-addressed reproducible output; the corpus digest covers only the decision-capture records",
    artifacts_present: anyArtifact,
    run_ids: runIds,
    runs,
  };
}

// ---------------------------------------------------------------------------
// The corpus-derived subset that MUST reproduce byte-identically from the committed
// corpus (coverage counts, the divergence matrix, the exclusion lists, the set-aside
// list). Cost is deliberately excluded — it is snapshotted, not reproduced.
// ---------------------------------------------------------------------------
function corpusDerived(result) {
  return {
    record_count: result.record_count,
    null_result: result.null_result,
    null_reason: result.null_reason,
    in_scope_kernels: result.in_scope_kernels,
    coverage: result.coverage,
    matrix: result.matrix,
    divergences: result.divergences,
    exclusions: result.exclusions,
    missing_input_records: result.missing_input_records,
    uncovered_records: result.uncovered_records,
    set_aside: result.set_aside,
  };
}

// ---------------------------------------------------------------------------
// Corpus IO.
// ---------------------------------------------------------------------------
function parseCorpus(bytes) {
  const records = [];
  for (const line of bytes.toString("utf8").split("\n")) {
    if (line.trim() === "") continue;
    records.push(JSON.parse(line));
  }
  return records;
}

// ---------------------------------------------------------------------------
// CLI shell — `run` (default) | `reproduce` | --selftest.
// ---------------------------------------------------------------------------
const { parseArgs, usageError } = require("./argv");
const { findRoot } = require("./shared-infra");

const SHADOW_FIDELITY_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--corpus": { arity: 1 },
    "--manifest": { arity: 1 },
    "--dir": { arity: 1 },
    "--out": { arity: 1 },
    "--root": { arity: 1 },
    "--non-default-policy-run": { arity: 1 },
    "--json": { arity: 0 },
  },
  positionals: { min: 0, max: 1, name: "verb (run|reproduce)" },
};
const SHADOW_FIDELITY_USAGE =
  "usage: faff shadow-fidelity <run --corpus FILE [--manifest FILE] [--out DIR] [--non-default-policy-run RUN_ID]...|reproduce --dir REPORTDIR> [--root DIR] [--json]";

// Resolve the map's decision-kernel command set, tolerating an absent map (git-only /
// a checkout without the RFC) by returning the empty set and a reason, so `run` never
// hard-crashes on the map read; a present map is always used.
function resolveMapCommands(root) {
  try { return { commands: readMapDecisionKernelCommands(root), source: "state-authority-map" }; }
  catch (e) { return { commands: [], source: `map-unavailable: ${e && e.message ? e.message : e}` }; }
}

function cmdRunVerb(values, root) {
  const corpusPath = values["--corpus"];
  if (!corpusPath) return usageError([{ code: "missing-value", flag: "--corpus", detail: "run requires --corpus FILE" }], SHADOW_FIDELITY_USAGE);
  let corpusBytes;
  try { corpusBytes = fs.readFileSync(corpusPath); }
  catch (e) { process.stderr.write(`faff shadow-fidelity run: cannot read --corpus ${corpusPath}: ${e.message}\n`); return 2; }
  let records;
  try { records = parseCorpus(corpusBytes); }
  catch (e) { process.stderr.write(`faff shadow-fidelity run: corpus is not valid JSONL: ${e.message}\n`); return 2; }

  // Optional manifest integrity check — the pinned corpus_sha256 must match the bytes.
  const manifestPath = values["--manifest"];
  if (manifestPath) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
    catch (e) { process.stderr.write(`faff shadow-fidelity run: cannot read --manifest ${manifestPath}: ${e.message}\n`); return 2; }
    const digest = sha256(corpusBytes);
    if (manifest.corpus_sha256 !== digest) {
      process.stderr.write(`faff shadow-fidelity run: corpus digest mismatch — manifest ${manifest.corpus_sha256}, computed ${digest}\n`);
      return 1;
    }
  }

  const { commands, source } = resolveMapCommands(root);
  const nonDefaultPolicyRuns = [].concat(values["--non-default-policy-run"] || []);
  const result = analyzeCorpus(records, { mapDecisionKernelCommands: commands, knownNonDefaultPolicyRuns: nonDefaultPolicyRuns });
  const cost = snapshotCost(records, root);
  const full = { ...result, map_source: source, cost };

  const out = values["--out"];
  if (out) {
    try {
      fs.mkdirSync(out, { recursive: true });
      // Commit the corpus + its manifest into the report dir (reproduce reads THESE).
      const corpusOut = path.join(out, "decision-corpus.jsonl");
      fs.writeFileSync(corpusOut, corpusBytes);
      const runIds = [...new Set(records.map((r) => r && r.run_id).filter(Boolean))].sort();
      const manifest = { version: "decision-corpus-1", record_count: records.length, corpus_sha256: sha256(corpusBytes), run_ids: runIds };
      fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(full, null, 2) + "\n");
    } catch (e) {
      process.stderr.write(`faff shadow-fidelity run: write to --out ${out} failed: ${e.message}\n`);
      return 2;
    }
  }

  if (values["--json"] || !out) console.log(JSON.stringify(full, null, 2));
  else console.log(JSON.stringify({ out, record_count: full.record_count, null_result: full.null_result }));
  return 0;
}

// reproduce — assert the published result reproduces from the committed corpus alone:
// recompute the corpus_sha256, assert it matches the manifest, re-run the analysis over
// the committed corpus, and assert the CORPUS-DERIVED outputs are byte-identical to the
// published result.json's; the snapshotted cost is read back, never recomputed.
function cmdReproduceVerb(values, root) {
  const dir = values["--dir"];
  if (!dir) return usageError([{ code: "missing-value", flag: "--dir", detail: "reproduce requires --dir REPORTDIR" }], SHADOW_FIDELITY_USAGE);
  let corpusBytes, manifest, published;
  try { corpusBytes = fs.readFileSync(path.join(dir, "decision-corpus.jsonl")); }
  catch (e) { process.stderr.write(`faff shadow-fidelity reproduce: cannot read decision-corpus.jsonl in ${dir}: ${e.message}\n`); return 2; }
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); }
  catch (e) { process.stderr.write(`faff shadow-fidelity reproduce: cannot read manifest.json in ${dir}: ${e.message}\n`); return 2; }
  try { published = JSON.parse(fs.readFileSync(path.join(dir, "result.json"), "utf8")); }
  catch (e) { process.stderr.write(`faff shadow-fidelity reproduce: cannot read result.json in ${dir}: ${e.message}\n`); return 2; }

  const digest = sha256(corpusBytes);
  if (manifest.corpus_sha256 !== digest) {
    process.stderr.write(`faff shadow-fidelity reproduce: corpus digest mismatch — manifest ${manifest.corpus_sha256}, computed ${digest}\n`);
    return 1;
  }
  let records;
  try { records = parseCorpus(corpusBytes); }
  catch (e) { process.stderr.write(`faff shadow-fidelity reproduce: committed corpus is not valid JSONL: ${e.message}\n`); return 2; }

  const { commands } = resolveMapCommands(root);
  const nonDefaultPolicyRuns = [].concat(values["--non-default-policy-run"] || []);
  const recomputed = analyzeCorpus(records, { mapDecisionKernelCommands: commands, knownNonDefaultPolicyRuns: nonDefaultPolicyRuns });

  const a = JSON.stringify(corpusDerived(recomputed));
  const b = JSON.stringify(corpusDerived(published));
  if (a !== b) {
    process.stderr.write("faff shadow-fidelity reproduce: corpus-derived outputs differ from the published result.json\n");
    return 1;
  }
  console.log(JSON.stringify({ reproduced: true, corpus_sha256: digest, record_count: records.length, cost_snapshot_read_back: !!published.cost }));
  return 0;
}

function cmdShadowFidelity(args) {
  if (args.includes("--selftest")) return shadowFidelitySelftest();
  const { values, positionals, errors } = parseArgs(args, SHADOW_FIDELITY_SPEC);
  if (errors.length) return usageError(errors, SHADOW_FIDELITY_USAGE);
  const root = values["--root"] || findRoot();
  const verb = positionals[0] || "run";
  if (verb === "run") return cmdRunVerb(values, root);
  if (verb === "reproduce") return cmdReproduceVerb(values, root);
  return usageError([{ code: "bad-verb", detail: `unknown verb '${verb}' (expect run|reproduce)` }], SHADOW_FIDELITY_USAGE);
}

// ---------------------------------------------------------------------------
// --selftest — in-process pure-core tests (house convention). Builds synthetic corpus
// envelopes and asserts the replay-adapter table (all nine kernels), the coverage-to-
// report mapping, the divergence grading, the set-aside derivation, and the version-skew
// and input-uncaptured (both run-done policy and next awaitingSpecReview) exclusions.
// ---------------------------------------------------------------------------
function shadowFidelitySelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  // The map's decision-kernel command set, as the live map classifies it (twelve).
  const MAP_DK = ["claim-verdict", "decision-capture", "eligible", "next", "park-verdict", "project-next", "queue-state", "run-done", "run-ledger", "run-outward", "run-start", "state"];

  // Envelope helper: a captured record with a given coverage/version, defaulting to a
  // replayable @1 record for the kernel.
  const rec = (kernel, ni, selected_action, over = {}) => ({
    type: "decision-capture",
    run_id: over.run_id || "run-x",
    seq: over.seq ?? 1,
    data: {
      kernel,
      kernel_version: over.kernel_version || (KERNEL_REGISTRY[kernel] ? KERNEL_REGISTRY[kernel].version : `${kernel}@1`),
      normalised_inputs: ni,
      selected_action,
      coverage: over.coverage || "replayable",
      missing_inputs: over.missing_inputs || [],
    },
  });

  // --- scope derivation from map + registry ---
  const scope = deriveScope(MAP_DK);
  ok("deriveScope: exactly the nine replayable decision kernels are in scope",
    JSON.stringify(scope.inScope) === JSON.stringify(IN_SCOPE_KERNELS) && scope.inScope.length === 9);
  ok("deriveScope: state/run-ledger/decision-capture set aside as decision-kernel-not-replayable",
    ["decision-capture", "run-ledger", "state"].every((c) => scope.setAsideDk.includes(c)));
  ok("deriveScope: tier/regions set aside as instrumented-non-decision-kernel",
    scope.setAsideNonDk.includes("tier") && scope.setAsideNonDk.includes("regions"));

  // --- the nine replay adapters: an agreement per kernel through the REAL function ---
  const fullNext = { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false };
  const agrees = [
    rec("next", fullNext, "graft"),
    rec("eligible", { labels: ["faff-automate"], automationDefault: "opt-in", trackerPresent: true }, "eligible"),
    rec("run-done", { queue_empty: true, all_parked: false, ledger_clean: true, budget: {}, prd_satisfied: true, inflection: "none", non_convergence: false }, "run-complete"),
    rec("queue-state", { itemKeys: ["A"], outcomes: { A: "shipped" }, terminalStates: ["shipped", "parked"] }, "true/false"),
    rec("claim-verdict", { claimedAtISO: "2026-01-01T00:00:00Z", nowISO: "2026-01-01T00:05:00Z", ttlHours: 6 }, "live"),
    rec("park-verdict", { status: "in-progress", draftPr: "present", parkComment: "none", humanTakeover: false }, "protect"),
    rec("project-next", { current: "planned", kind: "project", total: 3, active: 1, done: 0, hasDod: false, dodMet: false }, "advance:started"),
    rec("run-outward", { targetRaw: { container: "acme", repo: "x", source: "resolved" }, selfRaw: { container: "self", repo: "y", is_self: false } }, "outward-adopter"),
    rec("run-start", { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: true }, "drain"),
  ];
  const rAgree = analyzeCorpus(agrees, { mapDecisionKernelCommands: MAP_DK });
  ok("nine kernels each replay to an agreement through their real exported function",
    IN_SCOPE_KERNELS.every((k) => rAgree.matrix[k].agreement === 1 && rAgree.matrix[k].denominator === 1) && rAgree.divergences.length === 0);
  ok("coverage: nine replayable records counted", rAgree.coverage.replayable === 9);

  // --- divergence grading: one wrong, one wasteful ---
  const wrongClaim = rec("claim-verdict", { claimedAtISO: "2026-01-01T00:00:00Z", nowISO: "2026-01-01T00:05:00Z", ttlHours: 6 }, "stale"); // prescribed live, actual stale ⇒ wrong
  const wasteRunDone = rec("run-done", { queue_empty: true, all_parked: false, ledger_clean: true, budget: {}, prd_satisfied: true, inflection: "none", non_convergence: false }, "continue"); // prescribed run-complete, actual continue ⇒ wasteful
  const rDiv = analyzeCorpus([wrongClaim, wasteRunDone], { mapDecisionKernelCommands: MAP_DK });
  ok("divergence grading: a reclaimed-live claim is wrong", rDiv.matrix["claim-verdict"].wrong === 1);
  ok("divergence grading: a run-complete→continue drift is wasteful", rDiv.matrix["run-done"].wasteful === 1);
  ok("divergence detail captured for both", rDiv.divergences.length === 2);

  // --- coverage mapping: non-replayable → missing-input; uncovered stratum ---
  const miss = rec("next", { status: "todo" }, "graft", { coverage: "non-replayable", missing_inputs: ["spec", "eligible", "parked", "blocked", "ifEligible"] });
  const unc = rec("state", {}, "unknown", { coverage: "uncovered", kernel_version: "" });
  const rCov = analyzeCorpus([miss, unc], { mapDecisionKernelCommands: MAP_DK });
  ok("coverage mapping: non-replayable counted as missing-input, never replayed",
    rCov.coverage.missing_input === 1 && rCov.missing_input_records.length === 1 && rCov.divergences.length === 0);
  ok("coverage mapping: an uncovered set-aside command is counted, never a divergence",
    rCov.coverage.uncovered === 1 && rCov.set_aside.find((s) => s.command === "state").captured_count === 1);

  // --- version skew exclusion ---
  const skew = rec("next", fullNext, "graft", { kernel_version: "next@2" });
  const rSkew = analyzeCorpus([skew], { mapDecisionKernelCommands: MAP_DK });
  ok("version skew: a next@2 capture is excluded, never divergence-graded",
    rSkew.exclusions.version_skew.length === 1 && rSkew.matrix.next.denominator === 0);

  // --- input-uncaptured exclusions: next awaitingSpecReview AND run-done policy ---
  ok("optionalInputs derives next's awaitingSpecReview structurally (and nothing else)",
    JSON.stringify(optionalInputs("next")) === JSON.stringify(["awaitingSpecReview"]));
  ok("optionalInputs is empty for the other eight in-scope kernels",
    IN_SCOPE_KERNELS.filter((k) => k !== "next").every((k) => optionalInputs(k).length === 0));
  const niNoASR = { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false }; // omits awaitingSpecReview (optional)
  const uncapNext = rec("next", niNoASR, "graft");
  const rUncapNext = analyzeCorpus([uncapNext], { mapDecisionKernelCommands: MAP_DK });
  ok("input-uncaptured: a next record omitting awaitingSpecReview is excluded, not a false divergence",
    rUncapNext.exclusions.input_uncaptured.length === 1 && rUncapNext.exclusions.input_uncaptured[0].missing_optional === "awaitingSpecReview" && rUncapNext.matrix.next.denominator === 0);
  const rdPolicy = rec("run-done", { queue_empty: true, all_parked: false, ledger_clean: true, budget: {}, prd_satisfied: true, inflection: "none", non_convergence: false }, "continue", { run_id: "run-nondefault" });
  const rPolicy = analyzeCorpus([rdPolicy], { mapDecisionKernelCommands: MAP_DK, knownNonDefaultPolicyRuns: ["run-nondefault"] });
  ok("input-uncaptured: a run-done record under a known non-default policy is policy-uncaptured, excluded",
    rPolicy.exclusions.input_uncaptured.length === 1 && rPolicy.exclusions.input_uncaptured[0].missing_optional === "policy" && rPolicy.matrix["run-done"].denominator === 0);

  // --- replay error is excluded, not a divergence (malformed positional input) ---
  const badClaim = rec("claim-verdict", { claimedAtISO: "not-a-date", nowISO: "2026-01-01T00:00:00Z", ttlHours: 6 }, "live");
  const rErr = analyzeCorpus([badClaim], { mapDecisionKernelCommands: MAP_DK });
  ok("replay error: a claim-verdict record with a malformed timestamp is excluded, never divergence-graded",
    rErr.exclusions.replay_error.length === 1 && rErr.matrix["claim-verdict"].denominator === 0);

  // --- empty bundle is a null result ---
  const rNull = analyzeCorpus([], { mapDecisionKernelCommands: MAP_DK });
  ok("empty bundle → stated null result, not a pass", rNull.null_result === true && rNull.record_count === 0 && rNull.null_reason);

  // --- corpusDerived excludes cost (reproducibility boundary) ---
  ok("corpusDerived omits cost (cost is snapshotted, not reproduced)", !("cost" in corpusDerived(rAgree)));

  console.log(`RESULT ${fail === 0 ? "ok" : "FAIL"} shadow-fidelity selftest (${fail} failure${fail === 1 ? "" : "s"})`);
  return fail === 0 ? 0 : 1;
}

module.exports = {
  REPLAY_ADAPTERS,
  IN_SCOPE_KERNELS,
  declaredInputKeys,
  optionalInputs,
  gradeConsequence,
  deriveScope,
  analyzeCorpus,
  corpusDerived,
  readMapDecisionKernelCommands,
  snapshotCost,
  parseCorpus,
  cmdShadowFidelity,
  shadowFidelitySelftest,
};
