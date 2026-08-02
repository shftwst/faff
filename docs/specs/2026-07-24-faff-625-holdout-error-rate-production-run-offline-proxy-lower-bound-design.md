# FAFF-625 — Holdout error-rate production run: the offline-proxy lower bound (labelled, FAFF-317 caveat carried)

> Spec: faffter-dark-nlspec · 2026-07-24 · autonomous · confidence: high. Full spec on Linear FAFF-625.

> **Refreshed 2026-07-24** — re-grounded against current `main` (HEAD `0ccd321`) after **FAFF-318** (#468, "resumable frontier eval sweep") reworked `eval/run-evals.mjs`. The approach is **unchanged**: `loadCases(dir)` remains parameterised, no `--cases-dir` flag exists yet, and FAFF-318's per-kind checkpointing / `--resume` machinery is confined to the `--update-baseline` re-baseline path — the plain sweep this run uses (and its FAFF-320 per-rep judgement streaming) is untouched. Fold-ins are annotated inline in §3 (harness delta) and §4 (salvage). No `**Chosen:**` decision, interface, or acceptance criterion moved, so the retained `spec-review: approve` verdict stands.

This is a design spec for the first production-scale error-rate measurement of the code-blind holdout judge, written for the build agent that will assemble the corpus, run it, and record the result. FAFF-563 shipped the apparatus (the SeededDefectCase format, the deterministic `eval/score-error-rates.mjs` scorer, the measurement protocol, and a five-case pilot proving the loop closes); this ticket scales it to the corpus size ADR-0029 named and produces the **citable, labelled offline lower bound** — the first measured sensitivity number for the shipped judge. The live end-to-end number remains FAFF-629's.

## 1. WHY — Problem and principles

**The load-bearing model.** The L4 trust story terminates in the holdout judge's verdict, and the only measured sensitivity number on record (ADR-0029's 0/155, ~1.9% rule-of-three bound) belongs to a **diff-as-text strawman**, not the shipped recordings-driven judge. FAFF-563 built the measurement lane but deliberately produced no citable rate (its pilot is five cases — a plumbing proof). Until a production-scale corpus runs through that lane, every citation of judge sensitivity is either borrowed from the wrong apparatus or unmeasured. This ticket runs the lane at scale and writes the number down — **as a labelled lower bound on reasoning quality, never as the live sensitivity** (FAFF-317: the offline proxy cannot capture the agentic derive-and-execute loop).

**Problem statement.** The scaffolding exists and is proven; the corpus does not, so no citable rate exists. Assemble a stratified labelled corpus at ADR-0029's production scale, run it through the offline `holdout-exercise` proxy, and record the resulting `ErrorRateReport` where the trust story can cite it — caveat attached.

**Design principles.**

