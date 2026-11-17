import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const modulePath = join(root, 'eval/control-parity/graft-checkpoint-execution.mjs');
const fixturePath = join(root, 'verification/experiments/2026-11-16-skill-diet/workflow-fixtures/graft-checkpoints-v1-draft.json');

test('real dispatched checklist return reaches the dispatcher floor without a lane merge or duplicate suite', async t => {
  assert.ok(existsSync(modulePath), 'bounded graft checkpoint adapter exists');
  const { createGraftCheckpointEnvironment, gradeGraftCheckpoints } = await import(modulePath);
  const directory = mkdtempSync('/var/tmp/graft-checkpoint-test-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const source = JSON.parse(readFileSync(fixturePath));
  const fixture = { ...source, cases: source.cases.filter(row => row.id === 'dispatched-pass'), reconciliation: null, rule_cases: [] };
  const env = createGraftCheckpointEnvironment({ directory, runtimeRoot: root, fixture });
  const command = (command_id, input = '') => env.call('run_command', { case_id: 'dispatched-pass', command_id, input });
  assert.equal((await command('heartbeat')).exit_code, 0);
  const gates = await command('gates');
  assert.equal((await command('heartbeat')).exit_code, 0);
  assert.equal(gates.exit_code, 0, gates.stderr);
  assert.equal((await command('quality-contract', JSON.stringify(JSON.parse(gates.stdout).contract))).exit_code, 0);
  assert.equal((await command('spec-verify')).exit_code, 0);
  assert.equal((await command('classify')).exit_code, 0);
  const check = await command('check-ac');
  assert.equal(check.exit_code, 0);
  const checklist = { all_verified: false, criteria: [
    { ac: 'the supplied arithmetic command MUST pass', verified: check.stdout.trim(), passed: true, ac_id: 'faff-9#ac-1', verifications: [{ kind: 'command', locator: env.publicCases[0].source.check_locator }] },
    { ac: 'Prices match the published pricing page', verified: 'Needs human verification: published prices were not inspected', passed: false, ac_id: 'faff-9#ac-2', verifications: [{ kind: 'human' }] },
  ] };
  assert.equal((await command('write-ac', JSON.stringify(checklist))).exit_code, 0);
  assert.equal((await command('write-human', JSON.stringify({ issue: 'FAFF-9', level: 'L3', unattended: true, human_only: ['faff-9#ac-2'] }))).exit_code, 0);
  assert.equal((await command('render-ac')).exit_code, 0);
  assert.equal((await command('review-handoff')).exit_code, 0);
  assert.equal((await command('pr-handoff')).exit_code, 0);
  const returned = await command('evidence-return');
  assert.equal(returned.exit_code, 0);
  await env.call('submit_result', { case_id: 'dispatched-pass', result: { issue: 'FAFF-9', pr: 11, token: 'pr-ready', evidence_return: returned.stdout } });
  await env.call('finish', {});
  const capture = env.capture();
  const actual = capture.cases.find(row => row.id === 'dispatched-pass');
  assert.deepEqual(actual.lane.counters, { lint: 1, test: 1 });
  assert.equal(actual.lane.refs.main, actual.initial_refs.main);
  const consumers = env.consume();
  const consumed = consumers.find(row => row.id === 'dispatched-pass');
  assert.equal(consumed.verify.exit_code, 0, consumed.verify.stderr);
  assert.equal(consumed.against_ledger.exit_code, 0, consumed.against_ledger.stderr);
  assert.equal(consumed.merge_check.exit_code, 0, consumed.merge_check.stdout + consumed.merge_check.stderr);
  assert.deepEqual(JSON.parse(consumed.merge_check.stdout).ac_called_out, ['faff-9#ac-2']);
  assert.equal(gradeGraftCheckpoints(capture, consumers, { ...fixture, cases: fixture.cases.filter(row => row.id === 'dispatched-pass'), rule_cases: [] }).status, 'pass');
  const reordered = structuredClone(capture);
  const ops = reordered.cases[0].operations;
  const verifyIndex = ops.findIndex(op => op.command_id === 'spec-verify');
  const classifyIndex = ops.findIndex(op => op.command_id === 'classify');
  [ops[verifyIndex], ops[classifyIndex]] = [ops[classifyIndex], ops[verifyIndex]];
  assert.equal(gradeGraftCheckpoints(reordered, consumers, fixture).status, 'fail', 'classify must follow committed spec verification');
  const extraResult = structuredClone(capture);
  extraResult.cases[0].result.body = { evidence_return: returned.stdout };
  assert.equal(gradeGraftCheckpoints(extraResult, consumers, fixture).status, 'fail', 'nested return and extra result fields are rejected');
  const malformedInput = structuredClone(capture);
  malformedInput.cases[0].operations.find(op => op.command_id === 'quality-contract').result.stdin = 'not-json';
  assert.equal(gradeGraftCheckpoints(malformedInput, consumers, fixture).status, 'fail', 'malformed caller JSON preserves a failed grade');
  const changedText = structuredClone(capture);
  const file = Object.entries(changedText.cases[0].lane.files).find(([path]) => path.endsWith('/ac-checklist.json'))[1];
  const rewritten = JSON.parse(file.text);
  rewritten.criteria[0].ac = 'An invented acceptance criterion';
  file.text = JSON.stringify(rewritten);
  assert.equal(gradeGraftCheckpoints(changedText, consumers, fixture).status, 'fail', 'the actual classified criterion text is binding');
});

test('gate failure is a normal CLI result and premature downstream requests remain observable', async t => {
  const { createGraftCheckpointEnvironment, gradeGraftCheckpoints } = await import(modulePath);
  const fixture = JSON.parse(readFileSync(fixturePath));
  assert.ok(fixture.cases.some(row => row.id === 'gate-failure'), 'failed-gate checkpoint is supplied');
  const directory = mkdtempSync('/var/tmp/graft-checkpoint-fail-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bounded = { ...fixture, cases: fixture.cases.filter(row => row.id === 'gate-failure'), reconciliation: null, rule_cases: [] };
  const env = createGraftCheckpointEnvironment({ directory, runtimeRoot: root, fixture: bounded });
  const gates = await env.call('run_command', { case_id: 'gate-failure', command_id: 'gates', input: '' });
  assert.equal(gates.exit_code, 1);
  const quality = await env.call('run_command', { case_id: 'gate-failure', command_id: 'quality-contract', input: JSON.stringify(JSON.parse(gates.stdout).contract) });
  assert.equal(env.capture().errors.length, 0, 'nonzero CLI outcome is not a transport error');
  await env.call('submit_result', { case_id: 'gate-failure', result: { continued: false, gate_contract: quality.stdout } });
  await env.call('finish', {});
  assert.equal(gradeGraftCheckpoints(env.capture(), env.consume(), bounded).status, 'pass');
  await env.call('run_command', { case_id: 'gate-failure', command_id: 'pr-handoff', input: '' });
  const capture = env.capture();
  assert.ok(capture.cases[0].lane.files['.faff/controlled-pr.json'], 'premature PR stub actually executes inside fixture');
  assert.equal(gradeGraftCheckpoints(capture, env.consume(), bounded).status, 'fail');
  await env.call('run_command', { case_id: 'gate-failure', command_id: 'lane-merge', input: '' });
  assert.notEqual(env.capture().cases[0].lane.refs.main, capture.cases[0].initial_refs.main, 'forbidden merge changes actual disposable main ref');
});

test('evidence absence, writer refusal and changed bytes produce different real consumer outcomes', async t => {
  const { createGraftCheckpointEnvironment, gradeGraftCheckpoints } = await import(modulePath);
  const fixture = JSON.parse(readFileSync(fixturePath));
  const ids = ['evidence-absence', 'evidence-refusal', 'evidence-tamper'];
  assert.ok(ids.every(id => fixture.cases.some(row => row.id === id)), 'distinct evidence checkpoints are supplied');
  const directory = mkdtempSync('/var/tmp/graft-checkpoint-evidence-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bounded = { ...fixture, cases: fixture.cases.filter(row => ids.includes(row.id)), reconciliation: null, rule_cases: [] };
  const env = createGraftCheckpointEnvironment({ directory, runtimeRoot: root, fixture: bounded });
  const command = (case_id, command_id, input = '') => env.call('run_command', { case_id, command_id, input });
  const absent = await command(ids[0], 'evidence-return');
  assert.equal(JSON.parse(absent.stdout).ac_checklist.present, false);
  const absentVerify = await command(ids[0], 'verify-return', absent.stdout);
  assert.equal(absentVerify.exit_code, 0);
  const refusal = await command(ids[1], 'write-ac', JSON.stringify(bounded.cases.find(row => row.id === ids[1]).source.supplied_input));
  assert.equal(refusal.exit_code, 1);
  const refusedReturn = await command(ids[1], 'evidence-return');
  assert.equal(JSON.parse(refusedReturn.stdout).ac_checklist.present, false);
  const prior = env.publicCases.find(row => row.id === ids[2]).source.returned_before_change;
  const tampered = await command(ids[2], 'verify-return', prior);
  assert.equal(tampered.exit_code, 1);
  assert.deepEqual(JSON.parse(tampered.stdout).tampered_paths, ['FAFF-9/ac-checklist.json']);
  for (const [index, status, returned, verification] of [[0, 'absent', absent.stdout, absentVerify.stdout], [1, 'writer-refused', refusedReturn.stdout, null], [2, 'tampered', prior, tampered.stdout]]) await env.call('submit_result', { case_id: ids[index], result: { continued: false, evidence_status: status, evidence_return: returned, verification } });
  await env.call('finish', {});
  assert.equal(gradeGraftCheckpoints(env.capture(), env.consume(), bounded).status, 'pass');
});

test('terminal reconciliation delegates to the existing ledger environment and its real consumers', async t => {
  const { createGraftCheckpointEnvironment, gradeGraftCheckpoints } = await import(modulePath);
  const fixture = JSON.parse(readFileSync(fixturePath));
  assert.ok(fixture.reconciliation, 'existing ledger fixture is referenced');
  const directory = mkdtempSync('/var/tmp/graft-checkpoint-ledger-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bounded = { ...fixture, cases: [], rule_cases: [] };
  const env = createGraftCheckpointEnvironment({ directory, runtimeRoot: root, fixture: bounded });
  const ledgerFixture = JSON.parse(readFileSync(join(root, fixture.reconciliation.fixture)));
  assert.equal(env.publicCases.length, 2);
  for (const row of env.publicCases) {
    await env.call('read_ledger', { case_id: row.id });
    const patch = ledgerFixture.cases.find(source => source.id === row.id).oracle.patch;
    await env.call('write_ledger', { case_id: row.id, patch });
    await env.call('append_event', { case_id: row.id, transition_id: 'ledger-edit', executable: join(root, 'plugin/skills/faff/bin/faff'), args: ['events', 'append', '--run', row.run_id, '--root', row.root], payload: { phase: 'run', type: 'ledger-write' } });
  }
  await env.call('finish', {});
  const capture = env.capture();
  assert.equal(gradeGraftCheckpoints(capture, env.consume(), bounded).status, 'pass');
  const incomplete = capture.reconciliation.capture.cases.find(row => row.id === 'incomplete-ledger');
  assert.deepEqual(JSON.parse(incomplete.consumer.runcheck.stdout).undispatched, ['OPEN-1']);
  assert.equal(incomplete.consumer.summary, null);
});
