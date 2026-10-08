# FAFF-1223: A refuter finding without a severity fails the lens instead of being silently dropped

> Spec: faffter-dark-nlspec · 2026-10-08 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1223.

This spec is for the build agent implementing FAFF-1223 and for the humans reviewing it. `parseRefutation` skips every `### ` section whose heading has no recognised severity, so that leaked reasoning headings (`### Analysis`) do not void a lens (FAFF-1056). The skip also swallows a real finding whose model forgot the severity prefix, provided some other section in the same body carries one. This ticket makes such a finding fail the lens closed, while reasoning headings stay tolerated.

## 1. WHY

**The idea the rest turns on.** A severity-less section is either prose or a finding, and the triple bullets are what tell them apart. A section whose body carries a `- claim:`, `- evidence:`, `- predicted_consequence:` or `- spec_anchor:` bullet is a finding the model meant to raise. The parser cannot read a severity it was not given (FAFF-1222 ruled out guessing one), so it faults the whole lens, exactly as it already does for a gating finding with no claim. A severity-less section with no triple bullet is still skipped as prose.

**Problem.** The transport's shape gate (`validateFindingsShape`) admits a body with at least one severity-bearing section, and the parser then drops every severity-less section unread. If the only recognised section is an `observation` (or the canonical `### observation: no findings` token), a real objection vanishes and the lens reads as `clear`. GLM 5.3 dropped the severity prefix on real findings in the FAFF-1222 evals, so this path is live for non-Claude refuters.

A second path drops the same finding before the parser runs. `normaliseCleanRefutation` in `review-call.mjs` rewrites a whole body to `### observation: no findings` when it ends in a clean affirmation (`No infosec objection.`), and its guards look only for severity-worded and `## Refutation —` headings. A severity-less finding followed by a clean sign-off is therefore normalised to clean, and the parser never sees it. This ticket closes both paths.

### Design principles

**Never fail open on a finding.** A section shaped like a finding is never discarded without a trace. It either becomes an objection or faults the lens.

**Leaked reasoning stays harmless.** A severity-less section with no triple bullet parses exactly as today, so the FAFF-1056 incident class cannot reopen.

