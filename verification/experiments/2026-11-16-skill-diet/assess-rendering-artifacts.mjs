import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gradeRenderingCapture } from '../../../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const root = import.meta.dirname;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => sha256(readFileSync(path));
if (!process.argv.slice(2).length) throw new Error('usage: assess-rendering-artifacts.mjs PLAN...');
for (const planPath of process.argv.slice(2)) {
  const plan = read(resolve(planPath)), fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
  for (const sample of plan.samples) {
    const directory = join(root, 'workflow-runs', sample.name);
    const reportPath = join(directory, 'report.json'), capturePath = join(directory, 'capture.json');
    const report = read(reportPath), capture = read(capturePath), normalisations = [];
    for (const answer of capture.rule_answers) {
      if (answer.id === 'voice-source' && isDeepStrictEqual(answer.value, { file: 'AGENTS.md', heading: '# Writing style' })) {
        normalisations.push({ case_id: answer.id, original: structuredClone(answer.value), rule: 'Markdown heading marker is not part of the section name.' });
        answer.value.heading = 'Writing style';
      }
    }
    const grade = gradeRenderingCapture(capture, fixture);
    const status = !report.bridge.stop && !report.bridge.rejected && report.policy_delivery.complete && !report.policy_delivery.errors.length && grade.status === 'pass' ? 'pass' : 'fail';
    const assessment = {
      schema: 1, name: sample.name, status, original_status: report.status,
      original_cases_passed: report.grade.cases.filter(c => c.pass).length,
      report_sha256: hash(reportPath), capture_sha256: hash(capturePath),
      grader_sha256: hash(resolve(root, '../../../eval/control-parity/rendering-artifact.mjs')),
      assessor_sha256: hash(new URL(import.meta.url)), fixture_sha256: hash(fixturePath),
      correction_sha256: hash(join(root, 'workflow-fixtures/RENDERING-ORACLE-CORRECTION.md')),
      normalisations, grade,
    };
    writeFileSync(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ name: sample.name, original: report.status, assessed: status, normalisations: normalisations.length }));
  }
}
