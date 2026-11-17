import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { consumeSpecReviewArtifact } from '../../../eval/control-parity/spec-review-artifact.mjs';
import { gradeRenderedArtifact } from '../../../eval/control-parity/rendering-artifact.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
const [baselineArg, candidateArg, outputArg, mode] = process.argv.slice(2);
if (!outputArg || mode && mode !== '--preflight') throw Error('usage: replay-spec-review-artifacts.mjs BASELINE_PLAN CANDIDATE_PLAN NEW_DIRECTORY [--preflight]');
const root = import.meta.dirname, output = resolve(outputArg), read = p => JSON.parse(readFileSync(p, 'utf8'));
const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const plans = [baselineArg, candidateArg].map(p => ({ path: resolve(p), value: read(resolve(p)) }));
assert.equal(plans[0].value.runtime_root, plans[1].value.runtime_root);
assert.equal(plans[0].value.runtime_commit, plans[1].value.runtime_commit);
assert.equal(plans[0].value.fixture, plans[1].value.fixture);
const binding = bindCandidateCommand(plans[0].value.runtime_root, plans[0].value.runtime_commit);
const fixturePath = join(root, plans[0].value.fixture), fixture = read(fixturePath), inputs = [];
for (const plan of plans) {
  assert.equal(plan.value.samples.length, 5);
  for (const sample of plan.value.samples) {
    if (mode && inputs.length) break;
    const d = join(root, 'workflow-runs', sample.name);
    if (!mode) {
      assert.equal(read(join(d, 'report.json')).status, 'pass');
      assert.equal(read(join(d, 'native-audit.json')).runs[0].status, 'pass');
    }
    for (const c of fixture.cases) {
      const path = join(d, 'artifacts', c.id + '.md'), text = mode ? c.reference : readFileSync(path, 'utf8');
      inputs.push({ name: sample.name, arm: sample.arm, case_id: c.id, path: mode ? null : path, sha256: sha256(text), text, case: c,
        report_sha256: mode ? null : sha256(readFileSync(join(d, 'report.json'))),
        native_audit_sha256: mode ? null : sha256(readFileSync(join(d, 'native-audit.json'))) });
    }
  }
}
assert.equal(inputs.length, fixture.cases.length * (mode ? 1 : 10));
mkdirSync(output);
const publicInput = ({ text, case: c, ...row }) => row;
write(join(output, 'manifest.json'), { mode: mode ? 'preflight-reference-verdicts' : 'actual-artifact-replay', binding,
  script_sha256: sha256(readFileSync(new URL(import.meta.url))), consumer_sha256: sha256(readFileSync(new URL('../../../eval/control-parity/spec-review-artifact.mjs', import.meta.url))),
  fixture_sha256: sha256(readFileSync(fixturePath)), plans: plans.map(p => ({ path: p.path, sha256: sha256(readFileSync(p.path)) })), inputs: inputs.map(publicInput) });
const results = [];
for (const input of inputs) {
  const d = join(output, input.name + '-' + input.case_id), c = input.case;
  mkdirSync(d);
  assert.equal(gradeRenderedArtifact(input.text, c.oracle).pass, true);
  const consumer = consumeSpecReviewArtifact(binding.root, input.text, d);
  assert.equal(consumer.pass, true);
  const value = consumer.producer_value;
  assert.equal(value.verdict, c.expected_verdict);
  assert.equal(consumer.route?.value?.destination ?? null, c.expected_route);
  if (c.required_lens) assert.ok(value.objections.some(o => o.lens === c.required_lens));
  assert.equal(new Set(value.objections.map(o => o.lens)).size, value.objections.length);
  const headings = new Set([...c.source.spec_body.matchAll(/^#{1,6}\s+(.+)$/gm)].map(m => m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')));
  for (const o of value.objections) {
    assert.ok(c.source.selected_lenses.includes(o.lens));
    for (const field of ['claim', 'evidence', 'predicted_consequence']) assert.ok(typeof o[field] === 'string' && o[field].trim());
    if (o.spec_anchor !== undefined) assert.ok(headings.has(o.spec_anchor));
  }
  const unfounded = value.verdict === 'approve'
    ? { verdict: 'revise', objections: [] }
    : { ...value, verdict: 'approve' };
  const mutation = consumeSpecReviewArtifact(binding.root, '```faff-contract:spec-review-verdict\n' + JSON.stringify(unfounded) + '\n```\n', d);
  assert.equal(mutation.pass, false);
  write(join(d, 'consumption.json'), { consumer, unfounded_mutation: mutation });
  results.push({ ...publicInput(input), status: 'pass', verdict: value.verdict, destination: consumer.route?.value?.destination ?? null,
    objections: value.objections.length, unfounded_verdict_rejected: true, consumption_sha256: sha256(readFileSync(join(d, 'consumption.json'))) });
}
assertCandidateCommandUnchanged(binding);
write(join(output, 'report.json'), { status: 'pass', mode: mode ? 'preflight-reference-verdicts' : 'actual-artifact-replay', artifacts: results.length, results,
  limits: ['Real contract and reject-approach route consumption of actual persisted artifacts, with founded-verdict negative controls.',
    'No prep iteration, live tracker mutation, human escalation or L4 refuter execution. Judgement and source-fact fidelity require separate manual review.'] });
console.log(JSON.stringify({ status: 'pass', artifacts: results.length }));
