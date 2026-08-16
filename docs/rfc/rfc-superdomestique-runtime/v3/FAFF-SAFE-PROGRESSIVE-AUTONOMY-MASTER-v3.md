# SuperDomestique safe progressive autonomy: master direction v3

Status: proposed  
Date: 2026-08-11  
Decision owner: project maintainer  
Planning horizon: evidence-gated, not calendar-gated

## Document authority

This document is the normative strategic direction for evolving SuperDomestique and Commissaire from the current repository.

It supersedes the planning sequence and proposed product architecture in [master v2](../v2/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v2.md) and [roadmap v2](../v2/FAFF-PROGRESSIVE-AUTONOMY-ROADMAP-v2.yaml). It does not rewrite their historical evidence, experiment records, or prior decisions.

The supporting [critique](../critique-2.md) records the cross-checks and reasons for the revision. The earlier [review](../critique-1.md), [plot input](../v2/FAFF-PLOT-INPUT-v2.md), and [distributed-run note](../v1/faff-distributed-evidence-recoverable-runs.md) remain source material rather than parallel plans.

When this document and an older planning document conflict, this document controls. Implementation facts in the repository still outrank proposed design.

## Executive decision

Evolve outward from the current L3 runner. Do not start by constructing a generic automation platform.

The programme will:

1. make the current unattended runner easier to trust, recover, and supervise;
2. map and characterise the deterministic control kernel already present;
3. prove that Commissaire adds value to execution it did not orchestrate;
4. compare that value with the existing one-shot baseline;
5. wrap current skills and primitives in a thin deterministic coordinator only if the proof earns its cost; and
6. pursue domain packs or a broader runtime only after a real second use creates evidence for them.

The intended product shape remains open. Three outcomes are acceptable:

- a broader protocol-driven SuperDomestique runtime with domain packs;
- reusable Commissaire governance with a software-focused SuperDomestique runtime; or
- stronger internal boundaries that improve software-delivery L3 and L4 without a separate horizontal product.

This is progressive autonomy in two senses. Individual runs receive no more authority than their evidence supports, and the product receives no more generality than observed use supports.

## Product and naming

The public product is SuperDomestique. Commissaire is its governance system. `faff` remains the literal name of the current repository, plugin, CLI, commands, configuration, paths, and historical records.

[Names and language](../../../concept/positioning-and-language.md) remains authoritative. Naming stability is tied to the product-shape gate in Phase 5, not to an arbitrary one-to-two-month freeze.

No new public product name is introduced by this RFC.

## Current truth

### What is already valuable

- L3 can run unattended on a runner and can automate most of a build for a solo builder.
- The existing tracker, CLI, skills, and review flow are the adoption surface. They should remain usable throughout extraction.
- L4 is a preview and its strongest independence claims still need outward evidence.
- The current implementation already includes deterministic queue selection, run completion, queue projection, budgets, gates, liveness, resume, and merge handling.
- A governance and factory dependency boundary is already checked in code.
- Existing external verification includes a one-shot baseline in which all nine recorded control tasks worked.

### What is not yet proven

- A generic runtime is not yet shown to be more valuable than a well-instructed one-shot runner for ordinary successful builds.
- Commissaire has not yet been proven as a small, execution-independent governance system through a stable external protocol.
- L4 evidence has not yet demonstrated all claimed separation properties in a clean outward setting.
- Runner-local state is not durable enough to support strong recovery claims across executor loss.
- An internal software-adjacent second use would not, by itself, prove a horizontal market.
- A standing hosted runtime is neither required nor currently evidenced.

### Strategic consequence

This is primarily an extraction, assurance, and product-proof programme. New platform construction is conditional work.

## Goals

1. Preserve and improve L3 while the architecture evolves.
2. Make unattended runs reconstructable without transcript replay or a surviving runner.
3. Keep probabilistic work inside workers and deterministic lifecycle decisions inside explicit code.
4. Make governance claims precise enough to be independently tested.
5. Let external workflows use Commissaire without pretending SuperDomestique orchestrated them.
6. Retain one canonical ordered history for operational and governance facts.
7. Provide a credible path to a broader runtime without committing to it early.
8. Keep the operating and maintenance burden appropriate for a solo builder.

## Non-goals

This RFC does not commit to:

- a long-running daemon;
- a hosted multi-tenant control plane;
- live workspace migration between runners;
- a domain-pack marketplace;
- a universal policy language;
- a second public product;
- replacing the current tracker, CLI, or skills before a thin compatible path works;
- claiming human-equivalent judgement from deterministic evidence bookkeeping; or
- requiring a second human for every L4 run.

## Design principles

### Preserve the working surface

The current runner, tracker, CLI, and skills are the migration surface, not disposable scaffolding. An extraction that makes common L3 work harder is a regression unless it removes a measured failure mode of greater value.

