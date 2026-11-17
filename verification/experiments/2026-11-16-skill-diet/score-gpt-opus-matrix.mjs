import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
const root = import.meta.dirname;
const read = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const hash = p => sha256(readFileSync(join(root, p)));
const registry = read('gpt-opus-standin-matrix-v1.json');
const opusPlans = {
  gateway: [read('gateway-context-v3-plan.json')],
  rendering: [read('rendering-baseline-plan.json'), read('rendering-v2-candidate-plan.json')],
};
const opusNative = {
  gateway: read('gateway-context-v3-native-log-review.json').runs,
  rendering: read('rendering-v2-protocol-and-rubric-review.json').runs,
};
const groups = [];
const firstTwo = samples => {
  const seen = { baseline: 0, candidate: 0 };
  return samples.filter(s => ++seen[s.arm] <= 2);
};
for (const task of ['gateway', 'rendering']) {
  const plans = opusPlans[task];
  groups.push({ id: 'opus-reference', model: 'claude-opus-5-5', effort: 'medium', task, samples: firstTwo(plans.flatMap(p => p.samples)), plan: plans[0], opus: true });
}
for (const c of registry.combinations) for (const task of ['gateway', 'rendering']) {
  const planPath = c.id === 'sol-medium' ? `${task}-sol-calibration-v1-plan.json` : `matrix-v1-${c.id}-${task}-plan.json`;
  const plan = read(planPath);
  groups.push({ ...c, task, planPath, plan, samples: firstTwo(plan.samples), opus: false });
}
const rows = [], samples = [];
for (const group of groups) {
  const referenceSamples = opusPlans[group.task].flatMap(p => p.samples);
  for (const arm of ['baseline', 'candidate']) {
    const selected = group.samples.filter(s => s.arm === arm);
    const row = { combination: group.id, model: group.model, effort: group.effort, task: group.task, arm, planned_samples: selected.length, complete_samples: 0, raw_runs_passed: 0, assessed_runs_passed: 0, native_passed: 0, native_failed: 0, bindings_failed: 0, raw: {}, assessed: {}, elapsed_seconds: [] };
    for (const sample of selected) {
      const dir = 'workflow-runs/' + sample.name;
      if (!existsSync(join(root, dir, 'report.json')) || !existsSync(join(root, dir, 'worker-final-state.json'))) continue;
      const report = read(dir + '/report.json'), manifest = read(dir + '/manifest.json');
      const assessed = existsSync(join(root, dir, 'assessment.json')) ? read(dir + '/assessment.json') : report;
      const ref = referenceSamples.find(s => s.arm === arm), refManifest = read('workflow-runs/' + ref.name + '/manifest.json');
      const bindingProblems = [];
      for (const key of ['fixture_sha256', 'policy_sha256', 'harness_sha256', 'policy_reader_sha256', 'task_sha256']) {
        if (manifest[key] !== refManifest[key]) bindingProblems.push(key);
      }
      if (JSON.stringify(manifest.binding) !== JSON.stringify(refManifest.binding)) bindingProblems.push('runtime-binding');
      if (manifest.policy_sha256 !== hash(sample.policy)) bindingProblems.push('current-policy');
      if (manifest.fixture_sha256 !== hash(group.plan.fixture)) bindingProblems.push('current-fixture');
      if (assessed !== report && (assessed.report_sha256 !== hash(dir + '/report.json') || assessed.capture_sha256 !== hash(dir + '/capture.json'))) bindingProblems.push('assessment-binding');
      let native;
      if (group.opus) {
        const entry = opusNative[group.task].find(r => r.name === sample.name);
        native = { status: entry?.native_status ?? entry?.status ?? 'missing', problems: [], model_ids: entry?.model_ids, versions: entry?.versions };
      } else {
        const path = dir + '/native-audit.json';
        if (!existsSync(join(root, path))) continue;
        const audit = read(path); native = audit.runs[0];
        const expectedAuditor = group.id === 'sol-medium' ? '../../../eval/control-parity/codex-sol-native-audit.mjs' : '../../../eval/control-parity/codex-model-native-audit.mjs';
        if (audit.auditor_sha256 !== hash(expectedAuditor) || audit.core_auditor_sha256 !== hash('../../../eval/control-parity/codex-native-audit.mjs') || audit.classifier_sha256 !== hash('../../../eval/control-parity/native-tool-audit.mjs')) bindingProblems.push('auditor-binding');
        if (native.model_ids.length !== 1 || native.model_ids[0] !== group.model || native.efforts.length !== 1 || native.efforts[0] !== group.effort) bindingProblems.push('actual-model-effort');
      }
      row.complete_samples++;
      row.raw_runs_passed += report.status === 'pass' ? 1 : 0;
      row.assessed_runs_passed += assessed.status === 'pass' ? 1 : 0;
      row.native_passed += native.status === 'pass' ? 1 : 0;
      row.native_failed += native.status === 'pass' ? 0 : 1;
      row.bindings_failed += bindingProblems.length ? 1 : 0;
      for (const [label, data] of [['raw', report], ['assessed', assessed]]) for (const c of data.grade.cases) {
        const kind = c.kind ?? 'execution';
        row[label][kind] ??= { passed: 0, total: 0 };
        row[label][kind].passed += c.pass ? 1 : 0;
        row[label][kind].total++;
      }
      const state = read(dir + '/worker-final-state.json');
      if (Number.isFinite(state.elapsed_seconds)) row.elapsed_seconds.push(state.elapsed_seconds);
      samples.push({ combination: group.id, task: group.task, arm, name: sample.name, raw_status: report.status, assessed_status: assessed.status, report_sha256: hash(dir + '/report.json'), assessment_sha256: assessed === report ? null : hash(dir + '/assessment.json'), manifest_sha256: hash(dir + '/manifest.json'), binding_problems: bindingProblems, native_status: native.status, native_problems: native.problems ?? [], elapsed_seconds: state.elapsed_seconds ?? null });
    }
    const sorted = [...row.elapsed_seconds].sort((a,b) => a-b), mid = Math.floor(sorted.length / 2);
    row.median_elapsed_seconds = sorted.length ? sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2 : null;
    rows.push(row);
  }
}
const result = { schema: 1, status: rows.every(r => r.complete_samples === r.planned_samples) ? 'screen-captures-complete-requires-manual-review' : 'screen-in-progress', registry_sha256: hash('gpt-opus-standin-matrix-v1.json'), rows, samples,
  limits: ['Screen uses exactly the first two frozen samples per policy arm. Later Sol-medium samples are excluded from this equal-size screen.',
    'Execution/artifact/decision rubric scores are separate from manual fidelity and native certification. Uncertified transport is not labelled a functional reasoning failure.',
    'Opus delivered older operator guidance; provider base instructions, native transport, timeout and path reminders differ. GPT matrix combinations share current guidance and protocol.',
    'Elapsed time includes tool and queue overhead in the shared environment. Opus elapsed time is unavailable in the common format. No provider cost or statistical equivalence claim.',
    'No finalist is selected by this progress script. Manual review and the preregistered critical-failure ranking remain required.'] };
