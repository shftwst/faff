*Agent-written (Claude Code): FAFF-1442 spec, produced by interactive prep for the operator. Revised after spec-review round 1.*

# FAFF-1442: Track skill prose size in bytes and ratchet it down

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1442.

This spec is for the build agent and its reviewers. It adds a per-file byte ratchet over every skill prompt file, beside the existing line checks, and a `faff prose-size tally` command that reproduces the prose-size history from git, so "has the skills-to-code lane shrunk the prose?" is a lookup.

## 1. WHY

**The load-bearing idea:** the cost the lane exists to cut is bytes re-read into context on every turn. A line count is a proxy that misses a long line getting longer and misses `references/*.md` entirely, so the ratchet must measure bytes, over every file an agent loads as skill prose.

**Problem.**
- The only size gate is `SKILL_LINE_BASELINE` in `plugin/skills/faff/bin/lib/validate-adapters.js` (l. 65), which covers four `SKILL.md` files by line count, plus `KERNEL_LINE_BASELINE` (l. 64) for `faff/references/kernel.md`. Every other `SKILL.md` has only the 600-line shared ceiling (`SKILL_LINE_CAP`, l. 43); the other eight `faff/references/*.md` files have no size check at all.
- Measured from git on the window `a30b6504^..8e8765d4` (the commit before FAFF-1396 to the FAFF-1414 merge): the three orchestrator `SKILL.md` files went from 519,644 to 513,271 bytes. The six extraction tickets removed 23,289 bytes and other features added 16,916 back. All skill prose (the 41 files in §3) went from 1,441,534 to 1,442,705 bytes, a net rise of 1,171, while every line baseline went down or held.
- Answering that took a hand reconstruction. Nothing records it.

### Design principles

**Never weaken a gate.** Every check a file has today stays. The byte ratchet is added on top, so no file can pass this change's checks that fails today's.

**Measure what is loaded.** The covered set is exactly the files an agent reads as skill prose: each skill's `SKILL.md` and each `references/*.md` beside it.

**A raise is a conspicuous diff line, never a silent pass.** As with the line baselines today, growth fails until someone edits the baseline value in the same PR. The tooling lowers baselines and never raises them.

### Reference context

- `plugin/skills/faff/bin/lib/validate-adapters.js`: `SKILL_LINE_CAP` l. 43, `KERNEL_LINE_BASELINE` l. 64, `SKILL_LINE_BASELINE` l. 65, `resolveSkillsDir` l. 612 (the script-relative default is `plugin/skills`), `cmdValidateAdapters` l. 975, the per-file line-cap loop l. 1225–1242, the kernel ratchet l. 1383–1398.
- `test/validate-adapters.test.mjs`: the FAFF-584 cases (l. 245–335), including the zero-headroom check that the hub files sit exactly at their baseline on the real tree.
- `docs/reference/skill-authoring.md` l. 22–34: the lint table and the honest-limits paragraph that name the line caps.
- Registration pattern for a new command: `regions.js` (`REGION_MAP` l. 365 area and `REGION_SELFTEST_ARGV` l. 670), `lint-cli-coverage.js` `TEST_FILE_COVERAGE` (l. 41 area), `bin/faff` dispatch table (l. 246 area); the most recent example is `run` (`run.ts`, `test/run-summary.test.mjs`).
- `plugin/skills/faff/legacy-js-modules.json` lists `validate-adapters.js`, so it stays JavaScript.

### Already shipped against this surface

- **FAFF-120 / FAFF-584:** the line caps and the zero-headroom hub ratchet with its `RATCHET` advisory. Kept unchanged.
- **FAFF-607:** the kernel line ratchet. Kept unchanged.
- No Done ticket measures bytes or reconstructs size history. The premise holds.

## 2. OUT OF SCOPE

