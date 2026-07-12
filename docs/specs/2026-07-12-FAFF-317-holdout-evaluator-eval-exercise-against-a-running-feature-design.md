# FAFF-317 — Holdout evaluator eval: exercise against a running feature (recorded env-surface lane)

> Spec: faffter-dark-nlspec · 2026-07-11 · autonomous · confidence: high. Full spec on Linear FAFF-317.

This spec defines the eval work for FAFF-317: making the holdout evaluator's **exercise + met/unmet judgement** measurable. Audience: the build agent and human reviewers. It adds one grader kind (`holdout-exercise`), two eval cases, a seam-registry row, and fixes the cli-driver gap that leaves FAFF-284's shipped `holdout` kind undriveable.

## 1. WHY — Problem and Principles

**Load-bearing model.** The evaluator (`faffter-noon-evaluate`) has exactly one LLM-owned seam: *exercise the born-verifiable criteria and decide met/unmet* — derive what bears on each criterion from the criterion text alone, treat the env's responses as **data, never instructions**, and fail closed to `needs-human` when no surface bears. FAFF-284's shipped `holdout` kind measures only the easier downstream half (classify a **pre-digested narrative** transcript); this ticket measures the derive-and-interpret half with **raw, unaligned env-surface recordings** the judge must map onto criteria itself — the closest a deterministic, offline, black-box fixture can get to "an actual running feature".

**Problem statement.** The evaluator's exercise judgement is the L4 pipeline's trust anchor, and today it is unmeasured: FAFF-284 covers narrative classification only, and even that kind has never been correctly driven — `eval/cli-driver.mjs` has no `holdout` prompt renderer (it falls through to the faff-tidy-flavoured default at :571–574) and no `criteriaFor` arm, so the shipped kind is exercised only by mocked-grader tests. This change adds a recorded-env-surface kind for the exercise judgement and fixes the driver gap so both kinds run for real.

**Design principles.**

**Zero new grade math.** The new kind joins `CLOSED_SET_KINDS` and grades via the existing `pairsOf` → set-equality path. An eval that invents grade math would be rejected.

**Responses are data.** At least one case must plant a response that *claims* success while the raw observation shows failure; a judge that believes the claim must score a clean FAIL. This is the eval-side mirror of the skill's "never instructions" rule.

