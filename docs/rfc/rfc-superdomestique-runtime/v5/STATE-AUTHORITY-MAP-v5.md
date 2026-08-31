# SuperDomestique runtime v5: state authority map

Built against commit `174f62b7`, 2026-08-31.
Status: Phase 1 deliverable for FAFF-825. Sole input to the cutover-slice selection ticket, FAFF-944.
Source basis: `TECHNICAL-DESIGN-v5.md` records its own inspection at `7d89640ce7b8`, an earlier commit; this map is a fresh inspection at `174f62b7`. Where the two disagree, this map is the fresher observation, while the [master direction](FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) still controls strategy — the same precedence rule the master direction's own "Source basis" section states.

## Authority and purpose

This document is the fine-grained successor to [`TECHNICAL-DESIGN-v5.md`](TECHNICAL-DESIGN-v5.md)'s "Current records and artifacts" and "Current-to-target responsibility map" tables. Those two tables cover roughly nine headline artifacts; this map covers all 114 current CLI commands and every durable artifact and state-changing step among them, at the grain `TECHNICAL-DESIGN-v5.md`'s own "Phase 1" section demands: "The map names current writers, current consumers, integrity, future owner, translation, cutover, and rollback."

It does not choose a cutover slice. That is FAFF-944's job, and this map is its sole input. It does not build anything: no module under `plugin/skills/faff/bin/lib/` and no file under `test/` was added, edited, or deleted to produce it.

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

**Chosen grain** (so a later reader can tell a complete table from a coarse one):

- All 114 `REGION_MAP` commands get a `ClassificationRow`. `current_region` is copied verbatim from `regions.js`; it is never judged.
- Only durable artifacts and state-changing steps get the full Ownership/Migration/Assurance row triple. A tracker mutation is graded **one row per kind** (status transition, comment, label, relation), never one row for the whole projection and never one per field. The anchors tree is graded **one row per anchor kind** (events, ledger, effects, floor-evidence), never one per file. Where a single artifact (`run-ledger.json`) is mutated by many commands through one shared chokepoint function, each calling command still gets its own row — the artifact's own row names the chokepoint once.

## The five semantic-owner buckets

Chosen per the spec: the master RFC's five Phase 1 buckets are the `semantic_owner` vocabulary (not `TECHNICAL-DESIGN-v5.md`'s five-bucket "Interface migration" list, which the master's own "Source basis" note is superseded by for a classification vocabulary — a strategy question, not an implementation detail). `TECHNICAL-DESIGN-v5.md`'s `compatibility-only` value survives as its own boolean column rather than merging into this list, because a command can be both Commissaire-owned in meaning and destined to survive only as an alias.

| Bucket | Shorthand used below |
|---|---|
| `commissaire-governance` | Governance verdicts, protected-effect ledgers, the flight recorder, terminal safety |
| `decision-kernel` | Pure eligibility, queue, termination, and next-step predicates |
| `software-delivery-policy` | PR/CI/merge/holdout/quality/product-record policy specific to the Software Delivery domain |
| `harness-and-skill-orchestration` | Dev-environment hygiene, CI/skill-surface conformance, hook/worktree/harness wiring |
| `external-adapters-and-infrastructure` | Worker/backend/model adapters, execution infrastructure, config/tracker connectors |

**Compatibility-only, as populated below:** every classification row states `no`. No command in this codebase carries a per-command compatibility marker today — `TECHNICAL-DESIGN-v5.md`'s "Interface migration" section states the *whole* `faff` governance namespace becomes a compatibility alias only once `commissaire` ships (Phase 2A), which is a namespace-wide, future-triggered fact, not a distinction any current command already carries. Marking individual commands `yes` today, absent such a marker, would be judgement dressed as a copied fact — exactly the anti-pattern the design principles warn against. This uniform `no` is itself a recorded finding, not an oversight.

## Classification table

