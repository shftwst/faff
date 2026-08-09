# Spec — FAFF-256: PRDR YAGNI guard (the upper gate) — methodology proposes, adversarial review challenges

> Spec: faffter-dark-nlspec · 2026-06-27 · interactive (chain walk, 3 design decisions resolved with the human) · confidence: high. Full spec on Linear FAFF-256.

The **upper-gate computation** FAFF-255 delegates to: given an `AuthoredPrdr` (from FAFF-251), produce 255's `upper: {admit, reason}` verdict — *"is this PRDR warranted (serves the PRD without exceeding it)?"* — via two-phase arbitration with an independent skeptic.

## 1. WHY
255's upper gate is the YAGNI bound. The loop authoring its own PRDRs (251) cannot be the sole judge of whether they're warranted — that's self-grading. 256 produces the upper verdict by having the **methodology propose** the value judgment and an **adversarial reviewer challenge** it, so the loop's own justification faces an independent model.

**Principles:** independent skeptic (two-phase) · trace-to-goal (every PRDR must cite + genuinely serve a real PRD goal) · grounding is advisory (PRD + methodology now; domain KB later).

## 2. OUT OF SCOPE
- 255's gate framework + authority/ratchet — 256 only fills `upper`.
- The lower/coverage gate → **FAFF-257**.
- The **domain knowledge base** artifact → the grounding slot (FAFF-127/128). 256 *consumes* it when present, never builds it.
- PRDR authoring → **FAFF-251** (256 reviews what 251 authors).

## 3. WHAT
**Input:** an `AuthoredPrdr` (251) + the PRD + the methodology lens (+ optional grounding/KB). **Output:** 255's `upper: {admit, reason}` verdict.

```
PROCEDURE upper_gate(authored_prdr, prd, methodology, grounding?):
  # trace-to-goal precondition (deterministic) — no vague / goal-less PRDRs
  IF authored_prdr.prd_goal NOT IN prd.goals:  RETURN {admit:false, reason:"no PRD-goal trace"}
  # Phase 1 — methodology proposes the YAGNI judgment
  proposal  := methodology.yagni_judge(authored_prdr, prd, grounding?)
               → { serves_goal, within_scope, verdict: admit|reject, reason }
  # Phase 2 — adversarial reviewer challenges (different model: gold-plating / unwarranted / off-mission)
  challenge := adversarial_review.challenge(authored_prdr, prd, proposal)
  # arbitrate — conservative on doubt
  IF proposal.verdict==admit AND challenge does NOT overturn:  RETURN {admit:true,  reason}
  ELSE                                                          RETURN {admit:false, reason: reject + challenge}
```

Emits a `faff-contract:prdr-yagni` block (the upper verdict), validated deterministically (mirrors `prd-readiness`); consumed by 255's `faff prdr admit --upper`.

**Chosen — arbitration:** two-phase — methodology proposes, adversarial review challenges; disagreement → conservative reject. *(D1.)*
**Chosen — grounding:** PRD + methodology now; the domain KB is a forward-interface via the grounding slot (advisory when present, never required). *(D2.)*
**Chosen — anti-spam bar:** trace-to-goal + adversarial survival + 255's ratchet (three reinforcing filters, no arbitrary cap). *(D3.)*

## 4. HOW — the three anti-spam filters compose
1. **Trace-to-goal (deterministic):** `PRDR.prd_goal` must be a real PRD goal, else reject — kills vague/goal-less PRDRs at the door.
2. **Adversarial survival (judgment):** the PRDR must survive the skeptic's challenge that it serves that goal *without exceeding it*.
3. **255 ratchet (volume):** repeated authoring of marginal PRDRs is caught by 255's count-ratchet — 256 is per-PRDR, volume is 255's.

**Fail-safe:** methodology↔adversarial disagreement → conservative **reject** (no gold-plating on doubt — mirrors 255's upper fail-safe default). **Grounding:** PRD + methodology always; the domain KB ("dentist CRMs need X not Y") sharpens *within-scope* when the grounding slot supplies it, but its absence never blocks.

**Anti-patterns:** methodology-only (no skeptic = self-grading); admitting a goal-less PRDR; building the KB here; 256 performing admission (that's 255).

## 5. Scenarios
- PRDR cites a real PRD goal, serves it in scope, survives challenge → **admit**.
- PRDR cites no real PRD goal → **reject** (trace-to-goal), no slot call needed.
- PRDR plausible to the methodology but the adversarial reviewer shows gold-plating → **conservative reject**.
- grounding/KB absent → judgment proceeds on PRD + methodology (degrades gracefully).
- Assertion: the trace-to-goal precondition + contract validation are pure (no network); only the two judgments are slot calls; 256 emits 255's `upper` shape and performs no admission.

## 7. Open Questions / Assumptions
- **Open Questions: none** — arbitration (two-phase), grounding (advisory KB), anti-spam (trace + survival + ratchet) resolved.
- **Assumes:** 251's `AuthoredPrdr` carries `prd_goal` (✓ specced); the PRD exposes its goals (FAFF-252 `## Acceptance criteria` — ✓); the adversarial-review slot is invocable (✓); 255's `upper` interface (✓ specced — serialise behind 255). Grounding slot FAFF-127/128 optional.

## 8. DONE
- [ ] `faff contract prdr-yagni` deterministic validator + schema + `--selftest` (the upper-verdict shape 255 consumes).
- [ ] upper-gate producer: methodology proposes (Phase 1) + adversarial-review challenges (Phase 2) → arbitrated `upper` verdict.
- [ ] deterministic trace-to-goal precondition: `PRDR.prd_goal ∈ PRD.goals`, else reject (no slot call).
- [ ] disagreement → conservative reject (fail-safe; no gold-plating on doubt).
- [ ] grounding: PRD + methodology required; domain KB (grounding slot) consumed when present, never required.
- [ ] verdict consumed by 255's `faff prdr admit --upper`; 256 owns no admission of its own.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"} ] }
```

---
*Interactive chain-walk spec (3 design decisions resolved with the human, 2026-06-27). Verdict: **fire-and-forget**. Serialise behind FAFF-255 (`upper` interface) + FAFF-251 (`AuthoredPrdr` input). Reuses the shipped two-phase adversarial-review pattern — no new ADR.*
