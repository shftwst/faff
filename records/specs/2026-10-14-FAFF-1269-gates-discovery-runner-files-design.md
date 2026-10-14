# FAFF-1269: Gates discovery finds test and lint runner files in bin/, script/ and scripts/

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1269.

This spec is for the build agent and human reviewers. It adds a fifth trusted source to the engineering gate ladder in `plugin/skills/faff/bin/lib/gates.js`: executable runner files at the top of the repo-root `bin/`, `script/` and `scripts/` directories.

## 1. WHY

**The load-bearing model.** A runner file is trusted the same way a Makefile target is: faff reads only its *name*, maps that name to a gate kind, and runs the file by relative path with no arguments. Discovery never reads a file body, so the only new trust surface is "an executable file the repo committed under a conventional runner directory, whose name says test or lint".

**Problem.** `faff gates discover` reads pre-commit hook ids, `package.json` script names, Makefile target names and `.github/workflows/*.yml` run lines. A repo that keeps its checks only as runner scripts (`script/test`, `bin/lint`, `scripts/lint.sh`, the "Scripts to Rule Them All" layout) resolves discovery `none` and is routed to needs-human by the fail-closed `gates.fallback` default. This change gives those repos a working gate ladder.

**Design principles**

- **Precision over recall.** A false gate runs an arbitrary script as a required check; a missed gate falls back to the safe needs-human route. Every matching rule below leans toward not matching when in doubt.
- **Existing ladders do not move.** A repo that already resolves a kind through pre-commit, `package.json` or a Makefile keeps exactly that rung. This source only fills kinds those sources leave empty, and displaces CI-sourced rungs only.
- **One resolver per path.** The same runner-discovery function feeds `discoverRungs`, `discoverRungsReporting` and `selectRunnableRungs`, so discovery and execution agree (FAFF-848, FAFF-849).

**Reference context**

| System | Relevance |
|---|---|
| `gates.js` `gateKindForName` | Token-bounded name to kind mapper used by pkg, Makefile and pre-commit sources. Its UNIT and LINT vocabularies are reused here. |
| `gates.js` `discoverMakefile` | The names-only precedent this source mirrors. |
| `gates.js` `discoverRungsReporting`, `selectRunnableRungs` | Two-tier dedup: local sources collapse by kind; CI keeps distinct commands and is suppressed by any local kind (FAFF-533). |
| `gates.js` `capPerKind`, `readGatesConfig` | `gates.max_rungs_per_kind` (default 5) and `gates.exclude` already exist. |
| `gates.js` `discoverRungs` | Narrow resolver still used by `post-merge.js` (post-merge-check). |
| `docs/guide/cli.md` line 157, `plugin/skills/faff-graft/SKILL.md` Step 7.5 and Step 8 | Prose lists of the trusted sources. |

**Scope.** One new discovery function in `gates.js`, wired into the three existing resolvers, plus selftest cases and two doc list updates.

## 2. OUT OF SCOPE

- **Reading or parsing script bodies.** Why: names-only is the trust boundary. Extension point: none intended.
- **Recursing into subdirectories or other directories** (`tools/`, `ci/`). Why: conventional runner dirs only. Extension point: the `RUNNER_DIRS` constant.
- **Passing arguments to runners.** Why: no trusted source for arguments. Extension point: none.
- **FORMAT, TYPECHECK and STATIC_ANALYSIS runner files** (`bin/format`, `script/typecheck`). Why: the ticket scopes test and lint runners, and a `bin/format` often rewrites files. Extension point: `runnerKindForName`.
- **Windows execution** (`.cmd`, `.bat`, `.ps1`). Why: no executable bit and shebang scripts may not run. Extension point: the `hostOs === "windows"` branch of `discoverRunnerFiles`; a follow-up ticket.
- **Coverage accounting.** Coverage stays a CI-step ratio; runner rungs do not change `coverage` or the `partial` rule. Extension point: `discoverRungsReporting`.
- **Changing `gates.fallback`, the shared `gateKindForName`, or adding a config key.**

