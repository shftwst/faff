import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { canonicalHash, sha256 } from '../../../eval/control-parity/schema.mjs';

const read = path => JSON.parse(readFileSync(path, 'utf8'));
const root = import.meta.dirname;
const useAssessments = process.argv.includes('--assessments');
const args = process.argv.slice(2).filter(arg => arg !== '--assessments'), outIndex = args.indexOf('--out');
const output = outIndex < 0 ? null : args[outIndex + 1];
const planPaths = outIndex < 0 ? args : args.slice(0, outIndex);
if (!planPaths.length || outIndex >= 0 && !output) throw new Error('usage: summarise-workflow-execution.mjs PLAN... [--out NEW_FILE]');
const plans = planPaths.map(path => read(resolve(path)));
const samples = plans.flatMap(plan => plan.samples);
const names = samples.map(s => s.name);
if (new Set(names).size !== names.length) throw new Error('duplicate planned sample');
const runs = [], missing = [], problems = [];
for (const sample of samples) {
  const directory = join(root, 'workflow-runs', sample.name), reportPath = join(directory, 'report.json');
  if (!existsSync(reportPath) || !existsSync(join(directory, 'worker-final-screen.json'))) { missing.push(sample.name); continue; }
  const report = read(reportPath), manifest = read(join(directory, 'manifest.json')), capture = read(join(directory, 'capture.json'));
  const originalGrade = report.grade, originalStatus = report.status;
  let assessmentHash = null;
  if (useAssessments) {
    const path = join(directory, 'assessment.json'), assessment = read(path);
    const assessmentSources = {
      'adversarial-review-execution': ['adversarial-execution.mjs', 'ORACLE-CORRECTION.md'],
      'rendering-artifact-workflow': ['rendering-artifact.mjs', assessment.correction_kind === 'wtf-label-prefix' ? 'WTF-LABEL-CORRECTION.md' : 'RENDERING-ORACLE-CORRECTION.md'],
    }[manifest.kind];
    if (!assessmentSources || assessment.name !== sample.name || assessment.report_sha256 !== sha256(readFileSync(reportPath)) || assessment.capture_sha256 !== sha256(readFileSync(join(directory, 'capture.json'))) || assessment.fixture_sha256 !== manifest.fixture_sha256 || assessment.grader_sha256 !== sha256(readFileSync(resolve(root, '../../../eval/control-parity/', assessmentSources[0]))) || assessment.correction_sha256 !== sha256(readFileSync(join(root, 'workflow-fixtures', assessmentSources[1])))) throw new Error(`unbound assessment: ${sample.name}`);
    if (manifest.kind === 'rendering-artifact-workflow' && assessment.assessor_sha256 !== sha256(readFileSync(join(root, assessment.correction_kind === 'wtf-label-prefix' ? 'assess-wtf-format.mjs' : 'assess-rendering-artifacts.mjs')))) throw new Error(`unbound rendering assessor: ${sample.name}`);
    assessmentHash = sha256(readFileSync(path));
    report.grade = assessment.grade;
    report.status = assessment.status;
  }
  const policy = readFileSync(join(root, sample.policy)), text = policy.toString('utf8');
  const delivery = report.policy_delivery, runProblems = [];
  const expectedErrors = useAssessments ? (report.grade.diagnostics ?? []).map(d => d.error) : [];
  const deliveryErrors = (delivery?.errors ?? []).filter(error => {
    const index = error.name === 'read_file' ? expectedErrors.indexOf(error.message) : -1;
    if (index < 0) return true;
    expectedErrors.splice(index, 1);
    return false;
  });
  if (report.status !== 'pass') runProblems.push('effect-grade');
  if (!delivery?.complete || deliveryErrors.length || expectedErrors.length || !delivery?.reads?.length) runProblems.push('policy-delivery');
  if (manifest.policy_sha256 !== sha256(policy) || delivery?.sha256 !== sha256(policy)) runProblems.push('policy-binding');
  let cursor = 0;
  for (const chunk of delivery?.reads ?? []) {
    if (chunk.offset > cursor || chunk.end <= chunk.offset || chunk.end > text.length || chunk.characters > 6000 || sha256(text.slice(chunk.offset, chunk.end)) !== chunk.sha256) runProblems.push('invalid-policy-chunk');
    cursor = Math.max(cursor, chunk.end);
  }
  if (cursor !== text.length) runProblems.push('policy-coverage');
  let projection;
  if (manifest.kind === 'gateway-entry-execution') {
    projection = report.grade.cases.map(c => ({ id: c.id, actions: c.actions, final_files: c.final_files }));
  } else if (manifest.kind === 'adversarial-review-execution') {
    projection = report.grade.cases.map(c => {
      const state = capture.cases.find(s => s.id === c.id);
      const checkpoint = state.checkpoint ? structuredClone(state.checkpoint) : null;
      if (checkpoint) {
        delete checkpoint.updated_at;
        if (checkpoint.phase2.findings_ref) checkpoint.phase2.findings_ref = checkpoint.phase2.findings_ref.replace(state.files.findings, '<findings>');
      }
      return { id: c.id, signal: c.signal, helper_exits: c.helper_exits, checkpoints: c.checkpoints, checkpoint, gate: c.gate, outage: state.verdict?.adversarial_outcome ?? null };
    });
  } else if (manifest.kind === 'challenge-judgement-and-consumption') {
    projection = report.grade.cases.map(({ id, outcome, ground, disposition, upper_admit }) => ({ id, outcome, ground, disposition, upper_admit }));
  } else if (manifest.kind === 'kernel-config-execution') {
    projection = report.grade.cases.map(c => {
      if (c.kind !== 'decision') return { id: c.id, kind: c.kind, effects: c.effects, status: c.status, values: c.values, final_files: c.final_files };
      const value = structuredClone(c.value);
      if (c.id === 'architecture-proposal' && typeof value?.materialising_stage === 'string') value.materialising_stage = value.materialising_stage.replace(/^faff-graft\b/, 'graft');
      return { id: c.id, kind: c.kind, value };
    });
  } else if (manifest.kind === 'rendering-artifact-workflow') {
    projection = report.grade.cases.map(c => ({ id: c.id, kind: c.kind, pass: c.pass, ...(c.kind === 'decision' ? { value: c.value } : { rubric: c.rubric?.vector ?? null }) }));
  } else if (manifest.kind === 'prd-producer-consumption') {
    const plan = plans.find(plan => plan.samples.some(row => row.name === sample.name));
    const fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
    if (sha256(readFileSync(fixturePath)) !== manifest.fixture_sha256) throw new Error(`PRD fixture changed: ${sample.name}`);
    projection = report.grade.cases.map(c => ({ id: c.id, kind: c.kind, pass: c.pass, value: c.kind === 'decision' ? c.value : Object.fromEntries(Object.keys(fixture.cases.find(row => row.id === c.id).expected).map(key => [key, c.value?.[key]])), consumer_results: c.consumer_results ?? [] }));
  } else if (manifest.kind === 'methodology-output-consumption' || manifest.kind === 'skill-catalog-selection') {
    const plan = plans.find(plan => plan.samples.some(row => row.name === sample.name));
    const fixturePath = join(root, plan.fixture), fixture = read(fixturePath);
    if (sha256(readFileSync(fixturePath)) !== manifest.fixture_sha256) throw new Error(`output fixture changed: ${sample.name}`);
    const project = (actual, expected) => Array.isArray(expected) ? expected.map((v, i) => project(actual?.[i], v)) : expected && typeof expected === 'object' ? Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, project(actual?.[k], v)])) : actual;
    projection = report.grade.cases.map(c => ({ id: c.id, kind: c.kind, pass: c.pass, required_value: project(c.value, fixture.cases.find(row => row.id === c.id).oracle.required), consumer_results: c.consumer_results }));
  } else throw new Error(`unknown run kind ${manifest.kind}`);
  const taskBytes = readFileSync(join(directory, 'task.json'));
  const payloads = [taskBytes.toString('utf8')];
  let refused = 0;
  for (const file of readdirSync(join(directory, 'responses'))) {
    const reply = read(join(directory, 'responses', file));
    if (!reply.ok) { refused++; continue; }
    payloads.push(JSON.stringify(reply.value) + '\n');
  }
  if (refused !== (useAssessments ? (report.grade.diagnostics ?? []).length : 0)) runProblems.push('refused-bridge-call');
  if (runProblems.length) problems.push({ run: sample.name, problems: [...new Set(runProblems)] });
  const caseKinds = Object.fromEntries([...new Set(report.grade.cases.map(c => c.kind ?? 'execution'))].map(kind => { const cases = report.grade.cases.filter(c => (c.kind ?? 'execution') === kind); return [kind, { passed: cases.filter(c => c.pass).length, total: cases.length }]; }));
  runs.push({ case_kinds: caseKinds, name: sample.name, arm: sample.arm, kind: manifest.kind, report_sha256: sha256(readFileSync(reportPath)), assessment_sha256: assessmentHash, original_status: originalStatus, original_cases_passed: originalGrade.cases.filter(c => c.pass).length, diagnostics: report.grade.diagnostics ?? [], policy_sha256: sha256(policy), projection_sha256: canonicalHash(projection), policy_chunks: delivery?.reads?.length ?? 0, cases_passed: report.grade.cases.filter(c => c.pass).length, cases_total: report.grade.cases.length, config_path_reads: manifest.kind === 'gateway-entry-execution' ? report.grade.cases.reduce((n, c) => n + c.reads.length, 0) : null, event_counts: capture.events.reduce((counts, event) => ({ ...counts, [event.name]: (counts[event.name] ?? 0) + 1 }), {}), recorded_data_bytes: payloads.reduce((n, p) => n + Buffer.byteLength(p), 0), estimated_recorded_data_tokens: payloads.reduce((n, p) => n + Math.ceil(p.length / 4), 0) });
}
const kinds = [...new Set(runs.map(r => r.kind))];
if (kinds.length > 1) problems.push({ problems: ['mixed-workflow-kinds'] });
const projections = [...new Set(runs.map(r => r.projection_sha256))];
if (projections.length > 1) problems.push({ problems: ['effect-state-or-gate-projection-differs'], hashes: projections });
const arms = Object.fromEntries(['baseline', 'candidate'].map(arm => {
  const selected = runs.filter(r => r.arm === arm);
  const caseKinds = {};
  for (const run of selected) for (const [kind, counts] of Object.entries(run.case_kinds)) { caseKinds[kind] ??= { passed: 0, total: 0 }; caseKinds[kind].passed += counts.passed; caseKinds[kind].total += counts.total; }
  return [arm, { case_kinds: caseKinds, runs: selected.length, passed: selected.reduce((n, r) => n + r.cases_passed, 0), total: selected.reduce((n, r) => n + r.cases_total, 0), recorded_data_bytes: selected.reduce((n, r) => n + r.recorded_data_bytes, 0), estimated_recorded_data_tokens: selected.reduce((n, r) => n + r.estimated_recorded_data_tokens, 0) }];
}));
if (!missing.length && (arms.baseline.runs !== 5 || arms.candidate.runs !== 5)) problems.push({ problems: ['expected-five-samples-per-arm'] });
const result = { schema: 1, qualification_status: 'requires-separate-native-protocol-review', status: problems.length ? 'fail' : missing.length ? 'incomplete' : 'pass', plans: planPaths, arms, missing, problems, normalised_effect_state_gate_projections_equal: kinds.some(k => ['rendering-artifact-workflow', 'methodology-output-consumption', 'skill-catalog-selection', 'prd-producer-consumption'].includes(k)) ? null : projections.length === 1, bounded_output_projections_equal: kinds.some(k => ['methodology-output-consumption', 'skill-catalog-selection', 'prd-producer-consumption'].includes(k)) ? projections.length === 1 : null, artifact_rubric_projections_equal: kinds.includes('rendering-artifact-workflow') ? projections.length === 1 : null, runs, limits: ['Payload proxy counts task JSON plus compact successful bridge-response values, including policy chunks, each counted once. It excludes native tool framing, system/catalog/history, model output and cached reprocessing; it is not provider usage or billed cost.', 'Token estimate is ceil(UTF-16 characters/4) per payload, summed.', 'Effect and state comparison uses only the predeclared path/time/read normalisations. Finding prose varies and is graded separately by the fixture.', 'Native screens are retained separately and require protocol review; this numerical summary does not certify absence of out-of-bridge activity.', 'Rendering compares persisted artifact integrity and fact/form rubric outcomes, not byte-identical prose or subjective quality. Artifact, execution and decision counts are reported separately.', 'Named-output comparisons project only the requested fields and consumer outcomes; free-form artifact descriptions require a separate reading. Catalogue choices do not execute workflows.', 'Small correlated samples do not establish statistical equivalence.'] };
const rendered = JSON.stringify(result, null, 2) + '\n';
if (output) writeFileSync(resolve(output), rendered, { flag: 'wx' });
else process.stdout.write(rendered);
process.exitCode = result.status === 'pass' ? 0 : result.status === 'incomplete' ? 2 : 1;
