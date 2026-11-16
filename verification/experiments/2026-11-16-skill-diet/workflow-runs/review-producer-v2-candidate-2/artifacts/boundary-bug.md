signal: fail

## Findings

### spec-fidelity: belowLimit accepts equality

src/function.mjs:1 uses `value <= limit`, so `belowLimit(5, 5)` returns true. The spec chooses strict `value < limit` and the AC says equality is rejected. Fix: change the comparison to `value < limit`.

### ac-coverage: no test for the equality boundary

test/function.test.mjs checks only 4 < 5 and 6 > 5; nothing exercises the equality case the AC names, which is why the boundary defect passed. Fix: add `assert.equal(belowLimit(5, 5), false);`.

```faff-contract:review-verdict
{"signal": "fail", "findings": [{"title": "belowLimit accepts equality", "location": "src/function.mjs:1", "action": "Change the comparison from value <= limit to value < limit.", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}, {"title": "Missing equality boundary test for belowLimit", "location": "test/function.test.mjs", "action": "Add assert.equal(belowLimit(5, 5), false).", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}]}
```