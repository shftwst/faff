# Decisions register

Human-ratified precedents that faff's autonomous resolve-attempt may cite when a spec punts a decision this register has already settled. One `##` section per decision; each carries `Chosen`, `Rationale`, `Scope`, `Matches` (semicolon-separated), and `Date`. See `faff decisions match --punt "<topic>"`.

## Cross-box liveness for a read-only recovery verb

- Chosen: A recovery verb that only reconstructs state and previews (writes no owner.status / owner.epoch) relies on the operator's killed-executor guarantee and adds no liveness machinery of its own. The write-once recovery-claim ref that prevents two executors continuing the same run concurrently belongs at the continuation / owner-state-write boundary (faff lights-out --resume), not in the read-only verb.
- Rationale: A read-only reconstruct-and-preview verb structurally cannot double-continue because it never writes owner state, so the distributed mutex belongs where owner state is actually written. Putting it in the read-only verb over-scopes it and adds an unnecessary external owner.status-adjacent writer (a new ADR exception) for a guarantee it does not need.
- Scope: Phase 0 runtime recovery and resume; any verb that reconstructs run state versus one that continues it.
- Matches: cross-box liveness; recovery-claim ref; double-continue; read-only verb liveness; operator killed-executor guarantee
- Date: 2026-08-17

## Gateway kernel is a separate file from the bare-`/faff` skill

- Chosen: The shared kernel that sub-skills Read is `plugin/skills/faff/references/kernel.md`; `plugin/skills/faff/SKILL.md` stays the bare-`/faff` skill (routing + narrative + first-run offer) and is never Read by a sub-skill.
- Rationale: Operators enter via a specific skill, never bare `/faff`, so a sub-skill that Reads `faff/SKILL.md` inherits routing dispatch it can never trigger. Separating the files keeps that dead weight out of every sub-skill and build-subagent prefix.
- Scope: The faff gateway skill architecture; applies to how every consuming skill's load-line is written.
- Matches: gateway kernel/reference split; bare-/faff gateway; load-line; kernel.md
- Date: 2026-09-02

## First-run setup is a kernel pointer, not an inline offer

- Chosen: The kernel carries a one-line "no `.faffrc` resolved → run `/faff-onboard`" pointer; the heavy soft-offer (offer + decline-stub write + ensurers) lives only in `/faff-onboard` and the bare-`/faff` gateway.
- Rationale: `/faff-onboard` already owns onboarding; duplicating the offer inline in every skill's kernel is mostly-no-op machinery. A pointer is enough for a sub-skill.
- Scope: Gateway first-run handling.
- Matches: first-run; faff-onboard; no-faffrc offer
- Date: 2026-09-02

## Security floors are universal kernel residents, never lane-scoped

- Chosen: `Untrusted input (no-execute floor)` and `Blast-radius boundary` both stay in the kernel (Band A), Read by every lane; neither moves to a lane reference.
- Rationale: A safety floor a subagent could silently fail to Read is fail-open. Security floors must be carried unconditionally.
- Scope: Any future gateway/skill content-placement decision.
- Matches: safety floor; blast-radius boundary; untrusted input; fail-open
- Date: 2026-09-02

## Reference clustering defaults coarse, validated by contiguity_tax

- Chosen: Group lane-scoped gateway content into few coarse references (one per consumer cluster), not many fine ones; split finer only when the prefix-planner's `contiguity_tax` shows a disjoint consumer set and a net win.
- Rationale: Overlapping consumer sets make fine references raise the contiguity tax (a skill carries every layer up to the last one it needs) for little gain.
- Scope: Gateway reference decomposition and future prefix-cache layering.
- Matches: reference clustering; contiguity tax; coarse references
- Date: 2026-09-02

## Relocation lemma — move a kernel block to a reference all its consumers already Read

