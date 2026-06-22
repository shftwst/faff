# Spec — FAFF-205: session-scope the `runcheck` Stop hook so a parallel beep-boop run never false-blocks an unrelated session

> Spec: faffter-dark-nlspec · 2026-06-22 · autonomous · confidence: high · Full spec on the issue tracker (FAFF-205).

This is the design spec for the build agent and human reviewers. It addresses FAFF-205: the `faff runcheck --hook` Stop hook is session-agnostic — it audits the newest run ledger globally and blocks turn-end on any unrelated interactive session whenever a *parallel* beep-boop drain is mid-flight.

## 1. WHY — Problem and Principles

**The load-bearing model.** A run ledger that shows issues `admitted` with no terminal `outcome` is **ambiguous between two states**: (a) a genuinely abandoned/deferred queue — the run owner is gone and left work dangling, which is exactly what `runcheck` exists to catch; and (b) a *normal in-flight* queue — an orchestrator is actively draining it right now (an issue can sit mid-graft for many minutes during the slow review/merge phase, writing nothing). The current `runcheck --hook` cannot tell these apart because it has no notion of *who owns the run* or *whether anyone still holds it*. The fix gives the ledger an **owner identity + a liveness signal emitted by the orchestrator across the whole graft lifecycle**, so the hook can answer "is this run still being held by a live owner?" — and only flag (a).

**Problem statement.** The `runcheck --hook` Stop hook is registered globally for the repo and fires on every session's turn-end; it audits the *newest* `.faff/runs/*/run-ledger.json` with no notion of session ownership. When a beep-boop drain runs in a *separate concurrent session*, its legitimately-in-flight ledger (admitted, no terminal outcome yet) is indistinguishable from an abandoned queue, so the hook Stop-blocks the *unrelated* session repeatedly with no honest way to satisfy it (dispatching/parking/ledger-editing all collide with the live orchestrator).

**Design principles.**

**Narrow the check, never blind it.** The fix must keep catching a genuinely abandoned/deferred run (owner gone, work admitted-without-outcome). It narrows *who* the check fires for and *when*; it must not weaken the deferred-queue guarantee for the run's actual owner. A regression that lets a real abandoned queue slip past is worse than the false-block being fixed.

**Pure-function CLI invariant (load-bearing).** `runcheck` (like `prepcheck`) never touches the tracker, the network, or any process it doesn't own — it audits externalised on-disk state only (gateway → pure-function CLI invariant; the `prepcheck` header restates it). The liveness signal must therefore be **on-disk state written by the orchestrator**, read by the hook — never an out-of-band probe (no `kill -0` of a foreign pid as the *primary* signal, no tracker read, no network call). Process-liveness may be used only as a *local, same-machine, best-effort* corroborator of the on-disk heartbeat, never as the contract.

**No cross-machine claim here — this is a local-filesystem seam.** FAFF-82's multi-orchestrator safety uses the *tracker* as the coordination point precisely because two machines share only the tracker. FAFF-205 is a different seam: both recurrences were **concurrent Claude Code sessions on the same host**, racing over the same local `.faff/runs/` directory and the same global Stop-hook. The coordination point here is the **local filesystem**, so a host-local owner-id + heartbeat is the right (and sufficient) mechanism — it deliberately does *not* try to solve cross-host run ownership (out of scope).

