# Phase 0 reference matrix — replay protocol (FAFF-822)

The nine V5 reference scenarios, banked as one common `ScenarioRecord` shape with an honest per-scenario assurance vector. This directory is the banked evidence; a clean operator reproduces it from a pinned release with the steps below.

## What is here

| File | What it is |
|---|---|
| `matrix.jsonl` | The nine `ScenarioRecord` records (`schema:1`), one per line, ordinals 1..9. The harness output, committed verbatim. |
| `REPORT.md` | The deterministic render of `matrix.jsonl` — a pure function of the records, sorted by scenario ordinal. Regenerate, never hand-edit. |
| `protocol.md` | This file. |

## Replay

From a clean checkout at the pinned release, run each step and check the stated result:

1. `node --test test/phase-0-matrix.test.mjs` — drives the nine scenarios mkdtemp-mint-then-mutate over the real `faff` bin, reads each born-verifiable oracle (the auth rows 1/3/4/8 via the public `commissaire audit verify --json` seam), asserts every oracle plus the two-custodian split per row, and asserts the committed `matrix.jsonl` and `REPORT.md` are byte-identical to the deterministic build. Exit 0.
2. `faff contract scenario-record --selftest` — the deterministic validator of the `ScenarioRecord` shape (schema:1, required fields, disposition enum, effect_class E-B only when blocked, journal ≤ J-C on a producer-HMAC leg, organisational_independence always false, one_shot_control non-null iff the ordinal is a catch scenario). Exit 0.
3. `faff scenario-matrix render verification/evidence/2026-09-02-FAFF-822-phase-0-reference-matrix/matrix.jsonl` — re-renders the report from the banked records; its stdout equals `REPORT.md` byte-for-byte.

Each banked record is also independently re-validated by piping it into `faff contract scenario-record` (exit 0 per row), which the harness does in its bank test.

## Regenerating the bank

The committed files are the harness output. To regenerate them after a deliberate change to the emitter or the scenario drives:

```
FAFF822_REBANK=1 node --test test/phase-0-matrix.test.mjs
```

This writes `matrix.jsonl` and `REPORT.md` from the same fixed scenario-result literals the assertions check, then re-asserts byte-identity. The records carry no tmp path, timestamp, or key — the environment is pinned and evidence paths are relative — so the bank is reproducible across machines.

## Honest-claim invariants (retained in the bank)

- `effect_class` is E-B only on scenario 2 (the merge chokepoint's seeded governance block); every other row is E-C or weaker (scenario 7's budget park is E-D).
- Producer HMAC authentication is journal class J-C — mechanical, record-granularity forgery detection, never non-repudiation. Rows whose producer claims are unverifiable without the secret (scenario 3) stay J-D; an `unverifiable_without_secret` claim is never folded into a pass.
- `organisational_independence` is false on all nine rows (Phase 0, one maintainer): independence is proved as key-custody mechanism only.
- Negative and null outcomes stay banked: `blocked` / `refused` / `denied` / `detected` are positive results, and `one_shot_control` is null on ordinals 1, 4, 7, 8, 9.

## Notes on the oracles

- The auth-leg oracle for rows 1, 3, 4, 8 is the public `commissaire audit verify --json` seam, not an in-process `verifyAuthLeg` call: row 1 secret-bearing (producers `verified`, exit 0); row 3 secret-free (an empty governor dir, `pk.json` only → exit 1, the forged decision `commissaire-sig-invalid`, producer claims `unverifiable_without_secret`); row 4 secret-bearing so the revoked producer classifies `failed` (exit 1) alongside a tolerated torn tail; row 8 secret-bearing after a re-admit under a new `--contract-revision` so the stale-key record classifies `failed` (`producer-auth-mismatch`) while the new-revision record verifies.
- Scenario 4's recovery disposition is driven through the `bundleRecover` idempotency core (`idempotencyDecision`: identical bytes → `match` → noop-already-present; a divergence → `conflict` → refused). The `commissaire audit seal` boundary stub is the intended publish precondition, but its run-close boundary key is not satisfiable for an ad-hoc run directory, so the recovery oracle is exercised through the core the verb itself uses rather than the seal round trip.
- Scenarios 2, 5, 6, 7, 9 read `decideFloor` / the deny verdict / `computeEscapes` / `computeBudgetState` / `idempotencyDecision` respectively; each also asserts the two-custodian split from a real admit.
