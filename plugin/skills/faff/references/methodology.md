# Faff gateway reference — methodology

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Automation eligibility

Use `faff eligible --issue "$issue"` with the fresh labels (one `--label` per name) and the current FAFF_RUN_DIR. It prints true for the configured automate label or a contained ticket filed by this converging run. Both verdicts exit 0. The filing receipt expires at run-end. Git-only tickets have no tracker status moves.

- In autonomous prep/tidy, skip spec, refresh and promotion on `false`. When consulting `faff next` directly, pass `--not-eligible` for its `skip-ineligible` route. Autonomous `faff graft admit` already checks eligibility before build. Beep-boop may filter early. Queue skips stay out of the ledger's `admitted` array.
- Explicit interactive `/faff-prep` and `/faff-graft` proceed through the usual gates. Note when the ticket is ineligible and leave its opt-in unchanged.
- **Release / crank-up.** Only a human toggles the label in the tracker UI. Interactive jot, tidy and prep may suggest adding or removing the exact name from `faff labels`. Never write it through tracker MCP. `faff label add` and `remove` refuse both directions for this role. Cranking up restores eligibility for the next pass without promoting the issue.
- Keep active ineligible work visible in maps, counts and diagnostics. WTF and tidy list it under **On hold**. **Parked work** records a blocker hit on an attempt. The same issue can appear in both. Tidy may clear a resolved park. Eligibility stays human-controlled. Apply the usual cancelled/archived exclusion.

### Human curation is authoritative

The tracker is **the interface a human uses to steer, shape, and guardrail an in-flight autonomous build.** Human-curated priorities, groupings, sequence, milestone/release plan, manual blockers and status are authoritative intent; the pipeline never silently overrides or restructures them. This shared principle adds no `faff` subcommand, config key or `.faff/` artefact. Three assertions:

1. **The tracker is the control plane.** Human-curated structure is the authoritative record the pipeline reads as control input, never an incidental constraint. (Per **Tracker as the lights-out control plane** above — this is its obey-side restatement.)
2. **Human edits are re-read every pass.** Before acting on any issue, the pipeline re-reads its current tracker state + human edits and incorporates them — implemented by **Always pull fresh**, faff-beep-boop's wave re-entry + `faff next`, faff-prep's post-spec comment scan (Scenario B Step 2a), faff-tidy's live-thread reconciliation, and the fixed **Live-thread reconciliation** verdict-gate property. A human's mid-flight resolution supersedes a stale snapshot.
3. **Never silently restructure human-curated structure.** No autonomous path re-groups, re-prioritises, re-sequences, or re-parents what a human curated — those are **propose-and-confirm, container-gated** (jot/plot's "containers always confirm" at every appetite level, except within the L4 accepted-root envelope — a loop-authored container contained under the run's admitted root PRD is admitted), and the appetite **hard floor** forbids autonomous cancel/delete at *every* level including `full`. Human-set ordering / grouping / blockers **constrain** the autonomous work-ordering above the pipeline's own computed priority — priority (a human label) is the primary work-ordering gate; the methodology reframes only *within* a band, never across a human-set one.

**Higher appetite does not loosen this.** The dial governs how much the pipeline executes *past the spec gate*; it never punches through human-explicit curation — user-explicit "ask first" rules and cancel/delete sit in the appetite hard floor, which applies at `full`. Human-explicit always overrides appetite.

**Methodology opinions are whole-slot, not per-knob.** faff's opinionated delivery functions (value-grouping, increment-sequencing, outcome-naming, merge-always-ship-together, auto-grouping) are toggled **as a whole** via the `slots.methodology` slot — thematic default ↔ the agile-delivery bundle. A mature team with its own delivery practice switches faff's opinions off by setting the thematic default (or its own methodology); faff does **not** decompose into per-principle on/off knobs and adds no per-principle config surface (monolithic-slot model — human decision, 2026-06-12; keeps the config surface minimal per *configurable, not opinionated*). Level recipes are where a *bundle* of which-methodology-runs is named.

