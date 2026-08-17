# ADR 0115 — Scoped recovery write-authority for a merged-but-unclosed run

- **Status:** Proposed
- **Provenance:** loop
- **Date:** 2026-08-16
- **Issue:** FAFF-797

## Context

A drain's real work (the merge) and its ledger bookkeeping (`record-outcome shipped`, `owner.status:"done"`) happen at different instants. FAFF-782 proved the gap is real: a PR merged durably on `main`, then the harness's background-task ceiling force-killed the orchestrator before it reached `record-outcome`. FAFF-782 shipped detection only — `faff disposition` surfaces the gap as a `merged-unclosed` attention item — but left the ledger stuck `owner.status:"running"` / `outcomes:{}`, requiring a human to re-run `post-merge-check` and `record-outcome` by hand. FAFF-782's spec named the extension point and Punted the write-authority question, because closing it forces a genuine reconciliation of three invariants:

- `faff disposition` and `faff reconcile` are pure/read-only by contract (ADR-0056) — an auto-close write cannot live in either.
- The ledger rule "only the run's own agents write `owner.status`" (ADR-0008/0015 lineage) forbids a foreign actor writing a killed run's ledger — and impersonating the dead orchestrator to satisfy that rule re-imports the exact tension the rule exists to prevent.
- A red or unrunnable re-verification must never be silently masked by an auto-close.

The human resolved the write-authority direction on 2026-08-16 (unpark): a new `faff reconcile`-adjacent recovery verb owns the auto-close write, gated on a passing `post-merge-check`. This ADR records that decision's scope.

## Decision

**A new, distinct, top-level `faff reconcile-recover` verb** holds a narrowly-scoped recovery write-authority to close a merged-but-unclosed run-ledger. It is reconcile-*adjacent* — never folded into `faff reconcile` or `faff disposition`, which stay pure/read-only exactly as ADR-0056 requires. The verb is a thin composition over shipped primitives: it introduces no new detection, liveness, or write logic — only the admission decision (`admitRecovery`) and the post-merge-check gate are new, and both are pure/read-only until the final write.

**The exception is scoped, not a general write-authority grant**, on all four axes named in the human's chosen direction:

- **Actor:** the recovery verb only. Never a live lane, never a peer orchestrator, never the killed run re-minted to act as its own agent — the orchestrator is gone, and resuming it would collide with `run-ledger`'s live-higher-level downgrade guard as well as reopen the impersonation problem the human's direction rejects.
- **Operation:** `owner.status running→done` plus `outcomes[issue] absent→shipped` only. No other field, no backward move, no reopen. The write itself is delegated to the existing, single tested ledger-close writer (`run-ledger record-outcome` / `applyTerminalOutcome` under `mutateLedgerUnderLock`) — the recovery verb never forks a second write path.
- **Precondition:** admission requires all three of verifiably-merged (`merge-record.merged===true`, read via the existing `readMergedMap` — never re-derived), unclosed (`admitted ∖ outcomes`), and verifiably-stale. Staleness is the negation of `runIsHeld` evaluated against the `overlayHeartbeat`-effective instant — the same owner-emitted heartbeat contract ADR-0008 already established, unmodified and unextended (`RUN_HEARTBEAT_STALE_SECS_DEFAULT`, 900s). A run that merged seconds ago still has a fresh heartbeat, so `runIsHeld` is true, admission returns `live`, and the verb no-ops — recovery can never race a run that is still genuinely finishing its own close.
- **Pairing:** never a bare write. Admission alone is insufficient; the write only proceeds behind a re-run `post-merge-check` returning `verified-ok`. A red (`verified-fail`) or absent/unrunnable (`unverified`) verdict blocks unconditionally, leaving the `merged-unclosed` attention item standing for a human — the auto-close never masks a post-merge regression or an unprovable merge.

This is the **third** enumerated, deliberately-scoped exception to the ledger write-authority/monotonicity invariant, sibling to **ADR-0057** (a claim-holder releasing its own `In Progress → Todo` claim) and **ADR-0098** (`/faff-tidy` reclaiming a provably-stale, provably-faff claim). All three share the same shape: a named actor, a named direction, a provable precondition, and a scope that never touches a live or further-along run. It also aligns with **ADR-0077**'s two-class write-authority model — the ledger close is a trusted-side, evidence-class write, and the recovery verb runs from the drain-wrapper/orchestrator layer, the trusted side of that split, not a lane self-marking its own homework.

## Consequences

- A merged-but-unclosed L3 run whose merged code re-verifies closes to `shipped` with no manual reconciliation; one that does not re-verify, or is still live, is left untouched for a human — exactly FAFF-782's deferred half, closed without weakening any of the three invariants it named.
- `faff disposition` and `faff reconcile` remain pure/read-only; a future reader auditing "what writes the ledger close" finds exactly one path (`record-outcome`) reached from exactly two callers (the run's own agents, and now this scoped recovery verb) rather than a purity exception buried in a read-only-by-contract module.
- The blast radius is bounded by construction: the write is idempotent (a re-run or a concurrent recovery re-reads `not-unclosed` and no-ops under the same lock) and non-destructive (it only transcribes a truth already durable on `main`), so a residual cross-host race closes a ledger to reality rather than corrupting it.
- The out-of-repo `fly-ci-l3-runner` deployment (`drain.sh` / `entrypoint.sh`) is explicitly outside this decision's reach — the in-repo reference wrappers (`operations/ci/faff-cron.sh`, `operations/ci/l3-watcher.yml`) carry the wiring and `docs/guide/self-hosted-rig.md` documents it, but the live runner needs an operator-applied mirror, tracked as a follow-up rather than solved here.
- Any future proposal to widen this exception (a fourth actor, a fifth operation, a looser precondition) should be read against this ADR and its two siblings (0057, 0098) as the precedent set, not against the general monotonicity rule in isolation — scope-widening here is a deliberate reviewer red flag, not a routine extension.

**Self-review (producer):** every scope line above (actor/operation/precondition/pairing) is drawn directly from the spec's `## ADR promotion intent` and its §3/§4/§6 — no term is introduced here that the spec did not already settle. The build (`faff reconcile-recover`, `admitRecovery`, wired in this same PR) is required to match this scope exactly; a divergence discovered during implementation is a spec/ADR inconsistency to fix before merge, not a reason to silently widen the scope. `confidence: high`.
