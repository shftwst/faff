# opus-5 vs opus-4.8 — judge characterisation (default effort)

**Ticket:** FAFF-725 · **Run:** 2026-08-04 · **Model under test:** `claude-opus-5` (frontier `claude -p`, default effort, no `--effort`)

## Why this ran

A switch to opus-5 had produced hallucination, never-ending flip-flopping review loops, and ignored skill instructions, so we reverted to opus-4.8. This spike measures that objectively: a full default-effort opus-5 sweep of the skill-judgement eval, as a control against opus-4.8 (both at the same unstated default effort → a fair comparison). Question: is opus-5 decent, and can it be tamed?

## Method

- `characterise-opus5.sh` (in this dir) — waits for the eval lane, runs `run-evals.mjs --driver frontier --model claude-opus-5 --update-baseline eval/baselines/frontier-opus5.json` (default effort), then prints a per-kind opus5-vs-4.8 readout.
- **Clean run:** 2060 reps, **0 errored**, 29 kinds, ~674k tokens. Started right at the 3:10am quota reset, so no session-limit contamination (contrast the FAFF-711 refutation-spec run, which was quota-poisoned).
- Artifacts in this dir: `characterise-opus5.log` (verbatim run output), `frontier-opus5.json` (per-kind baseline, reconstructed from the log). The 6 MB raw per-rep judgements were captured at `.faff/eval-runs/20260804-031054/judgements.jsonl` (gitignored, local-only — regenerable, not committed).

## Result — opus-5 at default effort

Strong on **27 of 30 kinds** (0.90–1.00 accuracy + stability). Three hard regressions, all delivery-critical:

| kind | opus-5 acc / stab | opus-4.8 acc / stab | signature |
|---|---|---|---|
| **dupe** | **0.14** / 0.86 | 1.00 / 1.00 | confidently wrong (~6 in 7) — near-total failure on duplicate detection |
| **grouping** | 0.54 / **0.54** | ~0.92 / ~0.92 | flip-flop (coin-toss stability) — the never-ending review loops |
| refutation-spec | 0.54 / 0.81 | ~0.72 / ~0.91 | stably ~0.18 below 4.8 |

Marginal / no-4.8-baseline: `architecture` 0.72, `spec-verdict` 0.85, `refutation-code` 0.80 (lowish, but absent from the committed 4.8 baseline). `confidence` 0.90, `gloss` 0.97, `decomposition` 0.99 (slightly down, fine). Everything else 1.00.

### Caveat on the 4.8 comparison

`grouping` + `refutation-spec` are **null** in the committed 4.8 baseline (`eval/baselines/frontier.json`) — reverted with the closed PR #539, pending the FAFF-711 clean re-baseline. So the script's *own* comparison table (`characterise-opus5.log`) silently dropped two of the three regressions (it intersects kinds present in both baselines) and flagged only `dupe`. The ~0.92 / ~0.72 4.8 figures above are the errored-excluded numbers from the FAFF-711 investigation, not the committed baseline. Landing FAFF-711 fills those rows so future cross-model tables are complete.

## Conclusion

- **opus-5 at default effort is not ready to be the judge.** `dupe 0.14` alone disqualifies it for unattended grooming — duplicate detection is what tidy/wtf lean on. **opus-4.8 stays** the pinned judge (`models.eval`).
- The failure **clusters** on 3 kinds (not broad/deep) → by the spike's own decision rule this is a **Phase 2** case, not "abandon opus-5".

## Next (Phase 2 — separate work)

- Re-sweep just `dupe` / `grouping` / `refutation-spec` at **`--effort high`** (+ optionally a reinforced prompt) and see if the cluster lifts. Runnable once **FAFF-722** merges — it adds the `--effort` flag the eval driver currently lacks.
- If effort-high rescues dupe/grouping → opus-5 is tamable with a driver knob. If dupe stays ~0.14 cranked → 4.8 stays, permanently.

## Cross-vendor angle (future)

The same rig can run a peer-frontier control (e.g. GPT-5.6-sol) on the identical corpus once the harness supports a non-Anthropic engine for the eval lane — see `verification/external-verification/faff-labs/experiments/l4-experiment-design.md`.
