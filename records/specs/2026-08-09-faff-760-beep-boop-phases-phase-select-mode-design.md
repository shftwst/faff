# Spec: FAFF-760 — beep-boop `--phases build|prep|all` phase-select mode

> Spec: faffter-dark-nlspec · 2026-08-09 · interactive · confidence: high. Full spec on Linear FAFF-760.

> Revised 2026-08-09 — spec-review (architectural lens, `revise`) surfaced that tidy's disposition under `--phases build` was under-specified. Strengthened the section-3 tidy note and decision 5 to state that tidy is skipped and its one build-phase consumer (the step-4 `automation-verdicts.md` verdict cache) degrades gracefully via step 4's inline-recompute fallback (`SKILL.md:189`); added a matching DONE item. No design decision changed.

This is the build spec for FAFF-760. It adds a phase selector to `/faff-beep-boop` so a single tracker+repo can be drained by several beep-boop runs at once: one primary running the full pipeline, plus N build-only workers. The audience is the build agent implementing the change (the edit is almost entirely SKILL.md prose in `plugin/skills/faff-beep-boop/SKILL.md`), plus the human reviewers who gate the spec.

## 1. WHY: problem and principles

**The load-bearing model: throughput scales by adding build-only workers, and it stays coordination-free because exactly one run ever preps.** N build workers each drain the *same* shared build queue (Todo issues that already have a spec); the primary run is the only one that refills that queue by prepping. Builds across all runs are already deduplicated by the tracker `In Progress` claim (FAFF-82, the prose-enforced claim-before-admit at `SKILL.md:191`), and that claim lives on the tracker, so it already works across machines today. Because only one run preps, the duplicate-prep race that FAFF-759 addresses cannot occur here: contention is removed by operator decision, not coordinated by a new protocol. No new shared state, no prep-claim, no cross-host claim-liveness is needed for the mode to function.

**Problem statement.** `/faff-beep-boop` always runs the full pipeline (tidy, then the prep-queue drain, then the build-queue drain), and the prep queue "always runs to completion regardless" (`SKILL.md:120`). There is a de-facto specs-only idiom (`--max 0` caps build attempts at zero while prep still drains, since `--max` counts build attempts, "not prep dispatches", `SKILL.md:56`) but no inverse: no way to run builds without also prepping. That means you cannot safely point two runs at one tracker without both trying to prep the same Backlog items.

**Design principles.**

**Cut at the `faff-prep` dispatch seam, not at the convergence loop.** The whole mode reduces to one rule: a `--phases build` run performs *zero* `faff-prep` dispatches. Every code path that would invoke the `faff-prep` skill (the step-3 prep-queue drain, the step-8.3 narrow prep on newly-unblocked items, and the step-4/8.4 live-thread reconciliation refresh) is routed to surface-only. This must be expressed as *routing the prep tributary to surface-only*, never as disabling convergence, precisely because at L4 convergence is forced on and cannot be disabled (`resolveConvergence`, `config.js:407`; `SKILL.md:230`). Suppressing prep by disabling convergence would be inert at L4; routing the prep dispatch to surface-only composes with L4's forced convergence.

**`--phases all` and flag-absent are byte-for-byte today's pipeline.** The selector adds branches guarded by a non-default value. When the flag is absent or `all`, no branch is taken and the run is identical to today, including the run-ledger, the `runcheck` invariant, and every report bucket. This is a hard invariant, not an aspiration.

