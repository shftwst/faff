# FAFF-1477: refuse lights-out admission of a spec whose human-judgement items are not tagged needs-human

> Spec: faffter-dark-nlspec · 2026-11-16 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1477.

This spec adds three refusals to the lights-out admissibility check (`admissibleVerdict`), so a spec that asks a person to judge something cannot be admitted to an unattended run unless that item is tagged `needs-human:`. FAFF-1475, FAFF-1476 and FAFF-1478 are merged context, not blockers: they made a tagged item human-only, anchored and skipped by the unattended merge floor, and nothing in this build waits on them. It is written for the build agent and for the human reviewers who approve it.

Where the ticket text and the code disagree, this spec follows the code. The ticket lists "subjective" and "a person confirms" as pattern candidates. Run over the committed corpus, a bare "subjective" and a bare "a human" over-match, so section 3 narrows the list and section 6 records why.

## 1. WHY: problem and principles

**The load-bearing model.** The unattended merge floor can only skip a pending acceptance criterion it was told is human-only, and the only way to tell it is a `needs-human: <reason>` prefix on the DONE item. An item that is really a person's judgement but carries no prefix is invisible to that rule: the item stays pending, nothing can verify it, and the run parks at the merge floor after the whole build has been paid for. This change moves that discovery to admission, where it costs one refused spec. The mechanism is three deterministic checks in `admissibleVerdict`, each reading the same marker predicate `faff dod classify` already uses.

**Problem statement.** A spec can carry a DONE item only a person can check ("the layout looks right", "confirmed by eye") with no `needs-human:` tag, and lights-out admission accepts it today. The unattended run then builds against an unverifiable item and parks at the merge floor, or a spec tags every item `needs-human:` and leaves nothing machine-checkable to gate the merge. This change refuses those specs at lights-out admission with a reason that names the item.

**Design principles.**

**One marker predicate.** Whether a DONE item is tagged is decided by one function, shared by `dodClassify` and the new checks. A second regex would let the admission gate and the merge floor disagree about what a tag is, which is the failure FAFF-1475 exists to prevent.

