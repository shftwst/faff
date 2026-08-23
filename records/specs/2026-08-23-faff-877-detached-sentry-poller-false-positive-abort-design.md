# nlspec — FAFF-877: A shared bounded-operation supervisor for long producer and engine dispatches

> Spec: faffter-dark-nlspec · 2026-08-23 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-877.

> Revised 2026-08-23 — folded the human-resolved operation_deadline_secs default (3600s, per-consumer overridable); re-rated medium → high. Round-2 spec-review: **approve** (four round-1 minors resolved; the Agent-tool producer liveness path re-scoped so the bounded milestone-tick contract, not supervised sub-calls, is the load-bearing defence for the nested repro).

**Artifact:** a buildable specification for the build agent and human reviewers. **Issue:** FAFF-877 (Bug) — the detached sentry poller false-positive-aborts a healthy run when a long foreground producer subagent (e.g. a ~16-minute plot decompose) never ticks the parent ledger heartbeat, so the heartbeat ages past the staleness window; and the mandated between-units cooperative sentry checkpoint is skipped, so the cooperative lane runs on unaware of the abort. This is a fresh whole-cloth redraft; a prior spec built on a 720-second engine ceiling, boundary-only heartbeat ticks, and synchronous Codex execution is withdrawn and must not be reused.

## 1. WHY — Problem and Principles

**The load-bearing model.** Run liveness is a single scalar — the parent run's heartbeat freshness — that Sentry reads to decide whether a quiet run is alive or hung. The fix makes every long-running operation keep that exact scalar fresh *while it is genuinely alive*, and stop refreshing it the instant it completes, is cancelled, fails, or outlives its own policy budget. A separate **operation lease** is the local, in-process record that explains why a quiet period is legitimate and bounds how long the operation is permitted to keep the heartbeat alive; the lease cannot renew itself past its policy deadline. Because Sentry keeps reading only heartbeat freshness, a healthy long op looks live and a dead one looks stale — with no new grace, no gameable proxy, and no change to what Sentry *does* when it trips.

**Problem statement.** Today a foreground producer subagent (plot decompose, a prep spec dispatch) holds the run for many minutes without any tool that ticks the parent heartbeat, so the heartbeat ages past the stale window and the detached `sentry-poller` marks the ledger `aborted-resumable` mid-work (observed: `run-20260818-192940-lights-out`, 19:55:23); the between-units cooperative Sentry checkpoint is also skipped, so the cooperative lane never observes the abort and runs to a clean terminal unaware. This change gives every long operation a supervisor that renews the parent heartbeat while it lives, and re-arms the cooperative checkpoint at producer-return and between plot altitude batches so a detached intervention is observed before more work is dispatched.

**Design principles** (each would reject an otherwise-valid implementation):

