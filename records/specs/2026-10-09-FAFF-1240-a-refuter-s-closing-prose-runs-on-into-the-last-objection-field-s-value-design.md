# FAFF-1240: A refuter's closing prose runs on into the last objection field's value

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1240.

This spec is for the build agent implementing FAFF-1240 and for the humans reviewing it. `parseBullets` in `parse-refutation.mjs` lets every line after a field bullet run on into that field until the next bullet or heading, so a refuter's closing prose ("No methodology objection beyond this: …") is stored inside the last field, usually `spec_anchor`. This ticket ends each field value at a defined point, keeps gating byte-for-byte unchanged, and makes the one place anchors are resolved tolerate the section-number slip seen in the same outputs.

## 1. WHY

**The idea the rest turns on.** The four field values have different grammars, so they get different end rules. `spec_anchor` is a single slug by the prompt grammar, so its value is the bullet line and nothing else. `claim`, `evidence` and `predicted_consequence` are prose that may wrap onto following lines, so their values end at the first blank line after real content. Neither rule can change gating, because gating reads only the section severity and whether `claim` is non-empty, and both rules keep a non-empty `claim` non-empty.

**Problem.**

- Status quo: `parseBullets` (`parse-refutation.mjs` :79-105) appends every non-bullet, non-heading line to the current field, blank lines included, then trims. A value ends only at the next field bullet, a `##`+ heading, or the end of the `###` section.
- Pain: closing prose after the last bullet is stored in the last field. In FAFF-1223's round 1 the methodology objection's `spec_anchor` was `"open-questions-and-assumptions\n\nNo methodology objection beyond this: …"`. Gating objections carry their fields verbatim through `aggregate.mjs` into `round-<n>.json`, the posted `## Spec-review evidence` comment and the graft anchor, and `spec-judge-casefile.js` builds its judge proposition from the raw anchor (`buildProposition` :91-97), so the run-on reaches evidence and the judge.
- A corpus study of 1,613 parsed objections found 112 values containing a blank line (105 `spec_anchor`, 7 `predicted_consequence`, 0 `claim`, 0 `evidence`) and 0 legitimate multi-paragraph values. Every one was closing prose, a transcript artefact (`---` plus an operator heading) or a reasoning model's leaked deliberation.
- The same outputs show a model slugging slip: the lens writes `open-questions-and-assumptions` where the heading `## 7. OPEN QUESTIONS AND ASSUMPTIONS` slugs to `7-open-questions-and-assumptions`. About 54 of the explored anchors match a spec heading only after dropping that number prefix, and today they all fall to `orchestrator:undefended`.
- The two halves make different promises. The parser change cannot move gating. The anchor fallback is meant to change behaviour: those anchors move from `orchestrator:undefended` to `orchestrator:chosen`, so the spec judge sees a defence (argument B) it lacked, which can change judge outcomes on standing objections. The gating-equivalence claim covers the parser only.

### Design principles

**Gating never moves.** Severity, outcome, the FAFF-990 `claim` fault and the FAFF-1223 severity-less fault must give the same result for every body before and after. A prototype of the parser change over 700 captured bodies (2,558 objections; lens transcripts and raw backend bodies, which overlap) gave 0 gating differences; 203 objections changed values (194 `spec_anchor`, 9 `predicted_consequence`), all by dropping trailing prose.

