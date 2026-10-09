# FAFF-1238: Clean-refutation preamble guard misses wrong-lens headings and indented severity headings

> Spec: faffter-dark-nlspec · 2026-10-09 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1238.

This spec is for the build agent implementing FAFF-1238 and for the humans reviewing it. `normaliseCleanRefutation` in `review-call.mjs` rewrites a refuter body that ends in a clean affirmation (`No QA objection.`) to the canonical `### observation: no findings` token. Two holes in its heading guards let a body that carries a real finding, or another lens's section, normalise to clean. This ticket closes both, mirrors the fix in the review-bench copy, and pins the mirror to production with a parity test.

## 1. WHY

**The idea the rest turns on.** The normaliser's heading guards are a rejection filter, not a parser. A false rejection is cheap: the body stays unnormalised, the shape gate classifies it as garbled (exit 10 `MALFORMED`) and the fallback chain advances. A false acceptance is expensive: a finding is silently rewritten to clean. So the guards should treat anything that looks like a severity heading or a `## Refutation —` heading as disqualifying, wherever it sits and however it is indented, with one exemption: the entry's own lens heading before the affirmation.

**Problem.**

- The preamble guard (lines before the matched form) checks `SEVERITY_LIKE_HEADING_RE` only, never `REFUTATION_NAMESPACE_RE`. `## Refutation — architectural`, then prose, then `No QA objection.` normalises `bare` for QA today. The trailing guard already rejects the same heading after the affirmation, so the two directions disagree.
- Both guard regexes are anchored at column 0. An indented `  ### major: x` before the affirmation, or `  ### major: x` / `\t## Critical: y` / `  ## Refutation — architectural` after it, is not caught. Only line 0 is accidentally covered, because the outer `trim()` strips its indent.
- Both gaps date from FAFF-1154 (which added the trailing guard and left the preamble severity-only) and were raised as Phase 2 observation 1 in FAFF-1222's adversarial review.

### Design principles

**Fail toward rejection.** Every new rejection lands on the existing garbled path (exit 10, chain advances, an exhausted chain surfaces as an outage). No new exit code, fault shape or caller change.

**Stricter than the parsers, on purpose.** `parse-refutation.mjs` and `splitFindings` read headings at column 0 only. The normaliser guard is allowed to be stricter, because rejecting is safe; the parsers and `FINDING_BULLET_RE` keep their column-0 grammar unchanged.

