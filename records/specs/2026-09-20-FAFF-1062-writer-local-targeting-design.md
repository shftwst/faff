# faff local mode: writer `--local` targeting (FAFF-1062)

> Spec: faffter-dark-nlspec · 2026-09-19 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1062.
> build-tier: standard

This spec is for the build agent implementing the writer half of the FAFF-1059 local-mode work, and for the human reviewers gating it. It gives the four CLI writers a single `--local` flag that redirects each to its personal, uncommitted target, reusing the existing filename-agnostic write cores. The claim-store refactor is the sibling ticket FAFF-1064; the onboard flow that drives `--local` is FAFF-1063. This slice ships standalone (the writers are CLI verbs used outside onboard) and is mechanical: a flag plus a target swap per writer, cores unchanged.

## 1. WHY

**Problem.** The four CLI writers (`config init` / `config set`, `gitignore-ensure`, `hooks-ensure`) only ever write their shared, committable targets, so there is no way to keep a machine-local faff setup out of a shared repo. Local mode (FAFF-1059) needs each writer to redirect, on demand, to a personal, uncommitted target.

**Design principles.**

- **Standard mode is byte-for-byte unchanged.** A writer invoked without `--local` produces exactly the bytes it produces today: same default path, same default pattern set, same messages. Reject any change to the default path when `--local` is absent.
- **One mode signal, one meaning.** A single boolean `--local` flag on each writer, with one meaning: redirect this writer to its personal, uncommitted target. Reject bespoke per-writer targeting flags.
- **Reuse the filename-agnostic cores.** The config surgical-merge core, the hooks planners, and the gitignore append logic are already target-agnostic. Local mode changes only which target each core is pointed at (and, for gitignore, which pattern set), never the core. Reject a parallel local-mode code path that duplicates a core.

## 2. OUT OF SCOPE

- **The build-claim on-box gating (`buildClaimStore` / `claimStoreCore`).** That is the sibling ticket FAFF-1064.
- **The onboard flow that threads `--local` and pins `bundle_store` / `tracking.label_prefix`.** That is FAFF-1063.
- **`faff config check` local-mode posture checks.** Left unchanged (parent FAFF-1059 decision); overlay-only already passes clean and the `.git/info/exclude` entry satisfies the existing overlay-gitignore warning.
- **Migrating an existing `.gitignore` `.faff/` line or a hook already in `settings.json`.** The writers are append-only and non-destructive today and stay so under `--local`.

## 3. WHAT

A single boolean `--local` flag on each writer. The write cores are filename-agnostic already, so only the target path (and, for gitignore, the pattern set) moves.

| Writer | Standard target | `--local` target | Core reused |
|---|---|---|---|
| `config init` / `config set` (`config.js`) | `CANONICAL_CONFIG` (`.faffrc.yaml`) — hardcoded at cmdConfigInit :896 / cmdConfigSet :1180 | `CANONICAL_OVERLAY_CONFIG` (`.faffrc.local.yaml`, config.js:55) via the overlay lookup | `mergeTrackingBlock` / `mergeConfigPath` (filename-agnostic), plus the round-trip self-verify and conflict refusal, unchanged |
| `gitignore-ensure` (`gitignore-ensure.js`) | `.gitignore` (hardcoded :82) | `.git/info/exclude` | `gitignoreEnsure` append logic, unchanged; a distinct local pattern set (below) |
| `hooks-ensure` (`hooks-ensure.js`) | `.claude/settings.json` (write at :330) | `.claude/settings.local.json` | `planStopHooks` / `planPreToolUseHooks` (settings-object-agnostic); still reads BOTH settings files for presence (:309-314) |

**Local gitignore pattern set** = the standard `FAFF_GITIGNORE_PATTERNS` (gitignore-ensure.js:45-52) plus `.faffrc.yaml`, and minus the `!.faff/anchors/` carve-out (:51), so `.faff/` is ignored wholesale with no committed anchors:

```
.faffrc                    # legacy bare form
.faffrc.yml                # legacy YAML form
.faffrc.yaml               # LOCAL-ONLY: ignore the base too
.faffrc.*.yaml             # every overlay variant, incl. .faffrc.local.yaml
!.faffrc.example.yaml       # keep the tracked template out of the glob (must follow the glob)
.faff/                     # LOCAL-ONLY: wholesale ignore, NO !.faff/anchors/ carve-out
```

**Design decision: mode-signal shape.**

**Chosen:** a single boolean `--local` flag per writer, swapping only the target and the existing-file lookup, cores unchanged. Settled in the parent FAFF-1059 spec; the writers are standalone CLI verbs, so the signal lives on each CLI, and one flag name keeps local mode a single concept rather than bespoke per-writer flags.

## 4. HOW — Behaviour

Per writer, parse `--local` (default false) and resolve the target from it; everything else is unchanged.

