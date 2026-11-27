# Give bounded spec review time to report its own decision

Use the supported ten-minute foreground Bash timeout for both bundled dispatch entry points. This leaves room for the default five-minute CLI review budget and evidence recording. The configured CLI deadline, lease renewal, retry and hold semantics remain authoritative. A host interruption does not produce a verdict.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `use the current prep mode` | Keep mode, owned run, recording and stage checks while setting the foreground tool timeout. | test/impure/spec-review-dispatch.test.mjs | kept |
| `A healthy review can outlast the prep turn` | Respect the configured budget, allow one bounded retry then hand back without a verdict. | test/impure/spec-review-dispatch.test.mjs | kept |
| `Each refuter pass is made` | Reuse the same review transport, provider config and failure semantics. | test/spec-review-dispatch-resolution.test.mjs | kept |
| `with the complete selection` | Preserve selected lenses, ordered context, parent heartbeat and bounded fresh or retry dispatch. | test/impure/spec-review-dispatch.test.mjs | kept |
