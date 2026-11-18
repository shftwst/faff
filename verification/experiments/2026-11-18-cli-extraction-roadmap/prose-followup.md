# Follow-up prose cuts

Main at `6716b920` has saved **200,628 bytes / 49,376 estimated tokens** across 41 files. Replaying the 23 open prompt patches saves another **83,509 bytes / 20,657 estimated tokens**. The combined corpus is **1,087,944 bytes / 269,896 estimated tokens**, down **284,137 bytes / 70,033 estimated tokens (20.71% by bytes)** from the original.

| Product PR | Skills | Before (bytes / est. tokens) | After (bytes / est. tokens) | Saved (bytes / est. tokens) |
|---|---:|---:|---:|---:|
| [#1256 methodology dispatch and appetite](https://github.com/shftwst/faff/pull/1256) | 6 | 223,169 / 55,206 | 219,677 / 54,353 | 3,492 / 853 |
| [#1257 supervision and executor returns](https://github.com/shftwst/faff/pull/1257) | 3 | 182,829 / 45,331 | 177,235 / 43,944 | 5,594 / 1,387 |

Both cuts together remove **9,086 bytes / 2,240 estimated tokens**. The audit forecast roughly 7,000–8,200 bytes. Both complete product branches merge cleanly together from the recorded main. Replaying the published prompt patches reproduced the 41 final prompt blobs obtained by applying these two cuts to the previous integration. Raw byte counts cover only installed skills and references. Estimated tokens round each complete file up at four UTF-16 code units per token.

## Caller fidelity

Two Claude Code workers answered the same eleven questions using the before and after excerpts plus the shared contracts. Each received one arm. Scoring compared the requested decisions against the rules and the shipped hook. There was one run per arm, with simulated inputs and no live tracker or forge operations.

| Scenario | Original | Shortened |
|---|---|---|
| Parent and owned-child spend, foreign newest transcript, estimate fallback | Pass | Pass |
| Owned, live foreign, stale foreign, ownerless and explicit recovery hook decisions | 4 of 5 decisions. Blocked live foreign recovery | All 5 decisions. Stayed silent on live foreign recovery |
| Switch to the next member of a parallel chain | Pass | Pass |
| Dispatcher reconciles a return and defers delivery | Pass | Pass |
| Sequential supersession evidence and heartbeat ownership | Pass | Pass |
| Plot batching, later node edit, PRDR and nested dispatch | Pass | Pass |
| Jot, Map and Tidy outputs and per-container PRDRs | Pass | Pass |
| WTF diagnostics with and without a preceding Tidy | Pass | Pass |
| High-appetite thematic conversion with an ambiguous home | Pass | Pass |
| Low and high appetite MVP cut pending DoD confirmation | Pass | Pass |
| Full-appetite fallback homes, shell retirement, forbidden high-appetite status moves | Pass | Pass |

The original met every requested decision in 10/11 cases and the candidate in 11/11. Six separate calls to the real Stop hook returned block, silent, warn, warn, silent and block for an owned run, a fresh foreign sidecar, a stale foreign run, an ownerless run, live foreign recovery and abandoned foreign recovery respectively. After the paired trial, supervision copyediting split sentences and the agile wording made the thematic-conversion scope explicit. A further Claude Code case on the final wording allowed only the clear thematic move, reserved the ambiguous home and MVP scope cut for human confirmation and kept the project shell.

Both branches passed adapter validation, external-reference lint and deleted-rule inventories (23/23 blocks). Focused Node suites passed 397/397 on supervision and 141/141 on methodology.

Hosted CI passed all thirteen applicable checks on each PR. Deploy was skipped on pull requests. GitHub cancelled the initial #1256 macOS validation before assigning a runner. The single-job retry passed. [Methodology checks](https://github.com/shftwst/faff/pull/1256/checks) · [Supervision checks](https://github.com/shftwst/faff/pull/1257/checks)
