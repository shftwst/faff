# `faff dod classify` keeps a fenced example inside its enclosing scenario

> Spec: faffter-dark-nlspec · 2026-10-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1205.

This is the build spec for FAFF-1205, for the build agent and human reviewers. It fixes a classifier bug in `faff dod classify` (and, by sharing, `faff admissible` and `faff dod split`) where a fenced code block embedded in a `## Scenarios` unit is torn into separate criteria, most of them misclassified as `prose`.

## 1. WHY — Problem and Principles

**The load-bearing model.** `classifyAcceptanceCriteria` walks the `## Scenarios` body line by line, accumulating a "current unit" and closing it on a boundary line (blank line, list bullet, new `Given`, italic placeholder, blockquote). Fence markers are dropped but their content is kept. The bug: those boundary rules fire **inside** a fence too — so a blank line (or a `- ` list line) *within* a fenced example closes the unit and starts a new one. A fenced example with internal structure therefore fragments.

**Problem statement.** When a scenario embeds a fenced block (e.g. expected YAML file text), `faff dod classify` splits it into several criteria and classes most fragments as `prose`. The code-blind holdout must mark prose `needs-human`, so a fully exercisable scenario becomes a `needs-human` aggregate and the holdout can never reach `meets-spec`. This change makes a scenario — including any fenced example inside it — classify as one `scenario` criterion.

**Design principles.**

- **Match the two sibling parsers on the two invariants they each encode — do not over-claim a single shared rule.** `classifyAcceptanceCriteria` is one of three parsers that walk the same Scenarios body, and the two siblings encode **two distinct, independently-true invariants** the fix must each preserve — they are not one identical rule:
  - **`parseScenarios` counts `Given` lines, in or out of a fence** (admissibility.js line 556: the `Given` count fires *before* its `if (fence) continue;`, comment "in-fence GWT included"). So a `Given` line inside a fence counts as a scenario. The fix must keep an in-fence `Given` starting a new unit, or `dodClassify`'s scenario count and `parseScenarios`'s count diverge for a multi-`Given` fence.
  - **`holdoutRemovalSpans` treats a holdout/integration-marked fence as a self-contained span** (line 375: a marked fence-open closes the current bullet; line 376: the whole `[open..close]` span is the removal unit). So the fix must make a marked fence's content form its own marked unit (closing any unit opened outside the fence), or `dodClassify(full)` and `dodSplit(builder)` disagree about what is withheld.
- **Only the *non-structural* in-fence boundaries are the bug.** The actual defect is that **blank lines, list bullets, italic placeholders, and blockquotes** fire as unit boundaries inside a fence. Those must become pure continuation. An in-fence `Given` and the fence-marker itself are *not* the bug — they stay load-bearing, per the two invariants above.
- **Additive, class-preserving outside fences.** Behaviour outside a fence is unchanged byte-for-byte. The existing `dodSelftest` cases (including FAFF-306's heading-boundary cases and FAFF-275's holdout cases) must keep passing untouched.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` → `classifyAcceptanceCriteria` | JavaScript (committed `.js` emit) | The buggy parser; the single site to fix (line ~200–236). |
| same file → `parseScenarios` (line ~537) | JavaScript | Counts a `Given` in or out of a fence (line 556). Parity target for scenario count. |
| same file → `holdoutRemovalSpans` (line ~367) | JavaScript | Removes a holdout-marked fence as a self-contained `[open..close]` span (lines 375–376). Parity target for the `full`-vs-`builder` withhold set. |
| same file → `dodClassify` (line ~284), `dodSplit` (line ~397) | JavaScript | Consumers of `classifyAcceptanceCriteria`; both must stay correct after the fix. |
| same file → `dodSelftest` (line ~957) | JavaScript | Where the regression tests are added; existing cases must stay green. |

**Scope.** A localized parser fix inside the DoD-classification surface of the faff CLI; no new command, flag, or output field.

## Already shipped against this surface

Done work touches this surface but none supersedes the premise — the bug is live and reproduced (a fenced YAML block with an internal blank line still fragments into phantom `prose` under `faff dod classify` on the current `main`). Listed as reader context:

| Ticket | Status | Relevance |
|---|---|---|
| FAFF-306 | Done | Bounded the `## Scenarios` section so classify/admissible stop at the DONE heading. Fixed over-capture *past* the section, not in-fence fragmentation *within* it. |
| FAFF-1291 / FAFF-1360 | Done | Routed prose / integration-tier DoD items off the code-blind holdout. These are what make a mis-classified fragment land as `needs-human` — the symptom — but they do not form the units. |
| FAFF-275 | Done | Added the `holdout:` marker, `dod split`, and `holdoutRemovalSpans`; its marked-fence-as-span invariant must be preserved by this fix. |
| FAFF-1197 / FAFF-1201 | Done (evidence) | Where the bug was first observed; their holdout verdicts are the motivating evidence, not a fix. |
| FAFF-1293 | Backlog | Complementary, not overlapping — refusing a genuinely-prose scenario (a `When` with no `Then`). Explicitly out of scope here (§2). |

