# FAFF-1281: Take the run-ledger lock around bundle-recover's ledger restore

> Spec: faffter-dark-nlspec · 2026-10-15 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1281.

This spec is for the build agent and reviewers of FAFF-1281. It closes the one run-ledger write that FAFF-1258's shared serialiser left outside the ledger lock: the `faff bundle-recover` restore.

## 1. WHY

**Load-bearing model.** `faff bundle-recover` restores a run directory from a verified Phase 0 bundle. Its safety rests on one decision: "is there already a `run-ledger.json` here, and if so is it the same run?" Today that decision and the writes that follow happen with no lock, so two recoveries can both decide "absent" and both write. The fix is to make the decision and the restore writes one critical section under the same advisory lock every other ledger writer holds (`<runDir>/run-ledger.json.lock`).

**Problem.** `bundleRecover` (`plugin/skills/faff/bin/lib/bundle-recover.js`) reads `run-ledger.json` with `existsSync`/`readFileSync`, computes `idempotencyDecision`, and on `absent` calls `reconstructProjection`, which writes the ledger bytes, the anchor files, `events.jsonl` and `landing-progress.json`, then upgrades a legacy snapshot. Two concurrent recoveries for the same run can both pass the check; the second overwrites the first's ledger and `events.jsonl`, and if either reconstruction fails its cleanup (`rmSync(realRunDir, { recursive: true })`) deletes the directory the other just restored.

**Design principles.**

- **One lock, one definition.** The restore takes the exact lock `mutateLedgerUnderLock` takes. The lock path is defined once in `heartbeat.js` and both callers use that definition; a second hand-built `run-ledger.json.lock` string is the drift FAFF-575 warned against.
- **The restore stays a byte copy.** The ledger is written as the snapshot's exact bytes, not re-serialised, so `idempotencyDecision`'s byte comparison keeps working. Only the legacy upgrade goes through the serialiser, as today.
- **Never nest the ledger lock.** `withFileLock` is not re-entrant. The legacy upgrade (`mutateLedgerUnderLock`) runs after the restore lock is released, never inside it.
- **Fail closed under contention.** Lock-budget exhaustion refuses the recovery; it never falls back to an unlocked write.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `bin/lib/bundle-recover.js` (`bundleRecover`, `reconstructProjection`, `upgradeRestored`) | JS | The racing check-then-write |
| `bin/lib/heartbeat.js` (`mutateLedgerUnderLock`) | JS | Owns the ledger lock path and the serialiser |
| `bin/lib/fs-lock.js` (`withFileLock`) | JS | Shared lock mechanics: `wx` create, 2 s budget, 5 s stale takeover, throws tagged error |
| `bin/lib/shared-infra.js` (`latestRunDir`) | JS | Ignores run directories with no `run-ledger.json` |
| `test/bundle-recover-upgrade.test.mjs` | JS test | `bundleFixture()` builds a published bundle plus a fresh root |
| `test/run-ledger-writer-inventory.test.mjs` | JS test | Static pin: only `reconstructProjection` in `bundle-recover.js` writes the ledger |

**Scope.** A locking fix inside the bundle-recover verb, plus one small export from `heartbeat.js`. No contract, schema or CLI-surface change.

## 2. OUT OF SCOPE

- **Locking `writeRunState` (build-progress and landing-progress).** Why excluded: see the settled decision in section 6; no concurrent writer of the same file exists today, and it would need a different lock (per file), not the run-ledger lock. Extension point: `writeRunState` in `bin/lib/effects.js`, wrapping its read and write in `withFileLock(file + ".lock", …)`.
- **The mint path leaving a run directory after a refused mint.** Why excluded: that is FAFF-1280, prepped in parallel. Extension point: `run-ledger.js` init verbs. This spec does not touch `run-ledger.js` or any mint.
- **The orchestrator session's own direct ledger edits.** Why excluded: the out-of-scope residual already recorded in `heartbeat.js`'s writer inventory (ADR-0077 territory). Extension point: a locked `faff` op for those edits.
- **Racing a recovery against `faff lights-out --resume` or other writers.** Why excluded: those writers already hold the ledger lock; once the restore holds it too, they serialise with no extra work. No new handling.

## 3. WHAT

**Vocabulary.**

| Term | Meaning |
|---|---|
| Restore section | The locked span: read the ledger, decide `absent`/`match`/`conflict`, and on `absent` write every restored file |
| Ledger lock | `<runDir>/run-ledger.json.lock`, the advisory lock file `mutateLedgerUnderLock` holds |

**New export from `heartbeat.js`.**

