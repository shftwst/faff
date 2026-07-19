# Spec — FAFF-549: bare `/faff-plot` discovers a committed `docs/prd/*.md` before running intake

> Spec: faffter-dark-nlspec · 2026-07-19 · autonomous · confidence: high. Full spec on Linear FAFF-549.

*Revised 2026-07-19 (spec-review `revise`, both minor): added a born-verifiable scenario for the thin-PRD skip-intake path (QA), a doc-coupling pointer to beep-boop §0a's Active/Frozen filter, and surfaced the recommended `FAFF-549 blocks FAFF-547` dep edge (methodology).*

This spec is for the build agent editing **`faff-plot/SKILL.md`** and the human reviewer gating it. The deliverable is a **skill-prompt (Markdown prose) edit**, not application code — it adds a PRD-discovery step to the head of the plot §1 "Standalone" entry so bare `/faff-plot` treats a committed PRD as a first-class plan source before falling back to conversational intake. No `bin/` code changes; the CLI surfaces it reuses already exist and ship.

## 1. WHY — Problem and Principles

**The load-bearing model:** a committed `docs/prd/*.md` PRD is a *plan source plot can resolve mechanically* — the same `faff prd list` / `faff prd path` reads beep-boop already uses — not something a human has to re-narrate into plot. Today the two faff entry points that can start a roadmap disagree on this: `/faff-beep-boop` step 0a resolves the PRD by CLI, but bare `/faff-plot` has no such path and always drops into conversational `intake`. This edit closes that disagreement on the interactive side.

**Problem statement.** Standalone bare `/faff-plot` always invokes the `intake` skill to gather a discovery brief conversationally, with no path that scans `docs/prd/` for a committed PRD — so the SUT RUNBOOKs tell the operator to *paste* the PRD into plot, and the paste leaks test intent (FAFF-547). This change gives bare plot a PRD-discovery step at the head of its Standalone entry so that an unambiguous committed PRD is discovered and recursed from directly, and the operator pastes nothing.

**Design principles.**

**Additive, never a replacement.** The existing conversational `intake` entry stays exactly as-is and remains the fallback for the zero-PRD and ambiguous cases. A committed PRD that resolves cleanly *pre-empts* intake; everything else lands on today's behaviour byte-for-byte. An implementation that removes or reworks the intake fallback is wrong even if the PRD path works.

**Read-only mechanical resolution, no L4 semantics.** Plot reuses only the mechanical `faff prd list` / `faff prd path` *resolution* reads (beep-boop §0a steps 1–2). It must **not** import beep-boop's `faff run-start` refusal ladder (target / outward / admissibility / coverage) — that machinery is L4-lights-out-only and has no place in interactive plot. An implementation that calls `faff run-start`, or reproduces its refuse/plan/drain branching, has overreached.

**Shared prose has one home.** beep-boop §0a owns the full description of the resolution reads. Per this repo's `docs/skill-authoring.md` (no duplicated blocks), the plot edit *references* that surface by name for the mechanical reads — it does not paste a second copy of step 0a's ladder into `faff-plot/SKILL.md`.

**Reference context.**

| Surface | Kind | Relevance |
|---|---|---|
| `faff-plot/SKILL.md` §1 "Entry — get a discovery brief" | skill prose | The insertion site — the "Standalone" bullet gains a PRD-discovery step ahead of the intake call |
| `faff-beep-boop/SKILL.md` §0a steps 1–2 | skill prose | Owns the mechanical `faff prd list` / `faff prd path` resolution + disambiguation; plot references it |
| `faff-plot/SKILL.md` Ignition (`--autonomous`, FAFF-521) | skill prose | Autonomous L4 counterpart that resolves a PRD *and* calls `faff run-start`; NOT this ticket |
| `bin/lib/prd.js` | Node CLI | Implements `faff prd list --json` and `faff prd path <container>`; already shipped, unchanged |
| `faff/SKILL.md` → "Resolving the `faff` executable" | gateway rule | How plot resolves the `faff` binary for these reads |
| `docs/skill-authoring.md` (lints via `faff validate-adapters`) | authoring standard | Governs the edited prose (line caps, paragraph length, no duplicated blocks) |

**Scope.** This sits at the very front of bare `/faff-plot`'s standalone discovery entry — the gate between "invoked with no chained brief" and "run intake". It changes nothing about the chained-from-jot path, the recursion, the stop rule, the gating, or the writes.

## 2. OUT OF SCOPE

- **The `faff run-start` refusal ladder / L4 run semantics** — excluded: interactive plot is L3 and human-gated; the ladder is L4-lights-out-only.
- **Changes to `faff prd list` / `faff prd path` / `bin/lib/prd.js`** — excluded: the CLI surface is sufficient as shipped.
- **The RUNBOOK paste-leak wording (FAFF-547)** — excluded: this ticket is the upstream fix.
- **`/faff-plot --autonomous` ignition** — excluded: that entry already resolves a PRD via the run-start harness.
- **`/faff-plot rehome`** — excluded: a distinct mode with no discovery brief.
- **Non-interactive re-interrogation / a new intake variant that fills PRD gaps** — excluded.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Committed PRD | A `docs/prd/*.md` file the tracker knows about, enumerable via `faff prd list --json` |
| Setpoint (PRD) | A PRD is a stop-conditions/DoD/goals document — it states *where the work must land*, not the full decomposition inputs a discovery brief carries |
| Unambiguous PRD | Exactly one PRD after the step-0a filter |
| Discovery brief | The structured input plot recurses from; today produced by `intake`, now optionally *supplied directly by the committed PRD* |

