# Review comment connector

SuperDomestique prepares a review comment from a live tracker read, then applies
the stored body by reference. The model supplies the replacement findings and
chooses to apply; it never copies the existing human text into a write call.

```text
prepare_review_comment(issue_id, faff_body)
  -> tracker list -> pure planner -> session store -> preview + plan_ref
apply_review_comment(plan_ref)
  -> fresh tracker list -> compare snapshot -> stored create/update -> outcome
```

## Configure the tracker connection

The shipped entry point is `plugin/skills/faff/bin/faff-review-comments.mjs`.
It takes one operator-owned JSON configuration file and launches an upstream
stdio MCP connector with an argument array, without a shell. Keep authentication
in that upstream connector. The bridge neither reads another agent's token store
nor accepts executable configuration through model tool arguments.

Example configuration for a connector with the following tool contract:

```json
{
  "schema": 1,
  "command": "/absolute/path/to/tracker-mcp",
  "args": [],
  "tools": {
    "list": "list_comments",
    "create": "create_comment",
    "update": "save_comment"
  },
  "issueArgument": "issue_id",
  "timestampField": "created_at",
  "listing": "complete-comments"
}
```

| Port | Required upstream contract |
|---|---|
| List | Takes the configured issue argument. Returns every comment in tracker order, with string `id`, exact string `body` and the configured creation timestamp field. Missing/null timestamp stays null |
| Listing shape | `complete-comments` requires exactly `{ "comments": [...] }`; `complete-array` requires an array. These settings assert that the upstream returns the complete issue listing. Paginated, truncated or otherwise wrapped results are unsupported and must be aggregated by the upstream connector |
| Create | Takes the configured issue argument and `body`; returns a JSON object with the created `id` |
| Update | Takes `id` and `body`; returns a JSON object with that same `id` |
| Acknowledgement | A successful MCP tool result containing the expected ID. If it includes `body`, it must equal the sent body. This acknowledges the connector response; it does not prove durable remote storage |
| Result encoding | `structuredContent`, or one JSON text content item. Tool errors, malformed results and lost acknowledgements after dispatch are uncertain writes |

The bridge checks configured tool names at connection time and follows MCP
`tools/list` pagination. Comment-list pagination is a separate tracker-specific
contract and is deliberately not inferred from unknown response fields.

Register it in the client's MCP configuration, using absolute paths:

```json
{
  "mcpServers": {
    "faff-review-comments": {
      "command": "node",
      "args": [
        "/absolute/path/to/faff/plugin/skills/faff/bin/faff-review-comments.mjs",
        "/absolute/path/to/review-tracker.json"
      ]
    }
  }
}
```

Existing tracker tools remain available for other workflow operations. Terminal
review comments use only the connector's prepare/apply tools. Without this
connection the review-comment operation reports blocked.

Linear documents `mcp-remote https://mcp.linear.app/mcp` as a stdio connection
option. That client can occupy `command`/`args` after its normal OAuth setup.
Its authentication is separate from a Claude Code or Codex native HTTP connection.
Confirm the live tool names, argument names, response shape and listing
completeness before selecting bindings; the example above is a port contract,
not a claim that a particular hosted Linear tool version has been qualified.
[Linear MCP setup](https://linear.app/docs/mcp).

## Session and failure behaviour

- References last five minutes and belong to one server process. Restarting loses them.
- At most sixteen plans, including preparations in progress, are retained. Input
  and comment snapshots are each limited to one MiB; MCP messages to eight MiB.
- Apply consumes the reference before its live read. Starting an apply invalidates
  other prepared references for that issue. Concurrent applies cannot write twice
  through those references.
- A changed snapshot or failed live read refuses before writing. The recheck is
  not remote compare-and-swap; the workflow still needs its issue claim.
- A transport timeout closes the connection. There are no automatic write retries.
- After an uncertain write, inspect the tracker before preparing another plan.
  A new session or new reference is not evidence that the earlier write failed.

The bridge implements the MCP 2025-06-18 stdio transport and tool calls.
[MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports),
[MCP tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