- **Retiring any line check.** The 600-line ceiling, the four hub line baselines and the kernel line baseline all stay (see §4.2). **Extension point:** a later ticket can drop the hub line baselines once the operator decides bytes alone suffice; the byte ratchet does not depend on them.
- **Other prompt-shaped files** such as `faffter-dark-spec-review/refute-*.md` and the judge prompts. They are sent to external reviewers, not loaded as orchestrator context each turn. **Extension point:** the covered-set glob in `prose-size.ts`.
- **A byte budget in the spec contract** (the ticket's third open question). See §4.2: the baseline edit is already the stated cost.
- **A git-history check that baselines never rise.** The tally makes rises visible; turning that into a gate is separate. **Extension point:** `tally` rows already carry per-file deltas.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| covered set | Every `<skills-dir>/<skill>/SKILL.md` and every `<skills-dir>/<skill>/references/*.md` (not recursive). On the current tree: 32 `SKILL.md` and 9 `faff/references/*.md` files, 41 in all. |
| prose baseline | `plugin/skills/faff/prose-baseline.json`: the committed byte size of every file in the covered set. |
| bytes | The file's size on disk in bytes (`fs.statSync(p).size`), with no normalisation. |

### Interface

**Baseline file** (`<skills-dir>/faff/prose-baseline.json`):

```
{ "schema": 1,
  "files": {
    "<skill>/SKILL.md": <integer bytes>,
    "<skill>/references/<name>.md": <integer bytes>,
    ... } }
```

Keys are paths relative to the skills dir with `/` separators. The writer emits keys sorted, one per line, with a blank line between entries (§4.2). Readers use `JSON.parse` and ignore whitespace.

**`faff validate-adapters` (changed).** After the existing line-cap loop it runs the byte ratchet over the covered set:

| Case | Output | Effect |
|---|---|---|
| file larger than its baseline | `FAIL  <path> (prose bytes)` then `✗ <path> is <n> bytes (baseline <b>, +<d>)` | exit 1 |
| file smaller than its baseline | `RATCHET  <path> — now <n> bytes, below baseline <b> (-<d>); run faff prose-size baseline --lower to lock the reduction` | none |
| covered file with no baseline entry | `FAIL  <path> (prose bytes)` then `✗ not in prose-baseline.json; add "<path>": <n>` | exit 1 |
| baseline entry with no file | `FAIL  <path> (prose bytes)` then `✗ listed in prose-baseline.json but missing; remove the entry` | exit 1 |
| baseline file present but unreadable, not JSON, or a value not a non-negative integer | `FAIL  prose-baseline.json (prose bytes)` with the reason | exit 1 |
| baseline file absent, default skills dir (no `--skills-dir`) | `FAIL  prose-baseline.json (prose bytes)` `✗ missing` | exit 1 |
| baseline file absent, `--skills-dir` given | `INFO  prose bytes: no baseline at <path>; byte ratchet not applied` | none |

**`faff prose-size baseline --lower [--skills-dir DIR] [--json]`.** Rewrites the baseline file, setting each entry whose file is now smaller to its current size. It never raises an entry, never adds one and never removes one; it reports each grown, unlisted or missing file it left alone. Exit 0 when the file was read and written (even if nothing changed), 2 on a missing or malformed baseline or a write failure.

**`faff prose-size tally --from <ref> --to <ref> [--scope all|hot] [--group <label>=<T1>,<T2>,...]... [--repo DIR] [--json]`.** Reads git history only (never the working tree). For each first-parent commit in `<from>..<to>` it sizes the covered set under `plugin/skills/` at that commit and at its first parent.
- `--scope all` (default) is the covered set; `hot` is `faff-beep-boop/SKILL.md`, `faff-graft/SKILL.md` and `faff-prep/SKILL.md`.
- A commit's ticket is the last parenthesised `<KEY>-<n>` in its subject (`(FAFF-1396)`), else `untagged`.
- `--group` sums the net delta of the named tickets under a label; tickets in no group sum to `other`.

JSON shape:

```
{ "from": "<sha>", "to": "<sha>", "scope": "all"|"hot",
  "start_bytes": int, "end_bytes": int, "net": int,
  "rows": [ { "sha", "ticket", "subject", "delta": int, "total": int,
              "files": { "<path>": int } } ],
  "groups": [ { "label", "tickets": [..], "net": int } ],
  "other_net": int }
```

`rows` lists only commits with a non-zero delta, oldest first. `files` lists only files whose size changed (a file added counts from 0, one deleted counts to 0). The text form prints one row per commit (`<short sha> <ticket> <delta> <total>`), then the groups, `other`, start, end and net. Exit 0, or 2 when the repo or either ref cannot be resolved.

### Where the code lives

| File | Change |
|---|---|
| `plugin/skills/faff/bin/lib/prose-size.ts` (new, TypeScript, layout d) | `coveredFiles(skillsDir)`, `readBaseline(path)`, the pure `compareProse(measured, baseline)` returning `{ fails, ratchets }`, `lowerBaseline`, `serialiseBaseline`, `tally`, and `cmdProseSize(args)`. Committed `.js` emit plus `build-manifest.json`. |
| `plugin/skills/faff/prose-baseline.json` (new) | Exact sizes of the 41 covered files at build time. |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | One call into `prose-size.js` after the line-cap loop; prints its lines and sets `failed`. Small edit, stays JavaScript. |
| `bin/faff`, `regions.js`, `lint-cli-coverage.js` | Register `prose-size` (factory region, `REGION_SELFTEST_ARGV` null, test coverage `test/prose-size.test.mjs`). |
| `tsconfig.json`, `test/check-no-boundary-cast.test.mjs` | Add `prose-size.ts` to the include list and the pin list. |
| `.gitattributes` (new) | `plugin/skills/*/SKILL.md -text` and `plugin/skills/*/references/*.md -text`, so git never converts line endings in the covered set (§4.2). |
| `docs/reference/skill-authoring.md`, `docs/guide/cli.md` | §4.3. |

## 4. HOW

### 4.1 Procedure

```
validate-adapters (after the line-cap loop):
  required := (--skills-dir not given)
  path := <skillsDir>/faff/prose-baseline.json
  IF path absent: required ? FAIL missing : INFO skip; done
  baseline := readBaseline(path)          # FAIL on unreadable / non-JSON / bad value
  measured := { rel: statSync(p).size for p in coveredFiles(skillsDir) }
  { fails, ratchets } := compareProse(measured, baseline.files)
  print each fail (failed := true) and each ratchet

compareProse(measured, base):            # pure, no I/O
  for rel in sorted(keys(measured) ∪ keys(base)):
    rel ∉ base       -> fail unlisted
    rel ∉ measured   -> fail stale
    m > b            -> fail grew (+m-b)
    m < b            -> ratchet (-(b-m))

tally(repo, from, to, scope, groups):
  commits := git rev-list --first-parent --reverse from..to
  sizes(c) := git ls-tree -r -l c -- plugin/skills, filtered to scope
  prev := sizes(from); start := sum(prev)
  for c in commits: cur := sizes(c); delta per file; if non-zero, emit row; prev := cur
```

`git ls-tree -l` gives every blob's size in one call per commit, so the tally makes one git call per commit and reads no blob contents.

### 4.2 Decisions

- **Keep every line check; add bytes on top.** **Chosen:** the byte ratchet is added and no line check changes. A bytes-only gate would pass a hub-file edit that cuts bytes while adding lines (prose reflowed into bullets), which today's zero-headroom line ratchet fails. That would weaken a gate. The 600-line ceiling also stays as the readability rule the authoring standard states. The cost is that a hub-file edit bumps two numbers, as today it bumps one.
- **Cover every SKILL.md and every references/*.md.** **Chosen:** all 41 files, not only the hot three. The measured problem is total prose growing while individual baselines fall; a ratchet on three files lets growth move into references and other skills. For the 37 files that have only the 600-line ceiling today, bytes at zero headroom are strictly stricter.
- **Baseline as a data file, not a module constant.** **Chosen:** `prose-baseline.json` beside `legacy-js-modules.json`, with no per-entry comments. History lives in git and the tally, not in a growing comment like the one on `SKILL_LINE_BASELINE`. One entry per line with a blank line between entries, so two PRs that change neighbouring entries do not produce a git conflict (this session hit repeated conflicts on adjacent baseline values).
- **Absent baseline fails closed on the bundled tree only.** **Chosen:** with no `--skills-dir`, a missing baseline fails, so deleting the file cannot disable the gate in CI (`validate.yml` runs `faff validate-adapters` with no flags). With `--skills-dir`, an absent baseline skips with an INFO line, so the existing fixture-dir tests and an adopter's own skills dir keep working. A present but broken file fails in both cases.
- **The tally is computed, not written.** **Chosen:** `faff prose-size tally` derives the history from git on demand. This answers the ticket's "who writes the tally" question with nobody: a committed tally appended by CI needs push rights to `main`, one appended by `faff land` conflicts across parallel PRs, and both can drift from the real history. A computed tally cannot.
- **The baseline edit is the byte cost.** **Chosen:** no spec-contract change for a feature to name its byte cost. Growth already fails until the PR edits the file's baseline, so the cost is a reviewable number in every diff, and the tally reports it per ticket afterwards.
- **`--lower` never raises.** **Chosen:** the writer only locks reductions. Raising, adding a new file and removing a deleted one stay hand edits, so each is a visible line a reviewer sees.
- **Pin the covered set's bytes against checkout conversion.** **Chosen:** a new `.gitattributes` marks the covered set `-text`, so `core.autocrlf` on a contributor's machine or a later repo-wide eol rule cannot change the bytes a checkout materialises. Without it, an environmental conversion would fail all 41 files at once with growth no `--lower` can fix, and `git ls-tree` sizes (the tally) could diverge from on-disk sizes (the ratchet). An intentional line-ending edit still shows as growth or shrink.
- **Sequence after the two open prose PRs.** **Chosen:** FAFF-1442 is grafted after PR #1169 (FAFF-1436) and PR #1170 (FAFF-1444) merge, so its baseline is measured on a tree that already carries their `SKILL.md` edits and neither PR needs a baseline edit. If either is still open when the graft starts, the PR description names it and the one-line baseline update its rebase needs.
- **The real tree sits exactly at baseline.** **Chosen:** a test asserts every covered file's size equals its baseline entry on the committed tree, the same zero-headroom check FAFF-584 applies to the hub line baselines. So a shrink is locked in the same PR (one `--lower` call), and the advisory never accumulates headroom.

### 4.3 Docs

- `docs/reference/skill-authoring.md`: add a `prose bytes` row to the lint table (per-file bytes, zero-headroom ratchet over every `SKILL.md` and `references/*.md`, values only in `prose-baseline.json`), keep the `line cap` row, and extend the honest-limits paragraph: a raise is a hand edit, and `faff prose-size tally` shows every rise after the fact.
- `docs/guide/cli.md`: one row for `faff prose-size` (`baseline --lower`, `tally`) and the new `validate-adapters` byte lines.
- No `SKILL.md` text changes.

### 4.4 Edge cases

- **CRLF or BOM.** Bytes are counted raw. `.gitattributes` keeps checkouts from converting them, so only an intentional edit changes them, and it shows as growth or shrink (the agent reads those bytes).
- **A new skill in the same PR.** Its `SKILL.md` fails as unlisted until its entry is added by hand.
- **A skill deleted.** Its entry fails as stale until removed by hand.
- **A file under `references/` that is not `.md`.** Not covered.
- **Tally across a merge commit.** First-parent only, so each squash-merged PR is one row; a true merge commit counts as one row against its first parent.
- **Tally ref that is not an ancestor of `--to`.** `rev-list from..to` still works; the start is `from`'s snapshot. Not an error.
- **Parallel PRs after this lands.** Any PR that edits a covered file must update its entry: `--lower` for a shrink, a hand raise for growth. §4.2 sequences this ticket after #1169 and #1170 so neither is caught by it.

### 4.5 Tests (in `test/` only, `node --test`, no `--selftest`)

`test/prose-size.test.mjs`:
- `compareProse` unit cases: grew, shrank, equal, unlisted, stale, mixed; output sorted by path.
- `validate-adapters --skills-dir <fixture>` with a baseline: growth exits 1 naming file and `+<d>`; shrink exits 0 with the RATCHET line; unlisted and stale exit 1; malformed baseline exits 1; absent baseline prints INFO and exits 0.
- The missing-baseline FAIL on the default path: copy `plugin/skills/` to a temp dir, delete the copy's `faff/prose-baseline.json`, and run the copy's `faff/bin/faff validate-adapters --root <repo>` with **no** `--skills-dir`, so the script-relative default resolves to the copy. It exits 1 naming `prose-baseline.json` as missing. The same run with the file present but malformed also exits 1. The real file is never touched.
- `prose-size baseline --lower`: lowers a shrunk entry, leaves a grown one, reports both, output keeps the blank-line format.
- `tally` on a synthetic git repo built in a temp dir (three commits with known sizes and ticket subjects): rows, start, end, net, group and other sums, a file added and a file deleted.
- The real tree: every covered file equals its `prose-baseline.json` entry, and the entry set equals the covered set.
- A fixture `SKILL.md` of 601 lines with a matching byte baseline still fails `line cap`.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a skills dir D holding demo/SKILL.md and demo/references/notes.md, and D/faff/prose-baseline.json listing both at their exact sizes
When 10 bytes are appended to demo/SKILL.md and `faff validate-adapters --skills-dir D` runs
Then it exits 1
And its output names demo/SKILL.md, the baseline size and +10
```

```
Given the same skills dir D at its exact baseline
When 5 bytes are removed from demo/references/notes.md and `faff validate-adapters --skills-dir D` runs
Then it exits 0
And its output has a RATCHET line naming demo/references/notes.md and -5
```

```
Given the same skills dir D, whose baseline also lists gone/SKILL.md, which does not exist
When `faff validate-adapters --skills-dir D` runs
Then it exits 1
And its output names gone/SKILL.md as listed but missing
```

```
Given the skills dir D at its baseline
When demo/SKILL.md grows by 4 bytes, notes.md shrinks by 6 bytes, and `faff prose-size baseline --skills-dir D --lower --json` runs
Then it exits 0
And the notes.md entry drops by 6 and the demo/SKILL.md entry is unchanged
And the output reports demo/SKILL.md as grown and not raised
```

## 5. DESIGN DECISION RATIONALE

The ratchet exists to make prose growth a decision someone writes down rather than a drift nobody sees. Bytes are the honest unit because they track what the agent pays for. Keeping the line checks costs a second number on four files and buys a gate that is never weaker than today's. Computing the tally from git means the history is always exact and there is no file to conflict on or forget to update.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** `git ls-tree -r -l` reports blob sizes identical to the on-disk sizes of a checkout for the covered set. The new `.gitattributes` `-text` rule (§4.2) makes this hold on every checkout; the prep check reproduced both window totals in §1 from `ls-tree` sizes.

## 7. DONE

### From WHY
- [ ] `faff prose-size tally --from a30b6504^ --to 8e8765d4 --scope hot --group extractions=FAFF-1396,FAFF-1404,FAFF-1405,FAFF-1406,FAFF-1426,FAFF-1414` on this repo reports start 519,644, end 513,271, extractions net −23,289 and other +16,916; the PR description pastes its output.
- [ ] The same range with `--scope all` reports start 1,441,534 and end 1,442,705.

### From WHAT
- [ ] `faff validate-adapters` fails a covered file that grows past its baseline and names the file and the delta.
- [ ] `faff validate-adapters` with no `--skills-dir` fails when `prose-baseline.json` is missing or malformed.
- [ ] `.gitattributes` marks `plugin/skills/*/SKILL.md` and `plugin/skills/*/references/*.md` as `-text`, and `git check-attr text` reports `unset` for every covered file.
- [ ] `prose-baseline.json` lists exactly the covered set (41 files on the build's base) at their exact sizes, sorted, one entry per line with blank lines between.
- [ ] `faff prose-size baseline --lower` never raises, adds or removes an entry.

### From HOW
- [ ] Every existing line check is unchanged: `SKILL_LINE_CAP`, `SKILL_LINE_BASELINE` and `KERNEL_LINE_BASELINE` keep their values and enforcement, and the existing `test/validate-adapters.test.mjs` cases pass with no assertion weakened.
- [ ] `prose-size.ts` is TypeScript with its committed emit and `build-manifest.json`, is in the tsconfig include and the boundary-cast pin list, and `faff regions check` passes.
- [ ] `prose-size` is registered in the factory region with `REGION_SELFTEST_ARGV` null and a `TEST_FILE_COVERAGE` entry, and `lint-cli-coverage` passes.
- [ ] `docs/reference/skill-authoring.md` and `docs/guide/cli.md` are updated per §4.3.

### Tests
- [ ] The §4.5 cases exist in `test/prose-size.test.mjs` and pass under `node --test`; no `--selftest` case is added.
- [ ] The PR diff touches no `commissaire*` file.

**Integration smoke test:**
```
append one byte to plugin/skills/faff-jot/SKILL.md in a scratch copy of the skills dir
faff validate-adapters --skills-dir <copy>
EXPECT exit 1, "faff-jot/SKILL.md ... +1"
```

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. One new TypeScript module with two subcommands, one call site in `validate-adapters.js`, one data file, registration and two doc edits. About a day. The tally and the ratchet could ship separately, but the tally is what proves the ratchet's numbers, so they ship together.
- **Workstream fit?** No issues. It is the measurement half of the skills-to-code track, and FAFF-1428 (rule-inventory gate) is its sibling guardrail.
- **Deps surfaced?** Sequencing, not a blocker link: §4.2 grafts this after PRs #1169 (FAFF-1436) and #1170 (FAFF-1444) merge, since both edit `SKILL.md` files. Every later PR that edits a covered file updates `prose-baseline.json` in the same diff.
- **Risk profile?** Low. No novel integration; the risk is contributor friction on every prose edit, bounded by `baseline --lower` and the blank-line layout that avoids adjacent-entry conflicts.
