# ADR 0083 — Run-ledger mutations serialised by a per-file advisory lock; epoch fence checked inside the critical section; lock mechanics in one shared helper

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-22
- **Issue:** FAFF-575

## Context

`run-ledger.json` is a single JSON snapshot mutated by read-merge-write from four genuinely concurrent actors: the orchestrator session, the detached sentry poller (abort marks), any `faff events append --tokens` caller (checkpoint advance), and a fresh-session `lights-out --resume` (takeover). The write path was built under a single-active-writer assumption the shipped N-writer reality has decayed, leaving three live exposures: the owner-epoch fence (introduced for resume-takeover safety) re-read the owner block then wrote with no serialisation, so two writers could both pass it and the last silently won; the ledger write primitive used a fixed `.tmp` sibling path — the exact two-concurrent-writers ENOENT rename crash the same file documents and already fixes for heartbeat files with unique tmp names; and the token-checkpoint advance did an unfenced whole-object read-merge-write on a comment claiming the orchestrator was the single writer of the budget block. The sibling decision covering `events.jsonl` (the record that appends are serialised by an advisory lock file, with `seq` minted inside the critical section) settled advisory lock files as the run-dir serialisation idiom; leaving its acquisition loop private to the events module would invite the same constants-copy drift that let the events-side single-writer assumption rot invisibly.

## Decision

Serialise every production run-ledger mutation inside one advisory-lock-guarded critical section, keep the owner-epoch fence and check it inside that section, and home the lock mechanics in one shared helper both run-dir lock consumers use.

- **The lock is `<runDir>/run-ledger.json.lock`** — per-file, not per-run-dir, so the event-append hot path is never coupled to ledger contention. Mechanics are identical to the events lock: atomic exclusive create (`wx`; the file's existence is the lock), `{pid, ts}` forensic content, release by `unlink` in a `finally`, stale takeover past the bound, budgeted retry, loud tagged failure (`LEDGER_LOCKED`) with no unlocked-write fallback.
- **One shared helper.** The acquisition loop and tuning constants live in `bin/lib/fs-lock.js` (`withFileLock(lockPath, fn)` + the constants); the events-append core and the ledger core both consume it. A second copy of either is the drift vector this extraction retires.
- **One mutation core.** `mutateLedgerUnderLock(runDir, mutate, expectedOwner?)` in heartbeat.js owns the critical section: fresh read → fence check → pure `mutate` transform → unique-tmp atomic write. The `mutate`-callback shape makes it impossible to hand the core a ledger object derived from a stale earlier read. All five production writers — sentry abort, `events --tokens`, `budget baseline`, lights-out mint and `--resume` — route through it; the pre-built-object fenced write it supersedes is deleted.
- **The fence survives, relocated.** The lock and the fence guard different failures: the lock serialises concurrent writers; the fence makes a superseded owner (an older epoch after a resume takeover) yield even when it is the only writer running. The pure fence predicate is byte-identical; only its call site moved inside the lock, which is what closes its check-then-write gap.
- **Unique tmp names, rename-only durability.** The write primitive reuses the heartbeat files' per-call-unique tmp idiom (pid + random suffix), and the rename-only (no fsync) posture is now stated at the primitive: the ledger is re-derivable bookkeeping, and a power loss costs at most the latest rename.

## Consequences

- Every current and future CLI-side ledger writer is serialised by construction; the single-writer assumption is formally retired, and the writer inventory (with the rule that a new writer must route through the core) is recorded at the core's definition so the next writer added has one place to find it.
- The fence's permitted overlap — two writers both passing, then both writing — is structurally gone; a superseded owner still yields under the lock, so resume-takeover safety is preserved without a CAS.
- Callers gain a named failure surface: `LEDGER_LOCKED` on acquisition-budget exhaustion, surfaced per each caller's own loudness contract (abort exits 1 loudly; token metering degrades to an honest estimate; baseline reports `ledger-locked` and exits 0; resume refuses retryably). This is intentional — a named "not written" is strictly safer than a silent lost update.
- The shared helper constrains later slices: any new run-dir state file that needs write serialisation consumes `fs-lock.js` rather than hand-rolling a loop or copying constants.
- The residual is bounded and known: a stale-lock takeover can fire on a live-but-signal-stopped holder (the bound sits ~1000× above the sub-millisecond section), and the orchestrator session's own ledger edits (`admitted` appends, outcome writes — file edits by the driving session, not CLI calls) remain outside this lock's reach; that write-authority seam is the two-class run-artifact decision's territory and stays an un-ticketed follow-up.
