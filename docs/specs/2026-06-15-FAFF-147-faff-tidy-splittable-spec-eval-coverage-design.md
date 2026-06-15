# Spec — FAFF-147: faff-tidy splittable-spec eval coverage

> Spec: faffter-dark-nlspec · 2026-06-15 · interactive · confidence: high. Full spec on Linear FAFF-147.

> **Revised 2026-06-15** — resolved both Punts: splittable oracle shape = **closed_set, synonym-tolerant**; the dropped diagnostics are filed as follow-ups (**repeat-park → FAFF-152** scripted `test/`; **chain-gap → FAFF-153** deferred eval). Re-rated medium → **high**.

For the build agent and human reviewers. A **faff-internal test-coverage** change: add a `splittable` judgement-eval kind to `eval/`, covering faff-tidy's splittable-spec structural diagnostic. No product behaviour changes. The slice is **narrowed** from the ticket's three diagnostics to one — see OUT OF SCOPE.

## 1. WHY

**Problem statement.** faff-tidy's *classification* judgement is eval-covered (FAFF-130), but its **structural diagnostics** are not. Of the three, only **splittable-spec** is genuine LLM judgement (faff-tidy `SKILL.md` §5 marks it "LLM inspection"); it has no regression net. This slice adds one so a prompt edit that breaks splittable-spec detection fails loud.

**Design principles.**

- **Measure the *shipped* criteria, not an improvised rubric.** Like `loadTidyJudgementProse`, the splittable eval reads faff-tidy's real criteria *verbatim* from `SKILL.md` — so it can't drift from what ships. Requires a stable anchor (see HOW).
- **Only judgement belongs in `eval/`.** A deterministic diagnostic belongs in the `test/` scripted-driver harness, not here. This is the line that narrows the slice.

**Reference context.**

| System | Lang | Relevance |
|---|---|---|
| `eval/grader.mjs` (`KINDS` line 11, `grade()` ~line 77) | JS | Add the `splittable` kind + scorer branch |
| `eval/envelope.mjs` (lines 51–71) | JS | Parse the new envelope field |
| `eval/cli-driver.mjs` (`loadTidyJudgementProse`, `loadJudgementCriteria`, `EVAL_MODE_INSTRUCTION` line 121) | JS | New loader + prompt field |
| `eval/cases/*.json` | JSON | New `splittable-NNN` fixtures + oracles |
| `plugin/skills/faff-tidy/SKILL.md` §5 | MD | Splittable criteria prose — needs a dedicated anchor |

**Scope statement.** One new judgement kind in the offline eval harness, plus the SKILL.md anchor it reads.

## 2. OUT OF SCOPE

- **repeat-park eval** — *excluded:* **deterministic** (counts parks by root-cause enum in `.faff/runs/*/summary.md`). No judgement to grade. **Filed as FAFF-152** (scripted-driver test in `test/`).
- **chain-gap eval** — *excluded:* **mixed**; its LLM half needs a parsing-boundary decision first. **Filed as FAFF-153** (deferred eval, child of FAFF-145).
- **Auto-split behaviour** — *excluded:* faff has no auto-split; this slice evals *detection* only.
- **Refactoring all of §5 into per-diagnostic sub-headings** — *excluded:* add only the **splittable** sub-heading needed now. *Extension point:* FAFF-153 adds chain-gap's.

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| splittable-spec | A spec describing **two structurally-independent, each-ticket-sized** concerns — faff-tidy flags it for a human to split. |
| eval "kind" | A judgement category in `eval/` with a fixture, an oracle, and a grader branch. |
| oracle | The hand-authored "human answer" a case is graded against. |

**Envelope field (new).** The judgement envelope (`eval/envelope.mjs`) gains a `splittable` field — `case_id → array of identified concern labels`:

```
RECORD JudgementEnvelope (extended):
  case_id: string
  ...existing fields (classifications, ordering, gloss)...
  splittable: Map<case_id, Array<string>>   # the independent concerns identified; [] = "not splittable"
```

**Decisions:**

**Decision — slice scope.** **Chosen:** splittable-spec only; repeat-park (FAFF-152) and chain-gap (FAFF-153) leave per OUT OF SCOPE. Rationale in §6.

**Decision — splittable oracle shape.** **Chosen:** `closed_set` of independent-concern labels, graded by set-equality with **synonym tolerance** — reuse the gloss synonym-set machinery (FAFF-142) so 'URL routing' == 'routing' isn't a false-negative. (Resolved from Punt; rationale in §6.)

**Decision — criteria-prose anchor + loader.** **Chosen:** add a dedicated `#### Splittable specs` sub-heading under faff-tidy `SKILL.md` §5 and a `loadTidySplittableSpecProse(pluginDir)` in `cli-driver.mjs` reading it verbatim between fail-loud anchors, folded into `loadJudgementCriteria` for splittable cases. Mirrors `loadTidyJudgementProse`. Rationale in §6.

## 4. HOW

**Approach.** Add the kind end-to-end, smallest footprint:

