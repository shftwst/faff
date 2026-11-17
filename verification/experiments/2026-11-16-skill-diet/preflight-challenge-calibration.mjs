import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';
import { runChallengeCalibration } from '../../../eval/control-parity/challenge-calibration-execution.mjs';
import { gradeChallengeExecution } from '../../../eval/control-parity/challenge-execution.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const execute = promisify(execFile), evidence = import.meta.dirname;
const root = resolve(evidence, '../../..'), output = resolve(process.argv[2]);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const original = read(join(evidence, 'challenges-file-input-v4-stable-plan.json'));
const fixturePath = join(evidence, original.fixture), fixture = read(fixturePath);
const running = runChallengeCalibration({ root: original.runtime_root, commit: original.runtime_commit,
  policyPath: join(evidence, original.samples[0].policy), fixturePath, output });
const task = read(join(output, 'task.json'));
const originalTask = read(join(evidence, 'workflow-runs', original.samples[0].name, 'task.json'));
assert.deepEqual(task.cases, originalTask.cases);
assert.deepEqual(task.policy, originalTask.policy);
assert.deepEqual(task.tools.map(({ description, ...tool }) => tool), originalTask.tools.map(({ description, ...tool }) => tool));
const call = async (name, value) => {
  const { stdout } = await execute(process.execPath, [join(root, 'eval/control-parity/mailbox-call.mjs'), 'call', output, name, JSON.stringify(value)], { maxBuffer: 1024 * 1024 });
  return JSON.parse(stdout);
};
let offset = 0;
while (offset !== null) offset = (await call('read_policy', { offset })).next_offset;
for (const row of fixture.cases) {
  await call('describe_contract', { case_id: row.id });
  await call('submit_challenge', { case_id: row.id, outcome: row.expected.outcome, ground: row.expected.ground, reason: 'Deterministic reference preflight; not model judgement.' });
}
await call('finish', {});
const report = await running;
assert.equal(report.status, 'pass');
const oldGrade = read(join(evidence, 'workflow-runs', original.samples[0].name, 'report.json')).grade;
assert.deepEqual(report.grade.cases, oldGrade.cases);
const capture = read(join(output, 'capture.json'));
for (const row of fixture.cases) {
  const changed = structuredClone(capture);
  changed.cases.find(item => item.id === row.id).result.challenge.outcome = row.expected.outcome === 'survived' ? 'overturned' : 'survived';
  assert.equal(gradeChallengeExecution(changed, fixture).status, 'fail');
}
const result = { status: 'pass', kind: 'deterministic-preflight-not-model-sample', actual_cli_cases: fixture.cases.length,
  altered_outcomes_rejected: fixture.cases.length, original_opus_effect_projection_equal: true,
  task_case_policy_and_tool_schemas_unchanged: true,
  manifest_sha256: sha256(readFileSync(join(output, 'manifest.json'))), report_sha256: sha256(readFileSync(join(output, 'report.json'))) };
writeFileSync(join(output, 'preflight.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
