# External-verification report

Copy this template into a real case at `verification/external-verification/results/<case>/report.md` and fill every section. Replace every `{{PLACEHOLDER}}` token; a published report has none left. The companion `report.json` carries the machine-checked fields and must agree with this document on the hypothesis, the main result and the evidence links. The section names below are stable and are asserted by the protocol test.

## Experiment

- Identity: {{EXPERIMENT_ID}}
- Synthetic: {{true or false — true only for a fixture, never for a real case}}
- Title: {{SHORT_TITLE}}
- Registered at: {{ISO_8601_TIMESTAMP}}
- Completed at: {{ISO_8601_TIMESTAMP}}
- Published at: {{ISO_8601_TIMESTAMP}}
- Publication: revision {{N}}, `reports/{{NNNN}}.json`, status {{original or correction}}

## Hypothesis

{{HYPOTHESIS — one falsifiable sentence, frozen at registration}}

- Unit of claim: {{what a single run supports}}
- Decision rule: {{how criterion outcomes combine into the main result, and which criteria are judgement-dependent}}
- Planned variations: {{the axes registered for any generalisation claim, or "none"}}

### Success criteria

| ID | Statement | Judgement-dependent |
|---|---|---|
| SC-1 | {{statement}} | {{yes or no}} |

## Environment

- Runner class: {{class}}
- Trigger: {{what started the run}}
- Runtime versions: {{name and version per runtime}}
- Configuration (non-secret allowlist): {{name and value per entry}}
- Secrets present (name only, never a value): {{name per entry}}

## Immutable revisions

- Subject repository: {{repo}} at {{40-hex commit}}
- SuperDomestique repository: {{repo}} at {{40-hex commit}}
- Harness: {{identity}} version {{version}}
- Model: provider {{provider}}, serving model id {{id, or "not exposed"}}
- Protocol: v0.1 at `{{repo-relative path}}`, SHA-256 {{hex}}

## Inputs

| Role | Path or URL | Media type | SHA-256 |
|---|---|---|---|
| {{role}} | {{repo-relative path or recorded URL}} | {{media type}} | {{hex, or "none — reason"}} |

## Procedure

1. {{first command or step}}
2. {{next step}}

## Objective checks

| ID | Oracle | Expected | Observed | Verdict | Evidence |
|---|---|---|---|---|---|
| OC-1 | {{oracle}} | {{expected}} | {{observed}} | {{pass, fail or not-run}} | {{evidence path or URL}} |

## Subjective judgements

Optional. Include only judgements the frozen decision rule predeclared as judgement-dependent.

| ID | Dimension | Assessor | Assessor type | Blinding | Rating | Criterion outcome | Rationale |
|---|---|---|---|---|---|---|---|
| SJ-1 | {{dimension}} | {{assessor}} | {{type}} | {{blinding}} | {{rating}} | {{pass, fail or unresolved}} | {{rationale}} |

## Observations

- {{what was observed during execution}}

## Outputs

| Role | Path or URL | Media type | SHA-256 |
|---|---|---|---|
| {{role}} | {{repo-relative path or recorded URL}} | {{media type}} | {{hex}} |

## Deviations

- {{any post-registration change to environment, input, procedure, oracle or decision rule, or "none"}}

## Redactions

- {{anything withheld and why, or "none"}}

## Criterion outcomes

| Criterion | Outcome | Deciding record | Unresolved reason |
|---|---|---|---|
| SC-1 | {{pass, fail or unresolved}} | {{OC-… or SJ-…}} | {{reason if unresolved, else blank}} |

## Result

Main result: {{supports-hypothesis, does-not-support, inconclusive or protocol-failure}}

- Evidence complete: {{true or false}}

## First failure

{{The earliest stage that could not meet its required condition, required for protocol-failure; otherwise "none".}}

## Claim assessments

### Reproducibility

- Result: {{supported, not-supported, inconclusive or not-evaluated}}
- Independent operator: {{true or false}}
- Rationale: {{rationale}}

### Repeatability

- Result: {{supported, not-supported, inconclusive or not-evaluated}}
- Executions: {{integer, at least 2 for supported}}
- Tolerance: {{predeclared tolerance}}
- Rationale: {{rationale}}

### Generalisation

- Result: {{supported, not-supported, inconclusive or not-evaluated}}
- Axes: {{predeclared varied axes}}
- Population: {{stated population}}
- Aggregation: {{aggregation rule}}
- Rationale: {{rationale}}

## Limitations

- {{what this result does not claim; at least one entry}}
