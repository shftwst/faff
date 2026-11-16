import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gradeMethodologyOutput, consumeTerminationPolicy, createMethodologyEnvironment, gradeMethodologyCapture } from '../eval/control-parity/methodology-output.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/thematic-readonly.json', import.meta.url)));

test('named-output oracle detects reordered priority, lost discovery questions and invented tickets', () => {
  for (const row of fixture.cases) assert.equal(gradeMethodologyOutput(row.reference, row.oracle).pass, true, row.id);
  const order = fixture.cases.find(c => c.id === 'core-order');
  assert.equal(gradeMethodologyOutput([...order.reference].reverse(), order.oracle).pass, false);
  const shape = fixture.cases.find(c => c.id === 'shape-unitary');
  const lost = structuredClone(shape.reference); lost.tickets[0].description = 'Add rate limiting.';
  assert.equal(gradeMethodologyOutput(lost, shape.oracle).pass, false);
  const extra = structuredClone(shape.reference); extra.tickets.push({ ...extra.tickets[0], title: 'Invented work' });
  assert.equal(gradeMethodologyOutput(extra, shape.oracle).pass, false);
});

test('real termination consumer respects the supplied order and keeps its fixed safety floor', () => {
  const row = fixture.cases.find(c => c.id === 'termination-policy');
  const reference = consumeTerminationPolicy(root, row.reference, row.consumer_scenarios);
  assert.equal(reference.length, 9);
  assert.ok(reference.every(r => r.pass), JSON.stringify(reference.filter(r => !r.pass)));
  const wrong = consumeTerminationPolicy(root, { ladder: [...row.reference.ladder].reverse() }, row.consumer_scenarios);
  assert.equal(wrong.find(r => r.id === 'non-convergence').pass, false);
  assert.ok(wrong.filter(r => r.id.endsWith('-floor')).every(r => r.pass));
});

test('producer outputs persist exactly and refuse tracker writes or duplicate submissions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-methodology-test-'));
  try {
    const env = createMethodologyEnvironment({ directory, fixture, root });
    for (const row of fixture.cases) await env.call('submit_output', { case_id: row.id, value: row.reference });
    assert.equal(gradeMethodologyCapture(env.capture(), fixture).status, 'pass');
    writeFileSync(join(directory, 'artifacts/core-order.json'), '[]');
    assert.ok(gradeMethodologyCapture(env.capture(), fixture).cases[0].problems.includes('persisted-artifact'));
    await assert.rejects(env.call('submit_output', { case_id: fixture.cases[0].id, value: [] }), /duplicate/);
    await assert.rejects(env.call('write_tracker', { case_id: fixture.cases[0].id, value: { status: 'Todo' } }), /invalid/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('agile V2 accepts moving between named outcomes without admitting a missing re-grouping action', () => {
  const base = new URL('../verification/experiments/2026-11-16-skill-diet/', import.meta.url);
  const before = JSON.parse(readFileSync(new URL('workflow-fixtures/agile-principles.json', base)));
  const after = JSON.parse(readFileSync(new URL('workflow-fixtures/agile-principles-v2.json', base)));
  const observed = JSON.parse(readFileSync(new URL('workflow-runs/agile-principles-astra-v1-baseline-1/artifacts/cohesion.json', base)));
  const oldCase = before.cases.find(c => c.id === 'cohesion'), newCase = after.cases.find(c => c.id === 'cohesion');
  assert.equal(gradeMethodologyOutput(observed, oldCase.oracle).pass, false);
  assert.equal(gradeMethodologyOutput(observed, newCase.oracle).pass, true);
  const wrong = structuredClone(observed); wrong.findings[0].recommended_action = 'Leave both outcomes together in W2.';
  assert.equal(gradeMethodologyOutput(wrong, newCase.oracle).pass, false);
  for (const c of after.cases) assert.equal(gradeMethodologyOutput(c.reference, c.oracle).pass, true, c.id);
});
