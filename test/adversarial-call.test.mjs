// FAFF-183 — adversarial review backend call: pure functions + injectable-transport orchestration.
// Zero live model calls — getFn/streamFn are mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChatPayload, modelServed, accumulateNdjson, assembleUserMessage,
  preflight, runReview, parseArgs, unreachableExit, EXIT, DEFAULT_NUM_PREDICT,
  buildOpenAiPayload, modelServedOpenAi, accumulateSse, isAuthError,
  providerFamily, joinUrl, preflightOpenAi,
  isTransientTransport, TRANSPORT_RETRY, main,
  runReviewChain, chainTerminalExit, mapResultExit, CHAIN_NEEDS_HUMAN,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

test("buildChatPayload sets think:false + stream:true + the default token budget", () => {
  const p = buildChatPayload({ model: "m", system: "S", user: "U" });
  assert.equal(p.think, false, "think disabled (reasoning models would else return empty content)");
  assert.equal(p.stream, true, "streamed (long responses else drop the connection)");
  assert.equal(p.options.num_predict, DEFAULT_NUM_PREDICT);
  assert.deepEqual(p.messages.map((m) => m.role), ["system", "user"]);
  assert.equal(p.messages[1].content, "U");
});

test("buildChatPayload honours an explicit num_predict", () => {
  assert.equal(buildChatPayload({ model: "m", system: "", user: "", numPredict: 4000 }).options.num_predict, 4000);
});

test("modelServed reads /api/tags and matches exactly (the hyphen/colon typo case)", () => {
  const tags = { models: [{ name: "qwen3.6:27b-mlx" }, { name: "smollm2:135m" }] };
  assert.equal(modelServed(tags, "qwen3.6:27b-mlx").served, true);
  const miss = modelServed(tags, "qwen3.6-27b-mlx"); // the real FAFF-181 typo
  assert.equal(miss.served, false);
  assert.deepEqual(miss.names, ["qwen3.6:27b-mlx", "smollm2:135m"]);
});

test("accumulateNdjson folds streamed content + flags length-truncation, tolerating a bad line", () => {
  const stream = [
    JSON.stringify({ message: { content: "Hello " } }),
    "not json — partial frame",
    JSON.stringify({ message: { content: "world" } }),
    JSON.stringify({ done: true, done_reason: "length" }),
  ].join("\n");
  const r = accumulateNdjson(stream);
  assert.equal(r.content, "Hello world");
  assert.equal(r.truncated, true);
  assert.equal(r.done, true);
});

test("accumulateNdjson: a clean stop is not truncated", () => {
  const r = accumulateNdjson(JSON.stringify({ message: { content: "x" }, done: true, done_reason: "stop" }));
  assert.equal(r.truncated, false);
});

test("assembleUserMessage fences context files ahead of the diff (the no-hallucination fix)", () => {
  const u = assembleUserMessage({ contextFiles: [{ path: "plugin/skills/faff/SKILL.md", text: "GATEWAY" }], diff: "DIFF" });
  assert.match(u, /<file path="plugin\/skills\/faff\/SKILL\.md">\nGATEWAY\n<\/file>/);
  assert.ok(u.indexOf("GATEWAY") < u.indexOf("DIFF UNDER REVIEW"), "context precedes the diff");
});

test("preflight: unreachable host (infra) is distinct from not-served (config)", async () => {
  const down = await preflight({ host: "http://h:1", model: "m", getFn: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.unreachable, true);
  const up = await preflight({ host: "http://h:1", model: "m", getFn: async () => JSON.stringify({ models: [{ name: "other" }] }) });
  assert.equal(up.unreachable, false);
  assert.equal(up.served, false);
});

test("runReview: model-not-served → status model-not-served (skill maps to needs-human, never pass)", async () => {
  const r = await runReview({
    host: "http://h:1", model: "typo", system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "real" }] }),
    streamFn: async () => { throw new Error("should not stream when not served"); },
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["real"]);
});

test("runReview: unreachable → status unreachable (skill maps to pass+skip)", async () => {
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U",
    getFn: async () => { throw new Error("timeout"); },
    streamFn: async () => { throw new Error("unused"); },
  });
  assert.equal(r.status, "unreachable");
});

test("runReview: happy path streams findings", async () => {
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => [
      JSON.stringify({ message: { content: "### finding" } }),
      JSON.stringify({ done: true, done_reason: "stop" }),
    ].join("\n"),
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(r.truncated, false);
});

