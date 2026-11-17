import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAdversarialEnvironment, gradeAdversarialExecution } from '../eval/control-parity/adversarial-execution.mjs';

const runtime = resolve('.');
const row = { id: 'phase1-stop', level: 'L3', autonomous: true, phase1: 'fail', provider: 'critical', expected: { signal: 'fail', helper_exit: null, checkpoint: [] } };
const fixture = { cases: [row] };
const verdict = { signal: 'fail', findings: [{ title: 'Missing requirement', location: 'src/store.js:1', action: 'Implement the stated requirement.', location_present: true, action_present: true }] };
const review = `Review failed.\n\n\`\`\`faff-contract:review-verdict\n${JSON.stringify(verdict)}\n\`\`\`\n`;

async function setup(t) {
  const work = mkdtempSync(join(tmpdir(), 'adversarial-execution-test-'));
  const env = await createAdversarialEnvironment({ root: work, runtime, fixture });
  t.after(async () => { await env.close(); rmSync(work, { recursive: true, force: true }); });
  return env;
}

test('phase-one failure reaches the real persisted merge-floor check without a helper or checkpoint', async t => {
  const env = await setup(t);
  const base = { case_id: row.id };
  await env.call('invoke_skill', { ...base, name: 'faffter-noon-review' });
  const result = await env.call('submit_review', { ...base, text: review });
  assert.equal(result.contract.exit_code, 0);
  assert.equal(result.gate.pass, false);
  assert.equal(result.gate.review_verdict, 'fail');
  assert.equal(gradeAdversarialExecution(env.capture(), fixture).status, 'pass');
  const changed = structuredClone(env.capture());
  changed.cases[0].verdict.signal = 'pass';
  assert.equal(gradeAdversarialExecution(changed, fixture).status, 'fail');
});

test('fixture refuses writes to the run ledger and arbitrary executable commands, preserving failures', async t => {
  const env = await setup(t);
  const c = env.publicCases[0];
  await assert.rejects(env.call('write_file', { case_id: row.id, path: join(c.run_dir, 'run-ledger.json'), content: '{"level":"L3"}' }), /outside writable/);
  await assert.rejects(env.call('run_command', { case_id: row.id, executable: process.execPath, args: ['-e', 'process.exit(0)'] }), /outside executable/);
  assert.equal(env.capture().errors.length, 2);
  assert.equal(gradeAdversarialExecution(env.capture(), fixture).status, 'fail');
});

const captured = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-runs/adversarial-preflight-v3/capture.json', import.meta.url)));
const executionFixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/adversarial.json', import.meta.url)));

test('execution grader rejects a lost run directory, premature checkpoint and downgraded critical', () => {
  assert.equal(gradeAdversarialExecution(captured, executionFixture).status, 'pass');
  for (const mutate of [
    c => { const h = c.events.find(e => e.case_id === 'case-d' && e.command_kind === 'review'); const i = h.args.args.indexOf('--run-dir'); h.args.args.splice(i, 2); },
    c => { const e = c.events.find(e => e.case_id === 'case-b' && e.command_kind === 'faff' && e.args.args.includes('complete')); e.seq = 0; },
    c => { c.cases.find(c => c.id === 'case-b').verdict.findings[0].severity = 'minor'; },
  ]) {
    const changed = structuredClone(captured);
    mutate(changed);
    assert.equal(gradeAdversarialExecution(changed, executionFixture).status, 'fail');
  }
});

test('interactive findings may stay on stdout; autonomous checkpoint findings must be preserved', () => {
  const changed = structuredClone(captured);
  changed.cases.find(c => c.id === 'case-a').findings_text = null;
  assert.equal(gradeAdversarialExecution(changed, executionFixture).status, 'pass');
  changed.cases.find(c => c.id === 'case-b').findings_text = null;
  const grade = gradeAdversarialExecution(changed, executionFixture);
  assert.equal(grade.status, 'fail');
  assert.ok(grade.cases.find(c => c.id === 'case-b').problems.includes('findings-bytes-changed'));
});

test('an allowed output existence probe stays visible and does not excuse other failed reads', () => {
  const changed = structuredClone(captured), state = changed.cases.find(c => c.id === 'case-a');
  const error = 'ENOENT: output has not been written';
  changed.events.unshift({ seq: 0, name: 'read_file', case_id: 'case-a', args: { case_id: 'case-a', path: state.files.system }, error });
  changed.errors.push({ seq: 0, case_id: 'case-a', message: error });
  const grade = gradeAdversarialExecution(changed, executionFixture);
  assert.equal(grade.status, 'pass');
  assert.equal(grade.diagnostics[0].kind, 'unwritten-output-read');
  assert.equal(changed.errors.length, 1);
  changed.events[0].args.path = state.files.context;
  assert.equal(gradeAdversarialExecution(changed, executionFixture).status, 'fail');
  changed.events[0].args.path = state.files.system;
  changed.events[0].error = 'outside supplied files';
  assert.equal(gradeAdversarialExecution(changed, executionFixture).status, 'fail');
});
