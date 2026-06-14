# `eval/` — judgement-eval harness (FAFF-130)

An **offline** probe for faff's LLM-**judgement** surface (`vague` / `dupe` / `stale` / `superseded`
classification, `pick-ordering`, synthesis gloss) — the residue the scripted-driver harness
(`test/helpers/`, FAFF-93/94/95/97) deliberately leaves untested. It measures the load-bearing
unknown ADR 0003 flagged: **judgement flakiness** (does the same fixture get classified differently
run-to-run?), not just accuracy.

## Not part of CI
`eval/` is **excluded from the `node --test` globs** — running it makes real `claude -p` frontier
calls (cost + the `~/.claude.json` config race). `npm test` / CI run only the deterministic pieces,
via `test/eval-grader.test.mjs` (grader + orchestration with a **mock** driver, zero frontier calls).

## Pieces
| File | Role |
|---|---|
| `cases/*.json` | `EvalCase` fixtures + human oracles (12: 2 per kind) |
| `envelope.mjs` | parse the `faff-eval:judgement` block (fail-loud) — judgement capture stays out of the seam harness |
| `grader.mjs` | two-tier **deterministic** grader: closed-set set-equality, ordering rank-correlation, gloss rubric pass-rate (LLM-judge advisory only) + per-case stability/accuracy aggregation |
| `frontier-driver.mjs` | the real `claude -p` driver with per-run `CLAUDE_CONFIG_DIR` isolation — **the only piece that costs money** |
| `run-evals.mjs` | orchestrator: load → drive K reps via an *injectable* driver → grade → escalate wobbly cases → aggregate |

## Running it (FAFF-131, human-supervised)
> ⚠ Needs `claude -p` + a budget. ~12 cases × K=20 base (+ escalation to ~50) ≈ 240+ reps.
```sh
node eval/run-evals.mjs --only dupe-001 --reps 2   # smoke: validate CLAUDE_CONFIG_DIR isolation first
node eval/run-evals.mjs                            # full run → eval/report/latest.json
```
FAFF-131 then fills `docs/adr/0004-*.md` (this PR ships the **scaffold**) with the measured
per-kind accuracy + flakiness + $/case cost + the gloss judge↔human delta, and the fork
recommendation (evals-only / live-driver / both).
