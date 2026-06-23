#!/usr/bin/env node
// FAFF-183 — robust adversarial-review backend call for ollama.
//
// Replaces the agent-hand-rolled API call (which broke five ways on a real backend: no model
// preflight, empty content from reasoning models, dropped connections on long responses, no token
// budget, and diff-only context that made the reviewer hallucinate "this heading doesn't exist").
// Per deterministic-tools-over-prose, the robust call is a tool, not prose.
//
// The pure functions (buildChatPayload / modelServed / accumulateNdjson / assembleUserMessage) carry
// no I/O and are unit-tested directly; the transport (getFn/streamFn) is injectable so CI makes ZERO
// real calls. Zero-dependency: node:http(s)/node:fs only. Mirrors eval/ollama-model.mjs's FAFF-137
// `think:false` lever and fail-loud parsing, kept self-contained (that module pulls eval-only deps).

import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";

// Exit codes the skill maps to a verdict: 0 ok · 4 model-not-served (→ needs-human) ·
// 5 provider-unreachable, explicitly-configured host (→ pass+skip) ·
// 6 provider-unreachable, unconfigured localhost default (→ needs-human, FAFF-213) ·
// 7 auth-failed (cloud creds / unset key env, → needs-human, FAFF-209) · 2 usage · 1 other.
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2, NOT_SERVED: 4, UNREACHABLE: 5, DEFAULT_HOST_UNREACHABLE: 6, AUTH: 7 };
export const DEFAULT_NUM_PREDICT = 2000;

// PURE (FAFF-213): map an unreachable result to its exit code by host provenance. An explicitly-
// configured host that's down → EXIT.UNREACHABLE (5 → pass+skip, the human's call). A host that's
// only the documented localhost default because nothing was configured → EXIT.DEFAULT_HOST_UNREACHABLE
// (6 → needs-human) — an absent provider block must not invisibly disable the review (cf. exit 4).
// review-call can't infer provenance from the host string (localhost is a legit configured host), so
// the caller signals it via --host-source; this is the one place the policy decision lives.
export function unreachableExit({ hostSource } = {}) {
  return hostSource === "default" ? EXIT.DEFAULT_HOST_UNREACHABLE : EXIT.UNREACHABLE;
}

// Two transport families. ollama speaks /api/tags + /api/chat (NDJSON). openai speaks the
// OpenAI-compatible /v1/models + /v1/chat/completions (SSE) shared by OpenAI, vLLM, OpenRouter,
// NVIDIA NIM (integrate.api.nvidia.com/v1), DeepSeek, etc. gemini/anthropic have native wire
// formats and are NOT handled here — point them at an OpenAI-compatible base URL or add an adaptor.
export function providerFamily(name) {
  const n = String(name || "ollama").toLowerCase();
  if (n === "ollama") return "ollama";
  if (["openai", "vllm", "openrouter", "nvidia", "deepseek", "openai-compatible"].includes(n)) return "openai";
  return n; // unknown — runReview returns status "unsupported-provider"
}

// PURE: join an OpenAI-style base URL (host already ends in /v1) with an endpoint path, without
// the new URL("/models", base) trap that would drop the /v1 prefix.
export function joinUrl(base, path) {
  return String(base).replace(/\/+$/, "") + path;
}

// PURE: the /api/chat payload. think:false disables a reasoning model's hidden think-block (else
// message.content comes back empty); stream:true keeps a long response's connection alive.
export function buildChatPayload({ model, system, user, numPredict = DEFAULT_NUM_PREDICT }) {
  if (!model) throw new Error("buildChatPayload requires a model");
  return {
    model,
    stream: true,
    think: false,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    options: { temperature: 0.2, num_predict: numPredict },
  };
}

// PURE: is the configured model in the host's served set? Reads /api/tags' shape; fail-loud otherwise.
export function modelServed(tagsJson, model) {
  const obj = typeof tagsJson === "string" ? JSON.parse(tagsJson) : tagsJson;
  const names = (obj?.models ?? []).map((m) => m.name ?? m.model).filter(Boolean);
  return { served: names.includes(model), names };
}

