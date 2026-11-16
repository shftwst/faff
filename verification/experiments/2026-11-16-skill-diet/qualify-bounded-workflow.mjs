import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const [summaryArg, outputArg, ...auditArgs] = process.argv.slice(2);
if (!outputArg || !auditArgs.length) throw new Error('usage: qualify-bounded-workflow.mjs SUMMARY NEW_OUTPUT NATIVE_AUDIT...');
const root = import.meta.dirname;
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hash = path => sha256(readFileSync(path));
const summaryPath = resolve(summaryArg), summary = read(summaryPath);
if (summary.status !== 'pass' || summary.runs.length !== 10 || summary.arms.baseline.runs !== 5 || summary.arms.candidate.runs !== 5) throw new Error('paired comparison incomplete or failed');
const kinds = [...new Set(summary.runs.map(r => r.kind))];
if (kinds.length !== 1 || !['kernel-config-execution', 'rendering-artifact-workflow', 'methodology-output-consumption', 'skill-catalog-selection', 'prd-producer-consumption'].includes(kinds[0])) throw new Error('unsupported comparison kind');
const audits = auditArgs.map(path => ({ path: resolve(path), data: read(resolve(path)), sha256: hash(resolve(path)) }));
const auditorHash = hash(resolve(root, '../../../eval/control-parity/native-tool-audit.mjs'));
if (audits.some(a => a.data.auditor_sha256 !== auditorHash)) throw new Error('native auditor changed');
const runs = summary.runs.map(run => {
  const matches = audits.flatMap(audit => audit.data.runs.filter(row => row.name === run.name).map(row => ({ audit, row })));
  if (matches.length !== 1) throw new Error(`native session count: ${run.name}`);
  const { audit, row } = matches[0];
  if (row.status !== 'pass' || !row.complete || row.problems.length || row.tools.some(t => !t.allowed || t.is_error || !t.result_seen) || row.initial_reads.some(r => !r.complete)) throw new Error(`native protocol: ${run.name}`);
  if (row.model_ids.length !== 1 || row.model_ids[0] !== 'claude-opus-5-5' || row.versions.length !== 1 || row.versions[0] !== '2.1.325') throw new Error(`model/runtime differs: ${run.name}`);
  const task = row.initial_reads.find(r => r.path.endsWith('/task.json'));
  if (!task || task.content_sha256 !== hash(task.path)) throw new Error(`native task binding: ${run.name}`);
  const directory = join(root, 'workflow-runs', run.name);
  if (run.report_sha256 !== hash(join(directory, 'report.json')) || run.assessment_sha256 && run.assessment_sha256 !== hash(join(directory, 'assessment.json'))) throw new Error(`comparison binding: ${run.name}`);
  return { name: run.name, arm: run.arm, original_status: run.original_status, original_cases_passed: run.original_cases_passed, assessed_cases_passed: run.cases_passed, cases_total: run.cases_total, status: 'pass', model_ids: row.model_ids, versions: row.versions, native_tool_calls: row.tools.length, initial_reads: row.initial_reads, audit: audit.path, audit_sha256: audit.sha256 };
});
const guidance = [...new Set(runs.flatMap(r => r.initial_reads.filter(i => i.path.endsWith('/.agents/AGENTS.md')).map(i => i.content_sha256)))];
if (guidance.length !== 1 || runs.some(r => r.initial_reads.filter(i => i.path.endsWith('/.agents/AGENTS.md')).length !== 1)) throw new Error('common delivered guidance differs');
const commonContexts = runs.map(r => r.initial_reads.filter(i => !i.path.endsWith('/task.json')).map(i => ({ path: i.path, sha256: i.content_sha256, bytes: i.content_bytes })).sort((a, b) => a.path.localeCompare(b.path)));
if (new Set(commonContexts.map(c => JSON.stringify(c))).size !== 1) throw new Error('delivered initial context differs across samples');
const result = {
  schema: 1, status: { 'kernel-config-execution': 'qualified-bounded-config-workflow', 'rendering-artifact-workflow': 'qualified-rendering-rubrics-requires-artifact-review', 'methodology-output-consumption': 'qualified-bounded-methodology-outputs-requires-artifact-review', 'skill-catalog-selection': 'qualified-bounded-catalog-selection', 'prd-producer-consumption': 'qualified-bounded-prd-production-requires-artifact-review' }[kinds[0]],
  summary: summaryPath, summary_sha256: hash(summaryPath), arms: summary.arms, runs,
  delivered_guidance_sha256: guidance[0], common_context: commonContexts[0],
  normalised_effect_state_gate_projections_equal: summary.normalised_effect_state_gate_projections_equal,
  artifact_rubric_projections_equal: summary.artifact_rubric_projections_equal, bounded_output_projections_equal: summary.bounded_output_projections_equal ?? null,
  limits: [
    'Actual native tool metadata and model identities are verified. Full caller workflows, hosted publication and statistical equivalence are not claimed.',
    'Kernel cases use the real configuration/dispatch CLI and prevalidated downstream stubs. Separate policy decisions are not counted as executed workflows.',
    'Rendering compares actual persisted artifacts and source-fact/form rubrics; a separate reading of the outputs is required before qualifying writing quality.',
    'Delivered operator guidance is common across arms; the orchestrator file hash describes a different container view.',
    'Methodology consumers exercise the real termination CLI; other outputs are separate decisions or persisted proposals. Catalogue selection does not execute the selected workflow.',
    'Source and recorded payload token estimates are not provider usage or billed cost.',
  ],
};
writeFileSync(resolve(outputArg), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, arms: result.arms }));
