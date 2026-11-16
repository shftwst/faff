The Done section mixes one vague criterion ("users should love it") with one Given/When/Then scenario a machine can check: an expired token submitted to the login endpoint returns HTTP 401. One verifiable stop condition meets the minimum. The PRD names a login endpoint but prescribes no technology, API shape or data model, so creative licence is broad.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```