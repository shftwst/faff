import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { serveMailbox } from '../eval/control-parity/interactive-handoff.mjs';
import { createMcpMailbox, serveMcpMailbox, structuredHash } from '../eval/control-parity/mailbox-mcp.mjs';

const tools = ['read_policy', 'run_faff', 'finish'].map(name => ({ name, description: name, inputSchema: { type: 'object' } }));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'faff-mcp-bridge-'));
  writeFileSync(join(dir, 'task.json'), JSON.stringify({ tools }));
  return dir;
}
const trace = dir => readFileSync(join(dir, 'mcp-trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

test('structured bridge joins repeated calls to distinct mailbox files and preserves domain exit2', async () => {
  const dir = fixture();
  try {
    const server = serveMailbox(dir, async name => name === 'finish' ? { finished: true } : { exit_code: 2, cost: 1.25, text: 'ledger unreadable' }, { allowedTools: new Set(tools.map(t => t.name)), maxRequests: 4, pollMs: 1 });
    const bridge = createMcpMailbox(dir);
    const a = await bridge.call(1, 'run_faff', { value: 'same' });
    const b = await bridge.call(2, 'run_faff', { value: 'same' });
    assert.equal(a.isError, false);
    assert.deepEqual(a, b);
    assert.equal(JSON.parse(a.content[0].text).cost, 1.25);
    await bridge.call(3, 'finish', {});
    assert.equal((await server).rejected, 0);
    const rows = trace(dir);
    assert.notEqual(rows[0].mailbox_id, rows[1].mailbox_id);
    for (const row of rows) {
      assert.ok(row.request_sha256 && row.response_sha256 && row.value_sha256 && row.result_sha256);
      assert.equal(JSON.parse(readFileSync(join(dir, 'requests', row.mailbox_id + '.json'))).name, row.tool);
    }
    assert.equal((await bridge.call(4, 'run_faff', {})).isError, true);
    assert.match(trace(dir).at(-1).error, /after finish/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('structured bridge preserves rejected calls and rejects duplicate IDs and unknown tools', async () => {
  const dir = fixture();
  try {
    const server = serveMailbox(dir, async name => { if (name === 'finish') return { finished: true }; throw new Error('bad offset'); }, { allowedTools: new Set(tools.map(t => t.name)), pollMs: 1 });
    const bridge = createMcpMailbox(dir);
    assert.equal((await bridge.call(1, 'read_policy', { offset: 12 })).isError, true);
    assert.equal((await bridge.call(1, 'read_policy', { offset: 12 })).isError, true);
    assert.equal((await bridge.call(2, 'outside_tool', {})).isError, true);
    await bridge.call(3, 'finish', {});
    assert.equal((await server).rejected, 1);
    const rows = trace(dir);
    assert.ok(rows[0].mailbox_id && rows[0].response_sha256);
    assert.equal(rows[1].mailbox_id, null);
    assert.equal(rows[2].mailbox_id, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('structured bridge records a real mailbox timeout and refuses restart over trace', async () => {
  const dir = fixture();
  mkdirSync(join(dir, 'requests')); mkdirSync(join(dir, 'responses'));
  try {
    const bridge = createMcpMailbox(dir, { timeoutMs: 1 });
    assert.equal((await bridge.call(1, 'read_policy', { offset: 0 })).isError, true);
    assert.match(trace(dir)[0].error, /timeout/);
    assert.equal(trace(dir)[0].response_sha256, null);
    assert.throws(() => createMcpMailbox(dir), /EEXIST/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MCP stdio framing exposes exactly the task ports and returns the mailbox result', async () => {
  const dir = fixture(), input = new PassThrough(), output = new PassThrough();
  let text = ''; output.on('data', chunk => { text += chunk; });
  try {
    const server = serveMailbox(dir, async () => ({ finished: true }), { allowedTools: new Set(['finish']), pollMs: 1 });
    const mcp = serveMcpMailbox(dir, { input, output });
    input.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'finish', arguments: {} } },
    ].map(JSON.stringify).join('\n') + '\n');
    await mcp; await server;
    const replies = text.trim().split('\n').map(JSON.parse);
    assert.deepEqual(replies.map(r => r.id), [1, 2, 3]);
    assert.deepEqual(replies[1].result.tools, tools);
    assert.deepEqual(JSON.parse(replies[2].result.content[0].text), { finished: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('structured hashes retain fractional values and ignore only object key order', () => {
  assert.equal(structuredHash({ a: 1.25, b: [2] }), structuredHash({ b: [2], a: 1.25 }));
  assert.notEqual(structuredHash({ a: 1.25 }), structuredHash({ a: 1.2 }));
  assert.throws(() => structuredHash({ a: Infinity }), /non-finite/);
});

test('concurrent bridge calls are serialized and retain their own mailbox attribution', async () => {
  const dir = fixture();
  try {
    const server = serveMailbox(dir, async (name, args) => name === 'finish' ? { finished: true } : args, { allowedTools: new Set(tools.map(t => t.name)), pollMs: 1 });
    const bridge = createMcpMailbox(dir);
    const results = await Promise.all([bridge.call(1, 'run_faff', { index: 1 }), bridge.call(2, 'run_faff', { index: 2 }), bridge.call(3, 'finish', {})]);
    await server;
    assert.ok(results.every(value => value.isError === false));
    assert.deepEqual(results.slice(0, 2).map(value => JSON.parse(value.content[0].text).index), [1, 2]);
    assert.equal(new Set(trace(dir).map(row => row.mailbox_id)).size, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid RPC ids and arguments are recorded without creating mailbox requests', async () => {
  const dir = fixture();
  const strictTools = [{ name: 'finish', description: 'finish', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }, { name: 'read_policy', description: 'read', inputSchema: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 } }, required: ['offset'], additionalProperties: false } }];
  writeFileSync(join(dir, 'task.json'), JSON.stringify({ tools: strictTools }));
  mkdirSync(join(dir, 'requests')); mkdirSync(join(dir, 'responses'));
  try {
    const bridge = createMcpMailbox(dir);
    const invalid = [[null, {}], [{}, {}], [1.5, {}], [1, {}], [2, { offset: -1 }], [3, { offset: 1.25 }], [4, { offset: 0, extra: true }], [5, { offset: '0' }]];
    for (const [id, args] of invalid) assert.equal((await bridge.call(id, 'read_policy', args)).isError, true);
    assert.ok(trace(dir).every(row => row.error && row.mailbox_id === null));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('request mutation during handling cannot be attributed as an unchanged call', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = fixture();
  try {
    const server = serveMailbox(dir, async name => {
      if (name === 'finish') return { finished: true };
      const request = readdirSync(join(dir, 'requests')).find(name => name.endsWith('.json'));
      writeFileSync(join(dir, 'requests', request), JSON.stringify({ name: 'run_faff', args: { changed: true } }));
      return { exit_code: 0 };
    }, { allowedTools: new Set(tools.map(t => t.name)), pollMs: 1 });
    const bridge = createMcpMailbox(dir);
    assert.equal((await bridge.call(1, 'run_faff', {})).isError, true);
    assert.match(trace(dir)[0].error, /differs/);
    await bridge.call(2, 'finish', {}); await server;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an injected additional mailbox request fails unique attribution', async () => {
  const { randomUUID } = await import('node:crypto');
  const dir = fixture();
  try {
    let injected = false;
    const server = serveMailbox(dir, async name => {
      if (name === 'finish') return { finished: true };
      if (!injected) { injected = true; writeFileSync(join(dir, 'requests', randomUUID() + '.json'), JSON.stringify({ name: 'run_faff', args: {} })); }
      return { exit_code: 0 };
    }, { allowedTools: new Set(tools.map(t => t.name)), pollMs: 1 });
    const bridge = createMcpMailbox(dir);
    assert.equal((await bridge.call(1, 'run_faff', {})).isError, true);
    assert.match(trace(dir)[0].error, /not unique/);
    await bridge.call(2, 'finish', {}); await server;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('protocol rejects malformed frames, pre-init calls, invalid ids and duplicate ids with evidence', async () => {
  const dir = fixture(), input = new PassThrough(), output = new PassThrough();
  let text = ''; output.on('data', chunk => { text += chunk; });
  mkdirSync(join(dir, 'requests')); mkdirSync(join(dir, 'responses'));
  try {
    const mcp = serveMcpMailbox(dir, { input, output });
    const requests = [
      '{broken',
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
      ...[null, {}, 1.25].map(id => JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' })),
    ];
    input.end(requests.join('\n') + '\n');
    await mcp;
    const replies = text.trim().split('\n').map(JSON.parse);
    assert.equal(replies.filter(value => value.error).length, 6);
    assert.equal(readFileSync(join(dir, 'mcp-protocol-errors.jsonl'), 'utf8').trim().split('\n').length, 6);
    assert.equal(readFileSync(join(dir, 'mcp-trace.jsonl'), 'utf8'), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit null arguments are rejected while omitted finish arguments retain the empty object default', async () => {
  const dir = fixture(), input = new PassThrough(), output = new PassThrough();
  let text = ''; output.on('data', chunk => { text += chunk; });
  try {
    const server = serveMailbox(dir, async () => ({ finished: true }), { allowedTools: new Set(['finish']), pollMs: 1 });
    const mcp = serveMcpMailbox(dir, { input, output });
    input.end([
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'finish', arguments: null } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'finish' } },
    ].map(JSON.stringify).join('\n') + '\n');
    await mcp; await server;
    const replies = text.trim().split('\n').map(JSON.parse);
    assert.equal(replies[1].result.isError, true);
    assert.equal(replies[2].result.isError, false);
    assert.equal(trace(dir)[0].mailbox_id, null);
    assert.ok(trace(dir)[1].mailbox_id);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('mailbox directory loss is retained as a failed call and restart preserves original evidence', async () => {
  const dir = fixture();
  mkdirSync(join(dir, 'requests')); mkdirSync(join(dir, 'responses'));
  try {
    const bridge = createMcpMailbox(dir);
    rmSync(join(dir, 'requests'), { recursive: true });
    assert.equal((await bridge.call(1, 'finish', {})).isError, true);
    assert.match(trace(dir)[0].error, /ENOENT/);
    assert.match(trace(dir)[0].attribution_error, /ENOENT/);
    const manifest = readFileSync(join(dir, 'mcp-server-manifest.json')), before = readFileSync(join(dir, 'mcp-trace.jsonl'));
    mkdirSync(join(dir, 'requests'));
    assert.throws(() => createMcpMailbox(dir), /EEXIST/);
    assert.deepEqual(readFileSync(join(dir, 'mcp-server-manifest.json')), manifest);
    assert.deepEqual(readFileSync(join(dir, 'mcp-trace.jsonl')), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
