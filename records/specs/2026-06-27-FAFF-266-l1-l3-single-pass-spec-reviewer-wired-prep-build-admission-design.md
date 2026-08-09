# Spec: L1–L3 single-pass spec reviewer, wired prep→build-admission

> Spec: faffter-dark-nlspec · 2026-06-27 · autonomous · confidence: high. Full spec on Linear FAFF-266.

This spec addresses **FAFF-266**. Audience: the build agent that will upgrade `faffter-noon-spec-review` and wire the seam.

## 1. WHY — Problem and Principles

**Load-bearing model.** FAFF-265 shipped the *spine* — a `spec_review` slot, a fixed `spec-review-verdict` contract (`approve`/`revise`/`reject-approach`/`needs-human` + `{lens,severity}` objections), and a passthrough occupant that always says `approve`. This slice puts a **brain** behind that slot: one LLM pass that walks four review lenses over a freshly-rated spec and emits a *founded* verdict. The whole point is the **`reject-approach` backward edge** — catching a wrong approach while it is still just a spec, before a line of code exists.

**Problem.** Today a spec leaves prep rated only for *internal well-formedness* (the confidence gate: are decisions marked, is it skimmable). Nothing asks *is the approach itself any good* — sound architecture? safe? right-sized? verifiable? A bad approach sails to build and is caught (if at all) at code review, an order of magnitude more expensive. This slice adds the missing approach-critique gate at the cheapest point.

**Design principles:**

- **Shape gate already exists; this is the judgement.** The contract (`faff contract spec-review-verdict`) validates *shape* only (ADR-0025). This producer owns the *reasoning* — including the severity→verdict mapping ADR-0025 deliberately left out of the contract. Do not re-validate shape here; emit a conformant block and let the consumer pipe it.
- **Consume, don't recompute (methodology lens).** Value/scope/right-sizing already have an owner — the `methodology` slot, surfaced by map and tidy and already attached to the spec by prep as a `## Methodology critique` block. The methodology lens *reads* that signal; it never re-derives value×risk.
- **Single-pass, all lenses (L1–L3).** One review pass, four lenses as a checklist — the cheap, proven shape. Adversarial per-lens refuters (FAFF-267) and cost-gated lens *selection* (FAFF-268) are separate slices; at L1–L3 all four lenses always fire in one pass.
- **Compose with the confidence gate, don't replace it.** A spec can be `confidence: high` (well-formed) yet `reject-approach` (wrong approach). The two gates are orthogonal and both must pass to admit.

**Scope statement.** This is the judgement layer of FAFF-9's spec stage at L1–L3; it sits between prep's confidence rating and build-admission.

## 2. OUT OF SCOPE

- **L4 adversarial per-lens refuters** — independent per-lens reviewers each prompted to *refute*. *Extension point:* FAFF-267, swapping a different occupant into the same `spec_review` slot.
- **Cost-gated lens selection by change-surface** — firing only relevant lenses. *Extension point:* FAFF-268.
- **The mechanical admissibility gate** — `faff admissible` (FAFF-224, Done). This slice is the judgement layer *above* it.
- **A learned per-repo infosec threat prior** — v1 infosec is a generic checklist, no learned prior.
- **An *autonomous* `plot` re-entry seam** — a methodology-lens `reject-approach` *surfaces* the slice for a human to take to `/faff-plot`; it does not auto-re-decompose.

## 3. WHAT — Vocabulary, Types, and Interfaces

