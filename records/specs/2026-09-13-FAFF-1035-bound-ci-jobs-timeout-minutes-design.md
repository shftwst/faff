# Bound every CI job with `timeout-minutes` and guard the omission

> Spec: faffter-dark-nlspec · 2026-09-13 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1035.

This spec addresses FAFF-1035. Its audience is the build agent that will implement the change and the human reviewers of the resulting PR. It describes a CI-hygiene change to faff's own repository: give every GitHub Actions job a wall-clock bound, add a repo guard that reddens when a job lacks one, and lock in that faff's merge observer already reads a timed-out job as terminal.

## 1. WHY — Problem and Principles

**The load-bearing model.** GitHub only kills a hosted job at its own 360-minute ceiling unless the job declares its own `timeout-minutes`. faff's 14 CI jobs declare none, so a runner-side stall (the job process stays alive and keeps renewing its lease while the work hangs) ends only when a person notices and cancels. faff's premise is a loop that needs no human in it; an unbounded job is a failure whose only remedy is a human, and the fix is a per-job wall-clock bound plus a guard that stops the bound being silently dropped again.

**Problem statement.** Today a stalled CI job sits pending until an operator cancels it by hand (observed on PR #879: `validate-macos` hung 101.6 minutes with zero log output before a manual cancel), and faff's landing loop holds the built work indefinitely because the head-sha check never reaches a terminal state. This change bounds each job so a stall self-terminates minutes past that lane's healthy runtime, and adds a guard so a newly added job cannot omit the bound. The result is that a stalled job reddens the PR on its own and the landing loop moves out of `CI_PENDING` with no human in the path.

**Design principles.**

- **Bias the bound large, never tight.** This backlog has been burned twice by bounds set too tight, never by bounds set too loose (FAFF-715, a 30s spawn timeout too tight; FAFF-866, a per-test bound too tight under CI load). A bound's only job here is to kill a stall well clear of a healthy run — the cost of a too-large bound is a stall running a few extra minutes before the kill, capped at 360; the cost of a too-small bound is a red healthy PR. Every bound must sit comfortably above its lane's observed healthy runtime.
- **The guard must red without editing a workflow file.** The whole point is catching the *next* omission. A guard that only runs when someone remembers to run it repeats the failure. It must fire on an existing CI lane so a new unbounded job reddens a pull request with no edit to any workflow file.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `.github/workflows/*.yml` (8 files, 14 jobs) | YAML | The jobs to bound — dco 1, deploy-docs 2, faff-landing-comment 1, governance 1, job-surface-probe 2, release-please 1, semantic-pr 1, validate 5 |
| `plugin/skills/faff/bin/lib/merge-gate.js:159` `classifyHeadShaChecks` | JS | The merge observer; already FAILs `cancelled`/`timed_out` (AC6 is a lock-in test, not a code change) |
| `plugin/skills/faff/bin/lib/gates.js:578` `discoverCiWorkflowsRunnable` | JS | Existing text-parser that enumerates `.github/workflows/*.{yml,yaml}` and their `jobs.<key>` structure — reusable by the guard |
| `test/gates-ci-source.test.mjs`, `test/eval-baseline-gate.test.mjs:173`, `test/eval-size-census.test.mjs:106` | JS | Three existing precedents that read `validate.yml` as text and assert on it — the guard's home model |

**Scope statement.** This sits entirely in faff's own repository CI hygiene; it changes no product behaviour and ships nothing to adopters (faff does not ship `.github/workflows/` at all).

## Already shipped against this surface

Related work exists on the timeout/CI surface but none delivers this ticket's premise (a `timeout-minutes` on faff's own 14 `.github/workflows/` jobs plus a guard). Reader context, not superseding:

- **FAFF-606 / FAFF-643 / FAFF-716 / FAFF-608 (Done)** — the reference workflows under `operations/ci/` that already carry their own bounds. Explicitly out of scope here; they are not the jobs GitHub runs on faff's own PRs.
- **FAFF-984 / FAFF-849 / FAFF-639 / FAFF-533 (Done)** — the local `faff gates run` rung timeout (`gates.js:445`) and the CI-workflow gate detector. The gate ladder bounds `node --test` to 30 min when faff runs it locally; nothing bounds it when GitHub runs it. Its parser is reused by this ticket's guard.
- **FAFF-987 (Done)** — sharded the `unit` suite 4-way but added no `timeout-minutes`.
- **FAFF-635 / FAFF-715 / FAFF-866** — per-test flake bounds; the direction (too-tight) this spec's "bias large" principle guards against. Not the same layer as a job bound.
- **FAFF-1038** — the split-out `tests_ran` defect in the same macOS step block; a sibling ticket, not this one.

