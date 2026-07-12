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
import { join as pathJoin } from "node:path";
import { spawnSync } from "node:child_process";

// Exit codes the skill maps to a verdict: 0 ok · 4 model-not-served (→ needs-human) ·
// 5 provider-unreachable, explicitly-configured host (→ pass+skip) ·
// 6 provider-unreachable, unconfigured localhost default (→ needs-human, FAFF-213) ·
// 7 auth-failed (cloud creds / unset key env, → needs-human, FAFF-209) · 2 usage · 1 other ·
// 9 mandatory-chain-outage — a MANDATORY (L4 --lights-out) review's chain exhausted with no opinion
//   obtained (all UNREACHABLE/5 or DEADLINE/8), which fails CLOSED → needs-human (FAFF-398).
// 10 malformed (FAFF-194) — a reachable+served backend's OK content is not findings-shaped (empty,
//   header-only, or no recognised `### <severity>:` section) — a model-quality fault, per-backend,
//   member of CHAIN_NEEDS_HUMAN (never masked by an otherwise-available chain).
export const EXIT = { OK: 0, OTHER: 1, USAGE: 2, NOT_SERVED: 4, UNREACHABLE: 5, DEFAULT_HOST_UNREACHABLE: 6, AUTH: 7, DEADLINE: 8, MANDATORY_OUTAGE: 9, MALFORMED: 10 };
// FAFF-329: DEADLINE(8) — the Phase-2 total wall-clock budget (--deadline) was hit before any backend
// produced findings. Distinct from UNREACHABLE(5) so a deadline-skip is observable, but the caller routes
// it IDENTICALLY: pass + skip the second opinion, logged loudly (a bounded turn beats an unbounded stall;
// the hard merge gate — AC + CI + Phase-1 pass — is untouched). A config fault (needs-human class) seen on
// an earlier backend still DOMINATES (surfaced instead of 8) — the no-silent-weakening invariant.
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

// Transport families. ollama speaks /api/tags + /api/chat (NDJSON). openai speaks the
// OpenAI-compatible /v1/models + /v1/chat/completions (SSE) shared by OpenAI, vLLM, OpenRouter,
// NVIDIA NIM (integrate.api.nvidia.com/v1), DeepSeek, etc. gemini rides that same family via Google's
// documented OpenAI-compatibility base URL (https://generativelanguage.googleapis.com/v1beta/openai),
// so it needs no adaptor of its own — just the whitelist entry (FAFF-210). anthropic has a native wire
// format (/v1/messages: top-level system, content blocks, x-api-key + anthropic-version headers,
// max_tokens required) and gets its own family. An unknown provider still returns "unsupported-provider".
export function providerFamily(name) {
  const n = String(name || "ollama").toLowerCase();
  if (n === "ollama") return "ollama";
  if (["openai", "vllm", "openrouter", "nvidia", "deepseek", "openai-compatible", "gemini"].includes(n)) return "openai";
  if (n === "anthropic") return "anthropic";
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

// --- FAFF-194: deterministic guards for machine-checkable findings + output-format enforcement ---
//
// The adversarial reviewer's findings are hypotheses from a deliberately fallible LLM; two things the
// harness should settle itself rather than trust to the model: whether a "this is a syntax error" claim
// is true (node --check answers that), and whether the raw output is findings-shaped at ALL (main() used
// to print whatever a backend streamed, even empty, as exit 0). Both move into this pure-function layer
// + one injectable check runner, so the LLM is spent only on judgement a tool can't verify.

// PURE: tolerant split of reviewer output into a preamble (everything before the first `### ` heading —
// e.g. the `## Adversarial findings — provider/model` header line) and an ordered list of finding
// sections. Each section spans from its `### ` heading line to (exclusive) the next one, or EOF. Severity
// is parsed from the heading; a heading with no recognised severity word still yields a section (raw
// findings-shape validation only cares that >=1 section has severity != null).
const SEVERITY_HEADING_RE = /^###\s*\[?(critical|major|minor|observation)\]?\s*[:—-]\s*(.*)$/i;

export function splitFindings(content) {
  const text = String(content == null ? "" : content);
  const lines = text.split("\n");
  const headingIdxs = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s/.test(lines[i])) headingIdxs.push(i);
  }
  if (headingIdxs.length === 0) return { preamble: text, sections: [] };
  const preamble = lines.slice(0, headingIdxs[0]).join("\n");
  const sections = [];
  for (let i = 0; i < headingIdxs.length; i++) {
    const start = headingIdxs[i];
    const end = i + 1 < headingIdxs.length ? headingIdxs[i + 1] : lines.length;
    const heading = lines[start];
    const body = lines.slice(start + 1, end).join("\n");
    const raw = lines.slice(start, end).join("\n");
    const m = heading.match(SEVERITY_HEADING_RE);
    const severity = m ? m[1].toLowerCase() : null;
    const title = m ? m[2] : heading.replace(/^###\s*/, "");
    sections.push({ heading, severity, title, body, raw });
  }
  return { preamble, sections };
}

// PURE: is this content findings-shaped? Non-empty AND at least one `### <severity>: ...` section with a
// severity in the closed set. Empty/whitespace-only content, or prose with no recognised finding section
// (a refusal, rambling, or a headerless essay), is malformed — the exit-10 class (FAFF-194).
export function validateFindingsShape(content) {
  const trimmed = String(content == null ? "" : content).trim();
  if (!trimmed) return { ok: false, reason: "empty content" };
  const { sections } = splitFindings(content);
  if (!sections.some((s) => s.severity != null)) {
    return { ok: false, reason: "no recognised finding section (### <severity>: ...)" };
  }
  return { ok: true };
}

