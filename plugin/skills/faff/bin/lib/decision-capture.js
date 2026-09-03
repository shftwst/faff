// ===========================================================================
// === region:factory — decision-capture — FAFF-821: read-only instrumentation of the current ===
// decision-kernel inputs and chosen actions, for Phase-1 orchestration-fidelity measurement.
//
// Small deterministic CLI resolver (the `decisions.js`/`next.js`/`eligible.js` family): a
// pure core (KERNEL_REGISTRY + classifyCoverage + buildRecord + decisionCaptureViolations)
// behind a thin `record|list|export` CLI shell. It legally requires `events.js`
// (region governance — factory→governance is a legal require edge, ADR-0042); events.js
// must NEVER require this module back (see the mirror comment on eventViolations'
// decision-capture block there).
//
// Capture is authority-inert and best-effort by construction (spec §1/§4): it performs no
// assignment, no protected effect, no canonical decision — its sole side effect is
// appending one `decision-capture` event via `appendEventRecord`, so it inherits the
// FAFF-564 hash chain and the FAFF-107 known-secret redaction rather than forking either.
// `record` NEVER throws to its caller and NEVER exits non-zero: every failure path
// (disabled, malformed stdin, a non-replayable/invalid shape, a journal append fault) is
// swallowed, logged to stderr + a `.faff/logs/decision-capture.jsonl` degraded-capture
// note, and answered with exit 0 — a capture defect must never change an authoritative
// outcome (spec §1, BEST-EFFORT-FAIL). Disabled by default (config `capture.decision_kernel`
// must read exactly "on"); coverage is ALWAYS computed by the pure core, never trusted from
// a caller-supplied flag.
// ===========================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, usageError } = require("./argv");
const { findRoot, resolveRunDir, latestRunDir, dig } = require("./shared-infra");
const { loadConfig } = require("./config");
const { appendEventRecord, tailReadState, sha256Hex, HEX64_RE } = require("./events");
const { sha256 } = require("./integrity-digest");
const { redactKnownSecrets, resolveKnownSecretValues } = require("./redact");

// ---------------------------------------------------------------------------
// KERNEL_REGISTRY — the ratified Phase-1 seed set (spec §7): EXACTLY these six named
// decision kernels, no others. Each entry's `required_inputs` is derived from that
// kernel's CURRENT exported pure-function call contract (top-level option-object keys for
// an options-object kernel, positional-arg names for a positional kernel), validated
// against its own `--selftest` cases — never guessed. A decision by any function outside
// this registry records coverage=uncovered (spec §4 edge cases); the registry is read-only
// for the fidelity study and may only be EXPANDED by a later protocol version.
// ---------------------------------------------------------------------------
const KERNEL_REGISTRY = {
  // derived from next.js nextStep({status, spec, eligible, parked, blocked, ifEligible,
  // awaitingSpecReview}) — the options-object's SEVEN top-level keys, validated against
  // nextSelftest's case table. FAFF-956 reconciled this to the full declared signature:
  // in-kernel capture sources every key from `cmdNext`'s own `state` object, so all seven
  // are present by construction and a captured `next` record is always input-complete.
  next: {
    version: "next@1",
    required_inputs: ["status", "spec", "eligible", "parked", "blocked", "ifEligible", "awaitingSpecReview"],
  },
  // derived from eligible.js automationEligible(labels, automationDefault, trackerPresent) —
  // the three positional-arg names, validated against runEligibleCases/ELIGIBLE_CASES.
  eligible: {
    version: "eligible@1",
    required_inputs: ["labels", "automationDefault", "trackerPresent"],
  },
  // derived from tier.js tier(features, params)/tierScore(features, params) — the `features`
  // object's own contract as extracted by extractSpecFeatures (spec_lines, done_items,
  // scenario_count, confidence); `gate_history` is an OPTIONAL cmdTier-merged extra (spec
  // §3: "omitted => no contribution"), so it is deliberately excluded from required_inputs.
  // Validated against tierSelftest's extractSpecFeatures/tier cases.
  tier: {
    version: "tier@1",
    required_inputs: ["spec_lines", "done_items", "scenario_count", "confidence"],
  },
  // derived from run-done.js computeRunDoneVerdict(rawSignals, policy) via normalizeRunSignals's
  // read set — the seven top-level RunSignals keys the pure core actually consumes (`policy` is
  // a separate, optional second argument — a methodology-supplied ladder override, not part of
  // the RunSignals bundle itself). Validated against runDoneSelftest's case table.
  "run-done": {
    version: "run-done@1",
    required_inputs: ["queue_empty", "all_parked", "ledger_clean", "budget", "prd_satisfied", "inflection", "non_convergence"],
  },
  // derived from queue-state.js deriveQueueState({itemKeys, outcomes, terminalStates}) — the
  // pure differ core's three option-object keys, validated against queueStateSelftest's case
  // table (`cmdDerive`'s own itemKeys/outcomes/terminalStates resolution mirrors this exactly).
  "queue-state": {
    version: "queue-state@1",
    required_inputs: ["itemKeys", "outcomes", "terminalStates"],
  },
  // derived from regions.js regionsCheck(files) — the require-graph direction-lint's actual
  // decision function: a files (source-set paths) -> {malformed, violations} verdict. Its
  // "decision" is genuinely a files->violations check (not an options-object of named signals
  // like the other five), so its one positional argument is recorded as-is, validated against
  // regionsSelftest's fixture table.
  regions: {
    version: "regions@1",
    required_inputs: ["files"],
  },
  // FAFF-947 widening: the five decision-kernel predicates the state-authority
  // map classifies as decision-kernel that FAFF-821 left uninstrumented. `state` is
  // deliberately absent (a read-model producer, not a prescribe-an-action
  // predicate: it reads the filesystem and emits an issue's resolved state with
  // status/eligible/blocked fixed to "unknown", so there is no verdict to replay
  // against selected_action); `run-ledger`/`decision-capture` are likewise out
  // of scope (a record-mint entry and the instrumentation itself).
  // derived from claim-verdict.js claimVerdict(claimedAtISO, nowISO, ttlHours) —
  // the three positional argument names, in order (the eligible/regions positional
  // precedent), validated against claimVerdictSelftest/CLAIM_VERDICT_CASES.
  "claim-verdict": {
    version: "claim-verdict@1",
    required_inputs: ["claimedAtISO", "nowISO", "ttlHours"],
  },
  // derived from park-verdict.js parkVerdict(status, draftPr, parkComment, humanTakeover) —
  // the four positional argument names, in order; validated against parkVerdictSelftest.
  "park-verdict": {
    version: "park-verdict@1",
    required_inputs: ["status", "draftPr", "parkComment", "humanTakeover"],
  },
  // derived from project-next.js projectNext({current, kind, total, active, done, hasDod, dodMet}) —
  // all seven options-object keys (none optional: dodMet/hasDod gate the DoD Done
  // path, the counts drive the all-done rollup); validated against projectNextSelftest.
  "project-next": {
    version: "project-next@1",
    required_inputs: ["current", "kind", "total", "active", "done", "hasDod", "dodMet"],
  },
  // derived from run-outward.js decideOutward(targetRaw, selfRaw) — recorded POSITIONAL,
  // NOT flat-bundle: normalizeTargetRef -> {container, repo, source} and normalizeSelfRef
  // -> {container, repo, is_self} collide on container/repo, so a single flat signal list
  // cannot disambiguate the two references. Each resolved reference is captured whole under
  // its argument name (the eligible/regions positional precedent); normalize* is idempotent
  // on an already-resolved ref, so replay re-normalization is a no-op. Validated against
  // runOutwardSelftest.
  "run-outward": {
    version: "run-outward@1",
    required_inputs: ["targetRaw", "selfRaw"],
  },
  // derived from run-start.js deriveRunTrigger(normalizeRunTriggerSignals(raw)) — the seven
  // flat signal keys the normalize step reads (the run-done normalize-then-derive precedent,
  // since run-start is its mirror predicate); validated against runStartSelftest.
  "run-start": {
    version: "run-start@1",
    required_inputs: ["target_resolved", "outward", "prd_present", "prd_ambiguous", "prd_admissible", "coverage_measurable", "coverage_covered"],
  },
};

