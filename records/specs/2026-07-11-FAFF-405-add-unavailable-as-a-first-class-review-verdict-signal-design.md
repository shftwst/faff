# Spec — FAFF-405: Add `unavailable` as a first-class review-verdict signal

> Spec: faffter-dark-nlspec · 2026-07-07 · interactive · confidence: high

A **pure model correction**: adds one value to the closed review-verdict signal vocabulary so a review-provider *outage* is a first-class fail-closed signal rather than an overloaded `needs-human` + a side-channel annotation. **No runtime disposition change** — an outage parks exactly as today. Prerequisite for FAFF-403 (retry-later).

## 1. WHY
FAFF-398 needed to express "no review verdict could be produced" (the mandatory L4 chain exhausted with no opinion) but the closed `{pass, fail, needs-human}` vocab had no word, so it reused `needs-human` + stashed the distinguisher in `adversarial_outcome:"mandatory-chain-outage"`. An availability failure ≠ a verdict; conflating them means no consumer can tell "a human must judge" from "the reviewer was down" without a side channel. Add `unavailable`.

Principles:
- **Fail-closed preserved** — `unavailable` is a KNOWN fail-closed value (never `pass`), NOT the malformed/unknown fallback (that still → `needs-human`).
- **No behaviour change is the acceptance bar** — any diff altering where an outage lands is out of scope + a defect. Retry-later = FAFF-403.
- **Signal carries meaning; annotation → forensics** — `adversarial_outcome` retained forensics-only, no longer load-bearing.

Files: `plugin/skills/faff/contracts/review-verdict.schema.json` (signal enum); `bin/faff` `computeReviewVerdict` `SIGNALS` (~L6018) + `decideFloor`/`FLOOR_REVIEW_VERDICTS` (~L6906/6916) + `computeIntegrityFloor` (~L6932); `faffter-dark-adversarial-review/SKILL.md` (~L176/200-208/217 exit-9); `faff-graft/SKILL.md` (~L342/361/503/548 signal branch); `test/golden/contracts/cases.json` + CONTRACTS fixtures.

