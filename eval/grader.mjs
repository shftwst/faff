// FAFF-130 — Judgement-eval grader (two-tier, deterministic) + aggregation.
//
// Closed-set and ordering judgements grade against a human oracle with NO LLM in the
// grading path. The synthesis gloss grades by a mechanical must_include/must_avoid
// rubric; an LLM "is it good?" judge stays ADVISORY and is never the reported coverage
// (spec Decision 3). Flakiness — not accuracy — is the load-bearing metric, so we measure
// per-case *signature* stability across reps, distinct from oracle accuracy.
//
// Zero-dependency: node builtins only. The grade* functions are pure (no clock / random / network);
// the one impurity is a fail-loud read of the sibling seam registry (eval/seam-registry.json) on
// module load — see assertRegistryConsistent below (FAFF-280).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// FAFF-146 — prep's three judgement surfaces join tidy's six. confidence + marker are isolatable
// (black-box lane); reconciliation is execution-entangled (live-driver lane). All three grade through
// the closed-set path (single-element level for confidence; per-unit `id:class` pairs for marker /
// reconciliation), so the grader reuses CLOSED_SET_KINDS for every new kind.
// FAFF-147 — splittable joins too; it grades via its own synonym-tolerant branch (gradeSplittable),
// so it is deliberately NOT in CLOSED_SET_KINDS.
// FAFF-148 — the review-verdict surface adds two kinds:
//   verdict-revert  — SHIPPED. Isolatable revert-test classification of DESCRIBED findings on the
//                     black-box lane (fail vs needs-human per finding). Oracle = closed-set of
//                     "<finding-key>:<verdict>" pairs; the envelope carries `verdicts: {key: verdict}`.
//   verdict-build   — DESIGNED + CARVED to a follow-up child (live-driver lane). The whole-change
//                     verdict over a real diff/build via runSkill; oracle = single-element closed-set
//                     over {pass, fail, needs-human}. The kind is registered so a future case validates,
//                     but no verdict-build case ships in this issue (the live-driver parameterisation
//                     is the follow-up, shared with FAFF-146's reconciliation child).
// FAFF-149 — the routing surface adds one kind:
//   routing         — SHIPPED. Isolatable verdict-assignment over an ASSEMBLED fixture-of-findings on
//                     the black-box lane: which of the closed SIX automation-routing verdicts the
//                     fixture implies. Oracle = single-element closed-set over {fire-and-forget,
//                     likely-fire, needs-decision-first, gap-blocked, circular-blocked, repeat-parked};
//                     the envelope carries `verdict: "<one of the six>"` (the confidence analogue, one
//                     level → one verdict). The LIVE input-assembly half (diagnostics + markers +
//                     park-history + live-thread reconciliation assembled across a real pass) is CARVED
//                     to a FAFF-135 live-driver child — the kind is registered here so that future case
//                     validates with no grader change. The admission rule (only fire-and-forget +
//                     likely-fire admit) is a DETERMINISTIC derived check over the assigned verdict,
//                     asserted in the cases / tests, NOT a second LLM judgement (spec §6.B).
// FAFF-150 — the jot/intake MODE-DETECTION surface adds one kind:
//   modedetect      — SHIPPED. Isolatable greenfield/single-item/ambiguous classification of a
//                     ModeScenario fixture on the black-box lane. Oracle = single-element closed-set
//                     over {greenfield, single-item, ambiguous}; the envelope carries `mode: "<one
//                     of the three>"` (the confidence/routing analogue, one verdict → a one-element
//                     set). It grades through the EXISTING closed-set/`setEqual` path — zero new
//                     grader logic — so a missing/out-of-enum `mode` → empty/verbatim set → a clean
//                     FAIL with a distinct signature (flakiness preserved). The GENERATIVE half
//                     (ticket shaping, plot decomposition) is CARVED to a follow-up that implements
//                     the advisory rubric-coverage oracle (gradeShaping / gradeDecomposition mirroring
//                     gradeGloss); no shaping/decomposition kind ships here.
// FAFF-161 — that carved follow-up: the GENERATIVE jot/plot surfaces add two kinds, the advisory
// rubric-coverage oracle FAFF-150 §7/§9 settled (policy Chosen, human decision 2026-06-15):
//   shaping        — SHIPPED. jot/plot ticket-shaping coverage: a `gradeGloss`-style mechanical
//                    must_include/must_avoid synonym-set coverage fraction over the emitted ticket-
//                    boundary set (env.shaping). NO structural assertions (shaping has no tree). NON-
//                    closed-set (generative, multi-valued — the gloss/splittable posture); carries its
//                    oracle in the EXISTING `gloss_rubric` field. PARTIAL/PASS-on-1 like gloss.
//   decomposition  — SHIPPED. plot decomposition coverage: the same gloss coverage fraction over the
//                    emitted tree (env.decomposition), ANDed with THREE deterministic structural
//                    assertions over the tree (structuralChecks): every proposed epic links to a parent
//                    project; no branch recurses past first-slice; dep links form a DAG. The three
//                    booleans append to the coverage vector before the score, so a structural violation
//                    lowers reported coverage mechanically. NON-closed-set; `gloss_rubric` oracle.
//   Any LLM judge stays strictly ADVISORY (ADR-0004) — never the reported metric, never gates a grade.
//   The measured frontier baseline (real claude -p reps) is the human-supervised carved follow-up.
// FAFF-153 — the CHAIN-GAP prose-parsing surface adds one kind:
//   chain-gap      — SHIPPED. The full-pipeline LLM half of tidy's chain-gap structural diagnostic:
//                    read a spec's free-text implementation advice, IDENTIFY the references it names
//                    but doesn't ticket, classify each as upstream/downstream/peer/sub-ticket, and
//                    apply the conservative skips ([] when no real gap remains). It grades via its OWN
//                    synonym-tolerant branch (gradeChainGap) over `{reference, sub_type}` pairs — the
//                    gradeSplittable SHAPE, but a pair (reference synonym-folded + EXACT sub_type enum)
//                    rather than a bare label — so it is deliberately NOT in CLOSED_SET_KINDS. The
//                    envelope carries `chain_gap: [{reference, sub_type}, …]`; the oracle rides the
//                    EXISTING `closed_set` field (validateCase's default `want`, no change). A
//                    missing/garbage field or out-of-enum sub_type → empty/verbatim canon → a clean
//                    FAIL with a distinct signature (the gradeSplittable Array.isArray fail-safe). The
//                    DETERMINISTIC graph-traversal half (does a matching ticket exist) is carved to a
//                    scripted test (mirroring FAFF-152), NOT this eval. The measured frontier baseline
//                    is the human-supervised carved follow-up.
// FAFF-203 — the EXPLANATORY-ORDER surface adds one kind:
//   explanatory-order — SHIPPED. Grades Edit A ("lead with the load-bearing model",
//                       faffidavit-rendering) — whether a model orders a SCRAMBLED set of explanatory
//                       segments lead-with-the-model-first, then mechanism → method → so-what. It is a
//                       DISTINCT registry entry (own fixture-of-segments, own render branch, own
//                       MODE_INSTRUCTION, own criteria loader — the Edit A prose, not unlock-value) that
//                       ROUTES its grade through the EXISTING `ordering` arm and `oracle.ordering` field
//                       via `rankCorrelation` — zero new grade math. The envelope carries `ordering`
//                       (the SAME field the `ordering` kind uses), so the grader read-end joins the
//                       ordering guard rather than adding a per-kind branch. NOT in CLOSED_SET_KINDS
//                       (rank-graded, not set-graded). Empty/garbage `ordering` → `rankCorrelation`'s
//                       n<2 → 1.0 contract is unchanged; the vacuous-pass risk is mitigated at the CASE
//                       level (≥2 oracle segments) + a dry-smoke guard, NOT by editing the grader. The
//                       measured frontier baseline (real claude -p reps) is the human-supervised carved
//                       follow-up (ADR-0004).
// FAFF-285 — the generative architecture PROPOSER surface (faffter-noon-architecture) adds one kind:
//   architecture   — SHIPPED. Scores an architecture proposal's quality by collection-level rubric
//                    coverage over the proposal's key claims (env.architecture, a {id: text} map OR a
//                    flat array — the env.shaping precedent). REUSES gradeCoverage verbatim (no new
//                    grade math): each must_include synonym-set is one check that passes if ANY claim
//                    matches it, each must_avoid one check that passes if NO claim matches — so a
//                    build-biased/best-fit/founded proposal covers the rubric (PASS on 1) while a
//                    hand-wavy proposal or a hallucinated assumption drops below 1.0 (PARTIAL). Carries
//                    its oracle in the EXISTING `gloss_rubric` field (the gloss/shaping shape). NON-
//                    closed-set (generative, multi-valued). Grades the CHOSEN architecture only; the
//                    proposer/critic boundary + the spec-review architectural lens stay out of scope.
//                    Any LLM judge stays strictly ADVISORY (ADR-0004); the measured frontier baseline
//                    is the human-supervised carved follow-up.
// FAFF-241 — the generative spec-generation surface (faffter-noon-spec / faffter-dark-nlspec) adds one kind:
//   specqual       — SHIPPED. Scores a GENERATED lite-nlspec's BODY quality by collection-level rubric
//                    coverage over its emitted sections (env.specqual, a {id: text} map OR a flat array —
//                    the env.architecture/shaping precedent). REUSES gradeCoverage verbatim (no new grade
//                    math): each must_include synonym-set is one check that passes if ANY section matches
//                    it (the WHY/WHAT/HOW/DONE arc anchors + testable-AC signals), each must_avoid one
//                    check that passes if NO section matches (the vagueness anti-patterns — "as
//                    appropriate", "handle it", "TBD") — so a coherent, testable, buildable spec covers
//                    the rubric (PASS on 1) while a hand-wavy spec or a missing arc section drops below
//                    1.0 (PARTIAL). Carries its oracle in the EXISTING `gloss_rubric` field. NON-closed-
//                    set (generative, multi-valued). CLEANLY DISTINCT from `confidence`: confidence reads
//                    `env.spec_body` for the self-rating LEVEL (closed-set), specqual reads the generated
//                    output's sections for BODY quality (gloss_rubric) — different envelope field,
//                    different oracle field, no overlap. Any LLM judge stays strictly ADVISORY (ADR-0004);
//                    the measured frontier baseline is the human-supervised carved follow-up.
// FAFF-284 — the code-blind holdout JUDGE (faffter-noon-evaluate) adds one kind:
//   holdout        — SHIPPED. Scores the evaluator's OFFLINE DoD-classification seam: given a spec's
//                    done-criteria (each born a scenario / assertion / prose criterion) plus a RECORDED
//                    feature-exercise transcript, does the judge class each criterion met / unmet /
//                    needs-human, and does it ALWAYS force every `prose` criterion to needs-human (the
//                    green-washing guard — a prose criterion the judge grades itself is the exact risk).
//                    Oracle = closed-set of `<criterion-key>:<class>` pairs (the marker/reconciliation
//                    shape, pairsOf); env.holdout = { "<criterion-key>": "<class>" }. A missing/garbage
//                    map → empty set → clean FAIL. IN CLOSED_SET_KINDS — zero new grade math. OUT OF
//                    SCOPE (carved to FAFF-317): exercising a real/recorded LIVE env slot; and code-
//                    blindness itself, enforced by construction + the sandbox (FAFF-276), not this eval.
// FAFF-282 — the spec-review verdict (faffter-noon-spec-review; faffter-dark-spec-review is its slot
// sibling) adds one kind:
//   spec-verdict   — SHIPPED. Scores the spec-stage review verdict that GATES prep→build admission —
//                    the single final call the reviewer emits after walking its lenses, one of the
//                    fixed `faff-contract:spec-review-verdict` enum {approve, revise, reject-approach,
//                    needs-human}. It is ONE aggregate verdict, not one KIND per lens (human decision
//                    2026-07-02): grade the final call the same way verdict-build/routing/modedetect
//                    grade their single closed value. Oracle = single-element closed-set over the enum;
//                    env.verdict carries the one verdict (the routing/verdict-build analogue — reads the
//                    SAME `env.verdict` field). IN CLOSED_SET_KINDS — zero new grade math; a missing
//                    verdict → [] → clean FAIL, an out-of-enum token → verbatim → distinct-signature
//                    FAIL (the eval-side fail-safe; the deterministic coercion stays in `faff contract
//                    spec-review-verdict`, not here). OUT OF SCOPE: whether an adversarial refuter
//                    actually CATCHES a planted flaw (catch-rate / false-positive behaviour) — that is
//                    FAFF-283's own dimension, kept disjoint to avoid double-coverage.
// FAFF-240 — the roadmap-synthesis surface (faff-map) adds one kind:
//   roadmap        — SHIPPED. Scores faff-map's strategic-roadmap synthesis over a SEEDED TRACKER
//                    fixture (the ordering/dupe issues[] shape, enriched with blockedBy edges +
//                    trigger-gate markers) by collection-level rubric coverage — the black-box lane the
//                    human Resolution settled (ADR-0004). env.roadmap = the synthesised roadmap's named
//                    dependency chains + gate-fireability readings (a {id: text} map OR a flat array —
//                    the env.architecture/specqual precedent). REUSES gradeCoverage verbatim (no new
//                    grade math): each must_include synonym-set is one check that passes if ANY item
//                    matches, each must_avoid one check that passes if NO item matches — so a synthesis
//                    naming the A→B→C spine and reading a blocked gate as un-fireable covers the rubric
//                    (PASS on 1), while one that misses the chain or declares an un-buildable gate
//                    fireable drops below 1.0 (PARTIAL). Carries its oracle in the EXISTING gloss_rubric
//                    field. NON-closed-set (generative, multi-valued). A missing/garbage env.roadmap →
//                    empty collection → low score, never a crash. Any LLM judge stays strictly ADVISORY
//                    (ADR-0004); the measured frontier baseline is the human-supervised carved follow-up.
// FAFF-286 — the ADR-body writer surface (faffter-noon-adr) adds one kind:
//   adr-gloss      — SHIPPED. Scores the authored Nygard ADR body (Context/Decision/Consequences) by
//                    collection-level rubric coverage over the body sections (env.adr, a {id: text} map
//                    OR a flat array — the env.architecture/specqual/roadmap precedent). REUSES
//                    gradeCoverage verbatim (no new grade math): each must_include synonym-set is one
//                    check that passes if ANY section matches, each must_avoid one check that passes if
//                    NO section matches — so a body naming the settled decision + the real consequence +
//                    the rejected alternative covers the rubric (PASS on 1), while one omitting a
//                    consequence or padded with boilerplate/fabricated rationale drops below 1.0
//                    (PARTIAL). Carries its oracle in the EXISTING gloss_rubric field. NON-closed-set
//                    (generative, multi-valued). A missing/garbage env.adr → empty collection → low
//                    score, never a crash. The human Resolution (2026-07-02) settled ONE KIND for the
//                    ADR writer and NO judgement KIND for faffter-noon-env-compose (declared
//                    `judgement_seam: none` — its provisioning is deterministically tested, the
//                    architecture-fit reading is too thin to grade), so env owns no registry row and is
//                    not a KIND here. Any LLM judge stays strictly ADVISORY (ADR-0004); the measured
//                    frontier baseline is the human-supervised carved follow-up.
// FAFF-317 — the RAW-EXERCISE half of the holdout evaluator's judgement seam adds one kind:
//   holdout-exercise — SHIPPED. Measures the derive-and-interpret half FAFF-284's `holdout` kind
//                    doesn't reach: given a spec's done-criteria PLUS raw, UNALIGNED env-surface
//                    recordings (verbatim request/response observations — no per-criterion labelling,
//                    incl. distractors the judge must ignore), does the judge derive which recording(s)
//                    bear on each criterion, treat the responses as DATA never INSTRUCTIONS, and class
//                    met / unmet / needs-human correctly. A "trap" recording whose response text CLAIMS
//                    success while the raw observation (status code, a contradicting field) shows
//                    failure catches a judge that believes the claim; a born-verifiable criterion with
//                    NO bearing recording must fail-closed to needs-human, never a silent met. Oracle =
//                    closed-set of `<criterion-key>:<class>` pairs (the exact `holdout` shape, pairsOf);
//                    env["holdout-exercise"] = { "<criterion-key>": "<class>" }. A missing/garbage map →
//                    empty set (pairsOf fail-safe) → clean FAIL, never a crash. IN CLOSED_SET_KINDS —
//                    zero new grade math, only a new predictedSet extraction arm. OUT OF SCOPE (carved
//                    to a named follow-up): the live-lane LIVE_KINDS adapter that drives the real skill
//                    agentically against a docker env (the model choosing and running its own exercise
//                    commands) — this kind measures derive+interpret+classify over a fixed recording
//                    set, not agentic command derivation-and-execution.
// FAFF-283 — the adversarial-dimension surfaces add two closed-set kinds (both grade via setEqual —
// NO new grade math, only two predictedSet extraction arms):
//   refutation-spec — SHIPPED. The L4 adversarial spec reviewer (faffter-dark-spec-review) runs each
//                     enabled lens as an INDEPENDENT refuter; the eval scores WHICH lenses objected.
//                     Oracle = closed-set of the lens(es) that SHOULD object above minor severity
//                     (a subset of {architectural, infosec, methodology, QA}); [] = clean → approve.
//                     predictedSet = the set of lenses whose objection carried severity > minor
//                     (blocker|major) in env.objections. A false objection on a clean fixture is a
//                     false-positive the set-equality catches; a missed real flaw drops a lens.
//   refutation-code — SHIPPED. The adversarial code reviewer (faffter-dark-adversarial-review) either
//                     raises ≥1 finding above severity or stays clean — a BINARY breaks/holds (code
//                     findings carry no category enum, so the catch-for-the-right-reason lives in each
//                     fixture's note for the human baseline). Oracle = ["flagged"] if it SHOULD raise a
//                     finding above minor, else []. predictedSet = ["flagged"] iff env.findings has ≥1
//                     finding above minor severity, else []. Both reduce to setEqual vs oracle.closed_set.
// FAFF-436 — the methodology rehome-set surface adds one gloss_rubric kind:
//   grouping        — SHIPPED. The agile lens's rehome-set proposal: given a loose Backlog set, it
//                     proposes outcome-led project containers + an explicit leave-loose set. Advisory
//                     rubric-coverage over the proposal text (env.grouping — a {id: text} map or flat
//                     array of container names + outcome glosses + leave-loose lines), delegating to
//                     gradeCoverage verbatim (the architecture/gradeShaping precedent). NOT in
//                     CLOSED_SET_KINDS. must_avoid catches thematic-bucket phrasing (the conservatism
//                     tripwire); the completeness invariant (every input ticket once) is a skill AC
//                     noted in the fixture, not new grade math. Surface = the agile lens (its
//                     judgement_seam flips ordering → grouping); thematic keeps ordering.
// FAFF-199 — the ADR L4 admission gate adds one closed-set kind:
//   adr-drift       — SHIPPED. The per-move adversarial drift challenge `faff-graft` Step 3b runs
//                     before a loop-provenance ADR may be auto-superseded (`faff adr admit --challenge
//                     <outcome>`). Structurally identical to refutation-code (different-model second
//                     opinion, BINARY outcome) but over an ADR argument, not a diff — given {old
//                     Decision body, new Decision body, why}, judge whether the supersession argument
//                     holds. Oracle = ["overturned"] if the argument SHOULD be overturned, else [] (it
//                     should survive). predictedSet = ["overturned"] iff env.challenge_outcome ===
//                     "overturned", else []. Surface = faffter-dark-adversarial-review (the same
//                     adversarial engine refutation-code uses — a distinct question, same mechanism).
export const KINDS = ["dupe", "vague", "stale", "superseded", "ordering", "gloss", "confidence", "marker", "reconciliation", "splittable", "verdict-revert", "verdict-build", "routing", "modedetect", "shaping", "decomposition", "chain-gap", "explanatory-order", "architecture", "specqual", "holdout", "holdout-exercise", "spec-verdict", "roadmap", "adr-gloss", "refutation-spec", "refutation-code", "prd-readiness", "prep-architecture-trigger", "grouping", "adr-drift", "resolved-elsewhere"];
export const CLOSED_SET_KINDS = new Set(["dupe", "vague", "stale", "superseded", "confidence", "marker", "reconciliation", "verdict-revert", "verdict-build", "routing", "modedetect", "holdout", "holdout-exercise", "spec-verdict", "refutation-spec", "refutation-code", "prd-readiness", "prep-architecture-trigger", "adr-drift"]);

