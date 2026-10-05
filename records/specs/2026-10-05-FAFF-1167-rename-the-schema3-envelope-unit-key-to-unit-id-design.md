# nlspec: FAFF-1167, rename the `schema:3` envelope unit key `issue` to `unit_id`

> Spec: faffter-dark-nlspec · 2026-10-05 · autonomous · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1167.

Revised on 2026-10-05: narrowed to the first half of the FAFF-1167 → FAFF-1175 PR train, the round-1 spec-review objections fixed (one infosec major, three minors), the round-2 architectural and QA objections fixed in place (accessor region, both-flags rule, escape shape), and four round-3 clarifications added after the last review round and not re-reviewed (no-unit escape shape, run-wide conclusion block and its remedy, coordinated alias removal, a `bundle-recover` test). The previous revision is the spec comment of 2026-10-05 (id 051b1daa); the round-1 findings are in the park comment of the same date (id 741441b1).

This spec is the buildable artifact for FAFF-1167. Its readers are the build agent that lands the rename and the reviewers who gate it. Every codebase claim below was checked against `origin/main` at `b02fac1b`.

## 1. WHY: problem and principles

**Problem.** The `schema:3` governance envelope names its work-unit field `issue`, a Software Delivery tracker noun that the master RFC's out-of-scope list keeps out of the core governance model. A governed process in another domain has a work unit, not a tracker issue. Addendum decision 6 (ratified 2026-10-05 in FAFF-1164) renames the field to `unit_id` and keeps `step`. One external consumer depends on the old name today (the FAFF-360 harness), and the cost of the rename rises with each new consumer.

**Why the rename is a read-side change, never a rewrite.** A record's key names are part of its signed image. `canonicalBytes` in `producer-auth.ts` strips only the authenticator fields, sorts the remaining keys and signs the result, so the string `"issue"` is inside every HMAC and Ed25519 signature already on disk, and inside every `prev` hash link. Renaming the key on a frozen record breaks its signature and the chain after it. The change therefore has two halves: the writer emits `unit_id` from now on, and every semantic reader resolves the unit through one accessor that accepts either key name. The authentication layer (`verifyAuthLeg`, `audit verify`) never reads the key by name and needs no change.

**Design principles.**

- **Fail closed on identity ambiguity.** The grant and coverage resolvers already fail closed: no matching verdict on a governed run means a refused merge (`resolveGrantByEffectKind` returns `absent-or-invalid`). The new accessor must keep that direction. A record whose unit cannot be resolved to exactly one string never matches anything, and a comparison against an unresolved comparand is always false.
- **Strict identity.** The unit is a string. The accessor never coerces numbers or booleans, and every comparison is `===` against a resolved, non-empty string comparand.
- **Never rewrite a signed record.** Every change is a pure read-side accessor or a forward-only writer change.
- **The record `schema` integer stays 3.** Minting `schema:4` would reopen addendum decision 2.
- **`step` is not touched.**

**Reference context.**

| File | Language | Role in this change |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (committed `.js` emit) | The only `schema:3` writer (`buildEnvelope`, `appendProducerRecords`, `appendCommissaireRecord`), the decision evaluator, `effect reconcile`, `verdict conclude`, `audit anchor`, the CLI parser and surface tables, the in-file selftest |
| `plugin/skills/faff/bin/lib/effects.js` | JavaScript | Home of the new accessor; `computeEscapes`, the shared escape core |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript | `resolveGrantByEffectKind` and its five wrappers; `readDeclaredMergeEffects` |
| `plugin/skills/faff/bin/lib/audit.js` | JavaScript | `accountHumanMerge` (reads the ledger declare) |
| `plugin/skills/faff/bin/lib/effects-reconcile.js` | JavaScript | `readDeclaredMergeEffects` and `segmentCovered` |
| `plugin/skills/faff/bin/lib/bundle-recover.js` | JavaScript | Calls `computeEscapes(entries, null)` over an anchor's ledger |
| `plugin/skills/faff/bin/lib/producer-auth.ts` | TypeScript | `canonicalBytes`; never names the key, so unchanged |
| `test/fixtures/commissaire/secret-free-replay/` | JSONL + JSON | The frozen `issue`-keyed fixture (4 records, `issue: "FAFF-1"` on seq 1 to 3) |

**Scope statement.** This change sits at the `schema:3` record envelope and the Commissaire CLI that writes and reads it. It does not reach the `schema:2` effects records, the events journal, or the published facade reference.

## 2. Scope: the first half of a PR train

The first revision of this spec bundled the envelope rename with the facade v0.2 reference and the external-consumer update. The round-1 spec review raised a methodology objection that the bundle held two independently verifiable units. On 2026-10-05 the ticket was split, and the methodology objection is answered by that split:

- **FAFF-1167 (this spec):** the writer, every reader, the compatibility read, the CLI flag rename with its alias, and dual-field JSON output.
- **FAFF-1175 (second half):** `verification/commissaire-facade/v0.2/`, the v0.2 facade-spec test rows, and moving `verify-commissaire.mjs` to `--unit-id`. It merges straight after this ticket.

**Chosen:** a PR train, FAFF-1167 then FAFF-1175, merged back to back and never apart (decided 2026-10-05). The gap between the two merges is safe because this ticket keeps the compatibility read, accepts `--issue` as a flag alias, and prints both `issue` and `unit_id` in JSON output for one release.

**Chosen:** FAFF-1030 and FAFF-829 are related to this ticket, not blocked by it (decided 2026-10-05). A capture taken under the old key stays verifiable through the compatibility read, so landing before them is a preference, not a dependency. No `blockedBy` edges are added, and no "should land before" wording remains.

**Chosen:** build on the `commissaire.ts` already on `origin/main` (FAFF-1170, PR #996). FAFF-1173 (Backlog, parked) asks that this rename happen in TypeScript; that condition already holds. Any validated-boundary work FAFF-1173 still carries touches the same body types and `parseCommissaireArgs`, so it follows this ticket rather than blocking it. The PR description flags FAFF-1173's stale "lands before FAFF-1167" sentence for a human tidy.

**Rollback.** Once the new writer runs, governed runs carry `unit_id`. If this change is reverted, the pre-change readers compare `e.issue === x`, which is `undefined === x` on those records, so grants resolve `absent-or-invalid` and merges are refused: the failure is closed, never a false grant. The operator step on a revert is to finish or re-admit any governed run that straddles it. The PR description states this.

**Chosen:** land the readers-first half (accessor, reader migration, dual-key rejection) as its own commit ahead of the writer flip, CLI flag and output fields. Rationale: the readers-first commit changes no behaviour on today's records, so a reviewer can check the reader census apart from the writer flip.

## 3. Out of scope

- **`verification/commissaire-facade/` and `verify-commissaire.mjs`.** Both move in FAFF-1175. This ticket changes neither. `test/commissaire-facade-spec.test.mjs` stays green against v0.1 because it validates the committed static examples, which this ticket does not touch.
- **The live output's departure from v0.1.** Two live shapes stop matching the v0.1 schemas: `effect reconcile` escapes gain a `unit_id` field (v0.1 `reconcile.schema.json` sets `additionalProperties: false`), and a record carrying both keys surfaces as a new `rejected-unit-key` escape signal (v0.1 enumerates only `escaped-side-effect`). New records also carry `unit_id` where v0.1 requires `issue`. These are the shapes FAFF-1175 publishes as v0.2; this ticket hands them over in its PR description.
- **`schema:2` records keep `issue`.** `appendEffectEntries` in `effects.js` writes `schema:2` rows with `issue` into the same `declared-effects.jsonl`, and `faff effects declare/observe/check` keep their own `--issue` flag. The shared readers resolve those rows through the accessor's `issue` path.
- **`step` is not renamed.** Its values mix lifecycle milestones (`admit`, `conclude`) and effect operations (`merge`, `push`, `pr-create`, `file-write`); `step` names both accurately (addendum decision 6).
- **The events journal and anchor witnesses.** `audit.js` reads `issue` on `events.jsonl` records, and `computeChainHead` stamps `issue` on an anchor's chain-head witness. Neither is a `schema:3` record.
- **Removing the alias.** The `--issue` flag alias and the `issue` output field are removed in the release after this one, once the FAFF-360 harness runs on `unit_id` (FAFF-1175's open question). That removal is one coordinated edit: `COMMISSAIRE_SPEC.flags`, the `parseCommissaireArgs` flag set, `normaliseUnitFlag`, the usage text and the dual output fields.
- **The FAFF-360 harness.** `test/impure/commissaire-bare-claude.test.mjs` drives a driver checkout pinned at `fd1e9788`, so this change cannot reach the binaries it runs. It must keep passing, and it will: it is unchanged here.

## 4. WHAT: vocabulary, types and interfaces

| Term | Meaning |
|---|---|
| work unit | The governed unit of work a record belongs to. Named `issue` on frozen records and `schema:2` rows, `unit_id` on new `schema:3` records. |
| unit key | Whichever of `issue` or `unit_id` a record carries. A key counts as present when the record has it as an own property with a value other than `undefined` (the JSON meaning of present). |
| compatibility read | The accessor that resolves a record's work unit from exactly one unit key, without mutating the record. |
| dual-key record | A record carrying both `issue` and `unit_id`, whatever their values. No writer produces one. Every reader rejects it. |
| frozen record | A signed record already on disk: the replay fixture, banked evidence under `verification/`, `.faff/anchors/**`, operator run directories. Never rewritten. |

**The envelope after the change.** `buildEnvelope` emits `unit_id` and never `issue`:

```
RECORD GovernedEnvelope (schema:3):
  schema: 3                       # unchanged
  run_id, seq, ts, author         # unchanged
  producer_id, contract_revision  # unchanged
  kind_of_entry                   # unchanged
  unit_id: string                 # renamed from `issue`
  step                            # unchanged
  prev                            # unchanged
  effect? | payload?              # unchanged
  producer_hmac | commissaire_sig # unchanged; excluded from canonicalBytes
```

**The writer body.** The body literal type in `buildEnvelope`, `appendProducerRecords` and `appendCommissaireRecord` changes from `issue?: unknown` to `unit_id?: unknown`. A TypeScript caller passing `issue` is a compile error (excess property).

**Chosen:** the writer rejects a body that carries an `issue` key or lacks a non-empty string `unit_id`, by throwing a `TypeError` before the append lock is taken (`appendProducerRecords` validates every body first; `appendCommissaireRecord` and `buildEnvelope` validate the one body). Rationale: only tests call these functions directly (checked: `git grep appendProducerRecords` finds `commissaire.ts` and `test/commissaire.test.mjs` only), so a silent `issue` fallback would buy nothing and would let a stale body write a record with no unit key. Rejecting is the writer-side half of fail-closed identity.

**The accessor.** Three pure functions, exported from `effects.js`:

```
FUNCTION carriesBothUnitKeys(rec) -> boolean
  RETURN present(rec, "issue") AND present(rec, "unit_id")

FUNCTION unitIdOf(rec) -> string | null
  IF rec is not a plain object: RETURN null
  IF carriesBothUnitKeys(rec): RETURN null           # dual-key: rejected
  v := rec.unit_id if present(rec, "unit_id") else rec.issue
  IF typeof v != "string" OR v == "": RETURN null     # no coercion
  RETURN v

FUNCTION matchesUnit(rec, unit) -> boolean
  RETURN typeof unit == "string" AND unit != "" AND unitIdOf(rec) === unit
```

`matchesUnit` is the only comparison readers use. Because it requires a non-empty string comparand and `unitIdOf` never returns `undefined`, the round-1 fail-open path (a conflicting record and a conflicting comparand both resolving to `undefined`, then `undefined == undefined`) cannot occur: `null` never equals a string, and a non-string comparand matches nothing.

**Chosen:** the accessor lives in `effects.js` as plain JavaScript, and it is a governance-region primitive. `effects.js` is in the `governance` region. Of the readers, `audit.js` and `effects-reconcile.js` are also `governance`, and `commissaire.ts`, `merge-gate.js` and `bundle-recover.js` are `factory`. Governance-to-governance and factory-to-governance requires are both legal under `faff regions check` (ADR-0042 forbids only governance-to-factory), so every reader reaches the accessor without a region violation, and any future governance or factory reader can too. `effects.js` is both the accessor's home and one of its readers (`computeEscapes`); that is a same-module call, not a require cycle. Rationale: `effects.js` is already required by `commissaire.ts` (line 71), `merge-gate.js` (line 47), `audit.js` (line 21) and `bundle-recover.js` (line 43), and lazily by `effects-reconcile.js` (inside `segmentCovered`, to break the existing cycle). It is not on the standalone-binary denylist. One home reaches every reader with no new module, no new require edge and no new `REGION_MAP` entry. A new TypeScript leaf module was rejected: it adds a region entry, a tsconfig include, a committed emit and a require-direction review for three small functions.

**Chosen:** no `UnitId` brand; the field stays `unknown` on the body type and is resolved through `unitIdOf`. Rationale: the codebase's brands (`ProducerId`, `ContractRevisionId`) exist because those strings feed key derivation, where swapping two strings is a real hazard. `unit_id` is compared and printed, never fed to a key derivation, and a brand would need an `as` cast at every read, which `scripts/check-no-boundary-cast.mjs` bans across the `commissaire.ts`/`producer-auth.ts` boundary.

**CLI surface.**

- `parseCommissaireArgs` adds `--unit-id` to its single-valued flag set. `--issue` stays in the set as an alias.
- After parsing and before dispatch, a normalisation step resolves the unit flag: `--issue` alone is copied to `--unit-id` and one deprecation line goes to stderr (`faff commissaire: --issue is deprecated; use --unit-id`); both flags together is a usage error (exit 2, message names both flags); `--unit-id` alone passes through. Handlers read only `--unit-id`.
- `REQUIRED_FLAGS_BY_CANONICAL` names `--unit-id` in place of `--issue` for `effect declare`, `effect authorize`, `effect observe`, `effect reconcile`, `verdict conclude` and `audit anchor`.
- `COMMISSAIRE_SPEC.flags` gains `"--unit-id": { arity: 1 }` and keeps `"--issue": { arity: 1 }`.
- Usage text and handler error messages name `--unit-id`.
- The normalisation runs for every verb, including verbs that take no unit flag (`contract admit`, `audit seal`), where it is a no-op unless a caller passes a unit flag.
- `faff effects` and `faff events anchor` keep their own `--issue` flags; they are different commands.

**Chosen:** `--unit-id` with `--issue` accepted as an alias for one release (decided 2026-10-05), and both flags together refused on presence, whether their values match or not. This is an input rule, separate from the record-level dual-key rule: it runs before any record is built, so a refused invocation writes nothing. Rationale: tolerating a same-value pair would need a value comparison and a precedence rule for the differing case; refusing on presence needs neither, and a caller moving to the new flag has no reason to pass both. Normalising before dispatch also keeps the flat `REQUIRED_FLAGS_BY_CANONICAL` lists free of an "either of two" rule they cannot express.

**JSON output.** For one release every Commissaire summary output that names the unit carries both `issue` and `unit_id` with the same value: the `verdict conclude` result (accepted, idempotent and refused), the `audit anchor` result, and each `effect reconcile` escape (including the escapes inside an `unreconciled-escape` refusal). On a `rejected-unit-key` escape both fields are `null`. `effect declare` and `effect observe` print the signed record they wrote, verbatim, so those outputs carry `unit_id` only.

**Chosen:** dual `issue` and `unit_id` fields on summary outputs for one release, and the record echo left verbatim (decided 2026-10-05 for the dual fields). Rationale: adding `issue` to an echoed record would print something other than the signed record. The FAFF-360 harness reads only exit codes from declare and observe, and reads `issue` from the conclude output, which keeps it.

**Chosen:** the record `schema` stays the integer 3, and new records are told apart from frozen ones by which unit key they carry (decided 2026-10-05). Rationale: a `schema:4` would reopen addendum decision 2, and no reader needs the integer to pick a key because the accessor handles both.

**Chosen:** rename `issue` to `unit_id` only and keep `step` (addendum decision 6, ratified 2026-10-05 in FAFF-1164).

## 5. HOW: behaviour

```
                  writes unit_id only (rejects issue / dual-key bodies)
buildEnvelope ─────────────────────────────► declared-effects.jsonl
                                              schema:3 new rows:    unit_id
                                              schema:3 frozen rows: issue
                                              schema:2 rows:        issue
                                                       │
                     every semantic reader uses matchesUnit / unitIdOf
                                                       ▼
 commissaire.ts  evaluateDecisionRequest, cmdTerminalVerdict, cmdReconcile, cmdAuditAnchor
 merge-gate.js   resolveGrantByEffectKind (+5 wrappers), readDeclaredMergeEffects
 effects.js      computeEscapes
 audit.js        accountHumanMerge
 effects-reconcile.js  readDeclaredMergeEffects, segmentCovered
 bundle-recover.js     computeEscapes(entries, null)  (no code change; inherits)
```

**Reader by reader.** Each direct `e.issue === x` becomes `matchesUnit(e, x)`, each read of a record's unit becomes `unitIdOf(e)`, and each reader's handling of a dual-key record is stated.

| Reader | Change | A dual-key record |
|---|---|---|
| `evaluateDecisionRequest` (commissaire.ts) | After leg 2 (the request authenticates), resolve `unit := unitIdOf(requestRecord)`. New leg: deny `invalid-unit-key` when `unit` is `null` or any entry in the ledger snapshot carries both keys. Freshness (leg 5a) and coverage (leg 5b) filter with `matchesUnit(e, unit)`. | Denies the request with `invalid-unit-key`, whether the dual-key record is the request or any ledger entry. |
| `cmdTerminalVerdict` (`verdict conclude`) | Filters with `matchesUnit(e, unit)`. Runs `computeEscapes` over the whole ledger with the unit filter, instead of over the pre-filtered entries. | Surfaces as a `rejected-unit-key` escape, so conclude refuses `unreconciled-escape`. |
| `cmdReconcile` (`effect reconcile`) | Passes the resolved `--unit-id` to `computeEscapes`; adds `unit_id` beside `issue` on each escape. | Surfaces as its own `rejected-unit-key` escape; `any_escape` is true. |
| `cmdAuditAnchor` (`audit anchor`) | Reads `--unit-id`; keeps the existing shape guard `/^[A-Za-z0-9][A-Za-z0-9._-]*$/` and the `..` check. | Not applicable: reads no record unit. |
| `resolveGrantByEffectKind` (merge-gate.js) | Verdict filter uses `matchesUnit(e, issue)`. The wrappers `resolveCommissaireDecisionGrant`, `resolvePrCreateGrant`, `resolveBranchDeleteGrant`, `mergeCoveredBySchema3Grant` and `prCreateCoveredBySchema3Grant` inherit it. | Never matches; a step whose only verdict is dual-key resolves `absent-or-invalid` on a governed run. |
| `readDeclaredMergeEffects` (merge-gate.js) | Filter uses `matchesUnit(e, issue)`. | Never matches. |
| `computeEscapes` (effects.js) | Groups by `(unitIdOf(e), step)`; the unit filter uses `matchesUnit`. | Never joins a group. Each one becomes its own escape `{ signal: "rejected-unit-key", issue: null, step, seq, escaped, event_seq: null }`, where `escaped` is `[e.effect]` when the record has an `effect` field and `[]` otherwise (so a dual-key declare and a dual-key observe both surface). It is emitted whatever the unit filter is, because an unattributable record could belong to any unit, and it covers nothing and hides nothing. |
| `accountHumanMerge` (audit.js) | `declare_present` uses `matchesUnit(e, issue)`. | Not counted as a declaration; its escape makes `landing_covered` false when it is a merge observe at step `merge`, which raises the existing `human_merge_unexplained` finding. |
| `readDeclaredMergeEffects` and `segmentCovered` (effects-reconcile.js) | Builds `{ issue: unitIdOf(e), target }` and skips dual-key records entirely. `segmentCovered`'s attribution match keeps its case-insensitive compare on the resolved string. | Skipped, so it covers no segment by attribution or by target. |
| `bundle-recover.js` | No code change; it calls `computeEscapes`. | A `rejected-unit-key` escape parks with `issue: null`, a visible park rather than a silent resume. |

**Chosen:** a dual-key record is rejected by every reader, whatever its two values (ticket acceptance criterion, ratified 2026-10-05). The round-1 spec tried to resolve agreeing values and fail only on disagreement; that is the path that let both sides resolve to `undefined` and match. Rejecting on presence is simpler and leaves no value comparison to get wrong.

**Chosen:** conflicting records never share an escape group; each is its own `rejected-unit-key` escape and never covers an observation (fixes the round-1 architectural minor). Rationale: grouping them under one key let a conflicting declare cover a conflicting observe from an unrelated record.

**Chosen:** the deny reason for an unresolvable or dual-key unit is a new value, `invalid-unit-key`, checked after authentication and before the descriptor, scope, freshness and coverage legs. Rationale: a forged record is named as an authentication failure first; after that, an identity fault is named precisely rather than surfacing as `effect-not-declared`.

**CLI normalisation.**

```
PROCEDURE normaliseUnitFlag(flags) -> exit code | ok
  hasIssue := flags["--issue"] is set; hasUnit := flags["--unit-id"] is set
  IF hasIssue AND hasUnit: write "pass --unit-id only (--issue is its deprecated alias)" to stderr; RETURN 2
  IF hasIssue: flags["--unit-id"] := flags["--issue"]; delete flags["--issue"]
               write the deprecation line to stderr once
  RETURN ok
```

It runs in `cmdCommissaire` after `parseCommissaireArgs` and before the handler, for every verb.

**Edge cases.**

- **Mixed ledger.** `schema:2` rows and frozen `schema:3` rows resolve through `issue`; new `schema:3` rows through `unit_id`. All share one ledger and one accessor.
- **Non-string or empty unit.** `unitIdOf` returns `null`; the record matches nothing. A numeric `unit_id: 5` never matches `"5"`.
- **No unit key at all.** No writer produces such a record (the writer rejects the body). It is not a `rejected-unit-key` escape: that signal means a dual-key record, so a reader can tell a planted or tampered record from a malformed one. `computeEscapes` groups it under a null unit, as today: an uncovered observe surfaces as an ordinary `escaped-side-effect` escape with `issue: null` (and `unit_id: null` on reconcile output) when the call is unfiltered, and no unit filter matches it. It is never dropped. Every grant, coverage and conclude filter excludes it because `matchesUnit` is false.
- **A dual-key record blocks conclusion run-wide.** Because a dual-key record surfaces whatever the unit filter is, one planted record makes `verdict conclude` refuse `unreconciled-escape` for every unit in that run. This is deliberate: an unattributable record could belong to any unit, and only a key holder can plant one. The record is frozen, so the run cannot be concluded; the operator remedy is to revoke the producer whose key signed it and re-run the work under a fresh run directory. The PR description states this remedy.
- **The compatibility read is permanent.** Frozen records are immutable, so the accessor's `issue` path stays for as long as any frozen record exists. "Removing the alias" in a later release means the `--issue` CLI flag and the `issue` output field only, never the accessor's `issue` path.
- **Missing comparand.** `matchesUnit(rec, undefined)` is false for every record, including a record with no unit key.
- **The admission record.** Carries `unit_id: "-"` on new runs and `issue: "-"` on frozen runs; `"-"` is a string, so it resolves, and no reader queries it as a unit.

**Anti-pattern:** normalising the key inside `readLedgerEntries` or `parseGovernedRecord` by writing a derived `unit_id` onto the parsed record. Those parsers preserve fields verbatim so the signed image stays byte-identical for `verifyAuthLeg`; a derived field breaks authentication.

**Failure modes.**

- **A reader is missed.** A `unit_id`-only record is not resolved. For grants that shows as a refused merge on a run that should pass (loud); for `computeEscapes`, a spurious escape; for `readDeclaredMergeEffects` in merge-gate, a duplicate `schema:2` auto-declare. The guard is the per-reader `unit_id` test in section 9.
- **A stale emit.** The CI `typecheck` job rebuilds each `.ts` emit and runs `git diff --exit-code`. Rebuild with `cd plugin/skills/faff && npm run build` and commit `commissaire.js`.
- **A denylisted module reaches the standalone binary.** `test/commissaire-standalone.test.mjs` fails with "denylisted orchestration modules are reachable". Keeping the accessor in `effects.js` adds no require edge.
- **The compatibility read is never exercised.** `audit verify` passes over the frozen fixture without reading the key, so it proves nothing about the accessor. Section 6 adds semantic-reader checks over the fixture.

## 6. Scenarios

```
Given a new governed run minted by the renamed writer (admit, effect declare/authorize/observe --unit-id U --step merge)
When I read every schema:3 record in its ledger
Then each carries unit_id, none carries issue, and step is unchanged
```

```
Given a scratch copy of the frozen fixture test/fixtures/commissaire/secret-free-replay
When resolveCommissaireDecisionGrant(copy, "FAFF-1", "main") runs
Then it returns "valid-grant", resolving the issue-keyed verdict at seq 3 through the compatibility read
```

```
Given a scratch copy of the frozen fixture
When I run `commissaire verdict conclude --run-dir <copy> --unit-id FAFF-1`
Then it exits 0 with verdict "refused" and reason "producer-not-admitted" (the fixture ships no producer admission file), which shows the unit filter found FAFF-1's records
And the same command with --unit-id FAFF-2 refuses with reason "no-evidence"
And the refusal output carries issue and unit_id, both "FAFF-1"
```

```
Given the frozen fixture in place
When the fixture-reading tests have run
Then every fixture file's sha256 is unchanged and `commissaire audit verify --run-dir <fixture>` still exits 0 with result "pass"
```

```
Given a governed run admitted for producer P1, with a declare for (U, merge)
When a dual-key declare { issue: "A", unit_id: "B" } is planted in the ledger, correctly chained and HMAC-signed under P1's key
Then `effect authorize --unit-id U --step merge` is denied with reason "invalid-unit-key"
And `effect reconcile` reports any_escape true with exactly one "rejected-unit-key" escape for that record
And `verdict conclude --unit-id U` refuses with "unreconciled-escape"
And `audit verify` still passes, because the planted record is authentic
```

```
Given a request record carrying both issue and unit_id, signed with the producer's derived key
When evaluateDecisionRequest evaluates it against a ledger holding a matching declare
Then the verdict is deny with reason "invalid-unit-key"
```

```
Given a dual-key effect-decision-verdict signed with the run's governor key as the only verdict for (U, merge)
When resolveCommissaireDecisionGrant(runDir, U, "main") runs
Then it returns "absent-or-invalid"
```

```
Given a caller invoking `effect declare` with --issue U
When the command runs
Then it behaves exactly as --unit-id U and writes one deprecation line to stderr
And a caller passing both --issue and --unit-id gets exit 2 and no ledger write
```

```
Given a ledger holding schema:2 rows (issue) and schema:3 rows (unit_id) for the same unit and step
When computeEscapes runs over the whole file
Then both resolve to the same group, and a schema:3 declare covers a schema:2 observe
```

## 7. Design decision rationale

**Accessor home and form.** Options: a pure accessor applied at each match site, or normalising the key at the parse boundary. The parse-boundary option either preserves fields verbatim (and changes nothing) or adds a derived field (and breaks authentication). **Chosen:** the pure accessor in `effects.js`, as stated in section 4.

**Dual-key handling.** Options: let `unit_id` win; resolve agreeing values and fail on conflict (round 1); reject any dual-key record. **Chosen:** reject on presence, with strict comparison against a resolved string comparand, as stated in section 5. Round 1's middle option resolved a conflict to `undefined` and compared with loose equality, so a conflicting request and a conflicting declare matched each other and passed coverage.

**Coercion.** Options: coerce primitives to strings (round 1) or accept strings only. **Chosen:** strings only. Every shipped schema types the unit as a string, and the pre-change code compared with `===`, so coercion widened the match surface for no benefit (fixes the round-1 infosec minor).

**A lexical lint against direct key reads.** The round-1 methodology lens suggested a lint rejecting any `.issue` read outside the accessor. **Chosen:** no lint; a behavioural test per reader instead. Rationale: the same files legitimately read `.issue` on `events.jsonl` records (`audit.js`), on commit segments (`effects-reconcile.js`) and on `schema:2` progress records (`effects.js`), so a lexical lint needs an allowlist that is itself the manual census it was meant to replace. The per-reader tests in section 9 fail if any reader stops resolving `unit_id`.

**Writer fallback.** Options: accept `issue` in the body for one release (round 1), or reject it. **Chosen:** reject, as stated in section 4.

**Rejected: renaming `step` to `stage`.** `stage` implies an ordered lifecycle phase and under-describes the effect-operation values. Addendum decision 6 keeps `step`.

## 8. Open questions and assumptions

**Open questions.** None. Every decision above is closed with a `**Chosen:**` marker; five of them restate decisions the human recorded on the ticket on 2026-10-05.

**Assumptions.** None blocking. FAFF-1170 (the TypeScript conversion) and FAFF-1171 (the emit-freshness CI job) are on `origin/main`, checked at `b02fac1b`.

## 9. DONE: definition of done

### Writer
- [ ] `buildEnvelope` emits `unit_id` and no `issue`; `schema` is 3; `step` is unchanged.
- [ ] The body types in `buildEnvelope`, `appendProducerRecords` and `appendCommissaireRecord` declare `unit_id?: unknown` and no `issue`.
- [ ] A body carrying `issue`, carrying both keys, or lacking a non-empty string `unit_id` throws a `TypeError` before the ledger is touched (test asserts the ledger bytes are unchanged).
- [ ] Every in-repo body builder (`cmdAdmit` with `unit_id: "-"`, `cmdProducerLedger`, `cmdRequestDecision` request and verdict bodies, `cmdTerminalVerdict`) uses `unit_id`.

### Accessor
- [ ] `effects.js` exports `unitIdOf`, `matchesUnit` and `carriesBothUnitKeys`; unit tests cover: `unit_id` only, `issue` only, both keys with equal values (null), both with different values (null), neither (null), numeric and boolean values (null), empty string (null), `matchesUnit(rec, undefined)` false for a record with no unit key, and `matchesUnit({unit_id: 5}, "5")` false.

### Readers (one `unit_id`-keyed test and one legacy `issue`-keyed test each)
- [ ] `evaluateDecisionRequest`: freshness and coverage resolve on `unit_id`; legacy `issue`-keyed in-memory records still grant (the existing tests at `test/commissaire.test.mjs` around line 209 keep passing unchanged).
- [ ] `verdict conclude`, `effect reconcile`, `resolveGrantByEffectKind` and its five wrappers, both `readDeclaredMergeEffects` functions, `computeEscapes`, `accountHumanMerge` and `segmentCovered` resolve `unit_id` records.
- [ ] A `schema:3` `unit_id` declare covers a `schema:2` `issue` observe for the same unit and step in `computeEscapes`.

### Dual-key rejection (the planted negative tests)
- [ ] The CLI dual-key scenario in section 6 passes: authorize denied `invalid-unit-key`, reconcile reports one `rejected-unit-key` escape, conclude refuses `unreconciled-escape`, audit verify passes.
- [ ] The pure-core scenario passes: a signed dual-key request is denied `invalid-unit-key`, and a signed dual-key request whose effect kind is also out of scope is denied `invalid-unit-key`, not `effect-out-of-scope` (pins the leg order).
- [ ] The grant-resolver scenario passes: a governor-signed dual-key verdict resolves `absent-or-invalid`.
- [ ] Two dual-key records at the same step (one declare, one observe) produce two separate `rejected-unit-key` escapes, each with `issue: null` and `escaped: [its effect]`, and the dual-key declare covers no observation.
- [ ] A record with no unit key produces no `rejected-unit-key` escape; an uncovered no-unit observe surfaces as `escaped-side-effect` with `issue: null`.
- [ ] `bundle-recover.js` `foldEscapesIntoPlan` parks a `rejected-unit-key` escape as an `issue: null` park entry (a test pins the inherited behaviour).

### Frozen records
- [ ] The three frozen-fixture scenarios in section 6 pass on a scratch copy: `valid-grant` for FAFF-1, conclude refusal `producer-not-admitted` for FAFF-1 and `no-evidence` for FAFF-2, and sha256 of every fixture file unchanged after the tests run.
- [ ] No file under `test/fixtures/`, `verification/` or `.faff/anchors/` is modified by the PR (`git diff --stat origin/main` lists none).
- [ ] The `governance-check` workflow passes: every committed anchor still verifies and reconciles.

### CLI
- [ ] `--unit-id` works on `effect declare`, `effect authorize`, `effect observe`, `effect reconcile`, `verdict conclude` and `audit anchor`.
- [ ] `--issue` alone behaves identically and writes exactly one deprecation line to stderr, tested on `effect declare`, `verdict conclude` and `audit anchor`; both flags together exit 2 with no ledger write, tested with equal and with different values.
- [ ] `REQUIRED_FLAGS_BY_CANONICAL` names `--unit-id`; `COMMISSAIRE_SPEC.flags` lists `--unit-id` and `--issue`; usage text and error messages name `--unit-id`.
- [ ] JSON output carries both `issue` and `unit_id` with the same value on conclude (accepted, idempotent, refused), audit anchor, and every reconcile escape.

### Callers and documentation
- [ ] faff's own callers use `--unit-id`: `plugin/skills/faff-graft/SKILL.md` and `plugin/skills/faff-beep-boop/SKILL.md` (the `faff commissaire` invocations), and the `audit anchor` selftest spawn in `commissaire.ts`.
- [ ] `docs/guide/cli.md`, `docs/guide/commissaire-reuse.md` and `docs/guide/verify-run-evidence.md` name `--unit-id` and note `--issue` as the deprecated alias for one release.

### Build and CI
- [ ] `npm run build` in `plugin/skills/faff` regenerates `commissaire.js`; the CI `typecheck` job (type check plus emit freshness) passes.
- [ ] `faff regions check` passes, and `test/commissaire-standalone.test.mjs` (the import-independence guard) passes.
- [ ] `scripts/check-no-boundary-cast.mjs` passes.
- [ ] `test/commissaire.test.mjs`, `test/commissaire-malformed-parity.test.mjs`, `test/commissaire-standalone.test.mjs`, `test/commissaire-admit-required.test.mjs` and `test/commissaire-facade-spec.test.mjs` (still against v0.1) pass, as does `faff commissaire --selftest` and `faff effects --selftest`.
- [ ] The CLI documentation guards pass (`cli-surface`, `lint-cli-doc`, `lint-cli-coverage`), and the full `npm test` suite is green.
- [ ] `test/impure/commissaire-bare-claude.test.mjs` (the FAFF-360 harness) passes unchanged.

### Eval coverage
- [ ] No LLM-judgement seam is introduced or changed, so no grader, eval case or seam-registry row is needed.

### Hand-off to FAFF-1175
- [ ] The PR description lists the live shapes v0.2 must publish: `unit_id` on every new record, `unit_id` beside `issue` on reconcile escapes, the `rejected-unit-key` escape signal with `issue: null` and an `escaped` array that may be empty, the `invalid-unit-key` deny reason, and the dual-field conclude and anchor outputs. It also names two follow-ups: FAFF-1175 must bump the FAFF-360 harness driver pin (`EXPECTED` in `test/impure/commissaire-bare-claude.test.mjs`) past this merge before `verify-commissaire.mjs` passes `--unit-id`, and FAFF-1173's "lands before FAFF-1167" sentence is stale.
- [ ] The PR description carries the rollback note from section 2.

confidence: high
build-tier: complex


## Methodology critique

*Methodology: faffter-dark-methodology-agile-delivery (agile delivery lens), issue-critique for FAFF-1167 against spec revision 2, checked at `origin/main` `b02fac1b`. Advisory; it does not gate a high-confidence promotion.*

**Right-sized?** The 2026-10-05 split answers the round-1 objection. The facade v0.2 and the external consumer now sit in FAFF-1175, and what is left is one change: the writer and its readers have to agree on the key. The remaining scope is still at the top of the 1 to 3 day range: about ten readers, two new signals (`invalid-unit-key`, `rejected-unit-key`), CLI normalisation, dual-field output, and three guides plus two skills. It has a natural seam: the accessor, the reader migration and the dual-key rejection change nothing on today's records, while the writer flip, the CLI flag and the output fields need that first part in place. Keep one ticket, but land the readers-first half as its own commit (now a closed decision in section 2).

**Workstream fit?** No issues.

**Deps surfaced?**
- FAFF-1173 says it must land before FAFF-1167, but the tracker marks it only as related, and `commissaire.ts` is already on main from FAFF-1170. Section 2 now records that the "rename in TypeScript" condition holds and flags FAFF-1173's stale sentence for a human tidy.
- The train's second half needs the FAFF-360 harness driver pin moved past this merge before `verify-commissaire.mjs` passes `--unit-id`. The hand-off list in section 9 now names it.

**Risk profile?** The forward path is well covered: per-reader tests, planted dual-key negatives, and frozen-fixture checks on a scratch copy. Rollback was silent; section 2 now states that a revert fails closed (pre-change readers resolve `unit_id` records to `absent-or-invalid`) and names the operator step. No de-risking spike is needed: the approach is a known expand-and-contract pattern.

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" } ] }
```