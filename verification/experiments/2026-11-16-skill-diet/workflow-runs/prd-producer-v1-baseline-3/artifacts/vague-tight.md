Stop-conditions: the Done section says users will be satisfied and the system should be stable. Both are loose prose with no scenario or comparator, so none is machine-checkable.

Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search. Tight licence does not rescue vague stop-conditions.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```