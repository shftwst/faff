## Configuration (shared across all sub-skills)

Resolve every configuration value through `faff config`. Never read configuration files directly, including through shell commands or the Read tool. `CLAUDE.md` supplies project context, never configuration.

| Source | Resolution and posture |
|---|---|
| `.faff/config.yaml` | Shared base; recommend committing it. Store stable identifiers/preferences, not secrets. `api_key_env` names an environment variable; its value comes from the environment. |
| `.faff/config.local.yaml` | Optional gitignored machine-local overlay. Deep-merge maps per leaf over the base and defaults; replace sequences wholesale; overlay scalars win. |
| `.faffrc.yaml` / `.faffrc.local.yaml` | Deprecated fallback names. `config path` and `config check` report the move. |
| `.faffrc`, `.faffrc.yml`, `.faffrc.local`, `.faffrc.local.yml` | Invalid legacy names: fail loudly, never substitute defaults. |
| Names containing `.example` | Ignore; never load as configuration. |

Absent, empty and comment-only bases are valid. Missing registered keys use built-in defaults; with no files, use defaults and offer interactive first-run setup as defined in **First run**. Never silently ignore a parse failure in either file. Meaningful base content that parses to empty or a non-map fails reads with the file and remedy on stderr.

`FAFF_CONFIG_BASE_LENIENT=1` permits warn-and-default incident recovery; warnings continue on every read, and L4 lights-out minting refuses while it is set. Protective exceptions remain: `config check` reports a malformed base as an error finding (exit 1), and `sentry check` continues with default thresholds and `config_malformed: true`.

**Resolver.** Use these commands on the resolved executable:

| Command | Result |
|---|---|
| `config path` | Resolved paths, base first, one per line; exit 3 only if neither file exists. |
| `config get <dotted.key> [-d DEFAULT]` | Resolved scalar or registered built-in default (exit 0). A missing non-registry key prints DEFAULT/empty and exits 3. |
| `config spec-docs-path [--create]` | Spec directory with its default applied; `--create` makes it. |
| `config resolved` | Non-default configuration, every explicitly set slot and both file paths for the run banner; expose overrides, overlays and dispatch values. |
| `config check` | Read-only posture findings: base committed, overlay ignored, no secret-shaped values. Exit 0 clean, 1 findings, 2 unreadable. Advisory; run before committing the base, warn without blocking on posture findings. |

**Resolving the `faff` executable (canonical; sub-skills reference this).** Prefer `faff` on PATH, normally linked at `~/.local/bin/faff`. Otherwise resolve the bundled executable; do not hardcode the development-linked location:

```bash
faff=$(command -v faff || echo "${CLAUDE_PLUGIN_ROOT:-$HOME/.claude}/skills/faff/bin/faff")
[ -x "$faff" ] || faff=$(find ~/.claude -path '*/skills/faff/bin/faff' -type f 2>/dev/null | head -1)
```

Call `"$faff" config ...` and the other bundled commands (`runcheck`, `validate-adapters`, etc.). The CLI requires only Node and owns configuration resolution/parsing.

**CLI-only config access.** This applies to slots, appetite, tracking and paths, including values used only for reasoning. `validate-adapters` rejects direct shell reads in skill prompts.

- **No hand-writing.** The rule runs both directions: no skill or agent hand-*writes* any rc file either (base or overlay). **`faff config init`** bootstraps the 9 flat `tracking.*` keys (the onboarding / create-from-scratch path, matching `/faff-onboard`'s existing rule); **`faff config set <dotted.key> <value>`** is the general writer for every OTHER scalar behaviour key, at any nesting depth — `appetite`, `dispatch.*`, `slots.*`, `backends.<name>.<field>`, and the rest. Both are surgical raw-text edits that round-trip through the real reader before committing — never a hand-written wholesale rewrite, which is exactly the silent-corruption failure the committed-base posture exists to catch. **The one named carve-out:** sequence-valued keys a `key value` grammar cannot express — `adversarial.refs` / `.fallbacks` / `.backends` — are refused by `config set` (by name, whatever form they're stored in) and stay a committed-base hand-edit; git is the drift alarm for that one class of keys. **`faff config unset <dotted.key> [--local]`** removes a leaf or map subtree and refuses list-valued keys like `config set`.

**Stable config only.** Store project IDs, team keys, repo slugs, slot choices and preferences. Refetch mutable tracker data on every invocation; never store milestones, dates, progress, issue snapshots or current-cycle notes in configuration.

Configuration vocabulary, without duplicating the full example file:

