# Move all ordering/value/risk/size/priority opinion out of the orchestration layer into the methodology adapter

> Spec: faffter-dark-nlspec · 2026-06-11 · interactive · confidence: high. Full spec on Linear FAFF-113.

*Revised 2026-06-11 (twice). v1 (a "priority is king" structural default kept in the gateway) was superseded by the human's steer: the orchestration skills must hold **no** importance/value/priority/size/risk/ordering opinion at all — there must be nothing in the main skills for a configured methodology to contradict; the methodology adapter provides all of it. The one open Punt (how to delegate held-set / value-chain ordering, which had no existing named output) was resolved interactively to **Option B — reuse `pick-ordering`** (no new contract surface, no swap-floor change). Spec is now fully closed.*

This is the build spec for FAFF-113. Audience: the build agent editing faff's own skill prose. The unit of change is **prose in faff's orchestration-layer skill files**, removing embedded ordering opinion and routing it to the `methodology` slot.

## 1. WHY — Problem and Principles

**Problem statement.** A `/faff-tidy` run framed a "priority gap" as *"can't derive risk vs value"* — backwards (priority is the *output* of weighing value × risk, not a precondition). That symptom traces to a structural fault: the **orchestration layer holds its own ordering/value/risk opinions** that *duplicate and contradict* the configured methodology. The gateway says "**Priority is king** … methodology reframes only *within each priority band*"; the agile-delivery methodology says "value × risk … **overrides structural ordering** … priority is **an input signal, not a veto** … **owns sequencing entirely**." Two authorities, one decision → drift and contradiction.

**The principle (the governing constraint).** The orchestration skills — the gateway (`faff/SKILL.md`), `faff-tidy`, `faff-wtf`, `faff-map`, `faff-beep-boop` — must own **no** rule or opinion about issue **importance, value, priority, size, risk, or work ordering**. All of it is the **`methodology` slot's** exclusive domain (the "methodology adapter"). There must be **nothing in the main skills for a configured methodology to contradict** — the methodology *provides* it. This is the sharp edge of the *configurable, not opinionated* governing tenet.

**The one authority + the zero-config baseline.** The structural-default methodology (`faffter-noon-methodology-structural`) already owns the baseline — its contract states ordering is "**always priority + unlock value**" and it "**never reorders by value/risk**." Because the slot *always resolves* (default when unset; `faff-beep-boop` already relies on its `pick-ordering`/`build-queue` being load-bearing), routing every ordering decision through the slot keeps zero-config behaviour **identical** — but moves the *opinion* to where it belongs. The orchestration layer keeps only **objective graph facts** (dependency links, cycles, unlock-counts) and **rendering**; it never *orders by* them on its own authority.

**Design principles** (these would reject an otherwise-valid implementation):

- **No competing authority.** After this change, no orchestration skill states an ordering, a risk tier ranking, a sizing judgement, or "priority is king." Any such sentence is the bug.
- **Facts vs opinion split.** Reading the dependency graph and counting transitive dependents is a *fact* (stays). Deciding that "low-risk before higher-risk" or "higher unlock value first" is the *order* is an *opinion* (moves to the methodology).
- **Zero-config parity.** With no methodology configured, output ordering is byte-for-byte what it is today — the structural default supplies the same "priority + unlock value" it always did, now as the slot's answer rather than a gateway rule.
- **Single source of truth.** The delegation contract lives once in the gateway; consumers reference it, never restate an ordering.

**Scope statement.** Configurability/contract framework — this redraws the boundary between the fixed orchestration skills and the swappable `methodology` slot so that all importance/value/risk/size/ordering judgement sits on the slot side of the line.

## 2. OUT OF SCOPE

- **Re-implementing the structural default's ordering logic.** — *Why excluded:* it already owns "priority + unlock value"; this spec *routes to* it, it does not rewrite it. *Extension point:* `faffter-noon-methodology-structural/SKILL.md`.
- **Objective graph diagnostics (cycles, ghost-projects, unlock-counts, blocks-N / blocked-by-N).** — *Why excluded:* facts, not opinions; they stay in the orchestration layer / the rendering forms. *Extension point:* the On-hold-entry / value-chain rendering forms in `faffidavit-rendering`.
- **The faff CLI.** — *Why excluded:* `faff/bin/faff` does no ordering (`faff next` is a pure status→step transition). *Extension point:* a future `faff order` subcommand if ordering is ever mechanised.
- **The routing/verdict layer.** — *Why excluded:* `faffidavit-routing` verdicts never reference priority/value/risk; untouched.
- **A new `order-set` named output / any methodology swap-floor change.** — *Why excluded:* the held-set/value-chain ordering is delegated by **reusing `pick-ordering`** (resolved Option B), so the fixed named-output set does not grow. *Extension point:* if a future context needs an ordering `pick-ordering` can't express, add a named output then (swap-floor change, its own ticket).
- **Authoring a new "missing priority" diagnostic.** — *Why excluded:* no such fixed string exists; removing the contradiction removes the muddle that generated the ad-libbed framing.

