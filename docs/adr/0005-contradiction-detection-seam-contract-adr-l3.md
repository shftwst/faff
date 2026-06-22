# ADR 0005 — Contradiction-detection seam contract (ADR L3)

- **Status:** Accepted
- **Date:** 2026-06-22
- **Issue:** FAFF-198

## Context

L3 of the ADR supersession gradient detects, at materialisation time, when a newly-recorded ADR's `## Decision` contradicts a live (non-superseded) ADR, and offers to supersede the old one. Contradiction is **semantic, not lexical** — two Decisions conflict when they cannot both hold, regardless of shared words — so the detecting step cannot be a rules/keyword heuristic without both missing real conflicts and false-firing on unrelated ones.

This is the first non-deterministic step on the ADR-materialisation path. ADR-0002 set the house rule "assert at deterministic seams, never on prose"; the forcing question here is the inverse — *where the one unavoidable LLM-judgement call lives, and how it is bounded* so the mechanics around it stay deterministically testable and a future, richer architecture analyzer (FAFF-9, an unscoped Backlog epic) can take it over without a rewrite. Blocking L3 on FAFF-9 would strand it; baking judgement into the plumbing would make it untestable and un-swappable.

## Decision

Contradiction detection is a **single, bounded, side-effect-free LLM-judgement seam** with a fixed signature:

```
detect_contradictions(new_decision, live_adr_decisions) -> [{adr, contradicts, why}]
```

- It is the **only** non-deterministic step in ADR L3. It performs **no filesystem write, no `faff adr supersede` call, no tracker write** — it consumes the new Decision plus each live ADR's Decision and returns one `Result` per input ADR. Everything else is deterministic plumbing *around* it: input assembly (`faff adr live-decisions` — non-superseded filter, exclude-new, read each `## Decision`), the offer-routing decision table (`faff adr`, unit-tested via `--selftest`), and the supersede write (the shipped FAFF-197 `faff adr supersede`, the sole writer).
- This signature **is the FAFF-9 hand-off contract.** FAFF-9's future architecture lens either *calls* `detect_contradictions` for its contradiction sub-question or *replaces* the occupant with a richer analyzer honouring the same signature — nothing downstream knows which occupant ran; it consumes only `[Result]`. The seam is the LLM-judgement counterpart to ADR-0002's deterministic seams: the one judgement step, isolated so the rest stays asserted-on mechanically.
- Rejected alternatives: a lexical/rules heuristic (semantic contradiction defeats it); deferring to FAFF-9 (strands L3 on an unscoped epic).

## Consequences

- **FAFF-9 is unblocked, not blocked-on.** The contract is the integration point; FAFF-9 swaps the occupant behind the fixed signature with no change to graft Step 4b plumbing, the CLI, or the tests.
- **The seam's isolation is load-bearing and must be preserved.** Any future change that lets it write the filesystem, call `supersede`, or touch the tracker breaks swappability and re-couples judgement to side-effects — forbidden by this contract. Tests stub the *judgement* (the swappable occupant) and assert only the plumbing; the seam's purity is the invariant they protect.
- **The write stays human-confirmed at every appetite.** Re-pointing an existing record is a write side-effect under the Appetite-for-destruction hard floor; the seam only ever *informs* the offer, never the write. Autonomous mode records candidate conflicts for `/faff-wtf` and proceeds — it never auto-supersedes.
- **Detection quality rests entirely on the seam.** `faff adr validate` checks back-ref symmetry and numbering, not contradiction, so a false negative degrades silently to the pre-L3 manual path (never worse), and false-positive tolerance is a calibration punt (offered-but-declined rate in `.faff/`) — to be tuned by tightening the seam prompt, never by loosening toward an auto-write.

*Self-review (Consequences vs what shipped): the shipped CLI (`adr live-decisions` + the `adrOfferRoute` table) and `test/adr-l3.test.mjs` enforce exactly the isolation and human-confirm invariants stated above — the seam-judgement itself is stubbed in tests, matching the "swappable occupant" framing. Consequences are true to the build, not guessed.*

confidence: high
