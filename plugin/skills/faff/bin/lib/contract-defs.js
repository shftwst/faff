// ===========================================================================
// === region:factory — contract definitions + dispatch — FAFF-77: per-slot contract scripts (conformance by construction). ===
// `faff contract <name>` reads an extraction JSON (the adaptor's LLM-read of the
// producer's prose output) on stdin and emits the canonical, schema-valid contract
// data on stdout — or fails loud. Contract data flows ONLY from here (the wiring the
// spec adaptor is checked against). Schema = shape (the .json); `faff contract <name>
// --describe` = semantics, bound BY REFERENCE to the same validation enums this file
// branches on (FAFF-598, amending ADR-0001's schema/gateway split — see ADR-0087);
// gate MEANINGS (high/medium/low promotion) still live upstream, never here.
// ===========================================================================

// The marker → classification map (deterministic; FAFF-77 Decision B).

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");
const { exitFor, schemaCheck, validateAgainstSchema } = require("./contract-engine");
const { parseArgs, usageError } = require("./argv");
const CONTRACT_SPEC = { flags: { "--selftest": { arity: 0 }, "--require-spawner-attested": { arity: 0 }, "--in": { arity: 1 }, "--describe": { arity: 0 }, "--json": { arity: 0 } }, positionals: { min: 0, max: 1, name: "contract-name" } };
const { RUN_DONE_VERDICTS } = require("./run-done");
const { RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS, deriveRunTrigger, normalizeRunTriggerSignals } = require("./run-start");

const MARKER_CLASS = { chosen: "closed", punt: "open", assumes: "external" };

// Compute the spec-readiness contract data from an extraction. Returns
// { contractData, failLoud }: failLoud is a reason string when the extraction is
// un-coercible (confidence absent/invalid → no safe target per FAFF-76 Decision 3)
// or malformed; contractData is null then. Non-conformance (missing markers /
// provenance) is NOT fail-loud — it is a well-formed verdict with markers_valid:false.
function computeSpecReadiness(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!("confidence" in extraction) || !Array.isArray(extraction.decisions)) {
    return { contractData: null, failLoud: "extraction missing required keys (confidence, decisions[])" };
  }
  if (!["high", "medium", "low"].includes(extraction.confidence)) {
    return { contractData: null, failLoud: `confidence ${JSON.stringify(extraction.confidence)} not in {high,medium,low}` };
  }
  const violations = [];
  const decisions = extraction.decisions.map((d, i) => {
    const classification = MARKER_CLASS[d && d.marker];
    if (!classification) violations.push(`decision[${i}] has no canonical marker (got ${JSON.stringify(d && d.marker)})`);
    return { classification };
  }).filter((d) => d.classification);
  if (extraction.provenance_present === false) violations.push("provenance stamp missing");
  return {
    contractData: { confidence: extraction.confidence, decisions, markers_valid: violations.length === 0, violations },
    failLoud: null,
  };
}

function contractSpecReadiness(extraction) {
  const { contractData, failLoud } = computeSpecReadiness(extraction);
  if (failLoud) return { failLoud };
  // Belt-and-braces: the emitted contract data must itself conform to FAFF-76's schema.
  const schemaPath = path.resolve(HERE, "..", "contracts", "spec-readiness.schema.json");
  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const shapeErrs = validateAgainstSchema(contractData, schema);
    if (shapeErrs.length) return { failLoud: `internal: emitted contract data non-conformant: ${shapeErrs.join("; ")}` };
  } catch (e) {
    return { failLoud: `cannot load spec-readiness schema: ${e.message}` };
  }
  return { contractData };
}