## 3. WHAT — the delegation contract and the opinion-site inventory

**Vocabulary.**

| Term | Definition |
|---|---|
| Ordering opinion | Any rule that ranks, sequences, sizes, or risk-/value-weights work. The thing being moved. |
| Objective graph fact | A read of tracker state with no judgement: dependency links, cycle membership, count of direct+transitive dependents. Stays in the orchestration layer. |
| Methodology adapter | The configured `methodology` slot (default `faffter-noon-methodology-structural`); the sole owner of ordering opinion, via its named outputs. |
| Delegation contract | The gateway rule that *replaces* the Work-ordering rule: "obtain every ordering/sizing/value/risk judgement from the methodology slot; the orchestration layer states none." |

**Decision — How far does the opinion move: gateway-default (v1) or fully into the methodology (v2)?**
- Option A (v1, superseded): keep a "priority is king" structural default *in the gateway*, let a configured methodology override it.
- Option B (this spec): the orchestration layer owns *no* ordering opinion; the methodology adapter (default or configured) owns *all* of it. The gateway holds only a delegation contract.
- **Chosen:** B — per the human's steer. A leaves a gateway opinion that a methodology can still contradict; B removes the contradiction surface entirely. Zero-config parity is preserved because the structural default supplies the same baseline as the slot's answer.

**Decision — Where does the zero-config baseline live?**
- **Chosen:** in `faffter-noon-methodology-structural` (it already does — "always priority + unlock value"). The gateway's duplicate statement of it is deleted, not relocated.

**Decision — What replaces the gateway Work-ordering rule?**
- **Chosen:** a **delegation contract**: every place a sub-skill ranks/sequences/sizes/risk-weights work, it requests the relevant named output from the configured `methodology` slot (`pick-ordering` / `build-queue` for sequencing; `ticket-shaping` for sizing; `issue-critique` for per-issue; `bless-set` for held-set batches) and renders what it returns. The gateway states no ordering, no "king", no band rule, no risk tiering.

**Decision — What happens to each consumer opinion site?**
- **Chosen:** each is replaced by "render in the order the methodology's relevant named output returns." Inventory (the build worklist):
  - `faff/SKILL.md` Work-ordering rule — delete the rule's *opinion*; replace with the delegation contract.
  - `faff-tidy` Ready bucket — "priority then unlock … within each priority band" → "in the order the methodology's `pick-ordering` returns."
  - `faff-tidy` On-hold ordering — "safest × highest-unlock first, low-risk before higher-risk" → order the On-hold list via the methodology's `pick-ordering`.
  - `faff-wtf` work-ordering note → reference the delegation contract.
  - `faff-wtf` On-hold ordering — "Order safest × highest-unlock first" → via `pick-ordering`.
  - `faff-wtf` "Within priority bands, prefer high chainable unlock value" → delete (it is the gateway opinion restated).
  - `faff-wtf` value-chains — "Order the chains by total unlock value" → via `pick-ordering` over the chain heads.
  - `faff-map` horizons — "instead of priority + chainable-unlock-value alone" → the baseline *is* the structural methodology's answer; reword so map never names a baseline of its own.
  - `faff-beep-boop` — already routes through the slot; reword so it doesn't attribute the baseline ordering to "the structural default's priority + chainable-unlock-value" as if beep-boop knew it — it only knows "the methodology's `build-queue` order."

**Decision — How is the held-set / value-chain ordering delegated (no existing named output covered it)?**
- Option A: add a new fixed `order-set` named output — clean semantics, but a swap-floor change every methodology must answer.
- Option B: reuse `pick-ordering` to order the held set and the value-chain heads too — no new output, no swap-floor change; the structural default's `pick-ordering` supplies the baseline order for these sets as well.
- Option C: let the orchestration layer order by a pure graph fact (unlock-count descending) — rejected: "higher unlock first" is itself an ordering opinion, smuggling judgement back into the orchestration layer.
- **Chosen:** B (resolved with the human). `pick-ordering` becomes the methodology's general "order this set of issues" answer, covering ready/build **and** the held-set + value-chain renders. C violates the no-opinion principle; A's swap-floor cost is unjustified when `pick-ordering` already expresses the ordering. The mild semantic stretch (`pick-ordering` now also orders not-pickup-able held items) is documented in the delegation contract so the meaning is explicit, not implicit.

