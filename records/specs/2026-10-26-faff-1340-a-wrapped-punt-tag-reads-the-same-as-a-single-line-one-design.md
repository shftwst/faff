# FAFF-1340: a wrapped Punt marker reads the same as a single-line one

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1340.

This is the buildable spec for FAFF-1340. Its audience is the build agent that will implement the change and the human reviewers who gate it. It fixes one defect in `plugin/skills/faff/bin/lib/punt-scan.js`: the scanner reads a `**Punt:**` marker one physical line at a time, so a line wrap changes what the marker means.

## 1. WHY: Problem and Principles

**The mechanism this turns on.** `puntScan` takes the text after the `**Punt:**` tag on that one physical line as the whole marker. A `(non-blocking)` or `(decides: ...)` suffix carried onto the next line is therefore never seen, and the topic is cut at the wrap. Every spec producer wraps prose, so where the line breaks decides the reading.

**Problem statement.** The same Punt words yield different results depending on where a newline falls: a wrapped suffix is lost and a wrapped topic is truncated. The result feeds `blocking_open_count`, which drives the routing verdict and the producer's high-versus-medium self-rating, so a wrap can park a settled spec. This change makes a marker read as its whole logical line.

**Direction of the defect.** Every wrap error is fail-safe. A wrap can only hide a `(non-blocking)` tag or shorten a topic, and both make a Punt look more blocking. Topic truncation can only lose a crossref match, because `slugTokenRunContains` is a token-run containment test and a longer topic can only gain matches. That same monotonicity is the hazard of the fix: a topic that absorbs too much can gain a crossref it should not have, just as an absorbed line can lend a `(non-blocking)` tag. Eligibility needs both facts, so over-absorption is the one unsafe direction, and the terminator set below is the boundary that matters.

**Design principles.**

- **Eligibility does not move.** A Punt is eligible only when it carries a bare `(non-blocking)` tag and its topic names an OUT OF SCOPE item. Both are still required. An untagged or un-crossreferenced Punt is still blocking. A fix that widened this would reintroduce the wave-through loophole FAFF-1078 closed.
- **The terminator set is the safety boundary.** An over-greedy continuation could absorb a `(non-blocking)` from an unrelated following paragraph and wave a genuinely blocking Punt through. When a line is in doubt, it ends the continuation. Ending early only ever makes a Punt look more blocking, which is the safe direction.
- **Pure and deterministic.** `punt-scan.js` is a `region:factory` module: no tracker, no network, no clock, same bytes in, same result out. That is preserved.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/punt-scan.js` | JavaScript (committed, no `.ts` sibling) | The only file with the defect: `PUNT_LINE_RE` at line 25 and the per-line loop at line 79 |
| `test/punt-scan.test.mjs` | JavaScript | Existing tests for the module and its CLI; gains the wrap property test |
| `docs/guide/cli.md` (the `punt-scan` row) | Markdown | Documents the scanner's input; gains one sentence on logical lines |
| `plugin/skills/faffidavit-routing/SKILL.md`, `faffter-noon-spec/SKILL.md`, `faffter-dark-nlspec/SKILL.md` | Markdown | Consumers of `blocking_open_count`; read the scanner's output only, so they need no change |

Boundary verified at prep time: `PUNT_LINE_RE` is the only anchored bold-marker line regex under `plugin/skills/faff/bin/lib/`. `**Chosen:**` and `**Assumes:**` have no code extractor, so no sibling parser shares the line scoping.

**Scope statement.** This is the continuation-aware half of the scanner's input handling; the list-item half is FAFF-1351, on the same regex and loop.

## Already shipped against this surface

- FAFF-1078 (Done) introduced `faff punt-scan`, the two-fact eligibility rule, and the routing and self-rating consumers. It defined the scanner's input as a single physical line. This change extends the input handling only; the premise (a wrapped Punt is misread) is not delivered by it.
- FAFF-1351 (Backlog) widens the same recogniser to list-item Punts. It is a collision group with this ticket and is composed with below.

## 2. OUT OF SCOPE

- **Loosening eligibility** — the two-fact rule and the fail-safe direction stay exactly as FAFF-1078 set them. Why excluded: a wider rule is the wave-through the module exists to prevent. Extension point: `puntScan`'s `eligible` line, unchanged.
- **Recognising a list-item Punt** — a Punt written as `- **Punt:**`. Why excluded: that is FAFF-1351's half. Extension point: the Punt-start recogniser in `punt-scan.js`, composed with below.
- **A post-attach read-back of the stored spec body** — checking what landed on the tracker. Why excluded: `prepcheck` attests that attach happened, never what landed, and the ticket records this as evidence only. Extension point: a future issue on `faff prepcheck`, filed only if the post-landing re-evaluation in Section 7 fails.
- **A wrap inside the tag token itself** — a hyphen break splitting `(non-blocking)`. Why excluded: producers wrap at spaces, and a split tag reads as untagged, which is the safe direction. Extension point: `NON_BLOCKING_RE`.
- **Sibling extractors for `**Chosen:**` and `**Assumes:**`** — none exist in code. Why excluded: the spec-readiness fold is model-facing prose, and a model reader sees a logical line natively. Extension point: none needed.

## 3. WHAT: Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Logical line | A Punt tag's first-line remainder plus every directly following physical line up to, but not including, the first terminator line |
| Terminator line | A physical line that ends a logical line and is never absorbed into it |
| Continuation line | A physical line absorbed into a logical line |

**Interfaces.** No signature changes. `puntScan(specText)` still returns `{ punts: [{ topic, decides, non_blocking, out_of_scope_crossref, eligible }], eligible_count, blocking_open_count }`, with `eligible_count + blocking_open_count == punts.length`. `PUNT_SCAN_CASES`, `cmdPuntScan`, and the exports are unchanged in shape; `PUNT_SCAN_CASES` gains rows.

**Terminator set.** A physical line is a terminator when it matches any one of:

| Terminator | Matches | Why |
|---|---|---|
| Blank line | empty or whitespace only | Named by the ticket; ends a paragraph |
| Heading | `^\s*#+` followed by whitespace or end of line | Named by the ticket |
| Next marker | a line starting, after optional leading whitespace, `**Punt:**`, `**Chosen:**`, `**Decision:**`, or `**Assumes:**` | Named by the ticket; `Decision` is the contract's alias for `Chosen` |
| Bold-led line | a line starting, after optional leading whitespace, with `**` followed by a non-space character | Spec prose is dense with bold labels (`**Rationale:**`, `**The failure:**`); a wrapped Punt never continues with a bold label, so ending there only errs toward blocking |
| Fence | a line opening or closing a code fence (three or more backticks or tildes) | Code is not prose continuation |
| List-item opener | a line starting a bullet (`-`, `*`, `+`) or numbered (`1.` or `1)`) item | A list can interrupt a paragraph in markdown, and a neighbouring item must never lend its tag |
| Block quote | a line starting `>` | A separate block |
| Table row | a line starting `\|` | A separate block |
| Thematic break | `---`, `***`, or `___` runs, spaces allowed | A separate block |

