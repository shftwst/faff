#!/usr/bin/env node
// FAFF-407 — token-usage breakdown spike (throwaway analysis, read-only).
//
// Pivots the on-disk Claude Code transcript corpus across four axes
// (time / model / token-class / MCP-per-tool), reconciles the pivot back to
// the flat `sumTranscriptFile` total the faff CLI already trusts, and attributes
// a USD cost to every line item using per-model API pricing.
//
// NON-LEAK INVARIANT (FAFF-407 spec §5): this script emits ONLY counts, sizes,
// names, model-ids and derived costs — never transcript payload content. It reads
// payloads solely to measure their serialized size.
//
// Not a shipped product — the spike's deliverable is the report; this is the means.
// Run: node scripts/token-breakdown.mjs [--json]

import fs from "node:fs";
import path from "node:path";

// --- corpus resolution (mirrors faff CLI transcriptBaseDir :2540) --------------
function transcriptBaseDir(cwd, env) {
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

// --- accumulators --------------------------------------------------------------
const grand = bucket();
const byDay = new Map();     // day -> bucket
const byModel = new Map();   // model -> bucket
const byClass = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
const byClassCost = { input: 0, output: 0, cache_write: 0, cache_read: 0 };
let flatReconcile = 0;
let recordsWithUsage = 0;
let recordsMissingModel = 0;
const modelCallCount = new Map();

// MCP per-tool cost: name -> { call_count, request_bytes, response_bytes }
const mcpTools = new Map();

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

// Map tool_use_id -> mcp tool name, then attribute tool_result size.
const idToTool = new Map();
const pendingResults = [];
function indexToolUseIds(rec) {
  const content = rec && rec.message && rec.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (block && block.type === "tool_use" && typeof block.id === "string"
        && typeof block.name === "string" && block.name.startsWith("mcp__")) {
      idToTool.set(block.id, block.name);
    }
  }
}
function scanMcpBlocks(rec) {
  const content = rec && rec.message && rec.message.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "tool_use" && typeof block.name === "string" && block.name.startsWith("mcp__")) {
      const t = mcpTools.get(block.name) || { call_count: 0, request_bytes: 0, response_bytes: 0 };
      t.call_count += 1;
      try { t.request_bytes += JSON.stringify(block.input ?? {}).length; } catch { /* size only */ }
      mcpTools.set(block.name, t);
    } else if (block.type === "tool_result") {
      const id = block.tool_use_id;
      let size = 0;
      try { size = typeof block.content === "string" ? block.content.length : JSON.stringify(block.content ?? "").length; } catch { size = 0; }
      pendingResults.push({ id, size });
    }
  }
}

// --- walk the corpus -----------------------------------------------------------
const base = transcriptBaseDir(process.cwd(), process.env);
const wantJson = process.argv.includes("--json");
if (!fs.existsSync(base)) {
  console.error(`no transcript corpus at ${base} — nothing to analyse`);
  process.exit(2);
}
const files = fs.readdirSync(base).filter((f) => f.endsWith(".jsonl"));
let fileCount = 0;
for (const name of files) {
  let text;
  try { text = fs.readFileSync(path.join(base, name), "utf8"); } catch { continue; }
  fileCount++;
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let rec;
    try { rec = JSON.parse(s); } catch { continue; }
    indexToolUseIds(rec);
    scanMcpBlocks(rec);
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
}

for (const { id, size } of pendingResults) {
  const toolName = idToTool.get(id);
  if (!toolName) continue;
  const t = mcpTools.get(toolName) || { call_count: 0, request_bytes: 0, response_bytes: 0 };
  t.response_bytes += size;
  mcpTools.set(toolName, t);
}

// --- cache-amplification factor (ESTIMATE — telemetry gap) ----------------------
const denom = byClass.input + byClass.cache_write;
const cacheAmpFactor = denom > 0 ? byClass.cache_read / denom : 0;
const B2T = 4;                       // bytes -> approx tokens (~chars/4)
const toTok = (bytes) => Math.round(bytes / B2T);

// MCP cost is priced at the DOMINANT model's rates (estimate): request+cache land
// as input on the following turn, so both use input rate; response likewise.
const dominantModel = [...modelCallCount.entries()].filter(([m]) => m !== "unknown")
  .sort((a, b) => b[1] - a[1])[0]?.[0] || "claude-opus-4-8";
const mcpPrice = priceFor(dominantModel);

