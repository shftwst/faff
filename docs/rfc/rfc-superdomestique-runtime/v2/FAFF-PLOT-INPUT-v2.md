# FAFF Plot Input v2: Bank L4, Then Prove a Runtime for Safe Progressive Autonomy

Use this as the primary initiative brief. `roadmap.yaml` is the structured planning source. The rest of the pack defines architectural constraints.

## Initiative

**Title:** Bank L4 and prove the SuperDomestique / Commissaire architecture

## Strategic intent

Do not jump directly from today's software-specific FAFF implementation into a generic business-agent platform.

First produce a credible L4 reference release. Then determine whether the current system can be honestly decomposed into:

```text
FAFF
    lightweight skills/plugin/harness adoption layer

Software Delivery domain pack ──────┐
                                    │
Other domain packs ─────────────────┼──▶ SuperDomestique
                                    │     deterministic progressive-autonomy runner
                                    │     around probabilistic/external workers
                                    ▼
                               Commissaire
                               independent deterministic governance
```

## Near-term naming constraint

For the next 1–2 months:

- project/docs identity: **SuperDomestique**;
- repository/plugin/skills/commands: **FAFF**;
- governance subsystem: **Commissaire**;
- do not introduce another public brand;
- do not claim generalized domain-pack runtime as current implementation.

Recommended public line:

> **SuperDomestique is the project currently implemented and distributed as FAFF; existing repository, plugin, skill and command names are retained while the architecture evolves.**

## Core thesis

> **Workers reason probabilistically. SuperDomestique coordinates deterministically. Commissaire governs independently.**

And:

> **Commissaire governs; SuperDomestique runs; domain packs define meaning; workers perform work.**

## Immediate gate: L4 Reference Release

Before broad extraction:

- complete remaining L4 correctness/hardening work;
- improve only ergonomics required for believable unattended operation;
- produce successful reference run;
- produce intentionally blocked/failure run;
- demonstrate independent adversarial/holdout responsibilities;
- demonstrate fail-closed evidence/governance;
- demonstrate park/escalation/recovery;
- document L3 vs L4;
- document current limitations;
- commit proposed future architecture ADRs;
- tag the release.

Do not hold the release for non-critical polish.

## Architecture to test after L4

### Commissaire owns

- governed event history and integrity;
- authority/policy verdict composition;
- evidence obligations;
- effects/observations/reconciliation;
- lifecycle conformance;
- checkpoint/acceptance verdicts;
- audit reconstruction.

It must not orchestrate models/workers or understand domain nouns.

### SuperDomestique owns

- task/contract runtime state;
- lifecycle graphs and stage attempts;
- bounded lanes;
- worker assignment/invocation;
- deterministic routing and correction;
- pause/park/resume/escalation;
- human intervention;
- canonical control-plane state;
- worker/provider interfaces.

### Domain packs own

- task types;
- lifecycle composition;
- custom stages;
- lane templates;
- prompts/skills;
- domain policies/evidence;
- worker bindings;
- integrations;
- domain effects/observers;
- UI extensions.

### FAFF adoption layer may own

- skills/plugin distribution;
- harness-native commands;
- developer-local defaults;
- L1–L4 progressive adoption UX;
- compatibility/projection into existing coding workflows.

## Infrastructure philosophy

**Own semantics; adapt infrastructure.**

Own:

- Delegation Contract;
- lifecycle primitives;
- lane semantics;
- evidence/effect/reconciliation;
- acceptance;
- domain-pack/runtime/governance protocols;
- conformance suites.

Use reference + replaceable adapters for:

- authorization/policy;
- durable execution;
- workflow/agent runtimes;
- identity/secrets;
- connectors;
- persistence/observability.

Do not expose backend-specific formats as the canonical pack API by accident.

## Workstreams

### W0 — L4 reference release
Finish, harden, failure-test, document, tag.

### W1 — Four-way current-main inventory
Classify code as Commissaire / SuperDomestique runtime / Software Delivery domain / FAFF adoption / adapter.

### W2 — Contracts and architectural boundaries
ADRs, Delegation Contract, lifecycle, lane, worker/provider/governance contracts.

### W3 — Commissaire facade
Expose current governed facts through a narrow domain-neutral API.

### W4 — SuperDomestique runtime vertical slice
One software task through generic task/lifecycle/lane/worker/control-plane structures.

### W5 — Software Delivery domain-pack slice
Move concrete software semantics out of the runtime boundary while preserving FAFF UX.

### W6 — Second-domain proof
Supplier onboarding or similarly distinct evidence-heavy process.

### W7 — Adapter proof
Replace native authorization with external task-scoped authorization; use an external worker/runtime.

### W8 — Execution-independent Commissaire
Govern a workflow that SuperDomestique did not primarily execute.

### W9 — Control-plane proof
Generic supervision without transcript dependence.

### W10 — Competitive falsification
Compare against simpler workflow/agent baseline.

### W11 — Decision and optional productisation
Continue horizontal, narrow/verticalise, or retain software focus.

## Mandatory proof criteria

The generalized path only succeeds if:

1. same runtime runs unrelated domain packs;
2. same Commissaire categories govern both;
3. no domain nouns/conditionals leak into core/runtime;
4. worker cannot self-accept;
5. separation-of-duty lane rules are enforceable;
6. consequential effect can be blocked before execution;
7. false effect claim is exposed by independent observation;
8. contract amendment invalidates affected work predictably;
9. authorization backend can be swapped without pack changes;
10. Commissaire can govern external execution;
11. generic control plane is usable without transcripts;
12. benefits exceed a simpler established workflow approach.

## Non-goals before proof

- hosted multi-tenant platform;
- connector marketplace;
- generic visual workflow builder;
- full repo/package split;
- broad rebranding;
- replacement for authorization/policy engines;
- replacement for durable workflow engines;
- replacement for n8n/LangGraph/agent harnesses;
- enterprise SSO/SCIM programme;
- compliance certification claims.

## Planning instructions

Create:

- one parent Linear initiative;
- projects matching W0–W11;
- small reviewable issues;
- explicit dependencies;
- exit gate and evidence artifact for every project;
- ADR issues for every unresolved architecture decision;
- failure-injection issues, not only success-path work;
- conformance tests for every provider/adapter interface;
- decision checkpoints where work may intentionally stop.

Do not let the future runtime derail the L4 release.
