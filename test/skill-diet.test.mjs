import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeGateway } from '../eval/skill-diet.mjs';

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
