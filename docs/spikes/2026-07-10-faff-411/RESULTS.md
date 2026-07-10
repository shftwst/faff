# FAFF-411 — Phase 1 (retrospective) Results

**Spike:** does spec self-rated confidence predict build cost/quality — and if not, which spec signals a deterministic tier classifier should key on?
**Phase:** 1 of 2 (retrospective predictor + classifier seed). Phase 2 (forward Sonnet-vs-Opus A/B) is deferred — it needs a week of real Sonnet builds.
**Reproduce:** `node docs/spikes/2026-07-10-faff-411/analyze.mjs --out analyze-output.json` (read-only over the main checkout's `.faff/runs/`, `docs/specs/`, and `faff economics`). Machine output committed alongside as `analyze-output.json`.

---

## Headline

Self-rated **confidence does *not* usefully predict build shape** in this corpus — not because the signal is wrong-signed, but because it is a **near-constant**: of the **134 parseable-confidence specs**, 128 say `high`, 6 say `medium`, **0 say `low`** (a further **17 of the 151 built issues** carry no parseable confidence line at all). A near-constant carries almost no information, so `confidence → lines_changed` lands at r = **−0.15** (correct direction — more confident, smaller diff — but negligible magnitude). The **single best retrospective predictor of diff size is the committed spec's own length** (`spec_lines → lines_changed`, r = **0.557**), with `done_items` (r = 0.35) and `scenario_count` (r = 0.34) close behind. **All three mechanical spec-structural signals beat the judgement self-rating.** Determinism verdict: for *coarse* build-shape tiering, mechanical features are sufficient and confidence adds nothing — but r ≈ 0.56 is moderate, so keep it to three buckets, not a precise oracle.

---

## Corpus & coverage

Assembled from every run-ledger under the main checkout's `.faff/runs/` whose per-issue outcome is a real build outcome (shipped / pr-open / parked / errored — routed-out and unreached-budget excluded).

| slice | count |
|---|---|
| built issues (from ledgers) | **151** |
| with committed spec | 142 |
| with parseable confidence | 134 |
| with git-diff actuals (squash-merge shortstat) | 148 |
| with per-run token proxy | 132 |
| **with a review-verdict artifact** | **14** |
| shipped | 140 |
| non-shipped (6 parked, 5 pr-open) | 11 |

Coverage is strong for **shape** (git actuals, n=148) and adequate for the **cost proxy** (n=132), but **thin for quality/rework** (review-verdict artifacts exist for only 14 issues — they are a recent addition) and **near-absent for failure** (11 non-shipped, no failed/errored builds in the ledgers). This asymmetry drives the Q1 scoping below.

---

## Ranked signal → outcome predictor table

Pearson r, |r| descending. Sign: + = signal up ⇒ outcome up. This is the **seed evidence for FAFF-413/417** — which signals a self-tuning classifier should key on.

| signal (prep-time) | outcome (post-hoc actual) | n | r |
|---|---|---|---|
| **spec_lines** | **lines_changed** | 142 | **0.557** |
| done_items | lines_changed | 148 | 0.346 |
| scenario_count | lines_changed | 148 | 0.338 |
| done_items | findings_major | 14 | 0.26 |
| spec_lines | findings_major | 11 | 0.25 |
| done_items | findings_total | 14 | 0.247 |
| spec_lines | findings_total | 11 | 0.239 |
| scenario_count | findings_major | 14 | 0.227 |
| scenario_count | findings_total | 14 | 0.22 |
| **confidence_num** | **lines_changed** | 134 | **−0.15** |
| done_items | token_proxy | 132 | 0.139 |
| confidence_num | token_proxy | 116 | 0.128 |
| done_items | files_changed | 148 | −0.088 |
| spec_lines | files_changed | 142 | 0.056 |
| confidence_num | files_changed | 134 | 0.016 |
| spec_lines | token_proxy | 124 | 0.011 |
| scenario_count | files_changed | 148 | 0.003 |
| confidence_num | findings_total/major | 11 | n/a (constant — all 11 review-covered issues are `high`) |

**Reading it.**
- **Diff *magnitude* (lines_changed) is the only outcome that any prep-time signal predicts with useful strength**, and spec length wins by a clear margin (explains ~31% of variance; r² = 0.31).
- **Diff *breadth* (files_changed) is essentially unpredictable** from any spec signal (all |r| < 0.09) — how many files a change touches is not legible from the spec.
- **`confidence` ranks near the bottom on every outcome.** Its `→lines_changed` r=−0.15 has the intuitive sign (see the group means below) but is swamped by the degenerate distribution.
- **The `token_proxy` rows are a run-averaged proxy, not per-issue** — every issue in a run shares one averaged cost value (see the Cost section), so their near-zero |r| is structural, not evidence of no relationship.

### Confidence's real predictive value (guarding the defaults-to-`high` read)

| confidence | n specs | n with diff | mean lines_changed |
|---|---|---|---|
| high | 128 | 128 | 329 |
| medium | 6 | 6 | 507 |
| (missing) | 17 | 14 | 250 |

*`n specs` is the confidence-distribution count (128 + 6 + 17 = 151 built issues); the mean is over the rows that also have git-diff actuals — all 128 high and 6 medium, but only 14 of the 17 missing-confidence issues.*

Direction is *right* — medium-confidence specs did produce larger diffs than high — but with **only 6 medium and 0 low specs**, the rating has no dynamic range to discriminate with. The analysis-side confidence read is guarded (unparseable → treated as MISSING, never silently promoted to `high`; `analyze.mjs::extractConfidence`), so this skew is real, not an artifact of lenient parsing. **Practical conclusion: confidence as authored today is a routing input with almost no information content — a classifier keyed on it would behave like "always Opus/Sonnet-by-default."**

---

## Estimability gap (spec-time estimate vs real-diff actual)

Can a spec-time proxy stand in for the actual diff you only learn post-build?

| spec-time proxy | n | r vs actual lines_changed | variance explained (r²) |
|---|---|---|---|
| spec_lines | 142 | 0.557 | ~31% |
| done_items | 148 | 0.346 | ~12% |
| scenario_count | 148 | 0.338 | ~11% |

There **is** a usable spec-time signal, but the gap is real: the best proxy explains ~a third of diff-size variance. That is **enough to *rank* issues into coarse tiers, not enough to *predict* an issue's size precisely.** This is exactly why the seed classifier below emits three buckets rather than a continuous size estimate.

---

## Determinism verdict — do mechanical features alone predict well enough to skip judgement?

**For coarse build-shape tiering: yes.** The three mechanical spec-structural features (`spec_lines`, `done_items`, `scenario_count`) each out-predict the sole judgement signal (`confidence`) on the only well-covered outcome (diff size), and `confidence` is a near-constant that adds nothing on top. A deterministic `tier()` keyed on mechanical features is therefore **at least as good as — and strictly simpler than — trusting the self-rating**, which is the whole point of the split in spec §3.

**Two honest limits on that verdict:**
1. **Ceiling is moderate, not high.** Best r ≈ 0.56 ⇒ mechanical features rank tiers well but are not a precise size oracle. Keep the classifier coarse (3 buckets); do not over-fit thresholds.
2. **"Shape" only.** This verdict covers build *shape/size*. It does **not** extend to *rework* or *failure* — those outcomes are under-covered here (see survivorship) and could still carry judgement-only signal that this corpus can't see.

---

## Cost — why the token predictor is inconclusive (not negative)

`token_proxy` = run-total tokens ÷ admitted issues, i.e. **every issue in a run shares one averaged value** (per-issue attribution isn't emitted — the telemetry gap tracked by FAFF-415/418). By construction it can't correlate with per-issue spec features (all |r| < 0.14). So the **"is a cheaper build net-cheaper once waste is counted?" cost question is not answerable from history** — it is precisely the forward, telemetry-dependent question Phase 2 exists to answer. Recorded, not fixed, per the spike's "record + fall back" principle.

---

## Calibrated seed `tier` params

`tier(features, params) → mechanical | standard | complex` — pure, deterministic (proven by `tier.test.mjs`). Weighted-linear score with two cut points, seeded from this corpus:

- **Weights** (`DEFAULT_PARAMS.w`): file_count 1.0 · lines_changed 0.01 · modules 2.0 · dep_count 3.0 · test_coverage_gap 4.0 · gate_history 5.0.
- **Confidence prior** (`confidence_adj`): high 0 · medium +3 · low +8 · unknown +3 (treated as medium-risk — never as `high`, per the read-safety footnote in spec §3).
- **Cut points** (`DEFAULT_PARAMS.cut`): mechanical ≤ **8**, standard ≤ **14**, else complex — **calibrated to the corpus tertiles** of the real built-issue diff distribution (n=148): p33 ≈ 4 files / 180 lines, p66 ≈ 6 files / 380 lines (p25/p50/p75 files = 3/5/7, lines = 137/273/480). Assumes the full feature set is populated at extraction time.

**Calibration provenance — only two of the six weights (and the cut points) are data-driven.** The cut points, together with the `file_count` (1.0) and `lines_changed` (0.01) weights, are fit to the corpus diff tertiles above — those are the only signals the corpus actually measures. The remaining four weights — `modules` (2.0), `dep_count` (3.0), `test_coverage_gap` (4.0), `gate_history` (5.0) — are **judgement priors, not calibrated**: the corpus carries no per-issue module / dependency / coverage / gate-history telemetry to fit them against. So the tertile calibration only holds while `file_count`/`lines_changed` dominate the score. **FAFF-413/417 must treat those four as un-tuned starting guesses, not corpus-derived** — do not read "calibrated seed" as "all six weights are data-backed."

These are a **seed**, not a finished controller. FAFF-413/417 own re-tuning them against live outcomes; `tier()` is the fixed, pure action surface they tune.

---

## Survivorship caveat (Q1 is NOT fully answered)

Done tickets all shipped: **140 shipped, 6 parked, 5 pr-open, 0 failed/errored** in the built corpus, and review-findings artifacts exist for only **14** issues. So:

- **Shape predictor — answered** (n=148, solid): spec length > done/scenario counts ≫ confidence.
- **Cost predictor — blocked** on per-issue telemetry (proxy is run-averaged); deferred to Phase 2.
- **Rework/quality predictor — directional only** (findings n=11–14): the ordering (done_items/spec_lines top confidence) is *suggestive*, nowhere near significant.
- **Failure-outcome predictor — deferred**: the park/needs-human/failure class is essentially absent from history (survivorship). It cannot be studied retrospectively and is left to a forward window.

**Q1 is answered for build *shape*, partially for cost/rework, and not at all for failure.** This is directional evidence on a real but skewed corpus, not a closed result — never read it as "Q1 fully answered."

---

## Phase-2 readiness note

The `.faffrc` `models.build_by_confidence` block is now **live** (`high → sonnet`, `medium → opus`, `default → opus`), so the next high-confidence build routes to Sonnet. Two Phase-1 findings should shape Phase 2 before it runs: (1) `confidence` is a near-constant `high`, so "route Sonnet on high" will in practice route **almost every build** to Sonnet — the A/B is really "Sonnet-mostly vs Opus-mostly," not a clean high-vs-low split; (2) per-issue cost/quality attribution must be wired (or manually tallied) first, or Phase 2 inherits the same run-averaged blindness that made the cost question unanswerable here.
