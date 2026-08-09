# Documentation map

Start with the **[guide](guide/intro.md)** to install and use SuperDomestique. Read the **[concepts](concept/intro.md)** for the ideas behind governed autonomy, delivery, evidence, and Commissaire.

The rest of the repository is separated by purpose so consumer guidance no longer sits beside historical records, generated evidence, and executable operations assets.

| Collection | Contents |
|---|---|
| [`docs/guide/`](guide/) | Consumer tasks and workflows. |
| [`docs/concept/`](concept/) | Product concepts, positioning, and governance model. |
| [`docs/reference/`](reference/) | Contributor and technical reference, including the [glossary](reference/GLOSSARY.md), [skill-authoring standard](reference/skill-authoring.md), and [architecture notes](reference/architecture/). |
| [`records/`](../records/) | Durable project records: [ADRs](../records/adr/), [specs](../records/specs/), and [spikes](../records/spikes/). |
| [`verification/`](../verification/) | Audits, evidence packages, external verification, captured measurements, and dated findings. |
| [`operations/`](../operations/) | Operational assets used by CI and automation. |

The website publishes only `docs/guide/` and `docs/concept/`. Repository records and verification material remain inspectable in GitHub, but they are not consumer documentation and should be read in the context of their date and status.

## Configured record paths

This repository opts into `records/specs/`, `records/prd/`, `records/prdr/`, `records/adr/`, and `records/spikes/` through `.faffrc.yaml`. Other repositories retain SuperDomestique's existing `docs/*` defaults unless they configure their own locations.

These paths are consumed by commands, skills, tests, workflows, and generators. Move them only with their configuration and consumers.
