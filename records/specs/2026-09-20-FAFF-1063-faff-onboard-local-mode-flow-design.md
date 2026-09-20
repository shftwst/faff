# Spec: faff-onboard local-mode flow (FAFF-1063)

> Spec: faffter-dark-nlspec · 2026-09-20 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1063.

This is the buildable spec for FAFF-1063, the onboard half of the FAFF-1059 local-mode split. Slice A (FAFF-1062) shipped the `--local` writers; this slice teaches `/faff-onboard` to opt into them. Audience: the build agent that implements it, and the human reviewers who gate the spec. It scopes the settled FAFF-1059 design down to the onboard flow only.

## 1. WHY

**The load-bearing model.** Local mode is not a new onboarding pipeline. Onboard resolves one boolean, `local`, exactly once, then runs its existing pipeline (bail check, detect, ask team_key, preview, confirm, write, gitignore-ensure, hooks-ensure, log) with two deltas: the config values it pins, and a `--local` flag threaded to every writer it invokes. Standard onboarding (no flag, no prompt-yes) takes the same code path it does today and produces byte-identical output.

**Problem.** Today `/faff-onboard` only ever writes a committable base `.faffrc.yaml`; a developer who wants faff configured privately on a shared repo, without committing config or letting build claims leave the box, has no first-run path. This change adds an opt-in local mode that redirects onboard's writes to the personal, uncommitted targets FAFF-1062 already built (`.faffrc.local.yaml`, `.git/info/exclude`, `.claude/settings.local.json`) and pins the two config values local mode needs (`bundle_store: local`, a real `tracking.label_prefix`).

**Design principles.**

**Non-destructive, append-only.** Local mode never rewrites or deletes an already-committed base `.faffrc.yaml`. If a base is present it is left byte-for-byte alone; the overlay is written alongside it. This is structural, not just polite: the FAFF-1062 writers target the overlay via `findOverlay`, so the base is untouchable by construction.

**One flag, one meaning.** The mode signal is a single boolean, `--local`, meaning "redirect this writer to its personal uncommitted target". Onboard resolves it once and threads the same flag to each writer. Bespoke per-writer local flags are rejected.

**Standard path frozen.** Any change that would alter standard onboarding's output is out of bounds. The local branch is additive; the standard branch is the untouched baseline the regression test pins.

**Reference context.**

| System | Location | Relevance |
|---|---|---|
| `plugin/skills/faff-onboard/SKILL.md` | Skill prose | The orchestrator this spec edits; no backing CLI |
| `plugin/skills/faff/bin/lib/config.js` | Node CLI | `config init` / `config set` `--local` writers; `TRACKING_KEYS`, `WRITABLE_NAMESPACES`, `LABEL_PREFIX_RE`, `gitIsTracked`, `cmdConfigCheck` |
| `plugin/skills/faff/bin/lib/gitignore-ensure.js` | Node CLI | `gitignore-ensure --local` targets `.git/info/exclude` with `FAFF_GITIGNORE_PATTERNS_LOCAL` |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | Node CLI | `hooks-ensure --local` writes `.claude/settings.local.json` |
| `plugin/skills/faff/bin/lib/labels.js` | Node CLI | `controlLabels(prefix)` derives `<prefix>-<role>` |
| `plugin/skills/faff/bin/lib/bundle.js` | Node CLI | `resolveBundleStoreName` reads top-level `bundle_store` |
| `test/decline-parity.test.mjs` | Test | The mechanical-onboard-sequence test shape the new test mirrors |

**Scope.** This is the onboard entry point into local mode; it configures a repo, it does not change how any writer or resolver behaves once configured.

## 2. Out of scope

