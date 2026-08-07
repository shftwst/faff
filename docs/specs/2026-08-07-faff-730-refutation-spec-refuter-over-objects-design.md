# Spec — FAFF-730: refutation-spec refuter over-objects on clean and near-miss specs

> Spec: faffter-dark-nlspec · 2026-08-07 · interactive · confidence: medium. Full spec on Linear FAFF-730.

This is the build spec for FAFF-730, a bug filed against the `refutation-spec` eval kind. Audience: the build agent who will change the eval and (conditionally) the production refuter prose, plus the human reviewer who runs the eval-sweep gate before merge. It is written to be buildable from this document alone.

## 1. WHY — Problem and Principles

**The one idea to hold first: the number we are chasing is measured on a stand-in that does not match what production actually runs.** The `refutation-spec` eval feeds the judge model a *thin* rubric — the orchestration table at `faffter-dark-spec-review/SKILL.md:34-48` — plus the fixture spec and an output envelope. It never feeds the four `refute-<lens>.md` files that are the *real* system prompts production hands to each independent lens call. Those real files already carry the "raise nothing if the approach is sound" restraint the thin rubric is missing. So before we touch any prose, we have to reckon with the fact that the eval and production diverge, and that "make the eval number go up" and "fix a real defect" are not the same move here.

**Problem statement.** Across the FAFF-711 re-baseline fails the judge over-objects badly — roughly 170 spurious objections against 13 dropped-required, with QA and infosec the noisy lenses; near-miss cases 006 and 010 (whose correct answer is *approve*) draw 35/50 and 31/50 false objections, while case 007 shows the opposite failure by *dropping* its required infosec catch 10×. The status quo can't tell whether this is a real over-objecting refuter or an artefact of measuring a thinner, prose-starved stand-in. This change closes the eval's fidelity gap first, then uses the re-baseline to decide whether any production prose actually needs to change — and if it does, sharpens it in *both* directions rather than blanket-dialling objections down.

**Design principles:**

- **Do not tune a surface production never reads.** The anchored `SKILL.md:34-48` section and the harness-authored output envelope (`REFUTATION_SPEC_MODE_INSTRUCTION`) are eval-only inputs to the judge; the live per-lens calls consume neither. Adding restraint prose to either would move the eval number while changing nothing about real spec-review judgement — that is teaching to the test, and it is disqualified as the fix.
- **Precision runs both ways.** Case 007 proves genuine catches must survive. Any change is judged on reining in spurious QA/infosec objections *and* keeping required objections — never on a lower objection count alone.
- **Evidence decides the prose edit, not intuition.** Whether the real `refute-<lens>.md` files need strengthening is answered by what the faithful re-baseline and the production dogfood reveal, not asserted up front. A "no prose change needed" outcome is a valid, expected result of this ticket.
- **The oracle is settled.** FAFF-615 proved the oracles correct. No fixture or oracle is edited under this ticket.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `eval/cli-driver.mjs` | JS (ESM) | Builds the `refutation-spec` prompt: `loadRefutationSpecProse` (:975-978) → `criteriaFor` rubric → `renderFixturePrompt` (:855-859) → `modeInstructionFor` envelope (:610-617, :703) |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` | Markdown | `:34-48` anchored section the eval loads as its rubric; orchestration doc, **not** consumed by live per-lens calls |
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,qa,methodology}.md` | Markdown | The **real** per-lens restraint system prompts production uses (`review-call.mjs --system`, wired SKILL.md:53-74); the eval never loads them. No automated test coverage |
| `test/eval-cli-driver.test.mjs` | JS test | Anchor-registry uniqueness (`:724-776`) and `criteriaFor("refutation-spec")` heading assertion (`:391`) — both bite if the anchored section's boundary strings move |
| `eval/cases/refutation-spec-0NN.json` | JSON | Fixtures + oracles (`closed_set` / `lens_bounds`); proven correct by FAFF-615, **never edited** |

