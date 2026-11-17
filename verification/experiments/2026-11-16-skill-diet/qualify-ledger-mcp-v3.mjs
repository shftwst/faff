import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyLedgerArm } from './verify-ledger-mcp-arm-v3.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, root = resolve(evidence, '../../..');
const json = path => JSON.parse(readFileSync(path));
const hash = path => sha256(readFileSync(path));
const git = (directory, ...args) => execFileSync('git', args, { cwd: directory });
const testCommand = names => ['node', '--test', '--test-concurrency=4', ...names.map(name => 'test/' + name + '.test.mjs')];
const privateTests = ['control-parity-ledger', 'run-summary', 'run-ledger-serialiser', 'events'];
const mainTests = ['control-parity-ledger', 'control-parity-ledger-v2', 'control-parity-ledger-replay', 'run-summary', 'run-ledger-serialiser', 'events'];

export function comparableLedgerGate(gate) {
  const copy = structuredClone(gate);
  for (const sample of copy.samples) for (const row of sample.consumer_replay.cases) {
    const value = JSON.parse(row.results.runcheck.stdout);
    assert.equal(typeof value.run_dir, 'string');
    row.results.runcheck.stdout = JSON.stringify({ ...value, run_dir: '<isolated-replay-directory>' });
  }
  return copy;
}