// The ratified eleven-name set, sorted — the born-verifiable DoD assertion.
// FAFF-947 widened this from the FAFF-821 six by adding the five replayable
// decision-kernel predicates above.
const KERNEL_REGISTRY_RATIFIED_NAMES = ["claim-verdict", "eligible", "next", "park-verdict", "project-next", "queue-state", "regions", "run-done", "run-outward", "run-start", "tier"];

// ---------------------------------------------------------------------------
// classifyCoverage — the PROCEDURE from spec §4 "Coverage classification". Pure: no I/O,
// never trusts a caller-supplied coverage value.
// ---------------------------------------------------------------------------
function classifyCoverage(kernel, normalisedInputs) {
  const spec = KERNEL_REGISTRY[kernel];
  if (!spec) return { coverage: "uncovered", kernel_version: "", missing_inputs: [] };
  const inputs = (normalisedInputs && typeof normalisedInputs === "object" && !Array.isArray(normalisedInputs)) ? normalisedInputs : {};
  const missing = spec.required_inputs.filter((k) => !Object.prototype.hasOwnProperty.call(inputs, k));
  if (missing.length) return { coverage: "non-replayable", kernel_version: spec.version, missing_inputs: missing };
  return { coverage: "replayable", kernel_version: spec.version, missing_inputs: [] };
}

// ---------------------------------------------------------------------------
// buildRecord — pure assembler of the DecisionCapture record (spec §3's type). The caller
// (cmdRecordVerb below) supplies every field; this function performs no computation of its
// own beyond a defensive normalised_inputs type-guard (classifyCoverage above is the single
// source of the coverage/kernel_version/missing_inputs triple).
// ---------------------------------------------------------------------------
function buildRecord(kernel, kernel_version, normalised_inputs, selected_action, coverage, missing_inputs, causation) {
  return {
    kernel,
    kernel_version,
    normalised_inputs: (normalised_inputs && typeof normalised_inputs === "object" && !Array.isArray(normalised_inputs)) ? normalised_inputs : {},
    selected_action,
    coverage,
    missing_inputs: Array.isArray(missing_inputs) ? missing_inputs : [],
    causation,
  };
}

const DECISION_CAPTURE_COVERAGE_VALUES = new Set(["replayable", "non-replayable", "uncovered"]);

// ---------------------------------------------------------------------------
// buildBaseRecord — FAFF-956 pure assembler of the DecisionCaptureBase record (spec §3's
// type): the deterministic `{normalised_inputs, verdict}` record minted INSIDE the kernel
// CLI, carrying a `correlation_id` (the join key an action marker references) and NO
// `selected_action`. The kernel cannot see its own downstream action, so the base is
// captured here and the action is joined later by correlation id.
// ---------------------------------------------------------------------------
function buildBaseRecord(kernel, kernel_version, normalised_inputs, verdict, coverage, missing_inputs, correlation_id, causation) {
  return {
    kernel,
    kernel_version,
    normalised_inputs: (normalised_inputs && typeof normalised_inputs === "object" && !Array.isArray(normalised_inputs)) ? normalised_inputs : {},
    verdict,
    coverage,
    missing_inputs: Array.isArray(missing_inputs) ? missing_inputs : [],
    correlation_id: typeof correlation_id === "string" ? correlation_id : "",
    causation,
  };
}

// mintCorrelationId — FAFF-989. The ONE place a correlation id is formed, so a base's id and
// its action marker's id are the same string BY CONSTRUCTION (derived once, reused), never two
// separate prose interpolations that can silently disagree. Canonical shape `<run>/<issue>/<kernel>/<wave>`;
// an absent/empty wave defaults to "1". Pure — used by the `decide` driver (which exports it into
// FAFF_DECISION_CORRELATION_ID for the in-kernel base capture) and by the `action` verb (which
// re-derives the identical id when --correlates is omitted).
function mintCorrelationId(run, issue, kernel, wave) {
  const w = (wave === undefined || wave === null || wave === "") ? "1" : String(wave);
  return `${run}/${issue}/${kernel}/${w}`;
}

// The shared {seq, sha256} causation shape check, used by every record-shape validator here.
function causationViolations(c) {
  const v = [];
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    v.push("data.causation must be an object {seq, sha256}");
    return v;
  }
  if (!Number.isInteger(c.seq)) v.push("data.causation.seq must be an integer");
  if (typeof c.sha256 !== "string" || !HEX64_RE.test(c.sha256)) v.push("data.causation.sha256 must be 64 lowercase hex chars (SHA-256)");
  return v;
}

// A selected_action / verdict leaf is a bare string OR a non-null, non-array object.
function isStringOrObject(x) {
  return typeof x === "string" || (x !== null && typeof x === "object" && !Array.isArray(x));
}

