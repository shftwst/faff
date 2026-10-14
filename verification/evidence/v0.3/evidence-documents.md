# Evidence documents

An evidence document is an anchor file whose manifest entry has `versioned_by: "field"`. Each
requires `schema_version` with the value `1`. The three run-state documents are stamped from
FAFF-1258; the rest are not yet.

| File | Schema | Writer today | Starts stamping |
|---|---|---|---|
| `run-ledger.json` | `run-ledger` | `run-ledger.js` and several other CLI writers, plus agents following SKILL prose | FAFF-1258 |
| `build-progress.json` | `build-progress` | `buildProgressApplyComplete` (`effects.js`) | FAFF-1258 |
| `landing-progress.json` | `landing-progress` | `landingProgressApplyFixCycle` (`effects.js`) | FAFF-1258 |
| `ac-checklist.json` | `ac-checklist` | graft Step 8 | FAFF-1257 |
| `review-verdict.json` | `review-verdict-anchored` | graft Step 9 | FAFF-1257 |
| `spec-review-verdict.json` | `spec-review-verdict-anchored` | faff-prep | FAFF-1257 |
| `holdout.json` | `holdout-anchored` | `holdout_step` | FAFF-1259 |

## Run ledger

Only `schema_version` and `run_id` are required, because the ledger is written by CLI code and
by agents following SKILL prose, and resume logic branches on key presence. Every other key is
optional and typed, and every object level is closed except `outcome_details` entries. Issue-keyed
maps (`outcomes`, `outcome_details`, `routing_verdicts`, `verdicts`, `capabilities`, the budget
token maps) use `additionalProperties` as a schema. `outcomes` values are the nine
`ledger_outcomes` from `governance-profile.js`. `outcome_details` entries are open: each is an
object with any keys and any JSON values, because no gate reads them. The map itself must still be
an object keyed by issue, and each entry must still be an object.

The key set is the union of the keys the CLI writers set, the keys SKILL prose tells an agent to
write and the keys in committed ledgers. Seven committed ledgers fail the schema because of
writer bugs in old data:

| Committed ledger | Reason |
|---|---|
| `run-20260803-232227-beepboop-full/FAFF-647` | outcome `promoted` is not a ledger outcome |
| `run-20260810-185342-beepboop-list/FAFF-581`, `FAFF-699`, `FAFF-723` | `budget.envelope.window` values are strings; `envelopeFrom` now writes numbers |
| `run-20260818-195900-beepboop-list-dac127/FAFF-865`, `run-20260915-094719-fly-l3/FAFF-1017` | string items in `post_merge_verification_failures` |
| `run-20260903-203823-fly-l3/FAFF-959` | string values in `outcome_details` |

The list does not grow without a reviewer agreeing the writer documents a different type.

## Run-state documents

`build-progress` and `landing-progress` require every key their writers emit, and the writers
(`effects.js`) stamp `schema_version: 1` and validate against these schemas before writing. They are
resume checkpoints, so a later slice may narrow them further.

Every `run-ledger.json` write goes through `mutateLedgerUnderLock` (`heartbeat.js`), which stamps
`schema_version`, validates, and refuses only the violations the current mutation introduces.
`bundle-recover` upgrades a restored legacy snapshot through the same path.

## Review and test documents

`ac-checklist`, `review-verdict-anchored`, `spec-review-verdict-anchored` and `holdout-anchored`
carry a fixed key set: a field with no value is `null`, never absent. The one exception is
`ac-checklist.criteria`, which is omitted for a zero-AC issue because `readAcComplete` rejects
`[]` and `null`.

Every merged finding and objection keeps an `occurrences` list with one entry per round it was
raised in, so nothing a reviewer raised in any round is overwritten by a later round.
`review-round` is the shape of one round record, published so the collator's input is pinned;
round records are never anchored.

Constraints the validator subset cannot express are enforced by the writer, not the schema:
for a holdout criterion, `met` and `unmet` need `exercised`, `expected` and `observed`,
`needs-human` needs `reason`, and each string is at most 2000 characters.

A `holdout.json` record's `issue` is the id of the call that wrote it: the issue id for the per-issue
graft gate, and the run id for the per-run phase that is keyed by the run. The `--issue` of
`faff holdout record` (or the `--key` of the caged spawner) is that id.