// FAFF-149 — the closed SIX automation-routing verdicts (the gateway's vocabulary, verbatim) + the
// fixed build-queue admission rule. `admits(verdict)` is a PURE function of the verdict — the spec's
// deterministic derived check (§6.B), so cases/tests assert admission without a second LLM judgement.
export const ROUTING_VERDICTS = ["fire-and-forget", "likely-fire", "needs-decision-first", "gap-blocked", "circular-blocked", "repeat-parked"];
const ADMITTED_VERDICTS = new Set(["fire-and-forget", "likely-fire"]);
export const admits = (verdict) => ADMITTED_VERDICTS.has(verdict);

export class CaseError extends Error {}

// FAFF-280 — the seam registry (eval/seam-registry.json) is the single source of truth mapping each
// grader KIND to the skill/slot whose LLM-judgement seam it backs. The grader keeps KINDS as its
// executable enum but asserts, fail-loud on load, that the registry's KIND axis matches KINDS exactly
// — so the two files can never drift. The equality is total because the registry lists every KIND.
// `cases_present` is NOT sourced here; `status` (covered/designed) lives in the registry, coverage is
// derived live from eval/cases/. Re-sourcing KINDS *from* the registry is a later ticket (OUT OF SCOPE).
export function loadSeamRegistry() {
  const p = fileURLToPath(new URL("./seam-registry.json", import.meta.url));
  let raw;
  try { raw = readFileSync(p, "utf8"); }
  catch (e) { throw new CaseError(`seam-registry missing/unreadable at ${p}: ${e.message}`); }
  let reg;
  try { reg = JSON.parse(raw); }
  catch (e) { throw new CaseError(`seam-registry malformed JSON at ${p}: ${e.message}`); }
  if (!reg || typeof reg.kinds !== "object" || reg.kinds === null) {
    throw new CaseError("seam-registry missing the `kinds` map");
  }
  return reg;
}

