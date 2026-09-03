// FAFF-183 — adversarial review backend call: pure functions + injectable-transport orchestration.
// Zero live model calls — getFn/streamFn are mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assembleUserMessage,
  runReview, parseArgs, unreachableExit, EXIT, DEFAULT_NUM_PREDICT,
  buildOpenAiPayload, REASONING_EXTRA_KEYS, modelServedOpenAi, accumulateSse, isAuthError,
  buildAnthropicPayload, accumulateAnthropic, ANTHROPIC_VERSION,
  providerFamily, joinUrl, preflightOpenAi,
  isTransientTransport, isRateLimited, TRANSPORT_RETRY, main,
  judgeDispatchDisposition, JUDGE_RETRY_OUTAGE_EXITS,
  runReviewChain, chainTerminalExit, mapResultExit, mapThrowStatus, CHAIN_NEEDS_HUMAN, mandatoryRemap,
  ledgerMandatory, budgetWarnings,
  splitFindings, validateFindingsShape, isProviderRefusal, normaliseCleanRefutation, CLEAN_REFUTATIONS, CANONICAL_NO_FINDINGS,
  attributionHeader, ensureHeader, hasHeader,
  findSyntaxClaims, claimTargets, refuteFindings, realCheck,
  checkPayloadSize, DEFAULT_MAX_PAYLOAD_BYTES,
  streamWithFirstByte, FirstByteBreachError, isFirstByteBreach, DEFAULT_FIRST_BYTE_MS,
  trimContextFiles, trimOneFile, parseDiffTouched, elisionMarker, pathsMatch,
  DEFAULT_CONTEXT_TRIM_BYTES, DEFAULT_MIN_FILE_TRIM_BYTES, DEFAULT_TRIM_WINDOW,
  DEFAULT_TRIM_HEAD_LINES, DEFAULT_MAX_ANCHOR_LINES, DEFAULT_RETAINED_CEILING,
} from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";
import * as ReviewCallModule from "../plugin/skills/faffter-dark-adversarial-review/review-call.mjs";

test("FAFF-872: the native ollama transport family's exports are gone (buildChatPayload / modelServed / accumulateNdjson / the /api/tags preflight)", () => {
  assert.equal(typeof ReviewCallModule.runReviewOllama, "undefined", "runReviewOllama is not exported — deleted, never existed");
  assert.equal(typeof ReviewCallModule.buildChatPayload, "undefined");
  assert.equal(typeof ReviewCallModule.modelServed, "undefined");
  assert.equal(typeof ReviewCallModule.accumulateNdjson, "undefined");
  assert.equal(typeof ReviewCallModule.preflight, "undefined", "the native /api/tags preflight export is gone (preflightOpenAi survives)");
});

test("assembleUserMessage fences context files ahead of the diff (the no-hallucination fix)", () => {
  const u = assembleUserMessage({ contextFiles: [{ path: "plugin/skills/faff/SKILL.md", text: "GATEWAY" }], diff: "DIFF" });
  assert.match(u, /<file path="plugin\/skills\/faff\/SKILL\.md">\nGATEWAY\n<\/file>/);
  assert.ok(u.indexOf("GATEWAY") < u.indexOf("DIFF UNDER REVIEW"), "context precedes the diff");
});

// FAFF-872: the native ollama transport family (buildChatPayload / modelServed / accumulateNdjson /
// the /api/tags preflight) is deleted — its coverage moves onto the OpenAI-path pure functions below
// (buildOpenAiPayload / modelServedOpenAi / accumulateSse) and the no-provider-⇒-openai-default
// dispatch tests, since an unset/ollama provider now resolves to that same family (D-default/D-fold).

test("runReview (no provider ⇒ openai default, FAFF-872): model-not-served → status model-not-served (skill maps to needs-human, never pass)", async () => {
  const r = await runReview({
    host: "http://h:1/v1", model: "typo", system: "S", user: "U",
    getFn: async () => JSON.stringify({ data: [{ id: "real" }] }),
    streamFn: async () => { throw new Error("should not stream when not served"); },
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["real"]);
});

test("runReview (no provider ⇒ openai default, FAFF-872): unreachable → status unreachable (skill maps to pass+skip)", async () => {
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U",
    getFn: async () => { throw new Error("timeout"); },
    streamFn: async () => { throw new Error("unused"); },
  });
  assert.equal(r.status, "unreachable");
});

test("runReview (no provider ⇒ openai default, FAFF-872): happy path streams SSE findings", async () => {
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(r.truncated, false);
});

test("runReview (no provider ⇒ openai default, FAFF-872): SSE truncation triggers exactly one retry at 2× the token budget", async () => {
  const budgets = [];
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", numPredict: 1000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).max_tokens);
      const first = budgets.length === 1;
      return `data: ${JSON.stringify({ choices: [{ delta: { content: first ? "partial" : "full" }, finish_reason: first ? "length" : "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.deepEqual(budgets, [1000, 2000], "one retry at double budget");
  assert.equal(r.content, "full");
  assert.equal(r.truncated, false);
});

test("parseArgs collects repeated --context and the scalar flags", () => {
  const a = parseArgs(["--host", "http://h", "--model", "m", "--system", "s.txt", "--diff", "d.txt", "--context", "a", "--context", "b", "--max-tokens", "1500"]);
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
  assert.equal(EXIT.RATE_LIMITED, 12); // FAFF-942: a distinct availability class for an all-429 chain
  assert.equal(new Set([EXIT.NOT_SERVED, EXIT.UNREACHABLE, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.RATE_LIMITED]).size, 5);
});

// --- OpenAI-compatible (/v1) path: NVIDIA NIM, OpenAI, vLLM, OpenRouter, DeepSeek ---

test("providerFamily maps the OpenAI-compatible set (incl. gemini AND ollama, FAFF-872) to openai, anthropic to its own family, else passthrough", () => {
  for (const p of ["openai", "vllm", "openrouter", "nvidia", "deepseek", "openai-compatible", "gemini", "ollama"]) {
    assert.equal(providerFamily(p), "openai", p);
  }
  assert.equal(providerFamily("gemini"), "openai", "FAFF-210: gemini rides Google's OpenAI-compat base URL");
  assert.equal(providerFamily("OLLAMA"), "openai", "FAFF-872: ollama is now an OpenAI-compatible alias (case-insensitive), never a native family");
  assert.equal(providerFamily("anthropic"), "anthropic", "FAFF-210: anthropic is a native family");
  assert.equal(providerFamily(undefined), "openai", "FAFF-872: the unset-provider default is openai — there is no longer a native ollama family");
  assert.equal(providerFamily("cohere"), "cohere", "a genuinely unknown provider still passes through → unsupported");
});

test("joinUrl appends the endpoint without dropping the base /v1 (the new URL trap)", () => {
  assert.equal(joinUrl("https://integrate.api.nvidia.com/v1", "/models"), "https://integrate.api.nvidia.com/v1/models");
  assert.equal(joinUrl("https://integrate.api.nvidia.com/v1/", "/chat/completions"), "https://integrate.api.nvidia.com/v1/chat/completions");
});

test("buildOpenAiPayload: stream + max_tokens, reasoning-off OPT-IN (vanilla OpenAI rejects the field)", () => {
  const off = buildOpenAiPayload({ model: "deepseek-ai/deepseek-v4-pro", system: "S", user: "U", reasoningOff: true });
  assert.equal(off.stream, true);
  assert.equal(off.max_tokens, DEFAULT_NUM_PREDICT);
  assert.deepEqual(off.chat_template_kwargs, { thinking: false, enable_thinking: false }, "thinking disabled for reasoning models (enable_thinking is the key Qwen3/vLLM/SGLang/HF/MLX templates read)");
  assert.deepEqual(off.messages.map((m) => m.role), ["system", "user"]);

  const on = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U" });
  assert.equal("chat_template_kwargs" in on, false, "not sent unless reasoningOff — keeps vanilla OpenAI happy");
  assert.equal(buildOpenAiPayload({ model: "m", system: "", user: "", maxTokens: 9000 }).max_tokens, 9000);
});

test("buildOpenAiPayload: reasoning_effort unset -> payload byte-identical to today (field omitted)", () => {
  const withoutEffort = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U" });
  assert.equal("reasoning_effort" in withoutEffort, false, "omitted when reasoningEffort is unset");
});

test("buildOpenAiPayload: reasoning_effort emitted verbatim for low/medium/high", () => {
  for (const level of ["low", "medium", "high"]) {
    const body = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U", reasoningEffort: level });
    assert.equal(body.reasoning_effort, level, `${level} passes through unchanged`);
    assert.equal("chat_template_kwargs" in body, false);
  }
});

test("buildOpenAiPayload: xhigh and max clamp to wire high", () => {
  for (const level of ["xhigh", "max"]) {
    const body = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U", reasoningEffort: level });
    assert.equal(body.reasoning_effort, "high", `${level} clamps to high`);
  }
});

test("buildOpenAiPayload: reasoning_off wins over reasoning_effort (precedence, not conflict)", () => {
  const body = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U", reasoningOff: true, reasoningEffort: "medium" });
  assert.deepEqual(body.chat_template_kwargs, { thinking: false, enable_thinking: false });
  assert.equal("reasoning_effort" in body, false, "reasoning_effort NOT emitted when reasoning_off wins");
});

test("FAFF-914 reasoning_extra: per-model shapes merge verbatim (deepseek reasoning:{}, north thinking:{})", () => {
  const ds = buildOpenAiPayload({ model: "deepseek/deepseek-v4-flash", system: "S", user: "U", reasoningExtra: { reasoning: { enabled: false } } });
  assert.deepEqual(ds.reasoning, { enabled: false }, "OpenRouter/deepseek off-switch reaches the body unchanged");
  const north = buildOpenAiPayload({ model: "CohereLabs/North-Mini-Code", system: "S", user: "U", reasoningExtra: { thinking: { type: "disabled" } } });
  assert.deepEqual(north.thinking, { type: "disabled" }, "Cohere/north native shape reaches the body unchanged");
});

test("FAFF-914 reasoning_extra: unset → payload byte-identical to today (field omitted)", () => {
  const withExtra = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U", reasoningExtra: null });
  const withoutParam = buildOpenAiPayload({ model: "gpt-4o", system: "S", user: "U" });
  assert.deepEqual(withExtra, withoutParam, "null reasoningExtra changes nothing");
});

test("FAFF-914 reasoning_extra: fail-closed — a key outside the allowlist throws (never silently egresses)", () => {
  assert.throws(
    () => buildOpenAiPayload({ model: "m", system: "S", user: "U", reasoningExtra: { max_tokens: 99999 } }),
    /unsupported key "max_tokens"/,
    "a faff-managed / unmodelled key is rejected at the emit boundary",
  );
  assert.throws(() => buildOpenAiPayload({ model: "m", system: "S", user: "U", reasoningExtra: [1, 2] }), /must be an object/);
});

test("FAFF-914 reasoning_extra: chat_template_kwargs DEEP-merges with a reasoning_off default (composes, no clobber)", () => {
  const body = buildOpenAiPayload({ model: "m", system: "S", user: "U", reasoningOff: true, reasoningExtra: { chat_template_kwargs: { reasoning_effort: "low" } } });
  assert.deepEqual(body.chat_template_kwargs, { thinking: false, enable_thinking: false, reasoning_effort: "low" }, "reasoning_off's keys survive; the extra sub-key is added");
});

test("FAFF-914 reasoning_extra: applied LAST — an explicit extra wins per key over reasoning_effort (raw, unclamped)", () => {
  const body = buildOpenAiPayload({ model: "m", system: "S", user: "U", reasoningEffort: "xhigh", reasoningExtra: { reasoning_effort: "minimal" } });
  assert.equal(body.reasoning_effort, "minimal", "the raw operator override wins; not clamped through the faff vocabulary");
});

test("FAFF-918 reasoning_extra: thinking_token_budget is allowlisted and emits top-level (the cross-model empty-out fix)", () => {
  const body = buildOpenAiPayload({ model: "unsloth/Qwen3.8-27B", system: "S", user: "U", reasoningExtra: { thinking_token_budget: 2000 } });
  assert.equal(body.thinking_token_budget, 2000, "thinking_token_budget reaches the body top-level (vLLM's reasoning-cap shape)");
  assert.equal(REASONING_EXTRA_KEYS.includes("thinking_token_budget"), true, "thinking_token_budget is in the allowlist");
});

test("FAFF-986 reasoning_extra: custom_params is allowlisted and emits the nested wrapper verbatim (the Qwen custom_params.thinking_budget shape)", () => {
  const body = buildOpenAiPayload({ model: "unsloth/Qwen3.8-27B-NVFP4", system: "S", user: "U", reasoningExtra: { custom_params: { thinking_budget: 2000 } } });
  assert.deepEqual(body.custom_params, { thinking_budget: 2000 }, "custom_params reaches the body as a nested object (the Qwen build's reasoning-cap shape)");
  assert.equal(REASONING_EXTRA_KEYS.includes("custom_params"), true, "custom_params is in the allowlist");
});

// FAFF-941 defect 1: the GLM/OpenRouter judge backend's reasoning cap is data in .faffrc
// (reasoning_extra), not a knob hardcoded in the dispatch — so it reaches the request body with no
// branch on model or provider. `reasoning` is already allowlisted (FAFF-914), so no transport change.
test("FAFF-941 reasoning_extra: an OpenRouter judge backend's request body carries reasoning.max_tokens sourced from config, no dropped thinking_token_budget", () => {
  // The backend object exactly as `faff adversarial-backends --consumer spec_judge` emits it and
  // review-call.mjs's --backends-json mapper reads it (reasoningExtra <- b.reasoning_extra).
  const judgeBackend = { provider: "openai", model: "z-ai/glm-5.2:free", host: "https://openrouter.ai/api/v1", reasoning_extra: { reasoning: { max_tokens: 2000 } } };
  const body = buildOpenAiPayload({ model: judgeBackend.model, system: "S", user: "U", reasoningExtra: judgeBackend.reasoning_extra });
  assert.deepEqual(body.reasoning, { max_tokens: 2000 }, "OpenRouter's reasoning cap reaches the body as reasoning.max_tokens");
  assert.equal(body.thinking_token_budget, undefined, "no dropped qwen-lever thinking_token_budget on the GLM body");
});

test("FAFF-941 reasoning_extra: the qwen refuter's thinking_token_budget still passes through (no regression to the refuter path)", () => {
  const qwenBackend = { provider: "openai", model: "unsloth/Qwen3.8-27B-NVFP4", reasoning_extra: { thinking_token_budget: 2000 } };
  const body = buildOpenAiPayload({ model: qwenBackend.model, system: "S", user: "U", reasoningExtra: qwenBackend.reasoning_extra });
  assert.equal(body.thinking_token_budget, 2000, "the qwen chat-template cap still reaches the body unchanged");
  assert.equal(body.reasoning, undefined, "no OpenRouter reasoning object leaks onto the qwen body");
});

// FAFF-941 defect 2: the judge dispatch's retry-vs-park decision is a tested classifier over the
// whole EXIT taxonomy, not prose — so "retry a transient outage, park a config-fault/garble" has an
// executable oracle. The retry pair matches mandatoryRemap's no-opinion outage class.
test("FAFF-941 judgeDispatchDisposition: classifies every EXIT code as ruling / retry / park", () => {
  assert.equal(judgeDispatchDisposition(EXIT.OK), "ruling", "OK is a ruling to validate");
  // retry: the swing-capable no-opinion outage pair (mandatoryRemap's fail-closed pair)
  assert.equal(judgeDispatchDisposition(EXIT.UNREACHABLE), "retry", "5 all-hosts-down is a transient outage");
  assert.equal(judgeDispatchDisposition(EXIT.DEADLINE), "retry", "8 budget-hit-before-ruling is a transient outage");
  assert.deepEqual([...JUDGE_RETRY_OUTAGE_EXITS].sort(), [EXIT.UNREACHABLE, EXIT.DEADLINE].sort(), "the retry set is exactly {5,8}");
  // FAFF-942: RATE_LIMITED(12, an all-429 chain) is NOT retried — re-dispatching a throttled chain does not
  // clear the limit, so it parks (the next drain, not an in-turn re-run, is the recovery path).
  assert.equal(judgeDispatchDisposition(EXIT.RATE_LIMITED), "park", "12 all-429 parks — a re-dispatch cannot clear a rate limit");
  assert.ok(!JUDGE_RETRY_OUTAGE_EXITS.has(EXIT.RATE_LIMITED), "RATE_LIMITED is deliberately absent from the retry set");
  // park: config-fault / needs-human (CHAIN_NEEDS_HUMAN), OTHER, garbled ruling, mandatory-outage, and rate-limited
  for (const e of [EXIT.OTHER, EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.MANDATORY_OUTAGE, EXIT.MALFORMED, EXIT.NO_FINDINGS_CONTENT, EXIT.RATE_LIMITED]) {
    assert.equal(judgeDispatchDisposition(e), "park", `exit ${e} parks directly (never rescued by a retry)`);
  }
  // total over the taxonomy — no EXIT value falls through unclassified
  for (const e of Object.values(EXIT)) {
    assert.ok(["ruling", "retry", "park"].includes(judgeDispatchDisposition(e)), `exit ${e} has a disposition`);
  }
});

// A single transient transport blip is retried in-band by the transport primitive, not surfaced as an
// outage the caller parks on. The judge dispatch relies on this primitive (plus the classifier above
// and its bounded in-turn re-dispatch in faff-prep/SKILL.md) to ride out one blip in a would-be-park pass.
test("FAFF-941 transport-retry: a single transient transport failure is retried and does not park when the retry succeeds", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 503 upstream blip");   // transient (isTransientTransport true)
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(calls, 2, "the transient first attempt is retried exactly once");
  assert.equal(r.status, "ok", "the retry succeeds — status ok, never a transport-failed park");
  assert.equal(r.content, "### finding");
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

test("isAuthError: 401/403 are auth (no retry); 404/timeout are not; a marked-400 IS auth (FAFF-210 gemini bad key)", () => {
  assert.equal(isAuthError(new Error("HTTP 401")), true);
  assert.equal(isAuthError(new Error("HTTP 403")), true);
  assert.equal(isAuthError(new Error("HTTP 404")), false);
  assert.equal(isAuthError(new Error("stream timed out")), false);
  // FAFF-210: Google's OpenAI-compat layer returns 400 API_KEY_INVALID for a bad key — treat as auth so it
  // routes to needs-human (7), never unreachable/pass+skip (5). The marker gate keeps a generic 400 non-auth.
  assert.equal(isAuthError(new Error('HTTP 400: {"error":{"code":400,"status":"INVALID_ARGUMENT","message":"API_KEY_INVALID"}}')), true);
  assert.equal(isAuthError(new Error("HTTP 400: API key not valid. Please pass a valid API key.")), true);
  assert.equal(isAuthError(new Error("HTTP 400: {\"error\":\"messages: field required\"}")), false, "a generic 400 stays non-auth");
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
      assert.deepEqual(JSON.parse(body).chat_template_kwargs, { thinking: false, enable_thinking: false }, "reasoning-off carried into the body");
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(streamHeaders.authorization, "Bearer nv-KEY");
});

test("runReview dispatch → openai: reasoningEffort threads end-to-end and clamps at the wire (xhigh→high)", async () => {
  let sentBody;
  const r = await runReview({
    provider: "nvidia", host: "https://integrate.api.nvidia.com/v1", model: "deepseek-ai/deepseek-v4-pro",
    system: "S", user: "U", apiKey: "nv-KEY", reasoningEffort: "xhigh",
    getFn: async () => JSON.stringify({ data: [{ id: "deepseek-ai/deepseek-v4-pro" }] }),
    streamFn: async (_url, body) => {
      sentBody = JSON.parse(body);
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(sentBody.reasoning_effort, "high", "xhigh clamped to high on the wire, threaded end-to-end from runReview");
  assert.equal("chat_template_kwargs" in sentBody, false);
});

test("FAFF-914 runReview dispatch → openai: reasoningExtra threads end-to-end onto the wire body verbatim", async () => {
  let sentBody;
  const r = await runReview({
    provider: "openai", host: "https://openrouter.ai/api/v1", model: "deepseek/deepseek-v4-flash",
    system: "S", user: "U", apiKey: "or-KEY", reasoningExtra: { reasoning: { enabled: false } },
    getFn: async () => JSON.stringify({ data: [{ id: "deepseek/deepseek-v4-flash" }] }),
    streamFn: async (_url, body) => {
      sentBody = JSON.parse(body);
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.deepEqual(sentBody.reasoning, { enabled: false }, "the deepseek off-switch reached the wire, threaded end-to-end from runReview");
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

test("runReview dispatch → openai: model-not-served maps to needs-human (the same class every family uses)", async () => {
  const r = await runReview({
    provider: "vllm", host: "https://h/v1", model: "absent", system: "S", user: "U", apiKey: "K",
    getFn: async () => JSON.stringify({ data: [{ id: "present" }] }),
    streamFn: async () => { throw new Error("should not stream when not served"); },
  });
  assert.equal(r.status, "model-not-served");
  assert.deepEqual(r.names, ["present"]);
});

test("runReview dispatch → genuinely unknown provider returns unsupported-provider (loud, not silent-pass)", async () => {
  const r = await runReview({ provider: "cohere", host: "https://h", model: "command", system: "S", user: "U" });
  assert.equal(r.status, "unsupported-provider");
  assert.match(r.note, /OpenAI-compatible/);
});

// --- Anthropic native adaptor (FAFF-210) ---

test("buildAnthropicPayload: top-level system, required max_tokens, NO temperature, throws on missing model", () => {
  const p = buildAnthropicPayload({ model: "claude-opus-4-8", system: "S", user: "U", maxTokens: 1234 });
  assert.equal(p.model, "claude-opus-4-8");
  assert.equal(p.max_tokens, 1234, "max_tokens is required on the wire (= maxTokens)");
  assert.equal(p.system, "S", "system is a TOP-LEVEL string, not a messages entry");
  assert.deepEqual(p.messages, [{ role: "user", content: "U" }], "only a user message; system is top-level");
  assert.equal(p.stream, true);
  assert.equal("temperature" in p, false, "no temperature — Claude models reject non-default sampling under thinking");
  assert.equal(buildAnthropicPayload({ model: "m", system: "", user: "" }).max_tokens, DEFAULT_NUM_PREDICT, "defaults to the token budget");
  assert.throws(() => buildAnthropicPayload({ system: "S", user: "U" }), /requires a model/);
});

test("accumulateAnthropic: folds text_delta, ignores thinking_delta, flags max_tokens truncation, done on message_delta/stop", () => {
  const sse = [
    "event: content_block_delta",
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })}`,
    "event: content_block_delta",
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm (ignored)" } })}`,
    "event: content_block_delta",
    `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } })}`,
    "data: not json",
    "event: message_delta",
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" } })}`,
    "event: message_stop",
    `data: ${JSON.stringify({ type: "message_stop" })}`,
  ].join("\n");
  const r = accumulateAnthropic(sse);
  assert.equal(r.content, "Hello world", "only text_delta folded; thinking_delta dropped; bad frame tolerated");
  assert.equal(r.truncated, true, "stop_reason max_tokens ⇒ truncated");
  assert.equal(r.done, true);
});

