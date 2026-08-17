# Spec: FAFF-850 — one field-reader, bounded so a blank metadata field reads blank

> Spec: faffter-dark-nlspec · 2026-08-17 · interactive · claude-code/unknown · confidence: high · build-tier: complex. Full spec on Linear FAFF-850.

_Revised 2026-08-17 — spec-review (revise): completed the sibling-regex audit. Swept `prd.js:144` for pre-colon uniformity and named `adr.js:175-176`, `adr.js:852`, and `prdr.js:850` as the deliberately-excluded set, so the "audit complete" claim is now provably true._

This is the build-ready spec for FAFF-850. Its audience is the build agent that will implement the fix and the human reviewer gating it. It fixes a parser that reads a blank metadata field as the text of the next line, removes the byte-identical fork of that parser, and defensively tightens the sibling regexes that share the same idiom. The load-bearing change is small; most of this document is about doing it once, in one place, and proving the blank case stays fixed.

## 1. WHY — Problem and Principles

**The model to hold in your head.** Every ADR / PRD / PRDR / decision-register record is a markdown file with a metadata block of `- **Field:** value` lines. One tiny regex, written three times over, turns a field name into its value. That regex matches across the whole document with the multi-line flag but no dotall, so `^` and `$` are per-line anchors. The bug is that one whitespace class in it, `[\s*]*`, still matches a newline even under the multi-line flag, because `\s` inside a character class is flag-independent. So when a field is present but blank, the class swallows the line break and the value capture reaches down into the next non-blank line. Bound that one class to non-newline whitespace and a blank field reads back blank. Everything else in this spec follows from doing that bounding in exactly one shared place instead of three divergent copies.

**Problem statement.** The shared field reader (`adrField`, `plugin/skills/faff/bin/lib/adr.js:65-72`, regex at line 70) reads a present-but-blank metadata field as the following line's text: `faff prdr new --prd-goal ""` then `faff prdr list --json` returns `"prd_goal": "## Context"` (the heading that follows) instead of empty. The same regex is copied verbatim into `decisionField` (`decisions.js:60-63`, whose own comment says it "Mirrors adr.js's adrField verbatim") and the idiom recurs in six sibling regexes that edit, extract, or test-for Status/Supersedes/PRD values. This change collapses the two readers into one, fixes the regex once there, sweeps the siblings defensively, and adds blank-field regression fixtures so the case cannot silently return.

**Design principle: one reader, one regex, one home.** The whole point of this change is to stop the parser existing in more than one place. The fix must leave exactly one definition of the field-reading regex. Any implementation that fixes `adrField` but leaves `decisionField` as a second live copy of the regex is rejected even if both are individually correct, because it recreates the exact divergence that let this bug hide.

**Design principle: preserve the tolerant, per-line matching the readers rely on.** The reader deliberately tolerates every bold/colon arrangement (`- **Status:** v`, `- **Status**: v`, `- Status: v`) and matches anywhere in a multi-line document via the `mi` flags with a mandatory colon. The fix narrows only the whitespace that may sit around the colon; it must not remove the leading list/blockquote/bold tolerance, must not add the dotall flag, and must keep the `^`/`$` anchors working per line. A change that makes a legitimately-populated field stop parsing is worse than the bug.

**Design principle: record, do not judge.** The readers and validators are lenient by construction so hand-written legacy records keep validating. The fix changes only the blank-value reading; it must not tighten what counts as a valid field beyond that. The one downstream validation that changes behaviour (`prdrValidate`) does so because the reader now tells it the truth, not because the fix added a new rule.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` | JavaScript (Node) | Home of the buggy shared reader (`adrField`, l.65-72, regex l.70) plus four sibling regexes (l.117, 167, 269, 413) and the `adrSelftest` battery (l.616) |
| `plugin/skills/faff/bin/lib/decisions.js` | JavaScript (Node) | Carries the verbatim fork `decisionField` (l.60-63) and its selftest (`decisionsSelftest`, l.192) |
| `plugin/skills/faff/bin/lib/prdr.js` | JavaScript (Node) | Imports `adrField` (l.18), reads `PRD-goals` (l.76), one sibling regex (l.227), `prdrValidate` goal guard (l.132), `prdrSelftest` (l.557) |
| `plugin/skills/faff/bin/lib/prd.js` | JavaScript (Node) | Imports `adrField` (l.15), reads four fields (l.63-67), `prdSelftest` (l.221) |
| `plugin/skills/faff/bin/lib/contract-defs.js` | JavaScript (Node) | `computePrdCoverageVerdict` (l.1583-1615) folds cited goals; a phantom `## Context` currently pollutes `citedGoals` |
| `.github/workflows/validate.yml` | YAML | CI runs `faff regions selftest --region factory|governance` and live `faff adr validate` / `faff prdr validate` |

