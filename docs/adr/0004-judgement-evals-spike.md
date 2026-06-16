# ADR 0004 — Judgement-eval spike: is the skill-judgement surface flaky?

- **Status:** Accepted (measured). The judgement-eval harness was built (FAFF-130) and run for real on the frontier model (FAFF-131); the numbers below are measured, not pending.
- **Date:** 2026-06-15 (measured) · scaffold 2026-06-14.
- **Tickets:** FAFF-130 (harness) · FAFF-131 (run + this ADR) · FAFF-132/133/134/135/136/137/138/140/142/143/144 (driver/criteria/auth/oracle build-out) · follows ADR 0003 · unblocks FAFF-114 (lean-prompts).
- **Relates:** ADR 0003 left three lanes open; this is lane 2 (judgement-on-frontier) and lane 3 (local-LLM), now both measured.
- **Amended:** 2026-06-15 — wider-suite scope addendum; 2026-06-16 — full-suite frontier baselines, all 12 kinds (see below); original decision unchanged.

## Context

ADR 0003 measured **0% kernel flakiness** — *because* skills route routing decisions into the deterministic `faff` CLI rather than judging in-head — and flagged that "the flakiness that actually matters is unmeasured": the **judgement residue** (`vague`/`dupe`/`stale`/`superseded` classification, `pick-ordering`, synthesis gloss). This spike measures that residue with offline evals, to settle the **live-driver-vs-judgement-evals fork** with numbers.

The harness (`eval/`): an injectable driver → a two-tier **deterministic** grader (closed-set set-equality, ordering rank-correlation, gloss synonym-set rubric) → 12 cases (2/kind) → `run-evals` orchestration. Judgement is captured out-of-band via a `faff-eval:judgement` envelope so the FAFF-93 seam-only invariant holds. Flakiness = per-case **signature stability** across K reps. The eval prompt carries faff's *real* shipped criteria (faff-tidy classification + the synthesis-gloss contract, read verbatim from the plugin), so it measures the shipped judgement, not an improvised one. See `eval/README.md`.

Two driver lanes were built and measured:
- **frontier** — `claude -p` against the Anthropic API (real Opus), plugin-loaded, OAuth-forwarded (FAFF-138). The production-shaped number.
- **local-direct** — a direct ollama `/api/chat` completion (FAFF-136/144), `qwen3.6:27b-mlx` over Tailscale, `think:false`. A cheap model-sweep proxy.

## Measured results

### Frontier (Opus) — K=20 base, escalation→50 on disagreement, 12 cases

| Kind | Accuracy | Stability (1.0 = no flakiness) | Format | Escalated? |
|---|---|---|---|---|
| dupe | 1.00 | 1.00 | 1.00 | no |
| vague | 1.00 | 1.00 | 1.00 | no |
| stale | 1.00 | 1.00 | 1.00 | no |
| superseded | 1.00 | 1.00 | 1.00 | no |
| ordering | 1.00 | 1.00 | 1.00 | no |
| gloss | 0.97 (rubric coverage) | 0.97 | 1.00 | yes (gloss-001) |

**Judgement on the production model is stable.** Five of six kinds show **zero flakiness** — deterministic-grade reproducibility across 20+ reps, echoing ADR 0003's 0% kernel result. The lone variance is the **free-text synthesis gloss** at 0.97: gloss-001 escalated to 50 reps → **47 scored 1.00, 3 scored 0.80** (omitted one required concept). That is inherent free-text generation variance, not a classification failure (gloss-002 = 1.00). **Format adherence is perfect** (the FAFF-137 output-hardening + strict-or-classify envelope fallback).

### Local (qwen3.6:27b-mlx, direct `/api/chat`) — K=5, 12 cases

| Kind | Accuracy | Stability | Format |
|---|---|---|---|
| gloss | 1.00 | 1.00 | 1.00 |
| ordering | 1.00 | 1.00 | 1.00 |
| stale | 1.00 | 1.00 | 1.00 |
| vague | 1.00 | 1.00 | 1.00 |
| dupe | **0.40** | **0.50** | 1.00 |
| superseded | **0.50** | **0.70** | 1.00 |

**The split is the headline.** The cheap local model **matches frontier on the 4 single-issue-property kinds** (gloss / ordering / stale / vague), but **fails and is flaky on the 2 relational kinds** — `dupe` and `superseded`, which require cross-issue reasoning ("are these the same?" / "did another ticket supersede this premise?"). This is the **only judgement flakiness observed anywhere** in the spike: model-and-kind-dependent, on the *hard* kinds of the *small* model. Format adherence is 1.00 on local too — the hardened prompt is model-independent.

### Cost