- **False-pass is cardinal; false-fail merely parks.** Inherited from FAFF-563/ADR-0029 and already baked into the scorer's reporting order. The corpus weighting (below) follows it: negatives dominate, and the subtle strata dominate the negatives.
- **The number is a labelled lower bound, not the live rate.** Every artifact this run produces — the report JSON, the ADR, any tracker comment citing it — carries the FAFF-317 offline-proxy caveat (the scorer's `OFFLINE_CAVEAT` attaches it to the report mechanically; the ADR restates it in prose). A citation without the caveat is a defect.
- **The corpus must not contaminate the existing eval economy.** `eval/run-evals.mjs`'s `loadCases()` is total over `eval/cases/` — every case there rides every full sweep, regression gate, and re-baseline at `BASE_REPS=20`. A 360-case corpus in that directory would multiply every future sweep's cost ~25×. The production corpus therefore lives in its own directory and is loaded only when explicitly named.
- **Teaching-to-the-test discipline extends to every new case.** The FAFF-563 measurement boundary (label fields are scorer-only, never rendered into a judge prompt) is enforced over the *whole* production corpus by test, not assumed from the pilot.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/score-error-rates.mjs` | JS | The FAFF-563 scorer this run feeds — joins judgements to labels by `case_id`, re-derives aggregates, emits `ErrorRateReport`; already supports `--cases-dir`; exports `OFFLINE_CAVEAT` |
| `eval/cases-pilot/holdout-seed-*.json` (5) | JSON | The pilot SeededDefectCases — the authoring template for the production corpus (shape, naming, oracle style). Relocated out of `eval/cases/` by FAFF-670 so the sweep's flat per-kind mean is not shaped by a labelled corpus. |
| `eval/run-evals.mjs` | JS | The orchestrator that drives the judge and streams `.faff/eval-runs/<run-id>/judgements.jsonl` (FAFF-320); `loadCases(dir)` is already parameterised but the CLI exposes no dir flag. **FAFF-318 (#468) reworked this file** — it added per-kind checkpointing + a `--resume` continuation and a `eval/report/frontier-sweep-progress.json` progress file, **all scoped to the `--update-baseline` re-baseline path**; the plain sweep (`main`'s fall-through) and `loadCases`'s signature are unchanged, so this ticket's additive `--cases-dir` hook still slots in cleanly (re-verified at HEAD `0ccd321`) |
| `eval/cli-driver.mjs` | JS | The frontier `claude -p` driver; model pinned via `models.eval` (FAFF-315) |
| `test/score-error-rates.test.mjs` | JS | The FAFF-563 scorer unit tests + the rendered-prompt leakage assertion this ticket extends |
| `docs/adr/0029-…machine-dod-verification…md` | ADR | The precedent bound this run extends to the shipped judge's offline surface |

**Scope statement.** This is the offline production phase of the FAFF-563 split — the middle of the three-ticket chain (scaffolding → offline lower bound → live agentic lane).

## 2. OUT OF SCOPE

- **The live agentic lane (FAFF-629, gated on FAFF-474).** — The honest end-to-end sensitivity number needs the real evaluator driven against stood-up docker envs; this run's output informs whether that lane is even needed at full scale. **Extension point:** `eval/live-driver.mjs` + the FAFF-474 `LIVE_KINDS` adapter.
- **Changing the evaluator's judgement procedure.** — This measures the judge as shipped. A measured blind spot is a *finding* recorded in the ADR (and, if concrete, a follow-up ticket surfaced for a human) — never a prompt tweak inside this ticket. **Extension point:** `plugin/skills/faffter-noon-evaluate/SKILL.md`.
- **Independent ground-truth audit (ADR-0029 residual 3).** — The corpus stays builder-labelled, exactly as ADR-0029's was; the labels are deterministic constraints (`validateSeededCase`) but the ground-truth assignments are not independently re-reviewed here. The ADR names this residual. **Extension point:** a labelled-sample re-review ticket.
- **Local-model / cost characterisation (ADR-0029 residual 5).** — Frontier lane only. **Extension point:** `eval/ollama-model.mjs`.
- **Any change to the grader, the `per_kind` regression gate, or the judgements capture format.** — The run is a pure consumer of the FAFF-563/FAFF-320 apparatus; the only harness change is one additive CLI flag (below). **Extension point:** none needed.

## 3. WHAT — Corpus plan, harness delta, and results home

**Vocabulary.** Unchanged from FAFF-563 (clean/defective, false-pass/false-fail, the four defect classes, corpus unit). One addition:

| Term | Definition |
|---|---|
| Production corpus | The full labelled SeededDefectCase set this ticket authors under `eval/cases-seeded/` — distinct from the five-case pilot in `eval/cases/`, which stays where it landed and is not part of the production denominator. |

**Corpus size and stratification (inherited punt — settled).**

**Chosen:** **≥300 negatives + ≥60 clean positives**, with the negative strata weighted toward the subtle classes: ≥90 `subtly-wrong`, ≥90 `working-but-off-spec`, ≥60 `missed-criterion`, ≥60 `spec-satisfying-but-broken-elsewhere`. Rationale: ADR-0029 residual (4) names ~300+ negatives as the size that pushes a zero-count rule-of-three bound to ≈1% (3/300); the ticket description carries the same floor and the subtle-class weighting (they are the strata a flattering corpus under-represents — FAFF-563's representativeness principle). 60 positives keeps the non-cardinal false-fail denominator meaningful (a zero-count bounds false-fail at 5%) without inflating spend on the cheaper failure mode. Counts are floors, not targets to overshoot — the corpus-lint test (below) asserts the floors.

**Corpus authoring.** Cases are authored by the build agent as `holdout-exercise`-kind fixtures (body `recordings[]` — the kind/body pairing is pinned by the FAFF-563 format), following the pilot's naming scheme (`holdout-seed-neg-<class>-NNN` / `holdout-seed-clean-NNN`) and oracle style (`closed_set` of `key:class` pairs). Authoring constraints, each machine-checked where stated:

- Every case passes `validateSeededCase` (the format's polarity constraints) — lint-checked.
- IDs are unique across `eval/cases-seeded/` **and** disjoint from `eval/cases/` (a duplicate `case_id` would mis-join the scorer) — lint-checked.
- Fixture bodies are pairwise distinct (no copy-paste duplicates padding the denominator) — lint-checked via body hashing.
- **Domain diversity:** the corpus spans many distinct application domains (APIs, CLIs, batch jobs, auth flows, data pipelines, notification systems, …), varies criteria-set sizes (roughly 3–7 per case), and includes a `prose` criterion in a majority of cases (mirroring real specs; prose is excluded from polarity by the scorer). This is a review-judgement bar, stated here so the PR reviewer holds it — not machine-linted (a domain classifier would be a bigger build than the corpus).
- The defect in a negative case is *observable in the recordings* and matches its `defect_class` definition; the oracle's per-criterion classes are consistent with `expected_aggregate` under `deriveHoldoutAggregate` — the last clause is lint-checkable (derive the oracle's classes and compare) and is asserted.

**Corpus home + selection (harness delta).**

**Chosen:** the production corpus lives in **`eval/cases-seeded/`**, and `eval/run-evals.mjs` gains one **additive `--cases-dir <dir>` flag** that routes the already-parameterised `loadCases(dir)`; absent the flag, behaviour is byte-identical (default dir unchanged, all existing paths untouched). Rationale: keeps the corpus out of every ordinary sweep/gate (the cost-contamination principle); `--only` is an exact single-ID filter, unusable for a 360-case run; the scorer already takes `--cases-dir`, so the two ends of the pipe become symmetric. Rejected: prefix-filtering inside `eval/cases/` (still contaminates `loadCases()`-total consumers); a bespoke corpus runner (duplicates the driver/capture/grading stack FAFF-563 deliberately reused).

**FAFF-318 re-grounding note (harness delta).** FAFF-318 (#468) added per-kind checkpointing, a `--resume` continuation, and a `eval/report/frontier-sweep-progress.json` progress file — **all inside `updateBaseline` (the `--update-baseline` re-baseline path only)**. Two consequences for this build: (a) `loadCases()` is still called with no argument at every call site (the plain sweep, `--gate`, `--against`, `--update-baseline`, `--compare`), so the `--cases-dir` flag remains a one-line additive `argFlag` routing `loadCases(dir)` and the byte-identity guarantee is unchanged; (b) the flag-absent byte-identity test should enumerate the **current** entry paths, which now include the `--update-baseline --resume` sub-mode and the progress-file write — assert that with `--cases-dir` absent none of them change. The progress file is a `--update-baseline` runtime artifact; this ticket's production run uses the plain sweep and never writes it.

**Reps (inherited punt — settled).**

**Chosen:** **`--reps 1`** — a breadth run, one trial per case, matching ADR-0029's breadth methodology (its stability question was answered separately at K=20 and measured 1.0; re-answering it here would multiply spend ~20× for a question that isn't this ticket's). Each scored record is one rule-of-three trial, so the bound is 3/n over ~300 independent single-rep negatives — cleaner than rep-inflated trials from correlated re-judgements of the same case. A stability adjunct on this corpus is a legitimate follow-up, not part of this run.

**Driver and model.**

**Chosen:** the **frontier driver** with the **pinned `models.eval` lane** (FAFF-315: flag > `models.eval` > baked fallback — never the account default), no `--model` override. The resolved model is recorded in the report meta and named in the ADR, because the number is model-specific (the validity guard). The run bills real frontier spend on the lane the operator pinned for exactly this purpose (the budget guard); the estimated volume is ~360 judgement calls.

**Results home (inherited punt — settled).**

**Chosen:** two committed artifacts, plus the gitignored raw capture:

1. **`eval/error-rates/<YYYY-MM-DD>-offline-frontier.json`** — the scorer's `ErrorRateReport` verbatim (a new `eval/error-rates/` directory; `eval/baselines/` is the regression gate's home and a one-shot measurement is not a regression baseline). The report's `caveat` field is non-null by scorer construction (`holdout-exercise` kind → `OFFLINE_CAVEAT`).
2. **A new ADR** (next free number at build time — 0086 as of this spec) recording the measured bound as the offline extension of ADR-0029: the corpus shape, the resolved model, the false-pass rate (and `false_pass_upper_95` when zero), the per-stratum table, the FAFF-317 caveat verbatim, and the surviving residuals (independent audit; the live lane FAFF-629). It cites the report file by path. It does **not** supersede ADR-0029 — it extends its measurement record to the shipped judge's offline surface.
3. The raw `judgements.jsonl` stays under `.faff/eval-runs/` (gitignored, salvage/forensics — per FAFF-320's design; the committed report is the durable citation).

Rejected: report-only with no ADR (the trust story cites ADRs, and ADR-0029 is the established citation surface); extending ADR-0029 in place (the repo treats ADRs as append-by-new-record, amend-by-reference — see ADR-0074's pattern).

## 4. HOW — The run

**Behaviour summary.** Author and lint the corpus; drive the judge over it once per case via the offline proxy; salvage/complete if interrupted; score; commit the report + ADR.

```
PROCEDURE production_run:
  1. Author the corpus under eval/cases-seeded/ (≥300 neg weighted 90/90/60/60, ≥60 clean).
  2. Lint: the corpus-lint test (counts, validateSeededCase, unique ids, distinct bodies,
     oracle↔expected_aggregate coherence) and the extended leakage test run green in CI, offline.
  3. Run:  node eval/run-evals.mjs --cases-dir eval/cases-seeded --reps 1 --driver frontier
          → streams .faff/eval-runs/<run-id>/judgements.jsonl per rep (crash-durable, FAFF-320)
  4. IF the sweep was interrupted or any case is missing a scored record:
     a. Identify missing/unscorable case_ids (scorer `skipped` + absent ids vs the corpus).
     b. Re-run ONLY those cases (a temporary subset dir passed to --cases-dir is acceptable;
        eval/cases-seeded/ itself is never mutated to do so).
     c. Concatenate the judgements.jsonl files into one merged file for scoring
        (the scorer is pure over records; join is by case_id).
  5. Score: node eval/score-error-rates.mjs <merged judgements.jsonl> \
            --cases-dir eval/cases-seeded --driver frontier --model <resolved models.eval>
  6. Completeness gate (mechanical): the report is citable ONLY when n_negative and n_positive
     equal the corpus's labelled counts and skipped == 0 for corpus cases. Otherwise loop to 4.
  7. Record: commit the report to eval/error-rates/<date>-offline-frontier.json and author the
     ADR citing it (caveat verbatim, model named, per-stratum table, residuals).
```

> **Salvage vs FAFF-318 `--resume` (re-grounding note).** Step 4's salvage is deliberately self-contained — it re-runs the missing corpus cases on the **plain sweep** and merges by `case_id` in the scorer. It is **not** FAFF-318's `--resume`, which is a `--update-baseline` re-baseline continuation keyed by grader *kind* (the whole corpus is one kind, `holdout-exercise`, so kind-level resume can't help here anyway). Use step 4 as written; do not reach for `--update-baseline --resume`.

**Edge cases and error handling.**

- **Errored/unscorable reps** (driver failure, envelope parse failure): appear as `skipped` in the report and as missing polarity trials. They are never counted, so the completeness gate forces a re-run of exactly those cases — a partial sweep can never silently shrink the denominator.
- **Interrupted sweep:** judgements.jsonl is flushed per rep; resume = re-run the missing subset and merge (step 4). Merged files spanning run-ids are fine; pass the run's identity via the scorer's meta flags.
- **Duplicate trials for a case** (a case re-run after a partial score): dedupe by keeping the last scorable record per `case_id` before scoring — the merged file must not double-count a trial (with `--reps 1`, one scorable record per case is the invariant the completeness gate checks).
- **A lint-invalid case discovered mid-authoring:** `loadSeededCases` is fail-loud on constraint violations; fix the fixture, never relax the validator.

**Failure modes — how the measurement itself could be wrong.**

- **Leakage (teaching to the test).** A label field reaches a rendered judge prompt via the new corpus. *How you'd know:* the extended leakage test fails; or an implausibly uniform near-zero false-pass across all strata including `subtly-wrong`. *What it means:* run invalid — fix the fixture/renderer, re-run; never publish.
- **Homogeneous corpus.** 300 negatives that are 300 re-skins of the pilot's order-API flatter the judge. *How you'd know:* the PR reviewer's domain-diversity check; near-identical `spec_dod` shapes across cases (body-hash lint catches literal duplicates only). *What it means:* narrow — diversify before running; the number from a homogeneous corpus goes unpublished.
- **The bound gets laundered as the live rate.** *How you'd know:* a citation without the caveat. *What it means:* the report's `caveat` field and the ADR's verbatim FAFF-317 caveat exist precisely so any such citation is checkably wrong; FAFF-629 stays open as the honest number's home.
- **A non-zero false-pass count.** Not a failure of the measurement — a valid, reportable outcome. `false_pass_upper_95` is `null` by scorer design; the ADR reports the raw rate per stratum and flags the affected strata as candidate findings for a follow-up (surfaced, not auto-filed).

**Anti-pattern:** citing the pilot's five-case output, or this run's report, as *the* judge sensitivity. Why: the pilot is a plumbing proof and this run is an offline lower bound; the sentence the trust story may use is "the judge's offline reasoning surface measured X (lower bound; live lane pending FAFF-629)".

## 5. Scenarios — born-verifiable main objectives

```
Given the production corpus under eval/cases-seeded/
When the corpus-lint test runs (offline, CI)
Then it asserts ≥300 defective and ≥60 clean cases, per-stratum floors (≥90/≥90/≥60/≥60),
     validateSeededCase passes for every case, ids are unique and disjoint from eval/cases/,
     fixture bodies are pairwise distinct, and each oracle's classes re-derive (via
     deriveHoldoutAggregate, prose excluded) to the case's expected_aggregate
