# Spec — FAFF-346: Wire the `architecture` slot call-site (prep-time proposal, holdout consumption)

> Spec: faffter-dark-nlspec · 2026-07-05 · interactive · confidence: high. Full spec on Linear FAFF-346.

This spec addresses FAFF-346 for the build agent and human reviewers. It closes the drift finding that the `architecture` slot — gateway-documented, occupant shipped (`faffter-noon-architecture`), contract + dispatcher + selftests shipped — has **no invoking call-site**: a user configuring the slot gets a silent no-op, and the holdout step hands its downstream consumer (the `env` slot) a proposal that nothing ever produced.

*Revised 2026-07-05 after spec-review iteration 1 (verdict: revise): the prep-time step is now a shared subroutine named at both spec-producing flows' insertion points, and the eval-seam registration names a distinct grader KIND + the frontmatter edit. Iteration 2 verdict: approve.*

*Revised again 2026-07-05 (interactive iterate): added the ADR recommendation — the trigger decision ("when faff decides an architecture") is promoted to a short ADR, materialised at graft (see §6 and DONE). Safe-direction: no architecture, interface, or approach change, so the retained approve stands.*

## 1. WHY — Problem and Principles

**The load-bearing model:** the architecture proposal's canonical carrier is **the spec artifact**. ADR-0030's proposer/critic boundary already fixes this — "the proposer emits an envelope into a spec, the critic reads that spec downstream." So the call-site question answers itself: the proposal must be generated **before the spec is produced** (faff-prep), land **in** the attached spec as its verbatim `faff-contract:architecture-proposal` block, and every downstream consumer — the spec-review architectural lens (the critic) and the holdout `env` slot (the provisioner) — **reads it out of the spec** rather than being handed it out-of-band. Wiring anywhere else (e.g. generating it fresh at holdout time) would produce a proposal after the code is built, which the critic never critiques — collapsing the boundary the ADR exists to hold.

**Problem statement:** the gateway slot table advertises `architecture` as a live slot, conformance validation runs on configured occupants, and the beep-boop/graft holdout step consumes "the architecture proposal" — yet no skill invokes the slot, so the capability is claimed but unreachable and the `env` slot's first input is effectively null. This change adds the one missing invoking step (in faff-prep), defines how the holdout call-sites read the proposal from the spec, and adds the `models.architecture` dispatch lane, so the propose→provision→evaluate spine is composed end-to-end in prose.

**Design principles:**

- **One producer dispatch, one carrier, zero new plumbing.** Reuse the existing producer-dispatch pattern (resolve slot → dispatch → parse block → pipe to `faff contract architecture-proposal`) and the existing spec-attachment path. No new CLI verbs, no new contract, no holdout-step signature change.
- **Precision-biased trigger, fail-safe downstream.** The prep-time step fires only when clearly warranted; a missed fire degrades to today's behaviour and is caught fail-closed by the existing holdout gates. This is deliberately the opposite bias from spec-review lens selection (recall-biased), because a spurious proposal injects unfounded architecture prose into a spec, while a missed one costs nothing that isn't already the status quo.
- **New prose carries no tracker refs.** All SKILL.md edits state rules forward with no issue-ID references (lint-refs).

**Reference context:**

| System | Relevance |
|---|---|
| `plugin/skills/faff/SKILL.md` | Slot table row (line ~209), producer-dispatch enumeration (~line 857), model-lane list (~line 233) — all gain the call-site/lane |
| `plugin/skills/faff-prep/SKILL.md` | Gains the conditional architecture subroutine, invoked from both spec-producing flows |
| `plugin/skills/faff-beep-boop/SKILL.md` | `holdout_step` step 1 (section 10b) amended to extract the proposal from the spec — the single home; faff-graft Step 10 reuses it by reference, unchanged |
| `plugin/skills/faffter-noon-env-compose/SKILL.md` | Inputs section gains the absent-proposal posture (mirrors its existing no-profile posture) |
| `plugin/skills/faffter-noon-architecture/SKILL.md` | The occupant — **unchanged** |
| `plugin/skills/faff/bin/faff` | `models.architecture` lane: DEFAULTS (~331), lane vocab (~346), config-get whitelist (~854), startup lane validation (~864), run-banner lane list (~931) |
| `docs/guide/skills.md` | faffter-noon table gains the `faffter-noon-architecture` row |
| `docs/adr/0030-…proposer-critic-boundary.md` | The settled boundary this wiring implements — authority, not modified |
| `eval/seam-registry.json`, `eval/grader.mjs` | Registry for the new trigger-judgement seam |

