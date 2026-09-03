#!/usr/bin/env node
// run-bench.mjs — benchmark a local LLM endpoint against real faff spec-review lens prompts.
// Zero dependencies (node built-ins only). Runs each request in requests/ against one endpoint and
// reports timing, throughput, token counts, findings-shape (parseable?), and reasoning-content leakage.
//
// USAGE
//   node run-bench.mjs --provider <ollama|openai> --host <URL> --model <NAME> [options]
//
// EXAMPLES
//   # ollama (native /api/chat, keyless). think:false disables reasoning.
//   node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx
//
//   # OpenAI-compatible server (/v1). Needs the /v1 in the host, a bearer key, and the served id.
//   OMLX_API_KEY=... node run-bench.mjs --provider openai --host http://HOST:8001/v1 \
//       --model Qwen3.8-27B-4bit --key-env OMLX_API_KEY
//
//   # Cohere "North" reasoning models: add --cohere to also send the native thinking:{type:disabled}.
//   node run-bench.mjs --provider openai --host http://HOST:8001/v1 --model North-Mini-Code-1.0-6bit \
//       --key-env OMLX_API_KEY --cohere
//
//   # Compare reasoning ON vs OFF, one lens, streaming (measures time-to-first-byte):
//   node run-bench.mjs --provider ollama --host http://HOST:11434 --model qwen3.8:27b-mlx \
//       --lens qa --reasoning on --stream
//
// OPTIONS
//   --provider ollama|openai     (required) transport family
//   --host URL                   (required) ollama: http://h:11434  ·  openai: http://h:8001/v1
//   --model NAME                 (required) served model id (openai id must match /v1/models exactly)
//   --key-env VAR                openai bearer token env var name (value read from process.env[VAR])
//   --lens all|architectural|infosec|methodology|qa   (default all)
//   --reasoning off|on           (default off) off = disable thinking; on = leave it enabled (compare)
//   --thinking-token-budget N    top-level vLLM reasoning-token cap; the lever qwen3 AND cohere_command4 honour.
//                                Pair with --reasoning on to bench without the empty-out (what production sends).
//   --cohere                     openai: also send top-level thinking:{type:"disabled"} (Cohere native)
//   --max-tokens N              (default 12000) output token cap (matches production adversarial.max_tokens)
//   --temperature T              (default 0.2)
//   --stream                     measure time-to-first-byte (default: non-streaming, cleaner timing)
//   --timeout-ms MS              (default 1200000 = 20min) per-request timeout
//   --out DIR                    results dir (default results/<provider>-<model>-<timestamp>)
//   --requests-dir DIR           (default ./requests)

import http from "node:http";
import https from "node:https";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---- arg parsing ----
function parseArgs(argv) {
  const a = { reasoning: "off", lens: "all", maxTokens: 12000, temperature: 0.2, stream: false,   // FAFF-918: default cap matches production adversarial.max_tokens (12000), not the old 2000, so a bench run reflects what faff sends
              timeoutMs: 1200000, requestsDir: join(ROOT, "requests"), cohere: false,
              repeat: 1, concurrent: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--provider") a.provider = argv[++i];
    else if (k === "--host") a.host = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--key-env") a.keyEnv = argv[++i];
    else if (k === "--lens") a.lens = argv[++i];
    else if (k === "--reasoning") a.reasoning = argv[++i];
    else if (k === "--token-budget") a.tokenBudget = Number(argv[++i]);
    else if (k === "--thinking-token-budget") a.thinkingTokenBudget = Number(argv[++i]);   // FAFF-918: top-level vLLM reasoning-token cap (distinct from Cohere's nested thinking.token_budget)
    else if (k === "--cohere") a.cohere = true;
    else if (k === "--max-tokens") a.maxTokens = Number(argv[++i]);
    else if (k === "--temperature") a.temperature = Number(argv[++i]);
    else if (k === "--stream") a.stream = true;
    else if (k === "--concurrent" || k === "--fanout") a.concurrent = true;
    else if (k === "--repeat") a.repeat = Math.max(1, Number(argv[++i]) || 1);
    else if (k === "--cache-bust") a.cacheBust = true;
    else if (k === "--timeout-ms") a.timeoutMs = Number(argv[++i]);
    else if (k === "--out") a.out = argv[++i];
    else if (k === "--requests-dir") a.requestsDir = argv[++i];
    else if (k === "--reasoning-extra") a.reasoningExtra = argv[++i];   // JSON: production's per-backend reasoning_extra, merged onto the openai body
    else if (k === "-h" || k === "--help") a.help = true;
  }
  return a;
}
const A = parseArgs(process.argv.slice(2));
if (A.help || !A.provider || !A.host || !A.model) {
  console.error("usage: node run-bench.mjs --provider <ollama|openai> --host <URL> --model <NAME> [options]\n" +
                "see the header of this file for all options and examples.");
  process.exit(A.help ? 0 : 2);
}
if (!["ollama", "openai"].includes(A.provider)) { console.error(`--provider must be ollama|openai`); process.exit(2); }
if (!["off", "on", "none", "low", "medium", "high", "xhigh"].includes(A.reasoning)) { console.error(`--reasoning must be off|on|none|low|medium|high|xhigh`); process.exit(2); }
// --cache-bust: one nonce per RUN, prepended to every lens's system message, so the run starts cold vs
// the server's existing cache but the 4 lenses in this run still share an identical prefix (preserving
// within-run fan-out cache sharing for the shared-prefix layout). New nonce each invocation.
const NONCE = A.cacheBust ? `[cache-bust ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}]\n` : "";

