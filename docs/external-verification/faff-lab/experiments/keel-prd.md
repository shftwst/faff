# PRD — keel: Transactional Storage Engine

- **Container:** keel
- **Status:** Draft
- **Date:** 2026-07-20
- **Mode:** authored

## Problem / objective

Deliver a transactional key-value storage engine built on files and the standard library — not on an existing database or storage engine, which would dissolve the brief. Transactions are atomic, isolated, and durable: a commit acknowledged is a commit recovered, through a process kill at any instant, including mid-write and mid-fsync, including a torn final page. The deliverable stands or falls on a crash-injection harness that kills the engine at every interesting point in its own I/O and proves recovery from each one.

## Goals & success metrics

- No acknowledged commit is ever lost, and no unacknowledged write ever survives — at every crash point the harness can produce.
- Readers see consistent snapshots, always; writers conflict cleanly, never corrupt.
- Recovery is unattended and bounded: reopen the files, get a correct store.

## Non-goals

- Replication or networking in the engine — the engine is a library; a thin demo server exists only to deploy it.
- SQL, queries, or secondary indexes — keys and values.
- Serializability — the isolation contract is snapshot isolation, stated and pinned; its known anomalies (e.g. write skew) are accepted and documented.
- Compression, encryption, or multi-file sharding.
- Online backup.

## Users

Developers evaluating the engine through its API, its harness, and its recovery behavior.

## Requirements

- A library exposing: open a store from a directory, begin a transaction, `get`/`put`/`delete` within it, commit, abort; multiple concurrent transactions.
- Storage is implemented directly on files (write-ahead log and/or data files — layout is implementation's choice) using the language's standard library; existing database engines, storage engines, or embedded stores MUST NOT be used for the engine core.
- Durability: an acknowledged commit survives a process kill at any instant; the write-ahead discipline (what is fsynced, when) is documented.
- Atomicity: a transaction's effects appear entirely or not at all after recovery — never partially.
- Isolation: snapshot isolation — a transaction reads a consistent snapshot as of its start and is never blocked by readers; two transactions writing the same key conflict, and at most one commits.
- Torn-write recovery: a crash may leave a final partial or corrupted record; recovery MUST detect this via checksums and recover the store to the last acknowledged commit, never propagating corruption.
- Recovery runs unattended on open, in a fresh process, with no repair tool or operator step.
- A crash-injection harness driving the engine through a file-layer shim it controls: the shim can kill the process at any write or fsync boundary and can tear the final write (persist a prefix of it). The harness enumerates injection points exhaustively for a scripted workload — every write and fsync the workload performs — and additionally runs seeded randomized concurrent workloads with random crash points. After every injected crash it reopens the store in a fresh process and asserts: all acknowledged commits present, no unacknowledged effects present, checksums clean.
- A conservation workload in the harness: concurrent read-modify-write transfer transactions over a fixed set of keys whose values MUST sum to the same total at every recovery, through crashes and conflicts.
- A demo server (thin HTTP wrapper over the library) deployed on Fly.io with automated deploys and a post-deploy smoke check that commits a value, restarts the app, and reads it back. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available — and the engine itself must not use them for storage.
- CI on GitHub builds the project and runs the full harness — exhaustive and randomized phases — on every push to the default branch.

## Acceptance criteria

- Given an acknowledged commit, When the process is killed at any injection point after acknowledgment, Then recovery MUST present that commit intact.
- Given a transaction not yet acknowledged, When the process is killed at any injection point, Then recovery MUST present none of its effects.
- Given a crash that tears the final write, When the store reopens, Then the torn record MUST be detected by checksum and the store MUST recover to the last acknowledged commit.
- Given a transaction, When it reads, Then it MUST see a consistent snapshot as of its start, unaffected by concurrent commits.
- Given two concurrent transactions writing the same key, When both attempt to commit, Then at most one MUST succeed and the other MUST abort cleanly.
- Given the conservation workload, When run with concurrent transactions, injected crashes, and recoveries, Then the sum over its keys MUST equal the initial total at every recovery.
- Given the scripted workload, When the harness enumerates its injection points, Then every write and fsync boundary MUST be covered, and every injected crash MUST pass the recovery assertions.
- Recovery MUST run unattended in a fresh process on open, with no separate repair step.
- The engine core MUST NOT use an existing database, storage engine, or embedded store; storage MUST be direct file I/O via the standard library.
- The write-ahead/fsync discipline MUST be documented in the README.
- The repository MUST include the harness and shim, and running them MUST report per-injection-point and per-run results.
- CI MUST build the project and run the full harness on every push to the default branch, and MUST be green.
- The demo server MUST be publicly deployed on Fly.io with automated deploys, and the post-deploy smoke check MUST pass a commit–restart–read cycle.

## Evaluator note

Crash consistency is the canonical domain where code that looks correct is not: the bugs live between a write and an fsync, and no test that doesn't actually kill the process can find them. The shim is the instrument — injection must happen in the engine's real file path, kills must be real process kills, and every recovery must reopen files in a fresh process, or the whole harness is theater. The evaluator's residual duties are exactly those three confirmations, plus one more: verify the exhaustive phase's coverage claim by counting the shim's recorded boundaries against the workload's actual I/O. The snapshot-isolation contract is pinned by harness cases; its documented anomalies are not defects. Engine performance is directional context for a human reviewer, not a gate.

## Open questions

- Language, file layout (single log, log-plus-heap, or otherwise), and checksum algorithm are left to implementation.
- MVCC mechanics and garbage collection of old versions are left to implementation.
- Whether conflicts are detected at write time or commit time is left to implementation — the at-most-one-commits criterion holds either way.
- The demo server's API shape is left to implementation; it exists to prove deployability, not as a product surface.
