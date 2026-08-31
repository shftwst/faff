// Tokenomics — the RUNTIME per-call context cost of a real drive run, and a bench for evaluating
// prompt/skill CACHING strategies against it. The sibling `size-census.mjs` measures the STATIC
// size of the SKILL.md files on disk (FAFF-170/171); this measures what the run actually re-read
// from cache on every API call, which is the figure the jot P1 flagged: cost is dominated by the
// SIZE of the cached context re-read per call (~115-220k tokens), not call count or cache churn.
//
// Two halves, mirroring size-census:
//   - MEASUREMENT (free, deterministic, no model call): parse a Claude Code transcript's `usage`
//     fields into a per-call workload, then a census (cache_read / cache_write / output
//     distribution, read:write ratio, context-vs-output share).
//   - BENCH: hold that real workload fixed and re-price it under a caching STRATEGY (shrink the
//     injected gateway/skill prefix; drop it; change cache TTL). Each strategy is a pure transform
//     of the per-call workload, so its dollar delta vs the baseline is a grounded counterfactual —
//     "what this run would have cost if the fixed prefix were N tokens instead of what it was".
//
// Zero-dependency (node builtins + estimateTokens, the chars/4 proxy) to match the eval/ convention.
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateTokens } from "./cli-driver.mjs"; // reuse the chars/4 proxy, do not redefine

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
export const GATEWAY_SKILL = join(REPO_ROOT, "plugin", "skills", "faff", "SKILL.md");

// --- Pricing (per MTok, list rates; see docs/reference and the claude-api skill) ---------------
// Sonnet 5 introductory pricing ($2/$10 through 2026-08-31) is available via RATES override; the
// stable list figure ($3/$15) is the default so the bench doesn't drift when the intro window ends.
export const RATES = {
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-opus-5": { in: 5.0, out: 25.0 },
  "claude-opus-4-7": { in: 5.0, out: 25.0 },
  "claude-sonnet-5": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 1.0, out: 5.0 },
};
const DEFAULT_RATE = { in: 5.0, out: 25.0 };
// Cache multipliers against base input price (prompt-caching.md): read ~0.1x, 5m write 1.25x, 1h write 2x.
export const CACHE_MULT = { read: 0.1, write_5m: 1.25, write_1h: 2.0 };
export const rateFor = (model, rates = RATES) => rates[model] || DEFAULT_RATE;

// --- PARSE — transcript `usage` fields → per-call workload -------------------------------------
// A Claude Code transcript streams several assistant lines per API call (one per content block),
// all sharing a request_id and carrying the SAME cache/input usage; output_tokens is only correct
// on the final line. So dedupe by request_id and take the MAX of each field. Returns one row per
// real API call in first-seen order.
export function parseTranscript(text) {
  const agg = new Map();
  const order = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (o.type !== "assistant") continue;
    const msg = o.message || {};
    const rid = o.request_id || msg.id;
    if (!rid) continue;
    const u = msg.usage || {};
    const cc = u.cache_creation || {};
    let call = agg.get(rid);
    if (!call) {
      call = { rid, model: msg.model || "unknown", cr: 0, cw: 0, cw1h: 0, cw5m: 0, in: 0, out: 0, subagent: !!o.parent_tool_use_id, session: o.session_id || "?", ts: o.timestamp ? Date.parse(o.timestamp) : null };
      agg.set(rid, call);
      order.push(rid);
    } else if (o.timestamp) {
      const t = Date.parse(o.timestamp);
      if (call.ts == null || t < call.ts) call.ts = t;
    }
    call.cr = Math.max(call.cr, u.cache_read_input_tokens || 0);
    call.cw = Math.max(call.cw, u.cache_creation_input_tokens || 0);
    call.cw1h = Math.max(call.cw1h, cc.ephemeral_1h_input_tokens || 0);
    call.cw5m = Math.max(call.cw5m, cc.ephemeral_5m_input_tokens || 0);
    call.in = Math.max(call.in, u.input_tokens || 0);
    call.out = Math.max(call.out, u.output_tokens || 0);
  }
  return order.map((r) => agg.get(r));
}

