# Spec — FAFF-686: settle the sentry-poller checkpoint observation point so `test/sentry-poller.test.mjs:174` stops flaking

> Spec: faffter-dark-nlspec · 2026-08-04 · autonomous · confidence: high. Full spec on Linear FAFF-686.

This spec is for the build agent implementing FAFF-686, and for the human reviewers gating it. It fixes a test-side timing bug: the L4-abort integration test in `test/sentry-poller.test.mjs` reads a value at a moment when the thing it asserts on has not been written yet. The change is confined to the test — production code is correct as it stands and stays untouched.

## 1. WHY — Problem and Principles

**The load-bearing model.** Two different processes write the two files this test inspects. On an L4 abort, the `faff sentry abort` **child** writes the ledger (`owner.status = "aborted-resumable"` plus the abort entry). Its **parent** — the poller loop — then appends the `sentry-checkpoint` event to `events.jsonl` and, after that, the `abort-actioned` line to `sentry-poller.log`. The test waits on the ledger (child-written) and then reads the event (parent-written, and later). Between those two writes there is a window, and the read can land inside it.

**Problem statement.** Because the test's wait condition and its assertion target are written by different processes at different times, a full-suite run under load can read `events.jsonl` after the child's ledger write but before the parent's checkpoint append, observing zero checkpoint events. The current assertion message ("exactly one sentry-checkpoint event — not one per tick") anticipates a duplicate, so a zero-length failure reads as a mystery and invites blaming the change under test. This spec moves the test's observation point to something the parent writes *after* the checkpoint, and rewrites the assertion so a future failure names its own cause.

**Design principles:**

**Do not touch production ordering.** The checkpoint append is best-effort by deliberate design — comment D10 in `sentry-poller.js` states it must never block or reorder the abort, which has already landed on the ledger. The defect is entirely in where the test looks, not in what the code does. Any change that adds synchronisation to the poller to "help" the test, or reorders the child/parent writes, is out of bounds — it would trade a harmless test flake for a change to a governance-critical abort path.

