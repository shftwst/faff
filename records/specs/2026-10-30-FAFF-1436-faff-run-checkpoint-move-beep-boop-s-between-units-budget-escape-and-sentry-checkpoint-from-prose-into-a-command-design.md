*Agent-written (Claude Code): FAFF-1436 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1–3. Accepted by the operator 2026-10-30 (human accept after round 3; evidence comment e9f56429).*

# FAFF-1436: faff run checkpoint — move beep-boop's between-units budget, escape and sentry checkpoint from prose into a command

> Spec: faffter-dark-nlspec · 2026-10-30 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1436.

This spec is for the build agent and its reviewers. It is slice B of the FAFF-1413 re-slice. It replaces beep-boop's canonical between-units checkpoint procedure with one verb, `faff run checkpoint`, on the `faff run` dispatcher that slice A (FAFF-1435, #1168) shipped.

## 1. WHY

**The load-bearing idea:** every step of the checkpoint is already a CLI call. The prose's job is the call order, how to read each result, and which combinations stop the run. That ordering and branching becomes code, and the skill keeps one call plus one branch on a typed `action`.

**Problem.**
- The procedure ("The check", "When the check fires", "The interrupt" and its acting table) is about 45 lines of `faff-beep-boop/SKILL.md`, re-read on every turn of every drain. Steps 3, 7 and 8.1, and `faff-plot`, call it by reference.
- It carries the run's kill-switch: the fail-closed branch for an unreadable consult, and the attendedness × intervention acting table. None of that sequencing is tested.
- The prose is not followed reliably. Of the 20 most recent local beep-boop run dirs, 12 hold no `sentry-checkpoint` event, and 18 hold no `budget-checkpoint` event, which the Run-event log table lists as a checkpoint emission.
- The prose never orders two trips at one checkpoint. In particular, `faff sentry check` reads the budget itself and trips `budget-breach` → `abort` on a `stop` or `escalate` breach (`sentry.js` l. 155 and l. 410–414). So at L4 every budget escalation also carries an acting abort, and the prose does not say which one the run reports.

### Design principles

**Compose, never re-implement.** The verb spawns the existing subcommands (`budget check`, `effects check`, `effects reconcile-merges`, `sentry check`, `sentry abort`, `events append`, `andon pump`) and calls `sentry.js`'s exported `actsOnSentryAbort` and `actsOnSentryPause` for the acting decision. Trigger maths, budget accounting and escape detection stay where they are.

**Local effects only; return tokens for the rest.** The verb performs only effects the CLI already performs: event appends, the andon pump, and `sentry abort`'s ledger mark. A park, a narrowing and a methodology pick are tracker writes or judgements, so they are returned as typed fields for the skill.

**Fail toward supervision.** Every read the prose treats as non-clean on failure stays non-clean. A read the prose left unspecified fails in the direction that keeps the kill-switch armed.

### Reference context

