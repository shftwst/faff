signal: fail

## Findings

### Spec fidelity: belowLimit accepts equality
src/function.mjs:1 implements `value <= limit`, but the spec chooses strict `value < limit` and the AC says equality is rejected. `belowLimit(5, 5)` returns true where it must return false. Change the comparison to `value < limit`.

### AC coverage: no test for the equality case
test/function.test.mjs checks only 4 and 6 against a limit of 5, so the equality AC has no test and the defect above passes the suite. Add `assert.equal(belowLimit(5,5), false);`.

```faff-contract:review-verdict
{ "signal": "fail",
  "findings": [
    { "title": "belowLimit accepts equality", "location": "src/function.mjs:1", "action": "Change the comparison from value <= limit to value < limit.", "location_present": true, "action_present": true, "severity": "major", "source": "standard" },
    { "title": "Missing equality test for belowLimit", "location": "test/function.test.mjs", "action": "Add assert.equal(belowLimit(5,5), false) to cover the equality AC.", "location_present": true, "action_present": true, "severity": "major", "source": "standard" }
  ] }
```