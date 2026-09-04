# Spec — FAFF-1004: fail-closed the anchor-before-PR order lint on a renamed or absent faff-graft Step 9b heading

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1004.

This is a buildable nlspec for FAFF-1004, a follow-up hardening bug on FAFF-1001. The audience is the build agent that will implement the fix and the human reviewer who gates it. The change is small and mechanical: one call-site condition, one branched failure message, and the tests that lock the new behaviour.

## 1. WHY — problem and principles

**The load-bearing model.** `checkAnchorBeforePrOrder(text)` is a pure reporter. It locates faff-graft's Step 9b section by the literal heading markers `**Step 9b:` and `**Step 10:`, and reports whether the governance anchor is committed before `gh pr create` inside that section. It has no opinion on whether a skill is *required* to carry a Step 9b section. That policy belongs to the caller. Today the caller carries no such policy, so an absent section is a silent pass.

**Problem statement.** FAFF-1001 shipped `checkAnchorBeforePrOrder`, which returns `{ scoped: false, ok: true }` when it cannot find the `**Step 9b:` / `**Step 10:` headings that bound the section. The faff-graft call site only fails on `order.scoped && !order.ok`, so a future edit that renames or renumbers the Step 9b heading (exactly the edit a reorder would carry) silently disables the anchor-before-PR guard while `faff validate-adapters` still exits 0. This change makes an absent or partial Step 9b section a FAIL for faff-graft specifically, so the guard fails closed.

**Design principles.**

**Keep the helper a pure reporter.** `checkAnchorBeforePrOrder` must stay skill-agnostic. It reports what it found (`scoped`, `ok`, `anchorIdx`, `prIdx`); it never learns the skill name or the faff-graft-must-carry-Step-9b policy. Any implementation that teaches the helper about faff-graft is rejected.

**The policy is faff-graft-scoped.** Only faff-graft is required to carry the guarded Step 9b section. Every other skill that has no Step 9b section must stay unaffected. An implementation that fails a non-faff-graft skill for lacking a Step 9b section is rejected.

**Smallest correct change.** This is a one-line condition change plus a message branch. No new helper, no new exported function, no new lint category. An implementation that adds machinery beyond the call site and its message is rejected.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript (CommonJS) | Holds `checkAnchorBeforePrOrder` and the faff-graft call site inside `cmdValidateAdapters`'s `for (const name of present)` loop |
| `test/faff-1001-anchor-before-pr-order.test.mjs` | JavaScript (ESM, node:test) | The regression suite; carries the `runOnFaffGraft(body)` fixture harness and the helper unit tests |
| `plugin/skills/faff-graft/SKILL.md` | Markdown | The real skill whose Step 9b section the shipped-tree test reads |

**Scope statement.** This fix lives entirely inside the faff-graft branch of the `validate-adapters` skill-conformance lint; it changes no runtime graft behaviour.

## 2. OUT OF SCOPE

- **Generalising the fail-closed rule to other skills.** Only faff-graft is required to carry a Step 9b section, so only faff-graft fails closed on its absence. Extension point: if another skill later gains a mandatory Step 9b section, add its name to a per-skill set at the same call site (mirroring `ANCHOR_PHRASES` in the same file).
- **Changing the helper's return shape or making it skill-aware.** The helper stays a pure reporter; the policy lives at the call site. Extension point: none needed; the call site already receives the skill name via the loop variable `name`.
- **A git-history check that the Step 9b heading was not renamed over time.** `validate-adapters` is a stateless linter that reads the working tree only, the same honest limit recorded for `SKILL_LINE_BASELINE`. Extension point: the deferred history-aware ratchet already noted in the file's FAFF-584 comment.
- **Broadening the phrase match (`faff events anchor`, `gh pr create`).** The phrase set is FAFF-1001's contract and is unchanged here. Extension point: the helper body, if the graft commands ever change.

