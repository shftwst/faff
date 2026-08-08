# ADR 0096 — Adopt SuperDomestique and Commissaire through staged naming

- **Status:** Accepted
- **Provenance:** human
- **Date:** 2026-08-08
- **Issue:** FAFF-733

## Context

The repository's current public identity is Faff, and its technical surface is consistently named `faff`. The [July 2026 positioning brief](../superpowers/specs/2026-07-20-docs-positioning-design.md) deliberately rejected a separate brand and made renaming a non-goal. The desired product direction now uses SuperDomestique for the umbrella engineering system and Commissaire for its governance responsibility. Without a staged decision, public prose would either ignore that direction or imply that packages and boundaries already exist when they do not.

The current architecture supports part of the distinction. [ADR 0042](./0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md) records a logical governance region with a one-way dependency rule, but it does not establish an independent package, process, service, or security boundary. The [FAFF-732 public-claims audit](../audits/2026-08-07-FAFF-732-public-trust-claims.md) also requires positioning claims to retain their evidence status rather than outrun what has been shown.

## Decision

Adopt **SuperDomestique** as the target umbrella product identity and **Commissaire** as the target name for the governance responsibility. During the transition, **Faff** remains the current shipped identity and `faff` remains every current technical identifier, including the repository, package, CLI, commands, configuration, paths, URLs, and run artifacts.

Public prose introduces the relationship as "SuperDomestique, currently shipped as `faff`". It uses SuperDomestique for the target product story, Commissaire for the target governance responsibility, and `faff` for literal current interfaces. The canonical definitions and writing rules live in [Positioning and language](../concept/positioning-and-language.md).

This decision supersedes only the July brief's rejection of a separate brand and its no-renaming non-goal. Its evidence-first policy, trust-per-rung model, and treatment of governance as a product remain in force. Whether Commissaire becomes a separate distribution and whether technical identifiers are renamed remain future decisions.

## Consequences

- Documentation can adopt the target product story before a compatibility-sensitive technical rename exists.
- Contributors have one canonical language source and must keep material trust claims aligned with the dated claims audit.
- Current architecture documentation may continue to say governance layer or governance region when it refers to shipped code.
- No reader should infer from the name Commissaire that a package, service, process-isolation boundary, or security boundary currently exists.
- The historical brief remains readable as written and carries a narrow supersession notice rather than a rewritten decision history.
- Later distribution or identifier-migration work requires its own explicit decision and compatibility plan.

Self-review: these consequences match the delivered slice. It adds a canonical guide and transition links while preserving all current technical identifiers and treating the earlier brief as history.

confidence: high
