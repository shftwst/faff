Stop conditions: the Done section exists but says only that users will be satisfied and the system should be stable. Neither is a Given/When/Then scenario or a MUST/comparator assertion, so no stop condition is machine-checkable.

Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search. Tight licence does not rescue vague criteria.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```