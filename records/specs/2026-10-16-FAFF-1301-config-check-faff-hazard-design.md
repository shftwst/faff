# Spec: `faff config check` warns on a directory-ignore of `.faff` (FAFF-1301)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1301.
> build-tier: complex

This is the build spec for FAFF-1301, a low-priority improvement to `faff config check`. Audience: the build agent implementing it, and the human reviewing the PR. It adds two read-only, advisory posture findings to an existing checker. No new command, no new config key, no new dependency.

## 1. WHY: problem and principles

**Load-bearing model: git cannot re-include anything under a directory whose own name is ignored.** A root `.gitignore` line that names the directory `.faff` (`.faff/`, or the slash-less `.faff`) makes git skip the entire subtree without descending into it. Every `!.faff/...` carve-out below that line is dead, and git never even reads a `.gitignore` placed inside `.faff/`. The FAFF-568 line `.faff/*` exists precisely to avoid this: it ignores the direct children, so git still descends and the carve-outs work.

**Problem statement.** `.faff/` needs exactly one ignore posture: its contents ignored, its committed parts carved out. Two opposite faults break it and nothing in the system reports either. Over-ignoring (a directory-ignore of `.faff`) silently fails to commit the parts of `.faff/` that faff expects to be committed. Under-ignoring (no `.faff` ignore rule reachable from a fresh clone) silently offers every run artifact for commit. This change makes `faff config check` report both and name the fix for each.

**This is the only detection of the over-ignore fault.** Verified on 2026-10-15 in a throwaway repo: with a root `.gitignore` of `.faff/` and a `.faff/.gitignore` containing `/*`, `!/.gitignore`, `!/anchors/`, `!/templates/`, `git check-ignore -v` attributed all of `.faff/.gitignore`, `.faff/anchors/run1/a.json` and `.faff/templates/adr.md` to `.gitignore:1:.faff/`. Changing the single root line to `.faff/*` cleared all three. Nothing else in faff looks at this, and `git status` shows an absence, not a warning.

**Downstream, governance-check fails open on the artifacts this fault deletes.** `.github/workflows/governance.yml:48` sets `on-missing: pass`, which that file's own header names as the deliberate footprint-discriminating posture, with the gap "closed only by flipping to `on-missing: fail`". The action's `anchor-missing-for-run-dir` step warns loudly under `pass` and fails the check only under `fail` (`.github/actions/governance-check/action.yml:254-266`). So a PR whose chain anchors were silently swallowed by a root `.gitignore` line passes governance-check today. That is what makes an advisory `config check` finding the whole guard rather than a nicety: there is no second line of defence to fall back on.

### Design principles

**Read-only and advisory.** `faff config check` never writes to the operator's files. ADR-0067 records that its findings are advisory everywhere in faff (warn, never block), and a consuming repo's own CI may choose to gate on them. These findings diagnose; both fixes stay operator actions.

**The append-only writer cannot fix the over-ignore, and that is deliberate.** `gitignore-ensure.js:13-48` documents the append-only stance: a line-drop "could sweep a private value into a commit". The same comment already promises this finding ("see `faff config check`'s posture finding") for exactly the `.faff/` case. This ticket discharges a promise the codebase has been carrying.

**One home for the spelling list.** The `.faff/*`-not-`.faff/` policy lives in `gitignore-ensure.js`. The hazardous spellings are the inverse of that policy, so they live there too, beside the pattern constants, not in `config.js`.

**Ask git, do not re-derive git.** Where a question has a `git check-ignore` answer, the check asks git through the existing `probes` rather than modelling ignore precedence itself. That is what keeps the under-ignore finding silent on a correct `--local` install without the check knowing anything about `.git/info/exclude`.

**Never break the existing pure-core call sites.** `computeConfigCheck` is driven in-memory by `configCheckSelftest` with hand-built `probes` object literals. Every new input must be additive in a way that leaves each existing call site working verbatim, and no new code path may reach into `probes` before a precondition that every existing case fails.

### Reference context