// ---- transport ----
const CONTENT_RE = /"content"\s*:\s*"[^"]/; // a non-empty content field = the first real generated token
function request(method, url, body, headers = {}, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const t0 = Date.now();
    let ttfb = null, ttft = null; // first byte (may be an early role/keepalive frame) vs first CONTENT token
    const opts = { method, headers: { ...headers } };
    if (body != null) { opts.headers["content-type"] = "application/json"; opts.headers["content-length"] = Buffer.byteLength(body); }
    const r = lib.request(u, opts, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        if (ttfb === null) ttfb = Date.now() - t0;
        data += c;
        if (ttft === null && stream && CONTENT_RE.test(data)) ttft = Date.now() - t0; // time to first real token
      });
      res.on("end", () => resolve({ status: res.statusCode, body: data, ttfbMs: ttfb, ttftMs: ttft, totalMs: Date.now() - t0 }));
    });
    r.on("error", reject);
    r.setTimeout(A.timeoutMs, () => r.destroy(new Error(`timeout ${A.timeoutMs}ms`)));
    if (body != null) r.write(body);
    r.end();
  });
}

// ---- body builders ----
const COHERE_BUDGET = { low: 1024, medium: 8192, high: 31000 }; // Cohere token_budget per effort level

function ollamaBody(system, user) {
  const b = { model: A.model, stream: A.stream, messages: [{ role: "system", content: system }, { role: "user", content: user }],
              options: { temperature: A.temperature, num_predict: A.maxTokens } };
  // ollama's native switch is boolean (think true/false); it has no effort level, so on/low/medium/high
  // all map to think:true (the level is a no-op here — use an openai endpoint for graded effort).
  b.think = A.reasoning !== "off";
  return b;
}
function openaiBody(system, user) {
  const b = { model: A.model, stream: A.stream, messages: [{ role: "system", content: system }, { role: "user", content: user }],
              temperature: A.temperature, max_tokens: A.maxTokens };
  if (A.stream) b.stream_options = { include_usage: true }; // ask for usage (cached_tokens, exact counts) in the final SSE chunk
  const r = A.reasoning;
  if (r === "none") {
    // emit NO reasoning lever in this branch — rely entirely on --reasoning-extra below. This mirrors
    // production buildOpenAiPayload when a backend sets neither reasoning_off nor reasoning_effort and
    // controls reasoning purely through its reasoning_extra (e.g. an OpenRouter model's reasoning:{...}).
  } else if (r === "off") {
    b.chat_template_kwargs = { thinking: false, enable_thinking: false }; // Qwen3/vLLM/SGLang/HF/MLX templates
    if (A.cohere) b.thinking = { type: "disabled" };                      // Cohere "North" native switch
  } else {
    b.chat_template_kwargs = { enable_thinking: true };                   // enable the think phase
    if (["low", "medium", "high"].includes(r)) b.reasoning_effort = r;    // OpenAI standard effort level
    if (A.cohere) {                                                       // Cohere native: enabled + optional budget
      const budget = A.tokenBudget ?? COHERE_BUDGET[r];
      b.thinking = budget ? { type: "enabled", token_budget: budget } : { type: "enabled" };
    }
  }
  // FAFF-918: top-level vLLM reasoning-token cap — the lever that both qwen3 and cohere_command4
  // honour. This is what production sends (per-backend reasoning_extra.thinking_token_budget) and
  // is REQUIRED to bench the spark backends without them emptying out on a large payload. Sent
  // whenever set, independent of the on/off/effort branch above; a server that ignores it drops it.
  if (A.thinkingTokenBudget != null && !Number.isNaN(A.thinkingTokenBudget)) b.thinking_token_budget = A.thinkingTokenBudget;
  // --reasoning-extra: apply a backend's production reasoning_extra verbatim, mirroring review-call.mjs's
  // mergeReasoningExtra — allowlisted top-level keys, chat_template_kwargs deep-merges one level, applied
  // LAST so an explicit extra wins. Lets the bench replicate a backend's exact .faffrc reasoning config.
  if (A.reasoningExtra) {
    let extra;
    try { extra = JSON.parse(A.reasoningExtra); } catch (e) { console.error(`--reasoning-extra must be JSON: ${e.message}`); process.exit(2); }
    if (typeof extra !== "object" || Array.isArray(extra)) { console.error("--reasoning-extra must be a JSON object"); process.exit(2); }
    const ALLOW = ["reasoning", "thinking", "reasoning_effort", "chat_template_kwargs", "thinking_token_budget", "custom_params"];
    for (const [k, v] of Object.entries(extra)) {
      if (!ALLOW.includes(k)) { console.error(`--reasoning-extra: unsupported key ${JSON.stringify(k)} (allowed: ${ALLOW.join(", ")})`); process.exit(2); }
      if (k === "chat_template_kwargs" && b.chat_template_kwargs && v && typeof v === "object") b.chat_template_kwargs = { ...b.chat_template_kwargs, ...v };
      else b[k] = v;
    }
  }
  return b;
}