**Anchor checking stays advisory.** An anchor that resolves to nothing is `orchestrator:undefended`, never a fault, a gate or a contract violation (FAFF-943). The new fallback only turns some undefended propositions into defended ones, and only when the match is unambiguous.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs` `parseBullets` (:74-105) | JavaScript | The value-extent change and its comment |
| same file, `BULLET_RE` (:49), objection build (:205-210) | JavaScript | Unchanged |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `FINDING_BULLET_RE` (:743), `refuteFindings` splice (:1027-1036) | JavaScript | Unchanged; the splice inserts `> auto-refuted: …` after a section's last non-blank line |
| `plugin/skills/faff/bin/lib/spec-judge-casefile.js` `buildSpecHeadingIndex` (:104-120), `deriveArgumentB` (:126-139), `assemble` (:244-247, :293) | JavaScript (CommonJS) | The anchor fallback and the `case_file_anchor` it records |
| `plugin/skills/faff/bin/lib/heading-slug.js` | JavaScript (CommonJS) | Unchanged; both sides of the fallback use `headingSlug` |
| `test/spec-refute-parse.test.mjs` (:140, :156, :170) | JavaScript (`node:test`) | Existing pins that must stay green; new tests join this file |
| `test/spec-judge-casefile.test.mjs` (:94-113) | JavaScript (`node:test`) | Existing `deriveArgumentB` tests; fallback tests join this file |
| `records/specs/2026-09-02-FAFF-938-deterministic-parser-spec-review-refuter-objection-design.md` (:119-123, DONE :238) | Markdown | The value-extent rule this spec amends |
| `records/specs/2026-08-31-FAFF-930-spec-review-judge-blinded-two-sided-case-file-adjudicator-design.md` (:604) | Markdown | The exact-match anchor rule this spec amends |

**Scope.** One function's value-extent rule in `parse-refutation.mjs`, one anchor-resolution helper in `spec-judge-casefile.js`, tests in the two existing test files, and code comments.

## 2. OUT OF SCOPE

- **Refuter prompt wording** ("write nothing after the last field"). Why: the parser fix suffices, and prompt edits shift eval baselines (FAFF-1236). Extension point: the four `plugin/skills/faffter-dark-spec-review/refute-*.md` and their `eval/review-bench/lenses/` copies.
- **`spec_anchor` format validation at parse or contract time.** Why: FAFF-943 made a non-matching anchor a soft zero-match, never a violation; the 3 observed explanation-instead-of-slug anchors (for example FAFF-1162's `build-procedure (the PROCEDURE … block …)`) stay as written. Extension point: `parseRefutation`'s objection build (:209) or `contract-defs.js` objection shape (:487-504).
- **Stripping a spliced `> auto-refuted:` line from `claim`, `evidence` or `predicted_consequence`.** Why: it is spliced only into `[auto-refuted]` sections, which are observations that `aggregate.mjs` drops before the round record. Extension point: `parseBullets`.
- **Other anchor slips** (wrong section, title text instead of a slug, a number prefix the heading lacks). Why: none is deterministic to correct safely; they stay `orchestrator:undefended`. Extension point: the new `resolveAnchorKey` helper in `spec-judge-casefile.js`.
- **The judge proposition's anchor text.** Why: `buildProposition` keeps naming the objection's own (now clean) `spec_anchor`; rewriting it to the resolved heading slug changes the judge-facing template. Extension point: `buildProposition` (:91-97).
- **Wholly CRLF refuter bodies.** Why: they fail `BULLET_RE` and `SEVERITY_HEADING_RE` today, independent of value extent, and none appears in the corpus. Extension point: a line-ending normalisation at the top of `parseRefutation`.
- **Retrofitting already-posted evidence and stored round records.** Why: they are a read of what happened (FAFF-1157); the fix applies to new rounds. Extension point: none needed.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Field bullet | A line matching `BULLET_RE`: `- <key>: <value>` for `claim`, `evidence`, `predicted_consequence` or `spec_anchor` |
| Bullet line value | `BULLET_RE`'s capture group 2 on the field bullet itself |
| Blank line | A line matching `/^\s*$/` (empty, or only spaces, tabs or a stray `\r`) |
| Closed field | A field whose value has ended; later non-bullet, non-heading lines are discarded until the next field bullet or heading |
| Number-prefix fallback | Resolving an anchor to the one spec heading whose slug equals the anchor once a leading `\d+-` is removed from the heading slug |

### Value-extent rule (amends FAFF-938 :119-121)

| Field | Value is | Continuation lines |
|---|---|---|
| `spec_anchor` | The bullet line value, trimmed | Never read; an empty bullet line value leaves the field absent, as today |
| `claim`, `evidence`, `predicted_consequence` | The bullet line value plus following non-blank lines, joined with `\n` and trimmed | Kept until the first blank line that follows non-blank value content; blank lines before any content are skipped |

In every field a value still also ends at the next field bullet or `##`+ heading, and a repeated key still overwrites (last wins). Everything else in `parseBullets` and `parseRefutation` is unchanged, including the `### ` section split and the objection shape.