**Every body that normalises today and carries no finding still normalises.** The own-lens heading in the preamble stays accepted (tests at :1902 and :1927 depend on it), decorative headers stay accepted, and the 49 currently-normalising bodies in the capture corpus are unchanged (section 7).

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` `normaliseCleanRefutation` (:783-866) | JavaScript | The code change: trailing guard (:814-818) and preamble guard (:859-863) |
| same file, guard regexes (:734-738), `isDecorativeHeader` (:754-759), form selection (:832-855) | JavaScript | Regexes stay column-0; form selection and `isDecorativeHeader` unchanged |
| same file, comments at :699-703 (`CLEAN_REFUTATIONS`), :772-777 (normaliser header), :807-810 (trailing guard), :857-858 (preamble guard) | JavaScript | Comment updates |
| `eval/review-bench/run-bench.mjs` `isCleanRefutation` and its regexes (:174-237) | JavaScript | Subset mirror of the normaliser with the same two gaps; not importable today (top-level `parseArgs(process.argv)`, `process.exit`, network calls) |
| `test/adversarial-call.test.mjs` normaliser tests (:1799-2260, :4159-4236) | JavaScript (`node:test`) | Existing fixtures that must stay green; the new table joins this file |
| `plugin/skills/faffter-dark-adversarial-review/SKILL.md` :62 (spec-refuter closed-grammar paragraph) | Markdown | Describes the trailing guard only; gains the preamble and indentation rules |
| `plugin/skills/faffter-dark-spec-review/parse-refutation.mjs`, `FINDING_BULLET_RE` | JavaScript | Unchanged (parser parity) |

**Scope.** One guard helper and two guard loops in `normaliseCleanRefutation`, the same change in the review-bench mirror (moved into an importable sibling module), one test table plus a parity test, and comment and `SKILL.md` updates.

## 2. OUT OF SCOPE

- **Indented headings in the parsers.** Why: `parse-refutation.mjs` (`HEADING_LINE_RE`, `SEVERITY_HEADING_RE`, `ANY_HEADING_RE`) and `splitFindings` / `validateFindingsShape` read column-0 headings by design; widening them changes what parses. Extension point: those regexes.
- **Indented triple bullets.** Why: `FINDING_BULLET_RE` is pinned to `BULLET_RE` by the FAFF-1223 parity test (:4205), which asserts `  - claim:` does not match. Extension point: `FINDING_BULLET_RE` and `BULLET_RE` together.
- **The mirror's missing triple-bullet guard.** Why: FAFF-1223 deliberately left `eval/review-bench/` untouched; this ticket is about headings, and the parity test below is built over heading rows only. Extension point: `isCleanRefutation` in the new `eval/review-bench/clean-refutation.mjs`, plus bullet rows in the parity table.
- **The mirror's missing `headed+signal` and `header-wrapped` forms.** Why: the mirror is a documented subset that stays conservative (never clean where production rejects). Extension point: the same module.
- **An indented affirmation sentence** (`  No QA objection.` after line 0). Why: `matchAffirmation` matches the sentence at column 0, and loosening it widens what counts as clean, the opposite direction to this ticket. Extension point: `matchAffirmation`.
- **Case-insensitive or near-miss own-lens heading exemption** (`## refutation — qa` before `No QA objection.`). Why: the `headed` arm already demands the exact heading, and a near-miss own heading directly above the affirmation already rejects; the exemption follows the same exactness (decision below). Extension point: the exemption check in the preamble loop.
- **A multi-lens body format.** Why: no refuter brief asks for one, and no capture contains one. Extension point: `CLEAN_REFUTATIONS` and the form selection step.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Guard heading | A line that, after removing leading spaces and tabs, matches `SEVERITY_LIKE_HEADING_RE` or `REFUTATION_NAMESPACE_RE` |
| Own heading | The matched entry's `heading` (`## Refutation — <lens>`), compared to the fully trimmed line by exact string equality |
| Preamble | Every non-blank line before `start` (the first line of the matched form) |
| Trailing segment | Every non-blank line after the affirmation line |

### Interfaces

No exported signature changes. `normaliseCleanRefutation(content)` keeps returning `{ content, normalised, lens, form }`; a rejection returns `{ content: original, normalised: false, lens: null, form: null }` as today.

```
FUNCTION isGuardHeading(line) -> boolean          # module-private, new
  t = line with leading [ \t]+ removed
  RETURN SEVERITY_LIKE_HEADING_RE.test(t) OR REFUTATION_NAMESPACE_RE.test(t)
```

- `ATX_HEADING_RE`, `SEVERITY_LIKE_HEADING_RE`, `REFUTATION_NAMESPACE_RE`, `MID_LINE_*_RE` and `FINDING_BULLET_RE` keep their current source text.
- Strip only `[ \t]`, not `trimStart()`: Markdown indentation is spaces and tabs, and a non-breaking-space prefix is not an indent.

New module `eval/review-bench/clean-refutation.mjs` (node built-ins only, no imports outside `eval/review-bench/`):

```
EXPORT CLEAN_REFUTATIONS            # moved verbatim from run-bench.mjs (heading + sentence, four lenses)
EXPORT FUNCTION isCleanRefutation(content) -> boolean   # moved from run-bench.mjs, with this ticket's guard change
```

`run-bench.mjs` imports `isCleanRefutation` from `./clean-refutation.mjs` and drops its local copy, the three bench regexes and its local `CLEAN_REFUTATIONS` (nothing else in the file uses them; `SEV` stays in `run-bench.mjs` for `shape()`).

