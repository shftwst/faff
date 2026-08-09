# PRD — tandem: Collaborative Text Editor

- **Container:** tandem
- **Status:** Draft
- **Date:** 2026-07-19
- **Mode:** authored

## Problem / objective

Deliver a collaborative plain-text editor: several people open the same document in their browsers, type at the same time — sometimes against a flaky connection, sometimes fully offline — and every copy ends up byte-identical without anyone's work being thrown away. Last-write-wins is explicitly not acceptable: concurrent edits merge, they don't overwrite. The merge algorithm (CRDT, OT, or otherwise) is implementation's choice; convergence under adversarial delivery is the brief.

## Goals & success metrics

- Any interleaving of concurrent edits, disconnects, and reconnects converges every replica to the same text.
- No typed character is silently lost or duplicated — ever.
- Editing feels local: keystrokes land immediately, remote edits arrive without disturbing the local cursor's line.

## Non-goals

- Rich text — plain text only.
- Presence and cursors of other editors — a visible editor list is not required.
- Access control — anyone with the document link can edit.
- Version history or undo across sessions.
- Documents beyond a stated size cap.

## Users

Small groups editing shared notes, drafts, and lists in real time.

## Requirements

- A document is created at an unguessable URL (identifiers carry at least 128 bits of randomness); anyone with the URL edits it live in the browser.
- Concurrent edits from any number of clients converge: at quiescence, every connected replica holds byte-identical text.
- Merging is intent-preserving, not last-write-wins: two concurrent insertions at the same position both survive, in a deterministic order; an edit is never discarded because another client edited concurrently.
- Delivery is adversarial by assumption: edits may arrive out of order, duplicated, or delayed — the merge MUST tolerate all three.
- A client that goes offline continues editing locally; on reconnect its offline edits merge and all replicas converge.
- A client joining late receives the current document and converges with in-flight edits.
- Documents persist in a database; a server restart mid-session loses no acknowledged edit, and clients recover on reconnect.
- The merge engine runs headless, decoupled from the DOM and the transport.
- A verification harness driving N scripted headless clients: seeded randomized edit streams, scheduled partitions and reconnects, injected reordering and duplicate delivery — asserting at quiescence that all replicas are byte-identical, and that the final text contains exactly the surviving characters the script's edits imply (nothing lost, nothing doubled).
- The harness includes a convergence-checker self-test: a scripted pair of replicas engineered to diverge MUST be flagged as divergent — an assertion that passes everything is not an assertion.
- Deployed publicly: the client as a static site, the sync server on Fly.io, with automated deploys. GitHub, Netlify, Fly.io, Turso, and R2 are available; no paid service beyond what's already available.

## Acceptance criteria

- Given N clients editing the same document concurrently, When traffic quiesces, Then every replica MUST hold byte-identical text.
- Given two clients inserting different text at the same position concurrently, When both edits propagate, Then both insertions MUST appear in the converged text, in a deterministic order.
- Given any edit acknowledged to its author, Then it MUST appear in the converged text unless a later edit deleted it.
- Given edits delivered out of order, duplicated, or delayed, When replicas process them, Then convergence MUST be unaffected and no character may be duplicated or lost.
- Given a client that edits while offline, When it reconnects, Then its edits MUST merge and all replicas MUST converge.
- Given a client joining an active document, Then it MUST receive the current text and converge with concurrent edits.
- Given a server restart mid-session, When clients reconnect, Then no previously acknowledged edit may be missing and editing MUST be able to continue.
- The merge engine MUST run headless, without a DOM and independent of the transport.
- Given the harness's seeded adversarial runs, When they complete, Then every convergence and no-loss/no-duplication assertion MUST pass, reported per-run.
- Given the harness's engineered divergent pair, When checked, Then it MUST be flagged as divergent.
- Document identifiers MUST contain at least 128 bits of randomness.
- The repository MUST include the harness, and running it MUST report per-check results.
- The client MUST be deployed as a static site and the sync server publicly deployed, with automated deploys and no manual deploy step.

## Evaluator note

Convergence bugs do not surface in a two-browser demo — they surface under interleavings no human types. The harness is the instrument: seeded adversarial schedules make divergence reproducible, and the engineered-divergence case proves the assertions have teeth. Residual duties: confirm the harness's clients run the real merge engine (not a shared in-process document), that reordering and duplication are injected in the delivery path rather than pre-sorted away, and that the restart check kills the real server process. "Feels local" is directional context for a human reviewer, not a gate.

## Open questions

- Merge algorithm, transport (WebSockets, SSE, or otherwise), and edit-batching strategy are left to implementation.
- The document size cap is left to implementation — stated in the UI and pinned by a harness case.
- Tombstone/garbage-collection strategy for deleted characters is left to implementation.
- How long offline edits are retained client-side before being dropped is left to implementation — stated in the README.
