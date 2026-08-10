# Spec — FAFF-581: Test-coverage governance for the CLI selftest battery

> Spec: faffter-dark-nlspec · 2026-08-05 · autonomous · confidence: medium. Full spec on Linear FAFF-581.

This is the buildable spec for FAFF-581. Audience: the build agent implementing the change, and the human reviewers gating it. It covers wiring the destructive `worktree-prune` module into CI, retiring the hand-enumerated selftest list onto the registry-derived sweep, adding a fail-closed registry-coverage gate, and standing up zero-dependency coverage measurement (publish-only). Provenance: external adversarial critique 2026-07-21 (appendix row 9 + test-suite audit).

## 1. WHY — Problem and Principles

**The load-bearing model:** faff already owns a registry-derived selftest executor — `faff regions selftest --region governance|factory|all` (regions.js:750) spawns every member's `--selftest` argv straight from the `REGION_SELFTEST_ARGV` registry, with the map-completeness, registry-bijection, and stale-null drift checks built in. The whole failure in this ticket is that **CI only ever invokes the `governance` slice of that executor** and otherwise re-lists selftests by hand in YAML. So most of the fix is *pointing CI at machinery that already exists* — not building new machinery. The genuinely new work is a coverage *gate* (every command must be tested by something) and coverage *measurement* (a number, published).

**Problem statement.** `worktree-prune` — the module that DELETES git worktree state, written after the real 2026-06-12 clobber — is executed by nothing in CI: it is a `factory`-region member, CI sweeps only `governance`, and it appears in zero test files, so its prefix-collision ownership logic (`faff-12` must not claim `faff-126`) is unguarded. Compounding this, the CI selftest list is hand-enumerated (~65 YAML steps) with no registry-derived drift guard, `test/cli-coverage.test.mjs` advertises a "coverage" gate it does not implement (it is four spot-checks), and there is no coverage measurement at all across ~2,142 tests. This change routes CI through the existing registry sweep, adds a real fail-closed coverage gate, and plumbs a published coverage number.

**Design principle — registry is the single source of truth, never a hand-list.** Any executed-set or covered-set must be *derived from* `COMMANDS` / `REGION_MAP` / `REGION_SELFTEST_ARGV`, never a parallel hand-maintained enumeration. A guard that greps a file's own text for what it should run (today's macOS floor-count lane) inherits the exact blind spot it is meant to catch and is not acceptable as the drift defence. This is the same principle `lint-cli-doc` already enforces on the docs side.

**Design principle — the destructive module gets executed, not merely gated.** For `worktree-prune` specifically, "covered by a coverage gate" is insufficient; its `--selftest` must actually *run* in CI, because the value here is catching a regression in delete-selection logic, not proving a registry cell is filled.

**Design principle — zero runtime dependencies (ADR 0002).** There is no `package.json` by design. Coverage tooling that is an npm package (`c8`, `nyc`, `istanbul`) is disqualified. Anything added must run on stock Node 20 built-ins.

## 2. OUT OF SCOPE

- **Fixing `budget`'s state-sensitive selftest.** Tracked by FAFF-561.
- **Enforcing a coverage threshold / gating on the coverage number.** The number is published only. Extension point: the advisory step in `validate.yml` flips to `--enforce` against a calibrated baseline.
- **Retrofitting per-assertion coverage of the test-harness code itself.** Only the spawned `bin/faff` subject is measured.
- **Reviving `scripts/verify-split-parity.mjs`.** It stays a spent one-time migration artifact.
- **Adding selftests to the deliberate `no-selftest` commands.** `sync`, `validate-adapters`, `labels`, `state`, `doctor` carry `REGION_SELFTEST_ARGV[cmd] === null` by intent — covered by a test file instead.

## 3. WHAT — Vocabulary, Types, and Interfaces

The registry-coverage invariant (new gate):

```
INVARIANT registry_coverage:
  FOR every cmd IN Object.keys(COMMANDS):
    covered(cmd) == ( REGION_SELFTEST_ARGV[cmd] != null )
                    OR ( cmd IN TEST_FILE_COVERAGE )
  A cmd that is neither -> FAIL LOUD (exit non-zero), naming the uncovered command(s).
  A cmd in TEST_FILE_COVERAGE that is ALSO non-null selftest -> allowed (belt-and-braces).
  A cmd in TEST_FILE_COVERAGE that is NOT in COMMANDS -> orphaned -> FAIL LOUD (bidirectional).
```

**Chosen:** a new CLI subcommand `lint-cli-coverage` (sibling of `lint-cli-doc`, with its own `--selftest`) that diffs `COMMANDS` against `{ non-null selftest members } ∪ TEST_FILE_COVERAGE`, fails loud and bidirectional.

