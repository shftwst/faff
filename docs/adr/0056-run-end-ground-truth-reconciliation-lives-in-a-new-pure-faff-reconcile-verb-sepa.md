# ADR 0056 — Run-end ground-truth reconciliation lives in a new pure faff reconcile verb, separate from runcheck

- **Status:** Proposed
- **Date:** 2026-07-11
- **Issue:** FAFF-397

## Context

`runcheck` proves the run-ledger is *complete* (`admitted − outcomes = ∅`) and `effects` detects side-effects that escaped a declared envelope — but both are pure, no-I/O checks over what the run already recorded. Neither re-reads the live tracker or git to confirm a claimed outcome is *true*. In a lights-out run there is no human eyeballing reality, so a subagent claim that diverges from it — a `shipped` outcome with no corresponding merge, a terminal-state flip on a sibling issue the run never owned — survives to run-end uncaught, and the run reports a false green. `runcheck`'s no-I/O Stop-hook purity is itself a load-bearing invariant (FAFF-205/233/235): it must stay a pure function of the ledger it's handed, so ground-truth reconciliation — which needs live tracker + git I/O — cannot be folded into it without breaking that property.

## Decision

Run-end ground-truth reconciliation lives in a **new pure `faff reconcile` verb**, separate from `runcheck`. It follows the same split ADR 0043 established for the merge floor: a **pure assertion core** (`reconcile_core`, selftest-covered, registered as a `CONTRACTS`-style verb) that takes an assembled `ReconcileInput` and deterministically classifies divergences (`phantom-merge`, `claimed-shipped-unmerged`, `unowned-sibling-mutation`), wrapped by a **thin impure orchestrator step** (`faff-beep-boop` Step 11, beside `runcheck`) that gathers the live evidence — reading each `shipped` issue's `merge-record.json` and observing the live forge/git state, plus re-reading each spec-referenced non-admitted sibling's terminal-state against the run-start `sibling-baseline.json`. The verb reads `ReconcileInput` on stdin and emits a `faff-contract:run-reconcile` block; disposition is level-gated (`needs-human` at L4, `warn` at ≤L3) but the classification itself carries no model judgement — the LLM orchestrator only gathers evidence, it never decides the verdict.

Rejected: folding reconciliation into `runcheck` directly. Cheaper to wire, but it would make `runcheck` impure (breaking FAFF-205/233/235) and conflate two distinct properties — ledger *completeness* (a fact about the ledger alone) and *ground-truth* (a fact about the world the ledger claims to describe).

## Consequences

- `runcheck` stays untouched and pure; `reconcile` is the second, independent run-end gate `faff-beep-boop` Step 11 runs alongside it — a non-`pass` reconcile under L4 composes with the existing `run-done` → `escalate` path rather than replacing or modifying `runcheck`'s own completeness check.
- The recorded head sha survives to run-end via an **additive** per-issue `merge-record.json` (`{pr, head_sha, merged, merged_at}`) written by `merge-gate` on the merge-ok path — the ledger `outcomes` value stays a plain string, so no schema migration ripples through `auditLedger` or the executors.
- Future run-end integrity gates have a clear attachment point and a precedent to copy: pure core + orchestrator-gathered evidence, mirroring `merge-gate`'s `decideFloor` split (ADR 0043) rather than each gate inventing its own impurity boundary.
- A missing/unreadable `merge-record.json` for a `shipped` claim fails closed to a `claimed-shipped-unmerged` divergence — never silently `pass` — so every merge path that can reach a `shipped` outcome must write the record, or reconcile will (correctly) flag it as unproven.
- The sibling-mutation check is deliberately bounded to spec-referenced, non-admitted issues (via `sibling-baseline.json`), not an unbounded whole-tracker scan; if reference-extraction recall proves too narrow in practice, widening it to all run-touched issues is the named fallback (see spec §4 Failure modes), not a re-litigation of this decision.
- (FAFF-680) The sibling-mutation check's own absence is now itself a divergence class — `sibling-check-unproven` — rather than a silent `pass`: `ReconcileInput` grew a `sibling_baseline: {captured, entry_count}` attestation whose absence defaults to "not captured", so a run that skipped the `sibling-baseline.json` write no longer reports as cleanly reconciled. This is additive to the Decision above, not a revision of it — the gate stays pure, the caller still gathers all evidence, and the new class flows through the same level-gated `disposition` the other three already use.

**Self-review:** the Consequences above track what the spec actually commits to shipping (the additive `merge-record.json`, the bounded sibling baseline, the level-gated disposition) rather than restating the Decision — no gap found between what was decided and what the DONE checklist requires.

confidence: high
