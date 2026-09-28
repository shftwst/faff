# Embed Commissaire as your own governance layer

This page is for an engineer evaluating or embedding **Commissaire** as a
standalone governance layer in a repository that has no SuperDomestique
(formerly known as `faff`) skills, config, or plugins installed. Read
[Names and language](/concept/positioning-and-language) first for the trust
vocabulary this page uses: *enforced*, *attested*, *demonstrated*, *planned*.

The one idea to hold onto: Commissaire's trust rests on a **split-key
transparency log**. A *producer* holds a symmetric key and HMACs its own claims;
a *governor* holds an Ed25519 key and signs decisions; both write to one
append-only, hash-chained `declared-effects.jsonl`. You can embed this as your
own governance chokepoint with one Stop hook, one verifier, and two binaries,
and verify the result from public key material alone.

One honest bound travels with that claim from the start. The reuser-runnable
custody split is *not* proof that faff's own runner is prevented from lying,
because faff's own runner uses an in-process governor. That limit is stated in
full under [the out-of-process signer](#out-of-process-signer-custody-split).

## The split-key model

Records are **signed, never encrypted**: a transparency log. Two custodians
hold different key material and author different records.

| Custodian | Holds | Authors (`author` field) | Record kinds |
|---|---|---|---|
| Producer | Symmetric `K_producer`, HKDF-derived from the governor's `master_secret` | `producer` | `declare`, `observe`, `effect-decision-request`, each HMAC-authenticated |
| Governor | Ed25519 `SK_commissaire` and the HMAC `master_secret` | `commissaire` | `admission`, `effect-decision-verdict`, `accepted_under_contract`, each Ed25519-signed |

Both authors append to one hash-chained `declared-effects.jsonl`, linked by
`prev`, so any reordering or tamper is detectable. A party without
`SK_commissaire` cannot mint a grant: a forged verdict **fails closed** whether
or not the verifier holds any secret.

For the byte-level record shapes and the on-disk keypair custody, see
[the schema reference](#schema-reference).

## The region:factory seam

The standalone `commissaire` binary requires only the governance cores it needs
plus shared infrastructure: `plugin/skills/faff/bin/lib/commissaire.js`,
`plugin/skills/faff/bin/lib/effects.js`, and `bin/lib/shared-infra.js`. It
deliberately does **not** require the `faff` launcher, which pulls in around a
hundred orchestration modules (tracker, harness, engine, scheduling) at load
time. That keeps the facade free of SuperDomestique scheduling.

`faff regions check` makes that freedom checkable rather than asserted:

```
1. Each bin/lib module carries exactly one region banner (governance | factory | shared-infra).
2. `faff regions check` reads the banners plus the require() graph.
3. It fails if any governance module requires a factory module (factory -> governance stays legal).
4. faffter-* skills are prompt files invoked as slots, never require()d by the CLI,
   so they are absent from the graph by construction, not by a suppression flag.
```

The lint asserts require-graph **direction** over the module set: the extractable
governance cores can never depend back on faff-the-factory. It does **not**
"verify the facade imports no skills". The `faffter-*` skills are prompt-slot
files, not require-edges, so they never enter the graph in the first place.

## Embedding the CLI

The runnable embed is the
[bare-Claude external verification capture](https://github.com/shftwst/faff/blob/main/verification/external-verification/commissaire-bare-claude/README.md):
one governed run of an ordinary repository with no SuperDomestique install. Its
integration cost is one Stop hook (`commissaire-stop-hook.mjs`), one verifier
(`verify-commissaire.mjs`), two binaries (`commissaire` and `faff`) from one
pinned checkout, and zero config.

The reuse loop uses the noun-verb-object grammar (`commissaire <object>
<action>`), matching the [CLI reference](cli.md#commissaire-as-its-own-cli). Keep
your own command lines minimal and treat that reference and the capture as the
moving sources of truth.

| Step | Command | Notes |
|---|---|---|
| admit | `commissaire contract admit --run-dir D --producer ID --contract-revision R` | `--scope`, `--governor-dir`, `--producer-dir` |
| declare | `commissaire effect declare --run-dir D --issue I --step S` | stdin: `EffectDescriptor[]` |
| authorize | `commissaire effect authorize --run-dir D --issue I --step S --level L` | stdin: `AuthorizeRequest` |
| act | the reuser's own effect | the capture creates one protected file |
| observe | `commissaire effect observe --run-dir D --issue I --step S` | stdin: `EffectDescriptor[]` |
| reconcile | `commissaire effect reconcile --run-dir D --issue I` | prints escapes to stdout; **not** a ledger record |
| conclude | `commissaire verdict conclude --run-dir D --issue I` | refuses on zero evidence; appends the signed `accepted_under_contract` |
| seal | `commissaire audit seal --run-dir D` | writes the run-close recovery bundle |
| verify | `commissaire audit verify --run-dir D --json` | secret-free replay from `pk.json` alone |

`reconcile` is a **detection query**, not a record: it prints the computed
escapes (observed protected effects with no matching declaration) to stdout and
appends nothing to the ledger.

### What the capture proves, and what it does not

Preserve the capture's own stated bounds; do not re-derive or re-run it here.

- **Bounded denial.** The protected target is absent at `prepare` end and at
  grant time, present only after the grant. It does *not* prove no transient
  create-then-delete happened inside a turn.
- **Forgeable provenance label.** The `claude-code-observed` `source` is a
  derived label, not a cryptographic identity: a hostile operator can hand-craft
  a Stop-shaped stdin to produce it.
- **Residual human oracle.** The machine cannot tell two real Claude Code turns
  from two hand-crafted Stop-shaped stdins; an operator attests out of band.
- **No isolation, no total prevention, no merge enforcement.** The capture makes
  no claim of process isolation, no claim it prevents every side effect (it uses
  one reversible file effect), and no claim it enforces or prevents a merge.

Point at
[`replay.sh`](https://github.com/shftwst/faff/blob/main/verification/external-verification/commissaire-bare-claude/replay.sh)
for the runnable proof: it replays the published capture from public material
alone.

## Out-of-process signer (custody split)

`commissaire contract admit --governor-dir <d> --producer-dir <d>` mints the
governor keypair and `master_secret` into the governor directory, derives and
delivers `K_producer` plus publishes `PK_commissaire` into a *separate* producer
directory, and **refuses when the two directories resolve to the same path**, so
the signing key and any producer key never share one custodian.

A holder of `pk.json` alone then runs `commissaire audit verify --run-dir <dir>
--json` for a secret-free replay:

- Ed25519 decisions verify from the public key.
- Producer HMAC claims without the symmetric secret classify as
  `unverifiable_without_secret`, an honest, non-blocking limit, never folded
  into a pass count.
- Exit `0` pass / `1` verify-fail / `2` setup.

**The limit, stated here beside the capability:**

> This custody split is *reuser*-runnable. It is **not** proof that faff's own
> runner prevents a lying runner. faff's own runner uses an **in-process**
> governor: it drives the `schema:3` facade for both the **merge** and the
> **pr-create** effects (demonstrated for merge and pr-create; other effects
> planned), not merge-only, and not an out-of-process governor. Because the
> runner mints and holds the signing key alongside the log it protects, a `pass`
> is tamper-evidence for a verifier, not proof the runner told the truth.

## Schema reference

The citable record shapes and keypair custody model are the shipped counterpart
to this narrative:
[`verification/commissaire-facade/v0.1/`](https://github.com/shftwst/faff/blob/main/verification/commissaire-facade/v0.1/)
(with
[`records.md`](https://github.com/shftwst/faff/blob/main/verification/commissaire-facade/v0.1/records.md),
[`keypair.md`](https://github.com/shftwst/faff/blob/main/verification/commissaire-facade/v0.1/keypair.md),
[`conformance.md`](https://github.com/shftwst/faff/blob/main/verification/commissaire-facade/v0.1/conformance.md),
and the `schema/` JSON). Cite it for a field table; this page never restates one.

## Related pages

- [Verify and read your run's evidence](verify-run-evidence.md): verifying your
  *own* run, and where each artifact lives on disk.
- [Add governance-check to GitHub](governance-check.md): the CI binding, which
  validates conformance, not authenticity.
- [CLI reference](cli.md#commissaire-as-its-own-cli): every `commissaire` verb
  and flag.
- [Names and language](/concept/positioning-and-language): the split-key framing
  and the trust vocabulary.
</content>
