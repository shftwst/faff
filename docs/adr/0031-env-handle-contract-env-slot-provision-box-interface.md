# ADR 0031 — env-handle contract + env slot (provision-box interface)

- **Status:** Accepted
- **Date:** 2026-06-28
- **Issue:** FAFF-30

## Context

faff's lights-out build-and-judge pipeline is a four-box flow: **propose** an architecture, **provision** a representative runtime, **seed** it with a synthetic dataset, then **evaluate** the build against it. The propose box (FAFF-27) emits an architecture proposal, the seed box (FAFF-31) realises a deterministic dataset, and the evaluate box (FAFF-34) is the holdout judge. The provision box was missing: the evaluator had a build and a dataset but nowhere to run them, so "review passed" could only mean "the code compiles," never "the system behaves."

The provisioning *mechanism* is intentionally not fixed. A team may stand its stand-in up with docker-compose locally now, and with a cloud preview environment or an ephemeral container later. What the evaluator depends on must be stable even as the mechanism changes: a description of a running, health-checked environment it can point at and tear down. Pinning the mechanism into the pipeline would couple the judge to one way of standing an environment up and block the swap.

## Decision

Introduce a fixed **`env-handle`** envelope contract behind a new swappable **`env`** producer slot, defaulting to `faffter-noon-env-compose`. This mirrors the propose box's contract-plus-slot-plus-producer triad: the *handle is the interface*; the *provisioning mechanism is swappable behind it*.

The handle is a record — `{ status, endpoint, endpoints?, health_checks, readiness?, teardown_ref, teardown_cmd?, credentials?, provisioned_at, provisioner, violations }` — validated for shape by a pure compute function over the handle object (no I/O). The contract's exit code is the gate: `0` only when the handle is conformant **and** `status: ready`; `1` for any violation (a non-ready status, a missing required field, a bad status enum, a ready handle with no endpoint); `2` fail-loud on a non-object. A non-ready environment is therefore never gate-passing, by construction.

The producing strategy lives entirely in the slot occupant, never in the contract. The default occupant derives services from the team's infra profile, brings them up with docker-compose, waits for health, seeds the environment, and emits one ready handle — or emits a `failed` handle with violations and leaves nothing half-up. A different occupant (a cloud preview, a persistent staging environment) conforms by emitting the same block; the evaluator never learns how the environment was stood up.

## Consequences

The `env-handle` is the substrate three downstream consumers build on. FAFF-34 gates evaluation on `status: ready` and refuses to judge against an untrustworthy environment. FAFF-29 builds local-dev ergonomics on top of this contract rather than duplicating it. FAFF-12 references the provisioned environment as an execution target. Because all three depend on the *contract* and not the *mechanism*, swapping compose for a cloud producer is a config change, not a rebuild.

This slice ships the interface only — the contract, the slot, and the prose producer. The contract compute is a pure function with no I/O, so CI exercises it without docker. The tested live-provisioning path (real docker-compose bring-up, health-wait, seeding, teardown) is tracked separately as FAFF-270, which blocks FAFF-34. The decision is consistent with the architecture-proposal contract-plus-slot precedent (ADR-0030) and the spec-review contract precedent (ADR-0025): faff fixes the verdict envelope the pipeline branches on, and leaves the producing strategy to a swappable slot.
