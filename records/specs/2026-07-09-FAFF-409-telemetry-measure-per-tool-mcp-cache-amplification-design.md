# Telemetry — measure per-tool MCP cache-amplification

> Spec: faffter-dark-nlspec · 2026-07-09 · autonomous · confidence: high. Full spec on Linear FAFF-409.

This is the build spec for FAFF-409, addressed to the build agent and human reviewers. It turns MCP's *unmeasured* share of faff's token spend into a **measured, per-tool figure** by decomposing the transcripts' already-billed `cache_read` totals, rather than estimating with a single global amplification factor. It extends the read-only analysis script FAFF-407 shipped; it stands up no new runnable surface.

## 1. WHY — Problem and Principles

**The load-bearing model.** An MCP `tool_result` is not billed once. It lands in the context window on the turn it returns, and then rides in the cached prefix, re-billed as `cache_read_input_tokens` on **every subsequent assistant turn** in the same context lineage until it is evicted or the session ends. Its true cost is therefore `size × (number of billed turns it survives)`, not its one-time payload size. That amplified footprint is exactly what a one-shot payload census cannot see.

**Problem statement.** FAFF-407's census could only price MCP's *payload* (a chars/4 floor ≈ 1% of spend); the amplified cost was left as a range (~1% floor → unmeasured ceiling), and its script attributes per-tool cache cost as `response_bytes × cacheAmpFactor` where `cacheAmpFactor` is a **single global ratio** (`cache_read / (input + cache_write)`) applied uniformly to every tool. This change replaces that global estimate with a per-tool figure measured from the transcripts' own billed `cache_read` numbers.

**Design principles.**