Every row that matches at line start allows leading whitespace, as `PUNT_LINE_RE` does, so an indented marker is a terminator too. The first three rows are decided by the ticket. The last six are added here because each only ever ends a continuation earlier, which can only make a Punt look more blocking.

## 4. HOW: Behavior

**Behaviour summary.** For each line that starts a Punt, join it with its continuation lines into one logical line, then run the existing suffix, topic, and crossref extraction on that joined text exactly as before.

```
PROCEDURE scan_punts(lines):
  1. FOR i FROM 0 WHILE i < len(lines):
     a. IF NOT starts_a_punt(lines[i]): i += 1; CONTINUE
     b. rest := text after the Punt tag on lines[i]        # may be empty
     c. j := i + 1; parts := [rest.trim()]
     d. WHILE j < len(lines) AND NOT is_terminator(lines[j]):
          parts.append(lines[j].trim()); j += 1
     e. logical := join the non-empty parts with a single space
     f. extract non_blocking, decides, topic, crossref, eligible from logical
          # byte-for-byte the existing extraction, unchanged
     g. record the marker; i := j                            # the terminator is re-examined, not consumed
  2. RETURN the result with the unchanged counts
```

Step g is load-bearing: the terminating line is handed back to the loop, so a following `**Punt:**` starts its own marker. Adjacent Punts stay two markers.

**Start recogniser.** The start regex changes `(.+)` to `(.*)`, so a tag alone on its line, with the topic on the next, is a Punt. Before, such a tag was invisible; now it is a marker whose topic comes from the continuation. An empty-topic marker is counted blocking, never eligible, which is the safe direction.

**Joining.** Each absorbed line is trimmed and joined with one space. A space join keeps a split `(decides:` and its value matching `DECIDES_RE`, because that regex allows whitespace after the colon.

**Length of a Punt.**

**Chosen:** the continuation is not capped at two lines; it runs to the first terminator. Rationale: a cap re-creates this exact defect at line three, and the terminator set already bounds the reach with a deterministic rule. A cap would add a second boundary that nobody can predict from the prose.

