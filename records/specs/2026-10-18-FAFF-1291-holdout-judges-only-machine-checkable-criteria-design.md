# Spec: the code-blind holdout judges only criteria a machine can check (FAFF-1291)

> Spec: faffter-dark-nlspec · 2026-10-18 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1291.

This spec covers FAFF-1291 for the build agent and its human reviewers. It changes `faff dod classify`, the holdout record writer, the `holdout-verdict` contract, the evaluator skill, and the graft holdout offer. After the change, prose DONE criteria go to the AC checklist and stop counting toward the holdout aggregate. The holdout record still lists each one with the verifier that covers it.

## 1. WHY

**Main idea.** Each DoD criterion is checked by one verifier, and `faff dod classify` decides which one, deterministically. FAFF-961 already sends `integration` criteria to the review and merge test floor. This ticket adds one more route: a prose DONE item goes to the AC checklist. Graft Step 8 already builds the AC checklist from every DONE item, and the merge floor already requires it. The holdout judges only the criteria routed to it. The writer, not the LLM, lists every other criterion in the holdout record with its verifier, so no criterion can disappear without a trace.

**Problem.** Every committed holdout ends `needs-human`. FAFF-1197, FAFF-1198, FAFF-1201 and FAFF-1279 carry 20, 25, 29 and 23 prose rows. The evaluator forces each prose row to `needs-human`, `deriveHoldoutAggregate` lets any `needs-human` win, and the strict L4 floor blocks anything except `meets-spec`. After this change, a spec whose machine-checkable criteria all pass can reach `meets-spec`. Its prose DONE items stay on the AC checklist leg, which already blocks the merge when any of them is unverified.

**Design principles**

**Classification stays mechanical.** The verifier for a criterion comes from `faff dod classify`. The evaluator does not decide it and neither does the writer. Any implementation where the LLM evaluator decides what it judged is rejected.

**A delegated criterion needs a verifier that can see it.** A criterion is delegated only to a verifier that receives it by id. The AC checklist receives DONE items, each with an `ac_id`. Nothing receives a Scenarios unit by id, so a prose Scenarios unit is never delegated. It fails closed to `needs-human`.

**`class` keeps three values and the aggregate keeps one derivation.** Delegation is carried on `verification_tier`, the axis FAFF-961 added. `deriveHoldoutAggregate` is unchanged and runs over the judged set only.

**Reference context**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/admissibility.js` (`dodClassify`, `resolveVerificationTier`, `proseDoneAdvisory`, `cmdHoldoutRecord`) | JS, region factory | Classifier, FAFF-304 advisory, `faff holdout record` CLI |
| `plugin/skills/faff/bin/lib/holdout-record.js` (`buildHoldoutRecord`, `holdoutRecordViolations`) | JS, region governance | The only writer of `holdout.json` |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeHoldoutVerdict`, `deriveHoldoutAggregate`, `holdoutGateResult`, `--describe` text) | JS, region factory | Contract and gate. The merge floor reads it through `readHoldout` |
| `plugin/skills/faff/contracts/evidence-v0.3/schema/holdout-anchored.schema.json` and `verification/evidence/v0.3/schema/` | JSON Schema | Anchor schema. The two copies must stay byte-identical |
| `plugin/skills/faff/contracts/holdout-verdict.schema.json` | JSON Schema | Contract-data shape |
| `plugin/skills/faffter-noon-evaluate/SKILL.md`, `evaluate-call.mjs` | prompt, JS | Evaluator and caged spawner. The spawner already reads `--spec` |
| `plugin/skills/faff-graft/SKILL.md` Step 6 `holdout_offer`, Step 8c `holdout_run` | prompt | Offer and run skip rule |
| `plugin/skills/faff-beep-boop/SKILL.md` `holdout_step` | prompt | Shared engine that calls `faff holdout record` |

**Scope.** This is one slice of the L4 holdout pipeline: classifier, writer, contract and the two prompts that drive them. The merge floor, the AC checklist writer and the review leg do not change.

## 2. Out of scope

