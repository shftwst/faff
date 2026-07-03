# FAFF-297 — Lights-out adversarial review: promote advisory → merge-gating

> Spec: faffter-dark-nlspec · 2026-07-03 · autonomous · confidence: high. Full spec on Linear FAFF-297.

This spec is for the build agent implementing FAFF-297 and the humans reviewing it. It makes a `critical` adversarial (Phase-2) finding **stop the merge** on a lights-out (L4) run, while leaving L1–L3 behaviour byte-for-byte unchanged. The change is confined to two skill prompts; the shipped `review-verdict` contract CLI and faff-graft's Step 10 merge gate are untouched.

## 1. WHY — Problem and Principles

**The load-bearing idea:** the adversarial reviewer already assigns a `critical` severity to its Phase-2 findings, but that severity lives *only* in the slot's prose output — the `review-verdict` contract the merge gate routes on never sees it. So the only place that can turn a `critical` into a merge-stop is the slot itself, at the moment it authors the contract block. Nothing downstream needs to learn about severities.

**Problem statement.** Today `faffter-dark-adversarial-review`'s Phase-2 findings are advisory — folded into graft's review comment, never a gate decision (`## How findings are handled`: "The adversarial review never directly blocks the pipeline"). On a lights-out run there is no human to weigh a "soft" `critical`, so a genuinely serious second-opinion finding can ride through to auto-merge. This change makes a Phase-2 `critical` escalate the review's returned hard signal to `needs-human` **on the lights-out path only**, so the (unchanged) merge gate parks the PR.

**Design principles.**