**Scope statement.** This sits at the eval-fidelity layer for the L4 spec-review seam — it makes the `refutation-spec` kind measure what production actually does, and only then acts on the result.

## 2. OUT OF SCOPE

- **Full per-lens independent passes in the eval.** Production runs each lens as its own isolated model call; the eval collapses all four into one prompt (`cli-driver.mjs:855-859`) — the anti-pattern the skill forbids (SKILL.md:47,132). Fixing the *content* gap (the restraint prose) is this ticket; restructuring the eval into four independent calls is a larger rework. **Why excluded:** it is a structural change to the eval harness, not a bug fix, and the content fix is the cheaper fidelity win that unblocks the decision. **Extension point:** a follow-up ticket against `eval/cli-driver.mjs` `renderFixturePrompt` / the `run-evals` driver to fan a `refutation-spec` case into per-lens sub-prompts. This residual collapse is named as a confound in Failure Modes, and the dogfood check exists precisely to see past it.
- **Editing `SKILL.md:34-48` to add restraint prose.** **Why excluded:** it moves the eval number without touching live judgement — teaching to the test. **Extension point:** none wanted; the section stays orchestration documentation.
- **Editing the output envelope `REFUTATION_SPEC_MODE_INSTRUCTION`.** **Why excluded:** eval-only surface; same teaching-to-the-test objection. **Extension point:** none.
- **Any oracle or fixture edit.** **Why excluded:** FAFF-615 settled correctness. **Extension point:** if the re-baseline suggests an oracle is wrong, that is a separate ticket that must re-open FAFF-615's argument, not a quiet edit here.
- **Changing `review-call.mjs` / `aggregate.mjs` / the production wiring.** **Why excluded:** the transport and aggregation are not implicated in over-objection. **Extension point:** n/a.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Thin rubric | The `SKILL.md:34-48` anchored section the eval currently loads as its only refuter guidance — a lens→capability table with no restraint or approve language |
| Restraint prose | The "raise nothing if the approach is sound" guidance living in each `refute-<lens>.md`, used by production, absent from the eval |
| Fidelity fix | Making the eval prompt carry the real restraint prose production uses, so the number measures production judgement rather than a starved stand-in |
| Teaching to the test | Improving an eval-only input (thin rubric / envelope) to move the number without changing what production actually does |
| Faithful re-baseline | The `refutation-spec` sweep run *after* the fidelity fix, whose number now reflects production prose |
| Dogfood check | Running the real four-independent-pass `faffter-dark-spec-review` against the concentrated case specs, as ground truth for whether production over-objects |

**Oracle shapes the acceptance targets read against (already in the fixtures, unchanged):**

```
refutation-spec-006 / -010 : oracle.closed_set = []          # correct answer: approve (no objections)
refutation-spec-003        : oracle.lens_bounds.must_object = ["methodology"]   # infosec is neither must nor may → spurious
                              oracle.lens_bounds.may_object  = ["architectural","QA"]
refutation-spec-007        : oracle.lens_bounds.must_object = ["infosec"]        # dropping infosec = the required-drop failure
                              oracle.lens_bounds.may_object  = ["architectural","QA"]
```

**The prompt-assembly surface being changed (existing shape, for orientation):**

```
INTERFACE refutation_spec_eval_prompt:
  rubric        = criteriaFor("refutation-spec")        # today = loadRefutationSpecProse() = SKILL.md:34-48
  fixture_body  = renderFixturePrompt(case)             # "Refute the following spec ..." + case.fixture.spec
  envelope      = modeInstructionFor("refutation-spec") # REFUTATION_SPEC_MODE_INSTRUCTION
  # assembled prompt = rubric + fixture_body + envelope
```

**Design decision — where the restraint prose enters.**

