# Controlled-run preparation

Status: planning and source preparation only. No Claude calls or production changes were made.

The [implementation plan and Claude runbook](plan-snapshot.md) define the recorder, independent assertions, model settings, bounded calibration and launch conditions. The proposed launcher does not exist yet.

| File | Evidence |
|---|---|
| `preparation.json` | Pinned source, inspected file hashes, configured model/effort and absent Claude executable |
| `historical-development-inputs.json` | Five real historical decision snapshots, one per observed kernel selected in source order |
| `review-comment-source.md` | Exact current prose for the first proposed operation |

The historical records are partial decision inputs, not complete tickets. They have already been exposed during the audit and are development material. Their recorded verdicts are not independent expected outcomes. The comment fixtures and controlled-run harness remain to be implemented and tested.

The pre-release source remains `f767bdd1c0a78f6259c335742c1567a074f512a0`, independent of incoming merges. Five bounded baseline calibration attempts can run before those merges once the recorder and transport preflight pass on a Claude-capable host. Migration comparisons must then use the released commit as their reference.

## Harness status, 15 November

The recorder, fixtures, Claude adapter and schedule from the plan are implemented under `eval/control-parity/` on branch `eval/controlled-skill-runs`, with tests in `test/control-parity-*.test.mjs`. No paid model call has been made.

| Check | Result |
|---|---|
| Control-parity tests | 106 pass, no model calls |
| Existing unit suite | 8517 tests, 0 fail, 35 skipped |
| Independent review | No critical findings; five important findings fixed with failing tests first |
| `prepare-20261115/` | Manifest bound to the pinned plugin tree, Claude Code 2.1.311, `claude-opus-5-5`, effort `medium` |
| `preflight-20261115/` | `not_ready`: `CLAUDE_CODE_OAUTH_TOKEN` is not set; every other binding passed |
| Capture-refuse probe of the real CLI | Run by hand with a placeholder token: exactly the four fixture tools plus the CLI's own placeholder tool, `max_tokens` 8192, effort `medium`; nothing forwarded |

`execution-ledger.md` records each decision taken while building the harness and the deferred review findings.

To launch the five calibration attempts, set a long-lived token from `claude setup-token` in `CLAUDE_CODE_OAUTH_TOKEN`, then run a new preflight and the baseline into new directories:

```bash
node eval/control-parity/run.mjs preflight --manifest verification/experiments/2026-11-14-controlled-skill-runs/prepare-20261115/manifest.json --out <new preflight dir>
node eval/control-parity/run.mjs baseline --manifest verification/experiments/2026-11-14-controlled-skill-runs/prepare-20261115/manifest.json --readiness <new preflight dir>/readiness.json --out <new calibration dir>
```

The manifest binds commit `f2713d5a`. Any later commit under `plugin/` or `eval/control-parity/` needs a new prepare. A successful preflight captures one request body that contains the account email the CLI injects, so do not commit `probe/` or `requests/` directories without redacting them.
