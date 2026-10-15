# SuperDomestique keeps its own ignore rules inside `.faff/` (FAFF-1299)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1299.
> build-tier: complex

This spec covers the change to `faff gitignore-ensure` that moves faff's ignore policy for the `.faff/` directory out of the project's root `.gitignore` and into a committed `.faff/.gitignore` that faff writes and owns. The audience is the build agent implementing it and the human reviewing the result.

## 1. WHY: problem and principles

**The load-bearing model: a `.gitignore` deeper in the tree wins over a shallower one, so faff can govern `.faff/` from inside `.faff/`.** Git evaluates ignore rules per directory, nearest file last, and the last matching rule wins. A `.faff/.gitignore` therefore overrides anything the project's root `.gitignore` says about paths under `.faff/`, and it is itself committable as long as it re-includes itself. That single property is what makes this change work and makes it migration-free for existing repos.

**Problem.** Today `faff gitignore-ensure` appends six patterns to the project's own root `.gitignore`, two of which (`.faff/*` and `!.faff/anchors/`) describe only the contents of a directory faff fully controls (`gitignore-ensure.js:45-52`). Every time faff wants to commit a new folder under `.faff/`, a new negation line has to be appended to a file belonging to the project. This change moves that policy into `.faff/.gitignore`, so faff edits one file it owns and the project's root file stops accumulating faff's internal bookkeeping.

### Design principles

**Anchored patterns only.** Every pattern in `.faff/.gitignore` starts with `/`. An unanchored pattern in a `.gitignore` matches at every depth, so a bare `*` would re-ignore the files *inside* `anchors/` after `!/anchors/` re-included the directory, and the committed anchor chain would silently vanish from `git status`. The ticket's phrasing attributes this to re-ignoring the directory; the real mechanism is depth, not the directory itself. Either way the leading `/` is mandatory and is the thing to assert on.

**Append-only stays append-only.** The writer never removes, reorders or rewrites an existing line. The header comment at `gitignore-ensure.js:28-32` states why: an automated line-drop "could sweep a private value into a commit". The same stance is restated for the `.faff/` to `.faff/*` migration at `:40-44`. This slice does not weaken it.

**Negation must follow its ignore line.** Git honours a negation only when it appears after the pattern that matched. The writer emits in array order, and array order is file order, so the pattern array's order is load-bearing and is asserted directly (the existing set does this for `.faffrc.*.yaml` before `!.faffrc.example.yaml` at `gitignore-ensure.js:48-49`).

**No silent evidence loss.** The committed anchor subtree under `.faff/anchors/` is faff's tamper-evidence record. Any change to ignore policy must be verified against real `git check-ignore`, not just against expected strings. The existing impure test already does this (`test/impure/gitignore-ensure-set.test.mjs`, the "git semantics" cases) and is the right home for the new verification.

**A missing ignore rule must be noisy, never silent.** This slice makes `.faff/.gitignore` the only place faff's `.faff/` policy lives, so a repository that does not carry that file has no faff ignore rule at all. Two reachable sequences produce exactly that state (section 4, failure modes). Both fail towards visible noise in `git status` rather than towards a blocked command, and the standing detection is FAFF-1301's posture finding.

### Reference context

| Subject | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gitignore-ensure.js` | JavaScript (CommonJS, `region:factory`) | The only file whose behaviour changes. Pattern sets at `:45` and `:61`, header at `:69`, `stripTrailingSlash` at `:71`, matcher at `:78`, append builder at `:88`, writer at `:100`, selftest at `:125`, command at `:266`, exports at `:294`. |
| `test/impure/gitignore-ensure-set.test.mjs` | `node:test` | Drives the real CLI in temp repos and asserts real `git check-ignore` behaviour. Home for the end-to-end verification. 187 lines at `4839e550`. |
| `test/decline-parity.test.mjs` | `node:test` | The post-decline parity test is at `:90`; its two root-file assertions are at `:97-98`. Needs retargeting. |
| `test/onboard-local.test.mjs` | `node:test` | Asserts a `--local` run creates no root `.gitignore` (`:87`). Needs one more assertion. |
| `plugin/skills/faff/bin/lib/regions.js` | JavaScript | Registers `gitignore-ensure --selftest` with `faff regions selftest` at `:533`, so selftest cases run in the gate ladder. |
| `plugin/skills/faff/references/kernel.md` | Markdown | `:29` records that the gateway-load preamble runs `faff config check` read-only and surfaces its findings as advisory on every faff entry. That is the channel FAFF-1301's finding rides. `:285` describes `.faff/`'s ignore rules and needs updating. |
| `records/adr/0067-committed-config-posture-two-file-model.md` | Markdown | The committed-config posture. The base config holds no secrets by construction (`kernel.md:35`), which is what bounds the blast radius of a missing ignore rule. |

Note on the explore findings handed to this spec: its line anchors for `gitignore-ensure.js` were each 3 to 5 lines high (it cited `:50`, `:66`, `:89`, `:97`, `:103`, `:293`). Every anchor in this spec was re-verified against the files at `4839e550`, and round 2 corrected six that were still off by a line or two. The substance of the findings was accurate.

**Scope.** This is the first of four tickets moving faff's bookkeeping inside `.faff/`. It adds the one file the other three build on. FAFF-1299 **blocks** FAFF-1300 and FAFF-1302 in the tracker (edges added 2026-10-15), so the ordering is structural rather than a matter of prose: FAFF-1300 needs the `!/templates/` line this slice writes, and FAFF-1302 adds its own `!/config.yaml` and `!/config.example.yaml` lines to the file this slice creates. FAFF-1301 carries no blocker edge in either direction and is deliberately independent; it adds the standing posture finding for the hazards this ticket only warns about at write time, and either ticket may land first (section 3, the shared constant).

## 2. OUT OF SCOPE

- **The `faff config check` posture findings**, excluded because they are FAFF-1301's whole slice. Two distinct findings belong to it: the hazardous root `.faff` line, and the missing-or-untracked `.faff/.gitignore` that section 4's failure modes name as this slice's open gap. This ticket's warning is `faff gitignore-ensure`'s own output at the moment it writes; FAFF-1301 adds the standing advisories that fire on every `faff config check` run whether or not anyone is onboarding. Do not build a `config check` finding here. Extension point: `computeConfigCheck` at `bin/lib/config.js:2517`, which FAFF-1301 extends with the root `.gitignore` text and the `.faff/.gitignore` tracked state as new inputs.
- **Moving template overrides from `.faff-templates/` to `.faff/templates/`**, excluded because that is FAFF-1300, which also has to add a `faff config templates-path` resolver and repoint three consumers. This slice only writes the `!/templates/` line those changes will need. Extension point: the `ADR_TEMPLATE_REL_PATH` constant in `bin/lib/adr.js` and `NATIVE_MAP_DIR` in `bin/lib/native-map.js`.
- **Moving config files to `.faff/config.yaml`**, excluded because that is FAFF-1302. No `!/config.yaml` or `!/config.example.yaml` line is added by this slice; FAFF-1302 adds both alongside its own resolver change. Extension point: the `CANONICAL_CONFIG` and `CANONICAL_OVERLAY_CONFIG` constants at `bin/lib/shared-infra.js:491` and `:497`.
- **Removing the `.faffrc` lines from the root `.gitignore`**, excluded because `.faffrc`, `.faffrc.yml` and `.faffrc.*.yaml` are repo-root files, not files under `.faff/`, so no `.faff/.gitignore` can govern them. They leave the root file when FAFF-1302 moves the files themselves. Extension point: the `FAFF_GITIGNORE_PATTERNS` array.
- **Any automatic rewrite or removal of an existing root `.gitignore` line**, excluded by the append-only principle above. Covered as a decision in section 6.
- **Teaching `faff gitignore-ensure` to stage or commit anything.** The writer creates files; the operator commits them. Onboard already states that it never runs `git add` or `git commit` itself (`plugin/skills/faff-onboard/SKILL.md:145`), and this slice does not change that, nor add a commit recommendation to onboard. The remedy for an uncommitted `.faff/.gitignore` is FAFF-1301's standing finding, decided on 2026-10-15. Extension point: FAFF-1301's `computeConfigCheck` finding.

## 3. WHAT: the two files and the pattern sets

### Vocabulary

| Term | Meaning in this spec |
|---|---|
| Root ignore file | The project's own `.gitignore` at the repository root. Not faff's file; faff only appends to it. |
| faff ignore file | `.faff/.gitignore`. New, committed, written and owned entirely by `faff gitignore-ensure`. |
| Local ignore file | `.git/info/exclude`, the per-checkout target the `--local` flag writes to. Never committed. |
| Carve-out | A `!`-prefixed negation that re-includes a path the preceding ignore pattern matched. |
| Full hazard | A root `.gitignore` spelling that makes git skip the whole `.faff/` subtree, so `.faff/.gitignore` is never read and every rule in it is dead. |
| Partial hazard | A root `.gitignore` spelling that lets git descend and read `.faff/.gitignore`, but leaves nested files under a re-included directory ignored anyway. |

### The faff ignore file

```
FILE .faff/.gitignore                 # committed; written by `faff gitignore-ensure`
  line 1: "/*"                        # anchored: direct children of .faff/ only
  line 2: "!/.gitignore"              # re-includes this file itself
  line 3: "!/anchors/"                # committed tamper-evidence anchor subtree
  line 4: "!/templates/"              # for FAFF-1300; inert until that lands
  line 5: "!/decisions.md"            # inert today; see section 6
  line 6: "!/conventions.md"          # inert today; see section 6

  CONSTRAINT every pattern begins with "/"
  CONSTRAINT "/*" precedes every "!" line