- **The `--local` writers themselves**: shipped in FAFF-1062 (`config init`/`config set`/`gitignore-ensure`/`hooks-ensure` all already parse `--local`). This ticket only invokes them. Extension point: the writer libs under `plugin/skills/faff/bin/lib/`.
- **Honouring `bundle_store: local` at build-claim time**: onboard pins the value; the on-box guarantee that no `refs/faff/*` reach origin (the build-claim store reading `bundle_store`) is FAFF-1064's job. Extension point: `buildClaimStore` under `bundle.js`. The FAFF-1063 test asserts the pinned config value, not an empty `git ls-remote origin refs/faff/*`.
- **`faff config check` local-mode posture**: the config-check command is unchanged in v1; the existing overlay-not-gitignored warning is satisfied by the `.git/info/exclude` entry the `--local` gitignore-ensure writes. Extension point: `computeConfigCheck` in `config.js`.
- **`project_id` and any config key onboard does not detect today**: the write allowlist is untouched apart from adding `tracking.label_prefix`. Extension point: `config init`'s `TRACKING_KEYS`.
- **Migrating an existing base into an overlay**: no destructive migration verb. Extension point: a future `faff config` migration subcommand.

## 3. WHAT

**Vocabulary.**

| Term | Definition |
|---|---|
| local mode | Onboard writing to the personal, uncommitted overlay targets instead of the committable base |
| overlay | `.faffrc.local.yaml`, the gitignored machine-local config layer that wins over the base on merge |
| base | `.faffrc.yaml`, the single committable config file standard onboard writes |
| label_prefix | The control-label namespace; renders every control label as `<label_prefix>-<role>` (default `faff`) |
| committed base | A `.faffrc.yaml` that `git ls-files --error-unmatch` reports as tracked |

**The resolved decision.** Onboard computes one value early and carries it through:

```
RECORD OnboardMode:
  local: Boolean          # true iff --local flag OR interactive prompt answered yes
                          # non-interactive AND no --local => false (standard)
```

**The local-mode write set.** In local mode onboard pins two values on top of the standard detected set:

```
RECORD LocalWriteSet:
  # identical to standard onboard's detected tracking.* set, PLUS:
  tracking.label_prefix: String   # the derived/prompted prefix; in TRACKING_KEYS,
                                   # so it rides the single `config init --set` call
  bundle_store:          "local"  # TOP-LEVEL key, NOT in TRACKING_KEYS; needs a
                                   # SEPARATE `config set bundle_store local --local`

  CONSTRAINT label_prefix matches LABEL_PREFIX_RE = /^[A-Za-z0-9]([A-Za-z0-9_-]*[A-Za-z0-9])?$/
  CONSTRAINT every write carries --local (targets the overlay, never the base)
```

**The critical two-write split.** `config init --set tracking.<key>=<value>` validates each key against `TRACKING_KEYS` and exits 2 on anything outside it (`config.js` lines 888-889). `tracking.label_prefix` is in `TRACKING_KEYS`, so it goes in that one call. `bundle_store` is a top-level key (`config.js` DEFAULTS line 88; not under `tracking:`), rejected by `config init`, but present in `WRITABLE_NAMESPACES`, so it is written by the general scalar writer `faff config set bundle_store local --local`. Local mode therefore makes two config writes, both `--local`, both targeting `.faffrc.local.yaml`:

1. `faff config init --set tracking.<detected>=... --set tracking.label_prefix=<candidate> --local`
2. `faff config set bundle_store local --local`

**Design decisions (markers).**

- **Chosen:** one boolean `--local`, threaded unchanged to every writer; no per-writer local flags.
- **Chosen:** `bundle_store` is pinned by a separate `config set bundle_store local --local` call, because `config init`'s allowlist is `tracking.*` only; `tracking.label_prefix` rides the existing `config init --set` call.
- **Chosen:** `label_prefix` is derived from the tiered team_key discovery; when discovery yields no key, prompt and validate against `LABEL_PREFIX_RE`, re-prompting on failure.
- **Chosen:** in local mode a committed base triggers a warn-and-proceed, not the standard step-1 stop.
- **Assumes:** the FAFF-1062 writers are present on the build branch (see Assumptions).

