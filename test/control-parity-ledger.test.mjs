import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createLedgerEnvironment, gradeLedgerExecution, validEventInvocation, summaryBodyWithVerifiedClock } from '../eval/control-parity/ledger-execution.mjs';

const evidence = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet');
const fixture = JSON.parse(readFileSync(join(evidence, 'workflow-fixtures/beep-ledger-v2-draft.json')));
const summaryDependencies = JSON.parse(readFileSync(join(evidence, 'workflow-fixtures/beep-ledger-summary-dependencies-v2.json')));
const runtimeRoot = process.env.LEDGER_PREFLIGHT_RUNTIME || resolve(import.meta.dirname, '..');
const cli = join(runtimeRoot, 'plugin/skills/faff/bin/faff');
let root, env, capture, expected, grade;

before(async () => {
  root = mkdtempSync('/var/tmp/faff-ledger-preflight-');
  env = createLedgerEnvironment({ root, runtimeRoot, cli, fixture, summaryDependencies });
  for (const row of fixture.cases) {
    const state = env.publicCases.find(item => item.id === row.id);
    await env.call('read_ledger', { case_id: row.id });
    const emit = (id, payload, tokens) => env.call('append_event', { case_id: row.id, transition_id: id, executable: cli, args: ['events', 'append', '--run', state.run_id, '--root', state.root, ...(tokens ? ['--tokens', '--session-id', state.session_id] : [])], payload });
    if (row.kind === 'ledger') {
      await env.call('write_ledger', { case_id: row.id, patch: row.oracle.patch });
      await emit('ledger-edit', { phase: 'run', type: 'ledger-write' }, false);
    } else {
      for (const transition of row.oracle.transitions) {
        if (transition.expected) await emit(transition.id, transition.expected, transition.tokens);
        else await env.call('skip_transition', { case_id: row.id, transition_id: transition.id, reason: 'No meaningful workflow transition.' });
      }
    }
  }
  for (const row of fixture.rule_cases) await env.call('answer_rule', { id: row.id, value: row.expected });
  await env.call('finish', {});
  capture = env.capture(); expected = env.expected; grade = gradeLedgerExecution(capture, expected, fixture);
  if (process.env.LEDGER_PREFLIGHT_OUTPUT) {
    mkdirSync(process.env.LEDGER_PREFLIGHT_OUTPUT);
    for (const [name, value] of Object.entries({ capture, expected, report: grade, public_cases: env.publicCases })) writeFileSync(join(process.env.LEDGER_PREFLIGHT_OUTPUT, name + '.json'), JSON.stringify(value, null, 2) + '\n');
  }
});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });
const mutate = fn => { const value = structuredClone(capture); fn(value); for (const row of value.cases) { row.ledger_bytes = JSON.stringify(row.ledger); row.consumer.event_read.stdout = JSON.stringify(row.events); } return gradeLedgerExecution(value, expected, fixture); };
const caseRow = (value, id = 'mixed-ledger') => value.cases.find(row => row.id === id);
const transition = (value, id) => value.events.find(row => row.args?.transition_id === id);
const alterPersisted = (value, type, fn) => {
  const event = caseRow(value, 'phase-events').events.find(row => row.type === type);
  fn(event);
  for (const call of value.events) if (call.result?.appended) call.result.appended = call.result.appended.map(row => row.seq === event.seq ? structuredClone(event) : row);
};