// ---- parsing / metrics ----
const SEV = /^###\s*\[?(critical|major|minor|observation)\]?\s*[:—-]/im;
// FAFF-905: mirrors the closed bare-or-headed clean-refutation grammar production accepts
// (CLEAN_REFUTATIONS / normaliseCleanRefutation in
// plugin/skills/faffter-dark-adversarial-review/review-call.mjs) — no looser, no stricter.
const CLEAN_REFUTATIONS = [
  { heading: "## Refutation — architectural", sentence: "No architectural objection." },
  { heading: "## Refutation — infosec", sentence: "No infosec objection." },
  { heading: "## Refutation — methodology", sentence: "No methodology objection." },
  { heading: "## Refutation — QA", sentence: "No QA objection." },
];
function isCleanRefutation(content) {
  const lines = String(content == null ? "" : content)
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .filter((line) => line.trim() !== "");
  for (const { heading, sentence } of CLEAN_REFUTATIONS) {
    if (lines.length === 1 && lines[0] === sentence) return true;       // bare form
    if (lines.length === 2 && lines[0] === heading && lines[1] === sentence) return true; // headed form
  }
  return false;
}
function shape(content) {
  const t = (content || "").trim();
  if (!t) return "EMPTY";
  if (isCleanRefutation(t)) return "clean-pass";
  return SEV.test(t) ? "findings-shaped" : "NOT-shaped";
}
function severities(content) {
  const out = [];
  for (const line of (content || "").split("\n")) {
    const m = line.match(SEV);
    if (m) out.push(m[1].toLowerCase());
  }
  return out;
}

// Non-streaming: ollama returns one JSON; openai returns one completion. Streaming folds NDJSON/SSE.
function foldOllama(raw, streamed) {
  if (!streamed) { const j = JSON.parse(raw); return { content: j.message?.content ?? "", meta: j, reasoning: "" }; }
  let content = "", meta = {};
  for (const line of raw.split("\n")) { const t = line.trim(); if (!t) continue; try { const j = JSON.parse(t); if (typeof j.message?.content === "string") content += j.message.content; if (j.done) meta = j; } catch {} }
  return { content, meta, reasoning: "" };
}
function foldOpenai(raw, streamed) {
  if (!streamed) {
    const j = JSON.parse(raw); const m = j.choices?.[0]?.message ?? {};
    return { content: m.content ?? "", reasoning: m.reasoning_content ?? m.reasoning ?? "", meta: j, finish: j.choices?.[0]?.finish_reason };
  }
  let content = "", reasoning = "", finish, sawData = false, usage = null;
  for (const line of raw.split("\n")) {
    const t = line.trim(); if (!t.startsWith("data:")) continue; sawData = true;
    const p = t.slice(5).trim(); if (p === "[DONE]") continue;
    try { const j = JSON.parse(p); const d = j.choices?.[0]?.delta ?? {}; if (typeof d.content === "string") content += d.content; if (typeof d.reasoning_content === "string") reasoning += d.reasoning_content; if (j.choices?.[0]?.finish_reason) finish = j.choices[0].finish_reason; if (j.usage) usage = j.usage; } catch {}
  }
  if (!sawData) return foldOpenai(raw, false);
  return { content, reasoning, meta: usage ? { usage } : {}, finish };
}

