## PRD readiness: comparator-tight

Stop conditions: one MUST assertion with comparators (GET /health returns HTTP 200 in under 100 ms for each of 100 consecutive local requests). It is machine-checkable, so the verifiability minimum is met.

Creative licence: tight. The PRD prescribes Node 22, PostgreSQL and the GET /health route. Licence does not decide this gate.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```