# validate-macos: make a pre-first-test hang name its file and fail fast

> Spec: faffter-dark-nlspec · 2026-09-20 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1049.

## Why

The `validate-macos` CI job runs the impure exercise manifest (`test/impure/*.test.mjs`) as a single `node --test` call over all matched files. Intermittently it emits `TAP version 13` and then nothing — no `# Subtest:` line — and dies at the job's `timeout-minutes: 15` bound, surfacing as `CANCELLED`. It has recurred at least six times across unrelated commits (including a config-only PR that touches no code the job runs), and every re-run of the identical commit passes in about a minute. So this is a hang in module load or the first test's setup, not slowness, and not commit-dependent.

Two costs follow. First, roughly a third of `main`'s runs and two thirds of one branch's runs need a human to notice the red job and re-trigger it. Second, a `validate-macos` red that clears on re-run trains the reader to treat that job as noise — the exact habit that hides a real failure later. There is a third, sharper cost: one recorded instance ran **360 minutes**, so the hang can escape the 15-minute job bound entirely.

The blocking problem is diagnostic, not corrective: nothing tells us *where* it hangs. `node --test --test-reporter=tap` buffers each file's TAP output until a test in that file resolves, so a hang before the first test produces no file name to go on. Until the hang names a file, no one can fix or quarantine the offending test. This ticket delivers that diagnostic surface plus a fail-fast bound; it does **not** fix the underlying stuck test (that needs a reproduction the diagnostics must first produce — see Out of scope).

## What already shipped against this surface

Three merged tickets already touched this job; this work builds on them rather than redoing them.

- **FAFF-762** (Done) re-targeted `validate-macos` at the impure git/path/bash surface — it is why the job runs only `test/impure/*.test.mjs`.
- **FAFF-1038** (Done) added `--test-reporter=tap` and the "node died before its summary line" guard (the `summary_line` branch that emits `::error::` and preserves node's exit code). That guard fires when node *crashes* mid-run; it does not fire for a live hang, where node never exits and GitHub's job timeout does the killing.
- **FAFF-1035** (Done) added the `timeout-minutes: 15` job bound. The 360-minute instance shows that bound does not always contain a process ignoring the runner's cancel signal.

None of the three make a pre-first-test hang name its file, and none add a per-test or per-file bound. That is the gap this ticket closes.

## What

Change only the `validate-macos` step in `.github/workflows/validate.yml`. Replace its single whole-manifest `node --test "${matched[@]}"` invocation with a per-file loop, add a per-test timeout, and bound each file with a portable wall-clock, while preserving the existing FAFF-1038 and FAFF-1035 guards. No other CI job, and no test source file, changes.

**Chosen:** run the manifest **per file** — one `node --test <file>` invocation per matched file, in a loop, rather than one invocation over the whole array. A per-file loop names the culprit even when the hang is in module load *before any test runs*: the log shows the last file started and never finished. `--test-reporter=spec` alone was rejected — like `tap`, it buffers until a test resolves, so it still emits nothing for a module-load hang and would not name the file. Per-file invocation is the only option that pins a pre-first-test hang, and it is the ticket's stated precondition for everything downstream.

**Chosen:** add `--test-timeout=120000` (120 s per test) to each per-file invocation. A stuck *test* then fails loudly with its own name and a non-zero exit instead of consuming the whole job budget silently. The value is deliberate: a healthy full manifest is ~65–95 s for ~138 tests, so no single healthy test is near 120 s, yet 120 s is far under the 15-minute job bound — it catches a hung test without flaking a legitimately-slow subprocess or git-worktree test. `--test-timeout` does not bound a hang in module load (no test is running yet); the per-file loop and the per-file wall-clock below cover that case.

**Chosen:** bound each per-file invocation with a **portable bash wall-clock that SIGKILLs** after 300 s (5 min). macOS runners (`macos-latest`) do not ship GNU `timeout`, so this must be a background-process-plus-watchdog pattern in the step's bash, not the `timeout` binary — the same "host without a timeout binary" constraint FAFF-744 already handled elsewhere in this repo. 300 s is comfortably above a healthy whole-manifest run yet caps any single file well under 15 minutes, and a `SIGKILL` from the watchdog is not the runner cancel signal a runaway process can ignore — so this also hard-contains the 360-minute escape at the step level. On a kill, the step logs which file was killed and exits non-zero.

**Chosen:** preserve the existing guards, adapted for per-file output. The file-count floor (currently `file_floor=8`) stays as-is against the glob. The test-count floor (currently `test_floor=50`) becomes the **sum** of each file's `# tests N` line across the loop, so a mass-skip is still caught. FAFF-1038's "died before its summary line" detection now applies **per file** — a file that exits before emitting its own `# tests N` line names itself and fails the step, which is strictly better diagnostics than the whole-manifest version. The overall step exit is non-zero if any file times out, is killed, dies before its summary, or the aggregate floors are breached.

**Chosen:** scope the change to the `validate-macos` step only. The `unit` job (Linux, pathless full-suite, sharded) and `env-rootless` job keep their current invocations, and the shared `test/hermetic-env.mjs` preload (loaded via `--import` by all three) is not touched — so blast radius is one job. Whether the same hang would occur on `unit`'s Linux full-suite run is unknown and is not chased here (see Out of scope).

**Assumes:** the job's Node pin is 20 (via `actions/setup-node@v4`, `node-version: 20`), which is already true at HEAD and provides both the `--test-timeout` CLI flag and per-test timeout semantics. The change requires no Node upgrade.

## How (shape, not code)

The step's bash already does: glob the files, enforce the file-count floor, `unset FAFF_REQUIRE_DOCKER`, run node, then parse `/tmp/impure-macos.log` for the summary and floors. The new shape keeps that skeleton and swaps the single node call for a loop:

- Iterate the matched files. For each, run `node --import ./test/hermetic-env.mjs --test-reporter=tap --test-timeout=120000 --test <file>` under a bash wall-clock helper that launches node in the background, starts a watchdog that `kill -9`s it after 300 s, and waits — capturing that file's per-file exit status and appending its TAP output (tagged with the file name) to the aggregate log.
- Track, across the loop: whether any file was watchdog-killed (log the file name, mark failure); each file's own `# tests N` line (missing → FAFF-1038's pre-summary branch for that file, naming it); and a running sum of tests for the aggregate `test_floor` check.
- After the loop, apply the aggregate test-count floor and the existing file-count floor, and exit non-zero if any file failed, was killed, or died pre-summary — otherwise exit 0.

