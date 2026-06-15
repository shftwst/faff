# `eval/` — judgement-eval harness (FAFF-130)

An **offline** probe for faff's LLM-**judgement** surface (`vague` / `dupe` / `stale` / `superseded`
classification, `pick-ordering`, synthesis gloss) — the residue the scripted-driver harness
(`test/helpers/`, FAFF-93/94/95/97) deliberately leaves untested. It measures the load-bearing
unknown ADR 0003 flagged: **judgement flakiness** (does the same fixture get classified differently
run-to-run?), not just accuracy.

## Not part of CI
`eval/` is **excluded from the `node --test` globs** — running it makes real `claude -p` model
calls (cost + the `~/.claude.json` config race). `npm test` / CI run only the deterministic pieces:
`test/eval-grader.test.mjs` (grader + orchestration with a **mock** driver) and
`test/eval-cli-driver.test.mjs` (driver-preset wiring via the **pure** `buildInvocation` seam) —
both import `eval/` modules but spawn **zero** processes.

## Pieces
| File | Role |
|---|---|
| `cases/*.json` | `EvalCase` fixtures + human oracles (12: 2 per kind) |
| `envelope.mjs` | parse the `faff-eval:judgement` block (fail-loud) — judgement capture stays out of the seam harness |
| `grader.mjs` | two-tier **deterministic** grader: closed-set set-equality, ordering rank-correlation, gloss rubric pass-rate (LLM-judge advisory only) + per-case stability/accuracy aggregation |
| `cli-driver.mjs` | the real `claude -p` driver with per-run `CLAUDE_CONFIG_DIR` isolation — **the only piece that costs money**. One code path, two presets (`frontierDriver` / `localDriver`) over `makeCliDriver`; both default to `--bare --plugin-dir <repo>/plugin` so the run loads the real skills (FAFF-133). Pure `buildInvocation` / `*Opts` factories resolve `{bin,args,env}` for the tests |
| `run-evals.mjs` | orchestrator: load → drive K reps via an *injectable* driver → grade → escalate wobbly cases → aggregate. Owns the `--driver` selector, `--plugin-dir`/`--no-plugin`, and `--compare` |

## Drivers — frontier vs local (FAFF-132)
Two presets of the **same** `claude -p` invocation; the orchestrator/grader are driver-agnostic.

- **frontier** (default) — `claude -p` against the Anthropic API.
- **local** — the same `claude -p` path with ollama's **native Anthropic Messages API** redirect (no proxy, no new transport): `ANTHROPIC_BASE_URL=<ollama host>`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, plus `--model`. The base URL is **required** (`--base-url` / `FAFF_EVAL_LOCAL_BASE_URL`) — there is **no `localhost` default**, because ollama here is served over **Tailscale**. (Ollama's `ollama launch claude --model <m>` wrapper is an alternative but assumes localhost; the env-var path is what reaches the tailnet host. See docs.ollama.com/integrations/claude-code; local models need ≥64k context.)

## Skills loaded into the run (FAFF-133)
The per-rep `CLAUDE_CONFIG_DIR` is isolated (so the nested `claude -p` can't clobber the parent `~/.claude.json` — ADR 0003), but an *empty* config dir also means **no faff skills** — so the spawned `claude` improvises a vanilla-model judgement instead of running the shipped faff-tidy prose. Both presets therefore default to **`--bare --plugin-dir <repo>/plugin`**:

- `--plugin-dir` loads the repo's **own** plugin (skills as shipped in the commit under test, namespaced `/faff:faff-tidy`) — the only way to load a local plugin; project `.claude/skills` is **not** auto-loaded in `-p`, and no settings.json key exists for it.
- `--bare` skips hooks / `CLAUDE.md` / plugin-sync but still resolves `--plugin-dir` skills — clean + host-independent.
- `--plugin-dir <path>` overrides the dir; `--no-plugin` disables it for a **vanilla skill-less baseline**.

This supersedes FAFF-132's "frontier is byte-identical to FAFF-130" note — that preserved the skill-less behaviour; both presets now load the same shipped skills so frontier and local measure the same prose. (Invoking tidy's *test-mode* against a fixture so the model actually runs the judgement is FAFF-131's measurement half.)

## Running it (FAFF-131, human-supervised)
> ⚠ Needs a real `claude -p` + (for frontier) a budget. ~12 cases × K=20 base (+ escalation to ~50) ≈ 240+ reps.
```sh
# frontier (Anthropic API)
node eval/run-evals.mjs --only dupe-001 --reps 2          # smoke: validate CLAUDE_CONFIG_DIR isolation first
node eval/run-evals.mjs                                   # full run → eval/report/latest.json

# local (ollama over Tailscale) — operator params: studio.longhair-escalator.ts.net + qwen3.6:27b-mlx
node eval/run-evals.mjs --driver local \
  --base-url http://studio.longhair-escalator.ts.net:11434 --model qwen3.6:27b-mlx \
  --only dupe-001 --reps 2                                # smoke: validate reachability + envelope parse first
node eval/run-evals.mjs --driver local \
  --base-url http://studio.longhair-escalator.ts.net:11434 --model qwen3.6:27b-mlx

# frontier vs local, same cases, one table → eval/report/compare.json
node eval/run-evals.mjs --compare \
  --base-url http://studio.longhair-escalator.ts.net:11434 --model qwen3.6:27b-mlx
```
(`--base-url`/`--model` may instead come from `FAFF_EVAL_LOCAL_BASE_URL` / `FAFF_EVAL_LOCAL_MODEL`.)

FAFF-131 then fills `docs/adr/0004-*.md` (FAFF-130 shipped the **scaffold**) with the measured
per-kind accuracy + flakiness + $/case cost + the gloss judge↔human delta — now tabulable
**frontier vs local** — and the fork recommendation (evals-only / live-driver / both).
