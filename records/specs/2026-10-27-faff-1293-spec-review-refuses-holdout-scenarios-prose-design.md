# FAFF-1293 — Spec review refuses holdout scenarios that are really prose

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1293.

This spec covers issue **FAFF-1293, "Spec review refuses holdout scenarios that are really prose."** It is written for the build agent that implements the change and for the human reviewers who gate it. A `## Scenarios` unit that `faff dod classify` puts in the `prose` class can never be judged by the code-blind holdout. When that unit is also holdout-marked, it is withheld from the builder as well, so it checks nothing. This change catches such units at authoring time, at spec review, and at build admission, and names each one so the author can rewrite it.

## 1. WHY — Problem and Principles

**Load-bearing model.** Every `## Scenarios` unit belongs to the code-blind holdout. `faff dod classify` gives it `source="scenarios"` and the `running-stack` tier. No other verifier receives a Scenarios unit by id (ADR-0140), and FAFF-1291 deliberately kept prose Scenarios units on that tier for this reason. The holdout evaluator (`faffter-noon-evaluate`) records a prose Scenarios unit as `needs-human` with the reason "prose scenario: no machine check and no delegate verifier". That one criterion is enough to make the holdout aggregate `needs-human`. If the unit is holdout-marked, `faff dod split --view builder` also removes it from the builder's view. The builder never sees the requirement and the holdout cannot test it, so the unit checks nothing. Moving the unit to another verifier would not help, because there is nowhere to move it. The fix is to stop such a unit being written, and to flag it for rewrite before the spec is promoted.

**Problem statement.** Today a Scenarios unit with no `Then` and no `MUST` or comparator classifies as `prose`, and nothing says so before build. The FAFF-1279 spec's visible bullet "When `review-call.mjs` gets no `--fixture-path` flag, its stdout is byte-identical…" has this shape: a `When` with no `Then`. `faff admissible --lights-out` stays silent on such a unit, and its R1 count even counts a `Given`/`When` block that has no `Then`. This change adds a named, deterministic advisory for prose Scenarios units, has the spec producers check for it before they self-rate, and has the spec-review QA lens raise any unit that gets past them, routing the verdict to `revise`.

**Design principles.**

**Refuse for rewrite, never delegate.** A prose Scenarios unit has no delegate verifier: the AC checklist receives DONE items by id, never Scenarios units, and a holdout-marked unit is invisible to the builder. Delegating such a unit with only a warning would be the fail-open handling that FAFF-962 rejected. The only safe remedy is for the author to rewrite the unit.

**The classifier and the tiers are not touched.** `classifyCriterion`, `resolveVerificationTier`, `dodSplit` and the evaluator's prose rule stay exactly as they are. A prose Scenarios unit that does reach the holdout still fails closed to `needs-human`. That behaviour is the last backstop, and this change only moves the catch earlier.

**Advisory signal, judgement-owned gate.** As with every other advisory in `admissibleVerdict`, the new signal is warning-only and never changes the `admissible` boolean. Gating authority stays with the QA lens (`revise`) and with the producer's own pre-rating fix.