**Scope statement.** This sits at the record-parsing layer shared by the ADR, PRD, PRDR, and decision-register commands; it is a bug fix plus a dedupe, not a new feature or a schema change.

## 2. OUT OF SCOPE

- **Rewriting the metadata format or the record templates** — Why excluded: the templates (`prdrTemplate` at `prdr.js:97`, the ADR/PRD equivalents) are correct; the bug is in reading, not writing. Extension point: if the metadata block ever moves to structured front-matter, that is a separate parser and a separate issue, and would replace `fields.js` wholesale.
- **Tightening the leading `^[\s>*-]*` marker class or the `[^\s*].*` value capture in the reader** — Why excluded: the leading class must keep eating list/blockquote/bold markers, and the value capture already excludes newlines (a non-space first char, then `.` which does not cross line terminators without the `s` flag); neither participates in the bug. Extension point: none needed; leaving them untouched is deliberate.
- **The two regexes at `adr.js:175-176`** — Why excluded: the ticket audit confirms they carry no post-colon whitespace class (the value runs straight off the `:` via `.*`), so they cannot bleed into the next line. Extension point: none; do not modify them.
- **The selftest helper regexes at `adr.js:852` and `prdr.js:850`** — Why excluded: both are test-only scaffolding reading back a Status token with `(\S+)`, which cannot cross a line; changing them buys nothing. `prdr.js:850` is the PRDR twin of `adr.js:852`. Extension point: none.
- **Making `faff prdr new` reject an empty `--prd-goal` at write time** — Why excluded: `requireFlags` (`argv.js:185-193`) rejects only a null flag, not `""`, and this issue is about the read path being honest, not about forbidding blank input; the re-activated `prdr validate` is the correct guard. Extension point: if empty goals should be refused at authoring time, that is a new validation on the write path (`prdr.js:352-370`), filed separately.
- **Back-filling or migrating any existing committed records** — Why excluded: the build-time grep (see Assumptions) is expected to find none; if it finds any, that is surfaced to the human, not auto-migrated here.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Field reader | The function that, given a record's full text and a field name, returns the field's value string or `null` if the field line is absent |
| Absent field | The field line does not appear in the document at all — the reader returns `null` (unchanged behaviour) |
| Blank field | The field line is present but its value is empty (`- **PRD-goals:** ` followed by end of line) — the reader must return `null`, never the next line's text |
| Sibling regex | Another regex sharing the `[\s*]*` colon idiom that edits, extracts, or tests-for a Status/Supersedes/PRD value |
| Post-colon class | The `[\s*]*` occurrence immediately after the `:` — the load-bearing one that swallows the newline |

**The shared reader interface.** A new module `plugin/skills/faff/bin/lib/fields.js` exports a single pure function:

```
FUNCTION readField(text: String, name: String) -> String | null
  # text: the full record file text (may be multi-line)
  # name: the field name to read (e.g. "Status", "PRD-goals"), interpolated into the regex
  # returns: the trimmed value string, or null if the field line is absent OR present-but-blank
  # tolerates: "- **Name:** v", "- **Name**: v", "- Name: v"; leading list/blockquote/bold markers
  # matches: anywhere in a multi-line document, per-line (flags "mi", no dotall); colon is mandatory
  CONSTRAINT a blank field value yields null, never the following line's text
  CONSTRAINT the leading marker tolerance and the mandatory colon are preserved unchanged
```

