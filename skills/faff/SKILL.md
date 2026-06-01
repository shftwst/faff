---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-noodle to start something new (kick off a project or capture a feature/bug/idea into tickets), /faff-wtf to figure out what to focus on, /faff-whereto for the strategic roadmap view above /faff-wtf, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-workit to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

The stuff you do before actual work — but automated. This is a gateway — invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-noodle` | "New project", "kick off", "start something", "I've got an idea", "new feature", "add a feature", "file a bug", "capture this", "scope a new thing", "spitball" |
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
  intake: superpowers:brainstorming                  # used by faff-noodle for new-work discovery
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
  intake: superpowers:brainstorming                  # used by faff-noodle for new-work discovery, optional
  spec: superpowers:brainstorming                    # used by faff-prep
  parallel: superpowers:dispatching-parallel-agents  # used by faff-beep-boop for concurrency, optional
  review: gstack:review                              # pre-PR review inside faff-workit, optional
  methodology: faffter-dark-methodology-agile-delivery             # diagnostic lens over backlog state, optional
  spec_adaptor: faffidavit-spec              # adaptor: markers + style + confidence line; maps a producer's spec onto the fixed closed/open/external + confidence contract
  review_adaptor: faffidavit-review          # adaptor: output envelope; maps a reviewer's output onto the fixed pass/fail/needs-human contract
  routing_adaptor: faffidavit-routing        # adaptor: verdict assignment + display; the six-verdict vocabulary + admission rule are fixed in the gateway
  language_adaptor: faffidavit-language        # pure adaptor (no internal contract): rendering + synthesis + output normaliser
  ship: gstack:land-and-deploy                       # merge/deploy mechanism inside faff-workit, optional
```

Each slot has a built-in default when unset. The default skill owns its own behaviour contract — see that skill's `SKILL.md`. A missing slot is **never** a park reason.

| Slot | Default when unset | Purpose |
|---|---|---|
| `intake` | `faffter-noon-intake` | Runs new-work discovery for `/faff-noodle` and emits a discovery brief. A producer doing-skill. |
| `spec` | `faffter-noon-spec` | Produces the spec (lite nlspec arc). A producer doing-skill. |
| `parallel` | none (sequential) | Concurrency for faff-beep-boop. |
| `review` | `faffter-noon-review` | Pre-PR review inside faff-workit. Emits the `review_adaptor` verdict. |
| `methodology` | `faffter-noon-methodology-structural` | A diagnostic lens over backlog/build state. Sub-skills request named outputs from it. |
| `spec_adaptor` | `faffidavit-spec` | Adaptor over the fixed spec-readiness contract: the markers + writing style + confidence line that map a producer's spec onto closed/open/external + confidence; validates specs on demand. |
| `review_adaptor` | `faffidavit-review` | Adaptor over the fixed review-verdict contract (`pass` / `fail` / `needs-human`, semantics, revert test — all in the gateway): the output envelope reviewers emit and faff-workit branches on; validates/normalises review output on demand. |
| `routing_adaptor` | `faffidavit-routing` | Adaptor over the fixed automation-routing contract (six verdicts + admission rule + root-cause taxonomy — all in the gateway): verdict assignment + computation locus + display format; assigns and validates verdicts. |
| `language_adaptor` | `faffidavit-language` | Pure adaptor (no internal contract — rendering is human-facing only): visual vs prose, canonical visual forms, table-vs-list rule, density caps, issue-gloss humanisation; normalises output on demand. |
| `ship` | vanilla `gh pr merge` | Merge/deploy mechanism inside faff-workit. |

`review` and `ship` are **not** user-invokable slash commands. They are internal phases of faff-workit, with optional delegation via these slots.

## Agent Lanes

Faff operates across three segregated executor lanes. These are not personas — they are structurally isolated contexts with controlled visibility, ensuring separation of concerns and preventing the build agent from marking its own homework.

### Orchestrator (outermost lane)

**Visibility:** Issue tracker, project documentation, human dialogue, codebase (read-oriented).
**Not concerned with:** Implementation detail, code-level decisions.

Two functions:
1. **External interface** — controls inputs and outputs between the project and the outside world: issue tracking, direct dialogue with the human, project-level reporting, stakeholder communication.
2. **Pipeline sequencing** — owns the high-level delivery pipeline. Decides what runs when, sequences prep → build → review → ship, manages parks and escalations.