| File and symbol | Line | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/config.js`, `computeConfigCheck` | 2518 | Pure core of `config check`. Both findings are emitted here. |
| `plugin/skills/faff/bin/lib/config.js`, `cmdConfigCheck` | 2604 | Does all the I/O and builds `probes`. Reads the new filesystem facts here. |
| `plugin/skills/faff/bin/lib/config.js`, `MIGRATION_STEPS` | 2479 | Precedent for a multi-line remedy embedded in a finding message. |
| `plugin/skills/faff/bin/lib/config.js`, exit rule | 2601 | `exit: findings.length ? 1 : 0`, regardless of severity. |
| `plugin/skills/faff/bin/lib/config.js`, `gitIsIgnored`, `gitIsTracked` | 2469, 2474 | The probe implementations. Both take a repo-relative path of any depth and shell to `git check-ignore -q` / `git ls-files --error-unmatch`. |
| `plugin/skills/faff/bin/lib/config.js`, `configCheckSelftest` | 2727 | In-memory driver for the pure core; home for the new finding-wiring cases. |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js`, `FAFF_GITIGNORE_PATTERNS` | 50 | Ships `.faff/*` and `!.faff/anchors/`; the policy the hazard breaks. |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js`, `FAFF_GITIGNORE_PATTERNS_LOCAL` | 66 | The `--local` set, which ignores `.faff/` wholesale **by design**, into `.git/info/exclude`. |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js`, `stripTrailingSlash`, `gitignoreHasPattern` | 93, 97 | The existing normaliser and its blank/comment skip rules. Both already exported (line 293). |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js`, `gitignoreEnsureSelftest` | 126 | Home for the pure predicate fixture table. Wired into `faff regions selftest` (`regions.js:533`). |
| `test/config-two-file.test.mjs`, `gitDir` helper, `config check` block | 43, 193 onward | Real-CLI tests; `gitDir` already takes a `gitignore` argument. Home for the real-git oracle. |
| `plugin/skills/faff-onboard/SKILL.md` | 145 | First of two `gitignore-ensure` call sites, both first-run only. |
| `plugin/skills/faff/SKILL.md` | 70 | The other: the first-run decline path. Both gated on `faff config path` returning exit 3. |

**Scope statement.** A localised addition to the existing `config check` posture linter, plus two small pure helpers in `gitignore-ensure.js`.

**Sequencing: this ships independently, before or after FAFF-1299.** The over-ignore hazard already costs a repo its committed anchors today, with no dependency on `.faff/.gitignore` existing. Confirmed: `.faff/.gitignore` does not exist in this repo as of `4839e550`. The under-ignore finding is specified to stay silent both before and after FAFF-1299 lands, so there is no blocker edge in either direction. Do not wait for FAFF-1299.

## 2. OUT OF SCOPE

- **Writing or rewriting any `.gitignore`.** Why excluded: `config check` is read-only, and `gitignore-ensure` is append-only by deliberate design (`gitignore-ensure.js:13-48`) because a line-drop could sweep a private value into a commit. Extension point: a future `faff config fix` writer command, the same extension point FAFF-794's spec named.
- **Making `faff gitignore-ensure` self-healing, or re-running it on later commands.** Why excluded: the under-ignore finding exists precisely because the ensurer is first-run only, and widening its call sites is a behaviour change to the onboarding path with its own blast radius. Extension point: the two call sites named in the reference table, or a new always-on hook; either is its own ticket.
- **Keeping a root `.faff/*` backstop once FAFF-1299 lands.** Why excluded: product decision of 2026-10-15. A backstop reintroduces exactly the root-`.gitignore` coupling FAFF-1299 removes, and the chosen remedy for the gap it would have covered is the under-ignore finding specified here. Extension point: none wanted.
- **Scanning `.git/info/exclude` for hazard spellings.** Why excluded: `gitignore-ensure --local` (FAFF-1062) writes `.faff/` there on purpose, and `FAFF_GITIGNORE_PATTERNS_LOCAL` at `gitignore-ensure.js:66` drops the anchors carve-out because a personal, never-committed exclude file has no committed subtree to protect. Warning about it would fire on faff's own correct output. Extension point: none wanted. If a future `--local` set ever gains a carve-out, the hazard check would move with it. Note this exclusion is about *scanning its text*: the under-ignore finding does consult that file's effect, through `git check-ignore`, which is what keeps it silent on a `--local` install.
- **Scanning nested `.gitignore` files for hazard spellings.** Why excluded: faff's `.faff` directory exists only at the repo root, so a nested `.gitignore` cannot create the over-ignore hazard. The one exception, `.faff/.gitignore`, is FAFF-1299's artifact; this spec checks its presence and tracked-ness, never its contents. Extension point: FAFF-1299's writer.
- **Scanning the user's global `core.excludesFile`.** Why excluded: it is a per-user file outside the repo, and the remedy would not be a repo edit. Its *effect* is nonetheless visible to the under-ignore finding through `git check-ignore`, which is correct: a global rule that ignores `.faff` really does protect this checkout. Extension point: none.
- **Validating the contents of `.faff/.gitignore`.** Why excluded: whether its carve-out lines are right is FAFF-1299's writer's responsibility and FAFF-1300 / FAFF-1302's content. This check asks only whether run state ends up ignored, which `git check-ignore` answers without parsing the file. Extension point: FAFF-1299.
- **FAFF-1299's `.faff/.gitignore` writer, and the FAFF-1300 / FAFF-1302 moves.** Why excluded: separate tickets with separate specs. Both messages here name the committed parts of `.faff/` and the remedy command generically, so neither needs an edit when those land. Extension point: FAFF-1299 adds `.faff/.gitignore` to `gitignoreEnsure`; FAFF-1300 and FAFF-1302 add carve-out lines to it.
- **A stricter `error` severity or a blocking mode.** Why excluded: the ticket specifies advisory, matching every other `config check` finding. Extension point: a consuming repo's own CI may gate on `faff config check`'s exit code; faff itself never does.
- **Flipping governance-check to `on-missing: fail`.** Why excluded: that posture is a deliberate, separately-owned decision recorded in `.github/workflows/governance.yml`'s own header. This spec cites it as the reason an advisory finding carries the whole weight; it does not change it. Extension point: the `on-missing` input at `.github/actions/governance-check/action.yml`.

## 3. WHAT: vocabulary, types, and the predicates

### Vocabulary

| Term | Definition |
|---|---|
| directory-ignore | A `.gitignore` line that ignores the `.faff` directory itself (`.faff/`, `.faff`) or everything beneath it recursively (`.faff/**` and its equivalents), rather than only its direct children (`.faff/*`). Every directory-ignore blocks at least one committed part of `.faff/`. |
| carve-out | A `!`-prefixed re-inclusion line, such as `!.faff/anchors/`, that a directory-ignore renders dead. |
| hazard line | A root `.gitignore` line the over-ignore finding reports: a non-comment, non-negated directory-ignore of `.faff`. |
| over-ignore | Finding 1's fault: a hazard line is present, so committed parts of `.faff/` are silently skipped. |
| under-ignore | Finding 2's fault: no `.faff` ignore rule protects run state, either here and now or in a fresh clone. |
| run state | The never-committed contents of `.faff/`, canonically `.faff/runs/`. Distinct from the committed parts (`.faff/anchors/`, and later `.faff/templates/` and `.faff/.gitignore`). |

### The new inputs to the pure core

```
RECORD ConfigCheckInput:                    # computeConfigCheck's existing options object
  basePath, baseDoc, overlayPath, overlayDoc,
  legacyBase, legacyOverlay, baseParseError,
  probes                                    # UNCHANGED: { inRepo, isIgnored(rel), isTracked(rel) }

  rootGitignore: String | Null              # NEW: raw text of <root>/.gitignore
                                            # Null (or an absent key, which destructures
                                            # to undefined) => finding 1 is a no-op
  faffDirPresent: Bool                      # NEW: <root>/.faff exists and is a directory
                                            # falsy (incl. an absent key) => finding 2
                                            # is a no-op BEFORE any probe is called
  faffDirGitignorePresent: Bool             # NEW: <root>/.faff/.gitignore exists as a file
```

All three new members sit on the options object, not inside `probes`. Every existing `configCheckSelftest` case builds `probes` as an object literal with `isIgnored: (n) => …` lambdas keyed on basenames; a new `probes` member would mean editing all of them, and a call site that forgot it would produce a crash rather than a skip. An absent top-level key destructures to `undefined`, which both checks treat as "nothing to look at", so every existing case keeps passing verbatim. See the Design Decision Rationale for the marker.

**`faffDirPresent` is load-bearing for that guarantee, not decoration.** Finding 2 calls `probes.isIgnored` and `probes.isTracked` with paths no existing selftest lambda anticipates. Testing `faffDirPresent` first means every existing case short-circuits before any probe call, so none of their lambdas ever sees an unexpected argument. Order the implementation accordingly.

### The hazard spelling list

A new exported constant beside the existing pattern constants in `gitignore-ensure.js`. Four prefix forms crossed with four directory-scope suffix shapes:

```
FAFF_GITIGNORE_DIR_HAZARD_PATTERNS = [
  # the directory itself
  ".faff/",        "/.faff/",        "**/.faff/",        "/**/.faff/",
  # everything beneath it, recursively
  ".faff/**",      "/.faff/**",      "**/.faff/**",      "/**/.faff/**",
  # the two other recursive-descent spellings with the same consequence
  ".faff/*/**",    "/.faff/*/**",    "**/.faff/*/**",    "/**/.faff/*/**",
  ".faff/**/*",    "/.faff/**/*",    "**/.faff/**/*",    "/**/.faff/**/*",
]
```

The `**/`-prefixed forms are idiomatic and GitHub's own `.gitignore` templates use them, so they are not exotic. All sixteen were verified against real git on 2026-10-15; the predicate table below records each shape's effect.

Two properties of the normalisation inside `gitignoreHasPattern` matter here, and the new helper reuses it unchanged:

- `stripTrailingSlash` on both sides makes `.faff/` and `.faff` compare equal, which is correct: both are directory-name ignores with identical consequences. The same holds for each prefixed pair, so the four trailing-slash spellings in the first row cover eight written forms between them.
- The same stripping catches `.faff/**/` for free, because it normalises onto the listed `.faff/**`. Verified: `.faff/**/` ignores `.faff/anchors/run1/a.json` and the predicate flags it with no dedicated entry.

`.faff/*` normalises to `.faff/*` (the trailing character is `*`, not a slash), so it never matches a hazard spelling. The list is therefore an exact-spelling allowlist of faults, not a glob evaluator.

### The clean spelling list

Finding 2 needs to know whether the root `.gitignore` says anything about `.faff` at all, so the correct spellings are enumerated too:

```
FAFF_GITIGNORE_DIR_CLEAN_PATTERNS = [
  ".faff/*",  "/.faff/*",  "**/.faff/*",  "/**/.faff/*",
]
```

Verified: all four ignore `.faff/runs/x.md` while leaving `.faff/.gitignore`, the anchor and the template committable.

### The predicate, case by case

Every row below was verified empirically on 2026-10-15 against a real repo containing `.faff/.gitignore` (`/*`, `!/.gitignore`, `!/anchors/`, `!/templates/`), a committed anchor file, a template file and a run-state file, by writing the line as the sole content of the root `.gitignore` and running `git check-ignore -q` on each path. Columns: whether each path is ignored. `.faff/runs/x.md` **should** be ignored in every row; it is the control.

| Root `.gitignore` line | Hazard? | `.faff/.gitignore` | anchor | template | run state |
|---|---|---|---|---|---|
| `.faff/`, `.faff`, `/.faff/`, `/.faff` | yes | ignored | ignored | ignored | ignored |
| `**/.faff/`, `**/.faff`, `/**/.faff/`, `/**/.faff` | yes | ignored | ignored | ignored | ignored |
| `.faff/**` and its three prefixed forms | yes | survives | ignored | ignored | ignored |
| `.faff/*/**` and its three prefixed forms | yes | survives | ignored | ignored | ignored |
| `.faff/**/*` and its three prefixed forms | yes | survives | ignored | ignored | ignored |
| `.faff/**/` | yes (via normalisation) | survives | ignored | **survives** | ignored |
| `.faff/*` and its three prefixed forms | no | survives | survives | survives | ignored |
| no `.faff` line at all | no | survives | survives | survives | by the inner file |
| `# .faff/` | no | survives | survives | survives | by the inner file |
| `!.faff/` | no | survives | survives | survives | by the inner file |
| `.faff/   ` (trailing spaces) | yes | ignored | ignored | ignored | ignored |
| a hazard line inside an unrelated section | yes | as its spelling's row | | | |
| both `.faff/*` **and** `.faff/`, in either order | yes | ignored | ignored | ignored | ignored |

Reading the table: every `yes` row loses at least one committed part of `.faff/`, which is the fault the finding names. The `.faff/**` family descends far enough to leave `.faff/.gitignore` readable, so a root `!.faff/anchors/` looks like it should recover the anchor; it does not, because the negation matches the directory while the `**` keeps matching each file beneath it. The ordering row is why "a hazard line is present" is the right predicate rather than "last match wins": verified in both orders, the directory-ignore wins.

**Known gap, accepted and pinned: the equivalent-glob family is unbounded.** Verified spellings that cause the same loss and are **not** on the list: `.faff/*/*/**` (ignores the anchor), `.faff/**/**` (ignores the anchor and the template), `.faff/*/*` (likewise). An operator could keep generating these indefinitely (`.faff/*/*/*/**`, and so on), so enumerating two or three more would buy partial coverage while implying completeness. **Chosen:** enumerate the sixteen spellings above, which cover every form this repo, `gitignore-ensure`, or GitHub's templates produce, and pin the gap with explicit oracle rows (section 5) that assert git blocks the anchor while the predicate stays silent. A spelling found in the wild later is a one-line addition plus two fixture rows, and the pinned oracle rows are what make such an addition a visible, reviewed change rather than a silent widening. The alternative, a general gitignore-semantics evaluator, is rejected in the Design Decision Rationale.

**Known imprecision, accepted.** `gitignoreHasPattern`'s `trim()` also strips *leading* whitespace, which git does not: in git, `  .faff/` means a path beginning with spaces. faff would warn where git would not. That line is pathological, the check is advisory, and naming the imprecision beats adding a special case. Escaped spellings (`\.faff/`, `.faff\/`) are likewise not recognised; they are not forms any tool or document in this repo produces.

### Finding 1: the over-ignore

```
RECORD Finding:                             # existing shape, unchanged
  severity: "warn"
  surface:  ".gitignore"
  message:  String                          # multi-line, echoes the offending line(s) verbatim
```

One finding per repo, naming every hazard line found, rather than one finding per line. A repo with two hazard spellings has one fault with one fix.

**Plural rendering, pinned.** The message's line slot is built from the full list, in file order, with exact duplicates collapsed:

```
PROCEDURE dir_hazard_slot(hazard_lines):           # hazard_lines is never empty here
  1. uniq = hazard_lines with exact duplicates removed, first-occurrence order preserved
  2. quoted = each element wrapped in backticks
  3. IF length(uniq) == 1: RETURN "line: " + quoted[0]
  4. RETURN "lines: " + join(quoted, ", ")
```

So a single `.faff/` renders ``(line: `.faff/`)`` and a file carrying `.faff/` then `.faff/**` renders ``(lines: `.faff/`, `.faff/**`)``. Singular and plural differ only in the word and the join; there is no second template.

Message shape, following the `MIGRATION_STEPS` precedent of indented numbered steps embedded in the message:

```
`.gitignore` ignores the `.faff` DIRECTORY (line: `.faff/`). Git never descends
into it, so every committed part of `.faff/` is silently skipped: the per-PR chain
anchors today, and the templates and config later. Any `!.faff/...` carve-out below
this line is dead, and a `.gitignore` inside `.faff/` is never even read.
`faff gitignore-ensure` is append-only and cannot fix this. Hand-edit:
     1. Change the `.faff/` line to `.faff/*` in .gitignore
     2. Keep any `!.faff/...` carve-out lines AFTER it (git honours a negation only after the matching ignore)
     3. Run `git status`; the committed parts of .faff/ should now appear
     4. Run `faff config check` to confirm the finding is gone
```

The parenthesised slot echoes the trimmed offending line(s) as found, so an operator with several `.faff`-ish lines knows which to edit. Step 1 names the first hazard line when there are several; the operator reads the rest from the slot.

### Finding 2: the under-ignore

```
RECORD Finding:
  severity: "warn"
  surface:  ".faff/.gitignore"
  message:  String                          # one of two variants, see below
```

The fault this catches: **`faff gitignore-ensure` is not self-healing.** It runs at exactly two call sites, both first-run only (`plugin/skills/faff-onboard/SKILL.md:145` and the first-run decline path at `plugin/skills/faff/SKILL.md:70`), each gated on `faff config path` returning exit 3. A fresh clone that already carries a committed `.faffrc.yaml` never re-runs the ensure. Once FAFF-1299 drops the two `.faff` lines from the root `.gitignore`, `.faff/.gitignore` is the only thing ignoring run state, and if the operator never committed it, that clone has no `.faff` ignore rule at all.

**The predicate asks git, not the file.** Rather than modelling which ignore source wins, the check asks `git check-ignore` whether run state is ignored, using the never-committed canonical run directory as the probe path.

```
CONSTANT FAFF_RUN_STATE_PROBE_PATH = ".faff/runs"

PROCEDURE check_faff_dir_underignore(input, probes, findings):
  1. IF NOT input.faffDirPresent: RETURN              # before any probe call
  2. IF NOT probes.inRepo: RETURN                     # untracked is meaningless outside a repo
  3. IF NOT probes.isIgnored(FAFF_RUN_STATE_PROBE_PATH):
     a. msg = input.faffDirGitignorePresent ? UNDERIGNORE_INEFFECTIVE_MESSAGE
                                            : UNDERIGNORE_NONE_MESSAGE
     b. findings.append(Finding{ "warn", ".faff/.gitignore", msg })
     c. RETURN
  4. # Run state IS ignored here and now. Is that reproducible on a fresh clone?
     IF NOT input.faffDirGitignorePresent: RETURN
  5. IF gitignore_mentions_faff_dir(input.rootGitignore)
       AND probes.isTracked(".gitignore"): RETURN   # a COMMITTED root rule covers a clone
  6. IF probes.isTracked(".faff/.gitignore"): RETURN               # the inner file travels
  7. findings.append(Finding{ "warn", ".faff/.gitignore", UNDERIGNORE_UNTRACKED_MESSAGE })
```

The branches are mutually exclusive by construction: step 3 fires only when nothing ignores run state, step 7 only when something does and that something is an uncommitted file. At most one finding 2 per repo.

**Step 3 has two message variants, because presence and effect can diverge.** The spec deliberately does not validate `.faff/.gitignore`'s contents (OUT OF SCOPE), so an inner file can be present and still not cover `.faff/runs`: empty, truncated, or carrying a botched FAFF-1300 or FAFF-1302 carve-out. In that regime run state is unignored while the file sits on disk, so a message asserting the file is absent would state a falsehood. `UNDERIGNORE_NONE_MESSAGE` is used when `faffDirGitignorePresent` is false and `UNDERIGNORE_INEFFECTIVE_MESSAGE` when it is true; the core already carries the flag, so this costs a ternary and a second string.

**Step 5 asks whether the root rule is committed, not merely present.** `faff gitignore-ensure` writes the root `.gitignore` and never commits it (`faff-onboard/SKILL.md:145`), so a root `.faff/*` line can exist uncommitted. Testing only the text would return silent on a repo whose fresh clone inherits no rule at all, which is a false negative on finding 2's own question. Adding `probes.isTracked(".gitignore")` to the same guard closes it, and costs one probe call on a path that is already probe-driven. The symmetry is the point: step 5 and step 6 now ask the same committed-ness question of the two files that could carry the rule.

**Telling absent from present-but-untracked.** Presence is a filesystem fact, read in `cmdConfigCheck` into `faffDirGitignorePresent`. Tracked-ness is a git fact, read through the existing `probes.isTracked`, which shells to `git ls-files --error-unmatch` and accepts a nested path. The two are independent because git honours a `.gitignore` whether or not it is tracked, so the untracked case is invisible to `isIgnored` and needs its own question. Step 5's guard is what stops the untracked branch firing on a repo whose root `.gitignore` already covers a clone.

**`.faff/` existing is a precondition.** Before `.faff/` exists there is no run state to leak, and a repo that has never run faff should not be nagged about ignoring a directory it does not have. `.faff/` appears the moment faff writes anything, which is the moment the rule starts mattering. Accepted consequence: on a genuinely fresh clone the gateway's entry `config check` runs before `.faff/` exists and stays silent; the finding appears on the next `config check` after the first command that writes run state. One run of lag on an advisory finding is the right trade against nagging every repo that has merely cloned faff.

**Verified behaviour across all five regimes** (2026-10-15, real repos, `git check-ignore -q .faff/runs`):

| Repo state | run state ignored? | Finding 2 |
|---|---|---|
| Root `.gitignore` has `.faff/*` (this repo today, pre-FAFF-1299) | yes | silent, no inner file present |
| Inner `.faff/.gitignore` only, committed (post-FAFF-1299, correct) | yes | silent, inner file tracked |
| No `.faff` rule anywhere (post-FAFF-1299, never committed) | **no** | fires, "none" variant |
| `.git/info/exclude` has `.faff/` (a correct `--local` install) | yes | silent, inner file deliberately absent |
| Root `.gitignore` has the hazard `.faff/` | yes | silent; finding 1 fires instead |

The third row is the fault. The first and fourth are the two spurious-fire risks the product owner named, and both come out silent: pre-FAFF-1299 because the root line still ignores run state, and `--local` because `git check-ignore` consults `.git/info/exclude` and because `--local` mode deliberately writes no inner file. The fifth row shows the two findings never double-report the same repo: a hazard line still ignores run state, so finding 2 stays quiet while finding 1 names the real fault.

Message variant for step 3, nothing ignores run state:

```
nothing ignores faff's run state. `.faff/` exists but no ignore rule covers
`.faff/runs`, so git is offering every run artifact, log and scratch file for
commit. `.faff/.gitignore` is absent. Fix:
     1. Run `faff gitignore-ensure`
     2. Commit the file (or the .gitignore line) it writes, so a fresh clone inherits the rule
     3. Run `faff config check` to confirm the finding is gone
```

Message variant for step 7, the rule does not survive a clone:

```
`.faff/.gitignore` is the only thing ignoring faff's run state and it is NOT
committed. This checkout is fine; a fresh clone gets no `.faff` ignore rule at all,
and `faff gitignore-ensure` is first-run only so nothing re-adds it. Fix:
     1. git add .faff/.gitignore
     2. Commit it alongside .faffrc.yaml
```

Message variant for step 3 when the inner file is present but does not cover run state:

```
`.faff/.gitignore` exists but does not ignore faff's run state. `.faff/runs` is
not ignored by any rule, so git is offering every run artifact, log and scratch
file for commit. The file may be empty, truncated, or missing the rule. Fix:
     1. Run `faff gitignore-ensure` to restore the rules it owns
     2. Commit the result
     3. Run `faff config check` to confirm the finding is gone
```

None of the three messages names which file `gitignore-ensure` writes, so none needs an edit when FAFF-1299 changes that.

## 4. HOW: behaviour

### Architecture

Four small pieces, no new module.

```
cmdConfigCheck (config.js:2604)          reads <root>/.gitignore text,
        |                                 stats .faff/ and .faff/.gitignore
        v
computeConfigCheck (config.js:2518)      calls the predicates, pushes at most
        |                                 one finding each
        +---> gitignoreDirHazardLines      new pure helper in gitignore-ensure.js
        |       (finding 1)                returns the offending trimmed lines
        |
        +---> gitignoreMentionsFaffDir     new pure helper in gitignore-ensure.js
                (finding 2, step 5)        hazard OR clean spelling present?
```

### Reading the filesystem

In `cmdConfigCheck`, beside where `probes` is built:

```
PROCEDURE read_gitignore_facts(root):
  1. TRY: rootGitignore = read_text(join(root, ".gitignore"))
     CATCH any error: rootGitignore = Null
  2. TRY: faffDirPresent = is_directory(join(root, ".faff"))
     CATCH any error: faffDirPresent = false
  3. TRY: faffDirGitignorePresent = is_file(join(root, ".faff", ".gitignore"))
     CATCH any error: faffDirGitignorePresent = false
  4. RETURN { rootGitignore, faffDirPresent, faffDirGitignorePresent }
```

Any failure, including a missing path, yields the no-op value. `config check` must never abort on this: it is the one command whose job is to describe faults, and an unreadable root `.gitignore` is a larger problem than the finding it would have produced. No `skipped` line is emitted. Today's `config check` is already silent about a missing `.gitignore`, and distinguishing absent from unreadable would mean widening the pure core's signature for a case nobody hits.

### The predicate helpers

Two new pure, exported functions in `gitignore-ensure.js`, sitting beside `gitignoreHasPattern` rather than replacing or extending it:

```
PROCEDURE gitignore_dir_hazard_lines(text):
  1. IF text is Null or not a String: RETURN []
  2. hazards = { strip_trailing_slash(p) FOR p IN FAFF_GITIGNORE_DIR_HAZARD_PATTERNS }
  3. out = []
  4. FOR each line IN split(text, "\n"):
     a. t = trim(line)
     b. IF t == "" OR t starts with "#": CONTINUE
     c. IF strip_trailing_slash(t) IS IN hazards: append t to out
  5. RETURN out

PROCEDURE gitignore_mentions_faff_dir(text):
  1. IF gitignore_dir_hazard_lines(text) is non-empty: RETURN true
  2. IF text is Null or not a String: RETURN false
  3. clean = { strip_trailing_slash(p) FOR p IN FAFF_GITIGNORE_DIR_CLEAN_PATTERNS }
  4. FOR each line IN split(text, "\n"):
     a. t = trim(line)
     b. IF t == "" OR t starts with "#": CONTINUE
     c. IF strip_trailing_slash(t) IS IN clean: RETURN true
  5. RETURN false
```

Both reuse `stripTrailingSlash` and mirror `gitignoreHasPattern`'s blank-and-comment skip rules exactly, so none of the three ever disagree about what counts as a line. Neither calls `gitignoreHasPattern` itself: that function returns a boolean and finding 1 needs the offending text, and widening its return type would change a function the append-only writer depends on, for no gain here.

`gitignoreDirHazardLines` keeps the signature `(text) -> [String]` exactly. FAFF-1299 defines the same function and the same `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` constant in this same file for its own write-time warning, so the signature is a coordination surface and must not be refactored into a classifier. `gitignoreMentionsFaffDir` and `FAFF_GITIGNORE_DIR_CLEAN_PATTERNS` are FAFF-1301-only.

**Anti-pattern:** writing a general gitignore-semantics evaluator (globs, anchoring, negation precedence) to answer finding 1's question. Why: `gitignore-ensure.js:95-96` already records the house position that over-matching risks breaking the writer, and an exact-spelling fault list is both verifiable against a real-git oracle and honest about what it does not cover. The empirical table in section 3, with the oracle that enforces it, is the specification; a general evaluator would be a second, untested model of git. Note that finding 2 does not need one either, for the opposite reason: it delegates the whole precedence question to `git check-ignore`.

### Emitting the findings

In `computeConfigCheck`, after the existing git-probe posture block and before the secret scan, so the output order reads config-identity faults, then posture, then content. Finding 1 first, then finding 2:

```
PROCEDURE check_faff_dir_ignore(rootGitignore, findings):
  1. hazard_lines = gitignore_dir_hazard_lines(rootGitignore)
  2. IF hazard_lines is empty: RETURN
  3. findings.append(Finding{
       severity: "warn",
       surface:  ".gitignore",
       message:  dir_hazard_message(dir_hazard_slot(hazard_lines))   # see section 3
     })
```

Finding 1 runs **outside** the `if (probes.inRepo)` block; finding 2 runs inside it (step 2 of its own pseudocode). The asymmetry is deliberate and follows from what each needs. The existing skip exists because the three probes are git subprocesses that cannot answer outside a repo. Finding 1 has no such dependency: the fault is a property of the file's text, not of git state. Finding 2 is entirely probe-driven, and "untracked" and "a fresh clone of this repo" have no meaning outside a repo. The existing `skipped.push("posture checks skipped (not a git repo)")` wording stays exactly as it is, since it names the probe-backed checks, which now include finding 2, and `test/config-two-file.test.mjs:275` asserts that case.

### Exit code

Unchanged: `exit: findings.length ? 1 : 0` (`config.js:2601`). A `warn` finding therefore makes `config check` exit 1, which is the existing behaviour for every warn-severity finding including the two pre-existing posture warns. Both new findings inherit it. This is acceptable and changes no caller's behaviour:

- The gateway entry preamble (`plugin/skills/faff/references/kernel.md:29`) runs `faff config check` and treats its findings as advisory, explicitly "never a block/gate/prompt": interactive surfaces one line, autonomous logs for `/faff-wtf` and continues. This is also the surface the product owner chose for finding 2: the preamble already runs the command on entry, so the finding needs no new call site.
- No GitHub workflow, action or script in this repo runs `faff config check`. Verified by grep over `.github/` and `scripts/`.
- The local gate ladder in `.faffrc.yaml` does not include it.
- `ADR-0067` records the intent directly: findings are advisory everywhere in faff, and a consuming repo's own CI may choose to gate on them. A repo that has opted into gating is opting into exactly this signal.

This repo's own root `.gitignore` carries `.faff/*` with carve-outs, not `.faff/`, and that line also keeps run state ignored, so faff's own `config check` stays exit 0 after this change on both findings. Verified.

### Edge cases

| Input | Behaviour |
|---|---|
| No root `.gitignore`, no `.faff/` | Neither finding. Same as today's silence about a missing file. |
| No root `.gitignore`, `.faff/` present, nothing ignores run state | Finding 2, "none" variant. This is the post-FAFF-1299 fault. |
| Root `.gitignore` unreadable (permissions, a directory at that path) | Finding 1 silent, no skip line, no exit 2. Finding 2 unaffected: it reads the text only at step 5, where `Null` means "root says nothing", which is the correct reading of an unreadable root file for a clone's purposes. |
| Empty or comment-only root `.gitignore` | Finding 1 silent. Finding 2 per the probe. |
| `.gitignore` with CRLF line endings | `trim()` strips the `\r`, so a `.faff/\r\n` line is still caught. |
| Not a git repo | Finding 1 still runs. Finding 2 is skipped under the existing `"posture checks skipped (not a git repo)"` line. |
| `.git/info/exclude` carries `.faff/` (a `--local` repo), inner file absent | Neither finding. Finding 1 never reads that file; finding 2 sees run state ignored and no inner file. Verified. |
| `.faff/` exists but is a file, not a directory | `faffDirPresent` is false, finding 2 is a no-op. Pathological; no special case. |
| `.faff/.gitignore` present and tracked, root silent | Finding 2 silent. The correct post-FAFF-1299 state. |
| `.faff/.gitignore` present and untracked, root carries `.faff/*` | Finding 2 silent. A clone is covered by the root line. |
| `.faff/.gitignore` present and untracked, root silent | Finding 2, "untracked" variant. |
| Several hazard lines | One finding 1, naming all of them in file order. |
| The same hazard line twice | One finding 1 naming it once; exact duplicates are collapsed. |
| `.faff/*` present alongside a hazard line | Finding 1 fires. Verified: the directory-ignore wins in either order. |
| A hazard line present and `.faff/` on disk | Finding 1 only. Run state is still ignored, so finding 2 stays silent. Verified. |

### Failure modes

**The hazard spelling list is known to be incomplete.** Section 3 names three verified spellings it does not cover and explains why enumeration cannot close the family. How you would know: an operator reports missing anchors while `faff config check` is clean, and `git check-ignore -v .faff/anchors/` names a root `.gitignore` line the check did not flag. What it means: add the spelling to `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` and give it a row in both fixture tables. The design keeps that a one-line change on purpose. It does not mean replacing the list with a glob evaluator.

**Finding 1 could warn where git does not.** The accepted leading-whitespace imprecision is the known instance. How you would know: a clean repo's `config check` reports the finding while `git check-ignore -v` on an anchor path reports not-ignored. What it means: tighten the trim to trailing-only in the new helpers (not in `gitignoreHasPattern`, which the writer depends on). A false positive on an advisory read-only finding is a nuisance, not a defect worth pre-emptive code.

**Finding 2's probe path could stop being representative.** `.faff/runs` is the canonical run-state directory and is ignored by every correct regime, but if a future layout moved run state elsewhere, and the new location were ignored while `.faff/runs` were not, the finding would fire on a correct repo. How you would know: the finding fires on a repo where `git status` shows no untracked `.faff/` content. What it means: update `FAFF_RUN_STATE_PROBE_PATH`, which is why it is a named constant rather than an inline string.

**Finding 2 could be the wrong remedy for the real problem.** The product owner rejected a root `.faff/*` backstop because it reintroduces what FAFF-1299 removes, so this advisory finding is what stands between a fresh clone and committed run state. If operators routinely ignore it, the gap stays open and the right answer is to make `gitignore-ensure` self-healing rather than to make the finding louder. How you would know: repos in the wild with committed `.faff/runs/` content. What it means: reopen the self-healing option, listed under OUT OF SCOPE with its two call sites named.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a git repo whose root .gitignore contains the single line `.faff/`
When `faff config check` runs
Then it emits exactly one warn finding on surface `.gitignore`, the message echoes
     the line `.faff/` and names `.faff/*` as the fix, and the command exits 1
```

```
Given a git repo whose root .gitignore contains `.faff/*` followed by `!.faff/anchors/`,
      with a committed .faffrc.yaml and no overlay
When `faff config check` runs
Then it reports no finding about .gitignore and no finding about .faff/.gitignore,
     and exits 0
```

```
Given a git repo whose root .gitignore contains `**/.faff/`
When `faff config check` runs
Then it emits the over-ignore finding, because a `**/`-prefixed directory-ignore
     blocks the committed parts of .faff/ exactly as the unprefixed spelling does
```

