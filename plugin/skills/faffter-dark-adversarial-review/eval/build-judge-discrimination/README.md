# Build-judge discrimination seam

The committed discriminating case pair the build-review adjudicator's judge-quality eval seam
consumes (FAFF-996), mirroring the spec-side `spec-judge-discrimination` precedent one altitude
down. Two blinded case files, in the exact shape `faff build-judge-evidence --assemble` emits,
with pinned exact-ruling oracles in `oracles.json`:

- `case-defect.json` — a genuine critical: the fix reordered a claim-then-checkpoint call but left
  an interleaving race window, and Argument A names the concrete residual defect with evidence.
  Oracle: the ruling must **not** be `OVERTURN` (i.e. `UPHOLD` or `PRODUCT_BOUNDARY`).
- `case-false-positive.json` — a FAFF-995-shaped false positive: the finding claims a required
  code change is absent, citing the wrong file's comment-only hunk, while Argument B's evidence
  shows the real change already landed and is visible in the repository evidence. Oracle: the
  ruling must be `OVERTURN`.

The defect-half catches a constant-`OVERTURN` judge; the false-positive-half catches a
constant-`UPHOLD` judge.

## Advisory in-ticket run (non-gating)

Mirrors the spec-side seam exactly: a single stochastic sample cannot certify a probabilistic
judge, so neither a mismatch nor an outage-skip gates the build. A transport outage retries
(bounded); an exhausted outage records a skip.

## Registered seam (FAFF-996)

The grader KIND `build-adjudication` is registered in `eval/seam-registry.json` as
`status: "designed"` (surface `faffter-dark-adversarial-review`), so `faff validate-adapters`
accounts for this seam with an honest `NEEDS-CASES` advisory (the top-level `eval/cases/`
directory, which the registry's `covered` status counts, carries no case for this KIND — the
committed pair here is the per-skill fixture the advisory in-ticket run reads directly, the same
split the spec-side `spec-judge-discrimination` row already establishes). The occupant's
`SKILL.md` frontmatter declares `judgement_seam: refutation-code, adr-drift, prdr-yagni,
build-adjudication`.

## Deferred: the gating grader

The **gating** discrimination check — N samples with a calibrated pass-rate threshold over a
case corpus (flipping this row `designed` → `calibrated`, plus a live-driver grader adapter) is
deferred, same as the spec-side sibling. Recording or accepting a baseline value is a separate,
human-supervised step. This directory's committed case pair and oracles are that follow-up's
starting frontier.