```

Emitted as a new exported constant, `FAFF_DIR_GITIGNORE_PATTERNS`, alongside the two existing sets, and added to the `module.exports` list at `gitignore-ensure.js:294`.

### The root ignore file after this change

```
FAFF_GITIGNORE_PATTERNS = [
  ".faffrc",                # bare legacy form           (unchanged)
  ".faffrc.yml",            # legacy YAML form           (unchanged)
  ".faffrc.*.yaml",         # machine-local overlay glob (unchanged)
  "!.faffrc.example.yaml",  # tracked template negation  (unchanged, must follow the glob)
]                           # REMOVED: ".faff/*", "!.faff/anchors/"
```

### The local ignore file

`FAFF_GITIGNORE_PATTERNS_LOCAL` (`gitignore-ensure.js:61-68`) is unchanged, including its wholesale `.faff/` line and the deliberate absence of an anchors carve-out.

### The directory-hazard fault list

```
FAFF_GITIGNORE_DIR_HAZARD_PATTERNS = [
  ".faff",         # full hazard;    also matches the ".faff/" spelling
  "/.faff",        # full hazard;    also matches "/.faff/"
  "**/.faff",      # full hazard;    also matches "**/.faff/"
  "/**/.faff",     # full hazard;    also matches "/**/.faff/"
  ".faff/**",      # partial hazard
  "/.faff/**",     # partial hazard
  "**/.faff/**",   # partial hazard
  "/**/.faff/**",  # partial hazard
]

FUNCTION gitignoreDirHazardLines(text) -> List<String>:   # pure; no fs, no git
  1. lines <- text split on newline
  2. out   <- []
  3. FOR each line:
       a. t <- line trimmed
       b. IF t is "" or t starts with "#": continue
       c. IF stripTrailingSlash(t) is in FAFF_GITIGNORE_DIR_HAZARD_PATTERNS: append t to out
  4. RETURN out                                            # raw trimmed lines, in file order
