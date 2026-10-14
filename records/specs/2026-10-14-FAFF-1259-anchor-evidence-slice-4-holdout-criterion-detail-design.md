# Holdout criterion detail and `faff holdout record` (FAFF-1259)

> Spec: faffter-dark-nlspec · 2026-10-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1259.

> Revised on 2026-10-13 after spec review round 1: record identity pinned to `--issue`, bearer-token scrub on the inline path, redact before truncate, refused records no longer latch the resume skip, the caged store copy brought into scope, and FAFF-1263 linked as blocked by this slice. Round 2 minors fixed: refusals reach both copies on the caged path, absolute caged paths, credentials passed through the environment rather than a file, and a resume skip keyed on violations.

This spec is for the build agent picking up FAFF-1259, slice 4 of FAFF-1255, and for its reviewers. It narrows the approved FAFF-1255 design to the holdout evidence document: the evaluator reports what it ran and what it saw for each criterion, and one shared writer turns its block into the v0.3 `holdout-anchored` shape for both the global store and the run-scoped copy the merge floor reads.

## 1. WHY

**The idea the rest depends on.** A holdout verdict today says only `{class, verdict, evidence_present}` per criterion, so the anchor cannot show what was checked. The evaluator already knows what it exercised; this slice makes it say so in the verdict block, and gives that block exactly one writer (`buildHoldoutRecord` in a new `bin/lib/holdout-record.js`) that both `faff holdout record` and the caged `evaluate-call.mjs` spawner call. The writer adds detail and a fixed key set; it never changes a gate input, so `computeHoldoutVerdict`, `readHoldout` and `faff merge-gate` route exactly as before on the same `class`, `verdict`, `evidence_present`, `aggregate`, `code_blind` and attestation values.

**Problem.** Anchored `holdout.json` files cannot be audited: a reader sees "met" with no request, expectation or observation behind it. They are also written two ways (the evaluator or its caller by hand on the inline path, `writeFileSync` in the spawner on the caged path) with no shared shape, and the caged path never writes the store copy that beep-boop's run roll-up reads. This slice adds per-criterion detail, a single writer with path and identity guards, and graft and beep-boop wiring that pipes the evaluator's block through it.

### Design principles

- **The evaluator stays code-blind.** Detail fields describe what was sent to and observed from the running env, derived from the trusted criterion text. Nothing in this slice hands the evaluator the diff, the codebase or a repo path, and the evaluator itself writes no file.
- **The spawner keeps owning attestation.** Only the caged spawner may set `spawner_attested: true` and `attestation`. The CLI path always writes `spawner_attested: false` and `attestation: null`, whatever its input claims.
- **Refusal never fails open.** Every holdout consumer reads an absent verdict as "holdout did not run" and steps aside: the merge floor (`readCanRun` returns `absent`, posture `pass-through`) and graft Step 10's `faff holdout verdict` belt ("a missing verdict is not a block"). So a writer that rejects the evaluator's block must still leave a fail-closed `needs-human` record behind, never nothing.
- **Freshness by construction.** The run-scoped copy is written by atomic rename after the Step 8b build-complete checkpoint, so its mtime is later than `build-progress.json`'s `updated_at` and `readHoldout`'s freshness check holds.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faffter-noon-evaluate/SKILL.md` | Markdown | Evaluator contract block and persistence prose this slice changes |
| `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` (`assembleEnvelope`, `redactCredential`, `main` write at ~264) | ESM JS | Caged spawner; moves onto the shared writer |
| `plugin/skills/faff/bin/lib/admissibility.js` (`cmdHoldout` ~1003, `HOLDOUT_SURFACE`, `dodClassify` ~226) | CJS JS, region factory | Home of `faff holdout`; `dod classify` gains criterion ids |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeHoldoutVerdict` ~884, `holdoutGateResult` ~1475) | CJS JS, region factory | Gate; unchanged, ignores detail keys |
| `plugin/skills/faff/bin/lib/merge-gate.js` (`readHoldout` ~886, `readCanRun` ~925) | CJS JS | Freshness and absent-means-pass-through readers this slice must respect |
| `plugin/skills/faff/bin/lib/contract-engine.js` `validateAgainstSchema`, `redact.js` `redactKnownSecrets` | CJS JS, region governance | Validator (extended by FAFF-1256) and secret redaction the writer reuses |
| `plugin/skills/faff-beep-boop/SKILL.md` 10b `holdout_step`, `plugin/skills/faff-graft/SKILL.md` Step 8c | Markdown | Caller that persists the verdict today |
| `plugin/skills/faffter-dark-adversarial-review/review-spawn.mjs` | ESM JS | Precedent for a skill-dir script importing `../faff/bin/lib/` |

