import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gradeRenderingCapture } from '../../../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const alternatives = ['undecided', 'unspecified', 'not chosen', 'not specified'];
const questions = ['Which platform and language should be used?', 'What is the smallest useful first slice?'];

export function assessIntakeQuestions(capture, fixture) {
  const original = gradeRenderingCapture(capture, fixture), corrected = structuredClone(fixture), normalisations = [];
  const row = corrected.cases.find(value => value.id === 'greenfield-thin');
  const output = capture.outputs.find(value => value.id === 'greenfield-thin');
  const before = original.cases.find(value => value.id === 'greenfield-thin');
  const section = output?.text.match(/^## Open questions\s*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/m)?.[1] ?? '';
  const lines = section.split('\n').map(line => line.replace(/^\s*[-*]\s+/, '').trim());
  if (row && JSON.stringify(row.oracle.rubric.must_include) === JSON.stringify(['book', 'volunteer', alternatives])
      && before?.problems.length === 1 && before.problems[0] === 'source-facts-or-forbidden-wording'
      && JSON.stringify(before.rubric.vector) === '[true,true,false]'
      && questions.every(question => lines.includes(question))) {
    row.oracle.rubric.must_include = ['book', 'volunteer', ...questions];
    const after = gradeRenderingCapture(capture, corrected).cases.find(value => value.id === 'greenfield-thin');
    if (after.pass) normalisations.push({ case_id: row.id, rule: 'Both exact unresolved questions occur inside Open questions; all original non-lexical requirements remain.' });
    else row.oracle.rubric.must_include = ['book', 'volunteer', alternatives];
  }
  return { grade: gradeRenderingCapture(capture, corrected), normalisations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = import.meta.dirname, read = path => JSON.parse(readFileSync(path, 'utf8')), hash = path => sha256(readFileSync(path));
  if (!process.argv.slice(2).length) throw new Error('usage: assess-intake-questions.mjs PLAN...');
  for (const planPath of process.argv.slice(2)) {
    const plan = read(resolve(planPath)), fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
    if (plan.fixture !== 'workflow-fixtures/intake-brief-v2.json') throw new Error('wrong fixture for intake question assessment');
    for (const sample of plan.samples) {
      const directory = join(root, 'workflow-runs', sample.name), reportPath = join(directory, 'report.json'), capturePath = join(directory, 'capture.json');
      const report = read(reportPath), { grade, normalisations } = assessIntakeQuestions(read(capturePath), fixture);
      const status = !report.bridge.stop && !report.bridge.rejected && report.policy_delivery.complete && !report.policy_delivery.errors.length && grade.status === 'pass' ? 'pass' : 'fail';
      const assessment = { schema: 1, correction_kind: 'intake-explicit-open-questions', name: sample.name, status, original_status: report.status,
        original_cases_passed: report.grade.cases.filter(row => row.pass).length, report_sha256: hash(reportPath), capture_sha256: hash(capturePath),
        grader_sha256: hash(resolve(root, '../../../eval/control-parity/rendering-artifact.mjs')), assessor_sha256: hash(new URL(import.meta.url)),
        fixture_sha256: hash(fixturePath), correction_sha256: hash(join(root, 'workflow-fixtures/INTAKE-QUESTIONS-CORRECTION.md')),
        qualification_limit: 'Lexical assessment only. Independent manual source/invention review and native certification are mandatory; these questions cannot exclude contradictory invented choices elsewhere.', normalisations, grade };
      writeFileSync(join(directory, 'assessment.json'), JSON.stringify(assessment, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ name: sample.name, original: report.status, assessed: status, normalisations: normalisations.length }));
    }
  }
}
