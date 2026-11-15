// Local admission proxy for controlled Claude runs. The CLI is pointed at it through
// ANTHROPIC_BASE_URL, so every model request passes one place that can refuse it before it is sent,
// reserve its worst-case cost, and record provider-reported usage. Credentials pass through to the
// provider and are never written to evidence.
import http from 'node:http';
import https from 'node:https';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalHash } from './schema.mjs';

// Rates confirmed by the operator on 2026-11-14 for FAFF-1199 (main 3bef562a): USD per MTok
// 4 input, 20 output, 5 five-minute write, 8 one-hour write, 0.2 cache read. Held as integer nano-USD
// per token so the 0.2 cache-read rate stays integral.
export const OPUS_5_5_PRICING = Object.freeze({
  model: 'claude-opus-5-5',
  nano_per_token: Object.freeze({ input: 4000, output: 20000, cache_write_5m: 5000, cache_write_1h: 8000, cache_read: 200 }),
  max_input_bytes: 200_000,
  overhead_tokens: 2000,
  source: 'FAFF-1199 operator-confirmed rates, 2026-11-14',
});
const SENSITIVE = /^(authorization|x-api-key|cookie|proxy-authorization)$/i;
const DROP_UPSTREAM = new Set(['host', 'content-length', 'accept-encoding', 'connection']);
const DROP_DOWNSTREAM = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection']);
const PRICED_GEO = new Set(['', 'global']);

export function costNanos(usage, pricing) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return null;
  if (usage.speed !== undefined && usage.speed !== 'standard') return null;
  if (usage.inference_geo !== undefined && !PRICED_GEO.has(usage.inference_geo)) return null;
  if (Object.values(usage.server_tool_use ?? {}).some(v => v > 0)) return null;
  const r = pricing.nano_per_token;
  const writes = usage.cache_creation_input_tokens ?? 0;
  const short = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const long = Math.max(writes - short, usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  return usage.input_tokens * r.input + usage.output_tokens * r.output + short * r.cache_write_5m + long * r.cache_write_1h + (usage.cache_read_input_tokens ?? 0) * r.cache_read;
}

// Every input byte is counted as a token at the highest input rate (a one-hour cache write), plus a
// fixed allowance for provider-side templating, plus the whole output ceiling.
export function reservationNanos({ bodyBytes, maxTokens }, pricing) {
  const r = pricing.nano_per_token;
  return (bodyBytes + pricing.overhead_tokens) * Math.max(r.input, r.cache_write_5m, r.cache_write_1h) + maxTokens * r.output;
}

const mergeMax = (into, from) => {
  for (const [k, v] of Object.entries(from ?? {})) {
    if (typeof v === 'number') into[k] = Math.max(into[k] ?? 0, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) into[k] = mergeMax({ ...(into[k] ?? {}) }, v);
    else into[k] = v;
  }
  return into;
};

export function parseSse(text) {
  const out = { id: null, model: null, usage: null, stop_reason: null, complete: false, malformed: 0, stream_error: false };
  try {
    const message = JSON.parse(text);
    if (message?.type === 'message') return { ...out, id: message.id, model: message.model, usage: message.usage ?? null, stop_reason: message.stop_reason, complete: Boolean(message.usage) };
  } catch { /* streamed */ }
  let start = false;
  let delta = false;
  let stop = false;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
    if (!data) continue;
    let event;
    try { event = JSON.parse(data); } catch { out.malformed++; continue; }
    if (event.type === 'message_start') {
      start = true;
      out.id = event.message?.id ?? null;
      out.model = event.message?.model ?? null;
      out.usage = mergeMax({}, event.message?.usage);
    } else if (event.type === 'message_delta') {
      delta = true;
      out.usage = mergeMax(out.usage ?? {}, event.usage);
      out.stop_reason = event.delta?.stop_reason ?? out.stop_reason;
    } else if (event.type === 'message_stop') stop = true;
    else if (event.type === 'error') out.stream_error = true;
  }
  out.complete = start && delta && stop && out.malformed === 0 && !out.stream_error;
  return out;
}

