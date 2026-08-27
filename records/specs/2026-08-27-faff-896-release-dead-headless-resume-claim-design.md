# FAFF-896 — Release a dead headless-resume claim on the same turn it dies

> Spec: faffter-dark-nlspec · 2026-08-27 · autonomous · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-896.
> build-tier: complex

> **Revised 2026-08-27** (autonomous re-prep, run-20260827-065909-beepboop-list): (a) FAFF-889 is now **Done** (PR #743) — it wired `machine_id` onto the build-**claim** record (`claim.json`) via `thisMachineId()` (FAFF-891), but **deliberately kept the run-owner record clean** (machine_id is a claim sibling, not on `owner`; `bundle.js` buildClaimStore selftest). So `thisMachineId()` is now **live and proven**, not dead code — the capability-#2 extension point is concretely reachable (bake `machine_id` onto the owner record), but capability #2 stays **out of scope** for this slice; it does not become load-bearing. (b) Folded the 2026-08-22 fresh-recurrence evidence as a hardened annotation (the read-side backstop is the arm that covers the hard-kill case). Core design (capability #1 same-session release + read-side evidence backstop) unchanged and re-validated fresh against the codebase.

This is the buildable spec for **FAFF-896** (Bug, High). It turns on one mechanism: a headless `--resume` that claims the run owner and then does no work must **release its own claim on the same turn-exit**, so the run never sits un-resumable for the full heartbeat-staleness window.

## 1. WHY — Problem and Principles

**Load-bearing model.** A run's owner record (`owner.status: "running"` + a `last_heartbeat`) is the "someone is driving" flag. Today the *only* thing that ages that flag out is heartbeat staleness (`runIsHeld` — heartbeat-only since FAFF-233). So a claimant that stamps the flag and then dies without ticking leaves a **frozen-fresh** flag: the heartbeat reads recent, `runIsHeld` says "held", and every subsequent `--resume` refuses for up to the full window. The fix makes the claimant **stamp its own flag back down** at turn-end when it did no work — a same-session, same-box act that needs no cross-box liveness proof — and, as a backstop, lets the next resume treat a provably-unworked frozen claim as reclaimable.

**Problem statement.** A headless `claude -p '… faff lights-out --resume …'` claims the owner (writes `owner.status: running`, a fresh `last_heartbeat`, and a `run-resume` event) and then ends its turn with no work done; the frozen-fresh heartbeat then makes the next `--resume` refuse for up to the whole staleness window (observed ~2h in this env; recurred 2026-08-22 with a shorter 900s window — same lockout, shorter wait). This change releases the claim on that no-work turn-exit and lets the next resume reclaim a provably-dead claim instead of trusting heartbeat age alone.

**Design principles.**

- **Same-session release needs no machine-id.** The claimant's own Stop hook stamps its own owner back down — same process lineage, same box. This deliberately sidesteps the cross-box machine-id/pid wiring (capability #2).
- **Evidence over liveness-guessing.** "The only event since the last `run-resume` is that `run-resume`" is a durable, box-independent fact in the append-only log. Prefer it to any process-liveness heuristic.
- **The epoch fence stays the real mutex.** This change shifts *when* a claim is releasable; it must not weaken FAFF-575's under-lock epoch fence or FAFF-863's claim guard.
- **Never gate the same-session release on an age grace.** The observed failure fires seconds after the claim; an age threshold on the primary release path would re-open the exact window this ticket closes. (The age grace belongs only on the *read-side* backstop.)

**Reference context.**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/inflightcheck.js` (FAFF-884) | The proven template: a Stop-hook member with owner-stamped ownership + an evidence/age sweep that is **never** `runIsHeld`. |
| `plugin/skills/faff/bin/lib/resume.js` | `classifyReEnterable` (pure) + `applyResumeToLedger` + `runResumeEvent`. The read-side backstop extends `classifyReEnterable`'s inputs. |
| `plugin/skills/faff/bin/lib/lights-out.js` (`resumeLightsOut`) | The impure resume shell that gathers `held` and calls `classifyReEnterable`; where the read-side evidence bit is computed. |
| `plugin/skills/faff/bin/lib/runcheck.js` | `runIsHeld` (heartbeat-only), `runIsOwned`/`ownedByEnvPointer`, `heartbeatStaleSecs`, `resolveRunDir`. Reused verbatim. |
| `plugin/skills/faff/bin/lib/events.js` | `tailReadNextSeq` (returns the tail record), `appendRecordUnderLock`, `DELIVERY_PROFILE.event_types`. |
| `plugin/skills/faff/bin/lib/heartbeat.js` | `overlayHeartbeat`/`readHeartbeatFile`, `mutateLedgerUnderLock(runDir, mutate, expectedOwner)`, `ownerEpochFenceStale`. |
| `plugin/skills/faff/bin/lib/bundle.js` (FAFF-863/889) | `recoveryClaimStore`/`buildClaimStore` + `thisMachineId()` gating (the same-box row) — the *sibling* exposure and the now-live machine-id primitive; out of scope here but names the capability-#2 extension point. |
| `.claude/settings.json` (`hooks.Stop[]`) | Where the sibling Stop hooks are registered; the new member is added here (via `faff hooks-ensure`). |

**Scope statement.** The L4 run re-entry path — the owner-claim lifecycle around `faff lights-out --resume` and the Stop-hook family that audits turn-ends.

## 2. OUT OF SCOPE

- **Capability #2 as a foreign cross-box pid probe** — Reclaiming a *foreign* owner by probing its recorded `pid`. FAFF-233 forbids a bare cross-box pid probe, and a *safe* same-box pid read requires a `machine_id` on the **owner** record. As of FAFF-889 (Done, PR #743), `thisMachineId()` (FAFF-891) is live and proven — but FAFF-889 baked `machine_id` onto the build-**claim** record only and **deliberately kept the run-owner record clean** (machine_id is a claim sibling). So the owner path still carries no machine_id; capability #2 remains out of scope for this slice. **Extension point (now concretely reachable):** bake `machine_id: thisMachineId(env)` onto the owner record at claim time, then add a same-box `pidAlive(owner.pid)` corroborator gated on `owner.machine_id === thisMachineId(env)` — a small, well-founded follow-up, no longer blocked on unbuilt infra.
- **FAFF-877 / capability #4 — producer heartbeat starvation** — Shrinking the staleness window by keeping the heartbeat fresh through long producer work. Binding scope guardrail — a separate ticket. **Extension point:** FAFF-877's own fix.
- **The `git-remote` recovery-claim reclaim path** — `recoveryClaimStore.reclaimIfStale` (`bundle.js`, FAFF-863) has the identical exposure via `runIsHeld` under `bundle_store: git-remote`, but it reclaims a claim-manifest ref (not the owner record) and lacks the run event log at the decision point. **Extension point:** teach `reclaimIfStale` to consult the tail-event evidence (or the now-live same-box `thisMachineId()` gate FAFF-889 uses).
- **Rewriting the drain into a real resume loop** — Finding 1's *other* root fix; an orchestration/skill-prose change orthogonal to the ledger-level claim-release this ticket owns.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| dead claim | An `owner.status: "running"` record whose claimant did no work after stamping it — the tail event of the log is still the `run-resume` that installed the claim. |
| no-work evidence | "Nothing was appended after the last `run-resume`", read as: the log's tail record `type === "run-resume"`. Append-only + seq-ordered makes this exactly "only event since run-resume is the resume itself". |
| same-session release | The claimant's *own* Stop hook stamping *its own* owner back to `aborted-resumable` at turn-end. No cross-box proof needed. |
| held | `runIsHeld`: `owner.status === "running"` AND heartbeat age ≤ `heartbeatStaleSecs(env)`. Heartbeat-only (FAFF-233). |
| deadclaim grace | Minimum age of the tail `run-resume` event before the *read-side* backstop treats a held claim as reclaimable — bounds the race with a live-but-just-started driver. |

**The no-work evidence primitive (reuses the existing tail reader).**

```
FUNCTION tailEventIsRunResume(runDir) -> { isRunResume, ts, seq }:
  rec := tailReadNextSeq(<runDir>/events.jsonl).prevRecord   # existing events.js primitive
  IF rec == null: RETURN { isRunResume: false, ts: null, seq: null }   # empty log ⇒ not a resume claim
  RETURN { isRunResume: rec.type == "run-resume", ts: rec.ts ?? null, seq: rec.seq ?? null }
```

**Owner record — unchanged shape.** `{ status, epoch, session_id, pid, started_at, last_heartbeat }`. The release flips `status: "running" → "aborted-resumable"` (the field the operator hand-edited to recover). No new owner field (a `machine_id` is capability #2's, out of scope).

**`resumecheck` CLI + exit contract.**

```
CLI: faff resumecheck [--hook] [--json] [--selftest] [--root DIR]
EXIT CONTRACT (--hook): ALWAYS exit 0 (never blocks — mirrors the family's non-blocking sweep members).
  The side effect, not the exit code, is the observable: owner.status flipped + a run-claim-abandoned
  event appended IFF a release committed; otherwise no ledger write. --json prints
  { released: bool, reason?, run_id?, epoch? }.
```

**`run-claim-abandoned` event record.**

```
RECORD run-claim-abandoned:            # type MUST be registered in DELIVERY_PROFILE.event_types
  schema: 2                            # same envelope as run-resume (appendRecordUnderLock mints seq/prev/hash)
  type: "run-claim-abandoned"          # phase: "run"
  ts: ISO
  epoch: int                           # the released owner's epoch
  data: { released_from: "running", to: "aborted-resumable", reason: "no-work-since-run-resume" }
```

**Time source — inject `nowFn`** (default `Date.now`) so the 299s-vs-301s grace boundary is deterministically unit-testable (siblings drive time via fixed `RUNCHECK_NOW`/`inflightAgo`). Anti-pattern: inline `Date.now()` in the decision function.

**New Stop-hook decision (pure — twin of `inflightHookDecision`/`runcheckHookDecision`).**

```
FUNCTION resumecheckHookDecision(ledger, runDir, tail, env) -> { release, reason? }:
  IF NOT runIsOwned(ledger, runDir, env): RETURN { release: false }     # never a foreign owner (FAFF-235)
  IF owner == null OR owner.status != "running": RETURN { release: false }
  IF NOT tail.isRunResume: RETURN { release: false }                     # work happened ⇒ healthy, leave it
  RETURN { release: true, reason: <resumecheckReason(runDir)> }
```

- **`runDir` is a trusted launcher-set pointer.** Resolved via the existing `resolveRunDir` (from `FAFF_RUN_DIR`), identical to `runcheck`/`inflightcheck`; writes confined to `<runDir>/run-ledger.json` + `events.jsonl`; `runIsOwned`→`ownedByEnvPointer` fences a foreign runDir. Anti-pattern: deriving the write target from ledger content.

**Read-side backstop — extend `classifyReEnterable`'s inputs (pure).**

```
classifyReEnterable(ledger, { held, provablyDead? }):
  ... existing precedence (abort-marker → escalate → running) unchanged ...
  IF owner.status == "running":
     IF held AND NOT provablyDead:  RETURN { reEnterable:false, state:"live-running", refuseReason: <unchanged> }
     RETURN { reEnterable:true, state:"dead-running" }     # stale-heartbeat OR provably-dead ⇒ reclaim
```

**Grace knob.**

```
FAFF_RESUME_DEADCLAIM_GRACE_SECS  # env-ONLY (mirrors FAFF_RUN_HEARTBEAT_STALE_SECS): finite >0 wins, else default 300.
FUNCTION graceSecs(env): n := Number(env.FAFF_RESUME_DEADCLAIM_GRACE_SECS); RETURN (finite && n>0) ? n : 300
```

**Chosen (where the primary fix lives):** Ship **both** the same-session Stop-hook stamp (primary — fixes the observed clean-exit case, no race, no machine-id) **and** a bounded read-side evidence reclaim (backstop — covers the hard-kill case where no Stop event fired). The drain-loop rewrite stays out of scope.

## 4. HOW — Behavior

**Architecture.** Two independent guards over the same evidence, neither depending on machine-id.

**Write-side (primary): `resumecheck` Stop hook.** Lock discipline is the existing FAFF-527/575 read-then-mutate-under-fence idiom (`applyResumeToLedger` uses it): the unlocked read is **advisory** (decides whether to *attempt* a release); the authority is the `expectedOwner` epoch/session fence `mutateLedgerUnderLock` applies **under** the lock. We pass the observed claim as `expectedOwner`, so the write commits **iff** the on-disk owner is still that same epoch+session.

```
PROCEDURE resumecheck_hook():
  1. runDir := resolveRunDir()            # trusted FAFF_RUN_DIR pointer; null ⇒ exit 0 (silent)
  1a. ASSERT resolve(runDir) is a run dir under the runs-root (has run-ledger.json); fail ⇒ exit 0 no-op
  2. ledger := readLedger(runDir)         # ADVISORY snapshot; unreadable ⇒ exit 0 silent
  3. overlayHeartbeat(ledger, readHeartbeatFile(runDir))
  4. tail := tailEventIsRunResume(runDir)
  5. d := resumecheckHookDecision(ledger, runDir, tail, env)
  6. IF NOT d.release: RETURN 0
  7. expectedOwner := { epoch: ledger.owner.epoch, session_id: ledger.owner.session_id }
  8. result := mutateLedgerUnderLock(runDir, (fresh) =>          # fence applied BY mutateLedgerUnderLock:
       IF fresh == null: RETURN null                             #   stale expectedOwner (newer epoch) ⇒ refuses (FAFF-527)
       IF fresh.owner?.status != "running": RETURN null          # already moved (idempotent no-op)
       IF NOT tailEventIsRunResume(runDir).isRunResume: RETURN null  # work landed between read and lock ⇒ abort
       next := clone(fresh); next.owner.status = "aborted-resumable"; RETURN next
     , expectedOwner)                                            # ← arms the under-lock fence; NOT a hand re-check
  9. IF result.written: appendRecordUnderLock(runDir, runClaimAbandonedEvent(runId, seq, nowIso, epoch, prevHash))
  10. IF result.written: stderr "[warn] released unworked resume claim (epoch N) → aborted-resumable"
  11. RETURN 0                             # non-blocking
```

- **Stamp, do not block.** A `block` payload cannot keep a terminating `-p` alive and leaves the owner `running` — the corpse. The fix is the *write* (release), mirroring `inflightcheck`'s sweep.
- Anti-patterns: age-gating the write-side release (re-opens the window); stamping a *foreign* owner (FAFF-235).

**Read-side (backstop):** inside `resumeLightsOut` STEP 1b, compute `provablyDead = tail.isRunResume AND tail.ts != null AND (now − tail.ts)/1000 > graceSecs`, pass `{ held, provablyDead }` into `classifyReEnterable`; a held-but-provably-dead claim classifies `dead-running` and flows into the **unchanged** FAFF-575 epoch fence + FAFF-863 claim write path.

**Edge cases.** Empty/non-`run-resume` tail ⇒ neither guard fires. Already `aborted-resumable`/`escalated` ⇒ evidence bit never consulted. Concurrent legitimate takeover ⇒ the under-lock fence aborts rather than clobbering. `grace ≥ staleSecs` (misconfig) ⇒ backstop inert, degrade to today (never worse, never throw). Live same-session driver mid-drain ⇒ a healthy drain's first act is an event append, so a turn ending with the tail still `run-resume` did literal zero work (the failure signature) — release is correct, not premature.

**Failure modes.** (1) Stop hook does *not* fire under a hard kill / SIGKILL / OOM → primary release never runs → the read-side backstop covers it (window shrinks to `grace`, not zero). *The 2026-08-22 recurrence was exactly this: pid 572 hard-killed on turn-exit, so the read-side backstop — not the same-session stamp — is the arm that would have freed it.* (2) Read-side races a live driver that resumed within `grace` and hasn't logged its first event → the FAFF-575/863 mutex keeps the ledger correct (no double-merge); residual cost ≤ one redundant dispatch; fully race-free needs capability #2 (out of scope). (3) FAFF-877 starvation delays a live driver's first event past `grace` → out of scope; epoch fence still bounds damage; `grace` default 300 chosen above observed first-event latency.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run: owner "running", fresh (frozen) last_heartbeat, events-log tail record is the run-resume that installed the claim
When the claiming session's turn ends and the resumecheck Stop hook fires
Then owner.status is stamped "aborted-resumable" and a non-blocking notice is emitted
```
```
Given the same frozen-fresh dead claim NOT released, run-resume event older than FAFF_RESUME_DEADCLAIM_GRACE_SECS
When a fresh `faff lights-out --resume <run-id>` runs
Then classifyReEnterable returns state "dead-running" (reEnterable) and the resume proceeds — it does NOT refuse "live-running"
```
```
Given a foreign session (not the owner) whose turn ends while another run shows a running owner with a run-resume tail
When that foreign session's resumecheck hook fires
Then it does NOT stamp the foreign owner (release:false)
```

## 6. DESIGN DECISION RATIONALE

- **Primary-fix home** — **Chosen:** Stop-hook stamp (same-session, no race, no machine-id, proven template) as primary + read-side reclaim as backstop (covers hard-kill). Drain-loop rewrite out of scope.
- **Stop-hook home** — **Chosen:** a new `resumecheck` family member (not folding a ledger *write* into read-mostly `runcheck`/`inflightcheck`). Reuses `runIsOwned`, `tailReadNextSeq`, `mutateLedgerUnderLock`, and the `inflightcheck` decision/selftest shape.
- **No-work detection** — **Chosen:** reuse `tailReadNextSeq(...).prevRecord.type === "run-resume"` (append-only + seq-ordered ⇒ tail record == "only event since"); add no new reader.
- **Release action** — **Chosen:** stamp `aborted-resumable` under the lock + non-blocking notice. Never block (a block leaves the corpse).
- **`run-claim-abandoned` audit event** — **Chosen:** register a new event type (phase `run`) in `DELIVERY_PROFILE.event_types` (`governance-profile.js`, adjacent to `run-resume`) as a required build step; `eventViolations` rejects an unregistered type. Reusing `run-resume` would corrupt resume semantics.
- **Include read-side reclaim despite its race?** — **Chosen:** yes, bounded by `grace` + the existing mutex; residual race documented as a named failure mode. The 2026-08-22 hard-kill recurrence confirms this arm carries real load (the same-session stamp cannot fire on a SIGKILL).
- **Grace default** — **Chosen:** `FAFF_RESUME_DEADCLAIM_GRACE_SECS` default **300s** (< `heartbeatStaleSecs`; above expected first-event latency).
- **Capability #2 (foreign-owner pid probe)** — **Punt:** still out of scope for this slice — the owner record carries no `machine_id`. FAFF-889 (Done) proved `thisMachineId()` live but kept it off the owner record by design, so the extension is now a small, well-founded follow-up (bake `machine_id` onto the owner record + a same-box `pidAlive` corroborator), not a blocked-on-infra dependency. *(decides: architecture)*
- **`git-remote` `reclaimIfStale` sibling path** — **Chosen:** defer to OUT OF SCOPE (reclaims a claim-manifest ref, lacks the event log at decision point).
- **Which knob is the real gate?** — **Assumes:** the builder targets `heartbeatStaleSecs`/`runIsHeld` (default 900, env `FAFF_RUN_HEARTBEAT_STALE_SECS`), NOT `sentry.stall_window_secs` (a disjoint sentry-poller `.faffrc` lane, per FAFF-887). The ticket's "~2h / sentry.stall_window_secs" conflates the two lanes; the 2026-08-22 recurrence under a 900s window confirms `heartbeatStaleSecs` is the live gate.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** *Foreign-owner same-box pid corroboration (capability #2)* — **Punt:** a well-founded follow-up now that `thisMachineId()` is live (FAFF-889/891); implement by baking `machine_id` onto the owner record, then a same-box `pidAlive(owner.pid)` corroborator. Not required for this slice's value.

**Assumptions.** (a) *The Stop hook fires at headless `-p` turn-end* — the whole `*check` family (incl. `inflightcheck`, built for this exact class) relies on it; validate the `resumecheck --hook` registration + an integration test; the read-side backstop is the hard-kill fallback. (b) *The gating knob is `heartbeatStaleSecs`/`runIsHeld`* — validate via `grep heartbeatStaleSecs runcheck.js` and that `resumeLightsOut` computes `held` via `runIsHeld`. (The `run-claim-abandoned` registration is a required build step per §6, not an assumption.)

## 8. DONE — Definition of Done

**From WHY** — [ ] A headless `--resume` that claims the owner then ends its turn with no work leaves the run resumable immediately (owner `aborted-resumable`), not stuck for the staleness window.

**From WHAT** — [ ] `tailEventIsRunResume` returns `{isRunResume,ts,seq}` from the tail record; empty ⇒ false. [ ] `classifyReEnterable` accepts `opts.provablyDead`; `running && held && !provablyDead` ⇒ `live-running`; `held && provablyDead` ⇒ `dead-running`; callers omitting the bit are byte-identical. [ ] `resumecheckHookDecision` returns `release:true` only for `runIsOwned && running && tail.isRunResume`. [ ] `FAFF_RESUME_DEADCLAIM_GRACE_SECS` parsed, default 300, non-finite/≤0 ⇒ default. [ ] `nowFn`-injected time; a test drives the 299s-vs-301s boundary deterministically. [ ] `resumecheck --hook` always exits 0; `--json` shape as specified; `run-claim-abandoned` record shape as specified.

**From HOW** — [ ] `resumecheck --hook` resolves only via `resolveRunDir`, asserts a run-dir-under-runs-root before any write, writes only `<runDir>/…` (never a ledger-derived path); non-run-dir ⇒ silent exit-0 no-op. [ ] Stamps `running → aborted-resumable` via `mutateLedgerUnderLock(..., expectedOwner={epoch,session_id})` — the FAFF-527 fence refuses on a newer on-disk epoch; the mutate also aborts if no longer `running` or the tail is no longer `run-resume`. [ ] `run-claim-abandoned` added to `DELIVERY_PROFILE.event_types` (phase `run`); appended only when the release committed; non-blocking `[warn]`; never a `block`; events selftest passes. [ ] Registered in `.claude/settings.json hooks.Stop[]` after `inflightcheck --hook` (via `faff hooks-ensure`). [ ] `resumeLightsOut` STEP 1b computes `provablyDead` and passes `{held,provablyDead}` into `classifyReEnterable`; reclaim flows through the unchanged FAFF-575/863 path.

**From edge cases** — [ ] Empty/non-`run-resume` tail ⇒ no guard fires. [ ] A foreign session's hook never stamps another run's owner. [ ] `grace ≥ heartbeatStaleSecs` degrades to today (no throw).

**From tests** — [ ] `resumecheck --selftest` (mirrors `inflightcheck`): owned+running+resume-tail → release; +work-tail → no release; foreign → no release; non-running → no release. [ ] A new test: ledger whose events tail is a `run-resume` + frozen-fresh heartbeat asserts (a) the hook stamps `aborted-resumable`; (b) `classifyReEnterable({held:true,provablyDead:true})` ⇒ `dead-running`. [ ] `resumeSelftest` gains a `provablyDead` row; existing table unchanged for calls omitting the bit.

**Integration smoke test.**
```
1. mkdtemp run dir; write run-ledger.json { owner:{status:"running", session_id:"S", epoch:1, last_heartbeat: now} }
2. append a run-resume event as the tail of events.jsonl
3. FAFF_SESSION_ID=S faff resumecheck --hook   → owner.status == "aborted-resumable"; stderr release notice
4. faff lights-out --resume <run-id> --check    → PASS state "aborted-resumable" (not refused)
# hard-kill variant: skip step 3; set grace low; --resume --check reports state "dead-running" once run-resume ts > grace
```

## Methodology critique (advisory)

**Right-sized?** Ships two structurally independent guards (write-side Stop-hook + read-side classifier input) closing two different failure modes (graceful turn-end vs hard-kill). Defensible as one ticket (both defend one defect, cheap together); if it runs long, the natural cut is write-side first (standalone value), read-side second. **Workstream fit?** No issues — squarely the "executor loss survival" project. **Deps surfaced?** No blocker link owed — FAFF-889 is now Done (its `thisMachineId()` primitive is the capability-#2 extension point, not a blocker for this slice); FAFF-877 stays out of scope; FAFF-575/863 are reused Done infra. **Risk?** Largely bought down (write-side mirrors the Done inflightcheck; machine-id now proven-live in FAFF-889); residual risk sits on the read-side (bounded race + the 300s timing choice) — reinforces the write-side-first ordering.

---

*Spec-review gate (autonomous re-prep): the L4 adversarial fan-out (faffter-dark-spec-review) stalled on the decorrelated backend panel and did not return within the bounded wait; fell back to the single-pass reviewer (faffter-noon-spec-review, lenses architectural/infosec/QA). Verdict: **approve** (all fired lenses clear). Retained: `confidence: medium`, `spec-review: approve`. Routing: promoted-needs-review — moved to Todo but flagged needs-decision-first (medium confidence), not build-admitted; surfaced for /faff-wtf.*

confidence: medium
spec-review: approve
