import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindCandidateCommand, invokeCandidateCommand } from '../eval/control-parity/candidate-command.mjs';
import { createFixtureTracker } from '../eval/control-parity/tracker.mjs';
import { gradeCommandUse, readCommandEvents } from '../eval/control-parity/command-use.mjs';

const git = (root, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8' }).trim();
const temp = () => mkdtempSync(join(tmpdir(), 'faff-candidate-command-'));
const input = { schema: 1, issue_id: 'ISS-1', faff_body: 'New finding', comments: [] };
const plan = { schema: 1, action: 'create', reason: 'created', comment_id: null, body: 'Exact proposed body', expectedDigest: null };
const source = `const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
if (process.argv.slice(2).join(' ') !== 'review-comment plan --input -') process.exit(3);
if (input.faff_body !== 'New finding') process.exit(4);
process.stdout.write(JSON.stringify(${JSON.stringify(plan)}));
`;
function repo(code = source) {
  const root = temp();
  const file = join(root, 'plugin/skills/faff/bin/faff');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, code);
  writeFileSync(join(root, 'plugin/skills/faff/build-manifest.json'), '{}\n');
  git(root, 'init', '-q'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'fixture');
  return { root, file, commit: git(root, 'rev-parse', 'HEAD') };
}

test('the adapter invokes the committed CLI and records exact command input and output', () => {
  const r = repo();
  const command = bindCandidateCommand(r.root, r.commit);
  const result = invokeCandidateCommand(command, input);
  assert.deepEqual(result.plan, plan);
  assert.deepEqual(result.evidence.input, input);
  assert.equal(result.evidence.source_commit, r.commit);
  assert.deepEqual(result.evidence.command, ['review-comment', 'plan', '--input', '-']);
  assert.equal(result.evidence.stdout, JSON.stringify(plan));
  assert.equal(result.evidence.exit_code, 0);
  assert.equal(result.evidence.error, null);
  assert.ok(Number.isSafeInteger(result.evidence.elapsed_ms));
  assert.ok(result.evidence.artifacts['plugin/skills/faff/bin/faff']);
  assert.equal(result.evidence.executable, process.execPath);
  assert.deepEqual(result.evidence.env_keys, []);
  assert.match(result.evidence.duration_ns, /^\d+$/);
  assert.equal(result.evidence.stdin, JSON.stringify(input));
});

test('source drift is refused before executing an altered command', () => {
  const r = repo();
  const command = bindCandidateCommand(r.root, r.commit);
  writeFileSync(r.file, 'throw new Error("must not run")');
  assert.throws(() => invokeCandidateCommand(command, input), /dirty|changed/);
  assert.throws(() => bindCandidateCommand(r.root, r.commit), /dirty|changed/);
});

test('a different committed plugin and an altered manifest invalidate the binding', () => {
  const r = repo();
  const command = bindCandidateCommand(r.root, r.commit);
  writeFileSync(join(r.root, 'plugin/skills/faff/build-manifest.json'), '{"changed":true}\n');
  git(r.root, 'add', '.'); git(r.root, 'commit', '-qm', 'changed');
  assert.throws(() => invokeCandidateCommand(command, input), /commit|changed/);
});

test('the command receives no credentials or parent configuration and cannot read the oracle', () => {
  const secret = join(temp(), 'expected-outcomes.json');
  writeFileSync(secret, 'not available to the candidate');
  const code = `const fs = require('node:fs');
try { fs.readFileSync(${JSON.stringify(secret)}); process.exit(9); }
catch (e) { if (e.code !== 'ERR_ACCESS_DENIED') throw e; }
for (const name of ['ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','NODE_OPTIONS','GH_TOKEN']) {
  if (process.env[name]) process.exit(8);
}
process.stdout.write(JSON.stringify(${JSON.stringify(plan)}));`;
  const r = repo(code);
  const result = invokeCandidateCommand(bindCandidateCommand(r.root, r.commit), input);
  assert.deepEqual(result.plan, plan);
  assert.equal(result.evidence.exit_code, 0);
});

for (const [name, code, error] of [
  ['nonzero exit', 'process.stderr.write("rejected input"); process.exit(2);', 'command-exit'],
  ['malformed JSON', 'process.stdout.write("not JSON");', 'invalid-plan'],
  ['plausible but incomplete plan', 'process.stdout.write(JSON.stringify({action:"create"}));', 'invalid-plan'],
  ['timeout', 'while (true) {}', 'command-timeout'],
]) {
  test(`${name} produces recorded failure rather than a write plan`, () => {
    const r = repo(code);
    const result = invokeCandidateCommand(bindCandidateCommand(r.root, r.commit), input, { timeoutMs: 150 });
    assert.equal(result.plan, null);
    assert.equal(result.evidence.error, error);
  });
}