test("runReview: truncation triggers exactly one retry at 2× the token budget", async () => {
  const budgets = [];
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", numPredict: 1000,
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).options.num_predict);
      const first = budgets.length === 1;
      return JSON.stringify({ message: { content: first ? "partial" : "full" }, done: true, done_reason: first ? "length" : "stop" });
    },
  });
  assert.deepEqual(budgets, [1000, 2000], "one retry at double budget");
  assert.equal(r.content, "full");
  assert.equal(r.truncated, false);
});

test("parseArgs collects repeated --context and the scalar flags", () => {
  const a = parseArgs(["--host", "http://h", "--model", "m", "--system", "s.txt", "--diff", "d.txt", "--context", "a", "--context", "b", "--num-predict", "1500"]);
  assert.equal(a.host, "http://h");
  assert.equal(a.model, "m");
  assert.deepEqual(a.context, ["a", "b"]);
  assert.equal(a.numPredict, 1500);
});

test("EXIT codes: not-served, unreachable, default-host-unreachable, auth are distinct + non-zero", () => {
  assert.equal(EXIT.OK, 0);
  assert.equal(EXIT.NOT_SERVED, 4);
  assert.equal(EXIT.UNREACHABLE, 5);
  assert.equal(EXIT.DEFAULT_HOST_UNREACHABLE, 6);
  assert.equal(EXIT.AUTH, 7); // renumbered from 6 → 7 after FAFF-213 took exit 6
  assert.equal(new Set([EXIT.NOT_SERVED, EXIT.UNREACHABLE, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH]).size, 4);
});

// --- OpenAI-compatible (/v1) path: NVIDIA NIM, OpenAI, vLLM, OpenRouter, DeepSeek ---

test("providerFamily maps the OpenAI-compatible set to openai, ollama to ollama, else passthrough", () => {
  for (const p of ["openai", "vllm", "openrouter", "nvidia", "deepseek", "openai-compatible"]) {
    assert.equal(providerFamily(p), "openai", p);
  }
  assert.equal(providerFamily("ollama"), "ollama");
  assert.equal(providerFamily(undefined), "ollama", "default is ollama (preserves original behaviour)");
  assert.equal(providerFamily("gemini"), "gemini", "native-format providers pass through → unsupported");
});

test("joinUrl appends the endpoint without dropping the base /v1 (the new URL trap)", () => {
  assert.equal(joinUrl("https://integrate.api.nvidia.com/v1", "/models"), "https://integrate.api.nvidia.com/v1/models");
  assert.equal(joinUrl("https://integrate.api.nvidia.com/v1/", "/chat/completions"), "https://integrate.api.nvidia.com/v1/chat/completions");
});

test("buildOpenAiPayload: stream + max_tokens, reasoning-off OPT-IN (vanilla OpenAI rejects the field)", () => {
  const off = buildOpenAiPayload({ model: "deepseek-ai/deepseek-v4-pro", system: "S", user: "U", reasoningOff: true });
  assert.equal(off.stream, true);
  assert.equal(off.max_tokens, DEFAULT_NUM_PREDICT);
  assert.deepEqual(off.chat_template_kwargs, { thinking: false }, "thinking disabled for reasoning models");
  assert.deepEqual(off.messages.map((m) => m.role), ["system", "user"]);

  const on = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U" });
  assert.equal("chat_template_kwargs" in on, false, "not sent unless reasoningOff — keeps vanilla OpenAI happy");
  assert.equal(buildOpenAiPayload({ model: "m", system: "", user: "", maxTokens: 9000 }).max_tokens, 9000);
});

test("modelServedOpenAi reads the {data:[{id}]} shape and matches exactly", () => {
  const models = { data: [{ id: "deepseek-ai/deepseek-v4-pro" }, { id: "meta/llama-3.1-70b" }] };
  assert.equal(modelServedOpenAi(models, "deepseek-ai/deepseek-v4-pro").served, true);
  const miss = modelServedOpenAi(models, "deepseek-ai/deepseek-v4");
  assert.equal(miss.served, false);
  assert.deepEqual(miss.names, ["deepseek-ai/deepseek-v4-pro", "meta/llama-3.1-70b"]);
});