writeFileSync(join(root, 'gpt-opus-standin-screen-progress.json'), JSON.stringify(result, null, 2) + '\n');
const score = values => Object.entries(values).map(([kind, c]) => `${kind}: ${c.passed}/${c.total}`).join('; ') || 'pending';
const md = '# GPT stand-in screen progress\n\nTwo samples per policy arm; incomplete rows are not final results. Manual fidelity review remains separate. Passing case scores do not waive failed run-level gates.\n\n| Combination | Task | Policy | Samples | Assessed runs passed | Assessed rubric | Native certified | Median seconds |\n|---|---|---|---:|---:|---|---:|---:|\n'
  + rows.map(r => `| ${r.combination} | ${r.task} | ${r.arm} | ${r.complete_samples}/${r.planned_samples} | ${r.assessed_runs_passed}/${r.complete_samples} | ${score(r.assessed)} | ${r.native_passed}/${r.complete_samples} | ${r.median_elapsed_seconds === null ? 'unavailable' : r.median_elapsed_seconds.toFixed(1)} |`).join('\n')
  + '\n\n' + result.limits.map(s => '- ' + s).join('\n') + '\n';
writeFileSync(join(root, 'GPT-OPUS-STANDIN-PROGRESS.md'), md);
console.log(JSON.stringify({ status: result.status, complete_samples: samples.length, bindings_failed: rows.reduce((n,r) => n+r.bindings_failed,0) }));