// ---------------------------------------------------------------------------
// decisionCaptureViolations — the pure DecisionCapture shape validator (spec §3's type,
// point 5 of the house-convention brief). Deliberately DUPLICATED (not required) from
// events.js's inline `type === "decision-capture"` block inside eventViolations: this
// module already requires events.js for appendEventRecord (factory→governance, legal,
// ADR-0042), and governance must never require factory back, so events.js cannot reuse
// THIS copy via a require edge. The two copies share the same RULES, kept in sync by
// hand — see the mirror comment in events.js. This copy is what `record` (below) calls
// before ever appending, and what `--selftest` unit-tests directly.
// ---------------------------------------------------------------------------
function decisionCaptureViolations(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return ["decision-capture data must be an object"];
  }
  const v = [];
  if (typeof data.kernel !== "string" || data.kernel === "") {
    v.push("data.kernel must be a non-empty string");
  }
  if (typeof data.kernel_version !== "string") {
    v.push("data.kernel_version must be a string");
  }
  if (!DECISION_CAPTURE_COVERAGE_VALUES.has(data.coverage)) {
    v.push(`data.coverage ${JSON.stringify(data.coverage)} not in {${[...DECISION_CAPTURE_COVERAGE_VALUES].join(", ")}}`);
  }
  if (data.normalised_inputs === null || typeof data.normalised_inputs !== "object" || Array.isArray(data.normalised_inputs)) {
    v.push("data.normalised_inputs must be a plain object");
  }
  // FAFF-956: two accepted shapes. LEGACY combined (selected_action present) is the
  // FAFF-954/821 record the five pilot records use; BASE (selected_action absent) is the
  // new deterministic in-kernel record carrying `verdict` + `correlation_id`, joined to a
  // separate action marker later. Presence of `selected_action` is the discriminator.
  if (data.selected_action !== undefined) {
    if (!isStringOrObject(data.selected_action)) {
      v.push("data.selected_action must be an object or a string");
    }
  } else {
    if (data.verdict === undefined || !isStringOrObject(data.verdict)) {
      v.push("base record data.verdict must be an object or a string");
    }
    // correlation_id is the join key; it may be "" (a hard-to-join base that lands
    // action-uncaptured at analysis, the safe direction — never a crash, never agreement).
    if (typeof data.correlation_id !== "string") {
      v.push("base record data.correlation_id must be a string");
    }
  }
  if (!Array.isArray(data.missing_inputs) || !data.missing_inputs.every((x) => typeof x === "string")) {
    v.push("data.missing_inputs must be an array of strings");
  } else if (data.coverage === "non-replayable" && data.missing_inputs.length === 0) {
    v.push("data.missing_inputs must be non-empty when coverage is non-replayable");
  } else if (data.coverage !== "non-replayable" && data.missing_inputs.length > 0) {
    v.push(`data.missing_inputs must be empty when coverage is ${JSON.stringify(data.coverage)}`);
  }
  v.push(...causationViolations(data.causation));
  return v;
}

// ---------------------------------------------------------------------------
// decisionCaptureActionViolations — FAFF-956 shape validator for the DecisionCaptureAction
// marker (type "decision-capture-action"): the separate record carrying the orchestrator's
// actual `selected_action` plus the `correlation_id` that references exactly one base
// record. Same hand-mirrored discipline as decisionCaptureViolations (the events.js copy is
// kept in sync by hand — governance must never require factory back, ADR-0042).
// ---------------------------------------------------------------------------
function decisionCaptureActionViolations(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return ["decision-capture-action data must be an object"];
  }
  const v = [];
  if (typeof data.kernel !== "string" || data.kernel === "") {
    v.push("data.kernel must be a non-empty string");
  }
  if (typeof data.correlation_id !== "string" || data.correlation_id === "") {
    v.push("data.correlation_id must be a non-empty string");
  }
  if (!isStringOrObject(data.selected_action)) {
    v.push("data.selected_action must be an object or a string");
  }
  v.push(...causationViolations(data.causation));
  return v;
}

// ---------------------------------------------------------------------------
// The impure shell — config gate, stdin parse, run-dir resolve, chain-head read, append.
// ---------------------------------------------------------------------------

// FAFF-821: gated on config `capture.decision_kernel` == "on" — default OFF (unset or any
// other value), mirroring andon.js's loadConfig/dig read pattern. May throw (a malformed
// base/overlay config) — the caller routes that through BEST-EFFORT-FAIL, never a crash.
function captureEnabled(root) {
  const [data] = loadConfig(root);
  return dig(data, "capture.decision_kernel") === "on";
}

