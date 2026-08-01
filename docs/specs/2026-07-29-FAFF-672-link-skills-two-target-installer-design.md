**Spec attached 2026-07-28.** Two review passes: the first returned `revise` with five objections (four major), the second `approve` with zero.

The objections worth recording, because each was a real defect rather than polish. The first draft claimed each of the script's four operational blocks could gain "an outer loop around its existing body, nothing inside changes semantically" — false for three of them, since `--status`, `--unlink` and the create path all carry `exit 0`s, summaries, CLI lines and counter initialisations that must stay single-run; a literal implementation would have exited after the first target. A target that is *already* a symlink was unhandled, so a user who had hand-fixed this bug by symlinking one directory at the other would get two targets on one inode, with the distinctness constraint holding textually and failing in fact. And `--replace`'s `rm -rf` now runs inside `~/.agents/skills` for the first time — which matters more than it sounds, because `faff doctor` exits 1 on every pre-change machine by design, so the gateway offers `faff sync` to the entire upgrade population, making a destructive run in a never-before-written directory the common first post-upgrade action.

The producer also caught a blocker in its own self-review: its first draft's doctor assertions used `demo-skill`, which `cmdDoctor`'s name filter (`faff`, `faff-*`, `faffter-*`, `faffidavit-*`) discards entirely, so they would never have fired.

Retained at `confidence: medium` — one substantive open decision, whether the target list stays hardcoded or becomes config-driven (decides: architecture). It does not block the build; the ordered-list shape is what a config key would later populate.

One item is deliberately deferred rather than specced: per-target failure detection under `set -euo pipefail`, where a failing `rm` aborts rather than setting a flag. The spec states the required behaviour four times; locally disarming `errexit` around per-target filesystem operations is the build agent's call.

---

# FAFF-672 — link-skills installs to one harness's directory, so faff's skills are invisible to codex

> Spec: faffter-dark-nlspec · 2026-07-28 · interactive · confidence: medium. Full spec on Linear FAFF-672.

Design spec for FAFF-672, in the project "Harness-agnostic runtime — the loop runs under Codex CLI". Written for the build agent implementing the change and for the humans reviewing it. Everything the build needs is here; no other document is required reading.

## 1. WHY — problem and principles

**The load-bearing model.** A harness discovers skills by scanning a directory it already knows about, before any prompt is written — the skill's name and description are pre-loaded into context, and only the body is fetched when the skill activates. That means the install location *is* the discovery mechanism. Claude Code scans `~/.claude/skills`. Codex CLI scans `~/.agents/skills` (and `~/.codex/skills`). A skill that exists in one of those directories and not the other is not "partly installed" for the second harness — it does not exist for it at all.

**Problem statement.** `scripts/link-skills.sh --global` symlinks every faff skill into `~/.claude/skills` and nowhere else, so a machine with faff installed globally has zero faff skills visible to codex. That makes the whole harness-agnostic project unreachable — no amount of engine abstraction matters if the harness cannot see the skills in the first place. This change makes `--global` install each skill into two directories, both pointing at the same repo, and makes the install health check see both.

**The evidence this rests on.** Two probe skills were planted on 2026-07-28 against codex-cli 0.145.0, one in `~/.agents/skills` and one in `~/.codex/skills`, each described only as *"Use when the user says the word plugh."* The prompt was the single word `plugh` — no skill names, no paths. The model replied that it was using the `grue` and `zork` skills because "plugh" explicitly triggers both. It named both skills and their trigger from nothing but the trigger word, which is only possible if the metadata from both directories was already in context. Both locations load. An earlier probe that named the skills in the prompt was invalid and is not relied on here.

### Design principles

**Install targets are plural in one place, singular everywhere else.** The list of install directories is defined once, near the top of `scripts/link-skills.sh`, and every operational block iterates it. No block rebuilds a path from `$HOME`, and no block hardcodes `.claude` or `.agents`. This is what keeps the four blocks that touch the target from drifting apart as a fifth is added.

**The source stays singular.** FAFF-443's worktree retargeting decides where links point *from* — the stable main checkout rather than an ephemeral worktree. That logic is untouched and is not duplicated per target: `SRC_ROOT`, `SKILLS_ROOT` and `SRC_DIR` remain single values. Only the target becomes plural.

**A half-install must be loud.** The failure this ticket describes — skills present for one harness, absent for another — is exactly the class of problem `faff doctor` exists to catch, and today's doctor would report it clean. Any implementation where doctor exits 0 on a machine where codex cannot see faff's skills has not fixed the bug; it has moved it.

**Every target is visited, always.** No block may stop at the first target that errors. Halting after the first target is how you get the half-install the whole ticket is about, only now created by the repair tool.

**Two targets means the same destructive step now runs in a directory faff has never owned.** The create path's `--replace` branch removes what is at the destination before linking. Adding `~/.agents/skills` extends the reach of that removal into the cross-tool directory, which is the one most likely to hold other agents' skills. What bounds it is that the create path only ever visits destinations named after a faff skill; nothing else in the directory is looked at, let alone removed. That bound is load-bearing and is asserted in the tests, not assumed. See *The widened blast radius of `--replace`* in HOW.

**Two targets must be two directories.** If both entries in the list resolve to the same directory on disk — because a user has already hand-fixed this bug with a directory symlink — then treating them as two produces double-counted status output and a second pass over work already done. Distinctness is checked against the resolved path, not the literal string.

### Reference context

| File | Language | Relevance |
|---|---|---|
| `scripts/link-skills.sh` | Bash | The installer. `TARGET_DIR` set at lines 75-79. Four regions read it: `--status` (136-196), `--unlink` (199-246), the create path (248-304), `--prune` (308-329). Each region *contains* a loopable part; parts of each must stay single-run — see the table in WHAT |
| `plugin/skills/faff/bin/lib/gates.js` | Node (CommonJS) | `cmdDoctor` (503-585) scans one directory; `cmdSync` (624-651) shells out to the installer; `DOCTOR_SPEC` at line 38 |
| `test/link-skills-worktree.test.mjs` | Node test runner | Builds a real main checkout plus a real linked worktree, runs the installer under a faked `$HOME`, and calls `faff doctor` with explicit `--target`/`--root`. Its `linkSh` and `doctor` helpers (lines 60-69) spread `process.env` and override only `HOME` |
| `test/doctor.test.mjs` | Node test runner | Every skill-link test pins `--target` (lines 41-155). Its `run` helper (19-22) passes no `env` at all, so the child inherits the parent's environment wholesale, `HOME` included |
| `plugin/skills/faff/SKILL.md` | Markdown | The gateway's doctor-at-entry preamble (lines ~84-96) that runs `faff doctor` and offers `faff sync` on exit 1 |
| `docs/guide/cli.md` | Markdown | One-line descriptions of `doctor` (line 22) and `sync` (line 23) |

