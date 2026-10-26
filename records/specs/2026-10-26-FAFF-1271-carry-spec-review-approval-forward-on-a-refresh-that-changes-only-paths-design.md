# FAFF-1271: Carry spec-review approval forward on a refresh that changes only paths

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1271.

This spec is for the build agent and the human reviewer. It adds one deterministic CLI check to faff-prep's stale-refresh path so that a refresh which only moves paths, shifts line references or adds the one fixed refresh note keeps the approval the spec already earned, instead of sending an unchanged design back through every review lens.

## 1. WHY

**The load-bearing model.** A refresh is safe to carry forward when the before and after spec are identical once three kinds of noise are normalised away: the directory part of a path, a line number, and the one fixed-text refresh note `> Revised on YYYY-MM-DD: paths refreshed`. A pure function decides that by normalising both texts the same way and comparing them for equality, and a forgiven path change must also be a real move on disk: the old path is gone from the repository and the new one exists. Equality is transitive, so comparing against the previous revision is as strong as comparing against the last reviewed one, provided the previous revision still carries an approving `spec-review:` line.

**Problem.** faff-tidy tags a spec stale when a path it cites moves, and faff-prep's stale-refresh path (autonomous Path 1) then re-runs the full spec-review gate on the path-fixed spec as if it were new. In the run that prompted this ticket, six approved `confidence: high` specs were refreshed for a moved design-docs folder alone; one took five revise rounds and three parked on objections a human had already settled. After this change, a paths-only refresh keeps its retained `spec-review:` line, runs no lenses, and records "refresh: paths only, review carried forward" in the evidence comment.

**Design principles.**

- **Fail safe to re-review.** Any difference the normaliser does not explicitly forgive means "run the gate as today". The forgiven set is closed and carries no free text: a path change must be verified as a move on disk, and the only forgivable added line is a fixed string. What remains forgiven is a directory move of a file that no longer exists at its old path.
- **No model judgement in the decision.** The carry decision is the CLI's exit code. prep does not interpret the diff, and no lens or judge is consulted. The one model-judged input is pre-existing: Path 1's post-spec comment scan already decides whether a refresh may happen at all, and the carry reuses its result as a precondition (see the design decision below).
- **Allowlist, not denylist.** The ticket names both a forgiven set (paths, line references, status notes) and a protected set (decision sections, acceptance criteria, DONE items). The check implements the forgiven set: everything else, protected or not, must match. That satisfies both readings and is the conservative one.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/spec-review.js` | JavaScript (CommonJS) | `faff spec-review` verb dispatcher (`extract-evidence`, `select-evidence`, `route`); the new `carry-check` verb joins it |
| `plugin/skills/faff/bin/lib/heading-slug.js` | JavaScript | `headingSlug` / `headingText`, reused to name the section of a divergence |
| `plugin/skills/faff/bin/lib/tier.js` | JavaScript | Same pure-module-plus-thin-CLI-shell shape; `faff tier` rewrites the `build-tier:` line on every refresh |
| `plugin/skills/faff-prep/SKILL.md` | Markdown | Path 1 stale-refresh paragraph, Scenario B `iterate`, the "Persist + carry the spec-review evidence" paragraph, the "Re-prepping" `Revised on` note |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | JavaScript | `SKILL_LINE_BASELINE` pins faff-prep at 622 lines (file is 621) |
| `docs/guide/cli.md` | Markdown | One table row per `faff spec-review` verb, enforced by `faff lint-cli-doc` |
| `test/spec-review.test.mjs` | JavaScript (node:test) | Existing tests for the `spec-review` verbs |

**Scope.** One pure module, one new `faff spec-review` verb, and the faff-prep prose that calls it. No change to the spec-review gate itself, its contracts, or faff-tidy.

## 2. OUT OF SCOPE

- **Refresh that changes a design decision, acceptance criterion or DONE item**
  - **Why excluded:** the ticket keeps full review for these; the check reports `content-changed` and prep runs the gate as today.
  - **Extension point:** none intended.
- **Human-reserved fixes (blocker links, ticket scope)**
  - **Why excluded:** stay human-only per the ticket.
  - **Extension point:** none intended.
- **Mid-build respec and the interactive "Re-prepping" section**
  - **Why excluded:** the ticket names Path 1 and Scenario B `iterate` only; a respec is driven by a build finding and normally changes the design.
  - **Extension point:** the "Re-prepping" section of `faff-prep/SKILL.md` can call the same verb later.
- **File renames (basename changes)**
  - **Why excluded:** a rename can point a decision at a different module, so the check forgives a directory move only.
  - **Extension point:** a rename table input to the normaliser in the new module.
- **Context annotations folded in from post-spec comments**
  - **Why excluded:** Path 1 folds context comments into an annotation block whose form is free prose; the check does not recognise it, so such a refresh re-reviews.
  - **Extension point:** a canonical annotation form added to the status-note set in the new module.
- **Authenticating the retained `spec-review:` line**
  - **Why excluded:** the line is mutable prose, and build admission already consumes it without re-review. The carry trusts it exactly as far as build admission does and adds no new trust; authenticating it is a separate change.
  - **Extension point:** the retained-verdict paragraph in `faff-prep/SKILL.md` and the lights-out `spec_review` guardrail entry in `lights-out.js`.
- **Ratified-scope widening and the judge's ratified-scope input**
  - **Why excluded:** FAFF-1272 and FAFF-1273; this ticket is independent of both.
  - **Extension point:** `faff ratified-scope` and the spec-judge evidence assembly.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| before spec | The spec text prep read from the tracker at the start of the refresh, saved to a file before any edit |
| after spec | The refreshed spec text, after re-stamping the provenance line and the `build-tier:` line, before attach |
| approving line | The last line of the before spec matching `spec-review:`, whose value starts with `approve` or `accept` (today: `approve`, `accept (judge, L4-final)`, `accept (judge, L3-provisional)`, `accept (human preference, …)`) |
| volatile line | A line excluded from comparison: the provenance stamp (starts with `> Spec:`), the `build-tier:` line, and any refresh-note line |
| refresh-note line | A line that, after trimming, is exactly `> Revised on YYYY-MM-DD: paths refreshed` (an ISO date and that fixed text, nothing else). It is the only status-note form forgiven; any other note, including an edited one, is content |
| verified move | A changed path token pair whose `before` path does not exist under the repository root and whose `after` path does (file or directory) |
| path token | A run of characters from `[A-Za-z0-9_.@~+-]` and `/` containing at least one `/` between two non-empty segments (an optional trailing `/` allowed), not preceded by `://` |
| line reference | `:N` or `:N-M` directly after a path token; `#LN` or `#LN-LM` (also `#LN-M`); or the words `line N` / `lines N-M` (case-insensitive, hyphen or en dash) |

