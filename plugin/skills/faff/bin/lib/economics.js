// ===========================================================================
// === region:factory — economics — FAFF-357: per-run unit economics (cost-per-shipped-issue). ===
// A PURE, read-only reporting subcommand (parity with `runcheck` / `budget
// check`): no tracker, no network, no LLM. It COMPOSES data faff already
// produces — the run ledger's terminal outcomes, `budget check`'s
// transcript-summed this-run tokens, and the per-subagent transcript files —
// into cost-per-shipped-issue + cost-per-attempt. It builds NO new meter and
// touches NO producer (the ledger writer, `budget check`, and the events log
// stay byte-unchanged); it only attributes and renders an existing reading.
// Lives in `factory` — a reporting CONSUMER of the governance budget helpers
// (measureTokens / attemptsFromLedger / …), not part of the extractable
// flight-recorder layer. beep-boop's `## Reporting` step renders the JSON.
// ===========================================================================

// Canonical terminal-bucket render order (superset of the ledger's outcome
// vocabulary); economics emits one BucketLine per NON-EMPTY bucket in this
// order, with any unknown outcome value appended (sorted) so a future bucket
// still surfaces rather than vanishing.

const fs = require("node:fs");
const path = require("node:path");
const { BUDGET_NON_ATTEMPT_OUTCOMES, PRICE_PER_MTOK, TOKEN_CLASS_FROM_USAGE, TOKEN_DELTA_CLASSES, attemptsFromLedger, childOwningSession, economicsPriceForModel, envelopeFrom, envelopeFromLedger, measureTokensByModelClass, readGovernanceConfig, resolveEconomicsPriceMap, sessionOwnedTranscriptFiles, sumTranscriptFile, transcriptBaseDir } = require("./budget");
const { EFFORT_LEVELS } = require("./events");
const { dig, findRoot, latestRunDir, readLedger } = require("./shared-infra");

const ECONOMICS_BUCKET_ORDER = ["shipped", "pr-open", "parked", "errored", "routed-out", "unreached-budget", "claimed-by-peer"];

// Best-effort per-issue attribution match: pull the FIRST tracker-key token
// ([A-Z]+-\d+) from a subagent's meta.json `description` ("Build FAFF-49 via
// faff-graft") and keep it ONLY when it names an issue the ledger recorded an
// outcome for. Returns the issue id, or null (no id, or foreign/stale id) — a
// clean, expected skip. Pure (string + ledger map), so the selftest drives it.
function economicsAttributeIssue(desc, outcomes) {
  if (typeof desc !== "string") return null;
  const m = desc.match(/[A-Z]+-\d+/);
  if (!m) return null;
  const issue = m[0];
  if (!outcomes || !Object.prototype.hasOwnProperty.call(outcomes, issue)) return null;
  return issue;
}

// PURE UnitEconomics core — no I/O. Given the ledger, the already-baselined
// this-run token spend + its source label, the price, the run-start baseline
// (for the inflation warning), and the best-effort per_issue list, derive the
// full UnitEconomics record. The caller does ALL I/O (token measurement +
// meta.json scan) and hands the results in; this function only divides and
// tallies, so it is identical run-to-run and fully selftest-coverable. Run-level
// figures NEVER depend on per_issue (best-effort) — they render identically
// whether or not attribution succeeded.
// FAFF-427: `pricing`/`map_cost`/`map_warnings` are OPTIONAL additive opts — a
// caller that never passes them (every pre-existing call, including this file's
// own --selftest table) gets `pricing:"flat"` and the exact byte-for-byte
// `cost_total` this function always computed, so nothing already depending on
// this core's shape changes. `cmdEconomics` (the only production caller) passes
// them once it has resolved the run's pricing source and, under map pricing,
// computed the per-model walk's blended cost (`map_cost`) + any unpriced-model
// names (`map_warnings`) — see below. Reconciling the two cost figures ADR-0048
// deferred means this is now the SAME rule `budget.cost` prices from.
function computeUnitEconomics(ledger, opts) {
  const { tokens_total, tokens_source, price_per_mtok, tokens_at_start, per_issue, pricing, map_cost, map_warnings } = opts;
  const price = Number.isFinite(price_per_mtok) && price_per_mtok > 0 ? price_per_mtok : 0;
  const total = Number.isFinite(tokens_total) ? tokens_total : 0;
  const resolvedPricing = pricing === "map" ? "map" : "flat";
  // flat: byte-for-byte the original rule. map: the caller's already-computed
  // per-model walk cost (null when it couldn't price anything, e.g. no records).
  const cost_total = resolvedPricing === "map"
    ? ((typeof map_cost === "number" && Number.isFinite(map_cost)) ? map_cost : null)
    : (price > 0 ? (total / 1_000_000) * price : null);

  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  const counts = new Map();
  for (const k of Object.keys(outcomes)) counts.set(outcomes[k], (counts.get(outcomes[k]) || 0) + 1);
  const ordered = ECONOMICS_BUCKET_ORDER.filter((b) => counts.has(b))
    .concat([...counts.keys()].filter((b) => !ECONOMICS_BUCKET_ORDER.includes(b)).sort());
  const buckets = ordered.map((b) => ({ bucket: b, count: counts.get(b) }));

  const shipped_count = counts.get("shipped") || 0;
  // attempt_count: dispatched builds — every recorded outcome EXCEPT the
  // never-dispatched ones (parity with attemptsFromLedger's exclusion set),
  // computed over outcomes directly so an empty/prep-only ledger yields 0 (no
  // admitted fallback — a run that made no build dispatch has no attempts).
  let attempt_count = 0;
  for (const k of Object.keys(outcomes)) if (!BUDGET_NON_ATTEMPT_OUTCOMES.has(outcomes[k])) attempt_count++;

  // FAFF-427: `cost_each` keys off `cost_total != null` rather than `price > 0` —
  // in flat mode the two conditions are IDENTICAL (cost_total is null exactly
  // when price<=0), so this is byte-for-byte unchanged for every existing caller;
  // it additionally lets a map-priced (price==0) total propagate correctly.
  const unitCost = (denom) => denom > 0 ? {
    denom,
    tokens_each: Math.round(total / denom),
    cost_each: cost_total != null ? cost_total / denom : null,
  } : null;

  const warnings = [];
  // Inflation warning is a transcript-path concern only (the estimate path never
  // uses the tokens_at_start baseline, so a 0 there is not an inflation risk).
  if (tokens_source === "transcript" && tokens_at_start === 0 && total > 0) {
    warnings.push("tokens_at_start=0 — run total may be inflated by prior-session history");
  }
  if (Array.isArray(map_warnings)) for (const w of map_warnings) warnings.push(w);

  return {
    run_id: (ledger && typeof ledger.run_id === "string" && ledger.run_id) || opts.run_id || null,
    tokens_total: total,
    tokens_source,
    price_per_mtok: price,
    pricing: resolvedPricing,
    cost_total,
    buckets,
    shipped_count,
    attempt_count,
    cost_per_shipped: unitCost(shipped_count),
    cost_per_attempt: unitCost(attempt_count),
    per_issue: Array.isArray(per_issue) ? per_issue : [],
    zero_ship: shipped_count === 0 && total > 0,
    warnings,
  };
}

