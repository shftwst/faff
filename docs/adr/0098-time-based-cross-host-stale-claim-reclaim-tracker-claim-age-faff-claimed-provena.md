# ADR 0098 — Time-based cross-host stale-claim reclaim (tracker claim-age + faff-claimed provenance)

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-08-09
- **Issue:** FAFF-758

## Context

faff's only cross-machine coordinator is the tracker: an issue at `In Progress` is the claim that stops two orchestrators building the same ticket (FAFF-82). That claim carries no liveness signal, so a crashed run — on this host or another — leaves an `In Progress` indistinguishable from a live build, and recovery was manual.

Two earlier ADRs named the cross-host recovery seam and deferred it, both pointing at an owner-identity extension:

- **ADR-0007** made owner liveness "deliberately host-local" and noted a host id "could later" be added, while stating "this ADR does not solve that seam."
- **ADR-0008** said cross-host liveness "must add new owner-emitted on-disk fields."

Both framings assumed the missing piece was *identity* — a way to name a foreign host — and an *on-disk* signal. But an on-disk owner field is invisible across hosts (a different machine cannot read it), and faff runs as one bot user, so the host that set a claim is likely not even readable. More fundamentally, the stale-versus-live decision does not depend on *who* set the claim: a claim is stale when it has sat in its claim state longer than any legitimate build would take, whichever host set it. Identity changes no decision.

The one thing every orchestrator shares regardless of machine is the tracker, and the tracker already records the timestamp of each status transition. So the liveness signal can be read from state the tracker already keeps, cross-host, with no new store, no heartbeat traffic, and no host identity — provided faff can prove a given claim is its own before it reclaims it (auto-reverting a human-set `In Progress` would override human curation, a hard rule).

## Decision

Recover a stale cross-host (and same-host) claim with a **time-based, tracker-read staleness heuristic**, gated by a **provenance label**, not with an owner-identity or on-disk field:

- **Claim-age is the timestamp of the latest transition into the claim state**, read from the connector's own history surface (Linear: the latest `In Progress` `stateHistory.startedAt`) — never the issue-level `startedAt`, which does not reset on the FAFF-403 `In Progress → Todo → In Progress` retry-later bounce. A claim older than `claim_ttl_hours` (default 6, well above a typical build) is **stale**. The `age + TTL → live|stale` arithmetic lives in a pure `faff claim-verdict` CLI (clock injected, selftestable); the tracker read stays with the agent — the same decide-in-the-CLI / read-in-the-agent split as `faff eligible` and `faff next`.
- **Provenance is a `faff-claimed` label**, applied by `faff-graft` at the Step-5 claim (one write, at the status-write cadence — no per-interval heartbeat). Only a stale claim **carrying** `faff-claimed` is auto-reclaimed (`In Progress → Todo`) by `/faff-tidy`; a stale claim **without** it is human-set or unprovable and is surfaced, never reverted. Provenance comes from the label because Linear's `stateHistory` carries no actor and the who-changed-status trail is not known to be MCP-exposed.
- **Host-id is explicitly not taken.** The ADR-0007/0008 deferred owner-identity extension is *not* built: it is a write with no decision value (the verdict is time-based and host-independent), an on-disk field is invisible cross-host anyway, and faff's single bot user makes the host likely unreadable. This ADR amends both prior framings — the cross-host recovery seam is closed by a time-based tracker-read heuristic, not by owner identity or a new on-disk field.

The reclaim is the **second** enumerated, tightly-fenced `In Progress → Todo` backward move under the status-monotonicity guard (the first being the FAFF-403 claim-holder self-release). It is a third-party move (tidy, not the claim-holder), fenced to a provably-faff (`faff-claimed`), provably-dead (`stale`) claim at `In Progress`, so it never touches an issue at `In Review`/`Done` and never reverts a human's claim — the guard's actual concern (a different writer moving a further-along issue backward) is untouched.

## Consequences

- Cross-host and same-host crashed claims self-identify as stale and auto-recover to `Todo` without a human, replacing manual recovery. The blast radius is bounded to faff's own claims (the `faff-claimed` gate) and is non-destructive (a `Todo` re-queue, caught at merge by rebase-before-merge if a peer was in fact live).
- No new shared store, on-disk owner field, or heartbeat traffic is added — the mechanism reads state the tracker already keeps and writes one label at claim time. This is deliberately cheaper than the ADR-0007/0008 owner-identity path those ADRs deferred; a future host-id extension is only warranted if cross-host owner *identity* ever earns its cost independently, which the time-based decision does not require.
- The mechanism is tracker-agnostic by construction: "claim-age is the latest transition into the claim state" is a semantic each connector resolves; a connector that cannot expose it degrades to surface-only, never a false reclaim. git-only mode has no reclaim path (no shared tracker; same-host is covered by the existing local heartbeat).
- The correctness of the reclaim rests on reading claim-age from the *latest* transition, not the issue-level timestamp — the FAFF-403 bounce makes the top-level read a live-build false-positive. This is enforced by prose (the anti-pattern guard in `/faff-tidy`) and by the `faff claim-verdict` selftest boundary table; the connector-mapping half stays the agent's responsibility per connector.
- Same-host tighter early detection (reading the local heartbeat's 900s staleness, tighter than the hours-long tracker TTL) is left as a documented extension point — the tracker TTL already covers same-host, just less promptly.
