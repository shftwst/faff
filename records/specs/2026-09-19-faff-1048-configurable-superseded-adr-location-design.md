# Spec: Configurable superseded-ADR location (FAFF-1048)

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1048.

This spec addresses FAFF-1048: let an operator choose where a superseded ADR comes to rest. The audience is the build agent implementing the change and the human reviewer gating the PR.

## 1. WHY: problem and principles

**The mechanism this turns on.** `supersededDir(root)` is one line of `plugin/skills/faff/bin/lib/adr.js` that every superseded-ADR path routes through: the target `faff adr supersede` relocates a file to, and the second directory every union reader scans. This spec makes that line read a config key, `tracking.adr_superseded_docs_path`, whose **unset default is the active ADR directory itself**. When the superseded location equals the active location there is nowhere to move to, so nothing moves. Setting the key to a different directory is what makes a supersession relocate. *Whether* is derived from *where*, so `adr.on_supersede` has nothing left to decide and retires.

**Problem statement.** FAFF-1042 shipped relocation as two knobs: `adr.on_supersede: in-place | move` decides whether, and a hardcoded `<adr_docs_path>/superseded/` decides where. A repository that keeps retired records elsewhere cannot say so, and the two-knob shape admits a contradictory state where a path is set and silently ignored. This change replaces both with one location key.

**Design principles.**

- **Unset is byte-identical to today's default, including under a customised `tracking.adr_docs_path`.** The key resolves to the *resolved* ADR directory, never a literal `docs/adr`. This repository resolves `records/adr/`, so an unset key must yield `records/adr`, not `docs/adr`.
- **One key cannot contradict itself.** Two keys can be set to "move superseded ADRs to `records/adr/retired`" and "do not move superseded ADRs" at the same time, with no defined resolution. One key cannot express that state.
- **A read is never gated on a write knob.** Readers resolve superseded records at the configured location whatever else is configured. FAFF-1042 established this (`adr.js:251`); the retirement of `adr.on_supersede` removes the knob that comment was written against, not the rule.
- **The union collapses safely when the two directories are the same.** This is the single hazard the design creates and it is dealt with explicitly below.
- **Move, never delete.** Inherited from FAFF-1042 and unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/adr.js` -> `supersededDir` (line 62) | Node | The one computation point; its body is what changes |
| `plugin/skills/faff/bin/lib/adr.js` -> `listAdrsAcross` (lines 136 to 142) | Node | The union reader; gains the deduplication this design requires |
| `plugin/skills/faff/bin/lib/adr.js` -> `recordSupersede` (lines 235 to 244) | Node | The optional relocation, and the same-directory guard that must use the same path equality |
| `plugin/skills/faff/bin/lib/adr.js` -> `cmdAdr` supersede branch (lines 641 to 648) | Node | The sole `adr.on_supersede` read site, which is removed |
| `plugin/skills/faff/bin/lib/config.js` -> `resolveDocsPath` (line 689) and the five bindings (lines 699 to 703) | Node | The shared resolver the new key joins |
| `plugin/skills/faff/bin/lib/config.js` -> `DEFAULTS` line 127, `TRACKING_KEYS` line 715, `CONFIG_SURFACE` line 37 | Node | Key retirement, key registration, and the `config <name>-docs-path` verb family |
| `plugin/skills/faff-graft/SKILL.md` -> ADR-collision merge guard (lines 540 to 548) | Prose | The consumer that blocks on `duplicate ADR number`; why the deduplication is merge-critical |

**Scope statement.** A self-contained change to the `faff adr` and `faff config` surfaces. Nothing about how ADRs are authored, accepted, admitted, or numbered changes.

## 2. Out of scope

- **Containment or traversal validation of the new key.** Ruled out by operator decision, recorded under Design decision rationale. Extension point: if the six docs-path keys ever get path validation it belongs inside `resolveDocsPath`, applied to all six at once.
- **Migration of pre-existing superseded ADRs.** `adr.on_supersede` is not set in this repository's `.faffrc.yaml` and resolves to the `in-place` default, so no live configuration relocates anything and there is nothing to migrate. Files an operator moved by hand stay where they are, and pointing the key at that directory makes the readers find them. No mechanism, no upgrade step.
- **A deprecation warning for a leftover `adr.on_supersede` leaf.** The known-key lint in `config.js` inspects top-level key names only, and `adr` stays a recognised namespace, so a leftover leaf is silently ignored with no finding. Adding a warning would be a new mechanism for a key nothing sets.
- **`adr list` spanning the superseded set.** `cmdAdr`'s `list` branch calls `listAdrs(dir)` and scans the active directory only, today and after this change. The ticket's wording implies listing already spans; it does not. Extension point: `cmdAdr`'s `list` branch, behind an `--all` flag.
- **`adrAdvisories`, `adrGitTier`, `adrLiveDecisions`, `adrAccept`.** All active-directory-only today and unchanged. `adrLiveDecisions` excludes superseded records by design.
- **PRDR supersession relocation.** `prdr supersede` calls `recordSupersede` without the optional seventh argument, so the relocation block never executes on that path. Unchanged.

## 3. WHAT: vocabulary, keys, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Active dir | The resolved ADR directory, `path.join(root, resolveAdrDocsPath(...))`, where live ADRs sit |
| Superseded dir | Where a superseded ADR comes to rest: the configured key if set, else the active dir |
| Collapsed case | Superseded dir and active dir denote the same directory. The default, and the common path |
| Distinct case | The key names a different directory. Supersession relocates, and readers span both |

**The config key.**

```
tracking.adr_superseded_docs_path: <repo-relative path>   # optional; no DEFAULTS entry

  UNSET  =>  resolveAdrDocsPath(root, cfg)          # the active dir; collapsed case; nothing moves
  SET    =>  the value, trimmed and trailing-slash-stripped