| System | Relevance |
|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` (681 lines at `56eb34c3`) | The prose replaced: "The check" (l. 83–95), the phase-scope sentence (l. 99), "The interrupt" (l. 103–122), and step 8.1's budget routing (l. 267). |
| `bin/lib/run.ts` (FAFF-1435) | The `faff run` dispatcher; its `VERBS` table gains `checkpoint`. |
| `bin/lib/run-summary.ts` (FAFF-1435) | The injected-`deps` pattern this verb follows. |
| `bin/lib/sentry.js` | `actsOnSentryAbort` / `actsOnSentryPause` / `resolveAbortAxisUnattended` (l. 278–303). `sentry check` exits 3 with an `indeterminate: true` payload whose `intervention` reads `"continue"` (l. 1141–1146). `SIGNAL_TRIP_INTERVENTION` (l. 154). The verdict fields that name an issue: `member` (l. 527, l. 757), `evidence.issue` on scope-drift (l. 654, l. 668), `evidence.in_flight` on the in-flight grace (l. 853). |
| `bin/lib/budget.js` | `budget check` exits 3 with `outcome: "indeterminate"` on its own ledger fault (l. 929–939). Its session precedence is flag > open span > `measure_session_id` > ambient (l. 977). |
| `bin/lib/effects.js`, `bin/lib/effects-reconcile.js` | `effects check` and `effects reconcile-merges` always exit 0 with `--json`; detection is in the payload (effects-reconcile.js l. 524–536). |
| `bin/lib/regions.js`, `bin/lib/lint-cli-coverage.js` | `run: "factory"`, `REGION_SELFTEST_ARGV.run = null`, `TEST_FILE_COVERAGE.run`. |
| `plugin/skills/faff-plot/SKILL.md` l. 58, `plugin/skills/faffter-dark-concurrency-parallel/SKILL.md` l. 51 | Two references to "The interrupt" and "the existing handling table". |

### Already shipped against this surface

- FAFF-1435: the `faff run` dispatcher and `run summary`.
- The building blocks above. None composes the checkpoint. The premise holds.

## 2. OUT OF SCOPE

- **`run open` and `run close`.** FAFF-1437 (slice C).
- **The budget envelope prose** ("Budget flags" intro, the dimension table, the config block, the `max_attempts` paragraph) and the token-accounting bullet. They document the envelope, not the checkpoint, and stay.
- **The concurrency executor's per-poll `sentry check`** and its member-park procedure (`faffter-dark-concurrency-parallel`). It stays as it is; only its pointer to the deleted table is repointed. Extension point: the executor calling `faff run checkpoint --phase build` per poll.
- **`sentry-poller`.** It keeps its own consult and acting.
- **Changing `sentry check`'s own budget read.** It stays unscoped by phase and unpinned to root and session.

## 3. WHAT

### Interface

```
faff run checkpoint --run-dir DIR --phase prep|build|wave [--root DIR] [--session-id ID] [--json]
```

```
RECORD CheckpointResult:
  action: ENUM continue | narrow | park-issues | stop | escalate | abort | fail-closed
  stop_reason: StopToken | null      # set iff action ∈ {stop, escalate, abort}; null on fail-closed
  budget: BudgetState | null         # budget check's JSON verbatim; null when the read failed
  budget_in_scope: [Dim]             # budget.breached filtered by --phase
  forbidden: bool
  intervention: ENUM continue|surface|pause|correct|abort | null   # null when the consult failed
  verdicts: [Verdict]                # the consult's verdicts, verbatim ([] when it failed)
  acted: bool                        # this run acts on `intervention`
  sentry_aborted: bool               # `faff sentry abort --run-dir` ran and exited 0
  park_issues: [IssueId]             # non-empty iff action = park-issues
  needs_judgement: [ { kind: "narrow-subset" | "correct-narrowing" | "pause-unattributed", issue?: IssueId } ]
  faults: [String]
