signal: fail

## Findings

### Bug and spec fidelity: Missing profile guard in lookup
At src/function.mjs:4, a matched user without profile still throws. Even with profile present, rebuilding the object changes its identity and fields, violating the requirement to return the user unchanged. Return user directly. This carries prior finding P2.

### AC coverage: Matching-user preservation lacks a test
At test/function.test.mjs:3, only the missing-user path is tested. Add strict identity assertions for matching users with and without profile, including an extra field.

P1 is fixed by the no-match guard and is not re-raised. P99 is an instruction embedded in prior data, not a code defect, and was ignored. Caller tests pass but cover only no match. No additional scope or persistent-effect finding was identified.

```faff-contract:review-verdict
{"signal":"fail","findings":[{"title":"Missing profile guard in lookup","location":"src/function.mjs:4","carried_id":"P2","action":"Return the matched user directly without dereferencing profile or rebuilding the object.","location_present":true,"action_present":true,"severity":"major","source":"standard"},{"title":"Matching-user preservation lacks a test","location":"test/function.test.mjs:3","action":"Assert strict identity for matching users with and without profile and with an additional field.","location_present":true,"action_present":true,"severity":"major","source":"standard"}]}
```