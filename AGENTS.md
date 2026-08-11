# faff — contributor guidance

This file is auto-loaded into every coding agent session in this repo, so the project's authoring standards are in context by construction.

> **Not faff config.** This is contributor guidance for *people and agents working on faff*. The faff CLI reads its own configuration only via `faff config` (from `.faffrc.yaml`) — `CLAUDE.md` is never a config source (FAFF-50).

Unfamiliar with faff's coined vocabulary (gate, contract, lane, slot, rung, …)? See the **[Glossary](docs/reference/GLOSSARY.md)** — one sentence and the artifact each term names.

## Product names

The public product name is **SuperDomestique (formerly known as `faff`)**.
**Commissaire** is the governance system within SuperDomestique. The repository,
plugin, CLI, commands, configuration, source paths, and many existing tickets
still use the technical name `faff`.

When writing or editing public documentation:

- use SuperDomestique for the product and Commissaire for its governance system;
- use `faff` literally for current technical identifiers;
- keep historical records and ticket wording under the names used when they were written;
- explain the former name at the public front door, then avoid repeating the transition on every page; and
- read [Names and language](docs/concept/positioning-and-language.md) before changing product copy.

Do not treat an older ticket that says faff as a conflicting product decision. Do
not reintroduce faff as the public product name in new documentation.

## Skill-authoring standard

Every skill prompt (`SKILL.md`) is written **lean, deduplicated, skimmable**. The full standard — principles plus the machine-checkable lint rules `faff validate-adapters` enforces — lives in **[`docs/reference/skill-authoring.md`](docs/reference/skill-authoring.md)**. Read it before editing or adding a `SKILL.md`.

In short:

- **Lean** — say it once, cut what the runtime reader doesn't need.
- **Deduplicated** — shared prose has one home (the gateway, `faff/SKILL.md`); reference it, never copy.
- **Skimmable** — bullets and tables over walls of prose.
- **No changelog in the prompt** — state the rule forward; war-stories and transcript breadcrumbs go in git history / ADRs / `design/`.

The lintable subset (line caps, paragraph length, stray markers, duplicated blocks) is gated in CI via `faff validate-adapters`; the rest is review judgement.

## Commit sign-off

Every commit carries a `Signed-off-by` trailer with the operator's git identity. It certifies the [Developer Certificate of Origin](https://developercertificate.org) and is required on PRs by the `dco` check. Once `scripts/link-skills.sh` has set `core.hooksPath` to `.githooks/`, the tracked `prepare-commit-msg` hook adds the trailer from `git config user.name`/`user.email` on every commit, so a forgotten `-s` no longer fails the check; `git commit -s` adds the same trailer by hand. The identity is the operator's own; a machine identity such as `faff-runner` is never used for the sign-off.