**Single-prepper is the correctness precondition, so a build worker never preps even to unblock itself.** A build worker that hit a stale-spec candidate must surface it, never re-prep it, because a second prepper reopens the FAFF-759 race the mode exists to design out. Building on a stale spec is also wrong, so such a candidate is surfaced and routed out, not built.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-beep-boop/SKILL.md` | Skill prose | The full pipeline, phases, waves, budget, claim-before-admit. Where `--phases` is recognised and enforced (v1 is prose-only). |
| `plugin/skills/faff/bin/lib/next.js:32-50` | JS (pure) | The legal-next-step transition function. `spec === "none"` returns `prep`; a Todo+high-spec+eligible+unblocked item returns `graft`. This is the seam `--phases` routes on: the transition is unchanged, only what the orchestrator does with a `prep` verdict changes. |
| `plugin/skills/faff/bin/lib/argv.js:73` | JS (pure) | `parseArgs(argv, spec)`, the fail-closed flag/enum parser. Precedent for a closed-enum flag; only relevant if the extension-point CLI resolver is ever built. |
| `plugin/skills/faff/bin/lib/next.js:10-21` | JS (pure) | `NEXT_SPEC` closed-enum flag declaration, the parse precedent cited by the operator. |
| `plugin/skills/faff/bin/lib/lights-out.js:369-370`, `:564-568` | JS (pure) | L4 preflight refuses a `max_attempts`-only envelope; `spendTimeCeilingSet` deliberately excludes `max_attempts`. Governs the build-worker ceiling story. |
| `plugin/skills/faff/bin/lib/config.js:401-413` | JS (pure) | `resolveConvergence`: at a live L4 ledger returns `"true"` regardless of config, otherwise reads `convergence.enabled`. The shape of the out-of-scope machine-designation dial, and the reason "suppress prep" must not be "disable convergence". |
| `plugin/skills/faff/bin/lib/run-start.js` | JS (pure) | Precedent shape for a small pure decision resolver, named only as an extension point if prose validation proves error-prone. |

**Scope statement.** This changes only how `/faff-beep-boop` selects which of its two existing phases run and whether its existing prep dispatches fire; it introduces no new queue, no new tracker state, and no new CLI subcommand.

## 2. OUT OF SCOPE

- **A `.faffrc` machine-designation knob** (a config way to permanently mark a host as a build worker). Why excluded: v1 is a per-invocation operator decision, and a persistent designation invites a two-machine both-configured-as-primary or both-as-worker misconfiguration with no live check. Extension point: a `resolveConvergence`-shaped dial in `config.js` (the `convergence.enabled` pattern at `config.js:401-413`), read with flag-over-config precedence.
- **Idle-poll / long-lived worker scheduling.** Why excluded: a worker that finds an empty build queue exits clean (see decision 4); keeping it alive to poll is scheduling, which already has a home. Extension point: relaunch under the `/loop` skill or a shell loop; a native idle-poll would live in this SKILL's wave loop.
- **Cross-host stale-claim recovery / claim TTL (FAFF-758).** Why excluded: a crashed worker leaves its issue `In Progress` (a stale claim) and no peer reclaims it until a TTL-based recovery exists; that recovery is FAFF-758, not built here. This mode does not create the gap, but running N workers makes a crash (and therefore a stale claim) more likely. Extension point: FAFF-758's claim-liveness / TTL layer over the FAFF-82 claim at `SKILL.md:191`. See the named known-limitation in section 4.8.
- **A prep-claim protocol (FAFF-759).** Why excluded: designed out for the single-prepper case (only one run preps, so there is no prep contention to coordinate). It becomes belt-and-braces only if an operator cannot guarantee exactly one prepper. Extension point: FAFF-759's prep-claim, layered on the same claim-before-admit machinery.
- **A `beep-boop` CLI subcommand or a `faff phases` resolver.** Why excluded: beep-boop's own flags (`--converge`/`--no-converge`, `--max`, `--until`) are prose-parsed in SKILL.md today; `--phases` follows that precedent for v1. Extension point: a pure `run-start.js`-shaped resolver plus a `parseArgs` closed-enum (`argv.js:73`, `next.js:10-21`) if prose validation proves error-prone.

## 3. WHAT: vocabulary, flag, and phase mapping

**Vocabulary.**

| Term | Definition |
|---|---|
| Primary run | The full-pipeline run (`--phases all`, the default). The only run that preps. Refills the shared build queue. |
| Build worker | A `--phases build` run. Drains the shared build queue in waves; performs no `faff-prep` dispatch. |
| Prep runner | A `--phases prep` run. Drains the prep queue and stops before the build phase. Retires the `--max 0` specs-only idiom. |
| Prep tributary | The set of orchestrator actions that invoke the `faff-prep` skill: the step-3 drain, step-8.3 narrow prep, and the step-4/8.4 live-thread refresh. A build worker routes all of it to surface-only. |
| Build-chaining tributary | Convergence refilling the queue from work newly unblocked by shipped builds (step-8.4 re-assembly of `next: graft` items). A build worker keeps this. |

**The flag.**

```
ENUM PhaseSelect: build | prep | all      # closed enum; default `all`
  build : build-only worker. Skip prep (and tidy). Drain the build queue in waves.
  prep  : prep-only. Drain the prep queue, then stop before the build phase.
  all   : today's full pipeline, byte-for-byte. The default and the flag-absent behaviour.