// Read a transcript file, or every *.jsonl under a directory (drive + subagent transcripts), into
// one flat call list. PURE except the read fn (injectable for tests).
export function loadCalls(path, read = readFileSync, listdir = readdirSync, stat = statSync) {
  const files = stat(path).isDirectory() ? jsonlFiles(path, listdir, stat) : [path];
  return files.flatMap((f) => parseTranscript(read(f, "utf8")));
}
export function loadAnchors(path, read = readFileSync, listdir = readdirSync, stat = statSync) {
  const files = stat(path).isDirectory() ? jsonlFiles(path, listdir, stat) : [path];
  return files.flatMap((f) => parseAnchors(read(f, "utf8")));
}
function jsonlFiles(dir, listdir, stat) {
  const out = [];
  for (const name of listdir(dir)) {
    const p = join(dir, name);
    if (stat(p).isDirectory()) out.push(...jsonlFiles(p, listdir, stat));
    else if (name.endsWith(".jsonl")) out.push(p);
  }
  return out.sort();
}

// --- CENSUS — the measurement half (PURE, no model call) --------------------------------------
const round = (x) => Math.round(x * 1000) / 1000;
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  return { n, sum, avg: n ? round(sum / n) : 0, median: n ? s[Math.floor(n / 2)] : 0, max: n ? s[n - 1] : 0 };
}
export function census(calls) {
  const cr = stats(calls.map((c) => c.cr));
  const cw = stats(calls.map((c) => c.cw));
  const inp = stats(calls.map((c) => c.in));
  const out = stats(calls.map((c) => c.out));
  const context = cr.sum + cw.sum + inp.sum;
  const total = context + out.sum;
  const models = {};
  for (const c of calls) models[c.model] = (models[c.model] || 0) + 1;
  return {
    calls: calls.length,
    models,
    cache_read: cr,
    cache_write: cw,
    input: inp,
    output: out,
    read_write_ratio: cw.sum ? round(cr.sum / cw.sum) : null,
    context_tokens: context,
    output_tokens: out.sum,
    context_share_pct: total ? round((100 * context) / total) : 0,
    // output_tokens is unreliable in some transcripts (only the final streamed line carries the
    // real count; if that line is absent every call reads ~2-8). Flag it so the bill's output leg
    // is read as a floor, not a measurement — the cost driver is context either way.
    output_suspect: calls.length > 0 && out.sum / calls.length < 25,
  };
}

// --- BILL — price a workload under a rate table ------------------------------------------------
export function billCalls(calls, rates = RATES) {
  let cost = 0;
  const byModel = {};
  const legs = { read: 0, write: 0, input: 0, output: 0 };
  for (const c of calls) {
    const r = rateFor(c.model, rates);
    const pin = r.in / 1e6;
    const pout = r.out / 1e6;
    const cwOther = Math.max(0, c.cw - c.cw1h - c.cw5m); // un-bucketed writes → treat as 1h (observed default)
    const read = c.cr * CACHE_MULT.read * pin;
    const write = (c.cw1h + cwOther) * CACHE_MULT.write_1h * pin + c.cw5m * CACHE_MULT.write_5m * pin;
    const input = c.in * pin;
    const output = c.out * pout;
    const cCost = read + write + input + output;
    cost += cCost;
    byModel[c.model] = round((byModel[c.model] || 0) + cCost);
    legs.read += read; legs.write += write; legs.input += input; legs.output += output;
  }
  return { cost: round(cost), byModel, legs: { read: round(legs.read), write: round(legs.write), input: round(legs.input), output: round(legs.output) } };
}