## 4. HOW — Behavior

**Architecture.** One gateway replacement + a mechanical sweep of the consumer opinion sites, all converging on "ask the methodology's `pick-ordering` (or the context's named output), render its answer."

**Edit 1 — Gateway: replace the Work-ordering rule with the delegation contract (`faff/SKILL.md`).**

```
Ordering & judgement delegation (the orchestration layer holds no opinion):

  Every place a sub-skill ranks, sequences, sizes, or value-/risk-weights work
  — tidy's Ready / On-hold / Stuck-in-prep, wtf's Coming Up / Today's Focus /
  Ready / value-chains / On-hold, map's horizons, beep-boop's build queue —
  obtains that judgement from the configured `methodology` slot's relevant
  named output and renders what it returns. The orchestration layer states no
  ordering, no "priority is king", no risk tiering, no sizing rule of its own.

  Named output per context:
    - sequencing / "what order to take these issues" (Ready, Today's Focus,
      build queue, On-hold list, value-chain heads) → `pick-ordering`. It is
      the general "order this set of issues" answer — including sets that are
      not themselves pickup-able (e.g. the not-eligible On-hold list).
    - build queue → `build-queue`;  sizing → `ticket-shaping`;
      per-issue lens → `issue-critique`;  bless batches → `bless-set`.

  The slot ALWAYS resolves: unset → `faffter-noon-methodology-structural`, which
  owns the zero-config baseline ("priority + unlock value"). So zero-config
  ordering is unchanged; the opinion simply lives on the methodology side.

  Objective graph facts (dependency links, cycles, count of transitive
  dependents) are NOT opinions — the orchestration layer may read and render
  them. Ordering BY them is an opinion and comes from the methodology.

  Dependency-direction note: value and risk are INPUTS assessed on the work;
  priority is the DERIVED signal produced by weighing them. A missing priority
  never blocks assessing value or risk — it is their output.
```

- **Anti-pattern:** any orchestration skill restating an ordering. Why: that is the duplicate-authority bug this fixes.
- **Anti-pattern:** "within each priority band" / "priority is king" / "low-risk before higher-risk" surviving in a main skill. Why: each is an owned opinion.

**Edit 2 — Sweep the consumer opinion sites (§3 inventory).** For each listed line, replace the embedded opinion with a reference to the delegation contract / the named output. Procedure:

```
PROCEDURE strip_orchestration_opinions():
  1. grep -rniE "priority is king|within (each )?priority band|safest|low-risk before|highest-unlock|value ?× ?risk|order .*by (total )?unlock|sequence by" skills/{faff,faff-tidy,faff-wtf,faff-map,faff-beep-boop}
  2. FOR each hit:
       a. IF it RANKS / SEQUENCES / SIZES / RISK-weights → replace with
          "per the configured methodology's <named-output>" (delegation contract)
       b. IF it RENDERS an objective graph fact (unlock-count, blocks-N) → keep
       c. IF it is the canonical delegation contract in faff/SKILL.md → keep
  3. CONFIRM no main skill names an ordering, a risk tier order, or "priority is king"
```

**Edit 3 — Held-set + value-chain ordering (resolved: Option B).** In `faff-tidy` On-hold and `faff-wtf` On-hold/value-chains, replace "safest × highest-unlock first / low-risk before higher-risk / order chains by total unlock value" with: order these sets via the methodology's `pick-ordering` over the set's issues (held items, or value-chain heads). The On-hold-entry *signals* (reversibility tier, blocks-N, unlock-N) remain rendered as objective facts; only the **order** moves to `pick-ordering`. When a methodology also answers `bless-set`, that ranked output still drives the bless cards (unchanged); `pick-ordering` orders the flat fallback list.

**Edge cases:**
- **No methodology configured** → structural default answers `pick-ordering` for every set; ordering identical to today. Verify with the smoke test.
- **Held set, structural default** → `pick-ordering` returns the same priority + unlock order the old "safest × highest-unlock" heuristic approximated; document that this is now the methodology's answer, not tidy's rule.
- **map's critical path** → the *dependency chain* is an objective graph fact (stays); any *re-sequencing within a horizon* is the methodology's (already routed at map's methodology-lens note — just remove map's self-named baseline).

## 5. DESIGN DECISION RATIONALE

