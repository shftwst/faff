# FAFF-977 — Secret-free Commissaire replay verification (`commissaire audit verify`)

> Spec: faffter-dark-nlspec · 2026-09-03 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-977.

> Refreshed 2026-09-03 against the post-FAFF-978 tree: FAFF-978 (#828) made the governor file the authoritative source of `PK_commissaire` and added a `pk-fingerprint-tampered` cross-check. The secret-free path is unchanged (no governor file present ⇒ `pk` still resolves from `pk.json`); the corrections below fix the PK-precedence assumption, add the new failure reason, and handle its record-less (`seq: null`) shape.

An external, secret-free replay path for a schema-3 Commissaire ledger. This spec covers ticket FAFF-977, "Expose secret-free Commissaire replay verification for external consumers." It is written for the build agent that implements the command and for human reviewers gating the public JSON contract. The audience should read the JSON output shape (section 3) and the exit-code contract (section 3) as the primary deliverables: a second, non-faff repository will reproduce them by hand.

## 1. WHY — problem and principles

**The mechanism this turns on.** Commissaire already re-authenticates a schema-3 ledger through one pure core, `verifyAuthLeg(runDir, governorDir, producerDir)`, which splits every record into three outcomes: producer HMAC claims it can check with the governor secret, producer claims it cannot check without that secret (`unverifiable`), and Commissaire Ed25519 decisions it can always check from the public key. That three-way split is exactly the external contract a secret-free consumer needs. The whole ticket is a thin, read-only projection of that existing return value onto a stable JSON shape and a documented exit code. No signature or HMAC logic is written or duplicated.

**Problem statement.** Today `verifyAuthLeg` is reachable only through `commissaire --selftest`, which mints and holds the governor secret, so no external actor can replay a published ledger without secret material. That blocks FAFF-360 (the second-consumer demo on a bare non-faff repo), which must verify a Commissaire ledger from published `pk.json` alone. This change exposes a secret-free entry point, `commissaire audit verify`, that replays the authentication result and reports it as a stable structured record.

### Design principles

**Reuse the one core; never write a second verifier.** The command calls `verifyAuthLeg` and projects its result. If the implementation starts computing HMACs or Ed25519 verifications of its own, it has over-scoped. The value of this command as FAFF-360's conformance oracle depends on it being the same authentication logic the rest of Commissaire uses, not a parallel one.

**Never fold unverifiable into a pass.** A producer claim that cannot be checked without the governor secret is not authenticated. It must be reported under `unverifiable_without_secret`, distinct from `verified`. Folding it into a generic pass would let a secret-free consumer believe producer records were authenticated when they were not. This is the property the separate classification buckets exist to protect.

**Fail closed.** When schema-3 Commissaire decisions exist but the public key is missing, or when any decision signature is invalid, the command fails with a non-zero exit. Absence of checkable material is never a silent pass.

**The JSON shape is a public contract, not an implementation detail.** FAFF-360's portable verifier lives in a non-faff repo and cannot import the faff `verifyAuthLeg` module, so it reproduces this command's output by hand and is tested against this command as the oracle. The shape is versioned and deterministic so that reproduction is possible and drift is detectable.

### Reference context

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | JavaScript (Node, zero-dependency) | Holds `verifyAuthLeg`, the flat `cmdCommissaire` dispatcher, `COMMISSAIRE_SPEC` / `COMMISSAIRE_SURFACE`, and every helper this command reuses. All new code lands here. |
| `plugin/skills/faff/bin/lib/cli-surface.js` | JavaScript | Assembles the declared CLI grammar from each module's `*_SURFACE`; its selftest pins classifications. Note its unrelated top-level `audit` positional verb (`faff audit`), distinct from this ticket's `commissaire audit` object. |
| `records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md` | ADR (Proposed) | The grammar this surface lands under. Establishes `commissaire <object> <action>` with `audit {seal, export, verify}`. |
| `test/commissaire.test.mjs` | JavaScript (node:test) | The mint-then-mutate + `runCli` fixture pattern the new tests follow. |
| `docs/guide/cli.md` | Markdown | The one CI-lint-enforced CLI surface doc; the `commissaire` row's synopsis is extended. |

**Scope statement.** This is the external replay seam of the Commissaire facade (FAFF-828, Done): the read-only, secret-free verification entry point that the facade shipped without, sitting under the first `audit`-object slice of the ADR-0123 grammar.

## 2. Out of scope

- **Chain integrity verification.** Excluded. `verifyAuthLeg` replays the authentication leg only; the hash-chain integrity leg is `verifyEffectsChain` in `events.js`. Extension point: a future `audit verify --integrity` (or a companion action) would call `verifyEffectsChain` and fold its result into the same JSON shape.
- **`audit export` and `audit seal` as built actions.** Excluded. Only `audit verify` is built this slice. `seal` remains served by the existing flat `seal-bundle` stub; `export` is unbuilt. Extension point: the `audit` object dispatch branch in `cmdCommissaire`, where new action tokens attach.
- **Re-grammaring `contract` / `effect` / `verdict`.** Excluded; that is FAFF-980 (the full noun-verb re-grouping), sequenced after FAFF-978. This slice introduces only the `audit` namespace and leaves the seven flat verbs exactly as they are. Extension point: `COMMISSAIRE_SURFACE.subcommands` and the `cmdCommissaire` switch.
- **The standalone `commissaire` CLI binary.** Excluded; this command ships under the `faff commissaire` launcher only. Extension point: the diagrams' Phase 2A `commissaire` front-end over the same handlers.
- **Nested-object SURFACE schema.** Excluded. `COMMISSAIRE_SURFACE.subcommands` stays a flat map this slice (see section 3). Extension point: a nested object representation is FAFF-980's concern.
- **Marketplace Action packaging, merge enforcement, a second evidence format.** Excluded per the ticket boundary. No extension point built here.

## 3. WHAT — vocabulary, types, and interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Producer claim | A schema-3 ledger record with `author: "producer"`, HMAC-signed under a key derived from the governor `master_secret`. Checkable only with that secret. |
| Commissaire decision | A schema-3 record with `author: "commissaire"`, Ed25519-signed under `SK_commissaire`. Checkable from the public `pk.json` alone. |
| Secret-free consumer | An actor holding only the ledger (`declared-effects.jsonl`) and the published `pk.json`, never the governor file (which holds `SK`, `master_secret`, and `pk`). |
| Conformance oracle | This command, as the reference whose JSON output FAFF-360's independently-written portable verifier is tested against. |
| Governance context | Whether the run dir carries any schema-3 record, per `hasGovernanceContext(runDir)`. |

### The verify output — the public JSON contract

```
RECORD AuditVerifyOutput:
  version: Integer                 # contract version; 1 for this slice. Bump on any breaking shape change.
  result: "pass" | "fail"          # mirrors verifyAuthLeg.pass: "pass" iff no gating failures
  governance_context: true         # always true when this record is emitted (see exit contract)
  producer_claims:
    verified: Integer              # producer records that authenticated under the secret (secret present only)
    unverifiable_without_secret: Integer   # producer records the secret-free consumer cannot check
    failed: Integer                # producer records that failed authentication (secret present only)
  commissaire_decisions:
    verified: Integer              # decisions that verified under pk.json
    failed: Integer                # decisions that failed (bad/absent pk, or tampered signature)
  pk_fingerprint: String | null    # pk.json's pk_fingerprint, so a consumer can pin the key; null if pk.json absent
  ledger_failures: List<{ reason: String }>   # ledger-level failures carrying no record seq (verifyAuthLeg failures with seq==null, e.g. pk-fingerprint-tampered); [] on the pure secret-free path
  records: List<RecordClassification>   # one per schema-3 entry, in ledger (seq) order

RECORD RecordClassification:
  seq: Integer
  author: "producer" | "commissaire"
  kind_of_entry: String            # e.g. "declare", "effect-decision-verdict"
  classification: "verified" | "unverifiable_without_secret" | "failed"
  reason: String | null            # verbatim from verifyAuthLeg for non-verified; null when verified

  CONSTRAINT commissaire_decisions has no "unverifiable_without_secret" bucket
             (a public-key decision is always checkable)
```

The `records` array and both count blocks are pure projections of one `verifyAuthLeg` call plus one `readLedgerEntries` scan. Output is deterministic: records follow ledger order, counts follow from classifications. This entire record is the cross-boundary contract; treat field names and the `version` integer as stable.

**Chosen:** output shape as above, with a top-level integer `version: 1`. The `version` field lets FAFF-360's portable verifier pin the contract and lets a fixture snapshot detect drift. Rationale in section 6.

### The three-way classification mapping

Every schema-3 entry classifies from the single `verifyAuthLeg` return `{ pass, failures: [{seq, reason}], unverifiable: [{seq, reason}] }`:

| Entry | In `unverifiable` | In `failures` | Otherwise |
|---|---|---|---|
| `author: "producer"` | `unverifiable_without_secret` | `failed` | `verified` |
| `author: "commissaire"` | (never occurs) | `failed` | `verified` |

**Chosen:** classify by seq membership in `verifyAuthLeg`'s `unverifiable` and `failures` lists; verified is the residual. No record is checked twice, because `verifyAuthLeg` pushes each entry to at most one list. Rationale in section 6.

### CLI surface

```
commissaire audit verify --run-dir DIR [--governor-dir D] [--producer-dir D] [--json]
```

Exposed via the `faff` alias `faff commissaire audit verify`. All four flags already exist in `COMMISSAIRE_SPEC`; no new flag is added. `--governor-dir` and `--producer-dir` are pass-through overrides to `verifyAuthLeg`; a secret-free consumer supplies neither and the defaults resolve to `<run-dir>/commissaire/{governor,producer}`.

**Grammar registration.** Add `"audit verify"` as a compound key to `COMMISSAIRE_SURFACE.subcommands` (mirroring how `request-decision` is a single hyphenated key), keeping the subcommands map flat. Route it by adding an `audit` branch to the `cmdCommissaire` switch that dispatches on the action token (`rest[1]`). The seven flat verbs stay untouched as working commands (they are their own implementations, not yet aliases to object forms).

**Chosen:** represent `audit verify` as one compound subcommand key on the existing flat `COMMISSAIRE_SURFACE.subcommands` map, and dispatch via an `audit`-token branch in `cmdCommissaire`. This keeps the SURFACE schema unchanged (bijection and pinned-classification selftests in `cli-surface.js` still hold), introduces the `audit` namespace with `verify` as its only built action, and leaves the nested-object SURFACE representation to FAFF-980. `audit seal` and `audit export` are not wired this slice: an unknown `audit` action falls through to the usage error, and `seal-bundle` remains the working flat verb. Rationale in section 6.

**Anti-pattern:** re-labelling `admit` → `contract admit`, `request-decision` → `effect authorize`, and so on this slice. Why: that is FAFF-980's re-grammar; doing it here exceeds the ticket boundary and risks colliding with FAFF-978, which is in review on this same surface.

### Exit-code contract

| Exit | Meaning | Trigger |
|---|---|---|
| 0 | Valid decisions, honest producer classification | `verifyAuthLeg.pass` is true and a governance context exists |
| 1 | Verification failure | Any `verifyAuthLeg` failure (`auth.pass` false): a `failed` record classification (invalid/absent-key Commissaire decision, or a failed producer claim when the secret is present), or a ledger-level failure such as `pk-fingerprint-tampered` |
| 2 | Invalid invocation or setup | Missing/non-directory `--run-dir`, or no schema-3 governance context in the run dir |

**Chosen:** exit 0/1/2 as above, with setup failures mapped to 2. This diverges deliberately from the sibling facade verbs, which return 3 for a missing run dir (`requireRunDir` in commissaire.js). `audit verify` follows the exit contract the ticket documents (0/1/2), because that contract is part of the public oracle FAFF-360 reproduces; it does not reuse the legacy exit-3 convention. Rationale in section 6.

**Chosen:** a run dir with no schema-3 record (governance context absent) exits 2, not 0. Verifying a run with nothing to replay is a setup error; emitting a `pass` there would mislead a consumer into believing an ungoverned run was authenticated. Rationale in section 6.

**Chosen:** always print the JSON contract to stdout on the 0 and 1 paths; `--json` is accepted for surface symmetry with the other verbs but does not gate output. The command is a machine oracle first, and every sibling verb already prints JSON unconditionally. On exit 2, nothing is printed to stdout (the diagnostic goes to stderr), so a consumer never parses a partial contract. Rationale in section 6.

## 4. HOW — behaviour

### Architecture

One new handler function in `commissaire.js`, reachable via the `audit` branch of `cmdCommissaire` (`rest[0] === "audit"`, dispatch on `rest[1]`). The handler validates setup, calls `verifyAuthLeg` once, projects the result, prints JSON, and returns the exit code. It reuses `requireRunDir`-style validation (but maps failure to exit 2, not 3), `hasGovernanceContext`, `readLedgerEntries`, `readJson`, `pkFileOf`, and `producerDirOf`, all already exported in the module.

### The verify procedure

**Summary.** Validate the run dir and that it carries a governance context, replay the auth leg once, classify every schema-3 record against that single result, emit the versioned JSON, and exit on `pass`.

```
PROCEDURE audit_verify(flags):
  1. runDir = flags["--run-dir"]
     IF runDir absent OR not an existing directory:
        write diagnostic to stderr
        RETURN 2
  2. IF NOT hasGovernanceContext(runDir):
        write "no schema-3 governance context in <runDir>" to stderr
        RETURN 2
  3. auth = verifyAuthLeg(runDir, flags["--governor-dir"], flags["--producer-dir"])
     # the ONE core call; no signature or HMAC logic is written here
  4. ledgerFailures = [ { reason } for each auth.failures[i] WHERE seq == null ]   # record-less failures (FAFF-978: pk-fingerprint-tampered)
     failBySeq  = map each auth.failures[i] WHERE seq != null:  seq -> reason
     unverBySeq = map each auth.unverifiable[i].seq -> reason
  5. entries = readLedgerEntries(runDir) keep only those with schema == 3
  6. records = []
     FOR each e in entries (ledger order):
        IF e.author == "producer":
           IF e.seq in unverBySeq: cls = "unverifiable_without_secret"; reason = unverBySeq[e.seq]
           ELSE IF e.seq in failBySeq: cls = "failed"; reason = failBySeq[e.seq]
           ELSE: cls = "verified"; reason = null
        ELSE IF e.author == "commissaire":
           IF e.seq in failBySeq: cls = "failed"; reason = failBySeq[e.seq]
           ELSE: cls = "verified"; reason = null
        append { seq: e.seq, author: e.author, kind_of_entry: e.kind_of_entry, classification: cls, reason }
  7. counts = tally records by author and classification
  8. pkRec = readJson(pkFileOf(producerDirOf(runDir, flags["--producer-dir"])))
     fingerprint = pkRec ? pkRec.pk_fingerprint : null
  9. out = {
        version: 1,
        result: auth.pass ? "pass" : "fail",
        governance_context: true,
        producer_claims: { verified, unverifiable_without_secret, failed },
        commissaire_decisions: { verified, failed },
        pk_fingerprint: fingerprint,
        ledger_failures: ledgerFailures,
        records,
     }
     print JSON(out) to stdout
  10. RETURN auth.pass ? 0 : 1
```

A `seq == null` failure (only `pk-fingerprint-tampered` today) makes `auth.pass` false — so `result: "fail"`, exit 1 — but matches no ledger record, so it is surfaced under `ledger_failures` rather than dropped. It cannot occur on the pure secret-free path: `verifyAuthLeg` only runs the fingerprint cross-check when BOTH a governor file and `pk.json` are present, and a secret-free consumer supplies no governor file. It becomes reachable only if a consumer passes `--governor-dir` at a run whose `pk.json` fingerprint disagrees with the governor's.

### Why the secret-free path never touches producer admission files

`verifyAuthLeg` checks a producer record's admission status (revoked/unadmitted) only after it has confirmed the governor `master_secret` is present; when the secret is absent, it pushes the record to `unverifiable` and moves on before reading any producer admission file (the master-secret gate short-circuits ahead of the `producerFileOf` admission read). A secret-free consumer therefore never depends on files it does not have. This ordering is a correctness property the fixture test guards, not an accident.

### Edge cases

- **`pk.json` present, Commissaire decisions present, signatures valid:** decisions classify `verified`; producer records classify per secret availability. `result: "pass"`, exit 0.
- **`pk.json` absent, Commissaire decisions present:** `verifyAuthLeg` resolves `pk` to null and every decision fails `verifyDecision`, classifying `failed` with reason `commissaire-sig-invalid`. `result: "fail"`, exit 1. This is the fail-closed-on-missing-key path, satisfied by the existing core behaviour, not new code.
- **Tampered Commissaire decision:** payload mutated after signing, `verifyDecision` fails, `failed` / `commissaire-sig-invalid`, exit 1.
- **Only producer records, no secret, no Commissaire decisions:** all producer records `unverifiable_without_secret`; `commissaire_decisions.verified == 0`. `verifyAuthLeg.pass` is true (no gating failures), so `result: "pass"`, exit 0. This is honest: nothing failed, nothing was silently treated as authenticated.
- **Both governor and `pk.json` present, fingerprints disagree (a consumer passing `--governor-dir`):** `verifyAuthLeg` emits a `{ seq: null, reason: "pk-fingerprint-tampered" }` failure (FAFF-978), so `result: "fail"`, exit 1, with the reason surfaced under `ledger_failures`. This never fires on the pure secret-free path: a secret-free consumer supplies no governor file, so the cross-check is skipped.
- **Malformed ledger line:** `readLedgerEntries` already drops unparseable lines. Line-level integrity is the chain leg's concern (out of scope here), so a dropped line does not fail the auth projection.

### Failure modes

- **The failure:** a future refactor reorders `verifyAuthLeg` so the producer admission check runs before the master-secret gate. The secret-free path would then try to read absent producer admission files and could misclassify or throw. **How you'd know:** the checked-in secret-free fixture test would show producer records as `failed` or the command erroring, instead of `unverifiable_without_secret`. **What it means:** hold the master-gate-first ordering; the fixture test is the guard, so keep it.
- **The failure:** the JSON shape drifts (a renamed field, a dropped bucket) without a `version` bump, and FAFF-360's independently-written portable verifier silently diverges from the oracle. **How you'd know:** the fixture's expected-output snapshot in the test suite fails on the changed field. **What it means:** the `version` field plus the pinned fixture snapshot are the drift detector; a real shape change bumps `version` and updates FAFF-360.
- **The failure:** `unverifiable_without_secret` is quietly counted toward a pass-looking `verified` total by a well-meaning simplification. **How you'd know:** the "never fold unverifiable" assertion (section 5) fails: a secret-free run reports `producer_claims.verified > 0`. **What it means:** the separate buckets are the security property; keep them separate.

## 5. Scenarios

```
Given a checked-in run dir with declared-effects.jsonl and commissaire/producer/pk.json but NO governor file
When `faff commissaire audit verify --run-dir FIXTURE` runs
Then exit code is 0
And result is "pass"
And producer_claims.unverifiable_without_secret is greater than 0
And commissaire_decisions.verified is at least 1
And producer_claims.failed is 0
```

```
Given a freshly minted run (admit → declare → request-decision) WITH its governor file present
When `commissaire audit verify --run-dir RUN` runs
Then exit code is 0
And result is "pass"
And producer_claims.verified is greater than 0
And commissaire_decisions.verified is at least 1
```

```
Given a run with Commissaire decision records whose commissaire/producer/pk.json has been removed
When `commissaire audit verify --run-dir RUN` runs
Then exit code is 1
And result is "fail"
And the Commissaire decision is classified "failed" with reason "commissaire-sig-invalid"
```

```
Given a run whose Commissaire decision payload has been mutated after signing
When `commissaire audit verify --run-dir RUN` runs
Then exit code is 1
And result is "fail"
And that decision is classified "failed"
```

```
Given a minted run WITH its governor secret present, whose producer HMAC on one record has been mutated after signing
When `commissaire audit verify --run-dir RUN` runs
Then exit code is 1
And result is "fail"
And producer_claims.failed is greater than 0
And that record is classified "failed" with reason "producer-auth-mismatch"
```

```
Given a run supplied with --governor-dir whose governor pk_fingerprint disagrees with the producer-dir pk.json
When `commissaire audit verify --run-dir RUN --governor-dir G` runs
Then exit code is 1
And result is "fail"
And ledger_failures contains an entry with reason "pk-fingerprint-tampered"
```

```
Given a --run-dir that points to a directory with no schema-3 records
When `commissaire audit verify --run-dir DIR` runs
Then exit code is 2
And nothing is written to stdout
And a diagnostic is written to stderr
```

```
Given a --run-dir that does not exist
When `commissaire audit verify --run-dir MISSING` runs
Then exit code is 2
And nothing is written to stdout
```

Grammar and alias objectives, as assertions:

- The invocation `commissaire audit verify` routes to the verify handler.
- All seven existing flat verbs (`admit`, `declare`, `observe`, `request-decision`, `reconcile`, `terminal-verdict`, `seal-bundle`) still run unchanged, with their existing exit codes.
- `cli-surface --selftest` still passes (SURFACES stays in bijection with COMMANDS, pinned classifications hold).
- A secret-free run with producer claims and no governor secret reports those claims under `producer_claims.unverifiable_without_secret` and never under `producer_claims.verified`.

## 6. Design decision rationale

**Reuse `verifyAuthLeg` or write a fresh verifier for the external path?** A fresh verifier would let the output shape be designed without the core's constraints, but it would be a second, divergable implementation of the authentication logic, and the command's whole value as FAFF-360's oracle rests on it being the same logic. **Chosen:** reuse `verifyAuthLeg` and project its return; write no signature or HMAC code.

**How to shape the JSON output?** A flat `{pass, failures, unverifiable}` echo of the core return would be least work, but it hides the "verified" set, does not separate producer from Commissaire, and carries no version. **Chosen:** the versioned `AuditVerifyOutput` record with separate `producer_claims` (three buckets) and `commissaire_decisions` (two buckets), plus a per-record `records` array. The `version: 1` integer makes the contract pinnable and drift detectable, which the independently-written portable verifier needs.

**How to derive the three-way classification?** Re-running verification per record would duplicate the core; parsing reasons with string heuristics would be brittle. **Chosen:** classify by seq membership in the single `verifyAuthLeg` return's `unverifiable` and `failures` lists, with verified as the residual, safe because the core assigns each entry to at most one list.

**Which exit codes?** Reusing the sibling verbs' exit 3 for a missing run dir would be internally consistent but contradicts the ticket's documented 0/1/2 contract, which is itself part of the public oracle. **Chosen:** 0 valid, 1 verification failure, 2 invalid invocation/setup; setup failures map to 2, deliberately diverging from the legacy exit-3 sibling convention.

**What should an ungoverned run (no schema-3 records) return?** Exit 0 with an empty pass would be simplest but misleads a consumer into reading an ungoverned run as authenticated. **Chosen:** exit 2 (setup error), because there is no authentication result to replay.

**How to register the grammar?** A full nested-object SURFACE schema would match the ADR's end state but exceeds this slice and risks colliding with FAFF-978/FAFF-980. **Chosen:** a compound `"audit verify"` key on the existing flat subcommands map plus an `audit`-token dispatch branch; nested representation deferred to FAFF-980.

**Should `--json` gate output?** Gating would match a strict flag reading, but the command is a machine oracle and every sibling prints JSON unconditionally. **Chosen:** always print the contract JSON on the 0/1 paths; accept `--json` for symmetry; print nothing to stdout on exit 2.

**Where does the secret-free fixture live and what is in it?** Minting at test time (the existing pattern) exercises the code but ships nothing a second consumer can point at, and FAFF-360 needs a checked-in artifact. **Chosen:** a checked-in fixture under `test/fixtures/commissaire/secret-free-replay/` containing a run dir with `declared-effects.jsonl` and `commissaire/producer/pk.json`, and no governor file. It is generated once by minting a run then deleting the governor directory (sanitized), and committed. The test also mints a live run to exercise the secret-present path.

## 7. Open questions and assumptions

### Open questions

None. Every decision above is closed.

### Assumptions

- **Assumes:** `verifyAuthLeg(runDir, governorDir, producerDir)` exists in `commissaire.js` with the `{ pass, failures: [{seq, reason}], unverifiable: [{seq, reason}] }` return, resolving `pk` from the governor file when present (the authoritative source per FAFF-978) and falling back to the producer-dir `pk.json` only when no governor material is present — which is exactly the secret-free consumer's case — and short-circuiting producer records to `unverifiable` before the admission-file read. When both a governor file and `pk.json` are present it additionally cross-checks their fingerprints and, on a mismatch, pushes a record-less `{ seq: null, reason: "pk-fingerprint-tampered" }` failure (FAFF-978). Validate: read the whole `verifyAuthLeg` body before building; the projection depends on this return contract, the governor-first pk precedence, and the record-less failure shape.
- **Assumes:** the reason tokens `no-master`, `commissaire-sig-invalid`, `producer-auth-mismatch`, and `producer-not-admitted` are the tokens `verifyAuthLeg` emits and are surfaced verbatim in `records[].reason`. Validate: grep commissaire.js for these strings; do not invent new tokens or rewrite the core.
- **Assumes:** ADR-0123 remains the governing grammar decision. Its status stays `Proposed`; advancing it to `Accepted` is a governance step and is not required by this build.
- **Assumes:** the flat `COMMISSAIRE_SURFACE.subcommands` map and the `cli-surface.js` bijection/pinned-classification selftest tolerate a compound `"audit verify"` key. Validate: run `faff cli-surface --selftest` after wiring, expecting PASS.

## 8. DONE — definition of done

### From WHY
- [ ] `commissaire audit verify --run-dir DIR` replays authentication from `pk.json` alone, with no governor or producer secret and no `--selftest`.
- [ ] No signature or HMAC verification logic is added; the handler calls `verifyAuthLeg` exactly once and projects its result.

### From WHAT (types and interfaces)
- [ ] Output matches the `AuditVerifyOutput` record: `version: 1`, `result`, `governance_context: true`, `producer_claims` with three buckets, `commissaire_decisions` with two buckets, `pk_fingerprint`, `ledger_failures`, and a `records` array in ledger order.
- [ ] `commissaire_decisions` never carries an `unverifiable_without_secret` bucket.
- [ ] Producer records classify per the three-way mapping table; Commissaire records classify verified/failed.
- [ ] `pk_fingerprint` is read from `pk.json`'s `pk_fingerprint`, or null when `pk.json` is absent.
- [ ] `ledger_failures` carries every `verifyAuthLeg` failure with `seq: null` (e.g. `pk-fingerprint-tampered`); those failures also drive `result: "fail"` and exit 1 and are never silently dropped from the projection.
- [ ] `"audit verify"` is registered as a subcommand of `COMMISSAIRE_SURFACE`; `faff cli-surface --selftest` passes.
- [ ] The seven flat verbs are unchanged and still dispatch and exit exactly as before.

### From HOW (behaviour)
- [ ] `commissaire audit verify` and `faff commissaire audit verify` both reach the verify handler via the `audit` dispatch branch.
- [ ] On a valid governed run, exit 0 and `result: "pass"`, JSON on stdout.
- [ ] On any `failed` classification, exit 1 and `result: "fail"`, JSON on stdout.
- [ ] On a missing/non-directory `--run-dir` or an ungoverned run, exit 2, nothing on stdout, diagnostic on stderr.
- [ ] Missing `pk.json` with Commissaire decisions present yields `failed` / `commissaire-sig-invalid` and exit 1.
- [ ] A tampered Commissaire decision yields `failed` and exit 1.

### From HOW (edge cases and ordering)
- [ ] A producer-only, secret-free run reports those records under `unverifiable_without_secret`, `result: "pass"`, exit 0.
- [ ] The secret-free path never reads producer admission files (guarded by the fixture test asserting `unverifiable_without_secret`).

### From scope and docs
- [ ] `docs/guide/cli.md`'s `commissaire` row synopsis mentions `audit verify` and its 0/1/2 exit semantics; the CLI-doc lint passes.
- [ ] The `usage()` string in commissaire.js lists `audit verify`.

### Fixtures and tests
- [ ] A checked-in secret-free fixture exists at `test/fixtures/commissaire/secret-free-replay/` (ledger plus `pk.json`, no governor file).
- [ ] `test/commissaire.test.mjs` covers: the secret-free fixture replay (exit 0, buckets as specified), a live minted secret-present run (producer `verified > 0`), missing-`pk.json` fail-closed (exit 1), tampered Commissaire decision (exit 1), a tampered producer HMAC on a secret-present run (`producer_claims.failed > 0`, exit 1, reason `producer-auth-mismatch`), a governor-plus-`pk.json` fingerprint mismatch (`--governor-dir` supplied, exit 1, `ledger_failures` carries `pk-fingerprint-tampered`), ungoverned run (exit 2), and the "never fold unverifiable" assertion.

### Integration smoke test

```
1. mkdtemp a root; runCli commissaire admit --run-dir RUN --producer P1 --contract-revision r1 --scope merge
2. runCli commissaire declare ... ; runCli commissaire request-decision ...  (produces a Commissaire decision)
3. copy RUN to a sanitized dir; delete <sanitized>/commissaire/governor
4. runCli commissaire audit verify --run-dir <sanitized>
   EXPECT exit 0, stdout JSON with version==1, result=="pass",
          producer_claims.unverifiable_without_secret > 0, commissaire_decisions.verified >= 1
5. delete <sanitized>/commissaire/producer/pk.json ; re-run verify
   EXPECT exit 1, result=="fail", a record classified "failed" / "commissaire-sig-invalid"
```

## Appendix A — reason token catalogue

Tokens sourced from `verifyAuthLeg`, surfaced verbatim under `records[].reason` (record-level) or `ledger_failures[].reason` (the ledger-level `seq: null` row):

| Token | Classification | Meaning |
|---|---|---|
| `no-master` | `unverifiable_without_secret` | Governor secret absent, so the producer HMAC cannot be checked. |
| `producer-auth-mismatch` | `failed` | Secret present, producer HMAC did not verify. |
| `producer-not-admitted` | `failed` | Secret present, producer admission revoked or absent. |
| `commissaire-sig-invalid` | `failed` | Decision signature did not verify against the resolved `pk`. |
| `pk-fingerprint-tampered` | `failed` (ledger-level, `seq: null`) | Both a governor file and the producer-dir `pk.json` are present and their `pk` fingerprints disagree; surfaced under `ledger_failures`, not `records` (FAFF-978). |

confidence: high
build-tier: complex
spec-review: approve