**Scope.** This is the install-layer precondition for the harness-agnostic project. It changes where skills are placed and how their placement is checked. It changes nothing about what the skills contain or how the loop runs.

## 2. OUT OF SCOPE

- **The harness-coupling inventory table.** `docs/architecture/harness-coupling.md` line 22 already records skills as portable and already names `~/.agents/skills/` as the cross-tool location, so nothing there is wrong today. *Why excluded:* that file has two pending editors — FAFF-482 adding five rows and FAFF-668 correcting the permission row — and a third concurrent editor would conflict for no gain. *Extension point:* if the row ever needs to name the install behaviour rather than the standard, it goes in the same table row, after FAFF-482 and FAFF-668 land.

- **Repo-local (non-`--global`) mode.** The default mode still links only into `<repo>/.claude/skills`. *Why excluded:* the ticket scopes the fix to `--global`, and repo-local discovery under codex is a separate question — whether codex reads a project-level `.agents/skills` at all has not been probed. *Extension point:* the same ordered target list this change introduces, extended with a repo-local branch. **This is a real gap, not a non-issue** — a contributor who dev-links repo-locally still has no faff skills under codex. It warrants its own ticket in the harness-agnostic project, and the build agent should raise one rather than silently widening this change.

- **Codex discovery for marketplace plugin installs.** A machine that got faff from the Claude Code plugin marketplace has its skills under `$CLAUDE_PLUGIN_ROOT/skills` and never runs `scripts/link-skills.sh` at all, so nothing in this change places anything where codex can see it. *Why excluded:* the fix would have to be a plugin-side install step, not an installer-side target list, and doctor cannot repair it with the command it prints (`scripts/link-skills.sh` needs a checkout the plugin user does not have). *Extension point:* the plugin packaging, plus `resolve_doctor_scan_set` step 2 in WHAT — the step that deliberately keeps plugin installs single-target. **This is a real gap too**, and it is why doctor reports differently on a plugin machine than a dev-linked one; see the edge case in HOW. It warrants its own ticket alongside the repo-local one.

- **The `faff` executable fallback in `plugin/skills/faff/SKILL.md` lines 118-119.** The fallback resolves the CLI binary by searching `~/.claude` only. *Why excluded:* that is the CLI binary path, not the skills path, and `~/.local/bin/faff` plus `$CLAUDE_PLUGIN_ROOT` cover it in practice. *Extension point:* the same two-line resolution block — but note the trap: if `~/.claude/skills` were ever dropped in favour of `~/.agents/skills` alone, that fallback silently stops resolving. Keeping `~/.claude/skills` as a target (which this change does) is what keeps it working.

- **`~/.local/bin/faff`, the CLI symlink.** Single-location and orthogonal to skill discovery. *Why excluded:* both harnesses invoke the same binary off `PATH`; there is no second bin directory to install into. *Extension point:* `BIN_DST` in `scripts/link-skills.sh` line 45.

- **In-session reload after a repair.** Neither harness re-scans its skills directory mid-session. *Why excluded:* a harness limitation, not fixable from faff. *Extension point:* none in repo — a repaired install takes effect at the next session start, and the prose should say so where it offers the repair.

## 3. WHAT — vocabulary, types, interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Install target | A directory a harness scans for skills, into which the installer places one symlink per faff skill. There are now two in global mode. |
| Primary target | The first entry in the ordered target list: `~/.claude/skills`. First in output ordering; carries no other privilege. |
| Half-install | A machine where at least one faff skill is healthy in one install target and missing (or unhealthy) in another. The failure state this ticket exists to make visible. |
| Resolved target | An install target with every symlink in its path followed — what the filesystem actually writes into. Two literal targets can share one resolved target. |
| Source root | The checkout the symlinks point at, chosen by FAFF-443's worktree retargeting. Singular, unchanged by this spec. |

### The ordered target list

```
RECORD InstallTargets:
  ordered_list: List<AbsolutePath>   # non-empty; document order is output order
                                     # global mode:  [ $HOME/.claude/skills,
                                     #                $HOME/.agents/skills ]
                                     # local mode:   [ $REPO_ROOT/.claude/skills ]

  CONSTRAINT every entry is absolute and derived from $HOME or $REPO_ROOT exactly once
  CONSTRAINT entries are distinct AFTER symlink resolution, not merely as strings
  CONSTRAINT no operational block may reconstruct a target path independently
```

In bash this is a plain array replacing the scalar `TARGET_DIR`, built once where `TARGET_DIR` is set today (lines 75-79) and de-duplicated by resolved path immediately after (see *Collapsing aliased targets* in HOW).

### What loops and what stays single-run

The four regions named in the reference table are regions that *contain* a loopable part. They are not loop bodies, and wrapping each region wholesale in `for target_dir in "${TARGET_DIRS[@]}"; do … done` is wrong in three of the four cases — `--status` and `--unlink` both end in `exit 0`, so a naive wrapper exits after the first target and reproduces exactly the half-install this ticket is about. The counter initialisations and headers likewise have to sit above the loop or the accumulate rule below breaks.

| Region | Runs once per target | Stays single-run |
|---|---|---|
| `--status`, lines 136-196 | the `Target:` line (138); the target-absent branch (142-145), which becomes "nothing linked here" plus **continue**, never `exit 0`; the per-skill loop (153-180) | the `Source:` and global-mode lines (137, 139); the five counter initialisations (147-151), **hoisted above** the target loop; the summary (182-189); the CLI-link line (190-194); the final `exit 0` (195) |
| `--unlink`, lines 199-246 | the `Target:` line (201); the target-absent branch (207-210), which becomes "nothing to unlink here" plus **continue**, never `exit 0`; the entry loop (214-232) | the `Source:` / mode / "Unlinking …" preamble (200, 202-205); the `unlinked` and `left_alone` initialisations (212-213), **hoisted above** the target loop; the CLI-symlink removal (234-239); the summary (241-244); the exit (245) |
| create path, lines 248-304 | `mkdir -p` (248); the per-skill loop (263-304) | the `Source:` / `Target:` / mode header block (250-255), which becomes one header naming every target; the five counter initialisations (257-261), which sit **above** the loop so counts accumulate |
| `--prune`, lines 308-329 | the whole `if` body (309-328), including its `Pruning dead symlinks in …` line | `pruned=0` (307), already outside the `if` and correct as-is |