### The pure module

A new factory module `plugin/skills/faff/bin/lib/spec-refresh-carry.js` with a region header in the house shape. It does no I/O.

```
ENUM CarryReason:
  paths-only            # carry: normalised texts equal, approving line kept
  no-prior-approval     # before spec has no approving spec-review line
  approval-line-changed # after spec's spec-review line differs from before's
  confidence-changed    # the trailing confidence: line differs
  content-changed       # normalised texts differ
  path-move-unverified  # texts normalise equal, but some path change is not a verified move

RECORD CarryResult:
  carry: Boolean                        # true only for reason paths-only
  reason: CarryReason
  approval: String | null               # before's approving line, verbatim
  changes:                              # counts over paired raw lines that differ (classification steps 6 and 7)
    paths: Integer
    line_refs: Integer
    status_notes: Integer               # refresh-note lines added or removed
  path_moves: List<{ before: String, after: String, verified: Boolean }>   # each distinct changed path token pair
  first_divergence: null | {            # present only for content-changed
    section: String                     # headingSlug of the nearest heading above, "" when none
    before: String | null               # normalised line, null when before ran out
    after: String | null
  }

FUNCTION classifyRefresh(beforeText: String, afterText: String,
                        pathExists: Function(String) -> Boolean) -> CarryResult   # pure given pathExists
FUNCTION normaliseSpec(text: String) -> List<String>                               # pure, exported for tests
```

### The CLI verb

```
faff spec-review carry-check --before <file> --after <file> [--root <dir>]
```

- Prints one `CarryResult` JSON line on stdout.
- Exit 0 when `carry` is true; exit 1 when false (any of the five no-carry reasons); exit 2 with nothing on stdout on a usage error or an unreadable file.
- `--root` defaults to the current directory; `pathExists` joins each repo-relative path token to the root, resolves it with the filesystem's real path (following symlinks), and returns true only when it exists and its real path lies inside the root's real path. Absolute tokens, `..` escapes and symlinks pointing outside the root count as not existing. No git.
- Pure apart from the two file reads and the existence checks: no tracker, no network, no git, no clock.

