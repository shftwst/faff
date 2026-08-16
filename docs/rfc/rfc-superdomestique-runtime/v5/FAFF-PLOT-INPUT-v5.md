# Discovery brief: earn the V5 SuperDomestique runtime and Commissaire boundary

Status: accepted with the v5 pack 2026-08-16; approved discovery brief for interactive `/faff-plot` planning  
Date: 2026-08-15  
mode: greenfield
context: application-scale evolution of an existing system

## How to use this brief

Provide this document to interactive `/faff-plot` as the discovery brief. Do not run intake again. Use the configured `faffter-dark-methodology-agile-delivery` methodology so that ticket shaping is based on thin, shippable increments ordered by value and risk.

This brief does not contain a roadmap skeleton. It deliberately leaves initiative names, project boundaries, first-slice epics, right-sizing, and sequencing within an evidence horizon to the methodology's `ticket-shaping` output. `/faff-plot` owns the level-by-level human gates and tracker writes.

Before plotting, confirm that `faff config get slots.methodology` resolves to `faffter-dark-methodology-agile-delivery`. If it does not, stop before shaping and ask the operator to select the agile-delivery methodology. Do not silently use the thematic default, and do not change repository configuration merely to process this document.

## Source authority

Read these sources before shaping the roadmap:

1. [V5 master direction](FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) controls strategy, evidence gates, phase dependencies, and retained product outcomes.
2. [V5 technical design](TECHNICAL-DESIGN-v5.md) controls the proposed target boundaries, compatibility invariants, state model, and transition rules.
3. [V5 architecture diagram atlas](ARCHITECTURE-DIAGRAMS-v5.md) explains the current, transitional, conditional, and earned-end-state views visually.
4. This brief supplies plotting context and instructions. It does not override the other documents.

Implemented facts and accepted repository decisions outrank every proposed document. If the current code has moved since the technical design's inspected commit, surface the changed premise rather than planning from stale detail.

Reference the source documents from roadmap descriptions instead of copying their technical detail. The roadmap should remain usable if the architecture text is corrected later.

## Goal

Evolve the current Software Delivery product into the smallest evidence-supported SuperDomestique runtime and independently consumable Commissaire governance boundary, while preserving the existing skill-first adoption experience. Each increment must improve the current product or produce decision-quality evidence even if horizontal productisation stops at the next gate.

The destination is the clean end-state architecture in the technical design. The route is the evidence-gated V5 transition, not an assumption that every optional component will be built.

## Current position

The existing product is a working, software-specific, skill-led Node 20 system:

- the established adoption surface is the `faff-*` skill set and `faff` CLI;
- deterministic behaviour is distributed across a CommonJS CLI and skill-driven orchestration;
- current ledgers, event chains, effect records, anchors, tracker state, and per-issue evidence carry the operational history;
- most run state and recovery material remains runner-local;
- orchestrator, implementor, and evaluator are current Software Delivery lane templates inside one broad local trust cage;
- the current code-region boundary named `governance` is not yet the independently consumable Commissaire boundary;
- there is no TypeScript application source or build pipeline at the inspected baseline; and
- no current evidence requires a daemon, network writer, hosted service, generic pack SDK, or repository split.

Use the technical design's current implementation map for exact files and counts. Do not turn those file groupings into project boundaries without applying the methodology's value and risk judgement.

## Capabilities

- Recoverable current execution: a later executor can discover, verify, inspect, reconcile, and safely continue or stop a current-format run without the original machine.
- Honest outward evidence: the present unattended path publishes its achieved durability, isolation, effect, independence, and recovery properties without upgrading claims by vocabulary alone.
- Mapped decision and state authority: current commands, records, projections, skill decisions, writers, consumers, and ownership boundaries are understood well enough to select safe extraction seams.
- Measured orchestration fidelity: repeated deterministic decisions can be compared with actual prompt-interpreted actions, including coverage, divergence, cost, latency, and intervention.
- Independently consumable governance: Commissaire can admit a contract, receive authenticated facts, govern evidence and effects, reconcile outcomes, decide a verdict, and export a seal for execution SuperDomestique did not schedule.
- Comparative proof: governed treatment can be compared fairly with the strong one-shot control, separating unique value from durability, coordination, CI, tracker, and logging value.
- Typed implementation evolution: selected runtime and governance slices move toward authoritative TypeScript source without breaking direct Node 20 execution or the dependency-free distributed CLI.
- Explicit lane assurance: base lane semantics, domain-added lanes, physical realisations, visibility, authority, secrets, and independence are declared and assessed separately.
- Preserved Software Delivery adoption: current skills, CLI paths, tracker workflows, installation modes, and embedded local use continue to work throughout the transition.
- Conditional deterministic coordination: if Gate 1 buys it, a bounded coordinator replaces only measured prompt-interpreted decisions and leaves judgement as explicit lane work.
- Second-use validation: if governance passes Gate 1, another real use applies pressure to contracts, lanes, effects, evidence, adapters, and domain boundaries.
- Evidence-based product shape: package, repository, SDK, canonical naming, partner, and service decisions follow measured second-use pressure and operating triggers.

