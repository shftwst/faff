## PRD readiness: mixed

- Stop conditions: two criteria. "Users should love it" is vague. The expired-token scenario (submitted to the login endpoint, returns HTTP 401) is a Given/When/Then that a machine can check. One verifiable condition meets the minimum.
- Creative licence: broad. No technology, API shape or data model is prescribed.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```