**One detection home.** The advisory reads `dodClassify`'s existing `class` and `holdout` fields. It adds no second parser and no new prose regex. When FAFF-1205 lands, the fix applies to this advisory automatically.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` | JavaScript (authored directly; no `.ts` sibling) | `dodClassify` (:284) supplies `class`/`holdout`/`id`. The FAFF-1364 pair `scenariosCodeSurfaceAdvisory`/`renderScenariosCodeSurfaceWarning` (:716–733) is the model to mirror. `admissibleVerdict` (:744, advisory pushes at :762–768) is extended. `admissibleSelftest` (:813) gets new cases. `module.exports` is at :1739. |
| `plugin/skills/faffter-noon-spec/SKILL.md` | Markdown (skill prompt) | Scenarios authoring guidance (:59–72) and _Self-review before returning_ (:82). `faffter-dark-nlspec` inherits that self-review verbatim (its :236). |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown (skill prompt) | SCENARIOS authoring guidance (§5, :126–153) |
| `plugin/skills/faffter-noon-spec-review/SKILL.md` | Markdown (skill prompt) | QA lens row (:36) |
| `plugin/skills/faffter-dark-spec-review/refute-qa.md` | Markdown (skill prompt) | Adversarial QA refuter attack list (:10–15) |
| `eval/review-bench/lenses/refute-qa.md` + `requests*/qa.json` | Markdown / JSON | Byte-identical lens copy and generated payloads, guarded by `test/review-bench-lens-parity.test.mjs` |
| `eval/cases/refutation-spec-*.json` | JSON (eval cases) | Existing `refutation-spec` kind with a `lens_bounds` oracle (latest case is `refutation-spec-016`) |
| `test/faff-1364-scenarios-code-surface.test.mjs` | JavaScript (node:test) | CLI-spawning test to mirror |

**Scope statement.** This change sits at the spec-readiness boundary: the producers' pre-rating self-check, the spec-review QA lens, and the advisory that `faff admissible --lights-out` shows at build admission. All of it runs before code exists.

## 2. OUT OF SCOPE