// PURE: fold the streamed NDJSON into the assistant text. Tolerant of a partial trailing line;
// reports truncation (done_reason==="length") so the caller can retry at a higher budget.
export function accumulateNdjson(text) {
  let content = "";
  let truncated = false;
  let done = false;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let j;
    try { j = JSON.parse(t); } catch { continue; }
    if (typeof j?.message?.content === "string") content += j.message.content;
    if (j?.done) { done = true; if (j.done_reason === "length") truncated = true; }
  }
  return { content, truncated, done };
}

// PURE: the user message — context files (the gateway + touched files, so the reviewer can verify
// existence/structure claims) fenced ahead of the diff. This is the fix for diff-only hallucination.
export function assembleUserMessage({ contextFiles = [], diff = "" }) {
  let s = "";
  for (const f of contextFiles) s += `<file path="${f.path}">\n${f.text}\n</file>\n\n`;
  s += `DIFF UNDER REVIEW:\n\n${diff}`;
  return s;
}

// --- OpenAI-compatible (/v1) pure functions ---

// PURE: the /v1/chat/completions payload. reasoningOff adds chat_template_kwargs:{thinking:false}
// — the OpenAI-compatible analogue of ollama's think:false, needed by reasoning models (e.g. NVIDIA
// deepseek) that else stream empty content. It is OPT-IN: vanilla OpenAI rejects the unknown field,
// so it is sent only when the provider/model needs it. maxTokens caps output (OpenAI's max_tokens,
// the analogue of ollama's num_predict). stream:true keeps a long response's connection alive.
export function buildOpenAiPayload({ model, system, user, maxTokens = DEFAULT_NUM_PREDICT, reasoningOff = false, temperature = 0.2 }) {
  if (!model) throw new Error("buildOpenAiPayload requires a model");
  const body = {
    model,
    stream: true,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  if (reasoningOff) body.chat_template_kwargs = { thinking: false };
  return body;
}

// PURE: is the configured model in the host's /v1/models set? Reads the {data:[{id}]} shape.
export function modelServedOpenAi(modelsJson, model) {
  const obj = typeof modelsJson === "string" ? JSON.parse(modelsJson) : modelsJson;
  const ids = (obj?.data ?? []).map((m) => m.id ?? m.name).filter(Boolean);
  return { served: ids.includes(model), names: ids };
}

// PURE: fold an SSE stream (data: {json}\n\n … data: [DONE]) into the assistant text. Reads
// choices[0].delta.content (streamed) and reports finish_reason==="length" truncation. Tolerant
// fallback: if the body carries no SSE `data:` frames (a provider that ignored stream:true and
// returned one JSON), parse it whole and read choices[0].message.content.
export function accumulateSse(text) {
  let content = "";
  let truncated = false;
  let done = false;
  let sawData = false;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    sawData = true;
    const payload = t.slice(5).trim();
    if (payload === "[DONE]") { done = true; continue; }
    let j;
    try { j = JSON.parse(payload); } catch { continue; }
    const choice = j?.choices?.[0];
    const piece = choice?.delta?.content ?? choice?.message?.content;
    if (typeof piece === "string") content += piece;
    if (choice?.finish_reason) { done = true; if (choice.finish_reason === "length") truncated = true; }
  }
  if (!sawData) {
    // non-streamed fallback: a single completion object
    try {
      const j = JSON.parse(String(text));
      const choice = j?.choices?.[0];
      if (typeof choice?.message?.content === "string") content = choice.message.content;
      if (choice?.finish_reason) { done = true; if (choice.finish_reason === "length") truncated = true; }
    } catch { /* leave content empty — caller treats empty as needs-human */ }
  }
  return { content, truncated, done };
}

// PURE: an HTTP 401/403 from a cloud provider means broken credentials, not infra — needs-human, no retry.
export function isAuthError(err) {
  return /HTTP 40[13]/.test(String(err && err.message));
}

