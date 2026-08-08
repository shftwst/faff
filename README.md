# SuperDomestique

SuperDomestique, currently shipped as `faff`, is an engineering system for progressively autonomous AI software delivery governed by deterministic evidence.

Governed autonomy reduces scheduled human attention only when named controls, evidence and failure paths earn trust for a workload. Model capability alone does not justify unattended authority. The system must be able to refuse a transition, preserve the reason and return an unresolved decision to a person.

## How responsibility is divided

Three responsibilities meet in the delivery loop:

- **Humans** set intent, policy and automation eligibility, and decide questions that the available evidence cannot settle.
- **SuperDomestique** is the target product identity for the delivery responsibility that turns tracker work into specifications, builds, reviews and delivery outcomes.
- **Commissaire** is the target name for the governance responsibility that checks evidence and applies deterministic gates at trusted checkpoints.

Today both product responsibilities live inside the `faff` repository. Commissaire is not a separately shipped component, process, service or security boundary. Commands, configuration, package names, paths, URLs and source identifiers remain `faff`.

The tracker is the human-legible control plane. It records intent, status, specifications, parked work and outcomes. Run artefacts provide the forensic record behind that view.

## Evidence and current limits

The [positioning and language guide](docs/concept/positioning-and-language.md) owns the product language. The [public trust-claim audit dated 2026-08-07](docs/audits/2026-08-07-FAFF-732-public-trust-claims.md) owns the current evidence status of public claims.

| Status | Current claim | Evidence boundary |
|---|---|---|
| **Attested** | `faff` can make a workload safe to stop watching one rung at a time. | This is a governance posture backed by named mechanisms, not a guarantee of defect-free delivery or suitability for every repository. |
| **Attested** | The tracker is the control plane and outcome surface. | Run artefacts remain the forensic substrate. |
| **Enforced** | At L3, ambiguous work is parked and admitted work cannot finish cleanly without a terminal ledger outcome. | The audit links the runcheck and Stop-hook enforcement paths. |
| **Unsupported as a complete claim** | L4 is complete and independently proven. | L4 mechanisms exist, but external verification and governed programme closure remain incomplete. |

"Safe to stop watching" is always scoped to a workload and a trust rung. It does not mean full autonomy or permission to remove human judgement where the evidence is insufficient.

Harness support is also evidence-bounded. The repository records observed Claude Code and Codex paths, but the detailed public support matrix remains pending in [FAFF-735](https://linear.app/shftwst/issue/FAFF-735/publish-the-harness-support-status). No cross-harness parity claim is made here.

## Trust rungs

A rung applies to a workload, not permanently to a team. One board can carry L1 and L3 work at the same time because automation eligibility is set per ticket. See [Adopting by change-class](docs/guide/adopting-by-change-class.md).

| Rung | Human attention | Current control boundary | Entry point |
|---|---|---|---|
| **L1** | The engineer runs the work. | `faff` helps shape and sequence it. | `/faff-wtf`, `/faff-map`, `/faff-tidy`, `/faff-jot`, `/faff-plot`, `/faff-prep` |
| **L2** | The engineer approves each major transition. | A single build moves through specification, review and merge gates. | `/faff-graft` |
| **L3** | The agent drains eligible work unattended. | Ambiguity parks for a human; the run ledger must account for admitted work. | `/faff-beep-boop` |
| **L4** | The run is intended to operate without scheduled supervision. | Lights-out preflight, adversarial review and code-blind holdout mechanisms exist, but the external evidence needed for an unqualified L4-complete claim remains incomplete. | `faff lights-out` |

L3 is the current unattended centre of gravity. The [unattended-run guide](docs/guide/unattended.md) explains eligibility, parking and the run ledger. L4 remains an evidence-constrained programme rather than a completed public guarantee.

## Install

```
/plugin marketplace add shftwst/faff
/plugin install faff@faff
```

## Requirements

macOS and Linux with Node 20 or later. `faff` is dependency-free at runtime.

Native Windows is not supported. The CLI refuses to run on `win32` and directs users to WSL2 rather than continuing with unsupported path semantics.

## Your first five minutes

1. Run `/faff-onboard` to create a `.faffrc.yaml` for the repository.
2. Run `/faff-jot` to capture a new idea, feature or bug as tracker work. Skip this step when the backlog already exists.
3. Run `/faff-wtf` to see what shipped, what is stuck and what is ready.
4. Run `/faff-prep ISSUE-XX`, then `/faff-graft ISSUE-XX`, to specify and build one issue.
5. Run `/faff-beep-boop` to drain eligible work unattended and inspect parked decisions afterwards.

Each stage can offer the next transition. The gate at that transition determines whether work proceeds, stops or returns for a decision. See the [walkthroughs](docs/guide/walkthroughs.md) for worked examples.

## Commands

| Command | What it does |
|---|---|
| `/faff` | Show what to focus on. |
| `/faff-onboard` | Detect repository settings and write `.faffrc.yaml`. |
| `/faff-jot` | Capture an idea, feature or bug and turn it into tracker work. |
| `/faff-plot` | Decompose an application-scale idea into a roadmap. |
| `/faff-wtf` | Report what shipped, what is stuck and what comes next. |
| `/faff-map` | Show outcomes, workstreams and dependency chains. |
| `/faff-tidy` | Diagnose and groom the backlog. |
| `/faff-prep ISSUE-XX` | Turn a ticket into a buildable specification. |
| `/faff-graft ISSUE-XX` | Build one specified issue in an isolated worktree. |
| `/faff-beep-boop` | Run the eligible queue unattended and park ambiguity. |

## Naming status

SuperDomestique and Commissaire are target public names adopted through [ADR 0096](docs/adr/0096-adopt-superdomestique-and-commissaire-through-staged-naming.md). The technical rename and any separate Commissaire distribution remain unsettled. Until separate migration work ships, use `faff` literally for every technical identifier.

## Documentation

- [Positioning and language](docs/concept/positioning-and-language.md) defines the canonical product story, names and maturity rules.
- [Glossary](docs/GLOSSARY.md) defines the repository's delivery and governance terms.
- [Walkthroughs](docs/guide/walkthroughs.md) cover idea capture and a first build.
- [Unattended runs](docs/guide/unattended.md) covers L3 eligibility, parking, ledgers and remote operation.
- [Adopting by change-class](docs/guide/adopting-by-change-class.md) explains per-workload trust.
- [Configuration](docs/guide/configuration.md) documents `.faffrc.yaml`, appetite and slots.
- [Skills and slots](docs/guide/skills.md) lists the skill surface and extension model.
- [CLI guide](docs/guide/cli.md) documents the bundled command-line tool.
- [Governance check](docs/guide/governance-check.md) explains the harness-independent required-check binding.
- [Public trust-claim audit](docs/audits/2026-08-07-FAFF-732-public-trust-claims.md) records dated evidence statuses and gaps.
- [Evidence formats](docs/evidence/README.md) describes the run artefacts external consumers can inspect.
- [Architecture](docs/guide/architecture.md) describes the orchestrator, implementor and evaluator lanes.
- [Adopter cost report](docs/reports/adopter-cost-2026-07.md) records first-party cost observations.

## Credits

The nlspec format used by `faffter-dark-nlspec` draws on [NLSpec-Spec](https://github.com/TG-Techie/NLSpec-Spec) by TG-Techie, licensed under Apache 2.0. See `NOTICE`.

## Licence

Apache 2.0
