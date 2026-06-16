# Spec — FAFF-170: Pre/post-lean tokenomics report

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-170.

The measurement half of the lean safety-net pair (FAFF-169 = the regression gate). Produces the outcome the refactor exists to justify — "cut N% prompt tokens with 0 judgement regression" — by pairing a deterministic prompt-**size** delta with FAFF-169's **quality** delta.

## 1. WHY
The lean refactor's point is to cut prompt tokens *without* losing quality, but neither half is measured: the eval harness reports `cost_tokens` (the eval *runtime's* tokens), not the SKILL.md prompt size that loads, and the quality baseline isn't paired with any size number. This adds a committed, re-runnable prompt-**size** census + a report pairing the size delta with FAFF-169's quality delta.

**Principles.**
- **Zero-dependency — no tokenizer library** (repo is "node builtins only"); token figure is a chars/4 proxy reusing `estimateTokens`.
- **Measure the prose that loads (SKILL.md), not the eval runtime `cost_tokens`.**
- **Reuse, don't reimplement** the enumeration / FAFF-169's quality baseline.
- **Size half is free + deterministic; the paired report needs a human-run frontier quality run** (degrade to size-only without it).

## 2. OUT OF SCOPE
- A real tokenizer dependency (zero-dep convention).
- Wiring into CI → FAFF-167.
- The regression gate itself → FAFF-169 (consumed here).
- Re-implementing file enumeration → FAFF-114 (glob fallback here).
- Acting on the result (deciding a pass) → FAFF-169's gate / the human.

## 3. WHAT
**Size census + baseline** — `SkillSize` = { path, lines, chars, est_tokens (=estimateTokens(text)) }. Committed `eval/baselines/prompt-size.json` (tracked) = { meta:{captured_at, commit}, per_file:[SkillSize], totals:{files, lines, chars, est_tokens} }.

**Report** (`TokenomicsReport`) — `size` = { before, after, delta:{lines, chars, est_tokens, pct}, per_file_deltas }; `quality` = { mode:"paired", per_kind:[{kind, before, after, delta}], regressions } OR { mode:"size-only", reason }; `headline` e.g. "cut 18% prompt tokens (141k → 116k est); judgement Δ = 0".

**CLI** — `eval/size-census.mjs`: print per-file+totals (default); `--update-baseline <path>` (write snapshot); `--report --against <baseline> [--quality <eval-run>]` (size delta + paired quality if given, else size-only).

**Design decisions** — token measure = chars/4 via `estimateTokens`, no tokenizer dep **Chosen**; measure SKILL.md prose not eval `cost_tokens` **Chosen**; reuse enumeration + `estimateTokens`, glob fallback **Chosen**; quality coupling = consume FAFF-169 baseline + graceful size-only degrade **Chosen**; committed re-runnable script + tracked baseline, size half free/deterministic **Chosen**.

## 4. HOW
`size_census()`: glob `plugin/skills/*/SKILL.md`; per file { lines, chars, est_tokens=estimateTokens(text) }; totals + count.
`report(current, sizeBaseline, qualityRun?)`: sizeDelta (abs + pct, per-file + total); if qualityRun + FAFF-169 baseline present → per-kind quality delta (mode "paired"), else mode "size-only"; headline.

**Edge cases:** no size baseline → `--report` errors loudly; no `--quality`/absent FAFF-169 baseline → size-only (state reason); SKILL.md added/removed → per-file delta lists it, not an error; every token figure labelled "est"; the delta percent is the trustworthy figure.

**Anti-patterns:** reporting eval `cost_tokens` as prompt size; adding a tokenizer dep; recomputing the judgement eval here.

## 5. SCENARIOS
- Baseline totals known; a lean pass shrinks prose → report states size delta ("cut N% prompt tokens, M → M' est").
- size baseline + post-lean quality run + FAFF-169 baseline → paired headline ("cut N%; judgement Δ = 0").
- no quality run → size-only report stating the reason (never a fabricated quality delta).

Assertions: census is zero-dep + deterministic (same tree → same numbers); token figures labelled est (chars/4); the size half runs with no model call.

## 6. RATIONALE — see §3 Chosen markers. Temporal anchor: pre-lean ~5105 lines / ~566k chars / ~141k est tokens across all SKILL.md (2026-06-16).

## 7. ASSUMPTIONS
- **Assumes:** `estimateTokens` stays exported from `eval/cli-driver.mjs`. *Validate:* import it.
- **Assumes:** the SKILL.md glob (`plugin/skills/*/SKILL.md`) is the enumeration set (reuse FAFF-114's if exposed, else glob). 
- **Assumes:** FAFF-169's committed baseline is `eval/baselines/frontier.json` with a `per_kind` dict. *Validate:* read it for the quality half; if absent, size-only.
- **Assumes:** `eval/baselines/` is not gitignored.

## 8. DONE
- [ ] Committed re-runnable prompt-size census (lines/chars/est-tokens per SKILL.md + totals).
- [ ] A report pairs the size delta with FAFF-169's quality delta ("cut N% prompt tokens; judgement Δ = …").
- [ ] The size measure is the SKILL.md prose, not eval `cost_tokens`.
- [ ] est_tokens reuses `estimateTokens` (chars/4) — no tokenizer dependency.
- [ ] Tracked `eval/baselines/prompt-size.json` (meta + per_file + totals), seeded.
- [ ] Report has a paired mode (--quality) + a size-only degrade mode.
- [ ] `size_census()` enumerates plugin/skills/*/SKILL.md; `report()` diffs size + folds quality when supplied.
- [ ] No size baseline → errors loudly; no --quality → size-only; never fabricates a quality delta.
- [ ] `node --test` covers census + report (per-file size, size delta, paired mode, size-only mode, added/removed file).
- [ ] The size half runs with no model call.

confidence: high
