# FAFF-854: a state-based turn-survival Stop hook so a headless owned run cannot end its turn while still "running"

This spec is for the build agent implementing FAFF-854 and for the human reviewer gating it. FAFF-854 is the ticket where an L4 lights-out drain ended its `claude -p` turn to "wait out" an adversarial spec-review outage; headless mode has no scheduler and never auto-resumed, so the process exited and the run died mid-prep. The fix is a general guard, not an outage handler. It adds a new Stop-hook sibling that refuses a non-terminal turn-end on-state, plus the detective half in `faff disposition`. The graceful outage handler is deliberately out of scope (that is the follow-on FAFF-900, which is blocked by this ticket).

## 1. WHY: problem and principles

**The load-bearing model.** In headless `claude -p` mode the turn *is* the process: when the model ends its turn, the cage exits. So a turn may only end on a **terminal outcome** (queue drained, all parked, budget hit, and the owner flipped off `running`) or a **durable hold**. Ending a turn in a non-terminal state, for a non-terminal reason ("I'll resume in a minute"), is a promise headless mode cannot keep. The existing Stop hooks catch two shapes of this (an undispatched queue via `runcheck`, an open per-dispatch marker via `inflightcheck`), but both are content/enumeration checks; neither reads the one durable signal that is always present when a run strands: `owner.status` was never moved off `"running"`.

**Problem statement.** An L4 drain (and a separate no-outage 2026-08-22 reproduction: first fan-out failed fast, the driver retried, the turn ended about 90s in, the fan-out child was left with 0 bytes of output, and `owner.status` stayed `"running"`) ended its owned headless turn while the run was neither terminal nor held. Nothing refused the turn-end, so the process exited and the run never reached build, holdout, or an orderly close. This change adds a state-based Stop hook that refuses an owned headless turn-end when the run is still `owner.status: "running"` and nothing legitimately explains it, plus a disposition backstop that flags the same state after the container has died.

**Design principles.**

**State over enumeration.** The guard must key on run *state* (`owner.status`), not on enumerating dispatch types. FAFF-884's `inflightcheck` refuses turn-end only for dispatches explicitly bracketed by an `--open`/`--close` marker; a `child_process.spawn` fan-out (the spec-review path) is never bracketed, so on a retry a fan-out child can be alive at turn-end with zero open markers and `inflightHookDecision([])` permits the exit. Any design that enumerates dispatch shapes will miss the next unbracketed one. One state check catches the outage, the failed-fast retry, the backgrounded spawn, and the no-reason-at-all strand.

**A live owner is never trapped.** The guard binds the *owning* headless session ending its own turn. A foreign session (an interactive session, a parallel worktree) whose Stop hook observes another owner's live drain must never be hard-blocked; at most it warns. This is the FAFF-235 posture that `runcheck` already holds, reused verbatim, not re-derived.

