# FAFF-1424: A clean custody verdict is classified malformed because the contract field list lacks faff_version

> Spec: faffter-dark-nlspec · 2026-10-28 · interactive · claude-code/unknown · faff 0.43.0 · confidence: high. Full spec on Linear FAFF-1424.

## 1. WHY

FAFF-1395 made every writer stamp the release that wrote its record. The custody-verdict writer (`integrity-digest verify --record-result`, `integrity-digest.js`) now writes `faff_version` as the record's second key. The custody-verdict contract's closed key list, `CUSTODY_VERDICT_FIELDS` in `contract-defs-evidence.js`, was not updated. So:

- `computeCustodyVerdict` reports `unexpected field "faff_version"`.
- `classifyCustodyVerdictBytes` classifies every new verdict, clean ones included, as `malformed`.
- `computeCustodyVerdictAdmission` refuses it, so `faff merge-gate` refuses every merge that needs a custody verdict.
- `faff disposition` reports every such issue as `custody-non-clean` / `malformed-present`.

This is live: FAFF-1395 shipped in `faff--v0.44.0`. Reproduced on `origin/main` at `278cbe75`: a verdict the real writer just produced makes `faff disposition` report `custody-non-clean`, and the same file with `faff_version` removed reports `clean`. PRs #1146, #1147 and #1149 were held this way and merged by hand.

No test caught it. The writer round-trip test (`test/faff-893-custody-stamp.test.mjs`) checks the classification `verify` prints, never the persisted bytes through the reader, and says so. The merge-gate tests build verdicts by hand without `faff_version`, although their comments describe them as what the writer produces.

### Design principles

- **Admit exactly one key.** The closed list exists to keep authorship and actor fields out of a structural-trust record. The fix adds `faff_version` and nothing else.
- **Old verdicts stay valid.** A verdict written before FAFF-1395 has no `faff_version`, and stays `clean`.
- **Writer and reader are tested together.** A test drives the real writer and feeds its bytes to the real reader, so the two cannot drift again.

### Reference context

| Path | Role |
|---|---|
| `plugin/skills/faff/bin/lib/contract-defs-evidence.js` | `CUSTODY_VERDICT_FIELDS`, `computeCustodyVerdict`, `classifyCustodyVerdictBytes`, `computeCustodyVerdictAdmission` |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | the only custody-verdict writer; stamps `faff_version: resolveFaffVersion().version` |
| `plugin/skills/faff/bin/lib/merge-gate-floor.js` | admits the verdict at merge time through `computeCustodyVerdictAdmission` |
| `plugin/skills/faff/bin/lib/disposition.js` | `readCustodyMap` classifies each admitted issue's verdict |
| `plugin/skills/faff/bin/lib/faff-version.js` | `resolveFaffVersion`; returns a release string, or `"unknown"` when unresolved |
| `test/custody-verdict.test.mjs`, `test/faff-893-custody-stamp.test.mjs` | contract unit tests; writer round-trip |
| `test/faff-895-pr-custody-basis.test.mjs`, `test/merge-gate-controlflow.test.mjs` | merge-gate tests with a hand-built `writeCustodyVerdict` helper |

**Sibling check (done at prep).** Every FAFF-1395 stamp site was checked against its reader:

- The JS closed key lists under `bin/lib` were searched; `CUSTODY_VERDICT_FIELDS` is the only one that validates a stamped record.
- The stamped anchored documents (run ledger, build and landing progress, holdout, review and spec-review verdicts, run-start event) already list `faff_version` in their v0.3 schemas.
- The intake marker, merge record, judge trail and spec-commit record have no closed-key reader.
- No JSON schema exists for the custody verdict, although a comment in `contract-defs-evidence.js` says one does.

### Already shipped against this surface

- FAFF-1395 (Done): introduced the stamp. This ticket completes it for the custody verdict; the premise still holds.
- FAFF-784, FAFF-892, FAFF-893 (Done): the custody verdict, its merge-floor admission and the interactive stamp. Unchanged here.

## 2. OUT OF SCOPE

- Any change to the writer, the record's other fields, the digest binding or `schema_version`.
- Opening the key list in general, or a second provenance key.
- Cutting a patch release. That is the operator's call once this merges.
- Re-checking verdicts already written and refused; a re-run of `verify --record-result` after upgrade produces an admissible one.

## 3. WHAT

