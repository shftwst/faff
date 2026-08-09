# FAFF-574 — Serialise events.jsonl appends: lock-guarded, O(1) seq mint

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-574.

This spec addresses FAFF-574 (duplicate seq from unlocked concurrent appends, plus O(N²) append cost) for the build agent implementing it and human reviewers. It covers the CLI's event-log append path in `plugin/skills/faff/bin/lib/events.js` and the three hand-rolled copies of its seq-minting logic.

## 1. WHY — Problem and Principles

**The load-bearing model:** `seq` is the only trustworthy order in `events.jsonl` — the file header itself says `ts` is best-effort because sandbox clocks are unreliable, and every ordering consumer (audit, disposition, governance-check, quality, sentry) sorts or last-wins by `seq`. Today `seq` is minted by an unlocked read-modify-write: count every line in the file, use the count as the next `seq`, append. Serialising the mint-and-append inside one advisory file lock, and deriving the next `seq` from the file's own tail instead of a full count, makes `seq` unique and monotonic by construction and makes each append O(1) instead of O(file size).

**Problem statement.** The append path was written under a "single writer, race-free by construction" assumption (events.js lines 2–11) that is now false: the detached sentry poller appends `sentry-checkpoint` events from a separate process while the orchestrator appends pipeline events, `contain --record` appends from tidy/prep/build phases, and lights-out mint/resume append run lifecycle events. Two concurrent appends both count N lines and both mint `seq = N`, corrupting the order that sentry's thrash and repeated-failure evaluators, `faff economics`, and the audit reconstruction all consume — and `faff events validate` reports the damage only with an `[advisory]` tag. Separately, counting the whole file per append makes a run's event logging O(N²) in total I/O.

**Design principles:**

- **One mint path.** Every `seq` mint in the codebase goes through one shared, lock-guarded core. The bug exists precisely because the mint logic was copied into three other places (`corrective.js`, two sites in `lights-out.js`); an implementation that fixes `appendEventRecord` but leaves any copy unrouted is wrong.
- **Never mint a duplicate silently.** If the lock cannot be acquired within budget, fail loudly to the caller. A missing event with a named error is recoverable; a duplicate `seq` silently corrupts every downstream ordering consumer.
- **Self-healing, no sidecar state.** The next `seq` derives from the log's own last record. No counter file or lock-resident state that can drift from the log after a crash — the log remains the single source of its own ordering.

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/bin/lib/events.js` | `appendEventRecord` (lines 161–169), `eventLineCount` (146–151), `events validate` seq check (299–301), header comment (2–11) — the core this spec changes |
| `plugin/skills/faff/bin/lib/corrective.js` | `appendCorrectiveEvent` (~275–287) — hand-rolled mint copy, must route through the core |
| `plugin/skills/faff/bin/lib/lights-out.js` | run-start (~919–923) and run-resume (~1021–1025) appends — hand-rolled mint copies, must route through the core |
| `plugin/skills/faff/bin/lib/sentry-poller.js` | line ~262 — in-process `appendEventRecord` caller from a detached background process; the concurrent writer that makes this a live bug |
| `plugin/skills/faff/bin/lib/contain.js` | `contain --record` (~185) — existing `appendEventRecord` caller; its "never a silently-unrecorded verdict" posture shapes error handling |
| `plugin/skills/faff/bin/lib/heartbeat.js` | `atomicWriteLedger` (tmp + rename) — the repo's existing atomic-write precedent; this spec adds the sibling lock-file idiom |
| `plugin/skills/faff/bin/lib/{audit,disposition,governance-check,quality,sentry}.js` | seq-order consumers — unchanged, but they are why duplicates matter |
| `plugin/skills/faff-beep-boop/SKILL.md` line ~399 | Prose still claiming the log is single-writer — must be updated |

**Scope statement.** This is the deepest prerequisite of the tamper-evidence stream: FAFF-564's hash chain and FAFF-568's anchoring both presuppose a well-defined append order, which this change establishes. Tracker note for a human (faff never auto-writes these): add blocker links **FAFF-574 blocks FAFF-564** and **FAFF-574 blocks FAFF-568** — today they are only "related", which understates the dependency.

## 2. OUT OF SCOPE

- **The hash chain itself (FAFF-564) and its anchoring (FAFF-568)** — this change only guarantees the append order they need. Extension point: the serialised critical section already reads the previous record to mint `seq`; FAFF-564 computes each record's chain hash at exactly that point, under the same lock, with no second read.
- **Per-writer event files merged on read** — considered and rejected (see rationale, section 6), not deferred.
- **The `--tokens` ledger checkpoint concurrency** (`run-ledger.json` fresh-read-merge inside `events append`) — a different file with its own already-shipped write discipline (FAFF-408); untouched here.
- **Event schema, phase/type vocabularies, and all readers** — `schema` stays 1; `events read`, audit, sentry, economics are unchanged.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| mint | Computing the next record's `seq` value |
| critical section | The lock-held span: tail-read → mint → append |
| tail window | The fixed number of bytes read from the end of the file to find the last record |
| stale lock | A lock file whose age exceeds the staleness bound — evidence its holder died mid-section |

**The lock.** `<runDir>/events.jsonl.lock`, taken by atomic exclusive create (`fs.openSync(path, "wx")`, closed immediately; the file's *existence* is the lock). Its content is `{pid, ts}` — forensic only, never consulted for the lock decision. Released by `unlink` in a `finally`.

**Tuning constants** (module-level, not config keys — a user has no basis to tune them):

```
RETRY_INTERVAL_MS = 15      # sleep between acquisition attempts (Atomics.wait — dependency-free sync sleep)
ACQUIRE_BUDGET_MS = 2000    # total time to keep trying before failing loudly
STALE_LOCK_MS     = 5000    # lock older than this is a dead holder — take it over (unlink + retry)
TAIL_WINDOW_BYTES = 65536   # bytes read from the file's end to find the last record
```

The critical section is a handful of syscalls (sub-millisecond); `STALE_LOCK_MS` is three orders of magnitude above it, and `ACQUIRE_BUDGET_MS` covers over a hundred contending writers.

**The shared core.** One new internal function owns the critical section:

```
PROCEDURE appendRecordUnderLock(dir, mintRecord):
  # mintRecord(seq, prevRecord) → record-to-append, or null to abort without writing
  1. acquire the lock (retry/stale-takeover per HOW; on budget exhaustion THROW error tagged code "EVENTS_LOCKED")
  2. tail-read the last parseable record → prevRecord (or null); next seq = prevRecord.seq + 1 (or 0)
  3. record = mintRecord(seq, prevRecord); IF null → release lock, return null (aborted, nothing written)
  4. newline-repair if needed, append the record as one write
  5. release the lock (finally)
  6. return record