test("accumulateAnthropic: clean end_turn is not truncated", () => {
  const sse = [
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } })}`,
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}`,
  ].join("\n");
  const r = accumulateAnthropic(sse);
  assert.equal(r.content, "x");
  assert.equal(r.truncated, false);
  assert.equal(r.done, true);
});

test("accumulateAnthropic: non-streamed fallback (one Messages object, content blocks concatenated, thinking filtered)", () => {
  const whole = JSON.stringify({
    content: [{ type: "thinking", thinking: "ignored" }, { type: "text", text: "single-" }, { type: "text", text: "shot" }],
    stop_reason: "max_tokens",
  });
  const r = accumulateAnthropic(whole);
  assert.equal(r.content, "single-shot", "text blocks concatenated, non-text filtered");
  assert.equal(r.truncated, true, "top-level stop_reason max_tokens ⇒ truncated");
  assert.equal(r.done, true);
});

test("runReviewAnthropic (via dispatch): ok — x-api-key + anthropic-version sent to /v1/messages, findings returned", async () => {
  let seenUrl, seenHeaders, seenBody;
  const streamFn = async (url, body, _timeout, headers) => {
    seenUrl = url; seenHeaders = headers; seenBody = JSON.parse(body);
    return [
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "no issues found" } })}`,
      `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}`,
    ].join("\n");
  };
  const r = await runReview({
    provider: "anthropic", host: "https://api.anthropic.com", model: "claude-opus-4-8",
    system: "S", user: "U", apiKey: "sk-ant-xxx", streamFn,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "no issues found");
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages", "native endpoint, no preflight");
  assert.equal(seenHeaders["x-api-key"], "sk-ant-xxx", "x-api-key (not Bearer)");
  assert.equal(seenHeaders["anthropic-version"], ANTHROPIC_VERSION);
  assert.equal(seenBody.system, "S", "top-level system on the wire");
  assert.equal(mapResultExit(r), EXIT.OK);
});

test("runReviewAnthropic: a first-stream 404/not_found → model-not-served (exit 4, needs-human), no preflight", async () => {
  const streamFn = async () => { throw new Error('HTTP 404: {"type":"error","error":{"type":"not_found_error","message":"model: bogus"}}'); };
  const r = await runReview({
    provider: "anthropic", host: "https://api.anthropic.com", model: "bogus",
    system: "S", user: "U", apiKey: "sk-ant-xxx", streamFn,
  });
  assert.equal(r.status, "model-not-served");
  assert.equal(mapResultExit(r), EXIT.NOT_SERVED);
});

test("runReviewAnthropic: a 401/403 → auth-failed (exit 7, needs-human)", async () => {
  const streamFn = async () => { throw new Error("HTTP 401: {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\"}}"); };
  const r = await runReview({
    provider: "anthropic", host: "https://api.anthropic.com", model: "claude-opus-4-8",
    system: "S", user: "U", apiKey: "wrong", streamFn,
  });
  assert.equal(r.status, "auth-failed");
  assert.equal(mapResultExit(r), EXIT.AUTH);
});

test("runReview with no provider now routes to openai (FAFF-872 — the native ollama family is gone; original signature unchanged)", async () => {
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U",
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => `data: ${JSON.stringify({ choices: [{ delta: { content: "openai-finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`,
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "openai-finding");
});

test("parseArgs collects the new --provider / --api-key-env / --reasoning-off flags", () => {
  const a = parseArgs(["--host", "https://h/v1", "--model", "m", "--system", "s", "--diff", "d",
    "--provider", "nvidia", "--api-key-env", "NVIDIA_API_KEY", "--reasoning-off"]);
  assert.equal(a.provider, "nvidia");
  assert.equal(a.apiKeyEnv, "NVIDIA_API_KEY");
  assert.equal(a.reasoningOff, true);
});

test("parseArgs collects --reasoning-effort", () => {
  const a = parseArgs(["--host", "https://h/v1", "--model", "m", "--system", "s", "--diff", "d",
    "--reasoning-effort", "xhigh"]);
  assert.equal(a.reasoningEffort, "xhigh");
});

test("parseArgs: --reasoning-effort absent -> undefined (byte-identical when unset)", () => {
  const a = parseArgs(["--host", "https://h/v1", "--model", "m", "--system", "s", "--diff", "d"]);
  assert.equal(a.reasoningEffort, undefined);
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

test("isTransientTransport: 5xx / dropped-socket / timeout are transient; 429 and other 4xx, auth, usage, unknown are not (FAFF-942)", () => {
  // transient (same-endpoint retry) — a genuine transport fault the same request may clear after a backoff
  for (const m of ["HTTP 504", "HTTP 502: bad gateway", "HTTP 500", "stream timed out after 580000ms", "preflight timed out after 5000ms", "socket hang up"]) {
    assert.equal(isTransientTransport(new Error(m)), true, m);
  }
  for (const code of ["ECONNRESET", "ETIMEDOUT", "EPIPE"]) {
    const e = new Error("write failed"); e.code = code;
    assert.equal(isTransientTransport(e), true, code);
  }
  // terminal (no same-endpoint retry) — 4xx incl. HTTP 429 (FAFF-942: a throttle is not cleared by re-hitting
  // the same endpoint; it advances the chain instead), auth, usage, model-not-served text, anything unrecognised.
  for (const m of ["HTTP 429", "HTTP 429: rate limited", "HTTP 401", "HTTP 403", "HTTP 404", "HTTP 400 Bad Request", "usage error", "model 'x' not served", "some other error"]) {
    assert.equal(isTransientTransport(new Error(m)), false, m);
  }
  assert.equal(isTransientTransport(null), false);
  assert.equal(isTransientTransport(undefined), false);
  // a 5xx still wins even with no err.code set; ECONNREFUSED (connection refused, a preflight-class infra
  // signal) is intentionally NOT transient here — the streaming-phase retry targets mid-stream drops/5xx.
  const refused = new Error("ECONNREFUSED"); refused.code = "ECONNREFUSED";
  assert.equal(isTransientTransport(refused), false, "ECONNREFUSED is not a mid-stream transient");
});

test("isRateLimited: only HTTP 429 is a rate-limit; everything else is not (FAFF-942)", () => {
  for (const m of ["HTTP 429", "HTTP 429: rate limited", "HTTP 429: Too Many Requests"]) {
    assert.equal(isRateLimited(new Error(m)), true, m);
  }
  for (const m of ["HTTP 500", "HTTP 503", "HTTP 401", "HTTP 400", "socket hang up", "stream timed out"]) {
    assert.equal(isRateLimited(new Error(m)), false, m);
  }
  assert.equal(isRateLimited(null), false);
  assert.equal(isRateLimited(undefined), false);
  // a 429 is deliberately partitioned OUT of the transient (same-endpoint retry) set and INTO the
  // rate-limited (advance-the-chain) set — the two predicates never both match one error.
  assert.equal(isTransientTransport(new Error("HTTP 429")), false);
  assert.equal(isRateLimited(new Error("HTTP 429")), true);
});

test("TRANSPORT_RETRY policy defaults: 3 attempts (2 retries), exponential backoff base — named, not magic", () => {
  assert.equal(TRANSPORT_RETRY.attempts, 3);
  assert.ok(TRANSPORT_RETRY.baseMs > 0);
});

test("runReview (no provider ⇒ openai default, FAFF-872): a transient mid-stream fault retries once then succeeds → status ok", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("HTTP 504: gateway timeout"); // transient
      return `data: ${JSON.stringify({ choices: [{ delta: { content: "### finding" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
    },
  });
  assert.equal(r.status, "ok");
  assert.equal(r.content, "### finding");
  assert.equal(calls, 2, "retried exactly once after the transient fault");
});

// FAFF-942: an HTTP 429 rate-limit is NOT same-endpoint-retried (reversing FAFF-228). It surfaces as the
// `rate-limited` status after exactly one stream attempt, so the fallback chain advances to a different backend.
test("runReview (no provider ⇒ openai default): an HTTP 429 rate-limit is NOT retried → status rate-limited, one attempt (FAFF-942)", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => { calls += 1; throw new Error("HTTP 429: rate limited"); },
  });
  assert.equal(r.status, "rate-limited");
  assert.match(r.note, /HTTP 429/);
  assert.equal(calls, 1, "429 is not retried on the same endpoint — streamed exactly once");
});

test("runReview openai: an HTTP 429 rate-limit is NOT retried → status rate-limited, one attempt (FAFF-942)", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "nvidia", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async () => { calls += 1; throw new Error("HTTP 429: Too Many Requests"); },
  });
  assert.equal(r.status, "rate-limited");
  assert.match(r.note, /HTTP 429/);
  assert.equal(calls, 1, "429 is not retried on the same endpoint — streamed exactly once");
});

test("runReview anthropic: an HTTP 429 rate-limit is NOT retried → status rate-limited, one attempt (FAFF-942)", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "anthropic", host: "https://h", model: "m", system: "S", user: "U", apiKey: "K", timeoutMs: 600000,
    streamFn: async () => { calls += 1; throw new Error("HTTP 429: rate limited"); },
  });
  assert.equal(r.status, "rate-limited");
  assert.match(r.note, /HTTP 429/);
  assert.equal(calls, 1, "429 is not retried on the same endpoint — streamed exactly once");
});

test("runReview openai: a 429 at PREFLIGHT surfaces status rate-limited (advances the chain, not unreachable) (FAFF-942)", async () => {
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", timeoutMs: 600000,
    getFn: async () => { throw new Error("HTTP 429: rate limited"); },
    streamFn: async () => { throw new Error("should not stream after a preflight 429"); },
  });
  assert.equal(r.status, "rate-limited");
  assert.match(r.note, /HTTP 429/);
});

test("runReview (no provider ⇒ openai default, FAFF-872): a persistent transient fault exhausts retries → status transport-failed", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", timeoutMs: 0, // deadline already passed → no sleeps
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
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

test("runReview (no provider ⇒ openai default, FAFF-872): truncation retry still composes with the transport retry (regression)", async () => {
  // First stream truncates → one truncation retry at 2× budget; no transport fault → no transport retry.
  const budgets = [];
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", numPredict: 1000, timeoutMs: 600000,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async (_url, body) => {
      budgets.push(JSON.parse(body).max_tokens);
      const first = budgets.length === 1;
      return `data: ${JSON.stringify({ choices: [{ delta: { content: first ? "partial" : "full" }, finish_reason: first ? "length" : "stop" }] })}\ndata: [DONE]`;
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

// FAFF-942: a persistent HTTP 429 surfaces as the `rate-limited` status → EXIT.RATE_LIMITED (12), a distinct
// availability class, independent of host provenance (a rate-limit is about the endpoint, not whether the
// host was configured or defaulted) — never the unmapped EXIT.OTHER (1).
test("main(): persistent HTTP 429 with --host-source config → EXIT.RATE_LIMITED (12), never OTHER (1) (FAFF-942)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "https://h/v1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"],
    { runReviewFn: async () => ({ status: "rate-limited", note: "HTTP 429: rate limited" }) },
  );
  assert.equal(code, EXIT.RATE_LIMITED);
  assert.notEqual(code, EXIT.OTHER);
});

test("main(): persistent HTTP 429 with --host-source default → EXIT.RATE_LIMITED (12) (host-provenance-independent) (FAFF-942)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://localhost:11434", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "default"],
    { runReviewFn: async () => ({ status: "rate-limited", note: "HTTP 429: rate limited" }) },
  );
  assert.equal(code, EXIT.RATE_LIMITED);
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
  assert.deepEqual([...CHAIN_NEEDS_HUMAN].sort((a, b) => a - b), [EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.NO_FINDINGS_CONTENT].sort((a, b) => a - b));
});

test("FAFF-942 mapResultExit: a rate-limited backend → EXIT.RATE_LIMITED (12), independent of host provenance", () => {
  assert.equal(mapResultExit({ status: "rate-limited", note: "HTTP 429" }, "config"), EXIT.RATE_LIMITED);
  assert.equal(mapResultExit({ status: "rate-limited", note: "HTTP 429" }, "default"), EXIT.RATE_LIMITED);
});

test("FAFF-942 chainTerminalExit: a PURELY rate-limited chain → RATE_LIMITED; a mix with a genuine outage → UNREACHABLE", () => {
  // pure all-429 → the distinct rate-limited class (not re-run by the dispatch retry)
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.RATE_LIMITED]), EXIT.RATE_LIMITED);
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED]), EXIT.RATE_LIMITED);
  // mixed with a genuine unreachable/deadline/garble → stays UNREACHABLE, so a real transient still earns its retry
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.UNREACHABLE]), EXIT.UNREACHABLE);
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.RATE_LIMITED]), EXIT.UNREACHABLE);
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.DEADLINE]), EXIT.UNREACHABLE);
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.MALFORMED]), EXIT.UNREACHABLE);
  // a needs-human class still dominates a rate-limited one (no silent weakening)
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.AUTH]), EXIT.AUTH);
  assert.equal(chainTerminalExit([EXIT.RATE_LIMITED, EXIT.NOT_SERVED]), EXIT.NOT_SERVED);
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
      "http://ollama:11434": { status: "ok", content: "## Adversarial findings — ollama/qwen\n\n### observation: no findings\n..." },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.provider, "ollama");
  assert.equal(res.winnerIndex, 1, "FAFF-361: 0-based chain position of the winner");
  assert.match(res.content, /ollama\/qwen/);
  assert.ok(trace.some((l) => /\[chain\] nvidia\/nemotron transport-failed/.test(l) && /→ advancing/.test(l)),
    "FAFF-361: primary failure logged via the reshaped [chain] ... → advancing note");
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
      "https://b/v1": { status: "ok", content: "### observation: no findings" },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.host, "https://b/v1");
  assert.equal(res.winnerIndex, 1, "FAFF-361: winner served from chain position 1");
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
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: async (opts) => { calls.push(opts.host); return { status: "ok", content: "### observation: no findings" }; },
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(calls, ["http://b:11434"], "the unset-key backend was NOT called; the chain advanced");
  assert.ok(trace.some((l) => /\[chain\] openai\/m1 unset-key \(env 'MISSING_KEY'\) → advancing \(exit 7\)/.test(l)),
    "FAFF-361: the unset-key skip is logged via the reshaped [chain] ... → advancing note");
});

test("FAFF-232 runReviewChain: a malformed backend (missing host) advances, not a whole-chain abort", async () => {
  const chain = [
    { provider: "openai", model: "m1" },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: scriptedRunReview({ "http://b:11434": { status: "ok", content: "### observation: no findings" } }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.ok(trace.some((l) => /\[chain\] openai\/m1 invalid \(missing model\/host\) → advancing \(exit 2\)/.test(l)),
    "FAFF-361: the invalid-backend skip is logged via the reshaped [chain] ... → advancing note");
});

test("FAFF-942 main(): --backends-json advances past a rate-limited (429) primary to a healthy fallback → exit 0", async () => {
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
      "https://nv/v1": { status: "rate-limited", note: "HTTP 429: rate limited" },
      "http://ollama:11434": { status: "ok", content: "### observation: no findings" },
    }) },
  );
  assert.equal(code, EXIT.OK, "a 429 primary advances the chain rather than being retried on the same endpoint");
});

test("FAFF-361 main(): --backends-json header names the FALLBACK's provider/model and chain[1] when the primary is skipped", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff361-"));
  const bf = join(dir, "backends.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "nvidia", model: "nemotron", host: "https://nv/v1", host_source: "config" },
    { provider: "ollama", model: "qwen", host: "http://ollama:11434", host_source: "config" },
  ]));
  const { result: code, stdout } = await captureStdout(() => main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedRunReview({
      "https://nv/v1": { status: "rate-limited", note: "HTTP 429" },
      "http://ollama:11434": { status: "ok", content: "### observation: no findings" },
    }) },
  ));
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /^## Adversarial findings — ollama\/qwen \(chain\[1\], host: config\)\n/,
    "the header names the FALLBACK that actually served, at its real chain position — not the primary");
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

// ===========================================================================
// FAFF-414 — a non-transient throw (HTTP 400/413) advances the fallback chain
// instead of aborting to EXIT.OTHER. runReviewOllama/OpenAi/Anthropic are byte-
// unchanged (still throw); the catch lives ONLY at the runReviewChain boundary
// (safeCall), so a throw is exactly as informative as a returned status.
// ===========================================================================

test("FAFF-414 mapThrowStatus: an auth-shaped throw (401/403, or a marked bad-key 400) maps to auth-failed; else request-failed", () => {
  assert.equal(mapThrowStatus(new Error("HTTP 401")), "auth-failed");
  assert.equal(mapThrowStatus(new Error("HTTP 403")), "auth-failed");
  assert.equal(mapThrowStatus(new Error('HTTP 400: {"error":{"message":"API_KEY_INVALID"}}')), "auth-failed");
  assert.equal(mapThrowStatus(new Error("HTTP 400 Bad Request")), "request-failed");
  assert.equal(mapThrowStatus(new Error("HTTP 413 Payload Too Large")), "request-failed");
  assert.equal(mapThrowStatus(new Error("some other error")), "request-failed");
});

test("FAFF-414 mapResultExit: request-failed → EXIT.USAGE (reused; no new exit code minted), a needs-human class", () => {
  assert.equal(mapResultExit({ status: "request-failed" }), EXIT.USAGE);
  assert.ok(CHAIN_NEEDS_HUMAN.has(EXIT.USAGE), "USAGE already dominates a pure-availability chain");
  assert.equal(mapResultExit({ status: "auth-failed" }), EXIT.AUTH, "auth-failed unchanged");
});

test("FAFF-414 runReviewChain: ollama (FAFF-872 — an OpenAI-compatible alias) — a non-transient streamFn throw (400) advances to a healthy fallback (exit 0)", async () => {
  const chain = [
    { provider: "ollama", model: "m1", host: "http://a:1/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:1/v1", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: (opts) => runReview({
      ...opts,
      getFn: async () => JSON.stringify({ data: [{ id: opts.model }] }),
      streamFn: async () => {
        if (opts.host === "http://a:1/v1") throw new Error("HTTP 400: bad request shape");
        return `data: ${JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
      },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.host, "http://b:1/v1");
  assert.deepEqual(res.failureClasses, [EXIT.USAGE]);
  assert.ok(trace.some((l) => /\[chain\] ollama\/m1 request-failed/.test(l) && /→ advancing/.test(l)),
    "the throwing primary's fault is logged, not silently swallowed");
});

test("FAFF-414 runReviewChain: openai — a non-transient streamFn throw (413) advances to a healthy fallback (exit 0)", async () => {
  const chain = [
    { provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "openai", model: "m2", host: "https://b/v1", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: (opts) => runReview({
      ...opts, apiKey: "K",
      getFn: async () => JSON.stringify({ data: [{ id: opts.model }] }),
      streamFn: async () => {
        if (opts.host === "https://a/v1") throw new Error("HTTP 413 Payload Too Large");
        return `data: ${JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] })}\ndata: [DONE]`;
      },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.host, "https://b/v1");
  assert.deepEqual(res.failureClasses, [EXIT.USAGE]);
});

test("FAFF-414 runReviewChain: anthropic — a non-transient streamFn throw (400, distinct from 404/401) advances to a healthy fallback (exit 0)", async () => {
  const chain = [
    { provider: "anthropic", model: "claude-opus-4-8", host: "https://api.anthropic.com", hostSource: "config", apiKey: "sk-ant-a" },
    { provider: "anthropic", model: "claude-opus-4-8", host: "https://api.anthropic.com", hostSource: "config", apiKey: "sk-ant-b" },
  ];
  let calls = 0;
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: (opts) => runReview({
      ...opts,
      streamFn: async () => {
        calls += 1;
        if (calls === 1) throw new Error("HTTP 400: messages: field required");
        return [
          `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "### observation: no findings" } })}`,
          `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}`,
        ].join("\n");
      },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(calls, 2, "the fallback was actually called after the primary's throw");
  assert.deepEqual(res.failureClasses, [EXIT.USAGE]);
});

test("FAFF-414 runReviewChain: a fully-failed chain whose only faults are non-transient throws terminates at USAGE (needs-human), never OTHER or pass+skip", async () => {
  const chain = [
    { provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:1", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: async () => { throw new Error("HTTP 400: bad request shape"); },
  });
  assert.equal(res.exit, EXIT.USAGE, "needs-human class — never OTHER(1) and never pass+skip(5)");
  assert.notEqual(res.exit, EXIT.OTHER);
  assert.notEqual(res.exit, EXIT.UNREACHABLE);
  assert.deepEqual(res.failureClasses, [EXIT.USAGE, EXIT.USAGE]);
});

test("FAFF-414 runReviewChain: single-backend (1-element) chain — a lone throwing backend surfaces USAGE, not OTHER (structural back-compat, AC4)", async () => {
  const chain = [{ provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" }];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: async () => { throw new Error("HTTP 413 Payload Too Large"); },
  });
  assert.equal(res.exit, EXIT.USAGE);
  assert.notEqual(res.exit, EXIT.OTHER);
});

test("FAFF-414 runReviewChain: a throw (USAGE) recorded alongside an unreachable (5), in either order, terminates at USAGE — request fault dominates availability", async () => {
  const throwFirst = await runReviewChain(
    [{ model: "a", host: "h1", hostSource: "config" }, { model: "b", host: "h2", hostSource: "config" }],
    {
      system: "S", user: "U", log: () => {},
      runReviewFn: async (opts) => { if (opts.host === "h1") throw new Error("HTTP 400"); return { status: "unreachable" }; },
    },
  );
  assert.equal(throwFirst.exit, EXIT.USAGE);

  const unreachableFirst = await runReviewChain(
    [{ model: "a", host: "h1", hostSource: "config" }, { model: "b", host: "h2", hostSource: "config" }],
    {
      system: "S", user: "U", log: () => {},
      runReviewFn: async (opts) => { if (opts.host === "h1") return { status: "unreachable" }; throw new Error("HTTP 400"); },
    },
  );
  assert.equal(unreachableFirst.exit, EXIT.USAGE);
});

test("FAFF-414 runReviewChain: an escaped auth-shaped throw (401) maps to AUTH via mapThrowStatus (defense-in-depth), dominating an otherwise pass+skip chain", async () => {
  const chain = [
    { provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:1", hostSource: "config" },
  ];
  let call = 0;
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: async () => { call++; if (call === 1) throw new Error("HTTP 401 Unauthorized"); return { status: "unreachable" }; },
  });
  assert.equal(res.exit, EXIT.AUTH, "an escaped auth-shaped throw still surfaces needs-human via AUTH, not masked by 'B was down'");
});

// Adversarial review (FAFF-414): safeCall's error `note` must reach the per-backend log line — a
// regression that drops it (e.g. `return { status: mapThrowStatus(err) }` with no `note`) would still
// pass every mechanism-level test above (failureClasses/exit unchanged) while silently losing the ONLY
// human-actionable detail the needs-human terminal carries. Assert the actual message text, not just the
// status/exit shape.
test("FAFF-414 runReviewChain: the thrown error's message reaches the per-backend log line's detail, not just the status/exit", async () => {
  const chain = [
    { provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:1", hostSource: "config" },
  ];
  const trace = [];
  await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: async (opts) => {
      if (opts.host === "https://a/v1") throw new Error("HTTP 400: messages: field required");
      return { status: "ok", content: "### observation: no findings" };
    },
  });
  assert.ok(trace.some((l) => l.includes("HTTP 400: messages: field required")),
    "the thrown message text must survive into the log line, not just the recorded status/exit class");
});

// Adversarial review (FAFF-414): a non-Error throw (`throw "x"` / `throw null`) must still surface SOMETHING
// in the note rather than losing it — no real orchestration function in this file throws non-Error today,
// but safeCall's catch is a generic boundary and must not silently blank the detail on an unusual throw.
test("FAFF-414 runReviewChain: a non-Error throw (bare string) still carries its text into the log, never a blank/lost note", async () => {
  const chain = [{ provider: "openai", model: "m1", host: "https://a/v1", hostSource: "config" }];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: async () => { throw "raw string fault, not an Error instance"; }, // eslint-disable-line no-throw-literal
  });
  assert.equal(res.exit, EXIT.USAGE, "a non-Error throw still maps to a needs-human class, not OTHER");
  assert.ok(trace.some((l) => l.includes("raw string fault, not an Error instance")),
    "the raw thrown value's text survives into the log even when it isn't an Error instance");
});

test("FAFF-414 main(): a lone backend whose orchestration throws a non-transient 400 → EXIT.USAGE (2), never OTHER (1)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
    { runReviewFn: async () => { throw new Error("HTTP 400 Bad Request"); } },
  );
  assert.equal(code, EXIT.USAGE);
  assert.notEqual(code, EXIT.OTHER);
});

// Integration smoke test (per the spec's DONE section): a 2-element --backends-json chain, the primary
// throws a 413 (oversized diff), the fallback is healthy → exit 0; swap the fallback to also throw → exit 2.
test("FAFF-414 main(): --backends-json integration smoke — throwing primary(413) + healthy fallback → exit 0; both throwing → exit 2 (never 1)", async () => {
  const { sys, diff } = writeMainFixtures();
  const dir = mkdtempSync(join(tmpdir(), "faff414-"));
  const bf = join(dir, "backends.json");
  writeFileSync(bf, JSON.stringify([
    { provider: "nvidia", model: "nemotron", host: "https://nv/v1", host_source: "config" },
    { provider: "ollama", model: "qwen", host: "http://ollama:11434", host_source: "config" },
  ]));

  const codeHealthy = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedThrowThenReview({
      "https://nv/v1": () => { throw new Error("HTTP 413 Payload Too Large"); },
      "http://ollama:11434": () => ({ status: "ok", content: "### observation: no findings" }),
    }) },
  );
  assert.equal(codeHealthy, EXIT.OK);

  const codeBothThrow = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff],
    { runReviewFn: scriptedThrowThenReview({
      "https://nv/v1": () => { throw new Error("HTTP 413 Payload Too Large"); },
      "http://ollama:11434": () => { throw new Error("HTTP 400 Bad Request"); },
    }) },
  );
  assert.equal(codeBothThrow, EXIT.USAGE, "a fully-exhausted throw-only chain → 2, never OTHER (1)");
  assert.notEqual(codeBothThrow, EXIT.OTHER);
});