### Extract before generalising

Start with current primitives and one end-to-end vertical slice. Stabilise a protocol only after two concrete producers or consumers need it.

### One history, multiple meanings

Operational coordination and governance may project the same ordered run history differently. They must not maintain competing canonical mutable state.

### Executor completion is a claim

A worker can report that it finished. Only Commissaire can append the governance verdict that the run is `accepted_under_contract`.

### Assurance must be named

An effect observed after execution is not an effect prevented before execution. A second prompt is not necessarily an independent reviewer. Every result carries the assurance actually achieved.

### Failure should reduce scope, not erase value

Early work must remain useful if the horizontal thesis fails. Each roadmap item records whether it retains value in horizontal, mixed, and software-focused outcomes.

### Operate in bounded segments

The first runtime process is ephemeral. Each runner or cron firing rebuilds state, performs a bounded amount of work, records durable facts, and exits. A service becomes justified only when measured requirements cannot be met this way.

## Target architecture

### Logical components

```mermaid
flowchart TB
    U[Tracker, CLI, and current faff skills]
    P[Software Delivery policy<br/>compatibility and domain meaning]
    R[SuperDomestique control kernel<br/>queue, lifecycle, lanes, and intervention]
    W[Workers and external runtimes]
    J[(Run journal and content-addressed artifacts<br/>one ordered fact stream)]
    C[Commissaire<br/>authority, evidence, effects, and conformance]
    X[External-execution bridge]

    U --> P --> R
    R -->|assignments| W
    R -->|operational events| J
    W -->|artifacts, claims, and observations| J
    J -->|governed facts| C
    C -->|verdict events| J
    J -->|verdicts and rebuilt projection| R
    J -->|tracker projection| U
    X -->|the same fact protocol| J
```

### Responsibility table

| Component | Owns | Does not own |
|---|---|---|
| Current faff surface | User commands, tracker interaction, compatible skill workflows, configuration | Canonical runtime or governance state |
| Software Delivery policy | Stage meaning, software artifacts, checks, branch and PR semantics, delivery-specific defaults | Generic run ordering or governance verdict storage |
| SuperDomestique control kernel | Eligibility, assignment, lanes, leases, attempts, correction, park, resume, bounded-cycle decisions | Acceptance authority, domain-specific quality meaning, artifact bytes |
| Worker | Probabilistic execution, artifact production, claims, observations | Admission, protected-effect authority, terminal acceptance |
| Run journal | Ordered append, stream revision, idempotency, integrity, artifact references, conditional writes | Operational or governance policy meaning |
| Artifact store | Immutable, content-addressed evidence and workspace snapshots | Lifecycle decisions |
| Commissaire | Contract admission, authority, evidence requirements, effect decisions, reconciliation, waivers, terminal conformance | Work scheduling, worker selection, tracker presentation |
| External bridge | Translation of external execution facts into the common protocol | Pretending external work was coordinated by SuperDomestique |

### SuperDomestique as a reference coordinator

The initial SuperDomestique runtime is the reference implementation of four small protocols:

1. assignment;
2. control decision;
3. run record; and
4. protected effect.

External runtimes may implement the same protocols or may use only the external-execution bridge. Domain logic should not depend on a particular process manager, queue product, or hosting topology.

This protocol stance is more useful than declaring a standalone platform before another runtime needs to interoperate.

## Canonical run record

### Journal requirements

The run journal is append-only and neutral. At minimum, each record carries:

- run ID and execution-attempt ID;
- stream revision and event ID;
- event type and schema version;
- producer and acting principal;
- correlation and causation references;
- observed time and recorded time;
- payload digest and immutable artifact references;
- expected prior revision for conditional append; and
- integrity metadata sufficient to detect missing, reordered, or altered records.

Repeated delivery of the same event ID is idempotent. A write against a stale expected revision fails and is reconciled rather than silently overwriting state.

Stream revision defines order. Producer-supplied observation time may explain causality, but it cannot reorder the canonical stream.

### Append authority

The journal authenticates each producer and restricts which event types it may append:

- SuperDomestique may append assignments, leases, attempt lifecycle, and control decisions;
- workers may append their own claims, artifact references, heartbeats, and observations;
- Commissaire alone may append admissions, governance-gate decisions, waivers, protected-effect decisions, reconciliation verdicts, and terminal verdicts; and
- an external bridge may append only the fact types granted to its authenticated external producer.

Storage enforcement protects these type scopes. A payload claiming to be a Commissaire verdict has no authority when appended under a worker or bridge principal.

### Run and attempt identity

A logical run ID is stable across runner loss and retry. Each execution obtains a new attempt ID. Evidence from a failed or expired attempt remains in the journal and cannot be relabelled as evidence from its successor.