### Design decisions

**Which revision to compare against.** Options: the last spec that earned a review, or the previous revision (the spec as attached when the refresh starts). Nothing in the code stores the last reviewed spec text: the round records hold verdicts, the evidence block holds objections, the retained `spec-review:` line is mutable prose (`lights-out.js` says so), and every faff CLI is a pure function that never reads tracker history. Equality after normalisation is transitive, and a carried refresh keeps the approving line, so a chain of carried refreshes compares each step against a text whose protected content equals the last reviewed one.
**Chosen:** compare against the previous revision, and require it to carry an approving `spec-review:` line. A human edit of the attached spec comment between refreshes is human curation, which the house rules treat as authoritative, so it is not re-reviewed.

**Which status-note forms count.** The only spec-body note form the skills define today is the "Re-prepping" section's `Revised on [date]`, a dash, then a brief reason. The decisions-register supersession note is written to the intent comment, not the spec, and Path 1's context annotation block has no fixed form.
**Chosen:** one fixed line, `> Revised on YYYY-MM-DD: paths refreshed`, with no free text, anywhere in the spec. Path 1 writes exactly this line when it refreshes paths. Earlier notes already in the spec are ordinary content: kept unchanged they match, edited they trigger review. A free-text note would be an unreviewed channel for design content, so the reason for the refresh goes in the evidence comment's move list instead.

**How far "paths" reaches.** Options: forgive any path change; forgive a directory move only; forgive paths outside decision sections only. The motivating case was a folder move, which keeps every basename. Forgiving any path change would let a decision silently point at a different file; restricting by section would not carry the motivating specs when a moved path sits inside a `**Chosen:**` section.
**Chosen:** forgive a directory move anywhere in the spec when it is a verified move: each path token normalises to its last non-empty segment (so a changed basename is a content change), and every changed token pair must have its old path absent and its new path present under the repository root. Repointing a decision from a file that still exists to a same-named file elsewhere is a design change and re-reviews. The check cannot tell a real move from a deletion plus an unrelated same-named file; that residual case is named under Failure modes.

**Where the verb lives.** Options: a new top-level `faff` command, or a verb on `faff spec-review`. The `spec-review` dispatcher already groups the per-spec review helpers, carries a selftest that satisfies `faff lint-cli-coverage`, and has one `docs/guide/cli.md` row per verb.
**Chosen:** a `carry-check` verb on `faff spec-review`, with the logic in its own module so `spec-review.js` stays a thin dispatcher.

**What the carry writes to the evidence comment.** graft's materialise step reads "the issue's `## Spec-review evidence` tracker comment", and FAFF-1257's sibling slices validate the first fenced block and the `sha256:` line in that section. A carry comment holding only the carry line could become the newest evidence comment and hide the earlier objections.
**Chosen:** the carry comment is headed `## Spec-review evidence`, starts with the line `refresh: paths only, review carried forward`, then a bullet list of `path_moves`, then a byte-for-byte copy of the newest earlier evidence comment's fenced `faff-contract:spec-review-verdict` block and its `sha256:` line when one exists and passes `faff contract spec-review-verdict` and its digest check. When none qualifies (a clean first-round approve posts nothing), the comment holds only the carry line and the moves.

**Whether a challenge or resolution comment can ride a carry.** Path 1 folds post-spec challenges and resolutions into the spec. A refresh that absorbed one through a status note alone would carry an approval past a human's steer.
**Chosen:** prep runs the carry check only when its post-spec comment scan found no challenge and no resolution. That scan already runs first in Path 1; this reuses its result as a precondition, not a new judgement.

### Assumptions

**Assumes:** the evidence comment format from FAFF-1257's slices (a `## Spec-review evidence` section holding one fenced `faff-contract:spec-review-verdict` block followed by a `sha256:` line) is the format at build time. Validation: read `faff-prep/SKILL.md` "Persist + carry the spec-review evidence" on the base branch before building. If the format has not landed, copy whatever fenced block the newest evidence comment holds, with its `sha256:` line only when present; the byte copy works either way.

## 4. HOW

### Normalisation

`normaliseSpec` turns a spec into a list of comparable lines. Both specs go through the same steps.

