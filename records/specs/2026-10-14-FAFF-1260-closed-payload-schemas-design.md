# Closed payload schemas for every event type, effect kind and Commissaire record kind (FAFF-1260)

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1260.

> Refreshed on 2026-10-14 against main at `10a8ece4` (FAFF-1256, FAFF-1262, FAFF-1258, FAFF-1259, FAFF-1263, FAFF-1266 and FAFF-1267 merged). What changed is listed under "Refresh notes" above the methodology critique.

This spec is for the build agent picking up FAFF-1260, slice 5 of FAFF-1255, and for its reviewers. Slice 1 (FAFF-1256, merged) publishes v0.3 envelope schemas for `events.jsonl` and `declared-effects.jsonl` with the payloads left open. This slice closes those payloads: each event `type` gets a closed `data` schema, each effect `kind` a closed `effect` schema, and each schema-3 Commissaire record kind a closed `payload` shape. Every writer of either log validates each record against them before it is appended.

## 1. WHY

**The idea the rest depends on.** Both logs are hash-chained and append-only, so a line that is written can never be corrected. When slice 6 (FAFF-1261) starts refusing anchors whose lines fail their schema, one non-conforming line in a run makes that run's anchor unmintable for good. The only safe place to enforce a closed payload is therefore the writer, before the line exists. This slice publishes the closed payload schemas and makes every writer check its records against them inside the append lock, so that from this slice on no non-conforming line can enter either log.

**Problem.** `data`, `effect` and `payload` are free-form today. A survey of the committed anchors on 2026-10-14 (6,044 event lines in 397 anchors, 1,395 declared-effects lines) shows `prep-done` with 14 different `data` keys, `park` with 18, and three keys that hold two different types (`build-start.resume`, `build-start.attempt`, `run-start.requested`). Reporting cannot rely on these payloads, and slice 6 cannot enforce a shape nobody has written down. This slice writes the shapes down, proves them against the committed lines, and stops new drift at the writer.

### Design principles

- **Writers before refusal.** Nothing in this slice refuses an anchor. It changes only what writers accept, so new lines conform before slice 6 starts checking them.
- **The schema follows the writer.** Each payload's key set and types come from the code that writes it, the SKILL prose that tells an agent to write it, and the committed lines, in that order of authority. A schema that rejects a line a current writer produces is a bug in the schema.
- **No gate decision moves.** A record that a writer chains today and a gate later judges (a malformed Commissaire request denied `invalid-effect-descriptor`) is still chained and still judged the same way.
- **Signed and chained bytes are never rewritten.** Schema-3 records are signed and every line is chained. Schemas accept every shape a current writer emits, including frozen legacy names (`accepted_under_contract`).
- **Delivery profile only.** The payload schemas describe `DELIVERY_PROFILE`. A `$FAFF_GOVERNANCE_PROFILE` override (the dialect-independence proof) skips the payload check, as its vocabulary has no schemas.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/governance-profile.js` `DELIVERY_PROFILE.event_types` | CJS JS | The 26 event types (27 after this slice) |
| `plugin/skills/faff/bin/lib/events.js` `eventViolations`, `appendRecordUnderLock` (the only user of `EVENTS_CFG`), `appendEventRecord`, `cmdEvents` `append` | CJS JS | Event line validator, the one events write core, the agent-facing writer |
| `plugin/skills/faff/bin/lib/effects.js` `EFFECT_KINDS`, `effectDescriptorViolations`, `declaredEffectViolations`, `normEffect`, `appendEffectEntries` | CJS JS | The 16 effect kinds and the effects writer, which already validates each record inside its mint callback (FAFF-1262) |
| `plugin/skills/faff/bin/lib/evidence.js` `validateEvidenceDocument`, `preloadEvidenceSchemas`, `SchemaUnavailable`, `LINE_VALIDATORS` | CJS JS | The shared bundled-schema loader and validator (cached per process, load fault cached too) that FAFF-1258's ledger serialiser already calls from inside a lock |
| `plugin/skills/faff/bin/lib/commissaire.ts` `KIND_AUTHOR`, `appendProducerRecords`, `appendCommissaireRecord`, `appendVerbatimGovernorRecord`, `cmdRequestDecision`; `decision-policy.ts` `evaluateDecisionRequest` | TypeScript (committed `.js` emit) | Schema-3 record kinds, their payload writers, and the leg that denies a malformed request descriptor |
| `plugin/skills/faff/bin/lib/contract-engine.js` `validateAgainstSchemaDetailed` | CJS JS | The extended subset validator; `discriminator` recurses, so a discriminator nests inside a mapped sub-schema |
| `verification/evidence/v0.3/schema/run-event.schema.json`, `declared-effect.schema.json` and the bundled copy `plugin/skills/faff/contracts/evidence-v0.3/` | JSON Schema | Slice 1's envelope schemas, which this slice extends |
| `verification/commissaire-facade/v0.2/schema/` and v0.3 (FAFF-1224) | JSON Schema | The published per-kind schema-3 record schemas the evidence schemas must agree with |
| `test/evidence-v0.3.test.mjs` | JS test | Slice 1's closure, enum-mirror and committed-line proof tests this slice extends |
| `plugin/skills/faff-beep-boop/SKILL.md` "Run-event log" table, `faff/references/l4.md` | Markdown | The prose that tells agents which events to append |
| `.faff/anchors/` (git-tracked) | JSONL | The committed lines every schema is proved against |

**Scope.** This is the payload layer of the FAFF-1255 anchor schemas: slice 1 closes the envelopes, this slice closes what is inside them, and slice 6 enforces both at mint and in CI.

## Already shipped against this surface

- **FAFF-700, FAFF-1213** (Done): `agent-dispatch` and `runner-identity` already carry closed top-level `data` key sets in `eventViolations`. Their v0.3 schemas restate those sets exactly.
- **FAFF-821, FAFF-956** (Done): `decision-capture` and `decision-capture-action` carry structured `data` rules in `eventViolations`; the schemas restate the key set and types.
- **FAFF-1221** (Done): the conclusion kind was renamed `conformed_to_contract`, with `conclusionKindOf` reading both names. The schemas follow that compatibility read.
- **FAFF-1256** (Done, #1052): the v0.3 directory, the bundled copy, the validator extensions and `faff evidence validate`. Envelopes only; `data`, `effect` and `payload` are named open nodes in its closure test.
- **FAFF-1262** (Done, #1050): `declaredEffectViolations`, called by `appendEffectEntries` inside the mint callback; a refused record aborts the batch and the function returns `{ violations }`.
- **FAFF-1258** (Done, #1055): `validateEvidenceDocument` and `preloadEvidenceSchemas` in `evidence.js`, the in-lock validation pattern this slice reuses for both logs.
- **FAFF-1263** (Done, #1056): the warn-only mint check and `faff evidence-readiness`, which lists FAFF-1260 among the writer tickets that must merge before its `--since` revision.

None of these closes the event payloads, the effect payload per kind, or schema-3 payloads, so the premise holds.

## 2. OUT OF SCOPE

- **Mint refusal and the governance-check evidence-schema leg.** Why: FAFF-1261 (slice 6). Extension point: `validateAnchorDir` in `bin/lib/evidence.js`.
- **Schema-1 event lines.** Why: no writer emits schema 1, and every anchor holding one is legacy. Slice 1's schema-1 mapping stays as published, `data` open. Extension point: the `"1"` mapping in `run-event.schema.json`.
- **Per-kind target patterns** (for example a branch-name pattern for `merge` targets). Why: escape matching compares exact targets and a declared `*` wildcard, so a pattern risks refusing a valid declaration. Extension point: the per-kind effect schema's `target` property.
- **Value enums the code does not enforce** (for example Commissaire `level` values, `park.cause` text). Why: adding a closed set the code never enforced would change decisions, not just shapes. Extension point: the per-type schema property.
- **Changing the Commissaire record vocabulary, its decision legs, or the published facade.** Why: Commissaire owns them, and FAFF-1224 publishes facade v0.3. This slice only describes what the code writes. Extension point: `verification/commissaire-facade/`.
- **`faff events validate`.** Why: it is the line-format checker and stays on `eventViolations`; whole-file schema checking is `faff evidence validate`. Extension point: `cmdEvents` `validate`.
- **Emitting `evidence-terminal-only`.** Why: the `--terminal-only` writer is FAFF-1268 (2b, not yet built). This slice only registers the type and its schema.
- **Moving `run-resume` and `run-claim-abandoned` fields from the top level into `data`.** Why: their readers use the top-level fields and the lines are chained; the schemas describe them where they are. Extension point: `resume.js` `runResumeEvent`, `resumecheck.js` `runClaimAbandonedEvent`.
- **The run-ledger exceptions treadmill.** Why: FAFF-1274 owns the `outcome_details` closure that makes every build add a `LEDGER_EXCEPTIONS` entry. This slice adds no exceptions mechanism of its own for event or effect lines (see the proof rule below).

## 3. WHAT

### Vocabulary

| Term | Meaning |
|---|---|
| Payload | `data` on an event line, `effect` on a declared-effects line, `payload` (and `effect`) on a schema-3 record |
| Payload schema | The closed v0.3 schema for one event type, one effect kind or one schema-3 record kind |
| Composed schema | `run-event.schema.json` or `declared-effect.schema.json` after the payload schemas are inlined into their discriminator mappings |
| Telemetry tags | The `data` keys the CLI or `eventViolations` allows on any event: `tokens`, `tokens_source`, `ledger_sha256_before`, `ledger_sha256_after`, `effort`, `gate`, `rework_turns`, plus `dropped_keys`, which `faff events append` adds (below) |
| Agent-written type | An event type an agent appends through `faff events append` from SKILL prose |
| Named open node | An object node deliberately left without a key list, listed by name in the closure test |

### Files

```
verification/evidence/v0.3/schema/
  events/<type>.schema.json        # 27 files: the closed record shape for one schema-2 event type
  effects/<kind>.schema.json       # 16 files: the closed effect descriptor for one effect kind
  commissaire/<kind>.schema.json   # 8 files: the closed schema-3 record shape for one record kind
  run-event.schema.json            # composed (generated): schema "2" mapping discriminates on type
  declared-effect.schema.json      # composed (generated): effect discriminates on kind; schema "3" on kind_of_entry
  examples/events/, examples/effects/, examples/commissaire/   # one valid and one invalid example per payload schema