// PURE: the canonical, harness-authored findings header — provenance is harness data, never demanded
// from the fallible model (FAFF-194 design decision: normalise/prepend rather than park on a missing one).
export function canonicalHeader(provider, model) {
  return `## Adversarial findings — ${provider}/${model}`;
}

const HEADER_LINE_RE = /^##[ \t]*Adversarial findings.*$/mi;

// PURE: replace an existing (possibly model-echoed, possibly wrong) header line with the canonical one, or
// prepend it when absent. A no-op (byte-identical) when the existing header already matches canonical.
export function ensureHeader(content, provider, model) {
  const header = canonicalHeader(provider, model);
  const text = String(content == null ? "" : content);
  if (HEADER_LINE_RE.test(text)) return text.replace(HEADER_LINE_RE, header);
  return `${header}\n\n${text}`;
}

// PURE: recall-tuned WITHIN the syntax/parse claim class only (v1 scope) — a finding asserting code
// "won't parse" / "is invalid syntax" / "fails to parse", etc. Crash/test-failure claims are OUT OF SCOPE
// (a green suite doesn't refute an uncovered-path claim); this regex intentionally never matches those.
const SYNTAX_CLAIM_RE = /syntax error|SyntaxError|won'?t parse|will not parse|fails? to parse|invalid (javascript|js|syntax)|not (valid|parseable|parsable)/i;

export function findSyntaxClaims(sectionText) {
  return SYNTAX_CLAIM_RE.test(String(sectionText == null ? "" : sectionText));
}

const JS_FAMILY_RE = /\.(m|c)?js$/i;
function isJsFamily(p) { return JS_FAMILY_RE.test(String(p == null ? "" : p)); }

// PURE: which context paths does this finding's text name, filtered to JS-family (.js/.mjs/.cjs) — the
// only family `node --check` can settle. A path is "named" by simple substring match against the section
// text (heading + body), matching how the reviewer's own context files are fenced (assembleUserMessage).
export function claimTargets(sectionText, contextPaths) {
  const text = String(sectionText == null ? "" : sectionText);
  return (contextPaths || []).filter((p) => text.includes(p) && isJsFamily(p));
}

// The injectable check runner (the only new I/O) — real spawnSync("node", ["--check", path]); ok iff
// exit 0. Injectable exactly as getFn/streamFn are, so CI spawns nothing unless a test opts in.
export function realCheck(path) {
  const r = spawnSync("node", ["--check", path], { encoding: "utf8" });
  const ok = !r.error && r.status === 0;
  const output = String((r.stderr || r.stdout || (r.error && r.error.message) || "")).trim();
  return { ok, output };
}

