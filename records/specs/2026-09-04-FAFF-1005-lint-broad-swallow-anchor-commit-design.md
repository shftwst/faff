# Spec — FAFF-1005: lint a broad error-swallow adjacent to the Step 9b anchor commit

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1005.

This spec is for the build agent implementing FAFF-1005, and for the human reviewers gating it. It adds one `faff validate-adapters` lint that flags a command-position broad error-swallow (`|| true` or `|| :`) attached to the Step 9b anchor commit in `faff-graft/SKILL.md`. It follows FAFF-1001, which reordered Step 9b to commit and push the governance anchor before `gh pr create`. The whole change lands in `plugin/skills/faff/bin/lib/validate-adapters.js` plus one new test file. It does not touch any `SKILL.md`.

## 1. WHY — problem and principles

The one idea this spec turns on: the lint must read only code spans, and flag `|| true` / `|| :` only when it shares a single code span with a `git commit` or `git add` command. The current correct prose names `|| true` to forbid it, but does so in a separate backtick span from any git command. A same-span requirement is what tells an executing swallow apart from prose that merely quotes the anti-pattern.

Problem statement. FAFF-1001 bounded the Step 9b anchor commit's error tolerance to the nothing-to-commit signal only, so a genuine commit failure aborts Step 9b before `gh pr create` rather than opening an anchor-less PR. Step 9b is agent-run skill prose with no executable unit, and the existing `checkAnchorBeforePrOrder` lint checks only the byte-order of `faff events anchor` versus `gh pr create`, nothing about commit error handling. A future edit that writes `git commit … || true` re-opens the anchor-less-PR window on a real commit failure and passes every current check.

Design principles.

**The lint must stay clean on the shipped tree.** The correct Step 9b prose already contains the literal string `|| true` in the sentence forbidding it. Any implementation that flags that sentence is self-defeating and fails the shipped-tree-clean test on day one. The command-position-versus-prose distinction is a requirement, not a refinement.

**Same shape as the sibling lints.** FAFF-1001 and FAFF-1004 both split a pure, exported, unit-tested reporter from a faff-graft-scoped call site that decides pass or fail. This lint follows that split so the three read as one family and share the Step 9b section-slice convention.

**Faff-graft-scoped.** Only `faff-graft/SKILL.md` runs Step 9b. The check must fire for that skill alone, so a `git commit … || true` in any other skill's prose raises nothing.

Reference context.

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript (CommonJS) | Host of `checkAnchorBeforePrOrder`; the new helper, the call site, and the export all live here |
| `plugin/skills/faff-graft/SKILL.md` | Skill prose (Markdown) | The linted subject; Step 9b is bounded by `**Step 9b:` … `**Step 10:`. Not edited by this ticket |
| `test/faff-1001-anchor-before-pr-order.test.mjs` | JavaScript (node:test, ESM) | Pattern source for the helper unit tests and the `runOnFaffGraft` CLI harness |

Scope statement. This is one more per-skill structural check in the `faff validate-adapters` conformance pass, sitting beside the FAFF-1001 order lint in the same faff-graft branch.

## 2. OUT OF SCOPE

