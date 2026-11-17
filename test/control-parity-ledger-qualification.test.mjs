import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparableLedgerGate } from '../verification/experiments/2026-11-16-skill-diet/qualify-ledger-mcp-v3.mjs';

const gate = path => ({ samples: [{ name: 'sample', native: 'pass', consumer_replay: { cases: [{ id: 'incomplete-ledger', ledger_sha256: 'original', results: { runcheck: { exit_code: 3, stdout: JSON.stringify({ run_dir: path, undispatched: ['OPEN-1'], clean: false }) }, summary: null } }] } }] });

test('gate replay comparison permits only the isolated directory to relocate', () => {
  const original = gate('/var/tmp/first'), later = gate('/var/tmp/second');
  assert.notDeepEqual(original, later);
  assert.deepEqual(comparableLedgerGate(original), comparableLedgerGate(later));
  assert.equal(JSON.parse(original.samples[0].consumer_replay.cases[0].results.runcheck.stdout).run_dir, '/var/tmp/first');
});

for (const [name, edit] of [
  ['missing incomplete work', row => { row.results.runcheck.stdout = JSON.stringify({ run_dir: '/var/tmp/second', undispatched: [], clean: true }); }],
  ['different consumer exit', row => { row.results.runcheck.exit_code = 0; }],
  ['different ledger bytes', row => { row.ledger_sha256 = 'changed'; }],
  ['unexpected final summary', row => { row.results.summary = 'complete'; }],
]) test('gate replay comparison retains ' + name, () => {
  const original = gate('/var/tmp/first'), later = gate('/var/tmp/second');
  edit(later.samples[0].consumer_replay.cases[0]);
  assert.notDeepEqual(comparableLedgerGate(original), comparableLedgerGate(later));
});
