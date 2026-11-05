# FAFF-1428: faff rule-inventory check fails a PR whose deleted skill prose maps to no rule-inventory row

> Spec: faffter-dark-nlspec · 2026-11-04 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1428.

This spec is for the build agent and the human reviewers of FAFF-1428. It defines a new factory command, `faff rule-inventory check`, which runs in the `validate` CI job. The command compares a PR's head with its base, finds every block of skill prose the PR deletes, and fails unless each block is either moved verbatim into other skill prose or quoted by a row of the `## Rule inventory` in a spec the PR commits.

## 1. WHY — Problem and Principles

**The load-bearing model.** A deleted rule is only safe when something says where it went. The check makes that statement mechanical: every deleted block of skill prose must either reappear word for word in other skill prose, or be quoted by an inventory row that says what happened to it (`kept` with a test that exists, or `changed` / `dropped` with a reason). A deleted block that is neither moved nor quoted fails the PR.

**Problem.** Moving skill prose into commands deletes rules from `SKILL.md`, and today nothing checks that each deleted rule was implemented or deliberately dropped. The 2026-10-29 audit found one rule lost and one dangling prose reference in FAFF-1404, because that spec mapped prose in blocks rather than rule by rule (FAFF-1429). The holdout checks the command against the spec, the line and byte ratchets only stop prose growing back, and the wiring lints only catch stale call shapes, so none of them sees a rule that both the spec and the code forgot.

**Design principles.**

- **Quote, don't count.** A row identifies the prose it covers by quoting it, never by line number. A rebase moves line numbers; it changes the quoted text only when upstream edits the same lines, and then the fix is one amend to the committed spec.
- **Coverage is mechanical; correctness stays with review.** The check proves every deleted block has a row and every named test exists. Whether the row's claim is true is the reviewer's and the holdout's job. The check must never be described as proving a rule was implemented.
- **Fail closed inside scope.** Within the PRs it applies to, any doubt (an unparseable inventory, a git error, an unreadable spec) fails or errors. It never turns into a pass.
- **No new Commissaire surface.** This is a factory-region `faff` command. It touches no `faff commissaire` verb and no governance-check input. It reads only whether the diff adds or modifies a path under `.faff/anchors/`, never an anchor's content.
- **The threat is forgetting, not lying.** The rows are written by the agent the check gates, so a row can be false. The check's job is to force a written, quoted answer for every deleted block and to put the risky answers (`dropped`, `changed`) in front of the reviewer, not to stop an author who writes a false row. The reviewer, the independent review and the holdout own that. The same holds for the moved test: echoing a rule's text into other prose satisfies it, and review catches that.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/regions.js` (`regions check --base`) | JavaScript | The precedent for a base-relative ratchet: `--base REF` with a plain-ref guard, and a no-base mode |
| `.github/workflows/validate.yml`, the "Enforce the region require-graph … TS-first leg" step | YAML / bash | The env-only `pull_request` / `push` base-resolution block this command's CI step copies |
| `.github/workflows/governance.yml` (`on-missing: pass`) | YAML | The precedent for scoping a gate by artifact footprint: agent PRs carry an artifact, hand-authored PRs do not |
| `plugin/skills/faff/bin/lib/config-core.js` (`resolveSpecDocsPath`) | JavaScript | Resolves `tracking.spec_docs_path` (this repo: `records/specs/`) |
| `plugin/skills/faff/bin/lib/prose-size.ts` | TypeScript | The sibling prose ratchet; defines which files count as skill prose |
| `records/specs/2026-11-03-FAFF-1418-…-design.md`, `records/specs/2026-10-30-FAFF-1435-…-design.md` | Markdown | Existing `## Rule inventory` tables: a `Prose rule` column, a `Disposition` column, and (in FAFF-1435) a `Covering test` column |
| `plugin/skills/faff/bin/lib/lint-cli-coverage.js`, `regions.js` `REGION_SELFTEST_ARGV`, `docs/guide/cli.md` | JavaScript / Markdown | Registration a new command needs |
| `docs/reference/skill-authoring.md` | Markdown | The home for the inventory format |
| `plugin/skills/faffter-dark-nlspec/SKILL.md` | Markdown | This repo's spec producer; gains a pointer to the format |
| `plugin/skills/faff/bin/lib/spec-commit.ts` | TypeScript | Commits the builder view of the spec, holdout blocks withheld, everything else byte for byte |

**Scope.** One new check in the `validate` job, one documented table format, one pointer in the spec producer. It sits beside `regions check` and `validate-adapters` as a repository lint.

## 2. OUT OF SCOPE

