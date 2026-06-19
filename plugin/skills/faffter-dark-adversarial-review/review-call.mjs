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
// 5 provider-unreachable (→ pass+skip) · 2 usage · 1 other.
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2, NOT_SERVED: 4, UNREACHABLE: 5 };
export const DEFAULT_NUM_PREDICT = 2000;

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

// --- transport (real impls; injectable in runReview for tests) ---

function realGet(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: "GET" }, (res) => {
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
function realStream(url, body, timeoutMs = 580000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
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

// Orchestration: preflight → stream → one truncation retry at 2× budget. getFn/streamFn injectable.
export async function runReview({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT,
  getFn = realGet, streamFn = realStream, timeoutMs,
}) {
  const pf = await preflight({ host, model, getFn });
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  let out = await streamOnce({ host, model, system, user, numPredict, streamFn, timeoutMs });
  if (out.truncated) {
    out = await streamOnce({ host, model, system, user, numPredict: numPredict * 2, streamFn, timeoutMs });
  }
  return { status: "ok", content: out.content, truncated: out.truncated };
}

// --- CLI ---

export function parseArgs(argv) {
  const a = { context: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--host") a.host = argv[++i];
    else if (k === "--model") a.model = argv[++i];
    else if (k === "--system") a.system = argv[++i];
    else if (k === "--diff") a.diff = argv[++i];
    else if (k === "--context") a.context.push(argv[++i]);
    else if (k === "--num-predict") a.numPredict = Number(argv[++i]);
    else if (k === "--timeout") a.timeoutMs = Number(argv[++i]) * 1000;
  }
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (!a.host || !a.model || !a.system || !a.diff) {
    process.stderr.write("usage: review-call.mjs --host H --model M --system FILE --diff FILE [--context FILE]... [--num-predict N] [--timeout S]\n");
    return EXIT.USAGE;
  }
  const system = readFileSync(a.system, "utf8");
  const diff = readFileSync(a.diff, "utf8");
  const contextFiles = a.context.map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
  const user = assembleUserMessage({ contextFiles, diff });

  const r = await runReview({ host: a.host, model: a.model, system, user, numPredict: a.numPredict, timeoutMs: a.timeoutMs });
  if (r.status === "model-not-served") {
    process.stderr.write(`model '${a.model}' not served by ${a.host}; available: ${r.names.join(", ")}\n`);
    return EXIT.NOT_SERVED;
  }
  if (r.status === "unreachable") {
    process.stderr.write(`provider unreachable (${a.host}): ${r.note}\n`);
    return EXIT.UNREACHABLE;
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