// Best-effort per-issue attribution (I/O). For every child agent-*.jsonl this
// run OWNS (childOwningSession === sid — the FAFF-229 ownership gate), read its
// sibling agent-*.meta.json, match its `description` to a ledger issue, and sum
// that transcript's tokens onto the issue (accumulating across retries). Skips
// silently on a missing/unparseable meta, a description carrying no issue id, or
// a foreign/stale id. Returns the IssueCost list (empty when nothing matched —
// an expected, non-fatal fallback; run-level figures never depend on it).
function attributePerIssueCosts(base, sid, ledger, price) {
  const outcomes = (ledger && ledger.outcomes && typeof ledger.outcomes === "object") ? ledger.outcomes : {};
  let entries = [];
  try { entries = fs.readdirSync(base); } catch { return []; }
  const byIssue = new Map();
  for (const name of entries) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    const f = path.join(base, name);
    if (childOwningSession(f) !== sid) continue; // this run's owned children only
    let meta;
    try { meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, ".meta.json"), "utf8")); } catch { continue; }
    const issue = economicsAttributeIssue(meta && meta.description, outcomes);
    if (!issue) continue;
    byIssue.set(issue, (byIssue.get(issue) || 0) + sumTranscriptFile(f));
  }
  return [...byIssue.keys()].map((issue) => ({
    issue,
    bucket: outcomes[issue],
    tokens: byIssue.get(issue),
    cost: price > 0 ? (byIssue.get(issue) / 1_000_000) * price : null,
  }));
}

// ===========================================================================
// === region:factory — economics breakdown — FAFF-410: `--by class|model|mcp|day`. ===
// Additive to FAFF-357 economics: the SAME transcript walk measureTokens sums,
// PIVOTED into per-class / per-model / per-day / per-MCP-tool buckets and priced
// per-model × per-class. No `--by` flag → economics is byte-for-byte unchanged.
//
// Reuse, not a second census: the record set is EXACTLY measureTokens' selected
// files (sessionOwnedTranscriptFiles) and the usage rule is sumTranscriptFile's
// (rec.message.usage ?? rec.usage, ANY record type), so `--by class` reconciles
// to the top-line total by construction. `--by mcp` reuses FAFF-409's MEASURED
// per-tool cache-read attribution (lifted from scripts/token-breakdown.mjs) —
// never a global amplification factor.
//
// NON-LEAK INVARIANT (FAFF-407 §5): emits ONLY counts, sizes, names, model-ids
// and derived costs — never transcript payload content. Payloads are read solely
// to measure serialized size.
// ===========================================================================

const BY_AXES = ["class", "model", "mcp", "day", "effort"];

// FAFF-415: the effort axis is rendered in fixed severity order (with a trailing
// "(none)" bucket for token-bearing dispatches that carried no effort tag), so the
// table reads low→max regardless of which levels a run actually used. The closed
// membership set `EFFORT_LEVELS` lives in the events (governance) region — its
// canonical home — and this factory region reads it across the allowed factory→
// governance edge (FAFF-359 region direction; governance must never reference back).
const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_NONE_KEY = "(none)";

// FAFF-427: `PRICE_PER_MTOK` / `economicsPriceForModel` / `resolveEconomicsPriceMap`
// MOVED to `budget.js` (governance) — `budget.cost` is now the GOVERNOR that
// consults this map (the reconciliation ADR-0048 deferred), and governance must
// never be reached-back-into from factory (FAFF-359 region direction), so the
// map lives where it is authoritative and this factory module imports it. Kept
// as destructured bindings above (not re-declared here) so this file's own
// `--by` breakdown code below — and every existing caller of these three names,
// including this file's own `--selftest` table — is byte-for-byte unchanged;
// `module.exports` at the bottom re-exports them under their original names.

// Usage / model / day selectors — the SAME record rule as sumTranscriptFileByClass
// (rec.message.usage ?? rec.usage, any record type), so the pivot selects exactly
// the records the top-line sum does.
function economicsUsageOf(rec) {
  if (rec && rec.message && rec.message.usage && typeof rec.message.usage === "object") return rec.message.usage;
  if (rec && rec.usage && typeof rec.usage === "object") return rec.usage;
  return null;
}
function economicsDayOf(rec) {
  const ts = rec && rec.timestamp;
  if (typeof ts !== "string") return "unknown";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  return m ? m[1] : "unknown";
}

// The cost of a class-count bucket priced at one model, or null when the model is
// unpriced (distinct from $0). `counts` carries the four TOKEN_DELTA_CLASSES.
function economicsRowCost(counts, model, priceMap) {
  const price = economicsPriceForModel(model, priceMap);
  if (!price) return null;
  let c = 0;
  for (const cls of TOKEN_DELTA_CLASSES) c += ((counts[cls] || 0) / 1e6) * price[cls];
  return c;
}

// ---- FAFF-409 MEASURED per-tool MCP cache-read attribution (lifted verbatim in
// substance from scripts/token-breakdown.mjs; kept self-contained so faff stays a
// zero-dep single file and never depends on the retirable spike script). Payload
// is read for SIZE ONLY — the light record retains block sizes/ids/flags, never
// payload text. ----
const ECON_B2T = 4;                                  // bytes -> approx tokens (~chars/4)
const economicsTokFromChars = (chars) => Math.round((chars || 0) / ECON_B2T);
function econBlockSizeChars(block) {
  if (!block || typeof block !== "object") return 0;
  if (block.type === "tool_result") {
    const c = block.content;
    try { return typeof c === "string" ? c.length : JSON.stringify(c ?? "").length; } catch { return 0; }
  }
  if (block.type === "text") return typeof block.text === "string" ? block.text.length : 0;
  if (block.type === "thinking") return typeof block.thinking === "string" ? block.thinking.length : 0;
  try { return JSON.stringify(block).length; } catch { return 0; }
}
function econIsCompactBoundary(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.isCompactSummary === true) return true;
  return typeof rec.subtype === "string" && rec.subtype === "compact_boundary";
}
function econToLightRecord(rec, idx) {
  const sessionId = (rec && typeof rec.sessionId === "string" && rec.sessionId) || "unknown-session";
  const isSidechain = !!(rec && rec.isSidechain);
  const u = economicsUsageOf(rec);
  const cacheRead = u && typeof u.cache_read_input_tokens === "number" && Number.isFinite(u.cache_read_input_tokens)
    ? u.cache_read_input_tokens : 0;
  const blocks = [];
  const content = rec && rec.message && rec.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const size_tok = economicsTokFromChars(econBlockSizeChars(block));
      const tool_use_id = block.type === "tool_result" && typeof block.tool_use_id === "string" ? block.tool_use_id : null;
      blocks.push({ size_tok, tool_use_id, mcp_tool: null });
    }
  }
  return {
    idx,
    lineage: sessionId + "::" + (isSidechain ? "side" : "main"),
    uuid: (rec && typeof rec.uuid === "string" && rec.uuid) || null,
    parentUuid: (rec && typeof rec.parentUuid === "string" && rec.parentUuid) || null,
    timestamp: (rec && typeof rec.timestamp === "string" && rec.timestamp) || null,
    billed: u !== null,
    cacheRead,
    isBoundary: econIsCompactBoundary(rec),
    blocks,
  };
}
function econOrderLineage(recs) {
  const byUuid = new Map();
  for (const r of recs) if (r.uuid) byUuid.set(r.uuid, r);
  const childOf = new Map();
  const roots = [];
  for (const r of recs) {
    if (r.parentUuid && byUuid.has(r.parentUuid) && r.parentUuid !== r.uuid) {
      if (!childOf.has(r.parentUuid)) childOf.set(r.parentUuid, []);
      childOf.get(r.parentUuid).push(r);
    } else { roots.push(r); }
  }
  const cmp = (a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.idx - b.idx;
  };
  const ordered = [];
  const seen = new Set();
  const visit = (r) => {
    if (seen.has(r)) return;
    seen.add(r);
    ordered.push(r);
    const kids = (childOf.get(r.uuid) || []).slice().sort(cmp);
    for (const k of kids) visit(k);
  };
  roots.sort(cmp);
  for (const r of roots) visit(r);
  for (const r of recs) if (!seen.has(r)) ordered.push(r);
  return ordered;
}
// Attribute billed cache_read across resident blocks pro-rata by size, PER LINEAGE,
// clearing the resident prefix at a detected compaction boundary. `perTool` collects
// each MCP tool_result block's share → the MEASURED per-tool cache-amplification,
// reconciling to the billed cache_read total by construction.
function econAttributeCacheRead(lightRecords) {
  const byLineage = new Map();
  for (const r of lightRecords) {
    if (!byLineage.has(r.lineage)) byLineage.set(r.lineage, []);
    byLineage.get(r.lineage).push(r);
  }
  const perTool = new Map();
  let billed = 0, mcpShare = 0, nonmcpShare = 0, unattributed = 0;
  for (const recs of byLineage.values()) {
    const ordered = econOrderLineage(recs);
    let resident = [];
    let residentWeight = 0;
    for (const rec of ordered) {
      if (rec.isBoundary) { resident = []; residentWeight = 0; }
      if (rec.billed && rec.cacheRead > 0) {
        const cr = rec.cacheRead;
        billed += cr;
        if (residentWeight > 0) {
          for (const b of resident) {
            const share = cr * (b.size_tok / residentWeight);
            if (b.mcp_tool) { mcpShare += share; perTool.set(b.mcp_tool, (perTool.get(b.mcp_tool) || 0) + share); }
            else { nonmcpShare += share; }
          }
        } else { unattributed += cr; }
      }
      for (const b of rec.blocks) if (b.size_tok > 0) { resident.push(b); residentWeight += b.size_tok; }
    }
  }
  const unattributedInt = Math.round(unattributed);
  const mcpShareInt = Math.round(mcpShare);
  const nonmcpShareInt = billed - unattributedInt - mcpShareInt;
  const perToolInt = new Map();
  for (const [k, v] of perTool) perToolInt.set(k, Math.round(v));
  return {
    perTool: perToolInt,
    cache_read_total_billed: billed,
    cache_read_attributed: mcpShareInt + nonmcpShareInt,
    unattributed: unattributedInt,
    mcp_share_tok: mcpShareInt,
    nonmcp_share_tok: nonmcpShareInt,
    reconciles: (mcpShareInt + nonmcpShareInt + unattributedInt) === billed,
  };
}