- **Editing `faff-graft/SKILL.md`.** Why excluded: the shipped prose is already correct; this ticket only adds a guard against a future regression. Extension point: none, `SKILL_LINE_BASELINE["faff-graft"]` stays 856.
- **Runtime enforcement of the commit-abort behaviour.** Why excluded: Step 9b is agent-run prose with no executable unit, so the behaviour cannot be unit-tested; a static lint on the prose is the reachable guard. Extension point: an end-to-end graft harness that drives a real commit failure would live under `test/` beside the existing crash-timing E2E, a separate ticket.
- **Hardening the absent-Step-9b-section posture.** Why excluded: that is FAFF-1004's job for the order lint. Extension point: if FAFF-1004 lands a shared fail-closed section-slice helper, this lint adopts it then. See the relates-to note in Open Questions.
- **Extracting a shared `sliceStep9b(text)` seam.** This ticket adds a second independent copy of the `**Step 9b:`/`**Step 10:` bounds (the first is `checkAnchorBeforePrOrder`'s). Deduplicating them into one shared slice function is deferred — each copy is guarded by its own live-guard `scoped:true` assertion (From WHY), so divergence is caught, not silent. Extension point: FAFF-1004 (same file, same bounds) is the natural place to land the shared seam; whichever of 1004/1005 lands second extracts it.
- **Flagging narrowed, non-blanket tolerances.** Why excluded: the correct nothing-to-commit tolerance is expressed by inspecting git output, not by `|| true` / `|| :`, so it is not a broad swallow and must not be flagged. Extension point: none needed.
- **Detecting swallows on unformatted, bare-prose commands.** Why excluded: the house skill-authoring standard formats every command as inline code or a fenced block, so a code-span scan covers the realistic case; this is the same presence-only honest limit the sibling lints carry. Extension point: a Markdown-aware command extractor, only if bare-prose commands ever appear.

## 3. WHAT — vocabulary, types, and interfaces

Vocabulary.

| Term | Definition |
|---|---|
| Broad swallow | A shell error-swallow that unconditionally forces success: `\|\| true` or `\|\| :` following a command. It masks any non-zero exit, including a genuine failure. |
| Command-position swallow | A broad swallow that sits in the same code span as a `git commit` or `git add` command, so it would actually execute against that command. The anti-pattern this ticket forbids. |
| Prohibitive prose | Text that names `\|\| true` in order to forbid it, with the token in a separate code span from any git command. The current Step 9b prose. Must not be flagged. |
| Code span | An inline backtick span (text between single backticks) or a single line inside a fenced code block. The only text the lint reads. |
| Step 9b section | The slice of `faff-graft/SKILL.md` from `**Step 9b:` up to `**Step 10:`, the same bounds `checkAnchorBeforePrOrder` uses. |

Helper signature. A new pure reporter, mirroring `checkAnchorBeforePrOrder`.

```
FUNCTION checkAnchorCommitNoBroadSwallow(text: string) -> Result

RECORD Result:
  scoped: Boolean     # true when a Step 9b section was found
  ok: Boolean         # true when no command-position swallow was found
  hit: String | null  # the offending code span when ok is false, else null
```

- `scoped: false, ok: true, hit: null` when there is no Step 9b section (nothing to check), matching `checkAnchorBeforePrOrder`'s current absent-section return.
- `ok: false, hit: <span>` when at least one code span in the section carries a git command and a broad swallow together.
- Pure: no filesystem, no process exit, no ambient state. Deterministic in its one argument, so it is unit-testable with hand-built strings and cannot fire the lint by itself.

Export. Add `checkAnchorCommitNoBroadSwallow` to the `module.exports` object beside `checkAnchorBeforePrOrder`.

Design decisions in this section.

The swallow token set and the command it must attach to.

**Chosen:** match `|| true` and `|| :` (the two blanket no-op successes), and only when the token shares a code span with a `git commit` or `git add` command. Rationale: those two are the blanket swallows the ticket names; `git add` is included because the Step 9b prose lists a partial or failed `git add` as a failure that must abort, so swallowing it re-opens the same window. A narrowed tolerance that inspects output is not one of these tokens and is left clean.

## 4. HOW — behaviour

Architecture. The helper slices the Step 9b section with the same two `indexOf` bounds as `checkAnchorBeforePrOrder`, collects every code span in that slice, and reports the first span that contains both a git command and a broad swallow. The faff-graft call site, sitting right after the existing order check, turns a non-ok result into a FAIL.

The crux: command-position versus prohibitive prose.

**Chosen:** require the git command and the broad swallow to occur inside the same single code span. Rationale: in the correct prose, `git commit`, `git add`, and `|| true` each sit in their own separate backtick spans, so no single span carries both, and the section stays clean. A real `git commit … || true` is authored as one inline span or one fenced line, so both tokens land in the same span and match. Matching on same-line rather than same-span would false-positive, because the prohibitive sentence is one long Markdown paragraph line that contains `` `git commit` `` early and `` `|| true` `` late.

**Anti-pattern:** flagging any `|| true` found anywhere in the Step 9b section. Why: the shipped prose names `|| true` to forbid it, so a section-wide token scan fails the shipped-tree-clean test immediately.

**Anti-pattern:** matching a git command and a swallow that appear on the same line but in different spans. Why: the prohibitive sentence is a single paragraph line carrying both tokens in separate spans, so a same-line rule re-introduces the false positive the same-span rule removes.

Code-span collection.

```
PROCEDURE collect_code_spans(section):
  spans = []
  # fenced code blocks: lines between a ``` fence open and its close
  in_fence = false
  FOR each line in section.split_lines():
     IF line trimmed starts with "```":
        in_fence = NOT in_fence
        CONTINUE            # the fence marker line itself is not a span
     IF in_fence:
        spans.append(line)  # each fenced line is one span
        CONTINUE
     # inline code: every run of text between single backticks on this line
     FOR each match of /`([^`]+)`/ in line:
        spans.append(match.group(1))
  RETURN spans
```

