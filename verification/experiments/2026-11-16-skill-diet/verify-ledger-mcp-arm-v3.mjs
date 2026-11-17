import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { auditMcpDirectory } from '../../../eval/control-parity/codex-mcp-native-audit.mjs';
import { gradeLedgerExecution, verifyLedgerDetailReview } from '../../../eval/control-parity/ledger-execution-v2.mjs';
import { assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
import { replayLedgerConsumers } from './replay-ledger-consumers-v1.mjs';

const evidence = import.meta.dirname, root = resolve(evidence, '../../..');
const json = path => JSON.parse(readFileSync(path));
const hash = path => sha256(readFileSync(path));
const valueHash = value => sha256(JSON.stringify(value));

export async function verifyLedgerArm(arm, manualPath) {
  assert.ok(['baseline', 'candidate'].includes(arm));
  const guards = new Map();
  const guard = path => { path = resolve(path); const digest = hash(path); if (guards.has(path)) assert.equal(digest, guards.get(path)); else guards.set(path, digest); return digest; };
  const registrationPath = join(evidence, 'beep-ledger-mcp-v3-registration.json'), registration = json(registrationPath);
  guard(registrationPath); guard(manualPath); guard(new URL(import.meta.url).pathname);
  assert.deepEqual(registration.plans.map(row => row.path).sort(), ['beep-ledger-mcp-v3-baseline-plan.json', 'beep-ledger-mcp-v3-candidate-plan.json']);
  for (const row of registration.plans) assert.match(row.sha256, /^[a-f0-9]{64}$/);
  for (const row of registration.plans) assert.equal(guard(join(evidence, row.path)), row.sha256);
  const planPath = join(evidence, `beep-ledger-mcp-v3-${arm}-plan.json`), plan = json(planPath);
  const planHash = guard(planPath);
  assert.equal(planHash, registration.plans.find(row => row.path === `beep-ledger-mcp-v3-${arm}-plan.json`).sha256);
  assert.equal(plan.runner, 'run-mcp-workflow-samples-v4.py');
  assert.equal(plan.harness, 'eval/control-parity/ledger-execution-v2.mjs');
  assert.equal(plan.fixture, 'workflow-fixtures/beep-ledger-v3.json');
  assert.equal(plan.dependency_fixture, 'workflow-fixtures/beep-ledger-summary-dependencies-v2.json');
  const requiredInputs = [
    ...['ledger-execution-v2.mjs', 'ledger-execution.mjs', 'reporting-execution.mjs', 'candidate-command.mjs', 'schema.mjs', 'policy-reader.mjs', 'interactive-handoff.mjs', 'mailbox-mcp.mjs', 'codex-mcp-native-audit.mjs', 'codex-native-audit.mjs', 'codex-mcp-startup-context.json', 'codex-mcp-tool-declaration.json'].map(name => join(root, 'eval/control-parity', name)),
    ...[plan.runner, 'replay-ledger-consumers-v1.mjs', 'verify-ledger-mcp-arm-v3.mjs', plan.fixture, plan.dependency_fixture, 'baseline/beep-ledger-v2.md', 'baseline/beep-ledger-v2-with-context.md', 'candidates/beep-ledger-v2.md', 'candidates/beep-ledger-v2-with-context.md'].map(name => join(evidence, name)),
    ...plan.context_files,
  ];
  for (const path of requiredInputs) assert.ok(Object.hasOwn(plan.frozen_hashes, path), 'missing mandatory frozen input: ' + path);
  for (const [path, digest] of Object.entries(plan.frozen_hashes)) assert.equal(guard(path), digest, path);
  assert.equal(plan.samples.length, 5);
  assert.deepEqual(plan.samples.map(row => row.name), Array.from({ length: 5 }, (_, index) => `beep-ledger-mcp-v3-${arm}-${index + 1}`));
  const fixturePath = join(evidence, plan.fixture), dependencyPath = join(evidence, plan.dependency_fixture), fixture = json(fixturePath);
  const manual = json(manualPath);
  assert.equal(manual.status, 'pass');
  assert.equal(manual.plan_sha256, planHash);
  assert.deepEqual(manual.samples.map(row => row.name).sort(), plan.samples.map(row => row.name).sort());
  const samples = [];
  for (const sample of plan.samples) {
    assert.equal(sample.arm, arm);
    assert.equal(sample.policy, (arm === 'baseline' ? 'baseline/' : 'candidates/') + 'beep-ledger-v2-with-context.md');
    const directory = join(evidence, 'workflow-runs', sample.name), policyPath = join(evidence, sample.policy);
    for (const file of readdirSync(directory, { recursive: true })) {
      if (file.endsWith('.json') || file.endsWith('.jsonl') || file.endsWith('.txt')) guard(join(directory, file));
    }
    const report = json(join(directory, 'report.json')), capture = json(join(directory, 'capture.json')), expected = json(join(directory, 'expected.json'));
    const audit = json(join(directory, 'native-audit.json')), state = json(join(directory, 'worker-final-state.json'));
    const manifest = json(join(directory, 'manifest.json')), worker = json(join(directory, 'worker-manifest.json')), replay = json(join(directory, 'workflow-replay.json'));
    assert.equal(state.exit_code, 0); assert.equal(report.status, 'pass');
    assert.equal(worker.plan_sha256, planHash); assert.equal(worker.runner_sha256, guard(join(evidence, plan.runner)));
    assert.equal(worker.arm, arm); assert.equal(worker.requested_model, plan.model); assert.equal(worker.effort, plan.effort);
    assert.equal(manifest.kind, 'ledger-event-producer-execution');
    assert.equal(manifest.binding.root, plan.runtime_root); assert.equal(manifest.binding.commit, plan.runtime_commit);
    assert.equal(manifest.policy_sha256, guard(policyPath)); assert.equal(manifest.fixture_sha256, guard(fixturePath));
    assert.equal(manifest.dependencies_sha256, guard(dependencyPath)); assert.equal(manifest.harness_sha256, guard(join(root, plan.harness)));
    assert.equal(manifest.task_sha256, guard(join(directory, 'task.json')));
    assertCandidateCommandUnchanged(manifest.binding);
    assert.equal(audit.runs.length, 1); assert.equal(audit.runs[0].status, 'pass');
    assert.deepEqual(audit.runs[0].model_ids, [plan.model]); assert.deepEqual(audit.runs[0].efforts, [plan.effort]);
    assert.deepEqual(audit.runs[0].versions, ['0.169.0']); assert.deepEqual(state.thread_ids, [audit.runs[0].session_id]);
    assert.equal(audit.auditor_sha256, guard(join(root, 'eval/control-parity/codex-mcp-native-audit.mjs')));
    assert.deepEqual(Object.keys(audit.evidence_hashes).sort(), ['task.json', 'startup-binding.json', 'worker-manifest.json', 'worker-final-state.json', 'mcp-server-manifest.json', 'mcp-trace.jsonl', 'mcp-protocol-errors.jsonl', 'capture.json', 'report.json'].sort());
    for (const [file, digest] of Object.entries(audit.evidence_hashes)) assert.equal(guard(join(directory, file)), digest);
    const sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
    const matches = readdirSync(sessions, { recursive: true }).filter(path => path.endsWith(`-${state.thread_ids[0]}.jsonl`));
    assert.equal(matches.length, 1);
    const nativePath = join(sessions, matches[0]);
    assert.equal(guard(nativePath), audit.source_sha256);
    assert.deepEqual(await auditMcpDirectory(nativePath, directory, policyPath), audit);
    const fresh = gradeLedgerExecution(capture, expected, fixture);
    assert.equal(fresh.status, 'pass'); assert.deepEqual(fresh, report.grade);
    assert.equal(replay.status, 'pass'); assert.equal(replay.recorded_grade_matches, true); assert.deepEqual(replay.grade, fresh);
    const review = manual.samples.find(row => row.name === sample.name);
    assert.equal(review.capture_sha256, guard(join(directory, 'capture.json')));
    assert.equal(review.report_sha256, guard(join(directory, 'report.json')));
    assert.equal(review.native_sha256, guard(join(directory, 'native-audit.json')));
    assert.deepEqual(review.case_reviews.map(row => row.id).sort(), fixture.cases.map(row => row.id).sort());
    for (const reviewed of review.case_reviews) {
      const actual = capture.cases.find(row => row.id === reviewed.id), source = fixture.cases.find(row => row.id === reviewed.id).source;
      assert.equal(reviewed.pass, true); assert.equal(reviewed.authority_preserved, true); assert.equal(reviewed.supplied_facts_preserved, true);
      assert.deepEqual(reviewed.unsupported_assertions, []);
      assert.equal(reviewed.source_sha256, valueHash(source)); assert.equal(reviewed.ledger_sha256, sha256(actual.ledger_bytes));
      assert.equal(reviewed.events_sha256, valueHash(actual.events)); assert.equal(reviewed.consumer_sha256, valueHash(actual.consumer));
    }
    assert.deepEqual(review.decision_reviews.map(row => row.id).sort(), fixture.rule_cases.map(row => row.id).sort());
    for (const decision of review.decision_reviews) {
      assert.equal(decision.pass, true);
      assert.equal(decision.value_sha256, valueHash(capture.decisions.find(row => row.id === decision.id).value));
    }
    const details = verifyLedgerDetailReview(fresh, review.detail_reviews, fixture);
    const consumer = replayLedgerConsumers({ directory, dependencyPath, fixturePath });
    assert.equal(consumer.status, 'pass');
    samples.push({ name: sample.name, execution_cases: 3, decisions: 11, native: 'pass', manual: 'pass', details, legacy_exact_projection: fresh.legacy_exact_projection, consumer_replay: consumer });
  }
  for (const [path, digest] of guards) assert.equal(hash(path), digest, 'changed during verification: ' + path);
  return { schema: 1, status: 'pass', arm, source_installed: false, registration_sha256: hash(registrationPath), verifier_sha256: hash(new URL(import.meta.url)), manual: { path: manualPath, sha256: hash(manualPath) }, samples, inputs: Object.fromEntries(guards), scope: 'Five fresh Astra V3 samples, original exact-projection diagnostics retained; exact native replay, unchanged frozen inputs, independent actual-output and optional-claim review, and restored real consumers. No held Sol cohort qualification, lifecycle or provider-wide equivalence claim.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [arm, manualPath, output] = process.argv.slice(2);
  const result = await verifyLedgerArm(arm, resolve(manualPath));
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, arm, samples: result.samples.length }));
}