// --- STRATEGIES — pure transforms of the workload ---------------------------------------------
// Shrink the fixed injected prefix (gateway/skill content carried in every call's context) from F
// to Fp tokens. A given call either READS the cached prefix (cr >= F) or WROTE it cold this call
// (cw >= F); shrink whichever leg carries it. Reads dominate, so this is where the money is.
export function applyPrefixShrink(calls, F, Fp) {
  const dF = Math.max(0, F - Fp);
  if (dF === 0) return calls.map((c) => ({ ...c }));
  return calls.map((c) => {
    const n = { ...c };
    if (c.cr >= F) {
      n.cr = c.cr - dF; // warm call: fixed prefix is in the cached read
    } else if (c.cw >= F) {
      const scale = (c.cw - dF) / c.cw; // cold call: fixed prefix was written this turn
      n.cw = c.cw - dF;
      n.cw1h = Math.round(c.cw1h * scale);
      n.cw5m = Math.round(c.cw5m * scale);
    }
    return n;
  });
}
// Reprice 1h cache writes as 5m (1.25x instead of 2x). CAVEAT: a shorter TTL can lower the cache
// hit rate on bursty/idle runs, which this cannot see from usage alone — it models the write-cost
// change only, holding hit rate fixed. Treat as an upper bound on the TTL saving.
export function apply5mWrites(calls) {
  return calls.map((c) => ({ ...c, cw5m: (c.cw5m || 0) + (c.cw1h || 0), cw1h: 0 }));
}

// Build the named strategy set for a run. F = measured/assumed fixed-prefix size, lean = target.
export function strategies({ fixed, lean }) {
  return [
    { name: "baseline", note: "the run as measured", apply: (c) => c.map((x) => ({ ...x })) },
    { name: `lean-gateway (${fixed}->${lean})`, note: "shrink injected prefix to the lean target", apply: (c) => applyPrefixShrink(c, fixed, lean) },
    { name: "drop-injection", note: "remove the fixed prefix from cached context entirely (upper bound)", apply: (c) => applyPrefixShrink(c, fixed, 0) },
    { name: "writes-5m-ttl", note: "1h cache writes repriced as 5m (hit rate held; upper bound)", apply: apply5mWrites },
  ];
}

// PURE — compare every strategy's bill against the baseline. Returns rows with absolute + pct delta.
export function benchmark(calls, opts, rates = RATES) {
  const strats = strategies(opts);
  const base = billCalls(strats[0].apply(calls), rates).cost;
  return strats.map((s) => {
    const bill = billCalls(s.apply(calls), rates);
    return {
      name: s.name,
      note: s.note,
      cost: bill.cost,
      delta: round(bill.cost - base),
      pct: base ? round((100 * (bill.cost - base)) / base) : 0,
      byModel: bill.byModel,
      legs: bill.legs,
    };
  });
}

// PURE — $ saved per 10k tokens shaved off the fixed prefix (the actionable lever figure).
export function sensitivity(calls, fixed, rates = RATES) {
  if (fixed <= 0) return 0;
  const base = billCalls(calls, rates).cost;
  const stripped = billCalls(applyPrefixShrink(calls, fixed, 0), rates).cost;
  return round(((base - stripped) / fixed) * 10000);
}