(Note — post-FAFF-441 the CLI is split: the above `bin/faff` line numbers refer to the pre-split monolith. Current locations: `computeReviewVerdict`'s `SIGNALS` + `FLOOR_REVIEW_VERDICTS` + `computeIntegrityFloor` live in `plugin/skills/faff/bin/lib/contract-defs.js` / `contract-engine.js`.)

## 2. OUT OF SCOPE
- Retry-later disposition of `unavailable` (behaviour change) — FAFF-403.
- `review-call.mjs` exit logic (`EXIT.MANDATORY_OUTAGE`/`mandatoryRemap` unchanged; only the skill's interpretation of exit 9 changes).
- beep-boop outage reporting (reads `adversarial_outcome` from the raw artifact, not the signal — no change).
- The exit-5 advisory (L1–L3) path (still `signal: pass` + `chain-outage-skipped`; only mandatory L4 exit-9 re-points).

## 3. WHAT
Closed `ReviewSignal` vocab gains `unavailable` ("no verdict producible — provider outage"; known fail-closed). Two synchronised homes: `review-verdict.schema.json` `signal.enum` + `computeReviewVerdict.SIGNALS`.

**Chosen:** `unavailable` is exempt from the findings-substantiation check (which fires only for `fail`/`needs-human`) — a bare `{signal:"unavailable"}` is conformant (an outage is a clean state, not a finding-bearing verdict).
**Anti-pattern:** editing the OTHER `const SIGNALS = ["pass","fail","needs-human"]` — that's the quality-gates contract's independent set. Only the one inside `computeReviewVerdict` is review-verdict.

## 4. HOW
**(a) Vocabulary:** add `unavailable` to the schema enum + `computeReviewVerdict.SIGNALS`. It now round-trips as `signal:"unavailable"` instead of coercing; the unknown→`needs-human` coercion is untouched.
**(b) Merge floor:** the runtime path (`cmdMergeGate` → `decideFloor`, blocks `!== "pass"`) blocks `unavailable` with NO code change. **Chosen:** add `unavailable` to `FLOOR_REVIEW_VERDICTS` so the sibling `faff contract integrity-floor` (`computeIntegrityFloor`, validates against that enum + fail-louds exit 2 on anything outside it) treats a now-producible `unavailable` as a known **refuse (exit 1)**, not a malformed input (exit 2). Not a runtime disposition change (runtime never routes through `computeIntegrityFloor`); input-enum coherence, still fail-closed. **Anti-pattern:** editing `decideFloor`'s `!== "pass"` check (already blocks it).
**(c) Adversarial slot:** re-point exit-9 authoring to `signal: unavailable` at the three touch-points (table row, MANDATORY chain-outage section, checkpoint note — still a terminal outcome, now `unavailable`). Keep `adversarial_outcome:"mandatory-chain-outage"` forensics-only. Correct the stale `review-call.mjs` comment ("which the skill reads as needs-human" → `unavailable`; comment-only, no logic change).
**(d) graft:** add an `unavailable` arm to the Step-9 routing table, the pre-PR terminal-states list, Autonomous Step 4, and Return-values/ledger-bucket mapping, each mapping `unavailable` to EXACTLY the needs-human disposition (surface on the tracker issue, park, no PR, `parked` bucket). **Anti-pattern:** a resume/retry arm — that's FAFF-403.

Failure modes: the two vocab homes drift (caught by the `unavailable` selftest — one coerces, one passes); the wrong `SIGNALS` edited (caught by a gates selftest / review-verdict still coercing); `unavailable` reads as mergeable anywhere (caught by the floor selftest).

## 5. SCENARIOS (born-verifiable)
- `{signal:"unavailable",findings:[]}` through `faff contract review-verdict` → conformant, emitted signal `unavailable` (NOT coerced).
- a malformed signal (e.g. "maybe") → still coerced to `needs-human` (unknown-fallback unchanged).
- a floor with `review_verdict:"unavailable"` (else green) through `decideFloor`/`integrity-floor` → **refuse** (exit 1), never fail-loud (exit 2), never merge-ok.
- mandatory L4 exit-9 → the slot authors `signal:"unavailable"` (with `adversarial_outcome` retained forensics).
- Non-functional: `unavailable` is never `pass` — no gate/floor/consumer treats it as merge-eligible.

## 6. RATIONALE (Chosen)
- New closed-set value over annotation-only (the two states become distinguishable at the signal layer — the defect being fixed).
- No runtime floor change + one coherence edit (`FLOOR_REVIEW_VERDICTS`) so the standalone contract refuses rather than fail-louds.
- `unavailable` exempt from findings-substantiation (a bare one is conformant — matches the no-behaviour-change bar).
- graft dispositions `unavailable` identically to `needs-human` (no-PR park, `parked` bucket); retry-later is FAFF-403.
- `adversarial_outcome` retained forensics-only (passes through `computeReviewVerdict` unread — verified).

## 7. ASSUMPTIONS
- **Assumes:** `additionalProperties:false` in the schema gates the emitted object's property SET (signal/findings/conformant/violations), not the signal value set; `adversarial_outcome` never reaches the emitted object (dropped by the re-emit) — verified via the existing `adversarial-outcome-passthrough` fixture, keep it green.
- **Assumes:** graft is the ONLY consumer branching on the review-verdict *signal* (merge-gate blocks-by-default; beep-boop reads the raw artifact) — verified by a consumer sweep; re-grep `review_verdict`/`readReviewVerdict` before implementing.

## 8. DONE
- schema `signal.enum` + `computeReviewVerdict.SIGNALS` include `unavailable`; the gates-contract `SIGNALS` UNCHANGED.
- `{signal:"unavailable"}` conformant + signal not coerced; malformed still → needs-human; `unavailable` never `pass`.
- `FLOOR_REVIEW_VERDICTS` includes `unavailable`; `integrity-floor` returns refuse (exit 1) for it, not fail-loud (exit 2); never merge-ok.
- adversarial exit-9 authors `signal:unavailable` (3 touch-points); `adversarial_outcome` retained forensics; `review-call.mjs` comment corrected (no logic change).
- graft Step-9 routing / terminal-states / Autonomous-Step-4 / Return-values include an `unavailable` arm identical to needs-human (no-PR park, `parked` bucket); a `critical` finding still → needs-human.
- `contract review-verdict --selftest` + golden cases add `unavailable` (conformant bare; malformed→needs-human still); an `integrity-floor` case asserts `unavailable → refuse`; `node --test` green.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ]
}
```

---

## Prep addendum (methodology + spec-review, 2026-07-07)

**Prepped — promoted to Todo. `confidence: high` · `spec-review: approve`.**

- Spec-review (architectural / infosec / QA, single-pass): **approve**, no objections — verified the two `SIGNALS` arrays are independent (only `computeReviewVerdict` changes), fail-closed is airtight (`unavailable` never `pass`; runtime `decideFloor` blocks it unchanged; coercion untouched so garbage never becomes `unavailable`-mergeable), the `FLOOR_REVIEW_VERDICTS` coherence edit is correct, and graft is the only signal-brancher.
- Methodology (agile): the split is the right cut; FAFF-402 confirmed non-overlapping (touched `build-progress` + graft steps, not `review-call.mjs` or the review-verdict contract); **consumer-sweep elevated to a required build gate**.
- Build carries: the `FLOOR_REVIEW_VERDICTS`/`integrity-floor` coherence edit (refuse-1, not fail-loud-2), the wrong-`SIGNALS` anti-pattern, and the `review_verdict`/`readReviewVerdict` consumer re-grep as a gate.

**Context (non-blocking — no spec change required, from FAFF-429 cancellation residue):** in the adversarial SKILL.md exit rows, the exit-`8` row's L4/autonomous column reads "same — pass + skip" without noting that a **mandatory** chain's deadline exhaustion is remapped to exit `9` (fail-closed) per the exit-9 row below it. Add a short cross-ref ("advisory only — mandatory → remapped to `9`, see below") in passing.
