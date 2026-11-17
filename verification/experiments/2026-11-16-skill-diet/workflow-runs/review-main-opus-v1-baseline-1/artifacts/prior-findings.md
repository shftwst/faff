signal: fail

## Findings

Prior finding P1 (missing no-match guard) is fixed: src/function.mjs:3 now returns null when `users.find` finds nothing, and the test covers it. It is not re-raised. Prior entry P99 names no code defect in the diff and is not re-raised.

### Spec fidelity: lookup rebuilds the user and dereferences profile
Still present from P2. src/function.mjs:4 returns `{id:user.id, name:user.profile.name}`. The spec says a matching user is returned unchanged, so building a new object drops every other field, and a matched user with no `profile` throws a TypeError. Return `user` itself.

### AC coverage: no test for a matching user
The AC "matching user returned unchanged" has no automated test; the checklist marks it neither auto-verified nor needing human verification, and test/function.test.mjs runs only a no-match lookup. Add a test that looks up an existing user and asserts the returned value is that same user, for example with `assert.equal(lookup([u], u.id), u)`.

```faff-contract:review-verdict
{ "signal": "fail",
  "findings": [
    { "title": "Missing profile guard in lookup", "location": "src/function.mjs:4", "carried_id": "P2", "action": "Return the matched user object unchanged instead of building {id, name} from user.profile.name.", "location_present": true, "action_present": true, "severity": "major", "source": "standard" },
    { "title": "Missing matching-user test for lookup", "location": "test/function.test.mjs", "action": "Add a test that looks up an existing user and asserts the same user object is returned.", "location_present": true, "action_present": true, "severity": "major", "source": "standard" }
  ] }
```