Swallow detection.

Behaviour summary: report the first code span that pairs a git commit-or-add command with a blanket swallow.

```
PROCEDURE check(text):
  start = text.indexOf("**Step 9b:")
  end   = text.indexOf("**Step 10:", start + 1)
  IF start == -1 OR end == -1:
     RETURN { scoped: false, ok: true, hit: null }
  section = text.slice(start, end)
  FOR each span in collect_code_spans(section):
     IF span matches /git\s+(commit|add)\b/ AND span matches /\|\|\s*(true|:)(\s|$|["';)&|])/:
        RETURN { scoped: true, ok: false, hit: span }
  RETURN { scoped: true, ok: true, hit: null }
```

- The swallow regex anchors `true` / `:` at a token boundary so a path fragment such as `truent` or a `::` in unrelated text does not match.
- Both sub-patterns must hold for the same span. Order within the span does not matter; a real swallow always has the command first, but requiring both in one span is the load of the check.

Call site.

```
# inside cmdValidateAdapters, in the existing `if (name === "faff-graft")` block,
# immediately after the checkAnchorBeforePrOrder call:
swallow = checkAnchorCommitNoBroadSwallow(text)
IF swallow.scoped AND NOT swallow.ok:
   failed = true
   print "FAIL  faff-graft (anchor-commit broad-swallow)"
   print "        ✗ Step 9b commits the anchor with a broad error-swallow "
       + "(`|| true` / `|| :`) on a git commit/add — a genuine commit failure "
       + "must abort Step 9b before `gh pr create`, never be masked "
       + "(offending span: " + swallow.hit + ") (FAFF-1005)"
```

Edge cases.

- No Step 9b section: `scoped: false, ok: true`, no finding. A skill without Step 9b is never false-failed.
- Step 9b present, no code span with both tokens: `ok: true`, no finding. This is the shipped tree.
- A fenced line `git commit -m x || true`: one fenced span carries both, flagged.
- An inline span `` `git commit … || :` ``: flagged.
- Separate spans `` `git commit` `` and `` `|| true` `` in the same paragraph: neither span carries both, clean.

Failure modes.

