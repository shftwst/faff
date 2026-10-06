# FAFF-1200: make the test suite pass on a macOS, Node 24, non-UTC developer host

> Spec: faffter-dark-nlspec · 2026-10-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1200.

This spec is for the build agent fixing FAFF-1200 and for the human reviewing the pull request. It covers four independent host assumptions that make 17 tests fail locally on macOS with Node 24 in a non-UTC time zone while CI stays green, plus one product defect the investigation found underneath one of them.

## 1. Why

**The model.** Every one of the 17 failures is a test or selftest that silently assumes the CI host: Linux, Node 20, UTC, and a temporary directory that is not a symlink. The fix in each case is to make the check host-independent and then prove it on the Linux CI host by simulating the other host explicitly (a symlinked root, a pinned host OS, an explicit `TZ`), so the same drift cannot come back unseen. Realpath-ing temporary directories everywhere is not enough on its own: in `worktree-heal` the symlinked path exposes a real product bug, and blanket test changes would hide it.

**Problem.** README.md line 48 says SuperDomestique supports macOS and Linux with Node 20 or later, but on macOS with Node v24.15.0 in BST, `node --import ./test/hermetic-env.mjs --test --test-shard=N/4` fails 17 cases at `856326d1` (identical from a worktree and a plain clone). Contributors learn to ignore a red local suite; the FAFF-1167 build record already notes "the same 22 environment failures as origin/main", which is how real regressions get waved through. This change makes the full suite pass on that host and adds Linux-run regression tests for each cause.

**Design principles.**

**Fix the product when the product is wrong.** Where a failing test is reporting a real defect, fix the code and keep a test that exercises the failing condition. Do not normalise the test input until the defect disappears.

**Every host-independence fix in product code or a selftest gets a Linux-runnable regression check.** CI runs the unit suite on Linux in UTC. A fix that is only exercised on macOS or in a non-UTC zone will regress silently. Each such fix below names the test that simulates the other host on any machine. The test-only `realpathSync` changes in the five temporary-path files are the exception: on Linux they are no-ops, so they follow the existing `test/impure/review-target.test.mjs` precedent and are verified by the macOS rerun in section 8.

