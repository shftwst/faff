---
name: faff-wtf
description: "Where to focus — what shipped, what's stuck, what to work on next. Trigger for: 'wtf' / 'what should I work on' / 'catch me up' / 'what happened' / 'what's blocked' / 'what's next', 'Where to focus', 'what's happening', 'where are we', 'where we at', 'whats up', 'the 411', 'lowdown'."
---

# Faff — WTF (Where To Focus)

> **Next steps:** `/faff-prep ISSUE-XX` to prep an issue · `/faff-workit ISSUE-XX` to start building

Pull current state from your issue tracker and git, figure out what matters, tell you what to do.

## Configuration

Reads project-specific details from `CLAUDE.md` — expects a **Project Tracking** section with issue tracker details (project ID, team key) and git host details (org, repo). Auto-detects which issue tracker and git host MCP servers are available. Falls back to git-only mode if no tracker MCP is available.

## What it does

Run through these sections in order:

### 1. Timeline Check
- Read project context from `CLAUDE.md` (tracker details, milestones)
- Calculate where we are relative to milestone target dates
- Flag if any milestone is at risk based on remaining work vs time

### 2. Issue Tracker State
- **In Progress:** Issues currently being worked on
- **Blocked:** Issues that are blocked and why
- **Recently Completed:** Issues closed since last briefing (last 24-48 hours)
- **Coming Up:** Next highest-priority unstarted issues based on dependencies being clear

Query using the project/team details from `CLAUDE.md`.

### 3. Git Activity
- **Recent Commits:** Last 24-48 hours of commits on active branches
- **Open PRs:** Any PRs awaiting review or merge
- **Branch Status:** Active feature branches and their state
- **CI Status:** Any failing builds or checks

### 4. Today's Focus
Based on the above, recommend 2-3 specific things to focus on today:
- Prioritise unblocked urgent/high items
- Flag if something blocked needs attention first
- Note any dependencies that are about to unblock downstream work
- **Flag "fire and forget" candidates:** Issues suitable for autonomous Claude Code execution — things with clear acceptance criteria, no ambiguous design decisions, and no human judgement required. Suggest a specific prompt or plan the user can queue up before stepping away.

After presenting the focus recommendations, ask which one they're picking up first. When they answer, run `/faff-prep` on that issue automatically.

### 5. Risks and Flags
- Anything overdue or slipping
- Approaching milestone deadlines
- Items that have been in progress too long without movement

### 6. Ready to pick up (lightweight tidy)
Quick scan for backlog issues that are now unblocked, well-prepped, and ready to pick up. Mention 1-2 candidates if any exist and offer to move them to Todo. For a full groom, suggest `/faff-tidy`, but do not automatically do run it.

## After the catch-up

When the user picks something, just do the right thing:
- Picking an issue → `/faff-workit` automatically
- Wants to prep first → `/faff-prep`
- Says something is done → move it to Done
- Says something is blocked → mark it blocked, ask what's blocking
- Picks multiple → `/faff-workit` the first one, don't try to juggle
- Says "reprep" or "update the spec" → pause and invoke `/faff-prep`

Keep the tracker in sync with reality. No one starts building without a spec.

## Output Format

Keep it concise and scannable. Use this structure:

```
## What's up — [date]

**[Y] days to [next milestone]**

### Shipped
- ISSUE-XX: [title]

### In progress
- ISSUE-XX: [title] — [brief status note]

### Blocked
- ISSUE-XX: [title] — blocked by [reason]

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

## Notes
- Don't over-query — pull what's needed, synthesize, present
- If a section has nothing to report, skip it rather than saying "nothing"
- Read working pattern notes from `CLAUDE.md` if available — respect the user's schedule when recommending focus
