# faff

You don't like project management. Neither do we. But tickets pile up, context gets lost between sessions, and you end up spending half your morning figuring out what to work on instead of working on it.

Faff is the stuff you do before actual work — but automated. It reads your issue tracker, checks git, and tells you what matters. Then it scopes the work so you can just build.

Made for developers who want to ship, not manage. 

Lightweight with sensible defaults, but configurable enough to use your preferred heavy-weight skills when it matters.

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
| `/faff-tidy` | Tidy the backlog — find the mess, clean, and surface what's ready to pick up |
| `/faff-prep ISSUE-XX` | Turn a vague ticket into a buildable spec |
| `/faff-workit ISSUE-XX` | Set up a worktree and start building |
| `/faff-beep-boop` | Unattended run — drain the ready queue overnight, park anything ambiguous for morning review |

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

- Default: the whole shebang — tidy, then prep every backlog issue, then build whatever's ready
- `--ready`: build-only pass over Todo issues that already have a spec
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
- spec: gstack:autoplan
- parallel: superpowers:subagent-driven-development
- review: gstack:review
- ship: gstack:ship
```

All planning slots are optional. Faff has sensible defaults for each — slots let you swap in your own.

## Skill tiers

Faff has three tiers of skills:

| Tier | Naming | Role |
|---|---|---|
| **faff-*** | Pipeline | Human-facing commands and orchestration. The "what." |
| **faffter-noon-*** | Default behaviours | The extracted default implementations. The "how" that ships out of the box. |
| **faffter-dark-*** | Overrides / experimental | Alternative implementations that replace defaults or fill optional slots. |

The faff-* skills are pure orchestrators — they define the sequence and contract, then delegate to whichever faffter-noon or faffter-dark skill is configured. A methodology is one coherent lens (not split by function) because its principles interact across grooming, standup, roadmapping, and build ordering.

### faffter-noon-* (defaults)

| Skill | Slot | What it does |
|---|---|---|
| `faffter-noon-methodology-structural` | `methodology` | The implicit default. Pure structural analysis — ordering by priority + unlock value, graph-level diagnostics (cycles, chain gaps, ghost pointers, repeat-parks), promotion/demotion by spec readiness. No opinions about value, risk, or right-sizing. |
| `faffter-noon-review` | `review` | The implicit default. Senior-engineer code review — AC coverage, obvious bugs, scope check, spec fidelity, human-judgement flagging. Emits pass/fail/needs-human. |
| `faffter-noon-spec` | `spec_format` | The implicit default. Canonical marker contract (Chosen/Punt/Assumes), writing style rules, validation criteria, and the lite nlspec arc structure. All spec producers must satisfy this; all consumers depend on it. |

### faffter-dark-* (experimental)

Pluggable skills that either add new behaviour or change the default behaviour of faff, moving towards a dark factory workflow.

| Skill | Slot | What it does |
|---|---|---|
| `faffter-dark-nlspec` | `spec` | Full nlspec-format spec generation — formal type definitions, pseudocode procedures, closed-loop DoD, appendices. Heavier than the built-in lite arc. |
| `faffter-dark-adversarial-review` | `adversarial_review` | Sends the diff to a different LLM for a structurally independent second opinion. Catches correlated blind spots the primary model misses. |
| `faffter-dark-holdout` | `holdout_tests` | Generates holdout test scenarios at prep time (stored on the issue), translates and executes them at gate time. Tests the build agent has never seen. |
| `faffter-dark-methodology-agile-delivery` | `methodology` | Agile delivery methodology lens — seven principles (outcome-named workstreams, value x risk sequencing, WIP caps, right-sized tickets, cohesive workstreams, surfaced deps, risk-aware ordering). Replaces the old `mode: delivery-lead` config. |

Some of these skills (`adversarial-review`, `holdout`) can be configured to use a different model, with provider settings per-slot in `.faffrc`:

```yaml
faffter_dark:
  adversarial:
    provider: gemini
    model: gemini-2.5-pro
    api_key_env: GEMINI_API_KEY
  holdout:
    provider: openrouter
    model: meta-llama/llama-3.1-70b
    api_key_env: OPENROUTER_API_KEY
```

The core principle is **independence** — use a different model from whatever wrote the code. A mediocre reviewer with different biases catches things an excellent reviewer with the same biases won't.

These are pluggable skills that either add new behaviour (adversarial review, holdout tests) or change the default behaviour of faff (nlspec replaces the lite spec format, agile-delivery replaces structural-only diagnostics). Some slots skip when unset; others have a built-in default that the skill replaces. See the gateway docs for per-slot defaults.

## License

MIT