// --- LATENCY — the time lens (PURE) -----------------------------------------------------------
// Prefill sets time-to-first-token; decode generates the output. The tokens PREFILLED per call
// depend on whether the cached prefix is actually reused:
//   cached   = only the uncached tail is processed (cache_write + input); the cached prefix is
//              skipped. This is the hosted regime the transcript was captured under (21:1 reuse).
//   uncached = the whole context is re-processed every call (cache_read + cache_write + input) —
//              the local worst case, where prompt caching doesn't persist or isn't shared across
//              subagent processes, so every call cold-prefills its full context.
// Real hardware sits between the two, set by the local cache hit rate; the pair are the bounds.
// Named throughput profiles. Frontier defaults are PLACEHOLDERS — a hosted transcript can't yield
// clean kernel tps (cache_read confounds the solve), so set them from a measured run; the observed
// anchors below (TTFT, realized output rate) are what the transcript actually records, for calibration.
export const PROFILES_DEFAULT = {
  frontier: { prefillTps: 15000, decodeTps: 60 }, // PLACEHOLDER — replace with your measured frontier figures
  local: { prefillTps: 1000, decodeTps: 35 }, // placeholder; swap for measured local figures
};
export const LOCAL_DEFAULT = PROFILES_DEFAULT.local; // back-compat alias
export function prefillTokens(c, regime) {
  return regime === "uncached" ? c.cr + c.cw + c.in : c.cw + c.in;
}
// Observed frontier anchors straight from the transcript's `result` events: what the run actually
// timed. Not kernel tps (they include cache-read time, tool waits, network), but real and honest.
export function parseAnchors(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let o;
    try { o = JSON.parse(t); } catch { continue; }
    if (o.type !== "result") continue;
    const u = o.usage || {};
    const durS = (o.duration_api_ms || 0) / 1000;
    rows.push({
      turns: o.num_turns,
      duration_s: round(durS),
      ttft_s: round((o.ttft_ms || 0) / 1000),
      output: u.output_tokens || 0,
      realized_output_tps: durS ? round((u.output_tokens || 0) / durS) : 0,
    });
  }
  return rows;
}
function secStats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  return { median: n ? round(s[Math.floor(n / 2)]) : 0, avg: n ? round(sum / n) : 0, max: n ? round(s[n - 1]) : 0 };
}
export function latency(calls, { prefillTps = LOCAL_DEFAULT.prefillTps, decodeTps = LOCAL_DEFAULT.decodeTps, regime = "cached" } = {}) {
  let prefill = 0, decode = 0;
  const ttfts = [];
  for (const c of calls) {
    const pt = prefillTokens(c, regime) / prefillTps; // seconds to first token
    prefill += pt;
    decode += c.out / decodeTps;
    ttfts.push(pt);
  }
  return { regime, prefill_s: round(prefill), decode_s: round(decode), wall_s: round(prefill + decode), ttft_s: secStats(ttfts) };
}
// PURE — per-strategy wall-clock for each profile under both cache regimes. Returns one row per
// strategy with a {profileName: {cached_wall_s, uncached_wall_s, ...}} map, plus the local:frontier
// wall ratio (the viability figure: local is viable when this stays near 1).
export function benchmarkLatency(calls, opts, profiles) {
  const names = Object.keys(profiles);
  return strategies(opts).map((s) => {
    const c = s.apply(calls);
    const per = {};
    for (const p of names) {
      per[p] = {
        cached_wall_s: latency(c, { ...profiles[p], regime: "cached" }).wall_s,
        uncached_wall_s: latency(c, { ...profiles[p], regime: "uncached" }).wall_s,
        cached_ttft_median_s: latency(c, { ...profiles[p], regime: "cached" }).ttft_s.median,
      };
    }
    const ratio = profiles.frontier && profiles.local
      ? { cached: round(per.local.cached_wall_s / (per.frontier.cached_wall_s || 1)), uncached: round(per.local.uncached_wall_s / (per.frontier.uncached_wall_s || 1)) }
      : null;
    return { name: s.name, per, ratio };
  });
}

// --- TTL — the cache-survival lens (PURE) -----------------------------------------------------
// A cached prefix stays alive only if it is re-read within the TTL. Group calls by session, sort by
// timestamp, and count the gaps between successive calls that exceed a candidate TTL — each such gap
// is a cache expiry that forces a cold re-prefill on the next call. This makes the 5m-vs-1h TTL
// choice (and the writes-5m-ttl strategy's "hit rate held" caveat) data-driven instead of assumed.
export function ttlRisk(calls, ttlSeconds) {
  const bySess = {};
  for (const c of calls) if (c.ts != null) (bySess[c.session] ||= []).push(c.ts);
  const gaps = [];
  for (const ts of Object.values(bySess)) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) gaps.push((ts[i] - ts[i - 1]) / 1000);
  }
  gaps.sort((a, b) => a - b);
  const n = gaps.length;
  const expired = gaps.filter((g) => g > ttlSeconds).length;
  return {
    ttl_seconds: ttlSeconds,
    gaps: n,
    median_gap_s: n ? round(gaps[Math.floor(n / 2)]) : 0,
    max_gap_s: n ? round(gaps[n - 1]) : 0,
    expiries: expired, // cache timeouts → cold re-prefills at this TTL
    expiry_pct: n ? round((100 * expired) / n) : 0,
  };
}

