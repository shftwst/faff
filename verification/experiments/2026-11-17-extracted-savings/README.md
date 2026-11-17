# Extracted skill reductions

`status.json` records bytes, estimated tokens, source hashes and fidelity limits.
Runtime tokens use the ceiling of UTF-16 code units divided by four per file.

| PR | Runtime saving | Estimated token saving | State |
|---|---:|---:|---|
| [1207](https://github.com/shftwst/faff/pull/1207), adversarial review | 52,030 B | 12,859 | Merged |
| [1208](https://github.com/shftwst/faff/pull/1208), gateway | 7,152 B | 1,764 | Merged |
| [1209](https://github.com/shftwst/faff/pull/1209), kernel configuration | 11,346 B | 2,795 | Merged |
| [1210](https://github.com/shftwst/faff/pull/1210), rendering | 9,842 B | 2,401 | Open, CI passed |

Cumulative savings merged since the quick-pass starting main are **112,578
bytes / 27,744 estimated tokens**. Main now totals 1,259,503 bytes and 312,185
estimated tokens across 41 covered files. Pending rendering savings are
9,842 bytes / 2,401 estimated tokens. Local and held reductions are excluded.

The thematic integration saves 3,672 bytes / 896 estimated tokens locally;
a fresh one-pair Opus diagnostic is in progress. Historical five-sample evidence
remains separate from this exact integration.

Default review remains held. Its fresh Opus baseline passed all 27 automated
cases and native delivery checks, but manual inspection found five prose/JSON
finding-title mismatches in four artifacts. No candidate was launched or retry
made. This is a baseline failure, not evidence of a reduction-caused regression.
Its local 5,320 bytes / 1,309 estimated tokens are excluded from savings totals.

Kernel CI exposed a missed line allowance. The correction lowers it from 465
to 435 and preserves the gateway allowance of 62; 151 local tests and 14
integration checks passed. All four CI unit shards and the Node 24 source lane
passed. macOS validation was cancelled after merge. Prompt bytes did not change.

Historical evidence remains at immutable commits linked in each PR. Rendering
preserves main's synthesis heading for its consumers. The implementation PRs
contain prompt edits, required inventories and ratchets, and any necessary
consumer fix. The experiment harness and raw runs remain off main.
