// FAFF-136 — direct ollama /api/chat model for the live driver: a single completion, NO agent loop.
//
// Path B of ADR-0004's driver fork. Every other driver uses the agentic `claude -p` loop (~26 min/rep
// on the local 27B — FAFF-131 smoke). A direct /api/chat completion is ~seconds/rep, making a local
// model-sweep viable. It measures the model+prompt judgement (less faithful than the agentic skill
// path) but isolates judgement-flakiness cleanly. This is the HTTP transport FAFF-132 deliberately
// dropped — reintroduced for LOCAL speed, justified by the measured agentic cost.
//
// Slots into liveDriver({ model }) (FAFF-135) exactly where makeLiveModel (the claude -p one) sits:
// the returned model(prompt) -> rawText carries the `faff-eval:judgement` block the grader parses.
//
// buildOllamaRequest + parseOllamaResponse are PURE; `post` is injectable so CI makes zero real
// calls (importing this module opens no socket). Zero-dependency: node:http(s) only.

import http from "node:http";
import https from "node:https";

// PURE: the request spec for ollama's /api/chat (single, non-streaming completion).
// FAFF-137: `think` (false disables a reasoning model's hidden think-block — essential for local
// speed: ~12s vs 5min+ on qwen3.6) and pass-through `options` are included only when defined.
export function buildOllamaRequest({ baseUrl, model, think, options } = {}, prompt) {
  if (!baseUrl) throw new Error("makeOllamaModel requires a baseUrl (the ollama host); no localhost default");
  if (!model) throw new Error("makeOllamaModel requires a model");
  const url = new URL("/api/chat", baseUrl).toString();
  const payload = { model, messages: [{ role: "user", content: prompt }], stream: false };
  if (think !== undefined) payload.think = think;
  if (options !== undefined) payload.options = options;
  const body = JSON.stringify(payload);
  return {
    url,
    method: "POST",
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
    body,
  };
}

// PURE: extract the assistant text from an /api/chat response. Fail-loud on a shape it doesn't know.
export function parseOllamaResponse(json) {
  const obj = typeof json === "string" ? JSON.parse(json) : json;
  const content = obj?.message?.content;
  if (typeof content !== "string") {
    throw new Error(`ollama response missing message.content: ${JSON.stringify(obj).slice(0, 200)}`);
  }
  return content;
}

// Default transport: POST the request and resolve the raw response body (a string). Replaceable in
// tests. Fail-loud on non-2xx or timeout.
function defaultPost(req, { timeoutMs = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: req.method, headers: req.headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`ollama HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        } else {
          resolve(data);
        }
      });
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`ollama request timed out after ${timeoutMs}ms`)));
    r.write(req.body);
    r.end();
  });
}

// A live-driver model fn backed by a direct ollama /api/chat completion. `post` is injectable
// (default = real http(s)); tests pass a mock so CI makes zero real calls.
export function makeOllamaModel({ baseUrl, model, think, options, post = defaultPost, timeoutMs } = {}) {
  return async function ollamaModel(prompt) {
    const req = buildOllamaRequest({ baseUrl, model, think, options }, prompt);
    const raw = await post(req, { timeoutMs });
    return parseOllamaResponse(raw);
  };
}
