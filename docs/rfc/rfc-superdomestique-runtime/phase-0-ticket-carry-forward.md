# Phase 0 carry-forward: which open tickets belong in the L4 evidence and hardening phase

**Status:** proposed
**Date:** 2026-08-12
**Model:** Claude Fable 5
**Scope:** every FAFF ticket in Backlog or Todo, pulled fresh from the tracker on 2026-08-12 and mapped against [master v4](v4/FAFF-SAFE-PROGRESSIVE-AUTONOMY-MASTER-v4.md) Phase 0A (runner durability) and Phase 0B (outward L4 evidence)
**Repository code reviewed at:** `79563ac`

## Purpose and method

Master v4 opens with a bounded phase: bank the current unattended product (Phase 0A runner durability, Phase 0B outward L4 evidence) before any attention goes to the runtime thesis. This document proposes which of the currently open tickets are that phase's work, so it starts with a deliberate scope rather than inheriting the whole backlog.

The pull covered all 130 open tickets: 103 in Backlog and 27 in Todo. The FAFF team has no Draft status; its unstarted states are exactly Backlog and Todo, so this is the complete candidate set. Statuses and priorities are as read on 2026-08-12; any later triage should re-pull rather than trust this snapshot.

Three dispositions are used:

- **Carry** into the phase: the ticket is Phase 0A or 0B work, or a direct prerequisite of it.
- **Hold** behind a named gate: the RFC now owns the ticket's timing; doing it early would rebuild the sequencing v3 and v4 corrected.
- **Routine maintenance**: proceeds on its own priority alongside the phase, but is not phase scope and must not gate the banked state.

A carry is not a promotion to Todo; several carried tickets have unmet prerequisites noted inline. Two carried tickets are autonomous-posture changes and stay behind the eval sweep, as flagged.

## Carry: trust-critical correctness

The banked state claims the evidence chain does not lie. These are the open defects in that chain, and they come first.

| Ticket | Why it is phase work |
|---|---|
| FAFF-778 (High, bug) | Interactive grafts skip the Step-9b ledger and anchor, so merge-gate refuses with anchor-missing. The evidence chain currently breaks on the interactive path; a reference release cannot ship on top of that. |
| FAFF-639 | `faff gates run` passed while CI failed `regions check`: the local gate ladder misses CI-only validate steps. Unattended runs trust the ladder, so local green must mean CI green. |
| FAFF-720 (Medium) | A run that opens no PR commits no run-level anchor, so tamper-evidence stops at the PR boundary. Phase 0A's rule is that every run leaves a durable record; this closes the no-PR case. |
| FAFF-748 (High) | The relocation ADR-0077 mandates: evidence writes and the merge locus move above the dispatch cut, outside the build lane's reach. This is the integrity boundary the assurance claims rest on. |
| FAFF-516 (Medium) | The integrity-boundary attestation channel for `--init` engine cages is undecided, and the existing read path cannot assert there. A live defect in an attestation path is a Phase 0 item by definition. |
| FAFF-465 | The adversarial review chain has no always-available local fallback and re-runs non-deterministically when the chain is exhausted. Unattended L4 must fail deterministically to a park, not loop. |

## Carry: L3 reliability

The v4 constraint binds twice: L3 is the product baseline and it is also the build capacity executing the programme. These fix live reliability problems in the runner loop.

| Ticket | Why it is phase work |
|---|---|
| FAFF-763 (Urgent) | Key sentry-acting on attendedness rather than the L4 mint, so unattended runs get the kill-switch. Safety of the runs the phase depends on. Posture change: held behind the eval sweep. |
| FAFF-614 (Medium, operator task) | Run the un-nested frontier re-baseline eval sweep. Prerequisite for FAFF-763 and FAFF-605 above and below: posture changes do not merge without the sweep. |
| FAFF-779 (bug) | needs-decision-first parks on the first failed resolve attempt instead of surfacing to Todo, churning the eligible pool the runner drains. |
| FAFF-759 | The prep queue has no claim, so duplicate preps can race. Claims and leases are exactly the Phase 0A coordination surface; fix it in the current mechanism now. |
| FAFF-744 (Medium) | The graft remote base resolver can hang on hosts without a timeout binary. A scheduled runner must not wedge on a network wait. |
| FAFF-214 | PR-body mentions of sibling tickets drag Done issues back to In Progress. The tracker is the control plane; false transitions corrupt the queue state supervision relies on. |

## Carry: runner durability (Phase 0A)

The distributed-run note's minimal slice, in ticket form.

| Ticket | Why it is phase work |
|---|---|
| FAFF-757 | Run-ID minting can collide within the same second. Machine-independent, collision-free run identity is the first Phase 0A deliverable. |
| FAFF-608 (Medium) | A CI watchdog job: sentry consult as a sibling workflow job over the heartbeat artifact. Interrupted-attempt detection must live outside the runner being watched. |
| FAFF-683 (High) | The cron reference workflow needs its target repo decided (outward versus self) and its on-resume preflight rule settled. This decision fixes where the outward reference scenarios live and how a resumed firing behaves. |
| FAFF-107 | Scrub secrets and PII from `.faff/` logs and the audit trail. Off-box journal publication raises the stakes: do this before evidence routinely leaves the machine. |

