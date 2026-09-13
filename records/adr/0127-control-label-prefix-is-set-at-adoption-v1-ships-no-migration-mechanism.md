# ADR 0127 — Control-label prefix is set-at-adoption; v1 ships no migration mechanism

- **Status:** Accepted
- **Provenance:** loop
- **Date:** 2026-09-13
- **Issue:** FAFF-1044

## Context

FAFF-1044 makes faff's nine control labels (`faff-automate`, `faff-automation-hold`, `faff-parked`, `faff-jot-intake`, `faff-chain-gap-fill`, `faff-awaiting-review`, `faff-awaiting-spec-review`, `faff-repeat-parked`, `faff-claimed`) configurable: a new `tracking.label_prefix` config key (default `faff`) feeds a `controlLabels(prefix)` factory that derives every label's rendered name at read time. faff persists no prior prefix value and mediates no "change" event — the prefix is resolved fresh on every read, with no memory of what it used to be.

That statelessness raises a question the seam itself doesn't answer: what happens when an adopter changes the prefix on a repo that already has live tickets carrying the *old* prefix's labels? An open ticket tagged `faff-automate` doesn't get relabeled by the config change — it just sits there while every read-site starts looking for `<newprefix>-automate` instead. Three shapes were weighed: (i) a read-both transition window that accepts old and new prefix for a release; (ii) a `faff labels migrate` helper that prints the exact tracker relabel steps; (iii) treat the prefix as set-at-adoption and ship no migration tooling in v1, documenting the relabel as a coordinated human step. faff also has no tracker access to detect "live tickets exist" on a repo, so a hard mechanical lock against changing the prefix isn't implementable in the CLI regardless of which option is chosen — this is a documentation-level decision, not a code mechanism.

## Decision

Ship v1 with the prefix **set-at-adoption**: no read-both window, no `faff labels migrate` helper, no other migration tooling. Changing `tracking.label_prefix` on a repo with live tickets is documented plainly as a coordinated human relabel — the adopter relabels the affected tickets in the tracker themselves. This is the cheapest of the three options and lands in a single reviewable PR; the read-both window and the migrate helper are named out-of-scope extension points to pick up later if adopter demand appears.

## Consequences

- The moment the resolver switches to `<newprefix>-automate`, every open ticket still carrying the old `faff-automate` label silently becomes not-eligible — `automationEligible` stops matching it, and the same label's FAFF-223 intake-provenance eligibility-gesture basis is invalidated too. Work that was eligible simply stops being picked up: no park, no error, no signal at the point of failure.
- That failure mode is **fail-safe, not fail-open** — work stops rather than running unbidden — which is the acceptable direction. But it is silent, so it must be a *stated* policy the docs call out plainly, not an accident an adopter discovers by noticing nothing is landing. The documentation sweep must say, explicitly, that a prefix change on a live repo requires a coordinated relabel pass.
- No new state, no new command, no new tracker IO: `controlLabels(prefix)` stays a pure factory and the config layer stays the only place that resolves the prefix, consistent with the zero-config-byte-identical and no-tracker-IO invariants the rest of FAFF-1044 preserves.
- The read-both transition window and the `faff labels migrate` helper remain live options for a follow-up ticket if adopters actually hit this friction; neither is precluded by this decision, both are simply deferred.
- Because faff cannot see the tracker's ticket state, this ADR cannot be upgraded into a mechanical safeguard later without first giving faff some form of tracker read access — any future migration tooling has to route through that gap, not around it.
