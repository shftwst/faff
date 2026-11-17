import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { replayLedgerConsumers } from '../verification/experiments/2026-11-16-skill-diet/replay-ledger-consumers-v1.mjs';
import { sha256 } from '../eval/control-parity/schema.mjs';

const evidence = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet');
const source = join(evidence, 'ledger-mcp-preflight-v2');
const load = path => JSON.parse(readFileSync(path));
function trial(change) {
  const directory = mkdtempSync('/var/tmp/faff-ledger-replay-test-');
  try {
    const capture = load(join(source, 'capture.json')), manifest = load(join(source, 'manifest.json'));
    const dependencies = load(join(evidence, 'workflow-fixtures/beep-ledger-summary-dependencies-v2.json'));
    change?.(capture, dependencies, manifest);
    const dependencyPath = join(directory, 'dependencies.json');
    writeFileSync(dependencyPath, JSON.stringify(dependencies) + '\n');
    manifest.dependencies_sha256 = sha256(readFileSync(dependencyPath));
    writeFileSync(join(directory, 'capture.json'), JSON.stringify(capture) + '\n');
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest) + '\n');
    return replayLedgerConsumers({ directory, dependencyPath });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('exact restored state reproduces real consumers and incomplete-work refusal', () => {
  const result = trial();
  assert.equal(result.status, 'pass');
  assert.equal(result.cases.length, 3);
  const incomplete = result.cases.find(row => row.id === 'incomplete-ledger');
  assert.equal(incomplete.results.runcheck.exit_code, 3);
  assert.deepEqual(JSON.parse(incomplete.results.runcheck.stdout).undispatched, ['OPEN-1']);
  assert.equal(incomplete.results.summary, null);
  const summary = result.cases.find(row => row.id === 'mixed-ledger').results.summary;
  assert.equal(summary.persisted, summary.stdout);
});

for (const [name, change] of [
  ['empty case set', capture => { capture.cases = []; }],
  ['omitted case', capture => { capture.cases.pop(); }],
  ['changed ledger bytes', capture => { capture.cases[0].ledger_bytes += ' '; }],
  ['changed event value', capture => { capture.cases[0].events.at(-1).type = 'changed'; }],
  ['changed event order', capture => { capture.cases[0].events.reverse(); }],
  ['changed append head', capture => { capture.events.find(row => row.case_id === 'mixed-ledger' && row.name === 'append_event').result.events_after_sha256 = 'changed'; }],
  ['changed event read', capture => { capture.cases[0].consumer.event_read.stdout = '[]'; }],
  ['missing summary record despite coherent dependency hash', (_capture, dependencies) => { delete dependencies.records['SUPER-1/supersession.json']; }],
  ['invented persisted summary', capture => { capture.cases[0].consumer.summary.persisted += 'invented'; }],
  ['wrong incomplete runcheck', capture => { capture.cases[1].consumer.runcheck.exit_code = 0; }],
  ['summary for incomplete work', capture => { capture.cases[1].consumer.summary = capture.cases[0].consumer.summary; }],
  ['runtime artifact substitution', (_capture, _dependencies, manifest) => { manifest.binding.artifacts[manifest.binding.entry] = 'changed'; }],
]) test('snapshot replay rejects ' + name, () => {
  assert.throws(() => trial(change));
});
