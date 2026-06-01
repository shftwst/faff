# faffidavit-spec

The default **adaptor** for the `spec_adaptor` slot. It translates a spec producer's native output into faff-core's fixed spec-readiness contract — the concrete markers that encode the closed/open/external classification, the writing-style rules, the confidence line's format — and **validates** conformance on demand. A `faffidavit-*` skill: it both *defines* its dialect and *checks* conformance, so it earns its keep as an invokable skill rather than a passive document.

Every spec producer (`faffter-noon-spec`, `faffter-dark-nlspec`, any delegated `spec` skill) conforms to it; faff-prep delegates its pre-attach validation to it.

```yaml
planning_skills:
  spec_adaptor: faffidavit-spec   # the default — explicit for clarity
```

## Internal contract (fixed — see gateway)

The spec-readiness contract itself is a faff-core invariant and lives in the gateway (_Core contracts and adaptor slots → Spec readiness_), **not** here. Fixed there, and unaffected by swapping this slot:

- every non-trivial decision is classified **closed** / **open** / **external-dependency**,
- a **confidence rating** (`high` / `medium` / `low`) is present and **retained on the attached spec** (durable provenance + re-spec signal, not stripped), and
- faff-prep gates its autonomous decision on confidence (`high` → promote; `medium` → attach with the rating retained, routes out as `needs-decision-first`; `low` → park) while beep-boop routes on the open/external classification (→ `needs-decision-first` / `gap-blocked`).

An autonomous reader needs to parse specs mechanically against that fixed classification — without it, the reader falls back to topic-keyword scanning and re-raises closed decisions as human blockers. This skill does not get to change the classification or the gate. What it owns is the *dialect* — the concrete markers that encode closed/open/external, the writing style that keeps a spec parseable, and the confidence line's format. That is what makes the slot swappable: a third-party spec format plugs in behind a different adaptor that maps its structure onto the same three classes + confidence, and faff-prep still gates the same way.

**How this contract reaches you.** The fixed definition is loaded by the invoking consumer (`/faff-prep` reads the gateway on entry), so when you run as the `spec_adaptor` slot it is already in context. If you are invoked **standalone** ("validate the spec for SHF-123"), **Read `skills/faff/SKILL.md` → _Core contracts and adaptor slots → Spec readiness_ now** before validating. The bullets above are a non-normative recap; the gateway wins on any conflict.

## Two faces

- **Define** (reference): the canonical markers, marker rules, and writing style below. Producers read this and conform; consumers read it to parse specs mechanically.
- **Validate** (invokable): given a spec, return `pass` / `fail` plus a list of specific violations. Invoked by faff-prep before attach, and usable standalone — "validate the spec for SHF-123" or point it at a markdown file and get a report.

## Canonical markers (this adaptor's dialect)

These markers are how *this* adaptor encodes the fixed closed/open/external classification. A different `spec_adaptor` may use a different surface syntax, as long as it maps onto the same three classes.

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

## Confidence self-rating

Every spec ends with a single confidence line — the producer's self-assessment of whether the spec is buildable without a human, which faff-prep's autonomous gate branches on. The three levels and the gate are fixed in the gateway (spec-readiness internal contract); this adaptor owns the *line's format* — its placement and exact token — so faff-prep can read it regardless of which producer ran:

```
confidence: high | medium | low
```

| Level | Meaning | faff-prep gate |
|---|---|---|
| `high` | Explore surfaced clear answers; every non-trivial decision has a `**Chosen:**` marker with rationale; no `**Punt:**` escalates a genuine product/architecture question; ACs are concrete and testable. | Attach + promote to Todo (build-eligible). |
| `medium` | Mostly clean but 1–2 `**Punt:**` markers on substantive choices, or a decision whose rationale is thin enough a human would want to weigh in. | Attach with the rating **retained**, move to Todo — never auto-admitted to the build queue. Routes out as `needs-decision-first`; whether an autonomous run then proceeds is appetite-modulated (see gateway → **Spec readiness** + **Appetite for destruction**). |
| `low` | Multiple `**Punt:**` markers, or explore couldn't pin down the ticket's intent, or core architecture is genuinely unclear. | Park — explore could not resolve core questions. |

The line is mandatory and orthogonal to marker validation: a spec can have every marker present (passes validation) yet rate `medium`/`low`. Both the marker check and the confidence gate must pass for an autonomous attach.

## Validation

Run before a spec is attached (faff-prep delegates this), or on demand against any spec.

**Checks:**

1. At least one canonical marker in any section that presents multiple options.
2. No dangling comparisons (tables or "vs" prose without a marker below).
3. `Punt:` and `Assumes:` entries grouped in their dedicated sections.
4. No invented labelling schemes (scan for patterns like single-letter+digit codes used as references).
5. A `confidence:` line is present and is exactly one of `high` / `medium` / `low`.

**Output:**

```
signal: pass | fail

## Violations
### [rule]: [where]
[what's wrong] → [the fix]
```

`pass` when no violation fires. `fail` lists each violation with its location and the corrective action.

**How callers act on the signal:**
- **Autonomous mode:** validation failure → park.
- **Interactive mode:** validation failure → fix the missing marker before attach.

## Rules

- The closed/open/external classification and the confidence gate are fixed in the gateway, not here — non-negotiable for autonomous operation. A spec whose decisions can't be classified cannot be autonomously built; the reader can't tell what's closed vs open.
- This adaptor's dialect is deliberately minimal. It doesn't prescribe section names, document length, or level of detail. Only: mark your decisions (in this dialect's markers), write readably, emit the confidence line, validate before attach.
- Alternative spec producers conform via their own `spec_adaptor`. They may add structure on top but their output must map onto the same three classes + confidence; this default adaptor's markers are how the *default* producers do it.
- Validation reports findings; it does not mutate the spec or decide what happens next. Sequencing (park, fix, attach) belongs to the caller.