These are capability areas, not predetermined initiatives or projects. The methodology may combine, split, or sequence them while preserving the constraints and dependencies below.

## First slice

The first useful increment proves that one current-format unattended run can publish a complete off-box recovery bundle at a declared safe boundary and that a later executor, without the original machine, can verify the bundle and determine the next permitted action.

The increment must preserve current canonical record meanings, existing skills, the `faff` CLI, current distribution paths, and current run behaviour. It must include a killed-executor or lost-machine exercise. It does not introduce the generic journal, Commissaire facade, coordinator, service, or public rename.

New V5 recovery code is TypeScript-first under the target build constraints. The methodology decides whether a separate enabling slice is warranted or whether the minimum TypeScript build seam belongs inside the recovery increment. Either choice must end in a directly testable user or evidence outcome.

## Constraints

- Skills remain the easiest Software Delivery adoption path. Existing `faff-*` skills stay usable through every retained V5 outcome.
- `faff` remains the Software Delivery compatibility and adoption launcher. Compatibility uses shared handlers, not a separately maintained classic runtime.
- Commissaire governance commands move to a separate `commissaire` CLI only with the Phase 2A external facade.
- A `superdomestique` runtime CLI is conditional on Gate 1 buying explicit coordination.
- Canonical SuperDomestique skill naming is a Gate 2 decision. Current skill names remain compatible if aliases are introduced later.
- TypeScript is the target authoritative source language and is adopted incrementally. New V5 modules are TypeScript-first; existing module clusters move when a selected slice touches them.
- The shipped CLI remains directly executable on Node 20, CommonJS-compatible during the initial transition, and free of installed runtime dependencies.
- A development-only compiler or bundler may produce the standalone JavaScript artifact. End users and skills do not require a TypeScript loader or local compilation.
- Runtime schemas continue to validate every disk, tracker, worker, subprocess, network, compatibility, and older-release input. Static types do not authenticate external facts.
- Current record artifacts remain canonical throughout Phase 0. A recovery bundle is a verified replica and recovery input, not a second journal.
- A generic record envelope starts only in a selected Phase 2A external-producer slice after the Phase 1 state map exists.
- One logical run or work item has one canonical writer and one canonical format. Compatibility paths are readers or projections, never parallel canonical histories.
- A lane is a logical responsibility, visibility, authority, access, and independence envelope. It is not synonymous with a process, container, CI job, skill, stage, worker, slot, or coordinator.
- The runtime owns the lane schema and occupancy assertions. Execution infrastructure realises boundaries. Commissaire decides whether achieved assurance satisfies the admitted contract.
- The runtime may supply reusable execution, independent-evaluation, and observation templates. Domain bindings may specialise them and add lanes but cannot weaken runtime or Commissaire floors.
- The current orchestrator, implementor, and evaluator lanes are Software Delivery templates, not the complete generic lane set.
- Independent evaluation is generic. Code blindness, spec wording, source visibility, and holdout material are Software Delivery binding choices.
- SuperDomestique coordinates and invokes work. Commissaire governs admission, evidence, effects, reconciliation, verdicts, waivers, and seals. Domain bindings define meaning. Infrastructure supplies physical execution.
- Commissaire must be usable without current scheduling, Software Delivery skills, tracker assumptions, or a mandatory hosted service.
- Protected effects use stable identity, explicit intent, governed authority, observation, ambiguity handling, and reconciliation. Unknown external outcome blocks automatic replay.
- Worker completion, tests passing, merge, deployment, run-membership disposition, and work-item acceptance remain distinct facts.
- The current prompt-driven orchestration remains authoritative until Gate 1. Shadow decision paths cause no assignments, protected effects, or canonical decisions.
- A service, generic pack SDK, package split, repository split, public partner programme, and broad rename remain conditional on their measured V5 triggers.
- Every slice has a compatibility check, recovery or rollback boundary, failure injection where relevant, and an evidence artifact that supports the next decision.
- A slice cannot claim stronger journal, effect, independence, or isolation assurance than its mechanism proves.
- No phase is calendar-gated. Evidence, not elapsed time or completion percentage, opens the next horizon.

## Dependencies

