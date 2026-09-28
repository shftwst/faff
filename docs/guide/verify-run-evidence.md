# Verify and read your run's evidence

This page is for an operator who has completed a run and wants to check its
signed evidence and know where each artifact lives on disk. Read
[Commissaire](/concept/execution-and-governance) first for the trust model this
page depends on: a governed run leaves an append-only, hash-chained
**transparency log**, some records HMAC-authenticated by a *producer* and the
protected-effect decisions Ed25519-signed by *Commissaire*.
`faff commissaire audit verify` replays that log from public material and reports
whether every signed record authenticates.

One distinction runs through the whole page: the signatures make tampering
**evident to a verifier**, but because the runner mints and holds the signing key
in the same directory as the log it protects, a `pass` is *not* proof the runner
told the truth. See [What verification does and does not prove](#what-verification-does-and-does-not-prove).

## Where your run's evidence lives

A governed run writes a **live run directory**; the build ships a **per-PR
anchor** (a committed byte-copy) with the pull request; and the run's close
writes a **recovery bundle**. The three hold overlapping evidence for different
readers.

### Live run directory — `.faff/runs/<run-id>/`

Everything the run produced, including the secret material that lets *your own*
machine re-check producer claims.

| Path | Holds |
|---|---|
| `run-ledger.json` | Admitted issues and their terminal outcomes |
| `events.jsonl` | The run timeline (the flight recorder) |
| `declared-effects.jsonl` | The effect ledger. **Mixed-schema:** unsigned `schema:2` governance-region records interleaved with signed `schema:3` facade records — `audit verify` replays only the `schema:3` subset |
| `commissaire/governor/governor.json` | The Ed25519 keypair plus `master_secret` (`sk`, `pk`, `pk_fingerprint`) |
| `commissaire/producer/pk.json` | The producer **public** key (`pk`, `pk_fingerprint`) |
| `commissaire/producer/producers/<run-id>.json` | The producer record, including `key_hex` (the symmetric secret), `admitted_scope`, and `contract_revision`. This local secret is why *your own* run verifies its producer claims |
| `<ISSUE>/` | Merge-floor artifacts: `ac-checklist.json`, `review-verdict.json`, `holdout-offer.json`, `build-progress.json`, `merge-record.json` |

The live run directory has **no chain-head file** — the tamper-evident witnesses
are written into the anchor, not here.

### Per-PR anchor — `.faff/anchors/<run-id>/<issue>/`

The committed byte-copy that rides the pull request and CI re-hashes. It ships
**public key material only** — no governor secret.

| Path | Holds |
|---|---|
| `declared-effects.jsonl`, `events.jsonl`, `run-ledger.json` | Byte-copies of the run evidence as of anchor-mint |
| `chain-head.json` | The events-log tamper-evident tip (witness) |
| `effects-chain-head.json` | The effect-ledger tamper-evident tip (witness) |
| `commissaire/producer/pk.json` | The **public** key only — no governor secret, no `producers/<run-id>.json`, no `key_hex` |
| `<floor artifacts>` | `ac-checklist.json`, `review-verdict.json`, and the rest |

For the chain-head status vocabulary (`verified`, `legacy-unverifiable`, `mixed`,
`broken`, and the rest), see the
[anchor-integrity reference](https://github.com/shftwst/faff/blob/main/verification/evidence/v0.2/anchor-integrity.md).

### Recovery bundle

The sealed, minimal evidence set written at a run's close through the resolved
`bundle_store` (local by default), via `faff commissaire audit seal` /
`faff bundle publish`. See [Seal, export, anchor, and the bundle](#seal-export-anchor-and-the-bundle).

## Verify it

Point `audit verify` at a directory and read the result:

```console
$ faff commissaire audit verify --run-dir .faff/runs/<run-id> --json
```

Aim `--run-dir` at either:

- **your own live or closed run** — `.faff/runs/<run-id>`; or
- **a per-PR anchor** — `.faff/anchors/<run-id>/<issue>` (**note the `<issue>`
  subdir**: the signed material lives one level down, so the anchor *root* exits
  `2`).

**Read the exit code first:**

| Exit | Meaning |
|---|---|
| `0` | Pass — valid decisions, honest producer classification |
| `1` | Verification failure — a failed record, or a ledger-level failure |
| `2` | Invalid invocation or setup — missing `--run-dir`, or no `schema:3` governance context (for example, the anchor root rather than its `<issue>` subdir) |

This `0/1/2` contract is deliberately distinct from the sibling `commissaire`
verbs' `3`.

### The JSON result

A pass on a live run directory looks like this:

```json
{ "version": 1,
  "result": "pass",
  "governance_context": true,
  "producer_claims": { "verified": 9, "unverifiable_without_secret": 0, "failed": 0 },
  "commissaire_decisions": { "verified": 5, "failed": 0 },
  "pk_fingerprint": "19dd46d7…c76b57",
  "ledger_failures": [],
  "records": [ { "seq": 0, "author": "commissaire", "kind_of_entry": "admission",
                 "classification": "verified", "reason": null }, … ] }
```

| Field | What it tells you |
|---|---|
| `version` | The result contract version (currently `1`) |
| `result` | The overall verdict, `pass` or `fail` |
| `governance_context` | `true` when a `schema:3` governance context was found |
| `producer_claims` | HMAC-authenticated records, split into `verified` / `unverifiable_without_secret` / `failed` |
| `commissaire_decisions` | Ed25519-signed records, split into `verified` / `failed` |
| `pk_fingerprint` | The Commissaire public-key fingerprint the replay ran against |
| `ledger_failures` | Chain or structure failures — `[]` on a clean pass |
| `records` | Per-record classification: `seq`, `author` (`commissaire` / `producer`), `kind_of_entry` (`admission`, `declare`, `effect-decision-request`, `effect-decision-verdict`, `observe`, `accepted_under_contract`), `classification`, and a `reason` |

**Read the counts:**

1. `commissaire_decisions.verified > 0` with `failed == 0` — the signed decisions
   authenticate.
2. Any `failed` count above `0`, or a non-empty `ledger_failures`, is a real
   tamper or structure signal. Stop and investigate; do not treat it as noise.

### `unverifiable_without_secret` — your run versus public material only

This bucket is **not a failure**. It counts producer HMAC claims the verifier
could not re-check because the symmetric secret was not available.

- **On your own run directory**, the producer's `key_hex` is present locally, so
  producer claims land in `verified` (`unverifiable_without_secret: 0`, as above).
- **From public material only** — any external verifier who holds only `pk.json`
  and no governor secret — the same producer claims move to
  `unverifiable_without_secret`, while the Ed25519 decisions still verify and the
  result is still `pass`:

```json
{ "result": "pass",
  "producer_claims": { "verified": 0, "unverifiable_without_secret": 9, "failed": 0 },
  "commissaire_decisions": { "verified": 5, "failed": 0 },
  "ledger_failures": [] }
```

This count comes from a secret-free replay of a **full run's** ledger; the
[worked bare-Claude example](https://github.com/shftwst/faff/blob/main/verification/external-verification/commissaire-bare-claude/replay.sh)
runs exactly that against a published capture.

**A per-PR graft anchor is a different, thinner artifact.** It is byte-copied at
anchor-mint (before the merge effect runs), so its `<issue>` subdir ledger holds
only the `admission` — no producer claims yet. Pointing `audit verify` at one
gives `producer_claims: {0, 0, 0}` with the admission's `commissaire_decisions`
verifying: a `pass` with `unverifiable_without_secret: 0`, because there is
nothing producer-authored to be unverifiable, not because a secret was present.

## When effects don't reconcile

Reconciliation compares what the run *observed* against what it *declared*. An
**escape** is an observed protected side effect with no matching declared effect
for its `(issue, step)` — see the [escape glossary row](https://github.com/shftwst/faff/blob/main/docs/reference/GLOSSARY.md).

- `faff effects check --run-dir <dir>` prints the human summary — on a clean run,
  `no escape — every observed effect is covered by a declaration`.
- `faff commissaire effect reconcile --run-dir <dir> --issue <issue>` returns the
  machine result:

```json
{ "escapes": [], "any_escape": false }
```

A non-empty `escapes` array (or `any_escape: true`) means the run took a protected
action it never declared — investigate before trusting the run.

## Seal, export, anchor, and the bundle

These verbs move evidence out of the live run directory for keeping, shipping, or
independent re-checking. For every flag, see the
[Commissaire CLI reference](cli.md#commissaire-as-its-own-cli).

| Verb | When and why |
|---|---|
| `faff commissaire audit seal --run-dir <dir>` | At a run's close — builds and writes the recovery bundle through the resolved `bundle_store` |
| `faff commissaire audit export --run-dir <dir> --dest <dir>` | Copies an already-sealed bundle's manifest and members to another location |
| `faff commissaire audit anchor --run-dir <dir> --issue <issue>` | Mints one per-issue anchor subdir — the byte-copy that ships with the PR |

**Bundle versus anchor.** The **per-PR anchor** is the public evidence that rides
one issue's pull request and CI re-hashes; it carries public key material only.
The **recovery bundle** is the run-close, keep-everything set written through the
`bundle_store`. Recovering a lost run from a bundle is a separate journey and is
not covered here.

## What verification does and does not prove

A `pass` is **tamper-evidence for a verifier**, not proof the runner behaved
honestly. The runner mints and holds the Ed25519 signing key in the same run
directory as the log it protects, so a runner that chose to lie could sign its own
grant. The concept page states the guarantee and its limit in full — read
[The runner's own merges](/concept/execution-and-governance) rather than relying
on a re-derivation here.

What a `pass` **does** give you:

- **Author-bound and authenticated.** Every record carries a producer HMAC or a
  Commissaire Ed25519 signature, so who wrote each record is verifiable.
- **Hash-chained.** Records chain by hash, so none can be inserted, removed, or
  reordered without detection.
- **Externally re-checkable.** The replay runs from public material alone.

What it does **not** give you:

- **Independence from the runner.** Genuine independence needs an out-of-process
  signer — future work behind the existing seam.
- **Authenticity in CI.** The repository-side check validates *conformance, not
  authenticity*: the same emitter it judges authored the artifacts. See
  [what the check can prove](governance-check.md#what-the-check-can-prove).

## Related pages

- [Commissaire](/concept/execution-and-governance) — the trust model and the
  runner's-own-merges caveat.
- [Add governance-check to GitHub](governance-check.md) — making the check binding
  in the merge path.
- [CLI reference](cli.md#commissaire-as-its-own-cli) — every `commissaire` verb and
  flag.
- [Evidence format](https://github.com/shftwst/faff/blob/main/verification/evidence/README.md)
  — the byte-level artifact schemas.
- [Bare-Claude external verification](https://github.com/shftwst/faff/blob/main/verification/external-verification/commissaire-bare-claude/README.md)
  — a worked secret-free replay.