// PURE breakdown core — no I/O. Pivots pre-parsed transcript records into the
// requested axis' buckets, prices per-model × per-class, and reconciles to the
// top-line total (`topLineTotal`, the raw measureTokens sum over the SAME files;
// null for the estimate path). Selftest-coverable like computeUnitEconomics.
function economicsBreakdown(records, axis, priceMap, topLineTotal) {
  const grandTotal = { total: 0 };
  const byClass = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const byModel = new Map();               // model -> {input,output,cache_write,cache_read,total}
  const byDay = new Map();                 // day -> Map(model -> {classes,total})
  const modelTokens = new Map();           // model -> total tokens (dominant-model resolution)
  const mkc = () => ({ input: 0, output: 0, cache_write: 0, cache_read: 0, total: 0 });

  for (const rec of records) {
    const u = economicsUsageOf(rec);
    if (!u) continue;
    const model = (rec.message && typeof rec.message.model === "string" && rec.message.model) || "unknown";
    const day = economicsDayOf(rec);
    if (!byModel.has(model)) byModel.set(model, mkc());
    const mb = byModel.get(model);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const dm = byDay.get(day);
    if (!dm.has(model)) dm.set(model, mkc());
    const db = dm.get(model);
    for (const cls of TOKEN_DELTA_CLASSES) {
      const v = u[TOKEN_CLASS_FROM_USAGE[cls]];
      if (typeof v === "number" && Number.isFinite(v)) {
        grandTotal.total += v;
        byClass[cls] += v;
        mb[cls] += v; mb.total += v;
        db[cls] += v; db.total += v;
        modelTokens.set(model, (modelTokens.get(model) || 0) + v);
      }
    }
  }

  // dominant model = the most-token-bearing model (ties → model-id ascending),
  // ignoring the "unknown" bucket unless it is the only model present.
  const dominant = [...modelTokens.entries()].filter(([m]) => m !== "unknown")
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
    || [...modelTokens.keys()][0] || null;

  const mkRow = (key, counts, model) => ({
    key,
    input: counts.input, output: counts.output, cache_write: counts.cache_write, cache_read: counts.cache_read,
    total: counts.total,
    cost: economicsRowCost(counts, model, priceMap),
  });

  let rows = [];
  let pricedAtModel = null;

  if (axis === "class") {
    // one row per class, fixed order; priced at the run's dominant model, named.
    // "unknown" (no model field on any record) is not a pricing basis — surface it
    // as null so priced_at_model never misleads (its cost is already null).
    pricedAtModel = dominant && dominant !== "unknown" ? dominant : null;
    const price = pricedAtModel ? economicsPriceForModel(pricedAtModel, priceMap) : null;
    rows = TOKEN_DELTA_CLASSES.map((cls) => {
      const one = { input: 0, output: 0, cache_write: 0, cache_read: 0, total: byClass[cls] };
      one[cls] = byClass[cls];
      return { key: cls, ...one, cost: price ? (byClass[cls] / 1e6) * price[cls] : null };
    });
  } else if (axis === "model") {
    rows = [...byModel.entries()].map(([model, b]) => mkRow(model, b, model))
      .sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1));
  } else if (axis === "day") {
    rows = [...byDay.entries()].map(([day, dm]) => {
      const agg = mkc();
      let cost = 0, anyPriced = false;
      for (const [model, b] of dm) {
        for (const cls of TOKEN_DELTA_CLASSES) agg[cls] += b[cls];
        agg.total += b.total;
        const c = economicsRowCost(b, model, priceMap);
        if (c != null) { cost += c; anyPriced = true; }
      }
      return { key: day, input: agg.input, output: agg.output, cache_write: agg.cache_write, cache_read: agg.cache_read, total: agg.total, cost: anyPriced ? cost : null };
    }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  const grand = rows.reduce((s, r) => s + r.total, 0);
  const reconciliation = {
    grand_total: grand,
    top_line_total: (typeof topLineTotal === "number") ? topLineTotal : null,
    reconciles: (typeof topLineTotal === "number") ? grand === topLineTotal : false,
  };
  const out = { axis, source: "transcript", rows, reconciliation };
  if (axis === "class") out.priced_at_model = pricedAtModel;
  return out;
}

// PURE MCP breakdown core — call_count / request_bytes / response_bytes census
// (exact) + FAFF-409 MEASURED per-tool cache-read attribution. Priced at the run's
// dominant model. Ordering: call_count desc, ties tool-name asc. NON-LEAK: only
// counts, byte-sizes, tool names and derived costs — never payload content.
function economicsMcpBreakdown(records, priceMap, dominant) {
  const idToTool = new Map();
  const mcpTools = new Map();          // bare name -> { call_count, request_bytes, response_bytes }
  const pendingResults = [];
  const light = [];
  let idx = 0;
  for (const rec of records) {
    light.push(econToLightRecord(rec, idx++));
    const content = rec && rec.message && rec.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith("mcp__")) {
        const bare = block.name.replace(/^mcp__/, "");
        if (typeof block.id === "string") idToTool.set(block.id, bare);
        const t = mcpTools.get(bare) || { call_count: 0, request_bytes: 0, response_bytes: 0 };
        t.call_count += 1;
        try { t.request_bytes += JSON.stringify(block.input ?? {}).length; } catch { /* size only */ }
        mcpTools.set(bare, t);
      } else if (block.type === "tool_result") {
        let size = 0;
        try { size = typeof block.content === "string" ? block.content.length : JSON.stringify(block.content ?? "").length; } catch { size = 0; }
        pendingResults.push({ id: block.tool_use_id, size });
      }
    }
  }
  for (const { id, size } of pendingResults) {
    const bare = idToTool.get(id);
    if (!bare) continue;
    const t = mcpTools.get(bare);
    if (t) t.response_bytes += size;
  }
  // resolve each light tool_result block's mcp_tool, then MEASURED attribution
  for (const r of light) for (const b of r.blocks) if (b.tool_use_id) b.mcp_tool = idToTool.get(b.tool_use_id) || null;
  const attr = econAttributeCacheRead(light);
  const pricedAtModel = dominant && dominant !== "unknown" ? dominant : null;
  const price = pricedAtModel ? economicsPriceForModel(pricedAtModel, priceMap) : null;
  const rows = [...mcpTools.entries()].map(([tool, t]) => {
    const request_tok = economicsTokFromChars(t.request_bytes);
    const response_tok = economicsTokFromChars(t.response_bytes);
    const cache_read_measured_tok = attr.perTool.get(tool) || 0;
    const amplification_ratio = response_tok > 0 ? Number((cache_read_measured_tok / response_tok).toFixed(2)) : 0;
    const cost = price
      ? Number((((request_tok + response_tok) * price.input + cache_read_measured_tok * price.cache_read) / 1e6).toFixed(6))
      : null;
    return { tool, call_count: t.call_count, request_bytes: t.request_bytes, response_bytes: t.response_bytes,
      request_tok, response_tok, cache_read_measured_tok, amplification_ratio, cost };
  }).sort((a, b) => b.call_count - a.call_count || (a.tool < b.tool ? -1 : a.tool > b.tool ? 1 : 0));
  return {
    axis: "mcp",
    source: "transcript",
    priced_at_model: pricedAtModel,
    rows,
    reconciliation: {
      basis: "measured (FAFF-409 per-tool cache-read attribution)",
      cache_read_total_billed: attr.cache_read_total_billed,
      cache_read_attributed: attr.cache_read_attributed,
      mcp_share_tok: attr.mcp_share_tok,
      nonmcp_share_tok: attr.nonmcp_share_tok,
      unattributed: attr.unattributed,
      mcp_share_pct: attr.cache_read_total_billed > 0
        ? Number((100 * attr.mcp_share_tok / attr.cache_read_total_billed).toFixed(3)) : 0,
      reconciles: attr.reconciles,
    },
  };
}