- **Fragmentation of a scenario's fenced example into prose pieces.** This is FAFF-1205's classifier bug (PR #1146, open). It is a false-prose problem, while this ticket deals with genuinely prose units. **Extension point:** none needed. The new advisory reads `dodClassify`, so it picks up FAFF-1205's fix when that merges.
- **Tightening the R1 scenario count (`parseScenarios`) so a `Given` block with no `Then` stops counting.** That would change the `admissible` boolean, which this advisory-only change never does. **Extension point:** in `parseScenarios` (`admissibility.js` :537), count a Given group only when it carries a `Then`. That needs its own ticket because it can turn admissible specs into refusals.
- **Retiering or delegating prose Scenarios units.** This is forbidden: there is no verifier to move them to (ADR-0140, FAFF-962). **Extension point:** none. It is a constraint, not a deferral.
- **Retro-fixing prose Scenarios units already in committed specs.** New specs are caught by this change, and older specs surface on their next prep or review. **Extension point:** a `/faff-tidy` spec-health sweep could flag them in bulk.
- **Prose units in the DONE checklist.** FAFF-1291 already delegates these to the AC checklist, and FAFF-304's `prose-DONE advisory:` surfaces them. Neither is changed.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Scenarios unit | One criterion that `dodClassify` forms from the `## Scenarios` section; it carries `source="scenarios"` and an id `scenarios:<n>` |
| Prose Scenarios unit | A Scenarios unit whose `class` is `prose`: no capitalised `Then`, no `must`, no comparator (for example a `Given`/`When` with no `Then`, or a bullet like "the dashboard feels responsive") |
| Holdout-marked unit | A Scenarios unit with `holdout: true`: it sits inside a ```` ```holdout ```` fence or is a `holdout:`-prefixed bullet, and is withheld from the builder view |
| Advisory | A warning-only line in the `admissibleVerdict` result's `warnings[]`; it never changes `admissible` |

**New pure functions (in `admissibility.js`, placed directly after the FAFF-1364 pair).**

```
FUNCTION scenariosProseAdvisory(specText) -> { count: Int, holdout: Int, items: Criterion[] } | null
  # Pure. The Scenarios units dodClassify puts in the prose class, in classify order, or null when there are none.
  # count = items.length; holdout = how many of items carry holdout: true.
  # Any dodClassify throw returns null (fail-open, the same as every sibling advisory).

FUNCTION renderScenariosProseWarning(adv) -> String
  # One line with the fixed prefix "scenarios-prose advisory:".
  # Names every unit as "<id>[ (holdout)] <text, whitespace-collapsed, first 50 chars>",
  # joined by " | ", using the same truncation as renderScenariosCodeSurfaceWarning.
```

Both functions are added to `module.exports`.

**Rendered line (exact shape).**

```
scenarios-prose advisory: <count> Scenarios unit(s) are prose (no Then, no MUST or comparator) and cannot be judged code-blind<HOLDOUT-CLAUSE>; restate each as a Given/When/Then with an observable Then: <item> | <item> ...
  where HOLDOUT-CLAUSE = "" when holdout == 0,
        else "; <holdout> of them are holdout-marked and withheld from the builder, so they check nothing"
  and   <item> = <id> + (" (holdout)" if the unit is holdout-marked) + " " + trunc(text)
```

**Authoring sentence (both producers).** One sentence is added to the Scenarios section of `faffter-noon-spec/SKILL.md` and of `faffter-dark-nlspec/SKILL.md`, next to the FAFF-1364 test-file sentence. It says: a Scenarios unit always needs an observable `Then`, or for a non-functional objective a `MUST` or comparator; a prose unit cannot be judged code-blind, and a holdout-marked prose unit checks nothing.

**Pre-rating self-check (one site, inherited by both producers).** In `faffter-noon-spec/SKILL.md` → _Self-review before returning_, before the reviewer pass, the producer pipes its draft through `faff admissible --lights-out --spec - --json`. It treats every warning starting with `scenarios-prose advisory:` or `scenarios-code-surface advisory:` as a `major` finding and rewrites the named units before it self-rates. `faffter-dark-nlspec` runs that section "in full, exactly as written there", so it needs no edit of its own.

**QA-lens guidance (both reviewers).** `faffter-noon-spec-review/SKILL.md`'s QA lens row and `faffter-dark-spec-review/refute-qa.md` each gain one line. It says: a `## Scenarios` unit with no observable `Then` (and no `MUST` or comparator) cannot be judged by the code-blind holdout, and a holdout-marked one is also hidden from the builder; raise it and name the unit, so the verdict routes to `revise`.

**Design decisions** are collected, each with a `**Chosen:**` marker, in section 6.

## 4. HOW — Behavior

**Architecture.** The change has three hook sites, and none of them changes classify, the tiers or the evaluator:

1. **The producer's pre-rating self-check.** This is the only site that can act "before the spec is rated", because the producer does the rating. It is deterministic because it reads the advisory command, not an LLM's opinion.
2. **The spec-review QA lens.** This is the pre-promotion gate with judgement authority. It runs after rating but before promotion, and it catches what the producer missed or a hand-edited spec introduced.
3. **The advisory in `faff admissible --lights-out`.** This is the build-admission backstop at beep-boop's build-queue filter and graft's admissibility gate. A human can see it in the run log, and it never refuses on its own.

Sites 1 and 3 share one function. Sites 2 and 3 are deliberately redundant, so a miss by the LLM lens is still caught deterministically.

**scenariosProseAdvisory — behaviour.**

```
PROCEDURE scenariosProseAdvisory(specText):
  1. classified := dodClassify(specText)            # any throw → return null
  2. items := classified.criteria WHERE c.source == "scenarios" AND c.class == "prose"
  3. IF items is empty: return null
  4. return { count: len(items), holdout: count of items WHERE c.holdout == true, items }
```

**admissibleVerdict wiring (inside the existing lights-out path, directly after the FAFF-1364 push).**

```
scenAdv  := scenariosCodeSurfaceAdvisory(specText)    # unchanged (FAFF-1364)
IF scenAdv:  warnings.push(renderScenariosCodeSurfaceWarning(scenAdv))
proseAdv := scenariosProseAdvisory(specText)          # NEW
IF proseAdv: warnings.push(renderScenariosProseWarning(proseAdv))
admissible := checks.every(c => c.pass)               # UNCHANGED: the advisory never flips it
```

**Producer self-check — behaviour.**

```
PROCEDURE pre_rating_scenarios_check(draft):
  1. result := pipe draft to `faff admissible --lights-out --spec - --json`; parse stdout as JSON
  2. FOR each line in result.warnings starting "scenarios-prose advisory:" or "scenarios-code-surface advisory:":
       record a `major` self-review finding that names the listed unit ids
  3. Rewrite each named unit: give it an observable Then (or a MUST/comparator for a non-functional objective);
     move a test-file check into its own DONE item (FAFF-1364's remedy)
  4. Re-run step 1 once; any of those warnings still present → leave the finding open (the existing ≥3-major rating cap applies)
  5. A failed command (no JSON on stdout) → note it in the returned review record and continue; never block the spec on it
```

**Edge cases.**

- **A well-formed Given/When/Then unit** has a `Then`, so it is class `scenario`. No advisory fires and the unit passes unchanged.
- **A non-functional assertion bullet** (for example "p99 MUST be < 200ms") is class `assertion`. No advisory fires.
- **A holdout bullet with no oracle** (`- holdout: the dashboard feels responsive`) is prose with `holdout: true`. It is named with `(holdout)` and counted in the holdout clause.
- **A blockquote or a whole-line italic placeholder** in Scenarios (for example `dodSplit`'s withheld-count note) is never formed into a unit, so it never draws the advisory.
- **A spec with no `## Scenarios` section.** No Scenarios units, so no advisory. R1 still refuses that spec as before.
- **Without `--lights-out`,** `admissibleVerdict` returns early, before any advisory runs. The producer self-check therefore always passes `--lights-out`.
- **A fenced example that FAFF-1205 has not yet fixed** can split into prose fragments, and each fragment draws the advisory. That is a false positive that only produces a warning, and it disappears when FAFF-1205 merges.

**Failure modes.**

- **The failure:** a producer skips the self-check and the LLM QA lens also misses the unit, so a prose holdout reaches build. **How you'd know:** a holdout record carries a `needs-human` criterion with the reason "prose scenario: no machine check and no delegate verifier", and the run log shows the `scenarios-prose advisory:` line at admission. **What it means:** proceed. The evaluator's fail-closed backstop still blocks an L4 merge, and the miss shows up in the run log. Repeated misses would justify the R1 tightening listed in section 2.
- **The failure:** before FAFF-1205 merges, the advisory fires on fragments of a fenced example, so producers and reviewers spend a revise round on a unit that was fine. **How you'd know:** the named unit is a fragment, such as a YAML line, not a whole Given/When/Then. **What it means:** narrow the impact by merging FAFF-1205. Do not add an exception here.

**Anti-pattern:** giving prose Scenarios units the `delegated` tier so they leave the holdout's judged set. Why: no verifier receives a Scenarios unit by id, and a withheld unit is invisible to the builder, so the check would silently disappear. This is the fail-open handling FAFF-962 rejected.

**Anti-pattern:** letting the advisory change `admissible`. Why: every advisory in `admissibleVerdict` is warning-only, and an open classifier bug (FAFF-1205) would turn its false positives into refused builds.

**Anti-pattern:** a second prose detector, such as a regex for "When without Then". Why: `classifyCriterion` is the single class rule shared by classify, admissible and the evaluator. A second rule would drift from it.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a lights-out spec whose Scenarios section holds one well-formed Given/When/Then block and one holdout-fenced block with a Given line and a When line but no Then line
When `faff admissible --lights-out --spec <it> --json` runs
Then warnings holds exactly one line beginning "scenarios-prose advisory: 1 Scenarios unit(s)" that names "scenarios:2 (holdout)", and the JSON reports "admissible": true with exit code 0
```

```
Given a lights-out spec whose only Scenarios units are well-formed Given/When/Then blocks, each with an observable Then
When `faff admissible --lights-out --spec <it> --json` runs
Then no line in warnings begins "scenarios-prose advisory:"
```

```
Given the same spec as the first scenario
When `faff admissible --spec <it> --json` runs without --lights-out
Then warnings is empty and no line begins "scenarios-prose advisory:"
```

## 6. DESIGN DECISION RATIONALE

**Refuse the unit, or delegate it with a warning?** (the ticket's first open question)
- *Delegate with a warning:* tier prose Scenarios units `delegated` and warn. Con: no verifier receives a Scenarios unit by id (ADR-0140), and a holdout-marked unit is withheld from the builder too. The check would vanish while the run reports green, which is the fail-open handling FAFF-962 rejected.
- *Refuse for rewrite:* name the unit at every catch site, and have the QA lens raise it so the verdict is `revise` (rewrite in place). If the loop cap is reached, the spec parks.
- **Chosen:** Refuse for rewrite. Delegation has no verifier to delegate to, so it would remove the check silently. Refusing for rewrite keeps the requirement and the check together.

**Should the deterministic signal gate admission, or stay advisory?**
- *Gating:* add an R-check to `faff admissible` that refuses a spec with a prose Scenarios unit. Pro: it is hard to ignore. Con: it breaks the module's rule that advisories are warning-only, and FAFF-1205 (still open) would make every spec with a fenced example and an internal blank line inadmissible.
- *Advisory:* a warning line; the gate is the QA lens plus the producer's pre-rating fix.
- **Chosen:** Advisory. It matches FAFF-304, FAFF-812, FAFF-1360 and FAFF-1364, and it cannot turn a known classifier false positive into refused builds. The gating authority belongs to the reviewer's judgement.

**How can the change act "before the spec is rated" when spec review runs after rating?**
- *Spec review only:* it runs after the producer self-rates, so it cannot meet the ticket's wording.
- *Prose authoring guidance only:* not deterministic. The FAFF-1279 unit was written under the existing guidance.
- *A deterministic self-check in the producer's self-review, plus authoring guidance, plus the QA lens as a pre-promotion backstop, plus the admission advisory.*
- **Chosen:** All four together, with the self-check in `faffter-noon-spec`'s _Self-review before returning_. It is the only site that runs before rating, and `faffter-dark-nlspec` inherits it, so one edit covers both shipped producers. Today `faff admissible` runs only at build admission, so without the self-check no deterministic Scenarios check would run before rating.

**Should the producer self-check also act on FAFF-1364's `scenarios-code-surface advisory:`?**
- *Prose prefix only:* narrowest. Con: it leaves the sibling Scenarios advisory with the same gap: computed, but never seen before rating.
- *Both Scenarios prefixes:* the same command and the same "the holdout cannot judge this unit" remedy, with no extra code.
- **Chosen:** Both prefixes. It is one instruction reading one command's output, and it gives FAFF-1364's advisory the pre-rating site that its own spec described but never wired.

**How should a flagged unit be named?**
- *Truncated text only (the FAFF-1364 style).* Con: two similar units are ambiguous, and nothing links the line to the holdout record.
- *The classify id, a `(holdout)` tag and the truncated text.*
- **Chosen:** The id, the tag and the text. The `scenarios:<n>` id is the same id the evaluator and `faff holdout record` use, and the tag marks the worse case, a unit that checks nothing.

**How does this relate to FAFF-1205?** (the ticket's second open question)
- *Fold into FAFF-1205:* one ticket. Con: they are different defects. FAFF-1205 is the classifier wrongly producing prose fragments; FAFF-1293 is authors genuinely writing prose units. FAFF-1205 is already in review.
- *Ship separately, with no blocker edge.*
- **Chosen:** Ship separately. Only the false-positive part overlaps, and the advisory picks up FAFF-1205's fix automatically because it reads `dodClassify`. A blocker edge isn't needed because a premature false positive only produces a warning. The tests avoid fenced examples with internal blank lines, so they pass in either merge order.

**How is the LLM-lens change covered by evals?**
- *A new eval kind:* needs a new grader arm and a seam-registry row. Con: unnecessary, because the seam already has a kind.
- *One case of the existing `refutation-spec` kind.*
- **Chosen:** One `refutation-spec` case (`eval/cases/refutation-spec-017.json`). Its spec is otherwise clean but has a holdout-marked prose Scenarios unit, and its oracle is `lens_bounds` with `must_object: ["QA"]`. No grader change is needed. Recording a baseline stays a separate, human-supervised step.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Both of the ticket's open questions are closed above with `**Chosen:**`.

**Assumptions.**

- **Assumes:** `plugin/skills/faff/bin/lib/admissibility.js` has no `.ts` sibling, so no `npm run build` emit step is needed. *Validation:* `ls plugin/skills/faff/bin/lib/admissibility.*` lists only the `.js` (checked 2026-10-27).
- **Assumes:** editing `faffter-dark-spec-review/refute-qa.md` requires refreshing the copy at `eval/review-bench/lenses/refute-qa.md` and regenerating the payloads with `node eval/review-bench/build-requests.mjs`, as FAFF-1364's commit did. *Validation:* `test/review-bench-lens-parity.test.mjs` fails until both are done.

## 8. DONE — Definition of Done

### From WHY / WHAT (deterministic advisory)
- [ ] `scenariosProseAdvisory(specText)` returns `{count, holdout, items}` listing every `source="scenarios"`, `class="prose"` criterion in classify order, and returns `null` when there are none or when `dodClassify` throws.
- [ ] `renderScenariosProseWarning(adv)` returns one line beginning `scenarios-prose advisory:`. It names each unit as its id, then ` (holdout)` for a holdout-marked unit, then the first 50 whitespace-collapsed characters of its text. It includes the holdout clause only when `holdout >= 1`.
- [ ] Under `--lights-out`, `faff admissible` MUST emit the `scenarios-prose advisory:` line directly after any `scenarios-code-surface advisory:` line, and its `admissible` value and exit code MUST equal those for the same spec with the prose unit removed.
- [ ] Without `--lights-out`, `faff admissible` MUST emit no `scenarios-prose advisory:` line.

### From WHAT (exports)
- [ ] `scenariosProseAdvisory` and `renderScenariosProseWarning` are added to `admissibility.js`'s `module.exports`.

### From HOW (producers)
- [ ] `faffter-noon-spec/SKILL.md` _Self-review before returning_ runs `faff admissible --lights-out --spec - --json` on the draft before the reviewer pass. It treats each `scenarios-prose advisory:` and `scenarios-code-surface advisory:` warning as a `major` finding to fix before self-rating, and it records a failed command in the review record without blocking.
- [ ] The Scenarios sections of `faffter-noon-spec/SKILL.md` and `faffter-dark-nlspec/SKILL.md` each gain the one-sentence rule that every Scenarios unit needs an observable `Then`, or a `MUST` or comparator for a non-functional objective.

### From HOW (QA lens)
- [ ] `faffter-noon-spec-review/SKILL.md`'s QA lens row and `faffter-dark-spec-review/refute-qa.md` each gain guidance to raise a Scenarios unit with no observable `Then` (and no `MUST` or comparator), naming the unit and noting that a holdout-marked one checks nothing, so the verdict routes to `revise`.
- [ ] `eval/review-bench/lenses/refute-qa.md` is byte-identical to the edited `refute-qa.md`, and `eval/review-bench/requests/qa.json` and `eval/review-bench/requests-shared-prefix/qa.json` are regenerated by `node eval/review-bench/build-requests.mjs`.

### From constraints (regression)
- [ ] `faff dod classify` MUST still report a prose Scenarios unit as `verification_tier: "running-stack"` and `verifier: "holdout"`, and `faff dod --selftest` and `faff admissible --selftest` MUST exit 0.
- [ ] `test/faff-1364-scenarios-code-surface.test.mjs` and `test/review-bench-lens-parity.test.mjs` MUST pass.

### From tests, evals and hygiene
- [ ] `admissibleSelftest` gains cases where a holdout-fenced `Given`/`When` block with no `Then` yields the advisory tagged `(holdout)`, a well-formed Given/When/Then unit yields no advisory, and an assertion bullet with `MUST` yields no advisory.
- [ ] A new `test/faff-1293-scenarios-prose-advisory.test.mjs` (mirroring the FAFF-1364 test) checks the four Scenarios above through `faff admissible`, using fixtures with no fenced example that contains an internal blank line.
- [ ] `eval/cases/refutation-spec-017.json` is a `refutation-spec` case with an otherwise-clean spec containing one holdout-marked prose Scenarios unit, and its oracle is `{"lens_bounds": {"must_object": ["QA"]}}`. The eval loader accepts it with no grader change.
- [ ] `faff validate-adapters` and `faff regions check` MUST exit 0 after the `SKILL.md`, lens and `admissibility.js` edits.

**Integration smoke test.**

```
1. Write a spec fixture: `## Scenarios` holding a well-formed Given/When/Then block,
   then a ```holdout fence holding "Given a withheld case" / "When the CLI runs" (no Then),
   then `## 8. DONE` with "- [ ] `faff x` MUST exit 0".
2. Run `faff admissible --lights-out --spec <fixture> --json`.
3. Assert: exit 0, "admissible": true, and exactly one warning starting
   "scenarios-prose advisory: 1 Scenarios unit(s)" that contains "scenarios:2 (holdout)".
4. Run `faff dod classify --spec <fixture> --json`.
5. Assert: scenarios:2 is class "prose", holdout true, verification_tier "running-stack" (classify unchanged).
```

## Already shipped against this surface

- **FAFF-1364** (Done, #1132), *"Spec review flags a Scenarios unit that names a test file."* This is the assertion-class twin: `scenariosCodeSurfaceAdvisory`, the producer sentences and the QA-lens lines. **Related, not superseding.** Its own spec lists prose Scenarios units as out of scope, with "FAFF-1293, when built, adds the prose-refusal path" as the extension point. This change mirrors its shape and reuses its pre-rating site.
- **FAFF-1291** (Done, #1091), *"The code-blind holdout judges only criteria a machine can check."* It delegated prose DONE items to the AC checklist and deliberately kept prose Scenarios units on the `running-stack` tier as `needs-human`. **Related, not superseding:** it creates the situation this ticket closes.
- **FAFF-1360** (Done), **FAFF-304** (Done) and **FAFF-812** (Done) added the sibling advisories (code-surface DONE, prose-DONE and oracle-less assertion) whose warning-only shape this change follows. None of them covers prose Scenarios units.
- **FAFF-275** (Done) added the holdout markers and `dod split`, which is why a holdout-marked prose unit is hidden from the builder.
- **FAFF-1205** (In Review, PR #1146) fixes fenced-example fragmentation. It is adjacent, not Done, and section 6 covers the interplay.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** No issues. This is one unit of about a day that copies FAFF-1364's shipped shape: one advisory pair, three prompt edits, one eval case and one test file. It is one concern, so it needs no split, and no sibling always ships with it.
- **Workstream fit? (principles 1 and 5)** The issue has no project and sits loose in Backlog. It belongs with the holdout-verifiability work (FAFF-1291, FAFF-1360, FAFF-1364 and FAFF-1205), all about keeping checks the code-blind holdout cannot judge out of its set. Recommendation: include it when the next `/faff-plot rehome` pass groups loose Backlog work. This does not block the build.
- **Dependencies surfaced? (principle 6)** No issues. FAFF-1291 is Done. FAFF-1205 is already linked as related, and the order between them is soft: if FAFF-1293 lands first, the only cost is warning-only false positives on fenced examples. No blocker link is needed.
- **Risk profile? (principle 7)** No issues. The change reuses an established advisory pattern and an existing eval kind, with no new integration or external dependency, so no de-risking spike is needed.

confidence: high
build-tier: complex
spec-review: approve