// PURE (FAFF-227): is this a *transient* transport fault that should be retried? Mirrors isAuthError.
// TRUE for a retryable streaming-phase condition — HTTP 5xx, a dropped socket (ECONNRESET/ETIMEDOUT/EPIPE
// or "socket hang up"), or a stream/preflight timeout. FALSE for everything else (4xx incl. auth, usage,
// model-not-served, and anything unrecognised): default-terminal, so the predicate never over-retries a
// real fault. realGet/realStream reject 5xx as `HTTP 5dd: …` and surface socket faults with err.code, so
// both the message and (when present) the code are inspected.
export function isTransientTransport(err) {
  if (!err) return false;
  const msg = String(err.message || "");
  const code = String(err.code || "");
  return /HTTP 5\d\d/.test(msg)                       // 5xx server fault from a reject
    || ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code)
    || /socket hang up/.test(msg)
    || /timed out/.test(msg);                          // realStream / preflight timeout text
}

// Bounded transport-retry policy (FAFF-227): named constants, not magic numbers. attempts counts the
// first try too (3 ⇒ 2 retries). Backoff before retry k (1-indexed) is base_ms * 2^(k-1), each delay
// capped by the time remaining against the caller's --timeout deadline so retries never overrun budget.
export const TRANSPORT_RETRY = { attempts: 3, baseMs: 1500 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wrap a stream call (streamOnce + its truncation retry) in a bounded retry that fires solely on
// isTransientTransport. Terminal faults (auth/4xx/usage) throw straight out — unchanged. On exhaustion,
// or when no budget remains for the next backoff, returns a sentinel so the caller surfaces
// status "transport-failed" (→ main() maps it through unreachableExit, never the unmapped EXIT.OTHER).
async function streamWithTransportRetry(streamCall, { policy = TRANSPORT_RETRY, deadlineMs } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= policy.attempts; attempt++) {
    try {
      return { ok: true, out: await streamCall() };
    } catch (e) {
      if (!isTransientTransport(e)) throw e;            // terminal → out immediately (auth handled by caller's catch)
      lastErr = e;
      if (attempt === policy.attempts) break;           // exhausted
      let delay = policy.baseMs * 2 ** (attempt - 1);
      if (typeof deadlineMs === "number") delay = Math.min(delay, deadlineMs - Date.now());
      if (delay <= 0) break;                            // no budget left to retry
      await sleep(delay);
    }
  }
  return { ok: false, error: lastErr };
}

// --- transport (real impls; injectable in runReview for tests) ---

function realGet(url, timeoutMs = 5000, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: "GET", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300
        ? resolve(data)
        : reject(new Error(`HTTP ${res.statusCode}`))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`preflight timed out after ${timeoutMs}ms`)));
    r.end();
  });
}

// POST the payload and consume the streamed response, concatenating chunks as they arrive (the act of
// reading keeps the connection alive on a long generation). Returns the raw NDJSON text.
function realStream(url, body, timeoutMs = 580000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...extraHeaders };
    const r = lib.request(u, { method: "POST", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300
        ? resolve(data)
        : reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`stream timed out after ${timeoutMs}ms`)));
    r.write(body);
    r.end();
  });
}

// Preflight: probe /api/tags. unreachable (infra) is distinct from not-served (config fault).
export async function preflight({ host, model, getFn = realGet, timeoutMs = 5000 }) {
  let body;
  try { body = await getFn(new URL("/api/tags", host).toString(), timeoutMs); }
  catch (e) { return { unreachable: true, error: e.message }; }
  const { served, names } = modelServed(body, model);
  return { unreachable: false, served, names };
}

async function streamOnce({ host, model, system, user, numPredict, streamFn, timeoutMs }) {
  const body = JSON.stringify(buildChatPayload({ model, system, user, numPredict }));
  const raw = await streamFn(new URL("/api/chat", host).toString(), body, timeoutMs);
  return accumulateNdjson(raw);
}