**The regex, before and after.** The current shared regex (`adr.js:70`, a template string) is:

```
^[\s>*-]*${name}[\s*]*:[\s*]*([^\s*].*)$        flags: mi
```

The fix bounds the two whitespace classes that sit around the colon to non-newline whitespace, leaving the leading marker class and the value capture untouched:

```
^[\s>*-]*${name}[ \t*]*:[ \t*]*([^\s*].*)$      flags: mi
```

**Design decision — where the one reader lives.** A dedicated neutral module versus keeping it inside `adr.js`. The reader is domain-neutral: `adr.js`, `prd.js`, `prdr.js`, and `decisions.js` all read fields, and only `decisions.js` is unrelated to ADRs. Housing the single source of truth in `adr.js` would force the governance-register module to import `adr.js` purely for a string parser. **Chosen:** a new `plugin/skills/faff/bin/lib/fields.js` exporting `readField`, matching the repo's one-purpose-per-lib-module convention (the `lib/` directory already holds ~90 such small modules); `adr.js` keeps the name `adrField` as a thin back-compat alias so its importers do not churn (see rationale in section 6).

**Design decision — the replacement whitespace class.** `[^\S\n]*` versus `[ \t*]*`. The class must still admit the asterisks of `**` bold markers, so a pure non-space class does not fit without an alternation. **Chosen:** `[ \t*]*` (space, tab, asterisk) for both the pre-colon and post-colon occurrences. Rationale in section 6.

## 4. HOW — Behaviour

**Architecture and approach.** Three moves, in order:

1. **Create the one reader.** Add `fields.js` with `readField(text, name)` carrying the fixed regex. Move the tolerant-shape comment from `adr.js:66-69` onto it so the single home also carries the single explanation.
2. **Collapse both forks onto it.** In `adr.js`, replace the `adrField` function body (l.65-72) with a delegation to `readField`, keeping `adrField` exported (l.919 unchanged) so `prd.js:15` and `prdr.js:18` importers are untouched. In `decisions.js`, delete the forked regex (l.60-63) and replace it with `const decisionField = readField;` after importing `readField` from `./fields`; `decisionField`'s six callers (l.89-98) are untouched. `decisionField` is not exported and is used only within `decisions.js`, so no export list changes there.
3. **Sweep the siblings and add fixtures.** Apply the same `[\s*]* -> [ \t*]*` tightening to the six enumerated sibling regexes, then add blank-field cases to the four selftest batteries.

**Behaviour summary of the reader after the fix.** Given a record's text and a field name, `readField` returns the trimmed value when the field line is present and non-blank, and `null` when the field line is either absent or present-but-blank; it never returns text from a different line.

```
PROCEDURE readField(text, name):
  1. Build regex: ^[\s>*-]*<name>[ \t*]*:[ \t*]*([^\s*].*)$  with flags "mi"
  2. m = text.match(regex)
  3. IF m: return m[1].trim()
  4. ELSE: return null    # covers both absent field and present-but-blank field
```

Why a blank field now yields `null`: with the post-colon class bounded to `[ \t*]`, the class stops at the line break; the value capture `([^\s*].*)` then needs a non-space, non-asterisk character on that same position, finds the newline (excluded), and the whole per-line match fails; the engine retries `^` at the next line, which does not start with the field name, so no match is produced and step 4 returns `null`.

**The sibling sweep — exact edits.** Each of these keeps its own capture and flags; only the `[\s*]*` around the colon changes to `[ \t*]*`. They are currently guarded (they run only on non-blank fields, or are boolean existence tests / test-only scaffolding), so this is defence-in-depth, not a live-bug fix; sweeping them means the idiom cannot bite if a future caller feeds a blank field, and it makes the "one uniform rule" claim true across every non-scaffolding occurrence.

