# FAFF-1274: Let the v0.3 run-ledger schema accept free-form outcome_details

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1274.

This spec is for the build agent and the human reviewer of FAFF-1274, a child of the anchor-evidence epic FAFF-1255. It opens the per-issue `outcome_details` entries in the v0.3 run-ledger schema so that the free-form detail builds already write stops failing validation, before FAFF-1261 turns validation into refusal.

## 1. WHY

**The load-bearing model.** The run ledger has two issue-keyed maps. `outcomes` is the completeness ledger: one terminal-state string per issue, read by `runcheck`. `outcome_details` is a documented free-form sidecar that no gate reads (`runcheck.js` says so; `faff-beep-boop/SKILL.md` documents it as "`{issue-id: object}`, free-form, no fixed schema"). The v0.3 schema from FAFF-1256 closed `outcome_details` entries anyway, against a key list harvested from old ledgers. This change makes the schema match the documented contract: `outcomes` stays strict, `outcome_details` entries become open.

**Problem.** Every build since FAFF-1256 writes keys the closed list does not name (today, a `merge` key on every shipped issue), so each new committed anchor ledger fails the schema and gets a hand-added row in `LEDGER_EXCEPTIONS` (`test/evidence-v0.3.test.mjs`): FAFF-1258, FAFF-1259, FAFF-1263, FAFF-1266, FAFF-1267, plus the older FAFF-959. The FAFF-1258 serialiser (`mutateLedgerUnderLock` in `bin/lib/heartbeat.js`) already refuses an unlisted `outcome_details` key on a CLI write. Once FAFF-1261 refuses non-conforming anchors at mint, every one of these ledgers would be refused.

**Design principles.**

- **Strict where something reads, open where nothing does.** `outcomes` is gate input and stays a closed enum. `outcome_details` feeds no gate, so typing its keys buys no safety and costs a schema edit every time a writer adds or retypes a detail.
- **Openness is visible, never a loophole.** The v0.3 lint asserts every object node is closed. The opened node gets a named exemption in that lint, beside the existing open JSONL payloads, rather than an `additionalProperties: {}` that passes the lint by accident.

**Reference context.**

| System | Relevance |
|---|---|
| `verification/evidence/v0.3/schema/run-ledger.schema.json` and its byte-identical bundled copy `plugin/skills/faff/contracts/evidence-v0.3/schema/run-ledger.schema.json` | The schema to edit; a test asserts the two trees are identical |
| `test/evidence-v0.3.test.mjs` | `LEDGER_EXCEPTIONS`, the committed-ledger test, the "every object node is closed" lint |
| `test/run-ledger-serialiser.test.mjs` | The test "an invalid field inside an outcome_details entry the mutation added is introduced" relies on the closed shape |
| `plugin/skills/faff/bin/lib/heartbeat.js` (`mutateLedgerUnderLock`) and `bin/lib/evidence.js` (`validateEvidenceDocument`) | Serialiser validates every CLI ledger write against the bundled schema; no code change needed |
| `plugin/skills/faff/contracts/validate-schema.mjs` and `bin/lib/contract-engine.js` | Both validators treat an absent `additionalProperties` as "allow any key" |
| `verification/evidence/v0.3/evidence-documents.md` (and bundled copy) | Documents "every object level is closed" and the writer-bug table |

**Scope.** One schema node, its two lints and its docs, inside the FAFF-1255 draft v0.3 evidence spec, which the README's draft rule lets FAFF-1255 slices edit in place until FAFF-1261 lands.

## 2. OUT OF SCOPE

- **The six other committed-ledger exceptions** (FAFF-647 outcome `promoted`; FAFF-581, FAFF-699, FAFF-723 string `budget.envelope.window`; FAFF-865, FAFF-1017 string `post_merge_verification_failures` items). Why: genuine writer bugs outside `outcome_details`, already documented. Extension point: the `LEDGER_EXCEPTIONS` map and the writer-bug table in `evidence-documents.md`.
- **Loosening `outcomes`.** Why: the issue forbids it; `runcheck` depends on it. Extension point: none intended.
- **Typed schemas for individual detail keys** (for example a structured `merge` object). Why: no consumer reads them today. Extension point: a future schema version can add `properties` under the opened node when a consumer appears.
- **Mint refusal.** Why: FAFF-1261, which this issue blocks.
- **Changing what writers put in `outcome_details`.** Why: the point is to accept what they write. Extension point: `faff-beep-boop/SKILL.md` ledger section.

## 3. WHAT

**The opened node.** Replace the schema at `properties.outcome_details.additionalProperties` with:

```
SCHEMA outcome_details entry:
  type: ["object", "string"]
  description: free-form per-issue detail; any keys, any JSON values; never read by a gate
  # no properties, no additionalProperties keyword (JSON Schema default: any key allowed)
```

`outcome_details` itself stays `{ type: object, additionalProperties: <entry schema> }`, so the map must still be an object keyed by issue, and an entry that is a number, boolean, array or null is still rejected.

**Decision: open completely, or keep typed known keys plus extras?**

