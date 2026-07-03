# FAFF-321: Static Oracle-vs-Fixture Triage

> Spec: faffter-dark-nlspec on 2026-07-03 | interactive

**Artifact:** Triage table + proposed oracle/rubric fixes for 8 miscalibrated eval kinds  
**Audience:** implementer (human or qwen-local), spec reviewer  
**Resolves:** FAFF-319 scope reduction (paid calibration step 2); informs FAFF-315/69 cost-tiering

---

## 1. WHY — Problem and Principles

**Load-bearing model:** The eval calibration pipeline has 8 new judgement-eval kinds (architecture, spec-verdict, specqual, holdout, roadmap, adr-gloss, refutation-spec, refutation-code). Their oracles are **miscalibrated** — the rubrics/expected verdicts mismatch fixture reality. Before spending Opus reps on fixing them (FAFF-319 step 2: regenerate all outputs against the production judge), a **free static pass** separates fixable rubric bugs from cases that genuinely need re-judgment, shrinking the paid work.

**Problem statement:** Reading 24 eval case files by hand is tedious. Automating the triage — comparing each oracle to its fixture and classifying the mismatch type — surfaces the rough rubric problems (wrong must-include constraints, inverted expectations) and flags the cases needing model re-run or human review. This is a **cost-gate** before the expensive calibration work.

**Design principles:**
- **Static only** — no model run, no Fable spend, no Opus. Read code + JSON files on disk. A local model (qwen-next-instruct) can propose; a human approves before anything lands.
- **No re-definition of truth** — the triage *proposes* fixes to oracles; a human expert signs off (same discipline as FAFF-283 fixture reviews).

**Reference context:**

| Artifact | Relevance |
|---|---|
| `eval/cases/*.json` | 24 fixture+oracle files across 8 kinds, structured (fixture + question + oracle + comment) |
| `.faff/calibration/frontier-baseline-MISCALIBRATED-20260702.json` | Baseline data: which outputs are `0.00` with `1.00` stability (strong signal of gross rubric bugs) |
| FAFF-319 | The paid follow-on (regen step 2 after triage scope reduction) |
| FAFF-315 / FAFF-69 | Cost-tiering work that evals feed into |

**Scope statement:** This issue scopes (not executes) the calibration work for the 8 new eval kinds by triaging their current miscalibration into three classes and proposing fixes for the low-hanging (class a) items.

---

## 2. OUT OF SCOPE

| Name | Why excluded | Extension point |
|---|---|---|
| Re-generating oracle outputs | Paid work (Opus reps); deferred to FAFF-319 step 2 | FAFF-319 |
| Fixing all oracles in-place | Only class (a) fixes proposed; class (b)/(c) stay pending human judgement | FAFF-319 step 2 or manual review |
| Evaluating the local model (qwen) quality | The triage is a free data point on qwen's judgement capability; analysis deferred | FAFF-129 / FAFF-315 |
| Updating the frontier baseline snapshot | The 20260702 snapshot is the input; updated artifacts flow after calibration lands | FAFF-319 deliverables |

---

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| **Eval kind** | A LLM-judgement task (e.g., architecture-proposal, spec-review-verdict). A `kind` has multiple `cases`. |
| **Case** | One instance of an eval kind: fixture (input), question (prompt), oracle (expected answer), comment (notes). File: `eval/cases/<kind>-NNN.json`. |
| **Oracle** | The *expected correct* answer for a case. Structurally: `closed_set` (list of allowed strings) or `gloss_rubric` (must-include / must-avoid concept sets). |
| **Fixture** | The *input* to the question — context, brief, spec body, etc. Everything the evaluator sees. |
| **Rubric bug (class a)** | The oracle's rubric is factually wrong / too narrow — fixable by inspection, e.g., `must_include: ["postgres"]` when SQL or NoSQL both valid. |
| **Needs Opus regen (class b)** | The oracle's rubric is sound but the fixture or production judge changed since the oracle was written. Need to re-run the judge; can't tell statically. |
| **Genuine judgement call (class c)** | The rubric is sound *and* static inspection can't resolve it — e.g., refutation cases where "model miss" vs "oracle too strict" requires judgement. |

