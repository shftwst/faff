# FAFF-1351: punt-scan reads a Punt marker written as a list item

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1351.

This is the buildable spec for FAFF-1351. Its audience is the build agent that will implement the change and the human reviewers who gate it. It fixes one defect in `plugin/skills/faff/bin/lib/punt-scan.js`: the scanner cannot see a Punt marker written as a list item, so a blocking human decision reads as `blocking_open_count: 0`.

## 1. WHY: Problem and Principles

**The mechanism this turns on.** `puntScan` decides which lines are Punt markers with one anchored regex, applied once per physical line. The regex permits leading whitespace but not a list marker, so a Punt written as a list item is not mis-parsed or truncated, it is invisible. Everything downstream (the routing verdict and the producer confidence self-rating) consumes only the count, so an invisible Punt is a Punt that does not exist.

**Problem statement.** A spec whose only open decision is a listed Punt reports `blocking_open_count: 0`, can self-rate `high`, and routes `fire-and-forget`, so an autonomous run builds on a decision that was explicitly escalated to a human. This is fail-open on an autonomy gate, the opposite direction from FAFF-1340 on the same regex, which only ever over-parks. This change makes the scanner recognise a Punt marker whatever list form the author used to write it.

**Measured on the working tree** (every spec under `records/specs/`, the configured spec docs path; there is no `docs/specs/` directory in this tree):

| Shape | Lines |
|---|---|
| Line-start Punt, which the scanner sees today | 62 |
| Dash-bulleted Punt, which it cannot see | 81 |
| Of those 81, lacking the bare `(non-blocking)` tag | 78 |
| Specs whose reading changes after the fix | 56 |

The ticket quotes 63 untagged, which counted any "non-blocking" wording; the bare-tag count that eligibility actually uses is 78, and it changes nothing about the fix. Every one of the 81 is dash-bulleted at column zero. No star, plus, ordered, or nested Punt exists in the corpus today, which is why those forms are specified and tested here rather than discovered later.

**Design principles.**

