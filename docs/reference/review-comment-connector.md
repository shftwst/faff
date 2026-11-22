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

For hosted Linear, run `mcp-remote` once under the account that will run the
connector and complete its OAuth prompt. Use the same executable and account in
the configuration below. The stdio proxy maintains its own OAuth session.
[Linear MCP setup](https://linear.app/docs/mcp).

```json
{
  "schema": 1,
  "command": "npx",
  "args": ["--yes", "--package=mcp-remote@0.16.7", "mcp-remote", "https://mcp.linear.app/mcp"],
  "tools": {
    "list": "list_comments",
    "create": "save_comment",
    "update": "save_comment"
  },
  "issueArgument": "issueId",
  "timestampField": "createdAt",
  "listing": "cursor-comments",
  "pageSize": 50
}
```

| Port | Required upstream contract |
|---|---|
| List | Takes the configured issue argument. Returns every comment in tracker order, with string `id`, exact string `body` and the configured creation timestamp field. Missing/null timestamp stays null |
| Single response | Use `complete-array` for an array or `complete-comments` for exactly `{"comments": [...]}`. Both require the upstream to return every comment in one response. Omit `pageSize` |
| Cursor pagination | Use `cursor-comments` with a `pageSize` from 1 to 100. The bridge sends `limit` on every call and passes the returned `cursor` to the next call. Each page contains `comments` and a boolean `hasNextPage`. A nonfinal page must include a nonempty cursor. The final cursor must be absent or null |
| Create | Takes the configured issue argument and `body`; returns a JSON object with the created `id` |
| Update | Takes `id` and `body`; returns a JSON object with that same `id` |
| Acknowledgement | A successful MCP tool result containing the expected ID. If it includes `body`, it must equal the sent body. This acknowledges the connector response; it does not prove durable remote storage |
| Result encoding | `structuredContent`, or one JSON text content item. Tool errors, malformed results and lost acknowledgements after dispatch are uncertain writes |

The bridge discovers the configured tools through MCP `tools/list`. Both prepare
and apply read the entire comment thread. With cursor pagination, an unknown
page field, duplicate comment ID, repeated cursor, or a thread exceeding 100
pages or one MiB causes the read to fail before a write.

Register the bridge in the client's MCP configuration with absolute paths.

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