Faff-* skills (wtf, whereto, tidy, beep-boop) operate primarily in this lane. They read the codebase for context but their job is orchestration, not implementation.

### Implementor (innermost lane)

**Visibility:** Codebase (full read/write), spec, architectural context, test suite.
**Not concerned with:** Tracker state, project-level sequencing, stakeholder communication.

The most active lane. Where development happens:
- Architectural planning and technical decision-making
- Spec interpretation and implementation
- Code, tests, and documentation changes
- Fix→review iteration loops

Faff-workit's build phase operates in this lane. The implementor sees the spec and builds to it — it doesn't manage the backlog or decide what to work on next.

### Evaluator (external lane)

**Visibility:** Documentation, specification, stood-up environment (runtime access). **No codebase access.**
**Not concerned with:** How the code works. Only whether the delivered artefact satisfies the spec from a business-value perspective.

Quality control from the outside:
- Can the feature be exercised in the running environment?
- Does the behaviour match what the spec promised?
- Are acceptance criteria met from a user's perspective (not a code perspective)?
- Does the delivered value match the problem statement in WHY?

This lane is intentionally blind to implementation — it evaluates outcomes, not code. A passing evaluator signal means the feature works as specified regardless of how it's built.

### Lane isolation

The lanes have **controlled visibility by design**, not by accident:

| Lane | Codebase | Tracker | Spec | Environment | Human dialogue |
|---|---|---|---|---|---|
| Orchestrator | Read (context) | Full | Read | No | Yes |
| Implementor | Full read/write | No | Read | Local dev | No (via orchestrator) |
| Evaluator | **No** | No | Read | Runtime access | No (via orchestrator) |

