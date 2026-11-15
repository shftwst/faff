// Synthetic fixtures only: these traces are hand-written recorder shapes, not observed model behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHash, compareRuns, parseStrictJson, validateRegistry, validateTrace } from '../eval/control-parity/schema.mjs';
import { main } from '../eval/control-parity/schema.mjs';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const H = c => c.repeat(64);
const OPEN = '<!-- faff-review-findings:ISS-1 -->';
const CLOSE = '<!-- /faff-review-findings:ISS-1 -->';
const FINAL_A = H('1');
const FINAL_B = H('2');

const entry = (id, final) => ({
  id,
  synthetic: true,
  input_sha256: H('a'),
  policy_sha256: H('b'),
  source_rules: ['review.md:locate-step-2'],
  expected: {
    reads_before_first_effect: [{ op: 'list_comments', args: { issue_id: 'ISS-1' } }],
    effects: [{ op: 'create_comment', args: { issue_id: 'ISS-1', body: `${OPEN}\nnew\n${CLOSE}` } }],
    terminal: { status: 'completed', reason: 'created' },
    final_state_sha256: final,
  },
});

const registry = () => ({
  schema: 2,
  registry_id: 'review-comments-dev',
  reason_codes: ['created', 'updated', 'reconciled', 'blocked'],
  scenarios: [entry('A', FINAL_A), entry('B', FINAL_B)],
});

const trace = (scenario, final, attempt = 1) => ({
  schema: 2,
  scenario,
  attempt,
  input_sha256: H('a'),
  policy_sha256: H('b'),
  prompt_sha256: H('c'),
  runtime_sha256: H('d'),
  events: [
    { seq: 1, kind: 'read', op: 'list_comments', args: { issue_id: 'ISS-1' }, result: { comments: [] } },
    { seq: 2, kind: 'effect-attempt', id: 'e1', op: 'create_comment', args: { issue_id: 'ISS-1', body: `${OPEN}\nnew\n${CLOSE}` } },
    { seq: 3, kind: 'effect-result', attempt_id: 'e1', outcome: 'applied', acknowledged: true },
    { seq: 4, kind: 'terminal', status: 'completed', reason: 'created', final_state_sha256: final },
  ],
  final_state_sha256: final,
  stop: null,
  accounting: { usage_complete: true, served_models: ['claude-opus-5-5'], requests: 2 },
});

const run = traces => ({ schema: 2, run_id: 'r', traces });
const full = () => run([trace('A', FINAL_A), trace('B', FINAL_B)]);

test('the unmodified control passes against itself', () => {
  const result = compareRuns(registry(), full(), full());
  assert.equal(result.status, 'pass', JSON.stringify(result));
});

test('two runs that both omit required case B do not pass', () => {
  const onlyA = run([trace('A', FINAL_A)]);
  const result = compareRuns(registry(), onlyA, onlyA);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.coverage.baseline.missing, ['B']);
  assert.deepEqual(result.coverage.candidate.missing, ['B']);
});

test('duplicate and unexpected cases are rejected', () => {
  assert.throws(() => compareRuns(registry(), run([trace('A', FINAL_A), trace('A', FINAL_A), trace('B', FINAL_B)]), full()), /duplicate/i);
  assert.throws(() => compareRuns(registry(), run([...full().traces, trace('Z', FINAL_A)]), full()), /unexpected/i);
});

test('structurally broken evidence is rejected before comparison', () => {
  const broken = [
    t => { t.events[3] = { seq: 4, kind: 'terminal' }; },
    t => { t.events[3].status = ''; },
    t => { [t.events[1], t.events[2]] = [t.events[2], t.events[1]]; t.events[1].seq = 2; t.events[2].seq = 3; },
    t => { t.events.splice(3, 0, { seq: 4, kind: 'effect-result', attempt_id: 'e1', outcome: 'applied', acknowledged: true }); t.events[4].seq = 5; },
    t => { t.events.push({ seq: 5, kind: 'read', op: 'list_comments', args: { issue_id: 'ISS-1' }, result: { comments: [] } }); },
    t => { t.final_state_sha256 = H('9'); },
    t => { t.events[2].outcome = 'probably'; },
    t => { t.events[3].reason = 'not-a-registry-code'; },
    t => { t.events[2].seq = 7; },
    t => { t.extra = true; },
  ];
  for (const mutate of broken) {
    const t = trace('A', FINAL_A);
    mutate(t);
    assert.throws(() => validateTrace(t, registry().scenarios[0], registry()), undefined, mutate.toString());
  }
});

