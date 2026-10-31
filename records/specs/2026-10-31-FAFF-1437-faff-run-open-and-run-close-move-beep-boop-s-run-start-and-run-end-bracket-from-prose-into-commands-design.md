*Agent-written (Claude Code): FAFF-1437 spec, produced by interactive prep for the operator. Revised after spec-review rounds 1 and 2.*

# FAFF-1437: faff run open and run close — move beep-boop's run-start and run-end bracket from prose into commands

> Spec: faffter-dark-nlspec · 2026-10-31 · interactive · claude-code/unknown · faff 0.44.0 · confidence: high. Full spec on Linear FAFF-1437.

This spec is for the build agent and its reviewers. It is slice C, the last slice, of the FAFF-1413 re-slice. It replaces beep-boop's run-start bracket ("Run ledger" mint paragraph, "Owner stamp & heartbeat" run-start bullets, the Commissaire admit) and its run-end bracket (the orchestrator-exit close, the governed conclude, the git-only anchor and bundle, the judge-trail mint, the `run-end` event) with two verbs, `faff run open` and `faff run close`, on the `faff run` dispatcher that slices A (FAFF-1435, #1168) and B (FAFF-1436, #1169) shipped.

## 1. WHY

**The load-bearing idea:** every step of both brackets is already a CLI call. The prose only orders the calls and says which failures stop the run. The run-start bracket carries the governance fail-closed paths (status-probe failure, a required admit that fails, an unreachable configured governor), and none of them is tested. As code, each becomes a tested branch, and the skill makes one call per bracket.

**Problem.** About 20 dense lines of `faff-beep-boop/SKILL.md` (l. 391, 428–444, 450–457, 581 on `main` `948a8f1d`; several are paragraphs of 300+ words) are re-read on every turn of every drain. They describe a sequence with eight possible exits, and the governance branch alone has five outcomes. A misread there either starts an ungoverned unattended run that can never legally merge, or wastes a build.

### Design principles

- **Compose, never re-implement.** Each verb spawns the existing subcommand (`run-ledger init-self-drain`, `harness identify`, `budget baseline`, `commissaire contract status|admit|admit-required`, `effect reconcile`, `verdict conclude`, `sentry-poller start|stop`, `hooks-ensure`, `events append|anchor-run`, `bundle publish`, `judge-trail mint`, `andon pump`) or calls an exported pure function (`envelopeFrom` in `budget.js`, `auditLedger` in `runcheck.js`, `mutateLedgerUnderLock` in `heartbeat.js`). No accounting, signing or anchoring logic moves.
- **Local effects only.** The verbs perform the effects the prose performs today: ledger edits under the ledger lock, event appends, the andon pump, the governance sentinel, the git-only anchor commit. No tracker or network read of their own (the Commissaire subprocesses keep their own behaviour, unchanged).
- **Fail closed where the prose fails closed.** The governance branches keep their current semantics exactly. Every new failure mode this spec adds resolves toward "started nothing" at open and "governed" at close.

### Reference context

| System | Relevance |
|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` (676 lines at `948a8f1d`) | The prose replaced: l. 391 (mint), 428–438 (run-start owner, export, poller, budget, admit), 440–444 (exit close, conclude, anchor, bundle, judge-trail), 450–457 (hooks-ensure), 581 (`run-end` and andon). |
| `bin/lib/run.ts` | The dispatcher. `VERBS` gains `open` and `close`. |
| `bin/lib/run-checkpoint.ts` (FAFF-1436) | The pattern: injected `deps`, the root resolution rule, a spawn that throws read as a failed step. |
| `bin/lib/run-ledger.js` | `init-self-drain` mint: run dir, L3 ledger with a `running` owner and `faff_version`, genesis `events.jsonl`. |
| `bin/lib/lights-out.js` | `mintLightsOut`: an L4 ledger with its own owner and a full `budget` block. `init-self-drain` never runs for it. |
| `bin/lib/heartbeat.js` | `mutateLedgerUnderLock`: the locked, schema-checked ledger edit; `level` is write-once. |
| `bin/lib/budget.js` | `envelopeFrom(cfg, flags)` and `resolveUntil` (FAFF-364 malformed `until`); `budget baseline` (write-once triple). |
| `bin/lib/runcheck.js` | `auditLedger`: `admitted − outcomes`. |
| `bin/lib/sentry.js` | `faff sentry abort` flips a `running` owner to `aborted-resumable` and never resurrects a `done` one. |
| `bin/lib/commissaire.js` | `contract status`, `contract admit` (prints `governor_unreachable:true` on an unreachable configured governor), `contract admit-required` (exit 0 always). Called unchanged. |
| `bin/lib/disposition.js` | `governance-admit-failed` and `sentry-abort` are escalate-class stop tokens. |
| `bin/lib/run-summary.ts` | Reads `ledger.stop_reason` for the `Stop reason:` line, so `run close` must run before `run summary`. |

### Already shipped against this surface

- FAFF-1435: `faff run summary` and the `faff run` dispatcher.
- FAFF-1436: `faff run checkpoint`, including `effects reconcile-merges` between units.
- FAFF-966: the `init-self-drain` mint. FAFF-1034/FAFF-1140/FAFF-1176: the admit, `admit-required` and status probe. FAFF-796/FAFF-819/FAFF-994: anchor-run, run-close bundle, judge-trail.

None of them composes the bracket. The premise holds.

## 2. OUT OF SCOPE

- **§0a run-start trigger and the inherited-L4 reuse.** FAFF-1418 owns it. The skill never calls `run open` on the `inherited-l4` path, which mints no run (unchanged).
- **The heartbeat at boundaries** ("Refresh the heartbeat across the WHOLE graft lifecycle"). It stays prose: it is one `faff heartbeat` call per boundary, not a bracket step.
- **Step 11 runcheck, step 11.5 reconcile and step 11.6 annotations.** They stay prose and run before `run close`. `run close` re-checks completeness as a guard, it does not replace step 11's "dispatch or park them" judgement.
- **A terminal bucket for admitted issues an aborted run never reached.** `faff sentry abort` deliberately writes no outcome for them, so the run stays re-enterable (`sentry.js` `applySentryAbort`). `close` reports them and leaves them for `faff resume` (§4.2 step 2); it invents no bucket.
- **The runcheck Stop hook's treatment of an aborted run.** Unchanged; `close` does not alter what `runcheck --hook` decides.
- **The ledger fields `admitted`, `outcomes` and the annotation arrays.** Still written by prose at steps 4, 7 and 8.
- **FAFF-1444's `until` anchoring.** `run open` must preserve the owner fields FAFF-1444 adds; it does not compute deadlines.

## 3. WHAT

### Interface

```
faff run open   (--mode M | --adopt-run-dir DIR) [--until HH:MM] [--max N]
                --root DIR --session-id ID [--export | --json]
