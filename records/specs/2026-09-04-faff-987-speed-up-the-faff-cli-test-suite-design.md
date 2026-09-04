# FAFF-987: Speed up the faff CLI test suite on CI (shard / parallelise the ~10-minute run)

> Spec: faffter-dark-nlspec · 2026-09-04 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-987.
> build-tier: complex

_Revised 2026-09-04 — resolved the open shard-count decision (Chosen: N = 4) and verified all three assumptions against authoritative sources; confidence lifted medium → high._

This is the buildable spec for FAFF-987. Its audience is the build agent that will edit `.github/workflows/validate.yml` and the CI test invocation, plus the human reviewer signing off the CI-topology change. The deliverable is a faster CI run of the `node --test` suite, achieved by splitting the run off its own long job, sharding it across parallel matrix jobs, and removing the two largest fixed costs it carries today. No test bodies change behaviour; the win comes from how and where the suite is invoked.

## 1. WHY: Problem and principles

**The load-bearing model.** `node:test` runs each `*.test.mjs` FILE in its own child process, and runs multiple files concurrently up to a bound set by the runner's core count (`os.availableParallelism()`). The whole-suite wall time is therefore governed by three things: how many files there are (231), the per-file fixed cost paid before any test body runs (Node cold-start plus the `--import` preload, roughly 2s each), and how many CPU cores the runner has to spread that cost across. The single `validate` job today runs all 231 files on one runner, at the tail of ten other gate steps, with real Docker container standups mixed in. Speeding it up means spreading the files across more cores (more jobs, each an independent process pool) and cutting the fixed costs that every core still has to pay.

**Problem statement.** The `validate` job runs the entire tree unsharded in one process pool as `node --import ./test/hermetic-env.mjs --test` (no path arg, so Node discovers recursively from the repo root), observed at ~517s and sitting behind ten earlier gate steps, which makes it the long pole in every PR's CI and the root cause behind FAFF-984 (the gates UNIT-rung timeout misclassifying a green-but-slow suite). This change moves the suite onto its own matrixed job, shards the files across parallel runners, and drops the two heaviest fixed costs it carries (real Docker container standups already covered elsewhere, and files swept in from outside `test/`), so the suite's critical-path CI wall falls materially.

**Design principle: parity with the canonical local invocation.** `CONTRIBUTING.md` documents the canonical run as `node --import ./test/hermetic-env.mjs --test test/` (scoped to `test/`), but CI runs it pathless. Any invocation this spec introduces on CI must be reconcilable with the documented canonical form: CI should run the same file set a contributor runs locally, not a superset. Diverging the two is what let the `records/spikes` files leak into CI in the first place.

**Design principle: never weaken an existing fail-loud guarantee.** FAFF-274 set `FAFF_REQUIRE_DOCKER=1` on the Docker-carrying lanes so a Docker-gated test fails loudly instead of silently self-skipping. Any decision that moves Docker-gated tests off a lane must show the fail-loud guarantee is still held by another required lane, not merely that the tests "still run somewhere".

**Design principle: measured before and after, not asserted.** The ticket's success is a wall-clock reduction. The change must carry a measurement method (a before number and an after number, from the same source) so the improvement is a number a reviewer can read off CI, not a claim.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` | GitHub Actions YAML | The three jobs (`validate`, `validate-macos`, `env-rootless`); the file this change edits |
| `test/hermetic-env.mjs` | JavaScript (ESM) | 33-line `--import` preload; scrubs `FAFF_*`/`CLAUDE_*` once in the parent. Not a per-test cost, not a serialiser |
| `test/helpers/run-cli.mjs` | JavaScript (ESM) | `runCli()` = `spawnSync("node",[faffBin,...])`, a fresh Node cold-start per call; ~866 call sites across 73 files; also the single `NODE_V8_COVERAGE` passthrough seam |
| `test/env.test.mjs` | JavaScript (ESM) | ~73s; 4 Docker-gated integration tests (postgres/redis/minio/mongo) plus a real Node+Postgres app-tier build; the single biggest sink |
| `test/holdout-evaluate-integration.test.mjs` | JavaScript (ESM) | The other real-container-standup file (hashicorp/http-echo); Docker-gated |
| `scripts/coverage-aggregate.mjs` | JavaScript (ESM) | Rolls up a directory of V8 coverage JSONs into the advisory coverage number (FAFF-581); reads `NODE_V8_COVERAGE` or `--dir` |
| `plugin/skills/faff/bin/lib/gates.js` | JavaScript (ESM) | Discovers the CI `node … --test` line verbatim (`extractRunCommands`, one candidate per physical `run:` body line) and runs it as the local UNIT rung via `spawnSync(shell:true)`; `rung_timeout_ms` default 30 min (FAFF-984). Edited here: the derived local rung must stay runnable once the CI command is sharded |

