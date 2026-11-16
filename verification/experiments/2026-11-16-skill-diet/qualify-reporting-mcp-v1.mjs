import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { verifyReportingArm } from './verify-reporting-mcp-arm-v1.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, root = resolve(evidence, '../../..');
const read = path => JSON.parse(readFileSync(join(evidence, path)));
const hash = path => sha256(readFileSync(join(evidence, path)));
const bind = path => ({ path, sha256: hash(path) });
const [output, installedChecks] = process.argv.slice(2);
if (!output) throw new Error('usage: qualify-reporting-mcp-v1.mjs NEW_OUTPUT [MAIN_INTEGRATION_RECORD]');
const arms = [];
for (const arm of ['baseline', 'candidate']) {
  const gatePath = `beep-reporting-mcp-v1-${arm}-gate.json`, gate = read(gatePath);
  assert.deepEqual(await verifyReportingArm(arm, gate.manual.path), gate);
  assert.equal(gate.samples.length, 5);
  assert.ok(gate.samples.every(row => row.assessed_cases_passed === 6 && row.native === 'pass' && row.manual_cases === 6));
  arms.push({ arm, gate: bind(gatePath), samples: 5, raw_cases_passed: gate.samples.reduce((n, row) => n + row.raw_cases_passed, 0), assessed_cases_passed: gate.samples.reduce((n, row) => n + row.assessed_cases_passed, 0), cases_total: 30, native_samples_passed: 5, manual_cases_passed: 30, normalisation_calls: gate.samples.reduce((n, row) => n + row.normalisation_calls, 0), discarded_drafts: gate.samples.flatMap(row => row.discarded_drafts.map(draft => ({ sample: row.name, ...draft }))) });
}
const review = read('beep-reporting-v1-source-review.json'), integration = read('beep-reporting-medium-integration.json');
assert.equal(hash('candidates/beep-reporting-v1.md'), review.candidate_sha256);
assert.equal(integration.status, 'pass'); assert.equal(integration.source_sha256, review.candidate_sha256);
assert.deepEqual(integration.checks.map(row => row.check).sort(), ['adapter-lint', 'rule-inventory', 'tests']);
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: integration.directory, encoding: 'utf8' }).trim(), integration.isolated_commit);
assert.equal(sha256(execFileSync('git', ['show', integration.isolated_commit + ':plugin/skills/faff-beep-boop/SKILL.md'], { cwd: integration.directory })), review.candidate_sha256);
for (const row of integration.checks) { assert.equal(row.exit_code, 0); assert.equal(hash(row.path), row.sha256); }
let main = null;
if (installedChecks) {
  main = read(installedChecks);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(main.status, 'pass'); assert.equal(main.source_commit, head);
  assert.equal(main.source_sha256, review.candidate_sha256);
  const source = join(root, 'plugin/skills/faff-beep-boop/SKILL.md');
  assert.equal(sha256(readFileSync(source)), review.candidate_sha256);
  assert.equal(sha256(execFileSync('git', ['show', head + ':plugin/skills/faff-beep-boop/SKILL.md'], { cwd: root })), review.candidate_sha256);
  assert.deepEqual(main.checks.map(row => row.check).sort(), ['adapter-lint', 'rule-inventory', 'tests']);
  for (const row of main.checks) { assert.equal(row.exit_code, 0); assert.equal(hash(row.path), row.sha256); }
}
const bindings = ['beep-reporting-v1-source-review.json', 'independent-beep-reporting-candidate-source-review.json', 'beep-reporting-medium-integration.json', 'beep-reporting-mcp-v1-registration.json', 'beep-reporting-mcp-v1-hold.json', 'beep-reporting-mcp-v1-draft-assessment-registration.json', 'independent-reporting-draft-assessment-v1-review.json', 'independent-reporting-mcp-arm-gate-v1-review.json', 'mcp-transport-v4-qualification.json', 'manual-artifact-reviews/beep-reporting-mcp-v1-baseline-independent.json', 'manual-artifact-reviews/beep-reporting-mcp-v1-assessed-independent.json', 'manual-artifact-reviews/beep-reporting-mcp-v1-candidate-independent.json'];
const result = { schema: 1, created_utc: new Date().toISOString(), accepted: !!main, status: main ? 'qualified-bounded-reporting-producer-command-consumer' : 'measurement-qualified-pending-source-integration', model: 'gpt-6.1-sol', effort: 'medium', source_sha256: review.candidate_sha256, source_review: 'beep-reporting-v1-source-review.json', source_review_sha256: hash('beep-reporting-v1-source-review.json'), before: arms[0], after: arms[1], bindings: bindings.map(bind), private_integration: integration, main_source_commit: main?.source_commit ?? null, main_integration: main ? bind(installedChecks) : null, mandatory_dependencies_added: [], qualifier_sha256: sha256(readFileSync(new URL(import.meta.url))), limits: [
  'Five original samples per arm in the fresh structured-MCP cohort. Earlier shell/native failures remain held, unpooled and unchanged. No sample replacement.',
  'The original baseline2 raw failure remains. A separately frozen post-hoc assessment permits unused successful drafts before the sole canonical publication; it was fixed before remaining baseline and all candidate calls. Raw scores, intermediate typo and call overhead remain disclosed.',
  'Actual pinned run-summary handler, production ledger setup and summary persistence; fixed forge, install-health, economics, budget and methodology dependencies; controlled identity rendering, publication and build continuation.',
  'All60execution cases receive independent actual-output review. Strict native replay binds policy delivery and calls to the same runtime/source/fixture; the separate workflow assessment binds their semantics.',
  'No full build loop, run-close/andon, hosted publication, rendering-quality or pre-write normalisation proof. No statistical or provider-wide equivalence claim.',
  'Intended-driver Opus confirmation remains pending allowance renewal. Byte and token savings concern loaded source prose, not measured provider billing.',
] };
writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, accepted: result.accepted, before: arms[0].raw_cases_passed, after: arms[1].raw_cases_passed }));