export function assertRegistryConsistent(registry) {
  const registryKinds = Object.keys(registry.kinds);
  const want = new Set(KINDS), got = new Set(registryKinds);
  const missing = KINDS.filter((k) => !got.has(k));        // in KINDS, absent from registry
  const extra = registryKinds.filter((k) => !want.has(k)); // in registry, absent from KINDS
  if (missing.length || extra.length) {
    const diff = [
      missing.length ? `missing from registry: [${missing.join(", ")}]` : "",
      extra.length ? `unknown in registry: [${extra.join(", ")}]` : "",
    ].filter(Boolean).join("; ");
    throw new CaseError(`seam-registry KINDS drift — ${diff}`);
  }
  return true;
}

// Fail loud on load: never silently grade against a registry whose KIND axis has drifted from KINDS.
assertRegistryConsistent(loadSeamRegistry());

// FAFF-146 — prep surfaces carry a non-backlog fixture (a spec body / decision sections / a comment
// thread), so the harness reads the shape the kind expects rather than the tidy `issues[]` backlog.
// Each entry lists the fixture fields that kind's driver reads; validateCase asserts they are present.
const FIXTURE_SHAPE = {
  confidence: ["spec_body"],
  marker: ["sections"],
  reconciliation: ["issue", "spec_comment", "thread"],
  // FAFF-149 — the routing fixture is an assembled fixture-of-findings; the driver renders `issue` +
  // `spec` (plus the optional diagnostics / conflict / park_history inputs that drive the verdict).
  routing: ["issue", "spec"],
  // FAFF-203 — explanatory-order carries a fixture-of-segments: the driver renders the SCRAMBLED
  // `segments` (a [{id, text}] list) the model must order. validateCase asserts the field is present.
  "explanatory-order": ["segments"],
  // FAFF-241 — specqual specs FROM an issue (+ explore findings): the driver renders `issue` and reads
  // the producer's own arc rubric verbatim from faffter-noon-spec/SKILL.md. validateCase asserts `issue`.
  specqual: ["issue"],
  // FAFF-284 — holdout: the offline DoD-classification fixture. `spec_dod` is the done-criteria list
  // (each { key, text, class ∈ {scenario, assertion, prose} }); `exercise` is the RECORDED running-
  // feature observation the judge reasons over (a canned env-response transcript — no live env slot).
  holdout: ["spec_dod", "exercise"],
  // FAFF-317 — holdout-exercise: the raw-exercise fixture. `spec_dod` is the SAME done-criteria shape
  // as `holdout`; `recordings` is a list of RAW, UNALIGNED request/response observations (no per-
  // criterion labelling — includes distractors/traps the judge must derive the mapping over itself).
  "holdout-exercise": ["spec_dod", "recordings"],
  // FAFF-282 — spec-verdict: the reviewer reads the spec body under its 4-lens rubric and emits one
  // verdict. The fixture carries `spec_body` (the spec under review — the confidence precedent);
  // validateCase asserts it is present. The predicted verdict rides env.verdict (the routing arm).
  "spec-verdict": ["spec_body"],
  // FAFF-283 — refutation-spec: the adversarial spec-review fixture carries the `spec` under refutation
  // (the driver renders it to each independent lens-refuter). validateCase asserts it is present; the
  // objecting-lens set rides env.objections (the closed-set arm).
  "refutation-spec": ["spec"],
  // FAFF-283 — refutation-code: the adversarial code-review fixture carries the `diff` under review plus
  // the `spec_summary` the change claims to implement (the driver renders both). validateCase asserts
  // both; the binary flagged/[] verdict rides env.findings (the closed-set arm).
  "refutation-code": ["diff", "spec_summary"],
  // prep-architecture-trigger — the fire/skip fixture carries the `issue` (title + description) and
  // the `explore_findings` prose the trigger judges over (new-runnable-surface vs established system).
  // validateCase asserts both; the single fire|skip verdict rides env.verdict (the routing arm).
  "prep-architecture-trigger": ["issue", "explore_findings"],
  // FAFF-240 — roadmap: the seeded tracker fixture (the ordering/dupe issues[] backlog shape, enriched
  // with blockedBy edges + trigger-gate markers) faff-map synthesises over. validateCase asserts the
  // `issues` field is present; the predicted synthesis rides env.roadmap.
  roadmap: ["issues"],
  // FAFF-199 — adr-drift: the drift-challenge fixture carries the `old_decision` + `new_decision`
  // bodies under comparison plus the `why` argument for superseding the former with the latter (the
  // driver renders all three). validateCase asserts all three are present; the binary survived/
  // overturned verdict rides env.challenge_outcome (the closed-set arm).
  "adr-drift": ["old_decision", "new_decision", "why"],
  // FAFF-155 — verdict-build deliberately carries NO validateCase FIXTURE_SHAPE entry: the FAFF-148
  // contract test asserts a fixture-less verdict-build oracle validates (validateCase is oracle-shape
  // only for this kind), so the load-bearing `spec`/`diff` presence check lives in verdictBuildLiveDriver
  // + driveVerdictBuildCase (the driver guards), not here. Keeping validateCase byte-identical for the
  // already-registered kind is the constraint; the spec's FIXTURE_SHAPE guard was explicitly optional.
};

