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
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { ENGINE_CALL_LANES, loadConfig, reasoningEffortForTransport, resolveEngineForLane } = require("./config");
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
function buildEngineRequest({ family, host, model, system, user, reasoningOff = false, effort = null, apiKey = null } = {}) {
  if (!host) throw new Error("buildEngineRequest requires a host (no localhost default)");
  if (!model) throw new Error("buildEngineRequest requires a model");
  const messages = [{ role: "system", content: String(system ?? "") }, { role: "user", content: String(user ?? "") }];
  let url;
  const payload = { model, messages, stream: false };
  if (family === "ollama") {
    url = new URL("/api/chat", host).toString();
    if (reasoningOff) payload.think = false;
    // FAFF-705: ollama has no graded reasoning-effort transport (effort is refused at
    // resolve for this family, so it never reaches here); ignore a stray effort, never throw.
  } else if (family === "openai") {
    url = joinUrl(host, "/chat/completions");
    // FAFF-705: emit reasoning_effort only when a graded effort is present AND reasoning is not
    // being silenced (the two knobs are mutually exclusive — resolve refuses the pair). The faff
    // level is mapped onto the three-level transport target (xhigh/max clamp to high).
    if (reasoningOff) payload.chat_template_kwargs = { thinking: false };
    else if (effort) payload.reasoning_effort = reasoningEffortForTransport(effort);
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
  const req = buildEngineRequest({ family: engine.family, host: engine.host, model: engine.model, system, user, reasoningOff: engine.reasoningOff, effort: engine.effort, apiKey });
  let raw;
  try { raw = await postFn(req, { timeoutMs: engine.timeoutMs }); }
  catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    return { status: "engine-unreachable", note: e.message };
  }
  try { return { status: "ok", content: parseEngineResponse(engine.family, raw) }; }
  catch (e) { return { status: "malformed-response", note: e.message }; }
}

// FAFF-647: the spawn-family runner registry — the ONE source of truth both
// cmdEngine dispatch (below) and the conformance selftest read. This REPLACES
// the earlier hardcoded `if (res.family === "codex")` fork with a lookup over
// the same two-family dispatch (behaviour unchanged for codex); adding a family
// is one registry entry, not a new fork. Distinct from config.js's
// ENGINE_PROVIDER_FAMILY, which maps provider name to a family-name STRING and
// holds no runner functions.
//
// Lazily requires engine-codex.js (which itself requires this module's
// ENGINE_EXIT) to preserve the pre-existing circular-require-safe lazy-load
// shape — engine-codex.js is still only ever loaded once both modules have
// finished their own top-level evaluation.
function spawnFamilyRunners() {
  const { runCodexCall } = require("./engine-codex");
  return { codex: runCodexCall };
}

// Which families are config-dir-bearing (have a CLAUDE_CONFIG_DIR to isolate) —
// a DECLARED property of the family, not a name guess. codex declares itself
// config-dir-free (nothing to isolate: `--sandbox read-only`, `--ephemeral`, a
// throwaway temp cwd already cover it); a future `claude` family declares
// itself config-dir-bearing, which is what makes the conformance selftest's
// CLAUDE_CONFIG_DIR isolation assertion (B, below) bind against it the moment
// it registers, with no selftest edit required.
const SPAWN_FAMILY_CONFIG_DIR_BEARING = { codex: false };

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