This isolation prevents:
- The implementor gaming its own review (it can't see evaluator feedback until the orchestrator routes it)
- The evaluator being biased by implementation approach (it can't see the code)
- The orchestrator making implementation decisions (it sequences, doesn't build)

Not all lanes are active in every flow. The evaluator lane is a future capability — documenting it here sets the architectural intent.

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

**This section is the single canonical definition of spec discovery for the whole suite.** Sub-skills (faff-tidy, faff-prep, faff-workit, faff-wtf, faff-whereto, the methodology's `promotion-readiness`) reference it rather than restating the rule; where one mentions "a real spec per the shared Spec discovery rule", it means exactly the three checks below. Any divergence in a sub-skill is a bug, not a local override.

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

The `calibration/` directory is **append-only** and **never authoritative for current decisions** — it captures evidence about autonomous decisions (over-cautious parks, wrong inferences, post-merge reverts, appetite-influenced proceeds, and medium-confidence holds) so resolve-attempt rules and verdict gates can evolve with data. See **Autonomous Mode Contract → Calibration log** for capture rules and the synthesis-and-surface flow.

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
| faff-prep | Stale-refresh when original design still holds; auto-spec from scratch (delegated **or** inline) when self-rating clears the appetite-aware confidence gate (see **Appetite for destruction**). `high` → attach + promote (build-eligible). `medium` → attach with the rating retained (Todo, routes out as `needs-decision-first`); whether an autonomous build then proceeds is appetite-modulated per the matrix above — `low`/`medium` surface for human, `high` (default) resolve-attempt → proceed if defensible, `full` proceed. `low` confidence parks. Missing `spec` slot is **not** a park reason — inline path self-rates and uses the same gate. |
| faff-workit | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park. Post-build → AC verification → review (pass/fail/needs-human). `pass` → auto-merge on green CI (unblocks chained issues). `fail` → iterate. `needs-human` → flip PR to draft, park. |

### Appetite for destruction

A suite-wide dial (`appetite: low | medium | high | full` in `.faffrc`, default `high`) that tunes how much agency the entire faff pipeline has — build decisions, methodology actions, backlog management, and every pluggable skill that accepts it. The name signals the underlying tradeoff: more autonomous decisions ship faster but accept a small rate of "wrong call, revert it."

The reason this dial exists: the autonomous pipeline's value collapses when it brings every minor call back to the human. A pipeline that parks on every `confidence: medium`, every Punt, every gap-blocked verdict, every methodology finding, demands the same input from the human as building the thing manually would — except now they have to also context-switch into "interpret faff's parks" mode each time. The human's control over project direction lives in the **spec** (front-loaded, considered architecture); past the spec gate, appetite governs how much the pipeline executes without checking back.

Every faff sub-skill and every pluggable skill reads the current appetite level. The four levels:

| Level | Intent |
|---|---|
| `low` | Conservative — park on anything non-obvious; minimal autonomous agency. |
| `medium` | Cautious — proceed only when the call is clear; otherwise park. |
| `high` (default) | Confident — proceed on defensible calls with an audit trail; park architectural/irreversible only. |
| `full` | Maximum agency — resolve everything resolvable, document, proceed; only the hard floor below ever stops it. |

Each skill that accepts appetite **documents its own per-level response** in its `SKILL.md`. The gateway owns the level vocabulary and the hard floor; it does not restate per-skill behaviour. The one table the gateway keeps is the appetite-modulation of two shared contracts — resolve-attempt (gateway-owned) and automation-routing (the `routing_adaptor` slot):

#### Build pipeline (modulation of the resolve-attempt + automation-routing contracts)

| | low | medium | high (default) | full |
|---|---|---|---|---|
| `confidence: medium` spec | Attach (rating retained), surface — not built | Attach (rating retained), surface — not built | Resolve-attempt → proceed if defensible | Proceed — resolve inline, document, don't park |
| `confidence: low` spec | Park | Park | Park | Resolve-attempt → proceed if any defensible path exists; park only if genuinely unknowable |
| Punt markers | Park (no resolve-attempt) | Resolve-attempt with conservative thresholds | Resolve-attempt with widened thresholds | Resolve all Punts — pick the most defensible answer, document, proceed. No Punt parks. |
| `gap-blocked` verdict | Park | Resolve-attempt per verdict rules | Proceed if gap can be worked around | Proceed — file the gap ticket and continue regardless |
| `circular-blocked` verdict | Park | Resolve-attempt (unambiguous break-edge only) | Accept most plausible break-edge | Break the cycle at any plausible edge, document, proceed |
| Chain-gap auto-create | Never (surface only) | Only when methodology configured | Even without methodology, if remainder is identifiable | Always — every identifiable gap gets a ticket |

The methodology slot's per-level response lives in the configured methodology skill. The review slot's per-level response lives in the configured review skill — note that review quality never loosens at any level (see the hard floor below).

#### What appetite NEVER changes (hard floor — applies at ALL levels including `full`)

- **Destructive / irreversible operations still park.** Anything that can't be undone with `git revert` and a redeploy still escalates — production data, secrets, external messaging, irreversible cloud-resource changes.
- **User-explicit "ask first" rules** in Planning Skills, in CLAUDE.md, or in spec comments override appetite. The dial doesn't punch through explicit instructions.
- **Cancellation / deletion** of issues or workstreams. No appetite level autonomously cancels or deletes. `full` adds scope (splits, merges, new tickets) but never removes it.
- **Review runs and gates.** `full` does not skip or weaken the review. If it fails, the pipeline iterates or parks — never overrides.
- **Spec quality.** Front-loaded prep still aims for `confidence: high`. `full` resolves more aggressively past the spec gate but doesn't lower the bar for what constitutes a good spec.

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

**Boundedness.** The attempt reads at most **3 files outside the spec's named scope** at `medium` appetite. At `high` appetite (default) the budget grows to **5 files**. Beyond the budget, treat as park. Keeps cost contained and avoids rabbit-hole investigations.

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
| Medium-confidence held for human (at `appetite: low`/`medium`, a `confidence: medium` spec was attached + surfaced, not built) | `.faff/calibration/held-decisions/<issue-id>.md` | The verdict, the spec marker + thin area, the appetite at the time, and the human's eventual resolution (resolved-as-flagged / changed-direction / waved-through-no-change) once known. The symmetric counterpart to `appetite-decisions` — pairs with it for the cross-cut "is `low`/`medium` *under*-shooting — holding things the human just rubber-stamps?" tidy signal. |

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

### Unpark protocol (shared)

Parking is reversible by design — the **single owner of unpark mechanics is this section**; the scattered references elsewhere (faff-tidy's stale-label removal, faff-wtf's parked-issue surfacing, faff-whereto's unpark-condition view, the methodology's `promotion-readiness`) all resolve to it. A parked issue carries the `parked-by-faff` label (or tracker equivalent) and a park comment stating what a human must resolve. It re-enters the pipeline one of two ways:

1. **Reason resolved → re-enter.** The unpark trigger is **always re-invoking the relevant skill on the issue**, never a separate "unpark" command. Which skill depends on the park cause:
   - Spec-level park (open `**Punt:**`, ambiguous decision, `low`/retained-`medium` confidence) → re-run `/faff-prep` (or `/faff-prep --refresh`) once the human has answered in a comment. Prep re-rates; on `high` it promotes and clears the label.
   - Build-level park (mid-build ambiguity flipped the PR to draft) → re-run `/faff-workit`; it resumes from `.faff/runs/<run-id>/ISSUE-XX/` + the draft PR.
   - Structural park (`gap-blocked`, `circular-blocked`) → resolve the gap/cycle (file the missing ticket, break the edge), then the issue routes normally on the next tidy pass.
2. **Reason no longer applies → auto-clear.** `/faff-tidy` removes a stale `parked-by-faff` label without human action when the state moved on (issue now In Progress/In Review/Done/Cancelled) or the park reason is now invalid (cited blocker shipped, cited punt closed by a later `Chosen:`/`Decision:` marker, or the reason matches a now-forbidden autonomous-park pattern). See faff-tidy → _Stale park label_ for the exact rules.

**The label is the contract.** Removing the `parked-by-faff` label (by either path) is what returns the issue to normal routing — `/faff-wtf` stops surfacing it as a blocker, and the build queue reconsiders it on the next pass. Whoever clears a park (a skill on re-entry, or tidy's auto-removal) **must** remove the label and log the unpark with its cause. A resolved park that keeps its label is a bug: it lies to every downstream surfacer.

## Chaining pattern

When a faff skill's flow leads naturally into another faff skill, it offers the next step via a yes/no gate (or a short-choice prompt where there is a real branch like Build/Review/Reprep). On confirm, it invokes the next skill via the `Skill` tool in the same conversation. On deny, it stops cleanly.

No faff skill uses passive "run `/faff-*` next" or "you should run" language. Every chain point is an explicit gate.

## Core contracts and adaptor slots

faff-core fixes a small set of **internal contracts** — the verdict states, vocabularies, and classifications the pipeline directly branches on, counts, gates on, or admits to a queue. These are invariant: they live here, in the gateway, and never move into a swappable skill. Each is paired with a pluggable **adaptor slot** whose job is to translate a producer's native output *into* the fixed internal contract and validate conformance. The default adaptor's native dialect is the house format; swapping an adaptor swaps the translator, never the contract.

**Dividing principle:** anything the faff-* pipeline branches on, counts, gates on, or admits → internal (fixed, here). Anything about format, parsing, presentation, or producer-specific translation → adaptor (slot, swappable).

### Review verdict (fixed) → `review_adaptor`

**Internal contract (fixed):** a review returns exactly one of three states — `pass` / `fail` / `needs-human`. Their semantics, the **revert test** that separates `fail` (revert-reversible defect) from `needs-human` (effect persists after revert), and the rule that a malformed/unparseable verdict coerces to `needs-human` (never silently to `pass`) are all fixed here. faff-workit's post-build gate branches proceed / iterate / park on these three states directly.

**Adaptor slot:** `review_adaptor` (default `faffidavit-review`) — the output envelope (`signal:` line + `## Findings`) and the parsing/normalising of any reviewer's native output into the three states. Swap it to adapt a third-party reviewer; faff-workit still branches on the same three states.

### Automation-routing verdict (fixed) → `routing_adaptor`

**Internal contract (fixed):** the closed **six-verdict vocabulary** (`fire-and-forget`, `likely-fire`, `needs-decision-first`, `gap-blocked`, `circular-blocked`, `repeat-parked`); the **build-queue admission rule** (only `fire-and-forget` + `likely-fire` ever enter the queue; all others route out with a one-line reason surfaced in wtf, never silently dropped); and the **root-cause class enum** (`punt-not-closed`, `gap`, `cycle`, `spec-ambiguous-external`, `other`) shared by repeat-park detection and the calibration log. The verdict survives a `methodology` swap precisely because it is fixed here, not inside the methodology.

**Adaptor slot:** `routing_adaptor` (default `faffidavit-routing`) — assigning a verdict from `backlog-diagnostics` findings + spec confidence + markers + park history, the computation locus (`/faff-tidy` writes per pass into `.faff/runs/<run-id>/automation-verdicts.md`; consumers read within a pass, recompute across passes), and the display format. References elsewhere to "gateway → Automation-routing contract" and "gateway → Root-cause class enum" resolve to this fixed contract; the `routing_adaptor` slot supplies assignment + display.

### Spec readiness (fixed) → `spec_adaptor`

**Internal contract (fixed):** every non-trivial decision is classified as **closed** / **open** / **external-dependency**, and a **confidence rating** (`high` / `medium` / `low`) is present and **retained on the attached spec** — it is durable provenance and a re-spec signal, not a transient gate token that gets stripped. faff-prep's autonomous gate: `high` → promote (build-eligible); `medium` → attach with the rating retained, move to Todo, surface for human triage — **never** auto-admitted to the build queue; `low` → park. A retained `medium` rating maps to the `needs-decision-first` routing verdict (the rating itself is the human-call signal — see the routing contract above), so an autonomous run gives it a resolve-attempt and otherwise surfaces it in `/faff-wtf` rather than building it unattended. faff-tidy's spec-health pass reads the retained rating and reconciles it against post-spec comments and codebase drift.

**Adaptor slot:** `spec_adaptor` (default `faffidavit-spec`) — the concrete markers (`**Chosen:**` / `**Punt:**` / `**Assumes:**`), the skimmable writing-style rules, the confidence line's format, and the mapping from a producer's native structure into closed/open/external. Swap it to adapt a third-party spec format; faff-prep still gates on the same classification + confidence.

### Rendering — no internal contract → `language_adaptor`

Rendering is purely human-facing: no pipeline code branches on, counts, or gates on it, so there is **no internal contract** to fix. The `language_adaptor` slot (default `faffidavit-language`) is therefore a pure adaptor — the visual-vs-prose split, the closed catalogue of canonical visual forms, the markdown-table-vs-definition-list rule, density caps, and the **synthesis** issue-gloss (tracker ID + one-sentence plain-English gloss + unlock-chain consequence, the humanisation rule, the banned project-management shorthand). Any sub-skill that emits user-facing output renders through the configured `language_adaptor`; the catalogue is closed there, not extended inline. References elsewhere to "gateway → Synthesis contract" resolve to this slot.

### Legacy contract aliases

Sub-skills written before this restructure cross-reference the contracts by their old names. Those names are **not** headings anywhere; they resolve to the sections above:

| Legacy reference | Resolves to |
|---|---|
| `gateway → Automation-routing contract` | **Automation-routing verdict (fixed) → `routing_adaptor`** |
| `gateway → Root-cause class enum` | the root-cause class enum inside **Automation-routing verdict (fixed)** |
| `gateway → Synthesis contract` | the synthesis issue-gloss inside **Rendering → `language_adaptor`** |

When renaming any contract section, update this table — it is the single place the legacy names are reconciled.

## Backlog diagnostics — the `methodology` slot

Detecting problems with the **shape of the backlog itself** — dep cycles, ghost-project pointers, repeat-park patterns, splittable specs, chain gaps — is the `backlog-diagnostics` output, owned by the `methodology` slot. The default is `faffter-noon-methodology-structural`, whose `backlog-diagnostics` always fires regardless of config (it is the structural baseline every faff pass depends on). See that skill's `SKILL.md` for the detection categories, mechanical fixes, and rendered output.

Two findings from `backlog-diagnostics` feed the **Automation-routing verdict** (the fixed internal contract above): an issue in a detected cycle gets `circular-blocked`; an issue with a ghost-project pointer gets `gap-blocked`. The `routing_adaptor` slot performs the assignment.

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly. New-work intent — "new project", "kick off", "I've got an idea", "add a feature", "file a bug" — maps to `/faff-noodle` (it's the only sub-skill that *creates* tickets; the rest act on tickets that already exist).
