# Load the tracker reference when onboarding reaches detection

Standard onboarding can stop on an existing configuration. A legacy configuration error also stops the flow before discovery. Both paths use the kernel for the shared rules. Step 2 is the first consumer of the tracker reference, including for a local overlay or an explicit run from a decline stub.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `Then Read faff/references/tracker.md for the Spec docs location` | changed: read the reference on entry to detection after the configuration check |
| `Infer values for human confirmation in this skill` | changed: bring the reference into context before the skill starts discovery |
