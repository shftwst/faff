# Faff gateway reference — autonomous contract

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Workable vs terminal states

Only beep-boop's unscoped queue queries select workable states (`backlog`, `todo`, `in-progress`, `in-review`). `faff next` treats `done`, `cancelled` and `duplicate` as terminal. WTF, map and tidy also fetch terminal work. Apply **Ignore cancelled and archived** after fetching.

| Tracker | Workable query |
|---|---|
| Linear | Pass the wanted state/category to `list_issues`'s `state` (`backlog`, `unstarted`, `started`) with `includeArchived: false`. Completed and canceled are terminal. |
| GitHub Issues | Fetch `state = open`. Closed-completed is Done. Closed with `state_reason = not_planned` is cancelled. |
| Jira / other MCP | Select non-terminal categories when available. Otherwise use state names to exclude done/completed and cancellation states. |


### Autonomous Mode Contract

Signal autonomous mode at invocation: “running in autonomous mode, skip all prompts, park on ambiguity, log everything”.

**The no-prompt invariant.** During L3/L4, never ask for build, scope, merge or admission confirmation. A watching human, self-hosting project or high-stakes merge does not lift this rule. Follow the gate verdict. Park or route out genuine ambiguity. Only an interactive install-health `faff sync` soft-offer before ledger mint may prompt (gateway → **Install health**).

**Dispatch and resume.** Dispatch the queue after conflict analysis. Build an in-queue prerequisite first, then its dependent, including a fully serial chain. Use the documented default for an unset slot. Issue count, diff size, session length and compaction cannot justify parking or deferral. Resume a compacted graft from `.faff/runs/<run-id>/ISSUE-XX/graft.md`, tracker and branch/PR state. After external termination, resume from the run directory.

- Record inputs, outputs, expected and observed state, decision and reason. Keep the resume artifacts under `.faff/runs/<run-id>/` for every logging level. `logging: essential` skips the per-skill narrative under `.faff/logs/`.
- Run every written gate, including unscored gates and those after the coverage floor passes. Use the gate's actual verdict and named cause. A missing tool, failed query, dirty worktree or unresolvable ambiguity affects that unit: park, log and continue under the applicable gate.
- Stop on the orchestrator's completion or explicit budget/Sentry action. At a drained or genuinely all-parked queue, apply the required wave-boundary consult and reconciliation before reporting completion. “Deferred”, “queued for next run” and “not dispatched this conversation” leave admitted work outstanding. `runcheck` and the Stop hook enforce terminal outcomes. Follow beep-boop's budget and resumable-abort rules.

**Spec-related pre-PR park causes.** Read the spec's conclusion markers. A `Chosen:`, `**Chosen:**`, `Decision:` or equivalent closes the choice, including a named new package. A high-confidence spec closes its internal decisions; external unknowns still matter. An explicit Punt, “needs human”, TBD, unresolved alternative, “revisit” or two options without a choice triggers **Resolve-attempt before park** under the configured appetite.

| Potential pre-PR park | Action |
|---|---|
| Explicit unresolved spec choice | Apply the resolve and appetite rules. Follow the chosen decision when resolved. |
| Required external dependency or seam absent | Check whether the dependency is in this run's prep or build queue and serialise if so. Otherwise apply the gap rule. |
| Irreversible side effect outside the PR | Park before executing it. Examples include changing live infrastructure, applying a production migration, rotating credentials, publishing a package, sending a real message or force-pushing a protected branch. |
| Substantially superseded premise | Cite the already-merged work's Done ticket IDs in the park comment. |

Apply the **Park protocol (shared)** to a refusal: preserve existing WIP, draft an existing PR and log the cause. An absent PR stays absent.

An unexecuted migration, CI workflow, infrastructure declaration or dependency change that takes effect only after merge goes through PR review. Use the merge-and-revert test: if reverting the merge and redeploying undoes the change, follow the ordinary gates. Touching a sensitive file alone does not execute a side effect.

**Review and recovery.** Run the configured review or graft's default before opening a ready PR. Apply graft Step 9 to the actual verdict. Fix and re-review fixable findings. A human-judgement verdict parks before opening a PR, or drafts an existing one. A mandatory review outage with a resumable checkpoint and retry allowance holds (`retry-later`): release the claim to Todo and apply the awaiting-review role. Otherwise park. Never open a PR on that outage. Approval proceeds through verified ACs, green CI and graft's remaining merge gates.

