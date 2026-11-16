import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRoutingEnvironment, gradeRoutingCapture } from '../eval/control-parity/routing-assignment.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/routing-assignment.json', import.meta.url)));
async function exercise(t) {
  const directory = mkdtempSync(join(tmpdir(), 'faff-routing-assignment-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = createRoutingEnvironment({ directory, fixture, root });
  for (const c of fixture.cases) {
    await env.call('read_inputs', { case_id: c.id });
    if (c.expected_blocking_punts !== undefined) await env.call('scan_punts', { case_id: c.id });
    await env.call('assign', { case_id: c.id, extraction: { root_cause: 'punt-not-closed', ...c.expected } });
  }
  for (const c of fixture.validation_cases) await env.call('validate_supplied', { case_id: c.id });
  for (const c of fixture.rule_cases) await env.call('answer_rule', { case_id: c.id, value: c.expected });
  return { env, capture: env.capture() };
}
test('routing assignments use the real Punt scanner and canonical validator output', async t => {
  const { capture } = await exercise(t), grade = gradeRoutingCapture(capture, fixture);
  assert.equal(grade.status, 'pass', JSON.stringify(grade));
  assert.equal(grade.cases.length, 25);
  assert.equal(capture.assignments.length, 10);
  assert.deepEqual(capture.validations.map(v => v.result.exit_code), [1, 2]);
});
test('routing comparison rejects changed eligibility, missing scanning, wrong assignment and altered output', async t => {
  const { capture } = await exercise(t);
  const mutations = [
    c => { c.scans.find(s => s.id === 'eligible-punt').result.value.blocking_open_count = 1; },
    c => { c.scans = []; },
    c => { c.events.reverse(); },
    c => { c.assignments[0].extraction.verdict = 'needs-decision-first'; },
    c => { c.assignments[0].extraction.conformant = true; },
    c => { c.assignments[0].persisted_sha256 = 'altered'; },
    c => { c.validations[1].result.exit_code = 0; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(capture); mutate(changed);
    assert.equal(gradeRoutingCapture(changed, fixture).status, 'fail');
  }
});
test('routing comparison records forbidden tracker writes and repeated assignment', async t => {
  const { env } = await exercise(t);
  await assert.rejects(env.call('write_tracker', { case_id: 'independent' }), /invalid tool/);
  await assert.rejects(env.call('assign', { case_id: 'independent', extraction: fixture.cases[0].expected }), /duplicate/);
  assert.equal(gradeRoutingCapture(env.capture(), fixture).status, 'fail');
});
