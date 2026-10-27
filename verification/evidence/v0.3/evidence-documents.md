# Evidence documents

An evidence document is an anchor file whose manifest entry has `versioned_by: "field"`. Each
requires `schema_version` with the value `1`. The three run-state documents are stamped from
FAFF-1258, and graft's three review documents from FAFF-1267 and FAFF-1277; `holdout.json` from
FAFF-1259.

| File | Schema | Writer today | Starts stamping |
|---|---|---|---|
| `run-ledger.json` | `run-ledger` | `run-ledger.js` and several other CLI writers, plus agents following SKILL prose | FAFF-1258 |
| `build-progress.json` | `build-progress` | `buildProgressApplyComplete` (`effects.js`) | FAFF-1258 |
| `landing-progress.json` | `landing-progress` | `landingProgressApplyFixCycle` (`effects.js`) | FAFF-1258 |
| `ac-checklist.json` | `ac-checklist` | `faff evidence write ac-checklist`, called by graft Step 8 | FAFF-1277 |
| `review-verdict.json` | `review-verdict-anchored` | `faff evidence write review-verdict`, collating the rounds `faff evidence record-review-round` records, called by graft Step 9 | FAFF-1277 |
| `spec-review-verdict.json` | `spec-review-verdict-anchored` | `faff evidence write spec-review-verdict`, called by graft Step 9b | FAFF-1267 |
| `holdout.json` | `holdout-anchored` | `holdout_step` | FAFF-1259 |

## The `faff_version` field

Every document in the table above, and each `owner` and `owner_history` entry of the run ledger,
accepts an optional string `faff_version` (FAFF-1395): the faff plugin release that wrote it, such
as `0.42.0`, or `unknown` when the release could not be resolved. The writers stamp it directly
after `schema_version`. A document written before FAFF-1395 has no such field, and is still valid.
`build-progress.json` and `landing-progress.json` carry the release of whichever writer wrote them
last; the other documents carry the release that wrote them. In the ledger it sits in `owner`, so a
resume records the resuming release in the new owner and keeps the earlier owner's in
`owner_history`. The addition is optional and does not change `schema_version`.

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

Each `ac-checklist` criterion also carries `ac_id` and `verifications` (FAFF-1287), both optional
in the schema and always written, `null` when unknown. Anchors written before then lack them and
still validate.

- `ac_id` is the qualified id `<lowercase ticket>#<local id>`, for example `faff-1287#ac-3`. The
  local id is the `[ac-N]` authored on the spec's DONE line, or `done:N` when the line has none.
  Either every criterion carries one or none does, ids are unique, and the ticket part matches
  the issue.
- `verifications` lists how the criterion was verified, one `{kind, locator?}` entry per method.
  `kind` is `test` (locator `<file>::<test title>`), `command` (locator is the exact command) or
  `human` (no locator). The writer enforces these per-kind rules, because the schema subset
  cannot. A `command` locator names a secret by environment variable, never by value.
- `ac` and `verified` are single lines, so the rendered PR-body block cannot gain lines the anchor
  does not hold. `faff evidence render ac-checklist` prints that block from the written anchor.

Every merged finding and objection keeps an `occurrences` list with one entry per round it was
raised in, so nothing a reviewer raised in any round is overwritten by a later round.
`review-round` is the shape of one round record, published so the collator's input is pinned;
round records are never anchored. Each finding keeps the reviewer's `carried_id`, the `P<k>` handle
of the previous round's finding it re-raises (`null` when none); `resolveRoundChain` honours it only
for a finding in the same file, so a carried id is never trusted on the reviewer's word alone.

Graft records every code-review pass as `review-rounds/round-<n>.json` (`faff evidence
record-review-round`), and `faff evidence write review-verdict` collates them into
`review-verdict.json` with `round_history: "recorded"` and `rounds_total` set to the number of
round records. Findings merge on the id `resolveRoundChain` decides, re-resolved from the stored
`carried_id`, title and location on every collation and restarted at a gap in round numbers. A
merged finding is settled `fixed` only when the review loop ended in `pass`; a finding the
reviewer refuted or accepted keeps that disposition, and on a park every other finding is `open`.
The park writes (`--park needs-human` and `--park unavailable`) collate the rounds that did run
and add no round of their own, so `signal: "unavailable"` appears only on the outage park. A
judge admit (`--judge-admitted`) writes `signal: "pass"` with `admitted_by: "build-judge"`, after
checking the judge's own `admit-result.json`. The optional `adversarial_outcome`
(`chain-outage-skipped`) is copied from the terminal round, present only when the adversarial
review chain was skipped for an outage.

`--terminal-only` stays for manual recovery of a run dir with no recorded rounds: it writes
`round_history: "terminal-only"` and `rounds_total: 1`, and appends one `evidence-terminal-only`
event to `events.jsonl` first, so the missing history is visible in the hash chain as well as the
file.

Constraints the validator subset cannot express are enforced by the writer, not the schema:
for a holdout criterion, `met` and `unmet` need `exercised`, `expected` and `observed`,
`needs-human` needs `reason`, and each string is at most 2000 characters.

`holdout.json` may also carry `delegated[]` (FAFF-1342), the criteria the code-blind judge did not
judge, each with the verifier that covers it, so no criterion disappears without a trace. The writer
fills it from `faff dod classify` (FAFF-1291). The key is optional: an anchor without it still
validates. Each row is a closed object and all six keys are required:

| Key | Meaning |
|---|---|
| `id` | `<source>:<index>` from `faff dod classify`; the source is `scenarios` or `done` and the index starts at 1 |
| `text` | the criterion text |
| `holdout` | whether the criterion is a holdout criterion |
| `verification_tier` | `delegated` or `integration` |
| `verifier` | `ac-checklist` or `review-merge-floor` |
| `ac_id` | the qualified ac_id for a `done` row when the record's `issue` is an issue id; otherwise `null` |

The schema lists both tiers and both verifiers but does not pair them. The pairing rule
(`delegated` with `ac-checklist`, `integration` with `review-merge-floor`) is a writer and validator
rule that FAFF-1291 adds, because the validator subset cannot express it.

With `delegated[]` in the record, the holdout `aggregate` is derived over `criteria` alone, the judged
set. `meets-spec` therefore means every judged criterion was met, not that the whole DoD was met. A
prose DONE item is delegated to the AC checklist, so it rests on the builder-written `ac-checklist.json`
and the review leg. FAFF-1339 adds the check that each delegated `ac_id` has a `passed: true` row in the
same anchor. That check adds completeness, not independence, because both files are builder-written.
Only moving the checklist write out of the build lane narrows the trust shift.

A `holdout.json` record's `issue` is the id of the call that wrote it: the issue id for the per-issue
graft gate, and the run id for the per-run phase that is keyed by the run. The `--issue` of
`faff holdout record` (or the `--key` of the caged spawner) is that id.
