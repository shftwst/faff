# Conformance (v0.2)

The facade's trust posture — and how it differs from the sibling
[evidence spec](../../evidence/).

## 1. The claim

A conformant facade ledger is one whose `schema:3` records validate against these schemas
**and** whose authenticators verify: every `commissaire`-authored decision carries a valid
Ed25519 signature under the pinned public key, and every `producer`-authored claim carries a
valid HMAC under `K_producer`. The chain is hash-linked by `prev`, so any reordering or
tamper is detectable.

## 2. Signature/HMAC-verified, forgery-resistant

Unlike the evidence spec's emitter-authored artifacts, facade records are **cryptographically
authenticated**:

- **Commissaire decisions** (`admission`, `effect-decision-verdict`,
  `accepted_under_contract`) are Ed25519-signed. The public key is published, so a forged or
  tampered decision **fails closed** whether or not the verifier holds any secret. A producer
  that never holds `SK_commissaire` cannot mint a grant.
- **Producer claims** (`declare`, `observe`, `effect-decision-request`) are HMAC'd under
  `K_producer`. Verifying a claim needs the symmetric key (the master-derived secret), so a
  secret-free verifier records producer claims as `unverifiable_without_secret`, not as
  failures — an honest, non-blocking limit. When the master **is** present, a producer-auth
  mismatch or a revoked/unadmitted producer fails closed.

## 3. Secret-free replay via `audit verify`

`commissaire audit verify --run-dir DIR --json` replays the ledger's auth leg from
`producer/pk.json` **alone** — no governor or producer secret required. It emits (`version: 1`):

- `result` — `pass` / `fail`;
- `producer_claims` — counts by classification (`verified` / `unverifiable_without_secret` /
  `failed`);
- `commissaire_decisions` — `verified` / `failed`;
- `pk_fingerprint`, `ledger_failures[]`, and a per-record `records[]` list
  (`seq`, `author`, `kind_of_entry`, `classification`, `reason`).

Exit `0` pass / `1` verify-fail / `2` setup. Over the v0.2 source run
(`run-20261005-063237-graft-DEMO-1`, see [records.md](records.md#example-sourcing)), verify
replayed from the run anchor, which holds `pk.json` alone, reports `result: pass` with 4 producer
claims `unverifiable_without_secret` and 4 commissaire decisions verified. With the governor master
present it reports 4 producer claims verified. Only `schema:3` records are in the auth leg; the
`schema:2` lines are not. `audit verify` never reads the unit key by name, so it replays v0.1
(`issue`) and v0.2 (`unit_id`) records alike.

## 4. Distinct from the evidence spec — cross-link

| | [evidence spec](../../evidence/) | this facade spec |
|---|---|---|
| Reader | auditor of faff's own runs | reuser embedding Commissaire |
| Artifacts | flight-recorder (run-ledger, events, floor artifacts) | `schema:3` facade records |
| Posture | **emitter-authored**; conformance ≠ authenticity | **signature/HMAC-verified**, forgery-resistant |
| Forging emitter | can fabricate a clean, shape-valid run | cannot forge a commissaire decision (no `SK`) |
| Signing/attestation | explicitly **out of scope** | **is** the signing/attestation layer |

The two are siblings by design (spec Decision B): folding the facade records into the evidence
spec would invert that spec's own "signing out of scope / emitter-authored" statement. Each
keeps a coherent, honest conformance statement; they cross-link.

## 5. Per-effect adoption of faff's own runner

Documented for honesty, not as a facade property: at the time of writing (2026-09-28), faff's
own runner drives the `schema:3` facade for the **merge and pr-create** effects (both emit a
producer-HMAC'd declare → `effect-decision-request` → signed `effect-decision-verdict` →
observe). Other effects in the same run — `push`, `tracker-write`, `label-write` — remain
`schema:2`. State this as **demonstrated for merge and pr-create; other effects planned** —
never "merge only", and never as uniform adoption. faff's governor is in-process for these
effects (FAFF-1034); the reuser-runnable out-of-process custody split is documented in the
reuse how-to (FAFF-1144), not here.

## 6. Drift is not auto-re-flagged

The CI test ([`test/commissaire-facade-spec.test.mjs`](../../../test/commissaire-facade-spec.test.mjs))
validates the **point-in-time hand-carried examples** against these schemas. It does not check
live output from future runs, so a later change to a `commissaire.js` record shape is not
automatically re-flagged here — an inherited limit (the evidence spec has the same), not new
exposure. A shape change should bump this spec's version (see the [README](../README.md)) and
re-carry the examples. The code stays the enforcement; a divergence between a schema and the
code is a spec bug, fixed by correcting the schema, never the code.

## 7. Version binding

This statement describes spec **v0.2**. Spec [v0.1](../v0.1/conformance.md) stays published for frozen `issue`-keyed records.