- `tracking.*`: tracker selection, legacy single-team `team_key`, project/team ID, repo, GitHub host and document paths. `teams`, `default_team` and `team_routing` support multiple teams. Spec/PRD/PRDR/ADR/spike paths follow their shared location rules.
- `install.skill_targets`: optional sequence; default targets are `~/.claude/skills` and `~/.agents/skills`.
- `slots.*` selects occupants below; `dispatch.*` selects supported model/effort transports. Deprecated `mode: delivery-lead` is replaced by `slots.methodology`.
- `gates.fallback`: no declared gates means `fail-closed` by default (`needs-human`); explicit `advisory` surfaces the gap and passes.
- `concurrency_max`: default 4 for the parallel executor; ignored by the sequential executor. `worktree_root`: default `~/.faff/worktrees/<repo>`.
- `logging`: `full` by default writes invocation narrative; `essential` suppresses it. Both retain the machine-consumed hard floor.
- Automation eligibility is the tracker-owned `faff-automate` label, present or absent. There is no `automation_default` knob.

Faff auto-detects which issue tracker MCP servers are available and adapts accordingly — `tracking.tracker` only pins the choice when autodetection is ambiguous. It works with Linear, GitHub Issues, Jira, or any tracker exposed via MCP. Concluding "no tracker MCP → git-only mode" is valid **only after a discovery attempt, and never when a tracker is pinned** — "not in my immediately-visible tool list" is *not* evidence of absence (it silently mis-fires under a deferred-tool harness; see **Tracker availability resolution** below). Only once discovery has genuinely found no connector, and none is pinned, does faff fall back to git-only mode (commits, branches, PRs). `tracking.git_host` is a separate knob: GitHub is the only supported git host (the merge gate is GitHub-only), so there is no host to detect between — leave it unset, or pin it to `github` explicitly.

### Slots (optional delegation)

Resolve `slots.<name>` through the CLI. Unset slots use their built-in defaults; a missing slot is never a park reason. Each occupant owns its behaviour contract.

| Slot | Default | Role and boundary |
|---|---|---|
| `intake` | `faffter-noon-intake` | New-work discovery for jot; emits a discovery brief. |
| `spec` | `faffter-noon-spec` | Spec producer; emits `spec-readiness`. |
| `spec_review` | `faffter-noon-spec-review` | Spec-stage approach critique. |
| `adr` | `faffter-noon-adr` | Sole ADR-body author at graft Step 4b: Nygard Context/Decision/Consequences from settled `Chosen:`, spec rationale and the configured log. Confidence is advisory; the body has no pass/fail gate. |
| `architecture` | `faffter-noon-architecture` | Proposes one best-fit, build-biased production architecture from the brief/spec and `profile show`. For a new runnable surface, prep requests `architecture-proposal` (`chosen_architecture`, `rationale`, `adr_candidates[]`, `assumptions[]`, `recommendation`) plus an `## ADR promotion intent` section. Proposes, never commits: graft Step 4b materialises candidates. Attach the validated block verbatim to the spec; downstream consumers read it there, never out-of-band. The spec-review architectural lens is its downstream critic. |
| `env` | `faffter-noon-env-compose` | Provisions a representative, health-checked stand-in from the proposal/profile, normally local compose plus synthetic seed. Emits `env-handle` with status, endpoint(s), health checks and teardown reference for the evaluator. A recommendation other than `build` provisions nothing and surfaces for a human; only `ready` passes the contract. The handle is fixed; provisioning mechanism is swappable. |
| `transport` | `faffter-noon-transport-private-network` | Env's inline evaluator-to-SUT reachability resolver: base host, optional credentials and teardown handle for co-resident, nested-container or cross-machine context. No gated block or `dispatch.transport` lane. Default covers private networks; without a separated evaluator resolve `localhost`. |
| `evaluator` | `faffter-noon-evaluate` | Code-blind evaluation from spec and running env, never source. Classify DoD with `dod classify`, exercise born-verifiable criteria, mark unjudgeable criteria `needs-human` with a cause `reason_code` (human-only or an environment gap), and emit `holdout-verdict` before teardown. CLI classification/validation and coercion are deterministic; exercising criteria is judgement. Non-blind or incoherent verdicts cannot pass. |
| `prd` | `faffter-noon-prd` | Code/tracker-blind producer from the PRD alone: judges machine-verifiable stop conditions and implementation licence, emits `prd-readiness`. The L4 run-start consumer validates it; only `admissible` admits, otherwise refuse. |
| `concurrency` | `faffter-noon-concurrency-sequential` | Executes beep-boop's conflict partition through graft, sequentially by default. The parallel occupant adds capped, isolated worktrees and rebase-before-merge. Mechanism slot, no paired adaptor. |
| `review` | `faffter-noon-review` | Graft Step 9 pre-PR review; emits `review-verdict`. |
| `gates` | Built-in graft step | Step 7.5 calls `gates run` for the repo's declared format/lint/type/static/unit checks, cheapest-first and fail-fast before review/PR/CI. Optional custom runner emits `quality-gates`; malformed signals become `needs-human`, never pass. |
| `methodology` | `faffter-noon-methodology-thematic` | Backlog/build diagnostic lens answering named outputs. |
| `grounding` | None | Optional domain-knowledge advisor; absence is a no-op. |
| `routing_adaptor` | `faffidavit-routing` | Assigns/computes/displays the fixed six-verdict automation contract and root-cause taxonomy. Vocabulary and queue admission remain fixed. |
| `rendering_adaptor` | `faffidavit-rendering` | Human-facing form, synthesis, density, token economy and issue glosses; normalises output. No internal contract. |
| `ship` | `faffter-noon-ship` | Graft Step 10 delivery: readiness, merge/deploy and cleanup of what it created; emits `delivery-outcome`. Default is no-op readiness plus ordinary `gh pr merge`; a deploy-capable occupant supplies release mechanics. |
| `profile` | Built-in `profile mine` | Read-only repo miner for committed CI, containers, infrastructure and language manifests. No network, installs or subprocesses. Emits `infra-profile`; the orchestrator runs `profile validate` before writing `.faff/infra-profile.json`. A custom acquirer must emit the same descriptor. |