**Fail toward the turn surviving, and fail closed on the unknown.** When in doubt about an owned run, block (keep the turn alive) rather than let it exit; a false block is a resumed turn, a false exit is a dead run. The detective half fails the same way: anything that looks like a non-terminal death reads as needs-attention, never clean.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/runcheck.js` | Node (CJS) | The Stop-hook sibling this new hook mirrors: `runcheckHookDecision(ledger, runDir, nowMs, env, opts)` (line 172), `runIsOwned` (99), `runIsHeld` (134), `auditLedger` (32), the `owned ? false : runIsHeld(...)` gate (185), block-payload-on-stdout + return-0 convention (247), `--recover` force-block (FAFF-235) |
| `plugin/skills/faff/bin/lib/inflightcheck.js` | Node (CJS) | The enumeration sibling this hook composes with: `inflightHookDecision(markers, ...)` (168), per-owner markers under `.faff/inflight/<scope>/<key>.json`, `resolveOwnerScope` |
| `plugin/skills/faff/bin/lib/prepcheck.js` | Node (CJS) | The nearest shape to copy for a marker/state Stop hook: pure audit + impure shell + `overlayHeartbeat` overlay before the decision |
| `plugin/skills/faff/bin/lib/hooks-ensure.js` | Node (CJS) | `FAFF_STOP_HOOKS` (line 26), pure `planStopHooks`, `probeServes`, and the two selftest fixture tables (`HOOKS_ENSURE_SELFTEST_CASES` line 359, the `idCases` at 461) the new member must thread through |
| `plugin/skills/faff/bin/lib/disposition.js` | Node (CJS) | `computeDisposition` (93), the `ownerAborted` clause (124-129) the new attention clause mirrors, the empty-run selftest (401) |
| `plugin/skills/faff/bin/lib/heartbeat.js` | Node (CJS) | `overlayHeartbeat` / `readHeartbeatFile`, reused verbatim so the pure decision stays filesystem-free |
| `plugin/skills/faff/bin/faff` | Node (CJS) | The `COMMANDS` dispatch map (line 118) a new `turncheck` subcommand registers into |
| `plugin/skills/faff/bin/lib/validate-adapters.js` | Node (CJS) | `ANCHOR_PHRASES` (line 66) and the presence lint (737-756) the new invariant prose is gated by |
| `plugin/skills/faff-beep-boop/SKILL.md` | Prose | Holds the "Turn-survival invariant" (line 537) and "Run-end synchronicity invariant" (365); the natural home for the new state-based prose |
| `plugin/skills/faff-prep/SKILL.md` | Prose | Line 124's in-flight-marker turn-survival clause on the `spec_review` dispatch, extended to name the state-based backstop |

**Scope.** This is the general run-survival guard on the L4 headless path. The graceful spec-review outage handler (in-turn retry, a first-class outage verdict member, a distinct hold label) sits on top of it as FAFF-900.

## 2. OUT OF SCOPE

- **Graceful spec-review outage handling**, in-turn retry / backoff, a first-class `unavailable` review-verdict member, a distinct resumable outage-hold label. Why excluded: this ticket is the general guard that stops the run from dying; the outage optimisation is a separate concern that builds on the guard. Extension point: **FAFF-900** (blocked by this ticket).
- **Dead-claim release**, the roughly six-minute headless-resume lockout after a hard kill. Why excluded: a sibling defect in the resume-claim lifecycle, complementary but independent of the turn-end guard. Extension point: **FAFF-896** (ADR 0063/0065 lineage).
- **A launcher-level resume loop** (`claude-box -r <id>` until the ledger closes, per FAFF-606). Why excluded: an infrastructure-level belt over the whole run; this ticket makes the single `-p` turn itself refuse to die, which is the smaller in-cage fix. Extension point: the reference cron/resume workflow under FAFF-606.
- **Heartbeat staleness threshold tuning**, changing `heartbeatStaleSecs` / `FAFF_RUN_HEARTBEAT_STALE_SECS` (default 900s). Why excluded: the guard reuses the existing threshold unchanged; retuning it is the FAFF-842 heartbeat-gate concern. Extension point: `heartbeatStaleSecs(env)` in `runcheck.js`.
- **Changing the owner-close write path**, where and when the orchestrator flips `owner.status` to `"done"`. Why excluded: the guard reads that state, it does not move the write; `applyTerminalOutcome` (run-ledger.js:74) and beep-boop's exit edit stay as they are. Extension point: `applyTerminalOutcome`.

## 3. WHAT: vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Terminal turn-end | A headless turn ending with the run resolved: the admitted queue clean, nothing bracketed in flight, and `owner.status` moved off `"running"` to a terminal value (`"done"`, etc.). The only legitimate way a headless owned turn may end. |
| Non-terminal turn-end | An owned headless turn ending while `owner.status` is still `"running"` with no terminal outcome recorded and nothing legitimately in flight. The defect this ticket guards against. |
| Held | `runIsHeld` is true: `owner.status === "running"` and the heartbeat is fresher than `heartbeatStaleSecs`. Means a *foreign* live owner is draining; the owning session forces held to false (it cannot be "held by a live owner" when it *is* the owner about to stop). |
| Clean queue | `auditLedger(ledger).clean` is true: no admitted issue lacks a terminal outcome and no outcome token is invalid. An empty run (no admitted issues) is clean. |

**The new Stop hook: `turncheck`.** A new sibling module `plugin/skills/faff/bin/lib/turncheck.js` with a pure decision function shaped exactly like `runcheckHookDecision`:

```
FUNCTION turncheckHookDecision(ledger, runDir, nowMs, env, opts):
  # signature byte-identical to runcheckHookDecision (the mirror mandate)
  # opts.recover         : boolean, the --recover human force (FAFF-235)
  # opts.hasOpenInflight : boolean, does THIS owner have any open inflight marker?
  #   gathered in the impure shell (like overlayHeartbeat's file read) and folded
  #   into opts, so the pure fn keeps the 5-arg shape and stays filesystem-free.
  RETURNS { block, warn, reason?, owned, held }
