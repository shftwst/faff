## PRD readiness: mixed

Stop conditions: two criteria. "Users should love it" is not checkable. The Given/When/Then scenario (an expired token submitted to the login endpoint returns HTTP 401) is machine-checkable. One verifiable condition meets the minimum.

Creative licence: broad. No technology, API shape or data model is prescribed beyond naming a login endpoint.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```