// PURE-ISH (checkFn is the one injected side-effect): downgrade-only refutation pass over machine-checkable
// syntax claims. Precision over recall — a finding is downgraded ONLY when every file the claim can be tied
// to positively passes the check; any inability to tie the claim to a checkable file, or any check
// failure, leaves it untouched (a wrongly-downgraded true finding is the expensive error; a surviving false
// finding merely costs the implementor the status-quo disproof cycle). Never drops a finding — downgrades
// severity to `observation`, prefixes the title `[auto-refuted]`, and appends an evidence line, so the
// audit trail (what the reviewer got wrong) survives.
//
// Target resolution (contextPaths is the FULL context list, unfiltered — mirrors what the reviewer was
// actually shown): claimTargets() already filters matches to JS-family. When a section names NO context
// path at all (JS or otherwise), fall back to every JS-family context path (a generic "this code has a
// syntax error" claim, uncommitted to one file) — but a claim that names ONLY a non-JS-family file (e.g.
// SKILL.md) stays untouched: it named something, just nothing this pass can settle (precision bias).
export function refuteFindings(content, contextPaths, { checkFn = realCheck } = {}) {
  const paths = contextPaths || [];
  const jsPaths = paths.filter(isJsFamily);
  const { preamble, sections } = splitFindings(content);
  const refutations = [];
  let changed = false;

  const newSections = sections.map((s) => {
    if (s.severity == null) return s;
    if (!findSyntaxClaims(s.raw)) return s;

    let targets = claimTargets(s.raw, paths);
    if (targets.length === 0) {
      const namedAnyContextPath = paths.some((p) => s.raw.includes(p));
      if (!namedAnyContextPath) targets = jsPaths;   // generic claim, no file named — check every JS file
    }
    if (targets.length === 0) return s;   // cannot tie the claim to a checkable file — untouched

    const results = targets.map((t) => checkFn(t));
    if (!results.every((r) => r && r.ok)) return s;   // any check failure — the reviewer may be right

    changed = true;
    refutations.push({ title: s.title, files: targets, from: s.severity });
    const files = targets.join(", ");
    const newTitle = `[auto-refuted] ${s.title}`;
    const newHeading = `### observation: ${newTitle}`;
    const evidence = `> auto-refuted: node --check passed on ${files} — syntax claim mechanically disproved (was ${s.severity})`;
    const newRaw = s.body ? `${newHeading}\n${s.body}\n${evidence}` : `${newHeading}\n${evidence}`;
    return { ...s, severity: "observation", title: newTitle, heading: newHeading, raw: newRaw };
  });

  if (!changed) return { content, refutations: [] };

  const sectionsText = newSections.map((s) => s.raw).join("\n");
  const rebuilt = preamble ? `${preamble}\n${sectionsText}` : sectionsText;
  return { content: rebuilt, refutations };
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

// --- Anthropic (native /v1/messages) pure functions (FAFF-210) ---

// The anthropic-version header value the Messages API requires. Named constant with a temporal anchor:
// stable + documented, but re-verify against the Anthropic API docs if the header is ever rejected.
export const ANTHROPIC_VERSION = "2023-06-01";

// PURE: the /v1/messages payload. Distinct from the OpenAI shape: `system` is a TOP-LEVEL string (not a
// messages[0] entry), `max_tokens` is REQUIRED by the API (no default on the wire), and NO `temperature`
// is sent — current Claude reviewer models reject non-default sampling params under extended thinking with
// a 400 (→ EXIT.OTHER), and the review needs no specific temperature. maxTokens is the analogue of ollama's
// num_predict / openai's max_tokens.
export function buildAnthropicPayload({ model, system, user, maxTokens = DEFAULT_NUM_PREDICT }) {
  if (!model) throw new Error("buildAnthropicPayload requires a model");
  return {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    stream: true,
  };
}

// PURE: fold Anthropic's named-event SSE into the assistant text. The stream is `event: <name>\n data:
// {json}\n\n` frames; we dispatch on each data payload's own `type` (the `event:` lines are redundant and
// ignored, exactly as accumulateSse ignores non-`data:` lines). Reads only text_delta (a thinking_delta is
// the model's hidden reasoning — dropped, we want only the answer). stop_reason==="max_tokens" on the late
// message_delta reports truncation. Tolerant fallback: if the body carries no `data:` frames (a backend
// that ignored stream:true and returned one Messages object), parse it whole and concatenate its
// content[] text blocks. Same {content, truncated, done} contract as accumulateNdjson/accumulateSse.
export function accumulateAnthropic(text) {
  let content = "";
  let truncated = false;
  let done = false;
  let sawData = false;
  for (const line of String(text).split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    sawData = true;
    const payload = t.slice(5).trim();
    let j;
    try { j = JSON.parse(payload); } catch { continue; }
    if (j?.type === "content_block_delta" && j?.delta?.type === "text_delta" && typeof j.delta.text === "string") {
      content += j.delta.text;
    } else if (j?.type === "message_delta") {
      done = true;
      if (j?.delta?.stop_reason === "max_tokens") truncated = true;
    } else if (j?.type === "message_stop") {
      done = true;
    }
  }
  if (!sawData) {
    // non-streamed fallback: a single Messages response { content: [{type:"text", text}], stop_reason }
    try {
      const j = JSON.parse(String(text));
      for (const block of j?.content ?? []) {
        if (block?.type === "text" && typeof block.text === "string") content += block.text;
      }
      if (j?.stop_reason) { done = true; if (j.stop_reason === "max_tokens") truncated = true; }
    } catch { /* leave content empty — caller treats empty as needs-human */ }
  }
  return { content, truncated, done };
}

// PURE: an HTTP 401/403 from a cloud provider means broken credentials, not infra — needs-human, no retry.
// FAFF-210: Google's OpenAI-compat layer (the gemini family) returns HTTP 400 API_KEY_INVALID for a
// malformed key, NOT 401/403 — so a 400 whose body carries an explicit invalid-key marker is also auth.
// The marker gate keeps this narrow: a generic 400 (bad request shape) has no marker and stays non-auth,
// so no other openai-family provider is affected. Depends on realGet/realStream carrying the body into
// the error message (both do). Direction is fail-safe: this only ever routes MORE to needs-human (exit 7),
// never fewer — it can never turn a real auth fault into a silent pass+skip (the no-silent-weakening invariant).
export function isAuthError(err) {
  const m = String(err && err.message);
  return /HTTP 40[13]/.test(m) || (/HTTP 400/.test(m) && /API_KEY_INVALID|api key not valid/i.test(m));
}

// PURE (FAFF-227; 429 added FAFF-228): is this a *transient* transport fault that should be retried?
// Mirrors isAuthError. TRUE for a retryable condition — HTTP 5xx, a dropped socket (ECONNRESET/ETIMEDOUT/
// EPIPE or "socket hang up"), a stream/preflight timeout, or an HTTP 429 rate-limit (the provider is up but
// throttling — transient infra, not a request fault, so the same request may succeed after a backoff).
// FALSE for everything else (4xx *other than 429* incl. auth, usage, model-not-served, anything unknown):
// default-terminal, so the predicate never over-retries a real fault. Only 429 among the 4xx flips
// transient — do NOT broaden to /HTTP 4\d\d/ (401/403/404/400 are genuine auth/request faults that must
// stay terminal). realGet/realStream reject 5xx/429 as `HTTP <status>: …` and surface socket faults with
// err.code, so both the message and (when present) the code are inspected.
export function isTransientTransport(err) {
  if (!err) return false;
  const msg = String(err.message || "");
  const code = String(err.code || "");
  return /HTTP 5\d\d/.test(msg)                       // 5xx server fault from a reject
    || ["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code)
    || /socket hang up/.test(msg)
    || /timed out/.test(msg)                           // realStream / preflight timeout text
    || /HTTP 429/.test(msg);                            // FAFF-228: rate-limit is transient infra, retry it
}

// Bounded transport-retry policy (FAFF-227): named constants, not magic numbers. attempts counts the
// first try too (3 ⇒ 2 retries). Backoff before retry k (1-indexed) is base_ms * 2^(k-1), each *sleep*
// capped by the time remaining against the caller's --timeout deadline so a backoff never overruns budget.
// TIMEOUT BOUND (FAFF-228 — correction): --timeout bounds each individual stream attempt and the
// inter-retry sleeps, NOT the total wall-clock. Each streamOnce gets the full timeoutMs; the truncation
// retry adds a second streamOnce; this loop runs up to `attempts` (3) times — so worst-case total
// wall-clock is ~6× timeoutMs (3 attempts × 2 streamOnce) under stream + truncation + transport-retry
// composition. There is no overall deadline across attempts (a true cap is a deferred behavioural change).
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
        // FAFF-210: include the body (as realStream already does) so isAuthError can see a gemini
        // 400 API_KEY_INVALID at the preflight GET — without it that bad-key 400 would misroute to
        // unreachable/pass+skip and silently disable the gate.
        : reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))));
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
  getFn = realGet, streamFn = realStream, timeoutMs, hardDeadlineMs,
}) {
  const pf = await preflight({ host, model, getFn });
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  // FAFF-329: when a total wall-clock hardDeadlineMs is set, re-clamp EVERY stream attempt (incl. the
  // truncation retry) to the budget still remaining, so a single backend's retry composition can never
  // overrun the total deadline. Unset ⇒ the per-attempt timeoutMs unchanged (byte-for-byte today).
  const perAttempt = () => (typeof hardDeadlineMs === "number"
    ? Math.max(1, Math.min(typeof timeoutMs === "number" ? timeoutMs : hardDeadlineMs - Date.now(), hardDeadlineMs - Date.now()))
    : timeoutMs);
  const streamCall = async () => {
    let out = await streamOnce({ host, model, system, user, numPredict, streamFn, timeoutMs: perAttempt() });
    if (out.truncated) {
      out = await streamOnce({ host, model, system, user, numPredict: numPredict * 2, streamFn, timeoutMs: perAttempt() });
    }
    return out;
  };
  const deadlineMs = typeof hardDeadlineMs === "number" ? hardDeadlineMs
    : (typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined);
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
  getFn = realGet, streamFn = realStream, timeoutMs, hardDeadlineMs,
}) {
  const pf = await preflightOpenAi({ host, model, apiKey, getFn });
  if (pf.authFailed) return { status: "auth-failed", note: pf.error };
  if (pf.unreachable) return { status: "unreachable", note: pf.error };
  if (!pf.served) return { status: "model-not-served", names: pf.names };

  // FAFF-329: re-clamp every attempt to the remaining total budget when hardDeadlineMs is set (see runReviewOllama).
  const perAttempt = () => (typeof hardDeadlineMs === "number"
    ? Math.max(1, Math.min(typeof timeoutMs === "number" ? timeoutMs : hardDeadlineMs - Date.now(), hardDeadlineMs - Date.now()))
    : timeoutMs);
  try {
    const streamCall = async () => {
      let out = await streamOnceOpenAi({ host, model, system, user, numPredict, reasoningOff, apiKey, streamFn, timeoutMs: perAttempt() });
      if (out.truncated) {
        out = await streamOnceOpenAi({ host, model, system, user, numPredict: numPredict * 2, reasoningOff, apiKey, streamFn, timeoutMs: perAttempt() });
      }
      return out;
    };
    const deadlineMs = typeof hardDeadlineMs === "number" ? hardDeadlineMs
      : (typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined);
    const r = await streamWithTransportRetry(streamCall, { deadlineMs });
    if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
    return { status: "ok", content: r.out.content, truncated: r.out.truncated };
  } catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    throw e;
  }
}

