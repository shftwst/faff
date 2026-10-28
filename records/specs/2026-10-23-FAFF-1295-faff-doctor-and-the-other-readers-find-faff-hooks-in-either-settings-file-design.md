# FAFF-1295: faff doctor and the other readers find faff hooks in either settings file

> Spec: faffter-dark-nlspec · 2026-10-23 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1295.

*Revision 4, 2026-10-23: spec-review round 2 applied (fence pseudocode, decision 3 and failure mode 1 brought in line with revision 3; partial regex test with a stated assumption; fixed error strings, no parser text). Revision 3: spec-review round 1 applied (fence present under any matcher that fires on Bash, advisories gated on an exported `HOOKS_DEFAULT_TARGET`, `hook_advisories_active` defined). Revision 2: methodology critique applied (advisory lines gated on FAFF-1297's `--shared`, so this ships alone; selftest split is fixed data; gateway exit-1 follow-up named; Codex warn-only note).*

This spec covers FAFF-1295. It makes `faff doctor` read faff's Claude Code hooks from both `.claude/settings.json` and `.claude/settings.local.json`, name an unreadable settings file instead of reporting the fence missing, and print two advisory lines: faff hooks found in `settings.json`, and any hook registered in both files. It is written for the build agent and for human reviewers. FAFF-1297, which moves `faff hooks-ensure`'s default write target to `settings.local.json`, is blocked by this ticket and relies on the reader described here.

## 1. Why

A faff hook is registered when either settings file holds it, because Claude Code merges the hooks from both files. `faff hooks-ensure` already reads presence that way (FAFF-1062, `plugin/skills/faff/bin/lib/hooks-ensure.js:298-327`). `faff doctor` does not: its fence check, `mergeFencePresentAt` (`plugin/skills/faff/bin/lib/gates.js:1985-1990`), reads only `settings.json`. This ticket gives doctor the same two-file rule, using the same presence predicates `hooks-ensure` uses, so the two commands can never disagree about whether a hook is there.

**Problem.** Once FAFF-1297 writes the hooks to `settings.local.json`, doctor would report "merge-fence PreToolUse fence MISSING — run: faff hooks-ensure" on every fresh install, and `hooks-ensure` would answer that the hooks are already present. Doctor also hides a malformed settings file today: invalid JSON is reported as a missing fence (`gates.js:1983-1988`), and the prescribed `faff hooks-ensure` then exits 2 on that same file (`hooks-ensure.js:298-301`). After this change doctor finds the hooks in either file, names an unreadable file as its own finding, and tells the operator about faff hooks left in the shared file.

**Design principles.**

**One definition of "faff's hook".** Doctor decides presence with `commandInvokesFaffHook`, `isPresent` and `isPresentInMatcher` from `hooks-ensure.js`, keyed the way `hooks-ensure` keys its `already` list. Any implementation that gives doctor its own matcher is wrong, because the point of the change is that doctor's "missing" always means `hooks-ensure` will add something.

**Doctor is read-only.** Doctor never writes, normalises or deletes anything in either settings file, faff's entries included. Entries that are not faff's are never inspected beyond the presence test.

**A settings file doctor cannot read is a named failure.** Never a crash, never silently "missing".

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/gates.js:1981-1990` | JavaScript (CommonJS) | `mergeFencePresentAt`, the reader this ticket replaces |
| `plugin/skills/faff/bin/lib/gates.js:2269-2335` | JavaScript | `gatherDoctorState`: computes every axis and the exit code once |
| `plugin/skills/faff/bin/lib/gates.js:2337-2449` | JavaScript | `renderHuman` and `buildDoctorJson`: the two renderers |
| `plugin/skills/faff/bin/lib/hooks-ensure.js:36-128` | JavaScript | Hook sets and presence predicates doctor reuses |
| `test/doctor.test.mjs:51-98, 190-242` | Node test | Fence fixtures and the present / missing / malformed cases |
| `test/link-skills-worktree.test.mjs:116-122, 701-746` | Node test | A fence fixture and the `DoctorJson` totality test |
| `test/golden/doctor/single-directory.txt`, `stale-emit.txt` | Text | Byte-exact doctor goldens that print the fence line |

**Scope.** This ticket changes one reader in `faff doctor` (Claude Code only), adds one pure helper to `hooks-ensure.js`, and updates doctor's tests and one docs row; the writer belongs to FAFF-1297.

## Already shipped against this surface

| Ticket | State | What it shipped that this spec builds on |
|---|---|---|
| FAFF-192 | Done | `faff hooks-ensure`, the idempotent Stop-hook registrar |
| FAFF-434 | Done | The `merge-fence` PreToolUse fence and doctor's fence axis (`mergeFencePresentAt`) |
| FAFF-530 | Done | Matcher-scoped PreToolUse presence (`isPresentInMatcher`, keys `"<matcher>::<sub>"`) |
| FAFF-675 | Done | `gatherDoctorState` computing exit once, and the `DoctorJson` totality test |
| FAFF-1062 | Done | `hooks-ensure --local`, and presence read from both settings files in `hooks-ensure` |

## Every reader of faff's hooks

A grep of `plugin/`, `scripts/` and `verification/` for `settings.json`, `settings.local.json`, `hooks.Stop`, `hooks.PreToolUse`, `stopCommands` and `preToolUseCommands` (at `a19233aa`) finds these:

| Reader | What it does today | Change |
|---|---|---|
| `faff doctor`, `mergeFencePresentAt` (`gates.js:1985`) | Reads `settings.json` only; malformed is "missing" | Changes (this spec) |
| `faff hooks-ensure`, `cmdHooksEnsure` (`hooks-ensure.js:291-327`) | Reads both files for presence; malformed either file exits 2 | None. It already meets all four acceptance points; FAFF-1297 changes its write target |
| `setup-worktree.sh:127` | Copies an untracked `settings.local.json` into new worktrees | None. It copies the file and never reads hooks |
| `merge-fence.js:3`, `scaffold-*.sh`, `eval/cli-driver.mjs:16` | Comments, or a hand-written non-faff Stop hook in a scaffold | None. Not readers |

No skill prose reads hooks; the prose that names `settings.json` as the write target is FAFF-1297's.

## 2. Out of scope

- **Changing the write target of `faff hooks-ensure`.** Why excluded: FAFF-1297, which this ticket unblocks. Extension point: `cmdHooksEnsure` in `hooks-ensure.js` (FAFF-1297's `hookSettingsTargets`).
- **Moving or deleting faff entries in `settings.json`.** Why excluded: doctor is read-only, and FAFF-1297 decided leftovers stay until the operator removes them by hand. Extension point: a `--migrate` flag on `cmdHooksEnsure`.
- **Codex hooks (`.codex/hooks.json`, `config.toml` `[hooks]`).** Why excluded: FAFF-1381 defers doctor's Codex check to FAFF-1387. Extension point: `hookSettingsAt` in `gates.js`, given a harness argument. An unreadable `.codex/hooks.json` must only warn, as FAFF-1387 requires; it never reuses this ticket's exit-1 invalid-file path.
- **A config key that records a team's `--shared` choice.** Why excluded: the shared-file line is advisory and never changes the exit code (decision 4), so it costs nothing to leave on. Extension point: a key read through `faff config get` in `gatherDoctorState`, next to `hookSettingsAt`.
- **Doctor checking the Stop hooks or `background-fence` for absence.** Why excluded: the ticket keeps doctor's one required hook, `merge-fence`; adding others would change exit codes for existing installs. Extension point: the `fence_status` computation in `hookSettingsAt`.
- **The doctor-at-entry offer's wording for a fence or settings finding.** Why excluded: kernel's exit-1 branch treats every doctor exit 1 as a stale install and offers `faff sync`, which repairs neither a missing fence (older than this ticket) nor an unreadable settings file (new here). Follow-up ticket to be filed: doctor-at-entry routes a settings or fence finding to its own remedy. Extension point: `plugin/skills/faff/references/kernel.md:23-26`.
- **Refactoring `cmdHooksEnsure` onto the new helper.** Why excluded: FAFF-1297 rewrites that function; touching it here makes a merge conflict for no behaviour change. Extension point: FAFF-1297 may call `faffHookKeysIn` when computing `present_elsewhere`.

## 3. What

**Vocabulary.**

| Term | Meaning |
|---|---|
| Shared file | `.claude/settings.json`, which a team may commit or manage centrally |
| Personal file | `.claude/settings.local.json`, per checkout and normally ignored by git |
| Hook key | A faff hook's identity: the bare name for a Stop hook (`"runcheck"`) and `"<matcher>::<sub>"` for a PreToolUse hook (`"Bash::merge-fence"`). The same format as `hooks-ensure`'s `already` list and FAFF-1297's `present_elsewhere` |
| Invalid file | A settings file that exists but cannot be read, is not JSON, or whose top-level value is not a JSON object |

**New pure helper in `hooks-ensure.js` (exported).**

```
FUNCTION faffHookKeysIn(settings) -> List<HookKey>:
  keys = []
  FOR sub IN FAFF_STOP_HOOKS (in order):
    IF isPresent(sub, settings): append sub
  FOR { matcher, subs } IN FAFF_PRE_TOOL_USE_MATCHER_GROUPS (in order):
    FOR sub IN subs:
      IF isPresentInMatcher(sub, settings, matcher): append matcher + "::" + sub
  RETURN keys
```

It takes a parsed object, does no I/O, and tolerates shape drift exactly as `stopCommands` and `preToolUseCommandsForMatcher` do (an absent or non-array `hooks.Stop` yields no keys).

**Doctor's reader in `gates.js` (replaces the body of `mergeFencePresentAt`).**

```
ENUM SettingsFileState: absent | ok | invalid
ENUM FenceStatus: present | missing | unconfirmed

RECORD HookSettingsFile:
  path: Path                 # absolute
  scope: "shared" | "personal"
  state: SettingsFileState
  error: String | null       # a fixed description when state = invalid ("not valid JSON", "cannot read file (<code>)", "top-level value is not a JSON object"), never input text; else null
  covers_bash_fence: Boolean # internal; fenceCoversBash over this file, not in JSON output
  faff_hooks: List<HookKey>  # faffHookKeysIn(parsed); [] unless state = ok

RECORD HookSettingsReport:
  shared: HookSettingsFile
  personal: HookSettingsFile
  in_both: List<HookKey>     # keys in shared.faff_hooks AND personal.faff_hooks, shared order
  fence_status: FenceStatus

FUNCTION hookSettingsAt(root) -> HookSettingsReport     # exported, never throws
FUNCTION mergeFencePresentAt(root) -> Boolean           # kept and exported:
  RETURN hookSettingsAt(root).fence_status == present
```

**`DoctorState` gains three keys:** `hookSettings` (the report), `fenceStatus`, and `hookAdvisoriesActive` (Boolean: `HOOKS_DEFAULT_TARGET === "personal"`, below). `fenceOk` stays and equals `fenceStatus == present`.

**`hooks-ensure.js` exports `HOOKS_DEFAULT_TARGET`**, a string naming the file a default run writes: `"shared"` on today's `main`. FAFF-1297, which moves the default, sets it to `"personal"` in the same change. It is a declared capability, not a parsed flag table, so renaming a flag cannot change doctor's output.

**`faff doctor --json` gains three fields**, in both the populated and the empty-union branches of `buildDoctorJson`:

```
RECORD DoctorJsonAdditions:
  merge_fence_status: "present" | "missing" | "unconfirmed"
  hook_advisories_active: Boolean     # mirrors hookAdvisoriesActive; the two ⚠ lines print only when true
  hook_settings: {
    shared:   { path, state, error, faff_hooks },
    personal: { path, state, error, faff_hooks },
    in_both:  List<HookKey>
  }
  # existing merge_fence: Boolean keeps its name; its value is now merge_fence_status == "present"
```

**Human output.** The fence line keeps its two existing texts and gains a third. New lines follow it, in this order:

| Condition | Line (paths relative to `--root`) | Counts toward exit 1 |
|---|---|---|
| `fence_status = present` | `  ✓ merge-fence PreToolUse fence present` (unchanged) | No |
| `fence_status = missing` | `  ✗ merge-fence PreToolUse fence MISSING — run: faff hooks-ensure` (unchanged) | Yes (unchanged) |
| `fence_status = unconfirmed` | `  ✗ merge-fence PreToolUse fence unconfirmed: a settings file is unreadable (below)` | Yes |
| Each invalid file | `  ✗ .claude/<file>  invalid (<error>); fix or remove it, faff cannot read hooks from it` | Yes |
| `shared.faff_hooks` non-empty | `  ⚠ faff hooks in .claude/settings.json (a file teams often commit): <keys>; expected only if this team runs faff hooks-ensure --shared, otherwise remove them by hand` | No |
| `in_both` non-empty | `  ⚠ faff hooks registered in both settings files: <keys>; remove the copy in .claude/settings.json unless this team runs faff hooks-ensure --shared` | No |

`<keys>` is the key list joined with `, `. The `RESULT:` line names an unconfirmed fence as `merge-fence PreToolUse fence unconfirmed` (a missing one keeps `merge-fence PreToolUse fence missing`) and adds `<n> unreadable Claude settings file(s)` when any file is invalid, and the `Fix:` line adds `fix the JSON in <relative path>` per invalid file. While any file is invalid, `Fix:` does not add `faff hooks-ensure`, because `hooks-ensure` exits 2 on the same file.

## 4. How

### Reading the two files

`hookSettingsAt` reads each file on its own, so one bad file never hides the other's hooks.

```
PROCEDURE readHookSettingsFile(absPath, scope) -> HookSettingsFile:
  1. IF the path does not exist: RETURN { state: absent, error: null, faff_hooks: [] }
  2. TRY text = read file as UTF-8
     ON error e: RETURN { state: invalid, error: "cannot read file (" + e.code + ")", faff_hooks: [], covers_bash_fence: false }
  3. TRY parsed = JSON.parse(text)                 # an empty file fails here
     ON error: RETURN { state: invalid, error: "not valid JSON", faff_hooks: [], covers_bash_fence: false }
  4. IF parsed is null, an array, or not an object:
       RETURN { state: invalid, error: "top-level value is not a JSON object", faff_hooks: [], covers_bash_fence: false }
  5. RETURN { state: ok, error: null, faff_hooks: faffHookKeysIn(parsed), covers_bash_fence: fenceCoversBash(parsed) }

`error` is always one of these fixed strings (with only an fs error code such as `EACCES` interpolated), never the parser's message: V8's `JSON.parse` messages quote part of the input, and settings files carry credentials in their `env` blocks.

PROCEDURE hookSettingsAt(root):
  1. shared   = readHookSettingsFile(root/.claude/settings.json, "shared")
  2. personal = readHookSettingsFile(root/.claude/settings.local.json, "personal")
  3. in_both  = shared.faff_hooks filtered to members of personal.faff_hooks
  4. IF shared.covers_bash_fence OR personal.covers_bash_fence:      # fenceCoversBash, below
       fence_status = present
     ELSE IF shared.state = invalid OR personal.state = invalid:
       fence_status = unconfirmed
     ELSE:
       fence_status = missing
  5. RETURN { shared, personal, in_both, fence_status }
```

A fence found in one readable file is `present` even when the other file is invalid; the invalid file is still its own ✗ line and still makes the exit 1.

### Folding into doctor's single exit

`gatherDoctorState` calls `hookSettingsAt(root)` once, where it calls `mergeFencePresentAt` today (`gates.js:2315`), and adds one disjunct to the exit expression at `gates.js:2328`:

```
anyInvalidSettings = hookSettings.shared.state = invalid OR hookSettings.personal.state = invalid
exit = emptyUnion ? 2 : ((existing disjuncts) OR !fenceOk OR anyInvalidSettings) ? 1 : 0
```

The two advisory conditions (`shared.faff_hooks`, `in_both`) never enter the exit expression. Both renderers read the state; neither recomputes it (the FAFF-675 rule).

**Chosen:** the two advisory lines print only when `hooks-ensure` declares that its default write target is the personal file: `gatherDoctorState` sets `hookAdvisoriesActive` from `HOOKS_DEFAULT_TARGET === "personal"`. This ticket adds the constant as `"shared"`; FAFF-1297 flips it. Before FAFF-1297 the lines stay silent and `hook_advisories_active` is `false`. The gate is permanent, not a shim: it keeps doctor's advice tied to where a default run actually writes, which is the fact the advice depends on. This lets FAFF-1295 ship alone: a release without FAFF-1297 never tells an operator to remove entries that the next run writes back, and never names a `--shared` flag that does not exist yet. The reader half (both files, invalid-file finding, Bash-scoped fence) does not depend on FAFF-1297 at all.

**Chosen:** doctor counts `merge-fence` present when it sits under a matcher that would fire on the Bash tool: exactly `"Bash"`, an empty or `"*"` matcher, or a matcher that, compiled as a regex, matches the string `Bash` anywhere (`new RegExp(m).test("Bash")`; for example `"Bash|Monitor"`, `".*"` or `"^Ba"`). A matcher that is not a valid regex counts only on an exact `"Bash"`. The partial test is the generous reading: if Claude Code applies a stricter match, doctor may call a fence present that does not fire, which costs only the local echo of a floor that branch protection and `governance-check` enforce; the opposite error would tell an operator to fix a working install. A fence under `"Monitor"` or `"Write"` alone never sees a Bash command and stays missing. `faffHookKeysIn` keeps reporting exact keys (`"Bash::merge-fence"`); the broader test is a separate predicate, `fenceCoversBash(settings)`, used only for `fence_status`, so a working hand-registered fence is never reported missing. `hooks-ensure` still checks presence by exact matcher, so on such an install it adds a `Bash` entry: a harmless duplicate that doctor reports in neither ⚠ line. Aligning `hooks-ensure` with this predicate is out of scope (extension point: `isPresentInMatcher`).

**Chosen:** the helper lives in `hooks-ensure.js` and `gates.js` imports it. `gates.js:41` already requires `hooks-ensure.js`, and `hooks-ensure.js` requires only `shared-infra` and `argv` (`hooks-ensure.js:12-16, 277`), so no require cycle is possible.

**Anti-pattern:** a new regex or string match for faff commands in `gates.js`. Why: two matchers drift, and the ticket exists because doctor and `hooks-ensure` disagreed.

**Anti-pattern:** catching an invalid file and returning "missing", as the current comment at `gates.js:1983-1984` describes. Why: the acceptance requires malformed JSON to fail loudly, and the "missing" remedy does not work on a malformed file. Rewrite that comment and the one at `gates.js:2313`.

**Anti-pattern:** throwing out of `gatherDoctorState` on an invalid file. Why: doctor must still report every other axis in the same run (FAFF-675's compute-once rule).

### Tests and fixtures

The fence fixtures move to the personal file, which proves the first acceptance point and keeps both goldens byte-identical (their fixtures will hold no faff hooks in `settings.json`, so no advisory line prints):

- `test/doctor.test.mjs`: `mkFencedRootHere` (line 51), `mkFencedRoot` (line 62) and `writeFence` (line 78) write `.claude/settings.local.json`.
- `test/link-skills-worktree.test.mjs`: `mkFencedRoot` (line 116) writes `.claude/settings.local.json`; the totality test's `accountedFor` set (line 736) gains `"hookSettings"`, `"fenceStatus"` and `"hookAdvisoriesActive"`, with assertions that `json.merge_fence_status`, `json.hook_settings` and `json.hook_advisories_active` mirror them.
- `test/doctor.test.mjs:217-228` ("malformed settings.json … degrades to MISSING") is replaced by the invalid-file cases in DONE.
- `test/golden/doctor/*.txt` are not edited.
- `hooksEnsureSelftest` gains `faffHookKeysIn` cases: empty object, a split fixture (below), a `merge-fence` under matcher `"Write"` only, and a non-faff command.

The split fixture is fixed data inside the selftest, never read from this checkout's settings files, which are gitignored and absent in CI and other clones. Its content copies this checkout's split at `a19233aa`: `prepcheck, inflightcheck, resumecheck, sentrycheck, turncheck, Bash::merge-fence, Bash::background-fence, Monitor::background-fence` in the shared object and `runcheck` in the personal one.

### Docs

`docs/guide/cli.md:41` (the `doctor` row) names both files, the invalid-file finding, and the two advisory lines. The comments at `gates.js:1981-1984` and `gates.js:2313` name both files.

### Failure modes

- **The failure:** FAFF-1297 moves the default without setting `HOOKS_DEFAULT_TARGET` to `"personal"`. **How you'd know:** after FAFF-1297 merges, a fixture with faff hooks in `settings.json` still prints no advisory line. **What it means:** narrow; FAFF-1297's spec carries a DONE item for the constant, so its build fails that item first.
- **The failure:** the fence check now reads matchers, so an install whose only `merge-fence` sits under a non-Bash matcher (for example `"Monitor"`) flips from present to missing. **How you'd know:** doctor reports MISSING on that install. **What it means:** proceed. That fence never fires on Bash commands; `hooks-ensure` adds a working one, and doctor then reports present.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a --root whose .claude/settings.local.json holds faff's Bash merge-fence and .claude/settings.json does not exist
When `faff doctor --target <a dir with one live faff skill link> --root <root>` runs
Then it exits 0
And it prints "merge-fence PreToolUse fence present"
And it prints no line containing "⚠ faff hooks"
```

```
Given a --root whose .claude/settings.json holds faff's runcheck Stop hook and Bash merge-fence, and whose .claude/settings.local.json holds runcheck
When `faff doctor --json` runs against a clean skill scan
Then exit is 0
And hook_settings.shared.faff_hooks is ["runcheck", "Bash::merge-fence"]
And hook_settings.in_both is ["runcheck"]
And merge_fence_status is "present"
```

```
Given a --root whose .claude/settings.local.json contains "{ not valid json" and whose .claude/settings.json does not exist
When `faff doctor` runs against a clean skill scan
Then it exits 1
And it prints a line naming .claude/settings.local.json as invalid
And it prints "merge-fence PreToolUse fence unconfirmed"
And the Fix line does not contain "faff hooks-ensure"
```

- Doctor writes nothing: both settings files are byte-identical with unchanged mtimes after any `faff doctor` run.

## 6. Design decision rationale

**1. How does doctor decide a hook is faff's?**
Options: keep doctor's own unscoped check (`preToolUseCommands` plus `commandInvokesFaffHook`); reuse `hooks-ensure`'s matcher-scoped predicates through one new helper.
**Chosen:** a pure `faffHookKeysIn` in `hooks-ensure.js`, built from `isPresent` and `isPresentInMatcher`, used by doctor. One definition, the same keys FAFF-1297 reports, and no require cycle.

**2. What does "malformed JSON fails loudly" mean for doctor?**
Options: exit non-zero with a crash or usage error, as `hooks-ensure` does (exit 2); keep degrading to "missing"; a named ✗ finding that joins doctor's exit 1.
**Chosen:** a named ✗ line per invalid file, a matching `RESULT:` and `Fix:` entry, and exit 1; the fence reads "unconfirmed" unless the other file has it. Exit 2 already means "no faff skills installed" (`gates.js:2328`, kernel doctor-at-entry), so reusing it would make the gateway silently continue. Degrading to "missing" prescribes a repair that exits 2.

**3. Which hook does doctor require?**
Options: `merge-fence` under any matcher (today); `Bash::merge-fence`; every faff hook.
**Chosen:** `merge-fence` under any matcher that fires on the Bash tool (`fenceCoversBash`, as explained in How). Requiring every hook changes exit codes for existing installs and is out of scope.

**4. How is the `settings.json` warning kept quiet for teams that chose `--shared`?**
Options: a config key read through `faff config get` that suppresses it; an advisory line that never changes the exit code and names `--shared` as the expected case; a hard warning with exit 1.
**Chosen:** the advisory line. Doctor-at-entry branches on the exit code only (`plugin/skills/faff/references/kernel.md:21-26`), so an exit-0 run with the line is silent in every gateway flow and only shows when someone runs `faff doctor` by hand. A config key would add schema for one line of text; it stays the extension point if the line proves noisy.

**5. Is a hook registered in both files a failure?**
Options: exit 1; advisory.
**Chosen:** advisory. Both copies are faff's own command, the fence works, and FAFF-1297 deliberately leaves `settings.json` entries in place, so every upgraded install has some duplicates until the operator cleans up. An exit 1 would trigger the doctor-at-entry offer on all of them.

**6. Where do the fixtures put the fence?**
Options: keep `settings.json` and edit both goldens to include the new advisory line; move the fixtures to `settings.local.json`.
**Chosen:** move them. The goldens stay byte-identical, which proves the populated-root output did not move, and the fixtures then exercise the personal file the acceptance names.

**7. What happens to `mergeFencePresentAt`?**
Options: delete it; keep it as a wrapper.
**Chosen:** keep it exported as a one-line wrapper over `hookSettingsAt`. It is in `gates.js`'s export list (`gates.js:2551`), and removing an export is a separate change with no benefit here.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.**

- **Assumes:** Claude Code fires a PreToolUse hook when its matcher, compiled as a regex, matches the tool name; an exact name and `"*"` are the documented forms. Validate: register `merge-fence` under `"Bash|Monitor"` in a scratch repo and see a raw forge merge command refused. If Claude Code uses a stricter test, `fenceCoversBash` errs toward present, which the How section accepts.
- **Assumes:** Claude Code merges hooks from `.claude/settings.local.json` with those from `.claude/settings.json`. Validate: in this checkout `runcheck --hook` is registered only in `.claude/settings.local.json` and fires at session end.

## 8. Done

### From WHY
- [ ] With `merge-fence` registered under `Bash` only in `.claude/settings.local.json` and no `.claude/settings.json`, `faff doctor` (clean skill scan) exits 0 and prints `merge-fence PreToolUse fence present`.
- [ ] With `merge-fence` only in `.claude/settings.json`, `faff doctor` still prints `merge-fence PreToolUse fence present`.
- [ ] With neither file present, the output still contains `merge-fence PreToolUse fence MISSING — run: faff hooks-ensure` and the exit is 1.

### From WHAT (interfaces)
- [ ] `faffHookKeysIn` is exported from `hooks-ensure.js` and returns keys in `FAFF_STOP_HOOKS` order, then `FAFF_PRE_TOOL_USE_MATCHER_GROUPS` order; `faff hooks-ensure --selftest` passes with cases for an empty object, the repo's split shown in How, a `merge-fence` under matcher `"Write"` only (no keys), and a non-faff command (no keys).
- [ ] `hookSettingsAt` is exported from `gates.js`; `mergeFencePresentAt` is still exported and returns `fence_status == "present"`.
- [ ] `faff doctor --json` carries `merge_fence_status` and `hook_settings` (`shared`, `personal`, `in_both`) in a populated run and in an empty-union (exit 2) run.
- [ ] In `--json`, `merge_fence` equals `merge_fence_status == "present"`.
- [ ] The `DoctorJson` totality test in `test/link-skills-worktree.test.mjs` lists `hookSettings` and `fenceStatus` and asserts the two new JSON fields mirror them.

### From HOW (behaviour)
- [ ] `.claude/settings.local.json` containing `{ not valid json` (no `settings.json`) makes doctor exit 1, print a ✗ line naming `.claude/settings.local.json` as invalid, print `merge-fence PreToolUse fence unconfirmed`, and omit `faff hooks-ensure` from the `Fix:` line.
- [ ] The same with the invalid content in `.claude/settings.json` instead gives the same result naming that file.
- [ ] An empty `.claude/settings.json` and one containing `[]` each report `state: "invalid"` in `--json`.
- [ ] With `Bash::merge-fence` in one file and the other invalid, `merge_fence_status` is `"present"` and the exit is 1.
- [ ] No settings fixture (valid, invalid, absent) makes `faff doctor` exit with a stack trace or a code other than 0, 1 or 2.
- [ ] With `runcheck` and `Bash::merge-fence` in `.claude/settings.json` and `runcheck` in `.claude/settings.local.json`, a clean-scan `faff doctor` exits 0, prints a `⚠ faff hooks in .claude/settings.json` line naming `runcheck, Bash::merge-fence` and `--shared`, and prints a `⚠ faff hooks registered in both settings files` line naming `runcheck`.
- [ ] With faff hooks only in `.claude/settings.local.json`, neither `⚠` line prints.
- [ ] With `HOOKS_DEFAULT_TARGET` `"shared"` (this ticket's value), the fixture with faff hooks in both files prints neither `⚠` line, exits 0, and reports `hook_advisories_active: false` in `--json`; with it stubbed to `"personal"` it prints both and reports `true`.
- [ ] `require("./hooks-ensure").HOOKS_DEFAULT_TARGET` is `"shared"` after this ticket.
- [ ] `hooksEnsureSelftest`'s split case reads no file from disk.
- [ ] `merge-fence` registered only under matcher `"Monitor"` reports `merge_fence_status: "missing"`.
- [ ] `merge-fence` registered only under matcher `"Bash|Monitor"`, and separately only under `".*"`, reports `merge_fence_status: "present"`.
- [ ] `merge-fence` registered only under a matcher that is not a valid regex (for example `"Bash("`) reports `"missing"`, and doctor does not throw.
- [ ] A `.claude/settings.json` holding `{"env":{"API_TOKEN":"sk-test-123"` (truncated JSON) makes doctor print `not valid JSON` for that file, and neither the human nor the `--json` output contains `sk-test-123`.
- [ ] `hookSettingsAt`'s `fence_status` comes from `covers_bash_fence`, shown by the `"Bash|Monitor"` fixture reporting `"present"` through the same code path as `"Bash"`.
- [ ] After `faff doctor` runs against fixtures holding faff and non-faff entries in both files, both files are byte-identical and their mtimes unchanged.

### From HOW (docs and comments)
- [ ] `docs/guide/cli.md` `doctor` row names both `.claude/settings.json` and `.claude/settings.local.json`, the invalid-file finding, and the two advisory lines.
- [ ] `grep -n "degrades to \"missing\"" plugin/skills/faff/bin/lib/gates.js` prints nothing.

### From HOW (test floor)
- [ ] `test/doctor.test.mjs` and `test/link-skills-worktree.test.mjs` fence fixtures write `.claude/settings.local.json`, and both pass.
- [ ] `test/golden/doctor/single-directory.txt` and `test/golden/doctor/stale-emit.txt` are unchanged in the diff, and their golden tests pass.
- [ ] `test/doctor.test.mjs` covers each DONE item under "From HOW (behaviour)".

### Integration smoke test

```
PROCEDURE smoke():
  1. root = new temp dir; mkdir root/.claude
  2. write root/.claude/settings.local.json with a Bash group holding "faff merge-fence --hook"
  3. skills = new temp dir with one live faff-graft symlink
  4. `faff doctor --target skills --root root --json` -> r
     ASSERT r.exit == 0 AND r.merge_fence_status == "present"
     ASSERT r.hook_settings.personal.faff_hooks == ["Bash::merge-fence"]
     ASSERT r.hook_settings.shared.state == "absent"
  5. write root/.claude/settings.json as "{ broken"
  6. `faff doctor --target skills --root root --json` -> r2
     ASSERT r2.exit == 1 AND r2.hook_settings.shared.state == "invalid"
     ASSERT r2.merge_fence_status == "present"
```

Methodology: faffter-dark-methodology-agile-delivery

## Appendix B: spec-review responses

**Round 1 (reject-approach, 3 minor; all accepted, revision 3).**

| Objection | Response |
|---|---|
| Architectural: Bash-only scoping misreads regex matchers, so a working `"Bash|Monitor"` fence reads missing | `fenceCoversBash` counts any matcher that fires on Bash; failure mode corrected |
| Architectural: the advisory gate reads a flag table | `hooks-ensure` exports `HOOKS_DEFAULT_TARGET`; FAFF-1297 flips it |
| QA: `advisories_active` is undefined in WHAT and the totality test | Defined as `hookAdvisoriesActive` / `hook_advisories_active`, added to `accountedFor` |

**Round 2 (reject-approach, 3 minor; all accepted, revision 4).**

| Objection | Response |
|---|---|
| Architectural: `hookSettingsAt` still sets `fence_status` from the exact key | Step 4 reads `covers_bash_fence`; decision 3 and failure mode 1 updated too |
| Architectural: "fully matches" is unproven against Claude Code's matching | Partial regex test (the generous reading), with an Assumes and its validation |
| Infosec: the parser's message can echo credential fragments | `error` is a fixed string; a DONE item checks a token never appears |

## Methodology critique

FAFF-1295 (faff doctor and the other readers find faff hooks in either settings file). Backlog, High, no project, no labels. Blocks FAFF-1297 (Todo) and FAFF-1387 (Backlog, Low). Related to FAFF-192, FAFF-434 and FAFF-1381. Read against the spec dated 2026-10-23 (the copy posted on FAFF-1295 matches the scratchpad file), the FAFF-1297 spec at revision 4, the tracker on 2026-10-23 and the repo at `a19233aa`.

| Axis | Result | Findings |
|---|---|---|
| Right-sized (principle 4) | No issues | None |
| Workstream fit (principles 1 and 5) | Nothing new | None |
| Dependencies surfaced (principle 6) | Two minor, two nits | m1, m2, n1, n2 |
| Risk profile (principle 7) | One minor | m3 |
| Consistency with FAFF-1297 | Consistent | n1 only |

### Right-sized (principle 4): no issues

The build is one pure helper in `hooks-ensure.js`, one reader in `gates.js`, two `DoctorState` keys, three JSON fields, four human-output lines, and test and docs edits in four files. That fits a 1 to 3 day unit. The spec's reader inventory finds that `faff doctor` is the only reader that changes, so the title's "other readers" adds no hidden scope. The read half and the advisory half could be split; m2 covers when that is worth doing.

### Workstream fit (principles 1 and 5): nothing new

The ticket is project-less in Backlog, which is the default landing. The loose cluster is already known from the FAFF-1297 critique. FAFF-1387 has joined it since then, which does not change the recommendation.

### Dependencies surfaced (principle 6)

**m1 (minor): this ticket adds new exit-1 causes, and the gateway shows them as stale skills.**

- **What's there.** Doctor-at-entry handles every exit 1 the same way (`plugin/skills/faff/references/kernel.md:24-26`). Interactive runs see "faff skills look out of date on this machine... Re-link now?" and run `faff sync` on accept. Autonomous runs log a "stale-install finding" for `/faff-wtf`. This spec adds two new exit-1 causes: an invalid settings file, and an `unconfirmed` fence. Out of scope excludes the offer's wording as "older than this ticket". That holds for the missing fence. It does not hold for the invalid-file case, which this ticket creates. Decision 2 picks exit 1 over exit 2 so that the gateway does not "silently continue", so the gateway's handling is part of the reason for the choice. A search of Linear for "doctor-at-entry" and "faff sync" finds no ticket for the offer.
- **Why it matters.** In gateway flows, a malformed `settings.local.json` is reported to the operator as out-of-date skills, and the offered repair (`faff sync`) does not touch the file. The CLI fails loudly as the acceptance asks, but the flow most operators see shows the wrong cause. An exclusion with no ticket is outside the blocker graph, so no run picks it up.
- **Recommended action.** File a project-less Backlog ticket, related to FAFF-1295, for the kernel exit-1 branch to tell skill-link findings apart from fence and settings findings and to name the right repair for each. Cite its id in Out of scope, and change "this is older than this ticket" to say this ticket adds the invalid-file cause. Do not fix this by taking the invalid-file finding out of the exit code, because that brings back the silent failure the acceptance forbids.

**m2 (minor): the advisory half depends on FAFF-1297, but the tracker shows the dependency in one direction only.**

- **What's there.** The tracker has FAFF-1295 blocking FAFF-1297 and no edge the other way. The two `⚠` lines and the `docs/guide/cli.md` row depend on FAFF-1297 in two ways. The first is the writer move, which both specs already cover with a same-release assumption. The second is new: both lines tell the operator to use `faff hooks-ensure --shared`, and that flag does not exist until FAFF-1297. Today `faff hooks-ensure --shared` exits 2 with `unknown flag --shared`. The release is a human merge of the release-please PR (`.github/workflows/release-please.yml`), and nothing in faff checks the "both merged before the release is cut" assumption.
- **Why it matters.** Between the two merges, the advisory line on `main` names a flag that fails. If a release is cut in that window, the same line reaches installs. Because the reverse dependency appears only in prose assumptions, an unattended run treats FAFF-1295 as releasable on its own.
- **Recommended action.** Choose one of these:
  - Preferred: move the two `⚠` lines, their DoD items and the advisory part of the docs row into a small follow-up blocked by FAFF-1297. FAFF-1295 then keeps the reader, the invalid-file finding and the JSON fields, and can ship on its own. Both specs can drop the same-release assumption. FAFF-1297's decision 3 and its Out of scope would then cite the follow-up instead of FAFF-1295 for naming the leftover entries. This changes FAFF-1295's fourth acceptance point, so the product owner decides.
  - Otherwise: keep the lines, and add to the first assumption that the `--shared` text is also why the pairing is needed.

**n1 (nit): FAFF-1297's `present_elsewhere` may use a second key builder.**

Out of scope says FAFF-1297 "may" call `faffHookKeysIn` to compute `present_elsewhere`. FAFF-1297's step 8 builds the same keys from "the same predicates step 6 uses", because its spec was written before this helper existed. Both use `isPresent` and `isPresentInMatcher`, so the predicates cannot drift. The key format can. Since FAFF-1297 builds after this ticket, add a note to FAFF-1297, not this spec, that `present_elsewhere` is computed with `faffHookKeysIn`. That makes this spec's "one definition" principle hold across both tickets.

**n2 (nit): the Codex extension point does not say how FAFF-1387 treats an invalid file.**

The Codex extension point is `hookSettingsAt` with a harness argument. In this spec, an invalid file joins exit 1. FAFF-1387 says the Codex check "warns, never fails" and that a malformed `.codex/hooks.json` "is reported, not thrown". A builder who reuses the invalid-to-exit-1 path for Codex would go against FAFF-1387. Add a clause to that extension point: a Codex file's `invalid` state stays advisory, per FAFF-1387.

### Risk profile (principle 7)

**m3 (minor): the "repo's real split" selftest case depends on files that only exist on one machine.**

- **What's there.** How and the first WHAT DoD item give `hooksEnsureSelftest` a case for "this repo's real split", with expected keys taken from this checkout's `.claude/settings.json` and `.claude/settings.local.json`. Both files are gitignored (`.gitignore:28-29`), so CI and other clones do not have them. `hooks-ensure --selftest` runs in `test/hooks-ensure.test.mjs:214`, and `regions.js` lists it in `REGION_SELFTEST_ARGV`. FAFF-899 records that the L4 guardrail preflight gates on subcommand selftests.
- **Why it matters.** If a builder reads the case from the live files, the selftest fails in CI and on every other machine, and it can block L4 runs on the preflight. The builder will most likely find this out in CI, after the work is done.
- **Recommended action.** Change the DoD item to say the split is an inline literal fixture in the selftest, with the two objects copied from How. No spike is needed.

The other risks are covered. Bash-scoping the fence has a failure mode, and `FAFF_PRE_TOOL_USE_MATCHER_GROUPS` (`hooks-ensure.js:54-57`) writes only `"Bash"` and `"Monitor"`, so installs that `hooks-ensure` made are not affected. The assumption that Claude Code merges both files is supported by the `runcheck` entry that exists only in `settings.local.json`.

### Consistency with FAFF-1297

The two specs agree on these points:

- The hook-key format (`"runcheck"`, `"Bash::merge-fence"`).
- The ordering: FAFF-1297's first assumption greps `gates.js` for `settings.local.json`, and this spec's reader adds that path.
- The test at `test/doctor.test.mjs:203`, which runs `hooks-ensure` and then doctor.
- Keeping a `--shared` config key out of scope, and the matching failure modes.

Some of FAFF-1297's references are stale or overlap with this ticket. These are FAFF-1297's to fix and are not findings here:

- It cites `gates.js:1835-1843` and `:2222-2224`. At `a19233aa`, `mergeFencePresentAt` is at `gates.js:1985-1990`.
- Its test floor points `test/doctor.test.mjs` at `settings.local.json`. This ticket already moves those fixtures, so that step will have nothing left to change.

### Findings

| Id | Severity | Principle | Issues | Action |
|---|---|---|---|---|
| m1 | Minor | 6 | FAFF-1295, `kernel.md` doctor-at-entry | File a ticket for the exit-1 offer to name settings and fence findings; cite it in Out of scope |
| m2 | Minor | 6, 4 | FAFF-1295, FAFF-1297 | Preferred: split the `⚠` lines into a follow-up blocked by FAFF-1297. Otherwise: record the `--shared` text as part of the pairing |
| m3 | Minor | 7 | FAFF-1295 (selftest DoD) | Make the real-split case an inline fixture |
| n1 | Nit | 6 | FAFF-1297 | Note on FAFF-1297 that `present_elsewhere` uses `faffHookKeysIn` |
| n2 | Nit | 6 | FAFF-1387 | Codex `invalid` state stays advisory in the extension point |

**Prep response (revision 2, 2026-10-23).**

| Finding | Disposition |
|---|---|
| m1 | Named as a follow-up ticket to be filed (doctor-at-entry routes settings and fence findings to their own remedy); offered to the operator |
| m2 | Applied without changing scope: the advisory lines switch on only when `hooks-ensure` has `--shared` (FAFF-1297), so this ticket ships alone and the same-release assumption is dropped |
| m3 | Applied: the selftest split is fixed data |
| n1 | Left as a note for FAFF-1297's build (call `faffHookKeysIn` for `present_elsewhere`) |
| n2 | Applied: the Codex extension point says an unreadable `.codex/hooks.json` only warns |

confidence: high
build-tier: complex
spec-review: accept (operator, 2026-10-23; two rounds, 6 minors, all fixed in revisions 3 and 4)

```faff-contract:spec-readiness
{"confidence": "high", "decisions": [{"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "chosen"}, {"marker": "assumes"}, {"marker": "assumes"}]}
```