This distinction allows safe retry without hiding duplicated work or prior side effects.

### Artifacts and workspace snapshots

Large evidence stays outside the journal in content-addressed storage. Journal records carry digests, locations, media types, producers, and production context.

A workspace snapshot is an immutable artifact that can seed a later attempt. It is not a mutable checkpoint database and does not become canonical state. Branch references may be recorded as durable recovery inputs when their commit identities are fixed.

### Projections

Queue state, run status, tracker status, governance summary, and operator views are rebuildable projections. They may be cached, but a cache is discardable.

If a projection and the journal disagree, the journal wins. If an external system disagrees with the journal, reconciliation appends observations and decisions rather than rewriting history.

### Terminal safety rule

No partial or truncated journal may produce a canonical accepted result. A terminal verdict requires:

- a complete lineage from admitted contract to candidate result;
- all mandatory evidence references;
- a current governance verdict appended at the expected stream revision; and
- an evidence seal that covers the terminal lineage.

Later observations can append a superseding reconciliation verdict. They do not edit the earlier verdict.

## Runtime locus and cycle

No daemon is required for the first implementation.

Each scheduled firing or manual invocation runs the same bounded cycle:

```mermaid
flowchart LR
    A[Load journal and rebuild projections]
    B[Expire or reconcile stale attempts]
    C[Compute eligible work]
    D[Emit one assignment and lease]
    E[Invoke the current skill or worker]
    F[Record artifacts, claims, and observations]
    G[Request Commissaire decision]
    H[Compute next action]
    I{Budget or stop condition reached?}
    J[Persist summary and exit]

    A --> B --> C --> D --> E --> F --> G --> H --> I
    I -->|no| C
    I -->|yes| J
```

The cycle may park instead of assigning work, request correction, or stop because no work is eligible. Those are explicit outcomes, not prompt-level conventions.

### Trigger for a durable service

A long-running coordinator or hosted control plane is considered only when one or more of these are measured:

- required reaction latency is shorter than practical scheduled firings;
- lease renewal must continue while workers run independently for long periods;
- concurrent writers cause material conditional-append contention;
- event volume makes bounded projection rebuilds too slow even with snapshots;
- an external design partner requires a stable network endpoint; or
- operator burden from ephemeral invocations exceeds the service's operating burden.

Until then, a daemon is optional infrastructure without proven product value.

## Lifecycle and recovery

### Normative lifecycle

```mermaid
stateDiagram-v2
    [*] --> Proposed
    Proposed --> Admitted: contract admitted
    Proposed --> Rejected: contract inadmissible
    Admitted --> Ready: prerequisites satisfied
    Ready --> Leased: assignment recorded
    Leased --> Executing: attempt started
    Leased --> Ready: lease expired before start
    Executing --> EvidencePending: worker completed or stopped
    Executing --> Interrupted: heartbeat or executor lost
    Interrupted --> Ready: reconciliation authorises retry
    EvidencePending --> GovernanceReview: required evidence present
    EvidencePending --> Parked: evidence cannot be completed automatically
    GovernanceReview --> AcceptedUnderContract: no blocking verdict remains
    GovernanceReview --> CorrectionRequired: correctable failure
    GovernanceReview --> Blocked: policy or evidence failure
    CorrectionRequired --> Ready: corrected scope admitted
    Parked --> Ready: operator resolves park
    Blocked --> Ready: new contract revision or waiver admitted
    Rejected --> [*]
    AcceptedUnderContract --> [*]
```

The diagram names logical states. Implementations record events and derive these states rather than mutating a row without history.

### Leases and liveness

Leases are runtime coordination, not governance authority. Acquisition, renewal, release, and expiry are journalled. A lease grants the right to attempt assigned work for a bounded interval. It does not grant permission for protected effects.

Heartbeats show liveness but do not prove progress or quality. Lease expiry marks an attempt interrupted or suspect and starts reconciliation. It never silently transfers evidence to a new attempt.

### Minimal runner durability

Before broader runtime extraction, scheduled L3 and preview L4 runs must support:

- machine-independent run identity;
- distinct attempt identity per executor;
- off-box journal and summary publication at stage or build boundaries;
- durable commit, branch, and terminal artifact references where applicable;
- deterministic interrupted-attempt detection;
- recovery on a later invocation without a surviving local ledger; and
- a killed-executor fixture proving that partial history cannot become accepted.

Live process continuation and transparent cross-machine workspace migration remain deferred. Recovery begins at a safe stage boundary from immutable artifacts.

## Commissaire contract

### Minimum facade

The first external facade contains only operations needed for the proof:

1. admit a versioned contract;
2. append or register facts and evidence;
3. request a protected-effect decision;
4. request a terminal conformance verdict;
5. append observations and reconciliation outcomes; and
6. seal and export an audit bundle.

