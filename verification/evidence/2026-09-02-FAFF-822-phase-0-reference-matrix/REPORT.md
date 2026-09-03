# Phase 0 reference matrix — nine-scenario assurance bank

Rendered by `faff scenario-matrix render` from `matrix.jsonl`. Deterministic: a pure function of the banked records, sorted by scenario ordinal. Regenerate, never hand-edit.

| # | scenario_id | disposition | journal | effect | isolation | review | two-custodian split | one-shot control | claim_label |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 01-normal-completion | accepted | J-C | E-C | fixture | mechanical | verified | — | J-C mechanical producer auth; E-C detection of a clean covered grant |
| 2 | 02-governance-block | blocked | J-D | E-B | fixture | mechanical | verified | shipped: merged main with no Commissaire decision | E-B prevention at the merge chokepoint (seeded governance block) |
| 3 | 03-independence-failure | refused | J-D | E-C | fixture | mechanical | verified | shipped: self-certified forged grant shipped | J-D self-declared; producer claims unverifiable without the secret; forged grant refused |
| 4 | 04-executor-loss | recovered | J-D | E-C | fixture | mechanical | verified | — | J-D self-declared; torn tail tolerated; revoked producer records fail closed; recovery is a byte-identical noop |
| 5 | 05-stale-evidence | denied | J-D | E-C | fixture | mechanical | verified | shipped: acted on stale evidence | E-C detection: a request on stale evidence is denied, no grant written |
| 6 | 06-effect-mismatch | detected | J-D | E-C | fixture | mechanical | verified | shipped: took the undeclared registry-publish | E-C detection: an undeclared observed effect surfaces as an escaped-side-effect |
| 7 | 07-exhausted-budget | parked | J-D | E-D | fixture | mechanical | verified | — | budget window breach parks until window reset with a resume_at; andon budget-breach recorded |
| 8 | 08-contract-amendment | amended | J-C | E-C | fixture | mechanical | verified | — | J-C new-revision records verify; the stale-key record fails the auth leg (producer-auth-mismatch) |
| 9 | 09-correction-resume | corrected | J-D | E-C | fixture | mechanical | verified | — | E-C correction: an idempotent match resumes gap-free with no duplicated work-item |

## Assurance notes

- `organisational_independence` is false on every row — Phase 0 runs under one maintainer, so independence is proved as key-custody mechanism only, never inferred as organisational separation.
- `effect_class` is E-B only where the disposition is `blocked` (the merge chokepoint's seeded refusal); every other row is E-C or weaker.
- Producer HMAC authentication is journal class J-C — mechanical, record-granularity forgery detection, never non-repudiation.
- Negative and null outcomes stay banked: `blocked` / `refused` / `denied` / `detected` are positive results, and `one_shot_control` is null on ordinals 1, 4, 7, 8, 9.