### Interfaces

No exported signature or record shape changes.

- `parseRefutation(content, lens)` keeps returning `{ ok, entry }` or `{ ok: false, fault }` with the same objection keys; only the text of a field value can be shorter.
- `BULLET_RE` keeps its source text, so `FINDING_BULLET_RE` (`review-call.mjs` :743) stays byte-identical and its parity test (`test/adversarial-call.test.mjs` :4206-4226) is unaffected. `review-call.mjs` does not change.
- `deriveArgumentB(specText, anchorSlug, mode)` keeps its arguments and its `{ body, source }` result, and adds one key: `resolved_slug` (the index key that matched, or `""` when none did).

```
FUNCTION resolveAnchorKey(index, anchorSlug) -> string     # module-private, new, spec-judge-casefile.js
  IF anchorSlug == "": RETURN ""
  IF index.has(anchorSlug): RETURN anchorSlug             # exact match always wins
  candidates = [ key FOR key IN index.keys()
                 IF key matches /^\d+-/ AND key with leading /^\d+-/ removed == anchorSlug ]
  IF candidates.length == 1: RETURN candidates[0]
  RETURN ""                                                # none or ambiguous
```

- Uniqueness is over distinct index keys. Two headings with the same full slug are one key (their bodies are already concatenated, :135-136), so they are not ambiguous; `## 2. Out of scope` and `## 5. Out of scope` are two keys, so `out-of-scope` is ambiguous and resolves to nothing.
- Only a leading run of digits and one hyphen is removed (`7-open-questions` becomes `open-questions`; `7-2-x` becomes `2-x`, once).

## 4. HOW

### `parseBullets`

Behaviour summary: track whether the current field is closed; a closed field ignores lines until the next bullet or heading.

```
PROCEDURE parseBullets(body):
  1. lines = body split on "\n"; fields = {}; key = null; buf = []; closed = false
  2. flush(): IF key: fields[key] = join(buf, "\n").trim(); key = null; buf = []; closed = false
  3. FOR each line:
     a. IF line matches BULLET_RE:
          flush(); key = lowercase(capture 1); buf = [capture 2]
          closed = (key == "spec_anchor"); CONTINUE
     b. IF line matches ANY_HEADING_RE: flush(); CONTINUE
     c. IF key is null OR closed: CONTINUE                   # lead-in or trailing prose: discarded
     d. IF line is blank:
          IF join(buf, "").trim() != "": closed = true       # a blank after content ends the value
          CONTINUE                                           # a blank before content is skipped
     e. buf.push(line)
  4. flush(); RETURN fields
```

- A blank line inside a value is never kept, so a stored value never contains `\n\n`.
- Indentation on kept continuation lines is preserved, so test :156 (`"the retry loop\n  has no upper bound\n  at all."`) is unchanged.
- The `> auto-refuted:` line at :140 follows `claim` with no blank line, so it stays in `claim` and the `startsWith` assertion is unchanged.
- Update the comment above `parseBullets` (:74-78) to state the new rule in one sentence per field type, and name FAFF-1240 once.

