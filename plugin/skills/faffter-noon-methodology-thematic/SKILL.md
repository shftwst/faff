---
name: faffter-noon-methodology-thematic
description: "Default `methodology` lens (`thematic`) — opinion-free analysis that reflects the tracker topology: ordering by unlock value, gating on decision closure, composing the shared structural/topology floor (cycle + ghost-project detection). The zero-config baseline every pass uses. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: ordering
---

# faffter-noon-methodology-thematic

The default methodology, the **thematic** lens — opinion-free: it reflects what the tracker topology already says, with no outcome opinion. Ordering by unlock value, gating on decision closure, surfacing graph-level problems, and floating the highest-leverage work first. No opinionated delivery philosophy, no principle-based diagnosis. Just: what does the graph say?

The cycle + ghost-project graph floor is **not** owned here — it is the methodology-agnostic **structural (topology) floor** (gateway → **The `methodology` slot** → the structural/topology floor), which this lens *composes* exactly as the agile lens does. "structural" names the tracker topology / dependency graph, never this lens.

This is what runs when no other methodology is configured. It's extracted here so it can be referenced, tested, and eventually swapped.

```yaml
slots:
  methodology: faffter-noon-methodology-thematic   # the default — explicit for clarity
```

## Core ordering rule

**Priority (issue-level OR inherited from any ancestor) → chainable unlock value (count of direct + transitive dependents, over live blocker edges only — gateway → *Satisfied blockers — edges to terminal work*).**

When two issues have equal priority, the one that unlocks more downstream work goes first. When both are equal, creation order breaks the tie (oldest first — fairness over recency). Every output below that sequences work uses this rule.

## Outputs

Each output is a named capability a caller requests by name. This skill does not know or describe its callers — it answers the request from the graph. The answer is always graph-derived, never opinion-derived. The canonical set of named outputs (which are required, which caller requests each, the standard envelope) is fixed in the gateway → **The `methodology` slot**; the sections below are this skill's implementation of that contract.

It does **not** answer the optional `issue-critique` output — per-issue right-sizing/workstream/risk critique is an opinionated lens, and this default is pure structure. Unanswered is contract-valid: `/faff-prep` simply omits the `## Methodology critique` block (the agile lens is the one that fills it).

### `pick-ordering`

Order a set of issues by the core ordering rule. Issues gating the longest chains rise to the top. Unlock value counts live blocker edges only (gateway → **Satisfied blockers — edges to terminal work**) — a satisfied edge adds no downstream count.

**Optional `prd-distance` composition.** When the caller supplies the `prd-distance` map (an L4 drain under a resolved target PRD — gateway → **Standard envelope → Optional input `prd-distance`**), compose it as a **within-band** tiebreaker on top of the core ordering rule, never a replacement:

1. Partition the ordered set into contiguous **human-priority bands** (the existing priority tier — floor rule (a): distance never crosses a band).
2. **Within each band**, stable-sort by the issue's PRD-completion distance: `rank = min class_rank` of `prd-distance` entries whose `container` slug-matches the issue's container. **No match, or `rank == 0` (met) → neutral** — keep the issue's existing relative position (the core-rule order). Lower rank (nearer the parent PRD) orders sooner.
3. **Never** move an issue across a band boundary.

Distance is the primary key across classes within a band; the core ordering rule (unlock value, then creation order) is the deterministic tiebreak within a class. Because step 2 is a stable sort that leaves unmatched/`met` issues in place, **input absent ⇒ byte-identical output** (floor rule (b)) — with no map the composition never runs.

### `promotion-readiness`

**Promote** an issue (mark ready) when ALL hold:
1. Blockers clear (all declared blockers are Done)
2. Concrete deliverable (not vague, not "investigate")
3. Real spec exists (tracker comment or `docs/specs/` — never description alone)
4. No unresolved architectural questions (no open `**Punt:**` markers that would block build)
5. No false `**Assumes:**` entries (the assumption actually holds in current state)

