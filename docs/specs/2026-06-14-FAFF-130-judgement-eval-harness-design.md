# Spec — FAFF-130: Judgement-eval harness + deterministic grader

> Spec: faffter-dark-nlspec · 2026-06-14 · interactive · confidence: high. Full spec on Linear FAFF-130 (comment 73004628).

> **Split boundary (2026-06-14).** FAFF-130 builds the **harness** (this doc's WHAT/HOW/SCENARIOS — all deterministically completable). The **measured run + ADR 0004 numbers** moved to **FAFF-131** (human-supervised; ~240 `claude -p` reps + `CLAUDE_CONFIG_DIR` isolation). FAFF-130 ships the **ADR-0004 scaffold** (structure + pending-markers), not the measured ADR.

A scoping spike's harness: a thin, runnable offline judgement-eval probe + a small graded fixture set + a deterministic two-tier grader, for the skill **LLM-judgement** surface (`vague`/`dupe`/`stale`/`superseded` classification, `pick-ordering`, synthesis gloss) that the scripted-driver harness (FAFF-93/94/95/97) deliberately leaves untested. Not a production eval suite.

## 1. WHY
The deterministic kernel is fully tested; ADR 0003 proved its 0% flakiness is *because* skills route routing decisions into deterministic CLI. The untested, value-bearing surface is the **judgement residue**. This harness measures it cheaply with targeted offline evals (FAFF-131 runs it; the numbers settle the live-driver-vs-evals fork).

**Principles**
- **Evals are a separate graded layer, never new harness matchers.** Judgement output *is* the free text the FAFF-93 harness forbids as an assertable field. Capture + grade it **out-of-band** from the seam `DecisionRecord` and FAFF-95 matchers. Adding gloss-content assertions to `decision-assert.mjs` is wrong.
- **Flakiness is the load-bearing measurement, not accuracy.** Every case runs K times; the headline metric is per-case label *stability* across reps, distinct from accuracy.
- **Spike economics outrank completeness.** Thinnest probe that yields a defensible recommendation.

## 2. OUT OF SCOPE
- A production/CI-gating eval suite · the live-driver harness (lane 1) · local-LLM plumbing probe (FAFF-129) · skills other than `faff-tidy` · auto-gating the gloss judge · changing any `faff-tidy` prose.
- **The measured run + ADR 0004 numbers → FAFF-131** (this PR ships the scaffold).

## 3. WHAT — types (see eval/*.mjs)
- `EvalCase{ id, kind∈{dupe,vague,stale,superseded,ordering,gloss}, fixture, question, oracle, reps(default 20) }`
- `OracleAnswer{ closed_set? | ordering? | gloss_rubric? }` (exactly one, matching kind)
- `GlossRubric{ must_include[], must_avoid[] }`
- `JudgementEnvelope{ case_id, classifications?, ordering?, gloss? }` — parsed from a `faff-eval:judgement` fenced block, out-of-band
- `RepResult{ graded: PASS|FAIL|PARTIAL|ERRORED, score, tokens }`
- `CaseResult{ case_id, rep_results[], stability, accuracy, escalated, cost_tokens }`

**Grader (two-tier, deterministic):** closed-set → exact set-equality (1.0/0.0); ordering → normalised rank-correlation (PARTIAL band) over the *judgement-determined* portion only; gloss → rubric `must_include`/`must_avoid` pass-rate (PARTIAL). The LLM-judge "is it good" score is **advisory only**, never the reported coverage (Decision 3).

## 4. HOW — architecture
`eval/` (sibling to `test/`, **excluded from `node --test` globs** so a frontier-cost suite never auto-runs):
```
eval/
  cases/            EvalCase JSON + embedded FAFF-89-shaped fixtures + oracles (12: 2/kind)
  envelope.mjs      parse the faff-eval:judgement block (fail-loud on missing/malformed)
  grader.mjs        the two-tier deterministic Grader + per-case aggregation
  frontier-driver.mjs  wraps `claude -p`; per-run CLAUDE_CONFIG_DIR isolation (DEFAULT driver; run by FAFF-131, not CI)
  run-evals.mjs     orchestrator: load → drive K reps via an INJECTABLE driver → grade → aggregate → report
  README.md
```
The grader + orchestration are **deterministically testable** because `run-evals` takes the driver as a dependency — tests inject a mock returning canned envelopes (no frontier calls). The real `frontier-driver` is the default.

**run-evals**: load + validate cases (kind matches populated oracle field) → per case, per rep drive → capture envelope (fail-loud if absent/malformed → rep `errored`, surfaced) → grade → RepResult; **escalate** a case's reps toward ~50 on ≥1 cross-rep disagreement (under a wall-clock/quota ceiling) → aggregate to CaseResult (stability = fraction matching modal graded label; accuracy = fraction matching oracle) → cross-case per-kind accuracy/stability + total cost → emit report + headline. Ceiling hit → partial report flagged `incomplete (ceiling)`, never silent truncation.

**Anti-patterns:** asserting gloss content in `decision-assert.mjs`; single-shot (K=1) cases.

## 5. SCENARIOS (born-verifiable — covered by `test/eval-grader.test.mjs` with a mock driver)
- flakiness measured: `CaseResult.stability` distinct from `accuracy` for K≥2.
- wobbly cases escalate: ≥1 cross-rep disagreement → `escalated:true`, reps raised; fully-agreeing case stays at base K.
- capture out-of-band: grading reads a `JudgementEnvelope` parsed in `eval/`; `decision-assert.mjs` gains no content assertion.
- closed-set graded deterministically: no LLM in the grading path.
- gloss coverage = rubric pass-rate; judge advisory only.
- malformed envelope → rep `errored` (transcript ref), counted, never silently passed.
- `eval/` excluded from CI; `node --test` makes zero frontier calls.

## 6. DECISIONS (all Chosen; full rationale on tracker)
1. Capture: eval-mode `faff-eval:judgement` envelope, parsed out-of-band — not DecisionRecord fields.
2. Grading: two-tier deterministic (closed-set/ordering) + rubric gloss; LLM-judge advisory.
3. Gloss reporting: deterministic rubric pass-rate = coverage; judge advisory; ADR reports judge↔human delta (FAFF-131).
4. Size: 12 cases (2/kind) × K=20 base, adaptive escalation to ~50; cost not the limiter, statistical power is.
5. `eval/` excluded from CI globs.
6. SUT = `faff-tidy` only.

## 7. ASSUMPTIONS
- **Assumes** frontier via `claude -p` headless + per-run `CLAUDE_CONFIG_DIR` isolation (ADR 0003) — validated by FAFF-131's supervised smoke run.
- **Assumes** the `faff-tidy` judgement kinds still match `plugin/skills/faff-tidy/SKILL.md`.

## 8. DONE (FAFF-130 scope — measured-ADR DONE item is FAFF-131)
- [ ] Types implemented; `kind` validated against the populated oracle field.
- [ ] `grader.mjs` two-tier deterministic grader + aggregation.
- [ ] `run-evals.mjs` orchestrates load → drive(injectable) → grade → aggregate; base K=20 + adaptive escalation + ceiling; report.
- [ ] `frontier-driver.mjs` isolates `CLAUDE_CONFIG_DIR` per rep (written; exercised by FAFF-131).
- [ ] `faff-eval:judgement` envelope parsed in `eval/`; `decision-assert.mjs` content-assertion surface unchanged.
- [ ] Malformed envelope → `errored` rep surfaced; ordering oracle scores judgement-portion only; ceiling → flagged partial.
- [ ] `stability` distinct from `accuracy`; closed-set no-LLM; gloss coverage = rubric.
- [ ] `eval/` excluded from CI; `node --test` zero frontier calls (the new `test/eval-grader.test.mjs` uses a mock driver).
- [ ] **ADR-0004 scaffold** committed (structure + metrics + pending-markers; numbers are FAFF-131).
