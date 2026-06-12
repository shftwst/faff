# The `faff` CLI

A small command-line tool ships **inside the faff plugin** — `faff`, a single dependency-free Node script (no `npm install`, no `node_modules`, no build — just `node`). The skills and hooks invoke it for themselves — each resolves it as `command -v faff` if it's on `PATH`, otherwise from its own install location (`${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff` when running as a plugin, or the sibling `faff/bin/faff` when dev-linked) — so **normal use needs no setup**.

## Subcommands

The full set, as the binary prints it (`faff` with no arguments shows this list):

| Subcommand | What it does |
|---|---|
| `config <path\|get\|spec-docs-path\|dump\|resolved> …` | Resolve / read `.faffrc.yaml` (`resolved` echoes non-default slots). |
| `config init --set k=v [--set …] [--force] [--dry-run]` | Write/merge a tracking block into `.faffrc.yaml`. |
| `runcheck [--hook] [--json] [RUN_DIR]` | Audit a `/faff-beep-boop` run ledger for undispatched work. |
| `validate-adapters [--skills-dir DIR]` | Lint the shipped slot-skills for conformance drift (CI / pre-commit). |
| `validate-adapters --configured [--root DIR]` | Pre-flight *your* configured (swapped-in) slot occupants before an unattended run. |
| `labels [--names]` | Print the canonical faff control-label manifest (JSON; `--names` for bare names). |
| `eligible --label L [--label L …] [--default opt-in\|opt-out]` | Is a ticket automation-eligible? (`true`/`false`). |
| `next --status S --spec none\|low\|medium\|high […]` | Legal next step (JSON `{next, reason}`). |
| `state <issue> [--json] [--root DIR]` | Local read-model: resolve an issue's spec/parked/branch/worktree/ledger state as JSON; no MCP. |
| `gitignore-ensure [--root DIR] [--json]` | Idempotently add faff's local artifacts (`.faffrc` forms + `.faff/`) to `.gitignore`. |
| `contract <name> [--in FILE]` | Per-slot contract script: extraction JSON in → canonical contract data out (exit 0 conformant / 1 non-conformant / 2 fail-loud). |

Most are invoked by the skills and hooks for themselves. A few are handy by hand — e.g. `faff config get <dotted.key>` to read a value from your config, or `faff validate-adapters --configured` to pre-flight your swapped-in slots before an unattended run.

## Running it by hand

The binary lives at `plugin/skills/faff/bin/faff` inside the installed plugin. Locate it and (optionally) symlink it onto your `PATH` once:

```
faffbin=$(find ~/.claude -path '*/skills/faff/bin/faff' -type f 2>/dev/null | head -1)
ln -s "$faffbin" ~/.local/bin/faff          # then add ~/.local/bin to PATH if it isn't already
export PATH="$HOME/.local/bin:$PATH"
```

Or just call it by that full path. (Inside skills and hooks it's resolved automatically — `command -v faff` first, then the install-relative path — so you never have to set this up for normal use.)
