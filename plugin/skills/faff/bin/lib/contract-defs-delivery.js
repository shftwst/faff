// ===========================================================================
// === region:factory — contract-defs-delivery — contract definitions: delivery outcome, automation routing, quality gates, post-merge verification, ci-triage and the env handle ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { schemaCheck } = require("./contract-engine");


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
  // FAFF-1050: main_recent_window/main_recent_failures — the recent-history evidence behind the
  // history-aware `origin` read. Int|null and {String:Int}|null respectively; coerce anything else
  // (wrong shape, non-integer values) to null/filtered-out rather than fail-loud — this is
  // observational evidence, not a routing input, so a malformed caller value degrades quietly.
  const main_recent_window = Number.isInteger(ev.main_recent_window) ? ev.main_recent_window : null;
  let main_recent_failures = null;
  if (ev.main_recent_failures && typeof ev.main_recent_failures === "object" && !Array.isArray(ev.main_recent_failures)) {
    main_recent_failures = {};
    for (const [k, v] of Object.entries(ev.main_recent_failures)) if (Number.isInteger(v)) main_recent_failures[k] = v;
  }
  const evidence = {
    reruns_used: Number.isInteger(ev.reruns_used) ? ev.reruns_used : 0,
    main_head_sha: typeof ev.main_head_sha === "string" ? ev.main_head_sha : null,
    main_ci_state: typeof ev.main_ci_state === "string" ? ev.main_ci_state : null,
    main_recent_window,
    main_recent_failures,
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

module.exports = { computeDeliveryOutcome, contractDeliveryOutcome, ROUTING_VERDICTS, ROOT_CAUSES, computeAutomationRouting, contractAutomationRouting, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, computeQualityGates, contractQualityGates, POST_MERGE_VERIFICATION_VERDICTS, computePostMergeVerification, contractPostMergeVerification, CI_TRIAGE_TRANSIENCE, CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_ORIGIN, CI_TRIAGE_ACTIONS, CI_TRIAGE_FAULT_DOMAIN_SOURCES, deriveTriageAction, computeCiTriage, contractCiTriage, ENV_HANDLE_STATUSES, computeEnvHandle, contractEnvHandle };