**Reuse the existing fault routes.** The new parser fault uses the existing `{ ok: false, fault }` shape and the CLI's exit 1 `model-transient` record. A body the normaliser now declines simply reaches the existing shape gate unchanged. No contract, aggregate or caller changes.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` `splitSections` (:54), `BULLET_RE` (:47), `parseBullets` (:77), recognised filter and zero-recognised guard (:142-155), clean fast path (:160-165), CLI (:204-266) | JavaScript | The one code change: a new guard between the zero-recognised guard and the clean fast path |
| `test/spec-refute-parse.test.mjs` (FAFF-1056 block :274-380, CLI block :382 on) | JavaScript (`node:test`) | Existing fixtures that must stay green; new cases join this file |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `normaliseCleanRefutation` (:774), its guard regexes (:735-737) | JavaScript | The second code change: the normaliser declines a body carrying a triple bullet outside the affirmation line |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `validateFindingsShape` (:673), `splitFindings` (:607) | JavaScript | Unchanged. Admits mixed bodies and passes severity-less sections through intact; rejects an all-severity-less body as exit 10 |
| `test/adversarial-call.test.mjs` (`normaliseCleanRefutation` cases) | JavaScript (`node:test`) | Existing normaliser fixtures that must stay green; the new normaliser cases join this file |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` (the spec-refuter closed-grammar paragraph) | Markdown | Lists what still rejects after the affirmation; gains the triple-bullet rule |
| `plugin/skills/faffter-dark-spec-review/aggregate.mjs` (:36-42) | JavaScript | Unchanged. Routes a `model-transient` unavailable lens to the swing branch, never `needs-human` |
| `plugin/skills/faffter-dark-spec-review/SKILL.md` "Parsing an exit-0 lens" | Markdown | The exit 1 bullet lists the residual faults; gains the new one |
| `eval/cli-driver.mjs` `fanRefutationSpec` (:1220-1232) | JavaScript | Unchanged. A parse fault errors the rep and carries `fault.reason` into `rawOutput` |
| `plugin/skills/faffter-dark-spec-review/refute-*.md` | Markdown | Unchanged. The FAFF-1222 severity sentence stays as written |

**Scope.** One guard in `parseRefutation`, one guard in `normaliseCleanRefutation`, a named export of `BULLET_RE` from `parse-refutation.mjs` for the parity test, their tests and four comment or prose updates.

## 2. OUT OF SCOPE

- **The `normaliseCleanRefutation` preamble guard missing wrong-lens and indented headings.** Why: filed separately as FAFF-1238; it is about headings, while this ticket adds only the triple-bullet rule to the same function. Extension point: the heading guards in `normaliseCleanRefutation` in `review-call.mjs`.
- **Ordering against FAFF-1236.** Why: FAFF-1236's description was annotated on 2026-10-08 so that errored reps citing the new reason are counted apart from brief-sentence drift; no blocker link is needed either way. Extension point: none.
- **Inferring a severity from heading wording or bullet content.** Why: it un-gates or gates on a guess (FAFF-1222). Extension point: none intended.
- **A severity-worded off-grammar heading with a prose body** (`### Critical Issue Found` followed by plain text). Why: with no triple bullet it is indistinguishable from reasoning prose, so it stays skipped; reading it needs fuzzy severity parsing. Extension point: `SEVERITY_HEADING_RE` in both `parse-refutation.mjs` and `review-call.mjs`.
- **Widening the bullet grammar** (indented `  - claim:` or `* claim:` bullets). Why: detection deliberately matches what `parseBullets` would read; a wider grammar is its own change to what parses. Extension point: `BULLET_RE` in `parse-refutation.mjs`.
- **Rewording the FAFF-1222 brief sentence.** Why: it stays accurate (decision below) and any brief change adds refuter drift that FAFF-1236 is still measuring. Extension point: the sentence after the `- spec_anchor:` bullet in each `refute-*.md`.
- **A per-entry named-fault field in `RefutationEntry` or `spec-review-verdict`.** Why: rejected in favour of a whole-lens fault (decision below). Extension point: `RefutationEntry` in `parse-refutation.mjs` and `aggregate.mjs`.
- **Changing the shape gate.** Why: `validateFindingsShape` decides availability (exit 10) and should not learn finding semantics. Extension point: `validateFindingsShape` in `review-call.mjs`.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Recognised section | A `### ` section whose heading matches `SEVERITY_HEADING_RE` (severity is not null) |
| Severity-less section | A `### ` section whose heading does not match `SEVERITY_HEADING_RE` |
| Finding-shaped | A severity-less section for which `parseBullets(body)` returns at least one key (`claim`, `evidence`, `predicted_consequence` or `spec_anchor`), even with an empty value |

Detection calls `parseBullets` itself, so a section counts as finding-shaped exactly when its bullets would have been read had its heading carried a severity. `BULLET_RE` requires the `-` at column 0 and accepts emphasis around the key (`- **claim:**`).

### The new fault

Same `ParseFault` shape as the existing faults:

```
RECORD ParseFault (new instance):
  lens: string                 # as passed in
  severity: "unknown"          # same as the zero-recognised fault
  title: string                # the first finding-shaped section's heading text, `###` and spaces stripped (splitSections' title)
  missing_field: null
  reason: "finding section without a recognised severity (### <severity>: ...)"
```

The reason must not contain `no recognised finding section` or `names no known severity`, so logs, stderr and existing regex assertions keep the faults apart.

The CLI is unchanged in code: this fault exits 1 with `{lens, outcome:"unavailable", kind:"model-transient", objections:[]}` on stdout, or exits 3 with `kind:"infra-configured"` under `--truncated`. `faultMessage` already prints `title` and `reason` on stderr.

## 4. HOW

### Guard order in `parseRefutation`

```
PROCEDURE parseRefutation(content, lens):
  1. sections = splitSections(content); model = headerModel(content)        # unchanged
  2. recognised = sections where severity != null                            # unchanged
  3. IF recognised is empty: RETURN the existing "no recognised finding section" fault   # unchanged, keeps priority
  4. NEW: s = first section in document order where severity == null AND parseBullets(s.body) has >= 1 key
     IF s exists: RETURN { ok: false, fault: { lens, severity: "unknown", title: s.title,
                                               missing_field: null, reason: UNRECOGNISED_FINDING_REASON } }
  5. Clean fast path                                                          # unchanged, now after step 4
  6. Objection loop, claim fault, outcome                                     # unchanged