CONSTRAINT unknown value  -> fail-closed usage error (see HOW: usage validation)
CONSTRAINT flag absent    == `all`
```

`--phases` is added to the `## Invocation` / `## Budget flags` prose alongside `--converge`/`--no-converge`. It is recognised and its enum is validated in SKILL.md prose (v1 is prose-only; there is no `beep-boop` CLI subcommand to parse it). It combines with the two existing invocation forms (`/faff-beep-boop` and the explicit-list form) and with the budget flags.

**Phase-to-step routing.** The pipeline steps are the existing ones in `## Full pipeline`. The selector decides which run and how the prep tributary is routed:

| Step (SKILL.md) | `all` | `build` | `prep` |
|---|---|---|---|
| 1. Tidy | run | skip | run |
| 2. Prep queue build | run | skip | run |
| 3. Prep queue drain (dispatches `faff-prep`) | run | skip | run |
| 4. Build queue assembly | run | run (entry point) | skip; stop, go to reporting |
| 4. Live-thread reconciliation refresh (dispatches `faff-prep`) | run | surface-only (route out, do not build) | not reached |
| 5. Conflict analysis | run | run | skip |
| 6. Build pass | run | run | skip |
| 7. Wave drain | run | run | skip |
| 8. Wave re-entry (convergence loop) | run | run | not reached |
| 8.3. Narrow prep on newly-unblocked `next: prep` (dispatches `faff-prep`) | dispatch | surface-only (log + report) | not reached |
| 8.4. Re-assembly of `next: graft` (build chaining) | run | run | not reached |
| 9. Wave-1 empty short-circuit | as today | as today (exit clean) | not reached (prep already done, report) |
| 10. File discovered-scope tickets | as today | file to Backlog; prep-of-filed deferred to primary | not reached (no builds ran) |
| 11. runcheck + 11.5 reconcile | run | run | run (admitted empty, trivially clean) |

**Note on tidy under `--phases build`.** Tidy's step-1 output feeds the prep queue (it tags stale-spec / superseded-spec issues as prep candidates and applies grooming auto-actions). Since a build worker runs no prep queue, that output has no prep consumer in this run, and the primary owns tidy. So `--phases build` enters at step 4 and skips steps 1 through 3 entirely. See decision 5.

Tidy also has **one build-phase consumer**, and it degrades gracefully when tidy is skipped: step 4's routing-verdict computation normally reads a per-candidate cache tidy wrote to `.faff/runs/<run-id>/automation-verdicts.md`, "to avoid recomputation" (`SKILL.md:189`). With tidy skipped under `--phases build`, that cache is simply **absent** — and step 4 already handles absence: a candidate "not in that cache ... is computed **inline** at assembly and written back" (`SKILL.md:189`). So a build worker computes every candidate's routing verdict inline at assembly; nothing is silently missing, and no verdict is skipped for want of the cache. This is why skipping tidy is safe rather than merely convenient: the sole cross-phase artifact tidy produces has a documented inline fallback. (This is also why skipping tidy is *preferable* to running it: N workers running the tracker-mutating grooming pass concurrently against one shared tracker is overlapping mutation for zero build-queue benefit — the whole point is coordination-free throughput.)

## 4. HOW: behaviour

### 4.1 The seam: what the orchestrator does with a `next: prep` verdict

The transition function `nextStep` (`next.js:32-50`) is unchanged. It still returns `prep` for an unspecced item and `graft` for a Todo+high-spec+eligible+unblocked item. What `--phases build` changes is the orchestrator's *action* on a `prep` verdict.

```
PROCEDURE route_prep_candidate(issue, verdict, phase):
  # verdict is the `next` field from `faff next` (next.js), OR the live-thread
  # reconciliation determination that an admitted candidate's spec is stale.
  1. IF phase != "build":
     a. dispatch the faff-prep skill as today (step 3 / 8.3 / live-thread refresh)
     b. RETURN
  2. # phase == "build": the prep tributary is surface-only.
     a. DO NOT dispatch faff-prep for this issue (single-prepper invariant)
     b. record it under the run summary's "Surfaced (prep deferred to primary)" section
        and to the wave log
     c. IF the issue was an admitted build candidate whose spec went stale
        (live-thread Resolution/Challenge): route it OUT of the build queue
        (do not build on a stale spec); it is NOT appended to `admitted`
     d. RETURN
```