**The verdict block** (the producer's sole machine output, fixed by FAFF-265):

```
faff-contract:spec-review-verdict
{ "verdict": "approve" | "revise" | "reject-approach" | "needs-human",
  "objections": [ { "lens": ..., "severity": ... }, ... ] }
```

**The four lenses (the checklist):**

| Lens | Asks | Source it draws on |
|---|---|---|
| `architectural` | Sound? Fits the system? Simpler/cheaper design? ADR-worthy + consistent? | The spec body + repo architecture (+ `records/adr/`). |
| `infosec` | Threat surface, authz/authn, secrets handling, blast radius. | A **generic** checklist (no learned prior). |
| `methodology` | Right-sized? Right increment? Worth doing now? | **Consumes** prep's attached `## Methodology critique`. Never recomputes. |
| `QA` | Is it *verifiable*? Can we tell when it's done and right? | The spec's `## Scenarios` / DONE. |

**Design decision — the spec-review level gradient (cross-slice, durable).**
**Chosen:** Review *depth* scales by level: **L1–L3 = one single-pass 4-lens checklist** emitting one founded verdict; **L4 = independent per-lens adversarial refuters**; review **depth/cost scales with level + appetite + change-surface**. Architecturally significant — cross-slice and durable.

**Design decision — where the reviewer lives.**
**Chosen:** Upgrade `faffter-noon-spec-review` **in place**; the slot key, default name, and contract are untouched.

**Design decision — the severity→verdict mapping.**
**Chosen:** A deterministic roll-up the producer applies after gathering objections:

```
PROCEDURE map_verdict(objections):
  IF objections is empty:                         → approve
  IF any objection is a blocker:
     IF the blocking lens is architectural        → reject-approach   # routes to prep (re-spec)
     IF the blocking lens is methodology (scope)  → reject-approach   # routes to plot (re-slice)
     IF the blocking lens is infosec              → needs-human       # threat calls need a human at L1–L3
     IF the blocking lens is QA                   → revise            # add scenarios/DoD in place
  ELSE (only major/minor objections, no blocker)  → revise            # fixable in place
```

**Design decision — `reject-approach` routing (by the objecting lens).**
**Chosen:** When the verdict is `reject-approach`, its destination is a deterministic function of the objecting lens:

| Objecting lens | Routes to | Why |
|---|---|---|
| `architectural` / `infosec` / `QA` | **prep** | the design is flawed *within the right scope* → re-spec |
| `methodology` | **plot** | the *scope / increment* is wrong → re-slice (plot is human-interactive) |
| **multiple lenses object** | **higher altitude — `plot` wins over `prep`** | no point re-speccing a slice about to be re-sliced |

## 4. HOW — Behavior

**Architecture.** The reviewer is an LLM producer invoked by the consumer (`faff-prep`) once, after the spec is produced and confidence-rated, before promote-to-Todo. It runs one pass over the four lenses, collects objections, maps to a verdict, and emits the contract block. faff-prep parses the block, pipes it to `faff contract spec-review-verdict`, and routes on the verdict.

```
PROCEDURE prep_spec_review(spec, methodology_critique):
  1. Invoke slots.spec_review (default faffter-noon-spec-review) with:
        the spec body, the attached `## Methodology critique` block, repo arch context.
  2. Producer runs ONE pass over the 4 lenses → list of {lens,severity} objections.
  3. Producer maps objections → verdict (map_verdict above), emits the block.
  4. Consumer (prep) parses block, pipes to `faff contract spec-review-verdict`:
        exit 2 (fail-loud) → treat as needs-human (producer breakage), park.
        exit 1 (violations) → treat as needs-human, park (contract not satisfied).
        exit 0 (conformant) → route on verdict:
           approve         → continue to the existing confidence gate + promote
           revise          → apply the lens fixes in place, re-rate, re-review (bounded loop)
           reject-approach → route by the objecting lens:
                               design lens (arch/infosec/QA) → re-plan in prep (bounded loop)
                               methodology lens              → surface for human-interactive /faff-plot
                               multiple lenses               → the higher altitude wins (plot)
           needs-human     → park, surface the lensed objections for /faff-wtf
```

**Design decision — the seam placement and order relative to FAFF-224.**
**Chosen:** The review runs **inside faff-prep, after the confidence rating, before promote-to-Todo**; its verdict is **retained on the spec** so build-admission consumes the retained verdict (via Live-thread reconciliation) rather than re-reviewing. At L1–L3 the mechanical admissibility gate is dormant, so there is no ordering conflict; at L4 mechanical admissibility precedes approach-critique.

**Design decision — bounding the revise / reject-approach loop.**
**Chosen:** Cap the prep↔review loop at **2 iterations**; on a third unresolved `revise`/`reject-approach`, downgrade to `needs-human` and park.

**Edge cases:**

- **Malformed / non-conformant block** (exit 1 or 2) → `needs-human` + park (fail-safe).
- **`approve` but `confidence: low/medium`** → the confidence gate still governs; both gates compose.
- **methodology critique block absent** → the methodology lens degrades to "no signal available", emits no methodology objection, never recomputes value/scope.
- **Autonomous vs interactive** → identical verdict computation; routing differs only in who acts. A methodology-lens `reject-approach` is human-interactive in both modes.

**Anti-pattern:** the methodology lens recomputing value/risk/right-sizing. It must read the already-attached critique.
**Anti-pattern:** re-validating the verdict *shape* inside the producer. The contract is the sole shape authority.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a freshly-rated spec with a sound, in-scope, verifiable approach
When the spec_review reviewer runs its single pass
Then it emits verdict "approve" with an empty objections array
And faff-prep proceeds to the existing confidence gate
```

```
Given a spec whose architectural approach is unsound (a blocker-severity architectural objection)
When the reviewer maps objections to a verdict
Then it emits "reject-approach" with the architectural blocker objection
And faff-prep re-plans the spec in place (in prep) rather than parking it
```

```
Given a spec whose increment is wrong-sized (a blocker-severity methodology objection)
When the reviewer maps objections to a verdict
Then it emits "reject-approach" with the methodology blocker objection
And faff-prep surfaces the slice for human-interactive /faff-plot rather than re-speccing in prep
```

```
Given a spec that is well-formed but states no way to verify it (a QA blocker)
When the reviewer runs
Then it emits "revise" carrying the QA objection
And faff-prep applies the fix (adds scenarios / DoD) in place and re-reviews
```

```
Given a reviewer that emits a block failing `faff contract spec-review-verdict` (exit 1 or 2)
When faff-prep pipes the block
Then faff-prep treats it as needs-human and parks, never admitting the spec
```

Assertion: the methodology lens issues **zero** value/scope re-derivation calls.
Assertion: all four lenses fire in a single pass at L1–L3.
Assertion: a `reject-approach` destination is a pure function of the objecting lens.

## 8. DONE — Definition of Done

### From WHAT
- [ ] `faffter-noon-spec-review` is upgraded in place; the slot key, default name, and contract are unchanged.
- [ ] The producer emits exactly one `faff-contract:spec-review-verdict` block satisfying the founded-verdict invariant.
- [ ] All four lenses (architectural, infosec, methodology, QA) are exercised in a single pass at L1–L3.
- [ ] The `map_verdict` roll-up matches the pseudocode.
- [ ] `reject-approach` is routed by the objecting lens (design lens → prep · methodology → plot · multiple → plot wins).
- [ ] The spec-review level gradient is honoured: ships the L1–L3 single-pass form, leaves the L4 hook.

### From HOW (behaviour)
- [ ] faff-prep invokes `slots.spec_review` after the confidence rating and before promote-to-Todo.
- [ ] The verdict is retained on the spec and consumed at build-admission (via Live-thread reconciliation).
- [ ] `approve` → continue; `revise` → fix in place + re-review; `reject-approach` → route by objecting lens; `needs-human` → park.
- [ ] The prep↔review loop is capped at 2 iterations, then `needs-human` + park.

### From HOW (edge cases)
- [ ] A block failing the contract (exit 1 or 2) → needs-human + park, never admit.
- [ ] Absent methodology critique → methodology lens degrades to no-signal, never recomputes value/scope.

### From OUT OF SCOPE
- [ ] No L4 adversarial refuters, no cost-gated lens selection, no autonomous plot re-entry seam are built here.

confidence: high
