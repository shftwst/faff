# Spec: FAFF-979 — Pin the Commissaire protected-effect decision to a lock-held ledger snapshot (close the request-append/evaluation TOCTOU)

> Spec: faffter-dark-nlspec · 2026-09-05 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-979.

This is the build spec for Linear issue FAFF-979. Its audience is the build agent that will implement the change and the human reviewers who gate it. It specifies how to make the Commissaire request-decision path evaluate its freshness and coverage legs against a ledger snapshot that is transactionally pinned to the request append, closing the time-of-check-to-time-of-use gap identified in the FAFF-828 offline adversarial review and explicitly deferred on FAFF-978.

## 1. WHY — Problem and Principles

**The load-bearing model.** A protected-effect decision is only as trustworthy as the ledger state its legs read. Two of the six legs (5a freshness, 5b coverage) are functions of the whole ledger, not just the request record. Today those legs read the ledger through a *second, separate* lock acquisition that happens after the request append's lock has already been released. The fix is one idea: read the full-ledger snapshot that feeds the legs *inside the same lock instance that appends the request*, so the append and the read the decision depends on are one critical section and nothing can slip between them.

**Problem statement.** In `cmdRequestDecision` (lib/commissaire.js), the producer's request record is appended under the append lock, that lock is released, and then `readLedgerEntries(runDir)` reads the full ledger unlocked and hands it to `evaluateDecisionRequest`. A concurrent append (for example an `observe` for the same issue/step) landing in that unlocked window changes the snapshot the freshness and coverage legs see, so the decision depends on ledger state read outside the lock. This change reads the snapshot inside the append lock instead, so the legs evaluate exactly the ledger as it stood the instant the request was chained.

**Design principle — the decision's inputs must be pinned, not its outputs.** Only the *inputs* to `evaluateDecisionRequest` (the request record plus the full-ledger snapshot the legs scan) must be captured atomically. The verdict append that follows is a distinct, later write and MUST stay a separate lock acquisition. Reject any implementation that tries to hold one lock across the request append, the evaluation, and the verdict append: that widens the critical section for no gain and risks a self-deadlock against the ledger lock.

**Design principle — reuse the one ledger lock, never introduce a second.** The effects ledger has exactly one lock (`declared-effects.jsonl.lock`, via `LEDGER_CFG`). The snapshot MUST be read under that same lock through `withFileLock`. Reject any implementation that opens an independent lock, a second lock file, or an advisory read lock: a second lock path is a new correctness surface and a new deadlock risk.

**Design principle — preserve fail-safe-toward-deny.** The racy legs fail safe: a concurrent observe can only cause a spurious deny, never a spurious grant. Pinning removes the spurious deny for interleaves that land after the request is chained, but it MUST NOT convert any previously-denying honest case into a grant beyond that specific interleave. The pinned snapshot must include the just-appended request record and every record chained at or before it, so freshness and coverage see the same-or-stricter state, never a laxer one.

**Design principle — do not touch the signing legs.** Unforgeability rests on the split-key signing legs (producer HMAC under K_producer, Commissaire Ed25519 under SK), which are unrelated to which snapshot the freshness/coverage legs scan. This change alters *where the entries array comes from*, nothing else. `evaluateDecisionRequest`'s signature and every signing/verification path stay byte-unchanged.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript (Node) | Facade holding `cmdRequestDecision` (the TOCTOU site), `appendProducerRecords`, `readLedgerEntries`, `evaluateDecisionRequest` |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript (Node) | Owns `appendRecordsUnderLock` (the shared lock core) and all ledger IO under `withFileLock` |
| `plugin/skills/faff/bin/lib/fs-lock.js` | JavaScript (Node) | `withFileLock(lockPath, fn, opts)` — the single file-lock primitive to reuse |
| `test/commissaire.test.mjs` | JavaScript (ESM test) | Existing admit->declare->request-decision->observe->reconcile fixtures via `runCom`; the freshness/stale-evidence and FAFF-828 unforgeability fixtures that must stay green |

**Scope statement.** This sits in the Commissaire protected-effect facade (verb 3, request-decision), between the producer's request append and the Commissaire's verdict evaluation; it is a hardening of the read that feeds the legs, not a change to the decision logic or the key model.