```
PROCEDURE add_splittable_kind:
  1. faff-tidy SKILL.md §5: add a "#### Splittable specs" sub-heading wrapping the
     existing splittable criteria prose (append-only restructure; alter no wording).
     Pick a stable END anchor (the next existing sub-item heading in §5).
  2. cli-driver.mjs: add loadTidySplittableSpecProse(pluginDir) — same shape as
     loadTidyJudgementProse (indexOf START/END anchors, throw if either is absent).
     In loadJudgementCriteria, include the splittable prose when a splittable case runs.
  3. cli-driver.mjs: extend EVAL_MODE_INSTRUCTION (line 121) to document the
     `splittable` envelope field + its shape.
  4. envelope.mjs: parse and surface `splittable` (lines 51–71); tolerate its absence
     for non-splittable cases (same as ordering/gloss being absent today).
  5. grader.mjs: add "splittable" to KINDS (line 11). Add a grade() branch:
        - oracle.closed_set (concern labels) vs envelope.splittable[case_id]
        - score = set-equality WITH synonym folding (reuse the FAFF-142 gloss synonym-set
          helper): fold each identified label + each oracle label to its synonym-set
          canonical form before comparing
        - signature = JSON.stringify(sorted canonicalised set)  # deterministic, for stability
        - graded = PASS|PARTIAL|FAIL per the existing closed_set thresholds
  6. eval/cases/: add splittable-001.json (genuinely splittable; oracle = closed_set of the
     two concern labels + their synonym sets) + splittable-002.json (cohesive negative case;
     oracle = closed_set []).
  7. Record a FRONTIER baseline: node eval/run-evals.mjs --only splittable-001 (smoke),
     then the splittable cases; capture accuracy/stability/format in eval/report.
```

**Anti-pattern:** re-wording the splittable criteria while adding the anchor. **Why:** the eval must measure the *shipped* prose; editing it during the refactor silently changes what's tested. Wrap, don't rewrite.

**Anti-pattern:** grading on exact concern strings. **Why:** the model's labels are free-text; synonym-tolerant set-equality (the chosen oracle) avoids false-negatives — do not regress to exact-match.

## 5. SCENARIOS

```
Given a fixture spec describing two structurally-independent, ticket-sized concerns,
When the splittable eval runs on the frontier model with the verbatim shipped criteria,
Then the model's `splittable` envelope entry identifies both concerns,
 And the grader scores it PASS against the synonym-tolerant closed_set oracle.
```
```
Given a fixture spec describing a single cohesive concern (the negative case),
When the splittable eval runs,
Then the model returns an empty `splittable` set (not splittable),
 And the grader scores it PASS (correctly not-flagged).
```

Non-functional assertion: **`node --test` stays green** — the existing `eval/` deterministic tests pass with the new kind, spawning zero processes.

## 6. DESIGN DECISION RATIONALE

**Why narrow to splittable-spec?** The explore established per-diagnostic: splittable = judgement (eval-able), repeat-park = deterministic (→ `test/`, FAFF-152), chain-gap = mixed (→ FAFF-153, needs a boundary decision). A deterministic diagnostic in `eval/` would burn model calls testing a counting function; chain-gap before its boundary is decided would bake in the wrong oracle. **Chosen:** splittable only.

**Why closed_set + synonym tolerance for the oracle?** splittable detection *is* a set judgement ("which independent concerns are here"), so `closed_set` set-equality is the natural grader — same path dupe/vague use. But concern labels are free-text, so exact-match would false-negative correct splits; folding through the FAFF-142 synonym-set machinery (already in the gloss path) fixes that without a new grader mode. Rejected: gloss-rubric (conflates 'found the split' with 'phrased it well'); ordering (concerns aren't ordered). **Chosen:** closed_set, synonym-tolerant.

**Why a dedicated anchor + loader?** The eval measures the *shipped* criteria (FAFF-134); §5 bundles all diagnostics under one heading, so a verbatim read would pull in unrelated prose. A `#### Splittable specs` sub-heading lets the loader read exactly the right prose, fail-loud if it moves. **Chosen:** add the sub-heading + loader.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — both Punts resolved (oracle shape = closed_set synonym-tolerant; follow-ups filed as FAFF-152 / FAFF-153).

**Assumptions.**

- **Assumes:** `eval/grader.mjs`, `envelope.mjs`, `cli-driver.mjs` retain the structure the explore found (KINDS line 11, envelope lines 51–71, loader/anchor pattern, the FAFF-142 synonym-set helper) and faff-tidy `SKILL.md` §5 still holds the splittable prose. *Validation:* re-read those before editing; if anchors moved, re-locate.

## 8. DONE

### From WHY
- [ ] A prompt edit that breaks splittable detection makes a splittable case fail (the regression net exists).
- [ ] The eval reads faff-tidy's splittable criteria **verbatim** from `SKILL.md` (not an improvised rubric).

### From WHAT / HOW
- [ ] `"splittable"` added to `KINDS` (`eval/grader.mjs` line 11) + a `grade()` branch scoring a **synonym-tolerant closed_set** with a deterministic `signature`.
- [ ] `loadTidySplittableSpecProse(pluginDir)` added to `cli-driver.mjs`, reading §5's splittable sub-section between fail-loud anchors; folded into `loadJudgementCriteria` for splittable cases.
- [ ] `#### Splittable specs` sub-heading added under faff-tidy `SKILL.md` §5, wrapping the existing prose **unchanged**.
- [ ] `EVAL_MODE_INSTRUCTION` documents the `splittable` envelope field; `envelope.mjs` parses it (and tolerates its absence elsewhere).
- [ ] ≥2 cases: `splittable-001` (splittable, oracle = concern labels + synonym sets) + `splittable-002` (cohesive negative, oracle = `[]`).
- [ ] A **frontier baseline** for the splittable cases recorded in `eval/report`.

### Non-functional
- [ ] `node --test` green — existing `eval/` deterministic tests pass with the new kind.

**Integration smoke test:** `node eval/run-evals.mjs --only splittable-001 --reps 2` produces a graded result (not an envelope-parse error), and `node --test` exits 0.

confidence: high
