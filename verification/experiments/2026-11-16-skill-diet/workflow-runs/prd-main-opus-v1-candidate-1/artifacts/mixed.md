## PRD readiness

- Stop conditions: one of the two criteria is checkable. A Given/When/Then scenario says an expired token submitted to the login endpoint returns HTTP 401. "Users should love it" is vague, but one verifiable condition meets the minimum.
- Creative licence: broad. The PRD names no technology or data model. It mentions a login endpoint but does not prescribe its shape.

```faff-contract:prd-readiness
{ "verdict": "admissible", "reason": "", "stop_conditions_verifiable": true, "creative_licence": "broad" }
```