# 639b — Gate ladder runs what discovery found

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-849.

This spec covers FAFF-849 (639b), the second half of the FAFF-639 split. Audience: the build agent implementing it and the human reviewing that build. The first half — FAFF-848 (639a), Done — made `faff gates discover` *see* what CI enforces (invariant lints, two-tier dedup, a `partial` classification and a coverage ratio) without changing what `faff gates run` executes. This half closes the deliberate gap 848 left open: it makes `faff gates run` **execute** the wider set discovery found, safely.

## 1. WHY — problem and principles

**The load-bearing idea.** After 848, `faff gates discover` and `faff gates run` read from two different resolvers by design. `discover` calls `discoverRungsReporting` (the wide recogniser: invariant lints as `STATIC_ANALYSIS`, distinct CI lints kept apart, a coverage ratio, a `partial` verdict). `run` calls `discoverRungs` → `runLadder` (the narrow recogniser: kind-deduped, `ciRunnerKind` only, `confident`/`none` only). So today discovery honestly reports "I see 11 of 34 eligible steps, partial" while execution still runs the same two rungs it always did. 639b makes execution consume the *reporting* resolver's rungs — but running a command is not the same as reporting it, so execution must first subtract everything that is unsafe or impossible to run locally, cap the blast radius, and let a repo opt out.

**Problem statement.** `faff gates run` executes a tenth of what CI enforces and returns `pass`, so the FAFF-604 class of surprise (green locally, red in CI on `regions check`) still ships. This half runs the wider recognised set locally, cheapest-first, bounded by caps and a per-repo exclude list, so the local ladder catches what CI would have caught. It does not turn the ladder into a second CI: it runs the repo's own already-declared checks, not new ones.

**Design principles.**

- **Recognised is not runnable.** 848's reporting recogniser counts every recognised step toward coverage. Execution must not run a step that references CI-only context (`${{ … }}`, `$GITHUB_*`), targets a foreign OS (`runs-on: macos-latest` on a Linux host), or a repo has explicitly excluded. These are subtracted from the runnable set **and** from the coverage denominator — they were never candidates for local execution.
- **The exclude list is the safety valve, and it must exist before the wider set runs.** 848 named a trust-boundary obligation and transferred it here: "recognised ⇒ run verbatim, before review." 639b is the point that obligation becomes load-bearing, because 639b is what runs the command. `gates.exclude` is the per-repo escape that discharges it — a repo that does not want a specific recognised command executed locally names it and the ladder skips it.
- **Bounded blast radius.** A workflow can declare many steps of one kind. Executing all of them unbounded makes the ladder as slow as CI. `gates.max_rungs_per_kind` caps how many rungs of each kind run, keeping the cheapest.
- **Partial coverage is a policy choice, not a silent pass.** When execution still covers less than the configured fraction of the runnable workflow, `gates.partial` decides whether that is a warning (default) or a `needs-human` gate. The fail-closed `none` policy (FAFF-848/FAFF-533) is unchanged.
- **Preserve FAFF-533 and cheapest-first exactly.** A local rung of a kind still suppresses all CI rungs of that kind; rungs still run cheapest-first, fail-fast on the first failing required rung.

**Reference context** (current code, verified 2026-08-27).

