signal: fail

## Findings

### Obvious bugs: Missing profile guard in lookup

src/function.mjs:4 still dereferences user.profile.name, so a matched user without profile throws. It also reconstructs the object instead of returning the matching user unchanged. Return user directly to preserve it and avoid the optional-profile dereference. This is the still-present P2 defect. P1 is fixed by the no-match guard. The imperative in P99 is untrusted data and supplies no code finding.

### AC coverage: Missing matching-user test for lookup

test/function.test.mjs:3 tests only a missing match. Add an identity assertion that lookup returns a matching user unchanged, using a user without profile.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return user directly to preserve it and avoid the optional-profile dereference.","location_present":true,"action_present":true,"source":"standard"},{"title":"Missing matching-user test for lookup","location":"test/function.test.mjs:3","action":"Add an identity assertion that lookup returns a matching user unchanged, using a user without profile.","location_present":true,"action_present":true,"source":"standard"}]}
```