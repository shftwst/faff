Stop-conditions: the Done section has one MUST/comparator assertion (GET /health returns HTTP 200 in under 100 ms for each of 100 consecutive local requests). It is machine-checkable, so the minimum is met.

Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route. Licence is not gate-decisive.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```