// Fake-process and fake-upstream checks only. CI makes no model calls from this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPUS_5_5_PRICING, costNanos, createLedger, parseSse, reservationNanos, startProxy } from '../eval/control-parity/proxy.mjs';
import { DEFAULT_LIMITS, buildClaudeInvocation, buildPromptBundle, parseStreamJson, probeClaude, runClaudeScenario, runtimeFingerprint } from '../eval/control-parity/claude-driver.mjs';
import { TOOL_NAMES, handleMessage } from '../eval/control-parity/tool-server.mjs';
import { createFixtureTracker } from '../eval/control-parity/tracker.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'cp-claude-'));
const sse = events => events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const START = (id = 'msg_1', model = 'claude-opus-5-5') => ({ type: 'message_start', message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 100 }, output_tokens: 1 } } });
const DELTA = { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 250 } };
const STOP = { type: 'message_stop' };
const CAPTURED = sse([START(), { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }, DELTA, STOP]);

test('the default limits match the plan', () => {
  assert.deepEqual(DEFAULT_LIMITS, { attempts: 5, turns: 12, output_tokens: 8192, attempt_ms: 600000, batch_ms: 3600000, allowance_nanos: 10_000_000_000, workers: 1, retries: 0 });
});

test('a captured usage fixture reconciles by hand and by parser', () => {
  const parsed = parseSse(CAPTURED);
  assert.equal(parsed.complete, true);
  assert.equal(parsed.id, 'msg_1');
  assert.equal(parsed.model, 'claude-opus-5-5');
  assert.equal(parsed.usage.output_tokens, 250);
  // 10 input x 4000 + 100 one-hour writes x 8000 + 1000 reads x 200 + 250 output x 20000 nano-USD
  assert.equal(costNanos(parsed.usage, OPUS_5_5_PRICING), 40_000 + 800_000 + 200_000 + 5_000_000);
});

test('an SSE stream without its final delta is incomplete and has no cost', () => {
  const parsed = parseSse(sse([START()]));
  assert.equal(parsed.complete, false);
  assert.equal(costNanos(null, OPUS_5_5_PRICING), null);
});

test('an in-stream provider error cannot be hidden by a later message stop', async () => {
  const body = sse([START(), DELTA, { type: 'error', error: { type: 'overloaded_error', message: 'interrupted' } }, STOP]);
  assert.equal(parseSse(body).complete, false);
  const { proxy, ledger, stops } = await proxyWith({ upstream: fakeUpstream([{ status: 200, body }]) });
  try {
    await (await post(proxy.url, request())).text();
    assert.equal(proxy.summary().usage_complete, false);
    assert.equal(ledger.blocked(), true);
    assert.deepEqual(stops, ['upstream-stream-error']);
  } finally { await proxy.close(); }
});