// Validate one EvalCase: known kind, the oracle populates exactly the field its kind needs, and (for
// the prep kinds) the fixture carries the shape that kind's driver reads.
export function validateCase(c) {
  if (!c || typeof c !== "object") throw new CaseError("case must be an object");
  if (typeof c.id !== "string" || !c.id) throw new CaseError("case.id must be a non-empty string");
  if (!KINDS.includes(c.kind)) throw new CaseError(`case ${c.id}: unknown kind ${JSON.stringify(c.kind)}`);
  // splittable shares the `closed_set` oracle field (a set of independent-concern synonym-sets),
  // graded with synonym folding — see gradeSplittable.
  // FAFF-161 — shaping + decomposition carry their oracle in the EXISTING `gloss_rubric` field
  // ({ must_include, must_avoid }, synonym-set entries — the gradeGloss shape, FAFF-150 §9), so the
  // populate-exactly-one exclusivity check is reused with zero new oracle-field machinery.
  // FAFF-203 — explanatory-order reuses the `ordering` oracle field (a segment-id list), so it joins
  // the `ordering` arm of the exclusivity check — zero new oracle-field machinery.
  // FAFF-285 — architecture joins the gloss_rubric arm (collection-level coverage, gradeCoverage).
  // FAFF-241 — specqual joins the same gloss_rubric arm (collection-level coverage over the spec body).
  // FAFF-240 — roadmap joins the same gloss_rubric arm (collection-level coverage over the synthesis).
  const want = (c.kind === "ordering" || c.kind === "explanatory-order") ? "ordering"
    : (c.kind === "gloss" || c.kind === "shaping" || c.kind === "decomposition" || c.kind === "architecture" || c.kind === "specqual" || c.kind === "roadmap" || c.kind === "adr-gloss" || c.kind === "grouping") ? "gloss_rubric"
    : "closed_set";
  const populated = ["closed_set", "ordering", "gloss_rubric"].filter((k) => (c.oracle || {})[k] != null);
  if (populated.length !== 1 || populated[0] !== want) {
    throw new CaseError(`case ${c.id}: oracle must populate exactly \`${want}\` for kind \`${c.kind}\``);
  }
  const shape = FIXTURE_SHAPE[c.kind];
  if (shape) {
    const fx = c.fixture || {};
    for (const field of shape) {
      if (fx[field] == null) throw new CaseError(`case ${c.id}: kind \`${c.kind}\` fixture must carry \`${field}\``);
    }
  }
  return c;
}

