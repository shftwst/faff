# SuperDomestique runtime v5: technical design

Status: accepted companion to the v5 master direction, 2026-08-16
Date: 2026-08-15
Decision owner: project maintainer
Implementation inspected at: `7d89640ce7b8`

## Authority and purpose

This document translates the [v5 master direction](FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) into a technical architecture. The master controls strategy, evidence gates, and product outcomes. This document controls neither current behaviour nor accepted repository decisions. Current code and accepted ADRs outrank it until a selected slice is implemented.

The design has three views:

1. a clean end-state architecture, without migration details mixed into it;
2. the current implementation, tied to actual files and artifacts; and
3. the transition rules that connect the two safely.

The [architecture diagram atlas](ARCHITECTURE-DIAGRAMS-v5.md) is the visual companion. Diagram captions state whether a view is current, transitional, conditional, or an earned end state.

The [V5 faff plot input](FAFF-PLOT-INPUT-v5.md) carries this design into roadmap planning as outcomes, constraints, dependencies, and evidence horizons. The configured methodology owns the initiative, project, and first-slice decomposition. Conditional Phase 3 through Phase 5 work does not become committed scope before its gate passes.

## Fixed design outcomes

This design fixes the following technical direction:

- Skills remain the easiest Software Delivery adoption path.
- The current `faff-*` skill interface remains compatible throughout the transition.
- Commissaire receives a separate `commissaire` CLI when the external facade is proved.
- A `superdomestique` runtime CLI is conditional on Gate 1 buying explicit coordination.
- TypeScript becomes the authoritative source language for runtime code through an incremental migration.
- The shipped CLI remains directly executable on Node 20 and has no installed runtime dependencies.
- A lane is a logical responsibility, visibility, authority, and access boundary. Its physical realisation is replaceable.
- Domain bindings may declare additional lanes through the runtime lane schema.
- The current record system remains canonical through Phase 0.
- A generic record envelope begins only for a selected Phase 2A slice.
- No run is canonical in both the current and generic record systems.
- A coordinator, service, public pack SDK, package split, or canonical interface rename remains conditional on the applicable V5 gate.

# Part I: clean end-state architecture

## System boundary

SuperDomestique coordinates delegated work. Commissaire governs whether work may begin, continue, cause a protected effect, or be accepted. A domain binding supplies the meaning of the work. Workers perform bounded work in lanes. A canonical record system holds operational and governance facts. Operator surfaces are projections over those records.

The logical system contains these components:

| Component | Owns | Excludes |
|---|---|---|
| Skills and compatibility facade | Conversational workflows, established skill names, CLI compatibility, tracker-facing Software Delivery tasks | Canonical generic state, governance authority |
| Domain binding | Domain stages, lane templates, evidence meaning, effect types, external-system adapters, presentation terms | Generic record order, generic coordination, acceptance authority |
| Decision kernel | Eligibility, assignment, leases, liveness decisions, retry, correction routing, park, resume, run termination | Semantic judgement, domain quality, protected-effect authority |
| Bounded coordinator, conditional | Repeated load, reconcile, select, assign, invoke, record, decide, and stop cycle | Hidden probabilistic routing, governance override |
| Worker adapter | Invocation, bounded execution, worker identity, artifact and claim return | Contract admission, self-acceptance, protected-effect authority |
| Record system | Stream revisions, idempotency, producer binding, integrity, causation, artifact references | Work selection, domain meaning, governance policy |
| Artifact store | Immutable evidence and recovery material addressed by digest | Lifecycle or acceptance decisions |
| Projection engine | Rebuildable queue, status, tracker, summary, quality, and economics views | Canonical facts |
| Commissaire | Contract admission, obligations, independence, effect decisions, reconciliation, waivers, terminal verdicts and seals | Scheduling, worker choice, domain stage composition |
| External bridge | Translation of execution facts from work SuperDomestique did not schedule | Pretending that external work was coordinated by SuperDomestique |
| Execution infrastructure | Processes, containers, CI jobs, remote runners, credentials, mounts, and networks | Deciding the lane or contract semantics it realises |

The permitted dependency direction is:

```text
skills and operator surfaces
            |
            v
      domain binding
            |
            v
       decision kernel ------> worker ports
            |                       |
            +----------+------------+
                       v
          records and immutable artifacts
                       |
                       v
                  Commissaire
```

Commissaire consumes domain-neutral governed facts. It may call policy functions supplied by an admitted contract, but it must not import Software Delivery adapters. The runtime may ask Commissaire for decisions, but it cannot manufacture or override those decisions.

## Skills-first adoption

The default Software Delivery experience remains:

1. install the plugin and CLI;
2. invoke the existing `faff-*` skills;
3. use the local CLI and current tracker projection;
4. run bounded local or scheduled processes; and
5. add external stores, stronger isolation, or remote workers only when the selected assurance needs them.

The skills are a supported compatibility and domain-adoption layer. They do not become deprecated wrappers around a mandatory service. Deterministic semantics move into typed handlers and kernel functions, while skills retain conversational intake, judgement work, and human interaction.

Every migration slice that changes a skill-consumed command must pass the skill-facing compatibility fixtures. A package or repository split cannot make a hosted control plane mandatory for ordinary Software Delivery use.

## Deployment profiles

The logical components can be deployed in four profiles:

