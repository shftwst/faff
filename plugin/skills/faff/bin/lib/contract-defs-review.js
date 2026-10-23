// ===========================================================================
// === region:factory — contract-defs-review — contract definitions: spec readiness, the review, spec-review, spec-judge and build-judge verdicts, and the architecture proposal ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");
const { schemaCheck, validateAgainstSchema } = require("./contract-engine");
const { REVIEW_DISPOSITIONS, REVIEW_FINDING_SOURCES, REVIEW_SEVERITIES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS } = require("./review-vocab");

// The marker → classification map (deterministic; FAFF-77 Decision B).

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
// FAFF-1146: each finding may carry the OPTIONAL enrichment fields severity/disposition/source
// (enum-checked via violations) plus refutation/model (free strings), covering both the standard
// code-review pass and the adversarial second-opinion pass in one shared findings array. Additive
// enrichment, never a re-gate — mirrors computeSpecReviewVerdict's FAFF-935/943 objection triple:
// the enum fields add a soft violation (exit 1) on an out-of-enum value rather than a schemaCheck
// fail-loud (exit 2), the {location_present, action_present} gating decision is byte-identical, and
// a legacy {location_present, action_present}-only finding validates unchanged. severity reuses the
// exact set faffter-dark-adversarial-review already emits (critical/major/minor/observation) so no
// well-formed adversarial finding — including the auto-refutation downgrade and the clean-review
// `observation` token — trips a spurious violation.
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
  const findings = raw.map((f, i) => {
    const obj = f && typeof f === "object" ? f : {};
    const out = { location_present: !!obj.location_present, action_present: !!obj.action_present };
    // FAFF-1146: enum-checked enrichment. A field is copied only when PRESENT: a valid value passes
    // through, an out-of-enum value is preserved in string form (or "" if non-string) AND pushes a
    // violation naming the finding index; an ABSENT field is omitted, never defaulted. A null field is
    // absent (FAFF-1277): the anchored evidence writer null-fills every documented key.
    for (const [field, enumVals] of [["severity", REVIEW_SEVERITIES], ["disposition", REVIEW_DISPOSITIONS], ["source", REVIEW_FINDING_SOURCES]]) {
      if (obj[field] !== undefined && obj[field] !== null) {
        if (typeof obj[field] === "string" && enumVals.includes(obj[field])) {
          out[field] = obj[field];
        } else {
          out[field] = typeof obj[field] === "string" ? obj[field] : "";
          violations.push(`finding[${i}] ${field} ${JSON.stringify(obj[field])} not in {${enumVals.join(",")}}`);
        }
      }
    }
    // FAFF-1146: free-string enrichment — copied only when present as a string, no enum, no violation.
    // disposition_rationale carries the reasoning/commentary behind the disposition (e.g. why a finding
    // was accepted-risk or refuted); same preserve-when-present treatment as refutation/model.
    if (typeof obj.refutation === "string") out.refutation = obj.refutation;
    if (typeof obj.disposition_rationale === "string") out.disposition_rationale = obj.disposition_rationale;
    if (typeof obj.model === "string") out.model = obj.model;
    // FAFF-1268: the collated evidence fields pass through typed; carried_id never does.
    for (const field of ["finding_id", "title", "location", "action"]) if (typeof obj[field] === "string") out[field] = obj[field];
    for (const field of ["first_round", "last_round"]) if (Number.isInteger(obj[field])) out[field] = obj[field];
    if (Array.isArray(obj.occurrences) && obj.occurrences.every((o) => o !== null && typeof o === "object" && !Array.isArray(o))) out.occurrences = obj.occurrences;
    return out;
  });
  if ((signal === "fail" || signal === "needs-human") && findings.length === 0) {
    violations.push(`${signal} carries no findings`);
  }
  findings.forEach((f, i) => {
    if (!f.location_present) violations.push(`finding[${i}] has no location`);
    if (!f.action_present) violations.push(`finding[${i}] has no action`);
  });
  const passed = {};
  for (const field of ["schema_version", "rounds_total"]) if (Number.isInteger(extraction[field])) passed[field] = extraction[field];
  if (["recorded", "terminal-only"].includes(extraction.round_history)) passed.round_history = extraction.round_history;
  if (extraction.adversarial_outcome === "chain-outage-skipped") passed.adversarial_outcome = extraction.adversarial_outcome;
  if (extraction.admitted_by === "build-judge") passed.admitted_by = extraction.admitted_by;
  return { contractData: { signal, findings, conformant: violations.length === 0, violations, ...passed }, failLoud: null };
}

