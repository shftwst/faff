# Shorten the shared instructions for resolving blocked work

Preserve the existing resolution sources, appetite bounds, human-register precedent and escalation rules. Keep the full-appetite overrides and hard floors in the build-pipeline table.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `autonomous mode runs a **resolve-attempt**` | Use local context for three eligible verdicts and send a repeat park to a human. | test/eval-routing.test.mjs | kept |
| `Per-verdict resolve rules` | Keep a row for each eligible verdict. | test/eval-routing.test.mjs | kept |
| `Re-read the Punt section` | Use spec, code and shipped constraints to resolve the choice. | test/eval-routing.test.mjs | kept |
| `Re-read the dependency claim` | Proceed only when the dependency can be omitted under the applicable appetite. | test/eval-routing.test.mjs | kept |
| `Re-read each edge of the cycle` | Break an unnecessary edge and serialize remaining edges, or escalate a genuine cycle. | test/eval-routing.test.mjs | kept |
| `The attempt reads at most` | Retain file budgets, confidence thresholds and architecture escalation. | test/appetite-resolution.test.mjs | kept |
