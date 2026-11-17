## PRD readiness

- Stop conditions: present but not checkable. "Users will be satisfied" and "the system should be stable" give no machine test. The tight implementation constraints do not make them verifiable.
- Creative licence: tight. The PRD prescribes PostgreSQL full-text search through POST /search.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```