## 3. WHAT

**Vocabulary**

| Term | Meaning |
|---|---|
| runner file | A regular, executable file directly inside repo-root `script/`, `scripts/` or `bin/`. |
| stem | The file name with one trailing extension (`.` plus 1 to 4 alphanumerics) removed, lower-cased. `lint.sh` → `lint`; `test` → `test`. |
| qualifier | A word from the closed `RUNNER_QUALIFIERS` list that may be glued directly before a keyword (`unit` in `unittests`). |

**Constants**

```
RUNNER_DIRS        = ["script", "scripts", "bin"]          # precedence order, first wins on a stem clash
SAFE_RUNNER_NAME   = /^[A-Za-z0-9][A-Za-z0-9._-]*$/          # same charset as Makefile targets
RUNNER_COST_OFFSET = 2                                     # 0 < offset < CI_COST_PENALTY (5)
RUNNER_KEYWORDS    = { LINT: ["lint", "lints"], UNIT: ["test", "tests"] }
RUNNER_QUALIFIERS  = [unit, integration, e2e, smoke, system, acceptance,
                      functional, regression, all, run, js, ts, py, go, rb, css, style]
```

**Rung shape** (the existing rung record; only `source` gains a literal)

```
RECORD Rung:
  kind:      "LINT" | "UNIT"
  name:      "<kind lower> (runner: ./<dir>/<file>)"
  command:   "./<dir>/<file>"           # POSIX separators, no arguments
  source:    "runner_file"             # NEW literal
  cost_rank: GATE_COST[kind] + RUNNER_COST_OFFSET
  required:  true
```

**Interfaces**

```
FUNCTION runnerKindForName(stem) -> "LINT" | "UNIT" | null
FUNCTION discoverRunnerFiles(root, { hostOs = localOs(), cap = 5, exclude = [] }) -> { rungs: Rung[], exclusions: {command, reason}[] }
```

Both exported from `gates.js`.

**Decision: how wildcard names are matched.** The ticket's positive examples (`testall`, `test-e2e`, `unittests`, `linter`, `lint-js`) need prefix and suffix matching; its negative examples (`latest`, `contest`, `splint`) rule out a bare suffix wildcard.
**Chosen:** a stem matches kind K when any of these hold:

1. **Prefix wildcard:** the stem starts with a K keyword (`test*`, `lint*`). Covers `testall`, `test-e2e`, `tests`, `linter`, `lint-js`.
2. **Bounded suffix:** the stem ends with a K keyword and the part before it is empty, ends in a separator (`-`, `_`, `.`), or is exactly one `RUNNER_QUALIFIERS` word. Covers `unittests`, `run-tests`, `jslint`; rejects `latest`, `contest`, `splint`.
3. **Token match:** the stem contains a token from `gateKindForName`'s K vocabulary, token-bounded exactly as `gateKindForName` does, **excluding `check`**. Covers `eslint`, `rubocop`, `pytest`, `test-unit`.

LINT is tested before UNIT (same precedence as `gateKindForName`). Rationale: rule 1 honours the requested wildcard; rule 2 is the narrowest suffix rule that satisfies both the positive and negative examples; rule 3 keeps parity with the other sources. This is a source-local matcher, not a change to `gateKindForName`: widening the shared mapper would change existing ladders for every adopter's `package.json`, Makefile and pre-commit sources.

**Decision: `check`.** **Chosen:** `check` alone never makes a runner file a gate (`bin/check`, `scripts/check-no-boundary-cast.mjs`). Rationale: precision principle; `bin/check` is often a whole pre-push suite, and faff's own `scripts/` holds a `check-*` script that is not a unit runner. A missed `bin/check` falls back to needs-human, which is safe.

**Decision: extension precedence.** **Chosen:** dedupe by stem. When `bin/test` and `bin/test.sh` both exist, the extensionless name wins; among several extensioned names, the lowest in code-unit order wins. Rationale: the extensionless file is the conventional entry point and usually wraps the other; running both would run the suite twice.