scripts/evidence-v0.3-compose.mjs  # composes the two files above and mirrors v0.3 into the bundled copy
```

**Chosen:** the per-type files are the authored source and the two composed schemas are generated from them by `scripts/evidence-v0.3-compose.mjs`, with `--check` failing when a committed composed file differs from a fresh composition. The subset validator has no `$ref`, so the composed schemas must inline every payload schema; generating them keeps one authored home per type. The script writes `verification/evidence/v0.3/` and refreshes the bundled copy, so slice 1's byte-identity test keeps holding. The manifest is unchanged: it still names the two composed files for `events.jsonl` and `declared-effects.jsonl`, so `validateEvidenceDocument` and `faff evidence validate` pick up the closed payloads with no code change.

### How the discriminators compose

```
run-event (base node, from slice 1)
  discriminator schema:
    "1" -> slice 1's schema-1 shape, data open (unchanged)
    "2" -> { type: object, required: [schema, type], discriminator type:
               "<event type>" -> events/<type>.schema.json   (27 mappings) }

events/<type>.schema.json: a full closed schema-2 record
  properties: schema(enum [2]), run_id, seq, ts, prev(pattern), phase(enum: all DELIVERY_PROFILE.event_phases),
              type(enum [<type>]), issue?, data?, plus any type-specific top-level keys
  additionalProperties: false
  data: closed object; its keys per the table below

declared-effect (base node, from slice 1)
  discriminator schema:
    "1", "2" -> slice 1's shapes (including schema 2's origin and github_actor), with effect replaced by EFFECT
    "3"      -> { type: object, required: [schema, kind_of_entry], discriminator kind_of_entry:
                    "<record kind>" -> commissaire/<kind>.schema.json   (8 mappings) }

EFFECT := { type: object, required: [kind], discriminator kind:
              "<effect kind>" -> effects/<kind>.schema.json   (16 mappings) }

effects/<kind>.schema.json:
  { kind: enum [<kind>], target: string, reversible?: boolean }  required [kind, target], closed
