# FAFF-621 — Chain declared-effects.jsonl with the same per-line prev-hash mechanism as events.jsonl

> Spec: faffter-dark-nlspec · 2026-08-06 · interactive · confidence: high · spec-review: approve. Full spec on Linear FAFF-621.

_Revised on 2026-08-06 — re-prep supersedes the 2026-08-04 spec. Incorporates the human resolution of the same date: the contested write side flips from per-descriptor locking to **batch-under-one-lock** (one acquisition mints N contiguous records), a batch-capable `appendRecordsUnderLock` core is added with the existing `appendRecordUnderLock` retained byte-unchanged as its N=1 shim, and the 16-writer AC gains a deterministic contiguity oracle. Spec-review (revise→approve) then closed a completeness gap: the shared core has four callers (`appendEventRecord`, corrective.js:289, lights-out.js:988/1114) — the shim keeps all four source-unchanged, and the extraction's green-suite gate now spans their suites too. Read side / gate side / anchor side / schema disposition carried forward from the prior spec._

This spec is for the build agent implementing FAFF-621, and for the human reviewers gating it. It revises the spec attached 2026-08-04, which spec-review rejected across all four lenses. A human has since made the authoritative write-side design decision (2026-08-06); this document rebuilds the spec around that decision. The read side, gate side, anchor side, and schema disposition are carried forward largely unchanged; the write side — locking granularity, the append core's shape, and the concurrency acceptance oracle — is rebuilt.

## 1. WHY — Problem and Principles

**The load-bearing idea.** faff keeps two append-only ledgers under a run dir. `events.jsonl` is already tamper-evident: every line carries `prev`, the SHA-256 of the previous physical line's raw bytes (the first line's `prev` is the SHA-256 of the run_id), and that hash is minted *inside* the same lock that assigns the line's seq, so nobody outside the lock can commit to a line that is no longer last. The second ledger, `declared-effects.jsonl` (the `faff effects declare` / `observe` log), carries no such chain — its records are schema-1, no `prev`. This issue extends the identical mechanism to the effects ledger so that a tampered declared-effect line is detectable byte-for-byte, exactly as a tampered event line is.

**Problem statement.** A declared-effect record — the evidence that a step declared a merge or a deploy before acting — can today be edited or deleted after the fact with nothing to reveal it, because the effects ledger has no per-line chain. FAFF-564 (events chain), FAFF-568 (anchor + verify), and FAFF-574 (locked mint core) all shipped the machinery but explicitly deferred the effects ledger. This change threads that machinery through the effects ledger and its verify/gate/anchor paths.

**Design principles** — the constraints that would make me reject an otherwise-working implementation:

**One chain-walk, never a second home for the hashing rule.** The verifier that re-derives each link already exists inside `verifyChain`. The effects verifier must compose the *same* pure walk, not re-implement the genesis/prev-hash rule. A forked walk is a second place the rule can drift; a foreign auditor re-implementing from the schema must find exactly one canonical description. This is the existing house invariant ("a leg re-reads a verb's substrate; COMPOSES `verifyChain` — never a forked hash-walk") and it now governs the effects side too.

**The hash is minted under the lock, from the same tail read that assigns the seq.** A `prev` computed outside the critical section can commit to a line that a concurrent writer has already superseded; an agent-supplied hash is an untrusted claim inside a trust artifact. Neither is ever accepted. This is why the write side is the delicate part of this issue and why it is what the prior spec got wrong.

**One logical declare/observe is atomic and gap-free.** A single `faff effects declare` or `observe` carries N effect descriptors and must land as N contiguous records or none — both for the existing all-or-nothing validation contract and so the chain over those N records is minted by one writer with no honest interleave. This principle is the direct reason for the chosen locking granularity (§4, write side).

