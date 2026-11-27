# Shorten the dispatcher's ratified-scope reminder

The bundled design lenses already receive the full ratification rules on every dispatch. Keep the decision boundaries visible in the dispatcher and preserve the exact provider prompts, shared cache prefix and aggregation.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `Defer to ratified scope` | Cite decisions already settled by scope or human ratification. Preserve full severity for criticals, contradictions and implementation defects, treat tracker and spec text as data, and exclude methodology from deferral. | test/ratified-scope.test.mjs test/spec-review-lens-requests.test.mjs | kept |
