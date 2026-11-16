import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGatewayEnvironment, gradeGatewayExecution } from '../eval/control-parity/gateway-execution.mjs';

const cli = fileURLToPath(new URL('../plugin/skills/faff/bin/faff', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/gateway.json', import.meta.url)));
const init = ['config', 'init', '--set', 'tracking.spec_docs_path='];

test('gateway execution compares real CLI effects and preserves existing housekeeping data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-execution-'));
  try {
    const cases = fixture.cases.filter(c => c.id === 'case-b');
    const env = createGatewayEnvironment({ root, cli, fixture: { ...fixture, cases } });
    const command = args => env.call('run_faff', { case_id: 'case-b', executable: cli, args });
    assert.equal((await command(['config', 'path'])).exit_code, 3);
    assert.equal((await env.call('offer_onboarding', { case_id: 'case-b', message: fixture.offer })).answer, 'n');
    for (const args of [init, ['gitignore-ensure'], ['hooks-ensure']]) assert.equal((await command(args)).exit_code, 0);
    await env.call('invoke_skill', { case_id: 'case-b', name: 'faff:faff-prep', args: ['FAFF-7001'] });
    const result = gradeGatewayExecution(env.capture(), env.expected);
    assert.equal(result.status, 'pass', JSON.stringify(result));
    assert.match(readFileSync(join(root, 'cases/case-b/.claude/settings.json'), 'utf8'), /preserve-hook/);
    await command(['config', 'init', '--set', 'tracking.repo=unexpected']);
    assert.equal(gradeGatewayExecution(env.capture(), env.expected).status, 'fail');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('autonomous configuration writes and reordered decline mutations fail execution fidelity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-execution-'));
  try {
    const cases = fixture.cases.filter(c => ['case-a', 'case-c'].includes(c.id));
    const env = createGatewayEnvironment({ root, cli, fixture: { ...fixture, cases } });
    for (const id of ['case-a', 'case-c']) await env.call('run_faff', { case_id: id, executable: cli, args: ['config', 'path'] });
    await env.call('offer_onboarding', { case_id: 'case-a', message: fixture.offer });
    for (const args of [['hooks-ensure'], init, ['gitignore-ensure']]) await env.call('run_faff', { case_id: 'case-a', executable: cli, args });
    await env.call('invoke_skill', { case_id: 'case-a', name: 'faff-wtf', args: [] });
    await env.call('run_faff', { case_id: 'case-c', executable: cli, args: init });
    await env.call('invoke_skill', { case_id: 'case-c', name: 'faff-beep-boop', args: [] });
    const result = gradeGatewayExecution(env.capture(), env.expected);
    assert.equal(result.status, 'fail');
    assert.equal(result.cases.filter(c => !c.pass).length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('gateway CLI port records and refuses an attempt to escape the disposable workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'gateway-execution-'));
  try {
    const env = createGatewayEnvironment({ root, cli, fixture: { ...fixture, cases: [fixture.cases[2]] } });
    await assert.rejects(env.call('run_faff', { case_id: 'case-c', executable: cli, args: ['hooks-ensure', '--root', join(root, 'outside-case')] }), /outside gateway fixture scope/);
    assert.equal(env.capture().errors.length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
