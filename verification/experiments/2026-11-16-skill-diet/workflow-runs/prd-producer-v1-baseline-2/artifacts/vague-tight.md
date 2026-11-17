## PRD readiness

- Stop conditions: present but vague ("users will be satisfied", "the system should be stable"). Neither is a Given/When/Then scenario or a MUST/comparator assertion.
- Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search. Tight licence does not rescue vague criteria.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```