Anti-pattern: implementing "suppress prep" as `--no-converge` or `convergence.enabled: false`. Why: at L4 both the flag and the knob are inert (`resolveConvergence` returns `"true"` for a live L4 ledger, `config.js:407`; `SKILL.md:230`), so prep would not be suppressed at L4. Route the prep *dispatch* to surface-only instead; leave the convergence loop running.

### 4.2 `--phases build`: build waves with the prep tributary off

Behaviour summary: a build worker drains the shared build queue exactly as the full pipeline's build phase does, keeps chaining on work unlocked by shipped builds, and surfaces (never preps) anything that would need prep.

```
PROCEDURE phases_build(run):
  1. Enter at step 4 (build queue assembly). Steps 1-3 (tidy, prep queue) do not run.
  2. Assembly, conflict analysis, build pass, wave drain (steps 4-7): unchanged,
     including claim-before-admit (SKILL.md:191) which dedupes against peer workers.
  3. Live-thread reconciliation (step 4): a candidate whose spec went stale via a
     human Resolution/Challenge is routed out via route_prep_candidate (surface, not
     build) instead of narrow-prepped.
  4. Wave re-entry (step 8): the convergence loop runs (the run-done consult and the
     step-8.0 discovered-scope fold are unchanged). For each newly-unblocked item,
     consult `faff next`:
       - returns `graft`  -> rejoin build-queue assembly (build-chaining tributary: KEEP)
       - returns `prep`   -> route_prep_candidate (surface-only; prep tributary: OFF)
       - returns skip-ineligible / needs-human -> route out as today
  5. Discovered-scope filing (step 8.0 / step 10): filing new Backlog tickets is not a
     prep dispatch, so it proceeds; but those tickets are never prepped by this worker
     (step-8.3 prep is surface-only), so they defer to the primary. With prep suppressed
     this worker discovers no prep-originated scope of its own anyway.
  6. Empty build queue after step-4 assembly: exit clean via the wave-1 short-circuit
     (see 4.4).
```

This composes with L4 forced convergence: the loop still runs, only the prep tributary within it is routed to surface-only.

### 4.3 `--phases prep`: prep queue only

Behaviour summary: drains the prep queue exactly as the full pipeline does, then stops before the build phase.

```
PROCEDURE phases_prep(run):
  1. Run steps 1-3 (tidy, prep queue build, prep queue drain) unchanged.
  2. After step 3 drains, DO NOT enter step 4 (build queue assembly). Skip steps 4-10.
  3. Proceed to reporting. Prep output counts as a successful run (SKILL.md:243 already
     establishes prep-only output as a successful run).
  4. runcheck (step 11) runs and is trivially clean: prep never writes `admitted`
     (SKILL.md:162), so `admitted` is empty and `admitted - outcomes == {}` holds.
```

This retires the accidental `--max 0` specs-only idiom (`--max` counts build attempts, so `--max 0` reached zero-build via the build phase; `--phases prep` says it directly).

### 4.4 Empty build queue: exit clean via the existing short-circuit

A `--phases build` worker that finds an empty build queue after step-4 assembly exits via the existing wave-1 empty short-circuit (`SKILL.md:241-243`: skip steps 5-8, proceed to reporting; "Prep output still counts as a successful run"). There is no idle-poll loop in v1; a long-lived worker is achieved by relaunching under `/loop` or a shell loop (out of scope).

The short-circuit is load-bearing for step-10 discovered-scope filing, which runs "only when builds ran" (`SKILL.md:246-247`). A `--phases build` run that skips prep and then empties the build queue takes the short-circuit and correctly skips step 10; with prep suppressed there is no prep-discovered scope from this run to file anyway.

### 4.5 The L4 ceiling story for a build worker

A `--phases build` run under L4 (a `faff lights-out`-minted ledger) is naturally governed by `--max` (build attempts), but L4 preflight refuses a `max_attempts`-only envelope: `spendTimeCeilingSet` (`lights-out.js:564-568`) deliberately excludes `max_attempts`, and the budget-ceiling refusal fires without a spend/time ceiling (`lights-out.js:369-370`; the prose is `SKILL.md:71`). `--phases build` does not change this precondition: the operator must still set `budget.cost`, `budget.tokens`, or `budget.until`; `--max` may ride along only as an extra backstop. The phase selector and the budget envelope are independent axes, so this composes without new logic.