| Site | Current fragment | After |
|---|---|---|
| `adr.js:117` (`recordSupersedesSet`, capture-form, `gim`) | `Supersedes[\s*]*:[\s*]*([^\n]+)` | `Supersedes[ \t*]*:[ \t*]*([^\n]+)` |
| `adr.js:167` (`recordSupersede` status replace, `mi`) | `Status[\s*]*:[\s*]*).*$` | `Status[ \t*]*:[ \t*]*).*$` |
| `adr.js:269` (`renumberRefsTo`, template string, `gim`) | `Supersedes[\\s*]*:[\\s*]*.*?` | `Supersedes[ \\t*]*:[ \\t*]*.*?` |
| `adr.js:413` (`adrAccept` status replace, `mi`) | `Status[\s*]*:[\s*]*).*$` | `Status[ \t*]*:[ \t*]*).*$` |
| `prdr.js:227` (`prdrAccept` status replace, `mi`) | `Status[\s*]*:[\s*]*).*$` | `Status[ \t*]*:[ \t*]*).*$` |
| `prd.js:144` (`prdValidate` PRD-link existence test, pre-colon class only, `mi`) | `\*{0,2}PRD[\s*]*:` | `\*{0,2}PRD[ \t*]*:` |

`prd.js:144` carries only the pre-colon class (no post-colon class, no value capture), so it can never bleed a value across a line even today; it is swept purely so the "tighten the pre-colon occurrence too" rule holds uniformly. Note the template-string sites (`adr.js:70`, `adr.js:269`) escape the backslash, so the token is `[\\s*]*` in source and becomes `[ \\t*]*`; the literal-regex sites use `[\s*]*` and become `[ \t*]*`. At `adr.js:269`, the `[-\\s]` that follows the interpolated prefix is a number-separator class, not a field-value class; leave it unchanged.

**Deliberately excluded from the sweep** (independently grep-audited, not swept): `adr.js:175-176` (no post-colon whitespace class — the value runs straight off the `:` via `.*`), and the two test-only scaffolding helpers `adr.js:852` and its PRDR twin `prdr.js:850` (both `(\S+)` captures that cannot cross a line). These are named here so the audit is complete rather than implicitly closed.

**Anti-pattern:** fixing `adr.js:70` and separately hand-fixing `decisions.js:61` to the same corrected regex. Why: that keeps two live copies of the regex and re-creates the divergence this issue exists to remove; the fork must be deleted and delegated, not independently patched.

**Anti-pattern:** widening the sweep to `adr.js:175-176` or `adr.js:852`. Why: the audit confirms neither carries a post-colon whitespace class that can bleed, and touching them risks changing tolerant matching or test scaffolding for no gain.

**Anti-pattern:** adding the `s` (dotall) flag or removing `m` to "simplify". Why: the readers match metadata anywhere in a multi-line document and rely on per-line `^`/`$`; dotall would make `.` cross lines and reintroduce the bleed through a different door.

**Failure modes.**

