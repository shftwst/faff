# Spec: Log every Linear MCP call during normal development (FAFF-175)

> Spec: faffter-dark-nlspec · 2026-06-19 · interactive · confidence: high · refreshed 2026-06-21 (autonomous resolve-attempt folded the schema-overhead Punt → defer to FAFF-176). Full spec on Linear FAFF-175.

This is the build contract for FAFF-175, a **spike**. Audience: the build agent who will write the analysis script and produce the report, plus human reviewers. The deliverable is a small zero-dependency script plus a committed report — not a production feature.

## 1. WHY — Problem and Principles

**Problem statement.** Linear MCP consumed ~39% of one week's token usage, but we don't yet know *which* calls drive that cost. Without a ground-truth breakdown — calls by tool, frequency, and token cost — the MCP→CLI swap (FAFF-177) is flying blind, and the CLI-coverage comparison (FAFF-176) has no call set to measure against. This spike produces that breakdown from data that already exists.

**Design principles.**

**Zero dependencies.** Reuse `estimateTokens` (chars/4) from `eval/cli-driver.mjs` — a real tokenizer is rejected even though more accurate, because the MCP-vs-CLI *ratio* is what matters and the constant proxy error cancels.

**Measure results, not just calls.** The cost driver is the verbose JSON *result* payload held in context, not the call count or argument size.

**Read existing transcripts, don't instrument.** Claude Code already records every `tool_use` + `tool_result` to disk; passive parsing is the whole job.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `eval/cli-driver.mjs` (`estimateTokens`) | Node ESM | The chars/4 token proxy to reuse — do not redefine |
| `eval/size-census.mjs` (FAFF-170) | Node ESM | Prior art: same proxy, same zero-dep census→report shape to mirror |
| `~/.claude/projects/<slug>/*.jsonl` | JSONL | Raw source — one file per session, `tool_use`/`tool_result` entries |

**Scope statement.** The measurement front-end of *Tracker access is token-cheap*: it produces the baseline number and the call set the rest of the project consumes.

## 2. OUT OF SCOPE

- **Any CLI evaluation or selection** — that's FAFF-176, which consumes this output.
- **The swap itself** — FAFF-177, gated on FAFF-176.
- **Live instrumentation / a faff-side call logger** — transcripts already hold the data. Extension point: a `--watch` mode over new transcripts if continuous monitoring is ever wanted.
- **Exact tokenizer accuracy** — chars/4 proxy suffices for a ratio. Extension point: swap `estimateTokens` behind the same signature.
- **Per-tool MCP schema-overhead sizing** — resolved to FAFF-176 (see §6/§7). Schema tokens are not in the transcripts (they come from the MCP tool definitions), and the MCP-vs-CLI schema delta is FAFF-176's comparison to own. This spike measures result/arg cost only.
- **Non-Linear MCP servers** — Linear-specific concern. Extension point: the tool-name filter is a regex; widening it is trivial.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Slug dir | A `~/.claude/projects/<project-slug>/` directory; faff's main repo + each worktree gets its own |
| Call record | One Linear `tool_use` paired with its `tool_result` by `tool_use_id` |
| Result tokens | est-tokens (chars/4) of the `tool_result` content — the cost driver |
| Schema tokens | est-tokens of an MCP tool's input-schema definition — fixed per-tool context overhead, loaded once per session regardless of call count. **Out of scope here — measured by FAFF-176** |