Budget-phase scope (`SKILL.md:89`): `until` gates both phases, while `max_attempts` / `tokens` / `cost` gate the build phase only. Consequences:
- `--phases build`: all four dimensions are effective (the build phase runs).
- `--phases prep`: only `until` actually bounds the dispatch loop (the build-only dimensions gate a phase that never runs). Under L4, config still satisfies the spend-ceiling precondition, but `until` is the sole effective governor of a prep-only run. State this in the report so it is not surprising.

### 4.6 Usage validation

Prose-enforced, mirroring the `--converge`/`--no-converge` conflict handling (`SKILL.md:116`, `:229`):
- An invalid `--phases` value (anything other than `build`, `prep`, `all`) is a fail-closed usage error announced at run start; the run does not proceed. This is the closed-enum discipline `parseArgs` would give (`argv.js:73`, `bad-enum`), applied in prose for v1.
- A build-gating budget flag under `--phases prep` (for example `--phases prep --max 5`) is not a contradiction, only an inert flag (`--max` gates the build phase, which a prep run never enters). It is accepted with a surfaced warning that the flag is inert for a prep-only run, not refused. This differs from the `--converge`/`--no-converge` case, which is a true contradiction and a hard refuse. See decision 6.

### 4.7 Failure modes

- **The failure:** two runs are both started as primary (both `--phases all` or both flag-absent), so both prep. How you'd know: the FAFF-759 duplicate-prep symptom returns (two specs attached to one Backlog item, or racing prep comments). What it means: operator error, not a defect of this mode; the mode's guarantee holds only when exactly one run preps. Documented as an operator precondition, and the reason FAFF-759's prep-claim is the belt-and-braces extension point.
- **The failure:** a build worker crashes mid-build, leaving its issue `In Progress` (a stale claim), and no peer reclaims it. How you'd know: an issue sits `In Progress` with no live owner and never reaches a terminal outcome across subsequent runs. What it means: the known FAFF-758 gap; this mode makes it more likely (more workers, more crash surface) but does not create it. Out of scope here; depends on FAFF-758. See the named known-limitation in section 4.8.
- **The failure:** "suppress prep" is implemented as disabling convergence, so at L4 prep is not actually suppressed. How you'd know: a `--phases build` L4 run dispatches `faff-prep` on a newly-unblocked item (a prep comment appears from the worker's run). What it means: the implementation cut at the wrong seam; it must route the prep dispatch to surface-only (4.1), not toggle convergence.

### 4.8 Known limitation: stale claims until FAFF-758 ships

This is the operator-visible boundary of the multi-machine promise, surfaced here rather than left implicit in the failure-mode list. The mode functions and ships value without FAFF-758 (single-machine, and the multi-machine happy path), so this is a documented limitation, not a blocker edge on the ticket.

- **The limitation:** until FAFF-758's stale-claim recovery ships, a build worker that dies mid-build leaves its issue `In Progress` with no live owner, and no peer run reclaims it. It must be cleared by hand (move the issue back to Todo).
- **It grows with worker count:** N workers is N times the crash surface, so the more workers an operator runs, the more likely a stale claim accumulates during an unattended window.
- **What an operator does today:** run a modest worker count for unattended windows, and sweep for issues stuck `In Progress` with no active run before relaunching. FAFF-758 removes the manual sweep; this ticket depends on it for *robust* large-fleet unattended operation, and keeps the tracker edge `relatedTo` (not `blockedBy`) because the mode is useful without it.

## 5. Scenarios