**Absent is not broken.** A run or PR that carries no effects ledger is a clean no-op, never a gating failure — the same disposition `verifyChain` already gives an absent `events.jsonl`. Gating fires only on a *present* ledger whose chain is broken (or whose witness disagrees).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` | Node (CJS) | Home of the write core (`appendRecordUnderLock`, `tailReadState`), the verifier (`verifyChain`), and the witness (`computeChainHead`). The mechanism this issue reuses lives here; the shared-core extraction happens here. |
| `plugin/skills/faff/bin/lib/effects.js` | Node (CJS) | Home of `appendEffectEntries` (the declare/observe append core), `cmdEffects` (the CLI verbs), and `effectsSelftest`. The write side is rewired here; a `verify` verb is added here. |
| `plugin/skills/faff/bin/lib/governance-check.js` | Node (CJS) | Home of `evaluateIntegrityLeg` (the gating integrity leg) and `evaluateRunDir` / `evaluateAnchorDir`. The effects chain is folded into the integrity leg here. |
| `plugin/skills/faff/bin/lib/fs-lock.js` | Node (CJS) | `withFileLock(lockPath, fn, opts)` — the lock-budget primitive both ledgers serialise their appends through. |
| `test/events-chain.test.mjs`, `test/events-concurrency.test.mjs` | Node test | The behaviour-preserving harness for the shared-core extraction, and the pattern the effects concurrency test mirrors. |

**Scope.** This is a tamper-evidence extension of the FAFF-564/568/574 chain to the second ledger — one narrow leg of the governance trust surface, not a new subsystem.

## 2. OUT OF SCOPE

- **The escape-detection semantics.** `computeEscapes` (observed-minus-declared per issue/step) is untouched. The chain is orthogonal to what the records *mean*; adding `prev` and `schema: 2` must not change any escape signal. Extension point: none needed — this section exists to keep the build agent from "improving" the escape logic while in the file.

- **A live tamper *response*.** Detection only. The chain makes tampering visible in verify/governance-check; it never aborts or kills a run. That remains Sentry's job (producer ≠ consumer, per the file's own header). Extension point: the Sentry-side reach is the existing `sentry check --forbidden-side-effect` seam, not this issue.

- **Retro-chaining existing schema-1 effects ledgers.** Historical schema-1 records stay schema-1 and classify as `legacy-unverifiable` (or `mixed` alongside new schema-2 lines) — never a broken FAIL. No migration/rewrite pass. Extension point: if a backfill is ever wanted, it belongs behind a dedicated migration verb, not here.

- **A shared physical lock across the two ledgers.** `events.jsonl` and `declared-effects.jsonl` are distinct files with distinct `.lock` siblings; they serialise independently. Cross-ledger ordering is not a requirement and a combined lock would only add contention. Extension point: none — the seq spaces are per-ledger by construction.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| physical line | The raw bytes of one line in the ledger, exclusive of the terminating `\n`. The chain hashes physical lines, not re-serialised JSON. |
| `prev` | SHA-256 (64 lowercase hex) of the previous physical line's bytes; on the first line, SHA-256 of the record's own `run_id`. |
| genesis | The first line's `prev` basis: `sha256(run_id)`, where `run_id` is the run dir's basename. |
| batch | The N records of one `appendEffectEntries` call (one `declare`/`observe` of N descriptors). Minted atomically under one lock. |
| witness | The `*-chain-head.json` file anchored beside a ledger recording its head hash / line count / schema floor, cross-checked at verify time. |

**The schema-2 effects record.** `declared-effects.jsonl` records bump schema 1 → 2 and gain `prev`. Everything else is byte-identical to today's record.

```
RECORD DeclaredEffect (schema 2):
  schema: 2                       # was 1
  run_id: String                  # run dir basename; genesis hashes THIS
  seq: Integer                    # 0-based, contiguous, monotonic per ledger
  ts: ISO8601 String
  kind_of_entry: "declare" | "observe"
  issue: String
  step: String
  effect: { kind, target, reversible }   # normEffect output, unchanged
  prev: HexString(64)             # NEW: sha256 of prev physical line (genesis: sha256(run_id))

  CONSTRAINT prev matches /^[0-9a-f]{64}$/
  CONSTRAINT within one batch, seqs are contiguous s..s+N-1
