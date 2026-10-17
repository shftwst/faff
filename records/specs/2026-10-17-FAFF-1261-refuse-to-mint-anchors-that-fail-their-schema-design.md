# Anchor evidence slice 6: refuse to mint anchors that fail their schema (FAFF-1261)

> Spec: faffter-dark-nlspec · 2026-10-17 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1261.

> Revised on 2026-10-14: re-grounded against FAFF-1256, FAFF-1258, FAFF-1259, FAFF-1262, FAFF-1263, FAFF-1266 and FAFF-1267 as merged, reviewed in rounds 4 to 7, then split by product-owner decision. The CI-trust half is now [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278). See Refresh notes.

> Revised on 2026-10-17: re-grounded against `main` at ed09326f (FAFF-1260, FAFF-1268, FAFF-1277, FAFF-1278, FAFF-1287, FAFF-1290, FAFF-1299, FAFF-1300 and FAFF-1302 merged), and gained the `ac_id` writer rule by product-owner decision. See Refresh notes.

This spec is for the build agent picking up FAFF-1261, the last of the FAFF-1255 slices, and for its reviewers. It is the mint-refusal half of the enforcement switch: the per-PR mint refuses a non-conforming anchor, CI is switched from `report` to `require`, v0.3 freezes, and in-flight work is drained before the switch. It also adds one writer rule: `faff evidence write ac-checklist` refuses a criterion with no `ac_id`.

## 1. WHY

**The idea the rest depends on.** By the time this ticket lands, every writer emits the canonical v0.3 shape (FAFF-1266 to FAFF-1268, FAFF-1258 to FAFF-1260, FAFF-1277), `faff evidence-readiness` (FAFF-1263) exits 0 over real runs, and [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) already judges PR anchors in CI with the base commit's code at a `report` default (merged as 4839e550). This ticket turns the warn-only mint check into a refusal: `faff events anchor` stages the anchor in a temporary directory, runs the shipped `validateAnchorDir` over exactly the bytes it is about to commit, and copies them into place only on a pass. In the same PR it flips the CI default to `require`, freezes v0.3, and makes the AC-checklist writer refuse a criterion with no `ac_id`.

**Problem.** Today the mint only warns (`warnOnEvidenceSchema` in `events.js`), so a writer regression or a hand-edited evidence file still reaches a committed anchor, and nothing stops the build before the PR opens.

**Problem (`ac_id`, product-owner decision 2026-10-17).** `faff evidence write ac-checklist` accepts a checklist whose criteria all carry `ac_id: null` (FAFF-1287 allowed "every criterion carries one, or none does"). Graft Step 8 always gets an id from `faff dod classify --issue` (at worst the positional `faff-NNNN#done:N`), so a null id means Step 8 did not run as written. FAFF-1300, FAFF-1301 and FAFF-1302 shipped anchors with every `ac_id` null, and nothing refused them.

### Design principles

- **Validate the bytes that land.** The mint validates the staged anchor, then copies those same staged bytes to `--dest`. Nothing is re-read from the run dir after validation.
- **A refused mint writes nothing.** No `--dest`, no parent directory, no change to an existing anchor at `--dest`.
- **Fail closed when the means of checking is missing.** An absent manifest or schema refuses the mint; it never reports "nothing to check".
- **Refusal output carries paths and counts, never violation text.** Same rule FAFF-1263 set for `checkAnchorDir`: the JSONL line validators echo field values in their messages.
- **The merge gate does not move.** `faff merge-gate` and the integrity and merge-floor legs keep routing exactly as today.
- **A writer rule is not a schema change.** The `ac_id` rule binds `faff evidence write ac-checklist` only. The schema still allows `null`, so every anchor already committed keeps validating; committed anchors are immutable, and [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)'s CI refuses any change to them.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/events.js` `anchor` handler (~1285-1378), `warnOnEvidenceSchema` (~1575), `mintIssueAnchor` (~1608) | JS | Mint; the warn-only call this replaces; floor-incomplete refusal this sits beside |
| `plugin/skills/faff/bin/lib/evidence.js` `validateAnchorDir` (~433), `checkAnchorDir` (~495) | JS | The validator and count-only summary the mint calls |
| `plugin/skills/faff/bin/lib/evidence.js` `acIdViolations` (~691), `acChecklistWriterViolations` (~702), `writeAcChecklist` (~722), `renderAcChecklist` (~749), `CAPABILITIES` (~1227), `USAGE` (~1229) | JS | The AC-checklist writer this ticket tightens; the renderer it leaves alone; the capability list it extends |
| `plugin/skills/faff/bin/lib/ac-id.js` | JS | FAFF-1287's qualified-id grammar (`parseAcId`) |
| `plugin/skills/faff/bin/lib/holdout-record.js` `holdoutRecordViolations` (~100) | JS | FAFF-1259's writer check; its writer-only half is reused at validation |
| `plugin/skills/faff/bin/lib/evidence-readiness.js` | JS | FAFF-1263's exit criterion; the pre-switch gate runs it |
| `.github/actions/governance-check/action.yml` | YAML | The `evidence-schema` default this ticket flips; `resolve-trusted-cli` reads `holdout-binding` from the base CLI's `validate` capability array |
| `plugin/skills/faff-graft/SKILL.md` Step 8 (AC persistence) and Step 9b ("Anchor refusal → the shared park protocol") | Markdown | Where graft writes the AC checklist and routes exit-3 refusals |
| `verification/evidence/README.md` | Markdown | v0.3 draft rule ("freezes when FAFF-1261 (enforcement) lands") |
| `verification/evidence/v0.3/README.md`, `verification/evidence/v0.3/evidence-documents.md` and their byte-identical copies under `plugin/skills/faff/contracts/evidence-v0.3/` | Markdown | v0.3 status line and the `ac_id` rule text ("every criterion carries one or none does") |
| `test/helpers/evidence-anchor-fixtures.mjs` | JS test | FAFF-1263's shared v0.3 fixture helper; extended here |
| `test/faff-1278-governance-check-base-commit-leg.test.mjs` | JS test | Pins the `report` default, the capabilities object and the `holdout binding not checked` warning; updated here |
| `test/faff-1287-ac-ids.test.mjs`, `test/evidence-write.test.mjs`, `test/evidence-review-rounds.test.mjs` | JS test | Pipe criteria without `ac_id` to the writer; updated here |

**Scope.** The mint-refusal half of the FAFF-1255 enforcement switch, plus the `ac_id` writer rule; it adds no new evidence shape and changes no gate decision other than refusing non-conforming evidence.

## Already shipped against this surface

