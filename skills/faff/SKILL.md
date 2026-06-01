---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-wtf to figure out what to focus on, /faff-whereto for the strategic roadmap view above /faff-wtf, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-workit to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

The stuff you do before actual work — but automated. This is a gateway — invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-whereto` | "Roadmap", "where are we going", "explain the backlog", "do these join up", "workstream view", "strategy view", "what are the chains", "big picture", "walk me through the plan" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-workit ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |
| `/faff-beep-boop` | "Run overnight", "fire and forget", "chew through the backlog", "unattended" |

## Configuration (shared across all sub-skills)

All faff sub-skills read their configuration from a **`.faffrc`** file at the repo root. Three filename forms are accepted, all parsed as YAML: **`.faffrc.yaml`**, **`.faffrc.yml`**, or the extensionless **`.faffrc`**. **Exactly one may exist** — if more than one is present at the repo root, faff stops with an error and asks you to consolidate to a single file rather than silently picking one. Any key the file doesn't set falls back to faff's built-in default; a missing `.faffrc` altogether means all defaults apply. (Template files are exempt: any name containing `.example` is never counted or loaded.)

`CLAUDE.md` is **no longer a faff config source.** It remains the consuming project's own documentation — sub-skills may still read it for soft *context* (current-workstream priority, naming/grouping conventions) but never for configuration values.

**Resolver.** A bundled helper — `~/.claude/skills/faff/faffrc` (run with `python3` if not executable) — performs file resolution and parsing mechanically so sub-skills don't hand-parse YAML:

- `faffrc path` — print the resolved config file (exit 3 if none; `.example` files are never loaded).
- `faffrc get <dotted.key> [-d DEFAULT]` — print a scalar value (e.g. `faffrc get tracking.team_key`); prints DEFAULT / empty and exits 3 when absent.
- `faffrc spec-docs-path [--create]` — print the spec-docs directory with the default rule already applied; `--create` makes it.

It uses PyYAML when installed and otherwise a built-in parser for the documented subset. Sub-skills shell out to it for any value that drives a **scripted action** (notably the spec-docs path → mkdir + commit) so resolution is mechanical, not eyeballed. Softer values the agent only reasons with (`mode`, `working_patterns`) can also be read this way but gain less from it.

Full schema (every key optional unless noted; shown with example values):

```yaml
# .faffrc.yaml — faff configuration, repo root
tracking:
  tracker: linear            # linear | github | jira | … (autodetected from available MCP if omitted)
  team_key: SHF              # tracker team/board key
  project_id: "abc-123"      # tracker project/team id
  repo: shftwst/faff         # org/repo slug
  git_host: github           # github | gitlab | gitea | … (autodetected if omitted)
  spec_docs_path: docs/specs/                                   # where faff-workit commits specs (see Spec docs location)
  backlog_methodology: docs/operations/backlog-organization.md  # methodology doc used by faff-whereto
  working_patterns: |        # free-text scheduling / working-pattern notes (read by faff-wtf)
    Deep-work mornings; avoid recommending large builds after 4pm.

planning_skills:             # optional delegation slots; each has a faff default when unset
  spec: superpowers:brainstorming                    # used by faff-prep
  plan: superpowers:writing-plans                    # used inside faff-workit
  parallel: superpowers:dispatching-parallel-agents  # used by faff-beep-boop for concurrency
  review: gstack:review                              # pre-PR review inside faff-workit
  ship: gstack:land-and-deploy                       # merge/deploy mechanism inside faff-workit

# mode: delivery-lead is DEPRECATED — use planning_skills.methodology instead

calibration:
  repeat_park_window_days: 14         # signal lookback for calibration thresholds
  repeat_park_threshold: 4            # ≥N same-root-cause park events in the window → surface a signal
  repeat_park_demote_window_days: 21  # lookback for the Todo→Backlog demotion rule
  repeat_park_demote_threshold: 3     # ≥N parks in that window → demote a repeat-parked Todo
```

**Stable config only — never mutable state.** `.faffrc` holds stable identifiers and preferences (project ids, team keys, repo slugs, slot choices). It must never carry milestone lists, target dates, progress percentages, issue snapshots, or "current cycle" notes — anything that can change in the tracker is fetched live on every invocation. If a sub-skill needs mutable data, it refetches from the tracker via the configured MCP.

Faff auto-detects which issue tracker and git host MCP servers are available and adapts accordingly — `tracking.tracker` / `tracking.git_host` only pin the choice when autodetection is ambiguous. It works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP. If no tracker MCP is available, it falls back to git-only mode (commits, branches, PRs).

### Spec docs location

When `/faff-workit` starts a build it commits the spec into the repo so it ships in the same PR as the code (see **Spec discovery** below and the faff-prep / faff-workit artifact lifecycle). The in-repo directory is configurable via the `tracking.spec_docs_path` key in `.faffrc`:

```yaml
tracking:
  spec_docs_path: docs/specs/