- **Heartbeat is liveness, not progress.** The supervisor renews the *exact* parent run heartbeat while an operation is alive and STOPS renewing in a `finally` on completion, cancellation, failure, or lease expiry. Heartbeat renewal, token chunks, and mere process existence MUST NOT manufacture a workflow-progress event — FAFF-847's fresh-heartbeat-without-progress condition must remain reachable.
- **The lease is a local bound, never a signal Sentry reads.** The lease governs how long the supervisor is willing to renew; it lives in-process and expires on a non-self-renewable policy deadline. Sentry/poller acting logic reads only heartbeat freshness and stays byte-identical. This is what keeps the design honest: unlike a build-start proxy, an expired lease stops renewal, the heartbeat goes stale, and the run trips exactly as an unsupervised hang would.
- **Deadline is policy, per consumer.** Each consumer owns a configurable *total* operation budget. The engine/connection default is no longer treated as a universal safe duration. Adversarial review keeps its existing dynamically-divided chain deadline unchanged.
- **Layered transport limits answer different questions.** Connection timeout (can I reach it?), optional activity-based idle watchdog (is a *streaming* transport still delivering?), and total operation deadline (has this operation run too long overall?) are distinct and independently configurable.
- **The supervisor owns the process tree.** A subprocess operation runs as an asynchronous detached child in its own process group; on deadline or cancellation the supervisor stops the *complete* tree, not just the leader.
- **No new producer-in-flight grace.** The generic stale window governs any work without a valid active lease. Do not add an unbounded producer-in-flight grace and do not weaken the `run_elapsed_ceiling_secs` backstop.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/engine-codex.js` | Node (CJS) | `runCodexCall` uses `spawnSync` (blocking), `DEFAULT_CODEX_TIMEOUT_MS=120000`, SIGTERM on a single child; the sync path to make async + supervised |
| `plugin/skills/faff/bin/lib/engine.js` | Node (CJS) | `runEngineCall` (async POST, `engine.timeoutMs` connection-only, default 120000); dispatcher `cmdEngine` `return spawnRunner(...)` accepts int-or-Promise |
| `plugin/skills/faffter-dark-adversarial-review/killable-spawn.mjs` | Node (ESM) | Existing bounded, killable, process-GROUP spawn library (`detached:true`, hard-kill whole group at `(deadline+grace)*1000`, verbatim exit passthrough, single-settle, injected I/O); self-described as adoptable by future consumers |
| `plugin/skills/faffter-dark-adversarial-review/review-call.mjs` | Node (ESM) | `perBackendBudget = totalDeadlineMs / n`; per-backend deadline slice; must stay byte-identical |
| `plugin/skills/faff/bin/lib/sentry.js` | Node (CJS) | `evaluateDerailment`, `staleTrip`/`elapsedTrip`, `evalHeartbeatProgressMismatch` (fresh-only → `surface`), the FAFF-553 in-flight grace keyed off `sentryInflightMembers` |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | Node (CJS) | Detached watchdog; only ledger-writing action is `faff sentry abort` |
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node (CJS) | `cmdHeartbeat` — owner-`running` guarded single-value write; `--unit ISSUE`; soft no-op outside a live run, loud exit 3 on a named non-run-dir |
| `plugin/skills/faff/bin/lib/shared-infra.js` | Node (CJS) | `RUN_HEARTBEAT_STALE_SECS_DEFAULT=900` |
| `plugin/skills/faff/bin/lib/governance-profile.js` | Node (CJS) | `run_elapsed_ceiling_secs=14400`; `stall_window_secs` sources the 900 default |
| `SKILL.md` (faff, faff-prep, faff-plot, faff-beep-boop, faff-graft) | Markdown | Producer-dispatch and between-units checkpoint orchestration prose the fix touches |

Repo config for this deployment: `sentry.stall_window_secs: 2400`, `adversarial.deadline: 1920`.

**Scope statement.** This sits at the run-liveness seam between long operations (producers, HTTP/local/Codex engine calls, adversarial review) and the Sentry derailment monitor — it makes long legitimate operations keep the shared heartbeat fresh without teaching Sentry any new trust.

## 2. OUT OF SCOPE

- **Changing Sentry acting behaviour or predicates** — Why: the design is honest precisely because Sentry keeps reading only heartbeat freshness. Extension point: `sentry.js` `evaluateDerailment` and its predicates stay untouched; a future ticket that wants Sentry to read a lease must first defeat the build-start-proxy objection FAFF-234/FAFF-553/FAFF-847 rejected.
- **Removing or altering the FAFF-553 in-flight grace** — Why: it governs build-lane member turns, a different locus, and the human decision forbids touching Sentry acting logic. Extension point: the `sentry.js` grace branch left as-is.
- **A new activity/idle watchdog on the current non-streaming HTTP POST** — Why: `runEngineCall`'s `postFn` returns a whole body, so there is no trustworthy per-chunk activity signal. Extension point: the supervisor's idle-watchdog hook is wired only where a transport streams (a future streaming engine transport, or the Codex JSONL stream).
- **The concept page `docs/concept/run-liveness-and-sentry.md`** — Why: it is referenced by the human's decision comment but not committed; its contents are not invented here. Extension point: the intended published home for this design; author it in a follow-up.
- **Re-pricing / re-metering engine spend** — Why: unrelated to liveness; the FAFF-604 spend sink is preserved verbatim across the async rewrite. Extension point: `engine-codex.js` `spendSink`.
- **Concurrency-executor and build-lane heartbeat callers** — Why: FAFF-234 already ticks those; this ticket extends the *header enumeration* and adds the producer/engine callers, it does not re-plumb existing ones.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Operation | A single bounded unit of work the supervisor wraps: one HTTP engine call, one local/Codex child process, one adversarial-review chain, or one producer dispatch. |
| Operation lease | The in-process record of a named operation's start and policy expiry; explains a legitimate quiet period and bounds renewal. Cannot self-renew past its expiry. |
| Supervisor | The lifecycle wrapper that owns a lease, renews the parent heartbeat while alive, applies layered timeouts, and (for subprocess ops) owns the process group. |
| Heartbeat renewal | A periodic tick of the exact parent run heartbeat (`faff heartbeat` write path) at an interval well under the stale window, driven by the supervisor. |
| Cooperative checkpoint | The between-units Sentry read the orchestrator runs after a producer returns and between plot altitude batches, before dispatching more work. |

**Type definitions** (language-agnostic pseudocode).

```
RECORD OperationLease:
  name: String                 # e.g. "engine:codex", "producer:plot-decompose", "adversarial-chain"
  run_dir: Path                # the EXACT parent run dir; never resolved via latest-run fallback
  started_at: Timestamp        # monotonic op start
  deadline_secs: Integer       # total operation budget (policy; per consumer)
  expires_at: Timestamp        # started_at + deadline_secs; immutable once set
  CONSTRAINT expires_at == started_at + deadline_secs   # non-self-renewable

