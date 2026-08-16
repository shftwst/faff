# Critique of the v4 direction

**Status:** recorded review
**Date:** 2026-08-12
**Model:** GPT-5.6-sol
**Scope:** [critique-3](critique-3.md), [master v4](v4/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v4.md), the earlier RFC material in this directory, and the proposed [Phase 0 ticket carry-forward](phase-0-ticket-carry-forward.md), cross-checked against the current repository and tracker
**Repository code reviewed at:** `79563ac`
**Tracker reviewed:** 131 FAFF tickets in Backlog or Todo on 2026-08-12, comprising 104 Backlog and 27 Todo

## Bottom line

v4 is a sound revision of v3. Its main corrections should stand: journal authority must state its enforcement class, current ledgers need an explicit migration boundary, governance and coordination need separate gate questions, the external Commissaire proof must state what a solo operation can establish, and the surviving v2 assets need named homes.

The proposed v4 still has eight defects that affect implementation:

1. `run`, work item, executor attempt, and stage attempt are treated as one identity even though the current run ledger admits several issues per run;
2. Phase 0A writes an off-box journal before Phase 1 defines the migration boundary that must precede the first journal write path;
3. verification-time journal authority is called class C without requiring evidence that binds a record to its producer;
4. the lifecycle says every admitted run has four possible dispositions, but its transitions do not implement that rule and `Rejected` has two meanings;
5. Gate 1's governance question still claims recovery and correction benefits that belong to the shared durability layer or the coordinator;
6. the roadmap diagram sends a coordination-only outcome into Phase 4 even though the outcome table says it must stop at software-product hardening;
7. retention and compaction are specified before event volume or storage cost establishes a need; and
8. the solo-builder model still treats implementation capacity as roughly equal to one person's typing capacity, while this project already uses an always-on autonomous runner to prepare and build work.

v5 keeps v4's direction and corrects these points. The result remains an extraction and proof programme. It does not commit the project to a general runtime.

## What was reviewed

- [Critique-3](critique-3.md) and [master v4](v4/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v4.md)
- [Critique-2](critique-2.md), [critique-1](critique-1.md), and [master v3](v3/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v3.md)
- The v2 [plot input](v2/FAFF-PLOT-INPUT-v2.md), [roadmap](v2/FAFF-PROGRESSIVE-AUTONOMY-ROADMAP-v2.yaml), [master pack](v2/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v2.md), and [distributed-run note](v2/faff-distributed-evidence-recoverable-runs.md)
- The proposed [Phase 0 ticket carry-forward](phase-0-ticket-carry-forward.md)
- Current run-ledger documentation, deterministic queue and termination functions, watchers, experiment records, ADRs, decisions-register mechanics, and live FAFF tracker state

A proposed design was not counted as current capability unless code or recorded evidence supported it.

## Response to critique-3

### Accepted

- **Journal enforcement classes.** v3 claimed write-time protection that its no-daemon deployment could not provide. v4 correctly separates store-enforced, service-mediated, verification-time, and declared-only deployments.
- **Ledger migration boundary.** The journal must replace or translate current records per artifact. It cannot become another canonical history beside `events.jsonl`, `run-ledger.json`, anchors, and declared-effect records.
- **Separate governance and coordination questions.** Governance value does not buy a coordinator. The split is necessary.
- **Scope of the external proof.** A maintainer-controlled external producer can show protocol sufficiency, seeded detection, and replay stability. It cannot establish strong organisational independence.
- **Existing asset retention.** The implementation invariants, concept traceability, failure catalogue, ADR log, decisions-register mechanism, and harness-native adoption surface all need explicit treatment.
- **Phase 0 split.** Runner durability and outward L4 evidence have different deliverables and can overlap without becoming one release checklist.
- **Design-partner lead time and measured operator burden.** Partner search can start before integration, and timestamps are better evidence than remembered operator effort.

### Accepted with correction

#### Journal class C needs producer authenticity

v4 says that all producers may write while projection, sealing, and verdict code validates principal and event-type scope. This supports class C only when the validator can establish who produced the record. A self-declared `principal` field does not do that. If a worker can write `principal: commissaire` and produce an indistinguishable record, the deployment is class D regardless of later schema validation.

Class C therefore requires a producer-authentic record, for example a signature or MAC made with a key unavailable to conflicting producers, or an equivalent identity assertion supplied by an external trust boundary. Shared byte-write access can remain; authority comes from verification of the producer binding. Invalid records may be retained as anomalies but cannot enter an authoritative projection or seal.

This separates two properties that v4 partly combines:

