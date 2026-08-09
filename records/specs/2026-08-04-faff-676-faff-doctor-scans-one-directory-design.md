**Spec attached 2026-07-28.** Three review passes: `revise` (five objections, all QA), `revise` (one), then `approve` with zero.

This spec is a **narrowing of FAFF-672's**, which covered both halves and was approved before the split. Rather than re-deriving settled ground, it carries that spec's reviewed reasoning and adds what a standalone spec needs — its own problem statement, a scope boundary against FAFF-672, and acceptance criteria checkable without the other ticket in hand.

Every objection across all three passes was the same shape: **a guarantee the spec stated but nothing checked.** Worth recording, because it is the failure mode a documentation-shaped spec is most prone to.

The first pass found five. The hardest safety condition — stop if FAFF-672's `--replace` name-scoping test is missing, the thing preventing the upgrade population being pointed at a destructive repair with no field evidence — had no acceptance criterion at all. The flagship installer-and-doctor agreement test was placed where `$CLAUDE_PLUGIN_ROOT` leaks from the ambient environment, so the one test paying for the fact that the bash and Node de-duplication rules cannot share code could have passed while proving nothing. "Output identical to before this change" named no oracle. And the codex assumption carried a validate procedure with no criterion, so a build could tick every box without anyone starting codex.

The second pass found the remaining one, and it was subtle: the golden test's claim that the fixture directory and `--root` were the only per-run variables is **false**. `gates.js:547` reads `~/.local/bin/faff`, outside both placeholders, with four possible outcomes — and the `⚠ WORKTREE` branch increments `intoWorktree`, which rewrites the RESULT sentence *and* flips the exit code. A golden captured on a dev box could not byte-match on CI. The fixture's own live symlink had the same problem from a linked worktree. Both are now pinned.

**Two corrections the producer made to its own brief**, both verified and both mine:

- I claimed FAFF-665 recorded the codex skills observation in `docs/reference/architecture/codex-cli-observed.md`, so the criterion could be discharged by citing it. **That file contains no skills observation** — the probe happened after the file was written and was never folded back in. The criterion is now *run the probe and record it there*, and the spec states plainly that the `~/.agents/skills` claim currently rests on a standards document rather than a run.
- My description of the `$CLAUDE_PLUGIN_ROOT` leak named the wrong mechanism. The two test files that set it do so in a child spawn env and cannot contaminate a sibling file; the real leak is ambient, from any session running faff as an installed plugin. Conclusion unchanged.

Retained at `confidence: medium`, with no open punts. The rating rests on a load-bearing `**Assumes:**` that cannot be validated until FAFF-672 merges — that it landed a two-entry ordered list with `--replace` proven name-scoped. The spec answers with a reconcile procedure giving the builder a rule for each way that can come out, and all three of its stop conditions are now acceptance criteria rather than prose.

**On the codex assumption not being a punt.** The producer argued, and the reviewer accepted, that a punt is an unresolved choice between defensible options — whereas this is a fact about the world with one right answer, a five-minute deterministic procedure, and a file to record it in. Parking a ticket for that would be the wrong trade. What was missing was a criterion, which it now has.

**One advisory the reviewer left for build time**, not worth another revision cycle: the golden's fixture set fixes exit 1, so the clean-branch RESULT sentence is the one line the baseline never captures. A second all-healthy golden case would be cheap and deterministic under the same pinned home.

**Refresh 2026-08-04 — both load-bearing assumptions now discharged; re-rated `confidence: high`.** The medium rating rested on two `**Assumes:**` that could not be checked when the spec was written. Both can now be checked, and both hold:

- *Codex reads `~/.agents/skills`.* No codex binary was present in the refresh environment, so no fresh probe was run — but the spec's own escape clause fires: the observation "if that file has by then gained a skill-discovery observation from another ticket, cite it by version instead." `docs/reference/architecture/codex-cli-observed.md` gained a **Skill loading** section, committed under FAFF-665 (`7f9513c`, PR #501), recording exactly the probe this spec prescribes — two skills planted, one per candidate directory, described only by a nonsense trigger word, prompted with that word alone and the names withheld. Codex named both skills unprompted, from pre-loaded metadata, and the section records that it reads **both** `~/.agents/skills/` and `~/.codex/skills/`. Version-stamped codex-cli 0.145.0, observed 2026-07-28. The directory doctor will name is the one codex actually reads.
- *FAFF-672 landed the shape this consumes.* It has shipped. The landed `scripts/link-skills.sh` builds `TARGET_DIRS=("${HOME}/.claude/skills" "${HOME}/.agents/skills")` and then `dedupe_by_resolved_path` — a fixed list of absolute paths under `$HOME`, the two directories this spec names, in this order. That is `reconcile_with_landed_installer` step 2, the expected case, so the build proceeds without re-pointing anything. The `--replace` name-scoping test exists and passes — `test/link-skills-worktree.test.mjs`, "`--global --replace` replaces a faff-named copy in `~/.agents/skills` but leaves a non-faff entry beside it untouched", green in an 11/11 run — so the step-4 stop condition does not fire, and doctor may point the upgrade population at `faff sync` as designed.

Neither assumption's discharge touched a design decision; both confirmed what the design already assumed. The `assumes` markers stay — they are still facts taken from outside this ticket — but the confidence they held down is released. No open punts, no open questions.

---

# FAFF-676 — faff doctor scans one directory, so a half-install reports clean

> Spec: faffter-dark-nlspec · 2026-07-28, refreshed 2026-08-04 · interactive · confidence: high. Full spec on Linear FAFF-676.

Design spec for FAFF-676, in the project "Harness-agnostic runtime — the loop runs under Codex CLI". Written for the build agent changing `faff doctor` and for the humans reviewing it. Everything the build needs is here. FAFF-672 is the ticket that ships first and whose work this consumes; you do not need to have read its spec, because everything this change depends on from it is restated below as a dependency with a validation step.

## 1. WHY — problem and principles

**The load-bearing model.** A harness discovers skills by scanning a directory it already knows about, before any prompt is written. Claude Code scans `~/.claude/skills`. Codex CLI scans `~/.agents/skills`. So a skill's install location *is* whether that harness can see it at all — there is no partial visibility. Once faff installs into two such directories, a machine can be **half-installed**: every skill healthy in `~/.claude/skills`, nothing in `~/.agents/skills`. Claude Code works perfectly. Codex sees no faff at all. Nothing about that machine looks broken from inside Claude Code.

**Problem statement.** `cmdDoctor` (`plugin/skills/faff/bin/lib/gates.js:503-585`) scans exactly one directory, so it reports a half-installed machine clean and exits 0. `faff doctor` is the mechanism specifically meant to catch a broken install, it runs on every faff invocation through the gateway's entry preamble, and its exit code is what decides whether a repair is offered — so a doctor that cannot see the second directory means the failure is never surfaced to anyone. This change makes doctor scan the same directory list the installer writes to, report a skill present in one directory and absent from another as a problem, and name the directory each finding came from.

### Design principles

**Doctor's scan set must match the installer's target list, or doctor is lying.** The two are separate programs in separate languages — a bash installer and a Node CLI — with no shared module between them. Every guarantee in this spec rests on the two agreeing about which directories matter, so that agreement is proven by a test that runs the real installer and then the real doctor, not asserted in prose.

**Every guarantee this spec states needs a criterion that can fail.** This spec claims three things a build could satisfy in appearance without satisfying in fact: that doctor and the installer agree, that single-directory output did not move, and that `~/.agents/skills` is the directory codex actually reads. Each is paired below with something concrete that fails when the claim is false — an agreement test, a committed baseline, and a recorded probe — and each has its own DONE item. A guarantee with no failing criterion is prose, and prose does not survive a build.

**Exit 2 means silence, so it must stay rare.** The gateway's doctor-at-entry preamble (`plugin/skills/faff/SKILL.md:84-96`) treats exit 0 and exit 2 identically — continue, say nothing — and only exit 1 offers a repair. Today doctor returns 2 the moment a directory is unreadable (`gates.js:516`) or holds no faff skills (`gates.js:517`). A naive per-directory loop that kept those early returns would go silent on exactly the population that needs the message, because every machine that installed faff before this lands has no `~/.agents/skills` at all. Any implementation where a machine with healthy skills in one directory and nothing in the other produces exit 2 has reimplemented the bug.

**A finding without a directory is not a finding.** With one scan directory, naming it once in the header was enough. With two, a line reading `✗ faff-graft COPY` is unactionable — the reader cannot tell which harness is affected or which directory to look in. Every per-skill line must be attributable to exactly one scanned directory.

**Doctor reports; it never repairs.** Doctor reads the filesystem and prints. The repair is `scripts/link-skills.sh`, reached through `faff sync`, and this change adds no write of any kind to doctor. That matters more than usual here: this is the ticket that points the entire upgrade population at a `--replace` run, and doctor's own restraint is what keeps the blast radius owned by one program rather than two.

### Reference context