**Decision: directory tie-break.** **Chosen:** dedupe by stem across directories in `RUNNER_DIRS` order: `script/`, then `scripts/`, then `bin/`. Rationale: `script/` is the "Scripts to Rule Them All" entry point; `bin/` in Rails repos mostly holds tool binstubs. Distinct stems in different directories all survive.

**Decision: cost rank.** **Chosen:** `GATE_COST[kind] + 2`, so pre-commit (base − 5) and `package.json`/Makefile (base) win the dedup by kind and CI (base + 5) loses. Rationale: the "existing ladders do not move" principle; ranking above `package.json` would silently replace the rung of every adopter whose repo has both. In the repos where both exist, one usually calls the other, so the coverage is the same.

**Decision: several runners of one kind.** **Chosen:** in the reporting and execution resolvers, runner rungs are kept distinct by command (like CI), capped at `gates.max_rungs_per_kind` per kind inside `discoverRunnerFiles`, and suppressed entirely for a kind any pre-commit, `package.json` or Makefile rung already covers. `discoverRungs` keeps its one-rung-per-kind collapse, so there the first runner in precedence order represents the kind.

**Decision: Windows.** **Chosen:** on `hostOs === "windows"` the source emits no rungs; each name-matched candidate is recorded as an exclusion with the existing reason `os-mismatch`. Rationale: there is no executable bit to check and shebang scripts may not run; reusing an existing reason adds no new vocabulary.

**Decision: selftest file modes.** **Chosen:** the selftest sets modes with `fs.chmodSync` on its temp fixtures (the harness already writes files under `fs.mkdtempSync`); the executable-bit and symlink cases run when `process.platform !== "win32"`, and on win32 the selftest instead asserts the `os-mismatch` exclusion. Rationale: CI runs on `ubuntu-latest`, so the POSIX cases always run there.

## 4. HOW

**Summary.** List each runner directory, keep safe, name-matched, executable files that resolve inside the repo, dedupe by stem, cap per kind, and hand the rungs to the three resolvers with a dedup tier between local sources and CI.

```
PROCEDURE discoverRunnerFiles(root, { hostOs, cap, exclude }):
  1. rungs := []; exclusions := []; seenStems := {}; perKind := {}
  2. realRoot := realpath(root)                         # failure → return empty
  3. FOR dir IN RUNNER_DIRS:
     a. IF root/dir is missing or not a directory → continue
     b. names := readdir(root/dir) sorted by code unit   # failure → continue
     c. FOR name IN names:
        i.   IF name fails SAFE_RUNNER_NAME → skip        # whitespace, metacharacters, leading dot
        ii.  stem := stemOf(name); kind := runnerKindForName(stem); IF kind is null → skip
        iii. IF stem IN seenStems → skip                 # dir precedence, then extensionless-first sort
        iv.  command := "./" + dir + "/" + name
        v.   IF hostOs == "windows": exclusions.push({command, reason: "os-mismatch"}); continue
        vi.  real := realpath(root/dir/name)             # failure (dangling link) → skip
        vii. IF real is not inside realRoot → skip       # symlink escaping the repo
        viii.IF real is not a regular file → skip
        ix.  IF access(real, X_OK) fails → skip          # executable bit required
        x.   add stem to seenStems
        xi.  IF command contains any exclude pattern: exclusions.push({command, reason: "configured"}); continue
        xii. IF perKind[kind] >= cap → skip; perKind[kind] += 1
        xiii.rungs.push(Rung{kind, command, source "runner_file", cost_rank GATE_COST[kind] + 2})
  4. RETURN { rungs, exclusions }
```

Sorting `test` before `test.sh` happens naturally in code-unit order (a prefix sorts first); step iii relies on it, and a selftest case pins it. The configured exclusion (step xi) runs before the cap (step xii), so an excluded runner never takes a cap slot; it still marks its stem seen, so excluding `./bin/test` does not promote `./bin/test.sh`.

