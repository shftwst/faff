import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { canonicalHash, sha256 } from '../../../eval/control-parity/schema.mjs';

const root = import.meta.dirname;
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const hash = path => sha256(readFileSync(join(root, path)));
const exists = path => existsSync(join(root, path));
const selection = read('gpt-opus-standin-finalist-selection-v1.json');
const amendment = read('gpt-opus-hard-task-amendment-v1.json');
const preflightTask = read('challenge-calibration-preflight-v2/task.json');
const preflightManifest = read('challenge-calibration-preflight-v2/manifest.json');
const referencePlans = {
  gateway: ['gateway-context-v3-plan.json'],
  rendering: ['rendering-baseline-plan.json', 'rendering-v2-candidate-plan.json'],
  challenges: ['challenges-file-input-v4-stable-plan.json'],
};
const referenceAudits = {
  gateway: 'gateway-context-v3-native-log-review.json',
  rendering: 'rendering-v2-protocol-and-rubric-review.json',
  challenges: 'challenges-file-input-v4-native-log-review.json',
};
const referenceSamples = task => referencePlans[task].flatMap(path => read(path).samples);
const toolSchemas = task => task.tools.map(({ description, ...tool }) => tool);
const groups = [];
for (const task of Object.keys(referencePlans)) groups.push({ id: 'opus-reference', model: 'claude-opus-5-5', effort: 'medium', task, plans: referencePlans[task], reference: true });
for (const id of selection.selected) for (const task of Object.keys(referencePlans)) {
  const combination = selection.combinations.find(row => row.id === id);
  const plans = task === 'challenges' ? [`matrix-final-v1-${id}-challenges-plan.json`]
    : id === 'sol-medium' ? [`${task}-sol-calibration-v1-plan.json`]
      : [`matrix-v1-${id}-${task}-plan.json`, `matrix-final-v1-${id}-${task}-plan.json`];
  groups.push({ id, model: combination.model, effort: combination.effort, task, plans, reference: false });
}

