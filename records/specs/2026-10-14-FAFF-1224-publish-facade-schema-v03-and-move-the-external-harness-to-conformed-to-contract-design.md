# nlspec: FAFF-1224, publish facade schema v0.3 and move the external harness to `conformed_to_contract`

> Spec: faffter-dark-nlspec · 2026-10-14 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1224.

This spec is the buildable artifact for FAFF-1224, the second half of the FAFF-1221 → FAFF-1224 PR train. Its readers are the build agent and the reviewers who gate it. Every codebase claim below was checked against `origin/main` at `10a8ece4` (FAFF-1266, PR #1057). The FAFF-1221 merge commit on `main` is `ec676cfc468de9d7ca140cb0c08ec3b8ef1b196d` (PR #1022). FAFF-1264 (the facade v0.2 envelope names the old kind) is already closed as a duplicate of this ticket and is covered by it.

Revised on 2026-10-14 after spec-review round 1 (`reject-approach` on three minors, no major or blocker) and **not re-reviewed**, per the standing preference to fix named minors and build: the reader rule states `conclusionKindOf`'s return contract and its plain-field expansion; the redaction guard covers the whole facade tree and gains committed negative cases; the v0.3 conformance counts are named; the unchanged-schema comparison ignores prose fields; v0.3 `records.md` restates the empty-string `unit_id` caveat.

## 1. WHY: problem and principles

**The core model.** A signed `schema:3` record's `kind_of_entry` is inside its signature, so a conclusion record keeps the kind name it was written with. FAFF-1221 made the writer emit `conformed_to_contract` and gave every reader one compatibility read (`conclusionKindOf` in `effects.js`) that accepts the new name and the legacy `accepted_under_contract`. The published facade reference still documents only the legacy name, and the one external consumer (the FAFF-360 bare Claude Code harness) still asserts it. This ticket publishes the new name as facade v0.3 beside the frozen v0.1 and v0.2, and moves the harness to the new name.

**Problem.** Since FAFF-1221 merged on 2026-10-08, every new conclusion record carries `conformed_to_contract`, and the v0.2 envelope enum and conclusion schema reject it. A reuser building against the reference today builds against a name Commissaire no longer writes. The harness stays green only because it pins its driver at `475c0362`, which predates FAFF-1221, so it proves nothing about the rename.

**Design principles.**

- **Published versions are immutable.** v0.1 and v0.2 stay byte-identical and remain the read shapes for their frozen records.
- **The code is the source of truth.** v0.3 mirrors what the driver at the pin writes; where a schema and the code disagree, the schema is fixed.
- **Examples come from a real governed run, scrubbed only of secrets.** Carried forward from v0.1 and v0.2.
- **No fabricated governance evidence.** The harness never writes faff build evidence it did not earn (carried from FAFF-1175).

**Reference context.**

| File | Language | Role in this change |
|---|---|---|
| `verification/commissaire-facade/v0.2/` | Markdown + JSON Schema | Frozen; copied as the starting point for v0.3, never edited |
| `verification/commissaire-facade/README.md` | Markdown | Version table, layout, example-sourcing note, changelog |
| `test/commissaire-facade-spec.test.mjs` | JavaScript | The CI drift alarm; `schemaVersionFor` is the executable twin of the reader rule |
| `plugin/skills/faff/contracts/validate-schema.mjs` | JavaScript | Subset validator: `type`, `required`, `properties`, `enum`, `additionalProperties`, `items` |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | `CONCLUSION_KIND`, `LEGACY_CONCLUSION_KIND`, `conclusionKindOf` (lines 211-222), `EFFECT_KINDS` |
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript | `KIND_AUTHOR` (line 118 on `main`; 106 at `ec676cfc`), conclude output (`verdict`, `kind_of_entry`) |
| `plugin/skills/faff/bin/lib/decision-policy.ts` | TypeScript | `evaluateDecisionRequest` on `main` (it lived in `commissaire.ts` at `ec676cfc`); its reason set is unchanged |
| `verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs` | JavaScript | The FAFF-360 consumer: pin (line 25), conclude assertions (399-406), demo-result `terminal_verdict` (453, 866), `driftShapeFindings` (1058-1060) |
| `verification/external-verification/scaffold-commissaire-bare-claude.sh` | Bash | Scaffolds the consumer; pins the same revision (line 22) |
| `verification/external-verification/commissaire-bare-claude/README.md`, `CAPTURE-RUNBOOK.md` | Markdown | Capture README template (line 19 names the kind); runbook pin (lines 13, 20) |
| `test/impure/commissaire-bare-claude.test.mjs` | JavaScript | Harness test: `EXPECTED` (line 22), the fabricated drift record list (line 660) |
| `docs/guide/commissaire-reuse.md` | Markdown | Facade links at v0.2 (lines 147-153) |

**Scope statement.** This change sits at the published facade reference and the external consumer harness. It changes no Commissaire or faff runtime code.

## 2. OUT OF SCOPE

- **Removing the `--issue` alias and the dual `issue` output fields.** Why: the ticket's open question defaults to leaving it for v0.4, as FAFF-1175 planned. Extension point: `COMMISSAIRE_SPEC.flags`, `parseCommissaireArgs`, `normaliseUnitFlag` in `commissaire.ts`, `withUnitId`, and a v0.4 `reconcile.schema.json` without `issue`.
- **Any Commissaire or faff runtime change.** Why: FAFF-1221 owns the code and is merged. Extension point: `commissaire.ts`, `effects.js`.
- **Moving the harness pin past `ec676cfc`.** Why: the ticket names FAFF-1221's merge commit; later commits (FAFF-1225 grant check, FAFF-1177/1179 governor) change no record shape the harness reads (section 4 probe). Extension point: `EXPECTED` and `EXPECTED_COMMISSAIRE_REVISION`, moved by the next ticket that needs a newer driver.
- **The evidence spec's `producer-pk` cross-check** (`test/evidence-v0.3.test.mjs` line 163 reads facade v0.2's `producer-pk.schema.json`; the bundled copy's description names v0.2). Why: v0.2 stays frozen and v0.3's `producer-pk` is structurally identical, so the check stays true; changing the bundled copy's prose touches `plugin/`. Extension point: that test line and `plugin/skills/faff/contracts/evidence-v0.3/schema/producer-pk.schema.json`. Note the name clash: "evidence v0.3" (FAFF-1256, under `plugin/skills/faff/contracts/`) and "facade v0.3" (this ticket, under `verification/`) are separate specs with independent version numbers.
- **Schemas for CLI summary outputs** (`verdict conclude`, `audit anchor`). Why: no facade version schemas them. Extension point: a future `schema/conclude-output.schema.json`.
- **Publishing a new operator-attested capture** (FAFF-1030). Why: no capture is published here; a later capture runs at the new pin.

## 3. WHAT: vocabulary, artifacts and interfaces

| Term | Meaning |
|---|---|
| conclusion record | The signed `schema:3` record `verdict conclude` appends on the clean path |
| current kind | `conformed_to_contract`, written from FAFF-1221 on |
| legacy kind | `accepted_under_contract`, carried by every conclusion written before FAFF-1221 |
| driver pin | The SuperDomestique revision the harness provisions: `EXPECTED` in the harness test, `EXPECTED_COMMISSAIRE_REVISION` in the verifier and scaffolder |

### The v0.3 directory

v0.3 is a complete, self-contained version directory with v0.2's layout:

```
verification/commissaire-facade/v0.3/
  records.md       every record kind, plus "Reading v0.1, v0.2 and v0.3 records"
  keypair.md       custody files (shape unchanged from v0.2)
  conformance.md   posture, audit verify contract, drift note, version binding (v0.3)
  schema/*.schema.json            $id: faff/commissaire-facade/v0.3/<name>
  schema/examples/*.example.json  carried from one harness run at ec676cfc
  schema/examples/source-run.declared-effects.jsonl  that run's whole ledger
```

**Chosen:** a complete copy, not a delta over v0.2. Rationale: FAFF-1175 set this precedent and the README treats each version directory as the whole citable reference.

### Schema changes from v0.2

| Schema | Change in v0.3 |
|---|---|
| `facade-envelope` | `kind_of_entry` enum replaces `accepted_under_contract` with `conformed_to_contract`; nothing else changes |
| `conformed-to-contract` (new file) | Replaces `accepted-under-contract.schema.json`: `kind_of_entry` enum `["conformed_to_contract"]`, `title` and descriptions name the current kind; payload unchanged (`producer_id`, `contract_revision`, `evidence_seq_range`, `escapes_checked`) |
| `admission`, `effect-claim`, `effect-decision-request`, `effect-decision-verdict`, `reconcile`, `effect-descriptor`, `governor-keypair`, `producer-pk`, `producer-admission` | Shape unchanged; only `$id` moves to v0.3 |

The example `conformed-to-contract.example.json` replaces `accepted-under-contract.example.json`. The build agent copies enums from the code at `ec676cfc` (`KIND_AUTHOR`, the `evaluateDecisionRequest` reason set, `EFFECT_KINDS`), never from this table. Probe on 2026-10-14: those three vocabularies are identical at `ec676cfc` and `10a8ece4`, and v0.2's reason enum already equals them.

**Chosen:** the v0.3 kind enums list only `conformed_to_contract`. Rationale: the facade mirrors `KIND_AUTHOR`, the writer vocabulary, which lists only the current kind (FAFF-1221 section 3). A v0.3 enum holding both names would document a record Commissaire no longer writes as current. Legacy conclusions are read through v0.2, by the routing rule below.

**Chosen:** rename the schema and example files to `conformed-to-contract.*`. Rationale: every other file is named after the kind it describes; keeping the legacy filename in the current version would misname it.

### The reader rule (`v0.3/records.md`, section "Reading v0.1, v0.2 and v0.3 records")

`conclusionKindOf(record)` (`effects.js` lines 219-223) returns the record's `kind_of_entry` exactly as stored when it is `conformed_to_contract` or `accepted_under_contract`, and `null` otherwise; it never normalises the legacy name to the current one. So `conclusionKindOf(record) == LEGACY_CONCLUSION_KIND` is the same test as "`record.kind_of_entry` is exactly the string `accepted_under_contract`", and `records.md` writes the rule in that plain-field form so a reuser without faff source can implement it.

v0.1 and v0.2 are told apart by the unit key (FAFF-1175). v0.2 and v0.3 accept the same unit key and differ only in the conclusion kind, so the rule gains one step after key routing. Records of every other kind validate against both v0.2 and v0.3; the rule sends them to v0.3, the current version.

```
PROCEDURE route_record(record) -> not-facade | v0.1 | v0.2 | v0.3 | rejected | unresolvable
  IF record.schema != 3:                                   RETURN not-facade
  hasIssue := record has own property "issue" with a value other than undefined
  hasUnit  := record has own property "unit_id" with a value other than undefined
  IF hasIssue AND hasUnit:                                 RETURN rejected
  key := "unit_id" IF hasUnit ELSE "issue" IF hasIssue ELSE none
  IF key is none OR record[key] is not a non-empty string: RETURN unresolvable
  IF key == "issue":                                       RETURN v0.1
  IF conclusionKindOf(record) == LEGACY_CONCLUSION_KIND:   RETURN v0.2
  RETURN v0.3
```

| `route_record` returns | The record is | A reader |
|---|---|---|
| `v0.1` | a record written before FAFF-1167 (`issue`-keyed) | validates it against v0.1 |
| `v0.2` | a `unit_id`-keyed conclusion written before FAFF-1221, carrying `accepted_under_contract` | validates it against v0.2 and treats it as a conclusion, exactly as `conclusionKindOf` does |
| `v0.3` | any other `unit_id`-keyed record, including every non-conclusion record written between FAFF-1167 and FAFF-1221 | validates it against v0.3 |
| `rejected`, `unresolvable`, `not-facade` | unchanged from v0.2 | unchanged from v0.2 |

`records.md` states plainly:

- Earlier versions carry `accepted_under_contract`; v0.3 carries `conformed_to_contract`. A reader that asks "is this a conclusion?" accepts both, by the rule above, mirroring `conclusionKindOf`, which is the enforcement.
- One ledger may hold conclusions of either name (a run concluded before FAFF-1221 and re-concluded after it is idempotent and appends nothing, so a single unit holds one).
- An `issue`-keyed record carrying `conformed_to_contract` is never written (the writer moved to `unit_id` before the rename). It routes to v0.1 and fails it.
- `verdict conclude` output: `verdict` is always `conformed_to_contract` on success; `kind_of_entry` reports the stored kind, so it reads `accepted_under_contract` on a legacy record. This is CLI output, described in prose, not schema'd.
- The meaning of the kind is stated once, in the glossary; the conclusion section links `docs/reference/GLOSSARY.md` and does not restate it (FAFF-1221's one-home rule).
- An empty-string `unit_id` passes the v0.3 envelope (the subset validator has no `minLength`), so `route_record` is the only guard for it; v0.3 restates this caveat itself rather than pointing at v0.2, because each version is self-contained.
- A reader must never validate a mixed ledger against a single version, and must never widen an enum or relax `additionalProperties` to make one pass (carried from v0.2).
- The "mirror the code" citations point at where each constant lives on `main` at build time: `evaluateDecisionRequest` is now in `bin/lib/decision-policy.js`, not `commissaire.js` as v0.2 says (v0.2 stays as written).

**Chosen:** route a legacy-kind `unit_id` record to v0.2 rather than widen v0.3's enum. Rationale: it keeps each version a description of what one writer wrote, matches the FAFF-1175 key-routing precedent, and the routing twin in the test proves both names are read.

### Example sourcing

The record and keypair examples come from one governed run of the harness against a driver checkout at `ec676cfc`, the new pin. That run writes the same eight records as v0.2's source run: `admission` (seq 0, `unit_id: "-"`), a denied request/verdict pair (`effect-not-declared`), `declare`, a granted pair (`all-legs-pass`), `observe`, and `conformed_to_contract` (seq 7). Each example is the byte-for-byte record or custody file from that run, with `sk`, `master_secret` and `key_hex` replaced by the same `<REDACTED — ...>` placeholders v0.2 uses. The whole ledger ships as `source-run.declared-effects.jsonl`. Both `reconcile` examples are regenerated at `ec676cfc` as v0.2 generated them (a forced `escaped-side-effect`; a planted dual-key record for `rejected-unit-key`) and labelled as generated.

`records.md` and the README name the source run id, the driver revision, the redactions, and the demonstration identifiers `DEMO-1` and `bare-claude`. The conclusion section also states that `ec676cfc` predates FAFF-1225, which made `verdict conclude` refuse unless every observed protected effect was granted; the record shape did not change, and the source run's one observed effect (seq 6) was granted at seq 5, so the example meets the later rule too.

**Chosen:** source from the harness run at the pin, ship the source ledger. Rationale: the FAFF-1175 precedent; the test then checks the byte-carry instead of trusting it.

**Chosen:** the redaction is guarded three ways. Rationale: the ticket's acceptance criterion and the FAFF-1221 round-1 infosec finding; a hand-carry that forgets one field is a key leak in a public repo.

- **CI, field rule.** For every keypair example in every published version (v0.1, v0.2, v0.3), each of `sk`, `master_secret` and `key_hex` that is present is a string starting `<REDACTED`. Each keypair example already validates against a schema with `additionalProperties: false`, so a secret cannot ride in under a new field name.
- **CI, tree scan.** No file anywhere under `verification/commissaire-facade/` (every version, prose pages and ledgers included) contains the text `PRIVATE KEY`.
- **CI, negative cases.** The test applies the same check function to in-memory copies of each v0.3 keypair example with one secret field replaced by a 64-character hex string, and asserts the check fails for each; the mutations are never written to disk.
- **Build time, exact values.** After the examples are written (build order step 6), the build agent greps the whole working tree (`git grep -F`) for each real `sk`, `master_secret` and `key_hex` value captured from the source run's custody files in step 4, expects no match, and records "no match" for each in the PR body. CI cannot repeat this check, because the real values are never committed.

### The external consumer

| Change | Where |
|---|---|
| Pin moves to `ec676cfc468de9d7ca140cb0c08ec3b8ef1b196d` | `EXPECTED` (harness test), `EXPECTED_COMMISSAIRE_REVISION` (verifier and scaffolder, kept identical), runbook lines 13 and 20 |
| One constant `CONCLUSION_KIND = "conformed_to_contract"` in the verifier; every conclusion check uses it | step 10 (`conc.json.verdict`, the last record's `kind_of_entry`), the two demo-result `terminal_verdict.verdict` values, `driftShapeFindings` and its finding strings (`not-exactly-one-conformed_to_contract`, `conformed_to_contract-not-last`) |
| Step 10 also asserts `conc.json.kind_of_entry === CONCLUSION_KIND` | the FAFF-1221 output field; a fresh conclude prints the current kind |
| The step 10 comment and die message name the current kind | `verify-commissaire.mjs` 399-402 |
| The fabricated drift record list names the current kind | `test/impure/commissaire-bare-claude.test.mjs` line 660 |
| The capture README template names `conformed_to_contract` | harness `README.md` line 19 |

**Chosen:** the harness asserts the current name only, through one local constant. Rationale: it pins a driver that writes only the current name, and an external consumer must not import faff internals (`conclusionKindOf`) to pass; the drift driver is `EXPECTED` plus an empty commit, so it writes the same name.

## 4. HOW: behaviour

### First step: check the current harness against today's `origin/main`

Before any edit, the build runs the unmodified harness against a driver at the then-current `origin/main` with `ALLOW_REVISION_DRIFT=1`, and records the result in the PR body:

```
PROCEDURE check_main_before_pin()
  1. sha := git rev-parse origin/main; add a detached worktree D at sha
  2. scaffold a SUT against D; run verify-commissaire.mjs ci with COMMISSAIRE_ROOT=D,
     COMMISSAIRE_REVISION=sha, ALLOW_REVISION_DRIFT=1
  3. EXPECT exit 1 at step 10 only ("verdict conclude did not accept_under_contract"):
     every earlier phase passes, and conclude printed verdict "conformed_to_contract"
  4. Re-run with only the kind name changed in the scaffolded verifier; EXPECT exit 0
  5. IF step 3 fails earlier than step 10, or step 4 fails: stop and report; a later
     main commit broke the consumer, which is a new finding, not this ticket's fix
```

**Probe result (2026-10-14, prep).** At `origin/main` `10a8ece4`, step 3 failed exactly at step 10, and step 4 passed (`counts_pinned: false`). The same pair at `ec676cfc` gave the same result. The ledgers from both runs carry identical record kinds, authors, envelope keys and payload keys, and identical custody-file keys. A scratch worktree with the pin moved to `ec676cfc` and the kind renamed in the verifier, harness test and README ran `node --test test/impure/commissaire-bare-claude.test.mjs` to 47 of 47 passing, including the three drift subtests.

### The test

`test/commissaire-facade-spec.test.mjs` grows from two versions to three:

```
PAIRS := every v0.1 and v0.2 pair, unchanged
       + the 11 v0.3 (schema, example) pairs, with conformed-to-contract in place of accepted-under-contract
       + v0.2 and v0.3 reconcile-rejected-unit-key examples against their reconcile schemas
AUTH_KEYED: checked for v0.1, v0.2 (accepted-under-contract) and v0.3 (conformed-to-contract)

schemaVersionFor(record) implements route_record, importing conclusionKindOf and
  LEGACY_CONCLUSION_KIND from plugin/skills/faff/bin/lib/effects.js (no second literal)
It returns all six outcomes; cases: schema 2 -> not-facade; issue -> v0.1;
  unit_id + any non-conclusion kind -> v0.3; unit_id + conformed_to_contract -> v0.3;
  unit_id + accepted_under_contract -> v0.2; issue + conformed_to_contract -> v0.1;
  dual key -> rejected; none / numeric / empty -> unresolvable

FROZEN fixture: routes to v0.1, passes v0.1, fails the v0.2 and v0.3 envelopes   (unchanged intent)
v0.2 SOURCE ledger: seq 0-6 route to v0.3 and pass v0.3 and v0.2;
                    seq 7 routes to v0.2, passes v0.2, fails the v0.3 envelope and conformed-to-contract schema
v0.3 SOURCE ledger: 8 lines; each routes to v0.3 and passes it; seq 7 is conformed_to_contract
                    and fails the v0.2 envelope; seq 0 has unit_id "-"
Each v0.3 record example deep-equals the v0.3 SOURCE line with the same seq
Dual-key variants of each v0.3 record example: rejected, fail the v0.3 envelope and kind schema
Each v0.3 reconcile escape: issue and unit_id each a non-empty string or null, and equal
Unchanged v0.3 schemas equal their v0.2 twins structurally (type, required, properties,
  enum, additionalProperties, items; $id, title and description ignored)
Redaction: the field rule over v0.1, v0.2 and v0.3; the PRIVATE KEY scan over the whole facade tree;
  the in-memory negative cases over each v0.3 keypair example
Immutability: v0.1 digest unchanged; a new pinned V02_TREE_DIGEST for verification/commissaire-facade/v0.2/**
```

**Chosen:** pin a digest of the v0.2 tree, as FAFF-1175 did for v0.1. Rationale: v0.2 becomes frozen in this ticket, and "v0.2 still validates the frozen records" is an acceptance criterion; a digest makes any edit a test failure.

**Chosen:** the routing twin imports `conclusionKindOf` from `effects.js`. Rationale: the documented rule says it mirrors that function; importing it makes the test fail if the two diverge, and adds no second copy of the legacy literal.

### Build order

1. `check_main_before_pin` (above); keep its output for the PR body.
2. Harness edits: pin, `CONCLUSION_KIND` constant and assertions, drift strings, harness test line 660, README and runbook.
3. Run `node --test test/impure/commissaire-bare-claude.test.mjs` locally to green.
4. Produce the source run: scaffold a SUT against a driver worktree at `ec676cfc`, run `prepare`, one Stop firing, `complete`, with the step-2 verifier. Copy out `declared-effects.jsonl` and the three custody files before the SUT is removed. Enumerate every key in each custody file; stop if any key other than the public fields and `sk`, `master_secret`, `key_hex` appears. Keep the real secret values in memory only, for the exact-value grep after step 6.
5. Generate the two reconcile examples in scratch runs at `ec676cfc`.
6. Copy v0.2 to v0.3; rename the conclusion schema and example; edit the envelope enum and every `$id`; carry the examples and source ledger; redact.
7. Write `records.md`, `keypair.md`, `conformance.md` (its `audit verify` counts from the step-4 run; expected, as for v0.2: `result: pass`, 4 producer claims `unverifiable_without_secret` and 4 commissaire decisions verified from `pk.json` alone, 4 producer claims verified with the governor master present), the README and the reuse-guide links.
8. Widen the facade test; run it and the full suite.

**Anti-pattern:** writing a schema first and hand-editing an example until it passes. Why: the examples are the evidence that the schema matches the code; the source-ledger check catches a hand-edited example.

**Anti-pattern:** editing anything under `v0.1/` or `v0.2/` to "keep the versions consistent". Why: published versions are immutable, and both digest pins fail.

### README and docs

- `verification/commissaire-facade/README.md`: v0.3 current; v0.2 frozen (the read shape for `unit_id`-keyed legacy conclusions); v0.1 frozen; layout shows `v0.3/`; example-sourcing names the v0.3 source run; a dated v0.3 changelog entry (FAFF-1224) states the rename, the routing rule and the file rename.
- `docs/guide/commissaire-reuse.md` lines 147-153: links point at `v0.3/`, with one sentence that v0.2 and v0.1 stay published as read shapes for records written before FAFF-1221 and FAFF-1167.

### Failure modes

- **A later `main` commit breaks the consumer before the pin moves.** How you'd know: `check_main_before_pin` fails before step 10. What it means: stop and file it; this ticket still pins `ec676cfc`, which the probe shows passes.
- **A v0.3 schema drifts from live output.** How you'd know: a carried example fails its schema in CI. What it means: fix the schema, never the example.

## 5. Scenarios

```
Given the v0.2 source ledger (seq 7 a signed accepted_under_contract conclusion)
When each record is routed by schemaVersionFor and validated against its routed version
Then seq 0-6 route to v0.3 and pass it, seq 7 routes to v0.2 and passes it,
     and seq 7 fails the v0.3 envelope
```

```
Given the v0.3 examples carried from the harness run at ec676cfc
When test/commissaire-facade-spec.test.mjs runs
Then every v0.3 example validates against its v0.3 schema, the conclusion example carries
     conformed_to_contract and fails the v0.2 envelope, and every keypair secret is a <REDACTED placeholder
```

```
Given a scaffolded SUT and a driver checkout at ec676cfc
When `verify-commissaire.mjs ci` runs
Then it exits 0 with counts_pinned true, terminal seq 7, and conclude printed verdict and
     kind_of_entry "conformed_to_contract"
```

## 6. Design decision rationale

**A full v0.3 copy or a delta?** **Chosen:** a full copy (section 3).

**Does v0.3 accept both kind names?** Widen the enum, or route legacy conclusions to v0.2. **Chosen:** route to v0.2 (section 3).

**Rename the conclusion schema file?** **Chosen:** yes, `conformed-to-contract.*` (section 3).

**Which pin?** `ec676cfc` (the ticket's named commit) or the then-current `main` (newer governor and grant-check code, same record shapes). **Chosen:** `ec676cfc`. Rationale: the ticket names it, the harness's exact counts describe one pinned emission shape, and the first build step proves current `main` still passes by shape; moving further is the next ticket's deliberate act.

**Which run sources the examples?** **Chosen:** the harness run at the pin (section 3).

**How is redaction guarded?** **Chosen:** a test over every version's keypair examples plus a private-key pattern scan of v0.3 (section 3).

**How does the harness name the kind?** **Chosen:** one local constant, current name only (section 3).

**Guard v0.2 immutability?** **Chosen:** a pinned digest (section 4).

**How does the routing twin read the conclusion kind?** **Chosen:** import `conclusionKindOf` (section 4).

**Drop the `--issue` alias now?** **Chosen:** no; v0.4, per the ticket's default (section 2).

## 7. Open questions and assumptions

**Open questions.** None. The ticket's open question is answered by its stated default (section 2).

**Assumptions.** None blocking. FAFF-1221 is merged at `ec676cfc` (checked) and FAFF-1264 is closed as a duplicate of this ticket (checked).

## 8. DONE: definition of done

### From WHY
- [ ] `git diff origin/main -- verification/commissaire-facade/v0.1/ verification/commissaire-facade/v0.2/` is empty, and both digest pins pass.

### From WHAT (v0.3 directory)
- [ ] `verification/commissaire-facade/v0.3/` holds `records.md`, `keypair.md`, `conformance.md`, 11 schemas with `$id: faff/commissaire-facade/v0.3/<name>` (including `conformed-to-contract.schema.json`, and no `accepted-under-contract.schema.json`), an example for each, `reconcile-rejected-unit-key.example.json`, and `source-run.declared-effects.jsonl`.
- [ ] The v0.3 envelope `kind_of_entry` enum equals the `KIND_AUTHOR` keys at `ec676cfc` and contains `conformed_to_contract` and not `accepted_under_contract`; `conformed-to-contract.schema.json` enumerates only `conformed_to_contract`.
- [ ] Every other v0.3 schema equals its v0.2 twin structurally, ignoring `$id`, `title` and `description`.
- [ ] `v0.3/records.md` carries "Reading v0.1, v0.2 and v0.3 records": the six-outcome `route_record`, its table, the statement that earlier versions carry `accepted_under_contract` and v0.3 carries `conformed_to_contract`, the `verdict`/`kind_of_entry` output note, and the never-widen rule.
- [ ] The v0.3 conclusion section links `docs/reference/GLOSSARY.md` for the meaning, and `git grep -n -F "with no escapes" -- verification/commissaire-facade/v0.3/` prints nothing.
- [ ] `records.md` and the README name the v0.3 source run, the driver revision `ec676cfc`, the redactions, the demonstration identifiers and the FAFF-1225 note; both reconcile examples are labelled generated.
- [ ] Every v0.3 record and keypair example is byte-carried from that run with only `sk`, `master_secret` and `key_hex` redacted, and the source ledger holds its eight records unmodified.
- [ ] `v0.3/conformance.md` states its version binding as v0.3 and its `audit verify` counts match the source run: `result: pass`, 4 producer claims `unverifiable_without_secret` and 4 commissaire decisions verified from `pk.json` alone (a different count is a finding to explain in the PR body, not a number to edit).
- [ ] `v0.3/records.md` writes the legacy-kind routing step in plain-field form (`kind_of_entry` is exactly `accepted_under_contract`) and restates the empty-string `unit_id` caveat.

### From HOW (test)
- [ ] `schemaVersionFor` imports `conclusionKindOf` from `effects.js` and returns each of the six outcomes for the cases in section 4; every validation in the file is routed through it.
- [ ] The v0.2 source ledger routes seq 0-6 to v0.3 and seq 7 to v0.2, and each passes its routed version; seq 7 fails the v0.3 envelope.
- [ ] The v0.3 source ledger routes and validates to v0.3; each v0.3 record example deep-equals its line; v0.3 dual-key variants are rejected and fail.
- [ ] The redaction field rule passes over every keypair example in v0.1, v0.2 and v0.3; no file under `verification/commissaire-facade/` contains `PRIVATE KEY`; and the committed in-memory negative cases (one per secret field in each v0.3 keypair example) each make the check fail.
- [ ] The PR body records the exact-value `git grep -F` for each real secret from the source run, each with no match.
- [ ] v0.3 reconcile escapes satisfy the string-or-null rule.

### From HOW (external consumer)
- [ ] The PR body holds the `check_main_before_pin` output (the `origin/main` SHA, the step-10 failure, the renamed re-run passing).
- [ ] `EXPECTED`, both `EXPECTED_COMMISSAIRE_REVISION` values and the runbook name `ec676cfc468de9d7ca140cb0c08ec3b8ef1b196d`, a commit on `main`.
- [ ] `git grep -n accepted_under_contract -- verification/external-verification/ test/impure/commissaire-bare-claude.test.mjs` prints nothing; the verifier compares conclusion kinds only through `CONCLUSION_KIND`, and step 10 asserts both `verdict` and `kind_of_entry`.
- [ ] `node --test test/impure/commissaire-bare-claude.test.mjs` passes locally (all subtests) and on the Linux `validate` CI lane.

### From HOW (README and docs)
- [ ] The facade README lists v0.3 as current and v0.2 and v0.1 as frozen, shows the v0.3 layout, names the v0.3 example source, and has a dated v0.3 changelog entry.
- [ ] `docs/guide/commissaire-reuse.md` links v0.3 and says v0.2 and v0.1 stay published as read shapes.

### Build and CI
- [ ] The full `npm test` suite passes and the PR's `dco`, `validate` and `governance` checks are green.
- [ ] No file under `plugin/`, `test/fixtures/`, `verification/commissaire-facade/v0.1/` or `verification/commissaire-facade/v0.2/` is modified.
- [ ] Every commit carries `Signed-off-by`.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed, so no grader, eval case or seam-registry row is needed.

### Integration smoke test

```
1. Provision a driver worktree at ec676cfc; scaffold a SUT against it.
2. Run verify-commissaire.mjs ci; expect exit 0, counts_pinned true, terminal seq 7, kind conformed_to_contract.
3. Validate the run's declared-effects.jsonl lines against the v0.3 kind schemas; expect all pass.
4. Validate seq 7 against the v0.2 envelope; expect it fails.
```

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery (agile delivery lens), issue-critique for FAFF-1224, checked at `origin/main` `10a8ece4` on 2026-10-14. Advisory; it does not gate a high-confidence promotion.*

**Right-sized?** One unit of about a day, matching the `Size: S` label at its upper edge. Two pieces ship together: the v0.3 reference (a copy-and-rename of eleven schemas, re-carried examples, three pages, a widened test) and the harness move (a pin bump and one renamed constant). The human split on FAFF-1221 made them the train's second half, and the acceptance criteria require both, so they stay together.

**Workstream fit?** No issues. It closes the FAFF-1221 to FAFF-1224 train inside "Governed execution is compared with a strong one-shot control". It also unblocks FAFF-1260 (closed per-kind payload schemas), which needs the published facade and the code to agree on record-kind names.

**Deps surfaced?**
- FAFF-1221 (blocker) is Done at `ec676cfc`.
- FAFF-1264 is already closed as a duplicate of this ticket, so its concern (the v0.2 envelope names the old kind) is in scope here.
- FAFF-1221's build order promised a post-merge comment on FAFF-1224 naming the merge SHA; no such comment exists. The SHA is recoverable from `main` (`ec676cfc`, PR #1022) and the spec names it, so nothing is lost, but the graft step that should have posted it did not.
- FAFF-1225 (Done) changed what `verdict conclude` checks without changing the record shape; the spec notes it rather than depending on it.

**Risk profile?** Low. Prep ran the de-risking check the ticket asks for: the unmodified harness against `origin/main` fails only at the conclude-name assertion, and with the pin at `ec676cfc` and the name changed the full harness test passed 47 of 47. No spike is needed.

confidence: high
build-tier: complex
spec-review: accept (human preference, L2; round-1 minors fixed, not re-reviewed)

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"}]}
```
