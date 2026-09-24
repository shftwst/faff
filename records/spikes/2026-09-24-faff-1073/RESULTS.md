# FAFF-1073 — Spike results: is holdout-at-L3 feasible?

> Time-boxed investigation feeding **FAFF-1040** (the per-mechanism L3/L4 decision). Deliverable: a posture decision + reproducible measurement, not product code. Sits beside FAFF-1072 (which decided admissibility + custody at L3 by gating on run facts, not the L-level label).

## Headline

**L3-lenient (pass-through on inability) is the only honest posture *today* — the inability case is common, not rare, and one of its three conditions is ~always-on by construction.** A stricter guarantee is not viable across the board until the evaluator cage is wired (condition c) and specs routinely carry born-verifiable DoD (condition a). It **is** viable as a **scoped, opt-in** guarantee on the subset that clears condition (a) and has a real standup target, where holdout runs cheaply (median ~2.6s) and reliably.

## SpikeFindings

```
pass_through_rate       : >= 0.193   (condition (a) alone fires on 19.3% of specs; (b)/(c) widen it)
condition_a_rate        : 0.193      (146 / 757 committed specs, zero born-verifiable criteria)
condition_b_rate        : architecture-dependent (fixture-derived — see caveats):
                          - known datastore + app shape : ~0 (4/4 stood up healthy)
                          - unknown datastore kind      : fires (unprovisionable)
                          - CLI / skills / library repo : no SUT to stand up (not-attempted; the faff shape)
condition_c_rate        : ~1.0       (self-attested today; 0 live `--lane evaluator` emit sites, cage unwired)
median_standup_wall     : 2636 ms    (fixture-derived, warm-cache; range 2.6s redis/postgres .. 18.7s mysql)
standup_fault_rate      : 1/5 attempted (the unknown-kind case; the 4 known datastores were fault-free)
spec_fails_caught_pre_merge : n/a    (value side unmeasurable — see "Value side" below; 0 L4 ledgers ever ran holdout)
spec_fails_left_to_review   : n/a
decision                : L3-lenient-only now; scoped-stricter viable as a follow-up (see Decision)
```

## Corpus / coverage

| Track | Source | n | Coverage / caveat |
|---|---|---|---|
| 1 — condition (a) | every committed spec under `records/specs/` via `faff dod classify` | **757** | Full corpus, large-n. The confident part of the decision. |
| 2 — conditions (b)/(c) | the `faff env` datastore fixture matrix (`compose-gen → up → down`, live docker) | **7 shapes / 5 attempted** | **Fixture-derived**, not real external tickets (faff has no SUT — FAFF-717; external repos unreachable this run). Standup times are warm-cache. A bracket, not a point estimate. |
| retrospective (b)/(c) | `.faff/runs/*/run-ledger.json` with `level:"L4"` | **0** | **Holdout has never actually run in the recorded corpus** — no L4 ledger exists, so (b)/(c) have zero retrospective data. This is why Track 2 is live, and why its n is small. |

## Condition (a) — ticket unsuitable for holdout (no born-verifiable criteria)

`faff dod classify` over all 757 specs: **146 (19.3%)** have zero born-verifiable (scenario/assertion) criteria — the evaluator could only return all-`needs-human`, so holdout produces no verdict. Born-verifiable distribution:

```
born-verifiable count : 0    1   2   3   4   5   6   7   8   9  10+
specs                 : 146  49  59  95  94  86  66  51  33  28  50
```

