# FAFF-470 — Mint-scoped detached sentry poller (primary watchdog locus)

> Spec: faffter-dark-nlspec · 2026-07-14 · autonomous · confidence: high. Full spec on Linear FAFF-470.

**Spec for FAFF-470.** This document specifies `faff sentry-poller` — a new CLI subcommand and `bin/lib` module that implements ADR-0065's primary watchdog locus: a detached, unref'd poller spawned at run-mint that loops `faff sentry check` on a fixed interval and actions an `abort` verdict on an L4-minted run with zero cooperation from the orchestrator. Audience: the build agent implementing it and human reviewers. Sibling FAFF-471 (the Stop-hook opportunistic assist) is specced separately; this spec covers the poller half only.

## 1. WHY — Problem and Principles

**The load-bearing model:** every sentry invocation faff has today is cooperative — the check runs only when the supervised orchestrator volunteers control at a between-units checkpoint or a turn-end. This change gives the existing detector an invocation locus that does not depend on that cooperation: a long-lived detached child process, spawned once when the run is minted, that calls the *unmodified* `faff sentry check` / `faff sentry abort` CLI on a timer and dies with the run. The poller carries no judgment and no detection math — it is a scheduler for a detector that already exists.

**Problem statement.** A `wall-clock-runaway` orchestrator that stops reaching checkpoints starves its own supervisor — the exact failure the sentry exists to catch goes undetected (ADR-0065 Context). The evidence (`owner.status`, effective heartbeat, staleness window) is already on disk; no executor evaluates it from outside the orchestrator's control flow. This change adds that executor as a mint-scoped detached poller.

**Design principles** (each would reject an otherwise-valid implementation):