Two claude-box tickets, FAFF-542 and FAFF-543 (the cage must checkpoint the build worktree on an interval, because a container death before build-complete loses the uncommitted build), are absorbed rather than carried as written. The generic requirement, periodic workspace snapshots at stage boundaries so a dead executor loses at most one segment, is Phase 0A scope and lands cage-agnostically: the admission criteria state it and provide the check, and each cage implements it its own way.

## Carry: outward evidence and supervision (Phase 0B)

The reference release's claims must be inspectable by a stranger and supervisable by the operator.

| Ticket | Why it is phase work |
|---|---|
| FAFF-588 (Medium) | Commit external-verification results in-repo. The core external claim currently has zero recorded evidence a stranger can see; this is the single most direct 0B item. |
| FAFF-743 | Publish the external verification protocol, so the results above are reproducible rather than testimonial. |
| FAFF-734 (operator task) | Publish an inspectable Fly.io L3 production run: the public, reproducible case study of the runner the whole programme builds on. |
| FAFF-629 | Run the holdout error-rate production run on the live agentic lane: the honest end-to-end sensitivity number for what the independent layer actually catches. FAFF-474 (the live-lane holdout adapter against a docker environment) is its enabler and carries with it. |
| FAFF-777 | Tune and gate scope-drift's outward-boundary false-positive rate on L4 runs. False blocks are a first-class scorecard row; this measures and bounds one known source. |
| FAFF-316 (Medium) | A frontier adversarial audit of the L4 trust-critical gates. Independent scrutiny of the trust chain is the strongest outward evidence available to a solo operation; time-box it rather than skip it. |
| FAFF-472 | Wire the sentry watchdog's tripped verdict to the andon alerting channel. The channel shipped (FAFF-386, PR #619), so this is now unblocked and small. |
| FAFF-781 | Let operators follow admitted tickets and ticket starts through andon. Completes the push-supervision surface the phase's operator-comprehension exit criteria assume. |
| FAFF-668 (High) | The permission and appetite documentation describes a mechanic faff does not have: the cage owns permissions, faff checks a floor. Correcting claims to match actual enforcement is the assurance-honesty principle applied to the docs. |
| FAFF-740 | Connect every public claim to its evidence at the point of claim. The 0B release notes must distinguish implemented assurance from proposed architecture; this is that rule applied across the public surface. |
| FAFF-605 (Medium) | Per-level environment floor: state what each autonomy level needs from its environment and check it. Strengthens fail-closed preflight. Posture change: held behind the eval sweep. |
| FAFF-597 (High) | CI-caged evaluator: holdout runs as a no-checkout job so code-blindness is enforced by job topology rather than attestation. Second ring: upgrade if capacity allows; otherwise the weaker attestation class is recorded honestly in the assurance vector, which the phase permits. |
| FAFF-381 | Cage-engine acceptance run in anger. Second ring: carry only if the reference posture runs caged; the reference scenarios must exercise the posture actually recommended. |

## Carry: release and onboarding hygiene

A reference release needs a real release channel and an install a stranger can complete.

| Ticket | Why it is phase work |
|---|---|
| FAFF-585 (High) | There is no consumable release channel: marketplace installs track main, and 72 unreleased commits ship as the last version number. The 0B tag is meaningless until releases are real. |
| FAFF-174 (High) | release-please is not cutting releases for skills-prose changes because squash subjects lack a conventional-commit type. Same root problem as above; fix together. |
| FAFF-586 (Medium, bug) | Verify the documented install on a clean machine; the onboarding spelling contradicts the namespaced command form and no prerequisites are stated. The blocked and successful walkthroughs assume a working install. |
| FAFF-776 | The post-merge console steps for the contributor surface: private vulnerability reporting on, wiki off, the DCO check required. Small, outward-facing, finishes work already merged. |

## Carry: matched-comparison prerequisites (Phase 2B)

These are not Phase 0 scope, but they gate the one-shot comparison that runs immediately after it, in the same pre-runtime effort. The faff-lab design compares a full unattended pass (decompose, per-ticket graft, adversarial review, holdout) against the one-shot controls, so the top of the loop must work unattended for the treatment arm to exist.

| Ticket | Why it is carried |
|---|---|
| FAFF-492 (Urgent) | One unattended plan pass writes a drainable skeleton against the target repo shape. Without it there is no L4 arm to compare. |
| FAFF-499 (Urgent) | The whole-loop proof: trigger, plan, converge, drain, lights-out. The treatment arm end to end. |
| FAFF-310 (Medium) | The greenfield P1 end-to-end run on a fresh repo (architecture, environment, evaluate, unattended). The outward cross-repo acceptance shape the comparison runs in. |
| FAFF-745 | faff-plot publishes accepted PRD-review branches; supporting artifact publication for the plan pass above. |