async function streamOnceAnthropic({ host, model, system, user, numPredict, apiKey, streamFn, timeoutMs }) {
  const headers = { "anthropic-version": ANTHROPIC_VERSION };
  if (apiKey) headers["x-api-key"] = apiKey;   // absent key ⇒ the API 401s → auth-failed (mirrors openai's Bearer)
  const body = JSON.stringify(buildAnthropicPayload({ model, system, user, maxTokens: numPredict }));
  const raw = await streamFn(joinUrl(host, "/v1/messages"), body, timeoutMs, headers);
  return accumulateAnthropic(raw);
}

// Anthropic native orchestration (FAFF-210): mirrors the openai path (stream → one 2× truncation retry,
// wrapped in the same FAFF-227 bounded transport retry) with two differences. (1) NO preflight — Anthropic
// exposes no model-list endpoint used here, so a bad model id can't be caught up front; it surfaces as a
// 404/not_found on the first stream call and is classified in the catch → model-not-served (exit 4), the
// same needs-human class the other families' preflight not-served yields. (2) The catch also maps that 404.
// Auth (401/403) is terminal via isAuthError (isTransientTransport is FALSE for it, so the wrapper rethrows
// into this catch); an exhausted transient fault surfaces transport-failed → a documented exit, never EXIT.OTHER.
async function runReviewAnthropic({
  host, model, system, user, numPredict = DEFAULT_NUM_PREDICT, apiKey,
  getFn = realGet, streamFn = realStream, timeoutMs, hardDeadlineMs,
}) {
  // FAFF-329: re-clamp every attempt to the remaining total budget when hardDeadlineMs is set (see runReviewOllama).
  const perAttempt = () => (typeof hardDeadlineMs === "number"
    ? Math.max(1, Math.min(typeof timeoutMs === "number" ? timeoutMs : hardDeadlineMs - Date.now(), hardDeadlineMs - Date.now()))
    : timeoutMs);
  try {
    const streamCall = async () => {
      let out = await streamOnceAnthropic({ host, model, system, user, numPredict, apiKey, streamFn, timeoutMs: perAttempt() });
      if (out.truncated) {
        out = await streamOnceAnthropic({ host, model, system, user, numPredict: numPredict * 2, apiKey, streamFn, timeoutMs: perAttempt() });
      }
      return out;
    };
    const deadlineMs = typeof hardDeadlineMs === "number" ? hardDeadlineMs
      : (typeof timeoutMs === "number" ? Date.now() + timeoutMs : undefined);
    const r = await streamWithTransportRetry(streamCall, { deadlineMs });
    if (!r.ok) return { status: "transport-failed", note: r.error && r.error.message };
    return { status: "ok", content: r.out.content, truncated: r.out.truncated };
  } catch (e) {
    if (isAuthError(e)) return { status: "auth-failed", note: e.message };
    const m = String(e && e.message);
    if (/HTTP 404/.test(m) || /not_found/i.test(m)) return { status: "model-not-served", note: e.message };
    throw e;
  }
}