## 2. OUT OF SCOPE

- **The verdict append.** What: pinning `appendCommissaireRecord` (the `effect-decision-verdict` write) into the same critical section. Why excluded: the verdict is an output, not a decision input; its correctness does not depend on being co-atomic with the request append (Design principle: inputs, not outputs). Extension point: none needed; it stays a separate `appendRecordsUnderLock` call in `cmdRequestDecision`.
- **Other ledger readers.** What: `cmdReconcile`'s `readLedgerEntries(runDir)` and the `governance-check` re-auth read. Why excluded: they are post-hoc classification/audit reads with no append they must be pinned to, so they have no TOCTOU of this shape. Extension point: if a future verb needs an append-pinned read, it reuses the same snapshot capability added here in `events.js`.
- **The signing / split-key legs.** What: any change to leg 1-4 or the HMAC/Ed25519 signing and verification. Why excluded: unforgeability is out of the racy set; touching it would be scope creep and risk regressing FAFF-828. Extension point: none.
- **Multi-process concurrency test infrastructure.** What: spawning real concurrent OS processes to race the lock. Why excluded: the pinning guarantee is provable deterministically with a single-process interleave seam (see Scenarios); a real race harness is flaky and unnecessary. Extension point: the interleave seam added in HOW can later drive a stress test if one is ever wanted.
- **Changing `readLedgerEntries`' parse semantics.** What: how a ledger line is parsed into an entry. Why excluded: the snapshot must be byte-for-byte the same entries `readLedgerEntries` produces today, just read under the lock. Extension point: the shared parse helper stays the one source of truth.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Pinned snapshot | The full array of parsed ledger entries read inside the append lock, immediately after the request record is appended, including that request record |
| Racy legs | Freshness (leg 5a) and coverage (leg 5b) — the two legs of `evaluateDecisionRequest` whose result is a function of the whole ledger |
| Critical section | The body of a single `withFileLock` acquisition on the effects-ledger lock |
| Interleave window | The span in the current code between the request-append lock release and the unlocked `readLedgerEntries` call, where a concurrent append can change the snapshot |

**The lock core, extended (events.js).** `appendRecordsUnderLock` gains an optional capability to also return the full-ledger snapshot read inside the same lock, after the append, without changing any existing caller.

```
FUNCTION appendRecordsUnderLock(dir, cfg, mintCount, mintOne, opts?):
  opts.withSnapshot: Boolean   # default false — omitted by every existing caller

  RETURNS (default, unchanged):        minted: Array<Record> | null
  RETURNS (when opts.withSnapshot):    { minted: Array<Record> | null, snapshot: Array<Entry> }

  CONSTRAINT the snapshot is read INSIDE the same withFileLock body, AFTER the append write,
             BEFORE the lock releases.
  CONSTRAINT snapshot is null-safe: if minted is null (aborted batch), snapshot reflects the
             on-disk ledger unchanged by this call (no partial write occurred).
  CONSTRAINT existing return shape is preserved byte-for-byte when opts.withSnapshot is falsy.
```

**The producer append, extended (commissaire.js).** `appendProducerRecords` gains a matching pass-through so the request-append path can request the pinned snapshot.

```
FUNCTION appendProducerRecords(runDir, key, producerId, contractRevision, bodies, ts, opts?):
  opts.withSnapshot: Boolean
  WHEN opts.withSnapshot: RETURNS { minted, snapshot }
  ELSE:                   RETURNS minted   # unchanged for every existing caller
```

**The ledger parse, shared.** The snapshot read inside the lock MUST produce entries identical to `readLedgerEntries(runDir)` today. Factor the parse body of `readLedgerEntries` into a pure helper that takes the ledger text (or path) so both the unlocked reader and the in-lock snapshot read share one parser.

```
FUNCTION parseLedgerText(text) -> Array<Entry>
  # split on "\n", drop blank lines, JSON.parse each, drop nulls — the existing body of readLedgerEntries
```

**`evaluateDecisionRequest` — unchanged.** Its signature `(admission, requestRecord, key, ledgerEntries)` stays exactly as-is. Only the *provenance* of `ledgerEntries` changes: the pinned snapshot instead of a fresh unlocked read.

