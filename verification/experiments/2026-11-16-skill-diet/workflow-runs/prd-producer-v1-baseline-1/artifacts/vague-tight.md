PRD readiness: the Done section says users will be satisfied and the system should be stable. Neither is a Given/When/Then scenario or a MUST/comparator assertion, so no stop condition is machine-checkable. The PRD prescribes PostgreSQL full-text search through POST /search, so creative licence is tight; that does not rescue the vague criteria.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```