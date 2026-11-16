import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createKernelConfigEnvironment, gradeKernelConfigExecution } from '../eval/control-parity/kernel-config-execution.mjs';

const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/kernel-config.json', import.meta.url)));
const cli = resolve(import.meta.dirname, '../plugin/skills/faff/bin/faff');

test('kernel fixture executes real layered reads, surgical writes, refusals and dispatch resolution', async () => {
  const root = mkdtempSync(join(tmpdir(), 'faff-kernel-test-'));
  try {
    const env = createKernelConfigEnvironment({ root, cli, fixture });
    for (const row of fixture.cases) {
      const case_id = row.id;
      for (const args of row.expected.writes) assert.equal((await env.call('run_faff', { case_id, executable: cli, args })).exit_code, 0);
      for (const read of row.expected.reads) {
        const result = await env.call('run_faff', { case_id, executable: cli, args: read.args });
        assert.equal(result.exit_code, read.exit, `${case_id}: ${result.stderr}`);
        if (read.exit === 2) assert.ok(result.stderr.trim());
      }
      for (const { tool, ...args } of row.expected.effects) await env.call(tool, { case_id, ...args });
      await env.call('submit_result', { case_id, status: row.expected.status, values: row.expected.values, reason: row.expected.status === 'blocked' ? 'CLI refused the configuration.' : '' });
    }
    for (const row of fixture.rule_cases) await env.call('answer_rule', { case_id: row.id, value: row.expected });
    const capture = env.capture(), grade = gradeKernelConfigExecution(capture, env.expected, env.expectedRules);
    assert.equal(grade.status, 'pass', JSON.stringify(grade.cases));
    assert.equal(grade.cases.filter(c => c.kind === 'execution').length, 9);
    assert.equal(grade.cases.filter(c => c.kind === 'decision').length, 24);
    const wrongRule = structuredClone(capture);
    wrongRule.rule_answers.find(r => r.id === 'lenient-l4').value.mint_allowed = true;
    assert.equal(gradeKernelConfigExecution(wrongRule, env.expected, env.expectedRules).status, 'fail');
    const wrongDispatch = structuredClone(capture);
    wrongDispatch.events.find(e => e.case_id === 'absent-tier' && e.name === 'dispatch_build').args.model = 'fable';
    assert.ok(gradeKernelConfigExecution(wrongDispatch, env.expected).cases.find(c => c.id === 'absent-tier').problems.includes('dispatch'));
    const rawRead = structuredClone(capture);
    rawRead.events.push({ seq: 999, case_id: 'layered', name: 'read_file', args: { path: '.faff/config.yaml' } });
    assert.ok(gradeKernelConfigExecution(rawRead, env.expected).cases.find(c => c.id === 'layered').problems.includes('raw-config-access'));
    rawRead.events.at(-1).args.path = 'CLAUDE.md';
    assert.equal(gradeKernelConfigExecution(rawRead, env.expected).status, 'pass');
    const reordered = structuredClone(capture);
    const call = reordered.events.find(e => e.case_id === 'tier-precedence' && e.name === 'run_faff');
    call.args.args = ['dispatch', 'resolve', 'build', '--confidence', 'high', '--tier', 'mechanical'];
    assert.equal(gradeKernelConfigExecution(reordered, env.expected).status, 'pass');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('kernel file ports expose in-fixture choices but refuse paths outside the case', async () => {
  const root = mkdtempSync(join(tmpdir(), 'faff-kernel-test-'));
  try {
    const env = createKernelConfigEnvironment({ root, cli, fixture });
    await assert.rejects(env.call('read_file', { case_id: 'layered', path: '../other/.faff/config.yaml' }), /outside fixture/);
    const result = await env.call('read_file', { case_id: 'layered', path: '.faff/config.yaml' });
    assert.match(result.text, /fixture-base-spec/);
    assert.equal(gradeKernelConfigExecution(env.capture(), env.expected).status, 'fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