function contractReviewVerdict(extraction) {
  const { contractData, failLoud } = computeReviewVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "review-verdict");
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
// FAFF-900: `unavailable` joins the enum — a mandatory spec-review outage whose outaged
// lens(es) could swing the verdict (symmetric with review-verdict's FAFF-405 `unavailable`).
// It is NOT a safe coerce target for an out-of-enum verdict (still fail-loud, below) — it is
// something the occupant's aggregation deliberately EMITS, never something an unknown string
// coerces to. computeSpecReviewVerdict treats it like every other non-approve verdict: the
// generic "non-approve carries objections" check below already applies to it unchanged, and it
// never coerces toward approve.
// FAFF-935: each objection may carry the OPTIONAL enrichment triple {claim, evidence,
// predicted_consequence} (the argued content a downstream judge reads) alongside {lens, severity}.
// The validator preserves each field only when present as a string and adds NO violation for it —
// additive enrichment, never a re-gate: the {lens, severity} gating decision is byte-identical and
// a legacy {lens, severity}-only objection validates unchanged.
function computeSpecReviewVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!SPEC_REVIEW_VERDICTS.includes(extraction.verdict)) {
    return { contractData: null, failLoud: `verdict ${JSON.stringify(extraction.verdict)} not in {approve,revise,reject-approach,needs-human,unavailable} — no safe coerce target` };
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
    // FAFF-935: the enriched objection triple {claim, evidence, predicted_consequence} rides
    // alongside {lens, severity} as OPTIONAL, additive fields. FAFF-943 adds `spec_anchor` (the
    // heading slug of the attacked spec section — canonical derivation: bin/lib/heading-slug.js)
    // as one more optional string beside the triple. Preserve each only when it is present as a
    // string (so it survives verbatim through the round record into the shape
    // `faff spec-judge-evidence` reads); omit an absent or non-string field. This is additive
    // enrichment, never a re-gate — the fields add NO violation and change NO verdict, so the
    // {lens, severity} gating path (majority, arithmetic floors) is a byte-identical decision and
    // a legacy {lens, severity}-only objection still validates exactly as before.
    const out = { lens: typeof lens === "string" ? lens : "", severity: typeof severity === "string" ? severity : "" };
    if (o && typeof o === "object") {
      for (const field of ["claim", "evidence", "predicted_consequence", "spec_anchor"]) {
        if (typeof o[field] === "string") out[field] = o[field];
      }
      // FAFF-1157: the objection carries how it was ultimately resolved, mirroring FAFF-1146's
      // review-verdict finding triple exactly — enum-checked `disposition` (out-of-enum → soft
      // violation naming the objection index, preserved verbatim; absent → omitted), plus the free
      // strings `refutation` / `disposition_rationale` (preserve-when-present, no enum, no violation).
      // Additive, never a re-gate: the {lens, severity} gating decision is byte-identical.
      if (o.disposition !== undefined && o.disposition !== null) {
        if (typeof o.disposition === "string" && REVIEW_DISPOSITIONS.includes(o.disposition)) {
          out.disposition = o.disposition;
        } else {
          out.disposition = typeof o.disposition === "string" ? o.disposition : "";
          violations.push(`objection[${i}] disposition ${JSON.stringify(o.disposition)} not in {${REVIEW_DISPOSITIONS.join(",")}}`);
        }
      }
      if (typeof o.refutation === "string") out.refutation = o.refutation;
      if (typeof o.disposition_rationale === "string") out.disposition_rationale = o.disposition_rationale;
      // FAFF-1267: the collated-evidence fields ride through unchanged. A null is absent; any other
      // value is kept as written so a mistyped one fails the contract schema instead of vanishing.
      for (const field of ["first_round", "last_round", "occurrences"]) {
        if (o[field] !== undefined && o[field] !== null) out[field] = o[field];
      }
    }
    return out;
  });
  if (verdict === "approve" && objections.length > 0) violations.push("approve carries objections — approve must carry none");
  if (verdict !== "approve" && objections.length === 0) violations.push(`${verdict} carries no objections`);
  // FAFF-951: gate `approve` on a recorded review round. round_recorded is a consumer-supplied
  // (faff-prep) input-only signal — true when at least one round-<n>.json exists in the resolved
  // spec-review scratch dir at pipe time — mirroring provenance_present (line 46): read here,
  // never emitted into contractData, so an absent field stays backward-compatible (no violation)
  // and only an explicit false trips the rule. This stops a mid-review bail from leaving an
  // unearned approve with no round record on disk.
  if (verdict === "approve" && extraction.round_recorded === false) violations.push("approve with no recorded review round");
  const contractData = { verdict, objections, conformant: violations.length === 0, violations };
  for (const field of ["rounds_total", "final_verdict", "schema_version"]) {
    if (extraction[field] !== undefined && extraction[field] !== null) contractData[field] = extraction[field];
  }
  return { contractData, failLoud: null };
}