One `ClassificationRow` per `REGION_MAP` entry in `plugin/skills/faff/bin/lib/regions.js`, 114 of them (17 `governance` + 97 `factory`, verified against `COUNT 114` at the head of the authoritative dump this map was built from). `current_region` is copied verbatim from `REGION_MAP`; `semantic_owner` and `owner_basis` come from reading the command's actual handler module (resolved from `plugin/skills/faff/bin/faff`'s own `COMMANDS` registry and `require` list, not guessed from the command name). `state_changing` and `write_evidence` come from tracing each handler's write closure — following any locally-defined helper it calls, and any shared cross-module writer it imports (for example, most run-ledger.json mutations reach the disk only through `heartbeat.js :: atomicWriteLedger`, imported by eight other modules) — down to an actual `fs` write primitive or an equivalent durable mechanism outside the `fs` API (a git-ref push, a shelled installer script). Where `semantic_owner` disagrees with `current_region`, `owner_basis` says why; three rows are marked **DISAGREES** for a reader scanning quickly: `governance-profile.js` (governance region, but the delivery-profile vocabulary is Software Delivery's own dialect), `governance-check.js` (factory region — already agrees — cited because it is the RFC's own worked counter-example), and `contract-defs.js` (an explicit anti-pattern guard: it collides in name with "Commissaire contract" but has nothing to do with governance admission).

| command | current_region | semantic_owner | owner_basis | state_changing | write_evidence | compatibility_only |
|---|---|---|---|---|---|---|
| `admissible` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `adr` | factory | software-delivery-policy | architecture decision records are a Software Delivery product-record type (ADR 0016 family), not a generic Commissaire record | yes | adr.js :: cmdAdr / adrAccept / adrRenumber / recordSupersede (mkdirSync/writeFileSync/rmSync of the ADR file set) | no |
| `adversarial-backends` | factory | external-adapters-and-infrastructure | mechanical assembly of the adversarial-review backend roster — same backend-adapter family | no | no durable write | no |
| `andon` | factory | commissaire-governance | push alerting/escalation for run-critical events — the notification arm of the flight recorder | yes | andon.js :: writeAndonState (writeFileSync/renameSync/unlinkSync of the andon state file) | no |
| `audit` | governance | commissaire-governance | read-only run-reconstruction forensics joining ledger + events + chain — the audit/export/seal concept the target Commissaire owns | no | no durable write | no |
| `backends` | factory | external-adapters-and-infrastructure | shared model/provider/auth backend resolution — execution infrastructure adapter | no | no durable write | no |
| `background-fence` | factory | harness-and-skill-orchestration | a PreToolUse fence on a self-backgrounded gate command — same harness-interception family as merge-fence | no | no durable write | no |
| `branch-protection-check` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | no | no durable write | no |
| `budget` | governance | commissaire-governance | run cost/compute budgeting is a governance floor (stop/narrow/escalate), not a domain quality gate | yes | budget.js :: appendEngineSpend (appendFileSync of the fleet engine-spend log) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (parked-window ledger field) | no |
| `build-claim` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: claimStoreCore::acquire (buildClaimStore) — a non-force `git push <sha>:<ref>` claim commit, a durable write via git ref, not an fs primitive (sweep limitation) | no |
| `build-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdBuildProgress (mkdirSync/writeFileSync/renameSync) | no |
| `bundle` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: cmdBundle -> publishBundle -> localBundleStore (mkdirSync/writeFileSync/renameSync of the Phase 0 recovery bundle) | no |
| `bundle-recover` | factory | commissaire-governance | the recover-on-a-later-executor counterpart to bundle.js (FAFF-820) — same Commissaire recovery-evidence family | yes | bundle-recover.js :: reconstructProjection / bundleRecover (mkdirSync/writeFileSync/copyFileSync/rmSync of the reconstructed run dir) | no |
| `ci-triage` | factory | software-delivery-policy | CI failure triage (flaky vs real) is Software Delivery CI logic | yes | ci-triage.js :: writeFlakyRegister / writeCiTriageVerdict (mkdirSync/writeFileSync) | no |
| `claim-verdict` | factory | decision-kernel | PURE stale-claim liveness function feeding assignment/lease decisions | no | no durable write | no |
| `cli-surface` | factory | harness-and-skill-orchestration | the declared, machine-readable CLI grammar — the harness's own interface description | no | no durable write | no |
| `config` | factory | external-adapters-and-infrastructure | resolves/reads .faffrc and lists model backends — the compatibility/domain facade config surface named in the responsibility map | yes | config.js :: cmdConfigInit / cmdConfigSet (writeFileSync of .faffrc.yaml) | no |
| `contain` | factory | software-delivery-policy | container mandates over which paths a build may touch — Software Delivery scope policy | no | no durable write | no |
| `container-check` | factory | software-delivery-policy | asserts the ADR-0010 blast-radius (cage) boundary for a build — Software Delivery isolation policy | no | no durable write | no |
| `contract` | factory | harness-and-skill-orchestration | ANTI-PATTERN GUARD: this is the slot-handoff extraction validator (a JSON-Schema-subset checker over producer prose output) — it has nothing to do with admitting versioned governance terms despite the name collision with "Commissaire contract"; it belongs to skill-to-skill handoff orchestration | no | no durable write | no |
| `corrective` | factory | commissaire-governance | Sentry-2 Channel A subtractive corrective authority — the interlock that folds a cumulative constraint set into the next dispatch, a governance control over continuation | yes | corrective.js :: cmdCorrectiveAuthor (mkdirSync/writeFileSync of the corrective input record) | no |
| `corrective-integrity` | factory | commissaire-governance | the fail-safe half plus activation half of the corrective-authority mechanism above; same governance family | no | no durable write | no |
| `decision-capture` | factory | decision-kernel | read-only instrumentation of the CURRENT orchestrator's decision points, captured specifically to feed the coordinator-transition shadow comparison the RFC assigns to the decision kernel | yes | decision-capture.js :: cmdExportVerb (mkdirSync/writeFileSync of the decision-capture export record); bestEffortFail appends a best-effort failure note | no |
| `decisions` | factory | software-delivery-policy | the decisions register (ADR-lite) is the same Software-Delivery product-record family as adr.js | no | no durable write | no |
| `disposition` | factory | software-delivery-policy | the run-end DISPOSITION verdict is the domain (Software Delivery) view of a run's outcome, per the same responsibility-map row as quality/economics | no | no durable write | no |
| `doctor` | factory | software-delivery-policy | the engineering-quality gate ladder (`gates`/`doctor`) plus the dev-environment `sync` re-link are Software Delivery adoption tooling | no | no durable write | no |
| `dod` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `economics` | factory | software-delivery-policy | per-run unit economics, the reporting mirror of quality.js; same responsibility-map row | no | no durable write | no |
| `effects` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdEffects -> appendEffectEntries -> events.js :: appendRecordsUnderLock (appendFileSync of declared-effects.jsonl) | no |
| `effort` | factory | software-delivery-policy | per-issue build-effort routing keyed on tier — Software Delivery routing policy | no | no durable write | no |
| `eligible` | factory | decision-kernel | PURE automation-eligibility resolution — a kernel-shaped decision function, not domain judgement | no | no durable write | no |
| `engine` | factory | external-adapters-and-infrastructure | one-shot local-engine dispatch, named directly in "Engine, backend, harness... -> Worker adapters and execution infrastructure adapters" | no | no durable write | no |
| `env` | factory | external-adapters-and-infrastructure | live compose provisioning is execution infrastructure (containers/services), not delivery policy | yes | env.js :: cmdEnv / envSqlLoad (mkdirSync/writeFileSync of compose env material) | no |
| `eval` | factory | harness-and-skill-orchestration | derives the eval --kind subset a change needs — eval-harness orchestration | no | no durable write | no |
| `evaluator-preflight` | factory | software-delivery-policy | the assert-in half of the independent-evaluation isolation seam — Software Delivery evaluator lane policy | no | no durable write | no |
| `events` | governance | commissaire-governance | the append-only structured run-event log with hash-linked sequence, the journal substrate the future record system's stream-revision model replaces in kind | yes | events.js :: appendRecordsUnderLock (appendFileSync of events.jsonl) and mintIssueAnchor (mkdirSync/writeFileSync/copyFileSync of the anchor set) | no |
| `findings-reconcile` | factory | software-delivery-policy | resolved-elsewhere correlation for finding-tickets is Software Delivery backlog hygiene | no | no durable write | no |
| `fixtures` | factory | harness-and-skill-orchestration | the dataset-manifest schema and CLI generate eval-harness fixtures, not a production governance or delivery record | yes | fixtures.js :: cmdFixtures (mkdirSync/writeFileSync of the dataset-manifest fixture files) | no |
| `gates` | factory | software-delivery-policy | the engineering-quality gate ladder (`gates`/`doctor`) plus the dev-environment `sync` re-link are Software Delivery adoption tooling | no | no durable write | no |
| `github-auth-check` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | no | no durable write | no |
| `gitignore-ensure` | factory | harness-and-skill-orchestration | idempotently adds faff's local paths to .gitignore — repo/dev-environment hygiene | yes | gitignore-ensure.js :: gitignoreEnsure (writeFileSync of .gitignore) | no |
| `governance-check` | factory | software-delivery-policy | DISAGREES with current_region (factory, which already agrees with this call): despite the governance-sounding name it imports Software Delivery gate functions and writes the CI floor artifacts those gates need — the RFC's own worked counter-example | yes | governance-check.js :: cmdGovernanceCheck (appendFileSync) plus writeLedger / writeFloorArtifacts (writeFileSync of the CI floor artifacts) | no |
| `harness` | factory | harness-and-skill-orchestration | the harness-abstraction seam register (FAFF-483) is the literal home of this bucket's name | no | no durable write | no |
| `heartbeat` | governance | commissaire-governance | owns the single sanctioned write path for run liveness (heartbeat file) and is also where every production run-ledger.json mutation is chokepointed (atomicWriteLedger), the terminal-safety substrate Commissaire's seal depends on | yes | heartbeat.js :: atomicWriteSingleValueFile (heartbeat file, writeFileSync+renameSync) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (run-ledger.json) | no |
| `holdout` | factory | software-delivery-policy | DoD classification plus the admissible/holdout/spec-review-lens engines are Software Delivery's own quality-gate vocabulary | no | no durable write | no |
| `hooks-ensure` | factory | harness-and-skill-orchestration | idempotently registers faff's Stop-hook command set into the harness's own hook configuration | yes | hooks-ensure.js :: cmdHooksEnsure (rmSync/mkdirSync/writeFileSync of the registered hook set) | no |
| `inflightcheck` | governance | commissaire-governance | refuses a turn-end with an Agent dispatch still in flight — a liveness interlock over the run's control state | yes | inflightcheck.js :: cmdInflightcheck (mkdirSync/writeFileSync/rmSync of the in-flight marker) | no |
| `intake-record` | factory | software-delivery-policy | the intake-provenance guard (front-door enforcement) is Software Delivery intake policy | yes | intake-provenance.js :: cmdIntakeRecord (mkdirSync/writeFileSync of the intake-provenance record) | no |
| `intakecheck` | factory | software-delivery-policy | the intake-provenance guard (front-door enforcement) is Software Delivery intake policy | no | no durable write | no |
| `integrity-boundary` | factory | commissaire-governance | the fail-safe half plus activation half of the corrective-authority mechanism above; same governance family | no | no durable write | no |
| `integrity-digest` | factory | commissaire-governance | custody-based tamper detection over evidence bytes — a journal-integrity mechanism, not a delivery-policy check | yes | integrity-digest.js :: atomicWriteVerdictBytes (mkdirSync/writeFileSync/renameSync of the custody verdict) | no |
| `label` | factory | software-delivery-policy | DISAGREES with current_region only insofar as the mutation itself is agent-side: the module composes a Software Delivery control-label op descriptor; no bin/lib code performs the tracker write | no | no durable write | no |
| `labels` | factory | software-delivery-policy | the canonical control-label manifest is Software Delivery tracker vocabulary | no | no durable write | no |
| `landing-claim` | factory | commissaire-governance | the Phase 0 recovery-bundle publish/verify mechanism (FAFF-819) is exactly the off-box durable-evidence recovery the master RFC assigns to Commissaire's audit/seal domain; build-claim/landing-claim share this module only mechanically (a git-ref claim store), not by owning bundle semantics | yes | bundle.js :: claimStoreCore::acquire (landingClaimStore) — same git-ref push mechanism as build-claim (sweep limitation) | no |
| `landing-comment` | factory | software-delivery-policy | renders the ready-to-land PR comment body for the GH Action — Software Delivery PR logic | no | no durable write | no |
| `landing-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdLandingProgress (rmSync/mkdirSync/writeFileSync/renameSync) | no |
| `lane-boundary` | factory | software-delivery-policy | the emit half of the same config-declares -> emit -> assert-in chain as evaluator-preflight; Software Delivery lane policy, not the generic runtime lane schema yet | no | no durable write | no |
| `lights-out` | factory | harness-and-skill-orchestration | the L4 lights-out entry point/runner mints and supervises the unattended run process — harness/dispatch orchestration over the decision-kernel functions it calls | yes | lights-out.js :: claimRunDir / mintLightsOut (mkdirSync of the minted run dir) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (ledger mint) | no |
| `lint-cli-coverage` | factory | harness-and-skill-orchestration | asserts every subcommand is tested by something — same conformance-lint family | no | no durable write | no |
| `lint-cli-doc` | factory | harness-and-skill-orchestration | asserts docs/guide/cli.md documents every subcommand — CLI/skill-surface conformance lint | no | no durable write | no |
| `lint-refs` | factory | harness-and-skill-orchestration | bans external-artifact refs in prose — skill-authoring conformance lint | no | no durable write | no |
| `machine-id` | factory | external-adapters-and-infrastructure | collision-resistant per-host machine identity is host/infrastructure plumbing, not governance or delivery policy | yes | machine-id.js :: realWriteFile (mkdirSync/writeFileSync/renameSync of the machine-id cache) | no |
| `merge-fence` | factory | harness-and-skill-orchestration | a PreToolUse fence intercepting a raw `gh pr merge` tool call — harness-level interception, not a Commissaire decision itself | no | no durable write | no |
| `merge-gate` | factory | software-delivery-policy | the merge-gate interlock and branch-protection/github-auth checks are the Software Delivery merge floor named directly in "PR, CI, merge, holdout ... logic -> Software Delivery binding" | yes | merge-gate.js :: writeMergeRecord (mkdirSync/writeFileSync of the merge record) plus the sole sanctioned `gh pr merge` invocation on the resolved head sha | no |
| `models` | factory | external-adapters-and-infrastructure | resolves/reads .faffrc and lists model backends — the compatibility/domain facade config surface named in the responsibility map | no | no durable write | no |
| `next` | factory | decision-kernel | the legal-next-step pure transition function — the exact shape ("next.js ... Decision kernel") the technical design's responsibility map already names | no | no durable write | no |
| `park-history` | factory | software-delivery-policy | the deterministic repeat-park counting seam feeding faff-tidy's demote logic — Software Delivery backlog policy | no | no durable write | no |
| `park-verdict` | factory | decision-kernel | PURE stale-park validity function, same family as claim-verdict | no | no durable write | no |
| `post-merge-check` | factory | software-delivery-policy | post-merge verification is the tail of the Software Delivery merge flow | yes | post-merge.js :: writePostMergeVerification (mkdirSync/writeFileSync) | no |
| `pr-body` | factory | software-delivery-policy | PR-body citation hygiene prevents a false Linear PR-opened transition — Software Delivery/tracker-adjacent PR logic | no | no durable write | no |
| `prd` | factory | software-delivery-policy | product requirements documents are the Software Delivery product-record axis (FAFF-252/ADR 0016) | yes | prd.js :: cmdPrd (mkdirSync/writeFileSync of the PRD file) | no |
| `prd-checklist` | factory | software-delivery-policy | reads a checklist-style PRD — same product-record family as prd.js | no | no durable write | no |
| `prdr` | factory | software-delivery-policy | product requirements DECISION records — same product-record family as prd.js/adr.js | yes | prdr.js :: prdrAccept / prdrLand / prdrRenumber / cmdPrdr (writeFileSync/appendFileSync/renameSync/unlinkSync/rmSync of the PRDR file set) | no |
| `prepcheck` | factory | software-delivery-policy | verifies faff-prep attached its spec — Software Delivery prep-workflow policy | no | no durable write | no |
| `profile` | factory | software-delivery-policy | the infra-profile schema plus repo-mining acquirer describes a target repo's Software Delivery adoption shape | no | no durable write | no |
| `profiles` | governance | software-delivery-policy | DISAGREES with current_region (governance): its own banner calls the delivery profile "faff's dialect" — DELIVERY_PROFILE/ledger_outcomes are Software-Delivery-specific automation-posture vocabulary, not a generic Commissaire governance verdict; it sits in the governance region only because the flight recorder reads it | no | no durable write | no |
| `project-next` | factory | decision-kernel | the container (project\|parent-issue) transition function, same family as next.js | no | no durable write | no |
| `quality` | factory | software-delivery-policy | per-run quality/outcome telemetry, named directly in "Disposition, quality, economics ... -> domain views" | no | no durable write | no |
| `queue-state` | factory | decision-kernel | pure git-only queue_empty/all_parked derivation, named directly in the technical design's responsibility map | no | no durable write | no |
| `ratified-scope` | factory | software-delivery-policy | assembles the ratified-scope block from the decisions/PRD registers — same product-record family, composition only | no | no durable write | no |
| `reconcile` | governance | commissaire-governance | blocking run-end ground-truth reconcile is the current analogue of the RFC's terminal-safety reconciliation step | no | no durable write | no |
| `reconcile-recover` | factory | commissaire-governance | computes the auto-close verdict for a stale run membership from ledger/heartbeat/post-merge facts (read-only; the write, where it happens, routes back through heartbeat.js's ledger chokepoint) | no | no durable write | no |
| `regions` | factory | harness-and-skill-orchestration | the region map, require-graph direction lint, and region selftest runner are CLI-module structural conformance, not runtime governance | no | no durable write | no |
| `resumecheck` | governance | commissaire-governance | releases a dead headless-resume claim under the ledger lock (mutateLedgerUnderLock) — a liveness/ownership interlock over run-ledger.json | yes | resumecheck.js's fenced release step, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock) | no |
| `review-iteration-cap` | factory | software-delivery-policy | single-owner bound on the review fail-fix-review loop — Software Delivery review-gate policy | no | no durable write | no |
| `review-progress` | governance | commissaire-governance | the declared-effects chain (declare-before-act, observed-minus-declared) is the current protected-effect ledger the RFC's effect stream generalises | yes | effects.js :: cmdReviewProgress (mkdirSync/writeFileSync/renameSync) | no |
| `run-done` | factory | decision-kernel | the pure terminating-condition predicate, named directly in the technical design's responsibility map | no | no durable write | no |
| `run-ledger` | factory | decision-kernel | the standalone-interactive L2 mint/outcome-record entry point over the pure ledger-mutation contract, decision-adjacent even though the bytes land via heartbeat.js | yes | run-ledger.js :: initInteractive / recordOutcome, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock) | no |
| `run-outward` | factory | decision-kernel | the signals.outward producer feeding the run's next-action decision surface | no | no durable write | no |
| `run-record-prd` | factory | software-delivery-policy | records a PRD licence/root-container fact onto the run — the same product-record family as prd.js/prdr.js, even though the byte-write itself routes through heartbeat.js's ledger chokepoint | yes | run-record-prd.js's PRD-record verb, via heartbeat.js :: atomicWriteLedger (mutateLedgerUnderLock) | no |
| `run-start` | factory | decision-kernel | the pure run-start trigger predicate, same family as run-done/next | no | no durable write | no |
| `runcheck` | governance | commissaire-governance | verifies a beep-boop run actually dispatched its queue before claiming completion, the run-liveness interlock the flight recorder depends on | no | no durable write | no |
| `self-intake` | factory | software-delivery-policy | the same-repo/team mechanical gate on self-filed work — Software Delivery intake policy | no | no durable write | no |
| `sentry` | governance | commissaire-governance | live-run derailment detection and the hard kill-switch is the closest current analogue to a protected-effect prevention control | yes | sentry.js :: cmdSentry (appendFileSync of the kill-switch log) and heartbeat.js :: atomicWriteLedger via mutateLedgerUnderLock (kill-switch ledger write) | no |
| `sentry-poller` | governance | commissaire-governance | same governance family as sentry — a detached watchdog acting on the same abort authority, per its own banner | yes | sentry-poller.js :: atomicWriteFile / appendLog (writeFileSync+renameSync / appendFileSync of poller state and log) | no |
| `sentrycheck` | governance | commissaire-governance | a Stop-hook staleness consult sibling of runcheck, reusing runcheck's liveness predicates verbatim | no | no durable write | no |
| `spec-judge-evidence` | factory | software-delivery-policy | assembles the spec-review judge's evidence bundle — Software Delivery prep-review process policy | no | no durable write | no |
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
| `worktree-prune` | factory | harness-and-skill-orchestration | mechanical replacement of the prose worktree-hygiene guard — harness/dev-environment orchestration, not delivery policy | yes | worktree-prune.js :: cmdWorktreePrune (rmSync — destructive: removes stale worktrees) | no |
| `worktree-root` | factory | harness-and-skill-orchestration | the L4 lights-out entry point/runner mints and supervises the unattended run process — harness/dispatch orchestration over the decision-kernel functions it calls | no | no durable write | no |

## The write-site sweep

Step 3 of the build procedure requires the durable-artifact set assembled twice, from two independent directions, then diffed both ways. A set derived only from the rows' own `write_evidence` can only ever agree with itself.

**Swept scope, stated explicitly:** the whole repository, excluding only `test/` and `node_modules/`. The sweep was NOT restricted to `plugin/skills/faff/bin/lib/` — scoping it there would make it a second view of the same territory the derived set already covers, rather than an independent one. The master RFC's own example is the reason: `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs` writes `.faff/holdout/<key>.json`, and it lives outside `bin/lib` entirely.

### (a) Derived set

Every file this map's classification and ownership rows name in `write_evidence` or `canonical_writer`, restricted to files an `fs`-primitive sweep could in principle find (a git-ref push and a shelled installer script are named separately below, since no JS-primitive grep can find them):

```
plugin/skills/faff/bin/lib/config.js
plugin/skills/faff/bin/lib/gates.js
plugin/skills/faff/bin/lib/heartbeat.js
plugin/skills/faff/bin/lib/inflightcheck.js
plugin/skills/faff/bin/lib/intake-provenance.js
plugin/skills/faff/bin/lib/budget.js
plugin/skills/faff/bin/lib/machine-id.js
plugin/skills/faff/bin/lib/run-ledger.js
plugin/skills/faff/bin/lib/run-record-prd.js
plugin/skills/faff/bin/lib/resumecheck.js
plugin/skills/faff/bin/lib/hooks-ensure.js
plugin/skills/faff/bin/lib/integrity-digest.js
plugin/skills/faff/bin/lib/bundle.js
plugin/skills/faff/bin/lib/bundle-recover.js
plugin/skills/faff/bin/lib/corrective.js
plugin/skills/faff/bin/lib/merge-gate.js
plugin/skills/faff/bin/lib/ci-triage.js
plugin/skills/faff/bin/lib/post-merge.js
plugin/skills/faff/bin/lib/governance-check.js
plugin/skills/faff/bin/lib/gitignore-ensure.js
plugin/skills/faff/bin/lib/adr.js
plugin/skills/faff/bin/lib/decision-capture.js
plugin/skills/faff/bin/lib/andon.js
plugin/skills/faff/bin/lib/prd.js
plugin/skills/faff/bin/lib/prdr.js
plugin/skills/faff/bin/lib/fixtures.js
plugin/skills/faff/bin/lib/env.js
plugin/skills/faff/bin/lib/events.js
plugin/skills/faff/bin/lib/effects.js
plugin/skills/faff/bin/lib/sentry.js
plugin/skills/faff/bin/lib/sentry-poller.js
plugin/skills/faff/bin/lib/lights-out.js
plugin/skills/faff/bin/lib/worktree-prune.js
plugin/skills/faff/bin/lib/spec-review-pin.js
plugin/skills/faff/bin/lib/spec-review-window.js
plugin/skills/faffter-noon-evaluate/evaluate-call.mjs
```

Named separately (not JS-primitive-visible): the `git push <sha>:<ref>` build-claim/landing-claim compare-and-swap inside `bundle.js` (the file above is already listed for its own local-store writes); the `scripts/link-skills.sh` mkdir/symlink installer shelled from `gates.js :: cmdSync`.

### (b) Swept set

Seed: every `writeFileSync`, `appendFileSync`, `renameSync`, `mkdirSync`, `unlinkSync`, `rmSync`, `copyFileSync`, `cpSync`, `writeSync` call site in any `.js`/`.mjs` file in the repository outside `test/` and `node_modules/` (62 files). Closure: any function calling a seed site is itself a write site, repeated to a fixed point. The closure pass adds exactly one file the seed regex misses: `plugin/skills/faff/bin/lib/resumecheck.js` has no `fs`-primitive text of its own — its fenced-release step calls `heartbeat.js :: mutateLedgerUnderLock` by name, which is the actual write site. This is the `persist()`-wrapper case the method exists to catch.

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
plugin/skills/faff/bin/lib/adr.js
plugin/skills/faff/bin/lib/andon.js
plugin/skills/faff/bin/lib/budget.js
plugin/skills/faff/bin/lib/bundle-recover.js
plugin/skills/faff/bin/lib/bundle.js
plugin/skills/faff/bin/lib/ci-triage.js
plugin/skills/faff/bin/lib/claude-config-isolation.js
plugin/skills/faff/bin/lib/config.js
plugin/skills/faff/bin/lib/corrective.js
plugin/skills/faff/bin/lib/decision-capture.js
plugin/skills/faff/bin/lib/decisions.js
plugin/skills/faff/bin/lib/effects.js
plugin/skills/faff/bin/lib/engine-codex.js
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
plugin/skills/faff/bin/lib/lights-out.js
plugin/skills/faff/bin/lib/machine-id.js
plugin/skills/faff/bin/lib/merge-fence.js
plugin/skills/faff/bin/lib/merge-gate.js
plugin/skills/faff/bin/lib/post-merge.js
plugin/skills/faff/bin/lib/prd.js
plugin/skills/faff/bin/lib/prdr.js
plugin/skills/faff/bin/lib/queue-state.js
plugin/skills/faff/bin/lib/ratified-scope.js
plugin/skills/faff/bin/lib/regions.js
plugin/skills/faff/bin/lib/run-ledger.js
plugin/skills/faff/bin/lib/run-record-prd.js
plugin/skills/faff/bin/lib/resumecheck.js  [closure addition]
plugin/skills/faff/bin/lib/sentry-poller.js
plugin/skills/faff/bin/lib/sentry.js
plugin/skills/faff/bin/lib/spec-review-churn.js
plugin/skills/faff/bin/lib/spec-review-convergence.js
plugin/skills/faff/bin/lib/spec-review-pin.js
plugin/skills/faff/bin/lib/spec-review-window.js
plugin/skills/faff/bin/lib/worktree-prune.js
plugin/skills/faffter-noon-evaluate/evaluate-call.mjs
records/spikes/2026-07-10-faff-411/analyze.mjs
scripts/mcp-call-census.mjs
scripts/verify-split-parity.mjs
verification/external-verification/faff-labs/experiments/rig/score.mjs
verification/external-verification/results/2026-08-12-fly-l3-faff-472/tools/curate.mjs
```

### (c) The two-way diff and its resolution

**In (b) and not (a) — 27 files.** Every one resolves to a stated reason; none is a state-changing command wrongly recorded read-only:

- `eval/*.mjs` (12 files: `cli-driver`, `gen-cases-seeded`, `live-driver`, `prefix-planner`, `review-bench/build-requests`, `review-bench/code-review/build-requests-code`, `review-bench/full-bench`, `review-bench/run-bench`, `run-evals`, `run-live-evals`, `size-census`, `tokenomics`) — eval-harness tooling, not `REGION_MAP` commands. Out of this map's per-command grain by the spec's own design (classification covers the 114 CLI commands; the eval harness is a separate, already-scoped surface).
- `scripts/mcp-call-census.mjs`, `scripts/verify-split-parity.mjs` — repo-maintenance/CI scripts, not commands.
- `records/spikes/2026-07-10-faff-411/analyze.mjs` — a dated one-off spike analysis, not part of the live command surface.
- `verification/external-verification/faff-labs/experiments/rig/score.mjs`, `verification/external-verification/results/2026-08-12-fly-l3-faff-472/tools/curate.mjs` — external-verification experiment/result tooling, historical, not commands.
- `plugin/skills/faff/bin/lib/claude-config-isolation.js` — not a `REGION_MAP` command; a shared Claude-config test-isolation helper (`test/claude-config-isolation.test.mjs` exercises it), no independent CLI surface.
- `plugin/skills/faff/bin/lib/fs-lock.js` — the shared advisory-lock primitive underlying every `*UnderLock` writer above (`heartbeat.js :: mutateLedgerUnderLock`, `events.js :: appendRecordsUnderLock`). Folded into the rows that use it, not a separate row: it is infrastructure a write routes through, not itself an entitled writer of a named fact.
- `plugin/skills/faff/bin/lib/engine-codex.js` — **checked and resolved, not a gap.** `runCodexCall`'s `fs.rmSync(tmp, …)` cleans up a per-call scratch directory outside `.faff/`, `records/`, and the anchors tree; it is ephemeral working space, not a durable fact under this map's own `state-changing` definition (Vocabulary, above). `faff engine` correctly classifies `state_changing: no`.
- `plugin/skills/faff/bin/lib/merge-fence.js`, `queue-state.js`, `decisions.js`, `ratified-scope.js`, `regions.js`, `spec-review-churn.js`, `spec-review-convergence.js` (7 files) — each appears in the raw seed only via its own `--selftest` fixture (a scratch-directory exercise the classification's write-closure tracing deliberately excludes, per the Vocabulary note that a command's real behaviour is what `state_changing` grades, not its test scaffold). Each command's classification row already states `state_changing: no`; the sweep confirms rather than contradicts it.

**In (a) and not (b), before closure — 1 file.** `plugin/skills/faff/bin/lib/resumecheck.js`. Resolved by the closure pass (above): the write reaches the disk through an imported shared function, not a local `fs`-primitive call. After closure, (a) and (b) agree on this file.

**Net result:** every entry in both directions resolves to a stated reason. No state-changing command was found read-only, and no `write_evidence` cell was found to name a write the sweep cannot independently locate (the two named non-JS-visible mechanisms — the git-ref push and the shelled installer script — are recorded as sweep limitations on their own rows in the migration table, not as unresolved diff entries, since the classification and ownership rows for `build-claim`, `landing-claim`, and `sync` already name the actual out-of-band mechanism directly).

## Ownership, migration, and assurance tables

59 rows share one `row_key` set across all three tables (Ownership, Migration, Assurance), sectioned into six areas per the sizing guidance (the ownership table exceeds roughly 60 rows only marginally, but the sectioning is applied uniformly rather than judged row-by-row). Completeness is checked across the union of sections, not per section.

**On the row count.** The build procedure's own sizing note expects 70–90 rows, derived from "40 of the 114 registry commands have a same-named module … carrying a direct write call". This map independently found the SAME number — 40 state-changing commands — before adding artifact-only rows (`run-ledger.json`, the two chain-head witnesses, four anchor kinds, `holdout.json`, the per-issue spec file, `summary.md`, and four tracker-mutation kinds), landing at 59. The gap between 59 and the 70–90 estimate is a real, evidenced finding rather than a shortfall to paper over: **this codebase concentrates many state-changing commands behind a small number of shared chokepoint writers** — most visibly `heartbeat.js :: atomicWriteLedger`, which eight different commands (`heartbeat`, `budget`, `run-ledger`, `run-record-prd`, `resumecheck`, `lights-out`, `sentry`, `events`) reach through the SAME function via `mutateLedgerUnderLock`, and `events.js :: appendRecordsUnderLock`, which both `events` and `effects declare`/`effects observe` reach through the same generic append primitive. The estimate likely assumed one distinct writer per command; the actual architecture is more consolidated than that, which is itself useful Phase 1 evidence (a single-chokepoint writer is easier, not harder, to reason about at cutover). No row was merged or dropped to reach this count — every state-changing command and every durable artifact identified by the sweep above has its own row.

**Splitting rule applied.** Five commands cover more than one **kind** of mutation to the same artifact and are split accordingly, mirroring the tracker/anchor "one row per kind" rule: `adr` (draft / accept / renumber / supersede), `prdr` (draft / accept / land / renumber), `ci-triage` (flaky-register / verdict), `governance-check` (ledger-append / floor-artifacts), and `effects` (declare / observe). This is a completeness choice, not a count-inflation one: each split-out row has its own distinct write call, its own distinct evidence, and in three of the five cases a different downstream reader.

### Ownership table

#### Run record (10 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `run-ledger.json` | commissaire-governance | heartbeat.js :: atomicWriteLedger | runcheck.js, audit.js, sentry.js, disposition.js, merge-gate.js, governance-check.js, reconcile-recover.js, corrective-integrity.js | run | run-membership |
| `faff heartbeat` | commissaire-governance | heartbeat.js :: atomicWriteSingleValueFile | sentry.js, sentry-poller.js, runcheck.js, resumecheck.js | run-segment | run-segment |
| `faff inflightcheck` | commissaire-governance | inflightcheck.js :: cmdInflightcheck | turncheck.js | run-segment | run-segment |
| `faff resumecheck` | commissaire-governance | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from resumecheck.js's fenced release) | run-start.js, lights-out.js | run | run-membership |
| `faff sentry` | commissaire-governance | sentry.js :: cmdSentry | audit.js, runcheck.js | run | run-membership |
| `faff sentry-poller` | commissaire-governance | sentry-poller.js :: atomicWriteFile | sentrycheck.js, sentry.js | run-segment | run-segment |
| `faff lights-out` | harness-and-skill-orchestration | lights-out.js :: claimRunDir (mint) plus heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock) | run-start.js, resumecheck.js, heartbeat.js | run | run-membership |
| `faff run-ledger` | decision-kernel | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from run-ledger.js :: initInteractive / recordOutcome) | disposition.js, quality.js, economics.js | run | run-membership |
| `faff run-record-prd` | software-delivery-policy | heartbeat.js :: atomicWriteLedger (via mutateLedgerUnderLock, called from run-record-prd.js) | lights-out.js (prd_root_container / prd_creative_licence read-back) | run | run-membership |
| `faff machine-id` | external-adapters-and-infrastructure | machine-id.js :: realWriteFile | build-claim/landing-claim owner snapshots (bundle.js), sentry.js | none | none |

#### Effects (6 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff effects declare` | commissaire-governance | effects.js :: appendEffectEntries (delegates the byte-write to events.js :: appendRecordsUnderLock) | merge-gate.js, governance-check.js, audit.js | effect | none |
| `faff effects observe` | commissaire-governance | effects.js :: appendEffectEntries (delegates the byte-write to events.js :: appendRecordsUnderLock) | merge-gate.js, governance-check.js, audit.js | effect | none |
| `effects-chain-head.json` | commissaire-governance | events.js :: computeChainHead (called from events.js :: mintIssueAnchor) | effects.js verify path, merge-gate.js, governance-check.js | effect | none |
| `faff review-progress` | commissaire-governance | effects.js :: cmdReviewProgress | merge-gate.js, governance-check.js | stage-attempt | none |
| `faff build-progress` | commissaire-governance | effects.js :: cmdBuildProgress | merge-gate.js, governance-check.js, events.js :: mintIssueAnchor | stage-attempt | none |
| `faff landing-progress` | commissaire-governance | effects.js :: cmdLandingProgress | merge-gate.js, events.js :: mintIssueAnchor | stage-attempt | none |

#### Gates and merge (11 rows)

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

#### Corrective and containment (4 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff corrective` | commissaire-governance | corrective.js :: cmdCorrectiveAuthor | corrective-integrity.js, next.js | work-item | work-item |
| `faff integrity-digest` | commissaire-governance | integrity-digest.js :: atomicWriteVerdictBytes | audit.js, merge-gate.js | work-item | work-item |
| `faff andon` | commissaire-governance | andon.js :: writeAndonState | andon.js (its own re-read for idempotent notification) | run | run-membership |
| `faff worktree-prune` | harness-and-skill-orchestration | worktree-prune.js :: cmdWorktreePrune | none — a destructive hygiene action, not a durable record other code reads back | none | none |

#### Product records (12 rows)

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
| `faff decision-capture` | decision-kernel | decision-capture.js :: cmdExportVerb | the coordinator-transition shadow comparison (FAFF-826, out of this ticket's scope) | run | run-membership |
| `per-issue spec file` | software-delivery-policy | GAP — no bin/lib module writes it | faff-graft, faff-prep, gate and review commands that cite `records/specs/<name>.md` | work-item | work-item |
| `summary.md` | harness-and-skill-orchestration | GAP for the document itself — no bin/lib module composes it; sentry.js :: cmdSentry can best-effort appendFileSync a warning SECTION to a caller-supplied --summary-md path, but never mints or owns the document | park-history.js | run | run-membership |

#### Harness orchestration and anchors (16 rows)

| row_key | semantic_owner | canonical_writer | readers | identity | disposition_scope |
|---|---|---|---|---|---|
| `faff config` | external-adapters-and-infrastructure | config.js :: cmdConfigSet (and cmdConfigInit for first-write) | every command that calls config.js :: loadConfig / findConfig | none | none |
| `faff sync` | harness-and-skill-orchestration | scripts/link-skills.sh (shelled from gates.js :: cmdSync via spawnSync) | the operator's harness (skill discovery reads the linked directories) | none | none |
| `faff hooks-ensure` | harness-and-skill-orchestration | hooks-ensure.js :: cmdHooksEnsure | the harness's own hook dispatcher (reads the registered Stop-hook set) | none | none |
| `faff gitignore-ensure` | harness-and-skill-orchestration | gitignore-ensure.js :: gitignoreEnsure | none — repo hygiene, not read back by another command | none | none |
| `faff fixtures` | harness-and-skill-orchestration | fixtures.js :: cmdFixtures | the eval harness (eval-affected.js selects which fixtures a change needs) | none | none |
| `faff env` | external-adapters-and-infrastructure | env.js :: cmdEnv | the harness's compose provisioning step | none | none |
| `faff bundle` | commissaire-governance | bundle.js :: localBundleStore (via publishBundle) | bundle-recover.js | run-segment | run-segment |
| `faff bundle-recover` | commissaire-governance | bundle-recover.js :: reconstructProjection | the recovering run-segment's own subsequent commands (heartbeat, run-done, etc.) | run-segment | run-segment |
| `anchor: events` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js (post-merge, from the committed anchor) | work-item | work-item |
| `anchor: ledger` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js, audit.js | work-item | work-item |
| `anchor: effects` | commissaire-governance | events.js :: mintIssueAnchor | merge-gate.js, governance-check.js | effect | none |
| `anchor: floor-evidence` | software-delivery-policy | events.js :: mintIssueAnchor | merge-gate.js (post-merge floor re-evaluation from the committed anchor) | work-item | work-item |
| `tracker: status transition` | software-delivery-policy | GAP — no bin/lib module composes or performs it | queue-state.js, next.js, disposition.js (all read a tracker-status snapshot the agent already fetched, never live) | work-item | work-item |
| `tracker: comment` | software-delivery-policy | landing-comment.js :: renderBody (composes the ready-to-land comment body only; the module's own banner states it "NEVER merges" and does not post) | the GH Action that shells this verb and posts the rendered body | work-item | work-item |
| `tracker: label` | software-delivery-policy | label.js :: labelOp (composes the op descriptor only; the module's own banner states "the agent executes via the configured tracker MCP. NO tracker access") | the agent turn that executes the descriptor | work-item | work-item |
| `tracker: relation` | software-delivery-policy | GAP — no bin/lib module composes or performs it | findings-reconcile.js (computes candidate relations but never writes) | work-item | work-item |

### Migration table

#### Run record (10 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `run-ledger.json` | translated | a Phase 2A reader loads a pre-cutover run-ledger.json verbatim; it is never mirrored into the generic record system | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-ledger-init-interactive.test.mjs, test/heartbeat-concurrency.test.mjs |
| `faff heartbeat` | translated | a Phase 2A liveness reader accepts either the current heartbeat file or the generic liveness record for a given run-segment, never both for the same segment | (2) chain heads and ledger digests verify; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/heartbeat.test.mjs, test/heartbeat-concurrency.test.mjs |
| `faff inflightcheck` | translated | a Phase 2A reader treats an in-flight marker as a transitional liveness fact scoped to the run-segment it was minted under | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/inflightcheck.test.mjs |
| `faff resumecheck` | translated | same as run-ledger.json above — this row is one MUTATION KIND on that artifact (a dead-claim release), not a separate file | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/resumecheck.test.mjs |
| `faff sentry` | translated | a Phase 2A reader treats a pre-cutover kill-switch log entry as frozen evidence for that run; new runs after cutover use the generic effect-decision stream instead | (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sentry.test.mjs |
| `faff sentry-poller` | translated | the detached poller's state file is a transitional liveness fact scoped to the polling process, not carried into the generic record | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sentry-poller.test.mjs |
| `faff lights-out` | translated | a minted run directory stays a current-format run through Phase 0/1; nothing here creates a generic-format work item | (1) durably-published facts and artifacts; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/lights-out.test.mjs, test/lights-out-resume.test.mjs, test/scaffolder-lights-out-dials.test.mjs |
| `faff run-ledger` | translated | same underlying artifact as the run-ledger.json row; this row is the standalone-interactive L2 command path onto it | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-ledger-init-interactive.test.mjs |
| `faff run-record-prd` | translated | the PRD-licence fact travels with run-ledger.json; a Phase 2A reader treats it as part of that frozen record | (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/run-record-prd.test.mjs |
| `faff machine-id` | immutable-blob | the cached host id is read verbatim by a Phase 2A producer-binding check; it is never regenerated in place | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — machine-id.js has no dedicated test/*.test.mjs and its own module exports no --selftest fixture that exercises realWriteFile's write path directly |

#### Effects (6 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff effects declare` | translated | a Phase 2A reader treats a pre-cutover declared-effects.jsonl as frozen effect-intent history for that run; the generic effect stream starts fresh at cutover | (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs, test/effects-chain.test.mjs, test/effects-concurrency.test.mjs |
| `faff effects observe` | translated | same artifact and reader posture as the declare row; observation is a distinct event kind on the same chain | (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs, test/effects-chain.test.mjs |
| `effects-chain-head.json` | immutable-blob | the witness is copied verbatim into the anchor bundle and never regenerated for an already-anchored run | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects-chain.test.mjs |
| `faff review-progress` | translated | a Phase 2A reader treats the progress file as a frozen per-stage checkpoint | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |
| `faff build-progress` | translated | same posture as review-progress; also required alongside holdout.json at L4 per governance-check.js | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |
| `faff landing-progress` | translated | same posture as build-progress; carried into the anchor bundle for FAFF-846's fix-cycle counter | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/effects.test.mjs |

#### Gates and merge (11 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff merge-gate` | translated | a Phase 2A reader treats a pre-cutover merge record as frozen evidence for that work item's merge | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/merge-gate.test.mjs, test/merge-gate-local.test.mjs, test/merge-gate-controlflow.test.mjs |
| `faff ci-triage flaky-register` | rebuildable-projection | the flaky register is a rebuilt-from-history classification; a Phase 2A reader can regenerate it rather than migrate it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/ci-triage.test.mjs |
| `faff ci-triage verdict` | translated | a Phase 2A reader treats the verdict as a frozen per-attempt CI classification | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/ci-triage.test.mjs |
| `faff post-merge-check` | translated | a Phase 2A reader treats a pre-cutover post-merge verification as frozen evidence for that work item | (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | post-merge.js's inline postMergeSelftest (lines 177-275) |
| `faff governance-check ledger` | translated | a Phase 2A reader treats the CI-enforcement ledger line as frozen per-check evidence | (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-363-governance-check.test.mjs |
| `faff governance-check floor` | translated | a Phase 2A reader treats ac-checklist.json/review-verdict.json as frozen per-issue floor evidence | (1) durably-published facts and artifacts; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/faff-363-governance-check.test.mjs |
| `faff build-claim` | rebuildable-projection | a build claim is a lease over a work item, reconstructable from the git ref's current head; nothing here migrates into the generic record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle.js's inline buildClaimSelftest (lines 1637-1888) |
| `faff landing-claim` | rebuildable-projection | same posture as build-claim; a distinct ref namespace for the landing/endgame lease | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle.js's inline landingClaimSelftest (lines 2056-2157) |
| `holdout.json` | immutable-blob | a Phase 2A reader treats a pre-cutover holdout verdict as a frozen, code-blind evaluation artifact; carried into the anchor bundle verbatim | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | plugin/skills/faffter-noon-evaluate/evaluate-call.mjs's own inline `selftest` export; test/evaluate-call.test.mjs, test/holdout-verdicts.test.mjs |
| `faff spec-review-pin` | translated | a Phase 2A reader treats a pinned reviewer identity as a frozen per-issue fact | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/spec-review-pin.test.mjs |
| `faff spec-review-window` | translated | a Phase 2A reader treats the convergence-window start as a frozen per-issue fact | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/spec-review-window.test.mjs |

#### Corrective and containment (4 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff corrective` | translated | a Phase 2A reader treats a pre-cutover corrective input as frozen; the RFC's amendment/correction rule (Phase 2A) governs new corrective facts after cutover | (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/corrective.test.mjs |
| `faff integrity-digest` | translated | a Phase 2A reader treats the custody verdict as frozen tamper-detection evidence for that work item | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/integrity-digest.test.mjs |
| `faff andon` | translated | a Phase 2A reader treats the andon state as frozen per-run alert history | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/andon.test.mjs |
| `faff worktree-prune` | rebuildable-projection | the live-worktree set is itself a rebuildable projection of git state; pruning acts on that projection and creates no artifact to migrate | (5) uncommitted workspace state excluded from completion claims | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | worktree-prune.js's inline worktreePruneSelftest (lines 227-240) |

#### Product records (12 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff adr draft` | translated | a Phase 2A reader treats an ADR file as a frozen Software Delivery product record; ADR numbering stays a repo-local convention | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs, test/adr-l3.test.mjs, test/adr-slot.test.mjs |
| `faff adr accept` | translated | same as adr draft; acceptance is a distinct mutation kind on the same file | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs, test/adr-slot.test.mjs |
| `faff adr renumber` | translated | same as adr draft; renumbering rewrites the file's own identity, never another record's citation of it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs |
| `faff adr supersede` | translated | same as adr draft; a supersede mutation never rewrites the superseded ADR's original text (append-only status change) | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/adr.test.mjs |
| `faff prdr draft` | translated | a Phase 2A reader treats a PRDR file as a frozen product-requirements-decision record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs, test/prdr-loop-admit.test.mjs |
| `faff prdr accept` | translated | same as prdr draft; acceptance is a distinct mutation kind | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs |
| `faff prdr land` | translated | same as prdr draft; landing finalises the record for the shipped scope | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr-land-local.test.mjs |
| `faff prdr renumber` | translated | same as prdr draft; renumbering rewrites the file's own identity only | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prdr.test.mjs |
| `faff prd` | translated | a Phase 2A reader treats a PRD file as a frozen Software Delivery product record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/prd.test.mjs |
| `faff decision-capture` | translated | a Phase 2A reader treats an exported decision-capture record as frozen instrumentation history for that run | none stated — no safe-boundary condition names this row's fact | Rollback rule 2 (decision capture and shadow coordination disable without changing actions); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/decision-capture.test.mjs |
| `per-issue spec file` | immutable-blob | a Phase 2A reader treats a committed spec file as a frozen work-item artifact reference | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the write path to characterise |
| `summary.md` | rebuildable-projection | a Phase 2A reader treats summary.md as a human-facing projection, rebuildable from the ledger/events rather than a canonical source | (1) durably-published facts and artifacts | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the document's write path to characterise |

#### Harness orchestration and anchors (16 rows)

| row_key | migration_rule | compatibility_path | safe_boundary | rollback | characterisation_tests |
|---|---|---|---|---|---|
| `faff config` | translated | a Phase 2A reader treats .faffrc.yaml as the compatibility-facade config source; new domain-binding config uses the typed registry instead | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/config-set.test.mjs, test/config-defaults.test.mjs, test/config-two-file.test.mjs |
| `faff sync` | rebuildable-projection | the linked skill/CLI install is itself a rebuildable projection of the repo; re-running sync is the compatibility path, not a migration | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/sync.test.mjs, test/link-skills-worktree.test.mjs |
| `faff hooks-ensure` | translated | a Phase 2A reader treats the registered hook set as harness configuration, translated into whatever hook mechanism the target harness exposes | none stated — no safe-boundary condition names this row's fact | Rollback rule 4 (a new CLI alias routes back to the existing handler); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/hooks-ensure.test.mjs |
| `faff gitignore-ensure` | translated | a Phase 2A reader has no dependency on this row; it is repo hygiene, not a governance or delivery record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gitignore-ensure.js's inline gitignoreEnsureSelftest (lines 101-181) |
| `faff fixtures` | immutable-blob | a generated dataset manifest is a point-in-time snapshot; a Phase 2A reader treats it as an immutable eval-harness input, never mutated in place | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/fixtures.test.mjs |
| `faff env` | immutable-blob | generated compose material is a point-in-time infra artifact; a Phase 2A execution-infrastructure adapter regenerates it rather than migrating it | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/env.test.mjs |
| `faff bundle` | immutable-blob | the Phase 0 recovery bundle is explicitly "a replica and recovery input. It is not a new journal" (TECHNICAL-DESIGN, Phase 0) — never migrated, only ever superseded by a fresher publish | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 1 (additive recovery publication disables without changing current canonical files); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/bundle.test.mjs |
| `faff bundle-recover` | immutable-blob | recovery reconstructs current-format projections from the immutable bundle; it never mints a generic-format record | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (3) latest completed stage and membership outcomes are known; (4) every attempted protected effect is known, unknown, or reconciled; (6) a restart descriptor names the next permitted action | Rollback rule 1 (additive recovery publication disables without changing current canonical files); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | bundle-recover.js's inline bundleRecoverSelftest (lines 634-914) |
| `anchor: events` | immutable-blob | TECHNICAL-DESIGN-v5.md already lists `.faff/anchors/...` as "Immutable historical evidence; future artifact mapping required" | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/events-chain.test.mjs |
| `anchor: ledger` | immutable-blob | same posture as the events anchor row | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs |
| `anchor: effects` | immutable-blob | same posture as the events anchor row; only minted when a declared-effects.jsonl is present (FAFF-621) | (1) durably-published facts and artifacts; (2) chain heads and ledger digests verify; (4) every attempted protected effect is known, unknown, or reconciled | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs, test/effects-chain.test.mjs |
| `anchor: floor-evidence` | immutable-blob | ac-checklist.json/review-verdict.json/holdout.json/build-progress.json/landing-progress.json ride the anchor's generic byte-copy loop verbatim | (1) durably-published facts and artifacts; (3) latest completed stage and membership outcomes are known | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | test/events.test.mjs |
| `tracker: status transition` | rebuildable-projection | the RFC classifies tracker state as "a projection and command surface"; a Phase 2A reader rebuilds it from the tracker API rather than migrating a record | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the write path to characterise |
| `tracker: comment` | rebuildable-projection | same posture as the status-transition row; a comment is a projection artifact, not canonical state | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — landing-comment.js's own tests cover renderBody's TEXT, not the posting mechanism, which lives outside this repo (the GH Action's own `gh pr comment` step) |
| `tracker: label` | rebuildable-projection | same posture as the status-transition row | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — label.js's own tests cover labelOp's descriptor logic, not the executed MCP write, which is outside this repo |
| `tracker: relation` | rebuildable-projection | same posture as the status-transition row | none stated — no safe-boundary condition names this row's fact | Rollback rule 7 (historical evidence is never rewritten to resemble the rolled-back version); reversible (Phase 0/1 — no generic-format work item exists yet, so the irreversible boundary has not been crossed) | gap — no module owns the write path to characterise |

### Assurance table

#### Run record (10 rows)

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

#### Effects (6 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff effects declare` | J-C | appendRecordsUnderLock (events.js) is a lock-serialised, hash-linked append — a conflicting concurrent producer cannot land a record without breaking the chain | E-C | the master RFC's own worked example: "declare before acting"; `effects check` computes observed minus declared — detection and reconciliation, never prevention |
| `faff effects observe` | J-C | same chained-append mechanism as the declare row | E-C | an observation record is the detection half of the declare/observe pair; it never prevents an effect, only evidences it |
| `effects-chain-head.json` | J-C | computeChainHead is a pure hash fold over the chained declared-effects.jsonl bytes — it can only reproduce a head that matches the actual chain | n/a | n/a — the witness certifies the journal, it is not itself an effect |
| `faff review-progress` | J-D | the checkpoint records the writer's own claim atomically (mkdir/write/rename) with no independent producer check | n/a | n/a |
| `faff build-progress` | J-D | same atomic self-claimed checkpoint mechanism as review-progress | n/a | n/a |
| `faff landing-progress` | J-D | same atomic self-claimed checkpoint mechanism as review-progress/build-progress | n/a | n/a |

#### Gates and merge (11 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff merge-gate` | J-C | writeMergeRecord is called only after re-observing CI on the resolved head sha inside the impure shell around the pure decideFloor core | E-B | merge-gate.js is "the sole sanctioned `gh pr merge` path" — a single authenticated actor holds the only route to the protected merge effect, matching E-B's prevention posture |
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

#### Corrective and containment (4 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff corrective` | J-D | the corrective author records a validated input with no independent verification of the author's authority beyond the CLI's own validation | n/a | n/a — corrective authority constrains a future dispatch, it does not itself act |
| `faff integrity-digest` | J-C | atomicWriteVerdictBytes records a digest fold over the custody-tracked file set (corrective-integrity.js :: correctiveIntegrityDirs) — a tamper leaves a detectable mismatch | n/a | n/a |
| `faff andon` | J-D | self-declared alert state with no independent verification | E-D | a push notification is a genuine external effect (an outbound alert); andon.js records only its own self-attestation that the notification was sent, matching E-D |
| `faff worktree-prune` | n/a | n/a — no relied-on record stream results from a prune | E-D | deleting a worktree is an irreversible-to-that-copy external effect; the module self-attests ownership before deleting (worktreeAdminIds/ownMatches) with no independent verification |

#### Product records (12 rows)

| row_key | journal_class | journal_evidence | effect_class | effect_evidence |
|---|---|---|---|---|
| `faff adr draft` | J-D | an ADR draft is authored content with no independent producer-binding check beyond the CLI's own validation | n/a | n/a |
| `faff adr accept` | J-D | self-declared acceptance with no independent verification | n/a | n/a |
| `faff adr renumber` | J-D | self-declared renumbering with no independent verification | n/a | n/a |
| `faff adr supersede` | J-D | self-declared supersession with no independent verification | n/a | n/a |
| `faff prdr draft` | J-D | authored content with no independent producer-binding check | n/a | n/a |
| `faff prdr accept` | J-D | self-declared acceptance with no independent verification | n/a | n/a |
| `faff prdr land` | J-D | self-declared landing with no independent verification | n/a | n/a |
| `faff prdr renumber` | J-D | self-declared renumbering with no independent verification | n/a | n/a |
| `faff prd` | J-D | authored content with no independent producer-binding check | n/a | n/a |
| `faff decision-capture` | J-D | self-declared instrumentation export with no independent verification | n/a | n/a — read-only instrumentation causes no effect |
| `per-issue spec file` | J-D | SINGLE-WRITER FINDING: no `faff` command mints or attaches a spec file; the faff-prep skill's agent turn writes it directly with the Write tool and faff-graft commits it — there is no bin/lib canonical writer to name | n/a | n/a |
| `summary.md` | n/a | n/a — TECHNICAL-DESIGN-v5.md's own "Current records and artifacts" table already names the main writer as "Orchestrator" (faff-beep-boop prose), not a CLI module; sentry.js's --summary-md append is best-effort and opt-in (only when a caller passes the flag), never the document's mint; park-history.js parses the fenced JSON block back out but never writes it | n/a | n/a |

#### Harness orchestration and anchors (16 rows)

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
| `tracker: status transition` | n/a | n/a — project-next.js states explicitly it "NEVER reads or writes the tracker"; no bin/lib module was found composing a status-transition op descriptor at all (unlike the label kind below), so this is a genuine current-mechanism gap, not merely an agent-side execution detail | E-D | a tracker status transition is a genuine external effect performed by the agent via its tracker MCP tool call; the CLI records nothing about it and self-attests nothing, so the achieved class is the weakest, self-attestation-only E-D |
| `tracker: comment` | n/a | n/a | E-D | SINGLE-WRITER FINDING: landing-comment.js only composes ONE particular comment kind (ready-to-land); every other tracker comment (progress notes, park explanations) has no bin/lib composer at all and is written ad hoc in skill prose. The actual POST, for every comment kind including the ready-to-land one, is agent- or Action-side, self-attested, matching E-D |
| `tracker: label` | n/a | n/a | E-D | label.js validates the label against CONTROL_LABELS and computes idempotency, but "The single MCP write stays agent-side." per its own banner — the achieved class is self-attestation only (E-D), the same as the other three tracker-mutation kinds |
| `tracker: relation` | n/a | n/a — findings-reconcile.js's own banner: "It does NOT compute symptom similarity"; no bin/lib module composes a relation-mutation descriptor at all, a sharper gap than the label kind (which at least has a descriptor composer) | E-D | a tracker relation write (e.g. linking a finding to its fix) is performed by the agent directly via MCP with no CLI mediation and no self-attestation record at all — the weakest of the four tracker-mutation kinds |

## Disposition-scope table

Three rows, per the spec. Each names the current vocabulary in code, its source line, its semantic owner, and its gap.

| Scope | Current vocabulary in code | Source | Semantic owner | Gap |
|---|---|---|---|---|
| Run segment | No populated vocabulary found. `resumecheck.js` and `lights-out.js` reason about run-segment lifecycle (fenced release, mint) procedurally, but no module declares a closed enum of run-segment states | none — checked `governance-profile.js`, `resumecheck.js`, `lights-out.js`; no `run_segment_states`-shaped list exists | commissaire-governance (the RFC's "Run-segment ID" identity row) | No current implementation. A run-segment's state is inferred from heartbeat + ledger facts at read time, never named as a closed vocabulary |
| Run membership | `DELIVERY_PROFILE.terminal_states` (8 values: `shipped`, `pr-open`, `parked`, `errored`, `routed-out`, `unreached-budget`, `superseded`, `parked-window`) and `ledger_outcomes` (9 values: the same 8 plus `claimed-by-peer`) | `governance-profile.js:67` (terminal_states) and `governance-profile.js:126` (ledger_outcomes). The module's own comment at `governance-profile.js:49` states the two keys "are DELIBERATELY two distinct keys, not one" [list — the clause completes on line 50: "unifying them would change what runcheck or events accepts"] — though that comment's own parenthetical counts (6, 7) are now stale against the live arrays (8, 9); the qualitative point still holds and is verified directly against the arrays, not the comment's numbers | software-delivery-policy (this is `faff`'s own delivery dialect, not a generic Commissaire vocabulary — see the `governance-profile.js` classification row's DISAGREES finding) | Fully populated and actively used; no gap in the vocabulary itself. The gap is scope: this vocabulary answers "how did this run's membership of one issue end", never "is the work item itself accepted" |
| Work item | No populated vocabulary found. Grepping `accepted_under_contract` outside the master RFC returns nothing | none — checked `governance-profile.js`, `disposition.js`, and the whole of `plugin/skills/faff/bin/lib/` | commissaire-governance (the RFC's responsibility table gives Commissaire "terminal conformance") | **No current implementation.** The master RFC's four-state work-item terminal-verdict vocabulary — `accepted_under_contract \| outcome_rejected \| cancelled \| abandoned` — has no code counterpart anywhere in this codebase today |

`disposition.js` adds a third, run-SCOPED (not run-membership-scoped) split: its own banner (`disposition.js:13`) reads "needs-attention, never as clean" — a whole-run audit verdict, narrower than either row above and not itself a fourth disposition scope in the RFC's sense (it answers "does a human need to look at this run", not "what is this membership's or this work item's terminal state").

## The eight invariant families: current mechanisms

Reproduced from the spec, verified by reading the named modules at `174f62b7`:

| Family | Current mechanism | Module |
|---|---|---|
| Queue | Pure `queue_empty` / `all_parked` derived from durable gitkeys diffed against ledger `outcomes{}` | `queue-state.js` |
| Termination | Fixed safety floor plus the policy-weighted rung ladder to run-complete, continue, or escalate | `run-done.js` |
| Budget | Four-dimension envelope (until, max_attempts, tokens, cost) with at-ceiling outcomes stop, narrow, escalate; plus `parked-window` for a `budget.window` breach | `budget.js`, `governance-profile.js` |
| Liveness | Sole sanctioned write path to `.faff/runs/<run-id>/heartbeat` via tmp-plus-rename; staleness threshold shared with sentry. A read-only reconstruct-and-preview verb adds no liveness machinery of its own — the write-once claim belongs at the continuation boundary, not the read-only verb | `heartbeat.js`, `sentry.js` |
| Gate | Review, holdout, and merge gates; slot contracts validated by the schema-subset engine | `gates.js`, `contract-engine.js` |
| Merge | Pure `decideFloor` core plus an impure shell that re-observes CI on the resolved head sha; the sole sanctioned `gh pr merge` path | `merge-gate.js` |
| Effect | `declared-effects.jsonl` chain, declare before acting, `check` computes observed minus declared; detection only, never aborts | `effects.js` |
| Amendment | **No current mechanism** (established below, not merely asserted) | none |

### Amendment surface investigation

Three candidates were checked, each carrying part of the shape the master RFC's rule describes ("A material change creates a new immutable contract revision and a new admission decision"):

**`corrective.js`.** Quote (`corrective.js:468`): *"Collision-safe naming: derive the next seq from the HIGHEST existing numeric"* [the rule continues onto lines 469-470: never a bare directory-listing COUNT, since a deleted/compacted earlier artifact would make a count-based seq collide with a survivor]. Reading: each corrective author call mints a new, immutably-numbered input file — a revision-SHAPED fact — but `foldCorrectiveAuthority`/`foldCorrectiveConstraints` (`corrective.js:138` onward) then automatically FOLDS the cumulative set into a mandate with no accept/reject step. Verdict on this surface: it supplies the "new immutable revision" half of the RFC's rule, but not "a new admission decision" half — a partial match, not the mechanism.

**`contract-defs.js`.** Quote (`contract-defs.js:805-807`): *"let version = extraction.version; if (!Number.isInteger(version) \|\| version < 1) { violations.push(\`version ${JSON.stringify(version)} is not an integer >= 1\`);"*. Reading: `version` here is a well-formedness constraint on the SHAPE of one submitted lane-boundary-intent document (must be an integer ≥ 1), not an identity that increments across successive amendments of the same contract. There is no revision HISTORY here, only a per-submission current-shape check. Verdict: no revision identity exists on this surface.

**`ratified-scope.js`.** Quote (`ratified-scope.js:9`): *"It never parses the meaning of what it copies; it only cites it."* Quote (`ratified-scope.js:10`): *"This is a well-formedness"* [check, NOT an authenticity gate — the clause completes on line 11]. Reading: this module is an explicitly read-only, meaning-blind composer with no revision concept of any kind — confirming, on its own text, the spec's own hint that this candidate reads "on the face of it, no."

**Verdict, owned by Commissaire as a Phase 2A finding:** no current mechanism satisfies the RFC's amendment rule. `corrective.js` is the nearest analogue (it has the immutability half) but automates past the admission-decision half entirely; the other two candidates have no revision identity at all. This is not asserted from a first reading — it is the conclusion of checking all three named surfaces against the rule's own two clauses ("new immutable contract revision" AND "new admission decision") and finding no surface that satisfies both.

## The work-item terminal-verdict scope

The codebase carries one populated disposition vocabulary and it is run-membership scoped (`DELIVERY_PROFILE.terminal_states` / `ledger_outcomes`, both in `governance-profile.js`, detailed in the disposition-scope table above). `disposition.js` adds a third, run-scoped clean/needs-attention split. Grepping `accepted_under_contract` outside the master RFC returns nothing.

This map records the work-item terminal-verdict scope as **owned by Commissaire**, per the master RFC's responsibility table, which gives Commissaire "terminal conformance", with the entry **"no current implementation"** and the four-state vocabulary quoted verbatim from the master RFC: `accepted_under_contract | outcome_rejected | cancelled | abandoned`. This ticket adds nothing to `governance-profile.js` or any other module — placement in code belongs to the ticket that builds the selected cutover slice.

**Named unknown, carried forward rather than settled here:** the map's own evidence (the disposition-scope table above) shows that adding a fourth key to `governance-profile.js` would sit right next to the two deliberately-unseparated existing keys, whose own module comment argues against casual unification. Whether the work-item vocabulary belongs in `governance-profile.js` at all, or in a new Commissaire-owned module entirely, is a placement decision this map does not make — it is carried to the cutover-slice selection ticket (FAFF-944) as an open question, not resolved here.

The three scopes (run-segment, run-membership, work-item) are therefore not conflated by accident today; the run-segment and work-item scopes simply are not modelled in code, and this map's job — per the spec — is to say so plainly rather than to fill the gap.

## Gaps and named findings

Consolidated here for a reader who wants the punch list without re-deriving it from the tables above. Every item below is also stated on its own row where it applies.

**No canonical writer found in `bin/lib` (4 rows).**

- `per-issue spec file` (`records/specs/*.md`) — no `faff` command mints or attaches a spec file. `faff-prep`'s agent turn writes it directly and `faff-graft` commits it; there is no CLI mediation to name.
- `summary.md` — `TECHNICAL-DESIGN-v5.md` already names the writer as "Orchestrator" (`faff-beep-boop` prose), not a CLI module. `sentry.js :: cmdSentry` can best-effort append a warning SECTION via a caller-supplied `--summary-md` flag, but never mints or owns the document.
- `tracker: status transition` — `project-next.js` states explicitly it "NEVER reads or writes the tracker"; no `bin/lib` module composes even an op descriptor for this mutation kind (contrast with `label`, below, which at least has one).
- `tracker: relation` — `findings-reconcile.js` computes candidate relations but, per its own banner, "It does NOT compute symptom similarity"; no module composes a relation-mutation descriptor at all.

**Composer exists, but the actual write is agent-side (2 rows, a milder version of the same gap).**

- `tracker: label` — `label.js :: labelOp` composes and validates the op descriptor; its own banner states "The single MCP write stays agent-side."
- `tracker: comment` — `landing-comment.js :: renderBody` composes ONE particular comment (ready-to-land); its own banner states it "NEVER merges" and does not post. Every other tracker comment kind has no composer at all.

**One artifact resolved from an initially-assumed gap into a real (partial) finding.** `holdout.json`'s canonical writer is NOT a `bin/lib` module and is NOT purely agent-side either: `plugin/skills/faffter-noon-evaluate/evaluate-call.mjs`'s exported `main` function is a real, spawner-attested writer of `.faff/holdout/<key>.json`, enforced by a contract ratchet (`faff contract holdout-verdict --require-spawner-attested`) that rejects an inner self-declared `code_blind:true` claim. What remains an open, UNRESOLVED finding is how that spawner-attested path reaches the per-run `<run-dir>/<issue>/holdout.json` file `governance-check.js`/`merge-gate.js` actually read — no module was found performing that join, copy, or rename.

**Single-writer / shared-chokepoint findings (not a violation of "exactly one canonical writer" — the constraint is about a row needing TWO writers, and none did).**

- `run-ledger.json` is mutated by eight different commands (`heartbeat`, `budget`, `run-ledger`, `run-record-prd`, `resumecheck`, `lights-out`, `sentry`, `events`), but every one of them reaches the disk through the SAME function, `heartbeat.js :: atomicWriteLedger`, called only from `heartbeat.js :: mutateLedgerUnderLock`. `heartbeat.js`'s own comment states this outright: "NONE directly — every production mutation goes through mutateLedgerUnderLock." This is the cleanest possible instance of "exactly one canonical writer" — many callers, one writer.
- `events.jsonl` and `declared-effects.jsonl` are both written through the same generic `events.js :: appendRecordsUnderLock`, parameterised by which ledger file the caller names. Two different artifacts, one shared low-level write primitive underneath two distinct domain-level entitled functions (`events.js :: appendEventRecord` for the former, `effects.js :: appendEffectEntries` for the latter).

**Sweep-invisible mechanisms (named, not silently missing).**

- `build-claim` and `landing-claim` both write via a non-force `git push <sha>:<ref>` compare-and-swap (`bundle.js :: claimStoreCore`, wrapped by the exported `buildClaimStore`/`landingClaimStore`). No `fs`-primitive grep, however deep the closure, can find a git-ref push — it is a `spawnSync("git", ["push", …])` call, structurally invisible to the seed vocabulary this method uses.
- `sync` writes by shelling `scripts/link-skills.sh` (`gates.js :: cmdSync` via `spawnSync("bash", …)`), which performs its own `mkdir`/symlink outside this repository's JS entirely. `cmdSync` self-attests success from the child process's exit code with no independent verification of the resulting filesystem state.

**Vocabulary-fit check (the spec's own failure-mode trigger).** More than a handful of forced `n/a` cells would mean the five-class vocabulary does not describe this system. It does not trigger here: `journal_class` is `n/a` on 10 of 59 rows and `effect_class` on 45 of 59, but every `n/a` cell states WHY (either "not a relied-on record stream" for a one-off local artifact like `.gitignore`/generated fixtures, or "not itself a protected external effect" for a pure record fact like a ledger or PR-body sanitiser) — the pattern is expected given how few of this codebase's durable facts are ALSO protected external effects, not evidence the vocabulary is the wrong shape for the system. No row uses `n/a` on one class to dodge stating the other: the four rows carrying `n/a` on both (`summary.md`, `gitignore-ensure`, `fixtures`, `env`) are legitimately neither a relied-on stream nor a protected effect, checked individually, not defaulted.

**No blocker found.** The field vocabulary fits the codebase at the grain this map operates. The row count landed below the sizing estimate for a stated, evidenced reason (shared chokepoint writers), not because state-changing was narrowed to hit a target — see "On the row count" above.


## Integration smoke test

Run 2026-08-31 against this document and the two `TECHNICAL-DESIGN-v5.md` pointer lines, resolving all citations against commit `174f62b7`. All eight steps pass. Re-run after every content fix during authoring; the run recorded here is the final, passing run.

| Step | Check | Result |
|---|---|---|
| 1 | Read the recorded commit | **PASS** — `174f62b7` resolves to a real commit |
| 2 | Extract every cited repo-relative path (inline code span or table cell; prose directory mentions and markdown-link-only mentions are not citations) | **PASS** — 14 backtick-wrapped repo-relative paths extracted for the argv-safe existence check below, PLUS the 46 plain-text `test/*.test.mjs` paths in the `characterisation_tests` column, which the spec's step 2 also names (a repository-relative path in a table cell). Those 46 are checked for existence at the recorded commit by a separate pass (all 46 resolve at `174f62b7`), so the map's step-2 scope matches the spec's rather than narrowing to code-spans only. Extraction is deliberately conservative: a code span is only treated as a checkable repo-relative path when it carries a repository-root-relative directory prefix (`plugin/`, `test/`, `docs/`, `records/`, `scripts/`, `eval/`, `verification/`, `bin/`) and a plain file extension, with no glob metacharacter, angle-bracket placeholder, or embedded `" :: "` compounding. This correctly excludes the much larger set of bare filenames this map cites for runtime artifacts that have no single fixed repository path (`run-ledger.json`, `events.jsonl`, `heartbeat`, `.faffrc.yaml`, `andon-state.json`, and so on all live under a per-run directory that does not exist in the git tree), and templated examples (`.faff/holdout/<key>.json`). Bare sibling-document citations in the same directory (`TECHNICAL-DESIGN-v5.md`, `FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md`) were confirmed to exist by direct inspection while building this map, since they were this map's own primary sources |
| 3 | Assert each extracted path exists at `174f62b7` (`git cat-file -e 174f62b7:<path>`, one argv element, never shell-interpolated) | **PASS** — all 14 resolve |
| 4 | Classification row count equals the `REGION_MAP` entry count read from `regions.js` at the commit | **PASS** — both 114 |
| 5 | Ownership, migration, and assurance tables carry identical `row_key` sets | **PASS** — all three carry the same 59 keys |
| 6 | Every quoted RFC/module fragment appears verbatim in its named file | **PASS** — 11 distinct quoted fragments checked, all verbatim. Every fragment was deliberately kept within a single physical source line (or explicitly split into per-line fragments with a bracketed continuation note) after two draft quotes were caught spanning a wrapped `//` comment line break — see the note below |
| 7 | Every `canonical_writer`/`journal_evidence`/`effect_evidence` "module + function" mechanism resolves (module exists at the commit, function declared or exported) | **PASS** — 60 distinct citations, all resolve |
| 8 | Recompute the step-3 (write-site sweep) diff from the two enumerated sets and assert it matches the document's claim | **PASS** — recomputed: 27 files in swept-not-derived, 1 closure addition (`resumecheck.js`) — matches "The write-site sweep" section exactly |

**What step 6 caught, and the fix.** Two draft quotes combined text across a wrapped `//` source comment (`corrective.js`'s collision-safe-naming banner across lines 468-470, and `ratified-scope.js`'s well-formedness banner across lines 9-10) into what read as one continuous sentence but was not continuous in the raw bytes — the exact failure mode this spec's own footnote warns is "easy to make and invisible without" this check. Both were split into single-line-safe fragments with an explicit bracketed note for the part of the sentence that continues onto the next comment line. A third draft error — attributing "The map names current writers, current consumers, integrity, future owner, translation, cutover, and rollback" to the master RFC when it is actually `TECHNICAL-DESIGN-v5.md`'s own "Phase 1" section — was also caught and fixed by this step, independent of the line-wrap issue.

**What step 8 confirmed.** The 27 files the sweep finds outside the derived set are eval-harness tooling, repo-maintenance scripts, one historical spike, and seven `bin/lib` modules whose only seed-regex hit is inside their own `--selftest` fixture (confirming, not contradicting, their `state_changing: no` classification) — none is a state-changing command wrongly recorded read-only. The one file the derived set names that the raw seed regex misses (`resumecheck.js`) is exactly the closure case the method exists to catch: it writes only by calling `heartbeat.js :: mutateLedgerUnderLock` by name, with no `fs`-primitive text of its own.

All eight steps pass. This map is internally consistent: every citation resolves, every quoted fragment is real, and the completeness diff is a computation a reader can redo, not a sentence. It does not prove `semantic_owner`, `journal_class`, or `effect_class` are the *right* judgements — that is what FAFF-827 and the FAFF-944 selection ticket's human decision are for.
