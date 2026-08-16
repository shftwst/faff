# Design Spec — FAFF-811: Split multi-lens `reject-approach` routing so design-lens objections survive a plot re-slice

> Spec: faffter-dark-nlspec · 2026-08-15 · interactive · confidence: high

This is the design spec for FAFF-811, a bug fix. Its audience is the build agent that will edit `plugin/skills/faff-prep/SKILL.md` (and, if the design decision below lands the way it recommends, no CLI change at all), plus the human reviewer gating the PR. The work is a **routing-prose change in one skill file** — there is no new type, no new CLI subcommand, no new contract. The whole risk sits in getting the branching logic and its wording exactly right, so this spec is mostly WHAT-the-rule-becomes and HOW-it-branches, not architecture.

## 1. WHY — Problem and Principles

**The load-bearing model.** When spec-review rejects an approach, faff-prep routes the verdict to exactly one destination — either back to prep (re-spec in place) or out to plot (re-slice) — based on which lenses objected. Today that routing is *winner-take-all*: on a multi-lens objection, the highest-altitude lens (`methodology`, → plot) wins the whole verdict, and every other objecting lens is silently dropped on the floor. This spec changes the routing from *pick one destination* to *split the objection set by destination*: the methodology objection still drives the plot re-slice, but the design-lens objections (`architectural` / `infosec` / `QA`) are **preserved on the record** so they are not lost when plot wins the altitude tie-break.

**Problem statement.** A `reject-approach` verdict whose `objections` list includes `methodology` alongside one or more design lenses currently routes the *whole* verdict to plot ("higher altitude — plot wins"), and prep's own prose justifies discarding the rest ("no point re-speccing a slice about to be re-sliced"). Plot can only act on the scope/methodology objection — it re-slices — so the architectural, infosec, and QA objections travel to a consumer that cannot fix them and are effectively deleted. This change splits the routing so the methodology objection drives the plot re-slice while the design-lens objections are carried into the park record and re-fire when the re-sliced work is re-prepped.

**Design principle — the routing stays a deterministic function of the verdict.** The gateway fixes that `reject-approach` routing is "a deterministic function of the verdict's `objections`," with no second inference layer (`faff-prep/SKILL.md`, the routes-by-lens table). The split must remain deterministic set-partitioning over the two closed lens enums — `{methodology}` vs `{architectural, infosec, QA}` — computed directly from the `objections` array. Reject any implementation that re-reasons about the spec, re-invokes a model, or asks a lens "are you still relevant" to decide the split.

