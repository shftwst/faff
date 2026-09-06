# FAFF-360: CI-provable harness for the bare Claude Code Commissaire consumer

> Spec: faffter-dark-nlspec · 2026-09-06 · interactive · claude-code/unknown · confidence: high. Full spec on Linear FAFF-360.

Revised 2026-09-06: CI-provable harness (live capture split to FAFF-1018). Final polish round: adds the 8 round-7 test-coverage cases (drift-accept branch, README forbidden-claims grep, .gitignore-content, replay.sh-relative, external-README marker, source-not-caller-supplied, observation-order, base64url in curate). Carries the round-6 fixes and the operator-requested forgery-rejection legs FR-1/FR-2 (FAFF-829 bullet 2). Replaces the 2026-09-02 spec.

This specification defines the machine-verifiable harness for FAFF-360 ("Second-consumer demo: bare Claude Code plus the governance layer on a non-faff repo, no factory installed"). It is for the build agent and reviewers. FAFF-360 ships the CI-provable harness: a scaffolder that stands up an ordinary no-remote repository with no SuperDomestique skills installed, a five-phase verifier (`prepare`, `complete`, `verify`, `curate`, `ci`), a hand-written Claude Code Stop-hook wrapper that derives its provenance label from the stdin shape and fails closed on binary resolution, content-based curation, and a secret-free replay. The `ci` phase runs the whole pipeline end to end against fixture-driven hook input in a temporary directory and publishes nothing to `results/`.

A separate ticket, FAFF-1018 ("Publish the operator-attested bare Claude Code capture for the Commissaire consumer"), drives this harness under a real two-turn session (blockedBy FAFF-360); it owns the live capture, the operator attestation, the headless-stdin spike, and the FAFF-829 bullet-1 evidence. The split keeps every acceptance criterion decidable by a machine in CI, with the one operator-attested artefact in FAFF-1018. The shipped CLI this harness consumes reached its current shape through FAFF-977, FAFF-980, FAFF-999, FAFF-1000 and FAFF-1008 (all Done), and the operator chose terminal depth (scope B) over fix-only (option A) or replacing the Stop hook (option C).

## 1. WHY: problem and principles

**The model this spec turns on.** The harness proves adoption by moving the producer outside the SuperDomestique factory while every governance decision stays inside Commissaire. Two binaries from one pinned checkout do the work: the standalone `commissaire` binary (which provably imports no scheduling, tracker, or harness module) issues every governance decision, from admission through the signed terminal verdict and the seal; the `faff` binary supplies the flight-recorder legs (run ledger, Stop-hook completeness check, chain validation, bundle verification, and the run anchor that `audit seal` consumes as its `anchors` member). Only `faff events anchor` mints that anchor, the single governance-verb dependency on a `faff` leg, a bounded gap owned by FAFF-1015.

**Problem statement.** FAFF-828 proved the facade with in-repository tests, and FAFF-829 (the human acceptance gate for the Phase 2A external Commissaire proof) has bullets 2 to 7 banked as CI tests, but no CI test yet exercises a producer outside current scheduling and skills driving the governed workflow through the shipped binaries. FAFF-360 supplies that harness end to end against fixture-driven hook input, yielding the integration-cost and bounded-claims evidence as by-products; FAFF-1018 runs the same harness under a real session for the bullet-1 artefact.

**The SUT stays ordinary and disposable.** It contains no `.faffrc`, factory skill directory, plugin installation, or copied SuperDomestique implementation; its integration is a hand-written Stop hook, one repository-owned verifier script, and a separately supplied immutable CLI checkout. The scaffolder makes it a local no-remote repository, and preflight refuses to run if a remote is configured. The wrapper's committed absolute `FAFF_BIN` constant is a local filesystem path, not a secret; only the curated temp-dir capture leaves the machine. Both binaries need their sibling `lib/` tree, so the full pinned checkout is supplied outside the SUT, no file copied in.

**One exact revision.** The scaffolder and the verifier carry `EXPECTED_COMMISSAIRE_REVISION`, the full 40-character SHA the build was proven against, filled by the build agent. Preflight refuses any other revision, so every exact count (record counts, `seq`, the `audit verify` buckets) is a statement about one known emission shape; `ALLOW_REVISION_DRIFT=1` relaxes the counts to shape assertions and records that in DemoResult.

**One implementation serves people and CI.** Human reproduction uses `prepare`/`complete`/`verify`; the `ci` phase orchestrates the same primitives, wrapper, and `curate`, and both OS lanes run the identical `node scripts/verify-commissaire.mjs ci`.

**Secret-free is checked by content, not by name.** Curation reads the live governor and producer secrets before export and asserts none of their byte forms appears anywhere in the capture, every `.bin` member included; a name-based walk still runs, but the content scan is the backstop.

**Claims stop at the evidence boundary.** The harness may claim that an external driver received a signed denial and grant, produced covered observations, obtained a founded `no-evidence` refusal and later a signed `accepted_under_contract` verdict, closed its ledger, sealed a bundle, and that the published evidence replays with public material only from any directory outside a SuperDomestique checkout and from inside a clone via `replay.sh` (FAFF-1016). It must not claim hostile same-UID isolation, cryptographic proof of Claude identity, universal effect prevention, merge enforcement, offline producer authentication when the master is absent, or that the anchor was minted by Commissaire (FAFF-1015). Whether the two hook firings came from a real session is FAFF-1018's attestation, not a harness claim.

**The denial claim is bounded to two checked instants.** The harness proves `protected-output.txt` absent at the end of `prepare` (step 7) and again at grant time in `complete`, immediately before the authorized create (step 6a); it does not prove no transient create-then-delete inside a turn, because the capture excludes the raw session. The README states it as "absent at `prepare` end and at grant time, present only after the grant."

| Existing surface | Relevance |
|---|---|
| FAFF-828 / commit `881f4a2555aa919947ec7e52a15b093478ed8110` | Facade foundation; its Outcome names the artefacts this harness must produce verbatim |
| FAFF-977 (Done) | `audit verify`: secret-free replay, exit 0 / 1 / 2, versioned JSON |
| FAFF-980 (Done) | Noun-verb grammar `commissaire <object> <action>`; the flat aliases are compatibility spellings |
| FAFF-999 (Done) | `plugin/skills/faff/bin/commissaire`; import independence asserted by `test/commissaire-standalone.test.mjs` |
| FAFF-1000 (Done) | `verdict conclude`, `audit seal`, `audit export` built in-process; old stubs gone |
| FAFF-1008 (Done) | Conclude-time refusals `no-evidence`, `pk-fingerprint-mismatch`, `ambiguous-contract-revision` |
| FAFF-976 (Done) | `mintIssueAnchor` copies `commissaire/producer/pk.json` into every anchor (a secret-free run-dir-shaped directory) |
| FAFF-1015 (filed) | Commissaire-native run-anchor mint; the one governance-to-flight-recorder coupling here |
| FAFF-1016 (filed) | `faff bundle verify` inherits `bundle_store` from an enclosing `.faffrc.yaml`; why `replay.sh` copies to a temp dir |
| FAFF-1017 (filed) | `docs/guide/cli.md` and two header comments still call `verdict conclude`/`audit seal` stubs and omit `audit export` |
| FAFF-1018 (filed) | Runs this harness under a real Claude Code session for the operator-attested capture and FAFF-829 bullet-1; blockedBy FAFF-360 |
| `plugin/skills/faff/bin/lib/commissaire.js` | All Commissaire handlers; writes `governor.json` (`sk`, `master_secret`) and `producers/<id>.json` (`key_hex`) at admit; `audit verify` records[] carry `{seq, author, kind_of_entry, classification, reason}` |
| `plugin/skills/faff/bin/lib/bundle-seal-core.js` | `buildBundle`, the store layout `.faff/bundles/<run_id>/seg-<N>/<boundary_key>/`; every `.bin` member is `Buffer.from(JSON.stringify(...))` |
| `plugin/skills/faff/bin/lib/integrity-digest.js` | `buildManifest`: `artifact_manifest` records `{sha256}` or `{length, prefix_sha256}` per path, never file bytes |
| `plugin/skills/faff/bin/lib/corrective-integrity.js` | `correctiveIntegrityDirs`: the fixed set `buildManifest` walks; never `commissaire/` |
| `run-ledger.js`, `runcheck.js`, `events.js`, `bundle.js` (same `lib/`) | The `faff` legs: `run-ledger`, `runcheck --hook`, `events anchor`, `bundle verify` |
| `verification/external-verification/` | Established fresh-SUT scaffolding pattern |
| `test/scaffolder-cli-surface-drift.test.mjs` | Discovers every `scaffold-*.sh` and requires a `.faffrc.yaml` here-doc; must learn the config-free exemption |
| `test/impure/` and `.github/workflows/validate.yml` | Linux `validate` runs the default glob; `validate-macos` runs `matched=(test/impure/*.test.mjs)`, so a new file runs on both with no workflow edit |

**FAFF-829 evidence mapping.** Bullets 2 to 7 are banked in `test/commissaire.test.mjs`, `test/bundle.test.mjs` and `test/commissaire-standalone.test.mjs`; FAFF-360 and FAFF-1018 supply the rest, and FAFF-360's forgery legs now also demonstrate bullet 2 in the external consumer:

| FAFF-829 bullet | What supplies it |
|---|---|
| 1. A real producer outside current scheduling and skills completed the governed workflow | FAFF-1018, under a real two-turn session with the operator attestation; FAFF-360 ships the harness, not the real-session evidence |
| 2. Forged / out-of-scope records could not satisfy obligations | Banked in the in-repo unit fixtures; now also demonstrated in the external consumer by FAFF-360's FR-1 (tampered governor Ed25519 signature rejected from public material alone) and FR-2 (tampered producer HMAC rejected with the secret present), both through `commissaire audit verify` |
| 8. Integration cost materially smaller than whole-workflow adoption | FAFF-360: one hook file, one verifier script, one pointer file, zero config, two binaries from one checkout |
| 9. Claims limited to mechanisms actually proved | FAFF-360: the README's bounded-claims section, the `source` and `provenance` fields, and the cited gaps |

**Scope statement.** FAFF-360 is the CI-provable harness for the smallest real consumer of the shipped Commissaire CLI (FAFF-828 through FAFF-1008); FAFF-1018 drives it under a real session, and FAFF-610 remains optional packaging.

## 2. OUT OF SCOPE

- **The real Claude Code capture, its operator attestation, and the headless-stdin spike (FAFF-1018).** The live two-turn capture is operator-attested and not machine-verifiable, so it is not a CI-gated AC here. FAFF-1018 owns the real capture, the `attested_by` line, the `claude -p --output-format json` headless-stdin spike, and the FAFF-829 bullet-1 evidence. Extension point: FAFF-1018.
- **Publishing a dated capture under `results/`.** FAFF-360's `ci` phase produces and verifies a `ci-fixture` capture in a temp directory, writing nothing to `verification/external-verification/results/`. FAFF-1018 publishes the dated `results/<date>-commissaire-bare-claude/` directory. Extension point: FAFF-1018.
- **Marketplace Action packaging.** CI invokes a repository-owned command directly. FAFF-610 is on automation hold. Extension point: a workflow file wrapping `node scripts/verify-commissaire.mjs ci`.
- **A second facade, schema, or validator.** This ticket consumes the shipped binaries only. Extension point: new verbs in `commissaire.js`.
- **Merge-gate enforcement.** The harness uses one reversible file effect and makes no merge-prevention claim; FAFF-350 and FAFF-976 already prove the chokepoint in CI. Extension point: a `merge`-kind effect in a second case.
- **Replacing the `runcheck` Stop hook with a Commissaire-native hook (option C).** The operator rejected it as a larger redesign. Extension point: a `commissaire` verb that reads the run ledger.
- **A Commissaire-native run-anchor mint (FAFF-1015).** The harness uses `faff events anchor`. Extension point: an `audit anchor` action; when it lands only `complete` step 12's binary changes.
- **Removing the temp-dir copy from replay (FAFF-1016).** Extension point: a `bundle verify` that reads no config when `--root` holds a local store.
- **Fixing `docs/guide/cli.md` and the two header comments (FAFF-1017).** The harness relies only on CLI behaviour verified in code, never on `cli.md` prose.
- **A refusal matrix beyond `no-evidence`.** `unreconciled-escape`, `producer-not-admitted`, `ambiguous-producer`, `pk-fingerprint-mismatch` and `ambiguous-contract-revision` are unit-tested in `test/commissaire.test.mjs`; one run carries the two refusals that matter for the public claim.
- **Another hosted SUT repository.** The scaffolder creates a fresh local no-remote git repository.
- **Cryptographic process or Claude identity isolation.** Hook-shaped input and a derived provenance label establish the tested invocation path, not an unforgeable identity claim; the `claude-code-observed` label can be forged by a hostile operator hand-crafting a Stop-shaped stdin, and the README says so.

