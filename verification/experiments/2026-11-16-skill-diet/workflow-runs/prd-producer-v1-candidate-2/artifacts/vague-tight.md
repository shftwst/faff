## PRD readiness: vague-tight

Stop conditions: present but not checkable. "Users will be satisfied" and "the system should be stable" name no observable result, threshold or test.

Creative licence: tight. The PRD prescribes PostgreSQL full-text search and POST /search. Tight licence does not make vague criteria verifiable.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```