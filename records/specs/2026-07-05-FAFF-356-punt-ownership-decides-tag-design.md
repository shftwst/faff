# FAFF-356: Punt ownership — `decides:` tag on Punt markers + per-owner "Needs your call" routing

> Spec: faffter-dark-nlspec · 2026-07-04 · autonomous · confidence: high.

## Preamble

This spec covers FAFF-356: adding an optional `(decides: <owner>)` suffix to the `**Punt:**` marker in the gateway Spec-readiness contract dialect, and updating producer and renderer skills to emit and consume the tag. Audience: the build agent implementing the change, and human reviewers.

---

## 1. WHY — Problem and Principles

**Load-bearing model.** Punt markers today accumulate in one undifferentiated "Needs your call" bucket in `/faff-wtf`. Routing each punt to its natural owner by class — product, architecture, QA, security — turns a status pile into a per-person decision agenda. Decision latency, not build capacity, is the scarce resource once the build engine is elastic.

**Problem statement.** Every open `**Punt:**` lands in one undifferentiated pile; piles age. In a team setting (`design/team-mode.md`), decisions have natural owners by class: product call → PM, schema/architecture call → tech lead, threat call → security. Even solo, the tag documents *what kind* of call each punt is asking for, reducing cognitive context-switching during morning review.

**Design principles.**

- **Additive, non-gating.** An untagged punt is still a valid punt. This change must never break an existing spec or cause a previously-conformant spec to fail validation.
- **Prose-only.** The `decides:` tag lives in spec prose only — it is NOT a new field in the `faff-contract:spec-readiness` block (which carries only `marker: "punt"`). The contract remains at classification level; the tag is display metadata.
- **Single definition home.** The canonical syntax lives in the gateway Spec-readiness contract, as today; producers reference it, never re-define it.

**Scope statement.** A spec-dialect and rendering change only — no new control surface, no new write path, no schema change to `faff-contract:spec-readiness`.

---

## 2. OUT OF SCOPE

- **`faff-contract:spec-readiness` schema change.** The contract block carries `{ "marker": "punt" }` — no `decides:` field added. The tag is prose metadata, not a pipeline gate input.
- **Resolution path change.** Answering a punt remains a plain tracker comment; the tag routes attention only.
- **Separate beep-boop run-summary change.** Beep-boop's "Routed out" section uses the same `needs-decision-first` rendering path as wtf — the wtf update carries through naturally.
- **Enforcement / validation of owner tag values.** The `decides:` tag is advisory. The contract selftest does not validate tag values against the vocabulary.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

### Owner vocabulary (closed-ish)

```
product       # PM / product-owner call (scope, user experience, prioritisation)
architecture  # tech-lead / architect call (schema, structure, cross-cutting design)
qa            # QA / test-lead call (test strategy, edge-case coverage, eval design)
security      # security-lead call (threat model, auth/authz, secret handling)
any           # any stakeholder — no directed owner; equivalent to untagged for routing
<handle>      # free-form: a specific person handle (e.g. @alice, product-lead, tbd-pm)
```

### Marker syntax extension

Current canonical form: `**Punt:** <decision text> — needs human`

Extended canonical form: `**Punt:** <decision text> — needs human (decides: <owner>)`

The `(decides: <owner>)` suffix is optional. Placement: at the end of the Punt line.

**Chosen decisions:** small closed vocabulary + free-form escape; inline suffix `(decides: <owner>)` at end of Punt line; tag is prose-only (contract block unchanged); regex extraction in each renderer.

---

## 4. HOW — Behavior

### Gateway dialect update (`plugin/skills/faff/SKILL.md`)

Extend the `**Punt:**` marker definition to document the optional `(decides: <owner>)` suffix, the closed vocabulary, and back-compatibility.

### Producer updates (`faffter-noon-spec/SKILL.md`, `faffter-dark-nlspec/SKILL.md`)

Add a short guidance note: emit the `(decides: <owner>)` suffix per the gateway when the punt's class is clear; omit when ambiguous; the contract block is unchanged.

### Renderer update: `/faff-wtf`

Group `needs-decision-first` items by `decides:` owner tag: closed-vocab tokens alphabetically, then free-form, then `(unowned)` last. Within a group, preserve methodology `pick-ordering`. `confidence: medium` items → `(unowned)`.

### Renderer update: `/faff-tidy`

Include the `(decides: <owner>)` token in the per-issue open-punt diagnosis line when present. No grouping change.

### Contract selftest — no change

Add a comment noting the `decides:` tag is prose-only and the existing `punt` case covers tagged/untagged punts.

---

## 5. SCENARIOS

1. Tagged punt groups under `(product)` sub-bucket in wtf.
2. Untagged punt appears in `(unowned)` shared pool — identical to today.
3. Producer emits tag when the punt class is clear.
4. Contract validator exits 0 — the tag is invisible to it.

---

## 8. DONE — Definition of Done

- Gateway dialect defines the optional `(decides: <owner>)` suffix + owner vocabulary + back-compat statement.
- Both producers carry the short emit-when-clear guidance; contract block unchanged.
- `/faff-wtf` groups `needs-decision-first` by owner tag; untagged + medium → `(unowned)`; pick-ordering preserved within groups.
- `/faff-tidy` surfaces the `(decides:)` token in per-issue punt lines when present.
- Contract selftest carries a comment noting the tag is prose-only and the punt case covers both.
- Untagged specs behave byte-for-byte as today.

confidence: high
