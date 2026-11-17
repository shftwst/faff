# Extracted skill reductions

Three independent PRs extract previously measured prompts onto main.
`status.json` records source hashes, bytes, estimated tokens, local checks and
historical fidelity limits. No new model samples were run.

| PR | Runtime saving | Estimated token saving | Local tests | CI at recording |
|---|---:|---:|---:|---|
| [1207](https://github.com/shftwst/faff/pull/1207), adversarial review | 52,030 B | 12,859 | 651 pass | 13 checks pass |
| [1208](https://github.com/shftwst/faff/pull/1208), gateway | 7,152 B | 1,764 | 10 pass | 13 checks pass |
| [1209](https://github.com/shftwst/faff/pull/1209), kernel configuration | 11,346 B | 2,795 | 35 pass | Running |
| Total pending | 70,528 B | 17,418 | | |

Current-main savings already landed are 42,050 bytes / 10,326 estimated tokens.
These three PRs remain open. Keep landed and pending totals separate.

The adversarial loader received a one-line section-boundary correction and
regression checks because the reordered skill otherwise included implementor
instructions in the reviewer prompt. The old loader fails the new regression
checks. Both the adversarial and gateway prompts match their measured files.
The kernel configuration section matches its measured candidate; all other
bytes preserve current main, including the next-step offer introduction.

Detailed historical evidence remains at the commits linked in the PR bodies.
The implementation branches contain six, four and three files respectively:
runtime edits, necessary ratchets/inventories, an optional operator reference
and the reviewer consumer fix. No experiment harness or raw run archive is
included. The held kernel core-contract rewrite remains outside this batch.
