# Spec — FAFF-171: CI prompt-token budget check

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high.

> Audience: the build agent and human reviewers. A first-slice design for a deterministic, zero-cost CI guardrail that keeps faff's prompt-token footprint from creeping back up after the one-time lean refactor.

## 1. WHY — Problem and Principles

**Problem statement.** The lean refactor (FAFF-114→117) cuts faff's prompt-token footprint once, but nothing stops it creeping back PR-by-PR. The size census (`eval/size-census.mjs`, FAFF-170) is free and deterministic — a `chars/4` proxy, no model call — so unlike the frontier *judgement* gate (FAFF-169, human-run because it spends), the size half can run on every PR in CI. This wires the census into `validate.yml` as a per-PR prompt-token budget check, making leanness continuous rather than a one-off.

**Design principles.**

- **Proportionate — a CI step, not a subsystem.** The whole change is a new flag on an existing tool plus one workflow step. Any design that adds a service, a bot, or a new dependency is rejected.
- **Zero-dependency, reuse the proxy.** The gate reuses the exported pure `diffSizes` and the `chars/4` `est_tokens` proxy — the **percent/delta is the trustworthy figure** (the constant proxy error cancels in a ratio). No new estimator.
- **The committed baseline is the source of truth.** The gate compares against the committed `eval/baselines/prompt-size.json`; recomputing `main`'s census at CI time is racy and defeats the ratchet.
- **The ratchet must be able to click *down*.** A floor that only moves on intentional growth is a ratchet that clicks up — after a shrink it goes slack. The gate prompts the floor to descend on a shrink (nudge-on-shrink).
- **Warn before it fails.** Advisory-first (exit 0, surface the delta); enforcing is an explicit flag once the post-lean floor is settled.

## 2. OUT OF SCOPE

- **The judgement/quality gate** — frontier eval regression is a model-cost gate (FAFF-169, human-run).
- **PR-comment bot** — needs `pull-requests: write`; the advisory surface is the job summary instead.
- **Auto-ratchet in CI (bot commits the lowered baseline)** — needs `contents: write`; deferred (extension point) in favour of nudge-on-shrink.
- **Per-file budgets** — the first slice gates the total; per-file deltas are surfaced, not gated.
- **Non-SKILL.md prompt surfaces** — `skillFiles()` enumerates `plugin/skills/*/SKILL.md`.

## 3. WHAT

New CLI surface on `size-census.mjs`:

```
node eval/size-census.mjs --gate --against <baseline.json> [--budget <N>] [--enforce]
  --gate              run the budget gate (reuses diffSizes)
  --against <path>    REQUIRED — the committed size baseline (the ratchet floor)
  --budget <N>        max permitted net est_token growth over the floor. Default: 0
  --enforce           enforcing mode: exit non-zero on growth > budget. Absent → advisory (exit 0)
```

`evaluateGate(currentCensus, baseline, budget)` (pure) returns `{ before_est, after_est, delta_est, delta_pct, budget, over_by, under_by, status, per_file_deltas }`. `status` is `within` iff `delta_est <= budget`.

Exit contract: `0` within (or advisory-over) · `2` enforcing-over (distinct from operational error) · `1` operational error (missing/malformed baseline).

**Decisions (all Chosen):**
- **Threshold model:** ratchet-down with a small absolute `--budget` tolerance (default 0).
- **Baseline source:** committed `prompt-size.json` via `--against`.
- **Baseline lifecycle:** manual-but-prompted — explicit initial-capture step in this PR; nudge-on-shrink prompts a `--update-baseline` re-commit; same-PR `--update-baseline` for intentional growth. Auto-ratchet-in-CI rejected (needs write perms).
- **Warn vs fail:** advisory by default; `--enforce` opt-in (a one-line `validate.yml` flip).
- **Advisory surface:** `$GITHUB_STEP_SUMMARY` (no write permission).
- **Exit code for gate-fail:** `2` (distinct from operational `1`).
- **Gate location:** a `--gate` mode on `size-census.mjs`, reusing pure `diffSizes`.

## 4. HOW

`evaluateGate` runs `diffSizes`, computes `over_by = max(0, delta-budget)`, `under_by = max(0,-delta)`, `status`. `main()` `--gate` branch: require `--against`; load + validate baseline; parse `--budget` (NaN → throw → exit 1); `emitGateSummary` (markdown-ish, appended to `$GITHUB_STEP_SUMMARY` by the CI step); `within` → 0; over → `--enforce ? 2 : 0`. On a shrink (`under_by > 0`) the summary prints `floor can drop to <after_est> — run --update-baseline to lock it in`.

CI step (advisory-first, before `node --test`): `node eval/size-census.mjs --gate --against eval/baselines/prompt-size.json | tee -a "$GITHUB_STEP_SUMMARY"`.

**Build-time resolution (not foreseen in the spec):** the FAFF-169 frontier-gate regression test (`eval-baseline-gate.test.mjs`) guarded "no `--against` in validate.yml" to keep the *costly* frontier gate out of CI (ADR-0004). FAFF-171's *free* size gate legitimately uses `--against`, so the guard was tightened to target the frontier gate specifically (`run-evals.mjs` / `baselines/frontier`), preserving ADR-0004's intent while admitting the size gate.

## 5. SCENARIOS

- Hold/shrink vs floor → exit 0, "within budget".
- Growth past budget + `--enforce` → exit 2, "OVER BUDGET by N".
- Growth past budget, advisory → exit 0, delta still surfaced.
- Shrink below floor → exit 0 + "floor can drop to <after_est>" nudge.
- Missing/garbage baseline → exit 1 (distinct from the gate verdict 2).

Non-functional: zero dependencies; no network/model call; CI step needs only `contents: read`.

## 8. DONE

- [x] `--gate --against [--budget] [--enforce]` on `size-census.mjs`; `--gate` without `--against` → exit 1.
- [x] Pure `evaluateGate` returns the GateResult shape incl. `over_by`/`under_by`.
- [x] CI step runs the gate against the committed baseline, appended to `$GITHUB_STEP_SUMMARY`.
- [x] Exit codes 0 (within/advisory-over) / 2 (enforcing-over) / 1 (operational); `node --test` covers all three.
- [x] The gate's PR commits an initial `prompt-size.json` via `--update-baseline`; `--update-baseline` remains the escape hatch.
- [x] Shrink prints the nudge; current tree passes the gate clean.

confidence: high
