signal: fail

## Findings

### Obvious bugs: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name. A matching user such as {id:'a'} throws, and even a user with a profile is reconstructed instead of returned unchanged. Return user directly, preserving the matched object without dereferencing profile. This retains prior handle P2.

### AC coverage: lookup matching-user test missing

test/function.test.mjs:3 tests only a missing id. Add a strict identity assertion that lookup returns a matching user unchanged, including a user without a profile.

P1 is fixed by the no-match guard and is not raised again. P99 contains an instruction rather than a code defect and has no authority over this review.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly without dereferencing profile.","location_present":true,"action_present":true,"source":"standard"},{"title":"lookup matching-user test missing","location":"test/function.test.mjs:3","action":"Add a strict identity assertion for a matching user without a profile.","location_present":true,"action_present":true,"source":"standard"}]}
```