- **Reconcile to the billed total.** The per-tool attribution must sum back to the transcript's measured `cache_read` total (the same reconciliation discipline FAFF-407 already applies to the grand total). An attribution that does not reconcile is a bug, not an estimate. This is the property that makes the figure *measured* rather than *modelled*: it distributes numbers the API actually charged, it does not invent them from a factor.
- **Honest about residual error, never hide it.** Where the transcript does not record a fact the method needs (which blocks were resident in each request's cached prefix), the assumption is stated, its direction of bias named, and its magnitude bounded and reported. A null or "MCP is small" result is a valid, publishable outcome.
- **Non-leak invariant (inherited from FAFF-407 §5).** The script emits **only** sizes, counts, names, model-ids and derived costs — never transcript payload content. Payloads are read solely to measure their serialized size.

**Reference context.**

| System | Language | Relevance |
|---|---|---|
| `scripts/token-breakdown.mjs` | Node (zero-dep) | FAFF-407's read-only transcript pivot; shipped via PR #290. Owns corpus resolution, the four token-class sums, reconciliation, pricing, and the current global-factor MCP estimate this change replaces. |
| `eval/mcp-call-census.mjs` | Node (zero-dep) | FAFF-175's Linear-MCP call census; the `tool_use`→`tool_result` id-matching pattern and the bytes/4 proxy self-check are reused idioms. |
| `~/.claude/projects/<cwd-slug>/*.jsonl` | JSONL transcripts | Ground-truth corpus. Each line is a record; assistant records carry `message.usage.cache_read_input_tokens`; user records carry `tool_result` blocks; records are a `parentUuid`→`uuid` linked list with `timestamp`, `sessionId`, `isSidechain`. |

**Scope statement.** This sits in the token-observability cluster (FAFF-407 breakdown, FAFF-175 census, FAFF-177 CLI-swap) as the measurement that closes FAFF-407's MCP-share range.

## 2. OUT OF SCOPE

- **A durable `faff tokens` reporting command.** — Not built here. *Why excluded:* whether to promote the throwaway analysis into a shipped CLI subcommand is FAFF-407's own open recommendation, not FAFF-409's Done. *Extension point:* if the report recommends it, a follow-up ticket lifts the reconciling attribution out of `scripts/token-breakdown.mjs` into a `faff tokens` subcommand in the CLI.
- **Dispatch-time instrumentation of live MCP calls.** — Not built (see the DESIGN DECISION RATIONALE — it is rejected, not deferred within scope). *Why excluded:* faff does not own the Claude Code MCP transport, so a live marker is not implementable read-only. *Extension point:* were the harness to expose a dispatch hook, an emitter would write a per-call context-cost marker into `.faff/` — a different ticket against a different seam.
- **A true tokenizer.** — Kept as the chars/4 proxy. *Why excluded:* a tokenizer library breaks the repo's zero-dep convention, and the proxy error cancels in the ratios that matter. *Extension point:* the `estTokensFromChars` helper is the single swap site.
- **Fixing child `agent-*.jsonl` mtime over-count (FAFF-229).** — Out of scope. *Why excluded:* a separate accounting caveat. *Extension point:* per-lineage attribution (below) is compatible with a later mtime-scoping fix; it does not depend on one.

## 3. WHAT — Vocabulary, Types, and Interfaces

**Vocabulary.**

| Term | Definition |
|---|---|
| Context lineage | One `parentUuid`-connected chain of records sharing an `isSidechain` status — the main conversation, or one subagent sidechain. Cache is per-lineage: a block re-read in the main thread is never re-read in a sidechain and vice-versa. |
| Resident prefix | At a given assistant turn, the ordered set of prior content blocks in the same lineage assumed to be in that request's cached prefix. |
| Amplified footprint | The `cache_read` tokens attributed to one content block (or one MCP tool) across all the billed turns it was resident for. |
| Billed turn | An assistant record carrying `message.usage` — the unit the API prices. Its `cache_read_input_tokens` is the measured re-read cost of its resident prefix. |

**Type definitions.**

```
RECORD ContentBlock:                 # one measurable unit of the resident prefix
  lineage_id: String                 # session/sidechain identity
  first_seen_turn: Int               # index of the billed turn at/after which it entered the prefix
  size_tok: Int                      # estTokensFromChars(serialized bytes); the pro-rata weight
  mcp_tool: String | null            # bare tool name if this block is an MCP tool_result, else null

RECORD PerToolAttribution:
  tool: String                       # e.g. claude_ai_Linear__list_issues
  call_count: Int
  request_tok: Int                   # one-time input cost of the tool_use args (unchanged from FAFF-407)
  response_tok: Int                  # one-time payload size of the tool_result (unchanged)
  cache_read_measured_tok: Int       # NEW: summed pro-rata share of billed cache_read — the measured figure
  amplification_ratio: Number        # cache_read_measured_tok / response_tok — per-tool, not global
  cost_est_usd: Number

RECORD Reconciliation:
  cache_read_total_billed: Int       # sum of message.usage.cache_read_input_tokens across billed turns
  cache_read_attributed: Int         # sum of every block's pro-rata share
  reconciles: Bool                   # attributed == total_billed (exact by construction)
  mcp_share_tok: Int                 # sum over mcp blocks
  nonmcp_share_tok: Int              # the residual — the model/context share
```

**Design decisions** are collected with markers in Section 6.

## 4. HOW — Behavior

**Architecture and approach.** A read-only pass over the same corpus FAFF-407 walks, done in one additional traversal that reconstructs each lineage's resident prefix turn by turn and splits each billed turn's *measured* `cache_read` across the blocks resident at that turn, pro-rata by block size. MCP `tool_result` blocks collect their shares; summed per tool name, that is the measured per-tool cache-amplification. The non-MCP remainder is the model/context share — the MCP-vs-model decomposition the Done asks for.

**Behaviour summary.** For each context lineage, walk its billed turns in order; maintain the resident-block set; at each turn, hand every resident block a slice of that turn's billed `cache_read` proportional to the block's size; accumulate MCP blocks' slices per tool.

```
PROCEDURE attribute_cache_read(records):
  1. Group records into lineages: partition by sessionId, then by isSidechain chain via parentUuid.
  2. FOR each lineage:
     a. Order its records by the parentUuid chain (fall back to timestamp on a broken link).
     b. resident := []            # ContentBlocks seen so far in this lineage
     c. FOR each record in order:
        - IF it carries content blocks (tool_result, text, tool_use):
            append each as a ContentBlock (size_tok = estTokensFromChars(serialized bytes);
            mcp_tool set only for tool_result whose tool_use_id maps to an mcp__ tool_use).
        - IF it is a billed turn (message.usage present):
            cr := usage.cache_read_input_tokens
            weight_total := sum(b.size_tok for b in resident)     # prefix as reconstructed
            IF weight_total > 0 AND cr > 0:
               FOR each b in resident:
                  b.attributed += cr * (b.size_tok / weight_total)
            record cr into cache_read_total_billed
        - IF it is a compaction/summary boundary (see edge cases):
            resident := []         # blocks before the boundary are no longer re-read
  3. Aggregate: per mcp_tool sum attributed → PerToolAttribution.cache_read_measured_tok;
     sum all attributed → cache_read_attributed (MUST equal cache_read_total_billed).
  4. amplification_ratio := cache_read_measured_tok / max(response_tok, 1), PER TOOL.
```

**Why it reconciles.** Each billed turn's `cr` is fully partitioned across its resident blocks (the shares sum to `cr`), so summing all shares reproduces the summed billed `cache_read` exactly — modulo turns with an empty reconstructed prefix, which are reported as an `unattributed` line rather than smeared. The figure is measured because `cr` is the number the API charged, not `response_bytes × factor`.

**Edge cases and error handling.**

- **Compaction / context reset.** Claude Code rewrites context on compaction; blocks before the boundary stop being re-read. Detect a boundary from the `system` record `subtype` (a compact/summary marker) or a large drop in a turn's `cache_read` relative to accumulated resident weight; on detection, clear `resident`. Undetectable compaction over-attributes early blocks — see Failure modes.
- **Cache-TTL expiry.** A turn after a >5-min gap may re-bill a block as `cache_creation` (write) rather than `cache_read`; that turn's `cr` is correspondingly smaller, so pro-rata attribution self-corrects and reconciliation still holds against the measured totals. No special-casing needed.
- **Broken `parentUuid` link.** Fall back to `timestamp` ordering within the lineage; if both are missing the record is appended in file order (terminal, not retryable — logged as a corpus-quality note).
- **`tool_result` with no mapped `tool_use`.** Not attributable to a tool; it still counts as a resident non-MCP block (its share lands in the residual), never dropped.
- **Zero billed turns after a tool_result** (tool called on the session's last turn): footprint is its one-time cost only — correct, it was never re-read.

**Failure modes.**

- **The failure:** the resident-prefix reconstruction is wrong because compaction went undetected, so long-lived early blocks (often large early file reads, not MCP) absorb too much `cache_read` and MCP's share is *under*-stated (or a persistent early MCP result is *over*-stated). *How you'd know:* the per-lineage `cache_read_attributed` reconciles to the billed total (that always holds) but a sensitivity check — re-running with an aggressive vs a lenient compaction-boundary rule — moves MCP's share by more than a stated tolerance. *What it means:* narrow — report MCP's share as a tightened *range* between the two boundary rules, not a false point figure; the range is still strictly inside FAFF-407's ~1%→ceiling and answers the Done.
- **The failure:** the chars/4 size proxy skews the pro-rata weights (a payload's char-density differs from token-density). *How you'd know:* swapping the proxy constant materially changes per-tool ranks. *What it means:* proceed — the proxy error is a near-constant multiplier that largely cancels in each turn's *ratio* of block sizes; note it as a second-order caveat.
- **The failure:** MCP genuinely turns out to be a small share, confirming FAFF-407's "primary lever is context, not MCP". *How you'd know:* `mcp_share_tok / cache_read_total_billed` is low single-digit percent. *What it means:* a valid, reportable outcome — the Done is "measured figure", not "large figure".

**Anti-pattern:** reusing FAFF-407's single global `cacheAmpFactor` for the new column. Why: it is exactly the `response × global-factor` estimate this ticket exists to replace; the new column must be built from per-turn billed `cache_read`.

**Anti-pattern:** attributing `cache_read` across lineages. Why: each subagent sidechain has its own cache; cross-lineage attribution double-counts and breaks reconciliation.

## 5. SCENARIOS — born-verifiable main objectives

```
Given a transcript corpus with MCP tool_results resident across multiple billed turns
When the attribution pass runs
Then every lineage's summed attributed cache_read equals its summed billed
     message.usage.cache_read_input_tokens (reconciles: true), with any
     empty-prefix remainder shown as an explicit unattributed line
```

```
Given two MCP tool_results of equal payload size, one returned early in a long
     session and one on the final turn
When per-tool cache-amplification is computed
Then the early result is attributed materially more cache_read than the late one
     (i.e. the figure is position-sensitive, unlike the global factor)
```

```
Given the completed analysis
When the report is written
Then it states MCP's measured share of total cache_read as a number (or a
     compaction-bounded range), decomposed per tool, and explicitly confirms or
     refutes FAFF-407's "primary lever is context, not MCP" conclusion
```

Assertion — non-leak: the emitted report and JSON contain no transcript payload text, only sizes, counts, names, model-ids and derived costs.

## 6. DESIGN DECISION RATIONALE

**How to attribute the amplified cost: post-hoc transcript-correlation vs dispatch-time marker?**
Options: (a) post-hoc — analyse existing transcripts, correlating each MCP `tool_result` with the `cache_read` on the turns that follow it; (b) dispatch-time — emit a per-call context-cost marker when the MCP call is made. (b) needs a wrapper around the harness's MCP dispatch, which faff does not own and cannot instrument read-only; it is also blind to history. (a) is purely analytical over transcripts faff already reads, needs no new seam, and covers all past runs.
**Chosen:** post-hoc transcript-correlation — the only approach implementable read-only over existing transcripts.

**How to turn "correlate the cache_read delta" into a number: proportional-share vs survival-count?**
Options: (a) proportional-share — split each billed turn's *measured* `cache_read` across its resident blocks pro-rata by size; (b) survival-count — `size × subsequent-billed-turn-count`, then price with a factor. (b) re-introduces a modelled factor and does not reconcile to the billed total. (a) distributes the number the API actually charged and reconciles exactly by construction.
**Chosen:** proportional-share over measured per-turn `cache_read`, reconciling to the billed total.

**Extend the FAFF-407 script or write a new one?**
Options: (a) extend `scripts/token-breakdown.mjs`; (b) new script. The FAFF-407 script already owns corpus resolution, the class sums, reconciliation, pricing, and the `tool_use`→`tool_result` id-map — all reused here; a new script duplicates them.
**Chosen:** extend `scripts/token-breakdown.mjs` — replace its global-factor MCP estimate with the reconciling per-tool attribution and add the measured column to its report.

**Which blocks are resident in each request's cached prefix (the transcript doesn't record this)?**
Options: (a) resident from first-seen to lineage end; (b) resident until a detectable compaction boundary, then evicted. (a) alone over-attributes across compactions. (b) uses the `system` compaction/summary marker (and a cache_read-drop heuristic) to bound residence, and reports MCP's share as a range across an aggressive-vs-lenient boundary rule when the two diverge.
**Chosen:** first-seen-until-detectable-compaction-boundary, with the boundary-sensitivity range reported — honest about the one fact the transcript omits.

**Cache is per-lineage — how to handle subagent sidechains?**
**Chosen:** partition records into lineages (`sessionId` + `isSidechain` chain) and attribute strictly within each — never cross a lineage boundary (mirrors the FAFF-229 child-transcript separation).

**Deliverable form: analytical extension + report, or a shipped command?**
**Chosen:** a read-only analytical extension plus the updated `verification/reports/token-usage-breakdown/` report — matching FAFF-407's "not a shipped product" framing. Promotion to a durable `faff tokens` command stays FAFF-407's open recommendation (Out of scope).

## 7. OPEN QUESTIONS AND ASSUMPTIONS

**Open Questions.** None blocking. The compaction-boundary residual is handled in-spec (report a bounded range), not escalated.

**Assumptions.**

- **Assumes:** `scripts/token-breakdown.mjs` (FAFF-407, PR #290) exists on `main`. *Validation:* at build start run `test -f scripts/token-breakdown.mjs`; PR #290 is merged, so a fresh `main` checkout has it. If absent (a checkout predating the merge — as the prep checkout was), pull latest `main` before extending. If it were genuinely gone, this reduces to writing the pass standalone against the same corpus — not a blocker.
- **Assumes:** transcript records expose `message.usage.cache_read_input_tokens` on assistant turns and `parentUuid`/`isSidechain`/`sessionId` for lineage reconstruction. *Validation:* confirmed present in the current corpus during prep; the build should re-confirm on its own corpus and treat a missing field as a corpus-quality note (attribute what is present).

## 8. DONE — Definition of Done

### From WHY
- [ ] Per-tool MCP cost is a **measured** figure derived from billed `cache_read`, not `response × global-amplification-factor`.
- [ ] The non-leak invariant holds: report + JSON emit only sizes/counts/names/model-ids/costs, no payload text.

### From WHAT (types and interfaces)
- [ ] Output carries a `cache_read_measured_tok` and a **per-tool** `amplification_ratio` per MCP tool (replacing the single global factor).
- [ ] A `Reconciliation` line reports `cache_read_total_billed`, `cache_read_attributed`, `reconciles`, and the `mcp_share_tok` / `nonmcp_share_tok` split.

### From HOW (behaviour)
- [ ] Attribution runs per context lineage (`sessionId` + `isSidechain`), never across lineages.
- [ ] Each billed turn's measured `cache_read` is split pro-rata by resident-block size; shares sum back to the billed total (reconciles: true), with any empty-prefix remainder shown as an explicit `unattributed` line.
- [ ] A detected compaction/summary boundary clears the resident set; when the aggressive-vs-lenient boundary rules diverge beyond tolerance, MCP's share is reported as a range, not a false point figure.

### From HOW (edge cases)
- [ ] `tool_result` with no mapped `tool_use` counts toward the non-MCP residual, is never dropped.
- [ ] A tool_result on the final turn is attributed its one-time cost only (no amplification).

### From WHY (the cross-reference Done)
- [ ] The report states MCP's measured share of the 94.7% `cache_read` decomposed per tool, and explicitly confirms or refutes FAFF-407's "primary lever is context, not MCP" conclusion.

**Integration smoke test:**

```
PROCEDURE smoke:
  1. Run: node scripts/token-breakdown.mjs --json
  2. Assert output.reconciliation.reconciles === true (grand total, unchanged from FAFF-407)
  3. Assert output.mcp.per_tool[*] each carry cache_read_measured_tok and a per-tool
     amplification_ratio, and that sum(cache_read_measured_tok) + unattributed
     === output.by_class.cache_read within rounding (the new reconciliation)
```

## Already shipped against this surface

Related Done work on the token-observability surface — none supersedes this premise; all are context the build should not redo.

- **FAFF-407** (Done, PR #290) — the token-usage breakdown spike. Shipped `scripts/token-breakdown.mjs` + the report. It **explicitly left** MCP's amplified cost as a range (`cacheAmpFactor` is a single global estimate) — that gap is precisely this ticket. Extend, do not rebuild.
- **FAFF-175** (Done) — the Linear-MCP call census (`eval/mcp-call-census.mjs`), the "~39%" claim. Measured payload/call cost only, no amplification. Reuse its id-mapping idiom.
- **FAFF-36 / FAFF-357** (Done) — `faff budget check` transcript summation and cost-per-shipped-issue. The billed totals this attribution reconciles against; not overlapping scope.

Premise holds → proceed.