- **FAFF-1256** (#1052): `validateAnchorDir(dir, { bundleDir, candidateDir })` returns `{status: pass|fail|legacy, files[]}` and throws `SchemaUnavailable`; `faff evidence validate` already takes `--require-evidence-schema` (legacy exits 1) and exits 2 on schema-unavailable; torn JSONL tails are skipped with `torn_tail: true`.
- **FAFF-1258** (#1055): the additive rule is built. `classifySchemaChange(base, head)` (allowlist walk; reasons name a pointer, never a value), `resolveSchemaSet` (a changed or unreadable candidate manifest falls back to base for every path; a non-additive or unloadable schema falls back per path), and `faff evidence validate --candidate-schemas <dir>`, reporting `candidate_rejected: [{path, reasons}]` and per-file `schema_source: base|candidate`.
- **FAFF-1259** (#1054): `holdoutRecordViolations(doc)` (schema plus writer-only constraints) is exported from `holdout-record.js`.
- **FAFF-1263** (#1056): `checkAnchorDir` (never throws, paths and counts only), the post-mint `warnOnEvidenceSchema`, the `report_only` `evidence_schema` leg in `evaluateAnchorDir`, `faff evidence-readiness --since <rev>`, and `test/helpers/evidence-anchor-fixtures.mjs`.
- **FAFF-1262** (#1050): `declaredEffectViolations`, already the `declared-effects.jsonl` line validator in `evidence.js`.
- **FAFF-1267** (#1053), **FAFF-1266** (#1057): spec-review-verdict writer and the `finding_id` helper; no interface this slice consumes beyond the anchored files they produce.
- **[FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)** (#1067, 4839e550): the base-commit CI leg (`evidence-schema-base`, fail-closed `verdict` output), `faff evidence capabilities --json` printing `{"validate":["require-evidence-schema","candidate-schemas"]}`, and the Action's `resolve-trusted-cli` step, which reads `holdout-binding` from that `validate` array and, under `require`, warns `holdout binding not checked: base CLI predates FAFF-1261` for an anchor holding `holdout.json`. `.github/CODEOWNERS` lists `/.github/` and `/verification/` (owners `@alechill @shftwstdev`), and `faff branch-protection-check [--branch B]` prints `code-owner review: required|not required`. The Action input `evidence-schema` defaults to `report`. Premise check: FAFF-1278 delivered nothing in this ticket's scope. The capability entry, the binding itself, the default flip and the mint refusal are all still open.
- **FAFF-1260** (#1062): closed event, effect and Commissaire payload schemas, checked at the writer. `validateAnchorDir`'s signature and `checkAnchorDir`'s summary shape are unchanged.
- **FAFF-1277** (#1061): `faff evidence write ac-checklist` and `faff evidence write review-verdict --terminal-only`, graft Step 8's writer call. FAFF-1277 is the seventh writer ticket `faff evidence-readiness` checks.
- **FAFF-1268** (#1076): `faff evidence record-review-round` writes `<run-dir>/<ISSUE>/review-rounds/round-<n>.json`, and `faff evidence write review-verdict` collates them. Round records are never anchored: `mintIssueAnchor` copies a fixed file list that does not include `review-rounds/`, and the manifest does not name them (`review-round.schema.json` is published only to pin the collator's input). They cannot cause an `unschemaed-file` refusal.
- **FAFF-1287** (#1073, ADR 0139): optional `ac_id` and `verifications` on each `ac-checklist` criterion, added to v0.3 in place as an additive change; the writer emits both, `null` when the input omits them, and refuses mixed, duplicate, malformed or mismatched ids; `faff evidence render ac-checklist` prints the PR-body block and applies the same writer checks to the written file; `faff dod classify --spec <spec> --issue <ISSUE> --json` gives every `done` criterion a qualified `ac_id`, falling back to `<ticket>#done:N`.
- **FAFF-1290** (#1070): `faff evidence-readiness` pins each writer ticket's merge commit (`WRITER_MERGES`), so the pre-switch gate's writer check is mechanical.
- **FAFF-1299, FAFF-1300, FAFF-1302** (#1074, #1079, #1080): faff's ignore rules live in `.faff/.gitignore` (`!/anchors/` keeps anchors committable), template overrides in `.faff/templates/`, and config in `.faff/config.yaml`. No path this spec uses moved: `.faff/runs/` and `.faff/anchors/` are unchanged.

## 2. OUT OF SCOPE

- **Schema checks in `anchor-run` and `bundle.js` re-mints.** Why: parent decision; those paths re-mint historic runs. `anchor-run` self-verifies with `governance-check --legacy-policy pass` and no `--require-evidence-schema`, so it is unchanged. On `main`, the `bundle.js` and `bundle-recover.js` calls to `mintIssueAnchor` are in their selftests only (`bundleSelftest`, `bundleRecoverSelftest`). Both call `mintIssueAnchor` directly, so they are unaffected either way. Extension point: the same staged-validation call in `events.js`, enabled once every source run dir carries `schema_version`.
- **CI trust: the base-commit leg, coverage and immutability checks, the fail-closed verdict, `evidence capabilities`, the array tightening, CODEOWNERS and the code-owner report.** Why: product-owner split on 2026-10-14. Extension point: [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278).
- **Writers, normalisers, payload schemas and the `outcome_details` schema fix.** Why: FAFF-1266 to FAFF-1268, FAFF-1258 to FAFF-1260, FAFF-1274 and FAFF-1277. The one writer change here is the `ac_id` rule.
- **Making `ac_id` required in the schema, or back-filling it.** Why: product-owner decision 2026-10-17 makes it a writer rule. A schema change would fail the committed FAFF-1300, FAFF-1301 and FAFF-1302 anchors, and committed anchors are immutable. Extension point: a new v0.3 minor, under the versioning rule below.
- **`faff evidence render ac-checklist` and `readAcComplete`.** Why: they read a checklist that is already written, which may predate the rule. Extension point: the write-path check below, if a reader ever needs it.
- **Provenance of evidence bytes.** Schema enforcement checks shape, not who wrote a value; a hand-stamped field that fits the schema passes. Why: the parent puts moving evidence writes to the trusted side of the dispatch cut out of scope, and no gate reads a field added under the additive rule. Extension point: the dispatcher's `EvidenceReturn` persistence; any future gate that reads a new field must bring its own provenance check.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Staged anchor | A temporary directory under `os.tmpdir()` that `mintIssueAnchor` writes into before validation |
| Anchor issue | The `issue` field of the anchor's `chain-head.json`, which the mint computes from `--issue` |

### Mint refusal

The per-PR `faff events anchor` handler keeps its order (flag checks, ledger-fold precondition, floor-incomplete), deletes `warnOnEvidenceSchema` and its post-mint call, and replaces them with a staged, validated mint. The staged anchor is summarised with `checkAnchorDir`.

| Refusal | Exit | When | Stderr line |
|---|---|---|---|
| `schema-unavailable` | 3 | `checkAnchorDir` reports `schema_unavailable: true` | `faff events anchor: schema-unavailable <reason>` |
| `schema-check-error` | 3 | `checkAnchorDir` reports `status: error` for any other fault | `faff events anchor: schema-check-error <reason>` |
| `unschemaed-file` | 3 | A staged file has status `unschemaed` | `faff events anchor: unschemaed-file <path>` |
| `schema-mismatch` | 3 | A staged file has status `fail` or `legacy` | `faff events anchor: schema-mismatch <path>: <status>, <n> violation(s)` |

`<reason>` is `checkAnchorDir`'s own `reason` (a bundled path or an error class name), never an exception message.

Two further refusals guard `--dest`:

| Refusal | Exit | When | Stderr line |
|---|---|---|---|
| `anchor-shrink` | 3 | `--dest` already holds an anchor containing a file the staged anchor lacks | `faff events anchor: anchor-shrink <path>: present in the existing anchor, absent from the staged anchor` |
| `dest-not-directory` | 2 | `--dest` exists and `lstat` shows a symlink or a non-directory | `faff events anchor: --dest is not a plain directory: <dest>` |
| `dest-not-anchor` | 2 | `--dest` exists, is not empty, and either lacks `chain-head.json` or holds any file whose relative path is not an anchor-manifest path | `faff events anchor: --dest holds non-anchor files: <dest>` |

**Chosen:** refusal lines carry the file path, its status and a violation count, never violation text. The shipped JSONL line validators echo field values (`eventViolations` prints `type '<value>'` and `(got <value>)`), refusal stderr reaches graft's park comment on the tracker, and FAFF-1263 already set this rule for every non-interactive output. Full text is available on demand through `--check --json` (below) and `faff evidence validate`.

**Chosen:** `--dest` is guarded by content rather than location. It must be absent, an empty plain directory, or a plain directory holding a prior anchor (a `chain-head.json` plus anchor-manifest paths only). An empty directory is filled in place and never removed; `rm -r` runs only on a directory that already held an anchor. Tests and recovery mint into temp directories, so a fixed anchors-root containment rule would break them. Writing into an empty directory is what today's mint already does, so this adds no new reach.

**Chosen:** refuse a re-mint that would drop a file from an existing anchor. Replacing `--dest` wholesale is what stops unvalidated stale files surviving, but it would otherwise let a file that vanished from the run dir disappear from the committed record without any leg noticing. Graft mints at Step 9b on the feature branch, before the PR merges, so the existing anchor at `--dest` is always a feature-branch copy. There are two remedies, chosen by why the file is missing:

- **The run dir lost legitimate evidence:** restore the file through its writer, then re-mint.
- **The file should never have been there** (a writer defect since fixed): delete the feature-branch anchor at `--dest`, then re-mint.

Never re-create a file only to clear the refusal. An anchor already on the base branch is never re-minted by graft, and [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)'s CI immutability check refuses any change to it.

One stderr line per failing file, in the table's order (`schema-unavailable`, `schema-check-error`, `unschemaed-file`, `schema-mismatch`), each group sorted by path, at most 5 file lines in total across all groups, then a `(+N more files)` suffix.

**Chosen:** a legacy staged anchor is refused as `schema-mismatch`, one line per present evidence document with status `legacy`. Parent rule: there is no legacy pass at mint.

**Chosen:** the holdout binding and the holdout writer-only constraints run inside `validateAnchorDir`, so the mint, `faff evidence validate` and the CI leg apply one rule.

```
CONSTRAINT holdout.json present =>
  chain-head.json present AND holdout.issue == chain-head.issue        # else "holdout.json: issue does not match anchor issue"
  AND holdoutConstraintViolations(holdout) is empty
```

**Chosen:** split `holdoutRecordViolations` in `holdout-record.js` into its schema check and a new exported `holdoutConstraintViolations(doc)` (the writer-only rules: id pattern, met/unmet detail, needs-human reason, length), with `holdoutRecordViolations` composing the two so the writer's behaviour is unchanged. `validateAnchorDir` calls only the writer-only half, since it already ran the (possibly candidate) schema. Both modules are governance-region, so the new `require` crosses no region boundary. The binding violation is charged to `holdout.json` in the report, so the mint's refusal line is `schema-mismatch holdout.json`. The message names neither issue id.

### `faff events anchor --check`

```
faff events anchor --run-dir D --issue I --dest X --check [--json]
```

Runs every check the real mint runs (flags, ledger fold, floor-incomplete, staged mint, validation, `checkDest`) and exits with the same code, but always deletes the staged anchor and never touches `--dest`. Prints `events anchor --check: ok` on success. With `--json`, prints the staged anchor's full `validateAnchorDir` report to stdout whenever one exists (every case except `schema-unavailable` and `schema-check-error`, where the validator produced none), with violation text included and passed through `redactKnownSecrets` first, for an operator diagnosing a refusal locally. If the redaction config cannot be read, it prints no report and exits 2, as `faff evidence write` does.

**Chosen:** split the handler into read-only planning (staging, validation, `checkDest`) and one `commitMint` function, and have `--check` return before `commitMint`; a test asserts `--check` never calls it. `--check` lets the in-flight drain (below) and recovery test a run dir without committing anything, and it reuses the real path, so it cannot drift from it.

### Holdout binding in `faff evidence validate`

`faff evidence validate` is shipped. This ticket adds the holdout binding inside `validateAnchorDir` (above), so `faff evidence validate` and the base-commit CI leg from [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) apply it too. It also appends `"holdout-binding"` to the `validate` array of `CAPABILITIES`, so `faff evidence capabilities --json` prints `{"validate":["require-evidence-schema","candidate-schemas","holdout-binding"]}`. The Action's `resolve-trusted-cli` step already reads that array ([FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)), so no Action change is needed for the Action to tell which bases check the binding.

### `ac_id` writer rule

`faff evidence write ac-checklist --run-dir D --issue I` refuses a document in which any present criterion has an `ac_id` that is missing or `null`. It exits 1 and writes nothing, like its other refusals, with one stderr line per offending criterion:

```
faff evidence write ac-checklist: refused: criteria[<i>].ac_id: required (take it from faff dod classify --issue)
```

A zero-AC input omits `criteria` and is unaffected. The existing checks are unchanged: a malformed id fails the schema pattern, and a duplicate or a ticket part that differs from `--issue` is refused. On the write path the new rule fires alongside the "every criterion carries one, or none does" check: an all-missing input now fails the new rule, and a mixed input still reports the mixed-ids message as well.

**Chosen:** the rule lives in the write path only (`writeAcChecklist`), not in the shared `acChecklistWriterViolations` that `renderAcChecklist` also calls. A run dir whose checklist was written before this change still renders, and the mint, `faff evidence validate`, the CI legs and `readAcComplete` keep accepting `null`, so every committed anchor keeps validating.

**Chosen:** the refusal names the criterion index, never the criterion text or an id value, the same rule as the writer's other refusals.

**Chosen:** the writer stays the only place the rule binds. It is not a schema change, so it needs no version bump and does not interact with the v0.3 freeze.

`USAGE` drops the `?` from `ac_id` in the `write ac-checklist` line. `docs/guide/cli.md`'s `evidence write ac-checklist` row and graft Step 8's list of refusals name the rule. The `ac_id` paragraph of `verification/evidence/v0.3/evidence-documents.md` (and its bundled copy) says the writer requires an id on every criterion, while anchors whose criteria lack `ac_id` (written before FAFF-1287) or carry `null` (FAFF-1300 to FAFF-1302) still validate. The writer already turns an omitted `ac_id` into `null` (`anchoredAcChecklist`), so the check runs on the normalised document and treats both the same.

### v0.3 freezes

**What freezes.** v0.3 as it stands after FAFF-1287's in-place additive change (optional `ac_id` and `verifications` on `ac-checklist` criteria), FAFF-1260's closed payload schemas and FAFF-1268's published `review-round` schema. The README changelog has no entry for FAFF-1287 or FAFF-1268 yet, so the freeze entry names both. From the freeze on, a change to a v0.3 schema that the versioning rule below does not allow is refused: it needs a new minor version. Mechanically, the base leg's `classifySchemaChange` rejects a non-additive candidate schema (`candidate_rejected`) and judges the PR's anchors with the base schema, and the mint judges with the installed CLI's bundled schema. The `ac_id` writer rule is not a schema change and is unaffected.

**Chosen:** `verification/evidence/README.md` moves v0.3 from "draft" to "current" with a dated changelog entry, and replaces the draft rule with the versioning rule for v0.3 onward: an additive change (as `classifySchemaChange` defines it, with [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)'s array tightening) to a JSON evidence document may land in place with a dated changelog entry; a JSONL record change (a new event type, effect kind, payload field or enum value) lands in place in schema-first, writer-second order, with the line-validator change in the first PR; any other change needs a new minor version. The same section states the vocabulary sequencing rule from "Failure modes": a new event type, effect kind or enum value lands before any anchor uses it. "In place" means no new version directory, not one PR: the mint validates with the installed CLI's bundled schemas, which in normal use match `main`, so a writer may emit a new field only after the schema change that adds it is on `main` (and in the installed CLI). The schema change and the writer change are therefore two PRs, in that order, for JSON documents as well as JSONL records. The base leg's candidate path still matters: it lets the schema PR's own anchor pass while the head adds the field, and it covers an adopter whose installed CLI is ahead of the base.

`verification/evidence/v0.3/README.md` and its bundled copy change their status from "draft" to "current". They drop "Nothing refuses on v0.3 until then" and "Nothing in this version changes a gate", and say instead that the mint refuses and CI fails a non-conforming anchor. Both copies stay byte-identical, since `test/evidence-v0.3.test.mjs` asserts it.

### Switching CI to `require`

[FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) ships the base-commit leg with the Action input `evidence-schema` defaulting to `report`. This ticket changes that default to `require` in `.github/actions/governance-check/action.yml`, in the same PR as the mint refusal and behind the same pre-switch gate, and rewrites the input's description, which today calls `report` the default. From then on a PR whose new anchor fails its schema fails CI, and the head verb runs with `--require-evidence-schema`. Adopters can still set `report` explicitly. `.github/workflows/governance.yml` sets no `evidence-schema`, so this repo picks up the new default.

`test/faff-1278-governance-check-base-commit-leg.test.mjs` pins today's behaviour in three places, and each is updated:

- The `report`-default test now pins `default: "require"`.
- The capabilities test now expects the three-entry `validate` array.
- The `holdout binding not checked` test builds its base from this branch's CLI (the `cli` template flavour), which will now list `holdout-binding`. **Chosen:** the test moves to a base flavour whose `CAPABILITIES` lacks `holdout-binding` (a copy of the `old-cli` pattern that removes the one entry), and keeps its assertions. A new case asserts that a base listing `holdout-binding` emits no such warning.

### Graft routing

`faff-graft/SKILL.md` Step 9b's anchor-refusal paragraph names the new refusal codes (`schema-unavailable`, `schema-check-error`, `unschemaed-file`, `schema-mismatch`, `anchor-shrink` at exit 3; `dest-not-directory`, `dest-not-anchor` at exit 2) as build-evidence defects, routed through the existing abort-before-`gh pr create` plus park path, with the recovery pointer: re-run the writer for the named file (`faff evidence write …`, `--terminal-only` for a review verdict with no recorded rounds, `faff holdout record`), or delete the feature-branch anchor for `anchor-shrink` per the rule above, then `faff events anchor --check`. The park comment carries only the refusal lines. `--check --json` is named as a local diagnostic for a human operator, and the SKILL states that its output is never pasted into a tracker comment, a PR body or a committed file. It also drops the warn-only sentence FAFF-1263 added. No new park path.

Step 8's writer paragraph adds "a criterion with no `ac_id`" to the refusals it lists. The remedy is to re-take the AC list from `faff dod classify --spec <spec> --issue <ISSUE> --json` and pass each criterion's `ac_id` through unchanged, never to invent one. If the writer still refuses, Step 8 behaves as it does today: no file, a one-line refused note in the PR body, and Step 9b's existing `floor-incomplete` refusal parks the build.

## 4. HOW

### Build order

One PR. Its pre-switch gate (below) must pass before merge.

1. Staged mint, `--check`, removal of `warnOnEvidenceSchema`, the holdout binding and `holdoutConstraintViolations` split, the `holdout-binding` capability, and the `ac_id` writer rule.
2. Fixture and writer-test migration, graft Steps 8 and 9b, the README freeze (both READMEs and `evidence-documents.md`), the Action default flip to `require`, and the FAFF-1278 test updates.
3. The pre-switch gate results in the PR body.

### Staged mint

Summary: mint into a temp directory, validate that directory, and copy it to `--dest` only on a pass.

```
PROCEDURE events_anchor(run_dir, issue, dest, check, json):
  1-3. Flag checks, ledger-fold precondition, floor-incomplete (unchanged)
  4. staging := mkdtemp(os.tmpdir(), "faff-anchor-")
  5. r := mintIssueAnchor(run_dir, issue, staging)                 # unchanged byte-copy core
     IF NOT r.ok: rm staging; return today's code for r.code      # no-events, genesis-invalid -> 3; others 2
  6. summary := checkAnchorDir(staging)                            # never throws; paths, statuses, counts
     IF summary.status == error: rm staging; print schema-unavailable or schema-check-error; return 3
     IF summary.status != pass: rm staging; print per the refusal table; return 3
  7. destCheck := checkDest(dest, staging)                        # read-only: lstat + file-set comparison
       IF lstat(dest) is a symlink or not a directory -> dest-not-directory (exit 2)
       IF dest is non-empty AND (no chain-head.json OR any file is not an anchor-manifest path) -> dest-not-anchor (exit 2)
         # only regular files count; empty subdirectories are ignored
       FOR each file f in dest not in staging -> anchor-shrink f (exit 3)
     IF destCheck refuses: rm staging; print; return its code
     IF check: IF json: print validateAnchorDir(staging) report; rm staging; print "ok"; return 0
  8. commitMint(staging, dest):                                    # the only function that writes under dest
       a. re-lstat dest (refuse dest-not-directory on a symlink); IF dest holds a prior anchor: rm -r dest
          # replace wholesale, never merge; an empty dest is kept
       b. mkdir -p dest; copy every staged file to the same relative path under dest
          (read staged bytes, write them; no re-read of run_dir)
       c. checkAnchorDir(dest) must report pass, else exit 3 with schema-mismatch lines   # confirms the landed bytes
  9. rm staging; print today's success line; return 0
```

On a refusal with `--check --json`, the redacted `validateAnchorDir` report for the staged anchor, when one exists, is printed to stdout before the staging dir is removed, so the operator sees the violation text.

**Chosen:** stage under `os.tmpdir()` and copy, not rename. A sibling staging dir would create `.faff/anchors/<run>/` on a refused mint, and a rename from `os.tmpdir()` can fail across filesystems.

**Chosen:** replace an existing `--dest` wholesale after validation, and refuse when that would drop a file (`anchor-shrink`). Today a re-mint overwrites file by file, so a file absent from the new mint survives from the old one unvalidated. Graft's benign re-run on an unchanged tree still ends in "nothing to commit", since identical bytes land.

**Anti-pattern:** validating the run dir instead of the staged anchor. Why: the run dir holds round records (`review-rounds/`, FAFF-1268), logs and other files the manifest does not list, it lacks the mint-computed chain heads, and its bytes could change between the check and the copy.

### `ac_id` writer check

```
PROCEDURE writeAcChecklist(run_dir, issue, text, secrets):
  1. issueDir := guardWriterPaths(run_dir, issue); input := parseStdinObject(text)   (unchanged)
  2. doc := anchoredAcChecklist(redactKnownSecrets(input, secrets))                  (unchanged; omitted ac_id -> null)
  3. violations := schema(doc) + acChecklistWriterViolations(doc, issue)             (unchanged)
                 + acIdRequiredViolations(doc)                                       # new, write path only
  4. IF violations: return { refused: violations }                                   # exit 1, nothing written
  5. write and return { written }                                                    (unchanged)

FUNCTION acIdRequiredViolations(doc):
  IF "criteria" not in doc OR doc.criteria is not an array: return []                # zero-AC, or already refused
  return [ "criteria[i].ac_id: required (take it from faff dod classify --issue)"
           for each i where doc.criteria[i] is an object and doc.criteria[i].ac_id is not a string ]
```

`acIdViolations` keeps its "every criterion carries one, or none does" message for `renderAcChecklist`. On the write path, a mixed document now gets both that message and one `required` line per missing id. Both refuse, and neither prints a value.

**Anti-pattern:** putting the rule in `acChecklistWriterViolations`. Why: `renderAcChecklist` calls it on an already-written file, so a run dir written before this change would stop rendering its PR-body block.

### In-flight drain (pre-switch gate)

Summary: before the PR that switches on refusal merges, prove the writers are clean and nothing in flight still holds old-shape evidence.

```
PROCEDURE pre_switch_gate():
  1. Readiness: `faff evidence-readiness --since <rev> --json` exits 0 at the commit this PR branches
     from and again at the PR head before merge (FAFF-1263's hand-off; the second run covers any v0.3
     edit made in this slice). <rev> is the one FAFF-1270 recorded. Paste both JSON outputs in the PR body.
     Readiness itself checks that all seven writer tickets (FAFF-1266, -1267, -1268, -1258, -1259,
     -1260, -1277) merged at or before <rev>, each resolved to its pinned merge commit (FAFF-1290),
     that a qualifying beep-boop run exists, and that spec-review-verdict.json and holdout.json were observed.
  2. Local run dirs: for every .faff/runs/<run>/ whose run-ledger owner.status is running or
     aborted-resumable, and every admitted issue with no terminal outcome:
       `faff events anchor --run-dir <run> --issue <I> --dest <tmp> --check`
       exit 3 schema-* -> recover with the writers' commands, or let the run close, before merging
     A run dir whose <I>/ac-checklist.json has absent or null ac_id is not a drain item: the schema
     allows null, so --check passes it and the mint will too. The ac_id rule binds only a new write.
     Record the count of such run dirs in the PR body for information. Do not re-write their checklists.
  3. Open PRs: for every open PR (`gh pr list --state open --json number,files`) whose files touch .faff/anchors/, run
     `faff evidence validate <dir> --require-evidence-schema` on its anchor dirs; a failing PR merges
     before this one or is re-anchored. After this slice merges, their next CI run uses the new base and would fail.
     An open-PR anchor whose ac-checklist has null ac_id passes this check and needs nothing.
  4. Code-owner review is active: `faff branch-protection-check --branch main` (FAFF-1278) reports
     `code-owner review: required`, and .github/CODEOWNERS on main lists the owners
     (it already lists /.github/ and /verification/; the open item is the ruleset setting).
     The human repo admin enables it per the runbook; the build agent only checks and records it.
  5. Any failure in 1-4 -> do not merge; report on FAFF-1261.
```

Steps 1 to 4 are a merge checklist in the PR body. The build agent runs steps 1 to 3 and records the output; step 4 needs the human admin.

**Existing tests.** About ten test files and the `events.js` selftest mint per-PR anchors from hand-written, pre-v0.3 floor files, which this slice refuses. **Chosen:** extend `test/helpers/evidence-anchor-fixtures.mjs` (its `"v03"` shape already writes the run ledger, AC checklist and review verdict from the bundled valid examples, and `mkChainedRun` writes schema-valid events) so it covers every file those fixtures write, and switch the fixtures to it; their assertions stay as they are. `test/faff-1263-evidence-warn-only-mint.test.mjs` asserts the warn-only behaviour this slice removes, so it is rewritten as the enforcement test rather than migrated.

**Writer tests.** Three test files pipe criteria with no `ac_id` to `faff evidence write ac-checklist`, and the rule changes what they see. `test/evidence-write.test.mjs` and `test/evidence-review-rounds.test.mjs` add a valid `ac_id` to the criteria they write, keeping their assertions. Expected outputs change only where they printed `ac_id: null`. In `test/faff-1287-ac-ids.test.mjs`, the `faff-1287#ac-9` test's last case ("null when omitted") becomes a refusal case, and the `faff-1287#ac-10` table gains "a criterion with no ac_id" and "every ac_id null". This is the one deliberate reversal of a FAFF-1287 behaviour. The render test "render handles a zero-AC anchor and an older anchor without the new keys", which plants documents with absent and `null` ids, stays as it is and must keep passing.

### Edge cases

- **Zero-AC issue:** `ac-checklist.json` without `criteria` validates (FAFF-1256 schema); the mint passes. The writer's `ac_id` rule applies only to present criteria, so a zero-AC write is unaffected.
- **Checklist with absent or `null` `ac_id` already written** (a run dir from before this change, or the committed FAFF-1300 to FAFF-1302 anchors): it validates, mints, passes CI and renders. Only a new `faff evidence write ac-checklist` refuses it.
- **Some criteria with an id, some without:** refused at write, as today, with one `required` line per missing id beside the existing mixed-ids message.
- **`ac_id` present but empty or malformed:** already refused by the schema pattern; unchanged.
- **Step 8 ran without `--issue` on `faff dod classify`:** the criteria carry no `ac_id`, so the writer refuses and writes no file. Step 9b's `floor-incomplete` then parks the build, which is the intended signal.
- **`review-rounds/` in the run dir (FAFF-1268):** never copied into the staged anchor, so it cannot raise `unschemaed-file`.
- **No `spec-review-verdict.json` or `holdout.json`:** absent optional files are not checked; the floor list is unchanged.
- **Torn final line in `events.jsonl` or `declared-effects.jsonl`:** `validateAnchorDir` skips it and sets `torn_tail: true`; the mint passes, matching the integrity leg.
- **`holdout.json` present but `chain-head.json` absent:** impossible after a mint (the mint always writes `chain-head.json`); in CI it fails the binding check, and the integrity leg already fails `witness-absent`.
- **Ungoverned run (no `pk.json`):** nothing to check for that path.
- **Crash during `commitMint`:** `--dest` can be left partial. The previous anchor survives in git, the next Step 9b run re-mints (a partial `--dest` holds only manifest paths, so `dest-not-anchor` does not fire, and `anchor-shrink` cannot fire because the partial set is a subset), and CI fails a partial anchor through the merge-floor and evidence legs.
- **Staging directory race:** `mkdtemp` creates the staging dir mode 0700 under the agent's own uid; another uid cannot swap a staged file between validation and copy. A same-uid writer can already edit the run dir, so staging adds no new exposure.

### Failure modes

- **Writers lag the refusal.** How you'd know: `schema-mismatch` parks in beep-boop runs after merge. What it means: revert this slice, never loosen a schema (parent rule). The pre-switch gate exists to make this rare.
- **The CI leg fails a PR the mint passed.** How you'd know: a PR whose mint exited 0 fails [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278)'s base leg under `require`. What it means: the installed CLI that minted it is ahead of `main`; re-run the build with an install that matches `main`.
- **Builds park on `floor-incomplete` after the `ac_id` rule lands.** How you'd know: graft's PR-body note says the AC checklist was refused for `criteria[<i>].ac_id: required`. What it means: Step 8 did not take its ids from `faff dod classify --issue`, usually because an older graft SKILL is installed. Fix the install or the Step 8 call, never the writer.
- **Null ids still reach anchors.** How you'd know: a committed anchor after this slice has `ac_id: null`. What it means: the rule binds only the writer, by product-owner decision, so a hand-written checklist or one written by an older CLI still validates, mints and passes CI under `require`. Null ids become rare, not impossible; find the run that bypassed the writer.

## Scenarios

```
Given a run dir whose FAFF-1/review-verdict.json lacks schema_version and whose other evidence documents are v0.3-valid
When `faff events anchor --run-dir <run> --issue FAFF-1 --dest <d>` runs
Then it exits 3, stderr names `schema-mismatch review-verdict.json`, <d> does not exist, and no directory was created under <d>'s parent
```

```
Given the same run dir after the review verdict was rewritten in the v0.3 shape, and an older anchor already at <d> whose files are a subset of the new mint's and one of which (review-verdict.json) differs
When the mint runs again
Then it exits 0, <d> contains exactly the staged file set with the new review-verdict.json bytes, and `faff evidence validate <d> --require-evidence-schema` exits 0
And when <d> instead also holds a holdout.json the run dir no longer has, the mint exits 3 with `anchor-shrink holdout.json` and <d> is unchanged
And `faff events anchor --check` gives the same exit code in both cases and leaves <d> byte-identical
```

```
Given an anchor whose chain-head.json issue is FAFF-1 and whose holdout.json issue is FAFF-2
When the mint stages it, and when `faff evidence validate` checks it
Then the mint exits 3 with `schema-mismatch holdout.json`, and validate exits 1; neither message contains FAFF-2
```

```
Given a run dir for FAFF-1 and an AC checklist on stdin with two criteria, the second with no ac_id
When `faff evidence write ac-checklist --run-dir <run> --issue FAFF-1` runs
Then it exits 1, stderr names `criteria[1].ac_id: required` and contains neither criterion's text, and <run>/FAFF-1/ac-checklist.json does not exist
And when both criteria carry ids from `faff dod classify --issue FAFF-1` it exits 0
And an already-committed anchor whose criteria all carry `ac_id: null` still passes `faff evidence validate --require-evidence-schema` and `faff events anchor --check`
```

- No refusal line from the mint contains violation text or a field value from an evidence file.
- A refused mint and `--check` never create, modify or delete anything under `--dest` or its parent.

## 6. DESIGN DECISION RATIONALE

- **Validate the run dir or a staged anchor?** The parent sketched validating each copy-list file in the run dir before the byte-copy. That checks bytes that are copied later, cannot check the mint-computed chain heads, and needs a second copy list beside `mintIssueAnchor`'s. **Chosen:** staged anchor under `os.tmpdir()`, validated with the same `validateAnchorDir` CI uses, copied on pass.
- **Violation text or counts in refusal output?** The JSONL line validators echo values, and refusal stderr reaches the tracker. **Chosen:** counts through `checkAnchorDir`; text only through `--check --json` and `faff evidence validate`, which an operator runs locally.
- **What happens to files an existing anchor has but the new mint lacks?** Keeping them leaves unvalidated bytes; silently dropping them loses evidence. **Chosen:** refuse (`anchor-shrink`).
- **Rename or copy into `--dest`?** Rename can fail across filesystems; a sibling staging dir leaves debris on refusal. **Chosen:** copy the staged bytes.
- **Merge into or replace an existing `--dest`?** Merging keeps stale, unvalidated files. **Chosen:** replace wholesale after validation.
- **What happens to the v0.3 draft rule?** **Chosen:** v0.3 becomes current, including FAFF-1287's in-place `ac_id` and `verifications`; schema changes outside the rule below are refused from then on; additive JSON-document changes and JSONL vocabulary changes land in place with a changelog entry, schema first and writer second; everything else needs a new minor.
- **Holdout issue binding against what?** The dir basename differs at mint (staging) and is not an invariant for `--anchor-dir`. **Chosen:** `chain-head.json` `issue`, which the mint computes.
- **How is the drain made concrete?** **Chosen:** FAFF-1263's `faff evidence-readiness` exit 0 at branch-from and head, `anchor --check` over live run dirs, and validation of open-PR anchors.
- **`ac_id` required in the schema or at the writer?** A schema rule would fail the committed FAFF-1300 to FAFF-1302 anchors, which cannot be changed. **Chosen:** a writer rule (product-owner decision 2026-10-17), on the write path only, so readers of already-written checklists are unaffected.
- **Rollback?** A config switch to warn would let the audited party turn enforcement off. **Chosen:** revert this ticket (parent rule), which also restores the `report` default; the Action's `report` input exists for adopters and sits under CODEOWNERS.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1270 has recorded a `--since` revision and a ready readiness report on its ticket before this slice merges, with FAFF-1274's `outcome_details` fix on `main` (FAFF-1274 is Done). On `main` at ed09326f, FAFF-1270 has so far pinned FAFF-1268's merge commit (d985757e). Validation: pre-switch gate step 1.
- **Chosen (product owner, 2026-10-17):** after the freeze, v0.3 follows the versioning rule in "v0.3 freezes" above: an additive JSON change and a two-PR JSONL change land in place with a dated changelog entry, and any other change needs a new minor. The product owner confirmed this over the Pre-1.0 "every change bumps the minor" rule when round 8 raised the conflict, so the README rewrites that rule rather than keeping both.
- **Assumes:** graft Step 8 passes `--issue` to `faff dod classify` on every build path, as `faff-graft/SKILL.md` says on `main`. Validation: grep Step 8 for `dod classify --spec <spec> --issue`.

The earlier assumptions about FAFF-1268, FAFF-1260 and [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) are now facts (see Already shipped). The writer names are `faff evidence write ac-checklist` and `faff evidence write review-verdict [--terminal-only]`, shipped by FAFF-1277 and FAFF-1268.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] [ac-1] The first Scenario passes as a test in `test/evidence-enforcement.test.mjs` (new; replaces `test/faff-1263-evidence-warn-only-mint.test.mjs`)
- [ ] [ac-2] `faff merge-gate` routes identically on `test/merge-gate-local.test.mjs` and `test/holdout-*.test.mjs` with no fixture edits
- [ ] [ac-3] `warnOnEvidenceSchema` and its call are gone from `events.js`

### From WHAT (mint)
- [ ] [ac-4] `faff events anchor` exits 3 with `schema-unavailable <reason>` (bundled manifest removed in a temp copy of the plugin tree), `unschemaed-file <path>` (a staged file with no manifest entry), `schema-mismatch <path>` (invalid evidence file) and `schema-check-error <reason>` (`validateAnchorDir` stubbed to throw a plain `Error`); none creates `--dest` or its parent
- [ ] [ac-5] A legacy staged anchor is refused with one `schema-mismatch` line per present evidence document
- [ ] [ac-6] Stderr lines are grouped and ordered per the refusal table, with at most 5 file lines in total and a `(+N more files)` suffix
- [ ] [ac-7] `--check` returns the same exit code as the real mint on the pass case and every refusal case, and leaves `--dest` byte-identical (absent stays absent; existing stays unchanged); `--check --json` prints the redacted staged `validateAnchorDir` report on a `schema-mismatch` refusal and on a pass, and prints none on `schema-unavailable`
- [ ] [ac-8] For an `events.jsonl` line whose `type` holds the sentinel `S3CR3T-SENTINEL`, no mint stderr line contains it (`--check --json` and `faff evidence validate` may)
- [ ] [ac-9] `holdout.json` whose `issue` differs from `chain-head.json` `issue` is refused at mint and fails `faff evidence validate`; the message contains neither id; `holdout.json` with no `chain-head.json` fails `faff evidence validate`
- [ ] [ac-10] `holdout.json` failing `holdoutConstraintViolations` is refused at mint; `holdoutRecordViolations` returns the same list as before the split on its existing tests
- [ ] [ac-11] A JSONL file whose only fault is a torn final line passes the mint
- [ ] [ac-12] A `--dest` holding a non-anchor file, or a non-empty `--dest` with no `chain-head.json`, exits 2 `dest-not-anchor` and is untouched; an empty existing `--dest` is filled in place and not removed; the landed `--dest` passes `checkAnchorDir` after copy
- [ ] [ac-13] A re-mint that would drop a file from an existing `--dest` exits 3 `anchor-shrink <path>` and leaves `--dest` byte-identical; a `--dest` that is a symlink exits 2 and nothing it points to is touched
- [ ] [ac-14] `anchor-run` re-mints of a legacy run, and the `bundle.js` and `bundle-recover.js` selftest mints, succeed unchanged (the `anchor-run` selftest cases and `faff bundle --selftest` pass unedited)
- [ ] [ac-15] Every existing per-PR mint fixture (the `events.js` selftest `anchor` cases and the per-PR mints in `test/events-chain.test.mjs`, `test/effects-chain.test.mjs`, `test/events-anchor-genesis-guard.test.mjs`, `test/faff-1155-anchor-floor-required.test.mjs`, `test/faff-1001-anchor-before-pr-order.test.mjs`, `test/faff-1005-anchor-commit-broad-swallow.test.mjs`, `test/run-ledger-init-*.test.mjs`, `test/commissaire-unit-id.test.mjs`, `test/evidence-v0.3.test.mjs`, as found by grep at build time) writes its floor files through `test/helpers/evidence-anchor-fixtures.mjs`; edits touch fixture setup only, never an assertion
- [ ] [ac-16] `--check` returns before `commitMint` (unit test with `commitMint` stubbed to throw)
- [ ] [ac-17] A run dir whose `FAFF-1/review-rounds/round-1.json` exists mints with exit 0, and the landed `--dest` holds no `review-rounds/` path

### From WHAT (`ac_id` writer rule)
- [ ] [ac-18] `faff evidence write ac-checklist` exits 1 and writes no `ac-checklist.json` for each of: one criterion with no `ac_id` key, one with `ac_id: null`, every criterion `null`; stderr has one `criteria[<i>].ac_id: required` line per offending criterion and contains no criterion `ac` or `verified` text (sentinel test)
- [ ] [ac-19] `faff evidence write ac-checklist` exits 0 for a zero-AC input (no `criteria` key) and for criteria that all carry ids taken from `faff dod classify --issue`, including the positional `<ticket>#done:N` form
- [ ] [ac-20] `faff evidence render ac-checklist` still renders a planted checklist whose criteria lack `ac_id` or carry `null` (the existing "render handles a zero-AC anchor and an older anchor without the new keys" test passes unedited)
- [ ] [ac-21] The committed anchors for FAFF-1300, FAFF-1301 and FAFF-1302 (every `ac_id` null) pass `faff evidence validate --require-evidence-schema`, and the `ac-checklist` schema still allows `null` for `ac_id` (the `test/faff-1287-ac-ids.test.mjs` schema assertion is unchanged)
- [ ] [ac-22] `test/evidence-write.test.mjs` and `test/evidence-review-rounds.test.mjs` pass with `ac_id` added to their written criteria; in `test/faff-1287-ac-ids.test.mjs` the "null when omitted" case becomes a refusal and the refusal table gains the two missing-id cases; apart from expected-output values that embed `ac_id` (such as the expected bytes at `test/evidence-write.test.mjs:47`), no other assertion in those files changes
- [ ] [ac-23] The `write ac-checklist` usage line no longer marks `ac_id` optional; `docs/guide/cli.md`'s `evidence write ac-checklist` row names the rule and no longer says `ac_id` is written as `null` when the input omits it ("Both are always written, `null` when the input omits them" is reworded so it covers `verifications` only); graft Step 8's refusal list names the rule; `verification/evidence/v0.3/evidence-documents.md`'s "Either every criterion carries one or none does" sentence (and its bundled copy) is reworded to say the writer requires an id on every criterion; `verification/evidence/v0.3/evidence-documents.md` and its bundled copy say the writer requires an id while anchors with absent or `null` ids still validate

### From WHAT (freeze, capability, CI default)
- [ ] [ac-24] `verification/evidence/README.md` lists v0.3 as current with a dated changelog entry naming FAFF-1287's and FAFF-1268's in-place additions, and states the additive in-place rule (JSON documents only), the JSONL two-PR rule, the vocabulary sequencing rule and that any other v0.3 schema change needs a new minor; the Pre-1.0 rule and the "published version directories are immutable" sentence are rewritten to match, so the README states one versioning rule; v0.1 and v0.2 stay immutable, the typo and prose-fix exemption is kept, and v1.0 stays reserved for the first version an external consumer pins; the README assertion in `test/evidence-v0.3.test.mjs` is updated to match
- [ ] [ac-25] `verification/evidence/v0.3/README.md` and its bundled copy say "current", not "draft", no longer say nothing refuses on v0.3, and replace "v0.3 freezes when FAFF-1261 lands" with a pointer to the versioning rule in `verification/evidence/README.md`; the byte-identity test in `test/evidence-v0.3.test.mjs` passes
- [ ] [ac-26] `faff evidence capabilities --json` prints `{"validate":["require-evidence-schema","candidate-schemas","holdout-binding"]}`, and the capabilities test in `test/faff-1278-governance-check-base-commit-leg.test.mjs` pins it
- [ ] [ac-27] The Action's `evidence-schema` input defaults to `require` and its description names `require` as the default; the structural test in `test/faff-1278-governance-check-base-commit-leg.test.mjs` pins `default: "require"`
- [ ] [ac-28] The `holdout binding not checked` warning test passes against a base CLI whose capabilities lack `holdout-binding`, and a base CLI from this branch with a `holdout.json` anchor under `require` emits no such warning
- [ ] [ac-29] `docs/guide/cli.md` documents `events anchor --check [--json]`, drops the warn-only wording and shows the three-entry `evidence capabilities` output; `docs/guide/governance-check.md` states `require` as the default

### From HOW
- [ ] [ac-30] `faff-graft/SKILL.md` Step 9b names the new refusal codes, both `anchor-shrink` remedies, the recovery pointer and the rule that `--check --json` output never goes into a tracker comment, PR body or committed file, and drops the warn-only sentence; Step 8 names the `ac_id` refusal and its remedy; `faff validate-adapters` passes
- [ ] [ac-31] The PR body carries the completed pre-switch gate (both `faff evidence-readiness --json` outputs, the live run-dir `--check` results with the count of run dirs holding null `ac_id`, the open-PR anchor results, and `branch-protection-check` output showing code-owner review required on main)
- [ ] [ac-32] The second Scenario passes (re-mint replaces `--dest` wholesale), and the fourth Scenario passes as a test (`ac_id` writer rule)

### Integration smoke test

```
PROCEDURE smoke():
  1. Build a run dir with a valid genesis for FAFF-1 and v0.3 evidence from the fixture helper
  2. `faff events anchor` into a temp dest -> exit 0; `faff evidence validate <dest> --require-evidence-schema` -> exit 0
  3. Drop schema_version from review-verdict.json in the run dir; mint into a fresh dest -> exit 3, no dest
  4. `faff events anchor --check` on the same run dir -> exit 3, dest untouched
  5. Pipe a one-criterion checklist with no ac_id to `faff evidence write ac-checklist` -> exit 1, no file;
     with `faff-1#ac-1` -> exit 0
```

## Refresh notes

Refreshed on 2026-10-14 against `main` at 10a8ece4. The design and every decision from the 2026-10-13 spec hold; these interface details drifted:

- **Additive rule already shipped (FAFF-1258).** Dropped this spec's own `--candidate-bundle`, `isAdditive`, `chooseSchemas` and `closedSchemaViolations`. The Action now passes the shipped `--candidate-schemas` and reads `candidate_rejected` and `schema_source`. One gap found in the shipped rule is fixed here: an array property with no `items` counted as closed.
- **Refusal output.** The old spec said `validateAnchorDir`'s violations never carry a value. That is false for the JSONL line validators (`eventViolations` echoes `type` and `got` values). Refusals now print paths, statuses and counts through FAFF-1263's `checkAnchorDir`. `--check --json` gives the full text locally. A `schema-check-error` refusal covers validator faults other than schema-unavailable.
- **`validateAnchorDir` signature.** It takes `{ bundleDir, candidateDir }`, has no `requireEvidenceSchema` option, and reports `legacy` as a status. The mint treats `legacy` as a refusal.
- **Holdout constraints (FAFF-1259).** `holdoutRecordViolations` exists but bundles the schema check. This slice splits out `holdoutConstraintViolations`.
- **Pre-switch gate.** The hand-rolled writer-commit `git log` check is replaced by FAFF-1263's `faff evidence-readiness --since <rev>`, which must exit 0 at the branch-from commit and at the PR head. The proving runs belong to FAFF-1270, and FAFF-1274 must land first.
- **Tests.** Reuse and extend FAFF-1263's `test/helpers/evidence-anchor-fixtures.mjs` instead of a new helper. Rewrite the warn-only mint test as the enforcement test. Update the README "draft" assertion.
- **CODEOWNERS.** `.faff/anchors/` stays out (see FAFF-1278 for the reason). FAFF-1263's spec mentioned it only as a possible narrowing.
- **Fetch-pinned defect** is now FAFF-1265.
- **Assumptions** about FAFF-1256, FAFF-1259 and FAFF-1263 are now facts (see Already shipped). The remaining assumptions cover FAFF-1268 and FAFF-1260 (not yet built), FAFF-1270, FAFF-1274 and the code owners.
- **Review rounds 4 to 7 of this refresh** added the following. Each objection is listed in the Spec-review evidence comment.
  - A fail-closed Action verdict.
  - The coverage check (`anchor-path-unvalidated`).
  - Captured, never echoed, base-leg reports, with sanitised dir names.
  - Immutability for files added to a committed anchor.
  - The empty-or-prior-anchor `--dest` rule.
  - The schema-first, writer-second order for schema changes.
  - Run-level anchor handling.
- **Split (product-owner decision, 2026-10-14).** The CI-trust half moved to [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278), which blocks this ticket. [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) ships the Action input at a `report` default; this ticket flips it to `require`. `holdout-binding` joins the capability list here, when the binding ships.

### Refreshed on 2026-10-17

Refreshed against `main` at ed09326f. The design, the interfaces and every **Chosen** decision from the 2026-10-14 spec hold. Changes and what drove them:

- **New scope: the `ac_id` writer rule** (product-owner decision 2026-10-17, prompted by the null-id FAFF-1300, FAFF-1301 and FAFF-1302 anchors). Added the WHY problem, a design principle, WHAT and HOW sections, edge cases, a failure mode, the fourth Scenario, a rationale bullet, out-of-scope lines (schema change, back-fill, render), the smoke step and DONE ac-18 to ac-23. The rule lives on the write path only, so `renderAcChecklist` (which shares `acChecklistWriterViolations`) keeps rendering older checklists.
- **FAFF-1278 merged (4839e550).** Its assumption became a fact in Already shipped. The capability output is `{"validate":[...]}`, not a flat list, and the Action already reads `holdout-binding` from that array, so this ticket needs no Action change for it. CODEOWNERS already lists `/.github/` and `/verification/`; drain step 4 now checks only the ruleset. Three assertions in `test/faff-1278-governance-check-base-commit-leg.test.mjs` pin today's behaviour (the `report` default, the two-entry capabilities object, and the `holdout binding not checked` warning against this branch's CLI), so they are now in scope (ac-26 to ac-28), along with the input's description text. Premise check: FAFF-1278 delivered none of this ticket's scope.
- **FAFF-1277 / FAFF-1268 / FAFF-1260 merged.** The writer-name assumption became a fact. FAFF-1277 is a seventh writer ticket, so "six writer tickets" became seven, and WHY and Out of scope list it. FAFF-1268's `review-rounds/` are never copied by `mintIssueAnchor` and are not in the manifest, so they cannot cause `unschemaed-file` (edge case, ac-17).
- **FAFF-1290 (aca0104e).** Readiness resolves each writer to a pinned merge commit; drain step 1 says so.
- **FAFF-1287 (3aee72d5, ADR 0139).** The v0.3 freeze now names what freezes: v0.3 after FAFF-1287's in-place additive `ac_id` and `verifications`, plus FAFF-1268's `review-round` schema, neither of which has a README changelog entry yet. It also says that, after the freeze, schema changes outside the versioning rule are refused (ac-24). The v0.3 README and `evidence-documents.md` (both copies) joined the freeze and rule-text edits (ac-23, ac-25).
- **In-flight drain.** Run dirs and open-PR anchors whose checklist has absent or `null` `ac_id` still validate and mint; they are not drain items and are counted for information only.
- **Line numbers.** `events.js` and `evidence.js` line references moved (anchor handler ~1285, `warnOnEvidenceSchema` ~1575, `mintIssueAnchor` ~1608, `validateAnchorDir` ~433, `checkAnchorDir` ~495). Added the writer, renderer, capability and test-file rows to Reference context.
- **`bundle.js` re-mints.** On `main` these are selftest calls only (`bundleSelftest`, `bundleRecoverSelftest`). The out-of-scope line and ac-14 now say so.
- **FAFF-1299, FAFF-1300, FAFF-1302.** Checked: no path this spec uses moved (`.faff/runs/`, `.faff/anchors/` and `!/anchors/` in `.faff/.gitignore`). The spec names no `.faffrc*` or `.faff-templates` path. FAFF-1280, FAFF-1281 and FAFF-1323 touch nothing here.
- **Assumptions.** Added the reading of "refused after the freeze" and the Step 8 `--issue` assumption. Kept FAFF-1270.
- **DONE ids.** Every DONE item carries an authored `[ac-N]` id (ADR 0139), numbered 1 to 32 in order.

- **Round 8 (2026-10-17).** The architectural major on the freeze reading is closed by product-owner decision: the reviewed additive in-place rule stands, and ac-24 now also rewrites the Pre-1.0 and immutability sentences so the README holds one rule. The QA minors are fixed in ac-22 (expected bytes that embed `ac_id` may change) and ac-23 (the `cli.md` "null when omitted" wording). The methodology minor is fixed by naming the `ac_id` rule in right-sizing and stating the bundling and rollback choice. Failure modes now say null ids remain possible outside the writer.

- **Round 9 (2026-10-17).** Two minors fixed in place, not re-reviewed: ac-24 keeps v0.1 and v0.2 immutable and the prose-fix exemption, and ac-25 points the v0.3 README at the rule; the write-path wording no longer says the new rule replaces the mixed-ids check, ac-23 rewords the `evidence-documents.md` "none does" sentence, and ac-29 updates the `cli.md` capabilities example.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** It now fits one unit. The product owner split the CI-trust half into [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) on 2026-10-14. What remains is the staged mint, `--check`, the holdout binding, fixture migration, graft routing, the README freeze, the CI default flip, the pre-switch gate and the `ac_id` writer rule.

**Bundling the `ac_id` rule.** The writer rule is separable: it touches no schema and no freeze rule, and could ship alone. **Chosen:** keep it here, by product-owner decision, because it is part of making the anchor floor refuse instead of warn. The cost is a shared rollback: reverting this slice for writer lag also drops the `ac_id` rule. If only the rule misbehaves, a follow-up PR can revert its writer check alone without touching the mint.

**Workstream fit?** No issues. FAFF-1261 sits under FAFF-1255 with its siblings.

**Deps surfaced?** No issues. [FAFF-1278](https://linear.app/shftwst/issue/FAFF-1278) and the writer tickets have merged (as of 2026-10-17). FAFF-1270 (the readiness proving runs and `--since` revision) is the remaining blocker.

**Risk profile?**
- **What's there:** The main risk is operational. The readiness proving runs (FAFF-1270) gate the merge.
- **What to do:** FAFF-1268 and FAFF-1260 have landed, so start those runs now, not when this build starts.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round 9 minors fixed in place, not re-reviewed)