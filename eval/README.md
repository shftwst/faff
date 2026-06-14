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
| `cli-driver.mjs` | the real `claude -p` driver with per-run `CLAUDE_CONFIG_DIR` isolation — **the only piece that costs money**. One code path, two presets (`frontierDriver` / `localDriver`) over `makeCliDriver`; pure `buildInvocation` resolves `{bin,args,env}` for the tests |
| `run-evals.mjs` | orchestrator: load → drive K reps via an *injectable* driver → grade → escalate wobbly cases → aggregate. Owns the `--driver` selector + `--compare` |

## Drivers — frontier vs local (FAFF-132)
Two presets of the **same** `claude -p` invocation; the orchestrator/grader are driver-agnostic.

- **frontier** (default) — `claude -p` against the Anthropic API. `node eval/run-evals.mjs` with no `--driver` is byte-identical to FAFF-130.
- **local** — the same `claude -p` path with ollama's **native Anthropic Messages API** redirect (no proxy, no new transport): `ANTHROPIC_BASE_URL=<ollama host>`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, plus `--model`. The base URL is **required** (`--base-url` / `FAFF_EVAL_LOCAL_BASE_URL`) — there is **no `localhost` default**, because ollama here is served over **Tailscale**. (Ollama's `ollama launch claude --model <m>` wrapper is an alternative but assumes localhost; the env-var path is what reaches the tailnet host. See docs.ollama.com/integrations/claude-code; local models need ≥64k context.)

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
