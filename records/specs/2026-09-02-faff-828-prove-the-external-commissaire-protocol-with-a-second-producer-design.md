# Spec: Prove the external Commissaire protocol with a second producer (FAFF-828)

> Spec: faffter-dark-nlspec · 2026-09-01 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-828.

This is the nlspec-format design spec for FAFF-828, the first Phase 2A cutover slice of the SuperDomestique v5 roadmap. It designs the minimum external `commissaire` facade over the declared-effects slice (ADR 0122), built to depth on facade verb 3 (request a protected-effect decision), with the other five verbs defined only at the facade boundary. It builds against current `main` (`0297df8e`) and cites real `file:line` throughout.

Reviewed by the L4 adversarial spec-review over four rounds: reject-approach → revise → revise → approve. Round-1 was rejected on three converging blockers (a producer-held HMAC key could forge Commissaire's own grants; recording a verdict is not preventing an effect; the enforcement claims were not born-verifiable). The design was rebuilt around the ratified fix: split the trust so decisions are signed by an Ed25519 key the producer never holds, reframe the facade as a decision primitive whose prevention is realised at an adopter's pre-merge chokepoint (`decideFloor`), and make every DONE criterion name a fixture, an input shape, and an oracle.

## 1. WHY: problem and principles

**The load-bearing model.** Commissaire is a governance protocol in which a *producer* (the actor executing work) only ever *claims*, and Commissaire alone *decides*. The facade this slice ships delivers exactly one primitive: a protected-effect *decision* that the producer cannot forge and anyone can verify. A producer declares an effect, appends observations, and requests a decision; Commissaire returns a grant-or-deny verdict signed with a private key the producer never holds. Preventing the effect is a separate act performed by whoever sits on the effect path (an adopter's chokepoint) when it verifies that signed decision before permitting the effect. Today there is one producer, faff's own runner, entangled with faff scheduling and skills, so "the protocol works" and "faff's runner works" are indistinguishable. This slice separates them by standing up an external facade a *different* producer drives, binding every governance record to its author (producer claims by symmetric HMAC, Commissaire decisions by asymmetric signature), and demonstrating one chokepoint (`merge-gate`) that turns a verified decision into prevention.

**Problem statement.** The declared-effects mechanism (`effects.js`, `events.js`) is reachable today only through faff's own CLI wiring and its schema-2 chained ledger, and its effect-control posture is E-C (after-the-fact detection via `computeEscapes`, `effects.js:87`), not E-B (mediated prevention). This slice introduces a neutral external facade plus a `schema:3` envelope so a second producer can produce authenticated governed facts, and a Commissaire-signed protected-effect decision that an adopter's chokepoint can verify to prevent an effect, while detection (observe-and-reconcile) keeps running alongside.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

**Producer claims and Commissaire decisions are signed by different keys.** A producer holds only its own symmetric HMAC key and can therefore authenticate its own claims, but it must never be able to mint a grant. Commissaire decisions (`effect-decision-verdict`, `accepted_under_contract`) are signed with an Ed25519 private key the producer never holds; a producer that HMACs a fake verdict produces a record that fails Ed25519 verification. Any design where the same secret can author both a claim and a decision is a rejection: that is the round-1 infosec blocker.

**The facade delivers a decision, not an enforcement.** The minimal facade does not sit on the effect path, so it cannot itself stop an effect. What it guarantees is that a decision is unforgeable and verifiable. Prevention is what an adopter's chokepoint does with that decision: verify the Ed25519 signature and refuse the effect unless it is a genuine grant. Claiming the facade prevents effects on its own is a rejection (the round-1 architectural blocker). The E-B raise is stated as "prevention at a chokepoint that verifies an unforgeable decision", worked on `merge-gate`, never as blanket prevention.

**Detection is the exit-bar floor; chokepoint prevention is the additional property.** Phase 2A exit evidence limits claims to protocol sufficiency, authenticated record handling, mechanical detection, and replay stability. Detection (observe-and-reconcile, `effects.js:87` `computeEscapes` plus `merge-gate.js:723` `warnUncoveredMergeObserves`) is what the exit bar needs and must keep working. The chokepoint-verified decision is demonstrated additionally on `merge`. Removing detection to "simplify now that a chokepoint prevents" is a rejection.

**One canonical history, no second.** New runs in this slice use the `schema:3` envelope as canonical; earlier `schema:2`/`schema:1` runs stay frozen under their original integrity rules and are read through a compatibility path. Minting a parallel canonical history for old runs is forbidden (the state-authority map outcome for the effects rows is "translated", `STATE-AUTHORITY-MAP-v5.md:424`).

**Weaker assurance cannot satisfy a stronger obligation.** A J-D self-declared record cannot discharge a J-C obligation, and an E-C observation cannot stand in for an E-B grant. The gate classifies by assurance class and refuses the substitution, never accepts the weaker artifact as if it met the stronger contract.

**The external consumer imports nothing faff-internal.** The facade must not require SuperDomestique scheduling or current skills. This is enforced structurally: the region direction lint (`regions.js`) already forbids a governance file requiring a factory file, and the facade shell's region placement extends that discipline.

**Records are signed, never encrypted.** The ledger is a transparency log: every record is signed (producer HMAC or Commissaire Ed25519) and verifiable in the clear, and nothing in it is encrypted. The one confidential step in the whole protocol is delivering `K_producer` to a producer at admission over a secure channel; `PK_commissaire` is public and pinned by fingerprint for integrity.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/effects.js` | CommonJS | declare/observe/check/verify; `appendEffectEntries` (509), schema-2 record (522-526), `computeEscapes` (87), `effectDescriptorViolations` (64), `effectTargetMatches` (81). Region: governance. Reused, not rewritten. |
| `plugin/skills/faff/bin/lib/events.js` | CommonJS | `appendRecordsUnderLock`, `verifyLedgerChain` (693, the schema-versioned seam), `verifyEffectsChain` (795), `computeChainHead` (812), `mintIssueAnchor` writing `effects-chain-head.json` (1263). Region: governance. |
| `plugin/skills/faff/bin/lib/governance-check.js` | CommonJS | `integrityLegForChain` (170), `evaluateIntegrityLeg` (215), `evaluateAnchorDir` (244), witness-absent fail-closed (188). `requireWitness` lives here, not in `merge-gate.js` (ADR 0122 misattributes it). Region: factory. |
| `plugin/skills/faff/bin/lib/merge-gate.js` | CommonJS | `warnUncoveredMergeObserves` (723), `observeMergeEffects` (746): the POST-merge advisory detection reader. The pre-merge floor `decideFloor` (pure core in `contract-defs`, called at `merge-gate.js:998`/`:1218` before the merge spawn at `:1272`) is where the verified-decision leg is added for the prevention demo. Region: factory. |
| `plugin/skills/faff/bin/lib/regions.js` | CommonJS | the require-graph direction lint and `REGION_MAP` (41). Governance never requires factory; factory to governance is legal. |
| `plugin/skills/faff/bin/faff` | CommonJS | `COMMANDS` registry (127-235); a new subcommand is one entry here plus a `docs/guide/cli.md` row or `lint-cli-doc` fails. |
| `docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` | Markdown | effects rows: authority (79, 333-338), migration "translated" (424-429), journal J-C / effect E-C (515-517), the E-B sole-sanctioned-path row (526). |
| `records/adr/0122-adopt-declared-effects-as-the-first-v5-cutover-slice.md` | Markdown | the slice-selection decision; verb-3 mapping; the E-C to E-B gap named as the Phase 2A deliverable; U1 (compound-verb split). |
| `test/effects-chain.test.mjs`, `test/helpers/run-cli.mjs` | ESM | fixture conventions: flat `test/*.test.mjs`, `node --test`, mkdtemp-mint-then-mutate, the `runCli` spawn seam. |

**Scope statement.** This slice is the external facade and `schema:3` envelope for the declared-effects state class only, with verb 3 built to depth and one worked chokepoint; it cuts over no other state class in the authority map and changes no other producer.

## 2. Out of scope

- **Verbs 5 and 6 built to depth.** Excluded: only verb 3 is the deliverable to full depth this slice; the terminal conformance verdict (verb 5) and the sealed audit bundle (verb 6) are defined at the facade boundary and wired as thin stubs over existing handlers, not implemented deeply. Why: ADR 0122 scopes Phase 2A to verb 3, the atomic operation on the path of every effect. Extension point: `lib/commissaire.js` verb dispatch, where verbs 5 and 6 delegate to `faff events anchor` / `faff bundle` handlers.
- **A native runtime chokepoint beyond the merge worked example.** Excluded: baking the decision check into every SuperDomestique effect path. Why: this slice proves the primitive plus one worked chokepoint (`merge-gate`); wiring the native runtime's other chokepoints is downstream Phase 2A facade work. Extension point: each adopter chokepoint calls `verifyDecision(record, PK_commissaire)` before permitting its effect.
- **Enforced prevention for generic effects with no faff chokepoint.** Excluded: any claim that an effect with no adopter chokepoint on its path is prevented. Why: with no chokepoint there is nothing to verify the decision before the effect; those effects are DETECTION-only via observe-and-reconcile. Extension point: an adopter adds a chokepoint on that effect path and verifies the decision there.
- **SuperDomestique scheduling in the external consumer.** Excluded: `faff-graft`/`faff-beep-boop` scheduling, the run queue, the slot system. Why: the point of a second producer is a consumer that did not schedule the work. Extension point: none; a permanent boundary enforced by the region lint.
- **Current faff skills in the external consumer.** Excluded: the `faffter-*` slot skills and their contract blocks. Why: same boundary. Note: "producer" in this spec never means the slot-skill sense (see Terminology).
- **TypeScript migration.** Excluded: no TS, no build step. Why: introducing one crosses the ADR-0122 toolchain boundary; no entrypoint moves this slice. Fixed decision (brief). Extension point: a later slice once clean-install, startup, CJS-compat, and rollback are proven.
- **A new service, datastore, or runtime.** Excluded: no architecture-proposal step. Why: the slice fits inside the established CJS / region / schema-versioned-ledger architecture (brief, fixed). Extension point: none for this slice.
- **Encryption of records, and asymmetric producer-claim signing.** Excluded: encrypting the ledger, and giving producers Ed25519 claim signatures (non-repudiation of claims). Why: the ledger is a transparency log (signed, not secret), and producer claims target J-C mechanical detection, not non-repudiation; asymmetric producer signing is the future stronger rung. Extension point: `lib/producer-auth.js` `signRecord`/`verifyRecord`, where an Ed25519 producer-claim arm would slot beside the HMAC arm.
- **A rival evidence envelope competing with FAFF-601.** Excluded: defining a new Agent Delivery Evidence format. Why: FAFF-601 already specifies that evidence, and FAFF-610 (the marketplace-Action consumer) is parked; producer-authentication and record-handling reconcile with FAFF-601 rather than duplicating it (see Assumptions). Extension point: the `schema:3` payload for evidence records references the FAFF-601 shape.

## 3. WHAT: vocabulary, types, and interfaces

### Terminology (carried, mandatory)

| Term | Definition |
|---|---|
| **Producer (stream/record producer)** | The actor that executes work and writes records into the governance stream (run-ledger, events journal, declared-effects chain). It is the thing being governed, not the governor. In this spec, "producer" always means this sense. |
| **Producer asymmetry** | A producer only *claims* (declares an effect, appends an observation, claims a step done). Only **Commissaire decides** (grants/denies a protected-effect decision, issues the terminal `accepted_under_contract` verdict). Producer proposes, Commissaire disposes. |
| **First producer** | Faff's own runner (`faff-graft`/`faff-beep-boop` driving `effects declare/observe`, `appendRecordsUnderLock`, `mintIssueAnchor`). Currently the sole producer, entangled with faff scheduling and skills. |
| **Second producer** | Any producer that is not faff's runner: a bare Claude Code session on a non-faff repo with no factory installed (FAFF-360), a CI job or GitHub Action, a different coding agent or harness, a plain deploy/ops script calling `request-decision` before a db-migration, or another faff instance on a different repo. |
| **Slot-skill "producer" (a different sense, not used here)** | Faff's slot system also says "producer" for a slot-skill emitting a contract block (the `faffter-*` skills). That sense is never meant in this spec. |
| **Governor (Commissaire authority)** | The custodian that holds `SK_commissaire` (Ed25519 private, signs decisions) and `master_secret` (HKDF-derives each producer's HMAC key). Publishes `PK_commissaire`. Never the producer. |
| **Chokepoint (adopter)** | Whatever sits on an effect's path and can refuse the effect: `merge-gate` for merges, a native runtime hook, an external adopter's own gate. Holds only `PK_commissaire`. Verifies a decision's signature before permitting the effect. |
| **Protected-effect decision** | A grant-or-deny verdict Commissaire returns, signed with `SK_commissaire`, when a producer requests permission to cause a protected effect. The primitive this slice ships; unforgeable by the producer, verifiable by anyone with `PK_commissaire`. |
| **Neutral stream envelope** | The `schema:3` governance-record shape, producer-agnostic, carrying either a `producer_hmac` (producer-authored) or a `commissaire_sig` (Commissaire-authored). |

### Key-custody topology

Signing and verification only; no encryption. The trust split is what makes a producer-forged grant detectable at a chokepoint.

| Custodian | Holds | Can | Cannot |
|---|---|---|---|
| **Governor** | `SK_commissaire` (Ed25519 private), `master_secret`, publishes `PK_commissaire` | Sign decisions; derive and verify any producer's HMAC claims | (is the sole trust root) |
| **Producer** | `K_producer` = `HKDF(master_secret, producer_id, contract_revision)`; `PK_commissaire` | HMAC-authenticate its own claims; verify grants it receives | Sign a decision (no `SK`), derive another producer's key (no `master_secret`) |
| **Chokepoint (e.g. merge-gate)** | `PK_commissaire` only | Verify a decision's Ed25519 signature before permitting the effect | Sign anything; authenticate a producer claim (no symmetric key) |
| **Auditor / governance-check** | `PK_commissaire`; the symmetric key only if it is to re-authenticate producer claims | Verify decisions with `PK`; verify producer claims with the symmetric key | Verify producer-claim authenticity with `PK` alone (honest limit: producer signing is symmetric, so verifying a claim needs the key, and asymmetric producer signing is the future stronger rung) |

The one confidential action is delivering `K_producer` to the producer at `admit` time over a secure channel. `PK_commissaire` is public but pinned by fingerprint so a swapped public key is detected.

### The six facade verbs

| Verb | Name | This slice |
|---|---|---|
| Admission | Admit a producer; deliver `K_producer`, publish `PK_commissaire`, record admitted scope | Built (needed by verb 3) |
| Declare | Declare an effect the producer is about to cause | Built (reuses `appendEffectEntries`, re-enveloped as `schema:3`, `producer_hmac`) |
| **3. Request decision** | **Request a protected-effect decision (grant/deny) before acting; Commissaire signs the verdict** | **Built to depth (the deliverable)** |
| 4. Observe + reconcile | Append observations and reconcile observed-minus-declared | Built (detection persists alongside verb 3; reuses `computeEscapes`) |
| 5. Terminal verdict | Request a terminal conformance verdict | Boundary-only stub over `faff events anchor` / floor handlers |
| 6. Seal + export bundle | Seal and export an audit bundle | Boundary-only stub over `faff bundle` |

### Types

The `schema:3` neutral envelope extends the schema-2 effects record (`effects.js:522-526`) with an author identity, a verb-typed payload, and one author-appropriate authentication field. Schema-2 readers are untouched; a `schema:3` record adds fields they ignore.

```
RECORD GovernanceRecord (schema:3 neutral envelope):
  schema: 3                       # the classification key verifyLedgerChain arms on
  run_id: string                  # basename-derived, as today (effects.js:518)
  seq: integer                    # gap-free, lock-assigned inside appendRecordsUnderLock
  ts: ISO-8601 string
  author: enum { producer, commissaire }   # who wrote this record; selects the auth field
  producer_id: string             # the admitted producer this record is bound to; immutable
  contract_revision: string       # facade/protocol revision the producer key was derived under
  kind_of_entry: enum {           # the verb this record realises
    declare, observe,
    effect-decision-request,      # author = producer
    effect-decision-verdict,      # author = commissaire
    reconcile,
    accepted_under_contract }     # author = commissaire (verb-5 stub terminal verdict)
  issue: string                   # the unit key (compat dialect, as effects.js today)
  step: string
  payload: object                 # verb-specific body (see the request/verdict records)
  prev: hex                       # SHA-256 of the previous physical line's raw bytes; genesis = sha256(run_id)
  producer_hmac: hex   OPTIONAL   # present IFF author = producer; HMAC-SHA256 over canonicalBytes under K_producer
  commissaire_sig: base64 OPTIONAL# present IFF author = commissaire; Ed25519 signature over canonicalBytes under SK_commissaire

  CONSTRAINT producer_id is present and non-empty
  CONSTRAINT author = producer  =>  producer_hmac present, commissaire_sig absent
  CONSTRAINT author = commissaire => commissaire_sig present, producer_hmac absent
  CONSTRAINT effect-decision-verdict and accepted_under_contract have author = commissaire (a producer-driven path is refused these kinds)
  CONSTRAINT canonicalBytes(record) is a deterministic serialisation (stable key order) EXCLUDING both auth fields, so producer_hmac / commissaire_sig / prev are reproducible
```

```
RECORD ProducerAdmission (schema:3, admission record; author = commissaire):
  producer_id: string
  contract_revision: string
  admitted_scope: Set<EffectKind>   # the effect kinds this producer may request decisions for
  key_ref: string                   # opaque handle to how K_producer was derived (HKDF label), never the key itself
  pk_fingerprint: hex               # SHA-256 of PK_commissaire the producer must pin
  admitted_at: ISO-8601 string
  status: enum { admitted, revoked } # a revoked producer's later records fail the auth leg
```

```
ENUM DecisionVerdict: grant | deny
RECORD EffectDecisionRequest (payload for kind_of_entry = effect-decision-request; author = producer):
  effect: EffectDescriptor          # {kind, target, reversible}; validated by effectDescriptorViolations (effects.js:64)
  declared_ref: seq | null          # the declare record this request is covered by, if pre-declared
RECORD EffectDecisionVerdict (payload for kind_of_entry = effect-decision-verdict; author = commissaire):
  request_seq: integer              # the request this verdict answers
  verdict: DecisionVerdict
  reason: string                    # why granted or denied (policy leg names)
```

### Interfaces

```
INTERFACE CommissaireFacade (external CLI: `faff commissaire <verb> ...`):
  admit          --producer <id> --contract-revision <r> [--scope kind,kind]   # verb: admission; emits K_producer + publishes PK
  declare        --run-dir <dir> --producer <id> --issue <i> --step <s>  (stdin: EffectDescriptor[])
  request-decision --run-dir <dir> --producer <id> --issue <i> --step <s>  (stdin: EffectDecisionRequest)   # verb 3
  observe        --run-dir <dir> --producer <id> --issue <i> --step <s>  (stdin: EffectDescriptor[])
  reconcile      --run-dir <dir> --producer <id> --issue <i>                     # verb 4 (wraps computeEscapes)
  terminal-verdict --run-dir <dir> ...       # verb 5 (boundary stub over events anchor / floor)
  seal-bundle    --run-dir <dir> ...         # verb 6 (boundary stub over bundle)
```

```
INTERFACE ProducerAuth (lib/producer-auth.js, region: governance; pure), symmetric producer CLAIMS:
  deriveKey(masterSecretOrHandle, producer_id, contract_revision) -> key   # node:crypto hkdfSync
  signRecord(recordWithoutAuth, key) -> hex                                # node:crypto createHmac('sha256')
  verifyRecord(record, key) -> boolean                                     # recompute over canonicalBytes, timingSafeEqual
  canonicalBytes(record) -> Buffer                                         # deterministic serialisation excluding both auth fields (shared with CommissaireAuth)
```

```
INTERFACE CommissaireAuth (lib/producer-auth.js, region: governance; pure), asymmetric Commissaire DECISIONS:
  mintGovernorKeypair() -> { sk, pk, pk_fingerprint }                      # node:crypto generateKeyPairSync('ed25519'); fingerprint = sha256(pk DER)
  signDecision(recordWithoutSig, sk) -> base64                            # node:crypto sign(null, canonicalBytes(record), sk)
  verifyDecision(record, pk) -> boolean                                    # node:crypto verify(null, canonicalBytes(record), pk, sigBytes)
```

`canonicalBytes` is one shared serialiser both interfaces call, so a producer HMAC and a Commissaire signature cover the same byte image (minus the auth fields). A chokepoint that holds only `PK_commissaire` calls `verifyDecision`; it never needs the symmetric key.

**Design decision (envelope).** Options: (a) bump the effects record in place to add auth fields under `schema:2`; (b) a new `schema:3` neutral envelope with a compatibility arm. **Chosen:** (b) `schema:3` neutral envelope plus a classification arm in `events.js:693` `verifyLedgerChain`; schema-2 readers (`merge-gate.js`, `governance-check.js`, `effects check`) stay untouched, and a compatibility reader treats schema-2 `declared-effects.jsonl` as frozen pre-cutover history. Rationale: matches the state-authority "translated" outcome (`STATE-AUTHORITY-MAP-v5.md:424`) and avoids a second canonical history. Fixed by brief.

**Design decision (module placement).** **Chosen:** the facade shell (`lib/commissaire.js`, region factory) holds the external CLI, admission, key delivery, and `PK` publication, and requires the governance cores; the pure cores (`lib/producer-auth.js` carrying both `ProducerAuth` and `CommissaireAuth`, the `schema:3` classification arm in `events.js`, the decision-evaluation core) stay in region governance so `verifyLedgerChain` and `governance-check.js` can call them without a governance file ever requiring a factory file. Rationale: the region direction lint (`regions.js`) forbids governance to factory; factory to governance is legal and is the intended package-consumer relationship. **Anti-pattern:** putting the decision-evaluation, HMAC-verify, or Ed25519-verify core in `commissaire.js` (factory) and having `governance-check.js` (factory) or `events.js` (governance) reach for it. Why: `events.js` is governance and cannot require a factory module; the lint fails and there is no suppression mechanism (`regions.js` header).

## 4. HOW: behaviour

### Architecture and approach

A second producer drives the `commissaire` facade. `admit` establishes the producer's admitted scope, delivers `K_producer` over the admission channel, and publishes `PK_commissaire` with its fingerprint. Every record the producer then writes is enveloped as `schema:3` with `author = producer`, hash-chained exactly as the schema-2 effects ledger is today (one lock, gap-free seq, `prev` over the previous physical line), and carries a `producer_hmac`. The core new behaviour is verb 3: before causing a protected effect the producer requests a decision; Commissaire (the governor half, holding `SK_commissaire`) evaluates and writes a grant-or-deny verdict record with `author = commissaire` and a `commissaire_sig`. That signed verdict is the primitive. Prevention happens when a chokepoint on the effect path verifies the signature before permitting the effect; the worked chokepoint is `merge-gate`. Detection (verb 4) runs alongside, so an effect that occurred through an ungoverned path is still caught by observed-minus-declared.

The chain and the anchor witness are reused. `appendEffectEntries` (`effects.js:509`) already mints chained records under one lock via `appendRecordsUnderLock`; the `schema:3` path calls the same primitive with the extended record factory and the added auth field. `mintIssueAnchor` (`events.js:1263` writes `effects-chain-head.json`) byte-copies the ledger; no anchor change is needed because `computeChainHead` (`events.js:812`) is a hash fold over the bytes, schema-agnostic.

### The mediated protected-effect-decision gateway (verb 3)

Summary: a producer requests a decision; Commissaire evaluates every leg and writes a signed grant-or-deny; the signed decision is what a chokepoint later verifies to permit or refuse the effect. The gateway produces the decision; it does not itself perform or block the effect.

```
PROCEDURE request_decision(run_dir, producer_id, issue, step, request_record):   # runs as Commissaire (governor half; holds SK, master)
  1. Load ProducerAdmission for producer_id.
     a. IF absent OR status = revoked -> write a signed DENY (reason "producer-not-admitted"); never write a grant.
  2. Authenticate the producer's request:
     a. key = deriveKey(master, producer_id, contract_revision)
     b. IF NOT verifyRecord(request_record, key) -> signed DENY (reason "producer-auth-failed").
  3. Scope: IF request.effect.kind NOT IN admission.admitted_scope -> signed DENY (reason "effect-out-of-scope").
  4. Descriptor: run effectDescriptorViolations(request.effect) (effects.js:64); IF violations -> signed DENY (reason "invalid-effect-descriptor").
  5. Coverage / freshness:
     a. Resolve the current chain head; IF the request relies on evidence older than the latest observation for (issue, step) -> signed DENY (reason "stale-evidence").
     b. Coverage-by-declaration: a granted effect must be declared or wildcard-covered (effectTargetMatches, effects.js:81).
  6. Assurance floor: the request must meet the E-B obligation; a J-D self-declared artifact or an E-C observation MUST NOT be accepted in place of a grant.
  7. verdict = grant IFF every leg passes; ELSE deny with the first failing leg's reason.
  8. Build the verdict record: author = commissaire, kind_of_entry = effect-decision-verdict, no producer_hmac.
     sig = signDecision(verdict_record, SK_commissaire); attach as commissaire_sig.
     Append it chained under the same lock; return {verdict, reason, verdict_seq}.
  9. The producer may perform the effect ONLY on a grant; a chokepoint on the path independently re-verifies (below).
```

```
PROCEDURE chokepoint_permit(effect, verdict_record, PK_commissaire):   # runs where prevention happens (e.g. merge-gate); holds PK only
  1. IF verdict_record.author != commissaire -> REFUSE (a producer-authored verdict is not a decision).
  2. IF NOT verifyDecision(verdict_record, PK_commissaire) -> REFUSE (forged / tampered decision; a producer HMAC does not verify as an Ed25519 sig).
  3. Verify under the chokepoint's PINNED PK only: IF the fingerprint of the PK in use != the fingerprint pinned at setup -> REFUSE (swapped public key). The verdict record carries no fingerprint of its own; the pin lives on the chokepoint's held PK.
  4. IF verdict_record.verdict != grant OR it does not cover `effect` -> REFUSE.
  5. ELSE PERMIT the effect.
```

**Anti-pattern:** letting the producer write its own `effect-decision-verdict`, or a chokepoint accepting a record without calling `verifyDecision`. Why: producer proposes, Commissaire disposes; a producer-authored or unverified grant is exactly the forged obligation the split-key design refuses. Enforce by refusing `author = producer` on the verdict kinds and by making `verifyDecision` a required leg at every chokepoint.

### Per-record authentication: producer claims (HMAC) and Commissaire decisions (Ed25519)

Summary: bind each record to its author so a forged or out-of-scope record is mechanically detectable, and so a producer can never mint a decision.

```
PROCEDURE append_producer_record(run_dir, producer_id, kind, issue, step, payload):   # author = producer
  1. key = deriveKey(master, producer_id, contract_revision)   # producer holds K_producer directly; governor can re-derive
  2. Inside appendRecordsUnderLock (events.js): assign seq + prev as today.
  3. Build the record (author = producer) without auth fields; producer_hmac = signRecord(canonicalBytes(record), key).
  4. Write the line. The HMAC is part of the hashed bytes for the NEXT record's prev, so tampering an HMAC also breaks the chain.
```

```
PROCEDURE append_commissaire_record(run_dir, kind, issue, step, payload):   # author = commissaire; kinds: effect-decision-verdict, accepted_under_contract
  1. Inside appendRecordsUnderLock: assign seq + prev as today.
  2. Build the record (author = commissaire) without auth fields; commissaire_sig = signDecision(canonicalBytes(record), SK_commissaire).
  3. Write the line. SK_commissaire is held only by the governor; a producer has no path to produce this field.
```

```
PROCEDURE verify_auth_leg(dir):    # extends the integrity leg (governance-check.js:215)
  FOR each schema:3 record in the ledger:
    IF record.author = producer:
      a. key = deriveKey(master, record.producer_id, record.contract_revision)
      b. IF NOT verifyRecord(record, key) -> FAIL-CLOSED "producer-auth-mismatch".
      c. IF record.producer_id not admitted at record.ts -> FAIL-CLOSED "producer-not-admitted".
    IF record.author = commissaire:
      d. IF NOT verifyDecision(record, PK_commissaire) -> FAIL-CLOSED "commissaire-sig-invalid" (a producer-forged verdict lands here).
  Records at schema < 3 skip this leg (frozen pre-cutover history; the compatibility reader classifies them, never re-authenticates them).
```

The auth leg composes into the existing integrity classification (`integrityLegForChain`, `governance-check.js:170`), so an auth failure gates a merge exactly as a broken chain does. Producer claims target J-C: mechanical, record-granularity forgery detection, symmetric HMAC, explicitly not non-repudiation (a holder of `K_producer` could have written any of its claims). Commissaire decisions are asymmetric: a chokepoint or auditor with only `PK_commissaire` can verify them and cannot forge them. Verifying a producer *claim* still needs the symmetric key, which is the honest limit; asymmetric producer signing is the future stronger rung, not built here.

### The schema-3 classification arm and the compatibility reader

Summary: `verifyLedgerChain` (`events.js:693`) already classifies by walking the physical chain and by `schema_floor`; the arm adds `schema:3` recognition without disturbing the schema-1/schema-2 paths.

```
PROCEDURE verifyLedgerChain schema-3 arm (extends events.js:693):
  1. walkPhysicalChain is unchanged (genesis + per-line prev, schema-agnostic).
  2. schema_floor stays min(schema over records); a pure schema:3 ledger has floor 3.
  3. When floor is 3, the governance integrity leg additionally runs verify_auth_leg (both authors). The plain `effects verify` chain walk stays auth-agnostic so a producer without keys can still self-check chain integrity.
  4. A ledger mixing schema:2 and schema:3 is classified "mixed" as today; schema:2 lines are content-verifiable by prev but carry no auth field (frozen history), never auth-checked.
```

```
PROCEDURE compatibility_reader(dir):    # the historical-compatibility reader
  1. A pre-cutover schema-2 declared-effects.jsonl is read verbatim as frozen effect-intent history (STATE-AUTHORITY-MAP-v5.md:424, "translated").
  2. It is NEVER re-enveloped, re-authenticated, or mirrored into a schema:3 canonical history.
  3. A new run in this slice starts a fresh schema:3 ledger; the two never share a run_id / genesis.
```

### Compatibility aliases over one set of typed handlers

Current `faff effects declare/observe/check/verify` paths are preserved as compatibility aliases over the same typed handlers the facade calls. The facade verbs and the current CLI verbs both resolve to one internal handler per verb; there is no forked implementation. Current skills and SuperDomestique scheduling stay out of the external consumer by construction: the facade shell in factory requires only governance cores, never scheduling or slot modules.

### The merge chokepoint (worked prevention example)

Summary: `merge-gate` is the one chokepoint this slice wires to demonstrate that a verified decision prevents an effect. The check MUST sit on the pre-merge floor (`decideFloor`), computed before the merge is performed, not on the post-merge observe path which runs only after the merge is already final.

```
PROCEDURE merge_chokepoint (adds a decision leg to the pure pre-merge floor decideFloor in contract-defs, computed BEFORE the merge spawn at merge-gate.js:1272 — the same locus where the integrity/witness legs already gate at merge-gate.js:998 / :1218):
  1. In the impure shell, before the merge, decide whether Commissaire governance applies to THIS merge — a three-state signal, not two:
     - "not-applicable": no admitted producer and no schema:3 decision context for this (issue, step=merge) — an ordinary faff merge that never entered the facade. This is the common case for existing merges.
     - otherwise (governance applies: an admitted producer and a schema:3 decision context exist for it): compute
       decision_grant := chokepoint_permit(mergeEffect, verdict_record, PK_commissaire) == PERMIT ? "valid-grant" : "absent-or-invalid".
  2. Feed decision_grant ("not-applicable" | "valid-grant" | "absent-or-invalid") into decideFloor as an additional floor leg. decideFloor stays pure and provenance-blind, exactly as it consumes review_verdict / ci_state / head_sha_matches today.
  3. The decision leg is a NO-OP on "not-applicable" (a level-aware default that mirrors the integrity leg's `unasserted-ok`, so ordinary ungoverned merges are unaffected) and on "valid-grant"; it emits a BLOCKER ONLY on "absent-or-invalid" (governance applies but the grant is missing, forged, or non-covering), refusing that merge BEFORE the spawn. This is the E-B raise: prevention at a chokepoint that verifies an unforgeable decision, enforced pre-merge exactly as a broken chain blocks a merge today, WITHOUT blocking merges the facade never governed.
  4. The post-merge observe path (observeMergeEffects → warnUncoveredMergeObserves, merge-gate.js:723) is unchanged detection over the completed merge; it runs after the fact and is never the prevention locus (detection is never removed).
```

**Anti-pattern:** anchoring the refuse at `warnUncoveredMergeObserves` (`merge-gate.js:723`, reached only from `observeMergeEffects` AFTER the merge is already final — the `merge-gate.js:746` comment says the merge outcome is final by the time it runs). Why: a post-merge warn records but cannot prevent, the exact record-versus-prevent confusion round 1 flagged. Prevention must be a leg on the pure pre-merge floor (`decideFloor`) that fails closed on an absent or invalid `verifyDecision`. Generic effects with no such pre-effect floor stay detection-only, and the spec says so rather than over-claiming.

### Edge cases and error handling

- **Absent ledger.** A missing `declared-effects.jsonl` is a clean state, never an error, matching `effects check` (`effects.js:624`) and `verifyEffectsChain` (absent to verified, `events.js:795`).
- **Killed producer mid-run.** A producer killed after writing record N leaves a well-formed chain up to N; the chain verifies and a torn final line is tolerated as today (`events.js:771`). A killed producer later revoked has its subsequent records fail the auth leg.
- **Revoked producer.** `status = revoked` at record time fails `verify_auth_leg` step c, fail-closed.
- **Stale evidence.** A decision relying on evidence older than the latest observation is denied "stale-evidence" (mirrors holdout-freshness governance already applies via build-progress timestamps, `events.js:1268`).
- **Effect mismatch.** An observed effect covered by no declaration or grant surfaces as an escaped-side-effect via `computeEscapes` (`effects.js:87`); detection persists regardless of the chokepoint.
- **Forged decision.** A producer-HMAC'd fake `effect-decision-verdict` has `author = producer` (refused at chokepoint step 1) or, if it claims `author = commissaire`, fails `verifyDecision` (step 2). Either way the chokepoint refuses and the auth leg fails closed.
- **Forged / out-of-scope claim.** A bad `producer_hmac`, an unadmitted `producer_id`, or an out-of-scope effect kind fails the auth or scope leg, fail-closed; the gate treats it as a broken chain (`governance-check.js:188`).
- **Swapped public key.** If the `PK_commissaire` a chokepoint holds no longer matches the fingerprint it pinned at setup, the chokepoint refuses (chokepoint step 3); `PK` is public but integrity-pinned on the holder, not carried per record.
- **Malformed record.** Unreadable/invalid JSON is `malformed` and fail-closed, precedence over the witness cross-check as today (`events.js:747`).

### Failure modes

- **The failure:** the E-B claim is hollow because the effect has no chokepoint on its path, so the signed decision changes nothing and the effect lands unprevented. How you would know: the "effect mismatch" fixture shows an ungoverned effect landing with only a post-hoc escape signal and no chokepoint refusal. What it means: this is expected and in-scope; the claim is "prevention at a chokepoint that verifies the decision" (worked on merge), detection everywhere else. Do not widen it to blanket prevention.
- **The failure:** the split-key design is defeated because the producer somehow obtains `SK_commissaire` or `master_secret`. How you would know: the forged-grant fixture PASSES verification at the chokepoint (it should fail). What it means: the trust boundary leaked; the FAFF-360 harness must keep the two custodians in separate dirs/processes so one process never holds both, or the boundary is fiction.
- **The failure:** per-record producer HMAC gives a false sense of non-repudiation of claims. How you would know: a reviewer asks "which producer caused this claim" and the honest answer is "any holder of that producer's key". What it means: keep the stated J-C ceiling; do not let a consumer treat a valid producer HMAC as attribution. Decisions, by contrast, are non-repudiable to the governor because only it holds `SK`.

## 5. Scenarios

> 4 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

The required fixtures, expressed as born-verifiable objectives on the mkdtemp-mint-then-mutate + `runCli` pattern (`test/effects-chain.test.mjs`, `test/helpers/run-cli.mjs`). A minority are marked `holdout` for the code-blind evaluator. Each names its input shape and its oracle.

```
Given a freshly admitted second producer and a fresh schema:3 run dir
When it declares an effect {kind:merge,target:main}, requests a decision (granted), observes, and reconciles
Then every record is schema:3, the chain verifies, every producer_hmac verifies under K_producer, the verdict record verifies under PK_commissaire, and reconcile reports no escape
```
(fixture: pass. Input: admit P1 scope=merge, declare+request-decision+observe merge/main. Oracle: `verifyDecision`=true on the verdict, `verifyRecord`=true on each producer record, `computeEscapes.any_escape`=false.)

```
Given a chokepoint (merge-gate) holding only PK_commissaire and a genuine Ed25519-signed grant for {kind:merge,target:main}
When chokepoint_permit runs against the merge effect
Then it PERMITS the effect (verifyDecision=true, author=commissaire, verdict=grant, fingerprint matches)
```
(fixture: chokepoint-enforcement-pass. Input: a governor-signed grant record + the pinned PK. Oracle: `chokepoint_permit` returns PERMIT.)

```
Given an ordinary merge with no admitted producer and no schema:3 decision context (a merge the facade never governed)
When the pre-merge floor decideFloor runs with the new decision leg
Then decision_grant is "not-applicable", the decision leg is a no-op, and decideFloor returns exactly the blockers it returned before the leg existed (ordinary merges are unaffected)
```
(fixture: ungoverned-merge-unaffected, the blast-radius negative. Input: a merge floor with no commissaire decision context. Oracle: `decideFloor(floor).blockers` is byte-identical with and without the decision leg present; the merge is not blocked by it.)

(fixture: forged-grant-rejection, the headline security fixture. Input: a verdict record signed with the producer's HMAC key, not SK; the chokepoint holds PK only. Oracle: `verifyDecision`=false, `chokepoint_permit`=REFUSE.)

```
Given a run dir carrying a pre-cutover schema:2 declared-effects.jsonl (a seeded governance block)
When a new schema:3 run starts alongside it and both are read
Then the schema:2 ledger is classified frozen/translated via the compatibility reader, the schema:3 ledger is canonical, and no second canonical history is minted (distinct run_id / genesis)
```
(fixture: seeded-governance-block. Input: a seeded schema:2 jsonl + a fresh schema:3 run. Oracle: compatibility reader returns "frozen", run_ids differ, no schema:3 line mirrors a schema:2 record.)

(fixture: stale-evidence. Input: declare + observe (advances the head) + a request-decision resting on the pre-observation evidence. Oracle: the appended effect-decision-verdict has verdict=deny and reason="stale-evidence"; no grant verdict is written for that request. Exercises the verb-3 freshness leg, not the verb-5 terminal-verdict stub.)

```
Given a producer that causes an effect it never declared and never obtained a grant for
When reconcile (verb 4) runs
Then computeEscapes emits an escaped-side-effect signal for the uncovered effect (detection persists alongside the gate)
```
(fixture: effect-mismatch. Input: an observe with no matching declare/grant. Oracle: `computeEscapes.any_escape`=true naming the uncovered effect.)

```
Given a producer killed after writing a mid-chain record, then its admission revoked
When the integrity leg re-verifies the ledger
Then the chain up to the last complete line verifies (torn tail tolerated) and any record attributed to the revoked producer fails the auth leg fail-closed
```
(fixture: killed-producer. Input: truncate the final line, set admission status=revoked. Oracle: chain status verified-with-torn-tail, `verify_auth_leg`=FAIL-CLOSED "producer-not-admitted".)

(fixture: forged-or-out-of-scope-claim. Input: flip one HMAC byte / unknown producer / scope=deploy request for a merge-only producer. Oracle: DENY with the named reason, `verify_auth_leg`=FAIL-CLOSED.)

```
Given a sealed schema:3 chain for a completed run
When the terminal-verdict projection is recomputed twice from the SAME frozen ledger bytes (timestamps included)
Then both recomputations produce a byte-identical verdict projection
```
(fixture: replay-determinism. Input: the same frozen jsonl bytes read twice. Oracle: `computeChainHead` (a pure hash fold, `events.js:812`) and the verdict projection are byte-identical. Determinism holds because the projection is recomputed over frozen bytes, not re-executed, so nothing time-varying enters it.)

Assertions (non-functional objectives):

- The `commissaire` facade module's require graph imports neither SuperDomestique scheduling nor any `faffter-*` skill (verified by `faff regions check` plus a require-graph assertion).
- The producer half of the FAFF-360 harness holds only `K_producer` + `PK_commissaire`; the governor half holds `SK_commissaire` + `master_secret`. Assertion: no single process/dir in the harness holds both `SK` and any producer's derived key.
- Integration cost is materially smaller than whole-workflow adoption: the FAFF-360 bare Claude Code producer runs the governed workflow with no factory installed, using only the facade CLI and documented artifacts.
- Claims are limited to protocol sufficiency, authenticated record handling, mechanical detection, replay stability, and prevention at a chokepoint that verifies an unforgeable decision (stated in the facade docs; no blanket prevention asserted).

## 6. Design decision rationale

**Which envelope carries producer-agnostic records?**
Options: bump schema-2 in place (forces changes on every schema-2 reader); a new `schema:3` neutral envelope with a compatibility arm (readers untouched, old history frozen).
**Chosen:** the `schema:3` neutral envelope plus a classification arm in `verifyLedgerChain` (`events.js:693`); schema-2 readers untouched, schema-2 history frozen through a compatibility path. Matches the "translated" outcome; avoids a second canonical history. Fixed by brief.

**How is a producer claim bound to its author?**
Options: per-record HMAC under a per-producer key (symmetric, zero-dep, J-C); asymmetric producer signatures (non-repudiation of claims, no requirement this slice).
**Chosen:** per-record HMAC-SHA256 over canonicalBytes under `K_producer`, verified by recompute-and-`timingSafeEqual`, `node:crypto` only. Targets J-C; explicitly not non-repudiation of claims; asymmetric producer signing named as the future rung.

**How is a Commissaire decision made unforgeable by the producer?**
Options: HMAC the verdict under a shared/derived key (round-1: the producer holds a key that can then mint grants, the infosec blocker); sign the verdict with an Ed25519 key the producer never holds.
**Chosen:** Ed25519. The governor mints the keypair (`generateKeyPairSync('ed25519')`), signs each decision with `SK_commissaire` (`sign(null, canonicalBytes, sk)`), and publishes `PK_commissaire`; a chokepoint or auditor verifies with `PK` only (`verify(null, canonicalBytes, pk, sig)`). A producer holding only its HMAC key cannot produce a record that passes `verifyDecision`. Zero-dep `node:crypto`; resolves the round-1 infosec blocker.

**Where does the per-producer key come from, and where does the master live?**
Options: minted at admission and stored; HKDF-derived from a governor-held `master_secret` + `producer_id` + `contract_revision`.
**Chosen:** HKDF-derived. `K_producer = HKDF(master_secret, producer_id, contract_revision)` (`hkdfSync`); the governor holds `master_secret` and the Ed25519 keypair, and `faff commissaire admit` delivers `K_producer` over the admission channel and publishes `PK_commissaire`. The producer holds neither `master_secret` nor `SK`. This resolves the round-1 key-source Punt and the FAFF-360 provisioning question.

**Does the slice prevent, detect, or both, and where does prevention live?**
Options: claim the facade prevents effects (round-1 architectural blocker); reframe the facade as a decision primitive and locate prevention at an adopter chokepoint, keeping detection everywhere.
**Chosen:** the facade delivers a signed, verifiable decision; prevention is a chokepoint verifying that decision (worked on `merge-gate` via the pre-merge `decideFloor`), detection (observe-and-reconcile, verb 4) persists alongside, and generic effects with no chokepoint are detection-only. Resolves the round-1 architectural blocker; matches the exit-bar claims-scope.

**Where do the new modules live for the region lint?**
Options: everything in one factory facade module; split shell (factory) from cores (governance).
**Chosen:** facade shell `lib/commissaire.js` in factory; pure cores (`lib/producer-auth.js` holding both `ProducerAuth` and `CommissaireAuth`, the schema-3 arm in `events.js`, the decision-evaluation core) in governance, so no governance file requires a factory file. Enforced by `regions.js`, which has no suppression mechanism.

**What language and toolchain?**
**Chosen:** CommonJS, zero-dependency, `node:crypto` only (`generateKeyPairSync`, `sign`, `verify`, `hkdfSync`, `createHmac`, `timingSafeEqual`, all confirmed present); no TS, no build step. Introducing one crosses the ADR-0122 toolchain boundary and no entrypoint moves this slice. Fixed by brief.

**Who is the real external second producer?**
Options: build a bespoke external workflow; consume FAFF-360 (bare Claude Code on a non-faff repo, no factory installed).
**Chosen:** consume FAFF-360 as the one real-workflow harness, modelling governor and producer as two separate key custodians (two dirs/processes) even on one box; the negative/replay fixtures stay synthetic. Do not duplicate FAFF-360. Fixed by brief.

**Do we define a new evidence envelope?**
Options: define a rival Agent Delivery Evidence format; reconcile with FAFF-601's existing evidence spec.
**Assumes:** producer-authentication and record-handling reconcile with FAFF-601's Agent Delivery Evidence spec (FAFF-610's direction), not a rival envelope; FAFF-610 is parked. Validation: read FAFF-601 before designing the `schema:3` evidence payload.

**Should the compound facade verbs be split before depth?**
ADR 0122 records U1 (whether compound verbs 4 and 5/6 should be split before Phase 2A implements them, routed to FAFF-827 and the Phase-2A facade design).
**Punt:** whether verbs 4/5/6 are split into atomic operations before any is built to depth. Non-blocking: only verb 3 (already atomic) is built to depth; 4 is built shallow for detection; 5 and 6 are boundary stubs. (decides: architecture)

## 7. Open questions and assumptions

**Open questions:**

- **Compound-verb split (U1).** Whether facade verbs 4, 5, and 6 are split into atomic operations before any is built to depth. Only verb 3 is built to depth this slice, so this does not block the deliverable. (decides: architecture)

**Assumptions:**

- **FAFF-360 is available as the external harness.** The bare Claude Code session on a non-faff repo (no factory installed) is the one externally-executed governed workflow the Phase 2A exit evidence requires, and it must model governor and producer as two separate key custodians. Validation: confirm the FAFF-360 demo/fixture exists and is runnable, with the two-custodian split, before wiring the real-workflow evidence; the synthetic fixtures do not depend on it.
- **FAFF-601 is the evidence spec to reconcile with.** Producer-authentication and record-handling align with FAFF-601's Agent Delivery Evidence spec rather than a rival envelope; FAFF-610 (the marketplace-Action consumer) is parked. Validation: read FAFF-601 and confirm the evidence-record shape before finalising the `schema:3` payload.
- **`node:crypto` provides `generateKeyPairSync('ed25519')`, `sign`, `verify`, `hkdfSync`, `createHmac`, `timingSafeEqual`.** Validation: confirmed present on the repo's Node (ed25519 sign length 64, verify round-trips); re-confirm on the pinned CI Node before build.

## 8. DONE

### From WHY
- [ ] A second producer (not faff's runner) produces authenticated governed facts, an effect decision, reconciliation, a terminal verdict, and a sealed bundle using only the `commissaire` facade and documented artifacts. Fixture: pass. Oracle: the pass fixture completes and all records verify.
- [ ] Producer claims are HMAC-authenticated and Commissaire decisions are Ed25519-signed with a key the producer never holds. Fixture: forged-grant-rejection. Oracle: a producer-signed verdict fails `verifyDecision`.
- [ ] Detection (observe-and-reconcile, verb 4) still emits escaped-side-effect signals after the chokepoint is added. Fixture: effect-mismatch. Oracle: `computeEscapes.any_escape`=true.
- [ ] Prevention is realised at a chokepoint that verifies the decision, demonstrated on merge; generic effects with no chokepoint are detection-only and documented as such. Fixture: chokepoint-enforcement-pass + forged-grant-rejection. Oracle: PERMIT on a genuine grant, REFUSE on a forged one.
- [ ] The new decision leg on the global pre-merge floor is a no-op for ungoverned merges (decision_grant="not-applicable"), so ordinary merges the facade never governed are not blocked. Fixture: ungoverned-merge-unaffected. Oracle: `decideFloor(floor).blockers` unchanged with vs without the leg.
- [ ] No second canonical history: a pre-cutover schema-2 ledger is read as frozen history, never re-enveloped or mirrored. Fixture: seeded-governance-block. Oracle: distinct run_id/genesis, no mirrored line.
- [ ] Producer authentication is documented as J-C mechanical detection and explicitly not non-repudiation of claims; Commissaire decisions are non-repudiable to the governor. Oracle: facade docs carry both statements.

### From WHAT (types and interfaces)
- [ ] `schema:3` GovernanceRecord matches the defined shape, including `author` and exactly one of `producer_hmac` / `commissaire_sig` per the author constraints. Oracle: a record with both or neither auth field is rejected.
- [ ] A producer-driven path cannot write `effect-decision-verdict` or `accepted_under_contract` (author=commissaire enforced). Fixture: forged-grant-rejection. Oracle: the write is refused / the record fails at the chokepoint.
- [ ] ProducerAdmission carries producer_id, contract_revision, admitted_scope, key_ref, pk_fingerprint, status; a `revoked` status is honoured by the auth leg. Fixture: killed-producer. Oracle: revoked producer's records FAIL-CLOSED.
- [ ] The six facade verbs exist at the CLI boundary; verb 3 is implemented to depth; verbs 5 and 6 are boundary stubs over existing anchor/bundle handlers. Oracle: `faff commissaire <verb> --help` lists all six; 5/6 delegate.
- [ ] `lib/producer-auth.js` exposes `ProducerAuth` (deriveKey/signRecord/verifyRecord/canonicalBytes) and `CommissaireAuth` (mintGovernorKeypair/signDecision/verifyDecision) as pure `node:crypto`-only functions. Oracle: unit round-trip: HMAC verifies under key, Ed25519 verifies under PK, and a producer HMAC does not verify as a decision.

### From HOW (behaviour)
- [ ] `request_decision` denies on producer-not-admitted, producer-auth-failed, effect-out-of-scope, invalid-effect-descriptor, stale-evidence; grants only when every leg passes; writes an Ed25519-signed effect-decision-verdict. Fixtures: forged-or-out-of-scope-claim, stale-evidence, pass. Oracle: the named reason per input; a signed grant on the clean path.
- [ ] `chokepoint_permit` PERMITS only a genuine covering grant and REFUSES a forged/tampered/wrong-fingerprint/non-grant decision. Fixtures: chokepoint-enforcement-pass, forged-grant-rejection. Oracle: PERMIT vs REFUSE.
- [ ] Each producer `schema:3` record carries `producer_hmac` and each Commissaire record carries `commissaire_sig`, minted inside the lock that assigns seq/prev. Fixture: pass. Oracle: `verifyRecord`/`verifyDecision` true on each; tampering also breaks `prev`.
- [ ] `verifyLedgerChain` classifies a pure `schema:3` ledger with `schema_floor=3` and, in the governance integrity leg only, runs the auth leg over both authors; a schema:2/schema:3 mix classifies `mixed` and never auth-checks schema:2 lines. Fixtures: pass, seeded-governance-block. Oracle: floor and classification values.
- [ ] A forged/tampered producer claim, an unadmitted producer_id, an out-of-scope kind, or an invalid commissaire_sig fails the integrity leg fail-closed, gating a merge as a broken chain does. Fixtures: forged-or-out-of-scope-claim, forged-grant-rejection. Oracle: FAIL-CLOSED status.
- [ ] The compatibility reader reads a pre-cutover schema-2 ledger verbatim and starts a new schema:3 run under a distinct run_id/genesis. Fixture: seeded-governance-block. Oracle: as above.
- [ ] Current `faff effects declare/observe/check/verify` verbs still work as compatibility aliases over the same typed handlers (no forked implementation). Oracle: the existing effects tests still pass unchanged.
- [ ] The `commissaire` subcommand is wired: `COMMANDS` entry, `REGION_MAP: "commissaire"="factory"`, a `docs/guide/cli.md` row (lint-cli-doc passes), and a `cli-surface` grammar entry. Oracle: `faff regions check` and `lint-cli-doc` pass.

### From HOW (edge cases)
- [ ] Absent `declared-effects.jsonl` reads as clean, not an error. Oracle: exit 0, no ledger.
- [ ] A killed-producer torn tail is tolerated; a revoked producer's records fail the auth leg. Fixture: killed-producer.
- [ ] Stale evidence (older than the latest observation) is denied. Fixture: stale-evidence.
- [ ] An observed-but-undeclared/ungranted effect surfaces as an escaped-side-effect via `computeEscapes`. Fixture: effect-mismatch.
- [ ] A merge whose held `PK_commissaire` fingerprint no longer matches the pin is refused at the chokepoint. Oracle: `chokepoint_permit`=REFUSE on fingerprint mismatch.

### From SCENARIOS
- [ ] All fixtures exist as flat `test/*.test.mjs` under `node --test`, using mkdtemp-mint-then-mutate and `runCli`: pass, chokepoint-enforcement-pass, ungoverned-merge-unaffected, forged-grant-rejection, seeded-governance-block, stale-evidence, effect-mismatch, killed-producer, forged-or-out-of-scope-claim, replay-determinism.
- [ ] The replay fixture proves a byte-identical verdict projection across two recomputations from the same frozen bytes (projection over frozen bytes, not re-execution).
- [ ] A require-graph / harness assertion proves no single FAFF-360 harness process holds both `SK_commissaire` and any producer's derived key.

**Integration smoke test:**
```
PROCEDURE commissaire_smoke:
  1. `faff commissaire admit --producer P1 --contract-revision r1 --scope merge` into a fresh mkdtemp run dir (governor half mints the keypair + master; producer half receives K_producer + PK).
  2. `faff commissaire declare --producer P1 --issue FAFF-1 --step merge` (stdin: [{kind:merge,target:main}]).
  3. `faff commissaire request-decision --producer P1 --issue FAFF-1 --step merge` (stdin: {effect:{kind:merge,target:main}}) -> expect a grant record with a commissaire_sig.
  4. Assert every producer record has a valid producer_hmac and the verdict verifies under PK_commissaire; chokepoint_permit PERMITS the merge.
  5. Re-sign the verdict with P1's HMAC key instead of SK; assert verifyDecision fails and chokepoint_permit REFUSES.
  6. If steps 1-5 hold, the facade, the envelope, the chain, the split-key auth, and the chokepoint are connected.
```

confidence: high
spec-review: approve (L4 adversarial, faffter-dark-spec-review, 4 rounds; reject-approach → revise → revise → approve)
build-tier: complex

_Attached by `/faff-prep` (interactive). Spec-review gate: approve. Confidence gate: high. Ready for `/faff-graft`. Two legitimate deferrals carried: verbs 4/5/6 compound-split (ADR-0122 U1, routed to FAFF-827) and the FAFF-601 evidence reconciliation (validate before finalising the schema:3 payload)._