## 3. WHAT: vocabulary, records, and interfaces

| Term | Definition |
|---|---|
| SUT | The freshly scaffolded ordinary git repository, local and with no remote |
| Driver checkout | A full SuperDomestique checkout outside the SUT, at exactly `EXPECTED_COMMISSAIRE_REVISION` |
| Pinned revision | The value of `EXPECTED_COMMISSAIRE_REVISION`: one full SHA, the same constant in the scaffolder and the verifier, named in the capture README |
| Commissaire binary | `<driver checkout>/plugin/skills/faff/bin/commissaire` |
| Flight-recorder binary | `<driver checkout>/plugin/skills/faff/bin/faff`, used only for `run-ledger`, `events anchor`, `events verify`, `effects verify`, `effects check`, `runcheck --hook`, `bundle verify` |
| Canonical verifier | `scripts/verify-commissaire.mjs` in the SUT, exposing `prepare`, `complete`, `verify`, `curate`, and `ci` |
| Active-run pointer | A schema-checked relative reference under the SUT used by the Stop-hook wrapper |
| Hook-observation store | `<sut>/.faff/hook-observations.jsonl`: the append-only HookObservation file, under gitignored `.faff/` but outside the run directory `.faff/runs/<run_id>/`, so it never reaches git |
| Command-observation store | `<sut>/.faff/command-observations.jsonl`: the phases' CommandObservation file, likewise under gitignored `.faff/` and outside the run dir |
| Hook observation | A secret-free record written only after parsing hook-shaped stdin and running `runcheck --hook`; its `source` label is wrapper-derived from the stdin shape, never caller-supplied |
| Provenance | The three derived fields the wrapper keeps from a Claude Code Stop stdin: a salted session hash, whether the transcript file existed, whether `cwd` resolved to the SUT root |
| Run anchor | The per-issue directory `faff events anchor` writes: byte copies of `events.jsonl`, `run-ledger.json`, `declared-effects.jsonl`, the two chain-head witnesses, and `commissaire/producer/pk.json` (never `governor.json`) |
| Sealed bundle | The seven-member run-close bundle `audit seal` writes to `<root>/.faff/bundles/<run_id>/seg-<N>/run-close/` (`manifest.json` plus one `<member>.bin` each) |
| Capture | The allowlisted, secret-free evidence retained from one run, laid out so shipped verifiers consume it unchanged |
| Curation | The walk plus content scan proving a capture carries no secret bytes, forbidden file class, or absolute path; one implementation, called by `verify` and exposed as the `curate` phase |
| Replay | `commissaire audit verify` over the captured anchor, `faff effects check` over the same anchor, and `faff bundle verify` over the captured bundle, with no secret present; `replay.sh` runs all three on a temp copy |

```
RECORD VerificationInputs:
  commissaire_root: AbsolutePath          # the driver checkout
  commissaire_revision: GitSHA40          # from COMMISSAIRE_REVISION
  expected_commissaire_revision: GitSHA40 # the EXPECTED_COMMISSAIRE_REVISION constant
  allow_revision_drift: bool              # ALLOW_REVISION_DRIFT=1; default false
  sut_root: AbsolutePath

  CONSTRAINT commissaire_root != sut_root
  CONSTRAINT git_head(commissaire_root) = commissaire_revision
  CONSTRAINT commissaire_revision = expected_commissaire_revision OR allow_revision_drift
  CONSTRAINT FAFF-828 commit 881f4a25... is an ancestor of commissaire_revision
  CONSTRAINT commissaire_revision contains plugin/skills/faff/bin/commissaire      # FAFF-999
  CONSTRAINT commissaire_revision contains plugin/skills/faff/bin/lib/bundle-seal-core.js   # FAFF-1000
  CONSTRAINT `commissaire` usage text lists "audit export" and "audit verify"     # FAFF-1000, FAFF-977
  CONSTRAINT `git remote -v` in sut_root prints nothing (no remote configured)
  CONSTRAINT `git ls-files -- .faff protected-output.txt` in sut_root prints nothing
```

```
RECORD ActiveRunPointer:
  schema: 1
  run_id: string
  run_dir: RelativePath
  issue: "DEMO-1"
  producer_id: "bare-claude"
  state: "prepared" | "completed"

  CONSTRAINT run_dir is relative
  CONSTRAINT run_dir contains no "." or ".." segment
  CONSTRAINT resolve(sut_root, run_dir) remains beneath sut_root
  CONSTRAINT basename(run_dir) = run_id
```

```
RECORD HookObservation:                             # one line in <sut>/.faff/hook-observations.jsonl
  schema: 2
  ordinal: 1 | 2                                     # (count of existing lines in the store carrying
                                                     # this run_id) + 1; see stop_hook step 8
  hook_event_name: "Stop"
  input_shape_validated: true
  source: "claude-code-observed" | "ci-fixture"     # derived by the wrapper, see stop_hook step 6
  provenance?: {                                    # present iff source = claude-code-observed
    session_id_sha256: Hex64                        # sha256(run_id + session_id)
    transcript_existed: true
    cwd_matched: true
  }
  run_id: string
  result: "block" | "allow"

  CONSTRAINT no raw session_id, transcript_path, transcript data, cwd, or absolute path is retained
  CONSTRAINT source = "claude-code-observed" only when stdin carried hook_event_name, session_id,
             transcript_path, cwd and stop_hook_active, transcript_path named an existing regular
             file at hook time, and cwd resolved to sut_root
```

The `claude-code-observed` derivation stays in the wrapper only so fixture-driven impure cases can exercise it; a real session producing that label end to end is FAFF-1018's.

```
RECORD DemoResult:
  schema: 3
  case: "commissaire-bare-claude"
  producer_id: "bare-claude"
  commissaire_revision: GitSHA40
  expected_commissaire_revision: GitSHA40
  counts_pinned: bool                     # true iff commissaire_revision = expected_commissaire_revision
  sut_revision: GitSHA40
  source: "claude-code-observed" | "ci-fixture"     # the ci pipeline always yields "ci-fixture"
  session_id_sha256?: Hex64               # iff claude-code-observed; equal on both observations
  platform: "linux" | "darwin"
  run_id: string
  bundle_identity: { run_id, run_segment_id: int, boundary_kind: "run-close", boundary_key: "run-close", boundary_seq: int }
  observations:
    no_evidence_refusal:      { verdict: "refused", reason: "no-evidence", issue: "DEMO-1" }
    first_stop_hook:          "block"
    predeclaration_decision:  { verdict: "deny", reason: "effect-not-declared" }
    covered_decision:         { verdict: "grant", reason: "all-legs-pass" }
    reconciliation:           { any_escape: false }
    live_audit_verify:        { result: "pass",
                                producer_claims: { verified: int, unverifiable_without_secret: 0, failed: 0 },
                                commissaire_decisions: { verified: int, failed: 0 } }
    terminal_verdict:         { verdict: "accepted_under_contract", issue: "DEMO-1", producer_id: "bare-claude", seq: int }
    sealed_bundle:            { sealed: true, idempotent: false, bundle_manifest_digest: Hex64 }
    second_stop_hook:         "allow"
    terminal_runcheck:        { clean: true }
    exported_bundle:          { exported: true, bundle_manifest_digest: Hex64 }
    replay_audit_verify:      { result: "pass",
                                producer_claims: { verified: 0, unverifiable_without_secret: int, failed: 0 },
                                commissaire_decisions: { verified: int, failed: 0 },
                                pk_fingerprint: Hex64 }
    replay_bundle_verify:     { verdict: "CLEAN", cause: "clean" }
    replay_script:            { exit: 0 }
  curation: { clean: true, files_scanned: int, secret_forms_checked: int }
  forgery_rejection: {
    ed25519_sig:  { tampered_field: "commissaire_sig", tampered_seq: 7,
                    result: "fail", reason: "commissaire-sig-invalid", exit: 1 }
    producer_hmac: { tampered_field: "producer_hmac", tampered_seq: 6,
                    result: "fail", reason: "producer-auth-mismatch", exit: 1 }
  }
  members: List<{ path: RelativePath, sha256: Hex64 }>

  CONSTRAINT sealed_bundle.bundle_manifest_digest = exported_bundle.bundle_manifest_digest
  CONSTRAINT seq is the 0-based ledger index the CLI mints (events.js tailReadState: first record
             seq 0, each next seq previous + 1). terminal_verdict is the LAST record in
             declared-effects.jsonl; at the pinned revision it holds 8 records at seqs 0..7, so seq = 7
  CONSTRAINT WHEN counts_pinned: live_audit_verify.producer_claims.verified = 4,
             live_audit_verify.commissaire_decisions.verified = 3,
             replay_audit_verify.producer_claims.unverifiable_without_secret = 4,
             replay_audit_verify.commissaire_decisions.verified = 4, terminal_verdict.seq = 7
  CONSTRAINT no absolute host path is persisted in any capture member (text, JSON, or .bin)
  CONSTRAINT every members[].sha256 equals the sha256 of the file at members[].path at the end of verify
```

The record counts are exact at the pinned revision: eight schema:3 records in `declared-effects.jsonl` at seqs 0..7, in order 0 admission, 1 effect-decision-request, 2 deny, 3 declare, 4 effect-decision-request, 5 grant, 6 observe, 7 accepted_under_contract (`effect reconcile`, `audit verify`, and a refused `verdict conclude` write nothing). Seq 7 (accepted_under_contract) is commissaire-authored and carries `commissaire_sig`; seq 6 (observe) is producer-authored and carries `producer_hmac` (the two records the step-14c forgery legs tamper).

Under `ALLOW_REVISION_DRIFT=1` the verifier asserts shape instead of count: admission first; a deny then a grant for the same descriptor, in that order; exactly one `accepted_under_contract`, last; live buckets N-verified/0-unverifiable/0-failed and replay buckets 0-verified/N-unverifiable/0-failed; `terminal_verdict.seq` = record count minus 1; and it stamps `counts_pinned:false`.

These shape assertions are a pure function of the parsed record sequence and the `audit verify` bucket JSON; they read no signatures and re-sign nothing, so the impure "Revision drift shape" case drives the shape-assertion function directly over fabricated inputs. The signed pipeline stays the pinned-counts path only, because a tampered ledger cannot re-sign without the governor master secret.

```
RECORD CommandObservation:                  # one line per binary invocation, in command-observations.jsonl
  leg: string
  binary: "commissaire" | "faff"
  argv_shape: List<string>                  # flag names and fixed literals only; path values replaced by "<abs>"
  exit: int
  stdout_json?: object                      # normalised, see normalise_stdout

  CONSTRAINT no string value anywhere in the line contains an absolute host path (see normalise_stdout)
```

```
PROCEDURE normalise_stdout(stdout_json):
  1. Delete the top-level fields governor_dir, producer_dir, run_dir, dest, path, anchor_dir.
  2. Walk every remaining string value (nested objects and arrays included); replace any absolute
     path token ANYWHERE in the value, not only at position 0, with the literal "<abs>". An absolute
     path token is a "/"-led sequence at the start of the string or after a boundary character
     (whitespace or one of " ' = : ( , [ ), e.g. an embedded /home/... or /srv/..., and the Windows
     drive form [A-Za-z]:[\\/] anywhere.
  3. Return the result.
```

