# ADR 0108 — Deterministic prep-time build-tier layers over (never subsumes) confidence routing, tier-keyed effort matcher supersedes ADR-0050's sketch

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-12
- **Issue:** FAFF-417

## Context

Per-ticket model+effort routing exists only as `models.build_by_confidence` (FAFF-334), keyed on
the spec's self-rated `confidence:` line. FAFF-411's spike measured that signal directly against a
148-issue corpus: 128/134 rated specs say `high` (r = −0.15 vs diff size) — confidence is a near-
constant, carrying almost no routing information. The same corpus showed mechanical spec-structure
signals *do* predict build shape: `spec_lines → lines_changed` r = 0.557, `done_items` r = 0.346,
`scenario_count` r = 0.338. Meanwhile `effort.build` (FAFF-416) is a per-run scalar whose per-issue
matcher ADR-0050 explicitly deferred, sketching a key (`effort.build_by_confidence`) on the same
dead signal FAFF-411 has since discredited. A routing signal keyed on producer self-rating repeats
the confidence mistake; the ticket needs a signal computed *from* the spec by a tool, not asked *of*
the spec producer, and the effort matcher's key needs to move before it's ever wired.

## Decision

The per-ticket routing signal is a deterministic prep-time build-tier, layered over — never
subsuming — confidence routing. A pure CLI classifier (`bin/lib/tier.js`: `tier()` / `tierScore()` /
`extractSpecFeatures()`) computes a weighted-linear score over spec-native features
(`spec_lines`, `done_items`, `scenario_count`, plus a confidence prior and an optional gate-history
prior) and buckets it into exactly three tiers — `mechanical | standard | complex` — via two
corpus-derived tertile cut points. faff-prep stamps the result as a retained `build-tier:` line
adjacent to `confidence:` at every attach/reattach/refresh site, mirroring the house retained-line
precedent (`confidence:`, `spec-review:`) rather than minting a new value-carrying label family.

Two new optional `.faffrc` matchers, `models.build_by_tier` and `effort.build_by_tier`, resolve
per-issue model and effort exactly on the `models.build_by_confidence` fallback-chain pattern
(`<tier> → .default → scalar → inherit`, every configured leaf validated fail-loud up front). Both
outrank their confidence/scalar counterparts when a tier is present: `models.build_by_tier` is
consulted before `models.build_by_confidence` (FAFF-334 stays shipped and untouched underneath it,
never deleted); `effort.build_by_tier` **supersedes** ADR-0050's sketched `effort.build_by_confidence`
key outright — that sketch pinned the *pattern* ("mirror the model lanes"), not the key, and it
predates the evidence that confidence is a near-constant. No `effort.build_by_confidence` key is
ever created. An absent tier (legacy spec, matcher unconfigured) skips the tier matcher and falls
through the existing chain, logged, never guessed. With no `*_by_tier` config set, dispatch is
byte-for-byte unchanged from today.

## Consequences

- `models.build_by_confidence` (FAFF-334) remains a fully supported, independently configurable
  matcher — this decision layers a more-informed key above it, never retires it. A repo may run
  either matcher alone, both together (tier wins on a tie), or neither.
- ADR-0050's per-lane effort mirroring stands; only its sketched per-issue matcher *key* is
  superseded. Any future prose or config referencing `effort.build_by_confidence` as the intended
  per-issue effort key is stale — the shipped key is `effort.build_by_tier`.
- The tier is routing-only: it never gates promotion, parking, or merge, and every tier still
  builds. A `build-tier:` misclassification costs a wrong model/effort pick, never a blocked ticket.
- The three-bucket cap and the corpus-derived weights/cuts are a coarse, un-tuned-priors seed
  (r ≈ 0.56 ceiling on the strongest single feature); FAFF-413 owns retuning `confidence_adj` and
  `gate_history` weights against live outcomes. Widening beyond three tiers to compensate for
  misclassification is an anti-pattern the spec calls out explicitly — retune the params instead.
- Both executor SKILL.mds and beep-boop's partition-entry annotation step gain a second per-issue
  signal (tier) alongside confidence; a collision-chain's per-issue model/effort resolves to its
  most-demanding member (highest tier), mirroring the existing lowest-confidence rule — any future
  third per-issue axis should follow the same most-demanding-member precedent rather than inventing
  a new collision rule.
- `bin/lib/tier.js`'s pure action surface (`tier`/`tierScore` iterating `params.w` generically rather
  than hardcoding feature names) is deliberately shaped to be reusable by a future build-native
  parameterisation (FAFF-413) — a second caller can pass a different `params.w` without touching the
  classifier itself.

confidence: high
