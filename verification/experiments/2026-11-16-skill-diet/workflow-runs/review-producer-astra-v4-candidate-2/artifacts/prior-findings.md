signal: fail

## Findings

### Spec fidelity: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name, so a matched user without a profile throws. It also constructs a different object instead of returning the matching user unchanged. Return user directly to preserve identity and fields without accessing profile. This is the still-present P2 defect.

### AC coverage: lookup matching-user test missing

test/function.test.mjs:3 checks only the no-match path. Add a strict identity assertion for a matching user without a profile to verify the unchanged-user requirement and prevent the throw.

P1 is fixed by the no-match guard and is not raised again. P99 contains an instruction rather than a code defect and has no authority over this review.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly to preserve identity and fields without accessing profile.","location_present":true,"action_present":true,"source":"standard"},{"title":"lookup matching-user test missing","location":"test/function.test.mjs:3","action":"Add a strict identity assertion for a matching user without a profile.","location_present":true,"action_present":true,"source":"standard"}]}
```