| File | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js` | Node (CommonJS) | `cmdDoctor` at 503-585 — the whole change. Scan-target resolution at 506-511, `isFaffSkill` at 513, the two exit-2 returns at 516 and 517, the header at 519, per-skill classification at 523-546, the `bin/faff` check at 547-561 — which reads `$HOME` via `homeDir()`, not `--target` or `--root` — the merge-fence check at 563-569, the RESULT/Fix block at 571-582, the clean result at 583-584. `DOCTOR_SPEC` at 38 |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CommonJS) | `homeDir(env = process.env)` at 506 — `HOME` with a `USERPROFILE` fallback, the single home lookup every call site in `bin/lib` goes through. `mainWorktreeRoot` at 487, which `classifyGlobalLink` probes with |
| `plugin/skills/faff/SKILL.md` | Markdown | The gateway's doctor-at-entry preamble at 84-96. Exit-2 gloss at 91, exit-1 gloss at 92, the interactive repair offer at 93, the autonomous branch at 94 |
| `scripts/link-skills.sh` | Bash | The installer FAFF-672 changes. `TARGET_DIR` is set at 75-79 today; FAFF-672 replaces that scalar with the ordered list this spec consumes |
| `test/doctor.test.mjs` | Node test runner | 162 lines. Every skill-link test pins `--target` (41-155), so the default resolution path has no coverage. The `run` helper (19-22) passes no `env` at all, so a child inherits the real environment whole — including `$HOME`, which `gates.js:547` reads. Its assertions are substring matches (`assert.match(r.out, /repo is live/)` and similar). Its fixture symlinks point at `/tmp` (39-40), outside any checkout |
| `test/link-skills-worktree.test.mjs` | Node test runner | Builds a real main checkout plus a linked worktree and runs both the installer and doctor under a faked `$HOME`. Its `linkSh` (60-64) and `doctor` (66-70) helpers spread `process.env` and override only `HOME`, at lines 62 and 68. The `doctor` helper always passes `--target`, so no caller reaches the default scan set |
| `test/contract-golden.test.mjs` | Node test runner | The repo's golden-test precedent: committed fixtures in `test/golden/contracts/cases.json`, spawns the real bin, asserts exactly rather than by substring. Per ADR 0002 |
| `docs/reference/architecture/codex-cli-observed.md` | Markdown | The designated place for dated, version-stamped observations of codex-cli. Header: codex-cli 0.145.0, observed 2026-07-28 under FAFF-665. Its **Skill loading** section (added under FAFF-665, `7f9513c`) records the discovery probe that discharges the codex assumption — see *Assumptions* |
| `docs/guide/cli.md` | Markdown | The one-line `doctor` row at line 22 |

**Scope.** This is the detection half of the two-directory install. FAFF-672 changes where skills are placed; this changes whether a machine can tell you the placement went wrong. It touches one function in the CLI, the gateway prose that reads its exit code, and the tests.

## 2. OUT OF SCOPE

- **The installer itself — `scripts/link-skills.sh`.** FAFF-672 owns every line of it, including the ordered target list, the de-duplication, the `--status` / `--unlink` / create / `--prune` loops, and the name-scoping bound on `--replace`. *Why excluded:* this ticket is `blockedBy` FAFF-672 for a reason — doctor's exit 1 is what drives users at `faff sync`, and `faff sync` runs `--replace` inside `~/.agents/skills` for the first time. Making doctor loud before that removal is proven name-scoped points the whole upgrade population at an unvalidated destructive path. *Extension point:* none needed — the installer is already changed by the time this builds.

- **Adding `--json` to doctor.** FAFF-676's own description asks that "`faff doctor --json` names the directories it actually scanned". There is no such flag: `DOCTOR_SPEC` (`gates.js:38`) declares exactly `--target` and `--root`, both `arity: 1`. *Why excluded:* the requirement is right in substance and wrong in mechanism. What doctor emits is a human-readable report whose header already names its scan target, so naming every scanned directory is a change to that existing output, not a new flag. A machine-readable doctor may well be worth having, but it is a new output contract with its own consumers and its own tests, and smuggling it in here would double the surface of a bug fix. *Extension point:* `DOCTOR_SPEC` at `gates.js:38` plus a serialiser over the `DoctorReport` record defined in WHAT — that record is deliberately shaped so a future `--json` can print it directly rather than re-deriving anything.

- **The `$CLAUDE_PLUGIN_ROOT` short-circuit and the divergence it causes (FAFF-675).** When `$CLAUDE_PLUGIN_ROOT` is set, doctor scans the plugin's own skills directory and nothing else, so the same machine reports differently depending on which harness invoked doctor. *Why excluded:* that is FAFF-675, filed separately and unresolved by this ticket. This change deliberately preserves the short-circuit's behaviour. *Extension point:* step 2 of `resolve_doctor_scan_set` in WHAT, which is written to return a list of one so FAFF-675 can widen or delete it without restructuring anything around it. See *What this leaves intact for FAFF-675* in HOW.

- **Repo-local (non-`--global`) installs and marketplace plugin installs.** Neither gets a second directory from FAFF-672, so neither can be half-installed in the sense this ticket detects. *Why excluded:* both are real gaps in codex discovery, both are already recorded as follow-ups against FAFF-672, and neither is a doctor defect. *Extension point:* `resolve_doctor_scan_set` steps 1 and 2, which is where a widened scan set for either case would land.

- **`cmdSync` and the repair command doctor prints.** `cmdSync` shells out with `--global --replace` and no target flags, and the Fix line doctor prints is unchanged text. *Why excluded:* the installer alone decides its targets, and teaching either sync or doctor's Fix line about targets would create a second source of truth for the list. *Extension point:* none wanted.

- **The wrong usage string at `gates.js:505`.** The parse-error path prints `usage: faff doctor [--target live|intoWorktree] [--root DIR]`. `--target` takes a directory; `live` and `intoWorktree` are link-classification states from `classifyGlobalLink` that leaked into the usage text. `docs/guide/cli.md:22` documents the flag correctly as `--target DIR`, so the CLI's own usage line is the odd one out. *Why excluded:* a genuine pre-existing bug, one line, unrelated to multi-directory scanning — fixing it here would put an unreviewed change in a diff about something else. *Extension point:* `gates.js:505`. **This is un-ticketed work surfaced by this spec:** the build agent files it as its own bug ticket rather than silently fixing or silently ignoring it.

## 3. WHAT — vocabulary, types, interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Install target | A directory a harness scans for skills, into which the installer places one symlink per faff skill. FAFF-672 makes global mode write to two of them. |
| Scan set | The ordered list of directories a single `faff doctor` invocation reads. Derived from the installer's target list, or pinned to one directory by `--target`. |
| Half-install | A machine where at least one faff skill is present in one scanned directory and absent from another. The failure state this ticket exists to make visible. |
| Missing-here set | For one scanned directory, the faff skill names found in some other scanned directory but not in this one. Empty by construction when the scan set has one entry. |
| Resolved path | A directory path with every symlink in it followed. Two different path strings can share one resolved path, and then they are one directory, not two. |
| Single-directory golden | A committed capture of doctor's output for a one-directory scan, taken before this change under a pinned fixture environment and compared byte-for-byte after it under the same one. The oracle for "output is unchanged". |

### Inherited from FAFF-672 — consumed, not defined here

Three things arrive already built. This spec uses them and does not restate their derivation:

| Inherited thing | What it is | Where it comes from |
|---|---|---|
| The ordered target list | In global mode, `~/.claude/skills` then `~/.agents/skills`, in that order, both holding one symlink per faff skill pointing into the repo. Document order is output order and carries no other meaning. | `scripts/link-skills.sh`, built once where `TARGET_DIR` is set today (lines 75-79) |
| De-duplication by resolved path | A user who has already hand-fixed the underlying bug by symlinking one of those directories at the other has one directory reachable by two paths. The list collapses to one entry, first occurrence wins, and a one-line notice names the collapse. | The same file, applied immediately after the list is built |
| The `--replace` name-scoping bound | The installer only ever touches destination entries named after a discovered faff skill — `faff`, `faff-*`, `faffter-*`, `faffidavit-*` — so other tools' skills in `~/.agents/skills` survive a `faff sync`. Proven by test, in FAFF-672. | The create path and `--prune` in the same file |

The name-scoping bound is not something doctor calls; it is the precondition that makes it safe for doctor to send people at `faff sync` at all. If it has not landed and been proven by a passing test, this ticket must not ship — see *What if FAFF-672 landed a different shape* in HOW, whose steps 3 and 4 each carry their own DONE item so the stop conditions are checkable rather than merely written down.

### The scan set

`cmdDoctor` currently picks one directory: `--target` if given, else `$CLAUDE_PLUGIN_ROOT/skills` if `$CLAUDE_PLUGIN_ROOT` is set, else `~/.claude/skills` (`gates.js:506-511`). It becomes a list, and only the third branch grows:

```
PROCEDURE resolve_doctor_scan_set(target_flag, plugin_root_env, home):
  1. IF target_flag given:  RETURN [ target_flag ]                     # explicit pin — exactly one
  2. IF plugin_root_env set: RETURN [ plugin_root_env + "/skills" ]     # plugin install — exactly one
  3. candidates = [ home + "/.claude/skills", home + "/.agents/skills" ]
  4. RETURN dedupe_by_resolved_path(candidates)                        # dev-linked default — one or two
