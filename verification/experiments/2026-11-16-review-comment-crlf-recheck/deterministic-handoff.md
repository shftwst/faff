# Proposed deterministic tracker handoff

Status: design for review. The pure planner remains unchanged. No production
connector, write authority or additional model run is introduced by this document.

## Evidence

Both fresh executions of the CRLF case produced a correct planner result followed
by an incorrectly escaped model-authored write. Explicit decoding instructions did
not change the outcome. The candidate also made more provider requests than the
prose baseline. Repeating prompt edits neither removes the byte-copying operation
nor establishes a reliable transport.

## Proposed boundary

```text
Caller drafts replacement and selects issue
  -> connector prepares plan from an exact live read
  -> pure planner computes target and body
  -> connector stores immutable plan, returns reference and preview
Caller requests apply(reference)
  -> connector passes stored body directly to the existing tracker write port
  -> caller receives acknowledged, failed or uncertain outcome
```

| Operation | Responsibility |
|---|---|
| Prepare `{issue_id, faff_body}` | Connector live-reads comments, calls the pure planner, binds the plan to the issue and connector session |
| Preview | Returns the action, target, reason and body for review, plus an opaque reference |
| Apply `{plan_ref}` | Caller explicitly chooses to write. Connector constructs tracker arguments from the stored plan; it accepts no body or target override |
| Stale input | Refuse when the selected existing body differs from the recorded digest. This check is not remote compare-and-swap |
| Repeated apply | Refuse the same reference once a write has started, including after an uncertain result; do not retry automatically |
| Restart or missing reference | Refuse. Reprepare from a new live read; no inferred plan recovery |
| Write outcome | Return acknowledged, failed or uncertain separately from the planner reason. Never infer acknowledgement from plan success |

The planner retains its six-field schema and performs no I/O. Verdict judgement,
the decision to apply, per-round logging and the existing issue-claim concurrency
contract stay with the caller. The connector performs the read/write transport.

## Required production work before another acceptance run

1. Choose the production connector integration, including how existing tracker
   ports are supplied to the adapter. The repository currently has no generic
   executable tracker-write bridge; a fixture-only tool is insufficient.
2. Implement the plan store and apply-by-reference transport, with bounded
   lifetime and storage and explicit session/issue scope.
3. Test exact CRLF, Unicode and literal backslash preservation, body/target
   override refusal, stale input, repeated apply, concurrent apply and uncertain
   outcomes against independent expectations.
4. Bind that shipped transport in the fixture harness. Record the changed tools
   and runtime as a new treatment; retain the old failed results and declarations.
5. Run a bounded Claude diagnostic only after deterministic transport checks
   pass. A subsequent paired acceptance run needs its own declared allowance.

The three unexpected baseline differences in the original batch still require
separate review. A transport correction cannot silently waive them.
