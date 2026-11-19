# Assemble run-end reconciliation from recorded and live evidence

Run-end reconciliation and the summary now share their local evidence builder. Beep-boop keeps the live tracker reads and supplies terminal states by issue ID in the reporting facts file. The factory command reads the ledger, checks forge or local Git evidence, and calls the existing pure reconciliation gate. It emits the result without exposing the assembled evidence to the caller.

The gate accepts a readable empty sibling baseline, but rejects an unproven check. Invalid or duplicate baseline entries and missing end-state reads for non-admitted siblings leave the attestation absent. The recorded PR must match a live lookup at the repository root, and two shipped rows cannot share proof from one PR. Git-only merge evidence comes from the same local base resolver used by merge-gate. Supersession must be bound to every named delivering issue, rather than a single success bit for the superseded issue.

The summary reports the same proof gaps with the new facts. Standalone callers without the new map keep the previous advisory behavior and facts format. The existing pure `faff reconcile` remains available for callers with a complete input.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Runs immediately after step 11's runcheck` | The skill still runs the gate after ledger completeness and before reporting | test/run-reconcile-input.test.mjs | changed: shortened the caller's gate sequencing instructions |
| `For every ledger outcome == "shipped"` | The local builder reads merge records and compares the live PR head to the recorded head | test/run-reconcile-input.test.mjs | kept |
| `Git-only mode (no pushable remote; merge-record.json.pr is 0` | Local base ancestry proves merge, and unresolved evidence produces a divergence | test/run-reconcile-input.test.mjs | kept |
| `stdin = the assembled ReconcileInput` | The factory command passes evidence to the same pure core in process | test/run-reconcile-input.test.mjs | changed: pass the facts path and emit only reconciliation results |
| `"superseded_delivered": {ID: bool}` | The gate consumes terminal facts keyed by each actual delivering issue | test/run-reconcile-input.test.mjs | changed: bind delivery proof to the recorded deliverers and support the old summary-only form |
