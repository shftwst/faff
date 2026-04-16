---
name: faff-tidy
description: "Groom the backlog in both directions — find problems (dupes, vague tickets, stale blockers, dead weight) and promote ready issues to Todo. Trigger for: 'tidy' / 'clean up' / 'backlog' / 'groom' / 'mess'."
---

# Faff — Tidy

> **Next step:** `/faff-prep ISSUE-XX` to prep an issue to make it ready · `/faff-workit ISSUE-XX` to start building an issue that's prepped

Tidy the backlog. Looks both ways in one pass:

- **Down:** find the mess — dupes, vagueness, dead weight, stale specs, stale blockers, aging issues, orphans, uncategorised, splittable, blocked
- **Up:** find issues that are actually ready and promote them to Todo, are parallelisable, or done

## Configuration

Reads project-specific details from `CLAUDE.md` — expects a **Project Tracking** section with issue tracker details (project ID, team key) and git host details (org, repo). Auto-detects which issue tracker and git host MCP servers are available.

## Process

Query all backlog issues from the issue tracker. Sort each into one of three buckets:

### 1. The mess (needs action)

- **Dupes:** Two issues covering the same work
- **Vagueness:** Issues with no clear deliverable — what even is this?
- **Too broad:** Single issues spanning multiple domains that should be split
- **Too big:** Single issues spanning too much effort that could be split
- **Premature:** Issues depending on work or decisions that don't exist yet
- **Stale:** Issues with stale specs/acceptance criteria 
- **Unblocked:** Issues blocked by something already Done/Cancelled
- **Missing deps:** Issues that clearly need something not listed in their blockers
- **Dead weight:** Merged/cancelled issues still cluttering the backlog
- **Aging:** Old issues that are likely never be worked upon
- **Not needed** Issues that are not needed any longer
- **Orphaned** Issues without a parent project, or sub-issues with a Done/Cancelled parent issue
- **Uncategorised** Issues that don't belong to any categorisation/grouping/tagging mechanism, or thatr are clearly grouped incorrectly
 incorrectly
For each, state the problem and recommend a specific action (split, merge, archive, update deps, clarify, promote, flag, tag, reparent).

### 2. Ready to pick up (promote to Todo)

An issue is ready when:
- Nothing is blocking it (or blockers are already Done)
- You can tell what "done" looks like
- The deliverable is concrete, not hand-wavy
- No big architectural questions to answer first
- Not a dupe of something else
- Categorised and/or belongs to a milestone
- Has a spec attached to the issue

For each, state why it's ready and offer to move it to Todo.

### 3. Almost ready (flag)

Issues that are close but need one small thing — a blocker that's still In Progress, one unresolved question, an unclear acceptance criterion, solid information in ticket but no spec attached. Note what would unblock them. For an issue that is ready but has no spec, suggest running `/faff-prep ISSUE-XX`

## Output

Present findings grouped by bucket. Skip any bucket with no findings. Wait for confirmation before making changes (move to Todo, split, archive, etc.).

## Notes
- Don't over-query — pull what's needed, synthesize, present
- Fix the mess first, then promote — a ready issue that's actually a dupe shouldn't get promoted