- Current trust and reliability defects that invalidate the reference path are closed before outward claims depend on that path.
- Recoverable current runs precede generic record migration. Phase 0 publishes current artifacts off-box without changing their canonical meaning.
- The current state-authority map and orchestration-fidelity instrumentation precede selection of a generic envelope cutover.
- The external producer in Phase 2A is the second producer and supplies the first justified generic-envelope slice.
- Producer authentication sufficient for the admitted journal class precedes governance verdicts that rely on producer identity.
- The `commissaire` CLI follows semantic ownership separation. A new executable name cannot conceal imports from current scheduling or Software Delivery internals.
- The governed external treatment precedes the controlled comparison. The comparison uses the predeclared control, measures the same outcomes, and attributes benefits to the correct layer.
- Gate 1 answers governance value and coordination value independently.
- A positive coordination decision precedes live coordinator authority. A positive governance decision is not sufficient by itself.
- A positive governance decision precedes horizontal second-use work. When governance passes and coordination does not, second use proceeds through the external bridge.
- When coordination passes and governance does not, coordinator work may continue only as Software Delivery hardening and does not feed the horizontal path.
- Phase 4 second-use evidence precedes Gate 2 product and package decisions.
- A distant external partner follows the internal second-use pressure test and requires its own incentives, systems, terms, and consequential effects.
- A long-running service follows a measured trigger such as multi-producer contention, lease latency, writer authentication, partner isolation, or operator cost. It is not a prerequisite for the local, isolated-runner, or external-bridge profiles.
- TypeScript conversion follows selected vertical slices. The live entrypoint changes last, after generated-artifact, clean-install, compatibility, and rollback evidence.
- Interface aliases precede any removal discussion. A pinned pre-rename baseline exists before a canonical skill or package rename.

## Evidence horizons and decision branches

These horizons are strategic dependencies from the master RFC. They are not project names and do not prescribe the roadmap hierarchy.

| Horizon | Outcome that opens the next decision | Retained value if work stops here |
|---|---|---|
| Current-path recovery | Off-box bundle publication and later-executor recovery succeed on real and failure-injected runs without changing current canonical semantics | Safer unattended Software Delivery and portable audit material |
| Map and measure | Current authorities, writers, readers, identities, projections, decision coverage, divergence, cost, and limits are reproducible | A grounded extraction map and orchestration baseline |
| External Commissaire proof | Execution not scheduled by SuperDomestique can use `commissaire` to produce authenticated governed facts, effect decisions, reconciliation, verdict, and seal | Independently consumable governance or a falsified boundary |
| Controlled comparison | Governance-specific outcomes are compared with the strong one-shot control and existing CI, tracker, and logging value is not double-counted | Decision-quality evidence about unique governance and coordination value |
| Gate 1 | Governance and coordination questions receive separate yes or no decisions | The appropriate software-focused, governance-only, coordinator-hardening, or combined path |
| Conditional coordinator | Only bought deterministic decisions run through a bounded live coordinator with shadow-to-live rollback evidence | Lower orchestration divergence or cost in the Software Delivery product |
| Second use | A real internal use, followed when still promising by a distant external use, tests whether the abstractions survive different meanings and systems | Reusable protocol evidence or a justified vertical boundary |
| Gate 2 | Product, packaging, naming, SDK, partner, and service choices follow measured second-use pressure | A deliberately horizontal, mixed, or Software Delivery-focused product |

Gate 1 has four distinct outcomes:

| Governance result | Coordination result | Allowed route |
|---|---|---|
| Yes | Yes | Build the bounded coordinator, then run second use through it |
| Yes | No | Skip the coordinator and run second use through the external bridge |
| No | Yes | Build coordination only as Software Delivery hardening, then stop the horizontal path after its evidence review |
| No | No | Retain the Software Delivery-focused outcome and stop horizontal expansion |

Do not collapse this matrix into a single continue or stop gate.

## Planning questions for the methodology

The roadmap shape should answer these questions. The brief does not answer them on the methodology's behalf.

- What is the thinnest shippable increment that proves portable recovery of current-format execution?
- Which current reliability defects are actual prerequisites for that increment, and which can remain ordinary backlog work?
- How can the minimum TypeScript build and compatibility seam travel with useful capability rather than becoming a detached rewrite programme?
- What independently reviewable outcome establishes generated-artifact parity across symlink, marketplace, checkout, and pinned-action use?
- What is the smallest state-authority map that can safely choose a cutover slice?
- Which deterministic decisions have enough captured input and actual action data to support a valid fidelity comparison?
- Which external execution treatment is narrow enough for Phase 2A but real enough to exercise contracts, authenticated records, evidence, effects, reconciliation, and verdicts?
- What evidence belongs to Commissaire, what belongs to durability or coordination, and how will the comparison keep those attributions separate?
- Which base lane properties are needed by the selected treatment, and which stronger physical boundaries should wait for a contract that requires them?
- How should current `faff` governance commands migrate to aliases without implementing governance twice?
- What failure injections would falsify the selected increment rather than merely decorate its success path?
- What is the smallest retained product improvement if the next strategic gate says stop?
- Where does a branch genuinely need more discovery, such that plot should stop rather than manufacture speculative first-slice epics?