**Single-line behaviour.** A Punt followed immediately by a terminator, which includes every case in the existing table, reads identically to before. The first Punt that absorbs a line is the only behavioural change.

**Composition with FAFF-1351 (list-item Punts).** The two tickets edit the same regex and loop, and will be built serially in an order this spec cannot know. FAFF-1351 defines two helpers, `matchPuntStart(line)` and `opensListItem(line)`, built from one list-prefix fragment. The rules below make either order correct.

**Chosen:** the builder's first act is to open `punt-scan.js` and look for a list-item recogniser from FAFF-1351, expected as `matchPuntStart` and `opensListItem`. Two branches follow. Rationale: the order is not knowable from here, and a branch the builder can evaluate in one grep is cheaper than a hard ordering that blocks one ticket on the other.

- **FAFF-1351 has not landed** (neither helper exists): implement everything above with a local `LIST_ITEM_OPENER_RE` for the list-item row and a local start regex. Add a one-line comment on the list-item row stating that FAFF-1351 replaces it with `opensListItem`. Do not write listed-Punt rows; they cannot pass yet.
- **FAFF-1351 has landed** (the helpers exist, under those names or any other): do not restate the marker rule or the list rule. Start the loop from `matchPuntStart`, make the list-item row call `opensListItem`, and make the next-marker row call `matchPuntStart` so a listed Punt is a terminator too. Reuse whatever names it landed under, and never leave a second list-item rule beside it. Then add the three combined rows listed under Scenarios.

Either way the terminator contract is the table above, which is the same contract FAFF-1351's spec states: blank, heading, next Punt (listed or not), a Chosen or Assumes marker (listed or not), or any list-item opener.

**Edge cases.**

- A continuation line beginning with an ASCII hyphen and a space (a hyphen used as a dash after a wrap) reads as a list-item opener and ends the logical line. That makes the Punt look more blocking, which is the safe direction, and it is the known price of the list-item terminator.
- A `**Punt:**` inside a fenced block is still matched as today; only the continuation stops at a fence line. This is unchanged behaviour for the start, and a deliberate non-change.
- CRLF input: the existing split on `\r?\n` is kept, so a wrapped CRLF Punt reads the same as an LF one.
- A continuation line that is only whitespace is a blank terminator, never a part.
- A Punt that absorbs a long paragraph keeps a long topic. Its eligibility is unaffected unless the paragraph itself contains a bare `(non-blocking)`, which is the residual risk named below.

**Failure modes: how the approach falls over, and how you would notice.**

- **The failure:** a Punt directly followed, with no blank line, by an unrelated line that is not a terminator and that contains a literal `(non-blocking)`. The scanner would absorb the tag. **How you'd know:** a corpus differential shows a file whose `eligible_count` rose with no wrapped tag in sight. **What it means:** tighten the terminator set for that line shape. Measured at prep time over all 901 files in `records/specs/`: the new reading differs on 2 files, both only extending a topic across a soft wrap, and neither changes a count. No file gains an eligible Punt.
- **The failure:** a blocking Punt that carries its own `(non-blocking)` tag on its first line, directly followed by an ordinary prose sentence, with no blank line, that names an OUT OF SCOPE item. Absorbing the sentence grows the topic until the crossref matches, and the Punt becomes eligible with no tag on a continuation line. **How you'd know:** the corpus differential shows a file whose `eligible_count` rose where the tag was on the first line. **What it means:** if the lending line has a structural shape (a block, label, or marker), tighten the terminator set for it before merge. If it is ordinary prose in the same paragraph, no terminator can end it without reverting the fix, because a legitimate wrapped topic (the OUT OF SCOPE name split across the wrap) looks identical to the scanner; the reviewer reads each flagged file and tag honesty stays the spec-review lens's call, as before.
- **The failure:** the new start regex counts a bare tag line that was previously invisible, raising a count. **How you'd know:** the same corpus differential shows a count change. **What it means:** none was found; any found would be a real Punt that was hidden, and counting it blocking is correct.

**Anti-pattern:** absorbing every following non-blank line without a terminator set. Why: that is the over-greedy parse the ticket names as the one way this fix regresses FAFF-1078.

**Anti-pattern:** editing the eligibility line, the OUT OF SCOPE extractor, or the suffix regexes. Why: eligibility is not part of this ticket, and the extraction already works on a joined string.

## 5. SCENARIOS

```
Given a spec with an OUT OF SCOPE item "Scrub asymmetry" and a Punt tagged (decides: architecture) (non-blocking)
When the Punt is wrapped so both tags sit on a second physical line, at any space where the continuation line does not itself start with a terminator (a leading hyphen, >, |, #, or a numbered-list opener ends the logical line by design)
Then punt-scan reports the same topic, decides, non_blocking, out_of_scope_crossref, and eligible as for the single-line Punt
```