**Scope.** This is a CI-topology and invocation change to `.github/workflows/validate.yml` (plus a possible small probe/measurement addition). It does not change any test body, the `runCli` helper, or the hermetic preload.

## 2. OUT OF SCOPE

- **Rewriting `runCli()` to avoid per-call Node cold-start.** Why excluded: ~866 call sites across 73 files depend on the current `spawnSync("node", …)` seam and its exact `{ stdout, stderr, code }` contract; converting to in-process invocation is a large, separately-riskable change that would dwarf this ticket. Extension point: a follow-up ticket against `test/helpers/run-cli.mjs`, informed by the profiling deliverable this ticket produces (see DONE: profiling).
- **Cutting the ~2s per-file baseline (cold-start + `--import` + module graph).** Why excluded: it is inherent to `node:test`'s process-per-file model and is attacked here only indirectly, by spreading files across more cores. A structural cut (fewer, larger files; a persistent worker) is a design change of its own. Extension point: the same profiling follow-up.
- **The ~10.5s of real (non-mocked) `setTimeout` waits across ~20 sites.** Why excluded: individually small and spread across many files; folding them in would broaden this ticket from a CI-topology change into a test-body sweep. Extension point: a follow-up that mocks or shortens those specific waits, enumerated by the profiling deliverable.
- **`validate-macos` and `env-rootless`.** Why excluded: they already run targeted subsets (14 impure files; `test/env.test.mjs` + `test/holdout-evaluate-integration.test.mjs`), not the whole tree, and are not the long pole. Extension point: if either grows into a long pole later, the same sharding pattern applies.
- **Changing the gates UNIT rung's timeout or execution semantics (`gates.js` `runLadder`/`rung_timeout_ms`).** Why excluded: FAFF-984 already raised the timeout to 30 min; this ticket makes the underlying run faster, which is the real fix. Note this is distinct from the small gates-discovery normalisation this ticket DOES bring in scope (so the local rung derived from a sharded CI command stays runnable: see the decision below); that is a discovery-parsing change, not a change to what the rung does once formed.
- **Raising the advisory coverage number to an enforcing gate.** Why excluded: that is an explicit FAFF-581 Punt (a separate QA decision); this ticket must only preserve the number's continued publication under sharding, not change its gating status.

## 3. WHAT: approach, decisions, and CI shape

### Vocabulary

| Term | Definition |
|---|---|
| Shard | One of N parallel matrix jobs, each running a disjoint subset of the test files via Node's `--test-shard=<i>/<N>` |
| Critical-path wall | The wall-clock of the slowest single shard job, since shards run in parallel; the number this ticket reduces |
| Fixed cost | Per-file overhead paid before any test body runs (Node cold-start + `--import` + module graph), roughly 2s per file |
| Real standup | A test that starts an actual Docker container (postgres/redis/minio/mongo/http-echo), as distinct from a compose-gen unit test that only generates and asserts on YAML |

### CI shape: target topology

```
BEFORE (one long job):
  validate (ubuntu):  [10 gate/lint steps] -> [assert docker] -> [node --test WHOLE TREE, ~517s] -> [publish coverage]
  validate-macos:     test/impure/*.test.mjs (unchanged)
  env-rootless:       env.test.mjs + holdout-evaluate-integration.test.mjs on rootless daemon (unchanged)

AFTER (gates once, tests sharded 4-way in parallel):
  validate (ubuntu):  [10 gate/lint steps]           <- no longer runs the suite
  unit (ubuntu, matrix shard=1..4):                    <- new job, 4 parallel runners
     node --import ./test/hermetic-env.mjs --test --test-shard=<i>/4 test/
     each shard uploads its V8 coverage dir as an artifact
  coverage-report (ubuntu, needs: unit):               <- aggregates the 4 artifacts, publishes the advisory number
  validate-macos:     unchanged
  env-rootless:       unchanged (now the SOLE home of real Docker standups)
```

### Key decisions

**Shard across matrix jobs, and keep in-process concurrency at Node's default within each shard.** Two speed levers exist: more parallel jobs (`--test-shard`), and more concurrent files per job (`--test-concurrency`). Sharding across jobs is the dominant lever because it adds whole CPUs (each runner is a fresh 4-core box), whereas raising `--test-concurrency` past the runner's core count only oversubscribes the cores already present and tends to slow a spawn-heavy suite (every file forks `runCli` children of its own). Node's default concurrency (`availableParallelism() - 1`) already saturates a shard's cores. **Chosen:** shard the run with `--test-shard=<i>/4` across the matrix jobs; leave `--test-concurrency` at its default within each shard (do not raise it). Merge/report: each shard is an independent required status check, so GitHub's required-checks gate ANDs them for pass/fail with no result-merging step needed; the only cross-shard aggregation is the advisory coverage number (decided below).

