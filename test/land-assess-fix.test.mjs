import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from './helpers/run-cli.mjs';

const oldHead = 'a'.repeat(40);
const newHead = 'b'.repeat(40);
const first = { pr: 7, issue: 'I-1', token: 'needs-fix', reason: 'regression', head_sha: oldHead, failing_checks: ['unit', 'lint', 'unit'] };
const conflict = { ...first, reason: 'conflict' };
const next = { pr: 7, issue: 'I-1', head_sha: newHead };
function files(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'assess-fix-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}
function assess(cwd, before, after, mode = 'unattended') {
  writeFileSync(join(cwd, 'before.json'), JSON.stringify(before));
  const args = ['land', 'assess-fix', '--before', 'before.json', '--mode', mode];
  if (after) {
    writeFileSync(join(cwd, 'after.json'), JSON.stringify(after));
    args.push('--after', 'after.json', '--pushed', newHead);
  }
  return runCli(args, { cwd });
}
for (const [label, before, after, mode, expected] of [
  ['no push records the old regression head', first, null, 'shadow', { action: 'record-failed', kind: 'regression', head_sha: oldHead, failing_checks: ['lint', 'unit'] }],
  ['a continued conflict records the pushed head', conflict, { ...next, token: 'needs-fix', reason: 'conflict' }, 'unattended', { action: 'record-failed', kind: 'conflict', head_sha: newHead, failing_checks: [] }],
  ['one repeated failure records the full sorted post-fix set', first, { ...next, token: 'needs-fix', reason: 'regression', failing_checks: ['unit', 'a, b', 'unit'] }, 'unattended', { action: 'record-failed', kind: 'regression', head_sha: newHead, failing_checks: ['a, b', 'unit'] }],
  ['distinct check names return to the loop', first, { ...next, token: 'needs-fix', reason: 'regression', failing_checks: ['Unit'] }, 'unattended', { action: 'continue' }],
  ['a different failure class parks a resolved shadow cycle', conflict, { ...next, token: 'needs-fix', reason: 'regression' }, 'shadow', { action: 'park-shadow' }],
  ['a ready fix continues through the ordinary landing floor', first, { ...next, token: 'ready' }, 'unattended', { action: 'continue' }],
  ['pending needs another observation', first, { pr: 7, issue: 'I-1', token: 'pending' }, 'shadow', { action: 'observe-again' }],
  ['deadline preserves the counter', first, { pr: 7, issue: 'I-1', token: 'landing-resumable' }, 'unattended', { action: 'landing-resumable' }],
]) test(label, t => {
  const cwd = files(t);
  const result = assess(cwd, before, after, mode);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expected);
  assert.deepEqual(readdirSync(cwd).sort(), after ? ['after.json', 'before.json'] : ['before.json']);
});

test('missing evidence, wrong head or identity and invalid tokens refuse without a decision', t => {
  const cwd = files(t);
  for (const [before, after] of [
    [{ ...first, failing_checks: [] }, null],
    [first, { ...next, token: 'needs-fix', reason: 'regression' }],
    [first, { ...next, head_sha: oldHead, token: 'ready' }],
    [first, { ...next, issue: 'I-2', token: 'pending' }],
    [first, { ...next, pr: 8, token: 'ready' }],
    [first, { ...next, token: 'dry-run' }],
    [first, { ...next, token: 'errored' }],
  ]) {
    const r = assess(cwd, before, after);
    assert.equal(r.code, 2); assert.equal(r.stdout, '');
  }
  const r = assess(cwd, first, null, 'off');
  assert.equal(r.code, 2); assert.equal(r.stdout, '');
});
test('the CLI rejects partial push inputs and a missing observation', t => {
  const cwd = files(t);
  for (const extra of [['--pushed', newHead], ['--after', 'after.json'], ['--unknown'], []]) {
    const r = runCli(['land', 'assess-fix', '--before', 'absent', '--mode', 'shadow', ...extra], { cwd });
    assert.equal(r.code, 2); assert.equal(r.stdout, '');
  }
});
test('the checkpoint consumes exact check names from the assessor', t => {
  const cwd = files(t);
  const after = { ...next, token: 'needs-fix', reason: 'regression', failing_checks: ['unit', 'a, b'] };
  const assessment = JSON.parse(assess(cwd, first, after).stdout);
  const args = ['landing-progress', 'record-fix-cycle', cwd, first.issue, '--kind', assessment.kind, '--head-sha', assessment.head_sha];
  for (const flags of [['--failing-checks-json', '{}'], ['--failing-checks-json', '[]', '--failing-checks', 'other']]) {
    assert.equal(runCli([...args, ...flags]).code, 2);
    assert.equal(runCli(['landing-progress', 'read', cwd, first.issue]).code, 3);
  }
  const result = runCli([...args, '--failing-checks-json', JSON.stringify(assessment.failing_checks)]);
  assert.equal(result.code, 0, result.stderr);
  const checkpoint = JSON.parse(result.stdout);
  assert.equal(checkpoint.fix_cycles, 1);
  assert.equal(checkpoint.last_head_sha, newHead);
  assert.deepEqual(checkpoint.history[0].failing_checks, ['a, b', 'unit']);
});
