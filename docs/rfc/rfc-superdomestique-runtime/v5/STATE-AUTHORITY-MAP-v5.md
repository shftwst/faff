# SuperDomestique runtime v5: state authority map

Built against commit `475c0362`, 2026-10-05.
Status: Phase 1 deliverable. Built for FAFF-825 at `174f62b7`; revised in place for FAFF-1162 at `475c0362` so FAFF-827 (Phase 1 acceptance) can sit one current map. The `174f62b7` revision was the sole input to the cutover-slice selection ticket, FAFF-944; "Changes since 174f62b7" below says how to read it.
Source basis: `TECHNICAL-DESIGN-v5.md` records its own inspection at `7d89640ce7b8`, an earlier commit; [`ADDENDUM-1-v5.md`](ADDENDUM-1-v5.md) records a later one at `5aa3b4f3` and is an additional, fresher source for the treatments it ratifies; this map is a fresh inspection at `475c0362`. Where they disagree, this map is the freshest observation, while the [master direction](FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) still controls strategy; the same precedence rule the master direction's own "Source basis" section states.

## Authority and purpose

This document is the fine-grained successor to [`TECHNICAL-DESIGN-v5.md`](TECHNICAL-DESIGN-v5.md)'s "Current records and artifacts" and "Current-to-target responsibility map" tables. Those two tables cover roughly nine headline artifacts; this map covers all 134 CLI commands in `REGION_MAP` at `475c0362` and every durable artifact and state-changing step among them, at the grain `TECHNICAL-DESIGN-v5.md`'s own "Phase 1" section demands: "The map names current writers, current consumers, integrity, future owner, translation, cutover, and rollback."

It does not choose a cutover slice. That was FAFF-944's job, made against the `174f62b7` revision. It does not build anything: no module under `plugin/skills/faff/bin/lib/` was added, edited, or deleted to produce either revision. The `174f62b7` revision touched no file under `test/`. The `475c0362` revision touched `test/` in exactly two places, both verification: `test/shadow-fidelity.test.mjs` (the FAFF-826 reproduce case now reads a committed fixture root, and a new case parses this live map), and the new fixture `test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`, a byte copy of the `174f62b7` revision. "Gaps and named findings" says why.

## Vocabulary

