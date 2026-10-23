// ===========================================================================
// === region:factory — contract-defs-describe — contract definitions: the FAFF-598 describe data and its renderers ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const fs = require("node:fs");
const path = require("node:path");
const { HERE } = require("./shared-infra");
const { REVIEW_DISPOSITIONS, REVIEW_FINDING_SOURCES, REVIEW_SEVERITIES, SPEC_REVIEW_LENSES, SPEC_REVIEW_SEVERITIES, SPEC_REVIEW_VERDICTS } = require("./review-vocab");
const { RUN_DONE_VERDICTS } = require("./run-done");
const { RUN_TRIGGER_REASONS, RUN_TRIGGER_VERDICTS } = require("./run-start");
const { ARCHITECTURE_RECOMMENDATIONS, BUILD_JUDGE_OUTCOMES, MARKER_CLASS, SPEC_JUDGE_OUTCOMES } = require("./contract-defs-review");
const { CI_TRIAGE_ACTIONS, CI_TRIAGE_FAULT_DOMAIN, CI_TRIAGE_FAULT_DOMAIN_SOURCES, CI_TRIAGE_ORIGIN, CI_TRIAGE_TRANSIENCE, ENV_HANDLE_STATUSES, GATE_RUNG_KINDS, GATE_RUNG_STATUSES, POST_MERGE_VERIFICATION_VERDICTS, ROOT_CAUSES, ROUTING_VERDICTS } = require("./contract-defs-delivery");
const { ADR_CHALLENGE_OUTCOMES, DISTANCE_CLASSES, PRDR_ACTORS, PRDR_BY_LEVEL, PRDR_DISPOSITIONS, PRDR_SUPERSEDES, PRDR_YAGNI_PROPOSAL_VERDICTS, PRD_READINESS_LICENCES, PRD_READINESS_REASONS, PRD_READINESS_VERDICTS } = require("./contract-defs-prd");
const { BUNDLE_BOUNDARY_KINDS, BUNDLE_VERDICTS, HOLDOUT_AGGREGATES, HOLDOUT_CLASSES, HOLDOUT_VERDICTS, LANE_BOUNDARY_ACCESS, LANE_BOUNDARY_CONTAINERS, LANE_BOUNDARY_HOST, LANE_BOUNDARY_LANES, RECOVERY_DISPOSITIONS, SCENARIO_RECORD_DISPOSITIONS } = require("./contract-defs-evidence");
const { L4_ENVELOPE_LEVELS, L4_ENVELOPE_OP_KINDS, L4_ENVELOPE_PROVENANCE, RUN_TERMINATION_POLICY_SOURCES } = require("./contract-defs-run");
const { CI_STATES, FLOOR_DECISION_GRANTS, FLOOR_DEPENDENCY_GATES, FLOOR_HOLDOUTS, FLOOR_LEVELS, FLOOR_REVIEW_VERDICTS, NO_CI_POLICIES } = require("./contract-defs-floor");


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
      { field: "decision_grant", enum: FLOOR_DECISION_GRANTS, semantics: {
        "not-applicable": "an ordinary merge the external Commissaire facade never governed (FAFF-828) — the decision leg is a no-op; the default when absent",
        "valid-grant": "a chokepoint verified a genuine covering Ed25519-signed Commissaire decision — passes the decision leg",
        "absent-or-invalid": "governance applies but the grant is missing/forged/non-covering — blocks the effect before it happens",
      } },
      { field: "dependency_gate", enum: FLOOR_DEPENDENCY_GATES, semantics: {
        "not-applicable": "no stack anchor — an ordinary non-stacked merge (FAFF-1077); the decision leg is a no-op; the default when absent",
        satisfied: "the branch-stacked dependent's dependency PR is MERGED and the dependent was rebased onto the true main — passes the interlock",
        blocked: "the dependency PR is still open/unmerged (or closed without merging) — refuses the dependent's merge so it never lands before its dependency",
      } },
    ],
    coercions: [
      "an out-of-enum review_verdict, ci_state, level, holdout, no_ci_policy, decision_grant, or dependency_gate → fail-loud (exit 2) — a shell bug producing an unrecognised state is never coerced into a decidable input",
      "an absent decision_grant defaults to not-applicable (a no-op) — an ordinary merge is byte-for-byte unaffected by the FAFF-828 decision leg",
      "an absent dependency_gate defaults to not-applicable (a no-op) — a non-stacked merge is byte-for-byte unaffected by the FAFF-1077 interlock leg",
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
    purpose: "The fixed four-value verdict every code-review pass (the `review` slot) emits — what faff-graft's Step 9 and the merge floor branch on. Each finding may additionally carry the optional enrichment fields severity/refutation/disposition/source/model (FAFF-1146), covering both the standard code-review pass and the adversarial second-opinion pass in one shared findings array.",
    values: [
      { field: "signal", enum: ["pass", "fail", "needs-human", "unavailable"], semantics: {
        pass: "diff matches spec, ACs covered, no flagged items — proceed to merge",
        fail: "fixable issues found (failing tests, missing coverage, obvious bugs, scope creep) — iterate and re-review",
        "needs-human": "genuine human judgement required (product call, security/privacy concern, irreversible side effect, spec gap) — park, no auto-merge",
        unavailable: "no review verdict could be produced — a review-chain outage (provider down), not a verdict about the work; never treated as pass",
      } },
      // FAFF-1146: severity/disposition/source are lintable:false — the reviewer producer WRITES
      // these labels while itemising its own findings (a checklist dialect, like spec-review's
      // lens/severity), not a routing verdict a consumer branches on. `signal` above stays lintable
      // (the closed four-value routing enum every consumer pipes through `faff contract review-verdict`).
      { field: "findings[].severity", enum: REVIEW_SEVERITIES, lintable: false, semantics: { critical: "a severe defect", major: "a significant defect", minor: "a small defect", observation: "a non-defect note (also the adversarial pass's clean-review token and its auto-refutation downgrade)" } },
      { field: "findings[].disposition", enum: REVIEW_DISPOSITIONS, lintable: false, semantics: { fixed: "the finding was addressed in the diff", refuted: "the finding was challenged and shown to be a non-defect", "accepted-risk": "the finding is valid but accepted as a known risk", open: "undecided at verdict-emit time (the durable disposition record is graft Step 9's terminal comment)" } },
      { field: "findings[].source", enum: REVIEW_FINDING_SOURCES, lintable: false, semantics: { standard: "raised by the primary code-review pass", adversarial: "raised by the adversarial second-opinion pass (a structurally different model)" } },
    ],
    coercions: ["an out-of-enum signal → coerced to needs-human (never pass) — a malformed verdict never reads as a green light", "a fail/needs-human signal with zero findings → conformant:false (exit 1)", "an out-of-enum finding severity/disposition/source → conformant:false (exit 1, not fail-loud — an echoed bad value on an additive soft field, the value preserved verbatim); the merge floor still branches only on `signal`, so it never blocks or escalates the merge"],
    producer_notes: ["the producer never self-reports `unavailable` — that signal is the orchestrator's own outage detection (FAFF-405), not something a reviewer LLM emits about its own run", "refutation, disposition_rationale and model are optional free strings (no enum, no violation); `disposition_rationale` is the reasoning/commentary behind the disposition (producers SHOULD emit it alongside `disposition`, especially for `accepted-risk`/`refuted`); `model` is the harness-authored `<provider>/<model>` attribution copied from review-call.mjs's attributionHeader, never a self-named model"],
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
  "bundle-verdict": {
    purpose: "The fail-closed six-value verdict `faff bundle verify` computes over a published Phase-0 recovery bundle — the independent check that a bundle is current, complete, well-formed, and untampered before FAFF-820/FAFF-823 trust it.",
    values: [
      { field: "verdict", enum: BUNDLE_VERDICTS, semantics: {
        CLEAN: "positively verified and current — the digests, tamper chains, and staleness check all passed",
        STALE: "internally valid but superseded by a later boundary in the same run segment — see superseded_by",
        MISSING: "the bundle, or a required member of it, could not be found at the derived store handle",
        MALFORMED: "the bundle was found but a required member could not even be parsed",
        TAMPERED: "the bundle parsed, but its digests/chains disagree with what it claims — the byte content was altered after publish",
        VERIFICATION_UNAVAILABLE: "no determination could be made (the store was unreachable or a read was denied) — never treated as clean",
      } },
      { field: "identity.boundary_kind", enum: BUNDLE_BOUNDARY_KINDS, semantics: {
        "issue-merge-floor": "a per-issue safe boundary, minted at graft Step 9b alongside `faff events anchor`",
        "run-close": "the run-level safe boundary, minted in git-only mode alongside `faff events anchor-run`",
      } },
    ],
    coercions: [
      "an out-of-enum verdict → coerced to VERIFICATION_UNAVAILABLE (never CLEAN — no guessing clean)",
      "a malformed identity (bad charset, missing field, boundary_kind/boundary_key mismatch) → flagged as a violation, not fail-loud — the verdict itself is still emitted with safe defaults",
      "verdict STALE with a null superseded_by, or a non-STALE verdict with a non-null superseded_by → flagged as a violation (the two fields must agree)",
      "the ONLY fail-loud (exit 2) case is a non-object extraction",
    ],
    producer_notes: ["`faff bundle verify` (bundle.js) computes the verdict via the pure classifyBundle ladder over already-fetched store bytes, then pipes its own output through this contract as a belt-and-braces conformance check before printing — the same self-validation contractSpecReadiness/contractLaneBoundary apply to their own producers' output."],
  },
  "recovery-disposition": {
    purpose: "The read-only recovery disposition `faff bundle-recover` computes for a fresh executor: reconstructed / noop-already-present / refused, over the most recent CLEAN Phase 0 recovery bundle discovered for an issue, with a resume-or-park preview.",
    values: [
      { field: "disposition", enum: RECOVERY_DISPOSITIONS, semantics: {
        reconstructed: "a CLEAN bundle was discovered, selected, and written to a fresh run directory — the resume_preview reports what a subsequent `faff lights-out --resume` would do",
        "noop-already-present": "the reconstruction target already exists with a byte-identical ledger — nothing new was written, the preview is still computed against what is already there",
        refused: "no reconstruction happened — a non-CLEAN bundle verdict, an unresolved discovery ambiguity, an identity conflict with an existing diverging ledger, or a store/discovery fault",
      } },
    ],
    coercions: [
      "a non-object extraction → fail-loud (exit 2) — nothing to re-derive from",
      "an out-of-enum disposition → coerced to refused (never guess reconstructed — no reconstruction is ever assumed on doubt)",
      "an out-of-enum bundle_verdict → coerced to VERIFICATION_UNAVAILABLE (never CLEAN)",
      "dry_run is optional and defaults to false when absent — a non-boolean dry_run is flagged as a violation. When true, this disposition was computed against a scratch --dry-run materialisation; the real root was left untouched even when disposition reads reconstructed",
      "bundle_verdict ≠ CLEAN paired with any disposition other than refused → flagged as a violation — this is the one directional safety property this contract enforces even against a hand-altered extraction: a non-CLEAN bundle can never read as reconstructed or noop-already-present",
      "disposition: reconstructed with a null run_dir or a null resume_preview → flagged as a violation (a claimed reconstruction must carry what it reconstructed)",
      "disposition: refused with a non-null run_dir → flagged as a violation (a refusal writes nothing, so it names no run directory)",
      "a malformed bundle_identity/resume_preview shape → flagged as a violation, not fail-loud — the disposition itself is still emitted with safe defaults",
    ],
    producer_notes: ["`faff bundle-recover` computes the disposition via its own pure cores (selectMostRecent, idempotencyDecision, reconstructResumePlan reused unforked from resume.js) over already-verified bundle bytes, then pipes its own output through this contract as a belt-and-braces conformance check before printing — never a live liveness check, never a forge call (see the verb's own no-gh-call invariant)."],
  },
  "scenario-record": {
    purpose: "The validation summary of one ScenarioRecord (schema:1) banked in the nine-scenario Phase 0 reference matrix — schema, required fields, the single canonical disposition, and the honest-claim invariants (E-B only when blocked, journal ≤ J-C on a producer-HMAC leg, organisational_independence always false, one_shot_control non-null only on the catch ordinals).",
    values: [
      { field: "disposition", enum: SCENARIO_RECORD_DISPOSITIONS, semantics: {
        accepted: "scenario 1 — a grant with the chain verified, `commissaire audit verify` clean, and no escaped effect",
        blocked: "scenario 2 — decideFloor refuses at the merge chokepoint (the one E-B prevention row)",
        refused: "scenario 3 — a forged grant fails `commissaire audit verify` / chokepointPermit",
        recovered: "scenario 4 — bundleRecover reconstructed or noop-already-present after a torn tail; a divergence refuses",
        denied: "scenario 5 — a request on stale evidence is denied, no grant written",
        detected: "scenario 6 — computeEscapes flags an observed effect covered by no declaration",
        parked: "scenario 7 — a budget window breach parks until window reset with a resume_at",
        amended: "scenario 8 — new-revision records verify while a stale-key record fails the auth leg",
        corrected: "scenario 9 — an idempotency match/conflict with a gap-free resumed seq and no duplicated work-item",
      } },
    ],
    coercions: [
      "a non-object extraction → fail-loud (exit 2) — nothing to validate",
      "every other problem is a flagged violation (conformant:false, exit 1), never a coerce — this validates faff's own emitter output, so a shape defect is surfaced rather than silently repaired",
      "assurance_vector.effect_class E-B with disposition ≠ blocked → flagged (E-B prevention is claimable only at the merge chokepoint)",
      "assurance_vector.journal_class J-A or J-B → flagged (producer authentication is at most J-C, mechanical detection never non-repudiation)",
      "assurance_vector.independence.organisational_independence ≠ false → flagged (Phase 0 proves key-custody mechanism only)",
      "one_shot_control present/absent disagreeing with the catch-ordinal rule {2,3,5,6} → flagged",
    ],
    producer_notes: ["The record is emitted by the pure `faff scenario-matrix record` emitter (scenario-matrix.js, region governance); this contract is the belt-and-braces re-validation a banked reader (or a clean-checkout replay) runs, mirroring recovery-disposition's own-output conformance idiom."],
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
      // evidence.main_recent_window / evidence.main_recent_failures (FAFF-1050) are free-form
      // Int|null / Object|null fields, not closed enums — like evidence.main_head_sha/main_ci_state
      // above them, they are documented in the schema (ci-triage.schema.json) and in ci-triage.js's
      // own comments, not here (the describe self-test's enum-coverage checks apply only to
      // enum-shaped fields).
    ],
    coercions: ["action is ALWAYS a pure function of transience/fault_domain/origin (deriveTriageAction) — a caller-supplied action that disagrees with the derived one is flagged as a violation, the derived action always governs (a forged/stale action can never widen past what the axes justify)", "an out-of-enum transience/fault_domain/origin → coerced to unknown", "evidence.main_recent_window: non-integer → coerced to null", "evidence.main_recent_failures: non-object, or non-integer values → coerced to null / filtered out — observational evidence, never fail-loud"],
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
      { field: "verdict", enum: SPEC_REVIEW_VERDICTS, semantics: { approve: "the spec is ready to build as written — carries no objections", revise: "fixable objections exist — the spec needs changes before it's build-ready", "reject-approach": "the whole approach is unsound — a different design is needed, not a patch", "needs-human": "a human judgement call the reviewer can't resolve on its own", unavailable: "a mandatory spec-review outage whose outaged lens(es) could swing the verdict — the reviewer was down, not a verdict about the spec; never coerced toward approve (FAFF-900)" } },
      // lens/severity are lintable:false: the reviewer producer must WRITE these labels while
      // classifying its own findings (a checklist dialect, like spec-readiness's markers) — not a
      // routing verdict a consumer branches on. `verdict` above stays lintable (the closed 5-value
      // routing enum every consumer pipes through `faff contract spec-review-verdict`).
      { field: "objections[].lens", enum: SPEC_REVIEW_LENSES, lintable: false, semantics: { architectural: "a structural/design-fit objection", infosec: "a security or privacy objection", methodology: "a delivery-process or sequencing objection", QA: "a testability or verification-coverage objection" } },
      { field: "objections[].severity", enum: SPEC_REVIEW_SEVERITIES, lintable: false, semantics: { blocker: "must be resolved before the spec can be built", major: "should be resolved but isn't necessarily build-blocking on its own", minor: "a nice-to-fix, not build-blocking" } },
      // FAFF-1157: the objection's resolution, mirroring review-verdict's findings[].disposition
      // (FAFF-1146) by reference — enum-checked, lintable:false (provenance the objection carries,
      // not a routing verdict a consumer branches on).
      { field: "objections[].disposition", enum: REVIEW_DISPOSITIONS, lintable: false, semantics: { fixed: "the objection was addressed by a spec revision", refuted: "the objection was challenged and shown not to hold", "accepted-risk": "the objection is valid but accepted as a known risk", open: "undecided at evidence-persist time (not emitted on the cleared-gate path this feature persists on)" } },
    ],
    coercions: ["an out-of-enum verdict → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this", "approve declared with any objections, or a non-approve verdict declared with zero objections → conformant:false", "an out-of-enum objection lens/severity → conformant:false (not fail-loud — an echoed bad value on a soft field)", "an out-of-enum objection disposition → conformant:false (exit 1, not fail-loud — an echoed bad value on an additive soft field, the value preserved verbatim); this contract is audit-only evidence, so it gates no merge"],
    producer_notes: ["refutation and disposition_rationale are optional free strings on an objection (no enum, no violation); `disposition_rationale` is the reasoning behind the disposition. FAFF-1157 persists these as anchored evidence at prep's terminal review seam — they are populated only on the judge path (which produces a correction/AFFIRM rationale); the refuter revise-loop path stamps `disposition:\"fixed\"` mechanically with no free text"],
  },
  "spec-judge-verdict": {
    purpose: "The spec-review judge's per-proposition ruling at the would-be-park point (FAFF-930): for ONE atomic disputed proposition, in the closed four-outcome vocabulary. Admission is the deterministic admit roll-up over the resolved ledger, never asserted by the judge.",
    values: [
      { field: "outcome", enum: SPEC_JUDGE_OUTCOMES, semantics: { AFFIRM_SPEC: "the reviewer has not established a material defect — resolved, no correction", UPHOLD_REVIEW: "the reviewer established a material defect; the required correction is bounded by the existing PRD — the orchestrator applies the correction, then it is resolved", SYNTHESIZE: "both positions contain valid reasoning; the judge specifies a third resolution composed SOLELY from claims already in A and B (cited via synthesis_sources) — applied, does not re-enter the refuter gate", PRD_BOUNDARY: "resolution needs a product/policy decision not derivable from the governing PRD — the only outcome that goes to a human, with a founded prd_gap_citation" } },
      // lens/severity are lintable:false and OPTIONAL: the ruling may echo the disputed proposition's
      // lens/severity for the audit log, but the judge is BLIND to them — they are not a routing verdict
      // a consumer branches on. `outcome` above stays lintable (the closed 4-value routing enum).
      { field: "lens", enum: SPEC_REVIEW_LENSES, lintable: false, semantics: { architectural: "a structural/design-fit objection", infosec: "a security or privacy objection", methodology: "a delivery-process or sequencing objection", QA: "a testability or verification-coverage objection" } },
      { field: "severity", enum: SPEC_REVIEW_SEVERITIES, lintable: false, semantics: { blocker: "must be resolved before the spec can be built", major: "should be resolved but isn't necessarily build-blocking on its own", minor: "a nice-to-fix, not build-blocking" } },
    ],
    coercions: ["an out-of-enum outcome → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this", "AFFIRM_SPEC with a correction/synthesis_sources/prd_gap_citation, UPHOLD_REVIEW/SYNTHESIZE missing a correction or a >=24-char verification literal, SYNTHESIZE with an empty synthesis_sources or a source outside {A,B}, or PRD_BOUNDARY with an empty prd_gap_citation → conformant:false", "an out-of-enum echoed lens/severity → conformant:false (not fail-loud — an echoed bad value on a soft field)"],
    producer_notes: [],
  },
  "build-judge-verdict": {
    purpose: "The build-review judge's per-finding ruling at the would-be-park point (FAFF-996): for ONE critical requiring adjudication, in a closed three-outcome vocabulary. No SYNTHESIZE (the code is already written) and no correction object (a build judge never edits an artifact — a fix is the author's separate re-review path). Admission is the deterministic admit roll-up over the resolved ledger, never asserted by the judge.",
    values: [
      { field: "outcome", enum: BUILD_JUDGE_OUTCOMES, semantics: { OVERTURN: "the finding is not a material defect — resolved, admits without a rationale requirement", UPHOLD: "the finding is a material defect and stands — parks to a human", PRODUCT_BOUNDARY: "resolution needs a product or policy decision not derivable from the AC — parks to a human, with a founded product_gap_citation" } },
    ],
    coercions: ["an out-of-enum outcome → fail-loud (exit 2) — no safe coerce target, faff's own producer emits this", "UPHOLD with an empty rationale, PRODUCT_BOUNDARY with an empty rationale or product_gap_citation, or OVERTURN with a non-empty product_gap_citation → conformant:false", "an empty finding_id → conformant:false"],
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
      { field: "aggregate", enum: HOLDOUT_AGGREGATES, semantics: { "meets-spec": "every judged criterion met — the only aggregate that passes the merge gate. It does not mean the whole DoD was met: criteria listed in delegated[] are not judged here, and delegated prose DONE items rest on the builder-written AC checklist and the review leg (FAFF-1339 will check each delegated ac_id has a passed checklist row)", gaps: "a mix of met and unmet criteria", fails: "every judged criterion unmet", "needs-human": "at least one criterion needs human judgement, or nothing was judged at all" } },
      // class/verdict are lintable:false: the evaluator producer must WRITE these labels while
      // classifying and judging each of its own criteria (the DoD-classification dialect it
      // produces via `faff dod classify`) — not a routing verdict a consumer branches on.
      // `aggregate` above stays lintable (the closed 4-value routing enum the merge floor reads).
      { field: "criteria[].class", enum: HOLDOUT_CLASSES, lintable: false, semantics: { scenario: "an end-to-end behavioural scenario from the spec's DoD", assertion: "a narrower, machine-checkable assertion", prose: "a Scenarios unit that can't be machine-judged — its verdict MUST be needs-human, never machine-decided. A prose DONE item is not judged at all: faff dod classify tiers it delegated and it appears in delegated[] with the verifier ac-checklist" } },
      { field: "criteria[].verdict", enum: HOLDOUT_VERDICTS, lintable: false, semantics: { met: "the criterion was verified satisfied, with evidence", unmet: "the criterion was verified unsatisfied, with evidence", "needs-human": "the criterion could not be machine-judged (mandatory for class:prose)" } },
    ],
    coercions: [
      "an out-of-enum aggregate → coerced to needs-human (never meets-spec)",
      "code_blind ≠ true → conformant:false — a non-blind verdict is structurally inadmissible regardless of aggregate (exit 0 requires code_blind:true AND the aggregate matching the criteria's derivation)",
      "a class:prose criterion with verdict ≠ needs-human → conformant:false (prose is never machine-judged)",
      "a class:prose criterion with a done:N id in criteria → conformant:false (a prose DONE item is delegated to the AC checklist, never judged)",
      "a delegated[] row that is malformed, pairs a tier with the wrong verifier (delegated with ac-checklist, integration with review-merge-floor), gives a delegated-tier row a scenarios:N id, or repeats an id, or an id present in both criteria and delegated → conformant:false",
      "a met/unmet criterion with evidence_present:false → conformant:false (no evidence, no verdict)",
      "the declared aggregate disagreeing with the derivation from criteria (deriveHoldoutAggregate) → conformant:false",
    ],
    producer_notes: [
      "FAFF-384 spawner attestation: when the run's lane-boundary cage promise requires it (`--require-spawner-attested`), a self-attested (non-spawner-derived) code_blind:true is refused at this contract's gate, not merely by prose instruction",
      "FAFF-1291 delegation: the optional delegated[] lists every criterion the holdout did not judge with its verifier; the writer fills it from faff dod classify, never the evaluator. meets-spec means every judged criterion was met; delegated prose DONE items rest on the builder-written AC checklist and the review leg, and FAFF-1339 adds the check that each delegated ac_id has a passed checklist row",
    ],
  },
  "lane-boundary": {
    purpose: "The versioned intent an orchestrator authors declaring what physical isolation boundary a dispatched lane (evaluator or build) needs — a DECLARATION of intent, never itself a trust source (the physical assert-in check is `faff evaluator-preflight`).",
    values: [
      { field: "lane", enum: LANE_BOUNDARY_LANES, semantics: { evaluator: "the code-blind holdout evaluator lane", build: "the dispatched build lane — its valid boundary flips laneBoundaryDispatchState to 'dispatched' (custody required) but can NEVER arm the evaluator cage (laneBoundaryPromisesCage stays keyed on lane === 'evaluator')" } },
      { field: "container", enum: LANE_BOUNDARY_CONTAINERS, semantics: { shared: "runs inside the same container as the builder", own: "runs in its own separate container" } },
      { field: "host", enum: LANE_BOUNDARY_HOST, semantics: { local: "the lane runs on the same host as the orchestrator", remote: "the lane runs on a separate host (declaration-only until FAFF-817's transport slot supplies the remote-observation seam)" } },
      { field: "accesses.repo", enum: LANE_BOUNDARY_ACCESS, semantics: { absent: "the repo is provably withheld from this lane", present: "the repo is accessible to this lane" } },
      { field: "accesses.host_socket", enum: LANE_BOUNDARY_ACCESS, semantics: { absent: "the host socket is provably withheld from this lane", present: "the host socket is accessible to this lane" } },
    ],
    coercions: ["version < 1 or non-integer, an out-of-enum lane/container/host/accesses.*, a missing accesses object, or a non-boolean integrity_signal → conformant:false (never fail-loud — the only fail-loud case is a non-object extraction)"],
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

module.exports = { CONTRACT_DESCRIBES, renderContractDescribeMarkdown, renderContractDescribeJson, describeChecks };