`TARGET_DIR` inside each loopable part is renamed to the loop variable. Nothing else in those parts changes semantically — the per-skill classification, the `readlink`-under-`$SRC_DIR` test and the printf formats are all untouched.

### `faff doctor` scan set

`cmdDoctor` currently picks one directory: `--target` if given, else `$CLAUDE_PLUGIN_ROOT/skills` if set, else `path.join(homeDir(), ".claude", "skills")`. It becomes a list:

```
PROCEDURE resolve_doctor_scan_set(target_flag, plugin_root_env):
  1. IF target_flag given: RETURN [ target_flag ]        # explicit pin — exactly one
  2. IF plugin_root_env set: RETURN [ plugin_root_env + "/skills" ]   # plugin install — one
  3. candidates = [ home + "/.claude/skills", home + "/.agents/skills" ]
  4. RETURN dedupe_by_resolved_path(candidates)          # dev-linked default — one or two
```

`--target` stays single-valued (`arity: 1`) and still means "scan exactly this directory". The tests already depend on that, and a pinned single scan is what makes per-target assertions easy to write.

```
RECORD PerTargetScan:
  directory: AbsolutePath      # the literal path, as printed
  resolved: AbsolutePath       # symlinks followed; unique across the scan set
  readable: Boolean            # false ⇒ directory absent or unreadable
  skills_found: List<Name>     # faff-owned names only
  healthy: Count               # live symlinks into the main checkout
  copies: Count
  dangling: Count
  into_worktree: Count
```

```
RECORD DoctorVerdict:
  per_target: List<PerTargetScan>
  missing_here: Map<Name, List<AbsolutePath>>   # skill present in ≥1 target, absent in these
  exit_code: 0 | 1 | 2
```

## 4. HOW — behaviour

### The installer

Four regions gain a loop around part of their body, per the table in WHAT. Everything else — argument parsing, worktree retargeting, skill discovery, the `BIN_DST` handling — is untouched.

```
PROCEDURE link_skills_main(flags):
  1. Parse flags as today.
  2. Build TARGET_DIRS:
     a. IF --global: [ $HOME/.claude/skills, $HOME/.agents/skills ]
     b. ELSE:        [ $REPO_ROOT/.claude/skills ]
  3. TARGET_DIRS = dedupe_by_resolved_path(TARGET_DIRS)
  4. Resolve SRC_ROOT via FAFF-443 worktree retargeting — UNCHANGED, runs once, singular.
  5. Discover SKILL_DIRS from SRC_DIR — UNCHANGED, runs once.
  6. IF --status:  Print the source header ONCE; zero the five counters ONCE.
                   FOR EACH target: print its Target line and per-skill lines; accumulate.
                   Then ONE combined summary + the CLI-link line. Exit 0 — after the loop.
  7. IF --unlink:  Print the source/mode preamble ONCE; zero the counters ONCE.
                   FOR EACH target: unlink this repo's links there; accumulate; never exit.
                   Then remove the CLI link ONCE. Exit per the aggregate rule below.
  8. Create path:  Print the header naming every target ONCE; zero the counters ONCE.
                   FOR EACH target: mkdir -p; FOR EACH skill: link/relink/replace/skip.
  9. IF --prune:   pruned=0 ONCE (already outside the block today).
                   FOR EACH target: remove dead links pointing under SRC_DIR.
 10. Link the CLI once (unchanged), print one combined summary, exit per aggregate rule.
```

**Behaviour of the create path per target.** Identical to today's per-skill logic — already linked correctly, relink a foreign symlink, `--replace` a real dir, warn on a copy install without `--replace`, otherwise create. The counters (`linked`, `refreshed`, `replaced`, `skipped`, `errors`) are zeroed once above the target loop, accumulate across targets, and the summary reports the total. A per-target breakdown in the summary is fine but not required; what is required is that the printed per-skill lines make the target obvious, either by a target header line before each group or by including the target in the line.

**Aggregate exit rule.** The script visits every target unconditionally, then exits non-zero if any target produced an error. It never exits early on the first failing target.

```
PROCEDURE aggregate_exit(per_target_errors):
  1. total_errors = sum over targets
  2. IF total_errors > 0:
     a. Print the count and which targets it came from
     b. Print the existing remedy line (--replace, or move the entries aside)
     c. Exit 1
  3. Exit 0
```

### Collapsing aliased targets

A user who has already hand-fixed this bug by running `ln -s ~/.claude/skills ~/.agents/skills` has one directory reachable by two paths. `mkdir -p` succeeds straight through the symlink and every subsequent operation silently works on the same inode twice: `--status` counts every skill twice, the create path re-does its own work, and doctor's cross-target check compares a directory against itself and reports clean. The string-distinctness constraint holds and means nothing.

```
PROCEDURE dedupe_by_resolved_path(candidates):
  1. kept = []; seen = {}
  2. FOR EACH path in candidates, in order:
     a. IF the path exists: resolved = the path with all symlinks followed
        ELSE: resolved = the path as given    # a path that does not exist aliases nothing
     b. IF resolved in seen:
        - Print one notice: "<path> resolves to <seen[resolved]> — treating them as one target"
        - CONTINUE
     c. seen[resolved] = path; kept += path
  3. RETURN kept                              # order preserved; first occurrence wins
```

In bash, resolve with a `( cd "$dir" && pwd -P )` subshell rather than `realpath`, which is not present on every macOS the installer runs on. In Node, use `fs.realpathSync`, catching the throw for a path that does not exist and falling back to the literal path. The notice is printed once per collapsed entry, by both the installer and doctor.

**Why collapse rather than refuse.** A user in this state has a working install: both harnesses see every skill. Refusing to run would break a setup that is doing the right thing by a slightly different route, and the repair we would be demanding — delete the symlink, make a real directory — is strictly more work for an identical outcome. Collapsing keeps them working, keeps the counts honest, and keeps the destructive `--replace` pass from running twice over the same entries.

**Anti-pattern:** treating the two literal paths as distinct because the strings differ. Why: `$HOME/.claude/skills` and `$HOME/.agents/skills` are different strings that can be the same directory, and every guarantee in this spec that says "both targets" then quietly means "the same target, twice".

**Anti-pattern:** wrapping the whole script body in one target loop. Why: skill discovery, worktree retargeting and the CLI symlink would run once per target, printing duplicate notices and re-doing work whose result is identical. Only the loopable parts named in the WHAT table loop.