**Design decision (surfaced here, resolved in section 6).** Whether to snapshot inside `appendRecordsUnderLock` via an option (a), or to compose a lock+read helper on the commissaire.js side (b). **Chosen:** option (a) — extend `appendRecordsUnderLock` with an optional `withSnapshot` that returns `{ minted, snapshot }`. Rationale in section 6.

## 4. HOW — Behavior

**Architecture and approach.** `events.js` owns the ledger lock and all ledger IO, so the snapshot read belongs there, guarded behind an opt-in flag that existing callers never pass. Inside the one `withFileLock` body, after the atomic append, the core reads the ledger file it just wrote to and parses it with the shared parser. `appendProducerRecords` threads the flag through. `cmdRequestDecision` calls the request append with `withSnapshot: true`, then evaluates against `snapshot` instead of `readLedgerEntries(runDir)`. The verdict append that follows is untouched, a separate lock acquisition.

**Behavior summary — the request-decision path after the change.** Append the request record under the lock, read the full ledger under that same lock (now including the request), release the lock, evaluate the legs against that pinned snapshot, then append the verdict under a fresh lock.

```
PROCEDURE cmdRequestDecision(flags):
  1. Resolve runDir, producer key, governor material (unchanged).
  2. Build requestBody (effect-decision-request) (unchanged).
  3. { minted, snapshot } = appendProducerRecords(runDir, key, producerId, contractRevision,
                                                  [requestBody], ts, { withSnapshot: true })
     a. requestRecord = minted[0]
     b. snapshot is the full ledger read INSIDE the append lock, AFTER the append,
        so it INCLUDES requestRecord and every record chained at or before it.
  4. key = deriveKey(gov.master_secret, producerId, contractRevision)   (unchanged)
  5. decision = evaluateDecisionRequest(loaded.admission, requestRecord, key, snapshot)
     # snapshot, NOT readLedgerEntries(runDir)
  6. verdictRecord = appendCommissaireRecord(...)   # SEPARATE lock, unchanged
  7. print { verdict, reason, verdict_seq, request_seq }
```

```
PROCEDURE appendRecordsUnderLock(dir, cfg, mintCount, mintOne, opts):
  withFileLock(lockPath, () => {
    ... existing tail-read, mint loop, torn-tail repair, ONE atomic appendFileSync ...
    minted = <as today>
    IF opts?.withSnapshot:
       text = readFileSyncOrEmpty(ledgerPath)          # inside the lock, after the append
       RETURN { minted, snapshot: parseLedgerText(text) }
    RETURN minted                                       # unchanged default path
  }, cfg.lock)
```

**Edge cases and error handling.**

- **Aborted batch (mintOne returns null).** The append writes nothing and `minted` is null. With `withSnapshot`, return `{ minted: null, snapshot: parseLedgerText(<current on-disk ledger>) }`; the snapshot is well-defined (the unchanged ledger) and the caller checks `minted` before using it, exactly as `appendCommissaireRecord` already guards its `written === null`.
- **Empty ledger before the very first append.** `parseLedgerText("")` returns `[]`. After a request append the file is non-empty and the snapshot contains at least the request record. `readFileSyncOrEmpty` treats ENOENT as empty text (the file always exists post-append, so this only matters on the abort path).
- **Snapshot must include the request record.** The read is after `appendFileSync` and inside the lock, so the just-written line is on disk and parsed into the snapshot. This is the behavioural anchor of the coverage/freshness legs seeing the request. Assert it in the fixture.
- **Existing callers unaffected.** `appendCommissaireRecord`, `appendProducerRecords` (declare/observe paths), `appendRecordUnderLock` (events shim), corrective/lights-out mints all call without `opts`, so `opts?.withSnapshot` is falsy and the return shape is unchanged.

**Failure modes.**

