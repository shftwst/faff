# Facade records (`schema:3`)

The record kinds Commissaire's facade writes into `<run-dir>/declared-effects.jsonl`. Each
is one append-only, hash-chained JSON line. This page documents every kind with the shape
the sibling [evidence spec](../../evidence/) uses — Purpose / Location & lifecycle /
Producer / Consumer / Schema / Integrity / Example — so a reuser can build against the
object grammar without reading Commissaire's source.

The shapes and enums here **mirror the code, never redefine it**: `KIND_AUTHOR`,
`DECISION_VERDICTS`, and `evaluateDecisionRequest` in
[`bin/lib/commissaire.js`](../../../plugin/skills/faff/bin/lib/commissaire.js), and
`EFFECT_KINDS` / `computeEscapes` in
[`bin/lib/effects.js`](../../../plugin/skills/faff/bin/lib/effects.js). The split-key model
these serve is framed in [positioning-and-language.md](../../../docs/concept/positioning-and-language.md)
and the CLI grammar in
[ADR-0123](../../../records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md);
this page cites them rather than restating them.

## The common envelope

Every `schema:3` record carries these fields before its verb-specific body. Schema:
[`schema/facade-envelope.schema.json`](schema/facade-envelope.schema.json).

| Field | Type | Notes |
|---|---|---|
| `schema` | integer | `3` — canonical for governed records after the ADR-0122 cutover. |
| `run_id` | string | the run the chain belongs to. |
| `seq` | integer | 0-based position in the chain; `seq 0` is the admission. |
| `ts` | string | ISO-8601 timestamp. |
| `author` | enum | `commissaire` or `producer` — selects the authenticator. |
| `producer_id` | string | the admitted producer. |
| `contract_revision` | string | e.g. `faff-runner-v1`. |
| `kind_of_entry` | enum | the stored record KIND (not the CLI action): `admission`, `declare`, `observe`, `effect-decision-request`, `effect-decision-verdict`, `reconcile`, `accepted_under_contract`. |
| `issue` | string | tracker id, or `-` on the admission. |
| `step` | string | effect step key, e.g. `merge`, `pr-create`, `admit`, `conclude`. |
| `prev` | string | SHA-256 hash link over the prior record. |

**The author-keyed authenticator.** Exactly one is present, keyed by `author`:

- `commissaire_sig` — Base64 Ed25519 signature, present **iff** `author == "commissaire"`.
- `producer_hmac` — hex HMAC under `K_producer`, present **iff** `author == "producer"`
  (it is a producer HMAC, not a "producer signature").

`KIND_AUTHOR` fixes which author writes each kind: the governor (`commissaire`) writes
`admission`, `effect-decision-verdict`, `accepted_under_contract`; the producer writes
`declare`, `observe`, `effect-decision-request` (and `reconcile` — see the caveat below).
The subset validator cannot express the iff-rule, so the CI test guards it against the real
records and `audit verify` re-checks it at replay.

> **`schema:2` records share the file.** The same ledger also holds pre-cutover / ungoverned
> `schema:2` effect lines (a `declare`/`observe` with no `author`, `producer_id`, or
> authenticator). Those are out of scope here and are covered by the flight-recorder
> evidence spec. In a real recent run, faff drives the `schema:3` facade for the **merge and
> pr-create** effects; `push` / `tracker-write` / `label-write` are still `schema:2`. See
> [conformance.md](conformance.md).

## admission

- **Purpose.** The genesis record: the governor admits a producer, pins the run's public-key
  fingerprint, and records the admitted effect scope.
- **Location & lifecycle.** `seq 0` of `declared-effects.jsonl`; written once by
  `commissaire contract admit`.
- **Producer.** the governor (`author: "commissaire"`, Ed25519-signed).
- **Consumer.** `evaluateDecisionRequest` (leg 1: is the producer admitted, in scope?);
  `verdict conclude`; `audit verify`.
