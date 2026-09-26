# FAFF-1124 — Make the worktree-prune append-failure test deterministic

> Spec: faffter-dark-nlspec · 2026-09-26 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1124.

Follow-up to FAFF-1119 (Slice B). One test in `test/impure/worktree-prune.test.mjs` proves the governed-record bracket is record-only: a declare/observe append failure is logged and the prune proceeds. It forces the append failure with `chmodSync(rd, 0o555)` (make the run dir read-only so the lock file cannot be created). That injection is non-deterministic. Replace it with a uid- and platform-independent one.

## Why the current injection is wrong, not just flaky

The test at `test/impure/worktree-prune.test.mjs:188` does `chmodSync(rd, 0o555)` to make the ledger lock un-creatable, expecting `appendEffectEntries` to throw. Two problems:

- **Root bypasses mode bits.** Under a CI or sandbox uid of 0 (common), `0o555` does not deny writes, so the lock is created, the append succeeds, and the test silently exercises the *success* path while its assertions (prune completes, exit 0, dangling dir removed) still pass. The failure path it claims to cover is not actually covered there.
- **Whole-dir chmod + a restore window perturbs parallel workers.** The chmod is on the shared run dir and is restored in `finally`; under parallel `node --test` that read-only window and its timing are the observed one-off flake (benign filesystem artifact, per the FAFF-1119 build notes).

## What to build and why

The injection must fail the ledger append **without** touching `declared-effects.jsonl` itself, because `admit` writes its schema:3 admission record into that **same** file (`commissaire.js` `LEDGER_CFG.ledgerFile === "declared-effects.jsonl"`), and `hasGovernanceContext` reads it to decide whether the bracket runs. Making that path a directory would throw EEXIST at setup and destroy the governance context, skipping the bracket entirely — the exact silent no-op this ticket exists to kill. So the injection targets the **lock path**, which is where the original chmod failure actually landed ("the ledger lock file cannot be created").

**Chosen:** Force the append failure by pre-creating the lock path `<run-dir>/declared-effects.jsonl.lock` as a **directory** before invoking `worktree-prune`. `appendEffectEntries` → `appendRecordsUnderLock` → `withFileLock(lockPath)` → `acquireFileLock` (`fs-lock.js:43`) opens the lock with `openSync(lockPath, "wx")`, which cannot exclusively-create a file where a directory exists, and cannot take the lock over either (its stale-takeover path `unlinkSync`s the lock, and a directory is unlinkable-as-a-file by no uid, root included) — so acquisition throws deterministically. Rationale: it is a **type**-based failure, not a permission one, so it fires identically for every uid and platform (fixing the root-bypass hole); it leaves `declared-effects.jsonl` an intact readable file, so `hasGovernanceContext` stays true and the bracket genuinely runs and genuinely fails at the append; and it is scoped to this run dir's own lock path, so it cannot perturb a concurrent worker.

**Chosen:** Keep the existing record-only assertions (exit 0, `result.pruned.length === 1`, dangling admin dir removed) **and add a positive proof that the append actually failed**: after the prune, read the declared-effects ledger and assert it holds **zero** schema:2 declare/observe records (only the schema:3 admission record `admit` wrote remains) — reusing the file's existing `readEffectRecords` helper. Rationale (the round-2 QA objection): the existing three assertions are byte-identical on the append-success and append-failure paths, so on their own they cannot tell "failure path exercised, prune proceeded" from "append silently succeeded, prune proceeded" — that is exactly the silent no-op that let the original chmod test pass on the wrong path under root. The zero-records assertion pins the failure path, so if the lock-path convention ever drifts and the injection stops colliding, the append would succeed, a declare/observe record would land, and this assertion fails loudly instead of going green on the wrong path.

**Chosen:** Drop the `chmodSync` calls (both the `0o555` set and the `0o755` restore in `finally`) and the `chmodSync` import if it becomes unused. Teardown removes the lock directory as part of the existing tmp-root teardown; no permission restore is needed. The fresh-vs-backdated-mtime detail (whether acquisition throws immediately via the stale-takeover `unlinkSync`-on-a-directory, or after the ~2s `ACQUIRE_BUDGET_MS` spin) is left to the build — both are deterministic throws; prefer whichever keeps the test fast without coupling fragilely to the lock internals.

**Assumes:** `appendEffectEntries` (`effects.js:523`) writes `declared-effects.jsonl` under the `declared-effects.jsonl.lock` lock via `appendRecordsUnderLock` (`events.js:511`) → `withFileLock` (`fs-lock.js:78`), and `worktree-prune` wraps the declare/observe in try/catch so a throw is logged and the prune proceeds. Verified this prep.

**Assumes:** `admit` writes its schema:3 admission record into `declared-effects.jsonl` (the **same** file the declare/observe append to — `commissaire.js` `LEDGER_CFG`), and `hasGovernanceContext` reads that file, so the injection must leave it intact. This corrects the earlier draft's false assumption and is the reason the injection targets the lock path, not the ledger path. Verified this prep against `commissaire.js`.

**Punt:** None.

## Acceptance criteria

1. The test "a declare/observe append failure does not gate the prune (record-only)" in `test/impure/worktree-prune.test.mjs` no longer uses `chmodSync` to inject the failure; it pre-creates the **lock path** `<run-dir>/declared-effects.jsonl.lock` as a directory instead, leaving `declared-effects.jsonl` an intact file.
2. The governance context is still live at prune time (`hasGovernanceContext` true, so the bracket runs) — verified by the append actually being attempted and failing, not skipped. The test still asserts the record-only behaviour: `worktree-prune` exits 0, `pruned.length === 1`, and the dangling admin dir is removed despite the append failure.
2b. The test **positively proves the append failed**: it asserts the declared-effects ledger holds zero schema:2 declare/observe records after the prune (only the schema:3 admission record remains), via `readEffectRecords`. This distinguishes the exercised failure path from a silent append-success, so a future lock-path drift fails the test loudly rather than passing on the wrong path.
3. The injected failure is genuinely exercised regardless of uid — a comment records that a directory at the lock path is used precisely because a permission chmod is root-bypassable (the bug being fixed) while a type-based lock-creation failure is not.
4. Any now-unused `chmodSync` import is removed; no other test in the file changes.
5. The test passes reliably under `node --test` full parallel runs (the whole suite stays green), and passes in repeated isolated runs.

confidence: high
build-tier: mechanical

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    {"marker": "chosen", "topic": "Force the append failure by pre-creating the lock path as a directory (type-based, uid-independent), not a permission chmod, and not the ledger path"},
    {"marker": "chosen", "topic": "Keep the record-only assertions AND add a positive proof the append failed (zero schema:2 declare/observe records after the prune, via readEffectRecords)"},
    {"marker": "chosen", "topic": "Drop the chmod set/restore and the now-unused import; leave fresh-vs-backdated lock mtime to the build"},
    {"marker": "assumes", "topic": "appendEffectEntries append+lock path and worktree-prune try/catch behaviour"},
    {"marker": "assumes", "topic": "admit writes its schema:3 record into declared-effects.jsonl itself, so the injection must leave that file intact (corrects the earlier draft)"}
  ]
}
```
