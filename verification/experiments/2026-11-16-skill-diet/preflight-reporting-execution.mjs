import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runReportingExecution, canonicalFacts, gradeReportingExecution } from '../../../eval/control-parity/reporting-execution.mjs';
import { callMailbox } from '../../../eval/control-parity/interactive-handoff.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, output = resolve(process.argv[2]);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const plan = read(join(evidence, 'beep-reporting-sol-v1-baseline-plan.json')), fixture = read(join(evidence, plan.fixture));
const running = runReportingExecution({ root: plan.runtime_root, commit: plan.runtime_commit,
  policyPath: join(evidence, plan.samples[0].policy), fixturePath: join(evidence, plan.fixture), output });
const task = read(join(output, 'task.json'));
let offset = 0;
while (offset !== null) offset = (await callMailbox(output, 'read_policy', { offset })).next_offset;
for (const row of fixture.cases) {
  const visible = task.cases.find(value => value.id === row.id);
  const call = (name, args) => callMailbox(output, name, { case_id: row.id, ...args });
  if (row.action === 'continue') {
    await call('continue_build', { issue_ids: row.queue });
    continue;
  }
  await call('write_facts', { value: canonicalFacts(row.expected_facts) });
  const result = await call('run_faff', { executable: task.resolved_executable, args: ['run', 'summary', '--run-dir', visible.run_dir, '--facts', visible.facts_path, '--root', visible.root] });
  if (row.action === 'fault') {
    assert.equal(result.exit_code, 2);
    await call('report_failure', { reason: 'Unreadable run ledger.' });
    continue;
  }
  assert.equal(result.exit_code, 0);
  assert.equal(result.stdout, result.persisted);
  for (const channel of ['tracker', 'conversation']) {
    const normalised = await call('normalise_output', { channel, text: result.stdout.trimEnd() + (channel === 'tracker' ? '\n\n' + row.economics_line : '') });
    await call('publish', { channel, target: channel === 'tracker' ? row.target : 'conversation', normalised_id: normalised.id });
  }
}
await callMailbox(output, 'finish', {});
const report = await running;
assert.equal(report.status, 'pass', JSON.stringify(report));
const capture = read(join(output, 'capture.json')), expected = read(join(output, 'expected.json'));
for (const row of fixture.cases) {
  const changed = structuredClone(capture);
  changed.events = changed.events.filter(event => event.case_id !== row.id);
  assert.equal(gradeReportingExecution(changed, expected, fixture).status, 'fail');
}
const result = { schema: 1, status: 'pass', kind: 'deterministic-full-transport-preflight-not-model-sample', execution_cases: fixture.cases.length,
  omitted_case_traces_rejected: fixture.cases.length, policy_delivery_complete: report.policy_delivery.complete,
  task_file_sha256_matches_manifest: sha256(readFileSync(join(output, 'task.json'))) === read(join(output, 'manifest.json')).task_sha256,
  manifest_sha256: sha256(readFileSync(join(output, 'manifest.json'))), report_sha256: sha256(readFileSync(join(output, 'report.json'))),
  capture_sha256: sha256(readFileSync(join(output, 'capture.json'))), client_sha256: sha256(readFileSync(new URL(import.meta.url))) };
assert.equal(result.task_file_sha256_matches_manifest, true);
writeFileSync(join(output, 'preflight.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