```
FUNCTION ledgerLockPath(runDir) -> string        # path.join(runDir, "run-ledger.json.lock")
FUNCTION withLedgerLock(runDir, fn) -> fn()'s result
  # withFileLock(ledgerLockPath(runDir), fn, { code: "LEDGER_LOCKED", label: "ledger lock" })
  # mutateLedgerUnderLock is refactored to call withLedgerLock; behaviour unchanged
```

**Chosen:** export `withLedgerLock` from `heartbeat.js` and have `mutateLedgerUnderLock` use it. One definition of the path, code and label serves both writers.

**Shared interface named for FAFF-1280.** FAFF-1280 may also touch ledger locking around the mint. The interface this spec adds and FAFF-1280 may use is `withLedgerLock(runDir, fn)` / `ledgerLockPath(runDir)`, with `mutateLedgerUnderLock`'s signature and behaviour unchanged. If FAFF-1280 lands first with an equivalent helper, the builder reuses it instead of adding a second.

**`bundle-recover.js` shape after the change.**

```
FUNCTION validateProjection(identity, memberBytes) -> { anchors files, eventsKey }   # PURE; throws on bad JSON,
                                                                                     # unsafe path or missing events
FUNCTION reconstructProjection(targetRoot, identity, memberBytes)                    # writes only; NO upgrade call
FUNCTION upgradeRestored(runDir, issueDir)                                           # unchanged entry point; ledger
                                                                                     # mutate becomes a no-op on a stamped ledger
```

The recovery disposition contract (`contract-defs.js`, `recovery-disposition`) is unchanged: the dispositions stay `reconstructed`, `noop-already-present` and `refused`.

## 4. HOW

**Summary.** Move the existence check inside the ledger lock, write the restore inside the same lock, release, then run the legacy upgrade and the resume preview outside it.

```
PROCEDURE bundleRecover (real path, not --dry-run), after a CLEAN bundle is chosen and its members fetched:
  1. validated := validateProjection(identity, memberBytes)        # before any disk write; on throw → refused,
                                                                   # nothing created (today's escape-refusal guarantee)
  2. TRY mkdir -p realRunDir                                       # the lock file lives inside it
     ON throw: section := { decision: "failed", error }; skip to step 4
  3. TRY section := withLedgerLock(realRunDir, () =>
       a. existing := read run-ledger.json bytes, or null when absent
       b. decision := idempotencyDecision(existing, memberBytes.ledger_snapshot)
       c. IF decision == "absent":
            TRY reconstructProjection(resolvedRoot, identity, memberBytes)
            ON throw: remove ONLY the paths this call wrote: run-ledger.json, events.jsonl,
                      <run_id>/<boundary_key>/landing-progress.json (and that issue dir if it is now empty),
                      and the anchor dir (.faff/anchors/<run_id>[/<boundary_key>]);
                      return { decision: "failed", error }
       d. return { decision, existingStamped: hasSchemaVersion(existing) when existing != null })
     ON LEDGER_LOCKED: section := { decision: "locked" }
     ON acquire error ENOENT (another recovery's step 4 removed the empty run dir between steps 2 and 3):
        ONE retry of the pair "step 2 then step 3", with a fresh withLedgerLock call (and so a fresh 2 s
        budget); an ENOENT on that retry is { decision: "failed", error }
  4. IF section.decision in { "locked", "failed" }: rmdir realRunDir only if it is empty
     (best-effort, ignore errors; never a recursive delete, so pre-existing files in the run dir survive)
  5. ROUTE:
       "conflict" → refused, reason unchanged ("a different run-ledger.json already exists … write-once")
       "locked"   → refused, reason "the run-ledger lock at <realRunDir> is held by another writer; nothing restored"
       "failed"   → refused, reason "reconstruction failed: <message>" (unchanged wording)
       "match"    → IF NOT existingStamped: upgradeRestored(...); preview; noop-already-present (unchanged)
       "absent"   → upgradeRestored(...); preview; reconstructed (unchanged)
```

```
PROCEDURE bundleRecover --dry-run:
  unchanged: read the real ledger without the lock (read-only; it writes nothing to the real root),
  reconstruct into the scratch root, then call upgradeRestored on the scratch run dir (the call that
  used to live inside reconstructProjection), then preview.
```

**Upgrade idempotency.** Two recoveries can both reach the upgrade (one via `absent`, one via an unstamped `match`). `upgradeRestored`'s ledger mutate changes from `(fresh) => fresh` to `(fresh) => (fresh && "schema_version" in fresh) ? null : fresh`, so the second one is a null-mutate abort: no write, no extra `ledger-write` event. The existing stamped-ledger branch (validate and warn on violations, outside any lock) stays as it is, so single-recovery stderr is unchanged. The landing-progress upgrade may run twice; both runs write the same stamped bytes from the same restored input, so the result is identical.