```

**Chosen:** the type discriminator sits under the schema-2 mapping, not beside it, because one schema node carries one discriminator and schema 1 is frozen. `validateAgainstSchemaDetailed` validates the whole object against the mapped sub-schema and recurses, so a discriminator nested in a mapping is honoured. Each event-type file is the whole record; the envelope is restated in each file and the compose script fills it from one envelope template, so it cannot drift between types. The run-resume top-level fields slice 1 admits on every schema-2 type move into the `run-resume` file only (and `epoch` into `run-claim-abandoned`), the per-type restriction slice 1's schema description defers to this slice.

**Chosen:** every event-type schema accepts all five `event_phases`. `eventViolations` checks phase membership against the flat list, never per type, and no type-to-phase table exists anywhere in the profile, so narrowing per type would invent a rule the code does not hold and refuse legitimate writes.

**Chosen:** `reversible` is optional in the effect schema. `effectDescriptorViolations` treats it as optional, `normEffect` always writes it on declare and observe lines, and every committed request and verdict effect carries only `{kind, target}`.

### Event `data` schemas

Each type's `data` key set is built by these rules, the same pattern slice 1 used for `run-ledger.json`:

1. Keys a CLI writer sets (the code sites in the table), keys the SKILL prose tells an agent to write, keys any code reader of the event reads, and keys present in committed lines (Appendix A).
2. Each key's type comes from its documented writer. A key with no documented writer takes its observed type, as a union when the committed lines show two (`build-start.resume`: string or boolean).
3. Where `eventViolations` already holds a closed key set (`agent-dispatch`, `runner-identity`), the schema is exactly that set. Every other type also allows the telemetry tags, because `--tokens` and `eventViolations` accept them on any type today.
4. `data` is required where a writer always sets it and a reader depends on it (`ledger-write`, `issue-outcome`, `agent-dispatch`, `runner-identity`, `decision-capture`, `decision-capture-action`, `containment-check`, `self-intake-check`, `corrective-authored`, `corrective-consumed`, `park-reconsidered`, `bundle-store-unavailable`, `evidence-terminal-only`); elsewhere it is optional.
5. Nested objects are closed too, except the named open nodes below. Shapes a CLI command produces for an agent to relay verbatim (`sentry-checkpoint` and `sentry-trip` from `faff sentry check`, `budget-checkpoint` from the budget state) are typed from that command's code. `sentry-checkpoint.data.verdicts[]` and `sentry-trip.data.verdicts[]` items discriminate on `signal`, each mapping a closed item with that signal's `evidence` keys from the sentry verdict builder.

| Event type | Writers | Notes on the `data` shape |
|---|---|---|
| `run-start` | `emitGenesisRunStart`, `run-ledger.js` mints; historic agent appends | `level` string; observed agent keys (Appendix A) |
| `run-end`, `tidy-done`, `prep-start`, `prep-done`, `build-start`, `issue-admitted`, `discovered-scope-filed`, `park` | agent (beep-boop table) | Observed keys plus telemetry tags |
| `issue-outcome` | agent; `run-ledger.js` `record-outcome` | `outcome` required, enum `ledger_outcomes`; `gate` enum `QUALITY_GATE_CATCHES`; `rework_turns`, `pr` integers |
| `budget-checkpoint` | agent, relaying budget state | Typed from `BudgetState` (built in `budget.js`); observed keys in Appendix A |
| `sentry-checkpoint`, `sentry-trip` | `sentry-poller.js`; agent relaying `faff sentry check` | Typed from the sentry payload builder, including each verdict signal's `evidence` keys |
| `ledger-write` | `heartbeat.js` `atomicWriteLedger`; `events append` note | `ledger_sha256` required (pattern `^[0-9a-f]{64}$`); `note` string |
| `corrective-authored`, `corrective-consumed` | `corrective.js` | The written corrective record plus `artifact`; `{disposition, basis, mandate, constraints, applied, rejected, parks}` |
| `containment-check` | `contain.js` | `{mandate, parent, root, ancestry_raw, verdict, exit}` |
| `self-intake-check` | `self-intake.js` | `{mandate, target_raw, self{team, teams, repo, lane_on}, verdict, reason, exit}` |
| `run-resume` | `resume.js` `runResumeEvent` (top-level fields); historic agent append (`data`) | Top-level optional `epoch`, `prior_state`, `skipped_shipped`, `rebuilt_coarse`; `data` optional `{epoch, prior_state, redispatched, reason}` |
| `run-claim-abandoned` | `resumecheck.js` | Top-level optional `epoch`; `data` `{released_from, to, reason}` |
| `park-reconsidered` | `park-reconsider.js` via `lights-out.js` | `{issue, cause_class, via, ledger_cleared, ledger_note, cited_input_ref, prev_fingerprint, new_fingerprint}`, nullable where the builder writes null |
| `agent-dispatch` | agent | Exactly `DISPATCH_ALLOWED_DATA_KEYS` |
| `runner-identity` | `merge-gate.js` `recordRunnerIdentity` | Exactly `RUNNER_IDENTITY_ALLOWED_DATA_KEYS`; `github_login` string or null (null when unresolved, as 13 committed lines show) |
| `decision-capture`, `decision-capture-action` | `decision-capture.js` | As `eventViolations` checks them; `verdict` and `selected_action` object or string |
| `bundle-store-unavailable` | `bundle.js` | `{boundary_kind, boundary_key, detail}` |
| `evidence-terminal-only` | FAFF-1268 (new) | `{issue, writer}`, both required non-empty strings; phase `build` |

**Chosen:** `data.tokens` is `["object", "null"]`: `null` is the `estimate` form `eventViolations` accepts (paired with `tokens_source: "estimate"`), and the object is closed, with `input`, `output` and `cache_read` required and `cache_write_5m`, `cache_write_1h` and the legacy `cache_write` optional, all non-negative integers. `eventViolations` normalises a legacy `cache_write` before it checks and before `events append` writes, so writers always produce the five current classes; the schema is the looser envelope and the line validator stays the stricter check, as the parent design intends for both logs.

**Chosen:** `evidence-terminal-only` is run-scoped (not in `issue_scoped_types`), with the issue inside `data`, matching the parent's `{issue, writer}` shape and the `park-reconsidered` precedent. FAFF-1268 emits `{"phase":"build","type":"evidence-terminal-only","data":{"issue":"<ISSUE>","writer":"review-verdict"}}`.

**Chosen:** whichever of FAFF-1268 and FAFF-1260 merges first adds `evidence-terminal-only` to `DELIVERY_PROFILE.event_types`; the other finds it present and only checks it. If FAFF-1268 merges first it registers the type, and any `data` schema file it adds for the type becomes this slice's authored source for `events/evidence-terminal-only.schema.json`, checked against the shape above. Either order leaves the terminal-only append working, so neither ticket blocks the other.

### Named open nodes

**Chosen:** exactly five nodes stay open, each because a different contract owns and checks its contents:

| Node | Owner and check | Why it stays open |
|---|---|---|
| `decision-capture.data.normalised_inputs` | the decision kernel; `decision-capture.js` validator | Kernel inputs differ per kernel and have no key set in code |
| `decision-capture.data.verdict` (object form) | same | Kernel output, per kernel |
| `selected_action` (object form) on both decision-capture types | same | Kernel output, per kernel |
| `effect-decision-request.payload.effect` | Commissaire; `evaluateDecisionRequest` leg 4 | The caller's raw descriptor, chained as given and then judged |
| `effect-decision-verdict.payload.effect` | Commissaire; same leg | Echoes the request's raw descriptor |

The two Commissaire nodes are unconstrained (no `type`), because `cmdRequestDecision` chains `req.effect` exactly as the caller sent it and `evaluateDecisionRequest` denies a malformed one with `invalid-effect-descriptor`. Closing them at the writer would refuse the request before it is chained, so that deny reason, which the published facade documents, could never be issued for a descriptor with an extra key or a bad type, and a gate decision would move. The closure test asserts that these five, and only these, are open; any further open node needs a reviewer to agree that its owning contract checks it elsewhere.

### Schema-3 Commissaire record schemas

| Record kind | `author` | `effect` | `payload` (closed) |
|---|---|---|---|
| `admission` | `commissaire` | absent | `producer_id`, `contract_revision`, `admitted_scope` (array of strings), `pk_fingerprint`, `admitted_at` strings; optional `custody` enum `["governor"]` or null |
| `declare`, `observe` | `producer` | required, EFFECT | absent |
| `effect-decision-request` | `producer` | absent | `effect` (open node, optional because `JSON.stringify` drops an absent one), `declared_ref` string, integer or null (no reader interprets it; the governor compares it by equality); optional `evidence_seq` integer, `level` string, `attended` boolean, `holdout` string |
| `effect-decision-verdict` | `commissaire` | absent | `request_seq` integer, `verdict` enum `grant`/`deny`, `reason` string, `effect` (open node); optional `level`, `attended`, `holdout`, `level_policy` `{pass, reason}` (closed), `pure_verdict`, `pure_reason` |
| `conformed_to_contract` | `commissaire` | absent | `producer_id`, `contract_revision` strings, `evidence_seq_range` array of exactly two integers (`minItems: 2`, plus a writer check on the maximum), `escapes_checked` boolean |
| `accepted_under_contract` | `commissaire` | absent | Same as `conformed_to_contract` (the frozen pre-FAFF-1221 name, read by `conclusionKindOf`) |
| `reconcile` | `producer` | absent | absent |

Every schema-3 record keeps slice 1's envelope (`schema`, `run_id`, `seq`, `ts`, `author`, `producer_id`, `contract_revision`, `kind_of_entry`, `step`, `prev`, optional `unit_id`, `issue`, `commissaire_sig`, `producer_hmac`), with `author` narrowed to the one value `KIND_AUTHOR` gives the kind. `unit_id` and `issue` both stay optional, since committed v0.1-era records carry `issue` and later ones `unit_id`.

**Chosen:** a kind in `KIND_AUTHOR` with no writer in code (`reconcile`: `cmdReconcile` reads and never appends) gets the strictest shape, with no `effect` and no `payload`. A future writer then has to add its fields to the schema in the same change.

**Chosen:** the schemas accept both conclusion names. The code writes `conformed_to_contract` (5 committed records); records written before FAFF-1221 carry `accepted_under_contract` and are signed, so they can never be renamed. This follows `conclusionKindOf`.

**Chosen:** the evidence schema-3 files stay authored in `verification/evidence/v0.3/schema/commissaire/` and are proved against the published facade rather than generated from it. The two specs hold opposite trust postures (the facade README calls them siblings, not versions of one another), and the evidence files close payload nodes the facade leaves open. A test keeps them from disagreeing: every record kind the facade v0.3 schemas (FAFF-1224) name has an evidence mapping with the same `author`; every property either schema declares on the envelope or the payload exists in the other with the same type, apart from the two named open `effect` nodes and the optional `unit_id`/`issue` pair; and every facade v0.3 example record passes the composed `declared-effect` schema. Generating the evidence files from the facade would make the evidence closure depend on a schema set whose open nodes Commissaire owns.

### Writers

All writers call the existing `evidence.js` validator; no new module is added.

```
evidence.validateEvidenceDocument("events.jsonl", record)           -> { ok, violations } | { unavailable }
evidence.validateEvidenceDocument("declared-effects.jsonl", record) -> same
evidence.preloadEvidenceSchemas()                                   # called before taking a lock, as the ledger serialiser does
```

`events.js` and `effects.js` require `evidence.js` lazily, the pattern `events.js` already uses for `reportLedgerSchema` and `warnOnEvidenceSchema`, because `evidence.js` requires both at load. `commissaire.ts` requires it the same way; `evidence.js`'s require graph reaches no module on the standalone binary's denylist (checked 2026-10-14). The payload check is skipped when the active governance profile is not `DELIVERY_PROFILE`; the core resolves it with `activeProfile()` (the default `eventViolations` already uses) before taking the lock, so no profile file is read inside the lock and a malformed override fails before anything is minted.

| Writer | Where the check runs | On violation |
|---|---|---|
| Every `events.jsonl` write (`appendEventRecord` and `emitGenesisRunStart`, so every caller: `bundle.js`, `contain.js`, `corrective.js`, `decision-capture.js`, `heartbeat.js`, `lights-out.js`, `merge-gate.js`, `resumecheck.js`, `run-ledger.js`, `self-intake.js`, `sentry-poller.js`, all via `appendRecordUnderLock`) | Inside the lock, on each minted record, after `seq` and `prev` are set | Nothing written; throws an error with `code: "EVENT_SCHEMA"` and the violations |
| `faff events append` | Agent payload normalised (below), then the core check | Exit 1, violations on stderr, nothing written |
| `appendEffectEntries` (schema 1 and 2) | Inside the mint callback, beside `declaredEffectViolations` | The callback records the violations and returns `null`, aborting the batch with nothing written; `appendEffectEntries` returns `{ violations }`, FAFF-1262's mechanism |
| `appendProducerRecords`, `appendCommissaireRecord` | Inside the mint callback, after `seq`, `prev` and the signature are set | The batch aborts; the verb exits 2 naming the violations |
| Governor-signed admission (`admit` in governor mode, `clientAdmit`) | On the governor's `admission_record`, before the producer files are written and before `appendVerbatimGovernorRecord` | Nothing written; exit 2 naming the violations |
| Governor-signed records (`request-decision`, `conclude` in governor mode) | In the `verify` seam passed to `appendGovernorRecordWithRetry`, composed with the signature check, before `appendVerbatimGovernorRecord` | Not appended; the driver returns its existing `governor-record-unverified` park (exit 2), and the seam writes the schema violations to stderr |

**Chosen:** the events core throws rather than returning `null`. Callers already handle a thrown `EVENTS_LOCKED` under their own loudness contract, so a thrown `EVENT_SCHEMA` takes the same routes, while a `null` would silently drop the event at callers that ignore the return. `faff events append` maps it to exit 1, the code it already uses for an invalid payload.

**Chosen:** no caller swallows `EVENT_SCHEMA` silently. Checked against main: `decision-capture.js` routes a throw to `bestEffortFail`, `merge-gate.js` `recordRunnerIdentity` and `heartbeat.js` `atomicWriteLedger` write a stderr warning, and `contain --record` and `self-intake --record` exit 2. Two callers need a change: `sentry-poller.js` catches with an empty block and must log through its own `appendLog` under a new `event-schema-refused` token (with the event type and violation messages), and `bundle.js` must write the violations to stderr.

**Chosen:** `faff events append` drops unknown top-level `data` keys from the agent's payload, records their names (never their values) in `data.dropped_keys` (a sorted array of strings, allowed on every type except `agent-dispatch` and `runner-identity`, whose extras are still refused), writes one stderr line naming them, and refuses everything else that fails. The chained record therefore shows that the agent tried to record more than the schema holds. The drop is bounded: when more than 16 keys would be dropped, or any dropped name fails `^[A-Za-z0-9_.-]{1,64}$`, the append is refused (exit 1) instead; the schema pins the item pattern. The drop applies to top-level keys only; a nested unknown key (inside a CLI-produced object such as budget `spent` or a sentry verdict) is refused, because those shapes are relayed from CLI output and an extra key there means the relay was edited.

**Chosen:** `dropped_keys` is reserved for the CLI. An agent payload that already carries `data.dropped_keys` is refused (exit 1), so the key on a chained record is always the CLI's own attestation and the count across anchors cannot be forged. Code writers never set it. The 16-item bound lives in the writer because the validator subset has no `maxItems` keyword.

**Chosen:** the drop never applies to a known key. The order is: existing `eventViolations` (so `agent-dispatch` and `runner-identity` extras still exit 1, as today), then the drop, then `--tokens` and `ledger-write` injection, then the core check. A known key with a bad value is refused before the drop runs, and a missing required key is refused by the core check after it. Code writers get no drop: an unknown key from code is a bug and must fail loudly.

**Chosen:** a type or kind with no mapping in the bundled composed schema is refused by the same check (the discriminator's "not in mapping" violation). Adding a type to `DELIVERY_PROFILE.event_types` or `EFFECT_KINDS` without its schema makes the first write fail, and the coverage test fails before that.

**Chosen:** at every writer of either log (events, effects, the Commissaire writers and the governor seams), an unavailable bundle (`validateEvidenceDocument` returns `{ unavailable }`) degrades to today's checks rather than refusing: the record is written after `eventViolations` (or `declaredEffectViolations`, the Commissaire signature and descriptor checks) alone, and the writer prints `schema-unavailable <path>` to stderr once per process (the poller logs it under `event-schema-refused`). This differs on purpose from the ledger serialiser, which refuses in its enforce mode: the ledger is rewritten whole and its next good write repairs it, while an event that is refused is lost for good, and the events a stranded run still needs (`park`, `sentry-checkpoint`, `sentry-trip`) carry no ledger write. The Commissaire writers follow the same rule: refusing a producer `observe` during an outage would lose the record of an effect that already happened, which the escape check needs, and the decision legs and signatures still run. Slice 6's mint and CI checks stay fail-closed, so a line written during the outage cannot reach a committed anchor unchecked.

**Chosen:** a degraded write leaves a durable trace in the run. The first degraded write in a run dir creates `<run-dir>/evidence-schema-unavailable.json` (`{first_at, writer, path}`, written once, never anchored). Lines written while degraded are unchecked, so once FAFF-1261 enforces, that issue's anchor may be refused with `schema-mismatch`; the recovery is to re-run the issue in a fresh run dir after fixing the install. FAFF-1261's in-flight drain treats a run dir holding this marker as one to re-run.

### Prose

The beep-boop "Run-event log" table gains a sentence: `data` keys outside a type's schema are dropped with a warning; the allowed keys per type are in `verification/evidence/v0.3/schema/events/<type>.schema.json`. `l4.md` and the `sentry-trip` prose need no change, since they relay CLI payloads. `logs.md` (both copies) replaces its "payloads stay open" note with the per-type table.

## 4. HOW

Build order, each step leaving the suite green:

1. Re-run the committed-data survey (Appendix A's shape) over the anchors on the branch base and author the 27 event, 16 effect and 8 Commissaire payload schemas by the rules above, with examples.
2. Write `scripts/evidence-v0.3-compose.mjs`, compose both schemas, refresh the bundled copy, and extend the slice-1 tests (DONE, From WHAT). Stop and report if a committed line fails and the rules cannot explain it.
3. Add `DELIVERY_PROFILE.event_types` entry `evidence-terminal-only` and its schema.
4. Run the full suite once with the core check switched on before wiring `faff events append`, so every test-driven writer is proved first. Then wire the events core and `faff events append`, and the two logging changes in `sentry-poller.js` and `bundle.js`.
5. Wire `appendEffectEntries`, then the three Commissaire writers; rebuild the TypeScript emit (`cd plugin/skills/faff && npm install && npm run build`) and commit `.js` plus `build-manifest.json`. The facade-agreement test lands here once FAFF-1224 has merged.
6. Prose sentence, README changelog line for v0.3, `logs.md` per-type table.

```
PROCEDURE events_append(payload, flags):           # faff events append, after JSON parse
  1. violations = eventViolations(payload, false); IF any -> exit 1 (unchanged)
  2. IF active profile is DELIVERY_PROFILE AND payload.data is an object:
       allowed = top-level data keys of the composed mapping for payload.type
       dropped = keys(payload.data) - allowed
       IF dropped: bound-check (<= 16, name pattern) else exit 1;
                   delete them; set data.dropped_keys = sorted(dropped);
                   stderr "faff events append: dropped data key(s) {k1, k2} not in the <type> schema"
  3. --tokens injection and ledger-write hash injection (unchanged)
  4. appendEventRecord -> core check; EVENT_SCHEMA -> print each violation, exit 1