// --- review-verdict (FAFF-78) ---
// Safe coerce target = `needs-human` (never `pass`) — review HAS a safe target, unlike
// spec-readiness's fail-loud (FAFF-76 Decision 3). Fail-loud only on an unparseable extraction.
function computeReviewVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  // unavailable (FAFF-405): a KNOWN fail-closed value — "no review verdict could be produced"
  // (provider outage), distinct from the malformed/unknown fallback below (still needs-human).
  // Never pass. Exempt from the findings-substantiation check below by construction (that check
  // only fires for fail/needs-human) — a bare {signal:"unavailable"} is conformant.
  const SIGNALS = ["pass", "fail", "needs-human", "unavailable"];
  const violations = [];
  let signal = extraction.signal;
  if (!SIGNALS.includes(signal)) {
    violations.push(`signal ${JSON.stringify(signal)} not in {pass,fail,needs-human,unavailable} — coerced to needs-human`);
    signal = "needs-human";
  }
  const raw = Array.isArray(extraction.findings) ? extraction.findings : [];
  const findings = raw.map((f) => ({ location_present: !!(f && f.location_present), action_present: !!(f && f.action_present) }));
  if ((signal === "fail" || signal === "needs-human") && findings.length === 0) {
    violations.push(`${signal} carries no findings`);
  }
  findings.forEach((f, i) => {
    if (!f.location_present) violations.push(`finding[${i}] has no location`);
    if (!f.action_present) violations.push(`finding[${i}] has no action`);
  });
  return { contractData: { signal, findings, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractReviewVerdict(extraction) {
  const { contractData, failLoud } = computeReviewVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "review-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- delivery-outcome (FAFF-79) ---
// Safe coerce target = `failed` (never `shipped`) — ship HAS a safe target (FAFF-76 Decision 3).
// An uncorroborated `shipped` claim is coerced to `failed`. Fail-loud only on an unparseable extraction.
function computeDeliveryOutcome(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const OUTCOMES = ["shipped", "not-ready", "failed"];
  const violations = [];
  let outcome = extraction.outcome;
  let reason = typeof extraction.reason === "string" ? extraction.reason : "";
  if (!OUTCOMES.includes(outcome)) {
    violations.push(`outcome ${JSON.stringify(outcome)} not in {shipped,not-ready,failed} — coerced to failed`);
    outcome = "failed";
    if (!reason) reason = "malformed delivery result coerced to failed";
  } else if (outcome === "shipped" && extraction.corroborated === false) {
    violations.push("shipped is not corroborated by the producer's result — coerced to failed");
    outcome = "failed";
    if (!reason) reason = "unconfirmed merge/deploy";
  }
  if ((outcome === "not-ready" || outcome === "failed") && !reason) {
    violations.push(`${outcome} carries no reason`);
  }
  return { contractData: { outcome, reason, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractDeliveryOutcome(extraction) {
  const { contractData, failLoud } = computeDeliveryOutcome(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "delivery-outcome");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- automation-routing (FAFF-80) ---
// NO safe coerce target — the verdict is assigned by the routing adaptor, not received from a
// foreign producer, so an out-of-enum verdict is an assignment bug → fail-loud (like spec-readiness,
// unlike review/ship). The build-queue ADMISSION RULE is gateway semantics, NOT encoded here.
const ROUTING_VERDICTS = ["fire-and-forget", "likely-fire", "needs-decision-first", "gap-blocked", "circular-blocked", "repeat-parked"];
const ROOT_CAUSES = ["punt-not-closed", "gap", "cycle", "spec-ambiguous-external", "other"];
function computeAutomationRouting(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!ROUTING_VERDICTS.includes(extraction.verdict)) {
    return { contractData: null, failLoud: `verdict ${JSON.stringify(extraction.verdict)} not in the closed six — no safe coerce target` };
  }
  const violations = [];
  let root_cause = extraction.root_cause === undefined ? null : extraction.root_cause;
  if (root_cause !== null && !ROOT_CAUSES.includes(root_cause)) {
    violations.push(`root_cause ${JSON.stringify(root_cause)} not in {${ROOT_CAUSES.join(",")}} — normalised to null`);
    root_cause = null;
  }
  return { contractData: { verdict: extraction.verdict, root_cause, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractAutomationRouting(extraction) {
  const { contractData, failLoud } = computeAutomationRouting(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "automation-routing");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- quality-gates (FAFF-11) ---
// The engineering-quality-gate-ladder verdict faff-graft Step 7.5 branches on. Mirrors
// review-verdict EXACTLY: safe coerce target = `needs-human` (never `pass`) — the ladder gates the
// build, so a malformed verdict must never read as a green light. Fail-loud only on an unparseable
// extraction. The `faff gates run` command emits the GatesOutcome that the agent reads into this
// extraction shape; this contract is the consumer-side conformance check (like review-verdict).
const GATE_RUNG_KINDS = ["FORMAT", "LINT", "TYPECHECK", "STATIC_ANALYSIS", "UNIT", "OTHER"];
const GATE_RUNG_STATUSES = ["pass", "fail", "skipped", "errored"];
function computeQualityGates(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const SIGNALS = ["pass", "fail", "needs-human"];
  const violations = [];
  let signal = extraction.signal;
  if (!SIGNALS.includes(signal)) {
    violations.push(`signal ${JSON.stringify(signal)} not in {pass,fail,needs-human} — coerced to needs-human`);
    signal = "needs-human";
  }
  const raw = Array.isArray(extraction.rungs) ? extraction.rungs : [];
  const rungs = raw.map((r, i) => {
    let kind = r && r.kind;
    let status = r && r.status;
    if (!GATE_RUNG_KINDS.includes(kind)) { violations.push(`rung[${i}] kind ${JSON.stringify(kind)} not in {${GATE_RUNG_KINDS.join(",")}} — normalised to OTHER`); kind = "OTHER"; }
    if (!GATE_RUNG_STATUSES.includes(status)) { violations.push(`rung[${i}] status ${JSON.stringify(status)} not in {${GATE_RUNG_STATUSES.join(",")}} — normalised to errored`); status = "errored"; }
    return { kind, status };
  });
  // A fail/needs-human verdict with no rung is suspect (mirrors review-verdict's no-findings rule).
  if ((signal === "fail" || signal === "needs-human") && rungs.length === 0) {
    violations.push(`${signal} carries no rungs`);
  }
  // A `fail` signal must be backed by a failing rung; a `pass` must carry no failing rung.
  const anyFail = rungs.some((r) => r.status === "fail");
  if (signal === "fail" && !anyFail) violations.push("fail signal but no rung has status fail");
  if (signal === "pass" && anyFail) violations.push("pass signal but a rung has status fail");
  return { contractData: { signal, rungs, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractQualityGates(extraction) {
  const { contractData, failLoud } = computeQualityGates(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "quality-gates");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- post-merge-verification (FAFF-385) ---
// The post-merge health verdict `faff post-merge-check`'s impure shell (post-merge.js) computes
// after re-running the project's own declared UNIT rung (the SAME `discoverRungs`/`runRung`
// gates.js resolver, reused verbatim) against an ephemeral detached worktree at the merge-record.json
// sha (FAFF-397). Validates SHAPE + the cross-field consistency the shell's own classification must
// respect — mirrors quality-gates EXACTLY: safe coerce target for a malformed verdict is
// `unverified` (never `verified-ok` — the spec's own "never guess ok" fallback precedence),
// fail-loud only on an unparseable (non-object) extraction. This contract is the consumer-side
// conformance check over the shell's computed extraction, exactly like quality-gates is over
// `gatesContractExtraction`'s output — neither validates an LLM producer's prose.
const POST_MERGE_VERIFICATION_VERDICTS = ["verified-ok", "verified-fail", "unverified"];
function computePostMergeVerification(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  let verdict = extraction.verdict;
  if (!POST_MERGE_VERIFICATION_VERDICTS.includes(verdict)) {
    violations.push(`verdict ${JSON.stringify(verdict)} not in {verified-ok,verified-fail,unverified} — coerced to unverified`);
    verdict = "unverified";
  }
  const command = typeof extraction.command === "string" && extraction.command.trim() ? extraction.command : null;
  const basis = typeof extraction.basis === "string" ? extraction.basis : "";
  if (!basis.trim()) violations.push(`${verdict} carries no basis`);
  // A verified verdict (ok or fail) must name the rung it actually ran; `unverified` may or may not
  // (no-rung → null; an errored worktree/spawn path → the rung it attempted) — never enforced there.
  if ((verdict === "verified-ok" || verdict === "verified-fail") && !command) {
    violations.push(`${verdict} carries no command — a verified verdict must name the rung it ran`);
  }
  return { contractData: { verdict, command, basis, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractPostMergeVerification(extraction) {
  const { contractData, failLoud } = computePostMergeVerification(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "post-merge-verification");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- ci-triage (FAFF-391) ---
// `faff ci-triage`'s pure classification core: a CI failure sits in a three-axis space
// (transience/fault-domain/origin, two of the three mechanically observable — a clean
// same-sha re-run diffs transience, reading main's head decides origin; fault domain is
// mechanical-first from check-run metadata, LLM tiebreaker only on the metadata residue).
// `deriveTriageAction` is registered as CONTRACTS["ci-triage"] (mirrors decideFloor/
// integrity-floor exactly) so `action` is ALWAYS a pure function of the three axes — never
// re-derived from, or blindly trusted from, a caller-supplied `action` field (a forged/stale
// action can never widen past what the axes themselves justify).
const CI_TRIAGE_TRANSIENCE = ["transient", "persistent", "unknown"];
const CI_TRIAGE_FAULT_DOMAIN = ["infra", "code", "unknown"];
const CI_TRIAGE_ORIGIN = ["mine", "main-was-red", "unknown"];
const CI_TRIAGE_ACTIONS = ["proceed-to-merge-gate", "fix-attempt", "park-errored", "park-needs-human"];
const CI_TRIAGE_FAULT_DOMAIN_SOURCES = ["metadata", "llm", "none"];

// PURE: origin=main-was-red wins outright (never spend a fix attempt fixing main from inside a
// feature mandate, and never merge past it either way) — checked FIRST, ahead of transience, since
// the real procedure short-circuits there before any re-run is even attempted. An unresolved
// origin fails CLOSED the same way. A `transient` result then proceeds REGARDLESS of fault domain —
// the procedure's own flow never even asks the fault-domain question when the clean re-run already
// went green (the LLM tiebreaker step is skipped entirely on that path), so fault_domain may
// legitimately still be `unknown` here without that forcing a park. An unresolved transience (the
// pre-rerun first call, or a budget-exhausted "persistent by fiat" caller that still passed
// `unknown`) fails closed. Only a genuinely `persistent` failure inspects fault domain: `infra` ->
// park-errored (not a code defect), `code` -> fix-attempt (the one-iteration autonomous path), and
// a still-`unknown` fault domain (metadata AND the LLM tiebreaker both inconclusive) falls to the
// same fail-closed park. Every axis combination is covered, including all-`unknown` -> park-needs-human.
function deriveTriageAction(transience, fault_domain, origin) {
  if (origin === "main-was-red" || origin === "unknown") return "park-needs-human";
  if (transience === "transient") return "proceed-to-merge-gate";
  if (transience === "unknown") return "park-needs-human";
  if (fault_domain === "infra") return "park-errored";
  if (fault_domain === "code") return "fix-attempt";
  return "park-needs-human";
}

function computeCiTriage(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  let transience = extraction.transience;
  if (!CI_TRIAGE_TRANSIENCE.includes(transience)) {
    violations.push(`transience ${JSON.stringify(transience)} not in {${CI_TRIAGE_TRANSIENCE.join(",")}} — coerced to unknown`);
    transience = "unknown";
  }
  let fault_domain = extraction.fault_domain;
  if (!CI_TRIAGE_FAULT_DOMAIN.includes(fault_domain)) {
    violations.push(`fault_domain ${JSON.stringify(fault_domain)} not in {${CI_TRIAGE_FAULT_DOMAIN.join(",")}} — coerced to unknown`);
    fault_domain = "unknown";
  }
  let origin = extraction.origin;
  if (!CI_TRIAGE_ORIGIN.includes(origin)) {
    violations.push(`origin ${JSON.stringify(origin)} not in {${CI_TRIAGE_ORIGIN.join(",")}} — coerced to unknown`);
    origin = "unknown";
  }
  const action = deriveTriageAction(transience, fault_domain, origin);
  if (CI_TRIAGE_ACTIONS.includes(extraction.action) && extraction.action !== action) {
    violations.push(`action ${JSON.stringify(extraction.action)} disagrees with the derived action ${JSON.stringify(action)} — the derived action always governs`);
  }
  const pr = Number.isInteger(extraction.pr) ? extraction.pr : 0;
  if (!Number.isInteger(extraction.pr)) violations.push("pr must be an integer");
  const head_sha = typeof extraction.head_sha === "string" && extraction.head_sha.trim() ? extraction.head_sha : "";
  if (!head_sha) violations.push("head_sha missing");
  const ev = extraction.evidence && typeof extraction.evidence === "object" && !Array.isArray(extraction.evidence) ? extraction.evidence : {};
  let fault_domain_source = ev.fault_domain_source;
  if (!CI_TRIAGE_FAULT_DOMAIN_SOURCES.includes(fault_domain_source)) {
    violations.push(`evidence.fault_domain_source ${JSON.stringify(fault_domain_source)} not in {${CI_TRIAGE_FAULT_DOMAIN_SOURCES.join(",")}} — coerced to none`);
    fault_domain_source = "none";
  }
  const evidence = {
    reruns_used: Number.isInteger(ev.reruns_used) ? ev.reruns_used : 0,
    main_head_sha: typeof ev.main_head_sha === "string" ? ev.main_head_sha : null,
    main_ci_state: typeof ev.main_ci_state === "string" ? ev.main_ci_state : null,
    fault_domain_source,
    flaky_signatures: Array.isArray(ev.flaky_signatures) ? ev.flaky_signatures.filter((s) => typeof s === "string") : [],
  };
  return {
    contractData: { pr, head_sha, transience, fault_domain, origin, action, evidence, conformant: violations.length === 0, violations },
    failLoud: null,
  };
}

function contractCiTriage(extraction) {
  const { contractData, failLoud } = computeCiTriage(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "ci-triage");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- prd-readiness (FAFF-253) ---
// The product-axis analog of spec-readiness: the LLM PRD-admissibility validator (FAFF-260, deferred)
// reads a container's PRD and emits a verdict; THIS deterministic half validates the verdict's SHAPE.
// NO safe coerce target — faff's own producer emits it, so an out-of-enum verdict or creative_licence
// is an assignment bug → fail-loud (like spec-readiness/automation-routing, unlike review/ship). The
// gate is fail-safe toward REFUSAL: a malformed verdict never coerces toward `admissible`.
//
// Run-start call-site contract (the L4 run-start orchestrator — FAFF-260, not built yet):
//   1. resolve the PRD via `faff prd path`; a missing PRD → REFUSE the run (escalate), never crash.
//   2. invoke the LLM validator on the PRD; it emits one `faff-contract:prd-readiness` block last.
//   3. locate that block, JSON.parse it, pipe it to `faff contract prd-readiness` (the sole contract-
//      data source; an absent block → fail-loud → REFUSE).
//   4. branch on the script result: `admissible` (exit 0) → ADMIT the run; `not-ready` (exit 0) →
//      REFUSE + escalate before starting; any violation (exit 1) or fail-loud (exit 2) → REFUSE
//      (fail-safe — never admit on a non-conformant or unparseable verdict).
// `creative_licence` (`broad`/`tight`) is forward-carried to calibrate the downstream YAGNI/PRDR
// reviewer's strictness; it is shape-checked here but not gate-decisive.
const PRD_READINESS_VERDICTS = ["admissible", "not-ready"];
const PRD_READINESS_REASONS = ["no-stop-conditions", "ambiguous-stop-conditions", "other"];
const PRD_READINESS_LICENCES = ["broad", "tight"];
function computePrdReadiness(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!PRD_READINESS_VERDICTS.includes(extraction.verdict)) {
    return { contractData: null, failLoud: `verdict ${JSON.stringify(extraction.verdict)} not in {admissible,not-ready} — no safe coerce target` };
  }
  if (!PRD_READINESS_LICENCES.includes(extraction.creative_licence)) {
    return { contractData: null, failLoud: `creative_licence ${JSON.stringify(extraction.creative_licence)} not in {broad,tight} — no safe coerce target` };
  }
  const verdict = extraction.verdict;
  const creative_licence = extraction.creative_licence;
  const stop_conditions_verifiable = !!extraction.stop_conditions_verifiable;
  const violations = [];
  let reason = typeof extraction.reason === "string" ? extraction.reason : "";
  if (reason !== "" && !PRD_READINESS_REASONS.includes(reason)) {
    violations.push(`reason ${JSON.stringify(reason)} not in {${PRD_READINESS_REASONS.join(",")}} — normalised to other`);
    reason = "other";
  }
  if (verdict === "not-ready" && reason === "") violations.push("not-ready carries no reason");
  if (verdict === "admissible" && reason !== "") violations.push("admissible carries a reason — reason must be empty when admissible");
  if (verdict === "admissible" && !stop_conditions_verifiable) violations.push("admissible but stop_conditions_verifiable is false");
  return { contractData: { verdict, reason, stop_conditions_verifiable, creative_licence, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractPrdReadiness(extraction) {
  const { contractData, failLoud } = computePrdReadiness(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "prd-readiness");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- spec-review-verdict (FAFF-265) ---
// The spine of FAFF-9's spec-stage review: the fixed verdict the L1–L3 reviewer (FAFF-266),
// L4 refuters (FAFF-267), and lens-selection (FAFF-268) all map onto. Validates SHAPE, never
// the review's reasoning. Fail-loud on a bad verdict = the prd-readiness precedent (faff's own
// producer emits it, so an out-of-enum verdict is producer breakage, not a review outcome).
// Soft objection fields (lens/severity) enforce their enum via violations = the prd-readiness.reason
// precedent — so an echoed bad value never trips schemaCheck into a spurious fail-loud.
const SPEC_REVIEW_VERDICTS = ["approve", "revise", "reject-approach", "needs-human"];
const SPEC_REVIEW_LENSES = ["architectural", "infosec", "methodology", "QA"];
const SPEC_REVIEW_SEVERITIES = ["blocker", "major", "minor"];
function computeSpecReviewVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!SPEC_REVIEW_VERDICTS.includes(extraction.verdict)) {
    return { contractData: null, failLoud: `verdict ${JSON.stringify(extraction.verdict)} not in {approve,revise,reject-approach,needs-human} — no safe coerce target` };
  }
  const verdict = extraction.verdict;
  const violations = [];
  const raw = Array.isArray(extraction.objections) ? extraction.objections : [];
  if (extraction.objections !== undefined && !Array.isArray(extraction.objections)) {
    violations.push("objections is not an array — treated as empty");
  }
  const objections = raw.map((o, i) => {
    const lens = o && typeof o === "object" ? o.lens : undefined;
    const severity = o && typeof o === "object" ? o.severity : undefined;
    if (!SPEC_REVIEW_LENSES.includes(lens)) violations.push(`objection[${i}] lens ${JSON.stringify(lens)} not in {architectural,infosec,methodology,QA}`);
    if (!SPEC_REVIEW_SEVERITIES.includes(severity)) violations.push(`objection[${i}] severity ${JSON.stringify(severity)} not in {blocker,major,minor}`);
    return { lens: typeof lens === "string" ? lens : "", severity: typeof severity === "string" ? severity : "" };
  });
  if (verdict === "approve" && objections.length > 0) violations.push("approve carries objections — approve must carry none");
  if (verdict !== "approve" && objections.length === 0) violations.push(`${verdict} carries no objections`);
  return { contractData: { verdict, objections, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractSpecReviewVerdict(extraction) {
  const { contractData, failLoud } = computeSpecReviewVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "spec-review-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- architecture-proposal (FAFF-27) ---
// The proposal envelope FAFF-27's `architecture` slot producer (default faffter-noon-architecture)
// emits: a best-fit, build-biased architecture proposal generated from the infra profile + brief.
// Validates SHAPE, never the proposing strategy. Fail-loud ONLY on a non-object input (no safe coerce
// target — faff's own producer emits it). `recommendation` enforces its {build,buy,hybrid} enum via
// violations (the spec-review-verdict lens/severity precedent), so an out-of-enum value is exit 1, not
// a spurious schemaCheck fail-loud (exit 2). The proposer GENERATES; FAFF-9's architectural lens
// CRITIQUES the spec it lands in — no shared logic, they meet only through the spec artifact (ADR-0030).
const ARCHITECTURE_RECOMMENDATIONS = ["build", "buy", "hybrid"];
function computeArchitectureProposal(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  const chosen = typeof extraction.chosen_architecture === "string" ? extraction.chosen_architecture : "";
  if (!chosen.trim()) violations.push("chosen_architecture is empty");
  const rationale = typeof extraction.rationale === "string" ? extraction.rationale : "";
  if (!rationale.trim()) violations.push("rationale is empty");
  const recommendation = typeof extraction.recommendation === "string" ? extraction.recommendation : "";
  if (!ARCHITECTURE_RECOMMENDATIONS.includes(extraction.recommendation)) {
    violations.push(`recommendation ${JSON.stringify(extraction.recommendation)} not in {build,buy,hybrid}`);
  }
  const rawCand = Array.isArray(extraction.adr_candidates) ? extraction.adr_candidates : [];
  if (extraction.adr_candidates !== undefined && !Array.isArray(extraction.adr_candidates)) {
    violations.push("adr_candidates is not an array — treated as empty");
  }
  const adr_candidates = rawCand.map((c, i) => {
    const title = c && typeof c === "object" && !Array.isArray(c) ? c.title : undefined;
    const decision = c && typeof c === "object" && !Array.isArray(c) ? c.decision : undefined;
    const rat = c && typeof c === "object" && !Array.isArray(c) ? c.rationale : undefined;
    if (typeof title !== "string" || !title.trim()) violations.push(`adr_candidates[${i}] has no title`);
    if (typeof decision !== "string" || !decision.trim()) violations.push(`adr_candidates[${i}] has no decision`);
    if (typeof rat !== "string" || !rat.trim()) violations.push(`adr_candidates[${i}] has no rationale`);
    return {
      title: typeof title === "string" ? title : "",
      decision: typeof decision === "string" ? decision : "",
      rationale: typeof rat === "string" ? rat : "",
    };
  });
  const rawAssume = Array.isArray(extraction.assumptions) ? extraction.assumptions : [];
  if (extraction.assumptions !== undefined && !Array.isArray(extraction.assumptions)) {
    violations.push("assumptions is not an array — treated as empty");
  }
  const assumptions = rawAssume.map((a) => (typeof a === "string" ? a : String(a)));
  // Surface any input violations the producer self-declared (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }
  return {
    contractData: { chosen_architecture: chosen, rationale, adr_candidates, assumptions, recommendation, violations },
    failLoud: null,
  };
}

function contractArchitectureProposal(extraction) {
  const { contractData, failLoud } = computeArchitectureProposal(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "architecture-proposal");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- env-handle (FAFF-30) ---
// The provisioned-environment handle FAFF-30's `env` slot producer (default faffter-noon-env-compose)
// emits: a description of a running, health-checked stand-in for the system under build that the holdout
// evaluator (FAFF-34) points at and tears down. Validates SHAPE + the cross-field gate rule, never the
// provisioning strategy (which lives in the producer — compose now, cloud later). PURE: a function over the
// handle object, no I/O. Fail-loud ONLY on a non-object input (no safe coerce target — faff's own producer
// emits it). `status` enforces its {ready,provisioning,failed,terminated} enum via violations (the
// architecture-proposal recommendation precedent), so an out-of-enum value is exit 1, not a spurious
// schemaCheck fail-loud (exit 2). The load-bearing gate: exit 0 ONLY when conformant AND status==="ready"
// — a non-ready env (provisioning/failed/terminated) is NEVER gate-passing, so its non-ready status is
// surfaced as a violation. `endpoint` is required only when ready (enforced here, not as a schema required
// field), and a ready handle must expose at least one health_check (what FAFF-34 consumes).
const ENV_HANDLE_STATUSES = ["ready", "provisioning", "failed", "terminated"];
function computeEnvHandle(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  const status = typeof extraction.status === "string" ? extraction.status : "";
  if (!ENV_HANDLE_STATUSES.includes(extraction.status)) {
    violations.push(`status ${JSON.stringify(extraction.status)} not in {ready,provisioning,failed,terminated}`);
  } else if (status !== "ready") {
    violations.push(`status is "${status}" — not a gate-passing (ready) env`);
  }
  const endpoint = typeof extraction.endpoint === "string" ? extraction.endpoint : "";
  if (status === "ready" && !endpoint.trim()) violations.push("status is ready but endpoint is missing/empty");

  const rawChecks = Array.isArray(extraction.health_checks) ? extraction.health_checks : [];
  if (!Array.isArray(extraction.health_checks)) violations.push("health_checks is missing or not an array");
  const health_checks = rawChecks.map((c, i) => {
    const obj = c && typeof c === "object" && !Array.isArray(c) ? c : {};
    const name = obj.name, hpath = obj.path, expected = obj.expected_status;
    if (typeof name !== "string" || !name.trim()) violations.push(`health_checks[${i}] has no name`);
    if (typeof hpath !== "string" || !hpath.trim()) violations.push(`health_checks[${i}] has no path`);
    if (typeof expected !== "number") violations.push(`health_checks[${i}] has no numeric expected_status`);
    return {
      name: typeof name === "string" ? name : "",
      path: typeof hpath === "string" ? hpath : "",
      expected_status: typeof expected === "number" ? expected : 0,
    };
  });
  if (status === "ready" && health_checks.length === 0) violations.push("status is ready but health_checks is empty");

  const teardown_ref = typeof extraction.teardown_ref === "string" ? extraction.teardown_ref : "";
  if (!teardown_ref.trim()) violations.push("teardown_ref is missing or empty");
  const provisioned_at = typeof extraction.provisioned_at === "string" ? extraction.provisioned_at : "";
  if (!provisioned_at.trim()) violations.push("provisioned_at is missing or empty");
  const provisioner = typeof extraction.provisioner === "string" ? extraction.provisioner : "";
  if (!provisioner.trim()) violations.push("provisioner is missing or empty");

  // Surface any input violations the producer self-declared (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }

  const contractData = { status, endpoint, health_checks, teardown_ref, provisioned_at, provisioner, violations };
  // Optional fields: carried through only when present + well-typed (additionalProperties:false on the schema).
  if (extraction.endpoints && typeof extraction.endpoints === "object" && !Array.isArray(extraction.endpoints)) contractData.endpoints = extraction.endpoints;
  if (extraction.readiness && typeof extraction.readiness === "object" && !Array.isArray(extraction.readiness)) contractData.readiness = extraction.readiness;
  if (typeof extraction.teardown_cmd === "string") contractData.teardown_cmd = extraction.teardown_cmd;
  if (extraction.credentials && typeof extraction.credentials === "object" && !Array.isArray(extraction.credentials)) contractData.credentials = extraction.credentials;

  return { contractData, failLoud: null };
}

function contractEnvHandle(extraction) {
  const { contractData, failLoud } = computeEnvHandle(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "env-handle");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- holdout-verdict (FAFF-34) ---
// The code-blind holdout verdict the `evaluator` slot producer (default faffter-noon-evaluate) emits after
// exercising a built feature against its spec's DoD in a provisioned env. Validates SHAPE + the cross-field
// consistency rules, never the exercise strategy (which lives in the producer). PURE: a function over the
// verdict object, no I/O. Fail-loud ONLY on a non-object (no safe coerce target — faff's own producer emits
// it). The enums for aggregate/class/verdict are enforced via violations (the env-handle precedent), so an
// echoed bad value is exit 1, not a spurious schemaCheck fail-loud (exit 2). The fail-safe coercion target
// for a bad aggregate is `needs-human` — NEVER `meets-spec` (mirrors review-verdict). The load-bearing gates
// (exit 0 only when ALL hold): code_blind===true (a non-blind verdict is structurally inadmissible — ADR-0032);
// a `prose` criterion is never machine-judged (verdict MUST be needs-human — ADR-0029); a met/unmet criterion
// MUST carry evidence; and the aggregate MUST match the derivation from the criteria (no hand-waved meets-spec).
const HOLDOUT_AGGREGATES = ["meets-spec", "gaps", "fails", "needs-human"];
const HOLDOUT_CLASSES = ["scenario", "assertion", "prose"];
const HOLDOUT_VERDICTS = ["met", "unmet", "needs-human"];

// The aggregate derivation (gateway-normative, ADR-0032). Shared so producer + validator agree.
function deriveHoldoutAggregate(verdicts) {
  if (verdicts.some((v) => v === "needs-human")) return "needs-human";
  if (verdicts.length === 0) return "needs-human";       // nothing judged → needs-human
  if (verdicts.every((v) => v === "met")) return "meets-spec";
  if (verdicts.every((v) => v === "unmet")) return "fails";
  return "gaps";                                          // mixed met/unmet
}

// FAFF-384: shape-validate the spawner `attestation` record (present iff spawner_attested:true). The
// withheld-set is the BASIS code_blind is derived from, so `repo` MUST be provably withheld and the in-cage
// preflight MUST have passed for an attested-blind verdict to mean anything. Returns the normalised record
// (pushing any shape violation), or null on a non-object. PURE.
function validateSpawnerAttestation(att, violations) {
  if (att === null || typeof att !== "object" || Array.isArray(att)) {
    violations.push("spawner_attested is true but attestation is missing or not an object");
    return null;
  }
  const spawner = typeof att.spawner === "string" && att.spawner.trim() ? att.spawner : "";
  if (!spawner) violations.push("attestation.spawner is missing or not a non-empty string");
  const w = (att.withheld && typeof att.withheld === "object" && !Array.isArray(att.withheld)) ? att.withheld : null;
  if (!w) violations.push("attestation.withheld is missing or not an object");
  const withheld = { repo: !!(w && w.repo === true), worktree_cwd: !!(w && w.worktree_cwd === true), diff: !!(w && w.diff === true) };
  if (!withheld.repo) violations.push("attestation.withheld.repo is not true — the codebase was not provably withheld, so the blindness is not spawner-derived");
  const preflight = typeof att.preflight === "string" ? att.preflight : "";
  if (preflight !== "pass") violations.push(`attestation.preflight ${JSON.stringify(att.preflight)} is not "pass" — the in-cage preflight did not confirm the boundary`);
  return { spawner, withheld, preflight };
}

// `opts.requireSpawnerAttested` (default false) is CALLER-RESOLVED from the run's lane-boundary cage promise;
// the validator itself stays PURE — it never reads the intent artifact off disk (that is the caller's job at
// the dispatch boundary). Threading an optional 2nd arg keeps every existing 1-arg caller byte-for-byte.
function computeHoldoutVerdict(extraction, opts = {}) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];

  // code_blind — the by-construction attestation; MUST be exactly true to gate-pass.
  const code_blind = extraction.code_blind === true;
  if (extraction.code_blind !== true) violations.push("code_blind is not true — a non-blind verdict is structurally inadmissible");

  const rawCriteria = Array.isArray(extraction.criteria) ? extraction.criteria : [];
  if (!Array.isArray(extraction.criteria)) violations.push("criteria is missing or not an array");
  const criteria = rawCriteria.map((c, i) => {
    const obj = c && typeof c === "object" && !Array.isArray(c) ? c : {};
    const klass = HOLDOUT_CLASSES.includes(obj.class) ? obj.class : "";
    if (!HOLDOUT_CLASSES.includes(obj.class)) violations.push(`criteria[${i}].class ${JSON.stringify(obj.class)} not in {scenario,assertion,prose}`);
    const verdict = HOLDOUT_VERDICTS.includes(obj.verdict) ? obj.verdict : "";
    if (!HOLDOUT_VERDICTS.includes(obj.verdict)) violations.push(`criteria[${i}].verdict ${JSON.stringify(obj.verdict)} not in {met,unmet,needs-human}`);
    const evidence_present = obj.evidence_present === true;
    if (klass === "prose" && obj.verdict !== "needs-human") violations.push(`criteria[${i}] is prose but verdict is ${JSON.stringify(obj.verdict)} — prose must be needs-human (ADR-0029)`);
    if ((obj.verdict === "met" || obj.verdict === "unmet") && !evidence_present) violations.push(`criteria[${i}] verdict ${obj.verdict} has no evidence (evidence_present false)`);
    return { class: klass, verdict, evidence_present };
  });

  // aggregate — an out-of-enum echoed value coerces to needs-human (NEVER meets-spec).
  let aggregate = extraction.aggregate;
  if (!HOLDOUT_AGGREGATES.includes(aggregate)) {
    violations.push(`aggregate ${JSON.stringify(aggregate)} not in {meets-spec,gaps,fails,needs-human} — coerced to needs-human`);
    aggregate = "needs-human";
  }
  // Consistency: the declared aggregate must match the derivation from the criteria. Only checkable when
  // every verdict is well-formed (an out-of-enum verdict already pushed its own violation above).
  if (criteria.every((c) => HOLDOUT_VERDICTS.includes(c.verdict))) {
    const expected = deriveHoldoutAggregate(criteria.map((c) => c.verdict));
    if (aggregate !== expected) violations.push(`aggregate is "${aggregate}" but criteria derive "${expected}"`);
  }

  // Surface any producer-declared violations (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }

  // FAFF-384: spawner attestation (ADDITIVE, the rung-2 second slice). The two fields appear in contractData
  // ONLY when the input carries `spawner_attested`, so a legacy (uncaged) verdict validates byte-for-byte with
  // the ratchet OFF — the additive-only invariant. `spawner_attested:true` sets code_blind from what the
  // spawner PROVABLY withheld (not the judged party's self-claim); a claimed attestation is shape-checked. The
  // ratchet (opts.requireSpawnerAttested, caller-resolved from the cage promise) makes a self-attested verdict
  // a violation — the lying-evaluator hole. A non-boolean spawner_attested is itself a violation.
  const hasSpawnerField = Object.prototype.hasOwnProperty.call(extraction, "spawner_attested");
  const spawner_attested = extraction.spawner_attested === true;
  let attestation = null;
  if (hasSpawnerField) {
    if (spawner_attested) attestation = validateSpawnerAttestation(extraction.attestation, violations);
    else if (extraction.spawner_attested !== false) violations.push(`spawner_attested ${JSON.stringify(extraction.spawner_attested)} is not a boolean`);
  }
  if (opts && opts.requireSpawnerAttested && !spawner_attested) {
    violations.push("spawner attestation required (the run's lane-boundary intent promised an evaluator cage) but the verdict is not spawner-attested — a self-attested code_blind is inadmissible");
  }

  const contractData = { aggregate, code_blind, criteria, violations };
  if (hasSpawnerField) {
    contractData.spawner_attested = spawner_attested;
    if (attestation) contractData.attestation = attestation;
  }
  return { contractData, failLoud: null };
}

function contractHoldoutVerdict(extraction, opts = {}) {
  const { contractData, failLoud } = computeHoldoutVerdict(extraction, opts);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "holdout-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- lane-boundary (FAFF-276) ---
// The versioned lane-boundary intent the orchestrator authors (intent-out) declaring what physical
// boundary a lane needs — the assert-in counterpart is `faff evaluator-preflight`. A DECLARATION of
// intent, NEVER a trust source: the preflight's refuse decision rests on a physical fsq probe, never on
// this artifact's claim. Validates SHAPE + enums, never the boundary's truth. PURE: a function over the
// intent object, no I/O. Fail-loud ONLY on a non-object input (the structural-malformation case). The
// enums for lane/container/accesses.* and the version>=1 constraint are enforced via violations (the
// env-handle/holdout-verdict precedent), so an echoed out-of-enum value is exit 1, NOT a spurious
// schemaCheck fail-loud (exit 2) — this is what the spec-review note directed (route out-of-enum to
// violations like env-handle/holdout-verdict, reserving fail-loud for structural malformation).
// host_socket + integrity_signal are carried from v1 but NOT asserted by this slice's preflight
// (declaration-only until FAFF-333 / FAFF-325 wire their assertions).
const LANE_BOUNDARY_LANES = ["evaluator"];
const LANE_BOUNDARY_CONTAINERS = ["shared", "own"];
const LANE_BOUNDARY_ACCESS = ["absent", "present"];
function computeLaneBoundary(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  let version = extraction.version;
  if (!Number.isInteger(version) || version < 1) {
    violations.push(`version ${JSON.stringify(version)} is not an integer >= 1`);
    version = Number.isInteger(version) ? version : 0;
  }
  const lane = typeof extraction.lane === "string" ? extraction.lane : "";
  if (!LANE_BOUNDARY_LANES.includes(extraction.lane)) {
    violations.push(`lane ${JSON.stringify(extraction.lane)} not in {${LANE_BOUNDARY_LANES.join(",")}}`);
  }
  const container = typeof extraction.container === "string" ? extraction.container : "";
  if (!LANE_BOUNDARY_CONTAINERS.includes(extraction.container)) {
    violations.push(`container ${JSON.stringify(extraction.container)} not in {${LANE_BOUNDARY_CONTAINERS.join(",")}}`);
  }
  const acc = (extraction.accesses && typeof extraction.accesses === "object" && !Array.isArray(extraction.accesses)) ? extraction.accesses : null;
  if (!acc) violations.push("accesses is missing or not an object");
  const repo = acc && typeof acc.repo === "string" ? acc.repo : "";
  if (!acc || !LANE_BOUNDARY_ACCESS.includes(acc.repo)) {
    violations.push(`accesses.repo ${JSON.stringify(acc ? acc.repo : undefined)} not in {${LANE_BOUNDARY_ACCESS.join(",")}}`);
  }
  const host_socket = acc && typeof acc.host_socket === "string" ? acc.host_socket : "";
  if (!acc || !LANE_BOUNDARY_ACCESS.includes(acc.host_socket)) {
    violations.push(`accesses.host_socket ${JSON.stringify(acc ? acc.host_socket : undefined)} not in {${LANE_BOUNDARY_ACCESS.join(",")}}`);
  }
  const integrity_signal = extraction.integrity_signal === true;
  if (typeof extraction.integrity_signal !== "boolean") {
    violations.push(`integrity_signal ${JSON.stringify(extraction.integrity_signal)} is not a boolean`);
  }
  // Surface any producer-declared violations (convention parity with the other contracts).
  if (Array.isArray(extraction.violations)) {
    for (const v of extraction.violations) if (typeof v === "string" && v.trim()) violations.push(v);
  }
  return { contractData: { version, lane, container, accesses: { repo, host_socket }, integrity_signal, violations }, failLoud: null };
}

function contractLaneBoundary(extraction) {
  const { contractData, failLoud } = computeLaneBoundary(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "lane-boundary");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- holdout verdicts → DoD-verdict map (FAFF-277) ---
// The pure, trust-gated bridge between the evaluator's persisted holdout verdicts and the already-shipped
// `faff prdr coverage --dod-verdicts` flag. Reuses computeHoldoutVerdict VERBATIM as the trust gate (never
// a forked rule). Input: an issue→PRDR `association` {key: prdr-id} (orchestrator-lane data — the evaluator
// stays PRDR-blind) and a SORTED list of `files` {key, text} (raw `.faff/holdout/<key>.json` contents).
// Output: { verdicts: {prdr: "met"|"<aggregate>"}, skipped: [{key, reason}] }. The contract IS the boundary:
// a verdict yields `met` only when it re-passes the gate (conformant ∧ code_blind:true) AND aggregate is
// exactly "meets-spec"; every other aggregate passes through as its own ≠"met" string; untrusted files are
// omitted entirely (their aggregate cannot be believed). Conservative duplicate-PRDR fold: a PRDR is `met`
// only when EVERY trusted file mapping to it is `met` (a single failing re-run is never masked).
function computeHoldoutVerdictsMap(association, files, opts = {}) {
  const contributions = new Map();   // prdr-id -> [trusted value, ...] (insertion order = sorted-key order)
  const skipped = [];
  for (const { key, text, unreadable } of files) {
    if (!Object.prototype.hasOwnProperty.call(association, key)) { skipped.push({ key, reason: "no-association" }); continue; }
    const prdr = association[key];
    if (unreadable) { skipped.push({ key, reason: "unreadable" }); continue; }
    let block;
    try { block = JSON.parse(text); } catch { skipped.push({ key, reason: "unreadable" }); continue; }
    // The trust gate — the SAME compute fn `faff contract holdout-verdict` runs (FAFF-384: incl. the spawner-
    // attestation ratchet when opts.requireSpawnerAttested is set by the caller from the run's cage promise).
    // A fail-loud (non-object), any contract violation, or a non-true code_blind ⇒ untrusted ⇒ never "met".
    const { contractData, failLoud } = computeHoldoutVerdict(block, opts);
    if (failLoud || (contractData && contractData.violations.length > 0) || block.code_blind !== true) {
      skipped.push({ key, reason: "contract-rejected" }); continue;
    }
    const value = (block.aggregate === "meets-spec") ? "met" : block.aggregate;
    if (!contributions.has(prdr)) contributions.set(prdr, []);
    contributions.get(prdr).push(value);
  }
  const verdicts = {};
  for (const [prdr, values] of contributions) {
    // Conservative fold: `met` only when all contributing trusted values are `met`; else the first non-`met`.
    verdicts[prdr] = values.every((v) => v === "met") ? "met" : values.find((v) => v !== "met");
  }
  return { verdicts, skipped };
}

// FAFF-311: the per-issue merge-floor gate result — the SAME `computeHoldoutVerdict` trust gate the
// FAFF-277 run-bridge (computeHoldoutVerdictsMap) applies, reduced to a single pass/block decision for
// the `faff-graft` Step-10 call-site. `pass` ⇔ well-formed ∧ code_blind:true ∧ zero violations ∧
// aggregate==="meets-spec"; EVERYTHING else (fails/gaps/needs-human/non-blind/incoherent/malformed) is
// `block`. Fail-closed by construction — this never returns `pass` on doubt. Pure over the parsed block.
function holdoutGateResult(block, opts = {}) {
  const { contractData, failLoud } = computeHoldoutVerdict(block, opts);
  if (failLoud) return { gate: "block", reason: "contract-rejected", detail: failLoud };
  if (contractData.violations.length > 0 || block.code_blind !== true) {
    return { gate: "block", reason: "contract-rejected", aggregate: contractData.aggregate, code_blind: contractData.code_blind, violations: contractData.violations };
  }
  if (contractData.aggregate !== "meets-spec") {
    return { gate: "block", reason: contractData.aggregate, aggregate: contractData.aggregate, code_blind: true };
  }
  return { gate: "pass", reason: "meets-spec", aggregate: "meets-spec", code_blind: true };
}

// --- prdr-admission (FAFF-255) ---
// The two-gate-bound admission verdict the PRDR layer's keystone produces. `faff prdr admit` is the
// PRODUCER (computePrdrAdmissionVerdict — the deterministic gate computing authority/by-level/ratchet
// and folding in the 256/257 verdicts); THIS is the consumer-side SHAPE validator (mirrors
// prd-readiness). NO safe coerce target — faff's own producer emits it, so an out-of-enum disposition
// or authority enum is an assignment bug → fail-loud (never coerced toward `admit`). The load-bearing
// invariant guarded here: an `admit` disposition MUST satisfy the two-gate constraint
// (upper.admit ∧ by_level==ok ∧ ¬ratchet.breached ∧ lower.covered ∧ ¬(loop supersedes human)).
const PRDR_DISPOSITIONS = ["admit", "propose-only", "reject"];
const PRDR_ACTORS = ["loop", "human"];
const PRDR_SUPERSEDES = ["human", "loop", "none"];
const PRDR_BY_LEVEL = ["ok", "violation"];

// Does the verdict's gate state permit `admit`? Shared by producer + validator so the constraint has
// one definition. (loopSupersedesHuman blocks admit but routes to propose-only, not reject.)
function prdrGatesPass(upper, by_level, ratchet, lower) {
  return !!upper.admit && by_level === "ok" && !ratchet.breached && !!lower.covered;
}

function computePrdrAdmission(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!PRDR_DISPOSITIONS.includes(extraction.disposition)) {
    return { contractData: null, failLoud: `disposition ${JSON.stringify(extraction.disposition)} not in {admit,propose-only,reject} — no safe coerce target` };
  }
  const a = extraction.authority;
  if (a === null || typeof a !== "object" || Array.isArray(a)) {
    return { contractData: null, failLoud: "authority must be an object" };
  }
  if (!PRDR_ACTORS.includes(a.actor)) return { contractData: null, failLoud: `authority.actor ${JSON.stringify(a.actor)} not in {loop,human}` };
  if (!PRDR_SUPERSEDES.includes(a.supersedes_provenance)) return { contractData: null, failLoud: `authority.supersedes_provenance ${JSON.stringify(a.supersedes_provenance)} not in {human,loop,none}` };
  if (!PRDR_BY_LEVEL.includes(a.by_level)) return { contractData: null, failLoud: `authority.by_level ${JSON.stringify(a.by_level)} not in {ok,violation}` };

  const violations = [];
  const up = (extraction.upper && typeof extraction.upper === "object" && !Array.isArray(extraction.upper)) ? extraction.upper : {};
  const upper = { admit: !!up.admit, reason: typeof up.reason === "string" ? up.reason : "" };
  const lo = (extraction.lower && typeof extraction.lower === "object" && !Array.isArray(extraction.lower)) ? extraction.lower : {};
  const lower = { covered: !!lo.covered, uncovered_goals: Array.isArray(lo.uncovered_goals) ? lo.uncovered_goals.filter((g) => typeof g === "string") : [] };
  const ra = (extraction.ratchet && typeof extraction.ratchet === "object" && !Array.isArray(extraction.ratchet)) ? extraction.ratchet : {};
  let lineage = ra.lineage_supersessions;
  if (!Number.isInteger(lineage)) { violations.push(`ratchet.lineage_supersessions ${JSON.stringify(lineage)} not an integer — normalised to 0`); lineage = 0; }
  const ratchet = { lineage_supersessions: lineage, breached: !!ra.breached };
  const authority = { actor: a.actor, supersedes_provenance: a.supersedes_provenance, by_level: a.by_level };
  const reasons = Array.isArray(extraction.reasons) ? extraction.reasons.filter((r) => typeof r === "string") : [];

  const loopSupersedesHuman = authority.actor === "loop" && authority.supersedes_provenance === "human";
  const gatesPass = prdrGatesPass(upper, authority.by_level, ratchet, lower);
  // The load-bearing conformance: an `admit` must have actually passed every gate AND not be a
  // loop→human move; a `propose-only` is valid ONLY when gates pass and that move is the sole bar.
  if (extraction.disposition === "admit" && !(gatesPass && !loopSupersedesHuman)) {
    violations.push("admit disposition violates the two-gate constraint (requires upper.admit ∧ by_level==ok ∧ ¬ratchet.breached ∧ lower.covered ∧ ¬(loop supersedes human))");
  }
  if (extraction.disposition === "propose-only" && !(gatesPass && loopSupersedesHuman)) {
    violations.push("propose-only is valid only when all gates pass and the sole bar is a loop superseding a human-provenance PRDR");
  }
  return { contractData: { disposition: extraction.disposition, upper, lower, authority, ratchet, reasons, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractPrdrAdmission(extraction) {
  const { contractData, failLoud } = computePrdrAdmission(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "prdr-admission");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// The PRODUCER (`faff prdr admit`): the deterministic two-gate gate. Computes authority (provenance),
// by_level (recursive invariant), and the count-ratchet itself; folds in the FAFF-256 (upper) /
// FAFF-257 (lower) verdicts, or their fail-safe defaults when absent. Pure — no tracker/network call
// (parity with `faff next`); the agent maps state → these closed-vocabulary inputs. Emits a verdict
// that is conformant by construction (validated belt-and-braces by the caller via schemaCheck).
function computePrdrAdmissionVerdict(input) {
  const reasons = [];
  // (B) recursive invariant: human is the outermost encloser (always ok); a loop operating UNDER the
  // PRDR it would supersede (`self`) cannot move its own setpoint → by_level violation.
  const by_level = input.actor === "human" ? "ok" : (input.self ? "violation" : "ok");
  const authority = { actor: input.actor, supersedes_provenance: input.supersedesProvenance, by_level };

  // (C) thrash-ratchet (count half): lineage count within window is agent-supplied; the CLI compares
  // it to thrash_max. (The per-supersession adversarial drift review is the `review` slot's job.)
  const lineage = Number.isInteger(input.lineageSupersessions) ? input.lineageSupersessions : 0;
  const breached = lineage >= input.thrashMax;
  const ratchet = { lineage_supersessions: lineage, breached };

  // upper (256) — absent ⇒ fail-safe: a NEW-capability PRDR is not admitted (no YAGNI judge to vouch
  // it isn't gold-plating); a like-for-like supersession is admitted.
  let upper;
  if (input.upper && typeof input.upper === "object" && !Array.isArray(input.upper)) {
    upper = { admit: !!input.upper.admit, reason: typeof input.upper.reason === "string" ? input.upper.reason : "" };
  } else {
    const admit = !input.newCapability;
    upper = { admit, reason: admit ? "fail-safe default: 256 absent — like-for-like supersession admitted" : "fail-safe default: 256 absent — new-capability PRDR not admitted (no YAGNI judge)" };
  }
  // lower (257) — absent ⇒ conservative: a supersession that drops a goal's last live PRDR is not
  // covered (escalate; never silently abandon a goal).
  let lower;
  if (input.lower && typeof input.lower === "object" && !Array.isArray(input.lower)) {
    lower = { covered: !!input.lower.covered, uncovered_goals: Array.isArray(input.lower.uncovered_goals) ? input.lower.uncovered_goals.filter((g) => typeof g === "string") : [] };
  } else {
    lower = { covered: !input.dropsLastGoal, uncovered_goals: input.dropsLastGoal ? ["<257 absent: supersession drops a goal's last live PRDR>"] : [] };
  }

  const loopSupersedesHuman = authority.actor === "loop" && authority.supersedes_provenance === "human";
  const gatesPass = prdrGatesPass(upper, by_level, ratchet, lower);

  let disposition;
  if (gatesPass && !loopSupersedesHuman) {
    disposition = "admit";
  } else if (gatesPass && loopSupersedesHuman) {
    disposition = "propose-only";
    reasons.push("loop supersedes a human-provenance PRDR — propose-only; effective only on human tracker ratification (Status: Accepted). The loop never self-ratifies.");
  } else {
    disposition = "reject";
    if (!upper.admit) reasons.push(`upper/YAGNI gate did not admit: ${upper.reason}`);
    if (by_level === "violation") reasons.push("by-level violation — actor cannot supersede the PRDR governing its own increment (per-increment immutability)");
    if (breached) reasons.push(`thrash ratchet breached — lineage accrued ${lineage} supersession(s) (≥ thrash_max ${input.thrashMax}) within window — escalate to human`);
    if (!lower.covered) reasons.push(`lower/coverage gate: supersession would leave a PRD goal uncovered — escalate, no silent abandonment${lower.uncovered_goals.length ? " (" + lower.uncovered_goals.join(", ") + ")" : ""}`);
    if (loopSupersedesHuman) reasons.push("note: also a loop→human supersession (would be propose-only were it not for the hard violation above)");
  }
  return { disposition, upper, lower, authority, ratchet, reasons, conformant: true, violations: [] };
}

// --- adr-admission (FAFF-199) ---
// The ADR-axis sibling of prdr-admission: a two-gate-bound admission verdict that lets the loop
// supersede its OWN earlier ADRs ("loop-provenance") while human/legacy-provenance ADRs stay
// guardrails ("propose-only"). Ports ADR 0022's PRDR pattern verbatim for authority/by-level/ratchet;
// the PRD-specific upper(YAGNI)/lower(coverage) value gates have no ADR analogue, so they are
// replaced by ONE folded `challenge` gate — the per-move adversarial drift review (a different
// model re-examines the supersession argument). `faff adr admit` is the PRODUCER
// (computeAdrAdmissionVerdict); THIS is the consumer-side SHAPE validator (mirrors
// computePrdrAdmission). NO safe coerce target — faff's own producer emits it, so an out-of-enum
// disposition/authority/challenge value is an assignment bug → fail-loud (never coerced toward
// `admit`). The load-bearing invariant guarded here: an `admit` disposition MUST satisfy the
// two-gate constraint (challenge.outcome==survived ∧ by_level==ok ∧ ¬ratchet.breached ∧
// ¬(loop supersedes human)). A missing/unreachable challenge (`outcome: absent`) is a REJECT
// reason, never coerced to `survived` — "a missing adversarial challenge is a reject, never a
// pass" (fail-safe toward the harder-to-supersede tier).
const ADR_CHALLENGE_OUTCOMES = ["survived", "overturned", "absent"];

// Does the verdict's gate state permit `admit`? Shared by producer + validator so the constraint
// has one definition (mirrors prdrGatesPass). A missing/overturned challenge never passes.
function adrGatesPass(challengeOutcome, by_level, ratchet) {
  return challengeOutcome === "survived" && by_level === "ok" && !ratchet.breached;
}

function computeAdrAdmission(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!PRDR_DISPOSITIONS.includes(extraction.disposition)) {
    return { contractData: null, failLoud: `disposition ${JSON.stringify(extraction.disposition)} not in {admit,propose-only,reject} — no safe coerce target` };
  }
  const a = extraction.authority;
  if (a === null || typeof a !== "object" || Array.isArray(a)) {
    return { contractData: null, failLoud: "authority must be an object" };
  }
  if (!PRDR_ACTORS.includes(a.actor)) return { contractData: null, failLoud: `authority.actor ${JSON.stringify(a.actor)} not in {loop,human}` };
  if (!PRDR_SUPERSEDES.includes(a.supersedes_provenance)) return { contractData: null, failLoud: `authority.supersedes_provenance ${JSON.stringify(a.supersedes_provenance)} not in {human,loop,none}` };
  if (!PRDR_BY_LEVEL.includes(a.by_level)) return { contractData: null, failLoud: `authority.by_level ${JSON.stringify(a.by_level)} not in {ok,violation}` };

  const ch = extraction.challenge;
  if (ch === null || typeof ch !== "object" || Array.isArray(ch)) {
    return { contractData: null, failLoud: "challenge must be an object" };
  }
  if (!ADR_CHALLENGE_OUTCOMES.includes(ch.outcome)) return { contractData: null, failLoud: `challenge.outcome ${JSON.stringify(ch.outcome)} not in {survived,overturned,absent}` };
  const challenge = { ran: !!ch.ran, outcome: ch.outcome };

  const violations = [];
  const ra = (extraction.ratchet && typeof extraction.ratchet === "object" && !Array.isArray(extraction.ratchet)) ? extraction.ratchet : {};
  let lineage = ra.lineage_supersessions;
  if (!Number.isInteger(lineage)) { violations.push(`ratchet.lineage_supersessions ${JSON.stringify(lineage)} not an integer — normalised to 0`); lineage = 0; }
  const ratchet = { lineage_supersessions: lineage, breached: !!ra.breached };
  const authority = { actor: a.actor, supersedes_provenance: a.supersedes_provenance, by_level: a.by_level };
  const reasons = Array.isArray(extraction.reasons) ? extraction.reasons.filter((r) => typeof r === "string") : [];

  const loopSupersedesHuman = authority.actor === "loop" && authority.supersedes_provenance === "human";
  const gatesPass = adrGatesPass(challenge.outcome, authority.by_level, ratchet);
  // The load-bearing conformance: an `admit` must have actually passed every gate AND not be a
  // loop→human move; a `propose-only` is valid ONLY when gates pass and that move is the sole bar.
  if (extraction.disposition === "admit" && !(gatesPass && !loopSupersedesHuman)) {
    violations.push("admit disposition violates the two-gate constraint (requires challenge.outcome==survived ∧ by_level==ok ∧ ¬ratchet.breached ∧ ¬(loop supersedes human))");
  }
  if (extraction.disposition === "propose-only" && !(gatesPass && loopSupersedesHuman)) {
    violations.push("propose-only is valid only when all gates pass and the sole bar is a loop superseding a human-provenance ADR");
  }
  return { contractData: { disposition: extraction.disposition, authority, challenge, ratchet, reasons, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractAdrAdmission(extraction) {
  const { contractData, failLoud } = computeAdrAdmission(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "adr-admission");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// The PRODUCER (`faff adr admit`): the deterministic two-gate gate, ported from
// computePrdrAdmissionVerdict with the upper/lower value gates replaced by the folded `challenge`
// gate. Computes authority (provenance), by_level (recursive invariant — a loop cannot supersede
// the ADR governing its own current increment), and the count-ratchet itself; folds in the
// agent-supplied drift-challenge outcome (or its fail-safe `absent` default). Pure — no
// tracker/network call (parity with `faff next` / `faff prdr admit`); the agent maps state → these
// closed-vocabulary inputs. Emits a verdict that is conformant by construction (validated
// belt-and-braces by the caller via schemaCheck).
function computeAdrAdmissionVerdict(input) {
  const reasons = [];
  // Recursive invariant: human is the outermost encloser (always ok); a loop operating UNDER the
  // ADR it would supersede (`self`) cannot move its own setpoint → by_level violation.
  const by_level = input.actor === "human" ? "ok" : (input.self ? "violation" : "ok");
  const authority = { actor: input.actor, supersedes_provenance: input.supersedesProvenance, by_level };

  // Thrash-ratchet (count half): lineage count within window is agent-supplied; the CLI compares
  // it to thrash_max. (The per-supersession adversarial drift review is the `challenge` gate below.)
  const lineage = Number.isInteger(input.lineageSupersessions) ? input.lineageSupersessions : 0;
  const breached = lineage >= input.thrashMax;
  const ratchet = { lineage_supersessions: lineage, breached };

  // challenge — the ADR-axis value gate (no PRD-goal analogue exists, so unlike PRDR's upper/lower
  // fail-safe defaults, an absent/unreachable challenge is simply `absent`: never coerced toward
  // `survived`, so it can only ever block admit/propose-only, never grant them.
  const outcome = (input.challenge === "survived" || input.challenge === "overturned") ? input.challenge : "absent";
  const challenge = { ran: outcome !== "absent", outcome };

  const loopSupersedesHuman = authority.actor === "loop" && authority.supersedes_provenance === "human";
  const gatesPass = adrGatesPass(challenge.outcome, by_level, ratchet);

  let disposition;
  if (gatesPass && !loopSupersedesHuman) {
    disposition = "admit";
  } else if (gatesPass && loopSupersedesHuman) {
    disposition = "propose-only";
    reasons.push("loop supersedes a human-provenance ADR — propose-only; effective only when a human ratifies via /faff-wtf running the existing interactive `faff adr supersede`. The loop never self-ratifies.");
  } else {
    disposition = "reject";
    if (challenge.outcome === "overturned") reasons.push("drift challenge overturned — the adversarial reviewer found the supersession argument unsound");
    else if (challenge.outcome === "absent") reasons.push("drift challenge absent — no adversarial review ran, or it was unreachable after its fallback chain; a missing skeptic is a reject, never a pass");
    if (by_level === "violation") reasons.push("by-level violation — actor cannot supersede the ADR governing its own increment (per-increment immutability)");
    if (breached) reasons.push(`thrash ratchet breached — lineage accrued ${lineage} supersession(s) (≥ thrash_max ${input.thrashMax}) within window — escalate to human`);
    if (loopSupersedesHuman) reasons.push("note: also a loop→human supersession (would be propose-only were it not for the hard violation above)");
  }
  return { disposition, authority, challenge, ratchet, reasons, conformant: true, violations: [] };
}

// --- l4-topology-envelope (FAFF-493) ---
// The L4 topology-write-authority envelope — the de-risk spike's emitted deliverable (ADR-0071).
// A separate referencing contract that composes the existing appetite-keyed topology-write-authority
// dial (SKILL.md:712-729) via the ADR-0037 `full`-at-L4 pin — NOT a new dial-table row. Scope:
// autonomous first-slice epic-create at L4, the reversible reparent/convert/rehome ops the dial
// already grants at `full`, and (ADR-0072, superseding ADR-0071's container row in part) L4
// container-create inside the accepted-root envelope — a loop-authored container contained under the
// run's admitted root PRD (`contained_under_accepted_prd`, caller-asserted from the run ledger's
// `prd_root_container` + `faff contain`; the PRDR two-gate rule applied to the tracker medium: the
// human Accept sits at the root, once). Outside that envelope container-create stays confirm-gated
// (the faff-plot container-confirm floor, faff-plot/SKILL.md:67); human-curated provenance always
// degrades to propose-only (SKILL.md:485,725); cancel/delete are forbidden at every level (the
// reversibility floor, SKILL.md:724,731). See ADR-0071's Two-floor conformance proof +
// 216-independence trace, and ADR-0072's two-floor citation for the container-create admit row.
//
// `l4TopologyDecision(op)` is the PRODUCER-side pure decision table (Pattern-C-style core). THIS is the
// consumer-side Pattern-B validator (mirrors computePrdrAdmission): given an extraction shaped
// `{op, verdict}`, it re-derives the expected verdict from `op` via the SAME table and checks the
// declared `verdict` conforms — never trusts a claimed disposition at face value. Disposition vocabulary
// is deliberately `PRDR_DISPOSITIONS` (admit/propose-only/reject) — reused verbatim, not redefined, so a
// consumer that already reads `faff prdr admit` verdicts (FAFF-495) reads this one with no translation.
const L4_ENVELOPE_OP_KINDS = ["container-create", "epic-create", "reparent", "convert", "rehome", "cancel", "delete"];
const L4_ENVELOPE_LEVELS = ["L1", "L2", "L3", "L4"];
const L4_ENVELOPE_PROVENANCE = ["faff-authored", "human-curated"];

// The pure decision table (ADR-0071 §Decision, container-create row per ADR-0072). No tracker/network/
// LLM call — a plain function of the five `op` fields. Order matters: floors are checked outermost-in
// (reversibility floor first — cancel/delete are forbidden regardless of provenance or kind; then the
// human-curated floor — it pre-empts every op kind including container-create/epic-create/reparent;
// then the per-kind rows).
function l4TopologyDecision(op) {
  const { kind, level, provenance, parent_confirmed, contained_under_accepted_prd } = op;
  if (kind === "cancel" || kind === "delete") {
    return { disposition: "reject", reason: "reversibility-floor: cancel/delete forbidden at every level, always (SKILL.md:724,731)", reversible: false };
  }
  if (provenance === "human-curated") {
    return { disposition: "propose-only", reason: "human-curated-structure-floor: never silently restructure human-curated structure — propose-and-confirm (SKILL.md:485,725)", reversible: true };
  }
  if (kind === "container-create") {
    if (level === "L4" && contained_under_accepted_prd === true) {
      return { disposition: "admit", reason: "prdr-lifecycle: loop-authored container contained under the run's admitted root PRD — the human Accept sits at the root, once (ADR-0072)", reversible: true };
    }
    return { disposition: "propose-only", reason: "outside the accepted-root envelope — container-confirm holds (faff-plot/SKILL.md:67, ADR-0072)", reversible: true };
  }
  if (kind === "epic-create") {
    if (level === "L4" && parent_confirmed === true) {
      return { disposition: "admit", reason: "L4 topology-write envelope: first-slice epic under a confirmed parent, faff-authored, admitted via the ADR-0037 full-at-L4 pin (ADR-0071)", reversible: true };
    }
    return { disposition: "propose-only", reason: "outside the L4 envelope (not L4, or parent unconfirmed) — falls back to the base appetite-keyed dial", reversible: true };
  }
  if (kind === "reparent" || kind === "convert" || kind === "rehome") {
    return { disposition: "admit", reason: "reversibility-floor: reparent/convert/rehome are reversible ops the dial already grants at full (SKILL.md:724)", reversible: true };
  }
  return { disposition: "reject", reason: `unrecognised op kind: ${JSON.stringify(kind)}`, reversible: false };
}

function computeL4TopologyEnvelope(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const o = extraction.op;
  if (o === null || typeof o !== "object" || Array.isArray(o)) {
    return { contractData: null, failLoud: "op must be an object" };
  }
  if (!L4_ENVELOPE_OP_KINDS.includes(o.kind)) return { contractData: null, failLoud: `op.kind ${JSON.stringify(o.kind)} not in {${L4_ENVELOPE_OP_KINDS.join(",")}}` };
  if (!L4_ENVELOPE_LEVELS.includes(o.level)) return { contractData: null, failLoud: `op.level ${JSON.stringify(o.level)} not in {${L4_ENVELOPE_LEVELS.join(",")}}` };
  if (!L4_ENVELOPE_PROVENANCE.includes(o.provenance)) return { contractData: null, failLoud: `op.provenance ${JSON.stringify(o.provenance)} not in {${L4_ENVELOPE_PROVENANCE.join(",")}}` };
  if (typeof o.parent_confirmed !== "boolean") return { contractData: null, failLoud: "op.parent_confirmed must be a boolean" };
  if (typeof o.contained_under_accepted_prd !== "boolean") return { contractData: null, failLoud: "op.contained_under_accepted_prd must be a boolean" };

  const v = extraction.verdict;
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return { contractData: null, failLoud: "verdict must be an object" };
  }
  if (!PRDR_DISPOSITIONS.includes(v.disposition)) {
    return { contractData: null, failLoud: `verdict.disposition ${JSON.stringify(v.disposition)} not in {admit,propose-only,reject} — no safe coerce target` };
  }
  if (typeof v.reversible !== "boolean") return { contractData: null, failLoud: "verdict.reversible must be a boolean" };

  const op = { kind: o.kind, level: o.level, provenance: o.provenance, parent_confirmed: o.parent_confirmed, contained_under_accepted_prd: o.contained_under_accepted_prd };
  const verdict = { disposition: v.disposition, reason: typeof v.reason === "string" ? v.reason : "", reversible: v.reversible };

  const violations = [];
  const expected = l4TopologyDecision(op);
  if (verdict.disposition !== expected.disposition) {
    violations.push(`declared disposition ${JSON.stringify(verdict.disposition)} does not match the envelope decision table's ${JSON.stringify(expected.disposition)} for op ${JSON.stringify(op)}`);
  }
  if (verdict.reversible !== expected.reversible) {
    violations.push(`declared reversible ${JSON.stringify(verdict.reversible)} does not match the envelope decision table's ${JSON.stringify(expected.reversible)} for op ${JSON.stringify(op)}`);
  }
  if (Array.isArray(extraction.violations)) {
    for (const v2 of extraction.violations) if (typeof v2 === "string" && v2.trim()) violations.push(v2);
  }

  return { contractData: { op, verdict, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractL4TopologyEnvelope(extraction) {
  const { contractData, failLoud } = computeL4TopologyEnvelope(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "l4-topology-envelope");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- prdr-yagni (FAFF-256) ---
// The UPPER (YAGNI / value) gate FAFF-255 delegates to: given an AuthoredPrdr (FAFF-251), produce
// 255's `upper: {admit, reason}` verdict — "is this PRDR warranted (serves the PRD without exceeding
// it)?". `faff prdr yagni` is the PRODUCER (computePrdrYagniVerdict — the deterministic arbitration);
// THIS is the consumer-side SHAPE validator (mirrors prd-readiness / prdr-admission). NO safe coerce
// target — faff's own producer emits it, so an out-of-enum proposal verdict is an assignment bug →
// fail-loud; the gate is fail-safe toward REFUSAL (a malformed verdict never coerces toward `admit`).
//
// The load-bearing invariant guarded here: an `admit` MUST have earned it through every filter —
// trace_to_goal ∧ proposal.verdict==admit ∧ challenge.ran ∧ ¬challenge.overturns. That is the
// "no gold-plating on doubt" conservative-reject rule, in code.
//
// Two-phase call-site contract (the agent orchestrates; the CLI arbitrates — PURE, no network):
//   1. trace-to-goal precondition (deterministic, NO slot call): `AuthoredPrdr.prd_goal ∈ PRD.goals`,
//      else reject at the door — kills vague / goal-less PRDRs. (Pass `--prd-goal` + `--prd-goals`.)
//   2. Phase 1 — the `methodology` slot's `yagni-judge` named output PROPOSES the value judgment
//      → { serves_goal, within_scope, verdict: admit|reject, reason }. (Pass `--proposal …`.)
//   3. Phase 2 — the `review` (adversarial-review) slot CHALLENGES the proposal with a different model
//      (gold-plating / unwarranted / off-mission) → survived | overturned. (Pass `--challenge …`.)
//      An inconclusive Phase 2 (adversarial provider unreachable after its fallback chain) is NOT
//      a "survived": OMIT `--challenge`, and the producer conservatively rejects on the missing skeptic.
//   4. arbitrate (this producer) → emit one `faff-contract:prdr-yagni` block; locate it, JSON.parse it,
//      pipe it to `faff contract prdr-yagni`, then feed `{admit, reason}` to `faff prdr admit --upper`.
// Grounding (PRD-domain KB via the grounding slot, FAFF-127/128) is ADVISORY — `grounding_present` is
// shape-checked but never gate-decisive; its absence never blocks (judgment proceeds on PRD + methodology).
const PRDR_YAGNI_PROPOSAL_VERDICTS = ["admit", "reject"];
function computePrdrYagni(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const p = extraction.proposal;
  if (p === null || typeof p !== "object" || Array.isArray(p)) {
    return { contractData: null, failLoud: "proposal must be an object" };
  }
  if (!PRDR_YAGNI_PROPOSAL_VERDICTS.includes(p.verdict)) {
    return { contractData: null, failLoud: `proposal.verdict ${JSON.stringify(p.verdict)} not in {admit,reject} — no safe coerce target` };
  }
  const c = extraction.challenge;
  if (c === null || typeof c !== "object" || Array.isArray(c)) {
    return { contractData: null, failLoud: "challenge must be an object" };
  }
  const admit = !!extraction.admit;
  const trace_to_goal = !!extraction.trace_to_goal;
  const grounding_present = !!extraction.grounding_present;
  const proposal = {
    serves_goal: !!p.serves_goal, within_scope: !!p.within_scope,
    verdict: p.verdict, reason: typeof p.reason === "string" ? p.reason : "",
  };
  const challenge = {
    ran: !!c.ran, overturns: !!c.overturns,
    reason: typeof c.reason === "string" ? c.reason : "",
  };
  const reason = typeof extraction.reason === "string" ? extraction.reason : "";
  const violations = [];
  const earned = trace_to_goal && proposal.verdict === "admit" && challenge.ran && !challenge.overturns;
  if (admit && !earned) {
    violations.push("admit verdict violates the conservative arbitration constraint (requires trace_to_goal ∧ proposal.verdict==admit ∧ challenge.ran ∧ ¬challenge.overturns)");
  }
  if (!admit && reason === "") violations.push("reject carries no reason");
  return { contractData: { admit, reason, trace_to_goal, proposal, challenge, grounding_present, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractPrdrYagni(extraction) {
  const { contractData, failLoud } = computePrdrYagni(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "prdr-yagni");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- prd-coverage (FAFF-257) ---
// The LOWER (coverage) gate FAFF-255 delegates to PLUS the `prd-satisfied` roll-up — two faces of one
// `goal↔PRDR↔DoD` relation. `faff prdr coverage` is the PRODUCER (computePrdCoverageVerdict); THIS is
// the consumer-side SHAPE validator (mirrors prdr-yagni / prdr-admission). NO safe coerce target —
// faff's own producer emits it, so a malformed extraction is a fail-loud; the gate is fail-safe toward
// "not satisfied" (a missing/unverified DoD never coerces toward done).
//
// Two faces (the no-gap predicate `prd-satisfied ⟺ coverage ∧ completion`):
//   - COVERAGE (static, buildable now, pure): every PRD goal stays covered by a LIVE (non-superseded)
//     PRDR. `covered` / `uncovered_goals` is 255's `lower` verdict, fed to `faff prdr admit --lower`.
//     A supersession dropping a goal's last live PRDR → uncovered → lower violation (no silent abandonment).
//   - COMPLETION (the roll-up's dynamic half): every live PRDR's DoD is actually `met`, per the FAFF-34
//     evaluator's per-PRDR verdicts. CONSERVATIVE default — a PRDR with no `met` verdict (evaluator
//     absent/unbuilt) is unverified ⇒ not satisfied. So until FAFF-34 lands, `prd-satisfied` is
//     conservatively false (the run CANNOT claim PRD-done without the judge — correct, and the point of
//     the leash). When FAFF-34 lands, its verdicts flow in unchanged.
//
// Load-bearing invariants enforced here as conformance violations (not expressible in the shape schema):
//   covered ⟺ uncovered_goals empty · satisfied ⟹ covered · satisfied ⟹ no unmet/unverified DoD ·
//   not-satisfied carries a reason · completion.all_met ⟺ unmet_or_unverified empty.
function computePrdCoverage(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const comp = extraction.completion;
  if (comp === null || typeof comp !== "object" || Array.isArray(comp)) {
    return { contractData: null, failLoud: "completion must be an object" };
  }
  const covered = !!extraction.covered;
  const uncovered_goals = Array.isArray(extraction.uncovered_goals) ? extraction.uncovered_goals.filter((g) => typeof g === "string") : [];
  const satisfied = !!extraction.satisfied;
  const reason = typeof extraction.reason === "string" ? extraction.reason : "";
  const all_met = !!comp.all_met;
  const unmet_or_unverified = Array.isArray(comp.unmet_or_unverified) ? comp.unmet_or_unverified.filter((p) => typeof p === "string") : [];
  const completion = { all_met, unmet_or_unverified };
  const violations = [];
  if (covered !== (uncovered_goals.length === 0)) violations.push("covered flag disagrees with uncovered_goals (covered ⟺ no uncovered goals)");
  if (all_met !== (unmet_or_unverified.length === 0)) violations.push("completion.all_met disagrees with unmet_or_unverified (all_met ⟺ no unmet/unverified DoD)");
  if (satisfied && !covered) violations.push("satisfied:true while PRD goals are uncovered — a goal lost its last live PRDR (silent abandonment)");
  if (satisfied && unmet_or_unverified.length) violations.push(`satisfied:true while DoD unmet/unverified for: ${unmet_or_unverified.join(", ")} (no false done — unverified ⇏ done)`);
  if (!satisfied && reason === "") violations.push("not satisfied but carries no reason");
  return { contractData: { covered, uncovered_goals, satisfied, reason, completion, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractPrdCoverage(extraction) {
  const { contractData, failLoud } = computePrdCoverage(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "prd-coverage");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- run-termination (FAFF-38) ---
// `faff run-done` is the PRODUCER (computeRunDoneVerdict — the pure composer); THIS is the
// consumer-side SHAPE validator (mirrors prd-coverage). NO safe coerce target — faff's own producer
// emits it, so an out-of-enum verdict / policy_source or a non-object extraction is a fail-loud
// (never coerced toward a terminal `run-complete`). Load-bearing invariant enforced here as a
// conformance violation (the safety floor the whole leash exists to hold): the three fixed
// safety-floor reasons PIN their verdict — `budget-escalated(…)` ⇒ escalate, `undispatched-ledger` ⇒
// continue, `product-incomplete` ⇒ escalate — so a verdict claiming a floor reason with the wrong
// disposition (e.g. a policy that tried to "complete" through the floor) is non-conformant. The
// non-floor rung reasons carry NO such pin (a methodology may legitimately soften their verdict).
const RUN_TERMINATION_POLICY_SOURCES = ["structural-default", "methodology"];
const RUN_TERMINATION_FLOOR_VERDICT = { "undispatched-ledger": "continue", "product-incomplete": "escalate" };
const RUN_TERMINATION_KNOWN_PLAIN = new Set([
  "non-convergence", "value-inflection", "work-remaining", "undispatched-ledger", "product-incomplete", "drained", "all-parked",
]);
function isKnownStopReason(r) {
  if (RUN_TERMINATION_KNOWN_PLAIN.has(r)) return true;
  return /^budget-(escalated|narrow|hit)\(.*\)$/.test(r); // parameterised by the breached dimensions
}
function computeRunTermination(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!RUN_DONE_VERDICTS.includes(extraction.verdict)) {
    return { contractData: null, failLoud: `verdict ${JSON.stringify(extraction.verdict)} not in {run-complete,continue,escalate} — no safe coerce target` };
  }
  if (!RUN_TERMINATION_POLICY_SOURCES.includes(extraction.policy_source)) {
    return { contractData: null, failLoud: `policy_source ${JSON.stringify(extraction.policy_source)} not in {structural-default,methodology} — no safe coerce target` };
  }
  const verdict = extraction.verdict;
  const policy_source = extraction.policy_source;
  const violations = [];
  const reason = typeof extraction.reason === "string" ? extraction.reason : "";
  const signals = (extraction.signals && typeof extraction.signals === "object" && !Array.isArray(extraction.signals)) ? extraction.signals : {};
  if (extraction.signals !== undefined && (extraction.signals === null || typeof extraction.signals !== "object" || Array.isArray(extraction.signals))) {
    violations.push("signals is not an object — treated as empty");
  }
  if (reason === "") violations.push("verdict carries no reason");
  else if (!isKnownStopReason(reason)) violations.push(`reason ${JSON.stringify(reason)} not in the closed stop-reason vocabulary`);
  // SAFETY-FLOOR pin: a floor reason fixes its verdict regardless of any policy.
  if (/^budget-escalated\(.*\)$/.test(reason) && verdict !== "escalate") violations.push("budget-escalated is a safety floor ⇒ verdict must be escalate (no policy may complete through it)");
  for (const [floorReason, mustBe] of Object.entries(RUN_TERMINATION_FLOOR_VERDICT)) {
    if (reason === floorReason && verdict !== mustBe) violations.push(`${floorReason} is a safety floor ⇒ verdict must be ${mustBe} (no policy may override it)`);
  }
  return { contractData: { verdict, reason, signals, policy_source, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractRunTermination(extraction) {
  const { contractData, failLoud } = computeRunTermination(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "run-termination");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- run-trigger (FAFF-496) ---
// `faff run-start` is the PRODUCER (deriveRunTrigger — the pure refusal-biased ladder); THIS is the
// consumer-side Pattern-B validator (mirrors l4-topology-envelope / prdr-admission): given an extraction
// shaped `{signals, verdict, reason}`, it RE-DERIVES the expected {verdict, reason} from `signals` via the
// SAME ladder and checks the declared pair conforms — never trusting a claimed verdict at face value. The
// re-derived pair is what the contractData carries (the derived governs — a forged/hand-altered verdict can
// never widen past what the signals themselves justify), and any declared mismatch is a conformance
// violation (exit 1). FAIL-SAFE toward `refuse`: normalizeRunTriggerSignals coerces every non-true signal
// to false, so a malformed/all-false bundle derives `refuse / no-target` — the privileged `plan` is
// structurally unreachable unless every affirmative signal is explicitly true. Fail-loud (exit 2) ONLY on a
// non-object extraction (nothing to re-derive from), never on a bad declared verdict (that is a violation,
// not a crash — the derived pair still governs), which is the run-start refusal bias, distinct from
// run-termination's "no safe coerce target" fail-loud on an out-of-enum verdict.
function computeRunTrigger(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const violations = [];
  if (extraction.signals !== undefined && (extraction.signals === null || typeof extraction.signals !== "object" || Array.isArray(extraction.signals))) {
    violations.push("signals is not an object — treated as empty (fail-safe → refuse)");
  }
  const signals = normalizeRunTriggerSignals(extraction.signals);
  const expected = deriveRunTrigger(signals);
  // The declared pair is checked against the re-derivation; a mismatch is the load-bearing Pattern-B
  // violation ("validator re-derives, never trusts"). The derived pair is authoritative in contractData.
  if (extraction.verdict !== undefined && extraction.verdict !== expected.verdict) {
    violations.push(`declared verdict ${JSON.stringify(extraction.verdict)} does not match the re-derived ${JSON.stringify(expected.verdict)} for the given signals`);
  }
  if (extraction.reason !== undefined && extraction.reason !== expected.reason) {
    violations.push(`declared reason ${JSON.stringify(extraction.reason)} does not match the re-derived ${JSON.stringify(expected.reason)} for the given signals`);
  }
  return { contractData: { verdict: expected.verdict, reason: expected.reason, signals, conformant: violations.length === 0, violations }, failLoud: null };
}

function contractRunTrigger(extraction) {
  const { contractData, failLoud } = computeRunTrigger(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "run-trigger");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// The PRODUCER (`faff prdr coverage`): the pure roll-up. No tracker/network call (parity with `faff prdr
// yagni` / `admit` / `faff next`); the agent maps the PRD's declared goals + the live-PRDR set (and the
// FAFF-34 per-PRDR DoD verdicts, when the evaluator exists) onto these closed-vocabulary inputs. Emits a
// verdict conformant by construction (validated belt-and-braces by the caller via schemaCheck).
//   - prdGoals: the PRD's declared goals (FAFF-252).
//   - livePrdrs: the LIVE (non-superseded) PRDRs, each { id, prd_goal, dod_verdict? }. From `prdr list
//     --live --json`. To gate a supersession at admission, the agent passes the PROSPECTIVE live set
//     (the to-be-superseded PRDR excluded, any replacement included) — if a goal then has no live PRDR,
//     coverage drops it → covered:false → fed to `prdr admit --lower` → reject (no silent abandonment).
//   - dod_verdict: the FAFF-34 evaluator's per-PRDR DoD verdict. Anything other than the literal "met"
//     (including absent/undefined — the evaluator is unbuilt) is UNVERIFIED ⇒ not met (conservative).
function computePrdCoverageVerdict(input) {
  const goals = Array.isArray(input.prdGoals) ? input.prdGoals.filter((g) => typeof g === "string") : [];
  const live = Array.isArray(input.livePrdrs) ? input.livePrdrs.filter((p) => p && typeof p === "object" && !Array.isArray(p)) : [];
  const citedGoals = new Set(live.map((p) => (typeof p.prd_goal === "string" ? p.prd_goal : "")));
  // COVERAGE (static): a PRD goal with no live PRDR citing it is uncovered. Dedup — `uncovered_goals` is
  // consumed downstream (`prdr admit --lower`), so a duplicate-bearing caller goal list yields a clean set.
  const uncovered_goals = [...new Set(goals.filter((g) => !citedGoals.has(g)))];
  const covered = uncovered_goals.length === 0;
  // COMPLETION (dynamic): a live PRDR whose FAFF-34 DoD verdict is not exactly "met" is unmet/unverified.
  const prdrLabel = (p) => (typeof p.id === "string" && p.id) || (typeof p.prd_goal === "string" ? `(goal: ${p.prd_goal})` : "<unidentified PRDR>");
  const unmet_or_unverified = [...new Set(live.filter((p) => p.dod_verdict !== "met").map(prdrLabel))];
  const all_met = unmet_or_unverified.length === 0;
  const completion = { all_met, unmet_or_unverified };
  // ROLL-UP: prd-satisfied ⟺ coverage ∧ completion (the no-gap predicate). Conservative throughout.
  const satisfied = covered && all_met;
  let reason = "";
  if (!covered) reason = `uncovered goals (no live PRDR covers): ${uncovered_goals.join(", ")}`;
  else if (!all_met) reason = `DoD unmet/unverified (FAFF-34 verdict ≠ met): ${unmet_or_unverified.join(", ")}`;
  // FAFF-496 §3a: the additive, NON-GATING `measure` block (observability + the future ratio-tolerance
  // knob's reserved home). Purely derived from the SAME distinct-goal set the coverage gate already uses —
  // it changes NO existing covered/satisfied/completion semantics; run-start reads `.covered`, not `.measure`.
  const total_goals = new Set(goals).size;
  const measure = { total_goals, covered_goals: total_goals - uncovered_goals.length };
  return { covered, uncovered_goals, satisfied, reason, completion, measure, conformant: true, violations: [] };
}

// --- prd-distance (FAFF-535) ---
// The PRD-satisfaction-greedy drain-ordering signal. Distance = steps remaining in the pipeline to a
// `met` DoD, as a coarse four-class ladder (lower class_rank = nearer to advancing the parent PRD). NOT
// a judgement or a takeover of the ordering slot — it is a pure, PRD-scoped INPUT the methodology composes
// as a within-band tiebreaker (see the gateway Standard-envelope floor). The orchestration layer holds no
// ordering opinion (beep-boop assembles this, the methodology ranks). Byte-identical when absent: no PRD
// in scope ⇒ this is never assembled and every ordering output is unchanged.
const DISTANCE_CLASSES = ["met", "unverified", "unmet", "uncovered"];
// class_rank ladder — lower = nearer. met 0 (done; excluded from preference, kept for observability),
// unverified 1 (live PRDR, no verdict — one evaluation from met), unmet 2 (live PRDR, verdict present but
// ≠ met — a known gap: fix + re-evaluate), uncovered 3 (a PRD goal with NO live PRDR — the whole pipeline).
const DISTANCE_CLASS_RANK = { met: 0, unverified: 1, unmet: 2, uncovered: 3 };

// The PRODUCER (`faff prdr distance`): the pure per-sibling remainder. No tracker/network call (parity
// with `faff prdr coverage` / `yagni` / `admit`). Reuses computePrdCoverageVerdict for the uncovered set —
// one classifier, no fork (the anti-pattern the spec forbids). Emits a verdict conformant by construction
// (validated belt-and-braces by the caller via schemaCheck).
//   - prdGoals: the PRD's declared goals (FAFF-252).
//   - livePrdrs: the LIVE (non-superseded) PRDRs, each { id, prd_goal, container?, dod_verdict? }.
//   - dod_verdict: the FAFF-34 evaluator's per-PRDR DoD verdict. Anything other than the literal "met"
//     (including absent/undefined) is unverified/unmet per the ladder — coverage's conservative rule.
function computePrdDistance(input) {
  const live = Array.isArray(input.livePrdrs) ? input.livePrdrs.filter((p) => p && typeof p === "object" && !Array.isArray(p)) : [];
  // Reuse coverage for the uncovered set — its dedup + prospective-live-set semantics come free. Feed the
  // SAME filtered `live` set (not the raw input) so both consumers see one input shape (coverage re-filters
  // internally today, but that internal filter is not this fn's to depend on).
  const cov = computePrdCoverageVerdict({ prdGoals: input.prdGoals, livePrdrs: live });
  const entries = [];
  for (const p of live) {
    let distance_class;
    if (p.dod_verdict === "met") distance_class = "met";          // literal match, coverage parity
    else if (p.dod_verdict === undefined || p.dod_verdict === null) distance_class = "unverified"; // no verdict
    else distance_class = "unmet";                                 // present but ≠ "met" (incl. unknown strings)
    entries.push({
      kind: "prdr",
      id: typeof p.id === "string" ? p.id : (p.id != null ? String(p.id) : null),
      container: typeof p.container === "string" ? p.container : null,
      prd_goal: typeof p.prd_goal === "string" ? p.prd_goal : "",
      dod_verdict: (p.dod_verdict === undefined || p.dod_verdict === null) ? null : p.dod_verdict,
      distance_class,
      class_rank: DISTANCE_CLASS_RANK[distance_class],
    });
  }
  for (const g of cov.uncovered_goals) {
    entries.push({ kind: "goal", id: null, container: null, prd_goal: g, dod_verdict: null, distance_class: "uncovered", class_rank: 3 });
  }
  // Deterministic baseline sort: (class_rank asc, then id ?? prd_goal asc). Stable — intra-class ordering
  // above this baseline is the methodology's call (the primary sort key across classes stays distance).
  entries.sort((a, b) => (a.class_rank - b.class_rank) || String(a.id ?? a.prd_goal).localeCompare(String(b.id ?? b.prd_goal)));
  return { entries, prd_satisfied: cov.satisfied, conformant: true, violations: [] };
}

// The consumer-side SHAPE validator (mirrors prd-coverage / prdr-yagni). NO safe coerce target — faff's own
// producer emits it, so a malformed extraction is fail-loud. Load-bearing invariants enforced as conformance
// violations (not expressible in the shape schema): the ladder pin `class_rank === rank(distance_class)`, the
// biconditional `kind === "goal" ⟺ distance_class === "uncovered"`, and `prd_satisfied` boolean presence.
function contractPrdDistance(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { failLoud: "extraction must be a JSON object" };
  }
  const rawEntries = Array.isArray(extraction.entries) ? extraction.entries : [];
  const entries = [];
  const violations = [];
  rawEntries.forEach((e, i) => {
    if (e === null || typeof e !== "object" || Array.isArray(e)) { violations.push(`entries[${i}] is not an object`); return; }
    const kind = e.kind;
    const distance_class = e.distance_class;
    const class_rank = e.class_rank;
    // Self-sufficient conformance: flag an out-of-enum class as a violation here rather than leaning on the
    // downstream schemaCheck enum as the sole backstop (parity with the other validators, e.g. an unknown
    // review-verdict signal). schemaCheck still fail-louds it (exit 2); this makes the verdict authoritative.
    if (!DISTANCE_CLASSES.includes(distance_class)) {
      violations.push(`entries[${i}] distance_class ${JSON.stringify(distance_class)} not in {${DISTANCE_CLASSES.join(", ")}}`);
    } else if (DISTANCE_CLASS_RANK[distance_class] !== class_rank) {
      violations.push(`entries[${i}] class_rank ${JSON.stringify(class_rank)} disagrees with distance_class ${JSON.stringify(distance_class)} (ladder: met 0 / unverified 1 / unmet 2 / uncovered 3)`);
    }
    if ((kind === "goal") !== (distance_class === "uncovered")) {
      violations.push(`entries[${i}] kind/distance_class breach: kind === "goal" ⟺ distance_class === "uncovered"`);
    }
    entries.push({
      kind, id: e.id ?? null, container: e.container ?? null,
      prd_goal: typeof e.prd_goal === "string" ? e.prd_goal : "",
      dod_verdict: e.dod_verdict ?? null, distance_class, class_rank,
    });
  });
  const prd_satisfied = !!extraction.prd_satisfied;
  const contractData = { entries, prd_satisfied, conformant: violations.length === 0, violations };
  const schemaErr = schemaCheck(contractData, "prd-distance");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// The PRODUCER (`faff prdr yagni`): the deterministic two-phase arbitration. Pure — no tracker/network
// call (parity with `faff prdr admit` / `faff next`); the agent maps the trace + the two slot results
// onto these closed-vocabulary inputs. Emits a verdict conformant by construction (validated
// belt-and-braces by the caller via schemaCheck). The conservative-reject rule (no gold-plating on
// doubt) is the sole place `admit` can be earned: trace ∧ proposal admits ∧ skeptic ran ∧ ¬overturned.
function computePrdrYagniVerdict(input) {
  const goals = Array.isArray(input.prdGoals) ? input.prdGoals.filter((g) => typeof g === "string") : [];
  const prdGoal = typeof input.prdGoal === "string" ? input.prdGoal : "";
  const trace_to_goal = prdGoal !== "" && goals.includes(prdGoal);
  // A Phase-1 proposal is "supplied" only when the methodology actually returned admit|reject.
  // Absent (or out-of-enum) ⇒ NOT an explicit reject — it gets its own honest conservative-reject
  // branch below, symmetric with the inconclusive-challenge branch. The recorded verdict is the
  // safe "reject" representation (the contract enum admits no third state), but the reason is truthful.
  const proposalSupplied = PRDR_YAGNI_PROPOSAL_VERDICTS.includes(input.proposalVerdict);
  const proposalVerdict = proposalSupplied ? input.proposalVerdict : "reject";
  const proposal = {
    serves_goal: !!input.servesGoal, within_scope: !!input.withinScope,
    verdict: proposalVerdict, reason: typeof input.proposalReason === "string" ? input.proposalReason : "",
  };
  // challenge: "survived" | "overturned" | null (null ⇒ Phase 2 did not conclude — conservative).
  const challengeRan = input.challenge === "survived" || input.challenge === "overturned";
  const overturns = input.challenge === "overturned";
  const challenge = { ran: challengeRan, overturns, reason: typeof input.challengeReason === "string" ? input.challengeReason : "" };

  let admit, reason;
  if (!trace_to_goal) {
    admit = false;
    reason = `no PRD-goal trace: PRDR cites ${JSON.stringify(prdGoal || "<none>")} which is not a declared PRD goal`;
  } else if (!proposalSupplied) {
    admit = false;
    reason = "conservative reject (no gold-plating on doubt) — no methodology (Phase-1) proposal supplied; the upper gate cannot admit without one";
  } else if (proposalVerdict === "reject") {
    admit = false;
    reason = `conservative reject (no gold-plating on doubt) — methodology proposed reject: ${proposal.reason || "unwarranted or exceeds PRD scope"}`;
  } else if (!challengeRan) {
    admit = false;
    reason = "conservative reject (no gold-plating on doubt) — Phase-2 adversarial challenge did not conclude (skeptic unavailable); the YAGNI judge cannot self-grade";
  } else if (overturns) {
    admit = false;
    reason = `conservative reject (no gold-plating on doubt) — adversarial challenge overturned the proposal: ${challenge.reason || "gold-plating / serves the goal but exceeds PRD scope"}`;
  } else {
    admit = true;
    reason = proposal.reason || "methodology admits (serves the goal, within scope) and the adversarial challenge did not overturn it";
  }
  return { admit, reason, trace_to_goal, proposal, challenge, grounding_present: !!input.groundingPresent, conformant: true, violations: [] };
}

// --- integrity-floor (FAFF-350) ---
// The PURE decision core of `faff merge-gate` — the merge floor as a testable contract,
// registered here so the same table-driven contract-selftest harness that gates every other
// contract also gates the floor combination logic (FAFF-3's spec named this extension point).
// It NEVER observes CI or reads artifacts — the impure `cmdMergeGate` shell gathers those into a
// FloorInputs record and calls decideFloor; this contract re-validates + decides. Fail-closed:
// out-of-enum inputs are a shell bug, not a mergeable state, so they FAIL-LOUD (exit 2) — there is
// no "safe coerce to pass" here, ever. `violations` carries the blockers, so the uniform exitFor
// maps blockers-empty→exit 0 (merge-ok) and blockers-present→exit 1 (refuse).
const CI_STATES = ["ci-green", "ci-red", "no-ci-coverage", "indeterminate"];
const FLOOR_REVIEW_VERDICTS = ["pass", "fail", "needs-human", "unavailable", "missing"];
const FLOOR_LEVELS = ["L1", "L2", "L3", "L4"];
const FLOOR_HOLDOUTS = ["meets-spec", "blocked", "missing", "not-applicable"];
const NO_CI_POLICIES = ["needs-human", "allow"];
// FAFF-690 (F2): the corrective-integrity attestation states the merge floor keys on — the exact
// four values resolveIntegrity (merge-gate.js) can emit. "violated" (a declaration failed
// verification) blocks at EVERY level; "unasserted-refuse" (no declaration on an L4-resolved run)
// blocks (defence-in-depth); "asserted" and "unasserted-ok" never block. Absent from an extraction,
// computeIntegrityFloor defaults it level-awarely (fail-closed at L4) rather than dropping the leg.
const FLOOR_INTEGRITY = ["asserted", "unasserted-ok", "unasserted-refuse", "violated"];

// PURE: FloorInputs -> { verdict, blockers }. Same inputs, same verdict — the whole point of the
// ticket. Every failing leg is reported (never just the first) so a refuse names all its causes.
// `f.integrity` (FAFF-325, optional — undefined is a no-op, so every pre-existing caller/fixture
// that never set it is unaffected): the corrective-integrity attestation state cmdMergeGate derived
// from correctiveIntegrityProbe + integrityGate(_, "merge-floor") for THIS pr's merge-floor
// artifacts — "asserted" | "unasserted-ok" | "unasserted-refuse" | "violated". "violated" (a
// declaration exists but failed verification: env-injection/malformed/dir-mismatch) refuses at
// EVERY level, never level-graded. "unasserted-refuse" is the L4 defence-in-depth leg (no
// declaration at all, on a run cmdMergeGate resolved as L4) — the run-start preflight should
// already have refused admission, so reaching here is a belt-and-braces catch, not the primary
// gate. "asserted" and "unasserted-ok" never block.
function decideFloor(f) {
  const blockers = [];
  if (!f.ac_complete) blockers.push("ACs not all verified");
  if (f.review_verdict !== "pass") blockers.push(`review verdict is ${f.review_verdict} (need pass)`);
  if (f.ci_state === "ci-red") blockers.push("CI failing on head sha");
  if (f.ci_state === "indeterminate") blockers.push("CI state indeterminate / not on head sha");
  if (!f.head_sha_matches) blockers.push("green CI is not on the current PR head sha");
  if (f.ci_state === "no-ci-coverage" && f.no_ci_policy === "needs-human") blockers.push("no CI coverage for this diff (FAFF-3)");
  if (f.level === "L4" && f.holdout !== "meets-spec") blockers.push(`L4 holdout: ${f.holdout} (need meets-spec)`);
  if (f.integrity === "violated") blockers.push("corrective-artifact integrity violated (FAFF-325): the FAFF_INTEGRITY_BOUNDARY attestation failed verification (forged/tampered) — refused at every level");
  if (f.integrity === "unasserted-refuse") blockers.push("corrective-artifact integrity unasserted at L4 (FAFF-325): no trusted attestation declaration — refused (defence-in-depth; the run-start preflight should already have caught this)");
  return { verdict: blockers.length === 0 ? "merge-ok" : "refuse", blockers };
}

// PURE: (ledgerLevel, flagLevel) -> { level, mismatch } (FAFF-424). The run-ledger's `level` field
// (minted by `faff lights-out`) is the run's authoritative autonomy level; a caller-asserted --level
// is droppable (prose-resolved fail-safe-off through graft) and must never silently downgrade it.
// When a ledger level is present it always governs; an explicit flag may only agree (fine) or
// disagree (mismatch, surfaced by the caller as a fail-loud exit 2 — never silently coerced). When
// no ledger level is present (absent/unreadable/out-of-enum ledger, both already normalised to null
// by the caller before this is invoked), today's flag/default behaviour is unchanged and mismatch is
// never signalled — there is nothing to contradict.
function resolveGateLevel(ledgerLevel, flagLevel) {
  if (ledgerLevel != null) {
    return { level: ledgerLevel, mismatch: flagLevel != null && flagLevel !== ledgerLevel };
  }
  return { level: flagLevel || "L3", mismatch: false };
}

function computeIntegrityFloor(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  const e = extraction;
  if (typeof e.ac_complete !== "boolean") return { contractData: null, failLoud: "ac_complete must be a boolean" };
  if (typeof e.head_sha_matches !== "boolean") return { contractData: null, failLoud: "head_sha_matches must be a boolean" };
  if (!FLOOR_REVIEW_VERDICTS.includes(e.review_verdict)) return { contractData: null, failLoud: `review_verdict ${JSON.stringify(e.review_verdict)} not in {${FLOOR_REVIEW_VERDICTS.join(",")}}` };
  if (!CI_STATES.includes(e.ci_state)) return { contractData: null, failLoud: `ci_state ${JSON.stringify(e.ci_state)} not in {${CI_STATES.join(",")}}` };
  if (!FLOOR_LEVELS.includes(e.level)) return { contractData: null, failLoud: `level ${JSON.stringify(e.level)} not in {${FLOOR_LEVELS.join(",")}}` };
  if (!FLOOR_HOLDOUTS.includes(e.holdout)) return { contractData: null, failLoud: `holdout ${JSON.stringify(e.holdout)} not in {${FLOOR_HOLDOUTS.join(",")}}` };
  const no_ci_policy = e.no_ci_policy === undefined ? "needs-human" : e.no_ci_policy;
  if (!NO_CI_POLICIES.includes(no_ci_policy)) return { contractData: null, failLoud: `no_ci_policy ${JSON.stringify(no_ci_policy)} not in {${NO_CI_POLICIES.join(",")}}` };
  // FAFF-690 (F2): the corrective-integrity leg is a live floor input, not dead code. Absent → a
  // LEVEL-AWARE fail-closed default (mirrors resolveIntegrity, merge-gate.js:326): L4 → unasserted-refuse
  // (blocks), below L4 → unasserted-ok (no-op) — the opposite polarity from a permissive default (which
  // was exactly finding F2). A present-but-out-of-enum value is a shell bug → fail-loud (exit 2), never
  // coerced. The value forwards into `f`, so decideFloor's `violated`/`unasserted-refuse` blockers reach.
  let integrity = e.integrity;
  if (integrity === undefined) integrity = e.level === "L4" ? "unasserted-refuse" : "unasserted-ok";
  else if (!FLOOR_INTEGRITY.includes(integrity)) return { contractData: null, failLoud: `integrity ${JSON.stringify(integrity)} not in {${FLOOR_INTEGRITY.join(",")}}` };
  const f = { ac_complete: e.ac_complete, review_verdict: e.review_verdict, ci_state: e.ci_state, head_sha_matches: e.head_sha_matches, level: e.level, holdout: e.holdout, no_ci_policy, integrity };
  const { verdict, blockers } = decideFloor(f);
  return { contractData: { verdict, ci_state: f.ci_state, level: f.level, conformant: verdict === "merge-ok", violations: blockers }, failLoud: null };
}

function contractIntegrityFloor(extraction) {
  const { contractData, failLoud } = computeIntegrityFloor(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "integrity-floor");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// Each contract: a `run` (extraction -> { contractData, failLoud }) + `--selftest` fixtures.
const CONTRACTS = {
  "integrity-floor": {
    run: contractIntegrityFloor,
    fixtures: [
      { name: "all-green-merge-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 0 },
      { name: "ac-incomplete", in: { ac_complete: false, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "review-missing", in: { ac_complete: true, review_verdict: "missing", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "review-fail", in: { ac_complete: true, review_verdict: "fail", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "review-unavailable-refuses", in: { ac_complete: true, review_verdict: "unavailable", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "ci-red", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-red", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "no-ci-coverage-refuses-by-default", in: { ac_complete: true, review_verdict: "pass", ci_state: "no-ci-coverage", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "no-ci-coverage-allow-opt-in", in: { ac_complete: true, review_verdict: "pass", ci_state: "no-ci-coverage", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "allow" }, wantExit: 0 },
      { name: "head-sha-mismatch", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: false, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "indeterminate-ci", in: { ac_complete: true, review_verdict: "pass", ci_state: "indeterminate", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      // FAFF-690 (F2): the 3 L4 fixtures carry explicit integrity:"asserted" so the L4 fail-closed
      // default (unasserted-refuse) does not flip them — isolating the holdout leg as the sole variable.
      { name: "l4-holdout-meets-spec", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", integrity: "asserted" }, wantExit: 0 },
      { name: "l4-holdout-missing", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "missing", integrity: "asserted" }, wantExit: 1 },
      { name: "l4-holdout-blocked", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "blocked", integrity: "asserted" }, wantExit: 1 },
      // FAFF-690 (F2): the integrity leg is live, not dead code — the born-verifiable floor decisions.
      { name: "l4-integrity-absent-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec" }, wantExit: 1 },
      { name: "integrity-violated-refuses-at-L3", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", integrity: "violated" }, wantExit: 1 },
      { name: "l4-integrity-unasserted-refuse", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", integrity: "unasserted-refuse" }, wantExit: 1 },
      { name: "l4-integrity-asserted-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", integrity: "asserted" }, wantExit: 0 },
      { name: "fail-loud-bad-integrity", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", integrity: "maybe" }, wantExit: 2 },
      { name: "fail-loud-bad-ci-state", in: { ac_complete: true, review_verdict: "pass", ci_state: "greenish", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-bad-level", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L9", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-non-boolean-ac", in: { ac_complete: "yes", review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "spec-readiness": {
    run: contractSpecReadiness,
    fixtures: [
      // FAFF-356: the optional `(decides: <owner>)` Punt suffix is prose-only display
      // metadata — it is NOT a contract field. A tagged punt and an untagged punt both
      // emit `{ marker: "punt" }`, so the `conformant` case below already covers both;
      // do NOT add a `decides`/`owner` field to this block or its schema.
      { name: "conformant", in: { confidence: "high", provenance_present: true, decisions: [{ marker: "chosen" }, { marker: "punt" }] }, wantExit: 0 },
      { name: "missing-marker", in: { confidence: "high", provenance_present: true, decisions: [{ marker: "none" }] }, wantExit: 1 },
      { name: "bad-confidence", in: { confidence: "maybe", provenance_present: true, decisions: [] }, wantExit: 2 },
      { name: "malformed", in: { decisions: [] }, wantExit: 2 },
    ],
  },
  "review-verdict": {
    run: contractReviewVerdict,
    fixtures: [
      { name: "conformant", in: { signal: "fail", findings: [{ location_present: true, action_present: true }] }, wantExit: 0 },
      { name: "escalated-needs-human", in: { signal: "needs-human", findings: [{ location_present: true, action_present: true }] }, wantExit: 0 },
      { name: "pass-no-findings", in: { signal: "pass", findings: [] }, wantExit: 0 },
      { name: "adversarial-outcome-passthrough", in: { signal: "pass", findings: [], adversarial_outcome: "chain-outage-skipped" }, wantExit: 0 },
      { name: "unavailable-bare-conformant", in: { signal: "unavailable", findings: [] }, wantExit: 0 },
      { name: "unavailable-with-well-formed-finding-conformant", in: { signal: "unavailable", findings: [{ location_present: true, action_present: true }] }, wantExit: 0 },
      { name: "unavailable-with-malformed-finding-still-flagged", in: { signal: "unavailable", findings: [{ location_present: false, action_present: false }] }, wantExit: 1 },
      { name: "needs-human-no-findings", in: { signal: "needs-human", findings: [] }, wantExit: 1 },
      { name: "coerce-malformed-signal", in: { signal: "maybe", findings: [{ location_present: true, action_present: true }] }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "delivery-outcome": {
    run: contractDeliveryOutcome,
    fixtures: [
      { name: "conformant-shipped", in: { outcome: "shipped", reason: "", corroborated: true }, wantExit: 0 },
      { name: "conformant-failed", in: { outcome: "failed", reason: "merge conflict on main", corroborated: false }, wantExit: 0 },
      { name: "uncorroborated-shipped-coerced", in: { outcome: "shipped", reason: "", corroborated: false }, wantExit: 1 },
      { name: "coerce-malformed-outcome", in: { outcome: "merged", reason: "", corroborated: true }, wantExit: 1 },
      { name: "not-ready-no-reason", in: { outcome: "not-ready", reason: "", corroborated: false }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "automation-routing": {
    run: contractAutomationRouting,
    fixtures: [
      { name: "conformant-no-root-cause", in: { verdict: "likely-fire", root_cause: null }, wantExit: 0 },
      { name: "conformant-with-root-cause", in: { verdict: "repeat-parked", root_cause: "punt-not-closed" }, wantExit: 0 },
      { name: "bad-root-cause-normalised", in: { verdict: "gap-blocked", root_cause: "mystery" }, wantExit: 1 },
      { name: "fail-loud-bad-verdict", in: { verdict: "bogus", root_cause: null }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "quality-gates": {
    run: contractQualityGates,
    fixtures: [
      { name: "conformant-pass", in: { signal: "pass", rungs: [{ kind: "LINT", status: "pass" }, { kind: "UNIT", status: "pass" }] }, wantExit: 0 },
      { name: "conformant-fail", in: { signal: "fail", rungs: [{ kind: "LINT", status: "fail" }] }, wantExit: 0 },
      { name: "pass-no-rungs", in: { signal: "pass", rungs: [] }, wantExit: 0 },
      { name: "fail-without-failing-rung", in: { signal: "fail", rungs: [{ kind: "LINT", status: "pass" }] }, wantExit: 1 },
      { name: "pass-with-failing-rung", in: { signal: "pass", rungs: [{ kind: "UNIT", status: "fail" }] }, wantExit: 1 },
      { name: "needs-human-no-rungs", in: { signal: "needs-human", rungs: [] }, wantExit: 1 },
      { name: "coerce-malformed-signal", in: { signal: "maybe", rungs: [{ kind: "LINT", status: "fail" }] }, wantExit: 1 },
      { name: "errored-rung-needs-human", in: { signal: "needs-human", rungs: [{ kind: "UNIT", status: "errored" }] }, wantExit: 0 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "post-merge-verification": {
    run: contractPostMergeVerification,
    fixtures: [
      { name: "conformant-ok", in: { verdict: "verified-ok", command: "npm run test", basis: "npm run test exit 0" }, wantExit: 0 },
      { name: "conformant-fail", in: { verdict: "verified-fail", command: "npm run test", basis: "npm run test failed: exit 1" }, wantExit: 0 },
      { name: "conformant-unverified-no-rung", in: { verdict: "unverified", command: null, basis: "no UNIT rung discovered" }, wantExit: 0 },
      { name: "conformant-unverified-errored", in: { verdict: "unverified", command: "npm run test", basis: "npm run test errored: spawn ENOENT" }, wantExit: 0 },
      { name: "ok-missing-command", in: { verdict: "verified-ok", command: null, basis: "npm run test exit 0" }, wantExit: 1 },
      { name: "fail-missing-command", in: { verdict: "verified-fail", command: "", basis: "failed" }, wantExit: 1 },
      { name: "missing-basis", in: { verdict: "unverified", command: null, basis: "" }, wantExit: 1 },
      { name: "coerce-malformed-verdict", in: { verdict: "maybe", command: "npm run test", basis: "?" }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "ci-triage": {
    run: contractCiTriage,
    fixtures: [
      { name: "transient-mine-proceeds-regardless-of-fault-domain", in: { pr: 1, head_sha: "a1", transience: "transient", fault_domain: "unknown", origin: "mine", action: "proceed-to-merge-gate", evidence: { reruns_used: 1, main_head_sha: "m1", main_ci_state: "ci-green", fault_domain_source: "none", flaky_signatures: ["build"] } }, wantExit: 0 },
      { name: "persistent-code-mine-fix-attempt", in: { pr: 2, head_sha: "a2", transience: "persistent", fault_domain: "code", origin: "mine", action: "fix-attempt", evidence: { reruns_used: 1, main_head_sha: "m2", main_ci_state: "ci-green", fault_domain_source: "llm", flaky_signatures: [] } }, wantExit: 0 },
      { name: "persistent-infra-park-errored", in: { pr: 3, head_sha: "a3", transience: "persistent", fault_domain: "infra", origin: "mine", action: "park-errored", evidence: { reruns_used: 1, main_head_sha: "m3", main_ci_state: "ci-green", fault_domain_source: "metadata", flaky_signatures: [] } }, wantExit: 0 },
      { name: "main-was-red-wins-even-over-transient", in: { pr: 4, head_sha: "a4", transience: "transient", fault_domain: "code", origin: "main-was-red", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: "m4", main_ci_state: "ci-red", fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 0 },
      { name: "all-unknown-fails-closed", in: { pr: 5, head_sha: "a5", transience: "unknown", fault_domain: "unknown", origin: "unknown", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: null, main_ci_state: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 0 },
      { name: "coerce-bad-transience", in: { pr: 6, head_sha: "a6", transience: "flaky-ish", fault_domain: "code", origin: "mine", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: null, main_ci_state: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 1 },
      { name: "coerce-bad-fault-domain", in: { pr: 7, head_sha: "a7", transience: "persistent", fault_domain: "vibes", origin: "mine", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: null, main_ci_state: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 1 },
      { name: "coerce-bad-origin", in: { pr: 8, head_sha: "a8", transience: "transient", fault_domain: "code", origin: "theirs", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: null, main_ci_state: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 1 },
      { name: "action-mismatch-flagged-but-derived-action-governs", in: { pr: 9, head_sha: "a9", transience: "persistent", fault_domain: "infra", origin: "mine", action: "proceed-to-merge-gate", evidence: { reruns_used: 1, main_head_sha: "m9", main_ci_state: "ci-green", fault_domain_source: "metadata", flaky_signatures: [] } }, wantExit: 1 },
      { name: "missing-head-sha", in: { pr: 10, head_sha: "", transience: "transient", fault_domain: "code", origin: "mine", action: "proceed-to-merge-gate", evidence: { reruns_used: 0, main_head_sha: null, main_ci_state: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "prd-readiness": {
    run: contractPrdReadiness,
    fixtures: [
      { name: "conformant-admissible", in: { verdict: "admissible", reason: "", stop_conditions_verifiable: true, creative_licence: "broad" }, wantExit: 0 },
      { name: "conformant-not-ready", in: { verdict: "not-ready", reason: "no-stop-conditions", stop_conditions_verifiable: false, creative_licence: "tight" }, wantExit: 0 },
      { name: "not-ready-no-reason", in: { verdict: "not-ready", reason: "", stop_conditions_verifiable: false, creative_licence: "tight" }, wantExit: 1 },
      { name: "out-of-set-reason-normalised", in: { verdict: "not-ready", reason: "vibes-are-off", stop_conditions_verifiable: false, creative_licence: "broad" }, wantExit: 1 },
      { name: "admissible-with-reason", in: { verdict: "admissible", reason: "no-stop-conditions", stop_conditions_verifiable: true, creative_licence: "broad" }, wantExit: 1 },
      { name: "admissible-but-unverifiable", in: { verdict: "admissible", reason: "", stop_conditions_verifiable: false, creative_licence: "tight" }, wantExit: 1 },
      { name: "fail-loud-bad-verdict", in: { verdict: "maybe", reason: "", stop_conditions_verifiable: true, creative_licence: "broad" }, wantExit: 2 },
      { name: "fail-loud-bad-licence", in: { verdict: "admissible", reason: "", stop_conditions_verifiable: true, creative_licence: "loose" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "prdr-admission": {
    run: contractPrdrAdmission,
    fixtures: [
      { name: "conformant-admit", in: { disposition: "admit", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, ratchet: { lineage_supersessions: 1, breached: false }, reasons: [] }, wantExit: 0 },
      { name: "conformant-propose-only", in: { disposition: "propose-only", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "human", by_level: "ok" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: ["needs ratification"] }, wantExit: 0 },
      { name: "conformant-reject-by-level", in: { disposition: "reject", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: ["by-level violation"] }, wantExit: 0 },
      { name: "admit-violates-constraint", in: { disposition: "admit", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 1 },
      { name: "admit-while-ratchet-breached", in: { disposition: "admit", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, ratchet: { lineage_supersessions: 5, breached: true }, reasons: [] }, wantExit: 1 },
      { name: "propose-only-invalid", in: { disposition: "propose-only", upper: { admit: false, reason: "yagni" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "human", by_level: "ok" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 1 },
      { name: "bad-lineage-normalised", in: { disposition: "reject", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, ratchet: { lineage_supersessions: "3", breached: false }, reasons: [] }, wantExit: 1 },
      { name: "fail-loud-bad-disposition", in: { disposition: "maybe", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 2 },
      { name: "fail-loud-bad-actor", in: { disposition: "reject", upper: { admit: true, reason: "" }, lower: { covered: true, uncovered_goals: [] }, authority: { actor: "robot", supersedes_provenance: "loop", by_level: "ok" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "adr-admission": {
    run: contractAdrAdmission,
    fixtures: [
      { name: "conformant-admit", in: { disposition: "admit", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 1, breached: false }, reasons: [] }, wantExit: 0 },
      { name: "conformant-propose-only", in: { disposition: "propose-only", authority: { actor: "loop", supersedes_provenance: "human", by_level: "ok" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: ["needs ratification"] }, wantExit: 0 },
      { name: "conformant-reject-by-level", in: { disposition: "reject", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: ["by-level violation"] }, wantExit: 0 },
      { name: "conformant-reject-challenge-absent", in: { disposition: "reject", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: false, outcome: "absent" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: ["missing skeptic"] }, wantExit: 0 },
      { name: "admit-violates-constraint", in: { disposition: "admit", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 1 },
      { name: "admit-while-ratchet-breached", in: { disposition: "admit", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 5, breached: true }, reasons: [] }, wantExit: 1 },
      { name: "admit-with-absent-challenge-invalid", in: { disposition: "admit", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: false, outcome: "absent" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 1 },
      { name: "propose-only-invalid", in: { disposition: "propose-only", authority: { actor: "loop", supersedes_provenance: "human", by_level: "ok" }, challenge: { ran: true, outcome: "overturned" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 1 },
      { name: "bad-lineage-normalised", in: { disposition: "reject", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "violation" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: "3", breached: false }, reasons: [] }, wantExit: 1 },
      { name: "fail-loud-bad-disposition", in: { disposition: "maybe", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 2 },
      { name: "fail-loud-bad-actor", in: { disposition: "reject", authority: { actor: "robot", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: true, outcome: "survived" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 2 },
      { name: "fail-loud-bad-challenge-outcome", in: { disposition: "reject", authority: { actor: "loop", supersedes_provenance: "loop", by_level: "ok" }, challenge: { ran: true, outcome: "maybe" }, ratchet: { lineage_supersessions: 0, breached: false }, reasons: [] }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "l4-topology-envelope": {
    run: contractL4TopologyEnvelope,
    fixtures: [
      // Scenario rows straight from the ADR-0071 decision table (container-create row per ADR-0072) /
      // FAFF-493 + FAFF-515 spec scenarios.
      { name: "conformant-epic-create-l4-admit", in: { op: { kind: "epic-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "L4 envelope", reversible: true } }, wantExit: 0 },
      { name: "conformant-container-create-l4-accepted-root-admit", in: { op: { kind: "container-create", level: "L4", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: true }, verdict: { disposition: "admit", reason: "prdr-lifecycle: contained under the run's admitted root PRD (ADR-0072)", reversible: true } }, wantExit: 0 },
      { name: "conformant-container-create-propose-only", in: { op: { kind: "container-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "propose-only", reason: "outside the accepted-root envelope — container-confirm holds", reversible: true } }, wantExit: 0 },
      { name: "conformant-container-create-l3-with-signal-propose-only", in: { op: { kind: "container-create", level: "L3", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: true }, verdict: { disposition: "propose-only", reason: "outside the accepted-root envelope — not L4", reversible: true } }, wantExit: 0 },
      // Floor-ordering proof: the human-curated floor pre-empts the container-create row — a true
      // signal never punches through it.
      { name: "conformant-container-create-human-curated-with-signal-propose-only", in: { op: { kind: "container-create", level: "L4", provenance: "human-curated", parent_confirmed: false, contained_under_accepted_prd: true }, verdict: { disposition: "propose-only", reason: "human-curated floor", reversible: true } }, wantExit: 0 },
      { name: "conformant-cancel-reject", in: { op: { kind: "cancel", level: "L1", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "reject", reason: "reversibility floor", reversible: false } }, wantExit: 0 },
      { name: "conformant-delete-reject", in: { op: { kind: "delete", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "reject", reason: "reversibility floor", reversible: false } }, wantExit: 0 },
      { name: "conformant-reparent-human-curated-propose-only", in: { op: { kind: "reparent", level: "L4", provenance: "human-curated", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "propose-only", reason: "human-curated floor", reversible: true } }, wantExit: 0 },
      { name: "conformant-reparent-faff-authored-admit", in: { op: { kind: "reparent", level: "L4", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "reversibility floor grants at full", reversible: true } }, wantExit: 0 },
      { name: "conformant-convert-faff-authored-admit", in: { op: { kind: "convert", level: "L4", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "reversibility floor grants at full", reversible: true } }, wantExit: 0 },
      { name: "conformant-rehome-faff-authored-admit", in: { op: { kind: "rehome", level: "L4", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "reversibility floor grants at full", reversible: true } }, wantExit: 0 },
      { name: "conformant-epic-create-not-l4-propose-only", in: { op: { kind: "epic-create", level: "L3", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "propose-only", reason: "outside the L4 envelope", reversible: true } }, wantExit: 0 },
      { name: "conformant-epic-create-l4-unconfirmed-propose-only", in: { op: { kind: "epic-create", level: "L4", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "propose-only", reason: "outside the L4 envelope", reversible: true } }, wantExit: 0 },
      // Non-conformant: a producer that mis-declares a verdict the table wouldn't derive — the load-bearing
      // "validator re-derives, never trusts" check. The spec's smoke test names this exact case (container-
      // create with a false accepted-root signal claiming admit).
      { name: "container-create-admit-mismatch", in: { op: { kind: "container-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "wrong", reversible: true } }, wantExit: 1 },
      { name: "epic-create-l4-confirmed-reject-mismatch", in: { op: { kind: "epic-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "reject", reason: "wrong", reversible: false } }, wantExit: 1 },
      { name: "reversible-mismatch", in: { op: { kind: "cancel", level: "L1", provenance: "faff-authored", parent_confirmed: false, contained_under_accepted_prd: false }, verdict: { disposition: "reject", reason: "wrong reversible", reversible: true } }, wantExit: 1 },
      { name: "fail-loud-bad-op-kind", in: { op: { kind: "rename", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-bad-op-level", in: { op: { kind: "epic-create", level: "L5", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-bad-provenance", in: { op: { kind: "epic-create", level: "L4", provenance: "ai-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "admit", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-bad-disposition", in: { op: { kind: "epic-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false }, verdict: { disposition: "maybe", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-missing-contained-under-accepted-prd", in: { op: { kind: "container-create", level: "L4", provenance: "faff-authored", parent_confirmed: true }, verdict: { disposition: "propose-only", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-missing-verdict", in: { op: { kind: "epic-create", level: "L4", provenance: "faff-authored", parent_confirmed: true, contained_under_accepted_prd: false } }, wantExit: 2 },
      { name: "fail-loud-missing-op", in: { verdict: { disposition: "admit", reason: "", reversible: true } }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "prdr-yagni": {
    run: contractPrdrYagni,
    fixtures: [
      { name: "conformant-admit", in: { admit: true, reason: "serves the booking goal, within scope", trace_to_goal: true, proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "serves the booking goal, within scope" }, challenge: { ran: true, overturns: false, reason: "" }, grounding_present: false }, wantExit: 0 },
      { name: "conformant-reject-no-trace", in: { admit: false, reason: "no PRD-goal trace", trace_to_goal: false, proposal: { serves_goal: false, within_scope: false, verdict: "reject", reason: "" }, challenge: { ran: false, overturns: false, reason: "" }, grounding_present: false }, wantExit: 0 },
      { name: "conformant-reject-overturned", in: { admit: false, reason: "conservative reject — overturned", trace_to_goal: true, proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "looks fine" }, challenge: { ran: true, overturns: true, reason: "gold-plating" }, grounding_present: true }, wantExit: 0 },
      { name: "admit-without-trace", in: { admit: true, reason: "x", trace_to_goal: false, proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "x" }, challenge: { ran: true, overturns: false, reason: "" }, grounding_present: false }, wantExit: 1 },
      { name: "admit-while-overturned", in: { admit: true, reason: "x", trace_to_goal: true, proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "x" }, challenge: { ran: true, overturns: true, reason: "exceeds scope" }, grounding_present: false }, wantExit: 1 },
      { name: "admit-without-challenge-run", in: { admit: true, reason: "x", trace_to_goal: true, proposal: { serves_goal: true, within_scope: true, verdict: "admit", reason: "x" }, challenge: { ran: false, overturns: false, reason: "" }, grounding_present: false }, wantExit: 1 },
      { name: "reject-no-reason", in: { admit: false, reason: "", trace_to_goal: true, proposal: { serves_goal: false, within_scope: false, verdict: "reject", reason: "" }, challenge: { ran: false, overturns: false, reason: "" }, grounding_present: false }, wantExit: 1 },
      { name: "fail-loud-bad-proposal-verdict", in: { admit: false, reason: "r", trace_to_goal: true, proposal: { serves_goal: true, within_scope: true, verdict: "maybe", reason: "" }, challenge: { ran: true, overturns: false, reason: "" }, grounding_present: false }, wantExit: 2 },
      { name: "fail-loud-missing-proposal", in: { admit: false, reason: "r", trace_to_goal: true, challenge: { ran: true, overturns: false, reason: "" }, grounding_present: false }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "prd-coverage": {
    run: contractPrdCoverage,
    fixtures: [
      { name: "conformant-satisfied", in: { covered: true, uncovered_goals: [], satisfied: true, reason: "", completion: { all_met: true, unmet_or_unverified: [] } }, wantExit: 0 },
      { name: "conformant-uncovered", in: { covered: false, uncovered_goals: ["ship the booking flow"], satisfied: false, reason: "uncovered goals", completion: { all_met: true, unmet_or_unverified: [] } }, wantExit: 0 },
      { name: "conformant-unverified-dod", in: { covered: true, uncovered_goals: [], satisfied: false, reason: "DoD unmet/unverified: 0002", completion: { all_met: false, unmet_or_unverified: ["0002"] } }, wantExit: 0 },
      { name: "covered-disagrees-with-uncovered", in: { covered: true, uncovered_goals: ["g"], satisfied: false, reason: "x", completion: { all_met: true, unmet_or_unverified: [] } }, wantExit: 1 },
      { name: "all-met-disagrees", in: { covered: true, uncovered_goals: [], satisfied: false, reason: "x", completion: { all_met: true, unmet_or_unverified: ["0001"] } }, wantExit: 1 },
      { name: "satisfied-while-uncovered", in: { covered: false, uncovered_goals: ["g"], satisfied: true, reason: "", completion: { all_met: true, unmet_or_unverified: [] } }, wantExit: 1 },
      { name: "satisfied-while-dod-unverified", in: { covered: true, uncovered_goals: [], satisfied: true, reason: "", completion: { all_met: false, unmet_or_unverified: ["0003"] } }, wantExit: 1 },
      { name: "not-satisfied-no-reason", in: { covered: true, uncovered_goals: [], satisfied: false, reason: "", completion: { all_met: true, unmet_or_unverified: [] } }, wantExit: 1 },
      { name: "fail-loud-missing-completion", in: { covered: true, uncovered_goals: [], satisfied: true, reason: "" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "prd-distance": {
    run: contractPrdDistance,
    fixtures: [
      { name: "conformant-ladder", in: { entries: [{ kind: "prdr", id: "0001", container: "portal", prd_goal: "g1", dod_verdict: "met", distance_class: "met", class_rank: 0 }, { kind: "prdr", id: "0002", container: "api", prd_goal: "g2", dod_verdict: null, distance_class: "unverified", class_rank: 1 }, { kind: "goal", id: null, container: null, prd_goal: "g3", dod_verdict: null, distance_class: "uncovered", class_rank: 3 }], prd_satisfied: false }, wantExit: 0 },
      { name: "conformant-empty", in: { entries: [], prd_satisfied: true }, wantExit: 0 },
      { name: "conformant-unmet", in: { entries: [{ kind: "prdr", id: "0003", container: "c", prd_goal: "g", dod_verdict: "partial", distance_class: "unmet", class_rank: 2 }], prd_satisfied: false }, wantExit: 0 },
      { name: "rank-disagrees-with-class", in: { entries: [{ kind: "prdr", id: "0001", container: "c", prd_goal: "g", dod_verdict: null, distance_class: "unverified", class_rank: 2 }], prd_satisfied: false }, wantExit: 1 },
      { name: "goal-not-uncovered", in: { entries: [{ kind: "goal", id: null, container: null, prd_goal: "g", dod_verdict: null, distance_class: "unmet", class_rank: 2 }], prd_satisfied: false }, wantExit: 1 },
      { name: "prdr-marked-uncovered", in: { entries: [{ kind: "prdr", id: "0001", container: "c", prd_goal: "g", dod_verdict: null, distance_class: "uncovered", class_rank: 3 }], prd_satisfied: false }, wantExit: 1 },
      { name: "fail-loud-bad-distance-class", in: { entries: [{ kind: "prdr", id: "0001", container: "c", prd_goal: "g", dod_verdict: null, distance_class: "vibes", class_rank: 1 }], prd_satisfied: false }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "spec-review-verdict": {
    run: contractSpecReviewVerdict,
    fixtures: [
      { name: "conformant-approve", in: { verdict: "approve", objections: [] }, wantExit: 0 },
      { name: "conformant-reject-approach", in: { verdict: "reject-approach", objections: [{ lens: "architectural", severity: "blocker" }] }, wantExit: 0 },
      { name: "conformant-revise", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor" }] }, wantExit: 0 },
      { name: "approve-with-objections", in: { verdict: "approve", objections: [{ lens: "infosec", severity: "major" }] }, wantExit: 1 },
      { name: "non-approve-no-objections", in: { verdict: "reject-approach", objections: [] }, wantExit: 1 },
      { name: "bad-lens", in: { verdict: "revise", objections: [{ lens: "vibes", severity: "major" }] }, wantExit: 1 },
      { name: "bad-severity", in: { verdict: "needs-human", objections: [{ lens: "methodology", severity: "huge" }] }, wantExit: 1 },
      { name: "fail-loud-bad-verdict", in: { verdict: "meh", objections: [] }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "architecture-proposal": {
    run: contractArchitectureProposal,
    fixtures: [
      { name: "conformant-build", in: { chosen_architecture: "modular monolith on Node", rationale: "fits the single Node runtime + existing CI", recommendation: "build", adr_candidates: [], assumptions: [] }, wantExit: 0 },
      { name: "conformant-buy", in: { chosen_architecture: "managed Postgres + thin API", rationale: "no DB ops capacity in profile", recommendation: "buy", adr_candidates: [{ title: "Use managed Postgres", decision: "adopt a managed DB", rationale: "no self-host ops capacity" }], assumptions: ["budget allows a managed tier"] }, wantExit: 0 },
      { name: "conformant-hybrid", in: { chosen_architecture: "self-host app, managed queue", rationale: "queue ops are the costly part", recommendation: "hybrid", adr_candidates: [], assumptions: ["no infra profile — proposed against brief only"] }, wantExit: 0 },
      { name: "empty-chosen-architecture", in: { chosen_architecture: "", rationale: "x", recommendation: "build" }, wantExit: 1 },
      { name: "empty-rationale", in: { chosen_architecture: "x", rationale: "", recommendation: "build" }, wantExit: 1 },
      { name: "bad-recommendation", in: { chosen_architecture: "x", rationale: "y", recommendation: "rent" }, wantExit: 1 },
      { name: "malformed-adr-candidate", in: { chosen_architecture: "x", rationale: "y", recommendation: "build", adr_candidates: [{ title: "t" }] }, wantExit: 1 },
      { name: "surfaced-input-violations", in: { chosen_architecture: "x", rationale: "y", recommendation: "build", violations: ["producer flagged a gap"] }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "env-handle": {
    run: contractEnvHandle,
    fixtures: [
      { name: "conformant-ready", in: { status: "ready", endpoint: "http://localhost:8080", health_checks: [{ name: "api", path: "/healthz", expected_status: 200 }], teardown_ref: "faff-env-abc", teardown_cmd: "docker-compose -p faff-env-abc down", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 0 },
      { name: "provisioning-not-ready", in: { status: "provisioning", health_checks: [], teardown_ref: "faff-env-abc", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 1 },
      { name: "failed-with-violations", in: { status: "failed", health_checks: [], teardown_ref: "none", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose", violations: ["docker/compose unavailable"] }, wantExit: 1 },
      { name: "ready-missing-endpoint", in: { status: "ready", endpoint: "", health_checks: [{ name: "api", path: "/healthz", expected_status: 200 }], teardown_ref: "faff-env-abc", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 1 },
      { name: "ready-empty-health-checks", in: { status: "ready", endpoint: "http://localhost:8080", health_checks: [], teardown_ref: "faff-env-abc", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 1 },
      { name: "bad-status-enum", in: { status: "booting", health_checks: [{ name: "api", path: "/healthz", expected_status: 200 }], teardown_ref: "faff-env-abc", provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 1 },
      { name: "missing-required-field", in: { status: "ready", endpoint: "http://localhost:8080", health_checks: [{ name: "api", path: "/healthz", expected_status: 200 }], provisioned_at: "2026-06-28T00:00:00Z", provisioner: "faffter-noon-env-compose" }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "holdout-verdict": {
    run: contractHoldoutVerdict,
    fixtures: [
      { name: "conformant-meets-spec", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, wantExit: 0 },
      { name: "conformant-gaps", in: { aggregate: "gaps", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }, { class: "assertion", verdict: "unmet", evidence_present: true }] }, wantExit: 0 },
      { name: "conformant-fails", in: { aggregate: "fails", code_blind: true, criteria: [{ class: "scenario", verdict: "unmet", evidence_present: true }] }, wantExit: 0 },
      { name: "conformant-needs-human-prose", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "prose", verdict: "needs-human", evidence_present: false }] }, wantExit: 0 },
      { name: "conformant-empty-needs-human", in: { aggregate: "needs-human", code_blind: true, criteria: [] }, wantExit: 0 },
      { name: "code-blind-false", in: { aggregate: "meets-spec", code_blind: false, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, wantExit: 1 },
      { name: "prose-judged", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "prose", verdict: "met", evidence_present: true }] }, wantExit: 1 },
      { name: "met-without-evidence", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: false }] }, wantExit: 1 },
      { name: "aggregate-mismatch", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "unmet", evidence_present: true }] }, wantExit: 1 },
      { name: "out-of-enum-aggregate-coerced", in: { aggregate: "perfect", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, wantExit: 1 },
      { name: "out-of-enum-class", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "behavioural", verdict: "met", evidence_present: true }] }, wantExit: 1 },
      // FAFF-384 spawner-attestation ratchet. `attFix` = a conformant spawner-attested meets-spec verdict.
      { name: "ratchet-off-legacy-self-attested-passes", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, wantExit: 0 },
      { name: "ratchet-on-self-attested-blocks", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }] }, opts: { requireSpawnerAttested: true }, wantExit: 1 },
      { name: "ratchet-on-spawner-attested-passes", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "pass" } }, opts: { requireSpawnerAttested: true }, wantExit: 0 },
      { name: "spawner-attested-missing-attestation", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: true }, opts: { requireSpawnerAttested: true }, wantExit: 1 },
      { name: "spawner-attested-repo-not-withheld", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: false, worktree_cwd: true, diff: true }, preflight: "pass" } }, opts: { requireSpawnerAttested: true }, wantExit: 1 },
      { name: "spawner-attested-preflight-not-pass", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: true, attestation: { spawner: "evaluate-call.mjs", withheld: { repo: true, worktree_cwd: true, diff: true }, preflight: "refused" } }, opts: { requireSpawnerAttested: true }, wantExit: 1 },
      { name: "refuse-to-attest-false-tolerated-flag-off", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: false }, wantExit: 0 },
      { name: "refuse-to-attest-false-blocks-flag-on", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: false }, opts: { requireSpawnerAttested: true }, wantExit: 1 },
      { name: "spawner-attested-non-boolean", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "scenario", verdict: "met", evidence_present: true }], spawner_attested: "yes" }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "lane-boundary": {
    run: contractLaneBoundary,
    fixtures: [
      { name: "conformant-evaluator-own", in: { version: 1, lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 0 },
      { name: "conformant-shared-present", in: { version: 2, lane: "evaluator", container: "shared", accesses: { repo: "present", host_socket: "present" }, integrity_signal: true }, wantExit: 0 },
      { name: "out-of-enum-lane", in: { version: 1, lane: "builder", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "out-of-enum-container", in: { version: 1, lane: "evaluator", container: "vm", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "out-of-enum-repo-access", in: { version: 1, lane: "evaluator", container: "own", accesses: { repo: "readable", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "version-below-one", in: { version: 0, lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "version-not-integer", in: { version: "1", lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "accesses-missing", in: { version: 1, lane: "evaluator", container: "own", integrity_signal: false }, wantExit: 1 },
      { name: "integrity-signal-not-bool", in: { version: 1, lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: "yes" }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "run-termination": {
    run: contractRunTermination,
    fixtures: [
      { name: "conformant-drained", in: { verdict: "run-complete", reason: "drained", signals: {}, policy_source: "structural-default" }, wantExit: 0 },
      { name: "conformant-escalate-floor", in: { verdict: "escalate", reason: "budget-escalated(tokens)", signals: {}, policy_source: "structural-default" }, wantExit: 0 },
      { name: "conformant-methodology-soften", in: { verdict: "continue", reason: "value-inflection", signals: {}, policy_source: "methodology" }, wantExit: 0 },
      { name: "floor-pinned-budget-escalated", in: { verdict: "run-complete", reason: "budget-escalated(tokens)", signals: {}, policy_source: "methodology" }, wantExit: 1 },
      { name: "floor-pinned-undispatched-ledger", in: { verdict: "run-complete", reason: "undispatched-ledger", signals: {}, policy_source: "methodology" }, wantExit: 1 },
      { name: "floor-pinned-product-incomplete", in: { verdict: "continue", reason: "product-incomplete", signals: {}, policy_source: "structural-default" }, wantExit: 1 },
      { name: "empty-reason", in: { verdict: "continue", reason: "", signals: {}, policy_source: "structural-default" }, wantExit: 1 },
      { name: "unknown-reason", in: { verdict: "continue", reason: "vibes-are-off", signals: {}, policy_source: "structural-default" }, wantExit: 1 },
      { name: "fail-loud-bad-verdict", in: { verdict: "maybe", reason: "drained", signals: {}, policy_source: "structural-default" }, wantExit: 2 },
      { name: "fail-loud-bad-policy-source", in: { verdict: "run-complete", reason: "drained", signals: {}, policy_source: "vibes" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "run-trigger": {
    run: contractRunTrigger,
    fixtures: [
      // One conformant row per §3b verdict x reason (the producer emits declared == re-derived).
      { name: "conformant-plan-coverage-thin", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: false }, verdict: "plan", reason: "coverage-thin" }, wantExit: 0 },
      { name: "conformant-drain-prd-covered", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: true }, verdict: "drain", reason: "prd-covered" }, wantExit: 0 },
      { name: "conformant-drain-no-prd", in: { signals: { target_resolved: true, outward: true, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "drain", reason: "no-prd-nothing-to-plan" }, wantExit: 0 },
      { name: "conformant-refuse-no-target", in: { signals: { target_resolved: false, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "no-target" }, wantExit: 0 },
      { name: "conformant-refuse-self-directed", in: { signals: { target_resolved: true, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "self-directed" }, wantExit: 0 },
      { name: "conformant-refuse-prd-ambiguous", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: true, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "prd-ambiguous" }, wantExit: 0 },
      { name: "conformant-refuse-prd-inadmissible", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "prd-inadmissible" }, wantExit: 0 },
      { name: "conformant-refuse-coverage-unmeasurable", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "coverage-unmeasurable" }, wantExit: 0 },
      // Ordering proof: the outward floor pre-empts the PRD checks (inward+no-PRD => self-directed, NOT drain).
      { name: "ordering-inward-no-prd-is-self-directed", in: { signals: { target_resolved: true, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "refuse", reason: "self-directed" }, wantExit: 0 },
      // Pattern-B: a hand-altered verdict on plan-shaped signals is rejected (the smoke test's exact case).
      { name: "reject-hand-altered-drain-on-plan-signals", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: false }, verdict: "drain", reason: "prd-covered" }, wantExit: 1 },
      { name: "reject-declared-verdict-mismatch", in: { signals: { target_resolved: true, outward: true, prd_present: true, prd_ambiguous: false, prd_admissible: true, coverage_measurable: true, coverage_covered: true }, verdict: "plan", reason: "coverage-thin" }, wantExit: 1 },
      // Fail-safe: an out-of-enum declared verdict is a VIOLATION (the derived governs), never a fail-loud —
      // the run-start refusal bias (distinct from run-termination's fail-loud on a bad verdict).
      { name: "out-of-enum-declared-verdict-is-violation-not-fail-loud", in: { signals: { target_resolved: false, outward: false, prd_present: false, prd_ambiguous: false, prd_admissible: false, coverage_measurable: false, coverage_covered: false }, verdict: "bogus", reason: "no-target" }, wantExit: 1 },
      // Fail-safe: missing/malformed signals derive refuse/no-target; a bare verdict-less extraction is conformant to the derivation.
      { name: "missing-signals-derives-refuse-no-target", in: { verdict: "refuse", reason: "no-target" }, wantExit: 0 },
      { name: "malformed-signals-object-is-violation", in: { signals: "nope", verdict: "refuse", reason: "no-target" }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
};

// ===========================================================================
// === FAFF-598: describe data — one ContractDescription per CONTRACTS entry ===
// `faff contract <name> --describe` renders these. Every `enum` field below is a
// BY-REFERENCE binding to the same validation constant `run` branches on (never a
// fresh literal copy) — that identity is what makes the described enum and the
// validated enum structurally impossible to drift apart (FAFF-582's failure class).
// Envelope shape is NOT duplicated here — the renderer loads it from the on-disk
// contracts/<name>.schema.json at render time (contract-engine's schemaCheck path).
// `lintable` defaults true (participates in validate-adapters' inline-enum-restatement
// check); the sole `lintable:false` group today is spec-readiness's marker dialect —
// producers legitimately restate the marker vocabulary they must write.
// ===========================================================================
const CONTRACT_DESCRIBES = {
  "integrity-floor": {
    purpose: "The merge floor's pure decision core — what `faff merge-gate` interlocks on to decide merge-ok vs refuse from AC/review/CI/level/holdout inputs.",
    values: [
      { field: "review_verdict", enum: FLOOR_REVIEW_VERDICTS, semantics: {
        pass: "review passed — no blocker from this leg",
        fail: "review found fixable issues — blocks merge",
        "needs-human": "review needs human judgement — blocks merge",
        unavailable: "review-chain outage, no verdict produced — blocks merge, never treated as pass",
        missing: "no review-verdict artifact found — blocks merge (fail-closed on absence)",
      } },
      { field: "ci_state", enum: CI_STATES, semantics: {
        "ci-green": "at least one applicable check ran and all passed",
        "ci-red": "at least one applicable check failed — blocks merge",
        "no-ci-coverage": "the applicable-checks set is empty — blocks merge unless no_ci_policy is allow",
        indeterminate: "CI state could not be established (e.g. not on the current head sha) — blocks merge",
      } },
      { field: "level", enum: FLOOR_LEVELS, semantics: {
        L1: "manual/interactive autonomy tier — no holdout gate",
        L2: "interactive-with-assist tier — no holdout gate",
        L3: "autonomous tier (beep-boop default) — no holdout gate",
        L4: "lights-out autonomous tier — the holdout leg is additionally asserted",
      } },
      { field: "holdout", enum: FLOOR_HOLDOUTS, semantics: {
        "meets-spec": "the L4 code-blind evaluator's aggregate verdict — passes the holdout leg",
        blocked: "the holdout evaluator returned fails/gaps/needs-human/non-blind — blocks merge at L4",
        missing: "no holdout verdict artifact found for an L4 run — blocks merge (fail-closed)",
        "not-applicable": "level is not L4 — the holdout leg is skipped, never a blocker",
      } },
      { field: "no_ci_policy", enum: NO_CI_POLICIES, semantics: {
        "needs-human": "default — a no-ci-coverage state blocks merge and requires a human's explicit override",
        allow: "explicit opt-in that lets a no-ci-coverage state pass the CI leg",
      } },
    ],
    coercions: [
      "an out-of-enum review_verdict, ci_state, level, holdout, or no_ci_policy → fail-loud (exit 2) — a shell bug producing an unrecognised state is never coerced into a decidable input",
      "any blocker present → refuse (exit 1); zero blockers → merge-ok (exit 0)",
    ],
    producer_notes: ["`faff merge-gate` gathers FloorInputs impurely (observed CI, on-disk artifacts) and calls this PURE decision core (decideFloor) — the core itself never observes CI or reads a file."],
  },
  "spec-readiness": {
    purpose: "The spec-stage marker-classification contract — whether every decision in a spec resolved to a canonical marker (chosen/punt/assumes) with a provenance stamp, for faff-prep's readiness gate.",
    values: [
      { field: "decisions[].marker", enum: Object.keys(MARKER_CLASS), lintable: false, semantics: {
        chosen: "a closed decision — the spec picked one option and stated it forward",
        punt: "an open decision — deliberately deferred to the build agent or a human",
        assumes: "an external assumption — a fact taken as given, not decided here",
      } },
    ],
    coercions: [
      "confidence missing or outside {high,medium,low} → fail-loud (exit 2) — no safe coerce target (FAFF-76 Decision 3)",
      "a decision with no canonical marker → not fail-loud; recorded as a well-formed verdict with markers_valid:false (exit 1)",
      "provenance_present:false → markers_valid:false (exit 1), not fail-loud",
    ],
    producer_notes: [],
  },
  "review-verdict": {
    purpose: "The fixed four-value verdict every code-review pass (the `review` slot) emits — what faff-graft's Step 9 and the merge floor branch on.",
    values: [
      { field: "signal", enum: ["pass", "fail", "needs-human", "unavailable"], semantics: {
        pass: "diff matches spec, ACs covered, no flagged items — proceed to merge",
        fail: "fixable issues found (failing tests, missing coverage, obvious bugs, scope creep) — iterate and re-review",
        "needs-human": "genuine human judgement required (product call, security/privacy concern, irreversible side effect, spec gap) — park, no auto-merge",
        unavailable: "no review verdict could be produced — a review-chain outage (provider down), not a verdict about the work; never treated as pass",
      } },
    ],
    coercions: ["an out-of-enum signal → coerced to needs-human (never pass) — a malformed verdict never reads as a green light", "a fail/needs-human signal with zero findings → conformant:false (exit 1)"],
    producer_notes: ["the producer never self-reports `unavailable` — that signal is the orchestrator's own outage detection (FAFF-405), not something a reviewer LLM emits about its own run"],
  },
  "delivery-outcome": {
    purpose: "The fixed three-value outcome the `ship` producer emits after attempting to merge/deploy — what faff-graft routes the caller-facing return on.",
    values: [
      { field: "outcome", enum: ["shipped", "not-ready", "failed"], semantics: {
        shipped: "merged (and deployed, if the producer is deploy-capable) — corroborated by the producer's own result",
        "not-ready": "the merge was deferred without merging — a deploy-readiness tier or a delivery precondition (push/token-scope/merge-method/actions-policy) blocked it; retry-later, not a defect",
        failed: "merge conflict, deploy error, or an unmappable result coerced to failed",
      } },
    ],
    coercions: [
      "an out-of-enum outcome → coerced to failed (never shipped)",
      "outcome:shipped with corroborated:false → coerced to failed — an uncorroborated shipped claim is never trusted at face value",
      "not-ready or failed with an empty reason → conformant:false (exit 1)",
    ],
    producer_notes: [],
  },
  "automation-routing": {
    purpose: "The closed six-value verdict the autonomous build-queue routing adaptor assigns to a not-yet-buildable issue — what faff-graft's resolve-attempt-before-park logic branches on.",
    values: [
      { field: "verdict", enum: ROUTING_VERDICTS, semantics: {
        "fire-and-forget": "ready to build with no human touch expected",
        "likely-fire": "ready to build, minor residual ambiguity a resolve-attempt can likely close",
        "needs-decision-first": "a spec punt or open decision blocks the build — resolve-attempt then park",
        "gap-blocked": "an external dependency is missing — resolve-attempt (precautionary vs load-bearing) then park",
        "circular-blocked": "a dependency cycle blocks the build — resolve-attempt (serialise defensive edges) then park",
        "repeat-parked": "this issue has parked before on the same class of ambiguity — no resolve-attempt, always park",
      } },
      { field: "root_cause", enum: ROOT_CAUSES, semantics: {
        "punt-not-closed": "a spec Punt marker was never resolved",
        gap: "a named external dependency is missing",
        cycle: "a dependency cycle involves this issue",
        "spec-ambiguous-external": "the ambiguity depends on information outside the spec",
        other: "a root cause outside the named set",
      } },
    ],
    coercions: ["an out-of-enum verdict → fail-loud (exit 2) — no safe coerce target, an assignment bug", "an out-of-enum root_cause → normalised to null (exit 1)"],
    producer_notes: ["the build-queue ADMISSION RULE (which verdicts actually enter the queue) is gateway semantics, NOT encoded in this script"],
  },
  "quality-gates": {
    purpose: "The engineering-quality gate-ladder verdict (`faff gates run`) faff-graft Step 7.5 branches on before spending a review pass or CI on code that doesn't format/lint/type-check.",
    values: [
      { field: "signal", enum: ["pass", "fail", "needs-human"], semantics: {
        pass: "every required rung passed (or no declared gates were found, under the explicit advisory opt-out)",
        fail: "a required rung failed (fail-fast stopped at it) — fix the cause and re-run",
        "needs-human": "a rung errored (tool missing/crashed), or no gates were discovered under the fail-closed default — park, no PR",
      } },
      { field: "rungs[].kind", enum: GATE_RUNG_KINDS, semantics: {
        FORMAT: "a formatting check", LINT: "a lint check", TYPECHECK: "a type-check", STATIC_ANALYSIS: "a static-analysis check", UNIT: "the unit/test-suite rung — also the AC-verification suite run", OTHER: "any declared rung outside the named kinds",
      } },
      { field: "rungs[].status", enum: GATE_RUNG_STATUSES, semantics: {
        pass: "the rung ran and passed", fail: "the rung ran and failed", skipped: "the rung was not applicable this run", errored: "the rung's tool crashed or was missing — can't conclude the code is bad",
      } },
    ],
    coercions: ["an out-of-enum signal → coerced to needs-human (never pass)", "a fail/needs-human signal with zero rungs → conformant:false", "a fail signal with no failing rung, or a pass signal with a failing rung → conformant:false (the signal must be backed by the rungs)"],
    producer_notes: [],
  },
  "post-merge-verification": {
    purpose: "The post-merge health check (`faff post-merge-check`) re-runs the repo's own UNIT rung against the merged sha — catches a regression the pre-merge gates missed.",
    values: [
      { field: "verdict", enum: POST_MERGE_VERIFICATION_VERDICTS, semantics: {
        "verified-ok": "the UNIT rung re-ran against the merged sha and passed",
        "verified-fail": "the UNIT rung re-ran against the merged sha and failed — a discovered-scope regression entry is recorded, status stays Done",
        unverified: "no UNIT rung was discoverable, or the check itself errored (worktree/spawn failure) — not a defect signal, just an unprovable verdict",
      } },
    ],
    coercions: ["an out-of-enum verdict → coerced to unverified (never verified-ok — no guessing ok)", "a verified-ok/verified-fail verdict with no command named → conformant:false (a verified verdict must name the rung it ran)", "any verdict with no basis text → conformant:false"],
    producer_notes: [],
  },
  "ci-triage": {
    purpose: "The three-axis CI-failure classifier (`faff ci-triage`) that decides whether a red PR check is worth a re-run, whose fault it is, and what to do next.",
    values: [
      // transience/fault_domain/origin/action are lintable:false: they are `faff ci-triage`'s own
      // three observation axes plus the action PURELY DERIVED from them (deriveTriageAction) —
      // the CLI's internal classification dialect a caller narrates while walking the procedure,
      // parallel to l4-topology-envelope's op-kind table, not a consumer-facing routing verdict.
      { field: "transience", enum: CI_TRIAGE_TRANSIENCE, lintable: false, semantics: { transient: "a clean same-sha re-run went green — proceed", persistent: "the failure repeated on re-run — inspect fault domain", unknown: "not yet determined (pre-re-run, or a budget-exhausted persistent-by-fiat call) — fails closed" } },
      { field: "fault_domain", enum: CI_TRIAGE_FAULT_DOMAIN, lintable: false, semantics: { infra: "a runner/tooling outage, not a code defect", code: "the failure traces to this PR's own diff", unknown: "metadata and the LLM tiebreaker were both inconclusive" } },
      { field: "origin", enum: CI_TRIAGE_ORIGIN, lintable: false, semantics: { mine: "the failing check is specific to this PR's diff", "main-was-red": "the same check is already red on main's head — never spend a fix attempt on it, never merge past it", unknown: "main's head state could not be read — fails closed" } },
      { field: "action", enum: CI_TRIAGE_ACTIONS, lintable: false, semantics: {
        "proceed-to-merge-gate": "the failure was transient — treat as resolved, proceed",
        "fix-attempt": "a persistent, code-domain, this-PR failure — one autonomous iteration attempt",
        "park-errored": "a persistent, infra-domain failure — not a code defect, park as errored",
        "park-needs-human": "origin is main-was-red/unknown, or transience/fault_domain is unresolved — fail-closed park",
      } },
      { field: "evidence.fault_domain_source", enum: CI_TRIAGE_FAULT_DOMAIN_SOURCES, semantics: { metadata: "fault domain was decided from check-run metadata alone", llm: "metadata was inconclusive; an LLM read the failure log as a tiebreaker", none: "no fault-domain determination was attempted" } },
    ],
    coercions: ["action is ALWAYS a pure function of transience/fault_domain/origin (deriveTriageAction) — a caller-supplied action that disagrees with the derived one is flagged as a violation, the derived action always governs (a forged/stale action can never widen past what the axes justify)", "an out-of-enum transience/fault_domain/origin → coerced to unknown"],
    producer_notes: [],
  },
  "prd-readiness": {
    purpose: "The product-axis analog of spec-readiness — whether an L4 run's target container's PRD is admissible (verifiable stop conditions) before the run starts.",
    values: [
      { field: "verdict", enum: PRD_READINESS_VERDICTS, semantics: { admissible: "the PRD's stop conditions are verifiable — admit the run", "not-ready": "the PRD lacks verifiable stop conditions — refuse and escalate before starting" } },
      { field: "reason", enum: PRD_READINESS_REASONS, semantics: { "no-stop-conditions": "the PRD declares no stop conditions at all", "ambiguous-stop-conditions": "stop conditions exist but are not verifiable as stated", other: "a reason outside the named set" } },
      { field: "creative_licence", enum: PRD_READINESS_LICENCES, semantics: { broad: "the PRD grants wide creative latitude to the build — calibrates the downstream YAGNI/PRDR reviewer more permissively", tight: "the PRD constrains the build narrowly — calibrates the downstream reviewer more strictly" } },
    ],
    coercions: ["an out-of-enum verdict or creative_licence → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this", "not-ready with an empty reason, or admissible with a non-empty reason, or admissible with stop_conditions_verifiable:false → conformant:false"],
    producer_notes: ["`creative_licence` is shape-checked but not itself gate-decisive — it is forward-carried context for a downstream reviewer, not a pass/fail input here"],
  },
  "prdr-admission": {
    purpose: "The PRDR (product-requirement-decision-record) admission verdict — the two-gate-bound decision that lets a proposed PRDR supersede an existing one, or blocks it.",
    values: [
      { field: "disposition", enum: PRDR_DISPOSITIONS, semantics: { admit: "both gates pass and the mover is not a loop superseding a human-authored PRDR — the supersession lands", "propose-only": "both gates pass but a loop is superseding a human-provenance PRDR — recorded, effective only on human ratification", reject: "at least one gate failed" } },
      { field: "authority.actor", enum: PRDR_ACTORS, semantics: { loop: "the autonomous run proposed this move", human: "a human proposed this move — always by_level:ok" } },
      { field: "authority.supersedes_provenance", enum: PRDR_SUPERSEDES, semantics: { human: "the PRDR being superseded was human-authored", loop: "the PRDR being superseded was loop-authored", none: "no prior PRDR is being superseded" } },
      { field: "authority.by_level", enum: PRDR_BY_LEVEL, semantics: { ok: "no recursive-authority violation", violation: "a loop is attempting to supersede the PRDR governing its own current increment — always blocks admit" } },
    ],
    coercions: ["an out-of-enum disposition or authority field → fail-loud (exit 2) — faff's own producer emits this, so an out-of-enum value is an assignment bug", "admit declared without satisfying the two-gate constraint (upper.admit ∧ by_level==ok ∧ ¬ratchet.breached ∧ lower.covered ∧ ¬(loop supersedes human)) → conformant:false", "propose-only declared when the sole bar is not a loop-supersedes-human move → conformant:false"],
    producer_notes: [],
  },
  "adr-admission": {
    purpose: "The ADR-axis sibling of prdr-admission — a two-gate admission verdict (authority + a drift-challenge, in place of PRDR's upper/lower value gates) that lets a loop supersede its own earlier ADRs while human/legacy ADRs stay guardrails.",
    values: [
      { field: "disposition", enum: PRDR_DISPOSITIONS, semantics: { admit: "the challenge survived, by_level is ok, the ratchet is unbreached, and the mover is not a loop superseding a human-provenance ADR", "propose-only": "gates pass but a loop is superseding a human-provenance ADR — recorded, effective only on human ratification", reject: "at least one gate failed" } },
      { field: "authority.actor", enum: PRDR_ACTORS, semantics: { loop: "the autonomous run proposed this move", human: "a human proposed this move — always by_level:ok" } },
      { field: "authority.supersedes_provenance", enum: PRDR_SUPERSEDES, semantics: { human: "the ADR being superseded was human-authored", loop: "the ADR being superseded was loop-authored", none: "no prior ADR is being superseded" } },
      { field: "authority.by_level", enum: PRDR_BY_LEVEL, semantics: { ok: "no recursive-authority violation", violation: "a loop is attempting to supersede the ADR governing its own current increment — always blocks admit" } },
      { field: "challenge.outcome", enum: ADR_CHALLENGE_OUTCOMES, semantics: { survived: "an adversarial (different-model) drift review examined the supersession argument and found it sound", overturned: "the adversarial review found the supersession argument unsound", absent: "no adversarial review ran, or it was unreachable after its fallback chain — a missing skeptic is a reject, never a pass" } },
    ],
    coercions: ["an out-of-enum disposition, authority field, or challenge.outcome → fail-loud (exit 2)", "admit declared without satisfying the two-gate constraint (challenge.outcome==survived ∧ by_level==ok ∧ ¬ratchet.breached ∧ ¬(loop supersedes human)) → conformant:false"],
    producer_notes: [],
  },
  "l4-topology-envelope": {
    purpose: "The L4 topology-write-authority envelope — re-derives the admit/propose-only/reject disposition for a structural op (create/reparent/cancel/…) from a fixed decision table and checks a claimed verdict conforms.",
    values: [
      { field: "op.kind", enum: L4_ENVELOPE_OP_KINDS, semantics: {
        "container-create": "creating a project/initiative-level container",
        "epic-create": "creating a first-slice epic",
        reparent: "moving an existing node to a new parent", convert: "converting a node's type", rehome: "moving a node to a different container",
        cancel: "cancelling a node — always reject, every level (reversibility floor)",
        delete: "deleting a node — always reject, every level (reversibility floor)",
      } },
      { field: "op.level", enum: L4_ENVELOPE_LEVELS, semantics: { L1: "manual tier", L2: "interactive-with-assist tier", L3: "autonomous tier", L4: "lights-out tier — the only level admit is reachable at for epic-create/container-create" } },
      { field: "op.provenance", enum: L4_ENVELOPE_PROVENANCE, semantics: { "faff-authored": "the structure faff itself created", "human-curated": "structure a human created or edited — always propose-only, never silently restructured" } },
      { field: "verdict.disposition", enum: PRDR_DISPOSITIONS, semantics: { admit: "the op is admitted outright", "propose-only": "the op is recorded for confirmation, not applied", reject: "the op is refused (cancel/delete, or an unrecognised op kind)" } },
    ],
    coercions: ["an out-of-enum op.kind/op.level/op.provenance/verdict.disposition → fail-loud (exit 2)", "a declared disposition or reversible flag that disagrees with the decision table's re-derivation for the given op → conformant:false — a producer never trusted at face value"],
    producer_notes: [],
  },
  "prdr-yagni": {
    purpose: "The UPPER (YAGNI/value) gate of PRDR admission — arbitrates whether a proposed PRDR is warranted (serves its PRD goal without exceeding it), conservative on any doubt.",
    values: [
      { field: "proposal.verdict", enum: PRDR_YAGNI_PROPOSAL_VERDICTS, semantics: { admit: "the methodology's Phase-1 proposal judged the PRDR warranted", reject: "the methodology's Phase-1 proposal judged the PRDR unwarranted or out of scope" } },
    ],
    coercions: ["an out-of-enum proposal.verdict → fail-loud (exit 2) — no safe coerce target", "admit declared without trace_to_goal ∧ proposal.verdict==admit ∧ challenge.ran ∧ ¬challenge.overturns → conformant:false", "reject with an empty reason → conformant:false"],
    producer_notes: ["`grounding_present` is shape-checked but ADVISORY — never gate-decisive; its absence never blocks judgment"],
  },
  "prd-coverage": {
    purpose: "The LOWER (coverage) gate of PRDR admission plus the prd-satisfied roll-up — whether every PRD goal is still covered by a live PRDR, and whether every live PRDR's DoD is actually met.",
    values: [],
    coercions: [
      "covered must agree with uncovered_goals being empty — a disagreement is conformant:false",
      "completion.all_met must agree with unmet_or_unverified being empty — a disagreement is conformant:false",
      "satisfied:true while covered:false, or while any DoD is unmet/unverified → conformant:false (no false done — unverified never reads as done)",
      "satisfied:false with an empty reason → conformant:false",
    ],
    producer_notes: ["a PRDR with no `met` DoD verdict (the evaluator hasn't run, or found gaps) is conservatively unverified, never treated as met — `prd-satisfied` stays false until the evaluator actually vouches for it"],
  },
  "prd-distance": {
    purpose: "The PRD-satisfaction-greedy drain-ordering signal — a four-class ladder of how many steps remain to a `met` DoD for every live PRDR and every PRD goal, as a pure input the methodology composes as a tiebreaker.",
    values: [
      { field: "entries[].distance_class", enum: DISTANCE_CLASSES, semantics: {
        met: "the PRDR's DoD is verified met — nearest to done (excluded from preference, kept for observability)",
        unverified: "a live PRDR with no DoD verdict yet — one evaluation from met",
        unmet: "a live PRDR with a DoD verdict present but not met — a known gap: fix and re-evaluate",
        uncovered: "a PRD goal with no live PRDR at all — the furthest class, the whole pipeline remains",
      } },
    ],
    coercions: [
      "an out-of-enum distance_class → fail-loud (exit 2)",
      "class_rank disagreeing with the fixed ladder for its distance_class (met 0 / unverified 1 / unmet 2 / uncovered 3) → conformant:false",
      "kind==\"goal\" must biconditionally match distance_class==\"uncovered\" — a mismatch is conformant:false",
    ],
    producer_notes: ["this is an ORDERING SIGNAL, not a judgement or a takeover of the ordering slot — the methodology composes it as a within-band tiebreaker; the orchestration layer holds no ordering opinion of its own"],
  },
  "spec-review-verdict": {
    purpose: "The fixed spec-stage review verdict every spec_review slot occupant emits — what faff-prep's readiness gate and the L1–L4 review lenses (architectural/infosec/methodology/QA) all map onto.",
    values: [
      { field: "verdict", enum: SPEC_REVIEW_VERDICTS, semantics: { approve: "the spec is ready to build as written — carries no objections", revise: "fixable objections exist — the spec needs changes before it's build-ready", "reject-approach": "the whole approach is unsound — a different design is needed, not a patch", "needs-human": "a human judgement call the reviewer can't resolve on its own" } },
      // lens/severity are lintable:false: the reviewer producer must WRITE these labels while
      // classifying its own findings (a checklist dialect, like spec-readiness's markers) — not a
      // routing verdict a consumer branches on. `verdict` above stays lintable (the closed 4-value
      // routing enum every consumer pipes through `faff contract spec-review-verdict`).
      { field: "objections[].lens", enum: SPEC_REVIEW_LENSES, lintable: false, semantics: { architectural: "a structural/design-fit objection", infosec: "a security or privacy objection", methodology: "a delivery-process or sequencing objection", QA: "a testability or verification-coverage objection" } },
      { field: "objections[].severity", enum: SPEC_REVIEW_SEVERITIES, lintable: false, semantics: { blocker: "must be resolved before the spec can be built", major: "should be resolved but isn't necessarily build-blocking on its own", minor: "a nice-to-fix, not build-blocking" } },
    ],
    coercions: ["an out-of-enum verdict → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this", "approve declared with any objections, or a non-approve verdict declared with zero objections → conformant:false", "an out-of-enum objection lens/severity → conformant:false (not fail-loud — an echoed bad value on a soft field)"],
    producer_notes: [],
  },
  "architecture-proposal": {
    purpose: "The best-fit, build-biased architecture proposal the `architecture` slot producer generates from an infra profile + brief — the generative counterpart to FAFF-9's architectural review lens, which only critiques a proposal already landed in a spec.",
    values: [
      { field: "recommendation", enum: ARCHITECTURE_RECOMMENDATIONS, semantics: { build: "recommends building the component in-house", buy: "recommends a managed/third-party service", hybrid: "recommends a mix — some components built, some bought" } },
    ],
    coercions: ["an empty chosen_architecture or rationale, an out-of-enum recommendation, or an adr_candidate missing title/decision/rationale → conformant:false (never fail-loud — the only fail-loud case is a non-object extraction)"],
    producer_notes: [],
  },
  "env-handle": {
    purpose: "The provisioned-environment handle the `env` slot producer emits — a running, health-checked stand-in for the system under build that the holdout evaluator points at and later tears down.",
    values: [
      { field: "status", enum: ENV_HANDLE_STATUSES, semantics: { ready: "the env is up, health-checked, and gate-passing — the only status that satisfies the holdout gate", provisioning: "still coming up — not yet gate-passing", failed: "provisioning failed — not gate-passing", terminated: "already torn down — not gate-passing" } },
    ],
    coercions: ["an out-of-enum status → conformant:false (never fail-loud — the only fail-loud case is a non-object extraction)", "status:ready with a missing endpoint, empty health_checks, or a missing teardown_ref/provisioned_at/provisioner → conformant:false", "any non-ready status → conformant:false — exit 0 requires status:ready AND zero violations"],
    producer_notes: [],
  },
  "holdout-verdict": {
    purpose: "The code-blind holdout verdict the `evaluator` slot producer emits after exercising a built feature against its spec's DoD in a provisioned env — the L4 per-issue merge gate re-reads this.",
    values: [
      { field: "aggregate", enum: HOLDOUT_AGGREGATES, semantics: { "meets-spec": "every judged criterion met — the only aggregate that passes the merge gate", gaps: "a mix of met and unmet criteria", fails: "every judged criterion unmet", "needs-human": "at least one criterion needs human judgement, or nothing was judged at all" } },
      // class/verdict are lintable:false: the evaluator producer must WRITE these labels while
      // classifying and judging each of its own criteria (the DoD-classification dialect it
      // produces via `faff dod classify`) — not a routing verdict a consumer branches on.
      // `aggregate` above stays lintable (the closed 4-value routing enum the merge floor reads).
      { field: "criteria[].class", enum: HOLDOUT_CLASSES, lintable: false, semantics: { scenario: "an end-to-end behavioural scenario from the spec's DoD", assertion: "a narrower, machine-checkable assertion", prose: "a criterion that can't be machine-judged — its verdict MUST be needs-human, never machine-decided" } },
      { field: "criteria[].verdict", enum: HOLDOUT_VERDICTS, lintable: false, semantics: { met: "the criterion was verified satisfied, with evidence", unmet: "the criterion was verified unsatisfied, with evidence", "needs-human": "the criterion could not be machine-judged (mandatory for class:prose)" } },
    ],
    coercions: [
      "an out-of-enum aggregate → coerced to needs-human (never meets-spec)",
      "code_blind ≠ true → conformant:false — a non-blind verdict is structurally inadmissible regardless of aggregate (exit 0 requires code_blind:true AND the aggregate matching the criteria's derivation)",
      "a class:prose criterion with verdict ≠ needs-human → conformant:false (prose is never machine-judged)",
      "a met/unmet criterion with evidence_present:false → conformant:false (no evidence, no verdict)",
      "the declared aggregate disagreeing with the derivation from criteria (deriveHoldoutAggregate) → conformant:false",
    ],
    producer_notes: [
      "FAFF-384 spawner attestation: when the run's lane-boundary cage promise requires it (`--require-spawner-attested`), a self-attested (non-spawner-derived) code_blind:true is refused at this contract's gate, not merely by prose instruction",
    ],
  },
  "lane-boundary": {
    purpose: "The versioned intent an orchestrator authors declaring what physical isolation boundary an evaluator lane needs — a DECLARATION of intent, never itself a trust source (the physical assert-in check is `faff evaluator-preflight`).",
    values: [
      { field: "lane", enum: LANE_BOUNDARY_LANES, semantics: { evaluator: "the code-blind holdout evaluator lane — the only lane this contract covers today" } },
      { field: "container", enum: LANE_BOUNDARY_CONTAINERS, semantics: { shared: "runs inside the same container as the builder", own: "runs in its own separate container" } },
      { field: "accesses.repo", enum: LANE_BOUNDARY_ACCESS, semantics: { absent: "the repo is provably withheld from this lane", present: "the repo is accessible to this lane" } },
      { field: "accesses.host_socket", enum: LANE_BOUNDARY_ACCESS, semantics: { absent: "the host socket is provably withheld from this lane", present: "the host socket is accessible to this lane" } },
    ],
    coercions: ["version < 1 or non-integer, an out-of-enum lane/container/accesses.*, a missing accesses object, or a non-boolean integrity_signal → conformant:false (never fail-loud — the only fail-loud case is a non-object extraction)"],
    producer_notes: ["this contract validates the DECLARATION's shape only — it never asserts the boundary is physically true; that assertion is `faff evaluator-preflight`'s job at the in-cage entry point"],
  },
  "run-termination": {
    purpose: "The L4 run-done verdict — whether an unattended run should stop (run-complete), keep going (continue), or hand off to a human (escalate) — with three safety-floor reasons that pin their verdict regardless of policy.",
    values: [
      { field: "verdict", enum: RUN_DONE_VERDICTS, semantics: { "run-complete": "the run is finished — nothing left to do or drained cleanly", continue: "the run should keep dispatching work", escalate: "the run should stop and hand off to a human" } },
      { field: "policy_source", enum: RUN_TERMINATION_POLICY_SOURCES, semantics: { "structural-default": "the verdict came from the built-in structural ladder, no methodology override", methodology: "a methodology slot softened or overrode the structural default for a non-floor reason" } },
    ],
    coercions: [
      "an out-of-enum verdict or policy_source → fail-loud (exit 2) — no safe coerce target",
      "an empty or unrecognised stop reason → conformant:false",
      "the reason `budget-escalated(...)` declared with a verdict other than escalate → conformant:false (a safety floor — no policy may complete through it)",
      "the reason `undispatched-ledger` declared with a verdict other than continue, or `product-incomplete` with a verdict other than escalate → conformant:false (the other two safety floors)",
    ],
    producer_notes: ["only the three floor reasons pin their verdict; every other stop reason may legitimately be softened by a methodology's policy"],
  },
  "run-trigger": {
    purpose: "The L4 run-start refusal-biased ladder — re-derives plan/drain/refuse from the run's admission signals (target resolved, outward-directed, PRD present/admissible/covered) and checks a claimed verdict conforms.",
    values: [
      { field: "verdict", enum: RUN_TRIGGER_VERDICTS, semantics: { plan: "coverage is thin — plan more work before draining", drain: "the PRD is covered (or absent, nothing to plan) — drain the build queue", refuse: "the run cannot proceed (no target, self-directed, or the PRD is ambiguous/inadmissible/unmeasurable)" } },
      { field: "reason", enum: RUN_TRIGGER_REASONS, semantics: {
        "coverage-thin": "the PRD is admissible but not yet covered — plan more work",
        "prd-covered": "the PRD's coverage gate is satisfied — drain the build queue",
        "no-prd-nothing-to-plan": "no PRD is present for the target — nothing to plan, drain",
        "no-target": "no target could be resolved at all — refuse",
        "self-directed": "the run's target is inward, not outward (ADR-0069) — refuse, checked before any PRD logic",
        "prd-ambiguous": "multiple Active/Frozen PRDs are in scope — refuse rather than guess which one governs",
        "prd-inadmissible": "the target PRD failed the prd-readiness admissibility check — refuse (fail-safe)",
        "coverage-unmeasurable": "the PRD's coverage could not be measured (malformed input) — refuse (fail-safe)",
      } },
    ],
    coercions: [
      "a non-object extraction → fail-loud (exit 2) — nothing to re-derive from",
      "a declared verdict or reason that disagrees with the re-derivation from signals → conformant:false — the derived pair always governs, never the caller's claim (a forged/hand-altered verdict can never widen past what the signals justify)",
      "an out-of-enum declared verdict → conformant:false, NOT fail-loud (the run-start refusal bias, distinct from run-termination's fail-loud on a bad verdict)",
      "malformed/missing signals → every signal normalises to false → the ladder derives refuse/no-target (fail-safe: the privileged plan/drain verdicts are structurally unreachable without every affirmative signal explicitly true)",
    ],
    producer_notes: [],
  },
};
for (const [name, describe] of Object.entries(CONTRACT_DESCRIBES)) {
  if (CONTRACTS[name]) CONTRACTS[name].describe = describe;
}

// FAFF-598: load the on-disk envelope schema for a contract's describe render. Reuses the SAME
// resolution schemaCheck uses (contracts/<name>.schema.json relative to the binary) — describe never
// forks a second loader. Read-only, never fail-loud: a missing/unparseable schema is documentation, not
// validation, so this returns null and the renderer emits an "envelope unavailable" line instead.
function loadEnvelopeSchema(name) {
  const schemaPath = path.resolve(HERE, "..", "contracts", `${name}.schema.json`);
  try { return { schema: JSON.parse(fs.readFileSync(schemaPath, "utf8")), reason: null }; }
  catch (e) { return { schema: null, reason: e.message }; }
}

// Render the `## Envelope` section body from a loaded JSON-Schema-subset object (validateAgainstSchema's
// dialect: type/required/properties/enum/additionalProperties/items). Shallow — one level of properties,
// which is what every shipped contract schema needs (contract data is flat-to-one-nested by convention).
function renderEnvelopeLines(schema) {
  const lines = [];
  const props = (schema && schema.properties && typeof schema.properties === "object") ? schema.properties : {};
  const required = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
  for (const [key, sub] of Object.entries(props)) {
    const type = sub && sub.type ? sub.type : (sub && sub.enum ? "enum" : "any");
    const req = required.has(key) ? "required" : "optional";
    const enumSuffix = sub && Array.isArray(sub.enum) ? ` — one of {${sub.enum.join(", ")}}` : "";
    lines.push(`- \`${key}\` (${type}, ${req})${enumSuffix}`);
  }
  return lines;
}

// FAFF-598: render a ContractDescription (+ on-disk envelope) as markdown. A section with nothing to
// say is omitted, per the spec's rendered-sections rule.
function renderContractDescribeMarkdown(name, entry) {
  const d = entry.describe;
  const lines = [`# faff contract ${name}`, "", d.purpose, ""];
  if (d.values && d.values.length) {
    lines.push("## Values");
    for (const g of d.values) {
      lines.push("", `### \`${g.field}\``, "", `Enum: ${g.enum.map((v) => `\`${v}\``).join(", ")}`, "", "| Value | Meaning |", "|---|---|");
      for (const v of g.enum) lines.push(`| \`${v}\` | ${g.semantics[v] || ""} |`);
    }
    lines.push("");
  }
  lines.push("## Coercion & fail direction", "", "Exit codes: `0` conformant · `1` violations · `2` fail-loud.");
  if (d.coercions && d.coercions.length) { lines.push(""); for (const c of d.coercions) lines.push(`- ${c}`); }
  lines.push("");
  lines.push("## Envelope");
  const { schema, reason } = loadEnvelopeSchema(name);
  if (schema) { lines.push("", ...renderEnvelopeLines(schema)); }
  else { lines.push("", `envelope unavailable: ${reason}`); }
  lines.push("");
  if (d.producer_notes && d.producer_notes.length) {
    lines.push("## Producer notes", "");
    for (const n of d.producer_notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

// FAFF-598: render the same data as JSON (ContractDescription + envelope), for tooling consumers.
function renderContractDescribeJson(name, entry) {
  const { schema, reason } = loadEnvelopeSchema(name);
  return {
    name,
    purpose: entry.describe.purpose,
    values: entry.describe.values || [],
    coercions: entry.describe.coercions || [],
    producer_notes: entry.describe.producer_notes || [],
    envelope: schema ? schema : { unavailable: reason },
  };
}

// FAFF-598: the selftest's describe-coverage checks (folded into contractSelftest, per-contract — see
// HOW → Selftest placement). Emits normal ok/FAIL rows so the existing CI steps and RESULT: summary pick
// them up unchanged; increments the caller's fail/total counters in place via the returned tallies.
function describeChecks(name, entry) {
  const rows = [];
  const d = entry.describe;
  const push = (ok, label) => rows.push({ ok, label });
  push(!!(d && typeof d.purpose === "string" && d.purpose.trim()), "describe/purpose-present");
  for (const g of (d && d.values) || []) {
    const enumOk = Array.isArray(g.enum) && g.enum.length > 0 && g.enum.every((v) => typeof v === "string");
    push(enumOk, `describe/${g.field}/enum-non-empty-strings`);
    const semKeys = new Set(Object.keys(g.semantics || {}));
    const enumSet = new Set(g.enum || []);
    const missing = [...enumSet].filter((v) => !semKeys.has(v));
    const extra = [...semKeys].filter((v) => !enumSet.has(v));
    push(missing.length === 0, `describe/${g.field}/semantics-covers-every-enum-value${missing.length ? ` (missing: ${missing.join(",")})` : ""}`);
    push(extra.length === 0, `describe/${g.field}/semantics-has-no-extra-keys${extra.length ? ` (extra: ${extra.join(",")})` : ""}`);
  }
  // Acceptance-sketch check: the rendered markdown enumerates every value of every described enum verbatim.
  let rendered = "";
  try { rendered = renderContractDescribeMarkdown(name, entry); } catch (e) { rendered = ""; }
  let allValuesPresent = rendered.length > 0;
  for (const g of (d && d.values) || []) {
    for (const v of g.enum || []) if (!rendered.includes(v)) allValuesPresent = false;
  }
  push(allValuesPresent, "describe/rendered-markdown-contains-every-enum-value-verbatim");
  // --json round-trips through JSON.parse.
  let jsonOk = false;
  try { JSON.parse(JSON.stringify(renderContractDescribeJson(name, entry))); jsonOk = true; } catch (e) { jsonOk = false; }
  push(jsonOk, "describe/json-round-trips");
  return rows;
}

function contractSelftest(name) {
  const names = name ? [name] : Object.keys(CONTRACTS);
  let fail = 0, total = 0;
  for (const n of names) {
    const c = CONTRACTS[n];
    if (!c) { process.stderr.write(`faff contract: unknown contract '${n}'\n`); return 2; }
    for (const f of c.fixtures) {
      total++;
      const exit = exitFor(f.opts ? c.run(f.in, f.opts) : c.run(f.in));
      const ok = exit === f.wantExit;
      if (!ok) fail++;
      console.log(`${ok ? "ok  " : "FAIL"} ${n}/${f.name} → exit ${exit} (want ${f.wantExit})`);
    }
    for (const row of describeChecks(n, c)) {
      total++;
      if (!row.ok) fail++;
      console.log(`${row.ok ? "ok  " : "FAIL"} ${n}/${row.label}`);
    }
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdContract(args) {
  const { values, positionals, errors } = parseArgs(args, CONTRACT_SPEC);
  if (errors.length) return usageError(errors, "usage: faff contract <name> [--in FILE] | [<name>] --selftest | [<name>] --describe [--json]   (extraction JSON on stdin)");
  const name = positionals[0];
  if (values["--selftest"]) return contractSelftest(name);
  // FAFF-598: --describe is a read-only rendering branch, checked BEFORE the --in/stdin validation path
  // and reaching NO fs.readFileSync(0) — it must never block on a tty stdin.
  if (values["--describe"]) {
    if (values["--in"] !== undefined) { process.stderr.write("faff contract: --describe takes no input (--in is invalid with --describe)\n"); return 2; }
    if (!name) {
      // Unnamed --describe = index: one "name — purpose" line per dispatcher-known contract (mirrors
      // the unnamed --selftest convention — runs/lists all).
      for (const n of Object.keys(CONTRACTS)) process.stdout.write(`${n} — ${CONTRACTS[n].describe.purpose}\n`);
      return 0;
    }
    const c = CONTRACTS[name];
    if (!c) { process.stderr.write(`faff contract: unknown contract '${name}' (known: ${Object.keys(CONTRACTS).join(", ")})\n`); return 2; }
    if (values["--json"]) { process.stdout.write(JSON.stringify(renderContractDescribeJson(name, c)) + "\n"); return 0; }
    process.stdout.write(renderContractDescribeMarkdown(name, c));
    return 0;
  }
  if (values["--json"]) { process.stderr.write("faff contract: --json requires --describe\n"); return 2; }
  if (!name) { process.stderr.write("usage: faff contract <name> [--in FILE] | [<name>] --selftest | [<name>] --describe [--json]   (extraction JSON on stdin)\n"); return 2; }
  const c = CONTRACTS[name];
  if (!c) { process.stderr.write(`faff contract: unknown contract '${name}' (known: ${Object.keys(CONTRACTS).join(", ")})\n`); return 2; }
  const inFile = values["--in"];
  let rawIn;
  try { rawIn = inFile !== undefined ? fs.readFileSync(inFile, "utf8") : fs.readFileSync(0, "utf8"); }
  catch (e) { process.stderr.write(`faff contract: cannot read input: ${e.message}\n`); return 2; }
  let extraction;
  try { extraction = JSON.parse(rawIn); }
  catch (e) { process.stderr.write(`faff contract ${name}: extraction is not valid JSON: ${e.message}\n`); return 2; }
  // FAFF-384: `--require-spawner-attested` arms the holdout-verdict spawner-attestation ratchet (caller-
  // resolved from the run's lane-boundary cage promise). Ignored by every other contract's run fn.
  const runOpts = name === "holdout-verdict" && values["--require-spawner-attested"] ? { requireSpawnerAttested: true } : undefined;
  const result = runOpts ? c.run(extraction, runOpts) : c.run(extraction);
  if (result.failLoud) { process.stderr.write(`faff contract ${name}: fail-loud: ${result.failLoud}\n`); return 2; }
  process.stdout.write(JSON.stringify(result.contractData) + "\n");
  return (result.contractData.violations || []).length === 0 ? 0 : 1;
}


module.exports = { ADR_CHALLENGE_OUTCOMES, ARCHITECTURE_RECOMMENDATIONS, CI_STATES, DISTANCE_CLASSES, DISTANCE_CLASS_RANK, CI_TRIAGE_ACTIONS, CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_FAULT_DOMAIN_SOURCES, CI_TRIAGE_ORIGIN, CI_TRIAGE_TRANSIENCE, CONTRACTS, CONTRACT_DESCRIBES, ENV_HANDLE_STATUSES, FLOOR_HOLDOUTS, FLOOR_INTEGRITY, FLOOR_LEVELS, FLOOR_REVIEW_VERDICTS, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, L4_ENVELOPE_LEVELS, L4_ENVELOPE_OP_KINDS, L4_ENVELOPE_PROVENANCE, LANE_BOUNDARY_ACCESS, LANE_BOUNDARY_CONTAINERS, LANE_BOUNDARY_LANES, MARKER_CLASS, NO_CI_POLICIES, POST_MERGE_VERIFICATION_VERDICTS, PRDR_ACTORS, PRDR_BY_LEVEL, PRDR_DISPOSITIONS, PRDR_SUPERSEDES, PRDR_YAGNI_PROPOSAL_VERDICTS, PRD_READINESS_LICENCES, PRD_READINESS_REASONS, PRD_READINESS_VERDICTS, ROOT_CAUSES, ROUTING_VERDICTS, RUN_TERMINATION_FLOOR_VERDICT, RUN_TERMINATION_KNOWN_PLAIN, RUN_TERMINATION_POLICY_SOURCES, RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS, adrGatesPass, cmdContract, computeAdrAdmission, computeAdrAdmissionVerdict, computeArchitectureProposal, computeAutomationRouting, computeCiTriage, computeDeliveryOutcome, computeEnvHandle, computeHoldoutVerdict, computeHoldoutVerdictsMap, computeIntegrityFloor, computeL4TopologyEnvelope, computeLaneBoundary, computePostMergeVerification, computePrdCoverage, computePrdCoverageVerdict, computePrdDistance, computePrdReadiness, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict, computeQualityGates, computeReviewVerdict, computeRunTermination, computeRunTrigger, computeSpecReadiness, computeSpecReviewVerdict, contractAdrAdmission, contractArchitectureProposal, contractAutomationRouting, contractCiTriage, contractDeliveryOutcome, contractEnvHandle, contractHoldoutVerdict, contractIntegrityFloor, contractL4TopologyEnvelope, contractLaneBoundary, contractPostMergeVerification, contractPrdCoverage, contractPrdDistance, contractPrdReadiness, contractPrdrAdmission, contractPrdrYagni, contractQualityGates, contractReviewVerdict, contractRunTermination, contractRunTrigger, contractSelftest, contractSpecReadiness, contractSpecReviewVerdict, decideFloor, deriveHoldoutAggregate, deriveTriageAction, holdoutGateResult, isKnownStopReason, l4TopologyDecision, prdrGatesPass, resolveGateLevel };