**Provenance (how "human-curated" is detected — pragmatic, not a new subsystem).** faff-authored structure carries faff's own markers (the `faff-`-prefixed control labels, the provenance-stamped spec/park/resolve comments, the `planned by /faff-plot` line); everything else is the human's. The pipeline's existing chokepoints already respect this without a dedicated provenance store: autonomous tidy mutates only its own housekeeping (stale faff-labels, obvious orphans) and never re-prioritises or re-sequences human structure; jot/plot confirm before creating containers; the appetite floor blocks cancel/delete. No provenance-tracking mechanism is added here.


## The `methodology` slot

The `methodology` slot answers named questions about backlog and build state. This table defines the contract for every lens, including the default `faffter-noon-methodology-thematic` and alternative `faffter-dark-methodology-agile-delivery`. Every lens must answer the required outputs. Each optional output specifies its fallback.

**Named-output contract:**

| Output | Requested by | Required? | In → out |
|---|---|---|---|
| `backlog-diagnostics` | faff-tidy, faff-wtf, faff-map | **Always fires** | Active graph → structural floor below. Include repeat-parks, splittable specs and chain gaps when available. |
| `pick-ordering` | faff-tidy, faff-wtf, faff-map, faff-beep-boop | **Required** | a set of issues → the same set ordered by the methodology's sequencing rule. **Optional `prd-distance` input** (the `faff prdr distance` map, supplied only under a resolved target PRD): a within-band tiebreaker composed into the ordering, never a takeover; absent ⇒ byte-identical (see the Standard-envelope floor). |
| `promotion-readiness` | faff-tidy, faff-prep | **Required** | an issue + its spec/blocker state → promote / demote / hold decision with reasons. |
| `build-queue` | faff-beep-boop | **Required** | routed-in issues + conflict analysis → admission-filtered, ordered, wave-partitioned queue. **Optional `prd-distance` input**: same PRD-scoped within-band tiebreaker as `pick-ordering` — supplied only under a resolved target PRD, composed not substituted, absent ⇒ byte-identical. |
| `ticket-shaping` | faff-jot, faff-plot | Optional | a discovery brief → proposed ticket set (titles, descriptions, links, container, and an **optional per-ticket `type`** — `bug`/`feature`/`spike`/`chore`/`epic` — consumed by the create-boundary **Ticket templates** fill step: absent → the fill step infers type; present and in-taxonomy → honoured; no methodology is ever required to supply it). Unanswered → faff-jot falls back to one ticket per brief item. **Optional `shape-level` input** (`initiative` / `project` / `epic`): when **absent**, the single-level brief→tickets behaviour faff-jot uses (unchanged); when **present**, shape only that altitude's children of a node-scoped sub-brief — `/faff-plot` supplies it as it recurses a roadmap top-down. The methodology shapes one level per call; **`/faff-plot` owns the recursion, stop rule, and writes** — `ticket-shaping` never recurses or writes itself. **Default landing (methodology-gated):** the `container` field *is* the landing decision, so where new work lands is the methodology's opinion — faff-jot acts on the returned shape (a proposed container ⇒ confirm-and-create; none ⇒ project-less Backlog, skip `prdr-author`) and never branches on the methodology's name. Under the agile lens new work defaults to **project-less Backlog**, deferring outcome-sequencing to a later explicit step; the thematic default keeps its homes. This is the inflow counterweight named in **Appetite for destruction → Topology-write authority** (the matched-pair legibility-preserver). |
| `standup-digest` | faff-wtf | Optional | recent + ready + heads-up state → a brief. Unanswered → faff-wtf renders the ready-queue plainly. |
| `horizon-assignment` | faff-map | Optional | active issues → Now/Next/Later horizons + chain diagram. Unanswered → faff-map degrades to a flat structural roadmap. |
| `issue-critique` | faff-prep | Optional | one issue + its spec → a per-issue critique through the methodology's lens (right-sizing, workstream fit, surfaced deps, risk — whatever the lens cares about). Unanswered → faff-prep omits the `## Methodology critique` block. The lens decides the critique's shape; faff-prep does not impose one. |
| `crank-up-set` | faff-wtf, faff-tidy | Optional | the **not-automation-eligible** issue set + dependency graph + each member's `faff next --if-eligible` hypothetical transition + hypothetical routing verdict + appetite → a ranked list of **crank-up-sets**, each `{root, ordered slice-members, stop-reason, hypothetical-verdict distribution, prep-needed members, deferred-with-reason notes}` (which not-eligible root to crank up and how far down its chain, as one approvable batch). Unanswered → wtf/tidy show today's flat On-hold list (zero-config safe). Read-only analysis — it never mutates eligibility; the act of cranking up is human-gated in `/faff-tidy`. |
| `prdr-author` | tidy, plot, jot, lights-out runner | Optional | Container outcome, child specs and target → `AuthoredPrdr` (decision, DoD, container and cited PRD goals). Low confidence produces a thin DoD flagged needs-human. If unanswered, the human authors the DoD. |
| `yagni-judge` | upper gate | Optional | Read the proposed PRDR, PRD and optional grounding. Propose `{serves_goal, within_scope, verdict, reason}` for independent challenge. An absent proposal cannot approve new capability. |
| `run-termination-policy` | the run-terminating-condition composer (`faff run-done`, via the orchestrator) | Optional | the run's signal context → an **ordered policy ladder** of the policy-weighted terminating rungs (`non-convergence` / `budget-narrow` / `budget-stop` / `value-inflection` / `work-remaining` / `clean-complete`) the run-end predicate applies **after** its fixed safety floor. This is the **weighting/precedence** opinion behind the one decision that ends an unattended run (the closed run-termination vocabulary — `faff contract run-termination --describe`) — homed in the methodology slot per the ordering/weighting delegation rule, exactly like `pick-ordering`. A lens may reorder the rungs or soften a non-floor rung's verdict; it may **not** touch the **safety floor** (budget-escalate, undispatched-ledger at drain, product-incomplete), which is fixed in the CLI and never methodology-overridable. Unanswered → `faff run-done` applies its built-in **structural-default** ladder (so zero-config and existing methodologies are unaffected). Read-only — the methodology authors the ladder; it never writes the tracker and never decides the run-end itself (`faff run-done` composes the ladder with the signals, purely). |
| `rehome-set` | faff-plot | Optional | the project-less Backlog issue set + dependency graph + existing projects → proposed **outcome-led project containers** (each `{container_name, outcome}`), a **membership map** (which loose tickets move into each), proposed **coherence blocker edges** (`{blocker, blocked}`, explicit, never written), an explicit **leave-loose set** (correctly-loose tickets each with a one-line reason — never silently omitted), and principle-keyed findings; proposals ordered by which grouping unlocks sequencable value first. **Completeness:** every input loose ticket appears exactly once across membership ∪ leave-loose. Read-only — the methodology **proposes, never writes**; applying a proposal is the caller's human-gated act (`/faff-plot`). Unanswered/empty → the caller reports **no grouping opinion** and writes nothing. |

