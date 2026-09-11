# Commissaire, verified by a bare Claude Code consumer

This capture is the evidence from one governed run of an ordinary repository that has **no
SuperDomestique skills, config, or plugins installed**. A hand-written Stop hook and one
repository-owned verifier script drive the shipped governance CLI: the standalone `commissaire`
binary issues every decision, and the `faff` binary supplies the flight-recorder legs. Both come
from a single pinned checkout.

- **Pinned driver revision:** `@@PINNED_REVISION@@`
- **Run id:** `@@RUN_ID@@`

## What this run proves

- An external driver, outside the factory, drove the governed workflow through the shipped binaries.
- Commissaire issued a founded refusal and a founded grant: it denied an undeclared file-write, then
  granted the same descriptor once declared.
- The consumer complied: it created the protected file only after the grant.
- `commissaire verdict conclude` refused to call the run done while it held no evidence, then
  appended one signed `accepted_under_contract` verdict on the clean path.
- The run ledger closed, a run-close bundle sealed, and the published evidence replays from public
  material alone, from any directory outside a SuperDomestique checkout and from inside a clone via
  `replay.sh`.
- Forged records do not satisfy obligations: a tampered governor signature and a tampered producer
  authentication code are each rejected by `commissaire audit verify` (see the forgery legs below).

## The bounded denial claim

The harness proves `protected-output.txt` is **absent at `prepare` end and at grant time, present only after the grant.** It checks two exact instants: the end of `prepare`, and grant time in `complete` immediately before the authorized create. It does not prove that no transient create-then-delete happened inside a turn, because the capture excludes the raw session.

## Where the completeness gate lives

`commissaire verdict conclude` **gates only on zero evidence**: it refuses `no-evidence` while the
issue has no ledger records, and it will conclude once any evidence exists. The two-turn
completeness gate here is `faff runcheck --hook`, which blocks a Stop while the run has an admitted
issue with no terminal outcome. This run shows the block on the incomplete turn and the silent allow
on the complete one.

## Provenance label

Each hook observation carries a `source` the wrapper derives from the Stop stdin shape, never a
value supplied by its caller. `claude-code-observed` is **a forgeable derived label**: a hostile
operator can hand-craft a Stop-shaped stdin to produce it, so it is checkable provenance, not a
cryptographic identity claim. In this capture the label may read `ci-fixture` (a deterministic CI
firing) or `claude-code-observed` (a real session, attested separately under FAFF-1018).

## Operator attestation

The machine checks only Stop-shape, an equal `session_id_sha256`, and block-then-allow ordering. It
cannot check that the two Stop firings came from two real Claude Code turns rather than two
hand-crafted Stop-shaped stdins. That single fact is the **residual human oracle**: an operator runs
the two turns and signs the result out of band via `verify --attested-by "<name>"`, which records
the name in `demo-result.json`. That file is excluded from the published `members[]` re-hash, so the
attestation rests on the operator, never on a digest; the tool does not vouch for the name.

@@ATTESTED_BY@@

## FAFF-829 evidence mapping

| FAFF-829 bullet | What supplies it |
|---|---|
| 1. A real producer outside current scheduling and skills completed the governed workflow | This capture (FAFF-1018): a real two-turn `claude-code-observed` session, driven outside the factory and signed by the operator in the attestation above |
| 2. Forged / out-of-scope records could not satisfy obligations | The in-repo unit fixtures, and here in the external consumer: the FR-1 tampered governor signature (rejected from public material alone) and the FR-2 tampered producer authentication code (rejected with the secret present), both through `commissaire audit verify` |
| 8. Integration cost materially smaller than whole-workflow adoption | This capture: one hook file, one verifier script, one pointer file, zero config, two binaries from one checkout |
| 9. Claims limited to mechanisms actually proved | This section, the `source` and `provenance` fields, and the cited gaps below |

## Replay

Point `COMMISSAIRE_ROOT` at a checkout at the pinned revision, then:

```sh
COMMISSAIRE_ROOT=<checkout-at-the-pinned-revision> sh replay.sh
```

`replay.sh` copies this capture to a temporary directory and runs three checks there:
`commissaire audit verify` over the anchor (expects `pass`), `faff effects check` over the anchor
(expects no escape), and `faff bundle verify` over the exported bundle (expects `CLEAN`).

## Cited gaps

- **FAFF-1015:** the run anchor is minted by `faff events anchor`, not yet by a Commissaire-native
  verb. That one leg is the sole governance-to-flight-recorder coupling in this harness.
- **FAFF-1016:** `replay.sh` copies the capture to a temporary directory before verifying, because
  `faff bundle verify` resolves its bundle store through an enclosing `.faffrc.yaml`. Removing the
  copy is tracked there.
- **FAFF-1017:** `docs/guide/cli.md` and two header comments still describe `verdict conclude` and
  `audit seal` as boundary stubs and omit `audit export`. This harness relies only on CLI behaviour
  verified in code, never on that prose.

## What this run does not claim

- No claim of isolation between a hostile process and this one running under the same user id.
- No claim that the harness can prevent every side effect; it uses one reversible file effect.
- No claim that it enforces or prevents a merge; the chokepoint is proved separately in CI by
  FAFF-350 and FAFF-976.
- No claim that a producer record can be authenticated when the governor master secret is absent:
  with the master absent, producer records are classified `unverifiable_without_secret`, not
  promoted to verified.
- No cryptographic identity claim over the Stop invocation; the derived label is forgeable.