## 4. HOW

### Guard changes in `normaliseCleanRefutation`

```
PROCEDURE normaliseCleanRefutation(content):        # only changed steps shown
  ... split, find last affirmation, same-line remainder guard (unchanged)
  trailing guard:
    FOR i in affirmationIdx+1 .. lines.length-1:
      IF isGuardHeading(lines[i]): REJECT              # was: column-0 regexes
  ... FAFF-1223 bullet guard (unchanged)
  ... form selection (unchanged; still uses column-0 ATX_HEADING_RE and isDecorativeHeader)
  preamble guard:
    FOR i in 0 .. start-1:
      IF lines[i].trim() == entry.heading: CONTINUE    # own heading exemption
      IF isGuardHeading(lines[i]): REJECT              # was: column-0 SEVERITY_LIKE_HEADING_RE only
  RETURN canonical token with entry.lens and form
```

- The exemption applies to the preamble only. The trailing guard keeps rejecting any `## Refutation —` heading after the affirmation, own lens included, exactly as today.
- Form selection is untouched. On line 0 the outer `trim()` strips the indent, so an indented heading there is classified exactly as at column 0 (`  ## Summary` / `No QA objection.` stays `header-wrapped`). On any later line an indented heading directly above the affirmation is not an ATX heading at column 0, so the body falls to `bare` and the indented line lands in the preamble, where the new guard sees it. An indented decorative heading still normalises either way (`header-wrapped` on line 0, `bare` after it), as today.
- The outer `trim()` stays. The guard helper makes line 0 and every later line behave the same, which removes the accidental line-0 asymmetry.

**Anti-pattern:** widening `SEVERITY_LIKE_HEADING_RE` / `REFUTATION_NAMESPACE_RE` with `^[ \t]*`. Why: `isDecorativeHeader` also uses them to classify a column-0 heading, and their FAFF-927 comments describe column-0 semantics; one helper keeps the guard-only widening in one visible place.

**Anti-pattern:** exempting any heading that names the entry's lens case-insensitively. Why: it accepts near-miss spellings the `headed` arm already rejects directly above the affirmation, so the two positions would disagree.

### Behaviour by body

| Body | Today | After |
|---|---|---|
| `## Refutation — architectural` / prose / `No QA objection.` | `bare` | rejected |
| prose / `  ### major: x` / `No QA objection.` | `bare` | rejected |
| `No QA objection.` / `  ### major: x` | `bare` | rejected |
| `No QA objection.` / `\t## Critical: y` | `bare` | rejected |
| `No QA objection.` / `  ## Refutation — architectural` | `bare` | rejected |
| `## Refutation — architectural` / `No architectural objection.` / `## Refutation — QA` / `No QA objection.` (stacked) | `headed` (QA) | rejected |
| ```` ``` ```` / `    ### major: example` / ```` ``` ```` / `No QA objection.` | `bare` | rejected (accepted residual) |
| `## Refutation — QA` / prose / `No QA objection.` | `bare` | `bare` |
| `  ## Refutation — QA` / prose / `No QA objection.` | `bare` | `bare` |
| `## Refutation — architectural` / `no methodology signal available.` / `No architectural objection.` (test :1902) | `bare` | `bare` |
| `## Refutation — methodology` / `No methodology signal available.` / `No methodology objection.` (test :1902) | `bare` | `bare` |
| `## Refutation — QA` / `no methodology signal available.` / `No QA objection.` (test :1927) | `bare` | `bare` |
| `# Code review` / `No QA objection.` | `header-wrapped` | `header-wrapped` |
| `  ## Summary` / `No QA objection.` (line 0, indent trimmed) | `header-wrapped` | `header-wrapped` |
| `Prose.` / `  ## Summary` / `No QA objection.` | `bare` | `bare` |
| `## Refutation — QA  ` (trailing spaces) / prose / `No QA objection.` | `bare` | `bare` |
| `## Refutation — QA` / `No QA objection.` / trailing prose | `headed` | `headed` |