```

**The batch-capable append core.** `appendRecordUnderLock(dir, mintRecord)` today mints exactly one record under one lock (events.js:325) and has **four** callers (inventory below). This issue adds a batch-capable core, `appendRecordsUnderLock`, that mints an array of N records under one lock acquisition — one tail read, contiguous seqs, each `prev` computed in sequence. **`appendRecordUnderLock(dir, mintRecord)` is retained byte-unchanged as a thin N=1 shim over the new core**, so every existing caller is byte-identical and needs zero edits. This is the "single-record `events append` is the N=1 case" intent made literal: the shim *is* that case.

```
INTERFACE appendRecordsUnderLock(dir, cfg, mintCount, mintOne):
  dir:       run dir absolute path (genesis hashes basename(dir))
  cfg:       { ledgerFile, lock: { code, label } }   # ledgerFile: "events.jsonl" | "declared-effects.jsonl"
  mintCount: Integer >= 1                             # N
  mintOne(index, seq, prevRecord, prevHash) -> record | null
      # called N times under ONE lock; index 0..N-1, seq threaded s..s+N-1,
      # prevHash threaded (first from tail, then from the just-serialised line),
      # prevRecord threaded (first from tail, then the just-minted record).
      # Returning null from ANY call aborts the WHOLE batch, writing nothing.
  RETURNS: array of the N minted records, or null if aborted

# Retained shim — signature and semantics byte-identical to today (do NOT re-signature it):
appendRecordUnderLock(dir, mintRecord):
  # r = appendRecordsUnderLock(dir, EVENTS_CFG, 1,
  #        (index, seq, prevRecord, prevHash) => mintRecord(seq, prevRecord, prevHash))
  # return r === null ? null : r[0]   # GUARD the unwrap: a batch-of-1 abort returns null, not [null] — never r[0] on null
  # EVENTS_CFG = { ledgerFile: "events.jsonl", lock: { code: "EVENTS_LOCKED", label: "events lock" } }
  # a null mintRecord return aborts (batch of 1 → null) and returns nothing — today's abort path, preserved.
