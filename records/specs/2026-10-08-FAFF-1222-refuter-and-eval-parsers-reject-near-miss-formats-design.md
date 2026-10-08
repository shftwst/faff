# FAFF-1222: Refuter and eval parsers accept near-miss formats from non-Claude reviewers

> Spec: faffter-dark-nlspec · 2026-10-07 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1222.

This spec is for the build agent implementing FAFF-1222 and for the humans reviewing it. A refutation eval run against `spark/glm-5.3-flash` at low effort errored on about 5% of reps, and every error was an output-format miss with a usually sound judgement inside. Production's adversarial review uses the same refuter parsers, so the same misses cost real reviews. This ticket fixes three of the four observed patterns: it tolerates two and keeps the third fail-closed while making the brief harder to misread. The fourth, a rare empty completion, moved to FAFF-1228.

## 1. WHY

**The idea the rest turns on.** Each parser gets wider only where the meaning is unambiguous, and it never guesses. A misplaced fence label or prose on the same line as a clean affirmation carries the same meaning as the compliant form, so the parser accepts it (and the eval still records the fence miss as `noncompliant`). A finding with no severity has no reliable reading, so it still fails closed; the fix there is in the brief.

**Problem.** The eval envelope parser, the clean-refutation normaliser and the refutation parser each accept one exact form. GLM 5.3 produced three format near-misses (a fence label on the next line, prose on the affirmation line, and a finding heading with no severity), each of which errored the rep or, in production, failed the lens. Accepting the two safe near-misses and tightening the brief for the third restores those reps without weakening any fail-closed guard.

### Design principles

**Compliant output is byte-identical.** Every parser change is a new arm reached only when the existing arm fails. Output that parses today parses to the same result, so the recorded eval baselines are unaffected for compliant outputs. The one change that can move model output is the brief sentence (pattern 3).

**Never invent a judgement.** No parser infers a severity, a lens or a verdict that the model did not state. A guessed severity either un-gates a real objection or gates on a guess.

**Format honesty in the eval.** A recovered envelope is `noncompliant`, so `format_adherence` keeps measuring how well a model follows the format.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `eval/envelope.mjs` `parseJudgementEnvelope` (`STRICT` :26, `ANY_FENCE` :27, fallback :73-79) | JavaScript | Pattern 1. Eval-only parser; gains a label-anchored recovery step |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `CLEAN_REFUTATIONS` (:704), `normaliseCleanRefutation` (:764, exact-line match :779) | JavaScript | Pattern 2. Shared by production spec-review fan-out and the refutation-spec eval (`eval/cli-driver.mjs` `fanRefutationSpec` :1204) |
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` `SEVERITY_HEADING_RE` (:42), recognised-section guard (:142-155) | JavaScript | Pattern 3. Stays fail-closed; unchanged |
| `plugin/skills/faffter-dark-spec-review/refute-{architectural,infosec,methodology,qa}.md` | Markdown | Pattern 3. The output-format instruction gains one sentence |
| `eval/review-bench/lenses/refute-*.md`, `eval/review-bench/build-requests.mjs` | Markdown, JavaScript | Byte-identical lens copies and request payloads, guarded by `test/review-bench-lens-parity.test.mjs` |
| `test/eval-grader.test.mjs`, `test/adversarial-call.test.mjs`, `test/spec-refute-parse.test.mjs`, `test/review-bench-lens-parity.test.mjs` | JavaScript (`node:test`) | Existing suites the new tests join |

**Scope.** Two small parser changes, four brief sentences and their tests.

## 2. OUT OF SCOPE

- **Empty HTTP 200 completions (pattern 4).** Why: split out by human decision (2026-10-07) into FAFF-1228, "Diagnose empty HTTP 200 completions from adversarial backends before adding a retry", which adds logging first and decides any retry from evidence. Nothing in `review-call.mjs`'s transport, the stream readers or the eval `JudgementRecord` changes here. Extension point: `runReviewOpenAi` / `runReviewAnthropic` in `review-call.mjs` and `buildJudgementRecord` in `eval/run-evals.mjs`.
- **A severity-less finding section beside a severity-bearing one.** Why: filed as FAFF-1223, "A refuter finding without a severity is silently dropped when the lens also returns a finding with one". `parseRefutation` skips every severity-less `### ` section as prose (FAFF-1056), so in a mixed body a severity-less section that carries a `- claim:` is dropped, not faulted; that is a separate fail-open question with its own trade-off against leaked reasoning headings. Extension point: the `recognisedSections` filter in `parse-refutation.mjs` (:142). FAFF-1223's prep should read the new brief sentence this ticket adds (pattern 3), since it changes how often a severity-less heading appears.
- **Inferring a severity from heading wording or bullet content.** Why: the ticket rules it out; it un-gates or gates on a guess. Extension point: none intended.
- **Rewording the clean-affirmation instruction in the briefs.** Why: the normaliser fix makes same-line prose safe, and a second brief change adds eval drift for no parser benefit. Extension point: the closing "If you find nothing" sentence of each `refute-*.md`.
- **Re-recording any eval baseline.** Why: recording a baseline is a separate human-supervised step. Extension point: `--update-baseline --kind refutation-spec,refutation-code`.
- **The scoped `refutation-spec` drift run against `eval/baselines/frontier.json`.** Why: deferred by human decision (2026-10-08) to FAFF-1236, "Measure whether the refuter severity-heading sentence shifts Claude's refutation-spec judgements". A 5-rep run takes about 2 hours, and host memory pressure stopped the first attempt after 49 reps over 3 cases, all graded with 0 format errors and no baseline diff. Extension point: the scoped command in FAFF-1236.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Label line | A line whose only content, apart from backticks and spaces or tabs, is `faff-eval:judgement` |
| Affirmation sentence | One of the four exact `sentence` values in `CLEAN_REFUTATIONS`, such as `No infosec objection.` |
| Same-line remainder | The text after an affirmation sentence and its following whitespace on the same line, trimmed |