const rows = [], samples = [], pending = [];
for (const group of groups) for (const arm of ['baseline', 'candidate']) {
  const selected = group.plans.flatMap(path => read(path).samples).filter(sample => sample.arm === arm);
  if (selected.length !== 5 || new Set(selected.map(sample => sample.name)).size !== 5) throw new Error('expected five distinct planned samples per arm');
  const row = { combination: group.id, task: group.task, arm, planned: 5, completed: 0, raw_runs_passed: 0, assessed_runs_passed: 0, native_passed: 0, binding_failures: 0, raw_cases: {}, assessed_cases: {}, elapsed_seconds: [] };
  for (const sample of selected) {
    const directory = `workflow-runs/${sample.name}`;
    if (!exists(`${directory}/report.json`) || !exists(`${directory}/capture.json`) || !exists(`${directory}/worker-final-state.json`) || !group.reference && !exists(`${directory}/native-audit.json`)) { pending.push(sample.name); continue; }
    const manifest = read(`${directory}/manifest.json`), task = read(`${directory}/task.json`), report = read(`${directory}/report.json`);
    const state = read(`${directory}/worker-final-state.json`);
    const assessed = exists(`${directory}/assessment.json`) ? read(`${directory}/assessment.json`) : report;
    const reference = referenceSamples(group.task).find(item => item.arm === arm);
    const referenceDirectory = `workflow-runs/${reference.name}`;
    const referenceManifest = read(`${referenceDirectory}/manifest.json`), referenceTask = read(`${referenceDirectory}/task.json`);
    const problems = [];
    for (const key of ['fixture_sha256', 'policy_sha256', 'policy_reader_sha256']) if (manifest[key] !== referenceManifest[key]) problems.push(key);
    if (!isDeepStrictEqual(manifest.binding, referenceManifest.binding)) problems.push('runtime-binding');
    if (manifest.policy_sha256 !== hash(sample.policy)) problems.push('current-policy');
    if (manifest.fixture_sha256 !== hash(read(group.plans[0]).fixture)) problems.push('current-fixture');
    const taskHash = group.task === 'rendering' ? hash(`${directory}/task.json`) : canonicalHash(task);
    if (manifest.task_sha256 !== taskHash) problems.push('task-binding');
    if (group.task === 'challenges' && !group.reference) {
      if (manifest.harness_sha256 !== amendment.hard_task_harness.sha256 || manifest.harness_sha256 !== hash('../../../eval/control-parity/challenge-calibration-execution.mjs')) problems.push('amended-harness');
      if (manifest.core_harness_sha256 !== referenceManifest.harness_sha256 || manifest.core_harness_sha256 !== hash('../../../eval/control-parity/challenge-execution.mjs')) problems.push('unchanged-core-harness');
      if (!isDeepStrictEqual(task.cases, referenceTask.cases) || !isDeepStrictEqual(task.policy, referenceTask.policy) || !isDeepStrictEqual(toolSchemas(task), toolSchemas(referenceTask))) problems.push('changed-case-policy-or-schema');
      if (task.instructions !== preflightTask.instructions || !isDeepStrictEqual(task.tools, preflightTask.tools)) problems.push('unregistered-task-treatment');
      if (report.scope !== manifest.scope || manifest.scope !== preflightManifest.scope) problems.push('calibration-scope');
    } else if (manifest.harness_sha256 !== referenceManifest.harness_sha256 || manifest.task_sha256 !== referenceManifest.task_sha256) problems.push('unchanged-harness-or-task');
    if (assessed !== report && (assessed.report_sha256 !== hash(`${directory}/report.json`) || assessed.capture_sha256 !== hash(`${directory}/capture.json`))) problems.push('assessment-binding');
    if (assessed !== report && (assessed.grader_sha256 !== hash('../../../eval/control-parity/rendering-artifact.mjs') || assessed.assessor_sha256 !== hash('assess-rendering-artifacts.mjs') || assessed.correction_sha256 !== hash('workflow-fixtures/RENDERING-ORACLE-CORRECTION.md') || assessed.fixture_sha256 !== manifest.fixture_sha256)) problems.push('frozen-assessor-binding');
    let native;
    if (group.reference) {
      const original = read(referenceAudits[group.task]).runs.find(item => item.name === sample.name);
      native = { status: original?.native_status ?? original?.status ?? 'missing' };
    } else {
      const audit = read(`${directory}/native-audit.json`); native = audit.runs[0];
      const auditor = group.id === 'sol-medium' && group.task !== 'challenges' ? 'codex-sol-native-audit.mjs' : 'codex-model-native-audit.mjs';
      if (audit.auditor_sha256 !== hash(`../../../eval/control-parity/${auditor}`) || audit.core_auditor_sha256 !== hash('../../../eval/control-parity/codex-native-audit.mjs') || audit.classifier_sha256 !== hash('../../../eval/control-parity/native-tool-audit.mjs')) problems.push('auditor-binding');
      if (native.name !== sample.name || !isDeepStrictEqual(state.thread_ids, [native.session_id])) problems.push('native-sample-session-binding');
      if (auditor === 'codex-model-native-audit.mjs' && audit.expectation_sha256 !== hash(`${directory}/native-audit-sample.json`)) problems.push('native-expectation-binding');
      const deliveredTask = native.initial_reads.find(item => item.path === join(root, directory, 'task.json'));
      if (!deliveredTask || deliveredTask.content_sha256 !== hash(`${directory}/task.json`)) problems.push('native-task-binding');
      if (!isDeepStrictEqual(native.model_ids, [group.model]) || !isDeepStrictEqual(native.efforts, [group.effort])) problems.push('actual-model-effort');
      if (native.status === 'pass' && (!native.complete || native.problems.length || native.tools.some(tool => !tool.allowed || tool.is_error || !tool.result_seen) || native.initial_reads.some(item => !item.complete))) problems.push('native-pass-inconsistent');
    }
    row.completed++;
    row.raw_runs_passed += report.status === 'pass' ? 1 : 0;
    row.assessed_runs_passed += assessed.status === 'pass' ? 1 : 0;
    row.native_passed += native.status === 'pass' ? 1 : 0;
    row.binding_failures += problems.length ? 1 : 0;
    for (const [key, result] of [['raw_cases', report], ['assessed_cases', assessed]]) for (const item of result.grade.cases) {
      const kind = item.kind ?? (group.task === 'challenges' ? 'judgement-and-consumption' : 'execution');
      row[key][kind] ??= { passed: 0, total: 0 };
      row[key][kind].passed += item.pass ? 1 : 0;
      row[key][kind].total++;
    }
    if (Number.isFinite(state.elapsed_seconds)) row.elapsed_seconds.push(state.elapsed_seconds);
    samples.push({ combination: group.id, task: group.task, arm, name: sample.name, raw_status: report.status, assessed_status: assessed.status, native_status: native.status, binding_problems: problems,
      report_sha256: hash(`${directory}/report.json`), assessment_sha256: assessed === report ? null : hash(`${directory}/assessment.json`), manifest_sha256: hash(`${directory}/manifest.json`),
      native_audit_sha256: group.reference ? hash(referenceAudits[group.task]) : hash(`${directory}/native-audit.json`), elapsed_seconds: state.elapsed_seconds ?? null });
  }
  const times = [...row.elapsed_seconds].sort((a, b) => a - b), middle = Math.floor(times.length / 2);
  row.median_seconds = times.length ? times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2 : null;
  rows.push(row);
}
const result = { schema: 1, status: rows.some(row => row.binding_failures) ? 'binding-failure' : pending.length ? 'finalists-in-progress' : 'captures-complete-requires-manual-review',
  scorer_sha256: sha256(readFileSync(new URL(import.meta.url))), selection_sha256: hash('gpt-opus-standin-finalist-selection-v1.json'), amendment_sha256: hash('gpt-opus-hard-task-amendment-v1.json'), rows, samples, pending,
  limits: ['Run-level failures remain visible even when individual cases pass. Native certification is separate from functional scores and manual fidelity.',
    'Sol-medium gateway/rendering samples3-5 predate selection and were explicitly registered for reuse. Other additions are fresh samples; failed screen samples are never replaced.',
    'GPT challenge task wording excludes provider independence. It reuses the original policy, case inputs, expected outcomes, CLI runtime and environment/grader. Task/guidance/transport differences prevent pure model-only attribution.',
    'Native wrapper incompatibilities, missing exit metadata and actual command errors must be distinguished using their separate diagnoses.',
    'Elapsed time includes queue/tool overhead; four finalist lanes differ from the screen concurrency. No provider billing, statistical equivalence or full production workflow claim.'] };
