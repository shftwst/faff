---
name: faffter-noon-adr
description: "Default `adr` producer — authors the Nygard body (Context/Decision/Consequences) of an architecture decision record at graft time, from a settled decision plus the spec rationale and the existing docs/adr log. The single ADR-authoring producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
---

# faffter-noon-adr

The default producer for the **`adr` slot**. Given a *settled* (already-`Chosen`) decision, it authors the **Nygard ADR body** — `## Context` / `## Decision` / `## Consequences` — that faff-graft drops into the `faff adr new` scaffold and commits on the feature branch (FAFF-16's mechanics own the scaffold, numbering, and validate; this producer owns only the prose).

It is the judgement layer over FAFF-16's deterministic ADR machinery, and the **single ADR-authoring producer**: FAFF-27 (generative architecture proposal) *decides* architecture and feeds settled decisions into this same slot rather than carrying its own writer.

This is a producer doing-skill, invoked as a configured slot — not a user `/` command. Swap it (`slots.adr`) to change how ADR bodies are authored.

## When it runs

faff-graft **Step 4b**, once a promoted decision is settled and the build is complete. Authoring at *graft* (not the spec stage) is deliberate: the implementation is done, so the *Consequences* are real rather than guessed, and the record is true to what shipped.

## Input

faff-graft provides:

- **decision** — the `Chosen:` line being recorded (its title + the spec's rationale for it).
- **spec_rationale** — the issue's committed spec / tracker spec comment.
- **issue** — the `ISSUE-XX` id + title (provenance).
- **related_adrs** — `faff adr list --json` (number / title / status / date) for cross-references to related or superseded ADRs.

## Output — the ADR body (the `adr`-slot contract)

The three Nygard sections, ready to drop into the scaffold:

- **`## Context`** — what forces the decision (the situation, constraints, the problem it answers). State it forward.
- **`## Decision`** — the decision itself, stated as a settled choice, with its rationale. Cross-reference related/superseded ADRs by what they decide, not bare numbers.
- **`## Consequences`** — what this constrains downstream: the trade-offs accepted, what later slices must respect, follow-ups it implies.

Plus:

- A brief **self-review** that checks the *Consequences* against what actually shipped (the producer's edge over a spec-time author).
- An **advisory `confidence:` self-rating** (`high` / `medium` / `low`).

The confidence is **advisory only** — there is **no gated contract block** and no pass/fail consumer. graft always records a promoted decision; the confidence modulates *how* (surface for a human glance at low/medium appetite, or one bounded auto-refinement pass at high/full appetite — graft owns that routing), never *whether*. A producer placed in this slot emits the body + confidence; it does not gate.

## Rules

- Author only **settled** decisions — a `Punt:` is not yet a decision and is never promoted.
- Write to the skill-authoring charter (`docs/skill-authoring.md`): terse, factual, skimmable; the *Consequences* earn their place, no filler.
- Stay in the producer lane: author the body + self-rate. Numbering, scaffold, validate, and the commit belong to the `faff adr` CLI and graft; routing on confidence belongs to graft.
