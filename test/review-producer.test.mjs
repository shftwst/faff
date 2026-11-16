import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { consumeReviewArtifact, createReviewEnvironment, gradeReviewCapture, gradeReviewValue } from '../eval/control-parity/review-producer.mjs';
const root = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(root, 'verification/experiments/2026-11-16-skill-diet/workflow-fixtures/review-producer.json')));
const temporary = fn => async () => { const directory = mkdtempSync(join(tmpdir(), 'review-producer-test-')); try { await fn(directory); } finally { rmSync(directory, { recursive: true, force: true }); } };

test('real review consumer accepts complete artifacts and rejects inconsistent or malformed envelopes', temporary(directory => {
  for (const c of fixture.cases) {
    const result = consumeReviewArtifact(root, c.reference, directory);
    assert.equal(result.pass, true, c.id);
    assert.equal(result.value.signal, c.oracle.signal);
    assert.equal(gradeReviewValue(result.producer_value, c.oracle).pass, true, c.id);
  }
  const valid = fixture.cases[0].reference;
  assert.equal(consumeReviewArtifact(root, valid.replaceAll('\n', '\r\n'), directory).pass, true);
  for (const bad of [valid + 'text after block', valid + valid, valid.replace('signal: pass', 'signal: fail'), valid.replace('"pass"', '"invented"'), valid.replace('"signal"', 'broken'), valid.replaceAll('pass', 'fail')]) assert.equal(consumeReviewArtifact(root, bad, directory).pass, false);
}));

test('review producer refuses publication, code mutation, extra inputs and premature submission', temporary(async directory => {
  const env = createReviewEnvironment({ directory, fixture, root });
  for (const name of ['post_comment', 'edit_code']) await assert.rejects(env.call(name, { case_id: 'clean' }));
  await assert.rejects(env.call('submit_review', { case_id: 'clean', text: fixture.cases[0].reference }));
  await assert.rejects(env.call('read_inputs', { case_id: 'clean', extra: true }));
  assert.equal(env.capture().errors.length, 4);
  assert.equal(env.capture().outputs.length, 0);
}));

test('review grader detects lost prior identity, fabricated findings, tampering and repeated submissions', temporary(async directory => {
  const env = createReviewEnvironment({ directory, fixture, root });
  for (const c of fixture.cases) {
    assert.deepEqual(await env.call('read_inputs', { case_id: c.id }), c.input);
    await env.call('submit_review', { case_id: c.id, text: c.reference });
  }
  for (const c of fixture.rule_cases) await env.call('answer_rule', { case_id: c.id, value: c.expected });
  await env.call('finish', {});
  assert.equal(gradeReviewCapture(env.capture(), fixture).status, 'pass');
  const prior = fixture.cases.find(c => c.id === 'prior-findings');
  const correct = env.capture().outputs.find(o => o.id === prior.id).consumer.producer_value;
  const mutations = [
    value => { value.signal = 'pass'; },
    value => { delete value.findings[0].carried_id; },
    value => { value.findings[0].carried_id = 'P1'; },
    value => { value.findings[0].carried_id = 'P99'; },
    value => { value.findings[0].id = 'made-up'; },
    value => { value.findings[0].provenance_present = true; },
    value => { value.findings[0].refutation = 'invented'; },
    value => { value.findings[0].action_present = false; },
    value => { value.findings[0].source = 'secondary'; },
    value => { value.findings = [null]; },
  ];
  for (const mutate of mutations) { const value = structuredClone(correct); mutate(value); assert.equal(gradeReviewValue(value, prior.oracle).pass, false); }
  writeFileSync(join(directory, 'artifacts', fixture.cases[0].id + '.md'), 'tampered');
  assert.equal(gradeReviewCapture(env.capture(), fixture).status, 'fail');
  await assert.rejects(env.call('submit_review', { case_id: fixture.cases[0].id, text: fixture.cases[0].reference }));
}));
