# ADR 0086 — Offline-proxy production error-rate machinery for the holdout judge (FAFF-625)

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-07-24 (machinery); **updated 2026-07-25** with the production sweep's measured number
- **Issue:** FAFF-625

## Context

ADR-0029 GO-narrowed machine DoD-verification for L4 on a **diff-as-text strawman** (0/155 negative
judgements, ~1.9% rule-of-three upper bound) — not the shipped, recordings-driven holdout judge. FAFF-563
built the measurement lane for the shipped judge (the SeededDefectCase fixture format, the deterministic
`eval/score-error-rates.mjs` scorer, the measurement protocol, and a five-case pilot proving the loop
closes) but deliberately produced no citable rate — the pilot is a plumbing proof, not a corpus.

FAFF-625 was scoped to run that lane at ADR-0029's named production scale (≥300 negatives, weighted
toward the `subtly-wrong` / `working-but-off-spec` strata, plus ≥60 clean) and record the resulting
`ErrorRateReport` as the first citable, labelled offline lower bound for the shipped judge.

## Decision

**Ship the offline-proxy production machinery, corpus, and the production frontier sweep's measured
result.** The machinery below was built and merged first; the sweep itself was gated on human-approved
frontier spend, which arrived after this ADR's initial Proposed record. That approval has now been spent:
`node eval/run-evals.mjs --cases-dir eval/cases-seeded --reps 1 --driver frontier` ran to completeness
(all 450 corpus cases graded, 0 skipped) against the pinned `models.eval` lane (**`claude-opus-4-8`**),
scored via `eval/score-error-rates.mjs`, and committed to
`eval/error-rates/2026-07-25-offline-frontier.json`.

**The measured offline-proxy lower bound:**

| Metric | Value |
|---|---|
| Negatives (n) | 360 |
| Positives (n) | 90 |
| False-pass (cardinal) | **0 / 360** — rate 0, 95%-upper (rule-of-three) **0.83%** (3/360) |
| False-fail (non-cardinal) | 65 / 90 — rate 72.2% |
| Driver / model | frontier / `claude-opus-4-8` |
| Reps | 1 (breadth, per ADR-0029 methodology) |

**Per-stratum false-pass (all four defect classes, n=90 each):**

| Defect class | n | False-pass | Rate |
|---|---|---|---|
| `missed-criterion` | 90 | 0 | 0 |
| `subtly-wrong` | 90 | 0 | 0 |
| `working-but-off-spec` | 90 | 0 | 0 |
| `spec-satisfying-but-broken-elsewhere` | 90 | 0 | 0 |

Zero false-passes across every stratum, including the subtle ones the corpus deliberately over-weighted,
is the reportable headline: on this offline, recordings-fixed surface the judge never accepted a case with
an observable defect. The upper-95 rule-of-three bound (0.83%) improves on ADR-0029's diff-as-text 1.9%
bound and is now measured against the **shipped, recordings-driven judge**, not a strawman.

**The false-fail rate (72.2%) is a valid, reportable finding, not a measurement failure.** Per the spec's
design principle ("false-pass is cardinal; false-fail merely parks"), a high false-fail rate means the
judge frequently routes clean cases to `needs-human` rather than confidently passing them — costly to
review throughput, but never a correctness risk to the L4 trust story the way a false-pass would be. This
is flagged as a candidate follow-up finding (see Residuals) rather than auto-filed, per the spec's
"surfaced, not auto-filed" rule for non-zero/notable rates.

This build also verified and retained everything the spec scoped as prerequisite machinery:

- **The production corpus** — `eval/cases-seeded/` (450 cases: 90 clean, 360 defective — 90 per stratum
  across all four defect classes, clearing every floor the spec's "Chosen:" settlement named — ≥300
  negatives with ≥90/≥90/≥60/≥60 per-stratum weighting, and ≥60 clean — with margin), authored by the
  committed generator `eval/gen-cases-seeded.mjs` across 24 distinct domains (HTTP APIs, CLI tools, batch
  ETL, auth flows, data pipelines, notifications, webhooks, queues, rate limiting, caching, cron,
  config/migration tooling, permissions, audit logging, sessions, payments, search, uploads, alerting,
  backup/restore) so the corpus is not a single flattering scenario re-skinned.