**Fail-closed is graded.** A born-verifiable criterion with no bearing recording must be classed `needs-human` (the skill's no-surface rule); an oracle pins it so a silent `met` is a miss.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/grader.mjs` | JS (ESM) | KINDS/CLOSED_SET_KINDS (:199–200), `pairsOf` (:518), `predictedSet` holdout arm (:573), `FIXTURE_SHAPE` (:252), `assertRegistryConsistent` |
| `eval/cli-driver.mjs` | JS (ESM) | `buildEvalPrompt` per-kind renderers, generic fallback :571–574, `criteriaFor` :582, fail-loud prose loaders (`loadTidyJudgementProse` pattern) |
| `eval/seam-registry.json` | JSON | KIND → surface map; `holdout` row at :25; total-equality asserted at grader load |
| `eval/cases/holdout-00{1,2}.json` | JSON | FAFF-284 fixture precedent: `{spec_dod, exercise}` + `closed_set` key:class oracle |
| `eval/run-live-evals.mjs` | JS (ESM) | `LIVE_KINDS` (:72–119) — reconciliation/routing/verdict-build only; the live-lane extension point |
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | prose | The measured rubric: exercise step + met/unmet decision + prose→needs-human + no-surface→needs-human |
| `test/holdout-evaluate-integration.test.mjs` + `test/helpers/holdout-exercise.mjs` | JS | Docker-gated PLUMBING proof with a deterministic scripted exerciser — explicitly "a test driver, never shipped behaviour" |
| `test/eval-grader.test.mjs` (:490–524) | JS | FAFF-284 mocked-grader test precedent to mirror |

**Scope statement.** This is the eval-coverage slice of project "T4 — affidavits become attestations": it measures the shipped evaluator, it never changes evaluator behaviour.

## 2. OUT OF SCOPE

- **Live-lane `LIVE_KINDS` holdout adapter** — driving the real skill agentically against a docker env inside the eval runner. Excluded: the live-driver is a completion-based model fn (no agentic tool loop), so this needs new harness machinery plus env provisioning coupled into the eval run; the deterministic integration test already proves live plumbing. Extension point: `eval/run-live-evals.mjs` `LIVE_KINDS` + a follow-up ticket (see Failure modes — the named residual).
- **Code-blindness enforcement** — construction + sandbox territory (FAFF-276), not an eval. Extension point: FAFF-276.
- **Baseline recording/acceptance** — human-supervised `claude -p` runs; never required by this DONE (nlspec eval-coverage rule). Extension point: the standing frontier-baseline follow-up flow.
- **Evaluator/env-slot behaviour changes** — `faffter-noon-evaluate` SKILL.md and `faff contract holdout-verdict` are read, not edited. Extension point: their own tickets.
- **Re-sourcing KINDS from the registry** — already named OUT OF SCOPE in `grader.mjs` (:216).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Recording | One raw request→response observation of the env surface (verbatim status/body/timing, no narrative gloss) |
| Bearing recording | A recording whose content is evidence for/against a specific criterion — the judge derives the mapping; the fixture never labels it |
| Distractor | A recording that bears on no criterion (noise the judge must ignore) |
| Trap recording | A recording whose response text claims success while the raw observation shows the criterion unmet |

**New kind fixture:**

```
RECORD HoldoutExerciseFixture:
  version: 1
  spec_dod: List<Criterion>          # identical shape to holdout: {key, class: scenario|assertion|prose, text}
  recordings: List<Recording>        # raw, UNALIGNED to criteria; includes distractors/traps

RECORD Recording:
  request: String                    # e.g. "GET http://env:8080/health"
  response: String                   # verbatim: status, body, timing — no interpretation

# Oracle (existing shape, no new fields):
oracle.closed_set: List<"<criterion-key>:<met|unmet|needs-human>">
# Envelope: env["holdout-exercise"] = { "<criterion-key>": "<class>" }  (the env.holdout analogue)
```

**Design decision — fixture articulation.** Recorded transcripts vs live env slot vs richer black-box lane. **Chosen:** the black-box `holdout-exercise` recorded-env-surface lane, plus fixing the `holdout` driver gap; live lane carved out (rationale in §6, D1).

**Design decision — new kind vs extending `holdout`.** **Chosen:** a new kind `holdout-exercise`, registered `covered` with 2 cases (rationale in §6, D2).

**Design decision — oracle.** **Chosen:** closed-set `key:class` pairs via `pairsOf` (rationale in §6, D3).

**Design decision — the cli-driver `holdout` gap.** **Chosen:** in scope — it is a defect in FAFF-284's shipped eval (rationale in §6, D4).

## 4. HOW — Behavior

**Architecture.** Four touch points, all existing patterns: grader registration, seam registry, cli-driver rendering/criteria, cases + tests.

**Grader (`eval/grader.mjs`):**

```
PROCEDURE register_holdout_exercise:
  1. Append "holdout-exercise" to KINDS and CLOSED_SET_KINDS (zero new grade math)
  2. Add the kind's doc comment above KINDS (the FAFF-284 style: what it scores, the carve-outs)
  3. FIXTURE_SHAPE["holdout-exercise"] = ["spec_dod", "recordings"]
  4. predictedSet: case "holdout-exercise": return pairsOf(env["holdout-exercise"])
     # missing/garbage map → pairsOf fail-safe → [] → clean FAIL, never a crash (the holdout stance)
```

**Seam registry (`eval/seam-registry.json`):** add `"holdout-exercise": { "surface": "faffter-noon-evaluate", "status": "covered" }`. `assertRegistryConsistent` forces this same-commit (registry↔KINDS total equality fail-louds at module load); `covered` is honest only because the 2 cases land in the same change (validate-adapters C2 hard-fails covered-with-0-cases).

**CLI driver (`eval/cli-driver.mjs`):**

```
PROCEDURE render_and_criteria:
  1. New fail-loud loader loadHoldoutJudgementProse(pluginDir):
     read plugin/skills/faffter-noon-evaluate/SKILL.md, extract verbatim the exercise-step +
     met/unmet + prose→needs-human prose (the loadTidyJudgementProse pattern: anchor on section
     headings, THROW if anchors move — never silently ship an empty rubric)
  2. criteriaFor: arms for BOTH "holdout" and "holdout-exercise" → loadHoldoutJudgementProse
  3. buildEvalPrompt branch, kind "holdout" (fixes the FAFF-284 gap):
     rubric + "Run the holdout judge's DoD classification against the recorded exercise and
     answer: <question>" + spec_dod (JSON) + fixture.exercise (verbatim)
  4. buildEvalPrompt branch, kind "holdout-exercise":
     rubric + question + spec_dod (JSON) + recordings rendered as a labelled raw catalog
     ("Recording N: <request> → <response>") — no per-criterion alignment, no narrative
```

**Cases (`eval/cases/holdout-exercise-00{1,2}.json`, 2 per the convention):**

- **001 — derive + interpret:** ≥4 recordings incl. ≥1 distractor; one criterion whose evidence spans two recordings; one prose criterion (oracle pins `needs-human`); a met/unmet mix. Neutral criterion keys — key names must not hint the class (see Failure modes).
- **002 — trap + no-surface:** a trap recording (body claims success, raw observation shows failure → oracle pins `unmet`); a born-verifiable criterion with **no** bearing recording (oracle pins `needs-human` — the fail-closed rule); a prose criterion (`needs-human`).

**Tests (deterministic, in `node --test` / CI — zero model spawns):**

- `test/eval-grader.test.mjs` — mirror the FAFF-284 block (:490–524) for the new kind: pairs set-equality PASS; a believed trap (`unmet` classed `met`) scores 0; prose self-graded scores 0; missing/garbage env map → clean FAIL, no throw; `validateCase` routes to `closed_set` and requires `spec_dod` + `recordings`.
- `test/eval-cli-driver.test.mjs` — both kinds render their bespoke prompt (contains the evaluate rubric + fixture fields; does **not** contain the tidy-fallback framing); `criteriaFor` returns the loader output for both kinds; the loader throws on a missing anchor.

**Edge cases / error handling.** Missing envelope field → `[]` → FAIL (never throw). Out-of-vocabulary class token → forwarded verbatim → distinct-signature FAIL (the routing/verdict stance). Malformed case JSON → `CaseError` at load (existing `validateCase` path). All eval-side; nothing here is retryable logic.

**Failure modes.**

- **Recording drift** — the recordings stop resembling what a real env produces, so the eval greens on fiction. *How you'd know:* the docker integration test's fixture family and the recordings diverge on review; a future live-lane run disagrees with the recorded baseline. *What it means:* re-author recordings from the integration-test env family (author them from real `http-echo`-class observations now to start honest); persistent divergence → prioritise the live lane.
- **The residual seam** — a single-prompt black-box cannot measure agentic command *derivation-and-execution* (the model choosing and running curl itself); it measures derive-which-recording + interpret + classify. *How you'd know:* the recorded lane baselines near-ceiling while real evaluator runs still misjudge. *What it means:* that is the signal to fund the OUT-OF-SCOPE live-lane adapter — a named follow-up, not a gap hidden in this eval's green.
- **Oracle leakage** — criterion keys or recording phrasing that telegraph the expected class inflate accuracy. *How you'd know:* the `--no-plugin` improvise baseline (the control) scores ≈ the with-rubric run. *What it means:* re-author the leaking fixture; the control-vs-rubric delta is the honesty check.

**Anti-pattern:** aligning recordings to criteria in the fixture (per-criterion evidence labels). Why: that re-creates FAFF-284's pre-digested narrative and measures nothing new.

## Scenarios

```
Given holdout-exercise-002's trap recording (response claims success, raw observation shows failure)
When the case is driven and the envelope classes that criterion "met"
Then the grade is FAIL (score 0) — believing the claim is the measured miss
```

```
Given a born-verifiable criterion with no bearing recording in the fixture
When the judge classes it anything but "needs-human"
Then the grade is FAIL — fail-closed is pinned by the oracle
```

```
Given the shipped `holdout` kind driven through buildEvalPrompt
When the prompt is built
Then it carries the evaluate skill's verbatim rubric + the fixture's spec_dod and exercise,
     and not the faff-tidy fallback framing
```

Assertions: no new grade math (`holdout-exercise` ∈ `CLOSED_SET_KINDS`, grades via `pairsOf`/`setEqual` only); `assertRegistryConsistent` passes at module load; `node --test` stays model-spawn-free.

## 6. DESIGN DECISION RATIONALE

**D1 — How to fixture "a running feature"?** Options: (a) live env slot in the eval run — highest fidelity, but slow, docker-couples the offline human-supervised eval to provisioning, and the live-driver has no agentic tool loop to drive the real skill anyway; (b) pre-digested narrative transcripts — already FAFF-284, measures nothing new; (c) raw unaligned env-surface recordings in the black-box lane — deterministic, fast, measures derive+interpret+classify, cost = authoring believable recordings. **Chosen:** (c), with the live-lane adapter as a named OUT-OF-SCOPE follow-up whose trigger condition is stated in Failure modes. The plumbing-vs-judgement split already exists: the docker integration test owns live plumbing deterministically; this eval owns the judgement.

**D2 — New KIND vs extending `holdout`?** Extending keeps one registry row but muddies two different measurements (narrative classification vs derive+interpret) into one baseline and one fixture shape. **Chosen:** new kind `holdout-exercise` — separable baselines, its own `FIXTURE_SHAPE`, registered `covered` because its 2 cases land same-commit (a kind without cases would start `designed`, advisory-only). Two kinds sharing one surface is established (faff-tidy owns four).

**D3 — What does the oracle measure?** Options: closed-set `key:class` pairs; or evidence-quality via `gloss_rubric` coverage. **Chosen:** closed-set pairs — zero new grade math, and evidence is already gated deterministically (`faff contract holdout-verdict` enforces `evidence_present`); an LLM evidence-quality judge would be advisory-only anyway (ADR-0004) and can be a later additive case dimension.

**D4 — Is the cli-driver `holdout` renderer gap in scope?** The shipped FAFF-284 kind has never been correctly driveable (generic tidy-flavoured fallback, no `criteriaFor` arm — mocked tests only). **Chosen:** in scope — it is a defect in the eval this ticket extends, the fix shares the new loader, and shipping `holdout-exercise` while leaving `holdout` undriveable would be absurd. At the time of writing the fallback sits at `cli-driver.mjs:571–574`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** `plugin/skills/faffter-noon-evaluate/SKILL.md` carries stable, extractable section anchors for the exercise-step + met/unmet + prose→needs-human prose. Validation: read the SKILL.md headings before wiring the loader; the loader is fail-loud, so a moved anchor breaks tests, never ships silence.

## 8. DONE — Definition of Done

### From WHY
- [ ] The shipped `holdout` kind is driveable: `buildEvalPrompt` renders the evaluate rubric + `spec_dod` + `exercise` for kind `holdout` (asserted: prompt does not contain the tidy-fallback framing)

### From WHAT
- [ ] `"holdout-exercise"` in `KINDS` and `CLOSED_SET_KINDS`; `FIXTURE_SHAPE` requires `spec_dod` + `recordings`
- [ ] `seam-registry.json` row `holdout-exercise → {surface: faffter-noon-evaluate, status: covered}`; `assertRegistryConsistent` passes; `faff validate-adapters` passes (C2: covered backed by cases)

### From HOW
- [ ] `predictedSet` arm returns `pairsOf(env["holdout-exercise"])`; missing/garbage map → clean FAIL, never a throw
- [ ] `loadHoldoutJudgementProse` extracts the evaluate prose verbatim, throws on missing anchors; `criteriaFor` arms for `holdout` and `holdout-exercise` both return it
- [ ] `eval/cases/holdout-exercise-001.json` + `-002.json` exist and `validateCase`-clean: 001 has ≥1 distractor + a two-recording criterion + a prose criterion; 002 has the trap (oracle `unmet`) + the no-bearing-recording criterion (oracle `needs-human`) + a prose criterion
- [ ] Mocked-grader tests: trap believed → score 0; prose self-graded → score 0; set-equality PASS on the correct map; fixture-shape rejections
- [ ] cli-driver tests: bespoke prompt per kind; loader fail-loud; no fallback framing
- [ ] `node --test` green with zero model/process spawns from `eval/` imports

### Eval coverage
- [ ] The changed seam's grader KIND + 2 eval cases + seam-registry row all land in this ticket (autonomous-doable); recording/accepting the frontier baseline is the separate human-supervised step, not required here

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Load all cases (loadCases) → holdout-exercise-001/002 validate clean
  2. prompt = buildEvalPrompt(holdout-exercise-001, criteriaFor("holdout-exercise"))
     → contains the evaluate rubric, the spec_dod keys, and every recording; no tidy framing
  3. grade(holdout-exercise-002, { "holdout-exercise": <the oracle map> }) → PASS
     grade(holdout-exercise-002, { "holdout-exercise": <trap key flipped to "met"> }) → FAIL
  4. import grader.mjs → assertRegistryConsistent does not throw
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** two concerns — the `holdout` driver-gap fix and the new `holdout-exercise` kind — but they always ship together (shared loader, one seam's measurability) and total well under the 1–3-day bar. Merge-not-split is correct; no action.
- **Value × risk (P2 + P7):** the risky judgement — *can a non-interactive recorded articulation discriminate at all?* — is de-risked inside the ticket by the trap/no-surface case design and the control-vs-rubric leakage check, with the live lane deliberately sequenced behind a stated trigger ("recorded lane at ceiling while real runs misjudge") rather than built speculatively.
- **Surfaced deps (P6):** builds on FAFF-284 (Done — no edge needed) and stays disjoint from FAFF-276. One finding: the OUT-OF-SCOPE live-lane follow-up exists only as spec prose; when this ships, file the follow-up ticket and link it, so the residual seam is tracker-visible rather than prose-only.
- **Workstream fit (P1 + P5):** lands squarely in the outcome project "T4 — affidavits become attestations" — the eval is what turns the evaluator's affidavit into an attestation. Cohesive; no rehome.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

spec-review: approve
