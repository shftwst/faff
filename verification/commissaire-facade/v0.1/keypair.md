# Keypair model — on-disk custody

Commissaire is a **split-key** system: the producer holds only a symmetric HMAC key; the
governor holds the Ed25519 signing key and the HMAC master. `commissaire contract admit`
mints this material into two directories — a governor directory (the secret half) and a
producer directory (the producer's key plus the published public key) — and **refuses when
they resolve to the same directory**, so the signing key and a producer key never share one
custodian.

Framing: [positioning-and-language.md](../../../docs/concept/positioning-and-language.md).
Custody rationale: cited there and in the ADRs; this page documents the on-disk shapes, which
are the source of truth in
[`bin/lib/commissaire.js`](../../../plugin/skills/faff/bin/lib/commissaire.js).

| Path (under `<run-dir>/commissaire/`) | Shape | Custody |
|---|---|---|
| `governor/governor.json` | `{ sk, pk, pk_fingerprint, master_secret }` | Governor only — the secret half. |
| `producer/pk.json` | `{ pk, pk_fingerprint }` | Public — safe to ship and commit. |
| `producer/producers/<run-id>.json` | `{ producer_id, contract_revision, key_hex, pk, pk_fingerprint, admitted_scope[], status, admitted_at }` | Producer side — `key_hex` is the HMAC secret. |

## governor/governor.json

- **Purpose.** The governor's custody file: the Ed25519 keypair (PEM) plus the hex
  `master_secret` from which each producer's `K_producer` is HKDF-derived.
- **Producer.** `contract admit`, into `--governor-dir` (default `<run-dir>/commissaire/governor`).
- **Consumer.** `verdict conclude` and any signing operation (reads `sk`); the master derives
  producer keys.
- **Schema.** [`schema/governor-keypair.schema.json`](schema/governor-keypair.schema.json).
- **Custody.** Never delivered to a producer. `sk` and `master_secret` are the forgery-relevant
  secrets; a holder of either can mint or sign.
- **Example.** [`governor-keypair.example.json`](schema/examples/governor-keypair.example.json)
  — public `pk` / `pk_fingerprint` are byte-sourced; `sk` and `master_secret` are **redacted**
  for publication (see the redaction note below).

## producer/pk.json

- **Purpose.** The published governor public key — the producer- and verifier-side pin.
- **Producer.** `contract admit`, into `--producer-dir`.
- **Consumer.** `audit verify` (secret-free replay of commissaire decisions); `chokepointPermit`
  (verifies a signed grant, pinning `pk_fingerprint`).
- **Schema.** [`schema/producer-pk.schema.json`](schema/producer-pk.schema.json).
- **Custody.** Fully public.
- **Example.** [`producer-pk.example.json`](schema/examples/producer-pk.example.json) —
  byte-sourced, no redaction.

## producer/producers/&lt;run-id&gt;.json

- **Purpose.** The producer-side admission: `key_hex` (`K_producer`, the HMAC key), the pinned
  public key, the admitted scope, and status.
- **Producer.** `contract admit`, into `--producer-dir`.
- **Consumer.** the producer signing its claims (HMAC under `key_hex`);
  `evaluateDecisionRequest` (admission status + scope); `verdict conclude`.
- **Schema.** [`schema/producer-admission.schema.json`](schema/producer-admission.schema.json).
- **Custody.** `key_hex` is a secret held only by the producer. `status` is `admitted` or
  `revoked` — a revoked producer is denied (`producer-not-admitted`).
- **Example.** [`producer-admission.example.json`](schema/examples/producer-admission.example.json)
  — real except `key_hex`, which is **redacted**.

## A note on redaction

The three ledger-record examples' authenticators (`producer_hmac`, `commissaire_sig`) are safe
to publish — they are the ledger's own bytes, meant to be exported and replayed. The keypair
files are different: `sk`, `master_secret`, and `key_hex` are plaintext secrets. The examples
here keep every field's real shape and every public value, and replace only those three secret
values with a clearly-marked placeholder. This is a deliberate publication redaction, not the
on-disk shape — an honest departure from strict byte-sourcing, scoped to the secret-bearing
custody files alone.
