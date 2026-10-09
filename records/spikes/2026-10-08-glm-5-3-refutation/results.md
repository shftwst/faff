# GLM 5.3 refutation eval (2026-10-08)

A run of the `refutation-code` and `refutation-spec` eval cases against `spark/glm-5.3-flash`, at `reasoning_effort` low and high. It asks whether GLM 5.3 could serve as the adversarial reviewer in place of Opus.

## What ran

- **Model:** `spark/glm-5.3-flash`, served over an OpenAI-compatible endpoint.
- **Code:** commit `774b7ae7` (FAFF-1195). That is before FAFF-1222 and FAFF-1223, so the refuter and eval parsers were the stricter, older ones.
- **Cases:** all 5 `refutation-code` and 16 `refutation-spec` cases, 20 reps each, escalating to 50 when reps disagree.
- **Prompts, fan-out and grading:** the harness's own (`eval/cli-driver.mjs`, `eval/run-evals.mjs`). Only the transport differs; see `run.mjs`.
- **Sharding:** four shards per effort level (`shards.txt`, `launch.sh`).
- **Low effort** ran to completion.
- **High effort** was stopped by hand after about 19 hours, to free the hosts:
  - `refutation-spec-014` never ran.
  - spec-010, spec-013, spec-015 and spec-016 stopped short of their planned rep counts.
  - High effort has no `summary.json`; its scores below are computed from the judgements.

## Results

Scores are the mean over cases of each case's mean rep score. "Strict" counts an unparseable (errored) rep as wrong.

| | Code review | Spec review |
|---|---|---|
| Opus 5.5 (`eval/baselines/frontier.json`, 2026-10-05) | 0.80 | 0.90 |
| GLM low, strict | 0.74 | 0.65 |
| GLM low, errors excluded | 0.80 | 0.68 |
| GLM high, strict | 0.78 | 0.78 |
| GLM high, errors excluded | 0.80 | 0.79 |

Errored reps:

| | Code | Spec |
|---|---|---|
| Low | 17 of 250 | 25 of 680 |
| High | 4 of 130 | 4 of 557 |

### Per case

Each cell shows the score, then the reps run and how many errored.

| Case | Low | High |
|---|---|---|
| refutation-code-001 | 90% (50, 5 err) | 100% (20, 0 err) |
| refutation-code-002 | 96% (50, 2 err) | 100% (20, 0 err) |
| refutation-code-003 | 88% (50, 6 err) | 92% (50, 4 err) |
| refutation-code-004 | 96% (50, 2 err) | 100% (20, 0 err) |
| refutation-code-005 | 0% (50, 2 err) | 0% (20, 0 err) |
| refutation-spec-001 | 94% (50, 0 err) | 98% (50, 1 err) |
| refutation-spec-002 | 42% (50, 0 err) | 66% (50, 0 err) |
| refutation-spec-003 | 82% (50, 0 err) | 90% (50, 0 err) |
| refutation-spec-004 | 45% (20, 3 err) | 74% (50, 0 err) |
| refutation-spec-005 | 48% (50, 6 err) | 84% (50, 2 err) |
| refutation-spec-006 | 4% (50, 3 err) | 2% (50, 0 err) |
| refutation-spec-007 | 100% (20, 0 err) | 100% (20, 0 err) |
| refutation-spec-008 | 96% (50, 2 err) | 100% (50, 0 err) |
| refutation-spec-009 | 84% (50, 0 err) | 100% (20, 0 err) |
| refutation-spec-010 | 0% (50, 0 err) | 0% (12, 1 err) |
| refutation-spec-011 | 78% (50, 6 err) | 100% (20, 0 err) |
| refutation-spec-012 | 92% (50, 1 err) | 100% (50, 0 err) |
| refutation-spec-013 | 75% (20, 2 err) | 87% (39, 0 err) |
| refutation-spec-014 | 72% (50, 0 err) | not run |
| refutation-spec-015 | 45% (20, 1 err) | 73% (40, 0 err) |
| refutation-spec-016 | 90% (50, 1 err) | 100% (8, 0 err) |

## Re-grading errored reps with the current parsers

`regrade-parse.mjs` and `regrade-score.mjs` re-parse the errored reps with the parsers merged in FAFF-1222 and FAFF-1223, then grade the ones that now parse.

| | Errored | Now parse | Graded correct |
|---|---|---|---|
| Low code | 17 | 14 | 13 |
| Low spec | 25 | 21 | 21 |
| High code | 4 | 4 | 4 |
| High spec | 4 | 2 | 2 |

The one wrong low-effort answer is refutation-code-005, which GLM answers wrongly anyway. With the re-grade, high-effort code review rises to about 0.82, and low-effort code review to about 0.79.

## Why spec-006 and spec-010 score near zero

Both are clean cases: the refuter should approve.

1. **The QA lens reads `DONE:` as empty.** Every `refutation-spec` fixture ends with a bare `DONE:` label, then a `## Scenarios` heading. Real specs keep DONE and Scenarios as separate sections and never leave DONE empty, so GLM's blocker is a correct reading of faff's spec grammar.
   - 54 of 61 graded runs on 010 raise it, and 62 of 97 on 006.
   - It also costs points on 005, 011, 013 and 015.
   - Tracked in FAFF-1243.
2. **006 has no happy-path scenario.** None of 006's three scenarios asserts that a valid token resets the password, and GLM's QA lens says so in 32 further runs. FAFF-1243 proposes making this an expected QA objection.
3. **GLM's infosec lens over-fires on 010.** This is the behaviour 010 exists to test: it raises a major in 49 of 61 graded runs, mostly asking who grounds the `corrective-integrity` probe's `trusted` assertion. This is a model weakness, not a fixture problem.

## Projected effect of FAFF-1243

`simulate-faff-1243.jq` re-scores the existing runs as if FAFF-1243 had landed:
- it drops each QA objection about an empty DONE;
- it requires exactly a QA objection on 006.

| | Spec now | Spec projected |
|---|---|---|
| GLM high | 0.78 | about 0.82 |
| GLM low | 0.65 | about 0.71 |

At high effort, most of the gain comes from 006 (2% to 40%) and 015 (73% to 88%); 010 stays at 0% because of the infosec over-firing.

This is an estimate only. Changing the fixtures changes the prompt, and Opus may lose 006 under the new oracle (to about 0.84 at worst).

## Reproducing

From this directory (`records/spikes/2026-10-08-glm-5-3-refutation`):

```bash
# Re-run (needs LOCAL_API_KEY; GLM_BASE_URL overrides the endpoint).
# run.mjs writes runs/<tag>/judgements.jsonl uncompressed.
./launch.sh

# Re-grade errored reps against a faff checkout's parsers.
node regrade-parse.mjs <faff checkout> runs
node regrade-score.mjs <faff checkout> runs

# Project FAFF-1243.
zcat runs/*.judgements.jsonl.gz | jq -s -r -f simulate-faff-1243.jq
```

`run.mjs` imports the harness from the checkout it sits in, so check out `774b7ae7` to reproduce these numbers exactly.
