---
sidebar_position: 4
---

# Execution and governance

SuperDomestique, currently shipped as `faff`, combines probabilistic AI work with deterministic controls. The controls do not make model judgement deterministic. They make the inputs, allowed outcomes, evidence, failure direction, and authority boundaries inspectable.

Commissaire is the target name for that governance responsibility. Today it is a logical region inside the `faff` CLI, not a separate package, process, service, or security boundary.

## Four responsibility classes

| Responsibility | Current owner | Current examples | What the system can claim |
|---|---|---|---|
| **Reasoning and execution** | AI agents operating through skills and configured model backends | discovery, planning, specification, implementation, review, and synthesis | The work is probabilistic. Its outputs can be constrained and recorded, but the same prompt is not guaranteed to produce the same decision. |
| **Objective conformance** | Deterministic CLI code and forge controls | schema validation, run events, liveness, budgets, side-effect records, termination checks, required CI checks, and merge protection | The same recorded input follows the same coded rule and fail direction. This proves only the rule that the named mechanism actually checks. |
| **Subjective engineering judgement** | AI reviewers and humans | whether a design is appropriate, a finding is valid, prose matches evidence, or a criterion that needs interpretation has been met | A structured verdict makes the decision traceable; it does not turn the judgement itself into an objective fact. |
| **Retained authority** | Humans, expressed directly or through prior bounded instructions | setting the objective and autonomy level, admitting work, accepting product decisions, resolving parked ambiguity, approving interactive gates, and changing credentials or external authority | Automation proceeds only within authority already granted. Unresolved judgement stops or parks instead of silently widening that authority. |

These classes interact. A model may produce a review verdict, deterministic code may reject a malformed or unsafe value, and a human may still retain the decision to accept the underlying risk. None of those steps should be described as doing the job of another.

## Two deterministic layers

The repository separates generic governance mechanics from SuperDomestique's software-delivery policy. Both layers contain deterministic code, but only the first is intended to be reusable governance substrate.

### Generic governance mechanics

The region map currently classifies these command families as governance:

- **Evidence and liveness:** `events`, `heartbeat`, `review-progress`, and `build-progress`;
- **Bounds and intervention:** `budget`, `effects`, `sentry`, `sentry-poller`, and `sentrycheck`;
- **Run verification:** `runcheck`, `reconcile`, and `audit`;
- **Vocabulary:** `profiles`.

The same region also contains the generic contract-validation engine and internal resume mechanics. These components record facts, validate supplied structures, apply bounded failure rules, and reconstruct run state without importing the delivery factory.

### SuperDomestique delivery policy

The factory decides what those mechanics mean for software delivery. It owns ticket admission and transitions, specifications and product decisions, delivery contract definitions, worktrees, environments, model backends, quality gates, holdout policy, CI binding, and merge policy.

This distinction explains two names that can otherwise mislead:

- `governance-check` is factory code because it binds acceptance criteria, review verdicts, and holdout results into SuperDomestique's CI policy.
- `merge-gate` is factory code because it applies SuperDomestique's delivery-specific merge floor.

Likewise, the generic contract engine can validate a schema without knowing its domain, while `contract-defs.js` remains factory code because it defines the delivery verdicts and their meanings. Deterministic implementation is necessary for objective conformance; it is not sufficient to make a rule generic governance.

## Dependency direction

The current module graph permits dependencies in one direction:

```text
dispatch shell  ──► factory ──► governance ──► shared infrastructure
       │               └────────────────────────────►
       └────────────────────────────────────────────►
```

Factory code may consume governance and shared infrastructure. Governance code may consume shared infrastructure. Shared infrastructure may not import another local region, and governance may not import factory code.

`faff regions check` reads each module's region banner and its real CommonJS `require()` edges. It fails if governance imports factory, if shared infrastructure imports another local module, or if a source file cannot be attributed. CI runs this boundary check. The check proves the current source dependency direction; it does not prove process isolation, independent deployment, or a security boundary.

## Where judgement crosses the boundary

The common pattern is:

1. an AI or human makes a judgement;
2. the producer emits a structured result;
3. deterministic code validates its shape, allowed vocabulary, and safe failure direction;
4. a delivery gate consumes the validated result;
5. unresolved or disallowed outcomes stop, park, or return control to a human.

For example, a reviewer decides whether a change is acceptable. The review contract can reject malformed output and can prevent an unknown result from becoming a pass, but it cannot prove that the reviewer's engineering assessment is true. The evidence should therefore say that invocation and conformance are enforced while review quality remains judgement-dependent.

## Current extraction boundary

The governance region is designed so factory code can consume it without a reverse dependency. That makes future extraction plausible, not complete.

A separately shipped Commissaire would still require an explicit packaging and compatibility decision, a stable public interface, a second consumer, and a security model if process isolation were intended. None of those exists today. Until they do, use **governance region** for the shipped code boundary and **Commissaire** for the target responsibility.

## Implementation evidence

- [`regions.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/regions.js) owns the command classification and require-graph check.
- [`contract-engine.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/contract-engine.js) is the generic schema-validation and fail-direction machinery.
- [`contract-defs.js`](https://github.com/shftwst/faff/blob/main/plugin/skills/faff/bin/lib/contract-defs.js) contains delivery-specific contract meanings.
- [ADR 0042](https://github.com/shftwst/faff/blob/main/docs/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md) records the region model.
- [ADR 0052](https://github.com/shftwst/faff/blob/main/docs/adr/0052-cli-module-layout-layered-region-aligned-modules-behind-a-thin-entrypoint.md) records the physical module layout.
- [Positioning and language](./positioning-and-language.md) owns the current and target naming rules.