**Shard count N = 4.** **Chosen:** run the `unit` matrix at **N = 4** shards. Rationale, from the now-verified facts: the GitHub-hosted `ubuntu-latest` standard runner is **4 vCPUs / 16 GB** (public repos), so N = 4 gives ~16-way effective parallelism (4 shards × ~3 concurrent files each at the `availableParallelism()-1` default) over ~58 files per shard. Against the ~517s single-job baseline, the shardable test work drops to ~130s per shard; adding the ~40s of un-shardable per-job checkout + `setup-node` overhead gives an estimated slowest-shard wall of ~170s, just under the 180s target. N = 4 is the clean match to the runner's core count; going higher (6/8) buys diminishing returns because the ~40s setup floor and rising concurrent-runner cost dominate, and going lower (3) likely misses the target. **Revisit rule:** if the first real green run's slowest shard exceeds 180s, raise N to 6 (the spec's tuning lever), guided by the profiling ratio below.

**Split the suite off `validate` into its own matrixed `unit` job.** The suite runs today as the last step of a job that first runs ten gate/lint steps, so its cost is added to theirs on the critical path, and matrixing the whole `validate` job would re-run those ten steps N times (wasteful). **Chosen:** move the `node --test` step out of `validate` into a new dedicated `unit` job carrying `strategy.matrix.shard`; leave the cheap gate/lint steps in `validate`, run once. This both removes the suite from the tail of the long job and lets the shards start in parallel with the gate steps.

**Real Docker standups live only on `env-rootless`; the sharded `unit` job has no reachable daemon.** `test/env.test.mjs` (~73s, the single biggest sink) and `test/holdout-evaluate-integration.test.mjs` are the only two files that start real containers, and both already run on `env-rootless` with `FAFF_REQUIRE_DOCKER=1` (which holds the FAFF-274 fail-loud guarantee for them). Running them again on the main lane re-proves nothing and pays the ~73s twice. The other two files that merely reference `FAFF_REQUIRE_DOCKER` (`test/hermetic-env.test.mjs`, `test/holdout-exercise-headers.test.mjs`) assert on the variable's presence and do not start containers.

The gating mechanism matters and is easy to get wrong. Both container files decide to run by probing `docker info` (`env.test.mjs`: `const DOCKER = dockerAvailable()` where `dockerAvailable` runs `execFileSync("docker",["info"])`; `holdout-evaluate-integration.test.mjs`: `SKIP = spawnSync("docker",["info"]).status === 0 ? false : "docker unavailable"`). The skip rule in `env.test.mjs` is `skipIntegration = DOCKER ? false : REQUIRE_DOCKER ? false : "docker unavailable"`, so a test runs whenever Docker is **present**, regardless of `FAFF_REQUIRE_DOCKER`. GitHub-hosted `ubuntu-latest` runners have Docker installed and running, so merely leaving `FAFF_REQUIRE_DOCKER` unset would NOT skip these tests: they would still stand up containers on the `unit` lane. **Chosen:** the `unit` job makes Docker unreachable by setting `DOCKER_HOST` to a dead socket (the repo's own idiom, `unix:///nonexistent/faff987.sock`, mirroring the `unix:///nonexistent/faff371.sock` dead-daemon simulation already in `env.test.mjs`) and does not set `FAFF_REQUIRE_DOCKER`. Then `docker info` fails fast (ENOENT on a missing socket, not a 30s timeout), `DOCKER`/`SKIP` resolve to unavailable, and every Docker-gated case self-skips. `env-rootless` (a real rootless daemon, `FAFF_REQUIRE_DOCKER=1`) remains the sole required home of real standups, so the fail-loud guarantee is preserved. Compose-gen unit tests are unaffected: they pass their own per-call `DOCKER_HOST` via the `runEnv` helper, which overrides the job-level value.

**Scope the CI invocation to `test/`, matching the canonical local run.** The pathless `node --test` discovers two stray files under `records/spikes/2026-07-10-faff-411/` (`tier.test.mjs`, `promote_decision.test.mjs`) that are spike artefacts, not suite members, and `CONTRIBUTING.md` already documents the canonical run as `--test test/`. **Chosen:** add the `test/` path arg to the CI invocation (on the `unit` shards), which excludes `records/spikes` by construction and reconciles CI with the documented canonical invocation. This is a prerequisite for stable sharding: `--test-shard` splits the discovered file set, so the set must be the intended one.

**Preserve the advisory coverage number by aggregating per-shard artifacts.** FAFF-581 folds `NODE_V8_COVERAGE` into the single run and publishes an advisory (never-gating) number via `scripts/coverage-aggregate.mjs`, which rolls up a whole directory of V8 JSONs. Under sharding, each shard produces a partial coverage directory. Because the aggregator already reads a directory of many JSONs, the shards compose cleanly. **Chosen:** each `unit` shard sets `NODE_V8_COVERAGE` to a shard-local dir and uploads it as a build artifact; a dependent `coverage-report` job (`needs: unit`) downloads all shard artifacts into one directory and runs the existing aggregator unchanged. Fallback if artifact plumbing proves heavy: since the number never gates, each shard may instead publish its own partial number to its step summary and the combined number is dropped for now (documented, not silent). The artifact-aggregate path is chosen; the fallback is the named degradation, not an open question.

**Keep the local gates UNIT rung runnable after sharding the CI command.** `plugin/skills/faff/bin/lib/gates.js` discovers the CI `node … --test` line verbatim via `extractRunCommands` (one candidate per physical `run:` body line, surrounding quotes stripped) and runs it locally as the UNIT rung with `spawnSync(shell:true)`. If the only discoverable `node --test` line becomes the sharded form, the derived local rung inherits `--test-shard=<value>`; a value carrying an unexpanded `${{ matrix.shard }}` expression is a bash bad-substitution locally, and even an env-var form (`$SHARD/$SHARD_TOTAL`) resolves to an invalid shard (`/`) when those vars are unset on a dev box, so the local UNIT rung fails: re-opening the neighbourhood FAFF-984 addressed. Locally there is no matrix; the right local behaviour is to run the whole suite unsharded. Per the repo's no-manual-workaround principle (fix the automation, not paper over it), the fix belongs in discovery, not in a hand-maintained duplicate command. **Chosen:** bring a minimal gates-discovery normalisation into scope: when forming the local rung from a discovered UNIT command, strip a `--test-shard=…` argument (including a value that spans a `${{ … }}` expression) so the local rung runs `node --import ./test/hermetic-env.mjs --test test/`: the whole suite, once. Corollary constraint on the workflow: keep the `node … --test … test/` invocation on a single physical line, because `extractRunCommands` splits a block scalar per line and a backslash-continued command would be discovered in fragments.

**The deep per-test fixed-cost cuts are deferred, and this ticket produces the profile that scopes them.** The ticket names "profile & cut hot-file and per-test fixed cost" as a goal. The cheap, low-risk cuts (stray files, the ~73s Docker sink) are done here. The expensive cuts (the `runCli` cold-start seam, the ~2s/file baseline, the ~10.5s of real `setTimeout` waits) are structural and out of scope for this ticket's low-risk CI change. **Chosen:** produce a profiling artefact as a DONE deliverable: the sum of per-file `duration_ms` versus the run's wall `duration_ms`, and a ranked list of the slowest files, and defer the actual seam/baseline cuts to a named follow-up ticket that consumes that profile. This keeps this ticket a bounded CI-topology change while still discharging the "profile" half of the goal.

### Resolved decisions and verified external facts (detailed in section 7)

- **Chosen: shard count N = 4** — matches the verified 4-vCPU `ubuntu-latest` runner; estimated slowest-shard wall ~170s vs the 180s target; revisit to 6 if the first real run misses it.
- **Assumes (verified): the pinned `node-version: 20` supports `--test-shard` and `--test-concurrency`.** `--test-shard` added in Node v20.5.0, `--test-concurrency` in v20.10.0 — both below the latest 20.x the pin resolves to.
- **Assumes (verified): GitHub-hosted `ubuntu-latest` standard runner = 4 vCPUs / 16 GB** on public repos.
- **Assumes (verified): `env-rootless` runs both container files with `FAFF_REQUIRE_DOCKER=1`** (confirmed at `validate.yml:258-259`).

## 4. HOW: behaviour

### Architecture and approach

The change is entirely in `.github/workflows/validate.yml`. Three edits, in order of dependency:

```
PROCEDURE restructure_validate_workflow:
  1. In job `validate`: DELETE the two suite steps
     - "Run skill/CLI behaviour tests (node:test), with coverage capture"
     - "Publish CLI coverage number"
     Keep every gate/lint step and the "Assert docker present" step ONLY IF another
     step in `validate` still needs docker; if none does, remove that assert too
     (its guarantee moves to env-rootless, see failure modes).
  2. ADD job `unit`:
     runs-on: ubuntu-latest
     strategy:
       fail-fast: false          # one red shard must not cancel the others' signal
       matrix:
         shard: [1, 2, 3, 4]      # N = 4 (Chosen: matches the 4-vCPU runner)
     steps:
       - checkout; setup-node@v4 with node-version: 20
       - env:
           NODE_V8_COVERAGE: <runner.temp>/v8-coverage-shard-<shard>
           DOCKER_HOST: "unix:///nonexistent/faff987.sock"   # dead daemon -> docker-gated tests self-skip
           # FAFF_REQUIRE_DOCKER is NOT set here (Chosen: real standups live only on env-rootless)
         run: |
           mkdir -p "$NODE_V8_COVERAGE"
           # single physical line: gates' extractRunCommands splits a block scalar per line
           node --import ./test/hermetic-env.mjs --test --test-shard=${{ matrix.shard }}/4 test/
       - upload-artifact: name coverage-shard-<shard>, path <the v8-coverage dir>
  3. ADD job `coverage-report`:
     runs-on: ubuntu-latest
     needs: unit
     if: always()                # publish even if a shard failed, like the old always() step
     steps:
       - download all coverage-shard-* artifacts into one dir
       - run: node scripts/coverage-aggregate.mjs --dir <that dir> | tee -a $GITHUB_STEP_SUMMARY
```

The gates-discovery normalisation lives in `gates.js` where the local rung command is formed:

```
PROCEDURE local_unit_rung_command(discovered_ci_command):
  1. Take the discovered UNIT command string (e.g.
     "node --import ./test/hermetic-env.mjs --test --test-shard=1/4 test/" or the
     unexpanded "…--test-shard=${{ matrix.shard }}/4 test/").
  2. Remove the "--test-shard=" argument and its value, where the value runs to the
     next top-level whitespace that is NOT inside a "${{ … }}" expression (so the
     removal spans the spaces inside an unexpanded matrix expression).
  3. Return the cleaned command; it now runs the whole suite unsharded, locally.
  # Only the local rung is normalised; CI still runs the sharded command as written.
```

`--test-shard=<i>/4` splits the discovered file set deterministically (Node sorts files then assigns file k to shard `k mod 4`), so shards are disjoint and every file lands on exactly one shard. Because `node:test` isolates each file in its own child process, cross-file parallelism within a shard is process-isolated: process-global mutations such as the `process.chdir` in `test/models-config.test.mjs` and `test/redact.test.mjs` cannot leak between files. That process-per-file isolation is the reason no serialisation or fixed-port blocker exists (temp dirs are per-call `mkdtemp`, test HTTP servers bind port 0).

### Measurement method (the before/after number)

```
PROCEDURE measure_speedup:
  BEFORE (already observed): the current single `validate` suite step wall ~= 517s,
          read from the job timing / the run's final `# duration_ms` summary line.
  AFTER:  the critical-path wall = MAX over the 4 shards of each `unit` shard job's
          wall-clock (shards run in parallel, so the slowest one governs).
  PROFILE (DONE deliverable): on one representative run, capture
          sum(per-file duration_ms) vs the run's wall duration_ms, and the ranked
          slowest files, from the node:test reporter output. This quantifies how
          much of the wall is fixed per-file cost vs test bodies, and scopes the
          deferred follow-up (and confirms/revises N per the revisit rule).
  SUCCESS: the after critical-path wall is materially below the before ~517s.
           Target below, in Scenarios, is a concrete threshold; the profile
           explains any shortfall.
```

### Edge cases and error handling

- **A shard has zero files** (N chosen larger than useful): the shard runs, discovers no files for its index, exits 0. Harmless but wasteful; at N = 4 over 231 files every shard carries ~58 files, so this does not arise here.
- **`fail-fast: false` is required** on the matrix: with the default `fail-fast: true`, one red shard cancels the siblings, hiding whether other shards were green and destroying the parallel signal. Set it false.
- **Coverage artifact missing for a failed shard**: `coverage-report` runs `if: always()` and aggregates whatever artifacts exist; a missing shard dir yields a partial number, never a job failure (coverage never gates).
- **`records/spikes` re-appearing**: only prevented by the `test/` path arg. If a future edit drops it, the stray files return; the DONE check asserts the arg is present.

### Failure modes: how this approach could be wrong, and how you'd notice

- **The failure: the `unit` lane silently loses Docker coverage while looking green.** Two ways this bites. First, if the dead-`DOCKER_HOST` trick is omitted, the container tests RUN on the `unit` lane (ubuntu-latest has Docker), so the ~73s sink stays and the speed-up under-delivers. Second, if `env-rootless` were later narrowed or its `FAFF_REQUIRE_DOCKER` removed, Docker-gated tests would self-skip everywhere and pass green while testing nothing: the silent-skip hole FAFF-274 closed. **How you'd know:** first case: a `unit` shard log shows a container standup or the shard wall stays high; second case, `env-rootless` is a required check that asserts a rootless daemon and runs both container files with `FAFF_REQUIRE_DOCKER=1`, so a regression reddens it. DONE checks cover both: the `unit` job sets the dead `DOCKER_HOST`, and `env-rootless` retains the variable and both files. **What it means:** proceed: the guarantee is held by an existing required lane; the guards assert neither lane drifts.
- **The failure: sharding does not actually reduce wall time because the fixed per-file cost dominates and N = 4 is too small.** If most of the 517s is Node cold-start summed over 231 files rather than test bodies, then quartering the file count per shard roughly quarters that shard's test work, but the ~40s setup floor and a too-small N leave each shard still large. **How you'd know:** the profiling deliverable's sum(per-file duration_ms) vs wall ratio, and the after critical-path wall against the 180s target. If sum-of-fixed-cost is the bulk and the after number misses the target, apply the revisit rule (raise N to 6) or escalate the deferred fixed-cost follow-up. **What it means:** narrow: a null result here is a valid signal that the baseline cut, not more sharding, is the dominant remaining cost.
- **The failure: the local gates UNIT rung breaks on the sharded CI command.** If the discovery normalisation is not applied, `faff gates run` (used by `faff graft`) discovers the sharded line and runs it locally, where the shard value is invalid (unexpanded `${{ … }}` or unset env vars), so the UNIT rung errors on every graft. **How you'd know:** a local `faff gates run` shows the UNIT rung failing with a shell bad-substitution or a Node invalid-`--test-shard` error, not a test failure. **What it means:** proceed only with the normalisation shipped; a test asserting the derived local rung command is the unsharded whole-suite command is the guard (DONE below).
- **The failure: `--test-shard` support is absent or unstable on the pinned Node 20.x.** The flags exist in current Node, but the CI pin is `node-version: 20` (a floating 20.x). **How you'd know:** the `unit` job errors on an unknown flag, or produces non-disjoint/empty shards. **What it means:** abandon the shard flag and fall back to file-glob partitioning in the matrix (each shard runs an explicit file subset), or bump the Node pin; the validation step in Assumptions catches this before merge.

### Anti-patterns

- **Anti-pattern:** raising `--test-concurrency` above the runner core count to "go faster". Why: the suite is spawn-heavy (each file forks `runCli` children), so oversubscribing cores increases contention and typically slows the run; add cores via more shards instead.
- **Anti-pattern:** matrixing the whole `validate` job so the ten gate/lint steps re-run per shard. Why: it multiplies fixed CI cost by N for no benefit; split the suite into its own job so the gates run once.
- **Anti-pattern:** keeping the CI invocation pathless "to match today". Why: pathless discovery is exactly what sweeps in `records/spikes`; the canonical documented run is `--test test/`, and sharding needs a stable, intended file set.
- **Anti-pattern:** merging shard pass/fail with a custom aggregation step. Why: GitHub required-checks already ANDs independent jobs; a custom merge adds a failure surface for no gain. Only coverage (advisory) needs cross-shard aggregation.

## 5. Scenarios: born-verifiable main objectives

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the validate workflow with the suite split into a 4-way sharded `unit` job
When a PR triggers CI
Then the suite runs as `node --import ./test/hermetic-env.mjs --test --test-shard=<i>/4 test/`
     across 4 parallel `unit` matrix jobs, and every one of the 231 `test/*.test.mjs`
     files is executed by exactly one shard (union of shards == the full test/ set)
```

```
Given the sharded `unit` job set
When all shards pass
Then the critical-path wall (the slowest single shard's job wall-clock) is materially
     below the observed ~517s single-run baseline
```

- The critical-path wall for the `unit` matrix (max shard job wall-clock) MUST be at most 180s on a green run. (Non-functional target; if the pre-merge run misses it, the profiling deliverable must explain the shortfall and N is raised to 6 per the revisit rule.)

```
Given the CI invocation now carries the `test/` path arg
When Node discovers test files
Then the two files under records/spikes/2026-07-10-faff-411/ are NOT executed by any shard
```

```
Given the CI validate workflow now shards the node --test command
When `faff gates run` forms the local UNIT rung from the discovered command
Then the local rung is the unsharded whole-suite command
     (`node --import ./test/hermetic-env.mjs --test test/`, no --test-shard),
     and it runs to completion instead of erroring on an invalid shard value
```

```
Given all 4 `unit` shards have completed
When the coverage-report job runs
Then it aggregates every shard's uploaded V8 coverage directory via
     scripts/coverage-aggregate.mjs and publishes a single advisory number that
     never gates the build
```

## 6. Design decision rationale

**How to add parallelism: shard-across-jobs, raise in-process concurrency, or both?**
- Shard across matrix jobs: adds whole CPUs (each runner is a fresh box); strong lever; needs `--test-shard` and a coverage-merge story.
- Raise `--test-concurrency` within one job: no extra runners; but the box's cores are already near-saturated at the default, and the suite is spawn-heavy, so oversubscription tends to slow it.
- Both: combines the above; the concurrency half adds little once sharding gives each shard a full core budget.
- **Chosen:** shard across matrix jobs, leave in-process concurrency at Node's default. Rationale: the dominant cost is fixed per-file overhead summed over 231 files; the only way to genuinely reduce it is to spread files over more physical cores, which more jobs provide and a higher concurrency number on one box does not.

**How many shards (N)?**
- N = 3: ~77 files/shard, fewest runners, but est. ~215s slowest shard — likely misses the 180s target.
- N = 4: ~58 files/shard, matches the 4-vCPU runner, est. ~170s — just under target.
- N = 6/8: more headroom (~130s/~105s) but the ~40s setup floor and rising concurrent-runner cost give diminishing returns.
- **Chosen: N = 4** — the clean match to the verified 4-vCPU runner that meets the target with the least concurrent-runner cost; revisit to 6 if the first real run's slowest shard exceeds 180s.

**Where does the suite run: still inside `validate`, or its own job?**
- Inside `validate`: fewer jobs, but the suite stays at the tail of ten gate steps and matrixing re-runs those steps N times.
- Its own `unit` job: gate steps run once, shards start in parallel, suite decoupled from the gate tail.
- **Chosen:** a dedicated matrixed `unit` job; the gate/lint steps stay in `validate` and run once.

**Do the real Docker standups stay on the main run?**
- Keep them: preserves the current single-lane fail-loud posture, but pays ~73s on the critical path and duplicates `env-rootless`.
- Drop them from the main run: removes the biggest sink; safe only because `env-rootless` already runs both container files with `FAFF_REQUIRE_DOCKER=1`.
- **Chosen:** drop them from the `unit` lane by making Docker unreachable there (dead `DOCKER_HOST`, `FAFF_REQUIRE_DOCKER` unset), so every Docker-gated case self-skips; `env-rootless` is the sole required home of real standups. Rationale: no coverage is lost (env-rootless holds it), the ~73s sink leaves the critical path, and the FAFF-274 guarantee is retained on a required lane. Note the mechanism is the dead socket, not the env var alone: because the tests gate on `docker info` succeeding, and ubuntu-latest has a live daemon, unsetting the var is not enough.

**Pathless discovery or scope to `test/`?**
- Pathless: matches today's CI, but sweeps in `records/spikes` and diverges from the documented canonical run.
- Scope to `test/`: excludes spikes, matches `CONTRIBUTING.md`, gives sharding a stable intended file set.
- **Chosen:** scope to `test/`.

**Coverage under sharding: aggregate artifacts, or drop the combined number?**
- Aggregate per-shard artifacts in a dependent job: preserves the FAFF-581 whole-repo number; the existing aggregator already reads a directory of many JSONs, so shards compose.
- Drop to per-shard partial numbers: simplest, but loses the single repo number.
- **Chosen:** aggregate per-shard artifacts in a `coverage-report` job; the per-shard-partial path is the named fallback if artifact plumbing proves heavy, not a silent loss.

**Keeping the local gates rung runnable: normalise in discovery, duplicate a command, or split it out?**
- Normalise in gates discovery (strip `--test-shard` when forming the local rung): one small change, keeps a single source of truth for the CI command, matches the no-manual-workaround principle.
- Keep a second, non-sharded `node --test` line somewhere for gates to prefer: fragile, gates discovers all such lines and dedups by kind in a read-order-dependent way, so which rung wins is not stable.
- Split the gates change into a separate ticket, ship FAFF-987 CI-only: leaves `faff graft`'s gates broken between the two merges.
- **Chosen:** normalise in gates discovery, in scope for this ticket. Rationale: it is the only option that keeps the CI command single-sourced and does not leave graft's gates broken; the change is small and testable.

**Deep fixed-cost cuts now or follow-up?**
- Now: attacks the ~2s/file baseline and the `runCli` cold-start, the largest remaining cost after sharding; but it is a 866-call-site change, high-risk, and dwarfs a CI-topology ticket.
- Follow-up, scoped by a profile: keeps this ticket bounded and low-risk while still discharging the "profile" half of the goal.
- **Chosen:** defer the cuts; produce the profiling artefact here as the input to a named follow-up. At the time of writing the repo is deliberately dependency-free (ADR-0002, no package.json / no third-party test framework), so any baseline cut must stay within node:test and node:child_process: worth restating when the follow-up is scoped.

## 7. Resolved decisions and verified assumptions

### Resolved decisions

- **Chosen: shard count N = 4. (decides: architecture)** Resolved 2026-09-04 (human decision). The GitHub-hosted `ubuntu-latest` standard runner is 4 vCPUs / 16 GB, so N = 4 gives ~16-way effective parallelism over ~58 files per shard, an estimated slowest-shard wall of ~170s (≈130s shardable test work + ≈40s un-shardable checkout/setup) against the 180s target. **Revisit rule:** if the first real green run's slowest shard exceeds 180s, raise N to 6, guided by the profiling ratio.

### Verified assumptions (previously open; now confirmed against authoritative sources)

- **Assumes (verified): the pinned `node-version: 20` supports `--test-shard=<i>/<N>` and `--test-concurrency`.** `--test-shard` was added in Node **v20.5.0** and `--test-concurrency` in **v20.10.0** ([Node.js v20.x CLI docs](https://nodejs.org/docs/latest-v20.x/api/cli.html)); the `node-version: 20` pin resolves to the latest 20.x on the runner, well past both. No fallback to file-glob partitioning is needed.
- **Assumes (verified): the GitHub-hosted `ubuntu-latest` standard runner is 4 vCPUs / 16 GB** on public repositories ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). This is the number N = 4 is tuned against; an optional one-line `nproc` probe in the `unit` job can confirm it on the first run.
- **Assumes (verified): `env-rootless` runs both `test/env.test.mjs` and `test/holdout-evaluate-integration.test.mjs` with `FAFF_REQUIRE_DOCKER=1`.** Confirmed at `.github/workflows/validate.yml:258-259`. This is what makes dropping the container tests from the `unit` lane safe (the fail-loud guarantee stays on a required lane).

## 8. DONE: definition of done

### From WHY
- [ ] The `node --test` suite no longer runs as a step inside the `validate` job; `validate` runs only the gate/lint steps.
- [ ] The suite's critical-path CI wall (max shard job wall-clock) is measurably below the ~517s single-run baseline, with both numbers readable from CI.

### From WHAT (CI shape and decisions)
- [ ] A new `unit` job exists with `strategy.matrix.shard: [1, 2, 3, 4]` and `fail-fast: false`.
- [ ] Each `unit` shard invokes `node --import ./test/hermetic-env.mjs --test --test-shard=${{ matrix.shard }}/4 test/` (path-scoped to `test/`, sharded 4-way).
- [ ] The union of files executed across all 4 shards equals the full `test/*.test.mjs` set (231 files), each on exactly one shard.
- [ ] The `unit` job sets `DOCKER_HOST` to a dead socket (e.g. `unix:///nonexistent/faff987.sock`) and does NOT set `FAFF_REQUIRE_DOCKER`, so `docker info` fails and every Docker-gated test self-skips.
- [ ] `env-rootless` is unchanged: it still runs `test/env.test.mjs` and `test/holdout-evaluate-integration.test.mjs` with `FAFF_REQUIRE_DOCKER=1`.
- [ ] `validate-macos` is unchanged.
- [ ] No file under `records/spikes/` is executed by any shard (verified by the `test/` path arg being present).

### From WHAT (coverage)
- [ ] Each `unit` shard sets a shard-local `NODE_V8_COVERAGE` dir and uploads it as a build artifact.
- [ ] A `coverage-report` job (`needs: unit`, `if: always()`) downloads all shard artifacts and runs `scripts/coverage-aggregate.mjs` over the combined directory, publishing the advisory number; nothing gates on it.

### From WHAT (gates discovery)
- [ ] The `node … --test … test/` invocation in the workflow is a single physical line (so `extractRunCommands` discovers it whole).
- [ ] `gates.js` normalises the discovered UNIT command by stripping `--test-shard=…` (including a value spanning a `${{ … }}` expression) when forming the local rung, so the local UNIT rung is `node --import ./test/hermetic-env.mjs --test test/`.
- [ ] A test asserts the derived local rung command for the sharded CI line is the unsharded whole-suite command (guards the normalisation).

### From HOW (behaviour)
- [ ] A Docker-gated test assigned to a `unit` shard self-skips there (does not fail, starts no container) because `docker info` fails against the dead `DOCKER_HOST`, confirmed by a green `unit` run whose logs show no container standup.
- [ ] The matrix uses `fail-fast: false` so one red shard does not cancel the others.
- [ ] If the "Assert docker present" step in `validate` is retained, another step in `validate` still needs docker; otherwise it is removed.

### From HOW (profiling deliverable)
- [ ] A profiling artefact is produced (attached to the ticket or a scratch record): sum of per-file `duration_ms` versus the run's wall `duration_ms`, plus the ranked slowest files, captured from one representative run. This scopes the deferred `runCli`/baseline follow-up (filed as a separate ticket) and confirms or revises N = 4 per the revisit rule.

### Integration smoke test

```
PROCEDURE ci_smoke:
  1. Open a trivial PR touching one test file.
  2. Confirm CI shows: `validate` (gates only), 4 parallel `unit` shards, `coverage-report`,
     `validate-macos`, `env-rootless`.
  3. Confirm every `unit` shard is green and the slowest shard's wall is below the 180s target.
  4. Confirm the coverage-report job publishes a number to the step summary.
  5. Confirm no shard log mentions a records/spikes file or a started container.
  # If all five hold, the sharded topology is wired correctly.
```

confidence: high