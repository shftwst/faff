// ===========================================================================
// === region:governance — decision-policy — FAFF-1177: the pure protected-effect decision core shared by the in-process facade and the governor ===
//
// The request evaluator, the per-level policy, their composition, the chokepoint grant verifier and
// the FAFF-1225 grant-coverage check, moved byte-for-byte out of commissaire.ts so the out-of-process
// governor (governor.ts, factory) and the in-process facade call ONE implementation. PURE: no I/O,
// requires only the governance cores (producer-auth, effects). A change to any leg here forks
// the in-process and governor verdicts, so the legs are never re-ordered or re-worded.
// ===========================================================================

import type { ProducerAuthApi } from "./producer-auth";

const producerAuth: ProducerAuthApi = require("./producer-auth");
const { verifyRecord, verifyDecision, pkFingerprint } = producerAuth;
const { effectDescriptorViolations, effectTargetMatches, unitIdOf, matchesUnit, carriesBothUnitKeys, isProtectedKind } = require("./effects");

export type GovernedRecord = { [k: string]: unknown };
export type AdmissionRecord = { [k: string]: unknown };

function isRecord(v: unknown): v is { [k: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

// --- Pure core: evaluate a protected-effect decision request (verb 3) --------------------

// Given the admission record, the producer's (already-built, HMAC'd) request record, the
// master-derived key, and the ledger entries so far, decide grant/deny with the first failing
// leg's reason. PURE — no I/O. This is the born-verifiable heart of verb 3.
function evaluateDecisionRequest(admission: AdmissionRecord | null, requestRecord: GovernedRecord | null, key: Buffer, ledgerEntries: GovernedRecord[]): { verdict: string; reason: string } {
  // Leg 1 — admitted?
  if (!admission || admission.status === "revoked") return { verdict: "deny", reason: "producer-not-admitted" };
  // Assurance floor (step 6) — a weaker-class record (a J-D self-declaration, an E-C observation)
  // MUST NOT stand in for an E-B grant request. Only a genuine effect-decision-request qualifies.
  if (!requestRecord || requestRecord.kind_of_entry !== "effect-decision-request") {
    return { verdict: "deny", reason: "assurance-floor" };
  }
  // Leg 2 — the producer's request authenticates under its own key.
  if (!verifyRecord(requestRecord, key)) return { verdict: "deny", reason: "producer-auth-failed" };
  // Unit identity (FAFF-1167) — the request must resolve to exactly one work unit, and no record in
  // the snapshot may carry both unit keys (an unattributable record could belong to this unit).
  const unit = unitIdOf(requestRecord);
  if (unit === null || ledgerEntries.some(carriesBothUnitKeys)) return { verdict: "deny", reason: "invalid-unit-key" };
  const payload = isRecord(requestRecord.payload) ? requestRecord.payload : undefined;
  const effect = payload ? payload.effect : undefined;
  const effectKind = isRecord(effect) ? str(effect.kind) : undefined;
  const effectTarget = isRecord(effect) ? effect.target : undefined;
  // Leg 4 — descriptor validity (run before scope so a malformed kind is named precisely).
  const viol = effectDescriptorViolations(effect);
  if (viol.length) return { verdict: "deny", reason: "invalid-effect-descriptor" };
  // Leg 3 — scope.
  const scope = Array.isArray(admission.admitted_scope) ? admission.admitted_scope : [];
  if (effectKind === undefined || !scope.includes(effectKind)) return { verdict: "deny", reason: "effect-out-of-scope" };
  // Leg 5a — freshness: a request resting on evidence older than the latest observation for
  // (unit, step) is stale.
  const step = requestRecord.step;
  let latestObserveSeq = -1;
  for (const e of ledgerEntries) {
    const eSeq = num(e.seq);
    if (e.kind_of_entry === "observe" && matchesUnit(e, unit) && e.step === step && eSeq !== undefined && Number.isInteger(eSeq)) {
      latestObserveSeq = Math.max(latestObserveSeq, eSeq);
    }
  }
  const evidenceSeq = payload ? num(payload.evidence_seq) : undefined;
  if (evidenceSeq !== undefined && Number.isInteger(evidenceSeq) && latestObserveSeq >= 0 && evidenceSeq < latestObserveSeq) {
    return { verdict: "deny", reason: "stale-evidence" };
  }
  // Leg 5b — coverage: the granted effect must be declared or wildcard-covered for (unit, step).
  const covered = ledgerEntries.some((e) => {
    if (!(e.kind_of_entry === "declare" && matchesUnit(e, unit) && e.step === step && isRecord(e.effect))) return false;
    return e.effect.kind === effectKind && effectTargetMatches(e.effect.target, effectTarget);
  });
  if (!covered) return { verdict: "deny", reason: "effect-not-declared" };
  // Every leg passes → grant.
  return { verdict: "grant", reason: "all-legs-pass" };
}

// --- Pure composable leg: the per-level authorization policy (FAFF-1034) ------------------

// PURE. Composed ABOVE evaluateDecisionRequest (never inside it): the born-verifiable pure core
// stays effect-integrity-only, and this level-keyed leg gates the authorize verdict beside it, the
// same way decideFloor keys its holdout leg on level without forking the pure core. The inputs
// (level, attended, holdout) are recorded in the request/verdict payload so a deny whose pure legs
// pass is replayable by a secret-free `audit verify` reviewer.
//   L1 / L2 — pass iff the run is attended (human presence authorizes the merge)
//   L3      — pass (the base floor governs; no extra authority required)
//   L4      — pass iff the holdout verdict is "meets-spec"
// An ABSENT level → pass (back-compat: an unsupplied level never newly denies).
function evaluateLevelPolicy(opts: { level?: unknown; attended?: unknown; holdout?: unknown } = {}): { pass: boolean; reason: string } {
  const { level, attended, holdout } = opts;
  if (level == null) return { pass: true, reason: "no-level" };
  if (level === "L1" || level === "L2") {
    return attended ? { pass: true, reason: "attended" } : { pass: false, reason: "level-requires-attendance" };
  }
  if (level === "L3") return { pass: true, reason: "base-floor-governs" };
  if (level === "L4") {
    return holdout === "meets-spec"
      ? { pass: true, reason: "holdout-meets-spec" }
      : { pass: false, reason: "level-requires-holdout-meets-spec" };
  }
  return { pass: true, reason: "unknown-level-no-policy" };
}

// --- Pure core: chokepoint_permit -------------------------------------------------------

// Where prevention happens (e.g. merge-gate). Holds only PK. Verifies a signed decision covers
// the effect before permitting it. Returns { permit, reason }. A producer-authored or unverified
// or wrong-fingerprint or non-grant or non-covering decision is REFUSED.
function chokepointPermit(effect: { kind?: unknown; target?: unknown }, verdictRecord: GovernedRecord | null, pk: unknown, pinnedFingerprint?: string): { permit: boolean; reason: string } {
  if (!verdictRecord || verdictRecord.author !== "commissaire") return { permit: false, reason: "not-a-commissaire-decision" };
  if (!verifyDecision(verdictRecord, pk)) return { permit: false, reason: "decision-signature-invalid" };
  // Fingerprint pin: the verdict carries no fingerprint of its own; the pin lives on the held PK.
  if (pinnedFingerprint != null) {
    let fp: string;
    try { fp = pkFingerprint(pk); } catch { return { permit: false, reason: "pk-unreadable" }; }
    if (fp !== pinnedFingerprint) return { permit: false, reason: "pk-fingerprint-mismatch" };
  }
  const p = isRecord(verdictRecord.payload) ? verdictRecord.payload : {};
  if (p.verdict !== "grant") return { permit: false, reason: "decision-not-a-grant" };
  const granted = p.effect;
  const grantedKind = isRecord(granted) ? granted.kind : undefined;
  const grantedTarget = isRecord(granted) ? granted.target : undefined;
  if (!granted || grantedKind !== effect.kind || !effectTargetMatches(grantedTarget, effect.target)) {
    return { permit: false, reason: "grant-does-not-cover-effect" };
  }
  return { permit: true, reason: "valid-grant" };
}

// --- Pure core: grant_coverage (FAFF-1225) ----------------------------------------------

// Every observed protected effect for the unit must have a signed covering grant appended
// EARLIER in the chain (grant.seq < observe.seq). Coverage is decided by reusing chokepointPermit
// — the one signed-grant verifier — never a second signature/fingerprint/coverage check. The
// grant filter mirrors merge-gate's resolveGrantByEffectKind. sub_reason is best-effort detail;
// the top-level refusal reason is the same regardless of which explanation applies.
type UncoveredEffect = { effect: unknown; seq: unknown; sub_reason: "no-grant" | "denied" | "descriptor-mismatch" | "grant-after-effect" };

function classifyUncovered(observeSeq: number, observedEffect: { [k: string]: unknown }, grants: GovernedRecord[]): UncoveredEffect["sub_reason"] {
  const payloadOf = (g: GovernedRecord) => (isRecord(g.payload) ? g.payload : {});
  const grantedEffect = (g: GovernedRecord) => { const e = payloadOf(g).effect; return isRecord(e) ? e : {}; };
  const sameKind = grants.filter((g) => grantedEffect(g).kind === observedEffect.kind);
  if (sameKind.length === 0) return "no-grant";
  const earlier = (g: GovernedRecord) => (num(g.seq) ?? Infinity) < observeSeq;
  if (sameKind.some((g) => earlier(g) && payloadOf(g).verdict === "deny")) return "denied";
  if (sameKind.some((g) => earlier(g) && payloadOf(g).verdict === "grant" && !effectTargetMatches(grantedEffect(g).target, observedEffect.target))) return "descriptor-mismatch";
  if (sameKind.some((g) => (num(g.seq) ?? -Infinity) >= observeSeq && payloadOf(g).verdict === "grant")) return "grant-after-effect";
  return "no-grant";
}

function grantCoverage(ledger: GovernedRecord[], unit: string, govPk: unknown, pinnedFingerprint?: string): { covered: boolean; uncovered: UncoveredEffect[] } {
  const grants = ledger
    .filter((e) => e.schema === 3 && e.author === "commissaire" && e.kind_of_entry === "effect-decision-verdict" && matchesUnit(e, unit))
    .sort((a, b) => (num(a.seq) ?? 0) - (num(b.seq) ?? 0));
  const observed = ledger.filter((e) => e.kind_of_entry === "observe" && matchesUnit(e, unit) && isRecord(e.effect) && isProtectedKind(e.effect.kind));
  const uncovered: UncoveredEffect[] = [];
  for (const o of observed) {
    const oSeq = num(o.seq) ?? Infinity;
    const effect = isRecord(o.effect) ? o.effect : {};
    const candidates = grants.filter((g) => (num(g.seq) ?? Infinity) < oSeq);
    if (candidates.some((c) => chokepointPermit(effect, c, govPk, pinnedFingerprint).permit)) continue;
    uncovered.push({ effect: o.effect, seq: o.seq, sub_reason: classifyUncovered(oSeq, effect, grants) });
  }
  return { covered: uncovered.length === 0, uncovered };
}

// --- Pure composition of the two verdicts (FAFF-1034) -------------------------------------

// grant iff BOTH pass; else deny with the first failing reason (the pure legs are named first, then
// the level policy).
function composeDecision(decision: { verdict: string; reason: string }, levelPolicy: { pass: boolean; reason: string }): { verdict: string; reason: string } {
  return decision.verdict === "grant" && levelPolicy.pass
    ? { verdict: "grant", reason: decision.reason }
    : { verdict: "deny", reason: decision.verdict !== "grant" ? decision.reason : levelPolicy.reason };
}

module.exports = { evaluateDecisionRequest, evaluateLevelPolicy, composeDecision, chokepointPermit, grantCoverage };
