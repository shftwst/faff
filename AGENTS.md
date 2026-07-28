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

---

# Writing style

Applies to all prose in this repo: README, guide pages, site copy, specs, tickets, commit messages. Agents and humans alike.

## Voice

- **Casual but credible.** Not corporate, not dry. The project name carries the personality; the prose underneath it earns trust.
- British understatement over zaniness. A joke stays only if it states a truth.
- No PM jargon, no PM-workflow framing. The mechanics can be rigorous; the language shouldn't sound like project management.
- Write the word a person writing plainly would use. If you're reaching for a vivid metaphor-word, check the banned list below and the test that follows it.

## Positioning language

- The core idea is **"safe to stop watching."** Never pitch faff as a convenience tool, a shortcut, or a chore-remover — that angle is retired.
- The levels are trust earned per rung, not convenience gained per rung.
- The governance layer is a product in its own right, not an appendix.

## Claims

- **Hedging qualifies; evidence quantifies.** State gaps as specific statuses with tickets ("external proof pending, FAFF-xxx"), never as apologetic qualifiers ("should be safe, though it's early days").
- An enforcement claim without a linked artifact is a documentation bug, by policy.
- Never narrate an attested guarantee as an enforced one.

## Banned words

Words AI writing overuses but people don't — they mark text as machine-generated:

| Banned | Use instead |
|---|---|
| receipts | evidence |
| marquee | front page |
| spine (structural metaphor) | the core idea |
| footgun | trap, easy mistake |
| smoking gun | clear proof |
| any gun metaphor | the plain word |

The general test: if a person writing plainly wouldn't reach for the word, don't.