// Dispatcher: routes on the configured provider's transport family. Default (no provider) is ollama,
// preserving the original behaviour and signature.
export async function runReview(opts = {}) {
  const fam = providerFamily(opts.provider);
  if (fam === "openai") return runReviewOpenAi(opts);
  if (fam === "ollama") return runReviewOllama(opts);
  if (fam === "anthropic") return runReviewAnthropic(opts);
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
    else if (k === "--deadline") a.totalDeadlineMs = Number(argv[++i]) * 1000;   // FAFF-329: TOTAL wall-clock ceiling across ALL attempts + fallback backends (distinct from --timeout, which bounds ONE stream attempt)
    else if (k === "--host-source") a.hostSource = argv[++i];
    else if (k === "--provider") a.provider = argv[++i];
    else if (k === "--api-key-env") a.apiKeyEnv = argv[++i];
    else if (k === "--reasoning-off") a.reasoningOff = true;
    else if (k === "--backends-json") a.backendsJson = argv[++i];   // FAFF-232: ordered fallback chain
    else if (k === "--lights-out") a.mandatory = true;   // FAFF-398: mark this review MANDATORY (L4) — a no-opinion chain exhaustion fails closed → needs-human
    else if (k === "--run-dir") a.runDir = argv[++i];   // FAFF-401: the run whose run-ledger.json derives mandatory-ness (level:"L4"); FAFF_RUN_DIR is the ambient fallback
  }
  return a;
}

// PURE-ISH (FAFF-401): derive "is this review MANDATORY?" mechanically from the run ledger, so no LLM step
// sits between the resolved L4 level and the flag. Mirrors bin/faff's appetite resolver ("ledger brace":
// FAFF_RUN_DIR → run-ledger.json → level === "L4") — the same machine-written state, read a second time by
// deterministic code. Fail-safe direction: ANY resolution miss (absent runDir, missing/unreadable/garbled
// ledger, or a non-L4 level) returns false ⇒ advisory, byte-for-byte today's behaviour. It only ever ADDS
// mandatory-ness on positive L4 evidence; it never blocks an L1–L3 flow, and it never throws.
//
// Deliberately NO liveness/heartbeat check (unlike the appetite resolver's runIsHeld brace): here the derived
// direction REDUCES agency (mandatory ⇒ fail-closed ⇒ needs-human park), so a stale L4 ledger can only cause a
// visible false park, never a false merge — the staleness confound inverts, and replicating heartbeat math into
// a second file would add drift risk for no directional safety (spec §6).
export function ledgerMandatory(runDir) {
  if (!runDir) return false;
  let ledger;
  try { ledger = JSON.parse(readFileSync(pathJoin(runDir, "run-ledger.json"), "utf8")); }
  catch { return false; }   // missing file, unreadable, or garbled JSON — advisory
  return !!(ledger && ledger.level === "L4");
}

// PURE (FAFF-232): map a runReview() result + host provenance to the documented exit class for ONE backend.
// Extracted from main()'s old inline if-ladder so the single-backend path and runReviewChain map identically.
export function mapResultExit(result, hostSource) {
  switch (result && result.status) {
    case "ok": return EXIT.OK;
    case "unsupported-provider": return EXIT.USAGE;
    case "model-not-served": return EXIT.NOT_SERVED;
    case "auth-failed": return EXIT.AUTH;
    case "unreachable":
    case "transport-failed": return unreachableExit({ hostSource });
    default: return EXIT.OTHER;
  }
}

