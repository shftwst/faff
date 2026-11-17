import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { gradeGraftCheckpoints } from '../../../eval/control-parity/graft-checkpoint-execution.mjs';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { auditMcpDirectory } from '../../../eval/control-parity/codex-mcp-native-audit.mjs';
import { verifyLedgerDetailReview } from '../../../eval/control-parity/ledger-execution-v2.mjs';
import { sha256, canonicalHash } from '../../../eval/control-parity/schema.mjs';

const EVIDENCE = new URL('./', import.meta.url);
const ROOT = resolve(fileURLToPath(EVIDENCE), '../../..');
const read = path => JSON.parse(readFileSync(path));
const files = ['task.json', 'manifest.json', 'capture.json', 'consumers.json', 'report.json', 'native-audit.json', 'worker-manifest.json', 'worker-final-state.json'];
const sameSet = (actual, expected) => isDeepStrictEqual([...actual].sort(), [...expected].sort());
const caseIds = ['dispatched-pass', 'gate-failure', 'gate-none', 'evidence-absence', 'evidence-refusal', 'evidence-tamper', 'mixed-ledger', 'incomplete-ledger'];
const ruleIds = ['dispatched-merge-owner', 'human-only-checklist', 'incomplete-gates', 'raw-pr-ready', 'retry-return', 'evidence-return-scope'];
const manualIds = ['gate-and-order', 'ac-and-methods', 'evidence-and-refusals', 'terminal-mapping', 'supported-claims', 'real-consumers', 'proof-limits'];