**Scope.** The holdout evidence writer between the evaluator and the run dir; it sits upstream of the mint (FAFF-1261) and beside the other evidence writers (FAFF-1257, FAFF-1258).

## Already shipped against this surface

- **FAFF-384** (Done): the caged spawner, `spawner_attested` and `attestation`, and the `--require-spawner-attested` ratchet. This slice keeps that trust topology and routes the spawner's write through the shared writer.
- **FAFF-852** (Done): credentials on the spawn payload and `redactCredential`. Today it scrubs only `aggregate` and `violations`, and only on the caged path; this slice scrubs the bearer token from every string the record carries, on both paths.
- **FAFF-311** (Done): `faff holdout verdict --issue`, with the `^[A-Za-z0-9][A-Za-z0-9._-]*$` id guard this slice reuses for `record`.
- **FAFF-1256** (prepped, blocks this slice): publishes `verification/evidence/v0.3/schema/holdout-anchored.schema.json`, its bundled copy under `plugin/skills/faff/contracts/evidence-v0.3/`, and the validator keywords it needs.

## 2. OUT OF SCOPE

- **Mint-time checks of `holdout.json`** (schema, writer-only constraints, `issue` matching the anchor). Why: warn-only is FAFF-1263 and refusal is FAFF-1261. Extension point: they call `holdoutRecordViolations` exported here; FAFF-1263 is linked as blocked by this slice so it never ships a schema-only holdout check.
- **Gate changes.** Why: the parent keeps `computeHoldoutVerdict`, `contracts/holdout-verdict.schema.json` and `readHoldout` unchanged. Extension point: none needed; detail is invisible to them.
- **Rewriting existing store files or committed anchors.** Why: anchors are immutable. Extension point: a read-side legacy adapter in reporting.
- **Shared writer helpers for the other evidence writers.** Why: FAFF-1257 is prepped in parallel (linked as related). Extension point: the id guard, containment check and atomic write in `holdout-record.js` are exported so FAFF-1257 can reuse them; whichever slice lands second reuses the first's helpers rather than adding a copy, and its review checks for a duplicate.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Evaluator block | The `faff-contract:holdout-verdict` JSON the evaluator emits (inline path) or the inner evaluator returns to the spawner (caged path) |
| Holdout record | The v0.3 `holdout-anchored` document the writer produces |
| Store copy | `.faff/holdout/<key>.json`, read by `faff holdout verdict` and `faff holdout verdicts`; `<key>` defaults to the issue |
| Run copy | `<run-dir>/<issue>/holdout.json`, read by the merge floor and minted into the anchor |
| Fail-closed record | A conforming holdout record with `aggregate: "needs-human"`, `criteria: []` and a violation naming why the evaluator block was refused |

### Criterion ids from `faff dod classify`

`dodClassify` gains an `id` per criterion: `"<source>:<n>"`, where `source` is `scenarios` or `done` and `n` is the 1-based position among that source's criteria in classify order. The field is additive; `counts`, `holdout_counts` and every other key are unchanged.

**Chosen:** classify mints the id, not the evaluator. The parent says the id comes from `faff dod classify`, which emits none today; minting it in the evaluator would make an LLM responsible for a mechanical value. Ids stay stable when integration-tier criteria are excluded from the verdict (gaps in `n` are expected).

### Evaluator block (additive fields)

```
RECORD EvaluatorCriterion:                 # one entry in the block's criteria[]
  class, verdict, evidence_present         # unchanged gate fields
  id: String                               # copied from `faff dod classify`
  text: String                             # copied from `faff dod classify` (holdout prefix already stripped)
  holdout: Boolean                         # copied from `faff dod classify`
  exercised: String | null                 # what was run against the env: method + path + body, command, or RPC call sequence
  expected: String | null                  # what the criterion text requires to be observed
  observed: String | null                  # what the env returned (status, body excerpt, state read)
  evidence_ref: String | null              # pointer into the prose evidence report (heading or anchor)
  reason: String | null                    # why no check ran: prose criterion, no surface, wire error, env fault
```

The block keeps `aggregate`, `code_blind` and `violations` as today. The evaluator SKILL's credential rule (never persist a token; redact it in evidence) applies to every detail field.

### Holdout record

The shape is FAFF-1255's `HoldoutAnchored` exactly, as published by FAFF-1256 in `holdout-anchored.schema.json`:

```
RECORD HoldoutRecord:
  schema_version: 1
  issue: String                      # what the verdict was produced for: --issue on the CLI, --key on the spawner
  aggregate: "meets-spec" | "gaps" | "fails" | "needs-human"
  code_blind: Boolean
  spawner_attested: Boolean          # always present
  attestation: Attestation | null
  violations: List<String>
  criteria: List<HoldoutCriterion>   # HoldoutCriterion = EvaluatorCriterion with every key present

CONSTRAINT (writer-only) verdict in {met, unmet} => exercised, expected, observed non-null
CONSTRAINT (writer-only) verdict = needs-human => reason non-null
CONSTRAINT (writer-only) id matches ^(scenarios|done):[1-9][0-9]*$
CONSTRAINT (writer-only) text, exercised, expected, observed, evidence_ref, reason each <= 2000 characters (enforced by truncation)
```

