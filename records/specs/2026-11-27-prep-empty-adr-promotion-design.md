# Skip the ADR mode lookup when no decision can be promoted

Use the just-attached spec already in context. An empty Chosen set makes the remaining promotion rules inapplicable at every mode and appetite. Preserve the config lookup when a decision is present, interactive human confirmation and autonomous limits. The feature branch remains the only place ADR files are written.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `After attach, run this non-blocking tail step` | Run after attachment and defer repository writes to graft. | test/adr-extract-intent.test.mjs | kept |
| `faff config get adr.mode` | Resolve mode whenever a candidate is possible, including the off/default outcomes. | test/adr-promotion-source.test.mjs | kept |
| `surface only decisions the spec already frames as significant` | Only existing cross-slice durable choices qualify. | test/adr.test.mjs | kept |
| `list the candidates (one line each)` | Interactive surface lists and offer confirms each choice. | test/adr.test.mjs | kept |
| `record every significant candidate` | Keep the policy distinction between low/medium and high/full. | test/appetite-resolution.test.mjs | kept |
| `the confirmed promotions as a tracker comment` | Pass the title and source section to graft on the tracker. | test/adr-extract-intent.test.mjs | kept |
| `write deferred to graft` | Preserve the separate admission policy and deferred feature-branch materialization. | test/adr-promotion-source.test.mjs | kept |
