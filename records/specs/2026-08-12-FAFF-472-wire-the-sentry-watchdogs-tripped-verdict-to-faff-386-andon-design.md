# FAFF-472 — Page a human via andon when a detached sentry watchdog trips

> Spec: faffter-dark-nlspec · 2026-08-12 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-472.

## Already shipped against this surface

These Done tickets are the substrate this ticket wires — enablers, not supersession (the detached loci are still un-paged, so the premise holds):

- **FAFF-386** (Done, PR #619) — shipped `faff andon pump`/`send` and the `sentry-trip` classification this consumes.
- **FAFF-470** (Done, PR #388) — shipped the detached poller locus this wires.
- **FAFF-471** (Done, PR #389) — shipped the `sentrycheck` Stop-hook consult locus this wires.
- The cooperative checkpoint + run-end (beep-boop) already page andon; this ticket covers only the two *non-cooperative* loci they left unwired.

This spec is for the build agent implementing FAFF-472 and for the human reviewer who will approve the PR. It wires the two *non-cooperative* sentry watchdog loci — the mint-scoped detached poller (FAFF-470) and the Stop-hook staleness consult (FAFF-471) — into the andon push channel that FAFF-386 shipped, so a tripped abort verdict pages a human in real time instead of waiting for the next-morning `/faff-wtf` brief.

## 1. WHY — Problem and Principles

**The load-bearing model:** the andon already knows how to page a human about a sentry trip — it is a fail-open pump (`faff andon pump`) that reads the run's `events.jsonl`, classifies any `sentry-trip` event, dedupes it, and POSTs one notification. The only reason the *detached* loci don't page today is that neither one emits the `sentry-trip` event or invokes the pump/send after it acts. This ticket closes exactly that wiring gap; it introduces no new transport and no new detection.

**Problem statement.** The cooperative checkpoint (beep-boop) and run-end already page andon, but the two loci that exist precisely to catch a *derailed, non-cooperating* run — the detached poller and the Stop-hook consult — surface a trip only via the interim path (`sentry abort` ledger-mark + an advisory stderr line). A run that stalls at 3am with no human watching is aborted resumably by the poller but nobody is paged until morning. This change makes the poller's actioned abort, and the Stop-hook consult's observed trip, both reach the andon channel.

**Design principles (each would reject an otherwise-valid implementation):**

- **Consume the shipped andon, never re-derive.** The trip signal is fanned out through the existing `faff andon pump` / `faff andon send` surface and the existing `sentry-trip` event classification (ADR-0102). No new andon class, no new event type, no re-running of `faff sentry check` inside the andon.
- **Fail-open, never in the correctness path (ADR-0101).** The andon emit is telemetry beside the abort, never inside it. A failed or disabled andon call never blocks, reorders, or fails the abort that already landed on the ledger, and never changes the poller's or the hook's exit behaviour.
- **The poller writes its own run; the Stop-hook consult writes nobody's run.** The poller is the run's own trusted same-run writer (it already appends `sentry-checkpoint` events and marks the ledger via `sentry abort`), so it may append a `sentry-trip` event and pump. The Stop-hook consult fires at a *foreign* session's turn-end and must never write the foreign run's ledger or `events.jsonl` (FAFF-235, ADR-0065) — so it uses the event-independent `faff andon send`, which writes no run-dir state.
- **Additive, never a regression.** A run with `andon.url` unset behaves byte-for-byte as today (both calls are no-ops). The existing `sentry-checkpoint` telemetry event and the existing advisory stderr line are unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry-poller.js` | JS (Node, zero-dep) | The primary detached locus (FAFF-470); its exit-0 abort block gains the `sentry-trip` append + `andon pump`. |
| `plugin/skills/faff/bin/lib/sentrycheck.js` | JS (Node, zero-dep) | The assist Stop-hook locus (FAFF-471); its `tripped` branch gains a `faff andon send`. |
| `plugin/skills/faff/bin/lib/andon.js` | JS (Node, zero-dep) | The shipped andon (FAFF-386): `pump`, `send`, `sentry-trip` classification + notification shape. Not modified. |
| `plugin/skills/faff/bin/lib/events.js` | JS (Node, zero-dep) | `appendEventRecord` (already imported by the poller); `sentry-trip` is a valid `EVENT_TYPES` member. Not modified. |
| beep-boop `SKILL.md` (step 8.1, run-end) | prose | The cooperative reference wiring this mirrors: append `sentry-trip` `{verdicts,intervention}` → `faff andon pump`. |

**Scope statement.** This is the third and final follow-up of ADR-0065 (`follow_ups[2]`), completing the sentry-watchdog supervision slice under the T3 project: detection (FAFF-470/471) now reaches a real-time human alert (FAFF-386).

## 2. OUT OF SCOPE

- **Pause/surface/correct paging from the poller.** The detached poller acts only on `abort` and never on `pause`/`surface`/`correct` (ADR-0103 amendment: "the detached sentry-poller still never acts on pause at any level"). Paging for pause-acting stays with the cooperative checkpoint, which already pumps andon. **Extension point:** if a future ticket gives the poller pause-acting, its andon page is added in the same abort block, keyed on the new action.
- **A new andon event class or transport.** ntfy/email/SMS transports and any class beyond the shipped `park`/`sentry-trip`/`budget-breach`/`run-end` set are out of scope. **Extension point:** `ANDON_CLASSES` / the transport branch in `andon.js` (owned by FAFF-386, ADR-0101).
- **Deduping the Stop-hook consult's andon send across foreign turn-ends.** The consult cannot write the foreign run's `andon-state.json`, so its `send` does not dedupe (see the HOW note). **Extension point:** a future owner-mediated relay if human-turn-paced volume ever proves a problem.
- **Changing `faff sentry check` / `faff sentry abort` / the andon module.** All three are consumed unmodified. No detection-math or transport change.
- **The FAFF-324 shared-fs forgery residual.** Ledger/event forgery by a same-uid process is the tracked ADR-0034/FAFF-324 residual and is explicitly not reopened here (ADR-0065).

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Cooperative locus | The beep-boop between-units checkpoint + run-end; already pages andon. Not touched here. |
| Detached poller | The mint-scoped `sentry-poller.js` child process (FAFF-470) — the primary non-cooperative locus. |
| Stop-hook consult | The `sentrycheck` Stop-hook command (FAFF-471) — the opportunistic assist locus that fires at any session's turn-end. |
| Actioned abort | The poller path where `faff sentry abort` returned exit 0 (the abort landed on the ledger). |

**Existing interfaces consumed (unchanged).**

```
# fail-open, exits 0 always; no-op when andon.url unset
faff andon pump --run-dir <runDir>
faff andon send --class sentry-trip --title <T> --body <B> [--issue <ID>] --run-dir <runDir>

# already imported in sentry-poller.js
appendEventRecord(runDir, runId, { phase, type, data })   # type "sentry-trip" is a valid EVENT_TYPES member
```

**The `sentry-trip` event the andon classifies (shape the poller must emit).**

```
RECORD SentryTripEvent (data payload):
  verdicts:     Array<{ signal: string, ... }>   # from the sentry-check payload; andon reads v.signal
  intervention: string                            # "abort" here; andon renders it in the title
# andon dedupe key = "sentry:" + verdicts.map(v=>v.signal).sort().join(",")
# andon notification: title "faff <runId>: sentry tripped (<intervention>)", body "signals: <...>"
```

**Design decision — the poller's andon path.**

- Options: (a) reuse the existing `sentry-checkpoint` event the poller already appends; (b) append a `sentry-trip` event + run `faff andon pump`.
- The andon classifier recognises only `sentry-trip` (not `sentry-checkpoint`), and the pump is the deduping, at-least-once surface. **Chosen:** (b) — append a `sentry-trip` event `{verdicts, intervention}` then run `faff andon pump --run-dir <runDir>`, mirroring the cooperative checkpoint's exact shape (beep-boop step 8.1). Rationale: it reuses the shipped classification + dedupe, is byte-for-byte consistent with the already-wired cooperative path, and needs no change to `andon.js`.

**Design decision — the Stop-hook consult's andon path.**

- Options: (a) append a `sentry-trip` event + `faff andon pump` (like the poller); (b) `faff andon send` (event- and state-independent); (c) no andon from this locus.
- The consult runs at a *foreign* session's turn-end and must not write the foreign run's `events.jsonl` or `andon-state.json` (FAFF-235; non-owner-never-writes, ADR-0065). Option (a) violates that. Option (c) leaves the ticket's "hook's tripped verdict" half unwired. **Chosen:** (b) — on a genuine `tripped` outcome, `faff andon send --class sentry-trip --title … --body … --run-dir <runDir>`. Rationale: `send` reads no events and writes no run-dir state, so it honours every ownership invariant; it is fail-open and exit-0-preserving; the consult already has the `verdicts`/`intervention` payload in hand for the title/body.

## 4. HOW — Behavior

**Poller (`sentry-poller.js`), inside the actioned-abort block (`decision.action === "abort"`, after `faff sentry abort` returns exit 0, before `return`).** The existing `sentry-checkpoint` append (L4-only) and `abort-actioned` log are unchanged; the new emit is added alongside, best-effort.

```
PROCEDURE on_actioned_abort(runDir, runId, decision):        # only reached when the abort child exited 0
  1. (existing) best-effort append sentry-checkpoint event (L4-only) + appendLog "abort-actioned"
  2. best-effort:
     a. appendEventRecord(runDir, runId, {
          phase: "run", type: "sentry-trip",
          data: { verdicts: decision.payload.verdicts || [], intervention: decision.payload.intervention }
        })
     b. spawnSync(faff, ["andon", "pump", "--run-dir", runDir])   # fail-open; ignore exit/output
  3. return            # unchanged — the poller exits after actioning one abort
```

- **Behaviour summary:** when the watchdog aborts an unattended run, ensure the trip is on `events.jsonl` and flush the andon pump, so the shipped classifier pages the human once (deduped).
- The abort block is only reached for an unattended run (`actsOnSentryAbort` gates it), so the page fires exactly for the runs that have no human watching — the ticket's target case.
- **Ordering:** append the `sentry-trip` event *before* pumping, so the pump sees it in the same tick.
- **Best-effort:** wrap both in the same try/catch discipline as the existing `sentry-checkpoint` append — a fault here never blocks, reorders, or fails the abort (which already landed) and never changes the poller's control flow.
- The poller returns after one actioned abort, so it pages at most once per run; the pump's `notified` dedupe additionally collapses any overlap with a cooperative `sentry-trip` of the same signal set.

**Stop-hook consult (`sentrycheck.js`), in `cmdSentrycheck` where `outcome.kind === "tripped"` (the branch that today only writes `trippedNotice` to stderr).** The stderr advisory is unchanged; the new emit is added after it, best-effort.

```
PROCEDURE on_consult_tripped(runId, runDir, payload):
  1. (existing) write trippedNotice(...) to stderr
  2. best-effort:
     signals := (payload.verdicts || []).map(v => v.signal).join(", ") or "unknown"
     spawnSync(faff, ["andon", "send",
       "--class", "sentry-trip",
       "--title", `faff ${runId}: sentry tripped (${payload.intervention})`,
       "--body",  `signals: ${signals} — run looks abandoned (heartbeat stale)`,
       "--run-dir", runDir])            # fail-open; ignore exit/output
  3. return 0            # unchanged — the hook ALWAYS exits 0
```

- **Behaviour summary:** when a foreign session's turn-end observes an abandoned-looking run that sentry says is tripped, page the human once, without touching the foreign run's evidence chain.
- **Ownership:** `andon send` reads no `events.jsonl` and writes no `andon-state.json` in the run dir, so the non-owner-never-writes invariant holds; the only side effect is the outbound POST, which is fail-open.
- The consult already exits 0 on every path (FAFF-235); the best-effort `spawnSync` cannot change that.

**Edge cases and error handling.**

- `andon.url` unset → both `pump` and `send` are complete no-ops (return "disabled", exit 0). Byte-for-byte today's behaviour.
- andon webhook down / times out → recorded in `andon-state.json.failures` (pump) or dropped (send); command exits 0; the abort and the hook are unaffected (ADR-0101).
- `faff` binary not resolvable from the child spawn → the best-effort catch swallows it; the abort/hook path is unaffected. (The poller/hook already resolve `ENTRYPOINT`/`process.execPath` for their existing `sentry` child spawns — reuse the same resolution.)
- Abort child failed (poller exit ≠ 0) → the existing `abort-failed` path runs and retries next tick; **no** `sentry-trip`/pump this tick (the run was not actually aborted). The page fires only on the tick the abort lands.
- `decision.payload.verdicts` absent/empty → the event still appends with `verdicts: []`; andon renders `signals: unknown`. No throw.

**Failure modes — how the approach could be wrong, and how you'd notice.**

- **The failure:** a tripped, aborted run produces no andon page even though `andon.url` is set — e.g. the `sentry-trip` append landed but the pump was never reached, or the classifier didn't match the payload shape. **How you'd know:** the poller-selftest / test asserting `andon pump` is invoked on an actioned abort fails; or a live abort leaves a `sentry-trip` event in `events.jsonl` with no corresponding `andon-state.json` cursor advance / `notified` entry (auditable per ADR-0102). **What it means:** proceed only when the test asserts the pump call fires with the run dir on the exit-0 abort path.
- **The failure:** the Stop-hook `send` storms (re-pages every foreign turn-end while a run stays abandoned+tripped). **How you'd know:** repeated identical notifications in the webhook sink across a single stuck run. **What it means:** accepted — the consult fires only when *another* live session reaches turn-end (a human is present, human-paced volume) and the solo-overnight case has no other session, so the poller (deduped) is the only emitter there. Named as an accepted consequence, not a defect; the dedupe extension point is recorded OUT OF SCOPE.

**Anti-pattern:** making the andon emit block or gate the abort. Why: the andon is fail-open telemetry (ADR-0101); coupling it to the abort's control flow would let a webhook outage stall or fail a safety abort.

**Anti-pattern:** having the Stop-hook consult append a `sentry-trip` event or run `faff andon pump` against the foreign run. Why: it writes the foreign run's evidence chain / andon state, breaking the non-owner-never-writes invariant the whole watchdog design rests on.

## 5. Scenarios

```
Given an unattended run whose heartbeat has gone stale past the window, andon.url configured,
When the detached poller's tick trips wall-clock-runaway and its `faff sentry abort` child returns exit 0,
Then a `sentry-trip` event {verdicts, intervention:"abort"} is appended to that run's events.jsonl
     and `faff andon pump --run-dir <runDir>` is invoked, emitting exactly one sentry-trip notification.
```

```
Given a foreign, abandoned-looking, running run that `faff sentry check` reports tripped, andon.url configured,
When another session's turn-end fires the `sentry` Stop-hook consult,
Then the existing advisory stderr line is written AND `faff andon send --class sentry-trip --run-dir <runDir>`
     is invoked, with no write to the foreign run's events.jsonl or andon-state.json.
```

```
Given andon.url is unset,
When either locus trips and acts,
Then behaviour is byte-for-byte unchanged from today: pump/send are no-ops, no notification, exit 0.
```

- The andon emit MUST never change the exit status or control flow of the poller's abort path or the Stop-hook's `--hook` exit-0 contract (assertion).

## 6. Design Decision Rationale

**How should the poller reach andon — reuse the existing `sentry-checkpoint` event, or append a `sentry-trip` and pump?**
- `sentry-checkpoint` is not in the andon's classified set; only `sentry-trip` is. Reusing it would require changing `andon.js` (out of scope, owned by FAFF-386).
- **Chosen:** append a `sentry-trip` event `{verdicts, intervention}` then `faff andon pump`, mirroring the already-wired cooperative checkpoint. Reuses the shipped classifier + `notified` dedupe; zero change to `andon.js`.

**How should the Stop-hook consult reach andon, given it must not write the foreign run?**
- `pump` requires a `sentry-trip` event on the foreign run's `events.jsonl` and writes `andon-state.json` — both forbidden for a non-owner (FAFF-235, ADR-0065).
- **Chosen:** `faff andon send --class sentry-trip …`, which reads no events and writes no run-dir state. Accepts non-dedupe across foreign turn-ends as a human-paced, bounded consequence (documented). Rationale: it is the only andon path that honours every ownership invariant while still paging.

**Should the poller page on any level, or only L4?**
- The existing `sentry-checkpoint` telemetry event is L4-only (D10). The abort block itself only runs for an unattended run (`actsOnSentryAbort` — L4 or an L3 that declared `autonomous.unattended`/the `sentry_acting` alias, ADR-0103).
- **Chosen:** page on every actioned abort (i.e. every unattended run the poller aborts), not only L4 — the goal is to page whenever a human is absent, which is exactly the abort-acting set. Keep the `sentry-checkpoint` L4-only behaviour unchanged.

## 7. Open Questions and Assumptions

**Open Questions:** none.

**Assumptions.**

- **Assumes:** `faff andon pump` / `faff andon send` and the `sentry-trip` andon classification exist and behave as in `andon.js` (FAFF-386, merged PR #619). *Validation:* `grep -n "sentry-trip\|cmdAndon\|runPump" plugin/skills/faff/bin/lib/andon.js` and `faff andon --selftest` before building.
- **Assumes:** the poller already imports `appendEventRecord` and reaches an exit-0 abort block with `decision.payload.{verdicts,intervention}` in scope. *Validation:* `grep -n "appendEventRecord\|decision.action ===" plugin/skills/faff/bin/lib/sentry-poller.js`.
- **Assumes:** `sentry-trip` is a valid `EVENT_TYPES` member so `appendEventRecord` accepts it. *Validation:* `grep -n "sentry-trip" plugin/skills/faff/bin/lib/events.js` / `governance-profile.js`.

## 8. DONE — Definition of Done

### From WHY / principles
- [ ] With `andon.url` unset, both loci behave byte-for-byte as before (no notification, exit 0, no new state) — asserted by a test.
- [ ] The andon emit never changes the poller's abort exit/return path nor the Stop-hook's exit-0 contract — asserted by a test that forces an andon failure and checks the abort/hook outcome is unchanged.

### From WHAT / HOW (poller)
- [ ] On an actioned abort (`faff sentry abort` exit 0), the poller appends a `sentry-trip` event with `data:{verdicts, intervention}` to the run's `events.jsonl`.
- [ ] Immediately after, the poller invokes `faff andon pump --run-dir <runDir>` (best-effort, ignoring exit/output).
- [ ] The pre-existing `sentry-checkpoint` (L4-only) append and `abort-actioned` log are unchanged.
- [ ] The `sentry-trip` append + pump are wrapped best-effort so a fault does not block/reorder/fail the abort or change control flow.

### From WHAT / HOW (Stop-hook consult)
- [ ] On a `tripped` consult outcome, `sentrycheck` invokes `faff andon send --class sentry-trip --title … --body … --run-dir <runDir>` after writing the existing advisory stderr line.
- [ ] The consult writes no `sentry-trip` event and no `andon-state.json` to the foreign run (asserted: no new files/lines in the run dir on a foreign consult).
- [ ] `cmdSentrycheck` still returns 0 on every path.

### From HOW (edge cases)
- [ ] Abort-child-failed tick appends no `sentry-trip` and runs no pump (page only on the landing tick).
- [ ] Absent/empty `verdicts` appends `verdicts: []` without throwing.

### Tests
- [ ] `plugin/skills/faff/test/sentry-poller.test.mjs` covers: actioned-abort emits `sentry-trip` + invokes `andon pump`; andon-disabled no-op; andon-failure does not affect the abort; abort-failed tick emits nothing.
- [ ] `plugin/skills/faff/test/sentrycheck.test.mjs` covers: tripped consult invokes `andon send` and writes no run-dir state; exit 0 preserved; andon-disabled no-op.
- [ ] Each module's `--selftest` still passes (`faff sentry-poller --selftest`, `faff sentrycheck --selftest`).

**Integration smoke test.**
```
1. Configure andon.url to a loopback server; mint a run dir with a stale-heartbeat unattended ledger.
2. Run the poller one tick against it → assert: events.jsonl gains a sentry-trip event AND the loopback
   server received exactly one sentry-trip POST.
3. Unset andon.url; repeat → assert: no POST, exit 0, ledger abort still landed.
```

confidence: high
spec-review: approve
build-tier: complex