```
Given the same OUT OF SCOPE item and a Punt whose topic names it, with the OUT OF SCOPE name split across the wrap
When punt-scan runs
Then out_of_scope_crossref is true and the Punt is eligible, as it is when unwrapped
```

```
Given a Punt with no (non-blocking) tag, then a blank line, then a separate paragraph containing "(non-blocking)"
When punt-scan runs
Then non_blocking is false and the Punt counts as blocking, so the following paragraph's tag is not absorbed
```

```
Given a Punt with no tag, directly followed by a Chosen marker line carrying "(non-blocking)", with no blank line between
When punt-scan runs
Then non_blocking is false and blocking_open_count is 1
```

```
Given a Punt tag alone on its line, with the topic and a (non-blocking) tag on the next line, and a crossref to an OUT OF SCOPE item
When punt-scan runs
Then it reports one marker with that topic and the Punt is eligible
```

```
Given an untagged Punt directly followed, with no blank line, by a block quote, a table row, a fence line, a thematic break, a Decision marker, an indented Chosen marker, or a bold-led Rationale line, each carrying (non-blocking)
When punt-scan runs for each
Then the Punt is blocking every time, because each of those lines ends the logical line
```

- A wrapped, untagged, un-crossreferenced Punt still counts as blocking: the tag requirement and the crossref requirement are both still enforced.

## 6. DESIGN DECISION RATIONALE

**What is the unit a marker is read over?**

- Options: the physical line (today), a fixed two-line window, or the logical line up to a bounded terminator set.
- **Chosen:** the logical line up to a bounded terminator set. Rationale: the ticket's Expected section says reading is determined by content, not by where the producer broke the line. A fixed window moves the bug to the line after it.

**How far does a continuation reach?**

- **Chosen:** unbounded within the terminator set, with no line cap. Rationale: see Section 4. A cap is a second, unpredictable boundary.

**Which lines end a continuation?**

- **Chosen:** the ticket's three plus bold-led line, fence, list-item opener, block quote, table row, and thematic break. Rationale: each of the added six ends a continuation earlier, which can only add a blocking Punt. They remove a way for a neighbouring block to lend its tag, at no cost in the safe direction.

**Does a bare tag with the topic on the next line count?**

- **Chosen:** yes, by changing `(.+)` to `(.*)`. Rationale: it is a wrap placed immediately after the tag, and ignoring it would be the same defect in another place. An empty-topic marker is blocking and never eligible.

**Where does the change live?**

- **Chosen:** only inside `punt-scan.js` and its table, test, and CLI-doc row. Rationale: no other extractor shares the line scoping, and the consumers read the scanner's output only.

**How to compose with FAFF-1351?**

- **Chosen:** the two-branch builder instruction in Section 4. Rationale: the build order is unknown, and the branch is decided by one grep.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket's one open design question (does a Punt span more than two lines) is closed in Section 4. The post-landing re-evaluation is a non-gating follow-up: after this ships, re-fetch one attached spec body and confirm `punt-scan` reads it identically to its source. If it does, the "verify what landed" concern is closed with no ticket. If it does not, file a ticket then and first ask whether the re-wrap is Linear's own markdown normalisation or something in faff's write path.

**Assumes:** `punt-scan.js` still has no `.ts` sibling and `PUNT_LINE_RE` is still the single anchored bold-marker line regex under `bin/lib/`. Validation: before starting, list `plugin/skills/faff/bin/lib/punt-scan.*` and grep that directory for `\*\*Punt`; if a `.ts` sibling exists, follow the emit-rebuild rule in `AGENTS.md`.

**Assumes:** `faff regions` still runs `punt-scan --selftest` and classifies the module `factory`. Validation: run `faff regions selftest --region factory` before and after.

## 8. DONE: Definition of Done

### From WHY
- [ ] The wrapped repro in the ticket (the Punt wrapped after "ticket", tags on line two) yields `{topic, decides: "architecture", non_blocking: true, out_of_scope_crossref: true, eligible: true}`, identical to the single-line form, with `eligible_count` 1 and `blocking_open_count` 0.
- [ ] The eligibility line in `puntScan` is unchanged: a wrapped Punt lacking the tag, or lacking the crossref, is still blocking.

