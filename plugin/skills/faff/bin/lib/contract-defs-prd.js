// ===========================================================================
// === region:factory — contract-defs-prd — contract definitions: prd readiness, prdr and adr admission, prdr yagni, prd coverage and prd distance ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { schemaCheck } = require("./contract-engine");


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
// FAFF-815 (Q7) — the closed-vocab reason a Phase-2 skeptic overturned; gates the under-citation admit.
const PRDR_YAGNI_CHALLENGE_GROUNDS = ["over-scope", "unserved", "other"];
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
  const over_scope = !!extraction.over_scope;                       // FAFF-815 — trusted (verdict does not carry D)
  const dedup = (arr) => [...new Set(arr)];
  const cited_goals = dedup(Array.isArray(extraction.cited_goals) ? extraction.cited_goals.filter((g) => typeof g === "string") : []);
  const dod_covers = dedup(Array.isArray(extraction.dod_covers) ? extraction.dod_covers.filter((g) => typeof g === "string") : []);
  const proposal = {
    serves_goal: !!p.serves_goal, within_scope: !!p.within_scope,
    verdict: p.verdict, reason: typeof p.reason === "string" ? p.reason : "",
  };
  // FAFF-815 (Q7) — the closed-vocab overturn ground, read straight off the verdict (absent/unknown ⇒ other).
  const ground = PRDR_YAGNI_CHALLENGE_GROUNDS.includes(c.ground) ? c.ground : "other";
  const challenge = {
    ran: !!c.ran, overturns: !!c.overturns,
    reason: typeof c.reason === "string" ? c.reason : "", ground,
  };
  const reason = typeof extraction.reason === "string" ? extraction.reason : "";
  const violations = [];
  // Re-derive under_cited locally from the echoed cited_goals/dod_covers (both present) and the trusted
  // over_scope — matching how this consumer already trusts the recorded trace_to_goal (Q6). On an
  // under-citation admit the producer widens cited_goals to C∪V (⊇ V), so the tell is "the citation now
  // covers every DoD goal and nothing over-scopes"; the overturns flag distinguishes it from a clean admit.
  const under_cited = !over_scope && dod_covers.length > 0 && dod_covers.every((v) => cited_goals.includes(v));
  const earned = trace_to_goal && proposal.verdict === "admit" && challenge.ran
    && !over_scope
    && (!challenge.overturns || (under_cited && challenge.ground === "over-scope"));
  if (admit && !earned) {
    violations.push("admit verdict violates the conservative arbitration constraint (requires trace_to_goal ∧ proposal.verdict==admit ∧ challenge.ran ∧ ¬over_scope ∧ (¬challenge.overturns ∨ (under-citation ∧ challenge.ground==over-scope)))");
  }
  if (!admit && reason === "") violations.push("reject carries no reason");
  return { contractData: { admit, reason, trace_to_goal, cited_goals, dod_covers, over_scope, proposal, challenge, grounding_present, conformant: violations.length === 0, violations }, failLoud: null };
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
  // FAFF-815 — the cited set is the UNION of every live PRDR's `prd_goals` (a citation is now plural);
  // a legacy record carrying only a single `prd_goal` string is treated as [prd_goal].
  const citedGoals = new Set();
  for (const p of live) {
    const arr = Array.isArray(p.prd_goals)
      ? p.prd_goals.filter((g) => typeof g === "string")
      : (typeof p.prd_goal === "string" && p.prd_goal ? [p.prd_goal] : []);
    for (const g of arr) citedGoals.add(g);
  }
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
  // FAFF-815 — three goal sets kept distinct: D declared, C cited, V DoD-covered. Dedup preserves
  // first-seen order (mirror computePrdCoverageVerdict's `[...new Set(...)]`).
  const dedup = (arr) => [...new Set(arr)];
  const subset = (a, b) => a.every((x) => b.includes(x));            // a ⊆ b
  const D = dedup(Array.isArray(input.prdGoals) ? input.prdGoals.filter((g) => typeof g === "string") : []);
  // C (cited): the array form (`--dod-covers`-style callers) or the legacy comma-tolerant `--prd-goal`
  // string, comma-split/trimmed/empties-dropped (a single value = a 1-element set; back-compat).
  const citedRaw = Array.isArray(input.citedGoals)
    ? input.citedGoals
    : (typeof input.prdGoal === "string" ? input.prdGoal.split(",") : []);
  const C = dedup(citedRaw.map((s) => (typeof s === "string" ? s.trim() : "")).filter((s) => s !== ""));
  // V (DoD-covered): [] when `--dod-covers` absent ⇒ over_scope=false ∧ under_cited=false, so an
  // overturn takes the conservative-reject branch — byte-identical to pre-FAFF-815 behaviour.
  const V = dedup(Array.isArray(input.dodCovers) ? input.dodCovers.filter((g) => typeof g === "string") : []);
  // The closed-vocab overturn ground (Q7); absent/unknown ⇒ "other" (fail-safe — never widens admit).
  const ground = PRDR_YAGNI_CHALLENGE_GROUNDS.includes(input.challengeGround) ? input.challengeGround : "other";

  const trace_to_goal = C.length > 0 && subset(C, D);               // C ≠ ∅ ∧ C ⊆ D
  const over_scope = V.some((v) => !D.includes(v));                 // V ⊄ D (deterministic gold-plating)
  const under_cited = subset(V, D) && subset(C, V) && V.some((v) => !C.includes(v)); // V ⊆ D ∧ C ⊊ V

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
  const challenge = { ran: challengeRan, overturns, reason: typeof input.challengeReason === "string" ? input.challengeReason : "", ground };

  let admit, reason, citedEcho = C;
  if (!trace_to_goal) {
    admit = false;
    reason = `no PRD-goal trace: PRDR cites ${JSON.stringify(C)} which are not all declared PRD goals`;
  } else if (!proposalSupplied) {
    admit = false;
    reason = "conservative reject (no gold-plating on doubt) — no methodology (Phase-1) proposal supplied; the upper gate cannot admit without one";
  } else if (proposalVerdict === "reject") {
    admit = false;
    reason = `conservative reject (no gold-plating on doubt) — methodology proposed reject: ${proposal.reason || "unwarranted or exceeds PRD scope"}`;
  } else if (!challengeRan) {
    admit = false;
    reason = "conservative reject (no gold-plating on doubt) — Phase-2 adversarial challenge did not conclude (skeptic unavailable); the YAGNI judge cannot self-grade";
  } else if (over_scope) {
    // AC#3 — deterministic gold-plating reject, fires even when the skeptic survived.
    admit = false;
    reason = `conservative reject (no gold-plating on doubt) — genuine over-scope: DoD covers ${JSON.stringify(V.filter((v) => !D.includes(v)))} beyond the PRD's declared goals`;
  } else if (overturns) {
    if (under_cited && ground === "over-scope") {
      // AC#1 — the skeptic claimed over-scope, but V⊆D proves the mismatch was under-citation.
      admit = true;
      citedEcho = dedup([...C, ...V]);   // advisory widened set C∪V (NOT written back — see OUT OF SCOPE)
      reason = `admit — the over-scope overturn was mis-attributed under-citation: DoD covers declared goals ${JSON.stringify(V.filter((v) => !C.includes(v)))} that were not cited; scope is within the PRD`;
    } else {
      // Any overturn on non-over-scope grounds (unserved/other/absent), or a fully-cited PRDR → respect the skeptic.
      admit = false;
      reason = `conservative reject (no gold-plating on doubt) — adversarial challenge overturned (${ground}): ${challenge.reason || "gold-plating / serves the goal but exceeds PRD scope"}`;
    }
  } else {
    admit = true;
    reason = proposal.reason || "methodology admits (serves the goal, within scope) and the adversarial challenge did not overturn it";
  }
  return { admit, reason, trace_to_goal, cited_goals: citedEcho, dod_covers: V, over_scope, proposal, challenge, grounding_present: !!input.groundingPresent, conformant: true, violations: [] };
}

module.exports = { PRD_READINESS_VERDICTS, PRD_READINESS_REASONS, PRD_READINESS_LICENCES, computePrdReadiness, contractPrdReadiness, PRDR_DISPOSITIONS, PRDR_ACTORS, PRDR_SUPERSEDES, PRDR_BY_LEVEL, prdrGatesPass, computePrdrAdmission, contractPrdrAdmission, computePrdrAdmissionVerdict, ADR_CHALLENGE_OUTCOMES, adrGatesPass, computeAdrAdmission, contractAdrAdmission, computeAdrAdmissionVerdict, PRDR_YAGNI_PROPOSAL_VERDICTS, PRDR_YAGNI_CHALLENGE_GROUNDS, computePrdrYagni, contractPrdrYagni, computePrdCoverage, contractPrdCoverage, computePrdCoverageVerdict, DISTANCE_CLASSES, DISTANCE_CLASS_RANK, computePrdDistance, contractPrdDistance, computePrdrYagniVerdict };