**Chosen:** add a new loader (`loadRefutationSpecLensProse`) that reads the four `refute-<lens>.md` files and concatenates their restraint bodies, and inject that block into the `refutation-spec` prompt **in addition to** the existing thin rubric — never by editing or moving the anchored `SKILL.md:34-48` section. The existing `loadRefutationSpecProse` and the `criteriaFor` heading stay byte-for-byte, so `test/eval-cli-driver.test.mjs:391` and the anchor-registry uniqueness test stay green. Injection point may be either inside `criteriaFor("refutation-spec")` (append after the heading section) or inside the `refutation-spec` arm of `renderFixturePrompt` — either is acceptable so long as both tests stay green and the four lens bodies reach the judge. See rationale in §6.

## 4. HOW — Behavior

**Approach in one line:** make the eval honest, re-measure, and let the honest number decide whether production prose changes — then, if it does, change it with both-directional precision.

**Behaviour summary.** The build first improves eval fidelity (feed the real restraint prose), then runs a decision procedure driven by the faithful re-baseline and a production dogfood. There are two possible endpoints: (i) the over-objection was a measurement artefact and no production prose changes, or (ii) production genuinely over-objects and the relevant `refute-<lens>.md` restraint bar is strengthened without losing genuine catches.

```
PROCEDURE build_faff_730:
  1. Fidelity fix (always):
     a. Add loadRefutationSpecLensProse(pluginDir) reading the four
        refute-{architectural,infosec,qa,methodology}.md bodies.
     b. Inject that block into the refutation-spec prompt alongside the
        existing thin rubric (do NOT touch SKILL.md:34-48 or the envelope).
     c. Run the driver tests — anchor-registry uniqueness + criteriaFor(:391)
        MUST stay green; add/extend a driver test asserting the refutation-spec
        prompt now contains each lens's restraint sentence.
  2. Faithful re-baseline:
     a. Re-run the refutation-spec sweep.
     b. Read the concentrated cases against their oracles.
  3. Dogfood (always, as ground truth past the residual collapse confound):
     a. Run the REAL faffter-dark-spec-review (four independent passes) over the
        006 / 010 / 003 / 007 fixture specs.
     b. Record each lens's objection set.
  4. Decide:
     IF faithful re-baseline meets the success targets (§ Scenarios)
        AND dogfood shows production does NOT over-object:
        → the over-objection was a fidelity artefact. NO production prose change.
          The fix is the honest eval. Stop.
     ELSE IF dogfood shows production DOES over-object on QA/infosec:
        → strengthen the restraint bar in the implicated refute-<lens>.md ONLY
          (raise the objection threshold / sharpen "raise nothing if sound"),
          re-run steps 2-3, and CONFIRM 007's required infosec catch survives.
     ELSE (targets unmet but production is clean → residual collapse confound):
        → do NOT edit production prose to chase it. Record the finding, and
          escalate the eval-independence rework (Out of Scope item) as a
          follow-up. This ticket's deliverable is then the fidelity fix alone.
  5. Gate: full eval sweep must pass before merge (acceptance gate below).
```

**Edge cases and error handling:**

- **A `refute-<lens>.md` body contains one of the anchor strings.** It does not today, but the injected loader must not reintroduce `## The lenses as independent refuters` or `## Backend call` into any file the anchor-registry test scans (it scans `SKILL.md`, not the refute files, so concatenating into the *prompt* is safe; the guard is: never write those strings into `SKILL.md`).
- **Lens body missing / unreadable at load time.** `loadRefutationSpecLensProse` follows the existing `extractSection`/loader error discipline in `cli-driver.mjs` — fail loud (throw), never silently emit an empty block that would quietly restore the thin-rubric behaviour.
- **`--no-plugin` baseline.** The control path returns `null` rubric today (`criteriaFor(k, null) === null`, test :394-396). The lens prose must ride the plugin path only — the baseline stays a bare improvise prompt, or the control is no longer a control.

**Failure modes — how this approach could be wrong, and how you'd notice:**

