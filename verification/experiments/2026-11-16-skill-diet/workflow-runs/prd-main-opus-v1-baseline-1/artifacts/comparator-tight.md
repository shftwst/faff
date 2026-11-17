## PRD readiness

- Stop conditions: one MUST/comparator assertion (GET /health returns HTTP 200 in under 100 ms for each of 100 consecutive local requests). It can be checked by a machine.
- Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route. Licence does not decide the verdict.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```