// PURE (FAFF-232): the terminal exit of an EXHAUSTED chain (no backend produced findings). A config-fault
// class — USAGE(2)/NOT_SERVED(4)/DEFAULT_HOST_UNREACHABLE(6)/AUTH(7)/MALFORMED(10, FAFF-194), all of which
// the skill maps to needs-human — DOMINATES the availability class UNREACHABLE(5 → pass+skip). So a chain
// of purely configured-host availability failures still pass+skips exactly as a lone configured backend
// does today, but a config/model-quality fault ANYWHERE in a fully-failed chain surfaces needs-human
// (never masked by "all down" — the FAFF-213/228 no-silent-weakening invariant). Returns the FIRST
// needs-human class in chain order; else UNREACHABLE(5). Empty list → 5 (no faults to surface).
export const CHAIN_NEEDS_HUMAN = new Set([EXIT.USAGE, EXIT.NOT_SERVED, EXIT.DEFAULT_HOST_UNREACHABLE, EXIT.AUTH, EXIT.MALFORMED]);
export function chainTerminalExit(failureClasses = []) {
  for (const c of failureClasses) if (CHAIN_NEEDS_HUMAN.has(c)) return c;
  return EXIT.UNREACHABLE;
}

// PURE (FAFF-398): a MANDATORY review (an L4 lights-out run, where dialCoherence already REQUIRES the
// adversarial occupant) whose chain exhausted with only a "no-opinion" class — UNREACHABLE(5, all
// configured hosts down) or DEADLINE(8, budget hit before any findings) — must FAIL CLOSED: no second
// opinion was obtained and no human is watching, so map to MANDATORY_OUTAGE(9), which the skill reads as
// unavailable (FAFF-405 — park the PR). Config-fault classes (2/4/6/7) already map to needs-human and pass
// through UNCHANGED — the remap must not upgrade or MASK a specific cause. Advisory reviews (mandatory=false,
// L1–L3) are byte-for-byte unchanged. Applied ONCE at main()'s single caller boundary on runReviewChain's
// terminal exit, so every exhaustion path (all three deadline returns + the chain-exhausted return) is
// covered by construction — runReviewChain itself never learns "mandatory" (stays level-agnostic).
export function mandatoryRemap(exit, mandatory) {
  if (!mandatory) return exit;
  if (exit === EXIT.UNREACHABLE || exit === EXIT.DEADLINE) return EXIT.MANDATORY_OUTAGE;
  return exit;
}