## 4. HOW

**Approach.** All edits land in `plugin/skills/faff-onboard/SKILL.md` (prose orchestrator, no backing CLI). The pipeline stages are unchanged in name and order; local mode threads one decision through them.

```
resolve mode (0) -> bail check (1) -> detect (2) -> ask team_key + derive label_prefix (3)
  -> preview (4) -> confirm -> write config x2 (4) -> gitignore-ensure --local (5)
  -> hooks-ensure --local (5) -> log (7)
```

**Stage 0, resolve mode.** Behaviour summary: decide `local` once, before anything else, so every later stage reads a settled boolean.

```
PROCEDURE resolve_mode(argv, interactive):
  1. IF argv contains "--local": RETURN local = true
  2. IF interactive:
     a. Prompt "Set faff up in local (personal, uncommitted) mode? (y/N)"
     b. Default on empty answer is No; RETURN local = (answer is yes)
  3. RETURN local = false      # non-interactive, no flag => standard
```

**Stage 1, bail check (local-mode override).** Behaviour summary: standard mode keeps today's exact bail table; local mode relaxes the "config exists" stop so a personal overlay can be added on top of a committed base.

```
PROCEDURE bail(local):
  run `faff config path`, branch on exit code:
  - exit 2 (legacy-named config): surface the rename error verbatim, STOP    # both modes
  - exit 3 (no config): PROCEED to detect                                    # both modes
  - exit 0 (a config exists):
      IF NOT local: today's behaviour unchanged (decline-stub => proceed; real config => report + STOP)
      IF local:
        a. IF `.faffrc.yaml` is git-tracked (git ls-files --error-unmatch .faffrc.yaml exit 0):
             warn "a committed base .faffrc.yaml is tracked; local mode adds an overlay on
                   top of it but cannot hide the committed base"
        b. PROCEED to detect (the overlay writers target .faffrc.local.yaml; the base is
           never modified)
```

**Anti-pattern:** editing the standard-mode branch of the bail table. Why: the regression test pins standard output byte-for-byte; the override belongs strictly inside `IF local`.

**Stages 2 to 3, detect and derive the prefix.** Detection is unchanged (tracker MCP, git remote, docs layout). Local mode adds one derivation after team_key resolution.

```
PROCEDURE derive_label_prefix(team_key_result):
  1. IF a team_key was resolved (any tier: single-team confirm, pick-list, or free-text):
       candidate = that team_key                       # e.g. SHF -> passes LABEL_PREFIX_RE trivially
  2. ELSE (no tracker / no team concept, so no key):
       prompt "Control-label prefix for this repo?" as free text
       candidate = the answer
  3. validate candidate against LABEL_PREFIX_RE:
       IF invalid: re-prompt (step 2's prompt) until valid or the human aborts
  4. RETURN candidate
```

`controlLabels(prefix)` renders every control label as `<prefix>-<role>`; there is no `team_key`-to-role mapping. Onboard pins `tracking.label_prefix` to the team_key candidate, so labels render as `SHF-automate` rather than the default `faff-automate` only because the prefix now equals `SHF`.

**Stage 4, preview then two writes.** Behaviour summary: the dry-run preview shows the overlay targets and both pinned values; one confirm gate; then the two `--local` config writes.

```
PROCEDURE write_config(local, detected, label_prefix):
  1. build the `config init --set tracking.<k>=<v>` list from detected keys (today's set)
  2. IF local: append `--set tracking.label_prefix=<label_prefix>` and the `--local` flag
  3. dry-run that command; preview shows the exact .faffrc.local.yaml (local) or .faffrc.yaml (standard)
  4. IF local: preview ALSO shows the pending `config set bundle_store local --local`
  5. the "commit the base" recommendation appears ONLY when NOT local
  6. one confirm gate
  7. on confirm:
     a. run the config init command (with --local iff local)
     b. IF local: run `faff config set bundle_store local --local`
```

