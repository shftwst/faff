// ===========================================================================
// === region:factory — contract definitions + dispatch — FAFF-77: per-slot contract scripts (conformance by construction). ===
// `faff contract <name>` reads an extraction JSON (the adaptor's LLM-read of the
// producer's prose output) on stdin and emits the canonical, schema-valid contract
// data on stdout — or fails loud. Contract data flows ONLY from here (the wiring the
// spec adaptor is checked against). Schema = shape (the .json); gateway = semantics
// (this script encodes NO gate meanings — high/medium/low promotion lives upstream).
// ===========================================================================

// The marker → classification map (deterministic; FAFF-77 Decision B).

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");
const { exitFor, schemaCheck, validateAgainstSchema } = require("./contract-engine");
const { RUN_DONE_VERDICTS } = require("./run-done");

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
  const SIGNALS = ["pass", "fail", "needs-human"];
  const violations = [];
  let signal = extraction.signal;
  if (!SIGNALS.includes(signal)) {
    violations.push(`signal ${JSON.stringify(signal)} not in {pass,fail,needs-human} — coerced to needs-human`);
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

function computeHoldoutVerdict(extraction) {
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

  return { contractData: { aggregate, code_blind, criteria, violations }, failLoud: null };
}

function contractHoldoutVerdict(extraction) {
  const { contractData, failLoud } = computeHoldoutVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "holdout-verdict");
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
function computeHoldoutVerdictsMap(association, files) {
  const contributions = new Map();   // prdr-id -> [trusted value, ...] (insertion order = sorted-key order)
  const skipped = [];
  for (const { key, text, unreadable } of files) {
    if (!Object.prototype.hasOwnProperty.call(association, key)) { skipped.push({ key, reason: "no-association" }); continue; }
    const prdr = association[key];
    if (unreadable) { skipped.push({ key, reason: "unreadable" }); continue; }
    let block;
    try { block = JSON.parse(text); } catch { skipped.push({ key, reason: "unreadable" }); continue; }
    // The trust gate — the SAME compute fn `faff contract holdout-verdict` runs. A fail-loud (non-object),
    // any contract violation, or a non-true code_blind ⇒ untrusted ⇒ never "met".
    const { contractData, failLoud } = computeHoldoutVerdict(block);
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
function holdoutGateResult(block) {
  const { contractData, failLoud } = computeHoldoutVerdict(block);
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
  return { covered, uncovered_goals, satisfied, reason, completion, conformant: true, violations: [] };
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
const FLOOR_REVIEW_VERDICTS = ["pass", "fail", "needs-human", "missing"];
const FLOOR_LEVELS = ["L1", "L2", "L3", "L4"];
const FLOOR_HOLDOUTS = ["meets-spec", "blocked", "missing", "not-applicable"];
const NO_CI_POLICIES = ["needs-human", "allow"];

// PURE: FloorInputs -> { verdict, blockers }. Same inputs, same verdict — the whole point of the
// ticket. Every failing leg is reported (never just the first) so a refuse names all its causes.
function decideFloor(f) {
  const blockers = [];
  if (!f.ac_complete) blockers.push("ACs not all verified");
  if (f.review_verdict !== "pass") blockers.push(`review verdict is ${f.review_verdict} (need pass)`);
  if (f.ci_state === "ci-red") blockers.push("CI failing on head sha");
  if (f.ci_state === "indeterminate") blockers.push("CI state indeterminate / not on head sha");
  if (!f.head_sha_matches) blockers.push("green CI is not on the current PR head sha");
  if (f.ci_state === "no-ci-coverage" && f.no_ci_policy === "needs-human") blockers.push("no CI coverage for this diff (FAFF-3)");
  if (f.level === "L4" && f.holdout !== "meets-spec") blockers.push(`L4 holdout: ${f.holdout} (need meets-spec)`);
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
  const f = { ac_complete: e.ac_complete, review_verdict: e.review_verdict, ci_state: e.ci_state, head_sha_matches: e.head_sha_matches, level: e.level, holdout: e.holdout, no_ci_policy };
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
      { name: "ci-red", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-red", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "no-ci-coverage-refuses-by-default", in: { ac_complete: true, review_verdict: "pass", ci_state: "no-ci-coverage", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "no-ci-coverage-allow-opt-in", in: { ac_complete: true, review_verdict: "pass", ci_state: "no-ci-coverage", head_sha_matches: true, level: "L3", holdout: "not-applicable", no_ci_policy: "allow" }, wantExit: 0 },
      { name: "head-sha-mismatch", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: false, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "indeterminate-ci", in: { ac_complete: true, review_verdict: "pass", ci_state: "indeterminate", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 1 },
      { name: "l4-holdout-meets-spec", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec" }, wantExit: 0 },
      { name: "l4-holdout-missing", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "missing" }, wantExit: 1 },
      { name: "l4-holdout-blocked", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "blocked" }, wantExit: 1 },
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
};

function contractSelftest(name) {
  const names = name ? [name] : Object.keys(CONTRACTS);
  let fail = 0, total = 0;
  for (const n of names) {
    const c = CONTRACTS[n];
    if (!c) { process.stderr.write(`faff contract: unknown contract '${n}'\n`); return 2; }
    for (const f of c.fixtures) {
      total++;
      const exit = exitFor(c.run(f.in));
      const ok = exit === f.wantExit;
      if (!ok) fail++;
      console.log(`${ok ? "ok  " : "FAIL"} ${n}/${f.name} → exit ${exit} (want ${f.wantExit})`);
    }
  }
  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (${total} cases, ${fail} failed)`);
  return fail ? 1 : 0;
}

function cmdContract(args) {
  const name = args.find((a) => !a.startsWith("--"));
  if (args.includes("--selftest")) return contractSelftest(name);
  if (!name) { process.stderr.write("usage: faff contract <name> [--in FILE] | [<name>] --selftest   (extraction JSON on stdin)\n"); return 2; }
  const c = CONTRACTS[name];
  if (!c) { process.stderr.write(`faff contract: unknown contract '${name}' (known: ${Object.keys(CONTRACTS).join(", ")})\n`); return 2; }
  const inIdx = args.indexOf("--in");
  let rawIn;
  try { rawIn = inIdx !== -1 ? fs.readFileSync(args[inIdx + 1], "utf8") : fs.readFileSync(0, "utf8"); }
  catch (e) { process.stderr.write(`faff contract: cannot read input: ${e.message}\n`); return 2; }
  let extraction;
  try { extraction = JSON.parse(rawIn); }
  catch (e) { process.stderr.write(`faff contract ${name}: extraction is not valid JSON: ${e.message}\n`); return 2; }
  const result = c.run(extraction);
  if (result.failLoud) { process.stderr.write(`faff contract ${name}: fail-loud: ${result.failLoud}\n`); return 2; }
  process.stdout.write(JSON.stringify(result.contractData) + "\n");
  return (result.contractData.violations || []).length === 0 ? 0 : 1;
}


module.exports = { ARCHITECTURE_RECOMMENDATIONS, CI_STATES, CONTRACTS, ENV_HANDLE_STATUSES, FLOOR_HOLDOUTS, FLOOR_LEVELS, FLOOR_REVIEW_VERDICTS, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, MARKER_CLASS, NO_CI_POLICIES, PRDR_ACTORS, PRDR_BY_LEVEL, PRDR_DISPOSITIONS, PRDR_SUPERSEDES, PRDR_YAGNI_PROPOSAL_VERDICTS, PRD_READINESS_LICENCES, PRD_READINESS_REASONS, PRD_READINESS_VERDICTS, ROOT_CAUSES, ROUTING_VERDICTS, RUN_TERMINATION_FLOOR_VERDICT, RUN_TERMINATION_KNOWN_PLAIN, RUN_TERMINATION_POLICY_SOURCES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS, cmdContract, computeArchitectureProposal, computeAutomationRouting, computeDeliveryOutcome, computeEnvHandle, computeHoldoutVerdict, computeHoldoutVerdictsMap, computeIntegrityFloor, computePrdCoverage, computePrdCoverageVerdict, computePrdReadiness, computePrdrAdmission, computePrdrAdmissionVerdict, computePrdrYagni, computePrdrYagniVerdict, computeQualityGates, computeReviewVerdict, computeRunTermination, computeSpecReadiness, computeSpecReviewVerdict, contractArchitectureProposal, contractAutomationRouting, contractDeliveryOutcome, contractEnvHandle, contractHoldoutVerdict, contractIntegrityFloor, contractPrdCoverage, contractPrdReadiness, contractPrdrAdmission, contractPrdrYagni, contractQualityGates, contractReviewVerdict, contractRunTermination, contractSelftest, contractSpecReadiness, contractSpecReviewVerdict, decideFloor, deriveHoldoutAggregate, holdoutGateResult, isKnownStopReason, prdrGatesPass, resolveGateLevel };