```
# cmdConfigInit / cmdConfigSet
target = --local ? CANONICAL_OVERLAY_CONFIG : CANONICAL_CONFIG   # swap the hardcoded canonicalPath (:896 / :1180)
# existing-file lookup uses findOverlay under --local, findConfig otherwise; same legacy-name refusal;
# mergeTrackingBlock / mergeConfigPath, round-trip self-verify, conflict refusal all unchanged.

# gitignoreEnsure(root, local)
target   = local ? ".git/info/exclude" : ".gitignore"
patterns = local ? FAFF_GITIGNORE_PATTERNS_LOCAL : FAFF_GITIGNORE_PATTERNS
# append-only, idempotent matcher unchanged.

# cmdHooksEnsure
write_target = --local ? ".claude/settings.local.json" : ".claude/settings.json"   # only the WRITE moves
# presence is STILL the union of both settings files (:309-314); the plan mutates write_target's object.
```

**Anti-pattern:** forking a second `cmdConfigInitLocal` (or per-writer local variants). Why: the cores are filename-agnostic; a fork duplicates the round-trip / conflict / append logic and drifts from standard mode.

**Edge cases.**

- `.git/info/exclude` exists in every git repo but may hold only git's default commented preamble; the existing append logic (finish a no-EOL line, blank separator, header, patterns) handles an all-comments file the same as a populated `.gitignore`. Not a git repo (`.git` absent) returns the same outcome the writer already produces for a missing root.
- A hook already present in the shared `settings.json` when `--local` writes `settings.local.json`: the union-presence read (:309-314) sees it as present, so it is not duplicated. Intended interaction, not a bug.

## 5. Scenarios

```
Given a repo with no committed .faffrc.yaml
When `faff config init --local ...` (and `config set --local ...`) run
Then config is written to .faffrc.local.yaml and no .faffrc.yaml is created; without --local, .faffrc.yaml is written as today
```

```
Given `faff gitignore-ensure --local`
When it runs
Then patterns are appended to .git/info/exclude (not .gitignore), the set includes .faffrc.yaml and .faff/ wholesale and no !.faff/anchors/ line; without --local, .gitignore gets the standard set (with the carve-out) unchanged
```

```
Given a shared .claude/settings.json already containing a faff Stop hook
When `faff hooks-ensure --local` runs
Then the hook set is written to .claude/settings.local.json only, the shared hook is not duplicated, and settings.json is untouched; without --local, settings.json is written as today
```

Non-functional: with `--local` absent, config, gitignore, and hooks writes are byte-for-byte today's.

## 6. Open questions and assumptions

Open questions: none.

- **Assumes:** `CANONICAL_OVERLAY_CONFIG` = `.faffrc.local.yaml` and the overlay-only read path is fully supported (the config resolver merges defaults + overlay with no base). Validate: `faff config path` exits 0 on an overlay-only setup (`test/config-two-file.test.mjs:91`).
- **Assumes:** the config write cores (`mergeTrackingBlock` / `mergeConfigPath`) and the hooks planners are genuinely filename/target-agnostic, so only the hardcoded path needs to move. Validate: confirm no other path constant is baked into the write bodies.

## 7. DONE — Definition of Done

- [ ] `config init` / `config set` with `--local` write `.faffrc.local.yaml` (`CANONICAL_OVERLAY_CONFIG`) via the overlay lookup, cores unchanged; without `--local` they write `.faffrc.yaml` byte-for-byte as today.
- [ ] `gitignore-ensure --local` writes `.git/info/exclude` with the local pattern set (includes `.faffrc.yaml`, no `!.faff/anchors/`); without `--local` it writes `.gitignore` with the standard set (carve-out intact) byte-for-byte as today.
- [ ] `hooks-ensure --local` writes `.claude/settings.local.json`, still reads both settings files for presence, and does not duplicate a hook already in the shared file; without `--local` it writes `.claude/settings.json` byte-for-byte as today.
- [ ] Standard-mode regression: with `--local` absent, all three writers' output is byte-for-byte today's (a pinned golden/snapshot fixture per writer, not an implementer-defined assertion).
- [ ] Test targets: `test/config-two-file.test.mjs` and `test/config-set.test.mjs` (+ internal `configInitSelftest` / `configSetSelftest`) for the overlay target; `test/impure/gitignore-ensure-set.test.mjs` (+ internal `gitignoreEnsureSelftest`) for the exclude target, the local pattern set, and the anchor-carve-out absence; `test/hooks-ensure.test.mjs` (+ internal `hooksEnsureSelftest`) for the `settings.local.json` target and the union-presence dedup.

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "topic": "mode-signal shape", "marker": "chosen", "value": "single --local flag per writer, target swap through the filename-agnostic core" },
    { "topic": "local gitignore pattern set", "marker": "chosen", "value": "standard set plus .faffrc.yaml, minus the !.faff/anchors/ carve-out; target .git/info/exclude" },
    { "topic": "hooks presence read", "marker": "chosen", "value": "keep the union-of-both-files presence read; only the write target moves" },
    { "topic": "overlay-only config support", "marker": "assumes", "value": "CANONICAL_OVERLAY_CONFIG overlay-only read path fully supported (parent-validated)" }
  ] }
```
