// ===========================================================================
// === region:factory — engine — one-shot local-engine dispatch (FAFF-422) ===
// ===========================================================================
// `faff engine call` — the direct-API one-shot transport for engine-valued lanes.
// A models.<lane> value of `engine:<name>` routes the producer request out of session
// as ONE non-streaming completion against the configured engine (ollama /api/chat, or
// an openai-compatible /v1/chat/completions; the codex SPAWN family forks to
// engine-codex.js after resolution — FAFF-593). v1 allowlist: methodology | intake (the
// pure-data-in producers) — enforced HERE at dispatch as well as at config read (the
// capability-mismatch guard, enforced not documented).
//
// Deliberately NOT a generalisation of review-call.mjs: its exit taxonomy encodes
// review-verdict routing (pass+skip semantics) this transport forbids. This module
// borrows its idioms (providerFamily whitelist, family-conditional preflight,
// api_key_env indirection) as patterns, on the eval/ollama-model.mjs one-shot shape:
// pure request/parse fns, injectable transport (CI makes zero real network calls),
// fail-loud parse, no localhost default. No retry, no fallback chain, no second
// backend — every non-zero exit is terminal for the dispatch and the caller NEVER
// re-dispatches on the session model (the FAFF-50 silent-downgrade failure mode).

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { ENGINE_CALL_LANES, loadConfig, resolveEngineForLane } = require("./config");
const { CANONICAL_CONFIG, findRoot, latestRunDir } = require("./shared-infra");

// engine-call's own small exit taxonomy (distinct named codes; NOT review-call's EXIT
// table — that one routes review verdicts). 2 = usage/config fault, per house convention.
const ENGINE_EXIT = { OK: 0, CONFIG: 2, NOT_SERVED: 4, UNREACHABLE: 5, AUTH: 6, MALFORMED: 7 };

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5000;

// PURE: join an OpenAI-style base URL (host already ends in /v1) with an endpoint path,
// without the new URL("/models", base) trap that would drop the /v1 prefix.
function joinUrl(base, path_) {
  return String(base).replace(/\/+$/, "") + path_;
}

// PURE: the one-shot request spec. ollama: /api/chat with stream:false (the FAFF-136
// precedent; reasoning_off → think:false per FAFF-137). openai-compatible:
// /v1/chat/completions with stream:false (reasoning_off → chat_template_kwargs, the
// adversarial-block idiom). No localhost default — host comes from config or not at all.
function buildEngineRequest({ family, host, model, system, user, reasoningOff = false, apiKey = null } = {}) {
  if (!host) throw new Error("buildEngineRequest requires a host (no localhost default)");
  if (!model) throw new Error("buildEngineRequest requires a model");
  const messages = [{ role: "system", content: String(system ?? "") }, { role: "user", content: String(user ?? "") }];
  let url;
  const payload = { model, messages, stream: false };
  if (family === "ollama") {
    url = new URL("/api/chat", host).toString();
    if (reasoningOff) payload.think = false;
  } else if (family === "openai") {
    url = joinUrl(host, "/chat/completions");
    if (reasoningOff) payload.chat_template_kwargs = { thinking: false };
  } else {
    throw new Error(`buildEngineRequest: unknown engine family "${family}"`);
  }
  const body = JSON.stringify(payload);
  const headers = { "content-type": "application/json", "content-length": Buffer.byteLength(body) };
  if (family === "openai" && apiKey) headers.authorization = `Bearer ${apiKey}`;
  return { url, method: "POST", headers, body };
}

// PURE: extract the completion text. Fail-loud on a shape it doesn't know — a missing
// content field is a malformed-response exit with a body excerpt, never an empty pass.
function parseEngineResponse(family, raw) {
  let obj;
  try { obj = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { throw new Error(`engine response is not JSON: ${String(raw).slice(0, 200)}`); }
  const content = family === "ollama" ? obj?.message?.content : obj?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    const field = family === "ollama" ? "message.content" : "choices[0].message.content";
    throw new Error(`engine response missing ${field}: ${JSON.stringify(obj).slice(0, 200)}`);
  }
  return content;
}

// PURE: is the configured model in the engine's served list? (preflight body parsers)
function modelServedOllama(body, model) {
  try {
    const names = (JSON.parse(body).models || []).map((m) => m && m.name).filter((n) => typeof n === "string");
    return { served: names.some((n) => n === model || n === `${model}:latest`), names };
  } catch { return { served: false, names: [] }; }
}
function modelServedOpenAi(body, model) {
  try {
    const names = (JSON.parse(body).data || []).map((m) => m && m.id).filter((n) => typeof n === "string");
    return { served: names.includes(model), names };
  } catch { return { served: false, names: [] }; }
}

