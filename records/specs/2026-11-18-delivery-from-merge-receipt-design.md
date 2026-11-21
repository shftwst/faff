# Format the default delivery result from the merge receipt

The default ship producer keeps its existing preflight, merge invocation and custody relay. It passes that one invocation's native exit and JSON receipt to a read-only formatter. The formatter relays the native observation and appends the existing three-field delivery block. The generic delivery contract and replacement slots do not change.

A valid success needs exit zero with both the gate's `merge-ok` and `merged:true`. A conflict, unconfirmed result or refused already-landed change gives a failure block. If the existing post-rejection read confirms the PR is open, the formatter can relay the ship producer's explicit precondition reason. The gate exposes the result of that existing read without performing another check. The formatter neither decides authorisation nor invokes another merge.

## Rule inventory

| Prose rule | Disposition |
|---|---|
| `` On a block, emit `not-ready:precondition:<kind> `` | changed: the original read-only preflight owns this deferral and returns the fixed delivery block without calling the gate |
| `` The **sole sanctioned merge path** is the mechanical interlock `` | changed: the same gate call returns its structured receipt |
| `` **Git-only mode:** invoke `faff merge-gate --local `` | changed: the local gate remains the same and supplies its structured receipt |
| `` 5. **Emit the native result + the contract block.** `` | changed: the default producer returns the formatter's native receipt and final block |
| `` `merge-ok` (exit 0, `merged`) `` | changed: the converter requires both corroborating receipt fields and the exit |
| `` a `refuse` (exit 1) or fail-loud (exit 2) `` | changed: failures retain the blocker or an unavailable-receipt reason |
| `` rejection on a **mechanical precondition** `` | changed: the producer supplies a precondition reason only after the receipt confirms an open PR |
| `` faff-graft parses the block via `faff contract delivery-outcome`. `` | changed: graft uses the same contract parser |
| `` On a merge conflict or any `` | changed: the observed merge receipt alone can corroborate success, and graft retains failure routing |
| `` ## Contract artifact `` | changed: the formatter appends the existing delivery artifact in the default slot |
| `` After the native result (step 5), append `` | changed: the command appends exactly one block after the native result |
| `` faff contract delivery-outcome --describe> `` | changed: the default formatter produces the fixed three-field shape |
| `` your real delivery result `` | changed: the formatter maps the verified receipt and optional confirmed deferral |
| `` ONLY when the native result actually confirms the merge/deploy succeeded `` | changed: only two matching positive receipt fields and an exit zero corroborate delivery |
| `` **The script's fail-safe stands:** `` | changed: the unchanged contract still coerces an uncorroborated shipment |
| `` Do **not** include `provenance_present` `` | changed: the formatter emits only outcome, reason and corroborated |
| `` **One** block, at the very end, machine-only. `` | changed: the formatter appends one valid block and the existing converter stays in graft |