### The custody verdict, after the fix

| Key | Required | Rule |
|---|---|---|
| `schema_version` | yes | `1` (unchanged) |
| `faff_version` | **no** | when present, a string matching `^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$` |
| `run_id`, `issue`, `classification`, `paths`, `detail`, `verified_at`, `merge_state_at_verification` | as today | unchanged |
| any other key | never | violation, as today |

`computeCustodyVerdict`'s returned `contractData` keeps its current shape. `faff_version` is checked, not surfaced: no consumer reads it, and the verdict bytes are already sha256-pinned as evidence.

## 4. HOW

### 4.1 The contract

```
CUSTODY_VERDICT_FIELDS := today's eight keys + "faff_version"
FAFF_VERSION_RE        := /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/

computeCustodyVerdict(extraction):
  unchanged, plus:
  IF "faff_version" is an own key of extraction:
     IF typeof value != "string" OR NOT FAFF_VERSION_RE.test(value):
        violations.push("faff_version must be a release string (letters, digits, '.', '+', '-'; at most 64 characters)")
```

**Chosen:** add exactly `faff_version` to `CUSTODY_VERDICT_FIELDS`. The list's purpose is to refuse authorship and actor keys; a release string is writer provenance, not identity, and every other key stays refused.

**Chosen:** `faff_version` is optional. Verdicts written before FAFF-1395 (v0.43.0 and earlier, still on disk in run directories and recovery bundles) carry no stamp and must stay `clean`.

**Chosen:** a present `faff_version` must match `FAFF_VERSION_RE`. It admits every value `resolveFaffVersion` produces (a semver such as `0.44.0`, a prerelease or build suffix, and `"unknown"`) and refuses non-strings, empty strings, whitespace, control characters and anything over 64 characters. The record carries no free text in this key.

**Chosen:** `schema_version` stays `1`. The change is additive and optional; bumping it would refuse every verdict v0.44.0 writers already produced with `schema_version: 1`.

**Chosen:** `contractData` keeps its shape. Adding a field would change the return every caller and test compares against, for a value nothing reads.

**Chosen:** correct the stale comment above `CUSTODY_VERDICT_FIELDS`: no JSON schema exists, so the key list is the only gate, and the comment names `faff_version` as the one provenance key it admits.

### 4.2 Tests (in `test/` only)

**Chosen:** all new tests go in `test/` files; no `--selftest` cases are added (AGENTS.md, "Tests live in `test/`"). If an existing `--selftest` case in `contract-defs-evidence.js` or `integrity-digest.js` needs changing, it moves to `test/` instead.

- **Writer to reader round-trip** (`test/faff-893-custody-stamp.test.mjs`): run `integrity-digest snapshot --issue` then `verify --record-result`, read the persisted bytes, and assert `classifyCustodyVerdictBytes` returns `clean` and `computeCustodyVerdictAdmission`, given the `verdict_sha256` verify printed, returns `admitted: true`.
- **Contract cases** (`test/custody-verdict.test.mjs`): with and without `faff_version` is conformant; each refused `faff_version` form is a violation; an authorship key next to a valid `faff_version` is still a violation.
- **Fixture helpers** (`test/faff-895-pr-custody-basis.test.mjs`, `test/merge-gate-controlflow.test.mjs`): `writeCustodyVerdict` adds `faff_version: "0.44.0"` as the second key by default, matching the real writer, so the merge-gate tests run against current bytes.

**Chosen:** the helpers default to the stamped shape, and legacy (unstamped) verdicts are covered by the contract cases. Merge-gate behaviour should be tested against what the writer produces today.

### 4.3 Edge cases

- **`faff_version: "unknown"`:** the resolver's fallback. Conformant.
- **`faff_version: null`:** not a string, so a violation. The writer never emits null.
- **Duplicate key in the JSON text:** `JSON.parse` keeps the last value, which the rule above then checks. Unchanged from today.
- **A verdict written by v0.44.0 and refused before upgrade:** its bytes are now `clean`. Its retained sha256 still matches, so a re-run of `merge-gate` admits it without a new `verify`.

### 4.4 Failure modes

- **A future writer adds another key:** refused, as today, and the round-trip test fails, which is the intended alarm.

## Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a run dir whose run-ledger.json is {"admitted":["EX-1"],"outcomes":{"EX-1":"shipped"}} and whose EX-1 dir holds ac-checklist.json
When  faff integrity-digest snapshot --run-dir <rd> --issue EX-1 runs, and its stdout is piped to faff integrity-digest verify --run-dir <rd> --manifest - --issue-context EX-1 --merge-state pre-merge --record-result <rd>/EX-1/custody-verdict.json --json
Then  verify exits 0 and <rd>/EX-1/custody-verdict.json has a faff_version key and classification "clean"
And   faff disposition --run-dir <rd> --json reports disposition "clean" with an empty attention list
```

```
Given the run dir from the scenario above, with "actor":"someone" added to custody-verdict.json
When  faff disposition --run-dir <rd> --json runs
Then  attention has one entry with kind "custody-non-clean", issue "EX-1" and cause "malformed-present"
```

```
Given the run dir from the first scenario, with faff_version removed from custody-verdict.json
When  faff disposition --run-dir <rd> --json runs
Then  it reports disposition "clean" with an empty attention list
```

## 5. DESIGN DECISION RATIONALE

- **Why not drop the stamp from the custody verdict instead?** That would undo FAFF-1395 for one record, the one most useful to date in an audit. The writer is right; the reader is stale.
- **Why not open the key list to `faff_*` keys?** It would weaken the authorship guard for a convenience no current writer needs.
- **Why validate the value at all?** An unchecked key becomes a free-text channel inside a trust record. A bounded release-string pattern costs nothing and keeps it inert.
- **Why fix the test helpers?** They are the reason the drift was invisible. A helper that claims to model the writer must match it.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

**Assumes:** `resolveFaffVersion` only ever returns a value matching `FAFF_VERSION_RE` (a release version from `plugin.json`, or `"unknown"`). The round-trip test exercises the real resolver, so a violation would fail it.

## 7. DONE

### From WHY
- [ ] A verdict produced by `integrity-digest verify --record-result` on the current tree classifies `clean` through `classifyCustodyVerdictBytes`, and is admitted by `computeCustodyVerdictAdmission` with the `verdict_sha256` verify printed.
- [ ] `faff disposition` reports no `custody-non-clean` entry for a run whose only custody verdict came from the current writer.

### From WHAT and HOW
- [ ] `CUSTODY_VERDICT_FIELDS` is today's eight keys plus `faff_version`, and no other key is added.
- [ ] A verdict without `faff_version` is conformant.
- [ ] A `faff_version` that is not a string, is empty, contains whitespace or a control character, or is longer than 64 characters is a violation.
- [ ] An authorship key such as `actor` beside a valid `faff_version` is still a violation.
- [ ] `schema_version` stays `1`, and `computeCustodyVerdict`'s `contractData` shape is unchanged.
- [ ] The comment above `CUSTODY_VERDICT_FIELDS` no longer claims a JSON schema exists, and names `faff_version` as the one provenance key admitted.

### Tests
- [ ] `test/faff-893-custody-stamp.test.mjs` round-trips the real writer's bytes through `classifyCustodyVerdictBytes` and `computeCustodyVerdictAdmission`.
- [ ] `test/custody-verdict.test.mjs` covers the stamped, unstamped, refused-value and authorship-beside-stamp cases.
- [ ] `writeCustodyVerdict` in `test/faff-895-pr-custody-basis.test.mjs` and `test/merge-gate-controlflow.test.mjs` writes `faff_version` by default, and both files pass.
- [ ] No `--selftest` case is added in any module.
- [ ] `faff gates run` passes.

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```

## Methodology critique

_Lens: faffter-dark-methodology-agile-delivery, issue-critique._

- **Right-sized (principle 4):** no issues. One key added to a closed list, one bounded value check, a comment fix and four test files. Well under a day.
- **Workstream fit (principles 1 and 5):** no issues. The title names the outcome (a clean verdict is admitted), and the fix completes FAFF-1395's stamp rather than starting new work.
- **Dependencies surfaced (principle 6):** no issues. FAFF-1395 is Done; nothing blocks this, and nothing in flight touches `CUSTODY_VERDICT_FIELDS`.
- **Risk profile (principle 7):** low technical risk, high operational cost of delay. The defect is in the released `faff--v0.44.0`, so every custody-required merge on an upgraded runner refuses until a release carries the fix. What to do: after merge, cut a patch release rather than waiting for the next scheduled one (out of scope here, named in section 2).