test('unpriced usage dimensions make cost unknown rather than zero', () => {
  const base = parseSse(CAPTURED).usage;
  for (const extra of [{ speed: 'fast' }, { inference_geo: 'eu' }, { server_tool_use: { web_search_requests: 1 } }]) {
    assert.equal(costNanos({ ...base, ...extra }, OPUS_5_5_PRICING), null, JSON.stringify(extra));
  }
  assert.equal(costNanos({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, OPUS_5_5_PRICING), 0);
});

test('cache writes without a TTL breakdown are priced at the one-hour rate', () => {
  assert.equal(costNanos({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 10 }, OPUS_5_5_PRICING), 80_000);
});

test('the reservation bounds every input byte at the highest input rate plus the full output ceiling', () => {
  assert.equal(reservationNanos({ bodyBytes: 3000, maxTokens: 8192 }, OPUS_5_5_PRICING), (3000 + 2000) * 8000 + 8192 * 20000);
});

test('the ledger reserves, reconciles, refuses overspend and holds an unreconciled reservation', () => {
  const path = join(tmp(), 'ledger.json');
  const ledger = createLedger(path, 1000);
  const a = ledger.reserve(600);
  assert.ok(a);
  assert.equal(ledger.reserve(600), null);
  ledger.reconcile(a, 100);
  assert.equal(ledger.remaining(), 900);
  const b = ledger.reserve(300);
  ledger.reconcile(b, null);
  assert.equal(ledger.blocked(), true);
  assert.equal(ledger.reserve(1), null);
  const reopened = createLedger(path);
  assert.equal(reopened.remaining(), 600);
  assert.equal(reopened.blocked(), true);
  assert.throws(() => createLedger(path, 5), /exists/);
});

test('duplicate streamed usage records aggregate by request identity, not by summing copies', () => {
  const lines = [
    { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
    { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
    { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
    { type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', usage: { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.0123, num_turns: 2 },
  ].map(l => JSON.stringify(l)).join('\n') + '\n';
  const parsed = parseStreamJson(lines);
  assert.deepEqual(parsed.requests.map(r => [r.id, r.usage.output_tokens]), [['msg_1', 40], ['msg_2', 7]]);
  assert.deepEqual(parsed.served_models, ['claude-opus-5-5']);
  assert.equal(parsed.cli_reported_cost_usd, '0.0123');
  assert.equal(parsed.result.subtype, 'success');
});

test('malformed, truncated and cost-less CLI output stays visible', () => {
  const truncated = parseStreamJson('{"type":"system"}\n{"type":"assist');
  assert.equal(truncated.result, null);
  assert.equal(truncated.malformed.length, 1);
  const noCost = parseStreamJson('{"type":"result","subtype":"success"}\n');
  assert.equal(noCost.cli_reported_cost_usd, null);
  const zero = parseStreamJson('{"type":"result","subtype":"success","total_cost_usd":0}\n');
  assert.equal(zero.cli_reported_cost_usd, '0');
});

const HELP = ['--model', '--effort <level>  (low, medium, high, xhigh, max)', '--tools', '--strict-mcp-config', '--mcp-config', '--output-format', 'stream-json', '--system-prompt', '--permission-mode', 'dontAsk', '--no-session-persistence', '--setting-sources', '--allowedTools', '--verbose'].join('\n');
const execFake = map => (bin, args) => {
  const key = args.join(' ');
  if (!(key in map)) { const e = new Error(`spawn ${bin} ENOENT`); e.code = 'ENOENT'; throw e; }
  return map[key];
};

test('probe reports a missing binary as unavailable', () => {
  const caps = probeClaude({ binary: 'nope', model: 'claude-opus-5-5', effort: 'medium', exec: execFake({}) });
  assert.equal(caps.available, false);
  assert.match(caps.reasons.join(' '), /ENOENT/);
});

test('probe rejects an effort the CLI does not list and missing isolation flags', () => {
  const caps = probeClaude({ binary: 'claude', model: 'claude-opus-5-5', effort: 'turbo', exec: execFake({ '--version': '2.1.311 (Claude Code)\n', '--help': HELP }) });
  assert.equal(caps.available, false);
  assert.match(caps.reasons.join(' '), /effort/);
  const noStrict = probeClaude({ binary: 'claude', model: 'claude-opus-5-5', effort: 'medium', exec: execFake({ '--version': '2.1.311 (Claude Code)\n', '--help': HELP.replace('--strict-mcp-config', '') }) });
  assert.equal(noStrict.available, false);
  assert.match(noStrict.reasons.join(' '), /strict-mcp-config/);
});

test('probe accepts a capable CLI but leaves the model unverified until a served-model observation', () => {
  const caps = probeClaude({ binary: 'claude', model: 'claude-opus-5-5', effort: 'medium', exec: execFake({ '--version': '2.1.311 (Claude Code)\n', '--help': HELP }) });
  assert.equal(caps.available, true);
  assert.equal(caps.version, '2.1.311');
  assert.equal(caps.model_status, 'unverified');
  assert.equal(caps.max_turns_flag, false);
});

const paths = d => ({ configDir: join(d, 'cfg'), cwd: join(d, 'work'), home: join(d, 'home'), mcpConfig: join(d, 'mcp.json') });

test('the invocation restricts every effect to fixture tools and scrubs the parent environment', () => {
  const bundle = buildPromptBundle({ policyBytes: Buffer.from('RULES'), input: { issue_id: 'ISS-1', faff_body: 'B', reason_codes: ['created', 'blocked'] } });
  const inv = buildClaudeInvocation({ binary: 'claude', settings: { model: 'claude-opus-5-5', effort: 'medium' }, promptBundle: bundle, paths: paths('/x'), proxyUrl: 'http://127.0.0.1:9', limits: DEFAULT_LIMITS, parentEnv: { PATH: '/bin', GH_TOKEN: 'secret', ANTHROPIC_API_KEY: 'k', SSH_AUTH_SOCK: '/s' } });
  const flag = f => inv.args[inv.args.indexOf(f) + 1];
  assert.equal(flag('--tools'), '');
  assert.ok(inv.args.includes('--strict-mcp-config'));
  assert.equal(flag('--mcp-config'), '/x/mcp.json');
  assert.equal(flag('--allowedTools'), TOOL_NAMES.map(t => `mcp__tracker__${t}`).join(','));
  assert.equal(flag('--permission-mode'), 'dontAsk');
  assert.equal(flag('--setting-sources'), '');
  assert.equal(flag('--model'), 'claude-opus-5-5');
  assert.equal(flag('--effort'), 'medium');
  assert.equal(flag('--output-format'), 'stream-json');
  assert.equal(flag('--system-prompt'), bundle.system);
  assert.equal(inv.args.at(-1), bundle.user);
  assert.ok(inv.args.includes('--no-session-persistence'));
  assert.deepEqual(Object.keys(inv.env).sort(), ['ANTHROPIC_BASE_URL', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'DISABLE_TELEMETRY', 'HOME', 'PATH']);
  assert.equal(inv.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '8192');
  assert.equal(inv.cwd, '/x/work');
});

test('only the one declared credential variable reaches the child, and no credential file is used', () => {
  const bundle = buildPromptBundle({ policyBytes: Buffer.from('R'), input: { issue_id: 'I', faff_body: 'B', reason_codes: ['blocked'] } });
  const parentEnv = { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'oat', ANTHROPIC_API_KEY: 'key', GH_TOKEN: 'gh' };
  const inv = buildClaudeInvocation({ settings: { model: 'm', effort: 'medium', credential_env: 'CLAUDE_CODE_OAUTH_TOKEN' }, promptBundle: bundle, paths: paths('/x'), proxyUrl: 'http://p', limits: DEFAULT_LIMITS, parentEnv });
  assert.equal(inv.env.CLAUDE_CODE_OAUTH_TOKEN, 'oat');
  assert.equal(inv.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(inv.env.GH_TOKEN, undefined);
  assert.throws(() => buildClaudeInvocation({ settings: { model: 'm', effort: 'medium', credential_env: 'GH_TOKEN' }, promptBundle: bundle, paths: paths('/x'), proxyUrl: 'http://p', limits: DEFAULT_LIMITS, parentEnv }), /credential/);
  assert.throws(() => buildClaudeInvocation({ settings: { model: 'm', effort: 'medium', credential_env: 'ANTHROPIC_API_KEY' }, promptBundle: bundle, paths: paths('/x'), proxyUrl: 'http://p', limits: DEFAULT_LIMITS, parentEnv: { PATH: '/bin' } }), /not set/);
});

test('the adapter has no credential-file parameter', async () => {
  const source = readFileSync(new URL('../eval/control-parity/claude-driver.mjs', import.meta.url), 'utf8');
  assert.ok(!source.includes('.credentials.json'), 'copying a refreshable credential file rotates the operator\'s refresh token');
});

test('the prompt bundle binds exact skill bytes and declares its load closure', () => {
  const policy = Buffer.from('### Rules\nexact bytes\n\n');
  const bundle = buildPromptBundle({ policyBytes: policy, input: { issue_id: 'ISS-1', faff_body: 'line1\nline2', reason_codes: ['created'] } });
  assert.ok(bundle.user.includes(policy.toString('utf8')));
  assert.ok(bundle.user.includes('line1\nline2'));
  assert.ok(!bundle.system.includes('exact bytes'));
  assert.deepEqual(bundle.load_closure.loaded, ['plugin/skills/faff/references/review.md#review-findings-comment-identity']);
  assert.ok(bundle.load_closure.referenced_not_loaded.length >= 2);
  assert.match(bundle.hashes.prompt_sha256, /^[a-f0-9]{64}$/);
  assert.match(bundle.hashes.harness_sha256, /^[a-f0-9]{64}$/);
});

test('candidate invocation exposes exactly one extra planner tool and declares it in the harness', () => {
  const input = { issue_id: 'ISS-1', faff_body: 'B', reason_codes: ['created'] };
  const base = buildPromptBundle({ policyBytes: Buffer.from('R'), input });
  const bundle = buildPromptBundle({ policyBytes: Buffer.from('R'), input, candidate: true });
  assert.equal(bundle.user, base.user);
  assert.ok(bundle.system.includes('plan_review_comment'));
  const inv = buildClaudeInvocation({ settings: { model: 'm', effort: 'medium' }, promptBundle: bundle, paths: paths('/x'), proxyUrl: 'http://p', limits: DEFAULT_LIMITS, parentEnv: {} });
  assert.deepEqual(inv.args[inv.args.indexOf('--allowedTools') + 1].split(','), [...TOOL_NAMES, 'plan_review_comment'].map(n => `mcp__tracker__${n}`));
});

// --- admission proxy ------------------------------------------------------------------------

const fakeUpstream = (responses) => {
  const seen = [];
  const fn = async req => {
    seen.push(req);
    const next = responses.shift() ?? { status: 200, body: CAPTURED };
    return { status: next.status, headers: { 'content-type': 'text/event-stream' }, body: next.body };
  };
  fn.seen = seen;
  return fn;
};
const request = (overrides = {}) => ({ model: 'claude-opus-5-5', max_tokens: 8192, stream: true, tools: [{ name: 'mcp__tracker__list_comments' }], messages: [{ role: 'user', content: 'x' }], ...overrides });
const post = (url, body) => fetch(`${url}/v1/messages?beta=true`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test' }, body: JSON.stringify(body) });
const proxyWith = async ({ upstream = fakeUpstream([]), mode = 'forward', allowance = 10_000_000_000, turns = 12, stops = [] } = {}) => {
  const dir = tmp();
  const ledger = createLedger(join(dir, 'ledger.json'), allowance);
  const proxy = await startProxy({ model: 'claude-opus-5-5', limits: { ...DEFAULT_LIMITS, turns }, pricing: OPUS_5_5_PRICING, ledger, allowedTools: ['mcp__tracker__list_comments'], evidenceDir: join(dir, 'requests'), mode, upstream, onStop: r => stops.push(r) });
  return { proxy, ledger, dir, upstream, stops };
};

test('the proxy forwards, meters provider usage and reconciles the reservation', async () => {
  const { proxy, ledger, dir, upstream } = await proxyWith();
  try {
    const res = await post(proxy.url, request());
    assert.equal(res.status, 200);
    assert.equal(await res.text(), CAPTURED);
    const s = proxy.summary();
    assert.equal(s.requests.length, 1);
    assert.equal(s.requests[0].cost_nanos, 6_040_000);
    assert.equal(s.usage_complete, true);
    assert.deepEqual(s.served_models, ['claude-opus-5-5']);
    assert.equal(ledger.remaining(), 10_000_000_000 - 6_040_000);
    assert.equal(upstream.seen[0].headers.authorization, 'Bearer test');
    assert.ok(readdirSync(join(dir, 'requests')).some(f => f.endsWith('.request.json')));
    assert.ok(!readFileSync(join(dir, 'requests', readdirSync(join(dir, 'requests')).find(f => f.endsWith('.request.json'))), 'utf8').includes('Bearer test'), 'credentials never reach evidence');
  } finally { await proxy.close(); }
});

for (const [name, body, reason] of [
  ['a changed model', request({ model: 'claude-haiku-5-5' }), 'model-mismatch'],
  ['an output ceiling above the limit', request({ max_tokens: 32000 }), 'output-ceiling'],
  ['a tool outside the fixture ports', request({ tools: [{ name: 'Bash' }, { name: 'mcp__tracker__list_comments' }] }), 'tool-escape'],
]) {
  test(`the proxy refuses ${name}, never forwards it, and stays closed`, async () => {
    const { proxy, upstream, stops } = await proxyWith();
    try {
      const res = await post(proxy.url, body);
      assert.equal(res.status, 400);
      assert.deepEqual(stops, [reason]);
      assert.equal(upstream.seen.length, 0);
      assert.equal((await post(proxy.url, request())).status, 400, 'a retry after a stop is refused too');
      assert.equal(upstream.seen.length, 0);
      assert.equal(proxy.summary().stop, reason);
    } finally { await proxy.close(); }
  });
}

test('the proxy enforces the turn limit before the excess request is sent', async () => {
  const { proxy, upstream, stops } = await proxyWith({ turns: 2 });
  try {
    for (let i = 0; i < 2; i++) assert.equal((await post(proxy.url, request())).status, 200);
    assert.equal((await post(proxy.url, request())).status, 400);
    assert.equal(upstream.seen.length, 2);
    assert.deepEqual(stops, ['turn-limit']);
  } finally { await proxy.close(); }
});

test('the proxy refuses a request whose worst-case cost exceeds the remaining allowance', async () => {
  const { proxy, upstream, stops } = await proxyWith({ allowance: 1000 });
  try {
    assert.equal((await post(proxy.url, request())).status, 400);
    assert.equal(upstream.seen.length, 0);
    assert.deepEqual(stops, ['allowance']);
  } finally { await proxy.close(); }
});

test('a response without usage keeps its reservation and blocks the next request', async () => {
  const { proxy, ledger, upstream, stops } = await proxyWith({ upstream: fakeUpstream([{ status: 200, body: sse([START()]) }]) });
  try {
    await (await post(proxy.url, request())).text();
    assert.equal(ledger.blocked(), true);
    assert.equal(proxy.summary().usage_complete, false);
    assert.deepEqual(stops, ['usage-missing']);
    assert.equal((await post(proxy.url, request())).status, 400);
    assert.equal(upstream.seen.length, 1);
  } finally { await proxy.close(); }
});

test('an upstream error stops the attempt instead of letting the CLI retry', async () => {
  const { proxy, upstream, stops } = await proxyWith({ upstream: fakeUpstream([{ status: 529, body: '{"type":"error","error":{"type":"overloaded_error"}}' }]) });
  try {
    assert.equal((await post(proxy.url, request())).status, 529);
    assert.deepEqual(stops, ['upstream-error']);
    assert.equal((await post(proxy.url, request())).status, 400);
    assert.equal(upstream.seen.length, 1);
  } finally { await proxy.close(); }
});

test('a served model that differs from the requested model stops the attempt', async () => {
  const { proxy, stops } = await proxyWith({ upstream: fakeUpstream([{ status: 200, body: sse([START('msg_1', 'claude-sonnet-5-5'), DELTA, STOP]) }]) });
  try {
    await (await post(proxy.url, request())).text();
    assert.deepEqual(stops, ['served-model-mismatch']);
    assert.deepEqual(proxy.summary().served_models, ['claude-sonnet-5-5']);
  } finally { await proxy.close(); }
});

test('capture-refuse mode records the request, spends nothing and never forwards', async () => {
  const { proxy, ledger, upstream, dir } = await proxyWith({ mode: 'capture-refuse' });
  try {
    assert.equal((await post(proxy.url, request())).status, 400);
    assert.equal(upstream.seen.length, 0);
    assert.equal(ledger.remaining(), 10_000_000_000);
    assert.equal(proxy.summary().captured.length, 1);
    assert.equal(proxy.summary().captured[0].body.max_tokens, 8192);
    assert.ok(readdirSync(join(dir, 'requests')).length >= 1);
  } finally { await proxy.close(); }
});

test('non-message endpoints are refused and recorded', async () => {
  const { proxy, upstream } = await proxyWith();
  try {
    assert.equal((await fetch(`${proxy.url}/v1/models`)).status, 404);
    assert.equal(upstream.seen.length, 0);
    assert.deepEqual(proxy.summary().other_paths, ['GET /v1/models']);
  } finally { await proxy.close(); }
});

// --- MCP tool server ------------------------------------------------------------------------

const trackerDir = () => {
  const dir = tmp();
  createFixtureTracker({ directory: dir, issueId: 'ISS-1', initialState: { comments: [], next_comment_id: 'ISS-1-c9', now: '2026-11-15T12:00:00Z' } });
  return dir;
};

test('the tool server lists exactly the fixture ports', async () => {
  const tracker = createFixtureTracker({ directory: trackerDir() });
  const init = await handleMessage(tracker, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'tracker');
  const list = await handleMessage(tracker, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(t => t.name), TOOL_NAMES);
  assert.equal(await handleMessage(tracker, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('an unknown tool attempt is preserved by the recorder', async () => {
  const tracker = createFixtureTracker({ directory: trackerDir() });
  const response = await handleMessage(tracker, { id: 1, method: 'tools/call', params: { name: 'run_shell', arguments: { command: 'ignored' } } });
  assert.equal(response.result.isError, true);
  assert.ok(tracker.readEvents().some(e => e.kind === 'protocol-violation' && e.reason === 'unknown-tool' && e.op === 'run_shell'));
});

test('tool calls reach the recorder and tracker errors return as tool errors', async () => {
  const dir = trackerDir();
  const tracker = createFixtureTracker({ directory: dir });
  const ok = await handleMessage(tracker, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_comment', arguments: { issue_id: 'ISS-1', body: 'hello' } } });
  assert.equal(ok.result.isError, false);
  const bad = await handleMessage(tracker, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'save_comment', arguments: { id: 'missing', body: 'x' } } });
  assert.equal(bad.result.isError, true);
  const unknown = await handleMessage(tracker, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_shell', arguments: {} } });
  assert.equal(unknown.result.isError, true);
  assert.deepEqual(createFixtureTracker({ directory: dir }).readEvents().map(e => e.kind), ['effect-attempt', 'effect-result', 'effect-attempt', 'effect-result', 'protocol-violation']);
});

// --- process lifecycle ----------------------------------------------------------------------

const fakeProcess = ({ stdout = '', stderr = '', code = 0, signal = null, hang = false } = {}) => {
  const calls = { killed: [] };
  const spawnProcess = () => {
    const out = new PassThrough();
    const err = new PassThrough();
    const exit = new EventEmitter();
    let done;
    const waited = new Promise(r => { done = r; });
    setImmediate(() => {
      out.end(stdout); err.end(stderr);
      if (!hang) done({ code, signal });
    });
    return { pid: 4242, stdout: out, stderr: err, wait: () => waited, killGroup: sig => { calls.killed.push(sig); done({ code: null, signal: sig }); }, exit };
  };
  spawnProcess.calls = calls;
  return spawnProcess;
};
const SUCCESS_STDOUT = [
  { type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: TOOL_NAMES.map(t => `mcp__tracker__${t}`) },
  { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  { type: 'result', subtype: 'success', total_cost_usd: 0.001, num_turns: 1 },
].map(l => JSON.stringify(l)).join('\n') + '\n';
const fakeProxy = (summary = {}) => async () => ({ url: 'http://127.0.0.1:1', close: async () => {}, summary: () => ({ requests: [{ id: 'msg_1' }], stop: null, usage_complete: true, served_models: ['claude-opus-5-5'], captured: [], other_paths: [], ...summary }) });

const runFake = async (proc, { limits = DEFAULT_LIMITS, proxy = fakeProxy() } = {}) => {
  const evidence = tmp();
  const result = await runClaudeScenario({
    trackerDirectory: trackerDir(), input: { issue_id: 'ISS-1', faff_body: 'B', reason_codes: ['created'] }, policyBytes: Buffer.from('RULES'),
    settings: { model: 'claude-opus-5-5', effort: 'medium', binary: 'claude' }, limits, evidenceDirectory: evidence,
    ledger: createLedger(join(evidence, 'ledger.json'), DEFAULT_LIMITS.allowance_nanos), spawnProcess: proc, startProxy: proxy,
  });
  const record = JSON.parse(readFileSync(join(evidence, 'attempt.json'), 'utf8'));
  assert.ok(existsSync(join(evidence, 'stdout.jsonl')) && existsSync(join(evidence, 'stderr.txt')), 'raw output retained');
  return { result, record, evidence };
};

test('a clean run returns provider accounting and records the attempt', async () => {
  const { result, record } = await runFake(fakeProcess({ stdout: SUCCESS_STDOUT }));
  assert.equal(result.stop, null);
  assert.deepEqual(result.accounting, { usage_complete: true, served_models: ['claude-opus-5-5'], requests: 1 });
  assert.equal(record.exit.code, 0);
  assert.equal(record.stop, null);
});

for (const [name, record, reason] of [
  ['retry', { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 1000, error_status: 529 }, 'cli-retry'],
  ['synthetic error', { type: 'assistant', error: 'unknown', message: { id: 'synthetic-error', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'API Error: interrupted' }] } }, 'cli-stream-error'],
]) {
  test(`a CLI ${name} cannot be hidden by a later success result`, async () => {
    const { result } = await runFake(fakeProcess({ stdout: JSON.stringify(record) + '\n' + SUCCESS_STDOUT }));
    assert.equal(result.stop?.reason, reason);
  });
}

for (const [name, proc, reason] of [
  ['a non-zero exit', fakeProcess({ stdout: SUCCESS_STDOUT, code: 1 }), 'process-exit'],
  ['malformed output', fakeProcess({ stdout: SUCCESS_STDOUT + '{"type":"assis\n' }), 'malformed-output'],
  ['a missing final record', fakeProcess({ stdout: SUCCESS_STDOUT.split('\n').slice(0, 2).join('\n') + '\n' }), 'missing-result'],
  ['a signal', fakeProcess({ stdout: SUCCESS_STDOUT, code: null, signal: 'SIGINT' }), 'signal'],
]) {
  test(`${name} stops the attempt with evidence retained`, async () => {
    const { result, record } = await runFake(proc);
    assert.equal(result.stop.reason, reason);
    assert.equal(record.stop.reason, reason);
  });
}

test('a hung process is killed by process group at the attempt deadline', async () => {
  const proc = fakeProcess({ hang: true });
  const { result } = await runFake(proc, { limits: { ...DEFAULT_LIMITS, attempt_ms: 20 } });
  assert.equal(result.stop.reason, 'timeout');
  assert.deepEqual(proc.calls.killed.slice(0, 1), ['SIGTERM']);
});

test('a proxy stop kills the process and surfaces the proxy reason', async () => {
  const proc = fakeProcess({ hang: true });
  const proxy = async ({ onStop }) => { setTimeout(() => onStop('turn-limit'), 5); return fakeProxy({ stop: 'turn-limit' })(); };
  const { result } = await runFake(proc, { proxy });
  assert.equal(result.stop.reason, 'turn-limit');
  assert.ok(proc.calls.killed.includes('SIGTERM'));
});

test('missing provider usage is reported as incomplete accounting', async () => {
  const { result } = await runFake(fakeProcess({ stdout: SUCCESS_STDOUT }), { proxy: fakeProxy({ usage_complete: false }) });
  assert.equal(result.accounting.usage_complete, false);
});

test('the proxy admits the fixture tools plus only the declared CLI placeholder', async () => {
  let allowed;
  const proxy = async args => { allowed = args.allowedTools; return fakeProxy()(); };
  await runFake(fakeProcess({ stdout: SUCCESS_STDOUT }), { proxy });
  assert.deepEqual(allowed, [...TOOL_NAMES.map(t => `mcp__tracker__${t}`), 'DeferredToolPlaceholder']);
});

test('the proxy refuses a request whose effort differs from the configured effort', async () => {
  const dir = tmp();
  const stops = [];
  const upstream = fakeUpstream([]);
  const proxy = await startProxy({ model: 'claude-opus-5-5', effort: 'medium', limits: DEFAULT_LIMITS, pricing: OPUS_5_5_PRICING, ledger: createLedger(join(dir, 'l.json'), 10_000_000_000), allowedTools: ['mcp__tracker__list_comments'], evidenceDir: join(dir, 'r'), upstream, onStop: r => stops.push(r) });
  try {
    assert.equal((await post(proxy.url, request({ output_config: { effort: 'high' } }))).status, 400);
    assert.deepEqual(stops, ['effort-mismatch']);
    assert.equal(upstream.seen.length, 0);
  } finally { await proxy.close(); }
});

test('a CLI request the proxy never saw stops the attempt as unmetered', async () => {
  const stdout = [
    { type: 'assistant', message: { id: 'msg_1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'assistant', message: { id: 'msg_2', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: 'assistant', message: { id: 'synthetic-uuid', model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 } } },
    { type: 'result', subtype: 'success', num_turns: 2 },
  ].map(l => JSON.stringify(l)).join('\n') + '\n';
  const { result } = await runFake(fakeProcess({ stdout }), { proxy: fakeProxy({ requests: [{ id: 'msg_1' }] }) });
  assert.equal(result.stop.reason, 'unmetered-request');
  const metered = await runFake(fakeProcess({ stdout }), { proxy: fakeProxy({ requests: [{ id: 'msg_1' }, { id: 'msg_2' }] }) });
  assert.equal(metered.result.stop, null);
});

test('the CLI turn count is not a request count: every id metered means no stop', async () => {
  // Observed on Claude Code 2.1.311: three metered requests, num_turns 4.
  const stdout = SUCCESS_STDOUT.replace('"num_turns":1', '"num_turns":4');
  const { result } = await runFake(fakeProcess({ stdout }));
  assert.equal(result.stop, null);
});

test('the driver reports a runtime fingerprint of the first request without the treatment prompt', async () => {
  const evidence = tmp();
  const write = (n, user, system) => { mkdirSync(join(evidence, 'requests'), { recursive: true }); writeFileSync(join(evidence, 'requests', `00${n}.request.json`), JSON.stringify({ body: { model: 'm', system, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }, { type: 'text', text: user }] }], metadata: { user_id: `s${n}` } } })); };
  write(1, 'PROMPT-A', 'SYS');
  const a = runtimeFingerprint(evidence, 'PROMPT-A');
  write(1, 'PROMPT-B', 'SYS');
  assert.equal(runtimeFingerprint(evidence, 'PROMPT-B'), a, 'the treatment prompt and session metadata are excluded');
  write(1, 'PROMPT-B', 'SYS-CHANGED');
  assert.notEqual(runtimeFingerprint(evidence, 'PROMPT-B'), a);
  assert.equal(runtimeFingerprint(tmp(), 'x'), null);
});

test('list_comments makes no ordering promise, because tie-breaks depend on listing order', async () => {
  const tracker = createFixtureTracker({ directory: trackerDir() });
  const list = await handleMessage(tracker, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const description = list.result.tools.find(t => t.name === 'list_comments').description;
  assert.doesNotMatch(description, /oldest|newest|sorted/i);
  assert.match(description, /order the tracker returns/);
});