faff run close  --run-dir DIR --stop-reason TOKEN [--git-only] [--root DIR] [--session-id ID] [--json]
```

```
RECORD OpenResult:
  run_dir: Path                    # absolute
  governance: ENUM admitted | already-governed | ungoverned-optional | fail-closed
  fail_closed_cause: ENUM commissaire-status-failed | governance-required | governor-unreachable | null
  budget_envelope: Object | null   # the envelope now on the ledger
  steps: { mint, enrich, envelope, baseline, governance, poller, hooks }   # each "ok" | "skipped" | "failed:<detail>"
  hooks_report: String | null      # hooks-ensure's own stdout line, for the skill to relay
  faults: [String]

RECORD CloseResult:
  closed: bool
  undispatched: [IssueId]          # admitted issues with no outcome: the refusal list, or (abort exemption) the resume's work
  abort_exempt: bool               # true iff step 2's abort exemption applied
  owner_status: ENUM done | aborted-resumable | null
  steps: { run_end, owner_close, poller_stop, governance_probe,
           conclude: [{issue, reconcile_exit, conclude_exit}],
           anchor_run, anchor_commit, bundle_publish, judge_trail, andon }   # each "ok" | "skipped" | "failed:<detail>"
  faults: [String]
```

`<detail>` is the step's exit code, or for `steps.governance` on the fail-closed path, the `fail_closed_cause`.

**Field values by exit.** `--json` always prints the whole record:
- `open` exit 0 or 3: every field set; `fail_closed_cause` is null on 0. Exit 2: `run_dir` is the minted or adopted dir when one exists (a post-mint failure), else null; `governance`, `fail_closed_cause` and `budget_envelope` are null; steps not reached are `"skipped"`; the reason is the last entry of `faults`.
- `close` exit 0: `closed: true`, `owner_status` as written. Exit 3: `closed: false`, `owner_status` as read (unchanged), every step `"skipped"`. Exit 2: `closed: false`, `owner_status: null`, every step `"skipped"`, the reason in `faults`.

**Exit codes.**

| Verb | 0 | 3 | 2 |
|---|---|---|---|
| `open` | opened, governed or not | governance fail-closed: no poller started, `stop_reason: governance-admit-failed` written | usage error; malformed `--until`/`--max`; mint failed; adopt refused (no readable ledger, owner not `running`, or not this session's run); an envelope differing from an existing one; a post-mint write failure |
| `close` | closed (including an aborted run under the abort exemption) | refused: undispatched admitted issues on a run without the abort exemption; ledger and events untouched | usage error; unknown stop token; missing or malformed ledger |

**`--export`.** On exit 0 and exit 3, `open --export` prints exactly two lines, `export FAFF_RUN_DIR=<abs run_dir>` and `export FAFF_SESSION_ID=<run-id>`, shell-quoted. On exit 2 it prints nothing to stdout. `--export` and `--json` together is a usage error. The skill captures and branches before it evals: `out=$(faff run open … --export); rc=$?; eval "$out"`. A bare `eval "$(faff run open …)"` would lose the exit code, so the skill text never uses it.

### Stop tokens

**Chosen:** `close` accepts exactly the tokens the skill documents today: `queue-drained`, `all-remaining-parked`, `budget-hit(<dims>)`, `budget-escalated(<dims>)`, `sentry-abort`, `converged/both-dry`, `non-convergence`, `product-incomplete`, plus `governance-admit-failed` (which only `open` writes, listed so a re-close of a fail-closed run validates). `<dims>` is a non-empty comma list of `until`, `max_attempts`, `tokens`, `cost`, `window`. Anything else exits 2 before any write. Rationale: `faff disposition` keys on these strings, so a typo would silently drop a run escalation.

**Chosen:** the skill passes `sentry-abort` when it exits on a `run checkpoint` `fail-closed` action (kill-switch evaluator down). Rationale: the prose gives that exit no token today. `sentry-abort` is escalate-class in `faff disposition`, so a human sees it, and both cases are the kill-switch stopping the run. The run log keeps the distinction (the skill already surfaces "kill-switch evaluator down").

### Root and session

**Chosen:** `open` requires `--root` and `--session-id` (the measuring session, `$CLAUDE_CODE_SESSION_ID`), exactly what the prose passes to `budget baseline` today, and records `budget.measure_root := --root` on a fresh envelope. `close` resolves its root with `run checkpoint`'s rule: the ledger's `budget.measure_root`, else `--root`, else the repo root above the run dir, with `root-drift` / `root-inferred` faults, and the run dir must be `<root>/.faff/runs/<run-id>` or exit 2. `close --session-id` is forwarded verbatim to the token-tagged `run-end` append and omitted when absent. Rationale: same as FAFF-1436, the pinned root keeps the `--run <run-id>` subcommands on the right run.

### Where the code lives

**Chosen:** `bin/lib/run-open.ts` and `bin/lib/run-close.ts`, each with a committed `tsc` emit, registered as `open` and `close` in `run.ts`'s `VERBS`. They contain no `as`, `!` or `satisfies`. Both join the `tsconfig.json` include list, `test/check-no-boundary-cast.test.mjs`'s pinned list and `build-manifest.json`. `TEST_FILE_COVERAGE.run` gains `test/run-open.test.mjs` and `test/run-close.test.mjs`. No `--selftest`; `run` stays in the factory region (`REGION_SELFTEST_ARGV.run = null`, unchanged). Small edits to existing JS modules (`lint-cli-coverage.js`, `validate-adapters.js`) stay JS. Rationale: the parent spec's module names; factory→governance requires are legal.

Each module exports its core `runOpen(args, deps)` / `runClose(args, deps)`, where `deps` injects every spawn (with an optional timeout), the config read, the ledger mutator and the clock, as `runCheckpoint` does. A spawn that throws is a failed step like a non-zero exit.

## 4. HOW

### 4.1 `run open`

```
PROCEDURE run_open(args):
  0. Validate flags. Read config at --root. envelope := envelopeFrom(cfg, {until, max_attempts}).
     envelope.until_invalid set (a malformed --until or budget.until), or a non-integer/non-positive --max
     → exit 2, nothing minted.
  1. IF --adopt-run-dir: run_dir := it. Refuse (exit 2, nothing written) unless all hold: its run-ledger.json
     parses to an object; owner.status is "running"; and $FAFF_RUN_DIR resolves to run_dir (runcheck's
     ownedByEnvPointer, the env pointer the minting session exports). A done, aborted or foreign run is
     never adopted; resuming one is `faff resume`'s job, with its own liveness classification.
     ELSE run_dir := stdout of `faff run-ledger init-self-drain --mode M` (cwd --root); non-zero → exit 2,
     stderr carries the mint's own message.
  2. Enrich (mutateLedgerUnderLock): read `faff harness identify --json`; set owner.harness and owner.model
     only where absent. Every other owner field is kept (faff_version, started_at, pid, session_id, and
     FAFF-1444's utc_offset_min / owner_history). Append a ledger-write event. A failed identify is a fault
     and the enrich is skipped.
  3. Envelope, write-once (same locked edit discipline):
     - ledger.budget.envelope absent → write budget.envelope := envelope and budget.measure_root := --root,
       keep any other budget key. Append ledger-write.
     - present → never rewritten. If --until or --max was passed and its resolved ceiling differs from the
       recorded one → exit 2 "budget envelope already set".
     Then spawn `faff budget baseline --run-dir --root --session-id` (write-once; non-zero is a fault).
  4. Governance:
     a. status := `faff commissaire contract status --run-dir` with a 30 s timeout. Non-zero, timeout, a
        throw, or stdout that is not exactly one JSON object with a boolean `governed`
        → FAIL_CLOSED(commissaire-status-failed).
     b. governed:true → already-governed. Never re-admit, never --force.
     c. ELSE admit := `faff commissaire contract admit --run-dir --producer <run-id>
        --contract-revision faff-runner-v1 --scope merge,branch-delete,pr-create,push,label-write,file-write,tracker-write`.
        exit 0 → admitted.
        non-zero → IF admit stdout parses with governor_unreachable:true → FAIL_CLOSED(governor-unreachable,
                   governor := its `governor` value), whatever admit-required says.
                   ELSE req := `faff commissaire admit-required --run-dir --json`;
                        req.governance_required === false → ungoverned-optional, fault "admit-failed:<exit>".
                        true, a non-zero exit, or unparseable → FAIL_CLOSED(governance-required).
  5. Spawn `faff hooks-ensure --root <root>` (the verb's existing `[--root DIR]` flag). Non-zero is a fault;
     stdout goes to hooks_report.
  6. Spawn `faff sentry-poller start --run-dir`. Non-zero is a fault.
  7. Print: --export lines, or OpenResult (--json), or run_dir. Exit 0.

FAIL_CLOSED(cause, governor?):
  write <run_dir>/commissaire/governance-required.json {governance_required:true[, governor]} (tmp+rename);
  append {phase:"run", type:"park", issue:<run-id>, data:{reason:"needs-human"}};
  `faff andon pump --run-dir` (fail-open);
  locked edit: owner.status := "done", stop_reason := "governance-admit-failed", admitted unchanged;
  append ledger-write; run step 5 (hooks-ensure: settings registration, nothing long-lived);
  print as step 7; exit 3. Step 6 (the poller) never runs.
```

**Chosen:** governance settles before the poller starts (the prose starts the poller first). Rationale: a fail-closed open then starts nothing long-lived, which is the prose's own "exit non-zero starting nothing" promise; the poller self-stops on `owner.status:"done"` anyway, so nothing is lost on the success path. `hooks-ensure` runs on both paths, because it only registers the Stop hooks and the skill no longer calls it anywhere else; skipping it on a fail-closed first run would leave the backstop unregistered.

**Chosen:** `--adopt-run-dir` adopts only a `running` run this session was handed (`$FAFF_RUN_DIR` equals the adopted dir). Rationale: adopt exists for the ledger `faff lights-out` just minted in this session. Without the gate, a second session could adopt a run another driver holds and start a second poller and build lane under the same producer identity.

**Chosen:** a malformed `until` or `max` exits 2 before the mint. Rationale: the prose would write an envelope whose `until` silently resolves to no ceiling (FAFF-364 flags it only at check time); refusing before anything is minted is stricter and leaves no orphan run.

**Chosen:** a write failure after the mint (enrich, envelope or ledger-write refused by the schema or the lock) exits 2 with the run dir named on stderr, and the owner is left `running` with `admitted: []`. Rationale: there is no honest stop token for "the bracket broke"; the prose treats a mint fault as an unexpected-state fault the skill logs and parks, and an empty `admitted` keeps `runcheck` clean. The skill handles exit 2 exactly as it handles a mint failure today.

### 4.2 `run close`

```
PROCEDURE run_close(run_dir, stop_reason, git_only, root?, session?):
  1. Validate stop_reason against §3 Stop tokens → exit 2. Resolve root (§3) → exit 2 on a mismatch.
     Read the ledger; missing or not an object → exit 2.
     ledger.stop_reason already set and different from the token → exit 2 "run already closed as <token>",
     nothing written. The same token is an idempotent re-close.
  2. audit := auditLedger(ledger).
     audit.invalid_outcomes non-empty → refuse (exit 3), nothing written.
     audit.undispatched non-empty:
       abort exemption := stop_reason is "sentry-abort" AND (ledger.abort.status is "aborted-resumable"
                          OR owner.status is "aborted-resumable").
       exemption → continue; undispatched is reported, never written to outcomes.
       no exemption → print CloseResult{closed:false, undispatched}; exit 3. Nothing written.
  3. Append {phase:"run", type:"run-end", data:{stop_reason, shipped, parked}} with --tokens
     [--root root --session-id session]. shipped = count of outcomes equal to "shipped"; parked = count
     equal to "parked" (the run summary's own buckets). A failed append is a fault.
  4. Locked edit, one write: stop_reason := token; owner.status := "done" unless it is "aborted-resumable"
     (kept). Every other owner field kept. Append ledger-write.
  5. `faff sentry-poller stop --run-dir` (belt; the poller self-stops on the close). Non-zero is a fault.
  6. probe := `faff commissaire contract status --run-dir` (30 s timeout).
     IF probe.governed === true, OR the probe failed, timed out or was unparseable:
       for each issue in ledger.admitted (ledger order):
         `faff commissaire effect reconcile --run-dir --unit-id <issue>` then
         `faff commissaire verdict conclude --run-dir --unit-id <issue>`; record both exits; never stop on one.
     ELSE conclude := "skipped".
  7. IF --git-only:
       `faff events anchor-run --run-dir`; on exit 0: `git add .faff/anchors/<run-id>/` and
       `git commit -m "chore(anchor): run-level evidence anchor for <run-id>" -- .faff/anchors/<run-id>/` in root
       (path-limited, so nothing else staged rides along; "nothing to commit" is ok);
       then `faff bundle publish --run-dir --boundary-kind run-close --boundary-key run-close`.
       anchor-run non-zero → anchor "failed:<exit>", commit and bundle "skipped".
     ELSE all three "skipped".
  8. `faff judge-trail mint --run-dir` (every run).
  9. `faff andon pump --run-dir` (fail-open).
  10. Print CloseResult (--json) or a one-line summary; exit 0.
```

**Chosen:** the abort exemption. On a `sentry-abort` close of a run carrying the abort mark, undispatched admitted issues do not refuse the close. Rationale: `applySentryAbort` never writes outcomes, so the in-flight issue stays undispatched and the run re-enterable; refusing would force the skill either to park it (destroying the resume) or to skip the close (no `stop_reason`, no `run-end`, no judge-trail). The issues are reported in `undispatched`; the abort mark, the escalate-class `sentry-abort` token and `faff resume` keep the queue visible, so nothing is deferred silently. Every other stop, including a `sentry-abort` with no abort mark (the fail-closed mapping), keeps the strict refusal.

**Chosen:** `close` keeps an `aborted-resumable` owner status instead of writing `done`. Rationale: `faff sentry abort` never resurrects a `done` owner, and `faff resume` and `faff disposition` read `aborted-resumable` as their first signal. Writing `done` over it would leave only `ledger.abort` as the resume marker. Both statuses read as "not held" to the Stop hook, so liveness is unchanged.

**Chosen:** an unanswerable status probe at close is treated as governed (the conclude loop runs). Rationale: skipping it on a governed run would leave its issues unconcluded, and on an ungoverned run the loop writes nothing: `effect reconcile` is a read that prints escapes (`commissaire.js` `cmdReconcile`), and `verdict conclude` refuses with no write unless the producer was admitted, exiting 2 with `no-governor` when admit never ran (`cmdTerminalVerdict`). A test pins the ungoverned case.

**Chosen:** the `run-end` event carries `{stop_reason, shipped, parked}` (the fields the v0.3 `run-end` schema already lists) and is token-tagged as the prose's phase-closer table requires. Rationale: the prose never said what `data` to send; these are the schema's own fields, so `faff events validate` already accepts them.

### 4.3 Skill changes

`faff-beep-boop/SKILL.md`:
- **"Run ledger" mint paragraph (l. 391):** one sentence: the run dir is minted by `faff run open` (via `init-self-drain`); never a hand-written `mkdir`; no build lane is dispatched until `run open` exits 0. The run-id format detail stays as one clause.
- **"At run start" (l. 428–438):** replaced by the `out=$(faff run open --mode <mode> [--until] [--max] --root "$measure_root" --session-id "$session_id" --export); rc=$?; eval "$out"` call (with `--adopt-run-dir "$FAFF_RUN_DIR"` instead of `--mode` on a lights-out run) and a three-row routing table: `0` → proceed to step 4, relay `hooks_report` to the user when it says hooks were added; `3` → no build starts, go to reporting (`run summary`); `2` or unparseable → log and park per the shared protocol, as a mint failure does today. `measure_root=$PWD` (before any worktree work) and `session_id=$CLAUDE_CODE_SESSION_ID` stay as one line, because every later token call still passes them.
- **"At orchestrator exit" through judge-trail (l. 440–444):** replaced by `faff run close --run-dir "$FAFF_RUN_DIR" --stop-reason <token> [--git-only] --root "$measure_root" --session-id "$session_id" --json`, run synchronously in-turn after step 11.6 and before `run summary`, and a routing line: `0` → reporting; `3` → step 11's "dispatch or park" for `undispatched`, then close again; `2` → log, surface needs-human. `--git-only` is the once-resolved signal from step 8.5. The "`done` does not exempt runcheck" sentence and the "do not add `audit seal`" note fold into one clause.
- **Stop hook (l. 450–457):** the `hooks-ensure` code block goes; one sentence says `run open` runs it and the skill relays `hooks_report`. The ownership and liveness explanation stays.
- **Reporting (l. 581):** "first append the `run-end` event then run `andon pump`" becomes "after `faff run close`".
- **`stop_reason` bullet (l. 419):** lists `governance-admit-failed` and the fail-closed→`sentry-abort` mapping.
- **References:** l. 385 (synchronicity invariant) and l. 406 (`level` bullet) point at `run open` / `run close` instead of the deleted bullets.

Lower `SKILL_LINE_BASELINE["faff-beep-boop"]` to the new count. `ANCHOR_PHRASES["faff-beep-boop"]` ("never end a turn", "in-flight marker", "non-terminal turn-end", "foreground-to-terminal") sit outside these ranges and stay; `validate-adapters` must report no RATCHET.

### 4.4 Edge cases

- **Lights-out L4 ledger (`--adopt-run-dir`).** Never re-minted; `level` is write-once in `mutateLedgerUnderLock`. Its `budget` block exists, so the envelope is not rewritten; the skill passes no `--until`/`--max` on this path, and a differing one exits 2. Its owner has no `harness`/`model`, so the enrich fills them.
- **Re-running `open --adopt-run-dir` on this session's governed run.** `already-governed`, no second admit; envelope and baseline are write-once, so a re-run cannot raise a ceiling.
- **Adopting a run another session holds, or a `done`/aborted run.** Exit 2, nothing written.
- **`close` twice.** With the same token, the second call re-writes the same `stop_reason` and owner status; with a different token it exits 2 and writes nothing, so a quiet token can never overwrite an escalate-class one; reconcile, conclude, anchor-run ("nothing to commit") and judge-trail tolerate already-done runs; a second `run-end` event is appended (the chain stays valid).
- **An aborted run with undispatched admitted issues.** Closed under the abort exemption with `--stop-reason sentry-abort`: `undispatched` lists them, `outcomes` is untouched, and `faff resume` re-enters them.
- **A fail-closed checkpoint exit (`sentry-abort`, no abort mark) with undispatched issues.** Refused; the skill resolves them through step 11 (park) and closes again, as today.
- **A fail-closed open.** The skill does not call `close` (the owner is already `done` with `stop_reason` set); it goes to `run summary`.
- **Missing heartbeat sidecar or declared-effects ledger.** Clean per the existing CLIs, not faults.

### 4.5 Tests (in `test/` only, `node --test`, no `--selftest` cases)

- `test/run-open.test.mjs` (injected deps): mint path; adopt path; adopt refused → 2 with nothing written for a dir without a ledger, an owner not `running`, and `$FAFF_RUN_DIR` unset or naming another dir; enrich fills absent `harness`/`model` and keeps `faff_version`, `started_at`, `pid` (and `utc_offset_min` once FAFF-1444 is on main); envelope precedence (flag over config); malformed `--until` → 2 with no mint spawned; envelope write-once (a re-run with a different `--max` → 2, envelope unchanged; the same `--max` → 0); each governance branch: already-governed (no admit spawned), admitted, optional failure → `ungoverned-optional`, required failure → 3 with sentinel, park event, `stop_reason` and no poller spawn, `governor_unreachable` → 3 even when `admit-required` says optional (sentinel carries `governor`), status non-zero / timeout / throw / non-object / non-boolean `governed` → 3, `admit-required` non-zero or unparseable → 3; hooks-ensure runs on the fail-closed path and the poller does not; poller, hooks, `budget baseline` and `harness identify` failures are faults with exit 0 (a failed identify skips the enrich); a post-mint enrich refusal → 2 naming the run dir; `--export` output on 0 and 3, nothing on 2; `--export --json` → 2.
- `test/run-close.test.mjs` (injected deps): refusal on undispatched and on an invalid outcome, ledger and `events.jsonl` byte-identical after; the abort exemption (abort mark + `sentry-abort` → 0 with `undispatched` listed and `outcomes` unchanged; abort mark + another token → 3; `sentry-abort` without a mark → 3); every stop token accepted and a typo rejected before any write; close twice with the same token (0, idempotent) and with a different token after an escalate-class close (2, `stop_reason` unchanged); `run-end` payload (`shipped`/`parked` counts) and `--tokens`/`--root`/`--session-id` forwarding; the `--json` field values on each exit; owner `done` vs a kept `aborted-resumable`; poller stop failure is a fault; governed conclude loop in ledger order, one failing issue not stopping the next; a failed status probe still running the loop, and on an ungoverned run writing no Commissaire record; ungoverned → conclude skipped; git-only anchor, path-limited commit (a pre-staged unrelated file stays uncommitted) and bundle; anchor failure skips commit and bundle; judge-trail on a non-git-only run; andon failure is a fault; root drift and run dir outside root.
- Each file also runs the real CLI once end to end (`faff run open --mode full` then `faff run close`) in a temp repo with fake `faff`-subcommand stubs where a real call would reach the network (the Commissaire admit), asserting the on-disk ledger.

## Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose config sets no commissaire.governor
When `faff run open --mode full --root R --session-id S --json` runs
Then it exits 0 with governance "admitted" and steps.poller "ok"
And the new run ledger has owner.status "running", an owner.harness value and budget.measure_root equal to R
```

```
Given a run D opened by `faff run open --mode full --max 5` that exited 0, and FAFF_RUN_DIR set to D
When `faff run open --adopt-run-dir D --root R --session-id S --json` runs, and then again with --max 9
Then the first exits 0 with governance "already-governed" and the second exits 2
And the ledger's budget envelope still has max_attempts 5
```

```
Given `faff run open --mode full --until 25:99 --root R --session-id S`
When it runs
Then it exits 2
And no new directory exists under R/.faff/runs
```

```
Given a run ledger with admitted ["A","B"] and outcomes {"A":"shipped"}
When `faff run close --run-dir D --stop-reason queue-drained --json` runs
Then it exits 3 with undispatched ["B"]
And run-ledger.json and events.jsonl are byte-identical to before
```

```
Given a run ledger with every admitted issue terminal
When `faff run close --run-dir D --stop-reason queue-drianed` runs
Then it exits 2 and run-ledger.json is unchanged
```

```
Given a run D whose owner.status is "running" and FAFF_RUN_DIR is unset
When `faff run open --adopt-run-dir D --root R --session-id S` runs
Then it exits 2
And run-ledger.json is byte-identical to before
```

## 5. DESIGN DECISION RATIONALE

- **Spawn the subcommands rather than call them in-process.** They are what the prose runs; their exit codes carry the fault semantics; and the Commissaire verbs stay byte-identical, which is the no-new-surface rule.
- **Close refuses rather than marks.** Marking a run `done` with undispatched work is the deferred-queue anti-pattern runcheck exists for; refusing keeps that judgement with step 11. The one exemption is the run `faff sentry abort` deliberately left re-enterable.
- **No captured decision kernel.** The corpus (`verification/reports/FAFF-974-post-fix-fidelity/decision-corpus.jsonl`) covers `next`, `eligible`, `run-outward`, `run-start` and `run-done`; neither verb composes one, so no corpus replay applies.
- **Build order.** FAFF-1444 (#1170, accepted, holdout passed) merges first: it adds `owner.utc_offset_min` to the ledger schema, and `run open`'s keep-every-owner-field test asserts it. FAFF-1418 (§0a) and FAFF-1434 (step 4) edit other beep-boop sections; whichever lands second rebases the `SKILL_LINE_BASELINE` line only.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Assumes:** the skill keeps resolving `--git-only` once at step 8.5 and passes it to `close`; `close` never re-sniffs.

**Assumes:** FAFF-1444 is on `main` before this builds. If it is not, the build drops only the `utc_offset_min` assertion and notes it in the PR.

## Rule inventory

Disposition key: `kept` = the command does what the prose says; `changed` = differs, with the reason; `dropped` = not carried, with the reason. Line numbers are `faff-beep-boop/SKILL.md` at `948a8f1d`.

| # | Prose rule (line) | Command behaviour | Covering test | Disposition |
|---|---|---|---|---|
| C1 | Mint via `init-self-drain`, never a hand `mkdir` (391) | open 1 | "mint path" | kept |
| C2 | Lights-out ledger is pre-minted L4; `init-self-drain` never runs for it (428) | `--adopt-run-dir` | "adopt path" | kept |
| C3 | Enrich owner with `harness`/`model`, keep `faff_version`; ledger-write event (428) | open 2 | "enrich keeps fields" | kept |
| C4 | Export `FAFF_RUN_DIR` and `FAFF_SESSION_ID` (430–433) | `--export` lines, captured then eval'd | "export output" | changed: printed for the skill to eval |
| C5 | Start the sentry-poller on every run (435) | open 6 | "poller after governance" | changed: after governance settles; not started on a fail-closed open |
| C6 | Resolve the envelope from config + flags before step 4 (437) | open 0 and 3 | "envelope precedence" | kept |
| C7 | Baseline via `budget baseline`, write-once; capture `measure_root` and session (437) | open 3 | "baseline spawned" | kept |
| C8 | Seed `tokens_at_start_by_class` with zeros when token-tagging (437) | not written | (none) | dropped: `events append` already falls back to the same zeros |
| C9 | Status probe non-zero, >30 s, or not one object with boolean `governed` → fail closed (438) | 4a | "status × 5" | kept |
| C10 | Governed → never re-admit, never `--force` (438) | 4b | "already-governed" | kept |
| C11 | Admit argv: producer run-id, `faff-runner-v1`, seven-kind scope (438) | 4c | "admit argv" | kept |
| C12 | Admit failure → `admit-required`; malformed or unreadable reads as required (438) | 4c | "admit-required unparseable" | kept |
| C13 | Required → sentinel, park event, andon, owner done, `governance-admit-failed`, `admitted:[]`, start nothing (438) | FAIL_CLOSED, exit 3 | "required failure" | kept |
| C14 | `governor_unreachable:true` fails closed even when optional; `governor` detail on the sentinel (438) | 4c | "governor unreachable" | kept |
| C15 | Optional failure → log and proceed ungoverned (438) | 4c | "optional failure" | kept |
| C16 | Run `hooks-ensure` (450–457) | open 5, also on the fail-closed path | "hooks spawned", "hooks on fail-closed" | kept |
| C17 | Tell the user when the hook set is added (457) | `hooks_report` relayed by the skill | "hooks report" | kept |
| C18 | Mint non-zero → log and park, no dispatch (391) | open 1 exit 2; skill routes 2 to park | "mint failure" | kept |
| C19 | Heartbeat at every boundary (439) | stays in the skill | (skill text) | kept in prose |
| C20 | Exit: owner `done` and `stop_reason` in one edit, every path, synchronously in-turn (440) | close 4 | "owner close" | kept |
| C21 | A `done` run with undispatched work still trips runcheck (440) | close 2 refuses first, except the abort exemption | "refusal", "abort exemption" | changed: refused before any write; an aborted run's resume work is reported, not refused |
| C22 | Stop the sentry-poller at exit (440) | close 5 | "poller stop fault" | kept |
| C23 | Governed run: reconcile then conclude per admitted issue; non-zero logged, close proceeds (441) | close 6 | "conclude loop" | kept |
| C24 | Keep `effects reconcile-merges` backstop (441) | stays in `run checkpoint` | (FAFF-1436 tests) | kept elsewhere |
| C25 | Do not add `audit seal` (441) | never called | "no audit seal spawn" | kept |
| C26 | Git-only: `anchor-run` after the close and its ledger-write, commit, "nothing staged" ok (442) | close 7 | "git-only anchor" | changed: the commit is path-limited to the anchor dir |
| C27 | Bundle publish only after a good anchor-run; `store_unavailable` logged (443) | close 7 | "anchor failure skips" | kept |
| C28 | `judge-trail mint` on every run, not git-only-gated (444) | close 8 | "judge-trail non-git-only" | kept |
| C29 | `run-end` event then andon pump before the summary (581) | close 3 and 9 | "run-end payload", "andon fault" | kept |
| C30 | `ledger-write` event after each direct ledger edit (389) | after every locked edit | "ledger-write appended" | kept |
| C31 | `stop_reason` vocabulary (419, 631–640) | close 1 validates | "stop tokens" | changed: enforced; `governance-admit-failed` listed |
| C41 | (none) | a re-close with a different token exits 2; the same token is idempotent | "close twice" | changed: new; an escalate-class stop can't be overwritten |
| C32 | (none) | fail-closed checkpoint exit → `sentry-abort` | (skill text) | changed: new; the prose gave it no token |
| C33 | (none) | `aborted-resumable` owner kept at close | "aborted kept" | changed: new; the prose wrote `done` on every path |
| C34 | (none) | `run-end` data `{stop_reason, shipped, parked}` | "run-end payload" | changed: new; the prose named no payload |
| C35 | (none) | malformed `until`/`max` → exit 2 before the mint | "malformed until" | changed: new, stricter |
| C36 | (none) | failed status probe at close → treated as governed | "probe failure runs loop" | changed: new, fail-safe |
| C37 | (none) | post-mint write failure → exit 2 naming the run dir | "post-mint refusal" | changed: new |
| C38 | (none) | adopt fills absent `harness`/`model` | "adopt enrich" | changed: new; the prose enriched on a genuine mint only, and never overwrites |
| C39 | Admit before step 4, after mint and enrich (438) | open 4 after 2–3 | "order" | kept |
| C40 | (none) | adopt only a `running` run whose `$FAFF_RUN_DIR` names it | "adopt refused" | changed: new; the prose had no adopt verb to gate |

## 7. DONE

### From WHY
- [ ] `faff-beep-boop/SKILL.md` calls `faff run open` (captured, then eval'd) and `faff run close` in place of l. 391, 428–438, 440–444, 450–457 and the l. 581 sentence, with routing on each exit, and `SKILL_LINE_BASELINE["faff-beep-boop"]` is lowered to the new count.
- [ ] `faff validate-adapters` passes with no RATCHET finding for `faff-beep-boop`.

### From WHAT
- [ ] `faff run open --json` prints an OpenResult and `faff run close --json` a CloseResult with every §3 field, each exiting 0, 3 or 2 per §3.
- [ ] `run-open.ts` and `run-close.ts` are in `tsconfig.json` `include`, with committed `.js` emits and `build-manifest.json`; `check-no-boundary-cast` passes and its test pins both.
- [ ] `faff run` with no verb exits 2 with a usage line naming all four verbs: `summary`, `checkpoint`, `open`, `close`.
- [ ] `TEST_FILE_COVERAGE.run` names `test/run-open.test.mjs` and `test/run-close.test.mjs`; `faff regions check` and `faff lint-cli-coverage` pass; no selftest block gains a case.
- [ ] The PR diff touches no `commissaire*` file, and `faff commissaire --help` output is byte-identical before and after.

### From HOW
- [ ] Every governance branch in §4.1 step 4 has a test asserting the exit code, `governance`, `fail_closed_cause` and whether the poller and hooks were spawned.
- [ ] A `run close` refusal leaves `run-ledger.json` and `events.jsonl` byte-identical.

### Rule inventory
- [ ] Every line the PR deletes from `faff-beep-boop/SKILL.md` maps to a row C1–C41; the PR description lists the deleted line ranges against row ids.
- [ ] Every `kept` and `changed` row with a covering test has that test, and it passes.

### Tests
- [ ] `test/run-open.test.mjs`, `test/run-close.test.mjs`, `test/run-checkpoint.test.mjs` and `test/run-summary.test.mjs` pass under `node --test`.

confidence: high
spec-review: accept (human)
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```

## Methodology critique

- **Right-sized?** No issues. Two verbs of one command, two TypeScript modules, two test files and one SKILL.md edit: a 1–3 day unit, the last slice of an already re-sliced parent.
- **Workstream fit?** No issues. Slice C of FAFF-1413, in the prose-to-command lane after FAFF-1435 and FAFF-1436.
- **Deps surfaced?** One to name: FAFF-1444 (#1170) should merge first, because `run open` must keep the owner fields it adds. FAFF-1436 (the blocker) is merged. FAFF-1418 and FAFF-1434 touch other beep-boop sections and conflict only on the line baseline.
- **Risk profile?** One risk worth naming: this is the governance gate at run start. Its five branches are pinned by unit tests on each exit and by two holdout scenarios, and the Commissaire verbs are called unchanged.