Every "Today" and "After" cell above was reproduced against the current module and a prototype of this change.

### Review-bench mirror

- Move `CLEAN_REFUTATIONS`, the three bench regexes and `isCleanRefutation` from `run-bench.mjs` (:174-237, excluding `SEV`) into `eval/review-bench/clean-refutation.mjs`, exported. Carry the FAFF-905 / FAFF-1053 / FAFF-1154 comment block with it.
- Apply the same two loop changes: a local `isGuardHeading` (left-trim `[ \t]+`, then severity or namespace) in the trailing loop, and the own-heading exemption plus `isGuardHeading` in the preamble loop.
- `run-bench.mjs` imports `{ isCleanRefutation }` from `./clean-refutation.mjs`. The kit stays copyable as a directory with zero npm dependencies (README :5-6, :230).
- Parity is one-directional, because the mirror is a subset: for every row of the shared table, `isCleanRefutation(body) === true` implies `normaliseCleanRefutation(body).normalised === true`, and every row production rejects is also rejected by the mirror.

### Comment and prose updates

1. `review-call.mjs` :699-703: "a genuine finding or a wrong-lens heading after it still rejects" becomes "a genuine finding, or a `## Refutation —` heading after it or for another lens before it, still rejects, indented or not".
2. `review-call.mjs` :772-777: the preamble guard is now severity or namespace with the own-heading exemption; the preamble and trailing guards ignore leading spaces and tabs (FAFF-1238), deliberately stricter than the column-0 parsers because rejection is fail-safe.
3. `review-call.mjs` :807-810 and :857-858: the inline guard comments name both regexes and the indentation tolerance.
4. `SKILL.md` :62: replace "a genuine finding (`### <severity>:`) or a wrong-lens `## Refutation —` heading after the affirmation still rejects" with "a genuine finding (`### <severity>:`) before or after the affirmation, or a `## Refutation —` heading after it or for another lens before it, still rejects, even when indented". One clause, no history; `faff validate-adapters` must pass.

### Edge cases

- Several guard headings: the first hit rejects; order is irrelevant to the result.
- Own heading repeated in the preamble: each copy is exempt.
- Own heading with trailing spaces in the preamble: exempt (full trim).
- Own heading in a near-miss spelling (`## refutation — qa`, `### Refutation — QA`, `## Refutation - QA`) in the preamble: rejected, consistent with the `headed` arm (`## refutation — qa` / prose / `No QA objection.` flips from `bare` to rejected; 0 occurrences in the corpus).
- Same-line remainder: unchanged; `MID_LINE_*_RE` are unanchored already.
- A line indented four or more spaces is a code block in CommonMark, not a heading; the guard still rejects it (accepted residual, decision below).

### Failure modes