test("accumulateSse folds delta.content, flags length-truncation, honours [DONE], tolerates a bad frame", () => {
  const sse = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}`,
    "data: not json",
    `data: ${JSON.stringify({ choices: [{ delta: { content: "world" }, finish_reason: "length" }] })}`,
    "data: [DONE]",
  ].join("\n");
  const r = accumulateSse(sse);
  assert.equal(r.content, "Hello world");
  assert.equal(r.truncated, true);
  assert.equal(r.done, true);
});

test("accumulateSse: clean stop is not truncated", () => {
  const r = accumulateSse(`data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })}\ndata: [DONE]`);
  assert.equal(r.content, "x");
  assert.equal(r.truncated, false);
});

test("accumulateSse: non-streamed fallback (provider ignored stream:true → one completion object)", () => {
  const whole = JSON.stringify({ choices: [{ message: { content: "single-shot" }, finish_reason: "stop" }] });
  const r = accumulateSse(whole);
  assert.equal(r.content, "single-shot");
  assert.equal(r.done, true);
});

test("isAuthError: 401/403 are auth (no retry); 404/timeout are not", () => {
  assert.equal(isAuthError(new Error("HTTP 401")), true);
  assert.equal(isAuthError(new Error("HTTP 403")), true);
  assert.equal(isAuthError(new Error("HTTP 404")), false);
  assert.equal(isAuthError(new Error("stream timed out")), false);
});

test("preflightOpenAi: served / not-served / unreachable / auth-failed are all distinguished + Bearer sent", async () => {
  let seenHeaders;
  const getOk = async (_url, _t, headers) => { seenHeaders = headers; return JSON.stringify({ data: [{ id: "m" }] }); };
  const served = await preflightOpenAi({ host: "https://h/v1", model: "m", apiKey: "K", getFn: getOk });
  assert.equal(served.served, true);
  assert.equal(seenHeaders.authorization, "Bearer K", "Bearer auth attached on preflight");

  const notServed = await preflightOpenAi({ host: "https://h/v1", model: "typo", apiKey: "K", getFn: getOk });
  assert.equal(notServed.served, false);

  const auth = await preflightOpenAi({ host: "https://h/v1", model: "m", apiKey: "bad", getFn: async () => { throw new Error("HTTP 401"); } });
  assert.equal(auth.authFailed, true);

  const down = await preflightOpenAi({ host: "https://h/v1", model: "m", apiKey: "K", getFn: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(down.unreachable, true);
});

test("runReview dispatch → openai: happy path streams SSE findings + sends Bearer on the POST", async () => {
  let streamHeaders;
  const r = await runReview({
    provider: "nvidia", host: "https://integrate.api.nvidia.com/v1", model: "deepseek-ai/deepseek-v4-pro",
    system: "S", user: "U", apiKey: "nv-KEY", reasoningOff: true,
    getFn: async () => JSON.stringify({ data: [{ id: "deepseek-ai/deepseek-v4-pro" }] }),
    streamFn: async (_url, body, _t, headers) => {
      streamHeaders = headers;
      assert.deepEqual(JSON.parse(body).chat_template_kwargs, { thinking: false }, "reasoning-off carried into the body");
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(streamHeaders.authorization, "Bearer nv-KEY");
});

test("runReview dispatch → openai: SSE truncation triggers exactly one retry at 2× max_tokens", async () => {
  const budgets = [];
  const r = await runReview({
    provider: "openai", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", numPredict: 1000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).max_tokens);
      const first = budgets.length === 1;
      return `data: ${JSON.stringify({ choices: [{ delta: { content: first ? "partial" : "full" }, finish_reason: first ? "length" : "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.deepEqual(budgets, [1000, 2000], "one retry at double budget");
  assert.equal(r.content, "full");
});

test("runReview dispatch → openai: auth failure surfaces status auth-failed (skill → needs-human, no retry)", async () => {
  const r = await runReview({
    provider: "openai", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "bad",
    getFn: async () => { throw new Error("HTTP 401 Unauthorized"); },
    streamFn: async () => { throw new Error("should not stream on auth failure"); },
  });
  assert.equal(r.status, "auth-failed");
});

test("runReview dispatch → openai: model-not-served maps the same as ollama (→ needs-human)", async () => {
  const r = await runReview({
    provider: "vllm", host: "https://h/v1", model: "absent", system: "S", user: "U", apiKey: "K",
    getFn: async () => JSON.stringify({ data: [{ id: "present" }] }),
    streamFn: async () => { throw new Error("should not stream when not served"); },
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["present"]);
});

test("runReview dispatch → unknown provider returns unsupported-provider (loud, not silent-pass)", async () => {
  const r = await runReview({ provider: "anthropic", host: "https://h", model: "claude", system: "S", user: "U" });
  assert.equal(r.status, "unsupported-provider");
  assert.match(r.note, /OpenAI-compatible/);
});

test("runReview with no provider still routes to ollama (back-compat — original signature unchanged)", async () => {
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => JSON.stringify({ message: { content: "ollama-finding" }, done: true, done_reason: "stop" }),
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "ollama-finding");
});

test("parseArgs collects the new --provider / --api-key-env / --reasoning-off flags", () => {
  const a = parseArgs(["--host", "https://h/v1", "--model", "m", "--system", "s", "--diff", "d",
    "--provider", "nvidia", "--api-key-env", "NVIDIA_API_KEY", "--reasoning-off"]);
  assert.equal(a.provider, "nvidia");
  assert.equal(a.apiKeyEnv, "NVIDIA_API_KEY");
  assert.equal(a.reasoningOff, true);
});

// --- FAFF-213: fail loud when the host is the unconfigured localhost default ---

test("EXIT.DEFAULT_HOST_UNREACHABLE === 6, distinct from NOT_SERVED (4) and UNREACHABLE (5)", () => {
  assert.equal(EXIT.DEFAULT_HOST_UNREACHABLE, 6); // AC 1
  assert.notEqual(EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.NOT_SERVED);
  assert.notEqual(EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.UNREACHABLE);
});

test("parseArgs: --host-source default is collected; omitting it defaults to config (back-compat)", () => {
  assert.equal(parseArgs(["--host-source", "default"]).hostSource, "default"); // AC 2
  assert.equal(parseArgs(["--host-source", "config"]).hostSource, "config");
  // existing callers never pass the flag → unchanged exit-5 behaviour
  assert.equal(parseArgs(["--host", "http://h", "--model", "m"]).hostSource, "config");
});

test("unreachableExit: default-host down → exit 6 (needs-human); configured host down → exit 5 (pass+skip)", () => {
  // AC 3 — pure, no I/O, no live call: an explicitly-configured host that's down stays exit 5;
  // a default localhost fallback that's down → exit 6.
  assert.equal(unreachableExit({ hostSource: "default" }), EXIT.DEFAULT_HOST_UNREACHABLE);
  assert.equal(unreachableExit({ hostSource: "config" }), EXIT.UNREACHABLE);
  // an explicitly-configured localhost is still "config" → stays exit 5 (the host string is irrelevant)
  assert.equal(unreachableExit({ hostSource: "config" }), 5);
  // missing/omitted provenance is treated as config (back-compat with existing callers)
  assert.equal(unreachableExit({}), EXIT.UNREACHABLE);
  assert.equal(unreachableExit(), EXIT.UNREACHABLE);
});

// --- FAFF-227: bounded transient-transport retry; persistent fault → documented exit, never unmapped 1 ---

test("isTransientTransport: 5xx / dropped-socket / timeout / 429 are transient; other 4xx, auth, usage, unknown are not", () => {
  // transient (retry) — incl. HTTP 429 rate-limit (FAFF-228): a throttle is transient infra, not a request fault
  for (const m of ["HTTP 504", "HTTP 502: bad gateway", "HTTP 500", "stream timed out after 580000ms", "preflight timed out after 5000ms", "socket hang up", "HTTP 429", "HTTP 429: rate limited"]) {
    assert.equal(isTransientTransport(new Error(m)), true, m);
  }
  for (const code of ["ECONNRESET", "ETIMEDOUT", "EPIPE"]) {
    const e = new Error("write failed"); e.code = code;
    assert.equal(isTransientTransport(e), true, code);
  }
  // terminal (no retry) — 4xx *other than 429* incl. auth, usage, model-not-served text, anything unrecognised.
  // 429 is deliberately NOT here (FAFF-228); only 429 among the 4xx flips transient — 401/403/404/400 stay terminal.
  for (const m of ["HTTP 401", "HTTP 403", "HTTP 404", "HTTP 400 Bad Request", "usage error", "model 'x' not served", "some other error"]) {
    assert.equal(isTransientTransport(new Error(m)), false, m);
  }
  assert.equal(isTransientTransport(null), false);
  assert.equal(isTransientTransport(undefined), false);
  // a 5xx still wins even with no err.code set; ECONNREFUSED (connection refused, a preflight-class infra
  // signal) is intentionally NOT transient here — the streaming-phase retry targets mid-stream drops/5xx.
  const refused = new Error("ECONNREFUSED"); refused.code = "ECONNREFUSED";
  assert.equal(isTransientTransport(refused), false, "ECONNREFUSED is not a mid-stream transient");
});

test("TRANSPORT_RETRY policy defaults: 3 attempts (2 retries), exponential backoff base — named, not magic", () => {
  assert.equal(TRANSPORT_RETRY.attempts, 3);
  assert.ok(TRANSPORT_RETRY.baseMs > 0);
});

test("runReview ollama: a transient mid-stream fault retries once then succeeds → status ok", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 504: gateway timeout"); // transient
      return JSON.stringify({ message: { content: "### finding" }, done: true, done_reason: "stop" });
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(calls, 2, "retried exactly once after the transient fault");
});

// FAFF-228: an HTTP 429 rate-limit is transient — it rides the same retry path as a 5xx (both providers).
test("runReview ollama: an HTTP 429 rate-limit retries once then succeeds → status ok (FAFF-228)", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 429: rate limited"); // transient throttle
      return JSON.stringify({ message: { content: "### finding" }, done: true, done_reason: "stop" });
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(calls, 2, "retried exactly once after the 429");
});

test("runReview openai: an HTTP 429 rate-limit retries once then succeeds → status ok (FAFF-228)", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "nvidia", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 429: Too Many Requests"); // transient throttle
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(calls, 2, "retried exactly once after the 429");
});

