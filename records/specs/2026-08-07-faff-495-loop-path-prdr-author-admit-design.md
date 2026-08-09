# FAFF-495 — Loop-path PRDR author+admit: machine-authored PRDRs clear the two-phase YAGNI gate or park (REFRESH → high)

> Spec: faffter-dark-nlspec · 2026-07-17 · interactive · confidence: high. Full spec on Linear FAFF-495.

**Refresh note (2026-07-17, interactive, operator-directed).** Both prior open Punts are now closed by shipped work (Punt → `**Chosen:**`); re-rated `medium → high`. What moved since the 2026-07-16 medium spec:

- **Blocker FAFF-493 is Done** (PR #393 — the L4 topology-write-authority envelope, a referencing contract over the gateway dial). The `blockedBy FAFF-493` edge no longer gates 495.
- **FAFF-494 shipped** (PR #401): `/faff-plot --autonomous` **Step 5b — defer, never admit** (`faff-plot/SKILL.md:234`) authors a `Proposed`, `provenance: loop` PRDR per created project and **stops**, naming FAFF-495 inline as the pickup. This is the concrete seam 495 wires.
- **FAFF-515 shipped** (PR #395, ADR-0072) and **FAFF-521 shipped** (PR #406): the no-double-gate boundary and the hardened OUTWARD-only ignition guard both land ahead of 495.

## 1. WHY
The loop is only lights-out if the PRDRs it authors can be admitted without a human hand — and refused PRDRs must **park, not vanish** (lost scope forbidden at every appetite). The gates already exist; this composes them into one loop-actor sequence.

**Substrate — all shipped (verified on main):**
- `prdr-author` — methodology `AuthoredPrdr` (`provenance: loop`, status `Proposed`) — `faffter-noon-methodology-thematic/SKILL.md:226`.
- `faff prdr yagni` — FAFF-256 two-phase arbitration; Phase 2 = adversarial `review` slot challenging (`--challenge survived|overturned`) — `prdr.js:373`, `contract-defs.js:1162`.
- `faff prdr admit --actor loop` — FAFF-255 two-gate admission (`prdr.js:337`, `computePrdrAdmissionVerdict` `contract-defs.js:885`; `--actor loop` enforced).
- `faff prdr accept --actor loop --admit-verdict <json>` — FAFF-463 git-landing sole-writer (`prdr.js:148`; loop may only accept an `admit`-disposition verdict, `prdr.js:161`).

## 2. WHAT — the loop-admit sequence
```
loop_admit_prdr(container, authored):   # picks up 494 Step 5b's `Proposed` loop-PRDR
  1. propose  := prdr-author(container.{outcome, child_specs, target})   # Phase 1, methodology
  2. challenge:= adversarial `review` slot challenges propose            # Phase 2, different model → survived|overturned
  3. arb      := faff prdr yagni --proposal admit|reject --challenge <survived|overturned> [--prd-goals …]
  4. arb=admit → faff prdr admit --actor loop --admit-verdict <arb>      # FAFF-255 gate (content authority)
     admit=admit → faff prdr accept --actor loop --admit-verdict <adm>   # FAFF-463 landing (branch + PR)
  5. any refusal (yagni reject / Phase-2 overturned / admit propose-only|reject) → PARK with the refusing phase's reason
```

## 3. Design decisions

- **Chosen — actor swap, gate untouched.** Every gate CLI already takes `--actor loop`; this wires the loop *through* them, never around — no gate logic changes (their selftests pass unmodified).
- **Chosen — refusal → park, never drop** (load-bearing invariant). The park carries the refusing phase (`yagni-overturned` / `admit-refused` / `phase2-inconclusive`) + its reason.
- **Chosen — persistence via `faff prdr accept --actor loop`** (FAFF-463): Accepted ⟺ committed, no drift.
- **Chosen — Phase-2 challenger = the adversarial `review` slot** (not a new occupant).
- **Chosen (was Punt — the orchestration home; now settled by shipped ADRs) — option (a): compose the *existing* gateway contract, no new skill, no parallel admission path.** The full loop-admit orchestration is already a documented reusable contract in the gateway: `faff/SKILL.md:1044` (Authored-PRDR level-scaling → the **L4 bullet at :1047** documenting `admit`→`accept --actor loop`) + `:1051` (Upper-gate two-phase arbitration). **ADR-0071:57** ("FAFF-495 composes the verdict as a precondition to `faff prdr admit --actor loop`, without a second admission path") and **ADR-0072:59** ("FAFF-495's `faff prdr admit --actor loop` is the container-create content authority … composes with, not through, the topology envelope — not a parallel admission path, no double-gate") **mandate (a)**. 495's concrete work: make `/faff-plot --autonomous` Step 5b a **second caller** of that same gateway prose contract (today it names only "the lights-out runner"). Rejected (b) a standalone `faff-prdr-loop` skill — the ADRs forbid a parallel admission path.
- **Chosen (was Punt — the AC decomposition) — mechanical legs are the born-verifiable ACs; the end-to-end is a human-supervised holdout-shaped criterion.** Because Phases 1–2 are LLM steps, the testable ACs are the *mechanical* legs (yagni arbitration, admit verdict, accept landing, the park-on-refusal branch) via their selftests + an integration test with a stubbed proposer/challenger; the "a real loop-authored PRDR admits or parks end-to-end" whole is holdout-shaped and human-supervised. This mirrors the established FAFF-317/FAFF-474 eval-coverage decomposition (mechanical legs land in-ticket; the frontier/holdout whole is a separate human-supervised step). Not required by this ticket's DONE.

## 4. Acceptance
- A loop-authored PRDR either admits through both phases (yagni survived + admit) and lands via `faff prdr accept --actor loop`, or parks with the refusing phase's reason attached.
- No PRDR is silently dropped — every path terminates in admit-and-land or a labelled park.
- The wiring changes only the actor; `faff prdr yagni` / `admit` / `accept` gate logic is byte-unchanged (selftests pass unmodified).
- `/faff-plot --autonomous` Step 5b's `Proposed` loop-PRDR is the handoff point 495 picks up — no parallel admission path is introduced (composes with the l4-topology envelope per ADR-0072, no double-gate).

## 5. Assumptions
- **Assumes:** the shipped substrate stays stable — FAFF-493 envelope (Done), FAFF-515 no-double-gate boundary (Done), FAFF-463 accept-landing (Done), FAFF-255/256 gates (Done). All verified on main; none is a live `blockedBy` edge.

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
