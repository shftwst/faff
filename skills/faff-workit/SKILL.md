---
name: faff-workit
description: "Start building an issue — checks the spec exists, sets up a worktree, commits the spec to the feature branch, and gets out of your way. Trigger for: 'workit ISSUE-XX' / 'start ISSUE-XX' / 'pick up ISSUE-XX' / 'let me build'."
---

# Faff — Workit

> **Prerequisite:** `/faff-prep ISSUE-XX` (spec must exist on the issue)

Set you up to build. Checks the spec exists, creates a worktree, commits the spec to the feature branch, and gets out of your way.

## Configuration

Reads project-specific details from `CLAUDE.md` — expects a **Project Tracking** section with issue tracker details (project ID, team key) and git host details (org, repo). Auto-detects which issue tracker and git host MCP servers are available.

### Worktree Hook

Workit needs a `WorktreeCreate` hook to set up worktrees. On first use, check `.claude/settings.json` for a WorktreeCreate hook. If none exists:

1. Check if a project-specific wrapper exists at `scripts/setup-worktree.sh` — if so, register that
2. Otherwise, register the generic hook bundled with the faff skill:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "type": "command",
        "command": "bash \"${CLAUDE_PLUGIN_ROOT}/skills/faff-workit/setup-worktree.sh\""
      }
    ]
  }
}
```

Tell the user what you're adding and why. If they have a project-specific setup script, suggest they create a wrapper at `scripts/setup-worktree.sh` that calls the generic one then adds their extras.

## Input

The user may provide an issue identifier, OR invoke with no arguments.

**When no arguments are provided:**
1. Check the current git branch name for a ticket pattern (e.g., `ISSUE-69-some-description` or `PROJ-123-feature`)
2. Extract the issue ID from the branch name
3. If found, use that as the issue identifier — no need to ask the user
4. If no ticket pattern found, ask the user for an issue identifier

## Process

**Step 1: Get Issue Details**

Query the issue tracker for the issue. Extract:
- Issue identifier
- Title
- Current status
- Suggested branch name (if the tracker provides one)

If the issue doesn't exist, tell the user and stop.

**Step 2: Check prep gate**

Check the issue for an attached spec (the artifact produced by `/faff-prep`).

- **Spec exists:** Issue is prepped. Proceed to step 3.
- **No spec:** Issue hasn't been prepped. Tell the user to run `/faff-prep` first. Stop.

The gate ensures no one starts building without a validated spec.

**Step 3: Check for Existing Worktree**

Run `git worktree list` and check if a worktree for this issue already exists (match on the issue ID in the path).

If a worktree already exists:
- **Verify branch:** Compare the checked-out branch to the expected branch name. If they don't match, warn the user.
- Tell the user the worktree exists and open it.
- Skip to step 5 (status update). Spec was already committed on first workit.

If no worktree exists:
- Use the `EnterWorktree` tool with the branch name as the worktree name
- The `WorktreeCreate` hook (`setup-worktree.sh`) will automatically:
  - Create the git worktree
  - Copy gitignored config files (.env, etc.)
  - Run the project's setup command if one exists

**Step 4: Commit spec to feature branch**

Pull the spec content from the issue tracker and commit it to the feature branch. This is the first commit on the branch — the spec ships with the code it describes.

For example if the user's preference is to use the `superpowers` skills, the file location would become:
- Spec -> `docs/superpowers/specs/YYYY-MM-DD-<issue-id>-<slug>-design.md`

Derive `<slug>` from the issue title (lowercase, hyphens, no special chars). Use today's date for `YYYY-MM-DD`.

Commit message: `docs(<issue-id>): add spec for <issue title>`

This commit happens once. If the user re-runs workit on the same issue (existing worktree), skip this step.

**Step 5: Move to In Progress**

If the issue is not already In Progress, transition it.

**Step 6: Present spec and hand off to building**

Validate the spec's freshness against the current codebase. Then present a summary of the spec — design approach, key decisions, acceptance criteria — and ask:
- **"Build"** — proceed to building. The implementer chooses their own execution strategy (feed the spec into a planning skill, use subagent-driven development, build directly, etc.)
- **"Review"** — walk through the spec before starting
- **"Reprep"** — something changed, re-enter prep via `/faff-prep`

## Notes
- Don't ask for confirmation before creating the worktree — the user said the issue ID, that's the intent.
- The prep gate is non-negotiable. Even quick fixes benefit from a lightweight prep pass.
- The spec is committed to the feature branch, not main. It only reaches main when the PR merges.
- Any detailed implementation plans produced during the work are the implementer's concern — for example if the preference is to use `superpowers:writing-plans` they may commit them to `docs/superpowers/plans/` on the feature branch alongside the code, or not. Faff-workit doesn't prescribe this.