Queueing, worker assignment, scheduling, and domain-specific stage logic stay outside this facade.

### Contract admission

Admission answers whether the proposed work is governable under a named contract version. It checks required identities, authority, evidence obligations, protected effects, terminal criteria, and declared independence requirements.

Admission does not assert that the work will succeed. A material contract change creates a new revision and a new admission decision.

### Governance gates

A governance gate is a decision point that can allow, deny, require correction, require more evidence, park, or escalate. Avoid `governance checkpoint` because `checkpoint` has been used for both governance evaluation and workspace state.

### Terminal verdict

The positive terminal verdict is `accepted_under_contract`, not simply `complete` or `good`.

Its assurance summary includes:

- contract identity and revision;
- terminal criteria evaluated;
- evidence coverage and seal;
- unresolved observations or waivers;
- review-independence vector;
- effect-control assurance by effect; and
- the Commissaire rule and implementation versions that produced the verdict.

Worker completion, test success, merge, deployment, and acceptance are separate facts.

### Evidence vocabulary

Use these terms consistently:

| Term | Meaning |
|---|---|
| Contract admission | Initial decision that a proposed run can be governed under a versioned contract. |
| Governance gate | An authority, evidence, effect, or conformance decision within the admitted run. |
| Workspace snapshot | Immutable content-addressed material from which a later attempt can restart. |
| Evidence seal | Integrity commitment over the evidence and event lineage used for a verdict. |
| Lineage commit | Commitment that binds an artifact or decision to its causal predecessors. |

There is one admission per contract revision. A lineage commit is not a second admission.

## Protected effects

Every consequential effect declares the strongest mechanism actually enforcing it.

| Class | Enforcement | Permitted claim |
|---|---|---|
| A | External enforcement outside the worker trust domain, such as branch protection | The effect could not occur unless the external rule allowed it. |
| B | Mediated gateway using a scoped credential unavailable to the worker | The effect could not occur through the governed path unless the gateway allowed it. |
| C | Independent observation after the attempt | An unauthorised or mismatched effect can be detected and reconciled. |
| D | Worker or coordinator self-attestation | The system reports that it followed the expected rule. |

Only A and B satisfy a claim that an effect was blocked before execution. C may still support strong detection and recovery. D supports debugging and audit context, not independent enforcement.

The contract sets a minimum class per effect. A terminal verdict cannot silently substitute a weaker class.

## Independence model

Independence is recorded as a vector, not a Boolean:

| Dimension | Examples |
|---|---|
| Invocation and principal | Separate process, identity, credential, or operator |
| Lane history | No actor occupies conflicting author, reviewer, or judge lanes |
| Context lineage | Fresh context, isolated prompt history, no private chain inherited |
| Model | Different model instance, family, or provider |
| Workspace and capabilities | Read-only code access, code-blind environment, separate network or effect credentials |
| Artifact version and timing | Reviewer sees a fixed digest produced before review begins |

The solo-builder default for an L4 adversarial review is:

- a distinct invocation;
- fresh context;
- conflicting-lane exclusion;
- a fixed candidate artifact digest; and
- a different model family from the primary authoring worker.

Code-blind environment evaluation and stronger credential separation are required when the contract says they are enforceable and material. A human remains an escalation path, not a mandatory participant in every successful run.

A reference run initiated by a non-author operator strengthens outward evidence when practical. Its presence or absence is recorded in the assurance vector and does not replace the technical separation requirements.

## Operator comprehension

Every bounded invocation publishes one durable run summary. A maintainer should not need a worker transcript to answer:

- What was attempted?
- What is the current logical state?
- Which attempt and worker acted most recently?
- Which contract and policy versions applied?
- Which evidence is present or missing?
- Why did the run continue, stop, park, block, or request correction?
- Which protected effects occurred and under what assurance class?
- What is the next permitted action?
- Is human intervention required?

The tracker remains a projection and navigation surface. The sealed audit bundle remains the inspectable source for a terminal verdict.

## Proof strategy

### Proof ladder

Evidence increases in cost only when the preceding question is answered positively.

```mermaid
flowchart LR
    A[Current L3 and L4 fixtures]
    B[External Commissaire scenario]
    C[One-shot comparison]
    D[Thin coordinator]
    E[Internal second use]
    F[External design partner]

    A -->|runner trust| B
    B -->|governance value| C
    C -->|cost justified| D
    D -->|abstraction survives| E
    E -->|value remains| F
```

### Required reference scenarios

The first proof set contains at least:

1. a successful run;
2. a seeded governance block;
3. an executor killed after partial evidence publication;
4. an incomplete or stale evidence submission;
5. a protected-effect mismatch; and
6. a correction or resume path.