export async function qualifyLedger(installedChecks = null) {
  const guards = new Map();
  const bind = relative => {
    const path = resolve(evidence, relative), digest = hash(path);
    if (guards.has(path)) assert.equal(digest, guards.get(path)); else guards.set(path, digest);
    return { path: relative, sha256: digest };
  };
  const read = relative => { bind(relative); return json(resolve(evidence, relative)); };
  bind('qualify-ledger-mcp-v3.mjs'); bind('check-ledger-mcp-main-v3.py');
  const arms = [];
  for (const arm of ['baseline', 'candidate']) {
    const path = `beep-ledger-mcp-v3-${arm}-gate.json`, gate = read(path);
    const fresh = await verifyLedgerArm(arm, gate.manual.path);
    for (const [input, digest] of Object.entries(fresh.inputs)) assert.equal(bind(input).sha256, digest);
    assert.deepEqual(comparableLedgerGate(fresh), comparableLedgerGate(gate));
    assert.equal(gate.status, 'pass'); assert.equal(gate.samples.length, 5);
    assert.ok(gate.samples.every(row => row.execution_cases === 3 && row.decisions === 11 && row.native === 'pass' && row.manual === 'pass' && row.details.status === 'pass' && row.consumer_replay.status === 'pass'));
    arms.push({ arm, gate: bind(path), execution_cases_passed: 15, decisions_passed: 55, native_samples_passed: 5, manual_execution_cases_passed: 15, manual_decisions_passed: 55, extra_detail_claims: gate.samples.reduce((sum, row) => sum + row.details.claims, 0), legacy_exact_projection: gate.samples.map(row => ({ sample: row.name, grade: row.legacy_exact_projection })) });
  }
  const review = read('beep-ledger-v2-source-review.json'), integration = read('beep-ledger-v2-integration.json'), registration = read('beep-ledger-mcp-v3-registration.json');
  assert.equal(bind(review.candidate).sha256, review.candidate_sha256);
  assert.equal(bind('baseline/beep-ledger-v2.md').sha256, review.baseline_sha256);
  assert.equal(registration.candidate_source_sha256, review.candidate_sha256); assert.equal(registration.baseline_source_sha256, review.baseline_sha256);
  const source = 'plugin/skills/faff-beep-boop/SKILL.md';
  assert.equal(integration.status, 'pass'); assert.equal(integration.source_sha256, review.candidate_sha256);
  assert.equal(git(integration.directory, 'rev-parse', 'HEAD').toString().trim(), integration.isolated_commit);
  assert.equal(sha256(git(integration.directory, 'show', integration.isolated_commit + ':' + source)), review.candidate_sha256);
  assert.equal(sha256(readFileSync(join(integration.directory, source))), review.candidate_sha256);
  assert.equal(git(integration.directory, 'status', '--porcelain', '--', 'plugin').toString().trim(), '');
  function checkRecord(record, tests, count) {
    assert.deepEqual(record.checks.map(row => row.check).sort(), ['adapter-lint', 'rule-inventory', 'tests']);
    const commands = { tests: testCommand(tests), 'adapter-lint': ['node', 'plugin/skills/faff/bin/faff', 'validate-adapters'], 'rule-inventory': ['node', 'plugin/skills/faff/bin/faff', 'rule-inventory', 'check', '--base', 'a8509086ad28fa0e55cf3d1d818f2055294e663b', '--json'] };
    for (const row of record.checks) {
      assert.equal(row.exit_code, 0); assert.deepEqual(row.command, commands[row.check]); assert.equal(bind(row.path).sha256, row.sha256);
      if (row.check === 'tests') {
        const log = readFileSync(join(evidence, row.path), 'utf8');
        assert.match(log, new RegExp('^# tests ' + count + '$', 'm')); assert.match(log, new RegExp('^# pass ' + count + '$', 'm')); assert.match(log, /^# fail 0$/m);
      }
    }
  }
  checkRecord(integration, privateTests, 143);
  let main = null;
  if (installedChecks) {
    main = read(installedChecks);
    const head = git(root, 'rev-parse', 'HEAD').toString().trim();
    assert.equal(main.status, 'pass'); assert.equal(main.source_commit, head); assert.equal(main.source_sha256, review.candidate_sha256);
    assert.equal(main.checker_sha256, bind('check-ledger-mcp-main-v3.py').sha256);
    assert.deepEqual(Object.keys(main.test_files_sha256).sort(), mainTests.map(name => 'test/' + name + '.test.mjs').sort());
    for (const [path, digest] of Object.entries(main.test_files_sha256)) assert.equal(bind(join(root, path)).sha256, digest);
    assert.equal(sha256(readFileSync(join(root, source))), review.candidate_sha256);
    assert.equal(sha256(git(root, 'show', head + ':' + source)), review.candidate_sha256);
    assert.equal(git(root, 'status', '--porcelain', '--', 'plugin').toString().trim(), '');
    checkRecord(main, mainTests, 181);
  }
  const files = ['independent-beep-ledger-v2-source-review.json', 'independent-beep-ledger-v2-evaluator-review.json', 'independent-ledger-consumer-replay-v1-review.json', 'independent-ledger-mcp-v3-gate-review.json', 'independent-beep-ledger-mcp-v3-prelaunch-review.json', 'beep-ledger-mcp-v1-hold.json', 'beep-ledger-mcp-v2-hold.json', 'mcp-transport-v4-qualification.json'];
  const bindings = files.map(bind);
  for (const [path, digest] of guards) assert.equal(hash(path), digest, 'changed during qualification: ' + path);
  return { schema: 1, accepted: !!main, status: main ? 'qualified-bounded-ledger-event-producer-consumer' : 'measurement-qualified-pending-source-integration', model: 'gpt-6-astra', effort: 'medium', before: arms[0], after: arms[1], source_sha256: review.candidate_sha256, source_review: bind('beep-ledger-v2-source-review.json'), private_integration: bind('beep-ledger-v2-integration.json'), main_source_commit: main?.source_commit ?? null, main_integration: main ? bind(installedChecks) : null, bindings, inputs: Object.fromEntries(guards), qualifier_sha256: hash(new URL(import.meta.url)), mandatory_dependencies_added: [], limits: [
    'Five original Astra samples per arm. Held Sol V1/V2 cohorts remain failed, unchanged and unpooled. No replacement or post-hoc qualification.',
    'V3 explicitly requests supplied issue details. Additional free-form claims require independent same-issue source grounding. Original exact-projection diagnostics are retained.',
    'All 30 execution cases and 110 decisions receive independent actual-output review. Native replay binds complete policy delivery and exact call/result attribution.',
    'Actual pinned ledger/event/runcheck/summary consumers use controlled observations, transcript counts and external summary dependencies. Exact snapshot replay permits only runcheck directory relocation.',
    'No full unattended loop, model-run open/close/governance, actual review/landing/filing, hosted publication, statistical or provider-wide equivalence proof.',
    'Opus confirmation remains pending. Source-byte/token savings do not measure provider billing.',
  ] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [output, installedChecks] = process.argv.slice(2);
  if (!output) throw new Error('usage: qualify-ledger-mcp-v3.mjs NEW_OUTPUT [MAIN_INTEGRATION_RECORD]');
  const result = await qualifyLedger(installedChecks);
  writeFileSync(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, accepted: result.accepted }));
}