- **The same-span rule is too narrow and misses a real swallow authored across two adjacent spans, or across a fenced backslash-continuation.** How you would know: a reviewer plants `` `git commit …` `` immediately followed by `` … || true `` as two touching spans, or a multi-line fenced `git commit -m msg \` with `|| true` on the *next* fenced line, and the lint passes. What it means: narrow, not abandon. The realistic single-line anti-pattern is one command written as one span or one fenced line, which the CLI-clean tests pin; the split-span and backslash-continued-fenced variants are the documented honest limit, not a silent hole. Cheap future mitigation (out of scope here): join backslash-continued fenced lines into one logical span before the git-and-swallow test.
- **The swallow regex over-matches and re-flags the prohibitive prose.** How you would know: the shipped-tree-clean test fails. What it means: the same-span requirement is not being honoured; the regex is being run against the whole line or the whole section instead of per span.

## 5. Scenarios — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given faff-graft's Step 9b has a code span `git commit -m msg || true`
When faff validate-adapters runs over the skills tree
Then it FAILs faff-graft with an "anchor-commit broad-swallow" finding citing FAFF-1005
```

```
Given the shipped faff-graft/SKILL.md, whose Step 9b names `|| true` only in
      prohibitive prose (git command and `|| true` in separate backtick spans)
When faff validate-adapters runs over the real tree
Then no anchor-commit broad-swallow finding is raised
```

```
Given a non-faff-graft skill fixture whose text contains `git commit … || true`
When faff validate-adapters runs over that fixture
Then no anchor-commit broad-swallow finding is raised (the check is faff-graft-scoped)
```

## 6. Design decision rationale

**How is a command-position swallow told apart from prohibitive prose?**
- Options: (a) flag any `|| true` in the section; (b) flag a git command and `|| true` on the same line; (c) flag them only in the same code span.
- (a) fails the shipped tree, which names `|| true` to forbid it. (b) also fails the shipped tree, because the prohibitive sentence is one paragraph line carrying both tokens in separate spans. (c) is the only option that passes the shipped tree and still catches a real one-span swallow.
- **Chosen:** (c), same-code-span requirement, spans being inline backtick runs and individual fenced lines.

**Pure reporter plus policy call site, or one combined function?**
- Options: fold the scan and the FAIL into the loop; or split a pure helper from the call site.
- Folding makes the logic untestable without spawning the CLI and breaks from FAFF-1001 and FAFF-1004.
- **Chosen:** split a pure, exported `checkAnchorCommitNoBroadSwallow` from a faff-graft-scoped call site, matching the two siblings.

**How is "adjacent to the anchor commit" scoped?**
- Options: the whole Step 9b section; or a tighter window around the `faff events anchor` mention.
- The only git commit in Step 9b is the anchor commit, so the section bound already is the adjacency, and reusing `checkAnchorBeforePrOrder`'s exact `indexOf` bounds keeps one section-slice convention.
- **Chosen:** the whole Step 9b section, same bounds as the order lint.

**Which swallow tokens, attached to which commands?**
- Options: `|| true` only, on `git commit` only; or `|| true` and `|| :`, on `git commit` and `git add`.
- The prose lists a failed `git add` as an abort case too, and `|| :` is the equivalent no-op success.
- **Chosen:** `|| true` and `|| :`, attached to `git commit` or `git add`.

**What does the helper return when there is no Step 9b section?**
- Options: fail-closed (treat a missing section as suspect); or `scoped: false, ok: true`.
- Fail-closed on absence is FAFF-1004's remit for the order lint. A missing section means no anchor commit and so no swallow to find; failing here would be a false alarm.
- **Chosen:** `scoped: false, ok: true`, decoupled from FAFF-1004; adopt a shared fail-closed slice later if FAFF-1004 introduces one.

**Where do the tests live?**
- Options: extend `test/faff-1001-anchor-before-pr-order.test.mjs`; or a new sibling file.
- The FAFF-1001 file is scoped to the order lint by name and header; mixing a second lint's cases dilutes it.
- **Chosen:** a new sibling `test/faff-1005-anchor-commit-broad-swallow.test.mjs`, reusing the `runOnFaffGraft` fixture pattern.

## 7. Open questions and assumptions

Open questions. None. Every decision above is closed.

