# Keep the producer and adaptor boundary in one short reference

Preserve the native producer block, direct validation, wrapper and absent-block fallback. Keep routing, rendering, intake, concurrency and methodology roles distinct. The review-comment procedure is untouched.

## Rule inventory

| Prose rule | Retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `producers declare contract data` | The consumer parses the emitted block and calls the shipped validator. | test/validate-adapters.test.mjs | kept |
| `do the work and emit native output` | Replace the producer or wrap a foreign one; keep absent-block fallback. | test/validate-adapters-authoring.test.mjs | kept |
| `translate and validate` | Routing assigns the verdict and rendering formats the result within the contract. | test/validate-adapters.test.mjs | kept |
| `Rule of thumb for a slot swap` | Keep special output contracts for intake, concurrency and methodology. | test/validate-adapters-authoring.test.mjs | kept |
