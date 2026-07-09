#!/usr/bin/env node
// FAFF-407 — token-usage breakdown spike (throwaway analysis, read-only).
// FAFF-409 — measured per-tool MCP cache-amplification (replaces the global factor).
//
// Pivots the on-disk Claude Code transcript corpus across four axes
// (time / model / token-class / MCP-per-tool), reconciles the pivot back to
// the flat `sumTranscriptFile` total the faff CLI already trusts, and attributes
// a USD cost to every line item using per-model API pricing.
//
// FAFF-409 adds a fifth pass: it reconstructs each context lineage's resident
// prefix turn-by-turn and splits every billed turn's MEASURED
// `cache_read_input_tokens` across the blocks resident at that turn, pro-rata by
// block size. MCP `tool_result` blocks collect their shares → the measured
// per-tool cache-amplification, reconciling to the billed cache_read total by
// construction. This replaces FAFF-407's single global `cacheAmpFactor` estimate.
//
// The corpus is large, so the walk STREAMS: each raw record is converted to a
// payload-free "light" record (block SIZES + ids only, never payload text) and the
// raw record is dropped — only the light records are retained for attribution.
//
// NON-LEAK INVARIANT (FAFF-407 spec §5): this script emits ONLY counts, sizes,
// names, model-ids and derived costs — never transcript payload content. It reads
// payloads solely to measure their serialized size.
//
// Not a shipped product — the spike's deliverable is the report; this is the means.
// Run: node scripts/token-breakdown.mjs [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- corpus resolution (mirrors faff CLI transcriptBaseDir :2540) --------------
export function transcriptBaseDir(cwd, env) {
  const home = env.HOME || env.USERPROFILE || "";
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const encoded = String(cwd).replace(/\//g, "-");
  return path.join(configDir, "projects", encoded);
}

// The four token classes faff already sums (BUDGET_TOKEN_USAGE_KEYS :2467).
const CLASS_KEYS = ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"];
const CLASS_LABEL = {
  input_tokens: "input",
  output_tokens: "output",
  cache_creation_input_tokens: "cache_write",
  cache_read_input_tokens: "cache_read",
};

// --- pricing (USD per 1M tokens) -----------------------------------------------
// Source: claude-api skill model table (cached 2026-06-24). Cache classes derived
// from the documented caching economics: cache_write = 1.25x input (5-min TTL),
// cache_read = 0.1x input. CONFIGURABLE — swap when rates change. Sonnet 5 has an
// intro rate of $2/$10 input/output through 2026-08-31; the standard rate is used
// here and the intro delta is noted in the report so the figure is a conservative
// (upper-bound) cost. `unknown` model prices at 0 (cannot attribute).
const PRICE_PER_MTOK = {
  "claude-fable-5": { input: 10, output: 50, cache_write: 12.5, cache_read: 1.0 },
  "claude-opus-4-8": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-7": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-6": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-opus-4-5": { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
  "claude-sonnet-5": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-sonnet-4-6": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-sonnet-4-5": { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
};
const ZERO_PRICE = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
function priceFor(model) {
  return PRICE_PER_MTOK[model] || PRICE_PER_MTOK[String(model).replace(/-\d{8}$/, "")] || ZERO_PRICE;
}

// --- the chars/4 proxy (FAFF-175/407 convention — a tokenizer LIBRARY would break
// the repo's zero-dep rule; the proxy error is a near-constant multiplier that
// cancels in the size RATIOS the pro-rata split depends on). Single swap site.
const B2T = 4;                        // bytes -> approx tokens (~chars/4)
export const estTokensFromChars = (chars) => Math.round((chars || 0) / B2T);
const toTok = (bytes) => estTokensFromChars(bytes);

function usageOf(rec) {
  // mirror sumTranscriptFile record selection EXACTLY (FAFF-407 QA fix):
  // ANY record with message.usage or top-level usage, not assistant-only.
  if (rec && rec.message && rec.message.usage && typeof rec.message.usage === "object") return rec.message.usage;
  if (rec && rec.usage && typeof rec.usage === "object") return rec.usage;
  return null;
}

function dayOf(rec) {
  const ts = rec && rec.timestamp;
  if (typeof ts !== "string") return "unknown";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  return m ? m[1] : "unknown";
}

function bucket() { return { input: 0, output: 0, cache_write: 0, cache_read: 0, total: 0, cost: 0 }; }
function addUsage(b, u, price) {
  for (const k of CLASS_KEYS) {
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      const label = CLASS_LABEL[k];
      b[label] += v;
      b.total += v;
      b.cost += (v * price[label]) / 1e6;
    }
  }
}

// ============================ FAFF-409: cache-read attribution ==================
//
// The transcript records a `parentUuid`->`uuid` linked list per session, with
// `isSidechain` separating the main conversation from each subagent sidechain —
// and cache is PER-LINEAGE (a block re-read in the main thread is never re-read in
// a sidechain, and vice-versa). We reconstruct each lineage's resident prefix and
// split each billed turn's MEASURED cache_read across it, pro-rata by block size.

// A compaction boundary rewrites context: blocks before it stop being re-read.
// Claude Code marks it with subtype:"compact_boundary" / isCompactSummary:true
// (NOT stop_hook_summary / away_summary, which are unrelated system records).
function isCompactBoundary(rec) {
  if (!rec || typeof rec !== "object") return false;
  if (rec.isCompactSummary === true) return true;
  if (typeof rec.subtype === "string" && rec.subtype === "compact_boundary") return true;
  return false;
}

// One MCP tool_use id -> bare tool name (a tool_use and its tool_result can
// straddle records). Bare name = mcp__ prefix stripped. Exported for tests.
export function buildIdToTool(rawRecords) {
  const idToTool = new Map();
  for (const rec of rawRecords) indexToolUse(rec, idToTool);
  return idToTool;
}
function indexToolUse(rec, idToTool) {
  const content = rec && rec.message && rec.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && block.type === "tool_use" && typeof block.id === "string"
        && typeof block.name === "string" && block.name.startsWith("mcp__")) {
      idToTool.set(block.id, block.name.replace(/^mcp__/, ""));
    }
  }
}