> 2 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a tracker with a Todo issue carrying a high-confidence spec and a Backlog issue with no spec
When /faff-beep-boop --phases build runs
Then the Todo issue is built (a build attempt is launched)
And the Backlog issue is never passed to the faff-prep skill (no prep dispatch, no spec attached by this run)
And the Backlog issue appears under the run summary's surfaced/prep-deferred section
```

```
Given a Backlog issue with no spec and a Todo issue with a high-confidence spec
When /faff-beep-boop --phases prep runs
Then the Backlog issue is prepped (faff-prep dispatched)
And the build phase never runs (no build attempt is launched for the Todo issue)
And runcheck exits 0 with an empty `admitted` array
```

```
Given no flag is passed (or --phases all)
When /faff-beep-boop runs
Then the pipeline is identical to today's full pipeline: tidy, prep-queue drain, build-queue drain, same run-ledger and report buckets
```

```
Given an L4 lights-out run invoked with --phases build and only --max 8 set (no tokens/until/cost)
When the run reaches lights-out preflight
Then the run is refused with the budget-ceiling refusal (a count is not an L4 governor)
```

- The invalid-value assertion: an unknown `--phases` value MUST fail closed at run start and MUST NOT start the pipeline.

## 6. Design decision rationale

**How is the phase surface shaped, and where is it parsed?**
Options: (a) a closed enum `--phases build|prep|all`; (b) two boolean flags `--build-only` / `--prep-only`; (c) a new `beep-boop` CLI subcommand with `parseArgs` enum validation. (b) admits the nonsensical both-set combination and pairs badly with the existing single-selector mental model. (c) is more machinery than v1 needs, since beep-boop has no CLI subcommand today and its sibling flags (`--converge`, `--max`, `--until`) are all prose-parsed.
**Chosen:** a closed enum `--phases build|prep|all`, default `all`, recognised and enum-validated in SKILL.md prose (consistent with `--converge`). The closed-enum precedent is `NEXT_SPEC` (`next.js:10-21`) parsed by `parseArgs` (`argv.js:73`); that CLI machinery is the extension point if prose validation proves error-prone.

**Config knob or flag-only for v1?**
Options: (a) flag-only, per-invocation; (b) a `.faffrc` machine-designation knob. (b) risks a persistent both-primary or both-worker misconfiguration with no live check.
**Chosen:** flag-only for v1. The operator decides per invocation which run preps. A persistent machine designation is the out-of-scope extension point, shaped like `resolveConvergence` (`config.js:401-413`).

**How is prep suppressed under `--phases build` so it composes with L4 forced convergence?**
Options: (a) route every `faff-prep` dispatch to surface-only, leaving the convergence loop running; (b) disable convergence for the worker. (b) is inert at L4, where `resolveConvergence` returns `"true"` regardless of flag or knob (`config.js:407`; `SKILL.md:230`).
**Chosen:** route the prep dispatch (step 3, step 8.3, and the step-4/8.4 live-thread refresh) to surface-only; keep the build-chaining tributary and the convergence loop. Suppression is expressed as routing, not as disabling convergence.

**What does a build worker do with an empty build queue?**
Options: (a) exit clean via the existing wave-1 short-circuit; (b) idle-poll for new work.
**Chosen:** exit clean via the wave-1 short-circuit (`SKILL.md:241-243`); a long-lived worker is a relaunch concern (`/loop` or a shell loop). Idle-poll is the out-of-scope extension point.

**Does tidy run under `--phases build`?**
Options: (a) skip tidy (enter at step 4); (b) run tidy's non-prep auto-actions but skip its prep-candidate tagging. (b) has a build worker mutating the backlog (archiving, reparenting) concurrently with the primary's own tidy, for no build-queue benefit, and breaks the coordination-free property (N workers each grooming one shared tracker is overlapping mutation).
**Chosen:** skip tidy under `--phases build`; the worker enters at step 4. The primary owns tidy, and tidy's output feeds the prep queue the worker does not run. The one build-phase consumer of tidy's output, the step-4 `automation-verdicts.md` verdict cache, degrades gracefully: step 4 computes any un-cached candidate's verdict inline at assembly (`SKILL.md:189`), so an absent cache costs recomputation, never a missing verdict. See the tidy note in section 3.

**How are inert-but-harmless flag combinations handled (for example `--phases prep --max 5`)?**
Options: (a) accept with a surfaced inert-flag warning; (b) hard refuse. `--max` under `--phases prep` is not a contradiction (it gates the build phase, which never runs), unlike the true `--converge`/`--no-converge` conflict.
**Chosen:** accept with a surfaced warning that the flag is inert for a prep-only run. Only a genuine contradiction (an invalid enum value) is a hard fail-closed usage error.

**Does `--phases build` change the L4 ceiling precondition?**
**Chosen:** no. A build worker still needs a spend/time ceiling (`budget.cost` / `budget.tokens` / `budget.until`) under L4; `--max` alone is refused (`lights-out.js:369-370`, `:564-568`; `SKILL.md:71`). `--max` may ride along as a backstop. Phase and budget are independent axes.

## 7. Open questions and assumptions

**Open questions.** None. The four core decisions were operator-confirmed on 2026-08-09; the supporting decisions (5, 6, 7) follow from the load-bearing single-prepper model and the verified budget/convergence code.

**Assumptions.**

- **Assumes:** the `faff next` transition function (`next.js:32-50`) returns `prep` for an unspecced item and `graft` for a Todo+high-spec+eligible+unblocked item, and the orchestrator already routes on that verdict at steps 4, 8, and wave re-entry. Validation: confirmed at `next.js:45` (`spec === "none"` → `prep`) and `:49` (→ `graft`); the build agent should re-read `next.js:32-50` and `SKILL.md` steps 4 and 8 before wiring the surface-only branch.
- **Assumes:** the tracker `In Progress` claim (FAFF-82) already dedupes builds across concurrent runs via claim-before-admit (`SKILL.md:191`), and no new claim mechanism is added by this change. Validation: confirmed at `SKILL.md:191` (the claimed-by-peer disposition, no append to `admitted`).
- **Assumes:** prep never writes the run-ledger `admitted` array (`SKILL.md:162`), so a `--phases prep` run is trivially runcheck-clean and a `--phases build` run's `admitted` is unaffected by the absence of prep. Validation: confirmed at `SKILL.md:162`; the build agent should confirm no prep return path appends to `admitted`.

## 8. DONE: definition of done

### From WHY
- [ ] With one primary run and N `--phases build` workers on one tracker, only the primary dispatches `faff-prep`; no worker attaches a spec (observable: no prep comment from a worker run).
- [ ] SKILL.md documents the coordination-free model (single prepper, shared build queue deduped by the FAFF-82 claim) in the `--phases` prose.

### From WHAT (flag and mapping)
- [ ] `--phases` accepts exactly `build`, `prep`, `all`; default and flag-absent both equal `all`.
- [ ] The phase-to-step routing table in section 3 is reflected in the SKILL.md pipeline prose (tidy + steps 2-3 skipped under `build`; steps 4-10 skipped under `prep`).

### From HOW (behaviour)
- [ ] `--phases build` performs zero `faff-prep` dispatches: step-3 drain skipped, step-8.3 narrow prep surfaced-only, step-4/8.4 live-thread refresh surfaced-and-routed-out.
- [ ] `--phases build` keeps the build-chaining tributary: a `next: graft` item unlocked by a shipped build is re-assembled and built.
- [ ] `--phases build` composes with L4 forced convergence: the loop runs, only the prep tributary is surface-only (implemented as routing, not as disabling convergence).
- [ ] Under `--phases build`, a newly-unblocked `next: prep` item is surfaced and logged, never prepped.
- [ ] Under `--phases build`, an admitted candidate whose spec went stale via a live-thread Resolution/Challenge is routed out (surfaced), not built on a stale spec and not re-prepped.
- [ ] `--phases prep` runs steps 1-3 and stops before step 4; no build attempt is launched.
- [ ] `--phases prep` retires the `--max 0` specs-only idiom (documented as the replacement).
- [ ] An empty build queue under `--phases build` exits clean via the wave-1 short-circuit and counts as a successful run; step 10 is correctly skipped (builds did not run).
- [ ] `--phases all` (and flag-absent) is byte-for-byte today's full pipeline: same run-ledger, same report buckets, no new branch taken.
- [ ] `--phases build` skips tidy (step 1); the SKILL.md prose states that tidy's one build-phase consumer (the step-4 `automation-verdicts.md` verdict cache) degrades gracefully because step 4 computes any un-cached candidate's verdict inline at assembly (`SKILL.md:189`), so no verdict is skipped for want of the cache.

### From HOW (L4 and budget)
- [ ] A `--phases build` L4 run with only `--max` set is refused at preflight; a spend/time ceiling (`cost`/`tokens`/`until`) is still required, `--max` allowed only as a backstop.
- [ ] The report notes that a `--phases prep` run is governed only by `until` (the build-only budget dimensions gate a phase that never runs).

### From HOW (usage validation)
- [ ] An invalid `--phases` value fails closed at run start and does not start the pipeline.
- [ ] A build-gating budget flag under `--phases prep` is accepted with a surfaced inert-flag warning (not refused).

### From HOW (known limitation)
- [ ] Section 4.8 states the stale-claim limitation until FAFF-758: a worker crash leaves an `In Progress` needing manual clearing, the risk grows with worker count, and the tracker edge to FAFF-758 stays `relatedTo` not `blockedBy`.

### From completeness
- [ ] `runcheck`'s `admitted - outcomes == {}` invariant holds for a `--phases build` run and is trivially clean (empty `admitted`) for a `--phases prep` run.

**Integration smoke test.**

```
PROCEDURE smoke():
  1. Seed a tracker with:
     - ISSUE-A: Todo, high-confidence spec (build-ready)
     - ISSUE-B: Backlog, no spec (prep candidate)
  2. Run /faff-beep-boop --phases build.
  3. ASSERT ISSUE-A launched a build attempt (appears in a build bucket / `admitted`).
  4. ASSERT ISSUE-B received no faff-prep dispatch and appears under the surfaced/prep-deferred section.
  5. ASSERT runcheck exits 0.
  # If this passes, the seam cut (prep suppressed, build drained) is connected.
