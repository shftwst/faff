# FAFF-755: Add a repository documentation map without moving machine-consumed paths

> Spec: faffter-noon-spec · 2026-08-09 · interactive · confidence: high. Full spec on Linear FAFF-755.

## Why

The repository contains public documentation, technical records, evidence, generated artefacts, and executable assets under one `docs/` tree. Several paths are consumed directly by configuration, CLI code, skills, tests, workflows, and the website, but readers still need a clear way into the tree.

## What

Add `docs/README.md` as a repository documentation map. It must lead readers to the public guide and concepts, state the website publication boundary, classify the current documentation directories, and identify compatibility-sensitive paths.

## Boundaries

- Do not move, rename, delete, or rewrite existing records.
- Do not change Docusaurus sources, routes, or sidebars.
- Do not publish technical records.
- Do not add tests that assert literal prose.

## Done

- [ ] `docs/README.md` gives an approachable route through every current top-level documentation directory.
- [ ] Its publication claim matches `website/docusaurus.config.js`.
- [ ] Its compatibility warnings match current config, CLI, skill, test, and workflow consumers.
- [ ] Relative links resolve by inspection.
- [ ] Existing documentation build or link checks pass where applicable.
- [ ] The implementation changes only the new map and this spec.

confidence: high

```faff-contract:spec-readiness
{
  "confidence": "high",
  "decisions": [
    { "marker": "chosen", "decision": "Use a landing page instead of moving compatibility-sensitive paths." },
    { "marker": "chosen", "decision": "Keep guide and concept as the only website-published documentation sources." },
    { "marker": "chosen", "decision": "Classify repository-only records without presenting them as consumer guidance." }
  ]
}
```

