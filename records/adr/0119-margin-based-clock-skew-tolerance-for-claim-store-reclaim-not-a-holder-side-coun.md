# ADR 0119 — Margin-based clock-skew tolerance for claim-store reclaim, not a holder-side counter

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-25
- **Issue:** FAFF-906

## Context

`claimStoreCore.reclaimIfStale` (`plugin/skills/faff/bin/lib/bundle.js`) is the shared reclaim primitive behind `recoveryClaimStore` and `buildClaimStore` (and, once FAFF-842 lands, `landingClaimStore`). Its staleness verdict compares the reclaiming machine's `Date.now()` directly against a `last_heartbeat` timestamp written by the holder's machine. Two machines' clocks are never guaranteed to agree, so a reader whose clock runs ahead can misjudge a live, heartbeating holder as stale and win a reclaim it should have lost — a double-drain, since the CAS that follows only proves the ref hadn't moved, not that the holder is actually dead.

FAFF-906's ticket named two acceptable fix directions: a holder-side monotonic heartbeat counter/generation number (marked "preferred"), or an explicit clock-skew tolerance margin on the staleness threshold. The ticket's own scope statement forbids changing `claim.json`'s wire shape. A counter the reader could trust without comparing wall clocks requires the holder to write an always-advancing generation field the reader observes directly — which is exactly a wire-shape change, and would also require touching the holder-side heartbeat writer (`heartbeat.js`).

## Decision

Use a margin-based clock-skew tolerance at the single `reclaimIfStale` call site, not a holder-side monotonic counter.

`resolveClaimClockSkewToleranceSecs(env)` resolves a tolerance (default 60 seconds, override via `FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS`). `reclaimIfStale` computes `skewedNowMs = Date.now() - toleranceSecs * 1000` and passes that into each binding's `stalePredicate` in place of a bare `Date.now()`. The tolerance is **per-binding**, gated by a new optional `applySkewTolerance` boolean on the spec object each binding passes to `claimStoreCore` (undeclared/`true` = pay the tolerance; `false` = zero tolerance always). `buildClaimStore` keeps the safe default (`true`); `recoveryClaimStore` declares `applySkewTolerance: false`, because a wrong verdict on that path costs one avoided-but-harmless resume attempt — `confirmHead`'s compare-and-swap is the unconditional backstop regardless of the tolerance — while a wrong verdict on `buildClaimStore`/`landingClaimStore` hands over live, destructive work.

The 60-second default is roughly 6.7 percent of the 900-second default heartbeat-stale window: large enough to absorb realistic drift between unsynchronized machines, small enough to barely delay reclaiming a genuinely crashed holder. The tolerance is explicitly a best-effort mitigation, not a guarantee — skew beyond the configured value remains unmitigated, exactly as it was before this fix, and the spec's WHY section states this from its opening sentence rather than only in a later caveat.

No related or superseded ADRs found: `claimStoreCore`, `reclaimIfStale`, and claim-store staleness have no prior entry — this is the first ADR on this subsystem's reclaim behaviour.

## Consequences

- Every current and future claim-store binding that goes through `reclaimIfStale` inherits the tolerance mechanism automatically. FAFF-842's `landingClaimStore` gets the default `true` (cross-machine) tolerance for free once it rebases onto this change, with no code of its own — an undeclared `applySkewTolerance` field is the safe default. A future binding that is genuinely same-box and wants zero tolerance must declare `applySkewTolerance: false` explicitly, the same way `recoveryClaimStore` does; there is no automatic detection of same-box vs. cross-box topology.
- `confirmHead`'s CAS stays the load-bearing backstop for a wrong staleness verdict, on every binding, regardless of the tolerance. Nothing in this decision (or any future change to the tolerance value) is permitted to weaken or bypass that pin.
- An operator whose actual cross-box clock drift exceeds the 60-second default is not stuck with it — `FAFF_CLAIM_CLOCK_SKEW_TOLERANCE_SECS` is the escape hatch — but this is a per-invocation env override with no `.faffrc.yaml` counterpart (mirroring `FAFF_RUN_HEARTBEAT_STALE_SECS`'s existing precedent), so an operator who wants a persistent per-repo value must set the env var wherever faff runs, not in committed config.
- `claim.json`'s wire shape is unchanged. A future ticket that still wants a holder-side monotonic counter (the ticket's originally preferred direction) is not precluded by this decision, but it would need its own scope decision to change the wire shape and the heartbeat writer, and would supersede this ADR's tolerance mechanism rather than compose with it.

**Self-review.** The shipped diff matches this record: `resolveClaimClockSkewToleranceSecs` and the `applySkewTolerance`-gated call-site change land exactly as described, `recoveryClaimStore` carries the explicit `applySkewTolerance: false` field with its own disclaiming comment, and `buildClaimStaleAware`/`runIsHeld`/`claim.json` are untouched — the Consequences above hold against what actually shipped, not a spec-time guess.

confidence: high
