# Spec — FAFF-19: Human curation is authoritative (backlog as control surface)

> Spec: faffter-dark-nlspec · 2026-06-12 · interactive · confidence: high. Full spec on Linear FAFF-19.

> **Revised 2026-06-12 (prep refresh-in-place):** §4 toggle-granularity Punt resolved by human decision → **Chosen: monolithic slot**. No design change; the open architectural question is closed, so the rating moves medium → high. Supersedes the 2026-06-11 medium spec.

**Refresh note.** Freshness re-validated against the codebase: FAFF-60's "Tracker as the lights-out control plane" gateway section is present (the spec's sole `Assumes:` holds); the methodology slot is already a whole-slot model today (`slots.methodology` swaps structural ↔ agile), so the chosen monolithic resolution needs no new machinery; and no dedicated "Human curation is authoritative" gateway section exists yet, so the residual build work is still wanted.

## 1. WHY

Make "the tracker is the interface a human uses to steer an in-flight autonomous build" a **named, first-class principle** the whole pipeline obeys — human-curated priorities, groupings, sequence, milestones, manual blockers, and status are authoritative guardrails, never silently overridden or restructured.

## 2. Already shipped against this surface (most of the mechanics exist)

- **FAFF-60 — "Tracker as the lights-out control plane"** (gateway, merged) — the externalise + steer-loop half: human edits are the authoritative record and re-read every pass.
- **Appetite hard floor** — no autonomous cancel/delete, appetite-immune; container creation always confirms.
- **`/faff-jot` / `/faff-plot`** — "containers always confirm" at every appetite level.
- **Steer loop** — `faff next` + beep-boop wave re-entry + prep Scenario-B comment reconciliation + tidy live-thread scan re-read human edits each pass (FAFF-110 made live-thread reconciliation a fixed verdict-gate property).
- **Work-ordering** — priority (human label) is the primary gate; methodology reframes only *within* a priority band.

## 3. WHAT (residual scope)

- **Chosen:** add one gateway section — **"Human curation is authoritative"** — stating the principle + three assertions (tracker is the control plane; human edits are re-read per pass; never silently restructure human-curated structure), with thin pointers from the skills that already enforce it (prep, beep-boop, tidy). Following FAFF-60's precedent (a named shared principle, no new mechanism).
- **Chosen:** confirm the existing guardrails *are* the enforcement (no new machinery): container-confirm, the no-cancel/delete floor, priority-is-king ordering, the steer-loop re-read.
- **Chosen (resolves the former §4 Punt — human decision 2026-06-12): keep the monolithic methodology-slot model.** A methodology is on/off *as a whole* via `slots.methodology` (structural default ↔ the agile-delivery bundle of seven principles); faff does **not** decompose into per-principle on/off knobs, and adds no per-principle config surface. Rationale: it matches the shipped model (verified — the slot is already whole-slot today), keeps the config surface minimal (governing tenet: *configurable, not opinionated*, without sprawl), and avoids inventing a defaults matrix nobody has asked to tune. FAFF-18 (level recipes) remains the place where a *bundle* of which-methodology-runs is named, consistent with this whole-slot model.

## 4. DESIGN DECISION RATIONALE

- **Chosen — name-the-principle, reuse existing mechanics.** Most of FAFF-19 shipped as FAFF-60 + the appetite floor + container-confirm; the proportionate scope is naming the obey-half once, not new machinery.
- **Chosen — monolithic methodology slot** (§3): the methodology architecture stays whole-slot; per-principle toggles are explicitly out of scope. Decided by the human via /faff-tidy 2026-06-12; consistent with FAFF-18's recipe-bundle approach.

**Assumes:** FAFF-60 is merged and is the externalise/steer-loop half this builds the "obey" half onto. *Validated: FAFF-60 merged (gateway section present at refresh time).*

## 5. DONE

- [ ] Gateway has a "Human curation is authoritative" section (principle + 3 assertions) with skill pointers; no new CLI/config/mechanism.
- [ ] The methodology toggle stays whole-slot (monolithic): no per-principle on/off knobs or new config keys are introduced (assert against `slots.methodology` remaining the only toggle).
- [ ] No autonomous path silently re-groups / re-prioritises / re-sequences / re-parents human-curated structure (assert against the existing guardrails).

confidence: high

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ {"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"} ] }
```