**After merge**, log failed branch/worktree, directory, status or label cleanup as human follow-ups in the final summary. Skip the failed cleanup and continue the queue.

**Entry preflights (autonomous only).** Run `faff run preflight` once before minting the build queue. Log each finding and surface it in `/faff-wtf`. Continue on exit 0 with a readable result. On refusal, command/config error or unreadable result, stop before work with the reported cause. Interactive work skips these probes. `faff lights-out` applies its stricter floor.

Follow each skill's **Autonomous Mode** section. Tidy auto-archives merged/cancelled items and reparents obvious orphans. Log other proposals for review. WTF returns the ready list without a focus recommendation. Map returns its read-only roadmap, dependency joins, gates and risks.

Prep refreshes a still-valid design or delegates a fresh spec to the configured/default producer. Once the spec-review and marker gates pass, high confidence promotes; medium attaches with its rating retained in Todo (`needs-decision-first` at build); low parks in prep. For build-time confidence and Punts use the **Build pipeline** appetite matrix below. Mid-build ambiguity goes to prep for respec; park if still unresolved.

### Appetite for destruction

The suite-wide dial (`appetite: low | medium | high | full` in `.faff/config.yaml`, default `high`) governs agency in build decisions, methodology actions, backlog management, and every accepting pluggable skill. More agency accepts some "wrong call, revert it" decisions. Project direction lives in the **spec** (front-loaded architecture); past that gate, appetite governs execution without checking back. Every faff sub-skill reads the current level:

| Level | Intent |
|---|---|
| `low` | Conservative — park on anything non-obvious; minimal autonomous agency. |
| `medium` | Cautious — proceed only when the call is clear; otherwise park. |
| `high` (default) | Confident — proceed on defensible calls with an audit trail; park architectural/irreversible only. |
| `full` | Maximum agency — resolve everything resolvable, document, proceed; only the hard floor below ever stops it. |

Each accepting skill **documents its per-level response** in its `SKILL.md`. The gateway owns the vocabulary, hard floor, and shared-contract modulation tables: resolve-attempt, automation-routing (the `routing_adaptor` slot), and methodology tracker-topology writes (below). Per-skill behaviour stays in the skill.

#### Build pipeline (modulation of the resolve-attempt + automation-routing contracts)

| | low | medium | high (default) | full |
|---|---|---|---|---|
| `confidence: medium` spec | Park (rating retained) — no resolve-attempt | Resolve-attempt (conservative) → proceed if clear, else park | Resolve-attempt → proceed if defensible, else park | Proceed — resolve inline, document, don't park |
| `confidence: low` spec | Park | Park | Park | Resolve-attempt → proceed if any defensible path exists; park only if genuinely unknowable |
| Punt markers | Park (no resolve-attempt) | Resolve-attempt with conservative thresholds | Resolve-attempt with widened thresholds | Resolve all Punts — pick the most defensible answer, document, proceed. No Punt parks. |
| `gap-blocked` verdict | Park | Resolve-attempt per verdict rules | Proceed if gap can be worked around | Proceed — file the gap ticket and continue regardless |
| `circular-blocked` verdict | Park | Resolve-attempt (unambiguous break-edge only) | Accept most plausible break-edge | Break the cycle at any plausible edge, document, proceed |
| Chain-gap auto-create / Execution-discovered auto-create | Surface only | Identifiable gap / concrete item with opinionated methodology | Identifiable gap / concrete item even without methodology | File every identifiable gap / concrete item |
| Outward / new-root auto-create | Never | Never | Never | Never (hard floor) |

Graft records execution-discovered work. The orchestrator surfaces vague items at every appetite and deduplicates concrete proposals against open tickets before filing. Apply the outward floor below first.

The methodology slot's per-level response lives in the configured methodology skill. The review slot's per-level response lives in the configured review skill — note that review quality never loosens at any level (see the hard floor below).

#### Topology-write authority (modulation of the methodology's tracker-topology writes)

Apply appetite to faff-authored dependency edges, ordering, parents and project assignments. Unmarked structure is human-curated. Changes to human-curated structure require a proposal and confirmation at every level.

