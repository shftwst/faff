# ADR 0081 — events.jsonl appends serialised by an advisory lock file; seq minted from the log's own tail inside the critical section

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-22
- **Issue:** FAFF-574

## Context

`events.jsonl` is the run's authoritative ordered ledger, and `seq` — not `ts` — is its only trustworthy total order: the file header records that timestamps are best-effort because sandbox clocks are unreliable, and every ordering consumer (audit, disposition, governance-check, quality, sentry) sorts or last-wins by `seq`. The original append path was written under a "single writer, race-free by construction" assumption. That assumption is now false. The detached sentry poller appends `sentry-checkpoint` events from a separate process, `contain --record` appends from tidy/prep/build phases, and lights-out mint/resume append run-lifecycle events — all to the same file, concurrently. Because `seq` was minted by an unlocked read-modify-write (count every line, use the count as the next `seq`, append), two concurrent appends both count N and both mint `seq = N`, corrupting the order that sentry's thrash and repeated-failure evaluators and `faff economics` depend on. The damage was surfaced only with an `[advisory]` tag by `faff events validate`, so it was soft-reported at best. Separately, counting the whole file per append made a run's event logging O(N²) in total I/O. This decision is also the deepest prerequisite of the tamper-evidence stream (FAFF-564's hash chain, FAFF-568's anchoring), both of which presuppose a well-defined append order.

## Decision

Serialise the whole mint-and-append span inside one advisory file lock, and derive the next `seq` from the file's own tail rather than a full line count.

- **The lock is an advisory lock file** at `<runDir>/events.jsonl.lock`, taken by atomic exclusive create (`fs.openSync(path, "wx")` — atomic on POSIX and Windows); the file's *existence* is the lock, its `{pid, ts}` content is forensic only, and it is released by `unlink` in a `finally`. A single shared `events.jsonl` is kept — the single-file contract every consumer already reads is preserved.
- **One mint path.** A single internal core (`appendRecordUnderLock`) owns lock acquisition, tail-read mint, newline-repair, and append. `appendEventRecord` becomes a thin wrapper over it, and the three previously hand-rolled mint copies (`corrective.js`, two sites in `lights-out.js`) route through the same core. No production site mints `seq` from `eventLineCount` any more.
- **The next `seq` is minted from the last parseable record** in a bounded tail window (`TAIL_WINDOW_BYTES`), scanning backwards past torn/malformed trailing lines; an empty/absent file yields `seq = 0`. A pathological window with no parseable record falls back to the full-file count — but under the lock, so it is degraded, never wrong-by-race.
- **Failure is loud, never silent.** If the lock cannot be acquired within `ACQUIRE_BUDGET_MS`, the core throws an error tagged `EVENTS_LOCKED`; each caller surfaces it per its own loudness contract. There is deliberately no unlocked-append fallback — that would reintroduce the exact race under the contention that triggers it.
- **Self-healing, no sidecar state.** The order lives only in the log's own records; no counter file or lock-resident state can drift from the log after a crash. A crashed holder's torn final line is repaired on the next append (prefix `\n`), never by rewriting existing bytes.
- **Duplicate/regressed `seq` is promoted to a hard `events validate` finding** (no `[advisory]` tag); forward gaps stay advisory; exit semantics are unchanged (any finding still exits 1). This is the detection net for the one residual — a stale-lock takeover firing on a live-but-slow holder.

## Consequences

- Every current and future `events.jsonl` writer is serialised by construction; the single-writer assumption is formally retired, and the header comment and `faff-beep-boop` prose are updated to describe the lock-serialised multi-writer model.
- Append cost drops from O(file size) to O(1) per append (bounded tail read), removing the O(N²) run-level I/O.
- FAFF-564 and FAFF-568 gain the well-defined append order they require: the serialised critical section already reads the previous record to mint `seq`, so the hash chain can compute each record's chain hash at that same point, under the same lock, with no second read.
- A new failure surface exists: callers must handle `EVENTS_LOCKED`. This is intentional — a named, recoverable "event not recorded" is strictly safer than a silent duplicate that corrupts every downstream ordering consumer.
- The design assumes `.faff/runs/<run-id>` lives on a local filesystem with atomic exclusive-create semantics. On a network mount without those semantics the guarantee weakens, but the promoted duplicate-seq hard finding remains the detection net.
- Rejected alternatives: per-writer event files merged on read (destroys the single cross-consumer `seq` total order — the only merge key would be the distrusted `ts`); a sidecar counter file (can drift from the log after a crash between the two writes); append-then-detect-and-repair (cannot un-append a landed line).