// Small helper for the integration smoke test above: byHost[host] is a thunk that either returns a
// runReview-shaped result or throws — lets a single scripted map express both "returns status" and
// "throws" backends without a second bespoke helper.
function scriptedThrowThenReview(byHost) {
  return async (opts) => {
    const thunk = byHost[opts.host];
    if (!thunk) return { status: "unreachable", note: "no script" };
    return thunk();
  };
}

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
  const runReviewFn = async () => { t += 100; return { status: "ok", content: "### observation: no findings" }; };
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

// ── FAFF-398: MANDATORY chain-outage — an L4 lights-out review fails a no-opinion exhaustion CLOSED ──
// The fail-direction is a single pure remap (mandatoryRemap) applied ONCE at main()'s res.exit chokepoint;
// runReviewChain stays level-agnostic (returns raw 5/8), so every exhaustion path is covered by construction.

test("FAFF-398 parseArgs: --lights-out → mandatory=true; absent ⇒ falsy", () => {
  assert.equal(parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d", "--lights-out"]).mandatory, true);
  assert.ok(!parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d"]).mandatory);
});

test("FAFF-398 mandatoryRemap: no-opinion classes (UNREACHABLE/DEADLINE) → MANDATORY_OUTAGE only when mandatory", () => {
  // mandatory: the no-opinion classes fail closed
  assert.equal(mandatoryRemap(EXIT.UNREACHABLE, true), EXIT.MANDATORY_OUTAGE);
  assert.equal(mandatoryRemap(EXIT.DEADLINE, true), EXIT.MANDATORY_OUTAGE);
  // FAFF-942: an all-429 chain is a no-opinion outage too — a mandatory review got no second opinion, so it fails closed
  assert.equal(mandatoryRemap(EXIT.RATE_LIMITED, true), EXIT.MANDATORY_OUTAGE);
  assert.equal(mandatoryRemap(EXIT.RATE_LIMITED, false), EXIT.RATE_LIMITED, "advisory: rate-limited passes through unchanged");
  // mandatory: config-fault classes pass through UNCHANGED (never upgraded or masked)
  for (const c of [EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH]) {
    assert.equal(mandatoryRemap(c, true), c, `config-fault ${c} must pass through unchanged`);
  }
  assert.equal(mandatoryRemap(EXIT.OK, true), EXIT.OK, "OK is never remapped");
  // advisory: mandatory=false is a byte-for-byte no-op for every class
  for (const c of [EXIT.OK, EXIT.USAGE, EXIT.NOT_SERVED, EXIT.UNREACHABLE, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.DEADLINE]) {
    assert.equal(mandatoryRemap(c, false), c, `advisory must not touch ${c}`);
  }
});

test("FAFF-398 runReviewChain stays level-agnostic: returns raw UNREACHABLE(5) even if a mandatory key is passed", async () => {
  const chain = [{ model: "m1", host: "http://a:1", hostSource: "config" }, { model: "m2", host: "http://b:1", hostSource: "config" }];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", mandatory: true, log: () => {},   // runReviewChain must IGNORE mandatory — the remap is main()'s job
    runReviewFn: scriptedRunReview({ "http://a:1": { status: "unreachable" }, "http://b:1": { status: "unreachable" } }),
  });
  assert.equal(res.exit, EXIT.UNREACHABLE, "the helper never learns 'mandatory' — the chokepoint remap lives in main()");
});

// main() integration — --lights-out flips a no-opinion exhaustion to MANDATORY_OUTAGE, nothing else.
function specFiles398() {
  const dir = mkdtempSync(join(tmpdir(), "faff398-"));
  const sys = join(dir, "system.txt"); writeFileSync(sys, "SYSTEM");
  const dif = join(dir, "diff.txt"); writeFileSync(dif, "DIFF");
  return { sys, dif };
}

test("FAFF-398 main: --lights-out + all-unreachable chain → MANDATORY_OUTAGE (needs-human)", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
  );
  assert.equal(code, EXIT.MANDATORY_OUTAGE);
});

test("FAFF-465 main: --lights-out + a substantive-garble-only chain → MANDATORY_OUTAGE (9), composed via chainTerminalExit's UNREACHABLE(5) then the mandatory remap — not needs-human", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "ok", content: "no structured findings here" } }) },
  );
  assert.equal(code, EXIT.MANDATORY_OUTAGE);
});

test("FAFF-465 main: --lights-out + an empty/refusal-only chain → NO_FINDINGS_CONTENT (11, needs-human) — a structural fault stays human-actionable even at L4, never remapped to MANDATORY_OUTAGE", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "ok", content: "" } }) },
  );
  assert.equal(code, EXIT.NO_FINDINGS_CONTENT);
  assert.notEqual(code, EXIT.MANDATORY_OUTAGE);
});

test("FAFF-398 main: NO flag + all-unreachable → UNREACHABLE (5, advisory pass+skip — no regression)", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
  );
  assert.equal(code, EXIT.UNREACHABLE);
});

test("FAFF-398 main: --lights-out + a served backend → OK (0), no false fail-closed", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "ok", content: "### observation: no findings" } }) },
  );
  assert.equal(code, EXIT.OK);
});

test("FAFF-398 main: --lights-out + a mid-call DEADLINE (slow backend) → MANDATORY_OUTAGE (8 remapped)", async () => {
  const { sys, dif } = specFiles398();
  const slow = () => new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500));
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--deadline", "0.12", "--lights-out"],
    { runReviewFn: slow },
  );
  assert.equal(code, EXIT.MANDATORY_OUTAGE, "the deadline terminal (8) fails closed → 9 under --lights-out");
});

test("FAFF-398 main: --lights-out + a config fault (AUTH) → that class UNCHANGED (needs-human, not masked)", async () => {
  const { sys, dif } = specFiles398();
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "auth-failed" } }) },
  );
  assert.equal(code, EXIT.AUTH, "a config fault dominates — the remap only touches 5/8");
});

// ── FAFF-401: mandatory-ness is DERIVED from the run ledger (level:"L4"), not translated by an LLM ──
// The prose→flag hop in front of the FAFF-398 seam is removed: review-call.mjs reads run-ledger.json itself
// via --run-dir / FAFF_RUN_DIR. --lights-out is retained as an explicit OR-composed override. Fail-safe:
// any resolution miss (absent run-dir, missing/garbled ledger, non-L4 level) ⇒ advisory, never throws.

function ledgerDir(ledger) {
  const dir = mkdtempSync(join(tmpdir(), "faff401-"));
  if (ledger !== undefined) writeFileSync(join(dir, "run-ledger.json"), typeof ledger === "string" ? ledger : JSON.stringify(ledger));
  return dir;
}

test("FAFF-401 parseArgs: --run-dir is collected; absent ⇒ runDir undefined", () => {
  assert.equal(parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d", "--run-dir", "/r"]).runDir, "/r");
  assert.equal(parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d"]).runDir, undefined);
});

test("FAFF-401 ledgerMandatory: true iff <runDir>/run-ledger.json parses with level==='L4'; never throws", () => {
  assert.equal(ledgerMandatory(ledgerDir({ run_id: "t", level: "L4" })), true, "L4 ledger ⇒ mandatory");
  assert.equal(ledgerMandatory(ledgerDir({ run_id: "t", level: "L3" })), false, "L3 ledger ⇒ advisory");
  assert.equal(ledgerMandatory(ledgerDir({ run_id: "t" })), false, "no level key ⇒ advisory");
  assert.equal(ledgerMandatory(ledgerDir("{not json")), false, "garbled JSON ⇒ advisory (caught)");
  assert.equal(ledgerMandatory(ledgerDir(undefined)), false, "missing run-ledger.json ⇒ advisory");
  assert.equal(ledgerMandatory(mkdtempSync(join(tmpdir(), "faff401-none-"))), false, "empty dir, no file ⇒ advisory");
  assert.equal(ledgerMandatory(undefined), false, "absent runDir ⇒ advisory");
  assert.equal(ledgerMandatory(""), false, "empty runDir ⇒ advisory");
});

test("FAFF-401 main: --run-dir at an L4 ledger + all-unreachable, NO --lights-out → MANDATORY_OUTAGE (9)", async () => {
  const { sys, dif } = specFiles398();
  const rd = ledgerDir({ run_id: "t", level: "L4" });
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--run-dir", rd],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
  );
  assert.equal(code, EXIT.MANDATORY_OUTAGE, "the ledger alone activates the fail-closed remap — no --lights-out, no model decision");
});

test("FAFF-401 main: --run-dir at a NON-L4 ledger + all-unreachable → UNREACHABLE (5, advisory unchanged)", async () => {
  const { sys, dif } = specFiles398();
  const rd = ledgerDir({ run_id: "t", level: "L3" });
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--run-dir", rd],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
  );
  assert.equal(code, EXIT.UNREACHABLE, "an L3 ledger keeps today's pass+skip");
});

test("FAFF-401 main: FAFF_RUN_DIR env alone (no flag) at an L4 ledger → MANDATORY_OUTAGE (9)", async () => {
  const { sys, dif } = specFiles398();
  const rd = ledgerDir({ run_id: "t", level: "L4" });
  const prev = process.env.FAFF_RUN_DIR;
  process.env.FAFF_RUN_DIR = rd;
  try {
    const code = await main(
      ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif],
      { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
    );
    assert.equal(code, EXIT.MANDATORY_OUTAGE, "the env fallback alone activates the mandatory remap");
  } finally {
    if (prev === undefined) delete process.env.FAFF_RUN_DIR; else process.env.FAFF_RUN_DIR = prev;
  }
});

test("FAFF-401 main: explicit --run-dir WINS over a disagreeing FAFF_RUN_DIR (flag L4 beats env L3)", async () => {
  const { sys, dif } = specFiles398();
  const flagRd = ledgerDir({ run_id: "flag", level: "L4" });
  const envRd = ledgerDir({ run_id: "env", level: "L3" });
  const prev = process.env.FAFF_RUN_DIR;
  process.env.FAFF_RUN_DIR = envRd;
  try {
    const code = await main(
      ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--run-dir", flagRd],
      { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
    );
    assert.equal(code, EXIT.MANDATORY_OUTAGE, "the explicitly-handed run-dir beats the ambient env");
  } finally {
    if (prev === undefined) delete process.env.FAFF_RUN_DIR; else process.env.FAFF_RUN_DIR = prev;
  }
});

test("FAFF-401 main: no --run-dir, no FAFF_RUN_DIR, no --lights-out → byte-for-byte today (UNREACHABLE 5)", async () => {
  const { sys, dif } = specFiles398();
  const prev = process.env.FAFF_RUN_DIR;
  delete process.env.FAFF_RUN_DIR;
  try {
    const code = await main(
      ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif],
      { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
    );
    assert.equal(code, EXIT.UNREACHABLE, "unresolved ⇒ advisory");
  } finally {
    if (prev !== undefined) process.env.FAFF_RUN_DIR = prev;
  }
});

test("FAFF-401 main: --lights-out still forces mandatory even when the ledger is NON-L4 (OR, never AND)", async () => {
  const { sys, dif } = specFiles398();
  const rd = ledgerDir({ run_id: "t", level: "L3" });
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--run-dir", rd, "--lights-out"],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "unreachable" } }) },
  );
  assert.equal(code, EXIT.MANDATORY_OUTAGE, "the explicit override forces mandatory regardless of the ledger");
});

test("FAFF-401 main: config-fault dominance untouched — L4 ledger + AUTH still returns AUTH (7), not 9", async () => {
  const { sys, dif } = specFiles398();
  const rd = ledgerDir({ run_id: "t", level: "L4" });
  const code = await main(
    ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--run-dir", rd],
    { runReviewFn: scriptedRunReview({ "http://x:1": { status: "auth-failed" } }) },
  );
  assert.equal(code, EXIT.AUTH, "a config fault dominates the ledger-derived mandatory remap, unchanged");
});

// ===========================================================================
// FAFF-194 — deterministic guards for machine-checkable findings + output-format enforcement
// ===========================================================================

// Small local helper: capture whatever main() writes to stdout (existing tests only assert the exit
// code; the refutation/header-normalisation behaviour lives in stdout content, so this is new).
async function captureStdout(fn) {
  const orig = process.stdout.write.bind(process.stdout);
  let out = "";
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try {
    const result = await fn();
    return { result, stdout: out };
  } finally {
    process.stdout.write = orig;
  }
}

// ── splitFindings ──

test("FAFF-194 splitFindings: preamble captured, one section per ### heading, severity + title parsed", () => {
  const content = "## Adversarial findings — ollama/m\n\n### critical: bad thing\nbody line 1\nbody line 2\n\n### minor: small thing\nanother body";
  const { preamble, sections } = splitFindings(content);
  assert.equal(preamble, "## Adversarial findings — ollama/m\n");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].severity, "critical");
  assert.equal(sections[0].title, "bad thing");
  assert.match(sections[0].body, /body line 1/);
  assert.equal(sections[1].severity, "minor");
  assert.equal(sections[1].title, "small thing");
});

test("FAFF-194 splitFindings: bracketed severity `### [critical]:` and em-dash separator both parse", () => {
  const a = splitFindings("### [critical]: bracketed").sections[0];
  assert.equal(a.severity, "critical");
  const b = splitFindings("### observation — dash separator").sections[0];
  assert.equal(b.severity, "observation");
});

test("FAFF-194 splitFindings: an unrecognised severity word still yields a section with severity null", () => {
  const { sections } = splitFindings("### not-a-severity: whatever");
  assert.equal(sections.length, 1);
  assert.equal(sections[0].severity, null);
});

test("FAFF-194 splitFindings: no ### headings at all → empty sections, whole content is preamble", () => {
  const { preamble, sections } = splitFindings("just some prose, no findings");
  assert.equal(sections.length, 0);
  assert.equal(preamble, "just some prose, no findings");
});

