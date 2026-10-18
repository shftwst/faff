# Spec: holdout.json can carry an optional delegated[] list (FAFF-1342)

> Spec: faffter-dark-nlspec · 2026-10-18 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1342.

This is the schema slice of the FAFF-1291 spec, split off by the product owner on 2026-10-18 so the anchor schema accepts `delegated[]` before any writer emits it. The design was reviewed as part of FAFF-1291 (3 spec-review rounds, accepted at L2). This slice changes schema, example and documentation only.

## 1. WHY

FAFF-1291 makes the code-blind holdout judge only machine-checkable criteria. Every criterion it does not judge is listed in `holdout.json` with the verifier that covers it, so no criterion disappears without a trace. That list needs a place in the v0.3 anchor schema first. Landing the schema in its own PR means the writer change in FAFF-1291 never emits a field the anchor schema would reject.

**Scope.** `holdout-anchored.schema.json` (both copies), `holdout-anchored.example.json` (both copies), `evidence-documents.md` (both copies) and `verification/evidence/README.md`. No code changes.

## 2. Out of scope

- The writer, classifier, contract, evaluator and graft changes that fill `delegated[]`: FAFF-1291.
- `holdout-verdict.schema.json` (the contract-data schema): FAFF-1291, which changes it together with the contract.

## 3. WHAT

Add one optional top-level property to `holdout-anchored.schema.json`. `required` is unchanged and `schema_version` stays 1.

```
RECORD DelegatedRow:                                # closed object, all keys required
  id: String              # pattern ^(scenarios|done):[1-9][0-9]*$ (same as criteria[].id)
  text: String
  holdout: Boolean
  verification_tier: ENUM { delegated, integration }
  verifier: ENUM { ac-checklist, review-merge-floor }
  ac_id: String | null    # the qualified ac_id for a done row when the record's issue is an issue id; else null

holdout.json.delegated: Array<DelegatedRow>          # optional in the schema
```

**Keywords.** **Chosen:** the new subschema uses only keywords `classifySchemaChange` accepts as additive: `type`, `enum`, `pattern`, `required`, `properties`, `additionalProperties: false` and `items`. It uses no `maxLength`, `oneOf` or other keyword outside `SUBSET_KEYWORDS`, so the change classes as additive and the FAFF-1278 base-commit leg accepts anchors that carry it.

**Where delegated rows live.** **Chosen:** a separate, closed, optional top-level `delegated[]` (reviewed in FAFF-1291). A new verdict or class value would widen an enum, which `classifySchemaChange` classes as non-additive. Rows in the unsigned evidence report would sit outside the anchor and go unvalidated.

**Tier and verifier pairing.** **Chosen:** the schema enumerates both tier values and both verifiers; the pairing rule (`delegated` with `ac-checklist`, `integration` with `review-merge-floor`) is a writer and validator rule that FAFF-1291 adds, not a schema constraint, because expressing it needs `oneOf` or `if`/`then`, which are outside the additive keyword set.

**Documentation.** Both copies of `evidence-documents.md` describe `delegated[]`: what each key means, that the writer fills it from `faff dod classify` (FAFF-1291), and that anchors without it still validate. `verification/evidence/README.md` gains a dated v0.3 changelog entry naming FAFF-1342 and FAFF-1291 and the `delegated` property.

**Sequencing against PR #1086 (FAFF-1261).** **Chosen:** this ticket lands whichever way #1086 goes. If #1086 is on `main` first, its v0.3 README states the additive in-place rule (ADR 0140), and this change follows it. If not, v0.3 is still a draft and this change lands in place; #1086 rebases and keeps this changelog entry.

## 4. HOW

Edit the two schema copies identically, add one `delegated` row to the two example copies, extend the two `evidence-documents.md` copies, and add the changelog entry. Add the tests named in DONE.

### Failure modes

- A keyword outside `SUBSET_KEYWORDS` slips in. How you'd know: `classifySchemaChange` returns `additive: false` (ac-2). What it means: the base-commit leg would fall back to the base schema and reject new anchors; fix the keyword before merge.
- The two copies drift. How you'd know: `test/evidence-v0.3.test.mjs` fails its byte-identical check (ac-1).

## 5. Open questions and assumptions

**Open questions:** none.

- **Assumes:** `classifySchemaChange` in `plugin/skills/faff/bin/lib/evidence.js` classes a new optional, typed, closed top-level property as additive, as the FAFF-1291 exploration found. Validation: ac-2.

## Already shipped against this surface

- **FAFF-1259** (#1054) is related and not superseded. It added `holdout-anchored.schema.json`, its example and the per-criterion `id`. This ticket adds `delegated` beside `criteria`.
- **FAFF-1278** (#1067) is related and not superseded. It added the base-commit governance leg and `--candidate-schemas`, which this change must pass.

## 6. DONE

- [ ] [ac-1] Both copies of `holdout-anchored.schema.json` gain the optional closed `delegated` array defined above and stay byte-identical (`test/evidence-v0.3.test.mjs`). `required` is unchanged.
- [ ] [ac-2] A test shows `classifySchemaChange` over the old and new `holdout-anchored` schema returns `additive: true`, and `faff evidence validate --candidate-schemas` with the new schema accepts an anchor whose `holdout.json` carries `delegated`.
- [ ] [ac-3] The FAFF-1278 base-commit leg test passes for an anchor whose `holdout.json` carries `delegated`.
- [ ] [ac-4] `holdout-anchored.example.json` (both copies) carries a `delegated` row and validates against the new schema; a `holdout.json` with a `delegated` row that has an extra key, a wrong tier, a wrong verifier or a malformed id fails it.
- [ ] [ac-5] The four committed anchors that carry `holdout.json` (FAFF-1197, FAFF-1198, FAFF-1201, FAFF-1279) still give the same `faff evidence validate` result as before.
- [ ] [ac-6] Both copies of `evidence-documents.md` document `delegated[]` and stay byte-identical; `verification/evidence/README.md` has a dated v0.3 changelog entry naming FAFF-1342, FAFF-1291 and the `delegated` property.
- [ ] [ac-7] The full test suite passes, and `faff evidence --selftest` passes.

confidence: high
build-tier: standard
spec-review: accept (inherited from the FAFF-1291 spec review, human preference, L2; slice split by the product owner, not re-reviewed)
