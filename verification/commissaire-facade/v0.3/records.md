# Facade records (`schema:3`, spec v0.3)

Spec v0.3 renames the conclusion record kind from `accepted_under_contract` to
`conformed_to_contract` (FAFF-1221). Every other record shape is unchanged from
[v0.2](../v0.2/records.md). Conclusions written before the rename keep `accepted_under_contract`
forever, because the kind is inside each record's signature, so v0.2 stays published as the read
shape for those frozen conclusions, and [v0.1](../v0.1/records.md) stays published for records
written before FAFF-1167, which carry `issue`.
[Reading v0.1, v0.2 and v0.3 records](#reading-v01-v02-and-v03-records) is the rule a reader
follows when one ledger holds more than one version.

The record kinds Commissaire's facade writes into `<run-dir>/declared-effects.jsonl`. Each
is one append-only, hash-chained JSON line. This page documents every kind with the shape
the sibling [evidence spec](../../evidence/) uses — Purpose / Location & lifecycle /
Producer / Consumer / Schema / Integrity / Example — so a reuser can build against the
object grammar without reading Commissaire's source.

The shapes and enums here **mirror the code, never redefine it**: `KIND_AUTHOR` and
`DECISION_VERDICTS` in
[`bin/lib/commissaire.js`](../../../plugin/skills/faff/bin/lib/commissaire.js),
`evaluateDecisionRequest` in
[`bin/lib/decision-policy.js`](../../../plugin/skills/faff/bin/lib/decision-policy.js), and
`EFFECT_KINDS`, `computeEscapes` and `conclusionKindOf` in
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
| `kind_of_entry` | enum | the stored record KIND (not the CLI action): `admission`, `declare`, `observe`, `effect-decision-request`, `effect-decision-verdict`, `reconcile`, `conformed_to_contract`. |
| `unit_id` | string | the work unit the record belongs to, or `-` on the admission. Named `issue` in v0.1. |
| `step` | string | effect step key, e.g. `merge`, `pr-create`, `admit`, `conclude`. |
| `prev` | string | SHA-256 hash link over the prior record. |

**The author-keyed authenticator.** Exactly one is present, keyed by `author`:

- `commissaire_sig` — Base64 Ed25519 signature, present **iff** `author == "commissaire"`.
- `producer_hmac` — hex HMAC under `K_producer`, present **iff** `author == "producer"`
  (it is a producer HMAC, not a "producer signature").

`KIND_AUTHOR` fixes which author writes each kind: the governor (`commissaire`) writes
`admission`, `effect-decision-verdict`, `conformed_to_contract`; the producer writes
`declare`, `observe`, `effect-decision-request` (and `reconcile` — see the caveat below).
The subset validator cannot express the iff-rule, so the CI test guards it against the real
records and `audit verify` re-checks it at replay.

## Reading v0.1, v0.2 and v0.3 records

Earlier versions carry `accepted_under_contract`; v0.3 carries `conformed_to_contract`. A reader
that asks "is this record a conclusion?" accepts both names.

The versions are told apart in two steps. v0.1 and v0.2 accept disjoint unit keys: a v0.1 schema
requires `issue` and a v0.2 or v0.3 schema requires `unit_id`, and all of them set
`additionalProperties: false`. v0.2 and v0.3 accept the same unit key and differ only in the
conclusion kind. Records of every other kind validate against both v0.2 and v0.3, and the rule
sends them to v0.3, the current version. The record `schema` integer is `3` in every version, so
it never tells the versions apart. A reader therefore **routes each record by its unit key, then
by its conclusion kind, and validates it against the routed version's schemas**:

```
PROCEDURE route_record(record) -> not-facade | v0.1 | v0.2 | v0.3 | rejected | unresolvable
  IF record.schema != 3:                                       RETURN not-facade
  hasIssue := record has own property "issue" with a value other than undefined
  hasUnit  := record has own property "unit_id" with a value other than undefined
  IF hasIssue AND hasUnit:                                     RETURN rejected
  key := "unit_id" IF hasUnit ELSE "issue" IF hasIssue ELSE none
  IF key is none OR record[key] is not a non-empty string:     RETURN unresolvable
  IF key == "issue":                                           RETURN v0.1
  IF record.kind_of_entry is exactly "accepted_under_contract": RETURN v0.2
  RETURN v0.3
```

| `route_record` returns | The record is | A reader |
|---|---|---|
| `v0.1` | a record written before FAFF-1167, carrying `issue` | resolves the unit from `issue` and validates the record against the [v0.1 schemas](../v0.1/schema/) |
| `v0.2` | a `unit_id`-keyed conclusion written before FAFF-1221, carrying `accepted_under_contract` | resolves the unit from `unit_id`, validates the record against the [v0.2 schemas](../v0.2/schema/), and treats it as a conclusion |
| `v0.3` | any other `unit_id`-keyed record, including every non-conclusion record written between FAFF-1167 and FAFF-1221 | resolves the unit from `unit_id` and validates the record against the v0.3 schemas |
| `rejected` | a dual-key record, carrying both `issue` and `unit_id` | rejects it, whatever the two values: it matches no unit, Commissaire denies a decision request over its ledger with `invalid-unit-key`, and `effect reconcile` reports it as its own `rejected-unit-key` escape. It validates against no version. |
| `unresolvable` | a record with no usable unit (no key, a non-string, or an empty string) | matches no unit. It fails every envelope, except that an empty-string `unit_id` passes the v0.2 and v0.3 envelopes (the subset validator has no `minLength`), so `route_record` is the only guard for that case. |
| `not-facade` | a `schema:2` row sharing the ledger | is out of this spec's scope; the [evidence spec](../../evidence/) covers it. It is never validated against any facade version. |

The legacy-kind step is written in plain-field form so a reader without SuperDomestique's source
can implement it. It is the same test as `conclusionKindOf(record) == LEGACY_CONCLUSION_KIND` in
[`bin/lib/effects.js`](../../../plugin/skills/faff/bin/lib/effects.js): `conclusionKindOf`
returns the stored `kind_of_entry` unchanged when it is `conformed_to_contract` or
`accepted_under_contract`, and `null` otherwise. It never rewrites the legacy name as the current
one. That function is the enforcement; this rule mirrors it.

A reader must never validate a mixed ledger against a single version, and must never widen an
enum, relax `additionalProperties`, or drop the unit key from `required` to make a mixed ledger
pass. Each change discards the guarantee that a record's shape is exactly what was signed. The key
step mirrors `unitIdOf` and `carriesBothUnitKeys` in `bin/lib/effects.js`, which enforce it.

Further rules:

- One ledger may hold v0.1-, v0.2- and v0.3-shaped records and `schema:2` rows (which keep
  `issue`). The compatibility reads of `issue` and `accepted_under_contract` are permanent, because
  frozen records are immutable.
- One ledger may hold conclusions of either name, but a single unit holds one: a unit concluded
  before FAFF-1221 and concluded again after it is idempotent and appends nothing.
- An `issue`-keyed record carrying `conformed_to_contract` is never written, because the writer
  moved to `unit_id` before the rename. It routes to v0.1 and fails it.
- `verdict conclude` output: `verdict` is always `conformed_to_contract` on success, and
  `kind_of_entry` reports the stored kind, so it reads `accepted_under_contract` when the unit's
  conclusion is a legacy record. This is CLI output, described here in prose and not schema'd.
- The dual-key rule applies to ledger records, not to CLI output. For one release the
  `verdict conclude` output, the `audit anchor` output and every `effect reconcile` escape carry
  both `issue` and `unit_id` with the same value. `effect declare` and `effect observe` print the
  signed record verbatim, so they show `unit_id` only.
- The CLI flag is `--unit-id`. `--issue` is a deprecated alias, kept until v0.4, and passing both
  is refused (exit 2) before any record is written.

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
- **Example.** [`admission.example.json`](schema/examples/admission.example.json), seq 0 of the source run (`unit_id: "-"`).

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
- **Example.** [`effect-claim.example.json`](schema/examples/effect-claim.example.json), the
  source run's `observe` (seq 6).

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
- **Example.** [`effect-decision-request.example.json`](schema/examples/effect-decision-request.example.json), seq 4 of the source run.

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
  | `invalid-unit-key` | the request's unit cannot be resolved to one non-empty string, or a record in the ledger snapshot carries both `issue` and `unit_id` |
  | `invalid-effect-descriptor` | malformed `{kind, target, reversible}` |
  | `effect-out-of-scope` | `kind` not in the producer's `admitted_scope` |
  | `stale-evidence` | request rests on evidence older than the latest observe |
  | `effect-not-declared` | no matching prior `declare` covers the effect |

- **Integrity.** Ed25519-signed; publicly verifiable from `pk.json` alone — a forged or
  tampered verdict fails closed regardless of whether the master secret is present.
- **Example.** [`effect-decision-verdict.example.json`](schema/examples/effect-decision-verdict.example.json), seq 5 of the source run (a grant). The source run's seq 2 is a deny with `effect-not-declared`.

## reconcile (detection output, not a ledger record)

- **Purpose.** Escape detection — the observed effects for a `(unit, step)` that no
  `declare` covers (observed-minus-declared), plus any dual-key record, reported on its own.
- **Location & lifecycle — read this carefully.** `commissaire effect reconcile` prints the
  `computeEscapes` result to **stdout**; the shipped verb does **not** append a ledger record.
  No code path writes a `kind_of_entry: "reconcile"` line, although `KIND_AUTHOR` reserves that
  kind for the producer. Treat `reconcile` as a detection **query** over the ledger, not a
  written record. (This corrects the grounding assumption that `reconcile` appends; the code is
  the source of truth.)
- **Producer.** `commissaire effect reconcile --run-dir DIR [--unit-id U]`.
- **Consumer.** `verdict conclude` refuses (`unreconciled-escape`) when `any_escape` is true;
  operators/auditors reading escape signals.
- **Schema.** [`schema/reconcile.schema.json`](schema/reconcile.schema.json):
  `{ escapes: [{ signal, issue, unit_id, step, seq?, escaped: [EffectDescriptor], event_seq }],
  any_escape }`.
  - `signal` is `escaped-side-effect` (observed effects no `declare` covers) or
    `rejected-unit-key` (one ledger record carrying both unit keys; it covers nothing, hides
    nothing, and is reported whatever the `--unit-id` filter, because it could belong to any unit).
  - `unit_id` is the escape's unit and `issue` is its one-release alias with the same value. Each
    is a non-empty string, or `null` on a `rejected-unit-key` escape or an escape with no
    resolvable unit. The subset validator cannot express string-or-null, so the schema leaves both
    untyped and the CI test enforces the rule.
  - `seq` is present on a `rejected-unit-key` escape and names the dual-key record; `escaped` is
    that record's effect, or empty when it has none.
- **Integrity.** A pure read over the ledger — it authenticates nothing itself; the ledger it
  reads is the authenticated artifact.
- **Examples, both generated.** A normal run has no escape (`any_escape: false`, empty
  `escapes`), so neither example comes from the source run.
  - [`reconcile.example.json`](schema/examples/reconcile.example.json): an undeclared `push`
    observed in a scratch run at `ec676cfc`, then `effect reconcile --unit-id DEMO-ESCAPE`.
  - [`reconcile-rejected-unit-key.example.json`](schema/examples/reconcile-rejected-unit-key.example.json):
    one correctly chained, producer-HMAC'd dual-key `observe` (`issue: "DEMO-A"`,
    `unit_id: "DEMO-B"`) planted in a scratch run at `ec676cfc`, then
    `effect reconcile --unit-id DEMO-1`. The escape appears although the filter names a different
    unit, and `audit verify` still passes over that run, because the planted record is authentic.

