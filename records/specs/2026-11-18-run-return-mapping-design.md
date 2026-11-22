# Map reconciled graft returns to existing buckets

The concurrency dispatcher classifies an already-reconciled native graft return with `faff run return-map --outcome TOKEN`. The result identifies the existing ledger and issue-outcome bucket and, for a hold, its existing annotation. PR-ready remains a dispatcher handoff. An excluded return has no terminal bucket. An unknown return exits 2 so the caller can reconcile it using the existing ground-truth procedure.

The mapper reads no run, files or tracker facts. Dispatch custody, merge completion, ledger writes and issue-outcome event ownership stay with their current callers. This slice leaves prep returns, decline writes, and endgame-only landing bookkeeping untouched. It does not resolve an already-admitted claim conflict or change event deduplication.

## Measurement

At base `f70d0851`, the graft prompt shrinks from 171,699 to 170,366 bytes and the L4 reference from 25,523 to 25,124 bytes. Together these remove 1,732 bytes and 424 estimated tokens using the repository's characters-divided-by-four estimate. The concurrency contract adds one local call per reconciled graft return.

Fifteen cold Node 22 invocations mapping the review-outage hold measured 40.6 ms median and 44.5 ms p95, including CLI startup. The 77-byte result is about 20 estimated tokens before tool framing. This measures local work and static text, with no provider token or whole-flow cost claim.

Executable tests check all terminal and handoff rows, verify that returned terminal buckets belong to the current issue-outcome vocabulary, reject wrong-phase values, and confirm identical results and unchanged ledger and event files on replay. Existing native return fixtures and writer tests remain unchanged. These checks do not qualify dispatcher delivery, re-entry or event ordering.

## Rule inventory

| Prose rule | Command or retained behaviour | Covering test | Disposition |
|---|---|---|---|
| `These caller-facing returns map onto the run-ledger terminal buckets` | The mapper provides the exact bucket and distinguishes hold annotations, pre-admission and PR-ready. | test/run-return-map.test.mjs | kept |
| `Map /faff-graft's caller-facing returns to buckets:` | The shared concurrency contract calls the mapper after reconciliation and retains existing writers and merge obligation. | test/run-return-map.test.mjs | changed: replace the duplicated lookup with the executable map |
