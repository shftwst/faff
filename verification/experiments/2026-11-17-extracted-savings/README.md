# Extracted skill reductions

`status.json` records source hashes, bytes, estimated tokens and fidelity limits.
Tokens use the ceiling of UTF-16 code units divided by four per complete file.

| PR | Runtime saving | Estimated token saving | State |
|---|---:|---:|---|
| [1207](https://github.com/shftwst/faff/pull/1207), adversarial review | 52,030 B | 12,859 | Merged |
| [1208](https://github.com/shftwst/faff/pull/1208), gateway | 7,152 B | 1,764 | Merged |
| [1209](https://github.com/shftwst/faff/pull/1209), kernel configuration | 11,346 B | 2,795 | Merged |
| [1210](https://github.com/shftwst/faff/pull/1210), rendering | 9,842 B | 2,401 | Merged |
| [1211](https://github.com/shftwst/faff/pull/1211), thematic | 3,672 B | 896 | Merged |
| [1212](https://github.com/shftwst/faff/pull/1212), PRD | 2,001 B | 494 | Merged |
| [1213](https://github.com/shftwst/faff/pull/1213), default spec-review | 1,550 B | 380 | Open, CI running |
| [1214](https://github.com/shftwst/faff/pull/1214), kernel core contracts | 13,174 B | 3,231 | Open, CI running |

Merged savings since the quick-pass starting main: **128,093 bytes / 31,535
estimated tokens**. Main totals **1,243,988 bytes / 308,394 estimated tokens**
across 41 covered files. Open PRs contribute another 14,724 bytes / 3,611 tokens.
Local and held reductions are excluded from both totals.

Fresh Opus diagnostics used one fixed sample per arm. Thematic passed 16/16
cases and 9/9 real termination CLI scenarios per arm. PRD passed 14/14 cases
and 6/6 real contract consumptions per arm. Both passed independent manual
output review and native tool/delivery audits, with zero retries, waivers or
normalisations. Historical five-sample results remain separate; these bounded
checks do not establish complete caller execution or statistical equivalence.

Default review remains held: its fresh baseline passed automated/native checks
but five finding titles differed between prose and JSON in four artifacts.
No candidate was launched. This is a baseline failure, not a measured regression
from reduction. Tidy housekeeping is also outside the merge queue: its source
review and 133 existing tests pass, but model behaviour remains unmeasured.
Intake remains held by a lexical mismatch: the candidate wrote "kept" where
the frozen rubric accepts "retention", "retained" or "keep". Manual review
found the meaning preserved; raw 17/18 and the registered hold remain.

Default spec-review passed a fresh 21/21 cases and 6/6 real contract/routing
checks per arm, with all six invalid controls rejected per arm. Its two QA
severity labels varied within policy without changing the correct revise route.

The corrected kernel core candidate passed 41/41 cases, 9/9 producer-input
bindings, 9/9 real CLI outcomes and 9/9 invalid controls in each arm. Manual
and native audits passed. The prior held treatment stays separate.

The combined beep-boop reporting and ledger candidate saves 8,065 bytes / 1,979
tokens locally. Source review and 247 existing tests pass; fresh reporting and
ledger baselines are running. This saving is excluded from the totals above.

Kernel's missed line allowance was corrected from 465 to 435. Linux checks
passed; macOS was cancelled after merge. The other merged extractions had
passing CI. Runtime prompt bytes and recorded fidelity limits remain unchanged.

Implementation PRs contain prompt changes, required inventories and ratchets,
and necessary consumer fixes. Experiment harnesses and raw runs stay off main.