```

**Exit codes.** 0 = keep dispatching (`continue`, `narrow`, `park-issues`). 3 = stop dispatching (`stop`, `escalate`, `abort`, `fail-closed`). 2 = usage error, a missing or malformed ledger, or a run dir that is not `<root>/.faff/runs/<run-id>`.

Without `--json` it prints `checkpoint: <action>` plus the stop reason when set, then one `fault: <name>` line per `faults` entry, and the same exit code.

**Exit 2 and unreadable output.** Exit 2 prints no CheckpointResult. The caller treats exit 2, any exit other than 0 or 3, and a `--json` stdout that does not parse as a CheckpointResult exactly as `fail-closed`, at every level: a checkpoint that cannot read its own run must never let the next unit dispatch.

### Root and session

**Chosen:** `root := --root` if given, else `ledger.budget.measure_root`, else the repo root above the run dir. When `--root` and `ledger.budget.measure_root` are both present and differ, the ledger value is used and `root-drift` is added to `faults`. When neither is present, the inferred root is used and `root-inferred` is added to `faults`, so a run consulting config under an unpinned root is visible in the result. The run dir must resolve to `<root>/.faff/runs/<basename(run-dir)>`, else exit 2. Rationale: the pinned root is what keeps budget accounting measurable after a cwd reset, and the `--run <run-id>` subcommands resolve the run under that root, so a mismatch would read another run.

**Chosen:** `--session-id` is forwarded verbatim to `budget check` and to the `budget-checkpoint` event when the caller passes it, which beep-boop does, exactly as the prose does today (kept). When a caller omits it, the verb omits it too and never substitutes `ledger.budget.measure_session_id`, so `budget check`'s own precedence (open span > `measure_session_id` > ambient) applies. Rationale: the verb must not change which session is metered; substituting the mint-time session would override a resumed run's open span.

### Where the code lives

**Chosen:** `bin/lib/run-checkpoint.ts` with a committed `run-checkpoint.js` emit, registered as `checkpoint` in `run.ts`'s `VERBS`. It contains no `as`, `!` or `satisfies`. It is added to the `tsconfig.json` include list, to `test/check-no-boundary-cast.test.mjs`'s pinned list, and to `build-manifest.json`. `TEST_FILE_COVERAGE.run` becomes `["test/run-summary.test.mjs", "test/run-checkpoint.test.mjs"]`. No `--selftest`; `run` stays in the factory region. Rationale: it is the module the parent spec named, and factory→governance requires (`sentry.js`, `budget.js`) are legal.

The module exports a pure `decideCheckpoint(inputs) → Decision` (§4.2) and `runCheckpoint(args, deps)`, where `deps` injects every spawn, the config read and the clock. `inputs` is `{phase, level, acts_abort, acts_pause, budget, consult}`, the already-read values. `Decision` is `{action, stop_reason, acted, abort_required, park_issues, needs_judgement}`. `decideCheckpoint` spawns nothing. `runCheckpoint` performs the reads, calls it, then runs `faff sentry abort` iff `abort_required`, and assembles the CheckpointResult.

## 4. HOW

### 4.1 Procedure

```
PROCEDURE run_checkpoint(run_dir, phase):
  0. Read the ledger (missing or malformed → exit 2). run_id := basename(run_dir). Resolve root (§3).
     level := ledger.level. cfg := readGovernanceConfig(root). acts := actsOnSentryAbort(ledger, cfg).
  1. budget := `faff budget check --json --run-dir <run_dir> --root <root> [--session-id S]`.
     FAILED when: exit ≠ 0, OR stdout is unparseable, OR outcome ∉ {none, stop, narrow, escalate},
     OR breached is not an array of strings. Failed → budget := null, fault "budget-check-failed".
     budget_in_scope := phase=prep ? breached ∩ {until} : breached.
  2. Append {phase:"run", type:"budget-checkpoint", data:<budget>} via
     `faff events append --run <run_id> --root <root> --tokens [--session-id S]`, only when budget ≠ null.
     A failed append is a fault, never a stop.
  3. check := `faff effects check --run <run_id> --root <root> --json`.
     Non-zero or unparseable → {any_escape:false}, fault "effects-check-failed".
  4. rec := `faff effects reconcile-merges --run <run_id> --root <root> --json`.
     Non-zero or unparseable → {reconciled:false}, fault "reconcile-merges-failed".
     legacy_exempt:true is clean. forbidden := check.any_escape OR rec.any_escape OR rec.reconciled === false.
  5. sentry := `faff sentry check --json --run-dir <run_dir>` (+ `--forbidden-side-effect` iff forbidden).
     The consult FAILED when: exit ≠ 0, OR stdout is unparseable, OR payload.indeterminate === true,
     OR intervention ∉ {continue, surface, pause, correct, abort}, OR verdicts is not an array.
     Completed → append {type:"sentry-checkpoint", data:<payload verbatim>}; if payload.tripped also
     {type:"sentry-trip", data:{verdicts, intervention}}. Failed → append nothing, fault "sentry-consult-failed".
  6. decision := decideCheckpoint(inputs) (§4.2).
  7. If decision.abort_required: spawn `faff sentry abort --run-dir <run_dir>`;
     exit 0 → sentry_aborted := true; non-zero → fault "sentry-abort-failed". The action is unchanged
     either way: an abort the CLI could not mark still stops dispatching.
  8. `faff andon pump --run-dir <run_dir>`; non-zero is a fault (fail-open).
  9. Print the result; exit 0 or 3.
