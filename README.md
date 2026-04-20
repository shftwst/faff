# faff

You don't like project management. Neither do we. But tickets pile up, context gets lost between sessions, and you end up spending half your morning figuring out what to work on instead of working on it.

Faff is the stuff you do before actual work — but automated. It reads your issue tracker, checks git, and tells you what matters. Then it scopes the work so you can just build.

A Claude Code plugin for developers who want to ship, not manage.

## Install

```
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

## Commands

| Command | What it does |
|---------|-------------|
| `/faff` | "What should I work on?" (default) |
| `/faff-wtf` | Where to focus — what shipped, what's stuck, what's next |
| `/faff-tidy` | Tidy the backlog — find the mess AND surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-workit ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous |

## How it works

```
"what should I work on?" → prep it → build it
                             ↑            |
                             └── reprep ←─┘
```

1. **WTF** — what shipped, what's blocked, what to focus on
2. **Prep** — explore the codebase, write a spec, attach it to the ticket
3. **Workit** — spec is committed to a feature branch, worktree is ready, go

Each step chains to the next with a yes/no gate. Say yes, keep moving. Say no, stop.

No ceremonies. No standups with 12 people. Just you and your code.

### Fire and forget

`/faff-beep-boop` runs the whole pipeline without a human in the loop. Good for overnight, meetings, or anything you want off your plate.

- Default: drains every Todo issue that already has a spec
- `--full`: tidy, then prep every backlog issue, then build whatever's ready
- `ISSUE-12 ISSUE-15`: just those

Auto-merges when every acceptance criterion is verified, CI is green, and review passed. Otherwise the PR is left open with a clear reason. Anything ambiguous is parked and surfaced by `/faff-wtf` in the morning. Full audit trail under `.faff/runs/`.

## Setup

Works with Linear, GitHub Issues, Jira, or any issue tracker exposed via MCP. Falls back to git-only mode when no tracker is available.

Add a **Project Tracking** section to your project's `CLAUDE.md`:

```markdown
## Project Tracking

- **Issue tracker:** Linear, team key `PROJ`
- **Git host:** github.com/org/repo
```

Optional:

```markdown
- **Milestones:** v1.0 target 2026-05-01
- **Labels:** `urgent` = drop everything, `blocked` = needs external input

## Planning Skills
- spec: superpowers:brainstorming
- plan: superpowers:writing-plans
- parallel: superpowers:subagent-driven-development
- review: gstack:review
- ship: gstack:ship
```

All planning slots are optional. Faff has sensible defaults for each — slots let you swap in your own.

## License

MIT
