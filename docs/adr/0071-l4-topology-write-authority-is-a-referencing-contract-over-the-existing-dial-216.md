# ADR 0071 — L4 topology-write authority is a referencing contract over the existing dial, 216-free

- **Status:** Proposed
- **Date:** 2026-07-15
- **Issue:** FAFF-493
- **Amended:** 2026-07-15 — container-create row superseded in part by ADR-0072 (FAFF-515); all other rows, the epic-create scope, and the two-floor methodology unchanged.

## Context

The "top of the loop" plan pass (PRDR 0001) must hold every autonomous structure write inside "a defined autonomy envelope — topology-write-authority dial at L4, bounded by the reversibility and human-curated-structure floors, independent of FAFF-216" (`docs/prdr/0001-…:15`). No such envelope existed as a concrete contract, and its feasibility — whether it can be expressed without FAFF-216 (parked, feasibility-blocked: L4 autonomous structural self-curation, re-link/re-prioritise of *existing* machine-authored work) — was unproven. FAFF-493 is the de-risk spike that answers this before FAFF-494 (unattended plot re-entry) and FAFF-495 (loop-path PRDR author+admit) build against it.

The existing topology-write-authority dial (`plugin/skills/faff/SKILL.md:712-729`) is keyed by **appetite** (`low`/`medium`/`high`/`full`) with no level axis and no L4 row. L4 reaches the `full` row only indirectly: ADR-0037 pins "at L4 appetite resolves to `full` unconditionally." So the L4 envelope is not a new dial — it is a contract that reads the existing `full` grant through the L4 pin and proves it stays inside the two standing floors (reversibility, `SKILL.md:724`; human-curated-structure, `SKILL.md:485`,`725`).

Two questions were open going into the spike:

1. **Where does the envelope live?** Extending the dial table with an L4 row would fork the appetite axis and break ADR-0035's one-definitional-home policy ("a grep for the table headers returns a single home," `docs/adr/0035-…:40`). The alternative is a separate referencing artifact that composes the existing dial by citation.
2. **Does authoring ADR-0069 (the outward-only constraint, not yet written — sibling spike FAFF-496's job) have to happen first?** The outward-only assumption is already grounded in committed PRDR-0001/0002 prose, so a citation may suffice without waiting on ADR-0069.

Both were closed by human resolution before this ADR was authored (Linear FAFF-493, comment `e6ef18ad`, 2026-07-15): **(1)** separate referencing artifact, not a dial-table row; **(2)** ADR-0069 authoring is not a precondition — cite the PRDR prose.

## Decision

**The L4 topology-write autonomy envelope is a separate referencing artifact — this ADR plus a named, validated contract — that composes the existing appetite-keyed dial via the ADR-0037 `full`-at-L4 pin. It adds no row to the dial table.**

**Scope: epic-only.** The envelope covers autonomous **first-slice epic creation** at L4 only. Container (initiative/project) creation stays confirm-gated at every level including `full` (`faff-plot/SKILL.md:67`: "Containers always confirm… expensive to undo"); the reversible reparent/convert/rehome ops the dial already grants at `full` remain in-envelope. Lifting the container-confirm floor is a strictly larger claim than "express the existing dial as a contract" and is out of scope — documented so it is not silently re-proposed (see Consequences).

**The envelope as a pure decision function.** `l4_topology_envelope(op) -> verdict`, where:

```
op:      { kind: container-create | epic-create | reparent | convert | rehome | cancel | delete,
           level: L1..L4, provenance: faff-authored | human-curated, parent_confirmed: bool }
verdict: { disposition: admit | propose-only | reject, reason: string, reversible: bool }
```

The decision table (every row cited against both floors in the proof below):

| `op` | `disposition` | `reversible` |
|---|---|---|
| `epic-create`, `level: L4`, `faff-authored`, `parent_confirmed: true` | `admit` | `true` |
| `epic-create` — not L4, or parent unconfirmed | `propose-only` | `true` |
| `reparent` \| `convert` \| `rehome`, `faff-authored` | `admit` | `true` |
| `container-create`, any level | `propose-only` | `true` |
| any `kind`, `provenance: human-curated` | `propose-only` | `true` |
| `cancel` \| `delete`, any level | `reject` | `false` |

The disposition vocabulary is deliberately the **`admit` / `propose-only` / `reject`** triad `faff prdr admit` already speaks (`computePrdrAdmissionVerdict`, `bin/lib/contract-defs.js:884`, `PRDR_DISPOSITIONS`) — the envelope invents no fourth disposition, so a consumer that already reads `faff prdr admit` verdicts reads this one with no vocabulary translation.

**Contract shape: Pattern B.** A `faff-contract:l4-topology-envelope` block, validated by a deterministic `faff contract l4-topology-envelope` (`bin/lib/contract-defs.js`, schema `contracts/l4-topology-envelope.schema.json`), carrying the decision table above as its pure core plus fixtures. The validator recomputes the expected verdict from `op` and checks the declared `verdict` conforms — the same "producer claims, validator re-derives and checks" shape as `computePrdrAdmission`.

**Gate routing: reuse, not a parallel gate.** Plan-time topology writes route through the existing `faff prdr admit --actor loop` gate as an added precondition alongside FAFF-255's two gates + FAFF-222 containment + the appetite floor — never a parallel admission path (keeps idempotence / anti-thrash single-homed, `SKILL.md:718`). Because the disposition vocabulary is identical, the compose needs no `propose-only`/`reject` remap.

**Outward-only: an upstream pre-filter, assumed.** The envelope operates on an **already outward-filtered op stream** — "faff never plans itself" is enforced upstream of this contract, by a run-start predicate + FAFF-496's refusal taxonomy, sourced from `docs/prdr/0001-…:15,21` and `docs/prdr/0002-…`. The `op` shape carries **no target axis** by design; this contract does not re-enforce outward-only (that would duplicate FAFF-496). **ADR-0069 (which would formalise outward-only) is not a precondition of this decision** — the PRDR prose citation suffices; authoring ADR-0069 remains FAFF-496's job.

## Consequences

- **One definitional home holds.** The dial table (`SKILL.md:712-729`) gains at most a one-line composition anchor pointing at this ADR — never an L4 row. A grep for the dial's table headers still returns a single home (ADR-0035's invariant, undisturbed).
- **FAFF-494 / FAFF-495 have a concrete contract to build against.** FAFF-494 (unattended plot re-entry) reads the block's `disposition`/`reversible` per plot gate in place of the interactive yes/edit/no; FAFF-495 (loop-path PRDR author+admit) composes the verdict as a precondition to `faff prdr admit --actor loop`, without a second admission path.
- **Container creation is never autonomous, even at `full`.** This is a deliberate, recorded floor-preservation — not an oversight. A future proposal to lift it is a larger, separate decision and must not be read into this ADR.
- **216-independence holds by construction** — see the trace below. If a future extension of this envelope (e.g. widening scope beyond first-slice epics) requires re-linking or re-prioritising *existing* machine-authored structure, that extension is FAFF-216's axis and must halt and re-scope rather than silently ride this ADR.
- **No new mechanism beyond the one contract.** This is an ADR + a Pattern-B validator + fixtures — no new `faff` subcommand, no new dial, no provenance store. The provenance detection the envelope reads (`faff-authored` vs `human-curated`) reuses the existing marker convention (`SKILL.md:725`).
- **Outward-only stays a soft precondition.** If FAFF-496 / ADR-0069 later shift outward-only's semantics, this contract's `op` shape (no target axis) needs revalidation — flagged, not blocking, per the spec's assumption note.

## Two-floor conformance proof

Every `admit` row must cite a clause of **both** the reversibility floor and the human-curated-structure floor. `propose-only` / `reject` rows are covered by the same floors from the other direction (the floor is *why* they are not `admit`) and are included for completeness.