```

```
PROCEDURE append_core(dir, mintRecord):            # appendRecordUnderLock, events only
  evidence.preloadEvidenceSchemas()                # outside the lock
  inside the lock:
    record = mintRecord(seq, prevRecord, prevHash)
    IF record is null -> abort (unchanged)
    IF profile is DELIVERY_PROFILE:
      r = evidence.validateEvidenceDocument("events.jsonl", record)
      IF r.unavailable -> degrade (marker file, one stderr line per process), continue
      IF r.violations non-empty -> throw { code: "EVENT_SCHEMA", violations }   # nothing written
    append (unchanged)
```

### Proving against committed lines

**Chosen:** the committed-line proof tests have no exceptions list. Every committed line that its line validator accepts must pass the composed schema; when one does not, the schema is widened by the rules above, never the line excused. This also covers the transition: a PR whose run started before this slice merged commits an anchor whose lines were written by the old, open writers, and if one of those lines carries a legitimate key the survey had not seen, the fix is to add the key. A per-PR exceptions entry would recreate the treadmill FAFF-1274 exists to end. The build's own anchor is surveyed too (its run starts before the slice merges). Until FAFF-1274 lands, the build adds its own `LEDGER_EXCEPTIONS` entry, as every recent build has.

### Edge cases

- **`data` absent** on a type where it is optional: valid. `data: {}`: valid.
- **Agent sends only unknown keys** for a type whose `data` is required (for example `issue-outcome` with just `foo`): `eventViolations` already refuses the missing `outcome` at step 1 (exit 1).
- **Legacy tokens** `{input, output, cache_write, cache_read}` supplied by an agent: `eventViolations` normalises before writing, so the line carries the five classes; a committed legacy line still passes the schema through the optional `cache_write`.
- **`$FAFF_GOVERNANCE_PROFILE` override:** no drop and no payload check; `eventViolations` under the override still runs.
- **Redaction:** the check runs on the redacted record, the bytes that land.
- **`run-resume` written both ways:** the code writer's top-level fields and the historic agent's `data` both pass the one `run-resume` schema.
- **A Commissaire request whose caller passes a malformed `effect`:** unchanged. The request is chained (its payload passes, the `effect` node being open), the verdict denies it `invalid-effect-descriptor`, and both records pass the composed schema.
- **A governor-mode verdict the schema refuses:** parks `governor-record-unverified`, the existing route for a record the client cannot verify; never retried as a lost race.

### Failure modes

- **A writer emits a shape the survey missed.** How you'd know: an `EVENT_SCHEMA` throw or exit 1 in a real run, or a CI failure in a test that drives a writer. What it means: proceed; v0.3 is draft until FAFF-1261, so the schema is widened in place by the rules above (an additive change under FAFF-1258's `classifySchemaChange`), never by loosening `additionalProperties`.
- **The drop hides information an agent meant to record.** How you'd know: `dropped_keys` on committed event lines, countable across anchors. What it means: proceed; if a key recurs, add it to the type's schema and the prose table.
- **A refused `ledger-write` record.** How you'd know: the existing stderr line from `atomicWriteLedger` ("the ledger IS written; the chain gap will surface"). What it means: block; the ledger-write data is CLI-computed, so a refusal is a schema bug, and the DONE fixture proves the shape.
- **A refused `runner-identity` record.** How you'd know: the stderr warning from `recordRunnerIdentity` and a missing `runner-identity` line in the anchor. What it means: block; Gate 1 trusts only that record, so the schema must accept every shape `resolveRunnerIdentity` returns (DONE).
- **Facade v0.3 and the evidence schemas disagree.** How you'd know: the facade-agreement test fails. What it means: block; settle which side describes the code wrongly, never relax the test.

**Anti-pattern:** hand-editing `run-event.schema.json` or `declared-effect.schema.json`. Why: they are generated; the compose `--check` test fails, and the per-type files are the authored source.

**Anti-pattern:** closing a named open node to make a test pass. Why: each one is checked by a contract that owns its contents; closing the Commissaire `effect` nodes moves a gate decision.

## Scenarios

```
Given a run dir and an agent payload {"phase":"build","type":"issue-outcome","issue":"FAFF-1","data":{"outcome":"shipped","rework_turns":0,"mood":"great"}}
When it is piped to `faff events append --run <run>`
Then the command exits 0, stderr names the dropped key "mood" and not its value, and the appended line's data is {"outcome":"shipped","rework_turns":0,"dropped_keys":["mood"]}
And `faff events verify` on the run passes
```

```
Given an events core caller that mints {"type":"runner-identity", data with credential_source "ambient", github_login 7, ...}
When appendEventRecord runs
Then it throws with code EVENT_SCHEMA, events.jsonl is byte-identical to before, and the violation names data.github_login without printing 7
```

```
Given a commissaire admission and a producer key
When `faff commissaire request-decision` receives {"effect":{"kind":"merge","target":"main","colour":"red"}}
Then it exits 0 with verdict deny and reason invalid-effect-descriptor, exactly as before this slice
And the chained request and verdict records both pass the composed declared-effect schema
```

```
Given an in-process appendCommissaireRecord call whose admission payload carries an extra key "colour"
When the record is minted
Then the batch aborts, the verb exits 2 naming payload.colour, and declared-effects.jsonl is byte-identical to before
```

- Every committed `events.jsonl` line that `eventViolations(line, true)` accepts passes the composed v0.3 `run-event` schema, with no exceptions list.
- Every committed `declared-effects.jsonl` line that `declaredEffectViolations` accepts passes the composed v0.3 `declared-effect` schema, with no exceptions list.

## 6. DESIGN DECISION RATIONALE

- **Where is the payload enforced?** At mint only would leave non-conforming lines permanently in chained logs. **Chosen:** at every writer, inside the append lock.
- **How do discriminators select a payload schema?** `data` does not carry `type`, and one node has one discriminator. **Chosen:** a type discriminator under the schema-2 mapping, each type file the whole closed record; effects discriminate inside `effect` on `kind`; schema-3 discriminates on `kind_of_entry`.
- **Author per-type files or one large schema?** One file would be unreadable and the subset has no `$ref`. **Chosen:** per-type authored files composed by a script, with a `--check` test.
- **New validation module or the existing one?** `evidence.js` already loads, caches and validates the bundled schemas from inside a lock for the ledger serialiser. **Chosen:** reuse `validateEvidenceDocument` and `preloadEvidenceSchemas` through lazy requires.
- **Refuse or drop unknown agent keys?** Refusing loses whole events such as `issue-outcome` when an agent adds a note. **Chosen:** drop with a warning for agent payloads at `faff events append`, named in `dropped_keys`; refuse everything else, and refuse unknown keys from code.
- **Throw or return null from the events core?** Null silently loses events at callers that ignore it. **Chosen:** throw `EVENT_SCHEMA`, mirroring `EVENTS_LOCKED`.
- **Close the Commissaire request and verdict `effect`?** Closing it refuses a malformed request before it is chained, so `invalid-effect-descriptor` could never be issued for it. **Chosen:** a named open node; the decision leg keeps judging it.
- **Generate schema-3 schemas from the facade or prove them against it?** The facade leaves nodes open that the evidence spec closes, and the two specs hold opposite trust postures. **Chosen:** authored evidence files plus a facade-agreement test against v0.3.
- **Close schema-1 event payloads?** No writer emits schema 1. **Chosen:** leave schema 1 as slice 1 published it.
- **How strict for a kind with no writer?** **Chosen:** the strictest shape, so a future writer must extend the schema.
- **Which conclusion name?** **Chosen:** both, following `conclusionKindOf`.
- **Legacy `tokens.cache_write`?** **Chosen:** optional in the schema; the line validator keeps the five-class rule for new writes.
- **Fail open or closed when the bundled schema is missing?** Closed at the event writer loses events a stranded run still needs. **Chosen:** degrade the writer to today's checks with a stderr line and a run-dir marker; mint and CI (slice 6) stay closed.
- **Close every nested object?** Kernel-owned and Commissaire-judged objects have owners that check them. **Chosen:** five named open nodes, asserted by the closure test.
- **Where does the governor record's schema check sit?** `appendVerbatimGovernorRecord`'s `null` means a lost race. **Chosen:** in the driver's `verify` seam, reusing its park.
- **Per-kind target patterns?** **Chosen:** none in this slice; keys and types only.
- **Per-type phase sets?** No type-to-phase table exists in code. **Chosen:** every type accepts all five phases.
- **What do best-effort callers do with `EVENT_SCHEMA`?** Swallowing hides a lost supervision event. **Chosen:** log it (poller log, stderr) and keep the never-block contract.
- **Exceptions list for committed lines?** One would grow with every in-flight PR. **Chosen:** none; widen the schema for legitimate writer output.
- **Who registers `evidence-terminal-only`?** **Chosen:** whichever of FAFF-1268 and FAFF-1260 merges first; neither blocks the other.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

- **Assumes:** FAFF-1224 publishes `verification/commissaire-facade/v0.3/` with one record schema per schema-3 kind (naming `conformed_to_contract`) and examples from a governed run, as its ticket's done list states, and changes no record-kind name the code writes. Validation: the directory exists on the branch base and `KIND_AUTHOR` still lists `conformed_to_contract`. If the facade's shapes differ from the code, the agreement test fails and the fix belongs to whichever side misdescribes the code.
- **Assumes:** FAFF-1268 has not registered `evidence-terminal-only` when this slice is built. Validation: the type is absent from `DELIVERY_PROFILE.event_types` on the branch base; if present, this slice only checks it.

## 8. DONE

Run each test with `node --test <file>` from the repo root; pass means exit 0.

### From WHY
- [ ] No anchor or merge decision changes: `test/merge-gate-local.test.mjs`, `test/governance-check*.test.mjs`, `test/commissaire*.test.mjs` and the `faff events verify` / `faff effects verify` selftests pass unchanged
- [ ] Every write path for both logs runs the payload check: a test drives each writer in the Writers table with one non-conforming record and asserts nothing is written

### From WHAT (schemas)
- [ ] `verification/evidence/v0.3/schema/events/` holds exactly one file per `DELIVERY_PROFILE.event_types` member (27), `effects/` one per `EFFECT_KINDS` member (16), `commissaire/` one per `KIND_AUTHOR` key plus `accepted_under_contract` (8); asserted against the imported constants in `test/evidence-payload-coverage.test.mjs`
- [ ] Each Commissaire schema's `author` enum equals `[KIND_AUTHOR[kind]]` (the legacy name uses the current name's author)
- [ ] No separate source scan: `eventViolations` refuses any event type outside `event_types` and `effectDescriptorViolations` any kind outside `EFFECT_KINDS` at write time, so the file-per-member assertion is the whole coverage proof
- [ ] `node scripts/evidence-v0.3-compose.mjs --check` exits 0, and a test runs it; hand-editing a composed file makes it exit 1
- [ ] `test/evidence-v0.3.test.mjs` is extended: the closure test walks the `events/`, `effects/` and `commissaire/` subdirectories and nested discriminator bases, and allows exactly the five named open nodes (slice 1's `OPEN_PAYLOADS` allowance for `data`, `effect` and `payload` is removed for schema 2 and 3); the enum-mirror test reads the event type list from the schema-2 discriminator mapping keys and also asserts every schema enum sourced from a code constant equals it (`ledger_outcomes`, `QUALITY_GATE_CATCHES`, `DISPATCH_KINDS`, `DECISION_CAPTURE_COVERAGE_VALUES`, `RUNNER_IDENTITY_CREDENTIAL_SOURCES`, `EFFECT_KINDS`, `KIND_AUTHOR`, `DECISION_VERDICTS`), so a constant changed in code without its schema fails the suite before it refuses a live write; the example test walks the example subdirectories
- [ ] Every payload schema has a valid and an invalid example, listed in `test/evidence-spec.test.mjs` `PAIRS`
- [ ] `agent-dispatch` and `runner-identity` `data` key sets equal `DISPATCH_ALLOWED_DATA_KEYS` and `RUNNER_IDENTITY_ALLOWED_DATA_KEYS`; a record from `resolveRunnerIdentity` for each credential source, including the unresolved-login case, passes
- [ ] `evidence-terminal-only` is in `DELIVERY_PROFILE.event_types`, not in `issue_scoped_types`, and its schema requires `data.issue` and `data.writer`
- [ ] The committed-line proof tests over `events.jsonl` and `declared-effects.jsonl` run against the composed schemas with no exceptions list
- [ ] Records produced by the code writers in tests (`ledger-write` from `atomicWriteLedger`, `lights-out.test.mjs` L4 resume, `resumecheck` release, corrective, contain, self-intake, bundle store-unavailable, `park-reconsidered` from the lights-out resume reconsider path, a governor-custody admission and verdict, a conclusion, a decision capture) pass the composed schemas
- [ ] The `signal` discriminator mapping in the sentry `verdicts[]` item schema has exactly the keys of `SIGNAL_TRIP_INTERVENTION` (imported from `sentry.js`), and the test holds one fixture verdict per key, built by that signal's `eval*` function, which passes the `sentry-checkpoint` and `sentry-trip` schemas
- [ ] Facade agreement (after FAFF-1224 merges): every kind the facade v0.3 schemas name has an evidence mapping with the same `author`; envelope and payload properties agree in name and type apart from the named open `effect` nodes and the optional `unit_id`/`issue` pair; every facade v0.3 example record passes the composed `declared-effect` schema

### From HOW (writers)
- [ ] The four Scenarios pass as tests
- [ ] `faff events append` exit codes: 0 with a drop warning naming keys only and `data.dropped_keys` on the line; 1 for a type error, a missing required key or an `agent-dispatch` extra (unchanged); 3 for a missing run dir (unchanged)
- [ ] With `$FAFF_GOVERNANCE_PROFILE` set to the second profile, `faff events append` of a `job-start` event exits 0 with no drop
- [ ] With the bundled `run-event.schema.json` removed (temp copy of the plugin tree), `faff events append` exits 0, writes the record after `eventViolations`, and stderr names `schema-unavailable`; an event type absent from a loaded schema still exits 1
- [ ] A degraded write creates `evidence-schema-unavailable.json` in the run dir once, with `first_at`, `writer` and `path`; a degraded Commissaire write does the same; `faff events anchor` on that run dir does not copy the marker into the anchor
- [ ] A governor-mode `admit` whose returned admission record fails the schema exits 2 and writes neither the producer files nor a ledger line
- [ ] `faff events append` refuses (exit 1) a payload that would drop more than 16 keys or a key name outside `^[A-Za-z0-9_.-]{1,64}$`; a nested unknown key exits 1; a known key with a bad value exits 1 and is never dropped; an agent-supplied `data.dropped_keys` exits 1
- [ ] `data` absent and `data: {}` on an optional-`data` type (`prep-start`) both append (exit 0, no `dropped_keys`)
- [ ] With the sentry payload schema made stricter in a temp plugin copy, a poller abort tick writes an `event-schema-refused` line to the poller log and no event; `bundle.js` store-unavailable with a refused record writes the violation to stderr
- [ ] A governor-mode `request-decision` whose governor record fails the schema parks `governor-record-unverified` (exit 2), writes the violations to stderr, and is not retried as a lost race
- [ ] `appendEffectEntries` refuses an effect with an extra key or an unschemaed kind, writing nothing and returning `{ violations }`
- [ ] The TypeScript emit is rebuilt and committed; `faff regions check`, `test/commissaire-standalone.test.mjs` (denylist) and `faff commissaire --selftest` pass
- [ ] The full suite passes; any existing test fixture edited because it wrote a payload no writer emits is listed with its reason in the PR description

### From HOW (prose and docs)
- [ ] The beep-boop "Run-event log" section states the drop rule and names the schema path; `verification/evidence/v0.3/logs.md` (and its bundled copy) lists each event type's `data` keys, each effect kind and each Commissaire kind; the README changelog has a dated slice-5 entry

### Integration smoke test

```
PROCEDURE smoke():
  1. faff run-ledger init-interactive -> new run dir (genesis run-start passes the core check)
  2. append prep-start, prep-done --tokens, issue-outcome {outcome: shipped, mood: x} -> exit 0, mood dropped
  3. faff effects declare + observe a merge effect -> exit 0
  4. faff events verify and faff effects verify on the run -> pass
  5. faff events anchor for the issue into a temp dest; faff evidence validate on it
     -> events.jsonl and declared-effects.jsonl report ok
