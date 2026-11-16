import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalFacts, matchesEconomics, createReportingEnvironment, gradeReportingExecution } from '../eval/control-parity/reporting-execution.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixture = JSON.parse(readFileSync(join(root, 'verification/experiments/2026-11-16-skill-diet/workflow-fixtures/beep-reporting-v1.json'), 'utf8'));

test('reporting boundary executes real persistence and rejects altered authority, publication and continuation', async t => {
  const directory = mkdtempSync('/var/tmp/faff-reporting-test-'), cli = join(root, 'plugin/skills/faff/bin/faff');
  try {
    const env = createReportingEnvironment({ root: directory, runtimeRoot: root, cli, fixture });
    for (const row of env.expected) {
      const call = (name, args) => env.call(name, { case_id: row.id, ...args });
      if (row.action === 'continue') {
        await call('continue_build', { issue_ids: fixture.cases.find(value => value.id === row.id).queue });
        continue;
      }
      await call('write_facts', { value: canonicalFacts(row.facts) });
      const result = await call('run_faff', { executable: cli, args: row.args });
      if (row.action === 'fault') {
        assert.equal(result.exit_code, 2);
        await call('report_failure', { reason: 'The run ledger is unreadable.' });
        continue;
      }
      assert.equal(result.exit_code, 0, result.stderr);
      assert.equal(result.stdout, result.persisted);
      for (const channel of ['tracker', 'conversation']) {
        const text = result.stdout.trimEnd() + (channel === 'tracker' ? '\n\n' + row.economics : '');
        const normalised = await call('normalise_output', { channel, text });
        await call('publish', { channel, target: channel === 'tracker' ? row.target : 'conversation', normalised_id: normalised.id });
      }
    }
    await env.call('finish', {});
    const original = env.capture(), score = capture => gradeReportingExecution(capture, env.expected, fixture);
    assert.equal(score(original).status, 'pass', JSON.stringify(score(original)));
    const mutations = {
      'changed ledger state': c => { c.cases[0].after.injected = 'changed'; },
      'fabricated facts economics': c => { c.cases[0].facts.economics = { tokens_total: 1 }; },
      'dropped follow-up': c => { c.cases[0].facts.run.follow_ups = []; },
      'rewritten persisted summary': c => { c.cases[0].summary += 'Invented content'; },
      'duplicate summary invocation': c => { c.events.push(structuredClone(c.events.find(e => e.name === 'run_faff'))); },
      'wrong target': c => { c.events.find(e => e.name === 'publish').result.target = 'project:wrong'; },
      'lost economics': c => { const e = c.events.find(e => e.name === 'publish'); e.result.text = e.result.text.replace(/Economics:.*$/, ''); },
      'lost health banner': c => { const e = c.events.find(e => e.name === 'publish' && e.case_id === 'dirty-install'); e.result.text = e.result.text.split('\n').slice(1).join('\n'); },
      'publish without normalisation': c => { c.events = c.events.filter(e => e.name !== 'normalise_output'); },
      'capacity deferral': c => { c.events.find(e => e.name === 'continue_build').name = 'publish'; },
      'omitted ready issue': c => { c.events.find(e => e.name === 'continue_build').args.issue_ids = []; },
      'publication after ledger fault': c => { const e = structuredClone(c.events.find(e => e.name === 'publish')); e.case_id = 'unreadable-ledger'; e.args.case_id = e.case_id; c.events.push(e); },
      'failed command missing result': c => { const e = c.events.find(e => e.name === 'run_faff'); delete e.result; e.error = 'command rejected'; },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, () => {
      const changed = structuredClone(original); mutate(changed);
      assert.equal(score(changed).status, 'fail');
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('optional empty facts do not hide unknown or command-owned data', () => {
  assert.deepEqual(canonicalFacts({ format: 2, tracker: { titles: {}, sibling_end_states: {}, superseded_delivered: {} }, run: { park_records: [], follow_ups: [] } }), { format: 2 });
  assert.deepEqual(canonicalFacts({ format: 2, tracker: { titles: { X: 'Known' } }, run: { unknown: {}, waves: 0 }, outcomes: {} }),
    { format: 2, tracker: { titles: { X: 'Known' } }, run: { unknown: {}, waves: 0 }, outcomes: {} });
});

test('economics accepts equivalent numbers and preserves cost, token provenance and denominators', () => {
  const money = fixture.cases[0].dependencies.economics;
  for (const value of ['Economics: 1,200 tokens (estimate), $3 · 5 shipped · $0.60 per shipped',
    'Economics: 1.2K tokens (estimate), $3.00 · 5 shipped · 240 tokens / $0.6 each']) assert.ok(matchesEconomics(value, money, 5));
  for (const value of ['Economics: 1200 tokens (estimate) · 5 shipped · $0.60',
    'Economics: 1200 tokens (transcript), $3 · 5 shipped · $0.60',
    'Economics: 1200 tokens (estimate), $3 · 4 shipped · $0.60',
    'Economics: 1200 tokens (estimate), $3 · 5 shipped · $0.61',
    'Economics: 1200 tokens (estimate), $3 · 5 shipped · 240 tokens',
    'Economics: 1200 tokens (estimate), $3 · 5 shipped · ZERO-SHIP']) assert.equal(matchesEconomics(value, money, 5), false);
  const zero = fixture.cases[2].dependencies.economics;
  assert.ok(matchesEconomics('Economics: 1200 tokens (transcript) · 0 shipped · ZERO-SHIP', zero, 0));
  assert.equal(matchesEconomics('Economics: 1200 tokens (transcript), $0 · 0 shipped · ZERO-SHIP', zero, 0), false);
  const free = { ...money, cost_total: 0, cost_per_shipped: { tokens_each: 240, cost_each: 0 } };
  assert.ok(matchesEconomics('Economics: 1200 tokens (estimate), $0 · 5 shipped · 240 tokens / $0 each', free, 5));
  assert.equal(matchesEconomics('Economics: 1200 tokens (estimate) · 5 shipped · 240 tokens', free, 5), false);
});
