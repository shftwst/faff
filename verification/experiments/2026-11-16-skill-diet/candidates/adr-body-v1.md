---
name: faffter-noon-adr
description: "Default adr producer: author a settled architecture decision from spec rationale and the ADR log, using the committed adr.md template or Nygard format."
user-invocable: false
judgement_seam: adr-gloss
---

# faffter-noon-adr

Default `adr` slot producer. Faff-graft Step 4b invokes it after build to author a settled (`Chosen:`) decision from the implementation that shipped. The architecture proposer feeds its settled decisions into this same writer. This is a configured producer, not a user command; swap `slots.adr` to change the writer.

Author prose only. Graft and the `faff adr` CLI own numbering, scaffold, validation and the feature-branch commit; graft owns confidence routing.

## Input

faff-graft provides:

- **decision** — the `Chosen:` line being recorded (its title + the spec's rationale for it).
- **spec_rationale** — the issue's committed spec / tracker spec comment.
- **issue** — the `ISSUE-XX` id + title (provenance).
- **related_adrs** — `faff adr list --json` (number / title / status / date) for cross-references to related or superseded ADRs.
- **resolved_format** — run `faff adr format --json` first and author against its `sections` list, in order, and under no others; resolve the format via that CLI call only, never by reading the template file directly. A repo with no committed template resolves to Nygard's three sections; a repo that commits an `adr.md` template resolves to that file's own headings instead.

## Output: the ADR body

Use only the sections returned by `faff adr format --json`, in their resolved order:

- In `resolved_format.decision_section` (`Decision` under Nygard), state the settled choice and rationale. Cross-reference related/superseded ADRs by what they decide, including the subject with the number.
- Author every other section to its heading. Nygard's preceding `Context` explains the situation, constraints and problem; following `Consequences` records accepted trade-offs, downstream constraints and follow-ups. Custom headings receive the content they ask for, in the same forward, factual register.
- Include a brief self-review checking the consequences against what actually shipped, plus an advisory `confidence:` rating (high, medium or low).

There is no gated contract block or pass/fail consumer. Graft always records a promoted decision. Confidence affects how: a human glance at low/medium appetite, or one bounded auto-refinement at high/full. The producer never gates recording.

## Rules

- Author only settled decisions. A `Punt:` is not a decision and is never promoted.
- Follow `docs/reference/skill-authoring.md`: terse, factual, skimmable prose, with no filler in the consequences.
