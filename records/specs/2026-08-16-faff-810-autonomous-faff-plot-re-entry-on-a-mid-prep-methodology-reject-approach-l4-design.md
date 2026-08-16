# Spec — FAFF-810: Autonomous /faff-plot re-slice on a mid-prep methodology reject (L4)

> Spec: faffter-dark-nlspec · 2026-08-16 · interactive · confidence: high
> Revised 2026-08-16 — folded in the operator decision (ADR-promotion-intent on FAFF-809). The earlier draft chose Option A (decompose-only, STOP) for the post-re-slice behaviour; that is replaced. At L4 the re-slice feeds the wave loop and the run converges (ticket size is never an L4 park reason); at L1–L3 it parks for a human, unchanged. Re-slice mechanism/file claims are unchanged from the reviewed draft.

## 1. WHY

The up-front autonomous plot seam exists (FAFF-494): at L4, section 0a's `plan` verdict invokes `/faff-plot --autonomous`. The gap is the reactive path: a spec-review `methodology reject-approach` raised during prep (a slice reached prep still too big) has no autonomous route — faff-prep parks it for a human. At L4, "too big" is decidable by the agents (re-slice it), so it must never park; parking is reserved for genuine risk or a genuinely-undecidable call. This wires faff-prep's L4 methodology-lens `reject-approach` to the same `/faff-plot --autonomous` re-slice seam and lets the run keep converging on the wave loop; L1–L3 keep parking for a human. Governed by the ADR-promotion-intent on FAFF-809.

## 2. OUT OF SCOPE

- Design-lens (`architectural`/`infosec`/`QA`) reject routes — unchanged (revise in place); FAFF-811 owns their multi-lens interaction.
- L1–L3 behaviour — unchanged (human-interactive park).
- The `/faff-plot --autonomous` seam itself — reused (FAFF-494), not modified.
- The convergence-loop mechanics — owned by FAFF-499; this ticket feeds it.

## 3. WHAT / HOW

faff-prep's spec-review consumer-fold already routes `reject-approach` by objecting lens. Change the `methodology`-lens (and the multi-lens plot-wins) cell to split by the run's L4 signal — read `level` from the run-ledger at `$FAFF_RUN_DIR`; absent/≠ `"L4"` → not-L4, fail-safe to park:

```
methodology-lens reject-approach:
  L1–L3 (or interactive):  park + surface for human-interactive /faff-plot   [unchanged]
  L4:
    1. Resolve the re-slice target (parent issue + its container as the inherited
       TargetRef anchor). No target → park (can't re-slice with no anchor).
    2. Invoke /faff-plot --autonomous against the anchor (it self-mints its L4
       ledger, runs the outward guard, drives the topology envelope + loop caps).
       faff-prep mints nothing and writes no tracker structure itself (lane).
    3. Terminate prep for THIS parent slice with a re-slice handoff outcome
       (logged: parent, objecting lens(es), target). Do NOT re-spec it in place.
    4. The re-sliced epics land in Backlog (faff-jot-intake) and re-enter the
       SAME run's wave loop — the run converges (does not stop) until run-done
       reports the PRD fulfilled. (Convergence loop: FAFF-499.)
```

- **Size is never an L4 park.** The only L4 escapes from re-slice-and-continue are a genuine risk or a proven can't-reduce: if re-slicing does not converge (the churn detector trips), that is a genuine can't-decide → park/escalate, not a size park.
- **Lane preserved.** faff-prep invokes plot via the Skill tool; the prep/build subagents never write the tracker.
- **plot refuse.** If `/faff-plot --autonomous` ignition refuses (self-directed / no-target / inadmissible), record its `needs-human` and park the parent per the shared protocol — scope never lost, no retry.

## 4. SCENARIOS

```
Given an L4 prep run and a spec-review reject-approach with objecting lens methodology
When faff-prep routes it
Then it invokes /faff-plot --autonomous against the resolved anchor,
  mints no ledger and writes no structure itself,
  records a re-slice handoff for the parent,
  and the re-sliced epics re-enter this run's wave loop (the run converges, not stops)
```
```
Given an interactive prep, or an L3 autonomous prep, and the same verdict
Then faff-prep parks the slice for human-interactive /faff-plot   [unchanged]
```
```
Given an L4 re-slice whose children keep being judged too big (churn detector trips)
Then the run escalates it as a genuine can't-reduce (not a size park), per the shared protocol
```
- Design-lens-only rejects still revise in place at every level (unchanged).

## 5. RATIONALE

- **L4 re-slices, never parks on size (operator decision).** ADR-promotion-intent on FAFF-809.
- **Feed the wave loop, don't stop.** The re-sliced epics converge in the same run (FAFF-499) — the emergent-decomposition model, not the earlier decompose-only-STOP.
- **Read `level` from the ledger, not a flag/env sniff** — mirrors section 0a's L4 guard.
- **Reuse plot ignition wholesale** — no parallel path; plot owns the envelope/caps/guard.

## 6. OPEN QUESTIONS

None blocking. How the re-sliced epics drain in-run is FAFF-499's convergence mechanics; this ticket hands off to it. Whether same-run convergence suits the reactive path is settled: yes at L4 (operator decision), with the churn/can't-reduce escalation as the only stop.

## 7. DONE

- [ ] At L4, a methodology-lens `reject-approach` invokes `/faff-plot --autonomous` (re-slice) rather than parking; the re-sliced epics re-enter this run's wave loop and the run converges (does not stop after the re-slice).
- [ ] Size is never an L4 park reason; the only L4 stop is a genuine risk or a churn/can't-reduce escalation.
- [ ] L1–L3 (and interactive) park for a human, byte-unchanged.
- [ ] faff-prep mints no ledger and writes no tracker structure itself (lane preserved); it reuses `/faff-plot --autonomous` ignition.
- [ ] The `level` signal is read from the run-ledger at `$FAFF_RUN_DIR`; absent/≠L4 fails safe to park.
- [ ] Design-lens reject routes are unchanged (FAFF-811 owns the multi-lens split).
- [ ] A plot ignition refuse parks the parent (scope not lost), no retry.

confidence: high
