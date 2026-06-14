# ADR 0004 — Judgement-eval spike: is the skill-judgement surface flaky? (SCAFFOLD)

- **Status:** Proposed — **scaffold only**. The harness (FAFF-130) is built; the **measured numbers
  below are pending the supervised frontier run (FAFF-131)**. This ADR is not decided until FAFF-131
  fills the `‹pending›` cells and writes the recommendation.
- **Date:** 2026-06-14 (scaffold) · _measured run: pending_
- **Tickets:** FAFF-130 (harness, this) · FAFF-131 (run + numbers) · follows ADR 0003 · feeds FAFF-93 (live-driver decision) · unblocks FAFF-114
- **Supersedes/relates:** ADR 0003 left three lanes open; this is lane 2 (judgement-on-frontier).

## Context

ADR 0003 measured **0% kernel flakiness** — *because* skills route routing decisions into the
deterministic `faff` CLI rather than judging in-head — and explicitly flagged that "the flakiness
that actually matters is unmeasured": the **judgement residue** (`vague`/`dupe`/`stale`/`superseded`
classification, `pick-ordering`, synthesis gloss). This spike measures that residue cheaply with
offline evals against the shipped frontier model, to settle the **live-driver-vs-judgement-evals
fork** with numbers instead of intuition.

The harness: `eval/` (driver + two-tier deterministic grader + 12 cases + run-evals), with judgement
captured out-of-band via a `faff-eval:judgement` envelope so the FAFF-93 seam-only invariant is
preserved. Flakiness is measured as per-case **signature stability** across K=20 base reps (adaptive
escalation to ~50 on disagreement). See `eval/README.md` and the FAFF-130 spec.

## Measured results — _pending FAFF-131_

### Per-kind accuracy & flakiness (12 cases, 2/kind, K=20 base)

| Kind | Accuracy | Stability (1.0 = no flakiness) | Escalated? |
|---|---|---|---|
| dupe | ‹pending› | ‹pending› | ‹pending› |
| vague | ‹pending› | ‹pending› | ‹pending› |
| stale | ‹pending› | ‹pending› | ‹pending› |
| superseded | ‹pending› | ‹pending› | ‹pending› |
| ordering | ‹pending› | ‹pending› | ‹pending› |
| gloss | ‹pending› (rubric coverage) | ‹pending› | ‹pending› |

### Cost
- Total reps: ‹pending› · total tokens (est): ‹pending› · **$/case: ‹pending›** · wall-clock: ‹pending›.

### Gloss judge↔human delta
- Held-set spot-check size: ‹pending› · LLM-judge vs human agreement: ‹pending›. (Reported coverage is
  the deterministic rubric pass-rate; the judge stays advisory per spec Decision 3.)

## Decision — _pending FAFF-131_

**The fork:** evals-only / live-driver / both. ‹pending — grounded in the numbers above›.

Guidance the harness is built to support:
- If per-kind **stability is high** (judgement is reproducible) → targeted evals likely **suffice**; a
  full live-driver integration is not yet warranted.
- If **stability is low** on value-bearing kinds → judgement drift is real; either harden those
  `faff-tidy` prose sections (separate tickets) or invest in the live driver — the numbers say which.

## Consequences
- `eval/` exists and is CI-excluded; `npm test` cost unchanged (the deterministic grader + orchestration
  are covered free by `test/eval-grader.test.mjs`).
- FAFF-114 (and the lean-prompts chain) can proceed: judgement drift is now **checkable** via the harness,
  even before this ADR's numbers land.

## Costed follow-ups — _pending FAFF-131_
‹pending — e.g. promote `eval/` to a standing on-demand suite; widen fixtures; target other skills›.
