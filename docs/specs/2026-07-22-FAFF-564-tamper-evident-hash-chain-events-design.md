# FAFF-564 — Tamper-evident hash chain over events.jsonl, with ledger mutations folded in

> Spec: faffter-dark-nlspec · 2026-07-22 · autonomous · confidence: high. Full spec on Linear FAFF-564.

This spec addresses FAFF-564 (post-hoc falsification of the run record is undefended) for the build agent implementing it and human reviewers. It implements the chain-writing half of `docs/rfc/rfc-governance-tamper-evidence.md`: every `events.jsonl` record carries the SHA-256 of the previous line, and every `run-ledger.json` write is folded into that chain as a `ledger-write` event. Anchoring the chain head and verifying it are FAFF-568, not this ticket.

## 1. WHY — Problem and Principles

**The load-bearing model:** each `events.jsonl` line gains one envelope field, `prev` — the SHA-256 of the raw bytes of the line above it (genesis: the SHA-256 of the `run_id`). Because every line commits to the exact bytes of its predecessor, editing or reordering any line breaks the hash of every line after it — detectable by any verifier that re-hashes the file, with no key material and no canonical-JSON spec. The mutable `run-ledger.json` joins the chain indirectly: every ledger write also appends a `ledger-write` event carrying the SHA-256 of the post-write ledger bytes, so the ledger's *history* becomes chain-anchored while the ledger itself stays mutable by design.

**Problem statement.** `events.jsonl` is append-only by convention only — any process with filesystem access can edit or truncate it undetectably, and `run-ledger.json` can be rewritten after the fact with no trace at all. The 2026-07 governance landscape report names a tamper-evident audit trail as the one property nobody has shipped; the digest bracket (FAFF-518/520) covers tampering during a dispatch window but not post-hoc falsification of the whole record. This change makes the record-as-written verifiable against the record-as-audited.

**Design principles:**

