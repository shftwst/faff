# FAFF-1178: Verify Commissaire grants against the governor keys pinned in the trust file

> Spec: faffter-dark-nlspec · 2026-10-12 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-1178.

Revised on 2026-10-12 after four adversarial spec-review rounds (architectural, infosec, QA): binds every key to the seq-0 admission for both custodies, binds records to the run directory, requires the effect target, keys applicability on governance material, and defaults `audit verify` to the remote trust read. Final verdict: approve.

Amended on 2026-10-12 during the build (operator decision, option 3): the run id that records are bound to is an explicit input, defaulting to the run directory's basename. `audit verify` derives it from an anchor path and accepts `--run-id`, so committed anchors and the frozen fixture verify while the copied-admission check stays in every reader.

This spec is for the build agent and human reviewers of FAFF-1178. It defines the one grant-verify function Commissaire exports from the governance region, the change to `verifyAuthLeg`, and the new fields in `audit verify`. FAFF-1212 (faff's `merge-gate`, pr-create and branch-delete call sites) and FAFF-1219 (strict mode) are prepped against the interface in section 3.

## 1. Why

**The model.** Every governed run starts with a signed admission record at seq 0, at its genesis position. A grant is trusted only through the key whose fingerprint that admission names. The trust file on the base branch then says whether that fingerprint is pinned. `producer/pk.json` and `governor.json` only carry public key bytes; neither decides which key is trusted.

**Problem.** Today `merge-gate.js` (`resolveGrantByEffectKind`) takes both the public key and the fingerprint it checks from the runner-written `producer/pk.json`, and `verifyAuthLeg` in `commissaire.ts` falls back to that same file whenever no `governor.json` exists, which is always the case under governor custody. A runner that writes its own key pair into `pk.json` can self-sign a grant that both accept; both FAFF-1109 prototypes showed this. This ticket adds one verify function that binds the key to the admission record, classifies each grant as pinned, unpinned or in-process against `.commissaire/trust.toml`, and accepts a verdict only at its signed chain position.

**What this closes and what it does not.** It closes the attack the prototypes showed: swapping `pk.json` (or removing or displacing the admission) inside an honestly admitted run. A runner that forges an entire ledger from genesis under its own key can still produce a self-consistent run, which classifies as `unpinned` or `in-process`. ADR 0135 decision 6 accepts such runs as uncounted; strict mode (FAFF-1219) is what refuses them.

`pinned` means a pinned governor signed this grant for a run with this `run_id`, at this chain position. It does not prove the grant was used for only one merge: a runner can copy an earlier, honestly governed run wholesale into a directory with the same name. That is the same class ADR 0135 decision 10 already records: a dishonest runner keeps the GitHub credential and can merge without asking `merge-gate` at all, so the chokepoint is prevention only for a runner that goes through it. Merges without their own grant are detected after the fact by `effects reconcile-merges` (FAFF-1028) and prevented by the follow-on FAFF-1220. This ticket makes the classification trustworthy so that strict mode and Gate 1 counting (FAFF-1182) can rely on it.

**Design principles.**

**Trust never comes from a runner-writable file alone.** `pk.json` or `governor.json` may supply key bytes, but a key is used only when its fingerprint equals the `pk_fingerprint` in the seq-0 admission, and that admission verifies under it at its genesis position.

**Zero-config is unchanged.** An ungoverned run returns `not-applicable` without reading the trust file. A run with no trust file behaves as today, apart from the new tamper and chain-position refusals.

**One core, many readers.** The verify function, `verifyAuthLeg` and `audit verify` share one key-resolution and classification routine, so FAFF-360's independent verifier has one rule to reproduce.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.ts` | TypeScript (factory region) | `verifyAuthLeg`, `commissairePublicKey`, `readChokepointKeyRecord` (the FAFF-1176 seam this ticket retires), `cmdAuditVerify` |
| `plugin/skills/faff/bin/lib/decision-policy.ts` | TypeScript (governance) | `chokepointPermit`, the existing single-grant checker, reused unchanged |
| `plugin/skills/faff/bin/lib/commissaire-trust.ts` | TypeScript (governance) | `readTrustFile` returns `Result<TrustRead, TrustFileError>` with `governorKeyFingerprints` and `requirePinnedGovernor` (FAFF-1210) |
| `plugin/skills/faff/bin/lib/events.js` | JavaScript (governance) | `walkPhysicalChain` / `verifyEffectsChain`, the hash-chain walk with `first_break` |
| `plugin/skills/faff/bin/lib/governor.ts` | TypeScript (factory) | Writes the governor admission at seq 0 with `payload.custody: "governor"` and `payload.pk_fingerprint` |
| `plugin/skills/faff/bin/lib/merge-gate.js` | JavaScript (factory) | Current consumer; switches to the new function in FAFF-1212 |
| `records/adr/0135-…-pinned-keys.md` | ADR | Decisions 4, 6 and 11 |
| `test/fixtures/commissaire/secret-free-replay/` | Fixture | Frozen in-process evidence that must verify unchanged |

**Scope.** Commissaire-side verification only: the new governance module, `verifyAuthLeg`, and `audit verify`.

## 2. Out of scope

- **merge-gate, pr-create and branch-delete call sites.** FAFF-1212 owns them. Extension point: `resolveGrantByEffectKind` in `merge-gate.js` replaces its `readChokepointKeyRecord` + `chokepointPermit` pair with one `verifyGrant` call. Until then `readChokepointKeyRecord` stays exported and unchanged.
- **Strict mode.** FAFF-1219 owns `require_pinned_governor`. Extension point: one branch in `verifyGrant` after classification that refuses with `grant-not-pinned`. This ticket reads the flag into the result but never acts on it.
- **The pin-change human rule.** FAFF-1218. Extension point: a separate governance-region module, since that check needs GitHub PR data and this module reads only files under the run directory.
- **Gate 1 counting and `independence: not-counted`.** FAFF-1182. It consumes the `classification` this ticket reports.
- **Governor-side verification of producer claims.** ADR 0135 lists it as a follow-on. Producer records under governor custody stay `unverifiable_without_secret`.
- **Updating FAFF-360's portable verifier.** That verifier lives outside this repo. This ticket documents the new rules in the `audit verify` output so it can follow.
- **Replaying a whole earlier run's evidence under the same run directory name.** Offline, a copy of run X is indistinguishable from run X. ADR 0135 decision 10 places this in detection (`effects reconcile-merges`, FAFF-1028: one grant, two merges) and prevention in FAFF-1220 (a required status check only the governor can post). Extension point: none in this module.
- **Detecting a runner that truncates the ledger to re-seat an orphaned grant.** The governor's head-extension check (FAFF-1177) covers that on the governor side; the offline verifier cannot see a truncation it was never shown.

## 3. What

### Vocabulary

| Term | Meaning |
|---|---|
| Admission record | The schema:3 Commissaire record at seq 0, `kind_of_entry: "admission"`, written by both the in-process `admit` and the governor. Its payload carries `pk_fingerprint`; a governor admission also carries `custody: "governor"` |
| Governance material | Any of: a schema:3 record in `declared-effects.jsonl`, `<producer_dir>/pk.json` or `<governor_dir>/governor.json`. The FAFF-1140 governance-required sentinel is faff's and stays in `merge-gate` |
| Custody | `governor` when the admission payload says so, `in-process` when the admission has no custody label, `null` only when the run has no governance material at all |
| Admitted key | The public key whose fingerprint equals the admission's `pk_fingerprint` and under which the admission's signature verifies |
| Pinned | Governor custody, and the admitted key's fingerprint is in the base branch's `governor_key_fingerprints` |
| Unpinned | Governor custody, and the fingerprint is not listed, or the trust file was not read |
| Expected run id | The run id records are bound to: the caller's `run_id` input when given, else `basename(run_dir)`. `audit verify` sets it from `--run-id`, else from an anchor path `.faff/anchors/<run>/<unit>/` (the `<run>` segment), else the basename |
| Run binding | Every schema:3 record's `run_id` equals the expected run id, the same rule the governor applies before it signs (`governor.ts`, "record is not schema 3 of this run at its line position") |
| Signed position | The `seq` and `prev` inside a signed record. A record at zero-based physical line index `i` is at its signed position when its `run_id` equals the expected run id, its `seq` equals `i`, exactly one physical line carries that record, and the chain walk finds no break at or before one-based line `i + 1`. Line 0's `prev` must equal `sha256(expected run id)`, computed from the input or directory, never from the record's own `run_id` |

### The new module

`plugin/skills/faff/bin/lib/commissaire-verify.ts`, with its committed `.js` emit and a `// === region:governance — commissaire-verify — FAFF-1178: … ===` tag. It requires only governance modules: `producer-auth`, `decision-policy`, `events`, `commissaire-trust`, `effects` and `result`. It must stay inside the standalone binary's import-independence closure (`test/commissaire-standalone.test.mjs`).

**Chosen:** a new governance-region module rather than adding the function to `commissaire.ts`. `commissaire.ts` is tagged factory in `regions.js`, and ADR 0135 says the verify function comes from the governance region so that factory call sites (`merge-gate.js`, `commissaire.ts` itself) call into it legally.

### Interface

```
ENUM TrustInput:
  { read: Result<TrustRead, TrustFileError> }   # the caller ran commissaire-trust.readTrustFile
  | { not_read: true }                          # no base ref supplied; nothing is pinned

ENUM Custody: "governor" | "in-process"
ENUM Classification: "pinned" | "unpinned" | "in-process"
ENUM TrustSource: "remote-base" | "local-ref" | "not-read"

RECORD KeyResolution:                          # exported as resolveAdmittedKey
  custody: Custody | null                      # null => ungoverned (no governance material at all)
  pk: PublicKey | null                         # null on admission-missing, admission-position-invalid, run-id-mismatch
                                               #   or (governor-)key-not-admitted: no key is trusted
  signer_fingerprint: String | null            # 64 lowercase hex; null whenever pk is null
  classification: Classification | null        # null whenever pk is null, and on trust-file-invalid
  trust_source: TrustSource
  require_pinned_governor: Boolean             # read and reported only; FAFF-1219 acts on it
  failure: KeyFailureReason | null             # set => verifyGrant refuses; verifyAuthLeg records a ledger failure

ENUM KeyFailureReason:
  "ledger-malformed"            # declared-effects.jsonl has a non-record line before its final line
  "admission-missing"           # governance material exists but seq 0 is not a Commissaire admission,
                                #   including a missing, emptied or fully garbled ledger
  "admission-position-invalid"  # the admission is not at its signed position (for example copied from another run)
  "run-id-mismatch"             # a schema:3 record up to the checked one carries a run_id other than the expected run id
  "governor-key-not-admitted"   # governor custody: pk.json missing, its fingerprint != the admission's,
                                #   or the admission does not verify under it
  "key-not-admitted"            # in-process custody: the same binding fails for the governor.json / pk.json key
  "pk-fingerprint-tampered"     # in-process: pk.json disagrees with governor.json (today's FAFF-978 check)
  "trust-file-invalid"          # TrustInput.read is an error; carries TrustFileError.message

INTERFACE GrantVerifyInput:                    # argument to verifyGrant
  run_dir: Path
  run_id?: String                              # expected run id; defaults to basename(run_dir)
  unit_id: String
  step: String                                 # "merge" | "pr-create"
  effect: { kind: String, target: String }   # kind: "merge" | "pr-create" | "branch-delete"; target required
  trust: TrustInput
  governor_dir?: Path                          # defaults <run_dir>/commissaire/governor
  producer_dir?: Path                          # defaults <run_dir>/commissaire/producer

RECORD GrantVerifyResult:                      # return of verifyGrant
  outcome: "valid-grant" | "absent-or-invalid" | "not-applicable"
  reason: GrantReason
  custody: Custody | null
  classification: Classification | null
  signer_fingerprint: String | null
  verdict_seq: Integer | null                  # seq of the verdict that decided, when one was found
  trust_source: TrustSource

ENUM GrantReason:
  "valid-grant"
  "not-governed"                               # outcome not-applicable
  "no-verdict-for-step"                        # governed, no effect-decision-verdict for (unit, step)
  "no-verdict-for-kind"                        # verdicts at step, none for effect.kind
  "chain-position-invalid"                     # the selected verdict is not at its signed position in an intact chain
  "effect-target-missing"                      # input.effect.target is empty; checked before anything else
  | KeyFailureReason
  | chokepointPermit reasons: "not-a-commissaire-decision" | "decision-signature-invalid"
    | "decision-not-a-grant" | "grant-does-not-cover-effect" | "pk-unreadable"

FUNCTION verifyGrant(input: GrantVerifyInput) -> GrantVerifyResult
FUNCTION resolveAdmittedKey(run_dir, trust: TrustInput, governor_dir?, producer_dir?, run_id?) -> KeyResolution
```

Both functions are pure apart from reading files under `run_dir`. Neither reads the trust file itself: the caller passes the `readTrustFile` result, and `verifyGrant` ignores it on an ungoverned run (FAFF-1212 may skip the read when the run has no governance context). Neither throws on a malformed run directory; unreadable inputs become an `absent-or-invalid` outcome with a named reason.

**Chosen:** the caller reads the trust file and passes the result in. The caller knows the base ref, the repo slug and whether it needs a remote read (decision 6: an independent verifier reads the remote base branch). Keeping the read out of the function keeps it testable without git, and lets `merge-gate` read the trust file once for all three legs.

**Chosen:** `outcome` keeps `merge-gate`'s existing three-state signal (`valid-grant` / `absent-or-invalid` / `not-applicable`), so FAFF-1212 is a call swap with no change to `decideFloor` or `andGrants`. The governance-required sentinel (FAFF-1140) stays in `merge-gate`; it is faff's, not Commissaire's.

### `audit verify` output additions

`cmdAuditVerify` gains four optional flags and four fields. Existing fields keep their names and meaning.

| Flag | Meaning |
|---|---|
| `--base <ref>` | Read the trust file from this ref. Absent: no trust read, `trust_source: "not-read"` |
| `--trust-transport remote\|local` | Default `remote` (`gh api` contents, ADR 0135 decision 6: an independent verifier reads the remote base branch). `local` (`git show <base>:.commissaire/trust.toml`) is opt-in and reported as `trust.source: "local-ref"` |
| `--run-id <id>` | The expected run id. Absent: the `<run>` segment when `--run-dir` is an anchor path `.faff/anchors/<run>/<unit>/`, else the directory's basename. Must match `^[A-Za-z0-9_][A-Za-z0-9_.-]*$`; anything else exits 2 |
| `--repo <owner/name>` | Required with the remote transport. Missing: exit 2 with a stderr diagnostic, like every other setup error, never a `trust-file-invalid` result |

`--repo` must match `^[A-Za-z0-9_-][A-Za-z0-9_.-]*/[A-Za-z0-9_-][A-Za-z0-9_.-]*$` with no `..`. `--base` must match `^[A-Za-z0-9_][A-Za-z0-9_./-]*$` with no `..`, so it cannot start with `-` or carry `?`, `#`, `&`, `%`, spaces or control characters. Anything else exits 2 before any read, since both reach `git show` and `gh api` as arguments and URL segments.

```
RECORD AuditVerifyOutput (version 1, additive fields marked +):
  ...existing fields unchanged...
  + custody: Custody | null
  + signer_fingerprint: String | null
  + trust: { source: TrustSource, present: Boolean | null, require_pinned_governor: Boolean }   # present null iff source "not-read"
  records[i] for author "commissaire":
  + key_classification: Classification | null
```

Reading rules for consumers, stated in the `audit verify` help text and the module comment:

- Only `trust.source: "remote-base"` with `key_classification: "pinned"` is evidence that a grant came from a pinned governor. `local-ref` and `not-read` never are (ADR 0135 decisions 6 and 7).
- `signer_fingerprint` is the authenticated fingerprint (bound to the admission). The existing `pk_fingerprint` field keeps today's meaning, the value read from `pk.json`, and is unauthenticated; under a swapped `pk.json` the two differ or `signer_fingerprint` is null.

**Chosen:** keep `version: 1` and add fields. The FAFF-977 spec's own rule is "bump on any breaking shape change", and adding fields is not one. The fixture snapshot for `secret-free-replay` is updated additively; its `result`, counts, classifications and exit code stay identical.

## 4. How

### Key resolution

`resolveAdmittedKey` decides custody and which key the run's Commissaire records must verify under, then classifies that key against the trust input.

```
PROCEDURE resolveAdmittedKey(run_dir, trust, governor_dir, producer_dir):
  1. IF the run has no governance material -> RETURN { custody: null, failure: null, classification: null, trust_source per trust }
     walk := walkPhysicalChain(bytes of declared-effects.jsonl, empty when absent)
     IF walk.status == "malformed" -> failure "ledger-malformed", pk null
     entries := walk.records (non-null) filtered to schema 3
  2. admission := entries[0] IF author == "commissaire" AND kind_of_entry == "admission" AND seq == 0 ELSE null
     IF admission == null -> failure "admission-missing", pk null,
        custody := governor.json present ? "in-process" : "governor"   # an unauthenticated label on a failing run;
                                                                          #   it never changes an outcome
                                                                          # never fall through to pk.json
  3. IF admission.run_id != expected run id -> failure "run-id-mismatch", pk null
     IF NOT atSignedPosition(run_dir, admission) -> failure "admission-position-invalid", pk null
  4. custody := admission.payload.custody == "governor" ? "governor" : "in-process"
  5. candidates := IF custody == "governor": [pk.json key]
                   ELSE: [governor.json key IF present, ELSE pk.json key]          # FAFF-978 precedence
  6. key := the candidate WHERE pkFingerprint(key) == admission.payload.pk_fingerprint
                                AND verifyDecision(admission, key)
     IF none -> failure (custody == "governor" ? "governor-key-not-admitted" : "key-not-admitted"), pk null
  7. pk := key; signer_fingerprint := admission.payload.pk_fingerprint
  8. IF custody == "in-process" AND governor.json AND pk.json both present
        AND pkFingerprint(pk.json key) != governor.json pk_fingerprint
     -> failure "pk-fingerprint-tampered" (pk kept)                                 # today's FAFF-978 check
  9. IF trust is { read: err } -> failure "trust-file-invalid" (pk kept)
 10. classification :=                                            # skipped (null) when pk is null or on trust-file-invalid
        custody == "in-process"                                   -> "in-process"
        trust is not_read OR read.present == false                -> "unpinned"
        signer_fingerprint IN read.config.governorKeyFingerprints -> "pinned"
        otherwise                                                 -> "unpinned"
 11. require_pinned_governor := read.config.requirePinnedGovernor when a config was read, else false
 12. RETURN the KeyResolution (the first failure set wins)
```

**Chosen:** one binding rule for both custodies. Every governed run, in-process or governor, has a seq-0 admission carrying `pk_fingerprint` (in-process `admit` and the governor both write it, as the `secret-free-replay` fixture shows). The key is accepted only when its fingerprint equals that value and the admission verifies under it at its genesis position. Removing or displacing the admission fails `admission-missing` or `admission-position-invalid` instead of falling through to `pk.json`. Deleting, emptying or garbling the whole ledger does the same: applicability keys on governance material (including `pk.json`, which every `admit` writes), not on finding parseable schema:3 records, so a governed run can never be downgraded to `not-applicable` by damaging the one runner-writable ledger file. Copying another run's admission into this directory fails `run-id-mismatch`: the signed `run_id` names the other run, and the genesis `prev` is checked against the expected run id (the directory's basename unless the caller names it), not the record's own field (`walkPhysicalChain` alone takes genesis from the record, so the explicit check is required).

