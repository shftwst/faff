# FAFF-411 — Spike: calibrate build-model downgrade (does spec confidence predict build cost/quality?)

> Spec: faffter-dark-nlspec · 2026-07-10 · confidence: medium · spec-review: approve

This is the buildable experiment design for **FAFF-411 — Spike: calibrate build-model downgrade**. FAFF-411 is a **spike**: the deliverable is an answer (a Results write-up) plus a seeded, deterministic decision method — not a code feature. The spike splits into **two phases**: a **retrospective** predictor study you can run now against existing specs + run artifacts (Phase 1), and a **gated forward** model A/B that only runs if Phase 1 says it's worth it (Phase 2).

## 1. WHY — Problem and Principles

faff can already route the build model per issue off the spec's **self-rated confidence** (`build_by_confidence`, resolved by `faff models build-for <confidence>`, wired into both concurrency executors — `bin/faff:1013-1064`). The machinery shipped but is **switched off**: the live `.faffrc.yaml` has no `build` lane, so every build inherits Opus. This spike measures whether that single self-rated input predicts build outcomes, whether cheaper builds are net-cheaper *once waste is counted*, and — the deeper goal — **which spec signals a deterministic, self-tunable classifier should key on** so faff can eventually own its own model/effort/local routing.

**The reframe — two questions with different data needs.**
- **Q1 — does the predictor work?** Which spec signals predict a build's shape / cost / rework? Both halves already exist in history (the committed spec = prep-time input; run artifacts = post-hoc actuals), so **Q1 is retrospective**.
- **Q2 — is the downgrade a net win?** Sonnet has never run, so **Q2 must be forward**.

Phase 1 answers Q1 and de-risks Phase 2; Phase 2 answers Q2 only if Phase 1 warrants it.

**Design principles.** Deterministic tools over prose (the promote decision + tier classifier are pure functions); count the cost of failure not just success (per-attempted-issue); fidelity is the veto (tunable); trust no telemetry you haven't watched fire; the primary output is retrospective.

## 2. OUT OF SCOPE
- Haiku as a first-class arm (opportunistic side-note only).
- Local model for build measurement (lever vocabulary stays open, not measured).
- `effort` as a measured arm (never varied in history — keep fixed so model is the only variable).
- Building the automated prep-time classifier (FAFF-417).
- Building the self-learning controller / sliding-window config-owner (FAFF-413 + a new initiative).
- Fixing telemetry wiring gaps (record + fall back, don't fix — FAFF-415/418 follow-ons).

## 3. WHAT — Vocabulary, Types, Interfaces

**The config change under test** (the only `.faffrc` artifact — surgical, additive, reversible):

```yaml
models:
  build_by_confidence:
    default: opus
    high: sonnet
    medium: opus
```

**Read-safety footnote.** `default: opus` does not protect against an *unparseable* confidence line (the reader defaults missing/unparseable → `high` → sonnet). Handled analysis-side by the Confidence-read guard, not this default.

**The deterministic decision function.** `promote_decision(ArmOpus, ArmSonnet, params) -> { verdict: promote | hold | inconclusive, score, per_lever_reasons }` — pure; its `promote_model` param block is the future controller's objective + action surface.

**The tier classifier.** Split into (judgement, cached) feature-extraction and a pure `tier(features, params) -> bucket`. Whether mechanical features alone predict well enough to skip judgement is an **output** of this spike.

Both runnable functions live as **standalone spike scratch scripts** over the run-dirs, NOT wired into the product build path (that is FAFF-417 / FAFF-413).

## 4. HOW — the experiment method

### Phase 1 — Retrospective predictor + classifier seed (run now; high N; near-zero cost)
Gather done tickets with BOTH a committed spec AND run artifacts; extract prep-time spec features + frozen judgement features; extract post-hoc actuals (diff, outcome, rework, cost via `faff economics --run-dir`); predict from spec-features, corroborate against actuals; report ranked signal→outcome table, confidence's real predictive value, estimability gap, determinism verdict, and calibrated seed `tier` params.

**Survivorship handling.** Done tickets all shipped → park/needs-human failure class is absent. Do the clean shape/cost/rework cut first; report Q1 as "predictor answered for shape/cost/rework; failure-outcome predictor deferred", never "Q1 fully answered".

### Phase 2 — Forward model A/B (gated on Phase 1)
Sync origin/main; smoke-check telemetry (elevated to a first-class result — validates whether per-build strategy→outcome attribution fires at all); reconstruct Opus baseline from history; run Arm Sonnet-on-high forward window (one strategy per run-dir); **mandatory work-mix comparability gate** (history-vs-forward admissible only if feature distributions pass, else a same-window forward Opus control is required); collate ArmResult; run `promote_decision`.

## 5. SCENARIOS — born-verifiable objectives
- Given the .faffrc edit, `faff models build-for high` → `sonnet` and `… medium` → `opus`.
- Given the corpus, a ranked signal→outcome predictor table + estimability-gap report + determinism verdict exist.
- Given a fixed feature vector + params, `tier(features, params)` returns the identical bucket twice (pure).
- Given a Phase-2 run, `faff quality`/`faff economics --by effort` return non-empty OR the smoke check records they did not fire and manual-tally fallback is used.
- Given a history baseline + forward window, the comparability gate admits history-vs-forward only on pass, else a same-window Opus control.
- Given both ArmResults, `promote_decision(...)` returns promote|hold|inconclusive deterministically with per-lever reasons.

## 6. DESIGN DECISION RATIONALE
Surgical additive config (not scalar, not wholesale rewrite of the gitignored rc); deterministic pure `promote_decision` (not a prose bar); two-phase structure (retrospective then gated forward); history-reconstructed Opus baseline gated by the comparability check; stratification not curated cohorts; split judgement/deterministic classifier; one strategy per run-dir attribution; spike specifies+seeds, does not build the controller.

## 7. OPEN QUESTIONS AND ASSUMPTIONS
**Open Questions.** None (the promote-authority punt is resolved via the deterministic-function method; determinism-of-classifier and which-signals-predict are outputs).

**Assumptions.** origin/main pulled for Phase 2; committed specs exist for the done corpus; historical artifacts complete enough to reconstruct cost+fidelity; telemetry emits on a real run (else manual-tally); current `.faffrc` has no `build` lane; enough data per phase.

## 8. DONE — Definition of Done

### Phase 1 (retrospective — primary output)
- [ ] Corpus assembled (spec + usable run artifacts; coverage recorded).
- [ ] Per-issue rows: spec-features + judgement features + post-hoc actuals.
- [ ] Ranked signal→outcome predictor table (does confidence predict; which signals predict better) — framed as the seed for FAFF-413/417.
- [ ] Estimability-gap report; determinism verdict (mechanical-only sufficient?).
- [ ] Seed `tier(features, params)` params calibrated + shown pure.
- [ ] Failure-class handled; Q1 reported as shape/cost/rework only.

### Phase 2 (forward — gated)
- [ ] origin/main pulled; telemetry smoke check recorded as controller-buildability finding.
- [ ] `.faffrc` carries the additive block; `faff models build-for high` → sonnet, medium → opus.
- [ ] Opus baseline reconstructed; Sonnet-on-high forward window run (tagged run-dirs).
- [ ] Work-mix comparability gate evaluated + recorded (same-window control where diverged).
- [ ] ArmResult collated; `promote_decision` evaluated; verdict + per-lever reasons written; no promote below min_n_per_arm.

### Boundary
- [ ] No controller or automated classifier built here; the sliding-window config-owner filed as a separate initiative via /faff-jot.

confidence: medium
spec-review: approve
