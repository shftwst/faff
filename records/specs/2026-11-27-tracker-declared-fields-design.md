# Use the discovered connector schema for issue reads

A connector may return an identity field automatically, accept a different field for lookup, or have no projection support. Preserve live status and complete labels for claim decisions. Limit and page list reads according to the caller's needs.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `for one known ID. For lists` | Keep direct known-ID lookup, bounded and paged lists, recent-first ordering and conditional expansions. | test/tracker-probe.test.mjs | kept |
| `Earlier tool responses remain in context` | Preserve isolated reads and return the caller's required values. | test/tracker-probe.test.mjs | kept |
| `The harness supplies live connector discovery` | Discover the live connector after resolving the configured tracker. | test/tracker-probe.test.mjs | kept |
| `For PRDs, PRDRs, ADRs and spikes` | Keep the matching config resolver and override for each document type. | test/tracker-probe.test.mjs | kept |