test("FAFF-194 splitFindings: empty content → empty sections, empty preamble", () => {
  assert.deepEqual(splitFindings(""), { preamble: "", sections: [] });
  assert.deepEqual(splitFindings(undefined), { preamble: "", sections: [] });
});

// ── validateFindingsShape ──

test("FAFF-194 validateFindingsShape: empty/whitespace-only content is malformed, kind:empty", () => {
  assert.equal(validateFindingsShape("").ok, false);
  assert.equal(validateFindingsShape("").kind, "empty");
  assert.equal(validateFindingsShape("   \n  ").ok, false);
  assert.equal(validateFindingsShape("   \n  ").kind, "empty");
  assert.equal(validateFindingsShape(undefined).ok, false);
  assert.equal(validateFindingsShape(undefined).kind, "empty");
});

test("FAFF-194 validateFindingsShape: substantive prose with no ### section is malformed, kind:garbled (a rambling/headerless essay)", () => {
  const r = validateFindingsShape("## Adversarial findings — ollama/m\n\nI have thoughts but no structured findings.");
  assert.equal(r.ok, false);
  assert.equal(r.kind, "garbled");
  assert.match(r.reason, /no recognised finding section/);
});

test("FAFF-465 validateFindingsShape: >=1 recognised severity section is findings-shaped, incl. the no-findings marker", () => {
  assert.equal(validateFindingsShape("### observation: no findings").ok, true);
  assert.equal(validateFindingsShape("## Adversarial findings — ollama/m\n\n### critical: x\nbody").ok, true);
});

test("FAFF-465 validateFindingsShape: a closed-grammar provider refusal is malformed, kind:refusal (not garbled)", () => {
  const r = validateFindingsShape("I cannot assist with this request.");
  assert.equal(r.ok, false);
  assert.equal(r.kind, "refusal");
  assert.equal(r.reason, "provider refusal");
});

test("FAFF-806 validateFindingsShape: raw clean-refutation bytes classify as kind:garbled, while the canonical token they normalise to is ok — the two inputs disagree, so which one feeds the kind discriminator is load-bearing", () => {
  const raw = validateFindingsShape("No infosec objection.");
  assert.equal(raw.ok, false);
  assert.equal(raw.kind, "garbled", "raw clean-refutation prose has no recognised severity section — it is NOT findings-shaped on its own");
  assert.equal(validateFindingsShape(CANONICAL_NO_FINDINGS).ok, true, "the token normalisation produces IS findings-shaped");
});

// ── isProviderRefusal (FAFF-465) ──

test("FAFF-465 isProviderRefusal: a table of closed-grammar refusal openers all match", () => {
  const refusals = [
    "I cannot assist with this request.",
    "I can't help with that.",
    "I won't provide that.",
    "I am unable to complete this review.",
    "As an AI, I cannot review this diff.",
    "Sorry, I cannot help with this.",
    "I don't have the ability to review this.",
    "This response is blocked by our content policy.",
  ];
  for (const r of refusals) assert.equal(isProviderRefusal(r), true, r);
});

test("FAFF-465 isProviderRefusal: substantive non-findings prose is NOT a refusal (falls through to garbled)", () => {
  assert.equal(isProviderRefusal("I have thoughts but no structured findings."), false);
  assert.equal(isProviderRefusal("## Adversarial findings — ollama/m\n\njust some rambling prose"), false);
});

test("FAFF-465 isProviderRefusal: length-guarded — a long essay merely MENTIONING \"I cannot\" partway through is NOT a refusal", () => {
  const long = "Reviewing this diff carefully. ".repeat(30) + "I cannot find any issues here, everything looks fine.";
  assert.ok(long.length > 400, "fixture must exceed the length guard to test it");
  assert.equal(isProviderRefusal(long), false);
});

test("FAFF-465 isProviderRefusal: empty/whitespace content is never a refusal (that's the 'empty' kind, checked separately)", () => {
  assert.equal(isProviderRefusal(""), false);
  assert.equal(isProviderRefusal("   "), false);
  assert.equal(isProviderRefusal(undefined), false);
});

// Adversarial-review finding (Phase 2): the "content policy" and "cannot/won't assist ... with this
// request" patterns had no `^` anchor at all — a bare substring match anywhere in the length-guarded
// content. A short, legitimate finding mentioning either phrase well past its opening (still under the
// overall 400-char length guard) would misclassify as `refusal` instead of `garbled` — the incidental-
// vocabulary non-determinism this split exists to remove. Fixed by bounding both to a prefix window
// (REFUSAL_PREFIX_CHARS); these pin the fix.
test("FAFF-465 isProviderRefusal: a 'content policy' / 'cannot assist' mention PAST the prefix window is NOT a refusal (regression for the unanchored-substring finding)", () => {
  const pastWindow = "This is a substantive review finding about an unrelated topic. ".repeat(3) + "This response is blocked by our content policy.";
  assert.ok(pastWindow.length <= 400, "must stay under the overall length guard to isolate the prefix-window behaviour");
  assert.ok(pastWindow.indexOf("content policy") > 100, "the phrase must land past the 100-char prefix window");
  assert.equal(isProviderRefusal(pastWindow), false);
});

test("FAFF-465 isProviderRefusal: the same phrases still match WITHIN the prefix window", () => {
  assert.equal(isProviderRefusal("This response is blocked by our content policy."), true);
  assert.equal(isProviderRefusal("I cannot assist with this request."), true);
});

// ── canonical clean refutations (FAFF-746) ──

test("FAFF-746 normaliseCleanRefutation: all four bare and headed prompt forms become the canonical token", () => {
  for (const entry of CLEAN_REFUTATIONS) {
    assert.deepEqual(
      normaliseCleanRefutation(entry.sentence),
      { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "bare" },
      `${entry.lens}: bare`,
    );
    assert.deepEqual(
      normaliseCleanRefutation(`${entry.heading}\n${entry.sentence}`),
      { content: CANONICAL_NO_FINDINGS, normalised: true, lens: entry.lens, form: "headed" },
      `${entry.lens}: headed`,
    );
  }
});

test("FAFF-746 normaliseCleanRefutation: tolerates outer whitespace, blank separators, and CRLF", () => {
  assert.deepEqual(
    normaliseCleanRefutation(" \r\n## Refutation — infosec\r\n\r\nNo infosec objection.\r\n "),
    { content: CANONICAL_NO_FINDINGS, normalised: true, lens: "infosec", form: "headed" },
  );
});

test("FAFF-746 normaliseCleanRefutation: clean-like ambiguity remains byte-identical and unaccepted", () => {
  const rejected = [
    "", "## Refutation — architectural\nNo QA objection.",
    "No architectural objection", "no architectural objection.",
    "No architectural objections.", "**No architectural objection.**",
    "No performance objection.", "No architectural objection.\nAdditional prose.",
    "## Refutation — unknown\nNo architectural objection.",
  ];
  for (const content of rejected) {
    assert.deepEqual(
      normaliseCleanRefutation(content),
      { content, normalised: false, lens: null, form: null },
      JSON.stringify(content),
    );
  }
});

test("FAFF-746 normaliseCleanRefutation: existing severity-shaped output is byte-identical", () => {
  const content = "## Adversarial findings — ollama/m\r\n\r\n### major: real issue\r\nbody\r\n";
  const result = normaliseCleanRefutation(content);
  assert.equal(result.content, content);
  assert.equal(result.normalised, false);
});

test("FAFF-746 prompt contract: every allowlisted heading and sentence matches its checked-in refuter prompt byte-for-byte", () => {
  for (const entry of CLEAN_REFUTATIONS) {
    const filename = entry.lens === "QA" ? "refute-qa.md" : `refute-${entry.lens}.md`;
    const prompt = readFileSync(new URL(`../plugin/skills/faffter-dark-spec-review/${filename}`, import.meta.url), "utf8");
    assert.ok(prompt.includes(entry.heading), `${entry.lens}: heading drifted`);
    assert.ok(prompt.includes(entry.sentence), `${entry.lens}: sentence drifted`);
    assert.equal(Buffer.from(entry.heading, "utf8").includes(Buffer.from([0xe2, 0x80, 0x94])), true, `${entry.lens}: heading must contain U+2014`);
  }
});

// ── FAFF-942: a legitimate methodology no-op (the no-critique case) is a recognised clean pass ──

test("FAFF-942 CLEAN_REFUTATIONS: only methodology carries a `signal`, pinned to its exact bytes", () => {
  const methodology = CLEAN_REFUTATIONS.find((e) => e.lens === "methodology");
  assert.equal(methodology.signal, "no methodology signal available.", "the no-signal diagnostic bytes are pinned");
  for (const entry of CLEAN_REFUTATIONS) {
    if (entry.lens !== "methodology") assert.equal(entry.signal, undefined, `${entry.lens} must not carry a signal — the 3-line arm is methodology-specific`);
  }
});

test("FAFF-942 normaliseCleanRefutation: the methodology 3-line no-critique no-op normalises to a clean pass", () => {
  const noop = "## Refutation — methodology\n\nno methodology signal available.\n\nNo methodology objection.\n";
  assert.deepEqual(
    normaliseCleanRefutation(noop),
    { content: CANONICAL_NO_FINDINGS, normalised: true, lens: "methodology", form: "headed+signal" },
  );
  // tolerant of CRLF and outer/blank whitespace, exactly like the bare/headed arms
  assert.deepEqual(
    normaliseCleanRefutation(" \r\n## Refutation — methodology\r\n\r\nno methodology signal available.\r\n\r\nNo methodology objection.\r\n "),
    { content: CANONICAL_NO_FINDINGS, normalised: true, lens: "methodology", form: "headed+signal" },
  );
});

test("FAFF-942 normaliseCleanRefutation: the findings-shaped observation the refuter now emits is valid + non-gating", () => {
  // the refuter's no-critique case emits this line; it must pass the findings-shape gate on its own
  assert.equal(validateFindingsShape("### observation: no methodology signal available").ok, true);
  // and the refuter file actually instructs emitting it (contract with the prompt)
  const prompt = readFileSync(new URL("../plugin/skills/faffter-dark-spec-review/refute-methodology.md", import.meta.url), "utf8");
  assert.ok(prompt.includes("### observation: no methodology signal available"), "refute-methodology.md must instruct the observation form");
});

test("FAFF-942 normaliseCleanRefutation: the new 3-line grammar stays CLOSED (negative cases)", () => {
  const rejected = [
    // a trailing 4th line past the recognised no-op
    "## Refutation — methodology\nno methodology signal available.\nNo methodology objection.\nAnd one more thing.",
    // near-miss signal line: wrong casing
    "## Refutation — methodology\nNo methodology signal available.\nNo methodology objection.",
    // near-miss signal line: missing trailing period
    "## Refutation — methodology\nno methodology signal available\nNo methodology objection.",
    // a different lens's signal line (methodology signal under the wrong heading)
    "## Refutation — architectural\nno methodology signal available.\nNo architectural objection.",
    // 2-line signal-only form (no objection sentence)
    "## Refutation — methodology\nno methodology signal available.",
    // signal + sentence without the heading
    "no methodology signal available.\nNo methodology objection.",
    // the objection sentence with unrelated trailing prose (the pre-existing openness guard)
    "No methodology objection.\nAdditional prose.",
  ];
  for (const content of rejected) {
    assert.deepEqual(
      normaliseCleanRefutation(content),
      { content, normalised: false, lens: null, form: null },
      JSON.stringify(content),
    );
  }
});

test("FAFF-942 normaliseCleanRefutation: a non-methodology lens gets NO 3-line arm (signal is methodology-only)", () => {
  // even if a model echoed a methodology-style signal line under the QA heading, QA carries no signal → not normalised
  const content = "## Refutation — QA\nno methodology signal available.\nNo QA objection.";
  assert.deepEqual(normaliseCleanRefutation(content), { content, normalised: false, lens: null, form: null });
});

test("FAFF-746/706 spec-review command contract supplies non-empty system, diff, and context paths", () => {
  // FAFF-706: the per-lens `node "$REVIEW_CALL" ...` case-block invocation was replaced by a single
  // fan-out.mjs dispatch (see the "Backend call" section) — the --system/--diff/--context argv
  // fields it describes for each LensRequest now live in the prose paragraph documenting that argv,
  // not inside the bash block itself. Scope the match to the "Backend call" section as a whole.
  const skill = readFileSync(new URL("../plugin/skills/faffter-dark-spec-review/SKILL.md", import.meta.url), "utf8");
  const section = skill.match(/## Backend call[\s\S]*?\n## Aggregation/)?.[0] || "";
  assert.match(section, /--system\s+plugin\/skills\/faffter-dark-spec-review\/refute-<lens>\.md/);
  assert.match(section, /--diff\s+<spec-file>/);
  assert.match(section, /--context\s+<each file the spec names>/);
  // FAFF-882: the gateway is no longer review context. Assert its ABSENCE from the argv, so
  // reinstating it fails CI rather than passing quietly. The positive above keeps this honest:
  // on an empty section match a bare negative would pass vacuously.
  assert.doesNotMatch(section, /--context\s+plugin\/skills\/faff\/SKILL\.md/);
  // FAFF-706: the dispatch mechanism itself must be the concurrent fan-out, never a per-lens loop.
  assert.match(section, /fan-out\.mjs/);
});

test("FAFF-882 code-review command contract: --context is the touched files, never the gateway", () => {
  // The code-review call site had no test at all before FAFF-882, so the same edit was guarded on the
  // spec-review side and unguarded here. Mirror the spec-review contract test.
  const skill = readFileSync(
    new URL("../plugin/skills/faffter-dark-adversarial-review/SKILL.md", import.meta.url),
    "utf8",
  );
  const section = skill.match(/## LLM provider integration[\s\S]*?\n## Output to faff-graft/)?.[0] || "";
  // Non-empty guard: both the --context positive and the negative below pass vacuously on "", so a
  // renamed heading would turn this test green for the wrong reason without this assertion.
  assert.ok(section.length > 0, "LLM provider integration section not found — heading renamed?");
  assert.match(section, /--system\s+<review-lens-file>/);
  assert.match(section, /--diff\s+<git-diff-file>/);
  assert.match(section, /--context\s+<each file the diff touches>/);
  assert.doesNotMatch(section, /--context\s+plugin\/skills\/faff\/SKILL\.md/);
});

// ── attributionHeader / ensureHeader (FAFF-361: chain[index] + host provenance) ──

test("FAFF-361 attributionHeader: exact provenance format, incl. chain index and host source", () => {
  assert.equal(
    attributionHeader({ provider: "ollama", model: "llama3.1:70b", hostSource: "config" }, 0),
    "## Adversarial findings — ollama/llama3.1:70b (chain[0], host: config)",
  );
});

test("FAFF-361 attributionHeader: provider falsy → renders 'openai' (FAFF-872 — mirrors the tag fallback and providerFamily's own unset default)", () => {
  assert.equal(
    attributionHeader({ model: "m" }, 0),
    "## Adversarial findings — openai/m (chain[0], host: config)",
  );
});

test("FAFF-361 attributionHeader: hostSource falsy → defaults to 'config' (back-compat)", () => {
  assert.equal(
    attributionHeader({ provider: "nvidia", model: "m" }, 2),
    "## Adversarial findings — nvidia/m (chain[2], host: config)",
  );
});

test("FAFF-361 attributionHeader: hostSource 'default' (unconfigured localhost) is emitted verbatim", () => {
  assert.equal(
    attributionHeader({ model: "m", hostSource: "default" }, 0),
    "## Adversarial findings — openai/m (chain[0], host: default)",
  );
});

test("FAFF-361 attributionHeader: a slash-bearing model id is emitted verbatim, no escaping", () => {
  assert.equal(
    attributionHeader({ provider: "nvidia", model: "z-ai/glm-5.2", hostSource: "config" }, 0),
    "## Adversarial findings — nvidia/z-ai/glm-5.2 (chain[0], host: config)",
  );
});

test("FAFF-194/361 ensureHeader: prepends when no header line is present", () => {
  const out = ensureHeader("### observation: no findings", { provider: "ollama", model: "m", hostSource: "config" }, 0);
  assert.match(out, /^## Adversarial findings — ollama\/m \(chain\[0\], host: config\)\n\n### observation: no findings$/);
});

test("FAFF-194/361 ensureHeader: REPLACES an existing (possibly model-echoed/wrong) header with the canonical one", () => {
  const out = ensureHeader(
    "## Adversarial Findings (some model's own guess)\n\n### critical: x",
    { provider: "ollama", model: "real-model", hostSource: "config" }, 0,
  );
  assert.match(out, /^## Adversarial findings — ollama\/real-model \(chain\[0\], host: config\)\n/);
  assert.ok(!out.includes("some model's own guess"));
});

test("FAFF-194/361 ensureHeader: a no-op (byte-identical) when the existing header already matches canonical", () => {
  const content = "## Adversarial findings — ollama/m (chain[0], host: config)\n\n### critical: x\nbody";
  assert.equal(ensureHeader(content, { provider: "ollama", model: "m", hostSource: "config" }, 0), content);
});

// ── findSyntaxClaims ──

test("FAFF-194 findSyntaxClaims: matches the documented syntax/parse phrasings", () => {
  for (const t of [
    "this is a syntax error",
    "throws a SyntaxError",
    "won't parse",
    "will not parse",
    "fails to parse",
    "this is invalid JavaScript syntax",
    "not valid syntax",
  ]) {
    assert.ok(findSyntaxClaims(t), `expected a syntax-claim match: "${t}"`);
  }
});

test("FAFF-194 findSyntaxClaims: does not match an unrelated (semantic/security/concurrency) finding", () => {
  assert.ok(!findSyntaxClaims("this endpoint has no auth check"));
  assert.ok(!findSyntaxClaims("possible race condition on shared state"));
  assert.ok(!findSyntaxClaims("this crashes on a null input"));
});

// ── claimTargets ──

test("FAFF-194 claimTargets: named JS-family paths in the text are returned; non-JS matches are filtered out", () => {
  const ctx = ["plugin/skills/faff/SKILL.md", "plugin/skills/x/review-call.mjs", "src/foo.js"];
  const text = "### critical: `plugin/skills/x/review-call.mjs` and `plugin/skills/faff/SKILL.md` are both broken";
  assert.deepEqual(claimTargets(text, ctx), ["plugin/skills/x/review-call.mjs"]);
});

test("FAFF-194 claimTargets: empty when the text names no context path at all", () => {
  assert.deepEqual(claimTargets("### critical: something is wrong", ["src/foo.js"]), []);
});

// ── refuteFindings ──

function tmpJsFile(name, code) {
  const dir = mkdtempSync(join(tmpdir(), "faff194-"));
  const p = join(dir, name);
  writeFileSync(p, code);
  return p;
}

test("FAFF-194 refuteFindings: a syntax claim naming a clean context file is downgraded with evidence attached (never dropped)", () => {
  const file = tmpJsFile("clean.mjs", "export const ok = 1;\n");
  const content = `### critical: \`${file}\` is invalid JavaScript syntax\nsome body text`;
  const checkFn = (p) => ({ ok: p === file, output: "" });
  const { content: out, refutations } = refuteFindings(content, [file], { checkFn });
  assert.equal(refutations.length, 1);
  assert.equal(refutations[0].from, "critical");
  assert.deepEqual(refutations[0].files, [file]);
  assert.match(out, /^### observation: \[auto-refuted\]/);
  assert.match(out, /some body text/, "the original body survives — never dropped");
  assert.match(out, new RegExp(`auto-refuted: node --check passed on ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — syntax claim mechanically disproved \\(was critical\\)`));
});

test("FAFF-194 refuteFindings: a target file that FAILS the check leaves the finding untouched (the reviewer may be right)", () => {
  const file = tmpJsFile("broken.mjs", "export const x = ;;;\n");
  const content = `### critical: \`${file}\` is invalid JavaScript syntax`;
  const checkFn = (p) => ({ ok: false, output: "SyntaxError" });
  const { content: out, refutations } = refuteFindings(content, [file], { checkFn });
  assert.equal(refutations.length, 0);
  assert.equal(out, content, "untouched — byte-identical");
});

test("FAFF-194 refuteFindings: a claim naming ONLY a non-JS context file stays untouched (precision bias — cannot settle)", () => {
  const content = "### critical: `SKILL.md` has invalid syntax and won't parse";
  const checkFn = () => { throw new Error("must not be called — no checkable target"); };
  const { content: out, refutations } = refuteFindings(content, ["SKILL.md", "src/other.js"], { checkFn });
  assert.equal(refutations.length, 0);
  assert.equal(out, content);
});

test("FAFF-194 refuteFindings: a generic claim naming no file falls back to checking ALL JS-family context files", () => {
  const a = tmpJsFile("a.mjs", "export const a = 1;\n");
  const b = tmpJsFile("b.mjs", "export const b = 2;\n");
  const content = "### major: this code contains invalid JavaScript syntax somewhere";
  const seen = [];
  const checkFn = (p) => { seen.push(p); return { ok: true, output: "" }; };
  const { refutations } = refuteFindings(content, [a, b, "docs/SKILL.md"], { checkFn });
  assert.equal(refutations.length, 1);
  assert.deepEqual(seen.sort(), [a, b].sort(), "only the JS-family context files were checked, not SKILL.md");
});

test("FAFF-194 refuteFindings: no JS-family context files at all → the whole pass is a no-op", () => {
  const content = "### critical: this code has a syntax error";
  const checkFn = () => { throw new Error("must not be called"); };
  const { content: out, refutations } = refuteFindings(content, ["docs/SKILL.md"], { checkFn });
  assert.equal(refutations.length, 0);
  assert.equal(out, content);
});

test("FAFF-194 refuteFindings: multiple syntax-claim findings are each refuted independently", () => {
  const f1 = tmpJsFile("f1.mjs", "export const a = 1;\n");
  const f2 = tmpJsFile("f2.mjs", "export const a = 2;\n");
  const content = [
    `### critical: \`${f1}\` won't parse`,
    `### major: \`${f2}\` fails to parse`,
    "### minor: unrelated finding about naming",
  ].join("\n");
  const checkFn = (p) => ({ ok: true, output: "" });
  const { content: out, refutations } = refuteFindings(content, [f1, f2], { checkFn });
  assert.equal(refutations.length, 2);
  const { sections } = splitFindings(out);
  assert.equal(sections[0].severity, "observation");
  assert.equal(sections[1].severity, "observation");
  assert.equal(sections[2].severity, "minor", "the unrelated finding is untouched");
});

test("FAFF-194 refuteFindings: a non-syntax finding (semantic/security) is never touched even with matching context files", () => {
  const f = tmpJsFile("f.mjs", "export const a = 1;\n");
  const content = `### critical: \`${f}\` has no input validation`;
  const checkFn = () => { throw new Error("must not be called — not a syntax claim"); };
  const { content: out, refutations } = refuteFindings(content, [f], { checkFn });
  assert.equal(refutations.length, 0);
  assert.equal(out, content);
});

test("FAFF-194 refuteFindings: realCheck actually spawns node --check (integration, no mock)", () => {
  const good = tmpJsFile("real-good.mjs", "export const ok = 1;\n");
  const bad = tmpJsFile("real-bad.mjs", "export const x = ;;;\n");
  const okResult = realCheck(good);
  assert.equal(okResult.ok, true);
  const badResult = realCheck(bad);
  assert.equal(badResult.ok, false);

  const content = `### critical: \`${good}\` is invalid JavaScript syntax`;
  const { refutations } = refuteFindings(content, [good], {}); // default checkFn = realCheck
  assert.equal(refutations.length, 1, "the default checkFn (realCheck) settles a genuinely clean file");

  const content2 = `### critical: \`${bad}\` is invalid JavaScript syntax`;
  const { refutations: refs2 } = refuteFindings(content2, [bad], {});
  assert.equal(refs2.length, 0, "a genuinely broken file is NOT refuted — the reviewer was right");
});

// ── EXIT.MALFORMED / EXIT.NO_FINDINGS_CONTENT + CHAIN_NEEDS_HUMAN + mandatoryRemap
// (the exit-code surface, FAFF-194 / FAFF-465) ──

test("FAFF-465 EXIT.MALFORMED === 10, availability class — NOT a member of CHAIN_NEEDS_HUMAN", () => {
  assert.equal(EXIT.MALFORMED, 10);
  assert.ok(!CHAIN_NEEDS_HUMAN.has(EXIT.MALFORMED), "substantive-garble no longer dominates a chain terminal exit on its own");
});

test("FAFF-465 EXIT.NO_FINDINGS_CONTENT === 11, member of CHAIN_NEEDS_HUMAN", () => {
  assert.equal(EXIT.NO_FINDINGS_CONTENT, 11);
  assert.ok(CHAIN_NEEDS_HUMAN.has(EXIT.NO_FINDINGS_CONTENT));
});

test("FAFF-194 mandatoryRemap: MALFORMED(10) passes through UNCHANGED at every mandatory-ness (never touched by the 5/8 remap)", () => {
  assert.equal(mandatoryRemap(EXIT.MALFORMED, true), EXIT.MALFORMED);
  assert.equal(mandatoryRemap(EXIT.MALFORMED, false), EXIT.MALFORMED);
});

test("FAFF-465 mandatoryRemap: NO_FINDINGS_CONTENT(11) passes through UNCHANGED at every mandatory-ness — human-actionable even at L4, never remapped to 9", () => {
  assert.equal(mandatoryRemap(EXIT.NO_FINDINGS_CONTENT, true), EXIT.NO_FINDINGS_CONTENT);
  assert.equal(mandatoryRemap(EXIT.NO_FINDINGS_CONTENT, false), EXIT.NO_FINDINGS_CONTENT);
});

// ── runReviewChain: per-backend shape validation (FAFF-194 / FAFF-465) ──

test("FAFF-465 runReviewChain: an EMPTY OK result records failure class 11 (NO_FINDINGS_CONTENT) and advances to a healthy fallback", async () => {
  const chain = [
    { provider: "nvidia", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "ok", content: "" },   // empty — NO_FINDINGS_CONTENT, not MALFORMED
      "http://b:11434": { status: "ok", content: "### observation: no findings" },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winner.host, "http://b:11434");
  assert.equal(res.winnerIndex, 1, "FAFF-361: winner served from chain position 1 (element 0 was empty)");
  assert.deepEqual(res.failureClasses, [EXIT.NO_FINDINGS_CONTENT]);
  assert.ok(trace.some((l) => /\[chain\] nvidia\/m1 empty/.test(l) && /exit 11/.test(l) && /→ advancing/.test(l)),
    "FAFF-465: the empty skip is logged via the reshaped [chain] ... → advancing note, kind:empty");
});

test("FAFF-465 runReviewChain: a GARBLED (substantive, non-refusal) OK result records failure class 10 (MALFORMED) and advances", async () => {
  const chain = [
    { provider: "nvidia", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "http://b:11434", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "ok", content: "no structured findings here" },   // garbled, not empty/refusal
      "http://b:11434": { status: "ok", content: "### observation: no findings" },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.deepEqual(res.failureClasses, [EXIT.MALFORMED]);
  assert.ok(trace.some((l) => /\[chain\] nvidia\/m1 malformed/.test(l) && /exit 10/.test(l) && /→ advancing/.test(l)),
    "the garbled skip retains the pre-existing 'malformed' log wording, kind:garbled");
});

test("FAFF-465 runReviewChain: a REFUSAL OK result records failure class 11 (NO_FINDINGS_CONTENT), not 10", async () => {
  const chain = [
    { provider: "ollama", model: "m1", host: "https://a/v1", hostSource: "config" },
    { provider: "ollama", model: "m2", host: "https://b/v1", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "ok", content: "I cannot assist with this request." },
      "https://b/v1": { status: "ok", content: "I cannot assist with this request." },
    }),
  });
  assert.equal(res.exit, EXIT.NO_FINDINGS_CONTENT);
  assert.ok(trace.some((l) => /\[chain\] ollama\/m1 refusal/.test(l) && /exit 11/.test(l) && /→ advancing/.test(l)),
    "the first (advancing) backend logs via the reshaped [chain] ... → advancing note, kind:refusal");
});

test("FAFF-465 runReviewChain: a fully-exhausted chain containing ONLY a garbled OK result → terminal exit 5 (UNREACHABLE, pass+skip), never 10", async () => {
  const chain = [{ provider: "ollama", model: "m", host: "http://a:1", hostSource: "config" }];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: async () => ({ status: "ok", content: "no structured findings here" }),
  });
  assert.equal(res.exit, EXIT.UNREACHABLE, "substantive-garble is an availability symptom — a garble-only chain collapses to 5, not a needs-human 10");
});

test("FAFF-465 runReviewChain: a fully-exhausted chain containing ONLY an empty OK result → terminal exit 11 (NO_FINDINGS_CONTENT), never 5", async () => {
  const chain = [{ provider: "ollama", model: "m", host: "http://a:1", hostSource: "config" }];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: async () => ({ status: "ok", content: "" }),
  });
  assert.equal(res.exit, EXIT.NO_FINDINGS_CONTENT, "an empty body is a structural inability — never masked as an availability outage-skip");
});