// BEST-EFFORT-FAIL (spec §4): write the reason to stderr AND a degraded-capture note under
// `.faff/logs/`, then ALWAYS return 0 — a capture-path defect must never surface as a
// non-zero exit an orchestrator could trip on. The note write is itself wrapped so a
// logging fault can never escalate into the very propagation this exists to prevent.
function bestEffortFail(root, run, reason) {
  process.stderr.write(`faff decision-capture record: degraded capture — ${reason}\n`);
  try {
    const logsDir = path.join(root, ".faff", "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const note = { ts: new Date().toISOString(), run: run || null, note: "degraded-capture", reason: String(reason) };
    fs.appendFileSync(path.join(logsDir, "decision-capture.jsonl"), JSON.stringify(note) + "\n");
  } catch { /* best-effort: a logging fault must never propagate either */ }
  return 0;
}

function cmdRecordVerb(values, root) {
  const run = values["--run"];
  const issue = values["--issue"];
  const kernel = values["--kernel"];

  let enabled;
  try {
    enabled = captureEnabled(root);
  } catch (e) {
    return bestEffortFail(root, run, `config read failed: ${e && e.message}`);
  }
  if (!enabled) return 0; // disabled ⇒ no-op, exit 0, no event written (the default posture)

  let raw;
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch (e) {
    return bestEffortFail(root, run, `cannot read stdin: ${e && e.message}`);
  }

  let parsed = {};
  const trimmed = (raw || "").trim();
  if (trimmed !== "") {
    try {
      parsed = JSON.parse(trimmed);
    } catch (e) {
      return bestEffortFail(root, run, `malformed stdin JSON: ${e.message}`);
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return bestEffortFail(root, run, "stdin JSON must be an object ({normalised_inputs, selected_action})");
  }

  const normalised_inputs = (parsed.normalised_inputs && typeof parsed.normalised_inputs === "object" && !Array.isArray(parsed.normalised_inputs))
    ? parsed.normalised_inputs : {};
  // stdin JSON is primary; --action is an override/supply-when-absent (house-convention
  // brief point 6 — the PROCEDURE, not the abbreviated CLI-surface one-liner, is load-bearing).
  let selected_action = parsed.selected_action;
  if (selected_action === undefined && values["--action"] !== undefined) {
    try {
      selected_action = JSON.parse(values["--action"]);
    } catch {
      selected_action = values["--action"]; // a bare string action is legal per the DecisionCapture type
    }
  }

  const { coverage, kernel_version, missing_inputs } = classifyCoverage(kernel, normalised_inputs);

  let dir;
  try {
    dir = resolveRunDir(root, run, values["--root"] !== undefined);
  } catch (e) {
    return bestEffortFail(root, run, `run dir resolution failed: ${e && e.message}`);
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return bestEffortFail(root, run, `run dir missing: ${dir}`);
  }

  // causation: {seq, sha256} of the CURRENT chain head, read BEFORE the new record is
  // appended (spec §4 step 4). Reuses events.js's own tail-read core — never a second
  // implementation of the physical-line hashing rule. A run whose events.jsonl carries no
  // prior parseable record has no chain head to anchor a causation pointer to; that is
  // itself a degraded-capture condition (never a fabricated/genesis-hashed causation).
  let causation;
  try {
    const { prevRecord, prevLineBuf } = tailReadState(path.join(dir, "events.jsonl"));
    if (!prevRecord || !prevLineBuf) {
      return bestEffortFail(root, run, "no prior chain head in events.jsonl to anchor causation");
    }
    causation = { seq: prevRecord.seq, sha256: sha256Hex(prevLineBuf) };
  } catch (e) {
    return bestEffortFail(root, run, `chain head read failed: ${e && e.message}`);
  }

  const data = buildRecord(kernel, kernel_version, normalised_inputs, selected_action, coverage, missing_inputs, causation);
  const violations = decisionCaptureViolations(data);
  if (violations.length) {
    return bestEffortFail(root, run, `record failed shape validation: ${violations.join("; ")}`);
  }

  let record;
  try {
    record = appendEventRecord(dir, run, { phase: "run", type: "decision-capture", issue, data });
  } catch (e) {
    return bestEffortFail(root, run, `journal append failed: ${e && e.message}`);
  }
  console.log(JSON.stringify({ seq: record.seq, coverage }));
  return 0;
}

// ---------------------------------------------------------------------------
// captureDecision — FAFF-956 the in-kernel capture hook. Each `cmd<Kernel>` calls this
// AFTER computing and printing its verdict, sourcing `normalised_inputs` from the kernel's
// OWN parsed input object (canonical keys by construction — the aliasing that produced the
// five FAFF-954 missing-input records is impossible for the inputs the CLI controls). It is
// the `cmdRecordVerb` best-effort core refactored to accept an already-built inputs object
// rather than parsing stdin. AUTHORITY-INERT: it NEVER throws, NEVER writes to stdout, and
// NEVER changes the kernel's exit code — the whole body is wrapped so an unforeseen fault is
// swallowed. When the flag is off it returns before any run-dir or chain I/O, so the
// kernel's stdout bytes and exit are byte-identical to the flag-off build.
//
// `issue`: the caller passes the real issue id (per-issue kernels), the container id
// (project-next), or the literal "__run__" (the four run-level kernels). When left
// undefined it falls back to $FAFF_DECISION_ISSUE (the orchestrator-supplied id), else "".
// ---------------------------------------------------------------------------
function captureDecisionCore({ kernel, normalised_inputs, verdict, issue } = {}) {
  let root;
  try { root = findRoot(); } catch { return; } // no repo root ⇒ nothing to anchor, silent
  const runDirEnv = process.env.FAFF_RUN_DIR;
  const run = runDirEnv ? path.basename(runDirEnv) : null;

  let enabled;
  try { enabled = captureEnabled(root); }
  catch (e) { bestEffortFail(root, run, `config read failed: ${e && e.message}`); return; }
  if (!enabled) return; // disabled ⇒ byte-identical silent no-op (the default posture)

  if (!runDirEnv) { bestEffortFail(root, run, "no $FAFF_RUN_DIR — standalone call, no substrate to capture into"); return; }
  const correlation_id = process.env.FAFF_DECISION_CORRELATION_ID || "";
  // FAFF-989 (Part B): an empty correlation_id yields a base no action marker can ever join —
  // it lands `action_uncaptured` and grades nothing. Surface that loud via the degraded-capture
  // note instead of appending a silent orphan. The append STILL happens below (suppressing it is
  // a deferred, separate FAFF-956 contract-change decision, out of scope here); call bestEffortFail
  // for its note+stderr side effect only and fall through — capture stays best-effort and never
  // changes the kernel's exit code or stdout.
  if (correlation_id === "") {
    bestEffortFail(root, run, "base record has empty correlation_id — no action marker can join it; capture is ungradeable");
  }
  const issueVal = (issue === undefined || issue === null) ? (process.env.FAFF_DECISION_ISSUE || "") : issue;

  let dir;
  try { dir = resolveRunDir(root, run, false); }
  catch (e) { bestEffortFail(root, run, `run dir resolution failed: ${e && e.message}`); return; }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { bestEffortFail(root, run, `run dir missing: ${dir}`); return; }

  const { coverage, kernel_version, missing_inputs } = classifyCoverage(kernel, normalised_inputs);

  let causation;
  try {
    const { prevRecord, prevLineBuf } = tailReadState(path.join(dir, "events.jsonl"));
    if (!prevRecord || !prevLineBuf) { bestEffortFail(root, run, "no prior chain head in events.jsonl to anchor causation"); return; }
    causation = { seq: prevRecord.seq, sha256: sha256Hex(prevLineBuf) };
  } catch (e) { bestEffortFail(root, run, `chain head read failed: ${e && e.message}`); return; }

  const data = buildBaseRecord(kernel, kernel_version, normalised_inputs, verdict, coverage, missing_inputs, correlation_id, causation);
  const violations = decisionCaptureViolations(data);
  if (violations.length) { bestEffortFail(root, run, `base record failed shape validation: ${violations.join("; ")}`); return; }

  try {
    appendEventRecord(dir, run, { phase: "run", type: "decision-capture", issue: issueVal, data });
  } catch (e) { bestEffortFail(root, run, `journal append failed: ${e && e.message}`); return; }
  // NO stdout: the authoritative kernel already printed its verdict; capture is a side effect.
}

// The never-throw wrapper the kernels call. A capture-path defect must never surface to an
// authoritative command as a throw or a non-zero exit (spec §1 BEST-EFFORT-FAIL).
function captureDecision(args) {
  try { captureDecisionCore(args); } catch { /* best-effort: capture never fails a kernel */ }
}

// ---------------------------------------------------------------------------
// cmdDecideVerb — FAFF-989 `faff decision-capture decide`. The set-env half of the driver: mint
// the correlation id ONCE (mintCorrelationId) and emit it, so the orchestrator exports it before
// the kernel call and the paired `action` marker re-derives the identical id. `--export` prints two
// shell-eval-able lines (FAFF_DECISION_CORRELATION_ID + FAFF_DECISION_ISSUE) for `eval "$(...)"`;
// otherwise it prints the bare id. Pure and gate-agnostic: it only forms + prints an id (the env is
// inert when capture is off, since captureDecisionCore / cmdActionVerb both no-op under the gate),
// so it never reads config, touches a run dir, or writes an event. `--run` defaults to the basename
// of $FAFF_RUN_DIR; `--wave` defaults to "1".
// ---------------------------------------------------------------------------
function cmdDecideVerb(values) {
  const issue = values["--issue"];
  const kernel = values["--kernel"];
  const run = values["--run"] || (process.env.FAFF_RUN_DIR ? path.basename(process.env.FAFF_RUN_DIR) : null);
  if (run == null) {
    process.stderr.write("faff decision-capture decide: no --run and no $FAFF_RUN_DIR — cannot mint a correlation id\n");
    return 2;
  }
  const cid = mintCorrelationId(run, issue, kernel, values["--wave"]);
  if (values["--export"] !== undefined) {
    // single-quote the values so a shell `eval` cannot re-interpret them
    const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
    console.log(`export FAFF_DECISION_CORRELATION_ID=${q(cid)}`);
    console.log(`export FAFF_DECISION_ISSUE=${q(issue)}`);
  } else {
    console.log(cid);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// cmdActionVerb — FAFF-956 `faff decision-capture action`. Appends one
// `decision-capture-action` marker referencing a base record by correlation id. Same
// best-effort discipline as `record`: every failure path writes a degraded note and exits 0.
// ---------------------------------------------------------------------------
function cmdActionVerb(values, root) {
  const run = values["--run"];
  const issue = values["--issue"];
  const kernel = values["--kernel"];
  // FAFF-989: prefer an explicit --correlates, else re-derive the SAME id the base carried from
  // {run, issue, kernel, wave} via mintCorrelationId — so the marker joins by construction rather
  // than by two matching format strings. `run` here is the run id the caller passes (or the
  // basename of $FAFF_RUN_DIR); a still-empty id is caught by decisionCaptureActionViolations below.
  const runId = run || (process.env.FAFF_RUN_DIR ? path.basename(process.env.FAFF_RUN_DIR) : null);
  const correlation_id = values["--correlates"] != null
    ? values["--correlates"]
    : (runId != null && issue != null && kernel != null ? mintCorrelationId(runId, issue, kernel, values["--wave"]) : "");

  let enabled;
  try { enabled = captureEnabled(root); }
  catch (e) { return bestEffortFail(root, run, `config read failed: ${e && e.message}`); }
  if (!enabled) return 0; // disabled ⇒ no-op, exit 0

  // --action carries the actual downstream action: JSON when parseable, else a bare string.
  let selected_action = values["--action"];
  if (selected_action !== undefined) {
    try { selected_action = JSON.parse(values["--action"]); }
    catch { selected_action = values["--action"]; }
  }

  let dir;
  try { dir = resolveRunDir(root, run, values["--root"] !== undefined); }
  catch (e) { return bestEffortFail(root, run, `run dir resolution failed: ${e && e.message}`); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return bestEffortFail(root, run, `run dir missing: ${dir}`);
  }

  let causation;
  try {
    const { prevRecord, prevLineBuf } = tailReadState(path.join(dir, "events.jsonl"));
    if (!prevRecord || !prevLineBuf) {
      return bestEffortFail(root, run, "no prior chain head in events.jsonl to anchor causation");
    }
    causation = { seq: prevRecord.seq, sha256: sha256Hex(prevLineBuf) };
  } catch (e) {
    return bestEffortFail(root, run, `chain head read failed: ${e && e.message}`);
  }

  const data = { kernel, correlation_id, selected_action, causation };
  const violations = decisionCaptureActionViolations(data);
  if (violations.length) {
    return bestEffortFail(root, run, `action marker failed shape validation: ${violations.join("; ")}`);
  }

  let record;
  try {
    record = appendEventRecord(dir, run, { phase: "run", type: "decision-capture-action", issue, data });
  } catch (e) {
    return bestEffortFail(root, run, `journal append failed: ${e && e.message}`);
  }
  console.log(JSON.stringify({ seq: record.seq, correlation_id }));
  return 0;
}

// ---------------------------------------------------------------------------
// list / export — read-only corpus surfaces (spec §4 "Corpus reader / export"). Neither is
// best-effort (a genuine read/write fault here is a real error, not an instrumentation
// side-effect on an authoritative flow) — normal exit-code conventions apply.
// ---------------------------------------------------------------------------

// Resolve which run dir(s) a `list`/`export` call scans. `--run` selects one (resolved the
// same worktree-aware way `record` writes it); `--all-runs` walks every run dir under
// `.faff/runs`; neither given defaults to the single latest run dir (mirrors
// queue-state.js's `derive` default) — an empty/absent `.faff/runs` yields no dirs, never
// an error (a repo with no runs yet has an empty corpus, not a fault).
function collectRunDirs(root, runArg, allRuns) {
  if (runArg) {
    const dir = resolveRunDir(root, runArg, false);
    return (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) ? [dir] : [];
  }
  if (allRuns) {
    const runsRoot = path.join(root, ".faff", "runs");
    let names;
    try { names = fs.readdirSync(runsRoot); } catch { return []; }
    return names
      .map((n) => path.join(runsRoot, n))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } })
      .sort();
  }
  const latest = latestRunDir(root);
  return latest ? [latest] : [];
}

// Stream a run dir's events.jsonl and return every decision-capture-family record — both the
// `decision-capture` base AND the FAFF-956 `decision-capture-action` marker (full envelope, incl.
// run_id/issue/seq). FAFF-989: the marker MUST reach the exported corpus, or shadow-fidelity's
// analyzeCorpus has no marker to join a base to and every capture lands `action_uncaptured` — the
// export leak that made the join impossible even when a marker was emitted. Reuses the same
// permissive per-line JSON.parse tolerance `events read` already applies (a torn/malformed line is
// skipped, never a fault) — never a second JSONL-parsing implementation.
function readDecisionCaptureRecords(dir, note) {
  // `note` (optional) is a best-effort noting hook the anchor-source path passes so a bad
  // anchor is skipped with a stderr note (FAFF-960 AC5). Live/list callers omit it, so their
  // behaviour is byte-for-byte unchanged: torn/malformed lines are silently tolerated.
  let raw;
  try { raw = fs.readFileSync(path.join(dir, "events.jsonl"), "utf8"); }
  catch (e) { if (note) note(`unreadable events.jsonl in ${dir}: ${e.message}`); return []; }
  const out = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let obj;
    try { obj = JSON.parse(line); } catch { malformed++; continue; }
    if (obj && typeof obj === "object" && (obj.type === "decision-capture" || obj.type === "decision-capture-action")) out.push(obj);
  }
  if (malformed && note) note(`skipped ${malformed} malformed line(s) in ${path.join(dir, "events.jsonl")}`);
  return out;
}