**Anti-pattern:** replacing `~/.claude/skills` with a directory-level symlink to `~/.agents/skills` (or the reverse) *as faff's own fix*. Why: on the reporter's machine `~/.claude/skills` holds roughly 103 entries, most owned by other tools — gstack's `autoplan`, `Binaryfile` and others. Redirecting the directory relocates every one of those tools' skills and leaves them installing into a path they know nothing about. faff creates two per-skill symlinks, never one directory symlink. Encountering a directory symlink a user made themselves is a different matter, handled by the collapse above.

**Anti-pattern:** making `~/.agents/skills` conditional on codex being installed. Why: the installer has no reliable way to detect a harness that may be installed later, and a conditional install turns "codex cannot see faff" into an intermittent bug that depends on install order.

### The widened blast radius of `--replace`

`faff sync` shells out with `--global --replace`, and the create path's replace branch runs `rm -rf "$dst"` (line 287). Under this change that `rm -rf` runs inside `~/.agents/skills` for the first time — the cross-tool directory, the one most likely to hold skills belonging to other agents rather than to faff.

The timing makes this systemic rather than theoretical. Doctor exits 1 on *every* pre-change machine after upgrading, by design, so the gateway's doctor-at-entry preamble offers `faff sync` to the entire upgrade population at once. The common first post-upgrade action becomes a `--replace` run in a directory faff has never written to.

What bounds it: the create path iterates `SKILL_DIRS`, and `dst` is only ever `<target>/<name>` for a name discovered under the source checkout's `plugin/skills`. Entries in the target directory that no faff skill is named after are never stat'ed, never listed, never removed. `--prune` is bounded differently and just as tightly — it only removes symlinks whose `readlink` already resolves under `$SRC_DIR`.

That bound is the whole safety argument, so it is asserted rather than assumed: an acceptance criterion in Scenarios and a DONE item require a test proving a non-faff entry in `~/.agents/skills` survives a `--replace` run that replaces a faff-named copy sitting beside it.

**Anti-pattern:** clearing the target directory before linking, in either target. Why: name-scoped removal is the only thing standing between `faff sync` and another tool's skills, and a directory-level clear removes it.

### `faff doctor`

Doctor scans each directory in its scan set, classifies each faff-owned entry exactly as today (live symlink into the main checkout, live symlink into a worktree, dangling, or copy), and then adds one new axis: cross-target presence.

```
PROCEDURE doctor(scan_set, root):
  1. FOR EACH directory in scan_set:
     a. readdir; on failure record readable=false and continue — NEVER return early
     b. filter to faff-owned names (faff, faff-*, faffter-*, faffidavit-*)
     c. lstat-classify each, exactly as today
  2. IF every directory in scan_set is unreadable OR yielded zero faff skills:
     a. Write the existing "no faff skills found" message, naming every directory tried
     b. RETURN 2        # nothing installed — same silent-continue meaning as today
  3. union = every faff skill name seen in any directory
  4. FOR EACH directory that IS readable:
     a. missing_here = union minus that directory's names
  5. Print one section per directory: its path, then its per-skill lines, then one line
     per name in missing_here:
        "✗ <name>  MISSING from <directory> — this harness cannot see it"
  6. Check the merge-fence PreToolUse registration under <root> — UNCHANGED, once
  7. IF any copies OR dangling OR into_worktree OR any missing_here non-empty OR fence
     missing:
     a. Print RESULT naming each problem class, including "<n> skill(s) missing from
        <directory>"
     b. Print the existing Fix line; the skill-link fixes already say
        "bash scripts/link-skills.sh --global --replace --prune (from the main checkout)"
     c. RETURN 1
  8. RETURN 0
```

**Why an unreadable directory is not fatal on its own.** Today doctor returns 2 the moment `readdirSync` throws, and 2 means "silent, continue" to the gateway preamble. With two targets, `~/.agents/skills` will simply not exist on every machine that installed faff before this change. If an unreadable directory kept the early return, the first upgrade run would report exit 2 — silence — on precisely the machines that need the repair. So an unreadable directory contributes to `missing_here` for every skill found elsewhere, and exit 2 is reserved for "no faff skills anywhere in the scan set", which is its existing meaning.

**Edge cases.**

- **Neither directory exists.** Exit 2, message names both directories tried. The gateway preamble stays silent, as it does today.
- **`~/.claude/skills` healthy, `~/.agents/skills` absent.** Exit 1, one MISSING line per skill against `~/.agents/skills`, existing Fix line. This is the state every pre-change machine is in after upgrading, and it is the case the ticket is about.
- **A skill healthy in one target, a stale copy in the other.** Both problems reported; the copy under its own target section, and no MISSING line (the name is present, just unhealthy).
- **A skill present only in `~/.agents/skills`.** Symmetric — MISSING line against `~/.claude/skills`. The check is set-difference in both directions, not "does the second target match the first".
- **`~/.agents/skills` is a symlink to `~/.claude/skills`.** The scan set collapses to one entry, doctor prints the collapse notice, `missing_here` is empty by construction, and the verdict reflects a single scan. Reporting a half-install here would be a lie about a working machine.
- **`--target` pinned to one directory.** Scan set has one entry, so `missing_here` is empty by construction and the output is byte-comparable to today's for that directory apart from the target header. Existing tests keep passing.
- **`$CLAUDE_PLUGIN_ROOT` set (marketplace plugin install).** Scan set has one entry, as today, so a plugin machine never reports a half-install even when codex genuinely cannot see the skills. That is a deliberate trade, not an oversight: a plugin install has no `~/.agents/skills` to compare against, was never populated by `scripts/link-skills.sh`, and cannot run the repair doctor prints — the user has no checkout. Reporting an unfixable problem on every plugin machine would be noise, so doctor stays quiet and the real gap is filed as its own ticket (see OUT OF SCOPE). The consequence to accept knowingly: the same machine reports differently depending on whether doctor was invoked from a plugin session or a dev-linked one.

**Anti-pattern:** teaching `cmdSync` about targets. Why: `cmdSync` passes `--global --replace` and no target flags, and the installer alone decides its targets. It stays a thin wrapper; adding target knowledge would create a second source of truth for the target list.

**Anti-pattern:** a new exit code for a half-install. Why: the gateway's doctor-at-entry preamble branches on exactly 0 / 1 / 2, and its exit-1 branch already offers `faff sync` interactively and logs-and-continues in autonomous mode. A half-install is precisely a repairable not-clean install, so it belongs in exit 1. A third code would need the gateway prose changed and would silently do nothing on any caller that has not been updated.