- **Checking the operator's test-repoint rule.** In an extraction PR, a test that pinned removed prose may be repointed at the command only with a guarantee-to-test map and a mutation proof for each guarantee. A check that a PR which edits such a test carries that map is a separate concern: it reads test diffs, not prose diffs, and a mutation proof is not machine-checkable from the diff. **Why excluded:** a different input and a judgement this check cannot make. **Extension point:** a second verb on the same module (`faff rule-inventory tests`), reading the same spec's guarantee table. See the non-blocking Punt in section 7.
- **Proving a row's claim.** The check does not read the command code to confirm a `kept` rule is implemented. **Why excluded:** that is the holdout's and the reviewer's job; a mechanical "implemented" check would be a false assurance. **Extension point:** none planned.
- **Back-filling old specs.** Inventories already on `main` lack the quoted anchor. **Why excluded:** the check is diff-scoped, so a spec already merged is never read. **Extension point:** none needed.
- **Prose outside the `prose-size` covered set.** `docs/`, ADRs and code comments are not watched. **Why excluded:** the ticket scopes the runtime prompt prose. **Extension point:** `prose-size`'s `isCovered`, which both gates share.
- **Rewording detection by similarity.** A one-word edit to a rule (for example "fail closed" to "fail open") is a deletion like any other. **Why excluded:** a fuzzy "edited in place" exemption would wave through exactly the edits the check exists to catch. **Extension point:** none; see the noise failure mode in section 4.
- **A PR label or commit trailer that skips the check.** **Why excluded:** no workflow in this repo reads a label or trailer to skip a gate, so there is no precedent. The scope rule in section 3 (the footprint test) does the job instead. **Extension point:** the scope function in the module.

## 3. WHAT — Vocabulary, Types and Interfaces

**Vocabulary.**

| Term | Meaning |
|---|---|
| Watched file | A path under `plugin/skills/` that `prose-size`'s exported `isCovered` accepts (every `<skill>/SKILL.md` and every `<skill>/references/*.md`), at base or at head. The check imports that predicate rather than keeping its own list, so it and the byte ratchet always agree on what skill prose is |
| Block | One markdown unit of a watched file as it stands at base: a paragraph, a list item with its continuation lines, a table row, a heading, or a fenced code block from fence to fence |
| Deleted block | A block with at least one line the diff deletes. Its **deleted text** is those deleted lines, joined with single spaces |
| Exempt block | A deleted block that states no rule, decided per block by shape and by what else is deleted: a table separator row (`|---|`); a block whose deleted text has no letters; a table's header row (the row directly above its separator in the base file) when every row of that table is deleted too; or a heading when every block of its section (up to the next heading of the same or higher level) is deleted too. A heading or header row deleted or reworded on its own is not exempt, so a rule carried in a heading needs a row. Blank lines are not blocks; they only end one |
| Moved | A deleted block whose normalised deleted text is a substring of the normalised text of a single block of a watched file at HEAD. Head blocks are parsed exactly as base blocks are and never joined to each other, so a match cannot straddle two unrelated blocks, and a reflowed paragraph matches its own head block whether or not some of its lines were left unchanged |
| Committed spec | A file the diff adds (status `A` against the base) under the configured spec docs path whose name ends `-design.md`. A spec already on the base and only modified is not read, so a PR never inherits an older spec's rows |
| Agent footprint | The diff adds or modifies (status `A` or `M`) at least one path under `.faff/anchors/`, which graft's Step 9b commits on every agent PR. A follow-up PR that only updates an existing anchor still carries the footprint |
| Anchor | The first code span in a row's `Prose rule` cell |
| Normalise | Delete every `*` and every backtick, collapse every run of whitespace to one space, and trim. Applied identically to anchors, deleted text and head blocks, so an author may quote a rule with or without its bold lead and code spans |

**The inventory format** (documented in `docs/reference/skill-authoring.md`).

- The section is any heading line matching `## Rule inventory` at its start (so `## Rule inventory (slice A)` counts). It runs to the next `## ` heading.
- Every markdown table in the section whose header has a `Prose rule` cell and a `Disposition` cell is an inventory table. Columns are found by header name, case-insensitively; other columns are free.
- **Prose rule cell:** must contain a code span whose content is the anchor. CommonMark backtick-run rules apply: an anchor that itself contains a backtick is written with a longer delimiter (``` `` like `this` `` ```). Inside a table cell, a literal pipe is written `\|` and is unescaped before matching. Quote the lines the PR deletes, not the block as it stood: when only part of a paragraph is deleted, the anchor must sit inside the deleted part.
- **Covering test cell** (optional column): zero or more entries of the form `test/<path>.test.mjs`, each optionally followed by `: "<test name>"`. Separated by `;` or `,`. A path must match `^test/[A-Za-z0-9._/-]+\.test\.mjs$` and contain no `..` segment; anything else is a row error, and the file is never looked up.
- **Disposition cell:** exactly one of `kept`, `changed: <reason>`, `dropped: <reason>`. A reason is non-empty after trimming.
- A preamble sentence naming a default test file (as the FAFF-1418 inventory has) is not read. Each `kept` row names its own test, so a table with any `kept` row needs a `Covering test` column.

