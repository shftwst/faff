import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bindCandidateCommand } from '../eval/control-parity/candidate-command.mjs';
import { buildPromptBundle, HANDOFF_ALLOWED_TOOLS } from '../eval/control-parity/claude-driver.mjs';
import { openHandoff, readHandoffEvents, gradeHandoff } from '../eval/control-parity/handoff-tools.mjs';
import { createFixtureTracker, loadPolicyBytes } from '../eval/control-parity/tracker.mjs';
import { loadInputs } from '../eval/control-parity/run.mjs';

test('handoff treatment removes model-authored tracker writes and preserves earlier tool treatments', () => {
  const input = { issue_id: 'X', faff_body: 'text', reason_codes: ['updated'] };
  const options = { input, policyBytes: Buffer.from('policy') };
  assert.deepEqual(buildPromptBundle({ ...options, handoff: true }).allowed_tools, HANDOFF_ALLOWED_TOOLS);
  assert.deepEqual(HANDOFF_ALLOWED_TOOLS, ['mcp__tracker__prepare_review_comment', 'mcp__tracker__apply_review_comment', 'mcp__tracker__finish']);
  assert.equal(buildPromptBundle(options).allowed_tools.length, 4);
  assert.equal(buildPromptBundle({ ...options, candidate: true }).allowed_tools.length, 5);
  assert.throws(() => buildPromptBundle({ ...options, candidate: true, handoff: true }), /treatment/);
});

test('bound eval executes shipped connector and catches an escaping mutation independently', async t => {
  const root = resolve('.');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const binding = bindCandidateCommand(root, commit);
  const { fixtures } = loadInputs(root);
  const fixture = fixtures.get('crlf-outside-region');
  const directory = mkdtempSync(join(tmpdir(), 'faff-handoff-eval-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tracker = createFixtureTracker({ directory, issueId: fixture.issue_id, initialState: fixture.tracker });
  const handoff = await openHandoff({ binding, directory });
  t.after(() => handoff.close());
  const prepared = await handoff.call('prepare_review_comment', { issue_id: fixture.issue_id, faff_body: fixture.faff_body });
  const applied = await handoff.call('apply_review_comment', { plan_ref: prepared.plan_ref });
  await handoff.call('finish', { status: 'completed', reason: applied.reason });
  const calls = readHandoffEvents(directory);
  const events = tracker.readEvents();
  assert.equal(gradeHandoff({ calls, events, fixture }).status, 'followed');
  const tampered = structuredClone(events);
  const write = tampered.find(e => e.kind === 'effect-attempt');
  write.args.body = JSON.stringify(write.args.body).slice(1, -1);
  assert.equal(gradeHandoff({ calls, events: tampered, fixture }).status, 'effect-mismatch');
  assert.ok(loadPolicyBytes(root).includes('apply_review_comment'));
});

test('actual eval stdio entry works with its cleared credential environment', { timeout: 10000 }, async t => {
  const root = resolve('.');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const binding = bindCandidateCommand(root, commit);
  const fixture = loadInputs(root).fixtures.get('crlf-outside-region');
  const directory = mkdtempSync(join(tmpdir(), 'faff-handoff-stdio-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tracker = createFixtureTracker({ directory, issueId: fixture.issue_id, initialState: fixture.tracker });
  const bindingPath = join(directory, 'binding.json');
  writeFileSync(bindingPath, JSON.stringify(binding));
  const child = spawn(process.execPath, [resolve('eval/control-parity/handoff-tools.mjs'), directory, bindingPath]);
  t.after(() => child.kill());
  let errors = '', id = 0;
  const pending = new Map();
  child.stderr.on('data', data => { errors += data; });
  child.once('exit', () => { for (const entry of pending.values()) entry.reject(new Error(errors || 'eval server exited')); });
  createInterface({ input: child.stdout }).on('line', line => {
    const response = JSON.parse(line);
    pending.get(response.id)?.resolve(response);
    pending.delete(response.id);
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const call = async (name, args) => {
    const response = await request('tools/call', { name, arguments: args });
    assert.equal(response.result.isError, false, JSON.stringify(response));
    return JSON.parse(response.result.content[0].text);
  };
  await request('initialize', { protocolVersion: '2025-06-18' });
  const tools = (await request('tools/list')).result.tools;
  assert.deepEqual(tools.map(t => `mcp__tracker__${t.name}`), HANDOFF_ALLOWED_TOOLS);
  const prepared = await call('prepare_review_comment', { issue_id: fixture.issue_id, faff_body: fixture.faff_body });
  const applied = await call('apply_review_comment', { plan_ref: prepared.plan_ref });
  await call('finish', { status: 'completed', reason: applied.reason });
  assert.equal(gradeHandoff({ calls: readHandoffEvents(directory), events: tracker.readEvents(), fixture }).status, 'followed');
  child.stdin.end();
});