// ---- preflight (served-model check, best effort) ----
async function preflight() {
  try {
    if (A.provider === "ollama") {
      const r = await request("GET", new URL("/api/tags", A.host).toString());
      const names = (JSON.parse(r.body).models || []).map((m) => m.name);
      return { ok: r.status === 200, served: names.includes(A.model), names, status: r.status };
    } else {
      const headers = A.keyEnv && process.env[A.keyEnv] ? { authorization: `Bearer ${process.env[A.keyEnv]}` } : {};
      const r = await request("GET", joinV1("/models"), null, headers);
      const ids = (JSON.parse(r.body).data || []).map((m) => m.id);
      return { ok: r.status === 200, served: ids.includes(A.model), names: ids, status: r.status };
    }
  } catch (e) { return { ok: false, error: e.message }; }
}
const joinV1 = (path) => String(A.host).replace(/\/+$/, "") + path; // openai host already ends in /v1

// ---- run one lens ----
async function runLens(reqPath) {
  const req = JSON.parse(readFileSync(reqPath, "utf8"));
  const sys = NONCE + req.system; // NONCE is "" unless --cache-bust; kept identical across lenses in a run
  const body = JSON.stringify(A.provider === "ollama" ? ollamaBody(sys, req.user) : openaiBody(sys, req.user));
  const url = A.provider === "ollama" ? new URL("/api/chat", A.host).toString() : joinV1("/chat/completions");
  const headers = {};
  if (A.provider === "openai" && A.keyEnv && process.env[A.keyEnv]) headers.authorization = `Bearer ${process.env[A.keyEnv]}`;
  let res;
  try { res = await request("POST", url, body, headers, { stream: A.stream }); }
  catch (e) { return { lens: req.lens, error: e.message }; }
  if (res.status < 200 || res.status >= 300) return { lens: req.lens, http: res.status, error: res.body.slice(0, 300), totalMs: res.totalMs };
  let folded;
  try { folded = A.provider === "ollama" ? foldOllama(res.body, A.stream) : foldOpenai(res.body, A.stream); }
  catch (e) { return { lens: req.lens, http: res.status, error: `parse: ${e.message} :: ${res.body.slice(0, 200)}`, totalMs: res.totalMs }; }
  const m = folded.meta || {};
  const usage = m.usage || {};
  const peTok = m.prompt_eval_count ?? usage.prompt_tokens ?? req.meta.approx_prompt_tokens;
  const outTok = m.eval_count ?? usage.completion_tokens ?? Math.round((folded.content.length) / 4);
  const peDurS = m.prompt_eval_duration != null ? m.prompt_eval_duration / 1e9 : null; // ollama ns
  const genDurS = m.eval_duration != null ? m.eval_duration / 1e9 : null;
  // use time-to-first-CONTENT-token (ttft) when streaming — the real prompt-eval boundary — since some
  // servers (e.g. OMLX) flush an early role/keepalive frame, making raw first-byte (ttfb) misleadingly small.
  const ttfbS = (res.ttftMs ?? res.ttfbMs) != null ? (res.ttftMs ?? res.ttfbMs) / 1000 : null;
  const totalS = res.totalMs / 1000;
  // prompt-eval / generation tok/s: prefer ollama's exact per-phase durations; otherwise derive from the
  // streaming TTFB — time-to-first-token ~= prompt-eval time, the remainder is generation. This is how you
  // get pe/gen tps from an OpenAI-compatible server (OMLX/vLLM/etc.) that only reports token counts: add
  // --stream. NOTE: on a warm prompt-cache hit prompt-eval is ~0, so ttfb-derived pe tps is meaningless
  // (look at cached_tok instead); it is meaningful on a COLD run.
  let peTps = null, genTps = null, tpsSource = null;
  if (peDurS) { peTps = Math.round(peTok / peDurS); tpsSource = "server-duration"; }
  else if (A.stream && ttfbS != null && ttfbS > 0) { peTps = Math.round(peTok / ttfbS); tpsSource = "ttft-derived"; }
  if (genDurS) genTps = +(outTok / genDurS).toFixed(1);
  else if (A.stream && ttfbS != null && totalS - ttfbS > 0.05) genTps = +(outTok / (totalS - ttfbS)).toFixed(1);
  const rec = {
    lens: req.lens, http: res.status,
    total_s: +totalS.toFixed(1),
    server_total_s: usage.total_time != null ? +Number(usage.total_time).toFixed(1) : null, // OMLX/openai server-side
    ttfb_s: ttfbS != null ? +ttfbS.toFixed(1) : null,
    in_tok: peTok, out_tok: outTok,
    cached_tok: usage.prompt_tokens_details?.cached_tokens ?? null, // openai cache-hit signal
    prompt_eval_tps: peTps, gen_tps: genTps, tps_source: tpsSource,
    shape: shape(folded.content),
    severities: severities(folded.content),
    reasoning_len: folded.reasoning ? folded.reasoning.length : 0,
    finish: folded.finish ?? m.done_reason ?? null,
    content_bytes: Buffer.byteLength(folded.content || ""),
  };
  return { ...rec, _content: folded.content, _reasoning: folded.reasoning };
}

