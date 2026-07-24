# run-ledger.json

**Purpose.** The per-run record of what was admitted and how each admitted issue
terminated. The single source `faff runcheck` audits for completeness and the merge-gate
readers, `faff audit`, and `faff sentry` all key off.

**Location & lifecycle.** `<run-dir>/run-ledger.json`, one per run. Written at run-start
(admitted set known), then mutated under a lock-serialised write path
(`mutateLedgerUnderLock`, `bin/lib/heartbeat.js`) as each admitted issue reaches a
terminal outcome. Every write is atomic (tmp-file-then-rename), and — from FAFF-564 on —
folds into the events hash chain: each write emits an `events.jsonl` `ledger-write`
record carrying `ledger_sha256` (the post-write ledger bytes' SHA-256), so a later chain
verification can cross-check the ledger against its own append history (see
`v0.2/anchor-integrity.md`'s ledger-fold check).

**Producer(s).** The orchestrator (`faff-beep-boop`) at run-start (writes `run_id` +
`admitted`), and every terminal-outcome writer (`faff-graft`'s return-value mapping, the
park protocol, `faff-tidy`) via `mutateLedgerUnderLock`.

**Consumer(s).** `faff runcheck` (`auditLedger` — every admitted issue MUST have a string
terminal outcome), governance-check's `completeness` leg, `faff audit` (events↔ledger
coherence, report-only), `faff sentry` (liveness via the `owner` block).

**Schema.** [`schema/run-ledger.schema.json`](schema/run-ledger.schema.json). Deliberately
`additionalProperties: true` — the ledger is an open, orchestrator-extended record that
gains fields at nearly every minor faff release. The schema closes only the vocabularies
consumers actually gate on: the `outcomes` enum (the closed `ledger_outcomes` set) and the
`owner.status` enum.

**Integrity.** Writes are lock-serialised (no concurrent-write races) and atomic
(tmp+rename — no reader ever observes a partial write). From FAFF-564 on, each write's
post-write hash is recorded in the events chain (`ledger-write` / `ledger_sha256`), so a
later `faff events verify` (or governance-check's `integrity` leg — `v0.2/`) can detect an
unrecorded rewrite of `run-ledger.json` between the last chain-recorded write and now.

**Fail direction.** A malformed `run-ledger.json` is `runcheck`'s fail-loud exit 2 — never
silently treated as a leg failure. A run-ledger with no `owner` block is legacy-valid
(the liveness leg passes it; `owner` is schema-optional). `outcomes` values are strings
only — an object outcome is rejected by `runcheck` (FAFF-554: rich per-issue detail lives
in the sibling `outcome_details`, never inline in `outcomes`).

**Example.** [`schema/examples/run-ledger.example.json`](schema/examples/run-ledger.example.json),
hand-carried from a real run (`.faff/runs/run-20260724-125424-beepboop-full/run-ledger.json`).