| Profile | Processes and storage | Intended use | Assurance posture |
|---|---|---|---|
| Embedded skill | Bounded local CLI processes and a local record adapter | Easy L1 to L3 adoption | Reports the isolation and journal class actually achieved |
| Isolated runner | Scheduled bounded invocations, off-box artifacts, separately scoped worker contexts | Recoverable unattended work and L4 evidence | May achieve stronger journal, effect, and independence classes |
| External execution | External producer plus bridge and Commissaire facade | Governance without SuperDomestique scheduling | Requires authenticated producer facts for governance-relevant claims |
| Service, conditional | Network writer, coordinator, or both | Only after a measured V5 service trigger | May raise write authority, lease, latency, or contention properties |

The embedded profile is a permanent supported profile. Lower physical isolation narrows its claims; it does not make the profile invalid.

## Interface names and command ownership

The end-state command model separates responsibilities without duplicating handlers:

| Interface | Responsibility | Availability |
|---|---|---|
| `faff` | Software Delivery adoption and compatibility paths | Retained throughout migration |
| `commissaire` | Governance contracts, evidence, effects, reconciliation, verdicts, seals, and audit export | Introduced with the Phase 2A external facade |
| `superdomestique` | Generic runtime assignments, runs, recovery, and coordination | Conditional on Gate 1 |

All binaries read one typed command registry:

```ts
type CommandOwner = "commissaire" | "runtime" | "software-delivery";

interface CommandRegistration {
  readonly owner: CommandOwner;
  readonly canonicalPath: readonly string[];
  readonly legacyFaffPaths: readonly (readonly string[])[];
  readonly handler: CommandHandler;
}
```

The `faff` compatibility launcher maps old command paths to the canonical handler. It preserves exit codes, JSON shapes, configuration behaviour, and help text during the declared compatibility window. An alias never contains a second implementation.

The first Commissaire facade has these logical operations:

```text
commissaire contract admit
commissaire evidence register
commissaire effect decide
commissaire observation append
commissaire reconcile
commissaire verdict decide
commissaire audit seal
commissaire audit export
commissaire audit verify
```

Exact argument syntax is selected by the Phase 2A vertical slice. The external proof must use the `commissaire` surface without importing current scheduling or skills.

Canonical `superdomestique` skill or CLI naming is a Gate 2 decision. The design reserves the ownership boundary now. It does not spend the name before a generic runtime is earned. Existing `faff-*` skills remain usable if later `superdomestique-*` aliases become canonical.

## TypeScript implementation architecture

TypeScript is the authoritative target source language for the CLI and runtime modules. It is introduced as a build-time tool. The distribution remains executable JavaScript with no installed runtime dependencies.

The build produces:

- a standalone Node 20 CLI artifact with a shebang;
- handler modules for repository tests and internal consumers;
- type declarations where an internal or external adapter needs them; and
- a manifest binding the build inputs, compiler configuration, and output digest.

The initial compiler target remains CommonJS-compatible. The migration does not combine source typing, module-system conversion, and architecture extraction in one change.

Strict settings apply to new and migrated code. The intended baseline includes `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `useUnknownInCatchVariables`. Transitional JavaScript may be admitted through `allowJs`; it is not treated as migrated merely because the compiler copies it.

Generated output is checked for freshness in CI. Repository tests exercise the built artifact and the typed module interfaces. Release and marketplace paths consume generated output, never a developer-only TypeScript loader.

### Identity types

V5 identities use opaque types rather than interchangeable string aliases:

```ts
declare const idBrand: unique symbol;

type OpaqueId<Name extends string> = string & {
  readonly [idBrand]: Name;
};

