---
name: faffter-noon-spec-review
description: "Default `spec_review` slot occupant — the L1–L3 single-pass spec reviewer. Runs four lenses (architectural / infosec / methodology / QA) as one checklist pass over a freshly-rated spec and emits a founded `faff-contract:spec-review-verdict` block. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-spec-review

The default occupant of the **`spec_review`** slot — the L1–L3 single-pass approach reviewer. It is the judgement layer of the spec stage: it challenges *the approach itself* (sound? safe? right-sized? verifiable?) while the work is still just a spec, before any code exists. faff-prep invokes it once after the spec is confidence-rated and before promote-to-Todo, then pipes its verdict through `faff contract spec-review-verdict` and routes on the result.

> When standalone, Read the sibling `faff/SKILL.md` (the gateway) first — it holds the shared rules and the fixed contracts. This recap is non-normative; the gateway wins.

## What it does

One LLM pass walks **four lenses** as a checklist over the spec, gathers `{lens, severity}` objections, maps them to a single verdict, and emits one contract block. It is **not** an adversarial review — that costlier per-lens refuter form is a separate occupant. All four lenses always fire in this one pass.

The contract (`faff contract spec-review-verdict`) validates the verdict's **shape** only. This producer owns the **reasoning** — the lenses and the severity→verdict roll-up below. Do not re-validate shape here; emit a conformant block and let the consumer pipe it.

## Inputs

The consumer passes:

- The spec body (the freshly-produced, confidence-rated spec).
- The attached `## Methodology critique` block, when prep wrote one (the methodology slot's already-computed value/scope signal).
- Repo architecture context, including `docs/adr/` for cross-slice decisions.

## The four lenses (single-pass checklist)

| Lens | Asks | Source it draws on |
|---|---|---|
| `architectural` | Is the design sound? Does it fit the system? Is there a simpler/cheaper design? Are cross-slice decisions ADR-worthy and consistent with existing ADRs? | The spec body + repo architecture + `docs/adr/`. |
| `infosec` | What is the threat surface? authz/authn, secrets handling, blast radius. | A **generic** security checklist — no learned per-repo threat prior. |
| `methodology` | Right-sized? Right increment? Worth doing now? | **Consumes** the attached `## Methodology critique`. It never re-derives value/scope/risk. |
| `QA` | Is it *verifiable*? Can we tell when it is done and right? | The spec's scenarios / DONE criteria. |

Severities are `blocker` / `major` / `minor`. Emit at most one objection per lens (the lens's worst finding); a lens with no finding contributes none.

**Methodology lens — consume, never recompute.** Read the attached critique and translate it into at most one `methodology` objection (e.g. a critique flagging a too-large slice → a `methodology` blocker on scope). It must issue **zero** value/scope re-derivation. **If no `## Methodology critique` block is present** (prep ran with no methodology slot), the lens degrades to "no signal available", emits no methodology objection, and notes the gap — it never falls back to recomputing value or scope.

## The verdict roll-up (severity → verdict)

After gathering objections, apply this deterministic map (a producer-local heuristic, not a contract rule):

```
PROCEDURE map_verdict(objections):
  IF objections is empty:                          → approve
  IF any objection is a blocker:
     IF the blocking lens is architectural         → reject-approach   # design wrong, right scope → prep re-specs
     IF the blocking lens is methodology (scope)   → reject-approach   # wrong increment → plot re-slices
     IF the blocking lens is infosec               → needs-human       # threat calls need a human at L1–L3
     IF the blocking lens is QA                     → revise            # unverifiable → add scenarios/DoD in place
  ELSE (only major/minor objections, no blocker)   → revise            # fixable in place
```

The **founded-verdict invariant** (enforced by the contract): `approve` carries zero objections; every other verdict carries at least one. Keep the emitted objections consistent with the verdict — when a blocker drives the verdict, that blocker is in the array.

Where a `reject-approach` routes (prep vs plot) is the **consumer's** concern, read off the objecting lens — this producer just emits the founded verdict.

## Output (the contract artifact)

Emit exactly one fenced block as the producer's output — the consumer (`faff-prep`) locates it, `JSON.parse`s it, and pipes it to `faff contract spec-review-verdict` (the sole source of contract data):

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```

Examples of a founded non-approve verdict:

```faff-contract:spec-review-verdict
{ "verdict": "reject-approach", "objections": [ { "lens": "architectural", "severity": "blocker" } ] }
```

```faff-contract:spec-review-verdict
{ "verdict": "revise", "objections": [ { "lens": "QA", "severity": "major" } ] }
```

The fixed verdict shape (`approve` / `revise` / `reject-approach` / `needs-human`, plus `objections: [{ lens, severity }]` over the enums `architectural|infosec|methodology|QA` × `blocker|major|minor`) and its validation live in the gateway's contract-as-code surface. A swapped-in reviewer (e.g. an adversarial per-lens occupant) conforms by emitting the same block.

## Level gradient (the cost-stable boundary)

Review depth scales by level, all mapping onto the one `spec-review-verdict` contract:

- **L1–L3** — this skill: one single-pass 4-lens checklist, one founded verdict.
- **L4** — independent per-lens adversarial refuters, each prompted to refute the spec from its angle, gated on majority/severity (a separate occupant in the same slot).
- Depth/cost scales with **level + appetite + change-surface**; selective per-lens firing by change-surface is a later refinement.

This skill ships the L1–L3 form and leaves the L4 hook.
