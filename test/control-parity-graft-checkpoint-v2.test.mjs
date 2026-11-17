import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const E = join(root, 'verification/experiments/2026-11-16-skill-diet');
const fixture = JSON.parse(readFileSync(join(E, 'workflow-fixtures/graft-checkpoints-v1-draft.json')));

test('case delivery returns the full existing row and precedes graft and ledger operations', async t => {
  const { createGraftCheckpointEnvironment } = await import('../eval/control-parity/graft-checkpoint-execution-v2.mjs');
  const directory = mkdtempSync('/var/tmp/graft-v2-test-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bounded = { ...fixture, cases: fixture.cases.filter(row => row.id === 'gate-none'), rule_cases: [] };
  const env = createGraftCheckpointEnvironment({ directory, runtimeRoot: root, fixture: bounded });
  await assert.rejects(env.call('run_command', { case_id: 'gate-none', command_id: 'gates', input: '' }), /case input not delivered/);
  await assert.rejects(env.call('read_ledger', { case_id: 'mixed-ledger' }), /case input not delivered/);
  for (const expected of env.publicCases) {
    const actual = await env.call('read_case', { case_id: expected.id });
    assert.deepEqual(actual, expected);
    assert.deepEqual(env.capture().events.at(-1).result, expected);
  }
  assert.equal((await env.call('run_command', { case_id: 'gate-none', command_id: 'gates', input: '' })).exit_code, 1);
  assert.ok((await env.call('read_ledger', { case_id: 'mixed-ledger' })).ledger);
  await assert.rejects(env.call('read_case', { case_id: 'invented' }), /unknown case/);
});

test('fresh grading requires delivery for every case while preserving the frozen semantic grade', async () => {
  const { gradeGraftCheckpoints } = await import('../eval/control-parity/graft-checkpoint-execution-v2.mjs');
  const directory = join(E, 'graft-checkpoints-v1-preflight-20261117-closed');
  const capture = JSON.parse(readFileSync(join(directory, 'capture.json')));
  const consumers = JSON.parse(readFileSync(join(directory, 'consumers.json')));
  const publicCases = JSON.parse(readFileSync(join(directory, 'public-cases.json')));
  assert.equal(gradeGraftCheckpoints(capture, consumers, fixture).status, 'fail');
  const count = publicCases.length;
  capture.events.forEach(event => event.seq += count);
  capture.cases.forEach(row => row.operations.forEach(op => op.seq += count));
  capture.events.unshift(...publicCases.map((row, index) => ({ seq: index + 1, name: 'read_case', case_id: row.id, args: { case_id: row.id }, result: row })));
  assert.equal(gradeGraftCheckpoints(capture, consumers, fixture).status, 'pass');
  capture.events = capture.events.filter(event => event.name !== 'read_case' || event.case_id !== 'mixed-ledger');
  assert.ok(gradeGraftCheckpoints(capture, consumers, fixture).problems.includes('case-input-delivery:mixed-ledger'));
});
