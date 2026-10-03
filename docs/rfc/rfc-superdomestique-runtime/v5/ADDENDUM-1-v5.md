# SuperDomestique runtime v5: addendum 1

Status: draft, not yet accepted
Date: 2026-09-27
Decision owner: project maintainer
Implementation inspected at: `5aa3b4f3` (origin/main, 2026-09-27)
Baseline: `6d5ce11a` (the v5 lock, 2026-08-16)

## Authority and purpose

The [master direction](FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v5.md) still controls strategy, gates and product outcomes. This addendum records what happened between the v5 lock and `5aa3b4f3`, names where the implementation departed from the plan, proposes how each departure is treated, and states what the remaining route now requires. It does not open v6.

Where this addendum and the [technical design](TECHNICAL-DESIGN-v5.md) disagree on implementation detail, this addendum is the fresher observation. Where it and the master disagree on strategy, the master controls until the maintainer accepts a decision listed in the final section.

## What was delivered

| Measure | At lock | At `5aa3b4f3` |
|---|---|---|
| Commits on main | | 297 |
| Releases (release-please) | 0.17.0 | 0.34.0 |
| CLI modules under `plugin/skills/faff/bin/lib/` | 85 | 131 |
| Lines in those modules | 45,869 | 77,620 |
| Commands in `REGION_MAP` | 114 | 132 |
| ADRs | 0121 | 0131 |
| Human acceptance gates passed | 0 of 7 | 1 of 7 |

### Progress by phase

| Phase | Delivered | Gate | Gate state |
|---|---|---|---|
| 0A harden and recover | Recovery bundles and fail-closed verifier (FAFF-819, 845); later-executor recovery (820); redaction at durable-write boundaries (107); run-id and machine-id hardening (757, 891); decision capture across nine kernels (821, 947, 954, 956, 1009); most carry-forward defects closed | FAFF-823 | Accepted 2026-08-30 |
| 0B outward evidence | Nine-scenario matrix banked at `verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/` (822); external-verification protocol v0.1 and the Fly.io L3 case (743, 734); public trust-claim audit (732); consumable releases | FAFF-824 | Paused; blocked by FAFF-740 and FAFF-588, both paused |
| 1 map and measure | State-authority map (825, built at `174f62b7`); cutover-slice selection and ADR-0122 (944, built at `121bd73c`); fidelity protocol and first result at `verification/reports/FAFF-826-coordination-fidelity/` (826, 949, 1022) | FAFF-827, FAFF-974 | Both paused |
| 2A external Commissaire | Facade with `schema:3` envelope and split-key authentication (828); noun-verb grammar (ADR-0123, 977, 980); `verdict conclude`, `audit seal`, `audit export` to depth (1000, 978, 979, 1008); standalone `commissaire` binary (999); bare Claude Code consumer harness (360, 1018); faff's own runner promoted onto the facade for the merge effect (1034); governed records for push, label, PR-create, ADR/PRDR, worktree-prune and tracker writes (1118, 1119, 1120) | FAFF-829 | Paused; the live operator-attested capture (FAFF-1030) is parked although its blocker FAFF-1029 merged 2026-09-13 |
| 2B one-shot comparison | Nothing | FAFF-831 | Not started; FAFF-830 blocked on 829 |
| Gate 1 | Nothing | FAFF-832 | Not reached; blocked on 974 and 831 |

The Linear projects for Phase 1 and Phase 2A (P-FAFF-97, 98, 99, 100) still show status Backlog although their build tickets are Done.

### Where the new code went

