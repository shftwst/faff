# Revised caller CRLF diagnostic

The single diagnostic at `d0efdd4e` failed. The caller's explicit decoded-JSON
instruction did not prevent double-escaping. All six provider requests have
complete usage; priced usage was $0.0651418 against the $0.50 cap, with no retry
and no held or open reservation. Runtime matched the zero-cost preflight.

The planner again returned the independently expected 194-byte body. The model
sent the 205-byte escaped representation to `save_comment`, reread the damaged
fixture comment and reported blocked. Raw `003.response.txt` reconstructs the
same tool arguments recorded by MCP: the incorrect string originates in the
model response, not in Claude Code's tool transport. The incorrect string is
exactly `JSON.stringify(plan.body).slice(1, -1)`.

`evidence-reconciliation.json` records the trace/command grades, byte comparison,
and independently recomputed response costs matched to the ledger. The raw
requests, responses, CLI output, planner input/output and tracker events remain
unchanged in this directory.

The successful earlier shell exercise was directed and did not establish that a
fresh model would correctly transfer a JSON body through the MCP write tool.
This diagnostic supplies that missing observation. It does not change the eleven
expected outcomes or turn the failed paired comparison into a pass.

No further prompt-only attempt is planned. Preserving exact text through this
boundary requires a production connector path that passes the decoded plan to
the tracker in code. The current CLI has no tracker-write transport: `tracker.js`
only classifies connector configuration, and `review-comment plan` is pure.
Changing only the fixture server to accept plan references would test a capability
the product does not have. The proposed production boundary is described in
`deterministic-handoff.md`; it is not implemented or accepted by these results.
