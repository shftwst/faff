# Spec — FAFF-116: Terseness + cruft pass (orchestration skills)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high.

A prose-only lean pass over the 9 orchestration sub-skills, cutting the cruft the FAFF-114 audit catalogued — guided by a committed worklist, floored by the deterministic suite, gated for safety on a human-run judgement-eval reverify. Gateway excluded.

## 1. WHY

The FAFF-114 audit catalogued faff's prompt-token cruft: dead `FAFF-NN` provenance refs, over-repeated contract ids, restate-instead-of-reference blocks, run-on paragraphs. FAFF-115 homed the entry preamble; this does the bulk cut over the 9 orchestration skills. Prose-only — no behaviour/contract/interface change.

**Principles.** Cutting prose is judgement-gated (the deterministic suite proves *seams*, not *decisions* — only the FAFF-169 frontier eval proves judgement). Tie-break: when ambiguous, KEEP. Verify each refer-back before cutting (high counts are mostly legitimate references, not duplication). Reference, don't relocate (nothing moves into the gateway — that was FAFF-115).

## 2. OUT OF SCOPE

- The gateway body (`faff/SKILL.md`) — excluded by the ticket; its ~37 refs are orphaned by FAFF-115's preamble-only ship → file a follow-up.
- Slot skills (FAFF-117); the charter/lint codifying the threshold (FAFF-120); caching-friendly ordering (FAFF-119).
- Any behaviour/contract/interface change — prose-only; the deterministic suite staying green is the proof.

## 3. WHAT — the worklist (authority: docs/audits/FAFF-114-skill-prompt-audit.md)

**DROP refs (per-skill, verified against live prose):**
- faff-jot: FAFF-23 — actually an example arg → normalize to `ISSUE-XX` (not a delete).
- faff-tidy: FAFF-98 (decision-record), FAFF-147 / FAFF-153 (parenthetical number; the "eval reads this verbatim" sentence + the eval-anchored sub-sections stay).
- faff-onboard: FAFF-5 ×2, FAFF-50, FAFF-67 (provenance).
- faff-graft: FAFF-1 ×2, FAFF-7 (background).
- faff-beep-boop: FAFF-82 ×2 are KEEP (status-monotonicity rule title) → no ref cut.

**Collapse over-repeats:** FAFF-109 — keep the one defining mention per skill, drop redundant repeats (prep ×4→1, graft ×3→1).

**Restate→reference:** faff-prep restates the Spec-readiness contract → `gateway → **Spec readiness (fixed)**`; faff-graft restates Issue-claim/status-monotonicity + worktree detail → gateway references. Keep each skill's own steps; reduce only the reproduced shared-rule content.

**Paragraph→list:** faff-beep-boop (outcome-buckets + banned-headings), faff-graft (Step 10 ci-green/red/no-coverage branches), faff-tidy (§1 spec-health — avoid the eval-anchored `#### Splittable specs` / `#### Chain gaps` sub-sections).

**Decisions (all Chosen):** two-tier verification (deterministic floor in CI + human-run frontier judgement reverify as the sufficient gate — so autonomous build → PR-open-for-human); audit threshold verbatim, tie-break KEEP; keep scoped to 9 skills + file gateway follow-up; one PR (don't multiply the frontier reverify).

## 4. HOW

Worklist-driven edit pass over the skills, then: deterministic floor (validate-adapters + node --test + 8 selftests + 3 eval loaders resolve + size gate reduction + re-baseline), then the human-run frontier reverify (run-evals.mjs vs frontier.json — hard merge gate, not CI), then file the gateway follow-up.

**Edge cases.** A "DROP" ref that's load-bearing on inspection → KEEP (e.g. jot's example arg, tidy's eval-anchored sentences). A mention that's already a pointer → no-op. Deterministic suite red → a cut broke a seam/anchor → revert that cut. Frontier reverify regresses → restore the cut nuance.

## 5. SCENARIOS

- The audit's DROP refs are gone, KEEP refs retained, restatements are references, named paragraphs are lists — no fact added/removed.
- Deterministic floor green + 3 loaders resolve (seams/behaviour unchanged).
- (Human) frontier reverify shows no per-kind regression — the sufficient gate.

Non-functional: prose-only; net token reduction; frontier reverify human-run + CI-excluded.

## 8. DONE

- [ ] Audit DROP refs removed from the 9 skills; KEEP refs retained; FAFF-109 reduced to one defining mention per skill.
- [ ] prep/graft restatements reduced to gateway references (skill-specific steps preserved).
- [ ] Named paragraph→list conversions done (no eval-anchored sub-section touched).
- [ ] No behaviour/contract/interface change.
- [ ] validate-adapters + node --test + 8 selftests green; 3 eval loaders resolve; size gate net reduction + re-baselined.
- [ ] (human, hard gate) frontier judgement reverify shows no per-kind regression — blocks merge; not CI.
- [ ] Gateway-cruft follow-up filed.

confidence: high
