---
name: faff-wtf
description: "Where to focus — what shipped, what's stuck, what to work on next, and what an overnight beep-boop run parked. Trigger for: 'wtf' / 'what should I work on' / 'catch me up' / 'what happened' / 'what's blocked' / 'what's next', 'Where to focus', 'what's happening', 'where are we', 'where we at', 'whats up', 'the 411', 'lowdown'."
---

# Faff — WTF (Where To Focus)

> **Next steps:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building

Pull current state from your issue tracker and git, figure out what matters, tell you what to do.

## Configuration

Reads project-specific details from `CLAUDE.md` — expects a **Project Tracking** section with issue tracker details (project ID, team key) and git host details (org, repo). Auto-detects which issue tracker and git host MCP servers are available. Falls back to git-only mode if no tracker MCP is available.

See the gateway (`skills/faff/SKILL.md`) for shared rules: ignoring cancelled/archived, `.faff/` logging, Planning Skills slots, and the autonomous-mode contract.

## What it does

Run through these sections in order:

### 1. Timeline Check
- Read project context from `CLAUDE.md` (tracker details, milestones)
- **Always re-fetch milestones and their completeness live** — never rely on cached snapshots or values written into `CLAUDE.md`. Source of truth is the tracker. For Linear, call `mcp__claude_ai_Linear__list_milestones` per project ID to pull current milestone target dates and progress percentages.
- Calculate where we are relative to milestone target dates
- Flag if any milestone is at risk based on remaining work vs time
- Render one table per project with columns `Milestone | Target | Progress` (see Output Format)

### 2. Issue Tracker State
- **In Progress:** Issues currently being worked on
- **Blocked:** Issues that are blocked and why
- **Recently Completed:** Issues closed since last briefing (last 24-48 hours)
- **Coming Up:** Next highest-priority unstarted issues based on dependencies being clear

Query using the project/team details from `CLAUDE.md`. Exclude cancelled and archived per the shared rule.

### 3. Git Activity
- **Recent Commits:** Last 24-48 hours of commits on active branches
- **Open PRs:** Any PRs awaiting review or merge
- **Branch Status:** Active feature branches and their state
- **CI Status:** Any failing builds or checks

### 4. Parked Overnight

Scan for issues parked by a prior autonomous run (typically `/faff-beep-boop`).

Sources:
- Most recent `.faff/runs/*-beep-boop-*/summary.md` (if any beep-boop run logs exist)
- Tracker query for issues tagged `parked-by-faff` (or the tracker's equivalent label that beep-boop writes on park)

For each parked issue, surface:
- Issue id and title
- One-line cause summary pulled from the log or the tracker comment
- Path to the full log in `.faff/runs/…`

Skip this section entirely if there are no parked issues.

### 5. Today's Focus
Based on the above, recommend 2-3 specific things to focus on today:
- **Never suggest cancelled or archived** issues or projects as candidates (shared rule)
- Prioritise unblocked urgent/high items
- Flag if something blocked needs attention first
- Note any dependencies that are about to unblock downstream work
- **Flag "fire and forget" candidates:** Issues suitable for autonomous Claude Code execution — things with clear acceptance criteria, no ambiguous design decisions, and no human judgement required.

### 6. Risks and Flags
- Anything overdue or slipping
- Approaching milestone deadlines
- Items that have been in progress too long without movement

### 7. Ready to pick up (lightweight tidy)
Quick scan for backlog issues that are now unblocked, well-prepped, and ready to pick up. Mention 1-2 candidates if any exist.

## Chaining

All hand-offs are yes/no gates (or short-choice where a real branch exists). No passive "run /faff-*" language.

After presenting the output:

- **Picked a focus item:** "Picking up ISSUE-XX. Prep now via `/faff-prep`? (y/n)" — on confirm, invoke `/faff-prep` via the Skill tool. If the issue already has a spec, the gate becomes "Start building now via `/faff-workit`? (y/n)".
- **Multiple picked:** invoke `/faff-prep` (or `/faff-workit` if already prepped) on the first; note the rest for later.
- **"Done" reported by user:** move the issue to Done (no further chain).
- **"Blocked" reported by user:** mark blocked, ask the blocking reason.
- **"Reprep" or "update the spec":** yes/no "Re-prep via `/faff-prep`? (y/n)".
- **Full groom:** "Run a full groom via `/faff-tidy`? (y/n)".
- **Parked overnight issue:** for each, offer three-way choice "open log / re-run `/faff-prep` / leave parked (log/reprep/leave)". On `log`, print the log file contents. On `reprep`, invoke `/faff-prep` via the Skill tool. On `leave`, move on.
- **Ready to pick up candidate:** yes/no "Promote to Todo? (y/n)".
- **Fire-and-forget candidates present:** yes/no "Run these autonomously via `/faff-beep-boop`? (y/n)" — if yes, invoke `/faff-beep-boop` with the chosen issue list.

Keep the tracker in sync with reality. No one starts building without a spec.

## Output Format

Keep it concise and scannable. Use this structure:

```
## What's up — [date]

**[Y] days to [next milestone]**

### Milestones

Source of truth is Linear. Snapshot below — re-query via `mcp__claude_ai_Linear__list_milestones` per project ID for the live view.

#### [Project Name]

| Milestone | Target | Progress |
|-----------|--------|----------|
| [ID · Name] | YYYY-MM-DD | NN% |

(Repeat one table per project.)

### Shipped
- ISSUE-XX: [title]

### In progress
- ISSUE-XX: [title] — [brief status note]

### Blocked
- ISSUE-XX: [title] — blocked by [reason]

### Parked overnight
- ISSUE-XX: [title] — parked: [cause summary] (log: .faff/runs/…/ISSUE-XX/)

### Do this
1. [Most important thing and why]
2. [Second thing]
3. [Third thing if applicable]

### Heads up
- [Any risks, approaching deadlines, or flags]

### Fire and forget
- ISSUE-XX: [title] — [prompt to kick off autonomously]

### Ready to pick up
- ISSUE-XX: [title] — [why it's ready now]
```

Skip any section that has nothing to report.

## Autonomous Mode

When invoked autonomously (by `/faff-beep-boop`), follow the shared autonomous contract (see `skills/faff/SKILL.md`) and these specifics:

**Output:** a plain ready-queue list — issue id, title, readiness flag (`ready` or `needs-prep`). No focus recommendation, no "Do this", no "Heads up", no chat-style prose.

**Return to caller (beep-boop):** `{ ready: [...], needs_prep: [...], blocked: [...] }`.

**No chaining gates in autonomous mode** — beep-boop decides what to do with the queue. No remediation offers for parked issues either; triage is the human's job, not beep-boop's.

Log the query results and the returned lists to `.faff/logs/YYYY-MM-DD/HHMMSS-wtf.md`.

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Read working pattern notes from `CLAUDE.md` if available — respect the user's schedule when recommending focus