```

Steps 1 and 2 are today's behaviour, unchanged in effect and only rewrapped to return a one-element list. `--target` stays `arity: 1` and still means "scan exactly this directory", so `DOCTOR_SPEC` is untouched and every existing test keeps passing.

```
PROCEDURE dedupe_by_resolved_path(candidates):
  1. kept = []; seen = {}
  2. FOR EACH path in candidates, in order:
     a. resolved = the path with all symlinks followed, if it exists;
        otherwise the path exactly as given   # a path that does not exist can alias nothing
     b. IF resolved already in seen:
        - record a collapse notice naming this path and seen[resolved]
        - CONTINUE
     c. seen[resolved] = path; kept += path
  3. RETURN kept                              # order preserved; first occurrence wins
```

In Node this is `fs.realpathSync`, catching the throw for a path that does not exist and falling back to the literal path. This is the same rule the installer applies in bash; the two implementations are kept honest by the agreement test, not by sharing code — see *How doctor learns the target list* in HOW.

### What a scan produces

```
RECORD DirectoryScan:
  directory: AbsolutePath      # the literal path, as printed
  readable: Boolean            # false ⇒ absent, or readdir threw
  unreadable_reason: String?   # present only when readable is false
  names_found: Set<Name>       # faff-owned names only; empty when unreadable
  copies: Count                # real directories where a symlink was expected
  dangling: Count              # symlinks whose target is gone
  into_worktree: Count         # live symlinks resolving into a linked worktree
  missing_here: List<Name>     # names found in another scanned directory but not this one

RECORD DoctorReport:
  scans: List<DirectoryScan>       # one per entry in the scan set, in scan-set order
  collapse_notices: List<String>   # from dedupe_by_resolved_path; usually empty
  bin_link_state: live | into_worktree | copy | absent   # machine-wide, once per invocation
  fence_present: Boolean                                  # machine-wide, once per invocation
  exit_code: 0 | 1 | 2

  CONSTRAINT every entry in scans has a distinct resolved path
  CONSTRAINT missing_here is empty for every scan when scans has one entry
```

Per-skill classification inside a directory — live symlink into the repo, live symlink into a worktree, dangling, or copy — is exactly today's logic at `gates.js:523-546` and is not changed by this spec. The `bin/faff` check (`gates.js:547-561`) and the merge-fence check (`gates.js:563-569`) are machine-wide facts, not per-directory ones: they run once per invocation regardless of how many directories were scanned.

## 4. HOW — behaviour

### The scan

```
PROCEDURE doctor(scan_set, root):
  1. FOR EACH directory in scan_set:
     a. readdir it. On failure, record readable=false with the error message and CONTINUE
        — never return early.
     b. Filter entries to faff-owned names (faff, faff-*, faffter-*, faffidavit-*).
     c. lstat-classify each survivor exactly as today.
  2. union = every faff skill name found in any scanned directory
  3. IF union is empty:
     a. Write to stderr: "no faff skills found under any of: <every directory tried>"
     b. RETURN 2      # nothing installed anywhere — today's meaning of exit 2, preserved
  4. FOR EACH directory in scan_set:  missing_here = union minus that directory's names_found
     (an unreadable directory found nothing, so its missing_here is the whole union)
  5. Print the report — see "What the report looks like" below.
  6. Check bin/faff and the merge-fence PreToolUse registration under <root> — UNCHANGED,
     once per invocation, not once per directory.
  7. IF any copies OR dangling OR into_worktree OR any non-empty missing_here OR fence missing:
     a. Print the RESULT line naming each problem class, including
        "<n> skill(s) missing from <directory>" once per affected directory
     b. Print the existing Fix line
     c. RETURN 1
  8. RETURN 0
```

Note what step 3 replaces. Today there are two separate exit-2 returns — `readdirSync` throwing (`gates.js:516`) and zero matching entries (`gates.js:517`) — and both fire before anything else has been looked at. Both collapse into one check that runs *after* every directory has been scanned. A directory that is absent or unreadable is no longer a reason to stop; it is a directory that found nothing, which is a fact about that directory and only becomes the verdict if it is true of all of them.

**Anti-pattern:** keeping the early return and wrapping the current body in a per-directory loop. Why: the first directory scanned on a freshly-upgraded machine is `~/.claude/skills`, which is healthy, but the second is `~/.agents/skills`, which does not exist — and an early return there produces exit 2, which the gateway preamble treats as "say nothing". That is silence on precisely the population the ticket exists to reach.

### What the report looks like

**A scan set of one directory prints exactly what it prints today.** Same header, same two-space indented per-skill lines, same RESULT and Fix wording. That covers `--target`, plugin installs, and any collapsed alias, and it is what keeps the ten existing `--target` tests passing unmodified. What proves it is a committed baseline, not those ten tests — see the next subsection.

**A scan set of more than one directory** names the count in the header and then opens a section per directory, in scan-set order, whose per-skill lines are indented one level further so no finding is ambiguous about where it came from:

```
faff doctor — install health (2 directories scanned)

  /Users/alec/.claude/skills
    ✓ faff  symlink (live → repo)
    ✓ faff-graft  symlink (live → repo)

  /Users/alec/.agents/skills
    ✗ not present — all 30 faff skill(s) found elsewhere are MISSING here

  ✓ bin/faff  symlink (live)
  ✓ merge-fence PreToolUse fence present

RESULT: 30 skill(s) missing from /Users/alec/.agents/skills — install is not clean.
Fix: bash scripts/link-skills.sh --global --replace --prune  (from the main checkout)
```

Every directory in the scan set gets a section, including ones that are absent or unreadable — that is how the report "names the directories it actually scanned", which is what the ticket asks for. The two machine-wide checks sit after the last directory section at the same indent as the section headers, so they read as siblings of the directories rather than as findings inside the last one. Collapse notices, when the scan set de-duplicated, print immediately under the header.

### What proves the one-directory output is unchanged

The byte-identity claim above is load-bearing — it is the whole reason the ten existing `--target` tests can stay unmodified — and nothing in the suite currently checks it. Those ten tests assert substrings: `assert.match(r.out, /repo is live/)` and its siblings. A change to spacing, to the order of the per-skill lines, or to a word inside the RESULT sentence passes all ten and still breaks the claim. A guarantee whose only evidence is a test that cannot fail on it is not evidence.

Two things in that output are not functions of the fixture, though, and a golden that leaves either alone is a photograph of the machine that captured it rather than of doctor. Both have to be pinned before the baseline is worth committing.

**The `bin/faff` line is read from `$HOME`, not from the fixture.** `gates.js:547` checks `path.join(homeDir(), ".local", "bin", "faff")` — a path neither `--target` nor `--root` reaches, and `homeDir()` (`shared-infra.js:506`) is just `HOME` with a `USERPROFILE` fallback. That one path yields four different single-directory outputs: `✓ bin/faff  symlink (live)`, the `⚠` worktree-sourced line at `gates.js:554`, `• bin/faff  real file (copy)` at 559, or no line at all, because the `catch` at `gates.js:561` swallows a missing file. The `⚠` branch also increments `intoWorktree`, which rewrites the RESULT sentence at `gates.js:571-582` **and turns exit 0 into exit 1** — so an unpinned `$HOME` makes the captured exit code machine-dependent too, not only the text. Nothing in `test/doctor.test.mjs` passes a child environment at all (`run`, 19-22), so a verifying run there inherits the real `$HOME` of whoever ran the suite: a golden captured on a dev box with the CLI linked cannot byte-match on CI, where that path is absent.

So the golden test pins `HOME` to a fixture home of its own. It needs that even though it always passes `--target` and therefore never reaches the default scan set — a second, independent reason for the environment helper described in *Where do the new tests live* in the rationale, and the reason that helper's DONE item is written to cover byte-exact tests as well as default-scan-set ones.

**The fixture's live symlink must not point into the repo.** `classifyGlobalLink` (`gates.js:490-501`) returns `intoWorktree` for any link resolving into a linked worktree, so a fixture link pointing at this checkout classifies one way when the suite runs from the main checkout and the other way when it runs from a worktree — moving the `⚠` line, the RESULT sentence and the exit code with it. The existing doctor tests already sidestep this by pointing their fixture links at `/tmp` (`test/doctor.test.mjs:39-40`), and copying them costs no coverage: the live branch at `gates.js:534` prints the fixed string `symlink (live → repo)` whatever the link resolves to, so a non-repo target exercises the same branch and produces the same bytes.

With both pinned, the baseline is captured before `cmdDoctor` is touched and compared exactly afterwards:

```
PROCEDURE capture_single_directory_golden():
  1. BEFORE editing cmdDoctor, build two fixtures:
     a. A scan directory holding a fixed set of faff-owned names covering the
        classifications reachable without a git worktree: a live symlink to a
        NON-REPO path, a dangling symlink, and a copy (a real directory).
     b. A fixture home whose .local/bin/faff is a symlink to that same non-repo
        path, so the bin/faff line is deterministically "✓ bin/faff  symlink
        (live)" and contributes nothing to the exit code.
     Use a pre-fenced --root, exactly as mkFencedRoot does today.
  2. Run the CURRENT doctor with --target <scan dir> --root <fenced root>, in a
     child environment with HOME set to the fixture home and CLAUDE_PLUGIN_ROOT
     deleted. Capture stdout, stderr and the exit code.
  3. Normalise: replace every occurrence of the three absolute paths that differ
     per run — the scan directory, the --root, and the fixture home — with the
     literal placeholders <TARGET>, <ROOT> and <HOME>.
  4. Check the normalised text holds no absolute path at all. One that survives is
     a per-run value nobody pinned, and the capture is not yet a golden.
  5. Commit the normalised text as test/golden/doctor/single-directory.txt.
  6. AFTER the change, a test rebuilds both fixtures, re-runs step 2 with the same
     pinned environment, applies the same normalisation, and asserts BYTE EQUALITY
     against the committed file, plus equality of the exit code.