RECORD LayeredTimeouts:
  connect_secs: Integer        # reach/connection timeout (existing engine.timeoutMs semantics)
  idle_secs: Integer | null    # optional activity watchdog; only meaningful for a STREAMING transport
  deadline_secs: Integer       # total operation deadline (== lease.deadline_secs)

ENUM SupervisedOutcome:
  COMPLETED                    # inner op returned; verbatim inner result/exit is passed through
  DEADLINE_KILLED              # lease expiry / total deadline; process group stopped
  CANCELLED                    # external cancel (SIGINT/SIGTERM); process group stopped
  FAILED                       # spawn/transport failure

RECORD RenewalConfig:
  renewal_secs: Integer        # heartbeat tick interval; default 60, MUST be << stall_window_secs
```

**API surfaces.**

- **Supervisor entry (new).** A shared primitive `superviseOperation({ lease, timeouts, run, onTick, work })` that: starts a renewal timer (ticks the parent heartbeat every `renewal_secs`), runs `work` (either an async subprocess arm or an async transport arm), and in a `finally` stops the renewal timer and — for subprocess ops — stops the process group. Returns the inner op's verbatim result on `COMPLETED`; a named outcome otherwise. I/O (spawn, kill, timers, heartbeat write) injectable for selftest, mirroring the existing `killable-spawn.mjs` and `engine-codex.js` injection style.
- **Subprocess arm.** Reuses `killable-spawn.mjs`'s `runKillable` for process-group spawn + hard-kill-at-`deadline+grace`; the supervisor adds only the heartbeat-renewal timer around it. `killable-spawn.mjs` is relocated to a shared home so it is importable outside the adversarial-review skill (see section 6 / the DONE relocation item).
- **`runCodexCall` (rewritten async).** Same `{ engine, system, user, spawnFn, env, stdoutWrite, stderrWrite, mkdtempFn, spendSink, nowFn }` inputs, same `ENGINE_EXIT` outcomes and messages, but returns `Promise<ENGINE_EXIT-int>` instead of a sync int, and drives the child through the supervisor's subprocess arm. The dispatcher already accepts int-or-Promise (`cmdEngine`: `return spawnRunner(...)`), so the contract holds. `spawnFn` stays injectable; the FAFF-604 spend sink and every `ENGINE_EXIT` mapping are preserved.
- **`runEngineCall` (extended).** Gains a total operation deadline distinct from `engine.timeoutMs` (which remains the connection/request timeout) and heartbeat renewal for the duration of the call. The optional idle watchdog stays unwired while the POST is non-streaming.
- **`cmdHeartbeat`.** Unchanged write semantics (owner-`running` guard, `--unit`, soft no-op outside a live run). Its header caller enumeration is extended to name the supervisor and producer/engine dispatches.

**Design decisions** (each carries a canonical marker; collected in section 6): shared supervisor generalizes vs sibling-of `killable-spawn.mjs` (**Chosen**); Sentry reads a lease vs stays heartbeat-only (**Chosen**); async child replaces sync Codex (**Chosen**, human decision); Agent-tool producer liveness scoping (**Chosen**); engine/Codex total-operation-deadline default value (**Chosen**, human decision).

## 4. HOW — Behavior

**Architecture and approach.** A single supervisor primitive wraps every long operation. It is a lifecycle coordinator, not itself a process-killer: for subprocess operations it delegates process-group control to the existing `killable-spawn.mjs`; for transport operations (HTTP) there is no process to kill and it applies layered timeouts. Around either arm it runs one job — renew the exact parent heartbeat while the operation is alive, and stop renewing the moment the operation settles or its lease expires. Sentry is not modified; it continues to read heartbeat freshness, which the supervisor now keeps honest.

**Supervised operation — the core loop.**

```
PROCEDURE supervise_operation(lease, timeouts, run, work):
  1. Assert lease.run_dir is the EXACT parent run_dir (passed in, never latest-run).
  2. Arm renewal timer: every renewal_secs, tick faff-heartbeat for lease.run_dir.
     - Tick is the existing owner-"running"-guarded single-value write (soft no-op if not running).
     - A tick NEVER emits a workflow-progress event.
  3. Arm total-deadline timer at lease.expires_at (== started_at + deadline_secs).
  4. TRY:
       result = await work(...)          # subprocess arm (runKillable) OR transport arm (POST)
       outcome = COMPLETED
     CATCH transport/spawn failure:
       outcome = FAILED
     ON deadline timer OR external cancel:
       outcome = DEADLINE_KILLED | CANCELLED
       IF subprocess arm: stop the whole process GROUP (runKillable's hard-kill)
  5. FINALLY:
       a. Clear the renewal timer  (STOP renewing — completion, cancel, failure, or expiry)
       b. Clear the deadline timer
       c. IF subprocess arm still alive: ensure the process group is stopped
  6. RETURN the inner op's VERBATIM result on COMPLETED; the named outcome otherwise.
```

**Codex async rewrite.**

```
PROCEDURE run_codex_call(engine, system, user, injected...):   # returns Promise<ENGINE_EXIT>
  1. api-key guard + seat probe: UNCHANGED (same messages, same ENGINE_EXIT.AUTH/UNREACHABLE).
  2. mkdtemp temp cwd: UNCHANGED (named UNREACHABLE on failure, never an escaped throw/reject).
  3. Build lease { name:"engine:codex", run_dir, deadline_secs: operation_deadline_secs (default 3600s, per-consumer) }.
  4. await supervise_operation(lease, timeouts, run, work = spawn `codex exec --json` child):
       - child spawned via injected spawnFn, detached, in its own process group.
       - connect/request handled by existing timeout; total budget by the lease.
  5. On COMPLETED: parse stream fail-loud, non-zero-exit classify, FAFF-604 spend record,
     emit verbatim block — every existing ENGINE_EXIT mapping and message BYTE-IDENTICAL.
  6. On DEADLINE_KILLED: ENGINE_EXIT.UNREACHABLE, message naming the operation deadline
     (parallel to today's "timed out after Nms"); process group already stopped.
  7. On FAILED: existing UNREACHABLE/ENOENT mappings.
  ANTI-PATTERN: leaving runCodexCall synchronous. Why: a blocked spawnSync starves the
  renewal timer — the exact starvation this ticket fixes.
```

**HTTP engine layered timeouts.**

```
PROCEDURE run_engine_call(engine, ...):
  1. connect/request timeout = engine.timeoutMs (UNCHANGED; the connection question).
  2. total deadline = engine.operationDeadlineSecs (the operation question; distinct key, default 3600s, per-consumer).
  3. idle watchdog = wired ONLY if the transport streams (unset for the current POST).
  4. Run under supervise_operation with a lease named "engine:<name>"; renew heartbeat throughout.
  5. Verbatim status mapping (ok/unreachable/model-not-served/auth/malformed) UNCHANGED.
```

**Cooperative checkpoint re-arm.**

```
PROCEDURE cooperative_checkpoint(run):
  1. Run the existing Sentry read (the beep-boop between-units check).
  2. Fire it AFTER every producer subagent returns (prep spec, plot decompose), AND
     BETWEEN autonomous-plot altitude batches, BEFORE dispatching the next unit.
  3. IF the ledger is aborted/paused: stop dispatching; surface per the existing abort handling.
  4. IF the checkpoint's OWN Sentry/ledger read FAILS (unreadable ledger, sentry consult error):
     FAIL SAFE — halt/surface, NEVER dispatch the next unit unaware. Fail-open (dispatch on a
     failed read) is the exact bug class this ticket fixes and is forbidden here.
  ANTI-PATTERN: ticking once at run start and then running a multi-minute producer with no
  checkpoint until a clean terminal. Why: that is the FAFF-877 repro.
```

**Agent-tool producer liveness — scoped, not supervisor-wrapped (the marquee repro's own class).** The supervisor is a Node primitive (`killable-spawn.mjs` + a renewal timer); it **cannot wrap an Agent-tool subagent call** — and the marquee repro (a ~16-minute plot decompose) *is* an Agent-tool producer subagent. So that path's liveness is covered by three explicit layers, not by pretending the supervisor reaches it:
1. **The bounded milestone-tick contract — the load-bearing defence for the nested repro.** The producer receives the EXACT parent `run_dir` and MUST tick `faff heartbeat <run_dir>` at internal milestones **at least every `producer_tick_max_secs`, a documented cadence strictly below `stall_window_secs`** (here 2400s; a safe default is well under half the window). The cadence is the contract, gated by the producer-skill prose; it MUST NOT resolve the newest run as a fallback (`latestRunDir` is never a substitute). This layer alone keeps a nested producer alive even when layer 2 provides no coverage.
2. **Supervised sub-calls (coverage only where the sub-call actually forks).** An engine/model call a producer *makes* renews the parent heartbeat **only when it forks to `faff engine call --run-dir "$FAFF_RUN_DIR"`** — i.e. an `engine:<name>` lane dispatched from a top-level orchestrator. Note the marquee repro is a plot decompose running *as a producer subagent*, whose methodology sub-calls **fall back in-context (single-level nesting)** and do NOT fork to a supervised `faff engine call`; layer 2 therefore does NOT cover that exact case, which is precisely why layer 1's tick contract is mandatory and load-bearing. Layer 2 is a bonus where it applies (top-level engine lanes), never the primary cover for the nested repro.
3. **The cooperative-checkpoint backstop.** The between-units checkpoint at producer-return observes a detached abort before the next unit dispatches.
A producer that goes fully silent — no supervised sub-call and no tick — for longer than `stall_window_secs` is **honestly caught by the poller and aborted**. That is the intended liveness floor for a genuinely-hung producer, not a regression; the design scopes this path rather than claiming the Node supervisor covers it.

**Edge cases and error handling.**

- Renewal tick outside a live run (owner not `running`): soft no-op, exit 0 — never crashes the supervised op (existing `cmdHeartbeat` contract).
- Lease expiry vs inner completion race: single-settle discipline (mirror `killable-spawn.mjs`'s `settled` guard) — the first event wins, later events are documented no-ops.
- `run_elapsed_ceiling_secs` (14400) remains the ultimate backstop; a lease can never push a run past it (Sentry's elapsed trip is never graced and is unchanged).
- A dead supervisor (crashed process, killed renewal timer) stops ticking → heartbeat ages → the poller trips exactly as today. No special-casing.
- Non-streaming POST: idle watchdog absent, so a legitimately silent inference is not falsely idle-killed; only connect + total deadline apply.

**Failure modes.**

- **The failure:** the renewal timer keeps ticking after the operation is really dead (timer not cleared on an unusual throw path), masking a genuine hang. **How you'd know:** a Sentry false-negative — a wedged run that never trips; a test asserting the `finally` clears the timer on the throw path fails. **What it means:** blocker for the `finally` discipline — proceed only with the single-settle + `finally`-clear tests green.
- **The failure:** the lease's total deadline is set so high a hung child is effectively unbounded below `run_elapsed_ceiling`. **How you'd know:** the "hung child stopped at the operation deadline" scenario takes ~14400s (the ceiling) instead of the operation budget. **What it means:** narrow — the deadline default is 3600s (section 6), generous enough not to trip a legitimately long-but-healthy dispatch yet well below the 14400s ceiling; a consumer that needs a tighter bound overrides it downward.
- **The failure:** heartbeat renewal is mistaken for progress and suppresses FAFF-847. **How you'd know:** `evalHeartbeatProgressMismatch` stops ever returning `surface` on a fresh-heartbeat/no-progress run; its existing selftest rows change. **What it means:** blocker — renewal must write only the heartbeat file, never a workflow-progress event.

**Anti-patterns.**
- **Anti-pattern:** teaching Sentry/poller to read the lease to suppress an abort. Why: reintroduces the gameable build-start proxy FAFF-553/FAFF-847 rejected; the heartbeat-freshness path already achieves the goal honestly.
- **Anti-pattern:** re-implementing process-group kill in the codex path. Why: `killable-spawn.mjs` is the one home for that discipline and invites reuse.

## 5. Scenarios — born-verifiable main objectives

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a healthy local/Codex model whose single operation runs longer than the engine connection default (120s) but under its operation budget
When the operation is run under the supervisor with the sentry-poller armed
Then the parent heartbeat is renewed throughout, the poller never marks the ledger aborted, and the operation returns its verbatim result
```

```
Given a supervised operation whose supervisor process dies (renewal stops)
When the stall window elapses with no further heartbeat tick
Then Sentry detects staleness and the poller acts exactly as it does for an unsupervised hang (no new grace applied)
```

```
Given a live supervisor renewing the heartbeat with no durable workflow-progress event emitted
When FAFF-847's heartbeat-progress-mismatch evaluation runs on a fresh heartbeat
Then it still reaches its fresh-heartbeat-without-progress condition (renewal did not manufacture progress)
```

```
Given an Agent-tool producer subagent (a plot decompose) running longer than stall_window_secs, whose model sub-calls fork to supervised `faff engine call` and which ticks faff-heartbeat at milestones no wider than producer_tick_max_secs (< stall_window_secs)
When the producer runs to completion with the sentry-poller armed
Then the parent heartbeat is renewed throughout (by the supervised sub-calls and the bounded ticks) and the poller never marks the run aborted, and the cooperative checkpoint at producer-return observes no abort
```

```
Given a nested producer subagent whose methodology sub-calls fall back in-context (they do NOT fork to a supervised `faff engine call`) but which ticks faff-heartbeat at milestones no wider than producer_tick_max_secs (< stall_window_secs)
When the producer runs longer than stall_window_secs with the sentry-poller armed
Then the parent heartbeat stays fresh on the ticks ALONE and the poller never marks the run aborted (the tick contract is the load-bearing defence; no supervised sub-call is required)
```

- The adversarial-review chain MUST keep `perBackendBudget = totalDeadlineMs / n` slicing and every existing failure/exit outcome byte-identical after the supervisor generalization.

## 6. Design Decision Rationale

**Does the shared supervisor generalize `killable-spawn.mjs`, or is it a new sibling both the engine/codex paths and adversarial review adopt?** Generalizing killable-spawn into the supervisor forces process-group control to *be* the supervisor, but HTTP engines have no child process to group-kill — a category error. **Chosen:** the shared operation supervisor is a NEW coordinating primitive; its subprocess arm reuses `killable-spawn.mjs` (relocated to a shared home — see the relocation decision below), and its transport arm applies layered timeouts to the HTTP path. Rationale: matches the human "same lifecycle primitive" intent while respecting that HTTP has no process to kill, and avoids duplicating the process-group kill.

**Does Sentry/the poller read the lease, or stay heartbeat-only?** A lease Sentry reads is a suppression signal — the same shape as the build-start proxy FAFF-553/FAFF-847 rejected. **Chosen:** Sentry/poller acting logic is UNCHANGED and reads only heartbeat freshness; the lease is a local, non-self-renewable bound on renewal. Rationale: honest by construction — an expired or absent lease cannot suppress an abort, the `run_elapsed_ceiling` backstop is untouched, and "governs work without a valid active lease" falls out of the heartbeat mechanism rather than a new trusted read.

**Synchronous vs asynchronous Codex execution.** **Chosen** (human decision record): replace the synchronous `spawnSync` path with an asynchronous detached child so heartbeat and cancellation timers run during the call; the supervisor owns the process group and stops the tree on deadline/cancel. `runCodexCall` returns `Promise<ENGINE_EXIT>`; the dispatcher's int-or-Promise contract is preserved and `spawnFn`/spend-sink injection is retained. Rationale: a blocked `spawnSync` cannot tick a renewal timer — the root starvation.

**killable-spawn.mjs relocation (confirmed non-importable today).** It is **not** importable outside the adversarial-review skill today — `link-skills.sh` symlinks whole skill dirs, there is no package export, and its only importers are siblings by relative path. **Chosen:** relocate it to a shared home both skills import (e.g. `plugin/skills/faff/bin/lib/` or a shared module) and re-point the adversarial-review skill's own importers; this is a real build step, not a "minimal" tweak. Rationale: the codex/engine subprocess arm must import the one process-group kill implementation, so it must live where both skills resolve it under the whole-dir symlink model.

**Engine-lane liveness via the shared supervisor; no unbounded producer-in-flight grace; cooperative checkpoint at producer-return and between altitude batches.** **Chosen** (human decision record): all three are settled by the authoritative decision; recorded here so the build agent does not re-open them.

**How is the Agent-tool producer subagent's own liveness covered, given the Node supervisor cannot wrap it?** The supervisor is a Node primitive and cannot wrap an Agent-tool subagent call, yet the marquee repro is exactly such a producer (plot decompose). Options: (a) pretend the supervisor covers it — false; (b) add a producer-in-flight grace to Sentry — rejected (a suppression signal, the build-start-proxy shape); (c) scope the path across supervised sub-calls + a bounded tick contract + the checkpoint backstop. **Chosen:** (c). The **load-bearing** layer is the bounded milestone-tick contract — the producer ticks `faff heartbeat <run_dir>` at milestones no wider than a documented `producer_tick_max_secs` strictly below `stall_window_secs` — because a nested plot-decompose subagent's methodology sub-calls fall back in-context (single-level nesting) and do NOT fork to a supervised `faff engine call`, so supervised-sub-call coverage does not reach the marquee repro. Supervised sub-calls help only for top-level `engine:<name>` lanes; the cooperative checkpoint at producer-return is the backstop; and a genuinely-silent producer past the window is honestly aborted by the poller (the intended floor). Rationale: honest by construction — no new Sentry trust, the marquee repro's own class is explicitly addressed by a mandatory tick cadence rather than left to best-effort ticking or a coverage claim that does not hold for a nested subagent.

**Engine/Codex total operation deadline — default value.** A constant tied to the adversarial deadline (~1920s) risks tripping a legitimately long-but-healthy dispatch; leaving it unset leans on the 14400s run-elapsed ceiling (effectively unbounded per operation). **Chosen** (human decision, alec, 2026-08-22): `operation_deadline_secs` defaults to **3600s (1 hour), configurable per consumer.** Rationale: the watchdog ceiling must not trip a legitimately long-but-healthy dispatch (that would re-introduce a cousin of the very false-abort this ticket fixes); with the move to slower local models (oMLX / ollama) producer dispatches are slower and more variable, so the default is set generous; fast hosted consumers override downward per consumer. It stays decoupled from the connection default (`engine.timeoutMs`) and from `sentry.stall_window`, and sits well below `run_elapsed_ceiling_secs` (14400s) so the whole-run backstop is untouched.

## 7. Open Questions and Assumptions

**Open Questions.** None open. The one prior open question — the *default value* of `operation_deadline_secs` — is resolved: **3600s, per-consumer overridable** (human decision, alec, 2026-08-22; recorded as **Chosen** in section 6).

**Assumptions.**

- **Assumes:** the run dispatcher continues to accept an int-or-Promise return from `spawnRunner`. Validate: confirm `cmdEngine` in `engine.js` still does `return spawnRunner(...)` with no synchronous-int assumption downstream before landing the async rewrite.
- **Assumes:** the shared home chosen for `killable-spawn.mjs` resolves under both install shapes (dev-linked symlink and plugin). (Its current non-importability outside the adversarial-review skill is a confirmed fact, handled by the relocation decision in section 6, not an assumption.) Validate: after the move, confirm both the codex/engine lib and the adversarial-review skill resolve the import under `link-skills.sh`'s whole-dir symlink model.
- **Assumes:** the between-units cooperative checkpoint procedure in `faff-beep-boop/SKILL.md` is the single orchestration site to re-arm for producer-return and plot altitude batches. Validate: confirm no second cooperative-check site exists that would also need the re-arm.

## 8. DONE — Definition of Done

### From WHY
- [ ] A long producer/engine operation keeps the parent heartbeat fresh for its full duration; the sentry-poller does not mark a healthy run aborted (reproduces `run-20260818-192940`-class safely).
- [ ] Heartbeat renewal, token chunks, and process existence emit no workflow-progress event.

### From WHAT (types and interfaces)
- [ ] An `OperationLease` records `started_at` + `expires_at = started_at + deadline_secs` and cannot be renewed past `expires_at`.
- [ ] `runCodexCall` returns `Promise<ENGINE_EXIT>`; every existing `ENGINE_EXIT` code, message, and the FAFF-604 spend record are byte-identical to the sync version on the happy and failure paths.
- [ ] `runEngineCall` exposes a total operation deadline distinct from `engine.timeoutMs` (connection); `operation_deadline_secs` defaults to 3600s and is overridable per consumer.
- [ ] `cmdHeartbeat` write semantics unchanged; its header caller enumeration names the supervisor and producer/engine dispatches.

### From HOW (behaviour)
- [ ] The supervisor renews the exact parent heartbeat every `renewal_secs` (default 60, `<< stall_window_secs`) and STOPS renewing in a `finally` on COMPLETED / CANCELLED / FAILED / lease expiry.
- [ ] On DEADLINE_KILLED or CANCELLED a subprocess operation has its whole process group stopped (via `killable-spawn.mjs`), verified by no surviving child incl. a reparented-to-init descendant.
- [ ] The Codex child is spawned asynchronously and detached; a blocked `spawnSync` no longer starves the renewal timer.
- [ ] The cooperative Sentry checkpoint fires after every producer return and between plot altitude batches, before dispatching the next unit, and stops dispatch on an aborted/paused ledger.
- [ ] Agent-tool producers forward the exact parent `run_dir` and never resolve the newest run as a fallback.
- [ ] The Agent-tool producer liveness path is covered by the three scoped layers: its model sub-calls fork to supervised `faff engine call`; the producer ticks `faff heartbeat <run_dir>` at milestones no wider than a documented `producer_tick_max_secs` strictly below `stall_window_secs`; and the cooperative checkpoint at producer-return is the backstop. A producer silent past the window is aborted by the poller (the documented floor), not falsely covered.
- [ ] `killable-spawn.mjs` is relocated to a shared home both skills import and the adversarial-review importers are re-pointed; both the codex/engine lib and the adversarial-review skill resolve it under `link-skills.sh`.

### From HOW (edge cases)
- [ ] A renewal tick outside a live run is a soft no-op, never crashing the supervised op.
- [ ] `cooperative_checkpoint` fails safe when its own Sentry/ledger read fails (halt/surface), never fail-open (dispatching the next unit unaware). Reconcile this at the single re-arm site with beep-boop's existing between-units prose, where a faulting effects check / failed consult currently proceeds unflagged (logged) — the re-armed checkpoint must not inherit that fail-open on its own read failure.
- [ ] `run_elapsed_ceiling_secs` remains the untouched ultimate backstop; no lease pushes a run past it.
- [ ] Sentry acting logic (`evaluateDerailment`, predicates, FAFF-553 grace, `evalHeartbeatProgressMismatch`) is byte-identical; `evalHeartbeatProgressMismatch` still reaches its fresh-heartbeat/no-progress `surface` verdict.
- [ ] Adversarial review's `perBackendBudget = totalDeadlineMs / n` slicing and every failure/exit outcome are unchanged.

**Eval coverage.** No LLM-judgement seam is introduced or changed (this is liveness plumbing), so no grader registration is required.

**Integration smoke test.**
```
PROCEDURE smoke():
  1. Start a live run; arm the sentry-poller.
  2. Run a supervised operation (injected fake child) that sleeps past the connection default
     but under its operation deadline, asserting heartbeat file mtime advances during the op.
  3. On op return, run the cooperative checkpoint; assert ledger not aborted.
  4. Separately, drive a supervised op whose fake child never exits; assert at deadline the
     process group kill is invoked (negative pgid, SIGKILL) and outcome is DEADLINE_KILLED.
  If steps 2 and 4 pass, renewal-keeps-alive and deadline-kills-the-tree are both wired.
```

### Test homes
- `test/sentry.test.mjs` / `test/sentry-poller.test.mjs` — supervisor-dead-detected; no-new-grace regression lock; Sentry acting byte-identity.
- `test/engine-call.test.mjs` — async `runCodexCall` (int-or-Promise), layered engine timeouts, spend-sink preserved.
- `test/heartbeat.test.mjs` — renewal writes only the heartbeat file, never a progress event.
- `test/killable-spawn.test.mjs` — hung child killed at deadline incl. process group (extended for the generalized/relocated import).
- `test/adversarial-call.test.mjs` — unchanged slicing and outcomes.

---
*Re-prepped interactively via /faff-prep, 2026-08-23 (Scenario B resume). Scoped refresh of the v2 shared-bounded-operation-supervisor spec (2026-08-19): folded the human-resolved `operation_deadline_secs` = 3600s (per-consumer overridable), closed the sole open Punt, re-rated medium → high. Round-1 spec-review `revise` (4 minor) and its three round-2 observations are folded in; round-2 spec-review returned `approve`. The referenced concept page `docs/concept/run-liveness-and-sentry.md` remains uncommitted — flagged for a follow-up; the design here is complete from the decision record.*

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"},{"marker":"assumes"},{"marker":"assumes"} ] }
```