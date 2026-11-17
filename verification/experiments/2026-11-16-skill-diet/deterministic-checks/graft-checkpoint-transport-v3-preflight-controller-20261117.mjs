import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd(), E = 'verification/experiments/2026-11-16-skill-diet';
const { runGraftCheckpoints } = await import(join(root, 'eval/control-parity/graft-checkpoint-execution-v3.mjs'));
const { createMcpMailbox } = await import(join(root, 'eval/control-parity/mailbox-mcp.mjs'));
const plan = JSON.parse(readFileSync(join(E, 'graft-checkpoints-mcp-v2-baseline-plan.json')));
const fixturePath = join(E, 'workflow-fixtures/graft-checkpoints-v3-draft.json');
const fixture = JSON.parse(readFileSync(fixturePath));
const output = join(E, process.argv[2] ?? 'graft-checkpoints-transport-v3-preflight-20261117-1');
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const pending = runGraftCheckpoints({ root: plan.runtime_root, commit: plan.runtime_commit, policyPath: resolve(E, plan.samples[0].policy), fixturePath: resolve(fixturePath), output: resolve(output) });
while (!existsSync(join(output, 'requests'))) await delay(20);
const bridge = createMcpMailbox(resolve(output));
let rpcId = 0;
const port = async (name, args) => {
  const envelope = await bridge.call(++rpcId, name, args);
  if (envelope.isError) throw new Error(envelope.content[0].text);
  const value = JSON.parse(envelope.content[0].text);
  if (name === 'read_case') write('read-case-' + args.case_id + '-mcp-result.json', envelope);
  return value;
};
let offset = 0;
do { offset = (await port('read_policy', { offset })).next_offset; } while (offset !== null);
const publicCases = [];
for (const id of [...fixture.cases.map(row => row.id), ...fixture.reconciliation.case_ids]) publicCases.push(await port('read_case', { case_id: id }));
const env = { publicCases, call: port };
write('public-cases.json', publicCases);
  const command = (case_id, command_id, input = '') => env.call('run_command', { case_id, command_id, input });
  for (const row of fixture.cases) {
    const id = row.id;
    let result;
    if (row.kind === 'dispatched') {
      await command(id, 'heartbeat');
      const gates = await command(id, 'gates');
      await command(id, 'heartbeat');
      await command(id, 'quality-contract', JSON.stringify(JSON.parse(gates.stdout).contract));
      await command(id, 'spec-verify');
      const classified = JSON.parse((await command(id, 'classify')).stdout).criteria;
      const checked = await command(id, 'check-ac');
      const criteria = classified.map((ac, index) => ({ ac: ac.text, ac_id: ac.ac_id, passed: index === 0, verified: index === 0 ? 'Arithmetic command passed: ' + checked.stdout.trim() : 'Needs human verification: published prices were not inspected', verifications: index === 0 ? [{ kind: 'command', locator: JSON.stringify(JSON.parse(env.publicCases.find(value => value.id === id).source.check_locator)).replaceAll(',', ', ') }] : [{ kind: 'human' }] }));
      await command(id, 'write-ac', JSON.stringify({ all_verified: false, criteria }));
      for (const name of ['render-ac', 'review-handoff', 'pr-handoff']) await command(id, name);
      result = { issue: 'FAFF-9', pr: 11, token: 'pr-ready', evidence_return: (await command(id, 'evidence-return')).stdout };
    } else if (row.kind.startsWith('gate-')) {
      const gates = await command(id, 'gates');
      result = { continued: false, gate_contract: (await command(id, 'quality-contract', JSON.stringify(JSON.parse(gates.stdout).contract))).stdout };
    } else {
      let returned, verification = null, status;
      if (row.kind === 'evidence-refusal') {
        await command(id, 'write-ac', JSON.stringify(row.source.supplied_input));
        returned = (await command(id, 'evidence-return')).stdout;
        status = 'writer-refused';
      } else {
        returned = row.kind === 'evidence-tamper' ? env.publicCases.find(value => value.id === id).source.returned_before_change : (await command(id, 'evidence-return')).stdout;
        verification = (await command(id, 'verify-return', returned)).stdout;
        status = row.kind === 'evidence-tamper' ? 'tampered' : 'absent';
      }
      result = { continued: false, evidence_status: status, evidence_return: returned, verification };
    }
    await env.call('submit_result', { case_id: id, result: { ...result, follow_up: 'Apply the supplied policy to the recorded checkpoint result.' } });
  }
  const ledgerFixture = JSON.parse(readFileSync(fixture.reconciliation.fixture));
  for (const id of fixture.reconciliation.case_ids) {
    const publicCase = env.publicCases.find(row => row.id === id);
    await env.call('read_ledger', { case_id: id });
    await env.call('write_ledger', { case_id: id, patch: ledgerFixture.cases.find(row => row.id === id).oracle.patch });
    await env.call('append_event', { case_id: id, transition_id: 'ledger-edit', executable: join(plan.runtime_root, 'plugin/skills/faff/bin/faff'), args: ['events', 'append', '--run', publicCase.run_id, '--root', publicCase.root], payload: { phase: 'run', type: 'ledger-write' } });
  }
  for (const row of fixture.rule_cases) await env.call('answer_rule', { id: row.id, value: row.expected });
  await env.call('finish', {});
  const report = await pending;
  const grade = report.grade;
  const inputs = ['eval/control-parity/graft-checkpoint-execution-v3.mjs', 'test/control-parity-graft-checkpoint-v3.test.mjs', fixturePath, fixture.reconciliation.fixture, fixture.reconciliation.dependencies, join(E, 'graft-evidence-consumer-reuse-notes.json'), 'eval/control-parity/ledger-execution.mjs', 'eval/control-parity/ledger-execution-v2.mjs', 'eval/control-parity/candidate-command.mjs', 'eval/control-parity/policy-reader.mjs', 'eval/control-parity/interactive-handoff.mjs', 'eval/control-parity/mailbox-mcp.mjs', 'eval/control-parity/schema.mjs', relative(root, import.meta.filename)];
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  write('preflight.json', { schema: 1, status: grade.status, scope: 'Zero-model controller using actual policy delivery, case reads, existing MCP envelope/mailbox transport and real CLI consumers. No model/native Codex session, hosted review/PR, lifecycle or cut qualification.', root_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), commands: [[process.execPath, relative(root, import.meta.filename), ...(process.argv.slice(2))]], cases: grade.cases.length, inputs: inputs.map(path => ({ path, sha256: hash(path) })), outputs: ['task.json', 'public-cases.json', 'capture.json', 'consumers.json', 'report.json', 'mcp-trace.jsonl', 'mcp-server-manifest.json', ...fixture.cases.map(row => 'read-case-' + row.id + '-mcp-result.json'), ...fixture.reconciliation.case_ids.map(id => 'read-case-' + id + '-mcp-result.json')].map(name => ({ path: join(output, name), sha256: hash(join(output, name)) })), limitations: fixture.limits, manual_detail_gate_required: true });
  console.log(JSON.stringify({ status: grade.status, cases: grade.cases.length, problems: grade.problems, failed: grade.cases.filter(row => !row.pass), output }));
  if (grade.status !== 'pass') process.exitCode = 1;

