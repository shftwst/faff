# `gitignore-ensure` must not leave a dead anchors carve-out in `.faff/.gitignore`

> Spec: faffter-dark-nlspec · 2026-10-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1309.
>
> build-tier: complex

A design document for FAFF-1309, written for the build agent that will implement it and for the human reviewers who gate it. It covers what to build and why, and the observable conditions under which it is done. It is not an implementation plan.

## 1. WHY — problem and principles

**The load-bearing model: git honours the last matching rule, but only among the rules that can match at all.** `.faff/.gitignore` works by ignoring every direct child of `.faff/` with `/*` and then re-including the committed parts with negations such as `!/anchors/`. That arrangement is correct only when `/*` precedes the negations — and only when no *other* catch-all in the file reaches deeper than `/*` does. Order is one of two failure axes; reach is the other, and round 1 of this spec modelled only the first.

**The problem.** `faff gitignore-ensure` is append-only and dedupes by literal line match, so against a repo whose `.faff/.gitignore` already contains `!/anchors/` it correctly declines to re-add that negation and appends the rest of the set — `/*` first — at the end of the file. The resulting file ignores the committed anchor subtree, and `git check-ignore` attributes the ignore to faff's own file. This change makes the command look at what it has just written and say so.

Measured in a throwaway repo against git 2.39.5, the silent failure end to end:

```
$ printf '*\n' > .faff/.gitignore && faff gitignore-ensure && git add -f .faff/.gitignore && git commit -qm x
$ git check-ignore -v .faff/anchors/run-1/FAFF-1/events.jsonl
.faff/.gitignore:1:*	.faff/anchors/run-1/FAFF-1/events.jsonl
$ faff config check --json
{ "ok": true, "findings": [], "skipped": [] }       # exit 0
```

**The invariant that was asserted is not the invariant that matters.** FAFF-1299 asserts `/*` precedes every negation, but it asserts it over the `FAFF_DIR_GITIGNORE_PATTERNS` constant — in `plugin/skills/faff/bin/lib/gitignore-ensure.js`, both in the pure selftest block and in the written-file check for a *fresh* repo. The constant is correctly ordered and always will be. Nothing checks the file that ends up on disk when the repo brought its own lines, which is precisely where the fault lives.

### Design principles

**Append-only is not up for renegotiation, and this change does not test it.** FAFF-67's spec states the floor — the step "may only *append* missing patterns. It must never reorder, deduplicate, rewrite, or remove any existing line" — and FAFF-1299 restates it as "the writer never removes, reorders or rewrites an existing line." The remedy chosen here adds a warning and never writes a line, so the floor is untouched. Section 6 records why the one append-shaped repair that would technically respect the floor was still rejected.

**A detector must not report success where it cannot deliver it.** The bug this ticket exists to remove is a silent failure: faff wrote a file that defeats faff's own guarantee and said nothing. Any remedy that fixes some shapes while silently passing others reproduces that failure in a new place. This principle decides detection over repair, and it is why the detector is specified over the final file rather than over what this run appended.

**A detector must not report failure where there is none either.** A warning on a healthy file trains operators to ignore warnings, and the `config check` finding turns it into a non-zero exit on a correct repo. Round 1 of this spec carried two such false positives. Both halves of this principle are now pinned by oracle rows that fail in either direction.

**A remedy must not trade a warned fault for an unwarned one.** The message names a hand fix. Every hand fix the message can print has been applied literally in a throwaway repo and re-measured, because a remedy that silences the detector without freeing the file is worse than no remedy at all.

**Faff warns about faff's own guarantees.** The command's existing root-file warning names a line the user wrote and tells them how to change it by hand; it never edits the project's own file. The new warning follows the same posture, and its scope is the carve-outs faff itself promises — not every negation a user may have written for their own reasons.

**No glob evaluation, and the gaps are pinned rather than papered over.** `gitignoreHasPattern` carries the comment "Deliberately NOT a full gitignore-semantics evaluator", and the root-file hazard list is an explicit spelling list with an unbounded-glob gap pinned by failing-if-widened test rows. The new detector inherits both halves: a pinned spelling list, and oracle rows that pin what it knowingly misses.

### Reference context

| Thing | Where | Relevance |
|---|---|---|
| The writer and its pattern sets | `plugin/skills/faff/bin/lib/gitignore-ensure.js` | Holds `FAFF_DIR_GITIGNORE_PATTERNS`, the append path (`ensureOneTarget`, `buildGitignoreAppendBlock`), `gitignoreEnsure`'s `warnings` array, and the in-file selftest |
| The root-file hazard warning | `hazardWarning` in the same file | Precedent for the message shape: name the offending line, name the hand fix. Root-file specific, so it is not reusable here |
| The root-file hazard spelling list | `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` in the same file | Precedent for a pinned spelling list with documented accepted gaps. Already lists `.faff/**/*`, which matters to section 6 |
| The line reader and its guard | `foldedIgnoreLines` in the same file | Carries the `typeof text !== "string"` guard the new predicate needs its own copy of, and the full `.trim()` the new predicate must *not* reuse |
| The writer's pattern equality | `gitignoreHasPattern` / `stripTrailingSlash` | Folds trailing slashes, so a seeded `!/anchors` counts as present and nothing is appended. The new predicate must use the same equality on the negation side |
| The standing posture findings | `dirHazardFinding` and `dirUnderignoreFinding` in `plugin/skills/faff/bin/lib/config.js` | Pure finding functions, the convention a new standing finding follows |
| The ignore facts reader | `readFaffIgnoreFacts` in `plugin/skills/faff/bin/lib/config.js` | Supplies `rootGitignore`, `faffDirPresent`, `faffDirGitignorePresent` to `computeConfigCheck`; does not currently supply the text of `.faff/.gitignore` |
| Behavioural git proofs | `test/impure/gitignore-ensure-set.test.mjs` | Already drives the real git binary against `.faff/.gitignore` content, with `isIgnored` / `ignoredBy` / `gitSeed` / `seedFaffFiles` / `assertFaffPolicy` helpers, all correctly using `cwd: dir` |
| The root-file predicate-vs-git oracle | `test/config-two-file.test.mjs` | Pattern to imitate: a table of spellings, git's verdict, and `gap: true` rows that fail if the predicate widens |
| Advisory posture | `records/adr/0067-committed-config-posture-two-file-model.md` | "`config check` findings are advisory everywhere in faff itself (warn, never block)" |

