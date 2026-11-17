PRD readiness: the Done section has one vague criterion (users should love it) and one concrete Given/When/Then scenario (an expired token submitted to the login endpoint returns HTTP 401). One machine-checkable condition meets the minimum, so stop conditions are verifiable. No technology or data model is prescribed, so creative licence is broad.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "broad" }
```