test('update plans require the original body digest and an existing comment id', () => {
  for (const value of [
    { ...plan, action: 'update', reason: 'updated', comment_id: 'missing' },
    { ...plan, action: 'update', reason: 'updated', comment_id: 'c1', expectedDigest: 'a'.repeat(64) },
  ]) {
    const r = repo(`process.stdout.write(JSON.stringify(${JSON.stringify(value)}))`);
    const result = invokeCandidateCommand(bindCandidateCommand(r.root, r.commit), { ...input, comments: [{ id: 'c1', body: 'original' }] });
    assert.equal(result.plan, null);
    assert.equal(result.evidence.error, 'invalid-plan');
  }
});

test('the command cannot write files or spawn a subprocess', () => {
  const marker = join(temp(), 'must-not-exist');
  const r = repo(`
for (const f of [() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad'),
                 () => require('node:child_process').execFileSync('true')]) {
  try { f(); process.exit(9); } catch (e) { if (e.code !== 'ERR_ACCESS_DENIED') throw e; }
}
process.stdout.write(JSON.stringify(${JSON.stringify(plan)}));`);
  assert.deepEqual(invokeCandidateCommand(bindCandidateCommand(r.root, r.commit), input).plan, plan);
});

for (const flag of ['--assume-unchanged', '--skip-worktree']) test(`Git ${flag} cannot hide altered executable bytes`, () => {
  const r = repo();
  git(r.root, 'update-index', flag, 'plugin/skills/faff/bin/faff');
  writeFileSync(r.file, source + '\nprocess.exit(5);');
  assert.equal(git(r.root, 'status', '--porcelain'), '');
  assert.throws(() => bindCandidateCommand(r.root, r.commit), /committed bytes/);
});

test('invalid UTF-8 in a plausible plan is rejected and retained as original bytes', () => {
  const r = repo(`process.stdout.write(Buffer.from(${JSON.stringify(JSON.stringify(plan))}.replace('Exact proposed body', '\\xff'), 'latin1'))`);
  const result = invokeCandidateCommand(bindCandidateCommand(r.root, r.commit), input);
  assert.equal(result.plan, null);
  assert.equal(result.evidence.error, 'invalid-plan');
  assert.ok(Buffer.from(result.evidence.stdout_base64, 'base64').includes(255));
});

test('input and output byte limits refuse oversized command traffic', () => {
  const r = repo('process.stdout.write("x".repeat(100000))');
  const binding = bindCandidateCommand(r.root, r.commit);
  assert.throws(() => invokeCandidateCommand(binding, input, { maxInputBytes: 1 }), /input.*limit/);
  const result = invokeCandidateCommand(binding, input, { maxOutputBytes: 32 });
  assert.equal(result.plan, null);
  assert.equal(result.evidence.error, 'command-output-limit');
});

test('the stdio MCP server invokes the committed CLI and preserves evidence through a tracker write', () => {
  const r = repo();
  const directory = temp();
  const bindingPath = join(temp(), 'binding.json');
  writeFileSync(bindingPath, JSON.stringify(bindCandidateCommand(r.root, r.commit)));
  const fixture = { ...input, tracker: { comments: [], next_comment_id: 'new', now: '2026-11-15T00:00:00Z' } };
  const tracker = createFixtureTracker({ directory, initialState: fixture.tracker, issueId: fixture.issue_id });
  const messages = [
    ['list_comments', { issue_id: input.issue_id }], ['plan_review_comment', input],
    ['create_comment', { issue_id: input.issue_id, body: plan.body }], ['finish', { status: 'completed', reason: plan.reason }],
  ].map(([name, args], i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } })).join('\n') + '\n';
  const output = execFileSync(process.execPath, [new URL('../eval/control-parity/tool-server.mjs', import.meta.url).pathname, directory, bindingPath], { input: messages, encoding: 'utf8' });
  const replies = output.trim().split('\n').map(JSON.parse);
  assert.equal(replies.length, 4);
  assert.ok(replies.every(r => r.result.isError === false));
  const commands = readCommandEvents(directory);
  assert.equal(commands[1].evidence.source_commit, r.commit);
  assert.deepEqual(commands[1].plan, plan);
  assert.equal(gradeCommandUse({ commands, events: tracker.readEvents(), fixture }).status, 'followed');
});
