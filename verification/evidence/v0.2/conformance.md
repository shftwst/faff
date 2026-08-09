# Conformance (v0.2 — six legs)

The citable statement — FAFF-610's Action should cite this page, not `v0.1/conformance.md`.

## 1. The claim

A conformant run dir or anchor dir is one whose artifacts validate against the v0.2
schemas (v0.1's nine plus `chain-head.json`) and satisfy the cross-artifact invariants,
**including chain integrity where a chain is present**.

## 2. The six legs

The five v0.1 legs are unchanged — see
[`v0.1/conformance.md`](../v0.1/conformance.md) §2 for their full rows (referenced, not
copied, per this directory's one-source-per-fact principle): **completeness**,
**budget**, **merge_floor**, **coherence**, **liveness**.

The sixth leg, added by FAFF-568:

| Leg | Artifacts read | Validating function | Gating? | Fail direction |
|---|---|---|---|---|
| **integrity** | `events.jsonl` (+ `chain-head.json` witness when present; + `run-ledger.json` for the ledger-fold cross-check) | `evaluateIntegrityLeg` — composes `verifyChain`, the same core `faff events verify` uses (one hashing implementation, not a forked one) | Gating | `broken`/`witness-mismatch` → hard FAIL, never softened by `--legacy-policy`. `legacy-unverifiable`/`mixed` → FAIL only under `--legacy-policy fail`, pass (`[warn]`-tagged) otherwise. `witness-absent` → FAIL, but only when evaluated as an anchor. Absent `events.jsonl` → `verified` (clean no-op). |

See [`v0.2/anchor-integrity.md`](anchor-integrity.md) for the full classification
vocabulary this leg's `detail` draws from.

## 3. Anchor-dir special case

An anchor dir (`.faff/anchors/<run-id>/<issue>/`) is evaluated **integrity-only** —
`evaluateAnchorDir` marks the other five legs `n/a` (pass, never gating), because an
anchor's `run-ledger.json` is a frozen, run-scoped copy, not a PR-scoped one; sweeping it
through `completeness` would false-fail on work the anchor never claimed to cover.

## 4. Fail-direction table (delta — new row only)

| Artifact | Missing | Malformed |
|---|---|---|
| `chain-head.json` | Anchor-only: `witness-absent`, gating FAIL. Live run dir: not applicable (no witness by design). | `malformed` — a corrupt committed artifact, fail-closed. |

The five v0.1 rows (`run-ledger.json`, `events.jsonl`, `ac-checklist.json`,
`review-verdict.json`, `holdout.json`) are unchanged — see `v0.1/conformance.md` §3.

## 5. Authenticity boundary

Unchanged from v0.1, restated: the witness raises the bar from "shape-valid" to
"shape-valid and internally self-consistent since anchor time," but it is still
emitter-authored — a forging emitter that never calls the real `anchor` verb can
fabricate a self-consistent `chain-head.json` from whole cloth. The integrity leg closes
the *post-anchor tamper* gap, not the *forging emitter* gap; the boundary itself
(inherited from [`docs/guide/governance-check.md`](../../../docs/guide/governance-check.md)) is
unchanged from v0.1's stated posture.

## 6. Version binding

This statement describes spec **v0.2**. FAFF-610's Action should cite v0.2, not v0.1,
once this delta lands.