**Scope.** This sits inside the `.faff/` ignore story that FAFF-1299 opened and FAFF-1301 extended: FAFF-1299 moved the rules into `.faff/.gitignore`, FAFF-1301 made the posture reportable on every later run, and this ticket closes the ordering-and-reach hole inside the file itself.

## 2. OUT OF SCOPE

**Repairing the file.** Faff does not reorder, rewrite or add a duplicate line to fix the fault; the warning names the hand fix. Section 6 records the rejected append-a-duplicate option in full. *Extension point:* a future ticket that wanted a repair would add a second, order-aware write path in `ensureOneTarget`'s neighbourhood and would have to revisit FAFF-67's append-only floor explicitly.

**Negations the user wrote for their own paths.** A user line such as `!/notes.md` sitting above a catch-all is equally dead, and faff stays silent about it. Faff reports on the carve-outs it promises. *Extension point:* widening the scope means widening the shadowed-negation set from `FAFF_DIR_GITIGNORE_PATTERNS` to every negation in the file.

**Catch-all spellings whose verdict depends on the committed payload's shape.** A line `*/`, `/*/`, `*/*` or `/*/**`, and an explicit per-target `/anchors/`, can kill a carve-out without the detector firing. These are pinned accepted gaps with failing-if-widened oracle rows, for the measured reason in section 6: their verdict turns on the *depth and type of the committed content*, which this module does not model. Section 6 also records that these gaps are owned by this ticket's own oracle table and depend on no other ticket.

**The root `.gitignore`.** Nothing about the root file's hazard detection, warning text or spelling list changes. *Extension point:* FAFF-1313 changes `hazardWarning`'s remedy wording and FAFF-1310 adds `.git/info/exclude` scanning; both are separate tickets against the root-file surface.

**Rewriting the existing constant-order assertions.** The selftest's guard that `/*` sits at a lower index than every negation *in the constant* stays exactly as it is. It is true and worth keeping; it was simply never the whole property. This ticket adds assertions over the written file rather than replacing that one.

## 3. WHAT — vocabulary, predicate, and surfaces

### Vocabulary

| Term | Meaning |
|---|---|
| Carve-out negation | One of the seven `!`-prefixed patterns in `FAFF_DIR_GITIGNORE_PATTERNS`: `!/.gitignore`, `!/anchors/`, `!/templates/`, `!/decisions.md`, `!/conventions.md`, `!/config.yaml`, `!/config.example.yaml`. The two spelled with a trailing `/` are the **subtree carve-outs**; the other five are the **file carve-outs** |
| Deep catch-all | A line spelled exactly one of `*`, `**`, `/**`, `**/*`, `**/**`, `/**/*`. All six were measured to behave identically: they match at every depth *and* match direct children |
| Anchored catch-all | A line spelled exactly `/*`. Matches direct children of `.faff/` and nothing deeper |
| Deep-repair pair | For a subtree carve-out `P`, the two lines `P` and `P**` (for example `!/anchors/` and `!/anchors/**`). Both below the last deep catch-all is the only arrangement measured to revive that subtree |
| Shadowed | A carve-out negation that git's rules leave ineffective, by order or by reach |
| Dead file | A written `.faff/.gitignore` with at least one shadowed carve-out negation |

### The predicate

A new pure function over the text of a `.faff/.gitignore`, exported from `plugin/skills/faff/bin/lib/gitignore-ensure.js` beside the existing pure predicates:

```
FUNCTION shadowed_faff_dir_negations(text) -> List<{negation, catch_all, catch_all_line_number, kind}>:
  IF text is not a string: RETURN []              # null, undefined, numbers -> []
  lines := text split on newline, keeping each line's 1-based number, with only
           TRAILING whitespace and a trailing CR stripped; blanks and lines
           starting with "#" dropped
           # Leading whitespace is NOT stripped: git treats it as significant, so
           # a line "  *" is not a catch-all at all.
  deep     := lines whose text is exactly "*", "**", "/**", "**/*", "**/**" or "/**/*"
  anchored := lines whose text is exactly "/*"
  IF deep is empty AND anchored is empty: RETURN []
  last_deep      := the member of deep with the highest line number, if any
  last_direct    := the member of (deep + anchored) with the highest line number
                    # every deep and anchored spelling matches direct children

  result := []
  FOR each pattern P in FAFF_DIR_GITIGNORE_PATTERNS that starts with "!":
    # Equality folds trailing slashes, matching the writer's own gitignoreHasPattern,
    # so a seeded "!/anchors" (which makes the writer append nothing) still counts.
    occurrences := lines whose stripTrailingSlash(text) == stripTrailingSlash(P)
    IF occurrences is empty: CONTINUE
    last_P := the highest line number among occurrences

    IF P ends with "/" AND last_deep exists AND NOT deep_repaired(P, last_deep, lines):
      result += { negation: P, catch_all: last_deep.text,
                  catch_all_line_number: last_deep.number, kind: "deep" }
    ELSE IF last_direct.number > last_P:
      result += { negation: P, catch_all: last_direct.text,
                  catch_all_line_number: last_direct.number, kind: "positional" }
  RETURN result, in FAFF_DIR_GITIGNORE_PATTERNS order

FUNCTION deep_repaired(P, last_deep, lines) -> Boolean:
  # Both halves of the deep-repair pair must sit below the last deep catch-all.
  RETURN some line below last_deep.number folds equal to P
     AND some line below last_deep.number is exactly P_without_trailing_slash + "/**"
```

Six properties of this shape are deliberate, and each is load-bearing against a measured counter-example.

**It strips trailing whitespace only, and never reuses `foldedIgnoreLines`.** Git strips trailing whitespace and a trailing CR from an ignore line, but leading whitespace is significant. Measured: a line `  *` (two leading spaces) above a correct block leaves every carve-out committable, and a leading tab behaves the same. A full `.trim()` would make the detector fire on that healthy file. `foldedIgnoreLines` uses `.trim()` and returns no line numbers, so the predicate needs its own reader for two independent reasons; the `typeof text !== "string"` guard is copied from it.