**Wait on a strict happens-after, not on the target directly.** The parent writes the `abort-actioned` log line immediately after the checkpoint append, in the same synchronous block. Waiting on that line means that once it is visible, the checkpoint append has already run — so a genuine missing checkpoint (the best-effort append silently failed) surfaces as an immediate, clearly-messaged assertion failure rather than a slow ten-second wait timeout. Waiting directly on the checkpoint event would satisfy the happy path but would mask a real "no checkpoint" defect as a timeout.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/sentry-poller.js` (`runLoop`, lines ~249-270) | JavaScript (Node) | The abort branch. Child writes ledger; parent appends checkpoint (line 262) then `abort-actioned` (line 264) then returns. Read-only for this issue — not modified. |
| `test/sentry-poller.test.mjs` (the test at line 174) | JavaScript (Node, `node:test`) | The flaky test. The only file this spec changes. |
| `test/sentry-poller.test.mjs` helpers (`waitUntil` L44, `events()` L38, `log()` L37) | JavaScript | Reused as-is. No new helper needed. |

**Scope statement.** This sits in the skill-behaviour harness, one integration test among several driving the real `sentry-poller` entrypoint end to end; nothing outside this one test changes.

## 2. OUT OF SCOPE

- **The L4 abort-landing-within-deadline flake** — the *other* intermittent failure in this same test, where the stale-heartbeat abort does not reach the ledger inside the wait deadline. Why excluded: FAFF-709 / FAFF-635 own it; it is a distinct failure mode (the abort not landing) from this one (the checkpoint not yet appended when read). Extension point: the existing ledger wait at `test/sentry-poller.test.mjs` lines 183-187 — this spec leaves that wait untouched so the two fixes do not collide.
- **Any change to `sentry-poller.js`** — the production child/parent write ordering and the best-effort checkpoint semantics. Why excluded: the code is correct; the bug is the test's observation point. Extension point: none intended; if a future issue needs the checkpoint to be non-best-effort, that is a separate design decision against ADR-0065 / comment D10.
- **A new test-harness helper.** Why excluded: `waitUntil`, `events()`, and `log()` already provide everything the fix needs. Extension point: the helper block at the top of `test/sentry-poller.test.mjs`, if a later test genuinely needs a new primitive.
- **The other tests in the file** (stop-sentinel death, owner-status self-stop, non-L4 advisory, malformed-ledger self-heal). Why excluded: none of them read a parent-written event after a child-written ledger transition, so none share this race.

## 3. WHAT — the shape of the change

**Vocabulary:**

| Term | Definition |
|---|---|
| Observation point | The moment the test reads a file to assert on it. The bug is that the current observation point for the checkpoint event is unsynchronised against the write that produces it. |
| Strict happens-after | A write the poller performs *after* the checkpoint append, in the same synchronous block — so its visibility guarantees the checkpoint append has already run. Here: the `abort-actioned` log line. |

The change touches one test body. No types, API surfaces, or schemas change. The two edits, described precisely:

**Edit 1 — add a settling wait before the events read.** Between the ledger assertions (currently lines 189-191) and the `events()` read (currently line 193), wait until the `abort-actioned` token is present in `sentry-poller.log`, reusing the existing `waitUntil` and `log()` helpers. This wait is *additional* — the existing ledger wait at lines 183-187 is not modified.

**Edit 2 — reshape the checkpoint assertion so it names its own failure.** Replace the single `assert.equal(checkpoints.length, 1, "exactly one sentry-checkpoint event — not one per tick")` with two assertions whose messages distinguish the two failure directions: too few (none) and too many (per-tick duplication).

**Design decision — what the test waits on.**
- **Wait on the `abort-actioned` log line** (Chosen). A strict happens-after of the checkpoint append; visibility guarantees the checkpoint has been written or its best-effort append has genuinely failed — either way the subsequent count assertion is decisive and fast.
- Wait on the `sentry-checkpoint` event directly. Satisfies the happy path but a genuinely-missing checkpoint degrades to a slow timeout rather than a clear count-zero assertion.
- Keep waiting only on the ledger status. Rejected: that is the child-written value, the root of the race, and it belongs to FAFF-709 / FAFF-635.

**Chosen:** wait on the `abort-actioned` log line as the settling condition before reading `events()` (decides: qa)

**Design decision — assertion shape.**
- **Two assertions: a lower-bound then an exact-count** (Chosen), each with a message naming its direction.
- One `assert.equal` with a count-aware message. Rejected: `assert.equal` already reports actual-vs-expected, but a single message cannot phrase both "no checkpoint event was appended" and "more than one checkpoint — the per-tick guard regressed" as separate diagnoses, which is the whole point of acceptance criterion 2.

**Chosen:** split into a `length >= 1` assertion ("no checkpoint event appended") and a `length === 1` assertion ("more than one — per-tick regression")

## 4. HOW — Behaviour

**Approach.** The poller's abort branch, unchanged, runs these steps in order once the abort child exits 0: append the `sentry-checkpoint` event to `events.jsonl` (synchronous, best-effort, wrapped in try/catch), then append the `abort-actioned` line to `sentry-poller.log` (synchronous), then return. Both appends are synchronous file writes in the one process, in that fixed order. So the instant the test observes `abort-actioned` in the log, the checkpoint append has already executed and its bytes are on disk (or it threw and was swallowed — a real defect the test should catch). The fix makes the test read `events.jsonl` only after it has seen `abort-actioned`.

**Behaviour summary.** The test should read the checkpoint event only once the poller has moved past the point of writing it.

```
PROCEDURE l4_abort_checkpoint_assertions (revised test body, from ~line 189):
  1. Assert ledger.owner.status == "aborted-resumable"     # unchanged (lines 189-191)
  2. Assert ledger.abort exists                            # unchanged
  3. settled = waitUntil(() => log() includes "abort-actioned", { timeoutMs: 10000 })   # NEW settling wait
  4. Assert settled is true, message: "poller reached abort-actioned (checkpoint append has run)"
  5. checkpoints = events() filtered to type == "sentry-checkpoint"    # unchanged read, now settled
  6. Assert checkpoints.length >= 1, message: "no sentry-checkpoint event appended after abort-actioned"
  7. Assert checkpoints.length === 1, message: "more than one sentry-checkpoint event — the per-tick guard regressed"
  8. Assert checkpoints[0].data.tripped == true            # unchanged
  9. ... remainder of the test (abort-actioned match, poller-exit, status) unchanged