- **The harness delta** — one additive `--cases-dir <dir>` flag on `eval/run-evals.mjs`'s plain-sweep CLI
  entry, routing the already-parameterised `loadCases(dir)`. `--gate`, `--against`, `--update-baseline`
  (including the FAFF-318 `--resume` sub-mode), and `--compare` are untouched — each still calls
  `loadCases()` with no argument, byte-identical to before this change.
- **The offline, deterministic test coverage** the spec's DoD names: a corpus-lint test (floor counts,
  `validateSeededCase`, id uniqueness/disjointness from the pilot, pairwise-distinct fixture bodies,
  oracle↔`expected_aggregate` re-derivation via the shipped `deriveHoldoutAggregate`), the FAFF-563
  teaching-to-the-test leakage assertion extended over the full production corpus, a `--cases-dir` routing
  + flag-absent byte-identity test, and the spec's mock-driver integration smoke (1 clean + 1 defective
  through `runEvals` → `score-error-rates.mjs`, closing the loop end to end without a frontier call).

**FAFF-317 caveat (verbatim, attached to the report and restated here):** "offline-proxy
(holdout-exercise recordings): per FAFF-317 this measures the judge's criteria-mapping + met/unmet
reasoning over a FIXED recorded surface, NOT the live agentic end-to-end sensitivity the L4 trust story
needs (FAFF-629). Do not cite as the live rate." The bound above is a **lower bound on reasoning quality**,
never the live sensitivity — FAFF-629 stays the honest live number's home. Any citation of this ADR's
number without that caveat is a defect per the spec's own design principle.

## Consequences

- **The shipped judge now has a citable offline production rate.** ADR-0029's ~1.9% bound was measured
  against a diff-as-text strawman; this ADR extends the measurement record to the shipped,
  recordings-driven judge with a tighter bound (0/360 false-pass, 0.83% upper-95) at production scale. The
  trust story may now cite: "the judge's offline reasoning surface measured a 0/360 false-pass rate (upper
  bound 0.83%; lower bound on reasoning quality; live lane pending FAFF-629)" — never as the live rate.
- **The corpus is reviewable and reusable independent of any future re-run.** Because `eval/cases-seeded/`
  is outside `eval/cases/` and gated behind the additive `--cases-dir` flag, it costs nothing extra on any
  ordinary sweep, regression gate, or re-baseline — the FAFF-563 cost-contamination principle holds, and
  the same corpus can be re-run cheaply (relative to a fresh authoring pass) if the judge changes.
- **The false-fail rate (72.2%) is a flagged, non-blocking finding**, not a follow-up ticket auto-filed by
  this build — per the spec's "surfaced, not auto-filed" rule, it is named here as a candidate for a human
  to scope (e.g. why the judge routes so many clean cases to `needs-human` rather than a confident pass;
  whether that is itself a judge-prompt tuning opportunity, explicitly out of scope for this ticket).
- **FAFF-629 (the live agentic lane) is unaffected and stays gated on FAFF-474** as scoped; a strong
  offline bound does not substitute for the live number — it only informs whether FAFF-629's full-scale
  live lane is proportionate, which is FAFF-629's call to make.

### Residuals (carried + new)

- **Independent ground-truth audit (ADR-0029 residual, unchanged).** The corpus is builder-labelled
  (generator-authored, not independently re-reviewed) — same posture ADR-0029's corpus had.
- **Local-model / cost characterisation (ADR-0029 residual, unchanged).** Frontier lane only; not
  addressed here.
- **NEW — the live agentic lane (FAFF-629) remains the honest end-to-end sensitivity number's home.** This
  offline lower bound informs but does not discharge it.
- **NEW — the high false-fail rate (72.2%) is an unscoped candidate finding**, surfaced for a human to
  triage into a follow-up ticket if judge-prompt tuning is warranted; not auto-filed by this build.