```

The `owned` / `held` derivation is copied from `runcheck` verbatim (`owned = runIsOwned(ledger, runDir, env)`; `held = owned ? false : runIsHeld(ledger, nowMs, env)`), so heartbeat handling, the FAFF-233 pid-not-consulted rule, and the FAFF-235 foreign posture are single-sourced, not re-implemented.

**Impure shell `cmdTurncheck`** mirrors `cmdRuncheck`: resolve the run dir; in `--hook` mode read the ledger (fail-closed on a malformed owned ledger, silent on a foreign/unprovable one, byte-parity with runcheck's FAFF-690 handling); `overlayHeartbeat(ledger, readHeartbeatFile(runDir))` before the decision; compute `hasOpenInflight` by reusing inflightcheck's marker reader scoped to this owner; emit `{ decision: "block", reason }` on stdout with return 0 when the decision blocks, a one-line stderr `[warn]` when it warns, nothing otherwise. Non-hook CLI mode prints a human summary and exits non-zero on block (parity with runcheck's exit 3), for operator use.

**Registration.** Append `"turncheck"` to `FAFF_STOP_HOOKS` in `hooks-ensure.js` (line 26) and add `"turncheck": cmdTurncheck` to the `COMMANDS` map in `bin/faff` (line 118, with the `require` near line 79). No change to `planStopHooks` / `probeServes`, they generalise over the list already.

**Disposition backstop: a new attention clause.** In `computeDisposition` (disposition.js:93), a new clause mirroring `ownerAborted` (lines 124-129):

```
RECORD attention-item (new kind):
  kind    : "owner-still-running"
  issue   : null
  outcome : null
  cause   : "running-not-closed"   # empty-admitted mid-prep death is the canonical trigger,
                                    # but the clause keys on owner.status only
```

It fires whenever `ledger.owner && ledger.owner.status === "running"`, independent of the other items, exactly as `ownerAborted` fires on `"aborted-resumable"`. It stays a pure, clock-free ledger read: `computeDisposition` is a post-mortem run-end verb (the container has already died), so `owner.status === "running"` is itself the death signal, and no heartbeat is consulted.

**Design decisions.**

- Two hooks, or one? A single hook cannot be both the enumeration check and the state check without becoming the enumerate-every-dispatch design this ticket rejects. **Chosen:** a separate state-based hook (`turncheck`) alongside `inflightcheck`, composing by disjoint preconditions (see HOW).
- Where the block condition draws its terminal signal. **Chosen:** the authoritative non-terminal signal is `owner.status === "running"`; the guard blocks only when the queue is *also* clean and no marker is open, so the residual it catches is precisely "everything looks done except the owner never closed".

## 4. HOW: behaviour

**Architecture.** Three Stop hooks now compose to close the headless turn-end loop, each owning a disjoint slice so no case double-blocks and no case falls through a gap:

| Hook | Reads | Blocks the owning session when |
|---|---|---|
| `runcheck` | ledger `admitted` vs `outcomes` | the queue is not clean (undispatched admitted issues or invalid outcome tokens) |
| `inflightcheck` | per-dispatch open markers | any inflight marker for this owner is open |
| `turncheck` (new) | `owner.status` + the other two signals | queue clean AND no open marker AND `owner.status === "running"` AND not-held |

The turn may end only when all three are satisfied: queue drained, no bracketed dispatch open, and `owner.status` moved off `"running"`. `turncheck` fires in exactly the residual the other two cannot see, the state the failure left behind.

**The turncheck decision.**

Plain-English summary: refuse an owned headless turn-end when the run looks finished but the owner never closed it, and there is no bracketed dispatch or undispatched queue to explain the still-running state. Defer to `runcheck` when the queue is dirty and to `inflightcheck` when a marker is open, so only one hook speaks per case. Never hard-block a foreign session.

```
PROCEDURE turncheckHookDecision(ledger, runDir, nowMs, env, opts):
  1. recover = opts.recover === true
  2. owned = runIsOwned(ledger, runDir, env)
     held  = owned ? false : runIsHeld(ledger, nowMs, env)
  3. IF held:                              # foreign live drain
        RETURN { block:false, warn:false, owned, held:true }
  4. IF ledger.owner?.status !== "running":  # terminal / done owner -> nothing to guard
        RETURN { block:false, warn:false, owned, held:false }
  5. IF NOT auditLedger(ledger).clean:       # dirty queue is runcheck's job, defer
        RETURN { block:false, warn:false, owned, held:false }
  6. IF opts.hasOpenInflight:                 # an open marker is inflightcheck's job, defer
        RETURN { block:false, warn:false, owned, held:false }
  7. # residual: owner.status running, queue clean, no open marker, not held
     IF owned OR recover:
        RETURN { block:true, warn:false, reason: turncheckReason(ledger), owned, held:false }
  8. RETURN { block:false, warn:true, reason: turncheckReason(ledger), owned, held:false }  # foreign not-held -> warn only
