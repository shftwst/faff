# GPT finalist progress

Five samples per policy arm. Manual artifact and reason reviews remain separate.

| Model | Task | Policy | Complete | Assessed runs passed | Assessed cases | Native certified | Median seconds |
|---|---|---|---:|---:|---|---:|---:|
| opus-reference | gateway | baseline | 5/5 | 5/5 | execution: 25/25 | 5/5 | unavailable |
| opus-reference | gateway | candidate | 5/5 | 5/5 | execution: 25/25 | 5/5 | unavailable |
| opus-reference | rendering | baseline | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | unavailable |
| opus-reference | rendering | candidate | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | unavailable |
| opus-reference | challenges | baseline | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | unavailable |
| opus-reference | challenges | candidate | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | unavailable |
| sol-medium | gateway | baseline | 5/5 | 5/5 | execution: 25/25 | 5/5 | 144.1 |
| sol-medium | gateway | candidate | 5/5 | 5/5 | execution: 25/25 | 5/5 | 134.5 |
| sol-medium | rendering | baseline | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | 201.0 |
| sol-medium | rendering | candidate | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | 190.2 |
| sol-medium | challenges | baseline | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | 178.5 |
| sol-medium | challenges | candidate | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | 132.0 |
| astra-medium | gateway | baseline | 5/5 | 5/5 | execution: 25/25 | 5/5 | 160.6 |
| astra-medium | gateway | candidate | 5/5 | 5/5 | execution: 25/25 | 5/5 | 146.1 |
| astra-medium | rendering | baseline | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | 228.9 |
| astra-medium | rendering | candidate | 5/5 | 5/5 | artifact: 45/45; decision: 100/100 | 5/5 | 218.2 |
| astra-medium | challenges | baseline | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | 187.5 |
| astra-medium | challenges | candidate | 5/5 | 5/5 | judgement-and-consumption: 40/40 | 5/5 | 143.4 |

- Run-level failures remain visible even when individual cases pass. Native certification is separate from functional scores and manual fidelity.
- Sol-medium gateway/rendering samples3-5 predate selection and were explicitly registered for reuse. Other additions are fresh samples; failed screen samples are never replaced.
- GPT challenge task wording excludes provider independence. It reuses the original policy, case inputs, expected outcomes, CLI runtime and environment/grader. Task/guidance/transport differences prevent pure model-only attribution.
- Native wrapper incompatibilities, missing exit metadata and actual command errors must be distinguished using their separate diagnoses.
- Elapsed time includes queue/tool overhead; four finalist lanes differ from the screen concurrency. No provider billing, statistical equivalence or full production workflow claim.