- **The failure:** the eval stays collapsed (one prompt, four lenses) even after the content fix, so the faithful re-baseline is *more* faithful but still not production. A number that moves might be the restraint prose working, or the collapse still distorting. **How you'd know:** the re-baseline and the dogfood disagree — eval still over-objects while the real four-pass dogfood is clean. **What it means:** do not fix production prose to chase the eval; the residual is the collapse, and the honest step is the independence rework (ticketed), not a prose edit.
- **The failure:** strengthening `refute-<lens>.md` restraint blunts real rigor and drops genuine catches. **How you'd know:** case 007 loses its required infosec objection (or 008/009 genuine-infosec catches regress) in the re-baseline. **What it means:** the restraint edit went too far — narrow it (per-lens bar, not blanket) and re-run.
- **The failure:** the whole premise is wrong and production was never over-objecting — the eval was simply starved. **How you'd know:** step-4 first branch fires (targets met, dogfood clean) with zero production prose change. **What it means:** proceed; this is a valid, expected outcome. The deliverable is the honest eval, and FAFF-730's "bug" was in the measurement.

**Anti-patterns:**

- **Anti-pattern:** adding restraint/approve language to `SKILL.md:34-48` or the output envelope to move the number. Why: production reads neither, so the eval improves while the product does not — the exact confusion this ticket exists to end.
- **Anti-pattern:** judging success on a lower total objection count. Why: it rewards dropping 007's required catch; precision is two-directional.
- **Anti-pattern:** editing an oracle or fixture to make a case pass. Why: FAFF-615 settled them; moving the target is not fixing the refuter.

## 5. Scenarios

```
Given the refutation-spec eval prompt after the fidelity fix
When the judge is run against near-miss cases 006 and 010 (oracle closed_set = [])
Then approve (empty objection set) dominates each case's runs, replacing the 35/50 and 31/50 false-objection rates
```

```
Given case 003 (oracle must_object = [methodology], may_object = [architectural, QA])
When the faithful re-baseline is read
Then the required methodology objection is present AND the spurious infosec objection is gone (infosec is outside must+may)
```

```
Given case 007 (oracle must_object = [infosec])
When the faithful re-baseline is read after any refute-<lens>.md restraint change
Then the required infosec objection is still raised — genuine catches survive the precision fix
```

- The injected prompt for a `refutation-spec` case MUST contain each of the four lenses' restraint sentence (e.g. infosec's "raise nothing … do not invent threats", QA's "do not invent missing tests for behaviour that is out of scope").
- `test/eval-cli-driver.test.mjs` anchor-registry uniqueness and `criteriaFor("refutation-spec")` heading assertion MUST remain green (the anchored section is untouched).
- The full eval sweep (all kinds) MUST pass, with 008/009 genuine-infosec catches not regressing, before merge.

## 6. Design Decision Rationale

**Which lever actually fixes FAFF-730 — the eval-only prose, the production prose, or the eval's fidelity?**

- *Edit `SKILL.md:34-48` (eval-only rubric).* Pro: moves the number cheaply. Con: production never reads it; it deepens the eval↔production divergence — teaching to the test. Rejected.
- *Edit the four `refute-<lens>.md` up front.* Pro: it is the real production surface. Con: they already carry restraint, so a blind edit is guesswork that could blunt 007's catch, and — critically — it has zero effect on the eval number, so we could not even tell if it helped. Rejected as the *first* move; retained as a *conditional* move gated on evidence.
- *Fix eval fidelity first (feed the real restraint prose), re-baseline, then decide.* Pro: the number starts measuring production; the "is production actually broken?" question becomes answerable instead of assumed; the eventual prose edit (if any) is evidence-led and both-directional. Con: does not fix the collapsed-passes structure (named, scoped out, covered by the dogfood control). **Chosen:** fidelity-first, evidence-gated — the honest read on this being a bug in the measurement as much as (or instead of) the refuter.

**Where to inject the restraint prose.**

- *Substitute it for the thin rubric.* Con: risks the `criteriaFor(:391)` heading assertion and the anchor boundary. Rejected.
- *Append via a new loader, alongside the untouched anchored section.* Pro: heading + anchors stay byte-for-byte; tests stay green; the judge now sees production's real guidance. **Chosen:** new `loadRefutationSpecLensProse`, injected alongside the existing rubric.