### `--status` and `--unlink`

`--status` prints the source header once, then one section per target — its own `Target:` line, its own per-skill lines — then one combined summary that keeps today's five counters (linked, not linked, foreign, dangling, real blocking) as totals across targets, then the single CLI-link line, then `exit 0`. A target that does not exist prints "nothing linked here" and the loop continues; it must not `exit 0` the way line 144 does today. Per-target subtotals may be printed above the combined summary; the combined totals must be present either way.

`--unlink` visits every target in order, removing only symlinks whose `readlink` resolves under `$SRC_DIR` and leaving everything else alone, exactly as today. It does not stop if one target is missing or unwritable; it records the problem and moves on, and the CLI symlink is removed once at the end.

```
PROCEDURE unlink(TARGET_DIRS, SRC_DIR):
  1. Print the source/mode preamble — ONCE, above the loop
  2. unlinked = 0; left_alone = 0; failed_targets = []    — ONCE, above the loop
  3. FOR EACH target in TARGET_DIRS:
     a. Print the target header
     b. IF target does not exist: print "nothing to unlink here"; CONTINUE (not exit)
     c. FOR EACH entry in target/*:
        - not a symlink → left_alone++; CONTINUE
        - readlink under SRC_DIR → remove (unless --dry-run); unlinked++
        - otherwise → left_alone++
     d. IF any removal failed: failed_targets += target
  4. Remove the CLI symlink if it points at BIN_SRC — once, after the loop, not per target
  5. Print combined summary; exit 1 if failed_targets non-empty, else 0
```

**Why `--unlink` must be best-effort across targets rather than all-or-nothing.** All-or-nothing would mean refusing to clean anything when one target is unwritable, which leaves the documented pre-worktree-removal cleanup unable to run at all — and dangling worktree-sourced links are the exact failure FAFF-443 was written to prevent. Best-effort removes what it can and reports what it could not, which is strictly closer to the goal. There is also nothing to roll back to: unlinking is not a transaction, and a partially-unlinked state is not corrupt, just incomplete and reported.

### Failure modes

- **The failure: `~/.agents/skills` is not actually what this codex version scans.** The install would be technically correct and practically useless. *How you'd know:* re-run the plugh probe — plant one probe skill in `~/.agents/skills` described only as triggering on a nonsense word, prompt codex with that word alone, and see whether it names the skill. *What it means:* if it does not, park the build and re-run the probe against `~/.codex/skills` before choosing a different target. The 2026-07-28 observation against codex-cli 0.145.0 is the evidence for the current choice; a version bump is a reason to re-probe.

- **The failure: the widened `--replace` removes something that was not faff's.** *How you'd know:* the name-scoping test fails, or a user reports a missing skill in `~/.agents/skills` after running `faff sync`. *What it means:* stop. This is the one failure in this change that destroys data rather than reporting it wrongly, and no part of the two-target install is worth shipping without the bound holding.

- **The failure: doctor's cross-target check produces noise on machines that never wanted codex.** Every pre-change machine reports exit 1 on the first run after upgrading, and the gateway offers `faff sync`. *How you'd know:* the offer fires for users who have never run codex and do not care. *What it means:* this is acceptable and intended — the repair is one keystroke, idempotent, and creates a directory that costs nothing if unused. If it proves genuinely irritating, the answer is configurable targets (see the open question), not a quieter doctor.

- **The failure: the two targets drift, and a skill goes live in one harness and not the other.** *How you'd know:* doctor's MISSING lines, which are exactly the signal that does not exist today. *What it means:* proceed — that signal is the deliverable, not a side effect.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a machine with no faff skills installed anywhere
When scripts/link-skills.sh --global runs from the main checkout
Then every discovered skill exists as a symlink under ~/.claude/skills
 And every discovered skill exists as a symlink under ~/.agents/skills
 And both symlinks for a given skill resolve to the same directory under the main checkout's plugin/skills
```

```
Given ~/.agents/skills does not exist
When scripts/link-skills.sh --global runs
Then the directory is created and populated, and the script exits 0
```

```
Given ~/.agents/skills holds a real directory named faff-graft (a copy install)
 And ~/.agents/skills also holds a directory named other-tool-skill that no faff skill is named after
When scripts/link-skills.sh --global --replace runs
Then faff-graft is a symlink into the source checkout
 And other-tool-skill is still present and its contents are unchanged
```

```
Given every faff skill is a healthy symlink in ~/.claude/skills and ~/.agents/skills is absent
When faff doctor runs with no --target flag and no CLAUDE_PLUGIN_ROOT
Then it exits 1
 And its output names ~/.agents/skills and reports the skills as missing from it
 And its Fix line names the link-skills.sh repair command
```

```
Given a --global install exists in both targets, sourced from a linked worktree
When scripts/link-skills.sh --global --unlink runs from that worktree
Then no symlink pointing under that worktree's plugin/skills remains in ~/.claude/skills
 And no symlink pointing under that worktree's plugin/skills remains in ~/.agents/skills
