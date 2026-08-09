# Spec — FAFF-291: Agile lens owns outcome-led project formation + scope (shared model + ADR keystone)

> Spec: faffter-dark-nlspec · 2026-06-29 · interactive · confidence: high. Full spec on Linear FAFF-291.

## WHY — Problem and Principles

The agile methodology lens (`faffter-dark-methodology-agile-delivery`) today diagnoses and reorders a *presentation view*; it does not own the **shape** of the backlog. The four cluster siblings (FAFF-292/293/294/295) each grant the methodology some authority to write tracker **topology** — reparent a gating chain into the stream it gates, default new work to plain backlog, rehome scope without deleting it, convert a thematic project to outcome-led. Today each would invent its own per-appetite authority story, and the human's explicit request — an ADR recording where human control sits as appetite rises — has no home.

This keystone authors the two artifacts the four siblings inherit, **once**:

1. A **shared model** in the gateway: the single table + invariants that say *how much* topology-write authority the methodology gets at each appetite level, and the floors that bound it at every level.
2. An **ADR** recording the decision: appetite moves *where* human control sits, and the tracker control-plane evolves from marker-writes to admitting methodology topology-writes, bounded by a reversibility floor and a DoD ceiling.

**Post-296 vocabulary (settled, load-bearing here).** FAFF-296 split the overloaded word "structural" three ways: **structural** = the tracker **topology** (the dependency graph / blocker edges / where work sits — the methodology-agnostic ground truth, canonically homed gateway-side); **thematic** = the renamed opinion-free default lens (`faffter-noon-methodology-thematic`); **agile** = the outcome-led lens. The methodology writing reparent / convert / edge-changes *is* writing topology, so the dial this spec defines is the **topology-write-authority dial** (synonymous with "structural-write authority" in the issue's pre-296 wording — they name the same thing; this spec uses the post-296 "topology" term consistently on the lint surface).

**Architectural anchor (the home).** The gateway already keeps exactly one appetite table beyond the level vocabulary: *"the appetite-modulation of two shared contracts — resolve-attempt and automation-routing"* (gateway → **Appetite for destruction** → **Build pipeline (modulation of …)**). It explicitly states each skill documents its *own* per-level flavour, and the gateway keeps only the **shared-contract** modulation tables. The topology-write-authority dial is precisely a **third shared-contract modulation** of the same kind — so it belongs in the gateway as a sibling table, not duplicated per lens. This is what makes "defined once, here" architecturally clean rather than an exception to the gateway's own rule.

## OUT OF SCOPE

- **Building FAFF-292/293/294/295.** This keystone authors only the shared model + ADR; the four siblings *consume* it and ship their own behaviour. No reparent/default-landing/rehome/convert logic is implemented here.
- **New CLI / code logic.** Pure prose + ADR. No new `faff` subcommand, no contract block, no eval seam.
- **Re-litigating FAFF-296's rename / graph-floor relocation.** That shipped; this spec only *uses* its vocabulary.
- **Changing the existing hard floor or the human-curated-structure floor.** This spec *composes with* them (states how the new dial sits beneath them); it does not weaken or restate them.

## WHAT — the two artifacts

### Artifact 1 — the shared model (gateway, defined once)

A new gateway subsection, homed as a **sibling of the existing "Build pipeline (modulation of the resolve-attempt + automation-routing contracts)" table**, inside **Appetite for destruction**. It defines:

**(a) The topology-write-authority dial** — what authority over tracker topology the methodology holds at each appetite level (four-level table: low surface-only / medium low-judgement ops / high act-on-clear-cases+propose-cuts / full owns-it).

**(b) Two guardrails** (apply to every topology write): convergence/anti-thrash (idempotent); the legibility-preserver matched pair (default-landing constrains inflow because higher levels grant more topology power).

**(c) Two invariants** (hold at every appetite level, including `full`): reversibility floor (reparent/convert/rehome reversible ⇒ allowed; cancel/delete ⇒ forbidden always); DoD ceiling (topology moves stay beneath the human-owned DoD/PRD).

**(d) Composition with the existing floors (load-bearing).** The dial governs the methodology's authority over **faff-authored / methodology-derived** topology. It does **not** punch through the existing **"never silently restructure human-curated structure"** floor — human-curated grouping / ordering / blockers remain propose-and-confirm at every level, detected by the existing provenance rule. The new dial therefore *adds an axis to* the existing hard floor; it never relaxes it. The reversibility floor is a *naming, for the topology axis,* of the existing cancel/delete rule — not a second divergent floor.

### Artifact 2 — the ADR (authored at graft by the `adr` slot)

A Nygard ADR in `records/adr/`. The spec fixes the **decision + thesis** (the slot writes the Context/Decision/Consequences prose):

- **Thesis 1 — appetite moves *where* human control sits.** At low/high the human controls via **structure** (approve each move / curate the graph); at full the human controls via the **DoD/PRD leash** (set the ends, audit the means).
- **Thesis 2 — the control-plane evolves.** The tracker-as-lights-out-control-plane evolves from admitting only *marker* writes to admitting methodology **topology** writes (reparent / convert / cut-by-rehome), bounded by the reversibility floor + DoD ceiling.

### Where the lenses reference it

- **Gateway** — the shared model is the single definition.
- **Agile lens** — its Appetite-integration section references the gateway dial for topology-write authority (keeping only its own seven-principle flavour).
- **Thematic lens** — referenced where relevant (composes the topology floor, surface-only on opinion). No duplication.

## HOW — Behaviour (authoring rules)

1. **Single definition.** The dial table + guardrails + invariants live in exactly one place — the new gateway subsection. Every other mention is a **reference** (within-prose anchor), never a copy. A grep for the table headers returns exactly one home.
2. **Compose, never contradict.** The new subsection explicitly states it *adds the topology axis to* the existing hard floor and sits *beneath* the human-curated-structure floor.
3. **Self-contained-prose guard.** `SKILL.md` files and `docs/guide/` executed prose carry **no** external tracker/ADR refs — `faff lint-refs` gates CI. Within-prose anchors are allowed. The ADR itself and other `records/adr/*` files legitimately cite provenance.
4. **Skill-authoring standard.** The gateway subsection and the rewritten agile-lens section stay lean / deduplicated / skimmable; `faff validate-adapters` stays green (the gateway is at its 1000-line cap, so the addition is offset by leaning genuine duplication in the same Appetite region).
5. **ADR number allocated at graft** via `faff adr new` (currently `0035`).

## SCENARIOS — born-verifiable main objectives

- **The shared model is defined exactly once** — grep the gateway for the dial table → exactly one subsection; the agile + thematic lenses reference it but do not copy.
- **The ADR records the decision** — list `records/adr/` → a new Nygard ADR whose Decision states both theses.
- **The lint surface stays ref-clean** — `faff lint-refs` exits 0.
- **No behavioural / contract regression** — `faff validate-adapters` + node `--test` pass.

## DONE — Definition of Done

1. An ADR is merged in `records/adr/` whose Decision states **both** theses.
2. The gateway contains a single **topology-write-authority** subsection carrying the four-level table, the two guardrails, and the two invariants.
3. That subsection explicitly states it **composes with** the existing hard floor and sits **beneath** the human-curated-structure floor.
4. The **agile lens** references the gateway dial instead of re-deriving it; the **thematic lens** references it where relevant. A grep for the dial table returns **exactly one** home.
5. `faff lint-refs` exits 0.
6. `faff validate-adapters` green; node `--test` / CLI selftests pass.
7. The ADR may cite provenance; the gateway/lens prose on the lint surface does not.

confidence: high