**Authored-PRDR level-scaling.** The methodology authors the same loop-provenance `Proposed` record at L3 and L4 with `faff prdr new`. Only `faff prdr accept` writes `Accepted`.

- At L3, surface the proposal for the human to ratify with `faff prdr accept <n>`.
- At L4, respect the containment and appetite floors. The caller checks the upper and applicable lower gates with `faff prdr admit`. Only an admitting disposition permits loop acceptance with the full verdict. Push the printed landing branch and open its PR. Park a refusal with the proposal intact.

**Manual changes are authoritative (`prdr-author`).** Re-read the container's DoD and human edits before proposing. Fill only unset parts. Resolve the target from the first case-insensitive `target:` line in the tracker description (`thin-mvp` or `finished`, other values are unset), then the parent initiative, then the methodology default. Scale the DoD to that target.

**Upper-gate (YAGNI) two-phase arbitration.** The caller supplies observations. `faff prdr yagni` decides the upper verdict.

1. Pass the record's `prd_goals` as `--cited-goals` and the PRD's declared goals as `--prd-goals`, both JSON arrays. Read `trace_to_goal` from the result. A false trace rejects before either model call.
2. Request the methodology's `yagni-judge` proposal. Have the review slot challenge it as an independent subagent with a different model, using the PRDR, declared goals and proposal (adversarial-review → **PRDR YAGNI Phase-2 challenge**). Grounding is advisory.
3. Run `faff prdr yagni` with the same goal arrays, the goals the DoD actually covers as `--dod-covers` (JSON array), and the observed proposal (`--proposal`, `--proposal-reason`, and `--serves-goal` / `--within-scope` when true). Pass `--challenge survived|overturned` and the reported overturn ground (`over-scope`, `unserved` or `other`) via `--challenge-ground`. Omit missing inputs, including `--challenge` if the skeptic is unavailable after fallbacks.
4. Validate its JSON with `faff contract prdr-yagni`. A command or contract error stops admission. Use the validated `{admit, reason}` as `faff prdr admit --upper`. The CLI reconciles coverage and citations even when the reviewer says `overturned`.

