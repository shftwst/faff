import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const cleanEnvironment = () => ({ PATH: process.env.PATH, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' });

function command(executable, args, root) {
  const result = spawnSync(process.execPath, [executable, ...args], { cwd: root, env: cleanEnvironment(), encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 20 });
  return { exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
}

function compare(result, recorded, relocated = null) {
  for (const key of ['exit_code', 'stderr', 'error']) assert.deepEqual(result[key], recorded[key], key);
  if (relocated) {
    const expected = JSON.parse(recorded.stdout), actual = JSON.parse(result.stdout);
    assert.equal(expected.run_dir, relocated.original);
    assert.equal(actual.run_dir, relocated.current);
    assert.deepEqual({ ...actual, run_dir: expected.run_dir }, expected);
  } else assert.equal(result.stdout, recorded.stdout);
}

export function replayLedgerConsumers({ directory, dependencyPath, fixturePath = join(import.meta.dirname, 'workflow-fixtures/beep-ledger-v3.json') }) {
  const guarded = [join(directory, 'capture.json'), join(directory, 'manifest.json'), dependencyPath, fixturePath, new URL(import.meta.url), new URL('../../../eval/control-parity/reporting-execution.mjs', import.meta.url)];
  const guards = guarded.map(path => ({ path, sha256: sha256(readFileSync(path)) }));
  const manifest = json(join(directory, 'manifest.json')), capture = json(join(directory, 'capture.json')), dependency = json(dependencyPath);
  assert.equal(sha256(readFileSync(dependencyPath)), manifest.dependencies_sha256);
  assert.equal(sha256(readFileSync(fixturePath)), manifest.fixture_sha256);
  assert.deepEqual(capture.cases.map(row => row.id).sort(), json(fixturePath).cases.map(row => row.id).sort());
  const binding = bindCandidateCommand(manifest.binding.root, manifest.binding.commit);
  assert.deepEqual(binding, manifest.binding);
  const cli = join(binding.root, binding.entry), temporary = mkdtempSync('/var/tmp/faff-ledger-replay-'), cases = [];
  try {
    assert.equal(new Set(capture.cases.map(row => row.id)).size, capture.cases.length);
    for (const row of capture.cases) {
      assert.match(row.id, /^[a-z][a-z0-9-]+$/);
      assert.match(row.ledger.run_id, /^run-[a-zA-Z0-9-]+$/);
      const root = join(temporary, row.id), runDir = join(root, '.faff', 'runs', row.ledger.run_id);
      const ledgerPath = join(runDir, 'run-ledger.json'), eventsPath = join(runDir, 'events.jsonl'), heartbeatPath = join(runDir, 'heartbeat');
      const appends = capture.events.filter(event => event.case_id === row.id && event.name === 'append_event');
      assert.ok(appends.length);
      const eventsBytes = row.events.map(event => JSON.stringify(event)).join('\n') + '\n';
      assert.equal(sha256(eventsBytes), appends.at(-1).result.events_after_sha256);
      assert.equal(sha256(row.ledger_bytes), appends.at(-1).result.ledger_after_sha256);
      assert.deepEqual(JSON.parse(row.ledger_bytes), row.ledger);
      assert.deepEqual(JSON.parse(row.consumer.event_read.stdout), row.events);
      assert.deepEqual(row.events.slice(0, row.initial_events.length), row.initial_events);
      assert.deepEqual(appends.flatMap(event => event.result.appended), row.events.slice(row.initial_events.length));
      mkdirSync(runDir, { recursive: true });
      assert.equal(spawnSync('git', ['init', '-q', root], { env: cleanEnvironment() }).status, 0);
      writeFileSync(join(root, '.faffrc.yaml'), '');
      writeFileSync(ledgerPath, row.ledger_bytes);
      writeFileSync(eventsPath, eventsBytes);
      if (row.heartbeat !== null) writeFileSync(heartbeatPath, row.heartbeat);
      const results = {
        runcheck: command(cli, ['runcheck', runDir, '--json'], root),
        validate: command(cli, ['events', 'validate', '--file', eventsPath], root),
        event_read: command(cli, ['events', 'read', '--run', row.ledger.run_id, '--root', root, '--json'], root),
        verify: command(cli, ['events', 'verify', '--run-dir', runDir, '--json'], root),
        summary: null,
      };
      compare(results.runcheck, row.consumer.runcheck, { original: row.run_dir, current: runDir });
      for (const name of ['validate', 'event_read', 'verify']) compare(results[name], row.consumer[name]);
      if (row.id === 'mixed-ledger' && results.runcheck.exit_code === 0) {
        const facts = join(runDir, 'summary-facts.json'), payload = join(root, 'consume.json');
        write(facts, dependency.facts);
        for (const [path, value] of Object.entries(dependency.records)) {
          const target = resolve(runDir, path);
          assert.ok(target.startsWith(runDir + sep));
          mkdirSync(dirname(target), { recursive: true }); write(target, value);
        }
        write(payload, { runtimeRoot: binding.root, args: ['--run-dir', runDir, '--root', root, '--facts', facts], dependencies: dependency.dependencies });
        results.summary = command(resolve(import.meta.dirname, '../../../eval/control-parity/reporting-execution.mjs'), ['--consume', payload], root);
        results.summary.persisted = read(join(runDir, 'summary.md'));
        compare(results.summary, row.consumer.summary);
        assert.equal(results.summary.persisted, row.consumer.summary.persisted);
        assert.equal(results.summary.persisted, results.summary.stdout);
      } else assert.equal(row.consumer.summary, null);
      assert.equal(read(ledgerPath), row.ledger_bytes);
      assert.equal(read(eventsPath), eventsBytes);
      assert.equal(existsSync(heartbeatPath) ? read(heartbeatPath) : null, row.heartbeat);
      cases.push({ id: row.id, status: 'pass', ledger_sha256: sha256(row.ledger_bytes), events_sha256: sha256(eventsBytes), heartbeat_sha256: row.heartbeat === null ? null : sha256(row.heartbeat), results });
    }
    assertCandidateCommandUnchanged(binding);
    for (const guard of guards) assert.equal(sha256(readFileSync(guard.path)), guard.sha256);
    return { schema: 1, status: 'pass', scope: 'Exact final-state restoration and real consumers. Only runcheck run_dir relocates. No lifecycle, token acquisition or original model qualification claim.', inputs: guards.map(guard => ({ path: String(guard.path), sha256: guard.sha256 })), runtime_commit: binding.commit, runtime_artifacts_sha256: sha256(JSON.stringify(binding.artifacts)), cases };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, dependencyPath, output] = process.argv.slice(2);
  const result = replayLedgerConsumers({ directory: resolve(directory), dependencyPath: resolve(dependencyPath) });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, cases: result.cases.map(row => ({ id: row.id, status: row.status })) }));
}