- **Evidence, never prevention.** The claim is "detectable", never "impossible". A dishonest writer, and whole-chain rewrite without an external anchor, are explicitly out of the threat model (the RFC's threat-model section); do not add machinery that pretends otherwise.
- **One bump, not two.** The RFC's five-step sequencing exists so the event schema bumps to 2 exactly once — `prev` and the `ledger-write` fold land together in this change. Shipping them as two schema bumps is wrong even if each half works.
- **The chain rides the lock.** FAFF-574 serialises appends and reads the log's tail inside a locked critical section. The chain hash is computed at exactly that point, under the same lock, with no second read. A chain computed outside the critical section can hash a line that is no longer the last one.
- **Hash raw bytes, not parsed JSON.** Verification must be byte-exact and trivial for a foreign implementer working from the schema alone. No canonicalisation, ever.

**Reference context:**

| System | Relevance |
|---|---|
| `docs/rfc/rfc-governance-tamper-evidence.md` | The committed design this implements (proposal steps 1–2 of its sequencing table) |
| `plugin/skills/faff/bin/lib/events.js` | The envelope owner; after FAFF-574, the single lock-guarded append core all writers route through — where `prev` is minted |
| `plugin/skills/faff/bin/lib/heartbeat.js` | `atomicWriteLedger` (line ~163) + `atomicWriteLedgerFenced` (~203) — the chokepoint every CLI-side ledger write already routes through (events.js `--tokens` checkpoint, budget baseline, lights-out mint/resume, sentry abort); where the `ledger-write` fold hooks in |
| `plugin/skills/faff/bin/lib/governance-profile.js` | `DELIVERY_PROFILE.event_types` (~line 64) — the closed vocabulary the new `ledger-write` type joins |
| `plugin/skills/faff/bin/lib/corrective.js`, `lights-out.js` | Event writers that route through the shared core after FAFF-574; their `mintRecord` callbacks receive the chain hash from the core |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | FAFF-518's evidence bracket: `events.jsonl` is verified prefix-preserving (a legitimate append is not tampering), so chain appends compose with the dispatch bracket unchanged |
| `plugin/skills/faff-beep-boop/SKILL.md` (Run ledger section) | The prose-layer ledger writes (`admitted` appends, `outcomes`, `stop_reason`, owner close) that need the note rule below |

**Scope statement.** This is step 1 of the RFC's gap-closure sequencing: it must land before FAFF-568 (anchor + verify) and before any Layer A schema publication, and it builds directly on FAFF-574's serialised append order.

## 2. OUT OF SCOPE

- **Anchoring and verification (FAFF-568)** — committing the chain head into the PR-branch artifact set and re-hashing it as a new `governance-check` integrity leg (plus `faff events verify`). Excluded because it is the follow-on ticket by design. Extension point: a new leg module beside the existing legs in `governance-check.js`, reading the chain this change writes; nothing here needs re-touching.
- **Chaining `declared-effects.jsonl`** — the RFC's open question about the second append-only ledger (read by `merge-gate.js`). Excluded because the ticket scopes the chain to `events.jsonl` plus ledger mutations, and the same per-file `prev` mechanism extends to it additively later without a schema bump to *events*. Extension point: the same envelope treatment in whatever module owns that file's writes. This is un-ticketed follow-up work — tracker note for a human: file it or fold it into FAFF-568's scope.
- **Per-record writer signatures** — keys defend writer identity, hashes don't. The RFC marks this YAGNI until the writer set widens; nothing here forecloses it.
- **Freezing or write-gating `run-ledger.json`** — mutability is by design; history capture is the fix.
- **Retrofitting chains onto existing schema-1 logs** — a fabricated chain over old records is worse than an honest absence. FAFF-568 owns the `legacy-unverifiable` reporting policy.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| chain link | One physical line of `events.jsonl`; every line is a link, parseable or not |
| `prev` | Envelope field on a schema-2 record: 64 lowercase hex chars, the SHA-256 of the previous line's raw bytes |
| genesis | The first line of the file; its `prev` is the SHA-256 of the UTF-8 bytes of the record's own `run_id` |
| `ledger-write` event | A run-phase event recording that `run-ledger.json` was written, carrying the post-write file hash |
| ledger note | The prose-layer act of appending a `ledger-write` event after a direct (hand-edited) ledger write |

**The schema-2 envelope.** `appendRecordUnderLock` (FAFF-574's core) stamps every new record:

```
RECORD RunEvent (schema 2):
  schema: 2                   # was 1; bumped once, here
  run_id: String              # unchanged
  seq: Integer                # unchanged — minted from the last parseable record (FAFF-574)
  ts: String                  # unchanged — best-effort annotation
  prev: String                # NEW — 64 lowercase hex; SHA-256 of the previous line's
                              # raw bytes (exclusive of its terminating newline);
                              # genesis: SHA-256 of the UTF-8 bytes of run_id
  phase / type / issue / data # unchanged (payload)
```

The chain is over **physical lines**, not parseable records: a record's `prev` hashes whatever line precedes it — a well-formed record, a torn partial line, or a legacy schema-1 line — so no line escapes the chain. (`seq` still mints from the last *parseable* record per FAFF-574; the two reads share the same tail window and lock.)

**The `ledger-write` event.** New type in `DELIVERY_PROFILE.event_types`: phase `run`, not issue-scoped, `data: { ledger_sha256: <64 lowercase hex> }` — the SHA-256 of the exact `run-ledger.json` bytes just written. The hash is CLI-computed, never caller-supplied:

- **CLI-side writers** (all of them route through `atomicWriteLedger` / the fenced wrapper): after the rename lands, `atomicWriteLedger` itself appends the `ledger-write` event via the shared locked core — hash of the bytes it just wrote, `run_id` from `ledger.run_id` (fallback: the run-dir basename, matching corrective.js's convention). One chokepoint, no per-caller emissions.
- **Prose-layer writers** (the beep-boop orchestrator's direct edits: `admitted` appends, `outcomes`, `stop_reason`, the owner close): after any direct ledger edit, the orchestrator runs `echo '{"phase":"run","type":"ledger-write"}' | faff events append --run <run-id>` — and `events append`, seeing type `ledger-write`, computes `data.ledger_sha256` from the on-disk ledger bytes itself, overwriting anything the caller supplied. The agent never computes a hash.

**Validator changes (`eventViolations`, envelope mode):**

- `schema` must be 1 or 2 (was: exactly 1).
- schema 2 → `prev` required and must match `^[0-9a-f]{64}$`.
- schema 1 → `prev` must be absent (a legacy record never carries one).
- type `ledger-write` → `data.ledger_sha256` required, same 64-hex shape — **envelope mode only**: the field is CLI-owned and injected before append (like the rest of the envelope), so a payload-mode note command (`{"phase":"run","type":"ledger-write"}`, no data) must validate clean pre-injection.
- `events validate`'s success message no longer hardcodes "(schema 1)".
- `events validate` stays **shape-only**: it never re-hashes the chain — link verification is FAFF-568's integrity leg, not validate's job.

**Core signature change.** FAFF-574's `mintRecord(seq, prevRecord)` callback gains the chain hash: `mintRecord(seq, prevRecord, prevHash)` — the core computes `prevHash` inside the critical section and every minter (the `appendEventRecord` wrapper, corrective's validating minter, lights-out's run-start/run-resume minters) stamps `schema: 2, prev: prevHash` into the record it returns. The core asserts the returned record carries the `seq` and `prev` it supplied (belt against a minter drifting).

## 4. HOW — Behaviour

**Chain mint (inside the critical section).** Extending FAFF-574's tail-read, which already reads the last `TAIL_WINDOW_BYTES` under the lock:

```
PROCEDURE mint chain hash (under the events.jsonl lock):
  1. IF the file is absent or empty → prevHash = SHA256(utf8(run_id))   # genesis
  2. ELSE identify the previous line's raw bytes: everything after the last
     newline that precedes end-of-file (for a file ending in "\n", the last
     complete line; for a torn file, the trailing partial segment)
  3. IF that line's start lies outside the tail window → extend the read
     backwards in chunks until the preceding newline (or file start) is found.
     The hash needs the exact full bytes — unlike seq, there is NO counting
     fallback that can substitute
  4. prevHash = SHA256(those bytes, exclusive of the terminating newline)
  5. hand (seq, prevRecord, prevHash) to mintRecord; append as one write
```

A torn final line is hashed as-is: FAFF-574's newline repair makes it a complete physical line the moment the next record lands, so the bytes the writer hashed are exactly the bytes a verifier will later split out — write-side and verify-side agree by construction.

**Ledger fold ordering.** In `atomicWriteLedger`: write tmp → rename → append the `ledger-write` event. The `--tokens` path in `events append` therefore emits two events per tagged append — the `ledger-write` for its checkpoint advance, then the tagged payload event — in that order, each a normal chain link.

**If the `ledger-write` append itself fails** (for example, the FAFF-574 lock budget is exhausted): warn loudly on stderr and return normally — never throw, never roll back the ledger write. The ledger write is load-bearing for callers (sentry abort, lights-out mint) whose semantics must not break on an events-side failure; the missing link is precisely what FAFF-568's verifier reports as an unrecorded ledger write. The system fails toward detection, not toward blocking the write.

**Module cycle.** `events.js` already requires `heartbeat.js` (for `atomicWriteLedger`); the hook makes `heartbeat.js` need the append core back. Resolve with a call-time (lazy) require inside `atomicWriteLedger`, not a top-level import — the design point is that the fold lives at the chokepoint; the require mechanics are the implementer's.

**Mixed-schema transition.** A log written partly at schema 1 (a run in flight when this ships, or a stale CLI process appending mid-deploy) then continued at schema 2 is legal at the write side: the first schema-2 record's `prev` hashes the preceding schema-1 line like any other link. The chain is verifiable from that record forward; how a partial chain is reported is FAFF-568's policy. `events validate` accepts both schemas per-record, so mixed logs stay shape-valid.

**Anti-pattern:** computing `prev` (or `ledger_sha256`) anywhere except the locked core / the `atomicWriteLedger` hook — including accepting an agent-supplied hash. Why: an unlocked hash can commit to a line that is no longer last; an agent-computed hash is an untrusted claim in a trust artifact.

**Anti-pattern:** canonicalising, reformatting, or re-serialising existing lines anywhere in the write path. Why: the chain commits to raw bytes; any "helpful" rewrite is indistinguishable from tampering.

**Failure modes:**

- **Tail truncation alone is not self-detectable.** Deleting the last k lines and appending yields a locally consistent chain — only the anchored head (FAFF-568) catches it. How you'd know the limit is real: the RFC's threat model says so; this spec claims mid-log edit/reorder detection only. What it means: honest scope — never present this change alone as full tamper evidence.
- **Byte-touching tooling becomes a false-positive source.** An editor or git filter that reformats a run's JSONL breaks the chain honestly-but-noisily, discovered at FAFF-568 verify time. How you'd know: verify failures naming lines nobody edited maliciously. What it means: run artifacts are already gitignored working state; no mitigation beyond the RFC's "show which line broke" requirement on the verifier.
- **A forgotten prose-layer note leaves an unrecorded ledger write.** How you'd know: FAFF-568 reports the final ledger not matching the last `ledger-write` hash on runs that were never attacked. What it means: the note rule must live in the beep-boop SKILL.md ledger section itself (the DONE item below), at the edit sites, not in a separate doc nobody re-reads.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Chain construction under the real writer set (the headline objective):

```
Given an initialised run directory
When events are appended concurrently via `faff events append`, `contain --record`,
  a corrective author, and a lights-out mint in any order
Then every line parses with schema 2, line 1's prev equals SHA-256 of the run_id,
  and every later line's prev equals the SHA-256 of the exact bytes of the line above it
```

Mid-log tampering is detectable:

Ledger mutations join the chain:

```
Given a run directory with a chained events.jsonl
When run-ledger.json is written through atomicWriteLedger (any caller)
Then events.jsonl gains a ledger-write event whose data.ledger_sha256 equals the
  SHA-256 of the on-disk run-ledger.json bytes, chained like any other record
```

Torn-line continuity:

```
Given an events.jsonl whose final line is a torn partial write with no newline
When the next event is appended
Then the new record's prev equals the SHA-256 of the torn segment's bytes, and the
  repaired file re-hashes cleanly line-by-line from genesis to the new record
```

Non-functional assertions:

- The append path's read stays bounded by the FAFF-574 tail window except when the previous line itself exceeds it (then: exactly as many extra chunks as that line needs).
- A schema-1 log with no `prev` fields still passes `events validate` unchanged (legacy shape-validity is not regressed).

## 6. DESIGN DECISION RATIONALE

**What exactly does `prev` hash?** Options: (a) raw bytes of the preceding physical line; (b) canonicalised JSON of the preceding record; (c) the last *parseable* record (matching the seq mint). Canonical JSON needs a canonical-form spec every foreign emitter must reimplement — the RFC rejects it. Hashing only parseable records lets malformed lines float outside the chain, so garbage could be inserted or removed undetected between links. Raw physical-line bytes keep verification trivial (split on newlines, hash each) and make every line a link.
**Chosen:** `prev` = SHA-256 of the previous physical line's raw bytes, exclusive of its terminating newline; genesis = SHA-256 of the UTF-8 bytes of `run_id`. 64 lowercase hex.

**Where is the chain computed?** Options: inside FAFF-574's locked critical section extending its existing tail-read; or a separate read at each call site. A hash computed outside the lock can lose the race FAFF-574 just fixed and commit to a stale "last line".
**Chosen:** inside the same critical section, extending the same tail-read — `mintRecord` gains a `prevHash` argument; no second read, no new lock. (This is the extension point FAFF-574's spec names verbatim.)

**How do ledger mutations join the chain, given two writer classes?** Options: (a) hook `atomicWriteLedger` (covers every CLI writer at one chokepoint) plus a sanctioned note op for the orchestrator's direct edits, with `events append` computing the hash itself; (b) a full CLI write-surface for the ledger so prose never edits it (out of scope — a large mutation vocabulary for one ticket); (c) freeze the ledger (rejected by the RFC — mutability is by design). Under (a) the only trust seam left is *whether* the note happens, not *what* it claims — a missed note is detectable at verify time.
**Chosen:** hook the `atomicWriteLedger` chokepoint; `events append` computes `data.ledger_sha256` itself for type `ledger-write` (caller-supplied values overwritten); the beep-boop ledger section gains the after-any-direct-edit note rule.

**What happens when the fold's event append fails?** Options: throw (blocks the ledger write's caller); silently skip; warn loudly and continue. Throwing breaks sentry-abort/mint semantics over an events-side fault; silence hides a real gap.
**Chosen:** warn on stderr, never throw; the missing link surfaces at FAFF-568 verification — fail toward detection.

**Schema handling.** Options: bump per-feature (two bumps); bump once covering `prev` + `ledger-write`; no bump (additive field only). `prev` is a required envelope field with chain semantics — a reader must know whether to expect it, so it is a schema fact, not an optional tag; and the RFC's sequencing exists precisely to avoid the double bump.
**Chosen:** one bump to schema 2 in this change; `eventViolations` accepts 1 or 2 per-record (schema 2 requires well-formed `prev`, schema 1 forbids it); all new appends write schema 2.

**Does `declared-effects.jsonl` join now?** Options: same mechanism now; cross-link its head into events.jsonl; defer. The ticket scopes the chain to events.jsonl + ledger mutations, and the per-file mechanism extends additively without touching the events schema again.
**Chosen:** defer (OUT OF SCOPE above), surfaced as un-ticketed follow-up for a human to file.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumptions:**

- **Assumes:** FAFF-574's lock-serialised append core (`appendRecordUnderLock` in `events.js`, with every event writer routed through it) is merged before this build starts. FAFF-574 is promoted in this same run's build queue — this is in-run serialisation (build 574 first, then 564 in the same run), not a park. Validation: `events.js` exports the core and `grep` shows no seq mint outside it; if the core is absent, the build must stop and re-queue behind FAFF-574 rather than re-implementing locking here.

## 8. DONE — Definition of Done

### From WHY (the chain exists, bumped once)
- [ ] Every record appended through the shared core carries `schema: 2` and a `prev` matching `^[0-9a-f]{64}$`; genesis `prev` = SHA-256 of the UTF-8 `run_id`; no writer constructs `schema` or `prev` outside the core (grep-verifiable).
- [ ] `prev` and the `ledger-write` fold land in one schema bump — no intermediate state ships schema 2 without the fold.

### From WHAT (envelope, vocabulary, validator)
- [ ] `mintRecord(seq, prevRecord, prevHash)`: the core computes `prevHash` under the lock and asserts the returned record carries the supplied `seq`/`prev`; corrective's and lights-out's minters stamp them.
- [ ] `ledger-write` added to `DELIVERY_PROFILE.event_types` (phase `run`, not issue-scoped); `governance-profile --selftest` still passes shape-validation.
- [ ] `eventViolations`: schema 1 or 2 accepted; schema 2 requires 64-hex `prev`; schema 1 with a `prev` is a violation; `ledger-write` requires 64-hex `data.ledger_sha256` in envelope mode while a payload-mode `ledger-write` with no data validates clean (pre-injection); `events validate`'s success message drops the hardcoded "(schema 1)".
- [ ] `events append` with type `ledger-write` computes `data.ledger_sha256` from the on-disk `run-ledger.json` bytes, overwriting any caller-supplied value.

### From HOW (fold, ordering, failure)
- [ ] `atomicWriteLedger` (and thus the fenced wrapper) appends a chained `ledger-write` event after the rename, `run_id` from `ledger.run_id` (fallback: run-dir basename); a failure to append warns on stderr and does not throw or roll back.
- [ ] The `--tokens` path emits the checkpoint's `ledger-write` before the tagged payload event; both are ordinary chain links.
- [ ] Previous-line-exceeds-tail-window extends the read backwards to the preceding newline; no counting fallback substitutes for the hash.
- [ ] `plugin/skills/faff-beep-boop/SKILL.md` Run-ledger section states the note rule (after any direct ledger edit, append a `ledger-write` event via `faff events append`) at the edit-site instructions, one sentence plus the command.
- [ ] `events.js` header comment describes the chained schema-2 envelope.

### Tests
- [ ] Concurrency test (extending FAFF-574's): concurrent multi-writer appends yield a byte-verifiable chain from genesis (re-hash line-by-line in the test).
- [ ] Unit: mid-line tamper is caught by re-hash at the first following record (the holdout scenario's visible sibling: modify a line, assert mismatch location).
- [ ] Unit: torn final line → next append's `prev` hashes the torn bytes; repaired file re-hashes cleanly.
- [ ] Unit: `atomicWriteLedger` emits the `ledger-write` event with the correct hash; append-failure path warns without throwing.
- [ ] `eventsSelftest` rows: valid schema-2 record with `prev`; schema 2 missing `prev` rejected; schema 1 carrying `prev` rejected; malformed hex rejected; schema 3 rejected; valid `ledger-write` record; `ledger-write` with missing/malformed `ledger_sha256` rejected.

No LLM-judgement seam is introduced or changed — no eval-coverage item.

### Integration smoke test
```
initialise a run dir; append 5 events via `faff events append`; write the ledger via a
--tokens append; hand-edit run-ledger.json and append a ledger-write note event;
then: every line has schema 2, re-hashing line-by-line from SHA-256(run_id) matches
every prev, and the final ledger-write's ledger_sha256 equals SHA-256 of run-ledger.json
```

## Already shipped against this surface

Related Done work — context, none of it supersedes this premise (verifiably, `events.js` has no `prev` field and no `ledger-write` type exists anywhere in the CLI):

- FAFF-518 — `faff integrity-digest` snapshot/verify: the dispatch-window evidence bracket. It treats `events.jsonl` as prefix-preserving (appends legal), so this chain composes with it unchanged; it defends a different window (during a dispatch), not post-hoc falsification.
- FAFF-520 — the concurrency executors wire that bracket around each graft dispatch; same complementary window.
- FAFF-525 — corrective-integrity preflight accepts the digest-verified basis; adjacent integrity plumbing, no chain.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** — No issues. One cohesive 1–2 day unit: one envelope field minted at an existing chokepoint, one new event type, one validator extension, one write-hook, two doc touches, tests. The `prev` field and the `ledger-write` fold are an always-ships-together pair (the one-bump rule); splitting them would force the double schema bump the RFC's sequencing exists to prevent.
- **Workstream fit? (principles 1 + 5)** — No issues. Step 1 of the RFC's gap-closure sequencing inside the tamper-evidence project; outcome-named and cohesive with FAFF-568 chained behind it.
- **Deps surfaced? (principle 6)** — Finding: the load-bearing dependency FAFF-574 → FAFF-564 is still only a "related" link in the tracker (FAFF-574's spec already asked for the blocker edge). Recommended action: a human adds **FAFF-574 blocks FAFF-564** in the tracker; this run serialises the pair regardless (574 is promoted in the same build queue). Second finding: the deferred `declared-effects.jsonl` chaining is un-ticketed — file it, or fold it into FAFF-568's scope, per this spec's OUT OF SCOPE note.
- **Risk profile? (principle 7)** — No issues. `node:crypto` SHA-256 only (already used by three CLI modules); no novel integration, no external dependency, no de-risking spike warranted.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
