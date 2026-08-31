# Spec-judge discrimination seam

The committed discriminating case pair the spec-review adjudicator's judge-quality eval seam
consumes. Two blinded case files, in the exact shape `faff spec-judge-evidence --assemble` emits,
with pinned exact-ruling oracles in `oracles.json`:

- `case-defect.json` — Argument A names a concrete, evidence-backed predicted consequence (an empty
  `--dir` crashes instead of parking). Oracle: the ruling must **not** be `AFFIRM_SPEC`.
- `case-taste.json` — the objection is a naming/return-shape preference; its predicted consequence is
  the `not separately stated` sentinel. Oracle: the ruling must be `AFFIRM_SPEC`.

The defect-half catches a constant-`AFFIRM_SPEC` judge; the taste-half catches a
constant-`UPHOLD_REVIEW` judge.

## Advisory in-ticket run (non-gating)

The prep-side dispatch runs the built judge over this pair once and logs the observed rulings against
the oracles as an advisory signal. A single stochastic sample cannot certify a probabilistic judge —
a constant-`AFFIRM_SPEC` judge can pass the taste half on one draw, and a genuinely discriminating
judge can miss the defect half on one unlucky draw — so neither a mismatch nor an outage-skip gates
the build. A transport outage retries (bounded); an exhausted outage records a skip.

## Deferred: the gating grader

The gating discrimination check — N samples with a calibrated pass-rate threshold over a case corpus,
the grader `KIND` `spec-judge-discrimination` wired into `eval/grader.mjs`, and its
`eval/seam-registry.json` row — is the sibling calibrated-corpus ticket's scope. This directory
commits the seam's case pair and oracles so that ticket has a starting frontier; it does not add the
grader `KIND` (only a calibrated corpus can certify a stochastic judge, and a `designed`-status KIND
with no calibrated frontier would gate nothing).
