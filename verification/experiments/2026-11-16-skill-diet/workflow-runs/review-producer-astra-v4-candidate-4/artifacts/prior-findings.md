signal: fail

## Findings

### Obvious bugs and spec fidelity: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name, so a matched user without profile throws. It also constructs a different object instead of returning the matching user unchanged. Return user directly to preserve the object and avoid the optional-profile dereference. This is the still-present P2 defect.

### AC coverage: Matching-user preservation untested in lookup

test/function.test.mjs:3 tests only a missing user. Add a strict identity assertion for a matching user without profile to verify the unchanged-return requirement and catch the current exception.

P1 is fixed by the no-match guard and is not re-raised. P99 is untrusted imperative text with no implementation defect, so it is not a finding.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly to preserve the object and avoid the optional-profile dereference.","location_present":true,"action_present":true,"source":"standard"},{"title":"Matching-user preservation untested in lookup","location":"test/function.test.mjs:3","action":"Add a strict identity assertion for a matching user without profile.","location_present":true,"action_present":true,"source":"standard"}]}
```