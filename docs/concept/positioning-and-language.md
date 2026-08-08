---
sidebar_position: 3
---

# Positioning and language

SuperDomestique, currently shipped as `faff`, is an engineering system for progressively autonomous AI software delivery governed by deterministic evidence.

This page is the canonical source for product positioning, target names, transitional wording, maturity language, and public writing rules. Use the [dated public-claims audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md) for the evidence status of individual claims. The current audit is a pinned snapshot, not continuous semantic enforcement.

## Current and target identity

**Faff (current identity).** Faff is the current project, repository, package, CLI, and shipped technical identity. It is not a former name: commands, configuration, paths, URLs, and source identifiers remain `faff` until separate migration work changes them.

**SuperDomestique (target identity).** SuperDomestique is the target umbrella product identity for the system that runs a progressively autonomous software-delivery loop under deterministic governance. It is not currently a renamed package, command, repository, or distribution.

**Commissaire (target responsibility).** Commissaire is the target name for the governance responsibility that checks evidence and applies deterministic gates at trusted chokepoints. It is not currently an independent package, process, service, or security boundary.

**Governed autonomy (current delivery model).** Governed autonomy is a delivery model in which scheduled human attention decreases only as named deterministic controls, evidence, and failure paths earn that trust. It is not full autonomy, defect-free output, or permission to remove human judgement where the evidence does not support it.

At first public mention, write "SuperDomestique, currently shipped as `faff`". After that, use SuperDomestique for the target product story and `faff` for literal current identifiers. Historical records keep the names under which they were written.

The [July 2026 positioning brief](https://github.com/shftwst/faff/blob/main/docs/superpowers/specs/2026-07-20-docs-positioning-design.md) remains a historical record. [ADR 0096](https://github.com/shftwst/faff/blob/main/docs/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md) supersedes its rejection of a separate brand and its no-renaming non-goal. The brief's evidence-first policy, trust-per-rung model, and treatment of governance as a product remain current.

## What Commissaire means today

Commissaire names a responsibility, not a new deployable component. Today that responsibility lives in the `faff` repository's logical governance region and includes deterministic contract checks, run evidence and liveness records, budget and side-effect controls, termination checks, and the interlocks whose evidence supports their use.

[ADR 0042](https://github.com/shftwst/faff/blob/main/docs/adr/0042-three-tier-region-model-shared-infra-governance-factory-with-a-one-way-direction.md) records the current three-region architecture. Its region map and dependency-direction lint establish an in-repository boundary. They do not establish process isolation, an independent security boundary, or a separately distributed product.

Current architecture documentation may therefore use "governance layer" or "governance region" when it refers to shipped code. Use "Commissaire" when discussing the target responsibility and product concept.

## Maturity and evidence

"Safe to stop watching" is a workload-specific outcome backed by the mechanisms named for that rung. It does not promise defect-free output, mechanical coverage of every control, or suitability for every repository.

<!-- faff-claim-status:readme-safe-to-stop-watching:attested -->
The current "safe to stop watching" position is **attested** for the documented governance posture, not a universal guarantee. The [public-claims audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md) records the supporting guide and the remaining need for reproducible cross-harness evidence.

<!-- faff-claim-status:readme-l3-park-and-ledger:enforced -->
Current L3 unattended delivery is **enforced** at its park-and-ledger boundary: admitted work cannot finish cleanly while dangling, and ambiguity is surfaced through the park protocol. The [public-claims audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md) names the runcheck and Stop-hook mechanisms.

<!-- faff-claim-status:l4-completion-claim:unsupported -->
An unqualified claim that current L4 is complete is **unsupported**. L4 mechanisms exist, but external verification and governed programme closure remain incomplete, as recorded by the [public-claims audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md).

Describe maturity per rung and per mechanism. Treat **enforced**, **attested**, **demonstrated**, **planned**, **stale**, and **unsupported** as the current evidence statuses in the [dated audit](https://github.com/shftwst/faff/blob/main/docs/audits/2026-08-07-FAFF-732-public-trust-claims.md), not as marketing intensity. Later evidence changes require an explicit audit refresh.

## Writing guide

- Lead with governed autonomy and the evidence-bounded meaning of "safe to stop watching".
- Describe the [current L1 to L4 model](./levels.md) as trust earned per rung, not convenience gained per rung.
- Treat governance as a product responsibility, not an appendix to a build tool.
- Name the evidence status of material claims and link the artifact that owns it.
- Use current technical identifiers literally and target names conceptually.
- Avoid framing the product as chore removal, a convenience tool, project management, or unqualified full autonomy.
- State a gap with its status, evidence link, and owning issue.

Terminology lifecycle is separate from evidence status:

- **Preferred public terms:** SuperDomestique, Commissaire, governed autonomy, and trust earned per rung.
- **Retained technical identifiers:** `faff`, repository and package names, commands, configuration keys, URLs, paths, and run artifacts.
- **Misleading or retired terms:** convenience tier, fully autonomous without scope, chore-removal tool, and project-management system.
- **Unsettled future decisions:** distribution and technical-identifier migration choices listed below.

## Unsettled decisions

Whether Commissaire becomes a separate distribution remains unsettled.

Whether or when `faff` technical identifiers are renamed remains unsettled.