```

- **Default when unset:** a `specs/` directory inside the repo's docs folder, resolved at use time:
  1. If `docs/` exists at the repo root → `docs/specs/`.
  2. Else if `doc/` exists at the repo root → `doc/specs/`.
  3. Else → create `docs/` and use `docs/specs/`.
  
  If both `docs/` and `doc/` exist, prefer `docs/`. Create the `specs/` subdirectory if it's missing.
- The value is a directory **relative to the repo root**. A trailing slash is optional.
- The filename within it is unchanged: `YYYY-MM-DD-<issue-id>-<slug>-design.md`.
- This only relocates the spec **within the same repo** — the spec still lands on the feature branch and ships with the PR. It is not a pointer to a separate repository.

Every faff sub-skill that reads or writes the committed spec resolves the directory from this key, falling back to the default-resolution rule above when it's absent. The `faffrc spec-docs-path [--create]` resolver applies this exact rule — sub-skills call it rather than re-deriving the path. References below to a default of `docs/specs/` are shorthand for that rule (i.e. `doc/specs/` when only `doc/` exists). Spec discovery globs `<spec-docs-path>/*-<issue-id>-*.md`.

### Planning Skills (optional delegation slots)

Faff delegates specialised work to configured skills. Slots live under the `planning_skills:` key in `.faffrc`. All slots are optional — each has a sensible faff default when unset.

```yaml
planning_skills:
  spec: superpowers:brainstorming                    # used by faff-prep
  plan: superpowers:writing-plans                    # used inside faff-workit, optional
  parallel: superpowers:dispatching-parallel-agents  # used by faff-beep-boop for concurrency, optional
  review: gstack:review                              # pre-PR review inside faff-workit, optional
  adversarial_review: faffter-dark-adversarial-review # second-opinion review via different model, optional
  holdout_tests: faffter-dark-holdout                 # holdout test generation via different model, optional
  methodology: faffter-dark-methodology-agile-delivery             # diagnostic lens over backlog state, optional
  ship: gstack:land-and-deploy                       # merge/deploy mechanism inside faff-workit, optional
```

Defaults when a slot is unset:

| Slot | Default |
|---|---|
| `spec` | Inline spec produced by faff-prep using the lite nlspec arc (WHY/WHAT/HOW/DONE). Same default in interactive and autonomous — autonomous self-rates the inline spec against the Spec Format Contract and applies the same confidence gate it would to a delegated skill's output. For the full nlspec format (formal type definitions, pseudocode procedures, appendices, integration smoke tests), set `spec: faffter-dark-nlspec`. Missing slot is **not** a park reason. |
| `plan` | faff-workit builds directly from the spec without a formal plan step. |
| `parallel` | faff-beep-boop runs sequentially. |
| `review` | faff built-in review: faff-workit plays the senior-engineer role — diff read, AC-to-test coverage, obvious-bug scan, scope check, human-judgement flagging. Emits `pass` / `fail` / `needs-human`. |
| `adversarial_review` | Skipped. When set, a second review pass runs after the primary review using a different model/tool (e.g. a local LLM via Ollama). Catches correlated blind spots by bringing independent training biases. Emits `pass` / `fail` / `needs-human` — merged with the primary review verdict (worst signal wins). |
| `holdout_tests` | Skipped. When set, holdout scenarios are generated at **prep time** (faff-prep) from the spec's acceptance criteria and stored as a separate issue comment marked `<!-- faff:holdout-scenarios -->`. Scenarios use pseudocode test format (setup/action/assert). At **gate time** (faff-workit Step 9b), the scenarios are read from the issue, translated into the project's test framework, and executed. Results posted as a PR comment but **never committed** — keeping them out of the codebase preserves independence across build cycles. The build agent does not read the holdout comment during implementation. |
| `methodology` | Structural (default). Faff applies pure structural diagnostics — chain gaps, stale blockers, dupes, splittable specs — without an opinionated delivery methodology overlay. When set, the configured skill provides a diagnostic lens (principles, diagnosis templates, rendering rules) that sub-skills invoke on top of structural analysis. The skill returns findings; sub-skills render them. |
| `ship` | Vanilla `gh pr merge` after faff's merge-confidence gate passes. |

`review`, `adversarial_review`, `holdout_tests`, and `ship` are **not** user-invokable slash commands. They are internal phases of faff-workit, with optional delegation via these slots.

## Shared Rules

These rules apply to every faff sub-skill. Sub-skills point at this section rather than re-stating.

### Ignore cancelled and archived

Every faff sub-skill excludes the following from every query, recommendation, count, and output:

- Cancelled issues (and any issue in the tracker's cancellation state category — see **What counts as cancelled** below)
- Archived issues
- Issues whose parent project is cancelled or archived
- Cancelled or archived projects themselves

**What counts as cancelled.** The literal "Cancelled" state name isn't the only one — trackers group multiple sibling states under a cancellation category, and all of them are treated as cancelled for faff's purposes. Detection is **category-driven first, name-based fallback**:

- **Linear** — any workflow state in the `cancelled` state category. By default this includes `Cancelled`, `Duplicate`, and any team-defined custom states placed in that category. Read the state-category field returned by the Linear MCP (state objects expose a `type` or `stateCategory` of `cancelled`); fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix` if category metadata is unavailable.
- **GitHub Issues** — closed issues with `state_reason = not_planned` (this covers closed-as-not-planned, including closed-as-duplicate).
- **Jira** — issues resolved with a cancellation-category resolution (`Won't Do`, `Duplicate`, `Cannot Reproduce`, or team-defined equivalents in the same category).
- **Other trackers** — fall back to a name-based match against `Cancelled`, `Duplicate`, `Won't Fix`, `Won't Do`, `Cannot Reproduce`. If the tracker exposes state categories, prefer the category-driven check.

This widened definition fixes a real failure: a tidy run that suggests cancelling tickets already in Linear's Duplicate state is recommending a no-op at best, and a status-signage downgrade at worst (Duplicate → Cancelled preserves the `duplicate-of` relation but loses the self-documenting status text).

No exceptions. Cancelled/archived items (across every state above) are invisible to faff — they are never surfaced in catch-ups, never flagged in tidy, never picked up by workit, never counted in beep-boop queues.

### Spec discovery (where to look for an existing spec)

Any faff sub-skill that asks "does this issue have a spec?" must check **all three** of the following, in order, and treat a hit in any of them as the spec:

1. **Issue tracker comments** — **the default and most common location**. faff-prep writes the spec as a comment on the issue during Phase 1 (pre-build). **Most specs live here**, not in the description.
2. **Issue tracker main description / body** — counts **only** when the body holds an actual formalised spec (the structured artefact faff-prep produces: context, approach, acceptance criteria), e.g. someone authored or pasted a real spec into the ticket body instead of a comment. A plain description — requirements, context, or notes, **however clear or well-defined** — is **not** a spec and does **not** count here.
3. **Committed docs** in the repo — under the configured **spec-docs path** (default `docs/specs/`; see **Spec docs location**), e.g. `<spec-docs-path>/YYYY-MM-DD-<issue-id>-*.md`. This is where faff-workit commits the spec on build, and where it lives post-merge. If a feature branch already has a spec committed under this path (matching the issue id), treat that as the spec even if no tracker comment exists.

**Comments are not optional.** Because faff-prep writes specs to comments by default, any spec-discovery pass that only inspects descriptions is **invalid output** — it will systematically miss the most common case and produce false "no spec" findings. Before classifying any issue as "no spec / almost ready / needs prep", you **must** fetch its comments via whichever tracker MCP is configured (use the tracker's list-comments tool — autodetect from the available MCP, don't hardcode). Sampling descriptions and noting "comments not checked" is **not** acceptable — re-fetch and complete the check before reporting.

Never assume "no spec attached" without checking all three. Finding a spec in any location is a positive. When multiple sources exist, prefer the most recently modified one and note the discrepancy in the log.

**A description is never a spec — no exceptions.** However clear, detailed, or well-defined a ticket's description is, it does not satisfy the spec gate and must be formalised into a spec via `/faff-prep` before any build. No faff sub-skill may offer to build straight from a description, skip prep because "the description is already clear," or treat well-defined requirements as a substitute for the spec. Well-defined is a reason prep will be *fast*, not a reason to skip it. The spec is the durable, reviewable artefact the build is gated on; the description is not.

### `.faff/` logging directory

Every faff skill invocation writes a structured markdown log to the repo-local `.faff/` directory. Layout:

```
.faff/
  logs/
    YYYY-MM-DD/
      HHMMSS-<skill>[-<context>].md         # one file per skill invocation
      HHMMSS-tidy-verdicts.md               # standalone-tidy automation verdict cache
  runs/
    YYYY-MM-DD-beep-boop-HH-MM-SS/          # grouped per beep-boop run
      summary.md
      automation-verdicts.md                # verdict cache for this run
      conflict-analysis.md
      ISSUE-XX/
        prep.md
        workit.md
        resolve-attempt.md                  # if autonomous resolve-attempt ran
        ac-verification.md
        park.md                             # if parked
      ...
  calibration/                              # append-only; never authoritative
    over-cautious-parks/
      <ISSUE-ID>.md
    wrong-inferences/
      <ISSUE-ID>.md
    post-merge-reverts/
      <ISSUE-ID>.md
```

The `calibration/` directory is **append-only** and **never authoritative for current decisions** — it captures evidence about over-cautious parks, wrong inferences, and post-merge reverts so resolve-attempt rules and verdict gates can evolve with data. See **Autonomous Mode Contract → Calibration log** for capture rules and the synthesis-and-surface flow.

The `automation-verdicts.md` per-run cache (and the standalone `HHMMSS-tidy-verdicts.md` equivalent) lets other sub-skills read the verdict computed by `/faff-tidy` without recomputing within a single pass. Across passes, always recompute — same "always pull fresh" rule that governs spec discovery.

Each log entry captures:

- Invocation context (args, mode — interactive or autonomous, working directory)
- MCP calls made (tool name, relevant inputs, key outputs)
- Decisions with reasoning (what was expected, what was observed, what decision was taken, why)
- Commit SHAs, PR URLs, branch names
- Errors, parks, and their causes

Logs are plain markdown — agent-readable and human-readable. A log must contain enough context that a follow-up agent, given only the log file, can pick up intelligently without needing the original conversation.

**Gitignore:** `.faff/` is added to `.gitignore` on first write if not already present. Users may un-ignore to commit logs if they want.

### Autonomous Mode Contract

Faff sub-skills can be invoked in **autonomous mode** (primarily by `/faff-beep-boop`). The mode is signalled in-conversation at the top of the invocation: _"running in autonomous mode, skip all prompts, park on ambiguity, log everything"_.

Universal rules in autonomous mode:

- **Never prompt.** Every interactive gate has a pre-defined autonomous default. If there is no safe default for a decision, park the work unit and move on.
- **Log every decision, input, and output** to `.faff/logs/…` per the layout above. The log must be sufficient to resume in a fresh conversation.
- **Park on unexpected state.** Missing MCP tool, failed query, dirty worktree, genuine ambiguity — all trigger _park + log + continue_. Never abort the whole run on a single issue.
- **"Ambiguity" means the spec is ambiguous — not that the session state is.** Things about your own runtime are never valid park reasons:
  - Context compaction (current or anticipated) — the harness handles compaction; the `.faff/` logs + tracker + PR state make every work unit resumable across compactions. A compacted session is not an ambiguous one.
  - Session length, turn count, "this will take many steps", "I've already done a lot this session" — none of these are ambiguities. Do the work.
  - Worries about whether you'll remember earlier steps — you don't need to. The log captures what was decided; the tracker captures status; git captures diffs. Future-you (or a resumed session) reads state, it doesn't remember it.
  - Beep-boop processes issues serially (or via the `parallel` slot). Each `/faff-workit` invocation is an independent unit — if compaction happens mid-build, resume from `.faff/runs/<run-id>/ISSUE-XX/workit.md` + the branch/PR state. This is a feature, not a risk.
  - **Forbidden park reasons (explicit list):** "session may compact", "context is getting long", "too many turns", "too many issues left in the queue", "risk of another compaction", "mid-build compaction would be ambiguous", "single-session capacity constraints", "single-conversation context budget", "honest orchestration is to do fewer", "depends on a Todo issue that's also in this run", "large scope + external dep addition", "would introduce a new package as first LLM/SDK/XXX site", "chained issue — waiting for earlier to ship", "no `spec` skill configured", "no `plan` skill configured", "no `parallel` skill configured", "no `review` skill configured", "no `ship` skill configured", "Planning Skills slot unset". If one of these is the reason, **just proceed** — use the documented inline default (see `Planning Skills` defaults table above) or serialise via conflict analysis — it's not a real park. Autonomous mode uses the **same** sensible defaults as interactive when a slot is unset; missing slots are not capacity constraints.
- **"Deferred" / "queued for next run" / "not dispatched this conversation" is the same thing as "parked", just relabelled.** Renaming the category doesn't change the failure mode: ready work that should have been dispatched didn't get dispatched. Any of these phrasings — "deferred to next pass", "saved for the next /faff-beep-boop", "queue is unblocked, ready for next run", "single-conversation context budget", "didn't dispatch this conversation" — is a forbidden bail under a different name. If you find yourself writing one of those phrases in a run summary, the run is **not complete**: go back and dispatch the queue. The only valid run-end states are (i) the queue drained, (ii) every remaining issue is genuinely parked under one of the three valid categories, or (iii) the harness terminated the session externally (which leaves a `.faff/runs/<run-id>/` resumable from the next invocation — not a "deferred" state authored by you).
- **If conflict analysis produced a build queue, dispatching it is the next mandatory step.** Identifying waves and partitioning into independents/collision groups is not the finish line — it's the precondition to building. A run that ends after conflict analysis with the queue undispatched is an incomplete run, not a deferred one. Compaction during build is a resume (the `.faff/runs/<run-id>/` directory + PR/branch state make it resumable from a fresh session); pre-emptively stopping because compaction *might* happen is the same anti-pattern as pre-parking on "session may compact" — explicitly forbidden above.
- **Log entries always include:** what was expected, what was observed, what decision was taken, and why.
- **Spec-closed decisions stay closed. Never re-litigate them.** When reading a spec in autonomous mode, parse for **decision markers**, not topic keywords:
  - Sections ending with `Chosen: X`, `**Chosen:** X`, `Decision: X`, or equivalent conclusion markers are **closed**. Do the thing the spec chose. A "pino vs winston" rationale table that ends in `Chosen: pino` is not an open question — it is a locked decision.
  - A spec self-rated `confidence: high` closes every spec-internal decision. Trust the contents. Park only on external unknowns.
  - **Spec punts are explicit.** Markers include `Punt:`, `needs human`, `TBD`, `unresolved`, `(or X if Y is too much)`, "revisit", or any sentence presenting two options without picking one. Only these escalate.
- **The review skill is the autonomous human-review gate.** Every autonomous build lands as a **regular (ready-for-review) PR** and runs the configured `review` skill (or faff-workit's built-in review if none is configured) as a senior-engineer stand-in. The review's job is to decide whether this PR can merge on green, or whether a human actually has to look first. On pass → auto-merge when CI is green and ACs are verified. On `needs-human` → flip the PR to draft and park for human attention. On `fail` (fixable issues — failing tests, obvious bugs, missing test coverage) → iterate autonomously, re-run review, keep going until pass or `needs-human`. **Work that lands via PR is reversible by definition** — `git revert` exists. Pre-parking is wasteful when the review + merge-confidence gate already catches mistakes. Chained issues depend on earlier PRs merging; over-parking at the pre-PR stage breaks the pipeline.
- **Valid autonomous parks (escalate to human pre-PR):** only four categories — (a) the spec contains an explicit punt marker, (b) the spec assumes external state that doesn't exist in the repo (missing dep, undefined seam, blocker issue not shipped **and not in the current run's queue**), (c) the work cannot be fully reversed by `git revert` on the merge commit — i.e. it would execute a **side effect outside the PR flow** before the human reviews it, (d) the spec's premise is substantially superseded by separate already-merged work, with required Done-ticket-ID evidence cited in the park comment.
- **In-queue dependencies are serialisation, not parks.** If issue A depends on issue B, and B is in the current beep-boop run's build or prep queue, that is a **collision group** — build B first, then A in the same run. Do NOT park A for "depends on B" when B is Todo/Backlog-in-queue. The conflict analysis step (see `skills/faff-beep-boop/SKILL.md`) exists precisely to serialise these. Parking chained work is the failure mode that breaks the pipeline: if a queue of 5 chained issues all park because "the next one isn't Done yet", nothing ships.
- **External dependency additions (new SDK, new package) are not a park category.** If the spec has a `Chosen:` / `Decision:` marker naming the package, the decision is closed — proceed. Adding a package to `package.json` lands via PR and is caught by the review + merge-confidence gate. "Introduces new external dep" is a topic-keyword match, not a park reason.
- **Scope size is not a park category.** "Large scope", "many files touched", "significant surface area", "too many issues left to do", "only time for one" — none of these are in the three valid categories. The review step judges scope creep *relative to the spec*; if the diff matches what the spec asked for, scope is fine regardless of size. If there are too many issues to do in one run, that is solved by parallelism or by the run ending naturally when the queue drains — not by pre-parking to save effort.
- **What "side effect outside the PR flow" actually means:** producing state changes that persist regardless of whether the PR lands. Examples: dropping or migrating production database tables, deleting or renaming S3 buckets / cloud resources, rotating or revoking secrets, sending emails or webhooks to real recipients, publishing packages to a registry, force-pushing to a protected branch, running one-off scripts against prod. These genuinely need pre-approval because the PR gate can't catch them after the fact.
- **What is NOT a valid park, even if the CLAUDE.md topic list mentions it:** edits to files that only take effect after merge. This includes `netlify.toml`, `.github/workflows/*.yml`, `Dockerfile`, `package.json` dep bumps, migration SQL files (as long as they are not *executed* pre-merge), IaC definitions, CI config, build config. These all land via PR; the PR review is the gate. A CLAUDE.md rule like "modifying CI/CD requires confirmation" means *the PR review is the confirmation* — not a pre-park.
- **Rule of thumb:** ask "if I merge this PR and it turns out wrong, can I fix it with `git revert` and a redeploy?" If yes → proceed, let the PR gate catch it. If no (because damage happened before or independent of the merge) → park.
- **Invalid autonomous parks (just proceed):** anything outside the three valid categories above. Stylistic second-guessing, "did the author really mean X?", topic-keyword matches on sections that the spec has already closed, conflating "this touches sensitive files" with "this needs pre-approval". If the spec has an answer and the PR gate will catch mistakes, that is the answer.
- **Post-merge housekeeping failures never halt the queue.** Deleting a merged local branch, removing a worktree, returning to the main working directory, tracker-side status bumps, label cleanup — these are **post-ship housekeeping**, not load-bearing steps. The work that mattered (spec → build → review → CI → merge) is already done and persisted. If any of these housekeeping steps fails (permission error because the shell is still inside the worktree, branch currently checked out, tracker transition rejected, label already removed, etc.) — **skip the failing step, log it, move on to the next issue in the queue**. Never prompt. Never park the merged issue. Never ask the human to resolve it mid-run. Accumulate the skipped items in a per-run "human follow-ups" list that is surfaced in the final run summary (see `skills/faff-beep-boop/SKILL.md` Reporting). The golden rule: anything that happens *after* the PR is merged and cannot be undone by a human in a minute from the run summary is not worth halting the pipeline for.

Per-skill autonomous specifics live in each sub-skill's `Autonomous Mode` section. Summary:

| Skill | Autonomous behaviour (high-level) |
|---|---|
| faff-tidy | Auto-archive merged/cancelled + auto-reparent obvious orphans only. Everything else logged for morning review. |
| faff-wtf | Return the ready-queue as a plain list. No focus recommendation. |
| faff-whereto | Return the structured roadmap synthesis (initiatives, workstreams, chain join-up, fireable/blocked gates, structural risks). Read-only — never writes to the tracker. |
| faff-prep | Stale-refresh when original design still holds; auto-spec from scratch (delegated **or** inline) when self-rating clears the appetite-aware confidence gate (see **Appetite for destruction**). At `medium` appetite (default): `high` proceeds, `medium/low` park. At `high` appetite: `high` proceeds; `medium` runs resolve-attempt + decision-doc + proceeds; `low` parks. Missing `spec` slot is **not** a park reason — inline path self-rates and uses the same gate. |
| faff-workit | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park. Post-build → AC verification → review (pass/fail/needs-human). `pass` → auto-merge on green CI (unblocks chained issues). `fail` → iterate. `needs-human` → flip PR to draft, park. |

### Appetite for destruction

A project-level dial in CLAUDE.md (`Project Tracking → appetite: low | medium | high`, default `medium`) that tunes how aggressively autonomous mode self-resolves ambiguities vs. escalates to the human. The name signals the underlying tradeoff: more autonomous decisions ship faster but accept a small rate of "wrong call, revert it" — projects that need ground-truth-perfect at every step set `low`; projects that want the pipeline to chew through work between human reviews set `high`.

The reason this dial exists: the autonomous pipeline's value collapses when it brings every minor call back to the human. A pipeline that parks on every `confidence: medium`, every Punt, every gap-blocked verdict, demands the same input from the human as building the thing manually would — except now they have to also context-switch into "interpret faff's parks" mode each time. The human's control over project direction lives in the **spec** (front-loaded, considered architecture); past the spec gate, autonomous mode's job is to execute the spec's intent and document its calls. `appetite` lets the user adjust where that line sits.

**low — maximum caution.** Park on any ambiguity. `confidence: medium` parks. `confidence: low` parks. Resolve-attempt does not run on Punt markers — every Punt parks. Use when the project is regulated, security-sensitive, or the human wants to vet every architectural call.

**medium (default) — the existing contract.** `confidence: high` admits to autonomous build. `confidence: medium` parks for human review. `confidence: low` parks. Resolve-attempt runs on the three verdicts (`needs-decision-first`, `gap-blocked`, `circular-blocked`) per the per-verdict resolve rules table with conservative thresholds.

**high — "sort it out yourself."** The pipeline makes calls and documents them; only escalates for genuinely irreversible or architecturally significant decisions. Mechanically:

- `confidence: medium` **no longer parks**. It runs a resolve-attempt that reads the codebase, applies the project's CLAUDE.md conventions, picks the most defensible answer, and documents the call in the spec as a `Decision (faff-resolved, appetite: high):` line before proceeding to build. `confidence: low` still parks.
- Punt-marker resolve-attempt thresholds widen: a single **defensible** answer proceeds (vs the medium-appetite "single clear answer"). Resolve-attempt budget grows from 3 to 5 files outside spec scope.
- `gap-blocked` proceeds when the gap can be worked around — the missing piece is filed as a follow-up ticket via the chain-gap auto-create path, and current work compiles without it.
- `circular-blocked` proceeds when any edge in the cycle is non-load-bearing (existing contract requires the break-edge to be unambiguous; `high` accepts the most plausible break-edge with audit trail).
- Chain-gap auto-create runs even without a methodology skill at `high` appetite, as long as the un-ticketed remainder is identifiable. `high` drops the default-mode surface-only safety net.

**What `high` does NOT change:**

- The four valid escalation categories — explicit Punt with no resolve-attempt answer, missing external state that's load-bearing, side-effect-outside-PR-flow, premise-superseded by already-merged work — still escalate. High appetite shrinks how aggressively we interpret "ambiguous" or "missing"; it doesn't remove the floor.
- **Spec quality.** Front-loaded prep still aims for `confidence: high` with considered architecture. Appetite tunes the autonomous-build gate, not the spec-writing rigour. `fire-and-forget` admission still requires `confidence: high`; high appetite admits more `medium` specs after self-resolve, which routes them as `likely-fire` with the decision documented.
- **Destructive / irreversible operations still park** regardless of appetite. Anything that can't be undone with `git revert` and a redeploy still escalates — production data, secrets, external messaging, irreversible cloud-resource changes.
- **User-explicit "ask first" rules** in Planning Skills, in CLAUDE.md, or in spec comments override appetite. The dial doesn't punch through explicit instructions.

**Audit trail.** Every appetite-influenced decision writes a tracker comment in the same shape as the standard resolve-attempt, tagged `(appetite: high)`:

> _Faff autonomous resolve-attempt (appetite: high):_ The spec rated this `confidence: medium` on the storage-layer choice between Redis and Postgres. The codebase uses Postgres for every other persistence site (`src/db/*`) and Redis only for caching in `src/cache.ts`. Proceeding with Postgres. **If this is wrong, comment on this PR before merge and faff will re-park.**

**Calibration.** High-appetite decisions accumulate in `.faff/calibration/appetite-decisions/<issue-id>.md` (same shape as the existing calibration logs). If `appetite: high` produces an elevated rate of wrong-inferences or post-merge-reverts, the next `/faff-tidy` calibration-signal pass surfaces the pattern and recommends dialling back to `medium` for the affected work areas. This is how the human keeps directional control without micro-managing every call — they see what got decided across a run, not approve each one inline.

**Switching appetite.** Set in CLAUDE.md once; takes effect on the next faff invocation. No per-issue overrides — global per project. To force escalation on a single decision regardless of appetite, use the existing Punt mechanism in the spec; explicit Punts are non-negotiable.

### Resolve-attempt before park

Before parking on `needs-decision-first`, `gap-blocked`, or `circular-blocked` verdicts (see **Automation-routing contract**), autonomous mode runs a **resolve-attempt**: a bounded inference step that tries to derive the answer from local context (codebase, spec surroundings, prior commits, related tracker comments).

`repeat-parked` does **not** get a resolve-attempt — the pattern itself signals that a human needs to act.

**Why this exists.** Interactive Claude routinely completes work that autonomous Claude parks, because the autonomous gate is over-literal: it checks for a marker (`Punt:`, `TBD`, `needs human`) and parks on the marker's existence. Interactive Claude reads the same marker, evaluates whether the answer is actually obvious from the codebase, and proceeds. The resolve-attempt gives autonomous mode the same evaluative step, with a safety log.

**Per-verdict resolve rules:**

| Verdict | Resolve-attempt | Proceed if | Park if |
|---|---|---|---|
| `needs-decision-first` (Punt marker) | Re-read the Punt section. Check whether the codebase already exhibits a clear convention for the alternatives offered. Check whether `Chosen:` markers elsewhere in the spec imply the answer. Check whether related shipped issues constrained the choice. | A single clear answer falls out with high confidence | Multiple defensible answers, or the choice is architectural (user-facing API, schema, security) |
| `gap-blocked` (external dep doesn't exist) | Re-read the dependency claim. Determine whether the named dep is **load-bearing** (the work can't proceed without it) or **precautionary** (the spec mentioned it but the work can complete without). | Dep is precautionary — work can proceed; the dep can be filed as a future issue | Dep is load-bearing — actually needed for the work to compile / pass tests |
| `circular-blocked` (in dep cycle) | Re-read each edge of the cycle. Determine whether breaking one specific edge is mechanically obvious — e.g. "A blocks B" was added defensively but A's spec doesn't actually depend on B's output. | A break-edge is unambiguous (spec doesn't load-bear on it) — proceed by serialising remaining edges as a collision group | Every edge looks load-bearing — the cycle is real and a human has to redesign |

**Boundedness.** The attempt reads at most **3 files outside the spec's named scope** at `medium` appetite (default). At `high` appetite the budget grows to **5 files**. Beyond the budget, treat as park. Keeps cost contained and avoids rabbit-hole investigations.

**Appetite-aware thresholds.** At `appetite: high` (see **Appetite for destruction**), each row's "Proceed if" column widens — a single *defensible* answer is enough where `medium` appetite requires a single *clear* answer. The "Park if" thresholds narrow correspondingly: architectural calls still escalate, but stylistic or convention-following calls proceed with the audit-trail comment. At `appetite: low`, resolve-attempt does not run at all — every flagged verdict parks.

**Audit trail.** A proceeding resolve-attempt **always writes a tracker comment** in this format:

> _Faff autonomous resolve-attempt:_ The spec flagged this as `Punt: cron vs queue-driven send` but the codebase uses cron in every other scheduled-job site (`src/jobs/*`). Proceeding with cron. **If this is wrong, comment on this PR before merge and faff will re-park.**

This makes the inference reviewable. The human sees what was decided and why; the PR can be flipped back to draft if the call was wrong; the merge-confidence gate is the backstop.

**What resolve-attempt does NOT do.** It does not bypass existing autonomous safety boundaries. Side-effects-outside-PR-flow (per the rules above) still park unconditionally. Destructive operations still park unconditionally. The resolve-attempt only applies to the three verdicts above, where over-literal marker matching is the dominant park-cause.

### Calibration log

Captures evidence about over-cautious parks, wrong inferences, and post-merge reverts so the resolve-attempt rules and verdict gates can evolve with data.

**Capture points (append-only):**

| Event | Path | Captured |
|---|---|---|
| Autonomous-park then interactive-complete-no-questions | `.faff/calibration/over-cautious-parks/<issue-id>.md` | Park reason, root-cause class, what the interactive resolution actually was (read from the commit / PR) |
| Autonomous-resolve-attempt then human-overrode | `.faff/calibration/wrong-inferences/<issue-id>.md` | Original marker, inferred answer, human's correction |
| Autonomous-shipped then post-merge-reverted within 7 days | `.faff/calibration/post-merge-reverts/<issue-id>.md` | Shipped commit SHA, revert commit SHA, the diff between them, any comments on the revert |
| Appetite-influenced decision (at `appetite: high`, autonomous proceeded on `confidence: medium` or widened-threshold resolve-attempt) | `.faff/calibration/appetite-decisions/<issue-id>.md` | The verdict, the spec marker, the inferred answer, the audit-trail comment posted, and the merge outcome (pass / human-overrode / post-merge-reverted) once known. Pairs with the wrong-inferences and post-merge-reverts captures above for the cross-cut "is `high` over-shooting?" tidy signal. |

**Synthesis and surfacing.** Every `/faff-tidy` run (or the equivalent step within `/faff-wtf` when no tidy ran this pass) reads the calibration log and surfaces patterns when they cross a threshold:

> _Calibration signal:_ Your autonomous mode parked 4 issues in the last 14 days flagged `needs-decision-first` on `Punt: pino vs winston`. All 4 completed interactively without questions. The codebase has used pino since SHF-92 shipped (3 months ago). Consider: (a) extending the resolve-attempt rules to recognise this pattern, (b) running `/faff-prep --refresh` on the affected issues to update their specs with `Chosen: pino`, or (c) ignore — no change.

Surfaced signals are **advisory** — they suggest a fix but never auto-apply rule changes.

**Critical invariant.** The calibration log is **append-only and never authoritative**. A skill never reads calibration to make a current decision; only humans (or the skills' future iterations) read it to evolve the rules.

**Threshold (configurable in `.faffrc`):** signals surface when ≥4 events of the same root-cause class accumulate in the last 14 days. Tune as needed once real data accumulates.

### Park protocol (shared)

Every faff skill that can park work follows the same protocol:

1. Commit WIP with a clear message (if a branch/worktree exists for this unit of work).
2. Open or update the PR as **draft**.
3. Post a comment on the tracker issue: cause, what was attempted, what is needed from a human. Tag the issue as `parked-by-faff` (or the tracker's equivalent label) so `/faff-wtf` can surface it.
4. Write to `.faff/logs/…` with the full context.
5. Return control to the caller (beep-boop or interactive invoker).

## Chaining pattern

When a faff skill's flow leads naturally into another faff skill, it offers the next step via a yes/no gate (or a short-choice prompt where there is a real branch like Build/Review/Reprep). On confirm, it invokes the next skill via the `Skill` tool in the same conversation. On deny, it stops cleanly.

No faff skill uses passive "run `/faff-*` next" or "you should run" language. Every chain point is an explicit gate.

## Visualisation-over-prose contract

When output describes **structure** (chain, partition, cycle, queue, workstream layout, fire/blocked gate map, dep graph), render it as a compact visual. Reserve prose for diagnosis, decision, and "do this next" recommendation.

Test: if a reader can point at the visual and ask "is this right?" without re-reading prose, it's the right form.

### Canonical visual forms

Sub-skills pick from this catalogue. Inventing new visual forms inline is forbidden — if a skill needs a sixth form, this section gains it first.

**(a) Cycle bracket** (3+ items inline)

```
[ISSUE-AA → ISSUE-BB → ISSUE-CC → ISSUE-AA]
```

Used for any dep cycle, any collision-group serialisation, any "X depends on Y" chain rendered inline. 3+ items only — for a 2-item dep, use plain prose.

**(b) Cycle box** (4+ edges or branching)

```
ISSUE-AA ──► ISSUE-BB ──► ISSUE-CC
   ▲                          │
   └──────────────────────────┘
```

Used when the cycle has 4+ edges or when branching makes the bracket form unreadable.

**(c) Queue partition grid**

```
fire-and-forget (independents)        likely-fire (serialised)
  ISSUE-XX                              [ISSUE-A → ISSUE-B]   src/auth/
  ISSUE-YY                              [ISSUE-C → ISSUE-D]   db migrations
```

Used in wtf's "Build queue" section and beep-boop's summary. Each cell has the ID + the synthesis gloss (one line per ID — see **Synthesis contract**).

**(d) Workstream lane** (already in `/faff-whereto`; canonicalised here)

```
Initiative — Audit-lite reliability

Now    Logging cleanup            [started]   ISSUE-XX, ISSUE-YY
Next   Audit log retention        [planned]   ISSUE-ZZ
Later  (no project planned)       ⚠ structural gap
```

**(e) Gate fire-status table** (already in `/faff-whereto`; canonicalised here)

```
| Gate                            | Currently fireable? | Notes                            |
|---------------------------------|---------------------|----------------------------------|
| Logging → Audit retention       | Yes                 | once SHF-217 ships               |
| Audit retention → Audit lite    | ⚠ Blocked           | downstream project doesn't exist |
```

### When prose still wins

Three carve-outs where prose stays:

1. **The synthesis gloss itself** (see **Synthesis contract**) — the plain-English one-liner is the whole point; a glyph won't help.
2. **Diagnosis lines** — "Recommendation: strip the CC→AA edge (defensive-only)." A visual can't carry "what to do".
3. **TL;DR** — `/faff-whereto`'s Phase 8 stays prose. Skim-in-10-seconds is the job; visuals at the top invert that.

### Tabular data: markdown tables vs definition lists

Markdown tables break in narrow terminals when cells are long. They render as `Column 1: …` repeated per row, mid-word truncation, and rows crashing into each other — the data is technically present but unreadable.

**Scope:** this rule applies to **user-facing terminal output** emitted by faff sub-skills (`/faff-tidy` diagnostics, `/faff-wtf` morning briefs, `/faff-whereto` roadmap renders, `/faff-beep-boop`'s in-conversation summary, etc.). It does **not** apply to skill source files (`skills/*/SKILL.md`) — those are documentation read in wider contexts (Claude Code editor panes, GitHub UI), where specification tables with prose cells are fine. It also does not apply to internal `.faff/runs/<run-id>/…` logs.

**Drop the markdown table when any of:**

1. Any cell exceeds ~30 characters.
2. Any cell contains multi-sentence prose.
3. Total table width (cells + separators) likely exceeds ~80–120 chars.

When none of these fire, markdown tables remain the right choice — they're compact and scannable for short-label tabular data (verdict counts, status counts, single-word rows).

**Use definition-list / key:value blocks instead.** Each conceptual table row becomes a block of `Key: value` lines separated by the unicode box-drawing rule `────────────────────────────────────────` (`─` × 40). The lead-in line names the row's primary identifier; subsequent lines carry the columns. Example — broken markdown table on the left, definition-list rewrite on the right:

```
| Ticket | Title                   | State | Scope                                   |
|--------|-------------------------|-------|-----------------------------------------|
| SHF-X  | Prompt substrate retar… | Done  | Different — moved prompts, not stage l… |
| SHF-Y  | HMAC envelope + BG wo…  | Done  | Different — wrapper layer, not stage l… |
```

Rewritten:

```
Ticket: SHF-X
Title: Prompt substrate retarget (move *.prompt.md + codegen)
State: Done
Scope: Different — moved prompts, not stage logic
────────────────────────────────────────
Ticket: SHF-Y
Title: HMAC envelope + BG worker relocation
State: Done
Scope: Different — wrapper layer, not stage logic
```

The separator is unicode `─` × 40, not markdown `---`. Markdown `---` renders as `<hr>` in some contexts and is often invisible in terminal chat panes — the unicode rule reads consistently across renderers.

### Density caps

A wall of small visuals is the same problem as a wall of text. Each rendered section caps:

- **Cycle visualisations:** at most 3 per output; if there are more cycles, list the rest as ID-only one-liners with "(see structural diagnostics log)"
- **Queue partition grid:** at most 10 rows visible; rest collapses to "(+ N more)" with the full list in the log
- **Workstream lane:** at most 7 initiatives in the live view; rest in log

## Synthesis contract

Every issue rendered in any faff output — wtf's "Do this", whereto's workstreams, tidy's findings, beep-boop's queues, anywhere — carries three elements:

1. **Tracker ID** — breadcrumb for traceability
2. **One-sentence plain-English gloss** — what the work actually is in human terms (not the tracker title verbatim; a generated sentence based on title + spec + description)
3. **Unlock-chain consequence** (only when non-trivial) — what becomes possible once this lands, in human terms

### Canonical rendering

```
ISSUE-XX — Pino instrumentation across the request path
  Wire structured logging into every API handler so request-scoped fields
  (user id, trace id, route) attach automatically. Once this lands, the
  three downstream alerting tickets can build on a real log schema.