**Lock ordering.** The restore section takes the ledger lock and never the events lock (it copies `events.jsonl` as bytes; nothing appends). The upgrade runs after release and takes ledger then events through `mutateLedgerUnderLock`, the existing order. No new ordering is introduced.

**Critical-section length.** The section reads one file, compares bytes and writes the restored files: local disk only, no git, no subprocess, no network. Bundle discovery, verification and member fetch (which can call git) stay before step 1. Anchors are small JSON-carried files, so the section stays well under `STALE_LOCK_MS` (5 s).

**Anti-pattern:** calling `mutateLedgerUnderLock` or `upgradeRestored` inside `withLedgerLock`. Why: the lock is not re-entrant; the inner acquire waits out the 2 s budget and throws `LEDGER_LOCKED`.

**Anti-pattern:** writing the restored ledger through `mutateLedgerUnderLock(() => snapshot)`. Why: the serialiser re-serialises and stamps, so a stamped snapshot would no longer be byte-identical and the second recovery's `match` check would depend on `isStampedUpgradeOf` for every snapshot, changing a byte-copy guarantee FAFF-1258 kept on purpose.

**Anti-pattern:** keeping `rmSync(realRunDir, { recursive: true })` as the failure cleanup. Why: it deletes the lock file mid-section and, under a race, a directory another recovery restored.

**Edge cases.**

- A recovery's run dir exists with no ledger (a previous failed attempt left an empty dir): decision `absent`, restore proceeds.
- The lock is stale (holder died): `fs-lock.js` takes it over after 5 s; no special handling.
- An unstamped `match` whose upgrade fails: unchanged; the warning prints and the next recovery finishes it.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a published bundle for FAFF-1 and a fresh root with no run directory
When two `faff bundle-recover --issue FAFF-1 --root <fresh>` processes start at the same time
Then exactly one reports "reconstructed" and the other "noop-already-present", both exit 0,
  run-ledger.json equals the snapshot (or its stamped upgrade), and events.jsonl carries exactly one
  upgrade ledger-write event for a legacy snapshot
