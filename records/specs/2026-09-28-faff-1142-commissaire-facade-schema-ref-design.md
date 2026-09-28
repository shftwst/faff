# Spec — FAFF-1142: Standalone Commissaire reuse doc + facade schema reference

> Spec: faffter-dark-nlspec · 2026-09-28 · interactive · claude-code/unknown · confidence: medium. Full spec on Linear FAFF-1142.

This is a buildable specification for FAFF-1142, a **documentation** ticket. The deliverable is doc content and declarative schema artifacts, not executable product code. Audience: the build agent that will author the docs, and the human reviewers who gate the result. It follows the nlspec four-phase arc (WHY / WHAT / HOW / DONE) with a Scenarios section and a design-decision record.

Product-name convention (per `docs/concept/positioning-and-language.md`): **SuperDomestique** is the product, **Commissaire** its governance system, and `faff` / `commissaire` are literal technical identifiers (repo, CLI, paths). This spec uses `faff` and `commissaire` for the CLI and file paths because those are what a builder types and greps.

---

## 1. WHY — Problem and Principles

**The central model.** Commissaire is a *split-key transparency log*. A **producer** (any actor driving a pipeline) holds only a symmetric `K_producer` (HKDF-derived from a governor-held `master_secret`) and HMACs its own **claims** — the effects it declares and observes. Only the **governor** holds the Ed25519 `SK_commissaire` and **signs decisions** — the grant/deny verdicts and the terminal verdict. Both write to one append-only, hash-chained ledger (`declared-effects.jsonl`). A reuser who wants governance embeds the standalone `commissaire` CLI, admits itself as a producer, declares effects before causing them, asks for authorization, and later replays the ledger from the published public key alone. Everything below serves a reuser building against that object grammar.

**Problem statement.** Commissaire is framed as a standalone, reusable governance layer, but a reuser gets only a conceptual pitch (`positioning-and-language.md`) plus one worked capture (`commissaire-bare-claude/`) and no citable schema for the object grammar they build against. The change adds a reuse-facing doc home plus a schema reference for the facade's own `schema:3` records, so a reuser can integrate Commissaire without reading its source.

**Design principles.**

- **Honesty over pitch.** Every trust claim states the mechanism and its current limit, using the enforced / attested / demonstrated / planned vocabulary from `positioning-and-language.md`. In particular the doc must not claim faff's own runner drives the facade everywhere — it does not (see Reference context, FAFF-1034).
- **Code stays the enforcement.** These docs *describe* what the shipped `commissaire` / `faff` code already produces and reads; they never become a second source of truth that could drift from a validator. A divergence between a doc and the code is a doc bug.
- **One home per fact.** Reuse the existing framing (`positioning-and-language.md`), ADRs, and the worked capture by linking, never by re-deriving. New prose earns its place only where no citable home exists today.
- **Skimmable.** Bullets and field tables over walls of prose, per the repo authoring standard.

**Reference context.**

