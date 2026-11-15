# Candidate adapter and paired harness results

The harness executes a pinned emitted command, records its inputs and outputs,
grades actual command use, and compares fresh baseline/candidate runs against
the independent eleven-case oracle. No production planner, skill prose or
recorded historical observation was changed. No fresh model batch was run.

| Verification | Result |
|---|---|
| Adapter commit `ba93d04b` | 151 focused tests passed locally and independently in Claude Code |
| Paired harness and final stream-failure fix | 171 focused tests passed locally and independently in Claude Code |
| Node 20.20.2 container, final changes after merging the updated prerequisite branch | 171 focused tests passed |
| Region, CLI coverage and adapter checks | Passed; 152 registered commands and 21 slot skills |
| Independent review | No outstanding must-fix harness findings |

The adapter review found and resolved hidden Git-index mutations and conflation
of malformed model input with source drift. The paired review tightened candidate
event pins, retained raw runtime differences alongside a derived strict comparison,
and added later-turn runtime checks and per-arm accounting. A separate failing
test reproduced lost partial SSE usage; the proxy now retains the bytes and
usage while holding the reservation. The final minor review advice was applied
by recording transport errors before the HTTP-status branch.

Every planned execution remains in the report, including failures and attempts
not started after a stop. Complete cost/token totals stay unknown when evidence
is partial. Observed quantities, contributor counts and held/open reservations
are reported separately. Command time is distinct from total elapsed time.

The fixture executables establish transport and failure handling. They do not
establish production planner conformance or a reduction in prompt size, model
cost or latency. Those measurements still require the production candidate,
resolved boundary proposals, the recorded release condition and an authenticated
launcher shell exposing the declared access-token variable.

Harness commits are `ba93d04b` and `3ef5a86d`, following the admission hardening in
`d9781d39`. Commit `acba3e66` integrates the refreshed prerequisite branch without
conflicts. All authored commits retain operator DCO sign-off and use the requested
per-command override to disable cryptographic signing.

See `eval/control-parity/PAIRED-RUNS.md` for the three CLI steps and acceptance
rules, `claude-paired-final-review.md` for independent verification, and
`claude-paired-stream-review.md` for the final failure-path regression check.
