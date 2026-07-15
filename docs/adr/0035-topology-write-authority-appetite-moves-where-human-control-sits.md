# ADR 0035 — Topology-write authority — appetite moves where human control sits

- **Status:** Accepted
- **Date:** 2026-06-29
- **Issue:** FAFF-291

## Context

faff's methodology lens (the agile-delivery lens, `faffter-dark-methodology-agile-delivery`) has until now only *diagnosed and reordered a presentation view* of the backlog — it surfaces findings and re-ranks a queue, but it does not own the **shape** of the tracker. The shape — which project a ticket sits under, the blocker edges between tickets, where new work lands — is the tracker's **topology** (the methodology-agnostic ground truth; "structural" in faff's post-FAFF-296 vocabulary). The evidence that this gap matters: the L4 "Down the pub" MVP was the correct vertical-slice shape but was hand-created, not methodology-derived, and non-spine scope subsequently accreted into it while real blockers lingered in thematic homes.

A cluster of four changes (FAFF-292/293/294/295) each want to grant the methodology some authority to **write topology**: reparent a gating chain into the stream it gates, default new work to a plain backlog, rehome scope without deleting it, convert a thematic project to an outcome-led one. Left uncoordinated, each would invent its own per-appetite authority story, and the question the human actually asked — *as the methodology gains power to restructure the tracker, where does human control go?* — would have no recorded answer.

Two forces bound any such grant and were already partly expressed in the gateway but not unified for the topology axis:

- The tracker is the lights-out **control plane**, re-read each pass (FAFF-60). A structural write that is not idempotent thrashes — a rehome A→B that flips back B→A next pass. The authored-record work already faced and solved this (FAFF-199's thrash-guard).
- The existing appetite **hard floor** already forbids autonomous cancel/delete at every level including `full`, and the autonomous-mode contract already forbids silently restructuring **human-curated** structure (propose-and-confirm, provenance-detected). A new topology-write grant must compose with these, not fork a second, divergent set of floors.

## Decision

Appetite is the **topology-write-authority dial**, defined once in the gateway (`Appetite for destruction → Topology-write authority`) as a third shared-contract modulation alongside resolve-attempt and automation-routing, and referenced — never duplicated — by the methodology lenses. Two theses fix what it means.

**Thesis 1 — appetite moves *where* human control sits, it does not remove it.** At every level the human stays in control of the tracker's shape; the dial only relocates the control surface:

- `low` / `medium` / `high` — control sits in the **structure**. The human curates the graph and approves each consequential move: `low` is surface-only (zero topology writes), `medium` applies only unambiguous low-judgement ops, `high` (the current default) acts on clear cases but **proposes** scope-cuts for confirmation.
- `full` — control sits in the **DoD/PRD leash**. The methodology may form projects and converge scope end-to-end in one logged pass, because the human has set the ends (the definition-of-done / PRD) and audits the means after the fact, rather than approving each move before it.

The same tracker write therefore carries different authority at different levels — not because the *operation* changes, but because *where the human's hand rests* changes from per-move structural approval to outcome-leash plus audit.

**Thesis 2 — the control plane evolves from marker-writes to admitting methodology topology-writes.** The tracker-as-lights-out-control-plane (FAFF-60) began by admitting only *marker* writes (status, labels, park/resolve comments — the per-step legibility trail). This decision admits a new class of autonomous write: methodology **topology** writes — reparent / convert / cut-by-rehome — bounded by two invariants that hold at *every* level, including `full`:

- **Reversibility floor.** Reparent / convert / rehome are reversible ⇒ allowed; cancel / delete (lost scope) ⇒ forbidden, always. This is **not** a new rule and **not** a second floor: it is the existing hard-floor "no level autonomously cancels or deletes; `full` adds scope but never removes it," *named for the topology axis*.
- **DoD ceiling.** Topology moves stay *beneath* the human-owned DoD/PRD — the recursive-setpoint invariant. The methodology may rearrange the means; it never redefines the ends the human set.

Two guardrails make the grant safe in the re-read-each-pass loop: every topology write is **idempotent** (anti-thrash — a rehome never flips back next pass, mirroring the authored-record thrash-guard), and the **default-landing legibility-preserver** is treated as a matched pair with the reparent/rehome power — new work lands in a plain backlog, never auto-filed into a project, *because* the higher levels grant more power to reorganise what is already there, so inflow must stay predictable and human-owned.

**Composition, not divergence.** The dial's authority covers only **faff-authored / methodology-derived** topology. It does **not** punch through the existing "never silently restructure human-curated structure" floor: human-curated grouping / ordering / blockers stay propose-and-confirm at every level, detected by the existing provenance rule (faff-authored structure carries faff's own markers; everything else is the human's). The dial *adds the topology axis to* the existing hard floor; it never relaxes it.

## Consequences

- **One definitional home.** The dial table, guardrails, and invariants live in exactly one gateway subsection; the agile and thematic lenses reference it by within-prose anchor. A grep for the table headers returns a single home, so the four consuming siblings (FAFF-292/293/294/295) inherit one authority story instead of four.
- **The four siblings now have a precondition, not a free hand.** Each of reparent-authority, default-landing, scope-rehome, and no-thematic-projects must implement against this dial — idempotent, reversible, beneath the DoD, and only over faff-authored topology. None may cancel/delete or touch human-curated structure autonomously.
- **`full` is the meaningful new capability and the meaningful new risk.** Admitting end-to-end project formation under the DoD/PRD leash is what makes lights-out outcome-convergence possible; it is also where a mis-set DoD does the most structural rearranging before a human audits it. The reversibility floor (everything is `git`-of-the-tracker reversible — reparent/convert/rehome undo cleanly) is what keeps that risk bounded, and is why cancel/delete stays forbidden even here.
- **No new mechanism.** This is a prose + ADR change: no new `faff` subcommand, contract block, or eval seam. The provenance detection that distinguishes faff-authored from human-curated structure reuses the existing marker convention; no provenance store is added.
- **The lint surface stays self-contained.** The gateway and lens prose state the model forward with no external ticket/ADR references (enforced by `faff lint-refs`); this ADR carries the provenance the prose omits.