// FAFF-232: run an ORDERED chain of backends, returning the first that produces findings. A backend that
// does not (any non-OK class) is recorded and the chain ADVANCES — the value is a real second opinion from
// SOMEONE, so a per-backend fault never sinks the chain if a healthy fallback exists. Only when every
// backend has failed is one terminal exit computed (chainTerminalExit). A 1-element chain reproduces the
// single-backend path exactly (one runReviewFn call, same exit), so back-compat is structural, not bolted on.
//
// chain element: { provider, model, host, hostSource, apiKey?, apiKeyEnv?, apiKeyMissing?, reasoningOff?, timeoutMs? }
// shared:        { system, user, numPredict, runReviewFn?, getFn?, streamFn?, log? }
// returns:       { exit, content?, truncated?, winner?, failureClasses }
export async function runReviewChain(chain = [], shared = {}) {
  const runReviewFn = shared.runReviewFn || runReview;
  const log = shared.log || ((m) => process.stderr.write(m + "\n"));
  const now = shared.nowFn || (() => Date.now());   // FAFF-329: injectable clock for deterministic deadline tests
  const totalDeadlineMs = shared.totalDeadlineMs;   // FAFF-329: total wall-clock budget across ALL backends (undefined ⇒ no bound, byte-for-byte today)
  const start = now();
  const hardDeadlineMs = typeof totalDeadlineMs === "number" ? start + totalDeadlineMs : undefined;
  const n = chain.length;
  const failureClasses = [];
  for (let i = 0; i < n; i++) {
    // FAFF-329 deadline gate — checked at the TOP of the loop so no NEW backend starts past the budget.
    // On a hit: a needs-human-class fault seen on an earlier backend DOMINATES (no-silent-weakening); else
    // DEADLINE(8) → pass+skip. This is the prevention half — it caps the ~6×timeout×backends blowup.
    if (typeof totalDeadlineMs === "number" && now() - start >= totalDeadlineMs) {
      const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
      const exit = nh != null ? nh : EXIT.DEADLINE;
      log(`deadline: Phase-2 total wall-clock budget ${Math.round(totalDeadlineMs / 1000)}s exceeded after ${i} backend(s) (exit ${exit})`);
      return { exit, deadlineExceeded: true, failureClasses };
    }
    const b = chain[i] || {};
    const tag = `${b.provider || "ollama"}/${b.model || "?"}`;
    const verb = i === n - 1 ? "exhausted" : "advancing";
    // A backend missing model or host is a per-element config fault (USAGE) — advance, never abort the chain.
    // provider is optional (omitted ⇒ ollama, via runReview/providerFamily), preserving the legacy single-
    // backend path where callers never passed --provider.
    if (!b.model || !b.host) {
      failureClasses.push(EXIT.USAGE);
      log(`${verb}: backend ${i + 1}/${n} invalid (missing model/host) (exit ${EXIT.USAGE})`);
      continue;
    }
    // A declared-but-unset api key env is that backend's auth fault — no point calling, advance.
    if (b.apiKeyMissing) {
      failureClasses.push(EXIT.AUTH);
      log(`${verb}: ${tag} api key env '${b.apiKeyEnv}' unset (exit ${EXIT.AUTH})`);
      continue;
    }
    // FAFF-329: bound the WHOLE backend call (incl. a slow-trickle stream whose per-chunk activity
    // resets the socket's idle timeout, and incl. the internal transport-retry backoff) to the budget
    // still remaining — a real timer the perAttempt idle-clamp alone cannot enforce. On a deadline win
    // the in-flight backend is ABANDONED (its socket carries the perAttempt idle timeout, so it self-
    // closes shortly; the timer is unref'd so it never keeps the process alive), and we route to
    // EXIT.DEADLINE — never a misrouted transport-failed/5 — with a needs-human-class fault seen on an
    // earlier backend still dominating (no-silent-weakening).
    const callReview = () => runReviewFn({
      host: b.host, model: b.model, provider: b.provider,
      system: shared.system, user: shared.user, numPredict: shared.numPredict,
      reasoningOff: b.reasoningOff, apiKey: b.apiKey, timeoutMs: b.timeoutMs,
      hardDeadlineMs,   // absolute total-budget deadline; the backend also clamps each attempt's idle timeout to what remains
      getFn: shared.getFn, streamFn: shared.streamFn,
    });
    let result;
    if (typeof totalDeadlineMs === "number") {
      const remaining = totalDeadlineMs - (now() - start);
      if (remaining <= 0) {   // belt — the top-of-loop gate should already have returned
        const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
        return { exit: nh != null ? nh : EXIT.DEADLINE, deadlineExceeded: true, failureClasses };
      }
      const SENTINEL = { __deadline: true };
      let timer;
      const deadlineP = new Promise((res) => { timer = setTimeout(() => res(SENTINEL), remaining); if (timer && timer.unref) timer.unref(); });
      result = await Promise.race([callReview(), deadlineP]);
      clearTimeout(timer);
      if (result === SENTINEL) {
        const nh = failureClasses.find((c) => CHAIN_NEEDS_HUMAN.has(c));
        const exit = nh != null ? nh : EXIT.DEADLINE;
        log(`deadline: Phase-2 backend ${tag} exceeded the ${Math.round(totalDeadlineMs / 1000)}s budget mid-call (exit ${exit})`);
        return { exit, deadlineExceeded: true, failureClasses };
      }
    } else {
      result = await callReview();
    }
    const exit = mapResultExit(result, b.hostSource);
    if (exit === EXIT.OK) {
      // FAFF-194: per-backend shape validation — a malformed OK result (empty, or no recognised
      // `### <severity>:` section) advances to the next backend rather than short-circuiting the whole
      // chain, so a healthy fallback still gets a chance (mirrors every other per-backend fault class).
      const shape = validateFindingsShape(result.content || "");
      if (!shape.ok) {
        failureClasses.push(EXIT.MALFORMED);
        log(`${verb}: ${tag} produced non-findings output (${shape.reason}) (exit ${EXIT.MALFORMED})`);
        continue;
      }
      if (i > 0) log(`backend ${i + 1}/${n} ${tag} produced findings (after ${i} skipped)`);
      return { exit: EXIT.OK, content: result.content || "", truncated: !!result.truncated, winner: b, failureClasses };
    }
    failureClasses.push(exit);
    const detail = (result && result.note) || (result && result.names ? `available: ${result.names.join(", ")}` : "");
    log(`${verb}: ${tag} failed (${result && result.status}${detail ? ": " + detail : ""}) (exit ${exit})`);
  }
  return { exit: chainTerminalExit(failureClasses), failureClasses };
}

