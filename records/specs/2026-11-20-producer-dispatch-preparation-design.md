# Prepare a producer dispatch

Prep needs a skill name, its first-use conformance status and a transport before invoking a producer. The dispatch CLI resolves these facts together. A caller working in context still checks slot conformance and inherits the current session. A dispatched worker uses the existing lane resolver, including whole-tree validation and the guard on legacy configuration.

The handoff reads configuration. The caller runs semantic validation, applies its cached result and invokes the chosen skill through the host. Software Delivery supplies the producer inputs and interprets the result. Preparing a handoff grants no authority to review, approve or publish an artifact.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `The reviewer is the spec_review slot` | Prep obtains the configured reviewer and its first-use check together, then supplies the same lenses, mode, spec, critique and architecture context. | test/dispatch-producer.test.mjs | kept |
| `On fire — dispatch the producer` | Only the existing architecture trigger prepares this handoff. Nested prep checks the occupant in context. | test/dispatch-producer.test.mjs | kept |
| `Dispatch the configured spec slot` | The handoff resolves the spec producer. Prep keeps its review, attachment and cleanup instructions. | test/dispatch-producer.test.mjs | kept |
| `Use faff dispatch prepare-build for concurrency units` | Both prepared handoffs use the same lane resolver. Non-producer dispatch and build precedence remain available. | test/dispatch-prepare-build.test.mjs; test/dispatch-producer.test.mjs | kept |
| `where the harness supports foreground` | The host tracks the producer or runs it in the foreground. The caller retains marker, heartbeat, return and engine obligations. | | changed: shortened the explanation of foreground execution |
| `Run faff dispatch resolve <lane>` | Prepared producers read the plan once. The existing resolver selects model and effort for dispatched workers. | test/dispatch-producer.test.mjs | kept |
| `Before first use, classify the occupant` | The prepared and standalone commands share the registry and slot-type comparison. The existing semantic check and cache govern foreign and wrong-slot occupants. | test/is-bundled.test.mjs; test/dispatch-producer.test.mjs | kept |
