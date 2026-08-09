# ADR 0062 — Sentry-2 Channel A ships gate-degraded: closed subtractive corrective-input schema plus a correct rung reachable only under asserted integrity

- **Status:** Proposed
- **Date:** 2026-07-12
- **Issue:** FAFF-326

## Context

Sentry-1 supervises a running faff loop with a three-rung ladder — `continue | pause | abort` — and a derailment either parks work or halts the whole run, even when a narrow, machine-derivable correction (tighten a threshold, forbid a surface, de-scope) would let the run proceed safely. A prior spike settled that a fourth rung is admissible only in a specific shape: **Channel A** — stop-and-redispatch with a machine-authored corrective input, consumed only at the next dispatch boundary, never a live write into a running lane — and only at **subtractive width**: a correction may narrow what the redispatched unit is allowed to do, never grant it new authority.

Two structural constraints force the shape this decision takes:

- Under a shared uid, faff cannot cryptographically stop a same-uid build lane from forging a corrective artifact — a prior fail-safe gate already established that the only honest trust signal is an outer-layer, launch-time declaration, and that gate ships **distrust by default**. Any corrective-authority mechanism built on top inherits that same fail-safe posture or it reopens the exact bypass the gate exists to close.
- The ladder's own un-subvertability rests on reading only a closed, orchestrator-owned surface — no field a supervised build subagent controls may ever influence the chosen intervention. A fourth rung must preserve that property exactly, not carve an exception for itself.

## Decision

Ship Channel A **gate-degraded**: the schema, the authoring path, and the consumption path all exist and are fully testable today, but the ladder's new `correct` rung is reachable in production **only** when the corrective-integrity gate reports its forge surface asserted — otherwise every corrective artifact on disk is surfaced for human relay (Channel D) and never acted on as authentic. This mirrors the precedent the fail-safe gate itself set: ship the mechanism inert, let the trust channel's own activation state — not a build-time flag — decide when it goes live.

Four choices make the mechanism safe by construction rather than by discipline:

1. **Subtractive-only via a closed op enum**, not a reviewed convention. The corrective-input schema's operation vocabulary is a fixed, closed set of narrowing operations (park with cause, forbid a surface, tighten a threshold, de-scope to a subset). Additive intent has no representation in the schema — there is no field to set, no flag to pass, that grants new authority. Anything outside the enum fails validation and routes to park / needs-human, never a special case.
2. **Authority is an explicit function parameter, never a signal-bundle field.** The ladder's evaluator gains a third argument — `authority` — computed by the orchestrator from the corrective-integrity gate directly and passed in, defaulting to unavailable. It is deliberately *not* a member of the closed signal-bundle allowlist the evaluator already reads, so no value a build subagent could inject into that bundle can reach it. This keeps the existing no-foreign-authorship property intact rather than opening a second, weaker channel next to it.
3. **`correct` sits between `pause` and `abort`, never above it.** The upgrade path is narrow: only one signal (the stop-and-redispatch thrash trip) ever maps to `correct`, and only by upgrading what would otherwise be a `pause` — every route that already terminates in `abort` is untouched. A co-tripping abort-class signal still wins the ladder's severity-max, so `correct` can never mask a genuine kill condition.
4. **Every corrective artifact is re-validated at consumption, regardless of who wrote it.** The consuming check re-runs the same schema validation the authoring path enforces; an artifact that is invalid, foreign, or additive-shaped is rejected and never folded into the constraint set, independent of the gate's trust state. Trust in *who* wrote an artifact is never assumed — only the schema and the gate decide what is actionable.

The corrective artifacts themselves live on the same forge surface the fail-safe gate already names as the one path an outer-layer declaration must cover — never a second, parallel location, which would fork the exact surface that gate protects.

## Consequences

- **Production behaviour is unchanged today.** Wherever the corrective-integrity gate's forge-surface declaration is absent, every derailment trip routes exactly as the three-rung ladder always has; `correct` is unreachable and any on-disk corrective artifact is relay-only. Only where that declaration is genuinely asserted does the fourth rung activate — activation is the trust channel's property, not this ticket's.
- **A sequential-narrowing residual is accepted, not eliminated.** Several individually-subtractive corrective inputs on one issue could, in aggregate, steer a unit's dispatch fairly narrowly even though no single input was additive. This is discharged by requiring every corrective input to cite the derailment verdict that triggered it and by keeping a full per-issue audit trail (the authored/consumed event pair) — the aggregate is always human-reviewable, not by construction-prevented. A live-run validation slice is expected to confirm this posture in practice.
- **Widening the correctable-signal set is a conscious future edit.** Only the stop-and-redispatch thrash signal upgrades today; extending `correct` to other derailment signals requires evidence from that live-run validation, not a default extension of this schema.
- **Empty-mandate detection is a decidable core with a doubt-parks-not-guesses fallback.** The fold that computes whether a cumulative constraint set has narrowed a unit's mandate to nothing decides what it can decide exactly (explicit contradictions) and returns "indeterminate" — never a guess — when the retained surface can only be judged by path-prefix reasoning the core deliberately does not attempt. An indeterminate or empty mandate always parks before dispatch; it never spins.
- **Fleet-scoped (multi-run) corrective authority and additive authority remain explicitly out of scope** — the schema has no representation for either, so extending to them is a new decision, not an extension of this one.

confidence: high

_Self-review: the Consequences above were checked against what actually shipped — the closed op enum, the explicit `authority` parameter (derived via a child process call so the evaluator's own module stays free of any direct dependency on the gate it consumes), the ladder ordering, and the re-validate-on-consumption rule are all present in the merged code, and the existing no-foreign-authorship test suite was extended (not replaced) to cover the new rung. Widening beyond the one correctable signal, and the fleet-scoped case, are named as explicit non-goals for a future decision rather than silently deferred._