// --- KV — the local capacity lens (PURE) ------------------------------------------------------
// vLLM (Automatic Prefix Caching) and SGLang (RadixAttention) evict KV blocks LRU by capacity, not
// by a TTL. So the local cache-survival question is whether the working set of concurrent contexts
// fits in the KV budget. A resident context's KV footprint = its full length (cr+cw+in) x bytes/tok.
// bytesPerToken = 2 (K,V) * num_layers * num_kv_heads * head_dim * dtype_bytes.
export function kvLens(calls, { bytesPerToken, kvBudgetGB }) {
  const ctx = calls.map((c) => c.cr + c.cw + c.in).sort((a, b) => a - b);
  const n = ctx.length;
  const median = n ? ctx[Math.floor(n / 2)] : 0;
  const max = n ? ctx[n - 1] : 0;
  const budgetTok = (kvBudgetGB * 1e9) / bytesPerToken; // tokens of KV the budget holds
  const gb = (t) => round((t * bytesPerToken) / 1e9);
  return {
    bytesPerToken,
    kvBudgetGB,
    budget_tokens: Math.round(budgetTok),
    median_ctx: median,
    max_ctx: max,
    gb_per_median_ctx: gb(median),
    gb_per_max_ctx: gb(max),
    resident_at_median: median ? round(budgetTok / median) : 0, // how many median contexts fit
    resident_at_max: max ? round(budgetTok / max) : 0,
  };
}
export function benchmarkKv(calls, opts, kv) {
  return strategies(opts).map((s) => ({ name: s.name, ...kvLens(s.apply(calls), kv) }));
}

// PURE — assemble the full report object (census + bench + lever + optional latency).
export function buildReport(calls, opts, rates = RATES) {
  const report = {
    census: census(calls),
    fixed: opts.fixed,
    lean: opts.lean,
    bench: benchmark(calls, opts, rates),
    saving_per_10k_prefix_tokens: sensitivity(calls, opts.fixed, rates),
  };
  if (opts.profiles) {
    const P = opts.profiles;
    report.latency = {
      profiles: P,
      summary: Object.fromEntries(Object.keys(P).map((n) => [n, {
        cached: latency(calls, { ...P[n], regime: "cached" }),
        uncached: latency(calls, { ...P[n], regime: "uncached" }),
      }])),
      bench: benchmarkLatency(calls, opts, P),
      anchors: opts.anchors || [],
      ttl: [300, 3600].map((t) => ttlRisk(calls, t)), // 5m and 1h cache lifetimes
    };
  }
  if (opts.kv) report.kv = { config: opts.kv, bench: benchmarkKv(calls, opts, opts.kv) };
  return report;
}

