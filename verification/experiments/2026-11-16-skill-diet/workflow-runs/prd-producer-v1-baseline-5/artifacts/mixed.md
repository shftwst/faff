Stop conditions: the Done section has two items. "Users should love it" is vague and not verifiable. The second is a Given/When/Then scenario (an expired token submitted to the login endpoint returns HTTP 401), which is machine-checkable. One verifiable stop condition meets the minimum.

Creative licence: broad. No technology, API shape or data model is prescribed beyond naming the login endpoint.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```