| Option | For | Against |
|---|---|---|
| Open completely (any keys, any value types) | Matches the documented "free-form, no fixed schema" contract; no future churn | Loses type checks on about 60 keys nobody reads |
| Typed known keys, extras allowed | Catches a writer that retypes a known key | Retyping (`pr` as a string, `merge` as an object instead of a string) becomes a refusal at FAFF-1261 for a field no gate reads; keeps a harvested key list alive |

**Chosen:** open completely. The known-key list was harvested from old data, not from a consumer's needs, and typing it keeps the same exception churn alive one level down.

**Decision: may an entry be a bare string?** The FAFF-959 ledger writes three entries as plain strings. FAFF-1256 recorded that as a writer bug against the documented object shape; this issue's acceptance criterion asks for every ledger whose only failure is under `outcome_details` to validate, and FAFF-959 is one.

**Chosen:** allow `object` or `string`. A string note carries the same kind of free-form detail, no gate reads it, and the acceptance criterion names it. The SKILL prose keeps telling writers to use objects; the schema tolerates a string.

**Lint exemption.** In `test/evidence-v0.3.test.mjs`, the test "every object node is closed, apart from the open JSONL payloads and discriminator bases" gains one named exemption: file `run-ledger.schema.json`, trail ending `outcome_details` → `additionalProperties`. Rename the test to mention the outcome_details entries.

**Chosen:** a named exemption in the lint, not `additionalProperties: {}`. Why: `{}` passes the lint's "is an object" check and would hide the openness from the next reader of the lint.

## 4. HOW

```
PROCEDURE open_outcome_details:
  1. Edit run-ledger.schema.json in verification/evidence/v0.3/schema/ to the entry schema in WHAT.
     Copy the file byte-for-byte to plugin/skills/faff/contracts/evidence-v0.3/schema/.
  2. Update the schema's top-level description: closed at every level EXCEPT outcome_details entries.
  3. In test/evidence-v0.3.test.mjs:
     a. Remove the six outcome_details rows from LEDGER_EXCEPTIONS (FAFF-959, FAFF-1258, FAFF-1259,
        FAFF-1263, FAFF-1266, FAFF-1267) and the comment above the FAFF-1259 row.
     b. Rename the committed-ledger test from "seven" to "six known writer bugs".
     c. Add the named lint exemption.
     d. Add a test: a ledger whose outcome_details holds (i) an entry with an unlisted key and a nested
        object (for example merge: { sha, pr }), (ii) an entry with an array value, and (iii) a bare
        string entry, validates with no violations; and a ledger whose outcome_details entry is a number,
        or whose outcome_details is an array, still fails naming outcome_details; and an outcomes value
        that is an object still fails naming outcomes.
  4. In test/run-ledger-serialiser.test.mjs, replace the bogus_key case so it still proves an introduced
     outcome_details violation is refused: the mutation adds an entry whose value is a number
     (for example outcome_details: { "FAFF-1": 5 }) and mutateLedgerUnderLock throws LEDGER_SCHEMA.
     Add the positive twin: a mutation adding an entry with an unlisted key and a nested object writes.
     Add a redaction test beside the existing "a known secret in a field is written redacted" case: a known
     secret placed in a nested object inside an outcome_details entry lands on disk as [REDACTED].
  5. Update evidence-documents.md (both copies): outcome_details entries are open (object or string,
     any keys); remove the FAFF-959 row; "Seven committed ledgers" becomes "Six".
  6. Leave run-ledger.example.json and run-ledger.invalid.example.json unchanged: the valid example
     uses listed keys and still validates; the invalid example fails on the missing schema_version.
```

**Edge cases.**

- `outcome_details: {}` stays valid. `outcome_details` absent stays valid.
- Secrets in the newly accepted nested content: `mutateLedgerUnderLock` redacts the whole document before validating and writing (`redactLedgerDocument` → `redactKnownSecrets` in `bin/lib/redact.js`, whose `redactWalk` recurses into every object and array). This change does not touch redaction, but opening the node removes the old closed-schema refusal that used to stop nested content, so the build adds a regression test proving a known secret nested inside an `outcome_details` entry (for example `outcome_details.FAFF-1.merge.note`) is written as `[REDACTED]`.
- The serialiser compares against the snapshot, so a pre-existing string or extra-key entry was already "pre-existing" and only reported; after this change it is not a violation at all.

**Anti-pattern:** widening the schema by adding the newly seen keys (`merge`, `superseded_by`, `admitted`, `branch_pushed`) to the closed list. Why: it is the same churn the issue exists to end; the next build adds another key.

**Anti-pattern:** editing only one of the two schema copies. Why: the byte-identity test fails, and the CLI validates against the bundled copy while the tests read the `verification/` copy.

**Failure mode.** The FAFF-1258 additive-evolution classifier (`classifySchemaChange` in `evidence.js`, used only by `faff evidence validate --candidate-schemas`) will call this change non-additive (a `type` change and a removed `additionalProperties`). That is expected for a draft-version edit and nothing in the merge path runs it; how you'd know otherwise: a CI or merge step calling `--candidate-schemas` reports `run-ledger.schema.json` rejected. If that appears, the change still stands; note it on the PR.