// The run's dominant model over the SAME record set (token-bearing, ties asc).
function economicsDominantModel(records) {
  const modelTokens = new Map();
  for (const rec of records) {
    const u = economicsUsageOf(rec);
    if (!u) continue;
    const model = (rec.message && typeof rec.message.model === "string" && rec.message.model) || "unknown";
    let sum = 0;
    for (const cls of TOKEN_DELTA_CLASSES) { const v = u[TOKEN_CLASS_FROM_USAGE[cls]]; if (typeof v === "number" && Number.isFinite(v)) sum += v; }
    modelTokens.set(model, (modelTokens.get(model) || 0) + sum);
  }
  return [...modelTokens.entries()].filter(([m]) => m !== "unknown")
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0]
    || [...modelTokens.keys()][0] || null;
}

// PURE effort-breakdown core — FAFF-415. Effort is a REQUEST-TIME setting the
// transcript never records, so this axis (uniquely) pivots the run's events.jsonl,
// not the transcript walk: it buckets dispatch events by their data.effort tag and
// sums the FAFF-408 four-class token delta each carries. `events` is the parsed
// events.jsonl record array; `dominant` is the run's dominant model from the
// transcript (events carry no model), used to price each bucket — so the cost is an
// ESTIMATE (a single inferred rate card, not per-record). `topLineTotal` is the raw
// transcript sum; effort generally does NOT cover the whole run (only tagged
// windows), so we report coverage_pct rather than forcing a false reconciliation.
// NON-LEAK: emits only counts, token totals, effort-labels, model-id and derived cost.
function economicsEffortBreakdown(events, priceMap, dominant, topLineTotal, malformedLines) {
  const mk = () => ({ count: 0, input: 0, output: 0, cache_write: 0, cache_read: 0, total: 0 });
  const buckets = new Map();     // effort-label (or "(none)") -> counts
  let eventsTokenTotal = 0;
  for (const ev of events) {
    const data = ev && ev.data && typeof ev.data === "object" && !Array.isArray(ev.data) ? ev.data : null;
    if (!data) continue;
    const effort = typeof data.effort === "string" && EFFORT_LEVELS.has(data.effort) ? data.effort : null;
    const tok = data.tokens && typeof data.tokens === "object" && !Array.isArray(data.tokens) ? data.tokens : null;
    // A dispatch counts toward a bucket if it is effort-tagged; an untagged but
    // token-bearing dispatch rolls into "(none)" so coverage stays honest. An
    // untagged, token-less event is not a dispatch measurement — skip it.
    const hasTokens = tok && TOKEN_DELTA_CLASSES.some((c) => Number.isFinite(tok[c]));
    if (!effort && !hasTokens) continue;
    const key = effort || EFFORT_NONE_KEY;
    if (!buckets.has(key)) buckets.set(key, mk());
    const b = buckets.get(key);
    b.count += 1;
    if (hasTokens) {
      for (const cls of TOKEN_DELTA_CLASSES) {
        const v = tok[cls];
        if (Number.isFinite(v)) { b[cls] += v; b.total += v; eventsTokenTotal += v; }
      }
    }
  }
  const pricedAtModel = dominant && dominant !== "unknown" ? dominant : null;
  // Fixed severity order, then "(none)" last; only buckets that actually occur.
  const order = [...EFFORT_ORDER, EFFORT_NONE_KEY];
  const rows = order.filter((k) => buckets.has(k)).map((k) => {
    const b = buckets.get(k);
    return {
      key: k, count: b.count,
      input: b.input, output: b.output, cache_write: b.cache_write, cache_read: b.cache_read,
      total: b.total, cost: economicsRowCost(b, pricedAtModel, priceMap),
    };
  });
  const topLine = (typeof topLineTotal === "number") ? topLineTotal : null;
  return {
    axis: "effort",
    source: "events",
    priced_at_model: pricedAtModel,
    cost_basis: "estimate",     // priced at one inferred model; events carry no model
    rows,
    reconciliation: {
      events_token_total: eventsTokenTotal,
      top_line_total: topLine,
      // null (not false) when there is no top-line to check against — matching
      // coverage_pct's "unknown", never conflating "couldn't check" with "checked
      // and differs". malformed_lines surfaces parse-skipped events so a low
      // coverage_pct is attributable to a corrupt log, not silently to untagged work.
      coverage_pct: (topLine && topLine > 0) ? Number((100 * eventsTokenTotal / topLine).toFixed(3)) : null,
      reconciles: topLine != null ? eventsTokenTotal === topLine : null,
      malformed_lines: malformedLines || 0,
    },
  };
}