test('a trace with neither a terminal event nor a recorded stop is rejected; a recorded stop is incomplete', () => {
  const t = trace('A', FINAL_A);
  t.events.pop();
  assert.throws(() => validateTrace(t, registry().scenarios[0], registry()));
  t.stop = { reason: 'timeout' };
  assert.equal(validateTrace(t, registry().scenarios[0], registry()).status, 'incomplete');
});

test('an unresolved attempt cannot support completion', () => {
  const t = trace('A', FINAL_A);
  t.events[2].outcome = 'unknown';
  assert.equal(validateTrace(t, registry().scenarios[0], registry()).status, 'incomplete');
});

test('missing usage or model identity is incomplete, never success', () => {
  for (const mutate of [a => { a.usage_complete = false; }, a => { a.served_models = []; }]) {
    const t = trace('A', FINAL_A);
    mutate(t.accounting);
    assert.equal(validateTrace(t, registry().scenarios[0], registry()).status, 'incomplete');
  }
});

test('a claimed completion without the required state fails the independent obligations', () => {
  const t = trace('A', H('7'));
  t.events = [t.events[0], { ...t.events[3], seq: 2 }];
  const v = validateTrace(t, registry().scenarios[0], registry());
  assert.equal(v.status, 'fail');
  assert.ok(v.failures.includes('effects-differ'));
  assert.ok(v.failures.includes('final-state-differs'));
});

test('a write before the required live read fails', () => {
  const t = trace('A', FINAL_A);
  t.events = [{ ...t.events[1], seq: 1 }, { ...t.events[2], seq: 2 }, { ...t.events[0], seq: 3 }, t.events[3]];
  assert.ok(validateTrace(t, registry().scenarios[0], registry()).failures.includes('read-before-effect'));
});

test('seeded changed body, swapped effects, bypassed read and changed outcome all fail comparison', () => {
  const twoEffects = () => {
    const r = registry();
    r.scenarios[0].expected.effects.push({ op: 'save_comment', args: { id: 'c1', body: 'x' } });
    return r;
  };
  const twoEffectTrace = () => {
    const t = trace('A', FINAL_A);
    t.events.splice(3, 0,
      { seq: 4, kind: 'effect-attempt', id: 'e2', op: 'save_comment', args: { id: 'c1', body: 'x' } },
      { seq: 5, kind: 'effect-result', attempt_id: 'e2', outcome: 'applied', acknowledged: true });
    t.events[5].seq = 6;
    return t;
  };
  const base = run([twoEffectTrace(), trace('B', FINAL_B)]);
  assert.equal(compareRuns(twoEffects(), base, base).status, 'pass');

  const changedBody = structuredClone(base); changedBody.traces[0].events[1].args.body += ' ';
  const swapped = structuredClone(base);
  const ev = swapped.traces[0].events;
  [ev[1], ev[3]] = [{ ...ev[3], seq: 2 }, { ...ev[1], seq: 4 }];
  [ev[2], ev[4]] = [{ ...ev[4], seq: 3 }, { ...ev[2], seq: 5 }];
  const bypass = structuredClone(base);
  bypass.traces[0].events.shift();
  bypass.traces[0].events.forEach((e, i) => { e.seq = i + 1; });
  const outcome = structuredClone(base); outcome.traces[1].events[3].reason = 'updated';
  for (const candidate of [changedBody, swapped, bypass, outcome]) {
    assert.equal(compareRuns(twoEffects(), base, candidate).status, 'fail');
  }
});

