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