| Property | Question |
|---|---|
| Byte acceptance | Could the producer place bytes in the store? |
| Record authority | Can the verifier prove which principal produced those bytes and whether that principal may produce the event type? |

Class A and B can prevent an invalid byte append. Class C can accept the bytes and deny them authority. Without producer authenticity, only a declared identity exists.

#### The migration boundary belongs before journal cutover, not before off-box durability

The intent of v4's ordering is right, but its Phase 0A and Phase 1 text conflict. Phase 0A requires an off-box journal. Phase 1 later defines the per-artifact migration boundary and says that boundary precedes the first journal write path.

The cheap correction is to keep current ledgers canonical throughout Phase 0A. Phase 0A publishes immutable off-box recovery bundles or replicas of current artifacts. Phase 1 maps current records and defines the cutover. Phase 2A introduces the domain-neutral journal envelope when the external producer becomes the second producer. No Phase 0 write invents a parallel canonical event vocabulary.

#### Terminal dispositions need separate admission and outcome names

Restoring cancellation and abandonment was correct. The v4 state machine remains inconsistent:

- `Rejected` is reachable only from `Proposed`, before admission, but the prose counts it as a disposition of admitted work;
- there is no terminal rejection path from governance review;
- cancellation is described as available from any non-terminal state but is absent from `Interrupted`, `EvidencePending`, `GovernanceReview`, and `CorrectionRequired`; and
- the prose alternates between the lifecycle of a contract, run, and task.

v5 separates `AdmissionRejected` from `OutcomeRejected`. Every admitted work item eventually reaches `AcceptedUnderContract`, `OutcomeRejected`, `Cancelled`, or `Abandoned`. A proposed contract may instead reach `AdmissionRejected` before a work item is admitted.

### Refuted or deferred

#### Retention classes are premature normative design

v4 adds indefinite governance retention, operational-event compaction, segment digests, and compaction-safe seals before the first new journal record exists. The proposal does not define when segment digests are created, which terminal seal binds them, or how an audit retrieves deleted records. A seal over individual events cannot later become a seal over a replacement digest without another attested transformation.

The problem is real but the solution is not yet earned. v5 retains all records for the proof phases, applies redaction before durable publication, measures volume and retrieval cost, and defers compaction to an ADR triggered by those measurements. That ADR must define the pre-compaction manifest, proof-preserving transformation, retrieval policy, and validation fixture.

#### A single global order is unnecessary

v4 describes one ordered fact stream and also introduces per-stream revision checks and lineage-head records. Current unattended runs admit multiple issues, and parallel work does not need an arbitrary total order across unrelated work items.

The required property is one canonical record system, not one global sequence. Ordering is strict within a named stream. Causation references connect streams. A run stream records admission and run-level decisions; each work item and effect may have its own stream. This reduces contention and matches current run-ledger semantics.

## Defects in the proposed v4

### 1. Identity is underspecified at the recovery boundary

The repository's `run-ledger.json` is one record per queue-drain run. It contains an admitted set and terminal outcome per issue. The v2 distributed-run note instead uses a run as one graft-like operation. v4 adopts the latter model without reconciling it with the former.

That ambiguity affects leases, retry, recovery, journal streams, terminal verdicts, and lineage heads. v5 names five identities:

| Identity | Meaning |
|---|---|
| Run ID | One bounded orchestration campaign, stable across scheduled resume and containing zero or more work items |
| Run-segment ID | One process or executor occupation of a run |
| Work-item ID | One admitted delegated outcome, normally mapped to one tracker issue in Software Delivery |
| Stage-attempt ID | One immutable attempt to perform a stage for a work item |
| Effect ID | One consequential external action with its own idempotency and reconciliation history |

The bare term `attempt ID` is avoided because run-segment retry and stage retry have different semantics.

### 2. The Gate 1 questions still share each other's evidence

Gate 1's governance qualifiers include safe recovery, lower operator burden, and reliable correction and resume. Recovery is a Phase 0A property. Correction and resume are coordination properties. Operator burden can be affected by either system.

The governance question should pass only on governance-specific value: a material independent catch, a contract or authority decision that changes the outcome, protected-effect prevention or detection, or terminal accountability that the control cannot provide at lower cost. The coordination question should consume control divergence, orchestration cost, retry and resume behaviour, and work-selection errors. Shared durability remains valuable under every outcome and is not bought again at Gate 1.

### 3. The coordination replay can become circular evidence

The current kernel does not prescribe every action the harness takes. `faff next` selects a high-level next step, `faff run-done` decides whether a run continues, and `queue-state` projects state. None is a complete coordinator.