- **Widening recognition can only add blocking Punts, never remove one.** A newly visible Punt is either eligible (the `eligible_count` rises and `blocking_open_count` is untouched) or blocking (it rises by one). The change is therefore fail-safe-ward in the only direction it can move, which is the property that makes it safe to ship on an urgent timeline. A change that could lower `blocking_open_count` for an existing input would overreach.
- **The list prefix is presentation, the Punt is content.** Markdown treats a listed paragraph and a plain one as the same content. A listed Punt and the same words without the prefix must produce a byte-identical `PuntScanResult`. This is the property the whole change is tested against.
- **State the recognition rule once.** One named recogniser, one regex, tested per form. No second place in the module re-derives what a Punt line looks like.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/punt-scan.js` | Node (CommonJS) | The only file whose logic changes: `PUNT_LINE_RE`, the per-line loop in `puntScan`, and the `PUNT_SCAN_CASES` selftest table |
| `test/punt-scan.test.mjs` | Node test runner | The existing 17-test file; new per-form tests go here |
| `plugin/skills/faff/bin/lib/regions.js` | Node (CommonJS) | Already registers `punt-scan` as `region:factory` and runs its `--selftest`; no edit needed |
| `docs/guide/cli.md` (the `punt-scan` row) | Markdown | Defines the scanned unit as a `**Punt:**` item; gets one clause naming the accepted list forms |
| `plugin/skills/faffidavit-routing/SKILL.md`, `faffter-noon-spec/SKILL.md`, `faffter-dark-nlspec/SKILL.md` | Markdown | Consumers of `blocking_open_count`; read-only here, and must not need editing |
| FAFF-1340 | Backlog ticket | Fixes the wrapped-continuation case in the same regex and loop; the two are one collision group |

**Scope statement.** This is the scanner's input predicate: which physical lines open a Punt marker. What the scanner does with a Punt once found is unchanged.

## 2. OUT OF SCOPE

- **Continuation lines of a wrapped Punt.** Why excluded: that is FAFF-1340's half, and it is specified separately. Extension point: the continuation logic in `puntScan`, composed through the recogniser defined below.
- **Widening the OUT OF SCOPE item extractor to other list markers.** Why excluded: it moves in the opposite direction from this change. More OUT OF SCOPE keys can only make more Punts eligible, which is a loosening, so it needs its own ticket and its own review. A Punt written with a star bullet under a dash-bulleted OUT OF SCOPE section simply fails the crossref and stays blocking, which is the fail-safe direction. Extension point: `extractOutOfScopeItemKeys`.
- **Task-list checkboxes and blockquote prefixes.** Why excluded: no occurrence in the corpus, and the meaning is not content-neutral (a checked box or a quoted Punt is plausibly a resolved or echoed one). The accepted forms are exactly the CommonMark list-item markers. Extension point: the prefix group in the recogniser.
- **Skipping fenced code blocks.** Why excluded: today's scanner already counts a line-start Punt inside a code fence (the FAFF-1078 spec's own examples read as three blocking Punts), and skipping fences would lower counts, the unsafe direction. Extension point: a fence-state flag in the `puntScan` loop.
- **Any consumer.** Why excluded: the counts are correct given what the scanner sees; no routing, producer, or review prose should need editing, and a fix that edits one has overreached. Extension point: none.
- **Extractors for Chosen and Assumes markers.** Why excluded: none exists in code; they are model-read prose. Extension point: none.
- **Re-prepping specs already attached.** Why excluded: the 56 affected specs will re-read as more blocking the next time routing or tidy scans them, which is the intended correction; no backfill is needed. Extension point: none.

## 3. WHAT: Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| list-item prefix | One list marker followed by whitespace: a bullet (`-`, `*`, or `+`), or an ordered marker (one to nine digits then `.` or `)`) |
| Punt start | A physical line whose first non-prefix content is the bold token `**Punt:**`, optionally preceded by any indentation and one list-item prefix |
| remainder | The text after the bold token on a Punt-start line, which is what suffix and topic parsing already consume |

**Interfaces.** The `PuntScanResult` and `PuntMarker` records, the CLI surface, and exit codes are unchanged. One new module-internal function is exported for composition and testing:

```
FUNCTION matchPuntStart(line) -> String | null   # exported JS identifier
  # returns the remainder when the line is a Punt start, else null
  # stateless: it looks at one line only
