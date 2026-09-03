# Spec: Bank the nine-scenario Phase 0 reference matrix and common audit bundle (FAFF-822)

> Spec: faffter-dark-nlspec · 2026-09-03 · interactive · claude-code/unknown · confidence: high. Built against `main` at `3fd514da`. Full spec on Linear FAFF-822.

> Revised 2026-09-03 (reconcile with merged ADR-0123 / FAFF-977 / FAFF-980 / FAFF-978): (1) the per-scenario record is renamed off "audit" to **`ScenarioRecord`** — ADR-0123 now reserves `commissaire audit` as the governance evidence object (seal/export/verify), so the ticket's "common audit bundle" is realised as `ScenarioRecord` to avoid the word clash. (2) The emitter stays out of `commissaire` on the correct ground: it is **not one of ADR-0123's four facade objects** (`contract`/`effect`/`verdict`/`audit`) — it is cross-oracle Phase-0 evidence tooling — NOT because "commissaire audit doesn't exist" (it now does). (3) The auth-leg oracle is now the public **`commissaire audit verify`** seam (FAFF-977), not in-process `verifyAuthLeg` calls. (4) `seal-bundle` → canonical `commissaire audit seal` (alias retained). Approach and the nine oracles are otherwise unchanged; because the oracle-source change (3) is substantive, the retained `spec-review: approve` is offered for re-review.