```

Step 4 is the part worth keeping even though steps 1 to 3 are believed to cover everything. The `bin/faff` path was missed on the first pass precisely because it is read from somewhere no flag names; a leak check that fails on any surviving absolute path catches the next one of those without anyone having to think of it first.

The worktree-sourced classification is deliberately outside the golden: producing it needs a real linked worktree, which is what `test/link-skills-worktree.test.mjs` exists to build, and dragging that setup into a golden capture would make the baseline expensive and flaky for one extra line. That line's behaviour is unchanged by this spec and stays covered where it already is.

This follows the repo's existing golden pattern — `test/contract-golden.test.mjs` reading committed cases from `test/golden/contracts/cases.json`, spawning the real bin, asserting exactly rather than by substring. It is a second instance of that discipline rather than a reuse of that file: the contract harness feeds stdin and deep-equals parsed JSON, whereas doctor takes a filesystem fixture and emits human-readable text, so they share the approach and not the code.

**Anti-pattern:** discharging "output is unchanged" by adding more substring assertions. Why: substrings are exactly what the existing ten tests already do, and they are exactly what lets wording, ordering and indentation drift through unnoticed. The claim is byte-identity; only a byte comparison can carry it.

**Anti-pattern:** making the golden tolerant of the `bin/faff` line — skipping it, matching it loosely, or stripping it before comparing — when the comparison fails on a machine where it differs. Why: that failure is the environment being unpinned, not the assertion being too strict, and loosening it re-opens the substring gap the golden exists to close. The repair is the fixture home in step 1b, not a weaker comparison.

### How much an empty directory prints

There are thirty skills under `plugin/skills`, so a directory contributing nothing would otherwise emit thirty near-identical MISSING lines — and that is the state of every machine on its first run after FAFF-672 lands, which makes it the most-seen output this change produces.

```
PROCEDURE render_missing(scan, union):
  1. IF scan.names_found is empty:
     a. Print ONE line: the reason (not present / unreadable: <message> / no faff skills here)
        followed by "— all <|union|> faff skill(s) found elsewhere are MISSING here"
  2. ELSE:
     a. Print one line per name in scan.missing_here:
        "✗ <name>  MISSING here — this harness cannot see it"
```

The rule keys on "this directory found nothing", not on a line-count threshold. A directory that found nothing is one fact stated once; a directory missing a subset is a genuinely per-skill fact, and those lines are not capped, because a subset-missing state means a partial install failure where knowing exactly which skills are affected is the point.

**Anti-pattern:** printing per-skill MISSING lines for a directory that does not exist. Why: it turns the single most common post-upgrade report into thirty lines that all say the same thing, buries the RESULT line, and reads as thirty problems when it is one.

### The verdict, and the exit-code contract

**One verdict, per-directory detail.** Doctor prints one RESULT line and returns one exit code for the whole invocation, with the per-directory sections carrying the detail. Its only programmatic consumer is the gateway's doctor-at-entry preamble, which branches on exactly 0 / 1 / 2 from a single process; per-directory exit codes have nowhere to go.

A half-install folds into exit 1 alongside copies, dangling links and worktree-sourced links, with the existing Fix line, because it is exactly what exit 1 already means: a repairable install that is not clean. The three codes end up meaning:

| Exit | When | What the gateway preamble does |
|---|---|---|
| 0 | Every scanned directory holds every faff skill as a live symlink into the repo, the CLI link is fine, and the merge fence is registered | Silent, continue |
| 1 | Any copy, dangling link, worktree-sourced link, missing-here finding, or absent merge fence, in any scanned directory | Interactive: offers `faff sync`. Autonomous: logs and continues, never mutating `$HOME` |
| 2 | No faff skills found in *any* scanned directory | Silent, continue |

Exit 2 keeps its existing meaning — "faff does not appear to be installed here, so there is nothing useful to say" — and gets strictly rarer, because it now needs every scanned directory to come up empty rather than just the first one.

**Anti-pattern:** a new exit code for a half-install. Why: the gateway preamble branches on 0 / 1 / 2 and nothing else, so a third code would need the preamble prose changed and would do nothing at all on any caller that had not been updated. A half-install is a repairable not-clean install; that is what exit 1 is.

### How doctor learns the target list

Doctor restates the derivation in Node rather than asking the installer. The alternative — shelling out to `scripts/link-skills.sh` for its target list — would make a health check depend on locating a bash script in a checkout, which is exactly the resolution problem `cmdSync` needs a layered resolver for (`gates.js:587` onwards), and which fails outright on a plugin install or a stale copy-install. Doctor works by reading the filesystem precisely so that it still works when the install it is diagnosing is broken.

The cost of restating is drift: two lists in two languages that can quietly disagree, at which point doctor reports confidently about directories nobody writes to. That is paid for with a test rather than a promise — run the real installer under a faked `$HOME`, then run the real doctor under the same faked `$HOME` with no `--target` and no `$CLAUDE_PLUGIN_ROOT`, and assert that every directory the installer created appears as a section in doctor's report and that the verdict is clean. If the lists ever diverge, that test fails.

**That test only proves anything if its child process actually reaches the default scan set**, and in the file it belongs in, it currently would not. `test/link-skills-worktree.test.mjs`'s `doctor` helper (66-70) builds its child environment as `{ ...process.env, HOME: home }` at line 68 — it overrides `HOME` and nothing else. `$CLAUDE_PLUGIN_ROOT` survives into the child whenever it is set in the ambient environment of whoever runs the suite, which is every agent session running faff as an installed plugin. Step 2 of `resolve_doctor_scan_set` then short-circuits to the plugin's own skills directory and the home-directory branch is never evaluated. Nothing anywhere in the repo deletes that variable from a child environment — `test/setup-worktree-direct.test.mjs:47` and `test/setup-worktree-clobber.test.mjs:55` both deliberately set it, and no file unsets it. So the agreement test, the single test carrying the drift guarantee, could pass while proving nothing at all. It needs a helper of its own that deletes the variable; see *Where do the new tests live* in the rationale, and the DONE items that name both test files.

**Anti-pattern:** hardcoding `.claude` and `.agents` at more than one point in `gates.js`. Why: the whole failure mode being guarded against is two places disagreeing about a list of directories; adding a third inside doctor itself would be careless. Step 3 of `resolve_doctor_scan_set` is the only place in Node that names them.

### What if FAFF-672 landed a different shape

This spec assumes FAFF-672 shipped two hardcoded global targets in a known order. It might not have: its own spec carries an open question about making the target list configurable, and a later codex release could add a third directory.

```
PROCEDURE reconcile_with_landed_installer():
  1. Read the landed scripts/link-skills.sh. Find the block that replaced the
     TARGET_DIR assignment at today's lines 75-79.
  2. IF it builds a fixed list of absolute paths under $HOME:
     a. Mirror that list — its contents AND its order — in resolve_doctor_scan_set step 3,
        even if it is not the two paths this spec names. Adjust the DONE criteria and the
        expected report to whatever it actually built. Proceed.
  3. IF it builds the list from configuration, or from anything doctor cannot evaluate
     from the filesystem alone:
     a. STOP. Do not hardcode two paths in doctor.
     b. Report the divergence and escalate: doctor deriving its scan set from a different
        source than the installer is a worse bug than the one this ticket fixes, because
        it produces confident findings about directories nothing writes to.
  4. IF the --replace name-scoping test does not exist or does not pass:
     a. STOP. This ticket points the whole upgrade population at that removal path.