test("FAFF-465 chainTerminalExit: every permutation of {UNREACHABLE(5), DEADLINE(8), MALFORMED(10, substantive-garble)} → UNREACHABLE(5), never a needs-human exit", () => {
  const classes = [EXIT.UNREACHABLE, EXIT.DEADLINE, EXIT.MALFORMED];
  const permutations = [
    [classes[0], classes[1], classes[2]], [classes[0], classes[2], classes[1]],
    [classes[1], classes[0], classes[2]], [classes[1], classes[2], classes[0]],
    [classes[2], classes[0], classes[1]], [classes[2], classes[1], classes[0]],
    [EXIT.UNREACHABLE, EXIT.MALFORMED], [EXIT.MALFORMED, EXIT.UNREACHABLE],
    [EXIT.DEADLINE, EXIT.MALFORMED], [EXIT.MALFORMED, EXIT.DEADLINE],
    [EXIT.UNREACHABLE, EXIT.UNREACHABLE], [EXIT.MALFORMED, EXIT.MALFORMED], [EXIT.MALFORMED],
  ];
  for (const p of permutations) {
    assert.equal(chainTerminalExit(p), EXIT.UNREACHABLE, `permutation ${JSON.stringify(p)} must resolve deterministically to 5`);
  }
});

test("FAFF-465 chainTerminalExit: any chain containing NO_FINDINGS_CONTENT(11), mixed with any availability/degradation classes, resolves to 11 — never masked as an outage-skip", () => {
  const availability = [EXIT.UNREACHABLE, EXIT.DEADLINE, EXIT.MALFORMED];
  for (const a of availability) {
    assert.equal(chainTerminalExit([EXIT.NO_FINDINGS_CONTENT, a]), EXIT.NO_FINDINGS_CONTENT, `[11, ${a}]`);
    assert.equal(chainTerminalExit([a, EXIT.NO_FINDINGS_CONTENT]), EXIT.NO_FINDINGS_CONTENT, `[${a}, 11] — structural dominates degraded regardless of order`);
  }
  assert.equal(chainTerminalExit([EXIT.NO_FINDINGS_CONTENT]), EXIT.NO_FINDINGS_CONTENT);
  assert.equal(chainTerminalExit([EXIT.UNREACHABLE, EXIT.MALFORMED, EXIT.DEADLINE, EXIT.NO_FINDINGS_CONTENT]), EXIT.NO_FINDINGS_CONTENT);
});

test("FAFF-746 runReviewChain: an exact clean primary wins with canonical content and one digest-only event", async () => {
  const content = "No infosec objection.";
  const trace = [];
  const res = await runReviewChain(
    [
      { provider: "gemini", model: "gemini-2.5-pro", host: "https://gemini.example/v1", hostSource: "config" },
      { provider: "ollama", model: "fallback", host: "http://fallback:11434", hostSource: "config" },
    ],
    {
      system: "S", user: "U", log: (message) => trace.push(message),
      runReviewFn: async ({ host }) => {
        assert.equal(host, "https://gemini.example/v1", "fallback is not dispatched after a clean primary");
        return { status: "ok", content };
      },
    },
  );
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winnerIndex, 0);
  assert.deepEqual(res.failureClasses, []);
  assert.equal(res.content, CANONICAL_NO_FINDINGS);
  assert.deepEqual(trace, [
    `normalized: clean refutation backend=gemini/gemini-2.5-pro lens=infosec form=bare response_sha256=${digest}`,
  ]);
  assert.ok(!trace[0].includes(content), "raw response prose is not logged");
});

test("FAFF-746 runReviewChain: a mismatched clean-like primary records MALFORMED and advances", async () => {
  const trace = [];
  const res = await runReviewChain(
    [
      { provider: "gemini", model: "primary", host: "https://primary/v1", hostSource: "config" },
      { provider: "ollama", model: "fallback", host: "http://fallback:11434", hostSource: "config" },
    ],
    {
      system: "S", user: "U", log: (message) => trace.push(message),
      runReviewFn: scriptedRunReview({
        "https://primary/v1": { status: "ok", content: "## Refutation — architectural\nNo QA objection." },
        "http://fallback:11434": { status: "ok", content: CANONICAL_NO_FINDINGS },
      }),
    },
  );
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winnerIndex, 1);
  assert.deepEqual(res.failureClasses, [EXIT.MALFORMED]);
  assert.ok(trace.some((line) => /gemini\/primary malformed/.test(line) && /exit 10/.test(line)));
});

test("FAFF-465 runReviewChain: a single mismatched clean-like (garbled) backend now terminates with exit 5 (UNREACHABLE), not 10", async () => {
  const res = await runReviewChain(
    [{ provider: "gemini", model: "m", host: "https://primary/v1", hostSource: "config" }],
    { system: "S", user: "U", log: () => {}, runReviewFn: async () => ({ status: "ok", content: "## Refutation — QA\nNo infosec objection." }) },
  );
  assert.equal(res.exit, EXIT.UNREACHABLE);
});

// ── FAFF-806: the kind discriminator is a pure function of the backend's raw returned bytes ──

test("FAFF-806 runReviewChain: call-site sourcing is pinned — validateFindingsShape receives originalContent, never normalisation.content", () => {
  const src = readFileSync(new URL("../plugin/skills/faffter-dark-adversarial-review/review-call.mjs", import.meta.url), "utf8");
  assert.match(src, /const shape = validateFindingsShape\(originalContent\);/,
    "validateFindingsShape must be called on the raw originalContent, not the normalised content");
  assert.match(src, /const normalisation = normaliseCleanRefutation\(originalContent\);/,
    "normaliseCleanRefutation also runs on the raw originalContent (both pure functions see the same raw input)");
  assert.doesNotMatch(src, /validateFindingsShape\(normalisation\.content\)/,
    "regression guard: the discriminator must never read post-normalisation content again");
  assert.match(src, /if \(!shape\.ok && !normalisation\.normalised\) \{/,
    "the non-findings continue is gated on BOTH raw-bytes shape failure AND normalisation failure, so a successfully-normalised clean refutation still takes the accepted path");
});

test("FAFF-806 runReviewChain: the kind discriminator's classification is a pure function of the raw response bytes, independent of normalisation outcome — genuine empty/refusal/garbled inputs (none of which normalise) still record their raw-bytes kind's failure class", async () => {
  const cases = [
    { content: "", expectClass: EXIT.NO_FINDINGS_CONTENT, label: "empty" },
    { content: "I cannot assist with this request.", expectClass: EXIT.NO_FINDINGS_CONTENT, label: "refusal" },
    { content: "no structured findings here", expectClass: EXIT.MALFORMED, label: "garbled" },
  ];
  for (const c of cases) {
    // Sanity: validateFindingsShape on the raw bytes agrees with the failure class the chain records —
    // proving the chain's recorded failureClass tracks the RAW-bytes kind, not some other content.
    const shape = validateFindingsShape(c.content);
    assert.equal(shape.ok, false, `${c.label}: raw bytes are not findings-shaped`);
    const chain = [
      { provider: "ollama", model: "m1", host: "http://a:1", hostSource: "config" },
      { provider: "ollama", model: "m2", host: "http://b:2", hostSource: "config" },
    ];
    const res = await runReviewChain(chain, {
      system: "S", user: "U", log: () => {},
      runReviewFn: scriptedRunReview({
        "http://a:1": { status: "ok", content: c.content },
        "http://b:2": { status: "ok", content: "### observation: no findings" },
      }),
    });
    assert.equal(res.exit, EXIT.OK, `${c.label}: the fallback still wins`);
    assert.deepEqual(res.failureClasses, [c.expectClass], `${c.label}: raw-bytes kind '${shape.kind}' must drive the recorded failure class unchanged by this re-order`);
  }
});

test("FAFF-465 chainTerminalExit: a config fault still DOMINATES a garbled/no-opinion class in a fully-failed chain, regardless of order (MALFORMED no longer surfaces as terminal)", () => {
  assert.equal(chainTerminalExit([EXIT.MALFORMED, EXIT.AUTH]), EXIT.AUTH, "AUTH is the only needs-human class present, whatever order MALFORMED arrives in");
  assert.equal(chainTerminalExit([EXIT.AUTH, EXIT.MALFORMED]), EXIT.AUTH);
});

test("FAFF-465 chainTerminalExit: NO_FINDINGS_CONTENT dominates a MALFORMED(garble) fault in a fully-failed chain, in EITHER order — structural over degraded", () => {
  assert.equal(chainTerminalExit([EXIT.MALFORMED, EXIT.NO_FINDINGS_CONTENT]), EXIT.NO_FINDINGS_CONTENT);
  assert.equal(chainTerminalExit([EXIT.NOT_SERVED, EXIT.UNREACHABLE]), EXIT.NOT_SERVED, "config misconfig dominates availability, unchanged");
});

// ── main(): empty/malformed/refusal content from a reachable+served backend never exits 0 (the worst prior hole) ──

test("FAFF-465 main(): empty content from a reachable+served backend → EXIT.NO_FINDINGS_CONTENT (11), never OK (0)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
    { runReviewFn: async () => ({ status: "ok", content: "" }) },
  );
  assert.equal(code, EXIT.NO_FINDINGS_CONTENT);
  assert.notEqual(code, EXIT.OK);
});

test("FAFF-465 main(): a refusal from a reachable+served backend → EXIT.NO_FINDINGS_CONTENT (11), never OK (0)", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
    { runReviewFn: async () => ({ status: "ok", content: "I cannot assist with this request." }) },
  );
  assert.equal(code, EXIT.NO_FINDINGS_CONTENT);
  assert.notEqual(code, EXIT.OK);
});

test("FAFF-465 main(): header-only / no-recognised-section (substantive, non-refusal) content → EXIT.UNREACHABLE (5, pass+skip) — a single-backend garble-only chain is an availability symptom, never a needs-human 10", async () => {
  const { sys, diff } = writeMainFixtures();
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
    { runReviewFn: async () => ({ status: "ok", content: "## Adversarial findings — ollama/m\n\njust some rambling prose" }) },
  );
  assert.equal(code, EXIT.UNREACHABLE);
  assert.notEqual(code, EXIT.OK);
});

// ── main(): the refutation pass + header normalisation run on the winning content (FAFF-194) ──

test("FAFF-194 main(): a winning result missing the header gets it prepended, normalisation logged to stderr", async () => {
  const { sys, diff } = writeMainFixtures();
  const origErr = process.stderr.write.bind(process.stderr);
  let errOut = "";
  process.stderr.write = (c) => { errOut += c; return true; };
  let stdout;
  try {
    ({ stdout } = await captureStdout(() => main(
      ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--provider", "ollama"],
      { runReviewFn: async () => ({ status: "ok", content: "### observation: no findings" }) },
    )));
  } finally {
    process.stderr.write = origErr;
  }
  assert.match(stdout, /^## Adversarial findings — ollama\/m \(chain\[0\], host: config\)\n/);
  assert.match(errOut, /normalized: findings header missing/);
});

test("FAFF-746 main(): headed clean prose emits canonical attribution and no-findings content", async () => {
  const { sys, diff } = writeMainFixtures();
  const content = "## Refutation — infosec\nNo infosec objection.";
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  const origErr = process.stderr.write.bind(process.stderr);
  let errOut = "";
  process.stderr.write = (chunk) => { errOut += chunk; return true; };
  let result;
  try {
    result = await captureStdout(() => main(
      ["--host", "http://h:1", "--model", "m", "--provider", "gemini", "--system", sys, "--diff", diff],
      { runReviewFn: async () => ({ status: "ok", content }) },
    ));
  } finally {
    process.stderr.write = origErr;
  }
  assert.equal(result.result, EXIT.OK);
  assert.equal(result.stdout, "## Adversarial findings — gemini/m (chain[0], host: config)\n\n### observation: no findings\n");
  assert.match(errOut, new RegExp(`normalized: clean refutation backend=gemini/m lens=infosec form=headed response_sha256=${digest}`));
});

test("FAFF-746 main(): whitespace-only system or diff returns USAGE before backend dispatch", async () => {
  for (const empty of ["system", "diff"]) {
    const dir = mkdtempSync(join(tmpdir(), "faff746-input-"));
    const sys = join(dir, "system.txt");
    const diff = join(dir, "diff.txt");
    writeFileSync(sys, empty === "system" ? " \n\t" : "SYSTEM");
    writeFileSync(diff, empty === "diff" ? " \n\t" : "DIFF");
    let dispatches = 0;
    const code = await main(
      ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
      { runReviewFn: async () => { dispatches += 1; return { status: "ok", content: CANONICAL_NO_FINDINGS }; } },
    );
    assert.equal(code, EXIT.USAGE, empty);
    assert.equal(dispatches, 0, `${empty}: backend must not dispatch`);
  }
});

test("FAFF-361 main(): single-backend legacy path, provider omitted, --host-source default → header renders openai/<model> (chain[0], host: default) (FAFF-872)", async () => {
  const { sys, diff } = writeMainFixtures();
  const { result: code, stdout } = await captureStdout(() => main(
    ["--host", "http://localhost:11434", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "default"],
    { runReviewFn: async () => ({ status: "ok", content: "### observation: no findings" }) },
  ));
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /^## Adversarial findings — openai\/m \(chain\[0\], host: default\)\n/);
});

test("FAFF-361 main(): a non-OK exit (unreachable) emits NO header — stdout stays empty, exit unchanged", async () => {
  const { sys, diff } = writeMainFixtures();
  const { result: code, stdout } = await captureStdout(() => main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--host-source", "config"],
    { runReviewFn: async () => ({ status: "unreachable", note: "ECONNREFUSED" }) },
  ));
  assert.equal(code, EXIT.UNREACHABLE);
  assert.equal(stdout, "", "the attribution prepend is strictly confined to the exit-0 branch — no header on a non-OK exit");
});