| Appetite | Tracker authority |
|---|---|
| `low` | Surface options only. |
| `medium` | Apply unambiguous defaults such as landing new work. Reparenting and conversion require greater appetite. |
| `high` (default) | Act on clear blockers, reordering, follow-up projects or moving a gating chain. Propose scope cuts for confirmation. |
| `full` | Form projects and arrange scope in one logged pass under the human-approved DoD / PRD. |

Re-read the tracker each pass and make moves idempotent. New work enters plain backlog. Keep changes reversible and preserve admitted scope.

At L4 (`full`), validate the `faff-contract:l4-topology-envelope` block against `faff contract l4-topology-envelope` (`--describe` gives the op and verdict fields). A faff-authored first-slice epic needs a confirmed parent. For a loop-authored container, establish `contained_under_accepted_prd` from the ledger's `prd_root_container` and `faff contain`. Only a contained creation qualifies under that root. Propose other container creations for confirmation. This permission covers new containers only. The floors below govern outward creation and lost scope.

#### What appetite NEVER changes (hard floor — applies at ALL levels including `full`)

- **Destructive / irreversible operations still park.** Anything that can't be undone with `git revert` and a redeploy still escalates — production data, secrets, external messaging, irreversible cloud-resource changes.
- **User-explicit "ask first" rules** in the `slots` config, in CLAUDE.md, or in spec comments override appetite. The dial doesn't punch through explicit instructions.
- **Cancellation / deletion** of issues or workstreams. No appetite level autonomously cancels or deletes. `full` adds scope (splits, merges, new tickets) but never removes it.
- **ADR supersession.** Only `faff adr admit` returning `admit` permits automatic supersession of a loop-authored ADR. Graft Step 3b applies the drift challenge, thrash limit, self-supersede and loop-over-human guards. Human and legacy ADRs (missing provenance) are propose-only. Record the proposal for `/faff-wtf` and run `faff adr supersede` on human confirmation. Appetite only grades how prominently the digest shows a refusal.
- **Outward / new-root creation.** Beep-boop and autonomous tidy use `faff discovered-scope-plan` with fresh tracker ancestry for the mandate (beep-boop, **Containment at the filing chokepoint**). Pass `--record <run-id>` in a run so both checks can be replayed. Surface `outward-new-root` for human creation, including fast-track requests. Only an `outward-self-intake` filing proposal permits same-team/repo Backlog self-intake under committed `containment.self_hosting_intake: true` (default off). Cross-team/repo work goes to the human. Audit replays the supplied ancestry. Its accuracy depends on the caller.
- **Review runs and gates.** `full` does not skip or weaken the review. If it fails, the pipeline iterates or parks — never overrides.
- **Spec quality.** Front-loaded prep still aims for `confidence: high`. `full` resolves more aggressively past the spec gate but doesn't lower the bar for what constitutes a good spec.

**Audit trail.** Every appetite-influenced decision writes a tracker comment in the standard resolve-attempt shape (see **Resolve-attempt before park** → Audit trail), tagged `(appetite: high)` — e.g. a `confidence: medium` storage choice resolved to Postgres because every other persistence site uses it.

**Calibration.** Record high-appetite decisions in `.faff/calibration/appetite-decisions/<issue-id>.md`, using the existing calibration-log shape. If `appetite: high` raises wrong-inference or post-merge-revert rates, the next `/faff-tidy` calibration-signal pass surfaces the pattern and recommends `medium` for affected work areas. Humans review run-wide decisions rather than approve each inline.

**Switching appetite.** Read the effective level with `faff config get appetite`. A valid `FAFF_APPETITE` takes precedence. Otherwise a live L4 run supplies `full`, then project config or its default applies. Project changes take effect next invocation with no per-issue override. For a single decision, use an explicit Punt to flag escalation. The hard floor applies at every level.


### Resolve-attempt before park

Before parking on `needs-decision-first`, `gap-blocked`, or `circular-blocked` verdicts (see **Automation-routing verdict (fixed)**), autonomous mode runs a **resolve-attempt**: a bounded inference step that tries to derive the answer from local context (codebase, spec surroundings, prior commits, related tracker comments). `repeat-parked` does **not** get one — the pattern itself signals that a human needs to act.

**Decisions register (first, only for `needs-decision-first`).** Run `faff decisions match --punt "<topic>" --json`. A hit supplies the human precedent's `id`, `chosen` and `rationale`. Apply it, post the register citation below and skip inference. On `{"match":null}` (including a missing register or ambiguous match) use the table. Surface an unreadable register as an error. This lookup costs no file-read allowance. Prep owns capture. Autonomous mode only reads the register.