```
Given a git repo whose root .gitignore contains `.faff/` on one line and `.faff/**`
      on another
When `faff config check --json` runs
Then exactly one finding has surface `.gitignore`, and its message contains the
     literal text (lines: `.faff/`, `.faff/**`)
```

```
Given a git repo with no .faff line in any .gitignore, a .faff/ directory present,
      and no .faff/.gitignore (the state a fresh clone reaches after FAFF-1299 lands
      and the operator never committed the inner file)
When `faff config check` runs
Then it emits exactly one warn finding on surface `.faff/.gitignore` whose message
     names `faff gitignore-ensure` as the fix and says to commit what it writes,
     and the command exits 1
```

```
Given a git repo whose root .gitignore contains `.faff/*`, with a .faff/ directory
      present and no .faff/.gitignore (this repo today, pre-FAFF-1299)
When `faff config check` runs
Then it emits no finding on surface `.faff/.gitignore`, because the root line still
     ignores run state
```

```
Given a directory that is NOT a git repo, whose .gitignore contains `.faff`
When `faff config check` runs
Then it emits the over-ignore finding, and separately still reports
     "posture checks skipped (not a git repo)"
```

### The real-git oracle

The fixture tables in sections 3 and 8 are hand-transcribed verdicts, and a hand-transcribed table cannot catch a spelling nobody thought of. The missed `**/` family is a live instance of exactly that. So the predicate is additionally checked against git itself, which is cheap because `test/config-two-file.test.mjs`'s `gitDir` helper already builds real repos and already takes a `gitignore` argument.

```
PROCEDURE oracle_row(line, expected_hazard, expected_gap):
  1. dir = gitDir({ gitignore: line, base: "slots:\n  spec: x\n", commitBase: true })
  2. create dir/.faff/anchors/run1/a.json and dir/.faff/templates/adr.md
  3. write dir/.faff/.gitignore with /*, !/.gitignore, !/anchors/, !/templates/
  4. git_blocks = ANY OF `git check-ignore -q` on
       .faff/.gitignore, .faff/anchors/run1/a.json, .faff/templates/adr.md
  5. predicate_flags = gitignoreDirHazardLines(line) is non-empty
  6. ASSERT predicate_flags == expected_hazard        # the table's transcription
  7. IF expected_gap:
       ASSERT git_blocks AND NOT predicate_flags      # pins a KNOWN, accepted gap
     ELSE:
       ASSERT predicate_flags == git_blocks           # agreement with git
```

Every row of the section 3 predicate table runs with `expected_gap: false`, so the oracle is a biconditional: the predicate flags a line if and only if real git blocks at least one committed part of `.faff/`. The three spellings named under "Known gap" run with `expected_gap: true`, which asserts the gap rather than hiding it, so widening the list later turns a passing characterisation assertion into a failing one and forces the author to update it deliberately.

Assertions, non-functional:

- `faff config check` performs no writes and no network calls, before and after this change.
- Both new helpers in `gitignore-ensure.js` are pure: no filesystem access, no `spawnSync`, no process state.
- `gitignoreHasPattern`, `stripTrailingSlash`, `FAFF_GITIGNORE_PATTERNS`, `FAFF_GITIGNORE_PATTERNS_LOCAL` and `gitignoreEnsure` are unchanged in behaviour; `gitignore-ensure --selftest` passes with no edits to its existing cases.
- Every existing `configCheckSelftest` case passes with no edit to its `probes` literal, and no existing case's `isIgnored` or `isTracked` lambda is ever called with a `.faff/...` path.
- `gitignoreDirHazardLines`'s signature stays `(text) -> [String]`, the shape FAFF-1299 also defines.

## 6. DESIGN DECISION RATIONALE

**Where do the new filesystem facts enter the pure core?** Options: new `probes` members such as `readRootGitignore()`; new top-level members on the options object; or having `computeConfigCheck` read the files itself. Reading them in the core would destroy the pure/IO split that exists so `configCheckSelftest` can drive the core without a real repo. A `probes` member would require editing every existing selftest case's object literal, and a call site that forgot it would crash on an undefined call rather than skip. **Chosen:** three new top-level members, `rootGitignore: String | Null`, `faffDirPresent: Bool` and `faffDirGitignorePresent: Bool`. An absent key destructures to `undefined`, which both checks treat as "nothing to look at", so every existing call site and selftest case works verbatim, and `probes` keeps its single meaning of "git subprocess probes".

**Reuse, extend, or sit beside `gitignoreHasPattern`?** Reusing it as-is gives a boolean, but finding 1 must echo the offending line so an operator knows which to edit. Extending it to return the matched line would change the signature of a function the append-only writer calls on every run. **Chosen:** two new pure helpers beside it in `gitignore-ensure.js`, reusing the exported `stripTrailingSlash` and mirroring the same blank-and-comment skip rules. The reuse that matters is the normaliser and the single home for ignore policy; a few lines of loop are cheaper than a changed writer dependency.

**Which spellings count as a hazard?** The ticket names a literal `.faff/`. The empirical table in section 3 shows four prefix forms (bare, root-anchored `/`, `**/`, and `/**/`) crossed with four directory-scope suffix shapes (bare, `/**`, `/*/**`, `/**/*`) all cause the loss the ticket describes, sixteen spellings in all, with `.faff/**/` covered for free by trailing-slash normalisation and the `.faff/*` family explicitly clean. The `**/` forms are not exotic: GitHub's own templates use them, and the round-1 draft's omission of them meant a repo could lose its anchors while `config check` reported clean. **Chosen:** flag all sixteen, and explicitly decline to chase the unbounded equivalent-glob family (`.faff/*/*/**`, `.faff/**/**`, `.faff/*/*`, and so on), pinning those three verified spellings as characterisation rows in the oracle instead. Rationale for declining: the family is infinite, so partial enumeration implies a completeness the check cannot have, whereas a pinned gap plus a one-line extension path is honest and keeps the next widening visible in review. The ticket's own framing is "a line that blocks committed faff files" rather than one exact spelling, so broadening to sixteen is within its intent.

**How does finding 1 render several hazard lines?** Options: one finding per line; one finding with only the first line named; one finding with a plural slot. One finding per line would report one fault as many, and the fix is a single edit pass. Naming only the first would leave an operator fixing one line and seeing the finding again. **Chosen:** one finding per repo with the `dir_hazard_slot` rendering in section 3, singular ``(line: `X`)`` and plural ``(lines: `X`, `Y`)``, file order, exact duplicates collapsed. The criterion is pinned against `--json` output so "exactly one finding" is countable rather than inferred from a multi-line stdout.

**Severity and exit code.** Options: `warn` (exit 1 via the existing rule), `error` (same exit, louder label), or a new non-exiting "notice" severity. **Chosen:** `warn` for both findings, with the existing `findings.length ? 1 : 0` rule untouched. The ticket specifies advisory and every other posture finding is a warn. Exiting 1 changes no caller's behaviour: the gateway preamble treats findings as advisory and never blocks (`references/kernel.md:29`), no workflow or script in this repo runs `faff config check`, the local gate ladder does not include it, and ADR-0067 records that a consuming repo's CI may gate on the exit code if it chooses. Inventing a third severity to dodge an exit code nobody branches on would be a larger change than the findings. Note this choice is made knowing the downstream posture: governance-check runs `on-missing: pass`, so nothing fails a build over absent anchors today, which is an argument for the finding mattering, not for making it an error.

**Does `config.js` import from `gitignore-ensure.js`?** Options: import the helpers; duplicate the helpers and the spelling lists in `config.js`. `config.js` already requires six sibling `bin/lib/` modules (`argv`, `heartbeat`, `runcheck`, `backends`, `sentry`, `shared-infra`). `gitignore-ensure.js` requires only `./shared-infra`, so there is no cycle. The import-independence guard is scoped to the standalone `commissaire` require closure (`test/commissaire-standalone.test.mjs:139-164`): its denylist contains neither `config` nor `gitignore-ensure`, and it asserts `config.js` must stay *out* of the commissaire closure. Adding an outbound edge from `config.js` does not put `config.js` into that closure, so the guard is unaffected. **Chosen:** `config.js` imports `gitignoreDirHazardLines` and `gitignoreMentionsFaffDir` from `./gitignore-ensure`, keeping one home for ignore policy and no duplicated spelling lists.

**Does each check run outside a git repo?** Options: gate both on `probes.inRepo` like every existing posture check; gate neither; gate one. **Chosen:** finding 1 runs regardless, finding 2 only inside the block. Finding 1 needs no git: the fault is a property of the file's text, and a directory with a `.gitignore` is either a repo whose `.git` lives elsewhere or a repo-in-waiting. Finding 2 is entirely probe-driven and both of its questions ("is run state ignored", "would a clone inherit the rule") are meaningless without a repo. The existing `"posture checks skipped (not a git repo)"` string stays byte-identical, since it names the probe-backed checks and `test/config-two-file.test.mjs:275` asserts that case.

**How wide is the hazard-spelling scan?** Options: root `.gitignore` only; also `.git/info/exclude`; also nested `.gitignore` files; also the global `core.excludesFile`. **Chosen:** root `.gitignore` only. `.git/info/exclude` is excluded because `gitignore-ensure --local` (FAFF-1062) writes `.faff/` into it deliberately, and `FAFF_GITIGNORE_PATTERNS_LOCAL` at `gitignore-ensure.js:66-74` drops the anchors carve-out on purpose, since a never-committed personal exclude has no committed subtree to protect; warning there would fire on faff's own correct output and teach operators to ignore the finding. Nested `.gitignore` files are excluded because faff's `.faff` directory is root-only, so no nested file can create this hazard; the one exception, `.faff/.gitignore`, belongs to FAFF-1299. The global excludes file is outside the repo and its remedy would not be a repo edit.

**How does finding 2 answer "is run state ignored" without re-deriving git's precedence rules?** Options: parse the root `.gitignore`, `.faff/.gitignore` and `.git/info/exclude` and model which wins; or ask `git check-ignore` about a representative path through the existing `probes.isIgnored`. Modelling precedence would mean writing the general evaluator this spec rejects elsewhere, and it would have to special-case `--local` to avoid firing on faff's own correct output. **Chosen:** ask git, with `FAFF_RUN_STATE_PROBE_PATH = ".faff/runs"` as the probe. That single call gets `--local` right for free (`git check-ignore` consults `.git/info/exclude`), gets a global `core.excludesFile` right for free, and gets the pre-FAFF-1299 root `.faff/*` line right for free. All four regimes plus the hazard case were verified empirically on 2026-10-15.

**How does finding 2 tell an absent `.faff/.gitignore` from an untracked one, and why does it care?** Git honours a `.gitignore` whether or not it is tracked, so `isIgnored` cannot see the difference and an untracked inner file looks correct in this checkout while leaving a fresh clone unprotected. Options: ignore the untracked case; treat untracked and absent as one finding; two message variants under one finding. **Chosen:** presence from the filesystem (`faffDirGitignorePresent`), tracked-ness from the existing `probes.isTracked(".faff/.gitignore")`, and two mutually-exclusive message variants under one finding on surface `.faff/.gitignore`, because the two faults have genuinely different remedies (`faff gitignore-ensure` then commit, versus just commit). The untracked branch is additionally guarded on the root `.gitignore` not already mentioning `.faff`, via `gitignoreMentionsFaffDir`, so it stays silent on a repo whose root line already covers a clone.

**Is `.faff/` existing a precondition for finding 2?** Options: fire whenever nothing ignores run state; require `.faff/` on disk. Firing unconditionally would nag every repo that has merely cloned faff and never run it, and, more concretely, would reach `probes.isIgnored` in every existing `configCheckSelftest` case, whose lambdas are keyed on basenames and would answer an unexpected `.faff/runs` argument arbitrarily. **Chosen:** `.faff/` must exist, tested before any probe call. Accepted cost: one run of lag on a genuinely fresh clone, where the gateway's entry `config check` precedes the first command that creates `.faff/`. That is the right trade for an advisory finding, and the finding appears on the very next entry.

**Where does the under-ignore remedy live: a root backstop, a self-healing ensurer, or a finding?** Options the product owner weighed on 2026-10-15: keep a root `.faff/*` backstop after FAFF-1299; widen `gitignore-ensure`'s call sites so it re-runs on a fresh clone; or add this posture finding. The backstop was rejected because it reintroduces exactly the root-`.gitignore` coupling FAFF-1299 exists to remove. Self-healing was deferred because widening the two first-run call sites (`faff-onboard/SKILL.md:145` and `faff/SKILL.md:70`, both gated on `faff config path` exit 3) is a behaviour change to the onboarding path with its own blast radius. **Chosen:** the posture finding, surfaced by the gateway entry preamble, which already runs `faff config check` on entry and so needs no new call site. It lands in FAFF-1301 rather than FAFF-1299 because `config check` posture findings are this slice's machinery and FAFF-1299's spec carries a DONE item keeping `bin/lib/config.js` untouched. Self-healing stays named under OUT OF SCOPE as the escalation if operators ignore the advisory.

**What happens when the root `.gitignore` is absent or unreadable?** Options: no-op silently; emit a `skipped` line for the unreadable case; exit 2. Exit 2 is wrong on principle; `config check` must be able to describe faults rather than abort on them (ADR-0082). Distinguishing absent from unreadable would mean passing a richer shape than a string into the pure core for a case nobody hits. **Chosen:** any read failure, including a missing file, yields `Null` and finding 1 becomes a silent no-op, matching today's silence about a missing `.gitignore`. Finding 2 reads the same `Null` as "the root says nothing about `.faff`", which is the correct reading for a clone's purposes. The accepted blind spot is a repo whose root `.gitignore` cannot be read, which is already a larger problem than these findings.

**Does either check ever fix the line?** Options: offer a `--fix`; have `gitignore-ensure` rewrite the line; stay read-only. **Chosen:** read-only, operator action only. `gitignore-ensure.js:13-48` records why for finding 1: an automated line-drop "could sweep a private value into a commit", and the same comment already promises this finding as the migration surface. Finding 2's remedy is a `git add` and a commit, which faff never does on the operator's behalf anywhere (`faff-onboard/SKILL.md:145` makes the same point about `.faffrc.yaml`). A writer belongs in a separate `faff config fix` command if it is ever wanted, the same extension point FAFF-794's spec named.

**Where do the predicate fixtures live, given the oracle needs real git?** Options: one table, exported from `gitignore-ensure.js` so both rungs share it; two tables, one pure and one real-git. Exporting test data from shipped code to avoid duplication would put fixtures in the artifact adopters install. **Chosen:** two tables. The pure table in `gitignoreEnsureSelftest` is the fast rung that `faff regions selftest` runs with no git dependency (`regions.js:533`); the real-git oracle table in `test/config-two-file.test.mjs` is the authority, and a DONE item requires every spelling added to `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` to gain a row in both.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. Every decision above is closed with a `**Chosen:**`, and each was settled from evidence in the repo or from a git experiment recorded in this spec rather than deferred. The two items a reader might expect to find open are both closed decisions: the unbounded glob family is an accepted, pinned gap (section 3, and its own `**Chosen:**` in section 6), and the self-healing ensurer is a deliberate deferral recorded under OUT OF SCOPE with its call sites named.

**Assumptions:** none. This change depends on nothing outside the repo as it stands at `4839e550`. In particular it does **not** depend on FAFF-1299's `.faff/.gitignore`, which does not exist yet.

**Coordination with FAFF-1299, not a dependency.** FAFF-1299's revision defines the same `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` constant and the same `gitignoreDirHazardLines` helper in `gitignore-ensure.js`, because its own write-time warning needs them. Both are an **additive, idempotent** addition to that file: whichever slice lands first creates them, and the second finds them already present and consumes them unchanged. The two lists are not identical: this spec enumerates the complete four-by-four cross-product at sixteen spellings, FAFF-1299 enumerates eight entries, and sixteen is a strict superset of eight. Where they differ this spec's list is the authority, and the reconciliation rule is the superset, not byte-identity. There is no blocker edge in either direction: the over-ignore hazard already costs a repo its anchors today, and the under-ignore finding is specified to stay silent both before FAFF-1299 lands (the root `.faff/*` line still ignores run state) and after it lands correctly (the committed inner file does). If the two slices land in the same window and the constant's contents differ, the later PR reconciles to the superset; that is a merge detail, not a sequencing constraint.

## 8. DONE: definition of done

### From WHY

- [ ] A root `.gitignore` containing `.faff/` makes `faff config check` emit a warn finding on surface `.gitignore` whose message contains the literal `.faff/*` as the fix, and the command exits 1. Asserted by a new case in `test/config-two-file.test.mjs` using the existing `gitDir({ gitignore, base, commitBase })` helper.
- [ ] The finding message echoes the offending line verbatim and states that `faff gitignore-ensure` cannot fix it.
- [ ] A repo with `.faff/` present and no `.faff` ignore rule reachable from a clone makes `faff config check` emit a warn finding on surface `.faff/.gitignore`, and the command exits 1.
- [ ] This repo's own `faff config check` still exits 0: its root `.gitignore` uses `.faff/*`, which is clean for finding 1 and keeps run state ignored for finding 2. Asserted by running the command in the repo as part of the PR's gate evidence.

### From WHAT (types and the predicates)

- [ ] `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` is exported from `gitignore-ensure.js` and contains at least the sixteen spellings listed in section 3, including all four `**/`-prefixed and `/**/`-prefixed forms.
- [ ] `FAFF_GITIGNORE_DIR_CLEAN_PATTERNS` is exported from `gitignore-ensure.js` and contains exactly `.faff/*`, `/.faff/*`, `**/.faff/*`, `/**/.faff/*`.
- [ ] `gitignoreDirHazardLines(text)` is exported from `gitignore-ensure.js`, has signature `(text) -> [String]`, and is pure: no `fs`, no `spawnSync`.
- [ ] `gitignoreMentionsFaffDir(text)` is exported from `gitignore-ensure.js`, returns `true` for a hazard spelling and for a clean spelling, `false` otherwise, and is pure.
- [ ] A fixture table in `gitignoreEnsureSelftest` drives `gitignoreDirHazardLines` over every row of the section 3 predicate table, including one row per `**/`-prefixed and `/**/`-prefixed form and one for `.faff/**/`, asserting the hazard verdict and, for hazard rows, the returned line text. Runs under `faff regions selftest` (`regions.js:533` already wires `gitignore-ensure --selftest`).
- [ ] `gitignoreDirHazardLines(null)` and `gitignoreDirHazardLines("")` both return an empty list; `gitignoreMentionsFaffDir(null)` returns `false`.
- [ ] `computeConfigCheck` accepts `rootGitignore`, `faffDirPresent` and `faffDirGitignorePresent` as top-level options; every pre-existing `configCheckSelftest` case passes with its `probes` literal unedited.

### From HOW (behaviour, finding 1)

- [ ] A `configCheckSelftest` case with `rootGitignore` containing `.faff/` produces exactly one additional finding, `severity: "warn"`, `surface: ".gitignore"`, and `exit === 1`.
- [ ] A `configCheckSelftest` case with `rootGitignore` containing `**/.faff/` produces the finding, and one containing `/**/.faff` produces it too.
- [ ] A `configCheckSelftest` case with `rootGitignore` containing `.faff/*` and `!.faff/anchors/` produces no `.gitignore` finding.
- [ ] A `configCheckSelftest` case with `rootGitignore` containing `.faff/**` produces the finding.
- [ ] A `configCheckSelftest` case with `probes.inRepo: false` and `rootGitignore` containing `.faff` produces the finding **and** the existing `"posture checks skipped (not a git repo)"` entry in `skipped`.
- [ ] A `configCheckSelftest` case with `rootGitignore` omitted entirely produces no `.gitignore` finding.
- [ ] `faff config check --json` includes both new findings in its `findings` array with the three existing keys and no new key.

### From HOW (behaviour, finding 2)

- [ ] A `configCheckSelftest` case with `faffDirPresent: true`, `faffDirGitignorePresent: false` and a `probes.isIgnored` that returns `false` for `.faff/runs` produces exactly one finding on surface `.faff/.gitignore`, `severity: "warn"`, whose message names `faff gitignore-ensure`, and `exit === 1`.
- [ ] A `configCheckSelftest` case with `faffDirPresent: true`, `faffDirGitignorePresent: true`, `probes.isIgnored(".faff/runs") === true`, `probes.isTracked(".faff/.gitignore") === false` and a `rootGitignore` saying nothing about `.faff` produces exactly one finding on surface `.faff/.gitignore` whose message says the file is not committed.
- [ ] The same case with `probes.isTracked(".faff/.gitignore") === true` produces no finding on that surface.
- [ ] The same case with `rootGitignore` containing `.faff/*` produces no finding on that surface, because the root line covers a clone.
- [ ] A `configCheckSelftest` case with `faffDirPresent: true` and `probes.inRepo: false` produces no finding on surface `.faff/.gitignore`.
- [ ] A `configCheckSelftest` case with `faffDirPresent` omitted calls neither `probes.isIgnored` nor `probes.isTracked` with any `.faff/...` path. Asserted with a recording probe lambda that fails the case if called with such a path.
- [ ] A `configCheckSelftest` case with a hazard `rootGitignore`, `faffDirPresent: true` and `probes.isIgnored(".faff/runs") === true` produces finding 1 only, confirming the two findings never double-report one repo.
- [ ] `FAFF_RUN_STATE_PROBE_PATH` is a named constant, not an inline string literal at the call site.

### From HOW (edge cases)

- [ ] A repo with no root `.gitignore` and no `.faff/` produces neither finding and does not exit 2. Asserted in `test/config-two-file.test.mjs`.
- [ ] A repo whose root `.gitignore` uses `.faff/*`, with a `.faff/` directory present and no `.faff/.gitignore`, produces neither finding and exits 0. This is the pre-FAFF-1299 non-spurious-fire case. Asserted in `test/config-two-file.test.mjs`.
- [ ] A repo whose root `.gitignore` is empty, whose `.git/info/exclude` contains `.faff/`, with `.faff/` present and no `.faff/.gitignore`, produces neither finding and exits 0. This is the correct `--local` non-spurious-fire case. Asserted in `test/config-two-file.test.mjs` by appending to `.git/info/exclude` directly.
- [ ] A commented line `# .faff/` and a negation `!.faff/` each produce no finding 1 (fixture-table rows).
- [ ] A line `.faff/` with trailing whitespace produces finding 1 (fixture-table row).
- [ ] Two hazard lines in one file produce exactly one finding on surface `.gitignore`. Asserted in `test/config-two-file.test.mjs` against `faff config check --json`: the `findings` array contains exactly one entry with `surface === ".gitignore"`, and its `message` contains the literal substring ``(lines: `.faff/`, `.faff/**`)``.
- [ ] The same hazard line written twice produces one finding naming it once (fixture-table row on `gitignoreDirHazardLines`, asserting a one-element result after de-duplication in the message slot).

### From the real-git oracle

- [ ] `test/config-two-file.test.mjs` carries an oracle table that, for every row of the section 3 predicate table, builds a real repo via `gitDir`, runs `git check-ignore -q` on `.faff/.gitignore`, `.faff/anchors/run1/a.json` and `.faff/templates/adr.md`, and asserts `gitignoreDirHazardLines(line)` is non-empty if and only if git blocks at least one of the three.
- [ ] The oracle table additionally carries characterisation rows for `.faff/*/*/**`, `.faff/**/**` and `.faff/*/*`, each asserting that git blocks a committed path **and** the predicate stays silent, pinning the accepted gap.
- [ ] A comment at the oracle table states that adding a spelling to `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` requires a row here and a row in the `gitignoreEnsureSelftest` fixture table.

### Gates and docs

- [ ] `faff regions selftest --region factory` passes.
- [ ] `node --test` passes, including `test/config-two-file.test.mjs` and `test/commissaire-standalone.test.mjs` (the import-independence guard must stay green with the new `config.js` → `gitignore-ensure.js` edge).
- [ ] `faff regions check` passes; the new code sits inside the existing `region:factory` banners in both files.
- [ ] `gitignore-ensure.js`'s header comment at lines 13-48, which promises "see `faff config check`'s posture finding", is updated to state that the finding now exists rather than being promised.
- [ ] `plugin/skills/faff/references/kernel.md:285`, which describes the gitignore posture and already points at "`faff config check`'s posture finding", gains one clause noting that `config check` now also reports an absent or uncommitted `.faff/.gitignore`. No other doc change is required; `references/kernel.md:29` already describes `config check` findings as advisory, which stays true.

No LLM-judgement seam is introduced or changed, so no grader `KIND`, eval case, or seam-registry row is required.

### Integration smoke test

```
PROCEDURE smoke():
  # finding 1
  1. Create a temp git repo (git init, user.name, user.email)
  2. Write .gitignore containing exactly the line `.faff/`
  3. Write .faffrc.yaml with `slots:\n  spec: x\n`; git add .gitignore .faffrc.yaml; git commit
  4. Run `faff config check`
  5. ASSERT exit == 1
  6. ASSERT stdout matches /warn .*\.gitignore:/ AND contains the literal `.faff/*`
  7. Rewrite the .gitignore line to `.faff/*`; git add; git commit
  8. Run `faff config check` again
  9. ASSERT exit == 0 AND stdout contains "config check: clean"

  # finding 2, continuing in the same repo
 10. mkdir .faff/runs; write .faff/runs/x.md
 11. Run `faff config check`; ASSERT exit == 0        # root `.faff/*` still covers run state
 12. Remove the `.faff/*` line from .gitignore; git add; git commit
 13. Run `faff config check`
 14. ASSERT exit == 1 AND stdout matches /warn \.faff\/\.gitignore:/
     AND contains the literal `faff gitignore-ensure`
 15. Write .faff/.gitignore containing `/*` and `!/.gitignore`   # present, NOT added
 16. Run `faff config check`
 17. ASSERT exit == 1 AND stdout matches /warn \.faff\/\.gitignore:/ AND contains "NOT
     committed"
 18. git add -f .faff/.gitignore; git commit
 19. Run `faff config check`; ASSERT exit == 0 AND stdout contains "config check: clean"
```

If this passes, the file reads, the directory stat, both predicates, both probes, both findings and the exit-code path are all connected.

---

confidence: high
spec-review: accept (fixes applied, rounds 1-2; no reviewer approve issued)

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

---

## Self-review findings and resolutions

Run in-context as a fresh-reasoning pass over the drafted spec against the codebase, per the inherited `faffter-noon-spec` self-review section (in-context form, since this producer runs as a dispatched subagent).

### Round 2: applying the `revise` verdict

Round 1's verdict was `revise` with one major and three minor findings, plus a product-owner scope addition. All five are applied.

| Item | Round-1 finding | What changed |
|---|---|---|
| 1 (QA, major) | The hazard spelling list missed the `**/`-prefixed forms, so `config check` would report clean on a spelling with consequences identical to the `.faff/` row. | Applied, and widened past what the reviewer found. I re-ran the experiment across four prefix forms and four suffix shapes: the list goes from four spellings to sixteen, covering `**/`, `/**/`, `/*/**` and `/**/*`. The `/**/.faff` pair the reviewer missed is included. `.faff/**/` turns out to be covered for free by trailing-slash normalisation, which the spec now records. |
| 1 (continued) | The reviewer probed `.faff/**/` and `.faff/*/**` and asked for an explicit decision on the exotic partials. | Decided, with a `**Chosen:**`. `.faff/*/**` and `.faff/**/*` are covered at all four prefixes. The genuinely unbounded remainder (`.faff/*/*/**`, `.faff/**/**`, `.faff/*/*`, all three verified to block the anchor) is an accepted gap, named in section 3 with the reason, and **pinned** by characterisation rows in the oracle so a future widening is a visible change rather than a silent one. |
| 2 (QA, minor) | Multi-hazard message rendering was unspecified: a single `(line: …)` slot, no definition for more than one line, and an undecidable DONE item. | Applied. `dir_hazard_slot` is defined as pseudocode (file order, duplicates collapsed, singular versus plural wording), and the DONE item now pins the test file, the `--json` surface, the exactly-one-finding count and the literal expected substring. |
| 3 (QA, minor) | No oracle against git; the fixture table re-asserted the spec's own hand-transcribed verdicts. | Applied. Section 5 adds a per-row `git check-ignore` oracle on top of `gitDir`, asserting a biconditional between the predicate and real git. A `**Chosen:**` explains why the pure fixture table survives alongside it (the fast `regions selftest` rung must not need git) rather than exporting fixtures from shipped code. |
| 4 (infosec, minor) | The spec claimed this was the only detection but never said what the anchor consumers do when anchors are absent. | Applied as fact with the anchors supplied, both verified in the repo: `.github/workflows/governance.yml:48` sets `on-missing: pass`, and `.github/actions/governance-check/action.yml:254-266` warns under `pass` and fails only under `fail`. The WHY now says plainly that governance-check fails open, which is why an advisory finding carries the whole weight. Severity stays `warn`, and the rationale notes the posture is an argument for the finding mattering, not for making it an error. Flipping `on-missing` is listed OUT OF SCOPE with its owner. |
| 5 (new scope) | Product-owner decision of 2026-10-15: add a second posture finding for a missing or untracked `.faff/.gitignore`, because `faff gitignore-ensure` is first-run only and FAFF-1299 removes the root backstop. | Applied as a full second finding, specified to the same standard: predicate pseudocode, two new pure-core inputs, severity and exit consequence, two message variants, selftest cases, real-git cases, and a `**Chosen:**` recording the three options the product owner weighed. |

### Fresh findings this round

| Severity | Finding | Resolution |
|---|---|---|
| major | My first draft of finding 2 fired on "`.faff/` exists and `.faff/.gitignore` is absent". That fires **today** on this very repo, which has `.faff/` and no inner file, and it also fires on a correct `--local` install where the inner file is deliberately absent. Both are exactly the spurious fires the product owner forbade. | Fixed by changing the question. The predicate now asks `git check-ignore` whether run state is ignored, via `probes.isIgnored(".faff/runs")`, instead of looking for a particular file. Verified against real repos in all five regimes: pre-FAFF-1299 silent, correct post-FAFF-1299 silent, `--local` silent, no-rule fires, hazard-line silent (finding 1 fires instead). Recorded as a table in section 3 and as a `**Chosen:**` in section 6. |
| major | The untracked branch, taken on its own, fires on a repo whose root `.gitignore` carries `.faff/*` and whose inner file merely happens to be uncommitted. A clone of that repo is fine, so the warning would be wrong. | Fixed by guarding the untracked branch on `gitignoreMentionsFaffDir(rootGitignore)` being false, which needed the new `FAFF_GITIGNORE_DIR_CLEAN_PATTERNS` list. Added as an edge-case row and a DONE item. |
| minor | Finding 2 calls `probes.isIgnored` and `probes.isTracked` with `.faff/...` paths. Every existing `configCheckSelftest` case builds those lambdas keyed on basenames, so an unexpected argument would get an arbitrary answer and could silently flip existing cases. The round-1 spec's "never break the existing call sites" principle covered the shape of `probes` but not the arguments passed to it. | Fixed by making `faffDirPresent` a hard precondition tested before any probe call, so every existing case short-circuits first. The principle in section 1 is widened to say so, and a DONE item asserts it with a recording lambda that fails if called with a `.faff/...` path. |
| minor | `probes.isIgnored` / `isTracked` are called elsewhere with a `path.basename`, so I checked they accept a nested path at all rather than assuming it. | Verified: `gitIsIgnored` (`config.js:2469`) and `gitIsTracked` (`:2474`) pass `relPath` straight to `git check-ignore -q` and `git ls-files --error-unmatch`, both of which take a repo-relative path of any depth. The `basename` is the existing call sites' choice, not a constraint of the probes. Recorded in the reference table. |
| minor | The round-1 OUT OF SCOPE entry said flatly that the check does not look at `.git/info/exclude`. Finding 2 consults its *effect* through `git check-ignore`, so the unqualified claim became false. | Corrected in place: the exclusion is now scoped to "scanning its text", with an explicit note that the effect is consulted deliberately and that this is what keeps the finding silent on a `--local` install. The same clarification is applied to the global `core.excludesFile` entry. |
| minor | `.faff/runs` was an unverified guess at the run-state directory name. | Verified: `.faff/runs/` exists in this repo, and `.faff/anchors/` is the committed carve-out, so `runs` is the right never-committed probe. It is also specified as a named constant, with a failure mode describing what to change if the layout moves. |

Round-1 self-review findings that still hold, unchanged: the `rootGitignore` top-level-option choice, the absence of a require cycle (the import-independence guard is scoped to the standalone `commissaire` closure and asserts `config.js` stays out of it), the exit-1-changes-no-caller evidence, and the correction that `configCheckSelftest` is reached through `node --test` rather than `faff regions selftest`. The two observations the reviewer recorded without raising are also still true and are not treated as objections: the echoed line is bounded by exact equality after normalisation, so no secret or injection can reach the message, and the unbounded `readFileSync` of an untrusted root `.gitignore` is parity with `gitignoreEnsure`'s existing read of the same path.

### Rating

Two `major` findings this round, both mine, both fixed in full before emitting, which leaves the inherited downgrade rule unbound (it binds at one `blocker` or three `major`). Rating the revised whole rather than the delta: the spec is roughly half again as large, with a second finding, two new pure helpers, three new pure-core inputs and a new real-git oracle. Against that, every one of the sixteen decisions is closed with a `**Chosen:**`, there are no `**Punt:**` or `**Assumes:**` items, the sixteen hazard spellings and all five finding-2 regimes were verified against real git today rather than reasoned about, every DONE item names a file and an assertion, and the two spurious-fire risks the product owner called out are each covered by a dedicated real-git DONE item. The one knowingly incomplete part, the unbounded glob family, is decided, documented and pinned by a test rather than left open. `high` stands.

No repo file was modified and nothing was written to Linear.
