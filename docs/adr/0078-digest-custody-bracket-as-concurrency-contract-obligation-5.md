# ADR 0078 — Digest-custody bracket as concurrency-contract obligation 5

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-07-17
- **Issue:** FAFF-520

## Context

The run-grain evidence set an autonomous orchestrator later reads to make scheduling
decisions — `run-ledger.json`, `corrective/`, `events.jsonl` (the `correctiveIntegrityDirs`
roster plus `--events`) — is orchestrator-only-writable by convention only. Nothing detected a
build subagent that violated the convention mid-dispatch, so a tampered ledger, a forged
corrective artifact, or a rewritten event history flowed silently into re-dispatch constraints,
blocker-merged checks, and the run summary. The deterministic `faff integrity-digest`
snapshot/verify CLI now exists; the write-authority classes (evidence writes cross to the
trusted side of the dispatch cut, with the `events.jsonl` prefix-preserving carve-out) are
settled. What remained unfixed was *where the wiring lives* so that every `concurrency`
occupant — the sequential default, the parallel executor, and any third-party swap-in —
inherits the tamper-detection bracket rather than each re-implementing it (and tripping the
duplicated-block lint). Custody in the dispatcher's conversation context is the mechanism: the
manifest is held where the subagent structurally cannot read or alter it, so custody replaces a
forgeable same-uid signature.

## Decision

The digest-custody bracket around every graft dispatch is a **fixed obligation of the
gateway-owned `concurrency` slot contract** (obligation 5), not per-executor prose. The
obligation states the shared invariants once: the bracketed member set is
`correctiveIntegrityDirs(runDir)` + `--events` (`--issue` always omitted — run grain); the
manifest is held in the orchestrator's conversation context and **never written to disk**
(`--manifest -` over stdin); verify runs **immediately on subagent return**, before the
evidence is consumed; a `verify` exit 1 (tamper) and exit 2 (verification unavailable — held to
substrate parity with tamper because a subagent can force it) both park the unit with the
evidence unconsumed and never proceed as verified; and the verdict surfaces only as the
`digest-verified` trust class — never `FAFF_INTEGRITY_BOUNDARY`, never `integrityGate`, never a
mount-asserted basis. Each executor's `SKILL.md` carries only its own placement/mechanics prose
and refers back. The sequential executor uses **disjoint per-dispatch brackets** (foreground
blocking means no orchestrator write sits inside a bracket, so zero re-baselining). The parallel
executor maintains **one continuous run-grain custody chain per wave**: a single baseline taken
at wave start, verified on every subagent return, and re-baselined around each orchestrator
own-write to a byte-exact member in the order **verify → write → post-write check → re-snapshot
→ intended-content check** — the post-write CLI verify of the old baseline must name exactly the
just-written members (any other member is tamper), and the candidate baseline's recorded sha256
for each just-written member must equal an in-context hash of the intended bytes (closing the
touched-member launder); event appends are exempt from re-baselining under the prefix rule. This
is the sanctioned re-baselining bookkeeping arm of the write-authority decision. The reviewer's
build-time strengthening note — swapping the post-write check and re-snapshot so a tamper landing
between the check's read and the snapshot's read can never enter the candidate — was considered
at authoring; the ordering as written is retained because it already sits within the rung's
accepted residual class, and adopting the swap is left to a clean build-time call rather than
mandated here.

## Consequences

- The bracket is inherited by contract, not convention: every current and future `concurrency`
  occupant (including third-party executors) gets tamper detection by loading the contract, and
  a swap-in cannot silently drop it.
- Detection is added *ahead of* evidence consumption; the merge floor (AC + CI + review, plus the
  L4 holdout) is untouched — obligation 4 stands character-identical. A unit whose graft merged
  before detection still parks with the tamper cause, and the park comment names both the
  tampered paths and the merged PR so the human's audit/revert move is named, not discovered.
- Tampered/unverifiable run-grain evidence is surfaced durably via a top-level
  `integrity_tampered` ledger array (mirroring the `review_outage_pending` precedent); the
  parallel executor halts new dispatches and drains in-flight units to terminal on either exit 1
  or exit 2, never interrupting a live subagent.
- Residuals are accepted, not hidden: the "tamperer merges before the on-return verify" window is
  inherent to per-dispatch grain, and a lost baseline (compaction) surfaces a loud custody-gap
  note and re-snapshots rather than parking the world. The finer graft-internal bracket grain is
  a deliberate follow-up that shrinks the window; merge-gate consumption of the digest verdict as
  an `integrityGate` basis is a separate authority this decision does not touch.
