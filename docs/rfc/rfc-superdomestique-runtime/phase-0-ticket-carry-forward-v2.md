# Phase 0 carry-forward v2: L4 evidence and current-runner hardening

**Status:** proposed
**Date:** 2026-08-12
**Model:** GPT-5.6-sol
**Scope:** every FAFF ticket in Backlog or Todo, pulled from the tracker on 2026-08-12 and mapped to [master v5](v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) Phase 0A and Phase 0B
**Repository code reviewed at:** `79563ac`
**Supersedes:** [Phase 0 carry-forward v1](phase-0-ticket-carry-forward.md)

## Decision

Carry 22 existing tickets into required Phase 0 scope. Keep eight more as conditional upgrades whose need depends on the selected reference posture or a preceding evaluation. Reconcile two stale tracker records before treating them as implementation. Allow 11 routine maintenance tickets to proceed without making them phase gates. Hold the remaining 88 live tickets behind their named later phase or product decision.

Create four new tickets for work the current backlog does not represent:

1. publish an immutable off-box recovery bundle from current canonical run artifacts;
2. prove safe-boundary recovery on a later executor without the original local run directory;
3. capture the current decision kernel's inputs and chosen actions for Phase 1 fidelity analysis; and
4. assemble and bank the Phase 0 reference scenario matrix and common audit bundle.

This is a scope decision, not a bulk promotion to Todo. Dependencies, acceptance evidence, and the work-in-progress limit still control admission.

## Method and corrections to v1

The live pull contains 131 unstarted tickets: 104 Backlog and 27 Todo. v1 reported 130 because the tracker changed around the snapshot and did not preserve a machine-checkable disposition index.

This revision also corrects six material classification problems:

- FAFF-748 remains open as an epic, but its implementation children FAFF-749, FAFF-750, and FAFF-751 are Done. Reconcile or close the epic rather than carrying its completed implementation again.
- FAFF-683 names a decision that blocks FAFF-606, which is already Done. Reconcile the stale relationship and rewrite the ticket only if a current decision remains.
- FAFF-316 says the original adversarial audit completed. Its residual work depends on later treatment-arm and environment work, so it belongs in Phase 2B rather than Phase 0.
- FAFF-542 and FAFF-543 are claude-box interval-checkpoint proposals. Phase 0 requires safe-boundary recovery bundles, not live worktree migration, so these tickets remain in the later executor-substrate cluster.
- The live tracker does not support v1's claim that FAFF-614 directly blocks FAFF-763 and FAFF-605. It is a conditional validation input if those posture changes proceed.
- FAFF-386 and FAFF-694 are Done. They remain useful historical dependencies, but are not part of the live-set count.

The classification test is narrow: required Phase 0 work must repair a known defect in the current unattended path, make its present evidence recoverable, produce the reference L4 proof, or make that proof installable and truthful. Work that strengthens a possible posture, constructs the later runtime, expands autonomy, or improves unrelated maintainability is conditional, held, or routine.

## Required Phase 0A: trust, durability, and L3 reliability

| Ticket | Required outcome |
|---|---|
| FAFF-778 | Interactive grafts emit the same ledger and anchor evidence required by merge-gate. |
| FAFF-639 | The local gate ladder cannot report green while required CI validation fails. |
| FAFF-720 | Decide the no-PR run-anchor policy, then implement the minimum accepted policy. The decision is required; a new anchor mechanism is not assumed in advance. |
| FAFF-465 | Exhausted adversarial-review fallback parks deterministically instead of looping or changing result on an unrecorded retry. |
| FAFF-757 | Run identifiers cannot collide under the supported concurrent and same-second starts. |
| FAFF-608 | An external watchdog classifies stale heartbeat state. First repair its stale dependency on completed FAFF-606. |
| FAFF-107 | Recovery and audit artifacts redact secrets and personal data before off-box publication. |
| FAFF-472 | A current sentry trip reaches the operator's andon channel. First remove the stale dependency on completed FAFF-386 and verify the remaining gap. |
| FAFF-779 | A decision-first failure surfaces correctly instead of churning the eligible pool. |
| FAFF-759 | Concurrent prep cannot claim the same ticket without a visible conflict outcome. |
| FAFF-744 | Remote-base resolution has a portable timeout and cannot wedge a scheduled runner indefinitely. |
| FAFF-214 | Incidental PR-body references cannot move completed sibling tickets back into active work. |