`spec`, `review`, `gates` and `ship` emit `faff-contract:<name>` blocks: `spec-readiness`, `review-verdict`, `quality-gates`, `delivery-outcome`. Consumers locate the block, JSON-parse it and pipe it directly to `faff contract <name>`. Custom producers or fused wrappers emit that same block; there are no `spec_adaptor`, `review_adaptor` or `ship_adaptor` extraction slots. `review` and `ship` are internal graft phases, not user slash commands.

**Descriptor blocks are distinct.** Trusted CLI emissions `infra-profile`, `intake-record` and `label-op` have no `faff contract` dispatcher entry. Their own command validates them when applicable (`profile validate` for `infra-profile`). Future descriptors follow that class rather than acquiring a `faff contract` validator. Producer contracts remain separately validated as above.

### Model & effort selection (`dispatch:` — per-lane)

Slots choose the skill; dispatch chooses model/effort only where a transport can carry it. A true Agent subagent, an out-of-session helper such as `review-call.mjs`, a spawned `claude -p`, or a direct `engine call` can select a model. Inline Skill invocation inherits the session model; a dispatch key cannot change it.

| Setting | Consumer |
|---|---|
| `dispatch.build` | Concurrency build agents and graft Step 7's bare executor; resolve per unit with `dispatch resolve build --tier <tier> --confidence <conf>`. |
| `dispatch.prep_explore` | Prep exploration and clean-context verification subagents. |
| `dispatch.spec`, `spec_review`, `methodology`, `intake`, `architecture`, `adr` | Interactive producer subagents in prep/jot/graft and tidy/plot/map/wtf. ADR is graft Step 4b. Only `methodology` and `intake` allow `model: engine:<name>` via the top-level `engines` map and `engine call`. |
| `eval.model`, `eval.effort` | Separate eval settings, not a dispatch lane. The driver's `claude -p` model is pinned to `claude-sonnet-4-6` by default; `run-evals --model` explicitly overrides it. Record the resolved model in output and baseline metadata; never inherit the account default for bulk eval. |

Graft's inline `review`/`ship` and beep-boop's direct methodology `build-queue`/`pick-ordering` requests remain session-pinned. A different model requires a real subagent/helper dispatch.

Every dispatch site calls `faff dispatch resolve <lane>`, never `config get dispatch.*`: the resolver owns precedence and whole-tree validation. Unset fields resolve to `inherit`; the registry supplies no dispatch defaults.

| Build field | Precedence, most specific first |
|---|---|
| Model | `by_tier.<tier>` → `by_tier.default` → `by_confidence.<conf>` → `by_confidence.default` → `dispatch.build.model` → `inherit` |
| Effort | `by_tier.<tier>` → `by_tier.default` → `dispatch.build.effort` → `inherit` |

Never guess a tier. Without one, model skips all tier steps; effort may still use `by_tier.default`. Missing/unknown confidence uses `by_confidence.default`; only high/medium route, since low-confidence specs never reach build. There is no effort-by-confidence setting.

Models use `sonnet`, `opus`, `haiku`, `fable` or `inherit`, plus the allowed engine references. Effort uses `inherit`, `low`, `medium`, `high`, `xhigh` or `max`. Invalid tokens anywhere in the tree, unknown lanes/fields, or old top-level `models`/`effort` blocks fail loudly with exit 2 and the correct dispatch key. Engine references also fail on unknown names, missing provider/model/host, Anthropic providers or non-allowlisted lanes. Unreachable or mis-served engines are named dispatch failures, never silent session fallback; there is no fallback chain.

Apply effort only when supported by the transport: `engine call` applies it or refuses unsupported effort; Agent has no effort parameter, so record the resolved effort as not applied. `config resolved` exposes configured dispatch values in the banner. Dispatch does not replace adversarial engine settings (including judge tuning) or the eval driver's own settings; those remain independent consumers.

