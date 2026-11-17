import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalHash, sha256 } from '../../../eval/control-parity/schema.mjs';

const root = import.meta.dirname;
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const hash = path => sha256(readFileSync(join(root, path)));
const summaryPath = 'adversarial-context-v3-assessed-results.json', summary = read(summaryPath);
const auditPaths = ['native-audits/main-complete-v2.json', 'native-audits/second-adversarial-final.json'];
const audits = auditPaths.map(path => ({ path, hash: hash(path), data: read(path) }));
if (summary.status !== 'pass' || summary.runs.length !== 10 || !summary.normalised_effect_state_gate_projections_equal) throw new Error('paired execution not complete');
const runs = summary.runs.map(run => {
  const matches = audits.flatMap(audit => audit.data.runs.filter(r => r.name === run.name).map(row => ({ audit, row })));
  if (matches.length !== 1) throw new Error(`native session count: ${run.name}`);
  const { audit, row } = matches[0], base = 'workflow-runs/' + run.name;
  const capture = read(base + '/capture.json'), assessment = read(base + '/assessment.json');
  if (hash(base + '/assessment.json') !== run.assessment_sha256 || assessment.capture_sha256 !== hash(base + '/capture.json')) throw new Error(`unbound assessment: ${run.name}`);
  if (!row.complete || row.tools.some(t => !t.allowed) || row.initial_reads.some(r => !r.complete)) throw new Error(`native protocol: ${run.name}`);
  if (row.model_ids.length !== 1 || row.model_ids[0] !== 'claude-opus-5-5' || row.versions.length !== 1 || row.versions[0] !== '2.1.325') throw new Error(`model/runtime differs: ${run.name}`);
  const task = row.initial_reads.find(r => r.path.endsWith('/task.json'));
  if (!task || task.content_sha256 !== sha256(readFileSync(task.path))) throw new Error(`native task bytes: ${run.name}`);
  const diagnostics = assessment.grade.diagnostics.map(diagnostic => {
    const event = capture.events.find(e => e.seq === diagnostic.seq);
    const calls = row.tools.filter(t => t.port === event.name && t.arguments_sha256 === canonicalHash(event.args) && t.is_error);
    if (calls.length !== 1 || calls[0].error_kind !== 'other' || !calls[0].result_seen) throw new Error(`unmatched diagnostic: ${run.name}`);
    return { ...diagnostic, native_tool_id: calls[0].id, arguments_sha256: calls[0].arguments_sha256 };
  });
  const diagnosticIds = new Set(diagnostics.map(d => d.native_tool_id));
  if (row.tools.some(t => t.is_error && !diagnosticIds.has(t.id)) || row.problems.some(p => !diagnosticIds.has(p.id))) throw new Error(`unexplained native failure: ${run.name}`);
  return { name: run.name, arm: run.arm, status: diagnostics.length ? 'pass-with-recorded-diagnostic' : 'pass', original_report_status: assessment.original_status, original_cases_passed: assessment.original_cases_passed, assessed_cases_passed: run.cases_passed, total: run.cases_total, native_status: row.status, native_tool_calls: row.tools.length, model_ids: row.model_ids, versions: row.versions, audit: audit.path, audit_sha256: audit.hash, assessment_sha256: run.assessment_sha256, initial_reads: row.initial_reads, diagnostics };
});
const guidance = [...new Set(runs.flatMap(r => r.initial_reads.filter(i => i.path.endsWith('/.agents/AGENTS.md')).map(i => i.content_sha256)))];
if (guidance.length !== 1) throw new Error('common delivered guidance differs');
const challenges = read('challenges-file-input-v4-stable-results.json'), challengeNative = read('challenges-file-input-v4-native-log-review.json');
if (challenges.status !== 'pass' || challengeNative.status !== 'pass') throw new Error('challenge boundary not qualified');
const result = {
  schema: 1, status: 'qualified-bounded-adversarial-workflow',
  summary: summaryPath, summary_sha256: hash(summaryPath), runs,
  arms: summary.arms, normalised_signals_helper_exits_checkpoints_and_merge_gates_equal: true,
  challenge_results_sha256: hash('challenges-file-input-v4-stable-results.json'), challenge_native_review_sha256: hash('challenges-file-input-v4-native-log-review.json'),
  delivered_guidance_sha256: guidance[0], diagnostics: runs.flatMap(r => r.diagnostics.map(d => ({ run: r.name, ...d }))),
  limits: [
    'Controlled local provider responses and a stub primary reviewer exercise control flow, not independent model judgement. Existing separate artifact-review probes cover the bounded judgement cases.',
    'Actual native tool metadata, bridge calls, files and merge-floor consumption are checked. Read counts, optional interactive findings files and prompt wording can differ within declared rules.',
    'Original reports and native errors are retained. Two explicit oracle corrections are applied to both arms through hash-bound assessments; no guard rejection or other error is waived.',
    'Actual delivered operator guidance is common across arms; the orchestrator-side file hash describes a separate container view.',
    'No live GitHub/tracker publication, full graft/ship workflow, statistical equivalence or provider billing claim.',
  ],
};
writeFileSync(join(root, 'adversarial-context-v3-qualification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, arms: result.arms, diagnostics: result.diagnostics }));
