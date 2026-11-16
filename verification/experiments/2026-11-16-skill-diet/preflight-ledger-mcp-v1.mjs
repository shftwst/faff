import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runLedgerExecution, gradeLedgerExecution } from '../../../eval/control-parity/ledger-execution.mjs';
import { createMcpMailbox } from '../../../eval/control-parity/mailbox-mcp.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, output = resolve(process.argv[2]);
const read = path => JSON.parse(readFileSync(path));
const fixturePath = join(evidence, 'workflow-fixtures/beep-ledger-v2-draft.json'), fixture = read(fixturePath);
const plan = read(join(evidence, 'beep-reporting-mcp-v1-baseline-plan.json'));
const running = runLedgerExecution({ root: plan.runtime_root, commit: plan.runtime_commit, policyPath: join(evidence, 'baseline/beep-reporting-with-context.md'), fixturePath, dependencyPath: join(evidence, 'workflow-fixtures/beep-ledger-summary-dependencies-v2.json'), output });
const task = read(join(output, 'task.json')), mcp = createMcpMailbox(output);
let calls = 0;
async function call(name, args) {
  const result = await mcp.call(++calls, name, args);
  assert.equal(result.isError, false);
  return JSON.parse(result.content[0].text);
}
let offset = 0;
while (offset !== null) offset = (await call('read_policy', { offset })).next_offset;
for (const row of fixture.cases) {
  const state = task.cases.find(item => item.id === row.id);
  await call('read_ledger', { case_id: row.id });
  const emit = (id, payload, tokens) => call('append_event', { case_id: row.id, transition_id: id, executable: task.resolved_executable, args: ['events', 'append', '--run', state.run_id, '--root', state.root, ...(tokens ? ['--tokens', '--session-id', state.session_id] : [])], payload });
  if (row.kind === 'ledger') {
    await call('write_ledger', { case_id: row.id, patch: row.oracle.patch });
    await emit('ledger-edit', { phase: 'run', type: 'ledger-write' }, false);
  } else {
    for (const transition of row.oracle.transitions) {
      if (transition.expected) await emit(transition.id, transition.expected, transition.tokens);
      else await call('skip_transition', { case_id: row.id, transition_id: transition.id, reason: 'No workflow transition.' });
    }
  }
}
for (const row of fixture.rule_cases) await call('answer_rule', { id: row.id, value: row.expected });
await call('finish', {});
const report = await running, capture = read(join(output, 'capture.json')), expected = read(join(output, 'expected.json'));
assert.equal(report.status, 'pass');
for (const row of fixture.cases) {
  const changed = structuredClone(capture); changed.cases = changed.cases.filter(item => item.id !== row.id);
  assert.equal(gradeLedgerExecution(changed, expected, fixture).status, 'fail');
}
for (const row of fixture.rule_cases) {
  const changed = structuredClone(capture); changed.decisions = changed.decisions.filter(item => item.id !== row.id);
  assert.equal(gradeLedgerExecution(changed, expected, fixture).status, 'fail');
}
const paths = ['mcp-trace.jsonl', 'mcp-server-manifest.json', 'task.json', 'manifest.json', 'capture.json', 'expected.json', 'report.json'];
const result = { schema: 1, status: 'pass', scope: 'Deterministic reference producer MCP preflight only, no model sample or source acceptance. Real CLI consumers; controlled transcripts and external summary inputs.', calls, execution_cases: fixture.cases.length, decisions: fixture.rule_cases.length, omitted_cases_rejected: fixture.cases.length + fixture.rule_cases.length, client_sha256: sha256(readFileSync(new URL(import.meta.url))), hashes: Object.fromEntries(paths.map(path => [path, sha256(readFileSync(join(output, path)))])) };
writeFileSync(join(output, 'preflight.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, calls, execution_cases: result.execution_cases, decisions: result.decisions }));
