# FAFF-259 — DoD-gated project → Done: release the deferred transition on the release-gate predicate

> Spec: faffter-dark-nlspec · 2026-07-07 · autonomous · confidence: high. Full spec on Linear FAFF-259.

This spec addresses FAFF-259 ("Project state → Done auto-transition — at-release-gate half, split from FAFF-248"). Audience: the build agent implementing it and human reviewers checking the approach.

## 1. WHY — Problem and Principles

**Load-bearing model.** Since FAFF-248, `faff project-next` is the single pure predicate that decides container state-coherence transitions — and it already knows about this issue: a `--has-dod` project with all children done emits `noop` with reason `"all-children-done: defer to release gate (FAFF-259 / FAFF-245)"`. Every primitive the deferred transition needs has since shipped: the per-container PRDR record with its Definition of Done (FAFF-245, `faff prdr`), the coverage + `prd-satisfied` roll-up (FAFF-257, `faff prdr coverage`), and the trust-gated holdout-verdict bridge (FAFF-277, `faff holdout verdicts`). This issue closes the deferral with one new gate input on the predicate (`--dod-met`) plus the `/faff-tidy` sweep wiring that computes that input by composing those shipped primitives.

**Problem statement.** A project carrying a machine-readable DoD can currently never auto-transition to Done — the predicate defers unconditionally. So exactly the projects that took the trouble to declare a release gate accumulate as stale not-Done containers even once the gate is genuinely satisfied, while DoD-less projects flip cleanly. This change gates the DoD project's → Done on its release-gate predicate: held open while unmet or unverified, advanced when all children are done **and** the gate passes.

**Design principles:**

