import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { consumePrdArtifact } from '../../../eval/control-parity/prd-producer.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const [baselineArg, candidateArg, outputArg, mode] = process.argv.slice(2);
if (!outputArg || mode && mode !== '--preflight') throw new Error('usage: replay-prd-run-start.mjs BASELINE_PLAN CANDIDATE_PLAN NEW_DIRECTORY [--preflight]');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const root = import.meta.dirname, output = resolve(outputArg);
const plans = [baselineArg, candidateArg].map(path => ({ path: resolve(path), value: read(resolve(path)) }));
assert.equal(plans[0].value.runtime_root, plans[1].value.runtime_root);
assert.equal(plans[0].value.runtime_commit, plans[1].value.runtime_commit);
const binding = bindCandidateCommand(plans[0].value.runtime_root, plans[0].value.runtime_commit);
const inputs = [];
for (const plan of plans) {
  assert.equal(plan.value.samples.length, 5);
  const fixture = read(join(root, plan.value.fixture));
  assert.equal(fixture.cases.length, 6);
  for (const sample of plan.value.samples) {
    if (mode && inputs.length) break;
    const directory = join(root, 'workflow-runs', sample.name);
    const reportPath = join(directory, 'report.json'), auditPath = join(directory, 'native-audit.json');
    assert.equal(read(reportPath).status, 'pass');
    const audit = read(auditPath);
    assert.equal(audit.runs.length, 1);
    assert.equal(audit.runs[0].status, 'pass');
    for (const item of fixture.cases) {
      const path = join(directory, 'artifacts', item.id + '.md');
      inputs.push({ name: sample.name, arm: sample.arm, case_id: item.id, expected_admissible: item.expected.verdict === 'admissible', path, sha256: sha256(readFileSync(path)), report_sha256: sha256(readFileSync(reportPath)), native_audit_sha256: sha256(readFileSync(auditPath)) });
    }
  }
}
assert.equal(inputs.length, mode ? 6 : 60);
mkdirSync(output);
const cli = (args, input) => {
  const result = spawnSync(process.execPath, [join(binding.root, 'plugin/skills/faff/bin/faff'), ...args], { cwd: output, input, encoding: 'utf8', timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
  return { args, input: input ?? null, exit_code: result.status, stdout: result.stdout, stderr: result.stderr, value: JSON.parse(result.stdout) };
};
const coverage = [
  { id: 'uncovered', live: [], expected: false },
  { id: 'covered', live: [{ id: '0001', prd_goal: 'g1', dod_verdict: 'met' }], expected: true },
].map(row => {
  const result = cli(['prdr', 'coverage', '--prd-goals', '["g1"]', '--live-prdrs', JSON.stringify(row.live)]);
  assert.equal(result.exit_code, 0);
  assert.equal(result.value.covered, row.expected);
  const contract = cli(['contract', 'prd-coverage'], result.stdout);
  assert.equal(contract.exit_code, 0);
  assert.equal(contract.value.conformant, true);
  return { ...row, result, contract };
});
write(join(output, 'manifest.json'), { schema: 1, mode: mode ? 'preflight' : 'actual-artifact-replay', binding, script_sha256: sha256(readFileSync(new URL(import.meta.url))), plans: plans.map(p => ({ path: p.path, sha256: sha256(readFileSync(p.path)) })), coverage, inputs });
const rows = [];
for (const input of inputs) {
  const text = readFileSync(input.path, 'utf8');
  assert.equal(sha256(text), input.sha256);
  const consumption = consumePrdArtifact(binding.root, text, output);
  assert.equal(consumption.pass, true);
  const admissible = consumption.value.verdict === 'admissible';
  assert.equal(admissible, input.expected_admissible);
  for (const context of ['uncovered', 'covered', 'inward', 'unmeasurable']) {
    const covered = coverage.find(c => c.id === (context === 'covered' ? 'covered' : 'uncovered')).result.value.covered;
    const signals = { target_resolved: true, outward: context !== 'inward', prd_present: true, prd_ambiguous: false, prd_admissible: admissible, coverage_measurable: context !== 'unmeasurable', coverage_covered: covered };
    const expected = context === 'inward' ? { verdict: 'refuse', reason: 'self-directed' }
      : !input.expected_admissible ? { verdict: 'refuse', reason: 'prd-inadmissible' }
      : context === 'unmeasurable' ? { verdict: 'refuse', reason: 'coverage-unmeasurable' }
      : context === 'covered' ? { verdict: 'drain', reason: 'prd-covered' } : { verdict: 'plan', reason: 'coverage-thin' };
    const trigger = cli(['run-start', '--signals', JSON.stringify(signals)]);
    assert.equal(trigger.exit_code, 0);
    assert.deepEqual({ verdict: trigger.value.verdict, reason: trigger.value.reason }, expected);
    const validated = cli(['contract', 'run-trigger'], trigger.stdout);
    assert.equal(validated.exit_code, 0);
    assert.equal(validated.value.conformant, true);
    assert.deepEqual({ verdict: validated.value.verdict, reason: validated.value.reason }, expected);
    const forged = cli(['contract', 'run-trigger'], JSON.stringify({ ...trigger.value, verdict: expected.verdict === 'refuse' ? 'plan' : 'refuse', reason: expected.verdict === 'refuse' ? 'coverage-thin' : 'self-directed' }));
    assert.equal(forged.exit_code, 1);
    assert.equal(forged.value.conformant, false);
    assert.deepEqual({ verdict: forged.value.verdict, reason: forged.value.reason }, expected);
    rows.push({ ...input, context, status: 'pass', prd_consumer: consumption, trigger, validated, forged });
  }
}
assertCandidateCommandUnchanged(binding);
const report = { schema: 1, status: 'pass', mode: mode ? 'preflight' : 'actual-artifact-replay', artifacts: inputs.length, trigger_cases: rows.length, forged_decisions_rejected: rows.length, rows, limits: ['Actual measured PRD artifacts feed the real prd-readiness validator, run-start predicate and run-trigger validator; coverage is computed by the real prdr coverage CLI over controlled inputs.', 'Target direction and coverage contexts are controlled. The caller wiring is deterministic; no new model sample, run mint, tracker acquisition or full beep-boop workflow is claimed.'] };
write(join(output, 'report.json'), report);
console.log(JSON.stringify({ status: report.status, mode: report.mode, artifacts: report.artifacts, trigger_cases: report.trigger_cases }));
