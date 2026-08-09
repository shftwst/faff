# Spec — Reconcile the control-label manifest with lens/tidy tagging prose

> Spec: faffter-dark-nlspec · 2026-07-12 · autonomous · confidence: high. Source: Linear FAFF-336 comment.

Addresses audit findings **D2 + D3** from `verification/audits/2026-07-04-faff-323-whole-system-coherence.md`.

## 1. WHY

`faff label add|remove` validates its `<label>` against the `CONTROL_LABELS` manifest in
`plugin/skills/faff/bin/lib/labels.js` and rejects anything not in it (exit 1). Prose that
instructs tagging a non-manifest label describes a write path that cannot execute. Two sites do:
the agile lens tags `faff-methodology-fill`; tidy + thematic tag `repeat-parked` (which also
violates the `faff-` prefix convention).

## 2. OUT OF SCOPE

- Repeat-park *detection* (the `faff park-history` seam) — untouched.
- The `orphaned + repeat-parked` *finding/diagnostic-category name* — untouched.
- The routing-verdict TOKEN `repeat-parked` (`contract-defs.js`, `automation-routing.schema.json`,
  `eval-routing.test.mjs`) — a DIFFERENT thing from the label; must NOT be renamed.
- Eligibility-throttle labels — tracker-owned, out of scope.

## 3. WHAT — the two decisions

**Decision A — `faff-methodology-fill`:** re-point prose → existing `faff-chain-gap-fill`
(exact-semantic reuse; a dependency ticket auto-filed for the next prep pass).

**Decision B — `repeat-parked`:** add `faff-repeat-parked` to the manifest (distinct, unmatched
signal; fixes the prefix violation) as a CLI-writable cosmetic breadcrumb (no `tracker_owned` flag).
Re-point the four prose sites `repeat-parked` → `faff-repeat-parked`.

## 4. HOW

- Manifest (`labels.js`): append a `faff-repeat-parked` entry (name/color/description, no tracker_owned).
- Gateway `SKILL.md` control-label enumeration (~line 775): add `faff-repeat-parked`.
- agile `SKILL.md:245`: `faff-methodology-fill` → `faff-chain-gap-fill`.
- tidy `SKILL.md:138,267` + thematic `SKILL.md:47,97`: `repeat-parked` → `faff-repeat-parked` via the sanctioned op.
- `test/faff-tidy-repeat-park.test.mjs`: rename the LABEL occurrences (fixture label, addLabel args)
  to `faff-repeat-parked`; leave the bucket/finding name and the verdict token unchanged.

## 5. Born-verifiable scenarios

- `faff labels --names` lists `faff-repeat-parked`, not `faff-methodology-fill`.
- `faff label add <issue> faff-repeat-parked` exits 0, emits a `faff-contract:label-op` block.
- `faff label add <issue> faff-chain-gap-fill` exits 0.
- Every prose-instructed tag label is a manifest member.

## 8. DONE

- No skill-prose tag instruction references a non-manifest label.
- Manifest includes `faff-repeat-parked`, excludes `faff-methodology-fill`.
- Gateway enumeration lists `faff-repeat-parked`.
- 5 prose sites reconciled.
- `test/faff-tidy-repeat-park.test.mjs` uses `faff-repeat-parked` for the label and passes.
- `node plugin/skills/faff/bin/faff label --selftest` passes.
- Routing verdict token `repeat-parked` unchanged.
- `faff validate-adapters` and `node --test` green.

confidence: high