**Heartbeat must span the whole graft lifecycle, including review/merge.** Per the FAFF-205 comment refinement (second live recurrence, 2026-06-22): a naive "recent worktree mtime ⇒ in-flight" heuristic is **insufficient** — during the slow review/merge phase the build writes nothing to the worktree for minutes, so a mtime-keyed snapshot mis-classifies an actively-merging graft as stalled. The liveness signal must be emitted **by the run owner**, refreshed across the whole lifecycle (assembly → build → review → merge → housekeeping), and must **not** be inferred from artifact timestamps.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` (`cmdRuncheck`, `auditRun`, `latestRunDir`, `resolveRunDir`, `readLedger`) | Node (dependency-free) | The Stop-hook + audit this issue modifies |
| `plugin/skills/faff/bin/faff` (`cmdPrepcheck`, `auditPrepMarkers`) | Node | Sibling Stop-hook; the block-via-decision-payload pattern + selftest shape to mirror |
| `plugin/skills/faff-beep-boop/SKILL.md` (_Run ledger_, steps 4/8/11) | prose | The orchestrator that writes the ledger; gains the owner-stamp + heartbeat-refresh prose |
| `plugin/skills/faff/SKILL.md` (Issue claim & status monotonicity, Autonomous Mode Contract) | prose | The FAFF-82 posture this fix is consistent-with but distinct-from |

**Scope.** A robustness fix to the L3 safety net (the `runcheck` Stop hook + the beep-boop run ledger) — it changes the hook's firing condition and adds an owner/liveness field to the ledger; it does not change the set of valid terminal outcomes or the `admitted − outcomes == ∅` invariant for an owned run.

## 2. OUT OF SCOPE

- **Hook registration / path normalization.** — Excluded: shipped under FAFF-192 / FAFF-200. Extension point: `hooks-ensure` / `planStopHooks` in `plugin/skills/faff/bin/faff` (unchanged here).
- **The valid terminal-state set** (`shipped · pr-open · parked · errored · routed-out · unreached-budget`). — Excluded: unchanged by this fix; the issue is *when/for-whom* the audit fires, not *what counts as terminal*. Extension point: `TERMINAL_STATES` set.
- **Cross-host run ownership.** — Excluded: both recurrences are same-host concurrent sessions; a distributed lock is unjustified machinery (gateway → proportionate-minimal designs). Extension point: the `owner` record could later carry a host id if cross-host concurrency ever becomes real.
- **Concurrency-safe (atomic/locked) ledger writes** (candidate fix #3). — Excluded as lower-priority: once non-owners never write (fixes #1/#2), the clobber surface the human hit (4× `unreached-budget` injected into a live ledger) is closed by *the non-owner not writing at all*, not by write-locking. Extension point: a future `faff ledger-write` atomic helper if a single orchestrator ever forks concurrent ledger writers.
- **`prepcheck` session-scoping.** — Excluded: `prepcheck` reads `.faff/prep/*.json` markers, which are not run-scoped and not owned by a parallel orchestrator the same way; no observed false-block. Extension point: if the same false-block is ever observed for `prepcheck`, mirror this design onto its marker audit.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Run owner | The orchestrator process/session that created and is draining a given `.faff/runs/<run-id>/` ledger. |
| Heartbeat | A monotonic `last_heartbeat` timestamp the owner refreshes on the ledger across the whole graft lifecycle while it still holds the run. |
| Held / live run | A run whose ledger carries a `running` status and a heartbeat fresher than the staleness threshold — an owner is actively draining it. |
| Abandoned run | A run with admitted-without-outcome work whose owner is gone: status not `running`, or a heartbeat older than the staleness threshold (or, same-host, a dead owner pid corroborating it). |
| Owning session | The Stop-hook fires inside a specific session; that session *owns* a run iff the run-ledger's owner-id matches the session's own run pointer (see `FAFF_RUN_DIR`). |

**Ledger schema extension.** The ledger gains an optional `owner` object. Absent `owner` ⇒ legacy ledger ⇒ treated as **unowned/abandoned** (fail-safe: the check still fires, preserving today's behaviour for any pre-existing ledger).

```
RECORD RunLedger:
  run_id: String
  admitted: List<IssueId>
  outcomes: Map<IssueId, TerminalState>
  discovered_scope_filed: Int
  owner: Owner?                  # NEW — absent on legacy ledgers (fail-safe = unowned)

RECORD Owner:
  status: "running" | "done"     # "running" while held; set "done" at orchestrator exit (clean or budget)
  pid: Int?                       # same-host best-effort liveness corroborator; may be absent
  session_id: String?            # opaque owning-session token (e.g. run-id or a session uuid), for the env-pointer match
  last_heartbeat: Timestamp      # ISO-8601; refreshed across the whole graft lifecycle while running
  started_at: Timestamp          # ISO-8601; run start
```

**Owning-session env pointer.** The Stop-hook needs to know whether the *current* session owns the run it found. The orchestrator exports a per-session pointer to its own run dir when it starts a drain:

```
ENV FAFF_RUN_DIR    # absolute path to this session's own .faff/runs/<run-id>/, exported by the beep-boop orchestrator
```

- A beep-boop session sets `FAFF_RUN_DIR` to its run dir (so its *own* Stop-hook still audits its *own* run — the backstop is preserved).
- An interactive session never sets it ⇒ the hook treats *every* run as not-owned-by-me (so it can never be the owner of a foreign in-flight run).

**Design decision — how the hook decides "fire or stay silent".** The hook must distinguish three cases for the run it resolves: *I own it* (audit normally — the backstop), *someone else holds it live* (stay silent — the false-block fix), *abandoned* (fire — preserve the catch).

**Chosen:** A two-signal gate — **ownership** (env pointer match) **then liveness** (ledger status+heartbeat). See HOW. Rationale in §6.

**Staleness threshold.**

**Chosen:** `FAFF_RUN_HEARTBEAT_STALE_SECS`, default **900** (15 min). A held run heartbeats far more often than this; the slow review/merge phase (the exact mtime-blind window) is minutes, comfortably inside it. Tunable via env for slow adversarial-review backends. Rationale in §6.

## 4. HOW — Behavior

**Architecture.** Two cooperating changes:

1. **Orchestrator (prose, faff-beep-boop):** stamp `owner` into the ledger at run start (`status:"running"`, `pid`, `session_id`, `started_at`, `last_heartbeat`), export `FAFF_RUN_DIR`, **refresh `last_heartbeat` across the whole graft lifecycle** (each wave/issue boundary *and* across the slow review/merge phase), and set `owner.status:"done"` at orchestrator exit (clean drain, all-parked, or budget-hit).
2. **Hook (code, `cmdRuncheck`):** before auditing the resolved run, apply the ownership+liveness gate below.

**Behavior summary.** `runcheck --hook` should block a session's Stop **only** when the run it would audit is one this session is responsible for (owns) *or* is a genuinely abandoned run — never when a different live owner is actively draining it.

```
PROCEDURE runcheck_hook():
  1. runDir := resolveRunDir(positional)          # unchanged: own --root/positional wins, else latest global
  2. IF runDir is null: RETURN 0                   # unchanged — no run, nothing to audit
  3. ledger := readLedger(runDir)  (tolerant; on parse error RETURN 0, unchanged)
  4. owned := (env.FAFF_RUN_DIR is set) AND samePath(env.FAFF_RUN_DIR, runDir)
            OR (ledger.owner.session_id is set AND env.FAFF_SESSION_ID == it)   # fallback signal
  5. IF owned:
        # the backstop — my own run; audit exactly as today
        GOTO audit_and_maybe_block(ledger)
  6. # not my run — only fire if it is abandoned, else stay silent
     IF runIsHeld(ledger, now): RETURN 0            # live owner draining it → SILENT (the fix)
     ELSE: GOTO audit_and_maybe_block(ledger)        # abandoned → preserve the catch

PROCEDURE runIsHeld(ledger, now):
  owner := ledger.owner
  IF owner is absent: RETURN false                  # legacy/unowned ledger → fail-safe NOT held
  IF owner.status != "running": RETURN false        # owner exited → not held
  age := now - parse(owner.last_heartbeat)
  IF last_heartbeat missing/unparseable: RETURN false  # fail-safe NOT held
  IF age > STALE_SECS: RETURN false                 # heartbeat stale → owner presumed gone
  # optional same-host corroborator (best-effort, never the sole signal):
  IF owner.pid present AND ownerPidIsLocalAndDead(owner.pid): RETURN false
  RETURN true                                        # running + fresh heartbeat → held

PROCEDURE audit_and_maybe_block(ledger):
  result := auditRun-from-ledger(ledger)             # admitted − outcomes (unchanged auditRun core)
  IF result.undispatched is non-empty:
     console.log(JSON.stringify({ decision: "block", reason: <existing reason text> }))
  RETURN 0                                            # always exit 0; block is via the decision payload
```

**Edge cases and error handling.**

- **Legacy ledger (no `owner`).** `runIsHeld` returns false ⇒ for a non-owning session it audits ⇒ **identical to today's behaviour**. Zero regression for any ledger written before this ships.
- **Owner set but `status:"done"`.** Not held ⇒ audited. A cleanly-exited run that left admitted-without-outcome work *is* a real bug `runcheck` should still catch (e.g. the orchestrator marked done but skipped an issue) — correctly fires.
- **Stale heartbeat (owner crashed mid-run).** `age > STALE_SECS` ⇒ not held ⇒ audited ⇒ a genuinely-crashed run is still caught (AC: abandoned still caught). The same-host dead-pid corroborator catches a crash *faster* than the timeout when pid is present and local, but the timeout is the contract.
- **`pid` absent or foreign-host.** Skip the pid corroborator entirely; rely on `status` + heartbeat age. Never `kill -0` a pid that may belong to an unrelated process on another host's namespace — the pid is a *same-host hint only*, gated on it looking local.
- **`resolveRunDir` with an explicit positional/`--root`** (non-hook CLI use) is unchanged — the ownership gate applies to `--hook` mode only; the human-facing `runcheck` report still audits whatever run dir it's pointed at.
- **Clock skew / unparseable `last_heartbeat`.** If `last_heartbeat` is missing or unparseable, treat as **not held** (fail-safe toward firing, never toward silently passing) — consistent with "narrow, never blind".

**Anti-pattern:** inferring liveness from worktree/file mtimes. Why: the review/merge phase writes nothing for minutes, so mtime mis-classifies an actively-merging graft as stalled (the documented second recurrence).

**Anti-pattern:** having the non-owning session "resolve" the foreign run (dispatch / park / edit the ledger) to satisfy the hook. Why: all three collide with the live orchestrator's read-modify-write.

**Anti-pattern:** making `runcheck --hook` read the tracker or `kill -0` a foreign pid as its primary signal. Why: breaks the pure-function CLI invariant; the contract signal is the on-disk heartbeat the owner writes.

## 5. SCENARIOS

```
Given a beep-boop drain running in session A with run R (ledger owner.status=running, fresh heartbeat, admitted issues mid-build)
And an unrelated interactive /faff-prep running in session B (FAFF_RUN_DIR unset)
When session B's turn ends and the runcheck Stop hook fires, resolving R as the newest run
Then the hook stays silent (RETURN 0, no block decision) and session B's turn-end is not blocked
```

```
Given a beep-boop run R that genuinely abandoned its queue (owner.status not "running" OR last_heartbeat older than STALE_SECS) with admitted issues lacking terminal outcomes
When any session's runcheck Stop hook fires and resolves R
Then the hook emits {decision:"block", reason: ...} naming the undispatched issues
```

```
Given a beep-boop session A that owns run R (FAFF_RUN_DIR == R's dir) and has left an admitted issue with no terminal outcome
When session A's own turn ends and its runcheck Stop hook fires
Then the hook audits R and blocks (the backstop is preserved for the owning session)
```

```
Given a legacy ledger with no owner field and an admitted-without-outcome issue
When a non-owning session's runcheck Stop hook fires
Then the hook audits it and blocks exactly as it does today (zero regression for pre-existing ledgers)
```

Non-functional assertions:

- `runcheck --hook` performs **no** tracker call, **no** network call, and (other than an optional same-host `kill -0` corroborator gated on the pid looking local) **no** foreign-process probe — the pure-function invariant holds.
- The hook always exits `0`; blocking is solely via the `{decision:"block"}` payload (unchanged from today).

## 6. DESIGN DECISION RATIONALE

See the tracker comment (id 9f1251b3) for the full rationale narrative. Summary of chosen options:

- **Liveness signal:** owner-emitted `status` + `last_heartbeat` on the ledger (rejected: mtime heuristic, tracker read).
- **Ownership signal:** `FAFF_RUN_DIR` env-pointer match, with a `session_id`-on-ledger + `FAFF_SESSION_ID` fallback (rejected: pid-match as ownership key).
- **Liveness contract:** heartbeat-age `> STALE_SECS` ⇒ not held; same-host dead-pid an optional accelerator only.
- **Staleness threshold:** default 900s, env-overridable via `FAFF_RUN_HEARTBEAT_STALE_SECS`.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.**

- **Punt:** Default `STALE_SECS` — 900s vs a higher value (e.g. 1800s) given the configured 1200s adversarial-review timeout. Non-blocking — the env override exists; the build ships 900s and a reviewer can bump it.

**Assumptions.**

- **Assumes:** The Claude Code harness propagates the orchestrator's exported environment (specifically `FAFF_RUN_DIR`) into the `Stop`-hook subprocess's environment. **Validated at build:** the harness does not give an interactive session a way to export env into the Stop-hook subprocess, so the build implements **both** the `FAFF_RUN_DIR` env-pointer match **and** the `owner.session_id` + `FAFF_SESSION_ID` fallback. The ownership gate is signal-agnostic; either source proves ownership. This makes the backstop robust regardless of which signal the harness propagates.
- **Assumes:** `.faff/runs/<run-id>/run-ledger.json` is the single ledger location both the orchestrator and the hook resolve.

## 8. DONE — Definition of Done

### From WHY
- [ ] An interactive (non-owning) session's turn-end is **not** Stop-blocked by a beep-boop run it doesn't own while that run is held (owner.status=running + fresh heartbeat).
- [ ] A genuinely abandoned/deferred run (owner gone: status≠running OR stale heartbeat) with admitted-without-outcome work is **still** blocked by the hook.

### From WHAT (schema)
- [ ] The ledger carries an optional `owner` object (`status`, `pid?`, `session_id?`, `last_heartbeat`, `started_at`); a ledger with **no** `owner` is treated as unowned and audited as today (legacy fail-safe).
- [ ] The orchestrator exports `FAFF_RUN_DIR` (or, per the fallback, writes `owner.session_id`) so a session can recognise its own run.

### From HOW (behaviour)
- [ ] `runcheck --hook` audits-and-may-block when the resolved run is owned by the current session (env-pointer or session_id match) — the backstop is preserved.
- [ ] `runcheck --hook` stays silent (RETURN 0, no block) when the resolved run is **not** owned by the current session **and** `runIsHeld` is true.
- [ ] `runcheck --hook` audits-and-may-block when the resolved run is not owned **and** not held (abandoned).
- [ ] `runIsHeld` returns false on: absent owner, `status≠"running"`, heartbeat age > `STALE_SECS`, unparseable heartbeat, or (same-host only) a local-and-dead owner pid.
- [ ] `STALE_SECS` reads `FAFF_RUN_HEARTBEAT_STALE_SECS` (default 900).
- [ ] The orchestrator refreshes `last_heartbeat` across the whole graft lifecycle including the review/merge phase (prose in faff-beep-boop), and sets `owner.status:"done"` at orchestrator exit.

### From HOW (edge cases)
- [ ] Unparseable/missing `last_heartbeat` ⇒ treated as not held (fires, never silently passes).
- [ ] The pid corroborator is skipped when the pid is absent or not provably same-host (no foreign `kill -0`).
- [ ] Non-hook `runcheck` (explicit positional/`--root`, human report) is unchanged — the ownership gate is `--hook`-only.

### From contract (invariants)
- [ ] `runcheck --hook` makes no tracker call and no network call; always exits 0; blocks only via the `{decision:"block"}` payload.

### Selftest
- [ ] `faff runcheck --selftest` (new) drives the gate as a pure function over `(ledger, env-owned?, now)` tuples covering: owned-with-undispatched → block; not-owned + held → silent; not-owned + stale-heartbeat + undispatched → block; not-owned + status-done + undispatched → block; legacy-no-owner + undispatched → block. Both the held and abandoned branches are covered.