```

**Caller inventory — every existing `appendRecordUnderLock` caller stays byte-unchanged via the shim** (the completeness point spec-review flagged: the shared core has four callers, and the shim is why the extraction touches none of them):

| Caller | Site | Disposition |
|---|---|---|
| `appendEventRecord` | events.js:377 | unchanged — calls the shim (N=1) |
| corrective mint | corrective.js:289 | unchanged — calls the shim; its `null`-return-aborts path is preserved by the shim |
| run-start mint | lights-out.js:988 | unchanged — calls the shim |
| run-resume mint | lights-out.js:1114 | unchanged — calls the shim |

Only `appendEffectEntries` calls the batch core directly (`cfg` = declared-effects.jsonl / `EFFECTS_LOCKED`, `mintCount` = `effects.length`). The public wrappers keep their signatures:

```
appendEventRecord(dir, run, payload, ts)                         # N=1 via the shim; output byte-identical to today
appendEffectEntries(runDirAbsPath, kindOfEntry, issue, step, effects, ts)   # N = effects.length, batch core
```

**Design decision — write-side locking granularity (the central one).**

The prior spec routed `appendEffectEntries` through the locked core by acquiring the lock *per descriptor* inside the batch loop. Spec-review rejected it on two grounds: the lock releases between descriptors, so an honest concurrent writer legitimately interleaves and breaks the chain from real traffic (which desensitises the exact tamper signal the chain exists to give), and the "gap-free seq 0..N-1 under concurrent writers" criterion had no deterministic oracle — you could not assert contiguity when honest interleave was allowed to scramble it.

| Option | Chain integrity under honest concurrency | Concurrency AC oracle |
|---|---|---|
| Lock per descriptor (prior spec) | Honest writers interleave between descriptors → chain forks from legitimate traffic | None — contiguity not assertable when interleave is legal |
| One lock for the whole batch | Each batch is atomic → no honest interleave; only tampering breaks the chain | Deterministic — each batch's seqs are contiguous by construction |

**Chosen:** one lock for the whole `appendEffectEntries` batch. A single `withFileLock` acquisition does one tail read, then mints all N records with contiguous seqs `s..s+N-1`, computing each line's `prev` in sequence under that one lock — the first from the tail's last physical line, each subsequent from the line just serialised in this batch. Rationale: it keeps one logical declare/observe atomic and gap-free, which (a) gives the concurrency criterion a deterministic oracle — 16 concurrent batches each land contiguously, so the union is a gap-free 0..total-1 chain with no honest interleave to reason around — and (b) means only *tampering* can break the chain, preserving the tamper signal. It does not fork the chain-walk: the shared verifier is untouched, and single-record `events append` is simply the N=1 call of this same primitive.

**Design decision — shared core vs copy.**

| Option | Drift risk | Cost |
|---|---|---|
| Copy the hash-walk / mint logic into effects.js | Two homes for the genesis/prev rule — they drift | Low up front, high forever |
| Extract `walkPhysicalChain` + generalise `appendRecordsUnderLock`, effects composes both | One home each | One behaviour-preserving refactor first |

**Chosen:** extract, never copy. Pull the pure physical-chain walk out of `verifyChain` into `walkPhysicalChain(buf)`, and generalise the single-record mint into the batch-capable `appendRecordsUnderLock`. Both ledgers' verifiers compose the one walk; both ledgers' appenders drive the one mint core. The effects lock uses its own descriptor (`{ code: "EFFECTS_LOCKED", label: "effects lock" }`) against `declared-effects.jsonl.lock`, mirroring the events descriptor — same primitive, distinct file.

**Design decision — schema bump and legacy disposition.**

**Chosen:** mirror events exactly. Effects records become `schema: 2` carrying `prev`. Pre-existing schema-1 records classify as `legacy-unverifiable` (a whole-file legacy log) or `mixed` (schema-1 and schema-2 lines coexisting — the chained ones verify, the prev-less ones are content-unverifiable but still feed the next link's hash). Neither is a broken FAIL; both gate only under `--legacy-policy fail`, exactly as on the events side. Rationale: the effects ledger predates the chain, so the same graceful-degradation path events uses for its own history is required, not a new policy.

## 4. HOW — Behavior

The work is four connected changes plus one refactor that lands first. The refactor extracts the two shared cores with the events suites green; then the effects write side, read side, gate side, and anchor side wire onto them.

**Build ordering (the sequencing rider — non-negotiable).** Land the shared-core extraction — `walkPhysicalChain` pulled out of `verifyChain`, and the batch-capable `appendRecordsUnderLock` added with `appendRecordUnderLock` retained as its N=1 shim (so `appendEventRecord`, the corrective mint at corrective.js:289, and both lights-out mints at lights-out.js:988/1114 are byte-unchanged) — as a **behaviour-preserving increment**, with the existing `events-chain`, `events-concurrency`, `corrective`, `corrective-integrity`, `lights-out`, and `lights-out-resume` suites all green, **before** any effects wiring. Every current mint path must be byte-identical after the refactor (same records, same verify verdicts) with zero effects code present. Only then wire effects on top. This keeps the risky refactor isolated from the new feature: if any of those suites goes red, it is the extraction, not the effects work. (The widened suite set is because the shared core has four callers, not one — the shim keeps them source-unchanged, and these suites prove it.)

### Write side — `appendEffectEntries` through the batch core

Behaviour summary: validate every descriptor first (unchanged all-or-nothing), then mint all N as schema-2 chained records under one lock.

```
PROCEDURE appendEffectEntries(runDirAbsPath, kindOfEntry, issue, step, effects, ts):
  1. Validate every descriptor (effectDescriptorViolations). If any fail:
     return { violations } — write nothing.       # unchanged, still pre-lock
  2. runId = basename(runDirAbsPath)
  3. records = appendRecordsUnderLock(
         runDirAbsPath,
         { ledgerFile: "declared-effects.jsonl", lock: { code: "EFFECTS_LOCKED", label: "effects lock" } },
         effects.length,
         (index, seq, _prevRecord, prevHash) ->
            { schema: 2, run_id: runId, seq, ts: ts || nowISO(),
              kind_of_entry: kindOfEntry, issue, step,
              effect: normEffect(effects[index]), prev: prevHash })
  4. return { written: records }
