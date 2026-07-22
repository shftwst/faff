# FAFF-575 — Run-ledger writes: one lock, unique tmp names, fence closed under the lock

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-575.

This spec addresses FAFF-575 (three related races on the `run-ledger.json` write path) for the build agent implementing it and human reviewers. It covers the CLI's ledger write primitives in `plugin/skills/faff/bin/lib/heartbeat.js` and every production caller that read-merge-writes the ledger.

## 1. WHY — Problem and Principles

**The load-bearing model:** `run-ledger.json` is a single JSON snapshot mutated by read-merge-write from four genuinely concurrent actors — the orchestrator session, the detached sentry poller (abort marks), any `faff events append --tokens` caller (checkpoint advance), and a fresh-session `lights-out --resume` (takeover). A read-merge-write is only safe when the read it derives from and the write it lands cannot interleave with another writer's — so every ledger mutation moves inside one advisory-lock-guarded critical section (the same lock idiom FAFF-574 establishes for events.jsonl), every write lands via a rename of a per-call-unique tmp file, and the existing owner-epoch fence keeps guarding the orthogonal takeover axis — now checked inside the lock, which closes its check-then-write gap.

**Problem statement.** The ledger write path was built under a single-active-writer assumption that the shipped N-writer reality (detached poller, fleet members, resume-from-a-fresh-session) has decayed. Three live exposures: `atomicWriteLedgerFenced` re-reads the owner block then writes with no serialisation, so two writers can both pass the fence and the last one silently wins (heartbeat.js:174–215); `atomicWriteLedger` uses the fixed tmp path `target + ".tmp"` (heartbeat.js:165) — the exact two-concurrent-writers ENOENT crash the same file documents at lines 117–125 and already fixes for heartbeat files with pid+random tmp names; and `events append --tokens` does an unfenced whole-object read-merge-write (events.js:249–265) on a comment claiming "the orchestrator is the single writer of the budget block", so a sentry abort mark or any concurrent ledger write landing in its read-to-write window is clobbered.

**Design principles:**

