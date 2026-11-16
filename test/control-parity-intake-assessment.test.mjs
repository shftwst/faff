import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessIntakeQuestions } from '../verification/experiments/2026-11-16-skill-diet/assess-intake-questions.mjs';
import { gradeRenderingCapture } from '../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../eval/control-parity/schema.mjs';

const base = new URL('../verification/experiments/2026-11-16-skill-diet/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('workflow-fixtures/intake-brief-v2.json', base)));
const capture = { errors: [], outputs: fixture.cases.map(row => ({ id: row.id, text: row.reference, persisted_sha256: sha256(row.reference) })), rule_answers: fixture.rule_cases.map(row => ({ id: row.id, value: row.expected })) };
const sample = text => {
  const value = structuredClone(capture), row = value.outputs.find(row => row.id === 'greenfield-thin');
  row.text = text; row.persisted_sha256 = sha256(text);
  return value;
};
const text = fixture.cases.find(row => row.id === 'greenfield-thin').reference
  .replace('No hard constraints specified.', 'None supplied.')
  .replace('No explicit non-goals supplied.', 'None supplied.')
  .replace('Platform and language are undecided.', 'Which platform and language should be used?')
  .replace('The smallest useful first slice is unspecified.', 'What is the smallest useful first slice?');

test('intake questions correction retains the raw failure and recognises both explicit unknowns', () => {
  assert.equal(gradeRenderingCapture(sample(text), fixture).status, 'fail');
  const result = assessIntakeQuestions(sample(text), fixture);
  assert.equal(result.grade.status, 'pass');
  assert.equal(result.normalisations.length, 1);
  assert.equal(assessIntakeQuestions(capture, fixture).normalisations.length, 0);
});

test('intake correction cannot waive missing questions, other facts, format, ids or rule decisions', () => {
  for (const changed of [
    text.replace('Which platform and language should be used?', ''),
    text.replace('What is the smallest useful first slice?', ''),
    text.replace('## Open questions', '## Suggestions'),
    text.replace('Which platform and language should be used?', 'We will use Python.'),
    text.replace('- What is the smallest useful first slice?', '## Selected first slice\nWhat is the smallest useful first slice?'),
    text.replaceAll('volunteers', 'operators'),
    text.replace('## Goal', '## Purpose'),
    text + '\nTASK-999 is ready.\n',
  ]) assert.equal(assessIntakeQuestions(sample(changed), fixture).grade.status, 'fail', changed);
  const wrong = sample(text); wrong.rule_answers[0].value = { owner: 'wrong' };
  assert.equal(assessIntakeQuestions(wrong, fixture).grade.status, 'fail');
});

test('question recogniser is not a substitute for independent invention review', () => {
  const contradiction = sample(text + '\n## Unfounded choice\nBuild the application in Python.\n');
  assert.equal(assessIntakeQuestions(contradiction, fixture).grade.status, 'pass');
});