```
PROCEDURE normaliseSpec(text):
  1. Convert CRLF to LF and split into lines.
  2. Drop volatile lines (after trimming leading spaces): a line starting with "> Spec:",
     a line matching /^build-tier:/, and a refresh-note line.
  3. On every remaining line:
     a. Replace each line reference with a placeholder:
        - ":N" or ":N-M" right after a path token  -> ":#"
        - "#LN", "#LN-LM", "#LN-M"                 -> "#L#"
        - "line N", "lines N-M" (any case)         -> "line #" / "lines #"
     b. Replace each path token with its last non-empty segment (trailing "/" kept off).
        A token preceded by "://" is a URL and is left exactly as written.
     c. Collapse every run of spaces and tabs to one space; trim both ends.
     d. In a table separator row (only |, :, - and spaces), collapse each run of three or more
        "-" to "---".
  4. Collapse runs of blank lines to one; drop leading and trailing blank lines.
  5. Return the list.
```

Apply line-reference replacement before path replacement so `src/a.js:40` becomes `a.js:#`, not a token that swallowed the colon.

### Classification

```
PROCEDURE classifyRefresh(before, after):
  1. approval := last line of `before` matching /^spec-review:\s*(.+)$/ (trimmed).
     IF none, or its value does not start with "approve" or "accept":
       RETURN { carry:false, reason:"no-prior-approval", approval:null, ... }
  2. IF `after` has no spec-review line, or its last one is not byte-identical (trimmed) to approval:
       RETURN { carry:false, reason:"approval-line-changed", approval, ... }
  3. IF the last /^confidence:/ line differs between before and after (trimmed), or is missing from one:
       RETURN { carry:false, reason:"confidence-changed", approval, ... }
  4. nb := normaliseSpec(before); na := normaliseSpec(after)
  5. IF nb != na (element-wise, same length):
       first := lowest index where they differ (or where one list ends)
       src := na when first < length(na), else nb
       RETURN { carry:false, reason:"content-changed", approval,
                first_divergence:{ section: headingSlug(headingText(nearest heading line at or above first in src)),
                                   before: nb[first] or null, after: na[first] or null } }
  6. Pair the raw lines. Apply normalisation steps 1, 2, 3c and 4 (but not 3a, 3b or 3d) to
     both texts. Steps 3a, 3b and 3d rewrite within a line and never add or remove one, so the
     two lists have the same length as nb and na and pair by index.
  7. For each pair that differs: extract the path tokens of each side in order of occurrence
     and pair them by position; increment paths once when any pair differs and line_refs once
     when the line references differ (one line can increment both); record each distinct
     differing token pair in path_moves in first-seen order.
     status_notes := refresh-note lines present in one raw text and not the other, counted on
     the raw texts after step 1 only (step 2 drops these lines, so they cannot be counted later).
  8. For each path_moves entry set verified := (NOT pathExists(before) AND pathExists(after)).
     IF any entry is unverified:
       RETURN { carry:false, reason:"path-move-unverified", approval, changes, path_moves, ... }
  9. RETURN { carry:true, reason:"paths-only", approval, changes, path_moves, first_divergence:null }
```

A refresh with no textual change at all also returns `paths-only` with zero counts; the approval stands because nothing moved.

A carried `accept (judge, L3-provisional)` line stays provisional: the carry keeps the line byte-identical, so Live-thread reconciliation and any later human challenge treat it exactly as before the refresh. The carry adds no authority the line did not already have.

### Wiring into faff-prep

The verb runs in two places, after the after spec is fully stamped and before the spec-review gate would run.

```
PROCEDURE refresh_review_step(issue, before_file, after_file, comment_scan):
  1. IF comment_scan found any challenge or resolution:
       run the Spec-review gate as today; RETURN
  2. result := faff spec-review carry-check --before before_file --after after_file --root <repo root>
  3. Log result (the JSON line) to the prep log.
  4. IF exit 0:
       a. Keep the retained spec-review line unchanged (it is already in the after spec).
       b. Run no lenses, write no round record, do not touch the convergence window.
       c. Post the carry evidence comment (see below).
       d. Continue exactly as after an approve: confidence gate, reconcile step, reattach.
  5. ELSE (exit 1, any reason, or exit 2):
       Run the Spec-review gate as today. Exit 2 is logged as a plumbing fault but still
       falls through to review (fail safe), never a park on its own.
```