Relates-to (not a blocker). FAFF-1004 hardens `checkAnchorBeforePrOrder` for a missing Step 9b section in the same file. Both touch `validate-adapters.js`, so whichever lands second rebases onto the other. The two lints share the section-slice bounds but keep independent absent-section postures until FAFF-1004 offers a shared helper.

Assumptions.

- **Assumes:** `faff-graft/SKILL.md` keeps the `**Step 9b:` and `**Step 10:` boundary markers. Validation: FAFF-1005 must assert its **own** `checkAnchorCommitNoBroadSwallow(real).scoped === true` (the live-guard AC in From WHY) — it does **not** inherit coverage from `checkAnchorBeforePrOrder`'s `scoped:true` test, because FAFF-1005 carries an independent copy of the bounds literals (see the shared-slice extension point below). A divergence in either copy is caught only by each function's own live-guard assertion.
- **Assumes:** every command in Step 9b is written as inline code or a fenced block, per the skill-authoring standard. Validation: read the shipped Step 9b; confirm the anchor commit sequence is code-formatted. If a bare-prose command ever appears, it falls under the documented honest limit.

## 8. DONE — definition of done

### From WHY
- [ ] A `git commit … || true` newly written into Step 9b is caught by `faff validate-adapters` (a regression test proves it FAILs).
- [ ] The shipped `faff-graft/SKILL.md`, with its prohibitive-prose `|| true`, raises no finding.
- [ ] The shipped-clean result is proven **live, not degenerate**: a unit test asserts `checkAnchorCommitNoBroadSwallow(<real shipped faff-graft SKILL.md>)` returns `scoped: true` **and** `ok: true` — so "no finding" is a genuine clean scan of a located section, never the `scoped:false ⇒ ok:true` no-op. (This mirrors FAFF-1001's own `checkAnchorBeforePrOrder(real).scoped === true` assertion; FAFF-1005 carries its **own** copy of the `**Step 9b:`/`**Step 10:` bounds, so it needs its own live-guard assertion — the sibling's test does not cover it.)

### From WHAT (types and interfaces)
- [ ] `checkAnchorCommitNoBroadSwallow(text)` returns `{ scoped, ok, hit }` matching the record.
- [ ] It returns `{ scoped: false, ok: true, hit: null }` when there is no Step 9b section.
- [ ] It is exported from `module.exports` beside `checkAnchorBeforePrOrder`.
- [ ] The helper is pure: no fs, no process exit, deterministic in its argument.

### From HOW (behaviour)
- [ ] The helper slices Step 9b with `indexOf("**Step 9b:")` … `indexOf("**Step 10:", start + 1)`, the same bounds as `checkAnchorBeforePrOrder`.
- [ ] Detection requires a git commit-or-add command and a `|| true` / `|| :` swallow in the same code span.
- [ ] A same-line but different-span pairing (the prohibitive sentence) does not match.
- [ ] The call site is inside `if (name === "faff-graft")`, right after the order check, and sets `failed = true` with a FAFF-1005 finding on a non-ok scoped result.

### From HOW (edge cases)
- [ ] A fenced-line `git add -A || :` is flagged.
- [ ] An inline `` `git commit … || :` `` is flagged.
- [ ] A non-faff-graft skill fixture containing `git commit … || true` raises no finding.

### From Scenarios
- [ ] The four scenarios (command-position FAIL, shipped-tree clean, fenced `|| :` holdout, non-faff-graft unaffected) each have a passing test.

Integration smoke test.

```
PROCEDURE smoke():
  1. Write a faff-graft/SKILL.md fixture whose Step 9b has `git commit -m x || true`.
  2. Run: faff validate-adapters --skills-dir <fixture dir>
  3. Assert stdout matches /anchor-commit broad-swallow/ and /FAFF-1005/, exit != 0.
  4. Run: faff validate-adapters   (over the real repo tree)
  5. Assert stdout does NOT match /anchor-commit broad-swallow/.
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