**Joining the resolvers**

```
PROCEDURE three_tier_merge(localRungs, runnerRungs, ciRungs):
  1. dedupedLocal := localRungs collapsed by kind, cheapest first     # unchanged
  2. localKinds   := kinds of dedupedLocal
  3. keptRunners  := runnerRungs whose kind ∉ localKinds              # pkg/Makefile/pre-commit win
  4. coveredKinds := localKinds ∪ kinds of keptRunners
  5. keptCi       := ciRungs (existing per-command dedup) whose kind ∉ coveredKinds   # runner beats CI
  6. FOR each CI rung dropped in step 5 because its kind is in kinds of keptRunners (not localKinds):
       displaced.push({command: ci.command, reason: "runner-covered"})
  7. RETURN { rungs: dedupedLocal + keptRunners + keptCi, displaced }
```

- **`discoverRungsReporting(root)`:** call `discoverRunnerFiles(root, { cap: readGatesConfig(root).max_rungs_per_kind })`, merge with `three_tier_merge`, sort by `cost_rank` (stable). Coverage and the `discovery` classification are computed exactly as today. The JSON output gains no field; `displaced` is used only by the execution path.
- **`selectRunnableRungs(root, cfg, hostOs)`:** call `discoverRunnerFiles(root, { hostOs, cap: cfg.max_rungs_per_kind, exclude: cfg.exclude })`; merge with `three_tier_merge` before `aggregateSelftest` and `capPerKind`; append the runner exclusions and the `displaced` records to the returned `exclusions`, so `faff gates run` prints `excluded (runner-covered): <ci command>` for every CI rung a runner file took over. `runner-covered` is a new exclusion reason string; the only consumer is the human-readable `gates run` output and the `--json` `exclusions` array.
- **`discoverRungs(root)`:** add `...discoverRunnerFiles(root).rungs` after the Makefile source and before CI; the existing cheapest-first dedup by kind then picks pre-commit or pkg/Makefile over runner, and runner over CI. Ties at equal `cost_rank` keep source order (stable sort), so the first runner in precedence order wins.
- **Running:** no change. `runSingleSpawnSync` runs `./script/test` from the repo root. The command is built only from `SAFE_RUNNER_NAME` characters and fixed directory names, so the shell sees no interpolatable text.
- **`faff gates discover` output:** unchanged format; runner rungs print with `[runner_file]`.

**Edge cases**

- `bin` itself is a symlink outside the repo: every file's realpath fails the inside-root check, so nothing is emitted.
- A matching name that is a directory (`bin/test/`): not a regular file, skipped.
- Upper-case names (`Test`): stem is lower-cased for matching and dedup; the command keeps the real name.
- Name `test` but not executable: skipped, and the stem is not marked seen, so a later executable `scripts/test` can still be used.
- Faff's own repo: there is no repo-root `bin/` or `script/`, and `scripts/` has no executable test or lint runner (its executables are `link-skills.sh`, `setup-git-hooks.sh` and `throughput-snapshot.sh`; `check-no-boundary-cast.mjs` is neither executable nor a gate under the `check` rule), so faff's own ladder is unchanged and `test/gates-ci-source.test.mjs` passes as is.

**Failure modes**

- **A prefix wildcard catches a non-gate** (`bin/testflight`, `bin/test-helper`). This is worse than an extra rung when the repo's CI declares the same kind: the false runner displaces the real CI rung (for example `node --test`), so a ladder can pass without running the real suite locally. How you'd know: `faff gates discover` shows an unexpected `[runner_file]` rung, and `faff gates run` prints `excluded (runner-covered): <ci command>` naming the displaced check. What it means: the operator adds the runner to `gates.exclude`, which restores the CI rung on the next run; if this recurs, tighten rule 1 to the qualifier rule. The displacement only affects the local pre-PR ladder; the repo's CI still runs its own checks on the PR.
- **A runner expects arguments or an interactive terminal** and fails or hangs with none. How you'd know: the rung fails or hits `gates.rung_timeout_ms`. What it means: the ladder reports `fail` or `needs-human`, both non-green; `gates.exclude` is the escape hatch.