**Why gating cannot change.** The FAFF-990 fault fires when a gating section's `claim` is empty after trim. Under the old rule `claim` is non-empty iff some non-blank line exists between its bullet and the next bullet or heading. Under the new rule the first such line is always kept (step d skips blanks only until content exists), so `claim` is non-empty in exactly the same cases. Severity comes from the heading, the FAFF-1223 check counts keys (which are set exactly as before), and `outcome` reads severity only.

**Anti-pattern:** ending every field at the first blank line without skipping leading blanks. Why: `- claim:` followed by a blank line and then the claim would become empty and newly fault a gating lens, which is a gating change.

**Anti-pattern:** ending `spec_anchor` at the first blank line instead of the bullet line. Why: it keeps the 6 spliced `> auto-refuted:` lines the corpus shows directly under an anchor (for example FAFF-1085's `"4-how-behaviour\n> auto-refuted: …"`).

### Anchor fallback in `spec-judge-casefile.js`

```
PROCEDURE deriveArgumentB(specText, anchorSlug, mode):      # changed steps only
  index = buildSpecHeadingIndex(specText)
  key = resolveAnchorKey(index, anchorSlug)
  IF anchorSlug == "": RETURN { body: "", source: "orchestrator:undefended", resolved_slug: "" }
  IF key == "": RETURN { body: "", source: mode == "redispatch" ? "orchestrator:anchor-lost"
                                                                 : "orchestrator:undefended",
                         resolved_slug: "" }
  body = join(index.get(key), "\n\n").trim()
  IF body == "": RETURN { body: "", source: "orchestrator:undefended", resolved_slug: "" }
  RETURN { body, source: "orchestrator:chosen", resolved_slug: key }

PROCEDURE assemble(...):                                     # changed line only
  ledger entry case_file_anchor = bDerived.source == "orchestrator:chosen" ? bDerived.resolved_slug : ""
```

- `case_file_anchor` records the heading slug that actually bound, so a later re-derive from the ledger hits the exact-match arm. For an exact match this equals today's value.
- The fallback applies in both modes; with `case_file_anchor` now exact it only matters in `assemble`.
- Update the `deriveArgumentB` comment (:122-125) to name the number-prefix fallback and its unique-match condition.

### Edge cases

- A whitespace-only line (spaces, tabs, a stray `\r`) is blank. A wholly CRLF body does not parse today (the `(.*)$` captures in `BULLET_RE` and `SEVERITY_HEADING_RE` do not match a trailing `\r`) and still does not; that is out of scope.
- Closing prose between objections (last field of a non-last section): discarded the same way, since the next `### ` heading starts a new section anyway.
- Closing prose with no blank line before it, directly under `claim`, `evidence` or `predicted_consequence`: still joined, as today (accepted; 0 corpus cases outside `[auto-refuted]` observations).
- Closing prose directly under `spec_anchor` with no blank line: dropped (bullet line only).
- An observation section: same rule; observations remain unchecked and are dropped by `aggregate.mjs`.

### Failure modes

- **A future refuter writes a genuinely multi-paragraph `claim`, `evidence` or `predicted_consequence`.** How you'd know: a `round-<n>-<lens>.md` transcript shows a second paragraph under a field that the matching objection in `round-<n>.json` lacks; re-running the old-versus-new comparison over `.faff/spec-review/*/round-*-*.md` reports a changed value whose dropped text is not closing prose. What it means: proceed; gating is unaffected (presence, not length, gates) and the full text is in the transcript. If it becomes routine for one backend, revisit the rule in a follow-up rather than reverting.
- **The number-prefix fallback binds the wrong section.** How you'd know: a case file whose `relevant_spec_sections` plainly does not match the objection's claim, on a spec with two similarly named numbered sections. What it means: narrow the fallback; ambiguous cases already stay undefended, so this needs two headings whose stripped slugs differ but the model meant the other one.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a methodology refuter body whose last objection ends
  "- spec_anchor: open-questions-and-assumptions", a blank line, then
  "No methodology objection beyond this: the slice is otherwise right-sized."
When parseRefutation runs
Then that objection's spec_anchor is exactly "open-questions-and-assumptions"
And its severity, claim presence and the entry's outcome equal the pre-change parser's
```

```
Given a minor objection whose last field is
  "- predicted_consequence: not separately stated", a blank line, then
  "No architectural objection beyond these."
When parseRefutation runs
Then predicted_consequence is exactly "not separately stated"
```

```
Given a gating section with "- claim:" (empty on the bullet line), a blank line, then "the loop never ends."
When parseRefutation runs
Then the result is ok and claim is "the loop never ends." (no FAFF-990 fault)
```

```
Given a spec with headings "## 7. OPEN QUESTIONS AND ASSUMPTIONS" (non-empty body) and no exact "open-questions-and-assumptions" heading
When deriveArgumentB(spec, "open-questions-and-assumptions", "assemble") runs
Then source is "orchestrator:chosen", body is that section's body, and resolved_slug is "7-open-questions-and-assumptions"
```

- For every body in the gating-equivalence test, `ok`, `outcome` and each objection's `severity` and `"claim" in objection` are identical under the old and new rules.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Where `spec_anchor` ends | Next bullet or heading (today); first blank line; bullet line only | **Chosen:** bullet line only |
| Where `claim`, `evidence`, `predicted_consequence` end | Next bullet or heading (today); first blank line; first blank line after content | **Chosen:** first blank line after content |
| What happens to trailing prose | Keep in the field; new `trailing_prose` field; discard from parsed values | **Chosen:** discard from parsed values |
| `BULLET_RE` and `FINDING_BULLET_RE` | Change the bullet grammar; leave both | **Chosen:** leave both unchanged |
| Checking `spec_anchor` against the spec | Gate or contract check; advisory with exact match only; advisory with a number-prefix fallback | **Chosen:** advisory, with a unique-match number-prefix fallback in this ticket |
| What `case_file_anchor` records | The refuter's anchor; the heading slug that bound | **Chosen:** the heading slug that bound |
| Refuter prompts | Add "write nothing after the last field"; leave unchanged | **Chosen:** leave unchanged |
| Regression evidence | Committed corpus fixture directory; inline excerpts in the test file | **Chosen:** inline excerpts |
| Prose and records | Edit the FAFF-938 and FAFF-930 record specs; update `SKILL.md`; code comments only | **Chosen:** code comments only, amendment stated here |

**`spec_anchor` ends at the bullet line.** The prompt grammar defines it as one slug, and the corpus has no wrapped slug. A blank-line rule would miss the 6 `> auto-refuted:` lines spliced directly under an anchor and the 1 FAFF-969 parenthetical. An empty bullet line value leaves the field absent (1 corpus case, FAFF-828, already empty today), which is the FAFF-943 absence signal; reading the next non-blank line instead would turn closing prose into an anchor.

**Prose fields end at the first blank line after content.** The corpus has 0 legitimate blank-line values and 7 single-newline continuations, so a blank line is where real values stop and closing prose starts. Single-newline wraps stay whole (test :156). Skipping leading blanks keeps `claim` presence, and so gating, identical. Accepted residual: a future genuinely multi-paragraph value is cut to its first paragraph (see Failure modes for the signal).

**Trailing prose is discarded.** Nothing is lost for audit: the occupant writes each served lens's full stdout to `round-<n>-<lens>.md` (`faffter-dark-spec-review/SKILL.md` :209) and the transport retains every raw backend body under `raw/` (:167); both were confirmed present for FAFF-1223. A new field would widen the objection shape, the contract (`contract-defs.js` :487-504), `aggregate.mjs`'s `TRIPLE_FIELDS` and the posted evidence, for text that FAFF-1154 already classed as model drift.

**`BULLET_RE` unchanged.** The bug is value extent, not bullet recognition. Leaving the regex alone keeps FAFF-1223's byte-identical `FINDING_BULLET_RE` copy and parity test valid with no change to `review-call.mjs`.

**Advisory anchor checking with a fallback here.** The ticket asks for the slip to be checked alongside, the change is small and deterministic, and about 54 explored anchors resolve only this way. Requiring a unique match keeps it fail-safe: an ambiguous or missing match stays `orchestrator:undefended`, exactly today's outcome. Exact match is tried first, so no anchor that binds today binds differently. This amends FAFF-930's "select the block whose slug equals the objection's `spec_anchor`" rule (:604) and keeps FAFF-943's soft zero-match.

**`case_file_anchor` records the bound slug.** FAFF-930 names `case_file_anchor` the stable binding; storing the heading slug that matched keeps a re-derive exact and makes the ledger say which section was used.

**No prompt change.** FAFF-1154 recorded trailing prose as model drift and fixed the parser, not the briefs. Prompt edits shift eval baselines (FAFF-1236), and models drift regardless of instruction; the parser fix covers every backend.

**Inline excerpts, not a fixture directory.** A handful of real shapes (FAFF-1223 methodology, FAFF-1085 auto-refuted splice, FAFF-1010 leaked reasoning, FAFF-1027 `---` artefact) exercise every case; a fixture directory adds files to maintain for no extra coverage.

**Code comments only.** A grep of `plugin/`, `docs/` and `eval/` finds no `SKILL.md` or reference prose restating the value-extent rule; it lives in the `parseBullets` comment. Record specs are history and are not edited; this spec states the amendment of FAFF-938 :119-121 (and its DONE :238 wording on wrapped values) and FAFF-930 :604.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The ticket's questions are answered above:

- Where a value ends: `spec_anchor` at its bullet line; the prose fields at the first blank line after content. Real outputs use no blank lines inside values (0 of 1,613).
- Trailing prose: discarded from parsed values; the transcripts keep it.
- `spec_anchor` checking: advisory, with the number-prefix fallback.
- `BULLET_RE` and `FINDING_BULLET_RE`: both unchanged, still in step.

**Assumptions:** none beyond the cited code.

## 8. DONE

### From WHY
- [ ] The FAFF-1223 round-1 methodology body shape (anchor, blank line, `No methodology objection beyond this: …`) parses to `spec_anchor === "open-questions-and-assumptions"`
- [ ] A gating-equivalence test runs at least five real-shaped bodies (including a fault body and a clean body) through the new parser and asserts `ok`, `outcome`, and every objection's `severity` and `"claim" in objection` equal hard-coded pre-change expectations

### From WHAT
- [ ] `BULLET_RE` source text is unchanged and no file under `plugin/skills/faffter-dark-adversarial-review/` changes
- [ ] `deriveArgumentB` returns `resolved_slug`; `assemble` writes it to `case_file_anchor` when the source is `orchestrator:chosen`, otherwise `""`
- [ ] No objection key, contract shape, or `aggregate.mjs` line changes

### From HOW (`test/spec-refute-parse.test.mjs`)
- [ ] Trailing prose after a last `spec_anchor` (blank line, then prose) is dropped
- [ ] Prose directly under `spec_anchor` with no blank line is dropped
- [ ] Trailing prose after a last `predicted_consequence` (blank line, then prose) is dropped and the value equals the first paragraph
- [ ] Prose between objections (last field of a non-last section, FAFF-1010 leaked-reasoning shape) is dropped and the next objection parses whole
- [ ] `spec_anchor` followed directly by `> auto-refuted: …` (FAFF-1085 shape) equals the slug alone
- [ ] A blank line inside `claim` truncates `claim` to the text before it
- [ ] `- claim:` with an empty bullet line, a blank line, then text gives that text and no fault
- [ ] A `---` line and `## Occupant verification pass` after a blank line under the last field (FAFF-1027 shape) are not in the value
- [ ] A whitespace-only line (`"  \t"`) and a lone `"\r"` line each end a prose value after content
- [ ] The existing tests at :140 (auto-refuted after `claim`), :156 (wrapped claim pinned exactly) and :170 (anchor absent, empty, present) pass unchanged

### From HOW (`test/spec-judge-casefile.test.mjs`)
- [ ] Number-prefix fallback: anchor `open-questions-and-assumptions` against `## 7. OPEN QUESTIONS AND ASSUMPTIONS` gives `orchestrator:chosen` with that body and `resolved_slug` `7-open-questions-and-assumptions`
- [ ] Exact first: a spec with both `## Done` and `## 8. Done` resolves anchor `done` to the `## Done` body
- [ ] Ambiguous: `## 2. Out of scope` and `## 5. Out of scope` with anchor `out-of-scope` gives `orchestrator:undefended`, and `orchestrator:anchor-lost` in `redispatch` mode
- [ ] Duplicate identical numbered headings (`## 3. What` twice) with anchor `what` resolve, with both bodies concatenated
- [ ] `assemble` with the fallback-matched objection writes `case_file_anchor` `7-open-questions-and-assumptions`; the existing tests at :94-113 pass unchanged
- [ ] Holding the parsed objection fixed, an exact-match anchor's case file and ledger entry are byte-identical to the pre-change `spec-judge-casefile.js` output (the fallback only changes anchors that miss exactly)

### From HOW (comments)
- [ ] The `parseBullets` comment (:74-78) states the per-field end rule; the `deriveArgumentB` comment (:122-125) states the unique-match number-prefix fallback

### Integration smoke test

```
1. body = header + "### minor: t\n- claim: c\n- evidence: e\n- predicted_consequence: p\n- spec_anchor: open-questions-and-assumptions\n\nNo methodology objection beyond this."
2. entry = parseRefutation(body, "methodology")           -> ok, outcome "refuted", spec_anchor "open-questions-and-assumptions"
3. aggregate.mjs stdin { enabled_lenses: [lens], refutations: [entry] } -> objection carries the clean anchor
4. assemble({ standingObjections: [{ ...objection, lens: "methodology" }],
              specText: "## 7. OPEN QUESTIONS AND ASSUMPTIONS\n\nA decision.\n" })
                                                           -> ledger case_file_anchor "7-open-questions-and-assumptions",
                                                              argument B source "orchestrator:chosen"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** split considered, kept as one ticket.
  - The parser value-extent fix (`parse-refutation.mjs`) and the anchor number-prefix fallback (`spec-judge-casefile.js`) touch different modules and could ship separately. They also make different promises: the parser cannot move gating, while the fallback deliberately changes what the spec judge sees for about 54 anchors.
  - Kept together because the ticket asks to check the anchor slip alongside, and both are about one record (an objection's `spec_anchor`) arriving intact. Applied at prep instead of splitting: one WHY line stating the fallback can change judge outcomes, and one DONE item asserting an exact-match anchor's case file and ledger entry are byte-identical before and after.
- **Workstream fit (P1 + P5):** No issues. Project-less default landing; a thin "refuter output is parsed faithfully" cluster with the shipped FAFF-1223 and FAFF-1238 that does not need a container.
- **Surfaced dependencies (P6):** No issues.
  - FAFF-1223 is Done and linked; `FINDING_BULLET_RE` parity is untouched.
  - FAFF-1239 edits `review-call.mjs`, which this spec leaves unchanged, so they build in either order.
  - The eval grader reads no field text, so FAFF-1236 and FAFF-1243 baselines do not move.
- **Risk profile (P7):** No issues. Gating equivalence was prototyped over 700 real bodies (2,558 objections, 0 gating differences) before commitment; the fallback is exact-first and leaves ambiguous anchors undefended.

confidence: high
build-tier: complex
spec-review: approve

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
    { "marker": "chosen" }
  ] }
```