## 2. OUT OF SCOPE

- **Refusing or flagging a genuinely-prose scenario** — the "a `When` with no `Then`" shape. *Why excluded:* that is FAFF-1293 (Backlog), a separate spec-review concern, not a classifier bug. *Extension point:* FAFF-1293's spec-review lens over `classifyCriterion` output.
- **Changing `classifyCriterion`'s scenario/assertion/prose precedence** (the `\bThen\b` / `MUST` / comparator rules). *Why excluded:* the classification rule is correct; the bug is purely in unit *formation*, not in how a formed unit is classed. *Extension point:* `classifyCriterion` (line ~50).
- **Dedenting or normalising fenced content.** *Why excluded:* `classifyCriterion` only looks for `\bThen\b` / `MUST` / a comparator; raw joined text is sufficient. *Extension point:* the unit-text assembly in `classifyAcceptanceCriteria`.
- **Changing `parseScenarios` or `holdoutRemovalSpans`.** *Why excluded:* they already encode the two correct invariants; the fix converges `classifyAcceptanceCriteria` onto them, not the reverse. *Extension point:* those functions, if a future ticket revisits in-fence `Given` counting.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| unit | One criterion as formed by `classifyAcceptanceCriteria`: a `Given/When/Then` block, a list bullet, or a bare line — before classification. |
| in-fence line | A line between a fence-open (` ``` ` / `~~~`, with any info string) and its matching fence-close, exclusive of the markers themselves. |
| marked fence | A fence whose info string is `holdout` (`isHoldoutFenceOpen`) or `integration` (`isIntegrationFenceOpen`). A fence with any other info string (or none) is a *plain* fence. |
| non-structural boundary | The boundary rules that are the bug when fired in-fence: blank line, list bullet, italic placeholder, blockquote. |

No type or interface changes. `classifyAcceptanceCriteria` keeps its signature `(sectionText: string) -> Array<{text, kind, holdout, tier}>`, and `dodClassify`'s output shape (`criteria[]`, `counts`, `holdout_counts`, `verification_tier*`, `oracle_less*`) is unchanged. The fix only changes *which* units are formed for a spec that embeds a structured fenced block.

**Design decision — what fires inside a fence.**

Options for an in-fence line:

- *(a)* Suppress only the blank-line boundary inside a fence. Con: a fenced example with a `- ` list line or an italic line still fragments — leaves siblings of the bug alive.
- *(b)* Suppress **all** boundary rules inside a fence, including the in-fence `Given` and the marked-fence tagging. Con: diverges from `parseScenarios` (which counts an in-fence `Given`) for a multi-`Given` fence, and from `holdoutRemovalSpans` (marked-fence-as-span) when a marked fence opens mid-unit — recreating the cross-parser desync class.
- *(c')* Suppress only the **non-structural** boundaries (blank / list / italic / blockquote) inside a fence; **keep** an in-fence `Given` starting a new unit (parseScenarios parity) and **keep** a marked fence forming its own tagged unit (holdoutRemovalSpans parity). Con: slightly more than the one-line (b); but it is the only option that preserves both sibling invariants.

**Chosen:** (c') — inside a fence, the non-structural boundaries become pure continuation, while the in-fence `Given` and the marked-fence tagging stay load-bearing. This is the minimal change that kills the bug (fragmentation on blank/list/italic/blockquote) **and** keeps `dodClassify` in agreement with *both* siblings, not one.

## 4. HOW — Behavior

**Approach.** Amend `classifyAcceptanceCriteria` at two points:

1. **Fence-open:** when the opening marker is a **marked** fence (`holdout` / `integration`), `pushCur()` first — close any unit opened outside the fence — so the fence's content starts fresh and is tagged with the fence's `holdout`/`tier`. A **plain** fence does **not** close the current unit (so a `Given/When/Then …:` scenario keeps its trailing plain fenced example in the same unit — the motivating case). Capture `fenceHoldout`/`fenceTier` as today either way.
2. **In-fence line:** add a guard so that while `fence` is true, only two things can happen — an in-fence `Given` line closes the current unit and starts a new one (capturing `fenceHoldout`/`fenceTier`); **every other** in-fence line is appended to the current unit (starting one, capturing `fenceHoldout`/`fenceTier`, if none is open). No blank/list/italic/blockquote boundary fires in-fence.

```
PROCEDURE classify_acceptance_criteria(sectionText):   # amended
  for each line:
    1. IF line is a fence marker (``` or ~~~):
         IF opening:
           fence := true; capture fenceHoldout + fenceTier
           IF marked (holdout | integration): pushCur()   # marked fence is its own unit (holdoutRemovalSpans parity)
         ELSE (closing):
           IF marked (holdout | integration): pushCur()   # IF closing AND marked: pushCur() — close the marked unit exactly at the close marker, so trailing out-of-fence continuation starts a fresh unit (holdoutRemovalSpans [open..close] span-end parity)
           fence := false; clear fenceHoldout + fenceTier
         continue
    2. IF fence is true:                                    # THE FIX — only Given splits; nothing else does
         IF line matches /^\s*Given\b/i:                    # parseScenarios parity: an in-fence Given counts
           pushCur(); start new unit; curHoldout := fenceHoldout; curTier := fenceTier
         ELSE:
           IF no current unit open: start unit; curHoldout := fenceHoldout; curTier := fenceTier
           ELSE append line to current unit (newline-joined)
         continue                                           # NO blank/list/italic/blockquote boundary in-fence
    3. ELSE (fence is false) — unchanged:
         blank | italic-only | blockquote  -> pushCur()
         list bullet                       -> pushCur(); start new unit (holdout:/integration: prefix unchanged)
         Given ...                         -> pushCur(); start new GWT unit
         otherwise                         -> append to current unit, or start a bare unit
  IF fence is still true at end: emit the unterminated-fence advisory (see edge cases)
  pushCur()   # flush trailing unit
  return units.map(classifyCriterion)
```

**Behaviour summary.** A scenario whose fenced example contains blank or list lines now forms one unit (classed `scenario` because its text contains `Then`); a plain fenced example stays part of its enclosing GWT unit; a marked fence is its own tagged unit; and a fence containing several `Given` blocks still forms one unit per `Given` — matching what `parseScenarios` counts.

**Edge cases.**

- **Plain fence opening mid-scenario** (`Given`/`When`/`Then …:` then a plain ` ``` ` example): the fence does not close the unit; its lines append; the scenario stays one `scenario` unit. The motivating FAFF-1201 case.
- **Marked fence opening mid-unit** (a unit opened outside, then ` ```holdout `): the marked fence-open `pushCur()`es the outside unit, so the fence content is its own `holdout:true` unit — `dodClassify(full)` lists both, `dodSplit(builder)` removes exactly the fence span, and the FAFF-275 `full`-minus-holdout invariant holds.
- **Trailing continuation after a marked fence-close** (e.g. an `And …` wrap or prose directly after a ` ```holdout ` close, with no intervening blank line): the marked fence-**close** also `pushCur()`es, closing the marked unit exactly at the close marker, so the trailing line starts a fresh out-of-fence unit rather than appending to the `holdout:true` unit. This keeps the removed span (`holdoutRemovalSpans` ends at the close marker) equal to the classified holdout unit — without it, `dodSplit(builder)` would leave the trailing text visible while `dodClassify(full)` marked it withheld. A **plain** fence-close stays non-closing (the plain fenced example remains inside its enclosing GWT unit — the motivating case).
- **Multiple `Given` blocks in one fence:** each in-fence `Given` starts a new unit; `dodClassify`'s scenario count equals `parseScenarios`'s for the same spec.
- **Standalone fenced block with no preceding `Given`:** the first in-fence line starts a unit (classed by its own text); no fragmentation.
- **Unterminated fence** (open marker, no close before the section boundary): `fence` stays true to the section end; in-fence `Given` lines still split, only trailing non-`Given` lines merge into their unit. This is **not** silent — the function emits a `dod classify: unterminated fence in Scenarios section (criteria after the stray fence may be merged)` advisory to stderr (mirroring the existing `doneAdvisories` stderr convention at line ~302), so a collapsed criterion count is visible rather than a quiet fail-open. `sectionBodyRange` already bounds the walk, so there is no crash or infinite loop.
- **Blank line immediately after a fence-close:** handled by the unchanged out-of-fence blank-line rule.

**Failure modes.**

- **The failure:** the two parities drift again later (someone changes one parser without the others). **How you'd know:** the two cross-parser-agreement selftest assertions below fail. **What it means:** the invariant tests are the guard; keep them. Proceed.
- **The failure:** a marked fence opening mid-unit silently withholds the preceding scenario text too. **How you'd know:** the FAFF-275 `full`-minus-holdout selftest invariant (visible-after-split == full-minus-holdout) fails. **What it means:** the `pushCur()` on marked fence-open is what prevents this; the selftest pins it. Proceed.

**Anti-pattern:** suppressing the in-fence `Given` boundary (option b). Why: it diverges from `parseScenarios`'s in-fence `Given` count and recreates the admissible-vs-classify desync FAFF-306 closed.

**Anti-pattern:** treating a marked fence like a plain one (not closing the outer unit). Why: a `holdout` fence opening mid-unit then tags nothing, so `dodClassify(full)` and `dodSplit(builder)` disagree about what is withheld.

**Anti-pattern:** treating an unterminated fence as benign-and-silent. Why: it collapses the judged criteria set with no signal; emit the advisory.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a `## Scenarios` scenario whose single Given/When/Then embeds a plain fenced
      example containing a blank line (e.g. a YAML block with a blank separator line)
When `faff dod classify` runs over the spec
Then the scenario yields exactly one criterion of class `scenario`, and no fragment
     drawn from inside the fence appears as a separate `prose` criterion
```

```
Given a `## Scenarios` section whose fence contains two blank-line-separated
      Given/When/Then blocks
When `faff dod classify` runs over the spec
Then it forms exactly two `scenario` criteria, and that count equals the count
     `parseScenarios` reports for the same spec (parseScenarios parity)
```

```
Given a `## Scenarios` scenario followed by a ` ```holdout ` fenced example that opens
      while the scenario's unit is still open
When `faff dod classify` and `faff dod split --view builder` run over the spec
Then the fenced example is its own `holdout:true` criterion, the preceding scenario
     stays visible, and the builder view equals the full set minus the holdout unit
     (holdoutRemovalSpans parity)
```

- A plain fenced example embedded in a GWT scenario never changes the scenario's class away from `scenario`.

## 6. DESIGN DECISION RATIONALE

**What fires inside a fence?**

- Options: (a) blank-line only, (b) suppress everything in-fence, (c') suppress only the non-structural boundaries while keeping in-fence `Given` splitting and marked-fence tagging.
- **Chosen:** (c'). (a) leaves the list/italic/blockquote variants of the bug alive. (b) is one line but diverges from `parseScenarios` (in-fence `Given` count) and `holdoutRemovalSpans` (marked-fence span) — the exact cross-parser desync class FAFF-306 was about. (c') is the only option that both kills the bug and keeps `dodClassify` in agreement with *both* siblings. The two parities are distinct invariants, not one shared rule — the spec names each and its selftest.

**Where to add the regression tests?**

- **Chosen:** extend `dodSelftest` in the same file with: (i) a plain fenced scenario with an internal blank line → one `scenario`, no in-fence `prose`; (ii) a two-`Given`-in-one-fence spec → `dodClassify` scenario count == `parseScenarios` count == 2; (iii) a mid-unit `holdout` fence → the fence is its own `holdout:true` unit and `dodSplit(builder)` == full-minus-holdout; (iv) an unterminated fence → the advisory fires and `Given` blocks before/after still count. Rationale: the file's established test convention is the inline `dodSelftest` (run via `faff dod --selftest`); the FAFF-306/FAFF-275 cases already live there.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None. The ticket's sole open question ("one `scenario` criterion") is answered by its Expected section and the chosen rule.

**Assumptions.**

- **Assumes:** the TypeScript-source rule does not apply here — `admissibility.js` is an authored `.js` module, not a `.ts` with a committed emit. *Validation:* confirm there is no `admissibility.ts` sibling (`ls plugin/skills/faff/bin/lib/admissibility.*`); if one exists, edit the `.ts` and rebuild per AGENTS.md instead of editing the `.js` directly.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `## Scenarios` scenario embedding a plain fenced block with an internal blank line classifies as exactly one `scenario` criterion under `faff dod classify` (no phantom `prose` fragment from inside the fence).

### From WHAT / HOW (the two parities)
- [ ] Inside a fence, blank/list/italic/blockquote lines do not open or close a unit; every such line is continuation of the current unit.
- [ ] An in-fence `Given` line still starts a new unit, so `dodClassify`'s scenario count equals `parseScenarios`'s count for a spec with multiple `Given` blocks inside one fence (parseScenarios parity).
- [ ] A `holdout`/`integration`-marked fence-open closes any unit opened outside the fence, so the fence's content is its own `holdout`/`integration`-tagged unit; the preceding scenario stays visible (holdoutRemovalSpans parity).

### From HOW (edge cases)
- [ ] A fenced example containing a `- ` list line does not fragment the scenario.
- [ ] A standalone fenced block with no preceding `Given` forms a single unit classed by its own text.
- [ ] An unterminated fence emits the `dod classify: unterminated fence …` stderr advisory and flushes one trailing unit without error; `Given` blocks before and after the stray fence still count.
- [ ] Out-of-fence classification is byte-for-byte unchanged: the existing `dodSelftest` cases (FAFF-306 heading-boundary, FAFF-275 holdout, numbered-heading) all still pass.

### From HOW (consumers)
- [ ] `faff dod split --view builder` over a spec with a mid-unit `holdout` fenced scenario yields the full classified set minus exactly the holdout unit (the FAFF-275 invariant), with no preceding visible scenario text removed.

### Test floor (not judged by the holdout)
- [ ] `dodSelftest` gains the four cases named in §6 (plain-blank-line, two-Given-in-fence with `parseScenarios` equality, mid-unit holdout with split parity, unterminated-fence advisory). `faff dod --selftest` passes.

### Integration smoke test
```
PROCEDURE smoke:
  1. spec = "## Scenarios\n\nGiven x\nWhen y\nThen the file reads:\n```yaml\na: 1\n\nb: 2\n```\n\n## 2. DONE\n- [ ] the key is removed"
  2. r = dodClassify(spec)
  3. ASSERT r.counts.scenario == 1
  4. ASSERT r.criteria.filter(c => c.source == "scenarios").length == 1 AND its class == "scenario"
  5. ASSERT no criterion has text "b: 2"
  6. ASSERT dodClassify(spec).criteria.filter(c => c.source=="scenarios" && c.class=="scenario").length == parseScenarios(spec)
```

confidence: high
spec-review: accept (judge, L3-provisional)
build-tier: complex

## Methodology critique

Agile-delivery lens over FAFF-1205 (advisory; written in autonomous prep, does not gate promotion):

- **Right-sized?** Yes. A single mechanical concern — one parser's in-fence boundary handling — with a well under 1-day change plus regression tests. Not splittable; not mergeable with another ticket.
- **Workstream fit?** Fits the DoD/holdout-classification surface (`faff dod classify` / `admissible` / `dod split`). Named, cohesive, no rehoming needed.
- **Deps surfaced?** No blockers; no implicit dependency. FAFF-1293 is related but independent (and out of scope). Nothing to link.
- **Risk profile?** Low. No novel integration, no external dep. The fix converges one parser onto two already-correct siblings, and the two parity risks are each pinned by a named selftest. No de-risking spike warranted.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