**Per-verdict resolve rules:**

| Verdict | Resolve-attempt | Proceed if | Park if |
|---|---|---|---|
| `needs-decision-first` (Punt marker) | Re-read the Punt section. Check whether the codebase already exhibits a clear convention for the alternatives offered. Check whether `Chosen:` markers elsewhere in the spec imply the answer. Check whether related shipped issues constrained the choice. | A single clear answer falls out with high confidence | Multiple defensible answers, or the choice is architectural (user-facing API, schema, security) |
| `gap-blocked` (external dep doesn't exist) | Re-read the dependency claim. Determine whether the named dep is **load-bearing** (the work can't proceed without it) or **precautionary** (the spec mentioned it but the work can complete without). | Dep is precautionary — work can proceed; the dep can be filed as a future issue | Dep is load-bearing — actually needed for the work to compile / pass tests |
| `circular-blocked` (in dep cycle) | Re-read each edge of the cycle. Determine whether breaking one specific edge is mechanically obvious — e.g. "A blocks B" was added defensively but A's spec doesn't actually depend on B's output. | A break-edge is unambiguous (spec doesn't load-bear on it) — proceed by serialising remaining edges as a collision group | Every edge looks load-bearing — the cycle is real and a human has to redesign |

**Boundedness + appetite.** The attempt reads at most **3 files outside the spec's named scope** at `medium` appetite, **5** at `high` (default); beyond the budget, treat as park. At `high` each row's "Proceed if" widens — a single *defensible* answer suffices where `medium` needs a single *clear* one (architectural calls still escalate); at `low`, resolve-attempt does not run at all — every flagged verdict parks.

**Audit trail.** Every proceeding attempt posts a tracker comment with the Punt, evidence, choice and closing invitation:

> _Faff autonomous resolve-attempt:_ Punt: <topic>. <specific local evidence>. Proceeding with <choice>. **If this is wrong, comment on this PR before merge and faff will re-park.**

For a register hit, use _Faff autonomous resolve-attempt (decisions register):_ and cite the entry ID, `Chosen: <chosen>` and its rationale as evidence.

The PR may return to draft on correction. Apply the merge-confidence gate. Destructive operations and side effects outside PR flow still park. A register hit resolves only the first park. `repeat-parked` goes to a human.

### Control-label provisioning — `faff label` (the mechanical op)

Use the current `faff labels` JSON manifest for every lookup, tag and bulk provisioning. Select by stable `role` and use its exact `name` with the tracker MCP. In skill examples, translate default control-label names to their manifest roles. The manifest applies `tracking.control_labels` overrides and `tracking.label_prefix` (default `faff`). `faff labels --names` lists names only. Changing names on live issues requires a coordinated human relabel. An old eligibility label stops qualifying an issue.

| Operation | CLI input and tracker action |
|---|---|
| Single add or remove | Pass the issue and exact label name to `faff label add` or `faff label remove`. Each emits a `faff-contract:label-op` descriptor. Unknown names are rejected. |
| Single-select state change | `faff label transition <issue> <target-role>` takes the role. Repeat `--present-label "<name>"` for each current label from a fresh issue read. Execute the returned `ops` in order, clearing other same-group labels before adding the target. Preserve unrelated labels. |
| Human eligibility change | For `tracker_owned` entries (`automate`), tell the human which name to toggle and in which direction in the tracker UI. Add, remove and transition refuse with exit 3 and emit no descriptor. |

The CLI computes operations locally. Execute writes through the configured tracker MCP. Git-only mode computes the descriptor and skips tracker writes. Adding a present label or removing an absent one needs no write. Before applying an add (`ensure_first` on a single add), list tracker labels and create a missing definition with its manifest `name`, `color` and `description`, then tag the issue.

Graft sets `claimed` at Step 5 and clears it on terminal outcomes or retry-later release. Tidy may clear stale labels. It can return a claim older than `claim_ttl_hours` to Todo only with the configured `claimed` label. Otherwise surface it. Provider outages are machine holds. Graft sets `awaiting-review` and clears it on terminal outcomes (tidy can clear it on state change). Prep sets and clears `awaiting-spec-review` for mandatory spec-review outages.