**Chosen:** `issue` is the value of `--issue` (the CLI) or `--key` (the spawner, which has one id). In practice it is the issue id for the per-issue graft gate and the run id for the per-run beep-boop phase, because callers pass the same id for both. `--key` only names the store file, and the identity guard compares the stored `issue` with `--issue`, so a file's recorded `issue` always equals the `--issue` of the call that wrote it. The parent names the field `issue` and FAFF-1256 publishes it as a plain string; a run-keyed record therefore carries the run id. This slice adds one sentence saying so to `verification/evidence/v0.3/evidence-documents.md` (v0.3 is draft until FAFF-1261, so slices may edit it in place).

### Library: `plugin/skills/faff/bin/lib/holdout-record.js`

New CommonJS module, `region:governance` (so the FAFF-1261 mint in `events.js` can call it). Requires only governance and shared-infra modules: `contract-engine` (`validateAgainstSchema`), `redact`, `shared-infra`.

```
INTERFACE holdout-record:
  buildHoldoutRecord(block, opts) -> { ok: Boolean, doc: HoldoutRecord, bytes: String, refusals: List<String> }
    opts.issue: String                         # required; already id-guarded by the caller
    opts.envelope?: { code_blind, spawner_attested, attestation, violations }   # caged spawner only
    opts.secretValues?: List<String>           # for redactKnownSecrets; default resolveKnownSecretValues()
    opts.extraSecrets?: List<String>           # the env's bearer token, if any (both paths)
  holdoutRecordViolations(doc) -> List<String>   # schema + writer-only constraints; messages name key paths, never values
  writeHoldoutRecord(path, bytes) -> void        # temp file in the same dir + rename; throws on IO fault
  isSafeHoldoutKey(s) -> Boolean                 # ^[A-Za-z0-9][A-Za-z0-9._-]*$ and no ".."
  resolveContained(base, rel) -> String | null   # containment check on the realpath of the deepest existing ancestor
                                                 # plus the lexical remainder; null when it escapes or a component is a symlink
```

`bytes` is deterministic: keys in schema declaration order at every level, two-space indent, trailing newline. Identical input gives identical bytes.

### CLI: `faff holdout record`

```
faff holdout record --issue I [--key K] [--run-dir D] [--credentials-env VAR] [--json]
  stdin: the evaluator block (JSON, or a markdown body containing exactly one faff-contract:holdout-verdict fence)
  writes: <root>/.faff/holdout/<K>.json; with --run-dir, also D/I/holdout.json (identical bytes)
  --credentials-env: names an environment variable holding the env-handle's `credentials` object as JSON; its bearer
                 token is added to extraSecrets. The variable is set for this one invocation only, so the synthetic
                 credential stays in transit and is never written to a file. An unset variable or unparseable JSON exits 2;
                 the value is never echoed in a diagnostic
  --json: print the written record to stdout (the human form prints one line naming the paths and the exit meaning)
```

| Exit | Meaning | Written |
|---|---|---|
| 0 | Block accepted | The holdout record, to every requested path |
| 1 | Block refused (unparseable, schema violation, or writer-only constraint) | A fail-closed record, to every requested path; refusals on stderr |
| 2 | Usage, path guard, identity guard or IO fault | Nothing |

Guards, all exit 2 before any write:

- `--issue` and `--key` (default `--issue`) pass `isSafeHoldoutKey`.
- `<root>` is `findRoot()`; the store path resolves inside `<root>/.faff/holdout/` and `--run-dir` inside `<root>/.faff/runs/`, both by `resolveContained`. Containment is checked before any directory is created, and creation goes no further than the checked path.
- The run copy resolves inside `<run-dir>/<issue>/`; that directory is created when absent.
- All guards run before any write. The store copy is written first and the run copy second, each atomically; an IO fault on the second write exits 2 and leaves the first in place.
- An existing store file that parses and carries a string `issue` different from `--issue` is never overwritten. A store file with no `issue` (written before this slice) is overwritten. A store file that does not parse is renamed aside to `<key>.json.unparseable-<UTC timestamp>` before the write, so nothing is silently destroyed.

**Chosen:** a refused block still produces a record, and exit 1 means "refused, fail-closed record written". The parent's general writer rule is "exit 1, nothing written", but for holdout an absent copy is read as "did not run" (`readCanRun` returns `absent` at the floor, and graft Step 10 treats a missing store copy as no block), so writing nothing would turn a malformed verdict into a pass-through. A fail-closed `needs-human` record with a non-empty `violations` list is blocked by `holdoutGateResult` instead.