| System | Kind | Relevance |
|---|---|---|
| `docs/concept/positioning-and-language.md` | Concept doc | Existing standalone framing (Ed25519 key/trust boundary, region vs facade). Link, do not restate. |
| `records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md` | ADR (Accepted) | The `commissaire <object> <action>` grammar + rationale; the object→action→record-kind map. |
| `records/adr/0042-*.md` | ADR | Three-tier region model; the `region:factory` extraction seam. |
| `records/adr/0064`, `0122`, `0126` | ADR | Effects authority split (declare-outside / observe); declared-effects cutover; merge chokepoint self-declares. |
| `docs/guide/cli.md` (the `commissaire` row, ~L194) | CLI guide | The authoritative in-repo prose for the facade surface, split-key model, deny reasons, and `audit verify` JSON contract. |
| `plugin/skills/faff/bin/commissaire` + `bin/lib/commissaire.js` | Source | The standalone binary and the pure decision cores (`evaluateDecisionRequest`, `chokepointPermit`, `verifyAuthLeg`, `computeEscapes`). Authoritative record shapes. |
| `verification/external-verification/commissaire-bare-claude/` | Worked capture | The one genuine embed-elsewhere example (one Stop hook + one verifier + two binaries, zero config). To be promoted to first-class docs. |
| `verification/evidence/` (`README.md`, `v0.1/`, `v0.2/`) | Versioned spec | Documents faff's flight-recorder artifacts; explicitly scopes signing/attestation OUT. The extend-vs-sibling anchor (Decision B). |
| `.faff/runs/run-20260927-182054-graft-FAFF-1138/` | Real run dir | Live source of hand-carried record + keypair examples. |
| FAFF-1034 (Linear, **Done** 2026-09-25, PR #945) | Ticket | Promoted faff's runner onto the facade **for the merge effect only**. Informs; does not block (Decision on FAFF-1034 below). |

**Scope statement.** This adds reuse-facing documentation beside the existing concept framing and the flight-recorder evidence spec; it defines no new runtime behaviour and changes no validator.

---

## 2. OUT OF SCOPE

- **Editing `positioning-and-language.md` copy.** — Why excluded: that page is the concept front door governed by its own writing rules; the reuse doc links to it. — Extension point: if the concept page's "faff's runner does not drive the facade" sentence (now stale for merge post-FAFF-1034) needs correcting, file a follow-up against that page.
- **Promoting faff's own runner onto the facade for more effects.** — Why excluded: that is FAFF-1034's follow-on work (custody + more effects), not documentation. — Extension point: FAFF-1034 and its successors.
- **New `commissaire` verbs, flags, or record kinds.** — Why excluded: this documents the shipped surface; it invents no behaviour. — Extension point: ADR-0123's "future direction, recorded not built" (typed per-object envelopes).
- **A prevention chokepoint for the reuser's effects.** — Why excluded: prevention is the reuser's own chokepoint act (the worked example is `merge-gate`); the doc describes the seam, it does not build one. — Extension point: the reuser's own effect path.
- **Retiring or rewriting the `verification/evidence/` posture.** — Why excluded: that spec's "emitter-authored, conformance ≠ authenticity" posture stays intact (Decision B keeps the facade spec a sibling). — Extension point: cross-links between the two specs.

---

## 3. WHAT — Vocabulary, Types, and Interfaces

### Vocabulary

| Term | Definition |
|---|---|
| Producer | An actor that drives a pipeline and causes protected effects; holds only `K_producer`. Records carry `author: "producer"`, HMAC'd. |
| Governor | The custodian of `SK_commissaire` + `master_secret`; signs decisions. Records carry `author: "commissaire"`, Ed25519-signed. |
| `K_producer` | Symmetric HMAC key, HKDF-derived from the governor's `master_secret`, delivered to the producer at admit. Binds producer *claims*. |
| `SK_commissaire` | Ed25519 private key held only by the governor. Signs *decisions*. Its public half `PK_commissaire` (`pk` + `pk_fingerprint`) is published for replay. |
| EffectDescriptor | The `{kind, target, reversible}` shape naming a protected effect. |
| Protected effect | An irreversible-or-consequential action (merge, push, branch-delete, ...) that must be declared and authorized. |
| Facade record | A `schema:3` line in `declared-effects.jsonl`. |
| Region seam | The `region:factory` boundary: the facade imports neither SuperDomestique scheduling nor any `faffter-*` skill (lint-checked by `faff regions check`). |

### Type definitions — the `schema:3` facade records

These are the shapes the schema reference must document. All fields **verified** against the real run dir, `commissaire --help`, `docs/guide/cli.md`, ADR-0123, and `bin/lib/commissaire.js`. Where this spec's shapes correct the ticket's grounding notes, that is flagged.

**Common envelope (every facade record).**

```
RECORD FacadeEnvelope:
  schema: 3                       # schema:3 is canonical for new runs (ADR-0122 cutover)
  run_id: String
  seq: Integer                    # 0-based position in this run's chain; seq 0 is the admission
  ts: Timestamp (ISO-8601)
  kind_of_entry: Enum             # the stored record KINDS (not the CLI action names):
                                  #   admission | declare | observe | effect-decision-request |
                                  #   effect-decision-verdict | reconcile | accepted_under_contract
  issue: String                   # "-" on the admission
  step: String                    # effect step key, e.g. "merge", "pr-create"
  prev: Hex(SHA-256)              # hash link over the prior record (chain integrity)
  # exactly one authenticator, keyed by author:
  author: "commissaire" | "producer"
  commissaire_sig: Base64(Ed25519)   # present iff author == "commissaire"
  producer_hmac: Hex(HMAC)           # present iff author == "producer"  (NOT a "producer sig")
```

**Admission record** (`kind_of_entry: "admission"`, `author: "commissaire"`, seq 0, signed):

```
RECORD Admission extends FacadeEnvelope:
  contract_revision: String       # e.g. "faff-runner-v1"
  producer_id: String
  payload:
    producer_id: String
    contract_revision: String
    admitted_scope: [EffectKind]  # the effect kinds this producer may cause
    pk_fingerprint: Hex           # the governor PK pinned for this run
    admitted_at: Timestamp
```

**EffectDescriptor** (stdin to `effect declare` / `effect observe`; embedded as `effect` in declare/observe records):

```
RECORD EffectDescriptor:
  kind: Enum      # merge | branch-delete | pr-create | push | label-write | file-write | tracker-write | ...
                  #   (the closed set is the producer's admitted_scope)
  target: String  # what the effect acts on (branch, PR base, "ISSUE:from->to", ...)
  reversible: Bool
```

**Declare / Observe record** (`kind_of_entry: "declare" | "observe"`, `author: "producer"`, HMAC'd):

```
RECORD EffectClaim extends FacadeEnvelope:
  producer_id: String
  contract_revision: String
  effect: EffectDescriptor
  # authenticated by producer_hmac
  CONSTRAINT author == "producer"
```

**Authorize** — the `effect authorize` action appends **two** records: a producer-authored request (`kind_of_entry: "effect-decision-request"`, HMAC'd) then the governor's signed verdict (`kind_of_entry: "effect-decision-verdict"`, `author: "commissaire"`, Ed25519-signed).

```
# stdin to `effect authorize`:
RECORD AuthorizeRequest:
  effect: EffectDescriptor
  declared_ref: Any?        # reference to the declare being authorized (nullable)
  evidence_seq: Integer?    # the seq of the declare this authorization covers
  level: String?            # L1..L4 policy input (assurance floor)
  attended: Bool?
  holdout: Bool?

# effect-decision-request payload mirrors the stdin fields (author: producer).
# effect-decision-verdict payload (author: commissaire, signed):
RECORD DecisionVerdict:
  verdict: "grant" | "deny"
  reason: Enum
  verdict_seq: Integer
  level: String?            # echoed policy inputs
  attended: Bool?
  holdout: Bool?

# deny reasons (from evaluateDecisionRequest, closed set):
#   producer-not-admitted | assurance-floor | producer-auth-failed |
#   invalid-effect-descriptor | effect-out-of-scope | stale-evidence | effect-not-declared
# grant reason: all-legs-pass
```

**Reconcile** (`kind_of_entry: "reconcile"`, `author: "producer"`) — the record `effect reconcile` appends, carrying `computeEscapes` (observed-minus-declared) detection.

**Conclude verdict** (`kind_of_entry: "accepted_under_contract"`, `author: "commissaire"`, signed) — appended by `verdict conclude` on the clean path, or a refusal (`no-evidence`) when the issue holds zero ledger records. (`accepted_under_contract` is the stored kind; `conclude` is the CLI action.)

### Keypair model — on-disk custody

Verified layout under `<run-dir>/commissaire/`. **The ticket grounding mis-attributed the `producer/pk.json` shape; the corrected shapes are below.**

| Path | Shape | Custody |
|---|---|---|
| `governor/governor.json` | `{ sk, pk, pk_fingerprint, master_secret }` — Ed25519 keypair (PEM) + HMAC master | Governor only; the secret half. |
| `producer/pk.json` | `{ pk, pk_fingerprint }` — the **published governor public key** the producer/verifier pins | Public; safe to ship. (NOT the fuller producer record.) |
| `producer/producers/<run-id>.json` | `{ producer_id, contract_revision, key_hex, pk, pk_fingerprint, admitted_scope[], status, admitted_at }` — `key_hex` is `K_producer` | Producer side; `key_hex` is the HMAC secret. |

`admit` refuses when `--governor-dir` and `--producer-dir` resolve to the same directory — `SK_commissaire` and any producer key must never share one custodian.

### CLI surface (documented, not changed)

```
commissaire contract admit   --run-dir DIR --producer ID --contract-revision R
                             [--scope kind,kind] [--governor-dir D] [--producer-dir D] [--force]
commissaire effect declare   --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])
commissaire effect authorize --run-dir DIR --producer ID --issue I --step S [--level L]  (stdin: AuthorizeRequest)
commissaire effect observe   --run-dir DIR --producer ID --issue I --step S   (stdin: EffectDescriptor[])
commissaire effect reconcile --run-dir DIR --issue I
commissaire verdict conclude --run-dir DIR --issue I [--producer ID] [--governor-dir D] [--producer-dir D]
commissaire audit seal       --run-dir DIR
commissaire audit export     --run-dir DIR --dest DIR
commissaire audit verify     --run-dir DIR [--governor-dir D] [--producer-dir D] [--json]
```

### Design decisions in the WHAT

**Decision B — where does the schema reference live?** Extend the existing `verification/evidence/` spec (a `v0.3` covering the facade records) vs a new sibling spec.

- *Extend:* one "build against this without reading source" spec becomes complete; reuses the versioning policy and CI harness. Cons: `verification/evidence/`'s stated posture is *"Signing and attestation are a separate trust layer, out of scope for this directory"* and *"Conformance ≠ authenticity ... artifacts are emitter-authored ... never a forging one."* The facade records are exactly that signing/attestation layer — folding them in inverts the spec's own conformance statement.
- *Sibling:* each spec stays internally coherent (flight-recorder = emitter-authored; facade = signature-verified, forgery-resistant), and serves a distinct reader (auditor of faff runs vs. reuser embedding Commissaire). Cross-link the two. Cons: two homes to discover.

**Chosen:** a new sibling spec under `verification/` (proposed `verification/commissaire-facade/`, versioned `v0.1/` mirroring the evidence-spec layout), cross-linked from `verification/evidence/README.md`. Rationale: the facade's trust posture is the opposite of the evidence spec's, so a sibling keeps each conformance statement honest; the reader is different too.

**Decision C — machine-checkable schemas or prose-only tables?** Prose field tables alone vs Draft-2020-12 JSON schemas + hand-carried examples + a CI test, matching the `verification/evidence/` precedent.

**Chosen:** author `schema/*.schema.json` (Draft 2020-12, `$id: faff/commissaire-facade/v0.1/<name>`) for the records that have **no** existing normative schema (verified: none of `EffectDescriptor`, the facade envelope, `effect-decision-verdict`, or `accepted_under_contract` has a schema under `plugin/skills/faff/contracts/`), plus examples hand-carried from the real run dir and a CI test that validates each example against its schema. Rationale: a citable schema is the ticket's core ask ("no citable schema for the object grammar"); prose tables alone are not buildable-against. Enums (deny reasons, `kind_of_entry`, effect kinds) restate the closed vocabularies exported by the source — mirror, never redefine.

---

## 4. HOW — Behaviour and structure of the deliverable

### Architecture of the deliverable

Three artifacts, one PR:

```
1. docs/guide/commissaire-reuse.md          — the reuse narrative + how-to (Decision A)
2. verification/commissaire-facade/          — the sibling schema reference (Decisions B, C)
     README.md, v0.1/{records.md, keypair.md, conformance.md}, v0.1/schema/*.schema.json,
     v0.1/schema/examples/*.example.json
3. cross-links: verification/evidence/README.md ← → the new sibling; docs/concept links to the guide
```

**Decision A — reuse doc home.** A concept page under `docs/concept/` vs a how-to under `docs/guide/`.

**Chosen:** `docs/guide/commissaire-reuse.md` (a how-to), linking up to `positioning-and-language.md` for the framing rather than restating it. Rationale: the reuser's job is procedural (embed the CLI, admit, declare, authorize, verify); `docs/guide/` is where how-tos live (`cli.md`, `governance-check.md`), and the concept framing already has a home.

**The reuse how-to (`docs/guide/commissaire-reuse.md`) covers, in order:**

1. **What Commissaire is, standalone** — the split-key transparency-log model (link the concept page; do not restate the naming transition).
2. **The `region:factory` extraction seam** — the facade imports neither SuperDomestique scheduling nor any `faffter-*` skill; `faff regions check` lints the boundary. This is why the CLI is embeddable without pulling in the orchestrator.
3. **Embed the CLI in your pipeline** — promote `commissaire-bare-claude/` to first-class docs: the shape (one Stop hook + one verifier + two binaries from one pinned checkout, zero config), the admit → declare → authorize → act → observe → reconcile → conclude → seal loop, and the honest bounds that capture's README already states (forgeable derived `source` label; residual human oracle; no isolation claim). Link the capture as the runnable artifact; the doc is the explanation, not a re-derivation.
4. **The out-of-process-signer how-to** — see Decision D.
5. **Point to the schema reference** for the object grammar.

**The schema reference (`verification/commissaire-facade/`)** documents each record kind with the same page shape the evidence spec uses (Purpose / Location & lifecycle / Producer / Consumer / Schema / Integrity / Example): the envelope, admission, EffectDescriptor, declare/observe claim, authorize decision verdict, conclude verdict, the hash-chain fields (`prev`/`seq`, `commissaire_sig` vs `producer_hmac`), and the governor/producer keypair model. Its `conformance.md` states the facade's own posture: signature/HMAC-verified, forgery-resistant, replayable secret-free via `audit verify` — distinct from the evidence spec's emitter-authored posture.

**Decision D — is the out-of-process-signer how-to in scope now?**

The `--governor-dir` / `--producer-dir` flags exist today on `admit`, `verdict conclude`, and `audit verify`; `admit` mints the governor keypair + master into `--governor-dir` and delivers `K_producer` + publishes `PK_commissaire` into a separate `--producer-dir`, and refuses when they coincide. `audit verify` is a secret-free replay from `pk.json` alone. So the mechanism a reuser needs is shipped and demonstrable.

**Chosen:** in scope now, bounded honestly. Document how a reuser runs the governor with its key material in a directory (or on a host) the producer never holds, hands the producer only `K_producer` + the published `pk.json`, and verifies later from the public key alone. State the limit plainly: this gives the reuser a real custody split, but **faff's own runner has not adopted an out-of-process governor** — FAFF-1034 landed an in-process governor for the merge effect only. Do not describe the flag mechanism as proof that faff prevents a lying runner.

### FAFF-1034 relationship (finding, not an open decision)

FAFF-1034 is **Done** (2026-09-25, PR #945): it promoted faff's runner onto the facade **for the merge effect only**, with the custody question resolved in-process. It therefore **informs** this doc (the honest current posture) and does **not block** it. Confirmed against a real post-1034 run (`run-20260927-182054-graft-FAFF-1138`): the merge/pr-create path emits `schema:3` producer-HMAC'd records, while some other effect steps in the same run still emit `schema:2` declares — i.e. faff drives the facade for merge, not uniformly. The doc must reflect this ("demonstrated for merge; other effects planned"), not overclaim.

**Anti-pattern:** stating or implying faff's runner governs all its own effects through the facade. Why: it governs merge only (FAFF-1034), and the concept page's blanket "does not drive the facade" line is itself now stale — the doc must state the per-effect truth.

**Anti-pattern:** copying the record shapes or split-key prose from `cli.md` / ADR-0123 into the new docs verbatim. Why: one home per fact — link and cite; a copy drifts.

### Failure modes

- **The failure:** the authored schemas encode a shape the code does not actually emit (drift), so a reuser builds against fiction. **How you'd know:** the CI test that validates hand-carried real-run examples against the schemas fails, or `commissaire audit verify --json` output does not match the documented `audit verify` contract. **What it means:** fix the schema, not the example — the code is the source of truth.
- **The failure:** the doc overclaims faff's own facade adoption (treats FAFF-1034 as "everywhere"). **How you'd know:** a reviewer greps a real recent run and finds `schema:2` declares for non-merge effects. **What it means:** narrow the claim to the demonstrated per-effect scope.

---

## 5. Scenarios — born-verifiable main objectives

```
Given the new verification/commissaire-facade/v0.1/schema/ directory
When the CI test validates each hand-carried example against its schema
Then every example (admission, EffectDescriptor, declare/observe claim, decision verdict,
     conclude verdict) validates, and each example is byte-sourced from a real run dir
```

```
Given a reuser following docs/guide/commissaire-reuse.md with only the two binaries and a pinned checkout
When they run admit (separate --governor-dir / --producer-dir) then audit verify --json against the ledger
Then audit verify replays from pk.json alone (no governor/producer secret) and returns result: pass
     with producer claims classified verified / unverifiable_without_secret / failed
```

- The schema reference documents every `schema:3` record kind Commissaire emits: `admission`, `declare`, `observe`, `effect-decision-request`, `effect-decision-verdict`, `reconcile`, `accepted_under_contract` — each with envelope fields, authenticator, and an example.
- The reuse how-to states each trust claim with its current limit using the enforced / attested / demonstrated / planned vocabulary; no claim asserts uniform faff-runner facade adoption.

---

## 6. Design Decision Rationale

**A. Where does the reuse doc live — `docs/concept/` or `docs/guide/`?**
Options: concept page (sits beside the framing) vs how-to (procedural). Concept risks duplicating `positioning-and-language.md`; how-to matches the reuser's procedural job and the existing `docs/guide/` home for CLI how-tos.
**Chosen:** `docs/guide/commissaire-reuse.md`, linking up to the concept page — rationale: procedural content, existing guide home, framing not duplicated.

**B. Extend `verification/evidence/` or add a sibling schema spec?**
Options in §3. Extending inverts the evidence spec's stated "signing out of scope / emitter-authored / conformance ≠ authenticity" posture; the facade records are the authenticity layer and serve a different reader.
**Chosen:** a sibling `verification/commissaire-facade/v0.1/`, cross-linked — rationale: each spec keeps a coherent, honest conformance statement.

**C. Machine-checkable schemas + examples + CI, or prose tables only?**
Options in §3. No normative schema for the facade records exists under `contracts/` today (verified), so authoring them creates the citable artifact the ticket asks for; prose alone is not buildable-against.
**Chosen:** Draft-2020-12 schemas + hand-carried real-run examples + a CI validation test, mirroring the evidence-spec precedent and its "mirror the source vocabularies, never redefine" rule.

**D. Out-of-process-signer how-to — now or punt?**
The `--governor-dir`/`--producer-dir` seam and secret-free `audit verify` are shipped and demonstrable, so the mechanism can be documented today; only faff's *own* uniform adoption is future work.
**Chosen:** in scope now, bounded — document the reuser-runnable custody split; state plainly that faff's own runner has an in-process governor for merge only (FAFF-1034).

**E. FAFF-1034 — block or inform?**
FAFF-1034 is Done. **Chosen:** it informs the honest posture; it does not block. (Finding, verified against Linear + a real run.)

Temporal anchor: at the time of writing (2026-09-28), faff's runner drives the facade for the merge effect only; other effects remain planned. Revisit the "demonstrated for merge" wording when a successor to FAFF-1034 lands.

---

## 7. Open Questions and Assumptions

### Open Questions

**Punt:** Ship as one ticket, or split into (1) the reuse narrative + out-of-process how-to and (2) the schema-reference spec? — needs human. **(decides: architecture)**
Context: the two artifacts have different homes and risk profiles (the schema reference is mechanical and high-certainty; the narrative + custody how-to carries more judgement), but they cross-cite heavily and are modest in size together. **Recommendation: keep as one unit** — a documentation pair that cross-references is cheaper to land and review together than to coordinate across two tickets; split only if the schema reference is wanted independently sooner. A reviewer can make this call without re-reading the spec.

### Assumptions

**Assumes:** the `schema:3` facade record shapes documented in §3 are the current canonical shapes (per ADR-0122 cutover and ADR-0123), stable enough to cite. — Validation: before writing, the build agent re-greps `bin/lib/commissaire.js` (`KIND_AUTHOR`, `DECISION_VERDICTS`, `evaluateDecisionRequest`, the record constructors) and `commissaire --help`, and hand-carries every example from a real run dir under `.faff/runs/` — never from memory — confirming each field against live bytes.

**Assumes:** a CI test hook comparable to `test/evidence-spec.test.mjs` can validate the new sibling spec's examples. — Validation: the build agent adds a test (e.g. `test/commissaire-facade-spec.test.mjs`) modelled on the evidence one, or extends the evidence test's discovery to the sibling directory; confirm the test runner picks it up.

---

## 8. DONE — Definition of Done

### From WHY
- [ ] A reuser can land on a single reuse-facing doc and understand the standalone split-key model without reading faff's build-loop prose.
- [ ] Every trust claim in the new docs carries its mechanism and current limit (enforced / attested / demonstrated / planned); none claims uniform faff-runner facade adoption.

### From WHAT (schema reference)
- [ ] Each `schema:3` record kind is documented with a field table and an authored Draft-2020-12 schema: envelope, `admission`, `EffectDescriptor`, declare/observe claim, `effect-decision-request`, `effect-decision-verdict`, `reconcile`, `accepted_under_contract`.
- [ ] **Example-sourcing (spec-review correction):** examples are byte-sourced from a real run dir for every kind that a normal governed run emits (admission, declare, observe, effect-decision-request, effect-decision-verdict, accepted_under_contract). `reconcile` is **escape-only** — a normal run emits none (`computeEscapes` appends it only on an unreconciled escape), so it cannot be byte-sourced like the others. Document `reconcile` from source and supply its example by **forcing an escape in a scratch run** (observed-minus-declared), clearly labelled as a generated-under-escape example rather than a normal-run capture. The "every example byte-sourced from a real run" rule in Scenarios applies to the normal-run kinds; `reconcile` follows this escape-generated path. Make the DoD/Scenarios/record-page list internally consistent about this (the record-page enumeration must include `reconcile`).
- [ ] The common envelope documents `schema`, `run_id`, `seq`, `ts`, `kind_of_entry`, `issue`, `step`, `prev`, and the author-keyed authenticator (`commissaire_sig` for `author:"commissaire"`, `producer_hmac` for `author:"producer"`).
- [ ] The deny-reason enum is documented as the closed set (`producer-not-admitted`, `assurance-floor`, `producer-auth-failed`, `invalid-effect-descriptor`, `effect-out-of-scope`, `stale-evidence`, `effect-not-declared`) and grant reason `all-legs-pass`, mirroring the source, not redefined.
- [ ] The keypair model documents `governor/governor.json` `{sk, pk, pk_fingerprint, master_secret}`, `producer/pk.json` `{pk, pk_fingerprint}`, and `producer/producers/<run-id>.json` including `key_hex` (`K_producer`), and states `admit` refuses coincident `--governor-dir`/`--producer-dir`.
- [ ] The schema reference is a sibling under `verification/commissaire-facade/` (Decision B), cross-linked from `verification/evidence/README.md`, with its own conformance statement (signature/HMAC-verified, secret-free replay).

### From HOW (reuse how-to)
- [ ] `docs/guide/commissaire-reuse.md` exists, links to `positioning-and-language.md` for framing, and covers: standalone model, `region:factory` seam (`faff regions check`), embedding the CLI (promoting `commissaire-bare-claude/`), the out-of-process-signer how-to, and a pointer to the schema reference.
- [ ] The out-of-process-signer section documents `--governor-dir`/`--producer-dir` + secret-free `audit verify`, and states the limit: faff's own runner uses an in-process governor (it drives the schema:3 facade for merge and pr-create; it does not run an out-of-process governor), so the reuser-runnable custody split is not proof faff itself prevents a lying runner.
- [ ] The docs cite the `commissaire-bare-claude/` capture as the runnable artifact rather than re-deriving it, and preserve that capture's stated bounds.

### From HOW (accuracy guards)
- [ ] No record shape or split-key prose is copied verbatim from `cli.md` / ADR-0123; all such facts are linked/cited.
- [ ] The facade-adoption posture is stated per-effect and **consistent with a real recent run: faff drives the schema:3 facade (signed governor verdicts) for the merge AND pr-create effects; push / tracker-write / label-write remain schema:2**. Do NOT write "merge effect only" — a real run (`run-20260927-182054-graft-FAFF-1138`) governs pr-create identically to merge (declare → effect-decision-request → signed effect-decision-verdict → observe). State it as "demonstrated for merge and pr-create; other effects planned". (Spec-review correction: the draft's "merge effect only" wording in Decision D / the FAFF-1034 finding is too narrow and contradicts the spec's own evidence — build to this corrected posture.)

### Eval coverage
- [ ] N/A — this ticket introduces no LLM-judgement seam.

### Integration smoke test

```
PROCEDURE smoke:
  1. Open docs/guide/commissaire-reuse.md; follow its links to the concept page,
     the commissaire-bare-claude capture, and the schema reference — all resolve.
  2. Run the schema-reference CI test (test/commissaire-facade-spec.test.mjs or the
     extended evidence test): every hand-carried example validates against its schema.
  3. In a scratch dir, run `commissaire contract admit` with separate --governor-dir
     and --producer-dir, then `commissaire audit verify --json --run-dir <dir>`:
     verify replays from pk.json alone and reports a pass with classified producer claims —
     matching the how-to's documented steps and output.
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

**Right-sized? — recommends SPLIT (contrary to the spec's keep-together lean).** One ticket bundles two units with different work textures: a versioned sibling schema-reference spec (`verification/commissaire-facade/v0.1/` — a README, prose pages, 7+ record-kind JSON schemas, hand-carried examples, a CI test) whose scope alone is comparable to the entire prior `verification/evidence/v0.1/` unit (6 schemas, 9 pages, 646 lines, one test), plus a judgment-heavy reuse how-to. The schema reference is mechanical and high-certainty (grep source constants, transcribe, CI-validate against real examples); the how-to is judgment-heavy (bounding trust-claim vocabulary, not overclaiming faff's per-effect adoption, promoting a worked example without re-deriving it). Landing them as one PR couples a fast CI-green half to a slower prose-judgment half in both directions. **What to do:** split, and sequence — land the schema-reference spec first (the ticket's stated core ask, mechanical, reviewable in isolation, needs nothing from the how-to), then the reuse how-to as an immediate follow-on that links to the now-existing schema reference (a real link, not a forward reference). The cross-citation the spec worries about coordinating is satisfied by sequencing, not a shared PR. **This is the spec's own `Punt (decides: architecture)` — a human ratifies the split call.**

**Workstream fit?** Project-less Backlog is correct for a bounded pair; do not manufacture a container for two tickets. A `relatedTo` link (as used for FAFF-1141/1034) keeps them discoverable.

**Deps surfaced? — add an explicit 1141/1142 content boundary.** FAFF-1141 (operator-facing, verifying faff's own runs — the evidence-spec side) and FAFF-1142 (reuser-facing, embedding Commissaire standalone — the facade side) are adjacent (both touch `audit verify` semantics, both link into `verification/`). `relatedTo` with no stated boundary risks the second-authored ticket re-deriving prose the other owns. **Boundary (fold into whichever lands second):** FAFF-1141 owns verifying faff's *own* runs (evidence spec, holdout verdicts, the on-disk map); FAFF-1142 owns verifying a *reuser's* standalone embed (facade schema spec, `audit verify` from `pk.json` alone, the reuse how-to). FAFF-1034 (Done) informs, does not block — no `blockedBy` on a Done ticket.

**Risk profile?** Medium confidence is calibrated: the dominant risk item is the split Punt (a human decision), and the schema-accuracy risk is de-risked by the CI-validates-real-examples design + the re-grep-before-writing validation step (the accepted `verification/evidence/` precedent). One residual gap worth a one-line note in the schema-reference README (mirroring the evidence spec's own posture): the CI test validates point-in-time examples, not live output from future runs, so post-ship drift in `commissaire.js` record shapes is not auto-re-flagged — an inherited gap, not new exposure.

confidence: medium
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "medium",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "punt" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