```

Why this order:

- Step 3 first keeps every all-severity-less body on its current reason, including the FAFF-1222 fixture (:312). In production the shape gate rejects those bodies as exit 10 before the parser runs, so only the eval sees them.
- Step 4 before step 5 closes the worst case: `### observation: no findings` beside a severity-less finding currently returns `clear`.
- Step 4 before step 6 means a mixed body faults on the severity-less finding even when a gating section also lacks a claim. Either fault voids the lens, so the order between them only changes the stderr reason.

**Anti-pattern:** keying detection on the heading text (length, severity words, "Issue"). Why: headings are where reasoning leaks; the bullets are the format contract the briefs define.

**Anti-pattern:** treating a finding-shaped section as an objection with an assumed severity. Why: FAFF-1222 ruled out inventing a severity.

### Triple-bullet guard in `normaliseCleanRefutation`

The normaliser runs before the shape gate and the parser, so it needs the same rule. Add one guard, checked after the affirmation is found and before any form is chosen:

```
PROCEDURE normaliseCleanRefutation(content):          # only the new step is shown
  ... find the affirmation line (unchanged)
  ... same-line remainder and trailing heading guards (unchanged)
  NEW: IF the same-line remainder matches FINDING_BULLET_RE
       OR any line other than the affirmation line matches FINDING_BULLET_RE:
         RETURN { content, normalised: false, lens: null, form: null }
  ... form selection, preamble severity guard, return (unchanged)
```

- `FINDING_BULLET_RE` is a local copy of `parse-refutation.mjs`'s `BULLET_RE` (the `-` at column 0, the four keys `claim`, `evidence`, `predicted_consequence`, `spec_anchor`, optional emphasis around the key). It is a copy, not an import, because `review-call.mjs` lives in another skill and imports nothing from `faffter-dark-spec-review`. A parity test pins the two regexes to accept and reject the same lines.
- The check covers lines before and after the affirmation, and the trimmed same-line remainder (`No QA objection. - claim: …`), mirroring how the existing remainder guards already read it. A clean sign-off sitting beside a triple bullet is a contradiction, so declining is always right.
- No clean form uses a triple bullet: the headings, the methodology signal line and the affirmation sentences are all plain text, so every body that normalises today and carries no triple bullet still normalises.

What happens to a declined body is existing behaviour:

- With a recognised `### <severity>:` section elsewhere, the shape gate admits it and the new parser guard faults the lens.
- With no recognised section, the shape gate rejects it as exit 10 `MALFORMED`. The chain advances, and an exhausted chain surfaces as an outage, never as clean.

### Through the system

| Path | Before | After |
|---|---|---|
| Production lens, mixed body | exit 0, severity-less finding dropped, lens may read `clear` | exit 1, `model-transient` unavailable; `aggregate.mjs` reports `unavailable` with a major objection naming the lens, or `reject-approach` if other lenses already force it; prep retries in-turn or holds |
| Eval rep, mixed body | graded, finding missing from the envelope | errored rep; `rawOutput` begins `[lens=<lens> unparseable: finding section without a recognised severity …]` |
| Production lens, severity-less finding then a clean affirmation | normalised to `### observation: no findings`, lens reads `clear` | not normalised; exit 10 `MALFORMED` from the shape gate, chain advances |
| Eval rep, severity-less finding then a clean affirmation | normalised, graded as clean | not normalised; the parser faults (no recognised section), errored rep |
| Any body with no finding-shaped severity-less section and no triple bullet beside an affirmation | as today | identical result |

The cost is that recognised objections from the faulted lens are lost for that round. A retry usually brings them back, though model output varies and a retry can come back differently; the same trade-off already applies to a gating finding with no claim. The lens never reads as clear in the meantime.

### Comment and prose updates

1. `parse-refutation.mjs`: the FAFF-1056 comment above the recognised filter says the parser skips every severity-less section and is "strictly MORE permissive than the shape-gate". Restate it: severity-less sections with no triple bullet are skipped as prose; a finding-shaped one faults the lens (FAFF-1223). Add the new reason to the `ParseFault` doc comment (:127) and to the exit 1 description in the CLI comment (:207-208).
2. `SKILL.md`, "Parsing an exit-0 lens", exit 1 bullet: extend "(a gating section with no usable `claim`, or a body with no recognised-severity section, …)" with "or a finding-shaped section without a severity". `faff validate-adapters` must still pass.
3. `test/spec-refute-parse.test.mjs` comment above the documented residual (:350-353): say the finding-shaped variant is now closed by FAFF-1223 and only the prose-bodied variant remains out of scope.
4. `review-call.mjs` header comment for `normaliseCleanRefutation`, and the spec-refuter closed-grammar paragraph in `faffter-dark-adversarial-review/SKILL.md`: add that a triple bullet anywhere outside the affirmation line also rejects. `faff validate-adapters` must still pass.