// ollama orchestration: preflight → stream → one truncation retry at 2× budget. getFn/streamFn injectable.
// The stream (+ its truncation retry) is wrapped in a bounded transport retry (FAFF-227): a transient
// mid-stream fault retries; an exhausted one surfaces status "transport-failed" → main() maps it to a
// documented exit, never the unmapped EXIT.OTHER.
async function runReviewOllama({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT,
  getFn = realGet, streamFn = realStream, timeoutMs,
}) {
  const pf = await preflight({ host, model, getFn });
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  const streamCall = async () => {
    let out = await streamOnce({ host, model, system, user, numPredict, streamFn, timeoutMs });
    if (out.truncated) {
      out = await streamOnce({ host, model, system, user, numPredict: numPredict * 2, streamFn, timeoutMs });
    }
    return out;
  };
  const deadlineMs = typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined;
  const r = await streamWithTransportRetry(streamCall, { deadlineMs });
  if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
  return { status: "ok", content: r.out.content, truncated: r.out.truncated };
}

// OpenAI-compatible preflight: GET /v1/models with Bearer auth. unreachable (infra) and auth-failed
// (401/403 creds) are distinct from not-served (config fault).
export async function preflightOpenAi({ host, model, apiKey, getFn = realGet, timeoutMs = 5000 }) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  let body;
  try { body = await getFn(joinUrl(host, "/models"), timeoutMs, headers); }
  catch (e) {
    if (isAuthError(e)) return { authFailed: true, error: e.message };
    return { unreachable: true, error: e.message };
  }
  const { served, names } = modelServedOpenAi(body, model);
  return { unreachable: false, served, names };
}

async function streamOnceOpenAi({ host, model, system, user, numPredict, reasoningOff, apiKey, streamFn, timeoutMs }) {
  const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const body = JSON.stringify(buildOpenAiPayload({ model, system, user, maxTokens: numPredict, reasoningOff }));
  const raw = await streamFn(joinUrl(host, "/chat/completions"), body, timeoutMs, headers);
  return accumulateSse(raw);
}

// OpenAI-compatible orchestration: mirrors the ollama path (preflight → stream → one 2× retry),
// adding Bearer auth and an auth-failed branch. The stream (+ truncation retry) is wrapped in the same
// bounded transport retry as ollama (FAFF-227): a transient mid-stream fault retries; an auth fault is
// terminal (isTransientTransport is FALSE for 401/403, so the wrapper rethrows it into the auth catch);
// an exhausted transport fault surfaces status "transport-failed" → a documented exit, never EXIT.OTHER.
async function runReviewOpenAi({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT, reasoningOff = false, apiKey,
  getFn = realGet, streamFn = realStream, timeoutMs,
}) {
  const pf = await preflightOpenAi({ host, model, apiKey, getFn });
  if (pf.authFailed) return { status: "auth-failed", note: pf.error };
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  try {
    const streamCall = async () => {
      let out = await streamOnceOpenAi({ host, model, system, user, numPredict, reasoningOff, apiKey, streamFn, timeoutMs });
      if (out.truncated) {
        out = await streamOnceOpenAi({ host, model, system, user, numPredict: numPredict * 2, reasoningOff, apiKey, streamFn, timeoutMs });
      }
      return out;
    };
    const deadlineMs = typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined;
    const r = await streamWithTransportRetry(streamCall, { deadlineMs });
    if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
    return { status: "ok", content: r.out.content, truncated: r.out.truncated };
  } catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    throw e;
  }
}

// Dispatcher: routes on the configured provider's transport family. Default (no provider) is ollama,
// preserving the original behaviour and signature.
export async function runReview(opts = {}) {
  const fam = providerFamily(opts.provider);
  if (fam === "openai") return runReviewOpenAi(opts);
  if (fam === "ollama") return runReviewOllama(opts);
  return { status: "unsupported-provider", note: `provider '${opts.provider}' has no transport in review-call.mjs (use an OpenAI-compatible base URL, or ollama)` };
}

// --- CLI ---