The implementer chooses the exact bash (the watchdog helper, how per-file logs are tagged and concatenated, how the running counts are accumulated). The guard tests below pin the observable behaviour so the bash details stay free.

## Done — acceptance criteria

Verifiable by extending the established workflow-parsing guard-test pattern (`test/gates-ci-macos-guard.test.mjs`, `test/ci-workflow-timeout-bounds.test.mjs`), which parse the `validate.yml` bash and run it against synthetic fixtures — no real macOS hang needs reproducing.

1. The `validate-macos` step invokes the impure manifest **per file** (one `node --test` per matched file in a loop), not as a single array invocation — asserted by a test reading the step's bash.
2. Each per-file invocation carries `--test-timeout=120000` — asserted by the same test.
3. Each per-file invocation is bounded by a portable wall-clock that SIGKILLs after 300 s and uses no `timeout` binary (macOS-portable) — asserted structurally, and behaviourally by a fixture where a synthetic hanging file is killed rather than running unbounded.
4. Given a synthetic file that hangs before emitting a subtest, the step's log **names that file** and the step exits non-zero (not a silent pass, not a bare cancel) — negative-fixture test.
5. The aggregate test-count floor (≥50, summed across files) and the file-count floor (≥8) still fire on their respective failure fixtures, and FAFF-1038's pre-summary detection still fires per file — regression-guarded by the existing/extended fixture tests.
6. `test/ci-workflow-timeout-bounds.test.mjs` still passes — the job-level `timeout-minutes` stays within 1–360 (unchanged).
7. On a healthy run the job still passes its full manifest (138/138) within the job budget — verified by the job going green on the change's own PR.

## Out of scope

- **Fixing or quarantining the specific hanging test** (the ticket's step 3). It needs a reproduction that this diagnostic work must produce first; once a run names the culprit file, that is a separate ticket. This is a scope boundary, not an unresolved decision — the mitigation here stands on its own by making the next failure diagnosable and fail-fast.
- **Whether `unit`'s Linux pathless full-suite run carries the same hang risk.** No evidence it has hung; if the per-file diagnostic later implicates a cross-platform cause, hardening `unit` is separately filable.
- **Changing the job-level `timeout-minutes: 15`** (FAFF-1035's bound) — kept as the outer backstop.

## Methodology critique

Agile-delivery lens (`issue-critique`):

- **Right-sized?** Yes — a single 1–3 day unit confined to one CI step, one workflow file, and its guard tests. The diagnostic instrumentation and the fail-fast bounds always ship together (the per-file loop is the precondition for a useful per-test/per-file bound), so this is one cohesive slice, not two.
- **Workstream fit?** Fits the CI-reliability thread alongside FAFF-1035/1038/762; outcome-named (make the hang diagnosable and self-bounding).
- **Deps surfaced?** No implicit dep. It builds on merged FAFF-762/1035/1038 (all Done) and needs nothing in flight.
- **Risk profile?** Low. The change lands via PR, is reversible with `git revert`, touches no production surface, and cannot regress the other two test jobs (no shared runner). The residual risk — that the instrumentation does not, in the end, catch a hang that lives somewhere the loop-plus-timeout can't see — is bounded by the outer job timeout that already exists.

confidence: high
build-tier: mechanical
spec-review: approve