// I/O reader — read the run's events.jsonl (FAFF-35 lane), one record per line.
// Returns { events, malformed }: a malformed line is skipped BUT counted, so the
// effort axis can surface it (a silently-dropped event would make coverage_pct read
// low without any signal that a parse failure — not just untagged windows — caused
// the gap). Absent/empty file ⇒ { events: [], malformed: 0 }.
function readRunEvents(runDir) {
  const p = path.join(runDir, "events.jsonl");
  if (!fs.existsSync(p)) return { events: [], malformed: 0 };
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); } catch { return { events: [], malformed: 0 }; }
  const events = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try { events.push(JSON.parse(s)); } catch { malformed++; }
  }
  return { events, malformed };
}

// I/O reader — read the run's session-owned transcript records (the SAME file set
// measureTokens sums), parse each line into a record, and return them for the pure
// core. Degrades to source:"estimate" (empty records) exactly as measureTokens does.
function readRunTranscriptRecords(cwd, env, runStartMs) {
  const sid = env.CLAUDE_CODE_SESSION_ID;
  const base = transcriptBaseDir(cwd, env);
  const files = sessionOwnedTranscriptFiles(base, sid, runStartMs);
  if (!files) return { records: [], source: "estimate" };
  const records = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let rec;
      try { rec = JSON.parse(s); } catch { continue; }
      records.push(rec);
    }
  }
  return { records, source: "transcript" };
}

// Render a breakdown as a skimmable text table (the human default for `--by`).
function renderEconomicsBreakdown(bd) {
  const M = (n) => (n / 1e6).toFixed(2) + "M";
  const usd = (n) => (n == null ? "—" : "$" + n.toFixed(4));
  const lines = [];
  if (bd.source === "estimate") {
    const why = bd.axis === "effort" ? "no events.jsonl for this run" : "no resolvable session transcript";
    lines.push(`# economics --by ${bd.axis}: ${why} — source:estimate, no breakdown`);
    return lines.join("\n");
  }
  if (bd.axis === "effort") {
    const rc = bd.reconciliation;
    const cov = rc.coverage_pct == null ? "n/a" : `${rc.coverage_pct}%`;
    lines.push(`# economics --by effort — from events.jsonl (request-time dispatch tags, FAFF-415)`);
    lines.push(`  cost priced at ${bd.priced_at_model || "—"} (ESTIMATE — events carry no model)  ·  coverage of top-line: ${cov}`);
    lines.push(`  ${"effort".padEnd(10)} ${"dispatches".padStart(10)} ${"input".padStart(9)} ${"output".padStart(9)} ${"cache_wr".padStart(9)} ${"cache_rd".padStart(9)} ${"total".padStart(9)} ${"cost".padStart(10)}`);
    for (const r of bd.rows) {
      lines.push(`  ${String(r.key).padEnd(10)} ${String(r.count).padStart(10)} ${M(r.input).padStart(9)} ${M(r.output).padStart(9)} ${M(r.cache_write).padStart(9)} ${M(r.cache_read).padStart(9)} ${M(r.total).padStart(9)} ${usd(r.cost).padStart(10)}`);
    }
    const mal = rc.malformed_lines ? `  malformed_lines=${rc.malformed_lines}` : "";
    lines.push(`  events_token_total=${rc.events_token_total}  top_line_total=${rc.top_line_total}  reconciles=${rc.reconciles}${mal}`);
    return lines.join("\n");
  }
  if (bd.axis === "mcp") {
    const rc = bd.reconciliation;
    lines.push(`# economics --by mcp — MEASURED per-tool cache-read attribution (FAFF-409)`);
    lines.push(`  billed cache_read=${M(rc.cache_read_total_billed)}  attributed=${M(rc.cache_read_attributed)}  unattributed=${M(rc.unattributed)}  reconciles=${rc.reconciles}`);
    lines.push(`  MCP share of cache_read: ${rc.mcp_share_pct}%  ·  cost priced at ${bd.priced_at_model || "—"}  (~tokens = bytes/4)`);
    lines.push(`  ${"tool".padEnd(34)} ${"calls".padStart(6)} ${"req~".padStart(9)} ${"resp~".padStart(9)} ${"cache_read~".padStart(11)} ${"amp".padStart(6)} ${"cost".padStart(10)}`);
    for (const r of bd.rows) {
      lines.push(`  ${r.tool.slice(0, 34).padEnd(34)} ${String(r.call_count).padStart(6)} ${String(r.request_tok).padStart(9)} ${String(r.response_tok).padStart(9)} ${String(r.cache_read_measured_tok).padStart(11)} ${("×" + r.amplification_ratio).padStart(6)} ${usd(r.cost).padStart(10)}`);
    }
    return lines.join("\n");
  }
  const rc = bd.reconciliation;
  const at = bd.axis === "class" && bd.priced_at_model ? `  (priced at ${bd.priced_at_model})` : "";
  lines.push(`# economics --by ${bd.axis}${at}`);
  lines.push(`  ${"key".padEnd(22)} ${"input".padStart(9)} ${"output".padStart(9)} ${"cache_wr".padStart(9)} ${"cache_rd".padStart(9)} ${"total".padStart(9)} ${"cost".padStart(10)}`);
  for (const r of bd.rows) {
    lines.push(`  ${String(r.key).slice(0, 22).padEnd(22)} ${M(r.input).padStart(9)} ${M(r.output).padStart(9)} ${M(r.cache_write).padStart(9)} ${M(r.cache_read).padStart(9)} ${M(r.total).padStart(9)} ${usd(r.cost).padStart(10)}`);
  }
  lines.push(`  reconciles=${rc.reconciles}  (grand_total=${rc.grand_total}  top_line_total=${rc.top_line_total})`);
  return lines.join("\n");
}

