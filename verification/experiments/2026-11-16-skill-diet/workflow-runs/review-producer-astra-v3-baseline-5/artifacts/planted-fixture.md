signal: pass

## Findings

None. The unguarded access is the deliberately invalid scanner input required by the spec, stored as text and never executed. Supplied scanner verification covers its expected diagnostic and the caller reports passing tests. The change stays within scope, with no fixture-shape defect or persistent effect identified.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```