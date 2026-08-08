# Guide

Use this guide to take SuperDomestique from a first supervised change to the
level of delegation that suits each workload. The plugin and commands are still
named `faff`.

## Choose a path

### Make a first change

Start with [Your first runs](walkthroughs.md). It covers initial configuration,
turning an idea into tracker work, and taking one ticket through specification
and implementation. Then read [Adopt by change class](adopting-by-change-class.md)
before making any work eligible for unattended delivery.

### Run work unattended

Read [Adopt by change class](adopting-by-change-class.md), then
[Unattended runs at L3](unattended.md). If the run needs to survive a closed
laptop or disconnected terminal, continue with
[Run unattended work on your own machine](self-hosted-rig.md).

### Add governance to a repository

Read [Commissaire](/concept/execution-and-governance) for the responsibility
boundary, then [Add governance-check to GitHub](governance-check.md) for the
repository wiring. [Agent lanes](architecture.md) explains the execution
separation behind the checks.

### Configure or extend the system

[Configuration](configuration.md) covers the tracker, appetite, and slots.
[Skills and slots](skills.md) explains how to replace a worker while preserving
the contract. Use the [CLI reference](cli.md) when you need a specific command.

## All guide pages

| Page | For | Read next |
|---|---|---|
| [Your first runs](walkthroughs.md) | New adopters | [Adopt by change class](adopting-by-change-class.md) |
| [Adopt by change class](adopting-by-change-class.md) | Teams deciding what agents may run | [Unattended runs at L3](unattended.md) |
| [Configuration](configuration.md) | Repository owners setting up or tuning the plugin | [Skills and slots](skills.md) or [Unattended runs at L3](unattended.md) |
| [Unattended runs at L3](unattended.md) | Teams ready to drain eligible work without scheduled supervision | [Run unattended work on your own machine](self-hosted-rig.md) |
| [Run unattended work on your own machine](self-hosted-rig.md) | Operators providing a persistent self-hosted runner | [Add governance-check to GitHub](governance-check.md) |
| [Add governance-check to GitHub](governance-check.md) | Repository administrators making run checks binding | [Agent lanes](architecture.md) |
| [Skills and slots](skills.md) | Teams replacing or adding workers | [CLI reference](cli.md) |
| [Agent lanes](architecture.md) | Integrators and advanced adopters studying execution boundaries | [Commissaire](/concept/execution-and-governance) |
| [CLI reference](cli.md) | Operators and integrators looking up a command | Return to the task guide that sent you here |