// Serialized size of ONE content block, in chars (payload read for size ONLY).
function blockSizeChars(block) {
  if (!block || typeof block !== "object") return 0;
  if (block.type === "tool_result") {
    const c = block.content;
    try { return typeof c === "string" ? c.length : JSON.stringify(c ?? "").length; } catch { return 0; }
  }
  if (block.type === "text") return typeof block.text === "string" ? block.text.length : 0;
  if (block.type === "thinking") return typeof block.thinking === "string" ? block.thinking.length : 0;
  try { return JSON.stringify(block).length; } catch { return 0; }
}

// Turn a raw record into the light shape the attribution walk needs — NO payload
// retained, only sizes/ids/flags. `idx` is the global file-append order (the
// terminal ordering fallback). Each block carries its `tool_use_id` so
// `resolveMcpTools` can set `mcp_tool` once the corpus-wide id-map is complete.
export function toLightRecord(rec, idx) {
  const sessionId = (rec && typeof rec.sessionId === "string" && rec.sessionId) || "unknown-session";
  const isSidechain = !!(rec && rec.isSidechain);
  const u = usageOf(rec);
  const cacheRead = u && typeof u.cache_read_input_tokens === "number" && Number.isFinite(u.cache_read_input_tokens)
    ? u.cache_read_input_tokens : null;
  const blocks = [];
  const content = rec && rec.message && rec.message.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const size_tok = estTokensFromChars(blockSizeChars(block));
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
    cacheRead: cacheRead === null ? 0 : cacheRead,
    isBoundary: isCompactBoundary(rec),
    blocks,
  };
}

// Resolve each tool_result block's mcp_tool from the completed id-map. A
// tool_result whose id has no mcp tool_use stays mcp_tool=null (non-MCP residual,
// never dropped). Exported for tests.
export function resolveMcpTools(lightRecords, idToTool) {
  for (const r of lightRecords) {
    for (const b of r.blocks) {
      if (b.tool_use_id) b.mcp_tool = idToTool.get(b.tool_use_id) || null;
    }
  }
  return lightRecords;
}