function httpError(status, data) {
  const e = new Error(`HTTP ${status}: ${String(data).slice(0, 200)}`);
  e.statusCode = status;
  return e;
}
function isAuthError(e) { return !!e && (e.statusCode === 401 || e.statusCode === 403); }

// Default transports (injectable — tests pass mocks; importing this module opens no socket).
function defaultGet(url, timeoutMs, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: "GET", headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(httpError(res.statusCode, data))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`engine preflight timed out after ${timeoutMs}ms`)));
    r.end();
  });
}
function defaultPost(req, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url);
    const lib = u.protocol === "https:" ? https : http;
    const r = lib.request(u, { method: req.method, headers: req.headers }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(data) : reject(httpError(res.statusCode, data))));
    });
    r.on("error", reject);
    r.setTimeout(timeoutMs, () => r.destroy(new Error(`engine request timed out after ${timeoutMs}ms`)));
    r.write(req.body);
    r.end();
  });
}

// Family-conditional preflight (the review-call precedent): both v1 families expose a
// probe (ollama /api/tags, openai-compatible /v1/models), so engine-unreachable (infra)
// splits from model-not-served (config fault) into distinct named errors. A future
// probe-less family fails classified at first call instead — the probe changes error
// QUALITY, never outcome. openai auth (401/403 on the probe) is auth-failed, not unreachable.
async function preflightEngine({ family, host, model, apiKey = null, getFn = defaultGet, timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS } = {}) {
  const url = family === "ollama" ? new URL("/api/tags", host).toString() : joinUrl(host, "/models");
  const headers = family === "openai" && apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  let body;
  try { body = await getFn(url, timeoutMs, headers); }
  catch (e) {
    if (family === "openai" && isAuthError(e)) return { authFailed: true, error: e.message };
    return { unreachable: true, error: e.message };
  }
  const { served, names } = family === "ollama" ? modelServedOllama(body, model) : modelServedOpenAi(body, model);
  return { served, names };
}

// The one-shot orchestration: preflight → ONE non-streaming completion → fail-loud parse.
// No retry, no fallback, no second backend (a silent chain is a silent downgrade wearing
// resilience clothes). Transport injectable (getFn/postFn) so CI makes zero real calls.
async function runEngineCall({ engine, apiKey = null, system, user, getFn = defaultGet, postFn = defaultPost } = {}) {
  const pf = await preflightEngine({ family: engine.family, host: engine.host, model: engine.model, apiKey, getFn });
  if (pf.authFailed) return { status: "auth-failed", note: pf.error };
  if (pf.unreachable) return { status: "engine-unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };
  const req = buildEngineRequest({ family: engine.family, host: engine.host, model: engine.model, system, user, reasoningOff: engine.reasoningOff, apiKey });
  let raw;
  try { raw = await postFn(req, { timeoutMs: engine.timeoutMs }); }
  catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    return { status: "engine-unreachable", note: e.message };
  }
  try { return { status: "ok", content: parseEngineResponse(engine.family, raw) }; }
  catch (e) { return { status: "malformed-response", note: e.message }; }
}

const ENGINE_USAGE = "usage: faff engine call --lane methodology|intake --system FILE --user FILE [--root DIR] [--run-dir DIR]\n";

// `faff engine call` — stdout is the engine's completion text (the producer output).
// exit 0 ok · 2 usage/config fault (non-allowlisted lane, unknown engine, missing field,
// off-vocabulary value, anthropic provider, effort-lane conflict) · 4 model-not-served ·
// 5 engine-unreachable · 6 auth-failed · 7 malformed-response. Every non-zero exit is
// terminal: the caller surfaces/parks per its existing failure handling.
const { parseArgs, usageError } = require("./argv");
const ENGINE_SPEC = {
  flags: { "--selftest": { arity: 0 }, "--lane": { arity: 1 }, "--system": { arity: 1 }, "--user": { arity: 1 }, "--root": { arity: 1 }, "--run-dir": { arity: 1 } },
  positionals: { min: 0, max: 1, name: "call" },
};