**Design principle — lost scope is forbidden.** The whole faff autonomous contract treats dropped scope as a defect, not an optimisation (the plot 5c invariant "no PRDR is silently dropped"; the premise-superseded park's cited-evidence requirement). A design-lens objection is scope: it is a named, founded defect a reviewer raised against real code-shaped work. Reject any implementation where a design-lens objection present in the verdict cannot be recovered from the record after the park.

**Design principle — plot has no structured objection intake.** `/faff-plot` re-slices from the ticket/brief and consumes parked slices through the **tracker park comment**, not through a typed objection channel. It has no field, contract, or input slot that accepts `{lens, severity}` objections and attaches them to the epics it mints. This is a hard constraint on the design decision below: any mechanism that "hands the objections to plot" would require building that intake seam first, which is out of scope here.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `plugin/skills/faff-prep/SKILL.md` → *Spec-review gate* | Markdown (skill prose) | Holds the routes-by-lens table and the multi-lens row this spec rewrites; holds the **Park causes** list a new cause is added to. |
| `plugin/skills/faff/bin/lib/contract-defs.js` → `computeSpecReviewVerdict` | JavaScript | The `spec-review-verdict` contract. Validates the verdict *shape* (`{verdict, objections:[{lens,severity}]}`) and the founded-verdict invariant only — it does **not** route. Confirms the split is a consumer-side (prep prose) change, not a contract change. |
| `plugin/skills/faff/bin/lib/spec-review-churn.js` | JavaScript | Reads the persisted `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` records (`{verdict, objections}` verbatim). The design-lens objections are already durably written here every round — reuse this, do not invent a second store. |
| `plugin/skills/faff-plot/SKILL.md` | Markdown (skill prose) | The re-slice consumer. Confirmed to have **no** structured objection intake — it reads parked slices via the tracker. Grounds the "re-fire at re-prep, don't carry into plot" decision. |
| FAFF-810 | Linear issue (not-yet-built) | The autonomous L4 plot re-entry seam. This spec must compose with it: at L4 the methodology objection may trigger `/faff-plot --autonomous` rather than a human park, and the design-lens objections must survive *that* path too. |

**Scope statement.** This sits at the spec-review gate's `reject-approach` routing step in faff-prep — the point after a conformant verdict is parsed and before prep either loops in place or parks for plot.

## 2. OUT OF SCOPE

- **The autonomous L4 plot re-entry itself (FAFF-810).** Wiring the methodology objection to `/faff-plot --autonomous` is FAFF-810's job. This spec only guarantees the design-lens objections survive *whichever* plot path the methodology objection takes (human park at L1–L3, or the autonomous seam at L4 once FAFF-810 lands). **Extension point:** the park-record write defined in HOW is the seam FAFF-810's autonomous re-slice reads the same as a human does.
- **Plot growing a typed objection-intake channel.** Attaching objections as first-class constraints on the epics plot mints would need a new plot input contract. Not built here (see the design decision). **Extension point:** a future issue would add an intake to `plugin/skills/faff-plot/SKILL.md`'s epic-create step and a carrier field on the mint.
- **Any change to the `spec-review-verdict` contract shape.** The verdict already carries the full objection list with lenses and severities; the fix is purely in how prep *consumes* it. **Extension point:** none needed — the contract is sufficient as-is.
- **The single-objection routing rows.** `architectural`/`infosec`/`QA` alone → prep revise-in-place, and `methodology` alone → plot, are both unchanged. Only the multi-lens row changes. **Extension point:** n/a.
- **Changing the loop cap, churn check, or the `revise` path.** The 2-iteration cap, `faff spec-review-churn`, and the `revise` in-place loop are untouched. **Extension point:** n/a.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Design lens | One of `architectural`, `infosec`, `QA` — the three prep-level lenses whose `reject-approach` objection is fixable by re-speccing within the current scope. |
| Methodology lens | The `methodology` lens — objects to scope/increment; its `reject-approach` is fixable only by re-slicing, which is plot's job. |
| Design-lens objection set | The subset of a verdict's `objections` whose `lens` is a design lens. May be empty. |
| Methodology objection | The (at most one meaningful) objection in the verdict whose `lens` is `methodology`. |
| Carried objections | The design-lens objection set, written verbatim into the park record so it survives the plot re-slice and re-fires at re-prep. |

**The verdict shape (existing — unchanged).** The reviewer emits, and prep parses, exactly:

```
RECORD SpecReviewVerdict:          # faff-contract:spec-review-verdict, unchanged
  verdict: "approve" | "revise" | "reject-approach" | "needs-human"
  objections: List<Objection>      # empty iff verdict == approve (founded-verdict invariant)

RECORD Objection:
  lens: "architectural" | "infosec" | "methodology" | "QA"
  severity: "blocker" | "major" | "minor"
```

**The routing input (derived, not stored).** From a conformant `reject-approach` verdict, prep derives two partitions by a pure filter over `objections`:

```
methodology_objections := [ o IN verdict.objections WHERE o.lens == "methodology" ]
design_lens_objections := [ o IN verdict.objections WHERE o.lens IN {architectural, infosec, QA} ]
```

Every objection lands in exactly one partition (the two lens sets are disjoint and exhaust the enum), so no objection is dropped by construction — this exhaustiveness is the mechanical guarantee the "lost scope is forbidden" principle rests on.

**Design decision — where do the carried objections live?**

This is the open question the issue asks prep to settle: *do the stranded design-lens objections attach to the re-sliced epics as carried constraints, or re-fire fresh when those epics are re-prepped?*

- **Option A — attach as carried constraints on the re-sliced epics.** Plot, when it mints child epics, would stamp each with the design-lens objections so the next prep treats them as pre-existing constraints. *Pro:* the objection is pinned to the exact work it constrains. *Con:* plot has **no** objection-intake seam (design principle above) — this needs a new plot input contract and a carrier field on the epic mint, both net-new build, and it couples this bug fix to a plot-side feature. It also risks stale carry: a re-slice may dissolve the very structure an architectural objection was about, so a mechanically-carried constraint could be nonsensical against the new epic.
- **Option B — preserve in the park record; re-fire fresh at re-prep.** prep writes the design-lens objections verbatim into the park comment (and the already-existing round record on disk). When the re-sliced epics come back through prep, the spec-review gate runs fresh on each — and if the design flaw genuinely persists into a child epic, *that lens objects again*, deterministically, with no carry needed. The park record's copy is the human/plot-readable audit trail proving the objections were not discarded. *Pro:* zero new seam — reuses the park comment prep already writes and the round record churn already reads; survives naturally through the re-prep the `faff-jot-intake` label already schedules; no stale-carry hazard because each child is judged on its own merits. *Con:* re-detection depends on the child epic actually re-triggering the lens; an objection about structure that the re-slice *fixed* correctly won't re-fire (which is the desired outcome, not a loss).

**Chosen:** Option B — preserve the design-lens objections in the park record, re-fire fresh at re-prep. It is strictly simpler (no new plot contract, no epic-carrier field), it honours the "plot has no structured intake" constraint instead of fighting it, and it avoids the stale-carry hazard. The lost-scope principle is satisfied by the *record*, not by a live carry: the objections are durably written where a human and `/faff-plot` both read them, and the re-prep of each re-sliced epic re-runs the same gate that raised them. Re-detection at re-prep is the correct semantics — an objection that no longer applies to the re-sliced shape *should* not re-fire.

## 4. HOW — Behavior

**Architecture and approach.** The change replaces one row of the `reject-approach` routes-by-lens table and adds one park cause. The three destinations already exist (prep revise-in-place; plot park/re-slice; needs-human park). The new multi-lens behaviour is a *composition* of two existing destinations, not a fourth: it routes the methodology objection to plot (exactly the existing methodology-alone destination) **and** attaches the design-lens objection set to that plot park's record.

**Behavior summary.** On a `reject-approach` whose objection set spans methodology and at least one design lens, prep parks for plot (as today) but the park record now carries the design-lens objections verbatim, so they survive the re-slice and re-fire when the re-sliced epics are re-prepped — instead of being discarded.

```
PROCEDURE route_reject_approach(verdict):     # verdict already conformant (exit 0)
  1. methodology := [o IN verdict.objections WHERE o.lens == "methodology"]
     design     := [o IN verdict.objections WHERE o.lens IN {architectural, infosec, QA}]

  2. IF methodology is empty AND design is non-empty:        # design lenses only
     a. → prep: re-explore + re-spec in place (bounded loop, cap 2).   # UNCHANGED

  3. IF methodology is non-empty AND design is empty:        # methodology only
     a. → plot: park + surface the slice for /faff-plot re-slice.      # UNCHANGED
        (At L4 with FAFF-810 landed, this is the /faff-plot --autonomous seam instead.)

  4. IF methodology is non-empty AND design is non-empty:    # THE FIX — multi-lens
     a. → plot: park + surface the slice for /faff-plot re-slice,
              exactly as step 3 (methodology drives the re-slice; altitude still wins
              the DESTINATION),
     b. AND carry `design` into the park record verbatim (see below), so the
              design-lens objections are preserved against the re-sliced/re-prepped
              work rather than discarded.
```

**Where the carried objections are written.**

```
PROCEDURE park_for_plot_with_carried_objections(slice, methodology, design):
  1. Park via the shared Park protocol (gateway): faff-parked label + park comment.
  2. Park cause: "spec-review reject-approach (methodology/scope) — needs /faff-plot
     re-slice; design-lens objections carried: <design lenses+severities>".
  3. The park comment body lists the carried design-lens objections verbatim
     ({lens, severity} per objection) under a labelled block, so a human reading the
     park — and /faff-plot re-slicing from it — sees the preserved objections.
  4. The round record .faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json already
     holds the FULL verdict {verdict, objections} verbatim (the churn-check input) —
     no extra write is needed there; the design-lens objections are durable on disk by
     the existing hard-floor round-record write. The park comment is the human/plot-
     readable copy.
```

**How the objections re-fire.** The re-sliced epics enter the system carrying the `faff-jot-intake` label (plot's existing epic-create path), which routes them back through prep. Each re-prepped epic runs the spec-review gate fresh. If a design flaw the original objection named persists into a given child epic, that lens objects again — deterministically, from the fresh review — and routes per the single-lens rows. No state has to travel *into* prep for this; the re-fire is a property of re-running the same gate on the re-sliced work. The carried record exists so the flaw is not *silently* lost if the re-slice happens to preserve it in a form the fresh review under-weights — a human reading the park sees the prior objections.

**Edge cases and error handling.**

- **Methodology objection present, design set empty** — the pre-existing methodology-alone row; behaviour byte-unchanged (no carry block, original park cause).
- **Design set present, methodology empty** — the pre-existing design-only row; prep revise-in-place, unchanged. No park, no carry.
- **A malformed/absent verdict block, exit 1, or exit 2** — handled *upstream* of this routing by the existing consumer-fold (→ needs-human park). This procedure only ever runs on a conformant (exit 0) `reject-approach`, so the partitions are always over validated `{lens, severity}` entries.
- **The founded-verdict invariant** guarantees a `reject-approach` carries ≥1 objection, so at least one partition is non-empty; the "both empty" case is unreachable and needs no branch.
- **Loop-cap / churn interaction (unchanged).** A multi-lens reject routes to plot (park), which is *not* a prep-in-place loop iteration — so it neither consumes a loop-cap iteration nor feeds the churn check (churn only guards the prep↔review in-place loop). The carry does not change this.

**Failure modes.**

- **The failure:** re-detection at re-prep is weaker than a carried constraint — a design flaw that survives the re-slice but is *reshaped* enough that the fresh review under-weights it could slip through, where a mechanically-carried objection would have forced attention. **How you'd know:** a re-sliced epic ships with a defect matching a design-lens objection recorded in its parent's park comment. **What it means:** proceed — the park comment is the mitigation (the objection is on the record for a human/plot to act on), and the alternative (Option A's live carry) has the *worse* failure of stale/nonsensical carried constraints against a re-sliced structure. This is the accepted narrow gap of the simpler mechanism, named here deliberately.
- **The failure:** the carried-objections block in the park comment is treated as noise and dropped by a downstream surfacer. **How you'd know:** `/faff-wtf`'s parked-work section shows the plot re-slice park without the design lenses. **What it means:** narrow — the cause string itself carries the lens list (step 2 above), so even a body-only summariser keeps the signal; verify the cause string, not just the body block, survives to `/faff-wtf`.

**Anti-pattern:** re-inferring which objections are "still relevant" before carrying them. Why: the split must be a pure filter over the two closed lens sets; any relevance judgement re-imports the second inference layer the gateway forbids and makes the routing non-deterministic.

**Anti-pattern:** building a plot-side objection-intake to hand the carried objections to the re-slice. Why: that is Option A (rejected) and out of scope; it couples this bug fix to a net-new plot feature and risks stale carry against a dissolved structure.

**Anti-pattern:** writing a *new* on-disk store for the carried objections. Why: the round record already persists the full verdict verbatim; a second store is duplicate state that can drift.

## 5. SCENARIOS — born-verifiable main objectives

> 1 holdout scenario(s) withheld from this view — evaluated code-blind against the running feature; full spec on the tracker.

```
Given a conformant spec-review reject-approach verdict whose objections are
      [{methodology, blocker}, {architectural, major}, {infosec, major}]
When faff-prep routes the verdict
Then the slice is parked for /faff-plot re-slice (methodology drives the destination)
 And the park record carries the architectural and infosec objections verbatim
 And no objection from the verdict is absent from the park record
```

```
Given a conformant reject-approach verdict whose only objection is {methodology, blocker}
When faff-prep routes the verdict
Then the slice is parked for /faff-plot re-slice with the original methodology-alone
     park cause and no carried-objections block
     (single-methodology behaviour is unchanged)
```

```
Given a re-sliced epic minted by /faff-plot from a slice parked with a carried
      architectural objection, whose design still exhibits that architectural flaw
When the epic is re-prepped and the spec-review gate runs fresh
Then the architectural lens objects again on the re-prepped epic
     (re-fire at re-prep, no live carry required)
```

- The multi-lens routing MUST remain a deterministic function of `verdict.objections` — a pure partition over `{methodology}` vs `{architectural, infosec, QA}`, with no model re-invocation or relevance re-inference.

## 6. DESIGN DECISION RATIONALE

**Do the design-lens objections attach to the re-sliced epics as carried constraints, or re-fire fresh at re-prep?**
- *Option A — carried constraints on the epics:* pins the objection to its work, but requires a net-new plot objection-intake seam and a carrier field (plot has none today), couples the bug fix to a plot feature, and risks stale carry against a structure the re-slice may have dissolved.
- *Option B — preserve in the park record, re-fire at re-prep:* reuses the park comment and the existing round record; survives through the re-prep the `faff-jot-intake` label already schedules; no new seam; no stale-carry hazard.
- **Chosen:** Option B — simplest mechanism that satisfies "lost scope is forbidden" (via the durable record) without fighting the "plot has no structured intake" constraint. At the time of writing, `/faff-plot` consumes parked slices only through the tracker park comment; if a future issue gives plot a typed objection intake, Option A becomes cheap and this decision should be revisited.

**Is this a contract change or a prose change?**
- *Contract change:* would add a field/route to `spec-review-verdict`. But the verdict already carries the full objection list; `computeSpecReviewVerdict` validates shape only and does not route.
- **Chosen:** prose change in `faff-prep/SKILL.md` only — rewrite the multi-lens routing row and add one park cause. No CLI or contract edit. The routing has always lived in prep's consumer-fold prose, so that is where the split belongs.

**Does the fix add a fourth routing destination?**
- *New destination:* a "multi-lens" route distinct from prep/plot/needs-human.
- **Chosen:** no — the multi-lens case *composes* the existing plot destination (methodology drives it) with a carry of the design-lens set onto that same park's record. Fewer moving parts; the destination table stays three-valued.

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions:** none. The issue's open question (carry vs re-fire) is closed as **Chosen:** Option B above.

**Assumptions:**
- **Assumes:** the round record `.faff/runs/<run-id>/ISSUE-XX/spec-review/round-<n>.json` is written verbatim (`{verdict, objections}`) on every conformant round, as a hard-floor write independent of `logging: essential`. *Validation:* confirm in `faff-prep/SKILL.md` Loop-cap paragraph (states the verbatim hard-floor write) and that `spec-review-churn.js` reads exactly this shape.
- **Assumes:** `/faff-plot`'s epic-create path labels minted epics `faff-jot-intake`, routing them back through prep. *Validation:* confirm in `faff-plot/SKILL.md` Create step (`faff label add <issue> faff-jot-intake` on each created epic).
- **Assumes:** at L4, FAFF-810's autonomous plot re-entry (when built) reads the same park record a human does. *Validation:* this spec's park-record write is the seam; FAFF-810 consumes it. No cross-ticket build coupling in *this* ticket — the carry is written regardless of which plot path (human or autonomous) picks it up.

## 8. DONE — Definition of Done

### From WHY
- [ ] A `reject-approach` verdict with a methodology objection AND ≥1 design-lens objection no longer discards the design-lens objections; they appear in the park record.

### From WHAT (routing input)
- [ ] The multi-lens routing partitions `objections` by a pure filter: `{methodology}` vs `{architectural, infosec, QA}`, with every objection in exactly one partition.
- [ ] No relevance re-inference or model re-invocation is introduced in the routing step.

### From HOW (behaviour)
- [ ] Multi-lens (methodology + ≥1 design) → parks for `/faff-plot` re-slice (methodology drives the destination), unchanged from the methodology-alone destination.
- [ ] The multi-lens park record carries the design-lens objection set verbatim (`{lens, severity}` per objection) in the park comment.
- [ ] A new park cause string names the carried design lenses (e.g. `…design-lens objections carried: <lenses+severities>`), added to the **Park causes** list in `faff-prep/SKILL.md`.
- [ ] No new on-disk store is added — the durable copy reuses the existing round record; the park comment is the human/plot-readable copy.

### From HOW (unchanged rows — regression guard)
- [ ] Design-lens-only `reject-approach` still revises in place (no park, no carry).
- [ ] Methodology-only `reject-approach` still parks for plot with its original cause and no carry block.
- [ ] The loop cap, churn check, and `revise` path are untouched by the change.

### From SCENARIOS
- [ ] The four scenarios above are expressible as tests against the routing prose / any routing helper, and the holdout scenario (design-lens-only revise-in-place) passes.

**Integration smoke test:**
```
1. Construct a conformant reject-approach verdict:
   objections = [{methodology, blocker}, {architectural, major}]
2. Drive faff-prep's reject-approach routing on it.
3. Assert: outcome == park-for-plot
   AND park cause names the carried architectural objection
   AND the architectural objection {lens:"architectural", severity:"major"} is present
       verbatim in the park record
   AND the methodology objection routed the destination (park-for-plot, not revise-in-place).
```

confidence: high