- Chosen: When a gateway block's every consumer already Reads reference R, relocating that block from the kernel into R is a strict improvement and should be done: the kernel shrinks by the block's tokens; every carrier that does not Read R drops those tokens; every carrier that does Read R is token-neutral (it carried the block via the kernel before, via R now); and the under-read lint stays green with zero load-line edits because every consumer already declares R. The precondition to check before each move is `consumers ⊆ R-readers`.
- Rationale: it turns "which blocks can safely leave the kernel" from a judgement call into a checkable condition, and corrects the intuition that relocating a broadly-consumed block over-carries its non-consumers — they already carried it via the kernel, so a reference home they don't Read is a pure saving for them and neutral for everyone else.
- Scope: any future gateway kernel/reference leaning (FAFF-970, FAFF-487, and later passes); the prefix-planner + tokenomics measurement confirms the real per-lane move.
- Matches: relocation lemma; kernel leaning; move block to reference; consumers subset of readers; kernel/reference placement
- Date: 2026-09-02

## Born-verifiable DONE means decidable, not one dedicated scenario per DONE item

- Chosen: A DONE criterion satisfies the born-verifiable bar when a test or an observation can decide it and the spec names what would be run and what the pass condition is. It does not additionally require its own dedicated Given/When/Then scenario. Grouped fixtures that each assert one branch with no OR-escape, plus scenarios covering the main behaviours and the named edge cases, satisfy the bar. A QA objection that a decidable DONE item merely lacks a 1:1 scenario is taste-level, not a defect, and is raised at minor severity or not at all.
- Rationale: The QA lens brief itself draws this line. `refute-qa.md:29` reserves full severity for a goal with no born-verifiable scenario, or a DONE item that cannot be decided, and `:50` says an objection with no nameable `predicted_consequence` is the honest signal that it is taste-level rather than a defect. Decidable-but-grouped is not undecidable. Requiring 1:1 turns a testability floor into a scenario-count quota, which inflates every complex spec without changing what a verifier can actually decide, and it is what drove the round-1 to round-2 objection count up on FAFF-1039 rather than toward convergence.
- Scope: The `QA` lens of `faffter-dark-spec-review` when judging a spec's DONE section against its Scenarios section. Does not relax the born-verifiable requirement itself, does not apply to a DONE item that is genuinely undecidable as written, and does not affect the holdout evaluator's own classification (`faff dod classify`), which reads criteria individually regardless of how scenarios are grouped.
- Matches: born-verifiable DONE; one scenario per DONE item; scenario coverage quota; acceptance gap; grouped fixtures vs dedicated scenarios; QA testability bar
- Date: 2026-09-13

## faff git-ref storage location follows bundle_store

- Chosen: All faff git refs (bundle, recovery, and build-claim) honour `bundle_store`. Under `bundle_store: local` they stay on-box and are never pushed to origin; under `git-remote` they push to origin. `buildClaimStore` is brought under the same `resolveBundleStoreName` resolution as the bundle and recovery stores, rather than being an origin-bound exception.
- Rationale: On-box-ness of faff refs is one axis, governed by `bundle_store`. A `bundle_store: local` operator has opted into on-box-only coordination, so the build-claim leaking operator identity and `machine_id` to origin was the one inconsistency. The write-once `claimStoreCore` contract is unchanged; only the storage backend switches.
- Trade-off (accepted): an on-box build-claim gives no cross-machine build lock, which a per-operator local repo does not need; teams needing cross-machine build coordination use `bundle_store: git-remote`.
- Scope: faff ref storage in `bundle.js` (`buildClaimStore`, `resolveBundleStore*`); local mode (FAFF-1059). Does not change `git-remote` behaviour.
- Matches: bundle_store; build-claim ref; refs/faff storage; on-box refs; buildClaimStore; ref storage location
- Date: 2026-09-21

## git-only eligibility default

- Chosen: git-only defaults opt-in; `automation_default: opt-out` removed; one eligibility model (`automate` present/absent) everywhere. Eligibility is `faff-automate` present → eligible, absent → not eligible, in tracker and git-only mode alike; there is no second eligibility mode and no per-ticket exclude label.
- Rationale: single functional eligibility signal; consistent across tracker and git-only; retiring `automation-hold` is then behaviour-neutral in every mode. Opt-out was the only reason `automation-hold`'s per-ticket exclude was load-bearing — with one opt-in model, absence already means "not automated", so no exclude label is needed anywhere. The only behaviour change lands on git-only opt-out repos, which now add `automate` per ticket to opt in (the same gesture tracker repos already use).
- Scope: faff eligibility model — `eligible.js`, the `automation_default` config key, and the git-only opt-out from FAFF-753.
- Matches: git-only opt-out; automation_default; eligibility default
- Date: 2026-09-24
