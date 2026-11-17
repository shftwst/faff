# GPT stand-in screen progress

Two samples per policy arm; incomplete rows are not final results. Manual fidelity review remains separate. Passing case scores do not waive failed run-level gates.

| Combination | Task | Policy | Samples | Assessed runs passed | Assessed rubric | Native certified | Median seconds |
|---|---|---|---:|---:|---|---:|---:|
| opus-reference | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | unavailable |
| opus-reference | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 2/2 | unavailable |
| opus-reference | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | unavailable |
| opus-reference | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | unavailable |
| sol-low | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | 153.4 |
| sol-low | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 2/2 | 129.1 |
| sol-low | rendering | baseline | 2/2 | 1/2 | artifact: 18/18; decision: 37/40 | 1/2 | 194.7 |
| sol-low | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 201.8 |
| sol-medium | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | 146.4 |
| sol-medium | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 2/2 | 136.7 |
| sol-medium | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 202.6 |
| sol-medium | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 185.4 |
| sol-high | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | 145.9 |
| sol-high | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 1/2 | 140.2 |
| sol-high | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 1/2 | 210.2 |
| sol-high | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 1/2 | 195.9 |
| astra-low | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | 164.0 |
| astra-low | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 2/2 | 139.7 |
| astra-low | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 216.0 |
| astra-low | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 206.6 |
| astra-medium | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 2/2 | 150.8 |
| astra-medium | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 2/2 | 145.1 |
| astra-medium | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 216.1 |
| astra-medium | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 2/2 | 198.8 |
| terra-medium | gateway | baseline | 2/2 | 2/2 | execution: 10/10 | 0/2 | 119.8 |
| terra-medium | gateway | candidate | 2/2 | 2/2 | execution: 10/10 | 0/2 | 112.9 |
| terra-medium | rendering | baseline | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 0/2 | 167.3 |
| terra-medium | rendering | candidate | 2/2 | 2/2 | artifact: 18/18; decision: 40/40 | 0/2 | 150.8 |

- Screen uses exactly the first two frozen samples per policy arm. Later Sol-medium samples are excluded from this equal-size screen.
- Execution/artifact/decision rubric scores are separate from manual fidelity and native certification. Uncertified transport is not labelled a functional reasoning failure.
- Opus delivered older operator guidance; provider base instructions, native transport, timeout and path reminders differ. GPT matrix combinations share current guidance and protocol.
- Elapsed time includes tool and queue overhead in the shared environment. Opus elapsed time is unavailable in the common format. No provider cost or statistical equivalence claim.
- No finalist is selected by this progress script. Manual review and the preregistered critical-failure ranking remain required.
