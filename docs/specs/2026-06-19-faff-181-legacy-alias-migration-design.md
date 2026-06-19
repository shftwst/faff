# FAFF-181 — Migrate sub-skills to canonical gateway pointers; cut Legacy contract aliases

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high. Full spec on Linear FAFF-181.

A prose-substrate refactor across the gateway + 5 sub-skills, verified by deterministic floor + a scoped frontier smoke.

## 1. WHY

The gateway carries a `### Legacy contract aliases` reconciliation table so sub-skills using old contract-pointer names still resolve. The FAFF-179 audit showed it's a *rename buffer*, not load-bearing — if every sub-skill points at the canonical heading directly, the section (and its dead zero-consumer rows) can be deleted.

**Content-preserving.** No rule/contract/behaviour changes — only pointer strings in sub-skills, plus removal of one redundant gateway section.

**No dangling pointers — the whole risk.** There is no mechanical lint that a `gateway → X` pointer resolves to a real heading (the alias table *was* the manual substitute). Every migrated pointer must match a live heading exactly (grep-verified), and the two affected behaviours (routing, gloss) must pass a frontier smoke.

## 2. OUT OF SCOPE

- The retired-slot row (`spec_adaptor`/`review_adaptor`/`ship_adaptor`) — 0 live pointers; deleted with the section.
- `Mechanism slots` (plural) wording in concurrency skills — points at the live `## Mechanism slot (concurrency)` section, not an alias. Leave it.
- Any rule/contract semantics.

## 3. WHAT — migration map

| Legacy pointer | Occurrences | → Canonical |
|---|---|---|
| `gateway → Automation-routing contract` | 6: faff-tidy, faff-wtf, faff-beep-boop ×3, faff-graft | `gateway → **Automation-routing verdict (fixed)**` |
| `gateway → Root-cause class enum` | 1: faff-tidy | `gateway → **Automation-routing verdict (fixed)**` (its root-cause class enum) |
| `gateway → Synthesis contract` | 6: faffidavit-rendering ×2, faff-prep, faff-wtf, faff-map, faffidavit-routing | `gateway → **Rendering → \`rendering_adaptor\`**` (synthesis gloss) |

**Special case** — faffidavit-rendering's two lines *document the legacy resolution* rather than use the pointer; simplify them (drop the "legacy" framing).

**Chosen:** delete the section (vs keep as rename buffer) — its only value is reconciliation, moot once consumers are migrated; grep + smoke cover the lost lint.

## 4. HOW

```
1. Snapshot live canonical headings (grep '^### ' gateway).
2. Replace each legacy pointer string with the canonical heading; prose intact.
3. Simplify faffidavit-rendering's two legacy-resolution sentences.
4. Delete the gateway '### Legacy contract aliases' section.
5. VERIFY: zero legacy strings remain; each new pointer matches a live heading;
   floor green; routing+gloss frontier smoke passes.
```

**Anti-pattern:** repointing to an almost-right heading (e.g. without the `(fixed)` suffix) — a silent dangling pointer. Match byte-for-byte.

## 5. Scenarios

```
Given sub-skills reference contracts by legacy names
When the migration runs
Then those legacy strings no longer appear in any sub-skill
And every replacement names a heading that exists verbatim in the gateway
```

```
Given the gateway carries a reconciliation-only Legacy contract aliases section
When all live consumers are migrated
Then the section is deleted
And the floor + a routing/gloss frontier smoke both pass
```

## 6. Design Decision Rationale

- **Delete vs keep the alias table?** **Chosen: delete** — indirection's value vanishes once consumers are migrated; grep + smoke cover the lost lint.
- **Verify with no section-pointer lint?** **Chosen:** grep each new pointer against live `^### ` headings + frontier smoke on routing/gloss.

## 7. Open Questions and Assumptions

**Open Questions.** None.

**Assumes:** the canonical headings `### Automation-routing verdict (fixed) → \`routing_adaptor\`` and `### Rendering — no internal contract → \`rendering_adaptor\`` are the live targets. *Validation:* grep `^### ` the gateway before editing.

## 8. DONE

- [ ] All 13 legacy pointers replaced with canonical headings.
- [ ] faffidavit-rendering's two legacy-resolution sentences simplified.
- [ ] `### Legacy contract aliases` section removed from the gateway.
- [ ] grep finds zero remaining `Automation-routing contract` / `Root-cause class enum` / `Synthesis contract` legacy strings in any skill.
- [ ] Every new pointer matches a verbatim gateway heading.
- [ ] `validate-adapters` clean; `node --test` green; 3 loaders resolve; size-gate reduction; baseline re-stamped.
- [ ] Scoped frontier smoke on `routing` + `gloss` passes.
