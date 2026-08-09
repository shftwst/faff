# Spec — FAFF-407: Token-usage breakdown spike

> Spec: faffter-dark-nlspec · 2026-07-09 · interactive · confidence: high. Full spec on Linear FAFF-407.

Type: spike. Deliverable = analysis report + ranked fileable opportunity list + build-or-not recommendation on a durable `faff tokens` command (NOT a pre-committed build).

## 1. WHY
faff already writes a complete per-record token ledger per session to `~/.claude/projects/<cwd>/<session>.jsonl` (+ child `agent-*.jsonl`): each record has `message.model`, `message.usage` (four token classes), top-level `timestamp`. Today all collapsed to ONE scalar (`sumTranscriptFile`; consumed by `budget check`/`economics`). The four breakdown axes (time/model/token-class/phase-and-MCP) are present in data but never retained. Read-and-pivot exercise, not new instrumentation.

Principles:
- Reuse the proven token path (`sumTranscriptFile`/`measureTokens`); the per-axis pivot MUST reconcile to the existing scalar total.
- Honour FAFF-229: attribute child `agent-*.jsonl` by `childOwningSession(f)===sid`, NOT mtime (undercount-not-overcount). Any run-/session-scoped pivot reuses that gating.
- Analysis is not a product — code sized throwaway unless the analysis concludes a durable command is warranted.

Reference anchors: sumTranscriptFile :2550; measureTokens :2597 (childOwningSession gate :2619); transcriptBaseDir :2540; BUDGET_TOKEN_USAGE_KEYS :2467; cmdEconomics :2970; economicsAttributeIssue :2868; events.jsonl EVENT_PHASES :9322; faff audit :10465.

## 2. OUT OF SCOPE
- A production `faff tokens` subcommand (the question under evaluation).
- New instrumentation / token-tagging events.jsonl.
- Cross-repo aggregation.
- Currency modelling beyond flat `budget.price_per_mtok` — report tokens as primary unit.
- Changing budget/economics behaviour (read-only).

## 3. WHAT
Token class = input / output / cache_write(=cache_creation_input_tokens) / cache_read(=cache_read_input_tokens). Reconciliation total = scalar sumTranscriptFile over same files.

Record shape (confirmed on live transcripts): top-level `type`, `timestamp` (ISO8601), `sessionId`; `message.model` (e.g. claude-opus-4-8); `message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`.

Decisions:
- **Chosen:** throwaway analysis script, not a subcommand.
- **Chosen:** pivot each record once for global axes; childOwningSession gating (FAFF-229) only for run-/session-scoped rollups.
- **Chosen:** tokens primary unit; per-model cost weighting a ranked opportunity.
- **Punt:** exact phase attribution of orchestrator-inline spend (best-effort).
- **Punt:** clean MCP-vs-model split from usage alone (census estimate).

## 4. HOW
Step 0 validate_corpus: sample assistant records across ≥3 files/≥2 days; assert message.model + top-level timestamp + usage four-keys present; if missing on material fraction, mark that axis partial.

pivot(base): for each session-file AND each agent-*.jsonl, for each record whose usage the pivot reads — **mirror `sumTranscriptFile`'s record selection exactly** (ANY record with `message.usage` or top-level `usage`, not assistant-only) so the pivot cannot drift from the reconciliation total — add into class-axis, model-axis[model], time-axis[day], grand. reconciliation = Σ sumTranscriptFile(file); ASSERT grand.total==reconciliation. Emit AxisBreakdown per axis with pct_of_grand_total. (Records with usage but no message.model bucket as model="unknown".)

phase_attribution(run_dir) best-effort: load events.jsonl phase windows [(phase,ts_start,ts_end)]; for childOwningSession-gated agent files prefer meta.json description→economicsAttributeIssue→issue→build phase, else bucket records by timestamp into phase window; orchestrator-inline records spanning phases → UNATTRIBUTED (report attributed % + remainder).

mcp_estimate(base): census mcp__* tool_use/tool_result blocks; estimate token weight of payloads as LOWER-BOUND proxy; attribute to server; label ESTIMATE; cross-check vs FAFF-175 ~39% Linear.

### AMENDMENT (human request 2026-07-09) — MCP per-tool cost breakdown for surgical remediation
This is the spike's HEADLINE deliverable. Goal: know **which MCP tools are actually invoked**, and **what each costs broken into input / cache / response**, so remediation is surgical (call-it-less vs shrink-the-response vs leave-it).

**(a) Tool-usage census.** Enumerate every MCP tool actually invoked across the corpus, keyed by full name `mcp__<server>__<tool>` (e.g. `mcp__…Linear__list_issues`, `…__save_issue`, `…__save_comment`, `…__get_issue`), with `call_count` per tool and per server. This answers "what tools are actually used from the MCPs" — the tools NEVER called are as informative (dead schema weight) as the hot ones.

**(b) Per-tool cost split across the three classes** — for each tool name, attribute:
  - **request** = Σ serialized weight of the `tool_use` input params (what faff SENDS). Fix lever: param/prompt bloat.
  - **response** = Σ serialized weight of the `tool_result` payload (what comes BACK, immediate injection). Fix lever: field projection / terse CLI (FAFF-177).
  - **cache (amplification)** = the response's persistence cost: an injected tool_result rides in context and is re-billed as `cache_read` on EACH subsequent turn until truncation. Estimate per tool = response_weight × resident-turn-count (or measure by correlating the `cache_read` delta on the turns following each call). This is usually the DOMINANT class and the whole reason a chatty tool is expensive — a big result read once is paid for every turn after. Fix lever: don't hold fat results in context (one-shot/terse).
  Roll up per tool: `call_count`, and total + median/p90 for each of request / cache / response. Rank tools by total (request+cache+response) weight → the surgical target list.

