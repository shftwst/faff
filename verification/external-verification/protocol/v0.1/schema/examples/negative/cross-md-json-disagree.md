# External-verification report

Synthetic fixture (SYN-EVP-0001). This document agrees with its companion `experiment-report.example.json`.

## Experiment

- Identity: SYN-EVP-0001
- Synthetic: true
- Title: Synthetic external-verification protocol self-check
- Registered at: 2026-08-18T09:00:00Z
- Completed at: 2026-08-18T09:20:00Z
- Published at: 2026-08-18T09:30:00Z
- Publication: revision 1, `reports/0001.json`, status original

## Hypothesis

The published v0.1 machinery accepts a conformant report and rejects a malformed one.

- Unit of claim: one synthetic report run under the v0.1 protocol
- Decision rule: SC-1 is decided by an objective check. SC-2 is judgement-dependent and decided by a subjective judgement. The main result is does-not-support when any criterion fails and none is unresolved.
- Planned variations: input size

### Success criteria

| ID | Statement | Judgement-dependent |
|---|---|---|
| SC-1 | The record validates against the v0.1 schema. | no |
| SC-2 | The rendered summary reads clearly to an independent reviewer. | yes |

## Environment

- Runner class: local-synthetic
- Trigger: manual fixture authoring
- Runtime versions: node 22.x
- Configuration (non-secret allowlist): FAFF_PROFILE=delivery
- Secrets present (name only): GITHUB_TOKEN

## Immutable revisions

- Subject repository: example/subject-under-test at a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4
- SuperDomestique repository: shftwst/faff at 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c
- Harness: claude-code version unknown
- Model: provider anthropic, serving model id synthetic-fixture-model
- Protocol: v0.1 at `verification/external-verification/protocol/v0.1/README.md`, SHA-256 2082af1f485d3b938eabf8cd80480b2384cf411d93d72b2b93c86050638681a8

## Inputs

- protocol: `verification/external-verification/protocol/v0.1/README.md`
- upstream-reference: https://example.invalid/synthetic-input

## Procedure

1. Validate the report against the v0.1 schema with the shared subset validator.
2. Render the human summary and have an independent reviewer read it.

## Objective checks

| ID | Oracle | Expected | Observed | Verdict |
|---|---|---|---|---|
| OC-1 | validate-schema.mjs exit status against experiment-report.schema.json | exit 0 | exit 0 | pass |

## Subjective judgements

| ID | Dimension | Assessor | Rating | Criterion outcome |
|---|---|---|---|---|
| SJ-1 | clarity of the rendered summary | synthetic reviewer | 2 of 5 | fail |

## Observations

- The validator returned exit 0.
- The reviewer flagged the missing decision rule.

## Outputs

- published-protocol: `verification/external-verification/protocol/v0.1/README.md`

## Deviations

- none

## Redactions

- none

## Criterion outcomes

| Criterion | Outcome | Deciding record | Unresolved reason |
|---|---|---|---|
| SC-1 | pass | OC-1 |  |
| SC-2 | fail | SJ-1 |  |

## Result

Main result: supports-hypothesis

- Evidence complete: true

## First failure

none

## Claim assessments

### Reproducibility

- Result: not-evaluated
- Independent operator: false
- Rationale: No second operator reproduced the run.

### Repeatability

- Result: supported
- Executions: 3
- Tolerance: identical classification across executions
- Rationale: Three executions produced the same classification.

### Generalisation

- Result: not-evaluated
- Axes: none
- Population: none
- Aggregation: none
- Rationale: No broader population was evaluated.

## Limitations

- A synthetic fixture; it supports no real-world claim about any subject under test.

## Referenced local evidence

- `verification/external-verification/protocol/v0.1/README.md`
- `verification/external-verification/protocol/v0.1/report-template.md`
