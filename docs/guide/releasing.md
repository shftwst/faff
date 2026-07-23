# Releasing faff

Releases are cut automatically by [release-please](../../.github/workflows/release-please.yml) —
it opens and maintains the release PR from Conventional Commit history. This runbook is the
**human pre-release checklist** that sits alongside that automation: the checks a person confirms
before letting a release PR merge. It does not replace release-please and adds no CI job.

## Before cutting a release

- [ ] **Eval baseline is non-PROVISIONAL and current.** The committed
  `eval/baselines/frontier.json` must reflect a real recorded frontier sweep, not the seeded
  placeholder — so a release carries a genuine judgement-evidence claim. Check mechanically:

  ```sh
  node -e "process.exit(/PROVISIONAL/.test(require('./eval/baselines/frontier.json').meta.source) ? 1 : 0)" \
    && echo "baseline OK (non-PROVISIONAL)" \
    || echo "baseline still PROVISIONAL — run a real frontier sweep first"
  ```

  The predicate reads `meta.source` and **fails (exits non-zero) while it still contains
  `PROVISIONAL`**. When it fails, the remedy is a recorded sweep:

  ```sh
  node eval/run-evals.mjs --driver frontier --update-baseline eval/baselines/frontier.json
  ```

  That is a multi-hour, budgeted, **human-supervised** `claude -p` run — see `eval/README.md` for
  the sweep mechanics, its per-kind checkpointing, and the oracle-calibration work it depends on.
  Review the swept numbers, then commit the refreshed baseline.

  **This is a human gate, not a CI-enforced one.** A real frontier sweep costs hours and budget and
  needs human supervision, so it cannot run in CI — an enforcing job would either block every
  release or silently spend money. The predicate above is a cheap check a human runs here; the gate
  is the reviewer confirming this box, not a pipeline.

> As of this writing the committed `eval/baselines/frontier.json` is still PROVISIONAL (seeded
> 2026-06-16, 14 of 27 kinds), so the predicate exits non-zero today. It will pass once a real
> sweep is recorded and committed.
