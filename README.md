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

## How it works

```
"what should I work on?" → prep it → build it
                             ↑            |
                             └── reprep ←─┘
```

1. **WTF** — what shipped, what's blocked, what to focus on
2. **Prep** — explore the codebase, write a spec, attach it to the ticket
3. **Workit** — spec is committed to a feature branch, worktree is ready, go

No ceremonies. No standups with 12 people. Just you and your code.

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
```

## License

MIT