export async function verifyGraftCheckpointArm(planPath, manualPath) {
  const guards = new Map();
  const guard = path => { const key = path instanceof URL ? fileURLToPath(path) : resolve(path); const hash = sha256(readFileSync(key)); if (guards.has(key)) assert.equal(hash, guards.get(key)); else guards.set(key, hash); return hash; };
  guard(planPath); guard(manualPath); guard(new URL(import.meta.url));
  const planBytes = readFileSync(planPath), plan = JSON.parse(planBytes), manual = read(manualPath);
  const registrationPath = new URL('graft-checkpoints-mcp-v2-registration.json', EVIDENCE), registration = read(registrationPath);
  guard(registrationPath);
  const arm = plan.samples[0].arm;
  assert.ok(['baseline', 'candidate'].includes(arm));
  assert.equal(basename(planPath), 'graft-checkpoints-mcp-v2-' + arm + '-plan.json');
  assert.deepEqual(registration.plans.map(row => row.path).sort(), ['graft-checkpoints-mcp-v2-baseline-plan.json', 'graft-checkpoints-mcp-v2-candidate-plan.json']);
  for (const row of registration.plans) assert.equal(guard(new URL(row.path, EVIDENCE)), row.sha256);
  assert.equal(sha256(planBytes), registration.plans.find(row => row.path === basename(planPath)).sha256);
  assert.equal(plan.model, 'gpt-6.1-sol'); assert.equal(plan.effort, 'medium');
  assert.equal(plan.runner, 'run-mcp-workflow-samples-v5.py');
  const fixturePath = new URL(plan.fixture, EVIDENCE), fixture = read(fixturePath);
  assert.equal(plan.fixture, 'workflow-fixtures/graft-checkpoints-v1-draft.json');
  assert.ok(sameSet([...fixture.cases.map(row => row.id), ...fixture.reconciliation.case_ids], caseIds));
  assert.ok(sameSet(fixture.rule_cases.map(row => row.id), ruleIds));
  assert.ok(sameSet(plan.manual_criteria.map(row => row.id), manualIds));
  assert.equal(plan.harness, 'eval/control-parity/graft-checkpoint-execution.mjs');
  assert.equal(plan.sample_execution_policy, 'parallel-complete-original-phase');
  assert.equal(plan.samples.length, 5);
  assert.equal(new Set(plan.samples.map(row => row.name)).size, 5);
  assert.equal(new Set(plan.samples.map(row => row.arm)).size, 1);
  assert.deepEqual(plan.samples.map(row => row.name), Array.from({ length: 5 }, (_, index) => `graft-checkpoints-mcp-v2-${arm}-${index + 1}`));
  assert.equal(manual.plan_sha256, sha256(planBytes));
  assert.equal(manual.status, 'pass');
  assert.ok(typeof manual.reviewer === 'string' && manual.reviewer.trim());
  assert.ok(sameSet(manual.samples.map(row => row.name), plan.samples.map(row => row.name)));
  const required = [plan.harness, ...['ledger-execution.mjs', 'ledger-execution-v2.mjs', 'reporting-execution.mjs', 'candidate-command.mjs', 'schema.mjs', 'policy-reader.mjs', 'interactive-handoff.mjs', 'mailbox-mcp.mjs', 'codex-mcp-native-audit.mjs', 'codex-native-audit.mjs', 'codex-mcp-startup-context.json', 'codex-mcp-tool-declaration.json'].map(name => 'eval/control-parity/' + name), fixture.reconciliation.fixture, fixture.reconciliation.dependencies].map(path => join(ROOT, path));
  required.push(...plan.context_files, fileURLToPath(fixturePath), fileURLToPath(new URL(plan.runner, EVIDENCE)), fileURLToPath(new URL(import.meta.url)));
  for (const path of required) assert.ok(Object.hasOwn(plan.frozen_hashes, path), 'missing frozen input: ' + path);
  for (const [path, expected] of Object.entries(plan.frozen_hashes)) assert.equal(guard(path), expected, path);
  const binding = bindCandidateCommand(plan.runtime_root, plan.runtime_commit), sessions = new Set(), results = [];
  for (const sample of plan.samples) {
    const directory = new URL('workflow-runs/' + sample.name + '/', EVIDENCE);
    assert.equal(sample.arm, arm);
    assert.equal(sample.policy, (arm === 'baseline' ? 'baseline/' : 'candidates/') + 'graft-gates-evidence-v2-with-context-draft.md');
    const policyPath = new URL(sample.policy, EVIDENCE);
    assert.ok(Object.hasOwn(plan.frozen_hashes, fileURLToPath(policyPath)));
    for (const name of readdirSync(directory, { recursive: true })) if (/\.(json|jsonl|txt)$/.test(name)) guard(new URL(name, directory));
    const bytes = Object.fromEntries(files.map(name => [name, readFileSync(new URL(name, directory))]));
    const data = Object.fromEntries(files.map(name => [name, JSON.parse(bytes[name])]));
    const report = data['report.json'], capture = data['capture.json'], consumers = data['consumers.json'];
    const grade = gradeGraftCheckpoints(capture, consumers, fixture);
    assert.ok(sameSet(grade.cases.map(row => row.id), [...caseIds, ...ruleIds]));
    assert.equal(grade.status, 'pass', sample.name);
    assert.deepEqual(grade, report.grade, 'fresh grade differs: ' + sample.name);
    assert.equal(report.status, 'pass');
    const manifest = data['manifest.json'], worker = data['worker-manifest.json'], state = data['worker-final-state.json'];
    assert.equal(canonicalHash(manifest.binding), canonicalHash(binding));
    assert.equal(manifest.fixture_sha256, sha256(readFileSync(fixturePath)));
    assert.equal(manifest.policy_sha256, sha256(readFileSync(new URL(sample.policy, EVIDENCE))));
    assert.equal(manifest.task_sha256, sha256(bytes['task.json']));
    assert.equal(manifest.harness_sha256, guard(join(ROOT, plan.harness)));
    assert.equal(worker.runner_sha256, guard(new URL(plan.runner, EVIDENCE)));
    assert.equal(worker.arm, arm);
    assert.equal(worker.harness_command[0], process.execPath);
    assert.deepEqual(worker.harness_command.slice(1), [join(ROOT, plan.harness), plan.runtime_root, plan.runtime_commit, fileURLToPath(policyPath), fileURLToPath(fixturePath), fileURLToPath(directory).replace(/\/$/, '')]);
    assert.equal(worker.plan_sha256, sha256(planBytes));
    assert.equal(worker.requested_model, plan.model);
    assert.equal(worker.effort, plan.effort);
    assert.equal(state.exit_code, 0);
    assert.equal(state.thread_ids.length, 1);
    assert.ok(!sessions.has(state.thread_ids[0]), 'reused session');
    sessions.add(state.thread_ids[0]);
    const audit = data['native-audit.json'];
    assert.equal(audit.runs.length, 1);
    assert.equal(audit.runs[0].status, 'pass');
    assert.equal(audit.runs[0].session_id, state.thread_ids[0]);
    assert.equal(audit.auditor_sha256, guard(join(ROOT, 'eval/control-parity/codex-mcp-native-audit.mjs')));
    assert.ok(sameSet(Object.keys(audit.evidence_hashes), ['task.json', 'startup-binding.json', 'worker-manifest.json', 'worker-final-state.json', 'mcp-server-manifest.json', 'mcp-trace.jsonl', 'mcp-protocol-errors.jsonl', 'capture.json', 'report.json']));
    for (const [name, hash] of Object.entries(audit.evidence_hashes)) assert.equal(guard(new URL(name, directory)), hash);
    const sessionsRoot = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
    const matches = readdirSync(sessionsRoot, { recursive: true }).filter(path => path.endsWith(`-${state.thread_ids[0]}.jsonl`));
    assert.equal(matches.length, 1);
    const nativePath = join(sessionsRoot, matches[0]);
    assert.equal(guard(nativePath), audit.source_sha256);
    assert.deepEqual(await auditMcpDirectory(nativePath, fileURLToPath(directory), fileURLToPath(policyPath)), audit);
    const review = manual.samples.find(row => row.name === sample.name);
    assert.equal(review.status, 'pass');
    assert.deepEqual(review.evidence_sha256, Object.fromEntries(files.map(name => [name, sha256(bytes[name])])));
    assert.ok(sameSet(review.cases.map(row => row.id), grade.cases.map(row => row.id)));
    for (const item of review.cases) {
      assert.equal(item.pass, true, sample.name + ':' + item.id);
      assert.equal(item.unsupported_claims, false);
      assert.ok(typeof item.rationale === 'string' && item.rationale.trim().length >= 20);
      assert.ok(Array.isArray(item.source_pointers) && item.source_pointers.length);
      assert.ok(item.source_pointers.every(value => typeof value === 'string' && value.trim()));
    }
    assert.ok(sameSet(review.criteria.map(row => row.id), plan.manual_criteria.map(row => row.id)));
    for (const criterion of review.criteria) {
      assert.equal(criterion.pass, true);
      assert.ok(typeof criterion.rationale === 'string' && criterion.rationale.trim().length >= 20);
    }
    if (fixture.reconciliation) {
      const ledgerFixture = read(new URL('../../../' + fixture.reconciliation.fixture, EVIDENCE));
      ledgerFixture.cases = ledgerFixture.cases.filter(row => fixture.reconciliation.case_ids.includes(row.id));
      ledgerFixture.rule_cases = [];
      verifyLedgerDetailReview(grade.reconciliation, review.ledger_detail_reviews, ledgerFixture);
    }
    results.push({ name: sample.name, status: 'pass', session: state.thread_ids[0], cases: grade.cases.length, evidence_sha256: review.evidence_sha256 });
  }
  for (const [path, hash] of guards) assert.equal(sha256(readFileSync(path)), hash, 'changed during check: ' + path);
  assertCandidateCommandUnchanged(binding);
  return { schema: 1, status: 'pass', plan_sha256: sha256(planBytes), manual_sha256: sha256(readFileSync(manualPath)), checker_sha256: sha256(readFileSync(new URL(import.meta.url))), samples: results, limits: plan.limits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [plan, manual, output] = process.argv.slice(2);
  assert.ok(plan && manual && output, 'usage: PLAN MANUAL NEW_OUTPUT');
  const result = await verifyGraftCheckpointArm(plan, manual);
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, samples: result.samples.length, cases: result.samples.reduce((n, row) => n + row.cases, 0) }));
}