```

- A directory-level symlink is never created *by faff*: after any `--global` run, faff MUST NOT have converted either `~/.claude/skills` or `~/.agents/skills` into a symlink, and entries in them belonging to other tools MUST be untouched.
- The create path and `--prune` MUST only ever remove entries named after a discovered faff skill, or symlinks already resolving under `$SRC_DIR`. No other entry in any target directory may be removed or modified.
- `faff doctor` with an explicit `--target` MUST scan exactly that one directory and MUST NOT report any cross-target missing finding.
- The installer MUST attempt every target on every run; a failure at one target MUST NOT prevent work at another.
- Neither `--status` nor `--unlink` may exit before every target in the list has been visited.

## 6. Design decision rationale

**Which directories does `--global` install into?**

Options: `~/.claude/skills` plus `~/.agents/skills`; all three including `~/.codex/skills`; `~/.agents/skills` alone. All three is redundant — the 2026-07-28 probe showed codex loading from `~/.agents/skills` on its own, so `~/.codex/skills` adds a third place to keep in sync for no observed gain, and it is one vendor's home rather than the cross-tool convention. `~/.agents/skills` alone would break Claude Code discovery and the CLI fallback in `plugin/skills/faff/SKILL.md` line 119, which searches `~/.claude`.

**Chosen:** two targets — `~/.claude/skills` then `~/.agents/skills`, one symlink per skill in each, both pointing into the repo. `~/.codex/skills` is not written. If a future codex release stops reading `~/.agents/skills`, adding a third entry to the ordered list is a one-line change by construction.

**Where does the plurality live?**

Options: an array replacing the scalar `TARGET_DIR`, with the loopable part of each region wrapped in a loop; or a helper function called once per target with the target as an argument. The helper reads well but would require extracting four sizeable regions into functions, which is a much larger diff over code that FAFF-443 recently touched, and bash's lack of local arrays makes the counter accumulation awkward.

**Chosen:** an ordered bash array `TARGET_DIRS`, built once where `TARGET_DIR` is set today, with the loopable part of `--status`, `--unlink`, the create path and `--prune` each wrapped in an outer loop over it and the headers, counter initialisations, CLI handling, summaries and exits kept single-run per the WHAT table. This is the precedent this change sets: **when faff installs the same artifact to more than one location, the locations live in one ordered list at the point of derivation, every operational block iterates that list, order is output order and nothing else, and any health check derives its default scan set from the same list rather than restating it.** Nothing else in the repo installs to two locations today, so there was no pattern to follow; the next multi-target thing matches this one.

**What happens when a target is already a symlink to the other target?**

Options: refuse loudly and tell the user to undo their symlink; ignore it and treat the two literal paths as distinct; or de-duplicate by resolved path and carry on with one target. Ignoring it is the status quo bug in a new costume — string-distinct, inode-identical, so `--status` double-counts, the create path repeats itself, and doctor compares a directory against itself and calls it clean. Refusing punishes a user whose machine already works: both harnesses see every skill, which is the outcome this ticket exists to produce.

**Chosen:** de-duplicate by resolved path — first occurrence in list order wins, a one-line notice names the collapse, and both the installer and doctor apply the same rule so their views cannot diverge. Resolution uses `( cd "$dir" && pwd -P )` in bash (not `realpath`, which is not universally present on macOS) and `fs.realpathSync` in Node, with a path that does not exist resolving to itself since it can alias nothing.

**What is `faff doctor`'s default scan set?**

Options: keep scanning one directory; scan both defaults; add a `--targets` list flag. Keeping one directory means doctor reports clean on a machine where codex sees nothing, which is the bug. A list flag is unnecessary — the pinned single `--target` covers testing, and the default covers real use.

**Chosen:** the default scan set is both `~/.claude/skills` and `~/.agents/skills`, de-duplicated by resolved path; `--target` and `$CLAUDE_PLUGIN_ROOT` each still resolve to exactly one directory. `--target` keeps `arity: 1`, so `DOCTOR_SPEC` and every existing test are unaffected. The plugin-install branch stays single-target knowingly — see the edge case in HOW and the OUT OF SCOPE item it points at.

**What does doctor report for a half-install — error, warning, or repair offer?**

Options: a new exit code; exit 2 (silent-continue); exit 1 (not-clean, offer repair). A new code requires editing the gateway's doctor-at-entry prose and would be ignored by any caller not updated. Exit 2 means silence, which is the current broken behaviour by another route.

**Chosen:** exit 1, folded into the existing not-clean result alongside copies, dangling links and worktree-sourced links, with the existing Fix line. The gateway preamble then does the right thing for free: interactive gets the one-line `faff sync` offer, autonomous logs the finding and continues without mutating `$HOME`. Exit 2 keeps its current meaning and now fires only when no faff skills are found in *any* scanned directory.

**What does `--status` print?**

Options: one target section then a second, each with its own summary; or interleaved per-skill lines with a target column. Interleaving makes it hard to answer "is this harness fine", which is the question being asked.

**Chosen:** one section per target with its own `Target:` line and per-skill lines, then one combined summary carrying today's five counters as totals, then the single CLI-link line. Per-target subtotals are optional; the combined totals are not. The counters are zeroed once above the target loop and the `exit 0` moves below it.

**Is `--unlink` all-or-nothing across targets, or best-effort per target?**

Options: refuse everything if any target is unwritable; or clean what can be cleaned and report the rest. All-or-nothing blocks the documented pre-worktree-removal cleanup on a partial failure, which reintroduces the dangling links FAFF-443 exists to prevent.

**Chosen:** best-effort per target, every target visited, aggregate non-zero exit naming the targets that failed. There is no transaction to preserve — a partially-unlinked state is incomplete and reported, not corrupt. The same rule governs the create path.

**Should the install targets be configurable?**

The list is hardcoded here. A `.faffrc` key naming install targets would let a user add a harness faff has never heard of, or opt out of `~/.agents/skills` on a machine that will never run codex. Against it: `scripts/link-skills.sh` is bash with no access to the `faff config` resolver in the general case (it runs during bootstrap, before the CLI is necessarily on `PATH`), and no config key names an install location anywhere in faff today — adding one is a product decision about how far the harness-agnostic story goes, not a mechanical one.

**Punt:** hardcoded two-target list, or a config-driven target list — needs human (decides: architecture). Not a blocker: the build proceeds with the hardcoded list, and the ordered-list shape is exactly what a config key would populate later.

**Does codex actually auto-load `~/.agents/skills`?**

**Assumes:** codex-cli auto-loads skills from `~/.agents/skills/` without configuration. Observed live on 2026-07-28 against codex-cli 0.145.0 via the plugh probe described in the WHY.

**Is `$HOME/.agents/` faff's to create and write into?**

The installer will `mkdir -p ~/.agents/skills` on every `--global` run and, under `--replace`, will `rm -rf` faff-named entries inside it. Both are writes into a directory faff has never touched and does not own.

**Assumes:** `$HOME/.agents/` exists or is safe to create, and `$HOME/.agents/skills` is safe for faff to populate. On the reporter's machine `~/.agents/` already holds an `AGENTS.md`, so the create must add a subdirectory beside existing content and never replace or clear the parent.

## 7. Open questions and assumptions

### Open questions

- **Should the install target list be hardcoded or configurable?** Today the two global targets are compiled into `scripts/link-skills.sh`. A config key would let an operator add a target for a harness faff does not ship support for, or drop `~/.agents/skills` on a codex-free machine. The costs are a new config surface, a bash-side config read during bootstrap (before the CLI is reliably on `PATH`), and the first config key in faff that names a filesystem install location. **Punt:** hardcoded two-target list, or a config-driven target list — needs human (decides: architecture). The build does not wait on this: it ships the hardcoded ordered list, which is the shape a config key would fill.

### Assumptions

- **Assumes:** codex-cli auto-loads skills from `~/.agents/skills/`. *Validate before building:* create a directory under `~/.agents/skills/` containing a `SKILL.md` whose description is a single nonsense trigger word and nothing else, start codex, prompt it with only that word, and confirm it names the skill. If it does not, stop and re-probe `~/.codex/skills` before changing the target list. Do not validate by telling the model the skill exists — that proves only that it can read a file it was told about.

- **Assumes:** `$HOME/.agents/` is safe to create and write into. *Validate before building:* on the target machine, check whether `~/.agents/` already exists and what it holds — on the reporter's machine it holds an `AGENTS.md`, so `mkdir -p ~/.agents/skills` must add a subdirectory beside existing content and never replace or clear the parent. The installer must not treat `~/.agents` as faff-owned, and `--replace` must not remove anything in `~/.agents/skills` that no discovered faff skill is named after.

## 8. DONE — definition of done

### From WHY

- [ ] After `bash scripts/link-skills.sh --global` on a machine with no prior install, every discovered skill has a symlink at both `~/.claude/skills/<name>` and `~/.agents/skills/<name>`, and both resolve under the source checkout's `plugin/skills/<name>`.
- [ ] `~/.claude/skills` and `~/.agents/skills` are both real directories after a run that started with them real; faff never converts either into a symlink, and entries owned by other tools in either directory are unchanged.
- [ ] `SRC_ROOT` / `SKILLS_ROOT` / `SRC_DIR` remain single-valued, and FAFF-443's worktree-retarget block is unchanged apart from any rename forced by the array.

### From WHAT (types and interfaces)

- [ ] The target list is built exactly once in `scripts/link-skills.sh`, at the point where `TARGET_DIR` is set today; no operational block derives a target path from `$HOME` or `$REPO_ROOT` independently.
- [ ] `--global` yields two targets in the documented order; the default (non-global) mode yields exactly one, `<repo>/.claude/skills`.
- [ ] The list is de-duplicated by resolved path immediately after it is built, before any block iterates it.
- [ ] `DOCTOR_SPEC`'s `--target` remains `arity: 1`, and `faff doctor --target DIR` scans exactly that directory.

### From WHAT (what loops and what stays single-run)

- [ ] `--status` prints the `Source:` line once, initialises its five counters once above the target loop, and reaches its summary, CLI-link line and `exit 0` exactly once regardless of target count — a missing target prints a per-target message and continues rather than exiting.
- [ ] `--unlink` prints its source/mode preamble once, initialises `unlinked` and `left_alone` once above the target loop, removes the CLI symlink once after the loop, and never exits from inside it.
- [ ] The create path prints its header block once and initialises its five counters once above the target loop, so the counts are cross-target totals.
- [ ] `pruned` is initialised once, outside the `--prune` block, as it is today.

### From HOW (installer behaviour)

- [ ] `--status` prints a `Target:` line for each target, its per-skill lines under it, and one combined summary carrying the five existing counters as cross-target totals plus the single CLI-link line.
- [ ] `--unlink` removes this repo's symlinks from every target, continues past a missing or unwritable target, removes the CLI symlink once, and exits non-zero naming any target it could not fully clean.
- [ ] The create path runs `mkdir -p` for each target before linking into it.
- [ ] `--prune` removes dead links under `$SRC_DIR` from every target.
- [ ] A failure at one target does not prevent work at any other target, in any of the four blocks.
- [ ] `cmdSync` in `plugin/skills/faff/bin/lib/gates.js` is unchanged — it still passes `--global --replace [--dry-run]` and no target flags.

### From HOW (aliased targets)

- [ ] When two entries in the list resolve to the same directory, the installer keeps the first, drops the rest, and prints one notice naming both paths.
- [ ] `faff doctor` applies the same de-duplication to its default scan set, so a collapsed setup reports one target and no cross-target missing findings.
- [ ] Resolution uses a `cd`/`pwd -P` subshell in bash and `fs.realpathSync` in Node; a path that does not exist resolves to itself rather than erroring.

### From HOW (blast radius of `--replace`)

- [ ] A `--global --replace` run replaces a faff-named real directory in `~/.agents/skills` and leaves an entry beside it that no discovered faff skill is named after present and byte-identical.
- [ ] Nothing in the create path or `--prune` lists, stats or removes a target-directory entry other than `<target>/<discovered skill name>` and symlinks already resolving under `$SRC_DIR`.

### From HOW (doctor)

- [ ] With no `--target` and no `$CLAUDE_PLUGIN_ROOT`, `faff doctor` scans both `~/.claude/skills` and `~/.agents/skills`.
- [ ] A skill healthy in one scanned directory and absent from another produces a line naming the skill and the directory it is missing from, and makes the overall result exit 1.
- [ ] `faff doctor` returns 2 only when no faff skills are found in any scanned directory, and its message names every directory it tried.
- [ ] An unreadable or absent scanned directory does not cause an early return while another scanned directory holds faff skills.
- [ ] The merge-fence PreToolUse check runs once per invocation, not once per target, and still folds into the same exit code.
- [ ] `faff doctor` with an explicit `--target` reports no cross-target missing findings.
- [ ] With `$CLAUDE_PLUGIN_ROOT` set, `faff doctor` scans one directory and reports no cross-target missing findings, and the divergence this creates between plugin and dev-linked invocations is recorded in the follow-up ticket.

### From HOW (edge cases)

- [ ] Both targets absent → exit 2, message names both.
- [ ] `~/.claude/skills` healthy, `~/.agents/skills` absent → exit 1 with per-skill missing lines and the existing Fix line.
- [ ] A skill present only in `~/.agents/skills` produces a missing line against `~/.claude/skills` (the check is symmetric).
- [ ] `~/.agents/skills` symlinked to `~/.claude/skills` → one target scanned, collapse notice printed, no half-install reported.

### From OUT OF SCOPE

- [ ] `docs/architecture/harness-coupling.md` is not modified by this change.
- [ ] A follow-up ticket exists in the harness-agnostic project covering repo-local (non-`--global`) discovery under codex, linked to FAFF-672.
- [ ] A follow-up ticket exists covering codex discovery for marketplace plugin installs, linked to FAFF-672, naming doctor's deliberate plugin-install silence as the reason the gap is invisible today.

### Docs

- [ ] The `--global` flag description in `scripts/link-skills.sh`'s header comment names both directories, and the header's closing "Done. Skills are now discoverable…" line names both targets.
- [ ] `docs/guide/cli.md` lines 22-23 (`doctor`, `sync`) reflect the two-target model rather than implying one install directory.
- [ ] The gateway's doctor-at-entry section in `plugin/skills/faff/SKILL.md` still describes exit 0 / 1 / 2 correctly given that a half-install is exit 1; no new exit code is introduced.

### Tests — in `test/link-skills-worktree.test.mjs` unless noted

- [ ] Existing tests in `test/link-skills-worktree.test.mjs`, `test/doctor.test.mjs` and `test/sync.test.mjs` pass unmodified except where an assertion legitimately gains a second target.
- [ ] **Every new or amended test that omits `--target` sets `CLAUDE_PLUGIN_ROOT: undefined` alongside `HOME` in its child environment.** Both existing helpers leak it: `link-skills-worktree.test.mjs` spreads `process.env` and overrides only `HOME` (lines 62, 68), and `doctor.test.mjs`'s `run` helper (lines 19-22) passes no `env` at all, so the child inherits the parent's environment whole. A suite run from a plugin-installed session would otherwise take `resolve_doctor_scan_set` step 2, scan the plugin directory instead of the fake `$HOME`, and assert nothing. `doctor.test.mjs`'s `run` helper needs an env parameter before it can host such a test, or the test belongs in `link-skills-worktree.test.mjs` where a `HOME`-aware helper already exists.
- [ ] A test asserts both `join(home, ".claude", "skills", "demo-skill")` and `join(home, ".agents", "skills", "demo-skill")` resolve to the same path under the main checkout after `--global` from a linked worktree.
- [ ] A test asserts `--global --unlink` from a worktree cleans worktree-sourced links from both targets.
- [ ] The FAFF-443 refuse-path test at `test/link-skills-worktree.test.mjs:112` gains the symmetric assertion that `join(home, ".agents", "skills")` does not exist either — a refusal that creates one target is still a half-install.
- [ ] A test asserts a non-faff entry in `~/.agents/skills` survives `--global --replace` while a faff-named copy beside it is replaced.
- [ ] A test asserts that with `~/.agents/skills` symlinked to `~/.claude/skills`, `--status` reports one target and counts each skill once.
- [ ] A doctor test asserts the half-install case: one target populated, the other absent → exit 1 with a missing line naming the absent directory. The fixture must use a faff-owned skill name (`faff`, `faff-*`, `faffter-*`, `faffidavit-*` — existing doctor tests use `faff-graft`), because doctor filters everything else out; `demo-skill` is invisible to it.
- [ ] A doctor test asserts `--target DIR` still scans one directory with no cross-target findings.

### Integration smoke test

```
1. Build a main checkout with plugin/skills/{faff,demo-skill}, under a faked $HOME.
2. Run: bash scripts/link-skills.sh --global   (env HOME=<fake home>)
3. Assert: realpath(<home>/.claude/skills/demo-skill)
        == realpath(<home>/.agents/skills/demo-skill)
        == realpath(<main>/plugin/skills/demo-skill)