| Lane | reps | est output tokens | $/run | per-rep (warm) | wall |
|---|---|---|---|---|---|
| frontier (K=20) | ~270 | ~27,800 | Opus tokens | ~3.7 s | ~15–20 min |
| local-direct (K=5) | 60 | ~5,000 | **$0** | ~11 s | ~11 min |

Frontier is fast and cheap enough that the full run is a *minutes* job (the original "240 reps = unbounded cost" fear was wrong once the driver was right). Local is free and viable for sweeps.

### Gloss judge↔human delta

No separate LLM-judge pass was needed: the gloss is graded by a **deterministic synonym-set rubric** (FAFF-142) — a hand-authored "human" oracle of must-include/must-avoid concept sets (accepting synonyms, e.g. *throttle* = *rate-limit*). Reported gloss accuracy **is** that rubric pass-rate (frontier 0.97, local 1.00 @ K=5). The advisory LLM-judge stays out of the load-bearing path per spec Decision 3.

### The harness caught its own test-data bugs

Worth recording: the first frontier run scored `gloss` and `stale` a stable 0.00. Diagnosis (raw model output) showed **the model was right and the eval was wrong** in three ways — a missing synthesis-gloss prompt injection (FAFF-140), two `stale` fixtures mislabeled (premise-gone = *superseded*, not stale — FAFF-140/143), and a keyword-brittle gloss oracle (FAFF-142). A judgement eval that surfaces defects in its own oracle is doing its job.

## Decision

**Fork: evals-only** (for the production/frontier model). The harness's own guidance — *"if per-kind stability is high, targeted evals suffice; a full live-driver integration is not yet warranted"* — applies: frontier judgement is stable (5/6 perfect, gloss 0.97), so the offline eval is a sufficient regression net. The **live-driver** (FAFF-135, the FAFF-122 lane) is **built and available** for spot faithfulness checks, but is **not** the standing mechanism. The **local-direct** lane (FAFF-136/144) is the cheap sweep for the property-kinds.

Concretely:
- **Adopt `eval/` as the standing judgement-regression net**, run on the **frontier** driver (fast, stable, faithful).
- **Use local-direct for breadth** (model sweeps, CI-free spot runs) on the 4 property-kinds; **distrust local on dupe/superseded** — relational judgement needs the frontier model.
- **Keep the live-driver in reserve**; revisit only if a future change makes a kind go stable→flaky on frontier.

## Consequences