This is the nlspec-format design spec for FAFF-822, the Phase 0 assurance-banking slice of the SuperDomestique v5 roadmap. It designs a reproducible harness that runs the nine V5 reference scenarios, emits one common **scenario record** per scenario (the ticket's "common audit bundle") through a pure governance-region emitter, and banks the results with honest assurance vectors and inspectable positive and negative outcomes. The intended readers are the build agent that will implement it and the human reviewers who gate it. It cites real `file:line` throughout, verified against the tree at `3fd514da` (bind by symbol; 977/978/980 shifted some `commissaire.js` lines).

The matrix is accumulated incrementally from implementation fixtures and real runs. It is not a prerequisite for the external Commissaire facade or FAFF-828. It blocks only FAFF-824's acceptance of the full outward baseline and any broad cross-scenario reliability, independence, recovery, or effect claim.

## 1. WHY: problem and principles

**The load-bearing model.** The nine reference scenarios already exist as assertions scattered across `test/commissaire.test.mjs`, `test/bundle-recover.test.mjs`, `test/budget.test.mjs`, and `test/effects.test.mjs`, but each test proves its own point in its own shape and nothing collects them into one comparable, inspectable matrix that records the achieved assurance per scenario. This slice adds one common `ScenarioRecord` shape, a pure emitter that builds it from oracle outputs, and a harness that runs all nine scenarios (positive and negative) mkdtemp-mint-then-mutate over the real `faff` binary and banks one record each. The whole point is a single artifact where every row names its inputs, its identities, its one canonical disposition, its evidence locations, and an assurance vector whose claim label can never exceed what the oracle actually proved.

**Problem statement.** Today "the protocol works" is asserted test-by-test with no banked, replayable evidence matrix and no honest per-scenario assurance vector, so a reader cannot see the nine outcomes side by side or check that a public claim label does not overstate the mechanism that was proved. This slice banks the nine scenarios as one common record shape with a reproducible protocol a clean operator can replay from a pinned release. It changes no governance mechanism: it reads the existing oracles and records what they already decide.

**Design principles** (each would cause rejection of an otherwise-valid implementation):

**A claim label may never exceed the assurance vector.** The emitter computes the vector from oracle outputs first, then validates that `claim_label` is less than or equal to every dimension of the vector; a record whose label overstates its vector fails loud at emit time. E-B prevention is claimable only at the merge chokepoint (scenario 2, seeded governance block); every other catch is E-C detection and must say so in its label. Producer HMAC authentication is J-C mechanical detection, not non-repudiation, and the label states J-C. Any design that lets a scenario advertise more than its oracle proved is a rejection.

**The auth-leg oracle is the public `commissaire audit verify` seam.** Every row whose oracle is authentication (1, 3, 4, 8, and the two-custodian assertion) reads the **public** `commissaire audit verify --json` output (FAFF-977, `commissaire.js:249`), not an in-process `verifyAuthLeg` call. That JSON is a cross-boundary public contract (FAFF-360's portable verifier reproduces it), so using it as the oracle is what makes FAFF-822's own "a clean operator replays from a pinned release" acceptance real. Its three-way producer classification (`verified` / `unverifiable_without_secret` / `failed`) is recorded verbatim in the basis; an `unverifiable_without_secret` producer claim is **never** folded into a generic pass.

**Independence is proved as mechanism only.** Scenario 3 (independence failure) proves that a producer holding only its symmetric HMAC key cannot author a Commissaire Ed25519-signed grant, and that a secret-free auditor holding only `pk.json` can still detect the forgery via `commissaire audit verify`. It never infers organisational independence from one maintainer running both custodians; `organisational_independence` is recorded false.

**The two-custodian split is asserted in every row.** Every scenario asserts that the governor directory holds the signing key and master secret while the producer directory holds only the derived producer key and the public key, never both in one file. The secret-free `commissaire audit verify` (pk.json only) is the running proof that an auditor with only PK can verify Commissaire decisions without either secret.

**One canonical disposition per scenario, with its raw basis retained.** The nine scenarios read heterogeneous oracle vocabularies (`commissaire audit verify` classification, `decideFloor` verdict, `bundleRecover` disposition, budget outcome, `computeEscapes.any_escape`, `verifyLedgerChain` status). Each record carries exactly one `disposition` from a fixed nine-value vocabulary plus a `disposition_basis` object with the raw oracle verdicts, so the comparable column never floats free of the mechanism.

**The emitter is a pure governance-region function, outside the Commissaire facade.** The `ScenarioRecord` builder reads only its scenario-result input and returns the record; no filesystem, tracker, network, or LLM access, matching `computeEscapes` (`effects.js:87`). It lives in region governance and requires no factory file, so `regions.js` holds. **Region and CLI namespace are independent axes**, and the CLI namespace is deliberately **not** `commissaire`: ADR-0123 fixes the Commissaire facade objects as `contract`/`effect`/`verdict`/`audit`, and this cross-oracle evidence tool is none of them — it gets its own `faff scenario-matrix` group (§3).

**Negative and null results stay in the bank.** A denied, blocked, refused, or detected outcome is a positive result for this matrix. A `one_shot_control` of `null` on scenarios 1, 4, 7, 8, 9 is a real recorded value. The report never drops a negative row to look complete.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/lib/commissaire.js` | CommonJS | `evaluateDecisionRequest` (~129), `chokepointPermit` (~166, `decision-signature-invalid`), `verifyAuthLeg` (195, authoritative-PK per FAFF-978), **`cmdAuditVerify` (249) — the `commissaire audit verify` public seam**, `producer-auth-mismatch`/`commissaire-sig-invalid` (~218/222), object-grammar usage (315-323), `audit seal` (alias `seal-bundle`) consumed as a scenario-4 precondition, `governorDirOf`/`producerDirOf`. Region: governance. Read, not changed. |
| `plugin/skills/faff/bin/lib/producer-auth.js` | CommonJS | `deriveKey` HKDF (64), `signRecord`/`verifyRecord`, `mintGovernorKeypair`, `signDecision`, `verifyDecision`. Region: governance. The amendment oracle (scenario 8) rests on `deriveKey`. |
| `plugin/skills/faff/bin/lib/effects.js` | CommonJS | `computeEscapes` (87) → `{escapes:[{signal:"escaped-side-effect",...}],any_escape}`. Region: governance. Scenario 6 oracle. |
| `plugin/skills/faff/bin/lib/events.js` | CommonJS | `verifyLedgerChain` (745) status incl. `torn_tail`, `verifyEffectsChain` (847). Region: governance. Scenario 4 chain oracle. |
| `plugin/skills/faff/bin/lib/contract-defs.js` | CommonJS | `decideFloor` (pure `FloorInputs`→`{verdict,blockers}`, verdict 2129), `FLOOR_DECISION_GRANTS` (2104), the FAFF-828 decision blocker string (2128). Region: governance. Scenario 2 oracle. |
| `plugin/skills/faff/bin/lib/bundle-recover.js` | CommonJS | `idempotencyDecision` (105) → `absent`/`match`/`conflict`, `bundleRecover` (404) disposition `reconstructed`/`noop-already-present`/`refused`. Region: factory. Scenario 4 recovery oracle. |
| `plugin/skills/faff/bin/lib/budget.js` | CommonJS | `AT_CEILING_OUTCOMES` `{stop,narrow,escalate,park-until-window-reset}` (121), breach `resume_at` only on park. Region: governance. Scenario 7 oracle. |
| `plugin/skills/faff/bin/lib/andon.js` | CommonJS | `ANDON_CLASSES` (48) incl. `budget-breach`. Region: factory. Scenario 7 andon signal. |
| `records/adr/0123-commissaire-cli-is-a-noun-verb-object-grammar-grammar-first.md` | Markdown | The Commissaire facade objects (`contract`/`effect`/`verdict`/`audit`); `audit` = the governance evidence record (seal/export/verify); why `scenario-matrix` is correctly outside the facade. |
| `test/commissaire.test.mjs` | ESM | `mkRun(prefix,runId)` (32), `records(p)` (38), `runCom(args,input)` (39); the nine already exist here as separate tests. The harness reuses these patterns. |
| `test/helpers/run-cli.mjs` | ESM | `runCli(args,opts)`→`{stdout,stderr,code}` (22), `repoRoot`/`faffBin` (43). The real-bin spawn seam. |
| `eval/run-evals.mjs`, `eval/envelope.mjs` | ESM | `buildJudgementRecord` (42), `judgements.jsonl` (76), `case_id`-keyed envelope (40). The real second-producer bridge source; carries `case_id`, not run/work-item identity (see Assumptions). |
| `verification/audits/2026-08-07-FAFF-732-public-trust-claims/` | JSON + MD | the banked-evidence pattern this slice mirrors: a data ledger plus a byte-checked deterministic report with a `--selftest` validator. |
| `docs/rfc/.../v5/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md` | Markdown | Phase 0 reference scenarios (602-614), eval-baseline as first second-use (618-628), assurance classes J-A..J-D / E-A..E-D (306-317 / 486-495). |

**Scope statement.** This slice is the common `ScenarioRecord` shape, its pure emitter and validator, the reproducible nine-scenario harness that banks one record each, and the one-shot control on the four catch rows. It changes no governance mechanism and adds no new state class to the authority map.

## 2. Out of scope

- **New governance mechanism.** Excluded: any change to `evaluateDecisionRequest`, `chokepointPermit`, `decideFloor`, `computeEscapes`, `bundleRecover`, `verifyAuthLeg`, or `cmdAuditVerify`. Why: this slice reads the shipped oracles and records their outputs. Extension point: none; the oracles are their own tickets.
- **A `commissaire` facade object/verb for the emitter.** Excluded: exposing the emitter under `commissaire`. Why: ADR-0123 fixes the Commissaire facade objects as `contract`/`effect`/`verdict`/`audit`; a cross-oracle Phase-0 evidence-matrix tool is none of those governance moments. It gets its own `faff scenario-matrix` namespace (§3). Extension point: `faff scenario-matrix` subcommands.
- **Re-implementing auth verification.** Excluded: a second verifier. Why: FAFF-977's `commissaire audit verify` is the one public projection of `verifyAuthLeg`; the harness consumes it, never forks it. Extension point: none.
- **Real eval-baseline second-producer run wired into CI.** Excluded: scheduling/gating a live eval-baseline run. Why: delivery boundary is fixtures first, real run banked later; SuperDomestique does not schedule the external producer. Extension point: the eval-bridge adapter projects a banked real row into the same `matrix.jsonl` shape out of band.
- **A product-facing one-shot / faff-lab surface.** Excluded: a shipped verb / interactive faff-lab tool. Why: Phase 0 needs the control as harness evidence on four rows, not a product feature. Extension point: the harness `oneShotControl` helper.
- **Extending the b2 recovery bundle to carry matrix fields.** Excluded: adding assurance fields to `buildBundle`'s `b2` manifest. Why: the b2 bundle is a durability artifact keyed by boundary; the `ScenarioRecord` is an assurance/matrix artifact keyed by scenario. Extension point: the record references a b2 bundle by identity in scenario 4's `evidence_paths`.
- **New disposition, budget, or andon vocabularies.** Excluded: adding members to `AT_CEILING_OUTCOMES`, `ANDON_CLASSES`, or the Commissaire verdict reasons. Extension point: the disposition mapping in section 3.
- **TypeScript, a new datastore, or a service.** Excluded: no toolchain change, no runtime.

## 3. WHAT: vocabulary, types, and interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| scenario record | One `ScenarioRecord` per scenario: the common, inspectable shape banked in `matrix.jsonl`, emitted by `faff scenario-matrix record`. This is the ticket's "common audit bundle", named off "audit" to keep it distinct from ADR-0123's `commissaire audit` object and the `b2` recovery bundle. |
| disposition | The single canonical per-scenario outcome, one of nine fixed values, mapped from the scenario's raw oracle basis. |
| disposition basis | The object of raw oracle verdicts (`commissaire audit verify` classification, `decideFloor` verdict, `bundleRecover` disposition, budget outcome, `any_escape`, chain status) the disposition was derived from. |
| assurance vector | The honest, per-dimension record of achieved assurance: journal class, effect class, the independence dimensions established, isolation, review mechanism. |
| claim label | A short public-facing label, validated to never exceed the assurance vector. |
| one-shot control | The paired ungoverned run on a catch scenario: same seed, no Commissaire, records that the bad artifact shipped. `null` on non-catch rows. |
| catch scenario | Scenarios 2, 3, 5, 6: governance blocks, refuses, denies, or detects a seeded fault, so an ungoverned control makes the catch legible. |
| two-custodian split | Governor dir holds signing key + master secret; producer dir holds only the derived producer key + public key. Asserted every row. |

**Type definitions.** Pseudocode; the build agent translates to CommonJS.

```
ENUM Disposition:
  accepted    # scenario 1: grant, chain verified, audit verify clean, no escape
  blocked     # scenario 2: decideFloor refuse at the merge chokepoint (E-B prevention)
  refused     # scenario 3: forged grant fails commissaire audit verify / chokepointPermit
  recovered   # scenario 4: bundleRecover noop-already-present or reconstructed; torn tail tolerated
  denied      # scenario 5: request deny reason=stale-evidence, no grant written
  detected    # scenario 6: computeEscapes.any_escape=true naming the uncovered effect
  parked      # scenario 7: budget outcome park-until-window-reset with resume_at
  amended     # scenario 8: new-revision records verify, stale-key record fails the auth leg
  corrected   # scenario 9: idempotency match/conflict, gap-free resumed seq, no duplicate work-item

ENUM JournalClass:  J-A | J-B | J-C | J-D          # prose classes, master v5 306-317
ENUM EffectClass:   E-A | E-B | E-C | E-D          # prose classes, master v5 486-495
ENUM IsolationKind: fixture | clean-outward-repo
ENUM ReviewKind:    mechanical | human

RECORD IndependenceVector:
  key_custody_split: Bool          # governor SK+master separate from producer K+PK
  author_binding: Bool             # producer HMAC vs Commissaire Ed25519 distinguishable
  process_independence: Bool       # a different process drove the producer
  organisational_independence: Bool  # ALWAYS false in Phase 0 by construction (one maintainer)

RECORD AssuranceVector:
  journal_class: JournalClass      # strongest journal class the row's records actually meet
  effect_class: EffectClass        # E-B only at the merge chokepoint (scenario 2); else E-C or weaker
  independence: IndependenceVector
  isolation: IsolationKind
  review: ReviewKind
  CONSTRAINT effect_class == E-B ONLY IF disposition == blocked  # honest-claim guard

RECORD DispositionBasis:            # every field OPTIONAL; present only where the scenario reads that oracle
  audit_verify: { exit, producer:{verified,unverifiable_without_secret,failed}, decisions_valid } | null
                                    # the `commissaire audit verify --json` projection (FAFF-977) — the auth oracle
  commissaire_verdict: { verdict, reason } | null      # evaluateDecisionRequest / chokepointPermit
  floor_verdict: { verdict, blockers } | null          # decideFloor
  recovery_disposition: String | null                  # bundleRecover: reconstructed|noop-already-present|refused
  idempotency_decision: String | null                  # absent|match|conflict
  budget_outcome: String | null                        # stop|narrow|escalate|park-until-window-reset
  any_escape: Bool | null                              # computeEscapes
  chain_status: String | null                          # verifyLedgerChain status

RECORD OneShotControl:
  ungoverned_shipped: Bool         # true: the ungoverned worker shipped the bad artifact
  artifact_ref: String             # what shipped (path or descriptor in the fixture)
  governed_disposition: Disposition  # what the governed run did instead

RECORD ScenarioRecord:             # THE common shape, one per scenario, banked to matrix.jsonl
  schema: 1                        # record-shape version, frozen for banked readers
  scenario_id: String             # stable id, e.g. "01-normal-completion"
  scenario_ordinal: Int           # 1..9
  inputs: Object                  # the seed / fixture inputs that drove the run
  environment: Object             # { faff_bin, node_version, os, release_ref }
  run_id: String                  # the run identity (RUN-COM-* or the reconstructed run_id)
  work_item_id: String            # the issue / work-item identity (e.g. FAFF-1)
  disposition: Disposition
  disposition_basis: DispositionBasis
  evidence_paths: List<String>    # ledger, verdict, anchor, bundle locations under the run dir
  human_interventions: Int        # count; 0 for every fully-automated row
  cost: Object                    # { elapsed_ms, tokens, cost } — 0/absent for synthetic rows
  assurance_vector: AssuranceVector
  claim_label: String
  one_shot_control: OneShotControl | null   # non-null ONLY on scenarios 2,3,5,6
  two_custodian_split_verified: Bool        # asserted true every row
```

**The nine rows: fixture, input shape, oracle, disposition, control.** Every DONE criterion is born verifiable against this table.

| # | scenario_id | Input shape | Born-verifiable oracle | disposition | one_shot_control |
|---|---|---|---|---|---|
| 1 | `01-normal-completion` | admit→declare→authorize→observe→reconcile, covered merge effect | every record `schema:3`; `verifyEffectsChain`=verified; `evaluateDecisionRequest`.verdict=grant; **`commissaire audit verify` (with governor+producer dirs) exit 0, every producer claim `verified`, decisions valid**; `computeEscapes.any_escape`=false | accepted | null |
| 2 | `02-governance-block` | `decideFloor` FloorInputs with `decision_grant:"absent-or-invalid"` at the merge chokepoint | `decideFloor.verdict`=refuse; blockers contains the FAFF-828 "Commissaire protected-effect decision absent or invalid" string (`contract-defs.js:2128`); `chokepointPermit.permit`=false | blocked | ungoverned run merges the artifact; governed run refuses at the floor |
| 3 | `03-independence-failure` | producer HMACs a fake `author:"commissaire"` verdict | **secret-free `commissaire audit verify` (pk.json only) exit 1**, forged decision `commissaire-sig-invalid`, producer claims reported `unverifiable_without_secret` (never folded into a pass); `chokepointPermit.reason`=`decision-signature-invalid` | refused | ungoverned run self-certifies and ships; governed run refuses the forged grant |
| 4 | `04-executor-loss` | torn final ledger line after a published safe boundary; then recover on a fresh root | `verifyLedgerChain.torn_tail`=true yet status verified; the revoked producer's records classified **`failed` by `commissaire audit verify` (exit 1, fail-closed)**; `bundleRecover.disposition`=`noop-already-present` or `reconstructed`; on divergence `idempotencyDecision`=`conflict`→`refused` | recovered | null |
| 5 | `05-stale-evidence` | `effect authorize` request resting on `evidence_seq` older than the latest observe for (issue, step) | appended verdict `verdict`=deny `reason`=`stale-evidence`; no grant record written | denied | ungoverned run acts on stale evidence; governed run denies |
| 6 | `06-effect-mismatch` | observe an effect covered by no declaration | `computeEscapes.any_escape`=true with an `escaped-side-effect` signal naming the uncovered effect (`effects.js:101`) | detected | ungoverned run takes the undeclared effect; governed run detects the escape |
| 7 | `07-exhausted-budget` | budget ceiling with a `window` breach | budget `outcome` ∈ `AT_CEILING_OUTCOMES`, specifically `park-until-window-reset`; `resume_at` populated (only on park); an andon `budget-breach` class recorded | parked | null |
| 8 | `08-contract-amendment` | re-admit P1 under a new `--contract-revision` (re-derives K_producer via `deriveKey`) | **`commissaire audit verify` (with secrets) reports new-revision records `verified` and the stale-key record `failed` (`producer-auth-mismatch`)**; new-revision records verify under the re-derived key | amended | null |
| 9 | `09-correction-resume` | correct and safe-resume after a partial run | `idempotencyDecision`=`match` (idempotent) or `conflict` (founded refuse); resumed ledger seq gap-free; no duplicated work-item id | corrected | null |

**Design decision: emitter placement and CLI surface.** Two independent questions — where the lib lives (region), and what CLI name exposes it (namespace).

Options for the surface: (a) extend the `b2` recovery bundle; (b) a `commissaire audit` action (or other facade verb); (c) its own top-level `faff scenario-matrix` namespace over a pure lib emitter; (d) harness-only.

| Option | Pros | Cons |
|---|---|---|
| (a) extend b2 | one bundle type | overloads a durability artifact with assurance fields; disjoint keying (boundary vs scenario) |
| (b) `commissaire audit` action | sits inside the facade | ADR-0123's `audit` object is the per-run governance evidence record (seal/export/verify); a cross-oracle nine-scenario matrix with assurance vectors is not that object, nor any of the four facade objects (`contract`/`effect`/`verdict`/`audit`) |
| (c) own `scenario-matrix` namespace + pure lib + validator | names what it is; correctly outside the facade; region-correct; replayable via the CLI; deterministic selftest like FAFF-732 | one new lib file, one new top-level verb group, one contract selftest |
| (d) harness-only | smallest diff | not replayable from a pinned release by a clean operator (fails the acceptance boundary) |

**Chosen:** (c) — a pure governance-region emitter `buildScenarioRecord(scenarioResult)` in a new `plugin/skills/faff/bin/lib/scenario-matrix.js`, exposed by its own top-level group **`faff scenario-matrix record`** (stdin scenario-result JSON → stdout `ScenarioRecord` JSON) and **`faff scenario-matrix render`** (regenerate `REPORT.md` deterministically from `matrix.jsonl`), plus a validator **`faff contract scenario-record --selftest`** mirroring `faff contract recovery-disposition`. Rationale: **region (governance) and CLI namespace (`scenario-matrix`) are independent axes** — the lib's require-graph is governance-region so `regions.js` holds, while the command name reflects what it is. Per ADR-0123 the Commissaire facade objects are exactly `contract`/`effect`/`verdict`/`audit`; the `audit` object is the per-run governance evidence record (seal/export/verify), and a cross-oracle nine-scenario evidence matrix is none of those governance moments — so it lives outside the facade, not as a fifth object. (ADR-0123 also accepts that a top-level `faff` name may overlap a `commissaire` object, the namespace disambiguating — so `scenario-matrix` is clear of `audit` regardless.) This is the shipped pure-core-plus-thin-verb-plus-selftest pattern, and a clean operator can replay from a pinned release through the CLI, which option (d) cannot.

**Design decision: the auth-leg oracle is `commissaire audit verify`, not in-process `verifyAuthLeg`.** Options: call `verifyAuthLeg`/`verifyDecision` in-process from the harness; or drive the public `commissaire audit verify --json` seam (FAFF-977). **Chosen:** the public seam. Its JSON is a cross-boundary public contract that FAFF-360's checked-in portable verifier reproduces, so consuming it as the oracle is exactly what FAFF-822's "a clean operator replays from a pinned release" acceptance requires; and it exercises the same secret-free path an external consumer uses (pk.json only → Commissaire decisions verified, producer claims `unverifiable_without_secret`), with the secret-bearing mode (`--governor-dir`/`--producer-dir`) used where a row asserts a producer HMAC `verified` (scenarios 1, 8). In-process core calls would bypass the public contract the acceptance is about.

**Design decision: canonical disposition versus raw oracle vocabularies.** **Chosen:** one `disposition` enum plus a retained `disposition_basis` object. A single comparable column is what a reader scans across nine rows; the basis keeps the disposition anchored to its oracle.

**Design decision: scenario 8 amendment mechanism.** **Chosen:** re-admit under a new `--contract-revision`, which re-derives `K_producer = HKDF(master_secret, producer_id, contract_revision)` (`producer-auth.js:64`). Oracle: `commissaire audit verify` reports old-key records `failed` under the new revision and new-revision records `verified`; a stale-key record fails as `producer-auth-mismatch`. A dedicated verb would add surface without adding mechanism.

**Design decision: scenario 4 assertion surface.** **Chosen:** both chain/auth AND `bundleRecover`, with a bundle published via `commissaire audit seal` (alias `seal-bundle`, `commissaire.js`) as the precondition. The acceptance boundary ties the killed-executor row to the verified Phase 0A recovery path (`bundleRecover`), and the torn-tail plus revoked-producer guarantees are separate properties the row must keep.

## 4. HOW: behaviour

**Architecture and approach.** Three pieces. First, the pure emitter `buildScenarioRecord` in `scenario-matrix.js` (region governance): input a `ScenarioResult`, output a `ScenarioRecord`, honest-claim guard inline. Second, the CLI group `faff scenario-matrix record` / `faff scenario-matrix render` and the `faff contract scenario-record --selftest` validator. Third, the harness `test/phase-0-matrix.test.mjs`: runs the nine scenarios mkdtemp-mint-then-mutate over the real bin (`mkRun`, `records`, `runCom`, `runCli`), reads each oracle — the auth rows via `commissaire audit verify --json` — calls `buildScenarioRecord`, asserts the born-verifiable oracle, and writes the banked `matrix.jsonl` plus a deterministic `REPORT.md` under `verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/`.

**Behaviour summary: the emitter builds and self-checks a record.**

```
FUNCTION buildScenarioRecord(scenarioResult):   # PURE
  1. Validate scenarioResult has: scenario_id, scenario_ordinal in 1..9, run_id,
     work_item_id, disposition in Disposition, disposition_basis.
  2. Compute assurance_vector from disposition_basis:
     a. journal_class: J-C when the audit_verify basis shows a producer HMAC leg `verified`;
        J-D for a self-declared record; never above J-C for producer authentication.
     b. effect_class: E-B ONLY when disposition == blocked; E-C when disposition in
        {detected, denied, refused}; E-D or E-C otherwise.
     c. independence.organisational_independence: ALWAYS false.
     d. isolation: fixture unless the row used a clean outward repo.
     e. review: mechanical.
  3. Derive claim_label from the vector, never above it. ASSERT the honest-claim guard:
     IF claim_label implies E-B AND disposition != blocked: THROW.
     IF claim_label implies non-repudiation on a producer HMAC leg: THROW.
  4. Require two_custodian_split_verified == true; THROW otherwise.
  5. Require one_shot_control non-null IFF scenario_ordinal in {2,3,5,6}; THROW otherwise.
  6. Return the frozen ScenarioRecord (schema:1).
```

**Behaviour summary: the harness runs the nine and banks the matrix.**

```
PROCEDURE runPhase0Matrix():
  1. FOR each of the nine scenarios:
     a. mkRun(prefix) mints a fresh mkdtemp run dir + governor/producer dirs.
     b. Drive the scenario over the real faff bin (runCom / runCli), mutating the minted state.
     c. Read the born-verifiable oracle: auth rows (1,3,4,8) via `commissaire audit verify --json`
        (secret-free pk.json, or +governor/producer dirs where a producer HMAC must read `verified`);
        others via decideFloor / computeEscapes / verifyLedgerChain / bundleRecover / budget.
     d. ASSERT the oracle matches the expected row.
     e. ASSERT the two-custodian split: no single file holds both SK/master and any producer key.
     f. For scenarios 2,3,5,6: run oneShotControl(sameSeed) ungoverned; record it shipped.
     g. record = buildScenarioRecord(scenarioResult); append to matrix.jsonl.
  2. `faff scenario-matrix render` REPORT.md deterministically from matrix.jsonl (by scenario_ordinal).
  3. ASSERT the committed REPORT.md equals the renderer output byte-for-byte (the FAFF-732 pattern).
```

**Behaviour summary: the ungoverned one-shot control.** For a catch scenario, the same seed runs with no Commissaire admission or decision, so the bad artifact is taken/shipped; the governed run's disposition is recorded alongside.

```
FUNCTION oneShotControl(scenarioSeed, governedDisposition):   # harness helper, not a shipped verb
  1. Run the same effect/seed with NO admit, NO authorize, NO chokepoint.
  2. Observe the ungoverned worker takes the effect / writes the artifact.
  3. Return OneShotControl{ ungoverned_shipped: true, artifact_ref, governed_disposition }.
```

**Edge cases and error handling.**

- **Label exceeds vector:** the emitter throws at build time (fail loud); never a silently downgraded record.
- **`unverifiable_without_secret` producer claims:** recorded verbatim in `audit_verify.producer`; never folded into a generic pass (FAFF-977's honest classification), and journal_class is not raised to J-C on an unverifiable claim.
- **Scenario 4 conflict:** divergent bytes → `idempotencyDecision`=`conflict`, `bundleRecover`=`refused`; the row records `disposition: recovered` with `recovery_disposition: "refused"` and `idempotency_decision: "conflict"`. A founded refusal is a valid recovered-row outcome.
- **Missing identities:** a scenario result lacking `run_id` or `work_item_id` is non-emittable; the emitter throws.
- **REPORT.md drift:** if the committed report ≠ the renderer output, the test fails; regenerate via `faff scenario-matrix render`, never hand-edit.

**Failure modes.**

- **The failure:** the one-shot control is not truly ungoverned (inherits an admission/grant), so the catch looks stronger than it is. **Know:** `artifact_ref` absent or the ungoverned run refuses; `ungoverned_shipped` fails. **Means:** narrow — mint a fresh ungoverned seed, or record `one_shot_control: null` with a reason rather than a false catch.
- **The failure:** the assurance vector is computed from a proxy (inferring E-B from "a grant existed") not from the chokepoint refusing. **Know:** a record with `effect_class: E-B` but `disposition != blocked` reaches the bank. **Means:** derive the vector from `disposition_basis` after the oracle ran; the guard is a hard constraint.
- **The failure:** the banked matrix is not reproducible from a pinned release (repo-internal absolute paths / non-frozen state). **Know:** a clean checkout at the pinned tag produces a differing `matrix.jsonl`, or `--selftest` fails on a clean machine. **Means:** route every path through `repoRoot`/`faffBin` and mkdtemp; the renderer is a pure function of `matrix.jsonl`.
- **The failure:** synthetic fixtures alone are banked and the real second-producer row never arrives. **Know:** `matrix.jsonl` has only synthetic `scenario_id`s after the eval bridge lands. **Means:** proceed (delivery boundary is fixtures first); record the null real-producer row honestly; the real row is banked out of band and does not gate this DONE.

**Anti-patterns.**

- **Anti-pattern:** in-process `verifyAuthLeg`/`verifyDecision` calls as the auth oracle. Why: it bypasses the public `commissaire audit verify` contract FAFF-822's replay acceptance is about. Drive the seam.
- **Anti-pattern:** exposing the emitter under `commissaire`. Why: ADR-0123's facade objects are `contract`/`effect`/`verdict`/`audit`; this cross-oracle matrix is none of them. Use `faff scenario-matrix`.
- **Anti-pattern:** naming the record with "audit". Why: ADR-0123 reserves `audit` for the Commissaire governance evidence object; the record is `ScenarioRecord`.
- **Anti-pattern:** dropping a negative or null row from `REPORT.md`. Why: the acceptance requires negatives and nulls banked.
- **Anti-pattern:** claiming E-B on any row other than scenario 2, or inferring organisational independence from one maintainer. Why: only the merge chokepoint refusal is prevention; scenario 3 proves key-custody mechanism only.

## 5. Scenarios

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

Born-verifiable objectives, holdout BDD language. The nine reference scenarios are the WHAT; the objectives below verify the banking behaviour this slice adds.

```
Given the nine scenarios drive their fixtures over the real faff bin
When the harness runs and calls buildScenarioRecord for each
Then matrix.jsonl contains exactly nine ScenarioRecord records, ordinals 1..9, each with
     scenario_id, inputs, environment, run_id, work_item_id, disposition, disposition_basis,
     evidence_paths, human_interventions, cost, assurance_vector, claim_label, one_shot_control
```

```
Given a scenario result whose claim_label implies E-B prevention
When its disposition is not "blocked"
Then buildScenarioRecord throws the honest-claim guard and no record is banked
```

```
Given scenario 2 (governance block) at the merge chokepoint
When decideFloor runs with decision_grant "absent-or-invalid"
Then the record disposition is "blocked", assurance_vector.effect_class is E-B, and the
     one_shot_control records the ungoverned run merged while the governed run refused
```

```
Given every one of the nine banked records
When each is inspected
Then two_custodian_split_verified is true and one_shot_control is non-null exactly for
     ordinals 2, 3, 5, 6 and null otherwise
```

- The banked `REPORT.md` MUST equal the deterministic `faff scenario-matrix render` output over `matrix.jsonl`, byte for byte.
- A clean checkout at the pinned release tag MUST reproduce the banked `matrix.jsonl` and pass `faff contract scenario-record --selftest`.

## 6. Design decision rationale

**Where does the emitter live and what CLI surface exposes it?** **Chosen:** a pure `buildScenarioRecord` in `scenario-matrix.js` (region governance), exposed by its own top-level `faff scenario-matrix record` / `render` group and a `faff contract scenario-record --selftest` validator. Region and CLI namespace are independent axes; per ADR-0123 the Commissaire facade objects are fixed as `contract`/`effect`/`verdict`/`audit`, and a cross-oracle nine-scenario evidence matrix is none of those governance moments — so it lives outside the facade, and its record is named off "audit" (which ADR-0123 reserves for the Commissaire governance evidence object).

**Auth-leg oracle: public seam vs in-process.** **Chosen:** `commissaire audit verify --json` (FAFF-977), the one public projection of `verifyAuthLeg`, whose JSON is the cross-boundary contract FAFF-360's portable verifier reproduces — the only oracle consistent with FAFF-822's "clean operator replays from a pinned release" acceptance. The harness never forks the verifier or calls the core in-process for these rows.

**One canonical disposition, or raw vocabularies?** **Chosen:** one `disposition` enum plus a retained `disposition_basis`.

**Scenario 8 amendment: new verb or re-admit under a new revision?** **Chosen:** re-admit under a new `--contract-revision` (re-derives `K_producer` via `deriveKey`). Oracle via `commissaire audit verify`: old-key `failed` / new-key `verified` / stale-key `producer-auth-mismatch`.

**Scenario 4: chain/auth, bundleRecover, or both?** **Chosen:** both, with a bundle published via `commissaire audit seal` as precondition.

**Where are results banked?** **Chosen:** the CI harness `test/phase-0-matrix.test.mjs` holds the protocol and oracles; the banked results live under `verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/` as `matrix.jsonl` + a deterministic `REPORT.md` + a `protocol.md`, mirroring the FAFF-732 banked-evidence pattern. Fixtures produce the nine synthetic rows now; the real eval-baseline row appends to the same `matrix.jsonl` shape later.

**The real second producer.** **Chosen:** per the operator's ratification and master v5 (620), the eval-baseline workflow; synthetic fixtures cover negatives and replay. The real row is banked out of band and does not gate this DONE.

## 7. Open questions and assumptions

**Open questions.** None blocking.

**Assumptions.**

- **Assumes:** the eval-baseline harness output carries, or can be joined to, the run and work-item identities the record needs. Validation: `eval/envelope.mjs` keys on `case_id` (40), not `run_id`/`work_item_id`; confirm the eval `run-id` (dir segment) + `case_id` can populate `run_id`/`work_item_id` before wiring the real eval-bridge row, else the adapter adds an identity join (net-new glue, out of this DONE). (decides: architecture)
- **Assumes:** `commissaire audit seal` (alias `seal-bundle`) publishes a bundle that `bundleRecover` (`bundle-recover.js:404`) can discover and verify on a fresh root. Validation: reuse the `test/bundle-recover.test.mjs` killed-executor local-store round trip as scenario 4's recovery driver.
- **Assumes:** `commissaire audit verify --json` (FAFF-977, merged at `3fd514da`) is stable — exit 0/1/2 and the `{producer:{verified,unverifiable_without_secret,failed}}` shape — as the auth oracle. Validation: it is merged and is FAFF-360's conformance oracle; pin its JSON shape in the harness and treat a shape change as a breaking-contract signal.
- **Assumes:** `verifyLedgerChain` reports `torn_tail: true` with a verified status for a single torn final line, as `test/commissaire.test.mjs` (killed-producer) exercises.

## 8. DONE: definition of done

### From WHY
- [ ] The nine scenarios are collected into one banked matrix with per-scenario achieved assurance; a reader can scan all nine dispositions side by side in `REPORT.md`.
- [ ] No banked record's `claim_label` exceeds its `assurance_vector` on any dimension.
- [ ] Every banked record has `two_custodian_split_verified: true`.

### From WHAT (types and interfaces)
- [ ] `ScenarioRecord` records in `matrix.jsonl` match the schema (schema:1, all required fields) for all nine rows; none uses "audit" in its type/field names.
- [ ] `disposition` is one of the nine enum values and matches the row's oracle.
- [ ] `disposition_basis` retains the raw oracle verdict(s), including the `audit_verify` projection for the auth rows.
- [ ] `assurance_vector.effect_class` is E-B only on scenario 2; every other row is E-C or weaker.
- [ ] `assurance_vector.journal_class` is at most J-C for any producer-HMAC leg; an `unverifiable_without_secret` claim never raises it.
- [ ] `assurance_vector.independence.organisational_independence` is false on all nine rows.
- [ ] `one_shot_control` is non-null exactly on ordinals 2, 3, 5, 6.

### From WHAT (the nine oracles)
- [ ] Scenario 1: schema:3, `verifyEffectsChain`=verified, verdict=grant, `commissaire audit verify` clean (producers `verified`), `computeEscapes.any_escape`=false; disposition `accepted`.
- [ ] Scenario 2: `decideFloor.verdict`=refuse with the FAFF-828 blocker string, `chokepointPermit.permit`=false; disposition `blocked`; control shows the ungoverned run merged.
- [ ] Scenario 3: secret-free `commissaire audit verify` exit 1 with `commissaire-sig-invalid` and `unverifiable_without_secret` producer claims, `chokepointPermit.reason`=`decision-signature-invalid`; disposition `refused`.
- [ ] Scenario 4: `verifyLedgerChain.torn_tail`=true with verified status, revoked producer `failed` via `commissaire audit verify`, `bundleRecover.disposition`∈`{noop-already-present,reconstructed}` (or `refused` on conflict); disposition `recovered`; bundle published via `commissaire audit seal`.
- [ ] Scenario 5: verdict=deny reason=`stale-evidence`, no grant written; disposition `denied`.
- [ ] Scenario 6: `computeEscapes.any_escape`=true naming the uncovered effect; disposition `detected`.
- [ ] Scenario 7: budget `outcome`=`park-until-window-reset` with `resume_at` + andon `budget-breach`; disposition `parked`.
- [ ] Scenario 8: `commissaire audit verify` reports new-revision `verified` and stale-key `failed` (`producer-auth-mismatch`); disposition `amended`.
- [ ] Scenario 9: `idempotencyDecision`∈`{match,conflict}`, resumed ledger seq gap-free, no duplicated work-item id; disposition `corrected`.

### From HOW (behaviour)
- [ ] `buildScenarioRecord` is a pure function in `scenario-matrix.js` (region governance) requiring no factory file (`regions.js` passes).
- [ ] `buildScenarioRecord` throws when a label exceeds the vector, when the two-custodian split is not verified, when the one-shot-control rule is violated, or when `run_id`/`work_item_id` is missing.
- [ ] `faff scenario-matrix record` reads a scenario-result JSON on stdin and writes a canonical `ScenarioRecord` JSON to stdout; it is its own top-level verb group, **not** under `commissaire`.
- [ ] `faff scenario-matrix render` regenerates `REPORT.md` deterministically from `matrix.jsonl`.
- [ ] `faff contract scenario-record --selftest` validates the record shape deterministically and exits 0 on its fixture table.
- [ ] The harness `test/phase-0-matrix.test.mjs` runs all nine over the real bin, reads the auth rows via `commissaire audit verify --json`, and asserts every oracle plus the two-custodian split per row.

### From HOW (banking and reproducibility)
- [ ] `matrix.jsonl` is banked under `verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/` with nine records.
- [ ] `REPORT.md` equals the deterministic `faff scenario-matrix render` output over `matrix.jsonl` byte for byte.
- [ ] `protocol.md` documents how a clean operator discovers and replays the protocol from a pinned release.
- [ ] Negative and null rows remain in the banked report.

### From HOW (edge cases)
- [ ] A scenario-4 reconstruction conflict banks `disposition: recovered` with `recovery_disposition: refused` and `idempotency_decision: conflict`, not a harness failure.
- [ ] The one-shot control is genuinely ungoverned and records `ungoverned_shipped: true` with an `artifact_ref`.
- [ ] An `unverifiable_without_secret` producer classification is recorded verbatim and never folded into a pass.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Run `node --test test/phase-0-matrix.test.mjs`.
  2. Assert it exits 0 and matrix.jsonl has nine ScenarioRecord records with ordinals 1..9.
  3. Run `faff contract scenario-record --selftest`; assert exit 0.
  4. Assert REPORT.md equals `faff scenario-matrix render` output over matrix.jsonl.
  # If these connect, the emitter, the harness, the banked matrix, and the deterministic report wire together.
```

confidence: high
build-tier: complex

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" },
    { "marker": "assumes" }
  ] }
```