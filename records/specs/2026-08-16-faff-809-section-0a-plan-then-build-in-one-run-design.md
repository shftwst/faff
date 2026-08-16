# Spec — FAFF-809: Section 0a — at L4, converge after planning instead of stopping

> Spec: faffter-dark-nlspec · 2026-08-16 · interactive · confidence: high
> Revised 2026-08-16 — folded in the operator decision (ADR-promotion-intent on this ticket). The earlier draft gated the fall-through OFF behind a config flag pending a plan-side gate; that framing is replaced. At L4 the fall-through is the behaviour, not a flag: the run converges until the PRD is fulfilled. The plan-side gate is a noted future improvement, not an off-switch. Mechanism/file claims are unchanged from the reviewed draft.

## 1. WHY

At L4 the point is to decompose a PRD and build it to completion without a human, within the PRD's bounds. Today beep-boop section 0a's `plan` verdict decomposes (invokes `/faff-plot --autonomous`) and then STOPs "decompose-only," so a greenfield PRD needs a second run to build — a stop-on-size the L4 contract should not have. This change makes the `plan` branch, at L4, continue into the same run's build pipeline: after plot authors the first slice's PRDRs, fall through to step 1 (tidy) → prep → build, and let the existing wave loop converge until the PRD is fulfilled. Decomposition stays emergent, not waterfall: plot mints only the next buildable slice; the rest emerges as too-big is discovered and re-sliced (FAFF-810), on the same wave loop. Governed by the ADR-promotion-intent on this ticket.

## 2. OUT OF SCOPE

- **Plan-side adversarial/confidence gate** (a build-side-spec-review analogue for "is this the right decomposition") — a noted future improvement, not a blocker and not an off-switch. Extension point: a gate between plot's return and the fall-through.
- **run-start ladder / coverage producer** — `deriveRunTrigger`, `computePrdCoverageVerdict` are re-invoked, not modified.
- **Continuous per-item scheduling** — deferred; build scheduling stays wave-based (only the plan→build handoff changes).
- **L1–L3** — unchanged; section 0a is L4-only.

## 3. WHAT / HOW

The edit is confined to section 0a step 7's `plan` branch in `faff-beep-boop/SKILL.md`. Everything up to and including "invoke `/faff-plot --autonomous`" is unchanged; what changes is what happens after plot returns.

```
PROCEDURE plan_branch_after_plot(container, prd_path):   # L4, verdict == plan
  1. /faff-plot --autonomous ran and returned (self-minted its own L4 ledger;
     authored faff-jot-intake epics + PRDRs, or parked/halted).
  2. Re-read coverage over the now-current live PRDR set:
       faff prdr coverage --container <container> --prd-goals '<goals>'
       (omit --live-prdrs/--dod-verdicts; consume boolean .covered)
  3. Mint the build run's ledger via `faff lights-out`
     (--prd-creative-licence <value> when resolved; parity with the drain branch;
      do NOT reuse plot's decompose-pass ledger).
  4. Fall through to step 1 (tidy) → prep queue → build.
     The prep queue already consumes plot's faff-jot-intake epics; no new wiring.
  5. The wave loop converges from here — each wave builds what's buildable and,
     when coverage is still short, the loop plots/re-slices the next slice
     (emergent, FAFF-810), terminating on run-done (PRD fulfilled / budget /
     convergence backstops). It does NOT stop after the first plot.
```

- **No enablement flag.** The fall-through is the L4 behaviour, unconditional (the earlier default-off flag is dropped).
- **"Still thin" is not a stop.** If plot produced only a partial decomposition, the wave loop keeps going (plots/builds the next slice), bounded by run-done/budget — not a coverage gate that STOPs here.
- **Mint separation.** plot's self-minted ledger is the decompose pass; the build pass mints its own via `faff lights-out`, as the `drain` branch does.
- **Fail-safe reads.** A non-zero/unparseable coverage re-read → measurable=false; the run continues via the wave loop's own run-done consult, never a false "done."

## 4. SCENARIOS

```
Given an L4 run whose section 0a returned `plan` (coverage-thin)
When /faff-plot --autonomous returns having authored the first slice's PRDRs+epics
Then section 0a mints the build ledger and falls through to step 1 → prep → build
  in the same run (no second arm cycle)
  and the wave loop converges until run-done reports the PRD fulfilled
```
```
Given the same run, but plot returned only a partial first slice
When section 0a falls through
Then the run builds what's buildable and the wave loop plots the next slice on a
  later wave — it does not STOP decompose-only
```
- L3 is unchanged: section 0a is L4-only; an L3 self-drain never enters it.

## 5. RATIONALE

- **Converge, don't stop (operator decision).** Stopping after planning is a stop-on-size, which the L4 contract forbids; the run decomposes-and-builds to completion within the PRD. See the ADR-promotion-intent on this ticket.
- **Re-read coverage, not the full ladder** — only the coverage rung can change across the plot call; the other run-start signals are stable this run.
- **Mint own ledger** — clean decompose-pass vs build-pass separation (runcheck/reconcile scope).

## 6. OPEN QUESTIONS

None blocking. The plan-side gate (section 2) is a future improvement in the ADR's consequences, not a gate on this change.

## 7. DONE

- [ ] At L4, a `plan`-verdict run continues into step 1 → prep → build in the same run after plot returns; no second run, no config flag gating it.
- [ ] The build pass mints its own ledger via `faff lights-out`; plot's ledger is not reused.
- [ ] A partial post-plot coverage does not STOP the run — the wave loop continues and terminates via run-done (PRD fulfilled / budget / convergence backstop).
- [ ] `deriveRunTrigger` and `computePrdCoverageVerdict` are unmodified; the edit is confined to section 0a's `plan` branch.
- [ ] L3 behaviour is byte-unchanged (section 0a L4-only).
- [ ] No default-off enablement flag is introduced; the plan-side gate is documented as a future improvement, not a blocker.

confidence: high