**Chosen:** under in-process custody, key selection keeps today's FAFF-978 precedence (`governor.json` first, then `pk.json`) and the tamper cross-check, with the admission binding added. Decision 6 says in-process custody keeps checking against the run's own key, and the frozen fixture depends on it.

**Chosen:** an unpinned governor key is a classification, not a failure. Decision 6: runs signed by an unlisted governor key still work and are recorded as unpinned. Only strict mode (FAFF-1219) turns unpinned into a refusal.

**Chosen:** a trust-file read error fails closed under both custodies, including in-process, where the file can never make a grant pinned. Ignoring the error for in-process runs would let a malformed file (for example a misspelt `require_pinned_governor`) or an unreadable one silently disable strict mode for exactly the in-process grants strict mode exists to refuse. ADR 0135 decision 11 says every reader fails closed.

**Anti-pattern:** comparing `pkFingerprint(pk.json)` against `pk.json`'s own `pk_fingerprint` field, which `merge-gate` does today. Why: both values come from the same runner-writable file, so the check proves nothing.

**Anti-pattern:** treating a missing trust file as a reason to fail. Why: decision 11 says no file means no pins and strict mode off.

**Anti-pattern:** falling back to `pk.json` when the admission is missing or unbound. Why: that is the demotion path, where a runner deletes the governor admission and its self-signed grant verifies under its own key as "in-process".