```

Step 2 is the expected case and needs no permission. Steps 3 and 4 are the ones the builder must not paper over — the failure they prevent is silent and the escalation is cheap. Both stop conditions carry DONE items (see *From HOW (the installer's list)*), because a stop condition nobody has to record having evaluated is a stop condition a build walks straight past.

**Refresh 2026-08-04:** this reconcile now has an answer — the landed installer is reconcile step 2 (a fixed `$HOME`-relative list of the two named paths, in order), and the `--replace` name-scoping test passes. See the discharged *Assumes* in Section 7. The procedure and its DONE items stay so the build re-checks against the exact tree it edits rather than inheriting this refresh's check.

### What this leaves intact for FAFF-675

FAFF-675 covers a different defect on the same function: the `$CLAUDE_PLUGIN_ROOT` short-circuit means the same machine reports differently depending on whether doctor was invoked from a plugin session or a dev-linked one. This change edits the same resolution logic, so it is worth being explicit about what it does not decide.

Left exactly as it behaves today: `--target` wins outright and yields one directory; `$CLAUDE_PLUGIN_ROOT`, when set and `--target` is not, yields `$CLAUDE_PLUGIN_ROOT/skills` and nothing else; a plugin-installed machine therefore never reports a half-install even when codex genuinely cannot see the skills. FAFF-675 decides whether the short-circuit should exist, whether it should be one entry in a longer list, and what a plugin machine should be told.

What this change hands it: the branch returns a **list**, not a scalar. Widening the plugin case to `[ pluginRoot + "/skills", home + "/.claude/skills", home + "/.agents/skills" ]`, or deleting the branch outright, is then a change to one `RETURN` inside `resolve_doctor_scan_set` — every consumer downstream already handles any number of directories, including the report layout, the missing-here computation and the exit-code rule.

### The gateway prose

`plugin/skills/faff/SKILL.md:84-96` describes doctor's exit codes to the reader who runs the preamble, and two of its glosses become wrong:

- Line 91 calls exit 2 "no faff skills under the target / unreadable". "Unreadable" is no longer a route to exit 2 at all, and "the target" is now potentially several directories. It becomes: no faff skills found in any scanned directory.
- Line 92 calls exit 1 "one or more **COPY** installs — stale risk". It becomes the full set: copies, dangling links, worktree-sourced links, skills missing from a scanned directory, or a missing merge fence.
- Line 93's interactive offer text — `faff skills look stale (copy-installs, not symlinks) — repo changes won't be live. Re-link now? (y/n)` — is a false sentence on a half-installed machine, where nothing is stale and everything present is a symlink. It is generalised to one line that is true of every exit-1 cause, and it keeps naming the consequence rather than the mechanism, because the consequence is what makes the offer worth accepting.

The offer stays a single generalised line rather than branching per cause, because branching would require the gateway to parse doctor's stdout to find out which class of problem fired. It reads only the exit code today, and giving it a text-parsing dependency on doctor's output would make the report format a machine contract — which is exactly the surface the `--json` question in OUT OF SCOPE exists to keep closed for now.

Line 94's autonomous branch is unchanged and remains correct: never prompt, never run `faff sync`, never mutate `$HOME`; log the finding and continue.

`docs/guide/cli.md`'s `doctor` row — line 22 in today's tree, describing the flags as `[--target DIR] [--root DIR]` — has the same problem in the user-facing guide: it presents install health as a single-target check. It is updated to say doctor scans the installer's global target directories by default and that `--target` pins it to exactly one.

### Edge cases

- **`--target` pinned to one directory.** One-entry scan set, so every `missing_here` is empty by construction and the output is today's, unchanged. The ten existing tests at `test/doctor.test.mjs:41-155` pass without modification, and the single-directory golden proves the output behind them did not move.
- **Both default directories absent.** Exit 2, and the stderr message names both directories tried rather than only the first.
- **`~/.claude/skills` healthy, `~/.agents/skills` absent.** Exit 1, one collapsed missing line against `~/.agents/skills`, existing Fix line. This is the state of every pre-change machine after FAFF-672 lands, and it is the case the ticket is about.
- **A skill present only in `~/.agents/skills`.** Symmetric — a missing line against `~/.claude/skills`. The check is a set difference computed for every scanned directory, not "does the second directory match the first".
- **A skill healthy in one directory and a stale copy in the other.** Both reported: the copy under its own directory's section as today, and no missing line, because the name is present there — just unhealthy.
- **One default directory is a symlink to the other.** The scan set collapses to one entry, the collapse notice prints, missing-here is empty by construction, and the report is the single-directory layout. That machine works — both harnesses see every skill — and reporting a half-install on it would be a lie.
- **A directory exists but holds no faff skills.** Contributes nothing to the union, gets the collapsed missing line with the "no faff skills here" reason. Only if this is true of *every* scanned directory does it become exit 2.
- **A directory is unreadable for a reason other than absence** — permissions, say. Same treatment, with the error message in the reason. It is a directory that found nothing, plus a stated cause.

### Failure modes

- **The failure: doctor's scan set and the installer's target list disagree.** Doctor then reports confidently about a directory nothing writes to, or stays quiet about one that matters — and both look like working software. *How you'd know:* the installer-and-doctor agreement test fails, or doctor names a directory the installer did not create. *What it means:* stop and reconcile against the landed installer per `reconcile_with_landed_installer`. This is the one failure here that makes doctor actively misleading rather than merely incomplete.

- **The failure: the agreement test passes without exercising the default scan set.** If `$CLAUDE_PLUGIN_ROOT` reaches the child, doctor short-circuits to the plugin's skills directory and the test asserts against a code path this ticket does not change — a green test standing in for a guarantee nobody checked. *How you'd know:* the test asserts on the environment it built, not just on doctor's output — it fails if `CLAUDE_PLUGIN_ROOT` is present in the child environment it passes, and it asserts doctor's header names the faked `$HOME` directories rather than any plugin path. *What it means:* fix the helper, not the assertion. This one is worth stating separately because it is the failure that hides the failure above.

- **The failure: `~/.agents/skills` is not what this codex version reads.** Doctor becomes precise and loud about the wrong directory, and every machine gets pointed at a repair that fixes nothing observable. *How you'd know:* the probe in *Assumptions* — plant one skill in `~/.agents/skills` described only as triggering on a nonsense word, start codex, prompt it with that word alone, and see whether it names the skill. *What it means:* narrow — the detection logic is fine and directory-agnostic, but the list in `resolve_doctor_scan_set` step 3 and the installer's list both need re-pointing before either ships. (Refresh 2026-08-04: confirmed true for codex-cli 0.145.0 — this stays as the guard for a newer codex the build runs against.)

- **The failure: the new finding is noise for people who will never run codex.** Every pre-change machine flips to exit 1 on its first run after FAFF-672 lands, and the gateway offers a repair. *How you'd know:* the offer fires for users with no codex installed. *What it means:* proceed. This was settled when FAFF-672 chose two unconditional targets — the repair is one keystroke, idempotent, and creates a directory that costs nothing if unused. It is worth naming here because this is the ticket that actually makes it happen — FAFF-672 creates the condition, and doctor is what turns it into a message on every machine.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given every faff skill is a healthy symlink in ~/.claude/skills
 And ~/.agents/skills does not exist
When faff doctor runs with no --target and no CLAUDE_PLUGIN_ROOT
Then it exits 1
 And its output names ~/.agents/skills as a directory it scanned
 And it reports the skills as missing from ~/.agents/skills
 And its Fix line names the link-skills.sh repair command
```

```
Given no faff skills exist in either ~/.claude/skills or ~/.agents/skills
When faff doctor runs with no --target and no CLAUDE_PLUGIN_ROOT
Then it exits 2
 And its message names both directories it tried
```

```
Given faff skills are healthy symlinks in both ~/.claude/skills and ~/.agents/skills
When faff doctor runs with no --target and no CLAUDE_PLUGIN_ROOT
Then it exits 0
 And its output contains a section for each of the two directories
```

```
Given the single-directory golden captured from doctor before this change
 And the same scan fixture and fixture home it was captured from
When faff doctor runs after this change with --target set to that scan fixture
     and HOME pinned to that fixture home
Then its normalised output is byte-identical to the committed golden
 And its exit code matches the one captured with it