function cmdEconomics(args) {
  if (args.includes("--selftest")) return economicsSelftest();
  const get = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
  const root = get("--root") || findRoot();

  // FAFF-410: optional `--by <axis>` breakdown. Fail-loud on an unrecognised axis
  // (mirrors validateModelLane) — never a silent default.
  const byAxis = get("--by");
  if (byAxis != null && !BY_AXES.includes(byAxis)) {
    process.stderr.write(`faff economics: --by '${byAxis}' is not one of {${BY_AXES.join(", ")}}\n`);
    return 2;
  }

  // Resolve the run dir (explicit --run-dir, else $FAFF_RUN_DIR, else latest) —
  // the same resolution `budget check` uses.
  let runDir = get("--run-dir") || process.env.FAFF_RUN_DIR || null;
  if (runDir && !fs.existsSync(path.join(runDir, "run-ledger.json"))) runDir = null;
  if (!runDir) runDir = latestRunDir(root);
  if (!runDir) { process.stderr.write("faff economics: no run dir (pass --run-dir DIR)\n"); return 2; }

  let ledger;
  try { ledger = readLedger(runDir); }
  catch { process.stderr.write(`faff economics: cannot read ${path.join(runDir, "run-ledger.json")}\n`); return 2; }

  const cfg = readGovernanceConfig(root);
  // Same price source budget check reads: a ledger-recorded envelope if present,
  // else fresh from config. No ceiling flags — economics reports, never gates.
  const ledgerEnv = (ledger.budget && typeof ledger.budget === "object" && ledger.budget.envelope) || null;
  const env = ledgerEnv ? envelopeFromLedger(ledgerEnv, { until: null, max_attempts: null }, cfg) : envelopeFrom(cfg, {});
  const price = env.price_per_mtok > 0 ? env.price_per_mtok : 0;
  // FAFF-427: resolved once, used both by the top-line (below) and by `--by`.
  const priceMap = resolveEconomicsPriceMap(cfg);

  const ownerStart = ledger.owner && ledger.owner.started_at ? Date.parse(ledger.owner.started_at) : null;
  const runStartMs = Number.isFinite(ownerStart) ? ownerStart : null;
  const tokensAtStart = (ledger.budget && typeof ledger.budget.tokens_at_start === "number") ? ledger.budget.tokens_at_start : 0;

  // Reuse budget check's EXACT token path — but via the per-model resolver
  // (FAFF-427), the ONE walk that also carries what map pricing needs. Its
  // `totals` is the same scalar `measureTokens` returns (sum over `by_model`, by
  // construction), so this is not an extra census — it is the single walk, and the
  // no-`--by` common path now reads the transcript exactly once (the top-line no
  // longer needs a separate `readRunTranscriptRecords`). The scalar total is still
  // baselined at run start, the same figure budget gates on.
  const measured = measureTokensByModelClass({ cwd: root, env: process.env, runStartMs });
  const measuredSource = measured.source;
  const measuredTotal = measuredSource === "transcript"
    ? (measured.totals.input + measured.totals.output + measured.totals.cache_write + measured.totals.cache_read)
    : null;
  let tokensTotal, tokensSource;
  if (measuredSource === "transcript") {
    tokensTotal = Math.max(0, measuredTotal - tokensAtStart);
    tokensSource = "transcript";
  } else {
    const estPer = Number(dig(cfg, "budget.est_tokens_per_attempt")) || 200000;
    tokensTotal = attemptsFromLedger(ledger) * estPer;
    tokensSource = "estimate";
  }

  // Per-issue attribution is transcript-only (the estimate path has no
  // transcripts to sum) and best-effort — an empty list is a clean fallback.
  let perIssue = [];
  if (tokensSource === "transcript") {
    const sid = process.env.CLAUDE_CODE_SESSION_ID;
    if (sid) perIssue = attributePerIssueCosts(transcriptBaseDir(root, process.env), sid, ledger, price);
  }

  // FAFF-427: under map pricing, the top-line cost is THIS RUN's per-model spend
  // priced from the same map + rate source `budget.cost` uses — so `cost_total`
  // stays consistent with `tokens_total` (both baselined at run start) and with
  // `budget check`'s `spent.cost`, closing ADR-0048's "two cost figures coexist"
  // deferral (the divergence was a RATE difference — flat scalar vs the map — not a
  // population one; both now use the map). The per-model this-run delta subtracts a
  // real per-model baseline (`tokens_at_start_by_model_class`, written at a
  // lights-out mint) when present, else pro-rates the whole-session per-model
  // buckets by the scalar this-run fraction — the SAME degrade `cmdBudget` applies.
  // At `tokens_at_start = 0` (the common single-session case) the fraction is 1, so
  // the top-line equals the sum of `--by model`'s priced rows. A model absent from
  // the resolved map is kept as `cost:null` (economics' REPORTING convention — NOT
  // the governor's costliest-rate overcount) and named in a warning rather than
  // silently dropped from the dollar figure.
  let mapCost = null;
  const mapWarnings = [];
  if (env.pricing === "map" && measuredSource === "transcript") {
    const baseByModel = (ledger.budget && ledger.budget.tokens_at_start_by_model_class
      && typeof ledger.budget.tokens_at_start_by_model_class === "object" && !Array.isArray(ledger.budget.tokens_at_start_by_model_class))
      ? ledger.budget.tokens_at_start_by_model_class : null;
    const scale = measuredTotal > 0 ? tokensTotal / measuredTotal : 0;
    let priced = 0, anyPriced = false;
    const unpriced = [];
    for (const [model, counts] of measured.by_model) {
      const delta = {};
      if (baseByModel) {
        const base = baseByModel[model] || {};
        for (const cls of TOKEN_DELTA_CLASSES) delta[cls] = Math.max(0, (counts[cls] || 0) - (Number(base[cls]) || 0));
      } else {
        for (const cls of TOKEN_DELTA_CLASSES) delta[cls] = (counts[cls] || 0) * scale;
      }
      const rate = economicsPriceForModel(model, priceMap);
      if (!rate) { if (TOKEN_DELTA_CLASSES.some((cls) => delta[cls] > 0)) unpriced.push(model); continue; }
      for (const cls of TOKEN_DELTA_CLASSES) priced += (delta[cls] / 1e6) * rate[cls];
      anyPriced = true;
    }
    if (anyPriced) mapCost = priced;
    else if (tokensTotal === 0) mapCost = 0; // nothing spent this run → $0, not "unknown"
    if (unpriced.length) {
      mapWarnings.push(`top-line excludes unpriced model(s) from cost (reported as cost:null, never silently free): ${unpriced.join(", ")}`);
    }
  }

  const econ = computeUnitEconomics(ledger, {
    tokens_total: tokensTotal, tokens_source: tokensSource, price_per_mtok: price,
    tokens_at_start: tokensAtStart, per_issue: perIssue, run_id: path.basename(runDir),
    pricing: env.pricing, map_cost: mapCost, map_warnings: mapWarnings,
  });

  // No `--by` → today's behaviour, byte-for-byte (always-JSON UnitEconomics blob).
  if (byAxis == null) {
    console.log(JSON.stringify(econ));
    return 0;
  }

  // `--by <axis>`: pivot the SAME transcript record set into the requested axis'
  // buckets. topLineTotal is the RAW measureTokens sum over the same files (never
  // baseline-subtracted), so `--by class` reconciles by construction.
  let bd;
  if (byAxis === "effort") {
    // FAFF-415: the effort axis reads events.jsonl (the only place request-time
    // effort is recorded), independent of whether the live transcript is resolvable.
    // The dominant model + top-line come from the transcript when available (used to
    // price + report coverage), else null.
    const { events, malformed } = readRunEvents(runDir);
    if (events.length === 0) {
      bd = { axis: "effort", source: "estimate", rows: [],
        reconciliation: { events_token_total: 0, top_line_total: null, coverage_pct: null, reconciles: null, malformed_lines: malformed } };
    } else {
      let dominant = null, topLine = null;
      if (measuredSource === "transcript") {
        const { records } = readRunTranscriptRecords(root, process.env, runStartMs);
        dominant = economicsDominantModel(records);
        topLine = measuredTotal;
      }
      bd = economicsEffortBreakdown(events, priceMap, dominant, topLine, malformed);
    }
  } else if (measuredSource !== "transcript") {
    bd = { axis: byAxis, source: "estimate", rows: [],
      reconciliation: { grand_total: 0, top_line_total: null, reconciles: false } };
  } else {
    const { records } = readRunTranscriptRecords(root, process.env, runStartMs);
    if (byAxis === "mcp") {
      bd = economicsMcpBreakdown(records, priceMap, economicsDominantModel(records));
    } else {
      bd = economicsBreakdown(records, byAxis, priceMap, measuredTotal);
    }
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify({ ...econ, breakdown: bd }));
    return 0;
  }
  console.log(renderEconomicsBreakdown(bd));
  return 0;
}

