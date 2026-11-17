---
name: faffter-noon-adr
description: "Default adr producer: author a settled architecture decision from spec rationale and the ADR log, using the committed adr.md template or Nygard format."
user-invocable: false
judgement_seam: adr-gloss
---

# faffter-noon-adr

The default **`adr` slot** producer authors a settled (already-`Chosen`) decision for faff-graft to place in the `faff adr new` scaffold and commit on the feature branch. `faff adr new` owns scaffold, numbering and validate; this producer owns prose against the repo's **resolved section list**: Nygard (Context / Decision / Consequences) by default, or the committed `adr.md` template's headings.

The **single ADR-authoring producer** over the deterministic `faff adr new` machinery: the architecture proposer settles decisions and feeds them to this slot rather than writing ADRs itself.

Invoked as a configured producer slot, not a user `/` command. Swap `slots.adr` to change body authoring.

## When it runs

faff-graft **Step 4b**, once a promoted decision is settled and the build complete. Author at graft, not spec time, so *Consequences* describe the implementation that shipped.

## Input

faff-graft provides:

- **decision** — the `Chosen:` line being recorded (its title + the spec's rationale for it).
- **spec_rationale** — the issue's committed spec / tracker spec comment.
- **issue** — the `ISSUE-XX` id + title (provenance).
- **related_adrs** — `faff adr list --json` (number / title / status / date) for cross-references to related or superseded ADRs.
- **resolved_format** — run `faff adr format --json` first and author against its `sections` list, in order, and under no others; resolve the format via that CLI call only, never by reading the template file directly. A repo with no committed template resolves to Nygard's three sections; a repo that commits an `adr.md` template resolves to that file's own headings instead.

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
