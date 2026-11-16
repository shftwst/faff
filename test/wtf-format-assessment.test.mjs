import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseWtfCapture } from '../verification/experiments/2026-11-16-skill-diet/assess-wtf-format.mjs';
test('WTF assessment changes only the exact separator-space answer and preserves original evidence', () => {
  const original = { outputs: [{ id: 'report', text: 'Methodology: different' }], rule_answers: [{ id: 'methodology-line', value: 'Methodology: ' }, { id: 'other', value: 'Methodology: ' }] };
  const snapshot = structuredClone(original), result = normaliseWtfCapture(original);
  assert.deepEqual(original, snapshot);
  assert.equal(result.capture.rule_answers[0].value, 'Methodology:');
  assert.equal(result.capture.rule_answers[1].value, 'Methodology: ');
  assert.deepEqual(result.capture.outputs, original.outputs);
  for (const value of ['Methodology:  ', ' methodology:', 'Method:', null, ['Methodology: ']]) {
    const result = normaliseWtfCapture({ rule_answers: [{ id: 'methodology-line', value }] });
    assert.deepEqual(result.capture.rule_answers[0].value, value);
    assert.equal(result.normalisations.length, 0);
  }
});