- **Path 1 (autonomous stale-refresh).** Before editing, write the attached spec text to `$scratch/refresh-before.md` (scratch from `faff spec-review-dir`). After re-stamping the provenance line and running `faff tier`, write the refreshed text to `$scratch/refresh-after.md` and run the step above in place of "re-run the Spec-review gate". When the refresh only fixes paths, write exactly `> Revised on <today>: paths refreshed` as its note; any other annotation is content and re-reviews.
- **Scenario B `iterate` (interactive).** Save the restored spec from Scenario B Step 1 as the before file. When the revised spec is produced and stamped, run the same step. On a carry, tell the user "review carried forward: paths only" and list the moves; on no carry, run the gate as today.
- **Carry evidence comment.** Using the comments list prep already fetched in the post-spec scan, find the newest earlier comment whose body has a `## Spec-review evidence` heading and a fenced `faff-contract:spec-review-verdict` block. Pipe that block's body to `faff contract spec-review-verdict` and, when a `sha256:` line follows it, recompute the digest; copy the block only when the contract exits 0 and any digest matches, otherwise treat it as absent and write a `carry-evidence-skipped: <reason>` line to the prep log. Post a new `## Spec-review evidence` comment: the line `refresh: paths only, review carried forward`, one bullet per `path_moves` entry (`before` to `after`; every entry is verified on a carry), then the copied fenced block and its `sha256:` line exactly as found. After posting, re-read the comment and recompute the digest over the fence body; on a mismatch, write a `carry-evidence-digest-mismatch` line to the prep log and continue (evidence stays best-effort). Git-only mode has no comment channel: add the carry line and moves under the spec's own `## Spec-review evidence` heading, leaving any embedded block as it is.
- **Line budget.** Keep `faff-prep/SKILL.md` within its `SKILL_LINE_BASELINE` entry by rewriting the Path 1 paragraph and the `iterate` bullet in place; if the procedure needs more lines, raise the baseline with a one-clause FAFF-1271 note. No prose line may exceed the 200-word paragraph cap.

### Edge cases

- **Before spec has two `spec-review:` lines** (an old one left behind). The last one wins, matching how the confidence line is read.
- **An earlier free-text note edited.** It is content, so the refresh re-reviews.
- **A refresh note with any extra text, or without an ISO date.** It is content; the refresh re-reviews.
- **A path the spec plans to create changed.** Neither side exists on disk, so the move is unverified and the refresh re-reviews.
- **A path token that resolves outside the repository root.** Treated as not existing, so a move to it is unverified.
- **A path token inside a fenced code block.** Normalised like any other line; fences are not special.
- **A URL whose path changes** (`https://github.com/a/b` to `https://github.com/a/c`). URLs are left as written, so the refresh re-reviews.
- **Unreadable before or after file.** Exit 2, nothing on stdout; prep runs the gate.
- **Methodology critique or "Already shipped" section changed by the refresh.** Content; re-review.

### Failure modes