```
RECORD InventoryRow:
  spec: Path                  # the committed spec it came from
  line: Int                   # 1-based line in that spec, for error messages
  anchor: String | null       # normalised; null when the cell has no code span
  tests: List<TestRef>        # empty when the column is absent or the cell is empty or "—"
  disposition: "kept" | "changed" | "dropped" | "invalid"
  reason: String | null

RECORD TestRef:
  file: Path                  # repo-relative, must start "test/" and end ".test.mjs"
  name: String | null

RECORD CheckResult:
  result: "pass" | "fail" | "skipped"
  skipped_reason: "no-prose-deleted" | "no-spec-committed" | "no-base" | null
  footprint_without_spec: Bool   # true when the diff has an agent footprint but no committed spec (a fail)
  base: String                # the resolved base commit, or "" when skipped for no-base
  specs: List<Path>
  blocks_deleted: Int         # non-exempt deleted blocks
  covered_moved: Int
  covered_by_row: Int
  row_covered: List<{ file: Path, base_line: Int, disposition: String, reason: String | null, spec: Path, spec_line: Int }>
  uncovered: List<{ file: Path, base_line: Int, excerpt: String }>   # excerpt ≤ 120 chars
  row_errors: List<{ spec: Path, line: Int, reason: String }>
  warnings: List<String>      # e.g. a row whose anchor matches no deleted block
```

**Command surface.**

```
faff rule-inventory check [--base REF] [--json] [--summary FILE]
  exit 0  pass or skipped
  exit 1  fail (uncovered blocks, row errors, or an agent footprint with no spec)
  exit 2  usage error, a REF that is not a plain ref or names no commit, a git failure,
          an unreadable committed spec, or an unreadable config
```

Without `--json` it prints one line per uncovered block, `rule-inventory: uncovered <file>:<base_line>: <excerpt>`, one per row error, `rule-inventory: row-error <spec>:<line>: <reason>`, one per warning, `rule-inventory: warning <spec>:<line>: <text>`, then `rule-inventory: <result> (<counts>)`. With `--json` it prints the `CheckResult` object on stdout. Every message about an uncovered block names `docs/reference/skill-authoring.md#rule-inventory` so the author learns the format from the failure. With `--summary FILE` it also appends a markdown table of every row-covered block, `dropped` and `changed` rows first, to FILE; the CI step passes `$GITHUB_STEP_SUMMARY`, so the reviewer sees each dropped rule on the PR's check page.

**Output hygiene.** The committed spec is untrusted input, and its text reaches the CI log. Every printed line starts with the fixed prefix `rule-inventory: `, so no spec text can start a line, which is where GitHub reads `::error::`-style workflow commands. The one exception is the skip notice, a fixed literal with no spec-derived text: `::notice::rule-inventory: skipped, no spec committed`. Every spec-derived value is stripped of control characters (including ESC and newlines) and capped at 200 characters before it is printed, written to the summary or put in the JSON. In the `--summary` table every spec-derived value is also escaped for markdown: backslash, backtick, `*`, `_`, `[`, `]`, `(`, `)`, `!`, `|` and `#` each get a backslash, and `<`, `>` and `&` become `&lt;`, `&gt;` and `&amp;`, so a value can neither break the table, add a link or image, nor inject HTML into the rendered check page. A committed spec larger than 1 MiB is not parsed: exit 2.

**Design decisions.**

**How a deleted block maps to a row.** Options: each row cites a line range; each row carries a quoted anchor; or a deletion counts as covered when any row quotes it. Line ranges break on every rebase and on any upstream edit to the same file. A quoted anchor survives both. "Any row quotes it" is the same as the anchor option once the quote must sit inside the block's deleted text.
**Chosen:** a quoted anchor. A row covers a deleted block when its normalised anchor, at least 20 characters long, is a substring of the block's normalised deleted text. One row may cover several blocks that contain the same text (duplicated prose). The 20-character floor stops an anchor like `` `faff next` `` from covering every block that mentions the command. A deleted block shorter than 20 characters is covered by an anchor equal to its whole normalised deleted text, and such a short anchor covers only blocks whose whole deleted text it equals, never a longer block that merely contains it.

**Where it runs.** Options: a new `faff` command run by `governance-check`; a leg of `validate-adapters`; a new command run as its own step in the `validate` job.
**Chosen:** a new command, `faff rule-inventory check`, written in TypeScript in the factory region, run as its own step in `validate.yml` beside `regions check`. `governance-check` is Commissaire's anchor-driven floor; adding a prose-diff input to it would grow Commissaire, which is not allowed. `validate-adapters` is a whole-tree lint with no base, and it is a legacy JavaScript module, whereas new code must be TypeScript. `regions check --base` already shows the base-relative pattern this needs, including the env-only base resolution in CI. Tests go in `test/rule-inventory.test.mjs`, registered as `REGION_SELFTEST_ARGV["rule-inventory"] = null` with a `TEST_FILE_COVERAGE` entry.