## 3. WHAT — vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Step 9b section | The span of faff-graft's SKILL.md bounded by the literal headings `**Step 9b:` and `**Step 10:`, where the anchor commit and `gh pr create` live |
| scoped | The helper found both bounding headings, so it could inspect a real section |
| fail-open | The current defect: an absent section yields no FAIL, so the guard silently disappears |
| fail-closed | The fixed behaviour: for faff-graft, an absent or partial section is a FAIL |

**The helper's return contract (unchanged).**

```
RECORD AnchorOrderReport:
  scoped:   Boolean    # true only when BOTH `**Step 9b:` and `**Step 10:` headings were found
  ok:       Boolean    # true only when anchor precedes gh pr create within the section
  anchorIdx: Integer   # first `faff events anchor` offset within the section, or -1
  prIdx:    Integer    # first `gh pr create` offset within the section, or -1

  # scoped:false always carries ok:true, anchorIdx:-1, prIdx:-1 (nothing to inspect)
```

The helper keeps this exact shape. `indexOf` returns -1 for a missing `**Step 9b:` heading (renamed or absent) and, independently, for a missing `**Step 10:` heading. Either -1 makes `start === -1 || end === -1` true, so a partial section (one heading present, the other absent or renamed) also returns `scoped: false`. Fail-closed for faff-graft therefore covers both the fully-absent and the partial case through the single `!scoped` limb.

**The call-site policy (changed).** The faff-graft branch inside the loop owns the "faff-graft must carry a bounded Step 9b section" rule. It fails when the section is absent OR out of order.

**Design decision — where the fix lives.**

| Option | Effect | Cost |
|---|---|---|
| Change the helper to return `ok:false` on absent section | Would break the helper's purity; the helper cannot know it is inspecting faff-graft, so it would false-fail any skill the helper is ever pointed at | Rejected: pollutes the pure reporter |
| Change the call-site condition to `!order.scoped \|\| !order.ok`, still gated on `name === "faff-graft"` | Absent, partial, or wrong-order all FAIL for faff-graft; every other skill untouched | Minimal |

**Chosen:** change the call-site condition to `name === "faff-graft" && (!order.scoped || !order.ok)`; the helper stays a pure reporter.

## 4. HOW — behaviour

**Approach.** Two edits in `validate-adapters.js`, both inside the existing `if (name === "faff-graft") { … }` block; the helper body and its export are untouched.

**Behaviour summary.** For faff-graft, the lint now fails whenever the Step 9b section is missing, half-present, or in the wrong order, and prints a message that matches which of those it is.

```
PROCEDURE faff_graft_anchor_check(name, text):
  1. IF name != "faff-graft": return    # policy is faff-graft-scoped, unchanged
  2. order = checkAnchorBeforePrOrder(text)
  3. IF NOT order.scoped:
     a. failed = true
     b. print FAIL header:  "FAIL  faff-graft (anchor-before-PR order)"
     c. print absent-section detail line (see below), citing FAFF-1004
  4. ELSE IF NOT order.ok:
     a. failed = true
     b. print FAIL header:  "FAIL  faff-graft (anchor-before-PR order)"
     c. print the existing wrong-order detail line, citing FAFF-1001
  5. ELSE: pass silently   # scoped:true, ok:true — correct order
```

**Design decision — the FAIL header label.** The existing CLI tests grep stdout for `/anchor-before-PR order/`. Reusing the same header string `FAIL  faff-graft (anchor-before-PR order)` for both the absent-section case and the wrong-order case keeps that grep contract stable and treats the guard as one guard with two failure limbs.

**Chosen:** keep the single `(anchor-before-PR order)` FAIL header for both limbs; differentiate only in the detail line.

**Design decision — the detail message must branch.** The current detail line names `order.anchorIdx` and `order.prIdx` and talks about one index preceding another. On an absent section both indices are -1 and that framing is nonsense. So the absent-section case needs its own detail line.