**Scope statement:** this is the composition slice of the propose→provision→evaluate spine — prose call-site + one config lane + docs; the first real exercise is the greenfield external-verification work (P1 link-shortener), which this deliberately does not duplicate.

## 2. OUT OF SCOPE

- **The greenfield e2e harness** (SUT repo, `.faffrc`, Docker, the P1 run) — why: separately planned external-verification work; this ticket makes that work's planning assumption ("the runner composes architecture→env") true. Extension point: `design/faff-external-verification-brief.md` section 6.
- **jot/plot greenfield project-formation call-site** — why: both are interactive and the autonomous planning loop is itself a documented-future capability; wiring there is a double-future dependency. Extension point: the prep step's trigger rule is written call-site-agnostically, so a future plot-time invocation reuses the same dispatch + fold prose.
- **Buy/hybrid routing** — why: `recommendation ≠ build` already surfaces needs-human at the env step; procurement is a separate concern. Extension point: the `recommendation` field, per ADR-0030's consequences.
- **A call-site-reachability lint** (validate-adapters checks occupant conformance only; this gap was invisible to it) — why: a generic "every slot has an invoker" check is a new lint class, not this slice. Extension point: the validate-adapters check registry in `bin/faff`.
- **Repairing the other missing rows in `docs/guide/skills.md`** (adr, env-compose, evaluate, spec-review, prd are also absent) — why: pre-existing rot beyond this ticket's surface; fixing only the architecture row keeps the docs-never-go-stale obligation scoped to this change. Extension point: the same table.

## 3. WHAT — Vocabulary and Interfaces

**Vocabulary:**

| Term | Definition |
|---|---|
| Proposal block | The verbatim fenced `faff-contract:architecture-proposal` JSON block the occupant emits |
| New-runnable-surface work | Work that stands up a new runnable system or materially changes the deployment shape (new service/app/deployable/datastore/runtime surface) with no established architecture to inherit |
| Absent-proposal posture | The defined behaviour of the holdout env step when the spec carries no proposal block |

**The prep-time step (new, conditional — a shared subroutine, both spec-producing flows).** Written once in faff-prep as a shared subroutine (the same documentation shape as the already-shipped scan + premise-superseded gate) and invoked from **both** flows that produce a fresh spec: interactive **Scenario A**, between Step 1 (explore) and Step 2 (spec dispatch); and autonomous **Path 2 (fresh-spec)**, immediately before its spec-production step. Autonomous prep is the path that feeds the L4 holdout consumers (and the greenfield first-light exercise), so wiring Scenario A alone would recreate the unreachable-capability drift on the path that matters most — the subroutine form makes that impossible to miss:

```
STEP Architecture proposal (conditional):
  1. Trigger test (prose judgement, precision-biased):
     fire ONLY when the issue + explore findings show new-runnable-surface work
     AND no current proposal already exists for the same system
     (a sibling spec in the same project already carrying a proposal block
      counts as existing — never dispatch a second proposer for one system).
     Uncertain → do not fire (skip; prep proceeds exactly as today).
  2. On fire: resolve `faff config get slots.architecture`; validate a
     non-default occupant per the slot-conformance rule; dispatch it with the
     issue/brief + explore findings, using the same transport as the adjacent
     spec-producer dispatch (producer subagent resolving models.architecture
     when prep is top-level; in-context when prep is itself a subagent —
     single-level nesting). The occupant reads the infra profile itself.
  3. Fold: locate the returned proposal block, pipe to
     `faff contract architecture-proposal`.
     exit 0 → pass the block + the "ADR promotion intent" section to the spec
              producer as input, with the instruction that the spec body
              carries the block VERBATIM (it must survive onto the attached
              spec — downstream readers depend on it).
     exit non-zero / no block → degrade: proceed to spec production with no
              proposal, surface the failure loudly in prep's output.
              Never park solely for this.
```