### From WHAT
- [ ] A line is a terminator for each of the nine rows of the terminator table. A table-driven selftest row set takes one untagged Punt directly followed by a line of each kind carrying `(non-blocking)` and proves the Punt stays blocking: blank line then paragraph, heading, `**Punt:**`, `**Chosen:**`, `**Decision:**`, `**Assumes:**`, an indented `**Chosen:**`, a bold-led line such as `**Rationale:**`, a fence line, a list-item opener, a block quote, a table row, and a thematic break.
- [ ] `puntScan`'s return shape and the exports of `punt-scan.js` are unchanged, and `eligible_count + blocking_open_count == punts.length` holds on every row.

### From HOW (behaviour)
- [ ] A wrapped-tag row, a wrapped-topic (crossref across the wrap) row, and a three-line-span row each read identically to the unwrapped Punt.
- [ ] A row where a following paragraph after a blank line carries `(non-blocking)` shows `non_blocking: false` for the Punt before it.
- [ ] A row where a `**Chosen:**` line carrying `(non-blocking)` directly follows a Punt without a blank line shows the Punt still blocking.
- [ ] Two adjacent Punts with no blank line between them read as two markers.
- [ ] A bare `**Punt:**` tag with its topic on the next line reads as one marker with that topic.
- [ ] A wrapped Punt in CRLF input reads identically to the LF form.
- [ ] Taking the ticket's repro Punt as the text, wrapping it at every space, with each of three separators (`\n`, `\r\n`, `\n` plus two spaces), yields a result identical to the single-line form. That text has no wrap point whose continuation starts with a terminator, so the property holds unconditionally for it; a test text that does have one must exclude those points, as Scenario 1 does.

### From HOW (composition and corpus)
- [ ] After the change, `punt-scan.js` holds exactly one rule for what opens a list item. The builder recorded which FAFF-1351 branch applied, in the PR description. If FAFF-1351 had landed, the list-item row calls `opensListItem`, the next-marker row calls `matchPuntStart`, and the three combined rows pass: a listed Punt wrapped with its tags on line two reads identically to the single-line form, a listed Punt followed by a listed Chosen line carrying `(non-blocking)` does not absorb it, and two adjacent listed Punts stay two markers.
- [ ] Obtain the old scanner from the base commit (`git show <base>:plugin/skills/faff/bin/lib/punt-scan.js` into a temporary file), then run the old and new scanner over every file in `records/specs/`: every file whose `eligible_count` rises is named in the PR description with a statement of which fact the continuation supplied: a tag on a continuation line, or a crossref created by absorbed text. A rise whose tag sat on the Punt's first line is an over-absorption finding: it blocks merge until the terminator set is tightened for a structural shape, or until a reviewer records that the lending line is ordinary same-paragraph prose. Assert the corpus holds more than zero files before trusting a clean run.

### From docs
- [ ] The `punt-scan` row in `docs/guide/cli.md` states that a marker is read over its logical line, with the terminator set named.

### Repository checks
- [ ] `test/punt-scan.test.mjs` passes and holds the wrap-at-every-space property test.
- [ ] `faff punt-scan --selftest` and `faff regions selftest --region factory` pass.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Write a spec with an OUT OF SCOPE item "Scrub asymmetry" and the ticket's Punt on one line.
  2. Run faff punt-scan; record the JSON.
  3. Rewrite the file with a newline after "ticket" and both tags on line two.
  4. Run faff punt-scan again.
  5. ASSERT the two JSON outputs are byte-identical.
  6. Insert a blank line and a paragraph containing "(non-blocking)" after an untagged Punt.
  7. ASSERT that Punt reports non_blocking false.
```

**Rating note.** No open Punt remains and every decision is closed with its reasoning. The one moving part is the build-order interaction with FAFF-1351, handled by a two-branch builder instruction rather than left open. The change is one file, one regex, and one loop, with a table-driven test.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized: No issues.** One concern (the scanner's input unit), one file plus its table and test, a sub-day unit.
- **Merge candidate surfaced, not recommended (principle 4).** FAFF-1351 edits the same regex and loop. They do not always ship together: that one is Urgent and fail-open, this one is High and fail-safe, and each is independently valuable. Merge-versus-serialise is left to the operator; the spec composes either way.
- **Workstream fit: No issues.** Both tickets are project-less Backlog work with one outcome (the scanner reads a Punt by its content); too little sibling work to justify a project.
- **Dependencies (principle 6): one implicit coupling.** The two are linked only as related, yet the later one must adopt the earlier one's helpers. The two-branch instruction makes either order safe. A blocker edge from FAFF-1351 to FAFF-1340 would make it deterministic and put the Urgent fix first.
- **Risk profile (principle 7): low.** The change is bounded by a deterministic terminator set and measured against 901 committed specs with no count rising. No de-risking spike is warranted.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