```

```
PROCEDURE appendRecordsUnderLock(dir, cfg, mintCount, mintOne):   # generalises events.js:325; appendRecordUnderLock is the N=1 shim over this
  ledgerPath = join(dir, cfg.ledgerFile);  lockPath = ledgerPath + ".lock"
  WITHIN withFileLock(lockPath, cfg.lock):
    { seq, prevRecord, prevLineBuf } = tailReadState(ledgerPath)   # ONE tail read
    prevHash = prevLineBuf == null ? sha256(basename(dir)) : sha256(prevLineBuf)   # genesis or link
    minted = []
    FOR index in 0..mintCount-1:
      rec = mintOne(index, seq + index, prevRecord, prevHash)
      IF rec == null: return null            # abort WHOLE batch — nothing written
      ASSERT rec.seq == seq + index AND rec.prev == prevHash   # belt against minter drift
      minted.push(rec)
      prevRecord = rec
      prevHash   = sha256(utf8Bytes(JSON.stringify(rec)))   # next link = THIS serialised line's bytes
    # torn-tail repair applies ONCE, before the first record (crashed prior holder)
    prefix = (file nonempty AND last byte != '\n') ? "\n" : ""
    appendFileSync(ledgerPath, prefix + minted.map(JSON.stringify).join("\n") + "\n")   # ONE atomic append
    return minted
