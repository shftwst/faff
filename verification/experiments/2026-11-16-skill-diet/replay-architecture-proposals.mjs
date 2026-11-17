import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { consumeArchitectureArtifact } from '../../../eval/control-parity/architecture-artifact.mjs';
import { gradeRenderedArtifact } from '../../../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
const [baselineArg, candidateArg, outputArg, mode] = process.argv.slice(2);
if (!outputArg || mode && mode !== '--preflight') throw Error('usage: replay-architecture-proposals.mjs BASELINE_PLAN CANDIDATE_PLAN NEW_DIRECTORY [--preflight]');
const root = import.meta.dirname, output = resolve(outputArg), read = p => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const plans = [baselineArg, candidateArg].map(p => ({ path: resolve(p), value: read(resolve(p)) }));
assert.equal(plans[0].value.runtime_root, plans[1].value.runtime_root); assert.equal(plans[0].value.runtime_commit, plans[1].value.runtime_commit); assert.equal(plans[0].value.fixture, plans[1].value.fixture);
const binding = bindCandidateCommand(plans[0].value.runtime_root, plans[0].value.runtime_commit), fixturePath = join(root, plans[0].value.fixture), fixture = read(fixturePath), inputs = [];
for (const plan of plans) {
  assert.equal(plan.value.samples.length, 5);
  for (const sample of plan.value.samples) {
    if (mode && inputs.length) break;
    const d = join(root, 'workflow-runs', sample.name);
    if (!mode) { assert.equal(read(join(d, 'report.json')).status, 'pass'); assert.equal(read(join(d, 'native-audit.json')).runs[0].status, 'pass'); }
    for (const c of fixture.cases) {
      const path = join(d, 'artifacts', c.id + '.md'), text = mode ? c.reference : readFileSync(path, 'utf8');
      inputs.push({ name: sample.name, arm: sample.arm, case_id: c.id, path: mode ? null : path, sha256: sha256(text), text, case: c, report_sha256: mode ? null : sha256(readFileSync(join(d, 'report.json'))), native_audit_sha256: mode ? null : sha256(readFileSync(join(d, 'native-audit.json'))) });
    }
  }
}
assert.equal(inputs.length, mode ? 4 : 40);
mkdirSync(output);
const publicInput = ({ text, case: c, ...row }) => row;
write(join(output, 'manifest.json'), { mode: mode ? 'preflight-reference-proposals' : 'actual-artifact-replay', binding, script_sha256: sha256(readFileSync(new URL(import.meta.url))), consumer_sha256: sha256(readFileSync(new URL('../../../eval/control-parity/architecture-artifact.mjs', import.meta.url))), fixture_sha256: sha256(readFileSync(fixturePath)), plans: plans.map(p => ({ path: p.path, sha256: sha256(readFileSync(p.path)) })), inputs: inputs.map(publicInput) });
const results = [];
for (const input of inputs) {
  const d = join(output, input.name + '-' + input.case_id), c = input.case; mkdirSync(d);
  if (c.stored_profile !== null) { mkdirSync(join(d, '.faff')); write(join(d, '.faff/infra-profile.json'), c.stored_profile); }
  const shown = spawnSync(process.execPath, [join(binding.root, 'plugin/skills/faff/bin/faff'), 'profile', 'show', '--json', '--root', d], { cwd: d, encoding: 'utf8', timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
  assert.equal(shown.status, c.source.profile_show.exit_code); assert.equal(shown.stdout, c.source.profile_show.stdout); assert.equal(shown.stderr, c.source.profile_show.stderr);
  assert.equal(gradeRenderedArtifact(input.text, c.oracle).pass, true);
  const consumer = consumeArchitectureArtifact(binding.root, input.text, d); assert.equal(consumer.pass, true);
  const value = consumer.producer_value; assert.ok(c.recommendations.includes(value.recommendation));
  assert.ok(Array.isArray(value.assumptions)); assert.ok(Array.isArray(value.adr_candidates));
  const bad = structuredClone(value); bad.recommendation = 'invented';
  const mutation = consumeArchitectureArtifact(binding.root, '```faff-contract:architecture-proposal\n' + JSON.stringify(bad) + '\n```\n', d);
  assert.equal(mutation.pass, false); assert.equal(mutation.exit_code, 1);
  write(join(d, 'consumption.json'), { profile: { exit_code: shown.status, stdout: shown.stdout, stderr: shown.stderr }, consumer, invalid_recommendation: mutation });
  results.push({ ...publicInput(input), status: 'pass', recommendation: value.recommendation, adr_candidates: value.adr_candidates.length, profile_exit: shown.status, contract_exit: consumer.exit_code, invalid_recommendation_rejected: true, consumption_sha256: sha256(readFileSync(join(d, 'consumption.json'))) });
}
assertCandidateCommandUnchanged(binding);
write(join(output, 'report.json'), { status: 'pass', mode: mode ? 'preflight-reference-proposals' : 'actual-artifact-replay', artifacts: results.length, results, limits: ['Actual proposal envelopes pass the real architecture-proposal CLI; original profile-show results are reproduced and invalid recommendation mutations rejected.', 'The shape validator does not establish architectural quality. Manual source-fact, stated-need and ADR-intent review is separate. No model acquisition, procurement, ADR creation or full caller workflow is claimed.'] });
console.log(JSON.stringify({ status: 'pass', artifacts: results.length }));