function contractSpecReviewVerdict(extraction) {
  const { contractData, failLoud } = computeSpecReviewVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "spec-review-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- spec-judge-verdict (FAFF-930, reshaped from FAFF-922) ---
// The spec-review judge's per-proposition ruling in the closed four-outcome vocabulary, emitted
// at the would-be-park point for ONE atomic disputed proposition (FAFF-930 replaced FAFF-922's
// review-level {verdict, downweighted[], upheld[]}). Fail-loud (exit 2) on an outcome outside the
// closed four (faff's own producer emits it — no safe coerce target), mirroring spec-review-verdict.
// Founded-outcome invariants (violations → conformant:false, exit 1):
//   AFFIRM_SPEC   — no correction, empty synthesis_sources, empty prd_gap_citation.
//   UPHOLD_REVIEW — non-empty rationale + a correction {summary, verification>=24 chars};
//                   empty synthesis_sources + prd_gap_citation.
//   SYNTHESIZE    — non-empty rationale + correction {summary, verification>=24} + synthesis_sources
//                   non-empty and a subset of {"A","B"} (the reference-integrity check); empty
//                   prd_gap_citation.
//   PRD_BOUNDARY  — non-empty rationale + non-empty prd_gap_citation; no correction, empty sources.
// An echoed out-of-enum lens/severity (optional audit passthrough) is conformant:false, never a
// spurious fail-loud (the spec-review-verdict precedent). Absence-of-verification-literal-in-the-
// pre-correction-spec is NOT checked here (the contract sees only the ruling) — the admit roll-up
// checks it against the retained pre_ruling_spec_content.
const SPEC_JUDGE_OUTCOMES = ["AFFIRM_SPEC", "UPHOLD_REVIEW", "SYNTHESIZE", "PRD_BOUNDARY"];
const SPEC_JUDGE_VERIFICATION_MIN = 24;
function computeSpecJudgeVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!SPEC_JUDGE_OUTCOMES.includes(extraction.outcome)) {
    return { contractData: null, failLoud: `outcome ${JSON.stringify(extraction.outcome)} not in {AFFIRM_SPEC,UPHOLD_REVIEW,SYNTHESIZE,PRD_BOUNDARY} — no safe coerce target` };
  }
  const outcome = extraction.outcome;
  const violations = [];
  const proposition_id = typeof extraction.proposition_id === "string" ? extraction.proposition_id : "";
  if (!proposition_id.trim()) violations.push("proposition_id is empty");
  const rationale = typeof extraction.rationale === "string" ? extraction.rationale : "";

  // correction: object {summary, verification} or null. A non-object/non-null is a violation.
  let correction = null;
  const rawCorr = extraction.correction;
  if (rawCorr !== null && rawCorr !== undefined) {
    if (typeof rawCorr !== "object" || Array.isArray(rawCorr)) {
      violations.push("correction must be an object or null");
    } else {
      correction = {
        summary: typeof rawCorr.summary === "string" ? rawCorr.summary : "",
        verification: typeof rawCorr.verification === "string" ? rawCorr.verification : "",
      };
    }
  }
  const hasCorrection = correction !== null;
  const checkCorrectionShape = () => {
    if (!hasCorrection) { violations.push(`${outcome} carries no correction — a bounded correction with a verification literal is required`); return; }
    if (!correction.summary.trim()) violations.push(`${outcome} correction has an empty summary`);
    if (correction.verification.length < SPEC_JUDGE_VERIFICATION_MIN) {
      violations.push(`${outcome} correction.verification is shorter than ${SPEC_JUDGE_VERIFICATION_MIN} chars — the trivial-edit bypass is a violation`);
    }
  };

  // synthesis_sources: array of strings (subset of {"A","B"} for SYNTHESIZE).
  let synthesis_sources = [];
  if (extraction.synthesis_sources !== undefined) {
    if (!Array.isArray(extraction.synthesis_sources)) violations.push("synthesis_sources is not an array — treated as empty");
    else synthesis_sources = extraction.synthesis_sources.map((s) => (typeof s === "string" ? s : String(s)));
  }
  const prd_gap_citation = typeof extraction.prd_gap_citation === "string" ? extraction.prd_gap_citation : "";

  // Optional echoed lens/severity (audit passthrough) — enum enforced via violations only when present.
  let lens = "";
  if (extraction.lens !== undefined) {
    lens = typeof extraction.lens === "string" ? extraction.lens : "";
    if (!SPEC_REVIEW_LENSES.includes(extraction.lens)) violations.push(`lens ${JSON.stringify(extraction.lens)} not in {architectural,infosec,methodology,QA}`);
  }
  let severity = "";
  if (extraction.severity !== undefined) {
    severity = typeof extraction.severity === "string" ? extraction.severity : "";
    if (!SPEC_REVIEW_SEVERITIES.includes(extraction.severity)) violations.push(`severity ${JSON.stringify(extraction.severity)} not in {blocker,major,minor}`);
  }

  if (outcome === "AFFIRM_SPEC") {
    if (hasCorrection) violations.push("AFFIRM_SPEC carries a correction — an affirm requires none");
    if (synthesis_sources.length) violations.push("AFFIRM_SPEC carries synthesis_sources — must be empty");
    if (prd_gap_citation.trim()) violations.push("AFFIRM_SPEC carries a prd_gap_citation — must be empty");
  } else if (outcome === "UPHOLD_REVIEW") {
    if (!rationale.trim()) violations.push("UPHOLD_REVIEW carries no rationale — a non-affirm ruling must state what it upheld and why");
    checkCorrectionShape();
    if (synthesis_sources.length) violations.push("UPHOLD_REVIEW carries synthesis_sources — must be empty (SYNTHESIZE is the composing outcome)");
    if (prd_gap_citation.trim()) violations.push("UPHOLD_REVIEW carries a prd_gap_citation — must be empty");
  } else if (outcome === "SYNTHESIZE") {
    if (!rationale.trim()) violations.push("SYNTHESIZE carries no rationale");
    checkCorrectionShape();
    if (synthesis_sources.length === 0) violations.push("SYNTHESIZE carries no synthesis_sources — must cite the source claims (a non-empty subset of {A,B})");
    for (const s of synthesis_sources) {
      if (s !== "A" && s !== "B") violations.push(`SYNTHESIZE synthesis_sources cites ${JSON.stringify(s)} outside {A,B} — the reference-integrity check`);
    }
    if (prd_gap_citation.trim()) violations.push("SYNTHESIZE carries a prd_gap_citation — must be empty");
  } else if (outcome === "PRD_BOUNDARY") {
    if (!rationale.trim()) violations.push("PRD_BOUNDARY carries no rationale");
    if (!prd_gap_citation.trim()) violations.push("PRD_BOUNDARY carries no prd_gap_citation — the specific PRD gap must be cited");
    if (hasCorrection) violations.push("PRD_BOUNDARY carries a correction — must be null (resolution needs a product/policy decision)");
    if (synthesis_sources.length) violations.push("PRD_BOUNDARY carries synthesis_sources — must be empty");
  }

  return {
    contractData: { proposition_id, outcome, rationale, correction, synthesis_sources, prd_gap_citation, lens, severity, conformant: violations.length === 0, violations },
    failLoud: null,
  };
}