**Pure prose edits.** Options: a PR label; a commit trailer; scope by artifact footprint; no exemption at all.
**Chosen:** scope by artifact footprint, with no label or trailer. The check applies when the PR commits a spec under the spec docs path or carries an agent footprint. Graft commits the spec (`faff spec commit`, Step 4) and an anchor (Step 9b) on every agent build, so every agent PR that deletes prose is checked, and an agent PR that deletes prose with an anchor but no spec fails (`footprint_without_spec`) instead of skipping. A hand-authored prose edit carries neither, so it passes with `skipped_reason: "no-spec-committed"` and a `::notice::` line in the log. This is the same footprint test `governance-check` already uses (`on-missing: pass`), with the same accepted residual: an actor who strips both the spec and the anchor presents as a human PR. When `governance.yml` flips to `on-missing: fail` because the branch has become agent-only, this check's no-spec skip should flip to a fail with it; that is a one-line change to the scope function. No workflow here reads labels or trailers to skip a gate. Inside scope there is no exemption: a reworded rule needs a row like any other deletion, typically `changed: reworded, same rule`. A verbatim move or a reflow needs none, because the moved test covers it.

**Blocking from day one, or report first.** Options: block immediately; report as a warning for a period, then block.
**Chosen:** block from day one. Nine extraction PRs (FAFF-1414 through FAFF-1418, and FAFF-1434 to FAFF-1437) have shipped with inventories, so the table format is proven. Three things are new: the code-span anchor, the closed disposition grammar, and a covering test on every `kept` row. Old rows written as "kept in prose" map onto the grammar without loss: a rule still present word for word is not deleted and needs no row, and a rule reworded but still in prose is `changed: reworded in prose`. Every failure message names the format doc. The repo's one advisory size gate (`size-census --gate`, with `--enforce` still commented out) shows that a report-only gate is not acted on. The check is diff-scoped, so no merged spec needs back-filling. Open PR #1086 edits `faff-graft/SKILL.md` but commits no spec, so the footprint scope skips it.

**Base when `--base` is absent (local runs).** Options: skip; compare with `origin/HEAD`; compare with a configured base branch.
**Chosen:** compare with `git merge-base HEAD origin/HEAD` when `origin/HEAD` resolves, otherwise exit 0 with `skipped_reason: "no-base"`. There is no base-branch key in config, and `origin/HEAD` is what `git clone` sets. CI always passes `--base`, so CI never takes the skip. The no-base command line stays literal in `validate.yml` so `faff gates discover` finds it as a local rung for graft's ladder.

**Covering-test requirement by disposition.** Options: require a test on every row; on `kept` only; never.
**Chosen:** a `kept` row must name at least one test; `changed` and `dropped` rows may name none, but must give a reason. Any test a row names must exist. A `kept` rule moved into code with no test is the exact gap FAFF-1430 found; a `dropped` rule has nothing to test.

## 4. HOW — Behaviour

**Summary.** Resolve the base, decide whether the check applies, parse the deleted blocks and the inventories, then mark each deleted block moved, covered or uncovered.

