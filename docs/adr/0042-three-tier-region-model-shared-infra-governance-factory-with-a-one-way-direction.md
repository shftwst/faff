# ADR 0042 — Three-tier region model: shared-infra / governance / factory with a one-way direction invariant

- **Status:** Proposed
- **Date:** 2026-07-04
- **Issue:** FAFF-359

## Context

The faff CLI is a single flat 12k-line namespace in which the extractable audit/governance subcommands (runcheck, heartbeat, events, effects, budget, sentry, audit, the contract-validation engine) are interleaved with factory-specific workflow code, and shared helpers live in whichever section first needed them (latestRunDir inside runcheck yet consumed by config's appetite resolution; schemaCheck inside contract yet called by run-done and prdr). The extraction topology (design/extraction-topology.md) requires the governance layer's extractability to be a provable property, gated on a future second consumer — but nothing in the codebase states or enforces which code could leave the repo. A naive governance/factory two-way split is impossible: both sides genuinely share infrastructure, and forbidding factory→governance calls would force helper duplication.

## Decision

The CLI is partitioned into three machine-tagged regions plus an exempt dispatch shell, with a one-way direction invariant enforced by lint:

- **shared-infra** — generic helpers (root/ledger/config-subset parsing); imports nothing from either region.
- **governance** — the flight-recorder + interlock subcommands and the contract-validation engine; may import shared-infra only. Never references factory identifiers.
- **factory** — faff's delivery-workflow code, including the contract definitions; may import shared-infra and governance (the future package-consumer relationship, kept legal by design).
- **dispatch shell** — the COMMANDS registry, USAGE, and main(): exempt, since it references everything by construction.

The boundary is semantic, not positional: sections are tagged in place; only mis-homed helpers move. Membership is declared once in an in-code region map consumed by both the direction lint and the per-region selftest runner. Persisted formats keep their current field names (the unit/issue rename is glossary-level until a versioned schema change at physical extraction).

## Consequences

- Physical extraction of the governance layer becomes a mechanical move (regions are already dependency-clean), and the region map is the future package manifest.
- Every new CLI section must declare a region (untagged sections fail the lint loudly), and a governance member without a selftest is a fatal finding — the boundary stays provable, not aspirational.
- Factory code may continue calling governance helpers freely; the reverse is build-broken. Contributors lose the freedom to reach from governance code into factory conveniences — intentional friction.
- The registry single-source-of-truth decision is composed with, not forked: the region map keys off COMMANDS names; lint-cli-doc's bijection is unchanged.
- Cross-region self-spawns (sentry→budget, hook probes) remain invisible to the lint by design — they are process boundaries, the exact seams extraction preserves; the lint's claim is scoped to in-file identifier references.
- Accepted cost: the tag+lint machinery is bespoke to the single-file constraint; if the file is ever modularised, the lint retires in favour of real module imports.