- **The contract CLI stays pure and unaware.** `computeReviewVerdict` is a pure function over `{ signal, findings }` with no severity, adversarial, or lights-out notion, and its schema is `additionalProperties: false`. Teaching it any of the three would be a large, shipped-contract-breaking change for no benefit — the severity data does not exist at that layer. The escalation is computed where the severity data lives (the slot), and the contract receives an already-escalated, already-conformant `{ signal, findings }`.
- **Single L4-resolution locus.** faff-graft already resolves the lights-out signal (`readLedger($FAFF_RUN_DIR).level === "L4"`) for its admissibility gate and its holdout gate. This change makes the review slot a *third consumer fed by graft*, not a second independent resolver — so the three L4-gated behaviours in the build pipeline can never disagree about whether the run is lights-out.
- **Precision over recall on the escalation threshold.** The adversarial model may be lower-capability (the slot's own `## Rules`: "may produce lower-quality output than the primary model"). An over-eager threshold that parks on every `major` would make lights-out runs park constantly — defeating the point. The escalation fires on the reviewer's highest-confidence severity only.

**Scope statement.** This sits at the review→gate seam of the L4 build pipeline: it upgrades one already-produced soft signal into a hard one, upstream of an unchanged gate.

## 2. OUT OF SCOPE

- **`major`-and-below escalation.** Only `critical` escalates in v1. A future ticket widens the named severity threshold constant in the slot's escalation step.
- **A `.faffrc` knob for the threshold.** The threshold is a fixed constant, not configurable.
- **Any change to the `review-verdict` contract CLI (`computeReviewVerdict`) or its schema.** The severity data does not exist at that layer; the escalation is computed slot-side and the contract receives conformant `{ signal, findings }`.
- **Any change to faff-graft Step 10 (the merge gate).** It already parks on `needs-human`; byte-for-byte unchanged.
- **Escalating on Phase-1 findings.** Phase-1 `fail`/`needs-human` already block pre-Phase-2; escalation only concerns the `pass`→`needs-human` transition Phase 2 can trigger.
- **The slot independently reading `$FAFF_RUN_DIR` / the ledger.** graft is the single resolution locus; the slot is *told*, it does not detect.

## 3. WHAT — Vocabulary, Types, and Interfaces

| Term | Definition |
|---|---|
| Lights-out signal | The boolean "this is an L4 lights-out run", canonically `readLedger($FAFF_RUN_DIR).level === "L4"`. Resolved by graft, **forwarded** to the review slot. |
| Escalation | Upgrading the review's declared hard signal from `pass` to `needs-human` because a Phase-2 `critical` was found on the lights-out path. |
| Escalation threshold | The set of Phase-2 severities that trigger escalation. v1: `{ critical }`. |
| Advisory (unchanged) path | L1–L3, or any run where the lights-out signal is false/unresolved: Phase-2 findings stay soft, the contract block declares Phase-1's signal verbatim. |

**The signal the slot receives.** faff-graft Step 9, when invoking the `review` slot, passes one additional context value: `lights_out: Boolean` — true iff graft resolved `level:"L4"`; default false. This is prose-level context passed in the Skill-tool invocation, not a new CLI flag.

**The contract block the slot emits (shape unchanged).** The `faff-contract:review-verdict` block keeps its exact shape — `{ signal, findings }`, `findings: [{ location_present, action_present }]`. The escalation only changes the *values*. The unchanged contract's invariant: `signal ∈ {fail, needs-human} ⇒ findings non-empty AND every finding has location+action present`.

**Chosen — where the escalation sits:** the slot (`faffter-dark-adversarial-review`), at Phase-2 / contract-block-authoring time. The `review-verdict` contract CLI and graft Step 10 are both unchanged.

**Chosen — how the slot learns it is lights-out:** graft Step 9 forwards its already-resolved lights-out signal to the review slot; the slot does not re-resolve.

**Chosen — escalation severity threshold:** `critical` only in v1, held in a single named constant in the slot's escalation step, with a comment noting how to widen to include `major`.

**Chosen — satisfying the contract's non-empty-findings invariant on escalation:** on escalation only, fold the escalating `critical` finding(s) into `findings[]`, each declared `{ location_present: true, action_present: true }`. A narrow carve-out to the "Phase-2 never in `findings[]`" rule, scoped strictly to the lights-out escalation.

## 4. HOW — Behavior

Two prompt edits, no code edit:

1. **`faff-graft` Step 9** — where it invokes the `review` slot, pass the resolved lights-out signal (the same `level:"L4"` boolean graft resolves for admissibility/holdout) as an input to the slot invocation, defaulting `false` when unresolved.
2. **`faffter-dark-adversarial-review`** — add the escalation step after Phase 2 produces findings and at the point it authors the `faff-contract:review-verdict` block, gated on the forwarded signal.

**The escalation procedure (slot-side).**

```
PROCEDURE author_review_verdict(phase1_signal, phase2_findings, lights_out):
  1. IF phase1_signal != "pass":
       emit block { signal: phase1_signal, findings: <phase1 findings, as today> }; RETURN
  2. ESCALATE_SEVERITIES := { "critical" }          # the named threshold constant (v1)
  3. IF lights_out AND any(f.severity in ESCALATE_SEVERITIES for f in phase2_findings):
       escalating := [ f for f in phase2_findings if f.severity in ESCALATE_SEVERITIES ]
       emit block {
         signal: "needs-human",
         findings: [ { location_present: true, action_present: true } for _ in escalating ] }
       RETURN
  4. emit block { signal: "pass", findings: <phase1 findings, as today> }
```

**Fail-safe direction.** When the lights-out signal is **unresolved or false**, take the advisory path (no escalation) — consistent with the sibling L4 build-pipeline gates.

**Edge cases.** Phase 1 not `pass` → return Phase-1's signal verbatim. Lights-out + no `critical` → advisory path. Lights-out + multiple criticals → fold all; signal `needs-human`. A `critical` too vague to name a location/action → still escalate (fail safe).

## 5. SCENARIOS — born-verifiable main objectives

```
Given a lights-out run (ledger level:"L4") and a built diff whose Phase-1 review returned pass
When the Phase-2 adversarial review returns a finding with severity `critical`
Then the review slot's faff-contract:review-verdict block declares signal `needs-human`
 And the block is conformant (needs-human carries >=1 finding with location+action present)
 And graft Step 10 (unchanged) parks the PR without merging
```

```
Given the same critical adversarial finding on a run that is NOT lights-out (L1–L3 or unresolved signal)
When Phase 2 completes
Then the review slot declares signal `pass` (advisory), exactly as today
```

```
Given a lights-out run whose Phase-2 findings are all `major`/`minor`/`observation` (no critical)
When Phase 2 completes
Then the review slot declares signal `pass` (advisory) — the escalation does not fire below the threshold
```

Assertion: the `review-verdict` contract CLI (`computeReviewVerdict`) and faff-graft Step 10 are unchanged — verified by diff.

## 8. DONE — Definition of Done

- On a lights-out run, a Phase-2 `critical` results in the review slot declaring `needs-human`; the PR is parked by the unchanged Step 10.
- L1–L3 (and unresolved-signal) behaviour is unchanged: a `critical` stays advisory, review declares `pass`.
- The escalation is implemented in `faffter-dark-adversarial-review/SKILL.md` only (plus the Step 9 forward); no edit to `computeReviewVerdict` or `review-verdict.schema.json`.
- faff-graft Step 9 forwards the resolved lights-out signal, defaulting `false` when unresolved.
- faff-graft Step 10 is byte-for-byte unchanged — verified by diff.
- The escalation threshold is a single named constant set to `{ critical }`, with a comment noting how to widen it.
- On escalation, the emitted block has `signal:"needs-human"` and one `{location_present:true, action_present:true}` per escalating critical (conformant → contract exit 0).
- A contract fixture demonstrates `{signal:"needs-human", findings:[{location_present:true,action_present:true}]}` → conformant (exit 0).
- `faff validate-adapters` passes on both edited SKILL.md files.
- `faff contract review-verdict --selftest` passes (contract unchanged).

confidence: high
spec-review: approve