```
PROCEDURE rule_inventory_check(base_flag, json):
  1. Resolve the base.
     a. IF base_flag given: reject it unless it matches ^[A-Za-z0-9._/-]+$ and does not start with "-" (exit 2);
        verify it names a commit (git rev-parse --verify REF^{commit}), else exit 2.
        base := REF itself. The diff is REF's tree against HEAD's tree, as `regions check --base` compares.
     b. ELSE IF origin/HEAD resolves: base := git merge-base origin/HEAD HEAD.
     c. ELSE: return skipped("no-base").
  2. List changed paths: git -c core.quotePath=false diff -z --no-renames --name-status base HEAD.
     Every git call that lists or reads paths uses -z or passes paths as separate arguments, never parses
     quoted output. A path under plugin/skills/ the parser cannot decode is an exit 2, never a skip.
     watched_changed := paths that are watched files.
     specs := paths with status A under resolveSpecDocsPath() whose name ends "-design.md".
     footprint := some path with status A or M starts ".faff/anchors/".
  3. FOR each watched file in watched_changed:
       base_text := git show base:<path> (empty when the file is added)
       deleted_lines := line numbers from git diff -U0 --no-renames base HEAD -- <path> hunk headers
       head_text := git show HEAD:<path> (empty when the file is deleted)
     blocks := parse base_text into blocks; keep those with ≥1 deleted line; drop exempt blocks.
  4. IF no non-exempt deleted block: return skipped("no-prose-deleted").
  5. IF specs is empty AND footprint: return fail with footprint_without_spec = true.
     IF specs is empty: print the fixed skip notice and return skipped("no-spec-committed").
  6. head_blocks := [normalise(joined text of b) for every block b of every watched file at HEAD,
     including watched files the diff does not touch].
  7. rows := for each spec, read it at HEAD (exit 2 if unreadable or over 1 MiB), parse every inventory table.
     A spec with no "## Rule inventory" section contributes no rows.
  8. Validate each row:
     - anchor null → row_error "Prose rule cell has no code-span anchor"
     - anchor shorter than 20 characters and not equal to the whole normalised deleted text
       of some deleted block → row_error "anchor shorter than 20 characters"
     - disposition invalid, or changed/dropped with an empty reason → row_error
     - kept with no tests → row_error "kept row names no covering test"
     - each TestRef: file must match ^test/[A-Za-z0-9._/-]+\.test\.mjs$ with no ".." segment, else row_error
       (and no lookup); then it must exist at HEAD (git cat-file -e HEAD:<file>), else row_error;
       if name given, the file text must contain the name as written, else row_error
  9. FOR each deleted block b:
       IF normalise(b.deleted_text) is a substring of some single element of head_blocks: covered_moved += 1
       ELSE IF some valid row's anchor A covers b, where A covers b when
            (len(A) ≥ 20 AND A is a substring of normalise(b.deleted_text)) OR A == normalise(b.deleted_text):
         covered_by_row += 1; row_covered += { b, that row's disposition, reason, spec, line }
       ELSE: uncovered += { b.file, b.first_deleted_base_line, first 120 chars of the deleted text }
 10. FOR each valid row whose anchor matches no deleted block: warning "anchor matches no deleted prose".
 11. IF uncovered is non-empty AND no spec has a "## Rule inventory" section:
       add one row_error per spec: "no ## Rule inventory section".
     (A PR whose deleted blocks are all moved needs no inventory section.)
 12. result := fail IF uncovered or row_errors are non-empty, ELSE pass.
 13. IF --summary FILE: append the row_covered table to FILE, dropped and changed rows first.
```

**Block parsing.** Parse the base file line by line, tracking fence state. A fence opens on a line whose trimmed form starts with three or more backticks or tildes and closes on the next matching fence; the whole fenced region is one block. Outside fences, a blank line ends a block; a heading line, a table row (trimmed line starting `|`) and a list-item line (trimmed line starting `-`, `*`, `+` or `N.` followed by a space) each start a new block; any other line continues the current block. This only has to be as good as the authoring standard's markdown, not a full CommonMark parser.

**CI step.** A new step in the `validate` job of `validate.yml`, right after the region step, using the same env-only block: on `pull_request`, check `BASE_REF` is a plain ref, `git fetch --depth=1 origin +refs/heads/$BASE_REF:refs/remotes/origin/$BASE_REF`, then `node plugin/skills/faff/bin/faff rule-inventory check --base "origin/$BASE_REF" --summary "$GITHUB_STEP_SUMMARY"`; on `push`, use `BEFORE` the same way, and the all-zeros case runs the literal no-base line. Event values reach the script only through `env`. On `pull_request` the checkout is the PR's merge commit, so its tree against the base tip is exactly the PR's change, and a depth-1 fetch is enough because only the two trees are read. On `push`, `BEFORE` against HEAD is the pushed change. A local run with `--base` on a branch that is behind compares trees directly, so upstream changes would show as deletions; the help text says to pass a merge-base, and the no-base default computes one.

**Edge cases.**

- **A whole watched file deleted.** Every block of it is a deleted block.
- **A watched file renamed.** `--no-renames` makes it a delete plus an add; its unchanged text is in the head blocks of the new path, so every block is moved.
- **A paragraph reflowed.** Its deleted lines are a substring of the paragraph's own head block, so it is moved, including when some of its lines were left unchanged.
- **A rule extended in place** ("fail closed on X" becomes "fail closed on X and Y"). The old text is still inside the head block, so it is moved; nothing was lost.
- **Prose moved into a non-watched file** (for example `docs/`). Not moved; it needs a row, normally `dropped: moved to docs/<file>`.
- **A spec modified but not added** (a PR that edits an older spec). Not a committed spec; its rows are not read, and old inventories without a `Covering test` column never need retrofitting.
- **Several committed specs.** Their rows are pooled.
- **A committed spec at a path outside the spec docs path.** Not read.
- **Base equals HEAD.** No changed paths, so `skipped("no-prose-deleted")`.

**Error categories.**