test('object key order is canonicalised but string bytes and array order are significant', () => {
  const a = trace('A', FINAL_A);
  const b = trace('A', FINAL_A);
  b.events[0].args = { issue_id: 'ISS-1' };
  b.events[0] = Object.fromEntries(Object.entries(b.events[0]).reverse());
  assert.equal(canonicalHash(a.events), canonicalHash(b.events));
  b.events[0].result = { comments: ['x', 'y'] };
  a.events[0].result = { comments: ['y', 'x'] };
  assert.notEqual(canonicalHash(a.events), canonicalHash(b.events));
  assert.notEqual(canonicalHash({ s: 'é' }), canonicalHash({ s: 'é' }));
});

test('different runtime treatment between arms is reported as unpaired, not as a pass', () => {
  const candidate = full();
  candidate.traces[0].runtime_sha256 = H('e');
  const result = compareRuns(registry(), full(), candidate);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.differences.some(d => d.reason === 'unpaired-runtime'));
});

test('a changed input hash cannot be evidence for the registry scenario', () => {
  const t = trace('A', FINAL_A);
  t.input_sha256 = H('f');
  assert.throws(() => validateTrace(t, registry().scenarios[0], registry()), /input/);
});

test('a baseline that violates an obligation fails even when the candidate copies it', () => {
  const bad = full();
  bad.traces[0].events[3].reason = 'updated';
  assert.equal(compareRuns(registry(), bad, structuredClone(bad)).status, 'fail');
});

test('strict JSON rejects unsafe integers, fractions, exponents and duplicate keys', () => {
  for (const text of ['{"a":9007199254740993}', '{"a":1.5}', '{"a":1e3}', '{"a":-0}', '{"a":1,"a":2}', '{"a":"x","b":{"c":1,"c":1}}']) {
    assert.throws(() => parseStrictJson(text), undefined, text);
  }
  assert.deepEqual(parseStrictJson('{"a":[1,-2,"9007199254740993"],"b":"\\"1.5\\""}'), { a: [1, -2, '9007199254740993'], b: '"1.5"' });
});

test('in-memory values that cannot round-trip as JSON are rejected', () => {
  const values = [{ v: NaN }, { v: 1.5 }, { v: 2 ** 60 }, { v: undefined }, { v: 1n }, { v: new Date() }, { v: [, 1] }];
  const cycle = {}; cycle.self = cycle; values.push(cycle);
  for (const v of values) {
    const t = trace('A', FINAL_A);
    t.events[0].result = v;
    assert.throws(() => validateTrace(t, registry().scenarios[0], registry()));
  }
});

test('registry validation rejects empty, duplicate and malformed scenarios', () => {
  const bad = [
    r => { r.scenarios = []; },
    r => { r.scenarios[1].id = 'A'; },
    r => { r.scenarios[0].input_sha256 = 'abc'; },
    r => { r.scenarios[0].expected.terminal.reason = 'nope'; },
    r => { r.scenarios[0].synthetic = 'yes'; },
    r => { delete r.scenarios[0].expected.final_state_sha256; },
  ];
  for (const mutate of bad) { const r = registry(); mutate(r); assert.throws(() => validateRegistry(r), undefined, mutate.toString()); }
});

test('the CLI exits 0, 1 and 2 for pass, fail and incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-schema-'));
  const write = (name, value) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  const reg = write('registry.json', registry());
  const base = write('base.json', full());
  const failing = full(); failing.traces[0].events[3].reason = 'updated';
  const cases = [[base, 0], [write('fail.json', failing), 1], [write('inc.json', run([trace('A', FINAL_A)])), 2]];
  for (const [candidate, code] of cases) {
    const out = join(dir, `out-${code}.json`);
    assert.equal(main(['--registry', reg, '--baseline', base, '--candidate', candidate, '--out', out]), code);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).status, ['pass', 'fail', 'incomplete'][code]);
  }
});

test('a pair whose candidate was interrupted is incomplete, not an event difference', () => {
  const candidate = full();
  const t = candidate.traces[0];
  t.events = [t.events[0]];
  t.stop = { reason: 'timeout' };
  const result = compareRuns(registry(), full(), candidate);
  assert.equal(result.status, 'incomplete');
  assert.ok(!result.differences.some(d => d.reason === 'event-differs'));
});
