# FAFF-684 — config-driven skill install-target list

> Spec: faffter-dark-nlspec · 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-684.

_Revised 2026-08-04 — re-prep after FAFF-676 merged (PR #551). The open scope Punt is resolved (FAFF-676 shipped its plural doctor scan set without a config read, so FAFF-684 layers the config source on top — see §6); the `blockedBy FAFF-676` edge is now satisfied; the doctor section is re-read against the landed `resolveDoctorScanSet`; confidence raised medium → high._

Design spec for **FAFF-684 — config-driven skill install-target list**, in the project "Harness-agnostic runtime — the loop runs under Codex CLI". Written for the build agent implementing the change and for the humans reviewing it. Everything the build needs is here; the FAFF-672 / FAFF-676 specs are useful background but not required reading.

## 1. WHY — problem and principles

**The load-bearing model.** faff's `--global` installer writes one symlink per skill into a fixed pair of directories — `~/.claude/skills` and `~/.agents/skills` — and `faff doctor` now scans that same pair for install health (FAFF-676, landed). That pair is compiled into both the bash script and the Node doctor. An adopter running a harness faff has never heard of, whose skills auto-load from some third directory, has no way to add it short of editing `scripts/link-skills.sh` and `gates.js`. This change turns the pair into a value read from config, defaulting to exactly today's pair, so pointing faff at another harness's directory is a one-line entry in `.faffrc.yaml` instead of a fork of the installer.

**Problem statement.** The install-target list is hardcoded in two places, so the set of harnesses faff can install itself into and health-check is fixed at build time. This change adds one config key — an ordered list of install directories — that both the installer and `faff doctor` read; when the key is unset, both fall back to today's hardcoded pair and nothing changes. It is the deferred half of FAFF-672, which shipped the hardcoded pair and left "hardcoded vs config-driven" for a human to settle. FAFF-684 is that settlement: config-driven, additive, default unchanged.

**The current state this rests on, stated plainly.** Both halves of FAFF-672's "two directories" model have now shipped:

- The **installer** (FAFF-672, PR #507): `scripts/link-skills.sh --global` writes both targets from an ordered `TARGET_DIRS` array (built at lines 120-125, deduped at 125, iterated by four operational blocks — `--status` at 184, `--unlink` at 263, create at 335, `--prune` at 393).
- The **doctor** (FAFF-676, PR #551, **Done 2026-08-04**): `resolveDoctorScanSet(targetFlag, pluginRootEnv, home)` (`gates.js:512-517`) resolves a plural, resolved-path-deduped default scan set — the hardcoded pair `[~/.claude/skills, ~/.agents/skills]` at line 515 — and `cmdDoctor` (601) scans every directory, so a half-install (healthy in one, missing from the other) exits 1 and is named per directory.

So installer and doctor now **agree** on the two directories — but both still name the pair *literally* (`link-skills.sh:121`, `gates.js:515`). Neither reads it from config. FAFF-684 makes that one shared list a config value.

> **Cross-ticket note (re-read discharged at re-prep, 2026-08-04).** FAFF-676 ("faff doctor scans one directory… (doctor half)") is now **Done** — it landed the plural scan set, the half-install `missing_here` naming, the exit-code contract, and the gateway-preamble gloss. This spec's doctor section was written against the pre-FAFF-676 single-target code and has now been re-read against the landed change: `resolveDoctorScanSet` exists, takes `(targetFlag, pluginRootEnv, home)`, and returns `{ scanSet, collapseNotices }` with `dedupeByResolvedPath` (`gates.js:522`) already handling collapse notices. FAFF-684's doctor change is exactly the thin layering §3/§4 describe — thread the config read in and prefer it over the hardcoded-pair fallback. The `blockedBy FAFF-676` edge is now a **satisfied edge** (target Done).

### Design principles

**The target list has one source of truth, and both consumers read it.** If the installer's targets become a config key but doctor keeps naming `[~/.claude/skills, ~/.agents/skills]` literally, an adopter who repoints faff at a third directory gets a green doctor on a machine where half the installs are unchecked — the drift FAFF-676's landed agreement test (`test/link-skills-worktree.test.mjs`, the installer-and-doctor agreement case) exists to forbid. The config key is the single source; the installer builds `TARGET_DIRS` from it and doctor builds its scan set from it. Neither restates the list except as the shared fallback default.

**A broken config must never zero the target list.** The installer reads config from a bash context during bootstrap. Every way that read can fail — `node` absent, the bundled CLI unreadable, a malformed rc, an empty result, the key simply unset — falls back to the hardcoded pair. There is no code path in which a config problem leaves a machine installing skills into zero directories. A failed read degrades to today's behaviour, loudly on an unexpected error and silently when the key is merely unset.

**Unset is byte-for-byte today, for both consumers.** With the key absent, the installer builds exactly `[~/.claude/skills, ~/.agents/skills]` in global mode and `[<repo>/.claude/skills]` in local mode — the same array FAFF-672 ships — and doctor resolves exactly FAFF-676's landed default pair. Both feed the same dedupe and the same downstream iteration. Unset changes nothing, including stdout.

**Every landed FAFF-672 / FAFF-676 invariant survives untouched.** Resolved-path dedupe, the name-scoped `--replace` blast radius, every-target-visited, the single-source `SRC_ROOT`/`SKILLS_ROOT`/`SRC_DIR`, the aggregate exit rule, doctor's per-directory `missing_here` naming and exit-code contract — none of these change. This change swaps *where the shared list's contents come from*; it does not touch how either consumer uses the list.

### Reference context

| File | Language | Relevance |
|---|---|---|
| `scripts/link-skills.sh` | Bash | The installer. `TARGET_DIRS` built at 120-125, deduped at 125 (`dedupe_by_resolved_path`, 103-118); `SRC_ROOT` retarget at 133-161; `BIN_SRC` derived at 164. This change moves the array build to after 164 and sources it from config. |
| `plugin/skills/faff/bin/lib/gates.js` | Node (CommonJS) | `resolveDoctorScanSet` (512-517) resolves the plural default scan set; `dedupeByResolvedPath` (522-537) returns `{scanSet, collapseNotices}`; `cmdDoctor` (601) has `root` (from `findRoot()`, 606) available to pass a resolver root; `cmdSync` shells `--global --replace`; the file already imports `loadConfig` / `dig` and reads a config list via them (`gates.fallback`). **Shared surface with FAFF-675 / FAFF-685.** |
| `plugin/skills/faff/bin/lib/config.js` | Node | The resolver. `loadConfig(root)` returns `[data, …]`; FAFF-262 block-sequence parsing turns a YAML list into a JS array; `faff config get <listkey>` prints comma-joined scalars, `--json` a JSON array, exit 3 when absent. Confirmed at re-prep against `faffter_dark.adversarial.refs` (a landed list-of-scalars key). |
| `.faffrc.yaml` | YAML | Where an adopter authors the key. Already carries a list-of-scalars precedent: `faffter_dark.adversarial.refs`. |
| `plugin/skills/faff/SKILL.md` | Markdown | The documented `.faffrc.yaml` schema block. A new key is documented here; uses a `~/`-style path value already (`worktree_root`). |
| `docs/guide/cli.md` | Markdown | `doctor` (22) and `sync` (23) descriptions. |
| `test/link-skills-worktree.test.mjs`, `test/doctor.test.mjs`, `test/sync.test.mjs` | Node test runner | Where the new tests land; the first two host the config-driven cases and the installer-and-doctor agreement case FAFF-676 landed. |

**Scope.** This is an install-layer ergonomics change to the harness-agnostic project: it makes the shared set of directories faff installs into and checks a config value rather than a source edit. It changes nothing about what the skills contain, how the loop runs, or how a healthy install is classified.

## 2. OUT OF SCOPE

- **Making doctor's scan set plural / the cross-target `missing_here` half-install comparison.** This shipped in **FAFF-676** (Done). FAFF-684 makes the already-plural default scan set config-*sourced*; it does not itself introduce plurality or presence-diffing. *Why excluded:* FAFF-676 owns and has landed it. *Extension point:* FAFF-684's doctor change layers the config read over FAFF-676's `resolveDoctorScanSet`.

- **Repo-local (non-`--global`) mode.** The default mode still links only into `<repo>/.claude/skills`, and the config key is not consulted there. *Why excluded:* the ticket and its predecessors scope the machine-wide install; whether a project-level `.agents/skills` is even read by codex is a separate, unprobed question. *Extension point:* the local-mode branch of the target-list build, plus the same config key with a local sub-list if ever wanted.

- **Codex discovery for marketplace-plugin installs.** A plugin-installed machine never runs `scripts/link-skills.sh` and has its skills under `$CLAUDE_PLUGIN_ROOT/skills`. *Why excluded:* this change reads a config key at install time; a plugin machine has no install-time step to read it. *Extension point:* the plugin packaging (its own ticket, FAFF-685). Doctor's `$CLAUDE_PLUGIN_ROOT` branch stays single-target and does not consult the config key.

- **A `--targets` flag on the installer or doctor.** *Why excluded:* the config key is the configuration surface; a flag would be a second one. Doctor's existing `--target` (single, `arity: 1`) stays exactly as-is for pinned testing. *Extension point:* none intended.

- **Schema validation / a typed config surface for the key.** The key is a plain list of strings; a bad entry is tolerated by fallback and skipping, not rejected by a validator. *Why excluded:* faff has no per-key schema layer today and the fail-safe fallback already bounds the damage. *Extension point:* `config check` if install-target validation is ever wanted as a lint. *(Infosec note: if the destructive `--replace`/`rm -rf` path is ever driven off a configured target, constrain entries to a `$HOME`-relative prefix or state the commit-time trust boundary explicitly — see §6.)*

## 3. WHAT — vocabulary, types, interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Install target | A directory a harness scans for skills, into which the installer places one symlink per faff skill. |
| Target list | The ordered set of install targets. Hardcoded today; config-driven after this change, defaulting to the hardcoded pair. |
| Scan set | The ordered set of directories `faff doctor` inspects. FAFF-676 made its default the pair (landed); FAFF-684 makes that default config-sourced. |
| Configured targets | The value of the new config key, if set and usable. |
| Default pair | `[~/.claude/skills, ~/.agents/skills]` in global mode — the fallback when the key is unset or unreadable, in both the installer (`link-skills.sh:121`) and doctor (`gates.js:515`). |

### The config key

```
KEY install.skill_targets:
  shape: YAML sequence of strings          # a list/sequence, never a map — `config get`
                                           #   of a map prints "[object Object]"
  each entry: an absolute path, OR a path whose leading "~" expands to $HOME
  applies to: --global installs and doctor's default scan set ONLY
  default when unset: the hardcoded pair (installer link-skills.sh:121 / doctor gates.js:515)

  CONSTRAINT entries are order-significant; document order is install/scan order
  CONSTRAINT the resolved list is de-duplicated by resolved path, exactly as the
             hardcoded pair is today
  CONSTRAINT a non-absolute, non-"~" entry is unusable — it is skipped with a
             notice, never joined against a working directory
```

Authored in `.faffrc.yaml` by hand (the expected path for a list — `faff config init` / `faff config set` only writes scalar leaves; sequence keys are a committed-base hand-edit, exactly as `faffter_dark.adversarial.refs` is), for example:

```yaml
install:
  skill_targets:
    - ~/.claude/skills
    - ~/.agents/skills
    - ~/.config/some-other-harness/skills
```

`faff config get install.skill_targets` returns the entries comma-joined (bash reads them with `IFS=',' read -ra`); `--json` returns a JSON array; an absent key exits 3 with empty output. (Confirmed at re-prep: `faff config get faffter_dark.adversarial.refs` already prints `nvidia-glm,openrouter,gemini-gemma` — the exact idiom, no new resolver code.)

### Path expansion

```
FUNCTION expand_target(entry, HOME):
  IF entry == "~"            RETURN HOME
  IF entry starts with "~/"  RETURN HOME + entry[1:]      # drop the "~", keep "/…"
  IF entry is absolute       RETURN entry
  ELSE                       RETURN <unusable>            # caller skips + warns
```

The installer (bash) and doctor (Node) apply the *identical* rule, so a committed `.faffrc.yaml` resolves to the same directories under both. `$HOME`-relative paths are written `~/…`; a literal `$HOME` in a quoted YAML scalar is **not** shell-expanded and is treated as a non-absolute unusable entry — the schema doc says to use `~`. (Architectural note: an *unquoted* leading `~` may parse as null under the FAFF-262 subset — the build must confirm the parse and, if so, require the `~` entry be quoted in the schema doc, or accept only absolute paths.)

### Doctor scan-set resolution (layered over landed FAFF-676)

```
FUNCTION resolveDoctorScanSet(targetFlag, pluginRootEnv, home, root):   # + root, for the config read
  1. IF targetFlag given:    RETURN { scanSet: [targetFlag], collapseNotices: [] }   # arity 1 — unchanged
  2. IF pluginRootEnv set:   RETURN { scanSet: [pluginRootEnv + "/skills"], collapseNotices: [] }   # unchanged, single
  3. configured = expand each usable entry of dig(loadConfig(root)[0], "install.skill_targets")
  4. candidates = (configured is a non-empty list) ? configured
                                                   : [home/.claude/skills, home/.agents/skills]   # FAFF-676's landed default
  5. RETURN dedupeByResolvedPath(candidates)        # unchanged — already returns { scanSet, collapseNotices }
```

FAFF-684 adds only steps 3-4 (the config override) to the landed `resolveDoctorScanSet`, plus threading a resolver `root` (available in `cmdDoctor` at 606) into the call at `gates.js:608`. The plural default, `dedupeByResolvedPath`, the per-directory iteration, the `missing_here` naming, and the exit-code contract are FAFF-676's, landed, untouched.

## 4. HOW — behaviour

### The installer

**Where the list is built moves; how it is consumed does not.** Today `TARGET_DIRS` is built at lines 120-125, *before* the FAFF-443 worktree retarget and *before* `BIN_SRC` is derived. The config read needs the bundled CLI, which is `BIN_SRC` (`$SRC_DIR/faff/bin/faff`, line 164), and that is only known after retargeting (133-161). So the array construction relocates to immediately after line 164. Nothing between the old and new build sites reads `TARGET_DIRS` — the retarget block (133-161) reads `REPO_ROOT`/`GLOBAL`/`UNLINK`/`STATUS`, skill discovery (169-179) reads `SRC_DIR`, and the first `TARGET_DIRS` consumer is the `--status` block at 184 — so the move is safe. `dedupe_by_resolved_path` and `resolve_path` are defined at 88-118, above the new site. (Architectural note: relocating the build below 164 shifts stderr ordering relative to the FAFF-443 retarget warning; the "byte-for-byte" claim is about the *filesystem effect and stdout* — the build must verify stderr-ordering does not regress any test, or scope the byte-for-byte claim to stdout explicitly.)

```
PROCEDURE build_target_dirs(GLOBAL, REPO_ROOT, HOME, BIN_SRC, SRC_ROOT):
  1. IF NOT GLOBAL:
     a. TARGET_DIRS = [ REPO_ROOT + "/.claude/skills" ]   # local mode — config NOT consulted
     b. RETURN                                            # (dedupe still runs at the call site)
  2. configured = read_configured_targets(BIN_SRC, SRC_ROOT, HOME)
  3. IF configured is a non-empty list:  TARGET_DIRS = configured
     ELSE:                               TARGET_DIRS = [ HOME/.claude/skills, HOME/.agents/skills ]
  4. dedupe_by_resolved_path            # rewrites TARGET_DIRS in place, exactly as today
```

**Behaviour summary — the read is a best-effort enrichment with a guaranteed floor.** `read_configured_targets` tries to get a usable list from config; any failure returns empty and the caller falls to the hardcoded pair.

```
PROCEDURE read_configured_targets(BIN_SRC, SRC_ROOT, HOME):
  1. IF node is not available OR BIN_SRC is not a readable file:
     a. RETURN []                       # silent — bootstrap edge, floor covers it
  2. out = ( cd "$SRC_ROOT" && node "$BIN_SRC" config get install.skill_targets ) 2>/dev/null
     status = exit code of that command
  3. IF status == 3 (key absent):       RETURN []          # SILENT — unset is the normal default
  4. IF status != 0:                     warn to stderr; RETURN []   # unexpected read failure → floor
  5. IF out is empty/whitespace:         RETURN []          # empty result → floor
  6. IFS=',' read the comma-joined scalars into raw[]
  7. expanded = []
     FOR EACH e in raw:
        t = expand_target(trim(e), HOME)
        IF t is <unusable>:  warn "ignoring install target <e> — not absolute or ~-relative"; CONTINUE
        expanded += t
  8. IF expanded is empty:               RETURN []          # every entry unusable → floor
  9. RETURN expanded
```

- The read runs with `cd "$SRC_ROOT"` so `faff config get` resolves the checkout's `.faffrc.yaml` (its resolver walks up from the working directory), the same rc the rest of faff sees. Overlay merge (`.faffrc.local.yaml`) is handled by the resolver, so a machine-local override lands for free. (Architectural note: `SRC_ROOT` is the checkout root, `SKILLS_ROOT`/`SRC_DIR` are `$SRC_ROOT/plugin/skills` — anchor the `cd` on `SRC_ROOT` and cite it unambiguously, not `SRC_DIR`.)
- Distinguishing exit 3 (key absent, silent) from other non-zero (unexpected, warned) keeps the common "no key set" case quiet — the whole design promise is that unset changes nothing, including the output.

**Anti-pattern:** hand-reading `.faffrc.yaml` from bash with `grep`/`sed`. Why: the gateway's config rules forbid it, the resolver alone handles overlay merge, legacy filenames and the malformed-base loud-exit, and a hand-read silently dropped configured values twice before. The bundled CLI by path is the only correct read.

**Anti-pattern:** building `TARGET_DIRS` from config before `SRC_ROOT`/`BIN_SRC` are resolved. Why: `BIN_SRC` does not exist yet, and for a worktree `--global` install the retarget must pick `BIN_SRC` from the main checkout first, or the read runs against the wrong CLI.

**Anti-pattern:** letting a config failure abort the run under `set -euo pipefail`. Why: the mandatory floor is that a broken config degrades to the hardcoded pair; the read must swallow its own failure (`2>/dev/null`, captured status) and never let `errexit` kill the installer.

**Anti-pattern:** consulting the config key in local (non-`--global`) mode. Why: local mode is repo-relative dev-linking, out of scope here, and must stay byte-for-byte `[<repo>/.claude/skills]`.

Everything downstream of the array build is unchanged: the `--status`, `--unlink`, create and `--prune` blocks iterate `TARGET_DIRS` exactly as they do today, with the same single-run headers/counters and the same aggregate exit rule. A longer list simply means more iterations of loops that already exist.

### `faff doctor` (layered on landed FAFF-676)

FAFF-676 already made `cmdDoctor` resolve a plural, resolved-path-deduped scan set and iterate it. FAFF-684's change is small: add steps 3-4 of `resolveDoctorScanSet` above so a set `install.skill_targets` overrides the default scan set, expanded with the identical `~`-rule and run through the same `dedupeByResolvedPath` (which already returns the collapse notices). Thread the resolver `root` (already computed in `cmdDoctor` at 606) into the `resolveDoctorScanSet` call at 608. The per-directory classification, the `missing_here` naming, the exit-code contract, and the once-per-invocation checks — all FAFF-676's — are untouched.

Doctor reads the key via the existing `loadConfig` + `dig` idiom already used for `gates.fallback`: `dig(loadConfig(root)[0], "install.skill_targets")` yields the array (FAFF-262 parses the sequence); expansion + the existing dedupe are the only additions. No new parser, no PATH dependency (Node has the resolver in-process).

**Anti-pattern:** teaching `cmdSync` about targets. Why: `cmdSync` passes `--global --replace` and no target flags, and the installer alone owns the list — it now owns it *via the config key*, which `cmdSync` inherits for free by shelling the installer. It stays a thin wrapper, untouched by this change.

### Aliased and degenerate targets

The resolved-path dedupe already handles a user who symlinked one target at another. It now also collapses two *config* entries that resolve to the same directory — the same `dedupe_by_resolved_path` (bash) / `dedupeByResolvedPath` (Node, `gates.js:522`), applied to the configured list before any block or scan iterates it, emitting the same collapse notice. A path that does not exist resolves to itself and aliases nothing. An empty configured list, a whitespace-only key, or a list whose every entry is unusable all resolve to the default, never to an empty target set.

### Failure modes

- **The failure: the bash config read silently returns the wrong directories** (the resolver picks up a different `.faffrc.yaml` than the rest of faff). *How you'd know:* the installer's `Targets:` header (printed before linking, line 322) names directories that don't match `faff config resolved` / the committed rc. *What it means:* the `cd "$SRC_ROOT"` anchor is wrong; fix the read's working directory. The printed header is the observable — it must always list the actual targets used.

- **The failure: fallback masks a genuinely broken config forever.** Any read failure degrades to the pair, so an adopter who typo'd the YAML gets the *default* targets and a working install, and may never notice their key is ignored. *How you'd know:* the stderr warning on a non-3 non-zero read, and the `Targets:` header showing the pair instead of their entry. *What it means:* proceed — a working default beats a broken install — but the warning must fire on the unexpected-failure path (not the unset path), or the silent-mask becomes total.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given no install.skill_targets key in .faffrc.yaml
When scripts/link-skills.sh --global runs from the main checkout
Then TARGET_DIRS is exactly [~/.claude/skills, ~/.agents/skills]
 And every discovered skill is symlinked into both, identical to the FAFF-672 behaviour
 And the run's stdout is byte-identical to the pre-change build and no config-read warning is printed to stderr
```

```
Given install.skill_targets is set to [~/.claude/skills, ~/.agents/skills, ~/.h3/skills]
When scripts/link-skills.sh --global runs
Then every discovered skill is symlinked into all three directories
 And each symlink resolves under the source checkout's plugin/skills
```

```
Given install.skill_targets is present but its value is malformed (the read exits non-zero, not 3)
When scripts/link-skills.sh --global runs
Then TARGET_DIRS falls back to [~/.claude/skills, ~/.agents/skills]
 And a warning naming the failed read is printed to stderr
 And the install COMPLETES into the default pair (symlinks present in both), not merely computes the array
```

```
Given node is not on PATH and BIN_SRC is unreadable
When scripts/link-skills.sh --global runs
Then the config read returns nothing, no error aborts the run under set -euo pipefail
 And the install completes into the default pair (symlinks present in both directories)
```

```
Given install.skill_targets set to a third directory
When faff sync runs (shells link-skills.sh --global --replace)
Then the third directory receives the skill symlinks too — proving targets flow through sync unchanged
```

- The installer MUST NOT consult the config key in local (non-`--global`) mode; local mode's target list is exactly `[<repo>/.claude/skills]`.
- `cmdSync` MUST remain unchanged: it passes `--global --replace` and no target flags, and MUST NOT read the config key itself.
- `faff doctor --target DIR` MUST scan exactly that one directory and MUST NOT read `install.skill_targets`.
- With the key unset, the installer's stdout and filesystem effect MUST be byte-for-byte identical to the pre-change build.

## 6. Design decision rationale

**Hardcoded or config-driven target list?** — the Punt FAFF-672 left open. Options: keep the pair compiled in; a config key; a `--targets` flag. FAFF-672 shipped hardcoded with the ordered-list shape chosen so a config key could later populate it, and deferred the choice — the objection was that bash has no obvious access to the config resolver during bootstrap, and no config key named an install location. Both objections are answerable now: the installer already resolves the bundled CLI to a concrete path (`BIN_SRC`), so it can run `node "$BIN_SRC" config get …` without `faff` being on PATH; and adding the first filesystem-install key is exactly what this ticket authorises. **Chosen:** config-driven — a single `install.skill_targets` list, read by both installer and doctor, defaulting to today's pair. Additive: unset reproduces the FAFF-672/676 behaviour exactly. A flag is rejected as a second configuration surface over a value that belongs in durable config.

**What is the key's name and shape?** `config get` of a map prints `[object Object]`, so the key must be a list/sequence. **Chosen:** `install.skill_targets`, a YAML sequence of strings under a new top-level `install:` map — mirrors the existing `faffter_dark.adversarial.refs` precedent, parses cleanly under FAFF-262, self-documents at the top of the rc file, and leaves a home for future install keys.

**How are `$HOME`-relative and absolute paths handled?** A literal `$HOME` in a quoted YAML scalar is never shell-expanded. **Chosen:** absolute paths plus a leading `~` expanded to `$HOME` by both consumers with the identical rule — matches the `~/`-style value shown for `worktree_root` and keeps a committed base portable. A non-absolute, non-`~` entry is unusable — skipped with a notice. *(Infosec: absolute paths pass unconstrained today; if the destructive `--replace` path is ever driven off a configured target, add a `$HOME`-prefix constraint or state the commit-time trust boundary — see §2's schema-validation out-of-scope note. The `--replace` blast radius stays name-scoped to faff-owned entries regardless of target, so a configured target still only ever `rm`s faff's own symlinks, not arbitrary directory contents — the existing FAFF-672 name-scoping bound is the backstop.)*

**Does the config key govern local mode too?** **Chosen:** global + doctor-default only. Local mode stays hardcoded `[<repo>/.claude/skills]`, byte-for-byte; repo-local codex discovery is unprobed and out of scope.

**How does the bash installer read the key without `faff` on PATH?** **Chosen:** run the already-resolved bundled CLI — `node "$BIN_SRC" config get install.skill_targets` with `cd "$SRC_ROOT"` — after the FAFF-443 retarget derives `BIN_SRC`. `node` is a hard faff prerequisite. The target-list build relocates to just after line 164; nothing between the old and new sites reads `TARGET_DIRS`.

**What happens when the read fails or the key is unset?** **Chosen:** fail-safe fallback to the hardcoded pair on every failure mode — node absent, CLI unreadable, non-zero exit, empty result, all-unusable entries. Exit 3 (key absent) is silent because unset is the normal default; any other non-zero warns to stderr so a genuinely broken key is not masked without a trace. The `Targets:` header always prints the directories actually used.

**Where does the doctor-side config read live — FAFF-684 (layered on FAFF-676) or folded into FAFF-676?** *(Was the open Punt; resolved at re-prep 2026-08-04.)* FAFF-676 has now **shipped (Done, PR #551)** and landed its plural default scan set as the hardcoded pair, without a config read. The "fold into FAFF-676" option is therefore moot — 676 settled its own scope and merged. **Chosen:** FAFF-684 adds the config override (steps 3-4 of `resolveDoctorScanSet`, plus threading the resolver `root` into the call) on top of FAFF-676's landed plural default scan set, so the installer and doctor read one key from one source and cannot drift. This is the clean, non-colliding layering the earlier prep anticipated; the merge of FAFF-676 removed the only reason this was previously a human scope call.

**Does `cmdSync` change?** **Chosen:** no. It shells `link-skills.sh --global --replace`, which now reads the config key itself, so `cmdSync` inherits config-driven targets for free and stays a thin wrapper.

## 7. Open questions and assumptions

### Open questions

- None. The former Punt (doctor-config-read home — FAFF-684-layered vs FAFF-676-folded) is **resolved**: FAFF-676 shipped its plural scan set without a config read (Done, PR #551, 2026-08-04), so FAFF-684 layers the config source on top — see §6. The `blockedBy FAFF-676` edge is satisfied (target Done).

### Assumptions

- **Assumes:** `node` is available and the bundled CLI at `$SRC_ROOT/plugin/skills/faff/bin/faff` is readable and runnable at install time. *Validate before building:* confirm the installer reaches this point only after `BIN_SRC` is derived (line 164) and that `node "$BIN_SRC" config get tracking.repo` returns a value when run with `cd "$SRC_ROOT"`. If node can be absent on a supported install path, the mandated fallback covers it — verify the fallback fires rather than aborting.

- **Assumes:** the default pair `~/.agents/skills` is still what the target codex version auto-loads. *Validate before building:* inherited unchanged from FAFF-672 (observed live 2026-07-28 against codex-cli 0.145.0 via the plugh probe). FAFF-684 does not alter the default targets, so this is carried, not re-opened; a codex version bump is a reason to re-probe and adjust the *default*, which a config key now makes a one-line change.

## 8. DONE — definition of done

### From WHY / principles

- [ ] With `install.skill_targets` unset, `scripts/link-skills.sh --global` builds exactly `[~/.claude/skills, ~/.agents/skills]` and its filesystem effect and stdout are byte-for-byte the pre-change build (no config-read warning printed); a test asserts the exact stdout, not just "identical behaviour".
- [ ] The target list is read from config in exactly one place in the installer, and doctor derives its default scan set config-source from the same key — neither restates the pair independently except as the shared fallback default.
- [ ] No failure of the config read (node absent, CLI unreadable, non-zero exit, empty, all-unusable) can leave `TARGET_DIRS` empty; every such path falls back to the hardcoded pair AND the install completes into it.
- [ ] `SRC_ROOT` / `SKILLS_ROOT` / `SRC_DIR` remain single-valued and the FAFF-443 retarget block is unchanged apart from the array build relocating below it.

### From WHAT (config key and expansion)

- [ ] `install.skill_targets` is documented in `plugin/skills/faff/SKILL.md`'s `.faffrc.yaml` schema block as a YAML sequence, with a note that it is hand-authored, that `~` entries must be quoted, and that it governs `--global` + doctor only.
- [ ] `faff config get install.skill_targets` returns the entries comma-joined; an absent key exits 3 with empty output (existing FAFF-262 behaviour, asserted — no new resolver code).
- [ ] A leading `~` in an entry expands to `$HOME` identically in the installer and doctor; an absolute entry passes through; a non-absolute, non-`~` entry is skipped with a notice under both. A test confirms an unquoted `~` YAML entry either parses usably or is documented to require quoting.

### From HOW (installer)

- [ ] The `TARGET_DIRS` construction is relocated to after `BIN_SRC` is derived (post line 164); no operational block between the old and new sites reads `TARGET_DIRS`.
- [ ] A set, usable `install.skill_targets` drives `--global` `TARGET_DIRS`; the four blocks iterate the resulting list unchanged.
- [ ] The config read runs the bundled CLI by path (`node "$BIN_SRC" config get …`) with `cd "$SRC_ROOT"`, never a hand `grep`/`sed` of the rc.
- [ ] Exit 3 from the read is silent; any other non-zero prints a stderr warning and falls back; neither aborts the run under `set -euo pipefail`.
- [ ] Local (non-`--global`) mode does not consult the key and yields exactly `[<repo>/.claude/skills]`.
- [ ] The installer's `Targets:` header (line 322) prints the directories actually used, whether configured or default.
- [ ] The configured list is de-duplicated by resolved path before any block iterates it, and two entries resolving to one directory collapse with one notice.

### From HOW (doctor — layered on landed FAFF-676; do not re-implement FAFF-676)

- [ ] With no `--target` and no `$CLAUDE_PLUGIN_ROOT`, a set `install.skill_targets` overrides doctor's default scan set (expanded, deduped); unset falls back to FAFF-676's landed default scan set (the pair at `gates.js:515`).
- [ ] Doctor reads the key via the existing `loadConfig` + `dig` idiom (as `gates.fallback` does), not a new parser; the resolver `root` (already computed in `cmdDoctor`, 606) is threaded into the `resolveDoctorScanSet` call at 608.
- [ ] `faff doctor --target DIR` scans exactly that one directory and does not read `install.skill_targets`.
- [ ] With `$CLAUDE_PLUGIN_ROOT` set, doctor scans one directory and does not read the key.
- [ ] FAFF-684 does not re-implement FAFF-676's plural scan set, `dedupeByResolvedPath`, `missing_here` naming, or exit-code behaviour — it adds only the config source + the `root` thread-through.

### From HOW (cmdSync)

- [ ] `cmdSync` in `gates.js` is unchanged — still passes `--global --replace [--dry-run]` and no target flags, and does not read `install.skill_targets`. A scenario proves a configured third target flows through `faff sync`.

### Dependencies / tickets

- [ ] `blockedBy FAFF-676` is satisfied (FAFF-676 Done, PR #551). The doctor-config-source layers on FAFF-676's landed plural scan set — re-read discharged at re-prep (see §1 cross-ticket note).
- [ ] No open slice-boundary Punt remains (resolved at re-prep — see §6 / §7).

### Docs

- [ ] `plugin/skills/faff/SKILL.md` documents `install.skill_targets`.
- [ ] `docs/guide/cli.md` lines 22-23 (`doctor`, `sync`) reflect that the target list / scan set is config-driven with a default, without implying a single hardcoded directory.
- [ ] `scripts/link-skills.sh`'s header comment notes `--global` targets come from `install.skill_targets` when set, defaulting to `~/.claude/skills` + `~/.agents/skills`.

### Tests — `test/link-skills-worktree.test.mjs` and `test/doctor.test.mjs` unless noted

- [ ] Existing tests in all three suites pass unmodified except where an assertion legitimately gains the config path.
- [ ] Every new or amended test that omits `--target` sets `CLAUDE_PLUGIN_ROOT: undefined` alongside `HOME` in the child env (the FAFF-672/676 helper trap), so the config default is exercised against the fake `$HOME`.
- [ ] Installer, key unset → `TARGET_DIRS` is the default pair; stdout + filesystem effect match the pre-change build (exact stdout assertion).
- [ ] Installer, key set to three `~`-relative entries → each discovered skill is symlinked into all three, all resolving under the source checkout.
- [ ] Installer, key present but read exits non-zero (malformed) → falls back to the default pair, prints a stderr warning, install COMPLETES into both.
- [ ] Installer, key with a non-absolute non-`~` entry → that entry is skipped with a notice, the usable entries are used.
- [ ] Installer, two config entries resolving to one directory → collapsed to one target with one notice.
- [ ] Installer, local mode → exactly `[<repo>/.claude/skills]`, config key ignored (set a key, assert it is not consulted).
- [ ] `faff sync` with a configured third target → the third directory receives the symlinks (targets flow through sync).
- [ ] Doctor, key set to a third directory → that directory is in the scan set; a copy/dangling link there is reported and exits 1. Fixture uses a faff-owned name. (Builds on FAFF-676's landed multi-directory doctor tests.)
- [ ] Doctor, `--target DIR` → scans one directory, does not read the key.

### Integration smoke test

```
1. Build a main checkout with plugin/skills/{faff, faff-demo} and a bundled bin/faff, under a faked $HOME.
2. Write .faffrc.yaml with:
     install:
       skill_targets: [ "~/.claude/skills", "~/.agents/skills", "~/.h3/skills" ]
3. Run: bash scripts/link-skills.sh --global   (env HOME=<fake home>)
4. Assert: realpath(<home>/.claude/skills/faff)
        == realpath(<home>/.agents/skills/faff)
        == realpath(<home>/.h3/skills/faff)
        == realpath(<main>/plugin/skills/faff)
5. Place a real-dir copy of `faff` in <home>/.h3/skills.
6. Run: node <CLI> doctor --root <fenced root>  (env HOME=<fake home>, CLAUDE_PLUGIN_ROOT unset, no --target)
7. Assert: exit 1, output names <home>/.h3/skills and reports `faff` as a copy there.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "assumes" }, { "marker": "assumes" }
  ] }
