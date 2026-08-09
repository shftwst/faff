# events.jsonl

**Purpose.** The append-only, per-run event log — one `RunEvent` JSON object per physical
line. It is the finer-grained sibling of `run-ledger.json`: every terminal outcome the
ledger records has a matching `issue-outcome` event, plus phase transitions
(`run-start`/`run-end`, `prep-start`/`prep-done`, `build-start`, …) the ledger doesn't
carry at all. From schema 2 on, each line also carries a hash-chain link (`prev`) —
construction is documented here as normative; **verification is v0.2's surface** (this
page predates FAFF-568 and, per the v0.1→v0.2 delta, no longer states that no verb
re-verifies the chain — see `v0.2/anchor-integrity.md`).

**Location & lifecycle.** `<run-dir>/events.jsonl`, one per run, append-only for the
run's lifetime. Appends are lock-serialised (`appendRecordUnderLock`,
`bin/lib/events.js`) so concurrent writers never mint a duplicate `seq` (FAFF-574). A
crashed writer can leave a **torn final line** (a partial write with no trailing
newline) — the next locked append newline-repairs without rewriting the torn bytes; the
torn segment stays chain-covered (its raw bytes are hashed as-is by the following
record's `prev`) even though it is not itself a parseable record.

**Producer(s).** `appendEventRecord`/`appendRecordUnderLock` (`bin/lib/events.js`),
called from every phase of the orchestrator and its sub-skills (`faff-beep-boop`,
`faff-prep`, `faff-graft`, `faff-tidy`) plus `faff heartbeat`.

**Consumer(s).** `faff events validate` (shape-only — per-line schema + the seq/prev
cross-line invariants below), `faff audit` (events↔ledger coherence, report-only),
`faff sentry` (thrash/stall detection via phase/type sequences). **v0.2 adds:** `faff
events verify` and governance-check's `integrity` leg (see `v0.2/anchor-integrity.md`) —
both re-hash the chain this page documents the construction of.

**Schema.** [`schema/run-event.schema.json`](schema/run-event.schema.json) — validates
ONE parsed record; a file is a sequence of these. The `schema`/`prev` pairing rule
(`prev` required iff `schema==2`, forbidden iff `schema==1`) and the cross-line
invariants below are **not expressible in JSON Schema** and are restated here as
conformance rules, enforced by `faff events validate` (shape) and — for the chain itself
— by `faff events verify` (v0.2).

**Integrity — construction (normative here).**

- **`seq` is authoritative order; `ts` is best-effort.** A duplicate or regressing `seq`
  is a **hard** violation (FAFF-574's lock-serialised mint is what prevents it under
  normal operation); a forward gap is **advisory** only.
- **The hash chain** (schema 2 on, FAFF-564): each record's `prev` = SHA-256 of the
  *previous physical line's raw bytes* (exclusive of the terminating newline); the
  genesis record's `prev` = SHA-256 of that record's own `run_id` field (not the
  containing directory's basename — this is what lets an anchor, relocated under
  `.faff/anchors/<run>/<issue>/`, still verify against the record's own `run_id` — see
  `v0.2/anchor-integrity.md`). Byte-exact, no canonicalisation.
- **A torn final line hashes as-is.** The chain covers the torn bytes even though they
  are not themselves a parseable record — the next locked append's `prev` is computed
  over exactly what was on disk, torn or not.
- **Mixed schema-1/schema-2 files are valid** (a legacy run upgraded in place) — the
  chain covers physical lines regardless of whether a given line carries `prev`.

**Fail direction.** `faff events validate` fails loud (non-zero) on: a non-JSON or
non-object line (not the honest torn-tail case), a duplicate/regressing `seq`, a
`schema`/`prev` pairing violation. A forward `seq` gap is reported but does not fail. Chain
*hashing* violations (a `prev` mismatch) are **not** this verb's concern — see
`v0.2/anchor-integrity.md` for `faff events verify`'s fail direction.

**Example.** [`schema/examples/run-event.example.json`](schema/examples/run-event.example.json),
a real `issue-outcome` record hand-carried from `.faff/runs/run-20260724-125424-beepboop-full/events.jsonl`.
