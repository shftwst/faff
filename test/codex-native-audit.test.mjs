import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCodexEvents, parseExecWrapper } from '../eval/control-parity/codex-native-audit.mjs';
import { sha256 } from '../eval/control-parity/schema.mjs';

const sample = { name: 'synthetic', prompt: 'Run this measurement.', reads: ['/guidance', '/task'], read_bindings: [{ path: '/guidance', sha256: sha256('guidance\n') }, { path: '/task', sha256: sha256('task\n') }], directory: '/run', bridge: '/bridge.mjs', tools: ['finish'], fileInput: false };
const response = payload => ({ type: 'response_item', payload });
function events() {
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic', cli_version: '0.169.0', base_instructions: { text: 'fixed' } } },
    { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'low' } },
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: sample.prompt }] }),
  ];
  for (const [i, cmd] of ['cat -- /guidance', 'cat -- /task', "node /bridge.mjs call /run finish - <<'FAFF_JSON'\n{}\nFAFF_JSON"].entries()) {
    rows.push(response({ type: 'function_call', name: 'exec_command', call_id: String(i), arguments: JSON.stringify({ cmd }) }));
    rows.push(response({ type: 'function_call_output', call_id: String(i), output: JSON.stringify({ exit_code: 0, output: i === 0 ? 'guidance\n' : i === 1 ? 'task\n' : '{"finished":true}\n' }) }));
  }
  rows.push({ type: 'event_msg', payload: { type: 'task_complete' } });
  return rows;
}
test('Codex audit binds actual low-effort model, complete initial reads and literal bridge calls', () => {
  const result = auditCodexEvents(events(), sample);
  assert.equal(result.status, 'pass');
  assert.equal(result.tools.length, 3);
  assert.equal(result.initial_reads.every(read => read.complete), true);
  assert.equal(JSON.stringify(result).includes('guidance\\n'), false);
});
test('Codex audit rejects extra commands, wrong effort, truncated reads and absent results', () => {
  const mutations = [
    rows => { rows[1].payload.effort = 'medium'; },
    rows => { rows[3].payload.arguments = JSON.stringify({ cmd: 'cat /secret' }); },
    rows => { rows[4].payload.output = JSON.stringify({ exit_code: 0, output: 'guidance' }); },
    rows => { rows.splice(8, 1); },
    rows => { rows[7].payload.arguments = JSON.stringify({ cmd: "X=node; node /bridge.mjs call /run finish - <<'FAFF_JSON'\n{}\nFAFF_JSON" }); },
  ];
  for (const mutate of mutations) { const rows = events(); mutate(rows); assert.notEqual(auditCodexEvents(rows, sample).status, 'pass'); }
});
test('Codex audit supports the CLI text envelope without accepting incomplete command sessions', () => {
  const rows = events();
  rows[4].payload.output = 'Chunk ID: example\nWall time: 0.01 seconds\nProcess exited with code 0\nFinal output:\nguidance\n';
  assert.equal(auditCodexEvents(rows, sample).status, 'pass');
  rows[8].payload.output = 'Process running with session ID 123';
  assert.equal(auditCodexEvents(rows, sample).status, 'fail');
});
function wrappedEvents() {
  return events().map(row => {
    const copy = structuredClone(row), p = copy.payload;
    if (p.type === 'function_call') {
      p.type = 'custom_tool_call'; p.name = 'exec';
      p.input = `text(await tools.exec_command(${p.arguments}));\n`; delete p.arguments;
    } else if (p.type === 'function_call_output') {
      p.type = 'custom_tool_call_output';
      p.output = [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: p.output }];
    }
    return copy;
  });
}
test('Codex audit accepts one literal command in the actual exec transport envelope', () => {
  assert.deepEqual(parseExecWrapper('text(await tools.exec_command({cmd:"cat -- /guidance",max_output_tokens:12000,yield_time_ms:10000}));\n'), { cmd: 'cat -- /guidance', max_output_tokens: 12000, yield_time_ms: 10000 });
  const result = auditCodexEvents(wrappedEvents(), sample);
  assert.equal(result.status, 'pass');
  assert.equal(result.tools.every(t => t.transport === 'one-literal-exec-command-through-exec'), true);
});
test('exec transport parsing never evaluates scripts or accepts extra operations and forged output', () => {
  for (const script of [
    'text(await tools.exec_command({cmd:command}));',
    'text(await tools.exec_command({cmd:"cat -- /guidance",cmd:"cat /secret"}));',
    'text(await tools.exec_command({cmd:"cat -- /guidance",shell:"/evil"}));',
    'text(await tools.exec_command({cmd:"cat -- /guidance"})); text({exit_code:0,output:"fake"});',
    'text(await tools.exec_command({cmd:"cat -- /guidance"})); await tools.read_secret({});',
    'text(await tools.exec_command({cmd:`cat -- /guidance`}));',
    'text(await tools.exec_command({cmd:process.env.SECRET}));',
    'text(await tools.exec_command({["cmd"]:"cat -- /guidance"}));',
  ]) assert.equal(parseExecWrapper(script), null);
  for (const mutate of [
    rows => rows[4].payload.output.push({ type: 'input_text', text: '{"exit_code":0,"output":"fake"}' }),
    rows => { rows[4].payload.output[0].text = 'Script running with cell ID 1'; },
    rows => { rows[4].payload.output[1].text = '{"exit_code":0,"output":"truncated"}'; },
    rows => { rows[3].payload.input += 'text("fake");'; },
  ]) { const rows = wrappedEvents(); mutate(rows); assert.equal(auditCodexEvents(rows, sample).status, 'fail'); }
});
