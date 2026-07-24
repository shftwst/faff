# ADR 0086 — Offline-proxy production error-rate machinery for the holdout judge (FAFF-625)

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-07-24
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

**Ship the offline-proxy production machinery and corpus now; the production frontier sweep itself did
not run in this build.** This build (an unattended `/faff-beep-boop` autonomous run) had no verified
frontier access/spend budget available to it — the spec's own build-start assumption ("frontier access
and budget are available at build time for ~360 judgement calls … on sustained frontier unavailability the
run parks rather than substituting an unpinned model") is exactly the condition this run is under. Per
that assumption, this build does **not** fabricate a measurement, does **not** invent a resolved model
name, and does **not** write a `eval/error-rates/*.json` report with placeholder or synthetic numbers.
Instead it ships everything the spec scoped as prerequisite to running the sweep for real:

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

**What is explicitly NOT in this build:** the real `node eval/run-evals.mjs --cases-dir eval/cases-seeded
--reps 1 --driver frontier` sweep, the committed `eval/error-rates/<date>-offline-frontier.json` report,
and this ADR's own Accepted status with the measured false-pass rate, the per-stratum table, and the
resolved `models.eval` name. Those are the follow-up: an operator (or a build run with confirmed frontier
budget) runs the sweep per spec §4 HOW, scores it, commits the report, and updates this ADR from Proposed
to Accepted with the actual numbers — at that point it extends this record in place (the same document),
not a new one, since the corpus/harness decision recorded here does not change.

**FAFF-317 caveat (carried forward, verbatim, for when the number lands):** "offline-proxy
(holdout-exercise recordings): per FAFF-317 this measures the judge's criteria-mapping + met/unmet
reasoning over a FIXED recorded surface, NOT the live agentic end-to-end sensitivity the L4 trust story
needs (FAFF-629). Do not cite as the live rate." Whatever bound the eventual sweep measures is a **lower
bound on reasoning quality**, never the live sensitivity — FAFF-629 stays the honest live number's home.

## Consequences

- **No citable offline production rate exists yet.** ADR-0029's ~1.9% bound remains the only measured
  number on record, and it still belongs to the diff-as-text strawman, not the shipped judge. Any citation
  of judge sensitivity today is still either borrowed from the wrong apparatus or unmeasured — this ADR
  does not close that gap, it removes every non-frontier-budget blocker to closing it.
- **The corpus is reviewable and reusable independent of when the sweep runs.** Because `eval/cases-seeded/`
  is outside `eval/cases/` and gated behind the additive `--cases-dir` flag, it costs nothing extra on any
  ordinary sweep, regression gate, or re-baseline — the FAFF-563 cost-contamination principle holds.
- **The next action is mechanical, not exploratory.** Whoever picks this up next runs exactly the
  procedure in the FAFF-625 spec §4 (`run-evals.mjs --cases-dir eval/cases-seeded --reps 1 --driver
  frontier`, score, commit the report, update this ADR) — no design decision remains open.
- **FAFF-629 (the live agentic lane) is unaffected and stays gated on FAFF-474** as scoped; this ADR's
  incompleteness does not change that gating.

### Residuals (carried + new)

- **Independent ground-truth audit (ADR-0029 residual, unchanged).** The corpus is builder-labelled
  (generator-authored, not independently re-reviewed) — same posture ADR-0029's corpus had.
- **Local-model / cost characterisation (ADR-0029 residual, unchanged).** Frontier lane only; not
  addressed here.
- **NEW — the production frontier sweep has not been executed.** This is the residual this ADR exists to
  flag: the machinery and corpus are complete and tested; the measurement itself is pending an operator
  (or a future build) with confirmed frontier budget. Tracked by FAFF-625 remaining open until the sweep
  runs, the report is committed, and this ADR is updated to Accepted.
