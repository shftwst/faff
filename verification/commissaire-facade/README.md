# Commissaire facade schema reference

A versioned, in-repo description of the `schema:3` records **Commissaire's facade** writes
into a run's `declared-effects.jsonl` — the split-key transparency-log records a reuser builds
against when they embed Commissaire as a standalone governance layer, without reading its
source.

Commissaire is the governance system within **SuperDomestique (formerly known as `faff`)**;
`commissaire` / `faff` are the literal CLI and path identifiers a builder types. The standalone
model — a producer that HMACs its own claims, a governor that Ed25519-signs decisions, one
append-only hash-chained ledger — is framed in
[positioning-and-language.md](../../docs/concept/positioning-and-language.md); this directory is
the **citable schema** for the object grammar that framing describes.

The **code stays the enforcement**
([`bin/lib/commissaire.js`](../../plugin/skills/faff/bin/lib/commissaire.js),
[`bin/lib/effects.js`](../../plugin/skills/faff/bin/lib/effects.js), the `commissaire` CLI); this
directory is the citable description of what that code already produces and reads. A divergence
between a schema here and a validator is a **spec bug**, caught by the CI harness
([`test/commissaire-facade-spec.test.mjs`](../../test/commissaire-facade-spec.test.mjs)), never a
licence to relax the code.

## Sibling to the evidence spec

This spec is a **sibling** of [`verification/evidence/`](../evidence/), not a version of it.
They serve different readers and hold **opposite** trust postures:

- **evidence spec** — documents faff's own flight-recorder artifacts for an auditor of faff
  runs; artifacts are **emitter-authored** and signing is explicitly out of scope.
- **facade spec** (here) — documents the `schema:3` records for a reuser embedding Commissaire;
  records are **signature/HMAC-verified and forgery-resistant**, replayable secret-free via
  `audit verify`.

Folding the facade records into the evidence spec would invert that spec's own conformance
statement, so they stay siblings and cross-link. See [`v0.2/conformance.md`](v0.2/conformance.md).

## Versions

| Version | Status | What it covers |
|---|---|---|
| [`v0.2/`](v0.2/) | current | The same records with the envelope's work-unit key renamed `issue` → `unit_id` (FAFF-1167), the `invalid-unit-key` deny reason, the `rejected-unit-key` reconcile escape, and the rule for reading a ledger that holds both versions. |
| [`v0.1/`](v0.1/) | frozen | The `schema:3` facade records — the common envelope, `admission`, the `EffectDescriptor`, the declare/observe claim, `effect-decision-request`, `effect-decision-verdict`, the `reconcile` detection output, and `accepted_under_contract` — plus the on-disk governor/producer keypair model. The read shape for records written before the rename, which carry `issue`. |

## Layout

```
v0.2/                (v0.1/ has the same layout, without the source ledger)
  records.md        — every record kind (Purpose / Location / Producer / Consumer / Schema / Integrity / Example),
                      plus "Reading v0.1 and v0.2 records"
  keypair.md        — the on-disk governor/producer custody files
  conformance.md    — the facade's posture; the audit verify contract; drift note
  schema/*.schema.json           — Draft 2020-12, $id: faff/commissaire-facade/v0.2/<name>
  schema/examples/*.example.json — carried from a real run (see the example-sourcing note)
  schema/examples/source-run.declared-effects.jsonl — that run's whole ledger
```

## Schema authoring rules

- Draft 2020-12, `$id: faff/commissaire-facade/<version>/<name>`.
- **One source per fact.** Enums (`kind_of_entry`, the deny reasons, `EFFECT_KINDS`) **mirror**
  the closed vocabularies in `bin/lib/commissaire.js` (`KIND_AUTHOR`, `DECISION_VERDICTS`,
  `evaluateDecisionRequest`) and `bin/lib/effects.js` (`EFFECT_KINDS`, `computeEscapes`) — never
  redefined. Record shapes and split-key prose are **cited** from
  [`docs/guide/cli.md`](../../docs/guide/cli.md) and
  [ADR-0123](../../records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md),
  never copied.
- Schemas are validated by the shared subset checker
  [`validate-schema.mjs`](../../plugin/skills/faff/contracts/validate-schema.mjs) — it supports
  `type`, `required`, `properties`, `enum`, `additionalProperties`, `items`. Conditional rules
  (the author-keyed authenticator) are stated in prose and guarded by the CI test.

## Example-sourcing

**v0.2** examples come from one governed run of the FAFF-360 harness against a driver checkout at
`475c0362` (the FAFF-1167 merge), `run-20261005-063237-graft-DEMO-1`. The run's whole ledger ships
beside the examples, and the CI test checks each record example against it. The keypair examples
redact `sk`, `master_secret` and `key_hex`, and both `reconcile` examples are generated: one from a
forced escape, one from a planted dual-key record. Details:
[`v0.2/records.md`](v0.2/records.md#example-sourcing).

**v0.1** examples are **byte-sourced from a real governed run**
(`.faff/runs/run-20260927-182054-graft-FAFF-1138`) for every kind a normal governed run emits:
`admission`, `declare`/`observe`, `effect-decision-request`, `effect-decision-verdict`,
`accepted_under_contract` (and the derived `EffectDescriptor` / envelope). Two exceptions,
labelled where they appear:

- **`reconcile`** is escape-only — a normal run emits none. Its example was **generated under a
  forced escape** (observe an undeclared effect, then `effect reconcile`), not captured from a
  normal run. And note: `effect reconcile` prints to stdout; it does **not** append a ledger
  record (see [`v0.1/records.md`](v0.1/records.md)).
- **Keypair secrets** (`sk`, `master_secret`, `key_hex`) are **redacted** for publication; the
  public fields are real. See [`v0.1/keypair.md`](v0.1/keypair.md).

## Versioning policy

The spec version is independent of faff's release version and of the per-record `schema:`
field. Pre-1.0: every change to a documented shape bumps the minor (`v0.2`, …) with a dated
changelog entry; published version directories are immutable once landed. The CI test validates
point-in-time examples, not future live output — a later shape change is not auto-re-flagged, so
it must bump the version and re-carry the examples.

## Changelog

- **v0.2 — 2026-10-05 (FAFF-1175).** The envelope's work-unit key is `unit_id` (was `issue`);
  `step` is unchanged. The verdict reason `invalid-unit-key` is added. The `reconcile` escape gains
  `unit_id` beside `issue` (a one-release alias), the `rejected-unit-key` signal and its `seq`
  field. `records.md` adds the rule for reading v0.1 and v0.2 records from one ledger. The examples
  are re-carried from a run at `475c0362`, and the source ledger ships with them. v0.1 is frozen,
  unchanged.
- **v0.1 — 2026-09-28 (FAFF-1142).** Initial spec: the `schema:3` facade records and the
  on-disk keypair model, with schemas, hand-carried examples, and a CI validation test.