- **Schema.** [`schema/admission.schema.json`](schema/admission.schema.json). The `payload`
  carries `producer_id`, `contract_revision`, `admitted_scope[]` (a subset of `EFFECT_KINDS`),
  `pk_fingerprint`, `admitted_at`.
- **Integrity.** Ed25519-signed; `seq 0` anchors the chain. `admit` refuses when
  `--governor-dir` and `--producer-dir` coincide (see [keypair.md](keypair.md)).
- **Example.** [`admission.example.json`](schema/examples/admission.example.json) — byte-sourced.

## declare / observe claim

- **Purpose.** A producer's claim about a protected effect: `declare` states intent **before**
  the act; `observe` records that the act happened.
- **Location & lifecycle.** Appended by `commissaire effect declare` / `effect observe`; one
  record per `EffectDescriptor` on stdin.
- **Producer.** the producer (`author: "producer"`, HMAC'd under `K_producer`).
- **Consumer.** `evaluateDecisionRequest` (coverage leg: a grant needs a matching prior
  `declare`); `computeEscapes` (observed-minus-declared).
- **Schema.** [`schema/effect-claim.schema.json`](schema/effect-claim.schema.json); the
  embedded `effect` follows [`effect-descriptor.schema.json`](schema/effect-descriptor.schema.json).
- **Integrity.** HMAC binds the claim to the admitted producer; `prev` chains it.
- **Example.** [`effect-claim.example.json`](schema/examples/effect-claim.example.json) — a
  byte-sourced `observe`.

## EffectDescriptor

- **Purpose.** The `{kind, target, reversible}` shape naming a protected effect. Stdin to
  `effect declare` / `effect observe`; embedded as `effect` in declare/observe records and
  (as `{kind, target}`) in decision payloads.
- **Schema.** [`schema/effect-descriptor.schema.json`](schema/effect-descriptor.schema.json).
  `kind` enum mirrors `EFFECT_KINDS` (merge, branch-delete, deploy, db-migration,
  secret-rotation, email, webhook, registry-publish, force-push, prod-script, label-write,
  tracker-write, file-write, pr-create, push, other). A producer may only cause the subset in
  its own `admitted_scope`. `reversible` defaults to `true` (`normEffect`).
- **Example.** [`effect-descriptor.example.json`](schema/examples/effect-descriptor.example.json).

## effect-decision-request

- **Purpose.** The producer's request for a signed decision on a protected effect — the first
  of the two records `commissaire effect authorize` appends.
- **Producer.** the producer (`author: "producer"`, HMAC'd).
- **Consumer.** `evaluateDecisionRequest` reads the `payload.effect` and policy inputs to
  produce the verdict; `audit verify` replays it.
- **Schema.** [`schema/effect-decision-request.schema.json`](schema/effect-decision-request.schema.json).
  `payload` mirrors the stdin AuthorizeRequest: `effect` (`{kind, target}`), optional
  `declared_ref` (nullable), `evidence_seq`, `level` (L1..L4), `attended`, `holdout`.
- **Integrity.** HMAC'd; the assurance-floor leg refuses a weaker record standing in for a
  genuine request.
- **Example.** [`effect-decision-request.example.json`](schema/examples/effect-decision-request.example.json) — byte-sourced.

## effect-decision-verdict

- **Purpose.** The governor's grant/deny verdict on a request — the second record `effect
  authorize` appends.
- **Producer.** the governor (`author: "commissaire"`, Ed25519-signed).
- **Consumer.** `chokepointPermit` (a chokepoint permits an effect only against a signed,
  covering grant); `audit verify`; human auditors.
- **Schema.** [`schema/effect-decision-verdict.schema.json`](schema/effect-decision-verdict.schema.json).
  `payload`: `request_seq` (back-reference), `verdict` (`grant`/`deny`, from
  `DECISION_VERDICTS`), `reason`, `effect` (`{kind, target}`), and — when a `level` was
  supplied — `level`, `attended`, `level_policy` (`{pass, reason}`), `pure_verdict`,
  `pure_reason`.
- **Reason vocabulary (closed set, mirrors `evaluateDecisionRequest`).** `reason` is
  `all-legs-pass` on a grant, or the **first failing leg** on a deny:

  | Reason | Failing leg |
  |---|---|
  | `all-legs-pass` | grant — every leg passed |
  | `producer-not-admitted` | producer absent or revoked |
  | `assurance-floor` | a weaker record presented instead of a genuine request |
  | `producer-auth-failed` | the request's HMAC does not verify |
  | `invalid-effect-descriptor` | malformed `{kind, target, reversible}` |
  | `effect-out-of-scope` | `kind` not in the producer's `admitted_scope` |
  | `stale-evidence` | request rests on evidence older than the latest observe |
  | `effect-not-declared` | no matching prior `declare` covers the effect |

- **Integrity.** Ed25519-signed; publicly verifiable from `pk.json` alone — a forged or
  tampered verdict fails closed regardless of whether the master secret is present.
- **Example.** [`effect-decision-verdict.example.json`](schema/examples/effect-decision-verdict.example.json) — byte-sourced.

## reconcile (detection output, not a ledger record)

- **Purpose.** Escape detection — the observed effects for an `(issue, step)` that no
  `declare` covers (observed-minus-declared).
- **Location & lifecycle — read this carefully.** `commissaire effect reconcile` prints the
  `computeEscapes` result to **stdout**; the shipped verb does **not** append a ledger record.
  No code path writes a `kind_of_entry: "reconcile"` line, although `KIND_AUTHOR` reserves that
  kind for the producer. Treat `reconcile` as a detection **query** over the ledger, not a
  written record. (This corrects the grounding assumption that `reconcile` appends; the code is
  the source of truth.)
- **Producer.** `commissaire effect reconcile --run-dir DIR [--issue I]`.
- **Consumer.** `verdict conclude` refuses (`unreconciled-escape`) when `any_escape` is true;
  operators/auditors reading escape signals.
- **Schema.** [`schema/reconcile.schema.json`](schema/reconcile.schema.json):
  `{ escapes: [{ signal: "escaped-side-effect", issue, step, escaped: [EffectDescriptor],
  event_seq }], any_escape }`.
- **Integrity.** A pure read over the ledger — it authenticates nothing itself; the ledger it
  reads is the authenticated artifact.
- **Example — generated under a forced escape.** A normal run has no escape
  (`any_escape: false`, empty `escapes`). The shipped
  [`reconcile.example.json`](schema/examples/reconcile.example.json) was generated by observing
  an undeclared `push` in a scratch run and running `effect reconcile` — a
  generated-under-escape capture, not a normal-run one.

## accepted_under_contract (terminal verdict)

- **Purpose.** The governor's signed statement that an issue's evidence concluded under the
  contract, having checked for escapes.
- **Location & lifecycle.** Appended by `commissaire verdict conclude` on the clean path. A
  conclude on an issue with zero ledger records is **refused** (`no-evidence`) and writes
  nothing; a repeat conclude is idempotent (returns the existing seq).
- **Producer.** the governor (`author: "commissaire"`, Ed25519-signed). `accepted_under_contract`
  is the stored kind; `conclude` is the CLI action.
- **Consumer.** `audit verify`; a downstream consumer treating the issue as concluded; human
  auditors.
- **Schema.** [`schema/accepted-under-contract.schema.json`](schema/accepted-under-contract.schema.json).
  `payload`: `producer_id`, `contract_revision`, `evidence_seq_range` (`[min, max]` over the
  issue's entries), `escapes_checked`.
- **Integrity.** Ed25519-signed; conclude fails closed on a pk-fingerprint mismatch or an
  unreconciled escape before it signs.
- **Example.** [`accepted-under-contract.example.json`](schema/examples/accepted-under-contract.example.json) — byte-sourced.
