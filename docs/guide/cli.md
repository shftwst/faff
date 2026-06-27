# The `faff` CLI

A small command-line tool ships **inside the faff plugin** — `faff`, a single dependency-free Node script (no `npm install`, no `node_modules`, no build — just `node`). It's the **deterministic-tools-over-prose** half of the suite: every mechanical, contractual, reproducible operation lives here so the skills don't hand-parse YAML, eyeball ledgers, or re-derive transition rules. Same input → same output, every run.

The skills and hooks invoke it for themselves — each resolves it as `command -v faff` if it's on `PATH`, otherwise from its own install location (`${CLAUDE_PLUGIN_ROOT}/skills/faff/bin/faff` when running as a plugin, or the sibling `faff/bin/faff` when dev-linked) — so **normal use needs no setup**.

Most subcommands also accept `--selftest` (runs an in-memory test table) and `--json` (structured output). The pure functions (`eligible`, `admissible`, `next`, `project-next`, `state`, `contain`, `intakecheck`, `container-check`) make **no** tracker or network calls — the agent maps live state into the flags.

## Config & install health

| Subcommand | What it does |
|---|---|
| `config <path\|get\|spec-docs-path\|dump\|resolved> …` | Resolve / read `.faffrc.yaml` — the only sanctioned config-read path. `get <dotted.key>` reads a scalar; `resolved` echoes non-default slots for a run banner. |
| `config init --set k=v [--set …] [--force] [--dry-run]` | Write/merge a `tracking:` block into `.faffrc.yaml`. |
| `hooks-ensure [--dry-run]` | Idempotently register faff's Stop-hook set (`runcheck` + `prepcheck --hook`) in `.claude/settings.json`. |
| `gitignore-ensure [--json]` | Idempotently, non-destructively add faff's local artifacts (`.faffrc` forms + `.faff/`) to `.gitignore`. |
| `doctor` | Install health — flags each faff skill as a live symlink vs a stale copy-install. |
| `sync [--dry-run]` | Repair a stale copy-install — re-link the faff skills + the CLI via `scripts/link-skills.sh --global --replace`. |
| `validate-adapters [--skills-dir DIR]` | Lint the shipped slot-skills for conformance drift (CI / pre-commit). |
| `validate-adapters --configured [--root DIR]` | Pre-flight *your* configured (swapped-in) slot occupants before an unattended run. |

## Eligibility & routing (pure — no tracker/network)

| Subcommand | What it does |
|---|---|
| `eligible --label L [--label L …] [--default opt-in\|opt-out]` | Is a ticket automation-eligible? (`true`/`false`; `hold > automate > default`). |
| `admissible --spec <path\|-> [--lights-out] [--json]` | Lights-out quality-IN gate — pure structural check over a spec's machine-verifiable DoD (`## Scenarios` + `### N. DONE`). Gating R1 (≥1 born-verifiable scenario) / R2a (non-empty DONE) / R2b (no banned-vague DONE item); advisory R3 (runnable-check command → `warnings`, never gates). **No LLM, never re-invokes the producer.** Fail-safe: ambiguous/unparseable/absent DoD → inadmissible; `--lights-out` absent → admissible no-op (L1–L3 unchanged). Emits `AdmissibilityVerdict {admissible, reasons, checks, warnings}`; exit 0 admissible / 1 inadmissible / 2 usage. |
| `next --status S --spec none\|low\|medium\|high […]` | Legal next step for an issue (JSON `{next, reason}`). |
| `project-next --current planned\|started\|completed\|cancelled [--kind project\|issue] --total N --active N --done N [--has-dod] [--json]` | Container (project / parent-issue) **state-coherence** transition predicate — emits a `ContainerTransition {kind, current, desired, action, reason}` from a child-issue rollup. The `/faff-tidy` orchestrator-lane sweep maps live child statuses to `{total, active, done}` and applies any `advance` via the tracker. **Forward-only + monotonic** — `advance` only when `rank(desired) > rank(current)`; never moves a container backward. v1: project → started (first child starts) · parent-issue → started (any child in progress) · project → completed (all children done **and** no DoD; `--has-dod` defers the Done — the DoD-gated, release-gate Done is out of scope for this predicate). Parent-issue → Done out of scope. Exit 0 (pure) / 2 malformed rollup. |
| `state <issue> [--json] [--root DIR]` | Local read-model: resolve an issue's spec/parked/branch/worktree/ledger state as JSON; no MCP. |
| `contain <mandate> (--parent ID \| --root) --ancestry JSON` | Subtree-of-mandate containment — is `parent ∈ subtree(mandate)`? Fail-closed. |
| `container-check [--json]` | Is this run inside a host-isolated container (the blast-radius boundary)? Reads only standard runtime signals (`KUBERNETES_SERVICE_HOST`, `/.dockerenv`, `/run/.containerenv`, systemd `container=` on PID 1, truthy env `container`) — invents no marker, never parses `/proc/1/cgroup`. Prints `{result, basis}`; exit 0 `contained` / 1 `not_confirmed`. The autonomous-entry preflight warns (never blocks) on `not_confirmed` by default. |

