# Spec: faff's config files move under `.faff/` (FAFF-1302)

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1302.
> build-tier: complex

This is the build spec for FAFF-1302, "faff's config files live under `.faff/`, so the project `.gitignore` needs no faff lines". Its audience is the build agent that will implement it and the human reviewing that build. It is the last and widest ticket in the four-ticket `.faff/` self-containment chain (FAFF-1299, FAFF-1300, FAFF-1301, FAFF-1302), and it assumes FAFF-1299's `.faff/.gitignore` writer has landed.

## 1. WHY

**The load-bearing model.** faff resolves its two config files through exactly one function, `findNamedIn` in `plugin/skills/faff/bin/lib/shared-infra.js:502`, which today takes one acceptable filename plus a list of legacy names whose mere presence is a loud throw. This ticket moves the acceptable filename from the repo root into `.faff/`, and in doing so turns that two-tier rule (accepted, or loudly rejected) into a three-tier one: **preferred** at the new path, **deprecated but fully valid** at the old root path, and **legacy** which still throws. Everything else in the ticket follows from that one change: the writers target whatever tier resolved, the posture surfaces report which tier resolved, and the `.gitignore` lines faff used to add to the project's root file become carve-out lines inside the one `.gitignore` faff controls.

**Problem statement.** After FAFF-1299 lands, an adopting project's root `.gitignore` still carries four faff lines (`.faffrc`, `.faffrc.yml`, `.faffrc.*.yaml`, `!.faffrc.example.yaml`), because faff's config files sit at the repo root where a `.gitignore` inside `.faff/` cannot reach them. That is the last of faff's bookkeeping living in a file the project owns. To be precise about which population each claim describes, because the two are easy to conflate: **FAFF-1299 already removes `.faff/*` and `!.faff/anchors/` from the root pattern set**, so after both tickets a *newly onboarded* repo gets a root `.gitignore` with no faff lines at all, which is the chain's goal and what scenario 1 asserts. An *existing* repo keeps whatever lines it already has, because `gitignoreEnsure` is append-only and never removes one; that is the population the three-state table and the `--local` analysis below describe, and it is why those states still reason about a root `.faff/*` line. Neither claim contradicts the other. This change moves the base config, the machine-local overlay and the example template under `.faff/`, so faff's ignore policy lives entirely in `.faff/.gitignore` and faff contributes nothing to the project's own root `.gitignore`.

### Design principles

**Loud, never silent, when a value could be dropped.** The config resolver's legacy-name throw exists because hand-reading and silent fallback dropped configured slots twice (`shared-infra.js:487-490`). The new deprecated tier must not weaken that: it resolves the same values from a different path, which is a location change with no value change, and it is reported on the surfaces whose job is reporting posture. The legacy tier keeps throwing exactly as it does today. An implementation that makes a *value* resolve differently in silence has broken this principle; an implementation that makes a *path* resolve differently and says so on a posture surface has not.

**faff never moves an operator's file.** The machine-local overlay can hold operator-private values (this repo's own overlay holds a private tailnet host). No code path in this change moves, copies, stages or rewrites either config file on the operator's behalf. Migration is a hand `git mv` and `mv`, printed verbatim for the operator to run.

**Standard output belongs to the caller.** `faff config get <key>` prints a bare scalar that shell callers capture, and `faff config path` prints paths one per line that `/faff-onboard` reads as a bail check. Nothing this change adds may write to standard output on those paths.

