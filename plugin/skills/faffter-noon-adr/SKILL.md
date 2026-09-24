---
name: faffter-noon-adr
description: "Default `adr` producer — authors the body of an architecture decision record at graft time (Nygard's Context/Decision/Consequences by default, or a repo's own committed `.faff-templates/adr.md` shape when one exists), from a settled decision plus the spec rationale and the configured ADR log. The single ADR-authoring producer. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: adr-gloss
---

# faffter-noon-adr

The default producer for the **`adr` slot**. Given a *settled* (already-`Chosen`) decision, it authors the ADR body that faff-graft drops into the `faff adr new` scaffold and commits on the feature branch (the `faff adr new` mechanics own the scaffold, numbering, and validate; this producer owns only the prose) — against the repo's **resolved section list**: Nygard (Context / Decision / Consequences) by default, or a committed `.faff-templates/adr.md`'s own headings when the repo carries one.

It is the judgement layer over the `faff adr new` deterministic ADR machinery, and the **single ADR-authoring producer**: the generative architecture proposer *decides* architecture and feeds settled decisions into this same slot rather than carrying its own writer.

This is a producer doing-skill, invoked as a configured slot — not a user `/` command. Swap it (`slots.adr`) to change how ADR bodies are authored.

## When it runs

faff-graft **Step 4b**, once a promoted decision is settled and the build is complete. Authoring at *graft* (not the spec stage) is deliberate: the implementation is done, so the *Consequences* are real rather than guessed, and the record is true to what shipped.

## Input

faff-graft provides:

- **decision** — the `Chosen:` line being recorded (its title + the spec's rationale for it).
- **spec_rationale** — the issue's committed spec / tracker spec comment.
- **issue** — the `ISSUE-XX` id + title (provenance).
- **related_adrs** — `faff adr list --json` (number / title / status / date) for cross-references to related or superseded ADRs.
- **resolved_format** — run `faff adr format --json` first and author against its `sections` list, in order, and under no others; resolve the format via that CLI call only, never by reading `.faff-templates/adr.md` directly. A repo with no committed template resolves to Nygard's three sections; a repo that commits `.faff-templates/adr.md` resolves to that file's own headings instead.

## Output — the ADR body (the `adr`-slot contract)

Prose under each section `faff adr format --json`'s `resolved_format.sections` names, in that order, and under no others:

- **The decision section** (`resolved_format.decision_section` — `Decision` under Nygard) — the decision itself, stated as a settled choice, with its rationale. Cross-reference related/superseded ADRs by what they decide, not bare numbers.
- **Every other resolved section** — authored to what its heading asks for. Under the Nygard default that means: what forces the decision (the situation, constraints, the problem it answers), stated forward, for the section preceding the decision; and what this constrains downstream — the trade-offs accepted, what later slices must respect, follow-ups it implies — for the section(s) after it. A repo's own template heading is authored to what that heading names, using the same forward, factual register.

Plus:

- A brief **self-review** that checks the *Consequences* against what actually shipped (the producer's edge over a spec-time author).
- An **advisory `confidence:` self-rating** (`high` / `medium` / `low`).

The confidence is **advisory only** — there is **no gated contract block** and no pass/fail consumer. graft always records a promoted decision; the confidence modulates *how* (surface for a human glance at low/medium appetite, or one bounded auto-refinement pass at high/full appetite — graft owns that routing), never *whether*. A producer placed in this slot emits the body + confidence; it does not gate.

## Rules

- Author only **settled** decisions — a `Punt:` is not yet a decision and is never promoted.
- Write to the skill-authoring charter (`docs/reference/skill-authoring.md`): terse, factual, skimmable; the *Consequences* earn their place, no filler.
- Stay in the producer lane: author the body + self-rate. Numbering, scaffold, validate, and the commit belong to the `faff adr` CLI and graft; routing on confidence belongs to graft.
