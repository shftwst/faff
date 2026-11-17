# Extracted skill reductions

`status.json` records source hashes, bytes, estimated tokens, local checks and
historical fidelity limits. No new model samples were run for these extractions.

| PR | Runtime saving | Estimated token saving | State |
|---|---:|---:|---|
| [1207](https://github.com/shftwst/faff/pull/1207), adversarial review | 52,030 B | 12,859 | Merged |
| [1208](https://github.com/shftwst/faff/pull/1208), gateway | 7,152 B | 1,764 | Merged |
| [1209](https://github.com/shftwst/faff/pull/1209), kernel configuration | 11,346 B | 2,795 | Open; macOS CI queued |

Cumulative savings landed since the quick-pass starting main are **101,232
bytes / 24,949 estimated tokens**. Pending kernel savings are **11,346 bytes /
2,795 estimated tokens**. The current covered main totals are 1,270,849 bytes
and 314,980 estimated tokens across 41 files.

Kernel CI found a missed line baseline: the prompt shrank from 465 to 435 lines,
but its separate line allowance was left at 465. Commit ec3ef82a lowers it to 435
and preserves the gateway allowance of 62. The original zero-headroom test
failed before this correction and passes after it. All 151 adapter, prose-size
and eval-driver tests pass locally, plus 14 integration checks. The final tree
matches the tested integration tree exactly. All four CI unit shards and the
Node 24 source-lane job pass; macOS validation is queued at this recording.
The prompt bytes, historical measurements and runtime savings are unchanged.

The adversarial loader also received a section-boundary correction so it does
not include implementor instructions in the reviewer prompt. Both adversarial
and gateway prompts match their measured files. The kernel configuration
section matches its measured candidate; all other prompt bytes preserve main.

Detailed historical evidence remains at the commits linked in the PR bodies.
The implementation branches include required inventories and ratchets, an
optional operator reference, and the reviewer consumer fix. They contain no
experiment harness or raw run archive. The held kernel core-contract rewrite
remains outside this batch.