**Stage 5, ensurers.** Both run with the resolved flag: `faff gitignore-ensure` gains `--local` in local mode (writes `FAFF_GITIGNORE_PATTERNS_LOCAL` to `.git/info/exclude`, which includes `.faffrc.yaml`, `.faffrc.*.yaml`, and `.faff/`, and leaves `.gitignore` untouched); `faff hooks-ensure` gains `--local` in local mode (writes `.claude/settings.local.json`, leaving `.claude/settings.json` untouched). Standard mode passes neither flag and behaves exactly as today.

**Stage 7, log and report.** The closing report names the overlay path, the pinned values, and (local only) the `.git/info/exclude` and `settings.local.json` targets. The "commit `.faffrc.yaml`" recommendation is standard-mode only.

**Edge cases.**

| Case | Handling |
|---|---|
| `--local` on a fresh repo (no config) | exit 3, proceed; overlay is the only config; `config path` then exits 0 printing `.faffrc.local.yaml` |
| committed base present, `--local` | warn (base tracked, cannot be hidden), proceed, write overlay, base untouched |
| uncommitted base present, `--local` | proceed non-destructively; the overlay writers target `.faffrc.local.yaml` regardless of a base |
| no tracker MCP (git-only) + `--local` | no team_key to derive from; free-text prompt for the prefix, validated against `LABEL_PREFIX_RE` |
| non-interactive, no `--local` | standard mode, unchanged |
| prefix prompt answered with an invalid value | re-prompt until valid; never persist an invalid prefix (`validateLabelPrefix` also refuses it at write time) |

**Failure modes.**

- **The failure:** the FAFF-1062 writers are absent on the build branch (the current `chore/faffrc-context-windows` HEAD predates the merge). How you would know: `faff gitignore-ensure --local` errors on an unknown flag, or `config init --local` writes the base instead of the overlay. What it means: rebase the build branch onto origin/main (which carries merge commit `06635550`) before implementing; this is a hard prerequisite, not an optional order.
- **The failure:** `.claude/settings.local.json` shows up as an untracked file after a local onboard, on a repo whose `.gitignore` does not already exclude it. How you would know: `git status --porcelain` lists `.claude/settings.local.json`. What it means: this is Claude Code's own personal-settings file, outside faff's `FAFF_GITIGNORE_PATTERNS_LOCAL`; the git-status-clean acceptance for this ticket is scoped to faff's own machinery (`.faffrc.local.yaml`, `.faff/`), which `.git/info/exclude` does cover. If broader coverage is wanted, that is a change to FAFF-1062's local exclude set, not an onboard-side workaround.

**Anti-pattern:** folding `bundle_store` into the `config init --set` call. Why: `config init` exits 2 on any key outside `TRACKING_KEYS`, and `bundle_store` is top-level, so the run fails.

**Anti-pattern:** adding `.claude/settings.local.json` to an ignore file from within onboard. Why: the ignore-target contract lives in the `gitignore-ensure` writer (FAFF-1062); onboard threads `--local`, it does not hand-manage patterns.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a fresh git repo with no faff config
When I run faff-onboard --local and confirm the write
Then .faffrc.local.yaml exists containing bundle_store: local and tracking.label_prefix
 And .faffrc.yaml does not exist
 And .git/info/exclude carries the faff local patterns
 And .gitignore does not exist
 And .claude/settings.local.json carries the faff Stop hooks
 And .claude/settings.json does not exist
```

```
Given a repo whose tracker MCP resolves team_key SHF
When I onboard in local mode
Then tracking.label_prefix resolves to SHF
 And control labels render as SHF-automate (not faff-automate)
```

```
Given a repo with a committed, git-tracked .faffrc.yaml
When I run faff-onboard --local
Then a warning states the committed base cannot be hidden by local mode
 And .faffrc.yaml is left byte-for-byte unmodified
 And the overlay is written alongside it
