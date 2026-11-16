import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { connectReviewTracker } from '../plugin/skills/faff/bin/lib/review-comment-mcp.js';
import { createReviewCommentSession } from '../plugin/skills/faff/bin/lib/review-comment-session.js';
import { createFixtureTracker } from '../eval/control-parity/tracker.mjs';
import { loadInputs } from '../eval/control-parity/run.mjs';

const issue = 'FAFF-42';
const open = '<!-- faff-review-findings:FAFF-42 -->';
const close = '<!-- /faff-review-findings:FAFF-42 -->';
function tracker(t, faults = []) {
  const dir = mkdtempSync(join(tmpdir(), 'faff-handoff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  createFixtureTracker({ directory: dir, issueId: issue, initialState: {
    comments: [{ id: 'one', body: `human\r\n${open}\r\nold\r\n${close}\r\n尾\\n\r\n`, created_at: null }], next_comment_id: 'new', now: '2026-11-16T00:00:00Z',
  }, faults });
  return { dir, config: { schema: 1, command: process.execPath, args: [resolve('eval/control-parity/tool-server.mjs'), dir], tools: { list: 'list_comments', create: 'create_comment', update: 'save_comment' }, issueArgument: 'issue_id', timestampField: 'created_at', listing: 'complete-comments' } };
}

test('production MCP connector writes exact stored bytes through a real upstream stdio process', async t => {
  const { dir, config } = tracker(t);
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  const session = createReviewCommentSession(upstream.ports);
  const prepared = await session.prepare({ issue_id: issue, faff_body: 'new\n✓' });
  const outcome = await session.apply({ plan_ref: prepared.plan_ref });
  assert.deepEqual(outcome, { status: 'acknowledged', comment_id: 'one', reason: 'updated' });
  const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const effects = events.filter(x => x.kind === 'effect-attempt');
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].args, { id: 'one', body: `human\r\n${open}\nnew\n✓\n${close}\n尾\\n\r\n` });
  assert.equal(events.filter(x => x.kind === 'read').length, 2);
});

function fake(t, expression) {
  const dir = mkdtempSync(join(tmpdir(), 'faff-upstream-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'server.cjs');
  writeFileSync(file, `require('node:readline').createInterface({input:process.stdin}).on('line', line => {
    const m=JSON.parse(line); if(m.id===undefined)return;
    const result=m.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}:
      m.method==='tools/list'?{tools:['list_comments','create_comment','save_comment'].map(name=>({name,inputSchema:{type:'object'}}))}:
      (${expression});
    if(result!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
  });`);
  return { schema: 1, command: process.execPath, args: [file], tools: { list: 'list_comments', create: 'create_comment', update: 'save_comment' }, issueArgument: 'issueId', timestampField: 'createdAt', listing: 'complete-array' };
}

test('maps the configured tracker timestamp and argument names without changing text', async t => {
  const config = fake(t, `{content:[{type:'text',text:JSON.stringify([{id:'x',body:m.params.arguments.issueId+'\\r\\n尾',createdAt:'2026-01-01T00:00:00Z'}])}]}`);
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  assert.deepEqual(await upstream.ports.listComments(issue), [{ id: 'x', body: 'FAFF-42\r\n尾', created_at: '2026-01-01T00:00:00Z' }]);
});

for (const [name, value] of [
  ['pagination envelope', { comments: [], nextCursor: 'more' }],
  ['unrecognised envelope', { data: [] }],
  ['malformed comment', [{ id: 'x' }]],
]) test(`refuses ${name} instead of treating it as an empty complete listing`, async t => {
  const config = fake(t, JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }] }));
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  await assert.rejects(upstream.ports.listComments(issue));
});

test('a tool error after write is uncertain and never retried', async t => {
  const config = fake(t, `{isError:true,content:[{type:'text',text:'connection lost'}]}`);
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  assert.equal((await upstream.ports.writeComment(issue, { action: 'update', comment_id: 'one', body: 'text' })).status, 'uncertain');
});