// Selftest — drives the pure core (computeUnitEconomics) + the attribution
// matcher (economicsAttributeIssue) over in-memory cases; no filesystem, no
// tracker. Covers the DoD selftest matrix: priced vs unpriced, zero-ship,
// zero-attempt, tokens_at_start=0 warning, and empty/absent per-issue.
function economicsSelftest() {
  let fail = 0;
  const ok = (label, cond) => { if (!cond) { fail++; process.stderr.write(`economics --selftest FAIL: ${label}\n`); } };

  const ledgerMix = { run_id: "run-x", outcomes: { "FAFF-1": "shipped", "FAFF-2": "shipped", "FAFF-3": "parked", "FAFF-4": "routed-out" } };

  // --- unpriced: token figures only, no cost column ---
  const u = computeUnitEconomics(ledgerMix, { tokens_total: 12_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 100, per_issue: [] });
  ok("run_id from ledger", u.run_id === "run-x");
  ok("unpriced cost_total null", u.cost_total === null);
  ok("unpriced shipped_count", u.shipped_count === 2);
  ok("attempt_count excludes routed-out", u.attempt_count === 3);
  ok("cost_per_shipped tokens_each, no cost", u.cost_per_shipped.tokens_each === 6_000_000 && u.cost_per_shipped.cost_each === null);
  ok("cost_per_attempt denom+tokens", u.cost_per_attempt.denom === 3 && u.cost_per_attempt.tokens_each === 4_000_000);
  ok("buckets ledger-order, non-empty only", JSON.stringify(u.buckets) === JSON.stringify([{ bucket: "shipped", count: 2 }, { bucket: "parked", count: 1 }, { bucket: "routed-out", count: 1 }]));
  ok("not zero_ship when shipped>0", u.zero_ship === false);
  ok("no warning when tokens_at_start>0", u.warnings.length === 0);

  // --- priced: cost twin appears ---
  const p = computeUnitEconomics({ outcomes: { "FAFF-1": "shipped" } }, { tokens_total: 4_000_000, tokens_source: "transcript", price_per_mtok: 5, tokens_at_start: 10, per_issue: [] });
  ok("priced cost_total", p.cost_total === 20);
  ok("priced price_per_mtok carried", p.price_per_mtok === 5);
  ok("priced cost_per_shipped cost_each", p.cost_per_shipped.cost_each === 20);

  // --- zero-ship: 0 shipped, >0 tokens, but attempts exist ---
  const z = computeUnitEconomics({ outcomes: { "FAFF-1": "parked", "FAFF-2": "errored" } }, { tokens_total: 17_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 1, per_issue: [] });
  ok("zero_ship true", z.zero_ship === true);
  ok("zero-ship cost_per_shipped null", z.cost_per_shipped === null);
  ok("zero-ship still reports attempts", z.cost_per_attempt.denom === 2);

  // --- zero-attempt: empty ledger + all-non-attempt ledger ---
  const za = computeUnitEconomics({ outcomes: {} }, { tokens_total: 5_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 1, per_issue: [] });
  ok("empty ledger attempt_count 0 → cost_per_attempt null", za.attempt_count === 0 && za.cost_per_attempt === null);
  ok("empty ledger buckets empty", za.buckets.length === 0);
  const zr = computeUnitEconomics({ outcomes: { "FAFF-9": "routed-out", "FAFF-8": "unreached-budget" } }, { tokens_total: 3_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 5, per_issue: [] });
  ok("all-non-attempt outcomes → attempt_count 0", zr.attempt_count === 0 && zr.cost_per_attempt === null);
  ok("all-non-attempt shipped_count 0", zr.shipped_count === 0);

  // --- tokens_at_start=0 inflation warning (transcript path only) ---
  const w = computeUnitEconomics(ledgerMix, { tokens_total: 9_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 0, per_issue: [] });
  ok("tokens_at_start=0 warns (transcript)", w.warnings.length === 1 && /tokens_at_start=0/.test(w.warnings[0]));
  const we = computeUnitEconomics(ledgerMix, { tokens_total: 9_000_000, tokens_source: "estimate", price_per_mtok: 0, tokens_at_start: 0, per_issue: [] });
  ok("estimate path does not warn on tokens_at_start=0", we.warnings.length === 0);

  // --- per-issue: present vs absent; run-level figures identical either way ---
  const withPI = computeUnitEconomics(ledgerMix, { tokens_total: 12_000_000, tokens_source: "transcript", price_per_mtok: 0, tokens_at_start: 1, per_issue: [{ issue: "FAFF-1", bucket: "shipped", tokens: 6_000_000, cost: null }] });
  ok("per_issue passed through", withPI.per_issue.length === 1 && withPI.per_issue[0].issue === "FAFF-1");
  ok("run-level identical with/without per_issue", withPI.cost_per_shipped.tokens_each === u.cost_per_shipped.tokens_each && withPI.tokens_total === u.tokens_total);
  ok("per_issue defaults to [] when absent", Array.isArray(u.per_issue) && u.per_issue.length === 0);

  // --- attribution matcher ---
  const oc = { "FAFF-49": "shipped", "FAFF-50": "parked" };
  ok("matches first issue id in description", economicsAttributeIssue("Build FAFF-49 via faff-graft", oc) === "FAFF-49");
  ok("team-key agnostic", economicsAttributeIssue("Build PROJ-123 now", { "PROJ-123": "shipped" }) === "PROJ-123");
  ok("skips description with no issue id", economicsAttributeIssue("tidy the backlog", oc) === null);
  ok("skips foreign/stale id not in ledger", economicsAttributeIssue("Build FAFF-999", oc) === null);
  ok("skips non-string description", economicsAttributeIssue(undefined, oc) === null);

  // --- FAFF-410: breakdown pivot (pure cores) ---
  const recs = [
    { message: { model: "claude-opus-4-8", usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000 } }, timestamp: "2026-07-01T10:00:00Z" },
    { message: { model: "claude-sonnet-4-6", usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 500 } }, timestamp: "2026-07-02T11:00:00Z" },
  ];
  const topline = 100 + 10 + 20 + 1000 + 50 + 5 + 500; // 1685

  const bc = economicsBreakdown(recs, "class", PRICE_PER_MTOK, topline);
  ok("class axis: 4 rows fixed order", bc.rows.length === 4 && bc.rows.map((r) => r.key).join(",") === "input,output,cache_write,cache_read");
  ok("class axis: reconciles to top-line", bc.reconciliation.reconciles === true && bc.reconciliation.grand_total === topline);
  ok("class axis: per-class totals", bc.rows[0].total === 150 && bc.rows[3].total === 1500);
  ok("class axis: priced at dominant model", bc.priced_at_model === "claude-opus-4-8");

  const bm = economicsBreakdown(recs, "model", PRICE_PER_MTOK, topline);
  ok("model axis: one row per model, desc by total", bm.rows.length === 2 && bm.rows[0].key === "claude-opus-4-8");
  ok("model axis: rows sum to top-line", bm.reconciliation.grand_total === topline && bm.reconciliation.reconciles === true);
  ok("model axis: prices each row at its own model", Math.abs(bm.rows[0].cost - ((100 * 5 + 10 * 25 + 20 * 6.25 + 1000 * 0.5) / 1e6)) < 1e-9);

  const bday = economicsBreakdown(recs, "day", PRICE_PER_MTOK, topline);
  ok("day axis: chronological ascending", bday.rows.map((r) => r.key).join(",") === "2026-07-01,2026-07-02");
  ok("day axis: reconciles", bday.reconciliation.reconciles === true && bday.reconciliation.grand_total === topline);

  // unpriced model → cost null (distinct from 0); dated-suffix strip; config override
  const up = economicsBreakdown([{ message: { model: "local-llama", usage: { input_tokens: 100 } } }], "model", PRICE_PER_MTOK, 100);
  ok("unpriced model → cost null (not 0)", up.rows.length === 1 && up.rows[0].cost === null && up.rows[0].total === 100);
  ok("dated model-id suffix stripped", JSON.stringify(economicsPriceForModel("claude-opus-4-8-20260101", PRICE_PER_MTOK)) === JSON.stringify(economicsPriceForModel("claude-opus-4-8", PRICE_PER_MTOK)));
  ok("unknown model → null price row", economicsPriceForModel("mystery-model", PRICE_PER_MTOK) === null);
  const pm = resolveEconomicsPriceMap({ budget: { price_per_mtok_by_model: { "claude-opus-4-8": { input: 99, output: 99, cache_write: 99, cache_read: 99 } } } });
  ok("config override wins per-model, built-ins retained", pm["claude-opus-4-8"].input === 99 && pm["claude-sonnet-4-6"].input === 3);
  ok("no override → built-in map (identity)", resolveEconomicsPriceMap({}) === PRICE_PER_MTOK);

  // mcp axis: MEASURED attribution (FAFF-409) + ordering + non-leak
  const mrecs = [
    { message: { model: "claude-opus-4-8", content: [{ type: "tool_use", id: "t1", name: "mcp__linear__get_issue", input: { id: "FAFF-1" } }], usage: { input_tokens: 10 } }, uuid: "u1", timestamp: "2026-07-01T10:00:00Z", sessionId: "s" },
    { message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "SECRET-PAYLOAD-CONTENT" }] }, uuid: "u2", parentUuid: "u1", timestamp: "2026-07-01T10:00:01Z", sessionId: "s" },
    { message: { model: "claude-opus-4-8", usage: { cache_read_input_tokens: 1000 } }, uuid: "u3", parentUuid: "u2", timestamp: "2026-07-01T10:00:02Z", sessionId: "s" },
  ];
  const bmcp = economicsMcpBreakdown(mrecs, PRICE_PER_MTOK, "claude-opus-4-8");
  ok("mcp axis: tool row with call_count / bytes", bmcp.rows.length === 1 && bmcp.rows[0].tool === "linear__get_issue" && bmcp.rows[0].call_count === 1 && bmcp.rows[0].response_bytes > 0);
  ok("mcp axis: measured cache attribution reconciles", bmcp.reconciliation.reconciles === true && bmcp.reconciliation.cache_read_total_billed === 1000);
  ok("mcp axis: MCP gets a measured cache share", bmcp.rows[0].cache_read_measured_tok > 0 && bmcp.reconciliation.mcp_share_tok > 0);
  ok("mcp axis: NON-LEAK — no payload content in output", !JSON.stringify(bmcp).includes("SECRET-PAYLOAD-CONTENT"));

  // --- FAFF-415: effort axis (events.jsonl pivot, priced at dominant model) ---
  const evs = [
    { data: { effort: "high", tokens: { input: 100, output: 50, cache_write: 0, cache_read: 200 }, tokens_source: "transcript" } },
    { data: { effort: "high", tokens: { input: 40, output: 10, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } },
    { data: { effort: "low", tokens: { input: 20, output: 5, cache_write: 0, cache_read: 0 }, tokens_source: "transcript", prompt: "SECRET-EFFORT-PAYLOAD" } }, // stray field must not leak
    { data: { effort: "max", tokens: null, tokens_source: "estimate" } },                 // counted, 0 tokens
    { data: { tokens: { input: 30, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }, // no effort → (none)
    { data: { outcome: "shipped" } },                                                     // no effort, no tokens → skipped
  ];
  const eb = economicsEffortBreakdown(evs, PRICE_PER_MTOK, "claude-opus-4-8", 1000, 0);
  ok("effort axis: source events", eb.source === "events" && eb.axis === "effort");
  ok("effort axis: severity order low<high<max, (none) last", eb.rows.map((r) => r.key).join(",") === "low,high,max,(none)");
  ok("effort axis: high bucket aggregates 2 dispatches + tokens", (() => { const h = eb.rows.find((r) => r.key === "high"); return h.count === 2 && h.input === 140 && h.cache_read === 200 && h.total === 400; })());
  ok("effort axis: estimate-delta dispatch counted, 0 tokens", (() => { const m = eb.rows.find((r) => r.key === "max"); return m.count === 1 && m.total === 0; })());
  ok("effort axis: untagged token-bearing → (none) bucket", (() => { const n = eb.rows.find((r) => r.key === "(none)"); return n.count === 1 && n.total === 30; })());
  ok("effort axis: token-less untagged event skipped", eb.rows.reduce((s, r) => s + r.count, 0) === 5);
  ok("effort axis: priced at dominant model (ESTIMATE)", eb.priced_at_model === "claude-opus-4-8" && eb.cost_basis === "estimate");
  ok("effort axis: high cost = per-class @ opus", Math.abs(eb.rows.find((r) => r.key === "high").cost - ((140 * 5 + 60 * 25 + 200 * 0.5) / 1e6)) < 1e-9);
  ok("effort axis: events_token_total + coverage vs top-line", eb.reconciliation.events_token_total === 455 && eb.reconciliation.coverage_pct === 45.5 && eb.reconciliation.reconciles === false);
  ok("effort axis: NON-LEAK — stray data field never in output", !JSON.stringify(eb).includes("SECRET-EFFORT-PAYLOAD"));
  const ebRe = economicsEffortBreakdown([{ data: { effort: "low", tokens: { input: 1000, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }], PRICE_PER_MTOK, "claude-opus-4-8", 1000, 0);
  ok("effort axis: reconciles when events cover the whole top-line", ebRe.reconciliation.reconciles === true && ebRe.reconciliation.coverage_pct === 100);
  const ebNull = economicsEffortBreakdown([{ data: { effort: "high", tokens: { input: 100, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }], PRICE_PER_MTOK, null, null, 0);
  ok("effort axis: no dominant/top-line → cost null, coverage null, reconciles null (not false)",
    ebNull.rows[0].cost === null && ebNull.priced_at_model === null && ebNull.reconciliation.coverage_pct === null && ebNull.reconciliation.reconciles === null);
  const ebMal = economicsEffortBreakdown([{ data: { effort: "high", tokens: { input: 400, output: 0, cache_write: 0, cache_read: 0 }, tokens_source: "transcript" } }], PRICE_PER_MTOK, "claude-opus-4-8", 1000, 2);
  ok("effort axis: malformed_lines surfaced so low coverage is attributable", ebMal.reconciliation.malformed_lines === 2 && ebMal.reconciliation.coverage_pct === 40);

  console.log(`economics --selftest: ${fail ? "FAIL" : "PASS"} (${fail} failed)`);
  return fail ? 1 : 0;
}


module.exports = { BY_AXES, ECONOMICS_BUCKET_ORDER, ECON_B2T, EFFORT_NONE_KEY, EFFORT_ORDER, PRICE_PER_MTOK, attributePerIssueCosts, cmdEconomics, computeUnitEconomics, econAttributeCacheRead, econBlockSizeChars, econIsCompactBoundary, econOrderLineage, econToLightRecord, economicsAttributeIssue, economicsBreakdown, economicsDayOf, economicsDominantModel, economicsEffortBreakdown, economicsMcpBreakdown, economicsPriceForModel, economicsRowCost, economicsSelftest, economicsTokFromChars, economicsUsageOf, readRunEvents, readRunTranscriptRecords, renderEconomicsBreakdown, resolveEconomicsPriceMap };
