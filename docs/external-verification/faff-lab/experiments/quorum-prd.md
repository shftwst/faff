# PRD — quorum: Replicated Key-Value Store

- **Container:** quorum
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a replicated key-value store: three nodes, one HTTP API, and a guarantee — an acknowledged write survives the loss of any single node, and the cluster never lies to a reader. The consensus protocol is implementation's choice (Raft, viewstamped replication, or otherwise); the invariants are the brief. A single-node store behind a proxy, or replicas that trust a shared database, does not satisfy this brief. Correctness here is invisible to inspection and to casual use — the deliverable stands or falls on a recorded-history checker.

## Goals & success metrics

- No acknowledged write is ever lost, through any single-node kill or network partition.
- No reader ever observes a state the cluster did not linearizably pass through.
- The cluster heals itself: nodes rejoin, partitions mend, and all replicas converge without operator action.

## Non-goals

- Dynamic membership — the cluster is fixed at three nodes.
- Byzantine fault tolerance — nodes fail by stopping or partitioning, not by lying.
- Log compaction/snapshotting beyond keeping restarts workable.
- Multi-key transactions — operations touch one key.
- A bespoke frontend — the HTTP API and the harness are the interfaces.

## Users

Developers evaluating the store through its API, its harness, and its recorded histories.

## Requirements

- Three replicated nodes, each independently killable and restartable, exposing one logical HTTP API: `put`, `get`, `delete`, and `cas` (compare-and-swap) on string keys and values.
- All operations are linearizable: an acknowledged write is durable on a majority before the client hears success, and reads never return stale or uncommitted values — how reads achieve this (leader lease, read index, quorum read, or otherwise) is implementation's choice.
- At most one node accepts writes at a time per term/view: a leader cut off from the majority stops acknowledging writes; the majority side elects a replacement and continues.
- A minority partition refuses writes rather than diverging; when the partition heals, all nodes converge to identical committed state.
- Node kills are survivable at any instant — including a leader killed between accepting a write and acknowledging it; on restart a node recovers from its own durable log, rejoins, and catches up.
- One command (e.g. `docker compose up`) brings up all three nodes on a machine with only Docker installed; the composed environment is canonical for verification.
- A verification harness run against the composed environment: concurrent clients issue randomized `put`/`get`/`cas` traffic while a fault injector kills nodes (real container kills, leader included), imposes network-level partitions (imposed on the composed network, not by in-process flags), and heals them; every client records its full operation history (invocation, response, timing), and a linearizability checker verifies the recorded histories, reporting per-run results.
- The checker is itself checked: the harness includes at least one known non-linearizable history that the checker MUST reject — a checker that passes everything is not a checker.
- Concurrent `cas` operations on the same key resolve exactly one winner.
- CI on GitHub builds the project and runs the harness (faults included) on every push to the default branch.
- Publicly deployed on Fly.io as three nodes from the same container images, with automated deploys and a post-deploy smoke check that writes a key, kills no nodes, and reads it back through a different node's endpoint. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given a write acknowledged to a client, When any single node — including the leader — is killed immediately after, Then a subsequent read MUST return that write (or a later one).
- Given a leader partitioned from the majority, When clients write to it, Then those writes MUST NOT be acknowledged.
- Given a partition isolating a minority, When the majority side continues, Then it MUST elect a leader if needed and keep serving reads and writes.
- Given a healed partition, When the cluster quiesces, Then all three nodes' committed state MUST be identical.
- Given two concurrent `cas` operations on the same key with the same expected value, Then exactly one MUST succeed.
- Given a node killed at any instant, When it restarts, Then it MUST recover from its own durable log and rejoin without operator action.
- Given the harness's recorded client histories across a fault schedule, When the linearizability checker runs, Then every history MUST verify as linearizable.
- Given the known non-linearizable history in the harness, When the checker runs on it, Then it MUST be rejected.
- The three nodes MUST NOT share a datastore; each MUST persist its own log and state.
- Given a clean machine with only Docker, When the single documented command runs, Then all three nodes MUST come up and serve the API.
- The repository MUST include the harness and checker, and running them MUST report per-check results.
- CI MUST build the project and run the full harness on every push to the default branch, and MUST be green.
- The system MUST be publicly deployed on Fly.io as three nodes from the same container images, with automated deploys and no manual deploy step.
- Given a deploy completes, When the smoke check writes through one node's endpoint and reads through another's, Then the read MUST return the written value.

## Evaluator note

Nothing here is verifiable by inspection: replication code looks correct far more often than it is, and a cluster that silently loses writes demos identically to one that doesn't. The recorded histories and the checker are the instrument — and the criteria only count as demonstrated when the faults are real: kills are container kills, partitions are imposed on the network, and the checker demonstrably rejects the committed bad history. The evaluator's residual duties are exactly those three confirmations, plus confirming histories are recorded at the client (not reconstructed from server logs). The deployed instance is held to the smoke check and image parity with what the harness verified — the evaluator confirms the deploy uses the same images, not that partitions were re-run in production.

## Open questions

- Consensus protocol, language, and storage format for the durable log are left to implementation.
- Whether the linearizability checker is written or adopted (e.g. an existing checker library) is left to implementation — either way the known-bad-history case must pass.
- Client redirect behavior when contacting a non-leader (proxy, redirect, or rejection) is left to implementation.
- Election timeouts, heartbeat intervals, and lease durations are left to implementation — stated in the README.
