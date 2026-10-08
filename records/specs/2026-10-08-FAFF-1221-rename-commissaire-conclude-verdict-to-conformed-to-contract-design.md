# nlspec: FAFF-1221, rename Commissaire's conclude record kind to `conformed_to_contract`

> Spec: faffter-dark-nlspec · 2026-10-08 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1221.

This spec is the buildable artifact for FAFF-1221, the first half of the FAFF-1221 → FAFF-1224 PR train. Its readers are the build agent and the reviewers who gate it. Every codebase claim below was checked against `origin/main` at `d5984970` (the ADR 0135 merge for FAFF-1109); line numbers refer to that revision. `d5984970` changed no code after `774b7ae7`, so probes run on 2026-10-08 against the committed emit still apply.

Revised on 2026-10-08 after spec-review round 1 (`reject-approach`, 13 objections) and the human decisions in Linear comment 31e5e20f. Changes: the scope narrows to the runtime rename, its tests and the docs; facade schema v0.3 and the FAFF-360 external harness move to FAFF-1224, which pins the harness to this ticket's merge commit on `main`; the plain-English meaning drops "granted"; the no-legacy-literal, explain-once and no-other-reader checks become exact commands; the follow-ups get owners.

Revised again on 2026-10-08 after spec-review round 2 (`revise`, 6 objections, down from 13): the no-other-reader claim is proven by enumerating every runtime comparison on `kind_of_entry`; the placement of the compatibility read is argued; "explained once" is stated as a deliberate string-level rule; the operator checks are tied to an attended build with a merge hold if a lane cannot reach them; the FAFF-1221 description and FAFF-1225 now carry the scope note and the pinned-string dependency.

Updated on 2026-10-08 per the human decision in comment 493680c3 (apply the four round-3 fixes and build, with no further spec-review round): re-conclude counts only an authenticated Commissaire conclusion; the spec states which output field answers which question; the inventory excludes all committed `.faff/` bookkeeping; and the FAFF-1221 and FAFF-1177 descriptions were edited.

## 1. WHY: problem and principles

**The core model.** A signed ledger record's `kind_of_entry` is inside its signature, so a record already written keeps its kind name forever. The rename therefore has two halves that never mix: the writer emits the new name `conformed_to_contract` from now on, and every reader that asks "is this record a conclusion?" asks through one compatibility read that accepts the new name and the legacy name `accepted_under_contract`. FAFF-1167 made the same split for the `issue` → `unit_id` key, with `unitIdOf` in `effects.js` as the one read.

**Problem.** `commissaire verdict conclude` appends a signed record with `kind_of_entry: "accepted_under_contract"`. The name reads as though a person accepted the work, but no person and no quality judgement is involved. This change renames the kind, keeps every already-written record verifiable, and explains the new term once, in plain English, in the CLI and in the docs.

**Settled decisions.**

- Comment 1cb8267c (2026-10-08): the new name is `conformed_to_contract`; the `accept…` family renames together; records already written keep the old name and still verify through one compatibility read; land before FAFF-1177.
- Comment 31e5e20f (2026-10-08), decision 1: two PRs, following FAFF-1167 → FAFF-1175. FAFF-1221 keeps the runtime rename (`commissaire.ts` and its emit, the `effects.js` compatibility read, tests, the glossary and docs). FAFF-1224 publishes facade v0.3 and moves the external harness, pinned to FAFF-1221's merge commit on `main`, never a PR-branch commit.
- Comment 31e5e20f, decision 2: the plain-English meaning is "every protected effect it observed was declared, with no escapes". `verdict conclude` does not check grants today. FAFF-1225 makes it check grants and restores "granted" once it lands.

**Design principles.**

- **Frozen records are never rewritten.** Ledgers, sealed bundles, committed anchors, the facade reference, ADRs (including ADR 0135), specs and RFC documents keep the old name.
- **One compatibility read.** No runtime code other than the compatibility read names the legacy kind.
- **The writer vocabulary is current only.** `KIND_AUTHOR` lists what Commissaire writes today.
- **Plain words match the checks.** The explanation states only what `verdict conclude` checks.

**Reference context.**

