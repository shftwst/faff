import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gradeAdversarialExecution } from '../../../eval/control-parity/adversarial-execution.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const root = import.meta.dirname;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => sha256(readFileSync(path));
if (!process.argv.slice(2).length) throw new Error('usage: assess-adversarial-execution.mjs PLAN...');
for (const planPath of process.argv.slice(2)) {
  const plan = read(resolve(planPath));
  const fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
  for (const sample of plan.samples) {
    const directory = join(root, 'workflow-runs', sample.name);
    const reportPath = join(directory, 'report.json'), capturePath = join(directory, 'capture.json');
    const report = read(reportPath), capture = read(capturePath);
    const grade = gradeAdversarialExecution(capture, fixture);
    const status = !report.bridge.stop && report.bridge.rejected === grade.diagnostics.length && report.policy_delivery.complete && grade.status === 'pass' ? 'pass' : 'fail';
    const assessment = {
      schema: 1, name: sample.name, status, original_status: report.status,
      original_cases_passed: report.grade.cases.filter(c => c.pass).length,
      report_sha256: hash(reportPath), capture_sha256: hash(capturePath),
      grader_sha256: hash(resolve(root, '../../../eval/control-parity/adversarial-execution.mjs')),
      fixture_sha256: hash(fixturePath), correction_sha256: hash(join(root, 'workflow-fixtures/ORACLE-CORRECTION.md')),
      basis: 'Explicit oracle correction; original report and capture remain unchanged. See workflow-fixtures/ORACLE-CORRECTION.md.', grade,
    };
    writeFileSync(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ name: sample.name, original: report.status, assessed: status, cases: grade.cases.filter(c => c.pass).length, diagnostics: grade.diagnostics }));
  }
}