// --- I/O helpers (CLI only) -------------------------------------------------------------------
const fmt = (n) => n.toLocaleString("en-US");
const usd = (n) => `$${n.toFixed(2)}`;
function argFlag(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : null;
}
function printCensus(c) {
  console.log(`\n=== runtime tokenomics census (${c.calls} API calls) ===`);
  console.log(`  models: ${Object.entries(c.models).map(([m, n]) => `${m}=${n}`).join(", ")}`);
  const row = (label, s) => console.log(`  ${label.padEnd(12)} sum ${fmt(s.sum).padStart(12)}  avg ${fmt(s.avg).padStart(9)}  median ${fmt(s.median).padStart(9)}  max ${fmt(s.max).padStart(9)}`);
  row("cache_read", c.cache_read);
  row("cache_write", c.cache_write);
  row("input", c.input);
  row("output", c.output);
  console.log(`  read:write ratio = ${c.read_write_ratio}:1  (healthy caching = high; low = thrash)`);
  console.log(`  context re-read ${fmt(c.context_tokens)} tok = ${c.context_share_pct}% of all token movement; output ${fmt(c.output_tokens)} tok`);
  if (c.output_suspect) console.log(`  ⚠ output_tokens look truncated in this transcript (avg < 25/call) — treat the output leg of the bill as a floor`);
}
function printBench(r) {
  console.log(`\n=== caching-strategy bench (fixed prefix = ${fmt(r.fixed)} tok, lean target = ${fmt(r.lean)} tok) ===`);
  console.log(`  ${"strategy".padEnd(30)} ${"cost".padStart(9)} ${"Δ vs base".padStart(11)} ${"Δ%".padStart(7)}`);
  for (const b of r.bench) {
    console.log(`  ${b.name.padEnd(30)} ${usd(b.cost).padStart(9)} ${usd(b.delta).padStart(11)} ${String(b.pct).padStart(6)}%   ${b.note}`);
  }
  console.log(`  lever: ~${usd(r.saving_per_10k_prefix_tokens)} saved for every 10k tokens shaved off the fixed injected prefix`);
}
const secs = (s) => (s >= 90 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`);
function printLatency(l, outputSuspect) {
  const names = Object.keys(l.profiles);
  console.log(`\n=== latency lens ===`);
  for (const n of names) {
    const p = l.profiles[n];
    console.log(`  ${n} profile (prefill ${fmt(p.prefillTps)} tps, decode ${fmt(p.decodeTps)} tps)${n === "frontier" ? "  [PLACEHOLDER — set --frontier-* from your run]" : ""}`);
    const s = l.summary[n];
    console.log(`     cached   median TTFT ${secs(s.cached.ttft_s.median).padStart(7)}   total wall ${secs(s.cached.wall_s).padStart(8)}`);
    console.log(`     uncached median TTFT ${secs(s.uncached.ttft_s.median).padStart(7)}   total wall ${secs(s.uncached.wall_s).padStart(8)}`);
  }
  console.log(`  cached = prefix reused; uncached = every call cold-prefills its full context (local worst case, weak/no cache reuse)`);
  if (outputSuspect) console.log(`  ⚠ decode times are a floor — output_tokens are truncated in this transcript; real decode scales with real output`);
  if (l.anchors.length) {
    console.log(`\n  observed frontier anchors from this run (calibrate --frontier-* against these):`);
    for (const a of l.anchors) console.log(`     ${a.turns} turns: TTFT ${secs(a.ttft_s)}, realized output ${a.realized_output_tps} tps, API wall ${secs(a.duration_s)}`);
  }
  console.log(`\n  per-strategy total wall-clock (local vs frontier), and local:frontier ratio:`);
  console.log(`  ${"strategy".padEnd(30)} ${"local cached".padStart(12)} ${"local uncached".padStart(15)} ${"ratio c/u".padStart(14)}`);
  for (const b of l.bench) {
    const r = b.ratio ? `${b.ratio.cached}x / ${b.ratio.uncached}x` : "";
    console.log(`  ${b.name.padEnd(30)} ${secs(b.per.local.cached_wall_s).padStart(12)} ${secs(b.per.local.uncached_wall_s).padStart(15)} ${r.padStart(14)}`);
  }
  console.log(`  ratio = local wall / frontier wall. Local is viable where the ratio stays near 1; the uncached column is the local cache-miss risk.`);
  if (l.ttl) {
    console.log(`\n  cache survival, TTL model (hosted / ephemeral cache): inter-call gaps vs TTL — each expiry forces a cold re-prefill:`);
    for (const t of l.ttl) console.log(`     ${secs(t.ttl_seconds).padStart(5)} TTL: ${t.expiries} of ${t.gaps} gaps expire (${t.expiry_pct}%)  [median gap ${secs(t.median_gap_s)}, max ${secs(t.max_gap_s)}]`);
    console.log(`     (vLLM/SGLang evict LRU by KV capacity, not TTL — see the KV lens with --kv)`);
  }
}
function printKv(k) {
  const c = k.config;
  console.log(`\n=== KV-capacity lens (vLLM/SGLang, LRU by capacity — ${fmt(c.bytesPerToken / 1024)} KB/token, ${c.kvBudgetGB} GB KV budget) ===`);
  console.log(`  budget holds ${fmt(k.bench[0].budget_tokens)} tokens of KV total`);
  console.log(`  ${"strategy".padEnd(30)} ${"median ctx".padStart(11)} ${"GB/ctx".padStart(8)} ${"fit@median".padStart(11)} ${"fit@max".padStart(9)}`);
  for (const b of k.bench) {
    console.log(`  ${b.name.padEnd(30)} ${fmt(b.median_ctx).padStart(11)} ${String(b.gb_per_median_ctx).padStart(7)}G ${String(b.resident_at_median).padStart(11)} ${String(b.resident_at_max).padStart(9)}`);
  }
  console.log(`  fit = concurrent agent-contexts that stay resident before LRU eviction starts. Below ~1-2 with a drive + subagents = thrash → cold re-prefills.`);
}

function main() {
  const argv = process.argv.slice(2);
  const path = argFlag(argv, "--transcript");
  if (!path) {
    console.error("usage: node eval/tokenomics.mjs --transcript <file|dir> [--fixed N] [--lean N] [--json] [--save out.json]");
    process.exit(2);
  }
  const gatewayTokens = existsSync(GATEWAY_SKILL) ? estimateTokens(readFileSync(GATEWAY_SKILL, "utf8")) : 0;
  const fixed = Number(argFlag(argv, "--fixed") ?? gatewayTokens); // default: the static gateway SKILL.md size
  const lean = Number(argFlag(argv, "--lean") ?? 8300); // default: the P0 "inject only the slice" target
  const wantLatency = argv.includes("--latency");
  const profiles = wantLatency
    ? {
        frontier: { prefillTps: Number(argFlag(argv, "--frontier-prefill-tps") ?? PROFILES_DEFAULT.frontier.prefillTps), decodeTps: Number(argFlag(argv, "--frontier-decode-tps") ?? PROFILES_DEFAULT.frontier.decodeTps) },
        local: { prefillTps: Number(argFlag(argv, "--prefill-tps") ?? PROFILES_DEFAULT.local.prefillTps), decodeTps: Number(argFlag(argv, "--decode-tps") ?? PROFILES_DEFAULT.local.decodeTps) },
      }
    : null;
  const calls = loadCalls(path);
  if (calls.length === 0) {
    console.error(`no assistant API calls found in ${path} — is this a Claude Code transcript?`);
    process.exit(1);
  }
  // observed anchors come from the same transcript file(s) — read them for calibration
  const anchors = wantLatency ? loadAnchors(path) : [];
  const wantKv = argv.includes("--kv");
  const kv = wantKv
    ? { bytesPerToken: Number(argFlag(argv, "--kv-bytes-per-token") ?? 131072), kvBudgetGB: Number(argFlag(argv, "--kv-budget-gb") ?? 30) }
    : null;
  const report = buildReport(calls, { fixed, lean, profiles, anchors, kv });
  const save = argFlag(argv, "--save");
  if (save) { writeFileSync(save, JSON.stringify(report, null, 2)); console.log(`wrote ${save}`); }
  if (argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }
  printCensus(report.census);
  printBench(report);
  if (report.latency) printLatency(report.latency, report.census.output_suspect);
  if (report.kv) printKv(report.kv);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