```

**Why the owning session ignores heartbeat freshness.** Step 2 forces `held = false` for the owner, copied from `runcheck.js:185`. At the moment the owning session ends its turn its heartbeat is naturally fresh (it was the thing beating it), so a `runIsHeld` check would always read "held" and the guard would never fire on the very failure it targets. The owner is not "held by a live owner"; it is the owner, about to stop. Heartbeat freshness only decides the foreign silent-vs-warn split (steps 3 and 8).

**Why step 5 defers on a dirty queue.** During a healthy drain there are always undispatched admitted issues, so `runcheck` already blocks those turn-ends; without step 5, `turncheck` would also block, double-speaking. Deferring keeps the two disjoint: `runcheck` owns "queue not drained", `turncheck` owns "queue drained but owner never closed". The canonical FAFF-854 failure (mid-prep death) has an empty `admitted` array, so `auditLedger(ledger).clean` is true and step 5 passes through to the block, which is correct: nothing was admitted, nothing is bracketed, yet the owner is still running.

**Why step 6 defers on an open marker.** A healthy in-flight dispatch is exactly what `inflightcheck` refuses; `turncheck` staying silent there prevents a double-block. The state `turncheck` fires on (running + clean + no marker) is the unbracketed-spawn gap `inflightcheck`'s enumeration structurally cannot see.

**The disposition clause.**

```
# in computeDisposition, mirroring the ownerAborted block (disposition.js:124-129)
ownerStillRunning = ledger.owner && ledger.owner.status === "running"
IF ownerStillRunning:
   items.push({ kind:"owner-still-running", issue:null, outcome:null, cause:"running-not-closed" })
