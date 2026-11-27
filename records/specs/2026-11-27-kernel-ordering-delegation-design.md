# Keep ordering judgement with the methodology slot

State the shared ownership rule once and map each judgement to its named output. The default slot still supplies inherited priority and workstream weighting. Graph counts are facts any caller can report.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `The orchestration layer owns no rule or opinion` | Delegate priority, risk and ordering to the configured slot. | test/validate-adapters-authoring.test.mjs | kept |
| `Named output per context` | Map each judgement to its named slot output. | test/validate-adapters-authoring.test.mjs | kept |
| `what order to take these issues` | pick-ordering includes on-hold and independent issues. | test/build-queue-partition.test.mjs | kept |
| `sizing / right-sizing` | Keep build-queue, ticket-shaping, issue-critique and crank-up-set. | test/build-queue-partition.test.mjs | kept |
| `The slot always resolves` | Default thematic ordering owns inherited priority, chainable unlock and workstream weighting. | test/build-queue-partition.test.mjs | kept |
| `Objective graph facts` | Orchestrators may count graph facts. Methodology decides their effect on ordering. | test/build-queue-partition.test.mjs | kept |
| `Dependency-direction note` | Value and risk inform priority and can be assessed before priority exists. | test/validate-adapters-authoring.test.mjs | kept |