- **One serialisation idiom per run dir.** FAFF-574 settles advisory lock files as how run-dir state files serialise concurrent writers. This change reuses that decision — same acquisition mechanics, same tuning constants, one shared helper — never a second idiom or a constants copy. An implementation that hand-rolls a separate lock loop for the ledger is wrong.
- **A mutation derives only from a read taken inside the critical section.** Lock, then read, then transform, then write, then release. A write derived from any earlier read — however recent — is the bug this ticket exists to remove.
- **The lock and the fence guard different failures; keep both.** The lock serialises concurrent writers; the fence makes a superseded owner (an older epoch after a resume takeover) yield even when it is the only writer running. Neither subsumes the other.
- **Loud failure over silent fallback.** A writer that cannot acquire the lock within budget fails per its own documented loudness contract — never falls through to an unlocked write, which reintroduces the exact race under the contention that makes it fire.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/heartbeat.js` | `atomicWriteLedger` (163–168, the fixed-tmp primitive), `atomicWriteLedgerFenced` (203–215, the CAS-less fence), `ownerEpochFenceStale` (186–195, pure — unchanged), `atomicWriteSingleValueFile` (137–146, the unique-tmp idiom to reuse), the lines 113–125 comment documenting why fixed tmp names crash |
| `plugin/skills/faff/bin/lib/events.js` | `events append --tokens` ledger read-merge-write (223–279) and the single-writer comment at 246–248 — the unfenced whole-object writer |
| `plugin/skills/faff/bin/lib/budget.js` | `budget baseline` fenced read-merge-write (~945–951) — fence anchored on its own fresh read |
| `plugin/skills/faff/bin/lib/sentry.js` | `sentry abort` mark (~838–839) — unfenced write from the detached poller process, the genuinely concurrent writer |
| `plugin/skills/faff/bin/lib/lights-out.js` | ledger mint (917) and `--resume` takeover write (1018) — the epoch-fence anchor site |
| FAFF-574's spec (on that issue) | The events.jsonl lock idiom this change shares: `wx` exclusive create, stale takeover, `Atomics.wait` sleep, budgeted retry, `{pid, ts}` forensic content |
| `plugin/skills/faff/bin/lib/shared-infra.js` | `readLedger` (155) — the read the critical section wraps |
| ADR-0077 (FAFF-519) | Write-authority classes for run artifacts — the governance frame; the orchestrator's own session-edit ledger writes sit outside this change (see OUT OF SCOPE) |

**Scope statement.** This is the run-ledger half of retiring the run-dir single-writer assumption; FAFF-574 (same run) is the events.jsonl half, and the two share one locking decision.

## 2. OUT OF SCOPE

- **events.jsonl append serialisation** — FAFF-574's territory (peer ticket, same run). Extension point: this change consumes the same shared lock helper; the two tickets touch the same lock mechanics deliberately (see the sequencing assumption in section 7).
- **The orchestrator's own session-lane ledger edits** (`admitted` appends, outcome writes, the run mint beep-boop performs per its SKILL.md) — file edits made by the driving session, not CLI subprocess calls, so a CLI lock helper cannot serialise them. ADR-0077 owns that write-authority seam. Excluded to keep this a CLI-side fix; the sweep documents the residual where it names the writer inventory. Tracker note for a human (faff never auto-files follow-ups from prep): a follow-up ticket routing the orchestrator's ledger mutations through a locked `faff` op (e.g. `faff ledger merge-outcome`) would close this residual; today it is un-ticketed.
- **fsync durability** — rename-only durability is retained unchanged. The ledger is a re-derivable bookkeeping snapshot; a power-loss losing the latest rename degrades to a slightly stale ledger the next read seam tolerates. The change *documents* this posture (it is currently unstated) — see DONE — but adds no fsync.
- **Heartbeat file writes** (run-level + member files) — already N-writer safe with unique tmp names (FAFF-355/FAFF-327); untouched.
- **`faff heartbeat --run` argument handling** (FAFF-553, related ticket) — a different surface (flag parsing), no overlap with the write path.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| critical section | The lock-held span: fresh read → fence check → transform → atomic write |
| ledger mutation | Any production write of `run-ledger.json` derived from its current contents |
| epoch fence | The FAFF-527 owner-block comparison (`ownerEpochFenceStale`) that makes a superseded owner yield |
| stale lock | A lock file older than the staleness bound — evidence its holder died mid-section |

**The lock.** `<runDir>/run-ledger.json.lock` — mechanics identical to FAFF-574's events lock: taken by atomic exclusive create (`fs.openSync(path, "wx")`; the file's existence is the lock), content `{pid, ts}` forensic only, released by `unlink` in a `finally`, stale takeover past `STALE_LOCK_MS`, `Atomics.wait` retry sleep, budgeted acquisition. Same tuning constants (`RETRY_INTERVAL_MS = 15`, `ACQUIRE_BUDGET_MS = 2000`, `STALE_LOCK_MS = 5000`) — module-level, not config keys.

**The shared helper (one home for the idiom).** Lock acquisition/release lives in **one** shared module (a new `plugin/skills/faff/bin/lib/fs-lock.js`, exporting `withFileLock(lockPath, fn)` plus the constants). Both FAFF-574's events-append core and this change's ledger core consume it. If FAFF-574's build lands its lock mechanics inside events.js first, this build lifts them into the shared module and reroutes events.js — either build order converges on the same end state.

**The ledger core.** One new function in heartbeat.js owns the critical section; every production ledger mutation routes through it:

```
PROCEDURE mutateLedgerUnderLock(runDir, mutate, expectedOwner?):
  # mutate(freshLedger) -> ledger-to-write, or null to abort without writing
  1. withFileLock(<runDir>/run-ledger.json.lock):     # budget exhaustion THROWS error tagged "LEDGER_LOCKED"
     a. fresh = readLedger(runDir)                    # the ONLY read a mutation may derive from
     b. IF expectedOwner AND ownerEpochFenceStale(fresh.owner, expectedOwner):
          -> log the yield to stderr, return { written: false, yielded: true }   # fence closed: checked inside the lock
     c. next = mutate(fresh); IF null -> return { written: false, yielded: false }
     d. atomicWriteLedger(runDir, next)               # unique-tmp rename, below
     e. return { written: true, yielded: false }
  2. lock released in finally (also on throw)