- **The failure:** a file was deleted and an unrelated same-named file exists elsewhere (`src/a/index.js` gone, `src/b/index.js` present), so a repointed decision passes as a verified move. **How you'd know:** a carried refresh's `path_moves` shows a move between sibling modules rather than a folder relocation; the evidence comment lists every move for audit. **What it means:** a follow-up gives the verb a rename-evidence input that prep computes outside it (for example the `R` entries of `git diff --name-status -M` since the spec's date) and forgives only listed renames; the verb itself stays free of git. The residual window is a deletion plus a coincidental basename, which is narrow.
- **The failure:** Linear rewrites whitespace or quotes in the stored spec so before and after never normalise equal. **How you'd know:** carried refreshes stay at zero while `content-changed` divergences show whitespace-only or typographic differences. **What it means:** extend step 3 of the normaliser; the fail-safe direction means no wrong carry in the meantime.

**Anti-pattern:** having prep decide "this looks like paths only" and skip the CLI. Why: the ticket requires no model judgement in the carry decision.

**Anti-pattern:** rewriting the retained line to something like `spec-review: approve (carried)`. Why: the check requires the line byte-identical, and consumers read the line's leading verdict; the carry is recorded in the evidence comment instead.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a before spec ending with "spec-review: approve" and "confidence: high"
  And an after spec where `docs/design/x.md` became `docs/archive/design/x.md` in a **Chosen:** section,
      `src/a.js:40` became `src/a.js:52`, the stamp and build-tier lines changed,
      and a "> Revised on 2026-10-14: paths refreshed" line was added
  And under --root, docs/archive/design/x.md exists and docs/design/x.md does not
When faff spec-review carry-check runs on the pair
Then it exits 0 with reason "paths-only", changes {paths:1, line_refs:1, status_notes:1},
     and path_moves [{before:"docs/design/x.md", after:"docs/archive/design/x.md", verified:true}]
```

```
Given the same before spec
  And an after spec where one DONE checkbox line's wording changed
When faff spec-review carry-check runs on the pair
Then it exits 1 with reason "content-changed" and first_divergence.section naming the DONE heading's slug
```

```
Given the before spec from the first scenario
  And an after spec identical except that docs/design/x.md became docs/archive/design/x.md
  And under --root, both docs/design/x.md and docs/archive/design/x.md exist
When faff spec-review carry-check runs on the pair
Then it exits 1 with reason "path-move-unverified" and the path_moves entry has verified:false
```

```
Given the before spec from the first scenario
  And an after spec where a "> Revised on 2026-10-14: paths refreshed, and switched to Postgres" line was added
When faff spec-review carry-check runs on the pair
Then it exits 1 with reason "content-changed"
```

```
Given the before spec from the first scenario
  And an after spec whose spec-review line reads "spec-review: approve (carried)", or whose confidence line reads "confidence: medium"
When faff spec-review carry-check runs on the pair
Then it exits 1 with reason "approval-line-changed", or "confidence-changed" respectively
```

```
Given a before spec with no spec-review line
When faff spec-review carry-check runs against any after spec, including an identical one
Then it exits 1 with reason "no-prior-approval"
```

```
Given a Path 1 refresh whose post-spec comment scan found no challenge or resolution
  And carry-check exits 0
When prep finishes the refresh
Then no spec-review lens runs, no round-<n>.json is written, the retained spec-review line is unchanged,
     and a "## Spec-review evidence" comment starting "refresh: paths only, review carried forward" is posted
```

## 6. DESIGN DECISION RATIONALE

- **Previous revision or last approved spec?** Last approved needs a stored copy that does not exist and a tracker-history read no faff CLI makes; previous revision plus the approving-line precondition is equivalent by transitivity. **Chosen:** previous revision.
- **Which status notes?** Any free-text note is an unreviewed channel for design content. **Chosen:** the single fixed line `> Revised on YYYY-MM-DD: paths refreshed`.
- **How much path change to forgive?** Any change (too loose), outside protected sections only (misses the motivating case), directory moves anywhere (fits the folder move, but a text-only check cannot tell a move from a repoint). **Chosen:** directory moves anywhere, verified on disk (old path gone, new path present).
- **Allowlist or denylist?** The denylist (protected sections only) would also forgive prose edits elsewhere, which the ticket's title and first acceptance criterion exclude. **Chosen:** allowlist.
- **New command or verb?** **Chosen:** `faff spec-review carry-check`, logic in its own module.
- **Evidence on carry?** A bare line could shadow the earlier objections. **Chosen:** carry line, moves, and a byte copy of the newest earlier evidence block with its digest line.
- **Carry past a challenge or resolution?** **Chosen:** no; the carry check runs only when the post-spec scan found neither.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. Both ticket questions are settled above from what the code already holds.

**Assumptions:** the FAFF-1257 evidence comment format (see section 3, Assumptions), with the validation step stated there.

## 8. DONE

### From WHY
- [ ] A Path 1 refresh whose only differences are verified directory moves, line references, the stamp, the `build-tier:` line and the fixed refresh note runs no spec-review lens and keeps its retained `spec-review:` line byte-identical
- [ ] Any other difference runs the Spec-review gate exactly as before this change

### From WHAT (types and interfaces)
- [ ] `spec-refresh-carry.js` exports `classifyRefresh` and `normaliseSpec`, carries a `region:factory` header, and does no I/O
- [ ] `faff spec-review carry-check --before F --after F` prints one `CarryResult` JSON line with the fields in section 3 and exits 0 on carry, 1 on any no-carry reason, 2 (empty stdout) on a usage error or unreadable file; tests cover the exit-2 path
- [ ] `docs/guide/cli.md` has a `spec-review carry-check` row and `faff lint-cli-doc` passes
- [ ] The `spec-review` selftest covers `carry-check` carry and no-carry cases

### From HOW (behaviour)
- [ ] Tests cover each change class: verified directory move (carry), move whose old path still exists (no carry, `path-move-unverified`), move where neither path exists (no carry), basename rename (no carry), `:N`, `#LN` and `line N` references (carry), one line with both a path and a line-reference change (carry, both counters incremented), one line with two path changes (carry, `paths` incremented once, two `path_moves`), stamp and `build-tier:` change (carry), fixed refresh note added (carry), refresh note with extra text (no carry), earlier free-text note edited (no carry), prose edit outside any decision section (no carry), `**Chosen:**`, `**Punt:**` and `**Assumes:**` line edits (no carry), acceptance criterion edit (no carry), DONE item edit (no carry), URL change (no carry), table padding change (carry), CRLF line endings (carry)
- [ ] Tests cover `pathExists`: a symlink inside the root pointing outside it, an absolute token and a `..` escape all count as not existing
- [ ] Tests cover each no-carry reason: `no-prior-approval`, `approval-line-changed` (including an after spec with no spec-review line), `confidence-changed`, `content-changed` with the expected `first_divergence.section` (including a length-mismatch divergence), and `path-move-unverified`
- [ ] `faff-prep/SKILL.md` Path 1 saves the before spec, runs `carry-check` after stamping and before the gate, skips the gate on exit 0, and runs the gate on exit 1 or 2
- [ ] Path 1 runs `carry-check` only when the post-spec comment scan found no challenge and no resolution
- [ ] Path 1 writes exactly `> Revised on <date>: paths refreshed` as the note of a paths-only refresh
- [ ] Scenario B `iterate` runs the same step and tells the user when review was carried forward
- [ ] On carry, prep posts a `## Spec-review evidence` comment that starts with `refresh: paths only, review carried forward`, lists the path moves, and byte-copies the newest earlier evidence block with its `sha256:` line only when that block passes `faff contract spec-review-verdict` and its digest matches; git-only mode writes the carry line and moves under the spec's own evidence heading; a digest mismatch after posting is logged and does not block

### From HOW (edge cases)
- [ ] The last `spec-review:` line wins when there are several
- [ ] A carry writes no `round-<n>.json` and leaves the convergence window untouched
- [ ] `faff validate-adapters` passes, with any `SKILL_LINE_BASELINE` raise for faff-prep carrying a one-clause FAFF-1271 note

### Integration smoke test

```
1. Take a spec with "spec-review: approve" and "confidence: high"; save as before.md.
2. Copy to after.md; move one cited path to a new folder, bump one :N reference,
   change the "> Spec:" date, add "> Revised on 2026-10-14: paths refreshed";
   create the new path and remove the old one in a temporary --root.
3. faff spec-review carry-check --before before.md --after after.md --root <tmp>
   -> exit 0, reason "paths-only", one path move listed.
4. Edit one DONE item in after.md and rerun -> exit 1, reason "content-changed".
```

## Already shipped against this surface

- **FAFF-998** (Done): ratified tracker resolutions folded into the lenses' ratified scope. Reduces re-litigation inside a review; does not skip a review.
- **FAFF-910** (Done): accepted tradeoffs recorded where the gate honours them. Same layer as FAFF-998.
- **FAFF-907** (Done): ratified-scope deferral wired into the design lenses. Same layer.

None of these skips review for an unchanged design, so the premise holds.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? No issues.** One pure module, one `faff spec-review` verb, its tests and two faff-prep prose sites. That is one 1 to 3 day unit, and the CLI is useless without the prose wiring, so splitting them would only produce a pair that always ships together.
- **Workstream fit? No issues for this ticket.** FAFF-1271 sits in project-less Backlog alongside its siblings FAFF-1272 and FAFF-1273. All three serve one outcome (spec review stops reopening settled design). If more of that cluster lands, the rehoming pass could group them under an outcome-named project; nothing to do for this ticket.
- **Deps surfaced? No blocker needed.** The spec reads the evidence comment format from the FAFF-1257 slices as an `**Assumes:**`, but the carry comment byte-copies whatever block exists, so it works before or after those slices land. A blocker link would serialise for no gain. FAFF-1272 and FAFF-1273 are independent, as the ticket says.
- **Risk profile? Low.** No external dependency or novel integration. The main risk is a normaliser that is too forgiving, and the design fails safe to the review that runs today. No de-risking spike needed.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-2 minors fixed, not re-reviewed)