**One file set on every Node version.** Pathless `node --test` must collect the same files on Node 20 and on Node 24, so local runs, the local gate ladder and both CI lanes agree.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/worktree-heal.js` (`verifyHeal`, lines 106 to 121) | JavaScript | Compares `git worktree list --porcelain` paths with an unresolved path; the product defect |
| `test/worktree-heal.test.mjs`, `test/sync.test.mjs`, `test/integrity-boundary.test.mjs`, `test/resolve-run-dir.test.mjs`, `test/token-breakdown-attribution.test.mjs` | JavaScript | The 11 temporary-path failures |
| `test/impure/review-target.test.mjs` lines 40 to 46 | JavaScript | Existing precedent: `realpathSync(mkdtempSync(...))` with a macOS comment |
| `test/fixtures/boundary-cast/*.ts`, `test/fixtures/ts-brand-negative/` | TypeScript | Compiler-API fixtures swept into Node's default test glob on Node 22.18 and later |
| `test/check-no-boundary-cast.test.mjs` line 20, `test/ts-brand-negative.test.mjs` line 19 | JavaScript | The only consumers of those fixtures |
| `.github/workflows/validate.yml` `unit` job (Node 20) and `typecheck` job (Node 24, FAFF-1171) | YAML | The two pathless suite invocations; the Node 24 one carries `--no-experimental-strip-types` only because of the fixtures |
| `plugin/skills/faff/bin/lib/gates.js` (`selectRunnableRungs` line 912, `discoverCiWorkflowsRunnable` line 821 with its `localOs()` call at line 827, selftest cases at lines 1428 to 1503) | JavaScript | Host-OS-dependent selftest rows from FAFF-1149 |
| `plugin/skills/faff/bin/lib/budget.js` (`untilToEpoch` line 322, selftest `NOW` line 1534, rows at lines 1561 to 1564) | JavaScript | Time-zone-dependent selftest rows |
| `test/gates-ci-source.test.mjs` lines 149 to 170 | JavaScript | Linux-only guard that pins the repository's selected rung set, including the flagged Node 24 command |
| `CONTRIBUTING.md` lines 11 and 19 to 35 | Markdown | Documents a `--test test/` invocation that fails on Node 22 and later |

**Scope.** This is test-suite and selftest hygiene for the faff repository's own development loop, plus one product fix in `faff worktree-heal`; it changes no adopter-facing behaviour except that a heal under a symlinked worktree root now succeeds.

## Already shipped against this surface

- **FAFF-1171** (Done): added the Node 24 `typecheck` CI job, which runs the pathless suite with `--no-experimental-strip-types` to keep the `.ts` fixtures out. This answers the issue's second open question: a current-Node CI lane already exists.
- **FAFF-1149** (Done): let a portable `node --test` UNIT rung survive an OS mismatch in the local gate ladder; it added the two selftest rows that assume a Linux host.
- **FAFF-1114** (Done): added `worktree-check` clobber detection and `worktree-heal`; `verifyHeal` comes from this ticket.
- **FAFF-762** (Done): re-targeted the `validate-macos` CI job at `test/impure/` only, which is why the macOS-only failures never show in CI.
- **FAFF-580** (Done): set the portability posture (POSIX, macOS and Linux).

None of these fixes the four causes, so the premise stands.

## 2. Out of scope

- **`regions selftest` failing locally.** Why excluded: excluded by `.faffrc.yaml` `gates.exclude` and not verified here. Extension point: a new ticket against `plugin/skills/faff/bin/lib/regions*.js`.
- **The local gate ladder's docker UNIT rung** (`node ... --test test/env.test.mjs test/holdout-evaluate-integration.test.mjs` from the env-rootless job). Why excluded: docker availability is a separate host concern. Extension point: `gates.exclude` in `.faffrc.yaml` or `exclusionReason` in `gates.js`.
- **A macOS unit-suite CI lane.** Why excluded: FAFF-762 deliberately limits `validate-macos` to `test/impure/`; the Linux-run regression tests in this spec cover the macOS-specific causes. Extension point: the `validate-macos` job in `.github/workflows/validate.yml`.
- **Non-test `.mjs` files under `test/`** (helpers, `test/fixtures/trim-baseline/*.mjs`, `test/fixtures/code-interface/stack.mjs`) being spawned by pathless discovery. Why excluded: an existing, documented convention (they must exit 0; see `test/fixtures/trim-baseline/regenerate.mjs` lines 19 to 26) and they pass. Extension point: the fixture relocation pattern in this spec, if one ever needs to move.
- **An audit of every other symlink-sensitive path comparison in the product.** Why excluded: a grep of the worktree code found only `verifyHeal`; a repository-wide audit is a separate piece of work. Extension point: a follow-up ticket; FAFF-1110 (realpath guard for transcript resolution) is related but distinct.
- **Changing `worktree-check` / `worktree-heal` JSON output to canonical paths.** Why excluded: the `worktree_path` field is an output contract consumed by faff-graft Step 3; this spec changes only the internal comparison. Extension point: `cmdWorktreeHeal` / `worktree-check.js` output builders.

## 3. What

**Vocabulary.**

| Term | Meaning |
|---|---|
| Canonical path | The result of `fs.realpathSync` on a path: every symlink resolved. On macOS, `/tmp` and `/var` are symlinks into `/private`, so `os.tmpdir()` paths are not canonical. Git, `process.cwd()` and child processes report canonical paths. |
| Pathless discovery | `node --test` with no file arguments, which collects files by Node's built-in default patterns. On Node 22.18 and later (unflagged type stripping), the patterns include `.ts`, `.mts` and `.cts`, so any of those under a `test/` directory is executed as a test. |
| Host OS | The value of `localOs()` in `gates.js` (`linux`, `macos` or `windows`), compared with a workflow job's `runs-on` family. |

### The worktree-heal comparison

```
FUNCTION same_path(a, b) -> Boolean:
  # trailing slashes stripped; each side resolved with realpath;
  # a side that cannot be resolved (does not exist) falls back to its stripped raw string
  RETURN canonical_or_raw(a) == canonical_or_raw(b)
```

`verifyHeal` uses `same_path` when checking that `git worktree list --porcelain` names the healed checkout. Nothing else in `worktree-heal.js` or the JSON it prints changes.

**Chosen:** compare canonical paths inside `verifyHeal`, with a raw-string fallback when realpath throws. Rationale: git always records the canonical path, while `finding.worktree_path` comes from the configured worktree root, which an operator may reach through a symlink (on macOS any root under `/tmp` or `/var/folders`, or a symlinked workspace). The heal already succeeds in that case; only the verification lies, so graft parks a healthy worktree as `repair-failed`.

### Temporary paths in the five test files

**Chosen:** resolve each temporary root once, where it is created, with `realpathSync(mkdtempSync(...))`, inline in each of the five files, following `test/impure/review-target.test.mjs`. In `test/worktree-heal.test.mjs` this happens in `setup()`, so the existing six tests compare like with like; the symlink behaviour is then covered by the new regression test below rather than by the host's tmp layout. Rationale: one line per creation site, an existing precedent, and no new shared helper module for nine call sites. The rejected shared helper is recorded in section 6.

### TypeScript fixture location

```
testdata/typescript/boundary-cast/       # the 8 .ts files now in test/fixtures/boundary-cast/
testdata/typescript/ts-brand-negative/   # brand-negative.ts + tsconfig.json now in test/fixtures/ts-brand-negative/
```

**Chosen:** move both fixture directories, unchanged in content, to `testdata/typescript/` at the repository root, and update the two consumers. Rationale: nothing under `testdata/` matches any of Node's default test patterns on any version, so pathless discovery collects the same files on Node 20 and Node 24 with no flag. The new directories sit at the same depth as the old ones (three levels), so the fixtures' relative paths (`../../../plugin/skills/faff/...` in `tsconfig.json` and `brand-negative.ts`) stay correct without edits. Moving with `git mv` keeps history.

**Chosen:** add a guard test, `test/no-typescript-under-test.test.mjs`, that walks `test/` (skipping `node_modules`) and fails if any `.ts`, `.mts` or `.cts` file exists, naming each one and pointing at `testdata/typescript/`. The walk is a small function the same file also runs against a temporary directory holding one planted `.ts` file, asserting it is reported, so a guard that silently matches nothing cannot pass. Rationale: the Node 20 `unit` lane never collects `.ts` files, so without the guard a new fixture added under `test/` would pass CI and break every Node 24 developer again.

**Chosen:** remove `--no-experimental-strip-types` from the Node 24 `typecheck` job's suite step in `.github/workflows/validate.yml`, and replace its explanatory comment with one sentence pointing at `testdata/typescript/` and the guard test. Rationale: the flag existed only to hide the fixtures (its own comment says so). Without it, the Node 24 CI lane runs exactly the discovery a Node 24 developer runs, and the local gate ladder's two full-suite UNIT rungs (the Node 20 line with its shard flag stripped, and the Node 24 line) normalise to the same command, `node --import ./test/hermetic-env.mjs --test`, so `selectRunnableRungs` keeps one rung instead of running the whole suite twice. That normalisation already exists: `normaliseLocalRungCommand` (`gates.js` line 810, FAFF-987) strips the `--test-shard=...` token and collapses whitespace before `selectRunnableRungs` keys rungs by kind and command (line 929), and on this repository the runnable set already contains `node --import ./test/hermetic-env.mjs --test` derived from the `unit` line (`test/gates-ci-source.test.mjs` asserts it). The two lines today are `node --import ./test/hermetic-env.mjs --test --test-shard=${{ matrix.shard }}/4` (`validate.yml` line 178, `unit` job) and `node --no-experimental-strip-types --import ./test/hermetic-env.mjs --test` (`validate.yml` line 508, `typecheck` job); they differ only by the shard token and the flag, and neither step sets a different working directory or `NODE_OPTIONS`. No change to `gates.js` is needed for the dedupe. The local macOS run in the explore step already shows that type stripping changes no real test result.

### Gates selftest host

```
FUNCTION selectRunnableRungs(root, cfg, hostOs = localOs())
FUNCTION discoverCiWorkflowsRunnable(root, cfg, hostOs = localOs())
```

**Chosen:** add an optional trailing `hostOs` parameter to both functions, defaulting to `localOs()`, passed from `selectRunnableRungs` into `discoverCiWorkflowsRunnable` in place of its own `localOs()` call. Every `selectRunnableRungs` call inside `gatesSelftest` passes `"linux"`. Production callers (`cmdGates` path at line 969) pass nothing, so behaviour on real hosts is unchanged. Line 827 is the only `localOs()` call in `gates.js` (the definition is at line 737), so this one thread pins every host-OS read on the rung-selection path. Rationale: the neighbouring `exclusionReason` selftest rows already take the host OS as an argument; this extends the same seam one level up. Add one mirror row that runs the existing `dMac` fixture with `hostOs = "macos"` and asserts the `ubuntu-latest` `validate-adapters` step is excluded as `os-mismatch` while the portable `node --test` UNIT rung survives, so both host directions are pinned on any machine.

### Budget selftest clock

**Chosen:** keep `untilToEpoch` unchanged (local wall-clock `HH:MM` is the intended product behaviour) and anchor the two `until` rows (`until future same-day`, `until past rolls to next day`) on a local-time noon built with the local `Date` constructor (2026-06-23 12:00:00 in the process's own zone). Every other selftest row keeps the existing UTC `NOW`. Rationale: the rows assert a local-time property, so their clock must be local too; then the selftest passes in every zone, including when an operator runs `faff budget --selftest` directly.

**Chosen:** add a regression test in `test/budget.test.mjs` that runs `budget --selftest` once per zone in `UTC`, `Europe/London`, `America/Los_Angeles` and `Pacific/Kiritimati`, passing `TZ` through the spawn environment. Before asserting exit 0 for a non-UTC zone, the test proves the zone took effect in a child process (a non-zero `getTimezoneOffset()` for the June date), so a runner that ignores `TZ` fails loudly instead of passing vacuously. The existing `{HOME, PATH}` environment in `run()` is otherwise unchanged.

### Contributor documentation

**Chosen:** in `CONTRIBUTING.md`, replace `node --import ./test/hermetic-env.mjs --test test/` with the pathless `node --import ./test/hermetic-env.mjs --test`, add one sentence that the suite is expected to pass on macOS and Linux with Node 20 or later in any time zone (the README's stated support), and note the per-shard form `--test-shard=N/4` for faster local runs. Rationale: the documented form fails on Node 22 and later (the FAFF-987 note in `validate.yml`), and the issue's second open question asked for the supported local range to be recorded.

**Chosen:** add no new CI lane. Rationale: FAFF-1171's Node 24 job already covers current Node, and the regression tests above cover the macOS and time-zone causes on Linux.

## 4. How

### Worktree heal verification

`verifyHeal` keeps its three checks (branch, resolvable HEAD, re-registration). Only the third changes.

```
PROCEDURE verify_reregistered(root, finding):
  1. Run `git -C root worktree list --porcelain`; on non-zero exit or non-string stdout RETURN false
  2. listed := every line starting "worktree ", with the prefix removed and trimmed
  3. RETURN any entry e in listed where same_path(e, finding.worktree_path)
```

**Regression test** (new, in `test/worktree-heal.test.mjs`): create a real directory under a canonical temporary parent, create a symlink beside it pointing at it, set `FAFF_WORKTREE_ROOT` to the symlink path, add a worktree through the symlink path, clobber its admin directory (comparing canonical paths in the helper), then run `worktree-heal --json`. Expect exit 0, `healed: true`, the expected branch, and `git worktree list` naming the canonical checkout path. This runs on Linux CI because the symlink is explicit.

**Anti-pattern:** canonicalising `finding.worktree_path` at detection time so that every later comparison works. Why: it changes the `worktree_path` JSON contract faff-graft reads and the path the operator configured; the bug is in one comparison and the fix belongs there.

### Temporary paths

For each `mkdtempSync(...)` whose result is compared with CLI output, git output, a child's `process.cwd()`, or a path derived from one of those, wrap it in `realpathSync`. Concretely: `integrity-boundary.test.mjs` lines 14 and 18; `resolve-run-dir.test.mjs` lines 24 and 70; `sync.test.mjs` lines 23, 34, 128 and 129; `token-breakdown-attribution.test.mjs` lines 232 and 233; `worktree-heal.test.mjs` line 24 (in `setup()`). Expectations are then computed from the canonical value. No assertion is loosened.

**Anti-pattern:** comparing with `endsWith`, stripping `/private`, or setting `TMPDIR` in `hermetic-env.mjs`. Why: each hides the mismatch only for macOS's specific layout, and the hermetic preload deliberately preserves `TMPDIR`.

### Fixture relocation

```
PROCEDURE relocate_fixtures():
  1. git mv test/fixtures/boundary-cast       testdata/typescript/boundary-cast
  2. git mv test/fixtures/ts-brand-negative   testdata/typescript/ts-brand-negative
  3. In test/check-no-boundary-cast.test.mjs, point FIX at <repo>/testdata/typescript/boundary-cast
  4. In test/ts-brand-negative.test.mjs, point FIXTURE_TSCONFIG at <repo>/testdata/typescript/ts-brand-negative/tsconfig.json
  5. Add test/no-typescript-under-test.test.mjs (the guard)
  6. In validate.yml's typecheck job, drop --no-experimental-strip-types from the suite step and rewrite its comment
  7. In test/gates-ci-source.test.mjs (the Linux selected-rung guard, around line 166), drop the
     "node --no-experimental-strip-types ..." entry: the two full-suite commands now dedupe to one
  8. grep the repository (excluding records/, .faff/ and CHANGELOG.md) for "fixtures/boundary-cast",
     "fixtures/ts-brand-negative" and "no-experimental-strip-types"; update any live reference
```

Both consumer tests self-skip when the TypeScript compiler is not installed; that behaviour is unchanged. On a machine with `npm install` done under `plugin/skills/faff`, both must run and pass after the move.

### Gates selftest

Thread `hostOs` as described in section 3. Pass `"linux"` from the selftest at every `selectRunnableRungs` call (the `dWide`, `dMac`, `dExc` and capped `dWide` fixtures). Add the `"macos"` mirror row. No change to exclusion precedence or rung ordering.

### Budget selftest

```
PROCEDURE until_rows():
  1. LOCAL_NOON := epoch ms of 2026-06-23 12:00:00 in the process's local zone
  2. future := untilToEpoch("13:00", LOCAL_NOON)
     ok("until future same-day", future > LOCAL_NOON AND future - LOCAL_NOON < 2h)
  3. past := untilToEpoch("11:00", LOCAL_NOON)
     ok("until past rolls to next day", past > LOCAL_NOON AND past - LOCAL_NOON > 22h)
  4. The malformed row ("nope", "25:00") is zone-independent and keeps NOW
```

The test-side zone sweep is described in section 3.

### Edge cases

- **Realpath of a vanished path** in `verifyHeal`: fall back to the raw stripped string, matching today's behaviour for that side. This is deliberately fail-closed: a raw fallback can only fail to recognise a heal (a spurious `repair-failed`), never report a false one, so keep it strict string equality: no prefix or suffix match, and no case or separator folding.
- **Both sides already canonical** (Linux, default roots): `same_path` reduces to today's string equality, so no behaviour change.
- **2026-06-23 is not a daylight-saving transition day** in any of the four test zones, so local noon plus or minus one hour is unambiguous.
- **A future `.ts` fixture** added under `test/`: the guard test fails on every Node version, naming the file and the `testdata/typescript/` location.

### Failure modes

- **The failure:** removing `--no-experimental-strip-types` from the Node 24 job turns up a real `.mjs` test that behaves differently with type stripping on. **How you'd know:** the `typecheck` job's suite step goes red on the pull request while the Node 20 `unit` shards stay green. **What it means:** narrow; restore the flag in that one step, keep the relocation and guard, and record the difference in a follow-up. The local macOS run in the explore step (type stripping on, only the 17 known failures) makes this unlikely.
- **The failure:** a CI runner ignores `TZ`, so the zone sweep would pass vacuously. **How you'd know:** the sweep's own precondition (a non-zero offset in the child) fails. **What it means:** proceed; the precondition is exactly the guard against this.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a worktree root reached through a symlink, and a graft worktree under it whose admin metadata was pruned
When `faff worktree-heal --issue <id> --json` runs
Then it exits 0 with healed: true, and `git worktree list` names the checkout
```

```
Given the process time zone is Europe/London, America/Los_Angeles or Pacific/Kiritimati
When `faff budget --selftest` runs
Then every row passes and the exit code is 0
```

```
Given gatesSelftest runs on a macOS host
When the os-mismatch fixture rows execute
Then they evaluate against the pinned linux host and pass, and the macos mirror row also passes
```

```
Given Node 22.18 or later with type stripping enabled
When `node --import ./test/hermetic-env.mjs --test` runs pathless from the repository root
Then no file under testdata/ is executed as a test, and no .ts file exists under test/
```

## 6. Design decision rationale

**How should the temporary-path tests stop depending on the host's tmp layout?**
Options: (a) `realpathSync` inline at each `mkdtempSync` site; (b) a shared `test/helpers` function returning a canonical temp dir; (c) set `TMPDIR` to a canonical path in the hermetic preload.
(a) matches the existing precedent and is one call per site. (b) adds a module for nine call sites. (c) changes a preload that deliberately preserves `TMPDIR` and only works where the canonical path is known.
**Chosen:** inline `realpathSync(mkdtempSync(...))`, option (a).

**Is the worktree-heal failure a test bug or a product bug?**
Fixing only the test helper left three tests failing with `repair-failed` while `git worktree list` showed the worktree registered. `verifyHeal` compares git's canonical path with the configured, possibly symlinked, path.
**Chosen:** product bug; fix `verifyHeal` and add an explicit-symlink regression test, as well as canonicalising the test's tmp root.

**How should pathless discovery stop collecting the `.ts` fixtures?**
Options: (a) an explicit test glob shared by CI and local runs (the issue's default); (b) `--no-experimental-strip-types` on every invocation; (c) rename the fixtures to a non-TypeScript extension; (d) make each fixture exit 0 when executed; (e) move the fixtures out of `test/`.
(a) fails on the Node 20 floor: a quoted `test/**/*.test.mjs` matches nothing on Node 20 and a `test/` positional fails on Node 22 (the FAFF-987 note in `validate.yml`). (b) Node 20 predates the option, so the Node 20 line cannot carry it (prep did not check a Node 20 binary; the FAFF-1171 comment implies the same), and the local gate ladder derives its UNIT rung from that line. (c) breaks `tsc -p` (the tsconfig `include`) and the checker's `.ts` file-set assertion. (d) `cast-angle.ts` uses angle-bracket assertions, which Node's type stripper rejects by design. (e) works on every Node version with no flags and keeps relative paths intact at the same depth.
**Chosen:** move the fixtures to `testdata/typescript/` with a guard test, option (e). At the time of writing, Node offers no file-exclude option for pathless discovery on the Node 20 line.

**Should the Node 24 CI job keep `--no-experimental-strip-types`?**
Keeping it is harmless but leaves CI's Node 24 lane running a different discovery from a Node 24 developer, and leaves the local gate ladder running the whole suite twice. Removing it unifies both.
**Chosen:** remove it, with the guard test as the replacement protection.

**How should the gates selftest stop depending on the host OS?**
Options: (a) an optional `hostOs` parameter threaded from `selectRunnableRungs`; (b) an environment variable override read by `localOs()`; (c) temporarily overriding `process.platform` in the selftest.
(b) adds an operator-visible knob for a test need. (c) mutates process-global state inside the shipped CLI; `test/gates-ci-source.test.mjs` does override `process.platform`, but in a test file, not in a selftest that operators run.
**Chosen:** the optional parameter, option (a), matching how `exclusionReason` is already tested.

**How should the budget `until` rows stop depending on the time zone?**
Options: (a) anchor those rows on local noon; (b) pin `process.env.TZ = "UTC"` inside the selftest; (c) pass `TZ` through `test/budget.test.mjs`'s spawn environment.
(b) mutates the CLI process's zone and stops the selftest checking local-time behaviour in the operator's own zone. (c) still fails for anyone running `faff budget --selftest` directly, and pinning UTC in the test would hide this class of bug.
**Chosen:** anchor on local noon, option (a), plus a test-side multi-zone sweep that uses `TZ` only to simulate other zones.

**Should CI add a current-Node lane (the issue's second open question)?**
FAFF-1171 already added the Node 24 `typecheck` job that runs the full suite.
**Chosen:** no new lane; record the supported local range (macOS and Linux, Node 20 or later, any time zone) in `CONTRIBUTING.md`.

## 7. Open questions and assumptions

**Open questions.** None. The issue's two open questions are closed above: the test-glob question by the fixture relocation (an explicit glob is not viable on Node 20), and the Node-floor question by FAFF-1171's existing Node 24 lane plus the `CONTRIBUTING.md` note. Both are agent decisions made during prep, not human-ratified.

**Assumptions.**

**Assumes:** `typescript` is installed under `plugin/skills/faff/node_modules` on the build machine, so `check-no-boundary-cast.test.mjs` and `ts-brand-negative.test.mjs` run rather than self-skip after the move. Validation: run `npm install` in `plugin/skills/faff`, then run both files and confirm a non-zero pass count with zero skipped. CI's `typecheck` job enforces the same through its un-skip floor.

## 8. Done

### From Why
- [ ] On macOS with Node 24 in a non-UTC zone, `node --import ./test/hermetic-env.mjs --test --test-shard=N/4` reports 0 failures for each of N = 1 to 4.
- [ ] The Node 20 `unit` shards and the Node 24 `typecheck` job pass on the pull request.

### From What and How: worktree heal
- [ ] `verifyHeal` compares canonical paths with a raw-string fallback; the `worktree_path` values printed by `worktree-check` and `worktree-heal` are unchanged.
- [ ] A new test in `test/worktree-heal.test.mjs` heals a clobbered worktree whose `FAFF_WORKTREE_ROOT` is a symlink, and asserts exit 0, `healed: true` and the correct branch. It fails against the current `verifyHeal`.
- [ ] `node plugin/skills/faff/bin/faff worktree-heal --selftest` (the existing `worktreeHealSelftest`, `worktree-heal.js` line 209) still passes.

### From What and How: temporary paths
- [ ] The five named test files create every compared temporary root with `realpathSync(mkdtempSync(...))`, and no assertion is loosened.
- [ ] On macOS (where `/tmp` and `/var/folders` are symlinks), rerunning those five files with `TMPDIR=/tmp` passes all of their tests.

### From What and How: TypeScript fixtures
- [ ] The eight `boundary-cast` fixtures and the `ts-brand-negative` fixture plus `tsconfig.json` live under `testdata/typescript/`, moved with `git mv`, contents unchanged.
- [ ] `test/check-no-boundary-cast.test.mjs` and `test/ts-brand-negative.test.mjs` read the new paths and pass with TypeScript installed (zero skipped).
- [ ] `test/no-typescript-under-test.test.mjs` exists, passes, and fails with the offending path named when a `.ts` file is placed under `test/`.
- [ ] The `typecheck` job's suite step in `validate.yml` no longer passes `--no-experimental-strip-types`, and its comment points at `testdata/typescript/` and the guard.
- [ ] On this repository, `selectRunnableRungs` yields one full-suite UNIT rung, `node --import ./test/hermetic-env.mjs --test`, instead of two.
- [ ] The Linux selected-rung guard in `test/gates-ci-source.test.mjs` no longer lists the flagged command and passes.
- [ ] No live reference to `test/fixtures/boundary-cast` or `test/fixtures/ts-brand-negative` remains outside `records/`, `.faff/` and `CHANGELOG.md`.

### From What and How: gates selftest
- [ ] `selectRunnableRungs` and `discoverCiWorkflowsRunnable` take an optional `hostOs` defaulting to `localOs()`; production callers pass nothing.
- [ ] Every `selectRunnableRungs` call in `gatesSelftest` passes `"linux"`, and a mirror row with `"macos"` asserts the `ubuntu-latest` step is excluded as `os-mismatch` while the `node --test` UNIT rung survives.
- [ ] `faff gates --selftest` exits 0 on macOS and on Linux.

### From What and How: budget selftest
- [ ] The two `until` rows use a local-time noon anchor; `untilToEpoch` is unchanged.
- [ ] `faff budget --selftest` exits 0 under `TZ` set to `UTC`, `Europe/London`, `America/Los_Angeles` and `Pacific/Kiritimati`.
- [ ] `test/budget.test.mjs` sweeps those four zones through the spawn environment and first asserts each non-UTC zone took effect in the child.

### From What and How: documentation
- [ ] `CONTRIBUTING.md` documents the pathless `node --import ./test/hermetic-env.mjs --test` invocation and the shard form, and states the suite passes on macOS and Linux with Node 20 or later in any time zone.

### Integration smoke test

```
PROCEDURE smoke():
  1. On macOS, Node 24, TZ=Europe/London, TMPDIR=/tmp
  2. FOR N IN 1..4: run node --import ./test/hermetic-env.mjs --test --test-shard=N/4 in the foreground
     EXPECT "fail 0" in each shard summary
  3. Call selectRunnableRungs on the repository root; EXPECT exactly one rung whose command is
     node --import ./test/hermetic-env.mjs --test
  4. Run faff gates --selftest and faff budget --selftest; EXPECT exit 0 for both
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4): no issues.** The spec bundles four test-side causes and one product fix (`verifyHeal`). Each piece is a few hours; together they ship one observable outcome, a green local suite on a supported host, and the `verifyHeal` fix is required for the worktree-heal tests to pass. Splitting would produce sub-day tickets that always ship together. Name the `worktree-heal` behaviour change in the pull request title or summary so a reviewer does not read it as test-only.
- **Workstream fit (principles 1 and 5): no issues.** Project-less Backlog bug with one outcome.
- **Surfaced dependencies (principle 6): no issues.** The referenced tickets (FAFF-1171, FAFF-1149, FAFF-1114, FAFF-762, FAFF-580) are Done, so no blocker link is needed; FAFF-1110 is named only as out of scope.
- **Risk profile (principle 7): no issues.** The one change with reach beyond tests, dropping `--no-experimental-strip-types` from a required CI job, is exercised by the pull request's own CI run and has a named fallback in the failure modes; no separate spike is warranted.

confidence: high
spec-review: approve
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"} ] }
```
