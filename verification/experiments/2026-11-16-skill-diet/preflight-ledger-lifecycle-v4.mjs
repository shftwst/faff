import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const output = resolve(process.argv[2]);
mkdirSync(output);
const runtime = resolve(import.meta.dirname, '../../../../review-comment-interactive');
const commit = 'a8509086ad28fa0e55cf3d1d818f2055294e663b';
const binding = bindCandidateCommand(runtime, commit), cli = join(runtime, binding.entry);
const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'USER', 'LOGNAME'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' });
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const owned = [], cases = [], commands = [], finalSnapshots = [];
function command(root, args, input = '') {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, input, encoding: 'utf8', timeout: 45000 });
  const value = { root, args, input, exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
  commands.push(value);
  assert.equal(value.error, null, value.error ?? '');
  return value;
}
function snapshot(run) {
  return Object.fromEntries(['run-ledger.json', 'events.jsonl', 'heartbeat'].map(name => [name, existsSync(join(run, name)) ? readFileSync(join(run, name), 'utf8') : null]));
}
function open(name) {
  const root = mkdtempSync('/var/tmp/faff-ledger-lifecycle-');
  owned.push({ root, run: null });
  const git = spawnSync('git', ['init', '-q', root], { env, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  mkdirSync(join(root, '.faff'));
  const result = command(root, ['run', 'open', '--mode', 'full', '--root', root, '--session-id', name, '--json']);
  assert.equal(result.exit_code, 0, result.stderr);
  const parsed = JSON.parse(result.stdout), run = parsed.run_dir;
  owned.at(-1).run = run;
  const ledger = json(join(run, 'run-ledger.json'));
  assert.equal(ledger.level, 'L3');
  assert.equal(ledger.owner.status, 'running');
  assert.equal(ledger.budget.measure_root, root);
  assert.match(run, /run-\d{8}-\d{6}-beepboop-full-[a-f0-9]+$/);
  assert.equal(json(join(root, '.claude/settings.json')).hooks !== undefined, true);
  return { root, run, id: run.split('/').at(-1), session: name, opened: snapshot(run) };
}
function admit(value) {
  const file = join(value.run, 'run-ledger.json'), ledger = json(file);
  ledger.admitted = ['LIFE-A', 'LIFE-B'];
  writeFileSync(file, JSON.stringify(ledger, null, 2) + '\n');
  assert.equal(command(value.root, ['events', 'append', '--run', value.id, '--root', value.root], JSON.stringify({ phase: 'run', type: 'ledger-write' })).exit_code, 0);
}
function close(value) {
  return command(value.root, ['run', 'close', '--run-dir', value.run, '--stop-reason', 'queue-drained', '--root', value.root, '--session-id', value.session, '--json']);
}
let failure = null;
try {
  const complete = open('ledger-preflight-complete'); admit(complete);
  const record = (issue, outcome) => command(complete.root, ['run-ledger', 'record-outcome', '--issue', issue, '--outcome', outcome, '--run-dir', complete.run, '--root', complete.root]);
  assert.equal(record('LIFE-A', 'parked').exit_code, 0);
  assert.equal(json(join(complete.run, 'run-ledger.json')).owner.status, 'running');
  const ledgerBeforeTick = readFileSync(join(complete.run, 'run-ledger.json'));
  const tick = command(complete.root, ['heartbeat', complete.run]);
  assert.equal(tick.exit_code, 0, tick.stderr);
  assert.deepEqual(readFileSync(join(complete.run, 'run-ledger.json')), ledgerBeforeTick);
  assert.ok(existsSync(join(complete.run, 'heartbeat')));
  assert.equal(record('LIFE-B', 'superseded').exit_code, 0);
  assert.equal(command(complete.root, ['runcheck', complete.run, '--json']).exit_code, 0);
  assert.equal(close(complete).exit_code, 0);
  const final = snapshot(complete.run), ledger = JSON.parse(final['run-ledger.json']);
  assert.deepEqual(ledger.outcomes, { 'LIFE-A': 'parked', 'LIFE-B': 'superseded' });
  assert.equal(ledger.owner.status, 'done'); assert.equal(ledger.stop_reason, 'queue-drained');
  const events = final['events.jsonl'].trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.type === 'run-start').length, 1);
  assert.ok(events.some(event => event.type === 'run-end'));
  assert.deepEqual(events.map(event => event.seq), events.map((_event, index) => index));
  const stopped = command(complete.root, ['sentry-poller', 'status', '--run-dir', complete.run, '--json']);
  assert.equal(JSON.parse(stopped.stdout).running, false);
  cases.push({ id: 'complete-lifecycle', status: 'pass', open: complete.opened, final, heartbeat_ledger_unchanged: true, event_schemas: [...new Set(events.map(event => event.schema))] });

  const incomplete = open('ledger-preflight-incomplete'); admit(incomplete);
  const incompleteBefore = snapshot(incomplete.run), refused = close(incomplete);
  assert.equal(refused.exit_code, 3, refused.stderr);
  assert.deepEqual(JSON.parse(refused.stdout).undispatched, ['LIFE-A', 'LIFE-B']);
  assert.deepEqual(snapshot(incomplete.run), incompleteBefore);
  cases.push({ id: 'incomplete-close-refusal', status: 'pass', before: incompleteBefore, after: snapshot(incomplete.run), exit_code: refused.exit_code });

  const corrupt = open('ledger-preflight-corrupt');
  writeFileSync(join(corrupt.run, 'run-ledger.json'), '{broken');
  const corruptBefore = snapshot(corrupt.run), unreadable = close(corrupt);
  assert.equal(unreadable.exit_code, 2);
  assert.match(unreadable.stderr, /JSON|read|ledger/i);
  assert.deepEqual(snapshot(corrupt.run), corruptBefore);
  cases.push({ id: 'unreadable-close-refusal', status: 'pass', before: corruptBefore, after: snapshot(corrupt.run), exit_code: unreadable.exit_code });
  assertCandidateCommandUnchanged(binding);
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally {
  for (const value of owned) {
    if (value.run) finalSnapshots.push({ root: value.root, run: value.run, files: snapshot(value.run) });
    if (value.run) command(value.root, ['sentry-poller', 'stop', '--run-dir', value.run]);
    rmSync(value.root, { recursive: true, force: true });
  }
}
write(join(output, 'capture.json'), { cases, commands, final_snapshots: finalSnapshots, failure });
write(join(output, 'report.json'), { schema: 1, status: failure ? 'fail' : 'pass', scope: 'Deterministic real CLI lifecycle feasibility only. Controlled admission mutation followed by real ledger-write event; no model skill fidelity, summary publication or savings claim. All temporary repositories and owned sentry pollers cleaned up.', binding, client_sha256: sha256(readFileSync(new URL(import.meta.url))), capture_sha256: sha256(readFileSync(join(output, 'capture.json'))), cases: cases.map(row => ({ id: row.id, status: row.status })), failure });
console.log(JSON.stringify({ status: failure ? 'fail' : 'pass', cases: cases.length, failure: failure?.message ?? null }));
process.exitCode = failure ? 1 : 0;
