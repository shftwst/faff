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

### Linear + GitHub: PR-open automation

This note is scoped to repositories using **Linear's GitHub integration**. Linear can auto-link every issue identifier it finds in a PR body and apply a team-level "PR opened → In Progress" rule to each one — including an issue the PR only *mentions* rather than targets. If you want faff's own explicit claim write (`/faff-graft` moving an issue to `In Progress`) to be the sole signal that an issue is claimed, disable that team/workspace automation rule in Linear.

This is a manual, workspace-level trade-off: turning the rule off also removes the convenience for PRs opened by hand, not just faff-driven ones. Linear's merge/link behaviour (closing an issue on merge, showing linked PRs on the issue) is configured separately and does not need to change.

faff renders every non-target issue citation in a PR body with a non-ASCII hyphen regardless of this setting — repository behaviour must not depend on an out-of-band workspace configuration a later operator could quietly flip back on.

## Record locations

Specs, PRDs, PRDRs, ADRs, and spikes default to `docs/specs/`, `docs/prd/`, `docs/prdr/`, `docs/adr/`, and `docs/spikes/`. Repositories with another structure can override any location:

```yaml
tracking:
  spec_docs_path: records/specs/
  prd_docs_path: records/prd/
  prdr_docs_path: records/prdr/
  adr_docs_path: records/adr/
  spike_docs_path: records/spikes/
```

Paths are relative to the repository root. Existing repositories need no change; the `docs/*` defaults remain in place.

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