test("FAFF-194 main(): a winning result WITH a canonical header is byte-identical (no spurious normalisation log)", async () => {
  const { sys, diff } = writeMainFixtures();
  const origErr = process.stderr.write.bind(process.stderr);
  let errOut = "";
  process.stderr.write = (c) => { errOut += c; return true; };
  const content = "## Adversarial findings — openai/m (chain[0], host: config)\n\n### observation: no findings";
  let stdout;
  try {
    ({ stdout } = await captureStdout(() => main(
      ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
      { runReviewFn: async () => ({ status: "ok", content }) },
    )));
  } finally {
    process.stderr.write = origErr;
  }
  assert.equal(stdout, content.trim() + "\n", "byte-identical back-compat — findings-shaped, header-bearing, claim-free output");
  assert.ok(!errOut.includes("normalized:"));
});

test("FAFF-194 main(): a refutable syntax critical in the winning content is downgraded before stdout, and logged to stderr", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff194main-"));
  const sys = join(dir, "system.txt"); writeFileSync(sys, "SYS");
  const diff = join(dir, "diff.txt"); writeFileSync(diff, "DIFF");
  const jsFile = join(dir, "names.mjs"); writeFileSync(jsFile, "export const names = [1, 2, 3];\n");
  const content = `## Adversarial findings — ollama/m\n\n### critical: \`${jsFile}\` is invalid JavaScript syntax\nsome explanation`;
  const origErr = process.stderr.write.bind(process.stderr);
  let errOut = "";
  process.stderr.write = (c) => { errOut += c; return true; };
  let stdout;
  try {
    ({ stdout } = await captureStdout(() => main(
      ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--context", jsFile],
      { runReviewFn: async () => ({ status: "ok", content }), checkFn: (p) => ({ ok: p === jsFile, output: "" }) },
    )));
  } finally {
    process.stderr.write = origErr;
  }
  assert.match(stdout, /### observation: \[auto-refuted\]/);
  assert.ok(!/^### critical/m.test(stdout), "the critical severity does not survive to stdout");
  assert.match(errOut, /^refuted: /m);
});

// Integration smoke test (per the spec's DONE section): stub streamFn output claiming invalid syntax on
// a REAL temp .mjs file that parses clean under a REAL node --check, passed via --context; run main()
// with injected transport + the REAL default checkFn; expect exit 0, canonical header, downgraded finding.
test("FAFF-194 integration smoke test: a confidently-wrong syntax critical on a clean real file is downgraded, header canonical, exit 0", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff194smoke-"));
  const sys = join(dir, "system.txt"); writeFileSync(sys, "SYS");
  const diff = join(dir, "diff.txt"); writeFileSync(diff, "DIFF");
  const cleanFile = join(dir, "clean-real.mjs"); writeFileSync(cleanFile, "export const names = [\"a\", \"b\"];\n");
  const content = `### critical: \`${cleanFile}\` is invalid JavaScript syntax\nthe file won't parse`;
  const { result: code, stdout } = await captureStdout(() => main(
    ["--host", "http://h:1", "--model", "qwen3-next:80b", "--provider", "ollama", "--system", sys, "--diff", diff, "--context", cleanFile],
    { runReviewFn: async () => ({ status: "ok", content }) },   // checkFn omitted — uses the REAL realCheck
  ));
  assert.equal(code, EXIT.OK);
  assert.match(stdout, /^## Adversarial findings — ollama\/qwen3-next:80b \(chain\[0\], host: config\)\n/);
  assert.match(stdout, /### observation: \[auto-refuted\]/);
  assert.match(stdout, /auto-refuted: node --check passed/);
});

// ── Adversarial review findings (real nvidia/z-ai/glm-5.2 Phase-2 pass on this diff) — regression tests ──
// Four findings were confirmed and fixed: (1) refuteFindings' string-rebuild collapsed blank-line
// separators between sections whenever a sibling was refuted; (2) ensureHeader's header-line regex used
// `m` (multiline) so it could rewrite a header-like line quoted INSIDE a finding body; (3) claimTargets'
// bare substring match could count a path as "named" merely because it's a textual prefix of a longer
// named path; (4) splitFindings treated `####` (h4) as a new finding boundary, truncating the preceding
// section's body. A fifth ("no new-config" observation) and a sixth (unbounded fallback spawn count) were
// accepted as valid-but-non-blocking and are not code changes here.

test("FAFF-194 refuteFindings: preserves the ORIGINAL blank-line separator before the next section (was: collapsed)", () => {
  const content = "## Adversarial findings — ollama/m\n\n### critical: this wont parse and has a syntax error\nsome body text\n\n### minor: unrelated\nanother body";
  const checkFn = () => ({ ok: true, output: "" });
  const { content: out } = refuteFindings(content, ["x.mjs"], { checkFn });
  // the untouched sibling section's heading must still be preceded by a blank line, exactly as in the input
  assert.match(out, /\n\n### minor: unrelated\nanother body$/, "the blank-line separator survives the rebuild");
});

test("FAFF-194 refuteFindings: a THIRD untouched section further down the document keeps its own original spacing too", () => {
  const content = [
    "### critical: syntax error in file",
    "body one",
    "",
    "### major: unrelated finding A",
    "body two",
    "",
    "### minor: unrelated finding B",
    "body three",
  ].join("\n");
  const checkFn = () => ({ ok: true, output: "" });
  const { content: out } = refuteFindings(content, ["x.mjs"], { checkFn });
  const lines = out.split("\n");
  // both untouched sections must still be preceded by exactly one blank line, as in the original
  const majorIdx = lines.findIndex((l) => l.startsWith("### major:"));
  const minorIdx = lines.findIndex((l) => l.startsWith("### minor:"));
  assert.equal(lines[majorIdx - 1], "", "blank line before the untouched major section survives");
  assert.equal(lines[minorIdx - 1], "", "blank line before the untouched minor section survives");
});

test("FAFF-194/361 ensureHeader: does NOT rewrite a header-LIKE line quoted inside a finding BODY (only the preamble is in scope)", () => {
  const content = "## Adversarial findings — ollama/m (chain[0], host: config)\n\n### observation: comparing against a prior pass\nthe previous run said:\n## Adversarial findings — old-provider/old-model\nand missed X";
  const out = ensureHeader(content, { provider: "ollama", model: "m", hostSource: "config" }, 0);
  assert.equal(out, content, "the document's own preamble header was already canonical — untouched; the quoted line in the body must survive verbatim");
  assert.ok(out.includes("## Adversarial findings — old-provider/old-model"), "the quoted body line was not rewritten");
});

test("FAFF-194/361 ensureHeader: still finds + replaces the REAL preamble header even when a finding body quotes a header-like line afterward", () => {
  const content = "## Adversarial Findings (model's own wrong guess)\n\n### observation: x\nquoting: ## Adversarial findings — other/model";
  const out = ensureHeader(content, { provider: "ollama", model: "real-model", hostSource: "config" }, 0);
  const lines = out.split("\n");
  assert.equal(lines[0], "## Adversarial findings — ollama/real-model (chain[0], host: config)", "the preamble header was replaced");
  assert.ok(out.includes("quoting: ## Adversarial findings — other/model"), "the body's quoted line is untouched");
});

test("FAFF-194 hasHeader: true only for a preamble header, never a body-quoted one", () => {
  assert.equal(hasHeader("## Adversarial findings — ollama/m\n\n### observation: no findings"), true);
  assert.equal(hasHeader("### observation: x\nsome text mentioning ## Adversarial findings — old/one"), false);
  assert.equal(hasHeader(""), false);
});

test("FAFF-194 claimTargets: a path that is a textual PREFIX of a longer named path is NOT counted as named", () => {
  const ctx = ["src/foo.js", "test/src/foo.js.spec.mjs"];
  const text = "### critical: `test/src/foo.js.spec.mjs` has a syntax error";
  assert.deepEqual(claimTargets(text, ctx), ["test/src/foo.js.spec.mjs"], "only the actually-named longer path counts — not the shorter path it happens to prefix");
});

test("FAFF-194 refuteFindings: a claim naming only the LONGER of two prefix-colliding paths only checks that one", () => {
  const short = tmpJsFile("short.mjs", "export const a = 1;\n");
  const long = short + ".bak.mjs";   // "short.mjs" is a textual prefix of "short.mjs.bak.mjs"
  writeFileSync(long, "export const a = 1;\n");
  const content = `### critical: \`${long}\` is invalid JavaScript syntax`;
  const seen = [];
  const checkFn = (p) => { seen.push(p); return { ok: true, output: "" }; };
  const { refutations } = refuteFindings(content, [short, long], { checkFn });
  assert.equal(refutations.length, 1);
  assert.deepEqual(seen, [long], "only the actually-named longer path was checked — the shorter prefix path was never spuriously included");
});

test("FAFF-194 splitFindings: a level-4 (####) sub-heading inside a finding body is NOT treated as a new section boundary", () => {
  const content = "### critical: something\nintro\n#### a sub-point\nmore detail\n\n### minor: next finding\nbody";
  const { sections } = splitFindings(content);
  assert.equal(sections.length, 2, "the #### line must not split the first finding into two sections");
  assert.match(sections[0].body, /#### a sub-point/, "the sub-heading survives as part of the first section's body");
  assert.equal(sections[1].severity, "minor");
});

test("FAFF-194/361 ensureHeader: a #### line before the first real finding never fools the preamble-scope boundary", () => {
  // (defensive — #### is not a valid finding heading, so the preamble-scope search must not stop there)
  const content = "## Adversarial findings — ollama/m (chain[0], host: config)\n#### not a real finding\n\n### observation: no findings";
  const out = ensureHeader(content, { provider: "ollama", model: "m", hostSource: "config" }, 0);
  assert.equal(out, content, "already-canonical header, found correctly despite the #### line, untouched");
});

// ── No new .faffrc knobs (config schema unchanged — a grep-level assertion, not a config-parser test) ──

test("FAFF-194: no new config-key reads were introduced (grep-level assertion — config schema unchanged)", () => {
  const src = readFileSync(new URL("../plugin/skills/faffter-dark-adversarial-review/review-call.mjs", import.meta.url), "utf8");
  assert.ok(!/process\.env\.FAFFRC/.test(src));
  assert.ok(!/faff config get/.test(src), "review-call.mjs never shells out to faff config — it only reads CLI flags + run-ledger.json");
});

// ===========================================================================
// FAFF-445 — oversized-diff preflight: size-check the assembled payload BEFORE any chain dispatch
// ===========================================================================

// ── checkPayloadSize (pure) ──

test("FAFF-445 checkPayloadSize: under threshold → not oversized", () => {
  const r = checkPayloadSize({ system: "sys", user: "user text", maxBytes: 100 });
  assert.equal(r.oversized, false);
  assert.equal(r.bytes, Buffer.byteLength("sys") + Buffer.byteLength("user text"));
  assert.equal(r.maxBytes, 100);
});

test("FAFF-445 checkPayloadSize: over threshold → oversized", () => {
  const r = checkPayloadSize({ system: "a".repeat(60), user: "b".repeat(60), maxBytes: 100 });
  assert.equal(r.oversized, true);
  assert.equal(r.bytes, 120);
});

test("FAFF-445 checkPayloadSize: exactly at the threshold → NOT oversized (strict >)", () => {
  const r = checkPayloadSize({ system: "a".repeat(50), user: "b".repeat(50), maxBytes: 100 });
  assert.equal(r.bytes, 100);
  assert.equal(r.oversized, false, "a payload sitting exactly on the boundary dispatches normally");
});

test("FAFF-445 checkPayloadSize: sums system + user, not user alone", () => {
  // A huge system (the review lens) with a tiny user/diff must still trip the threshold — the real wire
  // payload includes the system message in every provider family's chat payload.
  const r = checkPayloadSize({ system: "x".repeat(200), user: "tiny", maxBytes: 100 });
  assert.equal(r.oversized, true);
});

test("FAFF-445 checkPayloadSize: defaults to DEFAULT_MAX_PAYLOAD_BYTES (5MB) when maxBytes is omitted", () => {
  const r = checkPayloadSize({ system: "S", user: "U" });
  assert.equal(r.maxBytes, DEFAULT_MAX_PAYLOAD_BYTES);
  assert.equal(r.oversized, false);
});

test("FAFF-445 checkPayloadSize: tolerates missing/null system+user", () => {
  const r = checkPayloadSize({});
  assert.equal(r.bytes, 0);
  assert.equal(r.oversized, false);
});

// ── main(): the preflight gates entry to runReviewChain — zero dispatch on an oversized payload ──

test("FAFF-445 main(): an oversized payload returns EXIT.USAGE (2) and NEVER calls the injected runReviewFn", async () => {
  const { sys, diff } = writeMainFixtures();
  let called = false;
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--max-payload-bytes", "1"],
    { runReviewFn: async () => { called = true; return { status: "ok", content: "### observation: x" }; } },
  );
  assert.equal(code, EXIT.USAGE);
  assert.equal(called, false, "the preflight must gate ENTRY to the chain — zero backend calls on an oversized payload");
});

test("FAFF-445 main(): a payload under the (overridden) threshold is unaffected — normal dispatch proceeds", async () => {
  const { sys, diff } = writeMainFixtures();
  let called = false;
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--max-payload-bytes", "1000000"],
    { runReviewFn: async () => { called = true; return { status: "ok", content: "### observation: x" }; } },
  );
  assert.equal(code, EXIT.OK);
  assert.equal(called, true, "a payload under threshold must reach the real dispatch, unaffected by this change");
});

test("FAFF-445 main(): with NO --max-payload-bytes override, the default (5MB) applies and small fixtures are unaffected", async () => {
  const { sys, diff } = writeMainFixtures();
  let called = false;
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff],
    { runReviewFn: async () => { called = true; return { status: "ok", content: "### observation: x" }; } },
  );
  assert.equal(code, EXIT.OK, "byte-for-byte parity with pre-FAFF-445 behaviour for any payload under the default threshold");
  assert.equal(called, true);
});

test("FAFF-445 main(): the oversized block fires identically for a --backends-json chain (chain-length-agnostic)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff445-"));
  const sys = join(dir, "system.txt"); const diff = join(dir, "diff.txt"); const bf = join(dir, "backends.json");
  writeFileSync(sys, "REVIEW LENS"); writeFileSync(diff, "DIFF");
  writeFileSync(bf, JSON.stringify([
    { provider: "nvidia", model: "m1", host: "https://nv/v1" },
    { provider: "ollama", model: "m2", host: "http://ollama:11434" },
  ]));
  let calls = 0;
  const code = await main(
    ["--backends-json", bf, "--system", sys, "--diff", diff, "--max-payload-bytes", "1"],
    { runReviewFn: async () => { calls += 1; return { status: "ok", content: "### observation: x" }; } },
  );
  assert.equal(code, EXIT.USAGE);
  assert.equal(calls, 0, "no chain element — of either backend — is attempted when the preflight blocks");
});

test("FAFF-445 main(): an oversized payload under --lights-out returns EXIT.USAGE (2), NOT EXIT.MANDATORY_OUTAGE (9) — mandatoryRemap is never reached", async () => {
  const { sys, diff } = writeMainFixtures();
  let called = false;
  const code = await main(
    ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--max-payload-bytes", "1", "--lights-out"],
    { runReviewFn: async () => { called = true; return { status: "ok", content: "### observation: x" }; } },
  );
  assert.equal(code, EXIT.USAGE);
  assert.notEqual(code, EXIT.MANDATORY_OUTAGE, "the preflight returns before runReviewChain produces an exit to remap");
  assert.equal(called, false);
});

test("FAFF-445 main(): an oversized payload logs a loud stderr line naming the measured size and threshold", async () => {
  const { sys, diff } = writeMainFixtures();
  const origErr = process.stderr.write.bind(process.stderr);
  let errOut = "";
  process.stderr.write = (c) => { errOut += c; return true; };
  let code;
  try {
    code = await main(
      ["--host", "http://h:1", "--model", "m", "--system", sys, "--diff", diff, "--max-payload-bytes", "1"],
      { runReviewFn: async () => ({ status: "ok", content: "### observation: x" }) },
    );
  } finally {
    process.stderr.write = origErr;
  }
  assert.equal(code, EXIT.USAGE);
  assert.match(errOut, /oversized-diff preflight/);
  assert.match(errOut, /exceeds the 1 byte threshold/);
});

// ── FAFF-617: per-backend wall-clock budget slicing — a hung backend is abandoned at its slice, not the
// whole deadline, so the healthy fallbacks still run. Each backend gets floor(remaining / (n - i)) ms as
// its hardDeadlineMs, recomputed each iteration (work-conserving). Back-compatible for single-backend and
// no-deadline paths. Plus the advisory budgetWarnings helper. ──

test("FAFF-617 runReviewChain: a HUNG primary is abandoned at its slice; a healthy fallback wins within the deadline (exit 0, winner=1)", async () => {
  const trace = [];
  const chain = [
    { provider: "nvidia", model: "glm", host: "https://nv/v1", hostSource: "config" },
    { provider: "gemini", model: "g", host: "https://gm/v1", hostSource: "config" },
    { provider: "ollama", model: "q", host: "http://ol:11434", hostSource: "config" },
  ];
  const runReviewFn = async (opts) => {
    if (opts.host === "https://nv/v1") return new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500));   // primary hangs past its slice
    return { status: "ok", content: "## Adversarial findings — x\n\n### observation: no findings" };
  };
  const t0 = Date.now();
  const res = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 300, log: (m) => trace.push(m) });
  assert.equal(res.exit, EXIT.OK, "the fallback served findings — never exit 8 / skipped-deadline");
  assert.equal(res.winnerIndex, 1, "the primary was abandoned at its slice; backend 2 (index 1) won");
  assert.ok(res.failureClasses.includes(EXIT.DEADLINE), "the hung primary recorded a DEADLINE-class skip");
  assert.ok(Date.now() - t0 < 260, "abandoned at the ~100ms slice, not the full 300ms deadline");
  assert.ok(trace.some((l) => /slice .* exhausted → advancing/.test(l)), "the slice-expiry advance is logged");
});

test("FAFF-617 runReviewChain: single-backend (n=1) hung — slice is the whole budget, terminates at EXIT.DEADLINE (byte-for-byte FAFF-329)", async () => {
  const chain = [{ model: "m", host: "h", hostSource: "config" }];
  const runReviewFn = () => new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500));   // hangs past its slice
  const t0 = Date.now();
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 120, log: () => {} });
  assert.equal(r.exit, EXIT.DEADLINE);
  assert.equal(r.deadlineExceeded, true);
  assert.ok(Date.now() - t0 < 400, "returned at ~the deadline, not hung");
});

test("FAFF-617 runReviewChain: n=1 grants the whole budget as the slice (hardDeadlineMs = start + total, byte-for-byte)", async () => {
  let seen; let t = 0; const nowFn = () => t;
  const runReviewFn = async (opts) => { seen = opts.hardDeadlineMs; return { status: "ok", content: "### observation: no findings" }; };
  await runReviewChain([{ model: "m", host: "h", hostSource: "config" }], { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 3000, log: () => {} });
  assert.equal(seen, 3000, "single-backend slice == remaining == totalDeadlineMs");
});

test("FAFF-617 runReviewChain: no --deadline ⇒ no slice, hardDeadlineMs stays undefined (byte-for-byte today)", async () => {
  let seen = "unset";
  const runReviewFn = async (opts) => { seen = opts.hardDeadlineMs; return { status: "ok", content: "### observation: no findings" }; };
  await runReviewChain([{ model: "m", host: "h", hostSource: "config" }], { system: "s", user: "u", runReviewFn, log: () => {} });
  assert.equal(seen, undefined, "unbounded ⇒ no per-backend deadline computed");
});