```

---

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Right-sized — no split.** This is one coherent change: a new `install.skill_targets` key read in two places — the bash installer and doctor's Node scan set — defaulting to today's pair. That's a 1-2 day unit and it shouldn't be split; the two readers share one key and always ship together, so splitting them would only leave a half-landed config key with no honest sequencing gained. With FAFF-676 now merged, doctor already scans the pair, so the doctor half really is thin — "read a config key off an already-plural scan set" — exactly the shape the earlier prep predicted for the FAFF-676-lands-first case.

**Project fit — good, nothing to change.** The home project, "Harness-agnostic runtime — the loop runs under Codex CLI", is named for the outcome it delivers, and letting an adopter point faff's skills at any harness's auto-load directory without editing the script is squarely that outcome. The ticket belongs here; no regrouping.

**Dependencies — the one load-bearing link is now satisfied.** FAFF-684's doctor-side scope sat on FAFF-676 ("faff doctor scans one directory…"), which owned making doctor's default scan set the pair. FAFF-676 is now **Done (PR #551)**, so the `blockedBy` edge is satisfied and the sequencing risk the earlier prep flagged — FAFF-684 racing ahead and re-implementing FAFF-676's core change — is gone: the plural scan set, exit contract, and `missing_here` naming already exist on `main`, and FAFF-684 layers only the config source on top. Worth still naming the neighbourhood: FAFF-675 and FAFF-685 also edit the same `cmdDoctor` surface, so whoever sequences those wants a deliberate order — but neither blocks this ticket, and this ticket does not block them.

**Risk — low, no spike warranted.** Nothing novel: a config key with two readers, additive, with a fail-safe fallback to the hardcoded pair on any empty or failed read. No external dependency, no unproven integration. The one prior risk was ordering (the FAFF-676 overlap), and the merge has retired it. The remaining care items are the folded spec-review fixes (exact-stdout assertion, stderr-ordering scoping, the `SRC_ROOT` anchor, the unquoted-`~` parse) — build-time diligence, not scope risk.

**Chain gap — none outstanding.** The `missing_here` cross-target comparison an earlier draft wanted to file is FAFF-676's landed deliverable; no new untracked-gap ticket is warranted.
