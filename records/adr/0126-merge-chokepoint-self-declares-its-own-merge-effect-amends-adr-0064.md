# ADR 0126 — Merge chokepoint self-declares its own merge effect (amends ADR-0064)

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-09-06
- **Issue:** FAFF-1012

## Context

`records/adr/0064-effects-instrumentation-authority-split-declares-from-outside-the-actor-observes.md` split the effects ledger into two authorities: the orchestrating step declares intent from outside the chokepoint (for merge, graft Step 10), and the mechanical actor observes what happened from inside (for merge, `merge-gate.js` after `gh pr merge` lands). That split is what makes an escape signal meaningful: a declare and its paired observe cannot be produced by the same act.

The split held only while the declare was actually written. `faff merge-gate --run-dir <anchor> --execute` performs the merge and then observes the effect, but the covering declare is a separate step the caller must have run first. The autonomous graft flow wires it in (graft Step 10, and the landing-comment merge-ok template prints a paired `faff effects declare` heredoc immediately above the merge-gate line). A hand-driven land can still skip it: a human who runs the `--execute` line without first running the declare above it lands the merge with an uncovered observe. `faff audit` and `faff effects check` then read that observe as an escaped side-effect. This is what happened on the FAFF-1005 graft (PR #869).

ADR-0064's Consequences (the "a missed declare is a visible warning today" clause) named the sanctioned fix for a missed declare as making the graft-side declare more mechanical, and explicitly ruled out "having the chokepoint self-declare". That clause is what FAFF-1012 needs to overturn, for the merge chokepoint only.

## Decision

The merge chokepoint, and it alone, is granted an idempotent mechanical self-declare. When `merge-gate.js` performs the merge it also mints the covering `declare` for the effect set it is about to observe, into the same `(issue, step="merge")` ledger, before the observe. It does this because merge-gate is the single component that both performs the merge and holds the `(issue, step="merge", target=pr:N)` tuple, so no separate actor is needed to attest the intent.

- **Idempotent top-up.** merge-gate re-reads the ledger and declares only the effects for which no covering declaration already exists (same `effectTargetMatches` rule the coverage checks use). If graft Step 10 or a landing-comment template already declared, the uncovered set is empty and nothing is written, so the hash-chained ledger gains no redundant declare on the common autonomous path.
- **Provenance marker.** Each auto-minted declare record carries a record-level `origin: "merge-gate-auto"` field. Operator and orchestrator declares carry no `origin`. The marker rides the ledger record envelope, not the effect descriptor, so it does not disturb `normEffect` or `effectTargetMatches`; every coverage check reads only effect fields and the entry envelope and ignores `origin`. Both kinds of declare count as covering.
- **Best-effort, never a gate.** The self-declare is a ledger append under a lock, in its own try/catch, swallowed to one stderr line on any failure, exactly as the existing observe is. It runs strictly after the verdict is decided and never touches merge-gate's verdict, exit code, or emitted JSON. An unwritable run dir merges exactly as before.

This overturns ADR-0064's "never having the chokepoint self-declare" clause for the merge chokepoint only. The declare-outside-the-actor rule still binds every other effects-producer chokepoint named in ADR-0064 (label-write, tracker-write, `faff worktree-prune`'s local housekeeping): none of those gets a self-declare carve-out from this ADR.

## Consequences

- **No merge observe can escape for want of a declare.** The structural guarantee replaces the escape signal at the merge step: `computeEscapes` can no longer raise a merge escape, because merge-gate covers its own observe. That is a deliberate trade.
- **The audit distinction ADR-0064 protected is preserved by the `origin` marker.** ADR-0064 wanted an escape to mean a genuinely unprovenanced merge, not one step attesting to itself. Because a mechanical top-up is marked and an operator/orchestrator declare is not, `faff audit` can still tell whether a genuine pre-merge declare of intent existed or only a mechanical one, by filtering on `record.origin === "merge-gate-auto"`. The escape signal is traded for a structural guarantee plus this recoverable audit distinction, not lost.
- **The declare-outside-the-actor rule still binds elsewhere.** Every other chokepoint remains under ADR-0064: a candidate is admissible only once it has both an orchestrating step that can declare intent in advance and a mechanical actor that can witness the effect without narrating its own action. This carve-out is scoped to merge because merge is the one chokepoint where a single CLI both performs the effect and owns the tuple.
- **The templated declares stay.** The landing-comment templates keep their manual declare (no `origin`); the top-up sees it as covering and writes nothing extra. They still document intent for a fully-manual land, and keep the top-up idempotent on the autonomous path.
- **The header at `merge-gate.js` and this ADR are the record of the carve-out.** The FAFF-383 authority-split header in `merge-gate.js` is rewritten to describe merge-gate's declarer-and-observer role and points here.
