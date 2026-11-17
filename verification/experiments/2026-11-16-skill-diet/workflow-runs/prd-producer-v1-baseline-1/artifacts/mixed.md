PRD readiness: the Done section has two criteria. "Users should love it" is vague. The expired-token scenario (given an expired token submitted to the login endpoint, the endpoint returns HTTP 401) is a machine-checkable Given/When/Then. One verifiable stop condition meets the minimum. The PRD prescribes no technology or data model, so creative licence is broad.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```