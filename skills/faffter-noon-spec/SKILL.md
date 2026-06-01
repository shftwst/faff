# faffter-noon-spec

The default spec format contract. Defines the canonical markers, writing style rules, and validation criteria that every spec must satisfy — regardless of which skill produced it.

This is the shared contract between spec producers (faff-prep, faffter-dark-nlspec, any delegated `spec` skill) and spec consumers (faff-workit, faff-beep-boop). Extracted here so the contract is defined once and referenced everywhere.

```yaml
planning_skills:
  spec_format: faffter-noon-spec   # the default — explicit for clarity
```

## Purpose

The autonomous reader in faff-workit and faff-beep-boop needs to parse specs mechanically — identify which decisions are closed, which are open, which have external dependencies. Without this contract, the reader falls back to topic-keyword scanning and re-raises closed decisions as human blockers.

## Canonical markers

Every spec must mark each non-trivial decision with exactly one of these:

| Marker | Meaning | Reader action |
|---|---|---|
| `**Chosen:** X` or `**Decision:** X` | Closed. The spec has picked X. | Implementer does X. Reader must not re-raise. |
| `**Punt:** X or Y — needs human` | Open. Explicitly deferred to a human. | Reader escalates. Build cannot proceed past this without resolution. |
| `**Assumes:** X exists` | External dependency. | Reader validates presence before build; parks if absent. |

## Marker rules

1. **One marker per decision section.** Every tradeoff table, "X vs Y" comparison, or architecture pick must conclude with exactly one marker. Prose rationale above the marker is encouraged; the marker is what the reader parses.

2. **No marker = invalid spec.** A spec with a tradeoff table but no concluding marker is invalid. In autonomous mode, faff-prep parks rather than attaches. In interactive mode, faff-prep adds the missing marker before attaching.

3. **Open items collected.** `Punt:` and `Assumes:` markers must appear in a top-level "Open Questions" or "Assumptions" section so the reader can enumerate them quickly.

4. **Applies to all design choices.** Libraries, patterns, data shapes, naming, scope boundaries. If the spec weighs options and picks one, mark it.

5. **No topic-keyword contract.** The reader matches on markers, not section names. A section called "Logging" with `**Chosen:** pino` at the end is closed. A section called "Anything" with `**Punt:** A or B — needs human` is open.

## Writing style: skimmable, not coded

The marker contract governs structure. This section governs prose. A reader skimming the spec — without holding the source ADR, parent ticket, or blocker list in their head — must be able to follow what each section is about on first pass.

### Concrete prohibitions

**No invented labelling schemes.** Don't introduce ad-hoc codes like `X1`, `F2`, `R3`, `W2a`, `Phase 4` and then cross-reference them throughout the spec. They force the reader to hold the full list in memory to decode any single line. Restate the subject instead ("the audit-error-registry relocation", "the cleanup PR for the entitlements route").

**Ticket numbers are fine.** `#123`, `SHF-247`, `ENG-42` are real, stable identifiers. The rule bans codes the spec invents, not codes that exist in the tracker. Prefer `SHF-247 (audit-error registry relocation)` over `SHF-247` alone or `F5` alone.

**Restate subjects on every cross-reference.** "F5 shim", "PR 4's deletions", "Phase 6", "test classes #1–#9" are opaque. Spell out what each is.

**Inherited codes from source ADRs are the most common offender.** If ADR-0016 uses `F1...F8` to label phases, the spec must translate each into a descriptive subject. The ADR is one document; the spec is another.

**Descriptive lead columns in tables.** A row reading `PR 4 / W2 / in-app syncBilling impl / shim from W1` is unreadable. Lead with a descriptive column or break into named subsections.

**Standalone prose over compressed bullet walls.** Three sentences that each make sense in isolation beat a five-bullet wall whose meaning depends on having read the preceding section.

## Validation criteria

Before attaching a spec (faff-prep runs this):

1. At least one canonical marker in any section that presents multiple options.
2. No dangling comparisons (tables or "vs" prose without a marker below).
3. `Punt:` and `Assumes:` entries grouped in their dedicated sections.
4. No invented labelling schemes (scan for patterns like single-letter+digit codes used as references).

**Autonomous mode:** validation failure → park.
**Interactive mode:** validation failure → fix the missing marker before attach.

## Default spec structure (lite nlspec arc)

When no `spec` skill is configured, faff-prep produces an inline spec following this structure:

1. **WHY** — Problem statement (status quo → pain → solution), design principles, out-of-scope with extension points
2. **WHAT** — Types, APIs, interfaces. Each decision marked with canonical markers.
3. **HOW** — Architecture, pseudocode at ambiguity points, risks and edge cases
4. **DONE** — Closed-loop testable checklist mirroring body sections 1:1

This structure is the minimum. Delegated spec skills (like faffter-dark-nlspec) may produce richer output — as long as it satisfies the marker contract and writing style rules above.

## Consumers

| Skill | How it uses this contract |
|---|---|
| **faff-prep** | Validates before attach. Passes contract to delegated spec skills. |
| **faff-workit** | Reads markers to identify closed decisions (don't re-raise), open decisions (escalate), and assumptions (validate before build). |
| **faff-beep-boop** | Uses markers in automation-routing verdict computation. `Punt:` → `needs-decision-first`. `Assumes:` with false assumption → `gap-blocked`. |
| **faffter-noon-review** | Checks spec fidelity — does the code implement what `**Chosen:**` says? |
| **faffter-dark-holdout** | Derives holdout scenarios from the DONE section. |

## Rules

- This contract is non-negotiable for autonomous operation. A spec without markers cannot be autonomously built — the reader can't tell what's closed vs open.
- The contract is deliberately minimal. It doesn't prescribe section names, document length, or level of detail. Only: mark your decisions, write readably, validate before attach.
- Alternative spec format skills (faffter-dark-nlspec, custom skills) must satisfy this contract. They may add structure on top but cannot omit the markers.
- The writing style rules apply equally to inline and delegated output. faff-prep passes this contract to delegated skills in their instructions.