**The CLI surface reused (verified against `bin/lib/prd.js`).**

```
faff prd list --json
  → prints JSON array; each element:
    { slug, container, status, date, mode, url, file }
    status ∈ { Draft | Active | Frozen | Stale }

faff prd path <container>
  → prints "<prd-docs-dir>/<slug>.md" (the resolved PRD file path)
  → missing <container> arg → exit 2
```

Resolve the `faff` executable per gateway → **Resolving the `faff` executable** (bare `faff` on PATH, else the bundled binary — never hardcode `~/.claude/skills/faff/bin/faff`).

**Design decision — direct ingest vs a light intake pass over the PRD (the central call).** **Chosen: ingest the committed PRD directly as the discovery brief and skip the interactive `intake` invocation — then let plot's existing recursion surface any genuinely underivable decomposition as a stop-rule branch, non-interactively, rather than re-interrogating the human up front.** Rationale: this keeps the "operator pastes nothing" win whole; it does not silently pretend the PRD is a complete brief; and appetite is high, so a decisive additive path beats a hedged interactive one.

**Design decision — what "exactly one unambiguous PRD" means (mirror step 0a).** **Chosen:** apply beep-boop §0a step 1's filter exactly — start from the `faff prd list --json` array; if more than one element, keep only those whose `status` is `Active` or `Frozen`; the PRD is *unambiguous* iff exactly one survives that filter. Zero elements, or `Draft`/`Stale`-only, or two-plus survivors ⇒ not unambiguous.

**Design decision — interactive disambiguation on multiple PRDs.** **Chosen:** on ambiguity, plot *asks the human which PRD to recurse from* (listing the surviving candidates by slug/status), and on a clean pick recurses from that PRD; if the human declines to pick, fall back to conversational `intake` exactly as today.

**Design decision — referencing the shared resolution prose without duplicating it.** **Chosen:** the plot §1 edit names the reads as "the mechanical PRD resolution `/faff-beep-boop` §0a uses (`faff prd list --json` → `faff prd path <container>`, steps 1–2 only — not its L4 `run-start` ladder)" and links/points to that section, rather than pasting step 0a's full prose.

## 4. HOW — Behavior

**Architecture.** The edit inserts a PRD-discovery step at the **head of the Standalone bullet** in `faff-plot/SKILL.md` §1, ahead of the existing `intake` invocation. The chained-from-jot bullet is untouched. The new step runs the mechanical resolution, branches on the result, and either supplies the resolved PRD as the discovery brief (skipping intake) or falls through to the unchanged intake call.

**Behaviour summary.** Bare `/faff-plot` invoked with no chained brief now first asks "is there exactly one committed PRD I can plan from?" — if yes, it plans from the PRD file with no conversational discovery; if no, it behaves exactly as it does today.

```
PROCEDURE plot_standalone_entry():   # runs only on the Standalone path; chained-from-jot unchanged
  1. Resolve the faff executable per gateway → "Resolving the faff executable".
  2. prds := parse( `faff prd list --json` )                      # [] on the faff repo itself → step 4
  3. candidates := prds
     IF length(candidates) > 1:
        candidates := [ p in candidates WHERE p.status ∈ {Active, Frozen} ]
  4. BRANCH on length(candidates):
     a. == 1  (unambiguous):
          file := `faff prd path <candidates[0].container>`
          IF file resolves AND the file exists:
             → recurse the roadmap from the PRD file as the discovery brief; SKIP intake.   # happy path
          ELSE (path exit 2 / file missing):
             → treat as the zero/fallback case → go to (c)
     b. > 1   (ambiguous):
          ask the human which surviving PRD to plan from (list slug + status)
          IF human picks one → resolve its path as in (a) and recurse; SKIP intake
          ELSE (declines) → go to (c)
     c. == 0  (no committed PRD, or fell through from a/b):
          → run conversational intake exactly as today (invoke the configured `intake` skill;
            missing slot → run the default inline). UNCHANGED.
```

**Edge cases and fallback precedence.**

- **`faff prd list --json` returns `[]`** (the faff repo itself has no `docs/prd/`): zero-PRD branch → today's intake behaviour, byte-identical.
- **`faff prd path <container>` fails** (exit 2 / file missing): treat as the no-PRD case and fall to intake — never abort the entry.
- **Only `Draft` / `Stale` PRDs exist:** the filter only runs when length > 1; a lone `Draft` PRD with no siblings is length-1 pre-filter and *is* recursed from — matching step 0a.
- **Human declines the disambiguation pick:** fall to intake — a decline is never a hard stop.
- **Fallback precedence (highest first):** resolved unambiguous PRD → recurse from it; human-picked PRD on ambiguity → recurse from it; everything else → conversational intake.