So ~1 in 5 tickets is unsuitable for holdout on the DoD alone, before any env or code-blindness concern. This is the **largest, most confident inability signal** and it is a spec-authoring property, not an infra one — it shrinks only if specs are written with born-verifiable DoD (the same lever FAFF-1072's admissibility gate already pushes on).

_(Secondary cut attempted — "clears (a) but has only integration-tier born-verifiable, the FAFF-961 shape" — read 0/757 from the aggregate `verification_tier_counts`, but that aggregate tallies all criteria by tier rather than born-verifiable ones only, so it under-counts the FAFF-961 shape. Treated as inconclusive, not as evidence the shape is absent; FAFF-961 is itself proof it occurs. A per-criterion cut is the follow-up if FAFF-1040 needs the exact rate.)_

## Condition (b) — env cannot stand up the SUT

Fixture-derived over the `faff env` datastore matrix (real `compose-gen → up → down`, live docker 29.8.1):

| Shape | env_status | condition (b) | standup wall |
|---|---|---|---|
| redis-backed | ready | no | 2636 ms |
| postgres-backed | ready | no | 2613 ms |
| mysql-backed | ready | no | 18675 ms |
| mongo-backed | ready | no | 4667 ms |
| sqlite-backed | not-attempted | no | — (file-based; no container) |
| unknown-kind (cassandra) | **failed** | **yes** | — (unprovisionable) |
| no-datastore (CLI/skills shape) | not-attempted | no | — (**no SUT to stand up**) |

Two distinct (b) shapes emerge, and they matter more than the raw rate:

1. **Where a known datastore + app exists, standup is cheap and reliable** — 4/4 healthy, median ~2.6s (mysql the outlier at ~19s). The `faff env` seam works. On this subset (b) essentially does not fire.
2. **A large class of tickets has no SUT at all** — CLI, skills, library, config, and docs work (the faff shape itself, per FAFF-717) produces no provisionable service. This is *not* a fault (`not-attempted`, not `failed`), but it is a **pass-through**: holdout cannot run, so the lenient posture passes the merge through. For a self-hosting repo like faff, this is the *dominant* case.

The honest reading: (b) rarely *fails* on a repo that has a standup target, but a **large fraction of real work has no standup target**, which is a pass-through under the lenient posture just the same.

_Seam coverage: the full `compose-gen → up → seed → down` cycle was exercised end-to-end on postgres (seed exit 0, env torn down); the `env-sample.mjs` matrix run times the dominant `compose-gen → up → down` legs, and `env seed` was verified separately as clean. The synthetic fixture profiles declare no seed data, so seed is a clean no-op load — the seam runs, there is just nothing to load._

## Condition (c) — env not provably code-blind

**Fires ~always today.** Grepping every skill for `faff lane-boundary emit --lane evaluator` finds **0 live call sites** (only `--lane build` is emitted); `lane-boundary.js:28` marks the evaluator lane **SHIP-NOT-WIRE**, and ADR-0041 assigns the physical cage to an outer orchestration layer faff "asserts but never launches." So every holdout that runs in a run you would see today is **self-attested** (`code_blind: true` set by the evaluator, checked only for presence) — not physically established. In the strict physical sense condition (c) fires on 100% of live holdouts.

This is a **state-of-the-world finding, not a gap to measure away**: a stricter guarantee that *requires* physical code-blindness is not viable until FAFF-384's spawner cage is wired live (`evaluate-call.mjs` + `faff evaluator-preflight` exist but nothing emits `--lane evaluator`, so `merge-gate --require-spawner-attested` never arms). Until then, "code-blind holdout" at L3 means "self-attested holdout."

## Value side (spec-fails caught pre-merge vs post-merge) — unmeasurable, best-effort

The value ledger (`real_spec_fail` / `caught_stage`) is **unmeasurable** here: holdout has never run (0 L4 ledgers), so there is no record of a spec-fail it caught pre-merge. The best-effort post-merge oracle (committed reverts referencing a FAFF issue) reads **0 reverts in the last 400 `main` commits**; the `fix(FAFF-…)` prefix appears 91 times but is the repo's *standard* commit convention, not a spec-fail signal, so it is not a usable oracle. Net: the "was it worth it" side cannot be quantified from the existing corpus, exactly as the spec anticipated (value side explicitly best-effort; the decision rests on the three condition rates).

## Decision (hand-back to FAFF-1040)

**Recommend: keep L3-lenient (pass-through on inability) as the standing posture, and add a scoped opt-in stricter guarantee rather than a blanket one.** Rationale, traceable to the rates:

1. **Inability is common, not rare.** Condition (a) alone fires on 19.3% of tickets; the no-SUT class of condition (b) covers a large further fraction (all CLI/skills/library/config/docs work — the majority of a self-hosting repo's own backlog); condition (c) fires ~always. A blanket stricter guarantee (park-on-inability) would park a large share of the overnight queue on non-defects — the exact false-park cost FAFF-1040's "tension to litigate" warns about.
2. **The cost is not the blocker; the applicability is.** Where holdout *can* run (spec clears (a), a real standup target exists), env standup is cheap (~2.6s median) and reliable (0 datastore faults on known kinds). So per-issue holdout cost does not argue against enabling it at L3 — condition (a) suitability and condition (b) applicability do.
3. **Condition (c) caps the ceiling.** No stricter guarantee that leans on *provable* code-blindness is honest until FAFF-384 is wired. Today's holdout is self-attested; label it as such wherever it is surfaced.

**Concrete recommendation for FAFF-1040:**
- Adopt the **run-facts gating** pattern FAFF-1072 established (gate on whether holdout *can* run — spec clears (a) via `faff dod classify`, a standup target exists, `env-handle` reaches `ready` — not on the L-level label).
- Keep **pass-through** the default when any inability condition fires (lenient), so the no-SUT majority is never parked.
- Offer a **scoped stricter guarantee** (block-on-`fails`) as opt-in for the subset that clears (a) and stands up — a config leaf, off by default, in the FAFF-717 à-la-carte style.
- Treat **wiring the evaluator cage (FAFF-384 → live `--lane evaluator` emit)** as the prerequisite for any guarantee that claims *provable* code-blindness; until then surface every L3 holdout as self-attested.

## Reproduce

```
node records/spikes/2026-09-24-faff-1073/analyze.mjs       # Track 1 -> condition-a.json
node records/spikes/2026-09-24-faff-1073/env-sample.mjs     # Track 2 -> condition-b.json  (needs docker)
```

Machine output committed alongside: `condition-a.json` (757 observations), `condition-b.json` (7 shapes).