**Anti-pattern:** calling `gateKindForName` and accepting any kind it returns. Why: it would admit `bin/check` and FORMAT runners that rewrite files.
**Anti-pattern:** spawning with the shell and an unvalidated name. Why: the safe-name check is what makes the existing `shell: true` spawn safe.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose only gate declarations are executable script/test and bin/lint
When faff gates discover runs
Then discovery is confident, with a LINT rung ./bin/lint and a UNIT rung ./script/test, both [runner_file]
```

```
Given a repo with package.json script "test" and an executable script/test
When faff gates discover runs
Then the UNIT rung is "npm run test" and no runner_file UNIT rung appears
```

```
Given a repo with executable bin/test-unit and bin/test-e2e (each "#!/bin/sh" then "exit 0") and a CI workflow running node --test
When faff gates run executes
Then both runner rungs run and pass, the CI UNIT rung is not run, and the output lists "excluded (runner-covered): node --test"
```

- The rung `command` MUST match `^\./(script|scripts|bin)/[A-Za-z0-9][A-Za-z0-9._-]*$`.

## 6. DESIGN DECISION RATIONALE

- **Wildcard matcher: shared or source-local?** Shared: one rule everywhere, but changes existing pkg/Makefile/pre-commit ladders. Source-local: no blast radius. **Chosen:** source-local `runnerKindForName`, reusing `gateKindForName`'s vocabulary.
- **Suffix rule: bare wildcard or bounded?** Bare matches `latest`, `contest`, `splint`, which the ticket's acceptance criteria forbid. **Chosen:** bounded by separator or a closed qualifier list.
- **Prefix rule: bare wildcard or bounded?** Bounded would reject `testflight` but narrows the requested `test*`/`lint*` wildcard. **Chosen:** bare prefix, with `gates.exclude` and the executable bit as the mitigation.
- **`check`:** include (recall) or exclude (precision). **Chosen:** exclude.
- **Kinds:** all five or test and lint. **Chosen:** LINT and UNIT, per the ticket's scope; FORMAT runners often mutate files.
- **Extension and directory clashes:** run all or dedupe by stem. **Chosen:** dedupe by stem; extensionless first; `script/`, `scripts/`, `bin/`.
- **Cost rank vs `package.json`:** above or below. **Chosen:** below `package.json`, above CI (offset 2).
- **Windows:** attempt, or skip with a reason. **Chosen:** skip, `os-mismatch` exclusion; native support is a follow-up.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none. Every question the ticket listed is settled above.

**Assumptions**

- **Assumes:** `fs.accessSync(path, fs.constants.X_OK)` reports the executable bit on Linux and macOS for the running user. Validation: the POSIX selftest case with a `0644` fixture must yield no rung.

## 8. DONE

### From WHY
- [ ] A fixture with only executable `script/test` and `bin/lint` gives `discoverRungsReporting` discovery `confident`, a UNIT rung `./script/test` and a LINT rung `./bin/lint`.
- [ ] Faff's own repo: `discoverRungs`, `discoverRungsReporting` and `selectRunnableRungs` return the same rungs as before this change (existing `test/gates-ci-source.test.mjs` passes unchanged).

### From WHAT
- [ ] `runnerKindForName` returns UNIT for `testall`, `test-e2e`, `unittests`, `tests`, `run-tests`, `test-unit`; LINT for `linter`, `lint-js`, `lint`, `eslint`; null for `setup`, `rails`, `cibuild`, `latest`, `attestation`, `contest`, `splint`, `check`, `format`.
- [ ] Executable `scripts/lint.sh` gives a LINT rung with command `./scripts/lint.sh`.
- [ ] Rungs carry `source: "runner_file"`, `cost_rank` `GATE_COST[kind] + 2`, `required: true`, and the documented `name`.
- [ ] `bin/test` + `bin/test.sh` yields one rung, `./bin/test`; `script/test` + `bin/test` yields one rung, `./script/test`.
- [ ] Two runners of one kind (`bin/test-unit`, `bin/test-e2e`) both appear in reporting and execution; with `gates.max_rungs_per_kind: 1` only `./bin/test-e2e` (first in code-unit order) appears.
- [ ] A `package.json`, Makefile or pre-commit rung of the same kind suppresses all runner rungs of that kind; a runner rung suppresses all CI rungs of its kind; `discoverRungs` picks pkg over runner and runner over CI.

### From HOW
- [ ] Names with whitespace or shell metacharacters (`te st`, `test;rm`, `$(x)test`) produce no rung.
- [ ] A symlink resolving outside the repo produces no rung; a symlink resolving inside the repo to an executable file does.
- [ ] A non-executable `bin/test` (mode `0644`) produces no rung on POSIX.
- [ ] With `hostOs` `windows`, `selectRunnableRungs` emits no runner rung and records each matched candidate with reason `os-mismatch`.
- [ ] A `gates.exclude` pattern matching a runner command removes it with reason `configured`, and with `gates.max_rungs_per_kind: 1` plus an exclude matching `./bin/test-e2e`, the remaining rung is `./bin/test-unit` (an excluded runner takes no cap slot).
- [ ] In `selectRunnableRungs`, every CI rung dropped because a runner rung covers its kind appears in `exclusions` with reason `runner-covered`; a CI rung dropped because a pre-commit, `package.json` or Makefile rung covers its kind does not (today's behaviour).
- [ ] `runLadder` on the `script/test` + `bin/lint` fixture (bodies `#!/bin/sh` + `exit 0`) returns signal `pass` with both rungs `pass`; a runner exiting 1 gives signal `fail`.
- [ ] All the above are new `gates.js --selftest` cases; POSIX-only cases are guarded by `process.platform !== "win32"`.
- [ ] `docs/guide/cli.md` (the `gates` row) and `plugin/skills/faff-graft/SKILL.md` (Step 7.5 and Step 8 source lists) name runner files in `bin/`, `script/` and `scripts/` as a trusted source; `faff validate-adapters` passes.

