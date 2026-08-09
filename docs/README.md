# Documentation map

If you want to use SuperDomestique, start with the **[guide](guide/intro.md)**. It covers installation, configuration, everyday commands, and the paths through a governed delivery run.

For the ideas behind the product, read the **[concepts](concept/intro.md)**. They explain governed autonomy, the delivery model, evidence, and the boundary between execution and governance.

Those are the two public documentation collections. The website publishes only `docs/guide/` and `docs/concept/`; everything else below is repository material for contributors, operators, agents, or people investigating how a decision was reached.

## Repository material

### Contributor and technical reference

| Path | What it contains |
|---|---|
| [Glossary](GLOSSARY.md) | Short definitions for SuperDomestique's commands, contracts, and coined vocabulary. |
| [Skill authoring](skill-authoring.md) | The standard for contributors who edit a `SKILL.md`. |
| [Architecture](architecture/) | Current technical boundaries and coupling notes. |
| [CI](ci/) | Operational CI guidance and assets used by commands and workflows. |

### Controlled records

| Path | What it contains |
|---|---|
| [ADRs](adr/) | Immutable architecture decisions and their status. |
| [Specs](specs/) | Per-ticket build specifications discovered by the delivery workflow. |

The CLI can also create records under `docs/prd/` and `docs/prdr/`. Those directories do not need to exist until the relevant record is created.

### Operational assets

| Path | What it contains |
|---|---|
| [Spikes](spikes/) | Time-boxed investigations, including scripts and probes that may still be executed by workflows. |
| [Superpowers](superpowers/) | Repository assets used by scaffolding and integration checks. |

### Evidence and research

| Path | What it contains |
|---|---|
| [Audits](audits/) | Point-in-time findings and follow-up records. |
| [Evidence](evidence/) | Evidence packages used to support product and governance claims. |
| [External verification](external-verification/) | Cross-project verification fixtures, results, and supporting material. |
| [Reports](reports/) | Generated measurements and dated analysis. Treat a report as point-in-time evidence, not current consumer guidance. |

## Paths are part of the interface

This map improves navigation without reorganising the tree. Several documentation paths are read, generated, copied, or executed by configuration, CLI commands, skills, tests, workflows, and the website.

In particular, treat `docs/adr/`, `docs/specs/`, `docs/prd/`, `docs/prdr/`, `docs/ci/`, `docs/spikes/`, `docs/evidence/`, `docs/external-verification/`, `docs/audits/`, `docs/superpowers/`, and generated report paths as compatibility-sensitive. Before moving one, inventory every consumer and change the path and its checks together.

Repository-only does not mean unimportant or obsolete. It means the material is not part of the consumer documentation site and should be read in the context of its date, status, and purpose.
