# Identify the owning build wave from its Agent launch

Retain the wave ordinal supplied to a build dispatch on its actual tool invocation. Nested requests inherit that owning wave through their launch chain. Older dispatches retain their existing attribution.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Pass one ordered unit to dispatch prepare-build as JSON on stdin` | Kept. The same ordered input, ratings, worker clauses, effort log and execution parameters apply. Prepended metadata is unnecessary for existing callers. New callers append the CLI tag to the existing Agent description. |
