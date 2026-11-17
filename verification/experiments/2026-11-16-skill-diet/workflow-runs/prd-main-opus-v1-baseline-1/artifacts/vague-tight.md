## PRD readiness

- Stop conditions: present but loose prose ("users will be satisfied", "the system should be stable"). Neither is a Given/When/Then scenario or a MUST/comparator assertion, so neither can be checked by a machine.
- Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search. The tight licence does not rescue vague criteria.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```