```

```
Given the ledger lock file for the target run dir is held for longer than the 2 s acquire budget
When one recovery runs
Then it reports "refused" with a lock-held reason, exits 1, and writes no run-ledger.json
```

- A single recovery's disposition, exit code, restored files and stderr are unchanged from today for every existing test fixture.

## 6. DESIGN DECISION RATIONALE

**Which lock guards the restore?**
- The ledger lock (`run-ledger.json.lock`): serialises the restore with every other ledger writer.
- An exclusive create of `run-ledger.json` itself (`wx`): no lock, but the restore writes several files and the ledger would be visible before `events.jsonl`, and it would not serialise with `mutateLedgerUnderLock` writers.
- A new recovery-only lock: does not serialise with other ledger writers.

**Chosen:** the ledger lock, via a shared `withLedgerLock` export. The ticket asks for the serialiser's lock, and it is the only one that orders the restore against every writer.

**Where does the legacy upgrade run?**
- Inside the lock: deadlocks (non-re-entrant lock).
- After release, made idempotent: a concurrent second upgrade becomes a no-op.

**Chosen:** after release, with the stamped-ledger null-mutate guard.

**How does a failed reconstruction clean up?**
- Today's recursive delete of the run dir: unsafe under a race.
- Remove only the restored entries under the lock, then a best-effort `rmdir` of an empty run dir after release, with a one-time retry when a concurrent acquire hits `ENOENT`.

**Chosen:** the second. It keeps "refuse rather than leave a half-written directory" and never deletes another recovery's restore. An empty run dir left by a lost `rmdir` race is harmless: `latestRunDir` and the resume readers skip directories with no `run-ledger.json`.

**Does `writeRunState` take a lock too (the ticket's open question)?**
- Fold a lock into `writeRunState` here.
- Leave it out and record the extension point.

**Chosen:** leave it out. The code settles it:
- `build-progress write` replaces the whole record (`buildProgressApplyComplete` ignores `existing`; the read only feeds the schema diff), so there is no lost update to prevent.
- `landing-progress record-fix-cycle` is a real read-modify-write, but its only caller is graft's landing loop for one issue in one run (`faff-graft/SKILL.md`, `record_failed_cycle`), so no second writer of the same file runs concurrently.
- The bundle-recover landing upgrade writes the same stamped bytes from the same input in every racing recovery.
- It is a different file, so it would need its own lock, not the run-ledger lock this ticket is about.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions.** None.

**Assumes:** the run directory lives on a local filesystem where `open(..., "wx")` is atomic, the same assumption `fs-lock.js` and both existing lock consumers record. Validation: none needed beyond the existing lock tests passing.

**Assumes:** FAFF-1258 is merged on main (`mutateLedgerUnderLock` is the serialiser and `upgradeRestored` exists). Validation: `grep -n upgradeRestored plugin/skills/faff/bin/lib/bundle-recover.js` returns the function.

## 8. DONE

### From WHY
- [ ] Two concurrent recoveries of the same bundle into a fresh root end with exactly one `reconstructed` and one `noop-already-present`, both exit 0.

### From WHAT
- [ ] `heartbeat.js` exports `ledgerLockPath` and `withLedgerLock`; `mutateLedgerUnderLock` acquires through `withLedgerLock`; `faff heartbeat --selftest` and the ledger tests pass unchanged.
- [ ] `bundle-recover.js` contains no hand-built `run-ledger.json.lock` string.
- [ ] The static writer-inventory test still finds `reconstructProjection` as the only ledger writer in `bundle-recover.js`, and a new static check asserts `bundleRecover` calls `withLedgerLock`.

### From HOW
- [ ] The existence read and `idempotencyDecision` run inside `withLedgerLock`; the restore writes run inside the same call.
- [ ] `upgradeRestored` is never called while the ledger lock is held; its ledger mutate returns null on a stamped ledger.
- [ ] A held lock past the budget yields `refused` with the lock-held reason, exit 1, and no `run-ledger.json` written.
- [ ] A reconstruction failure removes only the paths this call wrote and the anchor dir, never deletes the lock file inside the section, and leaves the run dir removed when it is then empty; a file that was in the run dir before the recovery survives.
- [ ] A `mkdir` failure on the run dir yields `refused` ("reconstruction failed: …"), exit 1, never an uncaught exit 2.
- [ ] An `ENOENT` on lock acquisition retries "mkdir then lock" exactly once with a fresh budget; a second `ENOENT` yields `refused`.
- [ ] Validation of the anchors member (JSON, safe paths, events key) runs before the run dir is created; the existing escape-refusal selftest still passes.
- [ ] `--dry-run` output and its "writes nothing to the real root" test are unchanged.

### From HOW (edge cases)
- [ ] With a legacy snapshot, two concurrent recoveries leave exactly one upgrade `ledger-write` event in `events.jsonl`.
- [ ] A run dir that exists with no `run-ledger.json` restores as `reconstructed`.
- [ ] Every existing test in `test/bundle-recover.test.mjs`, `test/bundle-recover-upgrade.test.mjs`, `test/phase-0-matrix.test.mjs` and `faff bundle-recover --selftest` passes unchanged (single-recovery behaviour as before).

**Integration smoke test.**

```
fx := bundleFixture()                                   # legacy snapshot
create <fresh>/.faff/runs/<runId>/run-ledger.json.lock  # hold the lock so both recoveries contend
spawn recovery A and recovery B asynchronously
after 250 ms, delete the lock file
await both; assert dispositions sort to ["noop-already-present", "reconstructed"], both exit 0
assert ledger has schema_version 1 and count(ledger-write events added by the upgrade) == 1
```

The pre-held lock raises the odds of real contention. The assertions hold however the two processes interleave once each is in its acquire loop. The timing bounds are explicit: each waiter's 2 s budget starts after the lock already exists, so a 250 ms hold leaves more than 1.7 s of margin before a waiter would refuse, and stays far below the 5 s stale-takeover bound, so no waiter can take the held lock over. The lock-held scenario (budget exhaustion) is a separate test that holds the lock for the whole run and then removes it.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** No issues. One verb, one helper export and two tests; a 1 to 2 day unit. The `writeRunState` question is settled out of scope rather than folded in, which keeps it one concern.
- **Workstream fit? (principles 1 and 5)** No issues. It is a FAFF-1255 child that finishes FAFF-1258's "every ledger write under one lock" outcome.
- **Deps surfaced? (principle 6)** FAFF-1258 is Done and already linked as related, so no blocker is needed. FAFF-1280 shares the `heartbeat.js` ledger-lock helper, not a hard dependency; whichever lands second reuses the other's helper. No link added.
- **Risk profile? (principle 7)** Low. The one risk, a flaky concurrency test, is handled by asserting an interleaving-independent invariant rather than a timing.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