- **The gate tightens, never loosens.** The DoD's authority over FAFF-248's default is hold-open authority: all-children-done remains a necessary condition; the gate adds a further one. No input combination may produce a Done project with open children.
- **Unverified ⇒ held open.** A DoD with no trusted `met` verdict is not met (FAFF-257's conservative default). No verdicts available at all ⇒ the project stays open. Fail-safe in the same direction as every sibling gate.
- **Judgement upstream, application mechanical.** The deliverable-shippable judgement is discharged before this code runs — a human Accepted the PRDR (FAFF-255's gesture) and the code-blind evaluator produced the DoD verdict (FAFF-34/277). By the time the predicate says `advance`, the tracker write is bookkeeping.
- **Compose the shipped verdicts, never fork the rule.** Gate-satisfaction comes only from `faff prdr coverage`; DoD verdicts enter only through `faff holdout verdicts`' re-validation. No step re-reads raw holdout files or re-derives met-ness.

**Reference context:**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff/bin/faff` — `projectNext` (region:factory, ~lines 4711–4852) | Node | The predicate this extends (the `hasDod` defer-noop at ~4763) |
| `plugin/skills/faff-tidy/SKILL.md` — bucket 8 (State coherence) | Skill prose | The sweep that builds rollups, computes `--has-dod`, applies advances |
| `plugin/skills/faff/bin/faff` — `cmdPrdr` `coverage` (~11498) + `computePrdCoverageVerdict` | Node | The release-gate predicate producer (reused read-only, unchanged) |
| `plugin/skills/faff/bin/faff` — `computeHoldoutVerdictsMap` (~6473) | Node | The DoD-verdict trust bridge (reused read-only, unchanged) |
| `test/project-next.test.mjs` | node:test | CLI-seam tests to extend |
| `docs/guide/cli.md` — `project-next` and `prdr` rows | Doc | Must be updated in the same PR (the `prdr` row already names "the per-project release-gate Done transition" as a consumer) |

**Scope statement.** This is the DoD-gated half of the container-lifecycle pair: FAFF-248 owns children-derived state coherence; this issue owns only the release-gate override for projects that carry a DoD.

## 2. OUT OF SCOPE

- **Parent-issue → Done** — excluded by FAFF-248 (a parent often carries work beyond its children) and unchanged here. Extension point: the `kind === "issue"` branch of `projectNext`.
- **Done at gate-met with children still open** — rejected (see Rationale #2). Extension point: the `allDone` guard in `projectNext`.
- **PRD-level termination** — `faff run-done`'s `prd_satisfied` floor (FAFF-38) already consumes the same coverage block; untouched.
- **Producing DoD verdicts** — the evaluator lane (FAFF-34) and the beep-boop/L4 holdout phase own verdict production; untouched.
- **Authoring or admitting PRDRs** — tidy's `prdr-author` offer and FAFF-255 admission; untouched.
- **New persisted association state** — the issue/run→PRDR association stays orchestrator-lane, invocation-supplied data (FAFF-277's contract); this spec adds no association file or store.
- **Backward / corrective transitions** — the forward-only, monotonic, terminal-is-terminal floor is inherited unchanged.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Release gate | The per-project completion predicate: every live (non-superseded) PRDR under the project's container has a trusted `met` DoD verdict |
| DoD-met | The release gate evaluated satisfied, expressed to the predicate as `--dod-met` |
| Container slug | The PRDR `container` field; matched to a project by `adrSlug` normalisation on both sides (existing `prdr list --container` behaviour) |
| Held open | The `noop` a has-DoD project receives while its gate is unmet/unverified |

**Extended predicate input:**

```
RECORD ProjectNextInput:              # existing fields unchanged
  current: Category                   # planned | started | completed | cancelled
  kind: Kind                          # project | issue
  total, active, done: NonNegativeInt # child rollup; active + done <= total
  hasDod: Boolean                     # existing — project carries a release gate/DoD
  dodMet: Boolean                     # NEW — release gate evaluated satisfied
  CONSTRAINT dodMet ⇒ hasDod          # violating it is a malformed rollup (error, exit 2)
```

**CLI surface:** one new flag, `faff project-next … --has-dod --dod-met`. Output shape (`ContainerTransition {kind, current, desired, action, reason}`) is unchanged.

**Transition rules (complete, v1.1 — changes marked NEW):**

| Condition (kind = project, total > 0) | Result |
|---|---|
| current terminal (completed/cancelled) | noop — unchanged |
| all done ∧ no DoD | advance → completed — unchanged (FAFF-248) |
| all done ∧ has DoD ∧ dod-met | **NEW:** advance → completed, reason `"all children done and release gate passed (DoD-gated Done)"` |
| all done ∧ has DoD ∧ ¬dod-met | **NEW reason:** noop, `"all-children-done: release gate not passed — held open (DoD authoritative)"` (replaces the defer-to-FAFF-259 reason) |
| first child started (from planned) | advance → started — unchanged |
| dod-met without has-DoD | **NEW:** `{error}` → exit 2 |

**Design decisions** (rationale collected in section 6):

- **Chosen:** boolean `--dod-met` flag, not a tri-state gate token.
- **Chosen:** conjunction — Done requires all-children-done AND gate-met.
- **Chosen:** `--dod-met` without `--has-dod` is a malformed-rollup error.
- **Chosen:** the release-gate predicate is `faff prdr coverage --container <slug> --dod-verdicts <map>` with **no** `--prd-goals`; gate := `.satisfied`.
- **Chosen:** DoD verdicts are sourced only via `faff holdout verdicts --association` when the invoking context holds an association; otherwise the empty map (held open).
- **Chosen:** autonomous tidy applies the gated advance without prompting (initiation-locus argument, Rationale #6).
- **Assumes:** FAFF-245/248/257/277 primitives shipped and stable (validated — section 7).

## 4. HOW — Behavior

**Predicate change** — a surgical extension of `projectNext`; all other branches byte-identical:

```
PROCEDURE projectNext(current, kind, total, active, done, hasDod, dodMet):
  0. IF dodMet AND NOT hasDod:
       RETURN error "--dod-met requires --has-dod (a gate result for a gate-less project is a caller bug)"
  1..2. (validation, terminal guard, empty guard — unchanged)
  3. IF allDone:
     a. IF kind == project AND NOT hasDod: advance("completed", "all children done — state-coherence (no DoD)")   # unchanged
     b. IF kind == project AND hasDod AND dodMet:
          IF rank(completed) > rank(current): advance("completed", "all children done and release gate passed (DoD-gated Done)")
          ELSE noop("already completed")                                    # defensive, mirrors the no-DoD branch
     c. IF kind == project AND hasDod AND NOT dodMet:
          noop("all-children-done: release gate not passed — held open (DoD authoritative)")
     d. kind == issue: noop (out of scope — unchanged)
  4. (first-child-started — unchanged)
```

`cmdProjectNext` gains `dodMet: args.includes("--dod-met")`. The `--selftest` table gains the two new transition cases, the malformed dod-met-without-has-dod case, and iterates `dodMet ∈ {false, true}` in the monotonicity grid.

**Tidy sweep wiring** (bucket 8; prose change in `plugin/skills/faff-tidy/SKILL.md`). The gate is evaluated **lazily** — only for a project whose has-dod check is true AND whose rollup shows `done == total`; no per-project coverage calls otherwise:

```
PROCEDURE evaluate_release_gate(project):     # precondition: hasDod ∧ allDone
  1. verdicts := {}
     IF this invocation holds an issue/run→PRDR association (e.g. beep-boop's run-keyed
        {run-id: project-prdr-id}) AND .faff/holdout/ exists:
       verdicts := `faff holdout verdicts --association <assoc> --dir .faff/holdout`
       IF exit != 0: verdicts := {}                     # fail-safe, log the stderr summary
  2. coverage := `faff prdr coverage --container <project name> --dod-verdicts <verdicts JSON>`
       # NO --prd-goals: with an empty goal list, covered is trivially true, so
       # satisfied ⟺ completion.all_met — exactly "every live PRDR under this container is met"
     IF exit != 0 OR stdout not parseable: gate := not-passed; log loudly "coverage producer failed"; RETURN
  3. gate := (coverage.satisfied == true)
  4. Call project-next with --has-dod plus --dod-met iff gate.
  5. Log the gate line: {container, gate, coverage.reason}   # reason distinguishes unmet vs unverified
```

The sweep's existing steps (rollup build, category mapping, re-read-before-write, apply-on-advance, skip-on-error) are unchanged; the autonomous bullet's "a `--has-dod` project's Done is deferred (FAFF-259)" sentence is rewritten to the gated behaviour.

**Edge cases and error handling:**

- **Zero live PRDRs under the container** ⇒ the has-dod check is already false ⇒ this path never fires; the project is governed by FAFF-248's no-DoD rule (composition requirement from the ticket, preserved by construction).
- **`faff prdr coverage` non-zero exit / malformed output** → gate not-passed, held open, loud log. Never advance on a broken producer.
- **`faff holdout verdicts` exit 2** (bad association / unreadable dir) → empty verdict map → held open; the bridge's `skipped` stderr summary is logged.
- **Unmet vs unverified** → both hold open (identical action); coverage's `reason` string names which, and the sweep log carries it.
- **Terminal containers** → the predicate's terminal guard fires before any DoD logic; the sweep additionally never evaluates the gate for a completed/cancelled container (rollup step order).
- **Predicate `{error}`** → exit 2; the sweep skips the container and logs, per the existing bucket-8 rule.

**Failure modes:**

- **Interactive tidy never holds an association** → outside a run context, DoD projects are always held open. How you'd know: repeated sweep log lines `gate: not-passed … unverified`. What it means: by design — the leash. The human flips Done manually (manual changes are authoritative), or the run context (beep-boop's holdout step / L4, which already builds the run-keyed association) supplies verdicts. The log line must name it plainly so it is not misread as a defect.
- **Container-name drift** (project renamed after its PRDR was authored) → the slug no longer matches → has-dod silently false → the project would flip Done via the **no-DoD** rule despite carrying a live DoD. How you'd know: the new sweep log line listing live PRDRs whose container matched no active project. What it means: narrow — the observable log line ships here; automated reconciliation is future work (this hazard pre-exists in FAFF-248's has-dod detection; this spec makes it visible, not worse).

**Anti-pattern:** reading `.faff/holdout/*.json` directly in the sweep, or re-deriving met-ness from raw aggregates. Why: it forks the FAFF-277 trust gate — only `faff holdout verdicts` re-validates each file through `computeHoldoutVerdict`.

**Anti-pattern:** passing the PRD's goals to the per-container gate. Why: goals are PRD-scoped; injecting them lets an unrelated uncovered goal hold every project open (cross-container blast radius), and the per-project gate is defined purely over the container's own PRDRs.

## 5. Scenarios

```
Given a project with a live PRDR (has-dod), all children Done,
      and a trusted DoD-verdict map where every live container PRDR is "met"
When the tidy sweep evaluates the gate and calls
     faff project-next --has-dod --dod-met with the rollup
Then the predicate emits advance → completed with reason
     "all children done and release gate passed (DoD-gated Done)"
     and the sweep applies it forward-only via the tracker MCP
```

```
Given the same project but at least one live PRDR's verdict is absent or ≠ "met"
When the sweep evaluates the gate
Then coverage returns satisfied:false with a reason naming the PRDR,
     --dod-met is not passed, the predicate noops
     "all-children-done: release gate not passed — held open (DoD authoritative)",
     and no tracker write occurs
```

```
Given a project with no live PRDR under its container
When the sweep runs
Then no coverage call is made and behaviour is byte-identical to FAFF-248
     (children-done → Done coherence)
```

```
Given faff project-next invoked with --dod-met but without --has-dod
When it parses the rollup
Then it exits 2 with an error naming the --has-dod dependency
```

Assertions (non-functional):

- No input combination advances a project to `completed` while `done < total` — the gate never loosens FAFF-248's necessary condition.
- The monotonicity selftest grid passes with `dodMet ∈ {false, true}` added — no backward or equal-rank advance exists.
- The CLI change introduces no tracker/network call — `project-next` stays in the pure-predicate family.

## 6. Design Decision Rationale

1. **Gate input shape — boolean or tri-state?** A tri-state (`met|unmet|unverified`) would let the predicate emit finer reasons, but duplicates coverage's `reason` vocabulary into a second surface that can drift. **Chosen:** boolean `--dod-met` — the predicate needs only pass/hold; the caller logs coverage's reason string verbatim.
2. **Conjunction or disjunction with children-done?** The ticket's framing is hold-open authority ("may hold the project open *past* all-children-done", "criteria *beyond* child completion"). A disjunctive auto-Done at gate-met with open children would silently orphan those children inside a Done project and collide with FAFF-248's started-signal coherence; deciding their fate (re-home, cancel, keep) is a scope judgement for a human or the methodology lens, not state bookkeeping. **Chosen:** conjunction — all-children-done AND gate-met. Architecturally significant (a durable container-lifecycle floor: the DoD gate only ever tightens) — ADR candidate.
3. **`--dod-met` without `--has-dod`?** Ignoring it would mask a caller bug (a gate result computed for a gate-less project). **Chosen:** malformed-rollup error, exit 2 — fail-loud parity with the existing rollup validations.
4. **What is the release-gate predicate?** Re-implementing a per-project gate would fork FAFF-257. **Chosen:** `faff prdr coverage --container <slug> --dod-verdicts <map>` with no `--prd-goals`, gate := `.satisfied`. Verified against the shipped producer: with an empty goal list `covered` is trivially true, so `satisfied ⟺ completion.all_met` — precisely "every live PRDR under this container has a met DoD"; when false, `reason` names the unmet/unverified PRDRs.
5. **Where do DoD verdicts come from?** Tidy cannot invent the issue/run→PRDR association (orchestrator-lane data; the evaluator stays PRDR-blind), and persisting a new association store is new spoofable state. **Chosen:** verdicts flow only through `faff holdout verdicts --association` when the invoking context already holds an association (beep-boop's run-keyed map, L4); otherwise the empty map and the project is held open. At the time of writing no interactive association source exists — if one is ever added, it plugs into this same step.
6. **May autonomous tidy apply the DoD-gated Done?** The transition looks like a shippability judgement, but the judgement is discharged upstream: a human Accepted the PRDR (FAFF-255's gesture) and the code-blind evaluator produced the verdict (FAFF-34, bridged trust-gated by FAFF-277). What remains is a mechanical, forward-only, human-reversible tracker write — the same class as FAFF-248's coherence writes. **Chosen:** autonomous applies without prompting; interactive offers it like every other advance.

## 7. Open Questions and Assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**

- **Assumes:** `faff project-next` (FAFF-248), `faff prdr` including `coverage --container` (FAFF-245/257), and `faff holdout verdicts` (FAFF-277) exist as specified. Validation: `node plugin/skills/faff/bin/faff project-next --selftest` and `… prdr --selftest` pass on main (verified at spec time, 2026-07-07, along with a live `coverage --prd-goals '[]'` probe confirming the `satisfied ⟺ all_met` equality).
- **Assumes:** the sweep's has-dod detection (live PRDR under the container, FAFF-248 prose) is the sole DoD-presence signal — this spec adds no second one. Validation: read `plugin/skills/faff-tidy/SKILL.md` bucket 8, step 3.
- **Assumes:** `adrSlug` normalisation makes project-name → container matching tolerant of case/punctuation. Validation: `faff prdr list --container "<Project Name>" --live` returns records authored with the slugged form.

## 8. DONE — Definition of Done

### From WHY
- [ ] A has-dod project with all children done advances to Done exactly when its release gate is satisfied; unmet/unverified holds it open (observable via the two new reason strings).

### From WHAT (predicate + CLI)
- [ ] `projectNext` accepts `dodMet`; `cmdProjectNext` parses `--dod-met`.
- [ ] allDone ∧ hasDod ∧ dodMet ∧ project → `advance/completed`, reason `"all children done and release gate passed (DoD-gated Done)"`.
- [ ] allDone ∧ hasDod ∧ ¬dodMet → `noop`, reason `"all-children-done: release gate not passed — held open (DoD authoritative)"`.
- [ ] `--dod-met` without `--has-dod` → exit 2, error naming the dependency.
- [ ] All other branches byte-identical (no-DoD, parent-issue, terminal, forward-only, first-child-started).
- [ ] `--selftest` extended: both new transition cases, the malformed combination, and `dodMet ∈ {false,true}` in the monotonicity grid — passes.

### From HOW (sweep wiring)
- [ ] `plugin/skills/faff-tidy/SKILL.md` bucket 8 carries the lazy gate-evaluation step (has-dod ∧ all-done only), the bridge→coverage command sequence, the fail-safe rules for non-zero exits, the `--dod-met` pass rule, and the gate log line `{container, gate, reason}`.
- [ ] The autonomous bullet's "deferred (FAFF-259)" sentence is replaced with the gated behaviour.
- [ ] The sweep logs live PRDRs whose container matches no active project (name-drift observable).
- [ ] `computePrdCoverageVerdict`, `computeHoldoutVerdictsMap`, and all contract schemas are unchanged.

### From docs (same PR)
- [ ] `docs/guide/cli.md` `project-next` row updated (new flag, v1.1 transitions, no "defers" language).
- [ ] The `projectNext` region comment and the `faff --help` line updated to the built behaviour.
- [ ] `faff validate-adapters` passes on the edited SKILL.md.

### Tests
- [ ] `test/project-next.test.mjs`: gate-met advance, gate-unmet hold (exact reasons pinned), dod-met-without-has-dod exit 2, and no-DoD regression pins — all green under `node --test`.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. tmp repo; faff prdr new "Portal v1" --container portal --prd-goal g   # live PRDR 0001
  2. faff prdr coverage --container portal
       → satisfied:false (unverified — conservative default)
  3. faff project-next --current started --kind project --total 2 --active 0 --done 2 --has-dod
       → noop "held open"
  4. faff prdr coverage --container portal --dod-verdicts '{"0001":"met"}'
       → satisfied:true
  5. faff project-next … --has-dod --dod-met
       → advance/completed "release gate passed"
```

## Already shipped against this surface

- **FAFF-248** (Done, PR #188) — shipped `faff project-next` + the tidy bucket-8 sweep, with this issue's transition explicitly deferred (`noop "… defer to release gate (FAFF-259 / FAFF-245)"` in shipped code). Not superseding — the deferral is the premise.
- **FAFF-245** (Done, PR #183) — `faff prdr` record mechanic; provides the DoD carrier this gate reads.
- **FAFF-257** (Done, PR #197) — `faff prdr coverage` + `prd-satisfied` roll-up; provides the gate predicate this composes (`docs/guide/cli.md` already names "the per-project release-gate Done transition" as its consumer).
- **FAFF-277** (Done) — `faff holdout verdicts` trust bridge; provides the verdict map.

None delivers the gated Done itself; the premise holds and the spec proceeds unnarrowed.

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized? (principle 4)** Yes — one predicate input plus one prose wiring step, a single 1–3 day unit. The two halves always ship together (the flag without its caller is dead code; the caller without the flag can't act), so no split.
- **Workstream fit? (principles 1 + 5)** Fits the delegated-ends / container-lifecycle stream (FAFF-245/255/256/257 family) — outcome-named (projects that declare a done-bar get an honest Done) and cohesive with the shipped primitives it composes.
- **Deps surfaced? (principle 6)** The description's prose blocker (FAFF-245) is satisfied — verified Done live 2026-07-07; FAFF-257/277 also Done. No `blockedBy` edge was ever drawn and none is needed now (all upstream work is terminal).
- **Risk profile? (principle 7)** Low novelty — composes shipped, selftested primitives behind an existing extension point; no de-risking spike warranted. Residual risks are named in Failure modes (association absence by design; container-name drift made observable).

confidence: high
spec-review: approve

```faff-contract:spec-readiness
{ "confidence": "high",
  "decisions": [ { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "chosen" }, { "marker": "assumes" }, { "marker": "assumes" }, { "marker": "assumes" } ] }
```