## Hold behind named gates

These clusters are real work whose timing the RFC now owns. Doing them during Phase 0 would rebuild the sequencing the last two revisions corrected.

- **Runtime contract and vocabulary work** (FAFF-70, 71, 72, 73, 74, 75, 41, 25: the capability, role, and invocation config model replacing slot vocabulary). This is the contracts-before-implementation programme v2 proposed as its P2 and v4 defers to just-in-time ADRs in Phases 1 and 3. Held until the selected slice needs each decision.
- **Execution-independent governance consumers** (FAFF-360: the governance layer on a non-faff repo with no factory installed; FAFF-610: governance-check as a standalone marketplace Action over an evidence spec). These are the Phase 2A proof in ticket form. Held so 2A does them as the proof, with its exit evidence, rather than as ordinary features beforehand.
- **Unbundling, packaging, and naming** (FAFF-602 skill-lint extraction, FAFF-611 multi-package releases, FAFF-729 distribution strategy, FAFF-165 dropping the command prefix). Physical packaging and naming change only after Gate 2.
- **Runner-substrate exploration** (FAFF-718 Kubernetes runner pods, FAFF-726 Sprite viability, FAFF-653 and FAFF-649 cage launch and image, both external dependencies). Phase 0A durability makes executors replaceable; substrate comparisons get cheaper and more honest after it lands, and the current persistent-Machine substrate suffices for the phase.
- **Prompt-economics work** (FAFF-607 gateway split, FAFF-487 and FAFF-486 with parent FAFF-419 context reduction, FAFF-119 cache ordering, FAFF-501 grounding-cost study, FAFF-177 and FAFF-176 tracker-CLI swap). Deprioritised on 2026-08-10 pending before-and-after telemetry; nothing in Phase 0 changes that.
- **Learning and routing loops** (FAFF-452 with FAFF-458, 459, 460, 461; FAFF-449, 450, 451, 453, 454; FAFF-13, FAFF-393, FAFF-28). Post-gate: they optimise a loop whose shape the gates may change.
- **Effect-recovery automation** (FAFF-489 auto-revert mechanics, FAFF-37 real-side-effect rollback). The v4 posture for unknown effect state is park and reconcile; automating recovery is later work with its own admission bar.
- **Autonomy-surface expansion** (FAFF-388 data migrations, FAFF-389 multi-repo, FAFF-390 team identity, FAFF-392 dependency-update class, FAFF-12 lights-out environments, FAFF-20, FAFF-39, FAFF-249, FAFF-216, FAFF-15, FAFF-22, FAFF-528, FAFF-33, FAFF-29, FAFF-104, FAFF-509). New change classes and new surfaces widen the claim the phase is trying to bank; all post-gate.
- **Harness portability** (FAFF-694's children FAFF-701, 697, 674, 685; FAFF-479, FAFF-480, FAFF-613, FAFF-506). A parallel workstream with its own rationale; it is not Phase 0 scope and should not gate the banked state.
- **Eval-harness breadth** (FAFF-206, 693, 688, 731, 730, 638, 637, 636, 168, 167). The harness works today well enough to gate posture changes; widening it is not phase work. FAFF-474 is the one exception, carried above as FAFF-629's enabler.

## Routine maintenance

Not phase scope, not gated: these proceed on their own priorities and none of them blocks the banked state. FAFF-769 and FAFF-239 (skill-prose self-containment and path hygiene, both marked Urgent), FAFF-721 (the flaky hooks-ensure idempotency test), FAFF-768 (config-resolve the ADR doc root), FAFF-771 (lint-cli-coverage depth), FAFF-541 (containment-asymmetry docs), FAFF-511 (sentry reconcile-only spike), FAFF-682 (unowned-sibling-mutation actor signal), FAFF-438 (container target resolution), FAFF-412 (first-pass review model choice).

## What this leaves

Carried: 33 tickets (6 trust-critical, 6 L3 reliability, 4 durability plus one absorbed requirement, 13 outward evidence and supervision, 4 release hygiene) plus 4 comparison-arm prerequisites sitting formally in Phase 2B. Held: roughly 60 across the nine gate clusters. Routine maintenance: 9.

If the carry list completes, the phase exits in the state v4 requires: the evidence chain has no known holes, the runner does not wedge or race, every run leaves a durable off-box record with secrets scrubbed, a stranger can install the tool, reproduce the reference scenarios, and read the external-verification results in-repo, the operator hears about starts and trips without polling, and the published claims match the enforcement actually in force. Attention then turns to the runtime thesis with the current product banked, not abandoned.

Two caveats. First, the two posture changes in the carry list (FAFF-763, FAFF-605) merge only behind the eval sweep, which makes FAFF-614 a genuine early dependency. Second, this snapshot ages: the next grooming pass should re-pull the tracker and reconcile against this proposal rather than treat it as standing state.
