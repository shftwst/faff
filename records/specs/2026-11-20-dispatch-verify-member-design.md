# Verify the dispatch return

Verify the held run manifest before opening member evidence. The dispatcher owns the trusted baseline, the member identity and all writes. The command reports the failing scope so a bad member cannot stop a healthy wave.

On loss of the original manifest, the affected dispatch has no verifiable return. Park it as unavailable. The next dispatch can start a new chain.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `This executor opens **at most one** bracket` | changed: Preserve one held bracket, Sentry and the shared write sequence. |
| `Runs as the **second action of step 3**` | changed: The combined command checks shared custody before the member claim. |
| `On each subagent return` | changed: Preserve run-wide halt before any token handling. |
| `the wave response is` | changed: Only shared custody faults stop new launches. |
| `On **each subagent return within a wave**` | changed: Preserve member-scoped failures and dispatcher-owned writes. |
| `one continuous run-grain chain per orchestrator` | changed: Use the held custody baseline as the first check at return. |
| `the dispatcher pipes the returned line` | changed: Keep the wire shape, fault scopes, verified write ownership, holdout and pre-merge check. |