**It folds trailing slashes on the negation side and not on the catch-all side.** The writer's `gitignoreHasPattern` folds, so a repo seeding `!/anchors` (no trailing slash) makes faff append nothing about the anchors carve-out — and that file, with a `/*` below it, is dead. An exact-match predicate misses the ticket's own subject. Folding the *catch-all* side would be the opposite mistake: `stripTrailingSlash` maps `/*/` onto `/*`, and `/*/` is measurably not equivalent to `/*`.

**Deep catch-alls are position-independent for subtree carve-outs and positional for file carve-outs.** Measured for all six deep spellings: placed anywhere — above the block, between `/*` and the negations, or below the whole block — they leave `.faff/anchors/run-1/FAFF-1/events.jsonl` and `.faff/templates/spec.md` ignored. Placed *above* the negations they leave `.faff/config.yaml` and `.faff/.gitignore` committable; only placed *below* do those die. Treating a deep catch-all as dooming the whole file would be a false positive on the five file carve-outs.

**It takes each negation's last occurrence, not every occurrence.** `!/anchors/` then `/*` then `!/anchors/` leaves the anchor file committable — git's last match is the second negation. Testing every occurrence against the last catch-all flags a healthy file and exits 1 on a correct repo.

**It suppresses the deep verdict for a repaired subtree.** `*` then `!/anchors/` then `!/anchors/**` leaves the anchors subtree committable. So does a correct block with `*` on top and `!/anchors/**` appended at the bottom — and in that file `!/templates/`, which has no `**` partner, is genuinely still dead. The per-carve-out suppression is what lets the warning stop firing once an operator has actually fixed the file.

**It reports rows carrying a `kind`, not a boolean.** The warning has to name what to fix, and the hand fix differs by kind.

**Anti-pattern:** reaching for `git check-ignore` inside this module. Why: `gitignore-ensure.js` requires only `fs`, `os`, `path` and `shared-infra`, has no `child_process` dependency, runs at bootstrap before any anchor path exists, and its selftest drives plain temp directories rather than git repos. Section 6 records the tradeoff in full.

### The message and its remedy

The new warning gets its own message builder, kept separate from `hazardWarning`. `hazardWarning` is root-file specific in both its subject and its remedy — it names `<root>/.gitignore` and always ends "Fix by hand: change `<line>` to `.faff/*`" — so it cannot be reused for a fault inside `.faff/.gitignore`. Keeping the builders separate also keeps this ticket out of FAFF-1313's way.

The message names the file, each shadowed carve-out, the offending catch-all line and its line number, and a hand fix that depends on the row's `kind`. Every arm below was applied literally in a throwaway repo and re-measured:

| `kind` | Hand fix the message prints | Measured outcome |
|---|---|---|
| `positional` | Move the named `/*` above every carve-out, **or** add the named negation again below it | Both leave every carve-out committable |
| `deep` | Delete the named line, **or** replace it with `/*` placed above every carve-out | Both leave every carve-out committable |

Three wordings are specifically forbidden, each because it was measured to leave a dead file:

- **"Delete the earlier negation"** — round 1's second arm. When the negation appears only once, deleting it removes the only carve-out and the subtree stays ignored, now with no warning at all.
- **"Move the catch-all above the negations"** applied to a deep catch-all — round 1's first arm. Measured: `*`, `!/anchors/`, `/*`, negations is dead and warned; moving `/*` up to yield `*`, `/*`, negations is still dead and **no longer warned**. Converting a warned dead file into an unwarned one is the ticket's own bug in a new place.
- **"Respell the line as `/*`" in place** for a deep catch-all below the block. The respelled `/*` still sits below every carve-out, so all seven stay dead. The remedy must say where the replacement goes.

### Surfaces that change

| Surface | Change | Compatibility |
|---|---|---|
| `gitignoreEnsure(root, local)` | After writing `.faff/.gitignore`, reads back the written text and appends one warning per dead file to the existing `warnings` array | The returned shape is unchanged; `warnings` is already an array of strings |
| `cmdGitignoreEnsure` | No change. It already prints every element of `warnings` and already returns 0 | No change to the JSON shape `{path, created, added, already, faff_dir, warnings}` |
| `readFaffIgnoreFacts(root)` in `config.js` | Gains a fourth fact, the text of `.faff/.gitignore` or `null`, read through the same swallow-everything `attempt` wrapper | Additive; existing three facts unchanged |
| `computeConfigCheck({...})` in `config.js` | Gains the new fact as an optional input and a third pure `.faff` finding built on the shared predicate | Absent the new fact, the finding is a no-op, matching how FAFF-1301's two facts already behave |

## 4. HOW — behaviour

### Where the check runs

`gitignoreEnsure` currently writes `.faff/.gitignore` and then computes warnings from the *root* file's text only. The new check slots in after the write, reading back what is now on disk:

```
PROCEDURE gitignore_ensure(root, local):
  1. IF local:
     a. Write .git/info/exclude only; RETURN with faff_dir null and warnings empty
  2. Ensure the root .gitignore against the (empty) root pattern set
  3. Ensure .faff/.gitignore against FAFF_DIR_GITIGNORE_PATTERNS
  4. warnings := one hazard warning per hazardous root ignore line   # unchanged
  5. Read back the .faff/.gitignore text that step 3 left on disk
  6. shadowed := shadowed_faff_dir_negations(that text)
  7. IF shadowed is non-empty:
     a. Append ONE warning naming the file, every shadowed negation with its
        offending catch-all line and line number, and the per-kind hand fix
  8. RETURN { ...root result, faff_dir, warnings }
```

Reading the file back rather than reasoning about what was appended is the whole point of step 5. The verdict is a property of the file, and a run that appended nothing can still face a dead file.

**One warning per dead file, listing every shadowed negation.** The root-file hazard warning emits one message per offending line, but there it is the *lines* that are the problem. Here the problem is one file-level fault, so one message carrying a list reads better and matches how the root-file `config check` finding already collapses several hazard lines into a single plural message. A single file can carry rows of both kinds, and the message groups its hand fixes accordingly.

**Anti-pattern:** firing only when this run appended the catch-all. Why: a repo whose file already reads `!/anchors/` then `/*` is just as dead, faff appends nothing about `/*` because its dedupe already sees it, and a run-scoped detector would stay silent on it forever.