```

Seven entries cover eleven spellings, because `stripTrailingSlash` (`gitignore-ensure.js:71-73`) folds each slashed and unslashed pair onto one entry.

**Chosen:** an exact-spelling fault list, held in a new exported constant `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` and read by a new exported pure helper `gitignoreDirHazardLines(text)`, in place of the single `gitignoreHasPattern(".faff/", lines)` check. The existing matcher normalises only the trailing slash, so it catches `.faff/` and `.faff` and nothing else. Verified in temp repos on git 2.39.5, each of the eleven spellings in the list leaves `.faff/anchors/run1/F-1/events.jsonl` ignored, so each one defeats the carve-out this slice depends on; eight of them also leave `.faff/.gitignore` itself ignored, which kills every rule in the file. A list of literal spellings keeps the no-glob-semantics stance of the existing matcher (`gitignore-ensure.js:75-77`) intact: the helper still only compares strings. The residual limitation is honest and stated: an exact-spelling list cannot catch a spelling nobody wrote down, so an exotic equivalent such as a character-class form stays undetected, and the operator's signal in that case is the same `git status` noise the warning exists to pre-empt.

The verified behaviour, for the build agent writing the assertions:

| Spelling in the root `.gitignore` | `.faff/.gitignore` read? | `.faff/anchors/...` tracked? | Class |
|---|---|---|---|
| `.faff/`, `.faff` | no | no | full |
| `/.faff/`, `/.faff` | no | no | full |
| `**/.faff/`, `**/.faff` | no | no | full |
| `/**/.faff/`, `/**/.faff` | no | no | full |
| `.faff/**`, `/.faff/**`, `**/.faff/**` | yes | no | partial |
| `.faff/*` (the correct spelling) | yes | yes | none |

The partial-hazard mechanism, confirmed by `git check-ignore -v` under a root `.faff/**`: `.faff/.gitignore` and `.faff/anchors` are both attributed to `.faff/.gitignore`, so the deeper file is read and its `!/anchors/` does re-include the directory, but `.faff/anchors/run1` is attributed to the root `.faff/**`, because no rule in `.faff/.gitignore` matches a path that deep and the root `**` does. A root `!.faff/anchors/` would not recover those nested files either.

**Chosen:** the fault list covers the partial-hazard family as well as the full one, warned with the same text and the same `.faff/*` fix. The outcome the warning exists to prevent is the committed anchor chain going invisible, and the partial family produces exactly that outcome; distinguishing the two classes in the output would add a second warning string for an operator action that is identical in both cases. The classes are kept distinct in the table above and in the constant's comments so a reader can tell what each spelling actually does.

**Chosen:** FAFF-1299 and FAFF-1301 both define `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` and `gitignoreDirHazardLines` in `gitignore-ensure.js`, with byte-identical definitions, and neither ticket depends on the other. FAFF-1301's `config check` finding needs the same two symbols to judge a root file it did not write, and the two tickets are deliberately independent with no blocker edge. The addition is **additive and idempotent**: whichever slice lands first creates the constant and the helper and exports them; the second finds them already present and consumes them rather than redefining them. The build agent must therefore check `gitignore-ensure.js` for both symbols before adding them, and if they exist, verify the existing definition is a superset of the eight entries listed above. If it is wider, consume it unchanged: FAFF-1301 enumerates the complete four-by-four cross-product and its list is the authority where the two differ. Only a list that MISSES one of the eight above is a real conflict to raise, because the two consumers must agree on the floor. Do not introduce a blocker dependency in either direction to resolve the duplication.

### The writer's return shape

```
RECORD GitignoreEnsureResult:
  path: AbsolutePath          # the root or local target, as today
  created: Boolean            # that target did not exist before this run
  added: List<Pattern>        # patterns appended to that target this run
  already: List<Pattern>      # patterns already present in that target
  faff_dir: FaffDirResult?    # null in --local mode
  warnings: List<String>      # empty on the clean path

RECORD FaffDirResult:
  path: AbsolutePath          # <root>/.faff/.gitignore
  created: Boolean
  added: List<Pattern>
  already: List<Pattern>
```

**Chosen:** extend the existing flat shape with two new keys rather than restructure it into a `targets` array. The four existing keys keep describing the primary target, so every current reader of `faff gitignore-ensure --json` keeps working unchanged. A `targets` array would be tidier in the abstract but breaks `test/impure/gitignore-ensure-set.test.mjs` and `test/onboard-local.test.mjs` for no behavioural gain, and `--json` is a documented CLI surface in `docs/guide/cli.md`.

### Where the ignore rules live

**Chosen:** a committed `.faff/.gitignore`, written by `faff gitignore-ensure`, holding every rule about paths under `.faff/`. The alternative, keeping all rules in the root file, is what exists today and is what the ticket asks to change: each new committed folder under `.faff/` then needs a new line in the project's own file, which faff has no business editing repeatedly. The deeper-file-wins property makes the move free for existing repos, so there is no migration cost to weigh against it.

### The pattern set and the leading slash

**Chosen:** `/*` followed by anchored negations, in that order, with a leading `/` on every pattern. An unanchored `*` would match at every depth and re-ignore the files inside `anchors/` after `!/anchors/` re-included the directory, which would silently drop faff's committed tamper-evidence from `git status`. `!/.gitignore` is required because `/*` matches the faff ignore file itself; without it the file faff just wrote would be untracked and the whole mechanism would evaporate on the next clone.

### Carve-out ownership

**Chosen:** `gitignore-ensure` owns every carve-out for paths under `.faff/`, so `.faff/.gitignore` carries `!/decisions.md` and `!/conventions.md` alongside `!/anchors/` and `!/templates/`. All of faff's ignore policy then lives in the one file faff controls, which is the ticket's point. State honestly, and re-checked in round 2: neither `.faff/decisions.md` nor `.faff/conventions.md` exists in this repository today, and neither is referenced from any source file. The decisions register is hard-coded to `docs/decisions.md` by `decisionsPath` at `plugin/skills/faff/bin/lib/decisions.js:63`, and `conventions.md` has zero references anywhere in `plugin/`, `bin/`, `test/` or `docs/`. This repository's hand-written root `.gitignore` nevertheless carries speculative negations for both. The lines are therefore inert, which is harmless: a negation for a path that does not exist matches nothing. They are included so that when either file is created, it is committable without another edit.

**Anti-pattern:** writing `!/conventions.json` or treating `!/conventions.md` as covering the conventions cache. Why: `faff conventions mine` writes `.faff/conventions.json`, a gitignored per-machine cache (FAFF-1068). `!/conventions.md` does not match it and must not be widened to.

### The root pattern set for a fresh repository

**Chosen:** drop `.faff/*` and `!.faff/anchors/` from `FAFF_GITIGNORE_PATTERNS`, so a fresh repository gets no `.faff` lines at root at all. The explore findings' git experiment confirmed `.faff/.gitignore` alone is sufficient: with no root `.faff` line, `.faff/runs` and `.faff/logs` are ignored by `/*` and `.faff/anchors/**` is staged. Keeping both root lines as well would mean the project's own file still carries faff's internal policy, which is exactly what the ticket removes.

Round 1's review raised keeping a root `.faff/*` line as a belt-and-braces guard against the gap section 4 names, where no `.faff/.gitignore` reaches a clone. The product owner considered and **rejected** that on 2026-10-15: a root `.faff/*` line is precisely the line this ticket exists to remove, and reinstating it to cover a detection gap trades the ticket's whole outcome for a problem that a `config check` finding solves without touching the project's file. The chosen remedy for that gap is FAFF-1301's posture finding, named in section 4.

This does not conflict with the append-only contract. Append-only governs what the writer does to an existing *file* (it never removes a line); it does not freeze the *set* of patterns the writer offers. There is direct precedent: FAFF-387 removed `.faffrc.yaml` from this same set and FAFF-548 replaced the `.faffrc.local.yaml` literal with a glob, both without disturbing append-only. The consequence for an existing repository is simply that its two root `.faff` lines stop being re-offered; they stay in the file, and `.faff/.gitignore` overrides them.

The selftest and test cases that currently assert the opposite are named in section 6 and must be updated as part of this slice.

### Pruning the old root lines

**Chosen:** no pruning. The writer stays append-only and never removes a stale `.faff/*` or `!.faff/anchors/` line from a project's root `.gitignore`. `gitignore-ensure.js:28-32` already documents why an automated line-drop is refused: it "could sweep a private value into a commit". The hand migration stance is restated for this exact `.faff/` case at `:40-44`. Migration off a stale line remains a deliberate hand edit, surfaced to the operator by `faff config check` (FAFF-1301's slice, not this one). Since a stale `.faff/*` line is now harmless rather than wrong, the only cost of leaving it is a redundant line, which does not justify weakening the safety rule.

### `--local` behaviour

**Chosen:** `--local` is unchanged, and specifically writes no `.faff/.gitignore`. The local flag exists to keep a machine-local faff setup out of the shared repository, so a run with it must not add a committable file to the working tree. Its pattern set already ignores `.faff/` wholesale with no anchors carve-out, on the stated grounds that a personal exclude file has no committed subtree to protect (`gitignore-ensure.js:54-60`), and that reasoning is unchanged. A repository that previously ran in standard mode and then runs `--local` keeps its already-tracked `.faff/.gitignore` tracked, because an ignore rule never untracks a file; its anchors do become invisible to `git status`, which is the documented existing consequence of local mode, not a new one.

### The header line in `.faff/.gitignore`

**Chosen:** reuse `buildGitignoreAppendBlock` and the existing `GITIGNORE_HEADER` constant (`gitignore-ensure.js:69`, `:88-95`) unchanged, so a freshly created `.faff/.gitignore` opens with `# faff local artifacts (added by faff gitignore-ensure)` and is self-describing. A bespoke second header constant would read marginally better in context but adds a constant, a selftest case and a divergence between two near-identical writers for no behavioural gain.

### Git's precedence behaviour

**Assumes:** git resolves a `.faff/.gitignore` rule ahead of a root `.gitignore` rule for the same path, and a committed `.faff/.gitignore` re-included by its own `!/.gitignore` line stays tracked, across the git versions adopters run. Validation before starting: run the "git semantics" case described in section 8 against the local git, and confirm `git check-ignore -v .faff/runs/x` names `.faff/.gitignore` as the source and `git status --porcelain` lists `.faff/.gitignore` and a seeded `.faff/anchors/` file as additions. Verified on git 2.39.5 during prep and again in round 2; the test case makes it a standing check rather than a one-off observation.

## 4. HOW: behaviour

### Architecture

`gitignoreEnsure(root, local)` stays the single writer, and its existing core (read, detect missing by literal match, build an append-only block, write) is applied twice in standard mode rather than once. Factor the per-target work into a helper so the second call is a reuse, not a copy.

```
PROCEDURE ensure_one_target(target_path, patterns):
  1. existed  <- file exists at target_path
  2. raw      <- file contents, or "" if absent
  3. lines    <- raw split on newline
  4. missing  <- patterns where gitignoreHasPattern(pattern, lines) is false
  5. already  <- patterns where gitignoreHasPattern(pattern, lines) is true
  6. IF missing is empty:
       RETURN { path: target_path, created: false, added: [], already }
  7. block <- buildGitignoreAppendBlock(raw, missing)
  8. create target_path's parent directory if absent
  9. write raw + block to target_path
  10. RETURN { path: target_path, created: NOT existed, added: missing, already }
```

```
PROCEDURE gitignoreEnsure(root, local):
  1. IF local:
     a. result <- ensure_one_target(root/.git/info/exclude, LOCAL_PATTERNS)
     b. RETURN result with faff_dir = null and warnings = []
  2. result   <- ensure_one_target(root/.gitignore, ROOT_PATTERNS)
  3. faff_dir <- ensure_one_target(root/.faff/.gitignore, FAFF_DIR_PATTERNS)
  4. root_raw <- contents of root/.gitignore, or "" if absent
  5. warnings <- for each line in gitignoreDirHazardLines(root_raw):
                   the hazard warning text for that line (appendix A)
  6. RETURN result with faff_dir and warnings attached
```

Step 3's parent-directory creation is what makes `.faff/` appear on a fresh repository. The existing writer already calls `mkdirSync(dirname(target), { recursive: true })` for the `.git/info/` case (`gitignore-ensure.js:115`), so the helper inherits it and no new mechanism is needed. Creating `.faff/` is a new side effect of a standard run; it is benign, because `.faff/` is where faff writes its run state on the very next command anyway.

Step 4 reads the root file after step 2 wrote it. That is deliberate: the warning is about lines the project already had, and step 2 never appends any pattern on the fault list, so reading before or after is equivalent. Reading after avoids holding a second copy of the contents.

### Command output

```
PROCEDURE cmdGitignoreEnsure(args):
  ... existing flag parsing and root resolution, unchanged ...
  result <- gitignoreEnsure(root, local)
  IF --json:
    print result as JSON          # now carries faff_dir and warnings
  ELSE:
    print one line for the primary target   # existing wording, unchanged
    IF result.faff_dir is not null:
      print one line for .faff/.gitignore   # same created/updated/no-change wording
    FOR each w in result.warnings:
      print w
  RETURN 0
```

The exit code stays 0 on the warning path. The command's job is to ensure the ignore rules, and it succeeded at that; the hazardous root line is the project's to fix. A non-zero exit would break `faff-onboard` step 5 and the decline-parity sequence, both of which run the ensurers unconditionally.

**Anti-pattern:** exiting non-zero, or refusing to write, when a hazardous root `.faff` line is present. Why: `faff-onboard` and the first-run decline path both run `faff gitignore-ensure` as a fire-and-forget step (`plugin/skills/faff-onboard/SKILL.md:145`, `plugin/skills/faff/SKILL.md:70`), and a hard failure there would block onboarding over a condition the operator fixes with a one-character edit.

**Anti-pattern:** teaching `gitignoreHasPattern` or `gitignoreDirHazardLines` gitignore glob semantics. Why: the comment at `gitignore-ensure.js:75-77` records the deliberate choice of a literal matcher, because over-matching risks failing to add a pattern that is actually needed. The fault list is a list of exact spellings precisely so that no glob evaluation enters this file; widening it is an evaluator by the back door.

**Anti-pattern:** having `gitignoreDirHazardLines` read the filesystem or shell out to `git check-ignore`. Why: FAFF-1301 calls the same helper from `computeConfigCheck`, which is a pure function over already-read documents. A helper that takes `text` and returns lines stays usable from both callers and testable in the selftest without a temp repo.

### Edge cases

| Situation | Behaviour |
|---|---|
| Fresh repository, no `.gitignore`, no `.faff/` | Both files created. `.faff/` is created as a side effect of writing `.faff/.gitignore`. |
| `.faff/` exists but `.faff/.gitignore` does not | `.faff/.gitignore` created with the header and all six lines. |
| `.faff/.gitignore` already holds all six lines | No write. `faff_dir.added` is empty and the file is byte-identical. |
| `.faff/.gitignore` holds some lines | Only the missing ones appended, after a blank separator and the header, preserving existing lines. |
| `.faff/.gitignore` holds an unanchored `*` | `/*` is still appended, because the literal matcher does not treat `*` and `/*` as the same line. Both end up present; the appended negations follow both, so the carve-outs still work. Harmless redundancy, not a correctness problem. |
| Root `.gitignore` already has `.faff/*` and `!.faff/anchors/` | Neither line is removed and neither is re-offered. `.faff/.gitignore` overrides both. No warning: `.faff/*` is the correct spelling. |
| Root `.gitignore` has a full-hazard spelling (`.faff`, `/.faff/`, `**/.faff`, `/**/.faff/`, …) | Both files still written; one warning per offending line; exit 0. Every rule in `.faff/.gitignore` is dead until the operator edits that line. |
| Root `.gitignore` has a partial-hazard spelling (`.faff/**`, `/.faff/**`, `**/.faff/**`) | Both files still written; one warning per offending line; exit 0. `.faff/.gitignore` is read, but nested files under `anchors/` stay ignored. |
| Root `.gitignore` has two hazardous lines | Two warnings, one per line, in file order. |
| `--local` | Only `.git/info/exclude` written. No root `.gitignore`, no `.faff/.gitignore`, no `.faff/` directory created, no warning. |
| `.faff/.gitignore` unreadable or `.faff/` not writable | The existing `try`/`catch` in `cmdGitignoreEnsure` (`gitignore-ensure.js:275-280`) reports the message on stderr and exits 2. Terminal, not retryable. |

### Failure modes

**`faff gitignore-ensure` is first-run-only, so a clone that never received a committed `.faff/.gitignore` has no `.faff` ignore rule at all and nothing repairs it.** This is the slice's real gap, and it is wider than "the operator forgot to commit a file". The command runs at exactly two call sites, both first-run only, and both gated on `faff config path` returning exit 3 (no `.faffrc.yaml`): `faff-onboard` step 5 (`plugin/skills/faff-onboard/SKILL.md:145`) and the first-run decline path (`plugin/skills/faff/SKILL.md:70`). Nothing else invokes it. The file is therefore **not self-healing**. The sequence:

```
1. Operator A onboards. `faff gitignore-ensure` writes `.faff/.gitignore`.
   Onboard never stages or commits; A commits `.faffrc.yaml` and misses the new file.
2. Operator B clones. `.faffrc.yaml` is present, so `faff config path` exits 0,
   the first-run offer never fires, and neither call site runs.
3. B runs any faff command. `.faff/runs/<id>/` and `.faff/logs/` are created.
   No root `.faff` line exists any more and no `.faff/.gitignore` exists either,
   so every one of those paths is untracked and visible in `git status`.
4. Nothing re-runs the ensurer. B's clone stays in that state until someone
   runs `faff gitignore-ensure` by hand.
```

How you would know: `git status` in a fresh clone lists `.faff/runs/` and `.faff/logs/`, and `git check-ignore -v .faff/runs/x` exits 1 with no output. Nothing in CI catches it, because CI clones carry whatever the repository committed. What it means: **proceed, with the detection in FAFF-1301.** The mitigation chosen by the product owner on 2026-10-15 is a `faff config check` posture finding for a missing-or-untracked `.faff/.gitignore`, which the gateway entry preamble already surfaces on every faff command because it already runs `faff config check` there (`plugin/skills/faff/references/kernel.md:29`). That finding lands in FAFF-1301, not here, because `config check` posture findings are FAFF-1301's slice and this spec's DONE item keeping `bin/lib/config.js` untouched must survive. The reference is **not** a blocker: FAFF-1299 ships correct behaviour on the onboarding machine with or without FAFF-1301, and the two tickets carry no edge between them. A root `.faff/*` line was considered as an alternative mitigation and rejected (section 3).

**The same mechanism fires on a deliberate operator reset.** `rm -rf .faff` to clear run state is a plausible thing to do when a run goes wrong, and it takes `.faff/.gitignore` with it. The next faff command recreates `.faff/runs/` with no ignore rule anywhere, and because nothing re-runs the ensurer, the state persists. The chosen fail direction is explicit: **fail open.** Nothing blocks, nothing refuses, the operator's next command runs normally, and the cost is paid in visibility. Sized honestly, that cost is run-ledger and log noise that a lane's `git add -A` can sweep into a commit, **not** credential exposure: ADR-0067 established that the committed config schema is secret-free by construction, since `api_key_env` names an environment variable and the value is read from the environment rather than stored (`plugin/skills/faff/references/kernel.md:35`), and the machine-local overlay keeps its own root ignore line (`.faffrc.*.yaml`, still in `FAFF_GITIGNORE_PATTERNS`) until FAFF-1302 moves it. The signal and the remedy are the same as the clone case above: `git status` noise now, FAFF-1301's standing finding once it lands.

**A repository with a hazardous root `.faff` line loses more than it did before, and the only signal is a line of stdout during onboarding.** Before this change such a repository already lost its committed anchors silently. After it, it also loses every carve-out `.faff/.gitignore` adds, and under a full-hazard spelling `git check-ignore -v` names the root `.gitignore` for all of them because git never descends far enough to read faff's file. How you would know: nothing in CI catches it; only the onboarding-time warning, or FAFF-1301's standing finding once that lands. What it means: proceed, and treat FAFF-1301 as the real remedy. This slice's warning fires once, at write time, for whoever happens to be watching. Round 2 widened the warning from two spellings to eleven, which narrows this mode without closing it.

**The migration-is-free claim could be wrong on some git version.** The whole no-migration story rests on the deeper file winning. How you would know: the new "git semantics" assertions fail, specifically `.faff/anchors/...` coming back ignored in a temp repo seeded with the old root lines plus the new faff file. What it means: narrow, do not abandon. If some supported git resolved precedence differently, the fallback is to keep `.faff/*` and `!.faff/anchors/` in the root set as well, accepting the redundancy, and still ship `.faff/.gitignore` for the new carve-outs. Verified on git 2.39.5 only; the test case turns it into a standing check on every contributor's git.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh git repository with no .gitignore and no .faff directory
When faff gitignore-ensure runs
Then .faff/.gitignore exists holding /*, !/.gitignore, !/anchors/, !/templates/,
     !/decisions.md and !/conventions.md, with /* on an earlier line than every negation
And the root .gitignore holds no line beginning with .faff
```

```
Given that same repository with a file seeded at .faff/anchors/run-1/FAFF-1/events.jsonl
     and a file seeded at .faff/runs/run-1/events.jsonl
When git check-ignore is consulted for each path
Then .faff/runs/run-1/events.jsonl is ignored and .faff/.gitignore is named as the source
And .faff/anchors/run-1/FAFF-1/events.jsonl is not ignored
And .faff/.gitignore is itself not ignored
```

```
Given a repository whose root .gitignore carries a line spelled **/.faff/
When faff gitignore-ensure runs
Then the command exits 0, writes .faff/.gitignore, and emits exactly one warning
     naming the **/.faff/ line and the .faff/* replacement as the fix
```

```
Given a repository where faff gitignore-ensure has already run
When faff gitignore-ensure runs a second time
Then both the root .gitignore and .faff/.gitignore are byte-identical to before
And result.added and result.faff_dir.added are both empty
```

- The command's exit code is 0 on every path above, including every hazard-warning path.
- A `--local` run creates neither the root `.gitignore` nor `.faff/.gitignore` nor the `.faff/` directory.
- `gitignoreDirHazardLines` performs no filesystem access and no subprocess call; it is a pure function of its string argument.

## 6. Design decision rationale

**Where should faff's ignore rules for `.faff/` live?**
Options: the project's root `.gitignore`, as today; a committed `.faff/.gitignore`; or `.git/info/exclude` only. Root-only is the status quo and forces faff to append a line to the project's own file for every new committed folder. Exclude-only cannot work, because the rules have to reach every clone and `.git/info/exclude` is per-checkout.
**Chosen:** a committed `.faff/.gitignore`, faff edits one file it owns, and git's deeper-file-wins precedence makes the move free for existing repositories.

**Anchored `/*` or a bare `*`?**
A bare `*` is unanchored, so it matches at every depth and re-ignores files inside a re-included directory; the committed anchor chain would disappear from `git status` with no error anywhere.
**Chosen:** `/*` and anchored negations throughout, asserted by a selftest case over the pattern set so a future edit cannot quietly drop a leading slash.

**Which carve-outs does `.faff/.gitignore` carry?**
Options: anchors only, matching today's root set; anchors plus the folders future tickets need; or everything faff might ever commit under `.faff/`.
**Chosen:** `!/anchors/`, `!/templates/`, `!/decisions.md`, `!/conventions.md` and `!/.gitignore`, all of faff's ignore policy in the one file faff controls, which is the ticket's point. `!/templates/` is what FAFF-1300 depends on. `!/decisions.md` and `!/conventions.md` are inert today: neither file exists in this repository, the decisions register is hard-coded to `docs/decisions.md` at `decisions.js:63`, and `conventions.md` has no repository references at all. They are included so that creating either needs no second edit. FAFF-1302 adds its own `!/config.yaml` and `!/config.example.yaml` pair in its own slice.

**Does a fresh repository still get `.faff/*` and `!.faff/anchors/` at root?**
Options: keep both for belt and braces; drop both. Keeping them leaves faff's internal policy in the project's file, which this ticket exists to stop, and the git experiment shows they add nothing to a repository that has `.faff/.gitignore`. Round 1's review argued for keeping a root line as a guard against the clone gap in section 4; the product owner rejected that on 2026-10-15 on the grounds that it reinstates the exact line the ticket removes, and chose FAFF-1301's posture finding instead. Dropping both contradicts several existing assertions, listed below.
**Chosen:** drop both. Append-only constrains what the writer does to an existing file, not which patterns the set contains; FAFF-387 and FAFF-548 both changed this same set without weakening it. An existing repository keeps its two lines and is overridden by `.faff/.gitignore`.

The assertions this choice invalidates, all of which must be updated in this slice. Every row was re-verified against the files at `4839e550` in round 2; three were wrong in round 1 and are corrected here.

| Location | Current assertion | Needed change |
|---|---|---|
| `gitignore-ensure.js:149-154` | `.faff/*` and `!.faff/anchors/` are in the root set, glob before negation | Assert both are absent from the root set; move the ordering assertion to the new faff-dir set |
| `gitignore-ensure.js:152` | the root set carries no bare `.faff/` | Keep as-is; still true and still worth asserting |
| `gitignore-ensure.js:167-171` | fresh repo appends `.faff/*` then `!.faff/anchors/` to the root file | Assert the root file gets no `.faff` line, and add the equivalent cases against `.faff/.gitignore` |
| `gitignore-ensure.js:255` | standard mode appends the anchors carve-out to the root file | Assert the carve-out lands in `.faff/.gitignore` instead |
| `test/impure/gitignore-ensure-set.test.mjs:25` | the test *name* enumerates the six-pattern root set, including both `.faff` patterns | Rename to the four-pattern set; the name itself goes stale and is part of the change |
| `test/impure/gitignore-ensure-set.test.mjs:32` | `deepEqual` against the six-pattern root set, including `.faff/*` and `!.faff/anchors/` | Four patterns; add a separate assertion over `.faff/.gitignore`'s six |
| `test/impure/gitignore-ensure-set.test.mjs:33` | the root set carries no bare `.faff/` | Keep as-is; still true |
| `test/impure/gitignore-ensure-set.test.mjs:83-93` | real `git check-ignore` honours the anchors carve-out (runs and logs ignored, anchors and the FAFF-796 run-level anchor tree committable) | Keep every assertion; they now pass via `.faff/.gitignore`, and the FAFF-568 comment at `:80-82` must say so |
| `test/impure/gitignore-ensure-set.test.mjs:177` | the test *name* says standard mode writes `.gitignore` with the carve-out intact | Rename: standard mode writes both targets, carve-out in the faff file |
| `test/impure/gitignore-ensure-set.test.mjs:184-185` | standard mode keeps `!.faff/anchors/` and `.faff/*` in the root set | Assert neither is in the root set and both policies land in `.faff/.gitignore` |
| `test/decline-parity.test.mjs:90` + `:97-98` | post-decline, the root `.gitignore` matches `.faff/*` and `!.faff/anchors/` | Retarget at `.faff/.gitignore` matching `/*` and `!/anchors/`; the parity invariant is unchanged in substance, the test name needs the same retarget |
| `test/onboard-local.test.mjs:87` | a `--local` run creates no root `.gitignore` | Add: it creates no `.faff/.gitignore` either |

Row-level notes on the round 1 corrections, since this table is the build agent's checklist and a wrong row is a missed update: the canonical-set `deepEqual` is at `:32`, not `:31` (`:31` is the `const set` line); the standard-mode root assertions are at `:184-185`, not `:182-184` (`:182` is the `const set` line); the git-semantics anchor assertions span `:83-93`, not `:88-99` (`:88` falls inside the FAFF-796 comment and the file is only 187 lines long). Two stale test *names*, at `:25` and `:177`, were missing from round 1 entirely.

**Should the writer prune a stale root `.faff/*` line once `.faff/.gitignore` exists?**
Options: prune; leave and warn; leave silently. Pruning means a writer that removes lines from the project's file, which `gitignore-ensure.js:28-32` refuses on the grounds that a line-drop "could sweep a private value into a commit".
**Chosen:** leave it. A stale line is now redundant rather than wrong, so the only cost is a line of noise, which does not justify weakening the append-only rule. Migration stays a hand edit; FAFF-1301 surfaces it as a standing advisory.

**How is a hazardous root `.faff` line detected?**
Options: reuse `gitignoreHasPattern(".faff/", lines)`; add an exact-spelling fault list; teach the matcher gitignore glob semantics. Reusing the existing matcher is the smallest change and is what round 1 specified, but its only normalisation is the trailing slash, so it sees `.faff/` and `.faff` and misses nine other spellings verified to defeat the carve-out, including the `**/`-prefixed forms that are a common hand-written and generated spelling. Round 1's review reported `**/`-prefixed entries as idiomatic in published `.gitignore` templates; that attribution is not independently re-checked here, but the hazard itself is verified. Teaching the matcher glob semantics is the file's stated anti-pattern (`gitignore-ensure.js:75-77`): over-matching risks failing to add a pattern that is actually needed.
**Chosen:** an exact-spelling fault list in `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS`, read by the pure `gitignoreDirHazardLines(text)`. Seven entries, eleven spellings, all verified on git 2.39.5. Still string comparison only, so the no-glob-semantics stance holds, and the residual gap (a spelling nobody listed) is stated rather than papered over.

**Does the fault list cover the partial-hazard `.faff/**` family?**
Options: detect it alongside the full hazards; document it as an accepted limitation. Under `.faff/**`, git does descend and does read `.faff/.gitignore`, so the file is not dead; but `git check-ignore -v` attributes `.faff/anchors/run1` to the root `.faff/**`, so the anchor chain's contents stay ignored, and a root `!.faff/anchors/` does not recover them either. The outcome is the same lost tamper-evidence the full hazards cause.
**Chosen:** detect it, in the same list, with the same warning text and the same `.faff/*` fix, because the operator's action is identical in both classes. The classes stay labelled in the constant's comments and in section 3's table so a reader can see what each spelling actually does, but the output does not fork into two strings for one remedy.

**Who defines `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` and `gitignoreDirHazardLines`, given FAFF-1301 needs them too?**
Options: FAFF-1299 defines them and FAFF-1301 blocks on it; FAFF-1301 defines them and FAFF-1299 blocks on it; both specs define them identically and whichever lands first wins. A blocker edge in either direction serialises two tickets that are otherwise independent, for a seven-element array and an eight-line pure function.
**Chosen:** both specs define them identically, and the addition is additive and idempotent. Whichever slice lands first creates and exports the pair; the second finds them present and consumes them unchanged. The build agent checks for both symbols before adding them, verifies an existing definition is a superset of the eight entries in section 3, consumes a wider one unchanged (FAFF-1301 enumerates the full cross-product and is the authority where they differ), and raises a conflict only if the existing list misses one of the eight. No blocker edge is introduced in either direction.

**Where does the hazard warning surface, and does it block?**
Options: stderr and non-zero exit; stdout and exit 0; `faff config check` only. A non-zero exit would break `faff-onboard` step 5 and the first-run decline path, both of which run this command unconditionally. `config check` only is FAFF-1301's slice and leaves this command silent while writing a file the condition makes dead.
**Chosen:** stdout plus the `--json` `warnings` array, one warning per offending line, exit 0. The operator sees it at the moment it matters without onboarding failing over a one-character fix.

**Which way does the change fail when no `.faff` ignore rule exists anywhere?**
Options: fail closed, by refusing to run or by reinstating a root line; fail open, by letting the command proceed and leaving the gap visible in `git status`. Section 4 names the two sequences that reach this state, and both follow from `faff gitignore-ensure` running only on first run. Failing closed would mean a faff command that refuses to work because of an ignore rule, which is disproportionate to the harm.
**Chosen:** fail open. The consequence is run-ledger and log noise in `git status`, sweepable into a commit by a lane's `git add -A`, and not credential exposure: ADR-0067 established the committed config schema is secret-free by construction, and the machine-local overlay keeps its own root ignore line until FAFF-1302 moves it. The standing detection is FAFF-1301's missing-or-untracked posture finding, surfaced by the gateway preamble that already runs `faff config check` on every entry.

**How is the extra target reported in `--json`?**
Options: a `targets` array replacing the flat keys; two new keys alongside them.
**Chosen:** two new keys, `faff_dir` and `warnings`. The flat keys keep their meaning, so every existing reader of the documented `--json` surface is unaffected; the tidier array shape is not worth a surface break.

**Does this repository adopt the change for itself?**
This is the self-hosting repository, and its root `.gitignore` is hand-written rather than writer-produced (it carries a wider `.faffrc.local.*` glob, not `.faffrc.*.yaml`), so running `faff gitignore-ensure` here would append four root patterns nobody asked for.
**Chosen:** hand-create `.faff/.gitignore` with exactly the bytes the writer produces for that file, verified by diffing against a run in a temp root, and leave this repository's root `.gitignore` untouched. The repository then dogfoods its own change, and the one new file is the entire diff to the tree's ignore posture. Committing that file is also this repository's own answer to the clone gap in section 4.

## 7. Open questions and assumptions

**Open questions:** none. Every question the ticket left open, and every question round 1's review raised, has been decided. The carve-out set was settled by the product owner on 2026-10-15. Pruning was settled against the append-only rationale already committed at `gitignore-ensure.js:28-32`. The fail-open gap was settled by the product owner on 2026-10-15 in favour of FAFF-1301's posture finding and against a root-file guard. All three are recorded as settled decisions in section 6.

**Assumptions:**

- **Git resolves `.faff/.gitignore` ahead of the root `.gitignore` for paths under `.faff/`, and a self-re-included `.faff/.gitignore` stays tracked.** Validate before starting: in a temp repository seeded with the old root lines plus the new faff file, confirm `git check-ignore -v .faff/runs/x` names `.faff/.gitignore`, that `.faff/anchors/run-1/FAFF-1/events.jsonl` is not ignored, and that `git status --porcelain` lists `.faff/.gitignore` as an addition. Observed on git 2.39.5 during prep and in round 2; the new impure test case makes it a standing check.

## 8. DONE: definition of done

### From WHY (the problem the change solves)

- [ ] A fresh repository run of `faff gitignore-ensure` produces a root `.gitignore` with no line beginning `.faff`.
- [ ] Adding a future committed folder under `.faff/` requires editing only `FAFF_DIR_GITIGNORE_PATTERNS`, with no change to `FAFF_GITIGNORE_PATTERNS`.

### From WHAT (pattern sets and shapes)

- [ ] `FAFF_DIR_GITIGNORE_PATTERNS` exists, equals `["/*", "!/.gitignore", "!/anchors/", "!/templates/", "!/decisions.md", "!/conventions.md"]`, and is in the `module.exports` list.
- [ ] A selftest case asserts every pattern in `FAFF_DIR_GITIGNORE_PATTERNS` begins with `/`.
- [ ] A selftest case asserts `/*` is at a lower index than every `!`-prefixed pattern in that set.
- [ ] `FAFF_GITIGNORE_PATTERNS` equals `[".faffrc", ".faffrc.yml", ".faffrc.*.yaml", "!.faffrc.example.yaml"]`, asserted by a selftest case over the set.
- [ ] A selftest case asserts `FAFF_GITIGNORE_PATTERNS` contains neither `.faff/*` nor `!.faff/anchors/` nor a bare `.faff/`.
- [ ] `FAFF_GITIGNORE_PATTERNS_LOCAL` is unchanged, and its existing selftest cases at `gitignore-ensure.js:200-206` still pass unmodified.
- [ ] `faff gitignore-ensure --json` emits `faff_dir` (an object in standard mode, `null` with `--local`) and `warnings` (an array), with `path`, `created`, `added` and `already` unchanged in meaning.

### From WHAT (the hazard fault list)

- [ ] `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` exists and contains at least `[".faff", "/.faff", "**/.faff", "/**/.faff", ".faff/**", "/.faff/**", "**/.faff/**", "/**/.faff/**"]`, with comments marking the first four as full hazards and the last four as partial. A wider list (FAFF-1301 enumerates the full cross-product) satisfies this item unchanged.
- [ ] `gitignoreDirHazardLines(text)` exists, takes a string, returns the offending trimmed lines in file order, and skips blank and `#`-comment lines.
- [ ] Both symbols are in the `module.exports` list, so FAFF-1301's `computeConfigCheck` can import them.
- [ ] If `gitignore-ensure.js` already carries both symbols because FAFF-1301 landed first, this slice consumes them unchanged and does not redefine them; a definition that differs from the list above is raised as a conflict, not reconciled silently.
- [ ] A selftest case asserts `gitignoreDirHazardLines` returns one line for each of the eleven hazardous spellings (`.faff/`, `.faff`, `/.faff/`, `/.faff`, `**/.faff/`, `**/.faff`, `/**/.faff/`, `/**/.faff`, `.faff/**`, `/.faff/**`, `**/.faff/**`), tested one spelling per input string.
- [ ] A selftest case asserts `gitignoreDirHazardLines` returns an empty list for `.faff/*`, for `!.faff/anchors/`, for a commented-out `# .faff/` line, and for an empty string.
- [ ] A selftest case asserts `gitignoreDirHazardLines` returns both lines, in file order, for an input carrying two different hazardous spellings.
- [ ] `gitignoreDirHazardLines` touches no filesystem and spawns no subprocess, asserted by it being exercised in the selftest without a temp directory.

### From HOW (behaviour)

- [ ] A fresh-repository selftest case asserts `.faff/.gitignore` is created, holds all six patterns, and has `/*` on an earlier line than each negation.
- [ ] A fresh-repository selftest case asserts the root `.gitignore` contains no line matching `^\.faff` and no line matching `^!\.faff`.
- [ ] A selftest case asserts `.faff/` is created by a standard run in a repository that lacked it.
- [ ] A selftest case asserts a second standard run leaves both the root `.gitignore` and `.faff/.gitignore` byte-identical, with `added` and `faff_dir.added` both empty.
- [ ] A selftest case seeds a root `.gitignore` containing `.faff/*` and `!.faff/anchors/`, runs the writer, and asserts both lines are still present, neither was re-appended, and `warnings` is empty.
- [ ] A selftest case seeds a root `.gitignore` containing a full-hazard spelling, runs the writer, and asserts `warnings` has exactly one entry naming both the offending line and `.faff/*`, that `.faff/.gitignore` was still written, and that the command returns 0.
- [ ] A selftest case asserts a partial-hazard spelling (`.faff/**`) produces the same single warning and the same exit 0.
- [ ] A selftest case asserts a root file carrying two hazardous lines produces two warnings, in file order.
- [ ] A selftest case asserts a `--local` run creates neither the root `.gitignore` nor `.faff/.gitignore` nor the `.faff/` directory, and that `faff_dir` is `null` and `warnings` is empty, including when the root file carries a hazardous line.
- [ ] The human-readable output prints one line per written target, and the warning lines after them.

### From HOW (real git semantics)

- [ ] A case in `test/impure/gitignore-ensure-set.test.mjs` runs the real CLI in a `git init` temp repository, seeds files under `.faff/anchors/`, `.faff/runs/` and `.faff/logs/`, and asserts via `git check-ignore` that the anchors file and `.faff/.gitignore` are not ignored while the runs and logs files are.
- [ ] A case in the same file seeds the old root lines (`.faff/*`, `!.faff/anchors/`) before running the CLI and asserts the same four outcomes, proving the migration-free claim.
- [ ] A case in the same file asserts `git status --porcelain` lists `.faff/.gitignore` as an addition in a fresh repository.
- [ ] A case in the same file seeds a root `.gitignore` carrying `.faff/**`, runs the CLI, and asserts via `git check-ignore -v` that `.faff/.gitignore` is attributed to `.faff/.gitignore` while `.faff/anchors/run-1/FAFF-1/events.jsonl` is attributed to the root `.faff/**` and is ignored. This is the partial hazard, pinned against real git rather than asserted in prose.
- [ ] The existing `--local` git-semantics case at `test/impure/gitignore-ensure-set.test.mjs:151-165` still passes unmodified.

### From the decision table (assertions that had to change)

- [ ] Every row of the invalidated-assertion table in section 6 is updated, including the two stale test names at `test/impure/gitignore-ensure-set.test.mjs:25` and `:177`, and `faff regions selftest` plus `node --test` both pass.
- [ ] `test/decline-parity.test.mjs` asserts the parity invariant against `.faff/.gitignore` rather than the root `.gitignore`, and its test name at `:90` is retargeted to match.
- [ ] `test/onboard-local.test.mjs` asserts a `--local` run creates no `.faff/.gitignore`.

### From scope (documentation and this repository)

- [ ] `docs/guide/cli.md:39` describes both targets rather than only `.gitignore`.
- [ ] `plugin/skills/faff/references/kernel.md:285` describes `.faff/`'s rules as living in `.faff/.gitignore`.
- [ ] `plugin/skills/faff-onboard/SKILL.md:145` and `:148` name both written files, and `:148` still says `--local` writes only `.git/info/exclude`. Neither line gains a commit recommendation; staging stays the operator's.
- [ ] The `region:factory` header comment in `gitignore-ensure.js:1-44` describes the two-file split, keeps the append-only and leading-slash rationales, and records that `.faff/.gitignore` has to be committed for the rules to reach another clone.
- [ ] This repository carries a committed `.faff/.gitignore` matching the writer's output byte-for-byte, and its root `.gitignore` is unchanged by this slice.
- [ ] No `faff config check` finding is added; the file `bin/lib/config.js` is untouched.

### Integration smoke test

```
PROCEDURE smoke():
  1. dir <- mkdtemp; git init in dir
  2. write dir/.gitignore with the legacy content ".faff/*\n!.faff/anchors/\n"
  3. seed dir/.faff/anchors/run-1/FAFF-1/events.jsonl
     seed dir/.faff/runs/run-1/events.jsonl
  4. run: node bin/faff gitignore-ensure --root dir --json
  5. ASSERT the JSON's faff_dir.path is dir/.faff/.gitignore and faff_dir.created is true
     ASSERT the JSON's warnings is empty (".faff/*" is the correct spelling)
  6. ASSERT git check-ignore -q .faff/runs/run-1/events.jsonl        -> ignored
     ASSERT git check-ignore -q .faff/anchors/run-1/FAFF-1/events.jsonl -> not ignored
     ASSERT git check-ignore -q .faff/.gitignore                     -> not ignored
  7. ASSERT dir/.gitignore still contains both seeded lines, unchanged
  8. run step 4 again; ASSERT both files byte-identical and both added lists empty
  9. rewrite dir/.gitignore as "**/.faff/\n"; run step 4 again
     ASSERT exit 0 and warnings has exactly one entry naming "**/.faff/" and ".faff/*"