The new recovery-bundle, later-executor recovery, and decision-capture tickets join this set. They use the existing run ledger as canonical state. They do not introduce the generic journal or promise recovery of an in-progress shell, container, or uncommitted worktree.

## Required Phase 0B: outward proof and operator supervision

| Ticket | Required outcome |
|---|---|
| FAFF-588 | External-verification results are committed in-repository with their inputs and limitations. |
| FAFF-734 | A stranger can inspect the public L3 production run and its complete evidence path. Respect its dependency on FAFF-733. |
| FAFF-743 | The external-verification protocol is published and replayable. It follows FAFF-734 as recorded by the tracker. |
| FAFF-777 | Scope-drift false positives are measured and bounded on the reference L4 scenarios. |
| FAFF-781 | The operator receives admitted-work and work-start lifecycle notifications needed by the reference supervision exercise. |
| FAFF-668 | Public permission and appetite language states what `faff` checks and what the execution environment enforces. |
| FAFF-740 | Split or narrow the ticket so the Phase 0 release claims link to evidence at point of claim. The repository-wide remainder must not block Phase 0. |

The new reference-scenario ticket joins this set. It owns the nine v5 scenarios, the one-shot control where applicable, artifact discovery, redaction, assurance vectors, and the common audit-bundle schema. It does not own the later external-Commissaire proof.

## Required Phase 0 release path

| Ticket | Required outcome |
|---|---|
| FAFF-585 | A release is a pinned, consumable artifact rather than an unversioned view of `main`. |
| FAFF-174 | Skill-prose changes participate correctly in release automation. |
| FAFF-586 | The documented installation succeeds on a clean supported machine with prerequisites stated. |

These tickets make the evidence baseline reproducible by someone other than the maintainer. FAFF-776 is related repository administration, but it is routine rather than an evidence gate.

## Conditional Phase 0 upgrades

These tickets enter Phase 0 only when their condition is true. An honest lower assurance class is preferable to silently making every stronger posture a release blocker.

| Ticket | Entry condition |
|---|---|
| FAFF-516 | Carry if the reference scenarios use `--init` cages and claim the affected integrity-boundary attestation. Otherwise record the lower assurance class and hold the repair. |
| FAFF-763 | Carry the sentry-attendedness change only after its evaluation input is banked and the reference unattended posture selects it. |
| FAFF-614 | Run the human re-baseline sweep when FAFF-763, FAFF-605, or another covered posture change requires it. Do not invent direct tracker dependencies. |
| FAFF-629 | Add the natural production error-rate ring only if Phase 0 capacity remains after the seeded reference scenarios pass. |
| FAFF-474 | Carry only as the live-lane adapter needed by FAFF-629. It is not a baseline prerequisite by itself. |
| FAFF-605 | Carry a per-level environment-floor change only after the evaluation gate and only if the reference posture needs the new floor. |
| FAFF-597 | Carry the no-checkout evaluator job if Phase 0 claims the stronger code-blindness class. Otherwise publish the current attested class. |
| FAFF-381 | Carry the cage acceptance run only if a cage is part of the recommended reference posture. |

## Tracker reconciliation before admission

| Ticket | Reconciliation action |
|---|---|
| FAFF-748 | Verify the three completed relocation children satisfy the epic, then close it or write only the residual acceptance gap. Do not reopen completed implementation by carrying the parent. |
| FAFF-683 | Remove the stale relationship to completed FAFF-606. Close the ticket if the decision has already been made; otherwise rewrite it around the remaining reference-workflow decision. |

Reconciliation is not implementation capacity. If either ticket exposes a real Phase 0 gap, admit the narrowed residual under the same evidence rules as any other ticket.

## Four missing tickets

No identifiers are invented here. The next tracker grooming pass should create these from the following acceptance boundaries.

### Publish a Phase 0 recovery bundle

At each supported safe boundary, publish an immutable bundle containing the current run ledger, admitted-work outcomes, anchors and digests, artifact manifest, last safe boundary, unresolved effect records, contract or configuration fingerprints, and recovery instructions. Publication is off-box, redact-before-write, and idempotent for the same bundle identity. The current ledger remains canonical.