**The holdout consumption (amended, one home).** `holdout_step(spec, prdr_id, key, run_dir)` signature unchanged at both call-sites (per-run beep-boop 10b, per-issue graft Step 10 — the latter reuses by reference and needs no edit). Step 1 becomes: extract the proposal block from the spec (landed there at prep time, when the work warranted one); hand it to `slots.env` with the infra profile. A malformed block is treated as absent and surfaced loudly — never repaired or invented.

**The env occupant's absent-proposal posture (new sentence in its Inputs).** No proposal supplied → record an explicit "no architecture proposal" note, derive services from the infra profile (+ repo compose reconciliation, its existing path), and treat the recommendation gate as `build` (no buy/hybrid signal exists to honour). Carried into the handle's `notes`.

**The config lane.** `models.architecture`, default `inherit`, closed Agent-token vocabulary — identical shape to `models.spec`, added at every locus that enumerates the lane set (DEFAULTS, vocab, config-get whitelist, startup lane validation, run-banner list).

## 4. HOW — Behaviour

**Gateway edits (three, all small):**
- Slot table `architecture` row: append the call-site sentence — invoked by faff-prep's conditional architecture step for new-runnable-surface work; the proposal lands in the spec; the spec-review architectural lens and the holdout env step read it from there.
- Producer-dispatch enumeration gains `architecture` alongside `spec`/`methodology`/`spec_review`/`intake`.
- Model-lane list gains `models.architecture` on the producer-lane line.

