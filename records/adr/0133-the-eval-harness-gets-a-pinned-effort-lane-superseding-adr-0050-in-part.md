# ADR 0133 — The eval harness gets a pinned effort lane, superseding ADR-0050 in part

- **Status:** Proposed
- **Provenance:** human
- **Date:** 2026-10-05
- **Supersedes (in part):** ADR-0050, only its exclusion of `effort.eval`. The prep/spec exclusion (`effort.spec`, `effort.spec_review`, `effort.prep_explore`, `effort.architecture`), the inline/subagent boundary, the closed vocabulary and every other ADR-0050 decision stay in force.

## Context

ADR-0050 gave the subagent-dispatched lanes an `effort:` setting and left eval out, on the grounds that eval is the frontier driver's pinned model rather than a beep-boop slot. Eval effort has since been set per run with `run-evals.mjs --effort <level>`, and a run without the flag uses the `claude -p` default.

Two findings from the 2026-10-03 claude-opus-5-5 spike (`records/spikes/2026-10-03-opus-5-5-pragmatism/`) make that unsafe for a baseline:

- **Effort changes the judgements.** On the three hardest refutation-spec cases, at 5 reps per case on the same day and token, `claude-opus-5-5` passed 15 of 15 at low, 9 of 15 at medium and 4 of 15 at high. Every failure was an over-objection. The other six kinds measured did not move.
- **The default is not fixed.** A run with no flag scored the same as `--effort medium` (9 of 15), matching the stated default for `claude-opus-5-5`; the stated default for `claude-opus-5` was high. A baseline captured without a flag records whatever the CLI default is on the day.

With effort set only by flag, every comparison run must repeat the baseline's flag by hand. A run that forgets it grades a different setup against the baseline and reports the difference as a regression or a gain.

## Decision

Add an `effort.eval` setting, read by the eval harness, with the same mechanics as the existing effort settings:

- the closed vocabulary `inherit | low | medium | high | xhigh | max`, with an off-vocabulary value failing at read;
- `inherit` as the default, which passes no `--effort` flag, so a repo that does not set it behaves exactly as before;
- resolution in `eval/run-evals.mjs` as `--effort` flag, then `effort.eval`, then no flag, mirroring how `models.eval` resolves the model.

The setting moves to `medium` in the same change that captures the `claude-opus-5-5` baseline. Medium is the default effort for `claude-opus-5-5`, so it is the effort production sessions run the skills at, and the eval should grade the skills as they run there.

## Consequences

- Baseline and comparison runs take the same effort from config, so an operator no longer has to remember the flag. The `--effort` flag still overrides it for experiments, and the resume stamp-guard still refuses to blend runs at different efforts.
- `effort.eval` is part of a baseline's lineage, like `models.eval`: changing either means re-capturing the baseline.
- A pinned level does not follow a future change to the CLI default. That is intended: the baseline stays comparable until someone changes the setting on purpose.
- The eval runbook's statement that eval has no effort setting is withdrawn.
