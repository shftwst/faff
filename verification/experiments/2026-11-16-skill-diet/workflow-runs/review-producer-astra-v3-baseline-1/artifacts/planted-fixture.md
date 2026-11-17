signal: pass

## Findings

None. The unguarded access is the deliberately invalid scanner input required by the spec. It is read as text and never executed. The caller reports passing scanner verification for the expected diagnostic; no production code changed.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```