```

confidence: high
spec-review: pending

## Methodology critique

Overall: right-sized and cleanly scoped. One dependency-honesty finding worth acting on before build, one light grouping observation for a later tidy pass, and no de-risking spike needed.

**Right-sizing (principle 4): no issues.**
The change is one coherent unit: a closed `--phases build|prep|all` enum plus the convergence routing that makes the build phase behave. `--phases prep` and `--phases build` can read like two features, but they are the two halves of one flag surface and share the convergence-routing logic, so they ship together (a principle-4 merge, not a split). Folding the old `--max 0` specs-only idiom into `--phases prep` retires an accidental interface rather than adding a second concern. The work is almost entirely prose in one file (`plugin/skills/faff-beep-boop/SKILL.md`), which fits a single 1-3 day unit. Keep it as one ticket.

**Workstream fit (principles 1, 5): correctly loose, with a grouping worth noting later.**
What's there: the issue sits in project-less Backlog, which is the right home for freshly captured work under this lens (there is nothing to sequence it into yet). Its own description names a cluster of related tickets, FAFF-757, FAFF-578, FAFF-758, FAFF-759 and this one, that all converge on one outcome: safe parallel throughput across machines with no coordinator. Why it is worth a note: that is a real outcome-led grouping sitting un-homed, so the cluster's value cannot be sequenced as a unit today. What to do: nothing blocks this ticket, but flag the cluster for a rehoming pass in the next tidy (candidate outcome: "coordination-free multi-machine throughput") so the set gets an orderable home. This is an observation for tidy, not a precondition for building FAFF-760.

**Dependency honesty (principle 6): one finding.**
What's there: the spec and the issue both state that robust unattended multi-machine operation leans on FAFF-758's stale-claim cleanup (a crashed worker leaves a stale `In Progress` that nothing reclaims), yet the tracker edge to FAFF-758 is `relatedTo`, and the issue carries no `blockedBy` links at all. Why it matters: an operator reading only the tracker graph sees a mode with no unmet dependencies, while the prose says one part of the promise (many workers, unattended, across machines) is only robust once FAFF-758 lands. Left implicit, that gap surfaces at the worst time, as an accumulation of stale claims mid-run. What to do: keep the edge as `relatedTo`, not `blockedBy`. The mode functions and ships value without FAFF-758 (single-machine, and the multi-machine happy path), so a blocker edge would overstate the coupling and wrongly gate the build. Instead, surface the coupling where an operator will read it (now done: section 4.8 states the stale-claim known-limitation, that it grows with worker count, and that the edge stays `relatedTo`). That turns an implicit dependency into an explicit, operator-visible boundary without falsely gating the ticket. The FAFF-759 relationship is already handled honestly: the spec frames it as "may reduce to belt-and-braces," a scope interaction, correctly left as `relatedTo`.

**Risk profile (principle 7): no de-risking spike needed.**
What's there: the change introduces no new integration and no external dependency. It gates existing tributaries (build waves, chain-unlock, the wave-1 empty-queue short-circuit) behind a phase flag, and reuses the cross-machine build claim that already coordinates concurrent runs (FAFF-82, tracker-hosted). The one genuinely new behavior, routing the prep tributary to surface-only under `--phases build`, is a decision the spec has already made and grounded in the existing convergence code, not an open unknown. Why no spike: the risk here is operational, not integration risk. More workers make the FAFF-758 stale-claim gap more likely, but that is bounded by the section-4.8 known-limitation plus the L4 spend/time ceiling the spec already requires (phase and budget kept as independent axes, so a build worker still carries a ceiling and `--max` alone is correctly refused at preflight). A spike buys nothing that a careful spec section does not. Build it directly.

Methodology: faffter-dark-methodology-agile-delivery
