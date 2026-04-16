---
name: faff
description: "Gateway — routes to the right faff sub-skill. Use /faff-wtf to figure out what to focus on, /faff-tidy to groom the backlog (finds problems and promotes ready issues), /faff-prep to turn a ticket into a spec, /faff-workit to start building."
---

# Faff

The stuff you do before actual work — but automated. This is a gateway — invoke the right sub-skill:

| Command | Triggers |
|---------|----------|
| `/faff-wtf` | "Where to focus", "What should I work on?", "what's happening", "catch me up", "where are we", "where we at", "the 411", "lowdown" |
| `/faff-tidy` | "Tidy the backlog", "clean up", "groom", "mess" |
| `/faff-prep ISSUE-XX` | "Prep this", "spec this out", "what does this ticket need?", "scope", "acceptance criteria" |
| `/faff-workit ISSUE-XX` | "Work on", "Start this", "take on", "pick up", "let's build", "fire up" |

## Configuration (shared across all sub-skills)

All faff sub-skills read project-specific details from `CLAUDE.md`. They expect a **Project Tracking** section with at minimum:

- Issue tracker details (project ID, team key, etc.)
- Git host details (org, repo)

Optional but useful:
- Milestones with target dates
- Labels and their meanings
- Working pattern notes

Faff auto-detects which issue tracker and git host MCP servers are available and adapts accordingly. It works with Linear, GitHub Issues, Jira, or any issue tracker exposed via MCP. If no tracker MCP is available, it falls back to git-only mode (commits, branches, PRs).

## Routing

If the user invokes `/faff` with no further context, run `/faff-wtf` (figuring out where to focus is the default).

If the user says something that maps to a specific sub-skill, invoke that sub-skill directly.