Each scenario is reproducible in a clean outward repository or fixture environment and exports the same form of audit bundle.

### External Commissaire proof

The proof must govern work that SuperDomestique did not schedule. Suitable first candidates are:

- a manually executed one-shot software task; or
- a real internal eval-baseline update workflow.

The external producer submits through the common run-record protocol. Commissaire admits the contract, evaluates evidence and protected effects, appends verdicts, and exports the audit bundle. The proof fails if it requires importing the whole current orchestration stack.

### One-shot comparison

Reuse the existing faff-lab design rather than inventing a weak control. Compare a matched treatment using the same task, repository state, model budget, and outcome criteria where practical.

The comparison asks whether the governed treatment adds value in:

- pre-execution qualification;
- independent catches;
- false-block rate;
- recovery after interruption;
- operator time;
- audit completeness;
- repeated-run consistency; and
- total execution and maintenance cost.

The treatment need not win every dimension. It must show a valuable pattern that simpler logs, CI status, branch protection, and a well-instructed one-shot worker do not provide at lower cost.

### Internal second use

An eval-baseline workflow is the preferred first abstraction-pressure test because it is real, available, and meaningfully different in lifecycle and evidence. It remains software-adjacent and human-supervised, so success does not support a broad horizontal claim.

A synthetic supplier workflow is a fallback for conformance mechanics only.

### External design partner

Pack SDK, marketplace, and broad runtime positioning wait for one real workflow owned by a party with different incentives, terminology, artifacts, and effects. The partner must adopt the protocol without requiring repository-specific internal knowledge.

## Measures

The programme maintains one scorecard across the proof ladder.

| Dimension | Measure |
|---|---|
| Reliability | Runs or bounded segments that reach the correct durable outcome without lost state |
| Recovery | Interrupted attempts detected and safely resumed or parked on the next eligible invocation |
| Autonomy | Eligible work completed without maintainer intervention |
| Operator burden | Maintainer minutes required to understand and resolve a run |
| Governance yield | Material seeded and natural issues caught before acceptance |
| False blocks | Valid outcomes prevented or parked without a contract-supported reason |
| Assurance | Required independence and effect-control classes actually achieved |
| Evidence quality | Required lineage present, sealed, exportable, and reconstructable |
| Economics | Compute, model, storage, and maintenance cost relative to one-shot execution |

Each experiment records raw counts and denominators. "Mostly autonomous" and "safer" are not accepted as unmeasured conclusions.

Before product claims, the proof set must at least show:

- all seeded blocks detected for the declared rule set;
- no accepted terminal result from the killed-executor or incomplete-journal fixtures;
- successful stage-boundary recovery without the original runner-local ledger;
- no conflicting-lane violation in the reference L4 scenarios;
- an operator-readable outcome from one durable summary; and
- a matched one-shot comparison with costs and limitations reported.

Natural catch rate and false-block rate require longer observation and must not be inferred from seeded fixtures alone.

## Roadmap

### Roadmap shape

```mermaid
flowchart LR
    A[Phase 0<br/>Bank current value]
    B[Phase 1<br/>Map and characterise]
    C[Phase 2A<br/>External Commissaire]
    D[Phase 2B<br/>One-shot baseline]
    E{Gate 1<br/>Governance earns cost?}
    F[Phase 3<br/>Thin coordinator]
    G[Phase 4<br/>Real second use]
    H{Gate 2<br/>Horizontal value?}
    S[Software-focused outcome]
    N[Mixed outcome]
    P[Broader runtime outcome]

    A --> B
    B --> C
    B --> D
    C --> E
    D --> E
    E -->|no| S
    E -->|yes| F
    F --> G
    G --> H
    H -->|no| S
    H -->|mixed| N
    H -->|yes| P
```

Phase numbers describe decision order, not release versions. Phase 2A and Phase 2B run as one bounded comparison effort.

### Phase 0: bank current value

Objective: make the current unattended product and preview governance claims safe enough to serve as the baseline.

Deliverables:

- an inventory of L3 and L4 correctness gaps, separated from polish;
- successful, seeded-blocked, and executor-killed outward reference scenarios;
- machine-independent run IDs and per-attempt IDs;
- off-box stage-boundary journal, summary, and terminal artifact publication;
- deterministic interrupted-attempt detection and safe next-invocation recovery;
- an operator summary that answers the comprehension questions in this document; and
- release notes that distinguish implemented assurance from proposed architecture.

Exit evidence:

- the reference fixtures are repeatable from a clean runner context;
- no killed or partial attempt can produce `accepted_under_contract`;
- later invocation can reconstruct and safely resume or park without the original local ledger;
- seeded independence and evidence failures produce founded block or park reasons; and
- current L3 operation has not regressed.

