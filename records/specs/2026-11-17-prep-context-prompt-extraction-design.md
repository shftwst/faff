# Prepare local context for each review round

The skill gathers the current issue’s human resolutions from its existing tracker connection. The local command rereads the register, assembles the context, then folds in that array. A genuinely empty result allows review to proceed. Any failed input or fold explicitly stops dispatch for the round. The previous instructions called the fold fail-closed but left the caller’s action implicit.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `at the start of every review round` | changed: run prep-context at the start of each round |
| `# $scratch is the resolved spec-review scratch dir above` | changed: the command resolves scratch and reads the run ledger |
| `append each line of $scratch/ratified-scope.stderr` | changed: the caller logs every warning from the command result |
| `no PRD non-goals, no scoped precedent, no honourable tradeoff` | changed: the command clears stale context on genuine absence |
| `source unreadable — a FAILED read, not an empty one` | changed: the command reports the failed read and the caller stops dispatch |
| `gather human-settled Punt/Assumes resolutions` | changed: the caller gathers before invoking the command |
| `The renderer neutralises every tracker value` | changed: the command uses the existing inert renderer |
| `ratified-scope --fold-resolutions --into` | changed: the command assembles before folding the supplied resolutions |