```

Step 4 gives the settling wait its own failure message, distinct from the count assertions — so a build box so slow that `abort-actioned` never arrives is diagnosed as "the poller never got there", not confused with "no checkpoint". The existing `assert.match(log(), /abort-actioned/)` later in the test (currently line 198) becomes redundant with step 3's wait but is harmless; leaving it in keeps the diff minimal, and it documents intent at its original spot.

**Anti-pattern:** replacing or moving the ledger wait at lines 183-187 to solve this. Why: that wait is the abort-landing gate FAFF-709 / FAFF-635 own; editing it risks a merge collision and mixes two unrelated flakes into one diff. Add the new wait; leave theirs alone.

**Anti-pattern:** adding a `sleep` before the `events()` read instead of a `waitUntil` predicate. Why: a fixed sleep is exactly the kind of load-sensitive guess that produces flakes — it under-waits on a slow box and wastes time on a fast one. The predicate wait is both faster and correct.

**Failure modes:**

- **The failure** — the fix rests on the assumption that the checkpoint append (line 262) always precedes the `abort-actioned` log append (line 264) in the poller. If that ordering were ever reversed in `sentry-poller.js`, waiting on `abort-actioned` would no longer guarantee the checkpoint is present, and the flake would return.
  - **How you'd know** — the same intermittent `length === 0` failure reappears in CI after this fix lands, now with the clearer "no checkpoint event appended after abort-actioned" message pointing straight at the ordering.
  - **What it means** — the assumption in the second design principle has been broken by a production change; re-derive the settling point (or switch to waiting on the checkpoint event directly). The clearer message is itself the safety net — the failure names its own cause rather than reading as a mystery.

## 5. Scenarios

```
Given an L4 run whose heartbeat is stale enough to trip an abort
When the poller actions the abort and the test proceeds to check for the checkpoint event
Then the test reads events.jsonl only after "abort-actioned" is present in sentry-poller.log, and observes exactly one sentry-checkpoint event
```

```
Given a hypothetical regression where zero (or two-or-more) sentry-checkpoint events are written
When the reshaped assertions run
Then the failure message distinguishes "no checkpoint event appended" from "more than one — per-tick regression", rather than a single message that only anticipates duplication
```

- The revised test passes under repeated full-suite runs (`node --test` from the repo root, `FAFF_REQUIRE_DOCKER=1`), not only standalone — the load condition that surfaced the original flake.

## 6. Design Decision Rationale

**What should the test wait on before reading the checkpoint event?**
- Options: (a) the `abort-actioned` log line — a strict happens-after; (b) the `sentry-checkpoint` event directly — the assertion target; (c) leave it on the ledger status.
- (a) guarantees the checkpoint append has run and keeps a genuine missing-checkpoint defect fast and clearly-messaged. (b) works for the happy path but degrades a real missing-checkpoint into a slow timeout. (c) is the current, broken behaviour and is owned elsewhere.
- **Chosen:** (a) wait on `abort-actioned` — it is the closest parent-written write that provably follows the checkpoint append, and it decouples "has the append run" from "did the best-effort append succeed", which is what makes the count assertion decisive.

**How should the assertion be shaped so a failure names its cause?**
- Options: (a) two assertions, lower-bound then exact; (b) one `assert.equal` with a richer message.
- **Chosen:** (a) — only separate assertions can carry separate diagnoses for the two directions (none vs duplicate), which is precisely what acceptance criterion 2 asks for.

**Why not fix it in production by making the checkpoint append deterministic before the abort lands?**
- At the time of writing, the checkpoint is best-effort by explicit design (comment D10 / ADR-0065): it must never block or reorder the abort. Making it synchronous-before-abort would change a governance-critical path to satisfy a test. Rejected on those grounds; revisit only if the checkpoint's best-effort status is itself deliberately changed by a future issue.

## 7. Open Questions and Assumptions

**Open Questions:** none.

**Assumptions:**

- **Assumes:** FAFF-709 / FAFF-635 remain the owners of the abort-landing-within-deadline flake, and the ledger wait at `test/sentry-poller.test.mjs` lines 183-187 is theirs to change, not this issue's. Validation before starting: confirm those tickets are still open and scoped to the abort-landing deadline; if either has already landed and rewritten that wait, rebase and re-check that the new settling wait still sits *after* their wait and does not duplicate it.
- **Assumes:** in `sentry-poller.js` `runLoop`, the `sentry-checkpoint` append precedes the `abort-actioned` log append within the same synchronous post-abort-exit block. Validation before starting: read the abort branch (currently lines 262 then 264) and confirm the checkpoint `appendEventRecord` call still comes before the `appendLog(..., "abort-actioned", ...)` call. If they have been reordered, wait on the checkpoint event directly instead.

## 8. DONE — Definition of Done

### From WHY
- [ ] The L4-abort test's checkpoint observation point is synchronised against a parent-written value, so a full-suite run cannot read `events.jsonl` before the checkpoint has been appended.
- [ ] `sentry-poller.js` is unchanged — the production child/parent ordering and best-effort checkpoint semantics are identical to before (verify via diff: no production file in the changeset).

### From WHAT
- [ ] The test waits on the `abort-actioned` log token (via `waitUntil` + `log()`) before reading `events()`.
- [ ] The existing ledger wait at lines 183-187 is byte-identical to before (not moved, not modified).
- [ ] No new test-harness helper is added; `waitUntil`, `events()`, `log()` are reused.

### From HOW (behaviour)
- [ ] The settling wait has its own assertion and message ("poller reached abort-actioned") distinct from the count assertions.
- [ ] The checkpoint assertion is two assertions: `length >= 1` with a "no checkpoint event appended" message, and `length === 1` with a "more than one — per-tick regression" message. A future failure in either direction names its own cause (acceptance criterion 2).
- [ ] `checkpoints[0].data.tripped === true` and the remaining assertions (poller exit, `status.running === false`) are unchanged and still pass.

### From HOW (repeated-run demonstration)
- [ ] The test passes standalone: `node --test test/sentry-poller.test.mjs`.
- [ ] The test passes under repeated full-suite runs — `node --test` from the repo root (`FAFF_REQUIRE_DOCKER=1`) run at least 20 times consecutively, all green (acceptance criterion 3). Record the run count and result in the PR.

**Integration smoke test:**

```
1. From the repo root: run `node --test test/sentry-poller.test.mjs` once → the L4 test at line 174 passes.
2. Loop the FULL suite to reproduce the original load condition:
     for i in 1..20: `node --test` (FAFF_REQUIRE_DOCKER=1) from the repo root
   → every iteration green; the "one sentry-checkpoint event" test never reports length 0.
3. Sanity-check the diagnostic: temporarily stub the checkpoint append to write zero events,
   confirm the failure message reads "no checkpoint event appended" (not the old duplicate-anticipating
   message), then revert the stub.
```

confidence: high
spec-review: approve