### Edge cases and precedence

| Case | Behaviour |
|---|---|
| No catch-all line at all in the final text | No warning. Nothing shadows anything — the file under-ignores, which is `config check`'s underignore finding's subject, not this one. After a `gitignore-ensure` run the written file always contains `/*`, so this case arises only on the `config check` path against a file faff never wrote |
| Catch-all above every negation, no deep catch-all (the normal file faff writes) | No warning |
| A deep catch-all above the negations | Warning naming the two subtree carve-outs only; the five file carve-outs are genuinely still live and are not named |
| A subtree carve-out with its deep-repair pair below the last deep catch-all | No warning for that carve-out; other carve-outs are judged independently |
| A negation that is not one of faff's seven, above a catch-all | No warning. Out of scope by section 2 |
| A carve-out spelled without its trailing slash (`!/anchors`) | Treated as that carve-out, matching the writer's own folding equality |
| A commented-out or blank line | Skipped |
| A line with leading whitespace | Not a catch-all and not a negation. Git treats leading whitespace as significant, and so does the predicate |
| Trailing whitespace, trailing CR | Stripped, matching git |
| `.faff/.gitignore` unreadable after the write | The write already threw and `cmdGitignoreEnsure` already returned 2 with a stderr message; the detector is never reached |
| `--local` | No warning. The branch returns before `.faff/.gitignore` is touched and already returns `warnings: []` |
| Repeated catch-all lines | The highest-numbered one decides; duplicates do not multiply the warning |

### Exit codes and severity

`faff gitignore-ensure` keeps returning 0 and keeps writing the file. The warning goes to stdout through the existing loop in `cmdGitignoreEnsure`, and only a genuine write error still returns 2.

`faff config check`'s new finding is `severity: "warn"` on surface `.faff/.gitignore`, which makes `computeConfigCheck`'s existing `exit: findings.length ? 1 : 0` return 1 in an affected repo. That is the established meaning of an advisory finding in this command rather than new gating behaviour — ADR-0067 records that `config check` findings are advisory within faff and that a consuming repo's CI may choose to gate on them. Faff's own `.faff/.gitignore` is correctly ordered, so the new finding is silent in this repository.

### Failure modes

**The pinned spellings might not be the ones repos actually hit.** The detector covers six deep spellings plus `/*`, and knowingly misses `*/`, `/*/`, `*/*`, `/*/**`, explicit per-target lines, and the unbounded remainder of the equivalent-glob family. *How you would know:* a bug report where `git check-ignore` blames `.faff/.gitignore` and `faff config check` reports nothing. *What it means:* add the spelling and its oracle rows in both positions; the gap rows exist so widening the list is a visible, reviewable change rather than silent drift.

**A gap spelling's verdict might depend on content faff cannot see.** Measured: `*/` above a correct block leaves `.faff/anchors/run-1/FAFF-1/events.jsonl` ignored but `.faff/templates/spec.md` committable, because the anchors payload is nested and the templates payload is flat. *How you would know:* any attempt to fold the directory-only spellings into the pinned list produces an oracle row that fails for one carve-out and passes for another. *What it means:* that spelling cannot be judged without modelling the committed payload's depth, which is the reason it stays a gap rather than an omission.

**The warning might be unreadable at the moment it fires.** It fires during bootstrap, amid other output, about a file the operator did not write by hand. *How you would know:* an operator follows the hand fix and the warning persists, or the file stays dead. *What it means:* the message's remedy wording is wrong. Every arm is currently measured, so a regression here means a new arm was added without measuring it.

**The standing `config check` finding might duplicate the underignore finding on the same surface.** Both report on `.faff/.gitignore`. *How you would know:* a repo producing two findings for one fault. *What it means:* `dirUnderignoreFinding` returns its first two messages only when `.faff/runs` is **not** ignored, and `.faff/runs/r.json` stayed ignored in every dead shape measured, so those two cannot co-fire with this one. Its third message, `UNDERIGNORE_UNTRACKED_MESSAGE`, fires when `.faff/.gitignore` is uncommitted and *can* legitimately co-occur: a file can be both uncommitted and dead, which is two distinct faults needing two distinct fixes.

## 5. Scenarios and the predicate-vs-git oracle

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Behavioural scenarios, each measured against the real CLI and the real git binary:

