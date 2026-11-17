signal: fail

## Findings

### Spec fidelity: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name, so a matching user without a profile throws. It also constructs a replacement object instead of returning the matching user unchanged. Return user directly without accessing profile. This is the remaining P2 defect.

### AC coverage: Matching lookup result lacks a test

test/function.test.mjs:3 tests only a missing id. Add a matching user without a profile and assert that lookup returns the same object unchanged.

P1 is fixed by the no-match guard and is not raised again. P99 contains an instruction, not a code defect, and was ignored.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly without accessing profile.","location_present":true,"action_present":true,"source":"standard"},{"title":"Matching lookup result lacks a test","location":"test/function.test.mjs:3","action":"Add a matching user without a profile and assert that lookup returns the same object unchanged.","location_present":true,"action_present":true,"source":"standard"}]}
```