### Recover on a later executor

Kill a reference executor after a published safe boundary. On a later executor with no original `.faff/runs` directory, retrieve and verify the bundle, reconstruct projections, and either resume from the next safe stage or park with an explicit reason. Prove that no protected effect is repeated and that no in-progress workspace is claimed as recovered.

### Capture decision inputs and actions

For every replay point selected for Phase 1, record the named kernel version, complete normalised inputs, selected action, run and work-item identities, and causation reference. Missing inputs mark the point non-replayable. Decisions outside a named kernel are labelled uncovered rather than counted as divergence.

### Bank the Phase 0 reference matrix

Automate the nine scenarios from master v5, including normal completion, governance and independence failures, executor loss, stale evidence, effect ambiguity, exhausted budget, amendment, and correction. Emit a common audit bundle, one-shot control where applicable, human-intervention count, assurance vector, and honest claim label. Publish the protocol and results in the repository.

## Work held behind later phases or gates

The following 88 tickets remain valid backlog, but none is required to bank Phase 0. The exact live-set index below is normative for this snapshot.

- **Phase 2A external Commissaire proof:** FAFF-360 and FAFF-610.
- **Phase 2B treatment and one-shot comparison:** FAFF-499, FAFF-745, FAFF-310, FAFF-492, and the residual FAFF-316 audit.
- **Runtime contracts, packaging, and later product surface:** FAFF-70, FAFF-71, FAFF-72, FAFF-73, FAFF-74, FAFF-75, FAFF-41, FAFF-25, FAFF-602, FAFF-611, FAFF-729, FAFF-165, FAFF-517, and FAFF-612.
- **Executor substrate and live-workspace recovery:** FAFF-718, FAFF-726, FAFF-653, FAFF-649, FAFF-542, and FAFF-543.
- **Prompt economics:** FAFF-607, FAFF-487, FAFF-486, FAFF-419, FAFF-119, FAFF-501, FAFF-177, and FAFF-176.
- **Learning, routing, and grounding loops:** FAFF-452, FAFF-458, FAFF-459, FAFF-460, FAFF-461, FAFF-449, FAFF-450, FAFF-451, FAFF-453, FAFF-454, FAFF-13, FAFF-393, FAFF-28, FAFF-128, FAFF-330, and FAFF-331.
- **Harness portability:** FAFF-479, FAFF-480, FAFF-613, FAFF-701, FAFF-697, FAFF-674, FAFF-685, FAFF-423, and FAFF-506.
- **Evaluation breadth:** FAFF-206, FAFF-693, FAFF-688, FAFF-731, FAFF-730, FAFF-638, FAFF-637, FAFF-636, FAFF-168, and FAFF-167.
- **Autonomy expansion:** FAFF-388, FAFF-389, FAFF-390, FAFF-392, FAFF-12, FAFF-20, FAFF-39, FAFF-249, FAFF-216, FAFF-15, FAFF-22, FAFF-528, FAFF-33, FAFF-29, FAFF-104, and FAFF-509.
- **Automated effect recovery:** FAFF-489 and FAFF-37. Phase 0 parks and reconciles unknown effect state.

## Routine maintenance outside the phase gate

These 11 tickets may proceed by ordinary priority while Phase 0 runs. They neither satisfy nor block a Phase 0 exit criterion: FAFF-776, FAFF-769, FAFF-239, FAFF-721, FAFF-768, FAFF-771, FAFF-541, FAFF-511, FAFF-682, FAFF-438, and FAFF-412.

## Live-set disposition index

Each of the 131 tickets appears once in this index. This section is the audit surface for the snapshot; prose above may mention dependency tickets more than once.

