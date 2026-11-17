PRD readiness: the Done section is a single MUST/comparator assertion (GET /health MUST return HTTP 200 in under 100 ms for each of 100 consecutive local requests), which is machine-checkable. The PRD prescribes Node 22, PostgreSQL and the GET /health route, so creative licence is tight. Creative licence does not affect the verdict.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```