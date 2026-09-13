# validate-macos: keep the test-count guard reachable when node dies before the TAP summary

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1038.
> build-tier: complex

This spec is for the build agent and human reviewers. It addresses FAFF-1038: in the `validate-macos` impure step of `.github/workflows/validate.yml`, when `node --test` dies before it flushes the TAP epilogue, the test-count capture aborts the step under errexit, so the guard's `::error::` never fires and node's real exit code is replaced by a generic 1.

## 1. WHY — Problem and Principles

**The load-bearing model:** the step runs under `bash -e {0}` (GitHub's default — the step declares no `shell:` and `.github/` carries no `defaults:` block), so errexit is on for the whole body. The `set +e` / `set -e` pair at `:251`/`:254` deliberately brackets the failing-node pipeline so `PIPESTATUS` can be captured; but line `:256` — the test-count capture — runs *after* `:254` restored errexit, and it is written as though errexit were off. When the log has no `# tests N` line, its trailing `grep -oE '[0-9]+$'` exits 1, the command substitution and assignment inherit that 1, and errexit kills the step on that line.

**Problem statement:** today a summary-less log (node OOM-killed, SIGKILLed, or hard-crashed before the TAP epilogue) aborts the step at `:256`, so the no-summary diagnosis, the mass-skip guard, and `exit "$test_status"` all become unreachable — the step prints no annotation and exits a generic 1 instead of node's real status. This change makes `:256` survive an empty result and adds an explicit, truthful no-summary branch, so the crash is diagnosed in the checks summary and exits with node's own code.

**Design principles:**

- **Fail-closed stays fail-closed.** A summary-less log must never report green, whatever node's status was. The no-summary exit code is floored to non-zero.
- **The no-summary branch must be distinguishable from a mass-skip.** An absent `# tests N` line (the run did not complete) and a present-but-low count (`# tests 3`, a genuine mass-skip) are different diagnoses and must print different `::error::` text. Detect on the *presence* of the summary line, not on a numeric fallback to 0 — node 20 emits `# tests 2` even when every test is skipped, so a real "0 tests" line essentially never occurs and the empty-vs-present split is the robust signal.
- **Don't regress the guard the step already had.** The mass-skip floor (`# tests N` present, N < 50) and the pass-through of node's status on a summarised run must behave exactly as today.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/validate.yml` `:238`–`:264` | GitHub Actions / bash | The `validate-macos` impure step; the fix is confined to `:251`–`:264` plus the reporter flag on `:252`. |
| `test/gates-ci-source.test.mjs` | Node (`.mjs`, `node --test`) | Reads `validate.yml` and exposes `extractRunCommands` for step `run:` bodies — the seam the negative fixture reuses. |
| `test/impure/*.test.mjs` | Node | The real manifest the step globs (15 files today; file-floor 8). |

**Scope statement:** this is a one-step CI-reliability bug fix in faff's own validation workflow, plus a negative test fixture proving it.

## 2. OUT OF SCOPE

- **The sibling capture at `.github/actions/governance-check/action.yml:150`** — it is a `while` loop inside a command substitution under `set -euo pipefail`, a structurally similar shape, but whether its final-iteration status is reachable in the real discovery step is unsettled. *Why excluded:* speculative on current evidence, and a class-wide guard would be premature (`grep -rnE '=\$\(.*\|.*grep' .github/` returns only `:256`). *Extension point:* file a follow-up ticket to audit `action.yml:150` on its own and, if real, fix it there.
- **Any workflow-lint programme** (actionlint, yamllint, shellcheck over step bodies). *Why excluded:* shellcheck `-o all` over this step body reports only SC2250/SC2292 style nits — a lint of the obvious kind would not have caught this. *Extension point:* a separate CI-tooling ticket if desired.
- **FAFF-1035's wall-clock bounds** (`timeout-minutes`). *Why excluded:* a `timeout-minutes` kill terminates the step's shell before `:256` runs, so neither ticket fixes or blocks the other. *Extension point:* FAFF-1035 itself.
- **The file-count floor at `:243`–`:248`.** *Why excluded:* `count=${#matched[@]}` is a parameter expansion that cannot return non-zero; verified unaffected. *Extension point:* none needed.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| TAP epilogue / summary line | The `# tests N` line node's TAP output emits after a run completes. Absent when node dies mid-run. |
| No-summary log | A `/tmp/impure-macos.log` with no `^# tests [0-9]+` line — node exited before summarising. |
| Mass-skip | A summarised run whose `# tests N` count is below the floor (50) — the case the existing guard was written for. |

**The step's post-node contract (after the fix):** the body after the `set -e` at `:254` must, for any combination of {summary present / absent} × {node status 0 / non-zero}, reach a single `exit` with a defined code and print at most one `::error::`. The decision table:

```
summary line present?   node status   ->  ::error::                     exit code
  no                    any (incl. 0) ->  "pre-summary exit" (one)      test_status, floored to >=1
  yes, count <  floor   any           ->  "mass-skip" (existing text)   1
  yes, count >= floor   s             ->  none                          s (0, 7, ... unchanged)
```

**Reporter flag:** `:252`'s `node --test` invocation gains `--test-reporter=tap`, making `# tests N` a contract the step asks for rather than a version default. This is the same line's parse contract, not separate work: under node 24 the default piped output drops the `#`-prefixed epilogue, so without this flag the capture would be empty on *every* run (including green) the day the `node-version` pin at `:236` moves to 24.

## 4. HOW — Behavior

**Approach:** split the one-shot capture at `:256` into (a) a safe grab of the summary line that cannot trip errexit, (b) a presence branch, (c) the number extraction only on the present path. Add `--test-reporter=tap` to `:252`.

**The reporter flag (`:252`):**

```
node --import ./test/hermetic-env.mjs --test-reporter=tap --test "${matched[@]}" | tee /tmp/impure-macos.log
```

**The post-node body (replacing `:256`–`:264`):**

```
PROCEDURE evaluate_log(log_path, test_status):   # runs after `set -e` at :254
  1. summary_line := last line of `grep -oE '^# tests [0-9]+' log_path`, made errexit-safe
        (append `|| true` to the pipeline so an empty grep result yields "" rather than aborting)
  2. IF summary_line is empty:                    # no TAP summary — node died before it flushed
        a. code := test_status
        b. IF code == 0: code := 1                 # a summary-less log can never be green
        c. print exactly one ::error:: naming a PRE-SUMMARY exit
             (node exited before the runner summarised; carry $test_status; NOT a mass-skip)
        d. exit code
  3. tests_ran := trailing integer of summary_line   # summary present, safe to extract
  4. tests_ran := tests_ran default 0                 # keep the existing :257 fallback belt
  5. IF tests_ran < test_floor (50):
        a. print the existing mass-skip ::error:: ("only N impure tests ran (expected at least 50) …")
        b. exit 1
  6. exit test_status                                 # summarised, at/above floor — node's own status
```

**Behavior summary:** step 1 makes the capture unable to abort the step; step 2 is the new no-summary branch (the path that prints nothing and exits 1 today); steps 3–6 preserve the existing mass-skip guard and status pass-through byte-for-byte in behaviour.

**Edge cases:**

- **Empty grep result.** `grep` exits 1 on no match; `|| true` neutralises it so the assignment succeeds with an empty value. Do not rely on `${x:-0}` alone to distinguish absent-from-zero — branch on the *line*, not the number.
- **`test_status == 0` on a summary-less log.** Floored to 1 (principle: never green). This is the day-the-pin-moves-to-24 case if the reporter flag were ever dropped — the floor is the backstop.
- **`test_status == 0` on a summarised, at-floor run.** Passes through as 0 (the normal green path).

**Anti-pattern:** appending `|| true` to the *whole* original one-liner and keeping the `${tests_ran:-0}` numeric branch. Why: it makes `:256` survive but collapses the no-summary case into "0 tests", which then prints the *mass-skip* annotation — a false diagnosis. The presence branch must come before the numeric floor.

**Anti-pattern:** dropping `set +e`/`set -e` at `:251`/`:254`. Why: they are load-bearing — without `set +e` the failing node pipeline at `:252` aborts the step before `:253` captures `PIPESTATUS`. The fix is at `:256` only; leave `:251`–`:254` intact.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given /tmp/impure-macos.log with no "# tests N" line and node exiting 137
When the step body runs under bash -e
Then it prints exactly one ::error:: naming a pre-summary exit (not a mass-skip)
 And the step exits 137
```

```
Given a log containing "# tests 3" and node exiting 1
When the step body runs
Then the existing "only 3 impure tests ran (expected at least 50)" annotation prints
 And the step exits 1
```

```
Given a log containing "# tests 60" and node exiting 7
When the step body runs
Then no ::error:: prints
 And the step exits 7
```

- The `node --test` invocation at `:252` includes `--test-reporter=tap`, and running that invocation under node 24 writes a `# tests N` line into the log (checkable in docker `node:24`, where the current invocation writes none).

## 6. DESIGN DECISION RATIONALE

**How should `:256` survive an empty capture?**
- *Options:* (a) `|| true` on the whole one-liner + keep numeric branch; (b) split into a safe summary-line grab, a presence branch, then number extraction.
- (a) makes the line survive but can't tell no-summary from a genuine 0/low count, so it misfires the mass-skip annotation.
- **Chosen:** (b) — grab the summary line errexit-safely (`|| true`), branch on its presence, extract the number only when present. It is the only option that keeps the two diagnoses distinct, which ACs 1–3 require.

**How should the no-summary branch pick an exit code?**
- *Options:* fixed 1; pass `$test_status`; pass `$test_status` floored to ≥1.
- Fixed 1 loses the crash/failure/kill distinction the ticket asks to restore; a raw `$test_status` could be 0 and report green.
- **Chosen:** exit `$test_status`, floored to 1 when it is 0 — restores node's real code (137, etc.) while guaranteeing a summary-less log is never green.

**Should `--test-reporter=tap` be added now?**
- *Options:* defer to a node-24 bump ticket; add now.
- **Chosen:** add now. It is one flag on the same line the step already parses, it makes `# tests N` a requested contract rather than a version default, and it is what keeps this fix correct when the `node-version` pin moves to 24 (where the default piped output drops the `#` epilogue). Deferring would leave the fix silently version-fragile. At the time of writing, node 20/22 emit `# tests N` on a pipe by default; node 24 does not.

**Where does the negative fixture live?**
- *Options:* extend `test/gates-ci-source.test.mjs` (source-inspection tests of `validate.yml`); a new dedicated behavioural test file that executes the extracted step body.
- `gates-ci-source.test.mjs` inspects the workflow as source (does the gate detector see the rungs); running the extracted body against a stub node + summary-less log is a different kind of test (behavioural execution), and mixing it in would blur that file's purpose.
- **Chosen:** a new dedicated test file (e.g. `test/gates-ci-macos-guard.test.mjs`) that *reuses* the exported `extractRunCommands` helper to pull the step body out of `validate.yml`, then executes it under `bash -e` against a controlled summary-less log with a stubbed `node` on `PATH` and a stub `test/impure` glob clearing the file-floor. Reusing the helper keeps the fixture anchored to the real workflow text rather than a copy.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none blocking. (The `governance-check:150` sibling is deliberately Out of Scope, not a punt on this work — it wants its own audit ticket.)

**Assumptions:**

- `**Assumes:** test/gates-ci-source.test.mjs exports `extractRunCommands` and reads `.github/workflows/validate.yml`.` *Validation:* confirmed present (`import` at `:18`, tested at `:53`); the fixture imports it the same way. If the export moves, import from its new home.
- `**Assumes:** the repo runs `.mjs` tests via `node --test` (no package.json test script).` *Validation:* confirmed — there is no `package.json`; new tests are `*.test.mjs` discovered by `node --test`, and this fixture must be reachable by the same manifest/CI path that runs the suite.

## 8. DONE — Definition of Done

### From WHY / HOW (behaviour)
- [ ] With a summary-less `/tmp/impure-macos.log` and node exiting 137, the step prints exactly one `::error::` naming a pre-summary exit (not a mass-skip) and exits 137. (AC1)
- [ ] With the same summary-less log and node exiting 0, the step prints that same pre-summary `::error::` and exits non-zero. (AC2)
- [ ] Line `:256`'s capture no longer aborts the step under errexit on an empty result — every line after it is reachable.

### From HOW (mass-skip guard preserved)
- [ ] A log with `# tests 3` and node exiting 1 still prints "only 3 impure tests ran (expected at least 50)" and exits 1. (AC3)
- [ ] A log with `# tests 60` and node exiting 7 exits 7 and prints no `::error::`. (AC4)
- [ ] A log with `# tests 60` and node exiting 0 exits 0 and prints no `::error::`. (AC5)

### From WHAT (reporter contract)
- [ ] `:252`'s `node --test` invocation passes `--test-reporter=tap`, and that invocation under node 24 writes a `# tests N` line into the log. (AC6)

### From HOW (fixture)
- [ ] A negative fixture runs the extracted step body against a summary-less log and asserts AC1 and AC2; removing the no-summary branch reddens it, restoring it passes. (AC7)

**Integration smoke test:**

```
1. Extract the validate-macos step body from validate.yml via extractRunCommands.
2. Set up: stub `node` on PATH emitting only "TAP version 13" to the log and exiting 137;
   a temp dir with >=8 stub test/impure/*.test.mjs; an empty /tmp/impure-macos.log target.
3. Run the extracted body under `bash -e`.
4. Assert: stdout carries exactly one pre-summary ::error::; the process exits 137.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** Yes. One cohesive unit — a single step-body fix on one file plus its negative fixture, well under a 1–3 day slice (Size: S). The reporter flag is the same line's parse contract, not a second concern, so no split is warranted.
- **Workstream fit?** Yes. CI-reliability hardening of faff's own `validate` lane, cohesive with the FAFF-762 work that built this step.
- **Deps surfaced?** Yes. The one adjacent ticket (FAFF-1035, wall-clock bounds) is explicitly established as neither blocking nor blocked (a `timeout-minutes` kill pre-empts `:256`), and the `governance-check:150` sibling is scoped out with a follow-up hook. No implicit dependency is left unlinked.
- **Risk profile?** Low. A CI-only change, fully reversible by `git revert`; the born-verifiable ACs and the negative fixture de-risk the behavioural claims. No de-risking spike needed.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```