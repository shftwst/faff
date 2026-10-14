# Per-line validator for declared-effects.jsonl, enforced at write time (FAFF-1262)

> Spec: faffter-dark-nlspec · 2026-10-13 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1262.

> Revised on 2026-10-13 after spec review round 1: `cmdEffects` labels envelope faults `record[<index>]`, a Commissaire schema-3 failure mode and round-trip test added, the corpus test carries no exception list, and absent-`effect` and combined-field cases added to the selftest list.

This spec is for the build agent picking up FAFF-1262 and for its reviewers. It adds one pure validator for a whole `declared-effects.jsonl` record, wires it into the single effects-ledger writer, and proves that every line already committed under `.faff/anchors/` passes it. It is the only change in the anchor-evidence work (FAFF-1255) that touches a live write path, so it ships and reverts on its own. FAFF-1256 (slice 1) calls the validator from `faff evidence validate` and is blocked by this ticket.

## 1. WHY

**The idea this spec turns on.** A declared-effects record has two layers: the effect descriptor (`{kind, target, reversible}`) and the envelope around it (`schema`, `run_id`, `seq`, `ts`, `prev`, unit key, and so on). Today only the descriptor has a validator. This change adds `declaredEffectViolations(record)` for the whole record, and makes the writer run it on each record it builds, inside the ledger lock, so the writer and every later reader (the FAFF-1256 `faff evidence validate` command, then the FAFF-1261 mint refusal) apply one rule.

**Problem.** `effects.js` validates descriptors with `effectDescriptorViolations` but nothing checks a full record: a writer could emit an unknown envelope key or a malformed `github_actor`, and readers would find out only when they hash or parse it. The anchor-evidence work needs a per-line rule that it can apply to committed anchors without rewriting them. This ticket supplies that rule, proves it accepts the committed lines, and makes the one writer obey it.

### Design principles