| Cluster | New modules | Lines |
|---|---|---|
| V5 programme (bundle, bundle-recover, bundle-seal-core, commissaire, producer-auth, decision-capture, shadow-fidelity, scenario-matrix, redact, machine-id) | 10 | 7,373 |
| Spec-review judge loop (spec-judge-evidence, spec-judge-casefile, spec-review-window, -pin, -reputation, -convergence, -iteration-cap, judge-trail, ratified-scope, adversarial-judge-scrub, heading-slug) | 11 | 4,933 |
| Runner supervision and recovery (effects-reconcile, inflightcheck, supervisor, run-record-prd, killable-spawn, reconcile-recover, resumecheck, turncheck, park-reconsider, punt-scan, lane-boundary, park-verdict) | 12 | 3,974 |
| Onboarding and holdout inputs (conventions, native-map, manifest, fields) | 4 | 1,958 |
| Build-review adjudication (FAFF-996) | 4 | 1,321 |
| Worktree, landing and merge plumbing | 5 | 914 |
| Growth inside pre-existing modules | | 11,278 |

The fastest-growing existing modules are merge-gate (+1,083), contract-defs (+1,059), gates (+951), config (+858), prdr (+646), adr (+514), validate-adapters (+443), events (+437) and sentry (+436). About a third of new code is V5 programme work. The largest single stream, the spec-review and build-review adjudication machinery, is not named anywhere in the v5 pack.

## Departures from the plan

Each row names the plan text, what main does, and the proposed treatment. "Ratify" means record the deviation as accepted; "correct" means bring the implementation or document back to the plan; "decide" means the maintainer chooses in the final section.

| Plan | Main | Proposed treatment |
|---|---|---|
| Technical design, fixed outcomes: TypeScript is the authoritative source language; new V5 modules are TypeScript-first | No `.ts` file, no `tsconfig`, no package manifest. FAFF-828's spec excluded TypeScript by name. Every new module is CommonJS or `.mjs` | Decide (decision 1) |
| Master, roadmap: Phase 2A begins after Phase 1 and Phase 0B accept. Technical design: the `commissaire` CLI arrives when the external facade is proved | 2A was built, the CLI shipped and the runner promoted with FAFF-824, 827 and 829 all unpassed. FAFF-824's text was amended to say it is not a prerequisite for FAFF-828. FAFF-999's delivery decision flipped ADR-0122 and ADR-0123 to Accepted in place of FAFF-827 | Ratify, and say so in the master's roadmap section |
| Master, terminal safety: `accepted_under_contract` requires an admitted contract revision, complete lineage, every mandatory evidence obligation, no unresolved effect, and a seal | `verdict conclude` (`plugin/skills/faff/bin/lib/commissaire.js`) refuses on no evidence, unadmitted or revoked producer, unreconciled escape, public-key fingerprint mismatch and ambiguous contract revision. Admission is scope-only; obligations, independence and waivers are not modelled (ADR-0123 records this). No seal precondition | Ratify as the Phase 2A depth, and keep public copy limited to the mechanisms proved. Full terminal safety is Phase 4 work at the earliest |
| Master, record identities: run, run segment, work item, contract revision, stage attempt, effect | `run_segment_id` exists in bundles, derived from the ledger owner epoch. `contract_revision` exists in `schema:3`. No stage-attempt, effect or work-item identity; the issue id stands in for the work item | Ratify for Phase 0 to 2A. Re-open at the first slice that needs retry or effect idempotency |
| Technical design, canonicality: no run is canonical in both record systems; writers never mirror one record into both | A governed run appends `schema:3` and `schema:2` records to the same `declared-effects.jsonl`, with `schema:2` suppressed only per covered merge (FAFF-1034) | Decide (decision 2) |
| Master, journal classes: J-C requires a producer binding unavailable to conflicting producers | FAFF-1034 ships custody option 3: the runner process holds `SK_commissaire` and the HMAC master. Authenticity holds against a forged producer record, not against the orchestrator. The out-of-process governor is punted | Ratify with the claim narrowed: for faff's own runs the facade gives author binding and mechanical mediation, not independence. Decision 3 sets the trigger for option 1 |
| Cutover selection, criterion 9: the merge floor gates on J-D self-declared review and CI evidence | Unchanged. The Commissaire grant now sits in front of the merge, but the review and CI evidence it gates on is still self-declared | Carry forward as a known gap; no change |
| Master, planning rules: parallel build work is reduced when review age or decision parks rise | Six acceptance gates have never left Backlog while 297 commits merged | Correct: schedule the gates as one human session before further Phase 2A widening |