## Run orchestration & safety (beep-boop)

| Subcommand | What it does |
|---|---|
| `runcheck [--hook] [--recover] [--json] [RUN_DIR]` | Audit a `/faff-beep-boop` run ledger; `--hook` gates session-end on dangling admitted work (owning session / `--recover` hard-blocks; foreign runs warn at most). |
| `heartbeat [RUN_DIR] [--json]` | The single sanctioned write path for the run ledger's `owner.last_heartbeat` — refresh it to now (resolves `RUN_DIR` → `$FAFF_RUN_DIR` → latest run) so a live-but-quiet build's long sub-steps keep the run *held*. Field-merge (writes only that field, atomically); soft no-op on a done/unowned/absent run; exit 2 on a malformed ledger. |
| `prepcheck [--hook] [--json]` | Audit faff-prep attach-state markers (`.faff/prep/*.json`); `--hook` blocks at Stop on any produced-but-not-attached spec. |
| `budget check [--until HH:MM] [--max N] [--json]` | Emit a run cost/compute `BudgetState` (spent, breached, outcome) from the ledger + config `budget:` + local transcripts. |
| `park-history --now ISO [--issue ID]` | Deterministic repeat-park counts over `.faff/runs` summaries (≥3 same root-cause class in 21d). |
| `worktree-prune [--own PATH] [--branch B] [--issue ID] [--dry-run]` | Scoped, fail-safe prune of *only this run's own* dangling worktrees — never the repo-wide prune that clobbers a live peer. |

## Provenance & control labels

| Subcommand | What it does |
|---|---|
| `intakecheck <issue> [--labels csv] [--interactive]` | Intake-provenance guard — did the ticket enter through a sanctioned front door? (reads the CLI-written `.faff/provenance/<issue>.json` marker). |
| `intake-record <issue> --via jot\|backfill\|fast-track` | Write/update the provenance marker + emit the descriptor (migration / orchestrator tool, not the human steady-state remedy). |
| `labels [--names]` | Print the canonical faff control-label manifest (JSON; `--names` for bare names). |
| `label add\|remove <issue-id> <label>` | Emit a `faff-contract:label-op` descriptor for a control-label mutation the agent performs via MCP — pure, no tracker I/O; refuses the tracker-owned eligibility labels. |

## Contracts, schemas & quality