- **No behaviour change for current callers.** Every caller of `appendEffectEntries` today must produce byte-identical records and the same return shape. The validator is accepted only if it passes every committed line and every existing test unchanged.
- **Governance region stays independent.** `effects.js` is `region:governance`. It may require `events.js` (already does) but never `commissaire.ts`/`commissaire.js` (factory region). Rules that live only in Commissaire stay out of this validator.
- **Abort, never repair.** A record that fails the validator is never fixed up. The whole batch aborts with nothing written, through the abort path `appendRecordsUnderLock` already provides.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` `effectDescriptorViolations` (~79), `carriesBothUnitKeys` (~111), `unitIdOf` (~117), `appendEffectEntries` (~584), `effectsSelftest` | CommonJS | Home of the new validator and the writer it wires into |
| `plugin/skills/faff/bin/lib/events.js` `RUNNER_IDENTITY_CREDENTIAL_SOURCES` (~139), `HEX64_RE` (~149, already exported), `appendRecordsUnderLock` (~559) | CommonJS | Constants the validator reuses; the lock primitive whose `null` return aborts a batch |
| `merge-gate.js` (~1076, ~1097, ~1979, ~1981), `worktree-prune.js` (~162, ~179), `effects.js` `cmdEffects` (~688) | CommonJS | The six production call sites of `appendEffectEntries` |
| `test/ids.test.mjs` `frozenRecords` | ESM test | Existing pattern for reading every committed `.jsonl` line via `git ls-files` |
| `.faff/anchors/*/*/declared-effects.jsonl` | JSONL | The corpus the no-behaviour-change proof runs over |

**Scope.** This sits between the effects writer and the effects ledger; it changes no gate, no reader and no record shape.

## Already shipped against this surface

- **FAFF-621** (Done): chained schema-2 records minted as one batch under one lock via `appendRecordsUnderLock`. This spec reuses its `null`-aborts-the-batch contract.
- **FAFF-1012** (Done): the `recordFields` bag (`origin`). This spec closes that bag to the keys callers use today.
- **FAFF-1213** (Done): `github_actor {login, source}` on `pr-create` declares. This spec validates its shape.
- **FAFF-1167** (Done): `unit_id` / `issue` work-unit read and the dual-key rejection. This spec reuses `carriesBothUnitKeys` and `unitIdOf` for schema-3 records.

None of these delivers a whole-record validator, so the premise holds.

## 2. OUT OF SCOPE

- **The published `declared-effect` JSON Schema and `faff evidence validate`.** Why: FAFF-1256 owns both and calls this validator. Extension point: `plugin/skills/faff/bin/lib/evidence.js` (FAFF-1256).
- **Schema-3 kind-to-author rules and signature checks.** Why: the kind-to-author table lives in `commissaire.ts` (factory region), which `effects.js` may not require, and `faff governance-check`'s schema-3 auth leg already checks signed record kinds. Extension point: the governance-check schema-3 auth leg.
- **Closed per-kind `effect` payload schemas.** Why: FAFF-1260 (slice 5) owns them. Extension point: `effectDescriptorViolations` or a per-kind successor in `effects.js`.
- **Refusing at the mint or in CI.** Why: FAFF-1263 (warn-only) and FAFF-1261 (enforcement) own that. Extension point: the per-PR `faff events anchor` handler in `events.js`.
- **Schema-3 writers.** Why: Commissaire writes schema-3 records through its own path, not `appendEffectEntries`; the validator only reads them. Extension point: `commissaire.ts`.
- **Rewriting committed ledgers.** Why: anchors are immutable (ADR-0109). Extension point: none needed; the proof shows every committed line already passes.

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Effect descriptor | The `{kind, target, reversible}` object in a record's `effect` field, checked today by `effectDescriptorViolations` |
| Envelope | Every top-level field of a record other than `effect` and `payload` |
| Committed corpus | Every non-blank line of every `declared-effects.jsonl` under `.faff/anchors/<run>/<ISSUE>/` that `git ls-files` lists |

### The validator

```
FUNCTION declaredEffectViolations(rec) -> List<String>       # effects.js, pure, exported
  not a plain object (null, array, primitive)  -> ["record must be a JSON object"]
  schema not in {1, 2, 3}                       -> ["schema must be 1, 2 or 3"] and stop
  common to every schema:
    run_id non-empty string; seq non-negative integer; ts non-empty string; step non-empty string
  schema 1 or 2:
    keys ⊆ {schema, run_id, seq, ts, kind_of_entry, issue, step, effect}
           ∪ (schema 2 only: {prev, origin, github_actor})      else "unexpected field \"<key>\""
    kind_of_entry in {declare, observe}; issue non-empty string
    effect (required): each effectDescriptorViolations(effect) message, prefixed "effect: "
                      (an absent effect yields "effect: effect must be a JSON object")
    schema 2: prev matches HEX64_RE (required)
              origin, if present: non-empty string
              github_actor, if present: a plain object with exactly the keys {login, source},
                login a string or null, source in RUNNER_IDENTITY_CREDENTIAL_SOURCES
    schema 1: prev absent (covered by the closed key set)
  schema 3:
    keys ⊆ {schema, run_id, seq, ts, author, producer_id, contract_revision, kind_of_entry,
            unit_id, issue, step, prev, effect, payload, commissaire_sig, producer_hmac}
    author in {commissaire, producer}
    producer_id, contract_revision, kind_of_entry non-empty strings
    prev matches HEX64_RE
    not carriesBothUnitKeys(rec), and unitIdOf(rec) is non-null
    author commissaire -> commissaire_sig non-empty string and producer_hmac absent
    author producer    -> producer_hmac non-empty string and commissaire_sig absent
    effect, if present: effectDescriptorViolations with the "effect: " prefix
    payload, if present: a plain object
```

- Returns every violation found, in the order above, except the two early stops. An empty list means valid.
- The exact message for each rule is in the appendix, "Violation messages". Tests assert those strings.
- The schema-3 unit rule yields one message whether the record carries both keys or neither, because `unitIdOf` returns null in both cases.
- Messages name fields and keys, never field values. The one exception is the reused `effectDescriptorViolations` kind message, which already echoes the kind today; this spec does not change it.
- The validator checks shape only. A schema-3 `commissaire_sig` or `producer_hmac` that passes here is present, not verified; signature verification stays with the governance-check schema-3 auth leg, and no caller may read a clean result as "authentic".
- A field "absent" means the key is not an own property or its value is `undefined`, matching `hasUnitKey` in `effects.js`.

**Chosen:** the rules above, as carried on the FAFF-1262 ticket from the FAFF-1256 spec and reviewed in FAFF-1256 round 1 without objection. Rationale: a probe of these exact rules over the committed corpus on 2026-10-13 found 1,022 lines in 140 files (62 schema-1, 872 schema-2, 88 schema-3) and zero violations, so they describe what every writer has produced.

### Exports

- `effects.js` exports `declaredEffectViolations` beside `effectDescriptorViolations`.
- `events.js` exports `RUNNER_IDENTITY_CREDENTIAL_SOURCES` (the existing `Set(["runner-credential", "ambient"])`). `HEX64_RE` is already exported.

**Chosen:** import the set from `events.js` rather than copy it into `effects.js`. Rationale: the `runner-identity` event check and the `github_actor` check must use one vocabulary; `effects.js` already requires `events.js`, so no new region edge appears.

## 4. HOW

### Wiring into `appendEffectEntries`

The writer keeps its pre-lock descriptor check and adds the record check inside the lock, after `seq` and `prev` are assigned, so the record it validates is byte-for-byte the record it would write.

```
PROCEDURE appendEffectEntries(runDir, kindOfEntry, issue, step, effects, ts, recordFields):
  1. Pre-lock, unchanged: run effectDescriptorViolations on each descriptor;
     any violation -> return { violations: [{ index, violations }, ...] }; nothing locked or written
  2. effects empty -> return { written: [] }, unchanged
  3. recordViolation := null
  4. written := appendRecordsUnderLock(runDir, effects-ledger cfg, effects.length,
       mintOne(index, seq, prevRecord, prevHash):
         a. build record exactly as today (recordFields spread first, reserved keys after)
         b. v := declaredEffectViolations(record)
         c. IF v non-empty: recordViolation := { index, violations: v, scope: "record" }; return null   # aborts the whole batch
         d. return record)
  5. IF written is null: return { violations: [recordViolation] }
  6. return { written }
