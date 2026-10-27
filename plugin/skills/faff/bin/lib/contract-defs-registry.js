// ===========================================================================
// === region:factory — contract-defs-registry — contract definitions: the CONTRACTS registry (run + selftest fixtures per contract) with its describe entries attached ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { contractArchitectureProposal, contractBuildJudgeVerdict, contractReviewVerdict, contractSpecJudgeVerdict, contractSpecReadiness, contractSpecReviewVerdict } = require("./contract-defs-review");
const { contractAutomationRouting, contractCiTriage, contractDeliveryOutcome, contractEnvHandle, contractPostMergeVerification, contractQualityGates } = require("./contract-defs-delivery");
const { contractAdrAdmission, contractPrdCoverage, contractPrdDistance, contractPrdReadiness, contractPrdrAdmission, contractPrdrYagni } = require("./contract-defs-prd");
const { contractBundleVerdict, contractHoldoutVerdict, contractLaneBoundary, contractRecoveryDispositionVerdict, contractScenarioRecordVerdict } = require("./contract-defs-evidence");
const { contractL4TopologyEnvelope, contractRunTermination, contractRunTrigger } = require("./contract-defs-run");
const { contractIntegrityFloor } = require("./contract-defs-floor");
const { CONTRACT_DESCRIBES } = require("./contract-defs-describe");


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
      // FAFF-892: the digest-verified custody GRANT is non-blocking at L4 (the fix that lets a
      // runbook-correct honest-absence L4 run merge on the digest basis) and below L4.
      { name: "l4-integrity-custody-trusted-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", integrity: "custody-trusted" }, wantExit: 0 },
      { name: "integrity-custody-trusted-ok-at-L3", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", integrity: "custody-trusted" }, wantExit: 0 },
      { name: "fail-loud-bad-integrity", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", integrity: "maybe" }, wantExit: 2 },
      // FAFF-828: the Commissaire decision leg. Absent defaults to not-applicable (a no-op — an
      // ordinary ungoverned merge is byte-for-byte unaffected); a valid-grant passes; only
      // absent-or-invalid blocks; an out-of-enum value fails loud.
      { name: "decision-grant-absent-is-a-no-op", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 0 },
      { name: "decision-grant-valid-merge-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", decision_grant: "valid-grant" }, wantExit: 0 },
      { name: "decision-grant-absent-or-invalid-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", decision_grant: "absent-or-invalid" }, wantExit: 1 },
      { name: "fail-loud-bad-decision-grant", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", decision_grant: "maybe" }, wantExit: 2 },
      // FAFF-1077: the stacked-dependency interlock leg. Absent defaults to not-applicable (a no-op —
      // an ordinary non-stacked merge is byte-for-byte unaffected — the decidability property the
      // byte-identical-when-absent DoD item pins); satisfied passes; only blocked refuses; an
      // out-of-enum value fails loud.
      { name: "dependency-gate-absent-is-a-no-op", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 0 },
      { name: "dependency-gate-not-applicable-merge-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", dependency_gate: "not-applicable" }, wantExit: 0 },
      { name: "dependency-gate-satisfied-merge-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", dependency_gate: "satisfied" }, wantExit: 0 },
      { name: "dependency-gate-blocked-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", dependency_gate: "blocked" }, wantExit: 1 },
      { name: "fail-loud-bad-dependency-gate", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", dependency_gate: "maybe" }, wantExit: 2 },
      { name: "fail-loud-bad-ci-state", in: { ac_complete: true, review_verdict: "pass", ci_state: "greenish", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-bad-level", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L9", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-non-boolean-ac", in: { ac_complete: "yes", review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
      // FAFF-1072: the absent-integrity default now keys on the run facts (unattended ∧ not-dispatched),
      // not the L4 label. All fixtures above are byte-for-byte unaffected (L4 ⇒ unattended:true +
      // dispatch_state:"absent" ⇒ refuse; below-L4 ⇒ unattended:false ⇒ ok); these add the new cells.
      { name: "l3-unattended-top-level-absent-integrity-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", unattended: true, dispatch_state: "absent" }, wantExit: 1 },
      { name: "l3-unattended-dispatched-absent-integrity-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", unattended: true, dispatch_state: "dispatched" }, wantExit: 0 },
      { name: "l3-attended-top-level-absent-integrity-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", unattended: false, dispatch_state: "absent" }, wantExit: 0 },
      { name: "l4-dispatched-absent-integrity-ok-detective-owns-it", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "meets-spec", unattended: true, dispatch_state: "dispatched" }, wantExit: 0 },
      { name: "fail-loud-bad-unattended", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", unattended: "yes" }, wantExit: 2 },
      { name: "fail-loud-bad-dispatch-state", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", dispatch_state: "maybe" }, wantExit: 2 },
      // FAFF-1040: the holdout leg now blocks on the resolved POSTURE (a run fact), not the L4 label.
      // The level-aware back-compat default (absent posture ⇒ L4 → strict, else pass-through) keeps
      // every fixture above byte-for-byte; these add the new cells and prove pass-through/offer never
      // block. All carry integrity:"asserted" + unattended/dispatched so the holdout leg is the sole
      // variable, isolated from the FAFF-690/1072 integrity legs.
      { name: "holdout-strict-missing-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", holdout_posture: "strict", integrity: "asserted" }, wantExit: 1 },
      { name: "holdout-strict-meets-spec-merge-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "meets-spec", holdout_posture: "strict", integrity: "asserted" }, wantExit: 0 },
      { name: "holdout-pass-through-missing-is-a-no-op", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", holdout_posture: "pass-through", integrity: "asserted" }, wantExit: 0 },
      { name: "holdout-posture-absent-l4-defaults-strict-refuses", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L4", holdout: "missing", integrity: "asserted", unattended: true, dispatch_state: "dispatched" }, wantExit: 1 },
      { name: "holdout-posture-absent-l3-defaults-pass-through-ok", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", integrity: "asserted" }, wantExit: 0 },
      { name: "holdout-missing-list-carried-does-not-block", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", holdout_posture: "pass-through", holdout_missing: ["no-proven-cage"], integrity: "asserted" }, wantExit: 0 },
      { name: "holdout-fault-list-carried-strict-still-blocks", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "missing", holdout_posture: "strict", holdout_fault: ["env-handle-terminated"], integrity: "asserted" }, wantExit: 1 },
      { name: "fail-loud-bad-holdout-posture", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", holdout_posture: "maybe" }, wantExit: 2 },
      { name: "fail-loud-bad-holdout-missing", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", holdout_missing: "nope" }, wantExit: 2 },
      { name: "fail-loud-bad-holdout-fault", in: { ac_complete: true, review_verdict: "pass", ci_state: "ci-green", head_sha_matches: true, level: "L3", holdout: "not-applicable", holdout_fault: [1, 2] }, wantExit: 2 },
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
      // FAFF-1146: enriched-finding cases (additive, non-gating). A legacy {location_present,
      // action_present}-only finding stays covered by "conformant" above.
      { name: "enriched-conformant-with-source", in: { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "major", refutation: "node --check passed on the cited file", disposition: "refuted", source: "adversarial", model: "gemini/gemini-2.0" }] }, wantExit: 0 },
      { name: "adversarial-observation-open-conformant", in: { signal: "pass", findings: [{ location_present: true, action_present: true, severity: "observation", source: "adversarial", disposition: "open" }] }, wantExit: 0 },
      { name: "disposition-rationale-present", in: { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "minor", disposition: "accepted-risk", disposition_rationale: "low blast radius, tracked as a follow-up" }] }, wantExit: 0 },
      { name: "disposition-rationale-absent-still-valid", in: { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "minor", disposition: "accepted-risk" }] }, wantExit: 0 },
      { name: "out-of-enum-severity", in: { signal: "fail", findings: [{ location_present: true, action_present: true, severity: "catastrophic" }] }, wantExit: 1 },
      { name: "out-of-enum-disposition", in: { signal: "fail", findings: [{ location_present: true, action_present: true, disposition: "deferred" }] }, wantExit: 1 },
      { name: "out-of-enum-source", in: { signal: "fail", findings: [{ location_present: true, action_present: true, source: "external" }] }, wantExit: 1 },
      { name: "non-string-refutation-omitted", in: { signal: "fail", findings: [{ location_present: true, action_present: true, refutation: 42 }] }, wantExit: 0 },
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
  "bundle-verdict": {
    run: contractBundleVerdict,
    fixtures: [
      { name: "conformant-clean", in: { verdict: "CLEAN", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "clean", superseded_by: null }, wantExit: 0 },
      { name: "conformant-tampered", in: { verdict: "TAMPERED", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "manifest-digest", superseded_by: null }, wantExit: 0 },
      { name: "conformant-stale-with-superseded-by", in: { verdict: "STALE", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "superseded", superseded_by: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-2", boundary_seq: 1 } }, wantExit: 0 },
      { name: "conformant-verification-unavailable", in: { verdict: "VERIFICATION_UNAVAILABLE", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: 3 }, cause: "store-unreachable", superseded_by: null }, wantExit: 0 },
      { name: "stale-missing-superseded-by-flagged", in: { verdict: "STALE", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "superseded", superseded_by: null }, wantExit: 1 },
      { name: "non-stale-with-superseded-by-flagged", in: { verdict: "CLEAN", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "clean", superseded_by: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-2", boundary_seq: 1 } }, wantExit: 1 },
      { name: "coerce-bad-verdict", in: { verdict: "MAYBE_CLEAN", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "x", superseded_by: null }, wantExit: 1 },
      { name: "malformed-identity-flagged", in: { verdict: "MISSING", identity: { run_id: "../etc", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "ledger_snapshot", superseded_by: null }, wantExit: 1 },
      { name: "run-close-boundary-key-mismatch-flagged", in: { verdict: "CLEAN", identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "run-close", boundary_key: "FAFF-1", boundary_seq: 0 }, cause: "clean", superseded_by: null }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "recovery-disposition": {
    run: contractRecoveryDispositionVerdict,
    fixtures: [
      { name: "conformant-reconstructed", in: { verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "CLEAN", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "reconstructed from a CLEAN Phase 0 recovery bundle", resume_preview: { skip: ["FAFF-1"], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 1 }, wantExit: 0 },
      { name: "conformant-reconstructed-dry-run", in: { verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "CLEAN", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "dry-run — would reconstruct and preview the resume plan; the real root was left untouched", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 1, dry_run: true }, wantExit: 0 },
      { name: "dry-run-defaults-false-when-absent", in: { verb: "bundle-recover", disposition: "noop-already-present", bundle_verdict: "CLEAN", bundle_identity: null, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "x", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 0 }, wantExit: 0 },
      { name: "fail-loud-bad-dry-run-type", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "MISSING", bundle_identity: null, run_id: "", run_dir: null, boundary_kind: "issue-merge-floor", reason: "x", resume_preview: null, candidates_considered: 0, dry_run: "yes" }, wantExit: 1 },
      { name: "conformant-noop-already-present", in: { verb: "bundle-recover", disposition: "noop-already-present", bundle_verdict: "CLEAN", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "already reconstructed, byte-identical", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 1 }, wantExit: 0 },
      { name: "conformant-refused-missing", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "MISSING", bundle_identity: null, run_id: "", run_dir: null, boundary_kind: "issue-merge-floor", reason: "no bundle for FAFF-1 in the local store", resume_preview: null, candidates_considered: 0 }, wantExit: 0 },
      { name: "conformant-refused-stale", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "STALE", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: null, boundary_kind: "issue-merge-floor", reason: "superseded_by FAFF-2", resume_preview: null, candidates_considered: 2 }, wantExit: 0 },
      { name: "conformant-refused-verification-unavailable", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "VERIFICATION_UNAVAILABLE", bundle_identity: null, run_id: "", run_dir: null, boundary_kind: "issue-merge-floor", reason: "store unreachable", resume_preview: null, candidates_considered: 0 }, wantExit: 0 },
      { name: "non-clean-verdict-with-reconstructed-flagged", in: { verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "STALE", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "x", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 1 }, wantExit: 1 },
      { name: "coerce-bad-disposition", in: { verb: "bundle-recover", disposition: "maybe", bundle_verdict: "CLEAN", bundle_identity: null, run_id: "run-1", run_dir: null, boundary_kind: "issue-merge-floor", reason: "x", resume_preview: null, candidates_considered: 0 }, wantExit: 1 },
      { name: "coerce-bad-bundle-verdict", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "SORT_OF_CLEAN", bundle_identity: null, run_id: "", run_dir: null, boundary_kind: "issue-merge-floor", reason: "x", resume_preview: null, candidates_considered: 0 }, wantExit: 1 },
      { name: "reconstructed-missing-run-dir-flagged", in: { verb: "bundle-recover", disposition: "reconstructed", bundle_verdict: "CLEAN", bundle_identity: { run_id: "run-1", run_segment_id: 0, boundary_kind: "issue-merge-floor", boundary_key: "FAFF-1", boundary_seq: 0 }, run_id: "run-1", run_dir: null, boundary_kind: "issue-merge-floor", reason: "x", resume_preview: { skip: [], continue_review: [], continue_from_push: [], redispatch: [], park: [], terminal: [], drain_remainder: true }, candidates_considered: 1 }, wantExit: 1 },
      { name: "refused-with-non-null-run-dir-flagged", in: { verb: "bundle-recover", disposition: "refused", bundle_verdict: "STALE", bundle_identity: null, run_id: "run-1", run_dir: "/root/.faff/runs/run-1", boundary_kind: "issue-merge-floor", reason: "x", resume_preview: null, candidates_considered: 1 }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "scenario-record": {
    run: contractScenarioRecordVerdict,
    fixtures: [
      { name: "conformant-accepted", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: { audit_verify: { exit: 0, producer: { verified: 1, unverifiable_without_secret: 0, failed: 0 }, decisions_valid: true } }, evidence_paths: ["declared-effects.jsonl"], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-C", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "J-C mechanical auth; E-C detection", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 0 },
      { name: "conformant-blocked-with-control", in: { schema: 1, scenario_id: "02-governance-block", scenario_ordinal: 2, inputs: {}, environment: {}, run_id: "RUN-COM-02", work_item_id: "FAFF-2", disposition: "blocked", disposition_basis: { floor_verdict: { verdict: "refuse", blockers: ["x"] } }, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-D", effect_class: "E-B", independence: { key_custody_split: true, author_binding: false, process_independence: false, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "E-B prevention at the merge chokepoint", one_shot_control: { ungoverned_shipped: true, artifact_ref: "merged main", governed_disposition: "blocked" }, two_custodian_split_verified: true }, wantExit: 0 },
      { name: "conformant-parked", in: { schema: 1, scenario_id: "07-exhausted-budget", scenario_ordinal: 7, inputs: {}, environment: {}, run_id: "RUN-COM-07", work_item_id: "FAFF-7", disposition: "parked", disposition_basis: { budget_outcome: "park-until-window-reset" }, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-D", effect_class: "E-D", independence: { key_custody_split: true, author_binding: false, process_independence: false, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "budget park until window reset", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 0 },
      { name: "eb-on-non-blocked-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-B", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 1 },
      { name: "journal-above-jc-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-A", effect_class: "E-C", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 1 },
      { name: "organisational-independence-true-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-C", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: true }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 1 },
      { name: "control-on-non-catch-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-C", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: { ungoverned_shipped: true, artifact_ref: "x", governed_disposition: "accepted" }, two_custodian_split_verified: true }, wantExit: 1 },
      { name: "missing-control-on-catch-flagged", in: { schema: 1, scenario_id: "05-stale-evidence", scenario_ordinal: 5, inputs: {}, environment: {}, run_id: "RUN-COM-05", work_item_id: "FAFF-5", disposition: "denied", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-D", effect_class: "E-C", independence: { key_custody_split: true, author_binding: false, process_independence: false, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 1 },
      { name: "split-not-verified-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "accepted", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-C", independence: { key_custody_split: false, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: false }, wantExit: 1 },
      { name: "bad-disposition-flagged", in: { schema: 1, scenario_id: "01-normal-completion", scenario_ordinal: 1, inputs: {}, environment: {}, run_id: "RUN-COM-01", work_item_id: "FAFF-1", disposition: "maybe", disposition_basis: {}, evidence_paths: [], human_interventions: 0, cost: {}, assurance_vector: { journal_class: "J-C", effect_class: "E-C", independence: { key_custody_split: true, author_binding: true, process_independence: true, organisational_independence: false }, isolation: "fixture", review: "mechanical" }, claim_label: "x", one_shot_control: null, two_custodian_split_verified: true }, wantExit: 1 },
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
      { name: "main-was-red-via-history-carries-evidence", in: { pr: 11, head_sha: "a11", transience: "unknown", fault_domain: "unknown", origin: "main-was-red", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: "m11", main_ci_state: "ci-green", main_recent_window: 8, main_recent_failures: { "validate-macos": 3 }, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 0 },
      { name: "history-unreadable-evidence-nulls", in: { pr: 12, head_sha: "a12", transience: "unknown", fault_domain: "unknown", origin: "mine", action: "park-needs-human", evidence: { reruns_used: 0, main_head_sha: "m12", main_ci_state: "ci-green", main_recent_window: null, main_recent_failures: null, fault_domain_source: "none", flaky_signatures: [] } }, wantExit: 0 },
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
      // FAFF-900: unavailable (a mandatory spec-review outage that could swing the verdict) is
      // treated like every other non-approve verdict — it must carry the outaged lens(es) as
      // objections, and it is never a safe coerce target for an out-of-enum verdict.
      { name: "conformant-unavailable", in: { verdict: "unavailable", objections: [{ lens: "infosec", severity: "major" }] }, wantExit: 0 },
      { name: "approve-with-objections", in: { verdict: "approve", objections: [{ lens: "infosec", severity: "major" }] }, wantExit: 1 },
      { name: "non-approve-no-objections", in: { verdict: "reject-approach", objections: [] }, wantExit: 1 },
      { name: "unavailable-no-objections", in: { verdict: "unavailable", objections: [] }, wantExit: 1 },
      // FAFF-951: `approve` is gated on a recorded review round via the consumer-supplied
      // round_recorded input (mirrors provenance_present at line 46). An explicit false is
      // non-conformant (exit 1); true is conformant; an absent field adds no violation (the
      // conformant-approve fixture above still exits 0), so the gate is backward-compatible and
      // only bites a caller that reports "no round recorded".
      { name: "approve-no-round-record", in: { verdict: "approve", objections: [], round_recorded: false }, wantExit: 1 },
      { name: "approve-with-round-record", in: { verdict: "approve", objections: [], round_recorded: true }, wantExit: 0 },
      { name: "bad-lens", in: { verdict: "revise", objections: [{ lens: "vibes", severity: "major" }] }, wantExit: 1 },
      { name: "bad-severity", in: { verdict: "needs-human", objections: [{ lens: "methodology", severity: "huge" }] }, wantExit: 1 },
      // FAFF-935: the OPTIONAL enrichment triple {claim, evidence, predicted_consequence} is
      // additive — a triple-carrying objection is conformant, a non-string triple field adds no
      // violation (dropped), and a legacy {lens, severity}-only objection still validates (above).
      { name: "conformant-triple", in: { verdict: "revise", objections: [{ lens: "architectural", severity: "major", claim: "C", evidence: "E", predicted_consequence: "P" }] }, wantExit: 0 },
      { name: "conformant-triple-taste-sentinel", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", claim: "less elegant", evidence: "sec 3", predicted_consequence: "not separately stated" }] }, wantExit: 0 },
      { name: "conformant-triple-non-string-dropped", in: { verdict: "revise", objections: [{ lens: "infosec", severity: "major", claim: "auth bypass", evidence: 42 }] }, wantExit: 0 },
      // FAFF-943: the OPTIONAL spec_anchor (attacked section's heading slug) is additive beside
      // the triple — triple+anchor, anchor-only, an empty-string anchor (carried verbatim), and a
      // non-string anchor (dropped) all validate exit 0 with the {lens, severity} gate unchanged.
      { name: "conformant-triple-plus-anchor", in: { verdict: "revise", objections: [{ lens: "architectural", severity: "major", claim: "C", evidence: "E", predicted_consequence: "P", spec_anchor: "aggregation-carry-the-anchor" }] }, wantExit: 0 },
      { name: "conformant-anchor-only", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", spec_anchor: "phase-2-revised" }] }, wantExit: 0 },
      { name: "conformant-anchor-empty-string", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", spec_anchor: "" }] }, wantExit: 0 },
      { name: "conformant-anchor-non-string-dropped", in: { verdict: "revise", objections: [{ lens: "infosec", severity: "major", claim: "auth bypass", spec_anchor: 42 }] }, wantExit: 0 },
      // FAFF-1157: the OPTIONAL resolution triple {disposition (enum), refutation, disposition_rationale}
      // mirrors FAFF-1146's review-verdict finding enrichment — a disposition-bearing objection is
      // conformant, an out-of-enum disposition is a soft violation (exit 1, value preserved), and the
      // free strings add no violation. A legacy {lens, severity}-only objection still validates (above).
      { name: "conformant-disposition-fixed", in: { verdict: "revise", objections: [{ lens: "architectural", severity: "major", disposition: "fixed" }] }, wantExit: 0 },
      { name: "conformant-disposition-triple", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", disposition: "refuted", refutation: "the objection did not hold", disposition_rationale: "the spec already covered it" }] }, wantExit: 0 },
      { name: "conformant-disposition-accepted-risk", in: { verdict: "reject-approach", objections: [{ lens: "infosec", severity: "blocker", disposition: "accepted-risk", disposition_rationale: "accepted as a known risk" }] }, wantExit: 0 },
      { name: "conformant-disposition-rationale-non-string-dropped", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", disposition: "fixed", disposition_rationale: 42 }] }, wantExit: 0 },
      { name: "out-of-enum-disposition", in: { verdict: "revise", objections: [{ lens: "QA", severity: "minor", disposition: "bogus" }] }, wantExit: 1 },
      { name: "fail-loud-bad-verdict", in: { verdict: "meh", objections: [] }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "spec-judge-verdict": {
    run: contractSpecJudgeVerdict,
    fixtures: [
      { name: "conformant-affirm", in: { proposition_id: "p-01", outcome: "AFFIRM_SPEC", rationale: "the reviewer has not established a material defect", correction: null, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 0 },
      { name: "conformant-uphold", in: { proposition_id: "p-01", outcome: "UPHOLD_REVIEW", rationale: "a material defect is established", correction: { summary: "refuse the empty --dir case", verification: "an empty --dir is refused with a founded error" }, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 0 },
      { name: "conformant-synthesize", in: { proposition_id: "p-02", outcome: "SYNTHESIZE", rationale: "both positions have valid reasoning", correction: { summary: "compose A and B", verification: "combine the guard from A with the bound from B" }, synthesis_sources: ["A", "B"], prd_gap_citation: "" }, wantExit: 0 },
      { name: "conformant-prd-boundary", in: { proposition_id: "p-03", outcome: "PRD_BOUNDARY", rationale: "needs a product decision", correction: null, synthesis_sources: [], prd_gap_citation: "the PRD does not bound the MVP-vs-production line for this behaviour" }, wantExit: 0 },
      { name: "affirm-with-correction", in: { proposition_id: "p-01", outcome: "AFFIRM_SPEC", rationale: "", correction: { summary: "x", verification: "this correction should not be present here at all" }, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 1 },
      { name: "uphold-missing-correction", in: { proposition_id: "p-01", outcome: "UPHOLD_REVIEW", rationale: "defect", correction: null, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 1 },
      { name: "uphold-short-verification", in: { proposition_id: "p-01", outcome: "UPHOLD_REVIEW", rationale: "defect", correction: { summary: "s", verification: "tooshort" }, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 1 },
      { name: "synthesize-source-outside-ab", in: { proposition_id: "p-02", outcome: "SYNTHESIZE", rationale: "both valid", correction: { summary: "compose", verification: "combine the guard from A with the bound from B" }, synthesis_sources: ["A", "C"], prd_gap_citation: "" }, wantExit: 1 },
      { name: "prd-boundary-empty-citation", in: { proposition_id: "p-03", outcome: "PRD_BOUNDARY", rationale: "needs a decision", correction: null, synthesis_sources: [], prd_gap_citation: "" }, wantExit: 1 },
      { name: "bad-lens", in: { proposition_id: "p-01", outcome: "AFFIRM_SPEC", rationale: "", correction: null, synthesis_sources: [], prd_gap_citation: "", lens: "vibes" }, wantExit: 1 },
      { name: "bad-severity", in: { proposition_id: "p-01", outcome: "AFFIRM_SPEC", rationale: "", correction: null, synthesis_sources: [], prd_gap_citation: "", severity: "huge" }, wantExit: 1 },
      { name: "fail-loud-bad-outcome", in: { proposition_id: "p-01", outcome: "ESCALATE_UNCERTAIN", upheld: [] }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "build-judge-verdict": {
    run: contractBuildJudgeVerdict,
    fixtures: [
      { name: "conformant-overturn", in: { finding_id: "spec-judge-casefile.js::the admitrollup change is missing", outcome: "OVERTURN", rationale: "", product_gap_citation: "" }, wantExit: 0 },
      { name: "conformant-uphold", in: { finding_id: "casefile.js::stale export", outcome: "UPHOLD", rationale: "the export list omits the new helper — a material defect", product_gap_citation: "" }, wantExit: 0 },
      { name: "conformant-product-boundary", in: { finding_id: "config.js::default retry limit", outcome: "PRODUCT_BOUNDARY", rationale: "needs a product decision on the default", product_gap_citation: "the AC does not specify a default retry limit" }, wantExit: 0 },
      { name: "uphold-missing-rationale", in: { finding_id: "a.js::x", outcome: "UPHOLD", rationale: "", product_gap_citation: "" }, wantExit: 1 },
      { name: "product-boundary-missing-citation", in: { finding_id: "a.js::x", outcome: "PRODUCT_BOUNDARY", rationale: "needs a decision", product_gap_citation: "" }, wantExit: 1 },
      { name: "product-boundary-missing-rationale", in: { finding_id: "a.js::x", outcome: "PRODUCT_BOUNDARY", rationale: "", product_gap_citation: "the AC is silent here" }, wantExit: 1 },
      { name: "overturn-with-citation", in: { finding_id: "a.js::x", outcome: "OVERTURN", rationale: "", product_gap_citation: "should be empty" }, wantExit: 1 },
      { name: "fail-loud-bad-outcome", in: { finding_id: "a.js::x", outcome: "SYNTHESIZE" }, wantExit: 2 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
      { name: "empty-finding-id", in: { finding_id: "", outcome: "OVERTURN", rationale: "", product_gap_citation: "" }, wantExit: 1 },
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
      // FAFF-1291 delegation rules.
      { name: "delegated-prose-done-in-criteria", in: { aggregate: "needs-human", code_blind: true, criteria: [{ id: "done:2", class: "prose", verdict: "needs-human", evidence_present: false }] }, wantExit: 1 },
      { name: "delegated-prose-scenario-needs-human", in: { aggregate: "needs-human", code_blind: true, criteria: [{ id: "scenarios:2", class: "prose", verdict: "needs-human", evidence_present: false }] }, wantExit: 0 },
      { name: "delegated-prose-scenario-met", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ id: "scenarios:2", class: "prose", verdict: "met", evidence_present: true }] }, wantExit: 1 },
      { name: "delegated-conformant-meets-spec", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ id: "scenarios:1", class: "scenario", verdict: "met", evidence_present: true }], delegated: [{ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: "faff-1#ac-1" }, { id: "done:2", text: "t", holdout: false, verification_tier: "integration", verifier: "review-merge-floor", ac_id: null }] }, wantExit: 0 },
      { name: "delegated-id-in-both-lists", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ id: "done:1", class: "assertion", verdict: "met", evidence_present: true }], delegated: [{ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: null }] }, wantExit: 1 },
      { name: "delegated-wrong-verifier-pairing", in: { aggregate: "needs-human", code_blind: true, criteria: [], delegated: [{ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "review-merge-floor", ac_id: null }] }, wantExit: 1 },
      { name: "delegated-tier-with-scenarios-id", in: { aggregate: "needs-human", code_blind: true, criteria: [], delegated: [{ id: "scenarios:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: null }] }, wantExit: 1 },
      { name: "delegated-empty-criteria-needs-human", in: { aggregate: "needs-human", code_blind: true, criteria: [], delegated: [{ id: "done:1", text: "t", holdout: false, verification_tier: "delegated", verifier: "ac-checklist", ac_id: null }] }, wantExit: 0 },
      // FAFF-1292 reason_code cross-field rules.
      { name: "reason-code-no-surface-conformant", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "no-surface" }] }, wantExit: 0 },
      { name: "reason-code-human-only-prose-conformant", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "prose", verdict: "needs-human", evidence_present: false, reason_code: "human-only" }] }, wantExit: 0 },
      { name: "reason-code-absent-needs-human-tolerated", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "assertion", verdict: "needs-human", evidence_present: false }] }, wantExit: 0 },
      { name: "reason-code-out-of-enum", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "bogus" }] }, wantExit: 1 },
      { name: "reason-code-on-met", in: { aggregate: "meets-spec", code_blind: true, criteria: [{ class: "assertion", verdict: "met", evidence_present: true, reason_code: "no-surface" }] }, wantExit: 1 },
      { name: "reason-code-prose-not-human-only", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "prose", verdict: "needs-human", evidence_present: false, reason_code: "no-surface" }] }, wantExit: 1 },
      { name: "reason-code-born-verifiable-human-only", in: { aggregate: "needs-human", code_blind: true, criteria: [{ class: "assertion", verdict: "needs-human", evidence_present: false, reason_code: "human-only" }] }, wantExit: 1 },
      { name: "fail-loud-non-object", in: "not an object", wantExit: 2 },
    ],
  },
  "lane-boundary": {
    run: contractLaneBoundary,
    fixtures: [
      { name: "conformant-evaluator-own", in: { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 0 },
      { name: "conformant-shared-present", in: { version: 2, lane: "evaluator", container: "shared", host: "local", accesses: { repo: "present", host_socket: "present" }, integrity_signal: true }, wantExit: 0 },
      { name: "conformant-own-remote", in: { version: 1, lane: "evaluator", container: "own", host: "remote", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 0 },
      { name: "conformant-build-lane", in: { version: 1, lane: "build", container: "shared", host: "local", accesses: { repo: "present", host_socket: "present" }, integrity_signal: false }, wantExit: 0 },
      { name: "out-of-enum-lane", in: { version: 1, lane: "builder", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "out-of-enum-container", in: { version: 1, lane: "evaluator", container: "vm", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "out-of-enum-host", in: { version: 1, lane: "evaluator", container: "own", host: "banana", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "missing-host", in: { version: 1, lane: "evaluator", container: "own", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "out-of-enum-repo-access", in: { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "readable", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "version-below-one", in: { version: 0, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "version-not-integer", in: { version: "1", lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: false }, wantExit: 1 },
      { name: "accesses-missing", in: { version: 1, lane: "evaluator", container: "own", host: "local", integrity_signal: false }, wantExit: 1 },
      { name: "integrity-signal-not-bool", in: { version: 1, lane: "evaluator", container: "own", host: "local", accesses: { repo: "absent", host_socket: "absent" }, integrity_signal: "yes" }, wantExit: 1 },
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
for (const [name, describe] of Object.entries(CONTRACT_DESCRIBES)) {
  if (CONTRACTS[name]) CONTRACTS[name].describe = describe;
}

module.exports = { CONTRACTS };