**Chosen:** the identity guard (`issue` mismatch on the store file) exits 2 rather than the parent's exit 1. It is an operator or path fault like the containment guard, not a fault in the evaluator's block, and writing a fail-closed record over another issue's verdict is exactly what the guard prevents.

**Chosen:** the CLI ignores `spawner_attested` and `attestation` in its input and writes `false` and `null`. Only the caged spawner calls `buildHoldoutRecord` with an `envelope`, so a self-attesting inline evaluator cannot launder a spawner attestation through the CLI. `code_blind` passes through as today (a boolean, else `false`).

### Spawner: `evaluate-call.mjs`

- Imports the library through `createRequire(import.meta.url)("../faff/bin/lib/holdout-record.js")`, resolved relative to its own file (the `review-spawn.mjs` precedent).
- `--key` becomes required and must pass `isSafeHoldoutKey` (exit 2 otherwise); it is the record's `issue`.
- Builds the record with `buildHoldoutRecord(res.verdict, { issue: key, envelope: <deriveAttestation result as today>, extraSecrets: [bearer token] })` and writes `bytes` to `--out` with `writeHoldoutRecord`. `deriveAttestation` and the refuse-to-attest rules are unchanged. `assembleEnvelope` is removed; its selftest checks move onto the shared call.
- `redactCredential` is removed: passing the bearer token as `extraSecrets` scrubs it from every string in the record, including each criterion's detail fields, through the same `redactKnownSecrets` pass both paths use. The token is replaced with `[REDACTED]`, the shared placeholder.
- New optional `--store-out FILE`: when present, the spawner writes the same bytes to it too, refusing (exit 2, nothing written) when an existing file there records a different `issue`. Beep-boop's caged dispatch passes `--store-out <abs repo root>/.faff/holdout/<key>.json`, which closes the gap where step 5 confirmed a store copy the caged path never wrote.
- When the record is refused (`ok: false`), the spawner writes the fail-closed record to `--out` and, when given, `--store-out`, then exits `EXIT.OTHER` (1), which callers already read as `needs-human`. Both copies always hold the same bytes.
- The `--store-out` identity check runs before either write, so an identity refusal (exit 2) writes neither copy.
- The spawner passes `secretValues: []` explicitly: the cage withholds the repo config `resolveKnownSecretValues` reads, so the bearer token in `extraSecrets` is its whole scrub set.

**Chosen:** the spawner keeps its own `--out` and `--store-out` paths and applies no repo-root containment check. It runs in the neutral cage with the repo withheld, so it cannot resolve `<root>`; the trusted orchestrator resolves both to absolute paths on the shared `.faff/` volume before dispatch. The key guard still applies because the key becomes the record's identity.

## 4. HOW

### Writer

Summary: normalise the block into the fixed v0.3 shape, check it, and when it fails produce a fail-closed record instead of nothing.

```
PROCEDURE buildHoldoutRecord(block, opts):
  1. IF block is not a JSON object -> RETURN refused(["evaluator block is not a JSON object"])
  2. secrets = opts.secretValues ?? resolveKnownSecretValues(); add opts.extraSecrets
  3. criteria = for each block.criteria[i] (non-array -> []):
       pick id, text, holdout, class, verdict, evidence_present, exercised, expected, observed, evidence_ref, reason
       absent string fields -> null; absent holdout -> false; absent evidence_present -> false
       drop every other key
  4. top = { schema_version: 1, issue: opts.issue, aggregate: block.aggregate, violations: strings of block.violations }
     IF opts.envelope: code_blind, spawner_attested, attestation from envelope; append envelope.violations
     ELSE: code_blind = (block.code_blind === true); spawner_attested = false; attestation = null
  5. doc = redactKnownSecrets(top + criteria, secrets)          # redact BEFORE truncating, so no secret is cut in half
     then truncate text and each detail string longer than 2000 (JS string length) to its first 1988 + "…[truncated]",
     stepping back one more when the cut would split a surrogate pair
  6. refusals = holdoutRecordViolations(doc)
  7. IF refusals non-empty -> RETURN refused(refusals) carrying doc's issue, code_blind, spawner_attested, attestation
  8. RETURN { ok: true, doc, bytes: serialise(doc), refusals: [] }

PROCEDURE refused(refusals):
  doc = { schema_version: 1, issue, aggregate: "needs-human", code_blind: <step-4 value or false>,
          spawner_attested: <step-4 value or false>, attestation: <step-4 value or null>,
          violations: ["holdout record refused: " + r for r in refusals], criteria: [] }
  RETURN { ok: false, doc, bytes: serialise(doc), refusals }
```