| Term | Definition |
|---|---|
| Row key | The stable identifier of a mapped thing: either a repository-relative artifact path, or a step named as `faff <command>` |
| State-changing step | A command that writes or mutates a durable file under `.faff/`, `records/`, or the anchors tree, or mutates tracker state. Everything else is read-only |
| Canonical writer | The one module and exported function entitled to produce a given durable fact |
| Semantic owner | Which of the master RFC's five Phase 1 buckets owns the meaning of the record, independent of which module holds the bytes today |
| Migration rule | Which of the RFC's four Phase 1 future classifications the record takes at cutover |
| Safe boundary | Which of the six Phase 0 safe-boundary conditions (`TECHNICAL-DESIGN-v5.md`, "Safe-boundary recovery") the row participates in |
| Rollback | Which of the eight rollback rules (`TECHNICAL-DESIGN-v5.md`, "Rollback") applies, plus the row's reversibility |
| Commissaire contract | Admitted versioned governance terms, per the master RFC. Unrelated to `faff contract <name>`, which is a slot-handoff extraction validator (see the classification table's `contract-defs.js` row) |
| TypeScript module | A `bin/lib` module authored as `.ts` with its compiled `.js` committed beside it (`commissaire`, `producer-auth` at `475c0362`). Per ADR-0132 layout (d) and the repository's `AGENTS.md` ("TypeScript source and the committed emit"), the `.js` emit is the governed artifact every test, region lint and install path reads, so this map classifies, cites and sweeps the `.js` and counts each `.ts`/`.js` pair as one module |
| Record identities | The RFC identity values in the `identity` column are kept. Per `ADDENDUM-1-v5.md` (ratified for Phase 0 to 2A), `run_segment_id` exists in bundles and `contract_revision` exists in `schema:3` records, while no stage-attempt, effect or work-item identity exists in code: the issue id stands in for the work item. A row graded `stage-attempt`, `effect` or `work-item` names the RFC identity the fact belongs to, not a field the code carries. The `schema:3` envelope names its unit field `unit_id` (`commissaire.js :: buildEnvelope`) since FAFF-1167 (`475c0362`), which renamed it from `issue`; frozen records keep `issue` and are read through `effects.js :: unitIdOf`, and a record carrying both keys is rejected. The rename changed `commissaire.js`, `commissaire.ts` and `effects.js` and added the `unitIdOf`/`matchesUnit` read to four readers, but changed no write site, no artifact path and no class cell, so no classification moved |

**Chosen grain** (so a later reader can tell a complete table from a coarse one):

- All 134 `REGION_MAP` commands get a `ClassificationRow`. `current_region` is copied verbatim from `regions.js`; it is never judged.
- Only durable artifacts and state-changing steps get the full Ownership/Migration/Assurance row triple. A tracker mutation is graded **one row per kind** (status transition, comment, label, relation), never one row for the whole projection and never one per field. The anchors tree is graded **one row per anchor kind** (events, ledger, effects, floor-evidence), never one per file. Where a single artifact (`run-ledger.json`) is mutated by many commands through one shared chokepoint function, each calling command still gets its own row; the artifact's own row names the chokepoint once.
- A command whose only durable write is a record appended as a side effect through another module's chokepoint (an in-kernel decision-capture record, a `--record` containment event, a metered engine-spend line) still gets its own row, citing the chokepoint as its canonical writer, so a reader can see every command that reaches an artifact.
- A command with several verbs is graded one row per state-changing verb when the verbs write different facts (`adr`, `prdr`, `commissaire`). A verb that writes nothing gets no row.

## The five semantic-owner buckets

Chosen per the spec: the master RFC's five Phase 1 buckets are the `semantic_owner` vocabulary (not `TECHNICAL-DESIGN-v5.md`'s five-bucket "Interface migration" list, which the master's own "Source basis" note is superseded by for a classification vocabulary; a strategy question, not an implementation detail). `TECHNICAL-DESIGN-v5.md`'s `compatibility-only` value survives as its own boolean column rather than merging into this list, because a command can be both Commissaire-owned in meaning and destined to survive only as an alias.

| Bucket | Shorthand used below |
|---|---|
| `commissaire-governance` | Governance verdicts, protected-effect ledgers, the flight recorder, terminal safety |
| `decision-kernel` | Pure eligibility, queue, termination, and next-step predicates |
| `software-delivery-policy` | PR/CI/merge/holdout/quality/product-record policy specific to the Software Delivery domain |
| `harness-and-skill-orchestration` | Dev-environment hygiene, CI/skill-surface conformance, hook/worktree/harness wiring |
| `external-adapters-and-infrastructure` | Worker/backend/model adapters, execution infrastructure, config/tracker connectors |

**Compatibility-only, as populated below:** every classification row states `no`. No command in this codebase carries a per-command compatibility marker today; `TECHNICAL-DESIGN-v5.md`'s "Interface migration" section states the *whole* `faff` governance namespace becomes a compatibility alias only once `commissaire` ships (Phase 2A), which is a namespace-wide, future-triggered fact, not a distinction any current command already carries. Marking individual commands `yes` today, absent such a marker, would be judgement dressed as a copied fact; exactly the anti-pattern the design principles warn against. This uniform `no` is itself a recorded finding, not an oversight. At `475c0362` `commissaire` has shipped (FAFF-999), but no command carries a per-command compatibility marker yet and the namespace-wide alias has not been applied, so the uniform `no` stands for the 20 commands added since `174f62b7` too.

## Classification table

One `ClassificationRow` per `REGION_MAP` entry in `plugin/skills/faff/bin/lib/regions.js`, 134 of them at `475c0362` (18 `governance` + 116 `factory`, read through the CLI: `faff regions list --json` returns 134 keys, and `faff regions selftest --region all` reports 134 members). The `174f62b7` revision had 114 (17 + 97); the 20 commands added since are listed in "Changes since 174f62b7", and none was removed or moved region. `current_region` is copied verbatim from `REGION_MAP`; `semantic_owner` and `owner_basis` come from reading the command's actual handler module (resolved from `plugin/skills/faff/bin/faff`'s own `COMMANDS` registry and `require` list, not guessed from the command name). `state_changing` and `write_evidence` come from tracing each handler's write closure; following any locally-defined helper it calls, and any shared cross-module writer it imports (for example, most run-ledger.json mutations reach the disk only through `heartbeat.js :: atomicWriteLedger`, imported by eight other modules); down to an actual `fs` write primitive or an equivalent durable mechanism outside the `fs` API (a git-ref push, a shelled installer script). Where `semantic_owner` disagrees with `current_region`, `owner_basis` says why; four rows are marked **DISAGREES** for a reader scanning quickly: `governance-profile.js` (governance region, but the delivery-profile vocabulary is Software Delivery's own dialect), `governance-check.js` (factory region, which already agrees, cited because it is the RFC's own worked counter-example), `scenario-matrix.js` (governance region, but its own banner calls it Phase-0 evidence tooling outside the Commissaire facade), and `contract-defs.js` (an explicit anti-pattern guard: it collides in name with "Commissaire contract" but has nothing to do with governance admission). A command added since `174f62b7` cites, in `owner_basis`, the existing row whose reasoning it follows; `commissaire` has no precedent row and cites its own module behaviour instead.

| command | current_region | semantic_owner | owner_basis | state_changing | write_evidence | compatibility_only |
|---|---|---|---|---|---|---|
| `admissible` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `adr` | factory | software-delivery-policy | architecture decision records are a Software Delivery product-record type (ADR 0016 family), not a generic Commissaire record | yes | adr.js :: cmdAdr / adrAccept / adrRenumber / recordSupersede (mkdirSync/writeFileSync/rmSync of the ADR file set; recordSupersede also renameSync-moves a superseded ADR into the configured superseded directory, FAFF-1042) | no |
| `adversarial-backends` | factory | external-adapters-and-infrastructure | mechanical assembly of the adversarial-review backend roster — same backend-adapter family | no | no durable write | no |
| `andon` | factory | commissaire-governance | push alerting/escalation for run-critical events — the notification arm of the flight recorder | yes | andon.js :: writeAndonState (writeFileSync/renameSync/unlinkSync of the andon state file) | no |
| `audit` | governance | commissaire-governance | read-only run-reconstruction forensics joining ledger + events + chain — the audit/export/seal concept the target Commissaire owns | no | no durable write | no |
| `backends` | factory | external-adapters-and-infrastructure | shared model/provider/auth backend resolution — execution infrastructure adapter | no | no durable write | no |
| `background-fence` | factory | harness-and-skill-orchestration | a PreToolUse fence on a self-backgrounded gate command — same harness-interception family as merge-fence | no | no durable write | no |
| `branch-protection-check` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | no | no durable write | no |
| `budget` | governance | commissaire-governance | run cost/compute budgeting is a governance floor (stop/narrow/escalate), not a domain quality gate | yes | budget.js :: appendEngineSpend (appendFileSync of the fleet engine-spend log) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (parked-window ledger field) | no |
| `build-claim` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: claimStoreCore::acquire (buildClaimStore) — a non-force `git push <sha>:<ref>` claim commit, a durable write via git ref, not an fs primitive (sweep limitation) | no |
| `build-judge-evidence` | factory | software-delivery-policy | assembles the build-review judge's blinded case files and rolls up its rulings; the build-side sibling of the `spec-judge-evidence` row's review-process policy | yes | build-judge-evidence.js :: cmdAssemble (mkdirSync/writeFileSync of case-<id>.json and ledger.json, mode 0600) and dispatchJudgeRulings (writeFileSync of ruling-<id>.json); cmdAdmit (writeFileSync of admit-result.json); all under the caller's `--out`, default `<--dir>/judge` | no |
| `build-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdBuildProgress (mkdirSync/writeFileSync/renameSync) | no |
| `build-review-churn` | factory | software-delivery-policy | detects a non-converging build-review dialogue; the build-side sibling of the `spec-review-churn` row | no | no durable write | no |
| `build-review-convergence` | factory | software-delivery-policy | lets the build-review loop cap yield to a converging reviewer; the build-side sibling of the `spec-review-convergence` row | no | no durable write | no |
| `bundle` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: cmdBundle -> publishBundle -> bundle-seal-core.js :: localBundleStore (mkdirSync/writeFileSync/renameSync of the Phase 0 recovery bundle; moved out of bundle.js by FAFF-1000, which still re-exports it) | no |
| `bundle-recover` | factory | commissaire-governance | the recover-on-a-later-executor counterpart to bundle.js (FAFF-820) — same Commissaire recovery-evidence family | yes | bundle-recover.js :: reconstructProjection / bundleRecover (mkdirSync/writeFileSync/copyFileSync/rmSync of the reconstructed run dir) | no |
| `ci-triage` | factory | software-delivery-policy | CI failure triage (flaky vs real) is Software Delivery CI logic | yes | ci-triage.js :: writeFlakyRegister / writeCiTriageVerdict (mkdirSync/writeFileSync) | no |
| `claim-verdict` | factory | decision-kernel | PURE stale-claim liveness function feeding assignment/lease decisions | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from claim-verdict.js :: cmdClaimVerdict | no |
| `cli-surface` | factory | harness-and-skill-orchestration | the declared, machine-readable CLI grammar — the harness's own interface description | no | no durable write | no |
| `commissaire` | factory | commissaire-governance | the Commissaire facade (ADR-0123's contract, effect, verdict and audit objects): producer admission, signed effect decisions, the terminal verdict and the audit seal are the governance verdicts and protected-effect ledger this bucket names | yes | commissaire.js :: cmdAdmit (writeJson: mkdirSync/writeFileSync of the governor and producer key material); appendProducerRecords / appendCommissaireRecord -> events.js :: appendRecordsUnderLock (appendFileSync of `schema:3` records into declared-effects.jsonl); cmdSealBundle -> bundle-seal-core.js :: localBundleStore (write-once renameSync of the sealed bundle); cmdAuditExport (mkdirSync/writeFileSync under `--dest`); cmdAuditAnchor -> events.js :: mintIssueAnchor | no |
| `config` | factory | external-adapters-and-infrastructure | resolves/reads .faffrc and lists model backends; the compatibility/domain facade config surface named in the responsibility map | yes | config.js :: cmdConfigInit / cmdConfigSet (writeFileSync of .faffrc.yaml, or of the gitignored .faffrc.local.yaml overlay under `--local`, FAFF-1062) | no |
| `contain` | factory | software-delivery-policy | container mandates over which paths a build may touch; Software Delivery scope policy | yes | only under `--record <run-id>`: contain.js :: cmdContain appends a `containment-check` event to that run's events.jsonl through events.js :: appendEventRecord (FAFF-354) | no |
| `container-check` | factory | software-delivery-policy | asserts the ADR-0010 blast-radius (cage) boundary for a build — Software Delivery isolation policy | no | no durable write | no |
| `contract` | factory | harness-and-skill-orchestration | ANTI-PATTERN GUARD: this is the slot-handoff extraction validator (a JSON-Schema-subset checker over producer prose output) — it has nothing to do with admitting versioned governance terms despite the name collision with "Commissaire contract"; it belongs to skill-to-skill handoff orchestration | no | no durable write | no |
| `conventions` | factory | software-delivery-policy | mines and caches a repository's branch, commit-subject and PR-title conventions so graft names its work the repository's way; repo-adoption shape, same family as the `profile` row | yes | conventions.js :: writeConventionsCacheAtomic (mkdirSync/writeFileSync/renameSync of .faff/conventions.json), reached from `mine` and from a cache-miss `get` | no |
| `corrective` | factory | commissaire-governance | Sentry-2 Channel A subtractive corrective authority — the interlock that folds a cumulative constraint set into the next dispatch, a governance control over continuation | yes | corrective.js :: cmdCorrectiveAuthor (mkdirSync/writeFileSync of the corrective input record) | no |
| `corrective-integrity` | factory | commissaire-governance | the fail-safe half plus activation half of the corrective-authority mechanism above; same governance family | no | no durable write | no |
| `decision-capture` | factory | decision-kernel | read-only instrumentation of the CURRENT orchestrator's decision points, captured specifically to feed the coordinator-transition shadow comparison the RFC assigns to the decision kernel | yes | decision-capture.js :: cmdRecordVerb / cmdActionVerb (append `decision-capture` and `decision-capture-action` events through events.js :: appendEventRecord) and cmdExportVerb (mkdirSync/writeFileSync of the decision-capture export record); bestEffortFail appends a best-effort failure note | no |
| `decisions` | factory | software-delivery-policy | the decisions register (ADR-lite) is the same Software-Delivery product-record family as adr.js | no | no durable write | no |
| `disposition` | factory | software-delivery-policy | the run-end DISPOSITION verdict is the domain (Software Delivery) view of a run's outcome, per the same responsibility-map row as quality/economics | no | no durable write | no |
| `doctor` | factory | software-delivery-policy | the engineering-quality gate ladder (`gates`/`doctor`) plus the dev-environment `sync` re-link are Software Delivery adoption tooling | no | no durable write | no |
| `dod` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `economics` | factory | software-delivery-policy | per-run unit economics, the reporting mirror of quality.js; same responsibility-map row | no | no durable write | no |
| `effects` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdEffects -> appendEffectEntries -> events.js :: appendRecordsUnderLock (appendFileSync of declared-effects.jsonl) | no |
| `effort` | factory | software-delivery-policy | per-issue build-effort routing keyed on tier — Software Delivery routing policy | no | no durable write | no |
| `eligible` | factory | decision-kernel | PURE automation-eligibility resolution; a kernel-shaped decision function, not domain judgement | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from eligible.js :: cmdEligible | no |
| `engine` | factory | external-adapters-and-infrastructure | one-shot local-engine dispatch, named directly in "Engine, backend, harness... -> Worker adapters and execution infrastructure adapters" | yes | inside a run: engine.js :: resolveSpendSink meters each call through budget.js :: appendEngineSpend (appendFileSync of the run's engine-spend log), and the shared supervisor ticks the run heartbeat through supervisor.js :: defaultHeartbeatTick -> heartbeat.js :: cmdHeartbeat | no |
| `env` | factory | external-adapters-and-infrastructure | live compose provisioning is execution infrastructure (containers/services), not delivery policy | yes | env.js :: cmdEnv / envSqlLoad (mkdirSync/writeFileSync of compose env material) | no |
| `eval` | factory | harness-and-skill-orchestration | derives the eval --kind subset a change needs — eval-harness orchestration | no | no durable write | no |
| `evaluator-preflight` | factory | software-delivery-policy | the assert-in half of the independent-evaluation isolation seam — Software Delivery evaluator lane policy | no | no durable write | no |
| `events` | governance | commissaire-governance | the append-only structured run-event log with hash-linked sequence, the journal substrate the future record system's stream-revision model replaces in kind | yes | events.js :: appendRecordsUnderLock (appendFileSync of events.jsonl) and mintIssueAnchor (mkdirSync/writeFileSync/copyFileSync of the anchor set) | no |
| `findings-reconcile` | factory | software-delivery-policy | resolved-elsewhere correlation for finding-tickets is Software Delivery backlog hygiene | no | no durable write | no |
| `fixtures` | factory | harness-and-skill-orchestration | the dataset-manifest schema and CLI generate eval-harness fixtures, not a production governance or delivery record | yes | fixtures.js :: cmdFixtures (mkdirSync/writeFileSync of the dataset-manifest fixture files) | no |
| `gates` | factory | software-delivery-policy | the engineering-quality gate ladder (`gates`/`doctor`) plus the dev-environment `sync` re-link are Software Delivery adoption tooling | no | no durable write | no |
| `github-auth-check` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | no | no durable write | no |
| `gitignore-ensure` | factory | harness-and-skill-orchestration | idempotently adds faff's local paths to .gitignore; repo/dev-environment hygiene | yes | gitignore-ensure.js :: gitignoreEnsure (writeFileSync of .gitignore, or of .git/info/exclude under `--local`, FAFF-1062) | no |
| `governance-check` | factory | software-delivery-policy | DISAGREES with current_region (factory, which already agrees with this call): despite the governance-sounding name it imports Software Delivery gate functions and writes the CI floor artifacts those gates need — the RFC's own worked counter-example | yes | governance-check.js :: cmdGovernanceCheck (appendFileSync) plus writeLedger / writeFloorArtifacts (writeFileSync of the CI floor artifacts) | no |
| `harness` | factory | harness-and-skill-orchestration | the harness-abstraction seam register (FAFF-483) is the literal home of this bucket's name | no | no durable write | no |
| `heartbeat` | governance | commissaire-governance | owns the single sanctioned write path for run liveness (heartbeat file) and is also where every production run-ledger.json mutation is chokepointed (atomicWriteLedger), the terminal-safety substrate Commissaire's seal depends on | yes | heartbeat.js :: atomicWriteSingleValueFile (heartbeat file, writeFileSync+renameSync) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (run-ledger.json) | no |
| `holdout` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | yes | only under `holdout verdicts --persist --prdr-dir <dir>`: admissibility.js :: cmdHoldout -> prdr.js :: setPrdrDodVerdict (writeFileSync of the PRDR record's DoD-verdict line, FAFF-953) | no |
| `hooks-ensure` | factory | harness-and-skill-orchestration | idempotently registers faff's Stop-hook command set into the harness's own hook configuration | yes | hooks-ensure.js :: cmdHooksEnsure (rmSync/mkdirSync/writeFileSync of the registered hook set; settings.local.json under `--local`, FAFF-1062) | no |
| `inflightcheck` | governance | commissaire-governance | refuses a turn-end with an Agent dispatch still in flight — a liveness interlock over the run's control state | yes | inflightcheck.js :: cmdInflightcheck (mkdirSync/writeFileSync/rmSync of the in-flight marker) | no |
| `intake-record` | factory | software-delivery-policy | the intake-provenance guard (front-door enforcement) is Software Delivery intake policy | yes | intake-provenance.js :: cmdIntakeRecord (mkdirSync/writeFileSync of the intake-provenance record) | no |
| `intakecheck` | factory | software-delivery-policy | the intake-provenance guard (front-door enforcement) is Software Delivery intake policy | no | no durable write | no |
| `integrity-boundary` | factory | commissaire-governance | the fail-safe half plus activation half of the corrective-authority mechanism above; same governance family | no | no durable write | no |
| `integrity-digest` | factory | commissaire-governance | custody-based tamper detection over evidence bytes — a journal-integrity mechanism, not a delivery-policy check | yes | integrity-digest.js :: atomicWriteVerdictBytes (mkdirSync/writeFileSync/renameSync of the custody verdict) | no |
| `judge-history` | factory | software-delivery-policy | read-only reader of the judge-trail ref; same review-process family as the `judge-trail` row | no | no durable write | no |
| `judge-trail` | factory | software-delivery-policy | persists the spec-review and build-review judgement trail verbatim to a git ref; review-process evidence, same family as the `spec-review-pin` row | yes | judge-trail.js :: mint; `git update-ref refs/faff/judge-trail/<run_id>` under the local `bundle_store`, or a non-force `git push origin <sha>:<ref>` under `git-remote`; a durable write via git ref, not an fs primitive (sweep limitation, as for `build-claim`) | no |
| `label` | factory | software-delivery-policy | DISAGREES with current_region only insofar as the mutation itself is agent-side: the module composes a Software Delivery control-label op descriptor; no bin/lib code performs the tracker write | no | no durable write | no |
| `labels` | factory | software-delivery-policy | the canonical control-label manifest is Software Delivery tracker vocabulary | no | no durable write | no |
| `landing-claim` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: claimStoreCore::acquire (landingClaimStore) — same git-ref push mechanism as build-claim (sweep limitation) | no |
| `landing-comment` | factory | software-delivery-policy | renders the ready-to-land PR comment body for the GH Action — Software Delivery PR logic | no | no durable write | no |
| `landing-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdLandingProgress (rmSync/mkdirSync/writeFileSync/renameSync) | no |
| `lane-boundary` | factory | software-delivery-policy | the emit half of the same config-declares -> emit -> assert-in chain as evaluator-preflight; Software Delivery lane policy, not the generic runtime lane schema yet | yes | lane-boundary.js :: emitLaneBoundary (mkdirSync/writeFileSync of `<run-dir>/lane-boundary.json`, `emit` only); unchanged since `174f62b7`, where it was recorded `no` in error | no |
| `lights-out` | factory | harness-and-skill-orchestration | the L4 lights-out entry point/runner mints and supervises the unattended run process; harness/dispatch orchestration over the decision-kernel functions it calls | yes | lights-out.js :: claimRunDir / mintLightsOut (mkdirSync of the minted run dir), events.js :: emitGenesisRunStart (genesis event) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (ledger mint); under `--resume`, reconsiderParkedItems -> park-reconsider.js :: apply_git_only_unpark (prep marker and own-run ledger), a `park-reconsidered` event, and writeSpecReviewResumeHold (mkdirSync/writeFileSync of .faff/resume/<issue>/spec-review-hold.json, FAFF-993) | no |
| `lint-cli-coverage` | factory | harness-and-skill-orchestration | asserts every subcommand is tested by something — same conformance-lint family | no | no durable write | no |
| `lint-cli-doc` | factory | harness-and-skill-orchestration | asserts docs/guide/cli.md documents every subcommand — CLI/skill-surface conformance lint | no | no durable write | no |
| `lint-refs` | factory | harness-and-skill-orchestration | bans external-artifact refs in prose — skill-authoring conformance lint | no | no durable write | no |
| `machine-id` | factory | external-adapters-and-infrastructure | collision-resistant per-host machine identity is host/infrastructure plumbing, not governance or delivery policy | yes | machine-id.js :: realWriteFile (mkdirSync/writeFileSync/renameSync of the machine-id cache) | no |
| `manifest` | factory | software-delivery-policy | validates the Tier-1 binding manifest the code-interface holdout reads; Software Delivery holdout input, same family as the `holdout` row | no | no durable write | no |
| `merge-fence` | factory | harness-and-skill-orchestration | a PreToolUse fence intercepting a raw `gh pr merge` tool call — harness-level interception, not a Commissaire decision itself | no | no durable write | no |
| `merge-gate` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | yes | merge-gate.js :: writeMergeRecord (mkdirSync/writeFileSync of the merge record) plus the sole sanctioned `gh pr merge` invocation on the resolved head sha; also merge-gate-override.json on an override, a `schema:2` merge declare/observe pair via autoDeclareMergeEffects / observeMergeEffects -> effects.js :: appendEffectEntries unless a `schema:3` grant covers the merge, and under `--execute` a dependency rebase that runs `git push --force-with-lease` (merge-gate.js :: boundedRebaseOntoMain, not recorded as an effect) | no |
| `models` | factory | external-adapters-and-infrastructure | resolves/reads .faffrc and lists model backends — the compatibility/domain facade config surface named in the responsibility map | no | no durable write | no |
| `native-map` | factory | external-adapters-and-infrastructure | maps faff issue types onto the tracker's native templates; a tracker-connector concern, same family as the `tracker` row | yes | native-map.js :: cmdNativeMapSet (mkdirSync/writeFileSync of the committed .faff-templates/native-templates.yaml; `set` only) | no |
| `next` | factory | decision-kernel | the legal-next-step pure transition function; the exact shape ("next.js ... Decision kernel") the technical design's responsibility map already names | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from next.js :: cmdNext | no |
| `park-history` | factory | software-delivery-policy | the deterministic repeat-park counting seam feeding faff-tidy's demote logic — Software Delivery backlog policy | no | no durable write | no |
| `park-reconsider` | factory | decision-kernel | the PURE git-only re-entry decision (park-reconsider.js :: classifyReEntry), same family as the `park-verdict` row; the module's one write helper, apply_git_only_unpark, is reached only from lights-out.js's resume pass, never from this command | no | no durable write; the CLI verb runs only its selftest (the unpark write is recorded on the `lights-out` row) | no |
| `park-verdict` | factory | decision-kernel | PURE stale-park validity function, same family as claim-verdict | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from park-verdict.js :: cmdParkVerdict | no |
| `post-merge-check` | factory | software-delivery-policy | post-merge verification is the tail of the Software Delivery merge flow | yes | post-merge.js :: writePostMergeVerification (mkdirSync/writeFileSync) | no |
| `pr-body` | factory | software-delivery-policy | PR-body citation hygiene prevents a false Linear PR-opened transition — Software Delivery/tracker-adjacent PR logic | no | no durable write | no |
| `pr-create` | factory | software-delivery-policy | the sole sanctioned `gh pr create` path with a governed grant leg; the PR-opening half of the merge-gate interlock the `merge-gate` row names | yes | merge-gate.js :: cmdPrCreate; the `gh pr create` invocation (a forge mutation, not an fs primitive); on a create no `schema:3` grant covers, a `schema:2` declare/observe pair via effects.js :: appendEffectEntries -> events.js :: appendRecordsUnderLock (appendFileSync of declared-effects.jsonl) | no |
| `prd` | factory | software-delivery-policy | product requirements documents are the Software Delivery product-record axis (FAFF-252/ADR 0016) | yes | prd.js :: cmdPrd (mkdirSync/writeFileSync of the PRD file) | no |
| `prd-checklist` | factory | software-delivery-policy | reads a checklist-style PRD — same product-record family as prd.js | no | no durable write | no |
| `prdr` | factory | software-delivery-policy | product requirements DECISION records — same product-record family as prd.js/adr.js | yes | prdr.js :: prdrAccept / prdrLand / prdrRenumber / cmdPrdr (writeFileSync/appendFileSync/renameSync/unlinkSync/rmSync of the PRDR file set) | no |
| `prepcheck` | factory | software-delivery-policy | verifies faff-prep attached its spec — Software Delivery prep-workflow policy | no | no durable write | no |
| `profile` | factory | software-delivery-policy | the infra-profile schema plus repo-mining acquirer describes a target repo's Software Delivery adoption shape | no | no durable write | no |
| `profiles` | governance | software-delivery-policy | DISAGREES with current_region (governance): its own banner calls the delivery profile "faff's dialect" — DELIVERY_PROFILE/ledger_outcomes are Software-Delivery-specific automation-posture vocabulary, not a generic Commissaire governance verdict; it sits in the governance region only because the flight recorder reads it | no | no durable write | no |
| `project-next` | factory | decision-kernel | the container (project\|parent-issue) transition function, same family as next.js | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from project-next.js :: cmdProjectNext | no |
| `punt-scan` | factory | software-delivery-policy | deterministic Punt-marker classifier over a spec; Software Delivery spec-readiness policy, same family as the `tier` row | no | no durable write | no |
| `quality` | factory | software-delivery-policy | per-run quality/outcome telemetry, named directly in "Disposition, quality, economics ... -> domain views" | no | no durable write | no |
| `queue-state` | factory | decision-kernel | pure git-only queue_empty/all_parked derivation, named directly in the technical design's responsibility map | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from queue-state.js :: cmdDerive | no |
| `ratified-scope` | factory | software-delivery-policy | assembles the ratified-scope block from the decisions/PRD registers; same product-record family, composition only | yes | only under `--fold-resolutions --into <file>`: ratified-scope.js :: cmdRatifiedScope (appendFileSync of a "Ratified resolutions" subsection into the caller-named file, FAFF-998) | no |
| `reconcile` | governance | commissaire-governance | blocking run-end ground-truth reconcile is the current analogue of the RFC's terminal-safety reconciliation step | no | no durable write | no |
| `reconcile-recover` | factory | commissaire-governance | computes the auto-close verdict for a stale run membership from ledger/heartbeat/post-merge facts (read-only; the write, where it happens, routes back through heartbeat.js's ledger chokepoint) | no | no durable write | no |
| `regions` | factory | harness-and-skill-orchestration | the region map, require-graph direction lint, and region selftest runner are CLI-module structural conformance, not runtime governance | no | no durable write | no |
| `resumecheck` | governance | commissaire-governance | releases a dead headless-resume claim under the ledger lock (mutateLedgerUnderLock) — a liveness/ownership interlock over run-ledger.json | yes | resumecheck.js's fenced release step, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock) | no |
| `review-iteration-cap` | factory | software-delivery-policy | single-owner bound on the review fail-fix-review loop — Software Delivery review-gate policy | no | no durable write | no |
| `review-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdReviewProgress (mkdirSync/writeFileSync/renameSync) | no |
| `review-target` | factory | harness-and-skill-orchestration | resolves the explicit review target for a worktree lane so an ad-hoc review never reads the ambient working directory; worktree wiring, same family as the `worktree-root` row | no | no durable write (its base resolution runs `git fetch origin <default>`, which moves a remote-tracking ref only) | no |
| `run-done` | factory | decision-kernel | the pure terminating-condition predicate, named directly in the technical design's responsibility map | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from run-done.js :: cmdRunDone | no |
| `run-ledger` | factory | decision-kernel | the standalone-interactive L2 mint/outcome-record entry point over the pure ledger-mutation contract, decision-adjacent even though the bytes land via heartbeat.js | yes | run-ledger.js :: initInteractive / initSelfDrain / recordOutcome / captureCapability, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock), plus a genesis event through events.js :: emitGenesisRunStart on a mint | no |
| `run-outward` | factory | decision-kernel | the signals.outward producer feeding the run's next-action decision surface | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from run-outward.js :: cmdRunOutward | no |
| `run-record-prd` | factory | software-delivery-policy | records a PRD licence/root-container fact onto the run — the same product-record family as prd.js/prdr.js, even though the byte-write itself routes through heartbeat.js's ledger chokepoint | yes | run-record-prd.js's PRD-record verb, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock) | no |
| `run-start` | factory | decision-kernel | the pure run-start trigger predicate, same family as run-done/next | yes | only when `capture.decision_kernel` is `on`: decision-capture.js :: captureDecision appends a `decision-capture` event to the run's events.jsonl through events.js :: appendEventRecord, and a degraded capture appends a note to .faff/logs/decision-capture.jsonl through decision-capture.js :: bestEffortFail (in-kernel capture, FAFF-956 and FAFF-1009), called from run-start.js :: cmdRunStart | no |
| `runcheck` | governance | commissaire-governance | verifies a beep-boop run actually dispatched its queue before claiming completion, the run-liveness interlock the flight recorder depends on | no | no durable write | no |
| `scenario-matrix` | governance | harness-and-skill-orchestration | DISAGREES with current_region (governance): its own banner reads "Cross-oracle Phase-0 evidence tooling, NOT one of" [ADR-0123's four Commissaire facade objects; the clause continues on the next comment line], and it sits in the governance region only so the emitter requires no factory file; verification tooling, same family as the `fixtures` row | no | no durable write | no |
| `self-intake` | factory | software-delivery-policy | the same-repo/team mechanical gate on self-filed work; Software Delivery intake policy | yes | only under `--record <run-id>`: self-intake.js :: cmdSelfIntake appends a `self-intake-check` event to that run's events.jsonl through events.js :: appendEventRecord | no |
| `sentry` | governance | commissaire-governance | live-run derailment detection and the hard kill-switch is the closest current analogue to a protected-effect prevention control | yes | sentry.js :: cmdSentry (appendFileSync of the kill-switch log) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (kill-switch ledger write) | no |
| `sentry-poller` | governance | commissaire-governance | same governance family as sentry — a detached watchdog acting on the same abort authority, per its own banner | yes | sentry-poller.js :: atomicWriteFile / appendLog (writeFileSync+renameSync / appendFileSync of poller state and log) | no |
| `sentrycheck` | governance | commissaire-governance | a Stop-hook staleness consult sibling of runcheck, reusing runcheck's liveness predicates verbatim | no | no durable write | no |
| `shadow-fidelity` | factory | decision-kernel | the coordinator-transition shadow comparison itself: it replays captured decisions through the nine pure kernels (the `decision-capture` row's precedent; its own banner reads "region:factory / decision-kernel") | yes | shadow-fidelity.js :: cmdRunVerb (mkdirSync/writeFileSync of decision-corpus.jsonl, manifest.json and result.json under an explicit `--out` directory; `run --out` only) | no |
| `spec-judge-accept-bar` | factory | software-delivery-policy | computes the spec-review judge's accept bar; same review-process family as the `spec-judge-evidence` row | no | no durable write | no |
| `spec-judge-evidence` | factory | software-delivery-policy | assembles the spec-review judge's evidence bundle; Software Delivery prep-review process policy | yes | spec-judge-evidence.js :: cmdAssemble (mkdirSync/writeFileSync of case-<id>.json and ledger.json, mode 0600), cmdAdmit (writeFileSync of admit-result.json) and cmdRestamp (ledger.json rewrite), under `--out` or `<--dir>/judge` (FAFF-930, FAFF-994, FAFF-959) | no |
| `spec-review` | factory | software-delivery-policy | extracts persisted spec-review evidence from a committed spec; same review-process family as the `spec-review-window` row | no | no durable write | no |
| `spec-review-churn` | factory | software-delivery-policy | detects a non-converging prep<->review loop — Software Delivery review-process policy | no | no durable write | no |
| `spec-review-convergence` | factory | software-delivery-policy | lets the loop cap yield to a converging reviewer — same review-process policy family | no | no durable write | no |
| `spec-review-dir` | factory | software-delivery-policy | pins the spec-review reviewer identity for the run — same review-process policy family | no | no durable write | no |
| `spec-review-iteration-cap` | factory | software-delivery-policy | the spec-review reject-loop cap — same review-process policy family | no | no durable write | no |
| `spec-review-lenses` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `spec-review-pin` | factory | software-delivery-policy | pins the spec-review reviewer identity for the run — same review-process policy family | yes | spec-review-pin.js :: capturePin (mkdirSync/writeFileSync of the pinned-reviewer record) | no |
| `spec-review-reputation` | factory | software-delivery-policy | the deterministic reviewer-reputation ledger feeding the review-process policy family above | no | no durable write | no |
| `spec-review-window` | factory | software-delivery-policy | persists the convergence window — same review-process policy family | yes | spec-review-window.js :: writeWindowStart (mkdirSync/writeFileSync of the convergence-window record) | no |
| `stage-guard` | factory | harness-and-skill-orchestration | selective staging plus a filename-class secret guard is a harness-level git-staging control | no | no durable write | no |
| `state` | factory | decision-kernel | the local read-model sibling to `faff next` — pure-adjacent eligibility projection | no | no durable write | no |
| `sync` | factory | software-delivery-policy | the engineering-quality gate ladder (`gates`/`doctor`) plus the dev-environment `sync` re-link are Software Delivery adoption tooling | yes | gates.js :: cmdSync spawns scripts/link-skills.sh, which mkdir/symlinks faff's skill dirs into the target install location — a durable write OUTSIDE .faff/ that no fs-primitive grep on this repo's .js finds (recorded as a sweep limitation) | no |
| `tier` | factory | software-delivery-policy | deterministic prep-time build-tier classifier — Software Delivery routing policy | no | no durable write | no |
| `tracker` | factory | external-adapters-and-infrastructure | classifies the tracker-availability pin (pinned/unpinned/git-only) — an external-connector resolution concern, deliberately MCP-blind by its own banner | no | no durable write | no |
| `turncheck` | governance | commissaire-governance | refuses a non-terminal turn-end on run state — the same interlock family as inflightcheck/resumecheck | no | no durable write | no |
| `validate-adapters` | factory | harness-and-skill-orchestration | structural conformance lint of the shipped slot skills | no | no durable write | no |
| `verification` | factory | software-delivery-policy | resolves which verification legs (holdout, spec review, code review) an attended build opts into; Software Delivery evaluation policy, same family as the `evaluator-preflight` row | no | no durable write | no |
| `worktree-check` | factory | harness-and-skill-orchestration | classifies a reused worktree's base staleness; worktree hygiene, same family as the `worktree-prune` row | no | no durable write (its base resolution runs `git fetch origin <default>`, which moves a remote-tracking ref only) | no |
| `worktree-heal` | factory | harness-and-skill-orchestration | repairs a clobbered worktree's git admin metadata in place; worktree hygiene, same family as the `worktree-prune` row | yes | worktree-heal.js :: healClobberedWorktree (mkdirSync/writeFileSync of .git/worktrees/<id>/gitdir, HEAD and commondir) plus a shelled `git worktree repair`; a durable write outside .faff/, graded by the `gitignore-ensure` and `sync` precedent | no |
| `worktree-prune` | factory | harness-and-skill-orchestration | mechanical replacement of the prose worktree-hygiene guard; harness/dev-environment orchestration, not delivery policy | yes | worktree-prune.js :: cmdWorktreePrune (rmSync; destructive: removes stale worktrees); on a governed run with `--run-dir` and `--issue`, a `schema:2` declare/observe pair around the removal via effects.js :: appendEffectEntries (FAFF-1119) | no |
| `worktree-root` | factory | harness-and-skill-orchestration | the L4 lights-out entry point/runner mints and supervises the unattended run process — harness/dispatch orchestration over the decision-kernel functions it calls | no | no durable write | no |

## The write-site sweep

Step 3 of the build procedure requires the durable-artifact set assembled twice, from two independent directions, then diffed both ways. A set derived only from the rows' own `write_evidence` can only ever agree with itself. This section records the sweep re-run at `475c0362`; the `174f62b7` sweep is readable in that revision (see "Changes since 174f62b7").

**Swept scope, stated explicitly:** the whole repository, excluding only `test/` and `node_modules/`, over `.js` and `.mjs` files. The sweep was NOT restricted to `plugin/skills/faff/bin/lib/`; scoping it there would make it a second view of the same territory the derived set already covers, rather than an independent one. The master RFC's own example is the reason: `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` writes `.faff/holdout/<key>.json`, and it lives outside `bin/lib` entirely. **`.ts` files are excluded:** per ADR-0132 layout (d) and the repository's `AGENTS.md` ("TypeScript source and the committed emit"), the committed `.js` emit beside each `.ts` source is the governed artifact every test, region lint and install path reads, so sweeping the `.ts` as well would count `commissaire` and `producer-auth` twice.

### (a) Derived set

Every file this map's classification rows (`write_evidence`, state-changing rows) and ownership rows (`canonical_writer`) name as the location of a write, restricted to files an `fs`-primitive sweep could in principle find (62 files). The two composers the tracker rows name, `label.js` and `landing-comment.js`, are excluded because they write nothing:

```
plugin/skills/faff/bin/lib/admissibility.js
plugin/skills/faff/bin/lib/adr.js
plugin/skills/faff/bin/lib/andon.js
plugin/skills/faff/bin/lib/budget.js
plugin/skills/faff/bin/lib/build-judge-evidence.js
plugin/skills/faff/bin/lib/bundle-recover.js
plugin/skills/faff/bin/lib/bundle-seal-core.js
plugin/skills/faff/bin/lib/bundle.js
plugin/skills/faff/bin/lib/ci-triage.js
plugin/skills/faff/bin/lib/claim-verdict.js
plugin/skills/faff/bin/lib/commissaire.js
plugin/skills/faff/bin/lib/config.js
plugin/skills/faff/bin/lib/contain.js
plugin/skills/faff/bin/lib/conventions.js
plugin/skills/faff/bin/lib/corrective.js
plugin/skills/faff/bin/lib/decision-capture.js
plugin/skills/faff/bin/lib/effects.js
plugin/skills/faff/bin/lib/eligible.js
plugin/skills/faff/bin/lib/engine.js
plugin/skills/faff/bin/lib/env.js
plugin/skills/faff/bin/lib/events.js
plugin/skills/faff/bin/lib/fixtures.js
plugin/skills/faff/bin/lib/gates.js
plugin/skills/faff/bin/lib/gitignore-ensure.js
plugin/skills/faff/bin/lib/governance-check.js
plugin/skills/faff/bin/lib/heartbeat.js
plugin/skills/faff/bin/lib/hooks-ensure.js
plugin/skills/faff/bin/lib/inflightcheck.js
plugin/skills/faff/bin/lib/intake-provenance.js
plugin/skills/faff/bin/lib/integrity-digest.js
plugin/skills/faff/bin/lib/judge-trail.js
plugin/skills/faff/bin/lib/lane-boundary.js
plugin/skills/faff/bin/lib/lights-out.js
plugin/skills/faff/bin/lib/machine-id.js
plugin/skills/faff/bin/lib/merge-gate.js
plugin/skills/faff/bin/lib/native-map.js
plugin/skills/faff/bin/lib/next.js
plugin/skills/faff/bin/lib/park-reconsider.js
plugin/skills/faff/bin/lib/park-verdict.js
plugin/skills/faff/bin/lib/post-merge.js
plugin/skills/faff/bin/lib/prd.js
plugin/skills/faff/bin/lib/prdr.js
plugin/skills/faff/bin/lib/project-next.js
plugin/skills/faff/bin/lib/queue-state.js
plugin/skills/faff/bin/lib/ratified-scope.js
plugin/skills/faff/bin/lib/resumecheck.js
plugin/skills/faff/bin/lib/run-done.js
plugin/skills/faff/bin/lib/run-ledger.js
plugin/skills/faff/bin/lib/run-outward.js
plugin/skills/faff/bin/lib/run-record-prd.js
plugin/skills/faff/bin/lib/run-start.js
plugin/skills/faff/bin/lib/self-intake.js
plugin/skills/faff/bin/lib/sentry-poller.js
plugin/skills/faff/bin/lib/sentry.js
plugin/skills/faff/bin/lib/shadow-fidelity.js
plugin/skills/faff/bin/lib/spec-judge-evidence.js
plugin/skills/faff/bin/lib/spec-review-pin.js
plugin/skills/faff/bin/lib/spec-review-window.js
plugin/skills/faff/bin/lib/supervisor.js
plugin/skills/faff/bin/lib/worktree-heal.js
plugin/skills/faff/bin/lib/worktree-prune.js
plugin/skills/faffter-noon-evaluate/evaluate-call.mjs
```

Named separately (not JS-primitive-visible), every one of them a durable write the seed vocabulary cannot see:

- the `git push <sha>:<ref>` build-claim and landing-claim compare-and-swap inside `bundle.js :: claimStoreCore` (the file above is already listed for its own local-store reads and writes);
- judge-trail's `git update-ref refs/faff/judge-trail/<run_id>`, or its non-force `git push origin <sha>:<ref>` under the `git-remote` bundle store (`judge-trail.js :: mint`);
- worktree-heal's shelled `git worktree repair` (`worktree-heal.js :: healClobberedWorktree`);
- the `scripts/link-skills.sh` mkdir/symlink installer shelled from `gates.js :: cmdSync`;
- merge-gate's forge and ref mutations: the `gh pr` merge call (`cmdMergeGate`), `git push --force-with-lease` in the dependency rebase (`merge-gate.js :: boundedRebaseOntoMain`), and the `--local` landing's `git merge --ff-only` or `git update-ref refs/heads/<base>` (`merge-gate.js :: landBaseFfOnly`);
- the `gh pr create` call in `merge-gate.js :: cmdPrCreate`;
- one durable file with no JS writer at all: the governance-required sentinel `<run-dir>/commissaire/governance-required.json`, which `merge-gate.js :: governanceRequiredSentinelPresent` reads and only faff-beep-boop's skill prose writes.

### (b) Swept set

Seed: every `writeFileSync`, `appendFileSync`, `renameSync`, `mkdirSync`, `unlinkSync`, `rmSync`, `copyFileSync`, `cpSync`, `writeSync` text match in any `.js`/`.mjs` file in the repository outside `test/` and `node_modules/` (82 files). Closure: any function calling a seed site's production function (selftest and `...ForSelftest` helpers excluded), within its own module or through a `require`d module, is itself a write site, repeated to a fixed point. The closure adds 16 files whose own text carries no primitive (98 in total). Each is the `persist()`-wrapper case the method exists to catch: the nine decision kernels reach `decision-capture.js :: captureDecision`; `contain.js` and `self-intake.js` reach `events.js :: appendEventRecord`; `resumecheck.js` reaches `events.js :: appendRecordUnderLock`; `engine.js` reaches `budget.js :: appendEngineSpend`; `supervisor.js` reaches `heartbeat.js :: cmdHeartbeat`; `admissibility.js` reaches `prdr.js :: setPrdrDodVerdict`; `reconcile-recover.js` reaches `post-merge.js :: verifyPostMerge`; and `state.js` reaches `config.js :: resolveSpecDocsPath`.

```
eval/cli-driver.mjs
eval/gen-cases-seeded.mjs
eval/live-driver.mjs
eval/prefix-planner.mjs
eval/review-bench/build-requests.mjs
eval/review-bench/code-review/build-requests-code.mjs
eval/review-bench/full-bench.mjs
eval/review-bench/run-bench.mjs
eval/run-evals.mjs
eval/run-live-evals.mjs
eval/size-census.mjs
eval/tokenomics.mjs
plugin/skills/faff/bin/lib/admissibility.js  [closure addition]
plugin/skills/faff/bin/lib/adr.js
plugin/skills/faff/bin/lib/andon.js
plugin/skills/faff/bin/lib/budget.js
plugin/skills/faff/bin/lib/build-judge-evidence.js
plugin/skills/faff/bin/lib/build-review-churn.js
plugin/skills/faff/bin/lib/build-review-convergence.js
plugin/skills/faff/bin/lib/bundle-recover.js
plugin/skills/faff/bin/lib/bundle-seal-core.js
plugin/skills/faff/bin/lib/bundle.js
plugin/skills/faff/bin/lib/ci-triage.js
plugin/skills/faff/bin/lib/claim-verdict.js  [closure addition]
plugin/skills/faff/bin/lib/claude-config-isolation.js
plugin/skills/faff/bin/lib/commissaire.js
plugin/skills/faff/bin/lib/config.js
plugin/skills/faff/bin/lib/contain.js  [closure addition]
plugin/skills/faff/bin/lib/conventions.js
plugin/skills/faff/bin/lib/corrective.js
plugin/skills/faff/bin/lib/decision-capture.js
plugin/skills/faff/bin/lib/decisions.js
plugin/skills/faff/bin/lib/effects-reconcile.js
plugin/skills/faff/bin/lib/effects.js
plugin/skills/faff/bin/lib/eligible.js  [closure addition]
plugin/skills/faff/bin/lib/engine-codex.js
plugin/skills/faff/bin/lib/engine.js  [closure addition]
plugin/skills/faff/bin/lib/env.js
plugin/skills/faff/bin/lib/events.js
plugin/skills/faff/bin/lib/fixtures.js
plugin/skills/faff/bin/lib/fs-lock.js
plugin/skills/faff/bin/lib/gates.js
plugin/skills/faff/bin/lib/gitignore-ensure.js
plugin/skills/faff/bin/lib/governance-check.js
plugin/skills/faff/bin/lib/heartbeat.js
plugin/skills/faff/bin/lib/hooks-ensure.js
plugin/skills/faff/bin/lib/inflightcheck.js
plugin/skills/faff/bin/lib/intake-provenance.js
plugin/skills/faff/bin/lib/integrity-digest.js
plugin/skills/faff/bin/lib/judge-trail.js
plugin/skills/faff/bin/lib/lane-boundary.js
plugin/skills/faff/bin/lib/lights-out.js
plugin/skills/faff/bin/lib/machine-id.js
plugin/skills/faff/bin/lib/merge-fence.js
plugin/skills/faff/bin/lib/merge-gate.js
plugin/skills/faff/bin/lib/native-map.js
plugin/skills/faff/bin/lib/next.js  [closure addition]
plugin/skills/faff/bin/lib/park-reconsider.js
plugin/skills/faff/bin/lib/park-verdict.js  [closure addition]
plugin/skills/faff/bin/lib/post-merge.js
plugin/skills/faff/bin/lib/prd.js
plugin/skills/faff/bin/lib/prdr.js
plugin/skills/faff/bin/lib/project-next.js  [closure addition]
plugin/skills/faff/bin/lib/queue-state.js
plugin/skills/faff/bin/lib/ratified-scope.js
plugin/skills/faff/bin/lib/reconcile-recover.js  [closure addition]
plugin/skills/faff/bin/lib/regions.js
plugin/skills/faff/bin/lib/resumecheck.js  [closure addition]
plugin/skills/faff/bin/lib/run-done.js  [closure addition]
plugin/skills/faff/bin/lib/run-ledger.js
plugin/skills/faff/bin/lib/run-outward.js  [closure addition]
plugin/skills/faff/bin/lib/run-record-prd.js
plugin/skills/faff/bin/lib/run-start.js  [closure addition]
plugin/skills/faff/bin/lib/self-intake.js  [closure addition]
plugin/skills/faff/bin/lib/sentry-poller.js
plugin/skills/faff/bin/lib/sentry.js
plugin/skills/faff/bin/lib/shadow-fidelity.js
plugin/skills/faff/bin/lib/spec-judge-evidence.js
plugin/skills/faff/bin/lib/spec-review-churn.js
plugin/skills/faff/bin/lib/spec-review-convergence.js
plugin/skills/faff/bin/lib/spec-review-pin.js
plugin/skills/faff/bin/lib/spec-review-window.js
plugin/skills/faff/bin/lib/spec-review.js
plugin/skills/faff/bin/lib/state.js  [closure addition]
plugin/skills/faff/bin/lib/supervisor.js  [closure addition]
plugin/skills/faff/bin/lib/worktree-heal.js
plugin/skills/faff/bin/lib/worktree-prune.js
plugin/skills/faffter-dark-adversarial-review/review-call.mjs
plugin/skills/faffter-noon-evaluate/evaluate-call.mjs
records/spikes/2026-07-10-faff-411/analyze.mjs
records/spikes/2026-09-24-faff-1073/analyze.mjs
records/spikes/2026-09-24-faff-1073/env-sample.mjs
scripts/mcp-call-census.mjs
scripts/verify-split-parity.mjs
verification/external-verification/commissaire-bare-claude/commissaire-stop-hook.mjs
verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs
verification/external-verification/faff-labs/experiments/rig/score.mjs
verification/external-verification/results/2026-08-12-fly-l3-faff-472/tools/curate.mjs
```

### (c) The two-way diff and its resolution

**In (b) and not (a): 36 files.** Every one resolves to a stated reason; none is a state-changing command wrongly recorded read-only:

- `eval/*.mjs` (12 files: `cli-driver`, `gen-cases-seeded`, `live-driver`, `prefix-planner`, `review-bench/build-requests`, `review-bench/code-review/build-requests-code`, `review-bench/full-bench`, `review-bench/run-bench`, `run-evals`, `run-live-evals`, `size-census`, `tokenomics`): eval-harness tooling, not `REGION_MAP` commands. Out of this map's per-command grain by the spec's own design.
- `scripts/mcp-call-census.mjs`, `scripts/verify-split-parity.mjs`: repo-maintenance/CI scripts, not commands.
- `records/spikes/2026-07-10-faff-411/analyze.mjs`, `records/spikes/2026-09-24-faff-1073/analyze.mjs`, `records/spikes/2026-09-24-faff-1073/env-sample.mjs`: dated one-off spike analyses, not part of the live command surface.
- `verification/external-verification/faff-labs/experiments/rig/score.mjs`, `verification/external-verification/results/2026-08-12-fly-l3-faff-472/tools/curate.mjs`, `verification/external-verification/commissaire-bare-claude/commissaire-stop-hook.mjs`, `verification/external-verification/commissaire-bare-claude/verify-commissaire.mjs`: external-verification experiment and capture tooling; the last two drive the bare-Claude Commissaire consumer (FAFF-1018) and write its capture directory, not a faff run's state.
- `plugin/skills/faffter-dark-adversarial-review/review-call.mjs`: not a `REGION_MAP` command; the adversarial review helper. Its only write, `realWrite`, retains raw backend bodies under a caller-supplied raw directory (FAFF-928, opt-in), an inspection corpus no gate or `bin/lib` reader consumes.
- `plugin/skills/faff/bin/lib/claude-config-isolation.js`: not a `REGION_MAP` command; the `faff engine call` config-isolation helper. Its writes mint a per-spawn scratch config directory and remove it in a `finally`; ephemeral, not durable under the Vocabulary's `state-changing` definition.
- `plugin/skills/faff/bin/lib/engine-codex.js`: `runCodexCall`'s `fs.rmSync(tmp, …)` cleans up a per-call scratch directory outside `.faff/`, `records/`, and the anchors tree; ephemeral. Its spend record reaches the disk only through the `spendSink` `engine.js` hands it, recorded on the `engine` row.
- `plugin/skills/faff/bin/lib/fs-lock.js`: the shared advisory-lock primitive underlying every `*UnderLock` writer. Its lock file is created and unlinked within one call; folded into the rows that use it, not a separate row.
- `plugin/skills/faff/bin/lib/reconcile-recover.js` (closure addition): reaches `post-merge.js :: verifyPostMerge`, whose only primitive removes an ephemeral detached worktree under the OS temp directory; `faff reconcile-recover` stays `state_changing: no`.
- `plugin/skills/faff/bin/lib/state.js` (closure addition): reaches `config.js :: resolveSpecDocsPath` with `create=false`, so the `mkdirSync` it closes over is never taken; `faff state` stays `state_changing: no`.
- `plugin/skills/faff/bin/lib/build-review-churn.js`, `build-review-convergence.js`, `decisions.js`, `effects-reconcile.js`, `merge-fence.js`, `regions.js`, `spec-review-churn.js`, `spec-review-convergence.js`, `spec-review.js` (9 files): each appears in the raw seed only via its own `--selftest` fixture or a `...ForSelftest` scratch helper (a scratch-directory exercise the classification's write-closure tracing deliberately excludes). Each command's classification row already states `state_changing: no` (`effects-reconcile.js` backs the read-only `faff effects reconcile-merges` verb); the sweep confirms rather than contradicts it.

**In (a) and not (b): 0 files.** The closure pass already places every derived file in the swept set: `resumecheck.js`, `contain.js`, `self-intake.js`, `engine.js`, `supervisor.js`, `admissibility.js` and the nine kernels have no primitive of their own and enter (b) only through the closure.

**Net result:** every entry in both directions resolves to a stated reason. The sweep found three facts the `174f62b7` revision recorded wrongly, now corrected on their rows (see "Changes since 174f62b7"): `lane-boundary.js` was in that revision's own seed but missing from its swept list, and `faff lane-boundary emit` writes `<run-dir>/lane-boundary.json`; and the closure the `174f62b7` revision reported as "exactly one file" (`resumecheck.js`) already reached `contain.js`, `self-intake.js`, `engine.js`, `reconcile-recover.js`, `state.js` and `supervisor.js` at that commit, which made `faff contain --record`, `faff self-intake --record` and `faff engine call` state-changing then as now.

## Ownership, migration, and assurance tables

94 rows share one `row_key` set across all three tables (Ownership, Migration, Assurance), sectioned into seven areas per the sizing guidance and applied uniformly rather than judged row-by-row. Completeness is checked across the union of sections, not per section. The seventh area, **Commissaire facade**, holds the `faff commissaire` rows: they share one module, one `schema:3` envelope and one custody caveat, and placing them under "Effects" would sit `schema:3` rows beside the `schema:2` rows as one stream, which would read as an answer to addendum decision 2 (one ledger, two schemas) that this map does not give. Every other row added since `174f62b7` sits in one of the original six areas, next to the precedent row it cites.

**On the row count.** The `174f62b7` revision found 40 state-changing commands and 59 rows, below its build procedure's 70–90 estimate, and explained the gap by shared chokepoint writers. At `475c0362` the count is 64 state-changing commands and 94 rows: 79 command-step rows (`adr`, `prdr`, `ci-triage`, `governance-check`, `effects` and `commissaire` split by mutation kind) plus 15 artifact-only rows (`run-ledger.json`, `effects-chain-head.json`, `holdout.json`, the per-issue spec file, `summary.md`, four anchor kinds, four tracker-mutation kinds, `commissaire key material` and `governance-required.json`). The 24 commands that became state-changing break down as:

- 8 new commands that write: `build-judge-evidence`, `commissaire`, `conventions`, `judge-trail`, `native-map`, `pr-create`, `shadow-fidelity`, `worktree-heal`;
- 12 existing commands that gained a write since `174f62b7`: the nine decision kernels (through in-kernel decision capture), `holdout`, `ratified-scope` and `spec-judge-evidence`;
- 4 existing commands the `174f62b7` revision recorded as read-only in error: `lane-boundary`, `contain`, `self-intake`, `engine`.

Three commands the `174f62b7` revision did classify as state-changing (`budget`, `events`, `intake-record`) had no row triple there; they have one now. The chokepoint observation still holds and has sharpened: `heartbeat.js :: atomicWriteLedger` still serves every run-ledger.json mutation; `events.js :: appendRecordsUnderLock` now carries `events`, `effects`, the nine kernels' capture records, the `contain` and `self-intake` records and every `schema:3` Commissaire record; and `decision-capture.js :: captureDecisionCore` is one writer behind nine commands. No row was merged or dropped to reach this count; every state-changing command and every durable artifact identified by the sweep above has its own row.

**Splitting rule applied.** Five commands cover more than one **kind** of mutation to the same artifact and are split accordingly, mirroring the tracker/anchor "one row per kind" rule: `adr` (draft / accept / renumber / supersede), `prdr` (draft / accept / land / renumber), `ci-triage` (flaky-register / verdict), `governance-check` (ledger-append / floor-artifacts), and `effects` (declare / observe). This is a completeness choice, not a count-inflation one: each split-out row has its own distinct write call, its own distinct evidence, and in three of the five cases a different downstream reader. A sixth, `commissaire`, splits by verb (contract admit / effect declare / effect authorize / effect observe / verdict conclude / audit seal / audit export) because each verb writes a different fact; its read-only verbs (`contract admit-required`, `effect reconcile`, `audit verify`) get no row, and `audit anchor` folds into the four anchor rows because it calls the same writer, `events.js :: mintIssueAnchor`, and produces the same four anchor kinds under a different default destination.

### Ownership table

#### Run record (12 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `run-ledger.json` | commissaire-governance | heartbeat.js :: atomicWriteLedger | runcheck.js, audit.js, sentry.js, disposition.js, merge-gate.js, governance-check.js, reconcile-recover.js, corrective-integrity.js | run | run-membership |
| `faff heartbeat` | commissaire-governance | heartbeat.js :: atomicWriteSingleValueFile | sentry.js, sentry-poller.js, runcheck.js, resumecheck.js | run-segment | run-segment |
| `faff inflightcheck` | commissaire-governance | inflightcheck.js :: cmdInflightcheck | turncheck.js | run-segment | run-segment |
| `faff resumecheck` | commissaire-governance | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from resumecheck.js's fenced release) | run-start.js, lights-out.js | run | run-membership |
| `faff sentry` | commissaire-governance | sentry.js :: cmdSentry | audit.js, runcheck.js | run | run-membership |
| `faff sentry-poller` | commissaire-governance | sentry-poller.js :: atomicWriteFile | sentrycheck.js, sentry.js | run-segment | run-segment |
| `faff lights-out` | harness-and-skill-orchestration | lights-out.js :: claimRunDir (mint) plus heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock) | run-start.js, resumecheck.js, heartbeat.js | run | run-membership |
| `faff run-ledger` | decision-kernel | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from run-ledger.js :: initInteractive / initSelfDrain / recordOutcome / captureCapability) | disposition.js, quality.js, economics.js | run | run-membership |
| `faff run-record-prd` | software-delivery-policy | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from run-record-prd.js) | lights-out.js (prd_root_container / prd_creative_licence read-back) | run | run-membership |
| `faff machine-id` | external-adapters-and-infrastructure | machine-id.js :: realWriteFile | build-claim/landing-claim owner snapshots (bundle.js), sentry.js | none | none |
| `faff budget` | commissaire-governance | budget.js :: appendEngineSpend (the engine-spend log; the `parked-window` field it also sets reaches run-ledger.json through the `run-ledger.json` row's writer, heartbeat.js :: atomicWriteLedger) | budget.js :: measureRunSpend, economics.js, shadow-fidelity.js (cost snapshot) | run | run-membership |
| `faff events` | commissaire-governance | events.js :: appendRecordsUnderLock (via appendEventRecord; the anchor copy is the `anchor: events` row) | audit.js, runcheck.js, decision-capture.js, shadow-fidelity.js, events.js :: mintIssueAnchor | run | none |

#### Effects (6 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff effects declare` | commissaire-governance | effects.js :: appendEffectEntries (delegates the byte-write to events.js :: appendRecordsUnderLock) | merge-gate.js, governance-check.js, audit.js | effect | none |
| `faff effects observe` | commissaire-governance | effects.js :: appendEffectEntries (delegates the byte-write to events.js :: appendRecordsUnderLock) | merge-gate.js, governance-check.js, audit.js | effect | none |
| `effects-chain-head.json` | commissaire-governance | events.js :: computeChainHead (called from events.js :: mintIssueAnchor) | effects.js verify path, merge-gate.js, governance-check.js | effect | none |
| `faff review-progress` | commissaire-governance | effects.js :: cmdReviewProgress | merge-gate.js, governance-check.js | stage-attempt | none |
| `faff build-progress` | commissaire-governance | effects.js :: cmdBuildProgress | merge-gate.js, governance-check.js, events.js :: mintIssueAnchor | stage-attempt | none |
| `faff landing-progress` | commissaire-governance | effects.js :: cmdLandingProgress | merge-gate.js, events.js :: mintIssueAnchor | stage-attempt | none |

#### Gates and merge (17 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff merge-gate` | software-delivery-policy | merge-gate.js :: writeMergeRecord | corrective-integrity.js, post-merge.js, audit.js | work-item | work-item |
| `faff ci-triage flaky-register` | software-delivery-policy | ci-triage.js :: writeFlakyRegister | ci-triage.js (its own re-read on the next run) | none | none |
| `faff ci-triage verdict` | software-delivery-policy | ci-triage.js :: writeCiTriageVerdict | governance-check.js, merge-gate.js | stage-attempt | none |
| `faff post-merge-check` | software-delivery-policy | post-merge.js :: writePostMergeVerification | corrective-integrity.js, reconcile-recover.js | work-item | work-item |
| `faff governance-check ledger` | software-delivery-policy | governance-check.js :: cmdGovernanceCheck / writeLedger | audit.js | work-item | work-item |
| `faff governance-check floor` | software-delivery-policy | governance-check.js :: writeFloorArtifacts | merge-gate.js, corrective-integrity.js | work-item | work-item |
| `faff build-claim` | software-delivery-policy | bundle.js :: buildClaimStore (its returned .acquire method wraps the shared claimStoreCore) | bundle.js :: claimStoreCore::readHolder / confirmHead | work-item | work-item |
| `faff landing-claim` | software-delivery-policy | bundle.js :: landingClaimStore (its returned .acquire method wraps the shared claimStoreCore) | bundle.js :: claimStoreCore::readHolder / confirmHead | work-item | work-item |
| `holdout.json` | software-delivery-policy | plugin/skills/faffter-noon-evaluate/evaluate-call.mjs :: main (writes .faff/holdout/<key>.json, the spawner-attested source) — OUTSIDE plugin/skills/faff/bin/lib/ entirely, a skill-side script the classification table's REGION_MAP grain does not cover | merge-gate.js, corrective-integrity.js, governance-check.js, events.js :: mintIssueAnchor | stage-attempt | none |
| `faff spec-review-pin` | software-delivery-policy | spec-review-pin.js :: capturePin | spec-review-churn.js, spec-review-convergence.js, spec-review-reputation.js | work-item | work-item |
| `faff spec-review-window` | software-delivery-policy | spec-review-window.js :: writeWindowStart | spec-review-convergence.js, spec-review-churn.js | work-item | work-item |
| `faff pr-create` | software-delivery-policy | merge-gate.js :: cmdPrCreate (the sole `gh pr create` invocation; on a create no `schema:3` grant covers, it also appends a `schema:2` declare/observe pair through effects.js :: appendEffectEntries) | merge-gate.js (later merge-floor reads of the same declared-effects.jsonl), effects.js check/verify, audit.js | work-item | work-item |
| `faff lane-boundary` | software-delivery-policy | lane-boundary.js :: emitLaneBoundary | evaluator-preflight.js, merge-gate.js, governance-check.js, config.js | run | run-membership |
| `faff holdout` | software-delivery-policy | prdr.js :: setPrdrDodVerdict (called from admissibility.js :: cmdHoldout under `verdicts --persist`) | prdr.js (coverage parse of the DoD-verdict line) | none | none |
| `faff spec-judge-evidence` | software-delivery-policy | spec-judge-evidence.js :: cmdAssemble (cmdAdmit and cmdRestamp write admit-result.json and re-stamp ledger.json in the same directory) | spec-judge-evidence.js :: cmdAdmit / cmdRestamp, judge-trail.js :: mint | work-item | work-item |
| `faff build-judge-evidence` | software-delivery-policy | build-judge-evidence.js :: cmdAssemble (dispatchJudgeRulings adds ruling files and cmdAdmit adds admit-result.json in the same directory) | build-judge-evidence.js :: cmdAdmit, judge-trail.js :: mint | work-item | work-item |
| `faff judge-trail` | software-delivery-policy | judge-trail.js :: mint | judge-trail.js :: judgeHistory | run | none |

#### Corrective and containment (7 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff corrective` | commissaire-governance | corrective.js :: cmdCorrectiveAuthor | corrective-integrity.js, next.js | work-item | work-item |
| `faff integrity-digest` | commissaire-governance | integrity-digest.js :: atomicWriteVerdictBytes | audit.js, merge-gate.js | work-item | work-item |
| `faff andon` | commissaire-governance | andon.js :: writeAndonState | andon.js (its own re-read for idempotent notification) | run | run-membership |
| `faff worktree-prune` | harness-and-skill-orchestration | worktree-prune.js :: cmdWorktreePrune | none for the prune itself; a destructive hygiene action; on a governed run with `--run-dir` and `--issue` it brackets the removal with a `schema:2` declare/observe pair (kind `branch-delete`, target the worktree path) through effects.js :: appendEffectEntries, read by effects.js check/verify and audit.js (FAFF-1119) | none | none |
| `faff contain` | software-delivery-policy | events.js :: appendEventRecord (called from contain.js :: cmdContain under `--record`) | audit.js (containment recompute), governance-check.js | work-item | none |
| `faff self-intake` | software-delivery-policy | events.js :: appendEventRecord (called from self-intake.js :: cmdSelfIntake under `--record`) | audit.js (self-intake recompute) | work-item | none |
| `faff intake-record` | software-delivery-policy | intake-provenance.js :: cmdIntakeRecord | intake-provenance.js (`faff intakecheck`), audit.js, governance-check.js | work-item | none |

#### Product records (23 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff adr draft` | software-delivery-policy | adr.js :: cmdAdr | ratified-scope.js, decisions.js | none | none |
| `faff adr accept` | software-delivery-policy | adr.js :: adrAccept | ratified-scope.js, decisions.js | none | none |
| `faff adr renumber` | software-delivery-policy | adr.js :: adrRenumber | lint-refs.js (ADR-citation checks) | none | none |
| `faff adr supersede` | software-delivery-policy | adr.js :: recordSupersede | decisions.js, ratified-scope.js | none | none |
| `faff prdr draft` | software-delivery-policy | prdr.js :: cmdPrdr | ratified-scope.js | none | none |
| `faff prdr accept` | software-delivery-policy | prdr.js :: prdrAccept | ratified-scope.js | none | none |
| `faff prdr land` | software-delivery-policy | prdr.js :: prdrLand | ratified-scope.js | none | none |
| `faff prdr renumber` | software-delivery-policy | prdr.js :: prdrRenumber | lint-refs.js | none | none |
| `faff prd` | software-delivery-policy | prd.js :: cmdPrd | prd-checklist.js, ratified-scope.js, run-record-prd.js | none | none |
| `faff decision-capture` | decision-kernel | decision-capture.js :: cmdExportVerb | shadow-fidelity.js (FAFF-826's coordinator-transition shadow comparison, which reads the exported corpus) | run | run-membership |
| `per-issue spec file` | software-delivery-policy | GAP — no bin/lib module writes it | faff-graft, faff-prep, gate and review commands that cite `records/specs/<name>.md` | work-item | work-item |
| `summary.md` | harness-and-skill-orchestration | GAP for the document itself — no bin/lib module composes it; sentry.js :: cmdSentry can best-effort appendFileSync a warning SECTION to a caller-supplied --summary-md path, but never mints or owns the document | park-history.js | run | run-membership |
| `faff claim-verdict` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from claim-verdict.js :: cmdClaimVerdict) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff eligible` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from eligible.js :: cmdEligible) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff next` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from next.js :: cmdNext) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff park-verdict` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from park-verdict.js :: cmdParkVerdict) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff project-next` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from project-next.js :: cmdProjectNext) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff queue-state` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from queue-state.js :: cmdDerive) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff run-done` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from run-done.js :: cmdRunDone) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff run-outward` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from run-outward.js :: cmdRunOutward) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff run-start` | decision-kernel | decision-capture.js :: captureDecisionCore (via captureDecision, called from run-start.js :: cmdRunStart) | decision-capture.js :: cmdListVerb / cmdExportVerb, shadow-fidelity.js (through the exported corpus) | run | run-membership |
| `faff shadow-fidelity` | decision-kernel | shadow-fidelity.js :: cmdRunVerb | shadow-fidelity.js :: cmdReproduceVerb | none | none |
| `faff ratified-scope` | software-delivery-policy | ratified-scope.js :: cmdRatifiedScope (under `--fold-resolutions --into`) | the faff-prep spec draft the caller names (the folded subsection is inert cited text) | work-item | none |

#### Harness orchestration and anchors (20 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff config` | external-adapters-and-infrastructure | config.js :: cmdConfigSet (and cmdConfigInit for first-write; both write the .faffrc.local.yaml overlay instead under `--local`) | every command that calls config.js :: loadConfig / shared-infra.js :: findConfig | none | none |
| `faff sync` | harness-and-skill-orchestration | scripts/link-skills.sh (shelled from gates.js :: cmdSync via spawnSync) | the operator's harness (skill discovery reads the linked directories) | none | none |
| `faff hooks-ensure` | harness-and-skill-orchestration | hooks-ensure.js :: cmdHooksEnsure | the harness's own hook dispatcher (reads the registered Stop-hook set) | none | none |
| `faff gitignore-ensure` | harness-and-skill-orchestration | gitignore-ensure.js :: gitignoreEnsure | none — repo hygiene, not read back by another command | none | none |
| `faff fixtures` | harness-and-skill-orchestration | fixtures.js :: cmdFixtures | the eval harness (eval-affected.js selects which fixtures a change needs) | none | none |
| `faff env` | external-adapters-and-infrastructure | env.js :: cmdEnv | the harness's compose provisioning step | none | none |
| `faff bundle` | commissaire-governance | bundle-seal-core.js :: localBundleStore (via bundle.js :: publishBundle; bundle.js re-exports it) | bundle-recover.js, commissaire.js :: cmdAuditVerify | run-segment | run-segment |
| `faff bundle-recover` | commissaire-governance | bundle-recover.js :: reconstructProjection | the recovering run-segment's own subsequent commands (heartbeat, run-done, etc.) | run-segment | run-segment |
| `anchor: events` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js (post-merge, from the committed anchor) | work-item | work-item |
| `anchor: ledger` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js, audit.js | work-item | work-item |
| `anchor: effects` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js | effect | none |
| `anchor: floor-evidence` | software-delivery-policy | events.js :: mintIssueAnchor | merge-gate.js (post-merge floor re-evaluation from the committed anchor) | work-item | work-item |
| `tracker: status transition` | software-delivery-policy | GAP: no bin/lib module composes or performs it; on a governed run faff-graft's prose records it as a `tracker-write` declare/observe pair the agent appends through effects.js :: appendEffectEntries (FAFF-1120), which records the transition but does not perform it | queue-state.js, next.js, disposition.js (all read a tracker-status snapshot the agent already fetched, never live) | work-item | work-item |
| `tracker: comment` | software-delivery-policy | landing-comment.js :: renderBody (composes the ready-to-land comment body only; the module's own banner states it "NEVER merges" and does not post) | the GH Action that shells this verb and posts the rendered body | work-item | work-item |
| `tracker: label` | software-delivery-policy | label.js :: labelOp (composes the op descriptor only; the module's own banner states "The single MCP write stays agent-side."); on a governed run faff-graft's prose records the agent's write as a `label-write` declare/observe pair through effects.js :: appendEffectEntries (FAFF-1119) | the agent turn that executes the descriptor | work-item | work-item |
| `tracker: relation` | software-delivery-policy | GAP — no bin/lib module composes or performs it | findings-reconcile.js (computes candidate relations but never writes) | work-item | work-item |
| `faff engine` | external-adapters-and-infrastructure | budget.js :: appendEngineSpend (called through engine.js :: resolveSpendSink inside a run) | budget.js :: measureRunSpend, economics.js | run | none |
| `faff conventions` | software-delivery-policy | conventions.js :: writeConventionsCacheAtomic | conventions.js :: resolveConventionCached (`get`), validate-adapters.js | none | none |
| `faff native-map` | external-adapters-and-infrastructure | native-map.js :: cmdNativeMapSet | native-map.js :: cmdNativeMapGet (and the skill-side tracker create path that reads the committed map) | none | none |
| `faff worktree-heal` | harness-and-skill-orchestration | worktree-heal.js :: healClobberedWorktree | git itself (the repaired worktree admin metadata); worktree-check.js re-reads the healed worktree | none | none |

#### Commissaire facade (9 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff commissaire contract admit` | commissaire-governance | commissaire.js :: cmdAdmit | commissaire.js (authorize, conclude, admit-required, hasGovernanceContext), merge-gate.js :: resolveGrantByEffectKind | contract-revision | none |
| `commissaire key material` | commissaire-governance | commissaire.js :: writeJson (only caller: cmdAdmit) | commissaire.js (governor.json in authorize and conclude), merge-gate.js :: resolveGrantByEffectKind (pk.json), events.js :: mintIssueAnchor (copies pk.json only, never governor.json) | none | none |
| `faff commissaire effect declare` | commissaire-governance | commissaire.js :: appendProducerRecords (delegates the byte-write to events.js :: appendRecordsUnderLock) | commissaire.js :: computeEscapes (`effect reconcile`) and cmdTerminalVerdict, audit.js | effect | none |
| `faff commissaire effect authorize` | commissaire-governance | commissaire.js :: cmdRequestDecision (appends the producer request and the Commissaire-signed verdict) | merge-gate.js :: resolveGrantByEffectKind (via resolveCommissaireDecisionGrant and resolvePrCreateGrant; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence) | effect | none |
| `faff commissaire effect observe` | commissaire-governance | commissaire.js :: appendProducerRecords (delegates the byte-write to events.js :: appendRecordsUnderLock) | commissaire.js :: computeEscapes (`effect reconcile`) and cmdTerminalVerdict, audit.js | effect | none |
| `faff commissaire verdict conclude` | commissaire-governance | commissaire.js :: cmdTerminalVerdict (appends the `accepted_under_contract` record through appendCommissaireRecord; a refusal writes nothing) | commissaire.js (its own idempotent re-read), audit.js | work-item | work-item |
| `faff commissaire audit seal` | commissaire-governance | bundle-seal-core.js :: localBundleStore (via commissaire.js :: cmdSealBundle) | commissaire.js :: cmdAuditVerify / cmdAuditExport, bundle-recover.js | run-segment | run-segment |
| `faff commissaire audit export` | commissaire-governance | commissaire.js :: cmdAuditExport | an external auditor (the bare-Claude consumer under verification/external-verification/commissaire-bare-claude/) | run-segment | run-segment |
| `governance-required.json` | commissaire-governance | GAP: no bin/lib module writes it; faff-beep-boop's skill prose writes `{"governance_required":true}` to `<run-dir>/commissaire/governance-required.json` after `faff commissaire contract admit-required` reports a governance-required run (FAFF-1140) | merge-gate.js :: governanceRequiredSentinelPresent (read by resolveGrantByEffectKind) | run | run-membership |

### Migration table

#### Run record (12 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `run-ledger.json` | translated | a Phase 2A reader loads a pre-cutover run-ledger.json verbatim; it is never mirrored into the generic record system | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-ledger-init-interactive.test.mjs, test/heartbeat-concurrency.test.mjs |
| `faff heartbeat` | translated | a Phase 2A liveness reader accepts either the current heartbeat file or the generic liveness record for a given run-segment, never both for the same segment | (2) chain heads and ledger digests verify; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/heartbeat.test.mjs, test/heartbeat-concurrency.test.mjs |
| `faff inflightcheck` | translated | a Phase 2A reader treats an in-flight marker as a transitional liveness fact scoped to the run-segment it was minted under | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/inflightcheck.test.mjs |
| `faff resumecheck` | translated | same as run-ledger.json above — this row is one MUTATION KIND on that artifact (a dead-claim release), not a separate file | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/resumecheck.test.mjs |
| `faff sentry` | translated | a Phase 2A reader treats a pre-cutover kill-switch log entry as frozen evidence for that run; new runs after cutover use the generic effect-decision stream instead | (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sentry.test.mjs |
| `faff sentry-poller` | translated | the detached poller's state file is a transitional liveness fact scoped to the polling process, not carried into the generic record | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sentry-poller.test.mjs |
| `faff lights-out` | translated | a minted run directory stays a current-format run through Phase 0/1; nothing here creates a generic-format work item. A `--resume` pass may clear a git-only park (prep marker plus its own run's ledger, through park-reconsider.js :: apply_git_only_unpark) and leave a .faff/resume/<issue>/spec-review-hold.json hold, both current-format facts for that run | (1) durably-published facts and artifacts; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/lights-out.test.mjs, test/lights-out-resume.test.mjs, test/scaffolder-lights-out-dials.test.mjs, test/lights-out-reconsider.test.mjs |
| `faff run-ledger` | translated | same underlying artifact as the run-ledger.json row; this row is the command path onto it for the standalone-interactive L2 mint, the self-drain mint (FAFF-966), outcome records and the capability capture (FAFF-1116) | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-ledger-init-interactive.test.mjs, test/run-ledger-init-self-drain.test.mjs, test/run-ledger-record-outcome.test.mjs |
| `faff run-record-prd` | translated | the PRD-licence fact travels with run-ledger.json; a Phase 2A reader treats it as part of that frozen record | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-record-prd.test.mjs |
| `faff machine-id` | immutable-blob | the cached host id is read verbatim by a Phase 2A producer-binding check; it is never regenerated in place | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — machine-id.js has no dedicated test/*.test.mjs and its own module exports no --selftest fixture that exercises realWriteFile's write path directly |
| `faff budget` | translated | a Phase 2A reader treats a pre-cutover engine-spend log and a `parked-window` outcome as frozen per-run budget history | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/budget.test.mjs |
| `faff events` | translated | a Phase 2A reader treats a pre-cutover events.jsonl as the frozen journal for that run; the future record system's stream revisions replace it in kind, never by mirroring | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/events-chain.test.mjs, test/events-concurrency.test.mjs |

#### Effects (6 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff effects declare` | translated | a Phase 2A reader treats a pre-cutover declared-effects.jsonl as frozen effect-intent history for that run; on a governed run `schema:3` records from `faff commissaire` chain into the same file under the same lock (commissaire.js `LEDGER_CFG`, appended through events.js :: appendRecordsUnderLock), and existing `schema:2` readers are unchanged; which schema is canonical is addendum decision 2, not settled here | (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs, test/effects-chain.test.mjs, test/effects-concurrency.test.mjs |
| `faff effects observe` | translated | same artifact and reader posture as the declare row, including the `schema:3` records that chain into the same file; observation is a distinct event kind on the same chain | (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs, test/effects-chain.test.mjs |
| `effects-chain-head.json` | immutable-blob | the witness is copied verbatim into the anchor bundle and never regenerated for an already-anchored run; it folds every record in declared-effects.jsonl, `schema:2` and `schema:3` alike | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects-chain.test.mjs |
| `faff review-progress` | translated | a Phase 2A reader treats the progress file as a frozen per-stage checkpoint | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |
| `faff build-progress` | translated | same posture as review-progress; also required alongside holdout.json at L4 per governance-check.js | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |
| `faff landing-progress` | translated | same posture as build-progress; carried into the anchor bundle for FAFF-846's fix-cycle counter | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |

#### Gates and merge (17 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff merge-gate` | translated | a Phase 2A reader treats a pre-cutover merge record as frozen evidence for that work item's merge | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/merge-gate.test.mjs, test/merge-gate-local.test.mjs, test/merge-gate-controlflow.test.mjs |
| `faff ci-triage flaky-register` | rebuildable-projection | the flaky register is a rebuilt-from-history classification; a Phase 2A reader can regenerate it rather than migrate it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/ci-triage.test.mjs |
| `faff ci-triage verdict` | translated | a Phase 2A reader treats the verdict as a frozen per-attempt CI classification | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/ci-triage.test.mjs |
| `faff post-merge-check` | translated | a Phase 2A reader treats a pre-cutover post-merge verification as frozen evidence for that work item | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | post-merge.js's inline postMergeSelftest (lines 177-274) |
| `faff governance-check ledger` | translated | a Phase 2A reader treats the CI-enforcement ledger line as frozen per-check evidence | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-363-governance-check.test.mjs |
| `faff governance-check floor` | translated | a Phase 2A reader treats ac-checklist.json/review-verdict.json as frozen per-issue floor evidence | (1) durably-published facts and artifacts; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-363-governance-check.test.mjs |
| `faff build-claim` | rebuildable-projection | a build claim is a lease over a work item, reconstructable from the git ref's current head; nothing here migrates into the generic record | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle.js's inline buildClaimSelftest (lines 1519-1878) |
| `faff landing-claim` | rebuildable-projection | same posture as build-claim; a distinct ref namespace for the landing/endgame lease | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle.js's inline landingClaimSelftest (lines 2073-2173) |
| `holdout.json` | immutable-blob | a Phase 2A reader treats a pre-cutover holdout verdict as a frozen, code-blind evaluation artifact; carried into the anchor bundle verbatim | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | plugin/skills/faffter-noon-evaluate/evaluate-call.mjs's own inline `selftest` export; test/evaluate-call.test.mjs, test/holdout-verdicts.test.mjs |
| `faff spec-review-pin` | translated | a Phase 2A reader treats a pinned reviewer identity as a frozen per-issue fact | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/spec-review-pin.test.mjs |
| `faff spec-review-window` | translated | a Phase 2A reader treats the convergence-window start as a frozen per-issue fact | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/spec-review-window.test.mjs |
| `faff pr-create` | translated | a Phase 2A reader treats a pre-cutover `pr-create` effect record as frozen effect history for that work item; the opened PR itself lives on the forge | (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/pr-create-chokepoint.test.mjs |
| `faff lane-boundary` | translated | a Phase 2A reader treats a pre-cutover lane-boundary.json as the frozen lane-isolation promise for that run | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/lane-boundary.test.mjs |
| `faff holdout` | translated | same as the `faff prdr draft` row: a Phase 2A reader treats the DoD-verdict line as part of the frozen PRDR record | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | prdr.js's inline prdrSelftest (lines 843-1489), whose FAFF-953 cases exercise setPrdrDodVerdict |
| `faff spec-judge-evidence` | translated | a Phase 2A reader treats a pre-cutover judge case file, ledger and admit result as frozen spec-review evidence for that work item | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/spec-judge-assemble-admit.test.mjs, test/spec-judge-evidence.test.mjs |
| `faff build-judge-evidence` | translated | same posture as the `faff spec-judge-evidence` row, for the build-review dialogue | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/build-judge-evidence.test.mjs |
| `faff judge-trail` | immutable-blob | the judgement trail is written once to `refs/faff/judge-trail/<run_id>` and never rewritten; a Phase 2A reader reads it verbatim | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/judge-trail.test.mjs |

#### Corrective and containment (7 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff corrective` | translated | a Phase 2A reader treats a pre-cutover corrective input as frozen; the RFC's amendment/correction rule (Phase 2A) governs new corrective facts after cutover | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/corrective.test.mjs |
| `faff integrity-digest` | translated | a Phase 2A reader treats the custody verdict as frozen tamper-detection evidence for that work item | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/integrity-digest.test.mjs |
| `faff andon` | translated | a Phase 2A reader treats the andon state as frozen per-run alert history | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/andon.test.mjs |
| `faff worktree-prune` | rebuildable-projection | the live-worktree set is itself a rebuildable projection of git state; pruning acts on that projection and creates no artifact to migrate; the governed bracket's records follow the `faff effects declare` row | (5) uncommitted workspace state excluded from completion claims | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | worktree-prune.js's inline worktreePruneSelftest (lines 255-266) |
| `faff contain` | translated | a Phase 2A reader treats a pre-cutover `containment-check` event as frozen scope evidence inside that run's journal | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/contain.test.mjs |
| `faff self-intake` | translated | same posture as the `faff contain` row, for the `self-intake-check` event | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/self-intake.test.mjs |
| `faff intake-record` | translated | a Phase 2A reader treats a pre-cutover provenance marker as a frozen front-door fact for that work item | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/intakecheck.test.mjs |

#### Product records (23 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff adr draft` | translated | a Phase 2A reader treats an ADR file as a frozen Software Delivery product record; ADR numbering stays a repo-local convention | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs, test/adr-l3.test.mjs, test/adr-slot.test.mjs |
| `faff adr accept` | translated | same as adr draft; acceptance is a distinct mutation kind on the same file | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs, test/adr-slot.test.mjs |
| `faff adr renumber` | translated | same as adr draft; renumbering rewrites the file's own identity, never another record's citation of it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs |
| `faff adr supersede` | translated | same as adr draft; a supersede mutation never rewrites the superseded ADR's decision text; it appends the status change and, when a superseded directory is configured, moves the file there (FAFF-1042, FAFF-1048) | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs |
| `faff prdr draft` | translated | a Phase 2A reader treats a PRDR file as a frozen product-requirements-decision record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs, test/prdr-loop-admit.test.mjs |
| `faff prdr accept` | translated | same as prdr draft; acceptance is a distinct mutation kind | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs |
| `faff prdr land` | translated | same as prdr draft; landing finalises the record for the shipped scope | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr-land-local.test.mjs |
| `faff prdr renumber` | translated | same as prdr draft; renumbering rewrites the file's own identity only | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs |
| `faff prd` | translated | a Phase 2A reader treats a PRD file as a frozen Software Delivery product record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prd.test.mjs |
| `faff decision-capture` | translated | a Phase 2A reader treats an exported decision-capture record as frozen instrumentation history for that run | none stated — no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/decision-capture.test.mjs |
| `per-issue spec file` | immutable-blob | a Phase 2A reader treats a committed spec file as a frozen work-item artifact reference | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the write path to characterise |
| `summary.md` | rebuildable-projection | a Phase 2A reader treats summary.md as a human-facing projection, rebuildable from the ledger/events rather than a canonical source | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the document's write path to characterise |
| `faff claim-verdict` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `claim-verdict` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff eligible` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `eligible` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap; no test spawns `faff eligible` with capture on; test/faff-1009-capture-wiring-lint.test.mjs checks the call site statically and test/decision-capture-wiring.test.mjs drives the `record` verb, not the kernel |
| `faff next` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `next` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-989-decision-capture-driver.test.mjs |
| `faff park-verdict` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `park-verdict` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff project-next` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `project-next` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff queue-state` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `queue-state` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff run-done` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `run-done` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff run-outward` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `run-outward` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff run-start` | translated | same posture as the `faff decision-capture` row: a Phase 2A reader treats an in-kernel `run-start` capture record as frozen instrumentation history for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-1009-decision-capture-tier-wiring.test.mjs |
| `faff shadow-fidelity` | immutable-blob | a committed report directory (corpus, manifest, result) is banked evidence; a Phase 2A reader reproduces it, never rewrites it, and a new result gets its own directory | (1) durably-published facts and artifacts | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/shadow-fidelity.test.mjs |
| `faff ratified-scope` | translated | the folded subsection becomes part of the spec it was folded into; a Phase 2A reader treats it as that spec's frozen text | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/ratified-scope.test.mjs |

#### Harness orchestration and anchors (20 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff config` | translated | a Phase 2A reader treats .faffrc.yaml as the compatibility-facade config source; new domain-binding config uses the typed registry instead | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/config-set.test.mjs, test/config-defaults.test.mjs, test/config-two-file.test.mjs |
| `faff sync` | rebuildable-projection | the linked skill/CLI install is itself a rebuildable projection of the repo; re-running sync is the compatibility path, not a migration | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sync.test.mjs, test/link-skills-worktree.test.mjs |
| `faff hooks-ensure` | translated | a Phase 2A reader treats the registered hook set as harness configuration, translated into whatever hook mechanism the target harness exposes | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/hooks-ensure.test.mjs |
| `faff gitignore-ensure` | translated | a Phase 2A reader has no dependency on this row; it is repo hygiene, not a governance or delivery record | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gitignore-ensure.js's inline gitignoreEnsureSelftest (lines 125-261) |
| `faff fixtures` | immutable-blob | a generated dataset manifest is a point-in-time snapshot; a Phase 2A reader treats it as an immutable eval-harness input, never mutated in place | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/fixtures.test.mjs |
| `faff env` | immutable-blob | generated compose material is a point-in-time infra artifact; a Phase 2A execution-infrastructure adapter regenerates it rather than migrating it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/env.test.mjs |
| `faff bundle` | immutable-blob | the Phase 0 recovery bundle is explicitly "a replica and recovery input. It is not a new journal" (TECHNICAL-DESIGN, Phase 0) — never migrated, only ever superseded by a fresher publish | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 1 (additive recovery publication disables without changing current canonical files); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/bundle.test.mjs |
| `faff bundle-recover` | immutable-blob | recovery reconstructs current-format projections from the immutable bundle; it never mints a generic-format record | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 1 (additive recovery publication disables without changing current canonical files); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle-recover.js's inline bundleRecoverSelftest (lines 634-913) |
| `anchor: events` | immutable-blob | TECHNICAL-DESIGN-v5.md already lists `.faff/anchors/...` as "Immutable historical evidence; future artifact mapping required" | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/events-chain.test.mjs |
| `anchor: ledger` | immutable-blob | same posture as the events anchor row | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs |
| `anchor: effects` | immutable-blob | same posture as the events anchor row; only minted when a declared-effects.jsonl is present (FAFF-621), and it then carries the `schema:3` records that chain into that file alongside the `schema:2` ones | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/effects-chain.test.mjs |
| `anchor: floor-evidence` | immutable-blob | ac-checklist.json/review-verdict.json/spec-review-verdict.json/holdout.json/build-progress.json/landing-progress.json ride the anchor's generic byte-copy loop verbatim, and commissaire/producer/pk.json is copied through an allowlist (never governor.json); `faff events anchor` refuses `floor-incomplete` when ac-checklist.json or review-verdict.json is absent (FAFF-1155) | (1) durably-published facts and artifacts; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/events-anchor-genesis-guard.test.mjs |
| `tracker: status transition` | rebuildable-projection | `TECHNICAL-DESIGN-v5.md`'s "Current records and artifacts" table says tracker state "Remains a projection and command surface"; a Phase 2A reader rebuilds it from the tracker API rather than migrating a record | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap; no module owns the write path to characterise |
| `tracker: comment` | rebuildable-projection | same posture as the status-transition row; a comment is a projection artifact, not canonical state | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — landing-comment.js's own tests cover renderBody's TEXT, not the posting mechanism, which lives outside this repo (the GH Action's own `gh pr comment` step) |
| `tracker: label` | rebuildable-projection | same posture as the status-transition row | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — label.js's own tests cover labelOp's descriptor logic, not the executed MCP write, which is outside this repo |
| `tracker: relation` | rebuildable-projection | same posture as the status-transition row | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the write path to characterise |
| `faff engine` | translated | same posture as the `faff budget` row: a metered engine call is one more frozen spend line for that run | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/engine-call.test.mjs |
| `faff conventions` | rebuildable-projection | the cache is re-derived from the repository's own docs and history on a fingerprint miss; a Phase 2A reader regenerates it rather than migrating it | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/conventions-cache.test.mjs |
| `faff native-map` | translated | a Phase 2A tracker adapter reads the committed .faff-templates/native-templates.yaml as tracker-connector configuration | none stated; no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/native-map.test.mjs |
| `faff worktree-heal` | rebuildable-projection | worktree admin metadata is a projection of git state; healing rebuilds it and creates no artifact to migrate | (5) uncommitted workspace state excluded from completion claims | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/worktree-heal.test.mjs |

#### Commissaire facade (9 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff commissaire contract admit` | translated | a Phase 2A reader treats a pre-cutover admission record (producer, `contract_revision`, admitted scope) as the frozen admission decision for that run; re-admitting under `--force` rotates the key material and orphans records signed under the old material | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/commissaire-admit-required.test.mjs |
| `commissaire key material` | immutable-blob | the governor and producer key files under `<run-dir>/commissaire/` are read verbatim for the run they were minted in; the public key alone travels in the anchor | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs |
| `faff commissaire effect declare` | translated | `schema:3` records chain into the same declared-effects.jsonl as `schema:2`, under the same lock (`commissaire.js` `LEDGER_CFG`); a Phase 2A reader treats a pre-cutover `schema:3` declare as frozen effect-intent history; which schema is canonical per record kind is addendum decision 2, not settled here | (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/commissaire-standalone.test.mjs |
| `faff commissaire effect authorize` | translated | a Phase 2A reader treats a pre-cutover signed grant or deny as the frozen decision for that effect; the same declared-effects.jsonl chain as the declare row | (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/pr-create-chokepoint.test.mjs |
| `faff commissaire effect observe` | translated | same artifact and reader posture as the `faff commissaire effect declare` row; observation is a distinct entry kind on the same chain | (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/commissaire-standalone.test.mjs |
| `faff commissaire verdict conclude` | translated | a Phase 2A reader treats a pre-cutover `accepted_under_contract` record as the frozen Phase 2A-depth terminal verdict for that work item (admission scope only; no obligations, independence, waivers or seal) | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/commissaire-standalone.test.mjs |
| `faff commissaire audit seal` | immutable-blob | the sealed run-close bundle is write-once (tmp then renameSync) and never migrated, only superseded by a fresher seal, the same posture as the `faff bundle` row | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 1 (additive recovery publication disables without changing current canonical files); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs, test/commissaire-standalone.test.mjs |
| `faff commissaire audit export` | rebuildable-projection | an export is a copy of a sealed bundle into an operator-chosen, empty `--dest`; it is regenerated from the seal, never migrated | none stated; no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/commissaire.test.mjs |
| `governance-required.json` | translated | a Phase 2A reader treats a pre-cutover sentinel as the frozen fact that the run was governance-required, so its merges fail closed without a grant | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1; no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap; test/commissaire-admit-required.test.mjs covers the `admit-required` verdict the prose acts on, not the prose-side write, which no module owns |

### Assurance table

#### Run record (12 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `run-ledger.json` | J-C | heartbeat.js's own banner ("NONE directly — every production mutation goes through mutateLedgerUnderLock") plus the lock-serialised read-hash-mutate-write cycle in mutateLedgerUnderLock (heartbeat.js) excludes a conflicting concurrent writer from the authoritative file | n/a | n/a — the ledger is a record stream, not itself a protected external effect |
| `faff heartbeat` | J-B | heartbeat.js's own banner: "the single sanctioned write path for run liveness" — one authenticating writer (the run's own process) via atomic tmp-plus-rename | n/a | n/a — liveness is a stream fact, not a protected external effect |
| `faff inflightcheck` | J-D | the marker records the writer's own claim with no independent verification of a conflicting writer | n/a | n/a |
| `faff resumecheck` | J-C | the release applies under the same lock-serialised owner-epoch fence as every other run-ledger.json mutation (heartbeat.js :: mutateLedgerUnderLock) | n/a | n/a |
| `faff sentry` | J-C | the kill-switch mark lands on run-ledger.json under the same mutateLedgerUnderLock chokepoint as the run-ledger.json row; cmdSentry separately best-effort appends a warning section to a caller-supplied --summary-md path (not a fixed log) when that flag is passed | E-C | sentry.js is "the hard kill-switch" — it detects derailment and aborts after the fact (detection, not prevention), matching E-C: "supports detection and reconciliation" |
| `faff sentry-poller` | J-D | the poller records its own tick state with no independent producer-binding check | E-C | sentry-poller.js "acts on abort for any UNATTENDED run" — the same detection-then-abort posture as sentry.js |
| `faff lights-out` | J-B | claimRunDir mints a fresh run directory that only its own minting process holds before the ledger exists | n/a | n/a |
| `faff run-ledger` | J-C | same lock-serialised chokepoint as the run-ledger.json row | n/a | n/a |
| `faff run-record-prd` | J-C | same lock-serialised chokepoint as the run-ledger.json row | n/a | n/a |
| `faff machine-id` | J-D | the id is self-declared by the host process with no independent verification of a competing host | n/a | n/a |
| `faff budget` | J-D | each spend line is self-reported by the calling process with no independent metering | n/a | n/a: a spend record and a budget outcome are record facts, not protected external effects |
| `faff events` | J-C | appendRecordsUnderLock (events.js) is a lock-serialised, hash-linked append; a conflicting concurrent producer cannot land a record without breaking the chain | n/a | n/a: the journal records effects, it is not itself one |

#### Effects (6 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff effects declare` | J-C | appendRecordsUnderLock (events.js) is a lock-serialised, hash-linked append; a conflicting concurrent producer cannot land a record without breaking the chain | E-C | the FAFF-825 spec's Effect invariant family: "declare before acting"; `effects check` computes observed minus declared; detection and reconciliation, never prevention |
| `faff effects observe` | J-C | same chained-append mechanism as the declare row | E-C | an observation record is the detection half of the declare/observe pair; it never prevents an effect, only evidences it |
| `effects-chain-head.json` | J-C | computeChainHead is a pure hash fold over the chained declared-effects.jsonl bytes — it can only reproduce a head that matches the actual chain | n/a | n/a — the witness certifies the journal, it is not itself an effect |
| `faff review-progress` | J-D | the checkpoint records the writer's own claim atomically (mkdir/write/rename) with no independent producer check | n/a | n/a |
| `faff build-progress` | J-D | same atomic self-claimed checkpoint mechanism as review-progress | n/a | n/a |
| `faff landing-progress` | J-D | same atomic self-claimed checkpoint mechanism as review-progress/build-progress | n/a | n/a |

#### Gates and merge (17 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff merge-gate` | J-C | writeMergeRecord is called only after re-observing CI on the resolved head sha inside the impure shell around the pure decideFloor core | E-B | merge-gate.js's banner names it "the SOLE sanctioned `gh pr merge` path", and merge-fence.js denies a raw merge call: a single route to the protected merge effect, matching E-B's prevention posture. On a governed run the chokepoint also verifies an Ed25519-signed grant (merge-gate.js :: resolveCommissaireDecisionGrant wraps resolveGrantByEffectKind, which calls commissaire.js :: chokepointPermit) and fails closed with no covering verdict; the E-B grade rests on the sole-path mediation, unchanged from `174f62b7`, not on the grant; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence |
| `faff ci-triage flaky-register` | J-D | self-declared classification with no independent verification | n/a | n/a |
| `faff ci-triage verdict` | J-D | self-declared verdict with no independent verification | n/a | n/a |
| `faff post-merge-check` | J-C | verifyPostMerge re-reads the actual merged sha before writePostMergeVerification records the outcome | E-C | post-merge verification is detection-after-the-fact over an already-completed merge, never a gate on the merge itself |
| `faff governance-check ledger` | J-D | an appended self-declared line with no independent producer-binding check | n/a | n/a — this row is the audit-log append, not the floor-artifact write below |
| `faff governance-check floor` | J-D | the floor files are written from the harness-independent CI binding's own inputs with no independent verification of the underlying review | n/a | n/a |
| `faff build-claim` | J-B | a non-force `git push <sha>:<ref>` is a compare-and-swap the git remote enforces server-side — exactly one racing pusher wins, giving the ref a single authenticating writer at any moment | n/a | n/a — a claim gates who MAY act, it is not itself a protected external effect |
| `faff landing-claim` | J-B | same git-ref compare-and-swap mechanism as build-claim | n/a | n/a |
| `holdout.json` | J-C | evaluate-call.mjs is "the code-blind holdout evaluator SPAWNER" whose FAFF-384 contract ratchet (`faff contract holdout-verdict --require-spawner-attested`) rejects an inner code_blind:true claim that is not spawner-attested — a producer-binding check, not a self-declaration. NAMED GAP: the sweep did not establish whether/how this spawner-attested `.faff/holdout/<key>.json` reaches the per-run `<run-dir>/<issue>/holdout.json` merge-floor path governance-check.js/merge-gate.js read — no bin/lib module was found performing that copy, so the join between the two paths is itself an open finding | n/a | n/a |
| `faff spec-review-pin` | J-D | self-declared pin with no independent verification of the reviewer identity | n/a | n/a |
| `faff spec-review-window` | J-D | self-declared window start with no independent verification | n/a | n/a |
| `faff pr-create` | J-C | the `schema:2` pair lands through appendRecordsUnderLock (events.js), the same hash-linked chain as the `faff effects declare` row | E-D | on a governed run the chokepoint refuses unless merge-gate.js :: resolvePrCreateGrant -> resolveGrantByEffectKind -> commissaire.js :: chokepointPermit verifies an Ed25519-signed grant, and fails closed with no covering verdict; graded E-D against the orchestrator because the grant is minted and checked in the same runner process and, unlike the merge, no PreToolUse fence denies a raw `gh pr create`; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence |
| `faff lane-boundary` | J-D | the dispatcher self-declares the isolation it intends; emitLaneBoundary validates the shape (computeLaneBoundary) but nothing verifies the lane actually ran inside that boundary | n/a | n/a: a declared boundary is a promise record, not an effect |
| `faff holdout` | J-D | the persisted verdict line is written from an already-validated holdout verdict with no independent re-verification at write time | n/a | n/a |
| `faff spec-judge-evidence` | J-D | the case files and ledger are self-written by the assembling process; mode 0600 limits readers but does not bind the producer | n/a | n/a |
| `faff build-judge-evidence` | J-D | same self-written case file and ledger mechanism as the `faff spec-judge-evidence` row | n/a | n/a |
| `faff judge-trail` | J-B | mint is write-once: an existing ref is a no-op, and under `git-remote` a non-force push is a compare-and-swap the remote enforces, the same mechanism as the `faff build-claim` row | n/a | n/a: an evidence ref, not a protected effect |

#### Corrective and containment (7 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff corrective` | J-D | the corrective author records a validated input with no independent verification of the author's authority beyond the CLI's own validation | n/a | n/a — corrective authority constrains a future dispatch, it does not itself act |
| `faff integrity-digest` | J-C | atomicWriteVerdictBytes records a digest fold over the custody-tracked file set (corrective-integrity.js :: correctiveIntegrityDirs) — a tamper leaves a detectable mismatch | n/a | n/a |
| `faff andon` | J-D | self-declared alert state with no independent verification | E-D | a push notification is a genuine external effect (an outbound alert); andon.js records only its own self-attestation that the notification was sent, matching E-D |
| `faff worktree-prune` | n/a | n/a: no relied-on record stream results from a prune; the governed bracket's records are graded on the `faff effects declare` row | E-D | deleting a worktree is an irreversible-to-that-copy external effect; the module self-attests ownership before deleting (worktreeAdminIds/ownMatches) with no independent verification; the governed declare/observe pair adds detection evidence, not prevention |
| `faff contain` | J-C | the event lands through the same hash-linked chained append as the `faff events` row | n/a | n/a: a recorded verdict, not an effect |
| `faff self-intake` | J-C | the event lands through the same hash-linked chained append as the `faff events` row | n/a | n/a: a recorded verdict, not an effect |
| `faff intake-record` | J-D | the marker is self-declared by the recording process with no independent verification | n/a | n/a |

#### Product records (23 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff adr draft` | J-D | an ADR draft is authored content with no independent producer-binding check beyond the CLI's own validation; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `file-write`, step `file-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one (FAFF-1119) | n/a | n/a |
| `faff adr accept` | J-D | self-declared acceptance with no independent verification; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `file-write`, step `file-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one (FAFF-1119) | n/a | n/a |
| `faff adr renumber` | J-D | self-declared renumbering with no independent verification; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `file-write`, step `file-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one (FAFF-1119) | n/a | n/a |
| `faff adr supersede` | J-D | self-declared supersession with no independent verification; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `file-write`, step `file-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one (FAFF-1119) | n/a | n/a |
| `faff prdr draft` | J-D | authored content with no independent producer-binding check; no governed bracket at `475c0362`: faff-graft's prose brackets ADR and decisions-register commits only, never a PRDR write (FAFF-1119 scoped it so) | n/a | n/a |
| `faff prdr accept` | J-D | self-declared acceptance with no independent verification; no governed bracket at `475c0362`: faff-graft's prose brackets ADR and decisions-register commits only, never a PRDR write (FAFF-1119 scoped it so) | n/a | n/a |
| `faff prdr land` | J-D | self-declared landing with no independent verification; no governed bracket at `475c0362`: faff-graft's prose brackets ADR and decisions-register commits only, never a PRDR write (FAFF-1119 scoped it so) | n/a | n/a |
| `faff prdr renumber` | J-D | self-declared renumbering with no independent verification; no governed bracket at `475c0362`: faff-graft's prose brackets ADR and decisions-register commits only, never a PRDR write (FAFF-1119 scoped it so) | n/a | n/a |
| `faff prd` | J-D | authored content with no independent producer-binding check | n/a | n/a |
| `faff decision-capture` | J-D | self-declared instrumentation export with no independent verification | n/a | n/a — read-only instrumentation causes no effect |
| `per-issue spec file` | J-D | SINGLE-WRITER FINDING: no `faff` command mints or attaches a spec file; the faff-prep skill's agent turn writes it directly with the Write tool and faff-graft commits it — there is no bin/lib canonical writer to name | n/a | n/a |
| `summary.md` | n/a | n/a — TECHNICAL-DESIGN-v5.md's own "Current records and artifacts" table already names the main writer as "Orchestrator" (faff-beep-boop prose), not a CLI module; sentry.js's --summary-md append is best-effort and opt-in (only when a caller passes the flag), never the document's mint; park-history.js parses the fenced JSON block back out but never writes it | n/a | n/a |
| `faff claim-verdict` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff eligible` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff next` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff park-verdict` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff project-next` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff queue-state` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff run-done` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff run-outward` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff run-start` | J-D | an appended capture record states its own kernel, inputs and verdict with no independent verification of the producer | n/a | n/a: read-only instrumentation causes no effect |
| `faff shadow-fidelity` | J-D | the report is self-written by the analysing process; the manifest's corpus_sha256 lets a reader detect a changed corpus but does not bind the producer | n/a | n/a: a read-only study causes no effect |
| `faff ratified-scope` | J-D | the module's own banner calls it "a well-formedness" check, not an authenticity gate; the folded text is cited, never verified | n/a | n/a |

#### Harness orchestration and anchors (20 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff config` | J-D | a local config write with no independent verification of a competing writer | n/a | n/a |
| `faff sync` | n/a | n/a — an install-time symlink action, not a relied-on record stream | E-D | SWEEP LIMITATION: the actual mkdir/symlink write happens inside scripts/link-skills.sh, a shelled bash script outside this repo's .js AST — cmdSync self-attests success from the child process's exit code with no independent verification of the resulting filesystem state |
| `faff hooks-ensure` | J-D | an idempotent local config write with no independent verification | n/a | n/a |
| `faff gitignore-ensure` | n/a | n/a — not a relied-on record stream | n/a | n/a |
| `faff fixtures` | n/a | n/a — an eval-harness input, not a relied-on governance record | n/a | n/a |
| `faff env` | n/a | n/a | n/a | n/a |
| `faff bundle` | J-C | classifyBundle's fail-closed verdict ladder (VERIFICATION_UNAVAILABLE / MISSING / MALFORMED) rejects a bundle whose manifest digest does not match its members | n/a | n/a — a recovery replica, not itself a protected effect |
| `faff bundle-recover` | J-C | reconstructProjection only proceeds after bundle-recover.js's own manifest/digest verification (mirrors classifyBundle) | n/a | n/a |
| `anchor: events` | J-C | mintIssueAnchor byte-copies events.jsonl verbatim from the run dir into the anchor, preserving the same hash-linked chain | n/a | n/a |
| `anchor: ledger` | J-C | mintIssueAnchor byte-copies run-ledger.json verbatim (copyFileSync) rather than re-deriving it | n/a | n/a |
| `anchor: effects` | J-C | mintIssueAnchor byte-copies declared-effects.jsonl and computes its own effects-chain-head.json witness (computeChainHead) rather than accepting one from a caller | E-C | the anchored effects chain is the audit-time evidence merge-gate's requireWitness checks — a detection mechanism, not a preventive one |
| `anchor: floor-evidence` | J-D | each floor file is copied best-effort-present with no independent re-verification at copy time | n/a | n/a |
| `tracker: status transition` | n/a | n/a: project-next.js states explicitly it "NEVER reads or writes the tracker"; no bin/lib module composes a status-transition op descriptor. The governed `tracker-write` records are graded on the `faff effects declare` row, not here | E-D | a tracker status transition is a genuine external effect performed by the agent via its tracker MCP tool call; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `tracker-write`, step `tracker-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one (FAFF-1120). Faff-beep-boop's prose admits the `tracker-write` scope but brackets nothing itself. The achieved class stays self-attestation, E-D |
| `tracker: comment` | n/a | n/a | E-D | SINGLE-WRITER FINDING: landing-comment.js only composes ONE particular comment kind (ready-to-land); every other tracker comment (progress notes, park explanations) has no bin/lib composer at all and is written ad hoc in skill prose. The actual POST, for every comment kind including the ready-to-land one, is agent- or Action-side, self-attested, matching E-D. No governed bracket covers comments at `475c0362` |
| `tracker: label` | n/a | n/a: the governed `label-write` records are graded on the `faff effects declare` row | E-D | label.js validates the label against CONTROL_LABELS and computes idempotency, but "The single MCP write stays agent-side." per its own banner; on a governed run (governor material present), faff-graft's skill prose brackets this write with `faff effects declare` and `faff effects observe` (kind `label-write`, step `label-write`), so the agent appends a `schema:2` declare/observe pair to the run's declared-effects.jsonl through effects.js :: appendEffectEntries; record-only, and observed equals declared by construction, so the pair evidences the write but cannot catch an undeclared one. The achieved class stays self-attestation, E-D |
| `tracker: relation` | n/a | n/a: findings-reconcile.js's own banner: "It does NOT compute symptom similarity"; no bin/lib module composes a relation-mutation descriptor at all, a sharper gap than the label kind (which at least has a descriptor composer) | E-D | a tracker relation write (e.g. linking a finding to its fix) is performed by the agent directly via MCP with no CLI mediation and no self-attestation record at all; the weakest of the four tracker-mutation kinds; no governed bracket covers relations at `475c0362` |
| `faff engine` | J-D | the spend line is self-reported by the calling process | n/a | n/a: a one-shot model call returns text; it causes no protected effect of its own |
| `faff conventions` | n/a | n/a: a rebuildable local cache, not a relied-on record stream | n/a | n/a |
| `faff native-map` | J-D | a local, PR-reviewable config write with no independent verification of the writer | n/a | n/a |
| `faff worktree-heal` | n/a | n/a: no relied-on record stream results from a heal | E-D | rewriting git admin metadata and shelling `git worktree repair` mutates the local repository; worktree-heal.js :: verifyHeal re-reads the result, but the module self-attests the repair with no independent verification |

#### Commissaire facade (9 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff commissaire contract admit` | J-D | the admission record is Ed25519-signed by the governor key the same command mints; J-D graded against the orchestrator (the FAFF-825 weakest-provable rule): the record carries a producer HMAC (producer-auth.js :: signRecord) or a Commissaire Ed25519 signature (producer-auth.js :: signDecision) that a conflicting producer without the key material cannot forge, which would earn J-C against that producer; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | n/a | n/a: admission grants scope, it is not itself an effect |
| `commissaire key material` | n/a | n/a: key material is a credential, not a record stream; writeJson sets no file mode, so governor.json (the signing key and HMAC master) sits at the umask default inside the run directory; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | n/a | n/a |
| `faff commissaire effect declare` | J-D | appendRecordsUnderLock gives the same hash-linked chain as the `faff effects declare` row; J-D graded against the orchestrator (the FAFF-825 weakest-provable rule): the record carries a producer HMAC (producer-auth.js :: signRecord) or a Commissaire Ed25519 signature (producer-auth.js :: signDecision) that a conflicting producer without the key material cannot forge, which would earn J-C against that producer; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | E-C | declare before acting; `effect reconcile` computes observed minus declared (commissaire.js :: computeEscapes); detection and reconciliation, never prevention |
| `faff commissaire effect authorize` | J-D | the verdict record carries a Commissaire Ed25519 signature that commissaire.js :: chokepointPermit verifies before any merge or PR-open; J-D graded against the orchestrator (the FAFF-825 weakest-provable rule): the record carries a producer HMAC (producer-auth.js :: signRecord) or a Commissaire Ed25519 signature (producer-auth.js :: signDecision) that a conflicting producer without the key material cannot forge, which would earn J-C against that producer; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | E-D | the grant gates the merge and PR-open chokepoints only through merge-gate.js :: resolveGrantByEffectKind -> commissaire.js :: chokepointPermit, which fails closed on a governed run with no covering verdict; graded E-D against the orchestrator because the same runner mints and verifies the grant; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence |
| `faff commissaire effect observe` | J-D | same chained, HMAC-bound append as the declare row; J-D graded against the orchestrator (the FAFF-825 weakest-provable rule): the record carries a producer HMAC (producer-auth.js :: signRecord) or a Commissaire Ed25519 signature (producer-auth.js :: signDecision) that a conflicting producer without the key material cannot forge, which would earn J-C against that producer; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | E-C | an observation record is the detection half of the declare/observe pair; it never prevents an effect, only evidences it |
| `faff commissaire verdict conclude` | J-D | the verdict is Ed25519-signed by the governor and refused on no evidence, an unadmitted or revoked producer, an unreconciled escape, a key-fingerprint mismatch or an ambiguous contract revision; J-D graded against the orchestrator (the FAFF-825 weakest-provable rule): the record carries a producer HMAC (producer-auth.js :: signRecord) or a Commissaire Ed25519 signature (producer-auth.js :: signDecision) that a conflicting producer without the key material cannot forge, which would earn J-C against that producer; custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the facade gives author binding and mechanical mediation, not independence | n/a | n/a: a terminal verdict records acceptance, it is not itself an effect |
| `faff commissaire audit seal` | J-C | the manifest digest covers every member, and a reader re-verifies it (commissaire.js :: cmdAuditVerify), so a tampered member is detected; the members are themselves the J-D facade records above | n/a | n/a: a sealed replica, not a protected effect |
| `faff commissaire audit export` | J-C | the export carries the sealed manifest, so a reader re-verifies the same digest as the seal row | n/a | n/a |
| `governance-required.json` | J-D | the sentinel is a plain JSON file the orchestrating agent writes; nothing binds or verifies its producer | n/a | n/a: the sentinel arms a fail-closed reading at the merge chokepoint; the effect control it feeds is graded on the `faff merge-gate` and `faff pr-create` rows |

## Disposition-scope table

Three rows, per the spec. Each names the current vocabulary in code, its source line, its semantic owner, and its gap.

| Scope | Current vocabulary in code | Source | Semantic owner | Gap |
|---|---|---|---|---|
| Run segment | No populated vocabulary found. `resumecheck.js` and `lights-out.js` reason about run-segment lifecycle (fenced release, mint) procedurally, but no module declares a closed enum of run-segment states | none — checked `governance-profile.js`, `resumecheck.js`, `lights-out.js`; no `run_segment_states`-shaped list exists | commissaire-governance (the RFC's "Run-segment ID" identity row) | No current implementation. A run-segment's state is inferred from heartbeat + ledger facts at read time, never named as a closed vocabulary |
| Run membership | `DELIVERY_PROFILE.terminal_states` (8 values: `shipped`, `pr-open`, `parked`, `errored`, `routed-out`, `unreached-budget`, `superseded`, `parked-window`) and `ledger_outcomes` (9 values: the same 8 plus `claimed-by-peer`) | `governance-profile.js:67` (terminal_states) and `governance-profile.js:140` (ledger_outcomes). The module's own comment at `governance-profile.js:49` states the two keys "are DELIBERATELY two distinct keys, not one" [list; the clause completes on line 50: "unifying them would change what runcheck or events accepts"]; though that comment's own parenthetical counts (6, 7) are now stale against the live arrays (8, 9); the qualitative point still holds and is verified directly against the arrays, not the comment's numbers | software-delivery-policy (this is `faff`'s own delivery dialect, not a generic Commissaire vocabulary; see the `governance-profile.js` classification row's DISAGREES finding) | Fully populated and actively used; no gap in the vocabulary itself. The gap is scope: this vocabulary answers "how did this run's membership of one issue end", never "is the work item itself accepted" |
| Work item | One of the master RFC's four values now exists: `accepted_under_contract`, the `schema:3` record `faff commissaire verdict conclude` appends. No counterpart exists for `outcome_rejected`, `cancelled` or `abandoned`: `outcome_rejected` appears only in a comment saying a negative record is out of scope, and the `cancelled` and `abandoned` hits in `bin/lib` are CI conclusions, tracker statuses and a `run-claim-abandoned` event, none a work-item verdict | `commissaire.js:941` (`kind_of_entry: "accepted_under_contract", unit_id: issue, step: "conclude",`) inside `commissaire.js :: cmdTerminalVerdict` (declared at `commissaire.js:869`); `commissaire.js:854` ("a negative `outcome_rejected` record is out of scope") | commissaire-governance (the RFC's responsibility table gives Commissaire "terminal conformance") | **Partial, at the Phase 2A depth the addendum ratifies.** `verdict conclude` refuses on no evidence, an unadmitted or revoked producer, an unreconciled escape, a key-fingerprint mismatch and an ambiguous contract revision, and a refusal writes nothing. Admission is scope-only; evidence obligations, independence, waivers and the seal are not modelled; and the three negative terminal states have no record at all |

`disposition.js` adds a third, run-SCOPED (not run-membership-scoped) split: its own banner (`disposition.js:13`) reads "needs-attention, never as clean"; a whole-run audit verdict, narrower than either row above and not itself a fourth disposition scope in the RFC's sense (it answers "does a human need to look at this run", not "what is this membership's or this work item's terminal state").

## The eight invariant families: current mechanisms

Reproduced from the spec, re-verified by reading the named modules at `475c0362`. Two rows changed since `174f62b7` (Merge and Effect); the Amendment row's verdict is restated against a fourth candidate below.

| Family | Current mechanism | Module |
|---|---|---|
| Queue | Pure `queue_empty` / `all_parked` derived from durable gitkeys diffed against ledger `outcomes{}` | `queue-state.js` |
| Termination | Fixed safety floor plus the policy-weighted rung ladder to run-complete, continue, or escalate | `run-done.js` |
| Budget | Four-dimension envelope (until, max_attempts, tokens, cost) with at-ceiling outcomes stop, narrow, escalate; plus `parked-window` for a `budget.window` breach | `budget.js`, `governance-profile.js` |
| Liveness | Sole sanctioned write path to `.faff/runs/<run-id>/heartbeat` via tmp-plus-rename; staleness threshold shared with sentry. A read-only reconstruct-and-preview verb adds no liveness machinery of its own — the write-once claim belongs at the continuation boundary, not the read-only verb | `heartbeat.js`, `sentry.js` |
| Gate | Review, holdout, and merge gates; slot contracts validated by the schema-subset engine | `gates.js`, `contract-engine.js` |
| Merge | Pure `decideFloor` core (in `contract-defs.js`) plus an impure shell that re-observes CI on the resolved head sha; the sole sanctioned `gh pr merge` path. On a governed run the floor gains a `schema:3` grant leg: the chokepoint verifies an Ed25519-signed Commissaire grant (`merge-gate.js :: resolveCommissaireDecisionGrant` -> `resolveGrantByEffectKind` -> `commissaire.js :: chokepointPermit`) and fails closed with no covering verdict (FAFF-828, FAFF-1034); a `--delete-branch` merge needs a grant covering both effects. Custody caveat: for faff's own runs the runner holds `SK_commissaire` and the HMAC master, so the grant gives author binding and mechanical mediation, not independence | `merge-gate.js`, `contract-defs.js`, `commissaire.js` |
| Effect | `declared-effects.jsonl` chain, declare before acting, `check` computes observed minus declared; detection only for every effect kind except two: on a governed run the merge and PR-open chokepoints refuse to act without a covering grant (FAFF-1034, FAFF-1118), and a run carrying the governance-required sentinel (`<run-dir>/commissaire/governance-required.json`, FAFF-1140) is treated as governed even before any `schema:3` record exists. The push, label, file-write, tracker-write and worktree-prune records added by FAFF-1118 to 1120 stay record-only | `effects.js`, `merge-gate.js`, `commissaire.js` |
| Amendment | **No current mechanism satisfies both clauses** (established below against four candidates, not merely asserted); `commissaire.js`'s admission supplies the admission-decision half | none |

### Amendment surface investigation

Four candidates were checked, each carrying part of the shape the master RFC's rule describes ("A material change creates a new immutable contract revision and a new admission decision"). The first three were checked at `174f62b7` and re-checked at `475c0362`; the fourth is new.

**`corrective.js`.** Quote (`corrective.js:468`): *"Collision-safe naming: derive the next seq from the HIGHEST existing numeric"* [the rule continues onto lines 469-470: never a bare directory-listing COUNT, since a deleted/compacted earlier artifact would make a count-based seq collide with a survivor]. Reading: each corrective author call mints a new, immutably-numbered input file; a revision-SHAPED fact; but `foldCorrectiveConstraints` (`corrective.js:154`) and `foldCorrectiveAuthority` (`corrective.js:253`) then automatically FOLD the cumulative set into a mandate with no accept/reject step. Verdict on this surface: it supplies the "new immutable revision" half of the RFC's rule, but not "a new admission decision" half; a partial match, not the mechanism.

**`contract-defs.js`.** Quote (`contract-defs.js:988-990`): *"let version = extraction.version; if (!Number.isInteger(version) \|\| version < 1) { violations.push(\`version ${JSON.stringify(version)} is not an integer >= 1\`);"* [three physical lines joined: `let version = extraction.version;` on 988, the `if` on 989, the `violations.push` on 990]. Reading: `version` here is a well-formedness constraint on the SHAPE of one submitted lane-boundary-intent document (must be an integer ≥ 1), not an identity that increments across successive amendments of the same contract. There is no revision HISTORY here, only a per-submission current-shape check. Verdict: no revision identity exists on this surface.

**`ratified-scope.js`.** Quote (`ratified-scope.js:9`): *"It never parses the meaning of what it copies; it only cites it."* Quote (`ratified-scope.js:10`): *"This is a well-formedness"* [check, NOT an authenticity gate; the clause completes on line 11]. Reading: this module is a meaning-blind composer with no revision concept of any kind; confirming, on its own text, the spec's own hint that this candidate reads "on the face of it, no." (Since FAFF-998 it also appends a cited "Ratified resolutions" subsection under `--fold-resolutions --into`; that write adds no revision identity.)

**`commissaire.js` (new at `475c0362`).** Quote (`commissaire.js:612`): *"const contractRevision = strFlag(flags, "--contract-revision");"*. Quote (`commissaire.js:629`): *"re-admitting mints a new keypair + master and orphans every record signed under the old material"*. Quote (`commissaire.js:936`): *"return refuseVerdict("ambiguous-contract-revision", issue, { contract_revisions: revs.slice().sort() });"*. Reading: `contract admit` records an Ed25519-signed admission naming the producer, its admitted scope and a `contract_revision`; a real admission decision with a revision identity, and `verdict conclude` refuses when one work item's evidence spans more than one revision. But the revision is a caller-supplied label with no terms behind it (the CLI requires it to be present and validates nothing else), and a second admission of the same producer is refused unless `--force`, which rotates the key material and orphans every record signed under the old material rather than linking a new decision to the old one. Verdict on this surface: it supplies the "new admission decision" half, plus a revision label, but not "a new immutable contract revision" a material change creates.

**Verdict, owned by Commissaire as a Phase 2A finding:** no current mechanism satisfies the RFC's amendment rule. `corrective.js` has the immutability half and `commissaire.js` has the admission-decision half, but no surface joins them: nothing mints an immutable revision of contract terms on a material change and admits it as a successor to the prior one. This is the conclusion of checking all four surfaces against the rule's own two clauses ("new immutable contract revision" AND "new admission decision"). It is a judgement call beyond copied facts and is listed for the FAFF-827 sitter in "Changes since 174f62b7".

## The work-item terminal-verdict scope

The codebase carries one fully populated disposition vocabulary and it is run-membership scoped (`DELIVERY_PROFILE.terminal_states` / `ledger_outcomes`, both in `governance-profile.js`, detailed in the disposition-scope table above). `disposition.js` adds a third, run-scoped clean/needs-attention split. Since `174f62b7`, `commissaire.js :: cmdTerminalVerdict` (`faff commissaire verdict conclude`, FAFF-1000 and FAFF-1008) appends a Commissaire-signed `schema:3` `accepted_under_contract` record, the first code counterpart of the master RFC's work-item terminal verdict (`commissaire.js:941`).

This map records the work-item terminal-verdict scope as **owned by Commissaire**, per the master RFC's responsibility table, which gives Commissaire "terminal conformance", with the entry **"partial: one of four states, at the Phase 2A depth"**. The master RFC's four-state vocabulary is `accepted_under_contract | outcome_rejected | cancelled | abandoned`. The code has the first; the other three have no record. Per `ADDENDUM-1-v5.md` (ratified as the Phase 2A depth), admission is scope-only, and evidence obligations, independence, waivers and the seal precondition are not modelled; `verdict conclude` refuses rather than writing a negative record. This revision adds nothing to `governance-profile.js` or any other module.

**Named unknown, carried forward rather than settled here:** the `accepted_under_contract` record lives in the Commissaire-owned `commissaire.js` and the `schema:3` stream, not in `governance-profile.js`, which settles where the positive state landed. Where the three negative states belong, and whether a work-item vocabulary should ever sit beside `governance-profile.js`'s two deliberately-unseparated keys, is still a placement decision this map does not make.

The three scopes (run-segment, run-membership, work-item) are therefore not conflated by accident today: the run-segment scope is not modelled in code, the work-item scope is modelled for one of four states, and this map's job, per the spec, is to say so plainly rather than to fill the gap.

## Gaps and named findings

Consolidated here for a reader who wants the punch list without re-deriving it from the tables above. Every item below is also stated on its own row where it applies.

**The banked FAFF-826 result reproduces only against the map revision it was produced under.** `shadow-fidelity.js :: readMapDecisionKernelCommands` parses this live map on every run, and `faff shadow-fidelity reproduce` compares the recomputed corpus-derived outputs (including the set-aside list derived from this map) with the banked `verification/reports/FAFF-826-coordination-fidelity/result.json`. This revision honestly classifies `park-reconsider` and `shadow-fidelity` as `decision-kernel` (see "Changes since 174f62b7"), which adds both to the set-aside list, so at `475c0362` plus this revision `faff shadow-fidelity reproduce --dir verification/reports/FAFF-826-coordination-fidelity --root .` exits 1, while `--root test/fixtures/faff-826-map-root` exits 0 (that fixture root holds a byte copy of the `174f62b7` revision, sha256 `7a21e429b7e143023c6ea9ca0ac30e70099f5a777e8ef53d1ad37b29daba3389`). Until `reproduce` pins the map revision itself, operators reproduce the FAFF-826 result with `--root test/fixtures/faff-826-map-root`, and `test/shadow-fidelity.test.mjs` does the same. The banked `verification/reports/FAFF-826-coordination-fidelity/report.md` and `protocol.md` still show the reproduce command without `--root`, which now exits 1; they are banked evidence and stay unedited (rollback rule 7). A second test case in that file parses this live map and asserts its decision-kernel set, so a later bucket change still fails CI in view of review; `resolveMapCommands` would otherwise fail open (an unreadable map yields an empty set, not an error). The comment above `MAP_DK` in `shadow-fidelity.js :: shadowFidelitySelftest` still says the live map classifies "(twelve)" decision-kernel commands; at this revision it classifies fourteen. **Follow-up (a `bin/lib` change, outside this revision):** make `faff shadow-fidelity reproduce` pin the map revision a result was produced under; record the map digest in `manifest.json` at `run` time and verify it at `reproduce` time; related to FAFF-826, FAFF-974 and FAFF-1174. It is recorded as discovered scope of FAFF-1162 for filing in the "Orchestration fidelity is measured before authority moves" project.

**Facts the `174f62b7` revision recorded wrongly, corrected here.**

- `faff lane-boundary emit` writes `<run-dir>/lane-boundary.json` (`lane-boundary.js :: emitLaneBoundary`, unchanged since `174f62b7`). The `174f62b7` sweep's own seed matched `lane-boundary.js`, but the file was missing from its swept list, and the row said `no durable write`.
- The `174f62b7` closure reported exactly one closure addition (`resumecheck.js`). A fixed-point closure at `174f62b7` reaches seven files; three of them are real writes the classification missed (`contain --record` and `self-intake --record` append events, and `engine call` meters spend), and three are not (`reconcile-recover.js`, `state.js` and `supervisor.js`, resolved in "The write-site sweep").
- `budget`, `events` and `intake-record` were classified state-changing but had no ownership, migration and assurance rows.
- Citations that did not resolve at `174f62b7` either: `config.js :: findConfig` (declared in `shared-infra.js`, only imported by `config.js`); the merge-gate banner quote (the source reads "the SOLE sanctioned `gh pr merge` path"); a `label.js` banner quote that spans two physical lines (replaced by the single-line "The single MCP write stays agent-side."); the line 138 given for `corrective.js`'s fold functions (they start at lines 154 and 253); and the end line of every inline-selftest range, each now re-derived at `475c0362`.

**No canonical writer found in `bin/lib` (5 rows).**

- `per-issue spec file` (`records/specs/*.md`): no `faff` command mints or attaches a spec file. `faff-prep`'s agent turn writes it directly and `faff-graft` commits it; there is no CLI mediation to name.
- `summary.md`: `TECHNICAL-DESIGN-v5.md` already names the writer as "Orchestrator" (`faff-beep-boop` prose), not a CLI module. `sentry.js :: cmdSentry` can best-effort append a warning SECTION via a caller-supplied `--summary-md` flag, but never mints or owns the document.
- `tracker: status transition`: `project-next.js` states explicitly it "NEVER reads or writes the tracker"; no `bin/lib` module composes even an op descriptor for this mutation kind (contrast with `label`, below, which at least has one). On a governed run faff-graft's prose now records the transition as a `tracker-write` declare/observe pair (FAFF-1120), which evidences the write but does not perform it.
- `tracker: relation`: `findings-reconcile.js` computes candidate relations but, per its own banner, "It does NOT compute symptom similarity"; no module composes a relation-mutation descriptor at all.
- `governance-required.json`: the sentinel the merge and PR-open chokepoints read to fail closed on a governance-required run (FAFF-1140) is written only by faff-beep-boop's skill prose; `merge-gate.js :: governanceRequiredSentinelPresent` reads it, and no module writes or validates its producer.

**Composer exists, but the actual write is agent-side (2 rows, a milder version of the same gap).**

- `tracker: label`: `label.js :: labelOp` composes and validates the op descriptor; its own banner states "The single MCP write stays agent-side." On a governed run faff-graft's prose records the write as a `label-write` declare/observe pair (FAFF-1119).
- `tracker: comment`: `landing-comment.js :: renderBody` composes ONE particular comment (ready-to-land); its own banner states it "NEVER merges" and does not post. Every other tracker comment kind has no composer at all, and no governed bracket covers comments.

**Governed records are prose-driven and uneven.** FAFF-1118 to 1120 added the `push` and `pr-create` effect kinds and governed brackets for push, label, file-write, tracker-write and worktree-prune. At `475c0362` the brackets live in faff-graft's skill prose (and, for worktree-prune, in `worktree-prune.js` under `--run-dir`); faff-beep-boop's prose admits the run with the matching scope but brackets nothing itself, and no bracket covers a PRDR write. Every bracketed record is written by the same agent that performs the effect, so observed equals declared by construction: the records evidence a declared write and cannot catch an undeclared one.

**Custody and mediation gaps on the Commissaire facade.**

- For faff's own runs the runner holds `SK_commissaire` and the HMAC master (`<run-dir>/commissaire/governor/governor.json`), so the facade gives author binding and mechanical mediation, not independence. Every class cell graded on the Ed25519 grant is graded against the orchestrator and says so.
- `commissaire.js :: writeJson` sets no file mode, so `governor.json` sits at the umask default.
- `merge-gate.js :: resolveGrantByEffectKind` reads both the public key and its pinned fingerprint from the same `pk.json`, so the fingerprint pin checks that file against itself.
- `faff pr-create` is the sanctioned PR-open path, but no PreToolUse fence denies a raw `gh pr create` the way `merge-fence.js` denies a raw merge, so its effect class is E-D where the merge's is E-B.
- `merge-gate.js :: boundedRebaseOntoMain` (FAFF-1077) force-pushes a dependent branch under `--execute` without recording a `push` effect.

**One artifact resolved from an initially-assumed gap into a real (partial) finding.** `holdout.json`'s canonical writer is NOT a `bin/lib` module and is NOT purely agent-side either: `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs`'s exported `main` function is a real, spawner-attested writer of `.faff/holdout/<key>.json`, enforced by a contract ratchet (`faff contract holdout-verdict --require-spawner-attested`) that rejects an inner self-declared `code_blind:true` claim. What remains an open, UNRESOLVED finding is how that spawner-attested path reaches the per-run `<run-dir>/<issue>/holdout.json` file `governance-check.js`/`merge-gate.js` actually read; no module was found performing that join, copy, or rename. Not re-investigated at `475c0362`; carried forward.

**Single-writer / shared-chokepoint findings (not a violation of "exactly one canonical writer"; the constraint is about a row needing TWO writers, and none did).**

- `run-ledger.json` is mutated by more commands than at `174f62b7` (`heartbeat`, `budget`, `run-ledger` including `init-self-drain` and `capture-capability`, `run-record-prd`, `resumecheck`, `lights-out` including its `--resume` unpark, `sentry`, `events`), but every one of them reaches the disk through the SAME function, `heartbeat.js :: atomicWriteLedger`, called only from `heartbeat.js :: mutateLedgerUnderLock`. `heartbeat.js`'s own comment states this outright: "NONE directly — every production mutation goes through mutateLedgerUnderLock". This is the cleanest possible instance of "exactly one canonical writer"; many callers, one writer.
- `events.jsonl` and `declared-effects.jsonl` are both written through the same generic `events.js :: appendRecordsUnderLock`, parameterised by which ledger file the caller names. `events.jsonl` is reached through `events.js :: appendEventRecord` (by `events`, `contain`, `self-intake`, `decision-capture` and the nine kernels' in-kernel capture); `declared-effects.jsonl` through `effects.js :: appendEffectEntries` (`schema:2`) and `commissaire.js :: appendProducerRecords` / `appendCommissaireRecord` (`schema:3`), under the same lock. Which schema is canonical per record kind is addendum decision 2, not settled here.

**Sweep-invisible mechanisms (named, not silently missing).** "The write-site sweep" lists every one: the build-claim and landing-claim git-ref pushes, judge-trail's `refs/faff/judge-trail/<run_id>` update-ref or push, worktree-heal's `git worktree repair`, the `scripts/link-skills.sh` install, merge-gate's merge call, dependency-rebase push and `--local` ref update, `faff pr-create`'s `gh pr create`, and the prose-written governance-required sentinel.

**Stale comments in code, recorded rather than fixed (this revision changes no `bin/lib` file).** `commissaire.js:22` counts "NINE dispatched subcommands" (the dispatch table holds eleven); `conventions.js`'s banner calls `mine` "deterministic, read-only" (it writes the cache); `ratified-scope.js`'s header says it has "no writes" (FAFF-998 added one); `governance-profile.js`'s two-keys comment carries stale counts; and the "(twelve)" comment in `shadow-fidelity.js` above.

**Environment-sensitive selftest members, out of scope.** `faff regions selftest --region all` reports three failing members on the macOS host this revision was built on: `budget` (two same-day clock cases), `build-claim` (a skew-tolerance timing case) and `gates` (two OS-mismatch cases). None is a map defect; `.faffrc.yaml` already keeps the command out of the local gate ladder (FAFF-561).

**Vocabulary-fit check (the spec's own failure-mode trigger).** More than a handful of forced `n/a` cells would mean the five-class vocabulary does not describe this system. It does not trigger here: `journal_class` is `n/a` on 13 of 94 rows and `effect_class` on 75 of 94, but every `n/a` cell states WHY (either "not a relied-on record stream" for a one-off local artifact like `.gitignore`/generated fixtures, or "not itself a protected external effect" for a pure record fact like a ledger or PR-body sanitiser); the pattern is expected given how few of this codebase's durable facts are ALSO protected external effects, not evidence the vocabulary is the wrong shape for the system. No row uses `n/a` on one class to dodge stating the other: the six rows carrying `n/a` on both (`summary.md`, `gitignore-ensure`, `fixtures`, `env`, `conventions`, `commissaire key material`) are legitimately neither a relied-on stream nor a protected effect, checked individually, not defaulted.

**No blocker found.** The field vocabulary fits the codebase at the grain this map operates.

## Changes since 174f62b7

This map was first built against `174f62b7` (2026-08-31) by commit `48be132d` (FAFF-825). That revision was consumed as recorded: FAFF-944 selected the cutover slice from it (`CUTOVER-SLICE-SELECTION-v5.md` cites its 59 row keys, all kept byte for byte here), and the FAFF-826 coordination-fidelity report under `verification/reports/FAFF-826-coordination-fidelity/` derived its set-aside list from it. Read that revision with `git show 48be132d:docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md`; the file was unchanged from `48be132d` to `475c0362`. A byte copy also sits at `test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` so the FAFF-826 result keeps reproducing (see "Gaps and named findings").

This revision is FAFF-1162, built against `475c0362` (2026-10-05). It revises the map in place rather than publishing a delta: `shadow-fidelity.js` reads this file, smoke-test step 4 compares one table with one count, and FAFF-827 sits one current map.

**Pin history within this revision.** FAFF-1162 was first built against `b02fac1b`, the `origin/main` tip when its build started. Before merge it was re-pinned to `475c0362`, because FAFF-1167 (#1003, the `schema:3` rename of the unit key `issue` to `unit_id`) merged in between and FAFF-1162's recorded default is to pin at or after that rename. The commits between the two pins (FAFF-588, FAFF-740, FAFF-1167) added, removed and moved no `REGION_MAP` key and changed no write site, artifact path or class cell. FAFF-1167 did edit `commissaire.js`, `commissaire.ts` and `effects.js`, adding the `effects.js :: unitIdOf`/`matchesUnit` compatibility read that `commissaire.js`, `merge-gate.js`, `audit.js` and `effects-reconcile.js` now use, but no row's cells depend on the field name. A search of this map for statements of the old key found none outside the two notes changed here; the `--issue` on the `faff worktree-prune` rows is that command's own `schema:2` flag, which FAFF-1167 did not touch. The re-pin changed only what the rename moved: six `commissaire.js` line citations (`:593`, `:610`, `:835`, `:846`, `:910`, `:915` became `:612`, `:629`, `:854`, `:869`, `:936`, `:941`), the quoted terminal-verdict line, which now reads `unit_id: issue`, and the record-identities note, which now records the rename as merged. The sweep and the smoke test were re-run in full at `475c0362`.

**`REGION_MAP` between the two pins.** 114 keys at `174f62b7`, 134 at `475c0362`: 20 added, none removed, none moved region. The added commands are `build-judge-evidence`, `build-review-churn`, `build-review-convergence`, `commissaire`, `conventions`, `judge-history`, `judge-trail`, `manifest`, `native-map`, `park-reconsider`, `pr-create`, `punt-scan`, `review-target`, `scenario-matrix` (governance), `shadow-fidelity`, `spec-judge-accept-bar`, `spec-review`, `verification`, `worktree-check` and `worktree-heal` (all factory except where marked).

**The parsed decision-kernel set** (what `shadow-fidelity.js :: readMapDecisionKernelCommands` extracts from the classification table):

- before (12): claim-verdict, decision-capture, eligible, next, park-verdict, project-next, queue-state, run-done, run-ledger, run-outward, run-start, state
- after (14): claim-verdict, decision-capture, eligible, next, park-reconsider, park-verdict, project-next, queue-state, run-done, run-ledger, run-outward, run-start, shadow-fidelity, state

No command left `decision-kernel`; the nine replayable kernels are all still in the set. The two additions change the FAFF-826 study's set-aside list, not its in-scope kernels.

**Named review items for the FAFF-827 sitter.** These are the judgement calls this revision makes beyond copied facts:

- **The amendment-surface verdict** ("The eight invariant families", "Amendment surface investigation"): `commissaire.js`'s `contract admit` supplies the admission-decision half of the RFC's amendment rule but not the immutable-revision half, so "no current mechanism" stands.
- **The Effect family re-check:** "detection only, never aborts" no longer holds for every kind. On a governed run the merge and PR-open chokepoints fail closed without a covering grant, and the governance-required sentinel arms that reading; every other governed effect kind stays record-only.
- **Every class cell graded on the Ed25519 grant**, each graded against the orchestrator under the FAFF-825 weakest-provable rule and carrying the custody caveat: `faff merge-gate` (E-B kept, resting on the sole-path mediation, not on the grant); `faff pr-create` (E-D, no fence denies a raw `gh pr create`); `faff commissaire effect authorize` (J-D, E-D); and `faff commissaire contract admit`, `effect declare`, `effect observe` and `verdict conclude` (J-D, with J-C stated as what the binding would earn against a conflicting producer).
- **Classification calls on new commands:** `shadow-fidelity` and `park-reconsider` as `decision-kernel` (the `decision-capture` and `park-verdict` precedents); `scenario-matrix` as `harness-and-skill-orchestration`, a DISAGREES row against its governance region.
- **State-changing calls on existing commands:** the nine decision kernels are graded state-changing because in-kernel capture appends to `.faff/` when `capture.decision_kernel` is `on`; `lane-boundary`, `contain`, `self-intake` and `engine` are corrected from read-only.
- **Grain calls:** a command whose only write is a record appended through another module's chokepoint gets its own row; `commissaire` splits by verb; `audit anchor` folds into the anchor rows; the Commissaire rows sit in a seventh area so the map does not answer addendum decision 2.

**Prose outside the tables.** The header, "Authority and purpose", "Vocabulary" (counts, the TypeScript and record-identity notes, two grain notes), the classification introduction, "The write-site sweep" (re-run in full at `475c0362`), the table introduction and "On the row count", the disposition-scope "Run membership" and "Work item" rows, "The eight invariant families" and its amendment investigation, "The work-item terminal-verdict scope", "Gaps and named findings" and "Integration smoke test" were rewritten for `475c0362`. `TECHNICAL-DESIGN-v5.md` lines 616 and 662 now point at "all current commands" instead of a count, since the pinned count lives here.

**Row change list.** One entry per added or revised row. A row whose cells are unchanged has no entry.

| table | row | change | reason |
|---|---|---|---|
| classification | adr | revised | superseded-ADR relocation added to recordSupersede (FAFF-1042, FAFF-1048) |
| classification | build-judge-evidence | added | new REGION_MAP command since 174f62b7 (FAFF-996) |
| classification | build-review-churn | added | new REGION_MAP command since 174f62b7 (FAFF-996) |
| classification | build-review-convergence | added | new REGION_MAP command since 174f62b7 (FAFF-996) |
| classification | bundle | revised | localBundleStore moved to bundle-seal-core.js (FAFF-1000); bundle.js re-exports it |
| classification | claim-verdict | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | commissaire | added | new REGION_MAP command since 174f62b7 (FAFF-828) |
| classification | config | revised | `--local` writes the .faffrc.local.yaml overlay (FAFF-1062) |
| classification | contain | revised | correction: `--record` appends a containment-check event; recorded read-only at 174f62b7 in error |
| classification | conventions | added | new REGION_MAP command since 174f62b7 (FAFF-1041) |
| classification | decision-capture | revised | names the record and action verbs' event appends, present but unnamed at 174f62b7, and the action verb (FAFF-989) |
| classification | eligible | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | engine | revised | correction: a metered `engine call` appends to the engine-spend log; recorded read-only at 174f62b7 in error; the supervisor heartbeat tick is FAFF-877 |
| classification | gitignore-ensure | revised | `--local` writes .git/info/exclude (FAFF-1062) |
| classification | holdout | revised | `verdicts --persist` writes a PRDR DoD-verdict line (FAFF-953) |
| classification | hooks-ensure | revised | `--local` writes settings.local.json (FAFF-1062) |
| classification | judge-history | added | new REGION_MAP command since 174f62b7 (FAFF-994) |
| classification | judge-trail | added | new REGION_MAP command since 174f62b7 (FAFF-994) |
| classification | lane-boundary | revised | correction: `emit` writes lane-boundary.json; recorded read-only at 174f62b7 in error |
| classification | lights-out | revised | `--resume` reconsider pass writes the prep marker, ledger and spec-review hold (FAFF-993); genesis event helper (FAFF-966) |
| classification | manifest | added | new REGION_MAP command since 174f62b7 (FAFF-1103) |
| classification | merge-gate | revised | names the override file, the `schema:2` auto-declare suppressed under a `schema:3` grant (FAFF-1012, FAFF-1034) and the dependency-rebase push (FAFF-1077) |
| classification | native-map | added | new REGION_MAP command since 174f62b7 (FAFF-1081) |
| classification | next | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | park-reconsider | added | new REGION_MAP command since 174f62b7 (FAFF-993) |
| classification | park-verdict | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | pr-create | added | new REGION_MAP command since 174f62b7 (FAFF-1118) |
| classification | project-next | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | punt-scan | added | new REGION_MAP command since 174f62b7 (FAFF-1078) |
| classification | queue-state | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | ratified-scope | revised | `--fold-resolutions --into` appends to a caller-named file (FAFF-998) |
| classification | review-target | added | new REGION_MAP command since 174f62b7 (FAFF-957) |
| classification | run-done | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | run-ledger | revised | new `init-self-drain` (FAFF-966) and `capture-capability` (FAFF-1116) verbs |
| classification | run-outward | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | run-start | revised | in-kernel decision capture appends to the run's events.jsonl when `capture.decision_kernel` is `on` (FAFF-956, FAFF-1009) |
| classification | scenario-matrix | added | new REGION_MAP command since 174f62b7 (FAFF-822) |
| classification | self-intake | revised | correction: `--record` appends a self-intake-check event; recorded read-only at 174f62b7 in error |
| classification | shadow-fidelity | added | new REGION_MAP command since 174f62b7 (FAFF-826) |
| classification | spec-judge-accept-bar | added | new REGION_MAP command since 174f62b7 (FAFF-945) |
| classification | spec-judge-evidence | revised | `--assemble`, `--admit` and `--restamp` write the judge directory (FAFF-930, FAFF-994, FAFF-959) |
| classification | spec-review | added | new REGION_MAP command since 174f62b7 (FAFF-1157) |
| classification | verification | added | new REGION_MAP command since 174f62b7 (FAFF-1061) |
| classification | worktree-check | added | new REGION_MAP command since 174f62b7 (FAFF-948) |
| classification | worktree-heal | added | new REGION_MAP command since 174f62b7 (FAFF-1114) |
| classification | worktree-prune | revised | governed declare/observe bracket under `--run-dir` (FAFF-1119) |
| ownership | faff run-ledger | revised | names the init-self-drain and capture-capability callers (FAFF-966, FAFF-1116) |
| ownership | faff budget | added | state-changing at 174f62b7 but given no row triple there |
| ownership | faff events | added | state-changing at 174f62b7 but given no row triple there |
| ownership | faff pr-create | added | new state-changing command (FAFF-1118) |
| ownership | faff lane-boundary | added | state-changing command (classification correction) |
| ownership | faff holdout | added | new write in an existing command (FAFF-953) |
| ownership | faff spec-judge-evidence | added | new writes in an existing command (FAFF-930, FAFF-994, FAFF-959) |
| ownership | faff build-judge-evidence | added | new state-changing command (FAFF-996) |
| ownership | faff judge-trail | added | new state-changing command (FAFF-994) |
| ownership | faff worktree-prune | revised | governed declare/observe bracket under `--run-dir` (FAFF-1119) |
| ownership | faff contain | added | state-changing command (classification correction) |
| ownership | faff self-intake | added | state-changing command (classification correction) |
| ownership | faff intake-record | added | state-changing at 174f62b7 but given no row triple there |
| ownership | faff decision-capture | revised | readers: the shadow comparison now exists as shadow-fidelity.js (FAFF-826) |
| ownership | faff claim-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff eligible | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff park-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff project-next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff queue-state | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff run-done | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff run-outward | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff run-start | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| ownership | faff shadow-fidelity | added | new state-changing command (FAFF-826) |
| ownership | faff ratified-scope | added | new write in an existing command (FAFF-998) |
| ownership | faff config | revised | `--local` overlay target (FAFF-1062); findConfig re-cited to shared-infra.js, where it is declared |
| ownership | faff bundle | revised | canonical writer moved to bundle-seal-core.js (FAFF-1000); commissaire.js reads the store |
| ownership | tracker: status transition | revised | governed `tracker-write` record in faff-graft prose (FAFF-1120) |
| ownership | tracker: label | revised | governed `label-write` record (FAFF-1119); banner quote replaced by a single-line one |
| ownership | faff engine | added | state-changing command (classification correction) |
| ownership | faff conventions | added | new state-changing command (FAFF-1041) |
| ownership | faff native-map | added | new state-changing command (FAFF-1081) |
| ownership | faff worktree-heal | added | new state-changing command (FAFF-1114) |
| ownership | faff commissaire contract admit | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | commissaire key material | added | new durable artifact (FAFF-828) |
| ownership | faff commissaire effect declare | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | faff commissaire effect authorize | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | faff commissaire effect observe | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | faff commissaire verdict conclude | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | faff commissaire audit seal | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | faff commissaire audit export | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| ownership | governance-required.json | added | new durable artifact read by the merge floor (FAFF-1140) |
| migration | faff lights-out | revised | `--resume` reconsider writes (FAFF-993); adds test/lights-out-reconsider.test.mjs |
| migration | faff run-ledger | revised | new verbs and tests (FAFF-966, FAFF-1116, FAFF-1126) |
| migration | faff budget | added | state-changing at 174f62b7 but given no row triple there |
| migration | faff events | added | state-changing at 174f62b7 but given no row triple there |
| migration | faff effects declare | revised | `schema:3` records chain into the same file under the same lock (FAFF-828); "starts fresh at cutover" removed |
| migration | faff effects observe | revised | `schema:3` records chain into the same file (FAFF-828) |
| migration | effects-chain-head.json | revised | the witness folds `schema:3` records too (FAFF-828) |
| migration | faff post-merge-check | revised | selftest range end line re-derived (177-274) |
| migration | faff build-claim | revised | selftest range moved (1519-1878) |
| migration | faff landing-claim | revised | selftest range moved (2073-2173) |
| migration | faff pr-create | added | new state-changing command (FAFF-1118) |
| migration | faff lane-boundary | added | state-changing command (classification correction) |
| migration | faff holdout | added | new write in an existing command (FAFF-953) |
| migration | faff spec-judge-evidence | added | new writes in an existing command (FAFF-930, FAFF-994, FAFF-959) |
| migration | faff build-judge-evidence | added | new state-changing command (FAFF-996) |
| migration | faff judge-trail | added | new state-changing command (FAFF-994) |
| migration | faff worktree-prune | revised | selftest range moved (255-266); governed bracket (FAFF-1119) |
| migration | faff contain | added | state-changing command (classification correction) |
| migration | faff self-intake | added | state-changing command (classification correction) |
| migration | faff intake-record | added | state-changing at 174f62b7 but given no row triple there |
| migration | faff adr supersede | revised | superseded-ADR relocation (FAFF-1042, FAFF-1048) |
| migration | faff claim-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff eligible | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff park-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff project-next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff queue-state | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff run-done | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff run-outward | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff run-start | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| migration | faff shadow-fidelity | added | new state-changing command (FAFF-826) |
| migration | faff ratified-scope | added | new write in an existing command (FAFF-998) |
| migration | faff gitignore-ensure | revised | selftest range moved (125-261) |
| migration | faff bundle-recover | revised | selftest range end line re-derived (634-913) |
| migration | anchor: effects | revised | carries `schema:3` records (FAFF-828) |
| migration | anchor: floor-evidence | revised | spec-review-verdict.json (FAFF-1157) and pk.json (FAFF-976) copied; floor-incomplete refusal (FAFF-1155) |
| migration | tracker: status transition | revised | quote re-attributed to TECHNICAL-DESIGN-v5.md, where it appears (smoke-test step 6) |
| migration | faff engine | added | state-changing command (classification correction) |
| migration | faff conventions | added | new state-changing command (FAFF-1041) |
| migration | faff native-map | added | new state-changing command (FAFF-1081) |
| migration | faff worktree-heal | added | new state-changing command (FAFF-1114) |
| migration | faff commissaire contract admit | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | commissaire key material | added | new durable artifact (FAFF-828) |
| migration | faff commissaire effect declare | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | faff commissaire effect authorize | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | faff commissaire effect observe | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | faff commissaire verdict conclude | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | faff commissaire audit seal | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | faff commissaire audit export | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| migration | governance-required.json | added | new durable artifact read by the merge floor (FAFF-1140) |
| assurance | faff budget | added | state-changing at 174f62b7 but given no row triple there |
| assurance | faff events | added | state-changing at 174f62b7 but given no row triple there |
| assurance | faff effects declare | revised | quote re-attributed to the FAFF-825 spec, where it appears (smoke-test step 6) |
| assurance | faff merge-gate | revised | Ed25519 grant leg with the custody caveat (FAFF-828, FAFF-1034); quote corrected to the banner's text |
| assurance | faff pr-create | added | new state-changing command (FAFF-1118) |
| assurance | faff lane-boundary | added | state-changing command (classification correction) |
| assurance | faff holdout | added | new write in an existing command (FAFF-953) |
| assurance | faff spec-judge-evidence | added | new writes in an existing command (FAFF-930, FAFF-994, FAFF-959) |
| assurance | faff build-judge-evidence | added | new state-changing command (FAFF-996) |
| assurance | faff judge-trail | added | new state-changing command (FAFF-994) |
| assurance | faff worktree-prune | revised | governed bracket graded (FAFF-1119) |
| assurance | faff contain | added | state-changing command (classification correction) |
| assurance | faff self-intake | added | state-changing command (classification correction) |
| assurance | faff intake-record | added | state-changing at 174f62b7 but given no row triple there |
| assurance | faff adr draft | revised | governed `file-write` record in faff-graft prose (FAFF-1119) |
| assurance | faff adr accept | revised | governed `file-write` record in faff-graft prose (FAFF-1119) |
| assurance | faff adr renumber | revised | governed `file-write` record in faff-graft prose (FAFF-1119) |
| assurance | faff adr supersede | revised | governed `file-write` record in faff-graft prose (FAFF-1119) |
| assurance | faff prdr draft | revised | states that no governed bracket covers PRDR writes |
| assurance | faff prdr accept | revised | states that no governed bracket covers PRDR writes |
| assurance | faff prdr land | revised | states that no governed bracket covers PRDR writes |
| assurance | faff prdr renumber | revised | states that no governed bracket covers PRDR writes |
| assurance | faff claim-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff eligible | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff park-verdict | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff project-next | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff queue-state | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff run-done | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff run-outward | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff run-start | added | state-changing kernel through in-kernel decision capture (FAFF-956, FAFF-1009) |
| assurance | faff shadow-fidelity | added | new state-changing command (FAFF-826) |
| assurance | faff ratified-scope | added | new write in an existing command (FAFF-998) |
| assurance | tracker: status transition | revised | governed `tracker-write` record (FAFF-1120) |
| assurance | tracker: comment | revised | states that no governed bracket covers comments |
| assurance | tracker: label | revised | governed `label-write` record (FAFF-1119) |
| assurance | tracker: relation | revised | states that no governed bracket covers relations |
| assurance | faff engine | added | state-changing command (classification correction) |
| assurance | faff conventions | added | new state-changing command (FAFF-1041) |
| assurance | faff native-map | added | new state-changing command (FAFF-1081) |
| assurance | faff worktree-heal | added | new state-changing command (FAFF-1114) |
| assurance | faff commissaire contract admit | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | commissaire key material | added | new durable artifact (FAFF-828) |
| assurance | faff commissaire effect declare | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | faff commissaire effect authorize | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | faff commissaire effect observe | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | faff commissaire verdict conclude | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | faff commissaire audit seal | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | faff commissaire audit export | added | new Commissaire facade row (FAFF-828, FAFF-1000) |
| assurance | governance-required.json | added | new durable artifact read by the merge floor (FAFF-1140) |
| disposition-scope | Run membership | revised | ledger_outcomes moved to governance-profile.js:140 |
| disposition-scope | Work item | revised | `verdict conclude` writes accepted_under_contract (FAFF-1000, FAFF-1008); line and quote as of the FAFF-1167 rename |
| invariant-families | Merge | revised | `schema:3` grant leg on a governed run (FAFF-828, FAFF-1034); decideFloor lives in contract-defs.js |
| invariant-families | Effect | revised | fail-closed merge and PR-open chokepoints on a governed run (FAFF-1034, FAFF-1118) and the governance-required sentinel (FAFF-1140) |
| invariant-families | Amendment | revised | fourth candidate commissaire.js checked; verdict restated |

## Integration smoke test

Run 2026-10-05 against this document and the two `TECHNICAL-DESIGN-v5.md` pointer lines (616 and 662), resolving all citations against commit `475c0362`. It replaces the `174f62b7` record (2026-08-31, all eight steps passing), which stays readable in that revision. Each step keeps its FAFF-825 definition, with one extension this revision adds: step 7c, which checks cited line numbers and ranges. One stated exception: a path this revision itself adds cannot exist at `475c0362`, so step 3 resolves it at the branch head that carries it and names it. All eight steps pass; the run recorded here is the final one, re-run after every fix listed below. An earlier full run at the first pin, `b02fac1b`, also passed all eight steps; it was superseded by this run when the map was re-pinned (see "Changes since 174f62b7").

| Step | Check | Result |
|---|---|---|
| 1 | Read the recorded commit | **PASS**: the header names `475c0362` (2026-10-05), which resolves to `475c0362aa2f67f8aef4ad0b13c618fe956bce78` |
| 2 | Extract every cited repo-relative path (code spans and table cells, including every `characterisation_tests` path) from this map and the two pointer lines | **PASS**: 96 distinct paths: 23 from code spans and 76 plain paths from table cells, with overlap. The prior run's conservative rule is kept: a path counts only with a repository-root directory prefix (`plugin/`, `test/`, `docs/`, `records/`, `scripts/`, `eval/`, `verification/`, `bin/`) and a plain file extension, with no glob metacharacter, angle-bracket placeholder or `" :: "` compounding. Runtime artifacts under a per-run directory (`run-ledger.json`, `events.jsonl`, `lane-boundary.json` and the like) and templated paths are not repository paths. The fenced path lists in "The write-site sweep" are checked by step 8 |
| 3 | Reject any path with a leading `/`, a `..` segment or a shell metacharacter; assert each exists with `git cat-file -e 475c0362:<path>`, one argv element | **PASS**: none rejected; 95 resolve at `475c0362`. Exception, as stated above: `test/fixtures/faff-826-map-root/docs/rfc/rfc-superdomestique-runtime/v5/STATE-AUTHORITY-MAP-v5.md` is added by this revision, so it was resolved at the branch head instead. Its content is pinned by sha256 `7a21e429b7e143023c6ea9ca0ac30e70099f5a777e8ef53d1ad37b29daba3389`, which `test/shadow-fidelity.test.mjs` asserts, so the check reproduces at any commit that carries this revision |
| 4 | Classification row count equals the `faff regions list --json` key count and the `faff regions selftest --region all` member count | **PASS**: 134 rows; 134 keys; 134 members in the selftest's final RESULT line, which read "RESULT: FAIL (134 members, 3 failed)" on this host (the member count is the check, whatever the line's pass/fail word). Every key appears exactly once, no row names a key outside `REGION_MAP`, and every `current_region` equals `REGION_MAP`'s value. The three failing members (`budget`, `build-claim`, `gates`) are environment-sensitive selftest cases recorded in "Gaps and named findings", not map defects |
| 5 | Ownership, migration and assurance tables carry identical `row_key` sets, containing the 59 prior keys | **PASS**: 94 keys in each table, identical sets; all 59 keys of the `174f62b7` revision present byte for byte |
| 6 | Every quoted RFC, addendum or module fragment appears verbatim in the named file; a fragment attributed to a named section sits under that heading, and a fragment cited by file and line sits on that line | **PASS**: 51 fragments checked, an elided quote as its separate parts; 16 against their cited line and 6 against their named section ("Phase 1", "Phase 0" and "Current records and artifacts" in `TECHNICAL-DESIGN-v5.md`; the `AGENTS.md` TypeScript section) |
| 7 | (a) Every `<module>.js :: <function>` citation resolves: the module exists at the commit (the `.js` emit for TypeScript modules) and declares or exports the function. (b) Every named out-of-band mechanism's spawn or ref name is present. (c, extension) Every cited line range starts on the line declaring the named function and ends on its closing line; every cited single line holds the cited text | **PASS**: (a) 140 distinct citations, all resolve; (b) 11 mechanism names present: the claim-store `push`, judge-trail's `update-ref` and `push`, `worktree repair`, `link-skills.sh` and the script itself, merge-gate's `--force-with-lease`, `update-ref` and `--ff-only`, the `pr create` spawn, and the prose-written `governance-required.json`; (c) 7 inline-selftest ranges, each end line found by brace matching, plus 5 single line numbers and the 16 line-cited quotes of step 6 |
| 8 | Recompute the write-site sweep diff from the two enumerated sets in this map; assert it matches the stated diff and that the scope is named | **PASS**: derived 62, swept 98 (16 closure additions); 36 swept-not-derived and 0 derived-not-swept, matching "The write-site sweep"; every swept-not-derived file is named in its resolution list; the scope statement (whole repository less `test/` and `node_modules/`, `.js`/`.mjs`, `.ts` excluded with the reason) is present |

**What the run caught, and the fixes.** Step 6 caught five quotes the `174f62b7` revision carried: two attributed to the wrong source ("declare before acting" is the FAFF-825 spec's wording, not the master RFC's; "projection and command surface" is `TECHNICAL-DESIGN-v5.md`'s, as "Remains a projection and command surface"), one with a period the source does not have (`heartbeat.js`'s "…mutateLedgerUnderLock" continues "below"), one in the wrong case (`merge-gate.js`'s banner reads "the SOLE sanctioned `gh pr merge` path"), and one spanning two physical lines (`label.js`). It also caught a new draft quote spanning a wrapped banner line in `scenario-matrix.js`. Step 7 caught `config.js :: findConfig` (declared in `shared-infra.js`) and, under the 7c extension, every inline-selftest range's end line, all re-derived at `475c0362`. Each fix is in the row change list above. Re-running at `475c0362` before the re-pin fixes failed steps 6 and 7c on the six `commissaire.js` line citations FAFF-1167 moved, and on the terminal-verdict quote, which the rename changed; all were re-cited at `475c0362`.

**What step 8 confirmed.** The 36 files the sweep finds outside the derived set are eval-harness tooling, repo-maintenance scripts, three dated spikes, external-verification tooling, two skill-side or engine helpers whose writes are ephemeral or an opt-in inspection corpus, the lock primitive, two closure additions whose write is never reached in production, and nine `bin/lib` modules whose only seed hit is in a selftest fixture or scratch helper; none is a state-changing command wrongly recorded read-only. The derived set has no file outside the swept set, because the closure pass brings in every derived file that writes only through another module's chokepoint.

All eight steps pass. This map is internally consistent: every citation resolves, every quoted fragment is real, and the completeness diff is a computation a reader can redo, not a sentence. It does not prove `semantic_owner`, `journal_class`, or `effect_class` are the *right* judgements; that is what FAFF-827's human decision is for, starting with the named review items in "Changes since 174f62b7".