export function parseArgs(argv) {
  // hostSource defaults to "config" so existing callers (which never pass --host-source) keep the
  // exit-5 pass+skip behaviour unchanged. "default" signals the host is only the localhost fallback.
  const a = { context: [], hostSource: "config" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--host") a.host = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--system") a.system = argv[++i];
    else if (k === "--diff") a.diff = argv[++i];
    else if (k === "--context") a.context.push(argv[++i]);
    else if (k === "--num-predict") a.numPredict = Number(argv[++i]);
    else if (k === "--timeout") a.timeoutMs = Number(argv[++i]) * 1000;
    else if (k === "--host-source") a.hostSource = argv[++i];
    else if (k === "--provider") a.provider = argv[++i];
    else if (k === "--api-key-env") a.apiKeyEnv = argv[++i];
    else if (k === "--reasoning-off") a.reasoningOff = true;
  }
  return a;
}

// `runReviewFn` is injectable so the CLI exit-mapping (notably the FAFF-227 transport-failed → 5/6 path)
// is unit-testable with a stubbed orchestration result; it defaults to the real runReview for the CLI.
export async function main(argv, { runReviewFn = runReview } = {}) {
  const a = parseArgs(argv);
  if (!a.host || !a.model || !a.system || !a.diff) {
    process.stderr.write("usage: review-call.mjs --host H --model M --system FILE --diff FILE [--context FILE]... [--num-predict N] [--timeout S] [--host-source config|default] [--provider P] [--api-key-env VAR] [--reasoning-off]\n");
    return EXIT.USAGE;
  }
  // Resolve the API key from the NAMED env var (never the key itself on the command line / in config).
  let apiKey;
  if (a.apiKeyEnv) {
    apiKey = process.env[a.apiKeyEnv];
    if (!apiKey) {
      process.stderr.write(`api key env var '${a.apiKeyEnv}' is unset/empty\n`);
      return EXIT.AUTH;
    }
  }
  const system = readFileSync(a.system, "utf8");
  const diff = readFileSync(a.diff, "utf8");
  const contextFiles = a.context.map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
  const user = assembleUserMessage({ contextFiles, diff });

  const r = await runReviewFn({
    host: a.host, model: a.model, system, user, numPredict: a.numPredict, timeoutMs: a.timeoutMs,
    provider: a.provider, apiKey, reasoningOff: a.reasoningOff,
  });
  if (r.status === "unsupported-provider") {
    process.stderr.write(`${r.note}\n`);
    return EXIT.USAGE;
  }
  if (r.status === "model-not-served") {
    process.stderr.write(`model '${a.model}' not served by ${a.host}; available: ${r.names.join(", ")}\n`);
    return EXIT.NOT_SERVED;
  }
  if (r.status === "auth-failed") {
    process.stderr.write(`auth failed for ${a.host}: ${r.note}\n`);
    return EXIT.AUTH;
  }
  if (r.status === "unreachable") {
    const exit = unreachableExit({ hostSource: a.hostSource });
    const provenance = exit === EXIT.DEFAULT_HOST_UNREACHABLE
      ? "default localhost — provider unconfigured (needs-human)"
      : "configured host unreachable (pass+skip)";
    process.stderr.write(`provider unreachable (${a.host}): ${r.note} — ${provenance}\n`);
    return exit;
  }
  if (r.status === "transport-failed") {
    // FAFF-227: a persistent mid-stream transport fault routes through the SAME unreachableExit path as a
    // preflight-unreachable host (5 pass+skip / 6 needs-human, per host-source) — never the unmapped exit 1.
    // A distinct stderr note keeps it debuggable apart from a preflight unreachable.
    const exit = unreachableExit({ hostSource: a.hostSource });
    const provenance = exit === EXIT.DEFAULT_HOST_UNREACHABLE
      ? "default localhost — provider unconfigured (needs-human)"
      : "configured host unreachable (pass+skip)";
    process.stderr.write(`mid-stream transport failure after ${TRANSPORT_RETRY.attempts} attempts (${a.host}): ${r.note} — ${provenance}\n`);
    return exit;
  }
  if (r.truncated) process.stderr.write("[note] response truncated at token budget even after retry; findings may be partial\n");
  process.stdout.write(r.content.trim() + "\n");
  return EXIT.OK;
}

if (process.argv[1] && process.argv[1].endsWith("review-call.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`review-call: ${e.message}\n`); process.exitCode = EXIT.OTHER; });
}