| File | Language | Role in this change |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` (+ committed `commissaire.js`, `build-manifest.json`) | TypeScript | The writer and the one runtime reader: `require("./effects")` destructure (line 74), `KIND_AUTHOR` (106-114), the `verdict conclude` usage line (565), `cmdTerminalVerdict` (847-912: comments 845 and 855, idempotency check 856-857, record body 903, output 910), `verifyAuthLeg` (371-405) |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | The FAFF-1167 compatibility read (block header 93, `unitIdOf` 110, `matchesUnit` 119), `computeEscapes` (127-150), selftest cases (817-830), `module.exports` (876) |
| `test/commissaire.test.mjs` | JavaScript | FAFF-1000/1008 conclude tests (lines 576-761) |
| `test/commissaire-unit-id.test.mjs` | JavaScript | Asserts the conclude verdict at line 107 |
| `docs/reference/GLOSSARY.md` | Markdown | Gains a row between "concurrency" (line 16) and "contract" (line 17) |
| `docs/guide/commissaire-reuse.md`, `docs/guide/verify-run-evidence.md` | Markdown | Name the kind (reuse guide lines 29 and 85; evidence guide line 120) |
| `verification/commissaire-facade/v0.2/schema/examples/` | JSON | Read-only test input: `source-run.declared-effects.jsonl` (seq 7 is a signed legacy conclusion) and `producer-pk.example.json` |

**Scope statement.** This change sits at the Commissaire facade's conclusion record: its writer, its one reader, its tests, and the docs that name it.

## 2. OUT OF SCOPE

- **Facade schema reference v0.3, and everything under `verification/commissaire-facade/`** (schemas, examples, pages, README). Owner: FAFF-1224. Until FAFF-1224 merges, `KIND_AUTHOR` names `conformed_to_contract` while the v0.2 envelope enum names `accepted_under_contract`; no test compares them, and FAFF-1224 merges straight after this ticket.
- **The FAFF-360 external harness:** `verify-commissaire.mjs`, `test/impure/commissaire-bare-claude.test.mjs`, the harness README, the scaffolder and the runbook pins. Owner: FAFF-1224. The harness stays green in this PR because it pins the driver at `475c0362`, whose `commissaire` still writes the legacy name the verifier asserts.
- **`test/commissaire-facade-spec.test.mjs`.** Owner: FAFF-1224. It reads only committed facade files, so this change does not affect it.
- **The reuse guide's facade links** (`docs/guide/commissaire-reuse.md` lines 147-153, pointing at v0.2). Owner: FAFF-1224, which publishes v0.3; FAFF-1175 moved the same links for v0.2.
- **Making `verdict conclude` check grants.** Owner: FAFF-1225, which also restores "granted" in the explanation and updates the pinned explanation string (section 3).
- **Removing the `--issue` alias and the dual `issue` output fields.** Planned for facade v0.4; recorded in FAFF-1224's open question.
- **The RFC lifecycle-state name `AcceptedUnderContract`** in `docs/rfc/rfc-superdomestique-runtime/**`, and every historical record (`records/**`, `test/fixtures/faff-826-map-root/**`, `.faff/anchors/**`, local run ledgers, sealed bundles). They record what was written at the time.
- **Moving `SK_commissaire` out of the run directory** (FAFF-1177, the governor process ADR 0135 describes). This ticket lands first so that change carries no vocabulary churn.

## 3. WHAT: vocabulary, interfaces and docs

| Term | Meaning |
|---|---|
| conclusion record | The signed `schema:3` record `verdict conclude` appends on the clean path |
| current kind | `conformed_to_contract`, carried by every new conclusion record |
| legacy kind | `accepted_under_contract`, carried by every conclusion record written before this change |
| compatibility read | The one function that answers "is this record a conclusion, and under which name?" |

### The compatibility read (`effects.js`)

```
CONSTANT CONCLUSION_KIND        = "conformed_to_contract"
CONSTANT LEGACY_CONCLUSION_KIND = "accepted_under_contract"

FUNCTION conclusionKindOf(record) -> CONCLUSION_KIND | LEGACY_CONCLUSION_KIND | null
  1. IF record is null, not an object, or an array: RETURN null
  2. IF record.kind_of_entry is exactly CONCLUSION_KIND or exactly LEGACY_CONCLUSION_KIND:
       RETURN record.kind_of_entry
  3. RETURN null        # any other kind, a non-string kind, or no kind
```

It sits after the FAFF-1167 block, under its own comment header naming FAFF-1221, and the constants and function join the alphabetised `module.exports` list (line 876). The legacy string appears in `effects.js` exactly once, on the `LEGACY_CONCLUSION_KIND` definition line; comments and selftest cases refer to the constant names. A record holds one `kind_of_entry`, so the dual-key rejection `unitIdOf` needs has no counterpart. The selftest gains cases beside lines 817-830: each constant resolves to itself; `declare`, `""`, a number, a missing kind, `null` and an array resolve to `null`.

**Chosen:** `conclusionKindOf` plus two exported constants in `effects.js`, beside `unitIdOf`. Rationale: it follows the FAFF-1167 precedent the human decision names; `commissaire.ts` already requires `effects` (line 74), so no new dependency enters the facade; a later reader imports the same function instead of writing its own string check. Returning the kind rather than a boolean lets `verdict conclude` report which name it found. Rejected: a private helper in `commissaire.ts`, which hides the read from future readers and breaks the precedent.

### `KIND_AUTHOR` (`commissaire.ts` lines 106-114)

`accepted_under_contract: "commissaire"` becomes `conformed_to_contract: "commissaire"`. The key stays a literal (a computed key from the untyped `require` would widen the object's type); a test binds it to `CONCLUSION_KIND`.

**Chosen:** `KIND_AUTHOR` lists only the current kind. Rationale: it is the writer vocabulary, and no runtime code reads it (defined at line 106, exported at line 1341, nothing else). Authentication never consults it: `verifyAuthLeg` (371-405) selects the check by `author` and verifies `commissaire_sig` against the governor public key without reading `kind_of_entry`. Section 4 proves this over a real signed legacy record.

### `verdict conclude` behaviour and output

```
PROCEDURE cmdTerminalVerdict(flags)            # changes only; preconditions unchanged
  entries  := ledger records matching the unit (matchesUnit), in ledger order
  pk       := commissairePublicKey(runDir, governorDir, producerDir)   # the same resolution verifyAuthLeg uses
  existing := first record in entries WHERE conclusionKindOf(record) != null
                                         AND record.author == "commissaire"
                                         AND pk != null AND verifyDecision(record, pk)
  IF existing:
     print { verdict: CONCLUSION_KIND, kind_of_entry: conclusionKindOf(existing),
             issue, unit_id, idempotent: true, seq: existing.seq }
     RETURN 0                                  # appends nothing
  ... producer, escape, governor, fingerprint and revision checks unchanged ...
  body.kind_of_entry := CONCLUSION_KIND
  append the signed record
  print { verdict: CONCLUSION_KIND, kind_of_entry: CONCLUSION_KIND,
          issue, unit_id, producer_id, seq }
  RETURN 0
```

`commissaire.ts` adds `conclusionKindOf` and `CONCLUSION_KIND` to its `require("./effects")` destructure. Refusals keep `verdict: "refused"` and their shapes. The comments at lines 845 and 855 name the current kind.

**Only an authenticated conclusion counts as "already concluded"** (comment 493680c3, decision 1; the round-3 infosec finding). The idempotency check accepts an existing conclusion-kind record only when its `author` is `commissaire` and its `commissaire_sig` verifies under the Commissaire public key. The key is resolved exactly as `verifyAuthLeg` resolves it, through one extracted helper `commissairePublicKey` that both call: the governor file's key whenever governor material exists, and the producer-dir `pk.json` only when it does not. A `pk.json` that disagrees with the governor therefore never decides the idempotency check; `audit verify` keeps reporting it as `pk-fingerprint-tampered`. (Corrected during build on 2026-10-08: the earlier wording, "no key at all when both exist and their fingerprints disagree", made conclude append a second signed conclusion on a run with a tampered `pk.json`; the independent Phase-1 review found it and test 7c pins the fix.) A conclusion-kind record that fails any of these (producer-authored, unsigned, tampered, or unverifiable because no key resolves) is not a conclusion. Conclude then runs its ordinary checks and, on the clean path, appends a genuine signed record. The planted record stays in the ledger untouched, and `audit verify` keeps reporting it as it does today: a failed producer HMAC, or `commissaire-sig-invalid`.

**Chosen:** authenticate before short-circuiting, reusing `verifyDecision` and the key resolution `audit verify` already uses. Rationale: once FAFF-1177 separates custody, the producer can append records but cannot sign as Commissaire, so a kind name alone must never stand in for the governor's signature; a second key-resolution path would be a second place for the FAFF-978 key-swap rule to drift. Rejected: refusing conclude when an unauthenticated conclusion-kind record exists. The decision asks only that such a record not count, and the ordinary path already refuses whenever the evidence is not clean.

**Chosen:** `verdict` is always `conformed_to_contract`, and a new `kind_of_entry` field names the kind stored in the ledger. Rationale: `verdict` is CLI vocabulary and renames with the family, so a consumer checks one value whatever the ledger's age; `kind_of_entry` reuses the ledger's field name and tells the operator truthfully that an old run's signed record carries the legacy name. Rejected: echoing the legacy name in `verdict`, which would make every consumer of CLI output write its own compatibility read.

**Which field answers which question** (comment 493680c3, decision 2). `kind_of_entry` answers "what did the ledger record?": it is the stored kind, exactly as signed, so it reads `accepted_under_contract` for a run concluded before FAFF-1221. `verdict` answers "did this unit conclude?" in current vocabulary, so it is always `conformed_to_contract` on success and `refused` otherwise. The two differ only on a legacy record, and both are correct there. The usage text's `verdict conclude` entry and the glossary row each state this in one sentence.

### What renames here, what FAFF-1224 renames, what stays

| Renames in this PR | Renames in FAFF-1224 | Stays as written |
|---|---|---|
| The stored kind on new records; the `verdict` output value; the `KIND_AUTHOR` key; the usage text; comments in `commissaire.ts` | Facade v0.3 (`conformed-to-contract.schema.json` and example, envelope enum, `records.md` section) | Every record already written: ledgers, sealed bundles, anchors |
| Test titles and assertions in `commissaire.test.mjs` and `commissaire-unit-id.test.mjs` | Harness die message, `driftShapeFindings` strings, demo-result `terminal_verdict.verdict`, harness README, pin | `audit verify`'s `records[].kind_of_entry`, which reports the stored kind as signed |
| The reuse and evidence guides; a new glossary row | The reuse guide's facade links | Facade v0.1 and v0.2, RFC state names, ADRs, specs |

**Chosen:** the split above. Rationale: it is decision 1 of comment 31e5e20f; everything written from now on uses the current name, and everything recording the past keeps its name.

### The plain-English explanation

`cmdTerminalVerdict` checks, before signing: the unit has evidence; the producer is admitted and not revoked; `computeEscapes` finds no observed effect without a matching declaration and no dual-key record (`effects.js` 127-150); a governor exists; the key fingerprints match; one contract revision covers the evidence. It does not check grants. The issue and the first operator brief said "declared, granted and observed"; comment 31e5e20f drops "granted" until FAFF-1225 lands.

Two exact strings fix the explanation so its placement is checkable:

```
MEANING     = "every protected effect it observed was declared, with no escapes"
EXPLANATION = "conformed_to_contract: the run kept to its contract; every protected effect it observed was declared, with no escapes. It does not mean the work was accepted."
```

- **CLI, once.** The usage text `commissaire --help` prints (line 565) keeps one entry line for `verdict conclude`, now reading `(append the signed conformed_to_contract record, or a refusal; alias: terminal-verdict)`, followed by one indented line holding `EXPLANATION` verbatim.
- **Docs, once.** A `docs/reference/GLOSSARY.md` row between "concurrency" and "contract":

  | Term | Meaning | Artifact it names |
  |---|---|---|
  | conformed to contract | The verdict Commissaire signs when a work unit's run kept to its contract: every protected effect it observed was declared, with no escapes. It does not mean the work was accepted, reviewed or judged for quality. Records written before FAFF-1221 carry the former name `accepted_under_contract`, and readers accept both. | `conformed_to_contract` record kind, written by `commissaire verdict conclude` (`plugin/skills/faff/bin/lib/commissaire.ts`) |

- **Every other doc names the term and links the glossary at its first mention, without restating `MEANING`.** `commissaire-reuse.md` line 29 (governor row) names `conformed_to_contract` with a link to `../reference/GLOSSARY.md`; line 85 names it. `verify-run-evidence.md` line 120 lists `conformed_to_contract` with the same link and adds "(records written before FAFF-1221 show `accepted_under_contract`)".

**Chosen:** the usage text and one glossary row hold the explanation, fixed by the two exact strings, with "granted" dropped. Rationale: comment 31e5e20f sets the wording; the usage text is where a person reading the CLI looks for meaning, while JSON output is read by programs and would repeat the sentence on every call; the glossary is the repo's one home for coined terms. Fixing the strings turns "explained once" into a count. FAFF-1225 changes both strings and the test that pins them when it restores "granted".

"Once" is deliberately a string-level rule: the meaning has one home in the docs and one in the CLI, and every other doc reaches it through a glossary link at first mention instead of a paraphrase. A reader of the reuse or evidence guide gets the meaning one click away, and the meaning can never drift between two prose copies; that trade is the point of the glossary (`AGENTS.md` sends readers there for coined terms).

## 4. HOW: behaviour

### The backward-compatibility proof

**Automated, over the frozen v0.2 ledger.** A new test file `test/commissaire-conclusion-kind.test.mjs` (FAFF-1167 had its own file) copies two committed files into a scratch run directory, so a regression that appends can never dirty the repo:

```
PROCEDURE legacy_run_dir() -> dir
  1. dir := new temp directory
  2. copy verification/commissaire-facade/v0.2/schema/examples/source-run.declared-effects.jsonl
       -> dir/declared-effects.jsonl
  3. copy verification/commissaire-facade/v0.2/schema/examples/producer-pk.example.json
       -> dir/commissaire/producer/pk.json
  RETURN dir          # 8 schema:3 records; seq 7 is a signed accepted_under_contract for unit DEMO-1
```

It asserts:

1. `commissaire audit verify --run-dir <dir> --json` exits 0 with `result: "pass"`, `commissaire_decisions` `{ verified: 4, failed: 0 }`, `producer_claims.unverifiable_without_secret` 4, and the seq 7 entry has `kind_of_entry: "accepted_under_contract"` and `classification: "verified"`. Probed on 2026-10-08: exactly this result.
2. `commissaire verdict conclude --run-dir <dir> --unit-id DEMO-1`, run twice, exits 0 each time and prints `verdict: "conformed_to_contract"`, `kind_of_entry: "accepted_under_contract"`, `idempotent: true`, `seq: 7`; the ledger's sha256 is unchanged and it has 8 lines. Probed: idempotent at seq 7 without a governor directory.
3. A one-line scratch ledger holding the v0.1 `accepted-under-contract.example.json` (`issue`-keyed, unit `FAFF-1138`, seq 23) re-concludes with `--unit-id FAFF-1138` idempotently: `kind_of_entry: "accepted_under_contract"`, `seq: 23`, nothing appended. Probed: idempotent at seq 23.
4. `KIND_AUTHOR` (imported from the committed `commissaire.js`) has the key `CONCLUSION_KIND` with value `"commissaire"` and no `LEGACY_CONCLUSION_KIND` key; `LEGACY_CONCLUSION_KIND === "accepted_under_contract"` and `CONCLUSION_KIND === "conformed_to_contract"`.
5. `conclusionKindOf` returns each constant for its own kind and `null` for `declare`, `""`, `5`, a missing kind, `null` and `[]`.
6. The combined stdout and stderr of `commissaire --help` contains `EXPLANATION` exactly once and `MEANING` exactly once.
7. Producer-authored conclusion records do not count (comment 493680c3, decision 1). For each name (`conformed_to_contract`, then `accepted_under_contract`), a scratch governed run with a clean covered effect gets one extra record appended through the producer append path, carrying that kind and `author: "producer"`. `verdict conclude` must not return `idempotent: true`. It appends exactly one new record, `author: "commissaire"`, kind `conformed_to_contract`, whose `commissaire_sig` verifies, and prints that record's seq. A copy of the v0.2 legacy record with its `commissaire_sig` altered by one character also does not count. On that copy, conclude then refuses through the ordinary path (no admitted producer or governor in that directory), and nothing is appended.

**Updated existing tests.** Positive conclude assertions in `commissaire.test.mjs` and `commissaire-unit-id.test.mjs` expect `conformed_to_contract` in `verdict` and in the stored record, and the FAFF-1000 fresh-path test asserts the new `kind_of_entry` output field. Test titles name the current kind. The "no terminal record was written" assertions (lines 618, 640, 675, 736, 761) count records where `conclusionKindOf(record) !== null`, so a writer that regressed to the legacy name still fails them, and neither file contains the legacy literal.

**Chosen:** no new committed fixture; the test copies the frozen v0.2 files. Rationale: those bytes are committed, carry a real governor signature over a legacy conclusion, and the facade versioning policy forbids editing them; a copy under `test/fixtures/` would be a second home for the same bytes. The existing `secret-free-replay` fixture has no conclusion record.

**Operator checks on built code, recorded in the PR body.** Run with the branch's build, from the main checkout (where `.faff/runs/` lives):

```
PROCEDURE operator_local_run_check()
  run := .faff/runs/run-20261005-040215-graft-FAFF-588      # holds one legacy conclusion (checked 2026-10-08)
  1. commissaire audit verify --run-dir <run> --json
     EXPECT result "pass"; the conclusion record listed with kind_of_entry "accepted_under_contract", classification "verified"
  2. copy <run> to a scratch dir; commissaire verdict conclude --run-dir <copy> --unit-id FAFF-588
     EXPECT idempotent true, kind_of_entry "accepted_under_contract"; the copy's declared-effects.jsonl sha256 unchanged

PROCEDURE operator_bundle_check()
  1. Fetch one pre-change sealed bundle ref from origin, e.g. refs/faff/bundles/run-20261005-040215-graft-FAFF-588/seg-0/FAFF-588
  2. faff bundle verify --run-id <run_id> --run-segment-id 0 --boundary-kind <kind from the manifest> --boundary-key <key> --json
     EXPECT verdict "CLEAN", exit 0
  3. List the bundle's members (git ls-tree -r <ref>). IF its ledger member holds a legacy conclusion record:
       extract the members into a scratch run dir; run audit verify (EXPECT pass, legacy record verified)
       and re-conclude on it (EXPECT idempotent, legacy kind reported, ledger unchanged)
     ELSE: state in the PR body that the bundle holds no conclusion record, and why (below)
```

**Chosen:** this ticket is built attended (L2), in a session that can read the operator's main checkout and fetch `refs/faff/bundles`, and that session runs both operator checks before opening the PR. If a later build lane cannot reach either input, the PR is not merged until a human runs the two procedures and adds their output to the PR body; the merge-path owner checks for that output before merging. Rationale: the evidence lives on the operator's machine and on origin's bundle refs, neither of which CI or a fresh unattended worktree can assume.

**Chosen:** automated proof over the frozen v0.2 ledger; operator proof over a real local run and a real sealed bundle, with a stated fallback when no bundle holds a conclusion. Rationale: CI cannot assume `.faff/runs/` or `refs/faff/bundles` exist; `faff bundle verify` classifies by member digests and JSON shape (`classifyBundle`, `bundle.js` 87-112) and never reads `kind_of_entry`, so a bundle's verdict cannot change with this rename. A conclusion record may be absent from every sealed bundle on origin: on 2026-10-08 origin held no `run-close` bundle refs, and per-issue bundles may be sealed before run-close conclude. In that case the legacy record's verification is fully covered by the automated test and the local-run check.

### No other reader names the kind

`git grep -n -i -E 'accepted[_ -]?under[_ -]?contract' d5984970 -- plugin eval .github scripts` returns only `commissaire.ts` and `commissaire.js`. The other governance readers filter on other kinds: `merge-gate.js` (`declare`, `observe`, `effect-decision-verdict`), `audit.js` (`declare`, line 81), `effects-reconcile.js` and `computeEscapes` (`declare`, `observe`), while `run-ledger.js`, `bundle.js`, `bundle-seal-core.js`, `bundle-recover.js` and `shadow-fidelity.js` (the Gate 1 evidence tooling) never read `kind_of_entry` at all, and no `SKILL.md` or `eval/` file names the kind (`faff-graft/SKILL.md` 654 and `faff-beep-boop/SKILL.md` 445 call `verdict conclude` without reading its verdict). The issue's "every reader is updated" is therefore met by the one runtime reader plus the docs, and the PR body says so with the grep.

The claim is about runtime code paths, not just file names, and it is proven by enumerating every comparison on `kind_of_entry` under `plugin/skills/faff/bin/lib/` at `d5984970` (`git grep -n "kind_of_entry" -- 'plugin/skills/faff/bin/lib/*.js'`, then each `===`/`!==` line):

| Code path | Compares `kind_of_entry` with | Needs `conclusionKindOf`? |
|---|---|---|
| `commissaire.js` 975 (`cmdTerminalVerdict` idempotency) | the conclusion kind | Yes: the one reader this change moves onto `conclusionKindOf` |
| `commissaire.js` 268, 297, 307 (`evaluateDecisionRequest`) | `effect-decision-request`, `observe`, `declare` | No |
| `commissaire.js` 522 (`audit verify` records list) | nothing; copies the stored kind into its report | No: it reports signed bytes as signed |
| `commissaire.js` `verifyAuthLeg` (371-405 in the `.ts`) | nothing; selects the check by `author` | No, deliberately: authentication must not depend on vocabulary |
| `effects.js` 140-141 (`computeEscapes`) | `declare`, `observe` | No |
| `effects-reconcile.js` 233 | `declare`, `observe` | No |
| `audit.js` 81 | `declare` | No |
| `merge-gate.js` 868, 963, 2302-2326 | `declare`, `effect-decision-verdict`, `observe` | No |

The legacy literal also appears in committed test inputs (the frozen v0.2 ledger the new test reads); those are data, not readers, and they sit under `verification/`, which the inventory excludes as FAFF-1224's and history's. A future reader that needs to recognise a conclusion imports `conclusionKindOf`; the anti-pattern below forbids a literal comparison, and the DONE inventory catches one.

**Chosen:** `effects.js` hosts the compatibility read. Rationale: `effects.js` already holds the ledger-record read helpers every Commissaire reader shares (`unitIdOf`, `carriesBothUnitKeys`, `matchesUnit`, `computeEscapes`), so it is where a reader of ledger records already looks; the conclusion record lives in the same `declared-effects.jsonl` chain.

### TypeScript emit

Edit `commissaire.ts`, then `cd plugin/skills/faff && npm install && npm run build`, and commit the `.ts`, the regenerated `commissaire.js` and `build-manifest.json` together (ADR-0132; `AGENTS.md`). `effects.js` is plain JavaScript.

### Build order

1. Branch from current `origin/main`.
2. `effects.js`: constants, `conclusionKindOf`, selftest, exports. Run `faff effects --selftest`.
3. `commissaire.ts` edits; rebuild; commit `.ts`, `.js` and `build-manifest.json` together.
4. Tests: the new file and the updates to the two existing files.
5. Docs: glossary row, reuse guide, evidence guide.
6. Run the full `npm test`, the checks in section 8 and the operator checks; write the PR body.
7. After merge, the graft posts two comments (it edits no description): on FAFF-1177, naming `conformed_to_contract` as the kind its governor process will sign, with `accepted_under_contract` read only through `conclusionKindOf`; on FAFF-1224, naming the merge commit SHA as the harness pin and the reuse guide's facade links as its edit.

Every commit carries `Signed-off-by` (the tracked `prepare-commit-msg` hook adds it; `git commit -s` otherwise). No commit in this PR is pinned by anything, so ordinary rebases and merges of `main` are safe.

**Anti-pattern:** comparing `kind_of_entry` to either literal outside `conclusionKindOf`. Why: it creates a second compatibility read that a future rename would miss.

**Anti-pattern:** touching any file FAFF-1224 owns to "keep things consistent". Why: comment 31e5e20f puts them in the second PR, and the harness stays green only while it is untouched.

## 5. Scenarios

```
Given a run directory holding a copy of the frozen v0.2 source ledger (seq 7 a signed accepted_under_contract record for DEMO-1) and its public pk.json
When `commissaire audit verify --run-dir <dir> --json` runs
Then it exits 0 with result "pass", 4 commissaire decisions verified and 0 failed,
     and seq 7 is reported with kind_of_entry "accepted_under_contract", classification "verified"
```

```
Given the same run directory
When `commissaire verdict conclude --run-dir <dir> --unit-id DEMO-1` runs twice
Then each run exits 0 and prints verdict "conformed_to_contract", kind_of_entry "accepted_under_contract",
     idempotent true and seq 7, and the ledger's bytes are unchanged
```

```
Given a clean covered governed run with no conclusion record
When `commissaire verdict conclude` runs
Then it appends one signed record with kind_of_entry "conformed_to_contract", prints that kind in verdict and kind_of_entry,
     and `audit verify` classifies the record "verified"
```

- Constraint: `node --test test/impure/commissaire-bare-claude.test.mjs` and `test/commissaire-facade-spec.test.mjs` pass unchanged.

## 6. Design decision rationale

**Where does the compatibility read live?** A private helper in `commissaire.ts`, or an exported function in `effects.js` beside `unitIdOf`. **Chosen:** `conclusionKindOf` and two constants in `effects.js` (section 3).

**Does `KIND_AUTHOR` keep the legacy name?** **Chosen:** current name only; authentication reads `author`, proven by test (section 3).

**What does a re-conclude over a legacy record print?** **Chosen:** `verdict: "conformed_to_contract"` plus a `kind_of_entry` field naming the stored kind (section 3).

**What renames in this PR?** **Chosen:** the runtime, tests and docs; facade and harness go to FAFF-1224; the past stays (section 3).

**What wording, and where?** **Chosen:** the comment 31e5e20f wording, fixed as two exact strings, in the usage text and one glossary row (section 3).

**Is a new committed fixture needed?** **Chosen:** no; the test copies the frozen v0.2 files (section 4).

**How are real pre-change runs and bundles proven?** **Chosen:** operator checks on built code, with a stated fallback when no sealed bundle holds a conclusion (section 4).

## 7. Open questions and assumptions

**Open questions.** None. Comments 1cb8267c and 31e5e20f settle the name, the split, the wording and the order.

**Assumptions.**

- **Assumes:** the operator's main checkout holds `.faff/runs/run-20261005-040215-graft-FAFF-588/` with one `accepted_under_contract` record in its `declared-effects.jsonl` (it did on 2026-10-08). Validation: `grep -c accepted_under_contract .faff/runs/run-20261005-040215-graft-FAFF-588/declared-effects.jsonl` prints `1`. If not, use any other local run dir that `grep -rl --include=declared-effects.jsonl accepted_under_contract .faff/runs` lists (35 on 2026-10-08), and name it in the PR body.

## 8. DONE: definition of done

### From WHY and WHAT (writer and compatibility read)
- [ ] New conclusion records carry `kind_of_entry: "conformed_to_contract"` (scenario 3 test).
- [ ] `git grep -n -F accepted_under_contract -- plugin/skills/faff/bin/lib/commissaire.ts plugin/skills/faff/bin/lib/commissaire.js` prints nothing (code, comments and usage text included).
- [ ] `git grep -c -F accepted_under_contract -- plugin/skills/faff/bin/lib/effects.js` prints `plugin/skills/faff/bin/lib/effects.js:1`, and that line defines `LEGACY_CONCLUSION_KIND`.
- [ ] `effects.js` exports `CONCLUSION_KIND`, `LEGACY_CONCLUSION_KIND` and `conclusionKindOf`; `faff effects --selftest` covers the cases in section 3 and prints `effects --selftest: ok`.
- [ ] `KIND_AUTHOR` has `conformed_to_contract: "commissaire"` and no `accepted_under_contract` key.
- [ ] `verdict conclude` finds an existing conclusion only through `conclusionKindOf`, and counts it only when `author` is `commissaire` and `verifyDecision` passes under `commissairePublicKey` (assertion 7). Both output paths print `verdict: "conformed_to_contract"` and a `kind_of_entry` field naming the stored kind.
- [ ] `verifyAuthLeg` and `cmdTerminalVerdict` resolve the Commissaire public key through the one `commissairePublicKey` helper.

### From WHAT (explanation)
- [ ] `commissaire --help` output contains `EXPLANATION` exactly once and `MEANING` exactly once (assertion 6).
- [ ] `git grep -n -F "every protected effect it observed was declared, with no escapes" -- docs/` prints exactly one line, in `docs/reference/GLOSSARY.md`.
- [ ] The glossary row sits between "concurrency" and "contract" and contains no "granted".
- [ ] In `docs/guide/commissaire-reuse.md` and `docs/guide/verify-run-evidence.md`, the first line containing `conformed_to_contract` also contains a link to `../reference/GLOSSARY.md`.

### From HOW (backward compatibility)
- [ ] `test/commissaire-conclusion-kind.test.mjs` passes assertions 1 to 7 from section 4.
- [ ] The "no terminal record written" assertions in `commissaire.test.mjs` count through `conclusionKindOf`; positive conclude tests assert the current name in `verdict` and in the stored record.
- [ ] The PR body carries the outputs of `operator_local_run_check` (audit verify `pass` with the legacy record verified; idempotent re-conclude on a copy, ledger unchanged) and `operator_bundle_check` (`faff bundle verify` `CLEAN`, plus either the audit verify and re-conclude outputs or the stated reason the bundle holds no conclusion).

### Repository inventory
- [ ] This command prints hits only in `plugin/skills/faff/bin/lib/effects.js` (the one constant line), `test/commissaire-conclusion-kind.test.mjs`, `docs/reference/GLOSSARY.md` (the former-name sentence) and `docs/guide/verify-run-evidence.md` (the legacy note):

  ```
  git grep -n -i -E 'accepted[_ -]?under[_ -]?contract' -- . \
    ':(exclude)docs/rfc/' ':(exclude)records/' ':(exclude)test/fixtures/faff-826-map-root/' \
    ':(exclude).faff/' ':(exclude)verification/' \
    ':(exclude)test/commissaire-facade-spec.test.mjs' ':(exclude)test/impure/commissaire-bare-claude.test.mjs'
  ```

  The excluded paths are historical records, all committed `.faff/` bookkeeping (anchors and any other run record this build commits; comment 493680c3, decision 3), and the files FAFF-1224 owns.
- [ ] `git diff origin/main --stat -- verification/ test/commissaire-facade-spec.test.mjs test/impure/commissaire-bare-claude.test.mjs` is empty.

### Tracker hygiene (done during prep, 2026-10-08)
- [x] The FAFF-1221 description holds a single acceptance list, matching this spec's section 8; the superseded facade, harness and "granted" bullets are removed (comment 493680c3, decision 4).
- [x] FAFF-1177's acceptance criteria name `conformed_to_contract` in place of `accepted_under_contract` (comment 493680c3, decision 4).
- [x] FAFF-1225 carries a comment naming the two pinned strings (`MEANING`, `EXPLANATION`) and the test assertion it must change when it restores "granted".

### PR body
- [ ] States the wording change: "granted" is dropped per comment 31e5e20f decision 2, because `verdict conclude` does not check grants, and FAFF-1225 restores it.
- [ ] States that no other reader names the kind, with the `git grep` command and output from section 4 and the reader list (merge-gate, run-ledger, reconcile, audit, bundle, shadow-fidelity, skills, eval).
- [ ] Names the follow-ups and owners: FAFF-1224 (facade v0.3, harness pin to this merge commit, reuse guide facade links), FAFF-1225 (grant check and "granted"), FAFF-1177 (comment posted after merge), facade v0.4 (`--issue` alias removal, FAFF-1224's open question), and the FAFF-829 related edge added during prep on 2026-10-08.

### Build and CI
- [ ] `commissaire.ts`, `commissaire.js` and `build-manifest.json` are committed together, and `faff regions check` passes.
- [ ] `node --test test/impure/commissaire-bare-claude.test.mjs` and `test/commissaire-facade-spec.test.mjs` pass unchanged.
- [ ] Every commit carries `Signed-off-by`; the PR's `dco`, `validate` and `governance` checks pass; the full `npm test` suite passes.
- [ ] After merge, the graft's comments on FAFF-1177 and FAFF-1224 (build order step 7) are posted. The FAFF-1177 comment is now a pointer only, because its acceptance criteria were edited during prep.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed, so no grader, eval case or seam-registry row is needed.

### Integration smoke test

```
1. Admit a producer, declare and observe one covered effect, and run verdict conclude in a scratch run.
2. Expect verdict "conformed_to_contract" and a new last ledger record of that kind; audit verify passes.
3. Re-run verdict conclude; expect idempotent true, kind_of_entry "conformed_to_contract", nothing appended.
4. Assemble a run dir from the v0.2 source ledger; audit verify passes; verdict conclude returns
   idempotent seq 7 with kind_of_entry "accepted_under_contract"; the ledger is unchanged.
```

confidence: high
build-tier: complex
spec-review: human-override (comment 493680c3; rounds 1-3 recorded, no approve)

## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery (agile delivery lens), issue-critique for FAFF-1221 against the revised spec, checked at `origin/main` `d5984970`. The tracker was read on 2026-10-08. Advisory only; it does not gate a high-confidence promotion.*

**Right-sized?** Yes. After the split in comment 31e5e20f, the ticket covers one concern: the runtime rename, its compatibility read, tests and docs. That is about 1 to 2 days and fits the `Size: M` label. The FAFF-1221 → FAFF-1224 train follows the FAFF-1167 → FAFF-1175 seam. One gap remains: the FAFF-1221 description's "Done when" list still asks for facade v0.3, a harness that asserts the new name, and the "declared, granted and observed" wording. Those now belong to FAFF-1224 and FAFF-1225. This spec, with comment 31e5e20f, supersedes those three bullets; acceptance at graft time is checked against section 8 of this spec.

**Workstream fit?** No issues. FAFF-1221, FAFF-1224 and FAFF-1225 all sit in "Governed execution is compared with a strong one-shot control", the stream of FAFF-1177, which they gate.

**Deps surfaced?**
- The blocks edges to FAFF-1224, FAFF-1225 and FAFF-1177 are all in place. FAFF-1225 also blocks FAFF-1177, so the governor is built after the grant check exists.
- FAFF-1177's acceptance criteria still name `accepted_under_contract`. The post-merge comment in build order step 7 covers this; the description itself stays stale until someone edits it.
- The FAFF-829 related edge is now in place. FAFF-1178 needs no edge; the new `commissaire-conclusion-kind.test.mjs` guards its "frozen in-process evidence verifies unchanged" bullet.
- The v0.4 `--issue` alias removal now has a home as FAFF-1224's open question.
- FAFF-1225 must change the two explanation strings this ticket pins in a test. Section 2 of the spec says so, but FAFF-1225's own description does not; one line there would keep the dependency visible.

**Risk profile?** Low. The pin on a PR-branch commit is gone, and FAFF-1224 pins to the merge commit on `main`, so ordinary rebases are safe. FAFF-1224's DoD now carries the de-risking harness check against today's `origin/main`. Two residual points:
- Until FAFF-1224 merges, `KIND_AUTHOR` and the updated reuse guide name `conformed_to_contract` while the facade they link (v0.2) names the legacy kind. The spec states this, and merging FAFF-1224 straight after keeps the window short.
- The PR-body DoD includes operator checks over the gitignored `.faff/runs/` in the main checkout and over a fetched bundle ref. An unattended lane in a fresh worktree cannot be assumed to reach either, so route this ticket for attended graft, or plan for a human to run those checks before merge.

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"assumes"}]}
```