### Edge cases

- Several finding-shaped sections: the first in document order is named.
- A finding-shaped section with only `- spec_anchor:` or only empty bullet values: faults (any key counts).
- A severity-less section whose body only mentions `claim:` mid-line, or uses an indented or `*` bullet: not finding-shaped, skipped as today (bullet-grammar widening is out of scope).
- `#### ` sub-headings inside a recognised section are not section boundaries (unchanged), so a nested `#### Details` with bullets belongs to its parent and is not checked.
- The `[auto-refuted]` rewrite produces `### observation: [auto-refuted] …`, a recognised section, so it is unaffected.

### Failure modes

- **Recap sections trip the guard.** A model adds a severity-less `### Summary` that repeats `- claim:` bullets for findings it already headed correctly. How you'd know: retained `round-<n>-<lens>.md` transcripts and eval `rawOutput` carry the new reason on bodies whose findings all have severities elsewhere, particularly from Claude refuters. What it means: proceed if rare (a retry costs one lens call); if frequent, narrow detection to a non-empty `- claim:` bullet in a follow-up.
- **The retry keeps failing.** A model that drops the severity once may keep doing it, so the lens sits in `unavailable` across retries and holds. How you'd know: the same lens and backend fault with the new reason on consecutive attempts. What it means: proceed; a held lens is the honest outcome, and the FAFF-1222 brief sentence is the lever for the model's format, not the parser.
- **Eval error rate rises for non-Claude models.** How you'd know: more errored `refutation-spec` reps citing the new reason. What it means: proceed; those reps were previously graded with a finding silently missing, so the error is the accurate signal.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refuter body with "### observation: no findings" and a severity-less "### Logging raw bearer token" section carrying "- claim: the token is logged"
When parseRefutation runs for lens "infosec"
Then it returns ok false with title "Logging raw bearer token", missing_field null and the "finding section without a recognised severity" reason, instead of outcome "clear"
```

```
Given a body with a severity-less "### Appetite semantics undefined" section carrying "- **claim:** the mapping is asserted" and a well-formed "### major:" section
When the CLI runs with --lens architectural
Then it exits 1, stdout is {"lens":"architectural","outcome":"unavailable","kind":"model-transient","objections":[]}, and stderr contains the new reason and the section title
```

```
Given a leaked "### Analysis" heading with plain prose and no bullets, followed by a well-formed "### major:" section
When parseRefutation runs
Then it returns ok true with the one major objection, exactly as before this ticket
```

- Every body in which no severity-less section is finding-shaped parses to a deep-equal result before and after the change.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| How finding-shaped is detected | A non-empty `- claim:` only; any of the four triple or anchor keys via `parseBullets`; any `- ` bullet; heading wording | **Chosen:** any of the four keys via `parseBullets`, so detection matches exactly what would have parsed |
| Whole-lens fault or keep recognised findings plus a named fault | Whole-lens fault; keep recognised objections and add a named-fault field | **Chosen:** whole-lens fault through the existing exit 1 `model-transient` route |
| Fault shape and reason | Reuse the zero-recognised reason; a new reason with the section's title | **Chosen:** a new reason, `finding section without a recognised severity (### <severity>: ...)`, with `title` naming the first offending section |
| Guard order | New check before the zero-recognised guard; after it and before the clean fast path; after the objection loop | **Chosen:** after the zero-recognised guard, before the clean fast path |
| The documented `### Critical Issue Found` residual | Leave it all out of scope; fault it when finding-shaped; read severity words in headings | **Chosen:** the finding-shaped variant now faults; the prose-bodied variant stays skipped and documented |
| The FAFF-1222 brief sentence | Reword its second clause; leave it unchanged | **Chosen:** unchanged |
| The normaliser path | Leave it to FAFF-1238; document it as a residual; add a triple-bullet guard here | **Chosen:** a triple-bullet guard in `normaliseCleanRefutation`, as a local regex copy with a parity test |

**Normaliser path.** Without it, the parser guard is unreachable in production for any refuter that signs off with a clean sentence, so the ticket's own failure would survive. FAFF-1238 is about headings (wrong-lens and indented), a different rule; the bullet rule is the same signal this ticket already uses in the parser, so it belongs here. Importing `BULLET_RE` across skills would add the first cross-skill import into `review-call.mjs`; a copy plus a parity test keeps the two in step without that coupling.

**Detection.** A `claim`-only rule would let a section with `- evidence:` and `- predicted_consequence:` but no claim slip through, while the same section under a gating heading already faults (FAFF-990). Using all four keys keeps the two rules consistent. Reasoning headings in every observed leak and every FAFF-1056 fixture carry no triple bullet, so the wider rule costs no tolerated case.

**Whole-lens fault.** It reuses the precedent of a gating section with no claim (test "two gating objections, one with no claim: the whole lens fails loud"), needs no contract, aggregate or occupant change, and never reads as clear: `aggregate.mjs` turns the unavailable lens into an `unavailable` verdict with a major objection, and prep retries. Keeping the recognised findings plus a named fault needs a new field on `RefutationEntry`, aggregate handling and a `spec-review-verdict` change, and it still has to decide whether the named fault gates. If it does not gate, the silent clear comes back; if it does, the parser has assigned it a severity.

**Guard order.** Keeping the zero-recognised guard first leaves every existing fault reason, and the FAFF-1222 fixture, untouched. Running the new check before the clean fast path is what stops a canonical clean token from masking a finding.

**Brief sentence.** "A heading without one is not read as an objection" stays true: such a section never becomes an objection, it voids the lens. Rewording would mean regenerating the review-bench lens copies and payloads, re-measuring brief sizes, and adding refuter drift while FAFF-1236 is still measuring the first sentence's effect.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The ticket's open question (whole-lens fault or named fault) is decided above.

**Assumptions:** none beyond the cited code.

## 8. DONE

### From WHY
- [ ] A body with `### observation: no findings` plus a finding-shaped severity-less section returns `ok: false`, not `outcome: "clear"`
- [ ] Every existing test in `test/spec-refute-parse.test.mjs` passes without changing its assertions, including the FAFF-1056 block, the one-directional grammar table and the FAFF-1222 lone severity-less fixture (still the "no recognised finding section" reason)

### From WHAT
- [ ] The new fault is `{ lens, severity: "unknown", title: <first finding-shaped section's title>, missing_field: null, reason: "finding section without a recognised severity (### <severity>: ...)" }`
- [ ] The new reason matches neither `/no recognised finding section/` nor `/names no known severity/`

### From HOW (`test/spec-refute-parse.test.mjs`)
- [ ] A severity-less section with `- claim:` beside a well-formed `### major:` faults with the new reason and that section's title
- [ ] A severity-less section with only `- evidence:` (no claim) beside a well-formed gating section faults with the new reason
- [ ] A severity-less section with `- **claim:**` (emphasised key) faults with the new reason
- [ ] A severity-less section with an indented `  - claim:` bullet and no column-0 triple bullet beside a well-formed gating section parses `ok: true` (pins the out-of-scope bullet-grammar residual)
- [ ] With two finding-shaped severity-less sections, `title` names the first
- [ ] A finding-shaped severity-less section beside a gating section with no claim faults with the new reason (step 4 runs before the objection loop)
- [ ] `### Critical Issue Found` with a `- claim:` body beside a well-formed `### major:` faults with the new reason; the existing prose-bodied residual test still passes and its comment names FAFF-1223 as closing the finding-shaped variant
- [ ] CLI: the mixed body exits 1 with stdout `{"lens":…,"outcome":"unavailable","kind":"model-transient","objections":[]}` and stderr containing `reason=finding section without a recognised severity`; with `--truncated` it exits 3 with `kind:"infra-configured"`

### From HOW (normaliser, `test/adversarial-call.test.mjs`)
- [ ] `### Logging raw bearer token` / `- claim: the token is logged` / `No infosec objection.` returns `{ content, normalised: false, lens: null, form: null }` with `content` unchanged
- [ ] The same body under `## Refutation — infosec` (headed form) is also declined, as is a triple bullet placed after the affirmation line
- [ ] `No QA objection. - claim: the token is logged` on a single line is declined (bullet in the same-line remainder)
- [ ] `- **evidence:** x` (emphasised key) before a bare affirmation is declined
- [ ] Every existing `normaliseCleanRefutation` test passes without changing its assertions, including the FAFF-746, FAFF-1154 and FAFF-1222 cases
- [ ] A parity test: `FINDING_BULLET_RE` (exported from `review-call.mjs`) and `BULLET_RE` (exported from `parse-refutation.mjs`) agree on a shared table of at least eight lines, covering each key, emphasis, indentation, `*` bullets and a mid-line `claim:`
- [ ] Integration: `runReviewChain` with a scripted backend returning the bearer-token body with a clean affirmation does not exit 0 with `### observation: no findings`; it exits 10 (`MALFORMED`) from the shape gate

### From HOW (prose)
- [ ] The FAFF-1056 comment, the `ParseFault` doc comment and the CLI exit 1 comment in `parse-refutation.mjs` describe the new fault
- [ ] The `SKILL.md` exit 1 bullet names the new fault and `faff validate-adapters` passes
- [ ] The `normaliseCleanRefutation` header comment and the `faffter-dark-adversarial-review/SKILL.md` closed-grammar paragraph name the triple-bullet rule
- [ ] No file under `plugin/skills/faffter-dark-spec-review/refute-*.md`, `eval/review-bench/`, `aggregate.mjs` or `eval/cli-driver.mjs` changes; in `review-call.mjs` only the new regex, its export, the guard in `normaliseCleanRefutation` and comments change

### Integration smoke test

```
1. body = HEADER + "### observation: no findings\n### Logging raw bearer token\n- claim: the token is logged"
2. printf body | node parse-refutation.mjs --lens infosec
   -> exit 1, stdout {"lens":"infosec","outcome":"unavailable","kind":"model-transient","objections":[]}
3. feed that stdout plus three clear lenses to aggregate.mjs
   -> verdict "unavailable", an objection with lens "infosec" and severity "major", never "needs-human"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. The work is one guard in `parseRefutation`, about nine `node:test` cases in one existing file, and three comment or prose updates. That is a single 1-3 day unit with one concern. It doesn't need splitting, and none of the related tickets always ships with it, so there's nothing to merge.

**Workstream fit?** The ticket sits in project-less Backlog, which is the right default for a lone bug. But it's now one of several live tickets about one outcome: making refuter output from non-Claude reviewers parse safely. FAFF-1236 (measure the FAFF-1222 brief sentence) and FAFF-1238 (preamble guard misses wrong-lens and indented headings) are the others, and FAFF-1222 and FAFF-1056 are the Done work behind them. Why it matters: while they stay loose, this work can't be sequenced as one increment, and the order the spec relies on (FAFF-1236 still measuring, FAFF-1238 kept separate) lives only in spec prose. What to do: nothing on this ticket. Next time `/faff-plot rehome` runs, offer this cluster as a candidate outcome-led project.

**Deps surfaced?** Nothing blocks the build, and FAFF-1238 changes a different file (`review-call.mjs`, which the spec's DONE list keeps unchanged), so the two don't collide. One ordering effect isn't written down anywhere. FAFF-1236 measures FAFF-1222's brief sentence by running `refutation-spec` against `eval/baselines/frontier.json`. If FAFF-1223 merges first, any rep that trips the new guard errors instead of being graded. FAFF-1236 would then be reading two changes at once and could take this ticket's errors for brief-sentence drift. The link already exists as "related", so no blocker is needed. What to do: add one line to FAFF-1236 saying that errored reps whose `rawOutput` cites "finding section without a recognised severity" come from FAFF-1223, not drift. Or run FAFF-1236 before this merges.

**Risk profile?** No issues. The spec's main named risk is "recap sections trip the guard". To check it, the proposed detection (same `SEVERITY_HEADING_RE` and `BULLET_RE`, only on bodies that also have a recognised section) was run over all 332 retained `round-*.md` refuter transcripts under `.faff/spec-review/`. None tripped it. The other failure modes are covered too: each has a signal you can see (retained transcripts, eval `rawOutput`) and a planned response. The fault goes through the existing exit 1 `model-transient` route, so nothing new or external needs a spike first.

confidence: high
build-tier: complex
spec-review: accept (agent, after round 2: minor-only churn park, the same minor from QA and architectural, folded in under the operator's standing fix-minors-and-build preference)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```