Normalisation runs at record time and curation re-checks it, so an unnormalised observation fails `curate` (exit 1 naming `command-observations.jsonl`). The match is widened because `audit verify` reasons and other CLI messages can carry an embedded path mid-string.

```
RECORD CaptureLayout:                       # a temp directory in FAFF-360; results/<date>-.../ in FAFF-1018
  README.md                                 # bounded claims, pinned revision, replay commands, FAFF-829 mapping, cited gaps
  replay.sh                                 # copies this directory to a temp dir and runs the three replays there
  demo-result.json                          # DemoResult
  hook-observations.jsonl                   # exactly two HookObservation lines
  command-observations.jsonl                # CommandObservation lines, one per invocation
  protected-output.txt                      # the one granted effect's artefact
  .faff/anchors/<run_id>/DEMO-1/            # the run anchor, byte-for-byte as minted
    events.jsonl  run-ledger.json  chain-head.json  declared-effects.jsonl  effects-chain-head.json
    commissaire/producer/pk.json            # { pk, pk_fingerprint } only
  .faff/bundles/<run_id>/seg-<N>/run-close/ # the audit export, byte-for-byte
    manifest.json
    ledger_snapshot.bin  admitted_outcomes.bin  anchors.bin  artifact_manifest.bin
    last_safe_boundary.bin  redaction.bin  contract_fingerprint.bin

  CONSTRAINT no file named governor.json or producers/<id>.json, no transcript.jsonl or transcript
             data, no raw session identifier
  CONSTRAINT no JSON field named sk, master_secret or key_hex in any file; the name rejection for
             cwd, session_id, transcript_path, token, credential applies to the capture's OWN
             authored files only (README.md, demo-result.json, hook/command-observations.jsonl)
  CONSTRAINT no absolute host path in any text, JSON, or .bin member (each .bin is JSON, parsed and
             scanned like text; curate step 1c)
  CONSTRAINT no byte form (hex, lowercase, uppercase, base64, base64url) of the live governor sk,
             master_secret, or producer key_hex, in any file including every .bin member
  CONSTRAINT decode(anchors.bin).files == the byte content of .faff/anchors/<run_id>/DEMO-1/**
  CONSTRAINT a digest-only path entry inside artifact_manifest.bin naming commissaire/governor/governor.json
             or commissaire/producer/producers/<id>.json is allowed (a path and a sha256 are not the secret)
```

The capture is shaped so each verifier finds its input in place: `audit verify` consumes a run anchor (falling back to `commissaire/producer/pk.json` when `governor.json` is absent), not an export directory; `faff bundle verify --root R` reads `R/.faff/bundles/<run_id>/seg-<N>/<boundary_key>/{manifest.json,<member>.bin}`, exactly what `audit export --dest` writes.

The `artifact_manifest` member is `buildManifest` over the fixed `correctiveIntegrityDirs` list; each entry records `{sha256}` or `{length, prefix_sha256}`, never file bytes, and `commissaire/` is not in that set at the pinned revision, so a future revision adding `commissaire/governor/governor.json` as a digest entry still passes the content scan while one embedding bytes fails. `anchors.bin` embeds the anchor files' bytes as strings, so parsing surfaces any absolute path inside them (none at the pinned revision, since the absolute run dir `run-ledger init-interactive --json` prints is stdout only).

### The CLI contract the verifier consumes

Every row is verified against `plugin/skills/faff/bin/lib/` at the pinned revision. Exit codes and stdout shapes are what the verifier asserts on; nothing else is trusted.

| Leg | Command (binary in bold) | Exit codes | stdout on success |
|---|---|---|---|
| Mint L2 ledger | **faff** `run-ledger init-interactive --issue DEMO-1 --root <sut> [--id <run_id>] --json` | 0 minted; 2 bad flags; 3 refused or lock failure | `{proceed, level, run_id, run_dir, ...}` |
| Admit producer | **commissaire** `contract admit --run-dir D --producer bare-claude --contract-revision r1 --scope file-write` | 0; 2 already admitted or bad flags; 3 run dir missing | `{admitted:true, producer_id, admitted_scope, pk_fingerprint, governor_dir, producer_dir}` (the two `_dir` fields deleted at record time) |
| No-evidence probe | **commissaire** `verdict conclude --run-dir D --issue DEMO-1` (before any DEMO-1 record) | 0 for any governed refusal; 2 only for `no-governor` | `{verdict:"refused", reason:"no-evidence", issue:"DEMO-1"}` |
| Request a decision | **commissaire** `effect authorize --run-dir D --producer bare-claude --issue DEMO-1 --step write` with stdin `{"effect":{"kind":"file-write","target":"protected-output.txt"}}` | 0 whether grant or deny; 2 setup | `{verdict, reason, verdict_seq, request_seq}` |
| Declare | **commissaire** `effect declare --run-dir D --producer bare-claude --issue DEMO-1 --step write` with stdin `[{"kind":"file-write","target":"protected-output.txt"}]` | 0; 1 invalid descriptor; 2 setup | the appended record |
| Observe | **commissaire** `effect observe ...` same flags and stdin as declare | 0; 1; 2 | the appended record |
| Reconcile | **commissaire** `effect reconcile --run-dir D --issue DEMO-1` | 0 | `{escapes:[...], any_escape:false}` |
| Live verify | **commissaire** `audit verify --run-dir D --json` (governor material present) | 0 pass; 1 verify-fail; 2 setup or no schema:3 context | `{version:1, result:"pass", governance_context:true, producer_claims:{...}, commissaire_decisions:{...}, pk_fingerprint, ledger_failures:[], records:[{seq, author, kind_of_entry, classification, reason}, ...]}` |
| Conclude | **commissaire** `verdict conclude --run-dir D --issue DEMO-1` (after observe and reconcile) | 0; a repeat returns `{..., idempotent:true, seq}` | `{verdict:"accepted_under_contract", issue, producer_id, seq}` |
| Record outcome | **faff** `run-ledger record-outcome --issue DEMO-1 --outcome shipped --run-dir D --json` | 0; 2 bad issue/outcome; 3 no ledger | `{recorded:true, run_id, run_dir, issue, outcome, owner_status:"done", ...}` |
| Mint run anchor | **faff** `events anchor --run-dir D --issue DEMO-1 --dest <sut>/.faff/anchors/<run_id>/DEMO-1` | 0; 1 ledger fold drift; 2 bad flags or mint failure; 3 no events | one text line |
| Seal | **commissaire** `audit seal --run-dir D --root <sut>` | 0 sealed or `store_unavailable`; 1 build or identity-conflict failure; 2 unsupported store; 3 run dir missing | `{sealed:true, idempotent:false, identity:{run_id, run_segment_id, boundary_kind, boundary_key, boundary_seq}, bundle_manifest_digest}` |
| Export | **commissaire** `audit export --run-dir D --dest <capture>/.faff/bundles/<run_id>/seg-<N>/run-close --root <sut>` | 0; 1 `not-sealed` or `dest-not-empty`; 2; 3 | `{exported:true, dest, identity, bundle_manifest_digest}` (`dest` deleted at record time) |
| Stop-hook engine | **faff** `runcheck <run-dir> --hook` with `FAFF_RUN_DIR=<run-dir>` | always 0 | `{decision:"block", reason}` when the owned run has an admitted issue with no terminal outcome; nothing otherwise |
| Terminal runcheck | **faff** `runcheck <run-dir> --json` | 0 clean; 3 undispatched; 2 invalid outcomes or malformed | `{run_id, admitted, undispatched:[], invalid_outcomes:[], clean:true}` |
| Chain validators | **faff** `events verify --run-dir X --json`; **faff** `effects verify --run-dir X --json`; **faff** `effects check --run-dir X --issue DEMO-1 --json` | per `verifyExitCode`; 0 on `verified` | `{status:"verified", ...}`; `{any_escape:false}` |
| Replay decisions | **commissaire** `audit verify --run-dir <capture>/.faff/anchors/<run_id>/DEMO-1 --json` | 0 / 1 / 2 as above | as above, with every producer record `unverifiable_without_secret` |
| Replay bundle | **faff** `bundle verify --run-id <run_id> --run-segment-id <N> --boundary-kind run-close --boundary-key run-close --root <capture> --json` | 0 CLEAN; 1 MISSING/MALFORMED/TAMPERED/STALE; 2 VERIFICATION_UNAVAILABLE | `{verdict:"CLEAN", cause:"clean", identity, superseded_by:null, conformant:true}` |

`run_segment_id` is `owner.epoch` from `run-ledger.json` (0 for an interactive ledger) and `boundary_seq` is one past the max boundary in the segment (0 for this otherwise-empty segment); the verifier reads both from the `audit seal` output's `identity` into `DemoResult.bundle_identity` rather than assuming them.

### Implementation surfaces

- `verification/external-verification/scaffold-commissaire-bare-claude.sh` (config-free: writes no `.faffrc.yaml`, calls no `faff hooks-ensure`; writes `RUNBOOK.md` via a `cat > RUNBOOK.md <<'EOF'` here-doc for `test/helpers/scaffolder-heredocs.mjs`, plus `scripts/verify-commissaire.mjs`, `scripts/commissaire-stop-hook.mjs`, `.claude/settings.json`, `.gitignore`, and the initial commit with no remote). It carries `EXPECTED_COMMISSAIRE_REVISION`, substitutes it into the copied verifier, and by the same substitution fills `const FAFF_BIN = "<COMMISSAIRE_ROOT>/plugin/skills/faff/bin/faff"` in the hook, so it resolves with no PATH and no exported env.
- The scaffolder's `.gitignore` is exactly `.faff/` (run dir, anchors, local bundle store, the two observation stores) and `protected-output.txt`, and does NOT gitignore `scripts/`, so the SUT stays self-contained; the no-remote rule keeps the committed absolute `FAFF_BIN` unpushed.
- The governor and producer key material lives under the run dir: `contract admit` writes `governor.json` (`sk`, `master_secret`) to `<run-dir>/commissaire/governor/` and `producers/bare-claude.json` (`key_hex`) to `<run-dir>/commissaire/producer/producers/`, with the run dir at `<sut>/.faff/runs/<run_id>/`, all beneath gitignored `.faff/`, so the preflight `git ls-files -- .faff` guard covers it. The demo passes no `--governor-dir`/`--producer-dir` override (preflight step 12 refuses one, which would place secrets outside `.faff/`).
- `verification/external-verification/commissaire-bare-claude/{verify-commissaire.mjs, commissaire-stop-hook.mjs}` (copied into the SUT so one implementation exists). `verify-commissaire.mjs` declares `const EXPECTED_COMMISSAIRE_REVISION = "<40 hex>"`; the build agent fills it from `git rev-parse HEAD` of the driver checkout.
- `.../commissaire-bare-claude/replay.sh` (copied into every capture by `verify` step 16) and `.../README.md`.
- `test/impure/commissaire-bare-claude.test.mjs`, run by both lanes by location alone (no workflow edit).
- Small updates to `verification/external-verification/README.md` (a row labelled `commissaire-bare-claude (config-free second consumer)`) and `test/scaffolder-cli-surface-drift.test.mjs` (a `CONFIG_FREE` set).

The generated SUT exposes:

```text
node scripts/verify-commissaire.mjs prepare
node scripts/verify-commissaire.mjs complete
node scripts/verify-commissaire.mjs verify [--capture <dir>]
node scripts/verify-commissaire.mjs curate <dir>
node scripts/verify-commissaire.mjs ci
```

Every phase except `curate` requires `COMMISSAIRE_ROOT` and `COMMISSAIRE_REVISION`; `curate` reads the live secrets from the pointer's run dir or `--run-dir`, refusing (exit 3) when neither resolves. The generated `.claude/settings.json` has one Stop hook invoking `node scripts/commissaire-stop-hook.mjs` (the `hooks.Stop[].hooks[].command` shape `faff hooks-ensure` writes, hand-written since the SUT has no `faff` on PATH).