function contractSpecJudgeVerdict(extraction) {
  const { contractData, failLoud } = computeSpecJudgeVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "spec-judge-verdict");
  if (schemaErr) return { failLoud: schemaErr };
  return { contractData };
}

// --- build-judge-verdict (FAFF-996) ---
// The build-review judge's per-finding ruling at the would-be-park point: a sibling of
// spec-judge-verdict with a build-appropriate outcome vocabulary. No SYNTHESIZE (the code is
// already written — the judge cannot compose a third code) and no `correction` field (unlike
// spec-judge, a build judge never edits an artifact; a fix is the author's separate re-review
// path, not a judge output). Fail-loud (exit 2) on an outcome outside the closed three (no safe
// coerce target — faff's own producer emits it). Founded-outcome invariants (violations →
// conformant:false, exit 1):
//   OVERTURN         — no rationale requirement, empty product_gap_citation.
//   UPHOLD           — non-empty rationale, empty product_gap_citation.
//   PRODUCT_BOUNDARY — non-empty rationale AND non-empty product_gap_citation.
const BUILD_JUDGE_OUTCOMES = ["OVERTURN", "UPHOLD", "PRODUCT_BOUNDARY"];
function computeBuildJudgeVerdict(extraction) {
  if (extraction === null || typeof extraction !== "object" || Array.isArray(extraction)) {
    return { contractData: null, failLoud: "extraction must be a JSON object" };
  }
  if (!BUILD_JUDGE_OUTCOMES.includes(extraction.outcome)) {
    return { contractData: null, failLoud: `outcome ${JSON.stringify(extraction.outcome)} not in {OVERTURN,UPHOLD,PRODUCT_BOUNDARY} — no safe coerce target` };
  }
  const outcome = extraction.outcome;
  const violations = [];
  const finding_id = typeof extraction.finding_id === "string" ? extraction.finding_id : "";
  if (!finding_id.trim()) violations.push("finding_id is empty");
  const rationale = typeof extraction.rationale === "string" ? extraction.rationale : "";
  const product_gap_citation = typeof extraction.product_gap_citation === "string" ? extraction.product_gap_citation : "";

  if (outcome === "OVERTURN") {
    if (product_gap_citation.trim()) violations.push("OVERTURN carries a product_gap_citation — must be empty");
  } else if (outcome === "UPHOLD") {
    if (!rationale.trim()) violations.push("UPHOLD carries no rationale — a non-overturn ruling must state what stands and why");
    if (product_gap_citation.trim()) violations.push("UPHOLD carries a product_gap_citation — must be empty");
  } else if (outcome === "PRODUCT_BOUNDARY") {
    if (!rationale.trim()) violations.push("PRODUCT_BOUNDARY carries no rationale");
    if (!product_gap_citation.trim()) violations.push("PRODUCT_BOUNDARY carries no product_gap_citation — the specific product/policy gap must be cited");
  }

  return {
    contractData: { finding_id, outcome, rationale, product_gap_citation, conformant: violations.length === 0, violations },
    failLoud: null,
  };
}

function contractBuildJudgeVerdict(extraction) {
  const { contractData, failLoud } = computeBuildJudgeVerdict(extraction);
  if (failLoud) return { failLoud };
  const schemaErr = schemaCheck(contractData, "build-judge-verdict");
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

module.exports = { MARKER_CLASS, computeSpecReadiness, contractSpecReadiness, computeReviewVerdict, contractReviewVerdict, computeSpecReviewVerdict, contractSpecReviewVerdict, SPEC_JUDGE_OUTCOMES, computeSpecJudgeVerdict, contractSpecJudgeVerdict, BUILD_JUDGE_OUTCOMES, computeBuildJudgeVerdict, contractBuildJudgeVerdict, ARCHITECTURE_RECOMMENDATIONS, computeArchitectureProposal, contractArchitectureProposal };
