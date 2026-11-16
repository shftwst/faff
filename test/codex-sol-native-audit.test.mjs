import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSolEvents } from '../eval/control-parity/codex-sol-native-audit.mjs';
import { auditExpectedModelEvents } from '../eval/control-parity/codex-model-native-audit.mjs';
import { sha256 } from '../eval/control-parity/schema.mjs';

const sample = { name: 'sol', prompt: 'Measure.', reads: ['/task'], read_bindings: [{ path: '/task', sha256: sha256('task\n') }], directory: '/run', bridge: '/bridge.mjs', tools: ['finish'], fileInput: false };
function events(model = 'gpt-6.1-sol', effort = 'medium') {
  const response = payload => ({ type: 'response_item', payload });
  return [
    { type: 'session_meta', payload: { id: 'sol', cli_version: '0.169.0', base_instructions: { text: 'fixed' } } },
    { type: 'turn_context', payload: { model, effort } },
    response({ type: 'message', role: 'user', content: [{ text: sample.prompt }] }),
    response({ type: 'function_call', name: 'exec_command', call_id: '1', arguments: JSON.stringify({ cmd: 'cat -- /task' }) }),
    response({ type: 'function_call_output', call_id: '1', output: JSON.stringify({ exit_code: 0, output: 'task\n' }) }),
    response({ type: 'function_call', name: 'exec_command', call_id: '2', arguments: JSON.stringify({ cmd: "node /bridge.mjs call /run finish - <<'FAFF_JSON'\n{}\nFAFF_JSON" }) }),
    response({ type: 'function_call_output', call_id: '2', output: JSON.stringify({ exit_code: 0, output: '{"finished":true}\n' }) }),
    { type: 'event_msg', payload: { type: 'task_complete' } },
  ];
}
test('Sol audit requires the requested Sol medium identity, without accepting Astra or another effort', () => {
  assert.equal(auditSolEvents(events(), sample).status, 'pass');
  for (const pair of [['gpt-6-astra', 'low'], ['gpt-6.1-sol', 'low'], ['gpt-6-sol', 'medium'], ['gpt-6.1-sol', 'high']]) {
    const result = auditSolEvents(events(...pair), sample);
    assert.equal(result.status, 'fail');
    assert.ok(result.problems.some(p => p.problem === 'model-or-effort-differs'));
  }
});
test('Sol expectation correction retains every transport and delivery rejection', () => {
  for (const mutate of [
    rows => { rows[3].payload.arguments = JSON.stringify({ cmd: 'cat /secret' }); },
    rows => { rows[4].payload.output = JSON.stringify({ exit_code: 0, output: 'truncated' }); },
    rows => { rows.splice(6, 1); },
    rows => { rows[0].payload.cli_version = 'unknown'; },
  ]) {
    const rows = events(); mutate(rows);
    assert.notEqual(auditSolEvents(rows, sample).status, 'pass');
  }
});

test('matrix native audit binds each declared model and effort without inferring missing expectations', () => {
  for (const [model, effort] of [['gpt-6.1-sol', 'low'], ['gpt-6.1-sol', 'medium'], ['gpt-6.1-sol', 'high'], ['gpt-6-astra', 'low'], ['gpt-6-astra', 'medium'], ['gpt-6.1-terra', 'medium']]) {
    const expected = { ...sample, expected_model: model, expected_effort: effort };
    assert.equal(auditExpectedModelEvents(events(model, effort), expected).status, 'pass');
    assert.equal(auditExpectedModelEvents(events(model, effort === 'low' ? 'high' : 'low'), expected).status, 'fail');
    const bad = events(model, effort); bad[3].payload.arguments = JSON.stringify({ cmd: 'cat /secret' });
    assert.equal(auditExpectedModelEvents(bad, expected).status, 'fail');
  }
  assert.equal(auditExpectedModelEvents(events(), sample).status, 'fail');
  assert.equal(auditExpectedModelEvents(events('unknown', 'medium'), { ...sample, expected_model: 'unknown', expected_effort: 'medium' }).status, 'fail');
});