### Grant verification

`verifyGrant` finds the latest verdict for the effect kind, checks it sits at its signed position, then runs the existing `chokepointPermit` under the admitted key.

```
PROCEDURE verifyGrant(input):
  1. IF input.effect.target is null or empty -> RETURN absent-or-invalid, "effect-target-missing"
  2. key := resolveAdmittedKey(input.run_dir, input.trust, input.governor_dir, input.producer_dir)
  3. IF key.custody == null -> RETURN not-applicable, reason "not-governed"
  4. verdicts := schema-3 records from the same walk resolveAdmittedKey used (one reader, never readLedgerEntries),
                 with author "commissaire", kind_of_entry "effect-decision-verdict",
                 matchesUnit(record, input.unit_id), step == input.step
     IF verdicts is empty -> RETURN absent-or-invalid, "no-verdict-for-step"
  5. verdict := last of verdicts whose payload.effect.kind == input.effect.kind   # latest wins, as today: a later deny refuses
     IF none -> RETURN absent-or-invalid, "no-verdict-for-kind"
  6. IF key.failure != null -> RETURN absent-or-invalid, key.failure
  7. IF any schema:3 record up to the verdict has run_id != expected run id -> RETURN absent-or-invalid, "run-id-mismatch"
     IF NOT atSignedPosition(input.run_dir, verdict) -> RETURN absent-or-invalid, "chain-position-invalid"
  8. res := chokepointPermit({ kind: input.effect.kind, target: input.effect.target }, verdict, key.pk, key.signer_fingerprint)
  9. RETURN { outcome: res.permit ? "valid-grant" : "absent-or-invalid", reason: res.reason,
              custody, classification, signer_fingerprint, verdict_seq: verdict.seq, trust_source }

PROCEDURE atSignedPosition(run_dir, record, expected_run_id):
  1. walk := walkPhysicalChain(bytes of <run_dir>/declared-effects.jsonl)   # first_break.line is ONE-based
  2. IF walk.status == "malformed" -> false        # a mid-file non-record; a torn FINAL line is not malformed:
                                                   #   the walk stops before it and reports torn_tail
  2a. IF the line-0 record's prev != sha256(expected run id) -> false        # genesis bound to the expected run
  2b. IF any parsed record at index <= the record's index has run_id != expected run id -> false
  3. matches := zero-based indices i where walk.records[i] has the same seq AND the same commissaire_sig as record
     IF matches has no element or more than one -> false                    # duplicates are refused, never guessed
  4. i := the single match
  5. IF walk.status == "broken" AND walk.first_break.line <= i + 1 -> false # break at or before the record's own line
  6. RETURN record.seq == i
```

