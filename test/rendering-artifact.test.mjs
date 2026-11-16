import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRenderingEnvironment, gradeRenderedArtifact, gradeRenderingCapture } from '../eval/control-parity/rendering-artifact.mjs';

const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/rendering.json', import.meta.url)));

test('rendering references pass; missing facts, inverted model order and bad table form fail', () => {
  for (const row of fixture.cases) assert.equal(gradeRenderedArtifact(row.reference, row.oracle).pass, true, row.id);
  const concrete = fixture.cases.find(c => c.id === 'gloss-003');
  assert.equal(gradeRenderedArtifact(concrete.reference.replace('cache_read_input_tokens', 'performance'), concrete.oracle).pass, false);
  const model = fixture.cases.find(c => c.id === 'model-hoist');
  assert.equal(gradeRenderedArtifact('First open the dashboard.\n' + model.reference, model.oracle).pass, false);
  const table = fixture.cases.find(c => c.id === 'long-table');
  assert.equal(gradeRenderedArtifact(table.source.draft, table.oracle).pass, false);
  assert.equal(gradeRenderedArtifact(concrete.reference + '\nISS-999: Invented work.', concrete.oracle).pass, false);
});

test('artifact workflow persists exact output and detects changed files or repeated submissions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'faff-render-test-'));
  try {
    const env = createRenderingEnvironment({ directory, fixture });
    for (const row of fixture.cases) await env.call('write_output', { case_id: row.id, text: row.reference });
    for (const row of fixture.rule_cases) await env.call('answer_rule', { case_id: row.id, value: row.expected });
    const grade = gradeRenderingCapture(env.capture(), fixture);
    assert.equal(grade.status, 'pass');
    assert.equal(grade.cases.filter(c => c.kind === 'artifact').length, 9);
    assert.equal(grade.cases.filter(c => c.kind === 'decision').length, 20);
    writeFileSync(join(directory, 'artifacts/gloss-001.md'), 'changed');
    assert.ok(gradeRenderingCapture(env.capture(), fixture).cases.find(c => c.id === 'gloss-001').problems.includes('persisted-artifact'));
    await assert.rejects(env.call('write_output', { case_id: 'gloss-001', text: 'rewrite' }), /duplicate/);
    await assert.rejects(env.call('write_output', { case_id: '../outside', text: 'escape' }), /invalid/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