**Anti-pattern:** calling `faff run-start`, or reproducing its refuse/plan/drain ladder, in interactive plot.

**Anti-pattern:** pasting beep-boop §0a's resolution prose into `faff-plot/SKILL.md`.

**Anti-pattern:** running an interactive `intake` pass *over* the discovered PRD to fill gaps.

## 5. SCENARIOS — born-verifiable main objectives

> 3 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a repo whose `faff prd list --json` returns exactly one Active/Frozen PRD
When bare `/faff-plot` is invoked standalone (no chained brief)
Then plot resolves that PRD's file via `faff prd path <container>` and recurses the roadmap from it
  And plot does NOT invoke the `intake` skill
```

```
Given the faff repo itself (no `docs/prd/`, so `faff prd list --json` returns `[]`)
When bare `/faff-plot` is invoked standalone
Then plot runs conversational `intake` exactly as it does today, with no new prompt or read-driven abort
```

- The edited §1 "Standalone" prose performs the `faff prd list --json` read *before* the `intake` invocation (ordering is observable in the prose).
- The edited §1 references beep-boop §0a for the resolution surface rather than pasting a second copy of its ladder.
- The edited `faff-plot/SKILL.md` passes `faff validate-adapters` (line caps, paragraph length, stray markers, no duplicated blocks).

## 6. DESIGN DECISION RATIONALE

**Direct PRD ingest vs a light intake pass over the PRD (central).** **Chosen: (c), i.e. (a) plus reliance on plot's existing Step 3 stop rule** — it keeps the operator-pastes-nothing win, adds no new machinery, and does not pretend the PRD is a complete brief.

**"Exactly one unambiguous PRD" definition.** **Chosen: step-0a's filter** — identical reading to beep-boop so the two entry points never disagree.

**Ambiguity handling — silent fallback vs interactive ask.** **Chosen: ask the human which PRD** (decline ⇒ intake fallback).

**Dedup strategy.** **Chosen: reference beep-boop §0a steps 1–2 by name** — satisfies "shared prose has one home" and the no-duplicated-blocks lint.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None — every decision above is closed with a `**Chosen:**` marker.

**Assumptions.**

- **Assumes:** the `faff prd list --json` / `faff prd path <container>` CLI surface exists and emits the shape in §3. *Validation:* verified against `bin/lib/prd.js`.
- **Assumes:** `faff validate-adapters` is the CI lint gate for `SKILL.md` prose. *Validation:* run `faff validate-adapters` locally against the edited file before opening the PR.

## 8. DONE — Definition of Done

### From WHY
- [ ] Bare standalone `/faff-plot` discovers a committed unambiguous `docs/prd/*.md` and recurses from it without the operator pasting or narrating the PRD.

### From WHAT (surface + decisions)
- [ ] The edited §1 "Standalone" bullet uses `faff prd list --json` then `faff prd path <container>`, with the `faff` binary resolved per the gateway rule (not hardcoded).
- [ ] "Unambiguous" is defined as step-0a's filter: >1 ⇒ keep `Active`/`Frozen`; exactly one survivor ⇒ recurse from it.
- [ ] The prose closes the central ingest-vs-intake decision as direct PRD ingest (skip intake), with no new interactive gap-filling pass.

### From HOW (behaviour)
- [ ] Exactly-one-PRD path: plot resolves the PRD file and recurses from it, and does NOT invoke `intake`.
- [ ] Zero-PRD path (incl. `faff prd list --json` == `[]`): plot runs conversational `intake` unchanged.
- [ ] Multiple-PRD path: plot asks the human which surviving PRD to plan from; clean pick ⇒ recurse from it; decline ⇒ intake fallback.
- [ ] `faff prd path` failure / missing file ⇒ treated as the no-PRD case (fall to intake), never an abort.
- [ ] Skip-intake on a content-thin (but state-unambiguous) PRD: plot's existing Step-3 stop rule surfaces the underivable branches as "needs more discovery" rather than inventing children.

### From HOW (constraints / edge cases)
- [ ] The edited §1 imports no `faff run-start` call and no refuse/plan/drain/coverage ladder prose.
- [ ] The edited §1 references beep-boop §0a for the resolution surface — no pasted duplicate of its ladder.
- [ ] `faff validate-adapters` passes on the edited `faff-plot/SKILL.md`.
- [ ] The edit carries a one-line pointer noting the "unambiguous" definition mirrors beep-boop §0a's Active/Frozen filter.
- [ ] The chained-from-jot bullet and the rest of §1 (recursion, stop rule, gating, writes) are unchanged.

### Recommended tracker follow-up (non-blocking, not part of the build)
- Replace FAFF-549's informal "Related to FAFF-547" link with an explicit `FAFF-549 blocks FAFF-547` dependency edge.

confidence: high
