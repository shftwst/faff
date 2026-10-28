# Spec — FAFF-1283: Schema validator supports `maxItems`

> Spec: faffter-dark-nlspec · 2026-10-26 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1283.
> build-tier: complex
> spec-review: approve (L4 adversarial, 2 rounds)

## 1. WHY — Problem and principles

faff ships an in-repo *subset* JSON-Schema validator understanding only a named allowlist of keywords, duplicated in two copies kept byte-for-byte in agreement. Today the "an array has at most N items" constraint is an orphan: the subset validates `minItems` but not `maxItems`, so the upper bound on Commissaire's `evidence_seq_range` lives in `commissaire.ts` instead of in the schema. This change teaches the subset validator `maxItems`, then deletes the writer-side crutch.

**Problem statement.** Commissaire conclusions carry `evidence_seq_range`, which must hold exactly two integers `[min seq, max seq]`; the schema can only say `minItems: 2`, so the "no more than two" half is enforced by a `length > 2` check in writer code, and a reader validating against the published schema alone would wrongly accept a three-item range. This issue adds `maxItems` to the subset validator and its additive-evolution allowlist, pins `maxItems: 2` on both conclusion payloads, and removes the now-redundant writer check.

**Design principles.** Both validator copies stay identical (`contract-engine.js` and `validate-schema.mjs`). Schemas are composed, never hand-edited (`scripts/evidence-v0.3-compose.mjs`). The additive-evolution allowlist (`SUBSET_KEYWORDS` in `evidence.js`) is an allowlist with direction. TypeScript emit is a committed artifact (`commissaire.ts` → rebuild + commit `.js`).

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/contract-engine.js` | JS | Subset validator copy #1 — array branch, `minItems` only today |
| `plugin/skills/faff/contracts/validate-schema.mjs` | JS (ESM) | Subset validator copy #2 — identical array branch |
| `plugin/skills/faff/bin/lib/evidence.js` | JS | `SUBSET_KEYWORDS` and `walkSchemaChange` — the additive gate |
| `verification/evidence/v0.3/schema/commissaire/conformed_to_contract.schema.json` | JSON | Authored payload source #1 |
| `verification/evidence/v0.3/schema/commissaire/accepted_under_contract.schema.json` | JSON | Authored payload source #2 |
| `scripts/evidence-v0.3-compose.mjs` | JS (ESM) | Composer |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | `conclusionRangeViolations` — the writer check to retire |
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript | Constructs `evidence_seq_range: [min, max]`; no separate length check |

## 2. OUT OF SCOPE
- Other unsupported subset keywords.
- A general "exactly N items" keyword.
- Reworking how `classifySchemaChange` is invoked.
- A v0.3 → v0.4 schema version bump (resolved unnecessary below).
- Closing the schema-unavailable degrade-mode gap (pre-existing, constraint-agnostic).

## 3. WHAT

**Validator keyword — `maxItems`.** In both validator copies, inside the `Array.isArray(data) && types.includes("array")` branch, alongside `minItems`:
```
IF schema.maxItems is a number AND data.length > schema.maxItems:
  add violation: "<where>: expected at most <schema.maxItems> items, got <data.length>"