## Changes since lock that fold into the plan

### Gate activation keys on run facts, not levels

ADR-0130 (FAFF-1072) and ADR-0131 (FAFF-1040) move the admissibility gate, the custody stamp and the holdout guarantee off the `level === "L4"` test onto the facts that make them necessary: `autonomous`, `unattended`, `dispatched`, and holdout capability. The FAFF-1073 spike restated the holdout question as conditions by capabilities rather than levels. The master's phases, evidence horizons and risk table are written in L3 and L4 terms. Treatment: keep L3 and L4 as the public trust ladder, and restate each Phase 0 and Phase 2 claim on the facts it depends on when the gate ticket is reviewed. Future safety mechanisms follow ADR-0130.

### The code-interface holdout stack

FAFF-1102 (session RPC wire, `docs/reference/session-rpc-wire.md`), FAFF-1103 (Tier-1 binding manifest, `docs/reference/tier1-binding-manifest.md`), FAFF-1104 (Node reflection bridge, `plugin/skills/faff/bin/faff-bridge-node.mjs`) and FAFF-1105 (env-slot code-interface branch) extend the code-blind holdout from services to plain code interfaces. FAFF-1106 and 1107 are pending. This is Software Delivery binding work and sits above the generic ports, as the master requires. Two things fold in:

- it is the first concrete realisation of the master's lane and isolation model, with the bridge on the SUT-cage side and the evaluator on the other, and the technical design's "Current lanes and isolation" section should cite it;
- the "Tier-1 / Tier-2" vocabulary collides with the glossary's reservation of "tier" for external-verification P-levels. One of the two needs a different word.

### faff's own runner on the facade

FAFF-1034 made faff's runner admit at run start and declare, authorise, observe and reconcile its merge effect, with a fail-closed chokepoint on a governed run. ADR-0126 lets the merge chokepoint self-declare its own effect, which removes the merge escape signal in exchange for a structural guarantee plus an `origin` marker. Both are consistent with the master's protected-effect section provided the custody caveat above travels with every claim. `docs/reference/GLOSSARY.md` (Commissaire row) and `docs/concept/positioning-and-language.md` (the "two halves" paragraph) still say the runner does not drive the facade. Both are wrong on `5aa3b4f3`.

### Governed records widened before the gate

FAFF-1118 to 1120 governed push, label, PR-create, ADR/PRDR, worktree-prune and tracker-status writes. The master says a shared protocol stabilises after two real producers exercise it. The second producer is still a fixture-grade consumer driven by the same maintainer, and its live capture is parked. Treatment: no further effect kinds until FAFF-829 has been sat, and FAFF-1030 is unparked first because its blocker is closed.

### Map drift

The state-authority map was built at `174f62b7` over 114 commands. `REGION_MAP` now holds 132, and the modules the map classifies as decision kernel or record substrate (merge-gate, contract-defs, gates, events) are among the fastest growing. FAFF-827 cannot accept the map as it stands. Treatment: regenerate the classification table as a delta over the same row keys before FAFF-827, and re-run the map's own integration smoke test.

### Fidelity evidence

The FAFF-826 result grades 6 of 58 replayable decisions, all on the `eligible` kernel, with no divergence. The other 52 have no action marker because every run in the body of evidence predates the FAFF-1009 wiring. The coordination question cannot move until a post-fix set of runs exists, which needs the Fly.io L3 runner image rebuilt on code at or past FAFF-1009 (tracked by FAFF-1022). FAFF-974 must keep the pre-fix and post-fix sets distinct.

## What this means for the remaining route

