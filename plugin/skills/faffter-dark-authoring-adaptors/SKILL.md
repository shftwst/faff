---
name: faffter-dark-authoring-adaptors
description: "Author or validate a faff slot skill. Scaffolds a new adaptor/producer/methodology so it carries the correct refer-back prose and maps onto the fixed gateway contract, and validates that an existing slot skill conforms. Use for 'write a new adaptor', 'author a spec/review/routing/rendering skill', 'check my adaptor conforms', 'validate this slot skill'."
judgement_seam: none
---

# faffter-dark-authoring-adaptors

Authors and validates `slots` occupants: adaptors (`routing_adaptor`, `rendering_adaptor`), producers (`intake`, `spec`, `review`, `ship`), `methodology` and mechanisms (`concurrency`). The `spec` / `review` / `ship` contracts are producer-emitted; their adaptor slots are retired. Producers emit the standard `faff-contract:<name>` block their consumer parses. If a native tool cannot, this skill authors a fused wrapper to emit it. Each replacement must carry its own contract-discovery and conformance prose; the Author and Validate faces enforce that binding.

This is a `faffter-dark-*` skill — advanced tooling, not part of the day-to-day pipeline. You invoke it when writing or auditing a slot skill, not during normal faff use.

## Why this skill exists (the binding problem)

Skills load independently. When a slot skill runs — as a delegated slot, or standalone — the sibling `faff/references/kernel.md` (the shared kernel) is **not** guaranteed to be in context. When authoring or validating a slot skill standalone, Read `faff/references/kernel.md` first, then the lane references whose contracts you touch — `faff/references/build.md`, `faff/references/l4.md`, `faff/references/methodology.md`, `faff/references/review.md`. The faff suite handles this with three mechanisms (see gateway → _Core contracts and adaptor slots → Contract loading & conformance_):

1. fixed consumers load the gateway on entry, so a slot they delegate to inherits the contract ambiently;
2. a standalone-invoked slot skill **reads the gateway itself** before applying a contract;
3. **this skill** ensures a *new* slot occupant is written so (2) actually happens — that it refers back rather than silently relying on a copy that can drift or be swapped away.

Without refer-back prose, a delegated slot can inherit the contract yet fail standalone or treat its recap as authoritative.

## Two faces

- **Author** (scaffold): given a target slot and a description, produce the skeleton of a conformant slot skill — with the refer-back prose, the two-face structure, and the map-onto-fixed-contract section already in place. The author fills in the dialect. Write the prose **to the skill-authoring charter** (`docs/reference/skill-authoring.md`) — lean, deduplicated, skimmable — whose lintable subset `faff validate-adapters` enforces.
- **Validate** (audit): given an existing slot skill (by name or path), check conformance and return `pass` / `fail` with specific violations. Before first use of a configured foreign occupant, the pipeline invokes this face and parks or surfaces a failure. The `--is-bundled` predicate exempts bundled occupants (gateway → _Slot conformance validation_).

## The fixed contract each slot maps onto

A slot occupant never owns the contract — it owns its *dialect* and maps onto the gateway's fixed contract. Which contract depends on the slot:

| Slot | Fixed contract it maps onto (gateway §) | What the occupant owns (its dialect) |
|---|---|---|
| `routing_adaptor` | Automation-routing verdict — the six verdicts + admission rule + root-cause enum | verdict assignment, computation locus, display format |
| `rendering_adaptor` | **none** (pure adaptor) — rendering has no fixed contract | the entire rendering style; self-contained, no refer-back needed |
| `methodology` | The `methodology` slot — the named-output contract (which outputs, required/optional, the envelope) | the lens (graph-structural, opinionated, …) that answers each output |
| `spec` / `review` / `ship` (producers) | Spec readiness / Review verdict / Delivery outcome — the producer **emits** a `faff-contract:<name>` block (`spec-readiness` / `review-verdict` / `delivery-outcome`) the consumer parses; no paired adaptor | how the work is done + the self-declared contract block; a producer that can't emit it is wrapped here |
| `intake` (producer) | none — emits a documented discovery brief directly | how discovery is done; the brief shape |
| `concurrency` (mechanism) | Mechanism slots → _The `concurrency` slot contract_ — build every partition issue, serialise + require a dependency blocker to have merged, record terminal outcomes to the ledger (with the `pr-open-for-human`→`pr-open` mapping), never weaken the merge gate | the execution strategy (sequential, capped-parallel, …) + worktree isolation and any merge re-validation |

`rendering_adaptor` is the one exception — it carries no refer-back because there is no fixed contract behind it; it is the source of truth for rendering. Every other slot refers back.

## Conformance

Use the CLI for the existing structural profile, refer-back, recap marker and `judgement_seam`. Review the dialect for the rest:

- Map native outputs onto the fixed vocabulary and required outputs. A new state or a missing obligation fails conformance. A producer wraps a native tool that cannot emit the required contract block. Adaptors define and validate. Methodology answers required outputs and degrades gracefully on optional ones.
- Keep gates, tracker sequencing and parking with the consumer. A slot that acts uses the suite's appetite. A concurrency occupant builds every partition issue, requires dependency blockers to have merged, isolates worktrees, records terminal outcomes in the ledger and preserves the merge gate.
- Mirror the primary slot's judgement seam. For a new or changed seam, add the grader KIND, an eval case and the seam-registry entry in the same change. A human records its baseline.

## Author face

Run `faff validate-adapters scaffold --slot <slot> --name <skill> --description <one-line description> --judgement-seam <KINDs or none> --path <dir>/SKILL.md`. Fill the dialect and preserve the contract pointers. The command refuses to replace a file.

## Validate face

Run `faff validate-adapters check --slot <slot> --path <SKILL.md or skill dir>`. For an installed name use `--skill <name> [--skills-dir <dir>]` instead of `--path`. Report structural failures and unreadable files as violations. On a structural pass, apply the semantic checks above before reporting conformance.

`faff validate-adapters` still lints bundled defaults, and `faff validate-adapters --configured` checks installed configured occupants. Neither replaces this semantic review.

Return `signal: pass` only when both checks pass. Use the existing envelope:

```
signal: pass | fail

## Violations
### [checklist item]: [where]
[what's wrong] → [the fix]
```

## Rules

- This skill authors and audits; it never edits the gateway contract. If a slot genuinely needs a new fixed state/class/verdict, that is a change to faff-core in the gateway — proposed there first, never bolted onto an adaptor.
- Both a development-time tool and a runtime gate. At authoring time it scaffolds/audits; at runtime the pipeline **always** invokes this skill's Validate face on a configured **foreign** occupant before first use (gateway → _Slot conformance validation_) — a **bundled first-party** occupant (the shipped default *or* a non-default `faffter-*` alternative) is never validated, so both the zero-config path and the bundled-alternative path are untouched. The contract binding itself is the consumer-load + standalone-read mechanism in the gateway; this Validate gate is what catches a non-conformant *swap*.
- The output envelope mirrors the faffidavit validate face on purpose — a slot author already fluent in one knows this one.