**Why move everything rather than keep a gateway default (v1)?** A gateway default is still an orchestration-layer opinion a configured methodology can contradict — exactly the fault that produced this ticket. Only "the orchestration layer owns nothing" removes the contradiction surface. Zero-config parity is free because the structural default already supplies the baseline.

**Why is "objective graph fact" carved out?** Dependency links and unlock-counts are reads of tracker state with no judgement; forbidding the orchestration layer from *reading* them would be absurd. The line is at *ordering by* them — that is where opinion enters, and that crosses to the methodology.

**Why reuse `pick-ordering` (B) over a new output (A) or a pure-fact render (C)?** C re-introduces an ordering opinion in the orchestration layer (it asserts unlock-count is the sort key) — it violates the whole point. A is principle-clean but imposes a swap-floor cost on every methodology for a capability `pick-ordering` already expresses (ordering a set of issues). B keeps the contract surface flat and the opinion wholly on the methodology side; the only cost is documenting that `pick-ordering` also orders not-pickup-able sets, which Edit 1 makes explicit.

## 6. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none — the held-set/value-chain delegation was resolved to Option B (reuse `pick-ordering`).

**Assumptions:**
- **Assumes:** the `methodology` slot always resolves (unset → `faffter-noon-methodology-structural`) and its `pick-ordering` / `build-queue` are already load-bearing (per `faff-beep-boop`). *Validation:* `faff config get slots.methodology -d` → empty → structural default; confirm beep-boop already consumes the slot's order.
- **Assumes:** `faffter-noon-methodology-structural` states the "priority + unlock value" baseline in its own contract. *Validation:* grep the structural SKILL for "priority + unlock value" / "never reorders by value/risk".
- **Assumes:** `pick-ordering` is semantically able to order a *set* of issues (not only the build queue) — the structural default ranks any issue set by priority + unlock. *Validation:* read `faffter-noon-methodology-structural`'s `pick-ordering` description; if it is build-queue-specific, widen its wording (in the structural skill, not the orchestration layer) as part of Edit 1.
- **Assumes:** the On-hold/value-chain *signals* (reversibility tier, blocks-N, unlock-N) are rendering-form facts owned by `faffidavit-rendering`, not orchestration opinions. *Validation:* the fields are defined in the rendering adaptor's Canonical visual forms, not in tidy/wtf prose.

## 7. DONE — Definition of Done

### From WHY / principle
- [ ] No orchestration skill (`faff`, `faff-tidy`, `faff-wtf`, `faff-map`, `faff-beep-boop`) states an ordering, a risk-tier order, a sizing rule, or "priority is king."
- [ ] `grep -rniE "priority is king|within (each )?priority band|low-risk before|safest ×|order .*by .*unlock"` over those five skills returns only the delegation contract's own text (or nothing).

### From WHAT / HOW (Edit 1)
- [ ] `faff/SKILL.md` Work-ordering rule is the **delegation contract** (orchestration holds no ordering opinion; every ranking/sizing/value/risk judgement comes from the methodology slot; `pick-ordering` named as the general set-ordering answer incl. not-pickup-able sets; the slot always resolves; objective graph facts excepted; dependency-direction grounding note present).

### From HOW (Edit 2)
- [ ] Each §3 inventory site (`faff-tidy` Ready/On-hold; `faff-wtf` work-ordering/On-hold/within-bands/value-chains; `faff-map` horizons; `faff-beep-boop`) references the delegation contract / a named output instead of stating an order.

### From HOW (Edit 3)
- [ ] `faff-tidy` On-hold and `faff-wtf` On-hold/value-chains order via the methodology's `pick-ordering`; the On-hold-entry signals still render as objective facts; `bless-set` cards unchanged.
- [ ] If `pick-ordering`'s structural-default description was build-queue-specific, it is widened (in `faffter-noon-methodology-structural`) to order any issue set.

### Cross-cutting
- [ ] **Zero-config parity:** with no methodology slot, every list orders byte-for-byte as before (structural default supplies "priority + unlock value").
- [ ] `faff validate-adapters` passes; no skill shell-reads the rc file; no structural regression.

**Integration smoke test:**
```
1. Unset slots.methodology → tidy Ready, tidy On-hold, wtf Today's Focus, wtf
   value-chains, beep-boop queue order all identical to pre-change (structural
   default's pick-ordering supplies the baseline).
2. Set slots.methodology: faffter-dark-methodology-agile-delivery (high appetite) →
   a high-value/high-risk issue sequences ABOVE a higher-priority isolated cleanup,
   with NO orchestration-layer rule fighting it.
3. grep the five orchestration skills for any ordering/risk-tier/"priority is king"
   statement → only the delegation contract matches.
```

confidence: high