## Out of scope

- A pre-written initiative, project, epic, or leaf-ticket hierarchy: the agile-delivery methodology owns that decomposition.
- Exact ticket titles, file lists, module conversion order, estimates, sprint boundaries, or implementation checklists: these belong to plotting, prep, and per-ticket specifications at the appropriate altitude.
- A big-bang TypeScript rewrite: TypeScript moves with selected capability slices and keeps a releasable compatibility path.
- A replacement of the current event system during Phase 0: current artifacts remain canonical while recovery is proved.
- Two canonical writers or histories for the same work: shadow readers and compatibility projections do not become competing truth.
- A mandatory daemon, hosted control plane, network writer, or multi-tenant service: local and bounded profiles remain permanent.
- A generic workflow builder, connector marketplace, enterprise identity programme, or compliance-certification claim.
- A core model containing Software Delivery nouns such as pull request, code-blind, spec, test, or merge.
- Treating every lane as a container or every isolation claim as physically achieved.
- Replacing current skills with a service-only interface or requiring adopters to abandon the `faff-*` surface.
- Introducing the `superdomestique` runtime CLI before Gate 1 or changing canonical skill names before Gate 2.
- Splitting repositories or packages before typed ports, an external governance use, and second-use pressure make the boundary real.
- Planning conditional Phase 3 or later implementation as committed build work before its gate passes.

## Open questions

These questions are carried into the appropriate discovery, spike, or prep step. They do not block plotting the first evidence horizon.

- Which compiler and bundler best preserve the standalone Node 20 artifact, CommonJS compatibility, startup time, reproducibility, and contributor experience?
- What generated-source layout works across symlink, marketplace, checkout, and pinned-action distribution?
- Which immutable off-box store and discovery index provide the simplest credible Phase 0 recovery proof?
- What exact current stage boundaries are safe, reconstructable, and useful enough to publish?
- Which external execution treatment and producer should provide the Phase 2A proof?
- Which producer-binding mechanism is sufficient for that producer's threat model and selected journal class?
- Which stream partition follows the observed causation, contention, and query needs of two producers?
- What argument, configuration, and output format lets `commissaire` serve an external consumer without `.faffrc` scheduling assumptions?
- Which lane properties require physical separation in the first reference scenario, and which can be honestly reported as weaker assurance?
- Which strong one-shot control and outcome measures make the Phase 2B comparison fair?
- Which internal second use creates real semantic pressure without pretending to be a distant domain?
- Which external design partner, if any, supplies genuine second-use incentives and consequential effects?
- What measured condition, if any, justifies a long-running service?
- What harness capabilities are required for canonical skill aliases if Gate 2 later buys a rename?
- What package or repository boundary, if any, is earned by real consumers rather than diagram symmetry?

## Plot output contract

When this brief is processed by `/faff-plot`:

- recurse one altitude at a time from outcome to initiatives, projects, and first-slice epics;
- apply `faffter-dark-methodology-agile-delivery` to naming, right-sizing, value and risk order, and dependency proposals;
- present and confirm containers level by level before writing them;
- stop at first-slice epics and leave leaf decomposition to `/faff-prep` and execution-discovered work;
- stop a branch when its next deliverable is not concretely derivable from admitted evidence;
- name containers by outcomes and increments, not by code layers or V5 document section numbers;
- make every first-slice epic a reviewable deliverable with an observable outcome;
- attach explicit dependencies where a gate, evidence artifact, compatibility seam, or canonicality boundary makes ordering real;
- keep conditional horizons visibly gated and avoid buildable epics beyond an unpassed gate;
- treat TypeScript as a cross-cutting delivery constraint unless an independently useful build or distribution outcome warrants its own increment;
- include failure and rollback evidence in the relevant increment rather than creating a detached testing phase;
- preserve a useful Software Delivery result at every stop point;
- carry unresolved implementation choices into open questions for `/faff-prep` or a methodology-proposed spike;
- reference the V5 source documents from container descriptions rather than copying their architecture; and
- create no leaf backlog exhaustively in advance.

The plotted skeleton is the delivery roadmap. This brief remains its source context, not a parallel roadmap.