```

Fires independently of `incomplete-ledger` and `aborted` (both can coexist with it, same as `aborted` coexists with `incomplete-ledger` today). It flips the report to needs-attention (exit 1), closing the blind spot the line-401 empty-run selftest currently codifies as green: `admitted:[]` + `owner.status:"running"` gives `audit.clean === true`, so before this clause the report is `clean` and disposition exits 0 on a run that died mid-prep.

**Edge cases and error handling.**

- **Malformed owned ledger** (`--hook` mode): fail closed, emit the block payload on stdout, return 0. Foreign/unprovable malformed ledger: silent. Byte-parity with runcheck's FAFF-690 handling (`ownedByEnvPointer`, `malformedOwnedReason`).
- **Legacy ledger with no `owner`**: `owner?.status !== "running"` is true at step 4 -> silent. Disposition: `ownerStillRunning` is false -> no false attention item.
- **`owner.status: "aborted-resumable"`**: step 4 -> silent (not `"running"`); the sentry/abort path owns it, and disposition's existing `ownerAborted` clause already flags it.
- **Run-dir resolution failure / no run** (`--hook`): return 0 silently, parity with runcheck's hook-mode churn tolerance.
- **Foreign session, owner running, stale heartbeat (not held)**: warn only, never block (step 8). A foreign session is never trapped.

**Failure modes.**

- **The failure:** the guard blocks a legitimately-finished run because the orchestrator ended its turn *before* running its owner-close step, so `owner.status` is still `"running"` although the work is genuinely done. **How you'd know:** the drain resumes after the block, runs the close, flips `owner.status`, and the next turn-end passes silently. **What it means:** proceed. This is the intended nudge, not a defect: a headless run that reached "done work" but skipped the close is exactly a non-terminal turn-end, and resuming to run the close is the correct outcome. It converges in one extra turn.
- **The failure:** `hasOpenInflight` is computed against the wrong owner scope, so `turncheck` double-blocks with `inflightcheck` (both fire on a real open marker). **How you'd know:** a turn-end with an open marker emits two block reasons instead of one. **What it means:** narrow, reuse inflightcheck's own `resolveOwnerScope` and marker reader rather than re-deriving scope, and cover the "open marker -> turncheck silent, inflightcheck blocks" composition in a selftest.
- **The failure:** the disposition clause fires on a genuinely-live run when an operator invokes `faff disposition` mid-drain, reporting needs-attention on a healthy run. **How you'd know:** exit 1 with an `owner-still-running` item on a run whose heartbeat is fresh. **What it means:** proceed (accepted). `faff disposition` is contractually a post-mortem run-end verb; reporting a still-running owner mid-drain is consistent with how it already reports any not-yet-terminal state, and the clock-free mirror of `ownerAborted` is worth the simplicity.

**Anti-pattern:** enumerating the spec-review fan-out (or any new dispatch shape) by adding an `inflightcheck --open`/`--close` bracket around it as the *primary* fix. Why: that repeats FAFF-884's enumeration approach and misses the next unbracketed spawn; the state check is the general guard. (Bracketing individual dispatches remains fine as a complementary belt, but it is not what closes FAFF-854.)

**Anti-pattern:** consulting the recorded `owner.pid` (a `kill -0` liveness probe) in `turncheck`. Why: FAFF-233 removed pid consultation because the worker pid rolls between issues; liveness is heartbeat-only, and for the owning session heartbeat is not even consulted.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The guard's main objective is born-verifiable as the pure-decision selftest table; the disposition clause as its own mirror cases.

```
Given a run this session owns, owner.status "running", the admitted queue clean, no open inflight marker, and the owner's own turn ending
When turncheckHookDecision runs
Then it returns block=true with a non-terminal-turn-end reason
```

```
Given a run this session owns, owner.status "running", but admitted issues without a terminal outcome (dirty queue)
When turncheckHookDecision runs
Then it returns block=false (runcheck owns the dirty-queue case; no double-block)
```

```
Given a run this session owns, owner.status "running", queue clean, but an open inflight marker for this owner
When turncheckHookDecision runs
Then it returns block=false (inflightcheck owns the open-marker case; no double-block)
```

```
Given a run this session owns whose owner.status has been flipped to "done"
When turncheckHookDecision runs
Then it returns block=false (terminal owner -> nothing to guard)
```

```
Given a FOREIGN run whose owner is running with a fresh heartbeat (held)
When turncheckHookDecision runs
Then it returns block=false, warn=false (a live foreign drain is silent)
```

```
Given a FOREIGN run, owner running, stale heartbeat (not held), queue clean, no open marker
When turncheckHookDecision runs
Then it returns block=false, warn=true (foreign not-held -> warn, never a hard block)
```

```
Given a FOREIGN not-held run in the block-eligible residual and opts.recover true
When turncheckHookDecision runs
Then it returns block=true (the deliberate human --recover force, FAFF-235)
```

Disposition mirror scenarios:

```
Given a run-ledger with owner.status "running" and admitted:[] (empty, mid-prep death)
When computeDisposition runs
Then the report is needs-attention with an owner-still-running item (the line-401 blind spot is closed)
```

```
Given a run-ledger with owner.status "done" and a clean queue
When computeDisposition runs
Then no owner-still-running item is raised (a properly-closed run stays clean)
```

- The `turncheck` block payload MUST be `{ decision: "block", reason }` on stdout with process return 0 (the Stop-hook block mechanism), never a non-zero exit code in hook mode.
- `turncheckHookDecision` MUST be a pure function of its arguments only: no tracker call, no network, no filesystem read (the heartbeat overlay and the open-marker boolean are gathered in the impure shell and passed in).

## 6. Design decision rationale

**Should the guard be a new per-dispatch marker or a state check?**
- Per-dispatch marker (extend inflightcheck's enumeration to the fan-out): pro: reuses existing machinery; con: misses every dispatch shape not yet bracketed, which is how FAFF-854 slipped past FAFF-884 in the first place.
- State check on `owner.status`: pro: trigger-agnostic, catches outage / failed-fast retry / backgrounded spawn / no-reason strand with one predicate; con: needs care to compose with the two existing hooks without double-blocking.
- **Chosen:** the state check, as a new `turncheck` Stop hook. The composition cost is paid once, in the disjoint-precondition design; the enumeration gap would recur on every new dispatch shape.

**How do turncheck and inflightcheck compose without double-blocking or a gap?**
- Both block independently (belt and braces): pro: no coupling; con: a real open marker double-speaks two block reasons, the noise the brief rules out.
- turncheck defers when a marker is open (reads open-marker presence, gathered in the shell): pro: cleanly disjoint, one hook speaks per case; con: turncheck must reuse inflightcheck's marker reader/scope.
- **Chosen:** turncheck defers (step 6). inflightcheck owns the open-marker case; turncheck owns the running + clean + no-marker residual its enumeration cannot see; runcheck owns the dirty queue (step 5). The three preconditions partition every owned turn-end, so no case double-blocks and none falls through.

**Does the owning session consult its heartbeat?**
- Consult `runIsHeld` for the owner too: con: the owner's heartbeat is always fresh at its own turn-end, so the guard would never fire on the target failure.
- **Chosen:** copy runcheck's `owned ? false : runIsHeld(...)` gate verbatim. The owner forces held to false; heartbeat freshness only decides the foreign silent-vs-warn split. At the time of writing this matches runcheck's established FAFF-205 / FAFF-233 posture exactly.

**What triggers the disposition attention clause?**
- Key on the empty-admitted signal specifically: con: misses a clean-but-unclosed run (admitted with outcomes, owner still running).
- Key on `owner.status === "running"` broadly, mirroring `ownerAborted`: pro: catches both the empty-admitted mid-prep death and the clean-but-unclosed close; pure and clock-free.
- **Chosen:** key on `owner.status === "running"`, an independent item mirroring the `aborted-resumable` clause. The empty-admitted death is the canonical trigger but not the only one worth surfacing.

**Which SKILL.md gains the anchor prose, and does ANCHOR_PHRASES change?**
- **Chosen:** the state-based turn-survival prose lands in `faff-beep-boop/SKILL.md`'s Turn-survival invariant subsection (line 537 area), with a one-line cross-reference from `faff-prep/SKILL.md`'s line-124 spec-review clause naming `turncheck` as the state-based backstop the unbracketed fan-out relies on. Add one new phrase to the `faff-beep-boop` entry of `ANCHOR_PHRASES` (validate-adapters.js:66) so the presence lint (737-756) gates the new prose. Proposed phrase: `"non-terminal turn-end"` (distinctive, load-bearing, and genuinely carried by the new wording). The existing `"never end a turn"` / `"in-flight marker"` phrases stay.

## 7. Open questions and assumptions

**Open questions.**

**Punt:** The precondition boundary between "nothing is legitimately in flight" and "genuinely stalled" for the *foreign* not-held case with a *just-stale* heartbeat (a drain legitimately quiet between units whose heartbeat has only just crossed `heartbeatStaleSecs`). The safe default is settled and rendered as Chosen below (a fresh heartbeat always means never block, and the owner is never heartbeat-gated); the residual is only whether the 900s staleness threshold wants tuning so a quiet-but-alive foreign drain is never even *warned* about spuriously. This is threshold tuning, not a guard-logic change, and it overlaps the FAFF-842 heartbeat-gate concern. (decides: architecture)

**Assumptions.**

**Assumes:** the orchestrator's proper exit path already flips `owner.status` off `"running"` to a terminal value (via `applyTerminalOutcome`, run-ledger.js:74, or beep-boop's exit edit). Validation: confirm at least one exit path in `run-ledger.js` / `lights-out.js` writes `owner.status: "done"` before the process ends; if some terminal path does not, `turncheck` would block it and the build must extend that path to close the owner, not weaken the guard.

**Assumes:** `inflightcheck` exposes (or can cheaply expose) a reusable reader that lists open markers for a given owner scope. Validation: check `inflightcheck.js` for `resolveOwnerScope` plus the marker-listing used by `cmdInflightcheck --hook`; if no reusable export exists, extract one rather than re-globbing `.faff/inflight/<scope>/` in `turncheck`.

## 8. DONE: definition of done

### From WHY
- [ ] An owned headless turn-end with `owner.status: "running"`, a clean queue, and no open marker is refused (block), so the FAFF-854 mid-prep death cannot exit the cage.
- [ ] A foreign session is never hard-blocked by the new hook (warn at most).

### From WHAT (types and interfaces)
- [ ] `plugin/skills/faff/bin/lib/turncheck.js` exists, exporting `turncheckHookDecision`, `cmdTurncheck`, `turncheckSelftest`, and the selftest case table.
- [ ] `turncheckHookDecision(ledger, runDir, nowMs, env, opts)` returns `{ block, warn, reason?, owned, held }` (signature identical to `runcheckHookDecision`; `opts.recover` and `opts.hasOpenInflight` carry the two extra inputs), deriving `owned`/`held` via `runIsOwned` and the `owned ? false : runIsHeld(...)` gate reused from runcheck.
- [ ] `"turncheck"` is appended to `FAFF_STOP_HOOKS` (hooks-ensure.js:26) and `"turncheck": cmdTurncheck` is added to the `COMMANDS` map (bin/faff:118).
- [ ] `computeDisposition` pushes an `owner-still-running` attention item when `ledger.owner.status === "running"`, independent of other items.

### From HOW (behaviour)
- [ ] turncheck blocks only in the residual: owned + `owner.status "running"` + `auditLedger(ledger).clean` + no open marker + not-held.
- [ ] turncheck returns silent when the queue is dirty (defers to runcheck) and when an open marker exists for this owner (defers to inflightcheck), no double-block in either case.
- [ ] turncheck returns silent when `owner.status !== "running"` (terminal / done / aborted-resumable / legacy no-owner).
- [ ] The `--hook` block emits `{ decision: "block", reason }` on stdout with return 0; a foreign not-held residual emits a one-line stderr warn; `--recover` forces the block on a foreign not-held residual.
- [ ] A malformed owned ledger fails closed (block); a foreign/unprovable malformed ledger stays silent (byte-parity with runcheck's FAFF-690 path).
- [ ] `faff disposition` exits 1 (needs-attention) on a run left `owner.status: "running"` with `admitted:[]`, and exits 0 on the same run once `owner.status` is `"done"`.

### From HOW (Stop-hook selftests, the pure decision)
- [ ] `turncheck --selftest` covers, at least: owned+running+clean+no-marker+not-held -> block; owned+running+dirty-queue -> silent; owned+running+clean+open-marker -> silent; owned+done -> silent; foreign+held -> silent; foreign+not-held+residual -> warn; foreign+not-held+`--recover` -> block; owned+running+`admitted:[]` -> block.
- [ ] `hooks-ensure --selftest` passes with `turncheck` threaded through every `HOOKS_ENSURE_SELFTEST_CASES` fixture and the `idCases` identity table (the new five-member `FAFF_STOP_HOOKS`).
- [ ] `disposition --selftest` gains mirror cases: empty-admitted + running -> needs-attention with `owner-still-running`; done + clean -> clean (no false fire); legacy no-owner -> no false fire.

### From HOW (anchor lint)
- [ ] The state-based turn-survival prose is added to `faff-beep-boop/SKILL.md` (and cross-referenced from `faff-prep/SKILL.md`), the new phrase is added to `ANCHOR_PHRASES["faff-beep-boop"]`, and `faff validate-adapters` passes.

**Integration smoke test.**

```
PROCEDURE smoke:
  1. Build a run-ledger with owner.status "running", admitted:[], outcomes:{}, in a temp run dir; set FAFF_RUN_DIR to it.
  2. Run: faff turncheck --hook
     EXPECT stdout carries { "decision": "block", ... }, process exit 0.
  3. Flip owner.status to "done" in the ledger; run: faff turncheck --hook
     EXPECT no stdout block payload, process exit 0.
  4. Run: faff disposition --run-dir <dir>   (owner.status back to "running")
     EXPECT exit 1 and an owner-still-running attention line.
  5. Run: faff hooks-ensure --dry-run --json
     EXPECT turncheck present in the planned/served Stop set.
```

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "chosen" },
    { "marker": "punt" },
    { "marker": "assumes" },
    { "marker": "assumes" }
  ] }
```