| Row | Disposition | Reversibility-floor clause | Human-curated-structure-floor clause |
|---|---|---|---|
| `epic-create`, L4, faff-authored, parent confirmed | `admit` | `SKILL.md:731` — "`full` adds scope (splits, merges, **new tickets**) but never removes it"; `SKILL.md:724` — reversibility floor names reparent/convert/rehome as the allowed class, and epic-create is pure scope-addition (the hard floor's "adds but never removes" direction), never a cancel/delete | `SKILL.md:725` — the dial governs **faff-authored** topology only; an epic created under a **confirmed** parent never restructures human-curated structure — the parent-confirm precondition *is* the propose-and-confirm gate applied one level up |
| `reparent` \| `convert` \| `rehome`, faff-authored | `admit` | `SKILL.md:724` — "reparent / convert / rehome (reversible) ⇒ allowed" verbatim | `SKILL.md:725` — dial authority is scoped to faff-authored topology only; provenance-detected, so a human-curated edge never silently moves |
| `container-create`, any level | `propose-only` | `SKILL.md:731` — scope-addition would be allowed in principle, but is deliberately not exercised here (container-confirm floor is stricter than the reversibility floor requires) | `faff-plot/SKILL.md:67` — "Containers always confirm… expensive to undo"; the container-confirm floor is a hard `propose-only`, independent of provenance |
| any `kind`, human-curated provenance | `propose-only` | n/a — the human-curated floor pre-empts before the reversibility question is reached | `SKILL.md:485` (assertion 3) — "Never silently restructure human-curated structure… propose-and-confirm, container-gated"; `SKILL.md:725` — composition: the dial never punches through this floor |
| `cancel` \| `delete`, any level | `reject` | `SKILL.md:724` — "cancel / delete (lost scope) ⇒ forbidden always"; `SKILL.md:731` — "No appetite level autonomously cancels or deletes" (hard floor, unconditional) | n/a — the reversibility floor alone is dispositive; forbidden regardless of provenance |

No `admit` row above is left uncovered by either floor — a defect there would be a spec defect (an ungrounded widening), not a documentation gap, per the spike's design principle "independence is a proof obligation, not an aspiration."

## 216-independence trace

Every envelope clause is mapped to an existing, non-216 source. FAFF-216 (parked, feasibility-blocked) is specifically **L4 autonomous structural self-curation — re-linking or re-prioritising *existing* machine-authored structure**. None of the rows below touch that axis: every `admit` row is a **fresh** create or a **reversible move of a single item the dial already grants at `full`**, never a re-link/re-prioritise sweep over already-existing machine-authored structure.

| Envelope clause | Source it maps to | Requires FAFF-216? |
|---|---|---|
| Disposition vocabulary (`admit`/`propose-only`/`reject`) | `faff prdr admit`'s existing `PRDR_DISPOSITIONS` (`bin/lib/contract-defs.js:820`, `computePrdrAdmissionVerdict:884`) | No — reused verbatim, no new vocabulary |
| `epic-create` admitted at L4 | ADR-0037 (`full`-at-L4 pin) + `faff-plot/SKILL.md:68` ("First-slice epics may be auto-created per the appetite dial… `full` may create a whole confirmed branch's epics at once") | No — first-slice epic auto-create under a confirmed parent is an **existing** `full`-level capability; the envelope only pins it to L4 via the ADR-0037 read |
| `reparent`/`convert`/`rehome` admitted | `SKILL.md:724` (dial's own reversibility floor, already grants these at `full`) | No — these are the dial's existing granted ops, not a re-link/re-prioritise capability of *already-created* machine-authored structure that 216 would add |
| `container-create` → `propose-only` | `faff-plot/SKILL.md:67` (container-confirm floor, pre-existing) | No — the floor is unchanged, not a new capability |
| human-curated provenance → `propose-only` | `SKILL.md:485` (assertion 3) + `SKILL.md:725` (composition) | No — the existing provenance-detection rule, unchanged |
| `cancel`/`delete` → `reject` | `SKILL.md:724`,`731` (hard floor, pre-existing, unconditional) | No — floor is unchanged |
| Gate routing (reuse `faff prdr admit --actor loop`) | FAFF-255 (`prdr admit`), FAFF-222 (containment), the appetite floor — all shipped | No — composition of existing gates, no new admission path |
| Outward-only assumption | `docs/prdr/0001-…:15,21`, `docs/prdr/0002-…` (committed prose) | No — cited, not re-implemented; enforcement is FAFF-496's upstream pre-filter |

**Zero clauses map to, or require, FAFF-216's re-link/re-prioritise capability.** The halt condition (§4 of the spec: halt if any clause can only be satisfied by 216, or if two-floor conformance can only be met by lifting a floor 216 owns) does **not** trigger. This spike closes with an emitted contract, not a halt — PRDR 0001 is unblocked, not superseded.