```

### 4.2 Decision

```
  abort_required := intervention = abort AND acts      (computed first; independent of the rows below)
  a. (consult failed OR budget = null) AND acts            → fail-closed, stop_reason null.
  b. "escalate" outcome with budget_in_scope ≠ []           → escalate, "budget-escalated(<dims>)".
  c. abort_required                                         → abort, "sentry-abort".
  d. "stop" outcome with budget_in_scope ≠ []               → stop, "budget-hit(<dims>)".
  e. intervention = correct AND level = L4                  → continue + needs_judgement
                                                              {kind:"correct-narrowing", issue}.
  f. intervention ∈ {pause, correct} AND actsOnSentryPause  → park-issues with the named issues;
                                                              none named → continue + {kind:"pause-unattributed"}.
  g. "narrow" outcome with budget_in_scope ≠ []             → narrow + {kind:"narrow-subset"}.
  h. otherwise                                              → continue.
```

`<dims>` is `budget_in_scope` joined with `,`. `acted` depends only on the intervention, never on the action: `acts` for abort and pause; for correct, `true` at L4, else `actsOnSentryPause`; `true` for surface; `false` for continue and for null (a failed consult). So a `fail-closed` from a failed consult has `acted: false`, and a `fail-closed` from a failed budget read keeps the completed consult's value.

**Named issues** (row f) are the deduplicated union, in verdict order, over trip-severity verdicts of `member`, `evidence.issue` and each `evidence.in_flight` entry. The verb reads these fields; it never re-derives which signal maps to which intervention.

**Chosen:** escalate ranks above abort (b before c), and the abort's ledger mark still runs (`abort_required`, step 7). Rationale:
- At an acting run, a budget `escalate` breach always trips sentry's `budget-breach` → `abort` too (`sentry.js` l. 155, l. 413).
- With abort first, every L4 budget escalation would report `sentry-abort` and drop the needs-human escalation, which is the only thing `escalate` adds over `stop`.
- Computing `abort_required` apart from the action keeps the ledger `aborted-resumable` mark the prose's abort row requires. Nothing the prose did is skipped.

**Chosen:** abort ranks above a budget `stop` (c before d). Rationale: both end dispatch, and abort also records the resumable mark and names its verdicts.

**Chosen:** at a non-L4 run, `correct` is handled as `pause` (f). Rationale: sentry produces `correct` only by upgrading a `fix-review-thrash` pause when corrective authority is available (`sentry.js` l. 825). The prose left `correct` advisory below L4, so a declared-unattended L3 run would act on the pause but not on its upgrade. Treating it as the pause it upgrades never acts less than the un-upgraded signal would.

**Chosen:** a budget read failure fails closed on acting runs (a). Rationale: `sentry check` reads the same budget and goes indeterminate on the same fault, so this is the consult-failed branch reached one step earlier, with its own fault name.

**Anti-pattern:** parking, narrowing or authoring a correction inside the CLI. Why: each is a tracker write or a judgement. The verb returns `park_issues` and `needs_judgement`, and the skill acts.

### 4.3 Skill changes

`faff-beep-boop/SKILL.md`:
- "The check" keeps its first sentence, reworded to name `faff run checkpoint`, and the token-accounting bullet. The `BudgetState` block and the at-ceiling outcomes bullet go; the outcomes move into the routing table below.
- "When the check fires" keeps the boundaries, the in-flight paragraph and the `max_attempts` launch note. The phase-scope sentence goes (`--phase` does it).
- "The interrupt" becomes: the derailment purpose sentence, one call `faff run checkpoint --run-dir "$run_dir" --phase <prep|build|wave> --root "$measure_root" --session-id "$session_id" --json`, and a routing table over `action`:
  - `continue`: proceed. Write a run-scoped surface when `intervention` is `surface`.
  - advisory (`acted` false and `intervention` is pause, correct or abort): log the verdicts to the run log and surface them (`/faff-wtf`), then proceed. The CLI has already appended them to `events.jsonl` (the shared telemetry and calibration feed).
  - `narrow`: dispatch only the methodology's cheapest remaining admissible subset.
  - `park-issues`: run the shared park protocol on `park_issues`.
  - `stop` / `escalate` / `abort`: stop dispatching, exit to reporting with `stop_reason`; `escalate` also emits the needs-human signal.
  - `fail-closed`: stop dispatching, surface needs-human "kill-switch evaluator down".
  - exit 2, any other non-zero exit, or unparseable output: handled as `fail-closed`, at every level (§3).
  - each `needs_judgement` entry: `correct-narrowing` → `faff sentry abort --issue <id> --worktree <path>` then `faff corrective author`; `pause-unattributed` → surface the verdicts.
- The aborted-run-is-resumable sentence and the `sentry-poller` cooperative/detached sentence stay. The acting paragraph, the acting table and the abort/pause attendedness paragraph go.
- Step 8.1 keeps its wave-boundary role (the last budget gate, the convergence short-circuit) and routes on `action` instead of restating the outcomes.
- `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the new count.