Step order matters. Steps 4 and 5 run before the key failure so that a governed run with no verdict reports the more specific reason, matching today's `merge-gate`. Every refusal names one reason from `GrantReason`.

**Chosen:** `effect.target` is required, and the grant is checked against the caller's target only. Falling back to the verdict's own target, as `merge-gate` does today, compares the grant with itself, so coverage is always true. FAFF-1212 must resolve the base branch (merge, pr-create) or head ref (branch-delete) before calling.

**Chosen:** a grant is valid only if the chain is intact from genesis up to and including the grant's line, regardless of what follows it. A torn or broken line after an honest grant does not void the grant, but an orphaned grant appended later sits after a break (its signed `prev` does not match the line before it) and is refused. This implements ADR 0135 decision 4's prototype finding.

**Failure modes.**

- **The failure:** `walkPhysicalChain` and `appendRecordsUnderLock` disagree on how `seq` maps to a line (for example after a torn tail). **How you'd know:** an honest single-grant run fails with `chain-position-invalid` in the test suite. **What it means:** take the expected seq from the same tail-read rule `governorLedgerSnapshot` uses instead of the line index.
- **The failure:** some honest governed run has a seq-0 record that is not an admission, or an admission whose `pk_fingerprint` does not match its key. **How you'd know:** the frozen fixture, `commissaire.test.mjs` or `commissaire-governor-client.test.mjs` fails with `admission-missing` or `key-not-admitted` after the change. **What it means:** every `admit` path writes the seq-0 admission today (`cmdAdmit` in-process, `clientAdmit` and `governor.ts` for governor custody), so a failure is a fixture built by hand; fix the fixture, not the rule.