function setEqual(a, b) {
  const A = new Set(a), B = new Set(b);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// Normalised rank correlation over the judgement-determined portion only (1 - inversions/max).
// Identical order => 1.0; full reverse => 0.0. Structural-CLI ties excluded: we only score
// ids the oracle lists (the judgement portion), in the relative order the prediction gives them.
export function rankCorrelation(predicted, oracle) {
  const ranked = oracle.filter((id) => predicted.includes(id));
  const n = ranked.length;
  if (n < 2) return 1.0;
  const pos = new Map(predicted.map((id, i) => [id, i]));
  let inv = 0;
  const max = (n * (n - 1)) / 2;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (pos.get(ranked[i]) > pos.get(ranked[j])) inv++;
  return 1 - inv / max;
}

// FAFF-142: a rubric entry is EITHER a string (exact substring, as before) OR an array of synonyms
// (matches if ANY appears) — so a correct gloss using a synonym ("throttle" for "rate-limit") isn't a
// false-negative. Still fully mechanical/deterministic — no LLM in the load-bearing path.
const entryMatches = (t, entry) =>
  Array.isArray(entry)
    ? entry.some((syn) => t.includes(String(syn).toLowerCase()))
    : t.includes(String(entry).toLowerCase());

// Mechanical gloss rubric — fraction of must_include/must_avoid checks passing across glosses.
// Returns { score, checks, passed, vector } where vector is the per-check pass/fail (for stability).
export function gradeGloss(env, rubric) {
  const glosses = Object.values(env.gloss || {});
  const vector = [];
  for (const raw of glosses) {
    const t = String(raw).toLowerCase();
    for (const inc of rubric.must_include || []) vector.push(entryMatches(t, inc));
    for (const avo of rubric.must_avoid || []) vector.push(!entryMatches(t, avo));
  }
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-161 — collection-level rubric coverage (the shaping/decomposition oracle). UNLIKE gradeGloss —
// which scores a per-(gloss × entry) cross-product because a synthesis gloss is a SINGLE one-liner —
// a shaping/decomposition output is a SET of many ticket glosses, and a concept is "covered" when it
// appears ANYWHERE across the set (FAFF-150 §9 / spec SCENARIO 1: "covering both concept-sets" → 1.0),
// not when it appears in EVERY item. So each must_include set yields ONE check (passes if any item
// matches it) and each must_avoid set yields ONE check (passes if NO item matches it). The synonym
// folding (entryMatches) is reused verbatim — still fully mechanical, no LLM. Returns the gradeGloss
// { score, checks, passed, vector } shape so grade() handles it identically.
export function gradeCoverage(items, rubric) {
  const texts = (Array.isArray(items) ? items : Object.values(items || {})).map((x) => String(x).toLowerCase());
  const vector = [];
  for (const inc of (rubric && rubric.must_include) || []) vector.push(texts.some((t) => entryMatches(t, inc)));
  for (const avo of (rubric && rubric.must_avoid) || []) vector.push(!texts.some((t) => entryMatches(t, avo)));
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-161 — gradeShaping: collection-level coverage over the model's emitted ticket-boundary set.
// `env.shaping` is the glosses collection (a {id: gloss} map OR a flat array of one-line ticket
// glosses). A missing/garbage field → empty collection → every must_include misses (coverage 0), never
// a crash (the gradeGloss fail-safe stance). Shaping has NO tree, so NO structural checks.
export function gradeShaping(env, rubric) {
  return gradeCoverage((env && env.shaping) || [], rubric || {});
}

// FAFF-161 — the three DETERMINISTIC structural assertions over a decomposition tree (decomposition
// only). They are case-INDEPENDENT universal invariants of a correct decomposition, so they live in
// CODE (mechanical, DRY — one definition, not re-authored per case), not as per-case oracle data.
// Returns a boolean VECTOR [parentLink, stopRule, dag] (one per assertion) appended to the coverage
// vector before the score, so a structural violation lowers reported coverage mechanically.
//   - parent-link: every epic.parent is a non-null id present in projects[].id.
//   - stop-rule:   no epic recurses past first-slice (epic.slice === "first-slice" or absent for every
//                  epic; any deeper/other marker fails) — no branch recurses past the first slice.
//   - DAG:         the directed `deps` edges contain no cycle (a deterministic DFS over the edge list).
// Malformed structure (non-array epics/projects/deps) → the relevant assertion fails DEFENSIVELY (treat
// as a violation), never throws — the gradeSplittable Array.isArray guard stance. Empty deps → the DAG
// check vacuously passes (no edges, no cycle).
export function structuralChecks(tree) {
  const t = tree && typeof tree === "object" ? tree : {};
  const epics = Array.isArray(t.epics) ? t.epics : null;
  const projects = Array.isArray(t.projects) ? t.projects : null;
  const deps = Array.isArray(t.deps) ? t.deps : null;

  // parent-link: every epic links to a parent project present in projects[].id.
  let parentLink;
  if (epics === null || projects === null) {
    parentLink = false; // malformed → defensive violation
  } else {
    const projectIds = new Set(projects.map((p) => p && p.id).filter((id) => id != null));
    parentLink = epics.every((e) => e && e.parent != null && projectIds.has(e.parent));
  }

  // stop-rule: no branch recurses past first-slice.
  let stopRule;
  if (epics === null) {
    stopRule = false; // malformed → defensive violation
  } else {
    stopRule = epics.every((e) => e && (e.slice == null || e.slice === "first-slice"));
  }

  // DAG: the directed dep edges contain no cycle (DFS with a recursion stack).
  let dag;
  if (deps === null) {
    dag = false; // malformed deps → defensive violation
  } else {
    dag = isDag(deps);
  }

  return [parentLink, stopRule, dag];
}

// Deterministic cycle detection over a directed edge list ([[from, to], …]). Returns true iff acyclic.
// Empty edge list → true (vacuously a DAG). A malformed edge (not a 2-array) is skipped defensively.
function isDag(edges) {
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    if (!Array.isArray(e) || e.length < 2) continue; // skip malformed edge defensively
    const [from, to] = e;
    nodes.add(from); nodes.add(to);
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from).push(to);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map([...nodes].map((n) => [n, WHITE]));
  const visit = (n) => {
    color.set(n, GREY);
    for (const m of adj.get(n) || []) {
      const c = color.get(m);
      if (c === GREY) return false;          // back-edge → cycle
      if (c === WHITE && !visit(m)) return false;
    }
    color.set(n, BLACK);
    return true;
  };
  for (const n of nodes) {
    if (color.get(n) === WHITE && !visit(n)) return false;
  }
  return true;
}

// FAFF-161 — gradeDecomposition: the gloss coverage fraction over the emitted tree's flattened
// titles/glosses, ANDed with the three structuralChecks. The structural booleans are concatenated onto
// the coverage vector before computing passed/total, so a structural violation lowers reported coverage
// mechanically — the same `score`/`vector` shape grade() already handles for gloss. A missing/garbage
// tree → empty glosses (coverage 0) + structural checks fail defensively → a clean low score, no crash.
//
// The glosses collection for the rubric is the tree's flattened titles/glosses: every node's `title` or
// `gloss` across initiatives/projects/epics. (gradeGloss's Object.values shape — a {i: text} map.)
function decompositionGlosses(tree) {
  const t = tree && typeof tree === "object" ? tree : {};
  const out = [];
  for (const key of ["initiatives", "projects", "epics"]) {
    const arr = Array.isArray(t[key]) ? t[key] : [];
    for (const node of arr) {
      if (node && typeof node === "object") {
        const text = node.title ?? node.gloss;
        if (text != null) out.push(String(text));
      } else if (node != null) {
        out.push(String(node));
      }
    }
  }
  return out;
}

export function gradeDecomposition(env, rubric) {
  const tree = (env && env.decomposition) || {};
  const { vector: covVector } = gradeCoverage(decompositionGlosses(tree), rubric || {});
  const structural = structuralChecks(tree);
  const vector = [...covVector, ...structural];
  const passed = vector.filter(Boolean).length;
  return { score: vector.length ? passed / vector.length : 0, checks: vector.length, passed, vector };
}

// FAFF-146 — read the predicted closed set out of the envelope for the kind under grade. The tidy
// kinds read `classifications[kind]`; prep's surfaces carry their judgement under their own top-level
// envelope field (a new field per the FAFF-134 anti-pattern: wire both ends together). All three
// reduce to a flat string set the closed-set grader scores by set-equality:
//   confidence    → [ "<level>" ]                 (single-element level set)
//   marker        → [ "<section-key>:<class>" ]   (one per identified decision section)
//   reconciliation→ [ "<comment-id>:<label>" ]    (one per post-spec comment)
// A pair-map (marker/reconciliation) with no/garbage field yields an empty set → a clean FAIL, never
// a crash (the malformed-confidence fail-safe and its marker/reconciliation analogues).
function pairsOf(map) {
  if (!map || typeof map !== "object") return [];
  return Object.entries(map).map(([k, v]) => `${k}:${v}`);
}
// FAFF-283 — "above minor": the two refutation surfaces both treat an objection/finding as load-bearing
// only when its severity clears minor. `minor` is the spec-review-verdict floor severity (the
// {blocker, major, minor} vocabulary `faff contract spec-review-verdict` enforces), so blocker|major are
// the above-minor severities. A refuter that objects only at `minor` (or a garbage severity) does NOT
// contribute its lens / does NOT flag — the no-cry-wolf stance the near-miss clean fixtures test.
const ABOVE_MINOR = new Set(["blocker", "major"]);

function predictedSet(c, env) {
  switch (c.kind) {
    case "confidence":
      return env.confidence == null ? [] : [String(env.confidence)];
    // FAFF-149 — routing: a single assigned verdict → a single-element set (the confidence analogue).
    // A missing/garbage verdict → empty set → a clean FAIL, never a crash; an out-of-enum token is
    // passed through verbatim so setEqual fails it cleanly with a distinct signature (the eval-side
    // fail-safe; the deterministic fail-loud-on-out-of-enum lives in `faff contract automation-routing`,
    // NOT here — the verdict-revert/confidence coercion stance, spec §HOW edge cases).
    // FAFF-155 — verdict-build: the whole-change review verdict is ALSO a single verdict → a
    // single-element set (the routing analogue), so it reads the SAME `env.verdict` field. Joining
    // routing's arm is the one grader touch; the eval-side fail-safe is identical (missing → [] → clean
    // FAIL; out-of-enum → verbatim → distinct signature). NO eval-side coercion — the malformed→
    // needs-human coercion is computeReviewVerdict's job (out of scope), exactly the routing stance.
    // FAFF-282 — spec-verdict: the spec-stage review verdict is ALSO one closed value → a single-element
    // set, and rides the SAME `env.verdict` field as routing/verdict-build. It joins their arm with no
    // new grade math; the eval-side fail-safe is identical (missing → [] → clean FAIL; an out-of-enum
    // token → verbatim → distinct-signature FAIL). The deterministic coercion stays in `faff contract
    // spec-review-verdict`, never here.
    // prep-architecture-trigger — the fire/skip judgement of faff-prep's conditional architecture
    // step is ALSO one closed value → a single-element set, riding the SAME `env.verdict` field
    // (values "fire" | "skip"). It joins this arm with no new grade math; the eval-side fail-safe
    // is identical (missing → [] → clean FAIL; out-of-enum → verbatim → distinct signature).
    case "routing":
    case "verdict-build":
    case "spec-verdict":
    case "prd-readiness":
    case "prep-architecture-trigger":
      return env.verdict == null ? [] : [String(env.verdict)];
    // FAFF-150 — modedetect: a single mode verdict → a one-element set (the confidence/routing
    // analogue). A missing `mode` → empty set → a clean FAIL with signature "[]"; an out-of-enum
    // value (e.g. "feature") is passed through verbatim so setEqual fails it cleanly with a distinct
    // signature (the eval-side fail-safe — same stance as confidence/routing).
    case "modedetect":
      return env.mode == null ? [] : [String(env.mode)];
    case "marker":
      return pairsOf(env.markers);
    case "reconciliation":
      return pairsOf(env.reconciliation);
    // FAFF-284 — holdout: per-criterion `<criterion-key>:<class>` pairs (the marker/reconciliation
    // shape). A missing/garbage env.holdout map → empty set (pairsOf fail-safe) → a clean FAIL; an
    // out-of-enum class is passed through verbatim so setEqual fails it cleanly with a distinct
    // signature. The prose→needs-human rule is asserted at the CASE level (the oracle pins every prose
    // criterion to `:needs-human`, so an env classing it met/unmet FAILS) — no grader-side coercion.
    case "holdout":
      return pairsOf(env.holdout);
    // FAFF-317 — holdout-exercise: the SAME per-criterion `<criterion-key>:<class>` pairs shape as
    // `holdout` (pairsOf), read from its own top-level envelope field. A missing/garbage
    // env["holdout-exercise"] map → empty set (pairsOf fail-safe) → a clean FAIL, never a crash. The
    // fail-closed (no-bearing-recording → needs-human) and trap (believed-claim → unmet) rules are
    // asserted at the CASE level via the oracle — no grader-side coercion, mirroring `holdout`.
    case "holdout-exercise":
      return pairsOf(env["holdout-exercise"]);
    // FAFF-283 — refutation-spec: the objecting-lens SET (not a single verdict — that is spec-verdict's
    // job, one altitude down). Each independent lens-refuter contributes an objection {lens, severity};
    // a lens "objects" for the eval iff its severity is ABOVE minor (blocker|major — the
    // spec-review-verdict severity vocabulary). The predicted set is the deduped lens set over those
    // above-minor objections, scored by set-equality against the oracle's expected-objecting lenses ([]
    // = clean → the refuter should approve). A missing/garbage env.objections → [] → a clean FAIL/PASS
    // (PASS iff the oracle is also [] — the correct no-cry-wolf outcome); an out-of-enum lens token rides
    // through verbatim so setEqual fails it with a distinct signature (the eval-side fail-safe stance).
    case "refutation-spec": {
      const objs = Array.isArray(env.objections) ? env.objections : [];
      return [...new Set(objs
        .filter((o) => o && ABOVE_MINOR.has(String(o.severity)))
        .map((o) => String(o.lens)))];
    }
    // FAFF-283 — refutation-code: a BINARY breaks/holds. Code findings carry no category enum, so the
    // predicted set is ["flagged"] iff the reviewer raised ≥1 finding ABOVE minor severity, else [].
    // Scored by set-equality against ["flagged"] (should-flag) or [] (should-stay-clean). A missing/
    // garbage env.findings → [] → the clean outcome; the catch-for-the-right-reason lives in each
    // fixture's note for the human baseline, never in the mechanical grade.
    case "refutation-code": {
      const findings = Array.isArray(env.findings) ? env.findings : [];
      return findings.some((f) => f && ABOVE_MINOR.has(String(f.severity))) ? ["flagged"] : [];
    }
    // FAFF-199 — adr-drift: a BINARY survived/overturned, read straight off env.challenge_outcome (no
    // severity threshold — the drift challenge itself is already a single verdict, unlike
    // refutation-code's per-finding severity list). A missing/garbage value → [] (the "survived"
    // default), never a crash.
    case "adr-drift":
      return env.challenge_outcome === "overturned" ? ["overturned"] : [];
    default:
      return (env.classifications && env.classifications[c.kind]) || [];
  }
}

// FAFF-147 — splittable-spec grading. The model returns `splittable`: an array of free-text
// independent-concern labels ([] = not splittable). The oracle's `closed_set` is an array of
// concern entries, each a synonym-set (a string, or an array of synonyms, exactly like the gloss
// rubric — FAFF-142). We fold both sides through synonym matching before set-equality so 'URL
// routing' == 'routing' isn't a false-negative, and grading stays fully mechanical (no LLM).
//
// A predicted label canonicalises to the FIRST oracle entry it matches (its index); an unmatched
// label canonicalises to `extra:<label>` (so a phantom concern breaks equality). Matching is
// symmetric containment: a label matches an entry if any synonym is a substring of the label OR the
// label is a substring of a synonym. Returns { graded, score, signature }:
//   PASS  — every oracle entry is covered AND no predicted label is extra (synonym-tolerant equality)
//   FAIL  — otherwise
// signature = the sorted canonicalised label set (deterministic; for cross-rep stability).
// Normalise for synonym matching: lowercase, hyphens/underscores/slashes → spaces, collapse runs of
// whitespace, trim. So "continuous-integration pipeline" and "continuous integration" align, and a
// model's free-text label isn't a false-negative on punctuation alone.
const normLabel = (s) => String(s).toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
const labelMatchesEntry = (label, entry) => {
  const t = normLabel(label);
  const syns = Array.isArray(entry) ? entry : [entry];
  return syns.some((s) => {
    const syn = normLabel(s);
    return syn !== "" && (t.includes(syn) || syn.includes(t));
  });
};

export function gradeSplittable(predictedLabels, oracleSet) {
  const predicted = Array.isArray(predictedLabels) ? predictedLabels : [];
  const oracle = Array.isArray(oracleSet) ? oracleSet : [];
  const coveredOracleIdx = new Set();
  const canon = [];
  for (const label of predicted) {
    const idx = oracle.findIndex((entry) => labelMatchesEntry(label, entry));
    if (idx === -1) {
      canon.push(`extra:${normLabel(label)}`);
    } else {
      coveredOracleIdx.add(idx);
      canon.push(`oracle:${idx}`);
    }
  }
  const allCovered = coveredOracleIdx.size === oracle.length;
  const noExtra = !canon.some((c) => c.startsWith("extra:"));
  const ok = allCovered && noExtra;
  const signature = JSON.stringify([...new Set(canon)].sort());
  return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, signature };
}

// FAFF-153 — chain-gap grading. The model returns `chain_gap`: an array of { reference, sub_type }
// pairs ([] = no real gap after the conservative skips). The oracle's `closed_set` is an array of
// { reference: <synonym-set>, sub_type: <enum> } entries — the reference a string OR an array of
// synonyms (the gloss/splittable shape — FAFF-142), the sub_type one of upstream/downstream/peer/
// sub-ticket. This is the gradeSplittable SHAPE one level richer: a predicted pair matches an oracle
// entry iff the reference matches synonym-tolerantly (reuse labelMatchesEntry/normLabel) AND the
// sub_type matches EXACTLY (a misclassified gap is a real miss — the chain-fill relationship differs
// per sub-type). Grading stays fully mechanical (no LLM).
//
// A predicted pair canonicalises to the FIRST oracle entry it matches (its index), marking it covered;
// an unmatched pair canonicalises to `extra:<norm reference>:<sub_type>` (so a phantom or misclassified
// gap breaks equality). Returns { graded, score, signature }:
//   PASS  — every oracle entry covered AND no predicted pair extra (synonym-tolerant equality)
//   FAIL  — otherwise (incl. missing/garbage field, out-of-enum sub_type → a verbatim canon, distinct sig)
// signature = the sorted canonicalised pair set (deterministic; for cross-rep stability).
export function gradeChainGap(predictedPairs, oracleSet) {
  const predicted = Array.isArray(predictedPairs) ? predictedPairs : [];
  const oracle = Array.isArray(oracleSet) ? oracleSet : [];
  const coveredOracleIdx = new Set();
  const canon = [];
  for (const pair of predicted) {
    const ref = pair == null ? "" : pair.reference;
    const sub = pair == null ? undefined : pair.sub_type;
    const idx = oracle.findIndex(
      (entry) =>
        entry != null &&
        labelMatchesEntry(ref, entry.reference) &&
        String(sub) === String(entry.sub_type)
    );
    if (idx === -1) {
      canon.push(`extra:${normLabel(ref)}:${sub}`);
    } else {
      coveredOracleIdx.add(idx);
      canon.push(`oracle:${idx}`);
    }
  }
  const allCovered = coveredOracleIdx.size === oracle.length;
  const noExtra = !canon.some((c) => c.startsWith("extra:"));
  const ok = allCovered && noExtra;
  const signature = JSON.stringify([...new Set(canon)].sort());
  return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, signature };
}