```
absent-section detail (scoped:false):
  "✗ faff-graft must carry a bounded Step 9b section (the `**Step 9b:` … `**Step 10:`
   headings that fence the anchor commit before `gh pr create`); none found — a renamed
   or renumbered heading silently disables the anchor-before-PR guard (FAFF-1004)"

wrong-order detail (scoped:true, ok:false) — UNCHANGED from FAFF-1001:
  "✗ Step 9b must commit + push the anchor before `gh pr create` — first
   `faff events anchor` (idx {anchorIdx}) must precede first `gh pr create` (idx {prIdx});
   a crash between PR-open and the anchor commit strands a review-passed PR as
   anchor-missing (FAFF-1001)"
```

**Chosen:** two detail lines behind the `order.scoped` branch; the wrong-order line is carried through verbatim so FAFF-1001's regression message is unchanged.

**Anti-pattern:** teaching `checkAnchorBeforePrOrder` about faff-graft. Why: it is exported and could be pointed at any text; a skill-aware helper would false-fail any non-faff-graft input a future caller feeds it.

**Anti-pattern:** inventing a second FAIL category or a new exported predicate for the absent case. Why: it is the fail-closed limb of the same guard, and a new label would break the existing `runOnFaffGraft` grep contract.

**Failure mode — the scoping regresses.** The risk in this change is that the `name === "faff-graft"` gate is dropped or the condition is written so a non-faff-graft skill without a Step 9b section starts failing. How you would know: the shipped-tree CLI test (which runs the whole real skill set) or the non-faff-graft fixture test would FAIL with an anchor-before-PR finding on a skill that has no Step 9b section. What it means: narrow the condition back under the `name === "faff-graft"` gate; do not relax the tests.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Above the trivial bar because the observable is non-obvious: a *silent* pass is the defect, so the scenarios pin an exit code and a stdout signal, not just prose.

```
Given a faff-graft SKILL.md whose Step 9b heading has been renamed or removed
When `faff validate-adapters` runs over it
Then the run exits non-zero and stdout carries "anchor-before-PR order" and "FAFF-1004"
```

```
Given a faff-graft SKILL.md with a `**Step 9b:` heading but no `**Step 10:` heading (partial section)
When `faff validate-adapters` runs over it
Then the run exits non-zero and stdout carries "anchor-before-PR order" (fail-closed on the partial case)
```

- The shipped, correctly-ordered faff-graft SKILL.md MUST still raise no anchor-before-PR finding (the guard does not false-fail the real tree).

## 6. Design decision rationale

**Where does the fail-closed policy live: the helper or the call site?**
- Helper returns `ok:false` on absent section: pro, one edit; con, the helper is exported and skill-agnostic, so it would false-fail any text lacking a Step 9b section that a future caller feeds it. Breaks the pure-reporter contract.
- Call site owns the policy: pro, the helper stays pure and the faff-graft-only scope is explicit at the one place that knows the skill name (`name`); con, none material.
- **Chosen:** call site, condition `name === "faff-graft" && (!order.scoped || !order.ok)` — the helper is a reporter, the caller owns the policy.

**One FAIL label or a new one for the absent case?**
- New label: pro, distinguishes the two limbs in the header; con, breaks the existing `/anchor-before-PR order/` grep in `runOnFaffGraft` and fragments one guard into two.
- Reuse `(anchor-before-PR order)`: pro, stable grep contract, one guard; con, the header alone does not say which limb, so the detail line must.
- **Chosen:** reuse the label, branch the detail line.

**How is a partial section (one heading present, one absent) treated?**
- The helper already returns `scoped:false` whenever either `indexOf` is -1, so the partial case is indistinguishable from the fully-absent case at the call site and both take the `!order.scoped` limb.
- **Chosen:** partial and fully-absent both FAIL through the single `!scoped` limb; no separate handling.

