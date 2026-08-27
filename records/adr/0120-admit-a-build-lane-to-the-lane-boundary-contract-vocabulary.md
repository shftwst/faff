# ADR 0120 — Admit a build lane to the lane-boundary contract vocabulary

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-27
- **Issue:** FAFF-894

## Context

The custody merge gate from FAFF-784 (the dormant detective-custody gate that binds a dispatched merge to a recorded `integrity-digest` verdict) already ships in `merge-gate.js`, but nothing arms it on the dispatched build path. Whether a merge counts as "dispatched" is decided by `laneBoundaryDispatchState`, which reads only the on-disk per-run `lane-boundary.json` and returns `"dispatched"` for any present, structurally-valid intent. So a build run only triggers `evaluateCustody` if it emits a valid `lane-boundary.json`.

The obstacle is the vocabulary. `LANE_BOUNDARY_LANES` admits exactly one lane value, `"evaluator"`, so the only intent a build run could emit today would declare itself an evaluator lane. That collides with the deferred FAFF-384 evaluator holdout cage (the code-blind evaluator isolation FAFF-384 will enforce): `laneBoundaryPromisesCage` arms the spawner-attestation ratchet when the intent reads `lane === "evaluator" && container === "own" && accesses.repo === "absent"`. A build run wearing an evaluator lane could satisfy that predicate and falsely arm a cage it has nothing to do with. The vocabulary as it stands forces a choice between not marking build runs dispatched at all, or marking them dispatched only by impersonating the evaluator.

## Decision

Widen the lane-boundary contract vocabulary to admit a second lane value, `build`: `LANE_BOUNDARY_LANES` becomes `["evaluator", "build"]` in `plugin/skills/faff/bin/lib/contract-defs.js`, together with the companion `CONTRACT_DESCRIBES["lane-boundary"]` semantics entry and the `ISOLATION_LANE_VOCAB` entry that `faff contract lane-boundary --selftest` gates.

A `build`-lane boundary is a valid intent, so `laneBoundaryDispatchState` returns `"dispatched"` and `evaluateCustody` becomes required for the run's merges. It can never satisfy `laneBoundaryPromisesCage`: that predicate is keyed on `lane === "evaluator"`, so a `build` lane fails it by construction, whatever its container or repo access. The cage stays evaluator-keyed; the dispatch signal and the cage promise remain separate questions asked of the same file.

Two alternatives were rejected:

- Reuse `lane: "evaluator"` for build runs. Rejected: it would arm the holdout cage on a build merge, a security regression.
- Add a caller flag or a run-ledger field to signal dispatch. Rejected: `laneBoundaryDispatchState` deliberately reads only the on-disk `lane-boundary.json`, never a caller flag and never a run-ledger field a same-uid lane could set. Trusting a caller-supplied signal reintroduces exactly the bypass the custody design closes.

Widening the enum is the only mechanism consistent with the shipped design. It produces the dispatch signal from the same structural artifact, carries no trust source a compromised lane could forge, and leaves the cage predicate untouched.

## Consequences

This widens the boundary contract set up by FAFF-784 (the custody merge gate) and FAFF-859 (the `host` locality axis). It is a cross-slice decision that later lane work must respect. Every reader of the contract now sees a two-value vocabulary, and any code that assumed `lane` is always `"evaluator"` (for instance, treating a valid boundary as a cage promise) must distinguish the two values.

The dispatch signal and the cage promise are now formally independent. `laneBoundaryDispatchState` answers "is this a dispatch cut" from mere validated presence; `laneBoundaryPromisesCage` answers the narrower "does this promise an evaluator cage". Later slices must keep these two reads distinct and must not collapse `"dispatched"` into `"caged"`.

Build and evaluator lanes must never share a run directory. The per-run `lane-boundary.json` declares exactly one lane, and this slice emits only the build-lane boundary (the never-coexist constraint recorded against FAFF-384). When FAFF-384's evaluator cage lands, that ticket owns reconciling the two boundaries, most likely a multi-lane file shape. This decision does not pre-commit the contract to that unshipped shape.

The build lane's `container` and `host` fields (chosen as `shared` / `local`) are declaration-only for a build lane: they are never asserted and never arm the cage, so an honest "runs locally with the repo present" declaration is correct and low-stakes. The `faff evaluator-preflight` assert-in path is unchanged and still refuses on a physical probe, never on this declaration.

The new enum value must ship with its companion `CONTRACT_DESCRIBES` and `ISOLATION_LANE_VOCAB` entries in the same change; `faff contract lane-boundary --selftest` gates their presence, so a partial widening fails the selftest rather than shipping a half-defined vocabulary. The cage predicate in `merge-gate.js` is unchanged and stays keyed on `lane === "evaluator"`, so the "a build lane can never arm the cage" property holds by inspection of the shipped code.
