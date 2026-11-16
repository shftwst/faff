import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeDecisions, gradeGateway, measureLoadSets } from '../eval/skill-diet.mjs';

const oracle = { schema: 1, expected: {
  decline: { config_actions: ['config init --set tracking.spec_docs_path=', 'gitignore-ensure', 'hooks-ensure'], resume_original: true },
  unattended: { route: 'faff-beep-boop' },
} };
const answer = (id, extra = {}) => ({ id, route: null, args: [], offer: false, config_actions: [], resume_original: false, level_command: null, ...extra });
const good = { answers: [answer('decline', oracle.expected.decline), answer('unattended', oracle.expected.unattended)] };

test('skill diet grader compares independent decisions and ordered effects', () => {
  assert.equal(gradeGateway(good, oracle).status, 'pass');
  const wrong = structuredClone(good);
  wrong.answers[0].config_actions.reverse();
  assert.equal(gradeGateway(wrong, oracle).status, 'fail');
  assert.equal(gradeGateway(wrong, oracle).passed, 1);
});

test('missing, duplicated, extra and malformed observations cannot pass', () => {
  for (const response of [null, {}, { answers: [] }, { answers: [good.answers[0]] }, { answers: [good.answers[0], good.answers[0]] }, { answers: [...good.answers, answer('invented')] }, { answers: good.answers.map(a => ({ ...a, hidden_effect: 'merge' })) }]) {
    assert.notEqual(gradeGateway(response, oracle).status, 'pass');
  }
  assert.throws(() => gradeGateway(good, { schema: 1, expected: {} }), /empty/);
});

test('unrequested mutation or prompt is a fidelity failure even when routing is correct', () => {
  for (const extra of [{ offer: true }, { config_actions: ['config init --set tracking.repo='] }, { level_command: 'faff lights-out' }]) {
    const response = structuredClone(good);
    Object.assign(response.answers[1], extra);
    assert.equal(gradeGateway(response, oracle).status, 'fail');
  }
});

test('decision probes compare nested values exactly without relying on object key order', () => {
  const expected = { schema: 1, expected: { outage: { signal: 'unavailable', actions: ['park', 'return'] } } };
  const response = { answers: [{ id: 'outage', value: { actions: ['park', 'return'], signal: 'unavailable' } }] };
  assert.equal(gradeDecisions(response, expected).status, 'pass');
  response.answers[0].value.actions.reverse();
  assert.equal(gradeDecisions(response, expected).status, 'fail');
  response.answers[0].value = { signal: 'pass', actions: ['park', 'return'] };
  assert.equal(gradeDecisions(response, expected).passed, 0);
});

test('decision probes reject missing, repeated and additional answers or effects', () => {
  const expected = { schema: 1, expected: { review: { action: 'stop' } } };
  const good = { id: 'review', value: { action: 'stop' } };
  for (const response of [null, {}, { answers: [] }, { answers: [good, good] }, { answers: [good, { id: 'extra', value: null }] }, { answers: [{ ...good, note: 'ignore this' }] }, { answers: [{ id: 'review', value: { action: 'stop', merge: true } }] }]) {
    assert.equal(gradeDecisions(response, expected).status, 'fail');
  }
  assert.throws(() => gradeDecisions({ answers: [] }, { schema: 1, expected: {} }), /empty/);
});

test('load-set totals count a shared file once and refuse missing dependencies', () => {
  const source = { files: [
    { path: 'skill.md', bytes: 12, estimated_tokens: 3 },
    { path: 'shared.md', bytes: 8, estimated_tokens: 2 },
  ] };
  const manifest = { schema: 1, sets: [{ name: 'nested', files: ['skill.md', 'shared.md', 'shared.md'] }] };
  const [result] = measureLoadSets(source, manifest);
  assert.equal(result.bytes, 20);
  assert.equal(result.estimated_tokens, 5);
  assert.deepEqual(result.files, ['skill.md', 'shared.md']);
  manifest.sets[0].files.push('missing.md');
  assert.throws(() => measureLoadSets(source, manifest), /missing/);
  assert.throws(() => measureLoadSets(source, { schema: 1, sets: [{ name: 'empty', files: [] }] }), /empty/);
});
