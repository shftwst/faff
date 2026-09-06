# ADR 0124 — Decision-capture mint-and-silence for actionless kernels

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-09-06
- **Issue:** FAFF-1009

## Context

Shadow-fidelity grades a coordination decision by joining two records that share a `correlation_id`: a base record minted in-kernel at verdict time, and an action marker written later by the orchestrator once the downstream action is known. A base whose `correlation_id` is empty joins nothing. It lands in the `action_uncaptured` bucket, grades nothing, and the kernel logs a degraded note saying its base has an empty id (`decision-capture.js:459-461`).

FAFF-989 wired the `next` and `eligible` pair so their captures carry a real id, and reserved the remaining seven capture kernels as `action_uncaptured` "by design". Two of those seven are read-model rollups with no single gradeable downstream action: `queue-state` (beep-boop wave drain and git-only signal) and `project-next` (tidy container state-coherence). The grader classifies both as always-`wasteful` rollups (`shadow-fidelity.js:206,209`), so a real action marker was never on the table for them either way. FAFF-989's disposition left the reported symptom in place: each rollup emits an empty `correlation_id` on every substrate-present run, so the degraded note fires every run.

FAFF-1009 revisited that disposition. The question was whether to leave the two rollups fully un-wired (accepting the every-run note as by-design noise) or to still mint a real id for them without inventing a downstream action.

## Decision

A decision-capture kernel consulted with a substrate present mints a real `correlation_id` via `decide --export` whether or not it has a downstream action to grade. The two rollups, `queue-state` and `project-next`, gain the id-minting `decide --export` step only. They stamp the `__run__` sentinel issue id, run the unmodified kernel consult, and stop there: no action marker is emitted.

The result is that each rollup base carries a non-empty, minted id, so the empty-id degraded note no longer fires for it (the note fires only on an empty id, `decision-capture.js:459-461`). The base still lands in `action_uncaptured`, now by design and cleanly, because there is no consumer to join a marker. This is the mint-and-silence tier of FAFF-1009's two-tier resolution across all seven un-wired kernels; the other five gain the full driver (`decide --export`, consult, `action` marker) and become joinable graded records.

Minting an id whether or not a downstream consumer exists is an ordinary middleware pattern, not a surprising state. It clears the every-run note without inventing a fake action, and without reversing the FAFF-956 empty-id append contract: after this change these two bases are non-empty, so the append gate never sees an empty id from them. The `KERNEL_REGISTRY` intent FAFF-989 reserved for a future rollup action is left untouched; the two rollups carry an id but remain deliberately ungraded.

## Consequences

- The empty-id degraded note stops firing for all nine kernels in a substrate-present run. That is the residual defect from FAFF-989 closed, rather than left as an in-spec punt.
- `queue-state` and `project-next` remain deliberately ungraded. They land `action_uncaptured` because no consumer exists, not because their id is missing.
- The FAFF-956 empty-id append contract is unchanged. It is not reversed or narrowed; these two bases simply no longer emit an empty id.
- A future rollup action, if one is ever wanted, is a new `KERNEL_REGISTRY` decision. It would attach a marker to the id these rollups already mint, and would be recorded then, not now.
