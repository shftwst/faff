## PRD readiness: mixed

- Stop conditions: one of two is checkable. "Users should love it" is vague. The expired-token scenario (the login endpoint returns HTTP 401) is a concrete Given/When/Then. One verifiable condition meets the minimum.
- Creative licence: broad. The PRD sets no technology, API shape or data model beyond naming a login endpoint.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```