```

The key sits under `tracking.*` beside `tracking.adr_docs_path` and resolves through the same `resolveDocsPath` helper as its five siblings. The `adr.*` namespace stays behaviour-only.

**The retired key.** `adr.on_supersede` is removed from `DEFAULTS` (`config.js:127`), from its sole read site (`adr.js:644`), and from `.faffrc.example.yaml:352`. Verified blast radius: those three places, stale comments in `adr.js` at lines 196, 251, 586, 1039, 1055, and 1069, and one selftest case (`adr.js:1053`). Nothing in `plugin/skills/*/SKILL.md`, `docs/`, or `test/` reads it.

**This retirement is BREAKING for adopters, and the blast-radius evidence above cannot see them.** That evidence is a grep of this repository plus a read of this repository's `.faffrc.yaml`; neither observes an adopter's config. Two facts put adopters in scope: `adr.on_supersede` shipped in a released version (the CHANGELOG entry for FAFF-1042), and it ships **uncommented** in `.faffrc.example.yaml` as `on_supersede: in-place`, so any repository onboarded from that template since carries the key. An adopter who set `move` silently stops relocating, with no lint finding (the known-key lint is top-level-only), no CLI error, and no doc note. The one channel that reaches someone who is not reading this repository's diffs is the release notes, so the change lands with a `BREAKING CHANGE:` footer naming the retired key and its replacement. `CHANGELOG.md` already carries the `BREAKING CHANGES` convention and release-please generates that section from the footer. This is a DONE criterion below, not a commit-message habit.

**One more comment this design falsifies.** `adr.js:60-61` reads "the fixed relocation target for a superseded ADR, always a child of the active ADR dir, so it is contained by construction (no traversal / containment check needed)". Both halves stop being true: the target is no longer fixed, and containment is no longer by construction. That comment is the standing justification for not validating the path, so replacing it is where the no-validation decision below gets recorded in the source.

**Resolver signature change.** `resolveDocsPath` gains one optional trailing parameter:

```
FUNCTION resolveDocsPath(root, data, create, configKey, subdir, fallbackRel?) -> repo-relative path

  1. val := dig(data, configKey)
  2. IF val truthy:             rel := trim(val), strip trailing "/"
  3. ELSE IF fallbackRel given: rel := strip trailing "/" from fallbackRel      # NEW branch
  4. ELSE IF <root>/docs exists: rel := "docs/" + subdir
  5. ELSE IF <root>/doc exists:  rel := "doc/" + subdir
  6. ELSE:                       rel := "docs/" + subdir
  7. IF create: mkdir -p <root>/rel
  8. RETURN rel
```

The five existing bindings pass no sixth argument, so step 3 never fires for them. The new binding passes `subdir: null`:

```
resolveAdrSupersededDocsPath(root, data, create) =
  resolveDocsPath(root, data, create,
                  "tracking.adr_superseded_docs_path",
                  null,
                  resolveAdrDocsPath(root, data, false))
```

**Anti-pattern:** giving the new key a `subdir` and letting the `docs/`-then-`doc/` ladder default it. Why: the ladder yields a literal `docs/...` path, which differs from the resolved ADR directory in every repository that customises `tracking.adr_docs_path`. This repository is one of them (`records/adr/`), so the regression would land on the first PR and would silently relocate records rather than fail loudly.

**The `adr.js` seams.**

```
supersededDir(root) -> absolute path     # unchanged name, arity, export; new body
resolvedDirKey(d)   -> string            # new, module-local: the identity a directory is deduped by
samePath(a, b)      -> boolean           # new, module-local: resolvedDirKey(a) === resolvedDirKey(b)
listAdrsAcross(dirs) -> record[]         # unchanged signature; now deduplicates dirs
```

**CLI surface addition.** `faff config adr-superseded-docs-path [--create]` prints the resolved repo-relative path, matching the five sibling verbs. This is the only way an operator sees the resolved value, because a key whose default is derived cannot carry a `DEFAULTS` entry and `faff config get` therefore prints nothing when it is unset.

## 4. HOW: behaviour

**Architecture.**

```
config.js
  resolveDocsPath                  + optional fallbackRel branch
  resolveAdrSupersededDocsPath     + new binding, exported
  DEFAULTS                         - "adr.on_supersede"
  TRACKING_KEYS                    + "tracking.adr_superseded_docs_path"
  CONFIG_SURFACE.subcommands       + "adr-superseded-docs-path"
  cmdConfig                        + the verb branch

adr.js
  resolvedDirKey / samePath        + new module-local helpers
  supersededDir(root)              body resolves through the new binding
  listAdrsAcross(dirs)             + deduplication by resolvedDirKey
  recordSupersede                  same-directory guard uses samePath
  cmdAdr supersede branch          drops the adr.on_supersede read
```

**The write target.**

```
PROCEDURE supersededDir(root):
  1. cfg := loadConfig(root)[0]
  2. RETURN path.join(root, resolveAdrSupersededDocsPath(root, cfg, false))
```

With the key unset this is `path.join(root, adrRel)`, the exact expression `adrDir(root)` already computes, so the two are string-identical.

**The deduplication, and why it is merge-critical.** `listAdrsAcross` today concatenates `listAdrs` over each directory it is handed with no deduplication. That has been safe only because `supersededDir(root)` was always a strict child of `adrDir(root)`, so `[dir, supersededDir(root)]` could never hold the same directory twice. This design makes them equal on the default path, which turns the same call into a double scan. Confirmed empirically against `origin/main`: with two ADR files on disk, `listAdrsAcross([d])` returns 2 records and `listAdrsAcross([d, d])` returns 4, numbered `0001, 0001, 0002, 0002`.

The consequence chain, traced through the shipped code:

```
adrValidate(dir, root)                    adr.js:255  -> listAdrsAcross([dir, sdir]), dir === sdir
  duplicate-number grouping               adr.js:277  -> byNum("0001") = ["0001-a.md", "0001-a.md"]
  files.length > 1                        adr.js:280  -> "duplicate ADR number 0001 — 0001-a.md, 0001-a.md"
  numbering-gap loop                      adr.js:283  -> i runs 1..adrs.length, now doubled to 2N
                                          adr.js:285  -> "numbering gap: ADR NNNN missing" for N+1..2N
graft merge guard step 2   faff-graft SKILL.md:543  -> a duplicate line exists, never returns early
graft merge guard step 3   faff-graft SKILL.md:545  -> for an ADR not in this PR's `added` set,
                                                       "none of the colliding files is in added"
                                                       -> BLOCK, park needs-human
graft merge guard step 4   faff-graft SKILL.md:547  -> the re-validate "must exit 0" never can
```

So without the deduplication, `faff adr validate` reports a duplicate for **every** ADR in the repository **and** a spurious numbering gap for every number above the real maximum, and every PR containing an ADR parks `needs-human` at the merge guard. Two distinct symptom families, which is why the headline criterion below asserts a clean problem list rather than only the absence of a duplicate line: a fix that addressed duplicates alone would still block every merge.

```
PROCEDURE resolvedDirKey(d):
  1. abs := path.resolve(d)
  2. TRY:   RETURN fs.realpathSync(abs)        # collapses symlinked spellings
  3. CATCH: RETURN abs                         # a not-yet-created dir must never throw

PROCEDURE listAdrsAcross(dirs):
  1. out := [], seen := empty Set
  2. FOR d IN dirs:
     a. key := resolvedDirKey(d)
     b. IF key IN seen: CONTINUE               # already scanned under an earlier spelling
     c. add key to seen
     d. FOR a IN listAdrs(d): push { ...a, dir: d }
  3. RETURN out sorted by (number, file)       # unchanged
```

First spelling wins, and callers pass `[dir, sdir]`, so a surviving record carries `dir: dir` (the active directory). That matters downstream: `recordSupersede` reads `oldA.dir` and `adrRenumber` reads `source.dir`, and both must see the spelling the caller already holds.

**Why the guard inside `recordSupersede` must change too.** Its relocation block is guarded by `if (oldDir !== supersededDir)` (`adr.js:237`), a plain string comparison. A record is always tagged with the spelling its caller passed, which is the active directory's, while `supersededDir(root)` returns whatever the key resolves to. When the key names the same directory under a spelling `path.join` cannot collapse, the string comparison sees a difference, attempts the move, finds the same file already at the target through the other spelling, and returns exit 1 `already exists — refusing to overwrite` on a supersession that should have been a plain in-place edit. This is independent of the deduplication: it would happen with or without it.

`path.join` already collapses a leading `./`, a trailing slash, doubled separators, and interior `..`, so those spellings are safe under the string comparison. A **symlinked** spelling is the case it cannot collapse, and it is the case the fixtures below use. Replace the guard with `if (!samePath(oldDir, supersededDir))`. The PRDR path never reaches this block (it omits the seventh argument), so PRDR stays byte-identical.

**The supersede dispatch.**

```
BEFORE (adr.js:641-648)                       AFTER
  cfg := loadConfig(root)[0]                    sdir := supersededDir(root)
  mode := dig(cfg,"adr.on_supersede")           records := listAdrsAcross([dir, sdir])
          || DEFAULTS["adr.on_supersede"]       recordSupersede(dir, root, records, args[1], --by, "ADR", sdir)
  sdir := mode === "move" ? supersededDir : null
  records := listAdrsAcross([dir, supersededDir(root)])
  recordSupersede(..., sdir)
```

`sdir` is now always passed. In the collapsed case `samePath` makes the relocation a no-op, so the write is the same two-file edit it is today.

**Call sites that need no change.** `adrNextNumber` (`adr.js:127`), `adrValidate` (`adr.js:255`), `adrRenumber` (`adr.js:362`), and the validate scan count (`adr.js:592-593`) already build `[dir, supersededDir(root)]` and hand it to `listAdrsAcross`. Deduplicating inside that one function makes all of them correct without touching them, which is the point of putting the fix there. The optional-`root` contract FAFF-1042 established is likewise untouched: `adrValidate(dir)` with `root` omitted stays directory-only.

**`adrNextNumber` was never broken by the double scan.** It computes `list.reduce((m, a) => Math.max(m, a.number), 0)`, and a maximum over duplicated values is the same value. The double scan wasted work there and returned the right answer. It is fixed as a side effect of the deduplication, not because it needed fixing.

**Edge cases.**

| Input | Outcome |
|---|---|
| Key unset | Superseded dir equals active dir; nothing relocates; scan collapses to one directory |
| Key set with a trailing slash (`records/adr/retired/`) | Stripped by `resolveDocsPath` |
| Key set to `./records/adr` against `adr_docs_path: records/adr` | `path.join` already collapses this to the identical string; collapsed case |
| Key set to a **symlinked** spelling of the active dir | The only spelling `path.join` cannot collapse. `resolvedDirKey`'s `realpathSync` collapses it, so the scan deduplicates and the move guard no-ops |
| Key set to a distinct directory that does not exist | `listAdrs` returns `[]` for a missing directory; created by `recordSupersede`'s `mkdirSync` on the first move |
| Key set to `<adr_docs_path>/superseded` | Reproduces FAFF-1042's shipped target exactly, including the union read |
| Key set to an absolute path | `path.join(root, value)` mangles it, exactly as `tracking.adr_docs_path` does today. Uniform across all six keys |
| Key set to a traversing path | Resolves as written, exactly as `tracking.adr_docs_path` does today. See Design decision rationale |
| A leftover `adr.on_supersede` leaf in `.faffrc.yaml` | Silently ignored; the known-key lint is top-level-only and `adr` stays recognised |

**Failure modes.**

- **The duplicate-number regression ships.** If the deduplication is missed or written as string equality only, `faff adr validate` reports a duplicate for every ADR and every ADR-carrying PR parks `needs-human` at graft's merge guard. How you would know: `.github/workflows/validate.yml:97` runs `faff adr validate` on every PR against this repository's own 129 ADRs in `records/adr/`, which IS the collapsed case under the new default, so a missed deduplication reddens CI on the implementing PR itself, pre-merge, and regardless of whether that PR adds an ADR (graft's guard returns early on an empty `added` set). The headline DONE criterion below still earns its place because it localises the failure to one selftest rather than a repo-wide CI red with 129 duplicate findings and as many spurious gaps. What it means: the hazard is loud and pre-merge, not latent; the criterion is about diagnosability, not detection.
- **The deduplication is implemented as "only scan the first directory".** The union read is the whole purpose of `listAdrsAcross` when the directories genuinely differ; collapsing it unconditionally would hide every relocated ADR from `validate`, `renumber`, and `next-number`, and their back-references would dangle. How you would know: the distinct-directory DONE criterion below asserts the union is still returned. What it means: deduplicate by identity, never by position.
- **The default silently relocates.** If the unset default resolves through `resolveDocsPath`'s ordinary ladder it yields a literal `docs/...` path, and every repository with a customised `tracking.adr_docs_path` starts writing and reading somewhere new. How you would know: the customised-`adr_docs_path` DONE criterion below, with `docs/` present on disk so a wrong ladder would fire. What it means: the fallback must be the resolved ADR path, computed, not a literal.
- **The path-equality tests pass without the fix.** A fixture that spells the equivalent path `./records/adr` is collapsed by `path.join` before either comparison sees it, so both the deduplication and the move guard go green with neither change applied. How you would know: run the symlink fixture against unmodified `adr.js` first and confirm it fails. What it means: a green test is only evidence here if it was red beforehand.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo on the default config (tracking.adr_superseded_docs_path unset) holding ADR-0001 and ADR-0002
When faff adr validate runs
Then it exits 0 and prints no "duplicate ADR number" line, and faff adr next-number returns 0003
```

```
Given a repo with tracking.adr_docs_path: records/adr/, tracking.adr_superseded_docs_path unset,
  and a docs/ directory present at the repo root
When faff adr supersede 0001 --by 0002 runs
Then 0001's file stays at <root>/records/adr/0001-*.md, both back-references are written in place,
  and neither <root>/docs/adr nor any superseded subdirectory is created
```

```
Given a repo with tracking.adr_superseded_docs_path: records/adr/retired
When faff adr supersede 0001 --by 0002 runs
Then 0001's file is at <root>/records/adr/retired/, carries "Superseded by ADR-0002",
  the active 0002 carries "Supersedes: ADR-0001", exit is 0,
  and the command's first output line is the relocated path
```

```
Given a repo with tracking.adr_superseded_docs_path: records/adr/retired holding a relocated ADR-0001
  superseded by an active ADR-0002
When faff adr validate, faff adr next-number, and
  faff adr renumber 0002-new.md --to next --ref-scope 0002-new.md,0001-old.md all run
Then validate exits 0 having seen both records, next-number returns a number above both,
  renumber exits 0, and the relocated 0001's back-reference is re-pointed to 0002's new number
```

```
Given a repo with tracking.adr_docs_path: records/adr, a symlink link-adr pointing at records/adr,
  and tracking.adr_superseded_docs_path: link-adr
When faff adr validate runs over two ADRs and faff adr supersede 0001 --by 0002 runs
Then validate exits 0 with an empty problem list, and the supersede performs no move,
  exiting 0 rather than exiting 1 with "already exists — refusing to overwrite"
```

- `faff prdr supersede` output and on-disk effect must be byte-identical whatever `tracking.adr_superseded_docs_path` is set to.
- No source file under `plugin/`, no file under `docs/`, and no file under `test/` may still read `adr.on_supersede` after this change.

## 6. Design Decision Rationale

**One key or two?**

- Options: (a) keep `adr.on_supersede` as the whether-knob and add a separate where-key; (b) one location key whose default is the active directory, with `adr.on_supersede` retired.
- Operator decision, ratified: (b). Recorded reasoning: two keys admit a contradictory state, a path set alongside `on_supersede: in-place`, where the path is silently ignored and no resolution is defined. One key cannot express that state, because the location *is* the instruction.
- **Chosen:** one key. `tracking.adr_superseded_docs_path` defaults to the resolved ADR directory; setting it elsewhere is the opt-in to relocation; `adr.on_supersede` retires. Cost: the retirement is a behaviour change for any repository that had set `on_supersede: move`, which would stop relocating. Verified: the key is not set in this repository's `.faffrc.yaml`, is read in exactly one place, and is referenced nowhere in `plugin/skills/*/SKILL.md`, `docs/`, or `test/`. Benefit: the whole FAFF-1042 two-knob surface collapses to one entry in the `tracking:` block.

**Where does the key live, and what is it called?**

- Operator decision, ratified: `tracking.adr_superseded_docs_path`, under `tracking.*` beside `tracking.adr_docs_path`, resolved through the same `resolveDocsPath` helper as its five siblings. `tracking.*` is where locations live; `adr.*` stays behaviour only.
- **Chosen:** `tracking.adr_superseded_docs_path`. Cost: the key is read by `adr.js` but registered in `config.js`, so a cross-reference comment on both sides is warranted. Benefit: `faff config set`, `faff config init`, the `config <name>-docs-path` verb family, and the known-key lint all apply with no special case.

**Does the key validate containment?**

- Operator decision, ratified: no. Recorded reasoning: validation is not warranted when nothing else does it, and it would put an error-prone mechanism in front of several critical code paths.
- The ticket's own "Containment" constraint is **explicitly overridden** by this decision. It was written before it was established that `resolveDocsPath` validates nothing today: its entire body reads the value, trims it, strips trailing slashes, optionally creates the directory, and returns. `tracking.adr_docs_path: ../../somewhere` already escapes the repository, and all five shipped docs-path keys share that surface.
- **Chosen:** no containment check, no traversal check, no new validation layer. Residual, stated plainly: a malformed value escapes the repository exactly as `tracking.adr_docs_path` already can, and that surface is uniform across all six keys rather than special to this one.

**How is the unset default expressed?**

- Options: (a) `resolveDocsPath(..., subdir: "adr")`, using the ordinary ladder; (b) read the key directly in `adr.js` and fall back to `adrDir(root)`; (c) give `resolveDocsPath` an optional explicit-fallback parameter and pass the resolved ADR path.
- **Chosen:** (c). Option (a) is wrong: the ladder yields a literal `docs/...` path, which differs from the resolved ADR directory wherever `tracking.adr_docs_path` is customised, this repository included, so it breaks the no-regression constraint outright. Option (b) works but resolves the new key in `adr.js` while its five siblings resolve in `config.js`, contradicting the placement decision. Option (c) keeps one resolver, leaves the five existing bindings byte-identical because they pass no sixth argument, and costs one branch plus an unused `subdir` argument on the new binding.

**Where does the double-scan fix go?**

- Operator decision, ratified: deduplicate inside `listAdrsAcross`.
- **Chosen:** deduplicate inside `listAdrsAcross`. It is the single point every union caller already funnels through, so no call site can forget it and no new state appears at any of the six. Call-site filtering and a `supersededDir` that returns null when collapsed were both considered; each spreads the same invariant across multiple places where a future caller can miss it.

**What is the deduplication identity?**

- **Chosen:** `fs.realpathSync(path.resolve(d))`, falling back to `path.resolve(d)` when `realpathSync` throws. `path.join` already collapses a leading `./`, a trailing slash, doubled separators, and interior `..`, so those spellings never reach the comparison as differences; `path.resolve` additionally normalises a relative-versus-absolute spelling. A **symlinked** directory is the one equivalence neither collapses, and it is the only spelling a test can use to prove the fix is real rather than vacuous. The `try`/`catch` is load-bearing rather than defensive: a configured directory legitimately does not exist until the first relocation creates it, and `realpathSync` throws on a missing path. Records keep the spelling they were listed under, first occurrence winning, so `oldA.dir` and `source.dir` stay the strings their callers already hold.

**Does `recordSupersede`'s guard change?**

- **Chosen:** yes, `oldDir !== supersededDir` becomes `!samePath(oldDir, supersededDir)`. Leaving the string comparison would make a symlinked spelling of the active directory attempt a move onto the file's own location, hit the `already exists — refusing to overwrite` branch, and fail a supersession that should have been an in-place edit. The PRDR path omits the seventh argument and never enters this block, so PRDR parity is unaffected.
- **Anti-pattern:** testing this with a `./records/adr` spelling. Why: `path.join` collapses it to the identical string, so the test passes against the unfixed guard and proves nothing. The fixture must use a symlink.

**What happens to the FAFF-1042 selftests?**

- **Chosen:** replace two cases rather than delete the coverage. `adr.js:1155` currently asserts `supersededDir(root) === path.join(d, "superseded")`, which this design makes false; it becomes `supersededDir(root) === adrDir(root)` under an unset key, which is the regression guard for the behaviour most at risk. `adr.js:1053` asserts `DEFAULTS["adr.on_supersede"] === "in-place"` against a key that no longer exists and is deleted outright. Every other FAFF-1042 case that exercised `move` is re-expressed against a set `tracking.adr_superseded_docs_path`, so the relocation, append-only refusal, no-op-move, and cross-directory renumber coverage all survive.

**Does `adr list` start spanning the superseded set?**

- **Chosen:** no. `cmdAdr`'s `list` branch scans the active directory only, and under the collapsed default that is already the whole set, so listing is unchanged for the common path. Making it span would change shipped output for the distinct case without being asked for. Named in Out of scope with its extension point.

## 7. Open Questions and Assumptions

**Open Questions.** None. The ticket's two open questions are closed above: key placement and the containment question by operator decision, and the one-key-versus-two-keys question by the retirement of `adr.on_supersede`.

**Assumptions.**

- **Assumes:** `tracking` is already a member of `WRITABLE_NAMESPACES`, so `faff config set tracking.adr_superseded_docs_path <path>` needs no namespace change, and the `.faffrc.example.yaml` namespace-drift selftest inspects top-level keys only, so a new leaf under `tracking:` does not affect it. Validation: read `WRITABLE_NAMESPACES` and the namespace-drift block in `plugin/skills/faff/bin/lib/config.js` and confirm both before starting.
- **Assumes:** a `.faffrc.yaml` planted at a temporary root is the complete config for a selftest fixture. `findConfigIn` checks only the base directory it is given and does not walk upward; `findConfig`'s only additional source is a linked-git-worktree fallback, which resolves to null for a temporary directory that is not a worktree. Validation: read `findConfigIn` and `findConfig` in `plugin/skills/faff/bin/lib/shared-infra.js`.
- **Assumes:** `parseYamlSubset` parses a new leaf inside the nested `tracking:` block, as it already does for the five sibling docs-path keys in `.faffrc.example.yaml`. Validation: run `faff config get tracking.adr_superseded_docs_path` against a fixture that sets it.

## 8. DONE: Definition of Done

### Headline criterion (the merge-blocking regression)

- [ ] A selftest fixture on the **default** config (`tracking.adr_superseded_docs_path` unset, so the superseded and active directories are the same) holding at least two ADRs asserts `adrValidate(dir, root).length === 0` (an empty problem list, not merely the absence of a `duplicate ADR number` line: the double scan also produces spurious `numbering gap` problems, and a fix addressing duplicates alone would still block every merge), and that `adrNextNumber(dir, root)` returns the correct next number.
- [ ] `listAdrsAcross([d, d])` returns the same records as `listAdrsAcross([d])`, for a directory `d` holding at least two ADRs.
- [ ] `listAdrsAcross([activeDir, supersededDir])` with two **genuinely distinct** directories returns the union of both, so the deduplication cannot have been implemented as "scan the first directory only".

### From WHY (no regression)

- [ ] With the key unset, `supersededDir(root) === adrDir(root)` for `tracking.adr_docs_path` values `docs/adr/` (the default), `records/adr/`, and `records/adr`.
- [ ] A fixture sets `tracking.adr_docs_path: records/adr/` with the key unset and a `docs/` directory present at the repo root, supersedes an ADR, and asserts the file stays at `<root>/records/adr/`, that `<root>/docs/adr` is never created, and that no superseded subdirectory is created.
- [ ] `faff prdr supersede` relocates nothing and produces identical output and on-disk state with the key unset and with it set to a distinct directory.

### From WHAT (key registration and retirement)

- [ ] `resolveDocsPath` accepts an optional sixth `fallbackRel` parameter that replaces the `docs/`-then-`doc/` ladder when supplied; each of the five existing bindings resolves to the same value as on `origin/main` for an unset key, a set key, a `docs/`-present root, and a `doc/`-only root.
- [ ] `resolveAdrSupersededDocsPath(root, data, create)` is exported from `config.js`, returns `resolveAdrDocsPath(root, data, false)` when the key is unset, and returns the trimmed trailing-slash-stripped key value when set.
- [ ] `"tracking.adr_superseded_docs_path"` is a member of `TRACKING_KEYS`; `faff config init --set adr_superseded_docs_path=records/adr/retired` is accepted rather than refused as an unknown key.
- [ ] `faff config set tracking.adr_superseded_docs_path records/adr/retired` writes the leaf and round-trips; `faff config set --selftest`, `faff config check --selftest`, and `faff config defaults --selftest` all pass.
- [ ] `faff config adr-superseded-docs-path` prints the resolved repo-relative path with the key unset and with it set, `--create` creates the directory, and the verb appears in `CONFIG_SURFACE.subcommands` and therefore in `configVerbList()`.
- [ ] `grep -rn "on_supersede" plugin/ docs/ test/ .faffrc.example.yaml` returns no match.
- [ ] The landing commit carries a `BREAKING CHANGE:` footer naming `adr.on_supersede` as retired and `tracking.adr_superseded_docs_path` as its replacement, so release-please surfaces it under `BREAKING CHANGES` in `CHANGELOG.md`. This is the only channel that reaches an adopter who onboarded from `.faffrc.example.yaml` while the key shipped uncommented.
- [ ] A `.faffrc.yaml` still carrying `adr: { on_supersede: move }` produces no `faff config check` finding and no behaviour change.

### From HOW (write path)

- [ ] With the key set to `records/adr/retired`, `faff adr supersede 0001 --by 0002` relocates `0001-*.md` into `<root>/records/adr/retired/`, the relocated file carries `Superseded by ADR-0002`, the active `0002-*.md` carries `Supersedes: ADR-0001`, exit is 0, and the first output line is the relocated path.
- [ ] With the key unset, `faff adr supersede 0001 --by 0002` leaves `0001-*.md` in the active directory, writes both back-references, and exits 0.
- [ ] With `tracking.adr_docs_path: records/adr`, a symlink `link-adr` pointing at `records/adr`, and the key set to `link-adr`, `faff adr supersede` performs no move and exits 0, rather than exiting 1 with `already exists — refusing to overwrite`. A `./records/adr` spelling does **not** satisfy this criterion: `path.join` already collapses it, so it passes against the unfixed string guard and proves nothing.
- [ ] The same symlink fixture asserts `adrValidate(dir, root).length === 0`, so the deduplication is proven to key on the resolved path rather than the raw string.
- [ ] A pre-existing file at the target path in a distinct configured directory is refused with exit 1 and `already exists — refusing to overwrite`, and nothing is moved.
- [ ] Superseding a record already resident in a distinct configured directory is a no-op move at exit 0, with only its `Status` line edited.

### From HOW (read path)

- [ ] With the key set to a distinct directory holding a relocated superseded ADR, `adrValidate(dir, root)` returns no problems and `adrNextNumber(dir, root)` skips the number that record holds.
- [ ] `adrRenumber` with the key set to a distinct directory re-points a relocated superseded ADR's back-reference when its active successor is renumbered, exits 0, and re-validates clean across the union.
- [ ] `adrValidate(dir)` and `adrRenumber(dir, undefined, selector, target, scope)` with `root` omitted stay directory-only, preserving FAFF-1042's optional-`root` contract.
- [ ] `resolvedDirKey` returns a value without throwing for a directory that does not exist.

### From tests and docs

- [ ] The selftest at `adr.js:1155` asserts `supersededDir(root) === adrDir(root)` under an unset key and is retitled to name that condition; the selftest at `adr.js:1053` is removed.
- [ ] Every FAFF-1042 selftest case that exercised `adr.on_supersede: move` is re-expressed against a set `tracking.adr_superseded_docs_path`, so relocation, the append-only refusal, the no-op move, and the cross-directory renumber coverage all survive.
- [ ] The stale comments at `adr.js` lines 60 to 61, 196, 251, 586, 1039, 1055, and 1069 are rewritten for the one-key design. Line 251's union-read rule is restated without reference to the retired knob, and lines 60 to 61 no longer claim the target is fixed or contained by construction.
- [ ] `.faffrc.example.yaml` documents `adr_superseded_docs_path` in the `tracking:` block **commented out**, stating that it defaults to the ADR directory itself and that setting it elsewhere is what relocates a superseded ADR. An uncommented leaf would ship a live relocation target to anyone who copies the template, and would drift out of step with a changed `adr_docs_path`. The `on_supersede` line is removed from the `adr:` block.
- [ ] `docs/guide/configuration.md`'s record-locations section and `plugin/skills/faff/references/tracker.md`'s docs-path paragraph name the new key; `docs/guide/cli.md`'s `config` row lists the new verb.

### Integration smoke test

```
1. mkdir a temp repo root; write .faffrc.yaml:
     tracking:
       adr_docs_path: records/adr/
2. mkdir -p <root>/docs and <root>/records/adr      # docs/ present so a wrong ladder would fire
3. faff adr new --title "First" --root <root>       # -> records/adr/0001-first.md
4. faff adr new --title "Second" --root <root>      # -> records/adr/0002-second.md
5. faff adr validate --root <root>
     EXPECT exit 0 and no "duplicate ADR number" line     # the collapsed-default case
6. faff adr next-number --root <root>               EXPECT 0003
7. faff adr supersede 0001 --by 0002 --root <root>
     EXPECT exit 0, first output line = <root>/records/adr/0001-first.md   # no move
8. add the leaf under the tracking: block in .faffrc.yaml:
       adr_superseded_docs_path: records/adr/retired/
9. faff adr new --title "Third" --root <root>       # -> records/adr/0003-third.md
10. faff adr supersede 0002 --by 0003 --root <root>
     EXPECT exit 0, first output line = <root>/records/adr/retired/0002-second.md
11. faff adr validate --root <root>                 EXPECT exit 0
12. faff adr next-number --root <root>              EXPECT 0004
13. faff config adr-superseded-docs-path --root <root>   EXPECT records/adr/retired
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