```

- `appendRecordsUnderLock` returns `null` on the first `null` from `mintOne` and writes nothing, so a batch reports exactly one record violation. Every record in a batch shares `issue`, `step`, `ts` and `recordFields`, and each descriptor already passed the pre-lock check, so in practice the failing index is 0.
- The return shape `{ violations: [{ index, violations: [String] }] }` is the one every caller already handles, so `merge-gate.js` and `worktree-prune.js` need no change: they print one stderr line (the JSON of the violations) and continue. The added `scope: "record"` key marks an envelope fault; pre-lock descriptor entries carry no `scope`, so their shape is unchanged.
- `cmdEffects` is the one caller that changes, and only its stderr label: an entry with `scope: "record"` prints `- record[<index>]: <message>`, so an envelope fault is never reported as a descriptor fault. Descriptor entries keep `- descriptor[<index>]: <message>` byte-for-byte, and the exit code stays 1 for both.

**Chosen:** validate inside the `mintOne` callback, not before taking the lock. Rationale: `seq` and `prev` exist only inside the lock, and validating the exact object that would be serialised removes any gap between what is checked and what is written. The cost is one pure function call per record while holding the lock.

**Anti-pattern:** validating a record built outside the lock with placeholder `seq`/`prev`. Why: the checked object would differ from the written one, which is the drift this ticket exists to remove.

**Anti-pattern:** throwing from `mintOne` on a violation. Why: callers treat a throw as an I/O failure ("effects ledger append failed"), and the abort-by-`null` path already guarantees nothing is written.

### New refusals

Two inputs that are accepted today become refusals. Neither is produced by any current caller.

- A `recordFields` bag with a key outside `{origin, github_actor}`, or a malformed `github_actor`. Every production call passes only `{origin}` or `{origin, github_actor}` (checked at all six call sites).
- `faff effects declare|observe` with an empty-string `--issue` or `--step`. `requireFlags` rejects only an absent flag, so `--issue ""` writes a record with no resolvable work unit today. After this change it exits 1 with `- record[0]: issue must be a non-empty string` (or the `step` equivalent) and writes nothing.

**Chosen:** close `recordFields` to `{origin, github_actor}` and accept both refusals. This narrows FAFF-1012's "a caller can only add fields" contract: a future envelope field is now a deliberate edit to this validator and to FAFF-1256's published schema in the same change. Rationale: an empty unit or an unknown envelope key produces a record that no reader can attribute or that a closed schema would reject, and no caller relies on either.

### Proof over the committed corpus

A new test reads the committed corpus with `git ls-files '.faff/anchors/*/*/declared-effects.jsonl'` (the `test/ids.test.mjs` pattern), parses each non-blank line, and asserts `declaredEffectViolations(line)` is empty for every one. It also asserts the corpus holds at least 1,022 lines and at least one line of each schema (1, 2 and 3), so an empty or partial glob cannot pass silently.

**Chosen:** a floor (at least 1,022 lines) rather than an exact count. Rationale: every merged PR commits a new anchor, so the count grows; an exact pin would fail on the next merge.

**Chosen:** `git ls-files` rather than a filesystem glob. Rationale: it reads only committed lines, so an uncommitted local anchor cannot make the test pass or fail on one machine only.

### Failure modes

- **A committed line fails the new validator.** How you'd know: the corpus test fails on the build branch and names the file, line number and violations. What it means: committed anchors are never rewritten, so the rule is narrowed until it accepts the line, and the narrowing and its reason are recorded in the spec on the PR. The corpus test carries no per-line exception list.
- **A caller passes a field this spec did not find.** How you'd know: `faff effects --selftest`, `test/merge-gate-local.test.mjs`, `test/impure/worktree-prune.test.mjs` or the Commissaire tests fail, or a stderr "rejected internally-built descriptors" line appears in a run log. What it means: add the field to the closed schema-2 set only if it is an intended envelope field, and update FAFF-1256's published schema to match. Until then the write aborts: `merge-gate.js` and `worktree-prune.js` log it and carry on, so the effect goes unrecorded rather than blocking the merge or prune, which is today's behaviour for a rejected descriptor.
- **Commissaire adds a schema-3 envelope field.** Commissaire writes schema-3 records outside `appendEffectEntries`, so this validator never blocks that write; the new field is first rejected downstream, by FAFF-1256's `faff evidence validate` and later FAFF-1261's mint refusal, with a message naming the field (`unexpected field "<key>"`). How you'd know: the corpus test fails once an anchor carrying the field is committed, or a Commissaire test that runs the validator over a freshly minted schema-3 record fails first (see DONE). What it means: the field is added to the schema-3 set in `effects.js` (governance) and to the FAFF-1256 schema in the same change as the Commissaire writer.

## 5. SCENARIOS

```
Given a run dir whose declared-effects.jsonl holds two valid schema-2 records
When appendEffectEntries is called with two valid descriptors and recordFields { origin: "x", extra: 1 }
Then it returns { violations: [{ index: 0, violations: ["unexpected field \"extra\""], scope: "record" }] }
And declared-effects.jsonl is byte-identical to before the call
```

```
Given a run dir with no declared-effects.jsonl
When `faff effects declare --run-dir <dir> --issue "" --step build` reads [{"kind":"merge","target":"pr:1"}] from stdin
Then it exits 1, prints "- record[0]: issue must be a non-empty string" on stderr, and declared-effects.jsonl does not exist
```

```
Given the schema-3 record { schema: 3, author: "producer", unit_id: "U1", issue: "U1", producer_hmac: "h", ... otherwise valid }
When declaredEffectViolations runs on it
Then it returns exactly ["exactly one of unit_id or issue must be a non-empty string"]
```

- Every line of the committed corpus returns an empty violation list.
- Records written by every existing caller are byte-identical before and after this change.

## 6. DESIGN DECISION RATIONALE

- **Where does the validator live?** Options: `effects.js` beside `effectDescriptorViolations`; a new module; `commissaire.ts`. **Chosen:** `effects.js` — governance region, already the home of the descriptor check, and FAFF-1256's `evidence.js` (governance) can require it.
- **Check schema-3 authorship per kind?** Options: full kind-to-author table; envelope only. **Chosen:** envelope only — the table lives in `commissaire.ts` (factory region), and the governance-check schema-3 auth leg already enforces it.
- **Where in the writer?** Options: before the lock; inside `mintOne`. **Chosen:** inside `mintOne` (section 4).
- **Copy or import the credential-source set?** **Chosen:** import from `events.js` (section 3).
- **Exact or floor count in the corpus test?** **Chosen:** floor (section 4).
- **How does `cmdEffects` report an envelope fault?** Options: keep `descriptor[<index>]`; label it `record[<index>]` via a `scope` key on the violation entry. **Chosen:** `record[<index>]` (section 4), so stderr names the layer that failed; descriptor output is unchanged.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** the committed corpus on the build branch's base still passes the rules (it did on 2026-10-13: 1,022 lines, 140 files, zero violations). Validation: write and run the corpus test before wiring the validator into the writer; if it fails, follow the first failure mode above before continuing.

## 8. DONE

### From WHY
- [ ] `effects.js` contains no `require` of `commissaire` (checked by `faff regions check` passing)

### From WHAT
- [ ] `declaredEffectViolations` is exported from `effects.js` and `RUNNER_IDENTITY_CREDENTIAL_SOURCES` from `events.js`
- [ ] `effectsSelftest` covers each rule with one failing record and its exact message: non-object; schema 4 (only "schema must be 1, 2 or 3"); empty `run_id`, `ts`, `step`; seq -1 and 1.5; unknown key on schema 1 and schema 2; `prev` on schema 1; schema-2 missing or malformed `prev`; empty `origin`; `github_actor` with an extra key, a numeric `login`, and source `"token"`; `kind_of_entry` `"x"`; empty `issue`; a bad descriptor (message prefixed `effect: `); schema-3 unknown key, bad `author`, empty `producer_id`, both unit keys, no unit key, commissaire with `producer_hmac`, producer without `producer_hmac`, `payload` an array
- [ ] `effectsSelftest` also rejects a schema-1 and a schema-2 record with no `effect`, with exactly `effect: effect must be a JSON object`
- [ ] `effectsSelftest` accepts one valid record per shape: schema 1, schema 2 bare, schema 2 with `origin`, schema 2 with both `origin` and `github_actor` (`login` null), schema 3 commissaire with `unit_id` and `payload`, schema 3 producer with `issue` and `effect`

### From HOW
- [ ] The three Scenarios pass as tests (the first two in `effectsSelftest` or `test/effects.test.mjs`, the third in `effectsSelftest`)
- [ ] A new test (in `test/effects.test.mjs` or its own file) asserts every committed corpus line returns no violations, the corpus has at least 1,022 lines, and each of schema 1, 2 and 3 appears at least once
- [ ] `faff effects --selftest`, `test/effects*.test.mjs`, `test/merge-gate-local.test.mjs`, `test/impure/worktree-prune.test.mjs` and `test/commissaire*.test.mjs` pass with no edits to existing assertions
- [ ] `cmdEffects` prints `- record[<index>]: ` for record-level violations and keeps `- descriptor[<index>]: ` byte-for-byte for descriptor violations (asserted with one bad descriptor and one empty `--issue`)
- [ ] A test in `test/commissaire-unit-id.test.mjs` (or a sibling `test/commissaire*.test.mjs`) mints one schema-3 record with `appendCommissaireRecord` and one with `appendProducerRecords` (both exported from `commissaire.js`), reads them back from `declared-effects.jsonl`, and asserts `declaredEffectViolations` returns no violations for either
- [ ] The existing `appendEffectEntries` selftest assertions (seq, prev, run_id, batch contiguity, all-or-nothing on a bad descriptor) pass unchanged

### Integration smoke test

```
1. tmp := new empty dir named "run-smoke"
2. appendEffectEntries(tmp, "declare", "FAFF-1", "pr-create",
     [{kind: "pr-create", target: "main", reversible: true}], undefined,
     {origin: "pr-create-auto", github_actor: {login: null, source: "ambient"}})