- **A refuter starts emitting multi-lens bodies.** How you'd know: a rise in exit 10 `MALFORMED` for one backend in `.faff/spec-review/*/raw/` captures whose bodies hold more than one `## Refutation —` heading. What it means: proceed if rare (the chain advances); if a backend does it routinely, fix the brief or add an explicit multi-lens form in a follow-up rather than loosening this guard.
- **A clean body carries a severity-worded code comment.** How you'd know: a captured clean-looking body rejected with an indented `# minor:`-style line inside a fence. What it means: proceed; it costs one chain advance, and the alternative reopens the finding-swallow hole.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the body "## Refutation — architectural\nSome prose here.\nNo QA objection."
When normaliseCleanRefutation runs
Then it returns { content: <the original body>, normalised: false, lens: null, form: null }
```

```
Given the body "Prose.\n  ### major: x\nNo QA objection."
When runReviewChain serves it from a scripted single-backend chain
Then the exit is not OK, failureClasses is [MALFORMED], and content is not CANONICAL_NO_FINDINGS
```

```
Given the body "## Refutation — QA\nno methodology signal available.\nNo QA objection."
When normaliseCleanRefutation runs
Then it returns normalised true, lens "QA", form "bare", exactly as before this ticket
```

- Every body in the capture corpus (section 7) returns the same `normalised` value before and after the change.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| Where indentation tolerance lives | Widen both regexes with `^[ \t]*`; a guard helper that left-trims before testing | **Chosen:** a module-private `isGuardHeading` helper used by both guard loops; regexes unchanged |
| Own-lens heading in the preamble | No exemption; exact match after trim; case-insensitive lens match | **Chosen:** exempt only when the trimmed line equals `entry.heading` exactly |
| The stacked multi-lens body | Keep it `headed`; exempt only the heading directly above; reject | **Chosen:** reject |
| A severity-worded indented line inside a code fence in a clean body | Fence-aware scanning; accept the rejection | **Chosen:** accept the rejection as a fail-safe residual |
| The review-bench mirror | Leave it; update in place with no test; read the source text from a test; move it to an importable sibling module with a parity test | **Chosen:** move to `eval/review-bench/clean-refutation.mjs`, update in lockstep, add a one-directional parity test |
| Parser and bullet parity | Widen the parsers and `FINDING_BULLET_RE` too; leave them column-0 | **Chosen:** leave them column-0 |

**Indentation tolerance.** `SEVERITY_LIKE_HEADING_RE` and `REFUTATION_NAMESPACE_RE` have two jobs: guard scans, and `isDecorativeHeader`'s classification of the column-0 heading the form selection already confirmed with `ATX_HEADING_RE`. Widening the regexes would not change `isDecorativeHeader`'s result (it requires a column-0 ATX heading first) but would blur what the constants mean and their FAFF-927 comments. A helper keeps the guard-only widening explicit and fixes the line-0 asymmetry with one rule.

**Own-heading exemption.** Without it, tests :1902 and :1927 (own heading, then a near-miss signal line, then the affirmation, expecting `bare`) flip. Exact match mirrors the `headed` arm, which accepts only the exact heading; a looser match would accept in the preamble what the same heading directly above the affirmation rejects.

**Stacked body.** A body carrying another lens's section is ambiguous: it may be a multi-lens answer or a finding under the wrong heading, and the normaliser cannot tell which. Rejection sends it to exit 10 and the chain advances. No test covers it today and 0 of 515 captured bodies contain it. Exempting only the heading nearest the affirmation would still let `## Refutation — architectural` plus prose plus `No QA objection.` through, which is the bug.

**Code-fence residual.** Fence-aware scanning adds a Markdown state machine to a guard whose job is to fail safe. The case does not occur in the corpus, and its cost is one chain advance.

**Mirror.** `run-bench.mjs` cannot be imported by a test (top-level `parseArgs(process.argv)`, `process.exit`, network calls), and importing production into the kit would break its copy-the-directory, zero-dependency property. FAFF-1053's spec (:115) already named drift risk, and this ticket's bug exists in both copies. A sibling module inside `eval/review-bench/` keeps the kit self-contained and lets `test/adversarial-call.test.mjs` import it (tests already import from `eval/`, for example `test/eval-cli-driver.test.mjs`). Parity is one-directional because the mirror deliberately lacks `headed+signal` and `header-wrapped`.

**Parser parity.** An indented `### major: x` is not a finding to any parser, so a rejected body is garbled, not findings-shaped; that is the fail-safe outcome. Widening the parsers would change what parses for every refuter and code reviewer, and FAFF-1223's bullet parity test pins indented bullets as non-matching.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. The ticket's open question is answered from the captures:

- **Question:** does allowing leading whitespace in the guards reject any legitimate clean output seen in the eval captures?
- **Answer: no.** A prototype of this change was run over 515 captured bodies: 428 production raw lens outputs (`.faff/spec-review/*/raw/`, excluding `.err`), 30 review-bench `*.content.md` results, and 57 GLM 5.3 spike strings containing `objection.` (`records/spikes/2026-10-08-glm-5-3-refutation/runs/*.jsonl.gz`).
- 49 bodies normalise today (26 production and bench, 23 GLM); all 49 still normalise, with 0 flips in either direction.
- Only 5 bodies contain any indented `#` line, and none of them normalises today (code comments inside findings bodies or malformed outputs, and indented decorative headings in malformed DeepSeek bodies).
- The remaining risk is theoretical (a severity-worded indented line in a clean body) and is accepted above.

**Assumptions:** none beyond the cited code.

## 8. DONE

### From WHY
- [ ] `## Refutation — architectural` / `Some prose here.` / `No QA objection.` returns `normalised: false` with `content` byte-identical
- [ ] `Prose.` / `  ### major: x` / `No QA objection.` returns `normalised: false`
- [ ] Every existing `normaliseCleanRefutation` test (FAFF-746, FAFF-927, FAFF-942, FAFF-1053, FAFF-1154, FAFF-1222, FAFF-1223 blocks) passes without changing its assertions, including :1902 and :1927

### From WHAT
- [ ] `isGuardHeading` strips only leading spaces and tabs, then tests `SEVERITY_LIKE_HEADING_RE` or `REFUTATION_NAMESPACE_RE`
- [ ] The source text of `ATX_HEADING_RE`, `SEVERITY_LIKE_HEADING_RE`, `REFUTATION_NAMESPACE_RE`, `MID_LINE_SEVERITY_RE`, `MID_LINE_NAMESPACE_RE` and `FINDING_BULLET_RE` is unchanged, and no file under `plugin/skills/faffter-dark-spec-review/` changes
- [ ] `eval/review-bench/clean-refutation.mjs` exports `isCleanRefutation` and `CLEAN_REFUTATIONS`, imports only node built-ins, and `run-bench.mjs` imports `isCleanRefutation` from it with no local copy left

### From HOW (`test/adversarial-call.test.mjs`, one FAFF-1238 heading-guard table)
- [ ] Reject rows: wrong-lens heading then prose before the affirmation; the same with a plain hyphen and with `###`; an indented wrong-lens heading before the affirmation (not on line 0); `  ### major: x` before the affirmation (not on line 0); `  ### major: x`, `\t## Critical: y` and `  ## Refutation — architectural` after the affirmation; `## refutation — qa` / prose / `No QA objection.`; the stacked architectural-then-QA body; the fenced `    ### major: example` body. Each returns `{ content: <input>, normalised: false, lens: null, form: null }`
- [ ] Keep rows: own heading then prose (`bare`); indented own heading then prose (`bare`); own heading repeated in the preamble (`bare`); the four :1902 bodies and the :1927 body (`bare`); `# Code review` and `  ## Summary` (line 0) above the affirmation (`header-wrapped`); `Prose.` / `  ## Summary` / `No QA objection.` (`bare`); own heading with trailing spaces then prose (`bare`); canonical `headed` and `headed+signal` bodies with trailing prose (labels unchanged). Each returns the listed `lens` and `form`
- [ ] Integration: `runReviewChain` with `scriptedRunReview` serving `Prose.\n  ### major: x\nNo QA objection.` gives `res.exit !== EXIT.OK`, `failureClasses` deep-equal to `[EXIT.MALFORMED]`, and `res.content !== CANONICAL_NO_FINDINGS`
- [ ] Parity: for every row of the table, `isCleanRefutation(body)` true implies `normaliseCleanRefutation(body).normalised` true, and every reject row returns false from `isCleanRefutation`
- [ ] Mirror still accepts: `isCleanRefutation` returns true for every keep row whose production form is `bare` or `headed` (the forms the mirror supports), so a broken extraction that rejects everything fails the test

### From HOW (prose)
- [ ] Comments at `review-call.mjs` :699-703, :772-777, :807-810 and :857-858 describe the preamble namespace check, the own-heading exemption and the indentation tolerance
- [ ] `SKILL.md` :62 carries the one-clause rule from section 4, and `faff validate-adapters` passes