| Situation | Exit | Note |
|---|---|---|
| Bad `--base` value, unknown flag, extra positional | 2 | usage |
| Git command fails, merge-base not found | 2 | never a pass |
| Committed spec unreadable at HEAD, config unreadable | 2 | never a pass |
| Uncovered block or row error | 1 | lists every one, not just the first |
| No base resolvable without `--base` | 0 | `skipped`, local only |

**Anti-pattern:** treating a malformed inventory table as "no inventory" and skipping. Why: that turns a typo into a pass. A table whose header has `Prose rule` but no `Disposition` is a row error on its header line.

**Anti-pattern:** reading the spec from the tracker or from `.faff/`. Why: the check must run in CI from the checkout alone; the committed spec is the record.

**Failure modes.**

- **The check is noisy on feature PRs.** Every reworded line of skill prose needs a row, so a feature PR that edits a lot of prose could need many. **How you'd know:** graft forks or reviewers report rows that only say `changed: reworded`, for many PRs in a row. **What it means:** narrow, by revisiting the rewording exemption as its own ticket, not by weakening this check in place.
- **Anchors drift into fragments.** An author picks a 20-character anchor that sits inside the block but names nothing about the rule. **How you'd know:** review finds rows whose anchor is a stock phrase. **What it means:** proceed; this is a review-quality issue, and the 20-character floor is a floor, not the standard.
- **An agent PR commits neither a spec nor an anchor.** It would be skipped as a human PR. **How you'd know:** the `::notice::` skip line on a PR that the run ledger or the PR body shows graft opened. **What it means:** graft's `faff spec commit` and `faff pr open` both require their artifacts, so this is a graft defect to file; the long-term fix is the `on-missing: fail` flip above, not a label.
- **The moved test matches by containment, not meaning.** A short deleted block can appear inside an unrelated head block, and an edit that wraps a rule in new words ("fail closed on X" becoming "never fail closed on X") still contains the old text. **How you'd know:** a review finds a block counted as moved whose meaning changed. **What it means:** proceed; the diff shows the edit to the reviewer, the threat model is forgetting, and a negation is a deliberate edit, not a forgotten rule.

**Scenario fixtures.** Each scenario in section 5 runs against a fixture git repository with a local bare `origin`, `tracking.spec_docs_path: records/specs/` in its config, and a commit on a branch compared with `--base origin/main`.

## 5. SCENARIOS