## 2. OUT OF SCOPE

- **The inner `node --test --test-timeout` per-test bound.** — Why excluded: it does not cover the observed failure (no test was running when PR #879 stalled), and this backlog's regressions all run in the too-tight direction. — Extension point: file it against `.github/workflows/validate.yml`'s `unit` job (or the local rung in `gates.js`) only if a genuinely hung test is ever observed on a lane, keeping clear of FAFF-635's and FAFF-715's 30s budgets.
- **`operations/ci/` reference workflows.** — Why excluded: they already carry their bounds (`l3-watcher.yml:73`, `l4-watcher.yml:80`, `faff-cron.sh:78`). — Extension point: none needed.
- **Root-causing the macOS runner stall.** — Why excluded: it is upstream (`actions/runner-images#13882` and siblings) and a bound is the right answer whether or not the cause is found. — Extension point: n/a.
- **The unreachable `tests_ran` guard in `validate.yml`'s macOS step block.** — Why excluded: a distinct defect, deliberately not folded in. — Extension point: already filed as FAFF-1038 (which also corrected two claims from this ticket's shaping).
- **A faff-side CI-hygiene lint for adopters.** — Why excluded: the cheaper test-under-`test/` slice satisfies AC3/AC4 and matches three precedents; an adopter-facing lint is more surface than this bug needs. — Extension point: a new `gates.js` detector reusing `discoverCiWorkflowsRunnable`'s parser, emitting a workflow-hygiene finding.

## 3. WHAT — Types and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Job bound | a `timeout-minutes:` key declared on a job in `.github/workflows/`, an integer GitHub honours only in 1–360 on hosted runners |
| The guard | a repo-resident check that fails when any job under `.github/workflows/` lacks a `timeout-minutes` or declares one outside 1–360 |
| Head-sha terminal read | `classifyHeadShaChecks` returning `ci-red` (not `indeterminate`/`pending`) for a completed check whose conclusion is `cancelled` or `timed_out` |