// FAFF-604/FAFF-642: bind the codex spend sink to a run. Resolution follows the
// SAME stamped-signal-before-guess chain every other run-resolving site in
// bin/lib already takes (heartbeat.js's resolveHeartbeatRunDir, quality.js,
// economics.js, …): explicit `--run-dir` flag → the `$FAFF_RUN_DIR` pointer the
// owning orchestrator exported → only then the newest dir under `.faff/runs`
// (an mtime-shaped guess — the attribution class FAFF-229 retired for
// transcripts). A stamped pointer is evidence; a newest-mtime pick is a guess,
// so only the guess speaks on stderr — the flag/env paths are silent on the
// happy route (warning on every compliant flagless in-run dispatch would just
// teach readers to ignore the channel). Every spend record also carries
// `attribution` (flag | env | latest-run) so the doubt survives past a stderr
// line nobody reads. No run at all → no sink: nothing is recorded, and we say
// so once rather than silently dropping the spend. Never redirects an explicit
// signal — a flag/env dir with no run-ledger.json is used anyway (just noticed),
// unlike the sibling READERS' downgrade-to-latest (right for a read, wrong for
// a write: it would move a caller's spend to a run they never named).
function resolveSpendSink(runDirFlag, root, env) {
  const e = env || process.env;
  let runDir, source;
  if (runDirFlag) {
    runDir = runDirFlag;
    source = "flag";
  } else if (e.FAFF_RUN_DIR) {
    runDir = e.FAFF_RUN_DIR;
    source = "env";
  } else {
    try { runDir = latestRunDir(root); } catch { runDir = null; }
    source = "latest-run";
  }
  if (!runDir) {
    process.stderr.write("faff engine call: engine call outside a run — spend not metered (pass --run-dir, set $FAFF_RUN_DIR, or run inside a run)\n");
    return null;
  }
  if (source === "latest-run") {
    process.stderr.write(`faff engine call: no --run-dir and no $FAFF_RUN_DIR — attributing codex spend to the newest run ${runDir} (pass --run-dir to attribute it exactly)\n`);
  }
  if (!fs.existsSync(path.join(runDir, "run-ledger.json"))) {
    process.stderr.write(`faff engine call: ${runDir} has no run-ledger.json — recording spend there anyway (resolved from ${source})\n`);
  }
  const { appendEngineSpend } = require("./budget");
  return (record) => appendEngineSpend(runDir, { ...record, attribution: source });
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
  // FAFF-705: one informational stderr note when the requested effort is clamped to the
  // transport ceiling (xhigh/max → high) — mirrors resolveSpendSink's "spend not metered"
  // note. A note, not a refusal (the ticket sanctions mapping to the nearest supported);
  // emitted once per call at dispatch, never per token. low/medium/high pass through silently.
  if (res.effort) {
    const mapped = reasoningEffortForTransport(res.effort);
    if (mapped !== res.effort) {
      process.stderr.write(`faff engine call: effort.${lane} "${res.effort}" clamped to "${mapped}" — engines.${res.name} (${res.provider}) reasoning-effort tops out at ${mapped}; set effort.${lane} to ${mapped} to silence this note.\n`);
    }
  }
  // FAFF-593/FAFF-647: a SPAWN transport family (codex today) is not HTTP — fork
  // after config resolution to the registered runner, which owns its whole
  // procedure (api-key guard, seat probe, exec spawn, parse, classify) and its
  // own failure tags (a spawn record has no host, so the HTTP `@ host` tag would
  // be a lie). Looked up through SPAWN_FAMILY_RUNNERS (above) rather than a
  // hardcoded per-family `if` — this IS the registry lookup the conformance
  // selftest also drives, from the same map. Synchronous int (or Promise) return
  // — bin/faff's dispatcher accepts either.
  const spawnRunner = spawnFamilyRunners()[res.family];
  if (spawnRunner) {
    let system, user;
    try { system = fs.readFileSync(systemFile, "utf8"); user = fs.readFileSync(userFile, "utf8"); }
    catch (e) { process.stderr.write(`faff engine call: cannot read prompt file — ${e.message}\n`); return ENGINE_EXIT.CONFIG; }
    return spawnRunner({ engine: res, system, user, spendSink: resolveSpendSink(get("--run-dir"), root) });
  }
  // Token indirection: config carries the env var NAME, never the key. A declared
  // handle whose env is unset is auth-failed BEFORE any network call — named, never a 401 later.
  // FAFF-481: which env var holds the token follows backends.js resolveTokenSource —
  // auth: api-key → api_key_env; auth: subscription-seat → seat_token_env (the headless seat
  // handle; a spawned engine-call has no ambient session, so a handle-less HTTP seat has no
  // token to send). A legacy/unspecified auth resolves api_key_env, byte-for-byte today.
  const tokenEnv = (res.auth === "subscription-seat") ? res.seatTokenEnv : res.apiKeyEnv;
  let apiKey = null;
  if (tokenEnv) {
    apiKey = process.env[tokenEnv];
    if (!apiKey) {
      const handleField = res.auth === "subscription-seat" ? "seat_token_env" : "api_key_env";
      process.stderr.write(`faff engine call: auth-failed — engines.${res.name} declares ${handleField} "${tokenEnv}" but that env var is unset\n`);
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
    // FAFF-705: a graded effort emits reasoning_effort (mapped onto the transport target).
    const r4 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "", effort: "high" });
    ok("openai: effort high → reasoning_effort:high", JSON.parse(r4.body).reasoning_effort === "high");
    const r5 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "", effort: "max" });
    ok("openai: effort max → reasoning_effort:high (clamped)", JSON.parse(r5.body).reasoning_effort === "high");
    const r6 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "" });
    ok("openai: no effort → no reasoning_effort key (byte-identity)", !("reasoning_effort" in JSON.parse(r6.body)));
    const r7 = buildEngineRequest({ family: "openai", host: "https://api.x.dev/v1", model: "m1", system: "", user: "", reasoningOff: true, effort: "high" });
    ok("openai: reasoning_off wins over effort (mutually exclusive)", JSON.parse(r7.body).chat_template_kwargs.thinking === false && !("reasoning_effort" in JSON.parse(r7.body)));
    // FAFF-705: a stray effort on ollama is ignored, never thrown, never emitted.
    const r8 = buildEngineRequest({ family: "ollama", host: "http://h", model: "m", system: "", user: "", effort: "high" });
    ok("ollama: stray effort ignored, no reasoning_effort key", !("reasoning_effort" in JSON.parse(r8.body)));
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
  // FAFF-705: a graded effort on a NON-graded family (ollama) stays refused, now with a
  // capability-specific message naming the missing transport + the remedy.
  {
    const r = resolveEngineForLane({ ...cfgOk, effort: { methodology: "high" } }, "methodology");
    ok("resolve: graded effort on ollama (non-graded family) refused, capability-named",
      /effort\.methodology/.test(r.error || "") && /no graded reasoning-effort transport/.test(r.error || "") && /reasoning_off/.test(r.error || ""));
  }
  // FAFF-705: a graded effort on a GRADED-effort family (openai) is carried on the record.
  {
    const r = resolveEngineForLane({ engines: { s: { provider: "nvidia", model: "m", host: "https://x/v1" } }, models: { methodology: "engine:s" }, effort: { methodology: "high" } }, "methodology");
    ok("resolve: graded effort on openai family carried (not refused)", !r.error && r.effort === "high" && r.family === "openai");
  }
  // FAFF-705: an above-ceiling effort (max) is carried pre-map on the record (the encode
  // sites clamp; the record stores the faff level so economics buckets it uniformly).
  {
    const r = resolveEngineForLane({ engines: { s: { provider: "nvidia", model: "m", host: "https://x/v1" } }, models: { intake: "engine:s" }, effort: { intake: "max" } }, "intake");
    ok("resolve: above-ceiling effort (max) carried pre-map", !r.error && r.effort === "max");
  }
  // FAFF-705: a graded effort contradicting reasoning_off on one openai engine is refused.
  {
    const r = resolveEngineForLane({ engines: { s: { provider: "nvidia", model: "m", host: "https://x/v1", reasoning_off: true } }, models: { methodology: "engine:s" }, effort: { methodology: "low" } }, "methodology");
    ok("resolve: graded effort + reasoning_off refused, contradiction named",
      /reasoning_off: true/.test(r.error || "") && /contradictory/.test(r.error || ""));
  }
  // FAFF-705: an inherit/unset engine lane resolves effort:null (byte-for-byte the old path).
  ok("resolve: inherit effort → effort:null", resolveEngineForLane(cfgOk, "methodology").effort === null);
  {
    const r = resolveEngineForLane({ engines: { s: { provider: "nvidia", model: "m", host: "https://x/v1", api_key_env: "K", timeout: 30, reasoning_off: true } }, models: { intake: "engine:s" } }, "intake");
    ok("resolve: openai-compatible family + options", !r.error && r.family === "openai" && r.apiKeyEnv === "K" && r.timeoutMs === 30000 && r.reasoningOff === true);
    ok("resolve: api-key backend carries auth + null seat handle", r.auth === "api-key" && r.seatTokenEnv === null);
  }
  {
    // FAFF-481: an openai-compatible subscription-seat with a headless handle resolves seatTokenEnv,
    // so the engine-call transport reads the seat token from that env var (not api_key_env).
    const r = resolveEngineForLane({ backends: { seat: { provider: "nvidia", model: "m", host: "https://x/v1", auth: "subscription-seat", seat_token_env: "OPENAI_SEAT_TOKEN" } }, models: { intake: "engine:seat" } }, "intake");
    ok("resolve: subscription-seat backend carries the seat handle", !r.error && r.auth === "subscription-seat" && r.seatTokenEnv === "OPENAI_SEAT_TOKEN" && r.apiKeyEnv === null);
  }

  // FAFF-593: fold the codex spawn family's table in — `faff engine --selftest`
  // stays the single entry point for the whole engine-call transport.
  const { codexSelftest } = require("./engine-codex");
  fail += codexSelftest();

  // FAFF-647: fold in the CLAUDE_CONFIG_DIR isolation helper's own selftest
  // (withIsolatedClaudeConfig end-to-end, real fs seams) — same "one entry
  // point" posture as codexSelftest above.
  const { claudeConfigIsolationSelftest } = require("./claude-config-isolation");
  fail += await claudeConfigIsolationSelftest();

  // FAFF-647: the registry-driven conformance selftest — reads SPAWN_FAMILY_RUNNERS
  // (the SAME map cmdEngine dispatches through, above) and, for EVERY registered
  // runner, drives two assertions with injected seams:
  //
  //   (A) REDACTION, asserted for every registered runner: drive the runner down
  //       its spawn-FAILURE path with an injected sentinel token in the child's
  //       auth env and a logger seam that captures the failure-path log payload;
  //       assert the sentinel never appears in it. A runner that dumps its child
  //       env verbatim on failure fails this assertion.
  //
  //   (B) CLAUDE_CONFIG_DIR ISOLATION, asserted only for families
  //       SPAWN_FAMILY_CONFIG_DIR_BEARING declares true: drive the runner through
  //       withIsolatedClaudeConfig with a mock spawnFn that captures {env, cwd}
  //       and spy copy/chmod/mkdtemp seams that record every path touched;
  //       assert the child's CLAUDE_CONFIG_DIR is isolated (under baseDir,
  //       distinct from ambientDir) and no seam wrote into the ambient dir.
  //
  // Today SPAWN_FAMILY_RUNNERS holds only { codex }, and codex declares itself
  // config-dir-free — so (A) executes for real against codex (a live binding,
  // not a placeholder: codex logs stderr excerpts, never `env`, so it passes)
  // and (B) drives zero rows (dormant, per spec, until a config-dir-bearing
  // runner registers — never a registry-shape check).
  {
    const SENTINEL = "faff647-selftest-sentinel-3f7a9c1e-never-log-verbatim";
    const runners = spawnFamilyRunners();
    for (const [family, runnerFn] of Object.entries(runners)) {
      // (A) redaction — spawn-failure path, sentinel injected via a declared
      // api_key_env-shaped handle (the runner's own auth-token injection path),
      // captured through the runner's own logger seam (stderrWrite for codex —
      // the shared spawn-runner calling convention every registered runner uses).
      {
        let captured = "";
        const failEngine = { name: `selftest-${family}`, provider: family, family, model: "m", binPath: "codex", apiKeyEnv: "FAFF647_SELFTEST_SENTINEL_ENV", timeoutMs: 1000 };
        const failSpawn = (cmd, args) => (args && args[0] === "login"
          ? { status: 0, stdout: "Logged in", stderr: "", error: null, signal: null }
          : { status: 1, stdout: "", stderr: "boom", error: null, signal: null });
        let runnerResult;
        try {
          runnerResult = runnerFn({
            engine: failEngine, system: "S", user: "U",
            spawnFn: failSpawn,
            env: { FAFF647_SELFTEST_SENTINEL_ENV: SENTINEL },
            stdoutWrite: () => {}, stderrWrite: (s) => { captured += s; },
          });
        } catch (e) { captured += String((e && e.message) || e); }
        if (runnerResult && typeof runnerResult.then === "function") { await runnerResult.catch((e) => { captured += String((e && e.message) || e); }); }
        ok(`conformance[${family}]: redaction — the injected sentinel token never appears in the spawn-failure log`, !captured.includes(SENTINEL));
      }

      // (B) CLAUDE_CONFIG_DIR isolation — config-dir-bearing families only.
      // Drives the assertion THROUGH runnerFn itself (never withIsolatedClaudeConfig
      // directly) — the spec's point is to catch a runner whose spawn path SKIPS
      // isolation entirely, which a direct helper-only call could never detect. The
      // registry's calling convention for a config-dir-bearing runner (declared
      // here, since none is registered yet to declare it independently): it accepts
      // the SAME { ambientDir, ambientEnv, apiKeyEnv, baseDir, seams } shape
      // withIsolatedClaudeConfig itself takes, plus a `spawnFn` it threads straight
      // through to its own withIsolatedClaudeConfig call. A runner that ignores
      // `seams`/`baseDir` and isolates some other way still satisfies (B) as long as
      // the child it hands `spawnFn` is genuinely isolated; a runner that skips
      // isolation and calls `spawnFn` with the ambient env/cwd fails it.
      if (SPAWN_FAMILY_CONFIG_DIR_BEARING[family]) {
        const ambientDir = "/selftest-ambient-not-a-real-path";
        const baseDir = "/selftest-base-not-a-real-path";
        const touched = [];
        let capturedEnv = null;
        const mockSpawnFn = async ({ env }) => { capturedEnv = env; return { stdout: "ok" }; };
        await runnerFn({
          engine: { name: `selftest-${family}`, provider: family, family, model: "m" },
          system: "S", user: "U",
          authMode: "subscription-seat",
          ambientDir,
          ambientEnv: { HOME: "/h" },
          baseDir,
          spawnFn: mockSpawnFn,
          seams: {
            mkdtempFn: (p) => { const d = `${p}mockdir`; touched.push({ op: "mkdtemp", path: d }); return d; },
            chmodFn: (p) => { touched.push({ op: "chmod", path: p }); },
            copyFn: (src, dst) => { touched.push({ op: "copy-src", path: src }); touched.push({ op: "copy-dst", path: dst }); },
            rmFn: () => { touched.push({ op: "rm" }); },
            writeFileFn: () => {},
            warnFn: () => {},
          },
        });
        ok(`conformance[${family}]: CLAUDE_CONFIG_DIR isolated — set, under baseDir, distinct from ambientDir`, !!capturedEnv && capturedEnv.CLAUDE_CONFIG_DIR && capturedEnv.CLAUDE_CONFIG_DIR.startsWith(baseDir) && capturedEnv.CLAUDE_CONFIG_DIR !== ambientDir);
        ok(`conformance[${family}]: no WRITE seam call targeted a path inside the ambient dir`, !touched.some((t) => t.op !== "copy-src" && t.path && t.path.startsWith(ambientDir)));
      }
    }
    ok("conformance: SPAWN_FAMILY_RUNNERS has a real occupant today (codex) — not a dormant registry", Object.keys(runners).includes("codex"));
    ok("conformance: codex declares itself config-dir-free — isolation half (B) correctly skipped for it", SPAWN_FAMILY_CONFIG_DIR_BEARING.codex === false);
  }

  console.log(`\nRESULT: ${fail ? "FAIL" : "PASS"} (engine call, ${fail} failed)`);
  return fail ? 1 : 0;
}

module.exports = { ENGINE_EXIT, SPAWN_FAMILY_CONFIG_DIR_BEARING, buildEngineRequest, cmdEngine, defaultGet, defaultPost, engineSelftest, isAuthError, joinUrl, modelServedOllama, modelServedOpenAi, parseEngineResponse, preflightEngine, resolveSpendSink, runEngineCall, spawnFamilyRunners };
