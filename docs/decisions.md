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
