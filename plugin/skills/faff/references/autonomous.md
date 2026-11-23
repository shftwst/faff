# Faff gateway reference — autonomous contract

> Part of the faff gateway. Read on demand by the skills whose lane consumes it (see each skill's load-line). Cross-references of the form `gateway → **Section**` resolve against the kernel and all references pooled.

### Workable vs terminal states

`faff next` owns `TERMINAL_STATUSES = ["done","cancelled","duplicate"]` and derived `WORKABLE_STATUSES` (`bin/lib/next.js`, both `module.exports`ed). Terminal means no further work; workable statuses are `backlog`, `todo`, `in-progress`, `in-review`. Unlike the post-fetch **Ignore cancelled and archived** filter, this full partition includes Done and lets callers constrain queries to workable states.

**Per-tracker mapping** (category-driven first, name-based fallback — the same shape as *What counts as cancelled*):

| Tracker | Workable | Terminal | Constrain the query by |
|---|---|---|---|
| **Linear** | `stateCategory` ∈ {`backlog`, `unstarted`, `started`} | {`completed`, `canceled`} | pass the wanted state/category to `list_issues`'s `state` param; set `includeArchived: false` |
| **GitHub Issues** | `state = open` | `state = closed` (Done = closed-completed; cancelled = closed + `state_reason = not_planned`) | fetch `state = open` only |
| **Jira / other via MCP** | non-terminal status category | `done`/`completed` + cancellation category | category filter if exposed, else name-based fallback against the state names |

**Shared vocabulary, not a shared constraint.** Any caller may *name* this partition; the decision to **constrain a fetch to the workable side** is `/faff-beep-boop`-local (its no-issue-set query sites — see its SKILL.md). The read skills (`/faff-wtf`, `/faff-map`, `/faff-tidy`) legitimately need terminal issues and are never constrained by it.


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

**Entry preflights (autonomous only).** Run `faff run preflight` once before minting the build queue. It reads the container, host socket, GitHub credential and default-branch effective rules. Log each finding and surface it in `/faff-wtf`. Exit 0 continues. Exit 3, a config/command failure or an unreadable result stops before work, with the reported cause. The `autonomous.require_container`, `require_branch_protection` and `require_github_auth` knobs default to `warn`. Indeterminate auth and host sockets only warn here. `faff lights-out` owns its stricter floor. Interactive work skips these probes.

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
| Chain-gap auto-create | Never (surface only) | Only when methodology configured | Even without methodology, if remainder is identifiable | Always — every identifiable gap gets a ticket |
| Execution-discovered auto-create | Never (surface only) | Only when methodology configured | Even without methodology, if the item is concrete | Always — every concrete discovered item gets a ticket |
| Outward / new-root auto-create | **Never** | **Never** | **Never** | **Never (hard floor)** |

The Execution-discovered row gates **bottom-up source (b)** — concrete out-of-scope work faff-graft recorded while building (see **Agent Lanes**). It mirrors the chain-gap row: the orchestrator (faff-beep-boop) files `concrete` items per this dial; `vague` items only ever surface, at every level. Dedup against existing open tickets before filing. The **Outward / new-root** row is the scope-containment floor — see the matching hard-floor bullet below.

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
- **Outward / new-root creation.** Before the appetite gate, beep-boop filing and tidy chain-gap auto-fill check `faff contain` against the mandate. Record `outward-new-root` and surface it for interactive creation, including fast-track requests. The only exception is same-team/repo Backlog self-intake with `containment.self_hosting_intake: true` (default off). Only `faff self-intake` exit 0 reclassifies to `outward-self-intake` from committed config. Exit 2 or 3 leaves the floor in force. Cross-team/repo work always goes to the human.
  Pass `--record <run-id>` at both containment checks. The agent supplies the ancestry. `faff audit` can replay the recorded input and verdict, but a fabricated chain can still pass.
- **Review runs and gates.** `full` does not skip or weaken the review. If it fails, the pipeline iterates or parks — never overrides.
- **Spec quality.** Front-loaded prep still aims for `confidence: high`. `full` resolves more aggressively past the spec gate but doesn't lower the bar for what constitutes a good spec.

**Audit trail.** Every appetite-influenced decision writes a tracker comment in the standard resolve-attempt shape (see **Resolve-attempt before park** → Audit trail), tagged `(appetite: high)` — e.g. a `confidence: medium` storage choice resolved to Postgres because every other persistence site uses it.

**Calibration.** Record high-appetite decisions in `.faff/calibration/appetite-decisions/<issue-id>.md`, using the existing calibration-log shape. If `appetite: high` raises wrong-inference or post-merge-revert rates, the next `/faff-tidy` calibration-signal pass surfaces the pattern and recommends `medium` for affected work areas. Humans review run-wide decisions rather than approve each inline.

**Switching appetite.** Set `appetite:` in `.faff/config.yaml` (a top-level key); takes effect on the next faff invocation. No per-issue overrides — global per project. To force escalation on a single decision regardless of appetite, use the existing Punt mechanism in the spec; explicit Punts are non-negotiable. **Level-scoped:** appetite is level-scoped, not a single global dial — at **L4** (a live `faff lights-out` run) it resolves to `full` unconditionally through the single resolution channel (`faff config get appetite`, backed by `resolveAppetite`: env `FAFF_APPETITE` → the active-L4 run's ledger, live only → config `appetite` → the baked default); config `appetite` stays authoritative for L1–L3, and the hard floor below is unaffected — `full` at L4 still means maximum agency within the floor, not "no floor."


### Resolve-attempt before park

Before parking on `needs-decision-first`, `gap-blocked`, or `circular-blocked` verdicts (see **Automation-routing verdict (fixed)**), autonomous mode runs a **resolve-attempt**: a bounded inference step that tries to derive the answer from local context (codebase, spec surroundings, prior commits, related tracker comments). `repeat-parked` does **not** get one — the pattern itself signals that a human needs to act.

**Decisions-register consult (`needs-decision-first` only — first move, before the table).** Extract the Punt topic and run `faff decisions match --punt "<topic>"` for a deterministic lookup against committed, human-authored `docs/decisions.md` (absent file → clean no-match, never an error). One confident match cites human-ratified precedent: implement its `chosen` value, write the register-hit audit comment below, and skip the table. This governance-doc lookup does **not** consume the file-read budget. No match or an ambiguous multi-match (two or more equal matches) falls through to bounded inference. Autonomous mode only **consumes** the register, never writes it (faff-prep owns capture).

**Per-verdict resolve rules:**

| Verdict | Resolve-attempt | Proceed if | Park if |
|---|---|---|---|
| `needs-decision-first` (Punt marker) | Re-read the Punt section. Check whether the codebase already exhibits a clear convention for the alternatives offered. Check whether `Chosen:` markers elsewhere in the spec imply the answer. Check whether related shipped issues constrained the choice. | A single clear answer falls out with high confidence | Multiple defensible answers, or the choice is architectural (user-facing API, schema, security) |
| `gap-blocked` (external dep doesn't exist) | Re-read the dependency claim. Determine whether the named dep is **load-bearing** (the work can't proceed without it) or **precautionary** (the spec mentioned it but the work can complete without). | Dep is precautionary — work can proceed; the dep can be filed as a future issue | Dep is load-bearing — actually needed for the work to compile / pass tests |
| `circular-blocked` (in dep cycle) | Re-read each edge of the cycle. Determine whether breaking one specific edge is mechanically obvious — e.g. "A blocks B" was added defensively but A's spec doesn't actually depend on B's output. | A break-edge is unambiguous (spec doesn't load-bear on it) — proceed by serialising remaining edges as a collision group | Every edge looks load-bearing — the cycle is real and a human has to redesign |

**Boundedness + appetite.** The attempt reads at most **3 files outside the spec's named scope** at `medium` appetite, **5** at `high` (default); beyond the budget, treat as park. At `high` each row's "Proceed if" widens — a single *defensible* answer suffices where `medium` needs a single *clear* one (architectural calls still escalate); at `low`, resolve-attempt does not run at all — every flagged verdict parks.

**Audit trail.** A proceeding resolve-attempt **always writes a tracker comment** in this format:

> _Faff autonomous resolve-attempt:_ The spec flagged this as `Punt: cron vs queue-driven send` but the codebase uses cron in every other scheduled-job site (`src/jobs/*`). Proceeding with cron. **If this is wrong, comment on this PR before merge and faff will re-park.**

A register-driven proceed writes the citation variant instead — naming the matched entry + chosen value rather than narrating an inference:

> _Faff autonomous resolve-attempt (decisions register):_ The spec flagged this as `Punt: pino vs winston`. The committed decisions register entry `logging-library` records `Chosen: pino` (Rationale: pino is the house structured-JSON logger). Proceeding per that human-ratified precedent. **If this is wrong, comment on this PR before merge and faff will re-park.**

The PR can be flipped back to draft if the call was wrong; the merge-confidence gate is the backstop. **Scope:** resolve-attempt bypasses no safety boundary: side-effects-outside-PR-flow and destructive operations still park unconditionally. It applies only to the three verdicts above. Register consult adds no verdict and pre-empts only the **first** park; `repeat-parked` still gets no resolve-attempt.

### Control-label provisioning — `faff label` (the mechanical op)

Use the current `faff labels` JSON manifest for every lookup, tag and bulk provisioning. Select by stable `role` and use its exact `name` with the tracker MCP. In skill examples, translate default control-label names to their manifest roles. The manifest applies `tracking.control_labels` overrides and `tracking.label_prefix` (default `faff`). `faff labels --names` lists names only. Changing names on live issues requires a coordinated human relabel. An old eligibility label stops qualifying an issue.

| Operation | CLI input and tracker action |
|---|---|
| Single add or remove | Pass the issue and exact label name to `faff label add` or `faff label remove`. Each emits a `faff-contract:label-op` descriptor. Unknown names are rejected. |
| Single-select state change | `faff label transition <issue> <target-role>` takes the role. Repeat `--present-label "<name>"` for each current label from a fresh issue read. Execute the returned `ops` in order, clearing other same-group labels before adding the target. Preserve unrelated labels. |
| Human eligibility change | For `tracker_owned` entries (`automate`), tell the human which name to toggle and in which direction in the tracker UI. Add, remove and transition refuse with exit 3 and emit no descriptor. |

The CLI computes operations locally. Execute writes through the configured tracker MCP. Git-only mode computes the descriptor and skips tracker writes. Adding a present label or removing an absent one needs no write. Before applying an add (`ensure_first` on a single add), list tracker labels and create a missing definition with its manifest `name`, `color` and `description`, then tag the issue.

Graft sets `claimed` at Step 5 and clears it on terminal outcomes or retry-later release. Tidy may clear stale labels. It can return a claim older than `claim_ttl_hours` to Todo only with the configured `claimed` label. Otherwise surface it. Provider outages are machine holds. Graft sets `awaiting-review` and clears it on terminal outcomes (tidy can clear it on state change). Prep sets and clears `awaiting-spec-review` for mandatory spec-review outages.