```

The list-marker rule is written once, as a named source fragment, and the Punt-start regex is composed from it:

```
const LIST_ITEM_PREFIX = "(?:[-*+]|\\d{1,9}[.)])\\s+";
const PUNT_LINE_RE = new RegExp("^\\s*(?:" + LIST_ITEM_PREFIX + ")?\\*\\*Punt:\\*\\*\\s*(.+)$");
```

`LIST_ITEM_PREFIX` stays module-local and is the only place the marker rule is written; a continuation-aware parse added later in this same file (FAFF-1340) builds its "this line opens a list item" test from it rather than restating the rule. `matchPuntStart` is stateless and looks at one line only. Nothing else is exported, so no unused API surface is added.

The leading `\s*` sits outside the capture group, so indentation never reaches the remainder; that is how a nested item (a Punt indented under a parent item) is recognised with no extra construct and why it yields the same topic as its flush-left twin. Because the prefix group is optional and the next token must be a literal `**`, a bare line-start Punt still matches exactly as before.

**The seven accepted forms, enumerated once** (every test, selftest row, and DONE item below refers to exactly these strings as the text placed before the bold token):

| Form | Text before the bold token |
|---|---|
| dash | `- ` |
| star | `* ` |
| plus | `+ ` |
| ordered dot | `1. ` |
| ordered paren | `2) ` |
| nested dash | four spaces then `- ` |
| nested ordered | two spaces then `1. ` |

**Design decisions.**

**Which list forms count?**
- Only the dash: closes the 81 known cases but leaves star, plus, and ordered Punts invisible, the same fail-open hole at lower incidence.
- All CommonMark list-item markers, stated once: closes the whole class, costs one alternation.
- **Chosen:** all of them. Dash, star, plus, ordered with `.` and with `)`, at any indent. Rationale: markdown renders them as the same content, the change can only add blocking Punts, and the ticket's own answer was "probably all, stated once and tested per form".

**Where does recognition live?**
- Widen the regex in place: smallest diff, but FAFF-1340 must then edit the same line and re-derive the rule to decide where a continuation stops.
- A named function both fixes call: one definition of "what opens a Punt".
- **Chosen:** extract `matchPuntStart`, built from the one module-local `LIST_ITEM_PREFIX` fragment, and have the `puntScan` loop call it. Rationale: the two tickets collide on exactly this line, and a shared seam turns a textual merge conflict into a call-site, so whichever lands second reuses the definition instead of redefining it. A second exported helper for the list-item test was rejected: with no caller in this change it would be unused API surface, and the named fragment already keeps the rule in one place for the next ticket to compose from.

## 4. HOW: Behaviour

**Behaviour summary.** For each physical line, ask `matchPuntStart`; a non-null remainder opens a Punt, and everything after that point (suffix tags, topic, slug, crossref, eligibility) runs on the remainder exactly as it does today. The list prefix is consumed by the recogniser and never reaches the topic, so a listed Punt and its de-prefixed twin are indistinguishable downstream.

```
PROCEDURE punt_scan(spec_text):
  1. oos_keys := extract_out_of_scope_item_keys(spec_text)     # unchanged
  2. FOR each physical line in spec_text:
       rest := matchPuntStart(line)
       IF rest is null: continue
       parse non_blocking, decides, topic, crossref, eligible   # unchanged
       append PuntMarker
  3. RETURN counts                                              # unchanged
