## PRD readiness

- Stop conditions: one MUST assertion with a comparator. GET /health must return HTTP 200 in under 100 ms for each of 100 consecutive local requests. A machine can check this.
- Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```