- **Phase 0B (FAFF-824).** The nine-scenario matrix, protocol and releases exist. The gate is blocked on FAFF-740 (claims linked to evidence at point of claim) and FAFF-588 (external-verification results committed in-repo), both paused. Unpause and finish those two, then sit the gate.
- **Phase 1 (FAFF-827, FAFF-974).** Regenerate the map delta first. FAFF-974 should record a null result on the pre-fix body of evidence and name the post-fix run count it will accept.
- **Phase 2A (FAFF-829).** Bullets 2, 8 and 9 have evidence in `verification/external-verification/commissaire-bare-claude/`. Bullet 1 needs FAFF-1030. Bullet 7 (TypeScript evidence for any moved entrypoint) passes vacuously and should be struck or re-worded under decision 1.
- **Phase 2B (FAFF-830).** Do not start until FAFF-829 is sat. The treatment arm now exists in a form the plan did not anticipate: faff's own runner under the facade with in-process custody. The comparison design must state whether the treatment is the external producer or the governed runner, and attribute prevention claims to the chokepoint, not the facade.
- **Gate 1 (FAFF-832).** The governance question now has one candidate qualifying event, the founded refusal and grant in the FAFF-360 capture. That is a seeded fixture and does not pass on its own. The coordination question has no evidence yet.
- **Code growth.** Every week of growth at the current rate raises the cost of any later TypeScript conversion or extraction slice. Decision 1 should be taken now rather than at the next gate.

## Is the horizontal outcome still reachable

The master's first product outcome is a protocol-driven runtime with domain bindings. Nothing built since the lock forecloses it, and the master's own rule is that the decision waits for Gate 1 and the Phase 4 second-use test. The three parts of that outcome are in different states.

| Part | State at `5aa3b4f3` | Evidence |
|---|---|---|
| Commissaire | Closer than at lock. Standalone binary with an import-independence guard; producer-neutral `schema:3` envelope; split keys; an external consumer that installed nothing from the factory; secret-free replay. The region lint still runs in CI | FAFF-999 test `test/commissaire-standalone.test.mjs`; `.github/workflows/validate.yml` runs `regions check`; `verification/external-verification/commissaire-bare-claude/` |
| Runtime kernel and coordinator | No closer. Nine pure kernels exist and are instrumented; the coordinator is still `plugin/skills/faff-beep-boop/SKILL.md`; the fidelity study graded 6 decisions; the typed ports in the technical design exist only as text | `decision-capture.js` `KERNEL_REGISTRY`; FAFF-826 report |
| Domain binding | Heavier, not lighter. Most new code is Software Delivery policy in modules that also hold kernel mechanics (`contract-defs.js` holds `decideFloor`; `merge-gate.js` holds the chokepoint). The binding shape has started to appear unprompted: the Tier-1 binding manifest, the `lane-boundary` field, and an evaluator that reaches the system only over a wire | Module growth table above; FAFF-859, 1102 to 1105 |

Two facts cut against the outcome and are cheap to fix now:

- the `schema:3` envelope keys every record on `issue` and `step` (`commissaire.js` lines 103, 492, 663), which are Software Delivery nouns the plan's out-of-scope list keeps out of the core model;
- in faff's own runs the runner holds the signing key, so Commissaire is not yet a trust boundary separate from the runner (custody option 3, above).

The cost of the eventual cut rises with domain-side growth, because the modules an extraction must pass through are the ones growing fastest. What keeps the option open without committing to it: the map delta (so the seams are known again), a rule that no further domain noun enters the facade envelope, decision 1 taken now rather than at Gate 2, and one real second use bound to the facade so the abstractions get pressure. The repository already holds candidates for that second use in the review-bench and tokenomics eval workflows (FAFF-904, FAFF-932), which is what Phase 4 step 1 asks for.

## Corrections to companion documents