test("runReview ollama: a persistent HTTP 429 exhausts retries → status transport-failed (FAFF-228)", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", timeoutMs: 0, // deadline passed → no sleeps
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => { calls += 1; throw new Error("HTTP 429: rate limited"); },
  });
  assert.equal(r.status, "transport-failed");
  assert.match(r.note, /HTTP 429/);
  assert.ok(calls >= 1, "attempted at least once");
});

test("runReview ollama: a persistent transient fault exhausts retries → status transport-failed", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", timeoutMs: 0, // deadline already passed → no sleeps
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async () => { calls += 1; throw new Error("HTTP 504"); },
  });
  assert.equal(r.status, "transport-failed");
  assert.match(r.note, /HTTP 504/);
  assert.ok(calls >= 1, "attempted at least once");
});

test("runReview openai: transient mid-stream fault retries once then succeeds → status ok", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "nvidia", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) { const e = new Error("socket hang up"); throw e; } // transient
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(calls, 2);
});

test("runReview openai: a persistent transient fault → status transport-failed", async () => {
  const r = await runReview({
    provider: "openai", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 0,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => { const e = new Error("read ECONNRESET"); e.code = "ECONNRESET"; throw e; },
  });
  assert.equal(r.status, "transport-failed");
});

test("runReview openai: an auth fault mid-stream is NOT retried → auth-failed (terminal, no retry)", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "openai", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "bad", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => { calls += 1; throw new Error("HTTP 401 Unauthorized"); },
  });
  assert.equal(r.status, "auth-failed");
  assert.equal(calls, 1, "auth is terminal — streamed exactly once, never retried");
});

