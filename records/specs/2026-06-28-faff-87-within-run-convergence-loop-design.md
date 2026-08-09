# Spec — FAFF-87: Within-run convergence loop (L4) — refreshed → high

> Spec: faffter-dark-nlspec · refreshed 2026-06-28 · interactive · confidence: high.

**Revised 2026-06-28 (interactive /faff-prep):** the blocker landed — **FAFF-38 shipped** (PR #199, `faff run-done` is on `main`). This is the refresh the ticket planned (*"once FAFF-38 lands, refresh folds the model in and bumps medium → high"*). Both Punts now closed; supersedes the earlier `medium` spec.
- **§5 D5 (new):** composes with the **shipped** `faff run-done` predicate (its real interface, below) — Chosen.
- **§5 D6:** spike-vs-feature Punt → **Chosen: single thin feature** (FAFF-38 settled the termination design, so no separate de-risking spike).
- **Blocker:** `blockedBy FAFF-38` is satisfied (FAFF-38 Done); the link can be cleared at build.

**Superseded in part 2026-07-23:** D4's default-off posture was flipped by FAFF-534 (PR #466) — see the dated annotation on D4.

## 1. WHY

Today execution-discovered scope is filed and picked up *next* run (beep-boop step 10), so greenfield depth grows ~one layer per run. The L4 form closes the loop **within one run**: after a build wave, file discovered scope → prep it → re-enter the build loop until **both** bottom-up tributaries (chain-gap + execution-discovered) run dry. "Both dry" is the real definition of done — the literal *"describe an app → wake up to it built"* capability.

## 2. WHAT

Extend beep-boop **wave re-entry (step 8)** — which today re-checks only *blocker-unlocked* Todo/Backlog issues — to also fold in **freshly-filed discovered-scope tickets** (step 10), narrow-prep them mid-run, re-assemble the build queue, and loop. The loop's **stop decision is delegated to the shipped `faff run-done` predicate** (FAFF-38); FAFF-87 supplies the two signals run-done can't compute itself (`non_convergence`, and the discovered-scope re-entry that determines `work-remaining`).

## 3. Termination model — RESOLVED + now buildable

**Chosen: option (B) — compose with FAFF-38's `faff run-done`** (human decision 2026-06-12; FAFF-38 shipped 2026-06-27). The within-run loop does **not** ship its own provisional both-dry predicate; it calls `run-done` at each wave boundary and acts on the verdict.

The termination *signals* (unchanged): primary = **genuine dryness** (a wave filing zero new concrete discovered items AND surfacing no new spec-referenced untracked work) → run-done returns `run-complete/drained`; bounded by **budget** (FAFF-36, shipped — run-done reads `budget`); with any hard iteration cap demoted to a **runaway backstop only** → fed to run-done's `non_convergence` input, which the structural ladder maps to `escalate/non-convergence` (never a silent truncation).

## 4. Dependency status (verified 2026-06-28)

- **FAFF-38** (`faff run-done` terminating predicate) — **SHIPPED** (PR #199, on `main`). The blocker is satisfied; FAFF-87 is build-ready.
- **FAFF-36** (run-cost budgets / `--until` `--max`) — shipped. run-done reads `budget`; the loop honours the same envelope at each wave boundary.
- **FAFF-49** (Sentry kill-switch) — unbuilt. A *downstream consumer* of the `non-convergence` escalate, not a blocker.

## 5. DESIGN DECISION RATIONALE

- **D1 — Chosen — loop mechanism:** at wave re-entry, fold freshly-filed discovered-scope tickets (step 10) into the same run: file → narrow-prep → re-assemble the build queue → drain → repeat. The orchestrator does no tracker state moves of its own (prep is the entry point, per the existing wave-re-entry rule).
- **D2 — Chosen — termination = `faff run-done`:** at each wave boundary call `run-done` with the assembled `RunSignals`; **`continue` → loop again** (re-enter for discovered/chain-gap work), **`run-complete` → converged/drained stop, `escalate` → needs-human stop.** FAFF-87 owns computing the two orchestrator-supplied signals: `non_convergence` (K consecutive no-progress waves — files zero new concrete items) and the discovered-scope re-entry that keeps `queue_empty` false while real work remains.
- **D3 — Chosen — hard cap is a backstop only:** the iteration cap feeds run-done's `non_convergence` input → `escalate/non-convergence` (a distinct, reported stop reason — a bug signal), never the normal exit, never a silent truncation.
- **D4 — Chosen — default off / opt-in:** within-run convergence is an opt-in beep-boop mode (convergence is L4 discipline); it composes with the existing `--until` / `--max` budget gates (run-done already reads `budget`, so a budget breach short-circuits the loop before re-entry).
  - **Superseded 2026-07-23 by FAFF-534 (PR #466):** the shipped default flipped ON —
    L4 non-optional (knob/flag inert), L3 default-on with an explicit opt-out only
    (`--no-converge` / `enabled: false`). See records/specs/2026-07-23-faff-534-within-run-convergence-default-posture-design.md.
    Original text below preserved as the decision as made.
- **D5 — Chosen — single thin feature:** with FAFF-38 shipped, the termination design is settled, so this is a thin wave-re-entry extension + signal wiring on top of `run-done` — **no separate de-risking spike**.
- **D6 — Chosen — dryness ⟺ run-done `run-complete` with no fresh re-entry:** "both tributaries dry" is operationalised as: a wave that files zero new concrete discovered items AND surfaces no new spec-referenced untracked work, at which point the re-assembled build queue is empty and `run-done` returns `run-complete/drained`. Value/concreteness + dedup gating (shipped) bounds what re-enters.

**Assumes:** the shipped `faff run-done` interface — inputs `{queue_empty, all_parked, ledger_clean, budget, prd_satisfied, inflection, non_convergence, --policy}` → `{verdict: run-complete|continue|escalate, reason}`. *Validated at build: it is on `main` and `--selftest`-covered (FAFF-38).*
**Assumes:** the run-ledger / runcheck invariants extend to in-run-prepped-and-built discovered tickets — every one gets a terminal outcome, and the `converged/both-dry` stop reason is recorded. *Validated at build.*

## 6. DONE

- [ ] Concrete scope discovered during a wave is prepped **and** built in the **same** run (file → narrow-prep → re-assemble → loop), not deferred to the next run.
- [ ] At each wave boundary the loop calls `faff run-done` and acts on the verdict: `continue` → re-enter; `run-complete` → stop `converged/both-dry`; `escalate` → stop + needs-human.
- [ ] FAFF-87 computes and supplies `non_convergence` (K consecutive no-progress waves) so run-done's `non-convergence` escalate can fire; the hard cap is a backstop only, reported, never a silent truncation.
- [ ] Depth is bounded by budget (FAFF-36, read by run-done) + value/concreteness + dedup gating — **not** a fixed iteration count as the primary mechanism.
- [ ] runcheck / run-ledger invariants hold for in-run discovered tickets; the `converged/both-dry` stop reason is recorded; the next-run file-and-defer form remains the fallback when the mode is off or budget-capped.
- [ ] Within-run convergence is an opt-in mode that composes with `--until` / `--max`. *(default posture superseded 2026-07-23 by FAFF-534 — now default-on / L4 non-optional; the budget-gate composition still holds)*

confidence: high