**Whether to also make the eval run four independent passes now.**

- **Punt:** eval per-lens independence (decorrelating the collapse) or accept the content-only fidelity fix for this ticket — needs human (decides: architecture). The content fix is the cheaper win that unblocks the decision; independence is a separate rework, and the dogfood control tells us whether the residual collapse is actually distorting results before we commit to it.

**Whether production prose (`refute-<lens>.md`) changes at all.**

- **Punt:** the final production-prose edit is evidence-gated on the faithful re-baseline + dogfood (decides: qa) — a "no change" outcome is valid and expected, so this cannot be pre-decided in the spec without prejudging the measurement.

## 7. Open Questions and Assumptions

**Open Questions:**

- *Eval independence (the collapse).* The eval feeds four lenses in one prompt; production runs four isolated calls. Fix the content gap only (this ticket) or also restructure into independent passes? Needs human — architecture. Context: the collapse may itself inflate objections (one context piling on); the dogfood control reveals whether it materially distorts the number before the larger rework is committed.
- *Does any `refute-<lens>.md` change?* Gated on the faithful re-baseline and dogfood. If production is clean, the answer is "no change" and the deliverable is the honest eval. If production over-objects, strengthen the implicated lens's restraint bar only, preserving 007. Needs human sign-off at the eval-sweep gate — qa.

**Assumptions:**

