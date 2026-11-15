import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSuites } from '../eval/control-parity.mjs';

const suite = () => ({ schema: 1, scenarios: [{ scenario: 'stale-review-blocks-merge', inputs_sha256: 'a'.repeat(64), policy_sha256: 'b'.repeat(64), prompt_sha256: 'c'.repeat(64), events: [
  { kind: 'read', target: 'review', payload: { head: 'old', current: 'new' } },
  { kind: 'decision', target: 'merge', payload: { allow: false, reason: 'stale' } },
  { kind: 'terminal', target: 'issue', payload: { status: 'blocked' } },
] }] });

test('same actions with new prompt bytes compare equal independent of object key order', () => {
  const after = suite(); after.scenarios[0].prompt_sha256 = 'd'.repeat(64);
  after.scenarios[0].events[0].payload = { current: 'new', head: 'old' };
  assert.equal(compareSuites(suite(), after).pass, true);
});

test('seeded bypass, omission, ordering and outcome mutations all fail parity', () => {
  const mutations = [
    e => e.splice(2, 0, { kind: 'effect-attempt', target: 'merge', payload: { head: 'new' } }),
    e => e.splice(0, 1),
    e => [e[0], e[1]] = [e[1], e[0]],
    e => e[2].payload.status = 'merged',
    e => e[1].payload.allow = true,
  ];
  for (const mutate of mutations) { const after = suite(); mutate(after.scenarios[0].events); assert.equal(compareSuites(suite(), after).pass, false); }
});

test('input or policy changes cannot pass as prompt-only parity', () => {
  for (const field of ['inputs_sha256', 'policy_sha256']) { const after = suite(); after.scenarios[0][field] = 'f'.repeat(64); assert.equal(compareSuites(suite(), after).pass, false); }
});

test('empty, duplicate, unknown and incomplete evidence fails closed', () => {
  const invalid = [
    { schema: 1, scenarios: [] },
    { ...suite(), extra: true },
    { schema: 1, scenarios: [suite().scenarios[0], suite().scenarios[0]] },
  ];
  const missingTerminal = suite(); missingTerminal.scenarios[0].events.pop(); invalid.push(missingTerminal);
  const unknownKind = suite(); unknownKind.scenarios[0].events[0].kind = 'claimed-success'; invalid.push(unknownKind);
  const coercedHash = suite(); coercedHash.scenarios[0].inputs_sha256 = ['a'.repeat(64)]; invalid.push(coercedHash);
  for (const value of invalid) assert.throws(() => compareSuites(suite(), value));
});

test('a missing or extra scenario is a coverage failure', () => {
  const after = suite(); after.scenarios[0].scenario = 'different-scenario';
  assert.equal(compareSuites(suite(), after).differences.length, 2);
});

test('non-finite JSON numbers and non-JSON API values cannot collapse into an equal trace', () => {
  const invalidValues = [JSON.parse('{"value":1e309}'), { value: NaN }, { value: undefined }, { value: 1n }, { value: new Date() }, { value: [, 1] }];
  const cycle = {}; cycle.self = cycle; invalidValues.push(cycle);
  for (const payload of invalidValues) {
    const before = suite(); const after = suite();
    before.scenarios[0].events[0].payload = { value: null };
    after.scenarios[0].events[0].payload = payload;
    assert.throws(() => compareSuites(before, after));
  }
});
