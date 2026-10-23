// ===========================================================================
// === region:factory — contract-defs-floor — contract definitions: the integrity floor, the merge floor's pure decision core ===
// Split out of contract-defs.js (FAFF-1392); contract-defs.js re-exports every name, so
// consumers keep requiring the facade.
// ===========================================================================

const { requiresSelfConsistencyStamp } = require("./shared-infra");
const { schemaCheck } = require("./contract-engine");


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
// FAFF-892 (merge-floor sibling to ADR-0114): `custody-trusted` is the digest-verified
// custody GRANT — a distinct, weaker trust class than `asserted` (mount-asserted), surfaced
// as its own value (ADR-0073 decision 5 distinctness) so the merge-record shows the truthful
// basis rather than collapsing it into `unasserted`. Non-blocking, like `asserted`/`unasserted-ok`.
const FLOOR_INTEGRITY = ["asserted", "custody-trusted", "unasserted-ok", "unasserted-refuse", "violated"];
// FAFF-1072: dispatch-state fact for the merge floor's branch-6 (absent custody declaration).
// Mirrors laneBoundaryDispatchState (merge-gate.js): a run merges either above a dispatch cut
// (detective custody owns it), with no cut (the self-consistency stamp owns it), or with a
// present-but-broken boundary (indeterminate — refused upstream by evaluateCustody before the
// floor is folded, so it never reaches the predicate below as a merge-floor pass).
const DISPATCH_STATES = ["dispatched", "absent", "indeterminate"];
// FAFF-1072/FAFF-1140: `requiresSelfConsistencyStamp` — the shared "must be self-consistent / must be
// governed" run-fact predicate the interactive custody stamp AND the merge-floor branch-6 consumer key
// on. Its single definition was relocated to shared-infra (the dependency-free leaf) so commissaire's
// run-start admit-required gate can key on the SAME function without its import graph reaching an
// orchestration module (the standalone-independence guard). Imported above and re-exported here for
// the existing consumers (merge-gate, resolveGateLevel below) unchanged.
// FAFF-1040: the code-blind holdout guarantee's binding merge-floor posture, resolved from the
// CAPABILITY facts alone — never the L-level label and never a config opt-in. "strict" blocks on a
// non-meets-spec holdout; "pass-through" (a capability was legitimately absent, labelled) never blocks.
// There is deliberately no "offer" posture at the merge floor: whether to RUN a holdout on an attended
// run is a build-START interaction (its own follow-up), not a merge-time state — by merge time the
// only fact is whether a fresh caged verdict was produced.
const HOLDOUT_POSTURES = ["strict", "pass-through"];
// FAFF-1040: a capability read is THREE-way, not a bool — "satisfied" (the fact holds), "absent"
// (the artifact is legitimately not there — holdout genuinely cannot run → pass-through), and
// "faulted" (present-but-unreadable / torn-down / stale — a plumbing fault that must fail SAFE,
// never a silent pass-through). resolveHoldoutPosture keys on these.
const CAPABILITY_READS = ["satisfied", "absent", "faulted"];
// FAFF-1040: the pure activation resolver for the code-blind holdout guarantee — the named follow-up
// ADR-0130 line 22 deferred. It keys on the two CAPABILITY reads (`can_run`, `caged`), each three-way,
// and NOTHING else — a present, fresh, caged verdict is enforced at ANY level. Precedence is deliberate
// and load-bearing: a FAULTED read is evaluated BEFORE an ABSENT one, so a torn-down/unreadable/stale
// capability artifact can never be mistaken for a legitimate no-capability and silently skipped — it
// fails safe to STRICT (blocks), preserving today's L4 fail-closed direction. Only a genuinely-ABSENT
// capability yields pass-through, labelled with which; never a park on a non-defect. Returns
// { posture, missing, fault }: `missing` is non-empty only for pass-through, `fault` only when a read
// faulted (surfaced on the merge record for diagnosability; it does not change that faulted ⇒ strict).
function resolveHoldoutPosture(caps) {
  const c = caps || {};
  const fault = [];
  if (c.can_run === "faulted") fault.push("can-run-read-faulted");
  if (c.caged === "faulted") fault.push("cage-read-faulted");
  if (fault.length) return { posture: "strict", missing: [], fault }; // fail-safe: present-but-broken blocks
  const missing = [];
  if (c.can_run === "absent") missing.push("no-born-verifiable-dod-or-standable-sut");
  if (c.caged === "absent") missing.push("no-proven-cage");
  if (missing.length) return { posture: "pass-through", missing, fault: [] }; // nothing to run / untrusted → step aside
  return { posture: "strict", missing: [], fault: [] }; // present, fresh, caged verdict → enforce, any level
}
// FAFF-828: the Commissaire protected-effect decision leg — the worked chokepoint (merge-gate)
// feeds a THREE-state signal, not two. "not-applicable" (the common case: an ordinary merge the
// external Commissaire facade never governed — no admitted producer, no schema:3 decision context)
// and "valid-grant" (the chokepoint verified a genuine covering Ed25519-signed grant) never block;
// only "absent-or-invalid" (governance applies but the grant is missing, forged, or non-covering)
// blocks, refusing the effect BEFORE it happens. Absent from an extraction, it defaults to
// "not-applicable" — a plain no-op, so every pre-existing caller/merge is byte-for-byte unaffected
// (this is the E-B raise WITHOUT touching merges the facade never governed).
const FLOOR_DECISION_GRANTS = ["not-applicable", "valid-grant", "absent-or-invalid"];
// FAFF-1077: the stacked-dependency merge-order interlock leg — the additive gate that keeps a
// branch-stacked dependent D from merging before its dependency B's PR merges. Three states,
// mirroring decision_grant's polarity: "not-applicable" (ABSENT default — no stack anchor, an
// ordinary merge, byte-for-byte unaffected) and "satisfied" (B's PR observed MERGED and D rebased
// onto the true main) never block; only "blocked" (B's PR still open/unmerged, or closed without
// merging) refuses D's merge. Absent from an extraction it defaults to "not-applicable", so every
// pre-existing caller/merge that never set it is byte-for-byte unaffected. It only ever ADDS a
// refusal — never removes one — so a stacked D is strictly MORE gated than today, never less.
const FLOOR_DEPENDENCY_GATES = ["not-applicable", "satisfied", "blocked"];

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
  // FAFF-1040: block on the resolved POSTURE (a capability fact), not the L-level label. Only "strict"
  // blocks; "pass-through" (a capability was legitimately absent, labelled in f.holdout_missing) never
  // blocks. A pre-1040 caller that never set holdout_posture gets the level-aware back-compat default
  // (L4 → strict, else pass-through), byte-identical to the old `level === "L4"` gate — the merge-gate
  // shell now sets it explicitly from resolveHoldoutPosture.
  const holdoutPosture = f.holdout_posture || (f.level === "L4" ? "strict" : "pass-through");
  if (holdoutPosture === "strict" && f.holdout !== "meets-spec") blockers.push(`holdout guarantee (strict): ${f.holdout} (need meets-spec)`);
  if (f.integrity === "violated") blockers.push("corrective-artifact integrity violated (FAFF-325): the FAFF_INTEGRITY_BOUNDARY attestation failed verification (forged/tampered) — refused at every level");
  if (f.integrity === "unasserted-refuse") blockers.push("corrective-artifact integrity unasserted at L4 (FAFF-325): no trusted attestation declaration — refused (defence-in-depth; the run-start preflight should already have caught this)");
  if (f.decision_grant === "absent-or-invalid") blockers.push("Commissaire protected-effect decision absent or invalid for a governed effect (FAFF-828): the chokepoint could not verify a covering Ed25519-signed grant — refused before the effect");
  if (f.dependency_gate === "blocked") blockers.push("stacked dependency PR not yet merged (FAFF-1077): a branch-stacked dependent must not merge before its dependency's PR merges");
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
  // FAFF-1072: the new-fact inputs the absent-integrity default below keys on. Validated fail-loud
  // when present (same posture as the other fields); when absent they default so every pre-1072
  // extraction is byte-for-byte unaffected — `unattended` defaults L4-aware (L4 is unattended by
  // construction), `dispatch_state` defaults fail-closed to "absent" (require the guard when the
  // caller could not prove a dispatch cut). Only read on the absent-integrity branch.
  if (e.unattended !== undefined && typeof e.unattended !== "boolean") return { contractData: null, failLoud: "unattended must be a boolean" };
  if (e.dispatch_state !== undefined && !DISPATCH_STATES.includes(e.dispatch_state)) return { contractData: null, failLoud: `dispatch_state ${JSON.stringify(e.dispatch_state)} not in {${DISPATCH_STATES.join(",")}}` };
  const unattended = e.unattended === undefined ? (e.level === "L4") : e.unattended;
  const dispatch_state = e.dispatch_state === undefined ? "absent" : e.dispatch_state;
  let integrity = e.integrity;
  // FAFF-1072: the absent-integrity default keys on the run FACTS, not the L4 label — block
  // (require a custody stamp) exactly where the interactive custody stamp fires: an unattended run
  // merging with no dispatch cut. Byte-identical to the old `level === "L4"` default for every
  // pre-1072 extraction (L4 ⇒ unattended:true + dispatch_state:"absent" ⇒ refuse; below-L4 ⇒
  // unattended:false ⇒ ok), and now also covers the unattended top-level L3 cell.
  if (integrity === undefined) integrity = requiresSelfConsistencyStamp(unattended, dispatch_state) ? "unasserted-refuse" : "unasserted-ok";
  else if (!FLOOR_INTEGRITY.includes(integrity)) return { contractData: null, failLoud: `integrity ${JSON.stringify(integrity)} not in {${FLOOR_INTEGRITY.join(",")}}` };
  // FAFF-828: the Commissaire decision leg. Absent → "not-applicable" (a plain no-op — an ordinary
  // ungoverned merge), so every extraction that never set it is byte-for-byte unaffected. A
  // present-but-out-of-enum value is a shell bug → fail-loud (never coerced), same posture as integrity.
  let decision_grant = e.decision_grant;
  if (decision_grant === undefined) decision_grant = "not-applicable";
  else if (!FLOOR_DECISION_GRANTS.includes(decision_grant)) return { contractData: null, failLoud: `decision_grant ${JSON.stringify(decision_grant)} not in {${FLOOR_DECISION_GRANTS.join(",")}}` };
  // FAFF-1077: the stacked-dependency interlock leg. Absent → "not-applicable" (a plain no-op — an
  // ordinary non-stacked merge), so an extraction that never set it is byte-for-byte unaffected. A
  // present-but-out-of-enum value is a shell bug → fail-loud (never coerced), same posture as the
  // integrity/decision_grant siblings.
  let dependency_gate = e.dependency_gate;
  if (dependency_gate === undefined) dependency_gate = "not-applicable";
  else if (!FLOOR_DEPENDENCY_GATES.includes(dependency_gate)) return { contractData: null, failLoud: `dependency_gate ${JSON.stringify(dependency_gate)} not in {${FLOOR_DEPENDENCY_GATES.join(",")}}` };
  // FAFF-1040: the holdout activation posture leg. Absent → left undefined so decideFloor applies the
  // single-sourced level-aware back-compat default (L4 → strict, else pass-through), byte-identical to
  // the old `level === "L4"` holdout gate for every pre-1040 extraction; the merge-gate shell now sets
  // it explicitly from resolveHoldoutPosture. A present-but-out-of-enum value is a shell bug → fail-loud,
  // same posture as the integrity/decision_grant/dependency_gate siblings.
  let holdout_posture = e.holdout_posture;
  if (holdout_posture !== undefined && !HOLDOUT_POSTURES.includes(holdout_posture)) return { contractData: null, failLoud: `holdout_posture ${JSON.stringify(holdout_posture)} not in {${HOLDOUT_POSTURES.join(",")}}` };
  // FAFF-1040: the labelled-miss and fault lists are carried on FloorInputs for a diagnosable merge
  // record; they NEVER affect the verdict (only the posture does). Absent → []; present must be a
  // string array (a shell bug otherwise → fail-loud).
  const holdout_missing = e.holdout_missing === undefined ? [] : e.holdout_missing;
  if (!Array.isArray(holdout_missing) || holdout_missing.some((x) => typeof x !== "string")) return { contractData: null, failLoud: "holdout_missing must be an array of strings" };
  const holdout_fault = e.holdout_fault === undefined ? [] : e.holdout_fault;
  if (!Array.isArray(holdout_fault) || holdout_fault.some((x) => typeof x !== "string")) return { contractData: null, failLoud: "holdout_fault must be an array of strings" };
  const f = { ac_complete: e.ac_complete, review_verdict: e.review_verdict, ci_state: e.ci_state, head_sha_matches: e.head_sha_matches, level: e.level, holdout: e.holdout, no_ci_policy, integrity, decision_grant, dependency_gate, holdout_posture, holdout_missing, holdout_fault };
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

module.exports = { CI_STATES, FLOOR_REVIEW_VERDICTS, FLOOR_LEVELS, FLOOR_HOLDOUTS, NO_CI_POLICIES, FLOOR_INTEGRITY, DISPATCH_STATES, HOLDOUT_POSTURES, CAPABILITY_READS, resolveHoldoutPosture, FLOOR_DECISION_GRANTS, FLOOR_DEPENDENCY_GATES, decideFloor, resolveGateLevel, computeIntegrityFloor, contractIntegrityFloor, requiresSelfConsistencyStamp };
