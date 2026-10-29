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

## control-label group membership and name validation

- Chosen: `stacked` ungrouped; one permissive control-label-name validator; group membership built-in (not config-overridable). The only single-select group is `state` (`parked` + the four holds); `automate` is a standalone tracker-owned eligibility label and `stacked` stays ungrouped so it can coexist with a state label. A single permissive validator (letters, digits, spaces, colons, hyphens, underscores, mixed case; reject empty/whitespace/control chars) covers all trackers, not per-tracker rules.
- Rationale: the only single-select group is `state`; `stacked` must coexist with state labels (a stacked-and-open dependent can also be awaiting-review), so grouping it into `state` would silently clear a legitimately co-existing label; keeping the config surface minimal (built-in grouping, one validator) avoids a dead `eligibility` group classification and per-tracker validation policy.
- Scope: FAFF-1091 control-label naming/grouping — `labels.js` (`controlLabels`, `groupTransitionOps`, the `group` field on `CONTROL_LABEL_DEFS`), the new `resolveControlLabels`/`validateControlLabelName` in `config.js`, and the `faff label transition` verb. Does not make group membership config-overridable (out of scope) and does not introduce an `eligibility` group.
- Matches: control-label groups; label name validation; stacked grouping; control_labels; single-select state group
- Date: 2026-09-24

## Tracker status writes are governed by record, not chokepoint (no faff status set CLI)

- Chosen: Hold the `faff status set` anti-pattern. Tracker status writes stay agent-mediated (Step 5, In Review, ship, tidy); no status-set CLI verb is introduced. They are governed by a declare/observe detection record (`tracker-write` effect kind), never a chokepoint.
- Rationale: A chokepoint prevents, and there is nothing to prevent here. Tracker status is a breadcrumb — the write-once build-claim git ref is the real build mutex, and `faff-claimed` plus the status column are human-facing provenance read by nothing to gate a build — so no protected transition exists for a status-set gate to defend. A `faff status set` CLI would also break faff's standing boundary that the CLI stays pure and tracker-agnostic while tracker MCP writes stay agent-side (the same boundary that keeps `label.js` a pure op-descriptor emitter).
- Scope: faff's own governance of tracker effects (the Commissaire producer half), FAFF-1120 / FAFF-1108. Reopen only if audit ever needs status prevention, which it does not today.
- Matches: status-set anti-pattern; tracker-write chokepoint; govern tracker status; faff status set CLI; tracker-write record
- Date: 2026-09-26

## stale-emit doctor axis fires only where the TypeScript build is runnable

- Chosen: The `faff doctor` stale-emit axis fires only where the build is actually runnable — a source/dev checkout with the `plugin/skills/faff` TypeScript toolchain installed and resolvable (e.g. `node_modules/typescript` present) — and skips otherwise. It does NOT gate on "tsconfig absent", because an adopter marketplace copy ships `tsconfig.json`, the `.ts` sources, and the committed `.js` emits yet cannot rebuild (its devDependencies are gitignored and uninstalled). The gate is "can this environment run `npm run build`?", not "is a config file present?".
- Rationale: A stale-emit finding is useless to an adopter who cannot rebuild, so the round-1 "absent tsconfig → skipped" fail-safe (which never fires for an adopter copy, since those ship tsconfig) would nag a permanent, unactionable exit 1. Firing only where buildable makes the check meaningful (it nags the contributor who can fix it) and silent where it would be noise. The detection is the presence of a resolvable build toolchain — the same signal `npm run build` itself needs.
- Scope: FAFF-1172 only — the `faff doctor` heads-up half of the deferred TypeScript-emit safety net (`ts-foundation-mitigation-sequencing`); the CI freshness gate (FAFF-1171) is the enforcing half.
- Matches: adopter copy stale emit; doctor fires where buildable; tsconfig-absent fail-safe; emptyUnion exit 2 smoke test; stale-emit-check-fires-only-where-buildable
- Date: 2026-10-05

## A per-issue anchor's integrity unit is the run; only its conformance verdict is scoped