## conformed_to_contract (terminal verdict)

- **Purpose.** The governor's signed conclusion for a work unit. What the verdict means, and what
  it does not, is defined once in the [glossary](../../../docs/reference/GLOSSARY.md) under
  "conformed to contract".
- **Location & lifecycle.** Appended by `commissaire verdict conclude` on the clean path. A
  conclude on a unit with zero ledger records is **refused** (`no-evidence`) and writes
  nothing; a repeat conclude is idempotent (returns the existing seq).
- **Producer.** the governor (`author: "commissaire"`, Ed25519-signed). `conformed_to_contract`
  is the stored kind; `conclude` is the CLI action.
- **Earlier name.** Conclusions written before FAFF-1221 carry `accepted_under_contract`. They are
  read through [v0.2](../v0.2/records.md), by the routing rule in
  [Reading v0.1, v0.2 and v0.3 records](#reading-v01-v02-and-v03-records); this version's schemas
  reject them.
- **Consumer.** `audit verify`; a downstream consumer treating the unit as concluded; human
  auditors.
- **Schema.** [`schema/conformed-to-contract.schema.json`](schema/conformed-to-contract.schema.json).
  `payload`: `producer_id`, `contract_revision`, `evidence_seq_range` (`[min, max]` over the
  unit's entries), `escapes_checked`.
- **Integrity.** Ed25519-signed; conclude fails closed on a pk-fingerprint mismatch or an
  unreconciled escape before it signs.
- **Example.** [`conformed-to-contract.example.json`](schema/examples/conformed-to-contract.example.json),
  seq 7 of the source run. The driver revision `ec676cfc` predates FAFF-1225, which made
  `verdict conclude` refuse unless every observed protected effect was granted. The record shape
  did not change, and the source run's one observed effect (seq 6) was granted at seq 5, so the
  example meets the later rule too.

## Example sourcing

Every record example is carried from one governed run of the FAFF-360 harness
(`verification/external-verification/commissaire-bare-claude/`) against a driver checkout at
`ec676cfc`, the FAFF-1221 merge: run `run-20261014-130122-graft-DEMO-1`. That run's whole ledger
ships as [`source-run.declared-effects.jsonl`](schema/examples/source-run.declared-effects.jsonl)
(eight `schema:3` records; ledger records hold signatures, HMACs and public fields only), and the CI
test checks that each record example equals the ledger line with the same `seq`.

- `DEMO-1` (the unit) and `bare-claude` (the producer) are the harness's demonstration
  identifiers, not values to copy.
- The harness passes no policy `level`, so the verdict examples carry no `level`, `attended`,
  `level_policy`, `pure_verdict` or `pure_reason` fields; the schema keeps them optional.
- The three keypair examples come from the same run's custody files with `sk`, `master_secret` and
  `key_hex` redacted (see [keypair.md](keypair.md)). They and the `audit verify` counts in
  [conformance.md](conformance.md) remain attestations: the source run directory holds secrets and
  is not published.
- The two `reconcile` examples are generated, as described in the reconcile section.
