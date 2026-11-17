PRD readiness: the Done section exists but says only that users will be satisfied and the system should be stable. Neither criterion can be checked by a machine, so stop conditions are present but not verifiable. The PRD prescribes PostgreSQL full-text search through POST /search, so creative licence is tight; that does not change the gate.

```faff-contract:prd-readiness
{ "verdict": "not-ready",
  "reason": "ambiguous-stop-conditions",
  "stop_conditions_verifiable": false,
  "creative_licence": "tight" }
```