```

`atomicWriteLedgerFenced(runDir, ledger, expected)` is superseded by this core: its callers hand a `mutate` transform instead of a pre-built ledger object, so the object they write is always derived from the under-lock read. `atomicWriteLedger` remains the write primitive but switches to a per-call-unique tmp name — reusing `atomicWriteSingleValueFile`'s exact idiom (pid + random suffix, best-effort tmp unlink on fault, rethrow).

**Caller conversion + error surface** (every production mutation site, and what each does on `LEDGER_LOCKED`):

| Caller | Mutation (inside `mutate`) | On `LEDGER_LOCKED` |
|---|---|---|
| `sentry abort` (sentry.js) | Re-apply `applySentryAbort` to the fresh ledger (the WIP-commit work stays outside the lock; only the mark moves inside) | stderr naming the lock + exit 1 — the abort mark is the abort; a silent skip would leave a killed run looking alive |
| `events append --tokens` (events.js) | Checkpoint read + delta + `tokens_at_last_event` advance, all against the fresh under-lock ledger | Existing catch absorbs it → honest `tokens_source: "estimate"` degrade, checkpoint not advanced (the designed persist-then-emit fallback, unchanged) |
| `budget baseline` (budget.js) | Write-once check (`baselineAlreadyWritten`) + baseline merge against the fresh ledger | `{"baseline_written": false, "reason": "ledger-locked"}` on stdout + stderr note, exit 0 — metering must never crash a run; the next `budget check` reads the un-baselined state per FAFF-552's degrade rules |
| `lights-out` mint (lights-out.js) | Initial ledger creation routes through the same core with a trivial `mutate` (uniformity — a just-minted run dir cannot contend, and no special-case reasoning survives) | Impossible in practice; the thrown error surfaces as the mint failure it is |
| `lights-out --resume` (lights-out.js) | Re-read + `applyResumeToLedger` derived from the fresh under-lock ledger; `expectedOwner = {epoch: priorEpoch, session_id}` | The existing refuse path (`emitRefuse`, exit 1) — a resume is retryable by construction |

**Fence semantics unchanged.** `ownerEpochFenceStale` stays byte-identical (pure, opt-in, absent-`expected` never trips, default-0 epoch convention). What changes is *where* the check runs: inside the lock, immediately before the write, against the same fresh read the mutation derives from — so the fence's permitted overlap (two writers both passing, then both writing) is structurally gone.

**Comment/prose corrections (the sweep's visible output).** The single-writer claims this change falsifies are updated in place: the events.js 246–248 "orchestrator is the single writer of the budget block" comment (now: lock-serialised multi-writer), the heartbeat.js 158–162 `atomicWriteLedger` callers note ("single-active-writer callers" — now enumerates the locked writer set), and a new short durability note on the write primitive stating rename-only (no fsync) is the accepted posture. The writer inventory (every site in the caller table above, plus the out-of-scope orchestrator session-lane residual) is recorded in the heartbeat.js region comment so the next writer added has one place to find the rules.

## 4. HOW — Behaviour

**Acquisition, takeover, release.** Exactly FAFF-574's mechanics via the shared helper: loop until `ACQUIRE_BUDGET_MS` is spent — `openSync(lock, "wx")`; on `EEXIST` stat the lock, unlink-and-retry if older than `STALE_LOCK_MS` (ignore a racing unlink's ENOENT), else sleep `RETRY_INTERVAL_MS` via `Atomics.wait` and retry; on budget exhaustion throw the tagged error. Never fall through to an unlocked write.

**Critical-section hygiene.** The lock-held span contains only: one `readLedger`, the fence comparison, the pure `mutate` transform, one serialise + write + rename. No subprocess, no git call, no tracker call, no token measurement inside the lock — `events --tokens` measures tokens *before* acquiring (the measurement is lock-free; only the checkpoint math against the fresh ledger moves inside), and `sentry abort` commits WIP *before* acquiring. This keeps the held span sub-millisecond, which is what makes the 5000ms staleness bound three orders of magnitude safe.

**Anti-pattern:** deriving a ledger write from a read taken outside the lock — including "the ledger I read two lines ago". Why: that read can predate a concurrent writer's landed mutation; writing an object derived from it silently un-writes theirs. The `mutate`-callback shape exists precisely so callers cannot hand the core a stale pre-built object.

**Anti-pattern:** catching `LEDGER_LOCKED` and retrying with a direct `atomicWriteLedger` call as a fallback. Why: the fallback reintroduces the race exactly under the contention that made the lock time out.

**Anti-pattern:** a second copy of the lock constants or acquisition loop (in events.js, budget.js, or a future module). Why: three hand-rolled seq-mint copies are how the events-side single-writer assumption rotted invisibly; the shared helper is the structural fix.

**Failure modes:**

- **Contention exhaustion under real load.** The failure: `ACQUIRE_BUDGET_MS` proves too small once fleet members multiply. How you'd know: `LEDGER_LOCKED` errors in run logs / poller stderr. What it means: raise the budget constant — the design is right, the constant is conservative.
- **Stale takeover fires on a live-but-stopped holder.** The failure: a holder is signal-stopped mid-section past `STALE_LOCK_MS`; a peer takes the lock over; both write. How you'd know: a fence yield logged by the slower writer (if epochs diverged), or a ledger field regression a read seam notices (e.g. a checkpoint moving backwards). What it means: acceptable residual — the bound is ~1000× the section length, matching FAFF-574's accepted residual for the same mechanism.
- **The run dir lives on a filesystem without atomic exclusive-create.** How you'd know: lost mutations despite the lock. What it means: outside the supported envelope — see Assumptions (shared with FAFF-574).

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Concurrent mutation preservation (the headline objective):

```
Given a run dir with a valid running-owner ledger
When 8 concurrent processes each perform locked ledger mutations (a mix of sentry abort marks, --tokens checkpoint advances, and budget-baseline attempts)
Then every process exits without an uncaught rename error, the final run-ledger.json parses, exactly one baseline was written, and the abort mark plus the last checkpoint advance are both present
```

Fence yields under takeover, even serialised:

Fixed-tmp crash retired:

```
Given two processes writing the ledger at the same moment through the new primitive
When both tmp+rename sequences overlap
Then neither process throws ENOENT and the surviving file is one writer's complete, parseable output
```

Non-functional assertions:

- The lock-held span performs no subprocess, network, tracker, or token-measurement work (unit-assertable on the core's structure and the converted call sites).
- `ownerEpochFenceStale`'s existing selftest table passes byte-identically — the pure fence is untouched.

## 6. DESIGN DECISION RATIONALE

**How should concurrent ledger writers be serialised?** Options: (a) advisory lock file around the read-merge-write, sharing FAFF-574's idiom; (b) a ledger `version` field with compare-and-retry; (c) per-writer journal files merged on read. Version-and-retry adds a schema field every reader must tolerate, plus an unbounded retry loop at every writer, and still needs the unique-tmp fix — with no benefit over a lock for a sub-millisecond section. Per-writer journals destroy the single-snapshot contract every reader (`readLedger`, runcheck, sentry, governance-check) already consumes. The lock file is dependency-free, already the settled run-dir idiom (FAFF-574's recorded decision), and closes both the fence TOCTOU and the lost-update window in one stroke.
**Chosen:** an advisory lock file (`run-ledger.json.lock`) serialising every production ledger mutation, sharing FAFF-574's mechanics and constants via one helper.

**One lock per file, or one per run dir?** A single run-dir lock would serialise events.jsonl appends against ledger mutations — unrelated files with different hold profiles, coupling the event-append hot path to ledger contention for no correctness gain.
**Chosen:** per-file locks (`events.jsonl.lock`, `run-ledger.json.lock`) with shared mechanics.

**Where do the lock mechanics live?** Options: copy the loop into heartbeat.js; a shared module both files consume. A copy is the exact drift vector the events-side seq-mint copies demonstrated.
**Chosen:** one shared helper module (`fs-lock.js`) exporting `withFileLock` + the constants; events.js (FAFF-574) and heartbeat.js both consume it, whichever build lands first doing the extraction.

**Does the epoch fence survive, or does the lock replace it?** The fence guards ownership across resumes — a superseded writer must yield even when no concurrent write is in flight; the lock guards interleaving. Replacing the fence with the lock would let a stale pre-takeover driver overwrite a resumed run's ledger the moment it happened to hold the lock alone.
**Chosen:** keep both — the fence check moves inside the critical section (which is what closes its check-then-write gap), `ownerEpochFenceStale` itself unchanged.

**Does the mint path take the lock?** Mint writes into a just-created run dir, so contention is impossible in practice — but exempting it preserves a second, unlocked write path and the special-case reasoning that decays.
**Chosen:** uniform — mint routes through the same locked core; the cost is one uncontended lock cycle per run.

**Add fsync, or document rename-only durability?** The ticket notes durability is rename-only and unstated. The ledger is bookkeeping the read seams re-derive or tolerate staleness on; per-write fsync taxes every mutation for a crash window that loses at most the latest rename.
**Chosen:** keep rename-only durability and state it in the write primitive's comment — a documented posture, not an accident.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** `.faff/runs/<run-id>` lives on a local filesystem where `openSync(…, "wx")` exclusive-create is atomic. Validation: same assumption FAFF-574's spec records for the sibling lock; the run dir is created under the repo root and nothing in faff configures it onto a network mount.
- **Assumes:** FAFF-574's events.jsonl lock change is in the same run's build queue (it is, as of this prep). Validation: the build agent checks whether the shared helper already exists on main or in the queue's landed branches — if FAFF-574 landed first, lift its mechanics into `fs-lock.js` and reroute; if this ticket builds first, create `fs-lock.js` and FAFF-574's build consumes it. Conflict analysis serialises the two (both touch events.js and the lock mechanics) — an in-queue ordering, not an external blocker.

## 8. DONE — Definition of Done

### From WHY (the three exposures closed)
- [ ] `atomicWriteLedger` uses a per-call-unique tmp name (pid + random, `atomicWriteSingleValueFile`'s idiom); no production ledger write uses a fixed `.tmp` sibling path.
- [ ] Every production ledger mutation (sentry abort, `events --tokens`, `budget baseline`, lights-out mint + resume) routes through the locked core; grep shows no production `atomicWriteLedger`/`atomicWriteLedgerFenced` call outside it.
- [ ] The fence check runs inside the critical section; `ownerEpochFenceStale` is byte-identical and its selftest rows still pass.

### From WHAT (interfaces)
- [ ] `withFileLock(lockPath, fn)` + the three constants live in one shared module consumed by both the ledger core and the events-append core (whichever of FAFF-574/FAFF-575 lands second completes the extraction); no second copy of the acquisition loop or constants exists.
- [ ] Lock file is `<runDir>/run-ledger.json.lock`, `wx`-created, `{pid, ts}` content, unlinked in `finally`, stale-takeover past the bound.
- [ ] On acquisition budget exhaustion each caller behaves per its table row: sentry abort exits 1 naming the lock; `events --tokens` degrades to `tokens_source: "estimate"` without advancing the checkpoint; `budget baseline` prints `baseline_written: false, reason: "ledger-locked"` and exits 0; resume refuses retryably.
- [ ] The events.js "single writer of the budget block" comment, the heartbeat.js `atomicWriteLedger` callers note, and the durability posture are updated per the sweep; the writer inventory (including the out-of-scope orchestrator session-lane residual) is recorded in the heartbeat.js region comment.

### From HOW (behaviour and edge cases)
- [ ] New integration test: 8 concurrent processes mixing abort marks, `--tokens` appends, and baseline attempts → no uncaught error, parseable final ledger, exactly one baseline, abort mark present.
- [ ] Unit test: two overlapping writes through the new primitive → no ENOENT, complete surviving file.
- [ ] Unit test: fenced mutation with a superseded epoch through the locked core → yields, writes nothing.
- [ ] Unit test: stale lock (mtime past the bound) is taken over; a fresh lock is waited on; budget exhaustion throws the tagged error (shared-helper tests — deduplicate against FAFF-574's if they landed first).
- [ ] Critical-section hygiene: the converted `sentry abort` and `events --tokens` paths perform WIP-commit / token measurement before acquiring the lock (assertable by code structure / a targeted unit test on call ordering).

### Integration smoke test
```
initialise a run dir with a running-owner ledger; in parallel run `faff events append --tokens` (valid payload) and `faff sentry abort`;
then run-ledger.json parses, carries the abort mark AND either an advanced checkpoint or an honest estimate-degrade, and no .tmp orphan remains
```

No LLM-judgement seam is introduced or changed — no eval-coverage item.

## Already shipped against this surface

Related Done work — context, none of it supersedes this premise (all three exposures are verifiably live in the working tree today):

- FAFF-527 — introduced the owner-epoch fence (`atomicWriteLedgerFenced`) this change hardens; it deliberately shipped as a local compare with no serialisation, which is the check-then-write gap being closed.
- FAFF-355 — moved heartbeat ticks off the ledger onto a dedicated unique-tmp single-value file; the remaining ledger writers are what this change serialises.
- FAFF-408 — added the `events append --tokens` checkpoint read-merge-write, the third exposure's site.
- FAFF-82 — the tracker-seam monotonicity rules; the local-compare-no-CAS precedent the fence followed.
- FAFF-519 / ADR-0077 — write-authority classes for run artifacts; the orchestrator session-lane residual this spec scopes out is that decision's territory.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. One cohesive 1–2 day unit: one shared lock helper, one locked ledger core, five call-site conversions, a comment sweep, and the tests. Splitting the helper into its own ticket would create an always-ships-together sibling straddling FAFF-574 and this change; keeping it inside whichever of the two builds second is correct.
- **Workstream fit? (principles 1 + 5)** — No issues. The run-ledger half of retiring the run-dir single-writer assumption; cohesive with FAFF-574 (the events.jsonl half) inside the governance-substrate hardening stream.
- **Deps surfaced? (principle 6)** — Finding: FAFF-575 carries no tracker link to FAFF-574 (its only relation is FAFF-553), yet the two share the lock idiom, the shared-helper extraction, and touch the same files — an ordering the queue's conflict analysis handles this run but future tooling cannot see. Recommended action: a human adds a **FAFF-574 related-to FAFF-575** link (either build order converges on the same end state, so a hard blocker edge would overstate it — faff does not auto-write relation links from a prep run).
- **Risk profile? (principle 7)** — No issues. No novel integration or external dependency; the lock idiom is standard-library only and already settled by the sibling spec. No de-risking spike warranted.

confidence: high
spec-review: approve