export function createLedger(path, allowanceNanos) {
  if (allowanceNanos !== undefined) {
    if (existsSync(path)) throw new Error(`Ledger already exists at ${path}`);
    if (!Number.isSafeInteger(allowanceNanos) || allowanceNanos < 0) throw new Error('Allowance must be a non-negative safe integer');
    writeFileSync(path, JSON.stringify({ schema: 2, allowance_nanos: allowanceNanos, entries: [] }, null, 2) + '\n');
  }
  const read = () => JSON.parse(readFileSync(path, 'utf8'));
  const write = v => { writeFileSync(`${path}.tmp`, JSON.stringify(v, null, 2) + '\n'); renameSync(`${path}.tmp`, path); };
  const remainingOf = v => v.allowance_nanos - v.entries.reduce((sum, e) => sum + (e.state === 'reconciled' ? e.actual_nanos : e.reserved_nanos), 0);
  return {
    path,
    remaining: () => remainingOf(read()),
    blocked: () => read().entries.some(e => e.state === 'held'),
    reserve(nanos) {
      const v = read();
      if (v.entries.some(e => e.state === 'held') || nanos > remainingOf(v)) return null;
      const id = `r${v.entries.length + 1}`;
      v.entries.push({ id, reserved_nanos: nanos, actual_nanos: null, state: 'open' });
      write(v);
      return id;
    },
    reconcile(id, actualNanos) {
      const v = read();
      const e = v.entries.find(x => x.id === id);
      if (!e || e.state !== 'open') throw new Error(`No open reservation ${id}`);
      if (actualNanos === null) e.state = 'held';
      else Object.assign(e, { actual_nanos: actualNanos, state: 'reconciled' });
      write(v);
    },
    entries: () => read().entries,
  };
}

export function anthropicUpstream({ host = 'api.anthropic.com' } = {}) {
  return req => new Promise((resolve, reject) => {
    const r = https.request({ host, path: req.path, method: req.method, headers: { ...req.headers, 'content-length': Buffer.byteLength(req.body) } }, res => resolve({ status: res.statusCode, headers: res.headers, body: res }));
    r.on('error', reject);
    r.end(req.body);
  });
}

const chunksOf = async function* (body) {
  if (typeof body === 'string' || Buffer.isBuffer(body)) { yield Buffer.from(body); return; }
  for await (const chunk of body) yield Buffer.from(chunk);
};