**What happens to the existing helper unit test "no Step 9b section → scoped:false, ok:true"?**
- The helper is unchanged, so that assertion about the pure reporter is still true and stays. What was misleading was its description clause "never false-fails a skill without Step 9b", which is now true only for non-faff-graft skills.
- **Chosen:** keep the helper unit test's assertion; reword its description so it no longer implies the CLI never fails faff-graft on an absent section, and move the fail-closed assertion to CLI fixture tests where the faff-graft policy actually lives.

## 7. Open questions and assumptions

**Open questions.** None. The design direction fixed the scope (faff-graft only), the location (call site), and the partial-section treatment.

**Assumptions.**

**Assumes:** the FAFF-1001 helper and call site are present on the branch the fix is built from (they shipped in PR #859, on main). Validation: before editing, confirm `checkAnchorBeforePrOrder` exists in `plugin/skills/faff/bin/lib/validate-adapters.js` and that the `if (name === "faff-graft")` block reads `if (order.scoped && !order.ok)`. faff-graft bases its worktree off `origin/main`, which carries the helper; a hand-created branch predating #859 must be rebased onto main first.

## 8. DONE — definition of done

### From WHY
- [ ] With a faff-graft SKILL.md whose Step 9b heading is renamed or absent, `faff validate-adapters` exits non-zero (no silent pass).

### From WHAT (types and interfaces)
- [ ] `checkAnchorBeforePrOrder`'s body, return shape, and `module.exports` entry are unchanged.
- [ ] The call-site condition reads `name === "faff-graft" && (!order.scoped || !order.ok)` (or an equivalent that fails on `!order.scoped`).

### From HOW (behaviour)
- [ ] When `order.scoped` is false, stdout prints the absent-section detail line citing FAFF-1004.
- [ ] When `order.scoped` is true and `order.ok` is false, stdout prints the FAFF-1001 wrong-order detail line unchanged (with `anchorIdx` and `prIdx`).
- [ ] The FAIL header is `FAIL  faff-graft (anchor-before-PR order)` for both limbs.
- [ ] A partial section (one bounding heading present, the other absent) FAILs for faff-graft.

### From HOW (scope)
- [ ] A non-faff-graft skill with no Step 9b section raises no anchor-before-PR finding.
- [ ] The shipped, correctly-ordered faff-graft SKILL.md raises no anchor-before-PR finding.

### From tests (`test/faff-1001-anchor-before-pr-order.test.mjs`)
- [ ] The existing helper unit test asserting `scoped:false, ok:true` for a no-Step-9b input is kept, with its description reworded so it no longer claims the CLI "never false-fails a skill without Step 9b".
- [ ] A new CLI fixture test writes a `faff-graft/SKILL.md` with a renamed or absent Step 9b heading and asserts a non-zero exit with stdout matching `/anchor-before-PR order/` and `/FAFF-1004/`.
- [ ] A new CLI fixture test covers the partial-section case (a `**Step 9b:` heading with no `**Step 10:`) and asserts the same FAIL.
- [ ] A new CLI fixture test writes a non-faff-graft skill (for example `faffter-noon-spec/SKILL.md`) without a Step 9b section and asserts stdout does not match `/anchor-before-PR order/`.
- [ ] The existing "CLI: the shipped tree carries no anchor-before-PR order finding" test still passes.
- [ ] `node --test test/faff-1001-anchor-before-pr-order.test.mjs` passes; `faff validate-adapters` over the real tree exits 0.

### Integration smoke test

```
PROCEDURE smoke():
  1. Write a tmp skills dir with faff-graft/SKILL.md whose heading reads "**Step 9x:" (renamed)
  2. Run: faff validate-adapters --skills-dir <tmp>
  3. Assert exit status != 0
  4. Assert stdout matches /faff-graft \(anchor-before-PR order\)/ and /FAFF-1004/
  # if this one path fails closed, the guard is reconnected
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