```

**Composition with FAFF-1340 (wrapped continuation).** The two tickets are a collision group and will be built serially in one run, in an order this spec cannot know. The recogniser is the shared seam, and the rules below make either order correct.

- **Chosen:** the builder's first act is to open `puntScan` and look for continuation handling (any code that joins a following physical line into `rest`). Two branches follow.
  - **FAFF-1340 has not landed** (the loop is single-line): implement everything in this spec, leave the loop single-line, and put a short code comment at `matchPuntStart` stating the contract a continuation-aware parse must honour (below). Do not write wrapped-listed rows; they cannot pass yet. A wrapped listed Punt whose tags sit on line two reads as untagged, which is fail-safe.
  - **FAFF-1340 has landed**: its continuation terminator must also be list-aware. Make it stop at any line that starts with `LIST_ITEM_PREFIX` after optional indentation, and make its next-marker check call `matchPuntStart`; it must not restate the marker rule. Then add the three combined rows listed in the selftest below.
- **The contract for any continuation parse, stated here so it holds in both orders.** A Punt's continuation ends at a blank line, a heading, the next Punt start (listed or not), a Chosen or Assumes marker (listed or not), or any line that opens a list item. The last item matters because a list can interrupt a paragraph in markdown, and absorbing a neighbouring item could pull a `(non-blocking)` tag from an unrelated decision onto a blocking one, which is the exact wave-through FAFF-1340 names as its regression risk.

**Selftest rows (new entries in the `PUNT_SCAN_CASES` table).** Each row asserts the full marker, not just a count.

| Row | Input shape | Expected |
|---|---|---|
| dash bullet | a dash-listed Punt, no tags | one blocking Punt, topic equals the text after the token |
| star bullet | the same, star | identical marker |
| plus bullet | the same, plus | identical marker |
| ordered dot | a Punt behind `1.` | identical marker |
| ordered paren | a Punt behind `2)` | identical marker |
| nested dash | a Punt behind four spaces then `- ` | identical marker |
| nested ordered | a Punt behind two spaces then `1. ` | identical marker |
| ten digits | a Punt behind a ten-digit ordered marker | no Punt |
| listed and eligible | a listed Punt with the bare tag and an OUT OF SCOPE crossref | eligible, `blocking_open_count` 0 |
| listed, tag order | listed `(decides:)(non-blocking)` and `(non-blocking)(decides:)` | identical markers |
| the ticket repro | two listed untagged Punts | `blocking_open_count` 2 |
| inline mention | a listed Chosen line that mentions a Punt mid-line | no Punt |
| backticked | a line that wraps the token in backticks | no Punt |
| listed Chosen | a listed Chosen marker | no Punt |

When FAFF-1340 has landed, three further rows: a listed Punt wrapped with its tags on line two reads identical to the single-line form; a listed Punt followed by a listed Chosen line carrying `(non-blocking)` does not absorb it; two adjacent listed Punts stay two markers.

**Tests (in `test/punt-scan.test.mjs`).** One parametrised test over the seven forms in the table above, each exactly as written there: for a body carrying both suffix tags and an OUT OF SCOPE crossref, `puntScan(form + body)` deep-equals `puntScan(body)`, which covers both nested forms against the byte-identical invariant. The twin is defined once: the same body with **all** text before the bold token removed, list marker and indentation both, so the comparison is always against the flush-left bare line. One test that `matchPuntStart` returns the remainder without the prefix or the indentation. One test pinning the ticket repro through the CLI on a temp file.

**Edge cases.**

- A bare line-start Punt: matches exactly as before (the prefix group is optional).
- A prefix with no following whitespace (a dash fused to the bold token): not a list marker in markdown, not recognised; this equals today's behaviour and is not asserted either way.
- An ordered marker of ten or more digits: not a list marker; not recognised.
- The star bullet and the bold token both begin with a star: the prefix requires whitespace after its marker, so the bold token is never consumed as a marker.
- Regular-expression cost is linear; no nested quantifier overlaps.

**Failure modes.**

- **The failure:** the corpus-wide shift is larger than the author expects, and some run reads a flood of newly blocking specs as a regression. **How you'd know:** `blocking_open_count` rises across the 56 specs listed above, and previously `fire-and-forget` specs route `needs-decision-first`. **What it means:** proceed. That is the correction, not a regression: those Punts were always open, and each is a real unresolved decision the scanner was hiding.
- **The failure:** FAFF-1340 lands second and rewrites the loop without the list-aware terminator. **How you'd know:** the combined rows above fail, or a listed Punt absorbs a neighbour's tag. **What it means:** the later builder applies the contract stated in this section; the seam makes that a call-site change.

**Anti-pattern:** editing a consumer (routing, either producer's self-rating rule) to compensate. Why: the counts are right given what the scanner sees; the input predicate is what was wrong.

**Anti-pattern:** widening the OUT OF SCOPE extractor in the same change. Why: it is a loosening in the unsafe direction and hides inside a fix that is otherwise strictly fail-safe.

## 5. Scenarios

```
Given a spec file whose only open decisions are two dash-listed Punt lines with no tags
When `faff punt-scan` is run on it
Then it reports two Punts and blocking_open_count equal to 2, where it reported none before
```

```
Given the same Punt text written once as a plain line and once behind each list form
When `faff punt-scan` is run on each file
Then all of the outputs are byte-identical
```

```
Given a spec with an OUT OF SCOPE item and a listed Punt tagged non-blocking whose topic names that item
When `faff punt-scan` is run on it
Then the Punt is eligible and blocking_open_count is 0
```

## 6. DESIGN DECISION RATIONALE

The two decisions with real alternatives, which list forms count and where recognition lives, are closed in section 3 with their options. The remaining decisions:

**Does widening recognition change eligibility?**
- Also relax the crossref or the tag rule while here: tempting because listed Punts are often tagged.
- **Chosen:** no eligibility change. Rationale: FAFF-1078 set the two-fact rule to close a wave-through loophole, and this change is only valuable while it stays strictly fail-safe-ward.

**Should the fix extend to task checkboxes and blockquotes?**
- Include them for completeness: closes the residual invisible set.
- **Chosen:** no, per the OUT OF SCOPE entry. Rationale: zero corpus occurrences, ambiguous meaning, and the ticket scoped the question to list markers. If one appears, the prefix group is the single place to add it.

**Should the interface change the printed JSON?**
- Add a `listed: Boolean` field to `PuntMarker` for debugging.
- **Chosen:** no. Rationale: the principle is that the prefix is presentation; surfacing it would invite a consumer to branch on it, and the `PuntScanResult` shape is a consumed contract.

**Where is the accepted-forms list documented for operators?**
- Only in code comments.
- **Chosen:** one clause in the `punt-scan` row of `docs/guide/cli.md` naming the accepted list forms. Rationale: that row is where an author learns what a Punt marker may look like, and it already defines the scanned unit.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. Every decision above is closed. The question of how far a continuation reaches belongs to FAFF-1340 and is out of scope here; the terminator contract above is the only thing this ticket states about it.

**Assumptions.**

- **Assumes:** `faff regions selftest` runs `punt-scan --selftest` and `faff regions check` accepts the module unchanged. Validate: `regions.js` lists `punt-scan` in both `REGION_MAP` and `REGION_SELFTEST_ARGV`; no edit to either is needed because no command is added.
- **Assumes:** nothing outside `punt-scan.js`, its test file, and the `cli.md` row asserts on the scanner's counts for a committed spec. Validate: grep the test tree for `punt-scan` before editing; at the time of writing only `test/punt-scan.test.mjs` references it.

## 8. DONE: Definition of Done

### From WHY
- [ ] `faff punt-scan records/specs/2026-06-22-FAFF-11-engineering-quality-gates-design.md` reports two Punts and `blocking_open_count` 2, where it previously reported an empty list and 0.
- [ ] Loosening guard: with the pre-change `punt-scan.js` saved from the base commit to a temporary path (`git show HEAD:plugin/skills/faff/bin/lib/punt-scan.js`, with its two sibling requires alongside), running old and new over every file in `records/specs/` shows, for each file, `new.blocking_open_count >= old.blocking_open_count` and `new.eligible_count >= old.eligible_count`. A rise is expected for the 56 listed-Punt specs and is not a failure; the check exists to catch an accidental loosening of eligibility, which the monotone design forbids. A failure to load the old module or to read a file fails the check; it is never caught and counted as a pass. The permanent encoding of the same property is the per-form equality test, which pins that recognition changes no classification; the guard is the one-off proof over the real corpus.
- [ ] A listed Punt and its twin (the same words with everything before the bold token removed, indentation included) produce byte-identical `faff punt-scan` output, for each of the seven accepted forms enumerated in the WHAT section.

### From WHAT (types and interfaces)
- [ ] The list-marker rule is written once, as `LIST_ITEM_PREFIX`; `PUNT_LINE_RE` is composed from it, and `puntScan` obtains each remainder through `matchPuntStart`.
- [ ] `matchPuntStart` is exported from `punt-scan.js` and returns the remainder without the list prefix or indentation, or null, and nothing else new is exported.
- [ ] The printed `PuntScanResult` shape, the CLI flags, and the exit codes are unchanged.
- [ ] The `punt-scan` row in `docs/guide/cli.md` names the accepted list forms, and `faff lint-cli-doc` still passes.

### From HOW (behaviour)
- [ ] `faff punt-scan --selftest` exits 0 and includes a row for each of: dash, star, plus, ordered dot, ordered paren, nested dash, nested ordered, ten-digit negative, listed-eligible, listed tag order, the ticket repro, inline mention, backticked, listed Chosen.
- [ ] A listed Punt tagged non-blocking with an OUT OF SCOPE crossref is eligible and does not raise `blocking_open_count`.
- [ ] A line that mentions the token mid-line, in backticks, or on a Chosen marker is not counted as a Punt.
- [ ] If FAFF-1340 has landed: a wrapped listed Punt reads identical to its single-line form, and a listed Punt followed by a listed Chosen line carrying a non-blocking tag does not absorb that tag.
- [ ] If FAFF-1340 has not landed: `matchPuntStart` carries a code comment stating the continuation-terminator contract.

### From HOW (edge cases)
- [ ] A bare line-start Punt yields the same marker it did before the change.
- [ ] An ordered marker with ten digits is not recognised.
- [ ] `faff regions check` and `faff regions selftest` pass with `punt-scan` classified as before.

### From invariants
- [ ] No file under `plugin/skills/faffidavit-routing/`, `plugin/skills/faffter-noon-spec/`, or `plugin/skills/faffter-dark-nlspec/` is in the change set.
- [ ] `extractOutOfScopeItemKeys` is unchanged.

### Repository checks
- [ ] `test/punt-scan.test.mjs` passes, including the parametrised per-prefix equality test, the `matchPuntStart` test, and the CLI repro test.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Write a spec file with an OUT OF SCOPE item "Repeat-park collapse" and three lines:
       a dash-listed untagged Punt, a star-listed Punt tagged non-blocking naming
       "repeat-park collapse", and an ordered-listed untagged Punt.
  2. Run `faff punt-scan` on it.
  3. ASSERT three Punts, eligible_count 1, blocking_open_count 2.
  4. De-prefix only the three Punt lines (leave the OUT OF SCOPE bullet exactly as it is, because
     the extractor is unchanged and still needs its dash bullet), and re-run.
  5. ASSERT the printed JSON is byte-identical to step 2.
```

