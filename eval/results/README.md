# Model evaluation results

One directory per model, one subdirectory per date: `<model>/<date>/result.json` (the per-kind numbers, the by-skill roll-up and the format lane) and `README.md` (the tables). They are written by `eval/run-model-eval.mjs`; see "Evaluating a new model" in `eval/README.md`. This index is regenerated on every write.

Results are not baselines. `eval/baselines/` holds the committed numbers the regression gate compares against; this directory holds how other models compare to the reference.

Role columns are mean accuracy over the skills in that role (delta against the reference in brackets).

| model | date | tier | producer | reviewer | judge |
|---|---|---|---|---|---|
| [spark/deepseek-v4.1-flash-1017](spark-deepseek-v4.1-flash-1017/2026-11-16/README.md) | 2026-11-16 | mixed (see notes) | 0.987 (-0.009) | 0.894 (-0.078) | 0.867 (-0.050) |
| [spark/deepseek-v4.1-flash-1017](spark-deepseek-v4.1-flash-1017/2026-11-17/README.md) | 2026-11-17 | mixed (see notes) | 0.984 (-0.012) | 0.903 (-0.068) | 0.842 (-0.050) |