// FAFF-604: bind the codex spend sink to a run. `--run-dir` is EXPLICIT for any
// dispatcher that already knows its run — every in-run producer dispatch must
// pass it, because "the newest run dir" is an mtime-shaped ownership signal, and
// with concurrent runs in one repo it can attribute a call to a sibling run (the
// attribution class FAFF-229 retired for transcripts). The latest-run fallback
// exists only for an ad-hoc human call, where there is no dispatcher to know
// better. No run at all → no sink: nothing is recorded, and we say so once
// rather than silently dropping the spend.
function resolveSpendSink(runDirFlag, root) {
  let runDir = runDirFlag;
  if (!runDir) {
    try { runDir = latestRunDir(root); } catch { runDir = null; }
  }
  if (!runDir) {
    process.stderr.write("faff engine call: engine call outside a run — spend not metered (pass --run-dir to attribute it)\n");
    return null;
  }
  const { appendEngineSpend } = require("./budget");
  return (record) => appendEngineSpend(runDir, record);
}

function cmdEngine(args) {
  if (args.includes("--selftest")) return engineSelftest();
  const { values, positionals, errors } = parseArgs(args, ENGINE_SPEC);
  if (errors.length) { usageError(errors, ENGINE_USAGE); return ENGINE_EXIT.CONFIG; }
  const sub = positionals[0];
  if (sub !== "call") { process.stderr.write(ENGINE_USAGE); return ENGINE_EXIT.CONFIG; }
  const get = (f) => (values[f] === undefined ? null : values[f]);
  const lane = get("--lane");
  const systemFile = get("--system");
  const userFile = get("--user");
  const root = get("--root") || findRoot();
  if (!lane || !systemFile || !userFile) { process.stderr.write(ENGINE_USAGE); return ENGINE_EXIT.CONFIG; }
  // Dispatch-time allowlist guard — independent of config state (the second enforcement
  // point of the FAFF-422 capability-mismatch guard; read-time validateModelLane is the first).
  if (!ENGINE_CALL_LANES.includes(lane)) {
    process.stderr.write(`faff engine call: lane "${lane}" is not engine-dispatchable — v1 allowlist: ${ENGINE_CALL_LANES.join(" | ")} (FAFF-422: a tool-needing producer can never reach a tool-incapable transport)\n`);
    return ENGINE_EXIT.CONFIG;
  }
  let cfg;
  try { [cfg] = loadConfig(root); }
  catch (e) {
    if (e.message === "legacy-config-name" || e.message === "multiple-config") {
      process.stderr.write(`faff engine call: config resolution failed (${e.message}) — fix the ${CANONICAL_CONFIG} at the repo root\n`);
      return ENGINE_EXIT.CONFIG;
    }
    throw e;
  }
  const res = resolveEngineForLane(cfg, lane);
  if (res.error) { process.stderr.write(`faff engine call: ${res.error}\n`); return ENGINE_EXIT.CONFIG; }
  // FAFF-593: the codex family is a SPAWN transport, not HTTP — fork after config
  // resolution to engine-codex.js, which owns its whole procedure (api-key guard,
  // seat probe, exec spawn, parse, classify) and its own failure tags (a codex
  // record has no host, so the HTTP `@ host` tag would be a lie). Synchronous int
  // return — bin/faff's dispatcher accepts int-or-Promise.
  if (res.family === "codex") {
    let system, user;
    try { system = fs.readFileSync(systemFile, "utf8"); user = fs.readFileSync(userFile, "utf8"); }
    catch (e) { process.stderr.write(`faff engine call: cannot read prompt file — ${e.message}\n`); return ENGINE_EXIT.CONFIG; }
    const { runCodexCall } = require("./engine-codex");
    return runCodexCall({ engine: res, system, user, spendSink: resolveSpendSink(get("--run-dir"), root) });
  }
  // api_key_env indirection: config carries the env var NAME, never the key. A declared
  // name whose env is unset is auth-failed BEFORE any network call — named, never a 401 later.
  let apiKey = null;
  if (res.apiKeyEnv) {
    apiKey = process.env[res.apiKeyEnv];
    if (!apiKey) {
      process.stderr.write(`faff engine call: auth-failed — engines.${res.name} declares api_key_env "${res.apiKeyEnv}" but that env var is unset\n`);
      return ENGINE_EXIT.AUTH;
    }
  }
  let system, user;
  try { system = fs.readFileSync(systemFile, "utf8"); user = fs.readFileSync(userFile, "utf8"); }
  catch (e) { process.stderr.write(`faff engine call: cannot read prompt file — ${e.message}\n`); return ENGINE_EXIT.CONFIG; }
  return runEngineCall({ engine: res, apiKey, system, user }).then((r) => {
    if (r.status === "ok") { process.stdout.write(r.content.trim() + "\n"); return ENGINE_EXIT.OK; }
    const tag = `engines.${res.name} (${res.provider} ${res.model} @ ${res.host})`;
    if (r.status === "engine-unreachable") { process.stderr.write(`faff engine call: engine-unreachable — ${tag}: ${r.note}\n`); return ENGINE_EXIT.UNREACHABLE; }
    if (r.status === "model-not-served") { process.stderr.write(`faff engine call: model-not-served — ${tag}; served: ${r.names && r.names.length ? r.names.join(", ") : "(none listed)"}\n`); return ENGINE_EXIT.NOT_SERVED; }
    if (r.status === "auth-failed") { process.stderr.write(`faff engine call: auth-failed — ${tag}: ${r.note}\n`); return ENGINE_EXIT.AUTH; }
    process.stderr.write(`faff engine call: malformed-response — ${tag}: ${r.note}\n`);
    return ENGINE_EXIT.MALFORMED;
  });
}