## 4. HOW: behaviour

### Preflight

```
PROCEDURE preflight:
  1. Require Node 20 or newer and git.
  2. Require COMMISSAIRE_ROOT outside the SUT.
  3. Require COMMISSAIRE_REVISION to equal the driver checkout's HEAD.
  4. Require COMMISSAIRE_REVISION = EXPECTED_COMMISSAIRE_REVISION; otherwise exit 2 naming both,
     unless ALLOW_REVISION_DRIFT=1, in which case set counts_pinned=false and continue.
  5. Require FAFF-828 commit 881f4a... to be an ancestor (git merge-base --is-ancestor).
  6. Require `git cat-file -e <rev>:plugin/skills/faff/bin/commissaire`
     and `git cat-file -e <rev>:plugin/skills/faff/bin/lib/bundle-seal-core.js`.
  7. Probe: run `commissaire` with no arguments; require exit 2 and a usage text
     naming "audit export" and "audit verify".
  8. Probe: run `commissaire audit verify --run-dir <empty temp dir>`; require exit 2
     and no stdout (the "no schema-3 governance context" setup refusal).
  9. Refuse if the SUT contains .faffrc, .faffrc.yaml, .faffrc.yml, .claude/skills,
     .agents/skills, plugin/skills, or a SuperDomestique plugin installation.
  10. Refuse (exit 2) if `git remote -v` in the SUT prints any remote: the committed absolute
      FAFF_BIN constant must never be pushable, and the SUT is a disposable no-remote repo.
  11. Refuse (exit 2) if `git ls-files -- .faff protected-output.txt` in the SUT prints any path
      (the index is the one place a tracked or staged file appears).
  12. Refuse (exit 2) if a governor/producer dir override reached the verifier (a --governor-dir or
      --producer-dir argument, or a COMMISSAIRE_GOVERNOR_DIR / COMMISSAIRE_PRODUCER_DIR env var),
      before it can place secret material outside .faff/. The verifier's own `contract admit`
      forwards no override, so secrets stay under <run-dir>/commissaire/ beneath .faff/.
```

### Prepare

```
PROCEDURE prepare:
  1. Refuse an existing live ActiveRunPointer. Then truncate <sut>/.faff/hook-observations.jsonl to
     empty, so a stale ordinal-1 line from an aborted earlier `complete` cannot inflate the next
     run's count (the SUT runs one demo at a time, so truncation loses no live lines).
  2. Mint one L2 run ledger for DEMO-1 beneath the SUT (faff run-ledger init-interactive).
  3. Admit producer "bare-claude" with scope "file-write" (commissaire contract admit).
  4. Run `commissaire verdict conclude --run-dir D --issue DEMO-1`.
     Require exit 0 and stdout exactly {verdict:"refused", reason:"no-evidence", issue:"DEMO-1"}.
     Require declared-effects.jsonl still holds exactly one record (the admission).
  5. Request a decision for {kind:"file-write", target:"protected-output.txt"}
     before declaring it (commissaire effect authorize).
  6. Require verdict="deny" and reason="effect-not-declared".
  7. Assert protected-output.txt does not exist.
  8. Write ActiveRunPointer(state="prepared") atomically.
  9. Leave DEMO-1 without a terminal outcome.
```

Step 4 must run before step 5: `verdict conclude` refuses `no-evidence` only while the issue has zero ledger records, and the denied request in step 5 writes two.

### Stop-hook wrapper

```
PROCEDURE stop_hook(stdin):
  1. Parse stdin as JSON; on parse failure emit a block JSON and exit 0.
  2. Require hook_event_name="Stop"; otherwise emit a block JSON and exit 0.
  3. If no ActiveRunPointer exists, return silent allow.
  4. Validate the pointer and containment (relative run_dir, no "." or ".." segment,
     resolves beneath the SUT root, basename equals run_id); on any failure emit a block JSON
     naming the check and exit 0, before reading the run directory.
  5. Resolve the flight-recorder binary from the scaffolder-substituted constant:
       FAFF_BIN = "<COMMISSAIRE_ROOT at scaffold time>/plugin/skills/faff/bin/faff"
     If FAFF_BIN does not name an existing regular file, emit a block JSON naming
     "faff-bin-unresolvable" and exit 0. Do not read COMMISSAIRE_ROOT from the ambient
     environment at hook time.
  6. Invoke, capturing spawn errors and exit status:
       FAFF_RUN_DIR=<validated absolute run dir>
       "$FAFF_BIN" runcheck <run-dir> --hook
     If the spawn errors (ENOENT or any spawn failure), or the process exits non-zero without
     emitting a decision JSON on stdout, emit a block JSON naming "runcheck-spawn-failed" and
     exit 0. A spawn or resolution failure is never a silent allow.
  7. Derive the label:
       IF stdin has session_id AND transcript_path AND cwd AND stop_hook_active
          AND transcript_path is an existing regular file at this moment
          AND resolve(cwd) = sut_root:
            source = "claude-code-observed"
            provenance = { session_id_sha256: sha256(run_id + session_id),
                           transcript_existed: true, cwd_matched: true }
       ELSE:
            source = "ci-fixture", no provenance
  8. Derive ordinal = (existing HookObservation lines in
     <sut_root>/.faff/hook-observations.jsonl whose run_id equals this run_id) + 1, then append one
     HookObservation carrying only the record's fields to that file (never into the run directory).
     Only this run_id's lines are counted, so the ordinal is per-run and stable even if an unrelated
     run wrote first.
  9. If runcheck emitted a block decision, forward that JSON unchanged.
  10. If runcheck exited 0 and was silent, remain silent.
  11. Exit 0, following Claude Code hook semantics.
```

The five fields in step 7 are the ones Claude Code sends to a Stop hook, the wrapper's contract with Claude Code, not a codebase fact; the wrapper never reads the transcript, only checks the path exists.

The binary is resolved from a scaffolder-filled constant, not PATH or inherited env (rationale in section 6), so an operator who starts Claude Code without `COMMISSAIRE_ROOT` exported still resolves it.

The `source` derivation is inert on the enforcement path: the fail-closed `FAFF_BIN` resolution and `runcheck` block are independent of it, so a derivation bug cannot weaken the block, and `verify`'s equal-`source` and equal-hash checks are a consistency gate over the pair, not a security assertion (the label is forgeable). If FAFF-1018's first real session reveals a different stdin shape, the fix lands in the step-7 derivation branch only.

### Complete

```
PROCEDURE complete:
  1. Read and validate ActiveRunPointer(state="prepared").
  2. Require exactly one prior HookObservation for this run_id in
     <sut>/.faff/hook-observations.jsonl (read only the lines whose run_id matches the pointer's):
       ordinal=1, hook_event_name="Stop", input_shape_validated=true, result="block".
  3. Declare {kind:"file-write", target:"protected-output.txt"} (commissaire effect declare).
  4. Request a decision for that exact descriptor (commissaire effect authorize).
  5. Require verdict="grant" and reason="all-legs-pass".
  6. a. Immediately before creating it, assert protected-output.txt does NOT exist; exit 1 if it
        does. This catches an unauthorized mid-turn-1 create that survived into turn 2.
     b. Only after the grant and that absence assertion, create protected-output.txt.
  7. Observe the same descriptor (commissaire effect observe).
  8. Reconcile DEMO-1 (commissaire effect reconcile); require any_escape=false.
  9. Run `commissaire audit verify --run-dir D --json` against the live run.
     Require result="pass", unverifiable_without_secret=0, failed=0 on both buckets;
     WHEN counts_pinned also require producer_claims.verified=4 and commissaire_decisions.verified=3.
  10. Run `commissaire verdict conclude --run-dir D --issue DEMO-1`.
      Require exit 0 and stdout {verdict:"accepted_under_contract", issue:"DEMO-1",
      producer_id:"bare-claude", seq}. Require the terminal record to be the last record of
      declared-effects.jsonl and seq (the 0-based ledger index) to equal record count minus 1;
      WHEN counts_pinned require seq=7.
  11. Record DEMO-1 outcome="shipped" (faff run-ledger record-outcome --run-dir D).
  12. Mint the run anchor:
        faff events anchor --run-dir D --issue DEMO-1 --dest <sut>/.faff/anchors/<run_id>/DEMO-1
      Require exit 0 and commissaire/producer/pk.json present with exactly {pk, pk_fingerprint}.
  13. Seal: `commissaire audit seal --run-dir D --root <sut>`.
      Require sealed=true, idempotent=false, identity.boundary_kind="run-close"; record identity and digest.
  14. Update ActiveRunPointer(state="completed") atomically.
```

Steps 10 to 13 are strictly ordered: `verdict conclude` appends the terminal record, `record-outcome` writes `run-ledger.json` plus the `ledger-write` and `issue-outcome` events, and the anchor is minted after both so the evidence carries the verdict and outcome. `bundle verify` later diffs the anchor's `events.jsonl` against the manifest `audit seal` builds, so nothing may append to `events.jsonl` between steps 12 and 13. `complete` does not invoke or simulate the Stop hook.

### Verify and publish

`verify` runs after `complete`, outside any Claude session.

```
PROCEDURE verify:
  1. Require ActiveRunPointer(state="completed").
  2. Require exactly two HookObservations for this run_id in <sut>/.faff/hook-observations.jsonl
     (read only the lines whose run_id matches the pointer's), in order: block, allow.
  3. Require both parsed hook_event_name="Stop" and input_shape_validated=true, and both carrying
     the same source; a mixed pair (one claude-code-observed, one ci-fixture) exits 1.
     WHEN source="claude-code-observed" require both provenance.session_id_sha256 values equal;
     otherwise exit 1.
  4. Run `faff runcheck D --json`; require clean=true.
  5. Run `faff events verify --run-dir D --json` and `faff effects verify --run-dir D --json`;
     require status="verified" on both.
  6. Run `faff bundle verify --root <sut> --run-id <run_id> --run-segment-id <N>
     --boundary-kind run-close --boundary-key run-close --json`; require verdict="CLEAN".
  7. Create the capture directory in a scratch location outside any git repository
     (default: a fresh temp dir; `--capture <dir>` overrides); refuse (exit 2) if non-empty.
  8. Export: `commissaire audit export --run-dir D --root <sut>
       --dest <capture>/.faff/bundles/<run_id>/seg-<N>/run-close`.
     Require exported=true and bundle_manifest_digest equal to the seal's.
  9. Copy <sut>/.faff/anchors/<run_id>/DEMO-1/ byte-for-byte to <capture>/.faff/anchors/<run_id>/DEMO-1/.
  10. Copy protected-output.txt and the two hook observations into the capture. Not the command
      observations yet; the replay legs below add more lines.
  11. Curate the anchor, exported bundle, artefact, and hook observations: curate(<capture>, D);
      exit 1 on any finding. Pre-replay secret scan of the secret-adjacent members.
  12. Replay decisions:
        commissaire audit verify --run-dir <capture>/.faff/anchors/<run_id>/DEMO-1 --json
      Require result="pass", producer_claims.verified=0, failed=0 on both buckets, pk_fingerprint
      equal to the admission's; WHEN counts_pinned require unverifiable_without_secret=4 and
      commissaire_decisions.verified=4. Record a normalised CommandObservation for this leg.
  13. Replay reconciliation:
        faff effects check --run-dir <capture>/.faff/anchors/<run_id>/DEMO-1 --issue DEMO-1 --json
      Require any_escape=false. Record a normalised CommandObservation for this leg.
  14. Replay the bundle by the shipped script: copy replay.sh into the capture, run
        sh <capture>/replay.sh
      from inside the driver checkout (the worst case for FAFF-1016). Require exit 0. Record a
      normalised CommandObservation for the replay.sh invocation and each of its three internal ones.
  14b. Write the finalised normalised command observations as command-observations.jsonl (one line
       per invocation across the whole run including the replay legs), then re-run curate(<capture>, D);
       exit 1 on any finding.
  14c. Forgery rejection, on throwaway scratch copies only, run AFTER steps 12 to 14 have already
       replayed clean on the untampered anchor. Both legs consume `commissaire audit verify` and
       assert its per-record classification; neither re-checks a signature in the fixture, and
       neither mutates the published capture or the live run dir D.
       FR-1 (Ed25519 forgery, secret-free): copy <capture>/.faff/anchors/<run_id>/DEMO-1/ (which
         carries commissaire/producer/pk.json and no governor.json) to a fresh temp dir; flip one
         byte inside the base64 commissaire_sig of the seq-7 accepted_under_contract (commissaire-
         authored) in that copy's declared-effects.jsonl (to a different base64 character, keeping the
         line valid JSON); run
           commissaire audit verify --run-dir <tampered-anchor-copy> --json.
         Require exit 1, result != "pass", the seq-7 record classified failed / commissaire-sig-
         invalid (audit verify falls back to the anchor's public key when governor.json is absent, so
         a forged governor verdict is rejected from public material alone). Record
         forgery_rejection.ed25519_sig.
       FR-2 (producer HMAC forgery, secret-present): copy the LIVE run dir D (master present) to a
         fresh temp dir; flip one byte inside the producer_hmac of the seq-6 observe (producer-
         authored) in that copy's declared-effects.jsonl (to a different hex character, keeping the
         line valid JSON); run
           commissaire audit verify --run-dir <tampered-live-copy> --json.
         Require exit 1 and the seq-6 record classified failed / producer-auth-mismatch. Record
         forgery_rejection.producer_hmac.
       In both legs the signed bytes exclude the auth field and `verifyDecision`/`verifyRecord` return
       false (never throw) on a changed value, so the tampered record classifies failed, not errors.
       These scratch-copy invocations are NOT written to command-observations.jsonl (finalised at 14b);
       their outcome lives only in DemoResult.forgery_rejection.
  15. Cross-check: decode anchors.bin and require its files map equal byte-for-byte to the captured
      anchor directory.
  16. Hash every published file except demo-result.json, write DemoResult (members, curation,
      forgery_rejection, replay_script, counts_pinned, source, session_id_sha256 when observed) and
      README.md, and remove ActiveRunPointer.
  16b. Re-read every DemoResult.members path, re-hash, compare with the recorded sha256; exit 1
       naming the first mismatch.
  16c. Run curate's field-name, absolute-path and secret-byte scans over demo-result.json and
       README.md (written after step 14b's curate), calling curate with an explicit --run-dir D (the
       live run dir the verifier has held since step 1, still in scope after the step-16 pointer
       removal); exit 1 on any finding. The explicit D means 16c's secret-byte scan runs with a
       resolved secret source, never the exit-3 no-run-dir branch, so the two files written last are
       genuinely byte-scanned for secret forms, not only for field names.
  17. Print the capture path.
```