test("runReview openai: a non-auth 4xx mid-stream is NOT retried (terminal) → bubbles up, not transport-failed", async () => {
  let calls = 0;
  await assert.rejects(
    runReview({
      provider: "openai", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 600000,
      getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
      streamFn: async () => { calls += 1; throw new Error("HTTP 400 Bad Request"); },
    }),
    /HTTP 400/,
  );
  assert.equal(calls, 1, "a 4xx is terminal — never retried");
});

test("runReview ollama: truncation retry still composes with the transport retry (regression)", async () => {
  // First stream truncates → one truncation retry at 2× budget; no transport fault → no transport retry.
  const budgets = [];
  const r = await runReview({
    host: "http://h:1", model: "m", system: "S", user: "U", numPredict: 1000, timeoutMs: 600000,
    getFn: async () => JSON.stringify({ models: [{ name: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).options.num_predict);
      const first = budgets.length === 1;
      return JSON.stringify({ message: { content: first ? "partial" : "full" }, done: true, done_reason: first ? "length" : "stop" });
    },
  });
  assert.deepEqual(budgets, [1000, 2000], "truncation retry unchanged");
  assert.equal(r.content, "full");
  assert.equal(r.truncated, false);
});

// main() exit-mapping: a persistent transport failure must map to a DOCUMENTED exit (5 / 6), never the
// unmapped EXIT.OTHER (1). Uses injected runReviewFn + temp --system/--diff files (main reads them).
function writeMainFixtures() {
  const dir = mkdtempSync(join(tmpdir(), "faff227-"));
  const sys = join(dir, "system.txt"); const diff = join(dir, "diff.txt");
  writeFileSync(sys, "REVIEW LENS"); writeFileSync(diff, "DIFF");
  return { sys, diff };
}

test("main(): persistent transport-failed with --host-source config → EXIT.UNREACHABLE (5), never OTHER (1)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"],
    { runReviewFn: async () => ({ status: "transport-failed", note: "HTTP 504" }) },
  );
  assert.equal(code, EXIT.UNREACHABLE);
  assert.notEqual(code, EXIT.OTHER);
});