test('real ledger/event producer fixture and all decisions pass', () => {
  assert.deepEqual(grade.cases.filter(row => !row.pass), []);
  assert.equal(grade.status, 'pass');
  assert.equal(grade.cases.length, fixture.cases.length + fixture.rule_cases.length);
});
test('public task cases do not expose oracle or fixture-private fields', () => {
  assert.equal(env.publicCases.length, 3);
  for (const row of env.publicCases) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'kind', 'task', 'source', 'root', 'run_id', 'run_dir', 'session_id'].sort());
    assert.doesNotMatch(JSON.stringify(row), /"(?:oracle|expected|unordered_unique_fields|known_existing_mismatches|required_before_freeze)"/);
  }
});
for (const key of ['level', 'owner', 'budget', 'schema_version']) test('reject changed command-owned ' + key, () => {
  const result = mutate(value => { caseRow(value).ledger[key] = 'changed'; });
  assert.equal(result.status, 'fail');
  assert.ok(result.cases[0].problems.includes('command-owned-state'));
});
for (const [name, fn] of [
  ['missing ledger-write', value => { value.events = value.events.filter(row => !(row.case_id === 'mixed-ledger' && row.name === 'append_event')); }],
  ['ledger-write before edit', value => { value.events.find(row => row.case_id === 'mixed-ledger' && row.name === 'append_event').seq = 0; }],
  ['caller-supplied ledger hash', value => { value.events.find(row => row.case_id === 'mixed-ledger' && row.name === 'append_event').args.payload.data = { ledger_sha256: 'forged' }; }],
  ['object outcome', value => { caseRow(value).ledger.outcomes['SKIP-1'] = { state: 'shipped' }; }],
  ['unknown outcome', value => { caseRow(value).ledger.outcomes['SKIP-1'] = 'done'; }],
  ['invented incomplete outcome', value => { caseRow(value, 'incomplete-ledger').ledger.outcomes['OPEN-1'] = 'parked'; }],
  ['removed incomplete admission', value => { caseRow(value, 'incomplete-ledger').ledger.admitted = caseRow(value, 'incomplete-ledger').ledger.admitted.filter(id => id !== 'OPEN-1'); }],
  ['admitted prep hold', value => { caseRow(value).ledger.admitted.push('PREP-OUT'); }],
  ['swapped prep distinction', value => { caseRow(value).ledger.spec_review_outage_pending = ['PREP-SLOW']; }],
  ['human landing made resumable', value => { caseRow(value).ledger.landing_resumable.push('HUMAN-1'); }],
  ['changed post-merge details', value => { caseRow(value).ledger.post_merge_verification_failures[0].command = 'true'; }],
  ['wrong filing count', value => { caseRow(value).ledger.discovered_scope_filed++; }],
  ['duplicate admission', value => { caseRow(value).ledger.admitted.push('SKIP-1'); }],
  ['missing event', value => { value.events = value.events.filter(row => row.args?.transition_id !== 'tidy'); }],
  ['duplicate event', value => { value.events.splice(5, 0, structuredClone(transition(value, 'tidy'))); }],
  ['micro-action event', value => { transition(value, 'micro').name = 'append_event'; }],
  ['extra genesis', value => { caseRow(value, 'phase-events').events.push(structuredClone(caseRow(value, 'phase-events').events[0])); }],
  ['wrong event phase', value => { transition(value, 'tidy').args.payload.phase = 'build'; }],
  ['missing closing tokens flag', value => { transition(value, 'tidy').args.args = transition(value, 'tidy').args.args.filter(item => item !== '--tokens'); }],
  ['opening tokens flag', value => { transition(value, 'prep-start').args.args.push('--tokens'); }],
  ['missing gate metadata', value => { delete transition(value, 'build-return').args.payload.data.gate; }],
  ['gate on clean ship', value => { transition(value, 'clean-return').args.payload.data.gate = 'ci'; }],
  ['changed supplied budget', value => { transition(value, 'budget').args.payload.data.spent.attempts++; }],
  ['unknown caller field even when output is unchanged', value => { transition(value, 'sentry').args.payload.data.unknown = 'dropped-by-cli'; }],
  ['frozen token delta', value => { const first = caseRow(value, 'phase-events').events.find(row => row.type === 'tidy-done').data.tokens; alterPersisted(value, 'prep-done', event => { event.data.tokens = structuredClone(first); }); }],
  ['missing transcript misreported as metered zero', value => { alterPersisted(value, 'park', event => { event.data.tokens_source = 'transcript'; event.data.tokens = { input: 0, output: 0, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0 }; }); }],
  ['missing case', value => { value.cases.pop(); }],
  ['missing decision', value => { value.decisions.pop(); }],
  ['unknown operation', value => { value.events.splice(-1, 0, { name: 'unregistered' }); }],
  ['early finish', value => { value.events.unshift(value.events.pop()); }],
]) test('reject ' + name, () => {
  const result = mutate(fn);
  assert.equal(result.status, 'fail');
  const ledgerNames = ['object outcome', 'unknown outcome', 'invented incomplete outcome', 'removed incomplete admission', 'admitted prep hold', 'swapped prep distinction', 'human landing made resumable', 'changed post-merge details', 'wrong filing count', 'duplicate admission'];
  if (ledgerNames.includes(name)) assert.ok(result.cases.some(row => row.problems?.includes('ledger-producer-fields')), name);
  if (['frozen token delta', 'missing transcript misreported as metered zero'].includes(name)) assert.ok(result.cases.some(row => row.problems?.includes('persisted-event-data')), name);
});
test('reordered unique ledger collections remain equivalent', () => {
  const result = mutate(value => { for (const row of value.cases.filter(row => row.id !== 'phase-events')) { row.ledger.admitted.reverse(); row.ledger_bytes = JSON.stringify(row.ledger); } value.decisions.find(row => row.id === 'event-ownership').value.caller_fields.reverse(); });
  assert.equal(result.status, 'pass');
});
test('reordered outcome keys pass through the actual producer and summary consumer', async () => {
  const directory = mkdtempSync('/var/tmp/faff-ledger-key-order-');
  try {
    const subset = { ...fixture, cases: [fixture.cases[0]], rule_cases: [] };
    const environment = createLedgerEnvironment({ root: directory, runtimeRoot, cli, fixture: subset, summaryDependencies });
    const state = environment.publicCases[0], patch = structuredClone(subset.cases[0].oracle.patch);
    patch.outcomes = Object.fromEntries(Object.entries(patch.outcomes).reverse());
    patch.admitted.reverse();
    await environment.call('read_ledger', { case_id: state.id });
    await environment.call('write_ledger', { case_id: state.id, patch });
    await environment.call('append_event', { case_id: state.id, transition_id: 'ledger-edit', executable: cli, args: ['events', 'append', '--root', state.root, '--run', state.run_id], payload: { phase: 'run', type: 'ledger-write' } });
    await environment.call('finish', {});
    const actual = environment.capture();
    assert.equal(gradeLedgerExecution(actual, environment.expected, subset).status, 'pass');
    assert.notEqual(actual.cases[0].consumer.summary.stdout, environment.expected[0].consumer.summary.stdout);
    const wrong = structuredClone(actual);
    wrong.cases[0].consumer.summary.stdout += '\n- Fabricated outcome\n';
    wrong.cases[0].consumer.summary.persisted = wrong.cases[0].consumer.summary.stdout;
    assert.equal(gradeLedgerExecution(wrong, environment.expected, subset).status, 'fail');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('real token accounting advances and retains missing-transcript estimate', () => {
  const events = caseRow(capture, 'phase-events').events;
  const tidy = events.find(row => row.type === 'tidy-done'), prep = events.find(row => row.type === 'prep-done'), park = events.find(row => row.type === 'park');
  assert.equal(tidy.data.tokens_source, 'transcript'); assert.equal(prep.data.tokens_source, 'transcript');
  assert.notDeepEqual(tidy.data.tokens, prep.data.tokens);
  assert.equal(park.data.tokens_source, 'estimate'); assert.equal(park.data.tokens, null);
});
test('real incomplete ledger consumer leaves only OPEN-1 undispatched', () => {
  const result = caseRow(capture, 'incomplete-ledger').consumer;
  assert.equal(result.runcheck.exit_code, 3); assert.deepEqual(JSON.parse(result.runcheck.stdout).undispatched, ['OPEN-1']);
  assert.equal(result.summary, null);
});
test('ports reject command-owned writes and wrong root/session', async () => {
  await assert.rejects(env.call('write_ledger', { case_id: 'mixed-ledger', patch: { owner: {} } }), /command-owned/);
  const state = env.publicCases.find(row => row.id === 'phase-events');
  await assert.rejects(env.call('append_event', { case_id: state.id, transition_id: 'tidy', executable: cli, args: ['events', 'append', '--run', state.run_id, '--root', '/wrong'], payload: { phase: 'tidy', type: 'tidy-done' } }), /outside isolated/);
});
test('event invocation allows flag order and refuses missing, duplicate or wrong binding', () => {
  const state = { root: '/fixture', runId: 'run-fixture', session: 'fixture-session' };
  assert.equal(validEventInvocation(['events', 'append', '--tokens', '--session-id', state.session, '--root', state.root, '--run', state.runId], state), true);
  assert.equal(validEventInvocation(['events', 'append', '--run', state.runId, '--root', state.root, '--session-id', state.session], state), true);
  for (const args of [
    ['--run', state.runId, '--root', state.root, '--tokens'],
    ['--run', state.runId, '--root', state.root, '--tokens', '--session-id', 'wrong'],
    ['--run', state.runId, '--root', state.root, '--root', state.root],
    ['--run', state.runId, '--root'],
    ['--run', state.runId, '--root', '/wrong'],
  ]) assert.equal(validEventInvocation(['events', 'append', ...args], state), false);
});
test('summary clock comparison accepts midnight rollover and rejects an invented date or duration', () => {
  const value = structuredClone(caseRow(capture)), body = summaryBodyWithVerifiedClock(value);
  value.ledger.owner.started_at = '2026-01-01T23:59:30.000Z';
  value.ledger.owner.last_heartbeat = '2026-01-02T00:00:00.000Z';
  value.heartbeat = '2026-01-02T00:01:05.000Z';
  value.events.at(-1).ts = '2026-01-02T00:00:50.000Z';
  value.consumer.summary.stdout = '# Beep-Boop Run \u2014 2026-01-01 23:59:30\nMode: explicit-list \u00b7 Duration: 0h 1m\n' + body;
  assert.equal(summaryBodyWithVerifiedClock(value), body);
  value.consumer.summary.stdout = value.consumer.summary.stdout.replace('0h 1m', '0h 2m');
  assert.throws(() => summaryBodyWithVerifiedClock(value));
  value.consumer.summary.stdout = value.consumer.summary.stdout.replace('0h 2m', '0h 1m').replace('23:59:30', '23:59:31');
  assert.throws(() => summaryBodyWithVerifiedClock(value));
});
