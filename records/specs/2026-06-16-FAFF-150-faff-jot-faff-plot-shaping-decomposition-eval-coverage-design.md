# Spec — FAFF-150: faff-jot / faff-plot shaping & decomposition eval coverage

> Spec: faffter-dark-nlspec · 2026-06-15 · interactive · confidence: high. Full spec on Linear FAFF-150.

_Revised 2026-06-15 (interactive reprep): resolved the generative-oracle Punt → advisory rubric-coverage; carved the frontier-baseline AC to a human-supervised follow-up. Re-rated medium → high._

This is the nlspec design document for FAFF-150, for the build agent and human reviewers. It extends the FAFF-130 judgement-eval harness — today wired exclusively to faff-tidy — to cover the faff-jot / faff-plot / intake skill family. It ships the **isolatable** half (mode detection) as a graded inlined-rubric kind, and **defers** the generative half (ticket shaping, plot decomposition) to a concrete follow-up that implements the now-chosen advisory rubric-coverage oracle.

## Already shipped against this surface

Related Done work in the Skill-behaviour harness project — this is the substrate FAFF-150 extends, not coverage of its surface (premise holds, not superseded):

- **FAFF-130** (Done) — the judgement-eval harness, deterministic grader, and the `KINDS`/`CLOSED_SET_KINDS`/`gradeGloss` registry this spec extends.
- **FAFF-135** (Done) — the live driver; faff-tidy-coupled (`buildJudgementPrompt` hardcodes "Run faff-tidy's judgement pass").
- **FAFF-131 / FAFF-151** (Done) — the frontier baseline run + ADR-0004 and its per-surface-lane addendum (the black-box lane does not execute the skill; lane is a per-surface call).
- **FAFF-134 / FAFF-140 / FAFF-142** (Done) — the verbatim-rubric-in-prompt pattern + the synonym-set `gloss` oracle (the advisory rubric-coverage precedent this spec's chosen oracle mirrors).
- **Sibling precedent** — FAFF-146 (prep evals) and FAFF-147 (tidy structural) were specced this session and both chose the same split: ship the isolatable/inlined-rubric half now, defer the generative/judgement half (FAFF-147 → FAFF-152/153). FAFF-150 follows it.

## 1. WHY — Problem and Principles

**Problem statement.** Intake's mode detection, jot/plot's ticket shaping, and plot's top-down decomposition are pure generative judgement and are entirely untested — yet they decide how every piece of new work enters the pipeline. The judgement-eval harness (FAFF-130) that measures faff-tidy's classification for accuracy and flakiness is hardcoded to faff-tidy and covers none of this. This change adds graded coverage for the one isolatable surface (mode detection) and settles the oracle policy for the rest.

**Design principles.**

**Deterministic grading, advisory LLM at most.** Per ADR-0004 and the FAFF-130 grader contract, the load-bearing reported coverage is mechanical — closed-set equality or a mechanical rubric. An LLM "is it good?" judge may exist only as an advisory signal, never as the reported metric. Any approach that puts an LLM in the load-bearing grading path is rejected.

**Flakiness is the headline metric, not just accuracy.** The grader measures per-case signature stability across K reps distinct from oracle accuracy. A new kind must produce a stable per-rep *signature* so cross-rep wobble is measurable — not only a pass/fail.

**Sync the rubric with what ships.** The eval prompt carries the skill's *own* rubric read verbatim from the `SKILL.md` under test, anchored on stable headers that fail loud if they move (the FAFF-134 pattern). A mode-detection kind reads jot/intake's real mode rule the same way — never a paraphrase.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | JS (node, zero-dep) | `KINDS`, `CLOSED_SET_KINDS`, `validateCase`, `grade`, `gradeGloss` — the kind registry + graders this extends (and the precedent the deferred `gradeShaping`/`gradeDecomposition` branches mirror) |
| `eval/cli-driver.mjs` | JS | `EVAL_MODE_INSTRUCTION`, `loadTidyJudgementProse`/`loadJudgementCriteria`, `buildEvalPrompt` — the black-box prompt builder, today faff-tidy-hardcoded |
| `eval/live-driver.mjs` | JS | FAFF-135 live driver; `buildJudgementPrompt` also faff-tidy-hardcoded |
| `eval/envelope.mjs` | JS | `parseJudgementEnvelope` — the `faff-eval:judgement` block parser |
| `eval/cases/*.json` | JSON | EvalCase corpus; `<kind>-NNN.json` |
| `plugin/skills/faff-jot/SKILL.md` | Markdown | §"1. Detect the mode" — the verbatim mode-detection rubric source |
| `plugin/skills/faffter-noon-intake/SKILL.md` | Markdown | greenfield / single-item mode definitions (Input + mode sections) |
| `plugin/skills/faff-plot/SKILL.md` | Markdown | §2 recurse top-down — the (deferred) decomposition rubric |

**Scope statement.** This sits in the `eval/` judgement-eval harness, alongside the faff-tidy kinds (dupe/vague/stale/superseded/ordering/gloss), as the first non-tidy skill-family coverage under the FAFF-145 umbrella.

## 2. OUT OF SCOPE

- **Generative ticket-shaping grading (build).** What: actually grading a brief → ticket-boundary set. Why excluded: a generated shaping has many valid forms; the oracle *policy* is now settled (advisory rubric-coverage — §7 Chosen), but the build is a separate unit. Extension point: a defined follow-up ticket implementing the advisory rubric-coverage oracle as a new `gradeShaping` branch in `eval/grader.mjs` mirroring `gradeGloss`.
- **Generative plot-decomposition grading (build).** What: grading a brief → initiatives/projects/first-slice-epics tree. Why excluded: same — a generated tree has no exact-match oracle; the structural sub-checks (dep-link validity, stop-rule adherence) are the chosen advisory checks. Extension point: same follow-up; a `gradeDecomposition` branch mirroring `gradeGloss`, carrying the structural assertions defined in §4.
- **Live-driver coverage of jot/plot.** What: driving the *real* jot/plot skill machinery through the FAFF-93 harness. Why excluded: the live driver (FAFF-135) is faff-tidy-coupled and jot/plot have no FAFF-93 harness seam wired; mode detection is gradable on the black-box CLI lane without it. Extension point: `eval/live-driver.mjs` `buildJudgementPrompt` parameterisation, in the same follow-up that needs faithful generative grading.
- **Changing faff-tidy's existing kinds or oracles.** Why: orthogonal; the de-coupling must leave the six tidy kinds byte-for-byte equivalent in behaviour.
- **A new methodology / shaping rule.** Why: this measures the shipped rubric, it does not author one.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| mode detection | jot/intake's greenfield-vs-single-item call for new work |
| greenfield | kick-off of an empty/new project (no tracker container yet) |
| single-item | one feature/bug/change inside an existing project |
| ambiguous | the genuine third outcome: big cross-cutting work in an existing project where jot's rule says "ask once" |
| inlined-rubric lane | the black-box `claude -p` CLI lane that carries the skill's verbatim rubric in the prompt (FAFF-134) |
| kind-family | the set of envelope fields + rubric loader a group of cases shares; today implicitly "tidy" |

**Type definitions.**

```
ENUM ModeVerdict: greenfield | single-item | ambiguous

RECORD ModeDetectCase (extends EvalCase):
  id: string                       # "modedetect-NNN"
  kind: "modedetect"
  fixture: { version, scenario }   # see below — NOT the tracker-issues shape
  question: string                 # e.g. "Greenfield, single-item, or ambiguous?"
  oracle: { closed_set: [ModeVerdict] }   # exactly one element (single-label closed set)
```

The mode-detect fixture is **not** the FAFF-89 backlog-issues shape (that fixture feeds tidy). It is a **scenario record** describing the input jot's mode rule actually consumes:

```
RECORD ModeScenario:
  version: 1
  user_request: string             # what the human said ("kick off a new CLI tool", "add a 401 on expired JWT")
  project_context: string | null   # null => no tracker project exists (greenfield signal); else a one-line project description
  existing_workstreams: [string]    # empty => greenfield signal; populated => existing project
```

**Envelope extension.** The `faff-eval:judgement` block gains an optional `mode` field carrying the single verdict string:

```
{ "case_id": "modedetect-001", "mode": "greenfield" }
```

A mode-detect rep emits only `mode`; a tidy rep emits only the tidy fields. The parser (`parseJudgementEnvelope`) is unchanged in shape — it already returns the whole parsed object; the grader reads the field its kind needs.

**Design decision — how to grade a single-label verdict.**
The grader's closed-set path uses set-equality (`setEqual`) against `oracle.closed_set`. A single mode verdict is exactly a one-element closed set. **Chosen:** reuse the existing `CLOSED_SET_KINDS` / `setEqual` path — `modedetect`'s prediction is `[env.mode]` (or `[]` when absent) and the oracle is a one-element `closed_set`. Rationale: zero new grader logic, an exact-match deterministic oracle, and a stable signature (the sorted single-element array) for free. A bespoke scalar-equality branch would duplicate `setEqual` for no gain.

**Design decision — closed-set vs gloss for the signature.** `modedetect` must be in `CLOSED_SET_KINDS` so `validateCase` requires `oracle.closed_set` (not `gloss_rubric`/`ordering`), and `grade` routes to the set-equality branch yielding `PASS`/`FAIL` + a sorted-array signature. **Chosen:** add `modedetect` to both `KINDS` and `CLOSED_SET_KINDS`.

## 4. HOW — Behavior

**Architecture and approach.** The harness is currently faff-tidy-hardcoded in two coupled spots: the *rubric loaded into the prompt* (`loadJudgementCriteria` = tidy "The mess" + synth gloss) and the *instruction* (`EVAL_MODE_INSTRUCTION` = "Run faff-tidy's judgement pass …" + the tidy envelope shape). Mode detection needs a *different* rubric source (jot/intake) and a *different* instruction + envelope field. The minimal de-coupling: make the prompt builder select a **per-kind-family rubric loader + instruction**, keyed off the case's kind, leaving the tidy family byte-identical.

**Behavior summary.** Loading the mode-detection cases drives K reps through the inlined-rubric CLI lane with jot's verbatim mode rule in the prompt; each rep returns a `mode` verdict; the grader compares it to the one-element oracle and records accuracy + a stable signature. The shippable build is model-free (mock-model dry-smoke under `node --test`); the recorded frontier baseline is a human-supervised follow-up (see §8).

```
PROCEDURE grade_modedetect_case(case, envelope):
  1. predicted := envelope.mode present ? [envelope.mode] : []
  2. ok := setEqual(predicted, case.oracle.closed_set)
  3. RETURN { graded: ok ? "PASS" : "FAIL", score: ok ? 1 : 0,
             signature: JSON.stringify(sorted(predicted)) }   # same shape as the closed-set branch
```

```
PROCEDURE build_eval_prompt(case, pluginDir):
  1. family := kindFamily(case.kind)        # "tidy" for the six existing kinds, "mode" for modedetect
  2. criteria := family == "mode"
       ? loadModeDetectProse(pluginDir)      # jot §"1. Detect the mode" (+ intake mode defs), verbatim
       : loadJudgementCriteria(pluginDir)    # UNCHANGED tidy path
  3. instruction := family == "mode" ? MODE_EVAL_INSTRUCTION : EVAL_MODE_INSTRUCTION
  4. RETURN renderPrompt(case, criteria) + "\n\n" + instruction.replace("<ID>", case.id)
```

`loadModeDetectProse` mirrors `loadTidyJudgementProse`: read `plugin/skills/faff-jot/SKILL.md`, slice between stable anchors (START `### 1. Detect the mode`, END `### 2. Discover`), fail loud if either anchor is missing. Append intake's greenfield/single-item definitions the same way if the jot section alone underspecifies the call.

`MODE_EVAL_INSTRUCTION` mirrors `EVAL_MODE_INSTRUCTION` but asks for the `mode` field only: output exactly one `faff-eval:judgement` block of shape `{ "case_id": "<ID>", "mode": "greenfield|single-item|ambiguous" }`, nothing else.

**The generative-grading oracle (chosen, deferred to build).** For ticket shaping and plot decomposition, no exact-match oracle is possible — a correct shaping/tree has many valid forms. **The standing grading bar is advisory rubric-coverage, the `gradeGloss` model** (§7 Chosen): a mechanical `must_include` / `must_avoid` coverage fraction, plus — for decomposition — structural assertions: *every proposed epic links to a parent project*, *no branch recurses past first-slice*, *dep links form a DAG*. Any LLM judge is kept strictly **advisory** per ADR-0004, never load-bearing. This is the same two-form pattern as the spec's own SCENARIOS (behavioural vs assertion), and it mirrors the shipped `gradeGloss` precedent (FAFF-142). It is *defined* here; it is *not built* here — its build is the concrete follow-up named in §8.

**Anti-pattern:** rewriting `EVAL_MODE_INSTRUCTION` / `loadJudgementCriteria` in place to be mode-aware. Why: it risks perturbing the six shipped tidy kinds and their recorded baseline; the de-coupling must be additive (a family selector), leaving the tidy path byte-identical.

**Anti-pattern:** putting an LLM judge on the load-bearing grading path for the generative surfaces. Why: violates ADR-0004 / the grader's deterministic contract; the LLM judge is advisory only.

**Edge cases.**
- Missing `mode` field in a rep → predicted `[]` → `FAIL` against any oracle, signature `"[]"` (distinct, lowers stability) — correct: a non-answer is not a pass.
- A rep that emits a value outside the enum (e.g. "feature") → `FAIL` by set-inequality; its raw signature still distinguishes it for the flakiness metric.
- `ambiguous` cases: at least one case whose oracle is `["ambiguous"]`, exercising jot's "ask once" branch so the eval can catch a model that forces a binary call.

## 5. SCENARIOS

```
Given a mode-detect case whose scenario has no project_context and empty existing_workstreams
When the inlined-rubric CLI lane runs K reps with jot's verbatim mode rule
Then each rep returns mode "greenfield" and the case grades PASS with a stable signature
```

```
Given a mode-detect case describing one feature inside a populated existing project
When the reps run
Then the verdict is "single-item" and grades PASS
```

```
Given a mode-detect case describing big cross-cutting work inside an existing project (jot's ask-once branch)
When the reps run
Then the oracle is "ambiguous" and a model that forces greenfield-or-single-item grades FAIL
```

Assertion (non-functional): the six existing tidy kinds produce byte-identical prompts and unchanged grades after the family-selector de-coupling (regression guard).

Assertion: the model-free dry-smoke runs under `node --test` with a mock model emitting a fixed `mode` envelope, exercising the grade path + parser end-to-end without `claude -p`. (The recorded *frontier* baseline is the carved human-supervised follow-up — §8.)

## 6. DESIGN DECISION RATIONALE

**Ship mode detection now, defer generative shaping/decomposition?**
- *Options:* (a) ship everything; (b) ship nothing until a tree-oracle is settled; (c) ship the isolatable mode-detect kind now, define the generative oracle and defer its build.
- (a) is blocked — no deterministic generative oracle exists; (b) wastes the cleanly-gradable mode-detect surface.
- **Chosen:** (c) — matches the ticket's own steer and the just-specced sibling precedent (FAFF-146 split isolatable from generative; FAFF-147 deferred its judgement half to FAFF-152/153). The generative oracle policy is now settled (advisory rubric-coverage — §7 Chosen); its build is a concrete, defined follow-up, no longer gated on an open product call.

**Reuse the closed-set path for the mode verdict?**
- *Options:* a bespoke scalar `gradeMode` branch; or model the verdict as a one-element closed set on the existing path.
- **Chosen:** the one-element closed-set path — zero new grader code, exact-match determinism, free stable signature. A scalar branch would re-derive `setEqual`.

**De-couple additively (family selector) vs rewrite the tidy prompt in place?**
- **Chosen:** additive family selector keyed off `case.kind`, leaving `loadJudgementCriteria` / `EVAL_MODE_INSTRUCTION` and the tidy grades byte-identical. Rewriting in place risks the recorded tidy baseline.

**Mode-detect fixture: scenario record vs the FAFF-89 issues shape?**
- **Chosen:** a dedicated `ModeScenario` record (user_request + project_context + existing_workstreams) — that is the input jot's mode rule consumes; the issues-array fixture is tidy's and would not exercise mode detection.

**Standing grading bar for the generative surfaces: advisory rubric-coverage vs a deterministic tree-oracle?**
- *Options:* (a) advisory rubric-coverage (gloss-style, mechanical coverage fraction + structural assertions, LLM judge advisory-only); (b) hold the generative surfaces uncovered until a deterministic tree-oracle is designed and settled.
- **Chosen:** (a) advisory rubric-coverage is the standing bar — it mirrors the shipped `gradeGloss` precedent (FAFF-142), keeps the load-bearing metric mechanical per ADR-0004, and matches what "tested" means for an inherently multi-valued generative output. (b) would indefinitely block a buildable follow-up on a deterministic oracle that may not exist for a many-valid-forms output.

(At time of writing, the live driver and the black-box CLI driver are both faff-tidy-hardcoded; this spec's de-coupling is the first generalisation of either.)

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Closed decisions.**

**Chosen:** advisory rubric-coverage is the standing grading bar for the generative surfaces (ticket shaping, plot decomposition). Concretely: a mechanical `must_include` / `must_avoid` coverage fraction plus structural assertions — *every proposed epic links to a parent project*, *no branch recurses past first-slice*, *dep links form a DAG* — with any LLM judge kept strictly **advisory** per ADR-0004 (never load-bearing). It mirrors the shipped `gradeGloss` oracle (FAFF-142). This settles what "tested" means for an inherently multi-valued generative output, so the deferred follow-up is concrete ("implement the advisory rubric-coverage oracle: `gradeShaping` / `gradeDecomposition` branches mirroring `gradeGloss`"), not an open product question.

**Assumptions.**

**Assumes:** `plugin/skills/faff-jot/SKILL.md` contains the section header `### 1. Detect the mode` (and `### 2. Discover` as its end anchor). Validation: `grep -n "### 1. Detect the mode" plugin/skills/faff-jot/SKILL.md` before wiring `loadModeDetectProse`; fail loud if absent (the FAFF-134 anchor pattern).

**Assumes:** the inlined-rubric CLI lane (`claude -p`, frontier preset) is usable for a non-tidy rubric unchanged — only the loaded criteria + instruction differ, not the transport. Validation: the model-free dry-smoke returns a parseable `mode` envelope through the grade path; the live `claude -p` confirmation is the human-supervised baseline follow-up (§8).

## 8. DONE — Definition of Done

### From WHY
- [ ] Mode detection has graded judgement-eval coverage on the inlined-rubric lane, verified by the model-free dry-smoke (the recorded frontier baseline is the carved follow-up below).
- [ ] A generative-grading oracle is chosen (advisory rubric-coverage — §7) and its build is filed as a concrete follow-up ticket.

### From WHAT (types and interfaces)
- [ ] `modedetect` added to `KINDS` and `CLOSED_SET_KINDS` in `eval/grader.mjs`.
- [ ] `validateCase` accepts `modedetect` requiring `oracle.closed_set` (one-element).
- [ ] The `faff-eval:judgement` envelope carries an optional `mode` field; the parser handles it without breaking the tidy fields.
- [ ] Mode-detect fixtures use the `ModeScenario` record shape, not the FAFF-89 issues array.

### From HOW (behaviour)
- [ ] ≥2 `eval/cases/modedetect-NNN.json` cases exist, covering greenfield, single-item, and ambiguous (≥1 each across the set).
- [ ] `loadModeDetectProse` reads jot's mode rule verbatim, anchored on stable headers, fail-loud if they move.
- [ ] The prompt builder selects rubric loader + instruction per kind-family; `modedetect` reps emit `{ case_id, mode }`.
- [ ] A mode-detect verdict grades PASS iff `[env.mode]` set-equals the one-element oracle; signature is the sorted predicted array.

### From HOW (edge cases / regression)
- [ ] Missing/out-of-enum `mode` grades FAIL with a distinct signature (flakiness preserved).
- [ ] The six existing tidy kinds produce byte-identical prompts and unchanged grades after the de-coupling (regression guard).

### Model-free smoke (shippable, no `claude -p`)
- [ ] A dry-smoke under `node --test` runs the `modedetect` grade path + envelope parser against a mock model emitting a fixed `mode` envelope — no live model call. This is the build's integration check.

### Carved follow-up (NOT done-here — human-supervised)
- [ ] **Recorded frontier baseline for mode-detect.** A human-supervised `claude -p` sweep (`node eval/run-evals.mjs --only modedetect-001 --reps 2` smoke + a fuller frontier run) records the frontier baseline for the `modedetect` kind. An unattended/interactive build cannot perform this sweep; it is filed as a separate `faff-automation-hold` follow-up after this build lands (the FAFF-158/160 pattern).
- [ ] **Implement the advisory rubric-coverage oracle.** A follow-up ticket implements `gradeShaping` / `gradeDecomposition` branches in `eval/grader.mjs` mirroring `gradeGloss` (coverage fraction + the structural assertions of §4), plus the `eval/live-driver.mjs` `buildJudgementPrompt` parameterisation for faithful generative grading. The oracle policy is settled (§7 Chosen); this is a defined build, not an open question.

**Integration smoke test (model-free):**

```
node --test eval/test/modedetect-drysmoke.test.mjs
# expect: the mock model emits a fixed faff-eval:judgement block with a `mode` field;
#         the modedetect grade path set-equals it against the one-element oracle;
#         tidy kinds untouched. No `claude -p`, no network — fully buildable now.
```

confidence: high