### `verifyAuthLeg`

`verifyAuthLeg` calls `resolveAdmittedKey` (with `{ not_read: true }` unless a trust input is passed through) instead of `commissairePublicKey`:

- It returns `{ pass, failures, unverifiable, key }`, where `key` is the `KeyResolution` it used, so `audit verify` fills its new fields from the one core call and never resolves the key twice.
- A `KeyResolution.failure` becomes one ledger-level failure (`seq: null`) with that reason, so `pass` is false.
- Commissaire records verify under `KeyResolution.pk`, exactly as today. When `pk` is null, every Commissaire record fails `commissaire-sig-invalid`, because no key is trusted. On `pk-fingerprint-tampered` and `trust-file-invalid` the bound key is kept, so per-record results match today's in-process behaviour.
- Producer records are unchanged.
- Per-record results stay signature checks, as today. A Commissaire record copied from another run under the same governor key still reports `verified` per record, but the run's `ledger_failures` carries `run-id-mismatch` or `admission-position-invalid` whenever such a record sits at or before the admission or breaks the chain, and `verifyGrant` refuses it. Per-record position classification is a follow-on for FAFF-360's verifier.

`commissairePublicKey` keeps serving `verdict conclude` (in-process) and is not removed in this ticket. `readChokepointKeyRecord` is untouched; FAFF-1212 retires it.

