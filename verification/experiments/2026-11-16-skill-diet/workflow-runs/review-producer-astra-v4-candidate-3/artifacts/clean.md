signal: pass

## Findings

None. double multiplies finite inputs by 2, with positive, zero and negative cases covered. The supplied tests passed; changes stay within scope and introduce no persistent effects.

```faff-contract:review-verdict
{"signal":"pass","findings":[]}
```