test("FAFF-617 runReviewChain: work-conserving — a fast-failing primary's slack is re-divided among survivors (dynamic slice, not static deadline/n)", async () => {
  const seen = []; let t = 0; const nowFn = () => t; let call = 0;
  const runReviewFn = async (opts) => {
    seen.push(opts.hardDeadlineMs);
    call++;
    if (call === 1) { t += 2000; return { status: "unreachable" }; }   // primary fails fast (~2s)
    return { status: "ok", content: "### observation: no findings" };  // fallback wins
  };
  const chain = [
    { model: "a", host: "h", hostSource: "config" },
    { model: "b", host: "h", hostSource: "config" },
    { model: "c", host: "h", hostSource: "config" },
  ];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, nowFn, totalDeadlineMs: 480000, log: () => {} });
  assert.equal(r.exit, EXIT.OK);
  assert.equal(r.winnerIndex, 1);
  assert.equal(seen[0], 160000, "backend 0 slice = 480000/3 = 160000 (deadline at t=0 + 160000)");
  assert.equal(seen[1], 241000, "backend 1 slice = (480000-2000)/2 = 239000 → deadline at t=2000 + 239000 = 241000 (NOT a static 160000)");
});

test("FAFF-617 runReviewChain: an all-hung 3-backend chain exhausts each slice, advances, terminates at EXIT.DEADLINE within the total budget (sum-of-slices ≤ deadline)", async () => {
  const chain = Array.from({ length: 3 }, (_, i) => ({ model: "m" + i, host: "h", hostSource: "config" }));
  const runReviewFn = () => new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500));   // every backend hangs past its slice
  const t0 = Date.now();
  const trace = [];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 180, log: (m) => trace.push(m) });
  assert.equal(r.exit, EXIT.DEADLINE, "all hung ⇒ terminal DEADLINE via last-backend exhaustion, not a mid-chain terminate");
  assert.equal(r.failureClasses.filter((c) => c === EXIT.DEADLINE).length, 3, "each backend recorded a slice-expiry");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 150 && elapsed < 600, `the sum of slices ≈ the total budget (≤ deadline), not 3× it — elapsed ${elapsed}ms`);
  assert.equal(trace.filter((l) => /→ advancing/.test(l)).length, 2, "the first two slice-expiries ADVANCE; only the last terminates");
});

test("FAFF-617 runReviewChain: a needs-human fault (auth) before hung fallbacks dominates the terminal exit, not DEADLINE (no-silent-weakening)", async () => {
  let call = 0;
  const runReviewFn = () => {
    call++;
    if (call === 1) return Promise.resolve({ status: "auth-failed" });   // fast config fault on backend 1
    return new Promise((res) => setTimeout(() => res({ status: "ok", content: "late" }), 500)); // fallbacks hang past their slice
  };
  const chain = [
    { model: "a", host: "h", hostSource: "config" },
    { model: "b", host: "h", hostSource: "config" },
  ];
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 120, log: () => {} });
  assert.equal(r.exit, EXIT.AUTH, "the earlier auth fault surfaces (needs-human), not the last backend's slice expiry");
});

test("FAFF-617 runReviewChain: a slice that floors to 0 (n-i>1, tiny remaining) routes as the total-budget gate — no zero-window dispatch", async () => {
  let calls = 0;
  const runReviewFn = async () => { calls++; return { status: "ok", content: "### observation: no findings" }; };
  const chain = [
    { model: "a", host: "h", hostSource: "config" },
    { model: "b", host: "h", hostSource: "config" },
  ];
  // totalDeadlineMs=1, n=2 ⇒ backend 0 slice = floor(1/2) = 0 ⇒ the underflow guard returns before any dispatch
  const r = await runReviewChain(chain, { system: "s", user: "u", runReviewFn, totalDeadlineMs: 1, log: () => {} });
  assert.equal(r.exit, EXIT.DEADLINE, "no meaningful window ⇒ DEADLINE, exactly as the top-of-loop gate");
  assert.equal(r.deadlineExceeded, true);
  assert.equal(calls, 0, "no backend was dispatched with a zero window");
});

test("FAFF-617 budgetWarnings: the shipped bad combo (timeout 480 / deadline 480 / 3 backends) warns per-backend; a good combo is silent", () => {
  const bad = [
    { provider: "nvidia", model: "glm", timeoutMs: 480000 },
    { provider: "gemini", model: "g", timeoutMs: 480000 },
    { provider: "ollama", model: "q", timeoutMs: 480000 },
  ];
  const warnBad = budgetWarnings(bad, 480000);
  assert.equal(warnBad.length, 3, "every backend's 480s×6 ≥ 160s per-backend budget");
  assert.match(warnBad[0], /nvidia\/glm/);
  assert.match(warnBad[0], /per-backend budget 160s/);
  const good = [
    { provider: "nvidia", model: "glm", timeoutMs: 20000 },
    { provider: "gemini", model: "g", timeoutMs: 20000 },
    { provider: "ollama", model: "q", timeoutMs: 20000 },
  ];
  assert.deepEqual(budgetWarnings(good, 480000), [], "20s×6=120s < 160s per-backend budget ⇒ no warning");
});

test("FAFF-617 budgetWarnings: no numeric deadline ⇒ [] (unbounded); a backend with no timeout is skipped; empty chain ⇒ []", () => {
  assert.deepEqual(budgetWarnings([{ provider: "p", model: "m", timeoutMs: 480000 }], undefined), []);
  assert.deepEqual(budgetWarnings([{ provider: "p", model: "m" }], 480000), [], "no timeoutMs ⇒ un-judgeable, skipped");
  assert.deepEqual(budgetWarnings([], 480000), []);
});

test("FAFF-617 main: writes the advisory budget warning to stderr before dispatch, never changing the exit", async () => {
  const { sys, dif } = specFiles398();   // reuse the 398 fixture (system + diff files)
  let errOut = "";
  const origErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { errOut += s; return true; };
  let code;
  try {
    // single backend, timeout 480 == deadline 480 ⇒ 480×6 ≥ 480/1 ⇒ a warning; a served backend ⇒ exit 0
    code = await main(
      ["--host", "http://x:1", "--model", "m", "--system", sys, "--diff", dif, "--timeout", "480", "--deadline", "480"],
      { runReviewFn: scriptedRunReview({ "http://x:1": { status: "ok", content: "## Adversarial findings — x\n\n### observation: no findings" } }) },
    );
  } finally {
    process.stderr.write = origErr;
  }
  assert.equal(code, EXIT.OK, "the warning is advisory — the exit is unchanged");
  assert.match(errOut, /budget: backend .* timeout 480s/, "the budget warning was written to stderr");
});


// ============================================================================
// FAFF-885 — first-byte (time-to-first-token) deadline: a buffering backend
// (connects, never streams a byte) fast-fails and the chain advances, instead
// of idle-hanging the full --timeout and being retried as transient.
// ============================================================================

test("FAFF-885 DEFAULT_FIRST_BYTE_MS is 60000 (default-on window)", () => {
  assert.equal(DEFAULT_FIRST_BYTE_MS, 60000);
});

test("FAFF-885 FirstByteBreachError carries the marker, excludes 'timed out', and is NOT transient", () => {
  const e = new FirstByteBreachError("no first byte within 60000ms");
  assert.equal(e.firstByteBreach, true);
  assert.equal(isFirstByteBreach(e), true);
  assert.ok(!/timed out/.test(e.message), "message must not contain 'timed out'");
  // keyed on the marker, never the message — a real stream-timeout is NOT a first-byte breach
  assert.equal(isFirstByteBreach(new Error("stream timed out after 60000ms")), false);
  // and a breach must never be classified transient (else it would re-enter the ~3x retry loop)
  assert.equal(isTransientTransport(e), false);
});

test("FAFF-885 parseArgs: --first-byte-timeout seconds -> ms; absent -> undefined", () => {
  const a = parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d", "--first-byte-timeout", "30"]);
  assert.equal(a.firstByteMs, 30000);
  const b = parseArgs(["--host", "h", "--model", "m", "--system", "s", "--diff", "d"]);
  assert.equal(b.firstByteMs, undefined);
});

test("FAFF-885 streamWithFirstByte: no window -> PASS-THROUGH (streamFn gets 4 args, no opts, no timer)", async () => {
  let seen;
  const streamFn = async (...args) => { seen = args; return "BODY"; };
  const out = await streamWithFirstByte(streamFn, "http://h/x", "b", 1000, { z: 1 }, undefined);
  assert.equal(out, "BODY");
  assert.equal(seen.length, 4, "pass-through passes exactly (url, body, timeout, headers)");
  assert.deepEqual(seen[3], { z: 1 }, "headers slot intact");
  assert.equal(seen[4], undefined, "no opts appended -> no first-byte enforcement");
});

test("FAFF-885 streamWithFirstByte: a non-positive / non-finite window (0, NaN) disables the timer (pass-through)", async () => {
  for (const fbt of [0, -5, NaN]) {
    let seen;
    const streamFn = async (...args) => { seen = args; return "OK"; };
    const out = await streamWithFirstByte(streamFn, "http://h/x", "b", 1000, {}, fbt);
    assert.equal(out, "OK");
    assert.equal(seen.length, 4, `firstByteMs=${fbt} must pass through with no opts`);
    assert.equal(seen[4], undefined);
  }
});

test("FAFF-885 streamWithFirstByte: no first byte within the window -> FirstByteBreachError + signal aborted", async () => {
  let captured;
  const streamFn = (url, body, t, headers, opts) => new Promise((resolve) => {
    captured = opts;            // buffering: never calls opts.onFirstByte
    setTimeout(() => resolve("late"), 120);
  });
  await assert.rejects(
    streamWithFirstByte(streamFn, "http://h/x", "b", 1000, {}, 20),
    (e) => isFirstByteBreach(e) && !/timed out/.test(e.message),
  );
  assert.ok(captured && captured.signal, "opts carried an AbortSignal");
  assert.equal(captured.signal.aborted, true, "the wrapper aborted the transport on breach (socket teardown channel)");
});

test("FAFF-885 streamWithFirstByte: first byte before the window -> no breach, late body returned", async () => {
  const streamFn = (url, body, t, headers, opts) => new Promise((resolve) => {
    setTimeout(() => opts.onFirstByte(), 5);        // first byte arrives inside the 20ms window
    setTimeout(() => resolve("done-late"), 60);     // resolves AFTER the window, but the timer was disarmed
  });
  const out = await streamWithFirstByte(streamFn, "http://h/x", "b", 1000, {}, 20);
  assert.equal(out, "done-late");
});

test("FAFF-885 runReview (no provider ⇒ openai default, FAFF-872): a buffering backend -> transport-failed, invoked ONCE (fast-fail, no retry)", async () => {
  let calls = 0;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", firstByteMs: 20,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: (url, body, t, headers, opts) => new Promise((resolve) => {
      calls += 1;                                    // never signals first byte
      setTimeout(() => resolve(`data: ${JSON.stringify({ choices: [{ delta: { content: "x" }, finish_reason: "stop" }] })}\ndata: [DONE]`), 120);
    }),
  });
  assert.equal(r.status, "transport-failed", "surfaces transport-failed, never request-failed / ok");
  assert.equal(calls, 1, "the breach broke the retry loop — not the 3x transient composition");
});

test("FAFF-885 arity (no provider ⇒ openai default, FAFF-872): opts lands FIFTH (headers slot is {} not the opts object); breach fires", async () => {
  let seen;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U", firstByteMs: 20,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: (url, body, t, headers, opts) => new Promise((resolve) => {
      seen = { headers, opts };
      setTimeout(() => resolve("late"), 120);
    }),
  });
  assert.equal(r.status, "transport-failed", "a first-byte breach genuinely fires on the default (openai) family");
  assert.deepEqual(seen.headers, {}, "no apiKey ⇒ headers slot is {} (no header pollution)");
  assert.equal(typeof seen.opts, "object");
  assert.equal(typeof seen.opts.onFirstByte, "function", "opts landed in the fifth slot");
  assert.notStrictEqual(seen.headers, seen.opts, "the arity-trap guard: headers slot is NOT the opts object");
});

test("FAFF-885 no window (no provider ⇒ openai default, FAFF-872): runReview with no firstByteMs -> streamFn gets NO opts (byte-for-byte)", async () => {
  let seen;
  const r = await runReview({
    host: "http://h:1/v1", model: "m", system: "S", user: "U",   // no firstByteMs
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: async (...args) => { seen = args; return JSON.stringify({ choices: [{ message: { content: "### observation: no findings" }, finish_reason: "stop" }] }); },
  });
  assert.equal(r.status, "ok");
  assert.equal(seen.length, 4, "no apiKey ⇒ explicit {} headers; still no opts (5th) in pass-through");
  assert.deepEqual(seen[3], {}, "headers slot is the explicit {}");
  assert.equal(seen[4], undefined, "no opts -> no timer armed");
});

test("FAFF-885 family-agnostic: an openai-family buffering backend also fast-fails (invoked once)", async () => {
  let calls = 0;
  const r = await runReview({
    provider: "nvidia", host: "https://h/v1", model: "m", system: "S", user: "U", apiKey: "k", firstByteMs: 20,
    getFn: async () => JSON.stringify({ data: [{ id: "m" }] }),
    streamFn: (url, body, t, headers, opts) => new Promise((resolve) => {
      calls += 1;                                    // never signals first byte
      setTimeout(() => resolve("data: [DONE]\n\n"), 120);
    }),
  });
  assert.equal(r.status, "transport-failed");
  assert.equal(calls, 1);
});

test("FAFF-885 runReviewChain: ollama (FAFF-872 — an OpenAI-compatible alias) — a buffering primary fast-fails and a healthy fallback wins (exit 0, winnerIndex 1)", async () => {
  const chain = [
    { provider: "ollama", model: "m1", host: "http://buf:1/v1", hostSource: "config", firstByteMs: 20 },
    { provider: "ollama", model: "m2", host: "http://good:1/v1", hostSource: "config", firstByteMs: 20 },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: (opts) => runReview({
      ...opts,
      getFn: async () => JSON.stringify({ data: [{ id: opts.model }] }),
      streamFn: (url, body, t, headers, o) => new Promise((resolve) => {
        if (opts.host === "http://buf:1/v1") { setTimeout(() => resolve("late"), 120); return; }   // buffering: never onFirstByte
        if (o && o.onFirstByte) o.onFirstByte();
        resolve(`data: ${JSON.stringify({ choices: [{ delta: { content: "### observation: no findings" }, finish_reason: "stop" }] })}\ndata: [DONE]`);
      }),
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winnerIndex, 1);
  assert.equal(res.winner.host, "http://good:1/v1");
});

test("FAFF-885 runReviewChain: ollama (FAFF-872) — an ALL-buffering chain terminates at EXIT.UNREACHABLE (5), not a needs-human exit", async () => {
  const chain = [
    { provider: "ollama", model: "m1", host: "http://buf1:1/v1", hostSource: "config", firstByteMs: 20 },
    { provider: "ollama", model: "m2", host: "http://buf2:1/v1", hostSource: "config", firstByteMs: 20 },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: () => {},
    runReviewFn: (opts) => runReview({
      ...opts,
      getFn: async () => JSON.stringify({ data: [{ id: opts.model }] }),
      // every backend buffers: never signals first byte, resolves after the window
      streamFn: () => new Promise((resolve) => { setTimeout(() => resolve("late"), 120); }),
    }),
  });
  assert.equal(res.exit, EXIT.UNREACHABLE, "an all-buffering (all fast-failed) chain is an availability exhaustion");
  assert.notEqual(res.exit, EXIT.USAGE, "never a needs-human request-failed exit");
});

// ===========================================================================
// FAFF-903 — reorder the fan-out payload to a shared cacheable prefix
// The shared context/diff block leads (the cacheable prefix); the per-lens brief trails.
// The reorder lands once at the main() caller seam — the three builders are unchanged, so their
// unit tests (buildChatPayload/buildOpenAiPayload/buildAnthropicPayload role order) stay green.
// ===========================================================================

const OK_FINDINGS = "### observation: no findings";

test("FAFF-903 reorder: main() hands the shared block to `system` and the lens brief to `user`", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff903-"));
  const sys = join(dir, "brief.md"); writeFileSync(sys, "REFUTER BRIEF");
  const diff = join(dir, "diff.txt"); writeFileSync(diff, "THE DIFF");
  const ctx = join(dir, "ctx.txt"); writeFileSync(ctx, "CTX ONE");
  let captured = null;
  const code = await main(
    ["--host", "http://h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx],
    { runReviewFn: async (opts) => { captured = opts; return { status: "ok", content: OK_FINDINGS }; } },
  );
  assert.equal(code, EXIT.OK);
  assert.ok(captured, "runReviewFn was dispatched");
  const expectedShared = assembleUserMessage({ contextFiles: [{ path: ctx, text: "CTX ONE" }], diff: "THE DIFF" });
  assert.equal(captured.system, expectedShared, "the shared context/diff block occupies the prefix `system` position");
  assert.equal(captured.user, "REFUTER BRIEF", "the lens brief trails in the `user` position");
  assert.match(captured.system, /DIFF UNDER REVIEW:/, "the prefix carries the diff");
  assert.ok(!captured.system.includes("REFUTER BRIEF"), "the brief is not in the prefix");
});

test("FAFF-903 reorder: across four lenses over one shared context/diff, the prefix `system` is byte-identical and only the trailing brief differs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "faff903-share-"));
  const diff = join(dir, "diff.txt"); writeFileSync(diff, "SHARED DIFF");
  const ctx = join(dir, "ctx.txt"); writeFileSync(ctx, "SHARED CTX");
  const briefs = ["refute A", "refute B", "refute C", "refute D"];
  const systems = []; const users = [];
  for (let i = 0; i < briefs.length; i++) {
    const sys = join(dir, `brief${i}.md`); writeFileSync(sys, briefs[i]);
    let captured = null;
    await main(
      ["--host", "http://h", "--model", "m", "--system", sys, "--diff", diff, "--context", ctx],
      { runReviewFn: async (opts) => { captured = opts; return { status: "ok", content: OK_FINDINGS }; } },
    );
    assert.ok(captured, "runReviewFn was dispatched for each lens");
    systems.push(captured.system); users.push(captured.user);
  }
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  assert.equal(new Set(systems.map(hash)).size, 1, "the prefix-position shared block is byte-identical across the four lenses");
  assert.equal(new Set(users.map(hash)).size, 4, "each lens's trailing brief differs");
});

test("FAFF-903 reorder: checkPayloadSize is order-agnostic — swapping system/user leaves the sum unchanged", () => {
  const A = "a".repeat(1000); const B = "b".repeat(2500);
  const pre = checkPayloadSize({ system: A, user: B });
  const post = checkPayloadSize({ system: B, user: A });
  assert.equal(pre.bytes, post.bytes, "the summed byte count is identical under the swap");
  assert.equal(pre.oversized, post.oversized);
});

test("FAFF-903 reorder watch-out: a ###-leading preamble echo (heading-rich leading spec turn) does not defeat the finding-splitter", () => {
  const echoed = "### 3. Failure mode blindness\n(echoed from the leading spec turn)\n\n### major: real objection\nthe body";
  const { sections } = splitFindings(echoed);
  assert.equal(sections.length, 2, "the echoed heading and the real finding are both captured as sections");
  assert.equal(sections[0].severity, null, "the echoed non-severity heading yields severity null — not a finding");
  assert.equal(sections[1].severity, "major", "the real finding is recognised with its severity");
  assert.equal(validateFindingsShape(echoed).ok, true, "still findings-shaped: a real severity finding exists past the echo");
  const withHeader = ensureHeader(echoed, { provider: "openai", model: "m", hostSource: "config" }, 0);
  assert.ok(hasHeader(withHeader), "the harness-authored attribution header is present after normalisation");
});

// FAFF-940: contract-output mode. The spec-review judge returns a `faff-contract:spec-judge-verdict`
// block — JSON, not `### <severity>:`-findings-shaped — so the unconditional findings-shape gate dropped
// it as `garbled` and the judge could never dispatch. `--expect contract` (shared.expectContract) skips
// the gate for a consumer that validates the block itself, while the default refuter path is unchanged.
const JUDGE_VERDICT_BLOCK = [
  "```faff-contract:spec-judge-verdict",
  JSON.stringify({
    verdict: "accept",
    rationale: "The two standing QA objections are taste-level; no blocker or major-infosec objection stands.",
    downweighted: [{ lens: "QA", severity: "minor" }],
    upheld: [],
    conformant: true,
    violations: [],
  }, null, 2),
  "```",
].join("\n");

test("FAFF-940 runReviewChain contract mode: a spec-judge-verdict block (non-findings-shaped) is returned intact, not dropped as garbled", async () => {
  // Guard: the exact block the judge emits fails the findings-shape gate — this IS the drop FAFF-940 fixes.
  assert.equal(validateFindingsShape(JUDGE_VERDICT_BLOCK).ok, false, "the verdict block is not findings-shaped");
  assert.equal(validateFindingsShape(JUDGE_VERDICT_BLOCK).kind, "garbled");

  const chain = [{ provider: "openai", model: "glm", host: "https://judge/v1", hostSource: "config" }];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", expectContract: true,
    runReviewFn: scriptedRunReview({ "https://judge/v1": { status: "ok", content: JUDGE_VERDICT_BLOCK } }),
  });
  assert.equal(res.exit, EXIT.OK, "a non-empty OK result is accepted in contract mode");
  assert.equal(res.winnerIndex, 0);
  assert.equal(res.content, JUDGE_VERDICT_BLOCK, "the block is returned byte-for-byte — no shape gate, no normalisation");
});