**Config file resolution has one home.** The three-tier precedence rule is written once, in `findNamedIn`, and every consumer (the CLI's writers, its posture surfaces, the governance readers) gets it by calling the resolver. No second copy of the rule anywhere, including in prose.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/shared-infra.js:491-598` | JavaScript (committed emit) | The four filename constants, `findNamedIn`, `findConfigIn` / `findOverlayIn`, and `findConfig` / `findOverlay` with their linked-worktree fallback. The whole mechanism of this ticket. |
| `plugin/skills/faff/bin/lib/config.js:1359,1688,1907` | JavaScript | The three config writers (`init`, `set`, `unset`), each choosing its target with `local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG`. |
| `plugin/skills/faff/bin/lib/config.js:2517,2604` | JavaScript | `computeConfigCheck` (pure core) and `cmdConfigCheck` (the input/output half that builds the git probes and takes `basePath` from `findConfig(root)` at `:2614`). Where the duplicate-location finding goes, and where ten hardcoded `.faffrc` literals live across seven lines (`:2524` to `:2595`). |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js:50,66` | JavaScript | `FAFF_GITIGNORE_PATTERNS` (the root `.gitignore` set, from which four lines are removed) and `FAFF_GITIGNORE_PATTERNS_LOCAL` (the `.git/info/exclude` set). |
| `plugin/skills/faff-graft/setup-worktree.sh:127` | Bash | The copy list that carries gitignored config into a linked worktree. |
| `plugin/skills/faff/bin/lib/validate-adapters.js:1002` | JavaScript | The `HANDREAD` regex that mechanically enforces CLI-only config access across every `SKILL.md`. |

**Scope statement.** This change sits in faff's own configuration layer: the resolver in `shared-infra.js`, its callers in `config.js`, the `.gitignore` writer, the worktree setup script, and the prose that names config paths. It does not touch how any config value is interpreted.

## 2. OUT OF SCOPE

- **A `faff config migrate` command.** Excluded because the human closed the migration question in favour of a fallback plus a printed remedy, and an interactive `git mv` command is a second, larger surface with its own staging risk. Extension point: a new verb in `config.js`'s command allowlist (`config.js:36-39`) plus a `cmdConfigMigrate` beside `cmdConfigInit`. If the fallback proves to leave repos stranded, that follow-up is where it goes.
- **Removing the root-path fallback.** Excluded because a removal window is its own deliberate decision with its own blast radius, and the repo's precedent is that legacy config names still throw loudly long after the rename (`shared-infra.js:492`). Extension point: delete the deprecated entry from the name list passed to `findNamedIn`, and promote the deprecated-tier finding in `faff config check` from `warn` to `error`.
- **FAFF-1299's `.faff/.gitignore` writer itself.** Excluded because FAFF-1299 owns it. This change only adds two carve-out lines to the pattern set FAFF-1299 established. Extension point: `FAFF_FAFFDIR_GITIGNORE_PATTERNS` (or whatever FAFF-1299 names its new set) in `gitignore-ensure.js`.
- **FAFF-1300's move of template overrides to `.faff/templates/`.** Excluded because it is a sibling ticket with its own constants (`adr.js:462`, `native-map.js:46`) and its own resolver decision. The two changes share only FAFF-1299's carve-out mechanism. Extension point: the `tracking.templates_path` key FAFF-1300 adds.
- **A configurable config-file location.** Excluded because nothing asked for it and it would reintroduce the hand-resolution this chain is removing. Extension point: the name list passed to `findNamedIn`, if a future ticket ever wants it operator-supplied.
- **Rewriting historical records.** Specs under `records/specs/` keep the filenames they were written with. This is not an extension point; it is a prohibition.

## 3. WHAT

### Vocabulary

| Term | Definition |
|---|---|
| base config | The committed, shareable config document. Today `.faffrc.yaml` at the repo root; after this change `.faff/config.yaml`. |
| overlay | The gitignored, machine-local config document deep-merged over the base. Today `.faffrc.local.yaml`; after this change `.faff/config.local.yaml`. |
| example template | The committed, never-loaded documentation file. Today `.faffrc.example.yaml`; after this change `.faff/config.example.yaml`. |
| preferred tier | The new path under `.faff/`. Resolved first, reported as current. |
| deprecated tier | The old root path. Resolved only when the preferred path is absent. Fully valid, reported with a migration remedy. |
| legacy tier | `.faffrc`, `.faffrc.yml` and their overlay equivalents. Still a loud throw, unchanged. |

### Filename constants

The four constants in `shared-infra.js` become five, and the two scalars become ordered lists.

```
CONSTANT CANONICAL_CONFIG         = ".faff/config.yaml"          # was ".faffrc.yaml"
CONSTANT DEPRECATED_CONFIG        = [".faffrc.yaml"]             # new: preferred-after, valid
CONSTANT LEGACY_CONFIG            = [".faffrc.yml", ".faffrc"]   # unchanged

CONSTANT CANONICAL_OVERLAY_CONFIG  = ".faff/config.local.yaml"   # was ".faffrc.local.yaml"
CONSTANT DEPRECATED_OVERLAY_CONFIG = [".faffrc.local.yaml"]      # new
CONSTANT LEGACY_OVERLAY_CONFIG     = [".faffrc.local.yml", ".faffrc.local"]  # unchanged

CONSTANT CANONICAL_EXAMPLE_CONFIG  = ".faff/config.example.yaml" # new named constant
```

Every name is a repo-relative POSIX path. `path.join(base, name)` handles the embedded separator, and the CLI already refuses to run on win32 (`cliPosixGuard`), so a forward slash in a constant is safe.

**Chosen:** `.faff/config.yaml` for the committed base, `.faff/config.local.yaml` for the ignored overlay, `.faff/config.example.yaml` for the committed template. Rationale: the `faffrc` stem is redundant inside a directory already named for the product. Human decision, 2026-10-15.

### Resolver interface

`findNamedIn` grows a second name list and returns a location record instead of a bare path. Its two wrappers keep returning a bare path, so the roughly two dozen existing `findConfig` / `findOverlay` call sites are untouched.

```
RECORD ConfigLocation:
  path: AbsolutePath          # the resolved file
  name: RelativePath          # the constant it matched, e.g. ".faff/config.yaml"
  tier: "canonical" | "deprecated"

FUNCTION findNamedIn(base, canonicalName, deprecatedNames, legacyNames, errorTag) -> ConfigLocation | null
FUNCTION findConfigLocation(root)  -> ConfigLocation | null      # worktree-aware, new
FUNCTION findOverlayLocation(root) -> ConfigLocation | null      # worktree-aware, new
FUNCTION findConfig(root)  -> AbsolutePath | null                # unchanged signature
FUNCTION findOverlay(root) -> AbsolutePath | null                # unchanged signature
FUNCTION isInsideRoot(root, p) -> Boolean                        # new, pure path comparison
```

**Detecting the losing tier.** `ConfigLocation` describes the winner only, so nothing in it tells `config check` that a stale file exists at the other tier. The duplicate-location finding therefore takes one additional input, computed in `cmdConfigCheck` beside the other filesystem facts and threaded into the pure core: `staleBasePath` and `staleOverlayPath`, each the absolute path of a present-but-losing deprecated-tier file or `null`. This is an existence test, not a second resolution, so it does not compete with the one-home principle: the question "which file do we read" still has exactly one answer from the resolver, and this asks the different question "is there a file we are deliberately not reading". A builder must not satisfy the duplicate finding by calling the resolver twice or by reaching past it.

`isInsideRoot` is the one home for the inside-root test this change needs twice: the writers use it to decide whether to edit the resolved file in place, and `faff config check` uses it to decide whether git can be asked about that file at all. Both callers face the same hazard from the same cause, the main-worktree fallback, so the test is written once and exported, never spelled out at each site. It resolves both arguments and compares path prefixes on a separator boundary; it touches no file system.

**Chosen:** grow `findNamedIn` to take an ordered `deprecatedNames` list and return a `ConfigLocation` record, and add `findConfigLocation` / `findOverlayLocation` as the tier-aware public entry points, leaving `findConfig` / `findOverlay` returning a bare path exactly as they do now.

Rationale, and the alternatives rejected:

| Option | Why not chosen |
|---|---|
| Change `findConfig` / `findOverlay` to return the record | Breaks every call site in `bin/lib` (`loadConfig`, `budget.js`, `engine.js`, `validate-adapters.js`, and roughly twenty more). The reporting surfaces that need the tier are three commands; the readers that need only a path are everything else. |
| Fold the deprecated name into the existing `legacyNames` argument with a severity flag | Makes the loud-throw list conditional, which is precisely the discipline that exists because silent fallback dropped configured slots twice. A list whose meaning depends on a flag invites the next change to flip the flag. |
| A second resolver function for the deprecated tier, called by each caller | Two copies of the precedence rule, which the one-home principle forbids, and the exact drift `findNamedIn` was extracted to prevent. |

`findConfigIn`, `findOverlayIn` and `findNamedIn` are exported from `shared-infra.js` but have no consumers outside that module, so their shape can change freely.

### The `.example` skip

`findNamedIn` begins each candidate test with `!n.includes(".example")` (`shared-infra.js:503`), which is why the kernel documents that any name containing `.example` is never counted or loaded.

**Chosen:** keep the `.example` skip byte-for-byte unchanged, and verify in the resolver's test that it still holds. The new names collide with it in neither direction: `.faff/config.yaml` and `.faff/config.local.yaml` contain no `.example` substring, so they resolve normally, and `.faff/config.example.yaml` is never passed to `findNamedIn` as a candidate, so the skip never has to reject it. The skip stays as belt and braces against a future candidate name, and as the mechanical backing for the kernel's documented exemption.

### The example file's own resolution path

`config.js:2175` reaches the example template for the `WRITABLE_NAMESPACES` drift check by walking up from the module's own directory: `path.join(__dirname, "..", "..", "..", "..", "..", ".faffrc.example.yaml")`. That walk lands on the faff repo root (`bin/lib` to `bin` to `faff` to `skills` to `plugin` to root), and the surrounding `try` turns an unreadable file into a `check(..., false)` failure rather than a silent skip.

**Chosen:** keep the `__dirname` walk and append the new location, as `path.join(__dirname, "..", "..", "..", "..", "..", CANONICAL_EXAMPLE_CONFIG)`, with the filename supplied by the new constant rather than a literal. Rationale: the walk resolves through the dev-install symlink to the real faff repo, which `findRoot()` from the current working directory would not do when the CLI is invoked from an adopting repo. Replacing the walk with `findRoot()` would turn the drift check into a failure for every adopter running `faff config set --selftest`. Keeping the walk and taking the filename from the constant fixes the break without changing where the check looks.

### Decision: where the migration notice goes

A migration notice must reach the operator without corrupting any caller.

| Option | Where it fires | Why not chosen |
|---|---|---|
| Resolver writes to standard error on every resolution | Every `faff config get`, every governance read | The gateway preamble resolves config many times per session, so the same line repeats without adding information. It would also fire inside the roughly ninety test files and thirty-three library selftests that write a root-named config fixture into a temporary directory, turning a location notice into pervasive test noise. |
| Resolver writes to standard error once per process, behind a latch | Once per CLI invocation | Better, but still fires in every fixture-driven selftest, and a module-level latch is state in a module that is otherwise pure resolution. |
| A `--json` field only | `config path --json` | `faff config path` has no `--json` flag today, and adding one to carry a notice makes the notice invisible to the human-readable form that `/faff-onboard` and operators actually use. |

**Chosen:** the resolver stays silent and pure, returning the tier; the notice is printed to standard error by the three surfaces whose job is reporting config posture (`faff config path`, `faff config resolved`, `faff config check`) and by the three writers (`faff config init`, `set`, `unset`). Nothing is added to standard output anywhere, and no notice fires on an ordinary `faff config get`.

Rationale, including the comparison the ticket asked for. The existing `FAFF_CONFIG_BASE_LENIENT` warning in `readBaseConfigStrict` (`shared-infra.js:697`) deliberately fires on every read, and that is right for *that* fault: the hatch is armed, the base parsed to nothing, and every budget and sentry ceiling the run depends on has silently degraded to a built-in default. Repetition is proportionate to a wrong value in play. Here no value is wrong. The deprecated tier resolves the identical merged document from a different path, so the only thing the operator needs is a one-time instruction to tidy the location, which belongs on the surfaces the kernel already tells operators to run (`faff config check` before committing the base) and the surface every run banner already prints (`faff config resolved`, which prints each resolved path on standard output, so the old location is visible in the banner by the path alone).

The honest cost: a repo that never runs `config check`, never reads a run banner and never writes a config key never sees the notice. It also never breaks. That is the trade this decision takes.

The notice text names both exact commands, for whichever files are on the deprecated tier:

```
faff: base config resolved from the deprecated location .faffrc.yaml
      (faff now uses .faff/config.yaml). Resolution and values are unchanged.
      To migrate:  git mv .faffrc.yaml .faff/config.yaml
faff: overlay resolved from the deprecated location .faffrc.local.yaml
      (faff now uses .faff/config.local.yaml). Resolution and values are unchanged.
      To migrate:  mv .faffrc.local.yaml .faff/config.local.yaml
      (plain mv, not git mv: the overlay is untracked and may hold machine-local values.)
```

### Decision: the notice's remedy must not un-ignore the overlay

Printing a move command is itself a decision about the destination's ignore posture, and a tier test alone does not know that posture. `gitignoreEnsure` is append-only (`gitignore-ensure.js:13-48`), so a repo onboarded before FAFF-568 added the `.faff/*` line, or carrying a hand-written root `.gitignore`, can hold the four `.faffrc` lines (whose `.faffrc.*.yaml` glob covers the overlay) and no `.faff/*` line at all. Following faff's own printed `mv` in that repo lands `.faff/config.local.yaml` untracked and unignored, one `git add -A` away from a commit, and that is the file this spec says can hold a private tailnet host. The base has the mirror-image fault: with `.faff/*` present but FAFF-1299's `.faff/.gitignore` absent, the destination of `git mv .faffrc.yaml .faff/config.yaml` is ignored, so the base lands uncommittable.

I verified all three states with the real git binary in a throwaway repository on 2026-10-15:

| Root `.gitignore` | `.faff/.gitignore` | `.faff/config.local.yaml` | `.faff/config.yaml` |
|---|---|---|---|
| the four `.faffrc` lines only | absent | not ignored, which is the hazard | not ignored |
| plus `.faff/*` | absent | ignored | ignored, so the base is uncommittable |
| plus `.faff/*` | FAFF-1299's carve-out | ignored | not ignored, which is correct |

**Chosen:** `print_location_notice` takes an ignore probe and asks it about the destination before printing the move. When the destination's posture is wrong for the role (an overlay destination that is not ignored, or a base destination that is), the notice names `faff gitignore-ensure` as the first step and the move as the second. One command closes both faults, because it appends `.faff/*` to the root set and writes FAFF-1299's `.faff/.gitignore` carve-out in the same run. When no probe is available, outside a git repo, the notice prints the move alone and unchanged, because there is no ignore policy to get wrong.

This does not reopen the fallback-only migration decision: faff still moves nothing, and the operator still runs the move by hand. The change is which commands the printed remedy lists, and in what order.

This repository is not itself an instance of the overlay half, although its root `.gitignore` is hand-written: the `.faffrc.local.*` glob at line 32 sits alongside a `.faff/*` line at line 36, so the overlay destination here is already ignored. It is an instance of the base half, because `git check-ignore -q .faff/config.yaml` exits 0 here until FAFF-1299's `.faff/.gitignore` exists, which is exactly what the `**Assumes:**` below stops the build agent walking into.

### Decision: which file a writer targets

Each of `cmdConfigInit`, `cmdConfigSet` and `cmdConfigUnset` currently computes two things independently: `targetName` from the constants, and `existingPath` from `findConfig` / `findOverlay` (`config.js:1417-1419`, `:1722-1724`, `:1919`). It reads `existingPath` and writes `canonicalPath`. Once the two can differ by tier, that split silently half-migrates: `faff config set` on an unmigrated repo would read the root `.faffrc.yaml`, merge into it, and write the result to `.faff/config.yaml`, leaving two base configs where the new one wins and the old one is a stale orphan nobody edited.

**Chosen:** a writer targets the file the resolver actually resolved, when that file lies inside the root the command is operating on; otherwise it targets the canonical new path under that root.

```
PROCEDURE resolve_write_target(root, local):
  1. location <- local ? findOverlayLocation(root) : findConfigLocation(root)
     (may throw the legacy-name error; do not catch here, cmdConfig's catch owns it)
  2. IF location is null:
     a. target <- join(root, local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG)
  3. ELSE IF isInsideRoot(root, location.path):
     a. target <- location.path                  # edit in place, whatever tier it is
  4. ELSE:                                       # resolved via the main-worktree fallback
     a. target <- join(root, local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG)
  5. Create target's parent directory if absent (recursive)
  6. RETURN { target, existingPath: location ? location.path : null, tier: location ? location.tier : "canonical" }
```

Step 4 is not an afterthought. `findConfig` already falls back to the main checkout's config from a linked worktree (`shared-infra.js:585`), and today a `faff config set` run in a linked worktree writes to the worktree's own root, not the main checkout's. Targeting `location.path` unconditionally would start writing into the main checkout from inside a build worktree, which is a worse bug than the one being fixed. The inside-root test preserves today's behaviour exactly, and the posture half of `faff config check` needs the identical test for the identical reason, which is why `isInsideRoot` is exported rather than inlined here.

**Anti-pattern:** writing to the canonical new path while reading the deprecated one. Why: it produces two base configs with no operator action, which is both the silent migration the human's decision forbids and a split-brain where a later hand edit to the old file does nothing.

**Anti-pattern:** calling `fs.writeFileSync` on the new path without creating `.faff/` first. Why: `.faff/` does not exist in a repo that has never run a faff command, and `faff config init` is precisely the command that runs there. Use a recursive parent-directory create, as `native-map.js:256` already does for its own directory.

### Decision: what `faff config check` reports

Three things change in `computeConfigCheck`, plus one latent bug the move exposes.

**The latent bug.** `computeConfigCheck` derives the relative path it hands to the git probes with `rel = (p) => path.basename(p)` (`config.js:2520`), then calls `probes.isIgnored(baseRel)` and `probes.isTracked(baseRel)`. That works today only because the basename of a root-level file is its repo-relative path. With the base at `.faff/config.yaml`, `path.basename` yields `config.yaml`, and the probes would run `git check-ignore config.yaml` and `git ls-files config.yaml` against a path that does not exist, so the posture check would report nonsense.

**The trap in the obvious fix.** `path.relative(root, p)` alone is not enough. `cmdConfigCheck` takes `basePath` from `findConfig(root)` (`config.js:2614`), and `findConfig` falls back to the main checkout's file from a linked worktree (`shared-infra.js:585`). In that state `path.relative` yields `../../<main>/.faff/config.yaml`, which git refuses outright: I ran both probes from a linked worktree on 2026-10-15 and each exits 128 with `fatal: ../main/.faffrc.yaml is outside repository at <worktree>`. `gitIsIgnored` and `gitIsTracked` both test `status === 0`, so both return false, `probes.isIgnored(baseRel) || !probes.isTracked(baseRel)` is therefore true, and the base-posture warn fires spuriously naming a path no operator can act on. Today's `path.basename` dodges this by accident, by handing git a path that is merely wrong rather than out of tree. This is not hypothetical: `faff config check` runs inside linked build worktrees, which is where graft runs it.

**Chosen:** compute the probe path as `path.relative(root, p)` with POSIX separators, thread `root`, `staleBasePath` and `staleOverlayPath` into `computeConfigCheck`'s input object, and gate each file's posture probes on `isInsideRoot(root, p)`, the same predicate `resolve_write_target` uses at step 3. When a config file resolved from outside the operating root, its posture probes are not run at all: `computeConfigCheck` pushes a `skipped` entry naming the file and the reason, exactly as it already does for "not a git repo" (`config.js:2549`), and that file's non-posture findings (the secret scan, the known-key lint, the legacy-tree check) carry its absolute path as their `surface`, because it has no repo-relative path in this checkout. Rationale: the probes need the path git understands, a finding that names `.faff/config.yaml` rather than `config.yaml` is the more useful message, and a file in another checkout has no posture this checkout can report. Skipping and saying so is the honest answer, and it reuses the `skipped` channel the command already has. The pure core stays pure: `root` is a string input like the rest, and `isInsideRoot` is a path comparison with no file-system access.

**The literal cluster inside `computeConfigCheck`.** The same function hardcodes the two root filenames ten times across seven lines, which I enumerated in the emit on 2026-10-15: `config.js:2524` (Check 5's message, both names), `:2531` twice (Check 1b's null-path fallback and its `git checkout` remedy), `:2553` and `:2554` (the secret scan's fallback labels), `:2590` and `:2591` (the known-key lint's fallback labels), and `:2595` twice (Check 10's fallback pair). Eight are null-path fallback labels that a constant substitution fixes. Two are message bodies that it does not: Check 5's legacy-name finding tells the operator "faff uses only `.faffrc.yaml` / `.faffrc.local.yaml`; rename it", which after this change names the deprecated tier as canonical, and Check 1b's malformed-base remedy prints `git diff / git checkout .faffrc.yaml`, naming a file that may not be there.

**Chosen:** take all ten from `CANONICAL_CONFIG` and `CANONICAL_OVERLAY_CONFIG`, and rewrite the two message bodies. Check 5 becomes "faff reads `.faff/config.yaml` / `.faff/config.local.yaml` (the root `.faffrc.yaml` and `.faffrc.local.yaml` names are still read, but deprecated); rename it." Check 1b's remedy names the resolved base path it already holds rather than any literal. Rationale: each finding's `surface` is pinned by a DONE item, but a message body is not, and the one finding whose entire job is telling an operator which filenames faff accepts is the worst place in the codebase to leave a stale literal. The DONE items below therefore assert on message text, not only on `surface`.

**The duplicate-location finding.** When both tiers exist for the same role, the new path wins and the duplicate is reported.

```
FINDING duplicate base config:
  severity: "warn"
  surface:  ".faff/config.yaml"
  message:  "two base configs present: .faff/config.yaml (in use) and .faffrc.yaml
             (ignored). Values come only from .faff/config.yaml. Remove the stale
             file: git rm .faffrc.yaml"
```

The overlay form is the same with the overlay paths and `rm` in place of `git rm`, because the overlay is untracked.

**The deprecated-location finding.** When only the deprecated tier exists, a `warn` finding carries the same text as the migration notice above, including the exact command.

**Chosen:** both the duplicate finding and the deprecated-location finding are severity `warn`, never `error`. Rationale: the kernel states that `faff config check` is advisory everywhere in faff, warn and never block, and a correct, fully resolving config on an old path is not an error. The command's exit code is already 1 whenever any finding exists (`config.js:2601`), so a warn is still visible to a script.

**What a correctly-migrated repo reports.** The ticket asked for this to be worked through, because the base-posture check's meaning shifts.

| Repo state | `git check-ignore .faff/config.yaml` | `git ls-files .faff/config.yaml` | What `config check` reports |
|---|---|---|---|
| Migrated, `.faff/.gitignore` present, base committed | not ignored (`!/config.yaml` wins) | tracked | clean |
| Migrated, `.faff/.gitignore` present, base not yet committed | not ignored | untracked | existing untracked-base warn, with the updated remedy |
| Migrated, `.faff/.gitignore` absent | ignored by the root `.faff/*` line | untracked | existing ignored-base warn, which is the correct signal: FAFF-1299's carve-out is missing |
| Migrated, root `.gitignore` has a literal `.faff/` line | ignored, and `.faff/.gitignore` is never read at all | untracked | existing ignored-base warn, plus FAFF-1301's posture finding |
| Migrated overlay at `.faff/config.local.yaml` | ignored by `/*` | untracked | clean, because the overlay check wants it ignored |

I verified rows one, three and four empirically in a throwaway repository on 2026-10-15. With root `.gitignore` carrying `.faff/*` and `.faff/.gitignore` carrying `/*`, `!/.gitignore`, `!/config.yaml`, `!/config.example.yaml`: `git check-ignore -v` reports the base not ignored via `.faff/.gitignore:3:!/config.yaml`, the example not ignored via `:4`, and the overlay ignored via `:1:/*`. With a literal `.faff/` root line instead, git never descends and reports all three ignored via the root line, which extends FAFF-1301's hazard from anchors to the config file itself.

So a correctly-migrated repo is clean, and each warn it can produce names a real missing piece.

The existing `MIGRATION_STEPS` remedy (`config.js:2479`) names `.faffrc.local.yaml` and `.gitignore` in its three lines. Those lines become `.faff/config.local.yaml` and `.faff/.gitignore`, and the step that says "drop the `.faffrc.yaml` line" is no longer meaningful because faff no longer adds that line; it becomes "ensure `.faff/.gitignore` carries `!/config.yaml`".

### Decision: the `.faff/.gitignore` carve-out lines

FAFF-1299 establishes `.faff/.gitignore` with an anchored `/*` plus negations. This change adds two negations to that set and removes four lines from the root set.

| Pattern set | Change |
|---|---|
| `.faff/.gitignore` set (FAFF-1299's) | add `!/config.yaml` and `!/config.example.yaml`, after the `/*` line, because git honours a negation only after the matching ignore line. The overlay needs no line: anchored `/*` already ignores it. |
| `FAFF_GITIGNORE_PATTERNS` (root `.gitignore`) | remove `.faffrc`, `.faffrc.yml`, `.faffrc.*.yaml` and `!.faffrc.example.yaml`. |
| `FAFF_GITIGNORE_PATTERNS_LOCAL` (`.git/info/exclude`) | remove the same four plus `.faffrc.yaml`, leaving the wholesale `.faff/` entry, which already covers both new config files. |

Removing entries from a pattern set never removes lines from an existing repo's file: `gitignoreEnsure` is append-only by design (`gitignore-ensure.js:13-48`), so a repo that already has the four `.faffrc` lines keeps them, and a newly onboarded repo never gets them. `gitignoreEnsure` also returns without writing when nothing is missing (`gitignore-ensure.js:108`), so a pattern set that has become empty is a clean no-op with no stray header line.

**Assumes:** FAFF-1299 has landed, so `.faff/.gitignore` exists as an output of `gitignore-ensure` with an anchored `/*` plus a negation list, and the `.faff/*` entry in the root set has been dealt with by FAFF-1299 rather than by this change. The build agent validates this before starting, by reading `gitignore-ensure.js` and confirming that a `.faff/.gitignore` pattern set exists, that `gitignoreEnsureSelftest` covers it, and that `.faff/.gitignore` is present **and tracked** in this repository. Tracked matters as much as present: an untracked carve-out file is absent from every fresh clone, so the base config would be ignored by the root `.faff/*` line there and `faff config check` would warn on it forever. If FAFF-1299 has not landed, this ticket cannot deliver its first acceptance criterion (a newly onboarded repo with no faff lines in its root `.gitignore`), because the base config would be ignored by the root `.faff/*` line and could not be committed; stop and escalate rather than writing a second `.faff/.gitignore` writer here.

### Decision: how `--local` mode keeps its meaning

`gitignore-ensure --local` writes a deliberately wider set to `.git/info/exclude`, ignoring `.faff/` wholesale with no anchors carve-out, because a personal exclude file has no committed subtree to protect (`gitignore-ensure.js:58-61`). Once the base config lives inside `.faff/`, that wholesale ignore covers the base config too, and the question is whether FAFF-1299's `.faff/.gitignore` carve-out would override it and make the base committable again against `--local`'s intent.

**Chosen:** no change is needed, because a directory-shaped exclusion in `.git/info/exclude` wins. I verified this on 2026-10-15: with `.faff/` in `.git/info/exclude` and `.faff/.gitignore` carrying `!/config.yaml`, `git check-ignore -v .faff/config.yaml` reports `.git/info/exclude:1:.faff/`. Git never descends into an excluded directory, so it never reads `.faff/.gitignore` at all, which is the same mechanism behind FAFF-1301's hazard. `--local` mode therefore keeps ignoring faff's base config wholesale, exactly as it does today when `.faffrc.yaml` is in the local set. `faff config check`'s ignored-base warn fires in `--local` mode after this change for the same reason it fires before it, so that surface's meaning is unchanged too.

### Decision: how the overlay is kept out of a commit

"No migration path ever stages the overlay for commit" is the acceptance criterion with teeth. With migration being fallback-only, no faff code path touches the overlay at all, so the exposures are two: an operator running `git mv` on the overlay by mistake, and the overlay landing at a path that `.faff/.gitignore` does not in fact ignore.

**Chosen:** make the second exposure mechanically checkable with a test that asks git, and defuse the first in the notice text. Concretely:

- A test builds a throwaway repository with the root `.gitignore` and `.faff/.gitignore` that `gitignoreEnsure` writes, creates `.faff/config.yaml`, `.faff/config.local.yaml` and `.faff/config.example.yaml`, then asserts via the real git binary that `git check-ignore -q .faff/config.local.yaml` exits 0, that the same call for `.faff/config.yaml` and `.faff/config.example.yaml` exits 1, and that `git status --porcelain` lists the base and the example but never the overlay.
- The same test adds the **migrating-repo** state, which is the only state in which the printed remedy can do harm: a `mkdtemp` repository whose root `.gitignore` carries just the four `.faffrc` lines and no `.faff/*` line, standing in for a repo onboarded before FAFF-568 or with a hand-written file. It asserts that `git check-ignore -q .faff/config.local.yaml` exits 1 there, that `print_location_notice` in that state names `faff gitignore-ensure` ahead of the `mv`, and that after a real `gitignoreEnsure` run the same `check-ignore` call exits 0.
- The migration notice for the overlay prints `mv`, never `git mv`, and says why in the same breath (the overlay is untracked and may hold machine-local values).

Rationale: the only durable guarantee here is git's own answer about its own ignore rules, and an assertion about a hand-written pattern string would pass while the rules did the opposite. Covering only the freshly-written `gitignoreEnsure` output would test the single state in which no migration ever happens, which is why the migrating-repo state is part of the criterion rather than an extra. The equivalent test for FAFF-1299's patterns already runs against a real `mkdtemp` repository (`test/impure/gitignore-ensure-set.test.mjs`), so all of this belongs beside it.

### Decision: worktree behaviour

`setup-worktree.sh:127` copies gitignored config files from the invoking checkout into a new linked worktree, skipping any path the worktree already tracks. That skip is FAFF-532's fix: `git worktree add` already materialises tracked paths at the worktree's own ref, so copying over a tracked base config would clobber good own-ref content with the invoking checkout's possibly divergent copy.

**Chosen:** add `.faff/config.yaml` and `.faff/config.local.yaml` to the copy list in `setup-worktree.sh:127`, keeping the root names in the list as well, and change nothing else in that script. The existing per-file `git ls-files --error-unmatch` test self-corrects across every repo state without modification:

| Repo state | Worktree outcome |
|---|---|
| Migrated base at `.faff/config.yaml`, committed | tracked at the worktree ref, so skipped, so FAFF-532's clobber fix holds unchanged |
| Overlay at `.faff/config.local.yaml` | untracked, so copied, and `mkdir -p` in the loop creates `.faff/` in the worktree |
| Unmigrated repo on the deprecated tier | root names still in the list, so behaviour is byte-for-byte what it is today |
| Neither location present in the worktree | `findConfig` / `findOverlay` fall back to the main checkout per file (`shared-infra.js:585,598`), as they do today |

The fact that `.faff/` is itself largely gitignored does not interfere: the copy loop tests trackedness per file, not ignoredness, and the script's own comment explains why that is the right question. The one thing to confirm during the build is that the loop's `mkdir -p "$WORKTREE_PATH/$(dirname "$f")"` runs before the `cp`, which it does (`setup-worktree.sh:137`).

Mixed tiers across the pair are valid and need no special handling: `findConfig` and `findOverlay` resolve independently by design (`shared-infra.js:590-593`), so a repo whose base has migrated but whose overlay has not resolves the base from `.faff/config.yaml` and the overlay from `.faffrc.local.yaml` and merges them exactly as before.

### Decision: what happens to the existing test and selftest fixtures

Roughly ninety test files and thirty-three library modules write a root-named `.faffrc.yaml` into a temporary directory as a fixture. Every one of them keeps working through the deprecated tier.

**Chosen:** leave the existing root-named fixtures alone, except where an assertion is about a path or a message that this change alters. Rationale: the silent-resolver decision above is exactly what makes this possible, and the fixtures then double as live coverage of the deprecated tier across the whole suite rather than as ninety files of churn. The fixtures that do need changing are the ones whose assertions this change invalidates:

| Site | Change |
|---|---|
| `.github/workflows/validate.yml:93` | copies the example template to `$tmp/.faffrc.yaml` as a fixture; point it at the new example path and the new base path. |
| `verification/external-verification/scaffold-*.sh` (four scaffolders) | write a `.faffrc.yaml` here-doc into generated repos under test; move those here-docs to `.faff/config.yaml` with a `mkdir -p .faff` first. |
| `test/scaffolder-cli-surface-drift.test.mjs:177,209,245` | parses those here-docs; update the parse targets alongside the scaffolders it guards. |
| `test/lights-out.test.mjs:675,703` | assert remedy strings naming `.faffrc.local.yaml`; the remedies move to the new overlay path. |
| `plugin/skills/faff/bin/lib/lights-out.js:288,296` | the two hardcoded `.faffrc.local.yaml` literals in those remedies become `CANONICAL_OVERLAY_CONFIG`, so they cannot drift again. |
| `plugin/skills/faff/bin/lib/engine.js:318` | its message says "fix the `.faffrc.yaml` at the repo root"; the path comes from the constant, so only the words "at the repo root" need removing. |
| `test/onboard-local.test.mjs` | covers `/faff-onboard`'s local-mode branch that tests whether the base is git-tracked; retarget to the new base path. |

### Decision: faff's own repository migrates in the same change

This repository is its own adopter: `.faffrc.yaml` and `.faffrc.example.yaml` are tracked, and `.faffrc.local.yaml` exists untracked on each operator's machine.

**Chosen:** migrate the tracked files in this change, with `git mv .faffrc.yaml .faff/config.yaml` and `git mv .faffrc.example.yaml .faff/config.example.yaml`, and leave each operator's overlay to a hand `mv` that the migration notice prints. Rationale: the first acceptance criterion is only demonstrable end to end in a repo that has actually migrated, and the self-hosting repo is the one repo the build agent can migrate. The overlay stays an operator step because it is untracked, machine-local, and the human's decision is that faff never moves it.

This repository's root `.gitignore` is hand-written rather than `gitignoreEnsure`'s output, and append-only means it keeps its existing `.faffrc.local.*` glob. No root `.gitignore` edit is required here, and none should be made: the glob keeps covering any operator who has not yet moved their overlay.

### Decision: the hand-read lint must learn the new paths

`validate-adapters.js:1002` enforces CLI-only config access across every `SKILL.md` with `HANDREAD = /\b(?:cat|head|tail|less|grep|sed|awk)\b[^\n]*\.faffrc(?:\.ya?ml)?\b/`. That regex matches only the `.faffrc` stem, so after the move a skill that shell-reads `.faff/config.yaml` would pass the lint silently.

**Chosen:** extend `HANDREAD` to match the new paths as well as the old, keeping both so the lint still catches a hand-read of a deprecated-tier file. The `.example` line skip just above it (`validate-adapters.js:1009`) needs no change and correctly exempts a prose mention of `.faff/config.example.yaml`. Rationale: this lint is the mechanical half of the rule the kernel calls load-bearing, and the whole reason the rule exists is that hand-reading dropped configured slots twice. A rename that quietly disarms it is the worst possible outcome of this ticket.

### Prose that names config paths

| File | What changes |
|---|---|
| `plugin/skills/faff/references/kernel.md:31-33` | the Configuration section says the two-file model lives "at the repo root"; it becomes `.faff/config.yaml` plus `.faff/config.local.yaml` under `.faff/`, with the deprecated root names named once as a still-supported fallback and the legacy names still described as a loud error. The schema block's `# .faffrc.yaml, faff configuration, repo root` comment changes with it. |
| `plugin/skills/faff-onboard/SKILL.md` | the description line, the no-config framing at `:8`, the exit-2 legacy branch at `:60`, the local-mode tracked-base branch at `:63`, the dry-run text at `:107-108`, the gitignore step at `:145,148`, and the reporting lines at `:156,158`. |
| `docs/guide/cli.md` | every `.faffrc.yaml` / `.faffrc.local.yaml` mention in the config-command documentation. |
| `plugin/skills/faff/references/tracker.md`, `methodology.md`, `autonomous.md`, `build.md`, `review.md` | the `.faffrc` mentions each carries, retargeted. |
| `.faff/config.example.yaml` (the moved template) | its own header at lines 1 to 19 and its overlay note at line 397 document the two-file model by filename. |

Public documentation under `docs/` uses SuperDomestique for the product and Commissaire for its governance system; `faff`, `.faff/`, `.faff/config.yaml` and the CLI verbs stay literal, because they are current technical identifiers.

## 4. HOW

### Architecture

Three layers, in dependency order.

```
shared-infra.js        five filename constants + findNamedIn (three tiers)
                       + findConfigLocation / findOverlayLocation (tier-aware)
                       + findConfig / findOverlay (bare path, unchanged signature)
        |
        +-- readers (loadConfig, budget, engine, validate-adapters, ~20 more)
        |      unchanged: they call findConfig / findOverlay and get a path
        |
        +-- config.js writers (init, set, unset)
        |      call findConfigLocation / findOverlayLocation, target per the
        |      resolve_write_target procedure, create the parent directory,
        |      print the notice on a deprecated tier
        |
        +-- config.js posture surfaces (path, resolved, check)
               call findConfigLocation / findOverlayLocation, print the notice,
               and in check's case emit the duplicate / deprecated findings

gitignore-ensure.js    two carve-out lines added to FAFF-1299's .faff/ set,
                       four lines removed from the root set, five from the local set

setup-worktree.sh      two paths added to the copy list
validate-adapters.js   HANDREAD regex extended
```

### Resolution, in full

```
PROCEDURE findNamedIn(base, canonicalName, deprecatedNames, legacyNames, errorTag):
  1. isFile(n) := n does not contain ".example"
                  AND join(base, n) exists AND is a regular file
  2. legacy := legacyNames filtered by isFile
  3. IF legacy is non-empty:
     a. THROW Error(errorTag) with .legacy = legacy        # unchanged, loud
  4. IF isFile(canonicalName):
     a. RETURN { path: join(base, canonicalName), name: canonicalName, tier: "canonical" }
  5. FOR each n in deprecatedNames, in order:
     a. IF isFile(n): RETURN { path: join(base, n), name: n, tier: "deprecated" }
  6. RETURN null
```

Step 3 runs before step 4, unchanged from today: a legacy-named file present alongside a perfectly good new-path config is still a loud throw, because the operator has a file faff will never read and needs to know.

```
PROCEDURE findConfigLocation(root):
  1. here := findNamedIn(root, CANONICAL_CONFIG, DEPRECATED_CONFIG, LEGACY_CONFIG, "legacy-config-name")
  2. IF here is not null: RETURN here
  3. mainRoot := mainWorktreeRoot(root)
  4. IF mainRoot exists AND mainRoot is not root:
     a. RETURN findNamedIn(mainRoot, CANONICAL_CONFIG, DEPRECATED_CONFIG, LEGACY_CONFIG, "legacy-config-name")
  5. RETURN null

PROCEDURE findConfig(root):
  1. location := findConfigLocation(root)
  2. RETURN location is null ? null : location.path
```

`findOverlayLocation` and `findOverlay` are the same shape with the overlay constants and the `legacy-overlay-config-name` tag, resolved independently of the base as they are today.

Note the precedence this produces across checkouts: the current checkout's deprecated-tier file beats the main checkout's canonical-tier file, because the worktree fallback only fires when the current checkout has neither tier. That is the right order. The fallback exists so a worktree missing its config copy does not silently resolve to defaults, not so one checkout's tiers can be mixed with another's.

### The notice, in full

```
PROCEDURE print_location_notice(stream, location, role, isIgnored):
  1. IF location is null OR location.tier is not "deprecated": RETURN
  2. canonical := role is "overlay" ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG
  3. command   := role is "overlay" ? "mv" : "git mv"
  4. want      := role is "overlay" ? "ignored" : "not ignored"
  5. IF isIgnored is available:                  # null outside a git repo
     a. got := isIgnored(canonical) ? "ignored" : "not ignored"
     b. IF got is not want, write to stream first:
        "faff: <canonical> is <got> by this repo's ignore rules and must be <want>.
               Run `faff gitignore-ensure` BEFORE the move below, or the move
               <role is "overlay" ? "would leave an operator-private file stageable"
                                  : "would leave the base config uncommittable">."
  6. Write to stream (never standard output):
     "faff: <role> config resolved from the deprecated location <location.name>
            (faff now uses <canonical>). Resolution and values are unchanged.
            To migrate:  <command> <location.name> <canonical>"
  7. IF role is "overlay": append the plain-mv reason
     "(plain mv, not git mv: the overlay is untracked and may hold machine-local values.)"
```

The probe is the same `gitIsIgnored(root, relPath)` helper (`config.js:2469`) that `cmdConfigCheck` already wires into its probes (`config.js:2652`), passed in rather than called from the procedure, so the notice stays testable without a git repository.

`faff config check` does not call this procedure. It emits the same text as a `warn` finding instead, so that `--json` consumers get it in the `findings` array like every other finding rather than on an unparsed stream.

### Edge cases and error handling

| Case | Behaviour |
|---|---|
| Both tiers present for the base | canonical wins; `config check` emits the duplicate warn; readers are silent |
| Both tiers present for the overlay | canonical wins; `config check` emits the duplicate warn naming `rm`, not `git rm` |
| Base on the canonical tier, overlay on the deprecated tier | both resolve, merged exactly as before, one overlay notice |
| A legacy name present alongside either tier | the legacy throw fires first, unchanged; `config check` reports it as an error finding |
| `.faff/` absent and `faff config init` runs | the parent directory is created recursively, then the file is written |
| `.faff/` exists as a regular file rather than a directory | the recursive create throws `EEXIST`/`ENOTDIR`; let it propagate to `cmdConfig`'s catch as an exit 2 rather than inventing a message, since this is a corrupt checkout |
| `.faff/config.yaml` exists but is unreadable | unchanged: `readBaseConfigStrict`'s existing loud path handles it |
| `faff config set` in a linked worktree whose config resolved from the main checkout | writes the worktree's own canonical path, as today |
| `faff config check` in a linked worktree whose config resolved from the main checkout | that file's posture probes are skipped, with a `skipped` entry naming the out-of-tree absolute path; no spurious base-posture warn and no git `fatal` |
| `faff config path` with only a deprecated-tier base | prints the deprecated absolute path on standard output, exit 0, notice on standard error |
| `faff config path` with neither tier anywhere | exit 3, unchanged, so `/faff-onboard`'s bail check is untouched |
| Root `.gitignore` carries a literal `.faff/` line | the base config is ignored and cannot be committed; `config check`'s ignored-base warn plus FAFF-1301's posture finding are the only signals, and they are enough |

### Failure modes

**The notice never reaches anyone.** The notice fires only on the posture surfaces and the writers, so a repo whose operators only ever run `faff graft` sees nothing and stays on the deprecated tier indefinitely. How you would know: nothing in the product tells you, which is the point of the risk. What it means: proceed. The deprecated tier is correct, not degraded, and the fallback's lifetime is indefinite in this slice, so staying on it is a tidiness cost rather than a fault. If a later ticket wants to close the fallback, that ticket needs a louder notice first, and that is the right place for the decision.

**The duplicate case arises from an operator's half-done `git mv`.** An operator who copies rather than moves the base ends up with two base configs, edits the old one, and sees no effect. How you would know: `faff config check` emits the duplicate warn naming which file is in use, and `faff config resolved` prints the winning path in the run banner. What it means: proceed. Both surfaces name the live file explicitly, which is the whole reason the duplicate finding is in scope.

**The `.faff/.gitignore` carve-out does not actually un-ignore the base.** If FAFF-1299's pattern order or anchoring is wrong, the base config is silently uncommittable and every adopter's config quietly becomes machine-local. How you would know: the overlay-never-staged test asserts via the real git binary that `git check-ignore` exits 1 for `.faff/config.yaml`, so a wrong pattern set fails that test rather than shipping. What it means: stop and fix the pattern set before anything else in this ticket matters.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo with no faff config anywhere and a .gitignore with no faff lines
When faff onboards it and writes a base config
Then the base config is created at .faff/config.yaml, the root .gitignore gains no
     faff lines, and `git check-ignore -q .faff/config.yaml` exits 1
```

```
Given a repo whose only base config is .faffrc.yaml at the root and whose only
      overlay is .faffrc.local.yaml at the root
When any config value is read
Then the merged document is byte-for-byte what it was before this change, standard
     output carries no notice, and `faff config path` prints both root paths while
     writing a migration notice naming `git mv` and `mv` to standard error
```

```
Given a repo whose base config is committed at .faff/config.yaml and whose overlay
      is at .faff/config.local.yaml
When `faff config check` runs
Then it exits 0 with no findings
```

```
Given a linked build worktree that carries no config of its own, whose base config
      therefore resolves to the main checkout's .faff/config.yaml
When `faff config check` runs inside that worktree
Then it emits no base-posture finding, reports that file's posture as skipped with the
     out-of-tree path named, and asks git about no path outside the worktree
```

```
Given a repo whose root .gitignore carries the four .faffrc lines and no .faff/* line,
      and whose only overlay is .faffrc.local.yaml at the root
When a surface prints the overlay migration notice
Then the notice names `faff gitignore-ensure` as the step before the `mv`, because
     `git check-ignore -q .faff/config.local.yaml` in that repo exits 1
```

- The three-tier resolver MUST add no new file-system probe per resolution beyond one existence test per deprecated name, so an unmigrated repo costs one extra `existsSync` per resolution and a migrated repo costs none.
- No code path introduced by this change MUST write to standard output.
- No code path introduced by this change MUST move, copy, stage or delete either config file.

## 6. Design decision rationale

**What are the final filenames under `.faff/`?** Options were keeping the `faffrc` stem (`.faff/.faffrc.yaml`), a `faff.yaml` stem, or dropping the stem entirely. **Chosen:** `.faff/config.yaml`, `.faff/config.local.yaml`, `.faff/config.example.yaml`, because the `faffrc` stem is redundant inside a directory already named for the product. Human decision, 2026-10-15.

**Should migration be an explicit `faff config migrate` command or a fallback only?** A command would give an interactive, reviewable `git mv`; a fallback gives zero new surface and zero staging risk. **Chosen:** fallback only, with the resolver reading the new path first and falling back to the root names while printing the exact `git mv` and `mv` commands. faff never moves the file itself, because the overlay can hold machine-local values. Human decision, 2026-10-15. If the fallback proves to leave repos stranded, a `faff config migrate` command is the follow-up, recorded under OUT OF SCOPE.

**What breaks outside the CLI, and how long does the fallback last?** **Chosen:** nothing outside the CLI resolves config by hand, and the fallback's lifetime is indefinite in this slice. `scripts/link-skills.sh:141` reads `install.skill_targets` through the bundled CLI with an explicit comment that this is deliberately not a grep or sed of the file, so it is location-agnostic by construction and needs no change; `.github/actions/governance-check/action.yml` reads no config at all. The sites that do need changing are fixture writers and assertion strings, listed in the table under "what happens to the existing test and selftest fixtures". On the fallback's lifetime, the repo's precedent is that legacy config names still error loudly long after a rename (`shared-infra.js:492`), so a removal window is its own deliberate decision rather than a detail of this one.

**How does `findNamedIn` grow to carry three tiers?** Rejected: returning the record from `findConfig` (breaks roughly two dozen readers), folding the deprecated name into the legacy list behind a flag (makes the loud throw conditional, which is the discipline that exists because silent fallback dropped configured slots twice), and a separate resolver per tier (two copies of the precedence rule). **Chosen:** a `deprecatedNames` argument and a `ConfigLocation` return on `findNamedIn`, two new tier-aware wrappers for the reporting surfaces, and unchanged signatures on `findConfig` / `findOverlay`.

**Where does the migration notice go, and how often?** Rejected: every read (repeats without adding information, and fires inside roughly ninety test files' fixtures), once per process behind a latch (still fires in every fixture-driven selftest, and puts state in a pure module), and a `--json` field only (`faff config path` has no `--json`, and the human-readable form is the one operators use). **Chosen:** silent resolver, notice on standard error from `faff config path`, `resolved`, `check` and the three writers. The contrast with `FAFF_CONFIG_BASE_LENIENT`, which fires on every read, is deliberate: that warning accompanies values that have actually degraded to defaults, where repetition is proportionate; here the values are identical and only the path is stale.

**Which file does a writer target when the resolver resolved a deprecated path?** Rejected: always the canonical new path (half-migrates silently, leaving a stale orphan the operator keeps editing) and always the resolved path (would start writing into the main checkout from inside a linked build worktree). **Chosen:** the resolved path when it lies inside the operating root, otherwise the canonical new path under that root.

**What does `faff config check` report when a config file resolved from outside the operating root?** Rejected: handing git the relative path anyway, which exits 128 (`fatal: ... is outside repository`) and reads as "ignored or untracked" through both helpers' `status === 0` test, firing a spurious base-posture warn; and handing git the absolute path, which the main checkout would answer but which makes a finding describe another checkout's posture as if it were this one's. **Chosen:** gate the posture probes on `isInsideRoot`, skip that file's posture with a `skipped` entry naming it, and let its non-posture findings carry the absolute path as `surface`. The predicate is shared with the writers, so the fallback hazard has one answer rather than two.

**Where do `computeConfigCheck`'s own `.faffrc` literals go, and is a path substitution enough?** **Chosen:** all ten take the filename from the constants, and the two that sit inside message bodies are rewritten rather than substituted, because Check 5's text would otherwise name the deprecated tier as the only accepted one and Check 1b's would print a `git checkout` for a file that may not exist. The DONE items assert on both message bodies, since `surface` pinning does not reach message text.

**Does the migration notice ask git about the destination before printing a move?** Rejected: firing on tier alone, which in a repo carrying the four `.faffrc` lines and no `.faff/*` line prints an `mv` that leaves an operator-private overlay untracked and unignored, and in a repo with `.faff/*` but no `.faff/.gitignore` prints a `git mv` that leaves the base uncommittable. **Chosen:** pass an ignore probe into the notice and, when the destination's posture is wrong for the role, name `faff gitignore-ensure` as the step before the move. One command fixes either fault. This leaves the fallback-only migration decision untouched: faff still moves nothing.

**What severity does the duplicate-location finding carry?** **Chosen:** `warn`, for both the duplicate and the deprecated-location findings, because the kernel states `faff config check` is advisory everywhere in faff, warn and never block, and a fully resolving config on an old path is not an error. The command already exits 1 on any finding, so a script still sees it.

**How is the example template found after it moves?** Rejected: resolving through `findRoot()` from the current working directory, which would make the `WRITABLE_NAMESPACES` drift check fail for every adopter running `faff config set --selftest` from their own repo. **Chosen:** keep the existing `__dirname` walk and append the new location from a named `CANONICAL_EXAMPLE_CONFIG` constant, so the check keeps looking where it looks today.

**Do the existing root-named test fixtures migrate?** **Chosen:** no, except where an assertion is about a path or message this change alters. The silent resolver makes them keep working, and they then serve as live coverage of the deprecated tier across the whole suite instead of as ninety files of churn.

**Does faff's own repository migrate in this change?** **Chosen:** yes for the two tracked files, by `git mv`; no for each operator's untracked overlay, which stays a hand `mv` the notice prints. The first acceptance criterion is only demonstrable in a repo that has actually migrated.

## 7. Open questions and assumptions

### Open questions

None. All three of the ticket's "to be determined during prep" items are closed: the filenames and the migration strategy by the human on 2026-10-15, and the blast radius from verified evidence in the repository.

### Assumptions

**Assumes:** FAFF-1299 has landed, so `.faff/.gitignore` exists as an output of `gitignore-ensure` with an anchored `/*` plus a negation list, and the root-set `.faff/*` entry has been handled by FAFF-1299 rather than here. FAFF-1299 blocks FAFF-1302 in the tracker (edge added 2026-10-15), so this ticket cannot be picked up ahead of its dependency by accident. The edge does not prove the dependency has landed, only that it is sequenced, so the build agent still validates the landing first: read `plugin/skills/faff/bin/lib/gitignore-ensure.js` and confirm that a `.faff/.gitignore` pattern set exists, that `gitignoreEnsureSelftest` covers it, and that `.faff/.gitignore` is present **and tracked** in this repository. Present alone is not enough: an untracked carve-out file does not exist in a fresh clone, where the root `.faff/*` line would then ignore the base config in every clone. If any of that is missing, stop and escalate rather than writing a second `.faff/.gitignore` writer in this ticket: without FAFF-1299's carve-out the base config at `.faff/config.yaml` is ignored by the root `.faff/*` line and cannot be committed, which defeats the first acceptance criterion outright.

## 8. DONE

### From WHY

- [ ] A repository onboarded from scratch by faff has no `.faffrc*` lines in its root `.gitignore`, asserted by a test that runs the real `gitignoreEnsure` against a `mkdtemp` root and greps the result.
- [ ] `FAFF_GITIGNORE_PATTERNS` contains none of `.faffrc`, `.faffrc.yml`, `.faffrc.*.yaml`, `!.faffrc.example.yaml`, asserted in `gitignoreEnsureSelftest`.
- [ ] `FAFF_GITIGNORE_PATTERNS_LOCAL` contains no `.faffrc`-stemmed entry and still contains `.faff/`, asserted in `gitignoreEnsureSelftest`.

### From WHAT (constants and interfaces)

- [ ] `CANONICAL_CONFIG` is `.faff/config.yaml`, `CANONICAL_OVERLAY_CONFIG` is `.faff/config.local.yaml`, `CANONICAL_EXAMPLE_CONFIG` is `.faff/config.example.yaml`, and `DEPRECATED_CONFIG` / `DEPRECATED_OVERLAY_CONFIG` are `[".faffrc.yaml"]` / `[".faffrc.local.yaml"]`.
- [ ] `LEGACY_CONFIG` and `LEGACY_OVERLAY_CONFIG` are unchanged, and a repository containing `.faffrc` or `.faffrc.yml` still throws `legacy-config-name` even when `.faff/config.yaml` is present.
- [ ] `findConfig(root)` and `findOverlay(root)` still return an absolute path or `null`, with no signature change, verified by the existing readers compiling and the existing `test/config-two-file.test.mjs` cases passing unmodified.
- [ ] `findConfigLocation(root)` and `findOverlayLocation(root)` return `{ path, name, tier }` with `tier` of `canonical` for the `.faff/` path and `deprecated` for the root path.
- [ ] `findNamedIn` still skips any candidate name containing `.example`, asserted by a case that places a file named `.faff/config.example.yaml` and confirms it is never resolved as a base config.
- [ ] `isInsideRoot(root, p)` is exported from `shared-infra.js` and is the only inside-root test introduced by this change, called by both `resolve_write_target` step 3 and `computeConfigCheck`'s posture gate, asserted by cases covering a path inside the root, a sibling path outside it, and a path whose string is a prefix of the root but not a path segment of it (`/repo-other` against `/repo`).
- [ ] `.faff/config.example.yaml` is reachable from `config.js`'s `WRITABLE_NAMESPACES` drift check, so `faff config set --selftest` passes with no `namespace-drift: could not read` failure.

### From HOW (resolution)

- [ ] With only `.faff/config.yaml` present, the base resolves to it with tier `canonical`.
- [ ] With only `.faffrc.yaml` present, the base resolves to it with tier `deprecated`, and the merged document is identical to the pre-change result for the same file contents.
- [ ] With both present, the base resolves to `.faff/config.yaml`, and a key set only in `.faffrc.yaml` does not appear in the merged document.
- [ ] The base and the overlay resolve tiers independently: a canonical base plus a deprecated overlay merges exactly as a canonical pair would.
- [ ] From a linked worktree with neither tier present, `findConfig` still falls back to the main checkout, asserted by the existing worktree cases.

### From HOW (notice and standard output)

- [ ] `faff config get <key>` on a deprecated-tier repository prints the bare scalar on standard output and nothing else on standard output.
- [ ] `faff config path` on a deprecated-tier repository prints the resolved paths on standard output and a migration notice on standard error naming `git mv .faffrc.yaml .faff/config.yaml`.
- [ ] The overlay notice names `mv`, never `git mv`, and states that the overlay is untracked and may hold machine-local values.
- [ ] `faff config path` with no config in either tier still exits 3.
- [ ] In a repository whose root `.gitignore` carries the four `.faffrc` lines and no `.faff/*` line, the overlay notice names `faff gitignore-ensure` before the `mv` and says the move would otherwise leave an operator-private file stageable.
- [ ] In a repository with `.faff/*` ignored and no `.faff/.gitignore`, the base notice names `faff gitignore-ensure` before the `git mv` and says the move would otherwise leave the base config uncommittable.
- [ ] With the destination posture already correct for the role, the notice prints the move alone, with no `gitignore-ensure` line.
- [ ] Outside a git repo, with no probe available, the notice prints the move alone and exits normally.

### From HOW (writers)

- [ ] `faff config init` in a repository with no `.faff/` directory creates `.faff/` and writes `.faff/config.yaml`, and its success line names `.faff/config.yaml`.
- [ ] `faff config init --local` writes `.faff/config.local.yaml`.
- [ ] `faff config set <key> <value>` in a repository whose base resolved from `.faffrc.yaml` writes to `.faffrc.yaml`, leaves `.faff/config.yaml` absent, and prints the migration notice on standard error.
- [ ] `faff config set` in a linked worktree whose base resolved from the main checkout writes to the worktree's own `.faff/config.yaml`, not the main checkout's file.
- [ ] `faff config unset` follows the same target rule as `faff config set`, asserted by at least one deprecated-tier case.
- [ ] No writer moves, copies, stages or deletes either config file, asserted by a case that runs `faff config set` on a deprecated-tier repository and confirms `git status --porcelain` shows only the modified deprecated file.

### From HOW (`faff config check`)

- [ ] `computeConfigCheck` receives `root` and hands the git probes a repo-relative path, so a base at `.faff/config.yaml` produces probe calls for `.faff/config.yaml`, asserted in `configCheckSelftest` with a fake probe that records its arguments.
- [ ] Every finding's `surface` for a base or overlay file **resolved inside the operating root** is the repo-relative path, not the bare basename. A file resolved through the main-worktree fallback is the stated exception and carries its absolute path, per the out-of-tree rule above; the two criteria are scoped so the worktree case satisfies both.
- [ ] With both base tiers present, `faff config check --json` contains a `warn` finding whose surface is `.faff/config.yaml` and whose message names `.faffrc.yaml` as the stale file and `git rm` as the remedy.
- [ ] With both overlay tiers present, the equivalent finding names `rm`, not `git rm`.
- [ ] With only a deprecated-tier base, `faff config check` emits a `warn` finding carrying the migration command.
- [ ] A migrated repository with a committed `.faff/config.yaml`, an ignored `.faff/config.local.yaml` and FAFF-1299's `.faff/.gitignore` present exits 0 from `faff config check` with no findings.
- [ ] `faff config check` in a linked worktree whose base resolved from the main checkout emits no base-posture finding, pushes a `skipped` entry naming that file, and calls neither git probe for it, asserted in `configCheckSelftest` with a fake probe that records its arguments and a `root` that does not contain the resolved path.
- [ ] No `surface` value and no probe argument produced by `computeConfigCheck` contains a `..` segment in any state, asserted over the worktree case's full output.
- [ ] `computeConfigCheck`'s source contains no `.faffrc` literal: all ten former occurrences take their filename from `CANONICAL_CONFIG` or `CANONICAL_OVERLAY_CONFIG`, asserted mechanically by checking `computeConfigCheck.toString()` for the `.faffrc` substring.
- [ ] Check 5's legacy-name finding **message text** names `.faff/config.yaml` and `.faff/config.local.yaml` as the names faff reads, and describes the root `.faffrc.yaml` / `.faffrc.local.yaml` names as deprecated but still read, asserted on the message body and not only on `surface`.
- [ ] Check 1b's malformed-base remedy message names the resolved base path rather than a `.faffrc.yaml` literal, asserted on the message body for a base at `.faff/config.yaml`.
- [ ] `MIGRATION_STEPS` names `.faff/config.local.yaml` and `.faff/.gitignore`, and no longer instructs the operator to drop a `.faffrc.yaml` line from the root `.gitignore`.

### From HOW (`.gitignore` carve-outs and the overlay guarantee)

- [ ] FAFF-1299's `.faff/.gitignore` pattern set contains `!/config.yaml` and `!/config.example.yaml`, both after the `/*` line.
- [ ] In a `mkdtemp` git repository carrying the real `gitignoreEnsure` output for both the root and `.faff/` targets, `git check-ignore -q .faff/config.local.yaml` exits 0, the same call for `.faff/config.yaml` and `.faff/config.example.yaml` exits 1, and `git status --porcelain` lists the base and the example but never the overlay.
- [ ] In the migrating-repo state in the same real-git test file (a `mkdtemp` repository whose root `.gitignore` carries only the four `.faffrc` lines), `git check-ignore -q .faff/config.local.yaml` exits 1 before a `gitignoreEnsure` run and 0 after it, and `git status --porcelain` never lists the overlay once that run has happened.

### From HOW (worktree)

- [ ] `setup-worktree.sh`'s copy list includes `.faff/config.yaml` and `.faff/config.local.yaml` alongside the root names.
- [ ] A tracked `.faff/config.yaml` in a linked worktree keeps its own ref's content and is logged as skipped, extending `test/impure/setup-worktree-clobber.test.mjs`'s FAFF-532 case to the new path.
- [ ] An untracked `.faff/config.local.yaml` is copied into a new linked worktree, with `.faff/` created there if absent.

### From HOW (lint and in-repo consumers)

- [ ] `validate-adapters`'s `HANDREAD` regex flags a shell read of `.faff/config.yaml` and `.faff/config.local.yaml` as well as the deprecated root names, asserted by a case over a fixture `SKILL.md`.
- [ ] `lights-out.js`'s two dial-coherence remedies take the overlay path from `CANONICAL_OVERLAY_CONFIG` rather than a literal, and `test/lights-out.test.mjs`'s two assertions match the new path.
- [ ] `engine.js`'s config-resolution failure message no longer says "at the repo root".
- [ ] `.github/workflows/validate.yml` copies the example template from its new path to the new base path.
- [ ] The four `verification/external-verification/scaffold-*.sh` scaffolders write `.faff/config.yaml` into generated repositories, and `test/scaffolder-cli-surface-drift.test.mjs` parses them at the new path.

### From HOW (prose)

- [ ] The kernel's Configuration section names `.faff/config.yaml` and `.faff/config.local.yaml`, describes the deprecated root names once as a supported fallback, and still describes `.faffrc` and `.faffrc.yml` as a loud error.
- [ ] `/faff-onboard` names the new paths in its description, its no-config framing, its bail table, its local-mode branch, its dry-run text, its gitignore step and its closing report.
- [ ] `docs/guide/cli.md` and the five `plugin/skills/faff/references/*.md` files that mention `.faffrc` name the new paths.
- [ ] `records/specs/` is unchanged by this commit, asserted by reading the diff.
- [ ] This repository's own `.faffrc.yaml` and `.faffrc.example.yaml` are moved with `git mv` to `.faff/config.yaml` and `.faff/config.example.yaml`, and `faff config path` in this repository prints the new base path.

### Integration smoke test

```
PROCEDURE smoke():
  1. mkdtemp a directory, `git init` it
  2. Run `faff gitignore-ensure --root <dir>` (and the .faff/ target FAFF-1299 adds)
  3. Assert the root .gitignore contains no ".faffrc" substring
  4. Run `faff config init --root <dir> --set tracking.team_key=SMOKE`
  5. Assert <dir>/.faff/config.yaml exists and <dir>/.faffrc.yaml does not
  6. Assert `faff config get tracking.team_key --root <dir>` prints exactly "SMOKE"
     on standard output with an empty standard error
  7. Run `faff config init --root <dir> --local --set tracking.team_key=LOCAL`
  8. Assert `faff config get tracking.team_key --root <dir>` prints "LOCAL"
  9. Assert `git -C <dir> check-ignore -q .faff/config.local.yaml` exits 0
 10. Assert `git -C <dir> check-ignore -q .faff/config.yaml` exits 1
 11. Assert `faff config check --root <dir>` reports no duplicate and no
     deprecated-location finding
```

If that sequence passes, the resolver, the writers, the carve-out lines and the overlay guarantee are all connected.

---

## Right-sizing

This fits one reviewable slice, and the reason is a single decision rather than a line count. The mechanism is one resolver plus its callers: five constants, one function gaining an argument and a return shape, two new wrappers, three writers gaining a shared target rule, three reporting surfaces gaining a notice, six `.gitignore` pattern-set lines, two paths in a shell script and one regex. The file count looks large only because roughly ninety test files and thirty-three library selftests write a root-named config fixture, and the decision to keep the resolver silent means none of them need to change. If that decision were reversed, and the notice fired on every read, this ticket would have to be split along the fixture boundary. It is not reversed, so it does not.

The one coupling worth naming is the dependency on FAFF-1299, which is an `**Assumes:**` with a stated validation step rather than a split, because FAFF-1302 consumes two lines of FAFF-1299's pattern set and nothing else. That sequencing is now also a blocker edge in the tracker (added 2026-10-15), so the ordering is enforced where the work is picked up rather than only described here.

---

## Self-review findings and resolutions

I ran the inherited self-review in context, as a fresh-reasoning pass over the drafted spec against the codebase. Findings, with what I did about each.

### Round 1 findings

**`major`, the `config check` relative-path bug was missing from the first draft.** `computeConfigCheck` derives the path it hands the git probes with `path.basename` (`config.js:2520`), which yields `config.yaml` for a base at `.faff/config.yaml` and makes both posture probes query a non-existent path. The ticket asked only that the existing check's meaning be worked through; the real finding is that the check silently breaks. **Applied:** the `rel` replacement, threading `root` into `computeConfigCheck`, and two DONE items including a fake-probe assertion in `configCheckSelftest`.

**`major`, the writers would half-migrate.** The first draft kept `targetName` from the constants, as the code does today. With two valid tiers that makes `faff config set` read the root file and write the new path, producing two base configs with no operator action. **Applied:** the `resolve_write_target` procedure, including the inside-root test that preserves today's linked-worktree behaviour, plus two anti-patterns and four DONE items.

**`major`, `validate-adapters`'s `HANDREAD` regex would be silently disarmed.** The lint that mechanically enforces CLI-only config access matches only the `.faffrc` stem (`validate-adapters.js:1002`), so after the move a skill hand-reading `.faff/config.yaml` would pass. This is the mechanical half of a rule the kernel calls load-bearing, and the rule exists because hand-reading dropped configured slots twice. **Applied:** its own decision section and a DONE item.

**`minor`, two change sites were missing from the explore findings.** `setup-worktree.sh:127`'s copy list and `lights-out.js:288,296`'s two hardcoded `.faffrc.local.yaml` literals. **Applied:** both are in the worktree decision and the consumer table, with the literals replaced by the constant so they cannot drift again.

**`minor`, the `--local` interaction was unexamined.** `FAFF_GITIGNORE_PATTERNS_LOCAL` ignores `.faff/` wholesale, so the question is whether FAFF-1299's `.faff/.gitignore` carve-out would override `.git/info/exclude` and defeat `--local` mode. **Resolved by experiment** rather than assertion: with `.faff/` in `.git/info/exclude`, `git check-ignore -v .faff/config.yaml` reports `.git/info/exclude:1:.faff/`, because git never descends into an excluded directory and so never reads `.faff/.gitignore`. `--local` keeps its meaning with no extra work, and I wrote that up as a `**Chosen:**` with the verification noted.

**`minor`, the `Assumes:` on FAFF-1299 was initially softer than the evidence supports.** Without FAFF-1299's carve-out the base config is ignored by the root `.faff/*` line and cannot be committed, which defeats the ticket's first acceptance criterion rather than merely degrading it. **Applied:** the assumption now says stop and escalate, with the specific files to read.

**Dismissed:** a reviewer reading would reasonably ask whether this should split, given the file count. I examined it and wrote the right-sizing section rather than splitting, because the decisions are closed and the fixture mass needs no change under the silent-resolver decision. I have named the one thing that would force a split, so the judgement is reviewable rather than asserted.

**Verification I ran rather than assumed.** Three anchor claims from the explore findings I checked directly: `findNamedIn`'s signature and `.example` skip (`shared-infra.js:502-514`, correct as given), the six-level example-file join (`config.js:2175`, correct), and the claim that nothing outside the CLI resolves config by hand (`scripts/link-skills.sh:141` reads through the CLI, confirmed). I also confirmed that `findConfigIn`, `findOverlayIn` and `findNamedIn` have no consumers outside `shared-infra.js`, which is what makes changing their shape safe, and that `gitignoreEnsure` returns without writing when nothing is missing, which is what makes a shrunken pattern set a clean no-op. The two git-behaviour claims in the spec (the carve-out precedence and the `.git/info/exclude` directory-exclusion precedence) are from experiments I ran in a throwaway repository on 2026-10-15, not from memory.

### Round 2: applying the spec-review verdict

Round 1 returned `revise` with two `major` and two `minor` findings. All four are applied in place; nothing else in the spec moved.

**`major`, the relative-path fix was unguarded against the worktree fallback.** `path.relative(root, p)` alone hands the probes `../../<main>/.faff/config.yaml` whenever `findConfig` resolved through the main-checkout fallback (`config.js:2614`, `shared-infra.js:585`), and git rejects an out-of-tree path. I had spotted the same hazard one section earlier and guarded the writers with an inside-root test, then left the check surface unguarded, which is exactly where graft runs the command. **Applied:** `isInsideRoot` is now an exported `shared-infra.js` helper with one home and two callers, the posture probes are gated on it, an out-of-tree file's posture is reported through the existing `skipped` channel, a visible scenario and three DONE items cover the worktree state, and the edge-case table carries the row. **Verified rather than assumed:** I ran both probes from a real linked worktree on 2026-10-15; each exits 128 with `fatal: ... is outside repository at <worktree>`, and because `gitIsIgnored` and `gitIsTracked` both test `status === 0`, the spurious warn is exactly as the review described.

**`major`, the printed `mv` could un-ignore the operator-private overlay.** The notice fired on tier alone. **Applied:** a new decision section, an ignore probe threaded into `print_location_notice`, the `faff gitignore-ensure` precondition for either role whose destination posture is wrong, the migrating-repo state added to the real-git test, a visible scenario, and four DONE items. **Verified rather than assumed:** the three-state table in that section is from the real git binary on 2026-10-15. One correction to the review's premise, which does not change the fix: this repository is **not** an instance of the overlay half. Its root `.gitignore` is hand-written, but the `.faffrc.local.*` glob at line 32 sits alongside a `.faff/*` line at line 36, so the overlay destination here is already ignored. It is an instance of the base half instead, and the spec now says so with the line numbers.

**`minor`, `computeConfigCheck`'s own literal cluster was not in the change list.** **Applied:** the ten occurrences are enumerated by line, the two that live inside message bodies are called out as needing rewritten text rather than a path substitution, and the DONE items assert on both message bodies because `surface` pinning does not reach message text. **Verified rather than assumed:** the enumeration is from the emit, not from the review's count. It is ten occurrences across seven lines (`config.js:2524`, `:2531` twice, `:2553`, `:2554`, `:2590`, `:2591`, `:2595` twice), slightly more than the "roughly eight" the review estimated.

**`minor`, the FAFF-1299 dependency had no tracker blocker edge.** Discharged by a tracker write rather than a spec change: FAFF-1299 now blocks FAFF-1302, added 2026-10-15. **Applied:** the two sentences that said no such edge exists are corrected, the `**Assumes:**` keeps its stop-and-escalate validation step because FAFF-1299 is still unlanded, and the right-sizing paragraph notes the edge. The requirement that `.faff/.gitignore` be present **and tracked** is now spelled out in both copies of the assumption, with the reason stated: an untracked carve-out file does not exist in a fresh clone, so every clone would warn on its own base config forever.

Round-2 anchors re-verified for the lines this revision cites: `computeConfigCheck` at `config.js:2517`, its `rel` helper at `:2520`, the "not a git repo" `skipped` push at `:2549`, `cmdConfigCheck`'s `findConfig(root)` at `:2614`, `gitIsIgnored` at `:2469` and its probe wiring at `:2652`, `gitignoreEnsure`'s append-only contract at `gitignore-ensure.js:13-48`, and this repository's own `.gitignore` lines 32 and 36.

No `blocker` findings across either round. Three `major` findings in round 1's own self-review and two in the reviewer's verdict, all of them closed in the draft rather than carried, which is below the threshold that would cap the rating.

confidence: high
spec-review: accept (fixes applied, rounds 1-2; no reviewer approve issued)
spec-review-churn: true (overridden by human decision, 2026-10-15; see the churn-override comment on the ticket)

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
    { "marker": "assumes" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" }
  ] }
```