// Order a lineage's records by the parentUuid chain; fall back to timestamp on a
// broken link, then to file order (idx). Stable, cycle-safe.
export function orderLineage(recs) {
  const byUuid = new Map();
  for (const r of recs) if (r.uuid) byUuid.set(r.uuid, r);
  const childOf = new Map();
  const roots = [];
  for (const r of recs) {
    if (r.parentUuid && byUuid.has(r.parentUuid) && r.parentUuid !== r.uuid) {
      if (!childOf.has(r.parentUuid)) childOf.set(r.parentUuid, []);
      childOf.get(r.parentUuid).push(r);
    } else {
      roots.push(r);
    }
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
  for (const r of recs) if (!seen.has(r)) ordered.push(r); // safety: any unseen (cycle)
  return ordered;
}

// Attribute billed cache_read across resident blocks, pro-rata by size, PER LINEAGE.
// mode: "detect" (clear on a detected compaction boundary — the primary rule),
//       "lenient" (never clear — resident from first-seen to lineage end),
//       "aggressive" (clear on a boundary OR a >50% cache_read drop vs the prior
//                     billed turn — an eviction proxy). detect/lenient/aggressive
//       bound the one fact the transcript omits (which blocks were resident), and
//       their spread is the reported boundary-sensitivity range.
// `lightRecords` must already have mcp_tool resolved (resolveMcpTools).
export function attributeCacheRead(lightRecords, { mode = "detect" } = {}) {
  const byLineage = new Map();
  for (const r of lightRecords) {
    if (!byLineage.has(r.lineage)) byLineage.set(r.lineage, []);
    byLineage.get(r.lineage).push(r);
  }
  const perTool = new Map();          // bare tool name -> attributed cache_read (float)
  let cacheReadTotalBilled = 0;
  let cacheReadAttributed = 0;        // mcp + non-mcp shares
  let mcpShare = 0;
  let nonmcpShare = 0;
  let unattributed = 0;               // billed cr on an empty reconstructed prefix

  for (const recs of byLineage.values()) {
    const ordered = orderLineage(recs);
    let resident = [];                // { size_tok, mcp_tool }
    let residentWeight = 0;
    let prevCr = 0;
    for (const rec of ordered) {
      // Boundary eviction happens BEFORE this turn's attribution.
      if (rec.isBoundary && mode !== "lenient") { resident = []; residentWeight = 0; }
      if (rec.billed) {
        const cr = rec.cacheRead;
        if (mode === "aggressive" && prevCr > 0 && cr > 0 && cr < prevCr * 0.5) {
          resident = []; residentWeight = 0;   // sharp drop => assume eviction
        }
        if (cr > 0) {
          cacheReadTotalBilled += cr;
          if (residentWeight > 0) {
            for (const b of resident) {
              const share = cr * (b.size_tok / residentWeight);
              cacheReadAttributed += share;
              if (b.mcp_tool) {
                mcpShare += share;
                perTool.set(b.mcp_tool, (perTool.get(b.mcp_tool) || 0) + share);
              } else {
                nonmcpShare += share;
              }
            }
          } else {
            unattributed += cr;        // empty prefix: reported explicitly, never smeared
          }
          prevCr = cr;
        }
      }
      // The record's own blocks enter the prefix for SUBSEQUENT turns.
      for (const b of rec.blocks) {
        if (b.size_tok > 0) { resident.push(b); residentWeight += b.size_tok; }
      }
    }
  }

  // `reconciles` is the TRUE algorithm check: did every billed turn's cr get fully
  // partitioned across its resident prefix (or fall to unattributed)? Checked on
  // the floats, with tolerance for FP error.
  const reconciles = Math.abs((cacheReadAttributed + unattributed) - cacheReadTotalBilled)
    <= Math.max(1, cacheReadTotalBilled * 1e-9);
  // Integer reporting fields are made exact-by-construction (no ±1 rounding drift):
  // billed is integer; unattributed and mcp_share round independently; nonmcp_share
  // is the RESIDUAL (its spec definition), so the identities
  //   mcp + nonmcp + unattributed == billed   and   attributed + unattributed == billed
  // hold exactly.
  const unattributedInt = Math.round(unattributed);
  const mcpShareInt = Math.round(mcpShare);
  const nonmcpShareInt = cacheReadTotalBilled - unattributedInt - mcpShareInt;
  return {
    perTool,                          // Map<bareName, float attributed>
    cache_read_total_billed: cacheReadTotalBilled,
    cache_read_attributed: mcpShareInt + nonmcpShareInt,   // == billed - unattributed
    unattributed: unattributedInt,
    mcp_share_tok: mcpShareInt,
    nonmcp_share_tok: nonmcpShareInt,
    reconciles,
  };
}

// Full attribution over raw records (small inputs / tests): builds the id-map +
// light records, resolves, then runs all three boundary modes.
export function analyzeCacheAttribution(rawRecords) {
  const idToTool = buildIdToTool(rawRecords);
  const light = resolveMcpTools(rawRecords.map((rec, i) => toLightRecord(rec, i)), idToTool);
  return attributeThreeModes(light, idToTool);
}
function attributeThreeModes(light) {
  return {
    primary: attributeCacheRead(light, { mode: "detect" }),
    lenient: attributeCacheRead(light, { mode: "lenient" }),
    aggressive: attributeCacheRead(light, { mode: "aggressive" }),
  };
}

// ============================ the analysis =====================================
// Single-pass over an iterable of raw records. Retains ONLY payload-free light
// records + accumulators (never the raw payloads), so it is safe over the full
// corpus when fed a streaming generator.
export function analyze(rawRecords) {
  const grand = bucket();
  const byDay = new Map();
  const byModel = new Map();
  const byClass = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  const byClassCost = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
  let flatReconcile = 0;
  let recordsWithUsage = 0;
  let recordsMissingModel = 0;
  const modelCallCount = new Map();

  const idToTool = new Map();
  const mcpTools = new Map();          // bare name -> { call_count, request_bytes, response_bytes }
  const pendingResults = [];           // { id, size } tool_results, resolved after the pass
  const light = [];                    // payload-free records for attribution

  let idx = 0;
  for (const rec of rawRecords) {
    // (a) light record for attribution (drops payload)
    light.push(toLightRecord(rec, idx++));

    // (b) MCP one-time payload census + id-map
    const content = rec && rec.message && rec.message.content;
    if (Array.isArray(content)) {
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

    // (c) token-class / model / day accumulation
    const u = usageOf(rec);
    if (!u) continue;
    recordsWithUsage++;
    const model = (rec.message && typeof rec.message.model === "string" && rec.message.model) || "unknown";
    if (model === "unknown") recordsMissingModel++;
    modelCallCount.set(model, (modelCallCount.get(model) || 0) + 1);
    const price = priceFor(model);
    const day = dayOf(rec);
    for (const k of CLASS_KEYS) {
      const v = u[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        flatReconcile += v;
        const label = CLASS_LABEL[k];
        byClass[label] += v;
        byClassCost[label] += (v * price[label]) / 1e6;
      }
    }
    addUsage(grand, u, price);
    if (!byDay.has(day)) byDay.set(day, bucket());
    addUsage(byDay.get(day), u, price);
    if (!byModel.has(model)) byModel.set(model, bucket());
    addUsage(byModel.get(model), u, price);
  }

  // resolve one-time tool_result sizes to their tool
  for (const { id, size } of pendingResults) {
    const bare = idToTool.get(id);
    if (!bare) continue;
    const t = mcpTools.get(bare) || { call_count: 0, request_bytes: 0, response_bytes: 0 };
    t.response_bytes += size;
    mcpTools.set(bare, t);
  }

  // FAFF-407 global-factor estimate (retained for contrast, labelled superseded)
  const denom = byClass.input + byClass.cache_write;
  const cacheAmpFactor = denom > 0 ? byClass.cache_read / denom : 0;
  const dominantModel = [...modelCallCount.entries()].filter(([m]) => m !== "unknown")
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "claude-opus-4-8";
  const mcpPrice = priceFor(dominantModel);

  // FAFF-409 measured attribution (resolve mcp_tool, then all three boundary modes)
  resolveMcpTools(light, idToTool);
  const attr = attributeThreeModes(light);
  const measured = attr.primary;
  const measuredPerTool = new Map();
  for (const [k, v] of measured.perTool) measuredPerTool.set(k, Math.round(v));

  const mcpRows = [...mcpTools.entries()].map(([name, t]) => {
    const req = toTok(t.request_bytes);
    const resp = toTok(t.response_bytes);
    const measuredCr = measuredPerTool.get(name) || 0;             // MEASURED, not response*factor
    const cacheEstGlobal = Math.round(resp * cacheAmpFactor);      // FAFF-407 estimate, kept for contrast
    const total = req + measuredCr + resp;
    const ampRatio = resp > 0 ? measuredCr / resp : 0;             // PER-TOOL amplification, not global
    const cost = (req * mcpPrice.input + resp * mcpPrice.input + measuredCr * mcpPrice.cache_read) / 1e6;
    return {
      tool: name,
      call_count: t.call_count,
      request_tok: req,
      response_tok: resp,
      cache_read_measured_tok: measuredCr,
      amplification_ratio: Number(ampRatio.toFixed(2)),
      cache_est_global_tok: cacheEstGlobal,
      total_tok: total,
      cost_est_usd: Number(cost.toFixed(4)),
    };
  }).sort((a, b) => b.cache_read_measured_tok - a.cache_read_measured_tok || b.total_tok - a.total_tok);

  const shareOf = (a) => (a.cache_read_total_billed > 0 ? a.mcp_share_tok / a.cache_read_total_billed : 0);
  const shares = [shareOf(attr.primary), shareOf(attr.lenient), shareOf(attr.aggressive)];
  const rangeLo = Math.min(...shares);
  const rangeHi = Math.max(...shares);

  return {
    corpus: { records_with_usage: recordsWithUsage, records_missing_model: recordsMissingModel },
    pricing: { source: "claude-api skill (cached 2026-06-24); cache_write=1.25x input, cache_read=0.1x input", per_mtok: PRICE_PER_MTOK },
    reconciliation: { grand_total: grand.total, flat_sum: flatReconcile, reconciles: grand.total === flatReconcile },
    grand,
    by_class: { input: byClass.input, output: byClass.output, cache_write: byClass.cache_write, cache_read: byClass.cache_read, cost: byClassCost },
    by_model: [...byModel.entries()].map(([model, b]) => ({ model, ...b })).sort((a, b) => b.cost - a.cost),
    by_day: [...byDay.entries()].map(([day, b]) => ({ day, ...b })).sort((a, b) => a.day.localeCompare(b.day)),
    mcp: {
      // FAFF-409: measured per-tool cache-amplification (the global factor below
      // is SUPERSEDED — kept only for contrast in the report).
      superseded_global_cache_amp_factor: Number(cacheAmpFactor.toFixed(2)),
      priced_at_model: dominantModel,
      tools_invoked: mcpRows.length,
      total_calls: mcpRows.reduce((s, r) => s + r.call_count, 0),
      total_cost_est_usd: Number(mcpRows.reduce((s, r) => s + r.cost_est_usd, 0).toFixed(2)),
      reconciliation: {
        cache_read_total_billed: measured.cache_read_total_billed,
        cache_read_attributed: measured.cache_read_attributed,
        unattributed: measured.unattributed,
        mcp_share_tok: measured.mcp_share_tok,
        nonmcp_share_tok: measured.nonmcp_share_tok,
        reconciles: measured.reconciles,
        mcp_share_pct: Number((100 * shareOf(measured)).toFixed(3)),
        mcp_share_range_pct: { lo: Number((100 * rangeLo).toFixed(3)), hi: Number((100 * rangeHi).toFixed(3)) },
        boundary_modes: {
          detect: { mcp_share_tok: attr.primary.mcp_share_tok, unattributed: attr.primary.unattributed },
          lenient: { mcp_share_tok: attr.lenient.mcp_share_tok, unattributed: attr.lenient.unattributed },
          aggressive: { mcp_share_tok: attr.aggressive.mcp_share_tok, unattributed: attr.aggressive.unattributed },
        },
      },
      per_tool: mcpRows,
    },
  };
}

// ============================ I/O main (guarded) ================================
// Stream records file-by-file, line-by-line, yielding one raw record at a time so
// the caller (analyze) can drop each payload after converting it to light form.
// `stats` (optional) accumulates corpus-quality counts — unreadable files and
// unparseable lines are SKIPPED (a corrupt line never aborts the walk) but COUNTED,
// so a partial read is visible in the output rather than silently looking complete.
function* streamRecords(base, stats = { files_unreadable: 0, parse_errors: 0 }) {
  const files = fs.readdirSync(base).filter((f) => f.endsWith(".jsonl"));
  for (const name of files) {
    let text;
    try { text = fs.readFileSync(path.join(base, name), "utf8"); } catch { stats.files_unreadable++; continue; }
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let rec;
      try { rec = JSON.parse(s); } catch { stats.parse_errors++; continue; }
      yield rec;
    }
    text = null; // release the file buffer before the next file
  }
}
function countFiles(base) {
  return fs.readdirSync(base).filter((f) => f.endsWith(".jsonl")).length;
}

function main(argv) {
  const base = transcriptBaseDir(process.cwd(), process.env);
  const wantJson = argv.includes("--json");
  if (!fs.existsSync(base)) {
    console.error(`no transcript corpus at ${base} — nothing to analyse`);
    return 2;
  }
  const stats = { files_unreadable: 0, parse_errors: 0 };
  const result = analyze(streamRecords(base, stats));
  result.corpus.base = base;
  result.corpus.files_read = countFiles(base);
  result.corpus.files_unreadable = stats.files_unreadable;   // corpus-quality: skipped-but-counted
  result.corpus.parse_errors = stats.parse_errors;

  if (wantJson) { console.log(JSON.stringify(result, null, 2)); return 0; }

  // --- human report ------------------------------------------------------------
  const grand = result.grand;
  const byClass = result.by_class;
  const byClassCost = byClass.cost;
  const M = (n) => (n / 1e6).toFixed(1) + "M";
  const pct = (n) => grand.total ? ((100 * n) / grand.total).toFixed(1) + "%" : "—";
  const usd = (n) => "$" + n.toFixed(2);
  console.log(`\n# Token-usage breakdown — ${result.corpus.files_read} files, ${result.corpus.records_with_usage} usage records`);
  console.log(`corpus: ${base}`);
  console.log(`RECONCILES: ${result.reconciliation.reconciles} (grand=${grand.total} flat=${result.reconciliation.flat_sum})`);
  console.log(`GRAND TOTAL: ${M(grand.total)} tokens  ·  ${usd(grand.cost)}\n`);

  console.log(`## By token-class`);
  for (const k of ["input", "output", "cache_write", "cache_read"]) {
    console.log(`  ${k.padEnd(11)} ${M(byClass[k]).padStart(8)}  ${pct(byClass[k]).padStart(7)}  ${usd(byClassCost[k]).padStart(9)}`);
  }
  console.log(`\n## By model`);
  for (const r of result.by_model) console.log(`  ${r.model.padEnd(22)} ${M(r.total).padStart(8)}  ${pct(r.total).padStart(7)}  ${usd(r.cost).padStart(9)}`);

  console.log(`\n## By day`);
  for (const r of result.by_day) console.log(`  ${r.day}  ${M(r.total).padStart(8)}  ${pct(r.total).padStart(7)}  ${usd(r.cost).padStart(9)}`);

  const rc = result.mcp.reconciliation;
  console.log(`\n## MCP per-tool cache-amplification (MEASURED — FAFF-409)`);
  console.log(`   ${result.mcp.tools_invoked} tools, ${result.mcp.total_calls} calls · cache_read attribution reconciles: ${rc.reconciles}`);
  console.log(`   billed cache_read=${M(rc.cache_read_total_billed)}  attributed=${M(rc.cache_read_attributed)}  unattributed=${M(rc.unattributed)}`);
  console.log(`   MCP measured share of cache_read: ${rc.mcp_share_pct}%  (range ${rc.mcp_share_range_pct.lo}%–${rc.mcp_share_range_pct.hi}% across compaction-boundary rules)`);
  console.log(`   non-MCP (model/context) share: ${M(rc.nonmcp_share_tok)} (${(100 * rc.nonmcp_share_tok / (rc.cache_read_total_billed || 1)).toFixed(1)}%)`);
  console.log(`   (~tokens = bytes/4; measured cache_read priced at ${result.mcp.priced_at_model}; superseded global factor was ×${result.mcp.superseded_global_cache_amp_factor})`);
  console.log(`   ${"tool".padEnd(30)} ${"calls".padStart(6)} ${"request".padStart(9)} ${"response".padStart(9)} ${"cache_read~".padStart(11)} ${"amp".padStart(6)} ${"cost~".padStart(8)}`);
  for (const r of result.mcp.per_tool) {
    console.log(`   ${r.tool.slice(0, 30).padEnd(30)} ${String(r.call_count).padStart(6)} ${r.request_tok.toString().padStart(9)} ${r.response_tok.toString().padStart(9)} ${r.cache_read_measured_tok.toString().padStart(11)} ${("×" + r.amplification_ratio).padStart(6)} ${usd(r.cost_est_usd).padStart(8)}`);
  }
  console.log("");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
