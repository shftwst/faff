# Deterministic review comment handoff

Status: authorised implementation. The operator requested all work necessary to
make the refactor function after two Claude runs copied a correct planner body
into an incorrectly escaped tracker write. Historical observations and the seven
planner policy decisions remain unchanged.

## Boundary

`review-comment-session.ts` stores immutable plans behind random session-local
references. `review-comment-mcp.ts` supplies real tracker read/write ports through
an operator-configured upstream stdio MCP connector. `review-comment-server.ts`
exports prepare/apply tools through `bin/faff-review-comments.mjs`.

| Call | Behaviour |
|---|---|
| Prepare | Accept only issue ID and replacement text. Read complete comments, invoke the unchanged pure planner, store its immutable result and snapshot digest, return reference and a detached preview |
| Apply | Accept only reference. Consume it before I/O, invalidate sibling references for the issue, reread and compare the complete normalized snapshot, then send stored bytes to the upstream write port |
| Refusal | Unknown, expired, used or foreign-session reference; changed snapshot; failed live read; excess pending plans; body/target overrides |
| Uncertainty | Write dispatched without a valid acknowledgement, including upstream tool error. Never retry automatically |
| Limits | Five-minute reference lifetime; sixteen pending plans; one MiB input and snapshot; eight MiB MCP message; thirty-second upstream request timeout |

Authentication remains with the configured upstream executable. Executable paths,
arguments and port mappings come only from the operator's configuration file.
No model argument selects an executable, tracker endpoint or credential source.
The listing contract must explicitly assert complete results. This implementation
does not guess tracker pagination or implement another Linear authentication stack.

The pure planner retains its six result fields and performs no I/O. The connector
performs factory-region tracker effects; it grants no governance authority. A
snapshot recheck is not remote compare-and-swap, and a connector acknowledgement
does not prove durable remote storage. Issue claims remain required.

## Acceptance

- Exact stored bytes survive the production MCP subprocess path for all eleven
  independent recorded outcomes, including CRLF, Unicode and literal backslashes.
- Override, stale snapshot, expiry, cross-session, duplicate/concurrent apply and
  uncertain write cases fail without an unintended second effect.
- The shipped server is tested through JSON-RPC, including initialization and
  tool schemas. Missing or incompatible upstream tools fail connection.
- The Claude treatment binds the committed production handoff and records its
  changed tools separately from the earlier planner-only treatment.
- Recorded failed runs remain failed. A diagnostic does not turn the earlier
  paired acceptance run into a pass or establish cost/latency savings.
- Hosted tracker qualification is separate from fixture-only Claude evaluation.
  Deployment requires a configured upstream satisfying the documented port contract.

## Rule inventory

| Prose rule | Command behaviour | Covering test | Disposition |
|---|---|---|---|
| `Live-read all comments with exact` | Connector reads complete comments itself and maps the timestamp field. | test/review-comment-mcp.test.mjs | changed: move byte transport out of model arguments |
| `with all read comments to` | Prepare accepts issue and replacement, invokes the same pure planner and stores its result. | test/review-comment-session.test.mjs | changed: replace model-supplied comments and CLI transport with the configured connector |
| `Apply one successful plan` | Apply accepts only a session reference and sends its stored body. | test/review-comment-session.test.mjs; test/review-comment-mcp.test.mjs | changed: replace model-authored write arguments with deterministic transport |
| `No plan: log the diagnostic` | Caller still blocks without a plan and reports failed/uncertain writes without claiming completion. | test/review-comment-session.test.mjs | changed: include missing connector and refused apply in blocked operations |
| `The planner preserves human text and line endings` | Same pure splice, plus a complete live snapshot check before writing. | test/review-comment-mcp.test.mjs | changed: document live recheck while retaining issue claims and absence of remote compare-and-swap |