// ---- main ----
function slug(s) { return String(s).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""); }
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

const outDir = A.out || join(ROOT, "results", `${A.provider}-${slug(A.model)}-r${A.reasoning}${A.cohere ? "-cohere" : ""}-${stamp()}`);
mkdirSync(outDir, { recursive: true });

const allLenses = readdirSync(A.requestsDir).filter((f) => f.endsWith(".json")).sort();
const want = A.lens === "all" ? allLenses : allLenses.filter((f) => f.replace(/\.json$/, "").toLowerCase() === A.lens.toLowerCase());
if (want.length === 0) { console.error(`no request matches --lens ${A.lens} (available: ${allLenses.map((f) => f.replace(/\.json$/, "")).join(", ")})`); process.exit(2); }

console.log(`endpoint: ${A.provider} ${A.host}  model=${A.model}  reasoning=${A.reasoning}${A.cohere ? " +cohere" : ""}  stream=${A.stream}  max_tokens=${A.maxTokens}`);
const pf = await preflight();
if (!pf.ok) console.log(`preflight: WARN unreachable/${pf.status ?? "err"} ${pf.error ?? ""} — attempting anyway`);
else if (!pf.served) console.log(`preflight: WARN model '${A.model}' NOT in served set: ${(pf.names || []).join(", ")} — attempting anyway`);
else console.log(`preflight: ok, model served (${pf.names.length} models on host)`);
console.log("");

function printRec(r, prefix) {
  if (r.error) { console.log(`${prefix}FAIL http=${r.http ?? "-"} ${r.error}`); return; }
  const breach = r.reasoning_len > 0 && r.shape === "EMPTY" ? "  ⚠ reasoning-eaten-budget" : "";
  const est = r.tps_source === "ttft-derived" ? "~" : ""; // ~ marks a TTFB-derived (estimated) rate
  console.log(`${prefix}${r.total_s}s${r.ttfb_s != null ? ` ttfb ${r.ttfb_s}s` : ""}  in=${r.in_tok} out=${r.out_tok}` +
    `${r.cached_tok ? ` cached=${r.cached_tok}` : ""}` +
    `${r.prompt_eval_tps ? ` pe=${est}${r.prompt_eval_tps}tps` : ""}${r.gen_tps ? ` gen=${est}${r.gen_tps}tps` : ""}` +
    `  ${r.shape}${r.severities.length ? ` [${r.severities.join(",")}]` : ""}${r.reasoning_len ? ` rc=${r.reasoning_len}b` : ""}${breach}`);
}