| Subcommand | What it does |
|---|---|
| `contract <name> [--in FILE]` | Per-slot contract script: extraction JSON in → canonical contract data out (`spec-readiness`, `review-verdict`, `quality-gates`, `delivery-outcome`, `prd-readiness`); exit 0 conformant / 1 non-conformant / 2 fail-loud. |
| `gates <discover\|run> [--json]` | Cost-ordered engineering-quality gate ladder — discover/run the repo's *own* declared cheap checks (pre-commit / package.json / Makefile) cheapest-first, fail-fast, emit a `faff-contract:quality-gates` block. |
| `adr <next-number\|new\|list\|live-decisions\|validate\|supersede>` | Deterministic mechanics over the `docs/adr/` Nygard log. |
| `prd <path\|new\|link\|list\|validate [--strict]>` | Deterministic mechanics over the `docs/prd/` PRD log — the product-axis counterpart to `adr`: scaffold/list/validate a per-container PRD (slug-keyed) and emit the container-link line; the caller commits + applies it. `validate` is lenient (metadata + non-empty body, never section shape); `validate --strict` additionally form-checks `## Acceptance criteria` as **born-verifiable** — every criterion must be a Given/When/Then scenario or a MUST/comparator assertion (loose prose, placeholder-only, or a missing section FAILs). A **Frozen**-status PRD always runs that born-verifiable check even without `--strict` (the freeze precondition); `## Requirements` and other sections stay lenient. The check gates FORM only — semantic verifiability is the evaluator's/human's job. |
| `prdr <path\|new\|list\|supersede\|validate>` | Deterministic mechanics over the `docs/prdr/` product-requirements **decision-record** log — the supersedable record between the immutable PRD and the per-slice spec (PRD content, ADR mechanics: globally-numbered, immutable, supersedable). `new` scaffolds a record citing its container + PRD-goal; `supersede` is a pure mechanical linker; `validate` is presence-only (metadata + the four body sections + symmetric supersession, never section content). Reads `tracking.prdr_docs_path` (default `docs/prdr/`). |
| `profile <validate\|show> [--file F]` | Infra-profile schema + CLI — validate a profile JSON, or `show` the effective profile (`.faff/infra-profile.json` ⊕ `.faffrc.yaml infra:`, override wins per field). |
| `fixtures <validate\|show\|realise> [--file F] [--out DIR]` | Fixtures dataset-manifest schema + CLI — `validate` a manifest JSON, `show` the effective manifest (`.faff/fixtures/manifest.json` ⊕ `.faffrc.yaml fixtures:`, override wins per field), or `realise` a deterministic dataset from `(manifest, seed)` into `dataset_path`/`--out`. The generation strategy is a deferred slot; this ships the contract plus a trivial reference generator. |
| `events <append\|validate\|read> --run <run-id> [--ts ISO] [--file F] [--type T] [--issue I] [--json]` | Structured run-event log — the timeline substrate for run observability. `append` adds one `RunEvent` (the CLI fills the `schema`/`run_id`/`seq`/`ts` envelope; `seq` = current line count is the authoritative monotonic order, `ts` best-effort) to the append-only `.faff/runs/<run-id>/events.jsonl`; `validate` checks a JSONL stream line-by-line; `read` filters it. The in-flight view and morning report are later producers that read this log. |
| `lint-refs [--root DIR]` | Ban external-artifact refs (ticket tags, ADR citations, numbered `docs/adr/` pointers) in enforced prose — scans `docs/guide/**`; names each `file:line ✗ match` and exits 1 on a hit, else 0. |
| `lint-cli-doc [--root DIR] [--json]` | Assert `docs/guide/cli.md` documents every subcommand the CLI dispatches (the `COMMANDS` registry), bidirectionally — names each `✗ missing`/`✗ orphaned` and exits 1 on drift, else 0. |

Most are invoked by the skills and hooks for themselves. A few are handy by hand — e.g. `faff config get <dotted.key>` to read a value from your config, or `faff validate-adapters --configured` to pre-flight your swapped-in slots before an unattended run.

## Running it by hand

The binary lives at `plugin/skills/faff/bin/faff` inside the installed plugin. Locate it and (optionally) symlink it onto your `PATH` once:

```
faffbin=$(find ~/.claude -path '*/skills/faff/bin/faff' -type f 2>/dev/null | head -1)
ln -s "$faffbin" ~/.local/bin/faff          # then add ~/.local/bin to PATH if it isn't already
export PATH="$HOME/.local/bin:$PATH"
```

Or just call it by that full path. (Inside skills and hooks it's resolved automatically — `command -v faff` first, then the install-relative path — so you never have to set this up for normal use.)