**Integration smoke test**

```
1. mkdtemp repo; write script/test = "#!/bin/sh\nexit 0", bin/lint = same; chmod both 0755
2. faff gates discover --root <repo> --json  → discovery "confident", 2 rungs, source runner_file
3. faff gates run --root <repo>              → exit 0, signal pass
```

## Already shipped against this surface

- FAFF-533 (Done): CI-workflow source; this spec reuses its "local beats CI" penalty model.
- FAFF-848 / FAFF-849 (Done): reporting resolver and runnable selection with caps and exclusions; this spec joins both.
- FAFF-1149 (Done): `os-mismatch` and `not-runnable` exclusion reasons; reused for Windows.

None of them covers runner files, so the premise holds.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized (principle 4):** No issues. One discovery function, three resolver wire-ins, selftest cases and two doc list edits: a single 1 to 3 day unit. The decisions are tightly coupled (the matcher, dedup and cost rank all decide which rung wins), so splitting would leave half a source.
- **Workstream fit (principles 1 and 5):** No issues. The ticket is project-less Backlog, which is the default landing for newly captured work; it extends the same gate-ladder surface as FAFF-533, FAFF-848 and FAFF-849.
- **Surfaced dependencies (principle 6):** No issues. Every referenced ticket (FAFF-533, FAFF-848, FAFF-849, FAFF-1149) is Done, so no blocker link is missing. FAFF-1203 (an open gates bug about the UNIT rung's file pattern) touches the CI-sourced rung only and does not gate this work.
- **Risk profile (principle 7):** No issues. No external dependency or novel integration; the one real risk, false-positive wildcard matches, is bounded by the executable bit, the names-only rule and `gates.exclude`, made visible by the `runner-covered` exclusion, and named under Failure modes.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