```

Two invariants the pseudocode encodes and the build must preserve: the within-batch `prev` hashes the exact bytes that will be written (`utf8Bytes(JSON.stringify(rec))`), which are byte-identical to the physical line the verifier will later re-hash; and the torn-tail `\n` prefix is applied once at batch head only — the records inside the batch are newline-joined by this same writer, so no torn tail exists between them.

**Anti-pattern:** acquiring the lock per descriptor inside the batch (the prior spec's approach). Why: the lock releases between descriptors, so an honest concurrent writer interleaves its own records mid-batch — breaking the chain from legitimate traffic and destroying any deterministic contiguity oracle. The whole point of the chosen design is that one batch = one lock = one atomic, gap-free run of seqs.

**Anti-pattern:** computing any `prev` from a re-read of the file, or outside the lock. Why: the hash must commit to the tail as seen under the lock that assigned the seq; a re-read can see a line a later writer superseded. Within a batch, the next `prev` comes from the in-memory serialised bytes, never a re-read.

### Read side — `walkPhysicalChain` + a sibling `faff effects verify`

Extract the pure physical-chain walk out of `verifyChain` into `walkPhysicalChain(buf)` — split into physical lines, parse pass (record / honest torn tail / mid-file malformed), and the genesis/prev walk that classifies `verified` / `broken` / `legacy-unverifiable` / `mixed`. It returns the primitives (`status`, `line_count`, `head_sha256`, `schema_floor`, `first_break`, `torn_tail`, and whether any/no records carry `prev`). It knows nothing about witnesses or ledger folds — those are the caller's to layer on.

- `verifyChain(dir, opts)` becomes: `walkPhysicalChain` + its existing `chain-head.json` witness cross-check + its existing `run-ledger.json` fold. **Behaviour must be byte-identical** — same statuses, same details, same exit codes. The events run-ledger fold stays events-only (the effects ledger has no run-ledger).
- `verifyEffectsChain(dir, opts)` (new): `walkPhysicalChain` over `declared-effects.jsonl` + an `effects-chain-head.json` witness cross-check. No ledger fold. Same status vocabulary, same `verifyExitCode` mapping.

A sibling `faff effects verify` verb surfaces `verifyEffectsChain` on the CLI, mirroring `faff events verify` (accepting `--run` / `--legacy-policy`, reusing `verifyExitCode`). Absent `declared-effects.jsonl` → `verified` ("nothing to verify"), exit 0.

**Design decision — sibling verb vs extend `events verify`.** **Chosen:** a sibling `faff effects verify` composing the shared walk, not an overload of `events verify`. Rationale: the two ledgers are distinct artifacts with distinct witnesses; a sibling keeps each verb's substrate obvious and mirrors the existing `declare`/`observe`/`check` surface, while the shared `walkPhysicalChain` still guarantees one hashing rule.

### Gate side — fold `verifyEffectsChain` into the integrity leg

`evaluateIntegrityLeg` today runs `verifyChain` only. Extend it to run `verifyEffectsChain` as well and pass only if both pass; classification and `--legacy-policy` handling are identical for both. An absent effects ledger → `verified` → never gates (mirrors the absent-events no-op). The leg already folds into `evaluateRunDir`'s `pass` and `evaluateAnchorDir`'s `pass`, so no change is needed at those call sites beyond the leg now also reflecting the effects verdict.

Under `requireWitness` (anchor evaluation only): a *present* effects ledger with no `effects-chain-head.json` beside it is `witness-absent` — fail-closed, exactly as a present events log with no `chain-head.json` is. A bare run dir carries no witness by design and is unaffected.

**Design decision — one leg vs a new leg.** **Chosen:** fold into the existing `evaluateIntegrityLeg` rather than add a separate effects-integrity leg. Rationale: both are "re-hash the committed chain and confirm it"; one leg keeps the renderers, reasons, and `pass` fold unchanged and reflects the single integrity gate.

### Anchor side — byte-copy + a sibling witness

`faff events anchor` today byte-copies `events.jsonl` + `run-ledger.json` and writes a CLI-computed `chain-head.json`. Extend it so that when `declared-effects.jsonl` is present in the run dir, the anchor also byte-copies it and writes an `effects-chain-head.json` witness computed via `computeChainHead(effectsBuf, run_id, issue)` (the witness function is already ledger-agnostic — it takes a buffer). The head hash is computed by the CLI, never accepted from a caller. When the effects ledger is absent, nothing is copied and no effects witness is written — and the gate's `requireWitness` fail-closed then does not fire (witness-absent applies only when the ledger is present).

**Failure modes.**

- **The failure:** the within-batch `prev` is computed from a *re-serialisation* that isn't byte-identical to the appended line (e.g. key ordering or whitespace differs). **How you'd know:** `verifyEffectsChain` reports `broken` at line 2 of any multi-descriptor batch even with zero tampering — the concurrency test fails immediately. **What it means:** the mint core must hash the exact `JSON.stringify(rec)` UTF-8 bytes it appends; fix before proceeding.
- **The failure:** the extraction changes events behaviour subtly (a torn-tail or mixed-log detail string moves). **How you'd know:** `events-chain` / `events-concurrency` suites go red on the refactor commit, before any effects code exists. **What it means:** the extraction is not yet behaviour-preserving — narrow to exact byte-for-byte parity before wiring effects.
- **The failure:** the concurrency AC passes only because the test never actually contends (all batches serialise trivially). **How you'd know:** a single-writer run and a 16-writer run produce identical seq layouts with no lock-wait ever observed. **What it means:** the test isn't exercising contention — force overlap (many writers, multi-descriptor batches) so the oracle proves atomicity, not just correctness under no load.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir whose declared-effects.jsonl has N schema-2 chained records
When a byte in a middle record is edited in place
Then faff effects verify reports `broken` with the first-break line/seq
And governance-check's integrity leg fails the run (pass = false)
```

```
Given a run dir with a valid schema-2 declared-effects.jsonl and no other ledger
When faff effects verify runs
Then it reports `verified` and exits 0
And an absent declared-effects.jsonl also reports `verified` (nothing to verify), exit 0
```

```
Given 16 concurrent appendEffectEntries batches, each of 2+ descriptors, against one ledger
When they all complete
Then the union of records has contiguous seqs 0..total-1 with no gaps or duplicates
And every batch's own records are contiguous (no honest interleave split a batch)
And walkPhysicalChain over the result reports `verified`
```

```
Given a declared-effects.jsonl mixing legacy schema-1 lines and new schema-2 lines
When faff effects verify runs under --legacy-policy warn
Then it reports `mixed` and exits 0 with a loud note
And under --legacy-policy fail it exits 1
```

```
Given a per-PR anchor dir produced from a run carrying a declared-effects.jsonl
When faff events anchor runs
Then the anchor contains a byte-identical declared-effects.jsonl and an effects-chain-head.json
And evaluateAnchorDir fails closed (witness-absent) if the effects ledger is present but its witness was deleted
```