**Narrow over complete.** The phrase list refuses only wording that unambiguously names a person doing the checking. A missed phrase costs a park at the merge floor (today's behaviour). A false match costs a refused good spec, and the author has to read a reason and re-tag. The list is therefore short, matched as whole phrases, and pinned by a corpus test, so widening it is a visible diff.

**Refuse, never rewrite.** The checks name the item and the way out (tag it or make it machine-checkable). They never change the spec, and they never downgrade an empty-reason marker into an ordinary item.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` (`admissibleVerdict` ~789, `dodClassify` ~297, `parseDoneChecklist` ~595, `proseDoneAdvisory` ~682, `BANNED_VAGUE` ~471) | JavaScript, factory region, listed in `legacy-js-modules.json` | The gate and the marker parse; gains the shared predicate, the phrase list and three checks |
| `plugin/skills/faff/bin/lib/ac-id.js` (`parseLocalAcId`) | JavaScript, governance region | Separates an authored `[ac-N]` id from the item text; called per item, quietly |
| `plugin/skills/faff/bin/lib/graft-admit.js` (line 284) | JavaScript | Calls `admissibleVerdict(spec, true)` on every automated run and returns `inadmissible` with the reasons; interactive graft skips it. Not edited |
| `plugin/skills/faff/bin/lib/prep-attach.ts` and `.js` (the `admissibility:` line) | TypeScript with committed emit | Renders failing check ids verbatim, so new ids flow through. Not edited |
| `plugin/skills/faffter-noon-spec/SKILL.md` (lines 81 and 87) | Markdown, skill prose | The tag rule and the self-review step that runs `faff admissible --lights-out`; gains one paragraph |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` (line 210 and its _Quality bar_ section) | Markdown, skill prose | Has the same tag rule and inherits the sibling's self-review section unchanged. Not edited |
| `plugin/skills/faff/prose-baseline.json` | JSON | Zero-headroom byte baseline per skill file; the edited skill's entry rises by the exact delta |
| `test/admissible.test.mjs`, `test/faff-1475-human-only-acs.test.mjs` | JavaScript, node:test | Existing admission and marker tests; new cases go in `test/` |

**Scope statement.** This is a change to the lights-out admission gate and one self-review paragraph; it adds no command, module, event type, merge-floor rule or tracker call.

## 2. OUT OF SCOPE

- **Name:** the merge-floor skip rule, the `human-only-acs.json` stamp and the evidence roster.
  - **Why excluded:** FAFF-1475, FAFF-1476 and FAFF-1478 settled them; this ticket only guards admission.
  - **Extension point:** `readAcFloor` and `human-only-acs.ts`.
- **Name:** judging whether a `needs-human:` tag is honest (a machine-checkable item tagged to dodge a check), and any new control over who may write the tag.
  - **Why excluded:** that is a judgement, and ADR-0020 keeps lights-out admissibility deterministic. The tag is self-attested by the spec's author, and this change adds no control over that. What already bounds it: R2d guarantees at least one DONE item that is not tagged human-only remains for the merge floor to verify; the skip is never silent, because the merge result and `merge-record.json` carry `ac_called_out`, the run summary has a `## Shipped (human-only ACs called out)` section, and the governance check appends a "human-only ACs called out" note; and the tag is stamped and anchored in `human-only-acs.json` (FAFF-1475). The residual risk is plain: an agent can over-tag, a person sees it in the called-out list only after the merge, and judging the tag's honesty stays a spec-review or human call, with no guarantee that any review catches it.
  - **Extension point:** a human-ratification control on the tag (a future ticket); the spec-review lenses for honesty review.
- **Name:** a human-judgement criterion written as a Scenarios unit (for example a `Then` that the layout looks right).
  - **Why excluded:** these checks read only DONE items; such a unit stays on the existing holdout `needs-human` path, so this guard does not close the merge-floor park failure in general.
  - **Extension point:** `scenariosProseAdvisory` and the holdout verdict path.
- **Name:** FAFF-1339, the check that each delegated `ac_id` has a `passed: true` row.
  - **Why excluded:** a different completeness check on a different file.
  - **Extension point:** FAFF-1339.
- **Name:** a widening of the phrase list beyond the corpus-checked set (for example operator-attestation wording such as "the operator attests").
  - **Why excluded:** the corpus shows those items are human, but the wording varies too much to match without false positives; authors tag them.
  - **Extension point:** `HUMAN_JUDGEMENT` in `admissibility.js`, with the corpus pin changed in the same diff.
- **Name:** retiring the `--selftest` block in `admissibility.js`.
  - **Why excluded:** no existing selftest case changes its expectation, because the new filters are no-ops on a spec with no tagged item. New cases go in `test/`. Retirement is FAFF-1419.
  - **Extension point:** FAFF-1419.
- **Name:** any change to non-lights-out admission, to `faff dod classify` output, or to the advisory wording.
  - **Why excluded:** the ticket scopes the guard to lights-out, and advisory text is pinned by existing tests.
  - **Extension point:** none required.

## 3. WHAT: vocabulary, types and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| marker | a DONE item whose id-stripped text begins `needs-human:`, case-insensitive |
| human-only item | a marker with a non-empty reason after the colon |
| empty-reason marker | a marker whose reason is empty or only whitespace; it is not human-only |
| untagged item | a DONE item with no marker |
| human-judgement phrase | a phrase in `HUMAN_JUDGEMENT` (below) |

**Types.**

```
FUNCTION parse_human_marker(text) -> MarkerParse         # the one shared predicate
RECORD MarkerParse:
  marked: boolean              # text matches ^needs-human:[ \t]*(.*)$ , case-insensitive
  reason: string               # the captured group, trimmed; "" when not marked
  human_only: boolean          # marked AND reason != ""

CONSTANT HUMAN_JUDGEMENT: seven case-insensitive patterns, written literally (JavaScript regex syntax):
  /\bby\s+eye\b/i
  /\bmanually\s+(?:verif(?:y|ied|ies)|confirm(?:s|ed)?|inspect(?:s|ed)?)\b/i
  /\bmanual\s+(?:verification|confirmation|inspection)\b/i
  /\ba\s+(?:person|human)\s+(?:confirms|checks|verifies|inspects|signs\s+off)\b/i
  /\bvisually\s+(?:inspect|confirm|check|verif|review)\w*/i
  /\blooks\s+right\b/i
  /\bsubjective(?:ly)?\s+(?:judg(?:e)?ment|call|assessment|review)\b/i
  # inline code spans are removed from the item text before any pattern runs

FUNCTION matches_human_judgement(item_text) -> boolean   # strips inline code spans, then tests the list
```

The bare nouns "confirmation" and "inspection" do NOT match on their own: the third pattern needs the word "manual" directly before them, and no pattern lists them alone. So "the confirmation dialog closes" and "the inspection log lists X" pass the check, while "manual confirmation of the layout" refuses.

**What R2d guarantees.** Only that something remains for the merge floor and the AC checklist to verify. It does not judge whether a remaining item is machine-checkable: an untagged prose item passes R2d, and whether it can be verified stays with the prose-DONE advisory and review. "Untagged" means no marker; "tagged human-only" means a marker with a reason; an empty-reason marker is marked but not human-only.

**New checks.** Appended to `checks[]` after `R2b.done-concrete`, in this order. Each is gating (a failed check makes `admissible` false and adds its `detail` to `reasons`).

| Id | Passes when | Failing detail (shape) |
|---|---|---|
| `R2c.human-judgement-untagged` | no untagged item matches `HUMAN_JUDGEMENT` | `N untagged DONE item(s) name a human-judgement phrase; tag each needs-human: <reason> or make it machine-checkable: <items>` |
| `R2d.not-all-human-only` | the spec has at least one DONE item that is not tagged human-only (an untagged item, or an empty-reason marker, counts), or has no DONE items (R2a already refuses that) | `every DONE item is tagged needs-human: with a reason, so no DONE item is left for the merge floor to verify (need at least one item that is not tagged human-only)` |
| `R2e.human-marker-reason` | no empty-reason marker | `N DONE item(s) begin needs-human: with no reason; give each a reason or remove the marker: <items>` |

Items in the details are whitespace-collapsed and truncated to 50 characters, joined by ` | `, matching the R2b detail. The passing details are exactly these strings (N is the count):

| Id | Passing detail |
|---|---|
| `R2c.human-judgement-untagged` | `0 untagged human-judgement DONE item(s)` |
| `R2d.not-all-human-only` | `N DONE item(s) not tagged human-only (need at least 1)` |
| `R2e.human-marker-reason` | `0 DONE item(s) begin needs-human: with no reason` |

**Advisory counts.** `proseDoneAdvisory` ignores criteria with `human_only === true`: it is removed from the prose list, `count`, `items` and the duplicates only. `doneTotal`, and therefore `allProseDone`, stay computed over all DONE items, so a spec that carries any tagged item never fires the "every DONE item is loose prose" line, whose claim would be false for it. The born-verifiable set used for the duplicate flag is unchanged. Advisory wording is unchanged. Its only caller is the lights-out branch of `admissibleVerdict` (`admissibility.js` line 807, after the non-lights-out early return), so the change reaches callers only through the `faff admissible --lights-out` warnings. `dodClassify` and `faff dod classify` output is unchanged, and the non-lights-out verdict (one `scope` check, no warnings) is unaffected. `oracleLessAdvisory` has no caller outside the selftest and is not edited. The code-surface and Scenarios advisories need no edit: the first filters to tier `integration` (a human-only item is tier `delegated`), and the other two read only Scenarios units.

**Design decisions** are collected in section 6.

## 4. HOW: behaviour

**Behaviour summary.** Under `--lights-out`, `admissibleVerdict` now also reads each DONE item the way `dodClassify` does (id stripped, marker parsed) and refuses three authoring faults: a person-judged item left untagged, a spec whose DONE items are all tagged human-only, and a tag with no reason. Without `--lights-out` the verdict is the unchanged one-check `scope` pass.

```
PROCEDURE admissible_verdict(spec, lights_out):
  1. IF NOT lights_out: RETURN the unchanged scope pass            # no new check runs
  2. R1, R2a, R2b exactly as today (R2b still reads the raw item text)
  3. items = FOR each raw IN parse_done_checklist(spec): parse_local_ac_id(raw).text
       # parse_local_ac_id, not assign_local_ac_ids: the latter writes id advisories to stderr, and
       # the advisories' own dod_classify calls already write them, so calling it here would repeat them
  4. marks = FOR each item IN items: parse_human_marker(item)
  5. R2c: untagged = items WHERE NOT mark.marked AND matches_human_judgement(item)
          push { id: "R2c.human-judgement-untagged", pass: untagged is empty, detail }
  6. R2d: remaining = marks WHERE NOT mark.human_only
          push { id: "R2d.not-all-human-only", pass: items is empty OR remaining is non-empty, detail }
  7. R2e: empties = marks WHERE mark.marked AND mark.reason == ""
          push { id: "R2e.human-marker-reason", pass: empties is empty, detail }
  8. warnings as today, except the two advisories ignore human-only criteria
  9. admissible = every check passes; reasons = failing details in check order
```

```
PROCEDURE dod_classify_marker(item):                      # the rewired call site
  1. mark = parse_human_marker(item)
  2. human_only = mark.human_only
  3. IF human_only: text = mark.reason
     ELSE IF mark.marked: record the empty-reason stderr advisory, text stays literal
  # behaviour and stderr text identical to today; only the regex now lives in one function
```

**Edge cases and error handling.**

- A tagged item is never matched against `HUMAN_JUDGEMENT`: tagging an item that says "by eye" is the correct fix, and it passes.
- An empty-reason marker is a separate refusal (R2e). Its text begins `needs-human:` and is not matched against the phrase list, so one fault produces one reason.
- A spec whose DONE items are all empty-reason markers fails R2e and passes R2d (no item is human-only). Giving every marker a reason then makes it fail R2d, which is correct: the author learns about it on the second pass. **Chosen:** report the faults independently, without trying to predict the post-fix state; a spec with several faults lists several reasons.
- `[ac-N]` ids: the marker comes after the id. `- [ ] [ac-2] needs-human: reason` is tagged; `- [ ] needs-human: [ac-2] reason` is also tagged (the id is only stripped when it leads), matching `dodClassify`.
- A near-miss id such as `[AC-2]` leaves the text intact, so a marker after it is not found. This is today's `dodClassify` behaviour and the shared predicate keeps it.
- The checks run only over `parseDoneChecklist` items, so text under Scenarios or elsewhere is never matched.
- Fail-safe is unchanged: a thrown parse error still returns `inadmissible`.

**Corpus effect (measured at origin/main 89387a00 over the 951 committed specs under `records/specs`).** 715 are admissible under lights-out today and 236 are not. With the list in section 3 and code spans removed, 4 specs, holding 7 untagged items, newly fail R2c: FAFF-654 and FAFF-657 (five operator-attestation items read "by eye"), FAFF-1211 and FAFF-1403 (one "manual verification" item each). All four are shipped designs and genuinely human-checked. None of the 236 already-inadmissible specs also fails R2c (measured), so the four are the whole R2c set over all 951 specs. R2d and R2e refuse none, because no committed spec carries a marker yet. The dropped candidates in section 6 would add only false positives (for example 34 "a human" items), and the kept ones that match nothing today cost nothing; any later change to the list shows as a changed pin.

**Rollout effect.** The 4-of-715 figure comes from committed (shipped) specs and says nothing about the current queue, whose attached specs live in the tracker; the Rollout items therefore require a queue scan before merge. A spec already attached and promoted to Todo is re-checked on every automated admission (`graft-admit` step 7), so a queued spec with an untagged phrase becomes `inadmissible` at its next unattended admission, with the item named in the reason. Recovery is a tag or a rewrite. Interactive graft skips the check, so nothing in a person's own session changes.

**Failure modes: how the approach falls over, and how you would notice.**

- **The failure:** the list under-matches. A person-judged item worded another way ("an operator signs off the capture") passes untagged and parks at the merge floor, as it does today.
- **How you would know:** a lights-out run parks at the merge floor on a pending criterion whose spec text is human-judged and untagged. The park record names the criterion.
- **What it means:** proceed. The guard is a floor that catches the unambiguous cases, and a miss is no worse than before. Add the phrase with its corpus count in one diff.
- **The failure:** the list over-matches, refusing a spec whose item merely mentions a phrase.
- **How you would know:** an author reports a refusal naming an item that is machine-checkable, or the corpus pin changes unexpectedly when a new spec lands.
- **What it means:** narrow. Code spans are already exempt; tighten the pattern, never add an escape hatch flag.

- **The failure:** the tag is self-attested. In a lights-out flow the spec's author is the unattended agent, so it can tag a machine-checkable item `needs-human:` to pass R2c, or tag many items and keep one trivial untagged item to satisfy R2d. A tagged item also leaves both advisories, so one self-issued tag removes the item from the gate and from the delegation advisory.
- **How you would know:** the merge result and `merge-record.json` list the skipped criteria in `ac_called_out`, the run summary shows them under `## Shipped (human-only ACs called out)`, and the governance check names them. A person reads that list after the merge.
- **What it means:** proceed with the residual stated. The skip is visible and recorded, never silent, but it is seen after the merge and nothing here judges the tag's honesty. That judgement stays with spec review and the human, and no review is guaranteed to catch it. A control over who may write the tag is a separate ticket.
- **The failure:** an author wraps a listed phrase in backticks to pass R2c untagged. Code spans are exempt by design so a spec can name a phrase (this spec does), and the same exemption is the cheapest evasion.
- **How you would know:** the run parks at the merge floor on a pending criterion that was never tagged, as it does today.
- **What it means:** accepted, with the same bound as the self-attested tag: no worse than today, and any resulting skip is called out after the merge.

**Anti-pattern:** a second `needs-human:` regex in `admissibleVerdict` or a test helper. Why: the admission gate and the merge floor would then be able to disagree about what a tag is. A DONE item checks that the literal appears once.

**Anti-pattern:** matching the bare word "subjective", "human" or "by hand". Why: the corpus shows these mostly appear in items about subjectivity, human ratification or running a command by hand, none of which asks a person to judge anything.

**Anti-pattern:** counting a tagged item in the prose-DONE advisory. Why: the advisory predicts items the AC checklist will verify; a human-only item is verified by a person, so counting it overstates the advisory and can trigger the all-prose line wrongly.

**Rule inventory.** No skill rule is deleted. The self-review edit adds one paragraph, so no `## Rule inventory` is needed.

**Eval coverage.** No LLM-judgement seam is introduced or changed; the checks are deterministic.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

> Every scenario pipes a spec to `faff admissible --lights-out --spec - --json` and reads stdout and the exit code. "S0" is a spec with one valid Given/When/Then scenario and the DONE items `- [ ] exit code MUST be 0 admissible` and `- [ ] the verdict MUST list every failing check`, so it is admissible before the item under test is added.

```
Given S0 plus the DONE item `- [ ] the dashboard layout is confirmed by eye`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and admissible is false
And checks contains an entry with id "R2c.human-judgement-untagged" and pass false
And reasons contains one string that names the item and contains "needs-human"
```

```
Given S0 plus the DONE item `- [ ] [ac-3] needs-human: the dashboard layout is confirmed by eye`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 0 and admissible is true
And the R2c, R2d and R2e checks all have pass true
```

```
Given S0 with its two DONE items replaced by `- [ ] needs-human: the copy reads naturally` and `- [ ] needs-human: the colours match the brand sheet`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and admissible is false
And the R2d check has pass false and its detail contains "no DONE item is left"
And the R2c and R2e checks have pass true
```

```
Given S0 plus the DONE item `- [ ] needs-human:   `
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2e check has pass false
And reasons contains one string that contains "with no reason"
And the R2c check has pass true
```

```
Given S0 plus the DONE item ``- [ ] the help text no longer uses the phrase `by eye` and exit code MUST be 0``
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 0 and the R2c check has pass true
```

```
Given S0 plus the DONE item `- [ ] manual confirmation of the layout`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2c check has pass false
```

```
Given S0 plus the DONE items `- [ ] the confirmation dialog closes` and `- [ ] the inspection log lists the failing check`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 0 and the R2c check has pass true
```

```
Given four copies of S0, each with one untagged DONE item: `a person confirms the wording`, `the page is visually checked`, `the result looks right`, and `the copy is a subjective call`
When each is piped to `faff admissible --lights-out --spec - --json`
Then each exits 1 with the R2c check at pass false
And the same four items prefixed `needs-human: <reason>` each exit 0 with the R2c check at pass true
```

```
Given S0 plus the DONE items `- [ ] Confirmed by eye` and `- [ ] Manually verified`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2c detail names both items
And the detail joins them with " | "
```

```
Given S0 plus one untagged DONE item of more than 50 characters that contains "by eye" after its 60th character
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2c detail shows that item cut to its first 50 characters
```

```
Given S0 with its two DONE items replaced by `- [ ] needs-human:` and `- [ ] needs-human:   ` (no reasons)
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2e check has pass false and the R2d check has pass true
```

```
Given that spec with the reasons added: `- [ ] needs-human: the copy reads naturally` and `- [ ] needs-human: the colours match the brand sheet`
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2e check has pass true and the R2d check has pass false
```

```
Given a spec with one valid Given/When/Then scenario and no DONE section
When it is piped to `faff admissible --lights-out --spec - --json`
Then the exit code is 1 and the R2a check has pass false
And the R2d and R2e checks have pass true
```

```
Given the spec of the first scenario
When it is piped to `faff admissible --spec - --json` with no --lights-out
Then the exit code is 0 and admissible is true
And checks has exactly one entry, with id "scope"
```

- `faff admissible --lights-out` MUST run the new checks over the same id-stripped item text `faff dod classify` uses, so the set of items R2c and R2d treat as tagged equals the set `dod classify` reports with `human_only: true`.
- The new checks MUST NOT write to stderr themselves.

## 6. DESIGN DECISION RATIONALE

**Which phrases go in `HUMAN_JUDGEMENT`?** Corpus counts below are untagged DONE items over the 951 committed specs, measured at origin/main 89387a00.

| Candidate | Corpus result | Decision |
|---|---|---|
| by eye | 5 items, 2 specs, all genuine operator attestations | keep |
| manual verification, confirmation, inspection (noun forms) | 2 items, 2 specs, both genuine | keep |
| manually verify, confirm, inspect (verb forms) | 0 hits | keep (ticket wording; corpus pins the zero) |
| a person or human confirms, checks, verifies, inspects, signs off | 0 hits as a phrase | keep |
| visually inspect, confirm, check, verify, review | 0 hits | keep as a phrase; bare "visually" is dropped as too broad for a spec about rendering |
| looks right | 0 hits | keep |
| subjective judgement, call, assessment, review | 0 hits | keep as a phrase |
| bare "subjective" | 3 items, 3 specs, all mentions of the word in other contexts | drop |
| "a human" or "human review" | 34 items in 33 specs and 1 item, nearly all "human-ratified" or "human-supervised" | drop |
| "by hand" | 4 items, 4 specs, none a person judging (running a command, a docs heading) | drop |
| "eyeball" | 1 item, in "not a fresh eyeball check" | drop |

**Chosen:** the keep rows. Whole-phrase matching with word boundaries, case-insensitive, over the id-stripped item text with inline code spans removed. At the time of writing the list refuses 4 of 715 admissible specs, and every refusal is a genuine person-judged item.

**Where do the checks live and what are their ids?** **Chosen:** inside `admissibleVerdict` in `admissibility.js`, as `R2c`, `R2d` and `R2e` appended after `R2b`, all gating. Appending keeps existing check order and ids stable, and `prep-attach` renders new ids without change.

**Should a tagged item be exempt from R2b (vague-wording) too?** **Chosen:** no. R2b is untouched; it reads the raw text and a tagged item that says "works correctly" is still vague. Changing R2b is outside the ticket.

**How is the marker predicate shared?** **Chosen:** extract `parseHumanMarker` in `admissibility.js` and call it from `dodClassify` and the new checks. The alternative, a new module, adds a file for ten lines; `dodClassify` already lives in `admissibility.js` and `admissibility.js` is in the legacy-JS list, so a small edit stays JavaScript.

**How do the new checks read ids without adding stderr output?** **Chosen:** call `parseLocalAcId` per item and take `.text`. `assignLocalAcIds` writes id advisories to stderr, and the advisories' existing `dodClassify` calls already do, so the new checks use the pure function and add no stderr output of their own.

**Does the prose-DONE advisory exclude tagged items by filtering `human_only`?** **Chosen:** yes, from `count`, `items` and the duplicates only, using the field `dodClassify` already sets. `doneTotal` and `allProseDone` stay over all DONE items, because the "every DONE item is loose prose" line would otherwise fire on a spec with a tagged item, where it is false. Wording stays as it is. `oracleLessAdvisory` is left alone because nothing but its selftest calls it, so an edit there would change nothing.

**What does R2d claim?** **Chosen:** only that at least one DONE item is not tagged human-only, so something is left for the merge floor and the AC checklist to verify. It is named `not-all-human-only` for that reason, and it does not classify the remaining items; an untagged prose item passes, and whether it can be verified stays with the prose-DONE advisory and review. Adding a classifier to R2d would be a second prose detector, which the module avoids.

**How does the corpus test stay honest as specs are added?** **Chosen:** the test names the four refused specs and asserts the refused set equals that list, with R2d and R2e at zero. A new spec that adds an untagged phrase fails the test, which forces the author to tag it or to change the pin and the list in one reviewed diff. Pinning a total spec count is avoided, since the corpus grows.

**Which producer skill is edited?** **Chosen:** `faffter-noon-spec/SKILL.md` only. `faffter-dark-nlspec/SKILL.md` discharges its self-review by inheriting the sibling's section in full, so it takes the change with no edit. Its tag rule (line 210) already says to tag a person-only item, which is the rule the new refusals enforce.

**Does the selftest block change?** **Chosen:** no; see section 2. The new cases are in `test/`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

Open Questions: none. The pattern list, check ids, ordering and advisory handling are closed in section 6.

**Assumes:** `parseLocalAcId` returns the item text with a leading `[ac-N] ` removed and never writes to stderr. Validate: read `plugin/skills/faff/bin/lib/ac-id.js` lines 23 to 28 before building; it is a pure function.

**Assumes:** `faff graft admit` and `prep-attach` pass `admissibleVerdict`'s `reasons` and failing check ids through without a closed vocabulary of ids. Validate: `grep -n "R2b\|R1.scenarios" plugin/skills/faff/bin/lib/prep-attach.ts plugin/skills/faff/bin/lib/graft-admit.js`; only `R1.scenarios` is special-cased and no list of R2 ids exists.

**Assumes:** the corpus figures (715 admissible, 4 newly refused, 7 items) hold on the base the build starts from. Validate: run the corpus scan in the new test against the current `records/specs`; if specs have landed since 89387a00, apply section 6's keep/drop rule to each new hit and update the pin deliberately.

## 8. DONE: definition of done

No DONE item below needs a person to check it, so none carries `needs-human:`.

### From WHY
- [ ] `faff admissible --lights-out` exits 1 with a reason naming the item for an untagged DONE item that contains a phrase from the keep list, and exits 0 once the same item is prefixed `needs-human: <reason>` (scenarios 1 and 2).
- [ ] A spec whose DONE items are all human-only exits 1 with a reason containing "no DONE item is left" (scenario 3).

### From WHAT (types and interfaces)
- [ ] `parseHumanMarker` and `HUMAN_JUDGEMENT` are exported from `admissibility.js`, and `HUMAN_JUDGEMENT` holds the seven patterns written in section 3, character for character.
- [ ] `checks[]` gains `R2c.human-judgement-untagged`, `R2d.not-all-human-only` and `R2e.human-marker-reason`, after `R2b.done-concrete`, and each failing check adds its `detail` to `reasons`.
- [ ] The failing details use the shapes in section 3, with items collapsed and truncated to 50 characters, and the passing details are exactly the three strings in the section 3 table.
- [ ] `proseDoneAdvisory` ignores criteria with `human_only` true in `count`, `items` and the duplicates only, `doneTotal` and `allProseDone` stay over all DONE items, and `oracleLessAdvisory` is unchanged.
- [ ] A spec with one untagged prose DONE item and one tagged item gets `proseDoneAdvisory(...).allProseDone === false`, so the "every DONE item is loose prose" line is not emitted for it.
- [ ] Without `--lights-out`, a spec that contains a tagged item returns the same one-check `scope` verdict with no warnings as a spec without one (`proseDoneAdvisory` is reached only from the lights-out branch).

### From HOW (behaviour)
- [ ] Without `--lights-out` the verdict is unchanged: one `scope` check, exit 0 (scenario 6).
- [ ] An empty-reason marker exits 1 with a reason containing "with no reason", and the same item draws no R2c refusal (scenario 4).
- [ ] An item that names a phrase only inside an inline code span passes R2c (scenario 5).
- [ ] Items reading "the confirmation dialog closes" and "the inspection log lists the failing check" pass R2c, and "manual confirmation of the layout" fails it (bare nouns do not match).
- [ ] With two untagged prose items and two tagged items, the prose-DONE advisory reports `2 DONE item(s)` and names neither tagged item (the withheld scenario).
- [ ] For a matrix of items (tagged, empty reason, whitespace-only reason, uppercase marker, leading `[ac-N]`, near-miss `[AC-N]`), the set the verdict treats as tagged equals the set `dodClassify` marks `human_only`.

### From HOW (edge cases)
- [ ] A tagged item that contains a listed phrase passes R2c.
- [ ] A spec with no DONE items fails R2a only; R2d and R2e pass.
- [ ] The new checks read item text through `parseLocalAcId` and never call `assignLocalAcIds`, so they add no stderr output of their own (a search of the `admissibleVerdict` body finds no `assignLocalAcIds`).

### Prose, docs and records (each in its own item)
- [ ] `faffter-noon-spec/SKILL.md` gains one paragraph in the self-review that reads the `R2c`, `R2d` and `R2e` reasons, treats each as a `major` finding, and says what to do: tag a person-only item `needs-human: <reason>`, rewrite any other item so a test or command can check it, keep at least one item that is not tagged, and give or drop an empty-reason marker; it re-runs once.
- [ ] `faffter-dark-nlspec/SKILL.md` is unchanged, and its self-review section still inherits the sibling's.
- [ ] `plugin/skills/faff/prose-baseline.json` has the `faffter-noon-spec/SKILL.md` entry raised by the exact byte delta of the edit, and `faff validate-adapters` reports no new FAIL.
- [ ] New prose uses Canadian spelling and no em dashes.

### Tests and repository checks (each in its own item)
- [ ] `test/admissible.test.mjs` gains cases for scenarios 1 to 6, the withheld scenario, the all-tagged refusal, the empty-reason refusal, the code-span exemption and the stderr-quiet requirement.
- [ ] A corpus test over `records/specs` asserts that, over every spec under `records/specs` whether admissible or not, the specs failing R2c are exactly the four named in section 4 (it pins that set of names only and asserts no total counts), that their failing check set is `R2c.human-judgement-untagged` alone, and that R2d and R2e refuse none; a comment in the test states that a new match means tag the item or change the list and this pin together.
- [ ] A test pins the shared-predicate matrix from the HOW items above.
- [ ] A test row per pattern 4 to 7 gives one untagged phrase that fails R2c and the same item tagged that passes (the fourth scenario of the Scenarios section), and a row with "Confirmed by eye" and "Manually verified" fails R2c, so case-insensitivity is exercised.
- [ ] A test with a Scenarios-only spec and no DONE items asserts R2a fails and R2d and R2e pass.
- [ ] A test with an untagged item longer than 50 characters and a second matching item asserts the detail truncates each to 50 characters and joins them with " | ".
- [ ] The literal pattern `needs-human:[ \t]*` appears in exactly one place in `admissibility.js`.
- [ ] `node --test test/admissible.test.mjs test/dod.test.mjs test/faff-1475-human-only-acs.test.mjs test/faff-1475-ac-floor.test.mjs` passes, and `faff admissible --selftest` and `faff dod --selftest` still pass.
- [ ] The full `node --test` suite passes, and `faff regions check` and `faff lint-cli-coverage` pass with no module added.

### Rollout
- [ ] The PR description records the corpus result (4 specs, 7 items refused of 715 admissible) and the four spec names.
- [ ] Before merge, the agent fetches the attached spec of each issue in the current Todo queue from the tracker (the CLI never touches the tracker), pipes each to `faff admissible --lights-out --spec - --json`, and the PR description lists every issue whose spec would now refuse, with the reason; each is tagged or rewritten in the same window, or the list is "none".
- [ ] The PR description states that a queued spec with an untagged listed phrase becomes inadmissible at its next unattended admission, and that the fix is a tag or a rewrite.

### Integration smoke test

```
PROCEDURE smoke():
  1. write S0 (one Given/When/Then scenario, DONE items stating exit codes) to a temp file
  2. run `faff admissible --lights-out --spec S0 --json`; expect exit 0
  3. append the DONE item "the layout is confirmed by eye"; re-run; expect exit 1 and an R2c reason
  4. prefix that item with "needs-human: a designer checks it"; re-run; expect exit 0
  5. replace every DONE item with a tagged one; re-run; expect exit 1 and an R2d reason
```

## 9. APPENDICES

### Appendix A: self-review record

Reviewer: a fresh-reasoning pass inside this producer subagent, against the drafted spec and the repo at origin/main 89387a00, as the dispatched-producer form of the inherited review requires. The findings and their resolutions are returned alongside the spec to the caller and are not repeated here.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized:** No issues. The spec is one concern, lights-out admission refusing untagged human-judgement items, delivered as three checks over one shared marker predicate. The advisory filter and the self-review paragraph only make sense alongside the checks, and the shared predicate is the refactor the checks need. R2d and R2e are trivial next to R2c, but they ship together and splitting them would give no earlier value. It fits a 1 to 3 day unit.
- **Workstream fit:** No issues. It extends the human-only acceptance criteria chain (FAFF-1475, FAFF-1476, FAFF-1478) at the one point that chain does not yet cover, which is admission. The outcome is single: a person-judged item is caught at admission, not at the merge floor after the build. No project container was supplied, so fit is judged from the sibling chain only.
- **Deps surfaced:** One minor gap. The spec says it "follows" FAFF-1476 and FAFF-1478, but only FAFF-1475 is a declared blocker. All three are merged, so nothing can sequence wrongly today. Why it matters: the blocker graph is the record automation reads, and the build relies on all three. What to do: link FAFF-1476 and FAFF-1478 as blockers for provenance, or drop the "follows" wording from the spec. The references to FAFF-1339, FAFF-1419 and FAFF-1432 are deferrals, not dependencies, and need no link.
- **Risk profile:** Two items, both about rollout rather than the build.
  - **Queued Todo specs may be refused at the next unattended admission.**
    - What is there: `graft-admit` re-runs `admissibleVerdict(spec, true)` on every automated run. The spec says so and accepts it. The measured effect (4 of 715 admissible specs, 7 items) comes from the committed specs under `records/specs`. Those are the specs of shipped work. A spec attached to a Todo issue is likely not committed yet, because graft commits the spec to the feature branch. I have not verified where attached specs live, so treat this as a question, not a finding. If it holds, the 4-of-715 figure says nothing about the current queue.
    - Why it matters: an overnight run meets the refusal with nobody to tag the item. The queued work stalls until a human reads the reason in the next `/faff-wtf`. The cost is a stalled queue, not a wasted build, because the refusal lands before any build spend. It is also fully recoverable (tag or rewrite), so severity is low to medium.
    - What to do: before merge, scan the attached specs of the current Todo queue with the new checks and list any that would refuse in the PR description. The agent fetches them from the tracker, since the CLI never touches the tracker. Fix or tag those specs in the same window. Also confirm that an `inadmissible` result does not produce a repeat-park diagnostic on every nightly pass. The spec's Rollout items state the effect but do not ask for the queue scan.
  - **The pattern grammar in section 3 is under-specified.**
    - What is there: the list reads "manual verification | confirmation | inspection" and "confirm | check | verify | review (any ending)". It is unclear whether bare "confirmation" or "inspection" matches, or only forms with "manual" or "visually" in front. Bare nouns would hit machine-checkable items such as "the confirmation dialog closes".
    - Why it matters: this is the over-match failure the spec itself names. The corpus pin only proves the list matches what it was measured against, and a vague grammar lets the build agent pick a reading that happens to fit the corpus.
    - What to do: write each phrase family as its literal regular expression in the spec, and add a test row for one machine-checkable item per noun form ("confirmation dialog", "inspection log") that must pass R2c.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
