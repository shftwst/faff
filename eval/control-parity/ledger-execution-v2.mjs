import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import { createLedgerEnvironment, LEDGER_TOOLS, gradeLedgerExecution as exactProjectionGrade } from './ledger-execution.mjs';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = value => sha256(JSON.stringify(value));
const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');

function includesRequired(actual, required) {
  if (!object(required)) return equal(actual, required);
  return object(actual) && Object.entries(required).every(([key, value]) => Object.hasOwn(actual, key) && includesRequired(actual[key], value));
}

function extraClaims(actual, required, path = '') {
  if (equal(actual, required)) return [];
  if (!object(actual) || !Object.keys(actual).length) return required === undefined ? [{ path, value: actual, value_sha256: hash(actual) }] : [];
  return Object.entries(actual).flatMap(([key, value]) => extraClaims(value, object(required) && Object.hasOwn(required, key) ? required[key] : undefined, path + '/' + pointer(key)));
}

export function inspectLedgerDetails(actual, row) {
  const details = actual.ledger.outcome_details, required = row.source.issue_detail;
  const problems = [];
  if (!object(details) || Object.values(details).some(value => !object(value))) problems.push('detail-map-shape');
  if (!includesRequired(details, required)) problems.push('required-source-details');
  if (object(details) && Object.keys(details).some(id => !row.source.admitted_build_ids.includes(id))) problems.push('detail-issue-scope');
  return {
    case_id: row.id, problems,
    details_sha256: hash(details ?? null), source_sha256: hash(row.source),
    extra_claims: object(details) ? extraClaims(details, required) : [],
  };
}

export function gradeLedgerExecution(capture, expected, fixture) {
  const legacy = exactProjectionGrade(capture, expected, fixture);
  const workload = structuredClone(fixture), reviews = [];
  for (const row of workload.cases.filter(row => row.kind === 'ledger')) {
    const matches = capture.cases.filter(item => item.id === row.id);
    if (matches.length !== 1) continue;
    reviews.push(inspectLedgerDetails(matches[0], row));
    if (Object.hasOwn(matches[0].ledger, 'outcome_details')) row.oracle.patch.outcome_details = matches[0].ledger.outcome_details;
    else delete row.oracle.patch.outcome_details;
  }
  const grade = exactProjectionGrade(capture, expected, workload);
  for (const review of reviews) {
    const result = grade.cases.find(row => row.id === review.case_id);
    result.problems.push(...review.problems);
    result.pass = !result.problems.length;
  }
  grade.status = grade.errors.length || grade.problems.length || grade.cases.some(row => !row.pass) ? 'fail' : 'pass';
  return { ...grade, detail_reviews: reviews, manual_grounding_required: reviews.some(row => row.extra_claims.length), legacy_exact_projection: legacy };
}

export function verifyLedgerDetailReview(grade, reviews, fixture) {
  assert.equal(grade.status, 'pass');
  assert.deepEqual(reviews.map(row => row.case_id).sort(), grade.detail_reviews.map(row => row.case_id).sort());
  for (const detail of grade.detail_reviews) {
    const review = reviews.find(row => row.case_id === detail.case_id);
    assert.equal(review.details_sha256, detail.details_sha256);
    assert.equal(review.source_sha256, detail.source_sha256);
    assert.equal(review.pass, true);
    assert.deepEqual(review.claims.map(row => row.path).sort(), detail.extra_claims.map(row => row.path).sort());
    for (const claim of detail.extra_claims) {
      const finding = review.claims.find(row => row.path === claim.path);
      assert.deepEqual(finding.value, claim.value);
      assert.equal(finding.value_sha256, claim.value_sha256);
      assert.equal(finding.pass, true);
      assert.equal(typeof finding.rationale, 'string');
      assert.ok(finding.rationale.trim());
      assert.ok(Array.isArray(finding.source_pointers) && finding.source_pointers.length);
      for (const path of finding.source_pointers) {
        assert.equal(typeof path, 'string');
        assert.ok(path.startsWith('/'));
        let value = fixture.cases.find(row => row.id === detail.case_id).source;
        for (const key of path.slice(1).split('/').map(key => key.replaceAll('~1', '/').replaceAll('~0', '~'))) {
          assert.ok(value !== null && typeof value === 'object' && Object.hasOwn(value, key), 'source pointer must exist: ' + path);
          value = value[key];
        }
      }
    }
  }
  return { status: 'pass', cases: reviews.length, claims: reviews.reduce((sum, row) => sum + row.claims.length, 0), scope: 'Bound independent semantic judgements; citations alone do not prove their interpretation.' };
}

export async function runLedgerExecution({ root, commit, policyPath, fixturePath, dependencyPath, output }) {
  const binding = bindCandidateCommand(root, commit), policyBytes = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes), dependencyBytes = readFileSync(dependencyPath);
  mkdirSync(output);
  const work = mkdtempSync('/var/tmp/faff-ledger-measure-');
  try {
    const env = createLedgerEnvironment({ root: work, runtimeRoot: root, cli: join(root, binding.entry), fixture, summaryDependencies: JSON.parse(dependencyBytes) });
    const reader = createPolicyReader(policyBytes);
    const task = { instructions: 'Read the complete policy, then handle all independent producer checkpoints and questions. Read each existing ledger before work. Runs are already minted by the real CLI. Reconcile ledger observations and emit the required ledger mutation events. Handle event observations in supplied order, emitting or explicitly skipping each. Include all supplied gate/rework metadata as requested by this workload. Controlled transcripts advance between observations; their counts are measured by the CLI, never supplied by you. The harness runs real runcheck, event validation/read and a completed-ledger summary consumer after finish. No tracker, review, build, run-open/close, publication or lifecycle operations are requested. Finish after every case and question.', policy: reader.metadata, resolved_executable: join(root, binding.entry), tools: [POLICY_TOOL, ...LEDGER_TOOLS], cases: env.publicCases, questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
    write(join(output, 'task.json'), task);
    write(join(output, 'manifest.json'), { schema: 1, kind: 'ledger-event-producer-execution', binding, fixture_sha256: sha256(fixtureBytes), dependencies_sha256: sha256(dependencyBytes), policy_sha256: sha256(policyBytes), task_sha256: sha256(readFileSync(join(output, 'task.json'))), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
    write(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...LEDGER_TOOLS.map(row => row.name)]), maxRequests: 180, timeoutMs: 900000 });
    const capture = env.capture(), grade = gradeLedgerExecution(capture, env.expected, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture); write(join(output, 'expected.json'), env.expected);
    const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, dependencyPath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: ledger-execution-v2.mjs ROOT COMMIT POLICY FIXTURE DEPENDENCIES NEW_OUTPUT');
  const result = await runLedgerExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), dependencyPath: resolve(dependencyPath), output: resolve(output) });
  console.log(JSON.stringify({ status: result.status, cases: result.grade.cases }));
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