test("main(): persistent transport-failed with --host-source default → EXIT.DEFAULT_HOST_UNREACHABLE (6), never OTHER (1)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://localhost:11434", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "default"],
    { runReviewFn: async () => ({ status: "transport-failed", note: "HTTP 504" }) },
  );
  assert.equal(code, EXIT.DEFAULT_HOST_UNREACHABLE);
  assert.notEqual(code, EXIT.OTHER);
});

// FAFF-228: a persistent HTTP 429 surfaces as transport-failed and so inherits the SAME documented exit
// mapping (5 config / 6 default) — never the unmapped EXIT.OTHER (1) it used to return as a terminal 4xx.
test("main(): persistent HTTP 429 with --host-source config → EXIT.UNREACHABLE (5), never OTHER (1) (FAFF-228)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "https://h/v1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"],
    { runReviewFn: async () => ({ status: "transport-failed", note: "HTTP 429: rate limited" }) },
  );
  assert.equal(code, EXIT.UNREACHABLE);
  assert.notEqual(code, EXIT.OTHER);
});

test("main(): persistent HTTP 429 with --host-source default → EXIT.DEFAULT_HOST_UNREACHABLE (6), never OTHER (1) (FAFF-228)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://localhost:11434", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "default"],
    { runReviewFn: async () => ({ status: "transport-failed", note: "HTTP 429: rate limited" }) },
  );
  assert.equal(code, EXIT.DEFAULT_HOST_UNREACHABLE);
  assert.notEqual(code, EXIT.OTHER);
});

// ===========================================================================
// FAFF-232 — ordered fallback chain of backends
// ===========================================================================

test("FAFF-232 chainTerminalExit: availability-only chain → UNREACHABLE (5, pass+skip)", () => {
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.UNREACHABLE]), EXIT.UNREACHABLE);
});

test("FAFF-232 chainTerminalExit: any config-fault class dominates pass+skip → needs-human", () => {
  // 5s present, but an AUTH(7) anywhere wins (no silent weakening — the fault surfaces).
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.AUTH]), EXIT.AUTH);
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.NOT_SERVED]), EXIT.NOT_SERVED);
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.DEFAULT_HOST_UNREACHABLE]), EXIT.DEFAULT_HOST_UNREACHABLE);
  assert.equal(chainTerminalExit([EXIT.USAGE, EXIT.UNREACHABLE]), EXIT.USAGE);
});

test("FAFF-232 chainTerminalExit: returns the FIRST needs-human class in chain order; empty → 5", () => {
  assert.equal(chainTerminalExit([EXIT.AUTH, EXIT.NOT_SERVED]), EXIT.AUTH);
  assert.equal(chainTerminalExit([EXIT.NOT_SERVED, EXIT.AUTH]), EXIT.NOT_SERVED);
  assert.equal(chainTerminalExit([]), EXIT.UNREACHABLE);
  assert.deepEqual([...CHAIN_NEEDS_HUMAN].sort((a, b) => a - b), [EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH].sort((a, b) => a - b));
});

test("FAFF-232 mapResultExit: per-backend result → exit class (host-source aware)", () => {
  assert.equal(mapResultExit({ status: "ok", content: "x" }), EXIT.OK);
  assert.equal(mapResultExit({ status: "model-not-served", names: [] }), EXIT.NOT_SERVED);
  assert.equal(mapResultExit({ status: "auth-failed" }), EXIT.AUTH);
  assert.equal(mapResultExit({ status: "unsupported-provider" }), EXIT.USAGE);
  assert.equal(mapResultExit({ status: "unreachable" }, "config"), EXIT.UNREACHABLE);
  assert.equal(mapResultExit({ status: "transport-failed" }, "default"), EXIT.DEFAULT_HOST_UNREACHABLE);
});

// A stub runReviewFn that returns a scripted result keyed by host — gives each backend a distinct outcome
// without any transport.
function scriptedRunReview(byHost) {
  return async (opts) => byHost[opts.host] ?? { status: "unreachable", note: "no script" };
}

test("FAFF-232 runReviewChain: advances past a failed primary to a healthy fallback → OK + winner", async () => {
  const chain = [
    { provider: "nvidia", model: "nemotron", host: "https://nv/v1", hostSource: "config" },
    { provider: "ollama", model: "qwen", host: "http://ollama:11434", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: scriptedRunReview({
      "https://nv/v1": { status: "transport-failed", note: "HTTP 429: rate limited" },
      "http://ollama:11434": { status: "ok", content: "## Adversarial findings — ollama/qwen\n..." },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.provider, "ollama");
  assert.match(res.content, /ollama\/qwen/);
  assert.ok(trace.some((l) => /advancing: nvidia\/nemotron failed/.test(l)), "primary failure logged as advancing");
});

test("FAFF-232 runReviewChain: advance-on-unreachable then success", async () => {
  const chain = [
    { provider: "nvidia", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "openai", model: "m2", host: "https://b/v1", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U",
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "unreachable", note: "ECONNREFUSED" },
      "https://b/v1": { status: "ok", content: "findings" },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.host, "https://b/v1");
});

test("FAFF-232 runReviewChain: all-exhausted availability-only → 5 (pass+skip)", async () => {
  const chain = [
    { provider: "nvidia", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U",
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "transport-failed", note: "HTTP 504" },
      "http://b:11434": { status: "unreachable", note: "down" },
    }),
  });
  assert.equal(res.exit, EXIT.UNREACHABLE);
});