```

- After a local onboard, `git status --porcelain` lists neither `.faffrc.local.yaml` nor `.faff/` (both covered by `.git/info/exclude`).
- The tracker stays connected: `tracking.tracker` is never set to `none` by local mode.

## 6. Design decision rationale

**How is local mode signalled and carried?** Options: (a) one boolean `--local` resolved once and threaded; (b) per-writer local flags onboard sets independently. Option (b) invites drift (one writer local, another not) and duplicates the decision. **Chosen:** (a) one boolean, resolved at stage 0, threaded unchanged, matching the FAFF-1059 parent design and the FAFF-1062 writer surface which already takes a single `--local`.

**How is `bundle_store: local` written?** Options: (a) fold into the `config init --set` call; (b) a separate `config set bundle_store local --local`. Option (a) fails: `config init` validates against `TRACKING_KEYS` and `bundle_store` is a top-level key, so the call exits 2. **Chosen:** (b) a separate `config set` call; `bundle_store` is in `WRITABLE_NAMESPACES`, which is exactly what `config set` accepts. `tracking.label_prefix` is in `TRACKING_KEYS`, so it stays in the `config init --set` call.

**Where does `label_prefix` come from?** Options: (a) always prompt; (b) derive from the team_key discovery, prompting only when there is no key. Prompting when a key is already known is redundant interrogation. **Chosen:** (b) reuse the tiered team_key discovery result as the candidate, prompt only in the no-key case, and validate against `LABEL_PREFIX_RE` in both paths.

**What happens on a committed base in local mode?** Options: (a) keep the standard step-1 stop ("already set up"); (b) warn and proceed non-destructively. Option (a) blocks the legitimate flow of adding a personal overlay on top of a team-committed base. **Chosen:** (b) warn that the tracked base cannot be hidden, then proceed; non-destructiveness is guaranteed by the overlay-targeting writers, so the warn is informational.

**What does "git status clean" cover?** Options: (a) assert an empty `git status`; (b) assert faff's own machinery is excluded. On a bare test repo `.claude/settings.local.json` is Claude Code's file, outside faff's exclude remit. **Chosen:** (b) scope the acceptance to `.faffrc.local.yaml` and `.faff/`, which `.git/info/exclude` covers; broadening to `settings.local.json` is a FAFF-1062 exclude-set change, not an onboard concern.

## 7. Open questions and assumptions

**Open questions.** None. The design is settled by the FAFF-1059 parent spec and the confirmed FAFF-1062 writer surface.

**Assumptions.**

- **Assumes:** the FAFF-1062 `--local` writers are on the build branch. Validation: `git merge-base --is-ancestor 06635550 HEAD` must succeed; on the current `chore/faffrc-context-windows` HEAD it does not, so the build branch must rebase onto origin/main before implementing.
- **Assumes:** `.claude/settings.local.json` is kept out of `git status` by Claude Code's own convention on a real repo. Validation: the new test scopes its git-status assertion to faff machinery, so it does not depend on this holding; if broader cleanliness is required it is a FAFF-1062 follow-up.
- **Assumes:** `bundle_store: local` is honoured at build-claim time by FAFF-1064. Validation: out of scope here; this ticket's test asserts the pinned config value only, not an empty `git ls-remote origin refs/faff/*`.

## 8. DONE

### From WHY
- [ ] Standard onboarding (no `--local`, prompt answered No) produces a `.faffrc.yaml` and `.claude/settings.json` byte-for-byte identical to the pre-change baseline, and creates no `.git/info/exclude` entry and no `.faffrc.local.yaml`.
- [ ] A single resolved `local` boolean governs the whole flow (flag, or interactive prompt defaulting to No; non-interactive without the flag is standard).

### From WHAT (write set)
- [ ] `faff-onboard --local` on a fresh repo writes `.faffrc.local.yaml` and no `.faffrc.yaml`.
- [ ] The overlay contains top-level `bundle_store: local` and `tracking.label_prefix`.
- [ ] `bundle_store` is written by a `faff config set bundle_store local --local` call; `tracking.label_prefix` rides the `faff config init --set ... --local` call.

### From WHAT (label prefix)
- [ ] With a resolved team_key `SHF`, `tracking.label_prefix` is `SHF` and control labels render as `SHF-automate`.
- [ ] With no team_key available, onboard prompts for a prefix, rejects a value failing `LABEL_PREFIX_RE`, and persists only a valid one.

### From HOW (bail override)
- [ ] Standard-mode bail behaviour is unchanged.
- [ ] `--local` on a repo with a committed, git-tracked `.faffrc.yaml` warns and proceeds, leaving `.faffrc.yaml` byte-for-byte unmodified.

### From HOW (ensurers, threaded flag)
- [ ] Local mode runs `faff gitignore-ensure --local` (ignore rules to `.git/info/exclude`; `.gitignore` untouched).
- [ ] Local mode runs `faff hooks-ensure --local` (hooks to `.claude/settings.local.json`; `.claude/settings.json` untouched).

### From HOW (invariants)
- [ ] `tracking.tracker` is never set to `none` by local mode (the tracker stays connected).
- [ ] After a local onboard, `git status --porcelain` lists neither `.faffrc.local.yaml` nor `.faff/`.
- [ ] The "commit the base" recommendation appears only in standard mode; the preview shows overlay targets in local mode.

### From testing
- [ ] Net-new `test/onboard-local.test.mjs` covers: the `--local` fresh-repo sequence (overlay contents, exclude target, hooks target, untouched `.gitignore`/`settings.json`), the standard-mode byte-for-byte golden regression, and the committed-base warn-and-leave-unmodified case.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. git init a throwaway repo
  2. drive the local sequence against the real CLI (mirror decline-parity.test.mjs run/seedGitRepo):
     a. faff config init --set tracking.team_key=SHF --set tracking.label_prefix=SHF --local
     b. faff config set bundle_store local --local
     c. faff gitignore-ensure --local
     d. faff hooks-ensure --local --json
  3. ASSERT .faffrc.local.yaml exists with bundle_store: local and tracking.label_prefix: SHF
  4. ASSERT .faffrc.yaml absent; .gitignore absent; .claude/settings.json absent
  5. ASSERT .git/info/exclude carries the faff local patterns
  6. ASSERT .claude/settings.local.json carries runcheck + prepcheck Stop hooks
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "topic": "mode-signal shape", "marker": "chosen", "value": "single --local flag threaded unchanged to every writer; no per-writer local flags" },
    { "topic": "bundle_store write path", "marker": "chosen", "value": "separate config set bundle_store local --local; tracking.label_prefix rides the config init --set call" },
    { "topic": "label_prefix derivation", "marker": "chosen", "value": "derive from tiered team_key discovery; prompt + LABEL_PREFIX_RE validate when no key" },
    { "topic": "committed base in local mode", "marker": "chosen", "value": "warn and proceed non-destructively; never rewrite/delete the base" },
    { "topic": "git-status-clean scope", "marker": "chosen", "value": "scope to faff machinery (.faffrc.local.yaml, .faff/); settings.local.json is a FAFF-1062 concern" },
    { "topic": "FAFF-1062 writers on build branch", "marker": "assumes", "value": "build branch must rebase origin/main (merge 06635550) before implementing" },
    { "topic": "settings.local.json git-status convention", "marker": "assumes", "value": "kept out of git status by Claude Code convention; test scopes around it" },
    { "topic": "bundle_store honoured at build-claim time", "marker": "assumes", "value": "FAFF-1064 delivers the on-box build-claim; this ticket only pins the value" }
  ] }
```