Retained value: horizontal yes; mixed yes; software focused yes.

Constraints:

- do not block L3 reliability fixes on future contracts;
- do not require a standing hosted runner; and
- do not claim broad L4 independence beyond the recorded vector.

### Phase 1: map and characterise the current kernel

Objective: identify the smallest extraction boundary without duplicating current behaviour.

Classify relevant repository paths into five buckets:

1. Commissaire governance;
2. deterministic runtime kernel;
3. Software Delivery policy;
4. harness and skill orchestration; and
5. external adapters and infrastructure.

Deliverables:

- dependency and data-flow maps rooted in the current region checker;
- characterisation tests for representative L2, L3, and preview L4 decisions;
- a state-authority map showing every canonical, cached, projected, and external state source;
- a selected vertical slice from admission through terminal verdict; and
- only the ADRs required to implement that slice.

Exit evidence:

- every state-changing step in the slice has one named owner and durable fact;
- existing queue, run completion, gate, budget, and liveness semantics are either retained or intentionally changed with tests;
- no second queue or lifecycle implementation is proposed without an explicit replacement boundary; and
- the first slice can be delivered behind the current faff surface.

Retained value: horizontal yes; mixed yes; software focused yes.

### Phase 2A: prove execution-independent Commissaire

Objective: determine whether Commissaire is independently useful before building a generic runtime.

Deliverables:

- the minimum facade defined in this document;
- the neutral journal envelope needed by one external producer;
- one externally executed governed workflow;
- pass, seeded-block, stale-evidence, effect-mismatch, and killed-producer fixtures; and
- an exported sealed audit bundle and operator summary for each outcome.

Exit evidence:

- the external producer does not import SuperDomestique scheduling or skills;
- Commissaire produces founded decisions from protocol facts and evidence;
- replay from the journal reproduces the same verdict projection;
- weaker effect or independence assurance cannot silently satisfy a stronger contract; and
- the integration is materially smaller than adopting the whole current faff workflow.

Retained value: horizontal yes; mixed yes; software focused yes.

### Phase 2B: run the existing one-shot comparison

Objective: determine whether governance and recoverability justify their operational cost.

Deliverables:

- one matched treatment using the existing one-shot experiment design;
- failure and interruption scenarios, not just happy paths;
- operator-time, execution-cost, evidence, catch, and false-block results; and
- a written account of which benefits ordinary CI controls already provide.

Exit evidence:

- the result is reproducible;
- the one-shot control is represented at full strength;
- unique value and added cost are both visible; and
- limitations and negative results are retained.

Retained value: horizontal yes; mixed yes; software focused yes.

### Gate 1: does governance earn its cost?

Proceed to Phase 3 only if the combined Phase 2 evidence shows at least one material, repeatable advantage over the strong one-shot control, and the advantage matters for unattended operation.

Qualifying advantages include:

- a material issue caught before acceptance by an independently assured lane;
- safe recovery from interruption that the control cannot match without equivalent machinery;
- materially lower repeated-run operator burden;
- a useful audit or authority property required by a real workflow; or
- reliable correction and resume behaviour across multiple attempts.

Do not proceed merely because the facade works or produces cleaner logs.

Seeded failures prove that enforcement mechanics work. They do not, by themselves, establish product value. At least one qualifying advantage must come from a real workflow or the matched comparison.

If the gate fails, keep the journal, recovery, summaries, and useful governance checks inside the software-delivery product. Do not build a generic coordinator.

### Phase 3: extract the thin deterministic coordinator

Objective: replace prompt-interpreted orchestration with the narrowest explicit cycle that preserves current product behaviour.

The first coordinator performs only:

1. load and project;
2. reconcile stale attempts;
3. compute ready work;
4. assign one unit under a lease;
5. invoke the current skill or worker adapter;
6. record results;
7. request Commissaire decisions;
8. compute the next action; and
9. stop, park, or repeat within a bounded budget.

Deliverables:

- assignment, control-decision, run-record, and effect protocols for the selected slice;
- an ephemeral reference coordinator;
- compatible current CLI, tracker, and skill entry points;
- stage-boundary retry and resume; and
- side-by-side characterisation against the previous orchestration path.

Exit evidence:

- the selected L3 path runs without an LLM interpreting control flow;
- probabilistic decisions are explicit worker outputs, not hidden lifecycle mutations;
- the journal can reconstruct every coordinator decision;
- current user-facing operation remains recognisable; and
- the new path improves or preserves the Phase 0 scorecard.

Retained value: horizontal yes; mixed yes; software focused yes.

### Phase 4: apply real second-use pressure

Objective: learn whether the protocols describe more than the software-delivery path that produced them.

Step 1 uses a real internal eval-baseline workflow. It should exercise different artifacts, evidence, correction, and terminal semantics while using the same journal and Commissaire facade.