- **Consume, never re-derive.** The poller invokes `faff sentry check --json` and `faff sentry abort` as child processes. It re-implements no trigger math, reads no thresholds of its own, and holds no verdict logic beyond dispatching on the check payload's `tripped` / `intervention` fields.
- **Ledger-mark cancellation only** (ADR-0065, FAFF-332 NO-GO). The poller never kills, signals, or interrupts any live process. Its only intervention is the existing `sentry abort` write path (ledger → `aborted-resumable`).
- **Additive, never a replacement.** The cooperative checkpoint consult (FAFF-352) is untouched. A poller that crashes or never spawns degrades the run to exactly today's coverage, never below it — no path may make checkpoint behaviour conditional on the poller.
- **Fail closed on own faults, but never abort on them** (FAFF-425 shape). A `sentry check` exit 3 (indeterminate — the *check's* own-fault) is logged and polling continues; an own-fault is never coerced into either "all-clear" *or* an abort.
- **Mint-scoped action** (ADR-0044, beep-boop handling table). The poller **acts** (abort) only when the run ledger is `faff lights-out`-minted (`level: "L4"`); on any other run it logs advisory verdicts and takes no action — mirroring the existing "consult always runs; acting is mint-scoped" rule.
- **Deterministic tools over prose.** The beep-boop skill prose shells exactly one command at mint and one at teardown; all spawn/lifecycle mechanics live in the CLI module, not in prose.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry.js` | Node (CommonJS) | The detector + abort write path the poller invokes, unmodified (governance region) |
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node | Single-value-file precedent (FAFF-355): dedicated sidecar file avoids concurrent-ledger-write clobber |
| `plugin/skills/faff/bin/lib/events.js` | Node | `appendEventRecord` + closed `EVENT_TYPES` incl. `sentry-checkpoint` (governance — same-region require is legal) |
| `plugin/skills/faff/bin/faff` | Node | `COMMANDS` dispatch registry; new subcommand registers here |
| `plugin/skills/faff/bin/lib/regions.js` | Node | `REGION_MAP` + `REGION_SELFTEST_ARGV` — both require an entry for every command (bijection-checked) |
| `plugin/skills/faff-beep-boop/SKILL.md` | Prose | Owner stamp at run start + `owner.status:"done"` close at exit — the two wiring points |
| `records/adr/0065-sentry-watchdog-invocation-locus-*.md` | ADR | The settled design this implements (probe-verified detach/sentinel/self-stop behaviour) |

**Scope statement.** This is the first of ADR-0065's three follow-ups (poller; FAFF-471 Stop-hook assist; FAFF-472 andon wiring), and the first long-lived detached child process in the codebase.

## 2. OUT OF SCOPE

- **Stop-hook staleness assist (FAFF-471)** — the composite's other half; specced by a peer in this same run. Extension point: `hooks-ensure.js` `FAFF_STOP_HOOKS`. Both tickets add one `COMMANDS`/`REGION_MAP` line to `bin/faff`/`regions.js` — merge-conflict analysis serialises them.
- **Andon / alerting on poller abort (FAFF-386, FAFF-472)** — deliberately deferred; the interim visibility path is the ledger mark + `faff disposition` / morning brief, which already classify `aborted-resumable`.
- **Ledger-forgery residual (FAFF-324 vectors 4/4b)** — the poller shares the build lane's container/uid boundary by design; ADR-0065 names and does not close this. Extension point: wiring `sentry check` through `integrityGate`'s `detection` consumer.
- **Live process interrupt / live resume** — FAFF-332 NO-GO; cancellation stays ledger-mark + cold-re-dispatch.
- **Host-level cron/launchd locus** — rejected by ADR-0065 on install-wiring grounds (criterion 5).
- **New detection math or thresholds** — the poll interval is a scheduling knob, not a detection threshold; `sentry.*` config is untouched.
- **WIP-commit on poller-initiated aborts** — the poller cannot reliably resolve the in-flight worktree path (see Rationale D9). Extension point: pass `--worktree` in the poller's abort call once a run-scoped worktree registry exists on the ledger.
- **Spawning the poller from non-beep-boop entry points** (interactive `/faff-graft`, prep runs) — mint-scoped supervision is a beep-boop run property; other callers can invoke `sentry-poller start` later if wanted.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Poller | The detached child process looping `sentry check` against one run dir |
| Handle file | `sentry-poller.json` in the run dir — the poller's PID/lifecycle record |
| Stop sentinel | `sentry-poller.stop` in the run dir — its existence tells the poller to exit at the next tick |
| Tick | One loop iteration: self-stop checks + one `sentry check` consult + dispatch |
| Mint-scoped | Acting is conditional on the ledger's `level: "L4"` (lights-out-minted); consulting is not |

**Files (all inside `.faff/runs/<run-id>/`, alongside `run-ledger.json`):**

```
RECORD PollerHandle:                # sentry-poller.json — written by `start` (the parent), tmp+rename atomic
  pid: int                          # the detached child's PID, known to the spawning parent
  started_at: ISO-8601              # spawn time
  interval_secs: int                # the interval the child was launched with

FILE sentry-poller.stop             # zero/any content; existence is the signal (probe-tested mechanism)
FILE sentry-poller.log              # append-only, one line per tick: "<ISO> <token>[ <detail JSON>]"
```

Log tokens (closed set): `spawned`, `poll-ok`, `poll-trip`, `advisory-trip`, `abort-actioned`, `abort-failed`, `indeterminate`, `self-stop-owner-status`, `stop-sentinel`, `run-dir-gone` (best-effort — only writable while the dir exists), `fault-cap-exit`.

**CLI surface** (new top-level subcommand `sentry-poller`, module `bin/lib/sentry-poller.js`, region **governance**):

```
faff sentry-poller start  [--run-dir DIR] [--interval-secs N] [--json] [--root DIR]
faff sentry-poller stop   [--run-dir DIR] [--json] [--root DIR]
faff sentry-poller status [--run-dir DIR] [--json] [--root DIR]
faff sentry-poller run    --run-dir DIR --interval-secs N     # internal loop entrypoint (spawned by start)
faff sentry-poller --selftest
```

- Run-dir resolution for `start`/`stop`/`status`: the standard chain (`--run-dir` → `$FAFF_RUN_DIR` → latest under `.faff/runs`), mirroring `sentry check`. Exit 3 when no run dir resolves or (for `start`) the resolved dir has no ledger; exit 2 on usage errors (bad `--interval-secs`); exit 0 otherwise.
- `--interval-secs`: integer ≥ 1, default **90** (inside ADR-0065's proposed 60–120s band; this ticket tunes it — see D3). Explicit flag only; no env form.
- **`start`** — idempotent. Handle exists and its `pid` is alive (`process.kill(pid, 0)` succeeds) → no-op, exit 0, `{already_running: true, pid}`. Otherwise: remove any stale stop sentinel, `spawn(process.execPath, [ENTRYPOINT, "sentry-poller", "run", "--run-dir", dir, "--interval-secs", N], {detached: true, stdio: "ignore"}).unref()`, write the handle file (tmp+rename), exit 0, `{spawned: true, pid, interval_secs}`.
- **`stop`** — write the stop sentinel, report `{signalled: true, pid|null, alive: bool}` (pid/liveness from the handle if present; `pid: null, alive: false` when no handle), exit 0. Soft, never blocks: the poller exits within one interval; no kill signal is ever sent (PID-reuse safety — see D5).
- **`status`** — read the handle, probe `pid` liveness, exit 0 with `{running: bool, pid, started_at, interval_secs}` (`{running: false}` when no handle).
- **`run`** — the foreground loop (below). Documented in `docs/guide/cli.md` as internal (spawned by `start`; prose never calls it).

**JSON payloads it consumes** (existing, unchanged): `sentry check --json` → `{run_dir, verdicts, intervention, tripped, thresholds, authority}` (exit 0) or `{indeterminate: true, reason, verdicts: [], intervention: "continue", tripped: false}` (exit 3); `sentry abort --json` → `{run_dir, aborted: true, status: "aborted-resumable", ...}`.

**Registration surfaces** (all four, or CI fails): `COMMANDS` in `bin/faff`; `REGION_MAP["sentry-poller"] = "governance"`; `REGION_SELFTEST_ARGV["sentry-poller"] = ["sentry-poller", "--selftest"]`; a `docs/guide/cli.md` entry (`lint-cli-doc` is bidirectional).

## 4. HOW — Behavior

**Architecture.** One new CommonJS module `bin/lib/sentry-poller.js` (region banner `region:governance`, ADR-0052 conventions, well under the 3000-line cap). It exports a **pure tick-decision core** plus thin I/O: the loop gathers facts each tick and hands them to the core; the core returns one action. All child invocations use the sentry.js precedent `spawnSync(process.execPath, [ENTRYPOINT, ...])` (`ENTRYPOINT` from `shared-infra.js`) — never PATH lookup, never a hardcoded install path (see D6). This is the codebase's first detached `spawn` (everything else is `spawnSync`); the detach/unref/sentinel mechanics are exactly what ADR-0065's throwaway probe demonstrated.

**The tick.** Plain-English: each tick first checks every reason to stop existing, then consults the unmodified detector, then acts only in the one narrow case ADR-0065 licenses.

```
PROCEDURE tick(runDir, intervalSecs, state):        # state = { consecutiveFaults }
  1. IF stop sentinel exists            → log stop-sentinel, exit 0
  2. IF runDir no longer exists         → exit 0 (log run-dir-gone best-effort)
  3. Read run-ledger.json:
     a. unreadable/malformed            → GOTO fault-path (step 6)  # transient corruption is the check's own-fault too
     b. owner.status != "running"       → log self-stop-owner-status {status}, exit 0
     c. isL4 = (ledger.level == "L4")
  4. r = spawnSync(execPath, [ENTRYPOINT, "sentry", "check", "--json", "--run-dir", runDir])
     a. r.status == 3, OR stdout unparseable, OR spawn error → GOTO fault-path (step 6)
     b. r.status == 0 → state.consecutiveFaults = 0; payload = parse(stdout)
  5. Dispatch on payload:
     a. payload.tripped AND payload.intervention == "abort":
        - isL4:  a = spawnSync(execPath, [ENTRYPOINT, "sentry", "abort", "--run-dir", runDir, "--json"])
                 IF a.status == 0 → append sentry-checkpoint event (best-effort, step 7),
                                    log abort-actioned {signal of the max verdict}, exit 0
                 ELSE             → log abort-failed {exit: a.status}, CONTINUE (retry next tick)
        - non-L4: log advisory-trip {intervention, signals}, CONTINUE   # never touches the ledger
     b. payload.tripped AND intervention in {pause, correct}:
        - log advisory-trip (BOTH levels), CONTINUE                    # see anti-pattern below
     c. otherwise → log poll-ok {intervention}, CONTINUE
  6. FAULT-PATH: state.consecutiveFaults += 1; log indeterminate {reason}
     IF state.consecutiveFaults >= 20 → log fault-cap-exit, exit 0     # bounds a forever-broken surface
     ELSE CONTINUE
  7. EVENT (L4 abort only): events.appendEventRecord(runDir, run_id,
       { phase: "run", type: "sentry-checkpoint", data: <the step-4 check payload> })
     # reuses the existing closed EVENT_TYPES member — no schema bump; audit's supervision
     # summary picks it up for free. Failure here never blocks or reorders the abort.
  CONTINUE = sleep(intervalSecs), next tick
```

**Behaviour summary — why `abort` only.** `pause` and `correct` are orchestrator-judgment interventions (park an issue, author a corrective) that only make sense at a cooperative checkpoint; the poller is the last-resort kill-switch for a run whose orchestrator is *not* cooperating. **Anti-pattern:** the poller acting on `pause`/`correct` (parking issues, calling `faff corrective author`). Why: it would duplicate the checkpoint handling table's judgment lane in deterministic code and diverge from it — ADR-0065's action channel is check + abort, nothing else.

**Anti-pattern:** forking the *consult* on level (only polling L4 runs). Why: the beep-boop rule is "the consult always runs; acting is mint-scoped" — a non-L4 run gets the same advisory telemetry, and the prose stays unforked. The poller is spawned on **every** beep-boop run (see D8).

**Lifecycle wiring (beep-boop SKILL.md prose — two lines, lean per the skill-authoring standard):**

1. **At run start** — in the _Owner stamp & heartbeat_ step, immediately after the owner stamp / `FAFF_RUN_DIR` export: `"$faff" sentry-poller start --run-dir "$FAFF_RUN_DIR"`.
2. **At exit** — alongside the `owner.status:"done"` close: `"$faff" sentry-poller stop --run-dir "$FAFF_RUN_DIR"`. (Belt; the status flip itself is the brace — step 3b self-stops the poller within one interval even if the stop line never runs.)
3. One sentence added to _The interrupt_ noting the poller lane exists and acts per the same mint-scoped table.

**Edge cases and errors:**

- **Orchestrator crashes before teardown** → no sentinel, but `owner.status` eventually flips (or heartbeat goes stale → check trips → L4 abort flips it to `aborted-resumable`) → self-stop within one interval. Worst-case orphan: one poll interval past the run's actual end, per ADR-0065.
- **`start` twice** (re-entry, resumed run) → idempotent no-op on a live pid; a stale handle (dead pid) is overwritten and a fresh poller spawned.
- **Stale sentinel from a previous stop in the same run dir** → `start` removes it before spawning (else the new poller would exit on tick 1).
- **`abort` child fails** (exit 2 malformed ledger / 3) → retryable: log `abort-failed`, keep polling. Terminal only via the fault cap or a self-stop condition.
- **Handle file unwritable / log unwritable** → `start` failing to write the handle is exit 1 (loud — lifecycle record is load-bearing); log-append failures inside the loop are swallowed (telemetry must never wedge the watchdog).
- **PID reuse** → `status`/`start` can false-read "alive" from a recycled PID. Accepted: consequence is a skipped respawn or optimistic status, never a wrong abort; the handle's `started_at` plus the advancing log disambiguate for a human.

**Failure modes (approach-level, per ADR-0065's register):**

- **The failure:** the poller silently never runs (spawn wiring wrong, crashes at boot). **How you'd know:** no `sentry-poller.log` in the run dir; `sentry-poller status` reports `running: false` on a live run; a wall-clock-runaway run ends the night unaborted with a stale heartbeat on disk. **What it means:** coverage degraded to today's cooperative-only baseline — fix the wiring; no false all-clear was emitted.
- **The failure:** poller aborts leave uncommitted WIP (no `--worktree` — D9). **How you'd know:** `wip_commit: null` in the abort ledger entry; a dirty worktree on resume. **What it means:** proceed — the worktree persists on disk, nothing is force-reset; if this bites in practice, the Out-of-Scope worktree-registry extension is the fix.
- **The failure:** interval too coarse (detection latency = staleness window 900s + up to one interval). **How you'd know:** abort timestamps in the log/ledger trail heartbeat-staleness by ≫ 90s. **What it means:** narrow — tune `--interval-secs` at the callsite; no code change.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4-minted run ledger (level "L4", owner.status "running") whose effective
  heartbeat is older than the staleness window, and a poller started at mint with
  --interval-secs I, and no orchestrator process reaching any checkpoint
When the poller's next tick fires
Then within I seconds plus check latency, faff sentry abort has run: the ledger's
  owner.status is "aborted-resumable", an abort entry exists, a sentry-checkpoint
  event was appended, the log ends with abort-actioned, and the poller has exited
```

```
Given a live poller on a running run
When the orchestrator writes owner.status "done" (or `faff sentry-poller stop` writes
  the sentinel) at teardown
Then within one interval the poller process no longer exists (self-stop logged), and
  the run ledger carries no abort entry
```

- The poller never sends a signal to, or waits on, any process other than its own spawned `faff` children; its only run-ledger write path is the `faff sentry abort` child.
- A `sentry check` exit 3 (indeterminate) never produces an abort, at any level.
- `sentry-poller start` on a run with a live poller spawns no second process.

## 6. DESIGN DECISION RATIONALE

**D1 — Where does the spawn logic live: beep-boop prose or a CLI?** Prose `nohup`/`spawn` incantations are unlintable and drift; a subcommand is testable and one-line-invokable. **Chosen:** a new `faff sentry-poller` subcommand owns all mechanics; prose shells `start`/`stop` only (deterministic-tools-over-prose). ADR-0065's "no new standalone subcommand's own daemon management" proscribes a *service installer* (`watch` daemons to install/uninstall) — a mint-scoped start/stop pair owned by the run lifecycle is exactly its "owned by the orchestrator skill step" intent, made lintable.

**D2 — New module vs. extending `sentry.js`?** sentry.js is 1004 lines and advertises itself as a pure evaluator that mutates nothing on the check path; the poller spawns processes and writes files. **Chosen:** new `bin/lib/sentry-poller.js` (ADR-0052 one-concern-per-module; keeps sentry.js's purity claim intact). Same governance region as `sentry`/`events`/`heartbeat`.

**D3 — Poll interval.** ADR-0065 proposes 60–120s and delegates tuning here. 90s ≈ 1/10 of the 900s staleness default: adds ≤ 10% latency to detection while keeping child-spawn load trivial (~40 checks/hour). **Chosen:** default 90s, `--interval-secs` flag (min 1, for tests). No env override — hermetic-override precedent (`--now-ms`) is explicit-flag-only.

**D4 — PID/handle location: ledger field vs. sidecar file.** The issue/ADR say "on the run ledger", but a second process field-merging the ledger races the orchestrator's outcome writes — the exact clobber FAFF-355 created the dedicated heartbeat *file* to avoid. **Chosen:** a dedicated `sentry-poller.json` in the run dir (single-writer: only `start` writes it; tmp+rename), honouring the ADR's intent (lifecycle recorded on the run's on-disk surface) via the codebase's own established shape rather than its letter.

**D5 — Stop mechanism.** Options: kill the recorded PID (immediate, but PID-reuse can kill an innocent process) vs. the probe-tested stop sentinel (race-free, at most one interval of lag). **Chosen:** sentinel file `sentry-poller.stop`, written by `sentry-poller stop`; no kill signal ever. Teardown does not need synchronous death — the `owner.status` self-stop is the backstop.

**D6 — Poller's faff-binary resolution.** PATH lookup breaks under plugin installs; hardcoding breaks everywhere else. **Chosen:** `spawnSync(process.execPath, [ENTRYPOINT, ...])` — the exact self-invocation pattern sentry.js already uses for its stage-guard/corrective-integrity children. The detached `run` child is spawned the same way, so the poller always runs the same bin that started it.

**D7 — Exit-3 (indeterminate) handling.** FAFF-425: own-faults must not read as all-clear; equally, aborting a run because the *watchdog's* surface hiccuped punishes the supervised party for the supervisor's fault. **Chosen:** log + keep polling; a consecutive-fault cap (20 ≈ 30 min at default interval) self-stops a poller whose surface is broken forever, bounding the orphan risk. Never abort on a fault.

**D8 — Spawn for every run, act only on L4 — or spawn only on L4?** **Chosen:** spawn on every beep-boop run; the tick re-reads `ledger.level` and acts only on `"L4"`, logging advisory verdicts otherwise — mirroring the existing mint-scoped handling table and keeping the prose unforked ("don't fork the consult itself on level").

**D9 — `--worktree` on the poller's abort call?** The ADR's action-channel sketch includes it, but the poller has no reliable source for the in-flight worktree path (no run-scoped worktree registry exists; deriving it from naming conventions is guessy). `--worktree` is optional on `sentry abort` (verified: sentry.js L658-696) and the WIP commit is best-effort by design. **Chosen:** call `sentry abort --run-dir <dir>` without `--worktree`. Nothing is destroyed — the worktree and branch persist; only the courtesy WIP auto-commit is skipped (named in Failure modes; extension point in Out of Scope).

**D10 — Trip telemetry into events.jsonl.** Per-tick events would spam the timeline (hundreds per night); no event at all would hide poller-initiated aborts from `faff audit`'s supervision summary. **Chosen:** append one `sentry-checkpoint` event (existing closed-set type, `data` = the verbatim check payload — audit already consumes it) on the L4 abort action only, via a same-region direct require of `events.js`'s `appendEventRecord`; quiet ticks and non-L4 advisories go to `sentry-poller.log` only.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** ADR-0065 exists and stands as the governing design (status Proposed; its blocker spike FAFF-426 is Done and this issue is its named follow-up). Validation: `records/adr/0065-sentry-watchdog-invocation-locus-*.md` present with the follow-up matching this issue's scope.
- **Assumes:** `ENTRYPOINT` exported from `shared-infra.js` resolves to the `bin/faff` entry script. Validation: `grep ENTRYPOINT plugin/skills/faff/bin/lib/shared-infra.js` and its existing use in sentry.js L672.
- **Assumes:** `sentry abort` without `--worktree` is a supported call (ledger-mark only). Validation: sentry.js L658 — `--worktree` read optionally, WIP block guarded by `if (worktree)`.
- **Assumes:** FAFF-471's peer change lands its own `COMMANDS`/`REGION_MAP` lines independently; conflicts are line-adjacent, resolved at merge. Validation: rebase before merge; `faff regions check` catches drift.

## 8. DONE — Definition of Done

### From WHY (principles)
- [ ] The poller module contains no threshold/trigger logic: every verdict originates from a `sentry check` child call, greppable as the only decision input
- [ ] No code path in the module sends a signal to any PID (no `process.kill` with a signal ≠ 0), and the only ledger-writing call is the `sentry abort` child
- [ ] The FAFF-352 checkpoint consult prose and `sentry.js` check/abort behaviour are unmodified (no diff outside the new module, dispatch/region/doc registrations, tests, and the two beep-boop prose lines)

### From WHAT (surfaces)
- [ ] `faff sentry-poller start` resolves the run dir per the standard chain, exits 3 with no run dir/ledger, is idempotent on a live pid, clears a stale sentinel, spawns detached+unref'd, and writes `sentry-poller.json` `{pid, started_at, interval_secs}` atomically
- [ ] `stop` writes `sentry-poller.stop` and exits 0 (including when no handle exists); `status` reports `{running, pid, started_at, interval_secs}` from handle + `kill(pid, 0)` probe
- [ ] `--interval-secs` validates integer ≥ 1 (exit 2 otherwise), default 90
- [ ] `COMMANDS`, `REGION_MAP` (governance), `REGION_SELFTEST_ARGV`, and `docs/guide/cli.md` all carry the new entry — `faff regions check`, `faff regions selftest`, and `faff lint-cli-doc` pass

### From HOW (tick behaviour)
- [ ] Sentinel present → exit 0 within one tick; run dir gone → exit 0; `owner.status ≠ "running"` → exit 0 with `self-stop-owner-status` logged
- [ ] L4 + `tripped: true` + `intervention: "abort"` → `sentry abort --run-dir` child runs, ledger reads `owner.status: "aborted-resumable"` + abort entry, one `sentry-checkpoint` event appended, poller exits; a failed abort child logs `abort-failed` and polling continues
- [ ] Non-L4 + the same trip → no abort child, ledger unchanged, `advisory-trip` logged (the holdout scenario's rule)
- [ ] `pause`/`correct` interventions → log only, both levels
- [ ] `sentry check` exit 3 / unparseable output → `indeterminate` logged, no abort, polling continues; 20 consecutive faults → `fault-cap-exit` and exit 0
- [ ] Log-append failure never terminates or blocks the loop (loop wrapped so telemetry errors are swallowed)

### From HOW (wiring)
- [ ] beep-boop SKILL.md: `sentry-poller start` at the owner-stamp step, `sentry-poller stop` at the owner-close step, one poller-lane sentence in _The interrupt_ — and `faff validate-adapters` passes

### From HOW (tests)
- [ ] `--selftest` drives the pure tick-decision core over a fixture table (every dispatch row above: sentinel / dir-gone / owner-status / L4-abort / non-L4-advisory / pause / indeterminate / fault-cap)
- [ ] `test/sentry-poller.test.mjs` exercises the real CLI (`execFileSync`, `mkdtempSync` throwaway roots, `--interval-secs 1` + deadline-bounded wait loops): spawn survives parent exit (handle pid alive), stale-heartbeat L4 fixture → aborted-resumable within the deadline, stop-sentinel death, owner-status self-stop, idempotent start, non-L4 no-abort

**Integration smoke test (pseudocode):**

```
1. mkdtemp root; write an L4-shaped run-ledger (level "L4", owner running,
   started_at/last_heartbeat = now - 2 * staleness window; no heartbeat file)
2. faff sentry-poller start --run-dir <dir> --interval-secs 1   → exit 0, handle written
3. wait ≤ 10s for ledger owner.status == "aborted-resumable"
4. assert: abort entry present, sentry-checkpoint event appended,
   log contains abort-actioned, handle pid no longer alive
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