> 6 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a branch that deletes a paragraph from plugin/skills/faff-graft/SKILL.md
And the branch commits records/specs/2026-11-04-FAFF-9-x-design.md with no "## Rule inventory" section
When faff rule-inventory check --base origin/main --json runs
Then it exits 1
And the JSON result is "fail" with one uncovered entry naming plugin/skills/faff-graft/SKILL.md
And row_errors names the spec with "no ## Rule inventory section"
```

```
Given a branch that deletes two bullets from plugin/skills/faff-prep/SKILL.md
And commits a spec whose Rule inventory has one row per bullet, each quoting 30 characters of its bullet in a code span
And each row is "kept" naming an existing test/x.test.mjs
When faff rule-inventory check --base origin/main --json runs
Then it exits 0
And the JSON reports covered_by_row 2 and uncovered []
```

```
Given a branch that deletes a paragraph from plugin/skills/faff-graft/SKILL.md and commits no file under records/specs/
When faff rule-inventory check --base origin/main --json runs
Then it exits 0
And skipped_reason is "no-spec-committed"
```

```
Given a branch that deletes a paragraph from plugin/skills/faff-graft/SKILL.md
And adds .faff/anchors/FAFF-9/anchor.json but commits no file under records/specs/
When faff rule-inventory check --base origin/main --json runs
Then it exits 1
And footprint_without_spec is true
```

```
Given a branch that deletes a bullet and commits a spec with a valid row for it plus a second "dropped: obsolete" row quoting text that appears in no deleted block
When faff rule-inventory check --base origin/main --json runs
Then it exits 0
And warnings contains "anchor matches no deleted prose"
```

```
Given a branch that deletes a bullet and commits a spec whose row for it reads "dropped: ::error::forged"
When faff rule-inventory check --base origin/main runs
Then no line of its output starts with "::error::"
```

```
Given a branch that deletes two bullets and commits a spec with a "kept" row naming an existing test/x.test.mjs for one and a "dropped: superseded by faff x" row for the other
When faff rule-inventory check --base origin/main --summary out.md runs
Then it exits 0
And the first table row in out.md is the dropped one
```

```
Given a branch that deletes a bullet and commits a spec whose row for it is "kept" with an empty Covering test cell
When faff rule-inventory check --base origin/main --json runs
Then it exits 1
And row_errors contains "kept row names no covering test"
```

```
Given a branch that changes the text of one heading in plugin/skills/faff-graft/SKILL.md and nothing else
And commits a spec with an empty Rule inventory table
When faff rule-inventory check --base origin/main --json runs
Then it exits 1
And the uncovered entry is the heading's base line
```

```
Given a branch that deletes a bullet and commits a spec larger than 1 MiB
When faff rule-inventory check --base origin/main runs
Then it exits 2
```

```
Given a branch that deletes a whole "### Example" section of plugin/skills/faff-graft/SKILL.md: its heading and one paragraph
And commits a spec whose one row quotes 30 characters of the paragraph, "dropped: obsolete example"
When faff rule-inventory check --base origin/main --json runs
Then it exits 0
And blocks_deleted is 1
```

```
Given a branch that deletes one line of only "---" from plugin/skills/faff-graft/SKILL.md
And commits a spec with no Rule inventory section
When faff rule-inventory check --base origin/main --json runs
Then it exits 0
And skipped_reason is "no-prose-deleted"
```

```
Given a branch that deletes two bullets, "- Fails loud." and a longer bullet containing "Fails loud." among other words
And commits a spec whose only row has the anchor "- Fails loud." and "dropped: merged"
When faff rule-inventory check --base origin/main --json runs
Then it exits 1
And the uncovered entry is the longer bullet
```

```
Given faff rule-inventory check is run with --base "-x"
When it runs
Then it exits 2
And nothing is printed on stdout
```

- The check MUST NOT exit 0 when a git command it runs fails.

## 6. DESIGN DECISION RATIONALE

| Decision | Options considered | Outcome |
|---|---|---|
| How a deleted block maps to a row | line range (breaks on rebase); quoted anchor (survives rebase); any-row-quotes (same as anchor) | **Chosen:** a quoted code-span anchor of at least 20 characters (or the whole text of a shorter block), matched as a substring of the block's deleted text |
| Where it runs | `governance-check` (grows Commissaire); `validate-adapters` leg (no base, legacy JS); new command in `validate` | **Chosen:** new TypeScript factory command `faff rule-inventory check`, its own `validate.yml` step beside `regions check` |
| Pure prose edits | PR label or trailer (no precedent); footprint scope (precedent in `governance.yml`); no exemption | **Chosen:** footprint scope — applies when the PR commits a spec or an anchor, fails an anchor with no spec; no label or trailer |
| Blocking or report first | block now; warn then block | **Chosen:** block from day one; the format is proven by nine shipped inventories and advisory gates here go unenforced |
| Base without `--base` | skip; `origin/HEAD`; configured branch (no key exists) | **Chosen:** merge-base with `origin/HEAD`, else skip with `no-base`; CI always passes `--base` |
| Covering test by disposition | always; `kept` only; never | **Chosen:** `kept` needs at least one test; any named test must exist; `changed`/`dropped` need a reason |

At the time of writing there is no base-branch key in `.faffrc.yaml`; if one is added, the no-base default should read it.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.**

- **Checking the test-repoint rule.** The operator's standing rule lets an extraction PR repoint a test that pinned removed prose, provided the PR carries a guarantee-to-test map and a mutation proof for each guarantee. This check could later verify the map exists and names real tests, using the same table parser.
  **Punt:** add a `faff rule-inventory tests` verb for the guarantee map, or keep that rule review-only — needs human (decides: product) (non-blocking). See OUT OF SCOPE, "Checking the operator's test-repoint rule". This increment does not depend on it: the prose check stands alone.

**Assumptions.** None open. Two facts were checked against the tree at prep:

- Graft's Step 4 `faff spec commit` commits the builder view to `<spec-docs-path>/YYYY-MM-DD-<issue>-<slug>-design.md` as the branch's first commit. The builder view withholds only holdout scenario blocks (`dodSplit`), so a `## Rule inventory` table reaches the committed spec intact.
- `validate` is the branch-protection-required check (the FAFF-987 comment in `validate.yml`), so a failing step blocks merge.

## 8. DONE — Definition of Done

### From WHY
- [ ] A PR that deletes a non-exempt block of skill prose, commits a spec, and has no row or move covering the block fails `faff rule-inventory check` with exit 1, naming the file and base line.

### From WHAT (interfaces)
- [ ] `faff rule-inventory check [--base REF] [--json] [--summary FILE]` exists, with exits 0 / 1 / 2 as section 3 defines.
- [ ] `--json` output has every `CheckResult` field.
- [ ] The inventory format (section heading, `Prose rule` code-span anchor, `Covering test`, `Disposition`) is documented in `docs/reference/skill-authoring.md` under a `Rule inventory` heading, and every uncovered-block message names that anchor.
- [ ] `plugin/skills/faffter-dark-nlspec/SKILL.md` gains one line telling the producer that a spec deleting skill prose carries a `## Rule inventory` in that format, and `prose-baseline.json` is raised by exactly that file's growth.
- [ ] The command is TypeScript (`rule-inventory.ts` with its committed `.js` emit and `build-manifest.json`), in the factory region, with `REGION_SELFTEST_ARGV["rule-inventory"] = null`, a `TEST_FILE_COVERAGE` entry for `test/rule-inventory.test.mjs`, and a `docs/guide/cli.md` row; `faff regions check`, `faff lint-cli-coverage` and `faff lint-cli-doc` pass.