| Disposition | Count | Tickets |
|---|---:|---|
| Required Phase 0 | 22 | FAFF-778, FAFF-639, FAFF-720, FAFF-465, FAFF-779, FAFF-759, FAFF-744, FAFF-214, FAFF-757, FAFF-608, FAFF-107, FAFF-588, FAFF-734, FAFF-743, FAFF-777, FAFF-472, FAFF-781, FAFF-668, FAFF-740, FAFF-585, FAFF-174, FAFF-586 |
| Conditional Phase 0 | 8 | FAFF-516, FAFF-763, FAFF-614, FAFF-629, FAFF-474, FAFF-605, FAFF-597, FAFF-381 |
| Tracker reconciliation | 2 | FAFF-748, FAFF-683 |
| Routine maintenance | 11 | FAFF-776, FAFF-769, FAFF-239, FAFF-721, FAFF-768, FAFF-771, FAFF-541, FAFF-511, FAFF-682, FAFF-438, FAFF-412 |
| Phase 2A | 2 | FAFF-360, FAFF-610 |
| Phase 2B | 5 | FAFF-499, FAFF-745, FAFF-310, FAFF-492, FAFF-316 |
| Contracts and productisation | 14 | FAFF-70, FAFF-71, FAFF-72, FAFF-73, FAFF-74, FAFF-75, FAFF-41, FAFF-25, FAFF-602, FAFF-611, FAFF-729, FAFF-165, FAFF-517, FAFF-612 |
| Executor substrate | 6 | FAFF-718, FAFF-726, FAFF-653, FAFF-649, FAFF-542, FAFF-543 |
| Prompt economics | 8 | FAFF-607, FAFF-487, FAFF-486, FAFF-419, FAFF-119, FAFF-501, FAFF-177, FAFF-176 |
| Learning and routing | 16 | FAFF-452, FAFF-458, FAFF-459, FAFF-460, FAFF-461, FAFF-449, FAFF-450, FAFF-451, FAFF-453, FAFF-454, FAFF-13, FAFF-393, FAFF-28, FAFF-128, FAFF-330, FAFF-331 |
| Harness portability | 9 | FAFF-479, FAFF-480, FAFF-613, FAFF-701, FAFF-697, FAFF-674, FAFF-685, FAFF-423, FAFF-506 |
| Evaluation breadth | 10 | FAFF-206, FAFF-693, FAFF-688, FAFF-731, FAFF-730, FAFF-638, FAFF-637, FAFF-636, FAFF-168, FAFF-167 |
| Autonomy expansion | 16 | FAFF-388, FAFF-389, FAFF-390, FAFF-392, FAFF-12, FAFF-20, FAFF-39, FAFF-249, FAFF-216, FAFF-15, FAFF-22, FAFF-528, FAFF-33, FAFF-29, FAFF-104, FAFF-509 |
| Effect recovery | 2 | FAFF-489, FAFF-37 |
| **Total** | **131** | |

## Admission order and capacity rule

The maintainer is the decision and review bottleneck, not the only producer. The always-on runner may prepare and build independent, well-specified tickets in parallel, but architecture decisions remain serial and the review queue controls effective capacity.

Admit work in this order:

1. repair the evidence-chain and queue-corruption defects;
2. add redact-before-publish and the recovery bundle;
3. prove later-executor recovery;
4. assemble the reference scenario fixtures;
5. fix remaining L3 reliability defects exercised by those fixtures;
6. complete the release and clean-install path;
7. publish the Phase 0 evidence baseline; and
8. admit conditional upgrades only when their trigger is true.

The runner may drain multiple independent tickets while median review age, rework, repeated parks, and merge conflicts remain within the maintainer's declared limits. When any limit is exceeded, stop admitting new builds and use capacity for review, repair, or decision closure. Do not parallelise competing decisions about identity, durability authority, assurance posture, or the reference protocol.

## Exit test

Phase 0 exits only when the v5 Phase 0A and Phase 0B criteria pass. Ticket closure is supporting evidence, not the gate itself. In particular:

- current ledgers remain canonical and their immutable recovery bundles are retrievable off-box;
- a later executor safely resumes or parks from a verified bundle;
- every admitted reference work item has an explicit run-membership disposition;
- protected effects are either proven once or left blocked for reconciliation;
- the nine reference scenarios emit inspectable audit bundles;
- a clean user can install the pinned release and reproduce the published protocol;
- public claims state the assurance actually achieved; and
- L3 reliability, review burden, and operator comprehension do not regress.

If a required ticket grows into runtime construction, split it. If a conditional ticket's trigger remains false, record the lower assurance class and leave it held. If the tracker changes, regenerate the live-set index before using this proposal for admission.