- **Tracker hygiene.** FAFF-1291, FAFF-1292 and FAFF-1293 share one outcome (the L4 holdout reaches `meets-spec` on real specs) and need a project. FAFF-1270 carries a note that its holdout run needs a spec free of the FAFF-1292 and FAFF-1293 defects. The estimate is a tracker field.
- **Unreachable born-verifiable criteria (FAFF-1292).** A scenario or assertion the env exposes no surface for still ends `needs-human`. FAFF-1292 owns how such a criterion is reported. Extension point: `verification_tier` in `resolveVerificationTier`, and the evaluator's no-surface backstop.
- **Prose-shaped Scenarios units (FAFF-1293).** This ticket makes them fail closed. Refusing them at spec review is FAFF-1293. Extension point: the spec-review lenses.
- **Cross-checking delegated `ac_id`s against `ac-checklist.json` ([FAFF-1339](https://linear.app/shftwst/issue/FAFF-1339)).** Delegation relies on graft Step 8 sourcing the checklist from every DONE item (see Assumptions). FAFF-1339 makes the merge floor fail when a `delegated[].ac_id` with verifier `ac-checklist` has no `passed:true` row in the same anchor. Extension point: `evaluateMergeFloorLeg` in `governance-check.js`.
- **Writing the AC checklist on the trusted side.** The builder writes `ac-checklist.json` in-lane today (graft Step 8, the rung-0 posture). Moving that write out of the lane is not part of this ticket (see the trust shift below).
- **Signing the verdict (FAFF-1214).** `delegated[]` is placed inside the record that a later signature will cover. This ticket signs nothing.
- **`not-yet-reachable` tier (FAFF-962).** Extension point: the same tier resolver and the `delegated[].verification_tier` enum. Adding an enum value is a new minor version until ADR 0140 lands, and an in-place change after it.
- **Builder visibility of withheld integration scenarios.** A `holdout:true` unit tiered `integration` already exists under FAFF-961. This ticket records it in `delegated[]` and leaves the rest unchanged.
- **A gating judged-count check in `faff admissible`.** Admissibility gating stays as it is. The new counts are advisory only.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| judged set | The criteria with `verification_tier: running-stack`. The evaluator exercises these, they appear in the record's `criteria`, and the aggregate is derived from them. |
| delegated criterion | A criterion with `verification_tier` `delegated` or `integration`. It leaves the judged set and is listed in `delegated[]` with its verifier. |
| `delegated` tier | The new `verification_tier` value for a DONE-sourced prose criterion. Its verifier is the AC checklist. |
| verifier | The string naming who checks a criterion: `holdout`, `ac-checklist` or `review-merge-floor`. |
| judged count | The size of the judged set: every `running-stack` criterion, prose Scenarios units included. |

### Classifier output (additive)

```
RECORD ClassifiedCriterion (existing fields unchanged: id, text, class, source, holdout, oracle_less, local_ac_id?, ac_id?):
  verification_tier: ENUM { running-stack, integration, delegated }   # third value is new
  verifier: ENUM { holdout, review-merge-floor, ac-checklist }         # new; a pure function of verification_tier

RECORD ClassifyResult (existing fields unchanged):
  verification_tier_counts: { running-stack, integration, delegated }  # still sums to criteria.length
  judged_count: Int      # running-stack, any class (the judged set)
  integration_count: Int # tier integration
  delegated_count: Int   # tier in {integration, delegated}
```

Tier and verifier always pair as follows: `running-stack` with `holdout`, `integration` with `review-merge-floor`, and `delegated` with `ac-checklist`.

**Tier choice: a new tier value, not "prose means delegated", and not folding `integration` into it.**
- A new value keeps one partition key for every consumer and mirrors FAFF-961.
- Inferring "prose means delegated" in each consumer would give the evaluator two partition keys, tier and class. It would also leave no per-row verifier, and the ticket asks for one.
- Folding `integration` into a single `delegated` tier would break FAFF-961's shipped contract and merge two different guarantees.

**Chosen:** a third `verification_tier` value `delegated` plus a per-criterion `verifier` field, with `integration` kept unchanged.

### Which prose criteria are delegated

```
PROCEDURE resolve_tier(criterion, marker_tier):
  1. IF marker_tier                                   -> marker_tier            # explicit integration fence/prefix
  2. IF class == prose AND source == done             -> delegated               # prose DONE: the AC checklist covers it
  3. IF text hits INTEGRATION_TIER_MARKERS            -> integration
  4. ELSE                                             -> running-stack
```

**Delegation scope: DONE-sourced prose only, or Scenarios prose too.** The AC checklist is built from the DONE `done` criteria, each with an `ac_id` (graft Step 8, "Source"). No verifier receives a Scenarios unit by id. A withheld Scenarios unit is hidden from the builder, so neither the builder's tests nor the AC checklist cover it. Delegating Scenarios prose would therefore be fail-open. Before this change a prose Scenarios unit ends `needs-human`, and that stays true.

**Chosen:** only DONE-sourced prose is delegated. A prose Scenarios unit, withheld or visible, stays `running-stack`. The evaluator records it `needs-human` with reason `prose scenario: no machine check and no delegate verifier`, so it holds the aggregate at `needs-human`. FAFF-1293 later refuses such units at spec review.

### Holdout record shape (additive)

Add one optional top-level property to `holdout-anchored.schema.json`. `required` is unchanged and `schema_version` stays 1.

```
RECORD DelegatedRow:                                # closed object, all keys required
  id: String              # pattern ^(scenarios|done):[1-9][0-9]*$ (same as criteria[].id)
  text: String
  holdout: Boolean
  verification_tier: ENUM { delegated, integration }
  verifier: ENUM { ac-checklist, review-merge-floor }
  ac_id: String | null    # the qualified ac_id for a done row when the record's issue is an issue id; else null

holdout.json.delegated: Array<DelegatedRow>          # optional in the schema; the writer always emits it (possibly [])
```

The new subschema may use only keywords that `classifySchemaChange` accepts as additive: `type`, `enum`, `pattern`, `required`, `properties`, `additionalProperties: false` and `items`. It may not use `maxLength`, `oneOf` or any other keyword outside `SUBSET_KEYWORDS`.

**Where delegated rows live.** There were three options:
- The prose evidence report, as for `integration` rows today. This is unsigned, outside the anchor and unvalidated, and it relies on the LLM remembering every row.
- Extra rows in `criteria[]` with a new verdict. This widens an enum, which is not additive, and it breaks the rule that `criteria` is exactly the judged set.
- A separate optional `delegated[]`. `classifySchemaChange` classes this as additive, legacy anchors still validate, and the aggregate code does not change.

**Chosen:** a separate, closed, optional top-level `delegated[]` in `holdout.json`. The writer fills it from classify output. The evaluator does not fill it. `holdout-verdict.schema.json` gains the same optional `delegated` array, and `contractData` carries it only when the input does, following the `spawner_attested` precedent.

**Integration rows in `delegated[]`.** Listing them makes FAFF-961's handoff visible in the anchored record, where today it exists only in the prose report. It also lets the completeness rule below cover every criterion id. It is visibility, not enforcement: nothing checks that the review test floor covered an `integration` row, exactly as today.

**Chosen:** the writer lists `integration` rows in `delegated[]` too, with verifier `review-merge-floor`.

### Validator rules

Add a pure function, `delegationViolations(doc)`, in `holdout-record.js` (region governance). It is the only home for these rules. `computeHoldoutVerdict` calls it on the raw input block (`extraction`), before the block is mapped to `contractData`, which is a legal factory-to-governance require. The raw block already carries `criteria[].id` (required by `holdout-anchored.schema.json`), so the id rules need no change to the `criteria` items of `holdout-verdict.schema.json`, which validates only the mapped `contractData`: `computeHoldoutVerdict` maps each criterion to `class`, `verdict` and `evidence_present`, so `id` never reaches that schema and is not added to it. `holdoutRecordViolations` also calls it, and after FAFF-1261 so does `holdoutConstraintViolations`. The rules are:

- A `criteria[]` row with `class: prose` and an id of the form `done:N` is a violation: `criteria[i] is a delegated prose DONE criterion and must not be judged`.
- A `criteria[]` row with `class: prose` and a `scenarios:N` id, or with no id (legacy), must still be `needs-human`. This is the existing ADR-0029 rule, kept.
- When `delegated` is present, every row must match `DelegatedRow`. The tier must pair with its verifier as defined above. A row with tier `delegated` must have a `done:N` id. No id may appear in both `criteria` and `delegated`, and no id may appear twice in either list.

**Prose rule shape.** One option rejects every prose row in `criteria`. That would turn a legacy needs-human row and a prose Scenarios unit into `contract-rejected`. Both outcomes already block the merge, so the change would only make the reasons less clear. The other option rejects only DONE prose, which is exactly the set this ticket delegates.

**Chosen:** reject `done:N` prose in `criteria`, and keep `needs-human` mandatory for other prose. This narrows the issue's wording, "the validator rejects a prose criterion in the judged set", to the prose that has a delegate. Undelegable prose still cannot pass.

### Writer completeness (needs classify output)

`buildHoldoutRecord(block, opts)` gains `opts.classified`, which is `dodClassify` output over the same full-view spec text the evaluator received. `holdout-record.js` is in the governance region and must not require `admissibility.js`, which is factory. Each caller therefore computes `classified` and passes it in:

- `cmdHoldoutRecord` gains a required `--spec <path>` (a file path; `-` is refused with exit 2, because the evaluator block already arrives on stdin). It calls `dodClassify(specText, { issue })` and passes `issue` only when `--issue` matches the issue-id grammar. The per-run phase passes a run key, so `ac_id` is null there.
- `evaluate-call.mjs` classifies the `--spec` text it already reads.

```
PROCEDURE complete_against_classify(redacted_doc, classified):
  1. judged_ids    := ids of classified.criteria with verification_tier == running-stack
  2. delegated     := classified.criteria with tier in {delegated, integration}, in classify order,
                      mapped to DelegatedRow (ac_id from the criterion or null)
  3. IF set(ids of redacted_doc.criteria) != set(judged_ids):
       refuse "criteria ids do not match the judged set from faff dod classify: missing [...], unexpected [...]"
  4. redacted_doc.delegated := redact_and_truncate(delegated)   # writer-owned, never copied from the block;
                                                                  # same redactKnownSecrets + MAX_DETAIL as criteria detail
  5. run delegationViolations(redacted_doc) with the other writer rules; any finding -> refuse
```

A refusal goes through the existing `failClosed` path: `needs-human`, `criteria: []` and the refusal in `violations`. When classify succeeded, the fail-closed record still carries the classify-derived `delegated[]`, so a refused run keeps its delegation listing. Only a refusal before classify output exists (no `--spec`, unreadable spec) writes `delegated: []`. A block whose `criteria` rows carry no `id` cannot be matched against classify and is refused. The writer still never recomputes `aggregate`, `verdict` or `evidence_present`.

**Where completeness is checked.** The options are the writer with classify input, the contract, or nothing. The contract and `validateAnchorDir` do not have the spec, so they can enforce only the structural rules. The writer has the spec at both call sites. Making `--spec` optional would leave a fail-open path where the record is written without a delegated listing.

**Chosen:** completeness against classify lives in `buildHoldoutRecord`, and `--spec` is required on `faff holdout record`. A missing `--spec` exits 2 with a usage error.

**Which spec `--spec` names.** On the caged path, `evaluate-call.mjs` classifies the very text it spawned the evaluator with, so the binding is mechanical. On the inline path, the caller in the build lane already supplies the whole block and its claim to be code-blind; the `requireSpawnerAttested` ratchet is the defence there, unchanged.

**Chosen:** `holdout_step` (beep-boop) and graft Step 8c pass `--spec` the same full-view spec path they passed to the evaluator, never a separate copy. The inline path stays at today's rung-0 trust: this ticket adds no new trust to it and claims none.

### Counts in graft and `faff admissible`

**Report judged and delegated counts separately?** The current `born_verifiable_count` includes `integration` rows. An integration-only spec therefore still runs a holdout that judges nothing and ends `needs-human`. Both graft and `faff admissible` need the same derivation.

**Chosen:** classify emits `judged_count`, `integration_count` and `delegated_count`.
- Graft Step 6 and Step 8c skip the holdout only when `judged_count == 0` and `integration_count == 0`. Step 8c still reads the live classify result, never the marker.
- The `holdout-offer.json` marker replaces `born_verifiable_count` with `judged_count`, `integration_count` and `delegated_count`. The invariant becomes `judged_count == 0 AND integration_count == 0 ⇒ skip`. Only graft's SKILL.md reads the marker.

**The skip rule.** Two cases need care.
- **All-prose Scenarios.** Today graft counts only scenarios and assertions, so a spec whose Scenarios are all prose skips the holdout, and an absent holdout passes the merge floor. Counting the whole judged set means such a spec now runs, and its prose units fail closed to `needs-human`, which is what this spec claims for them.
- **Integration-only.** Today a spec whose only checkable criteria are `integration` runs a holdout that judges nothing and ends `needs-human`. Skipping it would let a spec drop out of the holdout by phrasing every check with an integration keyword, and an absent holdout passes the floor. Keeping it running leaves FAFF-961's behaviour exactly as it is.

**Chosen:** skip only when nothing is judged and nothing is `integration`. This ticket neither loosens integration-only specs nor lets a prose Scenarios unit avoid its fail-closed outcome.
- `faff admissible` keeps the `prose-DONE advisory: N DONE item(s)` prefix. The rest of the line is reworded to say the items are delegated to the AC checklist and not judged by the holdout, and to give the judged count. It never gates.

### Documentation of the changed meaning

After this change, `meets-spec` means every criterion in the judged set was met. It no longer means the whole DoD was met. The merge floor reads only the aggregate, so the rest of the DoD now relies on the AC-checklist and review legs. The following text is updated to say this:
- the `--describe` semantics for `aggregate` and `criteria[].class`;
- the `holdout-verdict.schema.json` description;
- the GLOSSARY `born-verifiable` row, plus a new `delegated` row;
- `evidence-documents.md`, both copies;
- the graft Step 10 holdout-gate text.

### The trust shift for delegated prose items

Today a prose DONE item forces the holdout to `needs-human`, and the strict L4 floor blocks the merge whatever anyone does. After this change it passes on the AC-checklist leg. The builder writes `ac-checklist.json` in-lane (graft Step 8, the rung-0 posture), so a prose item now rests on the builder's own attestation plus the review leg. The checklist writer requires a test or command locator per criterion (FAFF-1287), and the review is a separate agent that sees the checklist and the diff. Neither is independent of the lane in the way the old block was.

Keeping prose as a hard block would undo the ticket: no spec with prose DONE items could ever reach `meets-spec`.

**Chosen:** accept the shift and state it. The `--describe` text, `evidence-documents.md` and graft Step 10 say that delegated prose rests on the builder-written AC checklist and the review leg. Two follow-ups apply. [FAFF-1339](https://linear.app/shftwst/issue/FAFF-1339) checks every delegated `ac_id` has a passed checklist row; that adds completeness, not independence, since both files are builder-written. Only moving the checklist write to the trusted side narrows the shift. The docs say this, and do not present FAFF-1339 as narrowing it. The product owner chose this on 2026-10-17.

## 4. HOW

### Flow

1. `faff dod classify` tiers each criterion and emits `verifier`, `judged_count`, `integration_count` and `delegated_count`.
2. Graft Step 6 and Step 8c skip the holdout only when `judged_count == 0` and `integration_count == 0`.
3. The evaluator runs classify. It exercises the `running-stack` scenarios and assertions, records each `running-stack` prose unit as `needs-human` with the prose-scenario reason, and leaves out every `integration` and `delegated` row. It may still mention delegated rows in its prose report, but the record does not depend on that. The skill's "Force prose to needs-human" step and its example's `done:1` prose row are removed.
4. `faff holdout record --spec <full_spec>` (inline) or the spawner (caged) runs the completeness procedure, adds `delegated[]` and writes both copies.
5. `faff contract holdout-verdict` and `holdoutGateResult` run `delegationViolations` and then `deriveHoldoutAggregate` over `criteria`, unchanged.

`holdout_step` in faff-beep-boop passes `--spec` to `faff holdout record`, using the same full-view path it already resolves.

### Edge cases

- Nothing judged: when `judged_count == 0` and `integration_count == 0`, graft skips the holdout. When a holdout still runs with nothing judged (integration rows only, or the per-run phase, which has no skip), `criteria` is `[]` and the aggregate is `needs-human`, as before.
- A DONE prose item that matches an integration keyword is tiered `delegated`, not `integration`: the prose-DONE rule comes before the keyword check, because the AC checklist can verify it and the review test floor cannot decide prose. An explicit integration fence or prefix still wins.
- A spec with no authored `[ac-N]` ids: `ac_id` falls back to the positional id `issue#done:N`, which is what `qualifyAcId` already accepts.
- An evaluator that still emits a DONE prose row produces a writer refusal: a fail-closed `needs-human` record that names the id. A run that previously ended `needs-human` still ends `needs-human`, so this is not a regression.
- Legacy records without ids, and records without `delegated`, validate as before.

### Sequencing against PR #1086 (FAFF-1261)

PR #1086 waits on FAFF-1270, and FAFF-1270 is blocked by this ticket. The expected order is therefore this ticket first.

**Chosen:** two PRs, in this order, whichever way #1086 lands. Splitting on behaviour instead would fail open: a classifier that tiers `delegated` before the writer emits `delegated[]` drops criteria with no record.
- **PR A (schema) is [FAFF-1342](https://linear.app/shftwst/issue/FAFF-1342).** The additive `delegated` property in both schema copies, the example, `evidence-documents.md` (both copies) and the dated v0.3 changelog entry, split into its own ticket by the product owner on 2026-10-18 so each PR closes its own ticket and carries its own evidence. Low risk; it changes no behaviour.
- **PR B (behaviour), this ticket.** Classifier, writer, contract, evaluator, spawner, graft, beep-boop, `faff admissible`, the remaining docs and the eval oracles. If #1086 is on `main`, PR B calls `delegationViolations` from `holdoutConstraintViolations` and rebases on #1086's split. If not, #1086 rebases onto PR B and makes that call, and PR B's description says so.
- **Before PR B opens**, run the re-classification check on the four committed holdouts (see the failure modes and DONE) and record its result.

### Failure modes

- **The classifier tiers an observable DONE item as prose.** Example: FAFF-1279 `done:4`, "`isFixturePath` matches ...". The item leaves code-blind judgement but keeps AC-checklist verification, which requires a test or command per AC (graft Step 8). How to notice: after the change, re-classify the four committed anchor specs and compare `judged_count` with the scenario and assertion rows those runs judged. The numbers must be equal, because no scenario or assertion row moves. What it means: the change narrows the holdout to what it already decided. Authors who want code-blind coverage phrase the item with `Then` or `must`. No new heuristic is added: `hasObservableOracle` defaults to true, and on FAFF-1279's 23 prose rows it would flag almost every one.
- **The AC checklist omits a DONE item.** The delegated item would then have no verifier in practice. How to notice: a `delegated[].ac_id` with no matching row in `ac-checklist.json`. This ticket does not check for it mechanically (see Out of scope). What it means: proceed, and file the governance-check cross-check if real anchors show any gap.
- **The fix does not move real runs.** FAFF-1279 would still end `needs-human` after this ticket alone. `done:3` is an assertion with no surface (FAFF-1292), and `scenarios:4` is a prose Scenarios unit (FAFF-1293). Its 22 prose DONE rows move to `delegated[]`, but the aggregate is unchanged. What it means: this is expected, so the acceptance fixtures must avoid both defects. A real run reaches `meets-spec` only once FAFF-1292 and FAFF-1293 land, or on a spec without those defects.

**Anti-pattern:** letting the evaluator emit `delegated[]` and having the writer trust it. Why: an LLM that drops a row would produce a clean record, which is the fail-open path FAFF-962 rejected.

**Anti-pattern:** adding `delegated` to the `class` or `verdict` enums. Why: `classifySchemaChange` classes an enum change as non-additive, and every consumer that switches on the three classes would break.

**Mis-tiering.** **Chosen:** no new mis-tier heuristic in this slice. The classifier rule stays shape-based, and the reworded advisory tells authors how to keep an item judged.

### Real-run expectations

| Anchor | Judged before (scenario/assertion) | Judged after | Delegated after | Aggregate after this ticket alone |
|---|---|---|---|---|
| FAFF-1279 | 4 | 4 + 1 prose scenario | 22 | `needs-human` (`done:3`, `scenarios:4`) |

## Scenarios

```
Given a spec whose Scenarios hold two scenario units and whose DONE holds one assertion and three prose items
When the evaluator meets all three born-verifiable criteria and the block is written with faff holdout record --spec
Then holdout.json has aggregate meets-spec, three criteria rows, and three delegated rows each with verifier ac-checklist and an ac_id
```

```
Given a spec whose Scenarios hold one scenario unit and a When-only unit with no Then
When the evaluator meets the scenario and records the When-only unit needs-human
Then the aggregate is needs-human and the When-only unit is in criteria, not in delegated
```

```
Given an evaluator block that still carries a done:2 prose row with verdict needs-human
When it is written with faff holdout record --spec
Then the record is the fail-closed needs-human record and its violations name done:2
```

```
Given an evaluator block that omits the running-stack criterion scenarios:2
When it is written with faff holdout record --spec
Then the record is refused fail-closed and its violation lists scenarios:2 as missing
```

- `classifySchemaChange(base, head)` over the `holdout-anchored` schema before and after this change must return `additive: true`.

## 5. Design decision rationale

- **New tier value or inferred delegation?** Options: a new `delegated` tier, inferring delegation from `class`, or folding `integration` into one tier. **Chosen:** new `delegated` tier plus `verifier`. It gives one partition key and a per-row verifier, and it leaves FAFF-961 unchanged.
- **Which prose is delegable?** Options: all prose, DONE prose plus visible Scenarios prose that DONE mirrors, or DONE prose only. **Chosen:** DONE prose only, because it is the only prose with a verifier that receives it by id. "Mirrors" cannot be decided mechanically.
- **Where delegated rows live?** Options: the evidence report, extra `criteria` rows with a new verdict, or a separate `delegated[]`. **Chosen:** a separate `delegated[]`. It is additive, it sits in the anchored and validated record, and the aggregate code does not change.
- **Include integration rows?** **Chosen:** yes. Completeness then covers every id, and FAFF-961 rows become durable.
- **Prose rule shape?** **Chosen:** reject `done:N` prose and keep `needs-human` for other prose, so legacy and undelegable outcomes do not churn.
- **Completeness home?** **Chosen:** the writer, with `--spec` required. Only the writer has the spec at both call sites, and making it optional would leave a fail-open path.
- **Counts?** **Chosen:** `judged_count`, `integration_count` and `delegated_count` come from classify, the graft skip needs both of the first two at zero, and the admissible advisory stays non-gating.
- **Prose DONE with an integration keyword?** **Chosen:** tier it `delegated`, so its verifier is one that can decide it and FAFF-1339 covers it.
- **Redaction of `delegated[]`?** **Chosen:** the writer applies the same secret redaction and detail truncation to `delegated[].text` as to criteria detail, on the success and fail-closed paths.
- **Order against #1086?** **Chosen:** always two PRs, schema then behaviour; whichever of PR B and #1086 lands second makes `holdoutConstraintViolations` call `delegationViolations`.
- **Trust shift for prose DONE?** **Chosen:** accept and state it, with FAFF-1339 and a trusted-side checklist write as follow-ups. Keeping the hard block would undo the ticket.
- **Which spec `--spec` names?** **Chosen:** the same full-view path the evaluator received; inline trust stays at rung-0.
- **The `.ts` acceptance item?** None of the files this ticket touches has a `.ts` source. `contract-defs`, `admissibility`, `holdout-record`, `evidence`, `merge-gate` and `governance-check` are plain `.js`. **Chosen:** keep the item as a conditional DONE check rather than drop it. It costs nothing and covers a build that drifts into a `.ts` module.
- **Mis-tier mitigation?** **Chosen:** no new heuristic (see the failure modes in section 4).

## 6. Open questions and assumptions

**Open questions:** none.

**Assumptions**

- **Assumes:** graft Step 8 builds `ac-checklist.json` from every `done` criterion of `faff dod classify --spec <spec> --issue <ISSUE> --json`, with its `ac_id`, and the merge floor blocks when `all_verified` is false. Validation: read `plugin/skills/faff-graft/SKILL.md` Step 8 ("Source") and `governance-check.js` `evaluateMergeFloorLeg` before starting. If either has changed, stop and report, because delegation is sound only while this holds.

## Already shipped against this surface

- **FAFF-961** (#811, `47c11406`) is related and not superseded. It added `verification_tier` with `running-stack` and `integration`, and the evaluator's prompt-only handoff of `integration` rows to the review and merge test floor. This ticket reuses that axis, adds a third value and makes the handoff durable in `delegated[]`.
- **FAFF-304** (#233, `472a626c`) is related and not superseded. It added the non-gating prose-DONE advisory to `faff admissible`. This ticket rewords its text, which currently says prose will be forced to `needs-human`, and keeps its prefix and duplicate detection.
- **FAFF-1259** (#1054, `e1b6f4c7`) is related and not superseded. It added the per-criterion `id`, the `holdout-anchored` record and its writer. This ticket adds `delegated[]` beside `criteria` and uses those ids for the completeness check.

## 7. DONE

### From WHY
- [ ] [ac-1] A fixture spec with two passing scenario units, one passing DONE assertion and three prose DONE items, evaluated through `faff holdout record --spec`, produces `holdout.json` with `aggregate: meets-spec`. `faff contract holdout-verdict` exits 0 on it.
- [ ] [ac-2] The spec cannot reach `meets-spec` under the FAFF-1292 and FAFF-1293 defects. A test re-classifies a fixture modelled on the FAFF-1279 shape (one no-surface assertion, one When-only Scenarios unit, 22 prose DONE items) and asserts 22 delegated rows and a `needs-human` aggregate.

### From WHAT (classifier)
- [ ] [ac-3] `faff dod classify --json` tiers a DONE prose item `delegated` with `verifier: ac-checklist`. It tiers a Scenarios prose unit `running-stack` with `verifier: holdout`. It tiers a DONE assertion containing "rollback" (for example "the rollback must restore the previous release") `integration` with `verifier: review-merge-floor`.
- [ ] [ac-4] `verification_tier_counts` has keys `running-stack`, `integration` and `delegated` that sum to `criteria.length`. `judged_count` equals the running-stack criteria, prose Scenarios units included, and `integration_count` equals the integration rows. `delegated_count` equals the integration plus delegated rows. `test/dod.test.mjs` asserts all three tier values.
- [ ] [ac-5] `class` still takes only `scenario`, `assertion` or `prose` on every criterion in the existing dod tests.

### From WHAT (record and schema)
- [ ] [ac-9] Every delegated row in a written record has `id`, `text`, `holdout`, `verification_tier`, `verifier` and `ac_id`. A done row written with `--issue FAFF-1` has `ac_id` `faff-1#ac-N` or `faff-1#done:N`. A record written with a run key as `--issue` has `ac_id: null` on every row and does not throw. A fixture with a DONE assertion tiered `integration` writes that row in `delegated[]` with verifier `review-merge-floor`. `faff holdout record --spec -` exits 2.

### From WHAT (validator)
- [ ] [ac-10] `faff contract holdout-verdict` exits 1 on a block whose `criteria` holds a `class: prose` row with id `done:2`, and the violation names `criteria[i]`.
- [ ] [ac-11] `faff contract holdout-verdict` exits 0 on a conformant block whose `criteria` holds a `scenarios:N` prose row with `needs-human`. It exits 1 if that row is `met`.
- [ ] [ac-12] `faff contract holdout-verdict` exits 1 when an id appears in both `criteria` and `delegated`, when a `delegated` row pairs `delegated` with `review-merge-floor`, or when a `delegated`-tier row has a `scenarios:N` id.
- [ ] [ac-13] A block with `criteria: []` and a non-empty `delegated` derives `aggregate: needs-human`, and `holdoutGateResult` returns `block`.
- [ ] [ac-14] `delegationViolations` is exported from `holdout-record.js`, and both `computeHoldoutVerdict` and `holdoutRecordViolations` call it. `faff regions check` passes.

### From HOW (writer)
- [ ] [ac-15] `faff holdout record` without `--spec` exits 2 with a usage message and writes no file.
- [ ] [ac-16] The writer refuses a block that omits a running-stack id, includes a delegated id, or includes an id classify did not mint. It writes the fail-closed `needs-human` record whose violations name the ids, and exits 1.
- [ ] [ac-17] The writer's `delegated[]` comes from classify. A block that carries its own `delegated` key gets the classify-derived list, not the block's. A test covers this.
- [ ] [ac-18] `evaluate-call.mjs` writes records with `delegated[]` derived from its `--spec` text, and its selftest covers one delegated row.

### From HOW (prompts and docs)
- [ ] [ac-19] `faffter-noon-evaluate/SKILL.md` partitions on `verification_tier`. It records running-stack prose as `needs-human` with reason `prose scenario: no machine check and no delegate verifier`. It leaves `delegated` and `integration` rows out of `criteria`, and the example block has no `done:N` prose row. `faff validate-adapters` passes.
- [ ] [ac-20] `faff-graft/SKILL.md` Step 6 and Step 8c skip only when `judged_count == 0` and `integration_count == 0`, and the marker lists `judged_count`, `integration_count` and `delegated_count` in place of `born_verifiable_count`. `faff-beep-boop/SKILL.md` `holdout_step` passes `--spec` to `faff holdout record`. `faff validate-adapters` passes within the line baselines.
- [ ] [ac-21] `faff admissible` on a spec with prose DONE items prints a warning starting `prose-DONE advisory: N DONE item(s)` that names the AC checklist and the judged count, and does not contain `forced to needs-human`. A spec whose DONE items are all prose and whose `judged_count` is 0 gets an extra advisory line saying nothing in DONE will be judged code-blind. Its exit code is unchanged (`test/admissible.test.mjs`).
- [ ] [ac-22] `faff contract holdout-verdict --describe` says `meets-spec` means every judged criterion was met and that delegated criteria rely on the AC-checklist and review legs. GLOSSARY has a `delegated` row and an updated `born-verifiable` row. `test/contract-describe.test.mjs` and `test/contract-golden.test.mjs` pass with updated fixtures.

### From HOW (sequencing and build hygiene)
- [ ] [ac-24] FAFF-1342 (the schema change) is merged to `main` before this ticket's PR opens, and whichever of this PR and #1086 merges second makes `holdoutConstraintViolations` call `delegationViolations`.
- [ ] [ac-25] `git diff --name-only main...HEAD` lists no `bin/lib/*.ts` file. If one is listed, its `.js` emit and `build-manifest.json` are in the same commit, and `faff regions check` exits 0.

- [ ] [ac-27] A test re-classifies the committed specs of the four anchors that carry `holdout.json` (FAFF-1197, FAFF-1198, FAFF-1201, FAFF-1279) and asserts, per anchor: for FAFF-1279, whose rows carry ids, every id the record judged as `scenario` or `assertion` is still in the judged set and every id that moved to `delegated` is a `done:N` prose row; for FAFF-1197, FAFF-1198 and FAFF-1201, whose rows carry no ids, the re-classified count of `running-stack` scenarios and assertions is at least the record's count of `scenario` and `assertion` rows.
- [ ] [ac-28] A refused record whose classify step succeeded carries the classify-derived `delegated[]`; a block whose `criteria` rows lack `id` is refused fail-closed. Tests cover both.
- [ ] [ac-29] `--describe`, both `evidence-documents.md` copies and graft Step 10 say that delegated prose DONE items rest on the builder-written AC checklist and the review leg, and name FAFF-1339.

- [ ] [ac-30] A spec whose Scenarios are all prose and whose DONE is all prose is not skipped by graft: classify reports `judged_count > 0`, and the holdout aggregate is `needs-human`. A spec whose only checkable DONE items are tiered `integration` is not skipped either. A DONE prose item containing "rollback" is tiered `delegated` with verifier `ac-checklist`.
- [ ] [ac-31] A delegated row whose DONE text contains a known secret is written redacted, and a row longer than the writer's detail limit is truncated, on both the success and the fail-closed paths.

### Eval coverage
- [ ] [ac-26] The `holdout` eval cases (`eval/cases/holdout-001.json`, `-002`) and `holdout-live` oracles are updated. A DONE-sourced prose criterion is absent from the judged closed set, and a Scenarios-sourced prose criterion stays `:needs-human`. `test/eval-holdout-live.test.mjs` asserts the new rule, and `eval/seam-registry.json` still lists `holdout`, `holdout-exercise` and `holdout-live`. Recording a new baseline is a separate human-supervised step and is not part of this item.

### Integration smoke test

```
PROCEDURE smoke():
  1. spec := fixture with Scenarios {scenario A, scenario B} and DONE {[ac-1] "<x> must return 200", [ac-2] prose, [ac-3] prose}
  2. classify := faff dod classify --spec spec --issue FAFF-1 --json
     ASSERT classify.judged_count == 3 AND classify.delegated_count == 2
  3. block := { aggregate: meets-spec, code_blind: true, violations: [],
                criteria: [scenarios:1 met, scenarios:2 met, done:1 met] with exercised/expected/observed }
  4. echo block | faff holdout record --issue FAFF-1 --spec spec   -> exit 0
  5. doc := .faff/holdout/FAFF-1.json
     ASSERT doc.aggregate == meets-spec
     ASSERT doc.delegated == [done:2, done:3] each {verification_tier: delegated, verifier: ac-checklist, ac_id: faff-1#ac-2|ac-3}
  6. faff contract holdout-verdict < doc   -> exit 0
  7. faff evidence validate on an anchor dir holding doc   -> no holdout findings
```

Revised on 2026-10-18 after 3 spec-review rounds. Split on 2026-10-18: the schema slice and its criteria ac-6, ac-7, ac-8 and ac-23 moved to FAFF-1342; their ids are not reused. The product owner raised the rating from medium to high: the writer's downgrade reason (3 self-review majors) was resolved and no Punt is open.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round 3 minors fixed in place, not re-reviewed)