`holdoutRecordViolations` runs the bundled v0.3 `holdout-anchored` schema through `validateAgainstSchema`, then the writer-only constraints. It is pure and is the function FAFF-1263 and FAFF-1261 call at mint.

**Anti-pattern:** recomputing or "fixing" `aggregate`, a `verdict` or `evidence_present` in the writer. Why: those are the evaluator's judgement and the gate's inputs; the writer only shapes and refuses. `computeHoldoutVerdict` already reports an inconsistent aggregate.

**Anti-pattern:** having the evaluator call `faff holdout record` itself. Why: the evaluator writes no files; its caller owns persistence, as the spawner does on the caged path.

### Evaluator SKILL changes (`faffter-noon-evaluate/SKILL.md`)

- **Classify step:** carry each criterion's `id`, `text` and `holdout` from `faff dod classify` into the block unchanged.
- **Exercise step:** record `exercised`, `expected` and `observed` for every `met` and `unmet` criterion, and `evidence_ref` when the prose report has a matching section. Every `needs-human` criterion carries a `reason` (prose, no surface, wire error code, credentials not derivable, env not ready).
- **Excerpt rule:** `observed` quotes only the part of a response the criterion asserts on (status, the named field, the error code), never a whole body or header set.
- **Roll up + emit:** emit the block only. Remove the instruction to persist the block to `.faff/holdout/`; the caller persists it through `faff holdout record`.
- **Output example:** show one criterion of each verdict with its detail fields.

### Caller wiring

Summary: the caller pipes the evaluator block through the writer before validating it, so a rejected verdict is still on disk and blocks.

```
PROCEDURE holdout_step persistence (beep-boop 10b, steps 3 to 5; graft Step 8c calls this unchanged):
  inline path (no cage promise):
    1. pipe the evaluator block to `faff holdout record --issue <key> [--run-dir <run-dir> when key is an issue id]
       with FAFF_HOLDOUT_CREDENTIALS=<the handle's credentials JSON> --credentials-env FAFF_HOLDOUT_CREDENTIALS
       when the handle carries credentials]`
       exit 0 or 1 -> a record is on disk; exit 2 -> needs-human, surface the guard message, go to teardown
    2. pipe the store copy to `faff contract holdout-verdict` (unchanged rules, unchanged ratchet flag)
  caged path (cage promise present):
    1. `evaluate-call.mjs ... --key <key> --out <abs run-dir>/<key>/holdout.json --store-out <abs repo root>/.faff/holdout/<key>.json`
       exit 1 -> the fail-closed record is on disk; route needs-human as today
    2. pipe the run copy to `faff contract holdout-verdict --require-spawner-attested` (unchanged)
```

**Chosen:** record before contract validation on the inline path. The caged path already writes the run copy before step 4's contract check, so a rejected caged verdict is on disk and blocks; the inline path today can leave nothing on disk after a contract rejection, which the floor reads as pass-through. Putting the writer first makes the two paths agree, in the fail-closed direction.

Beep-boop 10b step 5 changes from "Confirm the evaluator persisted `.faff/holdout/<key>.json`" to "Confirm `.faff/holdout/<key>.json` exists (written by `faff holdout record` or the spawner's `--store-out`)".

Graft Step 8c's `holdout_run` comment changes from "writes holdout.json to .faff/holdout/<issue>.json AND <run-dir>/<issue>/holdout.json" to naming `faff holdout record` (inline) or the spawner (caged) as the writer. The trigger rules are unchanged. The idempotency skip gains one condition: it fires only when the fresh `holdout.json` has an empty `violations` list. Any record carrying violations (a writer refusal, a spawner refuse-to-attest, an env that never came up) is retried on resume rather than latched; the merge floor still blocks on it until a later run replaces it.

**Chosen:** retry any record with violations on resume rather than keep the plain mtime skip. Violations mark a fault in producing the verdict, not a judgement about the feature, and the plain skip would make one faulty attempt permanent for the run with no documented way out except deleting the file by hand. A clean `gaps` or `fails` verdict has no violations and is still skipped.

### Edge cases

- **Env never came up:** evaluator emits `aggregate: needs-human`, `criteria: []` and a violations note; the writer accepts it (no `minItems` on holdout criteria).
- **Zero-detail legacy evaluator block** (an evaluator that predates this slice): every `met`/`unmet` criterion lacks `exercised`, so the record is refused and fail-closed. This is intended: the evaluator SKILL and the writer ship together.
- **Credential echoed into `observed`:** the CLI path scrubs known config secrets and, when the env-handle carries one, the bearer token (via `--credentials-env`); the spawner scrubs the bearer token from its existing `--credentials`.
- **A secret neither path can recognise** (for example a third-party token the feature proxies into a response body): not caught by the writer. The evaluator SKILL's new excerpt rule (below) is the control; env credentials are synthetic and local-only, per the env slot. Redaction runs before truncation, so a token straddling the 2000-character cut is still removed.
- **Fresh run dir:** `<run-dir>/<issue>/` is created by the writer when absent.
- **Store file for the same issue from an earlier run:** overwritten (same `issue`).
- **Resume carry-forward** (`cp .faff/resume/<ISSUE>/*.json`): unchanged; the copied file's mtime is the copy time, as today.

