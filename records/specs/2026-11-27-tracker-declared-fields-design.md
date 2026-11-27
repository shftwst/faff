# Use the discovered connector schema for issue reads

A connector may return an identity field automatically, accept a different field for lookup, or have no projection support. Preserve live status and complete labels for claim decisions. Limit and page list reads according to the caller's needs.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `for one known ID. For lists` | Keep direct known-ID lookup, bounded and paged lists, recent-first ordering and conditional expansions. | test/tracker-probe.test.mjs | kept |
| `Earlier tool responses remain in context` | Preserve isolated reads and return the caller's required values. | test/tracker-probe.test.mjs | kept |
| `the complete human-legible record` | The tracker remains the operator's unattended control plane and uses the existing mechanisms. | test/control-parity-tracker.test.mjs | kept |