export async function startProxy({ model, effort, limits, pricing, ledger, allowedTools, evidenceDir, mode = 'forward', upstream = anthropicUpstream(), onStop = () => {} }) {
  mkdirSync(evidenceDir, { recursive: true });
  const state = { stop: null, admitted: 0, seen: 0, requests: [], captured: [], other_paths: [], request_runtime: null };
  const stop = reason => { if (!state.stop) { state.stop = reason; onStop(reason); } };
  const refuse = (res, reason) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: `control-parity proxy refused: ${reason}` } }));
  };
  const evidence = (n, suffix, content) => writeFileSync(join(evidenceDir, `${String(n).padStart(3, '0')}.${suffix}`), content);

  const handle = async (req, res) => {
    const url = new URL(req.url, 'http://proxy');
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      state.other_paths.push(`${req.method} ${url.pathname}`);
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"type":"error","error":{"type":"not_found_error","message":"control-parity proxy serves /v1/messages only"}}');
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const n = ++state.seen;
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !SENSITIVE.test(k)));
    const credential_headers = Object.keys(req.headers).filter(k => SENSITIVE.test(k));
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { body = null; }
    evidence(n, 'request.json', JSON.stringify({ n, path: req.url, headers, credential_headers, body_bytes: raw.length, body }, null, 2) + '\n');
    if (state.stop) return refuse(res, state.stop);
    if (!body) { stop('malformed-request'); return refuse(res, 'malformed-request'); }
    if (mode === 'capture-refuse') {
      state.captured.push({ path: req.url, headers, credential_headers, body_bytes: raw.length, body });
      stop('probe-captured');
      return refuse(res, 'probe-captured');
    }
    const tools = (body.tools ?? []).map(t => t.name);
    const { messages, metadata, ...runtime } = body;
    if (metadata) { runtime.metadata = { ...metadata }; delete runtime.metadata.user_id; }
    let requestRuntime;
    try { requestRuntime = canonicalHash(runtime); }
    catch { stop('invalid-runtime'); return refuse(res, 'invalid-runtime'); }
    const reason = body.model !== model ? 'model-mismatch'
      : effort !== undefined && body.output_config?.effort !== effort ? 'effort-mismatch'
      : !(body.max_tokens <= limits.output_tokens) ? 'output-ceiling'
      : tools.some(t => !allowedTools.includes(t)) ? 'tool-escape'
      : state.request_runtime && state.request_runtime !== requestRuntime ? 'runtime-changed'
      : state.admitted >= limits.turns ? 'turn-limit'
      : raw.length > pricing.max_input_bytes ? 'pricing-unknown'
      : null;
    if (reason) { stop(reason); return refuse(res, reason); }
    state.request_runtime ??= requestRuntime;
    const reservation = reservationNanos({ bodyBytes: raw.length, maxTokens: body.max_tokens }, pricing);
    const reservationId = ledger.reserve(reservation);
    if (!reservationId) { stop(ledger.blocked() ? 'usage-missing' : 'allowance'); return refuse(res, state.stop); }
    state.admitted++;
    const entry = { n, requested_model: body.model, reservation_nanos: reservation, reservation_id: reservationId, status: null, id: null, served_model: null, usage: null, cost_nanos: null };
    state.requests.push(entry);

    const forwardHeaders = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !DROP_UPSTREAM.has(k)));
    let reply;
    try {
      reply = await upstream({ method: 'POST', path: req.url, headers: forwardHeaders, body: raw });
    } catch (error) {
      ledger.reconcile(reservationId, null);
      stop('upstream-unreachable');
      evidence(n, 'response.txt', String(error?.message));
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end('{"type":"error","error":{"type":"api_error","message":"control-parity proxy: upstream unreachable"}}');
      return;
    }
    entry.status = reply.status;
    res.writeHead(reply.status, Object.fromEntries(Object.entries(reply.headers ?? {}).filter(([k]) => !DROP_DOWNSTREAM.has(k))));
    const received = [];
    let streamError = null;
    try { for await (const chunk of chunksOf(reply.body)) { received.push(chunk); res.write(chunk); } }
    catch (error) { streamError = String(error?.code ?? 'stream-error'); }
    const text = Buffer.concat(received).toString('utf8');
    evidence(n, 'response.txt', text);
    entry.transport_error = streamError;
    if (reply.status !== 200) {
      ledger.reconcile(reservationId, null);
      stop('upstream-error');
      res.end();
      return;
    }
    const parsed = parseSse(text);
    Object.assign(entry, { id: parsed.id, served_model: parsed.model, usage: parsed.usage });
    entry.cost_nanos = parsed.complete && !streamError ? costNanos(parsed.usage, pricing) : null;
    ledger.reconcile(reservationId, entry.cost_nanos);
    if (parsed.stream_error || streamError) stop('upstream-stream-error');
    else if (!parsed.complete) stop('usage-missing');
    else if (entry.cost_nanos === null) stop('pricing-unknown');
    else if (parsed.model !== model) stop('served-model-mismatch');
    res.end();
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      stop('proxy-error');
      if (!res.headersSent) res.writeHead(500);
      res.end(String(error?.message));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }),
    summary: () => ({
      stop: state.stop,
      requests: state.requests.map(({ reservation_id, ...rest }) => rest),
      usage_complete: state.requests.every(r => r.cost_nanos !== null),
      served_models: [...new Set(state.requests.map(r => r.served_model).filter(Boolean))],
      captured: state.captured,
      other_paths: state.other_paths,
    }),
  };
}
