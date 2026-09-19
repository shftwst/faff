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

## Registered seam (FAFF-931)

The grader `KIND` `spec-judge-discrimination` is wired into `eval/grader.mjs` and registered in
`eval/seam-registry.json` as `status: "designed"` (surface `faffter-dark-spec-review`), so
`faff validate-adapters` accounts for this seam with an honest `NEEDS-CASES` advisory. The grade
branch's enum-membership gate (an out-of-enum/null ruling can never vacuously pass an `outcome_not`
oracle) is exercised by a runnable test, `test/grader-spec-judge-discrimination.test.mjs`, which reads
this pair's `oracles.json` directly and drives `grade()` over it — so a regression to the fail-open
branch turns a green build red.

## Deferred: the gating grader

The **gating** discrimination check — N samples with a calibrated pass-rate threshold over a case
corpus (flipping this row `designed` → `calibrated`, plus a `LIVE_KINDS["spec-judge-discrimination"]`
live-driver adapter) — is still deferred, as the FAFF-1007-style sibling follow-up. Recording or
accepting the baseline value is a separate, human-supervised step (certifying a stochastic judge
cannot be automated). This directory's committed case pair and oracles remain that follow-up's
starting frontier.