A replay must therefore compare only decision points for which:

- the kernel function and version are named;
- all inputs available to the original caller were recorded;
- the harness action can be normalised to the kernel's output vocabulary; and
- consequence categories were defined before results were inspected.

Missing inputs are an instrumentation gap. A control-flow area with no kernel prescription is an unimplemented decision boundary. Neither is automatically a divergence. Before cutover, a shadow coordinator should run over the same recorded inputs so its decision coverage and cost can be compared without controlling live work.

### 4. The roadmap diagram contradicts the outcome table

The v4 diagram has `Phase 3 -> Phase 4` unconditionally. The outcome table says governance-no and coordination-yes builds Phase 3 only as software-product hardening and does not enter Phase 4. The table is the better rule. v5 makes the four-outcome matrix authoritative and removes the misleading unconditional edge.

### 5. The operating model understates autonomous build capacity

Review bandwidth is scarce, as v4 says. Implementation throughput is not limited to one person's hands. The project dogfoods an always-on runner that can prepare and build several well-specified tickets while the maintainer steers, reviews, resolves parks, and makes product decisions.

The roadmap should use that capacity rather than sequence all work as if the maintainer implements every issue. The safe model is:

- one active architecture decision frontier;
- several independent, already-specified build tickets when their write and merge boundaries permit it;
- explicit work-in-progress limits derived from review queue age and rework, not a fixed issue count;
- autonomous preparation and build for routine slices;
- human attention reserved for ambiguous decisions, acceptance of evidence, policy changes, and gate outcomes.

This does not justify parallel framework construction. It changes how a settled phase is drained.

## Review of the proposed Phase 0 ticket carry-forward

The document provides a useful first classification, but it should not be used as the Phase 0 queue without revision.

### Current-state corrections

- The live set is 131 tickets, not 130: 104 Backlog and 27 Todo.
- FAFF-748 is a stale Backlog epic. Its implementation children FAFF-749, FAFF-750, and FAFF-751 are Done. The epic should be reconciled, not carried as open implementation.
- FAFF-316 says its original L4 audit was completed. Its residual scope depends on later greenfield and merge-floor evidence, so it is not a Phase 0 trust-critical ticket.
- FAFF-542 and FAFF-543 are cage-owned interval-checkpoint proposals. v4 explicitly defers live workspace migration and requires restart from a safe stage boundary. They should not be absorbed into Phase 0 as a generic periodic-snapshot requirement.
- FAFF-597 and FAFF-381 are assurance upgrades conditional on the chosen reference posture. They are not release blockers under the recorded-vector rule.
- FAFF-492, FAFF-499, FAFF-310, and FAFF-745 are Phase 2B treatment-arm work. Calling them carried while saying they are outside Phase 0 obscures the gate.
- FAFF-776 completes contributor administration but does not establish runner durability or outward L4 evidence. It belongs in routine maintenance.

### Missing work

The listed open tickets do not collectively deliver Phase 0A. Run-ID hardening, a watchdog, redaction, and a reference-workflow decision do not provide off-box recovery or prove safe reconstruction after executor loss.

The revised carry-forward therefore proposes explicit new slices, without inventing ticket identifiers:

1. publish an immutable off-box recovery bundle from current run artifacts at safe boundaries;
2. reconstruct and resume or park on a later executor without the original local directory;
3. record kernel decision inputs and chosen actions for later fidelity replay; and
4. assemble the repeatable Phase 0B scenario matrix and common audit bundle.

## What v4 resolved well

The following decisions remain unchanged in v5:

- extraction of the decision kernel before broader construction;
- an ephemeral bounded coordinator unless measured triggers require a service;
- external Commissaire proof and a strong one-shot comparison before general runtime work;
- explicit effect assurance and independence vectors;
- `accepted_under_contract` rather than an unqualified quality claim;
- a real internal second use as abstraction pressure, followed conditionally by a distant design partner;
- the current `faff` surface as a product asset throughout migration; and
- product and package decisions after evidence establishes the earned shape.

## Verdict

Proceed on v4's strategic direction with the corrections recorded in [master v5](v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md). Phase 0 should preserve current ledgers as canonical while publishing recoverable off-box bundles. The generic journal starts only after the migration map exists and a second producer needs the envelope. Journal class C requires verifiable producer identity. Gate 1 must attribute each claimed benefit to the layer that produced it. The programme should exploit autonomous build capacity while keeping architecture decisions and evidence acceptance under deliberate human steering.
