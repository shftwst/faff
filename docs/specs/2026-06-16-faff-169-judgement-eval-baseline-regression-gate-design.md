# Spec — FAFF-169: Commit the judgement-eval baseline + mechanical regression gate

> Spec: faffter-dark-nlspec · 2026-06-16 · autonomous · confidence: high. Full spec on Linear FAFF-169.

The safety net the lean refactor needs. Turns today's manual "re-run frontier and eyeball the diff" into a committed baseline + a `--against` assertion that exits non-zero when any judgement kind regresses.

## 1. WHY

The judgement-eval harness (FAFF-130) has a real pre-lean frontier baseline, but it lives in **gitignored** `eval/report/` + Linear comments — so the lean refactor's before/after is a manual re-run + eyeball diff, and a leaning pass (FAFF-116/117) could silently regress a kind with nothing failing. This commits a tracked baseline and adds a `--against <baseline>` mode that fails on any per-kind regression.

**Principles.**
- **Human-run gate, not CI** (ADR-0004): frontier evals cost real spend; `eval/` is excluded from CI. Run *after a lean pass*, not in `validate.yml`.
- **Stability gated alongside accuracy**; never gate on `escalated_cases` (run-to-run metadata).
- **Tolerance is per grader-class**, not global.
- **Re-baseline is a deliberate human action** (`--update-baseline`), never silent.

## 2. OUT OF SCOPE
- Widening the confidence fixtures → a dedicated ticket (confidence is a warn-kind until then).
- Wiring any eval into `validate.yml` CI → FAFF-167.
- The tokenomics/size half → FAFF-170 (consumes this gate's output).
- Live-driver baselines (reconciliation/routing via run-live-evals.mjs) → extension on the same schema.

## 3. WHAT

**Baseline file** `eval/baselines/frontier.json` (tracked): `{ meta:{captured_at, commit, driver, base_reps, source}, per_kind:{<kind>:{accuracy,stability,format_adherence|null}}, policy:{warn_kinds, tolerances} }`.

**Two orthogonal gate inputs:**
- **(a) grader-class → base tolerance**, from grader `CLOSED_SET_KINDS`:
  - closed_set (set-equality): dupe, vague, stale, superseded, marker, **confidence**, reconciliation, verdict-revert, verdict-build, routing, modedetect → tolerance **0**
  - ordering (rank-corr): ordering → tolerance **0**
  - free_text (rubric): gloss, shaping, decomposition, splittable → tolerance **0.03**
- **(b) warn_kinds → orthogonal override**: a listed kind is reported-not-failed regardless of grader-class. `warn_kinds=[confidence]` — confidence is closed-set-graded but empirically flaky (confidence-001 flips, ADR-0004), so a regression **warns** until its fixtures widen.

**Gate rule per kind:** `regressed = accuracy < baseline.accuracy − tol OR stability < baseline.stability − tol OR (baseline.format==1.0 AND current.format < 1.0)`. fail if regressed AND kind ∉ warn_kinds; warn if regressed AND ∈ warn_kinds; else pass. A baseline kind **missing** from the run → fail. A run kind absent from the baseline → informational.

**CLI:** `--against <baseline>` (run, diff, exit non-zero iff any FAIL) and `--update-baseline <baseline>` (write current per_kind + meta).

**Design decisions** — baseline shape = meta+per_kind+policy (not churning `cases[]`) **Chosen**; compare accuracy+stability+format-1.00+missing-kind, never escalated_cases **Chosen**; per-kind tolerance from grader-class in the committed policy **Chosen**; confidence = warn-override **Chosen**; black-box frontier first slice, live extension **Chosen**; re-baseline only via explicit `--update-baseline` **Chosen**.

## 4. HOW

Add `--against`/`--update-baseline` argv branches to `run-evals.mjs`, reusing `runEvals`+`summarize`. The only new logic is a **pure** `diffAgainstBaseline(currentSummary, baseline)` + a printer.

`diffAgainstBaseline`: for each baseline kind — missing from run → fail; else accΔ/stabΔ/format check, set regressed per the gate rule, then warn (∈ warn_kinds) / fail / pass. Improvements reported, never gated.

**Edge cases:** missing/malformed baseline → fail loud (a gate with no baseline is not a pass); no `--quality` n/a here; `format_adherence==null` → skip format for that kind; new (un-baselined) kind → informational; dropped kind → fail.

**Anti-patterns:** gating on `escalated_cases`; one global threshold; auto-updating the baseline on a passing run; adding `--against` to validate.yml.

## 5. SCENARIOS
- Baseline has dupe 1.00; a run regresses dupe to 0.96 → dupe FAIL, exit non-zero.
- gloss dips to 0.97 (within 0.03 free_text tol) → PASS; confidence drops to 0.85 → WARN; gate exits 0.
- A baseline kind missing from the run → FAIL ("kind dropped").
- `--update-baseline` on a confirmed improvement rewrites meta + per_kind.

Assertions: `diffAgainstBaseline` is pure + `node --test`-covered; the gate is never in validate.yml; a missing/malformed baseline fails loud.

## 6. RATIONALE
See §3 Chosen markers. Confidence is warn-listed pending fixture widening; promote it out of warn_kinds when that lands.

## 7. ASSUMPTIONS
- **Assumes:** the frontier numbers to seed the baseline are available (a fresh `--driver frontier` run, or the ADR-0004 recorded table). *Validate:* seed via `--update-baseline` from a real run, or commit the ADR-0004 numbers with `meta.source` recorded; re-seed from a real run when convenient. The gate *mechanism* (diffAgainstBaseline) is correct regardless of the exact seed numbers.
- **Assumes:** `summarize()`'s per_kind shape is stable (`{accuracy,stability,format_adherence}`).
- **Assumes:** `eval/baselines/` is not gitignored (only `eval/report/` is).

## 8. DONE
- [ ] Tracked `eval/baselines/frontier.json` committed (not gitignored), seeded with recorded provenance.
- [ ] `--against` exits non-zero on a real per-kind regression, 0 when clean.
- [ ] Baseline carries meta + per_kind + policy (warn_kinds, tolerances).
- [ ] Gate compares accuracy AND stability, enforces format 1.00, fails on a missing baseline kind; confidence warns; escalated_cases not a gate input.
- [ ] `--against` + `--update-baseline` branches added; `diffAgainstBaseline` is pure.
- [ ] Missing/malformed baseline fails loud.
- [ ] `node --test` covers diffAgainstBaseline (closed-set-drop FAIL, free-text-dip PASS, confidence-drop WARN, missing-kind FAIL, improvement PASS).
- [ ] Gate not referenced in validate.yml.

confidence: high