**Standard envelope (every output).** Supply the relevant issues, their state, sequencing, workstream grouping and dependency graph. Return the named answer, structured findings for rendering and a `Methodology: <name>` banner. The methodology works from the supplied state without knowing or describing its callers. Only the orchestrator writes to the tracker.
**Optional input — `prd-distance`.** In an L4 drain with a resolved target PRD, beep-boop supplies `pick-ordering` and `build-queue` with the `faff prdr distance` map. It measures each sibling's remaining steps to PRD completion (`faff contract prd-distance --describe`). The lens chooses the weight within human-set priority bands and never reorders across bands (see **Ordering & judgement delegation**). Distance expresses neither value nor risk. With no PRD/PRDR hierarchy in scope, omit the map. Absent input must leave every output byte-identical to a distance-unaware lens.

**Display convention (shared).** With a configured `methodology` slot, lead with `Methodology: [skill-name]` and render the skill's section: faff-tidy bucket 7, faff-wtf `### Methodology findings`, faff-prep `## Methodology critique`, faff-map Phase 1 / Phase 7 additions, or faff-beep-boop's summary banner. In faff-beep-boop, the **Install-health preflight** warning precedes the banner when both apply. Without a configured methodology, omit both banner and section silently. Each sub-skill names only its section.

**Appetite.** Every output respects `appetite` (see **Appetite for destruction**). The configured methodology defines behaviour at each level.

**Structural floor.** Supply cycles and ghost-project pointers for `backlog-diagnostics`. From the full scoped snapshot, pipe JSON `{issues: [active IDs], live_edges: [[issue, blocker], ...]}` to `faff planning-graph --cycles` (gateway → **Resolving the `faff` executable**). Use live edges sourced at those IDs from gateway → **Satisfied blockers — edges to terminal work**. Preserve `dependency_cycles`: `members` lists every cyclic issue, `witness` gives a closed blocker path. Use the supplied live edges to assess any break action. On error, apply **Loud degradation**. The `routing_adaptor` maps members to `circular-blocked` and ghost pointers to `gap-blocked`. Lenses may add findings. For `pick-ordering`, `promotion-readiness` and `build-queue`, lenses may supply their own answer or rerank the baseline.

### Transport (per-output dispatch grain)

Run `faff dispatch prepare-producer methodology` for each dispatch below. When the caller is itself a subagent, add `--in-context` and invoke the occupant in the current context. Follow gateway → **Producer dispatch** for validation and transport.

Send an ordered `requests` array of `{output, input}` using each contract row's payload. Expect one `## <output-name>` section per request, in order. An optional output can return its section marked `unanswered`. Apply that row's fallback.

