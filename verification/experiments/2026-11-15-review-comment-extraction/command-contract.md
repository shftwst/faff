# Review-comment command contract for the evaluation adapter

The proposed production command is `faff review-comment plan --input -`.
It reads one JSON object from stdin and emits one JSON plan to stdout. The
adapter never selects a comment or splices text itself.

Input schema 1: `issue_id` is the tracker issue identifier, `faff_body` is the
replacement text and `comments` is the complete current comment list. Each
comment has an `id` and `body`; metadata such as `created_at` and `author` is
passed through unchanged.

Output schema 1 has exactly these fields:

| Field | Meaning |
|---|---|
| `schema` | `1` |
| `action` | `create` or `update` |
| `reason` | `created`, `updated` or `reconciled` |
| `comment_id` | Existing comment ID for update; null for create |
| `body` | Complete proposed comment body |
| `expectedDigest` | SHA-256 of the original target body as UTF-8; null for create |

The adapter binds the clean candidate commit, complete tracked plugin tree,
emitted entrypoint and build manifest. It copies the verified plugin bytes into
a private temporary directory and invokes Node with filesystem reads restricted
to that copy, writes and child processes disabled, and no inherited credentials
or Node options. Input arrives on stdin. Expected outcomes and fixtures are not
copied into the command's allowed filesystem.

The Node permission mechanism here enforces the stated filesystem and subprocess
limits. It is not a general network or hostile-native-code sandbox. The bound
planner remains a reviewed pure computation, and gets no production connectors.

Command execution records exact stdin, raw stdout/stderr, hashes, executable,
argv, directory, empty environment, exit, signal, artifact hashes, overall time
and spawn time separately. Calls and results are durably recorded in
`commands.jsonl`, with their order relative to raw tracker events.

Invalid output or failed execution returns no write plan. Defaults are five
seconds per call, one MiB for input and output, and sixteen calls per attempt.
The paired manifest must bind these limits before model admission.

Candidate acceptance requires the `followed` command-use grade: the model passes
the last read's complete comments and exact replacement text, then applies one
matching write and finishes with the planned reason. A failed call remains a
candidate failure even if a later call succeeds. A call after the first write
does not prove that the write used the plan. Invalid input and exceeded call/input
limits are candidate failures; source drift, interrupted evidence and calls after
finish are incomplete evidence. The grader uses raw event sequence numbers.

Adapter tests use literal fixture executables to prove transport and limits.
Those tests are not evidence that the production planner has been implemented
or that any skill-size or model-cost saving has been achieved.