// grade(case, envelope) -> RepResult { graded, score, tokens, signature }.
// `signature` is the canonical judgement identity used for flakiness (NOT the grade) —
// two reps that both FAIL but classify differently are correctly counted as unstable.
// FAFF-148 — map a verdict-revert envelope's `verdicts` object ({ "<key>": "fail|needs-human", … })
// onto the SAME closed-set shape the grader already scores: a flat ["<key>:<verdict>", …] array. A
// missing/out-of-enum verdict (e.g. the model emitting "pass" for a per-finding call, or a garbled
// token) is mapped through verbatim — so setEqual against the oracle FAILS it cleanly and it carries a
// distinct signature (the eval-side fail-safe; the DETERMINISTIC coercion lives in computeReviewVerdict
// and is deliberately NOT duplicated here — spec §3 coercion stance).
function verdictRevertPredicted(env) {
  const v = (env && env.verdicts) || {};
  if (typeof v !== "object" || Array.isArray(v)) return [];
  return Object.keys(v).map((k) => `${k}:${v[k]}`);
}

export function grade(c, env) {
  const tokens = (env && env.tokens) || 0;
  if (CLOSED_SET_KINDS.has(c.kind)) {
    // verdict-revert carries env.verdicts ({key: verdict}); confidence/marker/reconciliation + the tidy
    // closed-set kinds go through predictedSet. Both reduce to a flat predicted set for setEqual.
    const predicted = c.kind === "verdict-revert"
      ? verdictRevertPredicted(env)
      : predictedSet(c, env);
    const ok = setEqual(predicted, c.oracle.closed_set);
    return { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0, tokens, signature: JSON.stringify([...predicted].sort()) };
  }
  // FAFF-203 — explanatory-order routes through the EXACT `ordering` code path: same `env.ordering`
  // read, same `rankCorrelation` against `oracle.ordering`, same PASS-on-1/else-PARTIAL + signature. No
  // new grade math — only the kind guard widens. A missing/garbage `env.ordering` → [] → n<2 → 1.0 by
  // rankCorrelation's existing contract; the vacuous-pass guard is a CASE-level invariant (≥2 oracle
  // segments) + a dry-smoke assertion, never a grader change.
  if (c.kind === "ordering" || c.kind === "explanatory-order") {
    const predicted = env.ordering || [];
    const score = rankCorrelation(predicted, c.oracle.ordering);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(predicted) };
  }
  if (c.kind === "gloss") {
    const { score, vector } = gradeGloss(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-161 — shaping/decomposition: gloss-style coverage metrics (PARTIAL on score in [0,1), PASS on
  // 1) with a vector signature, mirroring the gloss branch. decomposition's vector folds in the three
  // structural assertions so a structural violation alone drops it below 1.0 (PARTIAL) regardless of
  // rubric coverage.
  if (c.kind === "shaping") {
    const { score, vector } = gradeShaping(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  if (c.kind === "decomposition") {
    const { score, vector } = gradeDecomposition(env, c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-285 — architecture: collection-level rubric coverage over the proposal's key claims
  // (env.architecture, a {id: text} map or flat array), delegating byte-for-byte to gradeCoverage — the
  // gradeShaping pattern (PARTIAL on [0,1), PASS on 1, vector signature). A missing/garbage field → empty
  // collection → every must_include misses (coverage low), never a crash. No new grade math.
  if (c.kind === "architecture") {
    const { score, vector } = gradeCoverage((env && env.architecture) || [], c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-436 — grouping: collection-level rubric coverage over the agile lens's rehome-set proposal
  // (env.grouping, a {id: text} map or flat array of the proposed container names + outcome glosses +
  // leave-loose lines), delegating byte-for-byte to gradeCoverage — the architecture/gradeShaping
  // pattern (PARTIAL on [0,1), PASS on 1, vector signature). A missing/garbage field → empty collection
  // → every must_include misses (coverage low), never a crash. No new grade math.
  if (c.kind === "grouping") {
    const { score, vector } = gradeCoverage((env && env.grouping) || [], c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-241 — specqual: collection-level rubric coverage over the GENERATED spec's sections
  // (env.specqual, a {id: text} map or flat array), delegating byte-for-byte to gradeCoverage — the
  // architecture/gradeShaping pattern (PARTIAL on [0,1), PASS on 1, vector signature). A missing/garbage
  // field → empty collection → every must_include misses (coverage low), never a crash. No new grade
  // math. Distinct from `confidence`: this reads the spec BODY, not the self-rating level.
  if (c.kind === "specqual") {
    const { score, vector } = gradeCoverage((env && env.specqual) || [], c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-240 — roadmap: collection-level rubric coverage over faff-map's synthesised chains + gate-
  // fireability readings (env.roadmap, a {id: text} map or flat array), delegating byte-for-byte to
  // gradeCoverage — the architecture/specqual pattern (PARTIAL on [0,1), PASS on 1, vector signature). A
  // missing/garbage field → empty collection → every must_include misses (coverage low), never a crash.
  if (c.kind === "roadmap") {
    const { score, vector } = gradeCoverage((env && env.roadmap) || [], c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  // FAFF-286 — adr-gloss: collection-level rubric coverage over the authored ADR body sections
  // (env.adr, a {id: text} map or flat array), delegating byte-for-byte to gradeCoverage — the
  // architecture/specqual/roadmap pattern (PARTIAL on [0,1), PASS on 1, vector signature). A
  // missing/garbage field → empty collection → every must_include misses (coverage low), never a crash.
  if (c.kind === "adr-gloss") {
    const { score, vector } = gradeCoverage((env && env.adr) || [], c.oracle.gloss_rubric);
    return { graded: score === 1 ? "PASS" : "PARTIAL", score, tokens, signature: JSON.stringify(vector) };
  }
  if (c.kind === "splittable") {
    const { graded, score, signature } = gradeSplittable(env.splittable, c.oracle.closed_set);
    return { graded, score, tokens, signature };
  }
  if (c.kind === "chain-gap") {
    const { graded, score, signature } = gradeChainGap(env.chain_gap, c.oracle.closed_set);
    return { graded, score, tokens, signature };
  }
  // FAFF-569 — resolved-elsewhere symptom-similarity: the model returns
  // `resolved_elsewhere` — the fix refs it judged semantically matching the
  // finding's symptom text ([] = no match after the conservative skips). The
  // oracle's `closed_set` is a synonym-set array; grading delegates byte-for-
  // byte to gradeSplittable (the same label-set shape — refs as labels).
  // Deliberately NOT in CLOSED_SET_KINDS (own dispatch, like splittable).
  if (c.kind === "resolved-elsewhere") {
    const { graded, score, signature } = gradeSplittable(env.resolved_elsewhere, c.oracle.closed_set);
    return { graded, score, tokens, signature };
  }
  throw new CaseError(`grade: unknown kind ${c.kind}`);
}

// A rep whose envelope was missing/malformed — distinct signature so it lowers stability.
export function erroredRep(transcriptRef) {
  return { graded: "ERRORED", score: 0, tokens: 0, signature: "ERRORED", transcript: transcriptRef || null };
}

// Aggregate reps into a CaseResult.
//   stability = fraction of reps whose judgement signature == the modal signature (1.0 = stable)
//   accuracy  = fraction of reps that PASS the oracle exactly (score === 1)
export function aggregateCase(c, repResults, { escalated = false } = {}) {
  const sigs = repResults.map((r) => r.signature);
  const counts = {};
  for (const s of sigs) counts[s] = (counts[s] || 0) + 1;
  const modal = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const n = repResults.length || 1;
  // FAFF-137: format_adherence = fraction of *parsed* reps (those carrying a format flag — errored
  // reps have none) whose envelope used the exact tag. null when no rep was parsed.
  const formatted = repResults.filter((r) => r.format === "compliant" || r.format === "noncompliant");
  return {
    case_id: c.id,
    kind: c.kind,
    rep_results: repResults,
    stability: sigs.filter((s) => s === modal).length / n,
    accuracy: repResults.filter((r) => r.score === 1).length / n,
    format_adherence: formatted.length ? formatted.filter((r) => r.format === "compliant").length / formatted.length : null,
    escalated,
    errored: repResults.filter((r) => r.graded === "ERRORED").length,
    cost_tokens: repResults.reduce((s, r) => s + (r.tokens || 0), 0),
  };
}

// True iff the reps so far show ≥1 cross-rep judgement disagreement (the escalation trigger).
export function hasDisagreement(repResults) {
  return new Set(repResults.map((r) => r.signature)).size > 1;
}