- **The failure:** the `[ \t*]*` narrowing accidentally stops a legitimately-populated field from parsing (for example a CRLF record, where a stray `\r` now falls outside the class). **How you'd know:** a clean tree that validated before the change starts emitting `missing <Field>` problems from `faff adr validate` / `faff prdr validate`, or a selftest that reads back a known value fails. **What it means:** narrow — the class is too tight; but note the value capture already stops before `\r` (a line terminator `.` does not cross), so the pre-existing behaviour for CRLF is unchanged and this is expected to stay green. If it does not, revisit the class rather than the flags.
- **The failure:** re-activating the `prdrValidate` goal guard newly fails CI because a committed PRDR record already carries a blank goal field. **How you'd know:** live `faff prdr validate` (validate.yml:79) fails on `main` after the change with `missing PRD-goal(s) citation field` for an existing file. **What it means:** proceed, but surface — the guard is now correctly firing on a real gap; the build-time grep (Assumptions) is the pre-check, and the current repo-wide result is zero such records, so no live break is expected. If the grep finds one at build time, stop and surface it to the human rather than auto-editing the record.
- **The failure:** a caller somewhere depends on the old cross-line reading (treats the phantom next-line value as meaningful). **How you'd know:** a selftest or a downstream command changes output in a way unrelated to the blank-field case. **What it means:** the assumption is unfounded — the explore confirms no caller wants the next heading; `listAdrs`, `listPrds`, `listPrdrs`, and `listEntries` all read metadata fields and an optional field is a whole-line-absent (`null`) case, distinct from a present-but-blank value. Proceed.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a PRDR file whose metadata line reads "- **PRD-goals:** " (present but blank) immediately followed by a "## Context" heading
When listPrdrs parses it
Then prd_goals is the empty array and prd_goal is "", and neither is "## Context"
```

```
Given that same blank-goal PRDR in the records directory
When faff prdr validate runs
Then it reports "<file>: missing PRD-goal(s) citation field" (the goal guard at prdr.js:132 fires)
```

```
Given an ADR file with "- **Status:** " blank, followed by a "## Context" heading
When adrField(text, "Status") runs (via the shared readField)
Then it returns null, and listAdrs reads status as null rather than "## Context"
```

- The shared regex retains its tolerant matching: `- **Status:** Accepted`, `- **Status**: Accepted`, and `- Status: Accepted` all read back `Accepted` after the change.
- Exactly one definition of the field-reading regex exists in the codebase after the change (in `fields.js`); `grep` for the `[\s*]*:[\s*]*([^\s*]` idiom finds no second reader.

## 6. Design Decision Rationale

**Where does the single reader live?**
- Options: (a) new neutral `lib/fields.js`; (b) keep it in `adr.js` and have `decisions.js` import from `adr.js`; (c) inline-copy again (status quo).
- (b) couples the governance register to the ADR module for a plain string parser; (c) is the bug. (a) matches the directory's one-purpose-module convention and keeps the parser domain-neutral.
- **Chosen:** a new `plugin/skills/faff/bin/lib/fields.js` exporting `readField` — the neutral home; `adr.js` and `decisions.js` both delegate to it, and the byte-identical fork is deleted.

**Keep the `adrField` name or repoint every importer?**
- Options: (a) keep `adrField` in `adr.js` as `const adrField = readField;`, still exported, so `prd.js:15` and `prdr.js:18` are untouched; (b) repoint both importers (and all six PRDR/PRD call sites) to import `readField` from `fields.js` and delete the `adrField` name.
- (b) is more churn across three files and rewrites working call sites for no behavioural gain; (a) preserves the public surface while still removing the duplicate regex.
- **Chosen:** (a) — keep `adrField` as a one-line delegating alias in `adr.js`; the fork removal is about deleting the duplicated regex, not renaming a working, exported function. `decisionField` (not exported, internal-only) likewise becomes `const decisionField = readField;`.

**Which whitespace class replaces `[\s*]*`?**
- Options: (a) `[ \t*]*` (space, tab, asterisk); (b) `[^\S\n]*` (any whitespace except newline) which drops the asterisk and would need an alternation to keep bold-marker tolerance; (c) `[^\S\n*]*` which is a malformed intent (negation cannot be mixed this way).
- The class must keep admitting `*` for `**` bold markers, so a pure non-space class does not fit cleanly. `[ \t*]*` is explicit and readable, excludes the newline, and for markdown metadata lines the only characters that ever appear around the colon are space, tab, and asterisk. CRLF is unaffected: the value capture already stops before `\r`.
- **Chosen:** `[ \t*]*` for both the pre-colon and post-colon occurrences in the reader and in the swept siblings. Tightening the pre-colon occurrence too (not only the post-colon one the ticket names) is strictly safer and reads as one uniform rule; it cannot regress, because a newline never legitimately appears between a field name and its colon.

**How wide is the sibling sweep?**
- Options: (a) sweep every non-scaffolding occurrence of the idiom — the five value-editing siblings (`adr.js:117, 167, 269, 413`, `prdr.js:227`) plus the pre-colon-only boolean test `prd.js:144` — while explicitly excluding the two things that cannot bleed; (b) sweep only the five value-editing siblings and leave `prd.js:144` implicit; (c) also rewrite the excluded set.
- An independent grep of the idiom finds two occurrences beyond the value-editing five: `prd.js:144` (a pre-colon `[\s*]*` in a boolean PRD-link existence test) and `prdr.js:850` (the test-scaffolding twin of `adr.js:852`). Neither can bleed a value across a line. Leaving `prd.js:144` untightened would contradict the spec's own "tighten the pre-colon occurrence too, one uniform rule"; leaving both unnamed would make the "audit complete" claim false.
- **Chosen:** (a) — sweep the five value-editing siblings plus `prd.js:144` for pre-colon uniformity (defence-in-depth, zero regression risk on a boolean test), and name `adr.js:175-176`, `adr.js:852`, and `prdr.js:850` as the deliberately-excluded set so the audit is provably complete rather than implicitly closed.

**Where do the regression fixtures go?**
- Options: (a) add cases to the existing in-file selftest batteries (`adrSelftest`, `prdrSelftest`, `decisionsSelftest`, `prdSelftest`); (b) create an external `*.test.js`.
- There is no external test runner in this repo; CI runs the in-file batteries via `faff regions selftest`. An external test would not be executed.
- **Chosen:** (a) — co-locate blank-value fixtures beside the existing missing-line fixtures in each battery. `prd.js` has a selftest (`prdSelftest`, l.221), so it is covered with no gap.

## 7. Open Questions and Assumptions

**Open Questions.** None. The chosen scope is fully settled.

**Assumptions.**

- **Assumes:** no committed record in the repo currently carries a present-but-blank field that the fix would newly flag. Validation instruction: at build time, run a repo-wide grep for a present-but-empty metadata field before merging, for example `grep -rEn '^[[:space:]>*_-]*\**(PRD-goals?|Status|Container|Date|Provenance|Chosen|Rationale|Scope|Matches|ADR|Mode)\**[[:space:]]*:[[:space:]]*$' --include=*.md .` — the current result is zero across the whole repo. If it returns any row, stop and surface it to the human (the re-activated `prdr validate` will correctly fail on a blank-goal PRDR under CI's live `faff prdr validate`); do not auto-edit the record.

## 8. DONE — Definition of Done

### From WHY
- [ ] `faff prdr new --prd-goal ""` then `faff prdr list --json` returns `"prd_goal": ""` (and `prd_goals: []`), not `"## Context"`.
- [ ] Exactly one definition of the field-reading regex exists after the change (in `fields.js`); no second copy of the `[...]*:[...]*([^\s*]` reader idiom remains.

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faff/bin/lib/fields.js` exists and exports `readField(text, name)` with the regex `^[\s>*-]*<name>[ \t*]*:[ \t*]*([^\s*].*)$` and flags `mi`.
- [ ] `readField` returns `null` for both an absent field line and a present-but-blank field line, and the trimmed value otherwise.
- [ ] The tolerant shapes `- **Name:** v`, `- **Name**: v`, `- Name: v` all still read back `v`.

### From HOW (behaviour)
- [ ] `adr.js` `adrField` delegates to `readField` (the duplicated regex is gone from `adr.js`), and `adrField` remains exported so `prd.js` and `prdr.js` importers are unchanged.
- [ ] `decisions.js` `decisionField` delegates to `readField` (the forked regex at l.60-63 is deleted), and its six callers are unchanged.
- [ ] The six sibling regexes (`adr.js:117, 167, 269, 413`; `prdr.js:227`; `prd.js:144` pre-colon-only) have their around-colon `[\s*]*` classes tightened to `[ \t*]*`; the deliberately-excluded set `adr.js:175-176`, `adr.js:852`, and `prdr.js:850` is unchanged.
- [ ] `computePrdCoverageVerdict` no longer folds a phantom `## Context` into `citedGoals` for a blank-goal live PRDR (verified: such a PRDR contributes zero cited goals).

### From HOW (edge cases and consequences)
- [ ] `faff prdr validate` reports `missing PRD-goal(s) citation field` for a PRDR whose goal field is present-but-blank (the `prdr.js:132` guard now fires).
- [ ] A clean records tree that validated before the change still validates (`faff adr validate`, `faff prdr validate`) after it — no legitimately-populated field stops parsing.
- [ ] The build-time blank-field grep was run and its result recorded (expected: zero committed records); any hit was surfaced to the human, not auto-edited.

### From tests (selftest batteries)
- [ ] `adrSelftest` (adr.js:616) has a case asserting a blank `Status` field reads back `null` and not the following heading.
- [ ] `prdrSelftest` (prdr.js:557) has a case asserting a blank `PRD-goals` field yields `prd_goals: []` / `prd_goal: ""` and that `prdrValidate` flags it.
- [ ] `decisionsSelftest` (decisions.js:192) has a case asserting a blank `Chosen` field reads back `null` and not the following `Rationale` line.
- [ ] `prdSelftest` (prd.js:221) has a case asserting a blank field (e.g. `Status` or `Container`) reads back `null` and not the following line.
- [ ] `faff regions selftest --region factory` and `--region governance` pass with the new fixtures.

### Integration smoke test

```
PROCEDURE smoke:
  1. In a temp records dir, write a PRDR via prdrTemplate with prdGoal = ""
     (yields "- **PRD-goals:** " immediately above "## Context")
  2. records = listPrdrs(dir)
  3. ASSERT records[0].prd_goals == []  AND  records[0].prd_goal == ""
  4. ASSERT prdrValidate(dir) contains a "missing PRD-goal(s) citation field" problem for that file
  5. ASSERT readField(text, "Status") for a blank Status fixture == null
```

If step 3 and step 4 both hold, the reader is honest and the guard it feeds is re-activated — the plumbing is connected.

## Methodology critique

_Methodology: faffter-dark-methodology-agile-delivery_

**Right-sized? (principle 4) — one unit, keep it bundled.** The spec bundles four moves: the pointed regex fix, extracting one shared `readField` and deleting the byte-identical `decisionField` fork, a defensive sweep of the guarded sibling regexes, and blank-field fixtures across four selftest batteries. That reads like four things, but they are not four independently-shippable things. The dedupe is not separable from the fix: the whole reason the bug hid is that the reader existed twice, so fixing `adrField` while leaving `decisionField` as a live second copy ships a still-broken parser and re-creates the exact divergence — they must land together, which is a merge argument, not a split one. The defensive sweep is the only plausible split candidate, since those siblings are guarded and carry no live bug. But it fails the split test the other way: on its own it is a ten-minute mechanical class substitution with no observable deliverable, not a standalone 1-3 day unit, and pulling it into a separate ticket would let the shared idiom drift again — the precise failure this work exists to close. Net: a comfortably sub-day mechanical change that happens to touch several files. The `complex` build-tier reflects surface count and the care to prove no regression, not scope size. Keep it as one ticket; do not split.

**Workstream fit? (principles 1, 5) — No issues.** Project-less in Backlog is the correct home. A shared-parser bug fix names no single currently-sequencable outcome, so it is genuinely independent work that belongs loose — the lens's default landing working as intended, not an orphaned ticket.

**Deps surfaced? (principle 6) — No missing blocker link; one coupling to keep visible.** The spec cites files, lines, and functions but no prerequisite ticket, so there is no tracker edge owed. The one real coupling is not ticket-to-ticket: re-activating the `prdrValidate` goal guard changes behaviour against committed repo state, and a blank-goal record already on `main` would newly fail live `faff prdr validate` in CI. The spec already carries that as a pre-merge check (the build-time grep, surface-to-human-not-auto-edit, and a DoD line) rather than as a blocker on another ticket, which is the right place for it. Nothing to add to the graph.

**Risk profile? (principle 7) — No spike needed; de-risking is correctly placed.** No novel integration, external dependency, or unproven approach — the bug is already root-caused, reproduced, and has a settled fix direction. The two live risks are both regression-shaped and both de-risked inline and early: the class-narrowing breaking a legitimately-populated field is caught by the tolerant-shape scenarios and the "clean tree still validates" done-criterion, and the merge-time CI surprise from the re-activated guard is pulled forward to a build-time grep rather than left to detonate at merge.

confidence: high