test('missing write acknowledgement is uncertain', async t => {
  const config = fake(t, `{content:[{type:'text',text:'{}'}]}`);
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  assert.equal((await upstream.ports.writeComment(issue, { action: 'update', comment_id: 'one', body: 'text' })).status, 'uncertain');
});

test('upstream timeout closes the transport and does not retry', async t => {
  const upstream = await connectReviewTracker(fake(t, 'undefined'), { timeoutMs: 100 });
  t.after(() => upstream.close());
  await assert.rejects(upstream.ports.listComments(issue), /timeout/);
  await assert.rejects(upstream.ports.listComments(issue), /closed/);
});

test('configuration refuses model-like overrides or shell command strings', async () => {
  for (const value of [{}, { schema: 1, command: 'node; echo unsafe', args: [] }, { schema: 1, shell: true }]) {
    await assert.rejects(connectReviewTracker(value), /configuration/);
  }
});

test('shipped stdio server exposes prepare/apply and rejects body overrides through JSON-RPC', { timeout: 5000 }, async t => {
  const { dir, config } = tracker(t);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config));
  const child = spawn(process.execPath, [resolve('plugin/skills/faff/bin/faff-review-comments.mjs'), configPath]);
  t.after(() => child.kill());
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const value = JSON.parse(line); pending.get(value.id)?.resolve(value); pending.delete(value.id); });
  child.once('exit', () => { for (const item of pending.values()) item.reject(new Error(`server exited: ${stderr}`)); });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const early = await request('tools/list');
  assert.equal(early.error.code, -32002);
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = (await request('tools/list')).result.tools;
  assert.deepEqual(tools.map(t => t.name), ['prepare_review_comment', 'apply_review_comment']);
  const prepared = (await request('tools/call', { name: 'prepare_review_comment', arguments: { issue_id: issue, faff_body: 'new' } })).result.structuredContent;
  const override = await request('tools/call', { name: 'apply_review_comment', arguments: { plan_ref: prepared.plan_ref, body: 'bad' } });
  assert.equal(override.result.isError, true);
  const applied = await request('tools/call', { name: 'apply_review_comment', arguments: { plan_ref: prepared.plan_ref } });
  assert.equal(applied.result.structuredContent.status, 'acknowledged');
  const reused = await request('tools/call', { name: 'apply_review_comment', arguments: { plan_ref: prepared.plan_ref } });
  assert.equal(reused.result.structuredContent.status, 'refused');
  child.stdin.end();
});

const inputs = loadInputs(resolve('.'));
for (const scenario of inputs.registry.scenarios) test(`shipped connector matches independent oracle: ${scenario.id}`, async t => {
  const fixture = inputs.fixtures.get(scenario.id);
  const dir = mkdtempSync(join(tmpdir(), 'faff-oracle-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tracker = createFixtureTracker({ directory: dir, issueId: fixture.issue_id, initialState: fixture.tracker });
  const config = { schema: 1, command: process.execPath, args: [resolve('eval/control-parity/tool-server.mjs'), dir], tools: { list: 'list_comments', create: 'create_comment', update: 'save_comment' }, issueArgument: 'issue_id', timestampField: 'created_at', listing: 'complete-comments' };
  const upstream = await connectReviewTracker(config);
  t.after(() => upstream.close());
  const session = createReviewCommentSession(upstream.ports);
  const prepared = await session.prepare({ issue_id: fixture.issue_id, faff_body: fixture.faff_body });
  const applied = await session.apply({ plan_ref: prepared.plan_ref });
  assert.equal(applied.status, 'acknowledged');
  assert.equal(applied.reason, scenario.expected.terminal.reason);
  const effects = tracker.readEvents().filter(e => e.kind === 'effect-attempt').map(({ op, args }) => ({ op, args }));
  assert.deepEqual(effects, scenario.expected.effects);
  assert.deepEqual(tracker.readState().issues, inputs.expected.scenarios[scenario.id].final_comments);
});
