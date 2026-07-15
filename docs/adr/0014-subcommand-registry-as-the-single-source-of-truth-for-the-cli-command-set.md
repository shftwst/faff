# ADR 0014 — Subcommand registry as the single source of truth for the CLI command set

- **Status:** Accepted
- **Date:** 2026-06-26
- **Issue:** FAFF-237

## Context

The bundled `faff` CLI grew its subcommand dispatch as a long `if (sub === "X") return cmdX(rest)` chain in `main()`. That chain was the only authoritative list of what the CLI exposes, but it was *implicit* — nothing could enumerate the command set without re-parsing source text or the human-facing `USAGE` help string. When FAFF-237 added a doc-coverage guard (`lint-cli-doc`) that must compare the CLI's real command set against `docs/guide/cli.md`, it needed a structure it could read directly. Sourcing the set from `--help`/`USAGE` prose or a self-source regex would just create a third list to drift from the dispatcher, defeating the guard's purpose. The same need recurs for any future help/usage-coverage check.

## Decision

`main()` dispatches through a `COMMANDS` name→handler map (`{ "config": cmdConfig, … }`) rather than an `if`-chain. After handling the `-h`/`--help`/`help` aliases, dispatch is `const h = COMMANDS[sub]; if (h) return h(rest); else <unknown-subcommand error + USAGE, exit 2>`. The canonical subcommand set is defined as exactly `Object.keys(COMMANDS)` — the dispatcher and any coverage check read one list. The `-h`/`--help`/`help` aliases are intentionally *not* registry entries (they are not subcommands).

## Consequences

- **Single source of truth.** Every subcommand registers in `COMMANDS`; the canonical set cannot drift from what actually dispatches. `lint-cli-doc` (and any future help/usage-coverage gate) enumerates the registry, never parsing prose.
- **Adding a subcommand is one registry entry** plus a `docs/guide/cli.md` row — the doc-coverage gate fails CI if the row is omitted, making the doc upkeep mechanical rather than discipline-dependent.
- **Behaviour-preserving.** The alias handling and unknown-subcommand error/exit-2 path are unchanged; existing CLI tests guard the dispatch behaviour.
- **Mild coupling.** Handler functions must be defined (hoisted) where the registry references them. This is satisfied by Node function-declaration hoisting and carries no ordering burden in practice.