test("FAFF-232 runReviewChain: a config fault anywhere in a fully-failed chain → needs-human (AUTH 7)", async () => {
  const chain = [
    { provider: "nvidia", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "openai", model: "m2", host: "https://b/v1", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U",
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "auth-failed", note: "HTTP 401" },
      "https://b/v1": { status: "unreachable", note: "down" },
    }),
  });
  assert.equal(res.exit, EXIT.AUTH, "the auth fault surfaces rather than being masked by 'B was just down'");
});

test("FAFF-232 runReviewChain: a backend with an unset api-key env advances (class 7), then a fallback wins", async () => {
  const chain = [
    { provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config", apiKeyEnv: "MISSING_KEY", apiKeyMissing: true },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const calls = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U",
    runReviewFn: async (opts) => { calls.push(opts.host); return { status: "ok", content: "ok" }; },
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(calls, ["http://b:11434"], "the unset-key backend was NOT called; the chain advanced");
});

test("FAFF-232 runReviewChain: a malformed backend (missing host) advances, not a whole-chain abort", async () => {
  const chain = [
    { provider: "openai", model: "m1" },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U",
    runReviewFn: scriptedRunReview({ "http://b:11434": { status: "ok", content: "ok" } }),
  });
  assert.equal(res.exit, EXIT.OK);
});

test("FAFF-232 main(): --backends-json advances past a 429 primary to a healthy fallback → exit 0", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff232-"));
  const bf = join(dir, "backends.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "nvidia", model: "nemotron", host: "https://nv/v1", host_source: "config" },
    { provider: "ollama", model: "qwen", host: "http://ollama:11434", host_source: "config" },
  ]));
  const code = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedRunReview({
      "https://nv/v1": { status: "transport-failed", note: "HTTP 429" },
      "http://ollama:11434": { status: "ok", content: "findings" },
    }) },
  );
  assert.equal(code, EXIT.OK);
});

test("FAFF-232 main(): --backends-json all-exhausted availability → exit 5 (pass+skip)", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff232-"));
  const bf = join(dir, "backends.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "nvidia", model: "m1", host: "https://a/v1", host_source: "config" },
    { provider: "ollama", model: "m2", host: "http://b:11434", host_source: "config" },
  ]));
  const code = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "unreachable", note: "down" },
      "http://b:11434": { status: "transport-failed", note: "HTTP 504" },
    }) },
  );
  assert.equal(code, EXIT.UNREACHABLE);
});

test("FAFF-232 main(): --backends-json with a config fault in a fully-failed chain → needs-human (7)", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff232-"));
  const bf = join(dir, "backends.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "openai", model: "m1", host: "https://a/v1", host_source: "config" },
    { provider: "ollama", model: "m2", host: "http://b:11434", host_source: "config" },
  ]));
  const code = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "auth-failed", note: "HTTP 403" },
      "http://b:11434": { status: "unreachable", note: "down" },
    }) },
  );
  assert.equal(code, EXIT.AUTH);
});

test("FAFF-232 main(): empty --backends-json → USAGE (2)", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff232-"));
  const bf = join(dir, "empty.json"); writeFileSync(bf, "[]");
  const code = await main(["--backends-json", bf, "--system", sys, "--diff", diff], { runReviewFn: async () => ({ status: "ok", content: "x" }) });
  assert.equal(code, EXIT.USAGE);
});

test("FAFF-232 parseArgs: --backends-json is collected", () => {
  assert.equal(parseArgs(["--backends-json", "/tmp/b.json"]).backendsJson, "/tmp/b.json");
});

// ── FAFF-329: total wall-clock --deadline on the Phase-2 chain ──

test("FAFF-329 EXIT.DEADLINE === 8, distinct from UNREACHABLE(5)", () => {
  assert.equal(EXIT.DEADLINE, 8);
  assert.notEqual(EXIT.DEADLINE, EXIT.UNREACHABLE);
});