**The per-job bounds.** Each of the 14 jobs declares a `timeout-minutes` sized per lane with generous headroom over its observed healthy runtime. Recommended starting values (the empirical validator is AC5's green `validate` run — raise any value that clips a healthy run, never lower one toward its runtime):

| File | Job | Observed healthy | `timeout-minutes` |
|---|---|---|---|
| dco.yml | dco | seconds | 5 |
| deploy-docs.yml | docs-build | ~1–3 min | 15 |
| deploy-docs.yml | deploy | ~1 min | 10 |
| faff-landing-comment.yml | landing-comment | seconds | 5 |
| governance.yml | governance-check | <1 min | 10 |
| job-surface-probe.yml | hosted-direct | ~1–2 min | 15 |
| job-surface-probe.yml | hosted-container | ~1–2 min | 15 |
| release-please.yml | release-please | seconds | 5 |
| semantic-pr.yml | validate-title | seconds | 5 |
| validate.yml | validate | ~40 s (behind `unit`) | 15 |
| validate.yml | unit (4-shard matrix) | ~170 s/shard | 20 |
| validate.yml | coverage-report | ~1 min | 15 |
| validate.yml | validate-macos | ~1m33s | 15 |
| validate.yml | env-rootless | ~1–2 min | 15 |

A matrix job (`unit`) declares one `timeout-minutes` key that applies to each matrix leg; AC1's count of 14 keys treats it as the one job it is.

**Chosen: per-lane bounds, biased large, not one blanket value.** Options: (a) one blanket value for all 14, simplest and removes the exposure on its own; (b) per-lane values, tighter but 14 judgements. Per-lane costs little here because every value is a generous ceiling, not a tuned budget, and per-lane keeps the fast lanes (`validate-macos` at 1m33s) from advertising a misleadingly loose bound. The values above all sit far above healthy runtime and far above the 30s in-test budgets, so none can clip a healthy run.

**The guard interface.** A test under `test/` (run by the existing `node --test` `unit` lane, so it reddens PRs per AC4) that:

```
PROCEDURE guard_workflow_bounds():
  files := every *.{yml,yaml} under .github/workflows/ (repo root)
  jobs  := for each file, enumerate its jobs.<key> entries
  FOR each job:
    ASSERT the job declares a timeout-minutes key
    ASSERT its value is an integer with 1 <= value <= 360
  ASSERT total count of timeout-minutes keys == total job count (== 14 today)
```

Job enumeration reuses the parser already in `gates.js` (`discoverCiWorkflowsRunnable` / the `jobs.<key>` + indent-4 job-property recognition at `gates.js:213`, `:193`) rather than a second hand-rolled YAML reader, so the guard and the gate agree on what a job is.

**Chosen: the guard lives in a `test/` test, not a new `gates.js` lint.** It is the cheaper slice, matches three existing precedents that read `validate.yml` as text, and runs on the existing `unit` lane with no new workflow job (so the guard itself needs no bound beyond `unit`'s). The adopter-facing `gates.js` lint is the documented extension point.

## 4. HOW — Behaviour

**Approach.** Three independent edits: (1) add a `timeout-minutes` to each of the 14 jobs; (2) add the guard test; (3) add the merge-observer lock-in test. Nothing about (1) is conditional or ordered; (2) and (3) are pure additions of test files.

**The merge-observer read is already correct.** `classifyHeadShaChecks` (`merge-gate.js:159`) already carries `cancelled` and `timed_out` in its FAIL set (`:164`) and maps any unrecognised completed conclusion to `ci-red` fail-closed (`:172`). So AC6 is a regression-lock test, not a code change:

```
GIVEN a head-sha check row [{status:"completed", conclusion:"cancelled"}]
WHEN classifyHeadShaChecks(rows, null, 0) is called
THEN it returns "ci-red"

GIVEN a head-sha check row [{status:"completed", conclusion:"timed_out"}]
WHEN classifyHeadShaChecks(rows, null, 0) is called
THEN it returns "ci-red"
```

`classifyHeadShaChecks` is exported (`merge-gate.js:2159`) and already exercised in `test/merge-gate-controlflow.test.mjs`, so the two assertions go there (or alongside the existing selftest rows in `merge-gate.js:1588`). This is the behaviour that moves faff's landing loop out of `CI_PENDING` once a stall self-terminates.

**Failure modes.**

- **The failure:** a chosen bound is set below a lane's real worst-case CI-load runtime, so a healthy run is cancelled and the PR reddens spuriously — the exact FAFF-715/FAFF-866 regression. **How you'd know:** AC5's `validate` run (or a later PR) goes red on a job whose log shows normal progress cut off at the bound. **What it means:** raise that lane's bound; never respond by removing the bound.
- **The failure:** the guard's job enumeration under-counts (misses a job whose YAML shape the parser doesn't recognise), so an unbounded job passes the guard. **How you'd know:** the AC1 count assertion (`== 14`) disagrees with a manual `grep -c` of job keys, or a hand-deleted bound in the demonstration does not red. **What it means:** the guard is using a parser that doesn't match GitHub's job model — align it with `gates.js`'s enumeration, which already parses these files for the gate ladder.

**Anti-pattern:** raising a bound above 360 to "be safe." Why: GitHub silently ignores anything above 360 on hosted runners, so a 600 bound is effectively no bound — and AC2's guard reddens on it.

**Anti-pattern:** making the guard a `workflow_dispatch` or manual step. Why: AC4 requires it to red a PR with no human action; a manual guard repeats the omission it exists to catch.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a job under .github/workflows/ with its timeout-minutes deleted
When the guard runs on CI
Then the guard fails (red), and restoring the declaration turns it green
```

```
Given a job whose timeout-minutes is set to 600 (above GitHub's 360 ceiling)
When the guard runs
Then the guard fails, because 600 is outside the honoured 1–360 range
```

```
Given a newly added job in a workflow file with no timeout-minutes
When a pull request runs the unit lane
Then that lane reddens with no edit to any workflow file
```

```
Given a full validate run with all bounds in place
When it runs the macOS lane and the 4-shard unit matrix
Then every job completes green, so no chosen bound clips a healthy run
```

## 6. Design Decision Rationale

**One bound per lane, or one blanket value?** Options: blanket (one number, coarse) vs per-lane (14 numbers, tighter). **Chosen:** per-lane, every value biased large. Rationale: per-lane costs little when the values are generous ceilings rather than tuned budgets, and it avoids stamping a misleadingly loose bound on a fast lane. A blanket 30 would also have worked; per-lane is the marginally better artifact for the same edit cost.

**Does the inner `--test-timeout` bound belong here?** **Chosen:** no — out of scope. Rationale: it does not cover the observed failure (a runner stall with no test running), it buys diagnostics rather than recovery, and every prior bounds regression in this backlog was too-tight, not missing. FAFF-635's design record permits a later cap on the condition it stays clear of the 30s budgets; adding one now would take on that risk for no coverage of this bug.

**Where does the guard live — `test/` or a `gates.js` lint?** **Chosen:** a `test/` test reusing the `gates.js` workflow parser. Rationale: cheapest slice, matches three precedents, runs on the existing `unit` CI lane (satisfies AC4), and needs no new workflow job. The adopter-facing lint is a real future improvement but more surface than this bug warrants.

**Change `classifyHeadShaChecks`, or lock it in?** **Chosen:** lock it in with a test. Rationale: the code already treats `cancelled`/`timed_out` as `ci-red` and fails closed on unknown conclusions, so AC6's requirement is met today; the value at risk is a silent regression, which a test prevents.

## 7. Open Questions and Assumptions

**Open Questions:** none. All four shaping open questions are resolved above by Chosen decisions at high appetite (per-lane bounds; no inner `--test-timeout`; guard in `test/`; AC6 as a lock-in test).

**Assumptions.**

- **Assumes:** the `unit` `node --test` lane discovers and runs any new `test/*.test.mjs` file automatically. — Validation: confirm the new guard test file matches the suite's discovery glob (the existing `test/*.test.mjs` files are auto-run by `node --import ./test/hermetic-env.mjs --test`); if the suite pins an explicit file list, add the new file to it.
- **Assumes:** the recommended per-lane values all sit above each lane's worst-case healthy runtime. — Validation: AC5's full `validate` run is the check; raise any value that reddens a healthy run.

## 8. DONE — Definition of Done

### From WHY
- [ ] A stalled job self-terminates at its declared bound rather than running to GitHub's 360-minute ceiling or a manual cancel.

### From WHAT (bounds)
- [ ] Every job in every file under `.github/workflows/` declares a `timeout-minutes`; the count of `timeout-minutes` keys equals 14 (the job count across the 8 files). [AC1]
- [ ] Every declared value is an integer in 1–360. [AC2]

### From WHAT (guard)
- [ ] A repo guard fails when a job under `.github/workflows/` lacks `timeout-minutes` or declares one outside 1–360, demonstrated twice: delete one declaration → red, restore → green; set one value to 600 → red. [AC3]
- [ ] The guard runs on a CI lane, so a newly added unbounded job reddens a PR with no edit to any workflow file. [AC4]

### From HOW (behaviour)
- [ ] A full `validate` run is green with the bounds in place, covering the macOS lane and the 4-shard unit matrix. [AC5]
- [ ] A test asserts `classifyHeadShaChecks` returns `ci-red` for a completed check with conclusion `cancelled` and for one with conclusion `timed_out`. [AC6]

**Integration smoke test.**

```
1. Delete the timeout-minutes from any one job.
2. Run the guard (node --test on the guard file) → it fails.
3. Restore the declaration → the guard passes.
4. Run the classifyHeadShaChecks lock-in test → both cancelled and timed_out assert ci-red.
```

confidence: high
spec-review: approve
build-tier: complex

## Methodology critique

Agile-delivery lens (`issue-critique`), advisory — does not gate promotion.

- **Right-sized?** Yes. One concern (bound the 14 CI jobs + guard the omission), a single 1–3 day unit. The `tests_ran` defect and the adopter-facing lint were correctly carved off (FAFF-1038 and an OUT OF SCOPE extension point).
- **Workstream fit?** Yes. CI-hygiene on faff's own repo; cohesive with the shipped `operations/ci/` bounds and the gates ladder.
- **Deps surfaced?** No missing links. FAFF-1038 is an independent sibling (no build ordering dep). The fix does not depend on root-causing the upstream macOS stall.
- **Risk profile?** Low. No novel integration or external dependency; the only regression axis (a too-tight bound) is named as a design principle and caught empirically by AC5. No de-risking spike warranted.