**Separate columns, not merged** — the three classes have different fixes, so a tool that's cheap-request/fat-response/huge-cache is remediated differently from one that's fat-request. Report request | cache | response as distinct columns per tool.

**Estimate caveat (unchanged):** request and response weights are directly measurable per call; the cache-amplification class is the LOWER-BOUND→estimate (exact split needs correlating cache_read deltas across turns). Keep the aggregate MCP range and cross-check vs FAFF-175 ~39% Linear. Identify the top ~3 cost-driving tools (by name + the class driving them) as named follow-up optimisation candidates.

Edge cases: malformed lines skip; usage w/o model → model="unknown", counted; non-assistant top-level {usage} included; empty corpus → "no data"; cache_read-dominated profile expected (a finding).

Failure modes: per-run axis summing ABOVE reconciliation → FAFF-229 gating skipped; MCP census implausibly small vs 39% → report MCP as range; uniform spend (no row >~20%) → valid null result, recommend "no command".

Anti-patterns: bespoke usage key list (drifts from BUDGET_TOKEN_USAGE_KEYS); presenting phase/MCP axis as measured fact (both best-effort).

### Telemetry-gap register (first-class discovered output — human request 2026-07-09)
Every figure the spike can only ESTIMATE or cannot measure is itself a deliverable: the spike EMITS a register of blind spots, each paired with the concrete telemetry/instrumentation that would make it exact, as fileable follow-ups. The point: the estimate axes exist because faff is blind there today — the spike's job is not just to estimate around the blindness but to specify how to remove it. Known gaps to seed the register (the run discovers more):
- **Cache-amplification per tool** (currently estimate = response_weight × resident-turns) → telemetry: correlate cache_read deltas across turns, or emit a per-tool-call context-cost marker at dispatch.
- **MCP-vs-model split** (no usage field; inflation lands on the next turn) → telemetry: wrap MCP dispatch to record the input/cache delta attributable to each tool_result.
- **Phase attribution of orchestrator-inline spend** (UNATTRIBUTED remainder) → telemetry: token-tag events.jsonl (add `data.tokens` to prep/build/review/run events) — promotes the OUT-OF-SCOPE "no new instrumentation" exclusion into a recommended follow-up rather than a silent drop.
- **Missing `message.model`** on some records (the `unknown` bucket) → note the fraction; if material, telemetry to stamp model on every record.
The OUT-OF-SCOPE instrumentation exclusions are correct for THIS read-only spike — but each must surface here as a telemetry recommendation, not vanish. This register is how the spike makes the NEXT measurement exact.

## 5. Scenarios
- Pivot runs → every class/model/day has a subtotal; sum of every axis's rows == sumTranscriptFile reconciliation.
- Report's optimisation section is a RANKED list, each entry fileable as a follow-up (problem+evidence+candidate fix), mirroring FAFF-175→FAFF-177.
- MCP spend labelled estimate/range, cross-checked vs FAFF-175, never a single measured field.
- Non-functional: read-only (no transcript/ledger/config/tracker mutation).
- **Non-leak invariant (infosec):** the report emits **counts / sizes / names / model-ids only, never transcript payload content**. The MCP per-tool table names calls and their request/response *sizes* — it must NOT quote a sample tool_use body or tool_result payload (a `save_comment`/`save_issue` body could carry secrets). Named-top-3 illustration is by tool NAME + size figures, not content.

## 6-7 Rationale + Punts
Throwaway script (keeps build-or-not open, zero doc/lint/selftest surface). Sum-once for global axes; gate run-scoped. Tokens primary (pricing is flat scalar). Phase best-effort w/ coverage fraction. MCP census/estimate.
Punts: phase-depth (decide from unattributed remainder), MCP exactness, faff-tokens build-or-not (product). Assumes model+timestamp present (Step 0 validates); sumTranscriptFile/measureTokens/childOwningSession behave as at anchors; FAFF-175 39% is the cross-check baseline.

## 8. DONE
- Report states spend in tokens across all four axes; each reconciles to sumTranscriptFile total (± FAFF-229-excluded children noted).
- Time axis per-day (+ per-run where useful).
- Model axis per-model (opus/sonnet/haiku/fable + unknown), MCP-side called out separately.
- Token-class axis input/output/cache_write/cache_read + shares.
- Phase axis best-effort with attributed-vs-unattributed coverage fraction.
- MCP tool-usage census: every invoked mcp__<server>__<tool> with call_count per tool + per server (and note tools never called = dead schema weight).
- MCP per-tool cost table split into THREE separate columns — input/request | cache(amplification) | response — with call_count + total + median/p90 per class, ranked by total (request+cache+response) weight; top ~3 cost-driving tools named with the class driving each, as follow-up candidates for surgical remediation.
- Step 0 corpus validation recorded before pivot trusted.
- Global axes sum each transcript once; run-scoped rollups childOwningSession-gated.
- MCP spend census-based estimate/range, cross-checked vs FAFF-175, never a measured usage field.
- Read-only.
- Ranked optimisation-opportunity list, each fileable as a follow-up.
- Explicit recommendation on building `faff tokens` (incl. null-result path).
- Three Punts surfaced for human with evidence.
- **Telemetry-gap register**: every estimated/unmeasurable figure listed with the concrete telemetry that would make it exact, each fileable as a follow-up (cache-amplification correlation, MCP-dispatch delta capture, token-tagged events.jsonl for exact phase attribution, per-record model stamping). The blind spots are a deliverable, not a footnote.
- Integration smoke test: resolve base; run pivot → 4 AxisBreakdowns; ASSERT grand.total==Σ sumTranscriptFile; spot-check class axis four subtotals sum to grand.total. No LLM-judgement seam (no grader KIND/eval).

confidence: high