**The per-tool aggregate (the report's core row):**

```
RECORD ToolStats:
  tool: String              # e.g. "list_issues" (mcp__claude_ai_Linear__ prefix stripped)
  calls: Int
  result_chars: Int         # summed across calls
  result_est_tokens: Int    # chars/4 of result_chars
  arg_est_tokens: Int       # chars/4 of summed argument payloads
  result_est_tokens_per_call: Float
```

**The report shape (top-level):**

```
RECORD Report:
  window: { from: Date, to: Date, days: Int }
  sessions_scanned: Int
  slug_dirs_scanned: Int
  by_tool: List<ToolStats>             # sorted by result_est_tokens desc
  totals: { calls, result_est_tokens, arg_est_tokens }
  heaviest: List<String>               # tools covering the top ~80% of result tokens
```

(The earlier optional `schema_overhead` block is dropped — schema sizing is FAFF-176's, not this report's.)

**Design decisions (markers).**

- Token proxy: **Chosen:** reuse `estimateTokens` (chars/4) from `eval/cli-driver.mjs` — zero-dep, ratio-preserving.
- Call/result pairing: **Chosen:** join `tool_use.id` → `tool_result.tool_use_id` within each transcript.
- Slug-dir selection: **Chosen:** scan every `~/.claude/projects/` dir whose slug contains `faff` (main + worktrees). **Assumes:** all faff development happens under faff-named slug dirs (validation in §7).
- Schema-token measurement: **Chosen:** defer to FAFF-176. Schema overhead is sourced from MCP tool definitions (not the transcripts this spike parses), and the per-session MCP-vs-CLI schema delta is exactly the comparison FAFF-176 owns — the swap-side CLI carries no per-tool schema overhead, so the delta is a FAFF-176 input, not a FAFF-175 measurement. This spike builds the result/arg breakdown and stops there.

## 4. HOW — Behaviour

**Architecture.** One zero-dep node script (mirroring `eval/size-census.mjs`): enumerate faff slug dirs → read each `*.jsonl` → extract Linear call records → aggregate into `ToolStats` → emit `report.json` + a skimmable `report.md`. It writes a report; it mutates nothing.

**Behaviour summary.** "Across all faff session transcripts in a date window, sum the token cost of every Linear MCP call, grouped by tool, so the heaviest tools are named."

```
PROCEDURE build_report(window_days):
  1. Enumerate slug dirs: ~/.claude/projects/* whose name contains "faff"
  2. For each *.jsonl with mtime within window_days:
     a. Parse each line as JSON (skip unparseable lines)
     b. Collect tool_use where name matches /^mcp__.*Linear__/, keyed id -> {tool, arg_chars}
     c. Collect tool_result whose tool_use_id is a known Linear id -> result_chars
  3. Pair calls to results by id; orphan call (no result) counts, result 0 — log the count
  4. Aggregate into ToolStats; est_tokens = chars/4 via estimateTokens
  5. Sort by_tool by result_est_tokens desc; compute totals + heaviest (top ~80%)
  6. Write report.json + report.md
```

**Edge cases.**

- **Unparseable JSONL line** → skip, increment `skipped_lines` (surfaced). Fatal only if *every* line fails.
- **Call with no paired result** (truncated session) → count call, zero result tokens, surface orphan count.
- **`tool_result.content` shape varies** (string or array of blocks) → normalise: string as-is, array → `JSON.stringify`; measure normalised length.
- **Empty window** → exit non-zero with a clear message, not a zero-filled report.
- **Repeated `sessionId` across slug dirs** → count once (keyed by file), log collisions.

**Anti-pattern:** leading with argument size as the headline cost. Why: arguments are tiny; the result payload is 10–100× larger and is the real driver.
**Anti-pattern:** scanning only the main repo's slug dir. Why: most build sessions run in per-issue worktree slug dirs (53 observed), so main-only undercounts heavily.

## 5. SCENARIOS

```
Given several days of faff transcripts with Linear MCP calls across main and worktree slug dirs
When the analysis script runs over that window
Then it emits a per-tool breakdown sorted by result token cost, naming the heaviest tools, aggregated across all faff slug dirs
```

```
Given a transcript with a Linear tool_use whose session was truncated before the tool_result
When the script aggregates that file
Then the call is counted, its result tokens are zero, and the orphan count is surfaced (no crash, no silent drop)
```

- Assertion — **reproducible:** two runs over the same window yield identical numbers (deterministic, no model call).
- Assertion — **zero runtime deps:** imports only node builtins + `eval/cli-driver.mjs`'s `estimateTokens`.

## 6. DESIGN DECISION RATIONALE

**Where does the token estimate come from?**
- (a) chars/4 proxy reused from the repo; (b) a real tokenizer library.
- (a) zero-dep, ratio-preserving, blessed by FAFF-170. (b) accurate absolute counts but breaks zero-dep for a number whose ratio is all that matters.
- **Chosen:** (a) chars/4 via `estimateTokens` — the swap rests on the MCP-vs-CLI ratio, where the constant proxy error cancels.

**Which sessions count as "normal development"?**
- (a) main slug dir only; (b) all faff-named slug dirs incl. worktrees; (c) every slug dir on the machine.
- (a) undercounts; (c) pulls in unrelated projects; (b) matches "faff development".
- **Chosen:** (b) all `~/.claude/projects/` dirs whose slug contains `faff`, mtime-filtered.

**Measure per-tool MCP schema overhead in this spike?**
- (a) yes — size each Linear tool's input schema; (b) no — defer to FAFF-176.
- Schema tokens are real and per-session but aren't in transcripts (sourced from the tool definitions), so they're a separate data source from this spike's whole job.
- **Chosen:** (b) defer to FAFF-176. Rationale: (1) FAFF-175 is defined as *transcript parsing only* — schema cost comes from MCP tool definitions, a different source, and bolting it on would add a second concern the methodology critique flagged against. (2) FAFF-176 owns the MCP-vs-CLI token comparison ("Token cost vs the MCP equivalent"); per-session schema overhead is part of *that* comparison — the replacement CLI carries no per-tool schema overhead, so the schema delta is a FAFF-176 input, not a FAFF-175 datapoint. (3) Keeps this spike right-sized at its 1–3 day single-deliverable scope. *(Resolved 2026-06-21 by autonomous resolve-attempt at appetite: high — a single defensible answer, convention/right-sizing call, not architectural. See the tracker audit-trail comment.)*

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** *(None outstanding — the schema-overhead question is resolved; see below.)*

- **Schema overhead in-scope for this spike? — RESOLVED: deferred to FAFF-176.** MCP tool *schema* cost (loaded per session, independent of call count) is real and arguably part of the 39%, but it's sourced from the tool definitions, not the transcripts — a separate small sub-task on a different data source. This spike builds the result/arg breakdown only; FAFF-176 sizes schema overhead as part of its MCP-vs-CLI token-cost comparison. *(Was a `Punt: needs human`; resolved 2026-06-21 by autonomous resolve-attempt — see audit-trail comment.)*

**Assumptions.**

- **Assumes:** all faff development lives under `~/.claude/projects/` slug dirs containing `faff`. Validate: list slug dirs, spot-check none of the user's faff sessions live under a differently-named dir.
- **Assumes:** `estimateTokens` is exported from `eval/cli-driver.mjs` with chars/4 behaviour. Validate: import it, confirm `estimateTokens("test")` ≈ 1.
- **Assumes:** transcript schema is `{ message: { content: [ {type:"tool_use"|"tool_result", ...} ] } }` per line. Validate: parse the newest faff transcript, confirm a Linear `tool_use`/`tool_result` pair is found (spot-confirmed in explore; build re-checks).

## 8. DONE — Definition of Done

### From WHY
- [ ] A committed report names the heaviest Linear MCP tools by token cost, over ≥ a few days of real usage.
- [ ] Report leads with *result* tokens (the cost driver), not call counts or arg size.

### From WHAT
- [ ] Per-tool rows carry: calls, result_chars, result_est_tokens, arg_est_tokens, result_est_tokens_per_call.
- [ ] Report carries window (from/to/days), sessions_scanned, slug_dirs_scanned, totals, and a `heaviest` list.

### From HOW (behaviour)
- [ ] Script enumerates all `~/.claude/projects/` slug dirs containing "faff" and mtime-filters transcripts by window.
- [ ] Calls paired to results by `tool_use_id`; token cost via reused `estimateTokens`.
- [ ] `by_tool` sorted by result_est_tokens descending.

### From HOW (edge cases)
- [ ] Unparseable JSONL lines skipped and counted (`skipped_lines`); not fatal unless all fail.
- [ ] Orphan calls counted with result tokens 0, orphan count surfaced.
- [ ] `tool_result.content` normalised whether string or array of blocks.
- [ ] Empty window exits non-zero with a clear message.

### From principles
- [ ] Zero runtime dependencies beyond node builtins + `eval/cli-driver.mjs`.
- [ ] Re-running over the same window yields identical numbers.
- [ ] Schema-overhead sizing is **not** attempted here (deferred to FAFF-176).

**Integration smoke test:**

```
RUN script with --days 7
EXPECT: report.json written; by_tool non-empty; top entry is a read tool
        (list_issues / list_projects expected heaviest per explore);
        totals.result_est_tokens >> totals.arg_est_tokens
```

## Methodology critique

Methodology: faffter-dark-methodology-agile-delivery

- **Right-sized?** No issues — a single 1–3 day spike with one clear deliverable (zero-dep script + report). The lone open punt (schema overhead) is now resolved (deferred to FAFF-176), confirming it was non-blocking and not a hidden second concern forcing a split.
- **Workstream fit?** No issues — sits in the outcome-named, cohesive *Tracker access is token-cheap* project as its measurement front-end.
- **Deps surfaced?** No issues — it blocks FAFF-176 (CLI comparison) and that blocker link is set. No implicit deps.
- **Risk profile?** This *is* the de-risking spike (principle 7): it pulls the project's load-bearing unknown — what the MCP actually costs — to the front, before any swap is committed. Healthy sequencing.

confidence: high