```
Given a repo whose .faff/.gitignore contains only `!/anchors/`
When `faff gitignore-ensure` runs
Then the command exits 0, writes the appended block,
     and prints one positional warning naming `!/anchors/` and the `/*` line,
     and real git reports .faff/anchors/run-1/FAFF-1/events.jsonl ignored
     while .faff/templates/spec.md stays committable
```

```
Given a repo whose .faff/.gitignore contains `!/anchors/` followed by `/*`
When `faff gitignore-ensure` runs
Then the command appends nothing about `/*` yet still prints the positional warning,
     because the verdict is read from the final file and not from what this run appended
```

```
Given a repo whose .faff/.gitignore contains a bare `*` followed by `!/anchors/`
When `faff gitignore-ensure` runs
Then the command prints one deep warning naming both subtree carve-outs,
     and applying the printed fix — delete the `*` line — leaves every carve-out
     committable and the next run silent
```

```
Given a repo whose .faff/.gitignore contains a bare `*`, then `!/anchors/`, then `!/anchors/**`
When `faff config check` runs
Then no finding names `!/anchors/`, because real git reports the anchor subtree
     committable, and the finding that does fire names `!/templates/` only
```

```
Given a repo whose .faff/.gitignore contains `  *` (two leading spaces) above a correct block
When `faff gitignore-ensure` runs
Then no warning is printed, because git treats leading whitespace as significant
     and reports every carve-out committable
```

```
Given a repo already in a dead state and no further `gitignore-ensure` run
When `faff config check` runs
Then it reports one warn finding on surface `.faff/.gitignore` naming the shadowed carve-outs
```

- The `faff gitignore-ensure` exit code MUST stay 0 in every dead-file case, and the file MUST still be written.
- The new predicate MUST remain pure — no `child_process` import is added to `plugin/skills/faff/bin/lib/gitignore-ensure.js`.

### The oracle table

Every row below was measured against git 2.39.5 with `git check-ignore -q` run from inside the repo. Two methodology notes for whoever writes these rows: `check-ignore -v` exits **0 on a negation match**, so a test keying on `-v`'s exit code records "ignored" for committable files — use `-q`, whose exit code is correct, or `git status --porcelain -uall`. And `git -C <dir> check-ignore <relative path>` resolves the pathspec against the *caller's* working directory, not the repo; the existing helpers in `test/impure/gitignore-ensure-set.test.mjs` already get this right with `cwd: dir`.

"Position" is relative to a complete correctly-ordered faff block (`/*` then the seven negations); the seeded line sits above the whole block or below it. `anchors` = `.faff/anchors/run-1/FAFF-1/events.jsonl` (nested payload); `templates` = `.faff/templates/spec.md` (flat payload); `config` = `.faff/config.yaml`.

| Seeded line | Position | git: anchors | git: templates | git: config | Detector | Row |
|---|---|---|---|---|---|---|
| none | — | live | live | live | silent | baseline |
| `*` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `*` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `**` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `**` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `/**` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `/**` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `**/*` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `**/*` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `**/**` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `**/**` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `/**/*` | above | ignored | ignored | live | warns: deep ×2 | covered |
| `/**/*` | below | ignored | ignored | ignored | warns: deep ×2 + positional ×5 | covered |
| `/*` | above | live | live | live | silent | covered |
| `/*` | below | ignored | ignored | ignored | warns: positional ×7 | covered |
| `  *` (leading spaces) | above | live | live | live | silent | covered |
| `*/` | above | ignored | **live** | live | silent | **gap** |
| `*/` | below | ignored | ignored | live | silent | **gap** |
| `/*/` | above | live | live | live | silent | covered |
| `/*/` | below | ignored | ignored | live | silent | **gap** |
| `*/*` | above | ignored | ignored | live | silent | **gap** |
| `*/*` | below | ignored | ignored | live | silent | **gap** |
| `/*/**` | above | ignored | ignored | live | silent | **gap** |
| `/*/**` | below | ignored | ignored | live | silent | **gap** |
| `/anchors/` | above | live | live | live | silent | covered |
| `/anchors/` | below | ignored | live | live | silent | **gap** |

Four rows whose file text is pinned literally, because "position" does not determine them:

| File text (one line per entry) | git: anchors | Detector | Row |
|---|---|---|---|
| `!/anchors/` · `/*` · `!/anchors/` | live | silent | covered — last occurrence governs |
| `!/anchors/` · `!/anchors/` · `/*` | ignored | warns: positional, `!/anchors/` only | covered |
| `*` · `!/anchors/` · `!/anchors/**` | live | silent | covered — deep repair |
| `!/anchors/` · `*` · `!/anchors/**` | ignored | warns: deep | covered — repair pair must sit below the deep line |

The `*/` above-position row is the one that settles why the directory-only spellings cannot simply be added to the pinned list: in a single file, one subtree carve-out dies and the other survives, decided by whether the committed payload is nested or flat.

## 6. Design decision rationale

**Should the writer repair the ordering, or only detect it?**

The repair on the table is appending a *second* `!/anchors/` below the `/*` the command already appends. It adds a line rather than reordering or removing one, so no quoted append-only wording forbids it: FAFF-67 bans "reorder, deduplicate, rewrite, or remove", and a duplicate append is the opposite of deduplication.

Three findings decide it against repair. First, it does not work on the deep shapes. Seeding `*` then `!/anchors/`, appending `/*` then a duplicate `!/anchors/`, leaves the nested anchor file still ignored — measured, blamed on the `*` at line 1 — because a deep catch-all matches at every depth, so re-including the `anchors` directory does not re-include anything inside it. Second, a repair would therefore silently succeed on the anchored shape and silently fail on the deep ones; the ticket exists because faff produced a broken file and said nothing. Third, making the repair complete means emitting the deep-repair pair — both `!/anchors/` and `!/anchors/**`, since measurement shows neither alone suffices — which means either changing what every fresh repo gets or emitting patterns only on the repair path, breaking FAFF-67's "single source of truth for the pattern set".

**Chosen:** detection only — one warning naming the shadowed carve-outs and a per-kind hand fix. The repair is rejected on coverage and on silence, not on the append-only floor, which it would have respected.

**What counts as dead: a literal test over the final file, or a `git check-ignore` probe?**

A probe would catch every shape, including every gap the pinned list misses. Against that: `gitignore-ensure.js` imports no `child_process` and its header states the module does no glob evaluation; the selftest drives plain temp directories rather than git repos, so a probe-based detector would lose its unit rung entirely; and the command runs at bootstrap, possibly outside a git repo. Decisively, a probe returns a boolean, and the warning has to name the offending line and the hand fix.

**Chosen:** a literal, pure test over the written file, with pinned spelling lists and failing-if-widened oracle rows for the gaps — the discipline `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` already follows.

**Which catch-all spellings go in the pinned lists?**

Measurement across eleven spellings in both positions sorts them into three classes. Six behave identically and match both direct children and every depth: `*`, `**`, `/**`, `**/*`, `**/**`, `/**/*`. One matches direct children only: `/*`. Four — `*/`, `/*/`, `*/*`, `/*/**` — kill some carve-outs and not others in a way that depends on the committed payload, as the `*/`-above row demonstrates.

Round 1 pinned only four spellings and missed `**/*`, `**/**` and `/**/*`. That matters beyond arithmetic: `**/*` kills all seven carve-outs including `.faff/.gitignore` itself, and `.faff/**/*` is already on the root file's `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS`. Leaving it silent here would have the root-file list treating a spelling as a hazard while the `.faff/`-file detector ignored it.

**Chosen:** six deep spellings plus the anchored `/*`, compared against the trailing-trimmed line without trailing-slash folding; the four payload-dependent spellings, explicit per-target lines, and the unbounded remainder of the equivalent-glob family pinned as accepted gaps with oracle rows in both positions.

**Is a deep catch-all positional or not?**

Both, depending on which carve-out is asked about. Measured for all six deep spellings: above the negations they kill the two subtree carve-outs and leave the five file carve-outs live; below, they kill all seven. Round 1 treated every catch-all as positional and so returned `[]` for a deep catch-all sitting above a correctly-ordered block — the ticket's own silent failure in a shape the spec claimed to cover. The reviewer's proposed correction, declaring the whole file dead whenever a deep spelling appears, would have been the mirror error, naming `!/config.yaml` as dead on a repo where `config.yaml` is committable.

**Chosen:** split the test by carve-out class — subtree carve-outs are judged against the presence of any deep catch-all anywhere, file carve-outs positionally against the last direct-matching catch-all.

**How are repeated negations handled?**

`!/anchors/` then `/*` then `!/anchors/` leaves the anchor file committable, because git's last match is the second negation. Testing every occurrence against the last catch-all — round 1's shape — warns on that healthy file and makes the new `config check` finding exit 1 on a repo where git behaves correctly.

**Chosen:** each carve-out is judged by its highest-numbered occurrence only.

**Does a `**`-suffixed negation count as a repair?**

Yes, and the detector has to notice or it can never be silenced. Measured: `*` then `!/anchors/` then `!/anchors/**` leaves the anchors subtree committable, and so does a correct block with `*` on top and `!/anchors/**` appended. Both halves are required — `!/anchors/**` alone leaves the subtree ignored, because without a plain `!/anchors/` below the catch-all git never descends into the directory to consult it — and both must sit below the last deep catch-all, since a plain negation above it is itself overridden.

**Chosen:** suppress a subtree carve-out's deep row when both halves of its deep-repair pair appear below the last deep catch-all; judge each carve-out independently, so a file can be repaired for `!/anchors/` and still warned for `!/templates/`.

**How is whitespace handled?**

Git strips trailing whitespace and a trailing CR from an ignore line, but leading whitespace is significant: measured, `  *` and a leading-tab `*` above a correct block leave every carve-out committable. A full `.trim()`, which is what `foldedIgnoreLines` does, would fire on those healthy files.

**Chosen:** strip trailing whitespace and CR only; a line carrying leading whitespace is neither a catch-all nor a negation. The predicate reads lines itself rather than reusing `foldedIgnoreLines`, which it could not reuse anyway because it needs line numbers.

**How are negations compared?**

The writer's `gitignoreHasPattern` folds trailing slashes, so a repo seeding `!/anchors` makes faff consider the carve-out present and append nothing — and that file with a `/*` below it is dead, measured. An exact-match comparison misses precisely the carve-out this ticket is named for.

**Chosen:** compare negations with the writer's own `stripTrailingSlash` equality, while leaving catch-alls unfolded, since `stripTrailingSlash` maps `/*/` onto `/*` and those two are measurably not equivalent.

**Which negations are in scope?**

The seven carve-outs in `FAFF_DIR_GITIGNORE_PATTERNS`. The predicate is uniform across them apart from the subtree/file split that git's own behaviour forces, but it stops at faff's own promises. A user-authored negation above a catch-all is also dead, and reporting it would put faff in the business of auditing lines it did not write and does not guarantee.

**Chosen:** the seven carve-outs faff itself writes; user-authored negations are out of scope with an extension point.

**What does the message tell the operator to do?**

Round 1's remedy — "move the catch-all above the negations, or delete the earlier negation" — is wrong on both arms, and the first arm is actively harmful: applied to a deep catch-all it converts a warned dead file into an unwarned dead file, which is this ticket's own bug relocated. Deleting a singly-occurring negation removes the only carve-out. Respelling a below-block catch-all as `/*` in place leaves it below every carve-out.

**Chosen:** a per-kind remedy, every arm measured — positional rows get "move the `/*` above every carve-out, or add the negation again below it"; deep rows get "delete the line, or replace it with `/*` above every carve-out". Any future arm must be applied in a throwaway repo and re-measured before it ships.

**Warning or error, and what exit code?**

The command's established posture is warn, stdout, exit 0, file still written, and ADR-0067 records `config check` findings as advisory within faff. Nothing about this fault is unrecoverable, and the file faff writes is still strictly better than the file it found.

**Chosen:** warning to stdout, `faff gitignore-ensure` exit 0 unchanged, file still written; the `config check` finding is `severity: "warn"`, producing that command's existing advisory exit 1.

**When does it fire — every dead file, or only the run that appended the catch-all?**

The case that settles it is a repo whose file already reads `!/anchors/` then `/*`. Faff appends nothing about `/*`, and the file is dead anyway. A run-scoped detector is silent there permanently.

**Chosen:** every run whose final `.faff/.gitignore` is dead, with the verdict computed from the written text.

**Does `faff config check` gain a matching standing finding?**

FAFF-1301 exists because a bootstrap-time warning never reaches a repo already in the bad state — `gitignore-ensure` is a first-run command. The same reasoning applies unmodified, and the measurement above shows today's `config check` reporting `ok: true` on a repo whose committed anchors git is ignoring. The cheap alternative is a `git check-ignore` probe, rejected for the same naming reason as above plus a testability one: `computeConfigCheck` is deliberately driveable in-memory by `--selftest` without a real repo. Sharing one predicate between the writer's warning and the standing finding is the point — two implementations of "is this file dead" would drift, and this round's four corrections would have had to be made twice.

**Chosen:** a third pure `.faff` finding in `computeConfigCheck`, built on the shared predicate, fed by a fourth fact from `readFaffIgnoreFacts` carrying the text of `.faff/.gitignore` or `null`.

**Is the new warning folded into `hazardWarning`?**

`hazardWarning` names `<root>/.gitignore` and always closes with "change `<line>` to `.faff/*`", neither of which is true of a fault inside `.faff/.gitignore`. Separately, FAFF-1313 is rewriting that function's remedy wording, and FAFF-1310 is adding entries to the same `warnings` array from the root-file side.

**Chosen:** a separate message builder, appending to the existing `warnings` array — a textual merge conflict with FAFF-1310 at one line, with no logical overlap.

**Who owns the pinned gaps?**

Round 1 named FAFF-1311 as the home for the gap spellings, while FAFF-1311's own text contemplates closing as subsumed by FAFF-1301's probe. That made a deferral load-bearing on a ticket that may not exist, and the gap set round 1 handed over was wrong anyway — it omitted `**/*`, `**/**` and `/**/*`, which are now covered, and omitted `*/*` and `/*/**`, which are now pinned.

**Chosen:** the gaps are owned by this ticket's own oracle table and depend on no other ticket. Every gap spelling gets a `gap: true` row in both positions in `test/impure/gitignore-ensure-set.test.mjs`, which fails if the predicate widens without the row being updated. FAFF-1311 is recorded as a *possible* future home in section 2's extension point and as a sequencing note on the ticket, not as a precondition; if it closes as subsumed, nothing here is orphaned because the gaps are pinned where the predicate lives.

**Where do the new test rows live?**

The repo has three relevant rungs and all three are used. The pure predicate rows belong in `gitignoreEnsureSelftest` inside `plugin/skills/faff/bin/lib/gitignore-ensure.js`, beside the existing hazard-predicate rows. The behavioural proofs — write a seeded file, run the real CLI, ask the real git binary — belong in `test/impure/gitignore-ensure-set.test.mjs`, which already has `gitSeed`, `seedFaffFiles`, `isIgnored`, `ignoredBy` and `assertFaffPolicy`. Note that `seedFaffFiles` currently seeds no `.faff/templates/` path, and the oracle needs one to distinguish the nested-payload and flat-payload verdicts.

The predicate-vs-git oracle needs a decision of its own. The existing oracle in `test/config-two-file.test.mjs` carries a rule that adding a spelling to `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` requires a row there. That rule does not bind this ticket, which introduces different constants, but the *pattern* is exactly right for pinning the gaps.

**Chosen:** pure rows in the `gitignore-ensure.js` selftest; behavioural rows plus the new predicate-vs-git oracle table in `test/impure/gitignore-ensure-set.test.mjs`, with `seedFaffFiles` extended to seed a flat `.faff/templates/` payload; the `config check` finding's pure rows in `config.js`'s `--selftest` `faffIgnore` harness, with one real-run case in `test/config-two-file.test.mjs`.

## 7. Open questions and assumptions

No open `**Punt:**` items. One external assumption remains.

**Assumes:** git's ignore semantics as measured here — last-match precedence, no re-inclusion under an excluded parent directory, trailing-whitespace stripping, leading-whitespace significance, and the depth reach of each pinned spelling — hold across the git versions adopters run. Every row in section 5 was measured on git 2.39.5 only. These are long-standing documented behaviours rather than version-specific quirks, and the oracle rows run against whatever git CI provides, so a divergence would surface as a test failure rather than a silent wrong verdict. That is why this is recorded as an assumption rather than a spike.

## 8. DONE — definition of done

### From WHY (the problem is addressed)

- [ ] A repo seeded with `.faff/.gitignore` containing only `!/anchors/`, run through `faff gitignore-ensure`, prints a warning naming `!/anchors/` and the `/*` line.
- [ ] A repo seeded with `.faff/.gitignore` containing only `*` prints a warning naming `!/anchors/` and `!/templates/` and the `*` line — the shape that today reports `ok: true` with exit 0.
- [ ] The existing selftest guard that `/*` sits at a lower index than every negation *in the constant* is still present and still passing, unmodified.
- [ ] A new guard asserts the property over the **written file** for a repo that brought its own lines, not only for a fresh repo.

### From WHAT (the predicate)

- [ ] A pure, exported predicate over `.faff/.gitignore` text returns rows in `FAFF_DIR_GITIGNORE_PATTERNS` order, each carrying the negation, the offending catch-all line, its 1-based line number, and a `kind` of `"deep"` or `"positional"`.
- [ ] Returns `[]` for `null`, `undefined`, a number, a non-string object, and a string with no catch-all line.
- [ ] Each of `*`, `**`, `/**`, `**/*`, `**/**`, `/**/*` placed **above** a correctly-ordered block yields a `kind: "deep"` row for `!/anchors/` and `!/templates/` and **no row** for the five file carve-outs.
- [ ] Each of those six placed **below** a correctly-ordered block yields the two deep rows plus `kind: "positional"` rows for all five file carve-outs.
- [ ] `/*` above every negation yields no row. `/*` below the whole block yields `kind: "positional"` rows for **every** carve-out whose last occurrence precedes it — seven rows, not one.
- [ ] `/*` inserted immediately below `!/anchors/` in an otherwise correct block yields positional rows for exactly those carve-outs above it, and none for those below.
- [ ] File text `!/anchors/` · `/*` · `!/anchors/` yields no row; file text `!/anchors/` · `!/anchors/` · `/*` yields exactly one row, for `!/anchors/`.
- [ ] File text `*` · `!/anchors/` · `!/anchors/**` yields no row for `!/anchors/`; a correct block with `*` on top and `!/anchors/**` appended yields a deep row for `!/templates/` and none for `!/anchors/`.
- [ ] File text `!/anchors/` · `*` · `!/anchors/**` yields a deep row for `!/anchors/` — the repair pair must sit below the deep catch-all.
- [ ] A line `  *` or a leading-tab `*` yields no row, and neither does a leading-whitespace negation.
- [ ] Trailing whitespace and a trailing CR do not change the verdict; blank and `#`-prefixed lines are skipped.
- [ ] A carve-out spelled `!/anchors` without its trailing slash is recognised as that carve-out, matching `gitignoreHasPattern`'s folding.
- [ ] `*/`, `/*/`, `*/*`, `/*/**` and an explicit `/anchors/` yield no row in either position, each pinned as an accepted gap by a row that fails if the predicate widens.
- [ ] `plugin/skills/faff/bin/lib/gitignore-ensure.js` still imports only `fs`, `os`, `path` and `shared-infra` — no `child_process`.

### From HOW (the writer's warning)

- [ ] `gitignoreEnsure` reads `.faff/.gitignore` back after writing it and appends one warning per dead file to `warnings`.
- [ ] Exactly one warning is emitted for a dead file, listing every shadowed carve-out with its offending line and line number.
- [ ] The warning's hand fix is per-kind: positional rows say "move the `/*` above every carve-out, or add the negation again below it"; deep rows say "delete the line, or replace it with `/*` above every carve-out".
- [ ] The warning never says "delete the earlier negation", never tells the operator to move a deep catch-all, and never tells them to respell one in place.
- [ ] For each remedy arm the message can print, a test applies it literally to a seeded dead file and asserts that real git then reports every carve-out committable **and** that a re-run prints no warning.
- [ ] The warning is produced by a builder other than `hazardWarning`, and `hazardWarning`'s text is unchanged.
- [ ] `faff gitignore-ensure` exits 0 on a dead file and the file is still written; only a write error still exits 2.
- [ ] The `--json` shape is unchanged: `{path, created, added, already, faff_dir, warnings}`, with the new message appearing as a string in `warnings`.
- [ ] `faff gitignore-ensure --local` creates no `.faff/.gitignore`, reports `faff_dir` as `null`, and reports `warnings` as `[]`.

### From HOW (seeded shapes against real git)

- [ ] Every row of section 5's oracle table is a test row, asserting git's verdict on a nested payload (`.faff/anchors/run-1/FAFF-1/events.jsonl`), a flat payload (`.faff/templates/spec.md`) and a direct-child file (`.faff/config.yaml`), alongside the detector's verdict.
- [ ] `seedFaffFiles` seeds a flat `.faff/templates/` payload so the nested-versus-flat distinction is observable.
- [ ] The oracle uses `git check-ignore -q` or `git status --porcelain -uall`, never `check-ignore -v`'s exit code, and runs git with `cwd` set to the repo.
- [ ] Every `gap: true` row fails if the predicate is widened to cover it without the row being updated.
- [ ] In every shape, `.faff/runs/r.json` stays ignored and the exit code is 0.
- [ ] A fresh repo, after `faff gitignore-ensure`, produces no warnings at all.
- [ ] Re-running `faff gitignore-ensure` against an already-correct repo leaves `.faff/.gitignore` byte-identical.

### From HOW (the standing `config check` finding)

- [ ] `readFaffIgnoreFacts` supplies the text of `.faff/.gitignore`, or `null` when absent or unreadable, through the same failure-swallowing wrapper as the existing three facts.
- [ ] `computeConfigCheck` emits one `severity: "warn"` finding on surface `.faff/.gitignore` when the supplied text is dead, naming the shadowed carve-outs.
- [ ] The finding is a no-op when the new fact is absent, matching how `faffDirPresent` and `faffDirGitignorePresent` already behave.
- [ ] `faff config check` in the dead state reports the finding and exits 1; with a correctly ordered file it reports no such finding and exits 0.
- [ ] The finding does not co-fire with `dirUnderignoreFinding`'s run-state messages, since `.faff/runs` stays ignored in every dead shape; it *may* co-occur with `UNDERIGNORE_UNTRACKED_MESSAGE`, and a test pins that both appear for a file that is both uncommitted and dead.
- [ ] Faff's own repository produces no new finding — its `.faff/.gitignore` is correctly ordered.

### From the docs surface

- [ ] The `gitignore-ensure` row in `docs/guide/cli.md` describes the second warning class alongside the existing root-line one, and still states that the exit code stays 0.

### Integration smoke test

```
PROCEDURE smoke():
  1. Create a temp directory and `git init` it
  2. Write `.faff/.gitignore` containing exactly `*`
  3. Run `faff gitignore-ensure --json` from that directory
  4. ASSERT exit code is 0
  5. ASSERT `warnings` has exactly one entry, naming `!/anchors/`, `!/templates/` and the `*` line
  6. Create `.faff/anchors/run-1/FAFF-1/events.jsonl` and `.faff/templates/spec.md`
  7. ASSERT `git check-ignore -q` succeeds on both (the fault is real), and fails
     on `.faff/config.yaml` (the file carve-outs are genuinely still live)
  8. Commit `.faff/.gitignore` and run `faff config check --json`
  9. ASSERT one warn finding on surface `.faff/.gitignore`
  10. Apply the printed hand fix literally: delete the `*` line
  11. Re-run both commands; ASSERT no warning, no finding, exit 0 from `config check`,
      and `git check-ignore -q` now failing on all three paths
```

confidence: medium

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery*

**Right-sized (principle 4) — one unit, do not split.** Nine closed decisions look like three tickets, but they collapse to one deliverable: a single pure predicate, plus two thin consumers that cannot be specified independently of it. Splitting the `config check` finding into its own ticket would buy a second prep-and-review cycle to re-derive the same predicate's semantics, and the DoD's thirty checkboxes are breadth of proof, not breadth of scope. Two caveats: the `config check` half is the natural fault line, so build it as a discrete commit (`config.js` fact + finding + its two test rungs) so a reviewer can carve it out late if the diff inflates; and the FAFF-1301 precedent is not an argument for splitting now — 1301 was a follow-on discovered after 1299 shipped, not a scope judgement made up front.

**Workstream fit (principles 1 and 5) — a loose cluster worth homing.** FAFF-1309, 1310, 1311 and 1313 all sit project-less in Backlog, all descend from the merged 1299/1301 pair, and all converge on one outcome: faff's own ignore writing cannot silently kill the committed `.faff/` carve-outs. Four unsequencable loose tickets on one outcome is the loose-accumulation shape; a rehoming pass would propose an outcome-led home and make their order visible. Nothing about this spec changes inside the ticket — the finding is on the container, not the work.

**Deps surfaced (principle 6) — sequencing, not a blocker; one real gap.**

- **FAFF-1310:** a textual collision at one line is not a dependency. A blocker edge would misreport 1310 as not-ready and stall it behind unrelated judgement work; record the collision as a sequencing note on both tickets and let the concurrency lane serialise.
- **FAFF-1311:** real and under-surfaced. This spec pins `/*/`, `*/` and `/anchors/` as accepted gaps and names 1311 as their home, yet 1311's own text contemplates closing as subsumed by FAFF-1301's probe. Comment on 1311 that 1309 pinned gaps pointing at it, so subsumption becomes a visible decision rather than a silent orphaning.
- **FAFF-1313:** already de-conflicted by the separate message builder. No edge.

**Risk profile (principle 7) — no spike warranted, one unnamed consequence.** The only genuine unknown, whether the duplicate-negation repair covers every shape, was burned down against real git during prep and decided the central call; that is early de-risking already banked. Residual risk is the four-spelling coverage bet, bounded by failing-if-widened oracle rows. Worth adding to DoD: in an adopter repo already in the dead state, the new `warn` finding flips `faff config check` to exit 1 — advisory per ADR-0067, but a visible change for a repo gating CI on it, and wider than the "one warning" the ticket filed.
