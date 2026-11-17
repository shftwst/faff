# Kernel focused pair

Status: held. One original baseline and one original candidate ran on Sol medium; no retries or replacements.

| Check | Baseline | Candidate |
|---|---:|---:|
| Rubric cases | 41/41 | 41/41 |
| Native execution audit | Pass | Pass |
| Registered artifact inputs | 9/9 | 8/9 |
| Actual CLI outcomes | 9/9 | 9/9 |
| Rule decisions | 32/32 | 32/32 |

For the missing-marker case the candidate emitted `decisions:[{}]` instead of the registered `decisions:[{"marker":"none"}]`. Both reached the expected CLI refusal: exit 1, `markers_valid:false`, `decisions:[]`. The matching consumer outcome does not erase the registered input failure. Model qualification remains outstanding.

This pair measures nine emitted contract artifacts and 32 explicit policy decisions, with actual CLI consumption and independent semantic review. It does not execute the complete caller workflows or establish repeated-trial reliability. The implemented source cut is 13,260 bytes / 3,253 estimated tokens; the historical accepted ledger is unchanged.

Exact hashes, original reports, actual CLI traces and independent reviews are linked by `kernel-core-contracts-pair-v1-result.json`.