`faff-plot/SKILL.md` l. 58 points at `faff run checkpoint --phase prep`, halting on any non-zero exit (3 or 2) and also on a `faults` entry `sentry-consult-failed` or `budget-check-failed` (its stricter attended rule, unchanged). `faffter-dark-concurrency-parallel/SKILL.md` l. 51 replaces "the existing handling table" with "`faff run checkpoint`'s abort rule".

### 4.4 Edge cases

- **A legacy run** (no mint marker): `reconcile-merges` reports `legacy_exempt`, which is clean.
- **No declared-effects ledger**: `effects check` reports clean, as today.
- **An attended run whose consult fails**: `fault` recorded, `intervention: null`, decision continues at b with the budget.
- **An attended run whose budget read fails**: `budget: null`, no budget rows apply, consult still runs.
- **Prep phase with a tokens breach** at an acting run: the checkpoint's own budget rows ignore it, but sentry's unscoped budget read trips abort, so the result is `abort`. This is today's behaviour and is kept (OUT OF SCOPE).

### 4.5 Tests (in `test/` only, `node --test`, no `--selftest`)

`test/run-checkpoint.test.mjs`, one named case per inventory row (the names the inventory cites):
- "acting matrix": `decideCheckpoint` for consult-failed, surface, pause, correct and abort at L4, attended L3 and declared-unattended L3, asserting `action`, `stop_reason` and `acted` on each, including `acted: false` on a consult-failed `fail-closed`; "alias honoured": the same rows with `sentry_acting` in place of `unattended`; "consult fail × 3 levels"; "surface continues"; "pause matrix"; "correct L4"; "correct L3 as pause"; "abort acting / attended".
- "precedence": escalate + abort (with `abort_required` still true), stop + abort, stop + pause, narrow + pause.
- "budget args pinned", "budget stop", "budget narrow", "budget escalate", "prep ignores tokens", "phase wave", "budget fail × 2" (acting and attended), "budget malformed" (outcome or breached out of shape).
- "effects check fault", "forbidden combine", "legacy exempt", "reconcile unparseable", "forbidden flag passed".
- "indeterminate consult" (exit 3 with `intervention: "continue"`), "consult malformed" (intervention out of enum, verdicts not an array).
- "events": `budget-checkpoint` and `sentry-checkpoint` on a completed consult, `sentry-trip` on a trip, no sentry events on a failed consult.
- "andon fail-open": a non-zero pump leaves the action unchanged and adds a fault.
- "abort spawn fails": action stays `abort`, exit 3, `sentry_aborted` false, fault recorded.
- "named issues" (from `member`, `evidence.issue`, `evidence.in_flight`) and "unattributed pause".
- "root drift", "root inferred", "outside root" (exit 2), "malformed ledger" (exit 2), "unknown verb" (`faff run bogus` exits 2 naming both verbs), "human output" (without `--json`, one `fault:` line per fault).
- "real CLI": one end-to-end run on a legacy-exempt fixture with no derailment: exit 0, `action: "continue"`.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a declared-unattended L3 run (autonomous.unattended: true)
When `faff sentry check` for that run exits non-zero and `faff run checkpoint --phase build --json` runs
Then it exits 3
And action is "fail-closed" and stop_reason is null
And no sentry-checkpoint event is appended
```

```
Given an attended L3 run whose events make `faff sentry check` return intervention "abort"
When `faff run checkpoint --phase build --json` runs
Then it exits 0
And action is "continue" and acted is false
And the ledger's owner.status is not "aborted-resumable"
```

```
Given an attended L3 run whose budget envelope has an until ceiling in the past and at_ceiling stop
When `faff run checkpoint --phase prep --json` runs
Then it exits 3
And stop_reason is "budget-hit(until)"
```

```
Given a run dir that is not under the --root directory passed
When `faff run checkpoint --run-dir D --root R --phase build` runs
Then it exits 2
```

## 5. DESIGN DECISION RATIONALE

- **Spawn the subcommands rather than call them in-process.** They are what the prose runs, their exit codes carry the fault semantics, and `sentry check`'s indeterminate path exits early. The acting predicates and the config reader are called in-process because they are pure and already exported.
- **One pure decision function.** The kill-switch logic becomes a table-driven unit test rather than an integration path.
- **No captured decision kernel.** The 128 records in `verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl` cover `next`, `eligible`, `run-outward`, `run-start` and `run-done` only. The checkpoint composes none of them, so no corpus replay applies.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** the skill passes `--root "$measure_root" --session-id "$session_id"` as it does today, so the root-drift fault fires only on a genuine drift.

## Rule inventory

Disposition key: `kept` = the command does what the prose says; `changed` = differs, with the reason; `dropped` = not carried, with the reason.

| # | Prose rule (`faff-beep-boop` §) | Command behaviour | Covering test | Disposition |
|---|---|---|---|---|
| B1 | The check: `faff budget check` at each checkpoint with pinned root and session | step 1 | "budget args pinned" | kept |
| B2 | `stop`: stop dispatching, `budget-hit(<dims>)` | d, exit 3 | "budget stop" | kept |
| B3 | `narrow`: dispatch the methodology's cheapest subset, re-check | g, `narrow-subset` | "budget narrow" | changed: the pick is returned as judgement |
| B4 | `escalate`: stop and emit needs-human, `budget-escalated(<dims>)` | b, exit 3 | "budget escalate" | kept |
| B5 | Phase scope: `until` gates both phases, the rest build only | `budget_in_scope` | "prep ignores tokens" | kept |
| B6 | Between units only; no mid-issue cancel; in-flight finish | called at boundaries | (skill text) | kept in prose |
| B7 | `effects check`: missing ledger clean; non-zero is a fault read as no escape | step 3 | "effects check fault" | kept |
| B8 | `reconcile-merges`; forbidden combine; `legacy_exempt` clean; `reconciled:false` non-clean | step 4 | "forbidden combine", "legacy exempt" | kept |
| B9 | `sentry check` + `--forbidden-side-effect` iff forbidden | step 5 | "forbidden flag passed" | kept |
| B10 | Completed consult appends `sentry-checkpoint`, a trip also `sentry-trip`; failed emits none | step 5 | "events" | kept |
| B11 | `andon pump` after acting, fail-open | step 8 | "andon fail-open" | kept |
| B12 | The consult always runs; acting is per intervention on attendedness | a–f with `actsOnSentryAbort`/`Pause` | acting matrix | kept |
| B13 | Consult fails: L4 or declared-unattended fail closed, needs-human; attended logs and continues | a | "consult fail × 3 levels" | kept |
| B13a | Attended run: log + surface the verdicts (telemetry and calibration feed), no dispatch action | `acted: false` + the advisory routing row; events appended at step 5 | "abort acting / attended", "events" | kept |
| B14 | `surface`: run-scoped log + `/faff-wtf`; never park or abort | h, `acted: true` | "surface continues" | kept |
| B15 | `pause`: acting runs park the named issues and continue; attended logs | f, `park_issues` | "pause matrix" | changed: the park is returned to the skill |
| B16 | `correct` at L4: abort the issue resumably, author the narrowing | e, `correct-narrowing` | "correct L4" | changed: returned as judgement |
| B17 | `correct` below L4: log + surface | f | "correct L3 as pause" | changed: handled as the pause it upgrades |
| B18 | `abort`: acting run runs `faff sentry abort --run-dir`, launches nothing | c + step 7, exit 3 | "abort acting / attended" | kept |
| B19 | Declared unattended = `autonomous.unattended` or `sentry_acting` alias | `actsOnSentryAbort` | "alias honoured" | kept |
| B20 | Unreached issues land in `## Unreached`, unparked | (skill and `run summary`) | (skill text) | kept in prose |
| B21 | Step 8.1: route on the budget outcome at the wave boundary | routes on `action` | "phase wave" | kept |
| B22 | (none) | precedence between trips | precedence cases | changed: new; the prose left it unordered |
| B23 | (none) | budget read failure fails closed on acting runs | "budget fail × 2" | changed: new; the prose did not say |
| B24 | (none) | unparseable `reconcile-merges` → `reconciled:false` | "reconcile unparseable" | changed: new, non-clean like a fault |
| B25 | (none) | sentry exit 3 / `indeterminate`, or an out-of-shape payload, counts as failed; same for budget | "indeterminate consult", "consult malformed", "budget malformed" | changed: new; made explicit |
| B26 | Run-event log: `budget-checkpoint` event, token-tagged | step 2 | "events" | changed: the procedure never emitted it |
| B27 | (none) | a pause naming no issue → `pause-unattributed` | "unattributed pause" | changed: new |
| B28 | (none) | root drift and root inferred faults; run dir outside root exits 2; faults printed on the human path | "root drift", "root inferred", "outside root", "human output" | changed: new |
| B29 | (none) | an abort the CLI could not mark still stops dispatching | "abort spawn fails" | changed: new |
| B30 | (none) | the caller treats exit 2 or unreadable output as `fail-closed` | (skill text; "malformed ledger") | changed: new |

