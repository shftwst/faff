# Linear MCP call census (FAFF-175)

> Captured snapshot — regenerate with `node eval/mcp-call-census.mjs --days N`. Numbers are deterministic over a fixed window (no model call). est-tokens are a chars/4 proxy; the MCP-vs-CLI **ratio** (FAFF-176/177) is what they're for.

> Window: 2026-06-16 → 2026-06-21 (7 days) · 320 sessions across 20 faff slug dirs

**Total Linear MCP cost over the window:** 3,099,504 est result tokens across 2,485 calls (chars/4 proxy).
Arguments cost 700,683 est tokens — the **result payload is the driver** (4.424× the arg cost).

**Heaviest tools (top ~80% of result tokens):** get_issue, save_issue, list_comments, save_comment

_9 unparseable transcript line(s) skipped._
_1 orphan call(s) (no paired result — truncated sessions); counted with result 0._

## Per-tool breakdown (sorted by result token cost)

| Tool | Calls | Result est-tokens | Result/call | Arg est-tokens |
|---|--:|--:|--:|--:|
| `get_issue` | 694 | 741,018 | 1,068 | 5,896 |
| `save_issue` | 665 | 632,037 | 950 | 123,139 |
| `list_comments` | 565 | 582,247 | 1,031 | 3,750 |
| `save_comment` | 249 | 567,320 | 2,278 | 554,847 |
| `list_issues` | 168 | 356,408 | 2,121 | 2,668 |
| `list_projects` | 21 | 121,465 | 5,784 | 151 |
| `list_initiatives` | 16 | 66,989 | 4,187 | 139 |
| `save_project` | 24 | 9,200 | 383 | 6,156 |
| `list_issue_labels` | 32 | 8,920 | 279 | 289 |
| `get_initiative` | 12 | 7,569 | 631 | 185 |
| `list_issue_statuses` | 16 | 2,728 | 171 | 68 |
| `save_initiative` | 4 | 1,217 | 304 | 1,481 |
| `save_status_update` | 2 | 836 | 418 | 561 |
| `get_project` | 1 | 762 | 762 | 12 |
| `list_teams` | 6 | 485 | 81 | 17 |
| `create_issue_label` | 3 | 208 | 69 | 124 |
| `list_milestones` | 5 | 58 | 12 | 61 |
| `create_issue` | 1 | 25 | 25 | 1,127 |
| `delete_comment` | 1 | 12 | 12 | 12 |

_est-tokens = chars/4 (reused from `eval/cli-driver.mjs`). Schema-token overhead is out of scope (FAFF-176). Re-running over the same window yields identical numbers._
