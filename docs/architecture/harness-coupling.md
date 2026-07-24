# Harness coupling — the per-seam disposition table

faff runs on Claude Code today, but nothing about the delivery loop is inherently Claude-specific. This page is the committed inventory of every seam where faff touches its harness, each with a settled portability disposition and the concrete artifact that embodies it. It is the deliverable half of the FAFF-477 coupling-surface spike (whose findings otherwise live in ticket comments and a planning package) and the starting inventory for FAFF-483, which defines the harness-abstraction interface: every seam that interface names must trace to a row of the table below.

**The governing principle:** prompts target the Agent Skills open standard; determinism lives in the CLI; enforcement's floor lives in git and CI; harness hooks are progressive enhancement. Each row is an application of that one principle to one seam — the rows carry evidence, not philosophy, and the principle is not restated per row.

## Disposition vocabulary

The closed set of four dispositions. Every row's disposition is exactly one of these; no other classification is used.

| Term | Definition |
|---|---|
| **portable** | Works on any harness implementing the Agent Skills open standard, or is harness-independent already; no work needed. |
| **adapter** | Stays, but behind a swappable seam — a config-selected backend or a documented mapping table. |
| **down-stack** | The authoritative enforcement moves below the harness (git + CI); the harness hook remains as fast local feedback, not the floor. |
| **drop** | The harness mechanic is removed; its job moves into skill-step prose or the CLI. |

## The seams

| Seam | Today (Claude Code) | Disposition | Evidence / follow-on |
|---|---|---|---|
| **Skills + frontmatter** | `SKILL.md` prose with YAML frontmatter, read by the harness's skill loader. | **portable** | `plugin/skills/*/SKILL.md`. The Agent Skills open standard (Linux Foundation governed, 32+ tools including Codex reading `SKILL.md` from `~/.agents/skills/`). |
| **Deterministic CLI** | The dependency-free Node CLI under `plugin/skills/faff/bin/`. | **portable** | `plugin/skills/faff/bin/` (`faff` + `lib/*.js`). Two Claude tendrils ride inside it: **(a)** transcript-JSONL telemetry — `bin/lib/budget.js` keys off `$CLAUDE_CODE_SESSION_ID`, the `~/.claude/projects/<encoded-cwd>/` transcript dirs, and child `agent-*.jsonl` attribution → an adapter seam (spend-source read: FAFF-604; window-mode ceilings: FAFF-594); **(b)** `bin/lib/hooks-ensure.js` writing `.claude/settings.json` → meaningful only where a hooks mechanism exists. |
| **Stop hooks** | `runcheck` / `prepcheck` / `sentrycheck`, registered into `.claude/settings.json` by `hooks-ensure`. | **down-stack** | Hook list in `plugin/skills/faff/bin/lib/hooks-ensure.js`. The authoritative home is the `governance-check` required CI status check — `plugin/skills/faff/bin/lib/governance-check.js` + `.github/actions/governance-check` (FAFF-363, the FAFF-562 chain). The harness Stop hooks are fast local feedback, not the floor. |
| **PreToolUse fences** | `merge-fence` / `background-fence`, registered into `.claude/settings.json`. | **down-stack** | `plugin/skills/faff/bin/lib/merge-fence.js`. Branch protection plus the required check *is* the merge fence, per the forge-side floor in `docs/adr/0043-the-merge-floor-is-a-mechanical-interlock-faff-merge-gate-is-the-sole-sanctioned.md`; the PreToolUse deny is the local echo. |
| **Subagent dispatch** | The Agent-tool producer-dispatch prose in the gateway. | **adapter** | The engine-fork transport — `faff engine call`, a CLI spawn (`plugin/skills/faff/bin/lib/engine.js`) — is the portable path; the Agent tool is the Claude fast path. Follow-on: FAFF-593. |
| **Permission / appetite mapping** | Appetite levels ride Claude Code permission modes. | **adapter** | A documented per-harness mapping table (Claude permission modes / `codex --full-auto` + native sandbox). Follow-on: FAFF-605. |
| **WorktreeCreate hook** | `setup-worktree.sh`, invoked by the harness on worktree creation. | **drop** | `plugin/skills/faff-graft/setup-worktree.sh`. Graft's skill step provisions the worktree directly; the hook becomes an optional enhancement. Follow-on: FAFF-595. |
| **Model / effort lanes** | `models:` / `effort:` config resolved to Agent-tool parameters. | **adapter** | `plugin/skills/faff/bin/lib/backends.js`. Selection moves behind the `backends:` config namespace (FAFF-523), which generalises engines to named backend records. |

## How to extend

A new harness coupling gets a row here **before** it gets an implementation — the disposition is decided against the four-term vocabulary first, then the adapter/drop work follows in its own ticket. When FAFF-483 defines the harness-abstraction interface, every seam it names must trace to exactly one row above; a seam with no row is an unclassified coupling and a gap in this inventory. Keep each row anchored to a concrete artifact (a file, a hook list, an ADR, or a config key) so a reviewer can check the classification against the codebase.