**Edge cases and error handling:**
- Producer dispatch fails / occupant unreachable → same as fold failure: degrade loud, no park (the gateway's "a missing slot is never a park reason" family; the slot always has a bundled default, so genuine absence is an install fault `faff doctor` owns).
- Contract exit 1 at prep → retryable once at the operator's discretion in interactive mode; in autonomous mode, no retry — degrade and continue.
- Spec attached before this change (no block) reaching an L4 holdout → absent-proposal posture; behaviour is today's de-facto behaviour made explicit, so no existing run regresses.
- Two sibling issues prepped in the same wave, both greenfield-triggering → the "existing sibling proposal" clause makes the second reuse-by-reading, not re-propose; if racing preps both fire, two proposals for one system is surfaced by the spec-review architectural lens (the critic sees both specs), not silently merged.

**Failure modes:**
- **The trigger misjudges systematically.** Wrong about the approach, not the code: the precision bias could mean the step ~never fires on real work. How you'd know: the P1 greenfield exercise — its pass condition is "architecture proposed"; a P1 run where prep skips the step is the signal. What it means: recalibrate the trigger prose (narrow → named-signal list), not the plumbing — the dispatch/fold/consumption path is trigger-independent.
- **The proposal block doesn't survive to the attached spec** (a spec producer summarises instead of carrying verbatim). How you'd know: holdout runs land absent-proposal notes on work that fired the prep step; grep the attached spec for the fenced tag. What it means: strengthen the carry instruction in the spec-producer input; the fold already validated the block, so this is a transport defect, not a judgement one.

**Anti-pattern:** generating a proposal at holdout time when the spec carries none. Why: the critic never critiques it and the build never followed it — a post-hoc proposal is provenance theatre; the absent posture exists precisely so this is never needed.

**Anti-pattern:** adding an architecture-occupant probe to the lights-out preflight. Why: the preflight probes the eight guardrail CLI contracts plus adversarial occupancy for review/spec_review only; env/evaluator occupants are not probed either, and the architecture path degrades soft at prep and fail-closes at the env-handle/holdout contracts. A probe here would be asymmetric gold-plating.

## 5. Scenarios

```
Given an issue whose explore findings show a new runnable service and no established architecture
When faff-prep runs
Then slots.architecture is dispatched, the validated proposal block lands verbatim
     in the attached spec, and the spec-review architectural lens receives a spec carrying it
```

```
Given a typical brownfield issue on an existing system
When faff-prep runs
Then the architecture step does not fire and prep's flow is byte-for-byte today's
```

```
Given the architecture producer returns a malformed or missing block
When prep folds it
Then `faff contract architecture-proposal` exits non-zero, prep proceeds without a
     proposal, surfaces the failure loudly, and does not park
```

```
Given an L4 holdout over a spec carrying a proposal block
When holdout_step runs
Then the env slot receives that block and honours its recommendation gate
```

```
Given an L4 holdout over a spec with no proposal block
When holdout_step runs
Then the env slot provisions from the infra profile + spec, the handle notes record
     the absence, and every other gate behaves unchanged
```

Assertion: `faff config get models.architecture` returns `inherit` by default; an invalid token fails loud (exit 2) naming the legal set; `faff validate-adapters` and all `--selftest` suites stay green.

## 6. Design decision rationale

**Wire now, or future-fence the slot row?** Fencing (precedents exist: the gateway's evaluator-lane "future capability" note, faff-plot's L4 note) fixes the honesty drift but pushes the call-site wiring into the greenfield e2e work — conflating a prose-composition task with a harness-building task — and falsifies that work's stated planning assumption that the runner already composes architecture→env→evaluate. Wiring is 1–2 days and is exactly what the P1 exercise tests. **Chosen:** wire now — the fence would trade one drift (claimed-but-unwired) for another (a "future" label on machinery whose first exercise is already planned against it existing).

**Which call-site?** Prep pre-spec vs jot/plot greenfield vs holdout-step step 0. Holdout-step generation is surgical but produces the proposal after the build, uncritiqued — it breaks ADR-0030's proposer/critic boundary. jot/plot is conceptually natural but double-future (interactive skills + a future planning loop). Prep is where the spec is produced, and ADR-0030 says the proposal lands in the spec. **Chosen:** faff-prep, as a conditional shared subroutine invoked from both spec-producing flows; holdout consumes from the spec.

**Trigger rule.** Fire on every architecture-bearing classification (recall-biased, like lens selection) vs a narrow new-runnable-surface rule. Recall-biased firing would dispatch a proposer on most faff tickets (everything touches "architecture" in prose) and inject unfounded proposals. **Chosen:** precision-biased new-runnable-surface trigger, uncertain → skip; a missed fire is today's behaviour and the holdout fail-closes downstream. Explicitly a different judgement from the spec-review `architecture-bearing` surface tag.

**Prep-side failure posture.** Park vs degrade on a failed dispatch/fold. **Chosen:** degrade loud, never park — the proposal is an enrichment of spec production, not a gate; the L4 gates that depend on its consequences (env-handle, holdout-verdict) already fail closed.

**Holdout consumption + absent posture.** Signature change to pass a proposal in, vs reading it from the `spec` parameter already passed. **Chosen:** extract from the spec in holdout_step step 1 (the single home in the beep-boop prose; graft reuses by reference, no graft edit) — absent → the env occupant's profile-derived posture with an explicit note, treating recommendation as `build` since no buy signal exists. This makes today's de-facto null-proposal behaviour explicit and backwards-compatible.

**Model lane.** Omit (dispatch always inherits) vs add `models.architecture`. The gateway's producer-dispatch rule resolves `models.<slot>` for every producer dispatch, and `faff config get` whitelists keys — omission would make the standard dispatch prose fail on this one slot. **Chosen:** add the lane, default `inherit`, mirroring the sibling producer lanes at all five enumeration loci.

**Lights-out preflight.** Add an architecture-slot reachability probe vs not. **Chosen:** no probe — symmetric with the unprobed env/evaluator occupants; the preflight's dial-coherence rules exist only where a wrong occupant silently weakens a gate (adversarial review pair), which does not apply to a soft-degrading proposer.

**Occupant prose.** Teach `faffter-noon-architecture` who calls it vs leave it caller-agnostic. **Chosen:** unchanged — callers are named in the gateway slot row (the one home); occupants answer the request from the inputs they're given, per the established slot convention.

**Docs scope.** **Chosen:** add the `faffter-noon-architecture` row to `docs/guide/skills.md` in the same PR (docs-never-go-stale); `docs/guide/configuration.md` needs nothing (it defers the slot catalogue to skills.md); the table's other missing rows are pre-existing rot, out of scope (named above).

**Does this warrant its own ADR?** The *carrier* decision (proposal lands in the spec; the critic reads it there) is already recorded — ADR-0030 fixes it and is not modified. But the *trigger* — **when faff makes an architecture decision at all**: only at prep time, only on new-runnable-surface work, precision-biased with uncertain→skip, degrade-loud-never-park — is a new, durable pipeline-shape call recorded nowhere. **Chosen:** promote it as its own short ADR ("When faff decides an architecture"), materialised at graft via `faff adr new` from the ADR promotion intent on the ticket; it records the prep-time placement, the precision-biased trigger, and the absent-proposal posture as consequences, cross-referencing ADR-0030 rather than amending it. Rejected: folding it into ADR-0030 as an amendment — that ADR settles the proposer/critic *boundary*, not invocation *timing*, and amending an Accepted ADR for an additive decision muddies provenance.

## 7. Open questions and assumptions

**Open questions:** none — every decision above is closed.

**Assumptions:**
- **Assumes:** ADR-0030 (Accepted) stands as the boundary authority — proposal lands in the spec, critic reads it there. Validation: `docs/adr/0030-…md` status line before build.
- **Assumes:** the greenfield external-verification P1 exercise remains the first live end-to-end run; this ticket ships prose + one config lane only. Validation: `design/faff-external-verification-brief.md` still lists P1 with the architecture→env→evaluate pass condition.
- **Assumes:** the eval seam registry mechanism (`eval/seam-registry.json` read fail-loud by `eval/grader.mjs`) exists for registering the new trigger seam. Validation: the registry file parses and grader KINDS registration follows its existing entries' shape.

## 8. DONE — Definition of done

### From WHY / WHAT (composition)
- [ ] faff-prep carries the conditional architecture step (trigger → dispatch → contract-fold → verbatim-carry instruction to the spec producer) as a **shared subroutine invoked from both spec-producing flows**: interactive Scenario A (between Step 1 explore and Step 2 spec dispatch) **and** autonomous Path 2 fresh-spec (before its spec-production step) — grep both flows for the subroutine reference
- [ ] Fold failure path: contract exit non-zero → proceed spec-ward with no proposal, loud surface, no park
- [ ] beep-boop `holdout_step` step 1 extracts the proposal block from the spec; malformed → treated as absent + surfaced; signature unchanged; faff-graft Step 10 untouched (reuse by reference verified)
- [ ] `faffter-noon-env-compose` Inputs states the absent-proposal posture (profile-derived, note recorded, recommendation treated as build)
- [ ] Gateway: slot-table architecture row names the call-site; producer-dispatch enumeration includes `architecture`; model-lane list includes `models.architecture`
- [ ] `faffter-noon-architecture/SKILL.md` unchanged

### From WHAT (config lane)
- [ ] `models.architecture` present in DEFAULTS (`inherit`), lane vocab, config-get whitelist, startup lane validation, and the run-banner lane list in `bin/faff`
- [ ] `faff config get models.architecture` → `inherit`; invalid token → exit 2 naming the legal set

### From HOW (guards and hygiene)
- [ ] No lights-out preflight change (guardrail list and dial-coherence rules untouched)
- [ ] All new/edited SKILL.md and docs/guide prose carries no tracker-ID references; `faff validate-adapters` passes
- [ ] `node --test` + `bin/faff` selftest suites green

### From docs
- [ ] `docs/guide/skills.md` faffter-noon table gains the `faffter-noon-architecture` row naming slot + invocation point
- [ ] The trigger ADR ("When faff decides an architecture" — prep-time placement, precision-biased new-runnable-surface trigger, absent-proposal posture) is materialised on the feature branch via `faff adr new` per the ADR promotion intent on this ticket, cross-referencing ADR-0030 (not modifying it)

### Eval coverage
- [ ] The prep architecture-trigger judgement is registered under a **new, distinct** grader KIND — `prep-architecture-trigger` (the registry's existing `architecture` KIND is the occupant's proposal-*quality* seam; the trigger seam must not collide with it) — with ≥1 eval case each way (one fire, one skip) + the matching `eval/seam-registry.json` row, in this ticket; baseline recording stays the separate human-supervised step
- [ ] `faff-prep/SKILL.md` frontmatter `judgement_seam:` gains `prep-architecture-trigger` (validate-adapters reconciles frontmatter ↔ registry ↔ grader KINDS; multi-seam frontmatter has precedent)

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Feed prep a synthetic greenfield issue ("stand up a link-shortener service")
     with explore findings showing an empty runnable surface
  2. Assert the architecture step fires, the fold exits 0, and the attached spec
     contains the fenced faff-contract:architecture-proposal block verbatim
  3. Feed that spec to holdout_step step 1 in isolation; assert the extracted block
     round-trips `faff contract architecture-proposal` exit 0
```