```

If this passes, the writer, the precedence claim, the migration claim, idempotence and the widened hazard detection are all connected.

## Appendix A: the hazard warning text

One line per offending root `.gitignore` line, naming the line and the fix:

```
warning: <root>/.gitignore has an ignore line `<line>` covering the .faff directory.
Git will not read .faff/.gitignore, or will keep ignoring files under the directories
it re-includes, so faff's committed anchors are invisible.
Fix by hand: change `<line>` to `.faff/*`.
```

The replacement spelling is named explicitly because the whole hazard is the difference between it and the eleven spellings on the fault list, and the existing header comment uses the same `.faff/` to `.faff/*` phrasing (`gitignore-ensure.js:42-43`). The offending line is quoted back verbatim so an operator with two faff-related lines knows which one to edit.

## Self-review

Round 2 revision, applying a `revise` verdict from round 1 (2 major, 2 minor) plus two corrections from the dispatcher's own verification. Every claim below was re-checked against the files at `4839e550`; the git behaviour was re-run locally on git 2.39.5.

**What changed, and why.**

| Finding | Change |
|---|---|
| Major, architectural: the fail-open gap | New named failure mode in section 4 with the clone sequence spelled out, grounded in the verified fact that `faff gitignore-ensure` has exactly two call sites, both first-run only and both gated on `faff config path` exit 3 (`faff-onboard/SKILL.md:145`, `faff/SKILL.md:70`). The file is not self-healing, and the spec now says so. Mitigation named as FAFF-1301's missing-or-untracked posture finding, carried by the `faff config check` the gateway preamble already runs (`kernel.md:29`), stated as a reference rather than a blocker. The root-line alternative is recorded as considered and rejected on 2026-10-15, in both section 3 and section 6. No commit recommendation added to onboard; a new OUT OF SCOPE item says so explicitly. |
| Major, QA: verified false negatives in the literal warning | The `gitignoreHasPattern(".faff/", lines)` check is replaced by `FAFF_GITIGNORE_DIR_HAZARD_PATTERNS` (7 entries, 11 spellings) plus the pure `gitignoreDirHazardLines(text)`. I re-ran all eleven spellings plus `.faff/*` in temp repos: every hazardous spelling leaves the anchor file ignored, eight also leave `.faff/.gitignore` ignored, and `check-ignore -v` under `.faff/**` confirmed the partial mechanism (deeper file read, nested anchor paths attributed to the root `**`). The partial family is detected rather than documented away, with the reason stated. The FAFF-1301 coordination note states the additive, idempotent property and forbids a blocker edge in either direction. |
| Minor, QA: anchor slips | Three rows corrected (`:32` not `:31`, `:184-185` not `:182-184`, `:83-93` not `:88-99`) and two stale test names added (`:25`, `:177`). Six further anchors elsewhere in the spec were off by one or two and are fixed: the migration note is `:40-44`, the matcher `:78-86`, the append builder `:88-95`, the `mkdirSync` guard `:115`, the local-set rationale `:54-60`, the `try`/`catch` `:275-280`, the local selftest block `:200-206`, the `--local` impure case `:151-165`, and the decline-parity assertions `:97-98` under the test at `:90`. |
| Minor, infosec: fail direction | Stated explicitly in section 4 (the `rm -rf .faff` trigger) and as its own section 6 decision. Fail open, sized as run-ledger and log noise sweepable by `git add -A`, not credential exposure, with ADR-0067 and `kernel.md:35` cited for the secret-free schema and the overlay's surviving root line. |
| Correction: tracker edges | Scope and the FAFF-1302 carve-out now say FAFF-1299 blocks FAFF-1300 and FAFF-1302 (edges added 2026-10-15), structural rather than prose, and that FAFF-1301 carries no edge either way. |
| Correction: the inert carve-outs | The unreferenced claim is re-stated with its anchors: `decisionsPath` is hard-coded to `docs/decisions.md` at `decisions.js:63`, and `conventions.md` has zero references across `plugin/`, `bin/`, `test/` and `docs/`. |

**Also fixed in passing.** Two new anti-patterns (no glob semantics in the new helper; no filesystem or subprocess access in it, since FAFF-1301 calls it from a pure function). Edge-case table split into full and partial hazard rows plus a two-line case. Two new scenarios, one of them a holdout, covering `**/.faff/` and the partial `.faff/**` mechanism. The smoke test gained a hazard-warning step. Thirteen new DONE items, including the idempotent-adoption item for the shared symbols. Appendix A rewritten for one warning per line with the offending line quoted back. Every em dash removed; this round introduced none.

**What I did not do.** I did not write to Linear, did not touch a tracked repository file, and did not verify the tracker edges myself; the blocker edges are taken from the dispatcher's statement. The claim that `**/`-prefixed entries are idiomatic in published templates is attributed to round 1's review and flagged as not independently re-checked; the hazard those spellings cause is verified. Git behaviour is verified on git 2.39.5 only, which is why the precedence claim stays an assumption with a standing test rather than a settled fact.

**Rating.** No blocker findings and no majors remain open after this round. The two majors are closed with decided remedies rather than deferrals, every non-trivial decision carries exactly one marker, nothing the human has already decided was re-opened, and DONE mirrors the body including the new hazard-list and partial-hazard sections. The one remaining uncertainty, git's precedence across adopter versions, is carried as an explicit assumption with a validation instruction and a standing test, not an open decision. The inherited downgrade rule does not bind.

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
    { "marker": "assumes" },
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