- **Assumes:** the real `faffter-dark-spec-review` production path can be run over the fixture specs for the dogfood (a configured adversarial backend, per the skill's `faff adversarial-backends` wiring). Validate before starting: confirm `faff adversarial-backends` exits 0 with a usable backend; if unavailable, the dogfood branch of the decision procedure cannot run and the ticket must park for backend config rather than proceed on the eval number alone.
- **Assumes:** the four `refute-<lens>.md` files each contain a restraint clause of the form verified in infosec/QA (`refute-infosec.md:18-19`, `refute-qa.md:18-19`). Validate: grep each file for its "raise nothing"/"do not invent" clause before wiring the loader; if a lens lacks one, that gap is itself a finding to record.

## 8. DONE — Definition of Done

### From WHY
- [ ] The eval no longer measures a prose-starved stand-in: the `refutation-spec` prompt carries the real per-lens restraint prose production uses.
- [ ] No eval-only surface (`SKILL.md:34-48`, `REFUTATION_SPEC_MODE_INSTRUCTION`) was edited to move the number.

### From WHAT (interfaces)
- [ ] `loadRefutationSpecLensProse` exists in `eval/cli-driver.mjs`, reads all four `refute-<lens>.md` bodies, and fails loud on a missing/unreadable file.
- [ ] `loadRefutationSpecProse` and `criteriaFor("refutation-spec")`'s leading heading are unchanged; `test/eval-cli-driver.test.mjs:391` and the anchor-registry uniqueness test pass.

### From HOW (behaviour)
- [ ] A driver test asserts the assembled `refutation-spec` prompt contains each of the four lenses' restraint sentence.
- [ ] The faithful re-baseline was run and its concentrated-case numbers recorded.
- [ ] The production dogfood (real four independent passes) was run over 006/010/003/007 and its per-lens objection sets recorded.
- [ ] The decision procedure was executed and its branch recorded: either "no production prose change (artefact)" or "restraint bar strengthened in refute-<lens>.md" with the specific file(s) named.

### From HOW (edge cases)
- [ ] The `--no-plugin` control still returns a null rubric (lens prose rides the plugin path only).
- [ ] No `refute-<lens>.md` edit reintroduced an anchor boundary string into `SKILL.md`.

### From Scenarios (acceptance signal)
- [ ] Cases 006 and 010 → approve dominates (was 35/50 and 31/50 false objections).
- [ ] Case 003 → methodology objection present, spurious infosec gone.
- [ ] Case 007 → required infosec objection still raised; 008/009 genuine-infosec catches not regressed.
- [ ] **Acceptance gate:** the full eval sweep passes before merge (this is a prose-driven autonomous-posture change; per repo policy it goes behind the sweep, and no oracle was edited).

### Eval coverage
- [ ] The `refutation-spec` seam already exists (kind registered, fixtures present); this ticket changes its prompt fidelity, so the DONE item is the faithful re-baseline being run and the concentrated-case deltas recorded. Accepting/recording the new baseline value is the separate human-supervised gate step, not required by this item.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Run the driver unit tests → anchor-registry + criteriaFor(:391) green,
     new "prompt contains lens restraint" test green.
  2. Assemble one refutation-spec prompt (e.g. case 006) and confirm all four
     lenses' restraint sentences appear in it.
  3. Run refutation-spec sweep on 006 → approve dominates.
  # If those three hold, the fidelity wiring is connected.
```

confidence: medium

## Methodology critique

**Right-sized?** — Split candidate, one clean extraction. The committed deliverable (the fidelity fix: a `loadRefutationSpecLensProse` loader that injects the real restraint prose, then re-baseline and dogfood) is a single, fully-specified 1–3 day unit. Punt 2 (does any production `refute-<lens>.md` prose change?) is the tail of the *same* causal loop and stays. Punt 1 (rework the eval into four independent lens passes) is different in kind — architectural, structurally independent, and the spec itself flags it as a possible separate rework. Extract punt 1 into its own follow-up ticket (`blockedBy` FAFF-730), whether or not you action it, so the eval-independence question is tracked rather than buried.

**Workstream fit?** — Internally cohesive; container alignment not assessable from the input. One outcome — make the `refutation-spec` eval honestly measure its refuter — no riders bundled. Confirm FAFF-730 lives in the eval-harness / spec-review-quality outcome it belongs to, not a catch-all bucket.

**Deps surfaced?** — Chain gap: the spec references downstream work (the eval-independence rework, and any production prose change) that isn't ticketed. Both are downstream (`blockedBy` FAFF-730), so FAFF-730 isn't stuck — but the eval-independence rework especially should be filed and linked so the follow-on is honest and evidence-driven. File/code references are artifact pointers, not ticket deps.

**Risk profile?** — No issues; the de-risking is already sequenced first. The headline risk (blunting real spec-review rigor) is fenced: 007's infosec catch must survive, no oracle edits, behind the full eval sweep. The evidence step (re-baseline + dogfood) *is* the de-risking spike, sequenced ahead of any committed prose change. One sharpening: have the dogfood explicitly test whether the one-prompt collapse itself contributes to over-objection, so the architecture punt resolves on evidence too.

Methodology: faffter-dark-methodology-agile-delivery

---

## Spec revision — 2026-08-07 — spec-review revise applied

Amends the spec above (spec-review returned revise; 2 minor + 1 architectural observation, all folded in):

- **(architectural — inject the restraint *clause*, not the whole adversarial bodies).** `loadRefutationSpecLensProse` injects each lens's **restraint clause** (the "if the approach is sound, raise nothing — do not invent …" sentence + its evidentiary bar), NOT the whole adversarial "you are an X refuter, break this" body — concatenating four adversarial bodies would manufacture a stacked four-persona prompt in neither production nor the eval-before. The restraint prose is the fidelity gap; the adversarial framing is already carried by the existing rubric + envelope. (Amends §3 Chosen.)
- **(methodology).** The downstream eval-independence rework is filed + linked blockedBy FAFF-730 (done: FAFF-731), not merely escalated. (Adds to §8 DONE.)
- **(QA-a).** The dogfood mirrors the eval's sampling — each of 006/010/003/007 at BASE_REPS=20 escalating to MAX_REPS=50, not a single pass. (Amends §4 step 3 + §8.)
- **(QA-b).** Numeric pass line for the near-misses: ≥45/50 runs return approve (empty objections) for each of 006 and 010; 003 → methodology present + zero spurious infosec across the run majority; 007 → infosec present in ≥45/50. (Amends §5 + §8.)

spec-review: revise-applied · confidence: medium (retained)