Step 7 keeps the working copy outside any git checkout (FAFF-1016): `faff bundle verify` resolves its store through `findConfig(root)`, which inside a checkout falls back to `.faffrc.yaml`; this repository sets `bundle_store: git-remote`, so a `--root` inside the repo looks for a bundle that does not exist, while a temp directory is unaffected.

```
PROCEDURE replay.sh:
  1. Require COMMISSAIRE_ROOT; refuse (exit 2) if unset.
  2. Resolve the binaries COMMISSAIRE_ROOT-relative, never via PATH (consistent with the no-PATH
     design): CMSR="$COMMISSAIRE_ROOT/plugin/skills/faff/bin/commissaire",
     FAFF="$COMMISSAIRE_ROOT/plugin/skills/faff/bin/faff".
  3. tmp = fresh temp directory outside any git checkout; copy this capture into tmp.
  4. Read run_id and bundle_identity from tmp/demo-result.json.
  5. "$CMSR" audit verify --run-dir tmp/.faff/anchors/<run_id>/DEMO-1 --json; require result="pass".
  6. "$FAFF" effects check --run-dir tmp/.faff/anchors/<run_id>/DEMO-1 --issue DEMO-1 --json;
     require any_escape=false.
  7. "$FAFF" bundle verify --root tmp --run-id <run_id> --run-segment-id <N>
       --boundary-kind run-close --boundary-key run-close --json; require verdict="CLEAN".
  8. Print the three verdicts; exit 0 iff all three held, else exit 1.
```

### Curate

Curation is one implementation, called by `verify` steps 11, 14b, and 16c and exposed as `node scripts/verify-commissaire.mjs curate <dir> [--run-dir D]`. It exits 0 when clean and 1 naming every offending path and its finding class; it never stops at the first hit.

```
PROCEDURE curate(capture, live_run_dir?):
  1. Name-and-path walk over every file under capture (all .bin members parsed as JSON):
     a. reject any file named governor.json, any path segment producers/<id>.json, any file named
        transcript.jsonl or whose name contains "transcript".
     b. Field-name rejection: reject sk, master_secret, key_hex in any file; and cwd, session_id,
        transcript_path, token, credential in the capture's OWN authored files only (README.md,
        demo-result.json, hook/command-observations.jsonl). The anchored ledger and records[]-bearing
        stdout are NOT name-rejected (their fields do not collide with the rejected set); the step-2
        byte scan and the digest-only artifact_manifest reading cover them.
     c. Absolute-path rejection over every file (text, JSON, and each .bin parsed as JSON): reject a
        string value containing an absolute path token ANYWHERE, not only position 0. A token is a
        "/"-led sequence at string start or after a boundary character (whitespace or " ' = : ( , [),
        catching embedded /home/... or /srv/..., and the Windows drive form [A-Za-z]:[\\/] anywhere.
        A .bin that fails to parse as JSON falls back to a raw-byte scan for the same shape.
     d. allow a path-and-digest entry inside artifact_manifest.bin naming
        commissaire/governor/governor.json or commissaire/producer/producers/<id>.json.
  2. Secret byte scan:
     a. Resolve the live run dir (--run-dir, else a live ActiveRunPointer). IF neither resolves,
        report {clean:null, scan:"skipped-no-run-dir", files_scanned, secret_forms_checked:0} and
        exit 3; do not report clean:true.
     b. Read governor.json (sk, master_secret) and producers/bare-claude.json (key_hex) from it.
     c. For each secret derive: value as stored, lowercase, uppercase, the raw bytes it decodes to
        (hex or base64), the base64 of those bytes, and the base64url of those bytes (`+`/`/` mapped
        to `-`/`_`, `=` padding stripped or kept as the encoder does).
     d. Search every file's raw bytes for every form; a hit rejects the file naming the secret's
        field name, never its value. This covers the .bin members as bytes regardless of step 1.
     e. Record secret_forms_checked (at least 3).
  3. Report: exit 0 {clean:true, ...} when the byte scan ran clean; exit 3 when no run dir resolved;
     else exit 1 with one line per finding: <class> <relative path>.
```

The anchor is secret-free by construction (FAFF-976), and curation re-checks it. Steps 1d and 2 make the check content-based: a digest naming the governor file passes, the governor bytes anywhere fail.

### CI orchestration

```
PROCEDURE ci:
  1. Run prepare.
  2. Invoke the actual stop-hook wrapper with deterministic hook-shaped JSON carrying only
     hook_event_name="Stop".
  3. Require the forwarded block and an observation labelled ci-fixture in the hook store.
  4. Run complete.
  5. Invoke the same wrapper with the same hook-input shape.
  6. Require silent allow and a second ci-fixture observation.
  7. Run verify into a temporary capture directory. Publish nothing to results/.
```

The `ci` phase drives the wrapper exactly twice by construction, so the two-observation gates are well defined, and it proves the phase implementations, wrapper behaviour, containment, terminal depth, curation, replay, and OS portability.

### The impure test

`test/impure/commissaire-bare-claude.test.mjs` runs, in order:

| Case | Drives | Expects |
|---|---|---|
| Full ci | `node scripts/verify-commissaire.mjs ci` against a scaffolded SUT and the pinned driver checkout | exit 0; DemoResult fields in the integration-smoke order; both observations `ci-fixture` |
| Member digests | re-hashes every `members[].path` from `demo-result.json` independently | every sha256 equal |
| Tamper | in a scratch copy, flips one byte inside a value region of `ledger_snapshot.bin` (a byte within a quoted string value, so the member still parses as JSON but its digest changes), runs `bundle verify` | `TAMPERED` (digest mismatch), exit 1, not `MALFORMED` (which a byte flip at a structural position, a brace, quote, or comma, would yield) |
| Replay script | runs `sh replay.sh` from the capture with cwd inside the driver checkout | exit 0 |
| Replay no root | runs `sh replay.sh` with `COMMISSAIRE_ROOT` unset | exit 2 |
| Curate clean | `curate <capture> --run-dir D` on the ci capture | exit 0, `clean:true`, `secret_forms_checked` at least 3 |
| Curate contaminated | seeds a copy with (a) the live `governor.json` copied in as `notes.json`, (b) a JSON file with an absolute path embedded mid-string, (c) a `.bin` file with `master_secret` bytes mid-file, (d) a file named `transcript.jsonl`; runs `curate --run-dir D` | exit 1; stderr names all four paths |
| Curate no run-dir | `curate <capture>` with NO `--run-dir` and no live pointer | exit 3, `scan:"skipped-no-run-dir"`, `clean:null` |
| Curate late members | seeds a `demo-result.json` copy carrying (a) an embedded absolute path and (b) a governor `master_secret` byte sequence read from the live run dir, runs the step-16c scan with `--run-dir D` | exit 1 naming demo-result.json for both the path and the secret-byte finding (proves 16c's secret-byte scan resolved a secret source, not the exit-3 branch) |
| Forgery FR-1 (Ed25519, secret-free) | in a scratch temp copy of the captured anchor, flips one byte in the seq-7 `commissaire_sig` value in `declared-effects.jsonl`, runs `commissaire audit verify --run-dir <copy> --json`; then re-runs the untouched capture replay | exit 1, `result != "pass"`, the seq-7 record `failed` / `commissaire-sig-invalid`; the untouched capture still replays CLEAN |
| Forgery FR-2 (HMAC, secret-present) | in a scratch temp copy of the live run dir D, flips one byte in the seq-6 `producer_hmac` value in `declared-effects.jsonl`, runs `commissaire audit verify --run-dir <copy> --json`; then re-runs the untouched capture replay | exit 1, the seq-6 record `failed` / `producer-auth-mismatch`; the untouched capture still replays CLEAN |
| Label: fixture | wrapper with stdin `{hook_event_name:"Stop"}` and a valid pointer | `source:"ci-fixture"`, no `provenance` |
| Label: observed | wrapper with stdin carrying `hook_event_name:"Stop"`, `session_id`, `transcript_path` naming a temp file, `cwd` equal to the SUT root, `stop_hook_active:false` | `source:"claude-code-observed"`, `provenance.transcript_existed:true`, `cwd_matched:true`, `session_id_sha256` equal to `sha256(run_id + session_id)`, no raw `session_id` or `transcript_path` in the line |
| Label: missing transcript | as above but `transcript_path` naming a nonexistent path | `source:"ci-fixture"` |
| Session mismatch | writes two `claude-code-observed` observations with different session hashes, runs `verify` | exit 1 naming the mismatch |
| Mixed source | writes one `claude-code-observed` and one `ci-fixture` observation, runs `verify` | exit 1 (source mismatch at verify step 3) |
| Pointer: absolute | pointer with an absolute `run_dir`, wrapper driven with Stop stdin | block JSON, exit 0 |
| Pointer: traversal | pointer whose `run_dir` has a `..` segment | block JSON, exit 0 |
| Pointer: run_id | pointer whose basename differs from `run_id` | block JSON, exit 0 |
| Malformed stdin | wrapper driven with non-JSON stdin | block JSON, exit 0 |
| Revision pin | `COMMISSAIRE_REVISION` set to a different existing SHA, no drift flag | preflight exit 2 naming both SHAs |
| Revision drift shape | calls the drift shape-assertion function as a unit over a fabricated in-memory record list whose count differs from the pinned 8 and a hand-built pass-shape bucket JSON (live N-verified/0-unverifiable/0-failed, replay 0-verified/N-unverifiable/0-failed); not run end to end through the signed audit-verify pipeline | the shape checks pass (admission first; deny then grant, in order; exactly one `accepted_under_contract`, last; `terminal_verdict.seq` = record count minus 1) and the branch stamps `counts_pinned:false` |
| FAFF_BIN missing | wrapper whose `FAFF_BIN` points at a nonexistent path, valid pointer and Stop stdin | block JSON naming `faff-bin-unresolvable`, exit 0 |
| Runcheck spawn failure | wrapper whose `FAFF_BIN` points at a stub that exits non-zero without a decision JSON | block JSON naming `runcheck-spawn-failed`, exit 0 |
| Denied file pre-created | `protected-output.txt` created before `complete` | `complete` exit 1 (absence assertion at step 6a) |
| Complete without block | `complete` invoked with zero prior hook observations | exit 1 (complete step 2) |
| Stale hook store | seeds a stale ordinal-1 `block` observation into `<sut>/.faff/hook-observations.jsonl` before `prepare`, then runs full `ci` | `prepare` truncates the store, the wrapper's per-run_id ordinal starts clean, and `complete`/`verify` count exactly one then two observations for the new run_id; exit 0 |
| Seal not-fresh | `complete` step 13 fed a stubbed `audit seal` output of `idempotent:true` or `store_unavailable` | exit 1 |
| Non-empty capture | `verify --capture <dir>` pointed at a non-empty directory | exit 2 (verify step 7) |
| Tracked run dir | `git add -f .faff/x` in the SUT, then `verify` | exit 2 |
| Configured remote | `git remote add origin <url>` in the SUT, then any phase | preflight exit 2 |
| README claims | greps the generated capture `README.md` for the required claim sentences AND the forbidden-claim phrases | the bounded-denial statement, the FAFF-1015 / FAFF-1016 / FAFF-1017 citations, the FAFF-829 mapping table, the statement that `verdict conclude` gates only on zero evidence, and the statement that `claude-code-observed` is a forgeable derived label are all present, and none of the forbidden phrases (hostile same-UID isolation, cryptographic proof of Claude identity, universal effect prevention, merge enforcement, offline producer authentication with the master absent, a Commissaire-minted anchor) appears; exit 0 (a missing required sentence or a present forbidden phrase exits 1) |
| Gitignore content | reads the scaffolded SUT's `.gitignore` | it is exactly the two lines `.faff/` and `protected-output.txt` and does not contain `scripts/` |
| Replay resolves relative | greps the generated `replay.sh` for the `$COMMISSAIRE_ROOT/plugin/skills/faff/bin/{commissaire,faff}` construction and the absence of any bare `commissaire`/`faff` PATH invocation | both binaries resolved COMMISSAIRE_ROOT-relative, never via PATH |
| External README marker | greps `verification/external-verification/README.md` | the row labelled `commissaire-bare-claude (config-free second consumer)` is present, distinguishing the config-free second-consumer case from the factory-driven rungs |
| Source not caller-supplied | drives the wrapper with stdin including a `source` field (`{hook_event_name:"Stop", source:"claude-code-observed"}`) over a valid pointer | the recorded observation's `source` is the derived `ci-fixture` (the full Claude shape is absent), not the caller-supplied value |
| Observation order | seeds the hook store with an allow-then-block pair (reversed order) for the run_id, runs `verify` | exit 1 |
| Revision drift accept | runs a scoped phase with `ALLOW_REVISION_DRIFT=1` and `COMMISSAIRE_REVISION` set to a SHA different from `EXPECTED_COMMISSAIRE_REVISION` but present in the checkout | preflight continues (not exit 2) and `DemoResult` carries `counts_pinned:false` |
| Governor override refused | a phase invoked with a `--governor-dir` argument, or `COMMISSAIRE_GOVERNOR_DIR` set in the environment | preflight exit 2 (step 12) |

### Error handling

- Exit `2` for setup/dependency failure: an unpinned revision (no drift flag), a missing standalone binary or sealing core, a failed usage/`audit verify` probe, forbidden factory surface, a configured remote, a tracked or staged `.faff/`/`protected-output.txt`, a governor/producer dir override, a malformed pointer, an invalid phase order, `replay.sh` without `COMMISSAIRE_ROOT`, or a non-empty capture dir.
- Exit `1` for behavioural failure: a wrong decision; the granted artefact present before its authorized create (6a); a missing first block observation (2); mismatched hashes or mixed sources (3); an escape, dirty chain, or failed signature; any curation finding (incl. 16c); an unclean terminal ledger; a `verdict conclude` that does not refuse `no-evidence` in `prepare` or accept in `complete`; a terminal record not last or `seq` != count minus 1; a seal `idempotent:true`/`store_unavailable`; an export digest != seal; a replay verdict other than `pass`/`CLEAN`; a forgery leg (14c) not rejecting the tampered record with exit 1; an anchor-versus-member byte mismatch; or a member digest mismatch (16b).
- Exit `3` for the standalone `curate <dir>` with no resolvable live run dir: the secret byte scan cannot run, so the phase reports `{clean:null, scan:"skipped-no-run-dir"}` and refuses.
- Exit `0` only after the requested phase completes.
- The Stop wrapper always exits `0`; blocking is communicated through Claude Code's stdout JSON contract. A block fires for malformed stdin, a non-Stop event, an escaping or malformed pointer, an unresolvable `FAFF_BIN` (`faff-bin-unresolvable`), or a `runcheck` spawn error or non-zero exit without a decision JSON (`runcheck-spawn-failed`).

A governed refusal from `verdict conclude` exits 0 in Commissaire's contract; the verifier reads the stdout `reason`. `store_unavailable` from `audit seal` is also exit 0 (a run must never fail on a store outage), but for this harness an unwritten bundle is a behavioural failure, so the verifier requires `sealed:true`.

### Failure modes

| The failure | How you would know | What it means |
|---|---|---|
| `verdict conclude`'s evidence precondition is "any record for the issue", so a denied-never-granted run would still conclude | The unit test in `test/commissaire.test.mjs` uses a bare issue; the probe only refuses because it runs before the first request | Proceed. The completeness gate here is `runcheck --hook`; the README states conclude proves only refusal on no evidence and signed acceptance on the clean path |
| `faff events anchor-run` cannot mint: its self-verify applies the factory merge floor, which an L2 external run without a review lacks | `anchor-run` exits 1 "self-verify failed" and wipes the anchor | Proceed with `faff events anchor` (per-issue, same `mintIssueAnchor` core). FAFF-1015 owns a native mint |
| An append to `events.jsonl` between anchor mint and seal | `faff bundle verify` returns `TAMPERED` cause `events.jsonl` on an untampered run | Narrow: the verifier orders the legs (complete steps 12 to 13) and the wrapper never writes the run dir, so nothing appends between mint and seal; a TAMPERED verdict here is a sequencing bug. Documented symptom with no driving test: the leg ordering prevents the condition, so staging it would break the ordering the harness proves. The `ledger_snapshot.bin` Tamper case drives the digest-mismatch path |
| An absolute path embedded mid-string in a CLI reason or a .bin member | Curation step 1c (widened, over parsed .bin members) exits 1 naming the file | A leading-only scan would miss it; the widened match and .bin JSON parse are why the claim is now literally checked. The Curate contaminated case drives it |
| `run_segment_id` assumed to be 0 | `bundle verify` returns `MISSING` under the capture root | The verifier reads identity from the seal output |
| `faff bundle verify --root <capture>` run with the capture inside this repository | `MISSING`/`VERIFICATION_UNAVAILABLE` on a bundle that is CLEAN from a temp dir (FAFF-1016) | Proceed with `replay.sh`, which copies first; `verify` step 14 runs it from inside the driver checkout |
| A secret reaches a `.bin` member as bytes at a future revision | Curation step 2 exits 1 naming the member and secret field | Abandon that capture; the name walk alone would not see it, which is why the byte scan exists |
| The `faff` binary is unresolvable or `runcheck` errors at hook time | The wrapper emits a block JSON (`faff-bin-unresolvable`/`runcheck-spawn-failed`), never a silent allow | Narrow: the gate fails closed. A fail-open here would be the exact enforcement the harness proves |

**Anti-pattern:** duplicating ledger, signature, HMAC, reconciliation, sealing, or runcheck logic in the fixture, including a fixture-side crypto check to demonstrate forgery rejection. Why: the external proof, and the step-14c forgery legs, must consume the governance implementation and assert its classification (`commissaire audit verify`'s per-record verdict), not agree with the fixture's own copy.

**Anti-pattern:** writing `ac-checklist.json` or `review-verdict.json` into the run dir so `anchor-run` self-verifies. Why: those are factory review artefacts; forging them puts factory surface back into the SUT.

**Anti-pattern:** accepting a `source` value from the wrapper's caller or from an environment variable. Why: the label is only worth anything if it is derived from what Claude Code sent.

**Anti-pattern:** gitignoring the generated `scripts/` to hide the absolute `FAFF_BIN` constant. Why: that makes the SUT non-self-contained; the no-remote preflight refusal is the guard that keeps the path unpublished.

## 5. SCENARIOS

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```text
Given a freshly admitted producer scoped to file-write and no record for DEMO-1
When the driver asks Commissaire to conclude DEMO-1
Then verdict conclude refuses with reason no-evidence, exits 0, and appends nothing
```

```text
Given that refusal
When the producer requests the protected-output.txt file-write before declaring it
Then Commissaire returns a signed effect-not-declared denial, the file remains absent, and the
Stop-hook wrapper, driven with Stop-shaped stdin over the incomplete run, forwards a block JSON
```

```text
Given the denied descriptor is then declared unchanged
When the producer requests it again, receives a grant, creates the file, observes, reconciles,
passes live audit verify, and asks Commissaire to conclude
Then verdict conclude appends one Ed25519-signed accepted_under_contract record as the last record
with seq the 0-based ledger index (7 at the pinned revision), record-outcome closes the ledger, an
anchor and a sealed run-close bundle exist, and the wrapper driven again over the complete run stays
silent (allow)
```

```text
Given the capture retains the run anchor and the exported bundle but no governor or producer secret
When commissaire audit verify runs over the captured anchor
Then every Commissaire record verifies under the anchored public key and every producer record is
classified unverifiable_without_secret rather than silently promoted to verified
```

```text
Given the capture placed inside a clone of this repository
When sh replay.sh runs from that location with COMMISSAIRE_ROOT set
Then it resolves both binaries COMMISSAIRE_ROOT-relative, exits 0 having reported audit verify pass,
effects check no escape and bundle verify CLEAN on a temp copy, and flipping a byte inside a value
region of ledger_snapshot.bin in a scratch copy turns bundle verify to TAMPERED with exit 1
```

```text
Given a copy of a clean capture seeded with the live governor.json under another name, a JSON file
holding an absolute path embedded mid-string, a .bin file with the master_secret bytes embedded,
and a file named transcript.jsonl
When node scripts/verify-commissaire.mjs curate runs over it with the live run dir
Then it exits 1 and names all four paths, and the same command over the unseeded capture exits 0
```

```text
Given a scratch copy of the captured anchor, which carries only the public key and no governor secret
When one byte inside the base64 commissaire_sig of the seq-7 accepted_under_contract record is flipped
and commissaire audit verify runs over that copy
Then it exits 1 with result not pass, classifies the seq-7 record failed with reason
commissaire-sig-invalid, and the untouched capture still replays pass from public material alone
```

```text
Given a valid active-run pointer
When the Stop wrapper receives stdin carrying hook_event_name, session_id, a transcript_path naming
an existing file, a cwd equal to the SUT root, and stop_hook_active
Then the observation in <sut>/.faff/hook-observations.jsonl is labelled claude-code-observed with a
session hash and no raw values, and the same stdin with only hook_event_name is labelled ci-fixture
```

```text
Given a pointer whose run_dir is absolute, contains a .. segment, or has a basename other than run_id
When the Stop wrapper is driven with Stop-shaped stdin
Then it prints a block JSON and exits 0 without reading any run directory
```

Non-functional assertions:

- Hosted Linux and macOS execute `node scripts/verify-commissaire.mjs ci` from `test/impure/commissaire-bare-claude.test.mjs` by their existing globs.
- The verifier requires only Node 20, git, and the separately supplied full CLI checkout at exactly `EXPECTED_COMMISSAIRE_REVISION`.
- No network, git remote, Marketplace Action, or factory skill is required; the SUT has no git remote.
- Every Commissaire leg is invoked through `plugin/skills/faff/bin/commissaire`; the `faff` binary appears only in the run-ledger, anchor, chain-validator, runcheck and bundle-verify legs.
- No byte form of `sk`, `master_secret` or `key_hex` appears in any capture file.
- No string value in any capture text, JSON, or `.bin` member contains an absolute host path.

## 6. DESIGN DECISION RATIONALE

**Where should the harness live?**
**Chosen:** keep the scaffolder, phased verifier, hook wrapper, replay script, and documentation under `verification/external-verification/`; create the SUT as a fresh no-remote repository. Unchanged from 2026-09-02.

**Fix-only refresh, terminal depth, or a Commissaire-native Stop hook?**
Options: (A) update the command names only and keep the ledger outcome as terminal; (B) keep the two-turn `runcheck --hook` design and add the now-real terminal surface; (C) replace the runcheck hook with a Commissaire-native hook.
**Chosen:** (B). The operator closed this on 2026-09-06, after the 2026-09-04 park note asked for the standalone CLI. (B) makes the harness produce the FAFF-828 Outcome verbatim without touching the hook seam already reviewed; (A) leaves the strongest half of the shipped CLI undemonstrated; (C) is a redesign with no shipped verb to build on.

**How should the Stop hook share run ownership across turns?**
**Chosen:** `prepare`/`complete`/`verify` around an atomically written, containment-validated active-run pointer the Stop hook reads itself; every containment failure is a block, each an impure-test case.

**Where does the wrapper store hook observations?**
**Chosen:** `<sut>/.faff/hook-observations.jsonl`, under gitignored `.faff/` but outside the run directory; command observations go to the sibling `command-observations.jsonl`.

**How does the wrapper resolve the `faff` binary in a SUT with no `faff` on PATH?**
Options: (a) PATH lookup, contradicting the no-PATH design; (b) read `COMMISSAIRE_ROOT` from ambient env at hook time, putting env inheritance on the critical path; (c) a scaffolder-substituted absolute `FAFF_BIN` constant.
**Chosen:** (c). The scaffolder fills `const FAFF_BIN = "<COMMISSAIRE_ROOT>/plugin/skills/faff/bin/faff"` at scaffold time, the same mechanism that fills `EXPECTED_COMMISSAIRE_REVISION`, so resolution needs no PATH and no inherited env. Option (b) is rejected against the repository's own env paranoia: `corrective-integrity.js` reads declarations only from `/proc/1/environ` and treats inherited process env as a poisoning surface.

**What keeps the committed `FAFF_BIN` absolute path off a shareable artefact?**
Options: gitignore the generated scripts, substitute the constant away, or refuse a git remote.
**Chosen:** refuse a remote. Preflight exits 2 if `git remote -v` is non-empty. Gitignoring `scripts/` would make the SUT non-self-contained and collapsing the constant would break deterministic resolution. The honest bound is a runtime one: the harness refuses a SUT with a remote, and only the curated temp-copy capture is published. It is not the stronger "the path can never be pushed" (adding a remote and pushing outside the harness leaks a local filesystem path, not a secret).

**What happens when the hook cannot invoke `faff`?**
**Chosen:** fail closed. A spawn error, a non-zero exit with no decision JSON, or a missing `FAFF_BIN` all emit a block JSON; a silent allow on a resolution failure would be the exact enforcement the harness exists to prove. Two impure cases drive it.

**What effect proves both refusal and later permission?**
**Chosen:** the reversible descriptor `{kind:"file-write", target:"protected-output.txt"}` used twice, denied before declaration then granted after (`file-write` is in the closed `EFFECT_KINDS` vocabulary in `effects.js`).

**How far does the harness prove the denial was honoured?**
**Chosen:** assert absence twice, at `prepare` step 7 and `complete` step 6a; the claim is bounded to those two instants and does not cover a transient create-then-delete inside a turn.

**What does "no factory installed" mean, and which binary does what?**
**Chosen:** no config/skills/plugins/copied implementation in the SUT, a full immutable CLI checkout outside it; `commissaire` issues every governance decision, `faff` serves the flight-recorder legs, and the anchor mint is the one coupling (FAFF-1015).

**Which driver revisions may run the harness?**
**Chosen:** exactly one pinned SHA. Preflight refuses any other SHA; `ALLOW_REVISION_DRIFT=1` relaxes the counts to shape assertions and stamps `counts_pinned:false`.

**How is the drift branch rehearsed without a re-signable drifted ledger?**
Options: drive `ALLOW_REVISION_DRIFT=1` end to end over a hand-edited `declared-effects.jsonl`, or unit-test the shape-assertion function over fabricated inputs.
**Chosen:** unit-test the function, as the WHAT drift paragraph specifies. Hand-editing `declared-effects.jsonl` shifts `seq` and breaks the signatures (re-signing needs the master secret), so the pass-shape buckets could never appear; the end-to-end path stays pinned-counts only.

**Should `prepare` probe `verdict conclude` before any evidence exists?**
**Chosen:** require the founded `no-evidence` refusal. It writes nothing and gives Commissaire-native evidence for refusing to call an incomplete run done; it runs after `contract admit`, before the first `effect authorize`.

**Which phase runs the terminal verbs?**
**Chosen:** `complete` runs conclude, record-outcome, anchor, and seal; `verify` runs export, curation, and replay (the FAFF-828 Outcome includes the verdict and seal, so FAFF-1018's session drives them).

**How is the run-close anchor minted?**
**Chosen:** `faff events anchor` (per-issue), not `anchor-run` (whose merge-floor self-verify needs review artefacts this harness must not fake); same `mintIssueAnchor` core. FAFF-1015 owns a native mint.

**How is evidence published and replayed?**
**Chosen:** the capture is the run anchor beside the exported bundle (`CaptureLayout`), plus the artefact, the two observation stores, DemoResult, `replay.sh`, and a bounded-claims README; `audit verify` replays the anchor, `faff bundle verify` the export, `faff effects check` reconciliation, and a byte comparison ties the anchor to the bundle's `anchors` member.

**How does a reader replay from inside a clone, and how do the binaries resolve?**
**Chosen:** ship `replay.sh`, resolving both binaries COMMISSAIRE_ROOT-relative (never PATH), copying the capture to a temp dir and running the three replays there, exit 0 only when all hold; `verify` step 14 runs it from inside the driver checkout. FAFF-1016 owns removing the copy.

**What owns secret-free authentication classification?**
**Chosen:** `commissaire audit verify` (FAFF-977) is the sole owner; the verifier consumes its versioned JSON and never classifies a record itself.

**How does the demo show forgery rejection without re-implementing any crypto?**
Options: (a) a fixture-side signature/HMAC check that re-derives the verdict; (b) two negative-path legs through `commissaire audit verify` on throwaway scratch copies, after the clean replays pass.
**Chosen:** (b), at `verify` step 14c: FR-1 tampers a `commissaire_sig` in a scratch anchor copy, FR-2 a `producer_hmac` in a scratch live-run-dir copy, both asserting the per-record `failed` classification. Option (a) is the demo's own anti-pattern; both legs leave the untouched capture replaying CLEAN and extend FAFF-829 bullet 2 into the external consumer.

**How is the capture proven secret-free, and how wide is the absolute-path scan?**
Options: a name-based walk only, or that plus a content scan for the live secrets' byte forms; a leading-only path check, or a widened embedded-path check over text, JSON, and parsed `.bin` members.
**Chosen:** both walks, widened, as the WHAT and Curate sections specify. The byte scan (every derived form) is the backstop a name walk cannot give; the widened path check catches an embedded `/home/...` mid-string or inside `anchors.bin`. Field-name rejection is scoped to the capture's own authored files because `audit verify`'s `records[]` carry only `{seq, author, kind_of_entry, classification, reason}`, none colliding.

**What does the standalone `curate` phase do with no live run dir?**
**Chosen:** refuse. With no `--run-dir` and no live pointer, `curate` reports `{clean:null, scan:"skipped-no-run-dir"}` and exits 3 rather than pass a capture that could carry secret bytes; `verify` always calls it with D (steps 11, 14b, 16c).

**When are the command observations written and curated?**
**Chosen:** after the replays. `verify` records a normalised CommandObservation per replay leg, writes the file at step 14b, and re-runs `curate`; the pre-replay `curate` at step 11 still covers the anchor and secret-adjacent `.bin` members.

**How are absolute paths kept out of recorded stdout?**
**Chosen:** normalise at record time (the `normalise_stdout` procedure) and re-check at curation, so a missed normalisation fails `curate` rather than publishing a path.

**What keeps the SUT tree from leaking the run dir?**
**Chosen:** the scaffolder's `.gitignore` is exactly `.faff/` and `protected-output.txt`; preflight refuses (exit 2) if `git ls-files -- .faff protected-output.txt` prints any path, and only the curated temp-dir capture is published.

**How is cross-platform execution proven?**
**Chosen:** put the real filesystem/subprocess test under `test/impure/`, which the Linux `validate` and `validate-macos` lanes both run by location alone, no workflow edit.

**How is real Claude invocation distinguished from CI simulation?**
Options: a caller-asserted `source` value, or a label the wrapper derives from the stdin shape Claude Code sends.
**Chosen:** wrapper-derived, per the stop_hook step 7 and HookObservation definitions. Anything short of the full Claude Code Stop stdin shape is `ci-fixture`; `verify` requires equal session hashes and sources on the pair. The label is checkable provenance a hostile operator can forge, not a cryptographic identity claim, and is inert on the enforcement path; a real session producing it and the attestation over it are FAFF-1018's.

**How does the scaffolder drift lint accept a config-free scaffolder?**
**Chosen:** keep the `scaffold-` prefix and add a `CONFIG_FREE` set to `test/scaffolder-cli-surface-drift.test.mjs`. For a member the test asserts the `.faffrc.yaml` here-doc is absent, still requires the `RUNBOOK.md` here-doc, and still lints every `faff` gesture.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

### Open questions

None.

### Assumptions

None. The 2026-09-02 assumption ("FAFF-977 lands before FAFF-360 builds") is discharged: FAFF-977 is Done, and preflight steps 6 to 8 probe the pinned revision for the standalone binary, the sealing core, and the `audit export` and `audit verify` surface.

## 8. DONE: definition of done

### From WHY

- [ ] A fresh no-remote SUT completes without `.faffrc`, factory skills, plugins, or copied CLI implementation.
- [ ] The capture README limits claims to the WHY's bounded set (external consumption, founded decisions, consumer compliance, detection, the signed verdict, the sealed bundle, secret-free replay), and states the bounded denial claim, that `verdict conclude` gates only on zero evidence, that the anchor is minted by `faff events anchor` (FAFF-1015), that `replay.sh` copies out (FAFF-1016), that `cli.md` drift is FAFF-1017, and that `claude-code-observed` is a forgeable derived label.
- [ ] The capture README names the pinned revision and carries the FAFF-829 mapping (bullet 1 produced by FAFF-1018 using this harness; bullet 2 also demonstrated externally by FAFF-360's FR-1 and FR-2 forgery legs, beyond the in-repo unit fixtures; bullets 8 and 9 by FAFF-360).
- [ ] An impure "README claims" case greps the generated capture README, exiting 1 on any failure, asserting every required sentence is present (the bounded-denial statement, the FAFF-1015/1016/1017 citations, the FAFF-829 mapping table, that `verdict conclude` gates only on zero evidence, and that `claude-code-observed` is a forgeable derived label) and that no forbidden-claim phrase from the WHY "Claims stop at the evidence boundary" set appears, so the README-content items are CI-decidable in both directions.
- [ ] Command observations show every governance leg served by the `commissaire` binary and only the run-ledger, anchor, chain-validator, runcheck and bundle-verify legs served by `faff`.
- [ ] `EXPECTED_COMMISSAIRE_REVISION` in the scaffolder and the verifier is the same 40-character SHA, and preflight exits 2 naming both SHAs when `COMMISSAIRE_REVISION` differs and `ALLOW_REVISION_DRIFT` is unset.
- [ ] An impure "Revision drift accept" case runs a scoped phase with `ALLOW_REVISION_DRIFT=1` and `COMMISSAIRE_REVISION` a different-but-present SHA, and asserts preflight continues (not exit 2) and `DemoResult` carries `counts_pinned:false` (the acceptance branch, distinct from the unset-flag refusal and the pure-shape drift unit test).
- [ ] Preflight exits 2 when the SUT has a configured git remote.

### From WHAT

- [ ] The scaffolder, five-phase verifier, Stop-hook wrapper, `replay.sh`, README, and impure test exist at the specified surfaces; the `ci` phase publishes nothing to `results/`.
- [ ] The scaffolder's `.gitignore` is exactly `.faff/` and `protected-output.txt`, and does not gitignore `scripts/`; an impure "Gitignore content" case reads the scaffolded SUT's `.gitignore` and asserts exactly those two lines and the absence of `scripts/`.
- [ ] The active-run pointer rejects absolute paths, traversal segments, mismatched run IDs, and paths resolving outside the SUT, each as a block JSON with exit 0, and each is an impure-test case.
- [ ] The wrapper writes each HookObservation to `<sut>/.faff/hook-observations.jsonl` (outside the run dir), deriving `ordinal` as (existing lines for this run_id) + 1; `prepare` truncates the store so an aborted attempt leaves no stale line; `complete` step 2 and `verify` step 2 read only this run_id's lines.
- [ ] `HookObservation` schema 2 carries `source` and, only for `claude-code-observed`, `provenance` with `session_id_sha256`, `transcript_existed`, `cwd_matched`, and no raw `session_id`, `transcript_path` or `cwd`.
- [ ] `DemoResult` schema 3 carries `expected_commissaire_revision`, `counts_pinned`, `session_id_sha256` when observed (no `attested_by`), the observations block, `curation`, `forgery_rejection`, `bundle_identity`, and `members`, with seal and export digests equal and `terminal_verdict.seq` = record count minus 1; `bundle_identity.run_segment_id` and `boundary_seq` are read from the `audit seal` `identity`, never invented.
- [ ] Every `stdout_json` in `command-observations.jsonl` has passed `normalise_stdout`: no `governor_dir`, `producer_dir`, `run_dir`, `dest`, `path` or `anchor_dir` field, and no absolute path token anywhere in any string value.
- [ ] The capture directory matches `CaptureLayout`: the anchor under `.faff/anchors/<run_id>/DEMO-1/`, the export under `.faff/bundles/<run_id>/seg-<N>/run-close/`, and `replay.sh` at the root.
- [ ] Every CLI contract table command is invoked with exactly the flags listed and its exit code and stdout shape asserted, with no local re-implementation of any classification.

### From HOW

- [ ] Preflight refuses a revision lacking `bin/commissaire` or `lib/bundle-seal-core.js`, a usage text without `audit export`, an `audit verify` probe not exiting 2 on an empty dir, a configured remote, a SUT whose `git ls-files -- .faff protected-output.txt` prints any path, or a governor/producer dir override reaching the verifier (step 12), so governor and producer secrets stay under `<run-dir>/commissaire/` beneath the gitignored `.faff/`.
- [ ] `prepare` obtains the `no-evidence` refusal (exit 0, one admission record still the only record), then `effect-not-declared` for the undeclared file-write, proves the file absent, writes the pointer, and leaves the ledger incomplete.
- [ ] The Stop hook reads the pointer, resolves `FAFF_BIN` from the scaffolder-substituted constant (no PATH, no inherited env), supplies `FAFF_RUN_DIR`, forwards the first block, and appends a sanitized observation whose `source` it derived itself.
- [ ] The wrapper fails closed: a missing `FAFF_BIN` blocks naming `faff-bin-unresolvable`, and a `runcheck` spawn error or non-zero exit without a decision JSON blocks naming `runcheck-spawn-failed`; both are impure cases.
- [ ] A stdin of only `hook_event_name:"Stop"` yields `ci-fixture`; a stdin with `session_id`, an existing `transcript_path`, `cwd` equal to the SUT root and `stop_hook_active` yields `claude-code-observed`; a missing transcript file yields `ci-fixture`.
- [ ] `complete` exits 1 without a first block observation (an impure case drives zero prior observations).
- [ ] `complete` declares and requests the identical file-write, requires a grant before creating it, asserts `protected-output.txt` absent immediately before the create and exits 1 if it exists, observes, reconciles with `any_escape=false`, and obtains live `audit verify` with zero unverifiable and zero failed (4 and 3 verified when `counts_pinned`).
- [ ] `complete` then obtains `accepted_under_contract` as the last record with `seq` = record count minus 1 (7 when `counts_pinned`), records `shipped`, mints the anchor with `faff events anchor`, and seals with `sealed:true, idempotent:false`.
- [ ] `verify` requires the ordered block/allow observations with equal `source` (a mixed pair exits 1) and equal session hashes when `claude-code-observed`, clean runcheck, verified chains, and a CLEAN bundle under the SUT root before exporting; an impure "Observation order" case seeds a reversed allow-then-block pair for the run_id and asserts `verify` exits 1 (ordering asserted distinctly from identity).
- [ ] `verify` exports, copies the anchor, curates, and replays: `audit verify` over the anchor reports zero verified producer claims and zero failures (0/4/0 and 4/0 when `counts_pinned`) with the admission's `pk_fingerprint`; `effects check` reports no escape; `sh replay.sh` resolves both binaries COMMISSAIRE_ROOT-relative, exits 0 from inside the driver checkout and exits 2 without `COMMISSAIRE_ROOT`; an impure "Replay resolves relative" case greps `replay.sh` for the `$COMMISSAIRE_ROOT/plugin/skills/faff/bin/{commissaire,faff}` construction and asserts no bare `commissaire`/`faff` PATH invocation.
- [ ] The decoded `anchors` member equals the captured anchor directory byte-for-byte.
- [ ] `verify` step 16b re-hashes every `members[].path` and exits 1 on mismatch; step 16c scans `demo-result.json` and `README.md` for absolute paths and secret bytes, calling `curate` with an explicit `--run-dir D` so the secret-byte scan resolves a secret source and never hits the exit-3 no-run-dir branch.
- [ ] `curate <dir> --run-dir D` exits 0 on the clean capture with `secret_forms_checked` at least 3, exits 1 naming all four paths on the contaminated copy (including a mid-string absolute path and a `.bin` with `master_secret` bytes), and standalone `curate <dir>` with no `--run-dir` exits 3 with `scan:"skipped-no-run-dir"` and `clean:null`.
- [ ] Curation scopes its field-name rejection to the capture's authored files, applies the widened absolute-path scan over every text, JSON, and parsed `.bin` member, and allows a digest-only path entry inside `artifact_manifest.bin` naming `commissaire/governor/governor.json`.
- [ ] No fixture code reimplements governance validation, sealing, or anchor minting; no fixture writes `ac-checklist.json` or `review-verdict.json`; the wrapper accepts no `source` from its caller or environment; the forgery legs re-check no signature or HMAC in the fixture. An impure "Source not caller-supplied" case feeds stdin carrying `source:"claude-code-observed"` over a valid pointer and asserts the recorded observation is the derived `ci-fixture`, not the caller-supplied value.
- [ ] `verify` step 14c runs both forgery legs on throwaway scratch copies after the clean replays pass: FR-1 flips a byte in the seq-7 `commissaire_sig` of an anchor copy and requires `commissaire audit verify` exit 1 with `result != "pass"` and that record `failed`/`commissaire-sig-invalid`; FR-2 flips a byte in the seq-6 `producer_hmac` of a live-run-dir copy and requires exit 1 with that record `failed`/`producer-auth-mismatch`; neither leg mutates the capture or the live run dir, and the untouched capture still replays CLEAN.
- [ ] `DemoResult` carries `forgery_rejection.ed25519_sig` and `forgery_rejection.producer_hmac`, each with `tampered_field`, `tampered_seq`, `result:"fail"`, `reason`, and `exit:1`.

### From SCENARIOS

- [ ] The `ci` phase drives the wrapper twice with fixture stdin, producing exactly two `ci-fixture` observations (block then allow) that satisfy the `complete` and `verify` count gates.
- [ ] A `verify` observation pair of unequal identity (two `claude-code-observed` with different hashes, or one `claude-code-observed` and one `ci-fixture`) makes `verify` exit 1.
- [ ] An impure case calls the drift shape-assertion function as a unit over a fabricated record list (count != 8) and a hand-built pass-shape bucket JSON, asserting the shape checks pass and `counts_pinned:false`; the drift branch is not run end to end through the signed pipeline.
- [ ] `test/impure/commissaire-bare-claude.test.mjs` runs every case in the impure-test table, including the `ledger_snapshot.bin` flip to `TAMPERED`, the mixed-source `verify`, the seal-not-fresh and non-empty-capture failures, and `replay.sh`-without-`COMMISSAIRE_ROOT` exit 2.
- [ ] The impure test drives both forgery cases (FR-1 secret-free Ed25519 rejection, FR-2 secret-present HMAC rejection), each asserting `commissaire audit verify` exit 1 and the per-record reason, and that the untouched capture still replays CLEAN.
- [ ] The file lives under `test/impure/` and both lanes run it by their existing globs.
- [ ] `test/scaffolder-cli-surface-drift.test.mjs` lists the scaffolder in `CONFIG_FREE`, fails if a `.faffrc.yaml` here-doc appears, and still lints its `RUNBOOK.md` `faff` gestures.
- [ ] `verification/external-verification/README.md` gains a row labelled `commissaire-bare-claude (config-free second consumer)`, distinguishing the config-free second-consumer case from the factory-driven rungs; an impure "External README marker" case greps the README for that exact label, exiting 1 if absent.

### Integration smoke test

```text
PROCEDURE integration_smoke:
  1. Scaffold a fresh no-remote SUT.
  2. Point COMMISSAIRE_ROOT at a clean checkout at exactly EXPECTED_COMMISSAIRE_REVISION.
  3. Set COMMISSAIRE_REVISION to that SHA.
  4. Run node scripts/verify-commissaire.mjs ci.
  5. Assert exit 0, counts_pinned=true, nothing written to results/, and DemoResult records in order:
       no-evidence refusal, block (ci-fixture), effect-not-declared, grant, no escape,
       live audit verify 4/0/0 and 3/0, accepted_under_contract last with seq 7, sealed run-close bundle,
       allow (ci-fixture), clean runcheck, export digest equal to seal, curation clean (>= 3 forms),
       replay audit verify 0/4/0 and 4/0, replay bundle CLEAN, replay.sh exit 0,
       forgery_rejection both legs fail (FR-1 seq-7 commissaire-sig-invalid, FR-2 seq-6
       producer-auth-mismatch, each exit 1) with the untouched capture still replaying CLEAN,
       anchor equals anchors member, every member digest re-hashes equal.
```

confidence: high

spec-review: approve (round 8, faffter-dark-spec-review single-pass; architectural + infosec cleared after grounding, QA backend-outage-unavailable, 2-of-3 decisive)

build-tier: complex

```faff-contract:spec-readiness
{"confidence":"high","decisions":[{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"},{"marker":"chosen"}]}
```


---

**Follow-ups:** FAFF-1015/1016/1017 (cited gaps); FAFF-1018 (operator-attested live capture; blockedBy this ticket, blocks FAFF-829). **Review trail:** rounds 3-5 drove the split; round 6 (8, converging) and round 7 (8 coverage gaps) cleared here; forgery legs validated clean by infosec in round 7. Methodology summary in a separate comment.
