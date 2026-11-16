## PRD readiness

- Stop conditions: one of two criteria is checkable. An expired token submitted to the login endpoint must return HTTP 401. "Users should love it" is vague. One verifiable condition meets the minimum.
- Creative licence: broad. The PRD names no technology, API shape or data model beyond a login endpoint.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```