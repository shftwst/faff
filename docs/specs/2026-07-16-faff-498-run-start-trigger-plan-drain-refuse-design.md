# FAFF-498 — Wire `faff run-start` into beep-boop §0a: three-way PLAN/drain/refuse, L4-guarded

> Spec: faffter-dark-nlspec · 2026-07-16 · autonomous · confidence: high. Full spec on Linear FAFF-498.
> **Refreshed 2026-07-16 (autonomous)** — folded operator resolution (comment "Resolution (operator, 2026-07-16)"): (1) coverage ships the **all-or-nothing boolean v1** (DoD-derived `covered`) — a numeric ratio/tolerance floor is a later coverage-*producer* change, **not this wiring**; no ratio knob is added here (the §7 product Punt is closed as decided). (2) Blocker **FAFF-521 is being resolved this same pass**; this wiring **sequences after FAFF-521** — both populate `signals.outward` identically via the repo-slug match (`target.repo == tracking.repo`). Re-rated **medium → high** (no open decisions remain in scope).

This spec is for the build agent wiring FAFF-498 and for the human reviewers gating it. It **narrows** the original ticket: the decision-table *predicate* it asked to "implement" already shipped in FAFF-496 (PR #402 / commit 737fb66) as the pure CLI `faff run-start` plus its consumer-side validator `faff contract run-trigger`. What remains — and all this spec covers — is the **caller-side wiring**: nobody invokes the predicate yet. This is a skill-prose change to `plugin/skills/faff-beep-boop/SKILL.md` §0a plus its born-verifiable coverage; it writes no new CLI.

## Refresh (operator resolution, 2026-07-16)

- **Coverage = boolean v1 (Chosen).** Ship the all-or-nothing DoD-derived `covered` (every PRD goal has ≥1 live PRDR). **No numeric ratio/tolerance knob is added in this wiring** — a ratio is a later change to the *coverage producer* (`faff prdr coverage`), not this call-site. The former §7 product Punt is **closed as decided**; the additive `measure` block already reserves the ratio's future home.
- **Sequences after FAFF-521 (Assumes tightened).** FAFF-521 (the `signals.outward` producer + repo-slug oracle) is being resolved this same pass. This wiring consumes `signals.outward` and populates `--self` identically to FAFF-521's plot-ignition — via the repo-slug match `target.repo == tracking.repo`. Build order: **521 before/with 498**; until 521 threads a real value the wiring passes `outward=false` (fail-safe → `refuse / self-directed`).

## 1. WHY — Problem and Principles

**The load-bearing model.** The run-start *decision* is a solved, tested, pure function — `faff run-start` folds seven booleans (`target_resolved`, `outward`, `prd_present`, `prd_ambiguous`, `prd_admissible`, `coverage_measurable`, `coverage_covered`) through a fixed refusal-biased ladder into `{verdict ∈ plan|drain|refuse, reason}`, and `faff contract run-trigger` re-derives that pair Pattern-B so a forged verdict can never widen past its signals (both in `plugin/skills/faff/bin/lib/run-start.js`, `contract-defs.js`, shipped #402). **What is missing is the phone call:** at the top of a lights-out run, beep-boop still makes the *old binary* PRD-admissibility choice (PROCEED vs REFUSE) and never asks the predicate whether the run should PLAN, drain, or refuse. This ticket makes beep-boop resolve the seven signals and *call* `faff run-start`, then act on its three-way verdict. It is the last human act at the top of the loop being handed to the predicate that already knows how to decide.

**Problem statement.** Today beep-boop §0a (the L4-lights-out-only PRD pre-check) admits any admissible PRD straight into the drain pipeline (`PROCEED`) and refuses the rest — it can never choose to *decompose* an under-covered PRD, so a PRD whose goals are only half-decomposed drains what little exists instead of planning the rest. This change replaces §0a's binary PROCEED/REFUSE with a three-way PLAN/drain/refuse sourced from `faff run-start`, so an admissible-but-thinly-covered PRD triggers `/faff-plot --autonomous` unprompted.

**Design principles** (each rejection-worthy if violated):

- **The L4-lights-out guard is load-bearing and must not be crossed.** §0a is already "L4 lights-out only — an ordinary L3 run skips it entirely." The three-way branch lives behind that *same* guard. faff is L3-on-itself (ADR-0069) and drains its own backlog nightly at L3; the predicate's `refuse / self-directed` row is defence-in-depth for the *planning* decision, not the drain. If the `run-start` call leaked outside the §0a L4 guard, `self-directed → refuse` would fire on faff's own L3 self-drains and break faff draining itself. **Invariant: plan is L4-gated + outward-only; drain is L3 + self-allowed; the two must never cross.**
- **Reuse the one L4 signal — never a side-channel.** The guard is the run's lights-out level (`level: "L4"`, which only `faff lights-out` writes after its 8-guardrail preflight). The wiring reuses §0a's *existing* L4-lights-out guard; it introduces **no** new `--autonomous` / `--plan` flag and **no** env sniff at the call-site.
- **Decompose-only.** A `plan` verdict authorises decomposing *the resolved admissible PRD* only, via `/faff-plot --autonomous` (FAFF-494). Any path that would require conjuring new scope resolves to `refuse` on the human-owned path — the predicate structurally cannot emit `plan` without an admissible PRD.
- **Compose, re-implement nothing.** The wiring reads each signal from its single shipped producer and passes booleans to `faff run-start`. It re-derives no ladder logic; the predicate and its validator remain the sole source of the decision. In particular it does **not** compute a coverage ratio — it reads the boolean `.covered` as shipped.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` §0a | skill prose | The call-site being rewritten (binary → three-way) |
| `plugin/skills/faff/bin/lib/run-start.js` | JS (shipped #402) | The predicate `faff run-start` + `deriveRunTrigger` ladder this wiring calls |
| `plugin/skills/faff/bin/lib/contract-defs.js` (`computeRunTrigger`) | JS (shipped #402) | `faff contract run-trigger` Pattern-B validator |
| `plugin/skills/faff/bin/lib/lights-out.js` | JS | Mints the `level:"L4"` ledger + carries `prd_creative_licence` |
| `plugin/skills/faff/bin/lib/prdr.js` (`coverage`) | JS (shipped #402) | Produces the coverage signal (`.covered`) — FAFF-497 |
| `plugin/skills/faffter-noon-prd/SKILL.md` → `faff contract prd-readiness` | skill + JS | The admissibility signal §0a already computes |
| `plugin/skills/faff-plot/SKILL.md` (`--autonomous`) | skill prose (FAFF-494) | The `plan` executor; its stub guard requires a minted L4 ledger |
| FAFF-521 `faff run-outward` + repo-slug oracle | JS + plot prose | Supplies `signals.outward`; this wiring populates `--self` the same way (repo-slug match) |

**Scope statement.** This is the caller half of "Self-starting plans": it seats the FAFF-496 predicate at the one call-site (§0a) that opens an unattended run, between PRD resolution and the tidy/prep/build pipeline. It sequences after FAFF-521 (the `signals.outward` producer).

## 2. OUT OF SCOPE

- **The run-trigger predicate + contract** — DONE in FAFF-496 (#402). `faff run-start` (the ladder) and `faff contract run-trigger` (Pattern-B, fail-safe → refuse) exist and are selftested. **Extension point:** none needed; consumed as-is via `faff run-start --signals`.
- **The coverage signal producer** — FAFF-497, premise-superseded; its signal (`faff prdr coverage` → `.covered` + additive `measure`) **shipped in #402**. This wiring only *reads* `.covered`. **Extension point:** `faff prdr coverage`.
- **A numeric coverage ratio / tolerance floor** — a future product refinement, decided **out of this ticket** (operator resolution 2026-07-16: boolean v1 only). The substrate emits boolean `covered`, not a fraction; a ratio is a change to the coverage *producer* (`faff prdr coverage`), not this call-site. **Extension point:** the additive `measure` block already reserved on the coverage signal; taking the ratio later changes only the producer, not this wiring.
- **The outward-only *mechanism*** — FAFF-521 supplies `signals.outward` (the `faff run-outward` producer + repo-slug oracle). This wiring *threads* that boolean in and populates `--self` via the same repo-slug match; it does not compute inwardness. **Extension point:** `signals.outward` (FAFF-521). This wiring **sequences after** FAFF-521.
- **Per-level plot gate answers** — FAFF-494's `/faff-plot --autonomous` harness. Invoked *after* a `plan` verdict; its internal gate-answering is not this ticket. **Extension point:** `plugin/skills/faff-plot/SKILL.md` → Autonomous mode.
- **Run-end / convergence read** — `faff run-done`'s `prd_satisfied` floor is unchanged; that reads `.satisfied` at run-*end*. This wiring reads `.covered` at run-*start* only.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| L4-lights-out guard | The existing §0a condition "under the L4 lights-out signal only"; the run's lights-out level, `level:"L4"`, which only `faff lights-out` writes. An ordinary L3 run has no such level and skips §0a. |
| RunTriggerSignals | The seven-boolean bundle `faff run-start` consumes (`--signals` JSON and/or per-signal flags). Every non-`true` value coerces to `false` (refusal-biased fail-safe). |
| RunTriggerVerdict | `{ verdict ∈ plan|drain|refuse, reason, signals, conformant, violations }` — the predicate's output. |
| Decompose-only | A `plan` verdict decomposes the admissible PRD only; it never drains and never conjures new scope. |
| coverage_covered | Boolean v1 — every PRD goal has ≥1 live PRDR. All-or-nothing, DoD-derived; NOT a fraction (no ratio knob in this wiring). |

**The signal bundle the wiring assembles.** The wiring's job is to source these seven booleans from their shipped producers and hand them to `faff run-start`. It authors no ladder logic.

```
RECORD RunTriggerSignals:                # consumed by faff run-start (shipped #402)
  target_resolved:    Boolean   # a run target resolved (explicit > inherited > methodology-default; FAFF-521/FAFF-40 order)
  outward:            Boolean   # FAFF-521 signals.outward — target is NOT faff's own container (repo-slug match; ADR-0069)
  prd_present:        Boolean   # §0a step 1: exactly-one / disambiguable Active|Frozen PRD present
  prd_ambiguous:      Boolean   # §0a step 1: >1 Active|Frozen PRD, not disambiguable
  prd_admissible:     Boolean   # §0a steps 4-5: prd slot -> `faff contract prd-readiness` exit 0 + admissible
  coverage_measurable:Boolean   # `faff prdr coverage` computed cleanly (not malformed / not exit≠0)
  coverage_covered:   Boolean   # `faff prdr coverage` .covered (every PRD goal has ≥1 live PRDR) — BOOLEAN v1, no ratio
  # Any signal the wiring cannot resolve is passed FALSE (or omitted) -> the predicate's fail-safe -> refuse.
```

**The verdict → action map** (the wiring's whole behavioural surface):

| `faff run-start` verdict | reason (closed) | Wiring action |
|---|---|---|
| `plan` | `coverage-thin` | Invoke `/faff-plot --autonomous` against the resolved target — **plot self-mints its own L4 ledger** at ignition. beep-boop mints **nothing** and does **not** drain. **Decompose-only.** |
| `drain` | `prd-covered` | Fall through to the ordinary pipeline (mint L4 ledger as §0a does today → tidy → prep → build). |
| `drain` | `no-prd-nothing-to-plan` | Same drain path (the existing no-PRD → tidy behaviour). |
| `refuse` | `no-target` / `self-directed` / `prd-ambiguous` / `prd-inadmissible` / `coverage-unmeasurable` | Mint **nothing**; surface the closed `reason` for `/faff-wtf`; exit §0a before any tracker write. |

**Interface calls (all shipped; no new CLI):**
- `faff run-start --signals '<RunTriggerSignals JSON>'` → prints `RunTriggerVerdict`, exit 0 (report-only). A malformed `--signals` exits 2 → treat as `refuse` (fail-safe).
- `faff prdr coverage …` → the coverage verdict carrying boolean `.covered`; a non-zero exit or malformed output ⇒ `coverage_measurable=false`.
- `faff run-outward --target … --self …` (FAFF-521) → `signals.outward`; `--self` populated via the repo-slug oracle (`target.repo == tracking.repo`), identical to plot-ignition.
- `faff lights-out --prd-creative-licence <value>` → mints `level:"L4"` ledger (unchanged; called on `drain` only — `plan` hands off to plot which self-mints, `refuse` mints nothing).

## 4. HOW — Behavior

**Architecture and approach.** §0a keeps its exact position — L4-lights-out-only, running *before* any ledger is minted — and its PRD-resolution steps (1–3) are unchanged. The change is at the decision point: today's step-5 binary branch (admissible→PROCEED / else→REFUSE) becomes "assemble RunTriggerSignals → call `faff run-start` → branch on verdict." **Only `drain` mints a beep-boop ledger** — exactly as today's PROCEED does (step 6, carrying `prd_creative_licence`). `plan` hands off to `/faff-plot --autonomous`, which **self-mints** its own L4 ledger at ignition (`faff-plot/SKILL.md` → Ignition; FAFF-496 Assumes) — beep-boop mints nothing on the plan path (minting here too would double-mint). `refuse` mints nothing. The creative-licence threading §0a already does on PROCEED is preserved on the drain mint.

**The rewritten §0a decision (pseudocode at the ambiguity point):**

```
PROCEDURE run_start_decision(  # runs ONLY under §0a's existing L4-lights-out guard; L3 skips §0a entirely
    resolved_target, prd_list, prd_path, prd_admissible, creative_licence):
  1. Assemble RunTriggerSignals from the already-resolved §0a inputs (NO new signal source):
     a. target_resolved     := resolved_target is non-empty          # FAFF-521/FAFF-40 resolution
     b. outward             := FAFF-521 signals.outward (--self via repo-slug oracle)   # unresolved -> false (fail-safe)
     c. prd_present         := exactly-one/disambiguable Active|Frozen PRD  (from §0a step 1)
     d. prd_ambiguous       := >1 Active|Frozen PRD, not disambiguable      (from §0a step 1)
     e. prd_admissible      := §0a's prd-readiness contract said admissible (exit 0 + admissible)
     f. coverage            := run `faff prdr coverage …`
        coverage_measurable := coverage exit 0 AND well-formed
        coverage_covered    := coverage.covered === true              # BOOLEAN v1 — no ratio computed here
  2. verdict := faff run-start --signals <the bundle>        # malformed/exit2 -> treat as refuse
  3. BRANCH on verdict.verdict:
     - plan:   invoke /faff-plot --autonomous against resolved_target (plot SELF-MINTS its own L4 ledger);
               beep-boop mints NOTHING here; STOP (decompose-only, no drain).
     - drain:  mint L4 ledger (faff lights-out --prd-creative-licence <creative_licence>, as today);
               fall through to step 1 (tidy) and the ordinary pipeline.
     - refuse: mint NOTHING; record + surface verdict.reason for /faff-wtf; exit §0a.
```

**Signal sourcing — reuse, don't recompute.** Steps 1a–1e reuse reads §0a *already performs* (PRD list/path/admissibility); only the coverage read (1f) and the outward thread (1b) are new inputs, both from shipped producers (521 supplies outward; #402 supplies coverage). The bundle is passed once; the predicate owns every branch. The coverage read consumes the boolean `.covered` — the wiring never derives a fraction.

**The L4 guard — the single load-bearing wiring rule.** The `run-start` call is *inside* §0a's existing "under the L4 lights-out signal only" guard. It is **not** hoisted to a post-mint position merely to read `ledger.level`, and it gets **no** new flag/env of its own. An ordinary L3 run never enters §0a, so `faff run-start` is never consulted on an L3 self-drain — which is exactly what keeps `self-directed → refuse` from ever firing on faff draining its own backlog at L3.

**Edge cases and error handling:**
- **`faff run-start` exits 2 (malformed `--signals`)** → terminal for the decision: treat as `refuse` (fail-safe), surface a diagnostic reason, mint nothing. Never retried into a `plan`/`drain`.
- **Coverage read fails / malformed** → `coverage_measurable=false` → predicate yields `refuse / coverage-unmeasurable`. Never coerced to `drain`.
- **`signals.outward` unresolvable (FAFF-521 not yet threaded)** → passed `false` → `refuse / self-directed`. Fail-safe: a run never *plans* on an unresolved outward signal. Since 521 sequences before/with this ticket, the live path threads a real value. (Assumption below.)
- **No PRD present (outward)** → `drain / no-prd-nothing-to-plan` — preserves today's no-PRD → tidy behaviour.
- **Multiple Active/Frozen PRDs** → `refuse / prd-ambiguous` — preserves today's REFUSE, now via the predicate.

**Failure modes — how this wiring could be wrong, and how you'd notice:**
- **The failure:** the `run-start` call leaks outside the §0a L4 guard (e.g. hoisted to run for every beep-boop invocation). **How you'd know:** an L3 self-drain (ordinary nightly beep-boop, no lights-out) consults `faff run-start`, whose `outward` read of faff's own container yields `refuse / self-directed`, and faff stops draining its own backlog. **What it means:** abandon that placement — the invariant test (Scenario, L3 ledger → run-start never consulted) must stay green.
- **The failure:** a new `--autonomous`/`--plan` flag or env sniff is added at the call-site as the L4 signal instead of reusing §0a's guard. **How you'd know:** a grep at the call-site finds an ad-hoc L4 signal; the guard drifts from the ledger-level truth and can misfire when the flag and level disagree. **What it means:** narrow to the single reused guard.
- **The failure:** `plan` also drains in the same run. **How you'd know:** a run that emitted `plan` both decomposes *and* builds the freshly-planned backlog before the human ever sees the plan — violating decompose-only. **What it means:** `plan` hands off to plot and stops; the *next* run drains once coverage is satisfied.
- **The failure:** someone adds a coverage-ratio computation at this call-site to "drain when mostly covered". **How you'd know:** the §0a call-site computes a fraction instead of reading `.covered`. **What it means:** abandon it — the ratio is a coverage-*producer* change (out of scope, operator-decided); this wiring reads the boolean as shipped.

**Anti-patterns:**
- **Anti-pattern:** re-deriving the ladder in §0a prose (e.g. "if admissible and covered then drain else plan"). Why: the predicate is the single source; prose that restates it will drift from `deriveRunTrigger`.
- **Anti-pattern:** coercing an unmeasurable/failed coverage read to `drain`. Why: it must `refuse / coverage-unmeasurable` (fail-safe); silently draining hides an unmeasurable PRD.
- **Anti-pattern:** computing a coverage ratio/tolerance at this call-site. Why: boolean v1 is the decided shape; a ratio is a coverage-producer change, not this wiring (operator resolution 2026-07-16).
- **Anti-pattern:** re-checking outward-ness in §0a instead of consuming FAFF-521's `signals.outward`. Why: double-gating; 521 owns the mechanism and the repo-slug oracle, this wiring consumes it once.
- **Anti-pattern:** hoisting the `run-start` call out of the §0a guard to read `ledger.level` post-mint. Why: it would run on L3 self-drains and fire `self-directed`.

## 5. Scenarios — born-verifiable main objectives

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given an L4 lights-out run with an outward target, an admissible PRD, and a PRD goal with no live PRDR (coverage.covered==false)
When beep-boop §0a assembles RunTriggerSignals and calls `faff run-start`
Then the verdict is `plan / coverage-thin`, `/faff-plot --autonomous` is invoked against the resolved target (which self-mints its own L4 ledger), beep-boop mints no ledger of its own, and the run does NOT drain
```

```
Given an L4 lights-out run with an outward, admissible PRD whose every goal has a live PRDR (coverage.covered==true)
When §0a calls `faff run-start`
Then the verdict is `drain / prd-covered` and the run falls through to the ordinary tidy→prep→build pipeline
```

**The load-bearing L4-guard invariant (must stay green):**

```
Given an ordinary L3 run (plain beep-boop, no `faff lights-out`; ledger level ≠ "L4")
When the pipeline runs
Then §0a is skipped entirely, `faff run-start` is never consulted, and the run drains its own backlog unchanged (self-directed→refuse never fires)
```

- A static check MUST find the coverage read consumes boolean `.covered` and computes no fraction/ratio at the call-site.

## 6. Design Decision Rationale

**Where does the `run-start` call live — inside §0a's L4 guard, or hoisted post-mint to read `ledger.level`?**
- *Inside §0a's existing L4 guard* — pro: never runs on L3 self-drains (the invariant); reuses the one guard; refuse mints nothing (matches §0a's pre-mint refuse today). Con: at §0a time the L4 ledger for a plan/drain isn't minted yet, so the guard is the lights-out *entry* determination (the same fact that stamps `level:"L4"`), not a literal post-mint read.
- *Hoisted post-mint to read `ledger.level`* — con: would require minting before deciding refuse (orphaned ledger on refuse), and running for every invocation risks L3 leakage.
- **Chosen:** inside §0a's existing L4-lights-out guard — the three-way branch replaces §0a's step-5 binary, reusing the same guard, no new flag/env. The guard's truth is the run's lights-out level (`level:"L4"`, sole writer `faff lights-out`); the born-verifiable invariant (L3 ledger → run-start never consulted) pins it.

**Which paths mint the L4 ledger?**
- **Chosen:** `drain` only. `drain` mints exactly as today's PROCEED does (step 6, carrying `prd_creative_licence`). `plan` mints nothing in beep-boop — `/faff-plot --autonomous` **self-mints** its own L4 ledger at ignition; a beep-boop mint on the plan path would double-mint. `refuse` mints nothing. Rejected alternative: minting in beep-boop then invoking plot — over-reads plot's stub *ignition guard* (which asserts the self-minted ledger exists, it does not demand a caller-minted one) and produces two ledgers.

**Does `plan` also drain in the same run?**
- **Chosen:** no — decompose-only. `plan` invokes `/faff-plot --autonomous` and stops; the next run drains the freshly-decomposed backlog once coverage is satisfied.

**Trigger reads `.covered`, not `.satisfied`.**
- **Chosen:** `.covered` (a PRD goal has ≥1 live PRDR — the decomposition face) is the run-*start* read; `run-done` keeps consuming `.satisfied` at run-*end*. Reading `.satisfied` at start would refuse to plan a fully-undecomposed PRD.

**Coverage threshold = DoD-derived boolean v1; no ratio knob (was the FAFF-496 product Punt — resolved 2026-07-16).**
- **Chosen:** boolean `covered = (no uncovered goals)`; no numeric default and **no ratio knob added in this wiring**. The substrate emits no fraction, so an absolute/ratio floor is ungrounded, and a ratio is a change to the coverage *producer*, not this call-site. Operator resolution 2026-07-16 confirms boolean v1 here; the additive `measure` block reserves the ratio's future home, and the thrash a ratio would guard is already caught by `run-done`'s non-convergence backstop. Taking the ratio later changes only the coverage producer, not this wiring.

## 7. Open Questions and Assumptions

**Open Questions.** None — the coverage-ratio product Punt is resolved (2026-07-16: boolean v1 only, ratio is a future coverage-producer change out of this ticket's scope).

**Assumptions.**
- **Assumes:** FAFF-521 supplies `signals.outward` (the `faff run-outward` producer + repo-slug oracle) for §0a to thread in, and this ticket **sequences after FAFF-521**. *Validation:* grep `signals.outward` / `faff run-outward` in the repo before building; 521 is being resolved this same pass. Until 521 threads a real value the wiring passes `outward=false` (fail-safe → `refuse / self-directed`), so the plan path is unreachable until 521 lands — sequence 521 with/before this ticket. Both call sites populate `--self` identically via the repo-slug match (`target.repo == tracking.repo`).
- **Assumes:** `/faff-plot --autonomous` (FAFF-494) is the `plan` executor and **self-mints its own L4 ledger** at ignition (so beep-boop must not mint on the plan path). *Validation:* confirm `plugin/skills/faff-plot/SKILL.md` → Ignition still self-mints via the reused lights-out preflight before descending.
- **Assumes:** `faff run-start`, `faff contract run-trigger`, and `faff prdr coverage` are on the resolved `faff` binary (shipped #402). *Validation:* `faff run-start --selftest` and `faff prdr --selftest` pass; `grep -n run-start plugin/skills/faff/bin/faff` shows the command registered.
- **Assumes:** §0a's existing PRD resolution (list/path/admissibility, steps 1–5) is reused verbatim as the source of `prd_present`/`prd_ambiguous`/`prd_admissible`; this ticket adds only the coverage read, the outward thread, and the verdict branch.

## 8. DONE — Definition of Done

### From WHY
- [ ] §0a's binary PROCEED/REFUSE is replaced by a three-way PLAN/drain/refuse sourced from a `faff run-start` call (no ladder logic re-derived in prose).
- [ ] An admissible-but-under-covered PRD triggers `/faff-plot --autonomous`; an admissible-and-covered PRD drains — the behaviour the old binary could not express.

### From WHAT (signals + verdict map)
- [ ] §0a assembles all seven RunTriggerSignals from already-resolved inputs (target, `signals.outward` via the repo-slug oracle, PRD presence/ambiguity, prd-readiness admissibility, `faff prdr coverage` measurable + boolean `.covered`) and passes them via `faff run-start --signals`.
- [ ] The coverage read consumes boolean `.covered` and computes **no** ratio/fraction at the call-site (boolean v1).
- [ ] `plan` → invoke `/faff-plot --autonomous` against the resolved target (plot self-mints its L4 ledger); beep-boop mints no ledger of its own and does not drain.
- [ ] `drain` (both `prd-covered` and `no-prd-nothing-to-plan`) → mint the L4 ledger (carrying `prd_creative_licence`) and fall through to the ordinary tidy→prep→build pipeline.
- [ ] `refuse` → mint nothing and surface the closed `reason` (one of no-target / self-directed / prd-ambiguous / prd-inadmissible / coverage-unmeasurable) for `/faff-wtf`.

### From HOW (the L4 guard invariant — load-bearing)
- [ ] The `faff run-start` call sits inside §0a's existing L4-lights-out guard; a test running the pipeline on an L3 ledger (`level` ≠ "L4") confirms §0a is skipped and `faff run-start` is never consulted, and the L3 run drains unchanged.
- [ ] The guard reads the run's lights-out level, not a flag/env: a grep of the §0a call-site shows no ad-hoc `--autonomous`/`--plan` flag read and no env sniff gating the call.

### From HOW (edge cases)
- [ ] `faff run-start` exit 2 (malformed `--signals`) is treated as `refuse` (fail-safe), minting nothing.
- [ ] A failed/malformed coverage read sets `coverage_measurable=false` → `refuse / coverage-unmeasurable`, never coerced to `drain`.
- [ ] An unresolvable `signals.outward` is passed `false` → `refuse / self-directed` (plan unreachable without a real outward signal from FAFF-521).

### From HOW (ordering)
- [ ] A `self-directed` target is refused before any PRD/admissibility branch (the outward floor precedes PRD checks — the predicate's ordering, exercised through the wiring).
- [ ] Build sequencing: FAFF-521 lands before/with this ticket (both populate `--self` via the repo-slug match).

**Integration smoke test:**
```
PROCEDURE smoke:
  1. Drive §0a under an L4 lights-out signal with: outward target, one admissible PRD, coverage.covered=false.
     Assert -> faff run-start returns plan/coverage-thin; /faff-plot --autonomous invoked (self-mints its ledger); beep-boop mints nothing; no drain.
  2. Flip coverage.covered=true. Assert -> drain/prd-covered; ordinary pipeline runs.
  3. Flip target inward (outward=false via repo-slug match). Assert -> refuse/self-directed BEFORE any PRD check; nothing minted; reason surfaced.
  4. Run the pipeline on an L3 ledger. Assert -> §0a skipped; faff run-start never consulted; run drains unchanged.
```

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" } ] }
```