| Document | Correction |
|---|---|
| Technical design, "Current code shape" | 85 modules and 45,000 lines are now 131 and 77,620; 180 test files are now 278 |
| Technical design, "Current lanes and isolation" | Cite the SUT-cage bridge and evaluator-cage topology from FAFF-1102 to 1105 |
| Technical design, "Interface names" | `commissaire` shipped 2026-09-04 under FAFF-999, before Phase 2A acceptance |
| Cutover selection, unknown U2 | Answered: `schema:3` records chain into the same effects ledger and the existing readers are unchanged (FAFF-828) |
| Cutover selection, unknown U3 | Answered: the E-C to E-B mechanism is the chokepoint verifying an Ed25519-signed grant (FAFF-828), realised on merge-gate and, for faff's own runs, under in-process custody (FAFF-1034) |
| Glossary, Commissaire row | Remove "faff's own runner does not yet drive the facade" |
| Names and language, "two halves" paragraph | Replace the last two sentences with the custody caveat |
| Glossary, naming decisions | Resolve the "tier" collision with the Tier-1 binding manifest |

## Decisions this addendum asks for

1. **TypeScript.** Options: (a) strike the fixed outcome and remove the TypeScript clauses from FAFF-827 and FAFF-829; (b) keep it and open a bounded foundation slice now, before the next 10,000 lines land; (c) defer to Gate 2. Default if undecided: (a), because six weeks of new code chose CommonJS and `.mjs` without objection.
2. **One ledger, two schemas.** Options: (a) read the canonicality rule per record kind, so a governed run's merge effects are `schema:3` canonical and everything else stays `schema:2`, and write that reading into the technical design; (b) split `schema:3` records into their own file. Default: (a), with the reading recorded.
3. **Custody.** Name the trigger for the out-of-process governor (option 1). Proposed trigger: before any public claim that faff's own merges are prevented, or before Phase 2B starts, whichever is first.
4. **Gate cadence.** Sit FAFF-824, 827, 974 and 829 in one session once FAFF-740, 588 and 1030 close and the map delta exists. Until then, admit no new governed effect kinds and no new adjudication modules.
5. **Vocabulary.** Choose between renaming the binding-manifest tiers or releasing "tier" from the external-verification reservation.
6. **Envelope nouns.** Options: (a) rename `issue` and `step` in the `schema:3` envelope to `work_item_id` and `stage` now, while one consumer exists; (b) freeze the current names and add the neutral fields at the Phase 4 binding. Default: (a), because the rename is cheapest before a second consumer depends on the field names. Note added 2026-09-28: FAFF-1142 (`f5e39485`) published a versioned facade schema reference under `verification/commissaire-facade/v0.1/` whose record schemas name `issue` and `step`, so option (a) now also bumps that reference. Option (a) stays the default; the cost rises again with every consumer that pins v0.1.

## Movement after inspection

Between `5aa3b4f3` and `2084139b` (2026-09-27 to 2026-09-28) main gained 13 commits. Three bear on this addendum: FAFF-1142 (the facade schema reference, above), FAFF-1140 (a governance-required run now fails closed when Commissaire admit fails, which the FAFF-1034 ratification row should cite), and FAFF-1106 plus FAFF-1107 (the evaluator speaks the session-RPC convention and the code-interface holdout path has an end-to-end code-blind conformance test, closing the pending items in the code-interface section). Release 0.35.0 shipped on 2026-09-27.

## Source basis

- Commit range `6d5ce11a..5aa3b4f3` on origin/main, inspected 2026-09-27.
- Module and line counts from `git ls-tree` and `git show` over `plugin/skills/faff/bin/lib/` at both commits.
- Tracker state from Linear on 2026-09-27: FAFF-823, 824, 827, 829, 830, 831, 832, 974, 1030 and projects P-FAFF-95 to 100.
- `verification/reports/FAFF-826-coordination-fidelity/report.md`.
- `verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/REPORT.md`.
- `verification/external-verification/commissaire-bare-claude/README.md`.
- `records/adr/0122` to `0131`.
- `records/specs/` entries for FAFF-828, 999, 1034, 1073, 1102 to 1105.
