# FAFF-1073 — Spike results: is holdout-at-L3 feasible?

> Time-boxed investigation feeding **FAFF-1040** (the holdout-guarantee decision). Deliverable: a posture decision + reproducible measurement, not product code. Sits beside FAFF-1072 (which decided admissibility + custody by gating on run facts, not the L-level label).

> **Correction (post-merge, operator-reviewed).** The original condition-(c) finding ("~1.0, self-attested, ~always-on by construction") was **scoped too narrowly and overstated**. It measured only what is reproducible from *this committed tree* — 0 `--lane evaluator` emit sites in the faff **skills** and 0 committed L4 ledgers — and wrongly generalised that to "code-blindness is never physically established." By ADR-0041's own design faff **asserts** the cage and the **outer orchestration layer launches it**, so a real cage leaves no `--lane evaluator` emit *in faff's skills* and its L4 ledgers are not committed here. The operator has since run multiple L4 holdouts against a **topologically-proven cage**; condition (c) is **satisfied and proven** in that environment, not always-on. This document is corrected below; the frame is also shifted from levels to **conditions × capabilities** per the operator's steer (see Decision).

## Headline

**Gate the holdout guarantee on conditions and capabilities, not on a level.** Whether to *block-on-fails* (strict) or *pass-through* (lenient) is a pure function of: is the run **unattended** (no human at the moment of action)? can holdout **run** (DoD born-verifiable **and** a SUT stands up)? is it **caged** (code-blindness physically provable)? Where all hold — an unattended, caged run over a born-verifiable, standable ticket — a strict block-on-fails guarantee is honest and viable **now** (the operator's proven-cage L4 runs are the existence proof). The lenient default is warranted only where a capability is *missing*: ~19% of tickets have no born-verifiable DoD, a large class (CLI/skills/library/config/docs) has no SUT, and an **adopter who has not stood up a verifiable cage** has no code-blindness to lean on. "L3 / L4" are just conversational bundles of these axes.

## SpikeFindings

```
pass_through_rate       : >= 0.193   (condition (a) alone; the no-SUT class of (b) widens it. (c) does NOT
                          widen it in a caged environment — it is a capability, not a corpus rate.)
condition_a_rate        : 0.193      (146 / 757 committed specs, zero born-verifiable criteria)
condition_b_rate        : architecture-dependent (fixture-derived — see caveats):
                          - known datastore + app shape : ~0 (4/4 stood up healthy)
                          - unknown datastore kind      : fires (unprovisionable)
                          - CLI / skills / library repo : no SUT to stand up (not-attempted; the faff shape)
condition_c_rate        : NOT a corpus rate — a per-environment CAPABILITY (caged?). Proven-satisfied in the
                          operator's L4 runs (topologically-verified cage). "Self-attested" applies only to an
                          adopter without a verified cage — NOT ~1.0. (Corrected — see Correction note above.)
median_standup_wall     : 2681 ms    (fixture-derived, warm-cache docker 29.8.1; range 2.7s redis/postgres .. 6.7s mysql; +~300ms seed each)
standup_fault_rate      : 1/5 attempted (the unknown-kind case; the 4 known datastores were fault-free)
spec_fails_caught_pre_merge : n/a    (value side unmeasurable — see "Value side" below; 0 L4 ledgers ever ran holdout)
spec_fails_left_to_review   : n/a
decision                : gate on conditions × capabilities (unattended? can-run? caged?), not on a level.
                          strict block-on-fails is viable NOW where all hold (caged unattended run over a
                          born-verifiable, standable ticket); lenient only where a capability is missing (see Decision)
```

## Corpus / coverage

| Track | Source | n | Coverage / caveat |
|---|---|---|---|
| 1 — condition (a) | every committed spec under `records/specs/` via `faff dod classify` | **757** | Full corpus, large-n. The confident part of the decision. |
| 2 — conditions (b)/(c) | the `faff env` datastore fixture matrix (`compose-gen → up → down`, live docker) | **7 shapes / 5 attempted** | **Fixture-derived**, not real external tickets (faff has no SUT — FAFF-717; external repos unreachable this run). Standup times are warm-cache. A bracket, not a point estimate. |
| retrospective (b)/(c) | `.faff/runs/*/run-ledger.json` with `level:"L4"` | **0** | **Holdout has never actually run in the recorded corpus** — no L4 ledger exists, so (b)/(c) have zero retrospective data. This is why Track 2 is live, and why its n is small. |

## Condition (a) — ticket unsuitable for holdout (no born-verifiable criteria)

_(Corpus note: the spec's WHY/Assumptions state 753 committed specs; the mine measured **757** — the corpus grew by 4 between spec-authoring and the run, and the set includes the spike's own design doc. The delta is negligible at this n and does not move the rate; flagged here per the spec's own "report corpus size and flag any skew" validation step.)_

`faff dod classify` over all 757 specs: **146 (19.3%)** have zero born-verifiable (scenario/assertion) criteria — the evaluator could only return all-`needs-human`, so holdout produces no verdict. Born-verifiable distribution:

```
born-verifiable count : 0    1   2   3   4   5   6   7   8   9  10+
specs                 : 146  49  59  95  94  86  66  51  33  28  50
```

So ~1 in 5 tickets is unsuitable for holdout on the DoD alone, before any env or code-blindness concern. This is the **largest, most confident inability signal** and it is a spec-authoring property, not an infra one — it shrinks only if specs are written with born-verifiable DoD (the same lever FAFF-1072's admissibility gate already pushes on).

_(Secondary cut attempted — "clears (a) but has only integration-tier born-verifiable, the FAFF-961 shape" — read 0/757 from the aggregate `verification_tier_counts`, but that aggregate tallies all criteria by tier rather than born-verifiable ones only, so it under-counts the FAFF-961 shape. Treated as inconclusive, not as evidence the shape is absent; FAFF-961 is itself proof it occurs. A per-criterion cut is the follow-up if FAFF-1040 needs the exact rate.)_

## Condition (b) — env cannot stand up the SUT

Fixture-derived over the `faff env` datastore matrix (real `compose-gen → up → down`, live docker 29.8.1):

(docker 29.8.1, warm cache — all images pre-pulled; times not comparable to a cold-pull run.)

| Shape | env_status | condition (b) | standup wall | seed |
|---|---|---|---|---|
| redis-backed | ready | no | 2681 ms | ok (306 ms) |
| postgres-backed | ready | no | 2681 ms | ok (283 ms) |
| mysql-backed | ready | no | 6686 ms | ok (276 ms) |
| mongo-backed | ready | no | 4646 ms | ok (319 ms) |
| sqlite-backed | not-attempted | no | — (file-based; no container) | — |
| unknown-kind (cassandra) | **failed** | **yes** | — (unprovisionable) | — |
| no-datastore (CLI/skills shape) | not-attempted | no | — (**no SUT to stand up**) | — |

Two distinct (b) shapes emerge, and they matter more than the raw rate:

1. **Where a known datastore + app exists, standup is cheap and reliable** — 4/4 healthy, median ~2.7s (mysql the outlier at ~6.7s), plus ~300ms seed each. The `faff env` seam works end-to-end (compose-gen → up → seed → down). On this subset (b) essentially does not fire.
2. **A large class of tickets has no SUT at all** — CLI, skills, library, config, and docs work (the faff shape itself, per FAFF-717) produces no provisionable service. This is *not* a fault (`not-attempted`, not `failed`), but it is a **pass-through**: holdout cannot run, so the lenient posture passes the merge through. For a self-hosting repo like faff, this is the *dominant* case.

The honest reading: (b) is a **per-ticket capability**, not a repo-wide verdict. **External SUTs have proven the real holdout works end-to-end** — where a ticket ships a blindly-exercisable interface, the env stands up, the code-blind evaluator runs against it, and a spec-fail is caught. faff itself is the opposite end (a CLI/skills repo with nothing to stand up), and a large class of real work (CLI/library/config/docs) shares that — an honest, permanent no-SUT gap for those tickets, a pass-through under the lenient posture. The fixture matrix here only stands in for the datastore-standup *cost*; the proof that holdout catches real defects comes from the external-SUT runs, not from these fixtures.

_Seam coverage: `env-sample.mjs` exercises the **full** `compose-gen → up → seed → down` seam in-script — every ready datastore is seeded (all 4 `seed_status: ok`, ~300ms) and torn down, and `condition-b.json` records each seed observation. A failed seed is treated as condition (b). The synthetic fixture profiles declare no seed data, so seed is a clean no-op load — the seam runs, there is just nothing to load. The committed `condition-b.json` also records `docker_version` and `image_cache_state` so the standup times below are comparable only against a same-cache re-run._

## Condition (c) — is the env provably code-blind? (a capability, not a corpus rate)

**Corrected.** The original text read condition (c) as "~1.0, fires ~always" from a grep of the faff **skills** (0 `--lane evaluator` emit sites) plus 0 committed L4 ledgers. That inference was wrong, and it conflated two different things:

- **"faff's skills don't self-emit `--lane evaluator`"** — true, and *by design*. ADR-0041 has faff **assert** the cage while the **outer orchestration layer launches it**. A correctly-caged run therefore leaves **no** `--lane evaluator` emit in faff's own skill code, and its L4 ledgers live in that runtime, **not committed into this repo**. So the grep measures "does faff self-launch a cage" (no) — *not* "does a cage exist" (which it cannot see from the committed tree).
- **"code-blindness is never physically established"** — **false.** The operator has run multiple L4 holdouts against a **topologically-proven cage**; in that environment code-blindness is physically established and `merge-gate --require-spawner-attested` arms against a real `lane-boundary.json` cage promise. Condition (c) is **satisfied and proven** there.

So condition (c) is **a per-environment capability** (is *this* run caged?), not a measurable corpus rate:

- **Caged environment (operator's L4 runs):** (c) satisfied — code-blindness proven. A strict guarantee that leans on provable code-blindness is honest **now**.
- **Un-verified-cage environment (a typical adopter who has not stood one up):** (c) not satisfied — holdout is *self-attested* (`code_blind: true` checked only for presence). There, "code-blind holdout" honestly means "self-attested holdout," and a guarantee must be **labelled as such** until the adopter stands up and verifies a cage.

The measurable fact this spike *can* stand behind is the narrower one: **from the committed tree alone, cage provenance is not reconstructible** — which is a statement about what a fresh clone can verify, not about whether the operator's cage works (it does).

## Value side (spec-fails caught pre-merge vs post-merge) — unmeasurable, best-effort

The value ledger (`real_spec_fail` / `caught_stage`) is **unmeasurable *from this committed corpus***: it holds 0 L4 ledgers, so there is no committed record of a pre-merge catch to count. **This is a corpus-visibility limit, not a claim that holdout never caught anything** — the operator's external-SUT L4 runs *did* catch spec-fails pre-merge; that evidence simply lives in those runtimes, not in this repo. The best-effort post-merge oracle over the committed tree (reverts referencing a FAFF issue) reads **0 reverts in the last 400 `main` commits**; the `fix(FAFF-…)` prefix appears 91 times but is the repo's *standard* commit convention, not a spec-fail signal, so it is not a usable oracle. Net: the "was it worth it" side can't be quantified *from the committed tree*; the qualitative answer from the operator's runs is that it does catch real defects where an external SUT exists.

## Decision (hand-back to FAFF-1040)

**Gate the holdout guarantee on conditions × capabilities, not on a level — and make it offerable at *every* level where the axes permit.** Levels are a conversational bundle; the business logic is a small matrix.

**The axes:**
- **Condition — supervision at the moment of action:** *unattended* (no human when the merge lands — overnight L3, lights-out L4, a self-directed CI watcher) vs *interactive* (a human present). This is what makes a pre-merge block *matter*: unattended is where a deferred morning review is too late.
- **Capability — can holdout run, and can we trust it:**
  - **born-verifiable?** the spec's DoD has scenario/assertion criteria (`faff dod classify`) — else nothing to exercise.
  - **standable SUT?** an env-handle reaches `ready` for *this ticket*. **Per-ticket, not repo-wide:** faff itself has no SUT (CLI/skills), but **external SUTs have proven the real holdout works end-to-end**; where a ticket delivers a blindly-exercisable interface, (b) is satisfied and cheap (~2.7s). Where it delivers CLI/library/config/docs, there is nothing to stand up — an honest, permanent gap for that ticket class, not a faff defect.
  - **caged?** code-blindness physically provable for this run (a verified cage + spawner attestation) vs self-attested. **Proven-satisfied in the operator's L4 runs**; unproven for an adopter who hasn't stood a cage up.

**The rule:**
- **All three capabilities present + unattended → strict `block-on-fails` is honest and viable now.** This is the operator's proven-cage L4 case; a spec-failing feature is blocked pre-merge. Do it.
- **Capabilities present + interactive → offer it, report the verdict, human decides** (the FAFF-1061 interactive-high-assurance shape). No reason to withhold a working holdout from an attended run just because it isn't L4.
- **Any capability missing → pass-through (lenient), labelled with *which* capability was missing.** Not born-verifiable, no SUT, or an unverified cage each yield an honest "couldn't holdout-test, here's why" — never a park on a non-defect, never a silent green.

**Concrete recommendation for FAFF-1040:**
- **Decouple the offer from the level.** Make holdout availability a function of `unattended? × born-verifiable? × standable-SUT? × caged?` — resolvable at L2/L3/L4 alike (the FAFF-717 per-axis decouple + FAFF-1061 interactive opt-in, generalised). Offer it wherever the axes permit; don't reserve it for the L4 mint.
- **Gate the guarantee (block vs pass-through) on the *unattended* condition + the capability set**, per FAFF-1072's "run facts, not the L-level label."
- **Default lenient only on a missing capability**, and surface which one — so the ~19% no-born-verifiable and the no-SUT ticket classes pass through honestly rather than parking.
- **Cage is a capability to *detect*, not a blanket blocker.** Where a run is verifiably caged (the operator's setup), lean on provable code-blindness now; where an adopter has no verified cage, label holdout self-attested. Do **not** state, as the original draft did, that provable code-blindness is unavailable until "FAFF-384 is wired" — it is available in a properly-provisioned cage today; what the committed tree can't do is *reconstruct that provenance after the fact*.

## Reproduce

```
node records/spikes/2026-09-24-faff-1073/analyze.mjs       # Track 1 -> condition-a.json
node records/spikes/2026-09-24-faff-1073/env-sample.mjs     # Track 2 -> condition-b.json  (needs docker)
```

Machine output committed alongside: `condition-a.json` (757 observations), `condition-b.json` (7 shapes).
