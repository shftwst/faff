# Keep the operator's control rules in one place

Shorten the methodology reference while preserving scope, tracker freshness, human priority bands, confirmation, appetite floors and the admitted-root exception. Slot selection remains whole-bundle. Existing markers distinguish pipeline-authored structure from human curation.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `the interface a human uses` | Treat priorities, sequence, groupings, release plan, dependencies and state as authoritative. | test/appetite-resolution.test.mjs | kept |
| `The tracker is the control plane` | Consult live human tracker structure at each decision. | test/control-parity-tracker.test.mjs | kept |
| `Human edits are re-read every pass` | Incorporate fresh edits before acting at each named gate. | test/control-parity-tracker.test.mjs | kept |
| `Never silently restructure` | Confirm topology changes. Honor human ordering, the admitted-root boundary and delete floor. | test/appetite-resolution.test.mjs | kept |
| `Higher appetite does not loosen this` | Keep explicit human requirements at full appetite. | test/appetite-resolution.test.mjs | kept |
| `Methodology opinions are whole-slot` | Choose the whole bundle, thematic default or custom slot through its recipe. | test/validate-adapters.test.mjs | kept |
| `how "human-curated" is detected` | Recognize existing provenance and limit tidy to housekeeping. | test/control-parity-tracker.test.mjs | kept |
