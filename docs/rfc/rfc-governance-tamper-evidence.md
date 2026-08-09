# RFC: Tamper-evident run records

- **Status:** Historical design input; implemented by FAFF-564 and FAFF-568
- **Date:** 2026-07-15
- **Author:** Alec Hill
- **Implemented by:** [FAFF-564 specification](../specs/2026-07-22-FAFF-564-tamper-evident-hash-chain-events-design.md), [FAFF-568 specification](../specs/2026-07-23-FAFF-568-anchor-and-verify-events-hash-chain-design.md), and [ADR 0084](../adr/0084-the-events-jsonl-chain-rule-prev-hashes-the-previous-physical-line-s-raw-bytes-g.md)

## Summary

Make the run audit trail tamper-evident: hash-chain `events.jsonl`, fold run-ledger mutations into that chain, anchor the chain in git, and verify it as a `governance-check` leg. The sequence matters because the schema, emitter, anchor, and verifier must describe the same record.

This RFC was written before those changes shipped. Its design rationale is retained here because the implementation specs and ADR cite it as their input. Statements about the comparative product landscape were based on an unpublished research note and are not carried forward as current claims.

## Motivation

A hash-chained log is not required for the merge-enforcement property: the merge chokepoint independently re-derives state, so a falsified ledger cannot reach `main` on that basis alone. Tamper evidence serves a different property: audit integrity after the fact.

At the time of this proposal:

- `events.jsonl` was append-only by convention only. A process with filesystem access could edit or truncate it undetectably.
- `seq` authority was line-count-derived. Truncation could cause the next append to reissue missing sequence numbers.
- `run-ledger.json` was mutable by design, so its earlier states were not recorded.

The record is useful for reconstruction and external verification only when later edits are detectable.

## Threat model

**Defended:** post-hoc falsification. Editing, truncating, or reordering a run's event history after the events were written becomes detectable by a verifier holding the chain head.

**Not defended:**

- **A dishonest writer.** The orchestrator can emit false but internally consistent events. Independent completeness, holdout, and CI checks address that problem.
- **Whole-chain rewrite without an external anchor.** An attacker can recompute a self-contained chain. The git anchor makes that rewrite disagree with published history.
- **Tamper-proofing.** The design makes a change detectable; it does not make change impossible.

## Proposal

### 1. Chain `events.jsonl`

Each schema-2 record gains a `prev` field containing the SHA-256 digest of the previous physical line's raw bytes. The genesis record uses the SHA-256 digest of the `run_id`. Raw-byte hashing avoids requiring every emitter to implement a separate canonical JSON format and makes truncation break the chain.

### 2. Fold the mutable ledger into the chain

`run-ledger.json` remains mutable. Every ledger write also appends a `ledger-write` event carrying the SHA-256 digest of the post-write ledger bytes. A verifier can confirm that the final ledger matches the last recorded write without changing the ledger's read model.

Heartbeat remains outside the chain because it is a real-time liveness value rather than a forensic history.

### 3. Anchor the chain in git

The chain head is copied into the immutable per-PR run record committed on the feature branch. Once committed, it is covered by the head SHA observed by the merge gate and required CI checks. A later record rewrite then disagrees with a published commit.

### 4. Verify it

An integrity leg re-hashes every line, checks each `prev`, and compares the final ledger with the last `ledger-write` digest. The same operation is available locally through `faff events verify --run-dir DIR`.

Schema-1 runs have no chain and cannot be retrofitted honestly. They report `legacy-unverifiable` under the configured legacy policy. A broken schema-2 chain fails verification.

## Implementation sequence

1. Land schema-2 chaining, `ledger-write` events, and the integrity verifier.
2. Commit per-PR run records so the chain head has an external anchor.
3. Require the governance check through branch protection.
4. Publish emitter schemas only after the implementation shape has been exercised.
5. Make comparative public claims only when the supporting evidence has been independently verified.

## Non-goals

- Writer signatures, TPMs, and external timestamping services.
- Freezing or write-gating `run-ledger.json`.
- Retrofitting chains onto historical schema-1 runs.
- Changing the git-and-CI enforcement chokepoint.

## Deferred questions

- Whether declared effects should use their own hash chain or periodically link their head into `events.jsonl`.
- Whether a mid-run integrity check is worth its repeated hashing cost.
- Whether writer signatures become necessary if the single-writer assumption is relaxed.