```

## Appendix A. Committed payload survey (2026-10-14)

6,044 event lines in 397 anchors (105 schema 1, 5,938 schema 2, one malformed), 1,395 declared-effects lines (62 schema 1, 1,055 schema 2, 278 schema 3). Observed `data` keys by type, with types:

- `ledger-write` (1,860): `ledger_sha256`, `note` strings
- `issue-admitted` (1,181): `verdict`, `confidence`, `build_tier` strings
- `decision-capture` (642): `kernel`, `kernel_version`, `coverage`, `correlation_id`, `selected_action` strings; `normalised_inputs`, `causation` objects; `missing_inputs` array; `verdict` object or string
- `build-start` (489): `resume` string or boolean; `attempt` integer or string; `worktree`, `branch` strings; `sequential` boolean
- `run-start` (388): `mode`, `level`, `containment`, `branch_protection`, `tokens_source`, `note` strings; `requested` integer or array of strings; `issue_count`, `count`, `admitted`, `routed_out` integers; `issues`, `list` arrays of strings; telemetry
- `prep-done` (351): `return`, `outcome`, `verdict`, `result`, `confidence`, `disposition`, `bucket`, `spec_review` strings; `iterations`, `rounds` integers; telemetry
- `issue-outcome` (329): `outcome`, `gate`, `verdict`, `via` strings; `rework_turns`, `pr` integers; telemetry
- `park` (227): `cause`, `reason`, `evidence`, `resolve_attempt`, `outcome`, `verdict`, `root_cause`, `note`, `category`, `leg`, `root_cause_class`, `reconsider` strings; `iterations` integer; `resumable` boolean; telemetry
- `sentry-checkpoint` (168): `run_dir`, `intervention`, `authority`, `signal`, `note`, `advisory`, `member` strings; `verdicts` array; `tripped`, `config_malformed`, `advisory_L3`, `stall_window_env_ignored` booleans; `thresholds`, `detection_trust`, `reconcile_check` objects; `run_elapsed_secs`, `ceiling` integers
- `prep-start` (118): no `data` keys
- `budget-checkpoint` (50): `spent` object; `breached` array of strings; `outcome`, `at`, `note` strings; `resume_at` null; telemetry (`tokens` object or null)
- `sentry-trip` (40): `verdicts`, `intervention`, `remediation`, `note`, `guard`, `live_level`, `attempted_issue`, `orchestrator_disposition`, `basis`
- `agent-dispatch` (40): `dispatch_id`, `cluster_id`, `kind` strings; `cluster_size` integer
- `run-end` (14): `stop_reason` string; `shipped`, `parked` integers; telemetry
- `runner-identity` (13): `github_login` null; `github_login_source`, `credential_source` strings; `credential_unresolved`, `verified` booleans
- `tidy-done` (10): `scope` string; `park_labels_cleared`, `prep_candidates` integers; telemetry
- `containment-check` (8), `self-intake-check` (4), `discovered-scope-filed` (4, `source` string), `run-resume` (1, `data` form), `decision-capture-action` (1)
- Not yet present in any committed anchor: `corrective-authored`, `corrective-consumed`, `run-claim-abandoned`, `park-reconsidered`, `bundle-store-unavailable`; their schemas come from code only
- Legacy `tokens` objects carry `cache_write` instead of the two TTL classes
- Effects (schemas 1 and 2): `merge`, `push`, `branch-delete`, `tracker-write`, `label-write`, `pr-create`, `file-write` present, always exactly `{kind, target, reversible}`; 4 schema-2 declare lines carry `origin`, 1 carries `github_actor`
- Schema 3: `admission` (67, `custody` null on all), `declare` (57), `observe` (53), `effect-decision-request` (48, `declared_ref` null on all, `effect` `{kind, target}`), `effect-decision-verdict` (48, all `all-legs-pass`), `conformed_to_contract` (5); no `accepted_under_contract` or `reconcile` records

## Refresh notes

Refreshed on 2026-10-14 against main at `10a8ece4`. Decisions that still hold are unchanged. What changed:

- **Validation module.** The spec's new `evidence-schemas.js` is dropped. FAFF-1258 shipped `validateEvidenceDocument` and `preloadEvidenceSchemas` in `evidence.js`, with the cached-fault loader the old module would have duplicated; the writers now call those through lazy requires. `evidence.js` was checked against the standalone Commissaire denylist and reaches no denylisted module.
- **Commissaire request and verdict `effect`.** The previous scenario had `request-decision` refuse a descriptor with an extra key before chaining. On main, `cmdRequestDecision` chains the raw descriptor and `evaluateDecisionRequest` denies it `invalid-effect-descriptor`, a reason the published facade documents, so the refusal would have moved a gate decision. Both `effect` nodes are now named open nodes (five in total) and the scenario asserts the unchanged deny; a new scenario covers a code-side extra key.
- **Facade v0.3 (FAFF-1224, now a blocker).** The schema-3 files are proved against the facade v0.3 record schemas and examples by a new agreement test, with FAFF-1224's interface taken from its ticket. FAFF-1264, which the previous spec assumed, was closed as a duplicate of FAFF-1224.
- **Emitter of `evidence-terminal-only`.** FAFF-1257 was split; the emitter is now FAFF-1268 (2b, not built).
- **Best-effort callers.** The caller list is complete against main: `decision-capture.js`, `merge-gate.js` and `heartbeat.js` already log a throw, so only `sentry-poller.js` and `bundle.js` change. A refused `runner-identity` record is a named failure mode because Gate 1 trusts only that record.
- **Schema-unavailable rationale.** Restated against FAFF-1258's enforce-mode ledger serialiser, which refuses on an unavailable bundle; the event writers still degrade, for the reason given.
- **Slice-1 tests.** Named the concrete edits to `test/evidence-v0.3.test.mjs` (closure walk, enum mirror, example subdirectories) that the restructure forces.
- **Proof without exceptions.** Added the rule that committed-line proofs have no exceptions list, covering anchors from runs that straddle the merge, and noted the build's own `LEDGER_EXCEPTIONS` entry until FAFF-1274 lands.
- **FAFF-1263.** `faff evidence-readiness` lists FAFF-1260 as a writer ticket, so the proving runs (FAFF-1270) must start after this slice merges.
- **Survey.** Appendix A re-run on 2026-10-14: `runner-identity`, `file-write`, governor requests and verdicts, and `conformed_to_contract` records now appear in committed anchors.
- **Removed** the `REGION_MAP["evidence-schemas"]` criterion (no new module).
- **Round-4 review fixes:** governor-mode `admit` added to the Writers table; the unavailable-bundle rule now covers every writer of both logs, Commissaire included; `dropped_keys` is reserved for the CLI; the enum-mirror test covers every code-sourced enum; `ledger-write` joins the code-writer fixtures; the run-dir marker is asserted never anchored; profile resolution happens before the lock.
- **Risk step:** the build-order step that runs the full suite with the core check on before wiring `faff events append` (the previous critique's risk action) is now HOW step 4.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized?** Past a 1–3 day unit, with two separable halves (unchanged from the first prep).
- **What's there:** (a) 27 event `data` schemas, the events write core, `faff events append` and the two caller logging changes; (b) 16 effect and 8 Commissaire payload schemas, `appendEffectEntries`, three Commissaire writers with a TypeScript rebuild, and the facade-agreement test. `build-tier: complex`.
- **Why:** Half (a) touches every event write in a live run; half (b) touches the signed ledger. Shipped together, a surprise in either holds back the other and makes a revert coarse.
- **What to do:** Ship as two PRs under this ticket, events first (HOW steps 1 to 4), then effects and Commissaire (step 5).

**Workstream fit?** No issues.

**Deps surfaced?** All load-bearing deps are linked; one link is wider than the work it gates.
- **What's there:** FAFF-1224 blocks the whole ticket, but only half (b)'s facade-agreement test needs it. FAFF-1256 and FAFF-1262 are merged; FAFF-1268 is related, not a blocker, by design (either can register `evidence-terminal-only`); FAFF-1261 and FAFF-1270 are linked as blocked by this ticket.
- **Why:** While FAFF-1224 sits in Backlog, automation cannot pick up half (a), which has no dependency on the facade, and FAFF-1270's proving runs wait on both halves.
- **What to do:** Either build half (a) by hand ahead of FAFF-1224, or split half (b) into its own child ticket blocked by FAFF-1224 so half (a) becomes unblocked.

**Risk profile?**
- **What's there:** The riskiest unknown is still a code writer whose real output the survey never saw (five event types have no committed instance), plus the `runner-identity` record that Gate 1 trusts.
- **Why:** That writer would start throwing `EVENT_SCHEMA` in a live run; a refused `runner-identity` would surface at the merge gate.
- **What to do:** Keep HOW step 4's full-suite run with the core check on before wiring the agent path, and the `resolveRunnerIdentity` fixture per credential source.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-4 minors fixed, not re-reviewed)