// Return the sorted list of issue-level directories under `.faff/anchors` that hold an
// events.jsonl (FAFF-960: reach external/distributed lights-out records that reached main
// only as committed per-PR anchors). Recursive `**/events.jsonl` walk, mirroring
// bundle-recover.js's endsWith("/events.jsonl") seam; record parsing reuses
// readDecisionCaptureRecords, never a second parser. Best-effort and read-only: a missing
// `.faff/anchors` yields []; an unreadable subdirectory is skipped with a stderr note and
// the walk continues — a bad anchor never faults export.
function collectAnchorRecordDirs(root) {
  const anchorsRoot = path.join(root, ".faff", "anchors");
  const dirs = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) {
      process.stderr.write(`faff decision-capture export: skipping unreadable anchor dir ${dir}: ${e.message}\n`);
      return;
    }
    let hasEvents = false;
    for (const ent of entries) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name));
      else if (ent.isFile() && ent.name === "events.jsonl") hasEvents = true;
    }
    if (hasEvents) dirs.push(dir);
  };
  if (!fs.existsSync(anchorsRoot)) return [];
  walk(anchorsRoot);
  return dirs.sort();
}

// De-duplicate decision-capture records by the `run_id`+`seq` envelope identity (first
// occurrence wins — callers gather live run dirs before anchors, so a live record is kept
// over its byte-identical anchor copy) and return a deterministic, source-mix-invariant
// total order: well-formed records first, ascending by `run_id` (string) then `seq`
// (numeric); any record missing `run_id` or a non-integer `seq` is kept but ordered after
// all well-formed records. Every remaining tie is broken by the record's serialised bytes —
// never by original index — so the output never depends on which source a record arrived
// from. Pure: no I/O, no mutation of its inputs.
function dedupeAndOrder(records) {
  const seen = new Set();
  const kept = [];
  let malformed = 0;
  for (const rec of records) {
    const wellFormed = rec && typeof rec.run_id === "string" && Number.isInteger(rec.seq);
    // Only a well-formed record has a real run_id+seq identity to dedup on. A record
    // missing either is un-identifiable — never collapsed against another, so distinct
    // malformed records are all kept (its unique key is never re-seen).
    const key = wellFormed ? `id ${rec.run_id} ${rec.seq}` : `malformed ${malformed++}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const runId = wellFormed ? rec.run_id : "";
    const seq = wellFormed ? rec.seq : -1;
    kept.push({ rec, wf: wellFormed, runId, seq, bytes: JSON.stringify(rec) });
  }
  kept.sort((a, b) => {
    if (a.wf !== b.wf) return a.wf ? -1 : 1;           // well-formed records ordered before malformed
    if (a.runId !== b.runId) return a.runId < b.runId ? -1 : 1;
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.bytes !== b.bytes) return a.bytes < b.bytes ? -1 : 1;
    return 0;
  });
  return kept.map((k) => k.rec);
}

function cmdListVerb(values, root) {
  if (values["--run"] !== undefined && values["--all-runs"]) {
    return usageError([{ code: "bad-arity", detail: "--run and --all-runs are mutually exclusive" }], DECISION_CAPTURE_USAGE);
  }
  const coverageFilter = values["--coverage"];
  for (const dir of collectRunDirs(root, values["--run"], !!values["--all-runs"])) {
    for (const rec of readDecisionCaptureRecords(dir)) {
      if (coverageFilter && (!rec.data || rec.data.coverage !== coverageFilter)) continue;
      console.log(JSON.stringify(rec));
    }
  }
  return 0;
}

function cmdExportVerb(values, root) {
  const out = values["--out"];
  if (!out) {
    return usageError([{ code: "missing-value", flag: "--out", detail: "flag --out requires a value" }], DECISION_CAPTURE_USAGE);
  }
  const secretValues = resolveKnownSecretValues(root);
  // Live run dirs first (they win the dedup over a byte-identical anchor copy). The default
  // path (no --include-anchors) collects exactly this — live dirs only, in collectRunDirs
  // order, no dedup, no sort — so its corpus is byte-for-byte today's.
  let collected = [];
  for (const dir of collectRunDirs(root, null, true)) {
    for (const rec of readDecisionCaptureRecords(dir)) collected.push(rec);
  }
  if (values["--include-anchors"]) {
    // FAFF-960: fold in committed-anchor records so an external/distributed rig's decision
    // records that reached main (as per-PR anchors) are studyable. Best-effort; an
    // unreadable subdir is skipped inside collectAnchorRecordDirs and a bad events.jsonl is
    // skipped with a stderr note here — never a fault.
    const note = (m) => process.stderr.write(`faff decision-capture export: ${m}\n`);
    for (const dir of collectAnchorRecordDirs(root)) {
      for (const rec of readDecisionCaptureRecords(dir, note)) collected.push(rec);
    }
    collected = dedupeAndOrder(collected);
  }
  // One post-merge, publish-boundary re-redaction pass over the final record list — applied
  // identically whether a record came from a live dir or an anchor (bundle.js's export
  // precedent, FAFF-819). Records are already redacted at capture time via
  // appendEventRecord; this reuses the SAME two redact.js primitives, never a forked pass.
  const records = collected.map((rec) => redactKnownSecrets(rec, secretValues));
  try {
    fs.mkdirSync(out, { recursive: true });
  } catch (e) {
    process.stderr.write(`faff decision-capture export: cannot create --out ${out}: ${e.message}\n`);
    return 2;
  }
  const corpusBytes = Buffer.from(records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), "utf8");
  const corpusPath = path.join(out, "decision-corpus.jsonl");
  const manifestPath = path.join(out, "manifest.json");
  try {
    fs.writeFileSync(corpusPath, corpusBytes);
    const manifest = {
      version: "decision-corpus-1",
      generated_at: new Date().toISOString(),
      record_count: records.length,
      corpus_sha256: sha256(corpusBytes), // integrity-digest.js's hasher — never reimplemented
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify({ out, record_count: records.length, corpus_sha256: manifest.corpus_sha256 }));
  } catch (e) {
    process.stderr.write(`faff decision-capture export: write failed: ${e.message}\n`);
    return 2;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// CLI shell — record | list | export | --selftest.
// ---------------------------------------------------------------------------
const DECISION_CAPTURE_SPEC = {
  flags: {
    "--selftest": { arity: 0 },
    "--run": { arity: 1 },
    "--issue": { arity: 1 },
    "--kernel": { arity: 1 },
    "--action": { arity: 1 },
    "--correlates": { arity: 1 },
    "--wave": { arity: 1 },
    "--export": { arity: 0 },
    "--root": { arity: 1 },
    "--all-runs": { arity: 0 },
    "--coverage": { arity: 1, enum: ["replayable", "non-replayable", "uncovered"] },
    "--out": { arity: 1 },
    "--include-anchors": { arity: 0 },
    "--json": { arity: 0 },
  },
  positionals: { min: 0, max: null, name: "verb selector" },
};
const DECISION_CAPTURE_USAGE =
  'usage: faff decision-capture <record --run ID --issue ID --kernel NAME [--action JSON]|decide --issue ID|__run__ --kernel NAME [--run ID] [--wave N] [--export]|action --issue ID|__run__ --kernel NAME --action TOKEN [--correlates ID | --run ID [--wave N]]|list [--run ID|--all-runs] [--coverage replayable|non-replayable|uncovered]|export --out DIR [--include-anchors]> [--root DIR]';

function cmdDecisionCapture(args) {
  if (args.includes("--selftest")) return decisionCaptureSelftest();
  const { values, positionals, errors } = parseArgs(args, DECISION_CAPTURE_SPEC);
  if (errors.length) return usageError(errors, DECISION_CAPTURE_USAGE);
  const sub = positionals[0];
  const root = values["--root"] || findRoot();

  if (sub === "record") {
    if (values["--run"] == null || values["--issue"] == null || values["--kernel"] == null) {
      return usageError([{ code: "missing-value", detail: "record requires --run, --issue, and --kernel" }], DECISION_CAPTURE_USAGE);
    }
    return cmdRecordVerb(values, root);
  }
  if (sub === "decide") {
    if (values["--issue"] == null || values["--kernel"] == null) {
      return usageError([{ code: "missing-value", detail: "decide requires --issue and --kernel (--run defaults to $FAFF_RUN_DIR)" }], DECISION_CAPTURE_USAGE);
    }
    return cmdDecideVerb(values);
  }
  if (sub === "action") {
    // FAFF-989: --correlates is now OPTIONAL — the id re-derives from --run/--issue/--kernel/--wave
    // ($FAFF_RUN_DIR fills in --run). Require the fields the marker needs plus a resolvable run.
    const haveRun = values["--run"] != null || process.env.FAFF_RUN_DIR != null;
    if (values["--issue"] == null || values["--kernel"] == null || values["--action"] == null || (values["--correlates"] == null && !haveRun)) {
      return usageError([{ code: "missing-value", detail: "action requires --issue, --kernel, --action, and a correlation id (via --correlates, or derived from --run/$FAFF_RUN_DIR + --issue + --kernel [+ --wave])" }], DECISION_CAPTURE_USAGE);
    }
    return cmdActionVerb(values, root);
  }
  if (sub === "list") return cmdListVerb(values, root);
  if (sub === "export") return cmdExportVerb(values, root);

  process.stderr.write("faff decision-capture: expected one of: record | decide | action | list | export (or --selftest)\n");
  return 2;
}

// ---------------------------------------------------------------------------
// --selftest — in-process pure-core tests (house convention): classifyCoverage's 3
// branches, buildRecord's shape, decisionCaptureViolations catching each malformed field,
// the FAFF-956 base-record + action-marker shapes, and the born-verifiable DoD assertion
// that KERNEL_REGISTRY seeds EXACTLY the ratified 11-name set.
// ---------------------------------------------------------------------------
function decisionCaptureSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { fail++; console.log(`FAIL ${name}`); } else console.log(`ok   ${name}`); };

  ok("KERNEL_REGISTRY seeds EXACTLY the 11 ratified kernels (claim-verdict/eligible/next/park-verdict/project-next/queue-state/regions/run-done/run-outward/run-start/tier)",
    JSON.stringify(Object.keys(KERNEL_REGISTRY).sort()) === JSON.stringify(KERNEL_REGISTRY_RATIFIED_NAMES));
  ok("every registry entry carries a version string and a non-empty required_inputs list",
    Object.values(KERNEL_REGISTRY).every((s) => typeof s.version === "string" && s.version !== "" && Array.isArray(s.required_inputs) && s.required_inputs.length > 0));

  // --- FAFF-956: every registry entry's required_inputs equals its kernel's declared
  // signature key-set. Transcribed as literals here (decision-capture.js must NOT require
  // any kernel module — the purity test enforces that), and asserted set-equal. The
  // structural, source-derived mirror of this lives in shadow-fidelity.js's
  // `optionalInputs` (declared − required == [] for every in-scope kernel). ---
  const DECLARED_SIGNATURES = {
    next: ["status", "spec", "eligible", "parked", "blocked", "ifEligible", "awaitingSpecReview"],
    eligible: ["labels", "automationDefault", "trackerPresent"],
    tier: ["spec_lines", "done_items", "scenario_count", "confidence"],
    "run-done": ["queue_empty", "all_parked", "ledger_clean", "budget", "prd_satisfied", "inflection", "non_convergence"],
    "queue-state": ["itemKeys", "outcomes", "terminalStates"],
    regions: ["files"],
    "claim-verdict": ["claimedAtISO", "nowISO", "ttlHours"],
    "park-verdict": ["status", "draftPr", "parkComment", "humanTakeover"],
    "project-next": ["current", "kind", "total", "active", "done", "hasDod", "dodMet"],
    "run-outward": ["targetRaw", "selfRaw"],
    "run-start": ["target_resolved", "outward", "prd_present", "prd_ambiguous", "prd_admissible", "coverage_measurable", "coverage_covered"],
  };
  const sortedSet = (a) => JSON.stringify([...a].sort());
  ok("every registry entry's required_inputs equals its kernel's declared signature key-set",
    Object.keys(KERNEL_REGISTRY).every((k) => sortedSet(KERNEL_REGISTRY[k].required_inputs) === sortedSet(DECLARED_SIGNATURES[k])));
  ok("FAFF-956: next.required_inputs is reconciled to the full seven-key signature (incl. awaitingSpecReview)",
    KERNEL_REGISTRY.next.required_inputs.length === 7 && KERNEL_REGISTRY.next.required_inputs.includes("awaitingSpecReview"));

  // --- classifyCoverage: the 3 branches ---
  const unc = classifyCoverage("not-a-real-kernel", { a: 1 });
  ok("classifyCoverage: unknown kernel -> uncovered, kernel_version '', missing_inputs []",
    unc.coverage === "uncovered" && unc.kernel_version === "" && unc.missing_inputs.length === 0);

  const nonRep = classifyCoverage("next", { status: "todo" });
  ok("classifyCoverage: known kernel, missing required inputs -> non-replayable + exact missing set",
    nonRep.coverage === "non-replayable" && nonRep.kernel_version === "next@1"
    && JSON.stringify(nonRep.missing_inputs.sort()) === JSON.stringify(["awaitingSpecReview", "blocked", "eligible", "ifEligible", "parked", "spec"]));

  const fullNextInputs = { status: "todo", spec: "high", eligible: true, parked: false, blocked: false, ifEligible: false, awaitingSpecReview: false };
  const rep = classifyCoverage("next", fullNextInputs);
  ok("classifyCoverage: known kernel, all required inputs present -> replayable",
    rep.coverage === "replayable" && rep.kernel_version === "next@1" && rep.missing_inputs.length === 0);

  // --- buildRecord shape ---
  const causation = { seq: 3, sha256: "a".repeat(64) };
  const rec = buildRecord("next", "next@1", fullNextInputs, "graft", "replayable", [], causation);
  ok("buildRecord: assembles the DecisionCapture shape verbatim",
    rec.kernel === "next" && rec.kernel_version === "next@1" && rec.coverage === "replayable"
    && rec.selected_action === "graft" && Array.isArray(rec.missing_inputs) && rec.missing_inputs.length === 0
    && rec.causation.seq === 3 && rec.causation.sha256 === causation.sha256
    && JSON.stringify(rec.normalised_inputs) === JSON.stringify(fullNextInputs));

  // --- decisionCaptureViolations: a well-formed record has none ---
  ok("decisionCaptureViolations: a well-formed record has no violations", decisionCaptureViolations(rec).length === 0);
  ok("decisionCaptureViolations: a well-formed record with a STRING selected_action has no violations",
    decisionCaptureViolations({ ...rec, selected_action: "prep" }).length === 0);

  // --- decisionCaptureViolations: each malformed field is caught ---
  ok("decisionCaptureViolations: empty kernel rejected", decisionCaptureViolations({ ...rec, kernel: "" }).length > 0);
  ok("decisionCaptureViolations: non-string kernel_version rejected", decisionCaptureViolations({ ...rec, kernel_version: null }).length > 0);
  ok("decisionCaptureViolations: coverage outside the enum rejected", decisionCaptureViolations({ ...rec, coverage: "bogus" }).length > 0);
  ok("decisionCaptureViolations: non-object normalised_inputs rejected", decisionCaptureViolations({ ...rec, normalised_inputs: "nope" }).length > 0);
  ok("decisionCaptureViolations: array normalised_inputs rejected", decisionCaptureViolations({ ...rec, normalised_inputs: [] }).length > 0);
  ok("decisionCaptureViolations: null selected_action rejected", decisionCaptureViolations({ ...rec, selected_action: null }).length > 0);
  ok("decisionCaptureViolations: numeric selected_action rejected", decisionCaptureViolations({ ...rec, selected_action: 5 }).length > 0);
  ok("decisionCaptureViolations: array selected_action rejected", decisionCaptureViolations({ ...rec, selected_action: ["x"] }).length > 0);
  ok("decisionCaptureViolations: undefined selected_action rejected", decisionCaptureViolations({ ...rec, selected_action: undefined }).length > 0);
  ok("decisionCaptureViolations: non-array missing_inputs rejected", decisionCaptureViolations({ ...rec, missing_inputs: "x" }).length > 0);
  ok("decisionCaptureViolations: non-replayable with EMPTY missing_inputs rejected",
    decisionCaptureViolations({ ...rec, coverage: "non-replayable", missing_inputs: [] }).length > 0);
  ok("decisionCaptureViolations: replayable with NON-EMPTY missing_inputs rejected",
    decisionCaptureViolations({ ...rec, missing_inputs: ["x"] }).length > 0);
  ok("decisionCaptureViolations: non-object causation rejected", decisionCaptureViolations({ ...rec, causation: "nope" }).length > 0);
  ok("decisionCaptureViolations: causation.seq non-integer rejected",
    decisionCaptureViolations({ ...rec, causation: { seq: "3", sha256: "a".repeat(64) } }).length > 0);
  ok("decisionCaptureViolations: causation.sha256 not 64-lowercase-hex rejected",
    decisionCaptureViolations({ ...rec, causation: { seq: 3, sha256: "not-hex" } }).length > 0);
  ok("decisionCaptureViolations: causation.sha256 uppercase hex rejected (lowercase-only)",
    decisionCaptureViolations({ ...rec, causation: { seq: 3, sha256: "A".repeat(64) } }).length > 0);
  ok("decisionCaptureViolations: a non-object data payload is one violation, not a crash",
    decisionCaptureViolations(null).length === 1 && decisionCaptureViolations("x").length === 1);

  // --- coverage-class round trip: an uncovered decision's own record is itself well-formed ---
  const uncoveredRecord = buildRecord("some-unknown-thing", "", { anything: 1 }, { action: "x" }, "uncovered", [], causation);
  ok("an uncovered record (unknown kernel) is itself shape-valid", decisionCaptureViolations(uncoveredRecord).length === 0);

  // --- FAFF-956: the base record + action marker both pass THIS copy of the validators
  // (the born-verifiable contract-single-sourcing DoD; the events.js mirror asserts the
  // same under its own copy). ---
  const baseRec = buildBaseRecord("next", "next@1", fullNextInputs, "graft", "replayable", [], "run-x/FAFF-1/next/1", causation);
  ok("buildBaseRecord: the base shape has verdict + correlation_id and NO selected_action",
    baseRec.verdict === "graft" && baseRec.correlation_id === "run-x/FAFF-1/next/1" && !("selected_action" in baseRec));
  ok("decisionCaptureViolations: a well-formed BASE record (verdict + correlation_id, no selected_action) passes",
    decisionCaptureViolations(baseRec).length === 0);
  ok("decisionCaptureViolations: a base record with an OBJECT verdict passes",
    decisionCaptureViolations({ ...baseRec, verdict: { eligible: true } }).length === 0);
  ok("decisionCaptureViolations: a base record with an EMPTY correlation_id still passes (lands action-uncaptured, safe)",
    decisionCaptureViolations({ ...baseRec, correlation_id: "" }).length === 0);
  ok("decisionCaptureViolations: a base record MISSING verdict is rejected",
    decisionCaptureViolations({ ...baseRec, verdict: undefined }).length > 0);
  ok("decisionCaptureViolations: a base record with a non-string correlation_id is rejected",
    decisionCaptureViolations({ ...baseRec, correlation_id: 5 }).length > 0);
  ok("decisionCaptureViolations: the LEGACY combined record (selected_action, no verdict) still passes",
    decisionCaptureViolations({ kernel: "next", kernel_version: "next@1", normalised_inputs: fullNextInputs, selected_action: "graft", coverage: "replayable", missing_inputs: [], causation }).length === 0);

  const marker = { kernel: "next", correlation_id: "run-x/FAFF-1/next/1", selected_action: "graft", causation };
  ok("decisionCaptureActionViolations: a well-formed action marker passes", decisionCaptureActionViolations(marker).length === 0);
  ok("decisionCaptureActionViolations: an object selected_action passes", decisionCaptureActionViolations({ ...marker, selected_action: { action: "graft" } }).length === 0);
  ok("decisionCaptureActionViolations: an empty correlation_id is rejected", decisionCaptureActionViolations({ ...marker, correlation_id: "" }).length > 0);
  ok("decisionCaptureActionViolations: an empty kernel is rejected", decisionCaptureActionViolations({ ...marker, kernel: "" }).length > 0);
  ok("decisionCaptureActionViolations: a numeric selected_action is rejected", decisionCaptureActionViolations({ ...marker, selected_action: 5 }).length > 0);
  ok("decisionCaptureActionViolations: a bad causation is rejected", decisionCaptureActionViolations({ ...marker, causation: { seq: "x", sha256: "no" } }).length > 0);
  ok("decisionCaptureActionViolations: a non-object payload is one violation, not a crash",
    decisionCaptureActionViolations(null).length === 1 && decisionCaptureActionViolations("x").length === 1);

  // --- dedupeAndOrder (FAFF-960): dedup by run_id+seq (first/live wins), deterministic
  // source-mix-invariant order, malformed kept, and input never mutated (so the export
  // default path, which never calls it, leaves its live-only record list unchanged). ---
  const live = { run_id: "a", seq: 2, mark: "live" };
  const other = { run_id: "a", seq: 1, mark: "x" };
  const otherRun = { run_id: "b", seq: 1, mark: "y" };
  // A live record and its committed anchor are byte-COPIES (mintIssueAnchor byte-copies the
  // file), so a real duplicate pair is byte-identical — model that here.
  const dupLive = { run_id: "a", seq: 2, mark: "same" };
  const dupAnchor = { run_id: "a", seq: 2, mark: "same" };
  ok("dedupeAndOrder: dedups by run_id+seq, first occurrence wins",
    (() => { const r = dedupeAndOrder([dupLive, dupAnchor]); return r.length === 1 && r[0].mark === "same"; })());
  ok("dedupeAndOrder: orders ascending by run_id then seq",
    (() => {
      const r = dedupeAndOrder([otherRun, live, other]);
      return JSON.stringify(r.map((x) => `${x.run_id}:${x.seq}`)) === JSON.stringify(["a:1", "a:2", "b:1"]);
    })());
  ok("dedupeAndOrder: output is source-mix-invariant (same logical set of byte-identical copies, different input order -> identical bytes)",
    (() => {
      const a = dedupeAndOrder([dupLive, other, otherRun, dupAnchor]);
      const b = dedupeAndOrder([dupAnchor, otherRun, dupLive, other]);
      return a.map((r) => JSON.stringify(r)).join("\n") === b.map((r) => JSON.stringify(r)).join("\n");
    })());
  ok("dedupeAndOrder: distinct malformed records are all kept, ordered after well-formed by bytes",
    (() => {
      const m1 = { no_id: 1 };
      const m2 = { no_id: 2 };
      const r = dedupeAndOrder([m2, live, m1]);
      return r.length === 3 && r[0].mark === "live"
        && JSON.stringify(r.slice(1)) === JSON.stringify([m1, m2]); // "{"no_id":1}" < "{"no_id":2}"
    })());
  ok("dedupeAndOrder: does not mutate its input array (default export path keeps its live-only list unchanged)",
    (() => { const input = [live, dupLive, other]; const snap = JSON.stringify(input); dedupeAndOrder(input); return JSON.stringify(input) === snap && input.length === 3; })());

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (decision-capture, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = {
  KERNEL_REGISTRY,
  KERNEL_REGISTRY_RATIFIED_NAMES,
  buildRecord,
  buildBaseRecord,
  mintCorrelationId,
  captureDecision,
  classifyCoverage,
  cmdDecisionCapture,
  collectAnchorRecordDirs,
  dedupeAndOrder,
  decisionCaptureSelftest,
  decisionCaptureViolations,
  decisionCaptureActionViolations,
};
