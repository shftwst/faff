# Configuration

This page is for repository owners connecting the `faff` plugin to a tracker or
tuning appetite and slots. New adopters should complete
[Your first runs](walkthroughs.md) first. Continue with [Skills and slots](skills.md)
to replace a worker, or [Unattended runs at L3](unattended.md) to prepare an
unattended workload.

The minimum configuration is three lines. Other settings have defaults.

## Setup

Works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP. No tracker? It falls back to git-only mode.

Drop a `.faffrc.yaml` at your repo root telling it where your stuff lives:

```yaml
tracking:
  tracker: linear        # or github, jira — autodetected if you skip it
  team_key: PROJ
  repo: org/repo
```

That's the whole minimum. Everything else has a sensible default. (`/faff-onboard` writes this file for you on a first run — autodetecting what it can.) Copy `.faffrc.example.yaml` for the full list of knobs.

## Appetite

```yaml
appetite: high           # low | medium | high | full  (default: high)
```

Appetite sets *how much rope* the pipeline gets before it checks back. More isn't always better: it buys speed against the odd "oops, wrong call, revert that." Lower it while you're learning to trust a level; the default suits unattended runs.

## Slots

Slots decide *what* runs at each stage — a beefier spec, a harsher reviewer, a parallel build. Swapping a slot customises what a level *does*, not which level you're at. Point a slot at your own or a third-party skill:

```yaml
slots:
  intake: superpowers:brainstorming   # how /faff-jot runs discovery
  spec: gstack:autoplan               # how /faff-prep writes specs
  review: gstack:review               # pre-PR review
  ship: gstack:land-and-deploy        # merge/deploy
```

All slots are optional — unset just means "use ours", and a missing slot is never a reason to park. A non-default occupant is automatically checked for conformance before first use — no flag to set. Pre-flight your configured occupants before an unattended run with `faff validate-adapters --configured` (see [CLI](cli.md)).

For per-slot model/provider settings (e.g. running the adversarial reviewer on a different model) and the full catalogue of swappable skills, see [Skills & slots](skills.md).
