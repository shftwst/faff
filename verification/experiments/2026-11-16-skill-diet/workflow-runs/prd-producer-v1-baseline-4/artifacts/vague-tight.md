## PRD readiness: vague-tight

- Stop conditions: present but not checkable by a machine. "Users will be satisfied" and "the system should be stable" are loose prose, neither a Given/When/Then scenario nor a comparator assertion.
- Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search. The tight licence does not affect the verdict.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```