### Failure modes

- **Evaluators leave detail out.** How you'd know: holdout records whose violations start `holdout record refused:` in beep-boop runs after this ships, or the new eval case failing. What it means: tighten the evaluator SKILL prose; never relax the constraint, since a "met" with no observation is the audit gap this slice closes.
- **Detail is too vague to audit** (for example `observed: "ok"`). How you'd know: reviewers reading anchors cannot reconstruct the check. What it means: proceed; the schema guarantees presence, not quality, and the eval case is the quality signal.
- **The fail-closed record blocks merges that used to pass through.** How you'd know: `pr-open-for-human` returns citing `holdout record refused` on the inline path. What it means: that verdict was malformed and previously passed the floor by absence; the block is the correct outcome.

## Scenarios

```
Given a spec whose DoD classifies to one scenario and one prose criterion, and an evaluator block with the scenario met (exercised "POST /orders {...}", expected "201 and an order id", observed "201 Created; body {\"id\":\"ord-1\"}") and the prose criterion needs-human with reason "prose criterion"
When the block is piped to `faff holdout record --issue FAFF-1 --run-dir <run-dir>` after the build-complete checkpoint
Then it exits 0, the store copy and the run copy are byte-identical, the run copy shows id "scenarios:1" with its exercised, expected and observed text and the prose criterion's reason
And `readHoldout(<run-dir>, "FAFF-1")` returns "meets-spec" and `faff holdout verdict --issue FAFF-1` reports gate "pass", as they did for the same block without detail
```

```
Given an evaluator block whose only criterion is met with exercised null
When it is piped to `faff holdout record --issue FAFF-1 --run-dir <run-dir>`
Then it exits 1, the run copy holds aggregate "needs-human", criteria [] and a violation starting "holdout record refused:"
And `faff holdout verdict --issue FAFF-1` reports gate "block"
```

```
Given `.faff/holdout/FAFF-1.json` recorded for issue FAFF-1
When `faff holdout record --issue FAFF-2 --key FAFF-1` runs
Then it exits 2 and both files are unchanged
```

```
Given a caged run whose inner evaluator echoes the bearer token into a criterion's observed text
When `evaluate-call.mjs` writes --out
Then the written record contains "[REDACTED]" and not the token, the --store-out copy is byte-identical, and spawner_attested is true
```

```
Given an inline run whose env-handle carries a bearer token, and an evaluator block whose observed text contains that token 10 characters before the 2000-character cut
When the caller pipes the block to `faff holdout record --issue FAFF-1 --credentials-env FAFF_HOLDOUT_CREDENTIALS`
Then the written record contains no prefix of the token
```

```
Given a run copy holding a fail-closed record written after the build-complete checkpoint
When graft resumes the run at Step 8c
Then the holdout step runs again instead of skipping
```

```
Given a caged run whose inner block is refused by the writer
When `evaluate-call.mjs --out A --store-out B` runs
Then it exits 1 and A and B hold the same fail-closed record
```

- `faff holdout record` invoked with an input that claims `spawner_attested: true` writes `spawner_attested: false` and `attestation: null`.
- No change in this slice gives the evaluator a repo path, a diff or a codebase file as input.

## 6. DESIGN DECISION RATIONALE