4. Run: node <CLI> doctor --root <fenced root>
   (env HOME=<fake home>, CLAUDE_PLUGIN_ROOT unset, no --target — without BOTH of those
   the scan set is not the two-target default and the assertions below prove nothing.)
   Note: doctor only counts faff-OWNED names (faff, faff-*, faffter-*, faffidavit-*),
   so it sees the `faff` skill and ignores `demo-skill`. Assertions in steps 5 and 7
   must therefore be written against `faff`, not `demo-skill`.
5. Assert: exit 0, output mentions both directories, no MISSING lines.
6. Remove <home>/.agents/skills entirely; re-run step 4.
7. Assert: exit 1, output names ~/.agents/skills and reports the `faff` skill missing from it.
```

If steps 3 and 7 both hold, the two-target install and the half-install detector are wired together correctly.

confidence: medium
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"medium","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"punt"},{"marker":"assumes"},{"marker":"assumes"}]}
```

---

## Methodology critique

**Methodology: faffter-dark-methodology-agile-delivery**

**Surfaced dependencies — the precondition nobody is blocked by.** FAFF-672 sits in the Harness-agnostic runtime project with no blocker edges in either direction. Its own spec makes the plainest case: no amount of engine abstraction matters if the harness cannot see the skills. So a globally-installed faff cannot run the loop under codex until this lands — yet FAFF-479, FAFF-482, FAFF-483 and FAFF-668 are all sequencable without it as far as the tracker is concerned. Automation routes off the blocker graph, so the queue will hand out FAFF-483 while the thing that makes the project reachable sits untouched in Backlog, and nobody notices until the loop is run under codex end to end and finds nothing. Add the edges: whichever ticket first requires faff's skills to be visible to codex under a global install — on the stated chain that reads as FAFF-479 — becomes `blockedBy` FAFF-672. If the honest answer is "none of them, this only bites real users", say that in the ticket, because it changes what High means here.

