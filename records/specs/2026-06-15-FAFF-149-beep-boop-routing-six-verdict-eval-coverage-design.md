# FAFF-149 — routing six-verdict assignment judgement-eval (the `routing` kind)

> Spec: faffter-dark-nlspec · 2026-06-15 · autonomous · confidence: high. Full spec on Linear FAFF-149.

This is the build spec for FAFF-149, addressing the untested **routing-verdict assignment judgement** — the L3 build-queue chokepoint that maps a spec-gated issue's assembled findings onto one of the six automation-routing verdicts. Audience: the build agent extending `eval/`, and human reviewers checking the deterministic/judgement scope line. It follows the same recipe FAFF-146/147/148 used to add a judgement-eval kind, and makes the same split-the-lane call.

## Already shipped against this surface

The autonomous already-shipped scan (Done tickets in *Skill-behaviour harness*, matched on the `eval/` surface + routing/verdict signals) found **enabling infrastructure and adjacent kinds, none of which assign the routing verdict** — the premise holds:

- **FAFF-130** (Done) — the judgement-eval harness + deterministic grader (`KINDS`, `CLOSED_SET_KINDS`, `setEqual`, reps/escalation). This is the substrate this issue extends, not coverage of the routing surface.
- **FAFF-135** (Done) — the live-driver for the skill-run harness. The deferred half of this issue rides it (see OUT OF SCOPE / the carved follow-up).
- **FAFF-131 / FAFF-151** (Done) — the frontier probe + ADR-0004 (and its addendum): evals-only-on-frontier is the standing gate; the black-box lane measures model+rubric+fixture, does not execute the skill; lane is a per-surface call.
- **FAFF-146** (Done) — prep's `confidence` + `marker` closed-set kinds (reconciliation carved to FAFF-154). Same closed-set-over-assembled-fixture pattern; different surface (spec readiness, not routing).
- **FAFF-147** (Done) — tidy's structural diagnostics (`splittable`; chain-gap deferred to FAFF-153). The `circular-blocked` / `gap-blocked` *detection* inputs originate here, but detection is the methodology's job — this issue tests the *verdict assignment over* those findings, not the detection.
- **FAFF-148** (Done) — the `verdict-revert` review-verdict kind, with `verdict-build` **registered-but-carved** to FAFF-155 (live-driver). This is the **direct precedent** for both the closed-set shape and the split-the-lane call this spec makes.

No Done ticket assigns the automation-routing verdict. The routing-assignment judgement is genuinely uncovered.

## 1. WHY — Problem and Principles

