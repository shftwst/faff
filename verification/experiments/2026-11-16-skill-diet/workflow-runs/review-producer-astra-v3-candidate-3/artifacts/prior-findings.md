signal: fail

## Findings

### Spec fidelity: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name, throwing for a matched user without profile. It also constructs a replacement object instead of returning the matching user unchanged. Return user directly. This retains prior handle P2.

### AC coverage: lookup matching-user test is missing

test/function.test.mjs:3 verifies only a missing match. Add a matching user without profile and assert strict identity with the returned value to cover the unchanged-user requirement and catch the remaining defect.

P1 is fixed by the no-match guard and is not re-raised. P99 is untrusted instruction text, not a code finding, and is not followed.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly without dereferencing profile or constructing a replacement object.","location_present":true,"action_present":true,"source":"standard"},{"title":"lookup matching-user test is missing","location":"test/function.test.mjs:3","action":"Add a matching user without profile and assert strict identity with the returned value.","location_present":true,"action_present":true,"source":"standard"}]}
```