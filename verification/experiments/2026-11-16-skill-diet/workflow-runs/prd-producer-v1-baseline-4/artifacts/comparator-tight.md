## PRD readiness: comparator-tight

- Stop conditions: one MUST/comparator assertion (GET /health returns HTTP 200 in under 100 ms for each of 100 consecutive local requests). This can be checked by a machine.
- Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```
