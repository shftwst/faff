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
and refers back. **Both executors maintain one continuous run-grain custody chain per orchestrator**
(the parallel executor's per-wave; the sequential executor's per its own single-dispatch-at-a-time
run — see the FAFF-679 amendment below for why the sequential executor is not exempt from
re-baselining either): a single baseline held from chain-open to chain-close, verified on every
subagent return, and re-baselined around each orchestrator own-write to a byte-exact member in the
order **verify → write → post-write check → re-snapshot → intended-content check** — the post-write
CLI verify of the old baseline must name exactly the just-written members (any other member is
tamper), and the candidate baseline's recorded sha256 for each just-written member must equal
either the before/after digest pair that write's own CLI command reported (Class A) or, for the
orchestrator's own direct session edit of the ledger (Class B, which has no CLI-reported hash),
a copy composed from the baseline-verified in-context state rather than a fresh disk read (closing
the touched-member launder both classes are otherwise exposed to). Event appends are exempt from
re-baselining under the prefix rule. This is the sanctioned re-baselining bookkeeping arm of the
write-authority decision. The reviewer's build-time strengthening note — swapping the post-write
check and re-snapshot so a tamper landing between the check's read and the snapshot's read can
never enter the candidate — was considered at authoring; the ordering as written is retained
because it already sits within the rung's accepted residual class, and adopting the swap is left
to a clean build-time call rather than mandated here.

**Amendment (FAFF-679, 2026-07-29).** The sequential clause above originally read "disjoint
per-dispatch brackets (foreground blocking means no orchestrator write sits inside a bracket, so
zero re-baselining)". That premise is false: the detached sentry poller's `sentry abort` writes
the ledger from another process on its own schedule and can land while a sequential dispatch is
still open, and it was never true that "the trusted orchestrator writes nothing inside its own
bracket" in general — obligation 5's own re-baseline sequence exists precisely because a trusted
write inside an open bracket is normal, not exceptional. The recorded decision above (one chain,
the write sequence, the Class A/B closing treatment) is unchanged; only the sequential executor's
"exempt from re-baselining" corollary is retracted. Fixing this also closed a real gap the first
review pass of the FAFF-679 spec missed: the write sequence's original intended-content check
compared against a freshly-composed guess, which for the orchestrator's own direct ledger edit
(Class B) could itself be composed from already-tampered bytes and launder them into the new
baseline — closed by requiring that composition come from the held baseline-verified copy, never
a fresh disk read.

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
