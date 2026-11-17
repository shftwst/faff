---
name: faffter-dark-authoring-adaptors
description: "Author or validate a slot skill: scaffold adaptors, producers or methodologies against the fixed gateway contract and check conformance."
judgement_seam: none
---

# faffter-dark-authoring-adaptors

Author or audit a `slots` occupant: an adaptor, producer, methodology or mechanism. Invoke this advanced skill when writing or auditing occupants, outside the ordinary day-to-day pipeline. `spec`/`review`/`ship` producers emit their own `faff-contract:<name>` blocks; their paired adaptor slots are retired. When a native producer cannot emit its block, author a fused wrapper that emits it on the producer's behalf.

## Contract loading

Skills load independently. For standalone authoring or validation, Read `faff/references/kernel.md` first, then the lane references whose contracts you touch: `faff/references/build.md`, `faff/references/l4.md`, `faff/references/methodology.md`, `faff/references/review.md`.

Fixed consumers load the gateway on entry, making delegated contracts ambient. Standalone occupants must read it themselves. Author must include that refer-back instruction in each new occupant; Validate must reject its absence. Local recaps never replace the gateway (gateway **Contract loading & conformance**).

## Two faces

- **Author:** given a slot and description, scaffold its refer-back prose, required faces and mapping to the fixed contract; fill the dialect. Follow `docs/reference/skill-authoring.md`: lean, deduplicated, skimmable. `faff validate-adapters` enforces its lintable rules.
- **Validate:** given a skill name or path, apply the checklist and return `pass`/`fail` with specific violations. Use before adoption, in CI and at runtime. Before first use, the pipeline always validates a configured foreign occupant (absent from `REGISTRY`); `fail` parks/surfaces. The `--is-bundled` predicate exempts bundled `faffter-*` occupants, including non-default alternatives (gateway **Slot conformance validation**).

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

## Conformance checklist (what Validate checks, what Author bakes in)

1. **Names its slot and contract.** State the occupied slot and mapped gateway section from the table; rendering states it has no fixed contract.
2. **Carries refer-back prose.** Include **How this contract reaches you**: the invoking consumer loads the gateway, so it is ambient during slot use; standalone invocation must Read sibling `faff/references/kernel.md` or the lane reference holding the named section now, before applying it. Rendering is exempt.
3. **Recaps are non-normative.** Label every fixed-vocabulary recap non-normative and state "gateway wins on any conflict." Never present a local copy as authoritative.
4. **Maps onto, never redefines.** Translate the dialect without adding, removing, narrowing or renaming fixed vocabulary, classes, verdicts or named outputs. Extra review verdicts/spec classes and omitted required methodology outputs are non-conformant.
5. **Honours the slot's faces and obligations:**
   - Adaptors define and validate.
   - Producers do the work and emit their `faff-contract:<name>` block; wrap native tools that cannot emit it. Ship merges/deploys only gate-passed PRs and emits `faff-contract:delivery-outcome` for the consumer's three fixed outcomes, never a fourth.
   - Methodology answers `pick-ordering`, `promotion-readiness`, `build-queue` and `backlog-diagnostics` (always fired), and degrades gracefully on optional outputs.
   - Mechanisms honour their action obligations. Concurrency builds every partition issue, serialises and requires each dependency blocker merged, records every terminal outcome in the ledger, and preserves the merge gate. Skipping/deferring partition issues, weakening the gate or sharing a worktree between concurrent builds fails conformance.
6. **Respects appetite.** Acting slots, including methodology and mutating producers, read the suite-wide `appetite` dial; never invent another agency level.
7. **Stays in its lane.** Adaptors translate/validate, never sequence, park or write to the tracker. Producers do work, never manage the backlog. The fixed consumer owns gating and sequencing.
8. **Declares its judgement seam.** Require `judgement_seam:` frontmatter listing owned grader `KIND` values; alternate occupants mirror their slot sibling, asserted-deterministic skills use `none`. Introducing/changing a seam requires its grader, at least one eval case and seam-registry row in the same change. Recording the baseline is the human step and is never required by lint. `faff validate-adapters` fails registry surfaces missing a seam declaration and covered kinds without cases.

## Author face

Given the target slot + a one-line description, emit a skeleton:

```
# <skill-name>

<one-line: what this <adaptor|producer|methodology> does and which slot it fills>

## Internal contract (fixed — see gateway)   ← omit for rendering_adaptor / producers; a mechanism points at Mechanism slots
Maps onto gateway → <named §>. Fixed there, unaffected by this swap: <one-line recap, non-normative>.

**How this contract reaches you.** Loaded by the invoking consumer when run as a slot; if invoked
standalone, Read the sibling `faff/references/kernel.md` → <named §> now before applying. Gateway wins on any conflict.

## <Dialect>           ← the markers / envelope / assignment rules / lens / execution strategy this skill owns
## Validate            ← for adaptors: checks + the pass/fail envelope
## Rules
```

Fill the dialect; leave the contract pointers exactly as scaffolded.

## Validate face

Given a slot skill (name or path), read it and run the checklist. Output:

```
signal: pass | fail

## Violations
### [checklist item]: [where]
[what's wrong] → [the fix]
```

Return `pass` only when no checklist item fires. Missing refer-back prose, an authoritative local recap or a redefined fixed vocabulary is `fail`, never a warning.

**Mechanical pre-check:** resolve `faff` through gateway **Resolver** if absent from `PATH`, then run:

- `faff validate-adapters` for shipped defaults. It checks refer-back prose, non-normative markers, required methodology outputs and mechanism contract pointers; drift exits non-zero. Use in CI/pre-commit.
- `faff validate-adapters --configured` for the occupants configured in `.faff/config.yaml`. It derives each expected profile from its slot; run before trusting an unattended build.

Neither structural check replaces this Validate face. Apply semantic items 4 (**Maps onto, never redefines**) and 7 (**Stays in its lane**) yourself, including for third-party occupants outside the skills directory.

## Rules

- Author and audit occupants; never edit the gateway contract. Propose a needed fixed state, class or verdict in faff-core's gateway first, never add it to an adaptor.
- Apply the foreign-occupant runtime gate under **Two faces**; bundled defaults and alternatives are exempt. Contract loading still follows the consumer-load and standalone-read rules.
- Use the Validate envelope above, matching faffidavit's validate face.
