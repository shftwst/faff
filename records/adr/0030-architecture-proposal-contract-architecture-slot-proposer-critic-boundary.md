# ADR 0030 — architecture-proposal contract + architecture slot (proposer/critic boundary)

- **Status:** Accepted
- **Date:** 2026-06-28
- **Issue:** FAFF-27

## Context

faff's architecture story is a four-box pipeline — **propose** a design, **critique** it, **record** the decision, **acquire** the infra evidence the proposal is fitted to. Three of the four boxes already ship: FAFF-16/196 **records** (the `adr` slot + `faff adr new` author a Nygard body once a decision is Chosen); FAFF-9 (265–268) **critiques** (the `spec_review` `architectural` lens reviews the design a spec lands); FAFF-26/231 **acquires** (the `profile` slot mines the repo into a `faff-contract:infra-profile`). The first box — *generating* a best-fit, production-grade architecture proposal from the infra profile + brief — was missing. Without it, a slice's architecture is whatever the spec author free-handed; the critic and the human have nothing *generated from the team's actual infra* to weigh.

The issue's own open question was where **proposing** ends and **critiquing** begins — i.e. how a new proposer relates to FAFF-9's already-shipped `architectural` lens. Settling that boundary is the architecturally-significant decision; left unstated, the proposer and the critic would tend to grow overlapping design-judgement logic, and future slices (the proposing strategy, FAFF-28 buy-routing, the L4 quality-judgement) would each re-litigate it.

## Decision

Introduce the missing box as a fixed **`architecture-proposal` envelope contract** `{chosen_architecture, rationale, adr_candidates[], assumptions[], recommendation}` behind a new swappable **`architecture` producer slot**, default `faffter-noon-architecture` — mirroring the FAFF-265 contract+slot+producer triad 1:1 (and inheriting its CI lint + golden-case surface). The contract validates the envelope's *shape*; the producer owns the proposing *strategy* (the swappable opinion). `recommendation` is build-biased — `buy`/`hybrid` is surfaced for a human / FAFF-28, never actioned here.

The durable, non-obvious part is the **proposer/critic boundary**: FAFF-27 *generates* an architecture proposal; FAFF-9's `architectural` lens *critiques* the spec that proposal lands in. They **share no logic** and **meet only through the spec artifact** — the proposer emits an envelope into a spec, the critic reads that spec downstream. This is the same hand-off shape as ADR-0005 (producer emits an artifact; a separate consumer judges it), and answers the issue's open question directly: proposing is generative and writes nothing it judges; critiquing is adversarial and generates nothing it judges.

ADR candidates are emitted as a `## ADR promotion intent` section (deferred materialisation) — the proposer makes **no `faff adr new`** call and writes nothing under `records/adr/`; graft Step 4b materialises any candidate. v1 ships **propose + human-review (L3)**: the machine proposes concrete, born-verifiable decisions, and "is this production-grade?" stays a human gate.

## Consequences

- Future slices build on a settled boundary rather than re-deriving it: the proposing *strategy* (a heavier/cost-first/cloud-native producer) swaps into the `architecture` slot; FAFF-28 buy-routing consumes the `recommendation` field; the L4 autonomous proposal-quality judgement (the named Punt) slots in as a quality gate over the same envelope — none of them needs to touch the critic.
- Consistent with ADR-0025 (spec-review as a fixed contract + swappable slot) and ADR-0022 (PRDR two-gate): faff keeps adding *contract-bounded, slot-swappable* judgement boxes rather than monolithic skills, so the shape is now a well-worn pattern.
- The proposer/critic split is load-bearing: any later temptation to let the proposer self-critique (or the critic self-propose) would collapse the boundary and re-introduce correlated blind spots — the split is what keeps the second opinion independent.
- The contract is shape-only: it cannot judge whether a proposal is *good*, only whether it is *well-formed*. The quality verdict stays human in v1 by design (the L4 Punt), so a conformant envelope is never mistaken for an approved one.
