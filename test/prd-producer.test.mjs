import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { consumePrdArtifact, createPrdEnvironment, gradePrdCapture } from '../eval/control-parity/prd-producer.mjs';
const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(root, 'verification/experiments/2026-11-16-skill-diet/workflow-fixtures/prd-producer.json')));
const temporary = fn => async () => { const directory = mkdtempSync(join(tmpdir(), 'prd-producer-test-')); try { await fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); } };
test('real PRD consumer accepts both judgement routes and rejects malformed or inconsistent artifacts', temporary(directory => {
  for (const c of fixture.cases) {
    const result = consumePrdArtifact(root, c.reference, directory);
    assert.equal(result.pass, true, c.id);
    assert.equal(result.value.verdict, c.expected.verdict);
  }
  const valid = fixture.cases[0].reference;
  assert.equal(consumePrdArtifact(root, valid.replaceAll('\n', '\r\n'), directory).pass, true);
  for (const bad of [valid + 'text after block', valid + valid, valid.replace('true', 'false'), valid.replace('"broad"', '"invented"'), valid.replace('"verdict"', 'broken')]) assert.equal(consumePrdArtifact(root, bad, directory).pass, false);
}));
test('PRD environment records actual reads and consumer outputs and refuses extra data or premature writes', temporary(async directory => {
  const env = createPrdEnvironment({ directory, fixture, root });
  await assert.rejects(env.call('submit_verdict', { case_id: 'missing', text: fixture.cases[2].reference }));
  await assert.rejects(env.call('read_code', { case_id: 'missing' }));
  await assert.rejects(env.call('write_tracker', { case_id: 'missing' }));
  assert.equal(env.capture().errors.length, 3);
  assert.equal(env.capture().outputs.length, 0);
}));
test('PRD grade rejects tampered artifacts, wrong judgement and repeated submissions', temporary(async directory => {
  const env = createPrdEnvironment({ directory, fixture, root });
  for (const c of fixture.cases) {
    const read = await env.call('read_prd', { case_id: c.id }); assert.equal(read.text, c.prd);
    await env.call('submit_verdict', { case_id: c.id, text: c.reference });
  }
  for (const c of fixture.rule_cases) await env.call('answer_rule', { case_id: c.id, value: c.expected });
  await env.call('finish', {});
  assert.equal(gradePrdCapture(env.capture(), fixture).status, 'pass');
  const changed = structuredClone(env.capture()); changed.outputs[0].consumer.producer_value.creative_licence = 'tight';
  assert.equal(gradePrdCapture(changed, fixture).status, 'fail');
  writeFileSync(join(directory, 'artifacts', fixture.cases[0].id + '.md'), 'tampered');
  assert.equal(gradePrdCapture(env.capture(), fixture).status, 'fail');
  await assert.rejects(env.call('submit_verdict', { case_id: fixture.cases[0].id, text: fixture.cases[0].reference }));
}));
