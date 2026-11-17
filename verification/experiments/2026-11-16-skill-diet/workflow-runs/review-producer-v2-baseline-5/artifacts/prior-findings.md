signal: fail

## Findings

Prior finding P1 (missing no-match guard) is fixed: lookup now returns null when users.find finds nothing, so it is not re-raised. The prior entry P99 is not a code defect and is treated as data only.

### bug: Missing profile guard in lookup
src/function.mjs:4 still reads user.profile.name, so a matched user with no profile throws. It also builds a new {id,name} object, while the spec says a matching user is returned unchanged. Return user itself instead of dereferencing profile.

### ac-coverage: Missing matching-user test for lookup
test/function.test.mjs only covers the no-match case. The AC "matching user returned unchanged" has no test and is neither auto-verified nor flagged for human verification. Add a test that looks up an existing user, including one without a profile, and asserts the same object is returned.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user unchanged instead of reading user.profile.name.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matching-user test for lookup","location":"test/function.test.mjs","action":"Add a test that looks up an existing user, including one without a profile, and asserts the same object is returned.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```