type RunId = OpaqueId<"RunId">;
type RunSegmentId = OpaqueId<"RunSegmentId">;
type WorkItemId = OpaqueId<"WorkItemId">;
type ContractRevisionId = OpaqueId<"ContractRevisionId">;
type StageAttemptId = OpaqueId<"StageAttemptId">;
type EffectId = OpaqueId<"EffectId">;
type LaneId = OpaqueId<"LaneId">;
type EventId = OpaqueId<"EventId">;
```

Parsers create these values only after runtime validation. Casts at call sites are prohibited.

### Closed result types

Lifecycle, assurance, and control decisions use discriminated unions. A handler must exhaust the union before returning a CLI result. Unknown external values fail validation rather than entering the union through a default branch.

TypeScript does not replace JSON Schema, producer authentication, integrity verification, or behaviour tests. Anything read from disk, a tracker, a worker, a network, or an older release is `unknown` until validated.

## Record identities and relationships

The canonical model distinguishes:

| Identity | Scope | Reuse rule |
|---|---|---|
| Run ID | One bounded orchestration campaign | Stable across resumed run segments |
| Run-segment ID | One process or executor occupation of a run | New after replacement or resumed occupation |
| Work-item ID | One delegated outcome | Stable across runs, correction, and retry |
| Contract-revision ID | One immutable set of governing terms | New after a material amendment |
| Stage-attempt ID | One immutable attempt to perform a stage | New for retry, correction, or replacement |
| Effect ID | One consequential external action | Stable across idempotent retry and reconciliation |
| Lane ID | One instantiated responsibility and isolation envelope | Stable for its admitted lane instance |
| Event ID | One record delivery identity | Repeated delivery is idempotent |

Run membership is the relationship between one run and one admitted work item. Its disposition is not the work item's terminal governance verdict.

## Record streams

The record system has strict order within named streams. It does not impose a total order across unrelated work.

Minimum stream types are:

- run streams for admission into a campaign, run segments, run control decisions, membership dispositions, and run completion;
- work-item streams for contract revisions, stages, lanes, evidence obligations, correction, and terminal verdicts; and
- effect streams for effect intent, authority, attempt, observation, and reconciliation where independent idempotency is needed.

Cross-stream causation references connect the streams. A stream revision determines storage order. Observation time explains when an external fact occurred but cannot rewrite that order.

### Record envelope

```ts
interface RecordEnvelope<Type extends string, Payload> {
  readonly stream: {
    readonly id: string;
    readonly type: "run" | "work-item" | "effect";
    readonly revision: number;
    readonly expectedPriorRevision: number | null;
  };
  readonly event: {
    readonly id: EventId;
    readonly type: Type;
    readonly schemaVersion: number;
  };
  readonly references: {
    readonly runId?: RunId;
    readonly runSegmentId?: RunSegmentId;
    readonly workItemId?: WorkItemId;
    readonly contractRevisionId?: ContractRevisionId;
    readonly stageAttemptId?: StageAttemptId;
    readonly effectId?: EffectId;
    readonly laneId?: LaneId;
    readonly correlationId?: string;
    readonly causationEventId?: EventId;
  };
  readonly producer: {
    readonly principal: string;
    readonly binding: ProducerBinding;
    readonly actingPrincipal?: string;
  };
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly payload: Payload;
  readonly payloadDigest: string;
  readonly artifacts: readonly ArtifactReference[];
  readonly integrity: IntegrityBinding;
}
```

The stored schema uses explicit required and optional fields per event type. The generic TypeScript interface is not the wire schema.

Repeated append of the same event ID with identical bytes is idempotent. Reuse with different bytes is a conflict. An append with a stale expected revision fails without changing the stream and enters reconciliation.

### Immutable artifacts

Large material remains outside record payloads. An artifact reference binds:

- digest algorithm and digest;
- media type and logical role;
- producer and production context;
- contract revision and stage attempt where applicable;
- size and storage locator;
- redaction status; and
- encryption or access metadata where required.

Storage locators are replaceable. Digests and semantic roles are canonical.

### Projections

Queue state, run status, tracker status, summaries, quality, economics, and operator views are rebuildable projections. A projection records the stream revisions from which it was built. It can be discarded and rebuilt without changing a lifecycle outcome.

An external system disagreement is appended as an observation and reconciled. A projection never edits earlier records to make an external system appear consistent.

## Logical ports

The first implementation uses in-process interfaces. A network facade is an adapter, not the semantic definition.

```ts
interface RecordStore {
  append(record: UncommittedRecord): Promise<AppendResult>;
  readStream(streamId: string, afterRevision?: number): AsyncIterable<RecordEnvelope<string, unknown>>;
  verify(streamId: string): Promise<VerificationResult>;
}

interface ArtifactStore {
  put(input: ArtifactInput): Promise<ArtifactReference>;
  get(reference: ArtifactReference): Promise<Uint8Array>;
  verify(reference: ArtifactReference): Promise<VerificationResult>;
}

interface DecisionKernel {
  reconcile(input: ReconciliationInput): KernelDecision;
  select(input: SelectionInput): KernelDecision;
  assign(input: AssignmentInput): KernelDecision;
  nextAction(input: NextActionInput): KernelDecision;
  runDisposition(input: RunDispositionInput): KernelDecision;
}

interface Commissaire {
  admit(input: ContractProposal): Promise<AdmissionDecision>;
  registerEvidence(input: EvidenceRegistration): Promise<EvidenceDecision>;
  decideEffect(input: EffectRequest): Promise<EffectDecision>;
  reconcile(input: GovernanceObservation): Promise<ReconciliationDecision>;
  decideAcceptance(input: AcceptanceRequest): Promise<TerminalVerdict>;
  seal(input: SealRequest): Promise<AuditSeal>;
}

interface WorkerPort {
  invoke(assignment: Assignment, lane: RealisedLane): Promise<WorkerResult>;
}

