## PRD readiness

- Stop conditions: two. "Users should love it" is vague. The expired-token scenario (login endpoint returns HTTP 401) is a machine-checkable Given/When/Then. One verifiable condition meets the minimum.
- Creative licence: broad. No technology, API shape or data model is prescribed.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```