**Demote** when:
- Repeat-parked: 3+ parks with same root-cause class in 21 days → demote to Backlog, tag `faff-repeat-parked` via the sanctioned op (`faff label add`)
- Challenged spec: post-spec comment raises unresolved challenge → back to needs-prep
- Stale spec: codebase drift invalidates approach → back to needs-refresh

### `ticket-shaping`

Turn a **discovery brief** (the `intake` slot's output — see `faffter-noon-intake`) into a structured set of proposed tickets. Requested by `/faff-jot` after the intake conversation; the orchestrator creates the tickets this output proposes. This output **proposes** structure — it never writes to the tracker itself (that's the orchestrator lane).

The thematic lens shapes purely from what the brief states plus the live tracker graph — no opinion about value or right-sizing (that's what an opinionated methodology like `faffter-dark-methodology-agile-delivery` adds on top):

- **greenfield brief** — one workstream/container candidate per stated capability (named after the capability, verbatim — the thematic lens does not rename); within each, the first tickets needed to reach the brief's `First slice`. Sequence the workstreams and the tickets by the core ordering rule (priority — none yet, so creation/sequence order — then unlock value derived from the stated `Dependencies`). Emit a top-level container proposal when the tracker supports one (initiative/project) and the brief spans multiple capabilities.
- **single-item brief** — one ticket from the `Item`, placed in the workstream named by `area`. If `split-sense: possibly-splittable`, propose the two tickets named after the two concerns and link them per the stated relationship; if `unitary`, one ticket. Never force a split the brief didn't flag.

For every proposed ticket emit: title (from the capability/item, plain English — no invented codes), a description seeded from the relevant brief prose, the container/workstream it belongs under, declared blocker/blocked-by links derived from the brief's `Dependencies`, and a `Backlog` status. Carry the brief's `Open questions` onto the relevant ticket's description so `/faff-prep` picks them up. Tag created tickets `faff-jot-intake` so the next prep pass recognises freshly-shaped work.

**Recursive mode (`shape-level` supplied by `/faff-plot`).** When the request carries a `shape-level` (`initiative` / `project` / `epic`), shape only *that altitude's children* of the node-scoped sub-brief — not a full flat set. `/faff-plot` drives the descent and owns the stop rule; this output shapes one level per call:

- `initiative` — one initiative container per top-level outcome/capability group the brief names. Literal, verbatim names; no value opinion.
- `project` — given one initiative's slice of the brief, the projects (workstreams) under it.
- `epic` — given one project's slice, its **first-slice epics only** — the issues needed to reach that project's first usable slice — with `Dependencies`-derived blocker/blocked-by links. Do **not** enumerate the leaves below them.

Emit nothing for a branch the sub-brief can't concretely derive — surface "needs more discovery" so plot stops that branch. Same `faff-jot-intake` tag, `Backlog` status, and brief-seeded descriptions as the single-level output. Absent a `shape-level`, the single-level brief→tickets behaviour above is unchanged (this is what `/faff-jot` uses).

Conservative, same as every thematic output: when the brief is too thin to derive a defensible structure, propose fewer, larger tickets and surface what's missing rather than manufacturing speculative ones — the human (or a later `/faff-prep`) refines.

### `backlog-diagnostics`

Detects problems with the **shape of the backlog itself** — dep cycles, ghost-project pointers, repeat-park patterns, splittable specs, chain gaps. This output always fires regardless of config: it is the baseline every faff pass depends on. Callers consume it directly (rendering it in a brief) or feed its cycle + ghost-project findings into the gateway's automation-routing contract.

**Cycle + ghost-project detection is the shared structural (topology) floor, composed not owned.** Those two categories are the methodology-agnostic graph floor homed in the gateway (gateway → **The `methodology` slot** → the structural/topology floor); the thematic lens *composes* it exactly as the agile lens does — the detection tables below document the floor's categories. The remaining categories (**repeat-park patterns**, **splittable specs**, **chain gaps**, **orphaned + repeat-parked**) are the thematic lens's own. Detection semantics, mechanical fixes, conservatism, and rendered form are identical to before this homing — pure relocation, no behavioural change.

#### Detection categories

| Category | What | How |
|---|---|---|
| **Dependency cycles** | Blocker graph cycle of any length (A→B→A; A→B→C→A; longer) | Tarjan / DFS-with-coloring pass over the full active-issue blocker graph. Cancelled/archived already filtered per the **Ignore cancelled and archived** rule. |
| **Ghost-project pointers** | An issue spec or description names a tracker container (project, initiative, milestone — whatever the tracker calls it) that does not exist | String-match against the live container list from the tracker MCP |
| **Repeat-park patterns** | Active issue parked repeatedly in the same root-cause class within the rolling window (the seam's `window_days` / `threshold`) | Call the deterministic seam — `faff park-history --now <currentDate>` (resolve the `faff` executable per the gateway's *Resolving the `faff` executable* rule, never a hardcoded path; pass the **system `currentDate`** as the window end — the seam has no ambient clock and exits 2 without `--now`). Consume its JSON: `repeat_parked` is the sorted set of issue ids at/over threshold (the finding), and `counts` gives the per-issue / per-class breakdown. The rolling **window and threshold are owned by the seam** (`window_days` / `threshold` in its output) — not re-derived or restated here. Root-cause classification is the shared taxonomy fixed in the gateway's automation-routing contract; the `routing_adaptor` slot, default `faffidavit-routing`, assigns against it. The seam fail-louds (exit 2) on a missing/unparseable `--now` or a malformed parks block — do not paper over it with a prose fallback. |
| **Splittable specs** | Spec describes two structurally independent concerns AND each concern is a valid ticket-sized unit | LLM inspection — restricted to specs already flagged stale/challenged by existing tidy logic (don't sweep every spec every run) |
| **Chain gaps** | Any active ticket whose spec's implementation advice references work no ticket tracks — the chain from current state to fulfilling the spec's purpose is broken because some piece of the implied work has no ticket to carry it. Four sub-types: **sub-ticket gap** (umbrella's spec enumerates multiple remaining deliverables — multi-PR, multi-phase, numbered steps — but no Todo / In Progress / In Review sub-ticket exists for the next deliverable; `/faff-graft` has nothing to pick up to advance the umbrella); **upstream gap** (spec names a prerequisite — "blocked by X", "needs Y first", "assumes Z has shipped" — that has no ticket); **downstream gap** (spec names follow-up work — "subsequent PR will...", "leaves W for later", "after this, wire up V" — that has no ticket); **peer gap** (spec implementation advice describes parallel work that must also happen for the change to be useful — consumer wire-up, integration changes, related refactor — that has no ticket). | (1) Active ticket (Todo / In Progress / In Review) with a discoverable spec. (2) Parse the spec's implementation-advice section(s) for: multi-deliverable enumeration markers ("PR 1 / PR 2", "PR A / PR B", "Phase 1 / Phase 2", "Step N of M", "follow-up PR", numbered/bulleted lists with PR-shaped action verbs — sub-ticket gap); upstream-dependency phrases ("blocked by", "needs X first", "assumes Y has shipped", "depends on Z", "prerequisite" — upstream gap); follow-up phrases ("subsequent PR", "follow-up ticket", "leaves W for later", "after this", "next phase" — downstream gap); parallel-work phrases ("consumer-side changes in X", "also needs Y in the same workstream", "integration changes in service Z", "related refactor" — peer gap). (3) For each referenced work unit, search the active-ticket graph for a match: sub-ticket of this ticket (sub-ticket gap); tracked blocker / upstream ticket whose title/description matches the prereq (upstream gap); follow-up ticket linked via "blocks" or whose title matches (downstream gap); sibling/peer ticket in the same workstream matching the description (peer gap). (4) If no match → chain gap. (5) For sub-ticket gaps additionally check: count enumerated deliverables `E`, count `C` = (sub-tickets in any state) + (merged PRs directly referencing the parent ID); flag when `E > C` AND no sub-ticket is in Todo / In Progress / In Review. Conservative: skip when the spec is unitary, when the referenced work is in scope for the current PR, when the reference is illustrative rather than load-bearing, when the spec explicitly disclaims ("future work — not ticketed by design"), and when an actionable next-step ticket already exists. |
| **Orphaned + repeat-parked** | Cross-reference of existing orphaned-by-cascade detection with repeat-park | Set intersection of the two finding sets |

Detection is conservative. False positives in this phase are expensive — the human gets a recommendation that's wrong and has to override. **When in doubt, don't flag.**

#### Mechanical fixes (auto-applied per appetite — see Appetite integration)

| Detection | Mechanical fix |
|---|---|
| Cycle where one edge is defensive-not-load-bearing (the spec for A doesn't actually reference B's output) | Strip the defensive edge. Log the cycle, the stripped edge, the reasoning. |
| Ghost-project pointer where the named container **clearly maps** to an existing container by name proximity (e.g. spec says "logging-cleanup project", tracker has "Logging cleanup") | Repoint the issue to the existing container. Log the move. |
| Repeat-park (issue in the seam's `repeat_parked` set), issue still in Todo | Demote to Backlog, tag with `faff-repeat-parked` via the sanctioned op. Log the demotion. The issue is clearly not Todo-ready; leaving it as Todo lies to the queue. The qualifying set is the seam's `repeat_parked` output (above), not a re-count — only the *source* of the set is the seam; the demote behaviour, tag, and appetite-gating are unchanged. |

Three detection categories never auto-apply mechanically (one of them, chain gaps, *does* auto-ticket at higher appetite; see below):

- **Splittable specs** — surface only: report the spec with the two independent concerns the diagnostic identified and recommend splitting it into separate tickets. faff has **no auto-split command** — splitting a spec is a human judgement call (re-prep, or file separate tickets manually). Autonomous: log only.
- **Chain gaps** — *surface mode:* report each gap with the active ticket, sub-type (sub-ticket / upstream / downstream / peer), the referenced work, what's already covered (sub-ticket gaps only — sub-tickets + merged PRs by direct ref), the un-ticketed remainder, and the recommended action: for sub-ticket gaps offer to file the missing sub-ticket(s) under the parent; for upstream / downstream / peer offer "file gap issue" (create the missing ticket with the appropriate relationship — blocker for upstream, blocked-by for downstream, sibling-in-workstream for peer). *Auto-create mode (`high`+ appetite by default — an opinionated methodology lowers the threshold to `medium`+):* **auto-create the missing ticket(s) per sub-type** — sub-ticket gaps: one Backlog sub-ticket per un-ticketed deliverable, parent set to the umbrella; upstream gaps: one Backlog ticket for the prerequisite + add a blocker link from the active ticket to it; downstream gaps: one Backlog ticket for the follow-up + link "blocked-by" the active ticket; peer gaps: one Backlog ticket for the parallel work in the same workstream/parent. All created tickets: title from the spec reference line, description = the referenced prose + back-link to the source ticket, status `Backlog`, tag `faff-chain-gap-fill` so `/faff-prep`'s next queue pass picks them up. Log every created ticket with id, sub-type, source spec line, and the relationship target (parent / blocker / blocked-by / sibling). Skip auto-create and downgrade to surface-only when the reference is ambiguous (no clear deliverable per line, no nameable target for the relationship, prose-y rather than action-verb-led) — phantom tickets are expensive to clean up.
- **Orphaned-by-cascade + repeat-parked** — surface only. Cancelling is destructive; always human.

#### Output

Render a `### Structural diagnostics` section when any finding exists. Format follows the configured `rendering_adaptor` slot — cycles use the cycle bracket (≤3 edges) or cycle box (4+ edges) form. Example:

```
### Structural diagnostics

Cycles (1)
  [ISSUE-AA → ISSUE-BB → ISSUE-CC → ISSUE-AA]
  ISSUE-AA  Onboarding redirect — needs session state from BB
  ISSUE-BB  Auth refresh — needs profile data from CC
  ISSUE-CC  Profile init — claims to need redirect path from AA, but spec doesn't reference it
  Recommendation: strip the CC→AA edge (defensive-only). Auto-applied in this run.

Ghost-project pointers (1)
  ISSUE-XX names "Audit lite" project — no such project exists in tracker.
  Closest match: "Audit lite reliability" (live, 4 issues). Repointed in this run.

Repeat-parks (2) ⚠
  ISSUE-VV  Storage migration — parked 4 times, all on "schema versioning Punt" (same root cause).
            Demoted to Backlog. Resolve the Punt via /faff-prep --refresh and re-promote.
  ISSUE-WW  Webhook retry — parked 3 times on "billing-events gap" (same root cause).
            Demoted to Backlog. Decide whether the dep is real; file the gap issue or descope.

Splittable specs (1) — surfaced only, not auto-split
  ISSUE-YY  Settings page rewrite — spec covers (a) URL routing changes and
            (b) form-state refactor. The two have no overlapping files and could
            ship independently. Split into separate tickets to break them out.

Chain gaps (4) ⚠ — surfaced only in surface mode, auto-ticketed at medium+ appetite
  ISSUE-AA  Mastra audit pipeline lift — umbrella, In Progress.
            Sub-ticket gap: spec enumerates 8 deliverables (PR 1–2 shipped via
            #243/#244, PR 3 carved out as ISSUE-BB and shipped). 5 un-ticketed:
            consumer wire-up (audit-pipeline-background.ts), 3 per-stage lifts
            (captureScreenshot/extractColors/generatePalette), default flip.
            No Todo or In Progress sub-ticket exists — /faff-graft has nothing
            to pick up next. Recommendation: file the remaining 5 as
            sub-tickets under the umbrella.
  ISSUE-CC  Profile init refresh — Todo.
            Upstream gap: spec assumes "auth refresh has shipped" prereq, but no
            ticket exists for that work. Recommendation: file the prerequisite +
            add blocker link CC → new-prereq.
  ISSUE-DD  Settings page rewrite — In Progress.
            Downstream gap: spec ends "subsequent PR will migrate the legacy
            /settings/* redirects" — no follow-up ticket exists.
            Recommendation: file the follow-up + link blocked-by ISSUE-DD.
  ISSUE-EE  Stripe webhook retry — Todo.
            Peer gap: spec implementation advice references "consumer-side changes
            needed in billing-events service" — no peer ticket in the same
            workstream. Recommendation: file the peer ticket + tag the workstream.

Orphaned + repeat-parked (1) ⚠
  ISSUE-ZZ  Old auth fallback — parent project cancelled 6 weeks ago,
            issue parked 3 times since. Is this still wanted?
```

The cycle + ghost-project findings feed the **automation-routing contract** (fixed in the gateway; the `routing_adaptor` slot, default `faffidavit-routing`, assigns the verdict): an issue in a detected cycle gets `circular-blocked`; an issue with a ghost-project pointer gets `gap-blocked`.

### `standup-digest`

Surface, in order:
1. **Recently shipped** — completed in last 24-48h + what each just unblocked. Float newly-unblocked issues to the top of recommendations.
2. **Today's focus** — top N ready issues by `pick-ordering`. Recommend the one that unlocks the most downstream value (live edges only — gateway → **Satisfied blockers — edges to terminal work**).
3. **Heads up** — structural problems that would bite today: repeat-parks, chain gaps (with sub-type), orphaned+repeat-parked, approaching deadlines.
4. **Queues** — build queue + prep queue counts.

Render: every issue gets tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. Tables for queue summaries, prose for focus. Concise — a brief, not a report.

### `horizon-assignment`

Assign each issue a horizon from tracker state:
- **Now** — In Progress or actively being built
- **Next** — Todo, blockers clear or nearly clear, spec exists
- **Later** — Backlog, or blocked by Now/Next work (live edges only — a satisfied edge, gateway → **Satisfied blockers — edges to terminal work**, does not count as blocked)

Sequence within each horizon by `pick-ordering`. Surface structural diagnostics relevant to roadmaps: ghost-project pointers, structural gaps (initiative has no Next project), unfireable trigger gates, stalled Now projects (In Progress, no commits 14+ days), parked issues with unmet unpark conditions. Emit an ASCII chain diagram (initiative → project → issue) with structural gaps marked inline.

### `build-queue`

**Admission:** the two build-ready verdicts enter; every other routing verdict routes out (canonical semantics: `faff contract automation-routing --describe`).

**Ordering:** `pick-ordering` — including its optional **`prd-distance`** within-band composition when the caller supplies the map under a resolved target PRD: the queue heads for the sibling PRDR nearest a `met` DoD, within human-priority bands and byte-identical when absent. Independents ordered directly; collision groups serialised within (lead issue determines group position). Admission and serialisation read live blocker edges only — a satisfied edge (gateway → **Satisfied blockers — edges to terminal work**) never triggers serialisation.

**Conflict analysis:** partition the admitted set into independents (parallel-safe) and collision groups (serialised within the group, parallel across groups) per the canonical heuristics — see `faff-beep-boop` → **Conflict analysis**. Single home: do **not** recap the heuristics here.

**Wave structure:** After each wave drains, re-check for newly unlocked work, narrow-prep unblocked candidates, re-assemble the queue. Continue until drained or budget hit.

### `run-termination-policy`

**Optional** (gateway → **The `methodology` slot**). The thematic answer to "in what order do the **policy-weighted** terminating rungs win" — the weighting behind the run-end decision `faff run-done` composes. The thematic lens orders from **graph/process facts, never value/risk opinion**, so its ladder is exactly the CLI's built-in `structural-default` policy ladder (the fixed `policy_source` enum — this output *is* that default, made explicit):

```
1. non-convergence  → escalate      # no-progress waves need a human, not more spend
2. budget-narrow    → continue       # a narrow ceiling triggers the narrow-loop, not a stop
3. budget-stop      → run-complete    # a stop ceiling ends cleanly (a ceiling, not a failure)
4. value-inflection → run-complete    # an explicit MVP/value inflection stops early
5. work-remaining   → continue        # admissible work remains → keep going
6. clean-complete   → run-complete    # queue drained / all parked → drained | all-parked
```

- **Floor is not ours.** The fixed safety floor (`budget-escalate`, `undispatched-ledger` at drain, `product-incomplete`) is the CLI's, applied **before** this ladder and **never** overridable — this output only orders the rungs **above** it. Reordering or softening a non-floor rung is the lens's prerogative; weakening the floor is impossible by construction.
- **Unanswered ⇒ no change.** When this output is not requested/answered, `faff run-done` applies the same ladder as its built-in default — so zero-config runs behave identically.

**Output:** an ordered ladder of `{test, verdict}` rungs over the closed test vocabulary above, passed by the orchestrator to `faff run-done --policy`. Read-only — the methodology authors the ladder; it never decides the run-end (that is `faff run-done`, purely) and never writes the tracker.

### `crank-up-set`

**Optional** (gateway → **The `methodology` slot**). Given the **not-automation-eligible** issue set + the dependency graph + each member's `faff next --if-eligible` hypothetical transition + appetite, return ranked **crank-up-sets** — coherent batches a human can approve in one go. Unanswered ⇒ wtf/tidy fall back to the flat On-hold list. Read-only: never mutates eligibility.

**Slice algorithm:**

1. **Roots.** Filter the not-eligible set to issues with ≥1 not-eligible dependent (downstream runway), ranked by the core ordering rule (priority → chainable unlock value). Apply a **min unlock-value threshold ≥2** (mirrors the value-chains render gate) — a lone not-eligible leaf (unlocks 0) is omitted in favour of a root with runway.
2. **Depth.** Walk transitive dependents in dependency order; admit a dependent `D` into the slice **iff** `D` is not-eligible **and** all `D`'s blockers are already in the slice (no outside blocker; a satisfied blocker — gateway → **Satisfied blockers — edges to terminal work** — is neither in the slice nor an outside blocker, so it never excludes `D`).
3. **Stop per branch at the first frontier:** (a) **branch point** — `D` has an outside (non-slice) blocker → exclude, mark `"fans out — separate proposal"`; (b) **risk spike** — `D`'s reversibility tier flips to higher-risk; (c) **value plateau** — `D` unlocks 0 **and** is not spec-ready.
4. **Annotate.** Each member carries its `faff next --if-eligible` badge (would-build / would-need-prep / would-still-need-decision); each set carries a one-line **hypothetical-verdict distribution** (e.g. "2 would-build, 1 would-need-prep") + any deferred-with-reason members.
5. **Shared member.** When a member sits in two roots' slices, the **highest-priority root claims it**; the other marks it `"shared with <root>"` (deterministic; avoids double-cranking in render).

**Output:** a ranked list of `{root, ordered slice-members, stop-reason, hypothetical-verdict distribution, prep-needed members, deferred notes}`.

**Appetite** tunes depth (low = solo safe roots; medium/high = multi-member slices; full = deepest runway) — it never cranks up (that is `/faff-tidy`'s human-gated batch crank-up).

### `prdr-author`

**Optional** (gateway → **The `methodology` slot**). Given a container (initiative/project) + its `{outcome, child_specs, target}`, author one **`AuthoredPrdr`** — a loop-authored PRDR record (provenance `loop`, status `Proposed`). The thematic lens authors from **graph + container facts**, never value/risk opinion: the DoD is the **graph completion bar** (every child epic delivered + the container outcome's stated criteria met), scaled by target.

**Derivation (graph + container facts only):**

1. **Resolve the target** — `explicit > inherited > methodology-default`; the methodology-default is **finished** when unset. The target sets the DoD's ambition band.
2. **Re-read first (manual-authoritative).** Read the container's current DoD and any human edits **before** authoring; **never clobber** a human-set DoD — fill/default only the unset parts (gateway → **Manual changes are authoritative (`prdr-author`)**).
3. **Author the fields** from `{outcome, child_specs}`, scaled to the target:
   - `definition_of_done` — **thin-MVP** target ⇒ the first-slice children + the outcome's minimal criterion; **finished** target ⇒ all children delivered + the outcome's full stated criteria. Structural, child-derived — no value judgement about *which* children matter.
   - `decision` + `scope` — the delegated end this container commits to, named from the outcome prose; scope = the container's child set.
   - `prd_goals` — **cite every declared PRD goal the DoD covers** (the full comma-separated set, from the container's PRD link / ancestor), not just a single ancestor goal. Under-citing a functional MVP that discharges several declared goals is what the YAGNI gate mis-reads as over-scope.
4. **Confidence + fail-safe.** Thin outcome prose / no child specs ⇒ low confidence ⇒ emit a **thin DoD flagged needs-human**, never a vacuous one (the L4 caller must never self-define a vacuous DoD).
5. **Emit** the `AuthoredPrdr` and write it via `faff prdr new --provenance loop --status Proposed --container <c> --prd-goal <g1,g2,…>` (the comma-separated cited set → the record's `PRD-goals:` field). The methodology **authors but never admits** — it does **not** call `faff prdr admit`, and **never writes the tracker**; the caller routes per its level (gateway → **Authored-PRDR level-scaling**).

**Output:** `AuthoredPrdr {decision, definition_of_done, container, prd_goal, provenance: "loop", status: "Proposed"}` + a confidence note. Unanswered-equivalent (no container, or `--no-prdr`) ⇒ the caller proposes no PRDR and the human authors the DoD directly.

**Appetite** tunes only ambition framing, never whether to admit (admission is the caller's level): lower appetite favours the thinner end of the target band, higher the fuller — it never self-Accepts (that is the L4 runner's gated act, or the human's L3 ratification).

### `yagni-judge`

**Optional** (gateway → **The `methodology` slot**; this is **Phase 1** of the upper-gate two-phase arbitration — gateway → **Upper-gate (YAGNI) two-phase arbitration**). Given an `AuthoredPrdr` + the PRD (+ optional grounding), propose whether the PRDR is **warranted** — serves a real PRD goal **without exceeding it**. The thematic lens judges from **graph + PRD facts**, never value/risk opinion:

- `serves_goal` — does the PRDR's `prd_goal` name a real PRD goal *and* does its `decision`/`definition_of_done` materially advance that goal (not merely cite it)? Graph/text trace, not taste.
- `within_scope` — does the DoD cover **only declared PRD goals** (`V ⊆ D`), or does it add capability the PRD never asked for (structural over-reach)? Covering *several* declared goals in one functional MVP is in-scope, not gold-plating; only capability outside the declared goal set is over-reach. Grounding, when present, sharpens this (domain norms) but is never required.
- `verdict` — `admit` when both hold; `reject` otherwise, with a one-line `reason`.

**Output:** `{serves_goal, within_scope, verdict: admit|reject, reason}` — the Phase-1 proposal the caller passes to `faff prdr yagni --proposal …`. It **proposes, never admits** (admission is `faff prdr admit`), the adversarial-review slot challenges it in Phase 2, and it **never writes the tracker**. Unanswered ⇒ the upper gate has no proposal (the caller falls back to the `faff prdr admit` gate's fail-safe upper default — conservative reject).

**Appetite** tunes only the strictness of `within_scope` (lower = permissive, higher = tighter), never whether to admit — the conservative-reject-on-doubt arbitration is the CLI's.

### `rehome-set`

**Optional** (gateway → **The `methodology` slot**). Proposing outcome-led project homes for loose Backlog work requires an **outcome** judgement — which shippable outcome a set of loose tickets converges on — and this lens is opinion-free by design: it groups by where work *sits* in the graph, never by the value-outcome it delivers. So the thematic default's legitimate answer is an **empty rehome-set**: no proposed containers, no membership map, no coherence edges, no leave-loose reasoning. This is an answer, not a gap — outcome-led formation is exactly the opinion an opinionated lens (`faffter-dark-methodology-agile-delivery`) adds on top.

**Empty/unanswered ⇒ the caller reports no grouping opinion and writes nothing** (zero-config unchanged).

## Appetite integration

The thematic lens respects appetite but has limited agency by design:

| | low | medium | high (default) | full |
|---|---|---|---|---|
| Diagnostics | Surface only | Surface + auto-demote repeat-parks | Surface + auto-demote + chain-gap auto-create | Surface + act on all (auto-create, auto-demote, report splittables) |
| Ordering | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides |
| Spec format | Enforce markers | Enforce markers | Enforce markers | Enforce markers |

Note: the thematic lens never reorders by value/risk/principles — that's what opinionated methodologies (like `faffter-dark-methodology-agile-delivery`) add. Thematic ordering is always priority + unlock value.

Any authority to write tracker **topology** (reparent / convert / rehome) is governed by the shared dial at gateway → **Appetite for destruction** → **Topology-write authority**, not a story this lens invents. Being opinion-free, the thematic lens sits at the dial's surface-only end — it reflects the topology the graph already states and never restructures it; the reversibility floor and the human-curated-structure floor there bind it as they do every lens.

## Rules

- This methodology is **graph-derived, not opinion-derived**. It never says "this is too big" or "this ordering is wrong" — it says "this cycle exists", "this gap exists", "this issue unlocks 5 others."
- It does not assess value, risk, or right-sizing. Those are judgement calls that belong to opinionated methodologies.
- It provides the opinion-free baseline — ordering plus the composed structural/topology floor — that opinionated methodologies layer on top of.
- When a faffter-dark methodology is configured, it runs **in addition to** the thematic baseline, not instead of it. The structural (topology) diagnostics always fire; methodology findings are additive.
