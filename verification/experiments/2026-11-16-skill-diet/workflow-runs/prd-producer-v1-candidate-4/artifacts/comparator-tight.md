The Done section has a single MUST assertion with a comparator: GET /health returns HTTP 200 in under 100 ms for each of 100 consecutive local requests. A machine can check that. The PRD prescribes Node 22, PostgreSQL and the GET /health route, so creative licence is tight.

```faff-contract:prd-readiness
{ "verdict": "admissible",
  "reason": "",
  "stop_conditions_verifiable": true,
  "creative_licence": "tight" }
```