**Right-sizing — two deliverables in one ticket, and the order is not the obvious one.** The spec covers the installer becoming multi-target (bash: `TARGET_DIRS`, four block loops, resolved-path dedupe, the `--replace` name-scoping bound) and `faff doctor` becoming multi-target (node: scan set, `missing_here`, exit-code semantics). Different files, different languages, different failure modes, roughly 45 acceptance items between them. These are two units wearing one ticket, and the spec already draws the seam — its WHAT table splits cleanly at installer versus doctor.

Order matters, and inverting it is the trap. Doctor's exit 1 is what prompts `faff sync`, and `faff sync` is what runs `rm -rf` inside `~/.agents/skills` for the first time. Ship the installer first, with the name-scoping test proving a non-faff entry survives; only then ship the doctor change that points the whole upgraded population at that path. Doctor-first tells every machine to run a repair whose destructive bound has no field evidence yet.

**Risk-aware sequencing — mostly handled.** The `~/.agents/skills` target rests on one live observation against codex-cli 0.145.0, and the spec treats it as an assumption with a named re-probe rather than a fact. The destructive widening is bounded by name-scoping, asserted in tests rather than assumed. That is the right shape. The one unmitigated piece is timing: every pre-change machine reports exit 1 at once, so the entire blast radius arrives on one day. The split above is the de-risking, at no extra cost.

**Priority is carrying weight the graph should carry.** High on FAFF-672 with every sibling unset means priority is the only sequencing signal in the project, and it is the noisiest one available. Once the blocker edges exist, High becomes a tiebreaker rather than the mechanism. Worth setting priority across the siblings in the same pass, or the single High reads as emphasis rather than order.

**The architecture punt rides along.** Hardcoded versus config-driven target list decides architecture, but the ordered list is exactly the shape a config key would populate later, and adding one is additive. It should not block.

**Chain gaps already named.** The spec's acceptance criteria require two follow-up tickets — repo-local discovery under codex, and plugin-install discovery. File them against the project now rather than leaving them as checkboxes on this ticket's completion.
