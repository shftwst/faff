# Reuse PRD selection for standalone plot

The PRD command exposes the existing selection rule with `prd select`. The command returns a path for the sole usable candidate, a shortlist for human choice, or an intake fallback with a reason. Selection uses the existing local PRD registry and configured path resolver. A sole record remains eligible regardless of status. When several records exist, retain only Active and Frozen records, including the existing status suffix behavior.

The L4 run trigger still classifies its inherited handoff before any reads, uses its existing list and path children, and maps malformed listings or missing container metadata to ambiguity for its refusal ladder. Both callers use the same filter and resolution result. Plot retains the human choice, standalone intake fallback, and chained brief behavior. Neither the lookup nor its output authorizes writes, determines PRD readiness or grants a creative licence.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Standalone (/faff-plot invoked directly): discover a committed PRD` | The standalone command composes the existing local discovery and selection. | test/run-trigger.test.mjs | kept |
| `Parse the faff prd list --json array; only if it has multiple elements, filter to status Active or Frozen` | Both callers share the existing filter, including the sole-record rule. | test/run-trigger.test.mjs | kept |
| `Exactly one survivor (unambiguous)` | The returned path resolves via the existing path derivation and uses the PRD directly when present. | test/run-trigger.test.mjs | kept |
| `More than one survivor (ambiguous)` | The lookup returns the surviving choices. The human selects one in the existing prompt. | test/run-trigger.test.mjs | kept |
| `Zero (no committed PRD, [], or fallback above)` | No usable local PRD routes to the existing intake fallback. | test/run-trigger.test.mjs | kept |
