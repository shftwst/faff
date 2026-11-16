import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gradeRenderingCapture } from '../../../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
export function normaliseWtfCapture(original) {
  const capture = structuredClone(original), normalisations = [];
  for (const answer of capture.rule_answers) {
    if (answer.id === 'methodology-line' && answer.value === 'Methodology: ') {
      normalisations.push({ case_id: answer.id, original: answer.value, rule: 'The single trailing separator space is equivalent in this label-prefix question.' });
      answer.value = 'Methodology:';
    }
  }
  return { capture, normalisations };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = import.meta.dirname, read = path => JSON.parse(readFileSync(path, 'utf8')), hash = path => sha256(readFileSync(path));
  if (!process.argv.slice(2).length) throw new Error('usage: assess-wtf-format.mjs PLAN...');
  for (const planPath of process.argv.slice(2)) {
    const plan = read(resolve(planPath)), fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
    if (plan.fixture !== 'workflow-fixtures/wtf-format.json') throw new Error('wrong fixture for label assessment');
    for (const sample of plan.samples) {
      const directory = join(root, 'workflow-runs', sample.name), reportPath = join(directory, 'report.json'), capturePath = join(directory, 'capture.json');
      const report = read(reportPath), { capture, normalisations } = normaliseWtfCapture(read(capturePath)), grade = gradeRenderingCapture(capture, fixture);
      const status = !report.bridge.stop && !report.bridge.rejected && report.policy_delivery.complete && !report.policy_delivery.errors.length && grade.status === 'pass' ? 'pass' : 'fail';
      const assessment = { schema: 1, correction_kind: 'wtf-label-prefix', name: sample.name, status, original_status: report.status, original_cases_passed: report.grade.cases.filter(c => c.pass).length, report_sha256: hash(reportPath), capture_sha256: hash(capturePath), grader_sha256: hash(resolve(root, '../../../eval/control-parity/rendering-artifact.mjs')), assessor_sha256: hash(new URL(import.meta.url)), fixture_sha256: hash(fixturePath), correction_sha256: hash(join(root, 'workflow-fixtures/WTF-LABEL-CORRECTION.md')), normalisations, grade };
      writeFileSync(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ name: sample.name, original: report.status, assessed: status, normalisations: normalisations.length }));
    }
  }
}