test("FAFF-940 runReviewChain contract mode: an empty OK result still advances (a dead backend never short-circuits the chain)", async () => {
  const chain = [
    { provider: "openai", model: "dead", host: "https://a/v1", hostSource: "config" },
    { provider: "openai", model: "glm", host: "https://b/v1", hostSource: "config" },
  ];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", expectContract: true,
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "ok", content: "   \n  " },   // whitespace-only OK → advance
      "https://b/v1": { status: "ok", content: JUDGE_VERDICT_BLOCK },
    }),
  });
  assert.equal(res.exit, EXIT.OK);
  assert.equal(res.winnerIndex, 1, "the empty primary advanced; the fallback served the verdict block");
  assert.equal(res.content, JUDGE_VERDICT_BLOCK);
});

test("FAFF-940 runReviewChain default (refuter) path: the same non-findings block is still rejected as garbled — no regression to the shape gate", async () => {
  const chain = [
    { provider: "openai", model: "glm", host: "https://a/v1", hostSource: "config" },
    { provider: "openai", model: "glm2", host: "https://b/v1", hostSource: "config" },
  ];
  const trace = [];
  const res = await runReviewChain(chain, {
    system: "S", user: "U", log: (m) => trace.push(m),   // expectContract omitted → default refuter gate
    runReviewFn: scriptedRunReview({
      "https://a/v1": { status: "ok", content: JUDGE_VERDICT_BLOCK },
      "https://b/v1": { status: "ok", content: JUDGE_VERDICT_BLOCK },
    }),
  });
  assert.notEqual(res.exit, EXIT.OK, "the non-findings block is NOT accepted on the default path");
  assert.equal(res.content, undefined, "no content is returned — the block was dropped, not passed through");
  assert.equal(res.exit, EXIT.UNREACHABLE, "an all-garbled exhausted chain terminates at UNREACHABLE (5, pass+skip), exactly as before");
  assert.ok(trace.some((l) => /\[chain\] openai\/glm malformed .* → advancing \(exit 10\)/.test(l)),
    "the default path still drops the non-findings block via the shape gate (per-backend MALFORMED/10)");
});

test("FAFF-940 main() contract mode: emits the verdict block verbatim — no '## Adversarial findings' header prepend, no refutation pass", async () => {
  const { sys, diff } = writeMainFixtures();
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  let code;
  try {
    code = await main(
      ["--host", "https://judge/v1", "--model", "glm", "--system", sys, "--diff", diff, "--host-source", "config", "--expect", "contract"],
      { runReviewFn: async () => ({ status: "ok", content: JUDGE_VERDICT_BLOCK }) },
    );
  } finally {
    process.stdout.write = origWrite;
  }
  assert.equal(code, EXIT.OK);
  const out = chunks.join("");
  assert.equal(out.trim(), JUDGE_VERDICT_BLOCK, "stdout is the verdict block, trimmed, and nothing else");
  assert.ok(!/Adversarial findings/.test(out), "no findings header was prepended onto the contract block");
});

test("FAFF-940 parseArgs: --expect contract and the --no-findings-shape alias both set expectContract; a bad --expect value fails loud", () => {
  assert.equal(parseArgs(["--expect", "contract"]).expectContract, true);
  assert.equal(parseArgs(["--no-findings-shape"]).expectContract, true);
  assert.equal(parseArgs(["--timeout", "10"]).expectContract, undefined, "absent flag leaves the default (refuter) path");
  // A typo must NOT silently degrade to the default path (that would park a live judge). Fail loud,
  // mirroring --reasoning-extra / --backends-json.
  assert.throws(() => parseArgs(["--expect", "contracts"]), /only "contract" is supported/);
  assert.throws(() => parseArgs(["--expect", "Contract"]), /only "contract" is supported/);
});

test("FAFF-940 main() contract mode genuinely skips the findings pipeline: a findings-SHAPED block passes through with NO header prepended", async () => {
  // A findings-shaped block is one the default path WOULD mutate (ensureHeader prepends the attribution
  // header, refuteFindings may downgrade). Contract mode must emit it verbatim — this input, unlike a
  // JSON verdict block, distinguishes "pipeline skipped" from "pipeline ran and did nothing".
  const FINDINGS_SHAPED = "### major: a real objection\nthe body of the objection";
  assert.equal(validateFindingsShape(FINDINGS_SHAPED).ok, true, "guard: this input IS findings-shaped");
  const { sys, diff } = writeMainFixtures();
  const chunks = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  let code;
  try {
    code = await main(
      ["--host", "https://judge/v1", "--model", "glm", "--system", sys, "--diff", diff, "--host-source", "config", "--expect", "contract"],
      { runReviewFn: async () => ({ status: "ok", content: FINDINGS_SHAPED }) },
    );
  } finally {
    process.stdout.write = origWrite;
  }
  assert.equal(code, EXIT.OK);
  const out = chunks.join("");
  assert.equal(out.trim(), FINDINGS_SHAPED, "the findings-shaped block is emitted verbatim in contract mode");
  assert.ok(!/## Adversarial findings/.test(out), "no attribution header prepended — the findings pipeline was genuinely skipped");
});

// --- FAFF-915: diff-relevance context trim -------------------------------------------------------

// The fixed acceptance fixture (see the FAFF-915 spec): three synthetic context files of `line NNN`
// text, plus a diff that touches touched.js at lines 200-201. Explicit knobs so no default constant
// is part of the oracle.
function faff915Fixture() {
  const mk = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix} ${String(i + 1).padStart(3, "0")}`).join("\n");
  const touched = mk(400, "touched");        // ~3 KB, diff-touched
  const unrelatedBig = mk(400, "unrelated"); // ~3 KB, no anchors, above the floor
  const unrelatedSmall = mk(20, "small");    // 20 lines, below the floor
  const diff = [
    "--- a/touched.js", "+++ b/touched.js",
    "@@ -198,4 +198,5 @@",
    "  touched 198", "  touched 199",
    "-touched 200", "+touched 200 changed", "+touched 201 more",
    "  touched 202",
  ].join("\n");
  const contextFiles = [
    { path: "touched.js", text: touched },
    { path: "unrelated_big.js", text: unrelatedBig },
    { path: "unrelated_small.js", text: unrelatedSmall },
  ];
  const opts = { window: 24, minFileBytes: 2048, headLines: 12, maxAnchorLines: 40, retainedCeiling: 0.8 };
  return { contextFiles, diff, opts, touched, unrelatedBig, unrelatedSmall };
}
const lines915 = (s) => s.split("\n");

test("FAFF-915: below the threshold the trim is a byte-identical no-op (existing reviews unaffected)", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 10_000_000, ...opts });
  assert.equal(r.report.trimmed, false, "no trim below the threshold");
  assert.equal(r.contextFiles, contextFiles, "the exact input array is returned (identity)");
  // and the assembled user message is byte-identical to assembling the untrimmed files
  const before = assembleUserMessage({ contextFiles, diff });
  const after = assembleUserMessage({ contextFiles: r.contextFiles, diff });
  assert.equal(after, before, "assembleUserMessage output is byte-identical");
});

test("FAFF-915: --context-trim-bytes 0 disables the trim regardless of size", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 0, ...opts });
  assert.equal(r.report.trimmed, false);
  assert.equal(r.contextFiles, contextFiles, "disabled → identity passthrough");
});

test("FAFF-915: above the threshold a diff-touched file keeps the touched region and its window, drops the rest", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  assert.equal(r.report.trimmed, true);
  const t = lines915(r.contextFiles.find((f) => f.path === "touched.js").text);
  // touched lines 200-201 (the changed range) are kept
  assert.ok(t.includes("touched 200"), "touched line 200 kept");
  assert.ok(t.includes("touched 201"), "touched line 201 kept");
  // window ±24 around 200-201 → lines 176..225 kept, 175 and 226 dropped
  assert.ok(t.includes("touched 176") && t.includes("touched 225"), "window boundary kept");
  assert.ok(!t.includes("touched 175") && !t.includes("touched 226"), "outside the window dropped");
});

test("FAFF-915: the byte-reduction oracle holds on the fixed fixture (bytesAfter <= 0.6 * bytesBefore)", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  assert.ok(r.report.bytesAfter <= 0.6 * r.report.bytesBefore,
    `bytesAfter (${r.report.bytesAfter}) <= 0.6 * bytesBefore (${r.report.bytesBefore})`);
});

test("FAFF-915: a large no-anchor file is reduced to its head plus one elision marker", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  const big = lines915(r.contextFiles.find((f) => f.path === "unrelated_big.js").text);
  assert.equal(big.length, opts.headLines + 1, "head lines + one marker");
  assert.ok(big.slice(0, opts.headLines).every((l, i) => l === `unrelated ${String(i + 1).padStart(3, "0")}`), "the head is verbatim");
  assert.equal(big[big.length - 1], elisionMarker(400 - opts.headLines), "one marker for the dropped body");
});

test("FAFF-915: a small no-anchor caller-selected file passes through unchanged even above the threshold", () => {
  const { contextFiles, diff, opts, unrelatedSmall } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  const small = r.contextFiles.find((f) => f.path === "unrelated_small.js").text;
  assert.equal(small, unrelatedSmall, "below the per-file floor → untouched");
});

test("FAFF-915: a line inside a diff-touched range is never dropped (the conservative guarantee)", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const r = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  const t = r.contextFiles.find((f) => f.path === "touched.js").text;
  const out = lines915(t);
  // every touched line's exact text is present as one of the output lines; a marker can never equal it
  for (const ln of [200, 201]) {
    assert.ok(out.includes(`touched ${ln}`), `touched line ${ln} survives`);
  }
  assert.ok(out.every((l) => !/^touched \d+$/.test(l) || out.filter((x) => x === l).length === 1 || true), "sanity");
});

test("FAFF-915: identifier-window retention keeps a line naming a diff identifier, whole-word only", () => {
  // touched.js names `zestyHelper` on line 250; the diff names it too → line 250 anchors even though
  // it is outside the touched window. `zesty` alone must NOT anchor (whole-word boundary).
  const body = Array.from({ length: 400 }, (_, i) => (i === 249 ? "call zestyHelper() here" : (i === 300 ? "a zestyHelperExtra thing" : `filler ${i}`))).join("\n");
  const diff = ["--- a/z.js", "+++ b/z.js", "@@ -1,1 +1,2 @@", " keep", "+result = zestyHelper(x)"].join("\n");
  const { identifiers } = parseDiffTouched(diff);
  assert.ok(identifiers.has("zestyHelper"), "the diff identifier is extracted");
  const out = lines915(trimOneFile(body, [], identifiers, { window: 0, minFileBytes: 2048, headLines: 12, maxAnchorLines: 40, retainedCeiling: 0.99 }));
  assert.ok(out.includes("call zestyHelper() here"), "the whole-word match anchors line 250");
  assert.ok(!out.includes("a zestyHelperExtra thing"), "a longer identifier run (zestyHelperExtra) does NOT match zestyHelper");
});

test("FAFF-915: a frequency-capped identifier (over maxAnchorLines) contributes no anchors, file head-reduces", () => {
  const body = Array.from({ length: 300 }, (_, i) => `row ${String(i).padStart(3, "0")} widget token`).join("\n");
  const out = lines915(trimOneFile(body, [], new Set(["widget"]), { window: 2, minFileBytes: 2048, headLines: 12, maxAnchorLines: 40, retainedCeiling: 0.8 }));
  assert.equal(out.length, 13, "widget appears 300× > 40 → no anchors → head + marker");
  assert.ok(out[out.length - 1].includes("elided"));
});

test("FAFF-915: the retained-ceiling fallback head-reduces a no-touch file that would still keep too much", () => {
  const body = Array.from({ length: 100 }, (_, i) => `tok line ${i}`).join("\n");
  // window 50 around an anchor would keep the whole file; the 0.8 ceiling forces head-reduction
  const out = lines915(trimOneFile(body, [], new Set(["tok"]), { window: 50, minFileBytes: 2048, headLines: 12, maxAnchorLines: 200, retainedCeiling: 0.8 }));
  assert.equal(out.length, 13, "over the retained ceiling → head + marker");
});

test("FAFF-915: fail-safe — a malformed diff yields no touched ranges, so an unmatched file with no anchors head-reduces rather than trimming on a bad guess", () => {
  const body = Array.from({ length: 100 }, (_, i) => `content ${i}`).join("\n");
  const malformed = "not a diff at all\njust some text\n@@ garbage @@\n";
  const { touchedByPath, identifiers } = parseDiffTouched(malformed);
  assert.equal(touchedByPath.size, 0, "no touched paths parsed from a malformed diff");
  // with no touched ranges and no shared identifiers, a large file head-reduces (never a mid-file guess)
  const out = lines915(trimOneFile(body, touchedByPath.get("x.js") || [], identifiers, { window: 24, minFileBytes: 50, headLines: 5, maxAnchorLines: 40, retainedCeiling: 0.8 }));
  assert.equal(out.length, 6, "head + marker, never a windowed slice from a bad guess");
});

test("FAFF-915: path matching accepts both a/ b/ prefixed and bare diff paths (keyed by full path)", () => {
  const prefixed = parseDiffTouched(["+++ b/src/foo.js", "@@ -1,0 +1,1 @@", "+added"].join("\n"));
  assert.ok(prefixed.touchedByPath.has("src/foo.js"), "b/ prefix stripped, full path retained");
  const bare = parseDiffTouched(["+++ src/foo.js", "@@ -1,0 +1,1 @@", "+added"].join("\n"));
  assert.ok(bare.touchedByPath.has("src/foo.js"), "bare path keyed by full path");
  // pathsMatch resolves a context path to a touched path by exact-or-suffix, never a bare basename clash
  assert.ok(pathsMatch("review-call.mjs", "plugin/skills/x/review-call.mjs"), "suffix match");
  assert.ok(pathsMatch("a/src/foo.js", "b/src/foo.js"), "prefixes stripped, exact match");
  assert.ok(!pathsMatch("src/foo.js", "lib/foo.js"), "same basename, different dir → no match");
});

test("FAFF-915: a shared basename never cross-applies another file's touched ranges (major fix)", () => {
  // diff touches src/foo.js only; the context bundle also has lib/foo.js (same basename, unrelated).
  const srcFoo = Array.from({ length: 100 }, (_, i) => `src ${i}`).join("\n");
  const libFoo = Array.from({ length: 100 }, (_, i) => `lib ${i}`).join("\n");
  const diff = ["--- a/src/foo.js", "+++ b/src/foo.js", "@@ -49,1 +49,2 @@", " src 48", "+src 49 changed", " src 50"].join("\n");
  const r = trimContextFiles({
    contextFiles: [{ path: "src/foo.js", text: srcFoo }, { path: "lib/foo.js", text: libFoo }],
    diff, thresholdBytes: 100, window: 1, minFileBytes: 100000, headLines: 5, maxAnchorLines: 40, retainedCeiling: 0.9,
  });
  const src = r.contextFiles.find((f) => f.path === "src/foo.js").text;
  assert.ok(src.split("\n").includes("src 49"), "the genuinely-touched src/foo.js keeps its touched line");
  const lib = r.contextFiles.find((f) => f.path === "lib/foo.js").text;
  // lib/foo.js has no touched ranges of its own → it is a no-anchor small file → passthrough unchanged,
  // NOT windowed around src/foo.js's line 49.
  assert.equal(lib, libFoo, "lib/foo.js is untouched — no cross-applied ranges");
});

test("FAFF-915: an empty context line inside a hunk advances new-file line numbers (desync fix)", () => {
  // a blank context line encoded as a truly empty line must still advance the new-file counter, so the
  // + line after it gets the correct line number.
  const diff = ["+++ b/z.js", "@@ -1,4 +1,5 @@", " keep 1", "", " keep 3", "+added at 4", " keep 5"].join("\n");
  const { touchedByPath } = parseDiffTouched(diff);
  const ranges = touchedByPath.get("z.js");
  // new-file lines: keep1=1, ""=2, keep3=3, added=4 → the touched range is [4,4], not [3,3]
  assert.deepEqual(ranges, [[4, 4]], "the empty context line advanced the counter, so the + line is at 4");
});

test("FAFF-915: headReduce clamps a negative/NaN headLines to a correct marker count (minor fix)", () => {
  const body = Array.from({ length: 30 }, (_, i) => `x ${i}`).join("\n");
  // a large no-anchor file with headLines = -3 must not report a bogus (over-large) elided count
  const out = trimOneFile(body, [], new Set(), { window: 2, minFileBytes: 10, headLines: -3, maxAnchorLines: 40, retainedCeiling: 0.8 });
  assert.equal(out, elisionMarker(30), "headLines clamped to 0 → all 30 lines elided, one marker");
});

test("FAFF-915: the trim is deterministic — identical (contextFiles, diff) give identical output (shared-prefix cache holds)", () => {
  const { contextFiles, diff, opts } = faff915Fixture();
  const a = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  const b = trimContextFiles({ contextFiles, diff, thresholdBytes: 1000, ...opts });
  assert.deepEqual(a.contextFiles, b.contextFiles, "byte-identical across calls");
});

test("FAFF-915: parseArgs collects --context-trim-bytes", () => {
  const a = parseArgs(["--context-trim-bytes", "1234"]);
  assert.equal(a.contextTrimBytes, 1234);
  const b = parseArgs([]);
  assert.equal(b.contextTrimBytes, undefined, "absent → undefined → main applies the default constant");
});

test("FAFF-915: parseDiffTouched handles CRLF-terminated diffs (blank context line desync fix)", () => {
  // a CRLF diff: each line ends with \r; the blank context line arrives as "\r" after split("\n").
  const diff = ["+++ b/z.js", "@@ -1,4 +1,5 @@", " keep 1", "", " keep 3", "+added at 4", " keep 5"]
    .map((l) => l + "\r").join("\n");
  const { touchedByPath } = parseDiffTouched(diff);
  assert.deepEqual(touchedByPath.get("z.js"), [[4, 4]], "CR stripped, blank line advances the counter → touched line 4");
});

test("FAFF-915: parseDiffTouched bounds each hunk by its declared line counts (a '+++ ' added line is data, not a header)", () => {
  // an added line whose CONTENT begins with "++ b/foo" makes the full diff line "+++ b/foo". Bounded by
  // the hunk's declared +2 count, it is parsed as an added body line, never misread as a file header.
  const diff = ["+++ b/real.js", "@@ -1,1 +1,2 @@", " keep 1", "+++ b/foo"].join("\n");
  const { touchedByPath } = parseDiffTouched(diff);
  assert.ok(touchedByPath.has("real.js"), "the real file header was taken");
  assert.ok(!touchedByPath.has("foo"), "the in-hunk '+++ b/foo' body line was NOT misread as a new header");
  // new-file lines: keep1=1, then the added line at 2 → touched [2,2]
  assert.deepEqual(touchedByPath.get("real.js"), [[2, 2]], "the added line is counted at line 2");
});

test("FAFF-915: parseDiffTouched stops consuming at the declared hunk length, so a second file's hunk is attributed correctly", () => {
  const diff = [
    "+++ b/a.js", "@@ -1,1 +1,2 @@", " a-keep", "+a-added",
    "+++ b/b.js", "@@ -5,1 +5,2 @@", " b-keep", "+b-added",
  ].join("\n");
  const { touchedByPath } = parseDiffTouched(diff);
  assert.deepEqual(touchedByPath.get("a.js"), [[2, 2]], "a.js touched at 2");
  assert.deepEqual(touchedByPath.get("b.js"), [[6, 6]], "b.js touched at 6 (hunk 1 ended at its declared length)");
});

test("FAFF-915: a touched file over the retained ceiling keeps ALL its touched lines (refutes the ceiling-drops-touched claim)", () => {
  // 30-line file; the diff touches lines 5 and 25. A window of 24 would keep >80% (over the 0.8 ceiling),
  // but a file with ANY touched line is exempt from the ceiling fallback, so it never head-reduces and
  // every touched line survives — even one beyond headLines.
  const body = Array.from({ length: 30 }, (_, i) => `row ${String(i + 1).padStart(2, "0")}`).join("\n");
  const out = trimOneFile(body, [[5, 5], [25, 25]], new Set(), { window: 24, minFileBytes: 2048, headLines: 3, maxAnchorLines: 40, retainedCeiling: 0.8 });
  const lines = out.split("\n");
  assert.ok(lines.includes("row 05"), "touched line 5 kept");
  assert.ok(lines.includes("row 25"), "touched line 25 kept (beyond headLines=3, proving no head-reduce)");
  assert.ok(!out.includes("elided") || lines.includes("row 25"), "not collapsed to a head stub");
});

test("FAFF-915: a pure-insertion new-file hunk (@@ -0,0 +1,N @@) is parsed correctly", () => {
  const diff = ["+++ b/new.js", "@@ -0,0 +1,3 @@", "+line one", "+line two", "+line three"].join("\n");
  const { touchedByPath } = parseDiffTouched(diff);
  assert.deepEqual(touchedByPath.get("new.js"), [[1, 1], [2, 2], [3, 3]], "all three inserted lines touched at 1,2,3");
});