```
Reason string mirrors `minItems`, character-identical between the two copies.

**Payload schema change.** On `evidence_seq_range` in both authored commissaire payload sources, add `maxItems: 2` beside `minItems: 2`. In `conformed_to_contract.schema.json` only, remove the stale description sentence "The writer also checks that evidence_seq_range holds exactly two integers." Then run `node scripts/evidence-v0.3-compose.mjs` to regenerate `declared-effect.schema.json` and re-mirror.

**`SUBSET_KEYWORDS` + directional additive rule.** Add `"maxItems"` to `SUBSET_KEYWORDS`. Extend `walkSchemaChange`:

| Transition | Additive? | Why |
|---|---|---|
| raise (2→3) | additive | loosening |
| removed (2→absent) | additive | loosening |
| lower (3→2) | non-additive | tightening |
| added where absent | non-additive | tightening |

Two sites in `walkSchemaChange`: the keyword-removed branch (treat removed `maxItems` as additive) and the both-present scalar-compare branch (compare numerically). The keyword-added branch already yields non-additive.

**`closedSubschema` interaction** — benign, no guard needed.

## 4. HOW

Four coordinated edits plus a regeneration and a rebuild: both validator copies gain the check; `evidence.js` gains `maxItems` in `SUBSET_KEYWORDS` + directional handling; both authored payload sources gain `maxItems: 2` + composer regen; `commissaire.ts` loses `conclusionRangeViolations` and its wiring, emit rebuilt and committed.

**The schema-unavailable degrade path is unchanged by this removal.** `recordSchemaCheck` early-returns before composing `conclusionRangeViolations`, so the writer check never ran in degrade mode; removing it is neutral there.

**Anti-patterns:** hand-editing generated schemas; adding to one validator copy only or with a different message.

## Scenarios

```
Given a Commissaire conclusion payload whose evidence_seq_range holds three integers
When the record is validated against the v0.3 declared-effect schema
Then validation fails with a named reason (e.g. "payload.evidence_seq_range: expected at most 2 items, got 3")
```
```
Given an array of two integers and a schema node { type: array, maxItems: 2 }
When the subset validator checks the array under either validator copy
Then it reports no violation, and both copies return byte-identical results
```
```
Given a published schema node with maxItems: 2 and a candidate raising it to maxItems: 3
When classifySchemaChange compares the two
Then the change is classified additive (reasons empty)
```
```
Given a published schema node with maxItems: 3 and a candidate lowering it to maxItems: 2
When classifySchemaChange compares the two
Then the change is classified non-additive and the reason names the JSON pointer, not a value
```
```
Given a published schema node with no maxItems and a candidate that adds maxItems: 2
When classifySchemaChange compares the two
Then the change is classified non-additive and the reason begins with a / JSON pointer and carries no schema value
```
```
Given a published schema node with maxItems: 2 and a candidate that removes maxItems entirely
When classifySchemaChange compares the two
Then the change is classified additive (reasons empty)
```
```
Given the set of committed declared-effects conclusion records (every evidence_seq_range holds exactly two integers)
When each is validated against the v0.3 declared-effect schema carrying the new maxItems: 2
Then every committed record still validates
```

## 5. Design decision rationale

**Does adding `maxItems` require a new schema version?** **Chosen:** No new schema version — v0.3 stays. It tightens the written schema but rejects no record any producer could have emitted. *(decides: architecture — recorded resolved; flagged for reviewer to confirm.)*

**How should `maxItems` be classified by the additive gate?** **Chosen:** Directional.

**What reason string?** **Chosen:** `expected at most N items, got M`.

**`closedSubschema` becoming closeable?** **Chosen:** Benign — no guard.

**Keep the writer-side `conclusionRangeViolations`?** **Chosen:** Remove it.

**Does removing the writer check open a degrade-mode gap?** **Chosen:** Remove with no degrade-mode replacement — the writer check never ran in degrade mode. *(decides: infosec — recorded resolved; flagged for reviewer to confirm.)*

## 6. Open questions and assumptions
**Open questions.** None (schema versioning resolved above). **Assumptions.** None requiring external validation.

## 7. DONE — definition of done

### From WHAT (validator keyword)
- [ ] `contract-engine.js` rejects an array longer than `maxItems` with reason `<where>: expected at most <N> items, got <M>`, inside the array branch, ignoring `maxItems` for non-arrays.
- [ ] `validate-schema.mjs` carries the identical check with the identical reason string.
- [ ] The validator-parity test has a new `maxItems` fixture row and both copies return equal results.

### From WHAT (payload schema + composition)
- [ ] `conformed_to_contract.schema.json` and `accepted_under_contract.schema.json` each carry `maxItems: 2` on `evidence_seq_range` beside `minItems: 2`.
- [ ] The stale sentence is removed from `conformed_to_contract.schema.json`'s description; the other's is unchanged.
- [ ] `node scripts/evidence-v0.3-compose.mjs` has been run; generated schema + bundled mirror regenerated and committed; `--check` exits 0.

### From WHAT (additive-evolution gate)
- [ ] `"maxItems"` is a member of `SUBSET_KEYWORDS` in `evidence.js`.
- [ ] `classifySchemaChange` reports a raised and a removed `maxItems` as additive.
- [ ] `classifySchemaChange` reports a lowered and an added-where-absent `maxItems` as non-additive, each reason beginning with a `/` JSON pointer, no schema value.
- [ ] The existing property test passes for the new additive maxItems case(s).

### From HOW (writer check retired)
- [ ] `conclusionRangeViolations` is deleted from `commissaire.ts`, its call removed from `recordSchemaCheck`, the stale comment gone.
- [ ] `governor.ts` confirmed to hold no separate length check.
- [ ] `commissaire.js` and `build-manifest.json` rebuilt and committed; `faff regions check` passes.

### From HOW (behaviour)
- [ ] A conclusion record whose `evidence_seq_range` holds three integers is refused by the schema check with reason `payload.evidence_seq_range: expected at most 2 items, got 3` (verb exits 2, nothing written).
- [ ] The three-seq conclusion writer test is updated to assert the new schema reason and still asserts exit 2 / record-unverified / no ledger line.

### From HOW (degrade path unchanged)
- [ ] A test confirms the schema-unavailable path early-returns before any length check.

### From HOW (committed data — AC 3)
- [ ] Every committed declared-effects conclusion record still validates; valid example fixtures still validate.

### Integration smoke test
```
GIVEN a run dir and a governed conclude that produces evidence_seq_range = [0, 6]
WHEN the commissaire conclusion record is written
THEN it is accepted (two-item range) and appears in declared-effects.jsonl
AND repeating with a forced three-item range is refused by the schema with the maxItems reason, writing nothing
```

confidence: high
spec-review: approve