- **The failure:** the snapshot is read *before* the append (or outside the lock body), so it excludes the request record or is not truly pinned. How you'd know: the fixture asserting the snapshot contains a record with `kind_of_entry === "effect-decision-request"` fails, or the interleave fixture (below) still flips the verdict. What it means: fix the read position (must be after `appendFileSync`, inside the `withFileLock` closure); do not proceed.
- **The failure:** widening the critical section by folding the verdict append into the same lock, causing a re-entrant acquire on `declared-effects.jsonl.lock`. How you'd know: request-decision hangs or throws `EFFECTS_LOCKED` on the second acquire under budget. What it means: abandon that shape; the verdict append stays a separate acquisition (Out of scope).
- **The failure:** the pinning silently converts an honest deny into a grant beyond the intended interleave (fail-safe regression). How you'd know: the existing `stale-evidence` fixture (test/commissaire.test.mjs ~line 149) flips from deny to grant. What it means: the snapshot is missing pre-request records or the leg logic was touched; revert and narrow — only the read provenance may change.

**Anti-pattern:** reading the snapshot with a fresh `readLedgerEntries(runDir)` call placed just after the append but still outside `withFileLock`. Why: it re-opens the exact interleave window this issue closes; the read must be inside the lock body.

**Anti-pattern:** adding a second lock file or an independent advisory lock for the read. Why: a second lock path is a new deadlock and correctness surface; reuse the one `cfg.lock` via the existing `withFileLock`.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given the same run and interleave seam DISABLED (no injected append)
When request-decision is invoked for a declared, in-scope, fresh effect
Then the verdict is grant with reason all-legs-pass, identical to the pre-change behaviour (pinning is transparent on the no-interleave path)
```

- The pinned snapshot passed to `evaluateDecisionRequest` MUST contain the just-appended request record (an entry with `kind_of_entry === "effect-decision-request"` at the request's seq).
- No existing FAFF-828 unforgeability / split-key fixture changes verdict or reason (the signing legs are byte-unchanged).
- The `stale-evidence` fixture (an observe chained *before* the request, resting the request on older evidence) still denies with reason `stale-evidence` — pinning does not mask a genuinely stale request.

## 6. Design Decision Rationale

**Where does the lock-held snapshot read live: inside `appendRecordsUnderLock` (a), or a commissaire.js-side lock+read composer (b)?**

- **Option (a) — extend `appendRecordsUnderLock` with `opts.withSnapshot` returning `{ minted, snapshot }`.** Pros: the snapshot is read inside the *same* `withFileLock` instance that already owns the append, so pinning is guaranteed by construction; all ledger IO and the one lock stay in `events.js`, their existing home; zero new lock paths; the shared parser keeps snapshot entries identical to `readLedgerEntries`. Cons: touches the shared batch core, so the change must be strictly additive (opt-in flag, default return shape preserved) and every existing caller re-verified.
- **Option (b) — a commissaire.js helper composing its own `withFileLock` + append + full read.** Pros: leaves `events.js` untouched. Cons: needs its own lock acquisition around the append, which either duplicates the append-under-lock logic or nests/relocks the ledger lock — a second lock path, exactly what the constraints forbid; and it splits ledger IO ownership across two files.

**Chosen:** option (a). Rationale: the invariant this issue buys is "the append and the read are one critical section", and (a) makes that a structural property of the single existing lock rather than a composition the caller could get wrong. It honours the reuse-the-one-lock principle directly, keeps ledger IO in `events.js`, and stays additive by gating behind a flag no current caller passes. The cost (touching the shared core) is contained by the default-return-shape-preserved constraint and the existing caller sweep in DONE.

**Should the verdict append be pinned into the same critical section?** Options: (i) pin only the request-append and the snapshot read; (ii) pin request append, read, and verdict append together. **Chosen:** (i). Rationale: only the decision's *inputs* need transactional pinning; the verdict is a later output whose correctness is independent, and pinning it in would widen the section and risk a re-entrant ledger-lock acquire.

**How is the interleave proven without a real OS-level race?** Options: (i) spawn concurrent processes and race the lock; (ii) a single-process test seam that appends to the on-disk ledger in the post-append window. **Chosen:** (ii). Rationale: (i) is inherently flaky and slow; (ii) is deterministic and targets exactly the property under test — that evaluation uses the pinned snapshot, not a re-read of disk. The seam is a legitimate injected test hook (an env-gated interleave callback fired between append and evaluate), not a manual operator workaround.

## 7. Open Questions and Assumptions

**Open Questions.** None. The section-3 design decision and both sub-decisions are closed with `**Chosen:**` markers.

**Assumptions.**

- **Assumes:** `withFileLock(lockPath, fn, opts)` in `fs-lock.js` is non-reentrant on the same lock path within one process (a second acquire while held blocks or fails under the budget rather than silently succeeding). Validation: read `fs-lock.js` (`withFileLock`, ~line 78) and confirm the acquire semantics before relying on the verdict append staying a *separate* acquisition; this assumption only matters to the Out-of-scope decision, not to the chosen change.
- **Assumes:** `readLedgerEntries`' parse body has no side effects and depends only on the ledger text, so it can be factored into `parseLedgerText(text)` and called on the in-lock read. Validation: confirm `readLedgerEntries` (commissaire.js ~line 72) reads the file then splits/parses/filters with no other IO.

## 8. DONE — Definition of Done

### From WHY
- [ ] request-decision's freshness (5a) and coverage (5b) legs evaluate a ledger snapshot read inside the same append lock as the request record (no unlocked `readLedgerEntries(runDir)` feeds `evaluateDecisionRequest` in `cmdRequestDecision`).
- [ ] The verdict append remains a separate lock acquisition (not folded into the request-append critical section).
- [ ] No second lock file or independent lock is introduced; the read reuses the existing `cfg.lock` via `withFileLock`.
- [ ] Fail-safe-toward-deny preserved: no honest case flips deny->grant except the specific post-request interleave the pinning is meant to ignore.

### From WHAT (types and interfaces)
- [ ] `appendRecordsUnderLock(dir, cfg, mintCount, mintOne, opts?)` returns `{ minted, snapshot }` when `opts.withSnapshot` is true, and its existing return value byte-for-byte when it is falsy/omitted.
- [ ] `appendProducerRecords(..., opts?)` threads `withSnapshot` through and returns `{ minted, snapshot }` when set, unchanged otherwise.
- [ ] `evaluateDecisionRequest`'s signature is unchanged; only the source of its `ledgerEntries` argument changed.
- [ ] The ledger parse is shared (a `parseLedgerText`-style helper) so snapshot entries are identical to `readLedgerEntries` output.

### From HOW (behaviour)
- [ ] `cmdRequestDecision` calls the request append with `withSnapshot: true` and passes the returned `snapshot` to `evaluateDecisionRequest`.
- [ ] The snapshot is read inside the `withFileLock` body, after `appendFileSync`, before the lock releases.
- [ ] The pinned snapshot includes the just-appended request record (asserted by test).

### From HOW (edge cases)
- [ ] Abort path: when `minted` is null (mintOne returned null), the call returns `{ minted: null, snapshot }` over an unchanged ledger and the caller guards on `minted` before use.
- [ ] Every existing caller of `appendRecordsUnderLock`/`appendProducerRecords`/`appendRecordUnderLock` (declare, observe, commissaire verdict, events shim, corrective/lights-out mints) is unaffected — verified green.

### From SCENARIOS (fixtures)
- [ ] A fixture proves an append interleaved in the post-request window cannot change the verdict from what the pinned snapshot yields (grant, `all-legs-pass`), via a deterministic single-process interleave seam.
- [ ] The transparent no-interleave path still grants `all-legs-pass`.
- [ ] The existing `stale-evidence` fixture still denies `stale-evidence` (pre-request observe unaffected).
- [ ] All FAFF-828 unforgeability / split-key fixtures stay green (no verdict/reason change).

### Integration smoke test

```
PROCEDURE smoke:
  1. mkRun; admit P1 scope=merge; declare (FAFF-1, merge){merge,main}; observe (FAFF-1, merge){merge,main}
  2. enable interleave seam: after the request record is chained, append one more observe (FAFF-1, merge){merge,main}
  3. run request-decision (FAFF-1, merge){merge,main} with evidence_seq = the declare's seq
  4. ASSERT stdout.verdict == "grant" AND stdout.reason == "all-legs-pass"
  5. ASSERT the entries evaluated (snapshot) contain an effect-decision-request record at request_seq
  6. disable seam; re-run on a fresh run: ASSERT grant/all-legs-pass (transparency)
```

confidence: high
build-tier: complex