**Rating note.** No open Punt remains and every decision is closed with its reasoning. The single moving part is the build-order interaction with FAFF-1340, which is handled by a two-branch builder instruction rather than left open; that is the only reason this is not a purely mechanical change.

## Already shipped against this surface

- FAFF-1078 (Done) introduced `faff punt-scan`, the two-fact eligibility rule, and the routing and self-rating consumers. It defined the scanner's input as a line-start Punt marker. This change extends that input predicate only; the premise (a listed Punt is invisible) is not delivered by it.
- FAFF-356 (Done) added the `(decides: <owner>)` suffix the scanner already parses. Untouched here.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized: No issues.** One concern (the scanner's input predicate), one file, a 1-3 day unit. The spec keeps continuation handling out, so it stays a single deliverable.
- **Merge candidate surfaced, not recommended (principle 4).** FAFF-1340 edits the same regex and loop. The two do not always ship together: this one is Urgent and fail-open, FAFF-1340 is High and fail-safe, and each is independently valuable. The ticket leaves merge-versus-serialise to the operator; the spec composes either way through the shared `matchPuntStart` seam, so no merge is needed.
- **Workstream fit: No issues.** Both tickets are project-less Backlog work with one shared outcome (the scanner reads a Punt by its content). Not enough sibling work to justify a project; leave loose.
- **Dependencies (principle 6): one implicit coupling.** FAFF-1351 and FAFF-1340 are linked only as related, but the build order between them is real: the later one must adopt the earlier one's recogniser or terminator. The spec's two-branch builder instruction makes the order safe. If the operator wants it deterministic, add a blocker edge from FAFF-1351 to FAFF-1340, which also puts the Urgent fail-open fix first.
- **Risk profile (principle 7): low.** The change is monotone (it can only add blocking Punts). The one real exposure is the 56 committed specs that re-read as more blocking; that is the intended correction, not a de-risking spike candidate.

confidence: high
build-tier: complex
spec-review: accept (judge, L3-provisional)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
