# faff — contributor guidance

This file is auto-loaded into every coding agent session in this repo, so the project's authoring standards are in context by construction.

> **Not faff config.** This is contributor guidance for *people and agents working on faff*. The faff CLI reads its own configuration only via `faff config` (from `.faffrc.yaml`) — `CLAUDE.md` is never a config source (FAFF-50).

Unfamiliar with faff's coined vocabulary (gate, contract, lane, slot, rung, …)? See the **[Glossary](docs/GLOSSARY.md)** — one sentence and the artifact each term names.

## Skill-authoring standard

Every skill prompt (`SKILL.md`) is written **lean, deduplicated, skimmable**. The full standard — principles plus the machine-checkable lint rules `faff validate-adapters` enforces — lives in **[`docs/skill-authoring.md`](docs/skill-authoring.md)**. Read it before editing or adding a `SKILL.md`.

In short:

- **Lean** — say it once, cut what the runtime reader doesn't need.
- **Deduplicated** — shared prose has one home (the gateway, `faff/SKILL.md`); reference it, never copy.
- **Skimmable** — bullets and tables over walls of prose.
- **No changelog in the prompt** — state the rule forward; war-stories and transcript breadcrumbs go in git history / ADRs / `design/`.

The lintable subset (line caps, paragraph length, stray markers, duplicated blocks) is gated in CI via `faff validate-adapters`; the rest is review judgement.