- Chosen: Keep the whole run event chain in the anchor, byte for byte, with its witness untouched. Narrow only what gets judged: grade the rows attributable to the anchored issue plus the genuinely run-wide ones, and ignore rows belonging to another issue in the same run. Never filter the chain to the issue's own rows.
- Rationale: Filtering either keeps the original witness, so the witness no longer matches the bytes and the chain reports broken, or re-mints the witness, so `prev` links are minted for adjacencies that never occurred. Either way the tamper-evidence is destroyed in order to pass the tamper-evidence check. Scoping the verdict instead leaves the integrity proof whole and fixes the actual defect, which is one issue's anchor reporting another issue's rows as its own problem. The rows are not lost: they are judged by their own issue's anchor, where they are in scope.
- Scope: Per-issue evidence anchors and any check that judges an anchor's `events.jsonl`; applies to CI legs, mint-time refusals and run-close self-verification alike, which must all use the same scope predicate or they disagree on every multi-issue run.
- Matches: Filter the anchored chain to the issue's own rows, or keep the chain whole and scope the conformance verdict; Should a per-issue anchor filter its event chain or scope its verdict; Whether a per-issue anchor's events.jsonl is judged whole-file or scoped to the anchored issue; Keep the whole run chain in the anchor, or filter it to the anchored issue's rows
- Date: 2026-10-20

## An unattributable evidence row is closed at the writer, never tolerated at the gate

- Chosen: When rows carry no issue and so cannot be graded, fix the writer so the rows stop being produced. Do not choose how much ungraded residue to tolerate at the gate, and do not weaken a live gate to let the residue through. Where a grading rule must cope with existing residue in the meantime, the writer fix is ordered first and the ordering is carried as a tracker `blocks` edge, not as a note in a spec.
- Rationale: Both gate-side options are a choice about how large a blind spot to accept; the writer fix is the only one that shrinks it. The residue is also cheap to close at source, because the rule already exists and the writer already declares itself bound by it. Ordering it first means the weaker grading posture is never the project's actual posture, which matters because the enforcement here is a committed test on a required check rather than a switchable setting, so a weakening lands with the code and there is no window in which it is harmless.
- Scope: Evidence and event writers whose records carry an issue, and any gate that grades them; the ordering rule binds every ticket in such a cluster, so sibling tickets answering the same severity question must take the same answer.
- Matches: Accept the weaker trusted gate for the multi-issue residue, or hold the evidence-schema: require flip until the residue has a PR-blocking home; Accept a weaker gate for multi-issue unattributable rows, or hold the enforcement flip; Whether to suppress a non-conforming decision-capture append, or keep writing the ungradeable row; Should an unattributable evidence row gate, warn or be skipped; Whether a row of an issue-scoped type carrying no issue gates the anchor it appears in
- Date: 2026-10-20

## Commissaire stays faff-agnostic and does not expand

- Chosen: Commissaire's surface (the `faff commissaire` facade and its modules) gains no faff-specific object, verb, flag or concept: no `merge`, `graft`, `holdout` or run-ledger knowledge, and no reading of faff's run artifacts. By default it gains no new surface at all. Faff workflow needs are met by faff-side commands that read faff's own artifacts, assemble the request, and call Commissaire's existing `contract`, `effect`, `verdict`, `audit` and `governor` verbs unchanged; for FAFF-1426 that is `faff merge authorize` and `faff merge observe`.
- Rationale: Commissaire is the governance layer and is faff-agnostic by design (ADR-0123's object-verb grammar, the `--issue` to `--unit-id` deprecation, FAFF-1207). Adding workflow concepts would couple the governor to one producer, and every addition widens the trusted surface.
- Scope: every spec, ticket and recommendation that would add to `faff commissaire` or its modules. Growth needs an explicit operator decision.
- Matches: commissaire merge; commissaire new verb; commissaire new object; faff commissaire merge authorize; extend commissaire; commissaire faff-specific
- Date: 2026-10-29