| File | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/gates.js:294-323` | `discoverRungsReporting` — the wide resolver (invariant lints, two-tier dedup, coverage, `partial`). 639b's execution path consumes this. |
| `gates.js:198-250` | `extractRunCommandsWithContext` — tracks `job`, `step_index`, `step_name`. 639b extends it to also carry the enclosing job's `runs-on`. |
| `gates.js:256-281` | `discoverCiWorkflowsReporting` — the CI reporting scan + coverage inputs. Exclusion filtering hooks in here / at the resolver. |
| `gates.js:292` | `PARTIAL_COVERAGE_THRESHOLD = 0.5` — hardcoded; 639b makes it configurable via `gates.*`. |
| `gates.js:384-401` | `discoverRungs` — the narrow execution resolver, retired as `runLadder`'s source (kept only where 848 tests still assert isolation — see §2). |
| `gates.js:435-454` | `runLadder` — 639b rewires its rung source and adds the `partial` signal branch. |
| `gates.js:424-431` | `gatesFallbackPolicy` — the config-read idiom (`loadConfig` + `dig`) the new `gates.*` reads mirror. |
| `gates.js:173-178` | `INVARIANT_LINT_PATTERNS` — `regions selftest` matches both `--region` variants as distinct commands; 639b aggregates them for execution. |
| `plugin/skills/faff/bin/lib/config.js:112,2114` | `gates.fallback` default + the DEFAULTS drift-check list — where the new scalar keys are registered. `gates` is already in `WRITABLE_NAMESPACES` (config.js:896). |
| `plugin/skills/faff/contracts/quality-gates.schema.json` | Contract shape `{signal, rungs, conformant, violations}`; `signal ∈ {pass, fail, needs-human}`, rung `status` includes `skipped`. No `discovery`/`coverage` field — unchanged. |
| `.github/workflows/validate.yml:90-99,165` | The two interim `regions selftest --region factory\|governance` steps (the comment says collapse to `--region all` once FAFF-561 clears budget's state-sensitive selftest); `impure-macos` job on `runs-on: macos-latest` — the OS-mismatch exclusion case. |

**Scope.** The execution half of the gate ladder: what `faff gates run` selects and runs from the wider recognised set, and the config that bounds it. Discovery/reporting (848) and the contract shape are unchanged.

## 2. OUT OF SCOPE

- **Widening recognition further.** The recogniser is 848's `discoverRungsReporting`. 639b adds no new runner patterns. Extension point: `INVARIANT_LINT_PATTERNS` / `CI_RUNNERS` in `gates.js`.
- **Changing the contract shape.** No `discovery`/`coverage` field is added to `quality-gates`. Extension point: `quality-gates.schema.json` + `contract-defs.js` (a separate ticket if ever wanted).
- **Full YAML parsing.** The line scan stays the house posture. `runs-on` capture extends the existing line scan, not a parser swap.
- **A general command sandbox.** 639b runs recognised commands in the existing worktree sandbox (`execution_target = cwd`, the FAFF-12 seam), unchanged. Hardening that seam is separate.
- **Retiring `discoverRungs` outright.** It stops feeding `runLadder`, but 848's execution-isolation self-tests (`gates.js` cases 24-25) still call it directly; leave the function in place. Extension point: a later cleanup ticket once those assertions are re-expressed.

## 3. WHAT — vocabulary, types, decisions

| Term | Meaning |
|---|---|
| Runnable step | A recognised candidate step that survives all exclusion rules — safe and possible to run on the local host. |
| Excluded step | A recognised (or candidate) step removed by an exclusion rule: CI-context, OS-mismatch, or configured. Subtracted from the coverage denominator; never a rung. |
| Exclusion reason | `github-context` \| `os-mismatch` \| `configured` — why a step was excluded, for the log/report. |
| Aggregate rung | One rung standing in for a family of related commands executed as a unit — here, `regions selftest --region all` for the per-region selftest steps. |
| Runnable coverage | Recognised runnable steps ÷ eligible runnable steps (eligible with exclusions subtracted). The ratio the `partial` verdict uses in execution. |

```
ENUM ExclusionReason: github-context | os-mismatch | configured

RECORD GatesConfig:
  fallback: fail-closed | advisory        # existing (gates.fallback), unchanged
  partial: warn | needs-human             # NEW gates.partial; default warn
  exclude: List<String>                   # NEW gates.exclude; default []; substring match on command text
  max_rungs_per_kind: Int                 # NEW gates.max_rungs_per_kind; default 5; >=1
  partial_threshold: Float                # NEW gates.partial_threshold; default 0.5; runnable-coverage cutoff

RECORD Rung:                              # unchanged shape; execution now also sets:
  kind, name, command, source, cost_rank, required
  # (excluded steps never become a Rung)
