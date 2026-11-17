## PRD readiness: vague-tight

- Stop conditions: present but not checkable. "Users will be satisfied" and "the system should be stable" give no threshold a machine can test.
- Creative licence: tight. The PRD sets PostgreSQL full-text search and POST /search. Tight licence does not affect this gate.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```