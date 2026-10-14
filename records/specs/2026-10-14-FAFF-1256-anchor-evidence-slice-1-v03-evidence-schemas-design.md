# Evidence schemas v0.3, validator extension and `faff evidence validate` (FAFF-1256)

> Spec: faffter-dark-nlspec · 2026-10-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1256.

> Revised on 2026-10-13 after spec review round 1: `declaredEffectViolations` split to FAFF-1262 (blocks this slice); warn-only mint tracked on FAFF-1263; facade drift on FAFF-1264; contract-schema sweep and L4 check moved into the build order; JSONL base-node and unknown-type fixes. Round 2: closure lint accepts map schemas, legacy check runs first, violation messages never print values, shipped examples are scrubbed. Post-review corrections from FAFF-1260 prep: discriminator message no longer prints the value; schema-2 envelope admits the run-resume top-level fields. Run-ledger writer list widened to sentry.js, park-reconsider.js, resumecheck.js, run-record-prd.js and events.js (found during FAFF-1258 prep).

This spec is for the build agent picking up FAFF-1256, the first of six slices of FAFF-1255, and for its reviewers. It narrows the approved FAFF-1255 design to slice 1: extend the schema-subset validator, publish the v0.3 anchor schemas and manifest, and add a read-only `faff evidence validate` command. The per-line validator for `declared-effects.jsonl` was split out to FAFF-1262 at spec review, which blocks this slice. No writer stamps `schema_version` yet and no gate refuses anything new; slices 2 to 6 (FAFF-1257 to FAFF-1261) build on this.

## 1. WHY

**The idea the rest depends on.** Every later FAFF-1255 slice validates bytes against a published, closed schema, so the schema language, the schemas and the command that applies them must exist first and must match today's data. Slice 1 ships them read-only: the validator gains the keywords closed schemas need, the v0.3 schemas describe every anchor file, and `faff evidence validate` reports `pass`, `fail` or `legacy` for an anchor directory. Today's 384 committed anchors all report `legacy`, because no writer stamps `schema_version` until slices 2 to 4.

**Problem.** The subset validator cannot express nullable fields, keyed maps, non-empty lists, string patterns or versioned envelopes, so existing schemas leave those fields untyped (v0.2 `chain-head`, the external-verification report) and anchor files have no closed shape. This slice adds the language, the schemas and the read-only check, and changes no gate decision.

### Design principles