### From HOW (behaviour)
- [ ] A row's anchor covers a block only when it is at least 20 characters and a substring of the block's normalised deleted text, or when it equals that whole text; a short anchor never covers a longer block containing it.
- [ ] A deleted block whose text sits inside a single head block of any watched file counts as moved, with no row needed, including a reflow that leaves some lines unchanged.
- [ ] The watched set is `prose-size`'s exported `isCovered`, imported, not a second list.
- [ ] Path listing uses `-z` with `core.quotePath=false`; a watched-looking path the parser cannot decode exits 2.
- [ ] A move into a non-watched file is not moved.
- [ ] Table separator rows and letterless blocks are exempt; a table header row is exempt only when its whole table is deleted, and a heading only when its whole section is deleted.
- [ ] Normalise deletes `*` and backticks and collapses whitespace, on anchors, deleted text and head blocks alike.
- [ ] Only specs the diff adds are read; a modified older spec contributes no rows.
- [ ] A diff that adds or modifies a path under `.faff/anchors/` but commits no spec fails with `footprint_without_spec: true`.
- [ ] `--summary` escapes markdown metacharacters and HTML in every spec-derived value.
- [ ] A covering-test path outside `^test/…\.test\.mjs$` or with a `..` segment is a row error and is never looked up.
- [ ] Every printed line starts with `rule-inventory: `; spec-derived values are stripped of control characters and capped at 200 characters; a committed spec over 1 MiB exits 2.
- [ ] `--summary FILE` appends the row-covered table, `dropped` and `changed` first, and the CI step passes `$GITHUB_STEP_SUMMARY`.
- [ ] A row whose anchor matches no deleted block produces the warning `anchor matches no deleted prose` and does not fail the check.
- [ ] `kept` rows with no test, `changed`/`dropped` rows with no reason, and rows naming a missing test file or a test name absent from the file are row errors.
- [ ] A PR that commits no spec is `skipped` with `no-spec-committed`; one that deletes no non-exempt prose is `skipped` with `no-prose-deleted`.
- [ ] Without `--base`, the base is the merge-base with `origin/HEAD`, or the result is `skipped` with `no-base`.
- [ ] A failing git command, an unreadable committed spec, or a bad `--base` exits 2, never 0.
- [ ] `validate.yml` runs the check on `pull_request` with `--base origin/$BASE_REF` and on `push` with `BEFORE`, with event values reaching the script only through `env`, an unfetchable `BEFORE` failing the step, and the literal no-base line present for `faff gates discover`.

### From HOW (tests)
- [ ] `test/rule-inventory.test.mjs` covers each scenario in section 5, each row-error kind and each exemption rule (separator, letterless, header row with and without its whole table, heading with and without its whole section), using fixture repos with a local bare origin, and passes under `node --test`.
- [ ] A mutation test shows each check bites: removing the anchor-length floor, the kept-needs-test rule, or the moved test each makes at least one case in the file fail.

### Integration smoke test

```
1. Make a fixture repo with a bare origin; commit a SKILL.md with three bullets to main; push.
2. Branch; delete bullet two; add records/specs/2026-11-04-FAFF-9-x-design.md with a
   Rule inventory row quoting bullet two, "kept", naming test/a.test.mjs; add test/a.test.mjs.
3. Run faff rule-inventory check --base origin/main --json  → exit 0, covered_by_row 1.
4. Remove the row; run again → exit 1, one uncovered entry for bullet two.
```

## Methodology critique

*Lens: faffter-dark-methodology-agile-delivery, issue-critique.*

- **Right-sized?** No issues. One command, one CI step, one documented format and a one-line producer pointer is a single 1–3 day unit, and the parts always ship together: the command without the documented format would fail every author with no way to learn the fix.
- **Workstream fit?** No issues. It is the guardrail for the skill-to-determinism track, which the 2026-10-22 review's extractions created, and it lands before the next batch of extractions rather than after.
- **Deps surfaced?** No issues. Nothing blocks it. FAFF-1429 and FAFF-1430 are the losses this would have caught; they are related, not blockers, and either can land first.
- **Risk profile?** Low integration risk; the one real risk is noise on feature PRs that reword prose, which the spec names as a failure mode with its observable and its response. No de-risking spike is warranted: the cost of being wrong is rows, not broken builds.

confidence: high
build-tier: complex
admissibility: admissible
spec-review: accept (human, after round 5)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "punt" }
  ] }
```