Step 2 occurs only if Step 1 remains promising. It uses one distant design partner with a real workflow. The partner integration should expose missing semantics rather than being forced into Software Delivery vocabulary.

Deliverables:

- a thin internal domain binding with no copied runtime kernel;
- a record of protocol changes forced by the second use;
- a comparison with a simpler baseline for that workflow; and
- if justified, a design-partner integration brief and result.

Exit evidence:

- shared protocols remain small after real pressure;
- domain meaning stays outside the kernel and Commissaire;
- the new workflow receives measurable value beyond uniform logging; and
- maintenance burden remains viable for a solo builder.

Retained value: horizontal yes; mixed partly; software focused only where shared improvements return to L3 or L4.

### Gate 2: what product shape did the evidence earn?

Classify the outcome:

| Evidence | Product decision |
|---|---|
| The internal and external second uses adopt the protocols with limited special casing and gain measurable value | Build the pack SDK and broader SuperDomestique runtime deliberately. |
| Commissaire transfers cleanly but runtime coordination remains software-specific | Publish or reuse Commissaire; keep SuperDomestique focused on software delivery. |
| Neither transfers cleanly or the operating cost dominates | Keep the internal boundary improvements and stop horizontal productisation. |

This gate settles whether physical package, repository, and public-product boundaries should change.

### Phase 5: productise only the earned shape

Possible work after Gate 2 includes:

- stable protocol versioning and compatibility policy;
- pack authoring and conformance tooling;
- a network service if measured triggers require it;
- provider or authorisation adapters backed by real demand;
- a cross-domain operator surface; and
- public positioning for the chosen product shape.

None of these is implied work in earlier phases.

Retained value depends on the selected outcome and must be stated per project before work begins.

## Mapping from roadmap v2

This table prevents useful work from disappearing while removing the old dependency order.

| V2 project | V3 treatment |
|---|---|
| P0 L4 reference release | Split into Phase 0 runner hardening and honest outward L4 evidence. No freeze on L3 work. |
| P1 current-main inventory | Retained as Phase 1, expanded to five buckets and state authority. |
| P2 contracts and architecture boundaries | Reduced to just-in-time ADRs and the minimum protocols required by Phases 1 to 3. |
| P3 Commissaire facade | Moved earlier to Phase 2A and cut to the external proof surface. |
| P4 runtime vertical slice | Deferred to Phase 3, after Gate 1. Extracted around current primitives. |
| P5 Software Delivery pack and compatibility | Compatibility is required throughout. A formal pack waits for the selected slice and second-use pressure. |
| P6 second-domain proof | Replaced by Phase 4 internal real use, followed conditionally by a distant design partner. |
| P7 adapter proof | Adapters are added only when a proof needs them. General adapter architecture is deferred. |
| P8 execution-independent Commissaire | Moved earlier to Phase 2A. |
| P9 generic control-plane UX | Replaced initially by the durable run summary. Generic UX waits for cross-domain demand. |
| P10 competitive falsification | Moved earlier to Phase 2B and paired with the external governance proof. |
| P11 optional productisation | Retained as Phase 5 after a stronger product-shape gate. |

Existing PA2 issue identifiers may be reused only where their acceptance still matches this document. Do not preserve dependencies merely to keep the old numbering tidy.

## Decisions taken now

1. The current L3 runner is the product baseline and may improve throughout the programme.
2. Commissaire, runtime coordination, and domain meaning remain separate responsibilities.
3. One neutral run journal is canonical for ordered operational and governance facts.
4. SuperDomestique begins as an ephemeral reference coordinator, not a required daemon.
5. The current faff surface remains the compatibility layer during extraction.
6. `accepted_under_contract` is the positive terminal governance verdict.
7. Effect assurance and review independence are explicit structured claims.
8. Minimal off-box evidence and stage-boundary recovery precede broad runtime work.
9. External Commissaire proof and strong one-shot comparison precede generic runtime extraction.
10. A real internal second use is abstraction pressure, not horizontal-market proof.
11. Product naming and physical packaging change only after Gate 2.

## Open decisions and their triggers

| Decision | Deferred until | Evidence required |
|---|---|---|
| Journal storage implementation | Phase 0 slice | Smallest store that provides off-box append, revision checks, integrity, and artifact references in current runners |
| Event schema breadth | A second producer or consumer needs stability | Two concrete integrations and replay fixtures |
| Package and process boundaries | Phase 3 extraction | Characterised dependency map and working vertical slice |
| Long-running service | A durable-service trigger is measured | Latency, contention, scale, partner, or operator-burden data |
| Formal domain-pack SDK | Gate 2 horizontal outcome | Real second use with limited special casing |
| External authorisation provider | A protected effect cannot meet its class with existing infrastructure | Threat model and concrete credential boundary |
| Generic policy provider | Two domains need shared policy evaluation outside Commissaire rules | Repeated policy shape and clear ownership |
| Cross-domain control-plane UI | Two real workflows need a shared view | Operator tasks that a durable summary cannot satisfy |
| Public repository or product split | Gate 2 | Proven mixed or horizontal product shape |

