import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { openHandoff, readHandoffEvents, gradeHandoff } from '../../../eval/control-parity/handoff-tools.mjs';
import { createFixtureTracker } from '../../../eval/control-parity/tracker.mjs';
import { loadInputs } from '../../../eval/control-parity/run.mjs';
import { consumeReviewArtifact } from '../../../eval/control-parity/review-producer.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const [baselineArg, candidateArg, outputArg, mode] = process.argv.slice(2);
if (!outputArg || mode && mode !== '--preflight') throw new Error('usage: replay-review-handoff.mjs BASELINE_PLAN CANDIDATE_PLAN NEW_DIRECTORY [--preflight]');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const root = import.meta.dirname, output = resolve(outputArg);
const plans = [baselineArg, candidateArg].map(path => ({ path: resolve(path), value: read(resolve(path)) }));
assert.equal(plans[0].value.runtime_root, plans[1].value.runtime_root);
assert.equal(plans[0].value.runtime_commit, plans[1].value.runtime_commit);
const binding = bindCandidateCommand(plans[0].value.runtime_root, plans[0].value.runtime_commit);
const original = loadInputs(binding.root).fixtures.get('crlf-outside-region');
const inputs = [];
for (const plan of plans) {
  assert.equal(plan.value.samples.length, 5);
  const fixture = read(join(root, plan.value.fixture));
  assert.equal(fixture.cases.length, 7);
  for (const sample of plan.value.samples) {
    if (mode && inputs.length) break;
    const directory = join(root, 'workflow-runs', sample.name);
    const reportPath = join(directory, 'report.json'), auditPath = join(directory, 'native-audit.json');
    const report = read(reportPath), audit = read(auditPath);
    assert.equal(report.status, 'pass');
    assert.equal(audit.runs.length, 1);
    assert.equal(audit.runs[0].status, 'pass');
    for (const item of fixture.cases) {
      if (mode && inputs.length) break;
      const path = join(directory, 'artifacts', item.id + '.md');
      inputs.push({ name: sample.name, arm: sample.arm, case_id: item.id, path, sha256: sha256(readFileSync(path)), report_sha256: sha256(readFileSync(reportPath)), native_audit_sha256: sha256(readFileSync(auditPath)) });
    }
  }
}
assert.equal(inputs.length, mode ? 1 : 70);
mkdirSync(output);
write(join(output, 'manifest.json'), { schema: 1, mode: mode ? 'preflight' : 'actual-artifact-replay', binding, script_sha256: sha256(readFileSync(new URL(import.meta.url))), plans: plans.map(p => ({ path: p.path, sha256: sha256(readFileSync(p.path)) })), inputs });
const results = [];
for (const input of inputs) {
  const directory = join(output, input.name + '-' + input.case_id);
  const text = readFileSync(input.path, 'utf8');
  assert.equal(sha256(text), input.sha256);
  const fixture = { ...structuredClone(original), faff_body: text };
  const tracker = createFixtureTracker({ directory, issueId: fixture.issue_id, initialState: fixture.tracker });
  const consumption = consumeReviewArtifact(binding.root, text, directory);
  assert.equal(consumption.pass, true);
  const handoff = await openHandoff({ binding, directory });
  try {
    const prepared = await handoff.call('prepare_review_comment', { issue_id: fixture.issue_id, faff_body: text });
    const applied = await handoff.call('apply_review_comment', { plan_ref: prepared.plan_ref });
    await handoff.call('finish', { status: 'completed', reason: applied.reason });
    const events = tracker.readEvents(), calls = readHandoffEvents(directory);
    assert.equal(gradeHandoff({ calls, events, fixture }).status, 'followed');
    const expected = `Human note\r\n\r\n<!-- faff-review-findings:ISS-111 -->\n${text}\n<!-- /faff-review-findings:ISS-111 -->\n\r\nTrailing note`;
    const comments = tracker.readState().issues['ISS-111'];
    assert.equal(comments.length, 1);
    assert.equal(comments[0].id, 'ISS-111-c1');
    assert.equal(comments[0].created_at, original.tracker.comments[0].created_at);
    assert.equal(comments[0].body, expected);
    const attempts = events.filter(e => e.kind === 'effect-attempt');
    assert.deepEqual(attempts.map(e => ({ op: e.op, args: e.args })), [{ op: 'save_comment', args: { id: 'ISS-111-c1', body: expected } }]);
    assert.notEqual(JSON.stringify(expected).slice(1, -1), expected, 'escaping mutation must fail the byte oracle');
    assert.notEqual(expected.replaceAll('\r\n', '\n'), expected, 'newline-normalisation mutation must fail the byte oracle');
    results.push({ ...input, status: 'pass', signal: consumption.value.signal, consumer: consumption, handoff: 'followed', reads: events.filter(e => e.kind === 'read').length, acknowledged_writes: events.filter(e => e.kind === 'effect-result' && e.acknowledged && e.outcome === 'applied').length, expected_body_sha256: sha256(expected), persisted_body_sha256: sha256(comments[0].body) });
  } finally { await handoff.close(); }
}
assertCandidateCommandUnchanged(binding);
const report = { schema: 1, status: 'pass', mode: mode ? 'preflight' : 'actual-artifact-replay', artifacts: results.length, results, limits: ['Deterministic replay of actual measured producer artifacts through the real review-verdict CLI and stored-comment connector with a subprocess fixture tracker.', 'The controlled caller performs prepare/apply/finish. This does not measure model selection of those calls, full graft orchestration, or hosted tracker behaviour.', 'The two mutation checks require escaped output and normalised outside-region CRLF to differ from the independent literal byte oracle.'] };
write(join(output, 'report.json'), report);
console.log(JSON.stringify({ status: report.status, mode: report.mode, artifacts: report.artifacts }));
