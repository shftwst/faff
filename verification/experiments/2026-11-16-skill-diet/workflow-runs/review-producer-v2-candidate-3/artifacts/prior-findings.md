signal: fail

## Findings

Prior P1 (no-match guard) is fixed: line 3 returns null when no user matches. The prior block's P99 entry is not a code defect and is not raised.

### bug: Missing profile guard in lookup

Still present from prior P2. src/function.mjs:4 reads `user.profile.name`, so a matched user without `profile` throws. It also builds a new `{id, name}` object, while the spec says a matching user is returned unchanged. Fix: return `user` itself instead of dereferencing `profile`.

### ac-coverage: Missing matching-user test for lookup

The AC "matching user returned unchanged" is testable but test/function.test.mjs only checks a no-match lookup, and the checklist marks it neither auto-verified nor flagged for a human. Fix: add a test that looks up a present user (including one without `profile`) and asserts the same object is returned.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user unchanged instead of dereferencing user.profile.name.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"},{"title":"Missing matching-user test for lookup","location":"test/function.test.mjs","action":"Add a test that looks up a present user, including one without profile, and asserts the same object is returned.","location_present":true,"action_present":true,"severity":"major","disposition":"open","source":"standard"}]}
```