```

**Chosen: `runLadder` consumes the reporting resolver, filtered and bounded — not `discoverRungs`.** Execution now calls `discoverRungsReporting` (the wide set), then applies, in order: exclusion filtering → selftest aggregation → per-kind cap. Rationale: the ticket's whole point is "the ladder runs what discovery found." Keeping `discoverRungs` as execution's source would leave execution blind to exactly the invariant lints 848 taught discovery to see. The narrow resolver is retired from the execution path (kept only for 848's isolation tests). *(decides: architecture — the design questions were human-closed 2026-08-19; this is the mechanism that carries them.)*

**Chosen: three exclusion rules, applied to the reporting scan, each subtracting from the denominator.**
- `github-context` — a candidate command whose text contains `${{` or a `$GITHUB_`/`$RUNNER_` token is CI-plumbing and references context absent locally. Excluded.
- `os-mismatch` — a candidate step whose enclosing job `runs-on` names an OS family different from the local host (e.g. `macos-*`/`windows-*` on a Linux host) cannot run locally. Requires capturing `runs-on` per job (extend `extractRunCommandsWithContext`). Excluded.
- `configured` — a candidate command matching any `gates.exclude` entry (case-sensitive substring) is a repo opt-out. Excluded.

An excluded step is removed from the rung set **and** from `eligible_steps` before the ratio is computed, so runnable coverage measures "of the steps we could run locally, how many do we recognise," not "of everything CI does." *(decides: architecture)*

**Chosen: aggregate the `regions selftest` family into one `regions selftest --region all` rung.** Discovery reports `--region factory` and `--region governance` as two distinct `STATIC_ANALYSIS` commands. Execution collapses every recognised `regions selftest --region <x>` step into a single rung whose command is `regions selftest --region all`, consuming one slot under the cap. This is the human decision of 2026-08-19 (run the family as one aggregate, not per-region, and not the ~63 individual per-command selftests). *(decides: human, 2026-08-19)*

**Chosen: three new scalar `gates.*` keys plus a configurable threshold, conservative defaults from 848's measured report.**
- `gates.partial` — `warn` (default) | `needs-human`. Consulted only when execution's runnable coverage is below `gates.partial_threshold`.
- `gates.max_rungs_per_kind` — default `5`. On this repo, the widened set is 3 LINT / 4 STATIC_ANALYSIS-after-aggregation / ≤3 UNIT, all ≤5, so the default runs the full recognised set here while bounding a pathological workflow.
- `gates.partial_threshold` — default `0.5`, promoting 848's hardcoded `PARTIAL_COVERAGE_THRESHOLD` to config (its own inline comment names this as 639b's job). This is the fourth `gates.*` key beyond the ticket's literal three, grounded in 848's handoff (which names "a configurable threshold" as 639b's).
- `gates.exclude` — default `[]` (list; read via `dig`, not a DEFAULTS scalar).

Defaults land in the `config.js` DEFAULTS map and the DEFAULTS drift-check list (`gates` is already a writable namespace). *(decides: architecture; calibration — human decision to calibrate from 848's report, done below.)*

**Chosen: the `partial` signal branch is additive to `runLadder`, the `none` policy unchanged.** After running rungs, if `discovery === "none"` the existing `gatesFallbackPolicy` fires exactly as today. Additionally, if runnable coverage `< gates.partial_threshold`, consult `gates.partial`: `warn` → `signal` stays as the rungs produced (pass/fail/needs-human) but the human-readable output carries a partial-coverage warning; `needs-human` → `signal` is raised to `needs-human` (never lowered — a `fail` stays `fail`). The `quality-gates` contract shape is untouched (`signal ∈ {pass, fail, needs-human}`). *(decides: architecture)*

**Assumes: executing `regions selftest --region all` in the worktree sandbox is safe and self-contained.** The factory region spawns the destructive `worktree-prune --selftest` (flagged in 848 §7). A `--selftest` is designed to run against its own temp fixtures, so it is safe to execute in the `execution_target = cwd` sandbox. Validation before build: run `faff regions selftest --region all` in a throwaway worktree and confirm it touches no real repo state.

**Assumes: budget's selftest state-sensitivity (FAFF-561) is resolved or the rung is excludable.** `regions selftest --region all` today FAILs on a dirty local `.faff/` state (budget's state-sensitive selftest) and passes on a clean checkout — the reason `validate.yml` still runs the two regions as interim steps rather than `--region all`. As an executed required rung this can redden the ladder on a clean codebase. Mitigation is in-design: `gates.exclude` can name `regions selftest` until FAFF-561 clears, and the cap keeps it one rung. Validation: run the aggregate in a clean worktree and confirm green; if not, the repo excludes it. This is a risk, not an open design question — the escape exists and the decision to aggregate is human-made.

## 4. HOW — behaviour

**Overview.** `runLadder` gains a selection front-end and a signal back-end. The front-end turns the wide reporting set into a bounded runnable set; the back-end adds the partial-coverage policy after execution.

```
PROCEDURE runLadder(root):
  cfg := readGatesConfig(root)            # fallback, partial, exclude, max_rungs_per_kind, partial_threshold
  { rungs, discovery, coverage } := selectRunnableRungs(root, cfg)
  results := []; needsHuman := false
  FOR rung IN rungs (already cheapest-first):
     r := runRung(rung, root)
     results.push(r)
     IF r.status == "errored": needsHuman := true; CONTINUE     # unchanged
     IF rung.required AND r.status == "fail":
        RETURN { signal: "fail", discovery, coverage, rungs: results }   # fail-fast, unchanged
  signal := "pass"
  IF discovery == "none":
     signal := gatesFallbackPolicy(root) == "fail-closed" ? "needs-human" : "pass"   # unchanged
  ELSE IF needsHuman:
     signal := "needs-human"                                   # unchanged
  # NEW partial-coverage policy (never lowers an existing fail/needs-human):
  IF discovery == "partial" AND coverage.ratio < cfg.partial_threshold:
     IF cfg.partial == "needs-human" AND signal == "pass": signal := "needs-human"
     # warn: signal unchanged; emit a partial-coverage warning line
  RETURN { signal, discovery, coverage, rungs: results }
```

**Selection front-end.**

```
PROCEDURE selectRunnableRungs(root, cfg):
  records := extractRunCommandsWithContext(...)   # extended to carry runs-on per record
  # 1. exclusion filter — subtract from BOTH the rung set and eligible_steps
  runnableRecords := []
  FOR rec IN records:
     reason := exclusionReason(rec, cfg, localOs())   # github-context | os-mismatch | configured | null
     IF reason != null: log(rec, reason); CONTINUE
     runnableRecords.push(rec)
  # 2. recompute coverage over runnable records only (step-granularity, as 848)
  coverage := coverageOf(runnableRecords)
  # 3. build rungs from runnable recognised commands, then reuse 848's two-tier dedup + FAFF-533 suppression
  ciRungs := twoTierDedup(recognisedRungsOf(runnableRecords))
  localRungs := dedupLocalByKind(discoverPreCommit+PkgScripts+Makefile)   # unchanged; suppresses CI kinds
  rungs := mergeSuppressingCiKinds(localRungs, ciRungs)
  # 4. selftest aggregation — collapse regions selftest --region <x> into one --region all rung
  rungs := aggregateSelftest(rungs)
  # 5. per-kind cap — keep the cheapest max_rungs_per_kind of each kind
  rungs := capPerKind(rungs, cfg.max_rungs_per_kind)   # already cost-sorted
  discovery := rungs.length == 0 ? "none" : (coverage.ratio < cfg.partial_threshold ? "partial" : "confident")
  RETURN { rungs: sortByCost(rungs), discovery, coverage }
```

**Exclusion reason (precedence: configured > os-mismatch > github-context; any one excludes).**

```
PROCEDURE exclusionReason(rec, cfg, localOs):
  IF cfg.exclude.any(pat => rec.command.includes(pat)): RETURN "configured"
  IF rec.runs_on AND osFamily(rec.runs_on) != null AND osFamily(rec.runs_on) != localOs: RETURN "os-mismatch"
  IF /\$\{\{|\$GITHUB_|\$RUNNER_/.test(rec.command): RETURN "github-context"
  RETURN null
```

- `osFamily("macos-latest") = "macos"`, `"ubuntu-*" = "linux"`, `"windows-*" = "windows"`; an unrecognised/absent `runs-on` returns `null` → not excluded on OS grounds (fail toward running, since a missing `runs-on` is usually the default Linux runner). `localOs()` maps `process.platform` (`linux`/`darwin`/`win32`).

**Selftest aggregation.**

```
PROCEDURE aggregateSelftest(rungs):
  selftests := rungs.filter(r => /regions\s+selftest\s+--region/.test(r.command))
  IF selftests.length == 0: RETURN rungs
  keep := rungs.filter(r => !selftests.includes(r))
  agg := { kind: "STATIC_ANALYSIS", name: "static_analysis (ci-workflow: regions selftest --region all)",
           command: "node <faff> regions selftest --region all",   # same invocation prefix as the source steps
           source: "ci_workflow", cost_rank: min(selftests.cost_rank), required: true }
  RETURN keep + [agg]
```

The aggregate inherits the cheapest source rank so it sorts among the other `STATIC_ANALYSIS` rungs. It counts as **one** rung against `max_rungs_per_kind`.

**Config reads.** Mirror `gatesFallbackPolicy`: one `loadConfig(root)` + `dig` per key, each defaulting on absent/malformed. `gates.partial` accepts only `warn`/`needs-human` (else default `warn`); `gates.max_rungs_per_kind` coerces to a positive integer (else `5`); `gates.partial_threshold` to a `[0,1]` float (else `0.5`); `gates.exclude` to a `List<String>` (else `[]`, non-strings dropped, as `readConfiguredInstallTargets` does).

**Failure modes.**

- **The aggregate selftest flakes (budget state-sensitivity).** Signal: `faff gates run` returns `fail`/`needs-human` on a clean codebase, `regions selftest` in the failing rung's detail. Means: exclude `regions selftest` via `gates.exclude` until FAFF-561 clears; do not weaken the gate globally.
- **Coverage denominator wrong after exclusions.** Signal: `partial` fires (or doesn't) against intuition — e.g. an all-plumbing workflow reports high coverage because every real gate was excluded. Means: the ratio is over *runnable* steps by design; the log lists each exclusion+reason so a human can audit. A denominator of zero runnable eligible steps → ratio `1.0` (as 848), i.e. no `partial`.
- **A required CI step referencing `${{ }}` was a real gate.** Signal: a gate that matters is silently excluded as `github-context`. Means: `github-context` is intentionally conservative (context-referencing commands can't run locally); if a real gate is lost, the repo declares it locally (pkg/Makefile) — the local rung then runs and suppresses the CI kind.

**Anti-pattern:** feeding the widened recognition back into `discoverRungs`/`ciRunnerKind`. Why: that re-imports the execution set into discovery and re-breaks 848's isolation tests; the widening lives in the reporting resolver, and execution *consumes* it through the filtered front-end.

**Anti-pattern:** running an excluded step "just to be safe." Why: OS-mismatch and github-context steps cannot succeed locally; running them yields `errored`/`fail` noise that masks real gate failures.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose CI workflow declares `regions check`, `adr validate`, `prdr validate`,
      `regions selftest --region factory`, and `--region governance` (all recognised STATIC_ANALYSIS)
When `faff gates run` executes
Then it runs `regions check`, `adr validate`, `prdr validate`, and one aggregate
     `regions selftest --region all` rung (the two per-region steps collapsed to one),
     cheapest-first, and the `regions*` invariant lints actually execute (not just report)
```

```
Given a CI job on `runs-on: macos-latest` containing a `node --test` step, run on a Linux host
When `faff gates run` executes
Then that step is excluded (reason os-mismatch), is not run, and is subtracted from the
     coverage denominator
```

```
Given a workflow where runnable coverage is below `gates.partial_threshold` and `gates.partial: needs-human`
When `faff gates run` executes and all run rungs pass
Then the emitted signal is `needs-human` (partial coverage gated), not `pass`
```

```
Given `gates.exclude: ["regions selftest"]`
When `faff gates run` executes
Then no `regions selftest` rung runs (reason configured) and the remaining STATIC_ANALYSIS
     rungs still execute
```

## 6. Design decision rationale

**Where should execution get its rungs?** Options: (a) keep `discoverRungs`, widen it too — re-breaks 848 isolation and re-runs destructive commands through a resolver meant to stay narrow; (b) consume `discoverRungsReporting` behind a filter — one recogniser, execution subtracts what it can't run. **Chosen: (b)** — it is the only design consistent with both "execution unchanged in 848" and "execution runs the wider set in 639b."

**Per-region selftest or aggregate?** Options: run each `--region` as its own rung (up to per-region cost, and the ~63 per-command selftests behind them), or one `--region all`. **Chosen: `--region all` aggregate** — the human decision of 2026-08-19; it consumes one rung, matches CI's intended collapse (validate.yml comment), and keeps the ladder cheap.

**Absolute wall-clock target or relative?** The original FAFF-639 "≤2s" criterion was falsified and struck (2026-08-06 resolution). **Chosen: relative** — the added `STATIC_ANALYSIS` rungs keep `faff gates run` materially below the CI workflow's own runtime, bounded by `gates.max_rungs_per_kind` with `gates.exclude` as the escape. This is the ticket's acceptance anchor, measured against CI rather than an absolute.

**Threshold and caps — invent or calibrate?** The human decision was to calibrate from 848's measured report. **Measured (this repo, 2026-08-27):** 34 eligible steps, 11 recognised, ratio 0.32; widened kinds are 3 LINT / 5 STATIC_ANALYSIS (4 after selftest aggregation) / 3 UNIT. **Chosen defaults:** `max_rungs_per_kind: 5` (runs the full current recognised set, bounds a pathological one), `partial_threshold: 0.5` (0.32 < 0.5 → this repo reports `partial`, the honest signal), `partial: warn` (report, don't gate, until repos opt in), `exclude: []` (no repo-specific opt-outs shipped). These are conservative starting constants, revisited per repo via config.

## 7. Open questions and assumptions

**Open questions:** none blocking. The design questions (aggregate vs per-region, calibration source, wall-clock policy) were human-closed on 2026-08-19 and are carried as **Chosen** above.

**Assumptions:**
- **`regions selftest --region all` is sandbox-safe** (destructive factory selftest runs on its own fixtures). Validate: run it in a throwaway worktree; confirm no real repo state is touched.
- **Budget selftest state-sensitivity (FAFF-561) is resolved or the rung is excluded.** Validate: run the aggregate in a clean worktree; if it fails on budget state, ship/set `gates.exclude: ["regions selftest"]` until FAFF-561 clears. The cap and exclude keep this contained.
- **`runs-on` is capturable from the line scan.** Validate: `extractRunCommandsWithContext` already tracks job boundaries at 2-space indent; add a `runs-on:` capture at the same job scope. Confirm against `validate.yml`'s `impure-macos` job.

## 8. DONE — definition of done

### From WHY
- [ ] `faff gates run` executes the invariant-lint `STATIC_ANALYSIS` rungs (`regions check`, `adr validate`, `prdr validate`) that discovery recognises — verified by a rung with `status` present for each in `faff gates run --json`.

### From WHAT (config)
- [ ] `gates.partial` (`warn`|`needs-human`, default `warn`), `gates.max_rungs_per_kind` (int, default `5`), `gates.partial_threshold` (float, default `0.5`) added to the `config.js` DEFAULTS map and the DEFAULTS drift-check list; `gates.exclude` (list, default `[]`) read via `dig`.
- [ ] `.faffrc.example.yaml` documents the four keys under `gates:` (WRITABLE_NAMESPACES drift check stays green).
- [ ] Malformed values coerce to defaults (invalid `gates.partial` → `warn`; non-positive `max_rungs_per_kind` → `5`; out-of-range `partial_threshold` → `0.5`; non-list `gates.exclude` → `[]`).

### From HOW (selection)
- [ ] `runLadder` sources rungs from `discoverRungsReporting`, not `discoverRungs`.
- [ ] A `${{ }}` / `$GITHUB_` / `$RUNNER_` command is excluded (reason `github-context`), not run, and subtracted from `eligible_steps`.
- [ ] A step in a `runs-on: macos-latest` job is excluded on a Linux host (reason `os-mismatch`), not run, and subtracted from `eligible_steps`.
- [ ] A command matching a `gates.exclude` entry is excluded (reason `configured`) and not run.
- [ ] `regions selftest --region factory|governance` steps collapse to one `regions selftest --region all` rung that consumes one slot against the cap.
- [ ] `gates.max_rungs_per_kind` caps each kind to the cheapest N rungs.
- [ ] FAFF-533 preserved: a local rung of a kind suppresses all CI rungs of that kind.

### From HOW (signal)
- [ ] Runnable coverage `< partial_threshold` with `gates.partial: needs-human` and all rungs passing → signal `needs-human`.
- [ ] Same coverage with `gates.partial: warn` → signal `pass` + a partial-coverage warning line.
- [ ] The partial policy never lowers a `fail`/`needs-human` signal.
- [ ] `discovery: none` fallback and cheapest-first fail-fast behaviour unchanged.
- [ ] Emitted `faff-contract:quality-gates` block still conforms (`signal ∈ {pass,fail,needs-human}`; no new fields).

### Integration smoke test
```
1. In a clean worktree of this repo, run `faff gates run --json`.
2. Assert: STATIC_ANALYSIS rungs for regions check / adr validate / prdr validate / regions selftest --region all are present with a status.
3. Assert: no rung command contains `${{`, `$GITHUB_`, or targets macos.
4. Assert: the emitted quality-gates contract block parses and conforms.
```

### From testing
- [ ] `faff gates --selftest` extended with cases for each exclusion reason, the selftest aggregation, the per-kind cap, and the partial-signal branch; 848's execution-isolation cases still pass (or are re-expressed to reflect the intended widening).

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
