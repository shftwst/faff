The Done section exists, but its criteria ("users will be satisfied", "the system should be stable") cannot be checked by a machine as written. The PRD prescribes PostgreSQL full-text search behind POST /search, so creative licence is tight. Tight licence is carried forward for the downstream reviewer and does not change this gate.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```