- `eval/` exists, is CI-excluded (no real-model calls in `node --test`), and its deterministic grader + orchestration are covered free by `test/eval-grader.test.mjs` / `test/eval-cli-driver.test.mjs` / `test/eval-ollama-model.test.mjs`. `npm test` cost unchanged.
- **FAFF-114 (lean-prompts) has its safety net + baseline.** The frontier K=20 numbers are the pre-edit baseline (recorded on FAFF-114): classification + ordering at a hard 1.00/1.00 (any post-edit drop = regression), gloss at 0.97 (watch it doesn't slide), format at 1.00. Re-run `node eval/run-evals.mjs --driver frontier` after the lean-prompts edits and diff per-kind.
- Frontier judgement-flakiness is a *measured* 0 on five kinds — the lean-prompts edits can proceed with the eval as the gate.

## Costed follow-ups

- **Promote `eval/` to a standing on-demand suite** for the lean-prompts chain (the immediate consumer, FAFF-114) — a small "compare against the committed baseline" affordance would make it a mechanical gate.
- **Widen fixtures, especially relational kinds** — `dupe`/`superseded` are where the local model wobbles and where 2 cases/kind is thin; more relational cases would sharpen the local-vs-frontier line and any future regression signal.
- **FAFF-139** — clean up the per-rep `cfgDir`s (now holding forwarded credential copies on the frontier lane); minor hygiene before any large unattended run.
- **Optional** — a full local K=20 (now known to be ~45 min, not hours) if a tighter local stability estimate is wanted; the K=5 split is already decisive.

## Addendum 2026-06-15 — wider-suite scope

> Added after acceptance. This **qualifies the scope** of the Decision above; it does not reverse it. The evals-only-on-frontier decision **stands for the isolatable classification surface**.

The "evals-only" decision was measured on faff-tidy's classification surface only. Extending judgement-eval coverage to the rest of the suite (FAFF-145) surfaced a scope limit worth recording:

1. **The black-box eval lane does not execute the skill.** `eval/cli-driver.mjs` (`loadTidyJudgementProse` / `loadSynthesisGlossProse`) reads the rubric **verbatim** from the shipped `SKILL.md` into a one-shot prompt (`buildEvalPrompt` = rubric + fixture + `EVAL_MODE_INSTRUCTION`). The plugin is loaded via `--plugin-dir`, but **`/faff-tidy` is never invoked** — `EVAL_MODE_INSTRUCTION` asks the model to "run the judgement pass over this fixture internally." So the harness measures *model + extracted-rubric + fixture*, **not the skill as orchestrated**.
2. **"Evals-only" therefore holds only for the *isolatable classification* surface** — judgement faithfully reproduced by "apply this rubric paragraph to this fixture." Lane selection (evals-only vs live-driver) is a **per-surface call**, not a global one.
3. **Execution-entangled surfaces likely need the live-driver (FAFF-135), which this ADR benched.** Examples: faff-prep live-thread reconciliation (`Challenge`/`Resolution`/`Context`/`Noise`); faff-graft review verdict + the revert test; beep-boop/routing six-verdict assignment; faff-jot/faff-plot shaping & decomposition. For these the inlined-rubric proxy is not a faithful test.
4. **FAFF-145's children (FAFF-146–150) are tagged per-surface.** Building the live-driver-lane slices is what decides whether the live-driver comes off the bench. Until then, treat "evals-only" as scoped to isolatable classification.

## Addendum 2026-06-16 — full-suite frontier baselines (all 12 kinds)

> Added after the FAFF-145 children landed (FAFF-146/147/148/149/150/158). The original "Measured results" table (FAFF-131) baselined six kinds; this records the **measured frontier baseline for every kind now in `eval/cases/`** — the per-surface human-supervised run the kind-adding tickets each deferred. The Decision above is unchanged.

**Run:** `claude -p` frontier (Opus), full suite, **30 cases / 12 kinds**, K=20 base, escalation→50 on disagreement. Plugin-loaded, OAuth-forwarded (FAFF-138). One run, ~45,100 est. output tokens, status `complete`. Report: `eval/report/full-standings-frontier.json`.

| Kind | Cases | Accuracy | Stability | Format | Escalated | Newly baselined here? |
|---|---|---|---|---|---|---|
| confidence | 3 | **0.93** | **0.93** | 1.00 | confidence-001 | yes (FAFF-146) |
| dupe | 2 | 1.00 | 1.00 | 1.00 | no | reproduced (FAFF-131) |
| gloss | 2 | 0.99 | 0.99 | 1.00 | gloss-001 | reproduced (FAFF-131) |
| marker | 2 | 1.00 | 1.00 | 1.00 | no | yes (FAFF-146) |
| modedetect | 3 | 1.00 | 1.00 | 1.00 | no | yes (FAFF-150) |
| ordering | 2 | 1.00 | 1.00 | 1.00 | no | reproduced (FAFF-131) |
| routing | 6 | 1.00 | 1.00 | 1.00 | no | yes (FAFF-149/158) |
| splittable | 2 | 1.00 | 1.00 | 1.00 | no | yes (FAFF-147) |
| stale | 2 | 1.00 | 1.00 | 1.00 | no | reproduced (FAFF-131) |
| superseded | 2 | 1.00 | 1.00 | 1.00 | no | reproduced (FAFF-131) |
| vague | 2 | 1.00 | 1.00 | 1.00 | no | reproduced (FAFF-131) |
| verdict-revert | 2 | 1.00 | 1.00 | 1.00 | no | yes (FAFF-148) |

**What this confirms.** The five new closed-set kinds — `marker`, `splittable`, `verdict-revert`, `routing` (all six fixtures), `modedetect` — are a hard **1.00/1.00** on frontier, matching the original-six pattern. The original six reproduce (gloss now 0.99 vs the recorded 0.97; same free-text story below). So the "evals-only-on-frontier" net extends cleanly across the whole suite for the closed-set surfaces.

**The one wobble worth flagging — `confidence` is not perfect.** confidence-001 escalated to 50 reps and split **40× correct / 10× wrong** (accuracy 0.80, stability 0.80; the other two confidence fixtures are 1.00/1.00, so the kind means 0.93). This is the **first sub-perfect *closed-set* case observed on frontier** — every prior frontier miss was the free-text gloss. confidence is a graded judgement (`high`/`medium`/`low`) where the boundary case genuinely flips run-to-run on Opus. Treat confidence-001 as a live flakiness signal: it is a thin (single-fixture) result, so **widen the confidence fixtures before leaning on confidence as a hard gate**, and re-measure.

**gloss is the same inherent free-text variance, not a regression.** gloss-001 escalated to 50 reps → **49× 1.00, 1× 0.80** (one rep omitted a required concept). This is the FAFF-131 phenomenon (then 47/50), not a slide; gloss-002 = 1.00. Format adherence is **1.00 across all 12 kinds** — the FAFF-137 hardening holds suite-wide.

**Scope caveat carries over.** Per the 2026-06-15 addendum, these are **black-box** numbers (model + extracted-rubric + fixture), not the skill-as-orchestrated. routing/verdict-revert/reconciliation are execution-entangled surfaces whose *faithful* measurement is the live-driver lane (FAFF-135/158); this baseline is the isolatable-classification proxy, recorded as the standing regression net.
