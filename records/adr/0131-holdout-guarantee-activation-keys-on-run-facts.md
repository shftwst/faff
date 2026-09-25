# ADR 0131 — Holdout guarantee activation keys on run facts, not the L-level label

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-09-25
- **Issue:** FAFF-1040

## Context

The code-blind holdout guarantee — the evaluator's `meets-spec | missing | blocked` verdict folded into the merge floor — fired only at `level === "L4"` (`decideFloor`, contract-defs.js; the two merge-gate ternaries `holdout: level === "L4" ? readHoldout(...) : "not-applicable"`). ADR-0130 (FAFF-1072) re-keyed the admissibility gate and the custody stamp onto run facts but explicitly declined to generalise the holdout guarantee, leaving it on the level label (ADR-0130 line 22). This ADR is the named follow-up.

Two problems followed from keying on the label:

- An unattended **L3** run merges to `main` with no code-blind check, even where the check could run. The risk the guarantee guards against (an agent's own build grading its own done) is present at unattended L3 exactly as at L4.
- An L4 run with no born-verifiable Definition of Done, or no system-under-test to stand up, **parks on a non-defect** ("holdout: missing") — the check is demanded where it cannot run.

The FAFF-1073 spike measured the shape of this: 19.3% of specs are non-born-verifiable (holdout cannot meaningfully run), per-ticket SUT standup is cheap where a SUT exists (~2.7s, 0 faults), and the code-blind cage is a proven per-environment capability, not a per-ticket one.

## Decision

The holdout guarantee's binding merge-floor activation is a pure function of the **capability facts**, not the L-level label and **not a config opt-in**: a fresh, caged, code-blind verdict is enforced; its absence steps aside, labelled.

- A new pure predicate `resolveHoldoutPosture(caps)` (contract-defs.js, beside `requiresSelfConsistencyStamp`) returns one of **two** merge-floor postures: **strict** (block on a non-`meets-spec` holdout) or **pass-through** (a capability was legitimately absent, labelled with which — never a park on a non-defect). It keys on the capability facts alone and is level-agnostic: a present, fresh, caged verdict is enforced at any level.
- Each capability is a **three-way** read (`satisfied | absent | faulted`), not a boolean. **Faulted is evaluated before absent**: a present-but-unreadable, torn-down (`terminated`), or stale capability artifact fails safe to **strict** (blocks), never pass-through. Only a genuinely-absent capability (ENOENT, no verdict, no cage promised) yields pass-through. This is what stops the generalisation from *inverting* today's L4 fail-closed posture, where an absent/unreadable `holdout.json` blocks.
- `decideFloor` blocks the holdout leg iff `holdout_posture === "strict" && holdout !== "meets-spec"`. An extraction that never set the posture gets a level-aware back-compat default (L4 → strict, else pass-through), byte-identical to the old gate; the merge-gate shell now sets it explicitly from `resolveHoldoutPosture`.
- **No config opt-in.** Activation is required on the facts, exactly as admissibility (ADR-0130) is required for any unattended run with no toggle. "Which tickets get holdout" is capability-determined — a ticket with a fresh, caged code-blind verdict activates strict; one without passes through, labelled — not a config-flagged subset.

**The offer belongs at build start, not the merge floor.** An earlier draft carried a third posture, `offer` (attended runs, capability present), resolved at the merge floor from a mint-stamped `unattended` fact. That was wrong on timing: an offer surfaced at merge is useless because the operator has stepped away by then; an offer only helps up front, when the build is kicked off. So there is no `offer` at the merge floor, and no `unattended` read here at all. Whether to *run* a holdout on an attended run — the active offer — is a build-start interaction (its own follow-up); by merge time the only fact that matters is whether a fresh caged verdict was produced. This dropped the mint-time `holdout_guarantee.unattended` stamps and the ledger `unattended` read entirely.

This amends **ADR-0130 line 22**: the holdout guarantee no longer keeps its `level === "L4"` activation test. L4's other specialness (topology authority) is untouched.

## Consequences

- **The L4 gate legitimately loosens for no-SUT / non-born-verifiable runs.** An L4 run that used to hard-block on `holdout: missing` now passes through, labelled. This is the intended correction — the spike grounds it as removing false parks (19.3% of specs), not weakening real coverage. A run with a standable, code-blind-exposable SUT and a born-verifiable DoD still blocks strict.
- **The reachable capability signal is the holdout artifact, not the env-handle — for now.** The spec's Assumption 3 flagged a validation: are the capability artifacts reachable where the merge floor runs? At build time they are not, as written. The env-handle is an upstream, in-band `faff-contract:env-handle` block consumed inline by the evaluator; it is never persisted to the run dir, and the committed builder-view spec strips the holdout criteria, so `dodClassify` is not runnable at the floor either. The only merge-time on-disk evidence that a code-blind SUT was stood up and judged is the holdout verdict artifact itself (`<run-dir>/<issue>/holdout.json`, the same file `readHoldout` already consults). So `readCanRun` classifies the *read* of that artifact: ENOENT → absent (nothing stood up → pass-through), present-but-unreadable/stale → faulted (fail safe), fresh+readable → satisfied. This keys on the artifact that actually exists rather than one that does not, and it avoids the inversion a literal env-handle read would cause — keying on an always-absent env-handle would make holdout pass-through everywhere, including real external-SUT L4 runs that must still block. **The proper fix (follow-up) is to capture the capability facts in the run ledger at build time, when SUT standability is actually known, and read them here — turning the merge floor from a merge-time artifact re-derivation into a captured-fact read.**
- **A plumbing fault never becomes a silent skip.** The three-way read plus faulted-before-absent precedence is load-bearing, not a nicety: a naive boolean `can_run` would collapse "no verdict" and "artifact unreadable/torn-down" into one `false` and invert the L4 fail-closed posture. Freshness is guarded like `readHoldout`'s `holdoutIsFresh`.
- **The retrospective already-merged floor uses the same posture logic** as the live floor, never a divergent `level === "L4"` test — otherwise a run the live floor passed through would be refused retrospectively (no success evidence written).
- **Coupled ship.** The resolver, the `decideFloor` posture leg, and the merge-gate capability reads ship together.
- **Follow-up (recorded, not built here):** an active build-start holdout offer — attended runs are prompted to run the holdout when the capabilities are present (unattended runs auto-run); and the run ledger captures the run's capabilities (caged, SUT-standable, born-verifiable, code-blind) as they are established, so gates and the offer key on *captured* capabilities rather than the L level or a merge-time proxy.
- Future overnight-safety mechanisms follow this precedent — key on the fact, resolve it through a shared pure predicate — rather than re-introducing a `level === "L4"` activation test.
