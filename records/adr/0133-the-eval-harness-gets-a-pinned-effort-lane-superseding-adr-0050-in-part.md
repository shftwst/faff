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

Give the eval harness its own `eval:` config block, holding both settings that define a baseline's lineage:

- `eval.effort`, new: the closed vocabulary `inherit | low | medium | high | xhigh | max`, with an off-vocabulary value failing at read. `inherit` is the default and passes no `--effort` flag, so a repo that does not set it behaves exactly as before.
- `eval.model`, moved from `models.eval`: open vocabulary (`claude -p` validates the id), never an `engine:` value, default `claude-sonnet-4-6`.
- Resolution in `eval/run-evals.mjs` is the run's `--model` / `--effort` flag, then the `eval:` block, then the default (no flag for effort).

Eval is not a dispatch lane: it is not a pipeline phase, and it is assigned through `claude -p` rather than an Agent-tool dispatch. So its settings sit outside the `models:` / `effort:` lane trees, which keeps them out of the planned single `dispatch:` tree (FAFF-1197). The old keys `models.eval` and `effort.eval` fail loud at read and write, naming the replacement; no compatibility period.

The effort moves to `medium` in the same change that captures the `claude-opus-5-5` baseline. Medium is the default effort for `claude-opus-5-5`, so it is the effort production sessions run the skills at, and the eval should grade the skills as they run there.

## Consequences

- Baseline and comparison runs take the same model and effort from config, so an operator no longer has to remember the effort flag. The flags still override the block for experiments, and the resume stamp-guard still refuses to blend runs at different models or efforts.
- `eval.model` and `eval.effort` are both part of a baseline's lineage: changing either means re-capturing the baseline.
- A pinned level does not follow a future change to the CLI default. That is intended: the baseline stays comparable until someone changes the setting on purpose.
- Any config or script still naming `models.eval` or `effort.eval` fails loud until updated.
- The eval runbook's statement that eval has no effort setting is withdrawn.