```

`appendEventRecord(dir, run, payload, ts)` keeps its exact signature and envelope behaviour, reimplemented as a thin wrapper over this core — its existing callers (`events append`, `contain --record`, sentry-poller) need no signature change. The two `lights-out.js` sites and `corrective.js` call the core directly with their own `mintRecord` (lights-out's run-resume record has extra fields built by `runResumeEvent(id, seq, …)`; corrective validates the full record with `eventViolations(record, true)` inside `mintRecord` and returns null on violations, preserving its never-write-malformed guarantee and its `{appended: false, violations}` return shape).

**Error surface per caller** (all existing callers, behaviour on the tagged lock error):

| Caller | On `EVENTS_LOCKED` |
|---|---|
| `faff events append` (CLI) | stderr message naming the lock + budget, exit 1 — loud, mirrors its validation-failure exit |
| `contain --record` | exit 2 with a named message — recording is load-bearing ("never a silently-unrecorded verdict", FAFF-354) |
| sentry-poller | existing best-effort `try/catch` absorbs it (documented as intended — an abort event is a courtesy on top of a ledger write that already landed) |
| `corrective.js` | catch → return `{appended: false, violations: ["events lock: …"]}` — shape preserved |

**`events validate` promotion.** In the per-line seq check (events.js 299–301), split the single `[advisory]` finding into two classes:

- `seq <= previous seq` (duplicate or regression — ordering is broken) → a **hard** finding, message `duplicate/regressed seq (expected > P, got S)`, no `[advisory]` tag.
- `seq > previous seq + 1` (forward gap — order intact, records possibly lost) → stays `[advisory]`, message unchanged in spirit.

Exit semantics are unchanged: any finding (hard or advisory) still exits 1, as today. The promotion is the classification — consumers treating advisory-tagged findings as soft now see ordering corruption as the hard fault it is.

## 4. HOW — Behaviour

**Acquisition.** Loop until `ACQUIRE_BUDGET_MS` is spent: attempt `openSync(lock, "wx")`; on success write `{pid, ts}` and proceed. On `EEXIST`, stat the lock — if its mtime is older than `STALE_LOCK_MS`, unlink it (ignore a racing unlink's ENOENT) and retry immediately; otherwise sleep `RETRY_INTERVAL_MS` via `Atomics.wait` on a throwaway SharedArrayBuffer (the dependency-free synchronous sleep) and retry. On budget exhaustion, throw the tagged error — never fall through to an unlocked append.

**Tail-read mint.** Stat the file (absent or empty → `seq = 0`, `prevRecord = null`). Otherwise read the last `min(size, TAIL_WINDOW_BYTES)` bytes, split into lines, and scan backwards for the last line that parses as JSON with an integer `seq` — that record is `prevRecord`, and the mint is `prevRecord.seq + 1`. A torn or malformed trailing line is skipped (it never held a valid `seq`; `events validate` reports it as a malformed line). If the window contains no parseable record at all (pathological — e.g. a single record larger than the window), fall back to the full-file line count exactly as today: degraded but never wrong-by-race, since it happens under the lock.

**Newline repair.** Before appending, if the file is non-empty and its final byte is not `\n` (a torn write from a crashed holder), prefix the outgoing line with `\n` so the new record never concatenates onto the partial line. The partial line stays in place as a validate-visible malformed line; repair never rewrites existing bytes.

**Append.** Exactly one `appendFileSync` call for the whole line (O_APPEND). Under the lock this is belt-and-braces — no lock-respecting writer can interleave anyway.

**Anti-pattern:** minting `seq` anywhere except the shared core — including "just this once" in a new module. Why: three hand-rolled copies are how the single-writer assumption rotted invisibly.

**Anti-pattern:** catching the lock error and retrying with an unlocked append as a "fallback". Why: the fallback reintroduces the exact race; a loud failure is the designed behaviour.

**Failure modes:**

- **Contention exhaustion under pathological load.** The failure: `ACQUIRE_BUDGET_MS` proves too small for a real workload. How you'd know: `EVENTS_LOCKED` errors in run logs / CLI exit 1s with the lock message. What it means: raise the budget constant — the design is right, the constant is conservative.
- **Stale takeover fires on a live-but-slow holder.** The failure: a holder pauses longer than `STALE_LOCK_MS` between create and append (e.g. the process is stopped by a signal), a peer takes the lock over, both append. How you'd know: `events validate` now hard-fails on the duplicate seq — the promotion in section 3 is the detection net for exactly this residual. What it means: acceptable residual risk; the bound is ~1000× the section length and the corruption is no longer silent.
- **The lock directory lives on a filesystem without atomic exclusive-create semantics** (network mounts). How you'd know: duplicate-seq hard findings despite the lock. What it means: outside the supported envelope — see Assumptions.

## 5. SCENARIOS

Concurrent mint uniqueness (the headline objective):

```
Given an initialised run directory with an empty events.jsonl
When 16 concurrent processes each run `faff events append --run <id>` 5 times with valid payloads
Then all 80 records are present, every line parses, and their seq values are exactly 0..79 with no duplicate
```

Duplicate seq is a hard validate finding:

```
Given an events.jsonl containing two well-formed records that both carry seq 4
When `faff events validate --file <path>` runs
Then it exits non-zero and reports a duplicate/regressed-seq finding that does NOT carry the [advisory] tag
```

Stale-lock recovery:

```
Given a leftover events.jsonl.lock older than the staleness bound and no live holder
When a single append runs
Then it takes over the lock, appends normally with the correct next seq, and leaves no lock file behind
```

Bounded tail read (non-functional):

- The append path reads at most `TAIL_WINDOW_BYTES` of an existing `events.jsonl` regardless of file size (unit-assertable on the tail-read helper with a file larger than the window).
- A forward seq gap alone still validates with the `[advisory]` tag and unchanged exit behaviour (no accidental softening or hardening of gap handling).

## 6. DESIGN DECISION RATIONALE

**How should appends be serialised?** Options: (a) advisory lock file + O(1) tail-read mint in a single shared file; (b) per-writer event files merged on read; (c) sidecar counter file; (d) append first, detect and repair duplicates after. Per-writer files dissolve the write contention but destroy the product: `seq` is per-file, and the only cross-file merge key would be `ts`, which the substrate explicitly distrusts — every sort-by-seq consumer would need a new total order that does not exist. A sidecar counter can drift from the log after a crash between the two writes, violating self-healing. Append-then-detect cannot un-append a landed line. The lock file is dependency-free (`wx` open is atomic on POSIX and Windows), keeps the single-file contract every consumer already reads, and the tail-read removes the O(N²) cost in the same stroke.
**Chosen:** a single shared `events.jsonl`, appends serialised by an advisory lock file, next `seq` minted from the last parseable tail record inside the critical section.

**What happens when the lock cannot be acquired?** Options: fail loudly; silently skip the event; fall back to today's unlocked append. Skipping silently loses governance evidence; falling back reintroduces the race under exactly the contention that makes it fire.
**Chosen:** throw an error tagged `EVENTS_LOCKED` after `ACQUIRE_BUDGET_MS`; each caller surfaces it per its own loudness contract (table in WHAT).

**How hard should `events validate` fail on seq faults?** Options: promote all seq findings to hard; promote only duplicates/regressions; change exit codes so advisory-only logs pass. A forward gap leaves the order intact (something may be lost, nothing is mis-ordered), and softening its exit behaviour would let a truncated log start passing — a regression.
**Chosen:** duplicate/regressed seq becomes a hard (non-advisory) finding; forward gaps keep the `[advisory]` tag; exit semantics unchanged (any finding exits 1).

**Where does crash repair live?** A crashed holder can leave a torn final line without a newline. Rewriting the file to remove it would break append-only.
**Chosen:** newline-repair on the next append (prefix `\n` when the final byte isn't one) plus skip-backwards-to-last-parseable in the mint; torn lines stay visible to `events validate` as malformed-line findings.

**What happens to `eventLineCount`?** It remains exported (public surface of the module, and the in-window fallback uses the same counting) but no production mint site may call it directly for seq any more.
**Chosen:** keep the export; the DONE checklist pins that no mint outside the core survives.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** `.faff/runs/<run-id>` lives on a local filesystem, where `openSync(…, "wx")` exclusive-create is atomic. Validation: the run directory is created under the repo root by run mint and nothing in faff configures it onto a network mount; if that ever changes, the duplicate-seq hard finding in `events validate` is the detection net.

## 8. DONE — Definition of Done

### From WHY (one mint path)
- [ ] `appendRecordUnderLock` (or equivalently named single core) exists in `events.js` and owns lock + tail-mint + newline-repair + append.
- [ ] `corrective.js`'s `appendCorrectiveEvent` and both `lights-out.js` event appends (run-start, run-resume) route through the core; grep shows no `eventLineCount`-based seq mint outside `events.js`.
- [ ] The events.js header comment (lines 2–11) no longer claims single-writer race-freedom; it documents the lock-serialised multi-writer model.
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` (~line 399) no longer describes the log as single-writer; it names the lock-serialised model in one sentence without other prose changes.