- **Read-only until slice 6.** Nothing in this slice refuses a mint, fails a governance-check leg or changes merge-gate routing.
- **One tightening, proven harmless first.** The validator extension also applies to every `faff contract` schema through `schemaCheck`. Step 1 of the build sweeps every contract schema against its golden fixtures and examples before anything else lands, so any schema the new keywords would newly reject is found before it can refuse agent-emitted data mid-run.
- **Schemas match today's writers.** Each v0.3 schema is checked against the committed anchors in the repo, not only hand-written examples.
- **Old published directories stay untouched.** `verification/evidence/v0.1/` and `v0.2/` are not edited (README immutability rule).
- **Two validator copies, one behaviour.** `validate-schema.mjs` and `contract-engine.js` stay separate files and are proven identical by test (parent decision).

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/contracts/validate-schema.mjs` (`validateAgainstSchema`, `main()` at load) | ESM JS | Validator copy 1; also the CLI the evidence tests spawn |
| `plugin/skills/faff/bin/lib/contract-engine.js` lines 20-52 (`validateAgainstSchema`), 56-67 (`schemaCheck`) | CJS JS | Validator copy 2, used by every `faff contract` |
| `plugin/skills/faff/bin/lib/effects.js` `declaredEffectViolations` (added by FAFF-1262) | CJS JS | Line validator `faff evidence validate` uses for `declared-effects.jsonl` |
| `plugin/skills/faff/bin/lib/events.js` (`eventViolations` ~169, `splitPhysicalLines`, `walkPhysicalChain` ~712, `appendRecordsUnderLock` ~541, `RUNNER_IDENTITY_CREDENTIAL_SOURCES` ~139) | CJS JS | Event line validator, torn-tail rule, batch abort, credential-source set |
| `plugin/skills/faff/bin/lib/governance-profile.js` `DELIVERY_PROFILE` | CJS JS | Source of the enums the schemas mirror |
| `verification/evidence/README.md`, `v0.1/`, `v0.2/` | Markdown, JSON Schema | The evidence spec this extends |
| `verification/commissaire-facade/v0.2/schema/producer-pk.schema.json`, `facade-envelope.schema.json` | JSON Schema | Existing shapes for `pk.json` and schema-3 records |
| `plugin/skills/faff/contracts/holdout-verdict.schema.json` `properties.attestation` | JSON Schema | Attestation shape the anchored holdout reuses |
| `test/evidence-spec.test.mjs` | JS test | Schema/example harness this extends |
| `.faff/anchors/` (384 anchor directories, git-tracked) | JSON, JSONL | The real data every schema is checked against |

**Scope.** This is the schema and validation layer under the FAFF-1255 anchor work; it sits beside `faff events verify` and `faff governance-check` without changing either.

## 2. OUT OF SCOPE

- **Writers that stamp `schema_version`** (`faff evidence write …`, `record-review-round`, the shared run-ledger serialiser, `faff holdout record`). Why: slices 2 to 4. Extension point: new subcommands in `bin/lib/evidence.js` and the existing writers in `effects.js`, `run-ledger.js`, `lights-out.js`.
- **Writer-only constraints** (holdout `exercised`/`expected`/`observed` rules, holdout `issue` matching the anchor). Why: they belong with the writer that enforces them (FAFF-1259) and the enforcement slice (FAFF-1261). Extension point: a per-file constraint call inside `validateAnchorDir` in `bin/lib/evidence.js`.
- **Per-type `data` and per-kind `effect` schemas.** Why: slice 5 (FAFF-1260). Slice 1's JSONL schemas close the envelope and leave `data`, `effect` and `payload` open. Extension point: `verification/evidence/v0.3/schema/events/` and `.../effects/`, selected by `discriminator`.
- **`declaredEffectViolations` and its wiring into `appendEffectEntries`.** Why: split to FAFF-1262 at spec review, because it is the only live write-path change and should ship and revert on its own. FAFF-1262 blocks this slice. Extension point: `effects.js`.
- **Mint warnings, mint refusal and the governance-check evidence-schema leg.** Why: the warn-only mint period is FAFF-1263 (blocked by this slice, blocks FAFF-1261); refusal and the governance-check leg are FAFF-1261. Extension point: the per-PR `faff events anchor` handler and `evaluateAnchorDir` call `validateAnchorDir`.
- **Normaliser changes** (`computeReviewVerdict`, `computeSpecReviewVerdict`). Why: slice 2. Extension point: `contract-defs.js`.
- **Commissaire record-kind vocabulary.** Why: Commissaire owns it; slice 1 checks only the schema-3 envelope. The published facade v0.2 envelope lists `accepted_under_contract` where `commissaire.ts` `KIND_AUTHOR` uses `conformed_to_contract`; that drift is tracked on FAFF-1264, not fixed here. Extension point: `verification/commissaire-facade/`.
- **Editing `verification/evidence/v0.1/` or `v0.2/`.** Why: published directories are immutable.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Anchor file | Any file the mint places in `.faff/anchors/<run>/<ISSUE>/` |
| Evidence document | An anchor file whose manifest entry has `versioned_by: "field"`: `run-ledger.json`, `build-progress.json`, `landing-progress.json`, `ac-checklist.json`, `review-verdict.json`, `spec-review-verdict.json`, `holdout.json` |
| Legacy anchor | An anchor directory where no present evidence document carries `schema_version` |
| Bundled copy | `plugin/skills/faff/contracts/evidence-v0.3/`, a byte-identical copy of `verification/evidence/v0.3/` that ships with the plugin |
| Torn tail | The final physical line of a JSONL file that has no trailing newline and does not parse as a JSON object, as `walkPhysicalChain` defines it |

### Validator extension

Both copies gain the same five behaviours with the same violation messages, in the same order. Existing messages are unchanged byte for byte (the external-verification test pins `additional property "bogus" not allowed`), except the `enum` message, which stops printing the offending value.

**Chosen:** no violation message from either copy contains a data value. Only the enum message printed one today (`JSON.stringify(data)`); it is changed in both copies. A grep found no test pinning the old enum text. This meets the parent's "no violation message contains a field value" bar for `faff evidence validate`, whose output can land in CI logs.

```
KEYWORD type (array form)    "type": ["object", "null"]
  passes when any listed type matches; "null" matches JSON null
  an unknown name in an array fails closed: "<where>: schema error: unknown type <name>"
  (a single unknown string type keeps today's behaviour, so no existing schema changes; the v0.3 lint below forbids it)
  violation: "<where>: expected type object|null, got <actual>"   (names joined by "|", schema order)
  "null" is also accepted as a single-string type
  object/array recursion runs when the data is an object/array AND the type includes "object"/"array"

KEYWORD additionalProperties (schema form)   "additionalProperties": { ...schema }
  every key not in properties is validated against the sub-schema at path "<p>.<key>"
  false keeps today's behaviour; true or absent checks nothing

KEYWORD minItems   applies when the data is an array
  violation: "<where>: expected at least N items, got M"

KEYWORD pattern    applies when the data is a string; RegExp(pattern) with no flags, unanchored
  violation: "<where>: does not match pattern <pattern>"     (never prints the value)
  an invalid regex yields "<where>: schema error: invalid pattern <pattern>" (fails closed)

CHANGED   enum       violation becomes "<where>: value not in enum [a, b]"   (no longer prints the value;
                     the allowed list is schema text, not data)

KEYWORD discriminator  { "field": F, "mapping": { "<value>": schema, ... } }   applies when the data is an object
  F absent:                "<where>: missing discriminator property \"F\""
  String(data[F]) unmapped: "<where>: discriminator \"F\" value not in mapping [k1, k2]"   (never prints the value)
  otherwise:               append validateAgainstSchema(data, mapping[String(data[F])], same path)
```

Check order within one schema node: type (early return on mismatch), enum, then for objects: required, additionalProperties, properties, discriminator; for arrays: minItems, items; for strings: pattern.

**Chosen:** an unknown name inside a `type` array is a schema error, not ignored, so a typo in a new schema fails loudly. A single unknown string type stays ignored for backward compatibility, and a test walks every v0.3 schema and asserts every `type` value (string or array element) is one of the seven known names, so v0.3 cannot carry a silently ignored type.

**Chosen:** keywords apply by data kind once the type check passes, and recursion follows "type includes object/array". This keeps every existing schema's behaviour for data that already passed, and lets a `["object", "null"]` field validate its properties when it holds an object.

**Chosen:** existing schemas that already carry now-enforced keywords are left as written, and the stricter result is accepted. The affected keywords and their effect:

| Schema | Keyword | Effect now |
|---|---|---|
| `v0.1/schema/run-ledger.schema.json` | `outcomes.additionalProperties` (8-value enum) | Rejects `parked-window`, `promoted` and non-string outcomes. Its own description says outcomes are string-only and mirror the profile; v0.1 is a historical description and nothing at runtime validates real ledgers against it |
| `v0.1/schema/run-event.schema.json` | `prev.pattern` | Rejects a non-hex `prev`, which `eventViolations` already rejects |
| `v0.1/schema/supersession.schema.json` | `superseded_by.minItems: 1` | Rejects `[]`, which the schema description already says is invalid |
| `contracts/spec-judge-verdict.schema.json` | `correction` type union | `schemaCheck` now enforces object-or-null, which the compute function already guarantees for emitted data |

The shipped v0.1 examples, all contract fixtures and the external-verification reports already satisfy these rules, so no existing test or fixture changes.

**Chosen:** this is confirmed mechanically as build step 1, before any other change lands: a sweep runs every `plugin/skills/faff/contracts/*.schema.json` through the extended validator against every golden case in `test/golden/contracts/cases.json` and every file under `contracts/examples/`, and every `verification/**/schema/*.schema.json` against its examples, and asserts the pass/fail result of each pair is unchanged from the unextended validator. The sweep is kept as a permanent test (`test/validator-extension-sweep.test.mjs`). v0.3 fixes the v0.1 outcome-enum gap by mirroring all nine `DELIVERY_PROFILE.ledger_outcomes`.

**Chosen:** the parity test imports both copies in-process. `validate-schema.mjs` runs `main()` only when it is the process entrypoint (compare `realpath(fileURLToPath(import.meta.url))` with `realpath(process.argv[1])`). The CLI usage, `--selftest` and every test that spawns it behave as before; the test can now `import { validateAgainstSchema }` and `createRequire` the CJS copy, then run one fixture table through both. Spawning per fixture would need a temp file per case and hides message differences behind exit codes.

Both header comments update their keyword list, and `contract-engine.js`'s comment names the parity test as the guard instead of `contract spec-readiness --selftest`.

### The v0.3 directory

```
verification/evidence/v0.3/
  README.md                     # what v0.3 covers, draft status, how files map to schemas
  anchor-manifest.md            # the manifest, legacy rule, `faff evidence validate`
  evidence-documents.md         # each evidence document: writer, slice that starts stamping it, shape
  logs.md                       # events.jsonl and declared-effects.jsonl envelopes and their line validators
  anchor-manifest.json
  schema/
    anchor-manifest.schema.json
    run-ledger.schema.json  build-progress.schema.json  landing-progress.schema.json
    ac-checklist.schema.json  review-verdict-anchored.schema.json  review-round.schema.json
    spec-review-verdict-anchored.schema.json  holdout-anchored.schema.json
    run-event.schema.json  declared-effect.schema.json
    chain-head.schema.json  producer-pk.schema.json
    examples/<name>.example.json            # one valid example per schema
    examples/<name>.invalid.example.json    # one invalid example per schema
```

Every schema: Draft 2020-12, `$id` `faff/evidence/v0.3/<name>`, `additionalProperties: false` at every object level except the open JSONL payloads listed below. Every evidence-document schema requires `schema_version` with `{ "type": "integer", "enum": [1] }`.

**Chosen:** v0.3 is published with status "draft" in the `verification/evidence/README.md` Versions table, and the README's immutability rule gains one sentence: a draft version may be edited in place by the FAFF-1255 slices and freezes when FAFF-1261 (enforcement) lands. Slices 2 to 5 must add to v0.3 (per-type payload schemas, narrowed run-state keys), and nothing refuses on v0.3 until FAFF-1261, so in-place edits before then break no consumer. The changelog gets a dated v0.3 entry.

**Chosen:** v0.3 is self-contained: every schema the manifest names lives in `v0.3/schema/`, and manifest `schema` paths are relative to the manifest's own directory (`schema/run-ledger.schema.json`). The parent's repo-relative paths cannot resolve inside an adopter's install, and `verification/` does not ship. This requires two schemas the parent planned to reference by path:

- `chain-head.schema.json` is a v0.3 restatement of v0.2's six keys, now typed: `head_seq` and `schema_floor` `["integer", "null"]`, `head_sha256` `["string", "null"]` with pattern `^[0-9a-f]{64}$`, `line_count` integer. All 524 committed `chain-head.json` and `effects-chain-head.json` files satisfy it. The type change is a shape change, so it belongs in a new version anyway.
- `producer-pk.schema.json` restates `verification/commissaire-facade/v0.2/schema/producer-pk.schema.json` (the parent's `contracts/producer-pk.schema.json` does not exist). A test asserts the two have identical `type`, `required`, `additionalProperties` and per-property `type`, so they cannot drift.

The anchored holdout's `attestation` sub-schema restates `contracts/holdout-verdict.schema.json` `properties.attestation`; the same structural-equality test covers it.

### The anchor manifest

```
RECORD AnchorManifest:                         # verification/evidence/v0.3/anchor-manifest.json
  schema_version: 1
  files: Map<anchor_relative_path, ManifestEntry>     # additionalProperties as a schema

RECORD ManifestEntry:                          # closed
  schema: String                               # path relative to the manifest's directory
  format: "json" | "jsonl"
  versioned_by: "field" | "manifest"
```

| Anchor path | Schema | Format | Versioned by |
|---|---|---|---|
| `events.jsonl` | `schema/run-event.schema.json` | jsonl | manifest |
| `declared-effects.jsonl` | `schema/declared-effect.schema.json` | jsonl | manifest |
| `chain-head.json` | `schema/chain-head.schema.json` | json | manifest |
| `effects-chain-head.json` | `schema/chain-head.schema.json` | json | manifest |
| `commissaire/producer/pk.json` | `schema/producer-pk.schema.json` | json | manifest |
| `run-ledger.json` | `schema/run-ledger.schema.json` | json | field |
| `build-progress.json` | `schema/build-progress.schema.json` | json | field |
| `landing-progress.json` | `schema/landing-progress.schema.json` | json | field |
| `ac-checklist.json` | `schema/ac-checklist.schema.json` | json | field |
| `review-verdict.json` | `schema/review-verdict-anchored.schema.json` | json | field |
| `spec-review-verdict.json` | `schema/spec-review-verdict-anchored.schema.json` | json | field |
| `holdout.json` | `schema/holdout-anchored.schema.json` | json | field |

`review-round.schema.json` is published but has no manifest entry: round records are never anchored.

The 12 entries are exactly what the per-PR mint (`mintIssueAnchor`, `events.js` ~1504-1582) can place in an anchor today: `events.jsonl`, `run-ledger.json`, `declared-effects.jsonl` when present, the two computed chain heads, the six `optionalFloorFiles` (`events.js` ~1543: `ac-checklist.json`, `review-verdict.json`, `spec-review-verdict.json`, `holdout.json`, `build-progress.json`, `landing-progress.json`), and `commissaire/producer/pk.json`. Files the run-level `anchor-run` path copies (such as `summary.md`) are outside this slice, since `anchor-run` is not schema-checked (FAFF-1255 out of scope).

**Chosen:** the CLI reads the bundled copy, resolved from its own path (`path.resolve(HERE, "..", "contracts", "evidence-v0.3")`, the same base `schemaCheck` uses), never the anchor's or the working checkout's `verification/` directory. A test walks both trees and asserts the same relative file list and identical bytes.

### Evidence document schemas

The four review and test documents use the parent's shapes exactly (FAFF-1255 spec, "Evidence document shapes"): `ac-checklist` (`criteria` optional, `minItems: 1` when present), `review-verdict-anchored` and its `AnchoredFinding`/`FindingOccurrence` (`occurrences` `minItems: 1`), `review-round`, `spec-review-verdict-anchored` with `AnchoredObjection`/`ObjectionOccurrence`, and `holdout-anchored` with `HoldoutCriterion`. Every key is required except `ac-checklist.criteria`; "String | null" fields are `["string", "null"]`. The holdout cross-field constraints and the 2000-character limit are writer-only and out of scope.

Run-state documents:

```
RECORD BuildProgress:                 # all keys required; matches buildProgressApplyComplete
  schema_version: 1
  issue: String
  build: { status: "complete", diff_hash: String, branch: String, pushed_at: String }
  updated_at: String

RECORD LandingProgress:               # all keys required; matches landingProgressApplyFixCycle
  schema_version: 1
  issue: String
  fix_cycles: Integer
  last_head_sha: String | null
  history: List<{ cycle: Integer, kind: "conflict" | "regression",
                  failing_checks: List<String>, tried: List<String>, at: String }>
  updated_at: String
```

**Chosen:** `run-ledger.schema.json` requires only `schema_version` and `run_id`; every other key is optional and typed. The ledger is written by CLI code and by agents following SKILL prose, and resume logic branches on key presence (parent decision). Its closed key set is built by this rule:

1. Top-level keys: the union of (a) keys any CLI writer sets (`run-ledger.js`, `lights-out.js` L4 mint ~line 1158, `resume.js`, `disposition.js`, `budget.js`, `sentry.js`, `park-reconsider.js`, `resumecheck.js`, `run-record-prd.js`, `events.js`), (b) keys `faff-beep-boop`, `faff-graft`, `faff-prep` and `faffter-dark-concurrency-parallel` SKILL prose tells the agent to write, and (c) keys present in committed ledgers (Appendix A).
2. Each key's type comes from its documented writer. Keys with no documented writer take the type observed in committed data, as a type union when the data shows two shapes (`claimed_by_peer`: array of strings or map of strings).
3. Nested objects are closed too. Issue-keyed maps use `additionalProperties` as a schema: `outcomes` (string enum of the nine `ledger_outcomes`), `outcome_details` (closed object, Appendix A key list), `routing_verdicts` and `verdicts` (string), `capabilities` (`{ sut_env_stood: Boolean }`), `budget.tokens_at_start_by_model_class` and `budget.tokens_at_start_by_class` (token counts).
4. L4-only nested keys (`armed`, `enforced`, `rechecked`, `guardrail_claim`, `banner`, `budget_ceiling`, `dial_profile`, `prd_creative_licence`, `prd_root_container`, `corrective_authority`, `container`, `floor`, `budget.metering`) are typed from the mint code and checked against a ledger minted by the existing L4 fixture in `test/lights-out.test.mjs`.
5. Where committed data contradicts the documented writer, the file goes on the exceptions list below; the schema follows the writer.

Known exceptions (the only committed ledgers allowed to fail, each with its reason):

| Committed ledger | Reason |
|---|---|
| `run-20260803-232227-beepboop-full/FAFF-647` | outcome `promoted` is not a `ledger_outcomes` value |
| `run-20260810-185342-beepboop-list/FAFF-581`, `FAFF-699`, `FAFF-723` | `budget.envelope.window` hours and tokens are strings; `envelopeFrom` now writes numbers |
| `run-20260818-195900-beepboop-list-dac127/FAFF-865`, `run-20260915-094719-fly-l3/FAFF-1017` | string items in `post_merge_verification_failures`, documented as `{issue, pr, merge_sha, command}` objects |
| `run-20260903-203823-fly-l3/FAFF-959` | string values in `outcome_details`, documented as objects |

If another committed ledger fails, the builder fixes the schema by rules 1 to 4; the list does not grow without a reviewer agreeing the writer documents a different type.

### JSONL envelope schemas

**Chosen:** `run-event` and `declared-effect` close the envelope per record version using `discriminator` on `schema`, and leave payloads open (`data`, `effect`, `payload` are `{ "type": "object" }`). The base node is `{ type: object, required: ["schema"], discriminator }` with no `properties` and no `additionalProperties`: closing it would reject every key before the discriminator runs. Each mapped sub-schema is the full closed shape, so a schema-1 record carrying `prev` fails, and closure is enforced there.

```
run-event  mapping "1": required schema(enum [1]), run_id, seq(integer), ts, phase(enum 5), type(enum: all 26 DELIVERY_PROFILE.event_types)
                         optional issue(string), data(object, open)
           mapping "2": as "1" with schema enum [2] and required prev (pattern ^[0-9a-f]{64}$);
                         optional epoch(integer), prior_state(string), skipped_shipped, rebuilt_coarse
                         (arrays of strings): the run-resume fields `runResumeEvent` (resume.js) writes at top level

declared-effect  mapping "1": required schema, run_id, seq, ts, kind_of_entry(enum declare|observe), issue, step, effect(object, open)
                 mapping "2": as "1" plus required prev(pattern); optional origin(string),
                              github_actor { login: string|null, source: enum runner-credential|ambient } (closed, both required)
                 mapping "3": required schema, run_id, seq, ts, author(enum commissaire|producer), producer_id,
                              contract_revision, kind_of_entry(string), step, prev(pattern)
                              optional unit_id, issue, effect(object), payload(object), commissaire_sig, producer_hmac
```

**Chosen:** the schema-2 envelope admits the four top-level `run-resume` fields written by `runResumeEvent` in `resume.js`. No committed anchor holds a `run-resume` event, so the committed-data proof alone would have missed them (found during FAFF-1260 prep). Restricting them to `type: run-resume` is a per-type rule the subset cannot express; FAFF-1260's per-type schemas take it on.

The line validators enforce what the subset cannot: `issue` required for issue-scoped event types, exactly one of `unit_id`/`issue`, the authenticator matching `author`.

### `declared-effects.jsonl` line validation

The line validator is `declaredEffectViolations` from `effects.js`, added by FAFF-1262 (which blocks this slice). This slice only calls it; its rules, its wiring into `appendEffectEntries` and its proof against every committed line live on FAFF-1262.

### `faff evidence validate`

```
faff evidence validate <anchor-dir> [--require-evidence-schema] [--json]
faff evidence --selftest
```

| Result | Exit | When |
|---|---|---|
| `pass` | 0 | Every file validates and at least one evidence document carries `schema_version` |
| `legacy` | 0, or 1 with `--require-evidence-schema` | No present evidence document carries `schema_version` |
| `fail` | 1 | Any file fails its schema or line validator, a mid-file JSONL line is unparseable, or a file has no manifest entry |
| error | 2 | Usage error, `<anchor-dir>` missing or not a directory, or the bundled manifest or a named schema is missing, unreadable, unparseable or fails `anchor-manifest.schema.json` (`schema-unavailable <path>`) |

**Chosen:** the exit codes follow `verifyExitCode` in `events.js` (legacy passes by default, fails under an explicit flag, malformed input is 2), and the flag name matches the parent's governance-check flag so slice 6 can pass it straight through.

**Chosen:** a legacy anchor short-circuits, and the legacy check runs before the unmanifested-file check, so a pre-v0.3 anchor is always `legacy`, never `fail`. Every file in today's 384 committed anchors is one of the 12 manifest paths (checked 2026-10-13), so this order changes no current result; it fixes the rule for historical anchors with stray files.

**Chosen:** the report lists each file with status `legacy` and runs no schema checks. Validating parts of a pre-v0.3 anchor against v0.3 would give a half answer; chain integrity is already governance-check's integrity leg.

**Chosen:** a torn tail is skipped and reported (`torn_tail: true` on that file), using the same `splitPhysicalLines` rule as `walkPhysicalChain`; any other unparseable or non-object line fails the file.

```
PROCEDURE validateAnchorDir(anchorDir, opts) -> Report
  1. Load bundled anchor-manifest.json; validate it against schema/anchor-manifest.schema.json;
     load every schema it names. Any fault -> error "schema-unavailable <path>" (exit 2)
  2. Walk anchorDir recursively; collect files as anchor-relative POSIX paths, sorted
  3. Evidence documents present = files whose entry has versioned_by "field"
     IF none carries a top-level schema_version key -> every file status "legacy"; result legacy; return
     (legacy is decided first and wins: a pre-v0.3 anchor is never failed for an unmanifested file)
  4. FOR each file with no manifest entry -> file status "unschemaed", result fail
  5. FOR each manifested file:
     json : parse (failure -> fail "not valid JSON"); violations = validateAgainstSchema(doc, schema)
     jsonl: split physical lines; skip torn tail; for each line i:
              violations += "line i: " + (schema validator ∪ line validator) messages
              line validator: events.jsonl -> eventViolations(rec, true);
                              declared-effects.jsonl -> declaredEffectViolations(rec)
            a jsonl entry with no line validator in code -> error "schema-unavailable" (fails closed)
  6. result = fail if any file has violations, else pass
REPORT (--json): { status, anchor_dir, spec_version: "v0.3",
                   files: [ { path, status: ok|fail|legacy|unschemaed, violations: [String], torn_tail?: true } ] }
Human output: "evidence validate <dir>: <status>" then one line per non-ok file with its first 5 violations and "(+N more)"
```

`validateAnchorDir` is exported for slice 6 to call from the mint handler and governance-check.

**Chosen:** the command lives in a new `plugin/skills/faff/bin/lib/evidence.js` in `region:governance`, hand-written CommonJS like its neighbours. It requires only governance modules (`contract-engine`, `events`, `effects`, `shared-infra`); `effects.js` is governance-region, and `declaredEffectViolations` lives there once FAFF-1262 lands. Registration: `bin/faff` require plus `COMMANDS["evidence"]`; `regions.js` `REGION_MAP["evidence"] = "governance"` and `REGION_SELFTEST_ARGV["evidence"] = ["evidence", "--selftest"]`; a `docs/guide/cli.md` table row starting `` `evidence validate <anchor-dir> …` ``.

`--selftest` validates every bundled example (valid ones pass, invalid ones fail) and builds temp anchor directories for pass, fail, legacy, unschemaed and torn-tail cases.

**Chosen:** examples carried from real anchors are scrubbed before they ship: every string value that is not structural (session ids, pids, hostnames, paths, `github_actor.login`, token counts, free-text notes) is replaced with an obviously synthetic value, and a test runs `redactKnownSecrets` over every bundled example and asserts it changes nothing. The bundled copy ships to every adopter, so committed run data never travels with it verbatim.

**Chosen:** examples are hand-carried from committed anchors where the artifact exists today (run-ledger, build-progress, chain-head, pk, one events line, one declared-effects line per schema version), with `schema_version: 1` added to evidence documents. The four new shapes (anchored review verdict, review round, anchored spec-review verdict, anchored holdout) have no real instance yet; their examples are built from the parent's scenarios and the prose says so.

## 4. HOW

Build order, each step leaving the suite green:

1. Validator extension in both copies, entrypoint guard, parity test, and the all-contract-schemas sweep. Stop and report if the sweep finds any changed result.
2. Confirm the L4 fixture assumption (below) before writing any run-ledger schema. If it does not hold, settle the fallback before step 3.
3. v0.3 schemas, manifest, examples, prose; bundled copy; README Versions row, draft rule, changelog.
4. `bin/lib/evidence.js`, registration, docs row (requires FAFF-1262 merged).
5. Remaining tests listed in DONE.

### Edge cases

- **Empty JSONL file:** zero lines, no violations.
- **Torn-only JSONL file:** the only line is skipped; file `ok` with `torn_tail: true`.
- **Anchor with `holdout.json` but no `build-progress.json`:** validated file by file; which files are required is the floor's job, not this command's.
- **Mixed anchor** (one evidence document stamped, another not): not legacy; the unstamped one fails with `missing required property "schema_version"`.
- **`pk.json` only, no evidence documents:** legacy (nothing carries `schema_version`).
- **Discriminator value of the wrong type** (`"schema": "2"`): `String("2")` matches mapping `"2"`, then the sub-schema's `schema` enum `[2]` rejects the string. The type error is still reported.
- **Anchor-relative path with a backslash on Windows:** paths are normalised to POSIX separators before manifest lookup.

### Failure modes

- **The run-ledger schema is wrong about a writer.** How you'd know: slice 3's serialiser refuses a ledger an in-flight run writes. What it means: proceed; v0.3 is draft until FAFF-1261, so slice 3 widens or narrows it in place.
- **Strict v0.1 enforcement surprises an outside consumer.** How you'd know: someone validating a real ledger with `validate-schema.mjs` against v0.1 sees `value not in enum`. What it means: proceed; v0.1 says the same thing in its text, and v0.3 is the current description.
- **Validator copies diverge later.** How you'd know: the parity test fails. What it means: block the PR.

**Anti-pattern:** reading schemas from `verification/` at runtime. Why: it does not ship to adopters, and in an adopter run the working checkout belongs to the party being audited.

**Anti-pattern:** adding a committed ledger to the exceptions list to make a test pass. Why: the list records writer bugs in old data; a new failure means the schema misreads a writer.

## Scenarios

```
Given a copy of committed anchor run-20261010-213749-graft-FAFF-1213/FAFF-1213, which holds exactly seven files (events.jsonl, declared-effects.jsonl, chain-head.json, effects-chain-head.json, run-ledger.json, ac-checklist.json, review-verdict.json; checked 2026-10-13)
And "schema_version": 1 inserted into run-ledger.json, with ac-checklist.json and review-verdict.json replaced by the v0.3 valid examples
When `faff evidence validate <copy> --json` runs
Then it exits 0 with status "pass", and every file in the copy, including events.jsonl and declared-effects.jsonl, has status "ok"
```

```
Given the same copy with one events.jsonl line edited to add "extra": 1 and the file's trailing newline removed after a final partial line "{\"sch"
When `faff evidence validate <copy> --json` runs
Then it exits 1 with status "fail", events.jsonl lists `line N: additional property "extra" not allowed` for the edited line, and the file carries torn_tail: true with no violation for the partial line
```

- The validator copies return identical violation arrays, element for element, for every case in the parity fixture table.
- A v0.3 schema containing `"type": ["objet", "null"]` yields `schema error: unknown type objet` from both validator copies.

## 6. DESIGN DECISION RATIONALE

- **How do new keywords interact with type?** Gating on the declared type alone would skip checks on union-typed fields. **Chosen:** apply by data kind after the type check passes.
- **Edit v0.1 schemas, gate the new keywords, or accept stricter v0.1?** Editing breaks immutability; a gate adds a mode flag to both validators for schemas nobody validates real data against. **Chosen:** accept stricter v0.1; v0.3 fixes the outcome gap.
- **Parity test: spawn the `.mjs` or import it?** Spawning needs a temp file per case and compares exit codes, not messages. **Chosen:** guard `main()` and import.
- **Can slices 2 to 5 edit v0.3 after slice 1 publishes it?** The README says published directories are immutable, but the parent plans additions to v0.3. **Chosen:** v0.3 is draft until FAFF-1261.
- **How do manifest schema paths resolve in both locations?** Repo-relative paths and references into v0.2 or the Commissaire spec do not exist in an install. **Chosen:** v0.3 self-contained, paths relative to the manifest, with drift tests for restated shapes.
- **How closed is the run ledger?** Agent-written keys vary and resume logic reads key presence. **Chosen:** every level closed, two required keys, types from documented writers, a named exceptions list for old writer bugs.
- **Close JSONL payloads now?** Per-type closure is slice 5. **Chosen:** close the envelope per record version, payloads open.
- **What does `validate` return for a legacy anchor?** **Chosen:** exit 0 by default, 1 under `--require-evidence-schema`, no partial checks, mirroring `verifyExitCode`.
- **Where does the CLI read schemas?** **Chosen:** the bundled copy, by its own path.
- **Keep `declaredEffectViolations` in this slice?** It is the only live write-path change. **Chosen:** split to FAFF-1262, which blocks this slice.
- **How is the contract-wide tightening shown to be harmless?** **Chosen:** a permanent sweep of every contract and evidence schema against its fixtures, run as build step 1.
- **Unknown names in a `type` array?** Ignoring them fails open. **Chosen:** schema error in arrays, plus a v0.3 lint on every `type` value.
- **Which region?** The module requires only governance modules and later serves the mint and governance-check. **Chosen:** governance.
- **Real or constructed examples?** The README asks for real artifacts where they exist. **Chosen:** real where they exist, constructed and labelled otherwise.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None. The parent's open product question (JSONL payload schemas) is resolved and lands in FAFF-1260.

### Assumptions

- **Assumes:** FAFF-1262 is merged before step 4. Validation: `require("./effects").declaredEffectViolations` is a function on the branch base.
- **Assumes:** the existing L4 mint fixture in `test/lights-out.test.mjs` can produce a full L4 `run-ledger.json` in a temp directory. Validation (build step 2, before any run-ledger schema is written): find the test that asserts `guardrail_claim`, and confirm it reads back a minted ledger. If it cannot, call the mint path that test uses directly from the new schema test.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] `faff evidence validate` over every git-tracked `.faff/anchors/*/*/` directory reports `legacy` and exits 0; with `--require-evidence-schema` each exits 1 (new test `test/evidence-validate.test.mjs`)
- [ ] No code path outside `bin/faff`, `bin/lib/evidence.js`, `bin/lib/regions.js` and the two validator copies changes: `git diff --stat main` lists no other `bin/` file
- [ ] The full suite passes with no edits to existing test files or fixtures other than `test/evidence-spec.test.mjs` `PAIRS` rows: `git diff main --stat -- test/` lists only new files and `test/evidence-spec.test.mjs`

### From WHAT (validator)
- [ ] `test/validator-extension-sweep.test.mjs` runs every contract schema against every golden case and example, and every `verification/**/schema` schema against its examples, and asserts each pair's pass/fail result equals the unextended validator's (recorded once as a fixture from `main`)
- [ ] A test asserts every `type` value in every v0.3 schema is one of `object`, `array`, `string`, `boolean`, `number`, `integer`, `null`; both validator copies return `schema error: unknown type` for an unknown name inside a `type` array
- [ ] `test/validator-parity.test.mjs` runs one fixture table (every keyword in the subset, each new keyword passing and failing, nesting through properties, items and `additionalProperties` schemas, a discriminator miss and hit, an invalid pattern) through both copies and asserts `deepStrictEqual` per case, and pins the exact message for each new keyword
- [ ] `node plugin/skills/faff/contracts/validate-schema.mjs --selftest` exits 0, and importing the module runs no `main()` (the parity test imports it without the process exiting)
- [ ] `test/external-verification-protocol.test.mjs`, `test/evidence-spec.test.mjs`, `test/commissaire-facade-spec.test.mjs` and every `spec-judge-*.test.mjs` pass unchanged

### From WHAT (v0.3 and manifest)
- [ ] `test/evidence-spec.test.mjs` `PAIRS` has a row per v0.3 schema; each `.example.json` exits 0 and each `.invalid.example.json` exits 1 through `validate-schema.mjs`
- [ ] A test walks every v0.3 schema and asserts every node with `type` including `object` is closed, meaning `additionalProperties` is either `false` or a sub-schema (the issue-keyed maps in `run-ledger`, `claimed_by_peer`'s map form and the manifest's `files`), except `data`, `effect` and `payload` in the two JSONL schemas and the two JSONL base nodes that carry `discriminator` (whose mapped sub-schemas must each be closed); and that every evidence-document schema requires `schema_version` with `enum: [1]`
- [ ] `anchor-manifest.json` validates against `anchor-manifest.schema.json` and has exactly the 12 entries in the manifest table; a test mints an anchor with every optional file present (via `faff events anchor` on a fixture run dir) and asserts every produced file has a manifest entry
- [ ] A test asserts `plugin/skills/faff/contracts/evidence-v0.3/` and `verification/evidence/v0.3/` have the same relative file list and identical bytes
- [ ] A test asserts v0.3 `producer-pk` matches the Commissaire facade v0.2 `producer-pk`, and v0.3 holdout `attestation` matches `contracts/holdout-verdict.schema.json` `properties.attestation`, on `type`, `required`, `additionalProperties` and per-property `type`, recursively
- [ ] Every committed `chain-head.json` and `effects-chain-head.json` validates against v0.3 `chain-head`
- [ ] Every committed `build-progress.json` with `schema_version: 1` inserted validates against v0.3 `build-progress`
- [ ] Every committed `run-ledger.json` with `schema_version: 1` inserted validates against v0.3 `run-ledger`, except exactly the seven files in the exceptions table, each of which fails with a violation naming the stated key
- [ ] A ledger minted by the L4 fixture, with `schema_version: 1` inserted, validates against v0.3 `run-ledger`
- [ ] Every committed events line that `eventViolations(rec, true)` accepts also passes v0.3 `run-event`, and every committed declared-effects line that FAFF-1262's `declaredEffectViolations` accepts also passes v0.3 `declared-effect`
- [ ] An event built by `runResumeEvent` (resume.js), and one from every other in-code event builder that writes extra top-level keys, passes v0.3 `run-event`
- [ ] v0.3 `run-event` `type` enum equals `DELIVERY_PROFILE.event_types`, `phase` enum equals `event_phases`, and `run-ledger` `outcomes` values equal `ledger_outcomes` (asserted against the imported profile)
- [ ] `verification/evidence/README.md` lists v0.3 as draft, states the draft rule, and has a dated v0.3 changelog entry; the four v0.3 prose pages exist and every manifest entry is named in `anchor-manifest.md` (asserted by grep in the test)

### From HOW (`faff evidence validate`)
- [ ] The two Scenarios pass as tests in `test/evidence-validate.test.mjs`
- [ ] A mixed anchor exits 1 naming `missing required property "schema_version"`; a file with no manifest entry exits 1 with status `unschemaed`; a mid-file non-JSON line exits 1
- [ ] With the bundled manifest made unreadable (temp copy of the plugin tree, file removed), the command exits 2 and prints `schema-unavailable`
- [ ] `--json` output matches the REPORT shape; human output prints at most 5 violations per file
- [ ] A legacy anchor that also holds an unmanifested file reports `legacy` (exit 0), not `fail`
- [ ] For a field holding the sentinel string `S3CR3T-SENTINEL`, every violation message both validator copies produce (enum miss, type miss, pattern miss, discriminator miss) omits the sentinel; the enum message reads `value not in enum [...]`
- [ ] Every bundled example passes `redactKnownSecrets` unchanged, and no bundled example contains a session id, pid, hostname or login copied from a committed anchor
- [ ] `faff evidence --selftest` exits 0; `faff regions check` and `test/lint-cli-doc.test.mjs`, `test/lint-cli-coverage.test.mjs` pass; `REGION_MAP["evidence"]` is `"governance"`

### Integration smoke test

```
PROCEDURE smoke():
  1. Copy .faff/anchors/run-20261010-213749-graft-FAFF-1213/FAFF-1213 to a temp dir
  2. `faff evidence validate <tmp>` -> exit 0, "legacy"
  3. Insert schema_version: 1 into run-ledger.json; replace ac-checklist.json and review-verdict.json
     with the v0.3 valid examples
  4. `faff evidence validate <tmp>` -> exit 0, "pass"
  5. Delete schema_version from ac-checklist.json -> exit 1, "fail", naming ac-checklist.json
```

## Appendix A. Committed run-ledger survey (2026-10-13, 384 ledgers)

Top-level keys and observed types: `run_id` string; `admitted`, `requested`, `requested_issues`, `notes`, `prep_queue`, `prep_parked`, `review_adversarial_skipped`, `review_outage_pending`, `spec_review_outage_pending`, `spec_review_turn_budget_pending`, `landing_resumable`, `integrity_tampered`, `post_merge_verification_unverified` arrays of strings; `outcomes`, `outcome_details`, `routing_verdicts`, `verdicts`, `capabilities` issue-keyed maps; `owner`, `budget`, `abort` objects; `owner_history`, `abort_history`, `resume`, `park_records`, `post_merge_verification_failures` arrays of objects; `claimed_by_peer` array of strings or map of strings; `level`, `mode`, `phase_select`, `stop_reason`, `base_sha` strings; `base_sha_required` boolean; `discovered_scope_filed`, `no_progress_waves`, `attempts`, `schema` integers.

Nested shapes:

- `owner`: `status` (running, done, aborted-resumable), `pid` integer or null (`resume.js` writes null), `session_id` string or null, `started_at`, `last_heartbeat`, `harness`, `model` strings, `epoch` integer
- `abort`: `status`, `at`; `abort_history[]`: `status`, `at`, `issue`, `signal`; `owner_history[]`: `status`, `session_id`, `started_at`, `last_heartbeat`
- `resume[]`: `epoch` integer, `resumed_at`, `session_id`, `prior_state` strings, `plan_summary` object (shape from `resume.js`)
- `park_records[]`: `issue_id`, `root_cause_class`, `timestamp`
- `post_merge_verification_failures[]`: `issue`, `pr` integer, `merge_sha` string or null, `command`, optional `note` string, `environmental` boolean
- `budget`: `envelope` (shape from `envelopeFrom`: `ceilings`, `at_ceiling`, `pricing`, `price_per_mtok`, `window` object or null `{hours, tokens}` numbers, `note`, plus any keys `envelopeFrom` writes), `measure_root`, `measure_session_id` string or null, `tokens_at_start` integer, `tokens_at_start_by_model_class` and `tokens_at_start_by_class` maps of token counts, `tokens_at_last_event` token counts, `window` `{anchor_epoch, reset_epoch, tokens_at_anchor}` integers, `metering` `{source_at_mint, degraded}`
- Token counts: `input`, `output`, `cache_write`, `cache_read`, `cache_write_5m`, `cache_write_1h`, all optional integers
- `outcome_details[*]` keys: integers `rework_turns`, `discovered_scope`; `pr` integer or null; booleans `ac_present`, `review_present`, `resumable`, `ac_verified`, `merged`, `parked`; every other key a string: `note`, `verdict`, `root_cause`, `confidence`, `prep_disposition`, `resolve_attempt`, `park_comment`, `merge_sha`, `head_sha`, `review`, `ci`, `ac`, `post_merge`, `state`, `reason`, `gate`, `review_verdict`, `branch`, `park_class`, `route_class`, `merge_commit`, `integrity`, `outcome`, `head`, `reclaimed_from`, `reclaim_reason`, `build_tier`, `spec_review`, `disposition`, `pr_head_sha`, `post_merge_note`, `tracker_mutation`, `blocker`, `next_step_human`, `route_reason`, `adr`, `via`, `built_by`, `branch_head`, `spec_comment`, `merged_head`, `spec_confidence`, `reconciled`, `why`, `park`, `review_backend`, `class`, `resolved`, `resolved_at`, `prior_park_class`, `reconcile`, `acs`, `merge_block`, `delivery_gate`

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?**
- **What's there:** Four separable pieces, rated `build-tier: complex`:
  - (a) five validator keywords in two copies, plus a parity test;
  - (b) twelve v0.3 schemas, the manifest, examples, four prose pages and a bundled copy;
  - (c) `declaredEffectViolations`, wired into `appendEffectEntries`;
  - (d) the `faff evidence validate` command.
- **Why:** This is well past a 1–3 day unit. Piece (c) is the only change to a live write path, and it is independent of (a) and (b) apart from one DONE cross-check.
- **What to do:** Split (c) into its own ticket, or at minimum ship it as its own commit so it can be reverted alone. **Actioned:** split to FAFF-1262.

**Workstream fit?** No issues.

**Deps surfaced?**
- **What's there:** Two pieces of parent scope have no ticket:
  - the warn-only mint mode, which no slice owns;
  - the facade v0.2 `accepted_under_contract` vs `conformed_to_contract` drift.
- **Why:** Work that has no ticket gets forgotten, and FAFF-1261 could switch on enforcement before anyone decides whether warn-only comes first.
- **What to do:** File both as Backlog tickets, and make FAFF-1261 blocked by the warn-only ticket (or record a decision to drop it). **Actioned:** FAFF-1263 (blocks FAFF-1261) and FAFF-1264.

**Risk profile?**
- **What's there:** The closed `run-ledger` schema is the riskiest piece. Its keys come partly from SKILL prose, it carries seven exceptions, and the L4 fixture assumption is unverified. The validator change also tightens every `faff contract` call through `schemaCheck`.
- **Why:** A wrong ledger schema only surfaces in slice 3, when an in-flight ledger gets refused.
- **What to do:** Check the L4 fixture assumption before writing the schema, and run the validator change against every contract schema early in step 1. **Actioned:** both are now build steps 1 and 2.

confidence: high
build-tier: complex
spec-review: accept (human, L2; round-2 minors fixed, not re-reviewed)