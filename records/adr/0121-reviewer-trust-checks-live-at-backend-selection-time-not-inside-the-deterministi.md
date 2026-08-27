# ADR 0121 — Reviewer-trust checks live at backend-selection time, not inside the deterministic roll-up

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-27
- **Issue:** FAFF-888

## Context

The `spec_review` aggregator (`plugin/skills/faffter-dark-spec-review/aggregate.mjs`) applies a
severity veto: any single lens returning `critical` maps the round to `reject-approach`. That veto
is correct by design and follows the deterministic-tools tenet: the same refutation set must always
produce the same verdict. But a mono-severity backend that stamps `critical` on every lens of every
spec trips the veto every round, forcing `reject-approach` no matter how good the spec is and parking
the run at the loop cap (FAFF-888).

The fix needs a check on whether a reviewer can be trusted at all. The question is where that check
attaches. Folding it into the veto would make the roll-up inspect the reviewer's track record
mid-deliberation and turn a deterministic, replayable tool into a stateful one. The convergence and
churn detectors already established the pattern that the roll-up stays a pure function of one round's
inputs; a reviewer-fitness signal is a different concern at a different altitude.

## Decision

Any check on whether a reviewer can be trusted at all lives at backend-selection time, composed on
the FAFF-870 per-consumer chain assembly, never inside the deterministic roll-up. The `aggregate.mjs`
severity veto stays the reviewer's owned judgement over a given refutation set and is not touched.
FAFF-888 implements this as `faff spec-review-reputation --eligible`, a selection-time filter that
strikes a candidate-degenerate backend from the assembled chain before it is served or pinned
(voir-dire: a juror is excused for cause before the trial, not challenged mid-deliberation). The
filter is fail-closed: it never empties the chain, so an all-flagged input is preserved with an
operator-attention flag rather than the gate being removed.

## Consequences

Future spec-review robustness guards (calibration, liveness, drift) attach at chain resolution, the
same seam, and inherit the same fail-closed discipline; none of them may reach into `aggregate.mjs`
or the loop driver. The roll-up stays deterministic and replayable, and the reviewer-selection layer
carries all reputation and trust state. The cost is that a per-round runtime signal (for example, a
backend degrading mid-loop) is out of scope for this seam by construction; that is a separate concern
handled by the reviewer pin (FAFF-886), not by re-opening the veto.