### Envelope parser (pattern 1)

`parseJudgementEnvelope(raw, { expectedCaseId })` keeps its signature and return shape `{ ...envelope, format: "compliant" | "noncompliant" }`. The steps become:

1. Strict tag match: unchanged, `compliant`, fail-loud on malformed JSON.
2. Fenced-block fallback: unchanged, last valid envelope wins, `noncompliant`.
3. **New** label-anchored recovery, `noncompliant`.
4. `EnvelopeError`: unchanged message.

### Clean-refutation normaliser (pattern 2)

`normaliseCleanRefutation(content)` keeps its return shape `{ content, normalised, lens, form }` and its four `form` values (`bare`, `headed`, `headed+signal`, `header-wrapped`). No new form label.

## 4. HOW

### Pattern 1: label-anchored envelope recovery

The model sometimes opens a bare or two-backtick fence and puts `faff-eval:judgement` on the next line, or writes `` `` `faff-eval:judgement ``. Recovery anchors on the label line, not on the fence.

```
PROCEDURE recoverLabelled(raw, expectedCaseId):
  1. Normalise CRLF to LF. Split into lines. Drop leading blank lines.
  2. IF the first line matches ^[ \t]*`{2,3}[ \t]*$ (a stray empty fence opener):
       drop it, then drop any blank lines after it
  3. IF the first remaining line does NOT match ^[ \t`]*faff-eval:judgement[ \t`]*$: RETURN null
  4. body = the lines after the label line, up to (not including) the first line matching ^[ \t]*`{2,}[ \t]*$, or to end of text
  5. join body with "\n", trim, strip one trailing run of backticks, trim again
  6. env = tryEnvelopeJson(body)          # non-throwing, existing helper
  7. IF env AND (expectedCaseId is null OR env.case_id == expectedCaseId): RETURN { ...env, format: "noncompliant" }
  8. RETURN null
```

Wire it as step 3 of `parseJudgementEnvelope`, after the `ANY_FENCE` scan finds nothing. A malformed body here does not throw; it falls through to the existing `EnvelopeError`.

The label is accepted only at the start of the output (after at most one stray empty fence line), never further down. Eval prompts embed untrusted spec and context text, which a model may echo; anchoring stops a planted `faff-eval:judgement` line plus JSON with the expected `case_id` from becoming the rep's judgement. A prose sentence that mentions `faff-eval:judgement` mid-line is not a label line either.

**Anti-pattern:** widening `STRICT` to accept these forms. Why: `STRICT` returns `compliant` and fails loud on bad JSON; a near-miss must be `noncompliant` and must not throw on a mis-recovered body.

### Pattern 2: affirmation with same-line prose

Today the affirmation must be a whole line. The change lets a line that starts with the exact sentence, followed by a space or tab, count as the affirmation, with the rest of the line treated as trailing prose under the existing FAFF-1154 guard.

```
PROCEDURE matchAffirmation(line):
  1. FOR entry IN CLEAN_REFUTATIONS:
     a. IF line == entry.sentence: RETURN { entry, remainder: "" }
     b. IF line starts with entry.sentence AND the next character is a space or tab:
          RETURN { entry, remainder: rest of line, trimmed }
  2. RETURN none
```

In `normaliseCleanRefutation`:

1. Replace the exact-equality `find` in the backward scan (:779) with `matchAffirmation`. Last matching line still wins.
2. The trailing-segment guard checks the non-empty `remainder` first, then every following line as today. A hit rejects.
   - The remainder is rejected if it contains a severity-heading token or a `## Refutation —` token **anywhere**, not only at its start. Use unanchored forms of the two existing regexes: `#{1,6}\s*\[?(critical|major|minor|observation)\]?\s*[:—-]` and `#{1,6}\s+Refutation\s+[—-]`, both case-insensitive.
   - Following lines keep the existing line-start-anchored `SEVERITY_LIKE_HEADING_RE` and `REFUTATION_NAMESPACE_RE`, unchanged.
3. Form selection, the preamble severity guard and the return value are unchanged. The line above the affirmation still decides `headed` / `headed+signal` / `header-wrapped` / `bare`.

Consequences, all intended:

| Input | Result |
|---|---|
| `## Refutation — infosec` then `No infosec objection. The spec proposes a read-only …` | normalised, `infosec`, `headed` |
| `No QA objection. I checked every DONE item.` | normalised, `QA`, `bare` |
| `## Second opinion` then `No architectural objection. Fine.` | normalised, `header-wrapped` |
| `No QA objection.` followed by trailing spaces | normalised (empty remainder) |
| `No QA objection. ### major: real bug` | rejected (remainder hits the severity guard) |
| `No QA objection. Meanwhile ### major: real bug` | rejected (severity token inside the remainder) |
| `No architectural objection. See ## Refutation — QA` | rejected (namespace token inside the remainder) |
| `No infosec objections. Fine.`, `No infosec objection.Fine`, `No infosec objection, but …`, `**No infosec objection.** Fine` | rejected (not the exact sentence plus whitespace) |
| `## Refutation — architectural` then `No QA objection. Fine.` | rejected (wrong-lens heading, as today) |

No affirmation sentence is a prefix of another, so at most one entry matches a line.

### Pattern 3: severity-less finding stays fail-closed

`parse-refutation.mjs` is unchanged. A body whose only `### ` sections lack a severity still returns the existing fault (`reason: "no recognised finding section (### <severity>: ...)"`), Both paths that see it are unchanged: in production the transport's shape gate (`validateFindingsShape`) classifies the body first as exit 10 `MALFORMED` and the chain advances; in the eval, `fanRefutationSpec` calls `parseRefutation` directly, which faults and errors the rep.

The brief change, in all four `refute-*.md` files, adds one sentence immediately after the `- spec_anchor:` bullet of the output template (before the "Severities" paragraph):

```
Every objection heading MUST start with its severity word, exactly as `### critical: …`, `### major: …`, `### minor: …` or `### observation: …`; a heading without one is not read as an objection.
```

Then:

1. Copy each edited brief to `eval/review-bench/lenses/refute-<lens>.md` and run `node eval/review-bench/build-requests.mjs` so `test/review-bench-lens-parity.test.mjs` passes.
2. Re-measure the four brief sizes and update the `MEASURED` comment above `DEFAULT_BRIEF_RESERVE_TOKENS` in `review-call.mjs` (:169-173). `refute-infosec.md` must stay under 2400 tokens at 3.0 bytes per token (7200 bytes); it is 6591 bytes today.

### Failure modes

- **The brief sentence shifts refuter judgements.** How you'd know: the scoped `refutation-spec` run drifts from `eval/baselines/frontier.json`. What it means: proceed if the drift is format-only; otherwise narrow the sentence. FAFF-1236 runs this check after merge (deferred 2026-10-08). Re-baselining stays a human-supervised step.
- **The label anchor is too strict.** How you'd know: errored reps whose captured `raw_text` shows prose before a misplaced label. What it means: proceed; those reps errored before this ticket too, and widening the anchor reopens the injection path.
- **Label recovery masks a broken compliant path.** How you'd know: `format_adherence` for a kind that was 1.00 drops below 1.00, which the frontier gate already flags (`run-evals.mjs` :308). What it means: proceed; that is the honesty the `noncompliant` flag exists for.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a refutation-code rep whose output is "```\nfaff-eval:judgement\n{\"case_id\": \"refutation-code-001\", \"findings\": []}\n```"
When parseJudgementEnvelope runs with expectedCaseId "refutation-code-001"
Then it returns the envelope with format "noncompliant" instead of throwing EnvelopeError
```

```
Given an infosec lens body "## Refutation — infosec\nNo infosec objection. The spec proposes a read-only endpoint."
When normaliseCleanRefutation runs
Then it returns { content: "### observation: no findings", normalised: true, lens: "infosec", form: "headed" }
```

```
Given a QA lens body "No QA objection. ### major: the DONE list has no pass line"
When normaliseCleanRefutation runs
Then it returns the input unchanged with normalised false
```

```
Given a refuter body "## Refutation — QA\n\n### Appetite semantics undefined\n- claim: the mapping is asserted\n- evidence: WHAT\n- predicted_consequence: done cannot be decided\n- spec_anchor: what"
When parseRefutation runs for lens "QA"
Then it returns ok false with the "no recognised finding section" reason, and no severity is assigned
```

- Output that parses today returns a deep-equal result after the change, for every existing fixture in `test/eval-grader.test.mjs`, `test/adversarial-call.test.mjs` and `test/spec-refute-parse.test.mjs`.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Pattern 1 fix shape | Widen `STRICT`; strip a leading label line inside the `ANY_FENCE` scan; a separate label-anchored step | **Chosen:** separate label-anchored step after the fence scan |
| Pattern 1 format flag | `compliant`; `noncompliant` | **Chosen:** `noncompliant`, so `format_adherence` stays honest |
| Two-backtick openers | Out of scope; in scope | **Chosen:** in scope; anchoring on the label line covers them at no extra cost |
| Pattern 1 label position | Anywhere in the output; only at the start, after at most one stray empty fence line | **Chosen:** only at the start, so echoed untrusted text cannot supply the judgement |
| Pattern 1 step order | Before the fence scan; after it | **Chosen:** after, so every output the fence scan recovers today is unchanged |
| Pattern 2 match rule | Exact line only; starts with sentence plus whitespace; substring anywhere | **Chosen:** starts with the exact sentence plus a space or tab |
| Pattern 2 same-line remainder | Ignore it; run the line-start-anchored guards on it; reject a severity or namespace token anywhere in it | **Chosen:** reject either token anywhere in the remainder, so a finding stated mid-line still rejects |
| Pattern 2 form label | New label for same-line prose; keep the four forms | **Chosen:** keep the four forms; the line above still decides |
| Pattern 3 severity | Infer one; default to `observation`; fail closed | **Chosen:** fail closed, parser unchanged |
| Pattern 3 brief change | One brief; all four; also reword the clean instruction | **Chosen:** all four, one sentence each; clean instruction unchanged |
| Pattern 3 eval case | Add a refutation-spec case; unit test only | **Chosen:** unit test only |

**Pattern 1 step order.** The fence scan already recovers `` ```json `` mis-tags; running the label step first could change which block wins in a body that holds both. Running it last only adds recoveries.

**Pattern 1 label position.** The observed outputs all start with the label or a stray fence line, so the anchor costs no observed recovery. An output with a preamble before a misplaced label still errors, exactly as today.

**Pattern 2 match rule.** A substring match would accept `I would say No QA objection. but …`. Requiring the line to start with the sentence keeps the closed-grammar stance of FAFF-746 while matching how FAFF-1154 already accepts prose on the next line.

**Pattern 3 eval case.** An eval case grades the judgement, not the format; a fixture cannot make a model omit its severity, so a new case would test nothing this ticket changes. The deterministic parser test pins the fail-closed behaviour.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The ticket states the intent for the three patterns in scope, the human moved pattern 4 to FAFF-1228 (2026-10-07), and the codebase answers the rest.

**Assumptions:** none beyond the cited code. The observed raw outputs are taken from the ticket.

## 8. DONE

### From WHY
- [ ] Every existing fixture in `test/eval-grader.test.mjs`, `test/adversarial-call.test.mjs` and `test/spec-refute-parse.test.mjs` passes unchanged
- [ ] No baseline file under `eval/baselines/` is modified

### From HOW (pattern 1, `test/eval-grader.test.mjs`)
- [ ] `"```\nfaff-eval:judgement\n{json}\n```"` parses with `format: "noncompliant"`, with and without leading blank lines
- [ ] A label line further down the output (after prose, for example `"Here is my review.\nfaff-eval:judgement\n{json}"`, or after a stray fence line and prose) is not recovered and throws `EnvelopeError`, even when the JSON carries the expected `case_id`
- [ ] A two-backtick opener `` "``faff-eval:judgement\n{json}" `` with no closing fence parses with `format: "noncompliant"`
- [ ] A label-line body with invalid JSON throws `EnvelopeError`
- [ ] A label-line envelope whose `case_id` differs from `expectedCaseId` throws `EnvelopeError`
- [ ] A prose line containing `faff-eval:judgement` mid-sentence, with no fence, throws `EnvelopeError`
- [ ] A body with both a valid `` ```json `` envelope and a label-line envelope returns the `` ```json `` one (fence scan first)

### From HOW (pattern 2, `test/adversarial-call.test.mjs`)
- [ ] The issue's `infosec` example normalises with `form: "headed"`
- [ ] Same-line prose normalises for each of `bare`, `headed`, `headed+signal` and `header-wrapped`
- [ ] Each rejected row of the pattern 2 table returns `{ content, normalised: false, lens: null, form: null }`, including the two rows where the token sits mid-remainder
- [ ] The FAFF-746 prompt-contract test still passes

### From HOW (pattern 3)
- [ ] `test/spec-refute-parse.test.mjs` gains a case: a lone severity-less heading with a full claim, evidence, predicted_consequence and spec_anchor body faults with the "no recognised finding section" reason
- [ ] Each of the four `refute-*.md` briefs contains the new severity sentence
- [ ] `test/review-bench-lens-parity.test.mjs` passes after the lens copies and payloads are regenerated
- [ ] The `MEASURED` comment matches the new brief byte counts, and `refute-infosec.md` is under 7200 bytes

The pre-merge `refutation-spec` gate against `eval/baselines/frontier.json` that this list once held was moved to FAFF-1236 by human decision (2026-10-08); see OUT OF SCOPE.

### Integration smoke test

```
1. runReviewChain([backend], { runReviewFn: scripted -> { status: "ok",
     content: "## Refutation — QA\nNo QA objection. Every DONE item has a pass line." } })
   -> exit 0, content "### observation: no findings", log has "normalized: clean refutation … lens=QA form=headed"
2. parseRefutation(that content, "QA") -> ok, outcome "clear", objections []
3. parseJudgementEnvelope("```\nfaff-eval:judgement\n{\"case_id\":\"c1\",\"findings\":[]}\n```", { expectedCaseId: "c1" })
   -> { case_id: "c1", findings: [], format: "noncompliant" }
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** It fits the 1-3 day norm: two parser fallbacks, one sentence added to each of the four refuter briefs, their tests and one scoped gate run. With pattern 4 moved to FAFF-1228, the `complex` tier looks high for what is left. `standard` would match the scope, and a stronger tier is only worth keeping for the brief and gate step. What to do: consider re-tiering to `standard`. Otherwise, no issues.

**Workstream fit?** It is project-less by human decision, which matches the default landing for newly captured work. It serves one outcome: refuter output from non-Claude models with near-miss formatting is read instead of failing. No issues.

**Deps surfaced?** FAFF-1228 (diagnose empty HTTP 200 completions before adding a retry) and FAFF-1223 (a severity-less finding silently dropped beside one with a severity) are both linked as related. The spec tells FAFF-1223's prep to read the new brief sentence. Nothing blocks this ticket. One gap: the issue description still lists pattern 4 and its expected outcome ("the cause is identified, and either fixed or surfaced"), which this ticket no longer delivers. What to do: add a one-line scope pointer at the top of the description naming the spec and FAFF-1228, as FAFF-1198 now has.

**Risk profile?** Low. The parser changes only run when the existing parse fails, and the tests pin both byte-identical results for compliant output and the rejected near-misses. The one change that can move refuter output, the brief sentence, now has a pre-merge `refutation-spec` gate against `eval/baselines/frontier.json`, run on a scratch copy so the committed baseline is untouched, with any drift explained or flagged in the PR. No issues.

confidence: high
build-tier: complex
spec-review: accept (agent, after round 1: minor-only, folded in under the operator's standing fix-minors-and-build preference)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