**Problem statement.** The six-verdict automation-routing assignment + the build-queue admission rule are the L3 safety chokepoint — they decide what `/faff-beep-boop` builds unattended versus routes out for a human — yet the *assignment judgement* (which verdict an issue's assembled findings imply) has no eval. This issue adds judgement-eval cases + a deterministic oracle for that assignment, on its faithful (isolatable) lane, recording a frontier baseline.

**Design principles.**

- **Scope to the judgement, never the deterministic precedence.** The verdict computation has two halves. The *deterministic* half — `faff next`'s legal-next-step precedence (`nextStep` in `plugin/skills/faff/bin/faff`, exercised by `faff next --selftest`) and the `faff contract automation-routing` *shape* conformance (the closed-six enum check, fail-loud on out-of-enum) — is **already tool-tested** and is out of scope. The *judgement* half — assigning *which* of the six verdicts an assembled fixture-of-findings implies — is what this eval measures. This is the same split the `routing_adaptor` contract draws: the contract script owns shape, the adaptor owns the input-consistency assignment.
- **Reuse the closed-set path; do not invent a grader branch.** The assigned verdict is a single element of a closed six-set, so the `routing` kind joins `CLOSED_SET_KINDS` and grades through the existing `setEqual` path with a single-element predicted set — exactly as `confidence` does. No new grade branch (contrast `splittable`, which needed synonym folding). The admission-rule assertion is a *derived deterministic check over the assigned verdict*, asserted in the case, not a second LLM judgement.
- **Split the lane, ship the isolatable half (sibling precedent).** FAFF-146/147/148/150 all shipped the inlined-rubric half now and carved the execution-entangled live-driver half to a follow-up. FAFF-149's own open question proposes exactly this. Ship verdict-assignment over a **pre-assembled** fixture-of-findings (inlined-rubric, closed-set) now; defer **live input-assembly** (diagnostics run + markers/confidence parsed + park-history read + live-thread reconciliation folded across a real pass) to a carved FAFF-135 child.
- **Anchor the rubric loader on a stable header, fail-loud on drift.** The verbatim criteria are read from the gateway's fixed routing section, anchored on stable headers; a prose refactor that moves them must consciously re-point the loader (the `loadTidyJudgementProse` contract).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | JS (ESM) | `KINDS` / `CLOSED_SET_KINDS` / `predictedSet` / `grade` / `setEqual` — the closed-set path the new kind joins |
| `eval/cli-driver.mjs` | JS (ESM) | `criteriaFor` / `modeInstructionFor` / `buildEvalPrompt` / verbatim prose-loaders — per-kind prompt assembly |
| `eval/envelope.mjs` | JS (ESM) | `parseJudgementEnvelope` — generic JSON envelope, passes a new top-level field through unchanged |
| `plugin/skills/faff/SKILL.md` → *Automation-routing verdict (fixed)* | Markdown | The verbatim rubric source (six-verdict vocab + admission rule + root-cause enum) |
| `plugin/skills/faffidavit-routing/SKILL.md` | Markdown | The assignment-conditions recap + `likely-fire` collision-group rule |
| `plugin/skills/faff/bin/faff` → `nextStep` / `ROUTING_VERDICTS` | JS | The DETERMINISTIC precedence + contract shape check — the out-of-scope boundary, named so the build agent doesn't re-test it |

**Scope statement.** A new `routing` (verdict-assign) judgement-eval kind under FAFF-145's *Judgement-eval coverage across all faff skills*, sitting beside `verdict-revert` as the second review/routing-gate judgement surface.

## 2. OUT OF SCOPE

- **Live input-assembly (the execution-entangled half).** Why excluded: assembling diagnostics + confidence + markers + park-history + live-thread reconciliation across a *real* pass is execution-entangled — it needs the benched live-driver, exactly as `verdict-build` (FAFF-155) and reconciliation (FAFF-154) were carved. Extension point: a `routing` live-driver case parameterised through `eval/live-driver.mjs`, validating against the same kind registered here. Filed as the carved follow-up.
- **The deterministic precedence function.** Why excluded: `nextStep` (`faff next`) is a pure transition function already covered by `faff next --selftest`. Extension point: `nextSelftest` in `plugin/skills/faff/bin/faff`.
- **The contract shape check.** Why excluded: `faff contract automation-routing` (the closed-six enum validation + root-cause normalisation + fail-loud) is deterministic and self-tested. Extension point: the `automation-routing` selftest cases in `bin/faff`.
- **pick-ordering.** Why excluded: the methodology's sequencing judgement is covered by `ordering-*` cases. Extension point: `eval/cases/ordering-*.json`.
- **gloss / synthesis.** Why excluded: covered by `gloss-*`. Extension point: `eval/cases/gloss-*.json`.
- **repeat-park *detection* (the deterministic count).** Why excluded: counting ≥3 same-root-cause parks in 21 days is a deterministic scan (FAFF-152, scripted-driver). This eval tests that an issue *already carrying* ≥3-same-class park-history is *assigned* `repeat-parked` — the judgement over the assembled history, not the counting. Extension point: FAFF-152.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| verdict assignment | Mapping a spec-gated issue's assembled findings onto exactly one of the six routing verdicts. The judgement under test. |
| assembled fixture-of-findings | A case fixture pre-populating the assignment inputs (spec confidence, markers, the relevant `backlog-diagnostics` finding, conflict-analysis independence, park history) — inlined, not assembled live. |
| admission rule | The fixed gateway rule: only `fire-and-forget` + `likely-fire` enter the build queue; the other four route out. Asserted deterministically over the assigned verdict. |

**The closed six (verbatim, the gateway's vocabulary):** `fire-and-forget`, `likely-fire`, `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`.

**Case schema (the existing shape, with a routing fixture).**

```
RECORD EvalCase (routing kind):
  id: string                       # "routing-NNN"
  kind: "routing"
  fixture: RECORD RoutingFixture:
    version: 1
    issue: { id, title, status }   # the spec-gated issue under assignment
    spec: { confidence, markers }  # confidence ∈ {high,medium,low}; markers = list of {section_key, class∈chosen|punt|assumes}
    diagnostics: {                 # the backlog-diagnostics findings that bear on routing (any may be absent)
      in_cycle: bool,              # → circular-blocked input
      ghost_project_or_missing_dep: string|null,  # → gap-blocked input
    }
    conflict: { independent: bool, collision_group: [issue-id] }  # → fire-and-forget vs likely-fire input
    park_history: [ { root_cause } ]   # root_cause ∈ the closed five; ≥3 same-class → repeat-parked input
  question: string                 # "Assign the automation-routing verdict for this issue."
  oracle: { closed_set: [ "<one of the six>" ] }   # single-element — the human-assigned verdict
```

**Envelope field (new top-level field, wired at both ends per the FAFF-134 anti-pattern).**

```
{ "case_id": "<ID>", "verdict": "<one of the closed six>" }
```

`parseJudgementEnvelope` passes `verdict` through unchanged (generic JSON object — same as `splittable`/`gloss` needed no parser change). The grader reads `env.verdict` for the `routing` kind.

**Design decisions** (each closed below in §6, collected here):

- The oracle shape — single-element closed-set vs a pair-map. **Chosen:** single-element `closed_set` of the assigned verdict (see §6.A).
- Where the admission-rule assertion lives. **Chosen:** a deterministic derived check over the assigned verdict, asserted per-case, not a second judgement field (see §6.B).
- How `routing` grades. **Chosen:** join `CLOSED_SET_KINDS`, reuse `setEqual` via a new `env.verdict` arm in `predictedSet` (see §6.C).

## 4. HOW — Behavior

**Architecture and approach.** The `routing` kind threads through the same five extension points the recipe names, mirroring `confidence` (single-element closed-set) almost exactly — the only novelty is the fixture shape and the rubric source.

1. **Grader** (`eval/grader.mjs`): add `"routing"` to `KINDS` **and** `CLOSED_SET_KINDS`; add a `case "routing": return env.verdict == null ? [] : [String(env.verdict)];` arm to `predictedSet` (the malformed-verdict fail-safe → empty set → clean FAIL, never a crash, matching the `confidence` analogue); add `routing` to `FIXTURE_SHAPE` asserting its fixture carries `issue` + `spec`.
2. **Rubric loader** (`eval/cli-driver.mjs`): add `loadRoutingVerdictProse(pluginDir)` reading the gateway's *Automation-routing verdict (fixed)* section verbatim, anchored on stable headers, fail-loud on drift. The recap table + assignment conditions live in `faffidavit-routing/SKILL.md`; fold both (gateway = the fixed contract, the adaptor = the assignment conditions), the same two-source fold `loadReviewVerdictProse` does.
3. **Envelope instruction** (`eval/cli-driver.mjs`): add `ROUTING_MODE_INSTRUCTION` — "assign exactly one verdict … emit `{ "case_id", "verdict" }`" with the same output-only hardening; route it via `modeInstructionFor` / `buildEvalPrompt`.
4. **Prompt rendering** (`eval/cli-driver.mjs`): `renderFixturePrompt` gains a `routing` branch rendering the assembled fixture-of-findings as JSON under the rubric; `criteriaFor("routing", …)` returns `loadRoutingVerdictProse`.
5. **Cases** (`eval/cases/routing-*.json`): **≥6** cases — one per verdict — so each verdict's assignment conditions are exercised; plus the admission assertion embedded per-case.

**Behaviour summary — assignment.** Given the assembled fixture, the model applies the gateway's assignment conditions and emits the single verdict; the grader set-equals it against the one-element oracle.

```
PROCEDURE assign_routing_verdict(fixture):
  1. IF park_history has >=3 entries of one root_cause class  -> repeat-parked
  2. ELSE IF diagnostics.in_cycle                              -> circular-blocked
  3. ELSE IF diagnostics.ghost_project_or_missing_dep != null  -> gap-blocked
  4. ELSE IF spec has an unclosed Punt/Assumes OR spec.confidence == medium -> needs-decision-first
  5. ELSE IF spec.confidence == high AND in a collision_group  -> likely-fire
  6. ELSE IF spec.confidence == high AND independent           -> fire-and-forget
```

This procedure is the *rubric the model is given verbatim* (it is the gateway's, not invented here) — it is **not** re-implemented as grader code. The grader only set-equals the model's emitted verdict against the human oracle. The precedence ordering above (repeat-park → cycle → gap → decision → fire) is the assignment judgement under measurement; the cases are authored so each branch is the single defensible answer.

**Admission-rule assertion.** Each case's `fixture` carries the expected admission outcome implicitly via the oracle verdict: `fire-and-forget` and `likely-fire` admit; the other four route out. The assertion is realised as a **deterministic derived check** colocated with the cases: assert `admits(verdict) == (verdict ∈ {fire-and-forget, likely-fire})` over the oracle verdict. Because admission is a pure function of the verdict, it adds no LLM judgement and stays out of the graded path.

**Edge cases and error handling.**

- A model emitting a verdict outside the closed six → `predictedSet` returns `[that string]`, `setEqual` against the one-element oracle FAILS cleanly with a distinct signature (the eval-side fail-safe). The deterministic fail-loud-on-out-of-enum lives in `faff contract automation-routing` and is deliberately NOT duplicated in the grader (the §3-coercion-stance precedent from `verdict-revert`).
- A missing `verdict` field → empty predicted set → clean FAIL, never a crash.
- Two findings active at once (e.g. in a cycle AND medium confidence) → the precedence ordering above resolves it; the case is authored on the dominant branch so a single defensible answer exists (no ambiguous-oracle case ships).

**Anti-pattern:** Re-implementing the precedence ordering as grader code and grading the model against the code. Why: that measures the code, not the judgement, and couples the grader to a rubric that lives (and may move) in the gateway. The grader stays a pure set-equality over a human oracle; the rubric reaches the model as verbatim prose.

**Anti-pattern:** Authoring a case where two verdicts are equally defensible. Why: the closed-set oracle is single-answer; an ambiguous fixture produces unstable reps that aren't a real flakiness signal. Author each case on the unambiguous dominant branch.

## 5. SCENARIOS — born-verifiable main objectives

```
Given an assembled fixture with spec confidence:high, no open markers, independent (not in a collision group), no diagnostics findings, empty park-history
When the routing verdict is assigned over it
Then the assigned verdict is "fire-and-forget" and it is admitted to the build queue
```

```
Given an assembled fixture with spec confidence:high but in a collision group with other in-queue work
When the verdict is assigned
Then the assigned verdict is "likely-fire" and it is admitted (serialised within its group)
```

```
Given an assembled fixture with an unclosed Punt marker (or retained confidence:medium)
When the verdict is assigned
Then the assigned verdict is "needs-decision-first" and it routes OUT of the build queue with a surfaced reason
```

```
Given an assembled fixture whose diagnostics carry a ghost-project / missing-dependency pointer
When the verdict is assigned
Then the assigned verdict is "gap-blocked" and it routes out
```

```
Given an assembled fixture whose diagnostics mark the issue in a dependency cycle
When the verdict is assigned
Then the assigned verdict is "circular-blocked" and it routes out
```

```
Given an assembled fixture with park-history of >=3 parks of the same root-cause class
When the verdict is assigned
Then the assigned verdict is "repeat-parked" and it routes out (no resolve-attempt)
```

```
(Non-functional) The admission outcome is a pure function of the assigned verdict: admits ⟺ verdict ∈ {fire-and-forget, likely-fire}. No case requires a second LLM judgement for admission.
```

```
(Non-functional) The grader uses NO LLM in the load-bearing path; `routing` grades via setEqual over the single-element oracle, identical to the confidence kind.
```

## 6. DESIGN DECISION RATIONALE

**A. Oracle shape — single-element closed-set vs pair-map.**
- *Single-element `closed_set`* (`["fire-and-forget"]`): the assignment is exactly one verdict per issue; mirrors `confidence`'s single-element level set.
- *Pair-map* (`{issue: verdict}`, like `verdict-revert`/`marker`): only needed when a case grades *multiple* units at once.
- **Chosen:** single-element `closed_set` — one issue, one verdict per case. Rationale: the assignment contract assigns exactly one verdict per Todo issue; a one-issue-per-case fixture keeps each case a clean single-judgement measurement and reuses `predictedSet`'s simplest arm.

**B. Where the admission-rule assertion lives.**
- *A second LLM judgement field* (`admits: bool`): would measure the model re-deriving a rule that is a pure function of the verdict — wasteful and noisy.
- *A deterministic derived check over the assigned verdict*: admission is `verdict ∈ {fire-and-forget, likely-fire}` — pure, no judgement.
- **Chosen:** deterministic derived check, kept out of the graded LLM path. Rationale: the admission rule is fixed and mechanical; the eval's job is the *assignment* judgement, and admission falls out of it deterministically. This honours "scope the eval to the judgement, not the deterministic assignment" from the issue's open question.

**C. How `routing` grades.**
- *Own grade branch* (like `splittable`): unnecessary — there's no synonym folding or partial credit; the verdict is an exact closed-set member.
- *Join `CLOSED_SET_KINDS`* and add a `predictedSet` arm: reuses `setEqual` + the modal-signature flakiness machinery for free.
- **Chosen:** join `CLOSED_SET_KINDS`, add the `env.verdict` arm. Rationale: the verdict is a single closed-set element — the exact shape `setEqual` grades; matches the `confidence` precedent line-for-line.

**D. Split the lane (the headline call).**
- *Ship both halves now*: the live input-assembly is execution-entangled (needs the benched live-driver) — would balloon scope and duplicate the FAFF-155/FAFF-154 carve.
- *Ship the isolatable half, carve the live half*: matches FAFF-146/147/148/150 unanimously and the issue's own open question.
- **Chosen:** ship verdict-assignment over a pre-assembled fixture (inlined-rubric, closed-set) now; carve live input-assembly to a FAFF-135 child (recorded in run discovered-scope). Rationale: the assignment judgement is fully measurable over an assembled fixture today; the live assembly is a separate, benched capability. At the time of writing, the live-driver (FAFF-135) exists but per-surface live cases are carved follow-ups (FAFF-154/FAFF-155 precedent).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The issue's open question (how much input-assembly to stub vs run live) is **resolved** by Decision D: stub (inline) the assembly for this issue, carve the live assembly to the FAFF-135 child.

**Assumptions.**

- **Assumes:** the gateway *Automation-routing verdict (fixed)* section and `faffidavit-routing`'s assignment-conditions recap exist at stable headers the loader can anchor on. Validation: before authoring `loadRoutingVerdictProse`, grep both `SKILL.md`s for the section headers and confirm they are present (the loader fails loud if not). Confirmed present this session: `### Automation-routing verdict (fixed)` in `faff/SKILL.md`; `## The six verdicts` + `### Assignment` in `faffidavit-routing/SKILL.md`.
- **Assumes:** `eval/` remains excluded from the `node --test` CI globs (the harness is not run in CI; a real K=20 run is the human-supervised baseline job, sibling to FAFF-156). Validation: the new cases are smoke-validatable via `node eval/run-evals.mjs --only routing-001 --reps 2`; the frontier baseline is recorded out-of-band (FAFF-156-class), not in CI.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `routing` (verdict-assign) judgement-eval kind exists, measuring the assignment judgement only — the deterministic precedence (`faff next`) and contract shape check (`faff contract automation-routing`) are untouched and unduplicated.

### From WHAT (types and interfaces)
- [ ] `KINDS` includes `"routing"`; `CLOSED_SET_KINDS` includes `"routing"`.
- [ ] `FIXTURE_SHAPE.routing` asserts the fixture carries `issue` + `spec`.
- [ ] The envelope field `verdict` passes through `parseJudgementEnvelope` unchanged; `predictedSet` reads `env.verdict` for the `routing` kind (missing/garbage → empty set → clean FAIL).
- [ ] Each case's `oracle.closed_set` is a single-element array of one of the closed six verdicts.

### From HOW (behaviour)
- [ ] `loadRoutingVerdictProse(pluginDir)` reads the gateway routing section + the adaptor assignment-conditions verbatim, anchored on stable headers, fail-loud on drift.
- [ ] `criteriaFor("routing", pluginDir)` returns `loadRoutingVerdictProse`; `pluginDir: null` → no criteria (the improvise baseline control).
- [ ] `ROUTING_MODE_INSTRUCTION` is wired via `modeInstructionFor` / `buildEvalPrompt`; `renderFixturePrompt` has a `routing` branch.
- [ ] `grade` routes `routing` through the closed-set `setEqual` path with the `env.verdict` predicted set.

### From HOW (cases + admission)
- [ ] ≥6 `eval/cases/routing-NNN.json` cases, one per verdict (fire-and-forget · likely-fire · needs-decision-first · gap-blocked · circular-blocked · repeat-parked), each authored on its unambiguous dominant branch.
- [ ] An admission-rule assertion verifies `admits(verdict) ⟺ verdict ∈ {fire-and-forget, likely-fire}` over the assigned verdicts, deterministically (no second LLM judgement).

### From HOW (edge cases)
- [ ] An out-of-enum / missing `verdict` from the model produces a clean FAIL with a distinct signature, never a crash; the deterministic fail-loud stays in `faff contract automation-routing`, not the grader.

### From scope
- [ ] The live input-assembly follow-up is recorded as a carved child, and the `routing` kind is registered such that a future live-driver case validates without a grader change.

**Integration smoke test:**

```
PROCEDURE smoke():
  1. node eval/run-evals.mjs --only routing-001 --reps 2
  2. EXPECT: the run completes; routing-001 grades PASS on a correct verdict (or a clean FAIL/stable signature on a wrong one), no crash, an envelope is parsed.
  3. (CI) node --test  — the existing grader/driver unit tests still pass with "routing" added to the kind tables.
```

confidence: high

## Frontier baseline — autonomous-safety carve-out

The Acceptance criterion "frontier baseline recorded" **cannot be discharged autonomously**: it requires a real `node eval/run-evals.mjs` run against the frontier model (`claude -p`), which is recursive-claude-p + `~/.claude.json` config-race + cost territory (FAFF-131 / FAFF-156 faff-automation-hold). It is recorded as a human-supervised follow-up (discovered-scope) and is NOT faked. Model-free dry smoke (envelope→grade over a fixture) is run in its place to prove the wiring.