- **Who mints criterion ids?** The evaluator could number them, but that hands a mechanical value to an LLM. **Chosen:** `dodClassify` emits `<source>:<n>`.
- **What does a refusal leave on disk?** Nothing (the parent's general rule) fails open at the merge floor. **Chosen:** a fail-closed `needs-human` record, exit 1.
- **Exit code for the store identity guard?** Exit 1 would collide with "refused, record written". **Chosen:** exit 2, nothing written.
- **Can the CLI carry a spawner attestation?** Passing it through would let the inline path forge one. **Chosen:** the CLI always writes `false`/`null`; only the spawner passes an `envelope`.
- **Where does the library live?** In `admissibility.js` (factory) the FAFF-1261 mint in governance could not require it. **Chosen:** new governance module `holdout-record.js`.
- **How does the ESM spawner reach a CJS module?** Spawning `faff holdout record` from the cage needs a repo root the cage withholds. **Chosen:** `createRequire` relative to the spawner's own file, as `review-spawn.mjs` already does.
- **Record or validate first on the inline path?** Validating first can leave nothing on disk. **Chosen:** record first, matching the caged path.
- **What goes in `issue` for a run-keyed verdict?** A separate field would diverge from the published schema. **Chosen:** the run id, documented in the v0.3 prose.
- **Who persists on the inline path?** The evaluator does today. **Chosen:** the caller, through the CLI; the evaluator writes no file.
- **Which flag sets the record's `issue`?** `--key` would let one call label a file for another issue. **Chosen:** `--issue`; `--key` only names the store file.
- **How does the inline path learn the bearer token?** Prose redaction by the evaluator is what FAFF-852 judged insufficient, and a credentials file would persist a credential the env slot marks transit-only. **Chosen:** `faff holdout record --credentials-env`, set for the one invocation.
- **Fix the caged store copy here or in a follow-up?** This slice already rewrites the spawner's write path. **Chosen:** here, as `--store-out` on the shared writer.
- **Does FAFF-1263 wait for this slice?** Without the link it can ship a schema-only holdout check. **Chosen:** FAFF-1263 is blocked by FAFF-1259; FAFF-1261 already waits for both, so the enforcement date does not move.
- **Keep the resume skip for a refused record?** It would latch the refusal. **Chosen:** skip only records with no violations.
- **Truncate or refuse oversized detail?** Refusing would fail-close a correct verdict over a long response body. **Chosen:** truncate to 2000 characters including the `…[truncated]` suffix.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1256 has merged, so `plugin/skills/faff/contracts/evidence-v0.3/schema/holdout-anchored.schema.json` exists and `validateAgainstSchema` supports type unions. Validation: the file exists on the branch base and `faff evidence --selftest` exits 0.
- **Assumes:** the installed plugin keeps `faffter-noon-evaluate/` and `faff/` as sibling directories, so `../faff/bin/lib/holdout-record.js` resolves from `evaluate-call.mjs`. Validation: `review-spawn.mjs` already relies on the same layout; a test imports `evaluate-call.mjs` from the repo tree and runs `--selftest`.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] For a fixture run dir, `readHoldout` and `faff holdout verdict` return the same result for a block with detail fields as for the same block without them (`class`, `verdict`, `evidence_present`, `aggregate`, `code_blind` equal), with and without a cage-promising `lane-boundary.json`
- [ ] `test/merge-gate-local.test.mjs` and every `test/holdout-*.test.mjs` pass with no fixture edits
- [ ] A run copy written by `faff holdout record` after `build-progress.json`'s `updated_at` passes `readHoldout`'s freshness check

### From WHAT
- [ ] `faff dod classify --json` gives every criterion an `id` matching `^(scenarios|done):[1-9][0-9]*$`, numbered per source in classify order; all other output keys are unchanged
- [ ] `holdout-record.js` carries `region:governance`, requires no factory module, and `faff regions check` passes
- [ ] Every record `faff holdout record` writes with exit 0 validates against the bundled v0.3 `holdout-anchored` schema and has every key present
- [ ] `faff holdout record` exits 2 and writes nothing for an `--issue` or `--key` failing the id guard, a `--run-dir` outside `.faff/runs/` (including through a symlinked component), an unset or unparseable `--credentials-env` variable, and an existing store file recorded for a different issue
- [ ] `faff holdout record --issue FAFF-2 --key FAFF-9` on an empty store writes `FAFF-9.json` with `issue: "FAFF-2"`; an unparseable existing store file is renamed aside to `<key>.json.unparseable-<timestamp>` before the write
- [ ] `faff holdout record --run-dir D` creates `D/<issue>/` when absent; `--json` prints the written record
- [ ] `faff holdout record` writes `spawner_attested: false` and `attestation: null` even when the input claims otherwise
- [ ] `faff holdout record` produces byte-identical store and run copies, and byte-identical output for identical input
- [ ] `evaluate-call.mjs` requires `--key`, rejects an unsafe key with exit 2, and writes `--out` through `buildHoldoutRecord` and `writeHoldoutRecord`; `assembleEnvelope` no longer exists
- [ ] `evaluate-call.mjs` no longer defines `redactCredential`; the bearer token is absent from every string field of the record it writes, including criterion detail fields
- [ ] `evaluate-call.mjs --store-out F` writes bytes identical to `--out` on both the accepted and refused paths, and exits 2 writing neither file when `F` records a different `issue`
- [ ] `faff holdout record --credentials-env V` removes the bearer token in `$V` from every string field, including a token that straddles the 2000-character truncation point, and writes no file other than the two copies
- [ ] `docs/guide/cli.md` has a `holdout record` row; `HOLDOUT_SURFACE` lists `record` with required flag `--issue`; `test/lint-cli-doc.test.mjs` and `test/lint-cli-coverage.test.mjs` pass
- [ ] `verification/evidence/v0.3/evidence-documents.md` (and its bundled copy) states that a run-keyed record's `issue` is the run id