3. Expect { written: [one record] }, and that record passes declaredEffectViolations
4. Expect faff effects verify --run-dir tmp to report the chain verified
```

## Appendix A. Violation messages

`<key>` is the offending key name, JSON-quoted. No message prints a field value except the reused descriptor kind message.

| Rule | Message |
|---|---|
| Not a plain object | `record must be a JSON object` |
| Schema not 1, 2 or 3 | `schema must be 1, 2 or 3` |
| `run_id`, `ts`, `step`, `issue`, `origin`, `producer_id`, `contract_revision`, `kind_of_entry` (schema 3) | `<field> must be a non-empty string` |
| `seq` | `seq must be a non-negative integer` |
| Key outside the closed set | `unexpected field <key>` |
| `kind_of_entry` (schema 1 or 2) | `kind_of_entry must be declare or observe` |
| `prev` | `prev must be 64 lowercase hex characters` |
| `github_actor` shape | `github_actor must be exactly {login, source} with login a string or null and source in {runner-credential, ambient}` |
| `author` | `author must be commissaire or producer` |
| Schema-3 unit | `exactly one of unit_id or issue must be a non-empty string` |
| Commissaire authenticator | `author commissaire requires commissaire_sig and no producer_hmac` |
| Producer authenticator | `author producer requires producer_hmac and no commissaire_sig` |
| `payload` | `payload must be a JSON object` |
| Descriptor | `effect: ` followed by each `effectDescriptorViolations` message, unchanged |

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? No issues.** One pure function, one wiring point inside `appendEffectEntries` and one corpus test: a single unit of about a day. It was split out of FAFF-1256 so the only live write-path change ships and reverts on its own, which is the right cut.
- **Workstream fit? No issues.** It is a child of FAFF-1255 (anchored evidence) and delivers the per-line rule that epic's validator and mint refusal depend on.
- **Dependencies surfaced? No issues.** FAFF-1262 blocks FAFF-1256 on the tracker, and it has no blockers of its own. FAFF-1263 and FAFF-1261 consume the validator through FAFF-1256, so the existing chain already orders them.
- **Risk profile? No issues.** The one risk, a committed line or a caller the rules reject, is retired before the wiring step by running the corpus test first (see the assumption in section 7), and the abort path writes nothing. No spike is needed.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 minors fixed, not re-reviewed)
