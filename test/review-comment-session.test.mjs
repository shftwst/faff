import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewCommentSession } from '../plugin/skills/faff/bin/lib/review-comment-session.js';

const issue_id = 'FAFF-42';
const open = '<!-- faff-review-findings:FAFF-42 -->';
const close = '<!-- /faff-review-findings:FAFF-42 -->';
const original = `Human café \\r\\n\r\n${open}\r\nold\r\n${close}\r\n尾 🙂\r\n`;
const replacement = 'new\nline \\path';
const expected = `Human café \\r\\n\r\n${open}\nnew\nline \\path\n${close}\n尾 🙂\r\n`;

function setup(options = {}) {
  let comments = [{ id: 'comment-1', body: original, created_at: null }];
  const writes = [];
  const ports = {
    async listComments(id) { assert.equal(id, issue_id); return structuredClone(comments); },
    async writeComment(id, plan) { writes.push({ id, ...plan }); return { status: 'acknowledged', comment_id: plan.comment_id ?? 'new-1' }; },
  };
  return { ports, writes, setComments(value) { comments = value; }, session: createReviewCommentSession(ports, options) };
}

test('apply sends exact CRLF, Unicode and literal backslashes without copying the preview', async () => {
  const { session, writes } = setup();
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  assert.equal(prepared.plan.body, expected);
  prepared.plan.body = 'tampered preview';
  assert.deepEqual(await session.apply({ plan_ref: prepared.plan_ref }), { status: 'acknowledged', reason: 'updated', comment_id: 'comment-1' });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].body, expected);
  assert.equal(writes[0].id, issue_id);
});

test('create uses the bound issue and stored canonical body', async () => {
  const { session, writes, setComments } = setup();
  setComments([]);
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  const result = await session.apply({ plan_ref: prepared.plan_ref });
  assert.equal(result.status, 'acknowledged');
  assert.equal(result.reason, 'created');
  assert.equal(writes[0].body, `${open}\n${replacement}\n${close}`);
  assert.equal(writes[0].action, 'create');
});

test('rejects model-supplied comments, body and target overrides', async () => {
  const { session, writes } = setup();
  await assert.rejects(session.prepare({ issue_id, faff_body: replacement, comments: [] }), /fields/);
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  for (const field of ['body', 'issue_id', 'comment_id']) {
    await assert.rejects(session.apply({ plan_ref: prepared.plan_ref, [field]: 'override' }), /fields/);
  }
  assert.equal(writes.length, 0);
});

test('a reference belongs to its session and can be applied only once', async () => {
  const { session, writes } = setup();
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  assert.equal((await setup().session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'acknowledged');
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
  assert.equal(writes.length, 1);
});

test('any change to the live comment snapshot refuses before writing', async () => {
  for (const next of [[], [{ id: 'comment-1', body: original + 'human edit', created_at: null }], [{ id: 'new', body: 'new human comment' }]]) {
    const { session, setComments, writes } = setup();
    const prepared = await session.prepare({ issue_id, faff_body: replacement });
    setComments(next);
    assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
    assert.equal(writes.length, 0);
  }
});

test('expiry and bounded pending plans fail without a write', async () => {
  let now = 100;
  const { session, writes } = setup({ now: () => now, ttlMs: 10, maxPlans: 1 });
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  await assert.rejects(session.prepare({ issue_id, faff_body: replacement }), /capacity/);
  now += 10;
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
  await session.prepare({ issue_id, faff_body: replacement });
  assert.equal(writes.length, 0);
});

test('parallel apply of separate references for one issue makes at most one write', async () => {
  const { session, ports, writes } = setup();
  const a = await session.prepare({ issue_id, faff_body: replacement });
  const b = await session.prepare({ issue_id, faff_body: replacement });
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const write = ports.writeComment;
  ports.writeComment = async (...args) => { await waiting; return write(...args); };
  const first = session.apply({ plan_ref: a.plan_ref });
  assert.equal((await session.apply({ plan_ref: b.plan_ref })).status, 'refused');
  release();
  assert.equal((await first).status, 'acknowledged');
  assert.equal(writes.length, 1);
});

test('transport loss is uncertain and consumes the reference without retry', async () => {
  const { session, ports } = setup();
  let calls = 0;
  ports.writeComment = async () => { calls++; throw new Error('connection lost after send'); };
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'uncertain');
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
  assert.equal(calls, 1);
});

test('a failed live read refuses without invoking the write port', async () => {
  const { session, ports, writes } = setup();
  const prepared = await session.prepare({ issue_id, faff_body: replacement });
  ports.listComments = async () => { throw new Error('offline'); };
  assert.equal((await session.apply({ plan_ref: prepared.plan_ref })).status, 'refused');
  assert.equal(writes.length, 0);
});