## 5. Scenarios

```
Given a committed anchor ledger from run-20261014-065523-beepboop-list-10835a whose outcome_details entries carry "merge"
When the committed-ledger test validates it against the edited run-ledger schema
Then it reports no violations and has no LEDGER_EXCEPTIONS row
```

```
Given a ledger with outcome_details { "FAFF-1": { "merge": { "sha": "abc1234", "pr": 1 }, "superseded_by": ["FAFF-2"] } }
When mutateLedgerUnderLock writes it
Then the write succeeds with no LEDGER_SCHEMA error
```

```
Given a ledger with outcomes { "FAFF-1": { "state": "shipped" } }
When it is validated against the edited schema
Then it fails naming outcomes.FAFF-1
```

## 6. DESIGN DECISION RATIONALE

- **Open completely or keep typed known keys?** Typed keys catch retyping, but nothing reads the keys and retyping would become a refusal at FAFF-1261. **Chosen:** open completely, matching the documented free-form contract.
- **Allow string entries?** Rejecting them keeps the FAFF-959 exception and contradicts the acceptance criterion; allowing them widens the type beyond the SKILL prose's "object". **Chosen:** object or string; SKILL prose still steers writers to objects.
- **How to mark the node open?** `additionalProperties: {}` or `true` pass the closure lint silently; omitting the keyword plus a named lint exemption keeps the openness visible. **Chosen:** omit the keyword and add the named exemption.
- **Edit v0.3 in place or cut v0.4?** v0.3 is draft; the README's draft rule lets FAFF-1255 slices edit it in place until FAFF-1261 lands. **Chosen:** edit v0.3 in place, no changelog entry beyond the existing draft one.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open questions:** none.

**Assumes:** FAFF-1261 (mint refusal) has not landed, so v0.3 is still draft and editable in place. Validation: `verification/evidence/README.md` still lists `v0.3/` as `draft`.

## 8. DONE

### From WHY
- [ ] `node --test test/evidence-v0.3.test.mjs` passes with `LEDGER_EXCEPTIONS` holding exactly six rows, none whose key starts `outcome_details`.
- [ ] The FAFF-959, FAFF-1258, FAFF-1259, FAFF-1263, FAFF-1266 and FAFF-1267 committed ledgers validate with no violations.

### From WHAT
- [ ] `properties.outcome_details.additionalProperties` in both schema copies is `{ "type": ["object", "string"], "description": … }` with no `properties` and no `additionalProperties`; both copies are byte-identical.
- [ ] The closure lint names the `run-ledger.schema.json` outcome_details entry as its only new exemption and still fails any other open object node.
- [ ] `properties.outcomes` is unchanged byte-for-byte.

### From HOW
- [ ] A new test validates a ledger with an unlisted key, a nested object, an array value and a bare string entry under `outcome_details`, with zero violations.
- [ ] The same test shows a numeric entry, an array-valued `outcome_details`, and an object-valued `outcomes` entry each still fail.
- [ ] `test/run-ledger-serialiser.test.mjs` refuses a mutation that adds a numeric `outcome_details` entry (`LEDGER_SCHEMA`) and accepts one that adds an unlisted key with a nested object.
- [ ] `test/run-ledger-serialiser.test.mjs` proves a known secret nested inside an `outcome_details` entry is written as `[REDACTED]`.
- [ ] The run-ledger schema's top-level `description` no longer says every level is closed; it names `outcome_details` entries as the open exception.
- [ ] `evidence-documents.md` (both copies) says `outcome_details` entries are open, lists six writer-bug ledgers, and drops the FAFF-959 row.
- [ ] `node --test test/evidence-v0.3.test.mjs test/run-ledger-serialiser.test.mjs test/evidence-validate.test.mjs test/runcheck-gate.test.mjs` passes.

### Integration smoke test

```
1. node -e: validate { schema_version: 1, run_id: "r", outcomes: { X: "shipped" },
   outcome_details: { X: { merge: { sha: "a", pr: 1 } }, Y: "note" } } against the bundled run-ledger schema
2. Expect []
3. node -e: validate { schema_version: 1, ...<committed FAFF-1266 anchor run-ledger.json> } against the same schema; expect []
   (faff evidence validate reports committed ledgers as legacy because they predate schema_version, so it is not the check here)
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** No issues. One schema node, two test files and one doc page: well under a day, one concern.
- **Workstream fit? (principles 1 and 5)** No issues. A child of FAFF-1255 (anchor evidence), whose outcome is enforceable evidence schemas; this removes the churn that would block that outcome.
- **Dependencies surfaced? (principle 6)** No issues. It already blocks FAFF-1261 (mint refusal), the ticket that would otherwise refuse these ledgers. FAFF-1256, FAFF-1258 and the other slices it cites are Done and linked as related.
- **Risk profile? (principle 7)** No issues. No novel integration; the only behavioural surface is the FAFF-1258 serialiser, covered by an existing test file the spec updates.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{ "confidence": "high", "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