```

- `faff doctor` MUST NOT write to the filesystem under any scan set, exit code, or flag combination.
- The merge-fence check and the `bin/faff` check MUST each run exactly once per invocation regardless of how many directories were scanned.
- `faff doctor` with an explicit `--target` MUST scan exactly one directory and MUST NOT report any missing-here finding.
- No test that reaches the default scan-set path, and no test that asserts doctor's output byte-exactly, may run doctor in a child environment carrying the runner's real `$HOME` or any value of `$CLAUDE_PLUGIN_ROOT`.

## 6. Design decision rationale

**What is `faff doctor`'s default scan set?**

Options: keep scanning one directory and detect half-installs some other way; scan both defaults; add a `--targets` list flag. Keeping one directory is the bug — doctor reports clean on a machine where codex sees nothing, and no other mechanism runs on every faff invocation. A list flag adds a surface nobody asked for: `--target` already covers pinning for tests, and the default covers real use.

**Chosen:** the default scan set is both `~/.claude/skills` and `~/.agents/skills`, de-duplicated by resolved path, matching the installer's global target list. `--target` and `$CLAUDE_PLUGIN_ROOT` each still resolve to exactly one directory, so `DOCTOR_SPEC` is untouched, `--target` stays `arity: 1`, and every existing test passes unmodified.

**How does doctor learn the installer's target list?**

Options: shell out to `scripts/link-skills.sh` for the authoritative list; share a data file both programs read; restate the derivation in Node. Shelling out makes a health check depend on locating a bash script in a checkout — the resolution problem `cmdSync` needs a layered resolver for (`gates.js:587` onwards) — and fails outright on a plugin install or the stale copy-install doctor exists to diagnose. A shared data file means a third artifact and a new read path in bash during bootstrap, for a list of two paths.

**Chosen:** restate it in Node, in one place — step 3 of `resolve_doctor_scan_set`, the only point in `gates.js` that names `.claude` or `.agents` — and pay for the drift risk with a test that runs the real installer and then the real doctor under one faked `$HOME` and asserts they agree about which directories exist. That test only counts if its child environment reaches the default branch, which is why it carries an environment assertion of its own rather than only an output assertion. Prose cannot keep two languages in step; a failing test can.

**What if FAFF-672 landed a different shape from the one this assumes?**

Options: hardcode the two paths and let a mismatch surface in review; derive doctor's list from whatever the installer actually built and adapt; stop and escalate on any divergence. Hardcoding regardless is the worst outcome available — a doctor confidently reporting on directories nothing writes to is more damaging than the silent doctor being replaced.

**Chosen:** reconcile at build time against the landed `scripts/link-skills.sh`, per `reconcile_with_landed_installer` in HOW, with each of its two stop conditions recorded as a DONE item so neither can be skipped silently. A landed list of fixed absolute paths is mirrored as-is, contents and order, even if it is not the two paths named here, and the build proceeds without asking. A list built from configuration, or anything doctor cannot evaluate from the filesystem alone, is a full stop and an escalation — as is a missing or failing `--replace` name-scoping test, since this ticket is what sends the whole upgrade population at that removal path. (Refresh 2026-08-04: the landed installer is the expected step-2 case and the name-scoping test passes — see the discharged *Assumes*.)

**What does the multi-directory report look like?**

Options: keep one flat list and add a directory column to each line; one section per directory; interleave and sort by skill name. A column on every line repeats the same long path thirty times and still makes "is this harness fine?" a scanning exercise. Interleaving by skill name optimises for a question — "where is faff-graft?" — that nobody asks; the question being asked is "which harness is broken?".

**Chosen:** a scan set of one directory prints byte-identical output to today, which is what keeps the ten existing `--target` tests passing. More than one prints a count in the header, then one section per directory in scan-set order with per-skill lines indented under it, then the two machine-wide checks at section-header level, then the unchanged RESULT and Fix block. Every scanned directory gets a section, including absent ones — that is how the report names what it looked at, which is the ticket's requirement once its mistaken `--json` framing is set aside.

**What proves that the one-directory output really is byte-identical?**

Options: rely on the ten existing `--target` tests; capture a baseline before the change and compare exactly; weaken the claim to what substrings actually prove. Relying on the existing ten is the option that looks free and is not — they assert substrings like `assert.match(r.out, /repo is live/)`, so spacing, line order and RESULT wording can all move while every one of them stays green, and the claim they are supposed to be evidence for is precisely about those things. Weakening the claim is honest but costs the property: "the single-directory path is untouched" is what lets a reviewer read this diff as additive, and a vaguer version of it cannot do that work.

**Chosen:** capture a single-directory golden before editing `cmdDoctor` and assert byte equality after, per `capture_single_directory_golden` in HOW — a scan fixture covering live, dangling and copy classifications with its live link pointing outside the repo, a pinned fixture `$HOME`, the three per-run absolute paths normalised to `<TARGET>`, `<ROOT>` and `<HOME>`, and a leak check that no absolute path survives normalisation, committed as `test/golden/doctor/single-directory.txt`. This is the pattern `test/contract-golden.test.mjs` already establishes with `test/golden/contracts/cases.json` — committed fixture, real bin spawned, exact comparison — instantiated a second time rather than reused, because that harness feeds stdin and deep-equals parsed JSON while doctor takes a filesystem fixture and emits human text. The worktree-sourced classification stays out of the golden: it needs a real linked worktree to produce, it is unchanged by this spec, and it is already covered in `test/link-skills-worktree.test.mjs`.

**Is the golden's `bin/faff` line deterministically absent, or deterministically present?**

`gates.js:547` reads that path from `$HOME`, so pinning `$HOME` is what makes the line deterministic at all — but pinning leaves a choice about what to pin it to. Options: a fixture home with no `.local/bin/faff`, so the `catch` at `gates.js:561` swallows and the line never prints; or a fixture home with a symlink there, so the line always prints as live. Absent is the smaller fixture — one directory and one symlink fewer — but it buys determinism by deleting the line from the baseline, and the baseline is meant to be the whole single-directory output. A future wording change to the `bin/faff` line would then sail past the golden untouched, which is the same gap the golden exists to close.

**Chosen:** deterministically present. The fixture home gets `.local/bin/faff` as a symlink to the same non-repo path the scan fixtures use, so the line prints `✓ bin/faff  symlink (live)` on every machine, adds nothing to `intoWorktree`, and leaves the exit code a function of the scan fixture alone. The cost is two lines of fixture setup; the return is a baseline that covers what it claims to cover. The absent variant remains a legitimate fallback if some platform makes the link fixture awkward, but it narrows the golden and should be recorded as a narrowing rather than taken because it is cheaper.

**How much does a directory that found nothing print?**

Options: one missing line per skill, uniformly; collapse to one line when a directory contributes nothing; cap at some number of lines with an "and N more". Uniform per-skill lines make the single most common report after FAFF-672 lands — a healthy `~/.claude/skills` beside an absent `~/.agents/skills` — thirty lines that all say the same thing, burying the RESULT line under them. A numeric cap is an arbitrary constant that behaves differently as the skill count drifts.

**Chosen:** collapse to one line when a directory found no faff skills at all, stating the reason (absent, unreadable with its message, or present but empty) and the count from the union. A directory missing only a subset gets one line per missing skill, uncapped, because a subset-missing state is a partial install failure where exactly which skills are affected is the useful fact. The rule keys on a property of the directory, not on a line count.

**Is a half-install one verdict or per-directory verdicts, and how does that preserve the exit-code contract?**

Options: a new exit code for half-installs; per-directory verdicts; fold into exit 1. A new code needs the gateway's doctor-at-entry prose changed and does nothing at all on any caller not updated. Per-directory verdicts have no consumer — doctor is one process returning one status to a preamble that branches on 0 / 1 / 2.

**Chosen:** one RESULT line and one exit code per invocation, with the per-directory detail in the sections. A half-install is exit 1 with the existing Fix line, because it is exactly what exit 1 already means — a repairable install that is not clean — and the gateway then does the right thing for free: interactive offers `faff sync`, autonomous logs and continues without mutating `$HOME`. Exit 2 is reserved for "no faff skills in any scanned directory" and is no longer reachable from a single unreadable directory, which is what stops the upgrade population going silent.

**What changes in the gateway's doctor-at-entry prose, and in the CLI guide?**

Options: leave both, since the exit codes are unchanged; update the glosses and the guide row; make the offer branch on which class of problem fired. Leaving them means the documented meaning of exit 1 ("one or more COPY installs") is narrower than the truth, the interactive offer says something false on a half-installed machine — nothing there is stale and everything present is a symlink — and the user-facing guide still describes install health as a single-target check. Branching the offer requires the gateway to parse doctor's stdout to learn which class fired; it reads only the exit code today.

**Chosen:** update the exit-2 and exit-1 glosses at `plugin/skills/faff/SKILL.md:91-92` to the full set of causes, generalise the interactive offer at line 93 into one line true of every exit-1 cause while still naming the consequence rather than the mechanism, and update the `doctor` row in `docs/guide/cli.md` (line 22 today) to say doctor scans the installer's global target directories by default and that `--target` pins it to one. The gateway keeps reading only the exit code. Line 94's autonomous branch is unchanged and already correct.

**Where do the new tests live, and what stops their environment leaking?**

Options: all in `test/doctor.test.mjs`; all in `test/link-skills-worktree.test.mjs`; split by what each needs. Both files leak environment into their children — `doctor.test.mjs`'s `run` (19-22) passes no `env` at all, and `link-skills-worktree.test.mjs`'s helpers spread `process.env` and override only `HOME` (lines 62 and 68) — so `$CLAUDE_PLUGIN_ROOT` survives into the child from the ambient environment either way, and step 2 of `resolve_doctor_scan_set` then short-circuits before the home-directory branch is ever evaluated. That variable is live in this repo's world, not hypothetical: `test/setup-worktree-direct.test.mjs:47` and `test/setup-worktree-clobber.test.mjs:55` both set it deliberately for their own children, nothing anywhere deletes it, and any agent session running faff as an installed plugin has it set in the parent environment that runs the suite. So the fix is needed in *both* files, not only in the one where most new tests land — which is what decides where the environment DONE items point. What decides the placement question itself is that `link-skills-worktree.test.mjs` exists to build a real main checkout plus a linked worktree, which pure doctor tests do not need and would pay for, and that FAFF-672 is editing that file in the same release.

**Chosen:** split, with matching environment hygiene in both files. The pure doctor tests go in `test/doctor.test.mjs` behind a new sibling helper — `run` keeps its variadic signature so its eleven existing call sites (ten doctor invocations and one `hooks-ensure`) are untouched, and a `runEnv(env, ...args)` beside it passes an explicit environment. The installer-and-doctor agreement test goes in `test/link-skills-worktree.test.mjs`, because it needs the real installer and a real checkout, and it gets its own sibling of the existing `doctor(target, root, home)` helper: one that passes no `--target` at all, since the existing helper hardcodes the flag and so can never reach the default path. Both new helpers build their child environment the same way — copy `process.env`, `delete` `CLAUDE_PLUGIN_ROOT`, set `HOME` to the fixture. `delete`, not assigning `undefined`, because whether a spawn drops an `undefined` env value is a Node version detail this must not depend on. The existing helpers in both files are left alone, since every current caller pins `--target` and is unaffected. The agreement test is appended rather than editing an existing test, which keeps the collision with FAFF-672 to a merge of adjacent additions.

**What does this leave intact for FAFF-675?**

FAFF-675 covers the `$CLAUDE_PLUGIN_ROOT` short-circuit — the same machine reporting differently depending on which harness invoked doctor. This change edits the same resolution function, so the boundary needs stating rather than implying.

**Chosen:** steps 1 and 2 of `resolve_doctor_scan_set` keep today's behaviour exactly — `--target` wins outright, `$CLAUDE_PLUGIN_ROOT` yields the plugin's skills directory and nothing else, and a plugin machine never reports a half-install. The only change is that they return a one-element list instead of a scalar, which makes FAFF-675's eventual fix — widening the plugin case to include the home defaults, or deleting the branch — a change to one `RETURN`, since every consumer downstream already handles any number of directories.

**Does codex actually read `~/.agents/skills`?**

Doctor's missing lines will name `~/.agents/skills` as the directory codex needs, and the repair they point at creates it. If that directory is not what codex scans, this change is precise and loud about the wrong thing — every machine gets pointed at a repair that fixes nothing observable.

When the spec was first written this rested on a standards document, not on anyone having watched codex load a skill: `docs/reference/architecture/harness-coupling.md:22` named `~/.agents/skills/` and cited the Agent Skills open standard, and `docs/reference/architecture/codex-cli-observed.md` recorded nothing about skill discovery. **That gap is now closed (refresh 2026-08-04).** That file gained a **Skill loading** section under FAFF-665 (`7f9513c`, PR #501): the exact probe below was run against codex-cli 0.145.0 — two skills planted one per candidate directory, described only by a nonsense trigger word, prompted with that word alone and the names withheld — and codex named both unprompted from pre-loaded metadata. It reads `~/.agents/skills/` (and `~/.codex/skills/`). The directory doctor names is the one codex reads.

This was never a `**Punt:**`, and the distinction is worth being explicit about, because a punt would park this ticket for a human. A punt is an unresolved choice — two defensible options where someone has to pick. This was a fact about the world with one right answer and a cheap, deterministic procedure that settled it, and the repo already had the place to write the answer down. Parking a ticket for a probe a build agent can run itself would have been the wrong trade. What was genuinely missing in the first draft was not a punt marker but an acceptance criterion, which the DONE section carries — and which the recorded observation now satisfies by the cite-by-version route.

**Assumes:** codex-cli auto-loads skills from `~/.agents/skills/` without configuration. **Discharged (refresh 2026-08-04)** by the version-stamped observation in `docs/reference/architecture/codex-cli-observed.md` — that file exists to be cited as a repo path when a document needs a codex-side source, and doctor's finding text is exactly such a document. A build on a codex version newer than 0.145.0 should confirm the observation still holds for its version.

**Has FAFF-672 landed the shape this consumes?**

Everything here rests on the installer having shipped an ordered two-entry global target list, de-duplicated by resolved path, with `--replace` proven name-scoped.

**Assumes:** FAFF-672 has landed, with `~/.claude/skills` then `~/.agents/skills` as the global target list and a passing test showing a non-faff entry surviving `--replace`. **Discharged (refresh 2026-08-04):** it has landed. The installer builds `TARGET_DIRS=("${HOME}/.claude/skills" "${HOME}/.agents/skills")` then `dedupe_by_resolved_path` — the two paths, in this order, a fixed absolute-path list under `$HOME`, which is `reconcile_with_landed_installer` step 2 (mirror as-is, proceed). The `--replace` name-scoping test passes. Both of that procedure's stop conditions were evaluated and neither fired; they remain DONE items so the build records having re-checked them against the tree it builds on.

## 7. Open questions and assumptions

### Open questions

None. Every decision in this spec is closed. The one open question in this area — whether the install target list should be hardcoded or configuration-driven — belongs to FAFF-672, which owns the list; this ticket consumes whatever that question resolves to, and `reconcile_with_landed_installer` in HOW is the rule for what the builder does if it resolved differently than assumed.

### Assumptions

- **Assumes:** codex-cli auto-loads skills from `~/.agents/skills/` without configuration. **Discharged (refresh 2026-08-04) by the cite-by-version route.** No codex binary was present in the refresh environment, so no fresh probe was run — but the clause below anticipated that: "if that file has by then gained a skill-discovery observation from another ticket, cite it by version instead of re-running the probe." It has. `docs/reference/architecture/codex-cli-observed.md`'s **Skill loading** section (FAFF-665, `7f9513c`, PR #501) records the exact probe — a `SKILL.md` described only by the nonsense word `plugh`, prompted with `plugh` alone, names withheld — and codex named the planted skills unprompted, confirming it reads `~/.agents/skills/`. Version-stamped codex-cli 0.145.0. *The original build-time procedure, retained for a build on a newer codex:* create a directory under `~/.agents/skills/` containing a `SKILL.md` whose description is a single nonsense trigger word and nothing else, start codex, and prompt it with only that word; it must name the skill unprompted; do not validate by telling the model the skill exists. If it fails on the build's codex version, stop: doctor's missing lines and the repair they point at both name the wrong directory, and the list needs re-pointing in the installer first.

- **Assumes:** FAFF-672 has landed with a two-entry ordered global target list — `~/.claude/skills` then `~/.agents/skills` — de-duplicated by resolved path, and with a passing test proving `--replace` leaves non-faff entries alone. **Discharged (refresh 2026-08-04):** the landed `scripts/link-skills.sh` builds exactly that list — `TARGET_DIRS=("${HOME}/.claude/skills" "${HOME}/.agents/skills")` then `dedupe_by_resolved_path` — a fixed absolute-path list under `$HOME` in this order, which is `reconcile_with_landed_installer` step 2: mirror as-is and proceed. The `--replace` name-scoping test passes (`test/link-skills-worktree.test.mjs`, the "`--global --replace` … leaves a non-faff entry beside it untouched" case, 11/11). Steps 3 and 4 were evaluated and neither stop condition fired. *For the build:* re-read the block against the tree you build on and re-run that test before editing `cmdDoctor`, so the reconcile DONE items record a check rather than inherit this one.

## 8. DONE — definition of done

### From WHY

- [ ] On a machine with every faff skill healthy in `~/.claude/skills` and no `~/.agents/skills`, `faff doctor` with no `--target` and no `$CLAUDE_PLUGIN_ROOT` exits 1, names `~/.agents/skills`, and reports the skills as missing from it.
- [ ] A fully-installed machine — every skill a live symlink into the repo in both directories — still exits 0.
- [ ] A machine with no faff skills in any scanned directory still exits 2, and the message names every directory tried.
- [ ] `faff doctor` performs no filesystem write on any code path.
- [ ] Each of the three guarantees named in the second design principle has a criterion below that fails when it is false: the agreement test, the single-directory golden, and the recorded codex probe.

### From WHAT (scan set and records)

- [ ] `resolve_doctor_scan_set` returns a list in all three branches: one entry for `--target`, one for `$CLAUDE_PLUGIN_ROOT`, one or two for the home-directory default.
- [ ] The home-directory default is de-duplicated by resolved path using `fs.realpathSync`, with a path that does not exist resolving to itself rather than throwing.
- [ ] `DOCTOR_SPEC` at `gates.js:38` is unchanged, and `--target` remains `arity: 1`.
- [ ] Step 3 of `resolve_doctor_scan_set` is the only place in `gates.js` naming `.claude` or `.agents` as a skills directory.
- [ ] Per-skill classification (live, worktree-sourced, dangling, copy) at `gates.js:523-546` is unchanged in logic.

### From HOW (the scan)

- [ ] Neither an unreadable directory nor a directory holding no faff skills causes an early return; both are recorded and the scan continues to the next directory.
- [ ] Exit 2 is returned only after every directory in the scan set has been scanned and the union of faff skill names across all of them is empty.
- [ ] For each scanned directory, the missing-here set is the union of names found anywhere minus the names found in that directory, computed for every directory rather than against the first one.
- [ ] The `bin/faff` check and the merge-fence PreToolUse check each run exactly once per invocation, independent of the number of directories scanned, and both still fold into the same exit code.

### From HOW (the report)

- [ ] A one-directory scan set produces output identical to before this change — header, per-skill line format and indentation, RESULT wording, Fix wording.
- [ ] `test/golden/doctor/single-directory.txt` is committed, captured from doctor **before** `cmdDoctor` was edited, against a scan fixture holding a live symlink to a non-repo path, a dangling symlink and a copy, plus a fixture home whose `.local/bin/faff` is a symlink to that same non-repo path — with the scan directory, the `--root` and the fixture home normalised to the literal placeholders `<TARGET>`, `<ROOT>` and `<HOME>`.
- [ ] Both the capture and the verifying run pass a child environment with `HOME` set to the fixture home and `CLAUDE_PLUGIN_ROOT` deleted, so the `bin/faff` line at `gates.js:547-561` is the same on every machine and cannot move the exit code via the `intoWorktree` count.
- [ ] No symlink in either golden fixture resolves into the repo checkout, so `classifyGlobalLink` cannot return `intoWorktree` for any of them whether the suite is run from the main checkout or from a linked worktree.
- [ ] The committed golden contains no absolute filesystem path outside the three placeholders — the leak check that catches a per-run value nobody pinned.
- [ ] A test rebuilds both fixtures after the change, runs doctor with `--target` against the scan fixture under the same pinned environment, applies the same normalisation, and asserts **byte equality** with the committed golden plus equality of the exit code — an exact comparison, not a substring match.
- [ ] The ten existing `--target` tests at `test/doctor.test.mjs:41-155` pass unmodified alongside the golden test.
- [ ] A multi-directory scan set prints one section per scanned directory in scan-set order, including directories that are absent or unreadable, with per-skill lines indented under their directory.
- [ ] The `bin/faff` and merge-fence lines print after the last directory section, at the same indent as the section headers.
- [ ] A directory that found no faff skills prints exactly one missing line stating the reason and the count, not one line per skill.
- [ ] A directory missing a subset of the union prints one line per missing skill naming the skill and that it is missing from that directory.
- [ ] A collapse notice prints when the default scan set de-duplicated two paths to one directory.
- [ ] The RESULT line names `<n> skill(s) missing from <directory>` once per directory with a non-empty missing-here set, alongside the existing problem classes.

### From HOW (the installer's list)

- [ ] A test in `test/link-skills-worktree.test.mjs` runs the real `scripts/link-skills.sh --global` under a faked `$HOME`, then runs the real `faff doctor` under the same faked `$HOME` with no `--target` and no `$CLAUDE_PLUGIN_ROOT`, and asserts every directory the installer created appears as a section in doctor's report and the verdict is clean.
- [ ] That test also asserts the child environment it passed contains no `CLAUDE_PLUGIN_ROOT`, and that doctor's header names directories under the faked `$HOME` rather than any plugin path — so it fails rather than silently exercising the short-circuit.
- [ ] Reconcile step 2: the landed `scripts/link-skills.sh` was read before building, and doctor's default list mirrors what it actually builds — contents and order — per `reconcile_with_landed_installer`. (Refresh 2026-08-04: mirrors `~/.claude/skills` then `~/.agents/skills`; re-confirm against the build tree.)
- [ ] Reconcile step 3: the landed `scripts/link-skills.sh` was confirmed to build a fixed list of absolute paths under `$HOME`. If it instead derives the list from configuration, or from anything doctor cannot evaluate from the filesystem alone, the build stopped and escalated rather than hardcoding directories in doctor — no code was written past that branch. (Refresh 2026-08-04: confirmed a fixed `$HOME`-relative list, not configuration-driven.)
- [ ] Reconcile step 4: FAFF-672's test proving `--replace` leaves a non-faff entry in the destination untouched was located and run before `cmdDoctor` was edited, and passed. If it is absent or failing, the build stopped and escalated — this ticket is what points the upgrade population at that removal path, so it does not ship ahead of the proof. (Refresh 2026-08-04: located and passing, 11/11; re-run against the build tree.)

### From HOW (edge cases)

- [ ] `--target DIR` scans exactly that directory and reports no missing-here finding.
- [ ] Both default directories absent → exit 2 with both named.
- [ ] A skill present only in `~/.agents/skills` produces a missing line against `~/.claude/skills`.
- [ ] A skill healthy in one directory and a copy in another reports the copy under its own directory and no missing line for that name.
- [ ] One default directory symlinked to the other → one directory scanned, collapse notice printed, no missing-here finding, single-directory layout.
- [ ] A directory unreadable for a reason other than absence reports that reason and contributes its whole union to missing-here.

### From HOW (gateway prose and the guide)

- [ ] `plugin/skills/faff/SKILL.md:91` describes exit 2 as no faff skills found in any scanned directory, with "unreadable" removed as a route to it.
- [ ] `plugin/skills/faff/SKILL.md:92` describes exit 1 as covering copies, dangling links, worktree-sourced links, skills missing from a scanned directory, and a missing merge fence.
- [ ] `plugin/skills/faff/SKILL.md:93`'s interactive offer text is true of every exit-1 cause, including a half-install where nothing is stale.
- [ ] `plugin/skills/faff/SKILL.md:94`'s autonomous branch is unchanged, and no new exit code is introduced anywhere.
- [ ] After this change, the `doctor` row in `docs/guide/cli.md` — line 22 in today's tree — states that doctor scans the installer's global target directories by default and that `--target` pins it to exactly one. The criterion is the end state of that row, whatever wording FAFF-672 may have left there.

### From the assumptions

- [x] The codex skill-discovery assumption is discharged before `cmdDoctor` is edited: either the probe in *Assumptions* was run against the codex version on the build machine and its result written into `docs/reference/architecture/codex-cli-observed.md` with that version and date, or an existing dated skill-discovery observation in that file is cited by version. **Discharged at refresh by citing the existing observation** — `docs/reference/architecture/codex-cli-observed.md`'s **Skill loading** section (FAFF-665, `7f9513c`) records the probe against codex-cli 0.145.0. A build on a newer codex version re-runs the probe for that version.
- [ ] The FAFF-672 landed-shape assumption is discharged by the three reconcile items above, all three recorded as evaluated rather than assumed. (Refresh 2026-08-04: all three evaluated and passing at refresh; re-confirm against the build tree.)

### From OUT OF SCOPE

- [ ] No `--json` flag is added to doctor, and `DOCTOR_SPEC` gains no flags.
- [ ] `cmdSync` is unchanged, and the Fix line doctor prints is the existing text.
- [ ] `scripts/link-skills.sh` is not modified by this change.
- [ ] A bug ticket is filed for the wrong usage string at `gates.js:505`, which names `--target live|intoWorktree` where the flag takes a directory, and that line is not changed by this ticket.

### Tests

- [ ] `test/doctor.test.mjs`'s existing `run` helper keeps its variadic signature, and its eleven existing call sites — ten doctor invocations and one `hooks-ensure` — are unmodified and passing.
- [ ] A `runEnv(env, ...args)` helper exists in `test/doctor.test.mjs`, and every test in that file that reaches the default scan set **or** asserts doctor's output byte-exactly uses it, with `HOME` set to the fixture home and `CLAUDE_PLUGIN_ROOT` removed by `delete` rather than set to `undefined`. The golden test is in the second group: it always passes `--target` and so never reaches the default scan set, and it still needs the pinned `HOME` because `gates.js:547` reads it.
- [ ] `test/link-skills-worktree.test.mjs` gains a sibling of its existing `doctor` helper (66-70) that passes **no** `--target`, building its child environment the same way — copy `process.env`, `delete` `CLAUDE_PLUGIN_ROOT`, set `HOME` to the fixture — and the installer-and-doctor agreement test uses that sibling rather than the existing helper, which hardcodes `--target` and can never reach the default path.
- [ ] No test in either file reaches the default scan-set path through a helper that spreads `process.env` without deleting `CLAUDE_PLUGIN_ROOT`.
- [ ] A test asserts the half-install case: one directory populated with faff-owned skill names, the other absent → exit 1 with a missing line naming the absent directory.
- [ ] A test asserts both directories healthy → exit 0 with a section for each.
- [ ] A test asserts both directories absent → exit 2 with both named.
- [ ] A test asserts the subset case: one skill missing from the second directory → exit 1 naming exactly that skill, and no problem reported against the first directory.
- [ ] A test asserts the collapse case: the second directory symlinked to the first → one directory reported, exit 0, no missing-here finding.
- [ ] A test asserts `--target DIR` output is unchanged against the committed golden, under the pinned fixture home, and carries no missing-here finding.
- [ ] Every fixture uses a faff-owned skill name (`faff`, `faff-*`, `faffter-*`, `faffidavit-*` — the existing doctor tests use `faff-graft`), because `isFaffSkill` at `gates.js:513` filters everything else out. A fixture named `demo-skill` is invisible to doctor and any assertion against it would never fire.
- [ ] `test/sync.test.mjs` and the existing tests in `test/link-skills-worktree.test.mjs` pass unmodified.

### Integration smoke test

```
1. Build a main checkout containing plugin/skills/faff and plugin/skills/faff-graft,
   under a faked $HOME.
2. Run: bash scripts/link-skills.sh --global    (env HOME=<fake home>)
3. Run: node <CLI> doctor --root <pre-fenced root>
   (env HOME=<fake home>, CLAUDE_PLUGIN_ROOT deleted, no --target — without BOTH of
   those the scan set is not the default and nothing below proves anything.)
4. Assert: the child env carried no CLAUDE_PLUGIN_ROOT; exit 0; and the output contains
   a section for <home>/.claude/skills and one for <home>/.agents/skills, no missing lines.
5. Remove <home>/.agents/skills entirely. Re-run step 3.
6. Assert: exit 1, the output names <home>/.agents/skills, reports the faff-owned skills
   as missing from it, and prints the link-skills.sh Fix line.
```

If steps 4 and 6 both hold, doctor and the installer agree about which directories exist and the half-install detector fires on the state every upgrading machine will be in.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"}]}
```