### `audit verify`

`cmdAuditVerify`:

1. Resolves the trust input from the new flags: no `--base` gives `{ not_read: true }`; `--base` with the remote transport and no `--repo` exits 2; otherwise calls `readTrustFile({ repoDir: findRoot(), ref: base, transport, repoSlug })`. A read error is passed through, not raised.
2. Calls `verifyAuthLeg` once with that trust input, as today's single core call.
3. Fills the new fields from the same `KeyResolution`.
4. Under `custody: "governor"`, any Commissaire record that fails, including the adversarial self-signed grant, makes `result: "fail"` and exit 1. A `trust-file-invalid` failure is a ledger failure and exits 1.

## 5. Scenarios

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a governed run admitted by a governor whose fingerprint F is in the base branch's governor_key_fingerprints
And a valid merge grant from that governor at its signed position
When verifyGrant is called for the merge leg
Then outcome is "valid-grant", custody "governor", classification "pinned", signer_fingerprint F
```

```
Given that same run
When the runner overwrites producer/pk.json with a key pair it minted and appends a merge grant it signed
Then verifyGrant returns "absent-or-invalid" with reason "governor-key-not-admitted"
And audit verify reports the forged record as "failed" with key_classification null, ledger_failures containing "governor-key-not-admitted", result "fail" and exit 1
```

```
Given that same run
When the runner deletes the seq-0 governor admission, rewrites the chain so it is intact, and appends a merge grant signed under its own key in pk.json
Then verifyGrant returns "absent-or-invalid" with reason "admission-missing", never "valid-grant" under custody "in-process"
```

```
Given a governor-custody run with pk.json present
When the runner deletes declared-effects.jsonl before the merge leg
Then verifyGrant returns "absent-or-invalid" with reason "admission-missing", never "not-applicable"
```

```
Given a governed run whose seq-0 line is a genuine pinned governor admission copied from a different run
When verifyGrant or audit verify resolves the key
Then the result is "run-id-mismatch" and classification is null, never "pinned"
```

```
Given a governor run whose admission fingerprint is not listed in the trust file
When verifyGrant checks a genuine grant
Then outcome is "valid-grant" and classification is "unpinned"
```

```
Given a governed run where the governor signed a merge grant at seq 5 but another record won seq 5
When the runner appends the orphaned grant at the end of the ledger
Then verifyGrant returns "absent-or-invalid" with reason "chain-position-invalid"
```

- The `secret-free-replay` fixture's `audit verify` `result`, counts, per-record `classification` (the existing producer/Commissaire bucket field) and exit code are unchanged; the output gains only the additive fields, including `key_classification`.
- An ungoverned run returns `not-applicable` from `verifyGrant` without any trust-file read.

## 6. Design decision rationale

**Where does the verify function live?** Adding it to `commissaire.ts` is least churn, but that file is factory region and ADR 0135 places the function in the governance region. **Chosen:** new `commissaire-verify.ts`, governance region, in the standalone closure.

**Who reads the trust file?** The function could read it from a base ref itself, or receive the result. Reading inside would need git and `gh` in every unit test and would read three times per merge. **Chosen:** the caller reads and passes the `readTrustFile` result.

**Where do the key bytes come from?** Options: trust `pk.json` (the current hole); ask the governor over its socket (unavailable to an offline verifier); add the public key to the admission record (a FAFF-1177 wire change); or accept a key only when its fingerprint matches the seq-0 admission and the admission verifies under it at its genesis position. **Chosen:** the admission binding, for both custodies. It closes the swap and the admission-removal path without a wire change and works offline. A full forged ledger remains possible offline and can only classify unpinned or in-process, which ADR 0135 decision 6 accepts as uncounted.

**Is the effect target optional?** Today's fallback to the grant's own target compares the grant with itself. **Chosen:** the target is required; a missing target refuses with `effect-target-missing`.

**Does a trust-file error fail in-process runs?** **Chosen:** yes. A malformed or unreadable file must not silently disable strict mode for in-process grants (decision 11: every reader fails closed).

**Is replaying a whole earlier run in scope?** **Chosen:** no. ADR 0135 decision 10 already records that the chokepoint cannot stop a dishonest runner, which can merge without asking; detection is `effects reconcile-merges` (FAFF-1028) and prevention is FAFF-1220. This ticket binds every record to its run directory so a single copied record or admission is refused.

**Which transport does `audit verify` default to?** **Chosen:** remote, per decision 6; local is opt-in and labelled `local-ref`.

**Is an unpinned governor grant a failure?** **Chosen:** no, a classification, per ADR 0135 decision 6. Strict mode (FAFF-1219) refuses it.

**How strict is the chain-position check?** Requiring a fully intact chain would void honest grants after a later torn line. **Chosen:** intact from genesis through the record's own line, `seq` equal to the zero-based line index, and exactly one physical line carrying the record. The same check applies to the seq-0 admission.

**What shape does the result take?** **Chosen:** keep `merge-gate`'s three-state `outcome` and add a named `reason`, `custody`, `classification` and `signer_fingerprint`, so FAFF-1212 swaps the call without touching the floor logic.

**Does `audit verify` bump its version?** **Chosen:** no. FAFF-977's rule bumps only on a breaking shape change; these fields are additive.

## 7. Open questions and assumptions

**Open questions.** None.

**Assumptions.**

- **Assumes:** `walkPhysicalChain` in `events.js` behaves as read on 2026-10-12: `records[i]` is the parsed object for zero-based physical line `i`; a final line with no newline that does not parse sets `torn_tail` and stops the walk without making the status `malformed`; a non-record line before the last is `malformed`; `first_break.line` is one-based (`line: i + 1`); and line 0's expected `prev` is taken from that record's own `run_id`, which is why section 4 re-checks genesis against the directory. Validate: read `walkPhysicalChain` in `plugin/skills/faff/bin/lib/events.js` before building; if any of these differ, wrap the walk in `commissaire-verify.ts` rather than changing `events.js`.

- **Assumes:** every `admit` path writes a seq-0 admission carrying `payload.pk_fingerprint`, with `payload.custody: "governor"` on governor admissions, as `cmdAdmit`, `clientAdmit` and `governor.ts` do today. Validate: `grep -n 'kind_of_entry: "admission"' plugin/skills/faff/bin/lib/commissaire.ts plugin/skills/faff/bin/lib/governor.ts`, and the first line of `test/fixtures/commissaire/secret-free-replay/declared-effects.jsonl`.

## 8. Done

### From why
- [ ] `verifyGrant` never trusts a key unless its fingerprint equals the seq-0 admission's `pk_fingerprint` and the admission verifies under it at its genesis position; a swapped `pk.json` or a removed admission is refused.

### From what
- [ ] `plugin/skills/faff/bin/lib/commissaire-verify.ts` and its committed `.js` emit exist, tagged `region:governance`, exporting `verifyGrant` and `resolveAdmittedKey` with the inputs and results in section 3.
- [ ] `faff regions check` passes, and `test/commissaire-standalone.test.mjs` shows the module in the standalone closure with `config.js` still absent.
- [ ] `GrantVerifyResult.reason` only ever takes a value from `GrantReason`.
- [ ] `audit verify` accepts `--base`, `--trust-transport` (default `remote`) and `--repo`, and prints `custody`, `signer_fingerprint`, `trust` and per-record `key_classification`, with `version: 1`. Remote without `--repo` exits 2.
- [ ] The help text and module comment state that only `remote-base` + `pinned` is pinned-governor evidence, and that `pk_fingerprint` is unauthenticated while `signer_fingerprint` is bound.

### From how
- [ ] A governed ledger whose seq 0 is not an admission gives `admission-missing`; an admission not at its genesis position gives `admission-position-invalid`; neither falls back to `pk.json`.
- [ ] Governor custody: `pk.json` missing, mismatched to the admission fingerprint, or failing the admission signature gives `governor-key-not-admitted`; the in-process equivalent gives `key-not-admitted`.
- [ ] A null or empty `effect.target` gives `effect-target-missing`; the grant is never compared with its own target.
- [ ] Classification is `pinned` when the admission fingerprint is listed, `unpinned` when not listed, when the file is absent, or when the trust file was not read, and `in-process` for in-process custody.
- [ ] A trust-file read error on a governed run gives `trust-file-invalid` and never falls back to "no pins".
- [ ] A run with no governance material returns `not-applicable`. A run with `pk.json` or `governor.json` but a missing, empty or garbled ledger returns `admission-missing` (or `ledger-malformed` for a mid-file non-record), never `not-applicable`.
- [ ] With a grant followed by a deny for the same unit, step and kind, `verifyGrant` refuses with `decision-not-a-grant`, matching today's latest-wins selection.
- [ ] A verdict after a chain break, whose `seq` differs from its zero-based line index, or that appears on more than one physical line, gives `chain-position-invalid`. An honest grant on the line immediately before a broken line, or before a torn final line, still passes; a malformed ledger (a non-record mid-file) refuses. Tests pin the one-based `first_break.line` boundary.
- [ ] Line 0's `prev` is checked against `sha256(expected run id)`, and any record with another `run_id` up to the checked record gives `run-id-mismatch`.
- [ ] `verifyGrant` and `resolveAdmittedKey` default the expected run id to `basename(run_dir)`; `audit verify` takes it from `--run-id`, else an anchor path's `<run>` segment, else the basename. `audit verify --run-dir <committed anchor>` verifies, and the frozen fixture verifies with `--run-id RUN-SMOKE` (or its test's equivalent input).
- [ ] A garbled mid-file ledger line on a governed run gives `ledger-malformed`; the older malformed-parity test that expected dropped lines never to fail auth is updated to expect it.
- [ ] `classification` and `signer_fingerprint` are null whenever no key is bound; `classification` is null on `trust-file-invalid`.
- [ ] `verifyAuthLeg` uses `resolveAdmittedKey` and no longer reads `pk.json` as the trust source under governor custody.
- [ ] `require_pinned_governor` is reported but changes no outcome.

### From scenarios and acceptance criteria
- [ ] Adversarial test: replace `producer/pk.json` with a runner-minted key pair and append a self-signed merge grant on a governor-custody run with a trust file pinning the real governor. `verifyGrant` refuses with `governor-key-not-admitted`; `audit verify` exits 1 and the forged record is `failed`.
- [ ] Orphaned-grant test: a governor-signed grant appended after losing its position is refused with `chain-position-invalid`.
- [ ] Demotion test: deleting the governor admission and re-chaining gives `admission-missing`; a copied admission from another run gives `run-id-mismatch`.
- [ ] `audit verify` rejects a malformed `--repo` or `--base` with exit 2 before any read.
- [ ] Remote read: `audit verify --base main --trust-transport remote --repo <slug>` classifies against the remote trust file (unit test stubs `gh`).
- [ ] The `secret-free-replay` fixture verifies with the same `result`, counts, classifications and exit code; the snapshot changes only by the added fields.
- [ ] `npm run build` in `plugin/skills/faff` regenerates the emit and `build-manifest.json`; the full test suite passes.

### Integration smoke test

```
1. Start a governor (FAFF-1177) on a temp socket; admit a run through the client (FAFF-1179).
2. Write .commissaire/trust.toml with the governor's fingerprint on a temp repo's main; commit.
3. Request and append a merge grant.
4. verifyGrant(run, unit, "merge", {kind: "merge", target: "main"}, readTrustFile(local main))
   EXPECT outcome "valid-grant", classification "pinned".