### From WHAT (interfaces)
- [ ] `appendEventRecord(dir, run, payload, ts)` signature and returned-record shape unchanged for existing callers.
- [ ] Lock file is `<runDir>/events.jsonl.lock`, taken with `wx`, released in `finally`; content `{pid, ts}` is forensic only.
- [ ] On acquisition budget exhaustion an error tagged `EVENTS_LOCKED` is thrown; `events append` exits 1 with a lock-naming message; `contain --record` exits 2; corrective returns `{appended:false, violations:[…]}`; sentry-poller's existing catch absorbs it.
- [ ] `events validate`: duplicate/regressed seq yields a hard finding without `[advisory]`; forward gaps keep `[advisory]`; any finding still exits 1.

### From HOW (behaviour and edge cases)
- [ ] New integration test (e.g. `test/events-concurrency.test.mjs`): 16 concurrent append processes × 5 events each → 80 parseable records, seq exactly 0..79.
- [ ] Unit test: tail-read helper reads at most `TAIL_WINDOW_BYTES` on a file larger than the window and mints `last.seq + 1`.
- [ ] Unit test: torn final line without newline → next append newline-repairs, mints from last parseable record, and `events validate` reports the torn line as malformed while later records stay well-formed.
- [ ] Unit test: stale lock (mtime older than bound) is taken over; fresh lock is waited on; budget exhaustion throws `EVENTS_LOCKED`.
- [ ] `eventsSelftest` gains rows: duplicate seq → hard, regressed seq → hard, forward gap → advisory (message-class assertions).

### Integration smoke test
```
initialise a run dir; run two shells in parallel, each appending 10 valid events via `faff events append`;
then `faff events validate --file .faff/runs/<id>/events.jsonl` exits 0 and `events read` shows seq 0..19
```

No LLM-judgement seam is introduced or changed — no eval-coverage item.