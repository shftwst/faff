---
name: faffter-noon-methodology-thematic
description: "Default `methodology` lens (`thematic`) — opinion-free analysis that reflects the tracker topology: ordering by unlock value, gating on decision closure, composing the shared structural/topology floor (cycle + ghost-project detection). The zero-config baseline every pass uses. Runs as a configured slot, not the user `/` menu."
user-invocable: false
judgement_seam: ordering
---

# faffter-noon-methodology-thematic

Default `slots.methodology`: `faffter-noon-methodology-thematic`. Derive answers from tracker topology and stated facts, without value, risk, right-sizing or outcome opinions.

Compose the structural floor from gateway → **The `methodology` slot** for cycle and ghost-project detection.

## Core ordering rule

Order by issue or ancestor priority, then unlock count, then oldest creation. Pipe the structural-floor graph plus `roots` (IDs being ranked) to `faff planning-graph --unlock`. Use its `unlock_counts` for all sequencing. Combine with `--cycles` in one call when both use the same graph.

## Outputs

Answer the caller's requested named capability from graph facts. The required/optional outputs, caller mapping and standard envelope are fixed in gateway → **The `methodology` slot**.

Leave optional `issue-critique` unanswered: per-issue right-sizing/workstream/risk critique requires an opinionated lens. This is contract-valid; `/faff-prep` omits `## Methodology critique`.

### `pick-ordering`

Apply the core ordering rule.

When the caller supplies `prd-distance` under a resolved target PRD in an L4 drain (gateway → **Standard envelope → Optional input `prd-distance`**):

1. Partition into contiguous human-priority bands. Never cross a band boundary.
2. Within each band, stable-sort matched issues by `rank = min class_rank` among entries whose `container` slug-matches the issue's container. Lower rank goes first.
3. No match or `rank == 0` (met) is neutral: leave those issues in their existing positions. For equal non-neutral ranks, retain core-rule order (unlock value, then creation).

Distance is primary across classes within a band. With no map, skip composition and return byte-identical core-rule output.

### `promotion-readiness`

**Promote** an issue (mark ready) when ALL hold:
1. Blockers clear (all declared blockers are Done)
2. Concrete deliverable (not vague, not "investigate")
3. Real spec exists (tracker comment or `docs/specs/` — never description alone)
4. No unresolved architectural questions (no open `**Punt:**` markers that would block build)
5. No false `**Assumes:**` entries (the assumption actually holds in current state)

**Demote** when:
- Repeat-parked: 3+ parks with same root-cause class in 21 days → demote to Backlog, apply `faff label add` with the resolved `parked` name
- Challenged spec: post-spec comment raises unresolved challenge → back to needs-prep
- Stale spec: codebase drift invalidates approach → back to needs-refresh

### `ticket-shaping`

Propose tickets from the `intake` discovery brief (`faffter-noon-intake`) and live tracker graph. The orchestrator creates them; this output never writes the tracker. Use stated capabilities and dependencies without value or right-sizing opinions.

| Brief | Proposal |
|---|---|
| Greenfield | One workstream/container per stated capability, named verbatim; within each, tickets needed for `First slice`. Apply the core ordering rule using stated `Dependencies` for unlock value and creation/sequence order where priorities are unset. If multiple capabilities and the tracker supports it, propose a top-level initiative/project. |
| Single item, `unitary` | One ticket from `Item`, in the workstream named by `area`. |
| Single item, `possibly-splittable` | Two tickets named for the two concerns, linked by the stated relationship. Never force an unflagged split. |

Each ticket has a plain-English source-derived title (no invented codes), brief-seeded description, container/workstream, declared blocker/blocked-by links from `Dependencies`, and `Backlog` status. Carry relevant `Open questions` into its description for `/faff-prep`.

With `shape-level`, shape only the requested level from the node-scoped sub-brief; `/faff-plot` owns descent and stopping:

| Level | Children to propose |
|---|---|
| `initiative` | One initiative per named top-level outcome/capability group, with verbatim names. |
| `project` | Projects/workstreams under the supplied initiative's brief slice. |
| `epic` | Only epics needed for the supplied project's first usable slice, with dependency-derived blocker links. Do not enumerate leaves. |

Keep the same Backlog status and brief-seeded descriptions. For a branch the sub-brief cannot concretely support, emit no children and report "needs more discovery". For thin briefs, propose fewer, larger tickets and surface missing facts instead of inventing work. Without `shape-level`, use the single-level behaviour above for `/faff-jot`.

### `backlog-diagnostics`

Always run the structural floor. Add the findings below for rendering and routing.

#### Detection categories

| Category | What | How |
|---|---|---|
| **Dependency cycles** | All cyclic issues | Use the structural floor. Render each witness and identify any other members. |
| **Ghost-project pointers** | An issue spec or description names a tracker container (project, initiative, milestone — whatever the tracker calls it) that does not exist | String-match against the live container list from the tracker MCP |
| **Repeat-park patterns** | Active issue parked repeatedly in the same root-cause class within the rolling window (the seam's `window_days` / `threshold`) | Call the deterministic seam — `faff park-history --now <currentDate>` (resolve the `faff` executable per the gateway's *Resolving the `faff` executable* rule, never a hardcoded path; pass the **system `currentDate`** as the window end — the seam has no ambient clock and exits 2 without `--now`). Consume its JSON: `repeat_parked` is the sorted set of issue ids at/over threshold (the finding), and `counts` gives the per-issue / per-class breakdown. The rolling **window and threshold are owned by the seam** (`window_days` / `threshold` in its output) — not re-derived or restated here. Root-cause classification is the shared taxonomy fixed in the gateway's automation-routing contract; the `routing_adaptor` slot, default `faffidavit-routing`, assigns against it. The seam fail-louds (exit 2) on a missing/unparseable `--now` or a malformed parks block — do not paper over it with a prose fallback. |
| **Splittable specs** | Spec describes two structurally independent concerns AND each concern is a valid ticket-sized unit | LLM inspection — restricted to specs already flagged stale/challenged by existing tidy logic (don't sweep every spec every run) |
| **Chain gaps** | Any active ticket whose spec's implementation advice references work no ticket tracks — the chain from current state to fulfilling the spec's purpose is broken because some piece of the implied work has no ticket to carry it. Four sub-types: **sub-ticket gap** (umbrella's spec enumerates multiple remaining deliverables — multi-PR, multi-phase, numbered steps — but no Todo / In Progress / In Review sub-ticket exists for the next deliverable; `/faff-graft` has nothing to pick up to advance the umbrella); **upstream gap** (spec names a prerequisite — "blocked by X", "needs Y first", "assumes Z has shipped" — that has no ticket); **downstream gap** (spec names follow-up work — "subsequent PR will...", "leaves W for later", "after this, wire up V" — that has no ticket); **peer gap** (spec implementation advice describes parallel work that must also happen for the change to be useful — consumer wire-up, integration changes, related refactor — that has no ticket). | (1) Active ticket (Todo / In Progress / In Review) with a discoverable spec. (2) Parse the spec's implementation-advice section(s) for: multi-deliverable enumeration markers ("PR 1 / PR 2", "PR A / PR B", "Phase 1 / Phase 2", "Step N of M", "follow-up PR", numbered/bulleted lists with PR-shaped action verbs — sub-ticket gap); upstream-dependency phrases ("blocked by", "needs X first", "assumes Y has shipped", "depends on Z", "prerequisite" — upstream gap); follow-up phrases ("subsequent PR", "follow-up ticket", "leaves W for later", "after this", "next phase" — downstream gap); parallel-work phrases ("consumer-side changes in X", "also needs Y in the same workstream", "integration changes in service Z", "related refactor" — peer gap). (3) For each referenced work unit, search the active-ticket graph for a match: sub-ticket of this ticket (sub-ticket gap); tracked blocker / upstream ticket whose title/description matches the prereq (upstream gap); follow-up ticket linked via "blocks" or whose title matches (downstream gap); sibling/peer ticket in the same workstream matching the description (peer gap). (4) If no match → chain gap. (5) For sub-ticket gaps additionally check: count enumerated deliverables `E`, count `C` = (sub-tickets in any state) + (merged PRs directly referencing the parent ID); flag when `E > C` AND no sub-ticket is in Todo / In Progress / In Review. Conservative: skip when the spec is unitary, when the referenced work is in scope for the current PR, when the reference is illustrative rather than load-bearing, when the spec explicitly disclaims ("future work — not ticketed by design"), and when an actionable next-step ticket already exists. |
| **Orphaned + repeat-parked** | Cross-reference of existing orphaned-by-cascade detection with repeat-park | Set intersection of the two finding sets |

Detect conservatively: false positives require human correction. **When in doubt, don't flag.**

#### Mechanical fixes (auto-applied per appetite — see Appetite integration)

| Detection | Mechanical fix |
|---|---|
| Cycle where one edge is defensive-not-load-bearing (the spec for A doesn't actually reference B's output) | Strip the defensive edge. Log the cycle, the stripped edge, the reasoning. |
| Ghost-project pointer where the named container **clearly maps** to an existing container by name proximity (e.g. spec says "logging-cleanup project", tracker has "Logging cleanup") | Repoint the issue to the existing container. Log the move. |
| Repeat-park (issue in the seam's `repeat_parked` set), issue still in Todo | Demote to Backlog, tag with `faff-parked` via the sanctioned op. Log the demotion. The issue is clearly not Todo-ready; leaving it as Todo lies to the queue. The qualifying set is the seam's `repeat_parked` output (above), not a re-count — only the *source* of the set is the seam; the demote behaviour, tag, and appetite-gating are unchanged. |

Three detection categories never auto-apply mechanically (one of them, chain gaps, *does* auto-ticket at higher appetite; see below):

- **Splittable specs** — surface only: report the spec with the two independent concerns the diagnostic identified and recommend splitting it into separate tickets. faff has **no auto-split command** — splitting a spec is a human judgement call (re-prep, or file separate tickets manually). Autonomous: log only.
- **Chain gaps** — *surface mode:* report each gap with the active ticket, sub-type (sub-ticket / upstream / downstream / peer), the referenced work, what's already covered (sub-ticket gaps only — sub-tickets + merged PRs by direct ref), the un-ticketed remainder, and the recommended action: for sub-ticket gaps offer to file the missing sub-ticket(s) under the parent; for upstream / downstream / peer offer "file gap issue" (create the missing ticket with the appropriate relationship — blocker for upstream, blocked-by for downstream, sibling-in-workstream for peer). *Auto-create mode (`high`+ appetite by default — an opinionated methodology lowers the threshold to `medium`+):* **auto-create the missing ticket(s) per sub-type** — sub-ticket gaps: one Backlog sub-ticket per un-ticketed deliverable, parent set to the umbrella; upstream gaps: one Backlog ticket for the prerequisite + add a blocker link from the active ticket to it; downstream gaps: one Backlog ticket for the follow-up + link "blocked-by" the active ticket; peer gaps: one Backlog ticket for the parallel work in the same workstream/parent. All created tickets: title from the spec reference line, description = the referenced prose + back-link to the source ticket, status `Backlog` so `/faff-prep`'s next queue pass picks them up. Log every created ticket with id, sub-type, source spec line, and the relationship target (parent / blocker / blocked-by / sibling). Skip auto-create and downgrade to surface-only when the reference is ambiguous (no clear deliverable per line, no nameable target for the relationship, prose-y rather than action-verb-led) — phantom tickets are expensive to clean up.
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

Pass the cycle and ghost-project findings through for routing.

### `standup-digest`

Surface, in order:
1. **Recently shipped** — completed in last 24-48h + what each just unblocked. Float newly-unblocked issues to the top of recommendations.
2. **Today's focus** — top N ready issues by `pick-ordering`. Recommend the one that unlocks the most downstream value (live edges only — gateway → **Satisfied blockers — edges to terminal work**).
3. **Heads up** — structural problems that would bite today: repeat-parks, chain gaps (with sub-type), orphaned+repeat-parked, approaching deadlines.
4. **Queues** — build queue + prep queue counts.

Render: every issue gets tracker ID + plain-English gloss + unlock-chain consequence when non-trivial. Tables for queue summaries, prose for focus. Concise — a brief, not a report.

### `horizon-assignment`

| Horizon | Tracker state |
|---|---|
| Now | In Progress or actively being built |
| Next | Todo, blockers clear or nearly clear, spec exists |
| Later | Backlog, or blocked by Now/Next work; satisfied edges do not count as blockers |

Use `pick-ordering` within each horizon. Surface ghost-project pointers, structural gaps (initiative with no Next project), unfireable trigger gates, stalled Now projects (In Progress with no commits for 14+ days), and parked issues with unmet unpark conditions. Render an ASCII initiative → project → issue chain with gaps marked inline.

### `build-queue`

**Admission:** the two build-ready verdicts enter; every other routing verdict routes out (canonical semantics: `faff contract automation-routing --describe`).

**Ordering:** use `pick-ordering`, including optional **`prd-distance`** under a resolved target PRD: head for the sibling PRDR nearest a `met` DoD within human-priority bands, byte-identical when absent. Order independents directly; serialise collision-group members, with the lead issue fixing group position. Admission and serialisation use live blocker edges only; satisfied edges never serialise (gateway → **Satisfied blockers — edges to terminal work**).

**Conflict analysis:** partition admitted work into parallel-safe independents and collision groups serialised within, parallel across groups. Use `faff-beep-boop` → **Conflict analysis** as the canonical heuristic home; do **not** recap it.

**Wave structure:** After each wave drains, re-check for newly unlocked work, narrow-prep unblocked candidates, re-assemble the queue. Continue until drained or budget hit.

### `run-termination-policy`

Optional (gateway → **The `methodology` slot**). Return the CLI's `structural-default` ordered ladder as `{test, verdict}` rungs:

| test | verdict |
|---|---|
| non-convergence | escalate |
| budget-narrow | continue |
| budget-stop | run-complete |
| value-inflection | run-complete |
| work-remaining | continue |
| clean-complete | run-complete |

The orchestrator passes it to `faff run-done --policy`. The CLI alone decides run-end; this output is read-only and never writes the tracker. Unanswered uses this same built-in default.

The CLI applies its fixed safety floor first: `budget-escalate`, `undispatched-ledger` at drain, and `product-incomplete`. A lens may reorder or soften non-floor rungs but can never override or weaken that floor. This lens uses graph/process facts and the exact ladder above.

### `crank-up-set`

**Optional** (gateway → **The `methodology` slot**). From **not-automation-eligible** issues, dependency graph, each `faff next --if-eligible` hypothetical transition and appetite, return ranked **crank-up-sets**: coherent batches for human approval. Unanswered ⇒ wtf/tidy use the flat On-hold list. Read-only; never mutate eligibility.

**Slice algorithm:**

1. **Roots.** Filter the not-eligible set to issues with ≥1 not-eligible dependent (downstream runway), ranked by the core ordering rule (priority → chainable unlock value). Apply a **min unlock-value threshold ≥2** (mirrors the value-chains render gate) — a lone not-eligible leaf (unlocks 0) is omitted in favour of a root with runway.
2. **Depth.** Walk transitive dependents in dependency order; admit a dependent `D` into the slice **iff** `D` is not-eligible **and** all `D`'s blockers are already in the slice (no outside blocker; a satisfied blocker — gateway → **Satisfied blockers — edges to terminal work** — is neither in the slice nor an outside blocker, so it never excludes `D`).
3. **Stop per branch at the first frontier:** (a) **branch point** — `D` has an outside (non-slice) blocker → exclude, mark `"fans out — separate proposal"`; (b) **risk spike** — `D`'s reversibility tier flips to higher-risk; (c) **value plateau** — `D` unlocks 0 **and** is not spec-ready.
4. **Annotate.** Each member carries its `faff next --if-eligible` badge (would-build / would-need-prep / would-still-need-decision); each set carries a one-line **hypothetical-verdict distribution** (e.g. "2 would-build, 1 would-need-prep") + any deferred-with-reason members.
5. **Shared member.** When a member sits in two roots' slices, the **highest-priority root claims it**; the other marks it `"shared with <root>"` (deterministic; avoids double-cranking in render).

**Output:** a ranked list of `{root, ordered slice-members, stop-reason, hypothetical-verdict distribution, prep-needed members, deferred notes}`.

**Appetite** tunes depth (low = solo safe roots; medium/high = multi-member slices; full = deepest runway) — it never cranks up (that is `/faff-tidy`'s human-gated batch crank-up).

### `prdr-author`

**Optional** (gateway → **The `methodology` slot**). From an initiative/project container and `{outcome, child_specs, target}`, author one **`AuthoredPrdr`**, provenance `loop`, status `Proposed`. Use **graph + container facts**, never value/risk opinions: the target-scaled DoD requires every child epic delivered and the container's stated outcome criteria met.

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

**Appetite** changes ambition framing only: lower favours the thin end of the target band, higher the full end. Admission belongs to the caller's level; never self-Accept (L4 runner's gated act or human L3 ratification).

### `yagni-judge`

**Optional** (gateway → **The `methodology` slot**; **Phase 1** of **Upper-gate (YAGNI) two-phase arbitration** in the gateway). From `AuthoredPrdr`, PRD and optional grounding, propose whether the PRDR serves a real PRD goal **without exceeding it**. Use **graph + PRD facts**, never value/risk opinions:

- `serves_goal` — does the PRDR's `prd_goal` name a real PRD goal *and* does its `decision`/`definition_of_done` materially advance that goal (not merely cite it)? Graph/text trace, not taste.
- `within_scope` — does the DoD cover **only declared PRD goals** (`V ⊆ D`), or does it add capability the PRD never asked for (structural over-reach)? Covering *several* declared goals in one functional MVP is in-scope, not gold-plating; only capability outside the declared goal set is over-reach. Grounding, when present, sharpens this (domain norms) but is never required.
- `verdict` — `admit` when both hold; `reject` otherwise, with a one-line `reason`.

**Output:** `{serves_goal, within_scope, verdict: admit|reject, reason}` for `faff prdr yagni --proposal …`. **Propose, never admit** (`faff prdr admit` owns admission); the adversarial-review slot challenges in Phase 2. Never write the tracker. Unanswered leaves no proposal, so the caller uses `faff prdr admit`'s fail-safe upper default: conservative reject.

**Appetite** changes `within_scope` strictness only (lower permissive, higher tighter), never admission; conservative-reject-on-doubt arbitration belongs to the CLI.

### `rehome-set`

Optional. Return an empty rehome-set: no proposed containers, membership map, coherence edges or leave-loose reasoning. Outcome-led grouping requires an opinion this graph-derived lens does not supply. Empty/unanswered means the caller reports no grouping opinion and writes nothing (gateway → **The `methodology` slot**).

## Appetite integration

The thematic lens respects appetite but has limited agency by design:

| | low | medium | high (default) | full |
|---|---|---|---|---|
| Diagnostics | Surface only | Surface + auto-demote repeat-parks | Surface + auto-demote + chain-gap auto-create | Surface + act on all (auto-create, auto-demote, report splittables) |
| Ordering | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides | Core rule, no overrides |
| Spec format | Enforce markers | Enforce markers | Enforce markers | Enforce markers |

Gateway → **Appetite for destruction** → **Topology-write authority** governs tracker **topology** (reparent / convert / rehome). This opinion-free lens stays surface-only: reflect existing graph topology, never restructure it. The dial's reversibility and human-curated-structure floors bind here too.