| Request | Dispatch when |
|---|---|
| Read-skill outputs, including `pick-ordering`, `backlog-diagnostics`, `crank-up-set`, `standup-digest` and `horizon-assignment` | Batch once per pass after fetch and graph analysis. All answers use one snapshot. |
| Plot `ticket-shaping` | Batch confirmed nodes at each altitude. Finish its human gate before descending. An edit gets a node-scoped follow-up. |
| Jot `ticket-shaping` | Once per pass. |
| `prdr-author` | Once per container when its separate gate is reached. The methodology writes with `faff prdr new`. |
| Plot `rehome-set` | Once for the entire project-less Backlog set. Confirm each grouping at apply time. |

A request arising after its batch closes gets a separate dispatch. On a failed or garbled dispatch, surface **“methodology unavailable this pass”** and apply each output's unanswered rule. Never report a missing structural diagnostic as clean. Interactive callers may retry once. Autonomous callers log and continue.

### Calibration log

Captures evidence about over-cautious parks, wrong inferences, and post-merge reverts so the resolve-attempt rules and verdict gates can evolve with data.

**Capture points (append-only):**

| Event | Path | Captured |
|---|---|---|
| Autonomous-park then interactive-complete-no-questions | `.faff/calibration/over-cautious-parks/<issue-id>.md` | Park reason, root-cause class, what the interactive resolution actually was (read from the commit / PR) |
| Autonomous-resolve-attempt then human-overrode | `.faff/calibration/wrong-inferences/<issue-id>.md` | Original marker, inferred answer, human's correction |
| Autonomous-shipped then post-merge-reverted within 7 days | `.faff/calibration/post-merge-reverts/<issue-id>.md` | Shipped commit SHA, revert commit SHA, the diff between them, any comments on the revert |
| Appetite-influenced decision (at `appetite: high`, autonomous proceeded on `confidence: medium` or widened-threshold resolve-attempt) | `.faff/calibration/appetite-decisions/<issue-id>.md` | The verdict, the spec marker, the inferred answer, the audit-trail comment posted, and the merge outcome (pass / human-overrode / post-merge-reverted) once known. Pairs with the wrong-inferences and post-merge-reverts captures above for the cross-cut "is `high` over-shooting?" tidy signal. |
| Medium-confidence held for human (at `appetite: low`/`medium`, a `confidence: medium` spec was attached + surfaced, not built) | `.faff/calibration/held-decisions/<issue-id>.md` | The verdict, the spec marker + thin area, the appetite at the time, and the human's eventual resolution (resolved-as-flagged / changed-direction / waved-through-no-change) once known. The symmetric counterpart to `appetite-decisions` — pairs with it for the cross-cut "is `low`/`medium` *under*-shooting — holding things the human just rubber-stamps?" tidy signal. |

**Synthesis and surfacing.** Every `/faff-tidy` run (or the equivalent step within `/faff-wtf` when no tidy ran this pass) reads the calibration log and surfaces patterns when they cross a threshold:

> _Calibration signal:_ Your autonomous mode parked 4 issues in the last 14 days flagged `needs-decision-first` on `Punt: pino vs winston`. All 4 completed interactively without questions. The codebase has used pino since SHF-92 shipped (3 months ago). Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to update their specs with `Chosen: pino`, or (c) ignore — no change.

Surfaced signals are **advisory** — they suggest a fix but never auto-apply rule changes.

**Critical invariant.** The calibration log is **append-only and never authoritative**. A skill never reads calibration to make a current decision; only humans (or the skills' future iterations) read it to evolve the rules.

**Threshold (fixed):** surface ≥4 same-root-cause events within 14 days; demote repeat-parked Todo to Backlog at 3+ parks in 21 days. These are built-in defaults, not config knobs; signals remain advisory for human action. Automatic appetite/spec/resolve-rule tuning, including evaluator business-value/QA evidence beyond parks/reverts, is an unbuilt L4 capability requiring the evaluator lane.