// Selftest — drives the pure fns + the injected-transport orchestration table. No network.
async function engineSelftest() {
  let fail = 0;
  const ok = (name, cond) => { if (!cond) { console.log(`FAIL ${name}`); fail++; } else console.log(`ok   ${name}`); };

  ok("allowlist is exactly methodology|intake", ENGINE_CALL_LANES.length === 2 && ENGINE_CALL_LANES.includes("methodology") && ENGINE_CALL_LANES.includes("intake"));

  // request builder — ollama
  {
    const r = buildEngineRequest({ family: "ollama", host: "http://studio:11434", model: "m1", system: "S", user: "U" });
    const p = JSON.parse(r.body);
    ok("ollama: /api/chat url", r.url === "http://studio:11434/api/chat");
    ok("ollama: stream:false", p.stream === false);
    ok("ollama: system+user messages", p.messages.length === 2 && p.messages[0].role === "system" && p.messages[0].content === "S" && p.messages[1].role === "user" && p.messages[1].content === "U");
    ok("ollama: no think key by default", !("think" in p));
    const r2 = buildEngineRequest({ family: "ollama", host: "http://h", model: "m", system: "", user: "", reasoningOff: true });
    ok("ollama: reasoning_off → think:false", JSON.parse(r2.body).think === false);
  }
  // request builder — openai-compatible (host already carries /v1; join must not drop it)
  {
    const r = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "S", user: "U", apiKey: "k" });
    ok("openai: /v1 preserved in join", r.url === "https://api.x.dev/v1/chat/completions");
    ok("openai: Bearer header with key", r.headers.authorization === "Bearer k");
    ok("openai: stream:false", JSON.parse(r.body).stream === false);
    const r2 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "" });
    ok("openai: no auth header without key", !("authorization" in r2.headers));
    const r3 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "", reasoningOff: true });
    ok("openai: reasoning_off → chat_template_kwargs", JSON.parse(r3.body).chat_template_kwargs.thinking === false);
  }
  { let threw = false; try { buildEngineRequest({ family: "ollama", model: "m" }); } catch { threw = true; } ok("no host → throws (no localhost default)", threw); }
  { let threw = false; try { buildEngineRequest({ family: "nope", host: "http://h", model: "m" }); } catch { threw = true; } ok("unknown family → throws", threw); }

  // response parser — fail-loud
  ok("parse ollama content", parseEngineResponse("ollama", JSON.stringify({ message: { content: "hi" } })) === "hi");
  ok("parse openai content", parseEngineResponse("openai", JSON.stringify({ choices: [{ message: { content: "hi" } }] })) === "hi");
  { let threw = false; try { parseEngineResponse("ollama", JSON.stringify({ done: true })); } catch (e) { threw = /message\.content/.test(e.message); } ok("ollama missing content → fail-loud named", threw); }
  { let threw = false; try { parseEngineResponse("openai", "not json"); } catch (e) { threw = /not JSON/.test(e.message); } ok("non-JSON body → fail-loud", threw); }

  // preflight classification — injected transport, no network
  const engine = { name: "e", provider: "ollama", family: "ollama", model: "m1", host: "http://h:1", reasoningOff: false, timeoutMs: 1000 };
  {
    const pf = await preflightEngine({ family: "ollama", host: "http://h:1", model: "m1", getFn: async () => { throw new Error("ECONNREFUSED"); } });
    ok("ollama probe down → unreachable", pf.unreachable === true);
  }
  {
    const pf = await preflightEngine({ family: "ollama", host: "http://h:1", model: "m1", getFn: async () => JSON.stringify({ models: [{ name: "other:7b" }] }) });
    ok("ollama model absent → not-served with names", pf.served === false && pf.names.includes("other:7b"));
  }
  {
    const pf = await preflightEngine({ family: "ollama", host: "http://h:1", model: "m1", getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }) });
    ok("ollama model present → served", pf.served === true);
  }
  {
    const pf = await preflightEngine({ family: "openai", host: "http://h/v1", model: "m1", apiKey: "k", getFn: async () => { throw httpError(401, "no"); } });
    ok("openai 401 probe → auth-failed (distinct from unreachable)", pf.authFailed === true);
  }
  {
    const pf = await preflightEngine({ family: "openai", host: "http://h/v1", model: "m1", getFn: async () => JSON.stringify({ data: [{ id: "m1" }] }) });
    ok("openai model present → served", pf.served === true);
  }

  // one-shot orchestration — exactly one completion call, no retry
  {
    let posts = 0;
    const r = await runEngineCall({
      engine, system: "S", user: "U",
      getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }),
      postFn: async () => { posts++; return JSON.stringify({ message: { content: "out" } }); },
    });
    ok("happy path → ok + content", r.status === "ok" && r.content === "out");
    ok("exactly ONE completion call", posts === 1);
  }
  {
    let posts = 0;
    const r = await runEngineCall({
      engine, system: "S", user: "U",
      getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }),
      postFn: async () => { posts++; return JSON.stringify({ done: true }); },
    });
    ok("bad body → malformed-response", r.status === "malformed-response");
    ok("no retry after malformed", posts === 1);
  }
  {
    const r = await runEngineCall({ engine, system: "S", user: "U", getFn: async () => { throw new Error("down"); }, postFn: async () => "unused" });
    ok("probe down → engine-unreachable, completion never attempted", r.status === "engine-unreachable");
  }
  {
    const r = await runEngineCall({
      engine, system: "S", user: "U",
      getFn: async () => JSON.stringify({ models: [{ name: "m1" }] }),
      postFn: async () => { throw httpError(403, "denied"); },
    });
    ok("403 on completion → auth-failed", r.status === "auth-failed");
  }

  // dispatch-side resolution (the config.js seam) — fixture cfg objects, no disk
  const cfgOk = { engines: { studio: { provider: "ollama", model: "m1", host: "http://h:1" } }, models: { methodology: "engine:studio", intake: "sonnet" } };
  {
    const r = resolveEngineForLane(cfgOk, "methodology");
    ok("resolve: happy path", !r.error && r.name === "studio" && r.family === "ollama" && r.model === "m1");
    ok("resolve: default timeout 120s", r.timeoutMs === 120000);
    ok("resolve: absent api_key_env → null", r.apiKeyEnv === null);
  }
  ok("resolve: non-allowlisted lane refused", !!resolveEngineForLane(cfgOk, "build").error);
  ok("resolve: Anthropic-token lane refused (not an engine value)", !!resolveEngineForLane(cfgOk, "intake").error);
  ok("resolve: unknown engine name refused, names listed",
    /unknown engine/.test(resolveEngineForLane({ engines: { studio: cfgOk.engines.studio }, models: { intake: "engine:nope" } }, "intake").error || ""));
  ok("resolve: missing host refused, field named",
    /"host"/.test(resolveEngineForLane({ engines: { s: { provider: "ollama", model: "m" } }, models: { intake: "engine:s" } }, "intake").error || ""));
  ok("resolve: anthropic provider refused",
    /anthropic/.test(resolveEngineForLane({ engines: { s: { provider: "anthropic", model: "m", host: "http://h" } }, models: { intake: "engine:s" } }, "intake").error || ""));
  ok("resolve: unknown provider refused",
    /provider/.test(resolveEngineForLane({ engines: { s: { provider: "llamacpp", model: "m", host: "http://h" } }, models: { intake: "engine:s" } }, "intake").error || ""));
  ok("resolve: non-inherit effort × engine refused",
    /effort/.test(resolveEngineForLane({ ...cfgOk, effort: { methodology: "high" } }, "methodology").error || ""));
  {
    const r = resolveEngineForLane({ engines: { s: { provider: "nvidia", model: "m", host: "https://x/v1", api_key_env: "K", timeout: 30, reasoning_off: true } }, models: { intake: "engine:s" } }, "intake");
    ok("resolve: openai-compatible family + options", !r.error && r.family === "openai" && r.apiKeyEnv === "K" && r.timeoutMs === 30000 && r.reasoningOff === true);
  }

  // FAFF-593: fold the codex spawn family's table in — `faff engine --selftest`
  // stays the single entry point for the whole engine-call transport.
  const { codexSelftest } = require("./engine-codex");
  fail += codexSelftest();

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (engine call, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { ENGINE_EXIT, buildEngineRequest, cmdEngine, defaultGet, defaultPost, engineSelftest, isAuthError, joinUrl, modelServedOllama, modelServedOpenAi, parseEngineResponse, preflightEngine, runEngineCall };