```

```
Given any SeededDefectCase in eval/cases-seeded/ and the driver's judge-prompt builder
When the prompt is rendered for that case
Then the rendered string contains none of the case's label / defect_class / expected_aggregate
     values (the FAFF-563 leakage assertion, extended over the entire production corpus)
```

```
Given run-evals.mjs invoked WITHOUT --cases-dir
When any existing entry path runs (sweep, --gate, --against, --update-baseline [incl. --resume], --compare)
Then case loading behaviour is byte-identical to before this change (the flag is purely additive;
     the FAFF-318 --resume sub-mode and progress-file write are unaffected by the absent flag)
```

```
Given a merged judgements.jsonl covering every corpus case with exactly one scorable record each
When eval/score-error-rates.mjs runs with --cases-dir eval/cases-seeded
Then the ErrorRateReport has n_negative and n_positive equal to the corpus's labelled counts,
     skipped == 0 for corpus cases, a non-null caveat (the FAFF-317 OFFLINE_CAVEAT), all four
     by_defect_class keys populated, and false_pass_upper_95 == 3/n_negative iff false_pass == 0
```

- The committed report file MUST byte-match the scorer's output for the merged judgements (no hand-edited numbers).
- The ADR MUST name the resolved model, cite the report path, carry the FAFF-317 caveat verbatim, and state the surviving residuals (builder-labelled ground truth; live lane pending).

## 6. Design decision rationale

- **Corpus size?** Options: pilot-scale top-up; ADR-0029's ~300+ floor; larger. **Chosen:** ≥300 negatives + ≥60 clean, strata-weighted 90/90/60/60 — the smallest size that meets the stated ≈1% zero-count bound, weighted toward the strata a flattering corpus under-represents.
- **Corpus home?** Options: `eval/cases/`; a new `eval/cases-seeded/` + additive flag. **Chosen:** `eval/cases-seeded/` + `--cases-dir` — `loadCases()` is total over its dir, so co-locating would multiply every future sweep ~25×; the flag is one additive argFlag routing an already-parameterised loader (unchanged by FAFF-318's `--update-baseline`-scoped rework).
- **Reps?** Options: 1; BASE_REPS=20; K=20 on closest calls. **Chosen:** 1 — breadth per ADR-0029; stability was measured separately there at 1.0 and is a follow-up here, not a blocker.
- **Results home?** Options: report only; baseline block; report + ADR. **Chosen:** committed `eval/error-rates/` report + a new ADR extending ADR-0029 by reference — the trust story cites ADRs; baselines are the regression gate's namespace.
- **Model?** Options: pin an explicit cheap model; ride `models.eval`. **Chosen:** ride the pinned `models.eval` lane unmodified — that lane exists as the eval budget/validity guard; the report and ADR name whatever it resolves to.
- **Pilot cases' status?** Options: move them into the corpus; leave in place. **Chosen:** leave in `eval/cases/` — they landed there under FAFF-563, moving them churns a just-merged surface, and the production denominator should be the purpose-built corpus alone.

*Temporal anchor: re-grounded 2026-07-24 against `main` HEAD `0ccd321` (prep-time origin/main was `8538f77`; FAFF-563 landed at `927f5dd`). `eval/cases-seeded/` and `eval/error-rates/` do not exist; `score-error-rates.mjs` supports `--cases-dir` but `run-evals.mjs` does not (FAFF-318 #468 reworked `run-evals.mjs` for resumable `--update-baseline` sweeps but added no `--cases-dir` and left `loadCases(dir)` parameterised); ADRs run to 0085; `models.eval` resolves to `claude-opus-4-8`.*

## 7. Open questions and assumptions

**Open Questions.** None — both inherited punts (corpus size, results home) are settled above with **Chosen:** markers, per the FAFF-563 handoff.

**Assumptions.**

- **Assumes:** the FAFF-563 substrate is on main as landed — `eval/score-error-rates.mjs` (with `--cases-dir`, `OFFLINE_CAVEAT`, `loadSeededCases`), the five pilot cases, and the FAFF-320 judgements capture. *Validation:* confirmed on `main` HEAD `0ccd321` at refresh time; re-verify at build start with the mock-driver test path (`node --test test/score-error-rates.test.mjs`, which drives run-evals → judgements.jsonl → the scorer over the pilot corpus) producing a scorable judgements.jsonl — no frontier rep, no paid sweep. (FAFF-670 relocated the pilot to `eval/cases-pilot/`.)
- **Assumes:** frontier access and budget are available at build time for ~360 judgement calls on the resolved `models.eval` lane. *Validation:* the smoke run above; on sustained frontier unavailability the run parks rather than substituting an unpinned model.
- **Assumes:** `loadCases(dir)`'s validation accepts SeededDefectCase label fields (the pilot cases already ride full sweeps unrejected). *Validation:* the corpus-lint test loads the corpus through the same path.

## 8. DONE — Definition of Done

### From WHY
- [ ] The committed report and the ADR both carry the FAFF-317 offline-proxy caveat (report: non-null `caveat` field by scorer construction; ADR: verbatim), and the ADR frames the number as a lower bound on reasoning quality, never the live sensitivity.

### From WHAT (corpus)
- [ ] `eval/cases-seeded/` contains ≥300 defective + ≥60 clean SeededDefectCases with per-stratum floors ≥90 `subtly-wrong`, ≥90 `working-but-off-spec`, ≥60 `missed-criterion`, ≥60 `spec-satisfying-but-broken-elsewhere` — asserted by the corpus-lint test.
- [ ] The corpus-lint test also asserts: `validateSeededCase` passes for every case; ids unique and disjoint from `eval/cases/`; fixture bodies pairwise distinct; every oracle's classes re-derive (prose excluded, via `deriveHoldoutAggregate`) to the case's `expected_aggregate`.
- [ ] The rendered-prompt leakage assertion iterates every case in `eval/cases-seeded/` (extends the FAFF-563 test beyond the pilot).

### From WHAT (harness delta)
- [ ] `run-evals.mjs` accepts `--cases-dir <dir>`; a test covers flag-present routing and asserts flag-absent behaviour is unchanged on every existing entry path (sweep, `--gate`, `--against`, `--update-baseline` incl. the FAFF-318 `--resume` sub-mode, `--compare`).
- [ ] No other harness change: grader, `per_kind` gate, capture format, and `eval/cases/` (incl. the five pilot cases) are untouched.

### From HOW (the run + the record)
- [ ] The production sweep ran to completeness: the committed report's `n_negative`/`n_positive` equal the corpus's labelled counts with zero corpus-case `skipped`, produced from a judgements file with exactly one scorable record per case (merged-and-deduped if the sweep was interrupted).
- [ ] `eval/error-rates/<date>-offline-frontier.json` byte-matches the scorer's output; `driver` is `frontier`, `model` names the resolved `models.eval`, `by_defect_class` has all four keys populated, and `false_pass_upper_95` follows the zero-count rule.
- [ ] The new ADR (next free number) records the bound, the per-stratum table, the model, the corpus shape, the caveat, and the residuals (builder-labelled ground truth; FAFF-629 live lane pending), citing the report path — extending ADR-0029 by reference, not superseding it.
- [ ] A non-zero false-pass result, if measured, is recorded honestly per stratum with affected strata flagged as candidate follow-up findings (surfaced in the ADR + PR, not auto-filed).

### Eval coverage
- [ ] No new grader `KIND` and no new LLM-judgement seam is introduced (corpus reuses `holdout-exercise`; all new tests are deterministic/offline), so no new eval case or seam-registry row is required.

### Integration smoke test
```
PROCEDURE smoke (CI, offline, deterministic):
  1. Corpus-lint + extended leakage tests green over eval/cases-seeded/.
  2. Drive 1 clean + 1 defective corpus case through runEvals with an INJECTED mock driver
     (runEvals is driver-injectable — the FAFF-563 test pattern; the CLI has no mock flag),
     cases loaded from eval/cases-seeded, reps 1 → judgements.jsonl written to a temp path.
  3. Score with --cases-dir eval/cases-seeded → report has n_positive=1, n_negative=1,
     non-null caveat, four strata keys; false_pass matches the mock's known aggregate.
  (The real frontier sweep is the production run itself — executed once, per HOW.)
```

## Already shipped against this surface

Related Done work — context, none of it superseding this ticket's premise (the production-scale citable rate exists nowhere yet):

- **FAFF-563** (Done 2026-07-23, PR #463) — the scaffolding this run rides: SeededDefectCase format, `eval/score-error-rates.mjs`, protocol, five-case pilot. Its spec explicitly hands corpus-size / results-home / timebox to this ticket.
- **FAFF-318** (Done, PR #468) — reworked `eval/run-evals.mjs` for resumable frontier sweeps (per-kind checkpointing + `--resume` + a progress file, all scoped to `--update-baseline`). **Does not supersede this ticket:** it added no `--cases-dir`, left `loadCases(dir)` parameterised, and did not touch the plain-sweep path this run uses. The only build-relevant change is that the flag-absent byte-identity test must enumerate the `--update-baseline --resume` sub-mode (folded into §3 and §8).
- **FAFF-320** (Done) — the per-rep judgements.jsonl capture the scorer reads; stable on main.
- **FAFF-263 / ADR-0029** (Done) — the diff-as-text precedent bound; its residuals (3) and (4) are respectively out of scope here and discharged by this run's corpus size.

confidence: high
spec-review: approve