const mcpRows = [...mcpTools.entries()].map(([name, t]) => {
  const req = toTok(t.request_bytes);
  const resp = toTok(t.response_bytes);
  const cacheEst = Math.round(resp * cacheAmpFactor);
  const total = req + cacheEst + resp;
  // request+cache re-read as input; response also lands as input next turn.
  const cost = (req * mcpPrice.input + cacheEst * mcpPrice.cache_read + resp * mcpPrice.input) / 1e6;
  return {
    tool: name.replace(/^mcp__/, ""),
    call_count: t.call_count,
    request_tok: req, cache_est_tok: cacheEst, response_tok: resp, total_tok: total,
    cost_est_usd: Number(cost.toFixed(4)),
  };
}).sort((a, b) => b.total_tok - a.total_tok);

const result = {
  corpus: { base, files_read: fileCount, records_with_usage: recordsWithUsage, records_missing_model: recordsMissingModel },
  pricing: { source: "claude-api skill (cached 2026-06-24); cache_write=1.25x input, cache_read=0.1x input", per_mtok: PRICE_PER_MTOK },
  reconciliation: { grand_total: grand.total, flat_sum: flatReconcile, reconciles: grand.total === flatReconcile },
  grand,
  by_class: { input: byClass.input, output: byClass.output, cache_write: byClass.cache_write, cache_read: byClass.cache_read, cost: byClassCost },
  by_model: [...byModel.entries()].map(([model, b]) => ({ model, ...b })).sort((a, b) => b.cost - a.cost),
  by_day: [...byDay.entries()].map(([day, b]) => ({ day, ...b })).sort((a, b) => a.day.localeCompare(b.day)),
  mcp: {
    cache_amp_factor: Number(cacheAmpFactor.toFixed(2)),
    priced_at_model: dominantModel,
    tools_invoked: mcpRows.length,
    total_calls: mcpRows.reduce((s, r) => s + r.call_count, 0),
    total_cost_est_usd: Number(mcpRows.reduce((s, r) => s + r.cost_est_usd, 0).toFixed(2)),
    per_tool: mcpRows,
  },
};

if (wantJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

// --- human report --------------------------------------------------------------
const M = (n) => (n / 1e6).toFixed(1) + "M";
const pct = (n) => grand.total ? ((100 * n) / grand.total).toFixed(1) + "%" : "—";
const usd = (n) => "$" + n.toFixed(2);
console.log(`\n# Token-usage breakdown — ${result.corpus.files_read} files, ${recordsWithUsage} usage records`);
console.log(`corpus: ${base}`);
console.log(`RECONCILES: ${result.reconciliation.reconciles} (grand=${grand.total} flat=${flatReconcile})`);
console.log(`GRAND TOTAL: ${M(grand.total)} tokens  ·  ${usd(grand.cost)}\n`);

console.log(`## By token-class`);
for (const k of ["input", "output", "cache_write", "cache_read"]) {
  console.log(`  ${k.padEnd(11)} ${M(byClass[k]).padStart(8)}  ${pct(byClass[k]).padStart(7)}  ${usd(byClassCost[k]).padStart(9)}`);
}
console.log(`\n## By model`);
for (const r of result.by_model) console.log(`  ${r.model.padEnd(22)} ${M(r.total).padStart(8)}  ${pct(r.total).padStart(7)}  ${usd(r.cost).padStart(9)}`);

console.log(`\n## By day`);
for (const r of result.by_day) console.log(`  ${r.day}  ${M(r.total).padStart(8)}  ${pct(r.total).padStart(7)}  ${usd(r.cost).padStart(9)}`);

console.log(`\n## MCP per-tool  (~tokens = bytes/4; cache col + cost are ESTIMATES, priced at ${result.mcp.priced_at_model}, ×${result.mcp.cache_amp_factor})`);
console.log(`   ${result.mcp.tools_invoked} tools, ${result.mcp.total_calls} calls, est ${usd(result.mcp.total_cost_est_usd)}`);
console.log(`   ${"tool".padEnd(30)} ${"calls".padStart(6)} ${"input".padStart(9)} ${"cache~".padStart(9)} ${"response".padStart(9)} ${"total".padStart(9)} ${"cost~".padStart(8)}`);
for (const r of result.mcp.per_tool) {
  console.log(`   ${r.tool.slice(0, 30).padEnd(30)} ${String(r.call_count).padStart(6)} ${r.request_tok.toString().padStart(9)} ${r.cache_est_tok.toString().padStart(9)} ${r.response_tok.toString().padStart(9)} ${r.total_tok.toString().padStart(9)} ${usd(r.cost_est_usd).padStart(8)}`);
}
console.log("");