```

In tight tabular contexts (queues, ready lists), compress the gloss to a clause:

```
ISSUE-XX   Pino instrumentation — wires structured logging into all handlers · unlocks 3 alerting tickets
```

In high-density visualisations (queue partition grids, chain diagrams), show only the gloss subject; the unlock consequence lives in a one-line footnote keyed by ID.

### Generation source order

In order of preference:

1. The spec's one-line summary if it has one
2. The issue title plus the first 2-3 sentences of the spec
3. The issue title plus the description if no spec exists

The skill **paraphrases** — does not just truncate. Tracker shorthand ("re: SHF-217 dep chain", "as discussed") is replaced with what was actually meant.

### Humanisation rule

The gloss is a delivery lead briefing a colleague, not a project manager filing a status report. A delivery lead bridges product, engineering, and business stakeholders by making work understandable, bite-sized, and transparent. Leaning on numbered references to internal documents — "principle 6", "ADR-0008", "trigger 4", "PRs 3-N" — is the opposite: project-management smoke-and-mirrors that makes the writer look indispensable while making the reader work to decode it.

**Banned in user-facing output:**

| Banned form | Why | Use instead |
|---|---|---|
| "principle 6", "principle 4", "principle N" | Reader doesn't have the methodology spec open; the number is a private convention | Say what the principle is *about* in the sentence — "the spec references work that isn't ticketed" not "this violates principle 6" |
| "ADR-0008", "ADR-N" | ADR ID is a stable identifier for traceability but can't replace explanation | Say what the ADR decides — "the audit pipeline ADR's wave-1 sign-off" not "ADR-0008" |
| "trigger 4", "criterion 3", "gate 2" | Numbered conditions inside a document the reader hasn't opened | Say what the condition tests — "a real end-to-end run on a real subject" not "trigger 4" |
| "PRs 3-N", "PR A..E", "step 5 of M" | Schematic counting where the reader can't tell what each PR does | Name each piece by what it ships — "the consumer wire-up PR, three per-stage lift PRs, and the default-flip PR" not "PRs 3-N" |
| "SHF-307a..e", "SHF-XX/YY/ZZ" used as live IDs | Made-up IDs that don't exist; reader can't click through | Either use real IDs once they exist, or describe the work — "five sub-tickets, one per remaining piece" not "SHF-307a..e" |
| "the parked-by-faff label was already cleared" (jargon as subject) | Reader doesn't know the label semantics | Say what happened in human terms — "the autonomous park was cleared two days ago when someone picked it up" |

**Allowed:**

- Real tracker IDs (ISSUE-XX, #PR-N) — stable, clickable, identify a specific thing.
- Short self-explanatory category names that *describe* a finding kind ("sub-ticket gap", "upstream gap", "repeat-park", "chain gap") — they tell the reader what was found, not which internal rule was matched.
- Principle / ADR / criterion references **alongside** plain-English explanation as traceability — "the spec assumes a wave-1 run has happened (the gate from the audit pipeline ADR)" — never standing in for explanation.

**Test:** if a reader who has never opened the project's CLAUDE.md, methodology spec, or ADR archive can't follow the finding, the rule is broken. Rewrite.

**Why this matters:** faff is a delivery lead, not a project manager. A delivery lead humanises work; a project manager codifies it to look valuable. We do the first. Every finding, every brief, every diagnosis renders the *substance* of what's going on, not the index entry that catalogues it.

### Unlock-chain language

Reserved for issues with ≥2 direct dependents, or any dependent that itself gates ≥2 issues (chain-of-3). Written in **consequence not count** form:

- ✅ "Once this lands, the three downstream alerting tickets can build on a real log schema."
- ❌ "Unlocks 3 issues."

If the unlock chain is just 1 isolated dependent, skip the consequence line entirely — counting it is noise.

### Honesty escape hatch

If the spec is genuinely ambiguous, the gloss says so explicitly:

> _Spec ambiguous: extend the existing logger vs. swap for pino; gloss reflects the title only._

A reliable-but-thin gloss beats a confident-sounding-but-wrong one.

### Caching

Glosses generated for a given issue id during one invocation are reused within that invocation. **Not cached across invocations** — tracker state changes, and the "always pull fresh" rule wins.

### Consumption

Every faff sub-skill that names an issue in output applies this contract. Each sub-skill's `Output Format` section references this contract via `See gateway → Synthesis contract` rather than re-stating.

## Structural diagnostics contract

The pass `/faff-tidy` runs to detect issues with the **shape of the backlog itself** — dep cycles, ghost-project pointers, repeat-park patterns, splittable specs, chain gaps. Findings are consumed by other faff sub-skills.

### Detection categories

| Category | What | How |
|---|---|---|
| **Dependency cycles** | Blocker graph cycle of any length (A→B→A; A→B→C→A; longer) | Tarjan / DFS-with-coloring pass over the full active-issue blocker graph. Cancelled/archived already filtered per the **Ignore cancelled and archived** rule. |
| **Ghost-project pointers** | An issue spec or description names a tracker container (project, initiative, milestone — whatever the tracker calls it) that does not exist | String-match against the live container list from the tracker MCP |
| **Repeat-park patterns** | Active issue parked 3+ times in last 21 days (configurable in `.faffrc`) with the same root-cause class | Reads last 50 `.faff/runs/*/summary.md` files; classifies each park by root-cause class enum (see below) |
| **Splittable specs** | Spec describes two structurally independent concerns AND each concern is a valid ticket-sized unit | LLM inspection — restricted to specs already flagged stale/challenged by existing tidy logic (don't sweep every spec every run) |
| **Chain gaps** | Any active ticket whose spec's implementation advice references work no ticket tracks — the chain from current state to fulfilling the spec's purpose is broken because some piece of the implied work has no ticket to carry it. Four sub-types: **sub-ticket gap** (umbrella's spec enumerates multiple remaining deliverables — multi-PR, multi-phase, numbered steps — but no Todo / In Progress / In Review sub-ticket exists for the next deliverable; `/faff-workit` has nothing to pick up to advance the umbrella); **upstream gap** (spec names a prerequisite — "blocked by X", "needs Y first", "assumes Z has shipped" — that has no ticket); **downstream gap** (spec names follow-up work — "subsequent PR will...", "leaves W for later", "after this, wire up V" — that has no ticket); **peer gap** (spec implementation advice describes parallel work that must also happen for the change to be useful — consumer wire-up, integration changes, related refactor — that has no ticket). | (1) Active ticket (Todo / In Progress / In Review) with a discoverable spec. (2) Parse the spec's implementation-advice section(s) for: multi-deliverable enumeration markers ("PR 1 / PR 2", "PR A / PR B", "Phase 1 / Phase 2", "Step N of M", "follow-up PR", numbered/bulleted lists with PR-shaped action verbs — sub-ticket gap); upstream-dependency phrases ("blocked by", "needs X first", "assumes Y has shipped", "depends on Z", "prerequisite" — upstream gap); follow-up phrases ("subsequent PR", "follow-up ticket", "leaves W for later", "after this", "next phase" — downstream gap); parallel-work phrases ("consumer-side changes in X", "also needs Y in the same workstream", "integration changes in service Z", "related refactor" — peer gap). (3) For each referenced work unit, search the active-ticket graph for a match: sub-ticket of this ticket (sub-ticket gap); tracked blocker / upstream ticket whose title/description matches the prereq (upstream gap); follow-up ticket linked via "blocks" or whose title matches (downstream gap); sibling/peer ticket in the same workstream matching the description (peer gap). (4) If no match → chain gap. (5) For sub-ticket gaps additionally check: count enumerated deliverables `E`, count `C` = (sub-tickets in any state) + (merged PRs directly referencing the parent ID); flag when `E > C` AND no sub-ticket is in Todo / In Progress / In Review. Conservative: skip when the spec is unitary, when the referenced work is in scope for the current PR, when the reference is illustrative rather than load-bearing, when the spec explicitly disclaims ("future work — not ticketed by design"), and when an actionable next-step ticket already exists. Complements delivery-methodology principle 6 (hidden deps), which catches the *inverse* — referenced work that *does* have a ticket but is missing a declared blocker link. |
| **Orphaned + repeat-parked** | Cross-reference of existing orphaned-by-cascade detection with repeat-park | Set intersection of the two finding sets |

Detection is conservative. False positives in this phase are expensive — the human gets a recommendation that's wrong and has to override. **When in doubt, don't flag.**

### Root-cause class enum

Used by repeat-park detection. Deliberately coarse so the same underlying problem ("the spec doesn't say whether to migrate or fork the table") matches across runs even when the literal park-note text varies.

- `punt-not-closed` — park reason cites a Punt marker the spec didn't close
- `gap` — park reason cites an external state that doesn't exist
- `cycle` — park reason cites a dep cycle
- `spec-ambiguous-external` — park reason cites an external decision the spec can't make alone
- `other` — everything else (rarely matches across runs; effectively prevents false-positive repeat-park flagging)

### Level-2 mechanical fixes (auto-applied in autonomous; offered in interactive)

These are the new mechanical mutations introduced in Spec 1, applied per the existing Level-2 boundary in the **Autonomous Mode Contract**.

| Detection | Mechanical fix |
|---|---|
| Cycle where one edge is defensive-not-load-bearing (the spec for A doesn't actually reference B's output) | Strip the defensive edge. Log the cycle, the stripped edge, the reasoning. |
| Ghost-project pointer where the named container **clearly maps** to an existing container by name proximity (e.g. spec says "logging-cleanup project", tracker has "Logging cleanup") | Repoint the issue to the existing container. Log the move. |
| Repeat-park (3+ runs, same root-cause class), issue still in Todo | Demote to Backlog, tag with `repeat-parked` (or tracker equivalent). Log the demotion. The issue is clearly not Todo-ready; leaving it as Todo lies to the queue. |

Three detection categories surface only in default mode — do **not** auto-apply (one of them, chain gaps, *does* auto-apply when a methodology skill is configured; see below):

- **Splittable specs** — interactive: offer to chain to `/faff-prep --split`. Autonomous Level-2: log only.
- **Chain gaps** — *default mode:* interactive surfaces each gap with the active ticket, sub-type (sub-ticket / upstream / downstream / peer), the referenced work, what's already covered (sub-ticket gaps only — sub-tickets + merged PRs by direct ref), the un-ticketed remainder, and the recommended action: for sub-ticket gaps chain-offer `/faff-prep --split` over the parent; for upstream / downstream / peer offer "file gap issue" (create the missing ticket with the appropriate relationship — blocker for upstream, blocked-by for downstream, sibling-in-workstream for peer). Autonomous Level-2: log only. *When a methodology skill is configured (interactive or autonomous):* **auto-create the missing ticket(s) per sub-type** — sub-ticket gaps: one Backlog sub-ticket per un-ticketed deliverable, parent set to the umbrella; upstream gaps: one Backlog ticket for the prerequisite + add a blocker link from the active ticket to it; downstream gaps: one Backlog ticket for the follow-up + link "blocked-by" the active ticket; peer gaps: one Backlog ticket for the parallel work in the same workstream/parent. All created tickets: title from the spec reference line, description = the referenced prose + back-link to the source ticket, status `Backlog`, tag `faff-chain-gap-fill` so `/faff-prep`'s next queue pass picks them up. Log every created ticket with id, sub-type, source spec line, and the relationship target (parent / blocker / blocked-by / sibling). Skip auto-create and downgrade to surface-only when the reference is ambiguous (no clear deliverable per line, no nameable target for the relationship, prose-y rather than action-verb-led) — phantom tickets are expensive to clean up.
- **Orphaned-by-cascade + repeat-parked** — surface only. Cancelling is destructive; always human.

### Output section

Tidy renders a `### Structural diagnostics` section when any finding exists. Format follows the **Visualisation-over-prose contract** — cycles use the cycle bracket (≤3 edges) or cycle box (4+ edges) form. Example:

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
            ship independently. Run /faff-prep --split to break out.

Chain gaps (4) ⚠ — surfaced only in default mode, auto-ticketed when methodology configured
  ISSUE-AA  Mastra audit pipeline lift — umbrella, In Progress.
            Sub-ticket gap: spec enumerates 8 deliverables (PR 1–2 shipped via
            #243/#244, PR 3 carved out as ISSUE-BB and shipped). 5 un-ticketed:
            consumer wire-up (audit-pipeline-background.ts), 3 per-stage lifts
            (captureScreenshot/extractColors/generatePalette), default flip.
            No Todo or In Progress sub-ticket exists — /faff-workit has nothing
            to pick up next. Recommendation: chain to /faff-prep --split to
            carve the remaining 5.
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

### Consumption by other sub-skills

- `/faff-wtf` always renders the structural-diagnostics summary in the morning brief, even if empty (`Structural diagnostics: clean ✓`). Repeat-parks and orphaned+repeat-parked surface in **Heads up** prominently.
- `/faff-beep-boop` consumes cycle and ghost-project findings when computing automation-routing verdicts (see **Automation-routing contract**) — an issue in a detected cycle gets `circular-blocked`; an issue with a ghost-project pointer gets `gap-blocked`.
- `/faff-whereto` consumes ghost-project pointers as evidence for its Phase 7 risk findings.

## Automation-routing contract

Every Todo issue with a discoverable spec gets exactly one **verdict** that says whether `/faff-beep-boop` will run it autonomously and, if not, why. Computed once per faff pass, consumed everywhere.

### Six verdicts

| Verdict | Definition | What `/faff-beep-boop` does |
|---|---|---|
| `fire-and-forget` | Spec `confidence: high`, no Punt/Assumes markers, no in-queue blocker, conflict analysis says independent, no repeat-park history | Builds in next autonomous run, parallel-safe |
| `likely-fire` | Spec `confidence: high` but in a collision group with other in-queue work | Builds in next autonomous run, serialised within its group |
| `needs-decision-first` | Spec contains explicit `Punt:` / `needs human` / `TBD` / "or X if Y" marker that is **not** spec-closed | Resolve-attempt (see **Autonomous Mode Contract** → resolve-attempt); if attempt fails, skipped and surfaced in wtf with the specific decision asked |
| `gap-blocked` | Spec assumes external state (tracker issue, project, dep) that doesn't exist | Resolve-attempt; if fails, skipped and surfaced with the named gap |
| `circular-blocked` | Issue sits in a dep cycle detected by **Structural diagnostics contract** | Resolve-attempt; if fails, skipped and surfaced with the cycle visualised |
| `repeat-parked` | Parked 3+ times in autonomous runs with the same root-cause class (see Structural diagnostics) | **Skipped — no resolve-attempt.** The pattern itself is the signal that a human needs to act. Surfaced prominently in wtf. |

### Computation locus

The verdict is computed in `/faff-tidy`'s structural diagnostics phase, written to:

- `.faff/runs/<run-id>/automation-verdicts.md` when invoked by `/faff-beep-boop` (full pipeline)
- `.faff/logs/YYYY-MM-DD/HHMMSS-tidy-verdicts.md` when tidy runs standalone

Other sub-skills (`/faff-wtf`, `/faff-beep-boop`) read this file rather than recomputing — but only within a single faff pass; across passes, always recompute (the "always pull fresh" rule wins, same logic as spec discovery).

`/faff-wtf` invoked standalone (no preceding tidy this pass) computes verdicts inline using the same logic.

### Build-queue admission

`/faff-beep-boop` admits to the build queue **only** `fire-and-forget` and `likely-fire` (the latter into collision groups). All other verdicts route out of the build queue with a one-line reason captured in the run summary. They appear in `/faff-wtf`'s morning brief, not silently dropped.

### Conflict-analysis integration

When computing `likely-fire`, the verdict computation **anticipates** the collision-group serialisation conflict analysis would do anyway. An issue's verdict is `likely-fire` (not `fire-and-forget`) precisely when conflict analysis will serialise it. This makes morning briefs honest — the human sees up front which issues will run in parallel vs. which queue behind a predecessor.

### Display format (consumed by `/faff-wtf` and `/faff-beep-boop`)

Replaces the previous `★ fire-and-forget` annotation. Renders via the **Visualisation-over-prose contract** → queue partition grid (form (c)). Compact form:

```
Build queue (4 ready · 2 fire-and-forget · 2 likely-fire serialised)
  fire-and-forget
    ISSUE-XX  Pino instrumentation — wires structured logging into all handlers · unlocks 3 alerting tickets
    ISSUE-YY  Rate-limit middleware — caps per-IP requests on auth routes
  likely-fire [ISSUE-A → ISSUE-B] (both touch src/auth/)
    ISSUE-A   Session refresh — extends JWT lifetime when active
    ISSUE-B   Logout sweep — purges sessions on password change

Needs your call before automation can pick up:
  needs-decision-first
    ISSUE-ZZ  Email digest — Punt in spec: cron vs. queue-driven send? (decide in 2 min)
  gap-blocked
    ISSUE-WW  Billing webhook retry — spec assumes a "webhook-events" project that doesn't exist; file it or scope the dep down
  circular-blocked
    ISSUE-AA  Onboarding redirect — sits in cycle [AA → BB → CC → AA]; recommend breaking AA→BB by inlining the auth state
  repeat-parked ⚠
    ISSUE-VV  Storage migration (parked 4 runs with same Punt: schema versioning unresolved). Decide.
```

The synthesis gloss (see **Synthesis contract**) supplies the human-language description for every ID; the diagnosis lines ("Punt in spec: …", "recommend breaking …") follow the prose carve-outs from the visualisation contract.

## Delivery-lead methodology (DEPRECATED — moved to faffter-dark-methodology-agile-delivery)

This section is retained for backwards compatibility. The methodology has been extracted into a pluggable skill at `skills/faffter-dark-methodology-agile-delivery/SKILL.md`.

**Migration:** replace `mode: delivery-lead` with `planning_skills.methodology: faffter-dark-methodology-agile-delivery` in `.faffrc`. The old `mode` key is still honoured (mapped internally to the methodology slot) but will be removed in a future version.

### Configuration

```yaml
planning_skills:
  methodology: faffter-dark-methodology-agile-delivery   # or any other methodology skill
```

When the `methodology` slot is set, every sub-skill invokes it for diagnostic findings on top of structural analysis. When unset, faff applies pure structural diagnostics only.

### Rendering

When the mode is active, every sub-skill renders the line `Delivery-lead view: on` at the top of its output (or run summary, for `/faff-beep-boop`). This is informational — it tells the human and any downstream skill that the lens is on.

### The seven principles

Each principle has: the rule, why it matters, what the violation looks like in tracker shape, and a diagnosis template sub-skills use when surfacing it. Diagnosis bracketed `[placeholder]` values are filled in by the rendering sub-skill — they are not unspecified items in this contract.

#### Principle 1: Outcome-named workstreams, not activity-named

**Rule.** Workstreams (whatever the tracker calls them — initiatives, projects, milestones, epics) are named by the user-facing or business outcome they produce. "Alerting overhaul." "Auth hardening." "Onboarding speed-up." Not by activity type — "Bugs", "Refactors", "Tech debt", "Q2 sprint 3".

**Why.** Activity-named workstreams hide priority (every bug is in "Bugs", so which matters?), conflate unrelated work (a critical auth bug and a typo fix in the same bucket), and break sequencing (you can't sequence "Refactors" — there's no shared outcome to optimise toward).

**Violation shape.** A workstream's name is a category, a sprint, a quarter, a team, or a technology layer rather than a deliverable.

**Diagnosis template.** _"Workstream '[name]' is activity-named. This makes sequencing inside it meaningless — there's no shared outcome these tickets share. Consider regrouping them by outcome: which user-facing change does each one belong to?"_

#### Principle 2: Sequence by value × risk, not by ticket order

**Rule.** Build order is determined by value created per unit of work, weighted by risk and dependency chains. Not by ticket creation order, not by who shouted loudest, not by priority alone.

**Why.** Tracker priority is noisy and stakeholder-influenced. Optimising for value-per-week shipped is the actual goal of a delivery practice. Risk-aware sequencing means de-risking earlier so unknown work doesn't surface at the worst moment.

**Violation shape.** Current sequencing order (the `## Do this` or build-queue order) is materially different from a value × risk × dep-aware order. Specifically: an issue that unlocks N value-shipping tickets is sitting behind an isolated cleanup; or a high-risk integration is sequenced last; or a quick value win is buried below months of prep work.

**Diagnosis template.** _"Current sequencing would ship value at week N. Value-aware sequencing (ISSUE-A → ISSUE-B → ISSUE-C first) would ship value at week M. The blocker is that ISSUE-X (currently first) creates no shipped value on its own — it unlocks the same downstream as ISSUE-A, but ISSUE-A also ships standalone value."_

#### Principle 3: WIP cap (humans only — autonomous work is unbounded)

**Rule.** *Human* in-flight work (issues a person is actively building) is capped at 3. Autonomous work (e.g. `/faff-beep-boop` runs) is **not WIP-capped** — the whole point of automating is to remove human-flow constraints from machine throughput. WIP applies to items a person juggles, not to items the machine ships overnight.

**Why.** Too much *human* in-flight breaks flow — context-switching eats throughput, a finished item ships value, a half-finished one doesn't. None of that applies to autonomous runs: each task runs in an isolated context with no cognitive cost. A PR awaiting human review is queued for human attention but does not count against the human's in-flight WIP — the human reviews one at a time and that review attention is a separate flow concern.

**Violation shape.** Human-driven in-flight count > 3 — or any new pull recommendation surfaced to a human when their count is already at 3. Autonomous build queues never violate this principle by construction.

**Diagnosis template (human-facing only).** _"WIP at N (cap 3). Flow > throughput. Finish ISSUE-X or ISSUE-Y before pulling new work. Recommending [next item] only after one in-flight item ships."_

Surfaced by `/faff-wtf`. Never surfaced by `/faff-beep-boop`.

#### Principle 4: Right-sized tickets

**Rule.** A ticket is a 1–3 day unit of work. Larger units split. Smaller units merge if they always ship together.

**Why.** Tickets that fit a day or three give honest sequencing and accurate burn-down. Ticket-as-epic hides progress (it sits "In Progress" for two weeks signalling nothing); ticket-as-micro fragments the picture.

**Violation shape.** A ticket whose spec covers two structurally independent concerns (each a valid 1–3 day unit) — split candidate. A ticket whose spec is one sentence with no clear deliverable — vague candidate (already flagged by Spec 1). A pair of always-ship-together tickets — merge candidate.

**Diagnosis template.** _"ISSUE-X looks too big — its spec covers [concern A] and [concern B], which are independent. Splitting into two tickets gives honest sequencing and lets [concern A] ship without waiting on [concern B]."_

#### Principle 5: Cohesive workstreams

**Rule.** A workstream encodes one outcome. Mixed-purpose workstreams (multiple outcomes bundled, or one outcome plus a catch-all) are smell.

**Why.** A workstream is a sequencing and grouping unit — if it has two outcomes, you can't sequence inside it (the right order for outcome A is different from outcome B), and the workstream's "done" is meaningless.

**Violation shape.** Tickets within a single workstream describe two or more distinct outcomes; or a single workstream has a clear primary outcome plus several "while we're at it" tickets.

**Diagnosis template.** _"Workstream '[name]' contains [outcome A] and [outcome B]. These have different sequencing inside the workstream and different completion criteria. Consider splitting."_

#### Principle 6: Surface dependencies

**Rule.** Every load-bearing dependency between tickets is named explicitly via the tracker's blocker/blockedBy relationship. Implicit deps (assumed by humans, not encoded in the tracker) are unfinished thinking.

**Why.** Implicit deps cause silent regression — a ticket gets pulled "ready" when it actually needs another ticket's output. Spec 1's automation-routing relies on the blocker graph being honest.

**Violation shape.** A spec references work in another ticket (by ID or by clear paraphrase) without that other ticket being a declared blocker. Or a workstream's tickets clearly depend on a non-workstream ticket without a link.

**Diagnosis template.** _"ISSUE-X's spec references ISSUE-Y's output but there's no blocker link. If the dep is real, link it (so /faff-beep-boop and /faff-wtf can sequence honestly); if not, the reference in the spec should go away."_

#### Principle 7: Risk-aware sequencing

**Rule.** Higher-risk work — novel integrations, unproven approaches, dependencies on external teams — is sequenced early or de-risked separately. The unknown does not all land at the end.

**Why.** Risk piled at the end means schedule estimates are lies. Early-de-risking gives the team time to course-correct before commitment.

**Violation shape.** The work most likely to surprise (large new integration, unfamiliar territory, external dep) is sequenced near the end of an initiative. Or no risk de-risking work exists — everything assumes the plan holds.

**Diagnosis template.** _"Initiative '[name]' sequences ISSUE-Z (a new [integration / approach / external dep]) last. If ISSUE-Z surprises, the surprise lands at the worst time. Consider pulling it forward, or splitting a small de-risking spike before committing to the full ISSUE-Z scope."_

### Per-skill consumption

Pointers to where each sub-skill applies the methodology. Details live in each sub-skill's `SKILL.md`.

- **`/faff-wtf`** — adds `### Delivery view` section after `### Today's Focus`. Surfaces principle 3 (WIP) and the top 1–2 structural diagnoses from principles 1, 5, 6, 7. `### Today's Focus` is WIP-aware per principle 3.
- **`/faff-whereto`** — Phase 1 (Now/Next/Later) re-sequenced inside each horizon by principles 2 + 7. Phase 7 (Risks the structure surfaces) gains findings from principles 1, 5, 6, 7 alongside existing Spec 1 risks.
- **`/faff-tidy`** — new findings phase (parallel to Spec 1's structural diagnostics) surfacing delivery-methodology violations from principles 1, 4, 5, 6. Surface-only.
- **`/faff-prep`** — appends `## Delivery critique` block to spec output. Checks principles 1, 4, 5, 6, 7 per issue.
- **`/faff-beep-boop`** — build-queue ordering uses principles 2 + 7 in place of Spec 1's priority + chainable-unlock-value alone. No WIP gating (principle 3 is human-flow-only); admission stays governed by the Spec 1 verdict gate. Run summary gains `## Delivery-lead view` listing diagnoses surfaced during the run.

### Tone discipline

Diagnoses are **educational, not preachy**. The user opted in because they want to learn what good delivery looks like by watching faff apply it. Every diagnosis follows the shape:

1. **What's there.** Describe the situation factually.
2. **Why it's a problem.** Name the concrete consequence.
3. **What to do about it.** Recommend a specific action.

Never: *"You're doing this wrong."* / *"Best practice is..."* / *"You should..."*. Describe the situation and its consequence; the user decides what to do. The methodology is opinionated; the voice is not.

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly.
