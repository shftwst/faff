import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callMailbox, serveMailbox } from '../eval/control-parity/interactive-handoff.mjs';

test('interactive fixture bridge preserves values and records rejected calls before completion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-interactive-'));
  const calls = [];
  const service = serveMailbox(directory, async (name, args) => {
    calls.push({ name, args });
    return name === 'finish' ? { finished: true } : { echoed: args };
  }, { timeoutMs: 2000, pollMs: 5 });
  try {
    await assert.rejects(callMailbox(directory, 'save_comment', { body: 'forbidden' }, { pollMs: 5 }), /unknown tool/);
    const args = { issue_id: 'FIX-1', faff_body: 'line one\r\nline two\n"quote"' };
    assert.deepEqual(await callMailbox(directory, 'prepare_review_comment', args, { pollMs: 5 }), { echoed: args });
    await callMailbox(directory, 'finish', { status: 'completed', reason: 'updated' }, { pollMs: 5 });
    const result = await service;
    assert.equal(result.stop, null);
    assert.equal(result.rejected, 1);
    assert.deepEqual(calls.map(c => c.name), ['prepare_review_comment', 'finish']);
    assert.deepEqual(calls[0].args, args);
  } finally { await service; rmSync(directory, { recursive: true, force: true }); }
});

test('interactive fixture bridge timeout remains incomplete', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-interactive-'));
  try {
    const result = await serveMailbox(directory, async () => assert.fail('no call expected'), { timeoutMs: 15, pollMs: 5 });
    assert.equal(result.stop.reason, 'interactive-timeout');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('workflow fixtures declare their own bounded tool set', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-interactive-'));
  const service = serveMailbox(directory, async (name, args) => name === 'finish' ? { finished: true } : { args }, {
    timeoutMs: 2000, pollMs: 5, allowedTools: new Set(['run_faff', 'finish']), maxRequests: 3,
  });
  try {
    assert.deepEqual(await callMailbox(directory, 'run_faff', { args: ['config', 'path'] }, { pollMs: 5 }), { args: { args: ['config', 'path'] } });
    await assert.rejects(callMailbox(directory, 'prepare_review_comment', {}, { pollMs: 5 }), /unknown tool/);
    await callMailbox(directory, 'finish', {}, { pollMs: 5 });
    assert.equal((await service).rejected, 1);
  } finally { await service; rmSync(directory, { recursive: true, force: true }); }
});
