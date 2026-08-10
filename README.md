# SuperDomestique (formerly known as `faff`)

SuperDomestique enables progressively autonymous AI software delivery by combining AI-led execution with deterministic governance, explicit engineering constraints and verifiable evidence.

It works from a tracker, moves work through specification, implementation,
review, testing, and delivery, and returns unresolved decisions to a person. The aim is
simple: make an agentic workload safe to stop watching, one step at a time.

> `SuperDomestique` is the project currently implemented and distributed as `faff`. The `faff` repository, skills, plugin and CLI commands retain their existing names while the project evolves.

## Two parts, one delivery loop

**The delivery system** turns intent into shipped work. It helps order a
backlog, prepare specifications, build changes, review them, and deliver the
result. The tracker remains the place where people set direction and see what
happened.

**Commissaire** is the governance system. It checks the evidence produced by a
run, applies deterministic rules at named gates, and stops or parks work when
the available evidence is not enough to continue.

Both are part of the current `faff` repository and distribution. Commissaire
is a logical code boundary today, not a separate service or security boundary.

## How far can you step away?

Autonomy is assigned per workload. A team can keep sensitive work at L1 while
letting routine, well-covered work run at L3 on the same board.

| Level | Working relationship | Current position |
|---|---|---|
| **L1** | You do the engineering; SuperDomestique helps plan and specify it. | Available |
| **L2** | An agent builds one change and waits for approval at the major gates. | Available |
| **L3** | An agent drains eligible work unattended; ambiguity is parked for a person. | Current unattended path |
| **L4** | A run is intended to proceed without scheduled supervision. | Preview; mechanisms exist, external proof is incomplete |

The [levels guide](docs/concept/levels.md) explains the controls and evidence
behind each level. The [public trust-claim audit](verification/audits/2026-08-07-FAFF-732-public-trust-claims.md)
records what is enforced, what has been observed, and what remains unproven.

## Install

```text
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

SuperDomestique currently supports macOS and Linux with Node 20 or later.
Native Windows is not supported; use WSL2.

## Harness support

Claude Code is the primary supported harness. Codex has completed an
interactive prep-to-merge run with material limitations, and selected
read-only producer calls are experimental. Codex unattended L3 and L4 paths
are not currently supported. pi.dev is planned, with no implementation work
scheduled.

The [harness support guide](docs/guide/harness-support.md) gives the capability
matrix, current limitations, and evidence behind each status.

## Start with one piece of work

1. Run `/faff-onboard` to connect the repository and tracker.
2. Run `/faff-jot` to capture new work, or start from an existing ticket.
3. Run `/faff-wtf` to see what is ready and what is stuck.
4. Run `/faff-prep ISSUE-XX` to prepare a specification.
5. Run `/faff-graft ISSUE-XX` to build the change with approval gates.

When the team is ready to try unattended work, mark a narrow, low-risk set of
tickets as eligible and run `/faff-beep-boop`. Anything the system cannot call
is parked for review.

## Read next

- [The delivery system](docs/concept/what-is-faff.md) explains the tracker-led
  path from intent to delivery.
- [Commissaire](docs/concept/execution-and-governance.md) explains the
  governance boundary and what its checks can prove.
- [Walkthroughs](docs/guide/walkthroughs.md) show the first interactive flows.
- [Adopting by change class](docs/guide/adopting-by-change-class.md) explains
  how to hand off low-risk work before widening the scope.
- [Evidence](docs/concept/evidence.md) points to current audits, run records,
  and known gaps.
- [CLI reference](docs/guide/cli.md) documents the `faff` commands.

## Names

SuperDomestique is the product. Commissaire is its governance system. `faff`
remains the plugin, CLI, repository, configuration prefix, and source-level
name. The [language guide](docs/concept/positioning-and-language.md) records the
rule for contributors.

## Credits

The nlspec format used by `faffter-dark-nlspec` draws on
[NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie, licensed
under Apache 2.0. See `NOTICE`.

## Licence

Apache 2.0