writeFileSync(join(root, 'gpt-opus-finalist-progress.json'), JSON.stringify(result, null, 2) + '\n');
const score = cases => Object.entries(cases).map(([kind, value]) => `${kind}: ${value.passed}/${value.total}`).join('; ') || 'pending';
const markdown = '# GPT finalist progress\n\nFive samples per policy arm. Manual artifact and reason reviews remain separate.\n\n| Model | Task | Policy | Complete | Assessed runs passed | Assessed cases | Native certified | Median seconds |\n|---|---|---|---:|---:|---|---:|---:|\n'
  + rows.map(row => `| ${row.combination} | ${row.task} | ${row.arm} | ${row.completed}/5 | ${row.assessed_runs_passed}/${row.completed} | ${score(row.assessed_cases)} | ${row.native_passed}/${row.completed} | ${row.median_seconds === null ? 'unavailable' : row.median_seconds.toFixed(1)} |`).join('\n')
  + '\n\n' + result.limits.map(limit => '- ' + limit).join('\n') + '\n';
writeFileSync(join(root, 'GPT-OPUS-FINALIST-PROGRESS.md'), markdown);
console.log(JSON.stringify({ status: result.status, completed: samples.length, planned: 90, binding_failures: rows.reduce((total, row) => total + row.binding_failures, 0) }));