// `runReviewFn` is injectable so the CLI exit-mapping (notably the FAFF-227 transport-failed → 5/6 path)
// is unit-testable with a stubbed orchestration result; it defaults to the real runReview for the CLI.
// `checkFn` (FAFF-194) is injectable exactly the same way for the refutation pass's node --check calls,
// so CI spawns nothing unless a test opts in; it defaults to the real realCheck for the CLI.
export async function main(argv, { runReviewFn = runReview, checkFn = realCheck } = {}) {
  const a = parseArgs(argv);
  if (!a.system || !a.diff) {
    process.stderr.write("usage: review-call.mjs (--host H --model M | --backends-json FILE) --system FILE --diff FILE [--context FILE]... [--num-predict N] [--timeout S] [--deadline S] [--host-source config|default] [--provider P] [--api-key-env VAR] [--reasoning-off]\n");
    return EXIT.USAGE;
  }

  // Build the ordered chain (FAFF-232). --backends-json is the COMPLETE chain (a JSON array of backend
  // objects, the skill assembles it from primary scalars + the fallbacks JSON-string); when absent the
  // legacy single-backend flags form a 1-element chain that reproduces the old path byte-for-byte.
  // --backends-json wins when both are present.
  let chain;
  if (a.backendsJson) {
    let raw;
    try { raw = JSON.parse(readFileSync(a.backendsJson, "utf8")); }
    catch (e) { process.stderr.write(`--backends-json: cannot read/parse ${a.backendsJson}: ${e.message}\n`); return EXIT.USAGE; }
    if (!Array.isArray(raw) || raw.length === 0) {
      process.stderr.write("--backends-json must be a non-empty JSON array of backends\n");
      return EXIT.USAGE;
    }
    chain = raw.map((b) => ({
      provider: b.provider, model: b.model, host: b.host,
      hostSource: "config",   // host_source is DERIVED, not authored: every listed backend is explicitly
                              // configured, so it is always "config" (→ unreachable maps to 5/pass+skip,
                              // never 6). The unconfigured-localhost-default (6) only arises in the legacy
                              // single-backend path below, never inside an explicit chain.
      apiKeyEnv: b.api_key_env || b.apiKeyEnv,
      reasoningOff: b.reasoning_off ?? b.reasoningOff ?? false,
      timeoutMs: (b.timeout != null) ? Number(b.timeout) * 1000 : a.timeoutMs,
    }));
  } else {
    if (!a.host || !a.model) {
      process.stderr.write("usage: review-call.mjs --host H --model M ... (or --backends-json FILE)\n");
      return EXIT.USAGE;
    }
    chain = [{
      provider: a.provider, model: a.model, host: a.host, hostSource: a.hostSource,
      apiKeyEnv: a.apiKeyEnv, reasoningOff: a.reasoningOff, timeoutMs: a.timeoutMs,
    }];
  }

  // Resolve each backend's API key from its NAMED env var (never the key on the command line / in config).
  // An unset env for a declared key is flagged per-backend (a class-7 fault that ADVANCES) rather than a
  // whole-run abort — so a misconfigured primary key falls through to a healthy fallback.
  for (const b of chain) {
    if (b.apiKeyEnv) {
      b.apiKey = process.env[b.apiKeyEnv];
      if (!b.apiKey) b.apiKeyMissing = true;
    }
  }

  const system = readFileSync(a.system, "utf8");
  const diff = readFileSync(a.diff, "utf8");
  const contextFiles = a.context.map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
  const user = assembleUserMessage({ contextFiles, diff });

  // FAFF-401: derive mandatory-ness mechanically from the run ledger BEFORE the mandatoryRemap chokepoint,
  // so no model step sits between the resolved L4 level and the flag. The explicit --lights-out flag still
  // FORCES mandatory (OR, never AND — a caller that resolved L4-ness itself is trusted); the explicit
  // --run-dir wins over the ambient FAFF_RUN_DIR env on conflict (mirrors the appetite resolver).
  a.mandatory = a.mandatory || ledgerMandatory(a.runDir ?? process.env.FAFF_RUN_DIR);

  const res = await runReviewChain(chain, { system, user, numPredict: a.numPredict, runReviewFn, totalDeadlineMs: a.totalDeadlineMs });

  if (res.exit === EXIT.OK) {
    if (res.truncated) process.stderr.write("[note] response truncated at token budget even after retry; findings may be partial\n");
    // FAFF-194: refutation pass (machine-checkable syntax claims, downgrade-only) then header
    // normalisation (harness-authored provenance), in that order — both run on the winning content only.
    const { content: refuted, refutations } = refuteFindings(res.content || "", a.context, { checkFn });
    for (const r of refutations) {
      process.stderr.write(`refuted: "${r.title}" — node --check clean on ${r.files.join(", ")}; ${r.from} → observation\n`);
    }
    const hadHeader = HEADER_LINE_RE.test(refuted);
    const winnerProvider = (res.winner && res.winner.provider) || "ollama";
    const winnerModel = res.winner && res.winner.model;
    const finalContent = ensureHeader(refuted, winnerProvider, winnerModel);
    if (!hadHeader) process.stderr.write("normalized: findings header missing — prepended canonical provenance\n");
    process.stdout.write((finalContent || "").trim() + "\n");
    return EXIT.OK;
  }
  // FAFF-398: single-chokepoint mandatory remap. On a MANDATORY review (L4 --lights-out), an exhausted chain
  // that yielded NO opinion (UNREACHABLE/5 or DEADLINE/8) fails CLOSED → MANDATORY_OUTAGE(9 → needs-human).
  // Applied ONCE here on runReviewChain's terminal exit, so every exhaustion path (the three deadline returns
  // + the chain-exhausted return) is covered by construction; config-fault classes (2/4/6/7) pass through.
  const finalExit = mandatoryRemap(res.exit, a.mandatory);
  if (finalExit === EXIT.MANDATORY_OUTAGE) {
    process.stderr.write(`adversarial review: MANDATORY second opinion unavailable — chain exhausted, no opinion obtained (mandatory-chain-outage); exit ${EXIT.MANDATORY_OUTAGE} → needs-human\n`);
  } else if (finalExit === EXIT.DEADLINE) {
    // FAFF-329: a deadline-skip is surfaced loudly (never silent) — its own line so the run log + /faff-wtf see it.
    process.stderr.write(`adversarial review: phase2 skipped-deadline (total wall-clock budget hit before findings); exit ${EXIT.DEADLINE} → pass+skip\n`);
  } else if (chain.length > 1) {
    const provenance = res.exit === EXIT.UNREACHABLE ? "pass+skip"
      : res.exit === EXIT.DEFAULT_HOST_UNREACHABLE ? "needs-human (default host)" : "needs-human";
    process.stderr.write(`adversarial chain exhausted (${chain.length} backends, none produced findings); terminal exit ${res.exit} → ${provenance}\n`);
  }
  return finalExit;
}

if (process.argv[1] && process.argv[1].endsWith("review-call.mjs")) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((e) => { process.stderr.write(`review-call: ${e.message}\n`); process.exitCode = EXIT.OTHER; });
}