## 7. DONE

### From WHY
- [ ] `faff-beep-boop/SKILL.md` calls `faff run checkpoint` and routes on `action` in place of the procedure, and `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the new count.
- [ ] `faff validate-adapters` passes with no RATCHET finding for `faff-beep-boop`.

### From WHAT
- [ ] `faff run checkpoint --json` prints a CheckpointResult with every field in §3, and exits 0, 3 or 2 per §3.
- [ ] `run-checkpoint.ts` is in `tsconfig.json` `include`, with committed `run-checkpoint.js` and `build-manifest.json`; `check-no-boundary-cast` passes and its test pins `run-checkpoint.ts`.
- [ ] `TEST_FILE_COVERAGE.run` names `test/run-checkpoint.test.mjs`; `faff regions check` and `faff lint-cli-coverage` pass; no selftest block gains a case.
- [ ] The PR diff touches no `commissaire*` file.

### From HOW
- [ ] `decideCheckpoint` returns the §4.2 action for each acting-table row at L4, attended L3 and declared-unattended L3.
- [ ] A `sentry check` that exits 3 with `intervention: "continue"` and `indeterminate: true` yields `fail-closed` on an acting run.
- [ ] `faff-plot/SKILL.md` and `faffter-dark-concurrency-parallel/SKILL.md` no longer reference the deleted table.

### Rule inventory
- [ ] Every line the PR deletes from `faff-beep-boop/SKILL.md` maps to a row B1–B30. The PR description lists the deleted line ranges against row ids.
- [ ] Every `kept` and `changed` row's covering test exists and passes.

### Tests
- [ ] `test/run-checkpoint.test.mjs` and `test/run-summary.test.mjs` pass under `node --test`.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. It is one verb (one TypeScript module with a pure decision function), one test file and a skill edit across three SKILL.md files. That is a 1–3 day unit.
- **Workstream fit?** No issues. It is slice B of the FAFF-1413 re-slice, in the prose-to-command lane.
- **Deps surfaced?** No issues. FAFF-1435 (the `faff run` dispatcher) is Done; this blocks FAFF-1437. It changes no governance module.
- **Risk profile?** One risk worth naming: this is the run's kill-switch. The precedence table, the escalate-over-abort choice and the correct-as-pause choice change what an unattended run reports, so they are pinned by `decideCheckpoint` unit tests and two holdout scenarios rather than by integration alone. No novel integration.
