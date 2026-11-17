import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createLedgerEnvironment } from '../eval/control-parity/ledger-execution.mjs';
import { gradeLedgerExecution, verifyLedgerDetailReview } from '../eval/control-parity/ledger-execution-v2.mjs';

const evidence = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet');
const fixture = JSON.parse(readFileSync(join(evidence, 'workflow-fixtures/beep-ledger-v3.json')));
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
      await env.call('write_ledger', { case_id: row.id, patch: { ...row.oracle.patch, outcome_details: { 'SKIP-1': { ...row.oracle.patch.outcome_details['SKIP-1'], review_verdict: row.source.build_observations[0].review_verdict }, 'SUPER-1': { superseded_by: ['PRIOR-7'] } } } });
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

});
after(() => { if (root) rmSync(root, { recursive: true, force: true }); });
const mutate = fn => { const value = structuredClone(capture); fn(value); for (const row of value.cases) { row.ledger_bytes = JSON.stringify(row.ledger); row.consumer.event_read.stdout = JSON.stringify(row.events); } return gradeLedgerExecution(value, expected, fixture); };
const caseRow = (value, id = 'mixed-ledger') => value.cases.find(row => row.id === id);

function groundedReviews(value = grade) {
  return value.detail_reviews.map(row => ({
    case_id: row.case_id, details_sha256: row.details_sha256, source_sha256: row.source_sha256, pass: true,
    claims: row.extra_claims.map(claim => ({ ...claim, pass: true,
      source_pointers: [claim.path.startsWith('/SKIP-1/') ? '/build_observations/0/review_verdict' : '/build_observations/7/observation'],
      rationale: claim.path.startsWith('/SKIP-1/') ? 'Copies the supplied review verdict for this issue.' : 'The supplied observation names PRIOR-7 as already merging all deliverables.',
    })),
  }));
}

test('real consumers accept source-grounded details while retaining the legacy failures', () => {
  assert.equal(grade.status, 'pass');
  assert.equal(grade.manual_grounding_required, true);
  assert.equal(grade.legacy_exact_projection.status, 'fail');
  assert.equal(grade.legacy_exact_projection.cases.filter(row => !row.pass).length, 2);
  for (const row of grade.legacy_exact_projection.cases.filter(row => !row.pass)) assert.deepEqual(row.problems, ['ledger-producer-fields']);
  assert.equal(verifyLedgerDetailReview(grade, groundedReviews(), fixture).status, 'pass');
  assert.equal(caseRow(capture, 'incomplete-ledger').consumer.runcheck.exit_code, 3);
  assert.equal(caseRow(capture, 'incomplete-ledger').consumer.summary, null);
});

for (const [name, edit, problem] of [
  ['removed supplied detail map', row => { delete row.ledger.outcome_details; }, 'required-source-details'],
  ['removed supplied tests', row => { delete row.ledger.outcome_details['SKIP-1'].tests; }, 'required-source-details'],
  ['changed supplied head', row => { row.ledger.outcome_details['SKIP-1'].merged_head = 'invented'; }, 'required-source-details'],
  ['extra unsupplied test in required array', row => { row.ledger.outcome_details['SKIP-1'].tests.push('npm run e2e'); }, 'required-source-details'],
  ['array detail map', row => { row.ledger.outcome_details = []; }, 'detail-map-shape'],
  ['null issue entry', row => { row.ledger.outcome_details['SUPER-1'] = null; }, 'detail-map-shape'],
  ['unknown issue', row => { row.ledger.outcome_details['FAKE-99'] = {}; }, 'detail-issue-scope'],
  ['prep issue', row => { row.ledger.outcome_details['PREP-OUT'] = {}; }, 'detail-issue-scope'],
  ['changed terminal outcome', row => { row.ledger.outcomes['SKIP-1'] = 'parked'; }, 'ledger-producer-fields'],
  ['changed command authority', row => { row.ledger.level = 'L0'; }, 'command-owned-state'],
  ['changed ledger bytes', row => { row.before_bytes = '{}'; }, 'ledger-byte-snapshot'],
]) test('reject ' + name, () => {
  const result = mutate(value => edit(caseRow(value)));
  assert.equal(result.status, 'fail');
  assert.ok(result.cases[0].problems.includes(problem));
});

test('extra empty containers and arbitrary field names are visible to manual review', () => {
  const result = mutate(value => { caseRow(value).ledger.outcome_details['SUPER-1']['extra~/'] = { object: {}, array: [] }; });
  assert.equal(result.status, 'pass');
  const claims = result.detail_reviews[0].extra_claims;
  assert.ok(claims.some(row => row.path === '/SUPER-1/extra~0~1/object' && Object.keys(row.value).length === 0));
  assert.ok(claims.some(row => row.path === '/SUPER-1/extra~0~1/array' && Array.isArray(row.value)));
  assert.throws(() => verifyLedgerDetailReview(result, groundedReviews(), fixture));
});

test('a structurally valid fabricated claim cannot pass a rejecting manual judgement', () => {
  const result = mutate(value => { caseRow(value).ledger.outcome_details['SUPER-1'].tests_passed = ['npm test']; });
  assert.equal(result.status, 'pass');
  assert.equal(result.manual_grounding_required, true);
  const reviews = groundedReviews(result);
  const claim = reviews[0].claims.find(row => row.path === '/SUPER-1/tests_passed');
  claim.pass = false;
  claim.rationale = 'No supplied observation says this issue ran or passed a test.';
  assert.throws(() => verifyLedgerDetailReview(result, reviews, fixture));
});

for (const [name, edit] of [
  ['missing case', rows => rows.pop()],
  ['duplicate case', rows => rows.push(structuredClone(rows[0]))],
  ['missing claim', rows => rows[0].claims.pop()],
  ['duplicate claim', rows => rows[0].claims.push(structuredClone(rows[0].claims[0]))],
  ['changed detail hash', rows => { rows[0].details_sha256 = 'changed'; }],
  ['changed source hash', rows => { rows[0].source_sha256 = 'changed'; }],
  ['changed value hash', rows => { rows[0].claims[0].value_sha256 = 'changed'; }],
  ['changed displayed value', rows => { rows[0].claims[0].value = 'changed'; }],
  ['absent citation', rows => { rows[0].claims[0].source_pointers = []; }],
  ['nonexistent citation', rows => { rows[0].claims[0].source_pointers = ['/invented']; }],
  ['absent rationale', rows => { rows[0].claims[0].rationale = ''; }],
]) test('manual grounding gate rejects ' + name, () => {
  const reviews = groundedReviews(); edit(reviews);
  assert.throws(() => verifyLedgerDetailReview(grade, reviews, fixture));
});