**Design decision — triage methodology:**

**Chosen:** Inspect each case's oracle against its fixture + the baseline snapshot (0.00 output + 1.00 stability signals gross misalignment). Classify by oracle structure, fixture-oracle alignment, comment alignment, and baseline signal. If the oracle is factually broken → class (a) + propose fix. If sound but fixture/judge changed → class (b). If sound but a judgement call → class (c).

---

## 4. HOW — Behavior

**Triage algorithm:** Load all 24 cases across 8 kinds. For each case, parse oracle, read fixture/question, inspect comment, check baseline. Classify per the algorithm. Emit TriageResult with all entries + summary.

**Per-case classification:** Check if oracle's must-include/must-avoid constraints contradict the fixture → class (a). Check if comment says judge changed → class (b). Check if case is subjective → class (c). Default to class (b).

**Failure modes:**
- Over-classification as (a): human reviewer rejects the fix → too aggressive heuristics
- Under-classification as (b): FAFF-319 regen still shows 0.00 → calibration revisits
- Silent oracle mis-write: case fails both review and regen → triage must flag conflicts

---

## 5. SCENARIOS — Born-verifiable objectives

**Scenario 1:** architecture-001 with `must_include: ["postgres", ...]` but fixture uses SQL/NoSQL → marked class (a) with proposed fix "relax to [SQL|NoSQL]"

**Scenario 2:** Case with "fixture changed" comment → marked class (b) with note "oracle needs re-validation"

**Scenario 3:** refutation case where determining "real refutation" requires human judgement → marked class (c)

---

## 6. DESIGN DECISION RATIONALE

**Chosen: Local model (qwen-next-instruct) for triage, not Opus.** Gross rubric bugs are detectable by weaker models; human approves before landing. Free, human-gated, cost-tiering intelligence.

**Chosen: Propose fixes for class (a) only.** Class (a) is low-risk; class (b)/(c) need expert judgement for FAFF-319.

**Chosen: Human-gate all fixes.** Eval oracles are trust-critical (FAFF-283 discipline).

---

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Assumptions:**
- `eval/cases/*.json` format is stable (fixture, question, oracle, _comment fields). **Validation:** read 5 random cases; verify structure.
- Baseline snapshot accurately reflects miscalibration. **Validation:** spot-check 3 cases marked 0.00/1.00.
- qwen-next-instruct is available via ollama. **Validation:** `curl $ANTHROPIC_BASE_URL/api/tags`.

**Open Questions:**
- **Punt:** Should triage flag fixture realism (e.g., missing team constraints)? → Deferred to FAFF-319 or fixture review.
- **Punt:** Handle cases with both closed_set AND gloss_rubric? → Not seen yet; treat as two layers if present.

---

## 8. DONE — Definition of Done

- [ ] All 24 cases classified (architecture×2, specqual×2, holdout×2, roadmap×2, adr-gloss×2, spec-verdict×3, refutation-spec×6, refutation-code×5)
- [ ] Class (a) cases have proposed fixes + rationale
- [ ] Class (b)/(c) cases marked with reasons
- [ ] Triage output flags oracle-comment misalignment
- [ ] Triage log includes auditable per-case notes
- [ ] architecture-001 correctly classified as class (a) with proposed fix
- [ ] TriageResult emitted with 24 entries and summary
- [ ] FAFF-319 scope reduction calculated (N class-b + M class-c = total for paid reps)

---

confidence: medium

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [
    { "marker": "chosen", "section": "Triage methodology" },
    { "marker": "chosen", "section": "Use local model for triage proposal" },
    { "marker": "chosen", "section": "Propose fixes for class (a) only" },
    { "marker": "chosen", "section": "Human-gate all fixes" },
    { "marker": "assumes", "section": "eval/cases/*.json format stable" },
    { "marker": "assumes", "section": "baseline snapshot accurate" },
    { "marker": "assumes", "section": "local model available" },
    { "marker": "punt", "section": "fixture realism checks" },
    { "marker": "punt", "section": "cases with dual oracle layers" }
  ] }
```