- The events-chain, events-concurrency, corrective, corrective-integrity, lights-out, and lights-out-resume suites remain green after the shared-core extraction, with no effects code present.

## 6. Design Decision Rationale

**Write-side locking granularity — per-descriptor lock vs one lock per batch?**
Per-descriptor (prior spec): lock released between descriptors → honest concurrent writers interleave mid-batch → chain breaks from legitimate traffic and the contiguity criterion has no deterministic oracle. Rejected by spec-review across all four lenses. One lock per batch: one acquisition, one tail read, contiguous seqs, prev threaded under the lock. **Chosen:** one lock per batch — atomic, gap-free, tamper-only breakage, and the N=1 case is exactly today's `events append`.

**Share the core or copy it?** Copying the genesis/prev rule into effects.js gives two homes that drift. **Chosen:** extract `walkPhysicalChain` and generalise `appendRecordsUnderLock`; both ledgers compose the one walk and drive the one mint core.

**Schema disposition for pre-existing effects records.** **Chosen:** mirror events — schema-2 going forward, `legacy-unverifiable` / `mixed` for history, gated only under `--legacy-policy fail`. No backfill.

**Read surface — extend `events verify` or add `effects verify`?** **Chosen:** a sibling `faff effects verify` composing the shared walk, matching the existing effects verb surface and keeping each verb's substrate explicit.

**Gate wiring — one leg or two?** **Chosen:** fold `verifyEffectsChain` into the existing `evaluateIntegrityLeg` (pass iff both chains pass), keeping renderers and the `pass` fold unchanged.

**Anchor witness — shared or sibling file?** **Chosen:** a separate `effects-chain-head.json`, computed by the CLI via the already-ledger-agnostic `computeChainHead`, written only when the effects ledger is present.

Temporal anchor: at the time of writing, `walkPhysicalChain` does not exist — the pure walk is inline in `verifyChain` (events.js ~480–547); this issue is what extracts it.

## 7. Open Questions and Assumptions

**Open Questions:** none. The write-side decision the prior spec left contested is resolved (human decision, 2026-08-06) and captured above as the chosen batch-under-one-lock design.

**Assumptions:** none beyond the confirmed code ground truth. Validation for the build agent before starting: confirm `tailReadState` takes a path and returns `{ seq, prevRecord, prevLineBuf }` (events.js ~266), `appendRecordUnderLock` is single-record with a hardcoded `events.jsonl` + `EVENTS_LOCKED` (events.js ~325), and `computeChainHead` takes a buffer (events.js ~600). If any diverges, re-derive the affected core before wiring.

## 8. DONE — Definition of Done

### From WHY
- [ ] A tampered (edited or deleted) line in a present `declared-effects.jsonl` is detectable byte-for-byte, the same way a tampered `events.jsonl` line is.
- [ ] An absent effects ledger is a clean no-op in verify and in governance-check (never a gating failure).

### From WHAT (types and schema)
- [ ] `declared-effects.jsonl` records are `schema: 2` and carry a `prev` matching `/^[0-9a-f]{64}$/`; all other fields byte-identical to today.
- [ ] `appendRecordsUnderLock(dir, cfg, mintCount, mintOne)` mints an array of N records under one lock with contiguous seqs `s..s+N-1`; `appendRecordUnderLock(dir, mintRecord)` is retained as the N=1 shim over it (signature + null-abort semantics byte-identical), so `appendEventRecord` (events.js:377), the corrective mint (corrective.js:289), and both lights-out mints (lights-out.js:988/1114) are byte-unchanged with no edits.
- [ ] `effectsSelftest`'s append assertions are updated for schema-2 + `prev` (first seq 0, gap-free across calls, all-or-nothing preserved).

### From HOW (write side)
- [ ] `appendEffectEntries` validates all descriptors pre-lock, then mints all N schema-2 records under one `withFileLock` acquisition; its public signature `(runDirAbsPath, kindOfEntry, issue, step, effects, ts)` is unchanged.
- [ ] merge-gate's `appendEffectEntries(runDir, "observe", issue, "merge", effects)` call still compiles and behaves (5-arg, ts-defaulted).
- [ ] Within a batch, record 0's `prev` is `sha256(run_id)` (empty ledger) or `sha256(last physical line)`; each later record's `prev` is `sha256` of the exact serialised bytes of the prior batch record.
- [ ] A `null` return from any mint aborts the whole batch, writing nothing.