5. audit verify --run-dir run --base main --trust-transport local
   EXPECT exit 0, custody "governor", trust.source "local-ref", key_classification "pinned".
```

## Appendix A: reason catalogue

| Reason | Outcome | When |
|---|---|---|
| `valid-grant` | valid-grant | Admitted key, intact position, covering grant |
| `not-governed` | not-applicable | No governance material |
| `no-verdict-for-step` | absent-or-invalid | Governed, no verdict for the unit and step |
| `no-verdict-for-kind` | absent-or-invalid | Verdicts at the step, none for the effect kind |
| `effect-target-missing` | absent-or-invalid | The caller passed no effect target |
| `ledger-malformed` | absent-or-invalid | A non-record line before the ledger's final line |
| `admission-missing` | absent-or-invalid | Governance material exists, seq 0 is not a Commissaire admission (including a missing or emptied ledger) |
| `admission-position-invalid` | absent-or-invalid | The admission is not at its genesis position |
| `run-id-mismatch` | absent-or-invalid | A record up to the checked one names a different run |
| `governor-key-not-admitted` | absent-or-invalid | Governor custody, `pk.json` not bound to the admission |
| `key-not-admitted` | absent-or-invalid | In-process custody, no candidate key bound to the admission |
| `pk-fingerprint-tampered` | absent-or-invalid | In-process, `pk.json` disagrees with `governor.json` |
| `trust-file-invalid` | absent-or-invalid | The trust input is a read or parse error |
| `chain-position-invalid` | absent-or-invalid | The verdict is not at its signed position in an intact chain |
| `not-a-commissaire-decision`, `decision-signature-invalid`, `decision-not-a-grant`, `grant-does-not-cover-effect`, `pk-unreadable` | absent-or-invalid | From `chokepointPermit`, unchanged |
| `grant-not-pinned` | absent-or-invalid | Reserved for FAFF-1219 strict mode; never returned by this ticket |

confidence: high
build-tier: complex
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