test("FAFF-329 parseArgs: --deadline <s> → totalDeadlineMs (seconds → ms), distinct from --timeout", () => {
  const a = parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d", "--timeout", "120", "--deadline", "480"]);
  assert.equal(a.totalDeadlineMs, 480000);
  assert.equal(a.timeoutMs, 120000);
});

test("FAFF-329 runReviewChain: total deadline hit → exit 8 (pass+skip), no new backend started past budget", async () => {
  let t = 0; const nowFn = () => t;
  // each backend advances the clock 1000ms and does not produce findings
  const runReviewFn = async () => { t += 1000; return { status: "unreachable" }; };
  const chain = Array.from({ length: 5 }, (_, i) => ({ provider: "nvidia", model: "m" + i, host: "h", hostSource: "config" }));
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 2000, log: () => {} });
  assert.equal(r.exit, EXIT.DEADLINE, "deadline → exit 8");
  assert.equal(r.deadlineExceeded, true);
});

test("FAFF-329 runReviewChain: no --deadline ⇒ unchanged (chain exhausts to UNREACHABLE), byte-for-byte", async () => {
  let t = 0; const nowFn = () => t;
  const runReviewFn = async () => { t += 1000; return { status: "unreachable" }; };
  const chain = [{ model: "m", host: "h", hostSource: "config" }, { model: "n", host: "h", hostSource: "config" }];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, nowFn, log: () => {} });
  assert.equal(r.exit, EXIT.UNREACHABLE, "no deadline → exhaust to 5");
  assert.ok(!r.deadlineExceeded);
});

test("FAFF-329 runReviewChain: a needs-human fault before the deadline DOMINATES exit 8 (no-silent-weakening)", async () => {
  let t = 0, call = 0; const nowFn = () => t;
  const runReviewFn = async () => { t += 1500; call++; return call === 1 ? { status: "auth-failed" } : { status: "unreachable" }; };
  const chain = Array.from({ length: 5 }, (_, i) => ({ model: "m" + i, host: "h", hostSource: "config" }));
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 2000, log: () => {} });
  assert.equal(r.exit, EXIT.AUTH, "auth fault surfaces (needs-human), not masked by the deadline");
});

test("FAFF-329 runReviewChain: a healthy backend within budget still wins (exit 0)", async () => {
  let t = 0; const nowFn = () => t;
  const runReviewFn = async () => { t += 100; return { status: "ok", content: "## findings" }; };
  const chain = [{ model: "m", host: "h", hostSource: "config" }];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 2000, log: () => {} });
  assert.equal(r.exit, EXIT.OK);
});

test("FAFF-329 runReviewChain: the absolute hardDeadlineMs is threaded to each backend (per-attempt clamp)", async () => {
  let seen; let t = 0; const nowFn = () => t;
  const runReviewFn = async (opts) => { seen = opts.hardDeadlineMs; return { status: "ok", content: "x" }; };
  await runReviewChain([{ model: "m", host: "h", hostSource: "config" }], { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 3000, log: () => {} });
  assert.equal(seen, 3000, "hardDeadlineMs = start(0) + totalDeadlineMs(3000)");
});

test("FAFF-329 runReviewChain: a slow-trickle backend that outruns the budget MID-CALL is aborted → exit 8 (real timer, not idle-clamp)", async () => {
  // A backend whose promise resolves only AFTER the deadline (models a stream whose per-chunk activity
  // keeps the socket's idle timeout from ever firing). The real total-deadline race must abort it → 8.
  const runReviewFn = () => new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500));
  const chain = [{ model: "m", host: "h", hostSource: "config" }];
  const t0 = Date.now();
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 120, log: () => {} });
  assert.equal(r.exit, EXIT.DEADLINE, "the mid-call deadline aborts the slow backend → exit 8, not a late OK");
  assert.equal(r.deadlineExceeded, true);
  assert.ok(Date.now() - t0 < 400, "returned at ~the deadline, not after the backend's 500ms");
});

test("FAFF-329 runReviewChain: a needs-human fault before a mid-call deadline still dominates exit 8", async () => {
  let call = 0;
  const runReviewFn = ({ model }) => {
    call++;
    if (call === 1) return Promise.resolve({ status: "auth-failed" });      // fast config fault on backend 1
    return new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500)); // slow backend 2
  };
  const chain = [{ model: "a", host: "h", hostSource: "config" }, { model: "b", host: "h", hostSource: "config" }];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 120, log: () => {} });
  assert.equal(r.exit, EXIT.AUTH, "the earlier auth fault surfaces (needs-human), not the deadline");
});