### From HOW (read side)
- [ ] `walkPhysicalChain(buf)` is extracted as a pure function; `verifyChain` composes it and remains byte-identical (statuses, details, exit codes) with `events-chain` / `events-concurrency` green.
- [ ] `verifyEffectsChain(dir, opts)` composes `walkPhysicalChain` over `declared-effects.jsonl` + an `effects-chain-head.json` witness cross-check, no run-ledger fold.
- [ ] `faff effects verify` surfaces it (accepts `--run` / `--legacy-policy`, uses `verifyExitCode`); absent ledger → `verified`, exit 0.

### From HOW (gate side)
- [ ] `evaluateIntegrityLeg` runs both `verifyChain` and `verifyEffectsChain` and passes iff both pass; `--legacy-policy` handling identical for both.
- [ ] A broken effects chain fails `evaluateRunDir` (`pass = … && integrity.pass`).
- [ ] Under `requireWitness`, a present effects ledger with no `effects-chain-head.json` is `witness-absent` fail-closed; an absent ledger is unaffected.

### From HOW (anchor side)
- [ ] `faff events anchor` byte-copies `declared-effects.jsonl` (when present) and writes a CLI-computed `effects-chain-head.json`; nothing written when the ledger is absent.

### From tests
- [ ] A new effects-chain test asserts genesis, per-line prev, tamper → `broken`, and legacy/mixed classification.
- [ ] A new effects-concurrency test asserts the 16-writer contiguous-seq + `verified` oracle with genuine contention.
- [ ] The events-chain, events-concurrency, corrective, corrective-integrity, lights-out, and lights-out-resume suites all pass unchanged after the extraction commit, before any effects wiring (all four callers of the shared core are gated, not just the events path).

**Integration smoke test:**

```
1. init a run dir; faff effects declare 3 descriptors, then observe 2 → declared-effects.jsonl has 5 schema-2 lines, seqs 0..4
2. faff effects verify --run <id>            → verified, exit 0
3. flip one byte in line 3; faff effects verify → broken at line 3, exit 1
4. restore; faff events anchor → dest        → declared-effects.jsonl + effects-chain-head.json present
5. governance-check the run dir              → integrity leg pass; delete effects-chain-head.json from the anchor and re-check → witness-absent fail
```

## Methodology critique

_Agile-delivery lens (`faffter-dark-methodology-agile-delivery`), advisory — surfaced for review, does not gate a high-confidence spec._

**Right-sizing (principle 4).** Five moving parts — the shared-core extraction, the batch-through-lock write side, the `faff effects verify` verb, the governance-check fold, and the anchor+witness — but they converge on one deliverable (tamper-evidence on the second ledger) and none ships standalone value, so this is a merge-correct 1–3 day unit, not a split. The sequencing rider (land the extraction behaviour-preserving with the events suites green, then wire effects) is the right internal seam — it isolates the one genuinely risky change (touching the shipped events chain) behind a green gate without fragmenting the ticket.

**Workstream fit (principles 1 + 5).** No issues. A single cohesive outcome sitting alongside its FAFF-564/568/574 siblings under the verifiable-delivery outcome.

**Surfaced deps (principle 6).** The three prerequisites (564/568/574) are named and Done; build-time deps are honest and satisfied. FAFF-623 is carried as related-only and introduces no edge to act on here.

**Risk profile (principle 7).** One unknown worth pulling forward, and the spec already pulls it: the shared-core extraction reaches into the already-shipped, already-anchored events chain, where a silent regression weakens tamper-evidence on the live ledger. The de-risking move — the sequencing rider's behaviour-preserving refactor with the events suites green before any effects wiring — is named as non-negotiable, which is the correct call. The schema 1→2 `mixed`-walk is the second surprise surface and the test list names it explicitly.

Nothing here blocks prep — the spec is high-confidence, the contested design is resolved, and the prerequisites are shipped.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
