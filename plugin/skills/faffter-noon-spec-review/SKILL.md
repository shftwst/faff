---
name: faffter-noon-spec-review
description: "Default L1-L3 spec_review slot: one architectural, infosec, methodology and QA checklist pass over a freshly rated spec; emit a founded spec-review verdict."
judgement_seam: spec-verdict
user-invocable: false
---

# faffter-noon-spec-review

The default L1-L3 `spec_review` reviewer: challenge approach soundness, safety,
scope and verifiability before code exists. `faff-prep` invokes this single pass
after confidence rating and before promotion to Todo, validates the emitted
contract and routes its verdict.

> When standalone, Read the sibling `faff/references/kernel.md` (the shared kernel) first, then `faff/references/autonomous.md` and `faff/references/methodology.md` (the lanes it consumes) — together they hold the shared rules and the fixed contracts. This recap is non-normative; the gateway kernel wins.

## What it does

Walk exactly the selected lenses, collect objections and emit one founded verdict.
Without a selected set, run all four. The consumer owns selection; `infosec` and
`QA` always fire at L1-L3. This occupant does not launch adversarial refuters.

This producer owns reasoning and the roll-up below. The consumer runs
`faff contract spec-review-verdict` for shape validation; do not repeat it here.

## Inputs

The consumer passes:

- The spec body (the freshly-produced, confidence-rated spec).
- The **selected lens-set + mode** from the consumer's change-surface lens-selection step. Fire exactly the named lenses; absent a set, fire all four. `mode` is `single-pass` here (the `adversarial` mode routes to the L4 occupant).
- The attached `## Methodology critique` block, when prep wrote one (the methodology slot's already-computed value/scope signal).
- Repo architecture context, including the configured ADR directory for cross-slice decisions.

## The four lenses (single-pass checklist)

| Lens | Asks | Source it draws on |
|---|---|---|
| `architectural` | Is the design sound? Does it fit the system? Is there a simpler/cheaper design? Are cross-slice decisions ADR-worthy and consistent with existing ADRs? | The spec body + repo architecture + configured ADR directory. |
| `infosec` | What is the threat surface? authz/authn, secrets handling, blast radius. | A **generic** security checklist — no learned per-repo threat prior. |
| `methodology` | Right-sized? Right increment? Worth doing now? | **Consumes** the attached `## Methodology critique`. It never re-derives value/scope/risk. |
| `QA` | Is it *verifiable*? Can we tell when it is done and right? A `## Scenarios` unit whose check is a repository test file passing is unverifiable by the code-blind holdout (it cannot read or run one) — raise it, routing the verdict to `revise` so the author restates it observably and moves the test-file check to its own DONE item. A `## Scenarios` unit with no observable `Then` (and no `MUST` or comparator) cannot be judged code-blind, and a holdout-marked one is also hidden from the builder, so it checks nothing — raise it, naming the unit, so the verdict routes to `revise`. | The spec's scenarios / DONE criteria. |

Severities are `blocker` / `major` / `minor`. Emit at most one objection per lens (the lens's worst finding); a lens with no finding contributes none.

**Object only to what must change before build.** Any objection turns `approve` into `revise`, so these are not objections: a choice the builder settles during the build without a new decision, a test any decent suite adds anyway, a threat that needs a careless implementation the spec never asks for, and another lens's point restated in yours. A spec with nothing else gets `approve`.

**Each objection carries the enrichment triple** `{claim, evidence, predicted_consequence}` alongside `{lens, severity}` — `claim` (what is wrong), `evidence` (the spec clause / file it points to), `predicted_consequence` (the concrete, checkable thing that happens if the spec ships as-is). A lens that cannot name a concrete consequence sets `predicted_consequence: "not separately stated"` — the honest signal that the objection is taste-level. Each objection also carries the optional `spec_anchor`, stated as this exact bullet (the one rule home in code is faff `bin/lib/heading-slug.js`):

- spec_anchor: the heading slug of the spec section this objection attacks. Derive it from the heading's raw markdown line (drop the leading hash marks and surrounding whitespace, strip nothing else): lowercase; replace every run of characters outside a-z0-9 with a single hyphen; trim leading and trailing hyphens. Omit the field entirely if you cannot name one section. Worked examples: `### Aggregation — carry the anchor` → `aggregation-carry-the-anchor`; `### Phase 2 — (revised)` → `phase-2-revised`; ``### The `spec_anchor` field`` → `the-spec-anchor-field`.

The enrichment fields are additive: they never change the verdict roll-up below, and a legacy `{lens, severity}`-only objection still validates.

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

Where a `reject-approach` routes (prep vs plot) is the **consumer's** concern, computed by `faff spec-review route` from lens and severity — this producer just emits the founded verdict.

## Output (the contract artifact)

Emit exactly one `faff-contract:spec-review-verdict` block. The consumer locates
and JSON-parses it, then pipes it to `faff contract spec-review-verdict`, the sole
source of contract data and validation. Canonical semantics:
`faff contract spec-review-verdict --describe`.

```faff-contract:spec-review-verdict
{ "verdict": "approve", "objections": [] }
```

A founded non-approve example, including the enrichment fields:

```faff-contract:spec-review-verdict
{ "verdict": "reject-approach", "objections": [ { "lens": "architectural", "severity": "blocker", "claim": "the loop cannot terminate", "evidence": "How, step 3", "predicted_consequence": "hangs on empty --dir", "spec_anchor": "the-gate-verdict-seam" } ] }
```

## Level gradient (the cost-stable boundary)

- **L1-L3:** this occupant's one selected-lens checklist pass and founded verdict.
- **L4:** a separate occupant uses independent per-lens adversarial refuters,
  gated on majority/severity, and emits the same contract.
- Depth/cost scales with level, appetite and change-surface. The consumer's
  additive cost gate may skip only confidently safe, low-risk lenses; `infosec`
  and `QA` always fire at L1-L3. An uncertain surface fires all four.
