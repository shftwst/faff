---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-wtf to figure out what to focus on, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-workit to start building, /faff-beep-boop to run the whole suite unattended."
---

# Faff

The stuff you do before actual work — but automated. This is a gateway — invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-workit ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |
| `/faff-beep-boop` | "Run overnight", "fire and forget", "chew through the backlog", "unattended" |

## Configuration (shared across all sub-skills)

All faff sub-skills read project-specific details from `CLAUDE.md`. They expect a **Project Tracking** section with at minimum:

- Issue tracker details (project ID, team key, etc.)
- Git host details (org, repo)

Optional but useful:
- Milestones with target dates
- Labels and their meanings
- Working pattern notes

Faff auto-detects which issue tracker and git host MCP servers are available and adapts accordingly. It works with Linear, GitHub Issues, Jira, or any issue tracker exposed via MCP. If no tracker MCP is available, it falls back to git-only mode (commits, branches, PRs).

### Planning Skills (optional delegation slots)

Faff delegates specialised work to configured skills. Slots live in a `Planning Skills` section of `CLAUDE.md`. All slots are optional — each has a sensible faff default when unset.

```markdown
## Planning Skills
- spec: superpowers:brainstorming                      # used by faff-prep
- plan: superpowers:writing-plans                      # used inside faff-workit, optional
- parallel: superpowers:dispatching-parallel-agents    # used by faff-beep-boop for concurrency, optional
- review: gstack:review                                # pre-PR review inside faff-workit, optional
- ship: gstack:land-and-deploy                         # merge/deploy mechanism inside faff-workit, optional
```

Defaults when a slot is unset:

| Slot | Default |
|---|---|
| `spec` | Inline spec produced by faff-prep. In autonomous mode, the inline path parks instead (no self-rating available — see autonomous contract). |
| `plan` | faff-workit builds directly from the spec without a formal plan step. |
| `parallel` | faff-beep-boop runs sequentially. |
| `review` | faff built-in lightweight review: diff read, AC-to-test coverage check, obvious-bug scan. |
| `ship` | Vanilla `gh pr merge` after faff's merge-confidence gate passes. |

`review` and `ship` are **not** user-invokable slash commands. They are internal phases of faff-workit, with optional delegation via these slots.

## Shared Rules

These rules apply to every faff sub-skill. Sub-skills point at this section rather than re-stating.

### Ignore cancelled and archived

Every faff sub-skill excludes the following from every query, recommendation, count, and output:

- Cancelled issues
- Archived issues
- Issues whose parent project is cancelled or archived
- Cancelled or archived projects themselves

No exceptions. Cancelled/archived items are invisible to faff — they are never surfaced in catch-ups, never flagged in tidy, never picked up by workit, never counted in beep-boop queues.

### `.faff/` logging directory

Every faff skill invocation writes a structured markdown log to the repo-local `.faff/` directory. Layout:

```
.faff/
  logs/
    YYYY-MM-DD/
      HHMMSS-<skill>[-<context>].md     # one file per skill invocation
  runs/
    YYYY-MM-DD-beep-boop-HH-MM-SS/      # grouped per beep-boop run
      summary.md
      ISSUE-XX/
        prep.md
        workit.md
        ac-verification.md
      ...
```

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
- **Log entries always include:** what was expected, what was observed, what decision was taken, and why.

Per-skill autonomous specifics live in each sub-skill's `Autonomous Mode` section. Summary:

| Skill | Autonomous behaviour (high-level) |
|---|---|
| faff-tidy | Auto-archive merged/cancelled + auto-reparent obvious orphans only. Everything else logged for morning review. |
| faff-wtf | Return the ready-queue as a plain list. No focus recommendation. |
| faff-prep | Stale-refresh when original design still holds; auto-spec from scratch only on high-confidence self-rating. Medium/low → park. Inline path parks (no self-rating available). |
| faff-workit | Skip prompts. Mid-build ambiguity → invoke `/faff-prep` respec. Still ambiguous → park. Post-build → AC verification → review → merge-confidence gate. |

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

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly.