const runs = [];   // per-iteration summaries
const flat = [];   // every {iter, ...rec}, for the table + cache analysis
for (let it = 1; it <= A.repeat; it++) {
  if (A.repeat > 1) console.log(`--- iteration ${it}/${A.repeat} ---`);
  const iterStart = Date.now();
  let recs;
  if (A.concurrent) {
    // fan-out: fire all selected lenses at once (like faff's fan-out.mjs). On a single-GPU server the
    // requests serialise, so per-lens total_s includes queue wait and the iteration wall-clock ~= sum;
    // on a truly parallel backend the wall-clock ~= the slowest single lens.
    console.log(`  firing ${want.length} lens(es) concurrently (fan-out)...`);
    recs = await Promise.all(want.map((f) => runLens(join(A.requestsDir, f))));
    for (const r of recs) printRec(r, `  [${r.lens}] `);
  } else {
    recs = [];
    for (const f of want) {
      process.stdout.write(`  [${f.replace(/\.json$/, "")}] ... `);
      const r = await runLens(join(A.requestsDir, f));
      recs.push(r);
      printRec(r, "");
    }
  }
  const iterWall = +((Date.now() - iterStart) / 1000).toFixed(1);
  console.log(`  iteration ${it} wall-clock: ${iterWall}s\n`);
  if (it === 1) for (const r of recs) {          // save verdict/reasoning bodies from the first pass only
    if (r._content != null) writeFileSync(join(outDir, `${r.lens.toLowerCase()}.content.md`), r._content);
    if (r._reasoning) writeFileSync(join(outDir, `${r.lens.toLowerCase()}.reasoning.txt`), r._reasoning);
  }
  const clean = recs.map(({ _content, _reasoning, ...r }) => r);
  runs.push({ iter: it, mode: A.concurrent ? "concurrent" : "sequential", wall_s: iterWall, lenses: clean });
  clean.forEach((r) => flat.push({ iter: it, ...r }));
}

// cache-warming analysis (only meaningful with --repeat > 1): same request re-sent should hit the
// server's prompt cache, so prompt-eval collapses and total_s drops on iterations 2+.
let cache = null;
if (A.repeat > 1) {
  cache = {};
  const lensNames = [...new Set(flat.map((r) => r.lens))];
  console.log("=== cache warming (total_s per iteration; lower = warmer prompt cache) ===");
  for (const ln of lensNames) {
    const series = flat.filter((r) => r.lens === ln && !r.error);
    const totals = series.map((r) => r.total_s);
    const peTps = series.map((r) => r.prompt_eval_tps);
    const last = totals[totals.length - 1];
    const speedup = totals.length > 1 && last > 0 ? +(totals[0] / last).toFixed(1) : null;
    cache[ln] = { total_s: totals, prompt_eval_tps: peTps, speedup_first_to_last: speedup };
    console.log(`  ${ln}: ${totals.join("s -> ")}s${speedup ? `   (${speedup}x faster warm)` : ""}`);
  }
}

const summary = {
  endpoint: { provider: A.provider, host: A.host, model: A.model },
  config: { reasoning: A.reasoning, cohere: A.cohere, stream: A.stream, max_tokens: A.maxTokens,
            temperature: A.temperature, mode: A.concurrent ? "concurrent" : "sequential", repeat: A.repeat },
  preflight: pf, runs, cache,
};
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

let md = `# review-bench run\n\n- endpoint: ${A.provider} ${A.host}\n- model: ${A.model}\n` +
  `- reasoning: ${A.reasoning}${A.cohere ? " +cohere" : ""} · stream: ${A.stream} · max_tokens: ${A.maxTokens}\n` +
  `- mode: ${A.concurrent ? "concurrent (fan-out)" : "sequential"} · repeat: ${A.repeat}\n\n`;
md += `| iter | lens | http | total | ttfb | in | out | pe tps | gen tps | shape | severities | reasoning |\n` +
      `|--:|---|---|--:|--:|--:|--:|--:|--:|---|---|--:|\n`;
for (const r of flat) {
  if (r.error) { md += `| ${r.iter} | ${r.lens} | ${r.http ?? "-"} | | | | | | | ERROR | ${String(r.error).slice(0, 40)} | |\n`; continue; }
  md += `| ${r.iter} | ${r.lens} | ${r.http} | ${r.total_s}s | ${r.ttfb_s ?? ""} | ${r.in_tok} | ${r.out_tok} | ${r.prompt_eval_tps ?? ""} | ${r.gen_tps ?? ""} | ${r.shape} | ${r.severities.join(",")} | ${r.reasoning_len || ""} |\n`;
}
md += `\n` + runs.map((rn) => `- iteration ${rn.iter} (${rn.mode}) wall-clock: ${rn.wall_s}s`).join("\n") + "\n";
if (cache) {
  md += `\n## cache warming (total_s per iteration)\n\n`;
  for (const [ln, c] of Object.entries(cache)) md += `- ${ln}: ${c.total_s.join("s -> ")}s${c.speedup_first_to_last ? `  (${c.speedup_first_to_last}x faster warm)` : ""}\n`;
}
writeFileSync(join(outDir, "summary.md"), md);

console.log(`results saved to: ${outDir}`);
console.log(`  summary.md / summary.json · <lens>.content.md (verdicts) · <lens>.reasoning.txt (if any)`);
