signal: fail

## Findings

Prior finding P1 (no-match guard) is fixed by the `if (!user) return null;` line and is not re-raised. The P99 entry is not a code defect and raises nothing.

### obvious-bugs: matched user without a profile still throws

src/function.mjs:4 still reads `user.profile.name`, so a matched user with no `profile` throws a TypeError. Prior finding P2 remains. Fix: return the matched user without dereferencing `profile`.

### spec-fidelity: lookup rebuilds the matched user

src/function.mjs:4 returns a new `{id, name}` object. The spec says a matching user is returned unchanged, which drops every other field. Fix: `return user;`, which also removes the P2 dereference.

### ac-coverage: no test for a matching lookup

test/function.test.mjs covers only the no-match case. The "matching user returned unchanged" AC is testable but has no test and no human-verification flag. Fix: add a test that looks up a present id and asserts the same user object comes back, including a user without `profile`.

```faff-contract:review-verdict
{"signal": "fail", "findings": [{"title": "Unguarded profile dereference in lookup", "location": "src/function.mjs:4", "carried_id": "P2", "action": "Return the matched user without dereferencing profile.", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}, {"title": "lookup rebuilds matched user instead of returning it unchanged", "location": "src/function.mjs:4", "action": "Return the matched user object unchanged.", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}, {"title": "Missing matching-user test for lookup", "location": "test/function.test.mjs", "action": "Add a test asserting a present id returns the same user object, including one without profile.", "location_present": true, "action_present": true, "severity": "major", "disposition": "open", "source": "standard"}]}
```