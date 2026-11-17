## PRD readiness

- Stop conditions: present but not checkable. "Users will be satisfied" and "the system should be stable" name no threshold, scenario or assertion a machine can test.
- Creative licence: tight. The PRD prescribes PostgreSQL full-text search behind POST /search. Licence does not decide this gate.

```faff-contract:prd-readiness
{ "verdict": "not-ready", "reason": "ambiguous-stop-conditions", "stop_conditions_verifiable": false, "creative_licence": "tight" }
```