### Integration smoke test

```
1. body = "## Refutation — architectural\nSome prose here.\nNo QA objection."
2. normaliseCleanRefutation(body)      -> normalised false, content === body
3. isCleanRefutation(body)             -> false
4. runReviewChain over one scripted backend returning body
                                       -> exit != OK, failureClasses [MALFORMED], content != CANONICAL_NO_FINDINGS
5. normaliseCleanRefutation("## Refutation — QA\nSome prose here.\nNo QA objection.")
                                       -> normalised true, lens "QA", form "bare"
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (P4):** No issues.
  - It is one increment: a single guard helper used by two loops in `normaliseCleanRefutation`, the same change in the review-bench mirror, one test table, one parity test and four prose updates. That fits a 1 to 3 day unit.
  - The mirror extraction (`eval/review-bench/clean-refutation.mjs`) looks like a second concern, but the parity test compares the two copies, so they have to ship together. Splitting would leave the bench reporting `clean-pass` on bodies that production now rejects. The fix belongs in the same PR.
  - Build order inside the PR: land the production guard and its table first, then the mirror move and the parity test. If the mirror move goes badly, the production fix can still ship by itself.
- **Split / merge against siblings (P4):** No issues. Keep all four tickets separate.
  - **FAFF-1240** (`parseBullets` run-on in `parse-refutation.mjs`): the files don't overlap. This spec requires that nothing under `plugin/skills/faffter-dark-spec-review/` changes, and it leaves `FINDING_BULLET_RE` / `BULLET_RE` alone. FAFF-1240 is about the quality of evidence text and never affects gating; FAFF-1238 is about gating safety.
  - **FAFF-1239** (review-call hang after a backend serves): same file (`review-call.mjs`) but a different code path (backend handle and timer lifetime, not body normalisation). If both are built at the same time, rebase whichever lands second; no blocker link is needed.
  - **FAFF-1243** (eval fixtures with an empty DONE): different files and a different outcome (how the eval is graded). No relationship to this ticket.
- **Workstream fit (P1 + P5):** No issues for this ticket. One observation about the loose set.
  - FAFF-1238 sits project-less in Backlog, which is the correct default landing for bug work discovered during execution.
  - FAFF-1238, FAFF-1239, FAFF-1240 and FAFF-1243 all came out of the FAFF-1222 / FAFF-1223 / GLM 5.3 refuter work. They may share one outcome, roughly "a non-Claude backend can sit in the refuter chain without a finding being misreported, dropped or mis-graded".
  - What to do: let the next `/faff-tidy` or rehoming pass decide whether the cluster is cohesive enough for an outcome-led home. This does not block this ticket.
- **Surfaced dependencies (P6):** No issues.
  - Every piece of work the spec depends on has shipped: FAFF-1154, FAFF-1222 (#1024) and FAFF-1223 (#1026). No blocker link is missing.
  - FAFF-1223 is now linked as related, since the spec cites it in three places.
- **Risk profile (P7):** No issues. No de-risking spike is needed.
  - Every change fails toward rejection: a rejected body becomes exit 10 `MALFORMED` and the chain moves to the next backend. There are no new exit codes, fault shapes or caller changes.
  - A prototype run over 515 captured bodies showed 0 flips in either direction.
  - The one accepted residual (a severity-worded indented line inside a code fence) costs one chain advance, and the spec gives a failure-mode signal for spotting it.
- **Value x risk sequencing (P2):** This closes a hole where a real finding gets silently rewritten to clean, which makes it the highest-value fix in the cluster, ahead of FAFF-1240 and on a par with or ahead of FAFF-1239. Small, low-risk, high-value: a reasonable first pick.

confidence: high
build-tier: complex
spec-review: accept (agent, after round 1: two minor objections (architectural, QA) fixed in place under the operator's standing fix-minors-and-build preference)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```
