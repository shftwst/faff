# ADR 0085 — Ledger mutations join the events chain via a ledger-write event at the atomicWriteLedger chokepoint, hash always CLI-computed

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-07-22
- **Issue:** FAFF-564

## Context

`run-ledger.json` is mutable by design — outcomes, stop reasons, and owner closes are legitimately rewritten in place — so it cannot carry a per-line chain itself, yet an audit trail that excludes ledger mutations leaves the run's headline record falsifiable with no trace. Two writer classes mutate it: CLI-side writers, which all route through `atomicWriteLedger` (and its fenced wrapper) in `heartbeat.js` — the token checkpoint, budget baseline, lights-out mint/resume, sentry abort — and the beep-boop orchestrator's prose-layer direct edits (`admitted` appends, `outcomes`, `stop_reason`, the owner close), which no CLI chokepoint sees. Any scheme where the agent computes and supplies a hash puts an untrusted claim inside a trust artifact. The alternatives — a full CLI mutation vocabulary for the ledger so prose never edits it, or freezing the ledger — are respectively out of scope for one ticket and rejected by the RFC.

## Decision

Every ledger write is recorded in the events chain as a `ledger-write` event (phase `run`, not issue-scoped) whose `data.ledger_sha256` is the SHA-256 of the post-write `run-ledger.json` bytes — and that hash is always CLI-computed, never caller-supplied. CLI-side writers get it for free: `atomicWriteLedger` itself, after the tmp-write → rename lands, appends the event through the shared locked core (`run_id` from `ledger.run_id`, falling back to the run-dir basename), one chokepoint with no per-caller emissions. Prose-layer writers follow a note rule stated in the beep-boop Run-ledger section: after any direct ledger edit, pipe `{"phase":"run","type":"ledger-write"}` to `faff events append --run <run-id>` — and `events append`, seeing the type, computes `data.ledger_sha256` from the on-disk ledger bytes itself, overwriting anything the caller supplied. If the fold's event append fails (for example the events lock budget is exhausted), `atomicWriteLedger` warns loudly on stderr and returns normally — never throws, never rolls back the ledger write: the system fails toward detection, not toward blocking a load-bearing write.

## Consequences

- The ledger's *history* becomes chain-anchored while the ledger itself stays mutable by design: each write's hash is a chain link, so post-hoc rewriting of the ledger without a matching `ledger-write` event is detectable at FAFF-568 verification.
- The only trust seam left is *whether* the prose-layer note happens, never *what* it claims — a forgotten note surfaces as the final ledger not matching the last `ledger-write` hash. This constrains every future ledger writer to either the `atomicWriteLedger` chokepoint or the note rule; a new CLI-side writer that bypasses the chokepoint re-opens the gap.
- `heartbeat.js` needs the append core back from `events.js`, which already requires `heartbeat.js` — resolved with a call-time (lazy) require inside `atomicWriteLedger`, keeping the fold at the chokepoint.
- An events-side failure can leave a legitimate ledger write unrecorded (warn-and-continue); that missing link is exactly what FAFF-568's verifier reports, so the failure mode is honest rather than silent.
- The `--tokens` path emits two chained events per tagged append — the checkpoint's `ledger-write`, then the tagged payload event — a shape downstream consumers must expect.
- Rejected alternatives: a full CLI write-surface for the ledger (a large mutation vocabulary out of scope for this slice); freezing the ledger (mutability is by design, RFC-rejected); caller-supplied hashes (an agent-computed hash is an untrusted claim in a trust artifact).