**cli-coverage.test.mjs:** rescope — retitle its header to "decision-logic spot-checks (NOT a coverage gate; see `lint-cli-coverage`)" and keep the four tests as-is.

## 4. HOW — Behavior

**Change 1 — wire the destructive module into CI immediately.** Add a CI step `faff regions selftest --region factory` so `worktree-prune --selftest` actually spawns. Wire on `--region factory`, not `--region all` (which is red-by-construction on `budget`/FAFF-561).

**Change 2 — retire the hand-list onto the registry sweep.** Replace the ~65 hand-enumerated `faff <cmd> --selftest` YAML steps with the registry-derived battery (interim: `--region factory` + `--region governance`, both preceded by `faff regions check`). Keep the non-selftest validations (`validate-adapters`, `lint-refs`/`lint-cli-doc` real runs, config-template parse, the ADR-tree run, `node --test`, the docker assertion). Retire the macOS floor-count grep AND explicitly re-point the macOS lane at the registry sweep (same battery, pure/no-docker, plus `evaluate-call.mjs --selftest`).

```
PROCEDURE ci_selftest_battery:
  1. run: faff regions check
  2. run: faff regions selftest --region factory   # carries change 1
  3. run: faff regions selftest --region governance
  4. non-zero exit on any member FAIL -> CI red
```

**Change 3 — the registry-coverage gate (build new).** New `lint-cli-coverage` subcommand per §3, wired as a CI step and given a `--selftest`. Enforces the `registry_coverage` invariant, fail-closed.

**Change 4 — coverage measurement, publish-only (build new, zero-dep).** Set `NODE_V8_COVERAGE=<shared dir>` at the single `runCli()` spawn seam so every spawned `bin/faff` child dumps V8 coverage JSON, then aggregate with a small zero-dependency Node script (reads the `coverage-*.json` dumps, sums covered/total per source under `bin/lib/`) and print the percentage to `$GITHUB_STEP_SUMMARY`. No gate on the number.

```
PROCEDURE coverage_publish:
  1. In runCli(): if process.env.NODE_V8_COVERAGE set, pass it through to the child spawn env.
  2. CI coverage step:
     a. mkdir a run-scoped dir; export NODE_V8_COVERAGE=<dir>
     b. run: node --test
     c. run the aggregator over <dir>/coverage-*.json -> bin/lib/*.js line/function %
     d. echo the percentage to $GITHUB_STEP_SUMMARY   # advisory, never fails the job
```

**Edge cases.**
- A `null`-selftest command not in `TEST_FILE_COVERAGE` -> Change 3 fails loud.
- `NODE_V8_COVERAGE` unset -> `runCli()` passes nothing; identical to today. Aggregator on empty dir -> `0%`/`n/a`, exit 0, never throws.
- A member selftest times out -> `regionsSelftestRun` renders FAIL; CI red.

## 8. DONE — Definition of Done

### From WHY
- worktree-prune --selftest is executed by CI on every validate run.
- No executed-set or covered-set in CI is a hand-maintained enumeration.

### From WHAT (gate + framing)
- A new lint-cli-coverage CLI subcommand exists, has a --selftest, and is wired as a CI step.
- The gate fails loud and non-zero when a COMMANDS entry is neither non-null-selftest nor in TEST_FILE_COVERAGE, naming the command(s).
- The gate fails loud on a TEST_FILE_COVERAGE entry that is not a COMMANDS key (orphaned side).
- test/cli-coverage.test.mjs header no longer claims to be a coverage gate; four tests still pass.

### From HOW (CI wiring)
- validate.yml runs the registry sweep (--region factory + --region governance) and contains no per-command faff <cmd> --selftest steps for registry commands.
- worktree-prune --selftest runs green in CI on the --region factory step.
- The macOS floor-count grep is removed AND the macOS lane is re-pointed at the same sweep battery plus evaluate-call.mjs --selftest.
- faff regions check runs in CI ahead of the sweep.
- A new factory command with a failing --selftest makes CI red with no edit to validate.yml.
- A follow-up is recorded to collapse into a single --region all step once FAFF-561 clears budget.

### From HOW (coverage measurement)
- runCli() passes NODE_V8_COVERAGE through to the spawned child env when set, at that single seam only.
- A zero-dependency aggregator (stock Node only) reads coverage-*.json dumps and computes a percentage over bin/lib/*.js.
- The percentage is written to $GITHUB_STEP_SUMMARY; the job passes regardless of value.
- With NODE_V8_COVERAGE unset, node --test behaves exactly as today and the aggregator on an empty dir exits 0.

### From HOW (edge cases)
- A null-selftest command missing from TEST_FILE_COVERAGE fails the coverage gate.
- A timed-out member selftest is reported failed by the sweep and reddens CI.

confidence: medium
spec-review: approve