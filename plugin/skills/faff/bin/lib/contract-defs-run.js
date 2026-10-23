// ===========================================================================
// === region:factory — contract-defs-run — contract definitions: the l4 topology envelope, run termination and run trigger ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { schemaCheck } = require("./contract-engine");
const { RUN_DONE_VERDICTS } = require("./run-done");
const { deriveRunTrigger, normalizeRunTriggerSignals } = require("./run-start");
const { PRDR_DISPOSITIONS } = require("./contract-defs-prd");


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

module.exports = { L4_ENVELOPE_OP_KINDS, L4_ENVELOPE_LEVELS, L4_ENVELOPE_PROVENANCE, l4TopologyDecision, computeL4TopologyEnvelope, contractL4TopologyEnvelope, RUN_TERMINATION_POLICY_SOURCES, RUN_TERMINATION_FLOOR_VERDICT, RUN_TERMINATION_KNOWN_PLAIN, isKnownStopReason, computeRunTermination, contractRunTermination, computeRunTrigger, contractRunTrigger };
