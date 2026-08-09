# Conformance (v0.1 — five legs)

> **Superseded as the citable statement by [`v0.2/conformance.md`](../v0.2/conformance.md)**,
> which restates these five legs by reference and adds a sixth (`integrity`, FAFF-568).
> This page stays on disk unedited as the historical record of what v0.1 asserted at
> landing — a citing consumer (FAFF-610's Action) should point at `v0.2/conformance.md`
> going forward.

## 1. The claim

A conformant run dir is one whose artifacts validate against the v0.1 schemas **and**
satisfy the cross-artifact invariants below.

## 2. The five legs

| Leg | Artifacts read | Validating function | Gating? | Fail direction |
|---|---|---|---|---|
| **completeness** | `run-ledger.json` | `auditLedger` (every admitted issue has a string terminal outcome) | Gating | Fail-loud (exit 2) on a malformed ledger, never a leg failure. |
| **budget** | `events.jsonl` (last `budget-checkpoint`; fallback ledger `stop_reason`) | budget-envelope check | Gating on a recorded `escalate` breach only | An unrecorded/absent checkpoint is not itself a failure. |
| **merge_floor** | `ac-checklist.json` + `review-verdict.json` (+ at L4: `holdout.json`, with `build-progress.json` freshness and `lane-boundary.json`'s cage promise) | the same `merge-gate.js` readers (`readAcComplete`, `readReviewVerdict`, `readHoldout`) | Gating | Missing/malformed is fail-closed (`missing` ≠ `pass`) for every one of these. |
| **coherence** | `events.jsonl` ↔ `run-ledger.json` join | `faff audit` | Report-only | Findings are surfaced, never gating. |
| **liveness** | the ledger `owner` block's shape | shape check (gating), heartbeat age (report-only, snapshot semantics) | Gating on shape only | A missing `owner` block is legacy-valid, not a failure. |

## 3. Fail-direction table (per artifact)

| Artifact | Missing | Malformed |
|---|---|---|
| `run-ledger.json` | fail-loud, exit 2 (never a leg failure) | fail-loud, exit 2 |
| `events.jsonl` | absent → coherence/liveness read nothing (not a failure) | `faff events validate` fails loud on the offending line |
| `ac-checklist.json` | fail-closed `missing` ≠ `pass` at merge_floor | fail-closed `missing` ≠ `pass` |
| `review-verdict.json` | fail-closed `missing` ≠ `pass` | coerces to `needs-human`, never `pass` |
| `holdout.json` (L4 only) | fail-closed — blocks the merge | fail-closed — blocks the merge |

## 4. Authenticity boundary

Restated from [`docs/guide/governance-check.md`](../../guide/governance-check.md), which
is the canonical statement: run artifacts are authored by the same emitter the check is
judging — a hostile or careless agent can commit a forged clean ledger and fabricated
`pass` verdicts, and the check reads that indistinguishably from the real thing. What it
*does* catch: a cooperating-but-fallible emitter's incomplete runs, budget breaches, and
tampered/missing floor artifacts — plus a visible, greppable audit trail for anyone
looking. Artifact authenticity (signed artifacts, attestation) is a separate trust
layer, out of scope for this binding.

## 5. Version binding

This statement describes spec **v0.1**. See `v0.2/conformance.md` for the six-leg
version that supersedes it as the citable statement.
