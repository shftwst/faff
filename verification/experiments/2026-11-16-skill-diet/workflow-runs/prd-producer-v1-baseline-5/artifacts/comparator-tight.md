Stop conditions: the Done section has one MUST/comparator assertion (GET /health MUST return HTTP 200 in under 100 ms for each of 100 consecutive local requests). That is machine-checkable.

Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route. Licence does not affect the verdict.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```