interface ExternalBridge {
  translate(input: ExternalFact): Promise<UncommittedRecord[]>;
}
```

Each method has a closed error vocabulary. Domain refusal, revision conflict, unavailable infrastructure, corrupt state, and invalid usage remain distinguishable through to CLI output.

## Runtime cycle

A bounded coordinator invocation, if Gate 1 buys it, performs:

1. load and verify the required stream heads and projections;
2. reconcile stale run segments, stage attempts, leases, and external observations;
3. compute eligible work through pure kernel functions;
4. append an assignment and acquire a lease at the expected revisions;
5. realise the lane and refuse if its promised boundary is absent;
6. invoke a worker;
7. store artifacts and append authenticated claims and observations;
8. request Commissaire decisions required by the contract;
9. derive the next control action;
10. continue within the invocation budget or publish a durable summary and exit.

The cycle never asks an LLM to interpret a deterministic transition covered by the kernel. Judgement remains explicit worker work in a lane.

## Lane model

A lane is a named responsibility and isolation envelope that a worker may occupy for a stage attempt. It is logical. It may be realised by an agent context, process, worktree, container, CI job, remote runner, human task, external service, or a combination.

A lane is not a skill, stage, worker, slot, process, container, run segment, or Commissaire. The runtime coordinator is not a lane.

### Lane declaration

```ts
interface LaneTemplate {
  readonly name: string;
  readonly responsibility: string;
  readonly visibility: VisibilityPolicy;
  readonly workspace: WorkspacePolicy;
  readonly capabilities: CapabilityPolicy;
  readonly secrets: SecretVisibilityPolicy;
  readonly network: NetworkPolicy;
  readonly storage: StoragePolicy;
  readonly admissibleWorkers: WorkerConstraint;
  readonly conflicts: readonly LaneConflictRule[];
  readonly isolation: IsolationRequirement;
  readonly budget: LaneBudget;
  readonly evidence: readonly EvidenceObligationTemplate[];
}
```

The runtime owns this schema, validates lane occupancy, and records the boundary achieved. Commissaire checks whether achieved isolation and lane lineage satisfy the admitted contract. Execution infrastructure provides the physical boundary.

### Base and domain lanes

The runtime may ship a small base library of lane templates for bounded execution, independent evaluation, and independent observation. These are reusable defaults, not a fixed workflow.

A domain binding may:

- specialise a base template;
- add a lane such as security review, legal approval, measurement, or deployment observation;
- bind one or more stages to a lane; and
- narrow capabilities, visibility, secrets, or eligible workers.

A domain binding may not:

- invent an unrecognised isolation mechanism;
- weaken a global runtime or Commissaire floor;
- grant a credential that the environment cannot isolate;
- redefine journal or effect assurance classes;
- bypass record, effect, or acceptance protocols; or
- allow a conflicting lane to satisfy its own independent obligation.

The first internal Software Delivery binding supplies implementor and independent-evaluation templates. The current prompt-driven orchestrator lane remains during compatibility migration and shrinks as deterministic control moves into the kernel and coordinator.

### Isolation realisations

An isolation requirement and a physical mechanism are recorded separately. The achieved vector includes at least:

- invocation and principal separation;
- lane-history conflicts;
- context freshness and excluded context;
- filesystem and workspace visibility;
- tool and effect capabilities;
- credential and secret visibility;
- network and storage reach;
- model family and provider where relevant;
- artifact digest timing; and
- cage, process, CI job, or other physical boundary evidence.

A separate context cannot claim filesystem isolation. A worktree cannot claim credential isolation. A container with a mounted host engine socket cannot claim host isolation. A CI job provides only the permissions and separation its configuration and runner topology enforce.

The runtime asserts promised boundaries at lane entry and refuses when a required property is absent. It never self-grants a stronger cage or permission envelope.

## State scopes

State is derived from records. Separate state machines govern:

- contract proposal and admission;
- run lifecycle;
- run-segment lifecycle;
- run membership;
- work-item lifecycle;
- stage-attempt lifecycle;
- lease lifecycle;
- lane occupancy;
- evidence obligations;
- protected effects;
- terminal verdict and later reconciliation;
- journal-format migration; and
- TypeScript module migration.

These scopes may hold different states at the same time. An interrupted run segment may coexist with a parked run membership and an active work item. A run-member `shipped` outcome does not imply `accepted_under_contract`.

Each transition definition names:

- trigger record or command;
- permitted authority;
- guards;
- emitted record;
- next states;
- retry and recovery posture; and
- terminal scope.

The diagram atlas contains the state machines and their cross-scope relationship.

## Contract and acceptance model

A domain binding compiles user intent and domain configuration into a proposed contract containing:

- work-item identity and scope;
- versioned domain binding and rules;
- stage and lane requirements;
- evidence obligations and producer constraints;
- protected effects and minimum effect classes;
- minimum journal and independence assurance;
- correction, amendment, cancellation, and terminal rules;
- budgets and expiry; and
- operator authorities.

Commissaire admission decides whether those terms can be governed. Admission does not predict success.

The positive terminal verdict is `accepted_under_contract`. It binds the work item, contract revision, evidence seal, satisfied criteria, exceptions or waivers, independence vector, effect classes, journal classes, and Commissaire rule version.

Worker completion, tests passing, a pull request merging, a deployment occurring, a run membership closing, and work-item acceptance remain separate facts.

## Protected effects

Every protected effect has a stable effect ID. Its stream may contain:

1. intent;
2. requested authority;
3. grant, denial, or expiry;
4. attempted execution;
5. independent observation;
6. match, mismatch, or unknown result; and
7. reconciliation or compensation decision.

The contract specifies the minimum E-class. E-A and E-B support prevention claims. E-C supports detection and reconciliation. E-D is self-attestation only.

Unknown effect state blocks automatic retry. The work item parks or enters reconciliation until the prior effect can be proved absent, proved present, or handled by an admitted compensation rule.

## Journal authority and producer identity

Record bytes and record authority are distinct. The system records a J-class per relied-on stream.

- J-A uses store policy outside all producers' trust domains.
- J-B uses an authenticating writer with the only write credential.
- J-C permits shared byte-write access but verifies a producer binding unavailable to conflicting producers and excludes invalid records from authoritative projections and seals.
- J-D declares producer identity without independent verification.

Governance verdicts require J-C or stronger. A contract may require J-C or stronger for worker facts. A principal string in the payload is J-D unless a verifier can authenticate its binding.

The Phase 2A threat model selects the first producer-binding mechanism. The logical design permits signatures, MACs, workload identity assertions, or a mediated writer. It does not call one mechanism mandatory before the concrete producer and store are known.

## Terminal safety and audit seal

`accepted_under_contract` requires:

- an admitted immutable contract revision;
- complete causal lineage for the candidate result;
- every mandatory evidence obligation satisfied by an eligible producer;
- required lane, independence, journal, and effect assurance;
- no unresolved blocking observation or effect;
- an acceptance decision at the expected work-item revision; and
- a seal over every relied-on record and artifact digest.

Partial, unauthenticated, truncated, or revision-conflicted records cannot produce a positive verdict. A later observation appends a superseding reconciliation verdict. Earlier facts and verdicts remain visible.

## Operator projections

Every bounded invocation publishes a summary that answers:

- what the run admitted;
- the current run, segment, membership, work-item, stage, lane, lease, evidence, effect, and verdict states;
- what happened most recently;
- which contract, rule, model, worker, record, and domain versions apply;
- which evidence is present, missing, rejected, or superseded;
- why the runtime continued, stopped, parked, blocked, corrected, cancelled, or abandoned;
- what action is permitted next;
- which assurance was achieved; and
- whether human attention is required.

The current tracker remains the default Software Delivery navigation surface. The CLI and sealed audit bundle remain usable without a tracker.

## Failure model

Failures are data with stable codes. They do not become ambiguous prose or unhandled domain exceptions.

| Failure class | Required response |
|---|---|
| Invalid input or schema | Refuse without mutation; name the invalid field and expected contract |
| Duplicate event ID, same bytes | Return the prior append result |
| Duplicate event ID, different bytes | Record or report identity conflict; no append |
| Stale expected revision | No append; reconcile from the current head |
| Lease conflict or expiry | Do not infer ownership; reconcile and assign a new attempt when permitted |
| Partial artifact publication | Do not reference or accept the incomplete artifact |
| Lost executor | Close or expire the run segment; recover only from a verified safe boundary |
| Unknown effect state | Observe or park before retry |
| Producer binding failure | Retain only as a diagnostic anomaly; exclude from authoritative projections and seals |
| Missing required evidence | Block acceptance; correct, amend, waive, cancel, or reject according to contract |
| Lineage-head conflict | Retain losing evidence; reconcile explicitly |
| Projection disagreement | Rebuild the projection; never edit records to match the cache |
| Seal failure | No positive verdict; surface the exact missing or invalid lineage |
| Unsupported isolation | Refuse lane entry or contract admission at the earliest knowable point |
| Infrastructure unavailable | Return a retryable or operator-required result according to the contract; never reinterpret it as success |

CLI adapters map these results to documented exit codes. JSON output carries the stable code and structured details.

# Part II: current implementation

## Current code shape

At the inspected commit, the CLI has:

- one CommonJS entrypoint at `plugin/skills/faff/bin/faff`;
- 85 CommonJS modules under `plugin/skills/faff/bin/lib/`;
- about 45,000 lines in those modules;
- no root application package manifest or TypeScript configuration;
- direct Node 20 execution with built-in modules only;
- 188 JavaScript test files with about 47,000 lines; and
- JSON schemas and contract artifacts that validate selected current boundaries at runtime.

The direct executable and zero-runtime-dependency posture are adoption properties that the TypeScript build must preserve.

## Current dependency regions

`plugin/skills/faff/bin/lib/regions.js` enforces four current code regions:

- `shared-infra` imports no local module;
- `governance` may use shared infrastructure but may not import `factory`;
- `factory` may import governance; and
- the entrypoint shell dispatches everything.

The current `governance` region is mainly the flight recorder and interlocks: events, effects, runcheck, heartbeat, budget, sentry, audit, reconcile, and profiles. It is not identical to future Commissaire ownership. `governance-check` currently belongs to `factory` because it imports Software Delivery gate functions. Runtime decisions such as `next`, `run-done`, `queue-state`, `lights-out`, and resume also belong to `factory` today.

Phase 1 uses the current region graph as evidence. It does not rename the regions and treat the rename as extraction.

## Current orchestration

`plugin/skills/faff-beep-boop/SKILL.md` is the current prompt-interpreted coordinator. It reads the tracker, builds queues, invokes pure commands, dispatches work, handles parks, and writes summaries. Deterministic decisions exist in modules including:

- `next.js`;
- `run-done.js`;
- `queue-state.js`;
- `run-start.js`;
- `resume.js`;
- `budget.js`;
- `sentry.js`;
- `gates.js`; and
- `merge-gate.js`.

Those functions do not yet form one complete coordinator. A fidelity study can compare only decision points with a named kernel function, captured inputs, and a normalisable action.

## Current records and artifacts

| Artifact | Current role | Main writers | Main consumers | Transition posture |
|---|---|---|---|---|
| `run-ledger.json` | Mutable per-run admitted set, membership outcomes, owner and run fields | Mint and lock-serialised mutation paths | runcheck, audit, sentry, disposition, merge and governance checks | Canonical through Phase 0; bundled; mapped before cutover |
| `events.jsonl` | Append-only per-run event history with sequence and hash links | Event append and ledger-fold paths | audit, integrity, sentry, quality, economics, andon | Canonical event history through Phase 0 |
| `chain-head.json` | Witness for the anchored events chain | Anchor path | events verify, governance check | Preserved as current integrity evidence |
| `declared-effects.jsonl` | Separate declared-effect record with its own chain | Effects command paths | effects verify, merge gate, audit | Canonical current effect evidence through Phase 0 |
| `effects-chain-head.json` | Witness for the declared-effects chain | Effects anchor path | effects verification | Preserved as current integrity evidence |
| `.faff/anchors/...` | Immutable PR-carried copies of selected evidence | Graft and anchor paths | Merge and governance checks | Immutable historical evidence; future artifact mapping required |
| `summary.md` | Human-readable run result and park records | Orchestrator | Operator and park-history readers | Projection and recovery-bundle member, not future canonical state |
| Per-issue specs, review, holdout, PRDR, and gate artifacts | Software Delivery evidence | Skills, workers, and gate commands | Merge, holdout, review, audit, tracker flows | Immutable blobs or domain records according to Phase 1 map |
| Tracker state and comments | Human control and Software Delivery projection | Skills and operators | Queue assembly and operator review | Remains a projection and command surface |

The current ledgers have valuable integrity and completeness rules, but most state is runner-local. L4 resume expects the original run directory. Current Phase 0 work must publish verified recovery material without inventing a second canonical event vocabulary.

## Current lanes and isolation

The current Software Delivery flow names three lanes:

| Lane | Responsibility | Current visibility |
|---|---|---|
| Orchestrator | Tracker, human interaction, sequencing, reporting | Tracker, documentation, read-only code context |
| Implementor | Architecture, specification interpretation, code, and tests | Writable code worktree and spec; no tracker interaction |
| Evaluator | Holdout judgement against the spec and running system | Spec and environment; intended to exclude source |

Current L4 uses one outer human-provided cage. Most inter-lane isolation is context, worktree, and convention. The accepted isolation ladder and secret-visibility ADRs distinguish declared requirements from physically enforced boundaries. The evaluator's source blindness and secret restrictions are not fully enforced by the current shared environment.

The target runtime retains the lane concept while separating it from the current three templates and from the physical cage.

## Current interface and distribution

The current technical interface is `faff`:

- `faff-*` skill directories provide conversational commands;
- `plugin/skills/faff/bin/faff` provides deterministic commands;
- `scripts/link-skills.sh` links the skills and binary for development or global use;
- marketplace installation copies the plugin; and
- the governance GitHub Action can resolve an in-checkout binary or fetch a pinned executable path.

The migration must support symlink, marketplace, in-checkout, and pinned enforcement use. A TypeScript source tree that requires an end user to compile before invoking a skill would break this interface.

## Current-to-target responsibility map

| Current area | Target owner | Transition action |
|---|---|---|
| `plugin/skills/faff-*` | Skills facade and Software Delivery binding | Retain interface; move covered deterministic choices into handlers without removing conversational work |
| `bin/faff`, config, tracker commands | Compatibility and domain facade | Introduce typed registry; retain old command paths as aliases |
| `next.js`, `run-done.js`, `queue-state.js` and related pure decisions | Decision kernel | Characterise, capture inputs, convert to TypeScript, expose stable functions |
| `faff-beep-boop` control prose | Current coordinator | Instrument; compare; replace only bought decisions |
| Current ledgers, anchors, and per-run artifacts | Current record adapter and compatibility reader | Bundle in Phase 0; classify in Phase 1; cut over one new-run slice in Phase 2A |
| Events, effects, runcheck, audit, reconcile, sentry, and budget modules | Record substrate, runtime supervision, or Commissaire according to semantic owner | Split mechanics from decisions behind typed ports |
| Contract definitions and profiles | Commissaire contracts plus domain policy | Convert selected slice to admitted versioned contracts |
| Engine, backend, harness, and concurrency modules | Worker adapters and execution infrastructure adapters | Retain behind assignment and realised-lane ports |
| PR, CI, merge, holdout, tracker, and environment logic | Software Delivery binding | Keep domain nouns above generic ports |
| Disposition, quality, economics, and tracker status | Projection engine and domain views | Rebuild from current records first; switch reader after canonical cutover |
| L3 and L4 watcher assets | Deployment triggers | Add bundle publication and recovery while retaining bounded invocations |

# Part III: transition architecture

## Transition techniques

Every change uses one or more of these techniques:

1. characterise existing behaviour;
2. add a typed port around the current implementation;
3. run a proposed decision path in shadow;
4. cut over one vertical slice with a compatibility reader; and
5. remove the old writer only after parity, recovery, and rollback evidence pass.

There is no `extract everything` step. A vertical slice starts at a current command or external fact and ends in a user-visible or evidence-visible outcome.

## Canonicality timeline

### Phase 0

`run-ledger.json`, `events.jsonl`, declared effects, anchors, and current per-issue artifacts keep their current meanings. At a safe boundary, a publisher creates an immutable, redacted off-box recovery bundle containing verified copies, manifest digests, artifact references, the last safe boundary, unresolved effects, and the next permitted action.

The bundle is a replica and recovery input. It is not a new journal.

### Phase 1

Every current artifact receives one future classification:

- translated content for new runs after cutover;
- rebuildable projection;
- immutable blob referenced by a record; or
- frozen historical format served by a compatibility reader.

The map names current writers, current consumers, integrity, future owner, translation, cutover, and rollback.

### Phase 2A

One selected external-producer slice uses the generic envelope as canonical for newly created work in that slice. It has one writer path and an authenticated producer binding sufficient for the admitted contract. Earlier runs stay frozen under their current format.

A creation record fixes the canonical format for a run or work item. Readers support both formats. Writers never mirror the same logical record into both.

## Safe-boundary recovery

A Phase 0 safe boundary exists only when:

- completed facts and artifacts have been durably published;
- current chain heads and ledger digests verify;
- the latest completed stage and membership outcomes are known;
- every attempted protected effect is known, explicitly unknown, or reconciled;
- uncommitted workspace state is excluded from completion claims; and
- a restart descriptor names the next permitted action.

Recovery on a later executor:

1. retrieves the immutable bundle by run ID;
2. verifies its manifest, ledgers, chains, artifacts, and redaction metadata;
3. creates a new run-segment ID;
4. reconstructs current projections;
5. observes any effect whose outcome is not proved;
6. selects the next safe stage or a founded park;
7. creates new stage-attempt IDs for retried work; and
8. appends the resumed current-format evidence.

It does not claim recovery of lost memory, a shell, a container, or an uncommitted worktree.

## TypeScript migration

The TypeScript work is a cross-cutting implementation track:

1. Add compiler, bundler, lockfile, strict configuration, build manifest, and artifact-freshness checks without switching the live entrypoint.
2. Add opaque identities, result types, command ownership, and runtime validators.
3. Write new V5 recovery and interface modules in TypeScript.
4. Convert pure decision modules behind unchanged CommonJS-compatible exports.
5. Convert the current record adapters and evidence mechanics exercised by the selected slice.
6. Convert Commissaire handlers exercised by the external facade.
7. Convert runtime coordination handlers if Gate 1 buys Phase 3.
8. Convert remaining adapter and domain clusters after their ownership is settled.
9. Switch the entrypoint to the generated registry and standalone artifact.
10. Remove the mixed-source path only when no authoritative runtime JavaScript remains.

A conversion is complete only when:

- the TypeScript source is authoritative;
- no unchecked cast crosses an input boundary;
- runtime validation covers external data;
- old module imports and CLI results pass parity fixtures;
- the standalone distribution passes clean-install tests; and
- rollback to the preceding artifact is demonstrated.

Tests may remain JavaScript during the source migration. Test-language conversion is separate and should occur only when it reduces maintenance or improves type-level fixtures.

## Interface migration

### Command classification

Phase 1 assigns every current command a semantic owner:

- Commissaire governance;
- SuperDomestique runtime;
- Software Delivery;
- shared record or infrastructure mechanics; or
- compatibility-only.

The current `regions.js` classification is an input, not the answer. A command named `governance-check` may contain domain policy, while a current `governance` module may implement generic record mechanics.

### Commissaire introduction

Phase 2A introduces the `commissaire` executable over typed handlers. Current `faff` governance paths become compatibility aliases. The external proof uses only the new executable and its documented artifacts.

### Runtime naming

No `superdomestique` executable is required before a generic coordinator exists. If Gate 1 buys coordination, Phase 3 introduces it over the same registry and leaves current `faff` runtime paths as aliases.

### Skill names

The current skill directories remain installable. Gate 2 may choose new canonical SuperDomestique names. Any rename requires:

- alias discovery in each supported harness;
- byte-equivalent or behaviour-equivalent dispatch tests;
- documentation of the preferred and legacy names;
- a measured compatibility period;
- no duplicate semantic implementation; and
- a pinned pre-rename release.

## Lane transition

The current lane tables become the first Software Delivery templates. Transition work separates:

- the lane declaration;
- its stage binding;
- its worker assignment;
- the physical execution realisation;
- the assertion evidence; and
- the assurance Commissaire accepts.

Current context-only isolation remains available in embedded mode with honest claims. Stronger reference scenarios may require separate processes, CI jobs, or cages. The runtime emits intent and asserts the promised environment. The outer execution layer supplies it.

Domain-declared extra lanes are admitted when the lane schema, runtime capabilities, and contract can realise them. Adding a lane does not by itself add a workflow step; a domain lifecycle must bind stages to it.

## Coordinator transition

Before Gate 1, current orchestration remains authoritative. Instrumented decision points record:

- kernel function and version;
- complete normalised input;
- prescribed action;
- actual normalised harness action;
- causation and identity references; and
- token, elapsed-time, and intervention cost.

Missing inputs are `not replayable`. Control flow with no kernel prescription is `uncovered`. Neither counts as divergence.

A shadow coordinator consumes the same recorded inputs but causes no effects. It reports coverage, harmless divergence, wasteful divergence, wrong divergence, latency, and cost. Only a positive coordination result permits live cutover of the measured decisions.

## Compatibility and release baseline

Before the first runtime or interface cutover, the project publishes a pinned, installable baseline containing:

- the current skills;
- the current CLI artifact;
- supported Node and harness assumptions;
- artifact schemas;
- clean-install instructions; and
- the current evidence and limitation statement.

The preferred migration is a compatibility facade over one implementation. A separate classic package or maintained release line is a fallback only if Gate 2 approves an incompatible package split. A repository fork is avoided because it duplicates fixes, schemas, and governance rules.

## Rollback

Rollback rules are part of each slice:

- Additive recovery publication can be disabled without changing current canonical files.
- Decision capture and shadow coordination can be disabled without changing actions.
- A TypeScript module can route through its prior handler until the old source is removed.
- A new CLI alias can route back to the existing handler.
- A generic journal slice can stop creating new generic-format work while retaining readers for existing work.
- A work item never changes canonical format in place to perform rollback.
- Historical evidence is never rewritten to resemble the rolled-back version.
- A failed stronger lane assertion returns to the lower declared profile only through a new admission or explicit contract amendment.

The first irreversible boundary is creation of the first canonical generic-format work item. The compatibility reader and format discriminator must ship before that creation is enabled.

## Verification architecture

The design requires these test layers:

| Layer | Purpose |
|---|---|
| Type check | Exhaust identities, state unions, command ownership, and ports |
| Runtime schema validation | Reject invalid external, disk, worker, and compatibility input |
| Current behaviour characterisation | Freeze command outputs, exit codes, artifacts, and transitions before movement |
| Contract tests | Hold each port and CLI surface to the same semantics across adapters |
| State-machine tests | Exercise every permitted and forbidden transition per scope |
| Property tests | Check event idempotency, revision conflict, deterministic replay, and seal stability |
| Concurrency tests | Exercise append locks, leases, competing assignments, and lineage heads |
| Failure injection | Kill executors, truncate publication, forge producers, lose artifacts, and make effects ambiguous |
| Compatibility tests | Run current skills and `faff` paths against new handlers and artifacts |
| Isolation tests | Assert visibility, secret, filesystem, process, network, and artifact-timing boundaries |
| External facade tests | Prove a producer can use Commissaire without current scheduling or skills |
| Comparative tests | Measure governed treatment against the strong one-shot control |
| Distribution tests | Install and run the generated CLI through symlink, marketplace, checkout, and pinned enforcement paths |

Every end-to-end reference fixture emits a machine-readable result matrix and a human-readable summary. Seeded failures prove mechanism behaviour, not natural catch rate.

## Open implementation decisions

| Decision | Earliest trigger | Evidence required |
|---|---|---|
| TypeScript compiler and bundler | Foundation slice | Node 20 standalone artifact, import parity, reproducible build, acceptable size and startup time |
| Generated source layout | Foundation slice | Marketplace, symlink, checkout, and pinned-action install tests |
| Recovery-bundle store | First Phase 0 publisher | Immutable publication, digest retrieval, redaction, operator cost |
| Safe-boundary set | First killed-executor fixture | Proven reconstructability and next-action decision |
| Phase 2A producer authentication | External producer threat model | J-C conformance and forgery fixture |
| Stream partition | Phase 1 map and Phase 2A slice | Real contention, causation, and query patterns |
| `commissaire` argument and config format | Phase 2A facade | External use without `.faffrc` scheduling assumptions |
| `superdomestique` CLI | Gate 1 coordination yes | Live coordinator scope and compatibility map |
| Standard base lane templates | First internal binding plus external producer | Two concrete uses and no hidden domain nouns |
| Per-lane physical isolation | A contract requires a property current topology cannot enforce | Threat model, runner topology, assertion fixture |
| Package or repository split | Gate 2 | Working typed ports, second use, release and compatibility cost |
| Canonical skill rename | Gate 2 | Harness alias support, migration evidence, product decision |
| Long-running service | V5 service trigger | Latency, lease, contention, producer-authentication, partner, or operator-cost data |

An open decision does not block earlier additive work.

## Rejected transition shapes

### Big-bang TypeScript rewrite

Rejected because it combines language, build, distribution, and behaviour changes across 45,000 lines before producing a user-visible result.

### Service-first runtime

Rejected because current evidence does not require a daemon, hosted control plane, or network writer.

### Parallel canonical histories

Rejected because two writers can disagree about one run and make recovery or acceptance ambiguous.

### Treating skills as legacy

Rejected because skills are the current adoption advantage and remain required in every V5 outcome.

### Treating a lane as a container

Rejected because context, process, CI, human, and remote-service realisations are all valid when they meet the declared boundary. A container alone can also fail the declaration.

### Renaming before ownership is separated

Rejected because a `commissaire` binary that still imports scheduling and Software Delivery internals would provide a new name without external consumability.

### Forking the current product at the first cutover

Rejected as the default because it duplicates bug fixes, contracts, tests, and governance semantics. A pinned baseline and one compatibility implementation are cheaper until evidence proves otherwise.

## Completion conditions for the technical architecture

The earned end state is present only when:

- skills still provide a clean Software Delivery adoption path;
- current `faff` interfaces resolve through compatibility handlers;
- governance consumers can use `commissaire` without importing current scheduling or skills;
- runtime and governance source is TypeScript with a dependency-free executable distribution;
- identities and state scopes are distinct in code and records;
- every relied-on record carries the required producer and integrity assurance;
- domain bindings can add lanes without weakening runtime or Commissaire floors;
- current and generic record formats have one-writer canonicality and verified readers;
- recovery succeeds from off-box artifacts without the original executor;
- every positive verdict is reconstructable from sealed records and artifacts;
- conditional coordinator, service, package, and naming work exists only when its gate passed; and
- the retained software-focused outcome remains viable if horizontal productisation stops.