### From HOW
- [ ] `faff holdout record` exits 1 for a met or unmet criterion missing `exercised`, `expected` or `observed`, and for a needs-human criterion missing `reason`, and writes a fail-closed record that `faff holdout verdict` blocks
- [ ] An unparseable stdin exits 1 and writes a fail-closed record
- [ ] `holdoutRecordViolations` is exported, pure, and its messages name key paths but never field values (sentinel-string test)
- [ ] `faffter-noon-evaluate/SKILL.md` documents the detail fields and the excerpt rule, carries `id`/`text`/`holdout` from classify, and no longer tells the evaluator to write `.faff/holdout/`
- [ ] Beep-boop 10b `holdout_step` pipes the inline-path block to `faff holdout record` (with `--credentials-env` when the handle carries credentials) before `faff contract holdout-verdict`; the caged dispatch passes `--store-out`; step 5's wording names the writers; graft Step 8c names the writers
- [ ] Graft Step 8c's idempotency skip does not fire for a fresh record with non-empty `violations` (a test or selftest over the skip predicate)
- [ ] `test/dod.test.mjs` and `test/admissible.test.mjs` pass with no edits other than new assertions on `id`
- [ ] If FAFF-1257 has merged with an equivalent id guard, containment check or atomic write, this slice uses it instead of adding its own
- [ ] `evaluate-call.mjs --selftest` and `faff holdout --selftest` exit 0 and cover the refused, accepted and attested cases
- [ ] `faff contract holdout-verdict` exits 0 on an accepted holdout record

### From HOW (edge cases)
- [ ] An env-not-ready block (`criteria: []`, `aggregate: needs-human`) is accepted (exit 0)
- [ ] A detail string of 5000 characters is written with JS length exactly 2000, ending `…[truncated]`; a cut that would split a surrogate pair steps back one
- [ ] A known config secret placed in `observed` is written as `[REDACTED]`

### Eval coverage
- [ ] The `holdout-exercise` grader gains an opt-in detail check (fixture flag `check_detail: true`) that adds a `<key>:detail-ok` pair for each criterion passing `holdoutRecordViolations`' per-criterion rules; one new case `eval/cases/holdout-exercise-003.json` uses it, registered under the existing `holdout-exercise` seam row; existing cases are unaffected

### Integration smoke test

```
PROCEDURE smoke():
  1. Create a temp repo with .faff/runs/run-x/FAFF-1/build-progress.json (updated_at = now - 1 min)
  2. Pipe a met-scenario block with detail to `faff holdout record --issue FAFF-1 --run-dir .faff/runs/run-x`; expect exit 0
  3. `faff holdout verdict --issue FAFF-1` -> gate pass
  4. readHoldout(.faff/runs/run-x, FAFF-1) -> meets-spec
  5. Pipe the same block with observed removed -> exit 1; step 3 now reports gate block
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** No issues. One outcome (an auditable holdout record) across a writer module, one CLI verb, the spawner switch, evaluator and caller prose, and one eval case. That fits a 2 to 3 day unit, and the pieces always ship together: the writer refuses detail-less blocks, so the evaluator SKILL change cannot ship apart from it.

**Workstream fit?** No issues. It sits under FAFF-1255 with its sibling slices.

**Deps surfaced?**
- **What's there:** blocked by FAFF-1256 and blocking FAFF-1261, both linked. Two dependencies are not linked:
  - FAFF-1263 (warn-only mint check) is expected to call `holdoutRecordViolations`, but has no link to this ticket;
  - the caged path's missing store copy (beep-boop 10b step 5 confirms a `.faff/holdout/<key>.json` the spawner never writes) has no ticket.
- **Why:** if FAFF-1263 lands first it can only check the schema half for `holdout.json`, and the store-copy gap stays invisible until a caged L4 run hits it.
- **What to do:**
  - make FAFF-1263 blocked by FAFF-1259 (done at prep: link added);
  - fix the caged store copy (done at prep: brought into scope as `--store-out`);
  - add a related link to FAFF-1257 so whichever slice lands second reuses the first's writer helpers (done at prep).

**Risk profile?**
- **What's there:** the riskiest piece is LLM compliance. The writer refuses any met or unmet criterion without `exercised`, `expected` and `observed`, and a refusal becomes a blocking `needs-human` record.
- **Why:** a careless evaluator now blocks merges it used to pass, so the first L4 runs after this ships could stall on paperwork rather than defects.
- **What to do:** land the eval case (`holdout-exercise-003`) in the same PR and run it before merging, and watch the first beep-boop runs for `holdout record refused:` violations.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-2 minors fixed, not re-reviewed)