An open decision is not a blocker before its trigger.

## Solo-builder operating model

The programme is designed for one maintainer using unattended runners:

- Prefer one vertical slice and one scorecard over parallel framework construction.
- Keep scheduled segments bounded so a failed invocation does not own the system.
- Publish durable state at meaningful boundaries so the next invocation can continue safely.
- Automate reproducible pass, block, and kill fixtures instead of requiring routine manual witnessing.
- Use model-family separation, fresh context, fixed artifact digests, and lane exclusion for routine adversarial review.
- Escalate only ambiguity, policy exceptions, irreconcilable side effects, and product-shape decisions.
- Keep the tracker projection concise enough that supervision does not become transcript review.
- Stop work at gates when evidence is weak. Sunk implementation effort is not a reason to generalise.

The target is not zero human involvement. It is high unattended throughput with bounded authority, inspectable reasons, and cheap recovery.

## Risks and kill criteria

| Risk | Early signal | Response or stop condition |
|---|---|---|
| Platform work displaces L3 value | L3 reliability or delivery cadence worsens | Stop abstraction work and restore the current path as priority. |
| Duplicate control semantics | Two queues, lifecycle models, or terminal rules diverge | Halt extraction until one owner and migration boundary are explicit. |
| Governance adds ceremony only | Phase 2 yields cleaner logs but no material catch, recovery, authority, or burden advantage | Fail Gate 1 and retain only low-cost internal improvements. |
| Self-certified L4 | The same lineage authors, reviews, judges, and controls effects | Narrow the L4 claim to recorded assurance or add a stronger boundary. |
| Journal becomes a platform project | Storage design expands ahead of one run slice | Return to minimum append, replay, integrity, and artifact-reference needs. |
| Internal second use confirms itself | Software-adjacent workflow fits only through hidden faff assumptions | Do not claim horizontal value; seek a distant partner or choose the mixed outcome. |
| Operator view hides uncertainty | Summary says complete without contract, evidence, or assurance detail | Treat as a correctness defect and block reference claims. |
| Runner recovery duplicates effects | Retry cannot establish prior effect state | Park and reconcile; do not automate retry for that effect class. |
| Maintenance burden exceeds solo capacity | Protocol, adapters, and fixtures consume more time than delivery gains | Reduce product surface or stop productisation. |

## Planning and traceability rules

Future tracker decomposition or plot input derived from this master must:

- preserve phase gates and not schedule conditional phases as committed work;
- attach acceptance evidence to each issue;
- label facts as implemented, observed, proposed, or deferred;
- state retained value for horizontal, mixed, and software-focused outcomes;
- link to the exact experiment or artifact supporting a claim;
- avoid duplicating this document or embedding a second authoritative roadmap;
- keep ADRs just in time with the first slice that needs the decision; and
- make L3 regressions and operator burden visible in every phase scorecard.

No ticket is complete because a document exists. Completion requires the evidence named by its acceptance criteria.

## Source basis

The main implementation and evidence anchors used by this direction are:

- current public level positioning in the [README](../../../../README.md);
- product naming in [positioning and language](../../../concept/positioning-and-language.md);
- current skill-level orchestration in [`faff-beep-boop`](../../../../plugin/skills/faff-beep-boop/SKILL.md);
- deterministic next-step and terminal logic in [`next.js`](../../../../plugin/skills/faff/bin/lib/next.js) and [`run-done.js`](../../../../plugin/skills/faff/bin/lib/run-done.js);
- queue projection and region enforcement in [`queue-state.js`](../../../../plugin/skills/faff/bin/lib/queue-state.js) and [`regions.js`](../../../../plugin/skills/faff/bin/lib/regions.js);
- current runner behaviour in the [L3 watcher](../../../../operations/ci/l3-watcher.yml) and [L4 watcher](../../../../operations/ci/l4-watcher.yml);
- persistent-runner assumptions in the [self-hosted rig guide](../../../guide/self-hosted-rig.md);
- hosted-runner experiment status in the [FAFF-654 results](../../../../records/spikes/2026-07-26-FAFF-654/RESULTS.md); and
- the strong one-shot control in the [L4 experiment design](../../../../verification/external-verification/faff-labs/experiments/l4-experiment-design.md).

These anchors describe the repository as reviewed on 2026-08-11. Future planning must recheck implementation facts rather than treating this RFC as a frozen code inventory.
