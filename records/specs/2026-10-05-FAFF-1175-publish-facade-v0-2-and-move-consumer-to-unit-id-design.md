# nlspec: FAFF-1175, publish the facade v0.2 schema reference and move the external consumer to `unit_id`

> Spec: faffter-dark-nlspec · 2026-10-05 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1175.

This spec is the buildable artifact for FAFF-1175, the second half of the FAFF-1167 → FAFF-1175 PR train. Its readers are the build agent and the reviewers who gate it. Every codebase claim below was checked against `origin/main` at `475c0362` (the FAFF-1167 merge, PR #1003).

Revised on 2026-10-05 after spec-review round 1 (`reject-approach`: one infosec major, five minors across the architectural, infosec and methodology lenses; QA clear). Changes: the version-routing rule becomes a documented reader contract with a fourth outcome; the reconcile unit fields gain a test-enforced string-or-null rule; the source ledger ships beside the examples so "byte-carried" is checkable; the build order is stated; the admission's `unit_id: "-"` is stated and verified; `DRIFT` becomes a test-time commit instead of a PR head.

Clarified on 2026-10-05 after spec-review round 2 (`reject-approach` on three minors, majors cleared; converging 5 → 3) and **not re-reviewed**: `route_record` gains a `schema: 3` precondition so `schema:2` rows are routed out rather than failed; the harness README test retires the forbidden phrase whose claim is now true and gains a required "does not claim" caveat instead of wording around the guard; the `EXPECTED` pin's lifetime is argued; the build order adds a custody-file key check; the example-sourcing note states which provenance CI checks and which stays an attestation.

## 1. WHY: problem and principles

**The load-bearing model.** A `schema:3` record's key names are inside its signature, so a frozen record keeps the key it was written with forever. FAFF-1167 made the writer emit `unit_id` and taught every Commissaire reader to accept either key, rejecting a record that carries both. The published facade reference still describes only the old shape (`verification/commissaire-facade/v0.1/`, which requires `issue`), and the one external consumer (the FAFF-360 bare Claude Code harness) still passes `--issue` and reads `issue`. This ticket publishes the new shape as v0.2 beside the frozen v0.1, and moves the consumer to the new key.

**Problem.** Since FAFF-1167 merged, every new governed record carries `unit_id`, and the v0.1 schemas (`additionalProperties: false`, `issue` required) reject it. A reuser building against the reference today builds against a shape Commissaire no longer writes. The FAFF-360 harness keeps passing only because it drives a driver checkout pinned at `fd1e9788`, which predates FAFF-1167, so it proves nothing about the code on `main`.

**Design principles.**

- **Published versions are immutable.** The facade README's versioning policy says a landed version directory never changes. v0.1 stays byte-identical and remains the read shape for frozen `issue`-keyed records.
- **The code is the source of truth.** v0.2 mirrors what the code at `475c0362` writes and prints; where a schema and the code disagree, the schema is fixed.
- **Examples come from a real governed run, scrubbed only of secrets.** This is the v0.1 sourcing rule, carried forward.
- **No fabricated governance evidence.** The external harness must never write faff build evidence (`ac-checklist.json`, `review-verdict.json`) it did not earn.

**Reference context.**

| File | Language | Role in this change |
|---|---|---|
| `verification/commissaire-facade/v0.1/` | Markdown + JSON Schema | Frozen baseline; copied as the starting point for v0.2, never edited |
| `verification/commissaire-facade/README.md` | Markdown | Version table, layout, example-sourcing note, changelog |
| `test/commissaire-facade-spec.test.mjs` | JavaScript | The CI drift alarm; validates examples against schemas via `validate-schema.mjs` |
| `plugin/skills/faff/contracts/validate-schema.mjs` | JavaScript | Subset validator: `type`, `required`, `properties`, `enum`, `additionalProperties`, `items` |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | Writer and readers after FAFF-1167: `invalid-unit-key` deny reason, `withUnitId` on reconcile escapes, dual-field conclude and anchor output |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | `computeEscapes`, including the `rejected-unit-key` escape `{ signal, issue: null, step, seq, escaped, event_seq: null }` |
| `verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs` | JavaScript | The FAFF-360 external consumer; pins `EXPECTED_COMMISSAIRE_REVISION` |
| `verification/external-verification/scaffold-commissaire-bare-claude.sh` | Bash | Scaffolds the consumer; pins the same revision |
| `verification/external-verification/commissaire-bare-claude/README.md` | Markdown | In-repo README and the template for every capture README |
| `verification/external-verification/commissaire-bare-claude/CAPTURE-RUNBOOK.md` | Markdown | Operator runbook; names the pinned revision |
| `test/impure/commissaire-bare-claude.test.mjs` | JavaScript | The FAFF-360 harness test; pins `EXPECTED` and `DRIFT` |
| `test/fixtures/commissaire/secret-free-replay/declared-effects.jsonl` | JSONL | Four frozen `issue`-keyed `schema:3` records |
| `docs/guide/commissaire-reuse.md` | Markdown | Links the facade reference at v0.1 |

**Scope statement.** This change sits at the published facade reference and the external consumer harness. It changes no Commissaire or faff runtime code.

## 2. OUT OF SCOPE

- **Removing the `--issue` alias and the dual `issue` output field.** The follow-on to this ticket's open question, after the FAFF-360 harness runs on `unit_id`. Extension point: the coordinated edit FAFF-1167's spec names (`COMMISSAIRE_SPEC.flags`, `parseCommissaireArgs`, `normaliseUnitFlag`, usage text, the dual output fields). That removal changes the reconcile escape shape, so it also publishes a v0.3 with the `issue` alias field gone from `reconcile.schema.json`.
- **Any Commissaire or faff runtime change.** FAFF-1167 owns the code. Extension point: `commissaire.ts`, `effects.js`.
- **Schemas for CLI summary outputs** (the `verdict conclude` and `audit anchor` JSON). v0.1 does not schema them and v0.2 keeps that line; `records.md` describes their one-release dual fields in prose. Extension point: a future `schema/conclude-output.schema.json`.
- **The FAFF-1016 and FAFF-1017 cited gaps** in the harness README. Unchanged here.
- **`faff effects`, `faff run-ledger` and `faff events` flags in the harness.** They keep their own `--issue` flags (FAFF-1167, section 3); only `commissaire` invocations move to `--unit-id`.
- **Publishing a new operator-attested capture** (FAFF-1030). A later capture runs at the new pin; no capture is published here.

## 3. WHAT: vocabulary, artifacts and interfaces

| Term | Meaning |
|---|---|
| unit key | `issue` (v0.1 records, `schema:2` rows) or `unit_id` (v0.2 records) |
| frozen record | A signed record already on disk under the old key: the replay fixture, the v0.1 examples, banked evidence, committed anchors |
| new record | A `schema:3` record written by the FAFF-1167 writer, carrying `unit_id` |
| dual-key record | A record carrying both `issue` and `unit_id`; no writer produces one and every reader rejects it |
| driver pin | The SuperDomestique revision the FAFF-360 harness provisions and runs: `EXPECTED` in the harness test, `EXPECTED_COMMISSAIRE_REVISION` in the verifier and the scaffolder |

### The v0.2 directory

v0.2 is a complete, self-contained version directory with v0.1's layout:

```
verification/commissaire-facade/v0.2/
  records.md       every record kind, plus the "Reading v0.1 and v0.2 records" section
  keypair.md       the governor/producer custody files (shape unchanged from v0.1)
  conformance.md   posture, the audit verify contract, drift note, version binding (v0.2)
  schema/*.schema.json            $id: faff/commissaire-facade/v0.2/<name>
  schema/examples/*.example.json  carried from a governed run at 475c0362
```

**Chosen:** a complete copy, not a delta over v0.1. Rationale: the README's layout and versioning policy treat each version directory as the whole citable reference, and a reuser should not have to merge two directories to know a shape.

### Schema changes from v0.1

| Schema | Change in v0.2 |
|---|---|
| `facade-envelope` | `unit_id` (string) replaces `issue` in `properties` and `required`; `additionalProperties` stays `false`, so an `issue`-keyed or dual-key record fails |
| `admission`, `effect-claim`, `effect-decision-request`, `effect-decision-verdict`, `accepted-under-contract` | The same `issue` → `unit_id` swap in each record's envelope fields; `step` unchanged. The admission carries `unit_id: "-"` (checked: seq 0 of the source run at `475c0362` is `"unit_id":"-","step":"admit"`, written by `cmdAdmit`, which takes no unit flag) |
| `effect-decision-verdict` | `payload.reason` enum gains `invalid-unit-key` (the FAFF-1167 deny leg, checked after authentication) |
| `reconcile` | Each escape gains required `unit_id`; `signal` enum gains `rejected-unit-key`; `issue` and `unit_id` carry no `type` (a string, or `null` on a `rejected-unit-key` escape or an unattributed escape); optional integer `seq` (present on `rejected-unit-key`) |
| `effect-descriptor`, `governor-keypair`, `producer-pk`, `producer-admission` | Shape unchanged; only `$id` moves to v0.2 |

Every enum keeps mirroring the code: `kind_of_entry` and the authors from `KIND_AUTHOR`, the reasons from `evaluateDecisionRequest`, the effect kinds from `EFFECT_KINDS`. The build agent re-reads those constants at `475c0362` and copies them, never retypes them from this table.

**Chosen:** `issue` and `unit_id` on reconcile escapes carry no `type` in the schema, as v0.1 already does for `event_seq`, and the string-or-null rule is enforced by the CI test instead. Rationale: the subset validator supports only a single `type`, so `string | null` cannot be expressed in the schema. `records.md` states the rule (each is a non-empty string, or `null`, and the two are equal on every escape), and the test asserts it over every reconcile example, so a value such as `issue: 42` fails CI even though the schema alone would pass it. This is the same split v0.1 uses for the author-keyed authenticator rule.

**Chosen:** the reconcile escape keeps `issue` as a required field in v0.2. Rationale: the code at `475c0362` prints it on every escape for one release (`withUnitId` adds `unit_id` beside it), and v0.2 documents what the code emits. The alias removal publishes v0.3.

### The reader rule (`v0.2/records.md`, new section "Reading v0.1 and v0.2 records")

The two versions are mutually exclusive by construction: an `issue`-keyed record fails v0.2 and a `unit_id`-keyed record fails v0.1. So the section is a normative reader contract, not a note: **a reader routes each record by key presence first, then validates it against the routed version's schema.** It states the procedure and its outcomes:

```
PROCEDURE route_record(record) -> not-facade | v0.1 | v0.2 | rejected | unresolvable
  IF record.schema != 3:                                   RETURN not-facade   # schema:2 rows: evidence spec, not this one
  hasIssue := record has own property "issue" with a value other than undefined
  hasUnit  := record has own property "unit_id" with a value other than undefined
  IF hasIssue AND hasUnit:                                RETURN rejected
  key := "unit_id" IF hasUnit ELSE "issue" IF hasIssue ELSE none
  IF key is none OR record[key] is not a non-empty string: RETURN unresolvable
  RETURN v0.2 IF key == "unit_id" ELSE v0.1
```

| `route_record` returns | It is | A reader |
|---|---|---|
| `v0.1` | a frozen record | resolves the unit from `issue`; validates it against the v0.1 schemas |
| `v0.2` | a new record | resolves the unit from `unit_id`; validates it against the v0.2 schemas |
| `rejected` | a dual-key record | rejects it: it matches no unit, Commissaire denies a decision request over its ledger `invalid-unit-key`, and `effect reconcile` reports it as its own `rejected-unit-key` escape; it validates against neither version |
| `unresolvable` | a record with no usable unit | matches no unit; it fails both envelopes |
| `not-facade` | a `schema:2` row (or any non-3 schema) sharing the ledger | out of this spec's scope: the flight-recorder evidence spec covers it, and it is never validated against either facade version |

It says plainly: a reader must never validate a mixed ledger against a single version, and must never relax `additionalProperties` or drop the unit key from `required` to make a mixed ledger pass; either one discards the property that a record's shape is exactly what the governor signed. The routing rule mirrors `unitIdOf` / `carriesBothUnitKeys` in `effects.js`, which is the enforcement.

It also states: the record `schema` integer stays `3`, so among `schema:3` records key presence, never the integer, tells v0.1 and v0.2 apart; one ledger may mix v0.1-shaped records, v0.2-shaped records and `schema:2` rows (which keep `issue`); the compatibility read is permanent because frozen records are immutable; the dual-key rule applies to ledger records, never to CLI output; for one release the `verdict conclude` output, the `audit anchor` output and every reconcile escape carry both `issue` and `unit_id` with the same value, and `effect declare` and `effect observe` echo the signed record verbatim (so `unit_id` only); `--unit-id` is the flag, with `--issue` a deprecated alias for one release and both together refused.

### Example sourcing

The record and keypair examples come from one governed run of the FAFF-360 harness against a driver checkout at `475c0362` (the new pin, section 4). That run writes every kind a normal governed run emits: `admission`, a denied `effect-decision-request` / `effect-decision-verdict` pair (`effect-not-declared`), `declare`, a granted pair (`all-legs-pass`), `observe`, and `accepted_under_contract`. Each example is the byte-for-byte record from that run's `declared-effects.jsonl` or custody files, with the secret halves (`sk`, `master_secret`, `key_hex`) redacted exactly as v0.1 redacts them. The examples name the run id they came from, and the README and `records.md` example-sourcing notes name the source run, the driver revision and the redactions. They also say that `DEMO-1` (the unit) and `bare-claude` (the producer) are the harness's demonstration identifiers, not values to copy.

The source run's whole ledger ships too, as `schema/examples/source-run.declared-effects.jsonl` (eight `schema:3` records; it holds no secret, since ledger records carry only signatures, HMACs and public fields). The test then checks the "byte-carried" claim instead of trusting it: each record example must deep-equal the ledger line with the same `seq`, and every ledger line must pass its v0.2 kind schema and the v0.2 envelope.

**Chosen:** ship the source ledger. Rationale: v0.1's examples are an unverifiable attestation once the source run directory is gone; shipping the ledger makes the record examples' provenance a CI fact at the cost of one small file. The three keypair examples and the `conformance.md` `audit verify` counts stay attestations, as in v0.1: the custody files hold secrets and are redacted, and the counts come from the source run directory; `records.md` says so.

**Chosen:** source the examples from the FAFF-360 harness run rather than a faff graft run. Rationale: the harness drives the shipped `commissaire` binary from a checkout at `475c0362`, which is the ticket's "code at or past FAFF-1167" condition held exactly, it is reproducible from in-repo tooling, and it emits a deny verdict as well as a grant. A graft run in this session drives the installed `faff`, which is not guaranteed to be at or past FAFF-1167. The harness verdicts carry no `level` fields because the harness passes no policy level; the schemas keep those fields optional.

Two `reconcile` examples, both generated (a normal run emits no escape) and labelled as such:

- `reconcile.example.json`: an `escaped-side-effect` escape, generated by observing an undeclared effect in a scratch run at `475c0362` and running `commissaire effect reconcile --unit-id`. It carries `issue` and `unit_id`.
- `reconcile-rejected-unit-key.example.json`: a `rejected-unit-key` escape, generated by planting one correctly chained, producer-HMAC'd dual-key record in a scratch run at `475c0362` and running `effect reconcile`. It carries `issue: null`, `unit_id: null` and `seq`.

**Chosen:** ship the second reconcile example. Rationale: `rejected-unit-key` is the one new escape shape v0.2 publishes, and without an example the schema's new branch is never validated against real output.

### The external consumer

`verify-commissaire.mjs` changes:

- Every `commissaire` invocation that names the unit passes `--unit-id` (the no-evidence probe, both `effect authorize` calls, `effect declare`, `effect observe`, `effect reconcile`, `verdict conclude`).
- The no-evidence refusal and the terminal verdict assert `conc.json.unit_id === ISSUE`.
- The run anchor is minted by `commissaire audit anchor --run-dir <run> --unit-id <unit> --dest <root>/.faff/anchors/<run_id>/<unit>`, replacing `faff events anchor --issue`.
- The header comment stops listing the anchor among the `faff` legs.

`faff run-ledger`, `faff effects check` (in the verifier and `replay.sh`) and every other `faff` call keep `--issue`.

## 4. HOW: behaviour

### The driver pin must move

The harness provisions a driver checkout at `EXPECTED` and refuses any other revision at preflight. At `fd1e9788`, `commissaire` has no `--unit-id` flag and `verdict conclude` prints no `unit_id`, so the harness cannot pass `--unit-id` without the pin moving past FAFF-1167.

**Chosen:** move `EXPECTED` (harness test), `EXPECTED_COMMISSAIRE_REVISION` (verifier and scaffolder, kept identical) and the runbook's pinned revision to `475c0362aa2f67f8aef4ad0b13c618fe956bce78`, the FAFF-1167 merge on `main`. The pin stays a fixed SHA on purpose, unlike the drift revision: the harness's exact counts (terminal seq 7, four producer claims, three or four decisions) are a statement about one pinned emission shape (the FAFF-1018 design), and a capture names the revision it ran against. The drift path is what proves a different revision still works by shape. Moving `EXPECTED` again is a deliberate act of the next ticket that needs a newer driver, which the alias-removal follow-on will be.

**Chosen:** replace the hard-coded `DRIFT` SHA with a drift driver the test makes itself: a throwaway detached worktree at `EXPECTED` plus one empty commit (`git commit --allow-empty --no-verify`, with a fixed test author and committer in the environment), whose SHA is read back with `git rev-parse HEAD`. Rationale: the drift-accept test runs the full `ci` flow on the drift driver, so the drift revision must understand `--unit-id`, and `475c0362` is the newest commit on `main`, so no other `main` commit qualifies. The synthetic commit is a different SHA with the same tree, present locally, with `881f4a25` (the FAFF-828 ancestor the preflight requires) as an ancestor, so the drift tests exercise only the revision-mismatch logic. It needs no network and never goes stale when `main` moves. The worktree is removed by the test's existing cleanup. Probe: the three "Revision" subtests pass with this driver at `475c0362`.

**Anti-pattern:** pinning `DRIFT` to a PR head reachable only through `refs/pull/<n>/head`. Why: a PR head can move by force-push, and a pin whose lifetime is "until the next merge" hands the next ticket a chore.

### The anchor floor

Between `fd1e9788` and `475c0362`, FAFF-1155 made `faff events anchor` refuse (`floor-incomplete`, exit 3) unless the run carries `ac-checklist.json` and `review-verdict.json`, and `faff events anchor-run` self-verifies through `governance-check`, whose merge-floor leg needs the same files for a `shipped` outcome. The bare consumer has neither file, by design: no faff build or review ran. FAFF-1015 (Done, PR #919) shipped `commissaire audit anchor`, the Commissaire-native per-issue anchor mint that calls the same `mintIssueAnchor` core without the floor check.

**Chosen:** the harness mints its anchor with `commissaire audit anchor --unit-id`. Rationale: it is the verb FAFF-1015 built for exactly this consumer, it uses the same mint core, so the anchor layout the later steps read (`commissaire/producer/pk.json`, `declared-effects.jsonl`, the seal, export and replay inputs) is unchanged, and it needs no forged build evidence.

**Anti-pattern:** writing a stand-in `ac-checklist.json` or `review-verdict.json` into the demo run so `faff events anchor` passes. Why: the capture would then claim an acceptance check and a code review that never happened, which is the claim discipline the harness README exists to keep.

**Chosen:** rewrite the harness README's FAFF-1015 cited-gap bullet to say the gap is closed: the run anchor is minted by the Commissaire-native `commissaire audit anchor`, so no governance leg depends on the flight-recorder binary. Keep the identifier `FAFF-1015` (the harness test requires it). Retire `"Commissaire-minted anchor"` from the test's forbidden-phrase list, because the claim it blocked is now true, rather than wording around the guard; and add one sentence to the README's "What this run does not claim" list, which the test then requires: the run anchor is a byte-copy of the ledger and run files and attests no acceptance check or code review. Rationale: the old sentence becomes false at the new pin, the README is the template for every capture's claims, and a forbidden-phrase guard must track the truth of the claim, never be dodged by synonym.

**Probe result.** A probe build at `475c0362` with these harness changes (pin, `--unit-id`, `unit_id` assertions, `commissaire audit anchor`, and a same-tree drift revision) ran `test/impure/commissaire-bare-claude.test.mjs` to 47 of 47 passing locally; the synthetic drift driver was then probed separately (3 of 3 "Revision" subtests). With the pin moved and `faff events anchor` kept, the first subtest fails `complete: events anchor failed (exit 3)`. CI runs this file on the Linux `validate` lane only; the macOS lane skips it by name (FAFF-1117), and this ticket does not change that.

### Build order

The examples depend on the harness changes, so the build runs in this order:

1. Harness edits: pin, drift driver, `--unit-id`, `unit_id` assertions, `commissaire audit anchor`, README and runbook text.
2. Run the harness test locally to green.
3. Produce the source run: scaffold a SUT against a driver worktree at `475c0362`, run `prepare`, one Stop firing, `complete`, using the step-1 verifier. Copy its `declared-effects.jsonl` and its custody files (`commissaire/governor/governor.json`, `commissaire/producer/pk.json`, `commissaire/producer/producers/<producer>.json`) out before the SUT is removed. Enumerate every key in each copied custody file and confirm each is either public or one of `sk`, `master_secret`, `key_hex`; stop if any other key appears.
4. Generate the two reconcile examples in scratch runs at `475c0362`.
5. Write the v0.2 schemas from the v0.1 copies and the code constants; carry the examples and the source ledger; redact the three secret fields.
6. Write `records.md`, `keypair.md`, `conformance.md`, the README and the reuse-guide link.
7. Widen the facade test; run it and the full suite.

**Anti-pattern:** writing a schema first and hand-editing an example until it passes. Why: the examples are the evidence that the schema matches the code; the source-ledger check in the test catches a hand-edited example.

### The test

`test/commissaire-facade-spec.test.mjs` grows from one version to two:

```
PAIRS_V01 := today's 11 (schema, example) rows, unchanged          # frozen read shape
PAIRS_V02 := the same 11 kinds under v0.2/, plus the
             reconcile-rejected-unit-key example against reconcile # new records
FOR each row in PAIRS_V01 and PAIRS_V02: example validates against its schema
FOR each author-keyed example in v0.1 and v0.2: exactly the author's authenticator

FROZEN := every line of test/fixtures/commissaire/secret-free-replay/declared-effects.jsonl
FOR each record in FROZEN:
  validates against v0.1 facade-envelope and its kind's v0.1 schema
  fails v0.2 facade-envelope                                       # issue-keyed

FOR each v0.2 record example (the envelope example and the five record-kind examples):
  fails v0.1 facade-envelope                                       # unit_id-keyed
  with issue added (dual-key): fails v0.2 envelope, its v0.2 kind schema and v0.1 envelope

FOR each v0.1 record example:
  with unit_id added (dual-key): fails v0.1 envelope and its v0.1 kind schema

SOURCE := every line of v0.2/schema/examples/source-run.declared-effects.jsonl
FOR each line in SOURCE: passes the v0.2 envelope and its kind's v0.2 schema; fails the v0.1 envelope
FOR each v0.2 record example: deep-equals the SOURCE line with the same seq

FOR each v0.2 reconcile example, FOR each escape:
  issue and unit_id are each a non-empty string or null, and issue === unit_id

v0.1 immutability: sha256 over the sorted (relative path, file bytes) list of
  verification/commissaire-facade/v0.1/** equals a pinned digest in the test
```

The test implements `route_record` from `records.md` as one helper (`schemaVersionFor(record)` returning `"not-facade"`, `"v0.1"`, `"v0.2"`, `"rejected"` or `"unresolvable"`) and routes every record it validates through it, so the documented reader contract has an executable twin. It asserts all five outcomes: a `schema:2` row → `not-facade`, and `issue` only → `v0.1`, `unit_id` only → `v0.2`, both → `rejected`, and neither / a numeric `unit_id` / an empty string → `unresolvable`; and that `rejected` records and `unresolvable` records with no unit key or a non-string unit fail both envelopes. An empty-string unit passes the v0.2 envelope (the subset validator has no `minLength`), so `route_record` is the only guard for that case, and `records.md` says so.

**Chosen:** pin a digest of the v0.1 tree in the test. Rationale: "v0.1 is unchanged" is an acceptance criterion and a standing policy; a digest makes any later edit a visible test failure instead of a review-time catch.

### README and docs

- `verification/commissaire-facade/README.md`: the version table lists v0.2 as the current version and v0.1 as frozen, the historical read shape for `issue`-keyed records; the layout block shows `v0.2/`; the example-sourcing section names the v0.2 source run; the changelog gains a dated v0.2 entry (FAFF-1175) stating the rename, the new reason, the new escape signal and the reconcile `unit_id` field.
- `docs/guide/commissaire-reuse.md`: its facade links point at `v0.2/`, with one sentence that v0.1 is the read shape for frozen records.

### Failure modes

- **A v0.2 schema drifts from live output.** How you'd know: a carried example fails its schema in CI. What it means: fix the schema, never the example.
- **The synthetic drift commit cannot be made** (no git identity, a hook, a read-only object store). How you'd know: the drift tests throw `drift commit failed` before any harness phase runs. What it means: fix the test environment; the commit sets its own identity and passes `--no-verify`, so this should not occur in CI.
- **A later faff change breaks the harness again at the new pin.** Not possible from this PR alone: the driver is pinned, so later `main` changes reach the harness only when a later ticket moves the pin.

## 5. Scenarios

```
Given the v0.2 schemas and the examples carried from the harness run at 475c0362
When test/commissaire-facade-spec.test.mjs runs
Then every v0.2 example validates against its v0.2 schema,
     and every v0.2 record example carries unit_id and fails the v0.1 envelope
```

```
Given the four frozen issue-keyed records in test/fixtures/commissaire/secret-free-replay
When each is validated
Then each passes its v0.1 kind schema and the v0.1 envelope, and fails the v0.2 envelope
```

```
Given any v0.2 record example with issue added beside unit_id
When it is validated against the v0.2 and v0.1 envelopes
Then both reject it, and schemaVersionFor returns "rejected"
```

```
Given a scaffolded SUT and a driver checkout at 475c0362
When `verify-commissaire.mjs ci` runs
Then it exits 0 with counts_pinned true, the conclude output carries unit_id "DEMO-1",
     and the anchor at .faff/anchors/<run_id>/DEMO-1 carries commissaire/producer/pk.json
```

```
Given a drift driver made by the test (a worktree at 475c0362 plus one empty commit) and ALLOW_REVISION_DRIFT=1
When `verify-commissaire.mjs ci` runs
Then it exits 0 with counts_pinned false
```

## 6. Design decision rationale

**A full v0.2 copy or a delta?** A delta is smaller but splits one citable reference across two directories. **Chosen:** a full copy (section 3).

**Which run sources the examples?** A faff graft run (the v0.1 source type) or the FAFF-360 harness run at the new pin. **Chosen:** the harness run (section 3).

**Ship a `rejected-unit-key` example?** Prose only, or a generated example. **Chosen:** a generated, labelled example (section 3).

**How does the harness anchor at the new pin?** Keep `faff events anchor` and supply its floor files; switch to `faff events anchor-run`; switch to `commissaire audit anchor`. The first forges evidence, the second fails the same floor through its self-verify. **Chosen:** `commissaire audit anchor` (section 4).

**Which drift revision?** A pre-FAFF-1167 `main` commit (fails the drift-accept `ci` run on `--unit-id`), a later `main` commit (none exists yet), the PR #1003 head (same tree, but reachable only through a pull ref that a force-push can move; round-1 review), or a commit the test makes on top of `EXPECTED`. **Chosen:** the test-made commit (section 4).

**Ship the source ledger?** Attestation only (the v0.1 precedent) or a checkable source file. **Chosen:** ship it (section 3).

**Type the reconcile unit fields?** **Chosen:** untyped, prose-stated (section 3).

**Keep `issue` on the reconcile escape?** **Chosen:** yes for v0.2, removed in v0.3 with the alias (section 3).

**Guard v0.1 immutability in CI?** **Chosen:** a pinned digest (section 4).

## 7. Open questions and assumptions

**Open questions.** None. The ticket's two open questions are answered by its stated defaults: alias removal is out of scope (section 2), and the examples come from a governed run at `475c0362` (section 3).

**Assumptions.** None blocking. FAFF-1167 is merged on `main` at `475c0362`, and FAFF-1015's `commissaire audit anchor` is on `main` (both checked).

## 8. DONE: definition of done

### From WHY
- [ ] `git diff origin/main -- verification/commissaire-facade/v0.1/` is empty, and the test's v0.1 digest pin passes.

### From WHAT (v0.2 directory)
- [ ] `verification/commissaire-facade/v0.2/` holds `records.md`, `keypair.md`, `conformance.md`, the 11 schemas with `$id: faff/commissaire-facade/v0.2/<name>`, and an example for each, plus `reconcile-rejected-unit-key.example.json`.
- [ ] Every v0.2 record schema requires `unit_id`, has no `issue` property, keeps `additionalProperties: false`, and leaves `step` unchanged.
- [ ] The v0.2 verdict reason enum equals the reason set `evaluateDecisionRequest` can return at `475c0362`, including `invalid-unit-key`; the `kind_of_entry` and effect-kind enums equal `KIND_AUTHOR` and `EFFECT_KINDS`.
- [ ] The v0.2 reconcile schema requires `signal`, `issue`, `unit_id`, `step`, `escaped`, `event_seq`, allows `seq`, and enumerates `escaped-side-effect` and `rejected-unit-key`.
- [ ] `v0.2/records.md` carries the "Reading v0.1 and v0.2 records" section: the `route_record` procedure, its five-outcome table, the route-before-validate rule, the never-relax rule, and the statements listed in section 3, including that a record carrying both keys is rejected.
- [ ] `v0.2/records.md` states the reconcile string-or-null rule for `issue` and `unit_id`, and names `DEMO-1` and `bare-claude` as demonstration identifiers.
- [ ] The admission example carries `unit_id: "-"` and passes the v0.2 admission schema and envelope.
- [ ] Every v0.2 record and keypair example is byte-carried from one harness run at `475c0362` with only `sk`, `master_secret` and `key_hex` redacted; the README and `records.md` name the source run and driver revision; both reconcile examples are labelled as generated.
- [ ] `v0.2/schema/examples/source-run.declared-effects.jsonl` holds that run's eight-record ledger, unmodified.
- [ ] `v0.2/conformance.md` states its version binding as v0.2 and its `audit verify` counts match the source run.

### From HOW (test)
- [ ] `test/commissaire-facade-spec.test.mjs` validates every v0.1 example against v0.1 and every v0.2 example against v0.2, and checks the author-keyed authenticator in both versions.
- [ ] The frozen fixture records pass v0.1 and fail the v0.2 envelope; every v0.2 record example fails the v0.1 envelope; dual-key variants fail both envelopes; `schemaVersionFor` returns `not-facade`, `v0.1`, `v0.2`, `rejected` and `unresolvable` for the five cases, and every validation in the test is routed through it.
- [ ] Every source-ledger line passes v0.2 and fails the v0.1 envelope, and every v0.2 record example deep-equals its source-ledger line.
- [ ] Every reconcile example escape has `issue` and `unit_id` each a non-empty string or `null`, and equal.

### From HOW (external consumer)
- [ ] `verify-commissaire.mjs` passes `--unit-id` on every `commissaire` call that names the unit and asserts `unit_id` on both conclude outputs; no `commissaire` call passes `--issue`.
- [ ] The anchor step calls `commissaire audit anchor --unit-id`; no `faff events anchor` call remains in the verifier.
- [ ] `EXPECTED`, `EXPECTED_COMMISSAIRE_REVISION` (verifier and scaffolder) and the runbook name `475c0362aa2f67f8aef4ad0b13c618fe956bce78`.
- [ ] No hard-coded `DRIFT` SHA remains; both drift subtests use a driver the test makes from a worktree at `EXPECTED` plus one empty commit, and the worktree is cleaned up.
- [ ] The harness README's FAFF-1015 bullet says the anchor is minted by `commissaire audit anchor`; its "What this run does not claim" list says the anchor attests no acceptance check or code review; the test retires `"Commissaire-minted anchor"` from its forbidden list and requires the new caveat; the README passes both phrase checks.
- [ ] `node --test test/impure/commissaire-bare-claude.test.mjs` passes locally (all subtests) and on the Linux `validate` CI lane (the macOS lane skips it by name, unchanged).

### From HOW (README and docs)
- [ ] The facade README lists v0.2 as current and v0.1 as frozen, shows the v0.2 layout, names the v0.2 example source, and has a dated v0.2 changelog entry.
- [ ] `docs/guide/commissaire-reuse.md` links v0.2 and says v0.1 is the read shape for frozen records.

### Build and CI
- [ ] The full `npm test` suite passes, and the PR's CI is green.
- [ ] No file under `plugin/`, `test/fixtures/` or `verification/commissaire-facade/v0.1/` is modified.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed, so no grader, eval case or seam-registry row is needed.

### Integration smoke test

```
1. Provision a driver worktree at 475c0362; scaffold a SUT against it.
2. Run verify-commissaire.mjs ci; expect exit 0, counts_pinned true, terminal seq 7.
3. Validate the run's declared-effects.jsonl lines against the v0.2 kind schemas; expect all pass.
4. Validate the same lines against the v0.1 envelope; expect all fail.
```

confidence: high
build-tier: complex


## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery (agile delivery lens), issue-critique for FAFF-1175, checked at `origin/main` `475c0362`. Advisory; it does not gate a high-confidence promotion.*

**Right-sized?** One unit, at the upper end of a day. Two pieces of work land together: the v0.2 reference (a mechanical copy-and-rename of eleven schemas, a carried example set, three pages, and a widened test) and the harness move (a pin bump, a flag rename, and an anchor-verb swap the pin bump forces). They always ship together: the human split on 2026-10-05 made this ticket the train's second half, and its acceptance criteria require both. The anchor swap is new scope the ticket did not name, but it is the minimum change that lets the pin move without forging evidence, so it belongs here rather than in a follow-up.

**Workstream fit?** No issues. It closes the FAFF-1167 → FAFF-1175 train inside the "external producer proves the Commissaire protocol" project.

**Deps surfaced?**
- FAFF-1167 (blocker) is Done at `475c0362`.
- FAFF-1015 (Done) supplies `commissaire audit anchor`; the spec now depends on it explicitly.
- FAFF-1030 (the live operator-attested capture) will run at the new pin; the runbook update keeps it consistent. No blocker edge needed.

**Risk profile?** Low. Round 1 removed the one novel dependency (a `DRIFT` pin on a pull-request head) in favour of a test-made drift commit, and stated the build order so the examples cannot be written before the run that sources them. The anchor-floor break was found by a probe before the spec was written, and the probe build passed the full harness, so no de-risking spike is needed.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```
