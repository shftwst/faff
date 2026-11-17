import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { auditMcpDirectory } from '../../../eval/control-parity/codex-mcp-native-audit.mjs';
import { gradeRenderingCapture } from '../../../eval/control-parity/rendering-artifact.mjs';
import { consumeArchitectureArtifact } from '../../../eval/control-parity/architecture-artifact.mjs';
import { assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';

const evidence = import.meta.dirname, root = resolve(evidence, '../../..');
const read = path => JSON.parse(readFileSync(path));
const hash = path => sha256(readFileSync(path));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const bind = row => assert.equal(hash(resolve(root, row.path)), row.sha256, row.path);

export async function verifyArchitectureArm(planPath, manualPath, output) {
  const plan = read(planPath), fixturePath = join(evidence, plan.fixture), fixture = read(fixturePath), manual = read(manualPath);
  const registrationPath = join(evidence, 'architecture-proposal-mcp-v1-registration.json'), registration = read(registrationPath);
  const initialHashes = new Map([planPath, manualPath, registrationPath].map(path => [path, hash(path)]));
  for (const row of registration.plans) assert.equal(hash(join(evidence, row.path)), row.sha256);
  assert.ok(registration.plans.some(row => resolve(evidence, row.path) === resolve(planPath)));
  for (const [path, expected] of Object.entries(plan.frozen_hashes)) assert.equal(hash(path), expected, path);
  assert.equal(plan.samples.length, 5); assert.equal(plan.model, 'gpt-6.1-sol'); assert.equal(plan.effort, 'medium');
  assert.equal(fixture.cases.length, 4); assert.equal(fixture.rule_cases.length, 10);
  for (const row of manual.inputs) bind(row);
  assert.ok(manual.binding_checks.length > 0 && manual.binding_checks.every(row => row.pass === true));
  assert.deepEqual(manual.samples.map(row => row.sample).sort(), plan.samples.map(row => row.name).sort());
  assert.equal(manual.case_reviews.length, 20);
  mkdirSync(output);
  const samples = [];
  let runtimeBinding;
  for (const sample of plan.samples) {
    const directory = join(evidence, 'workflow-runs', sample.name), policy = join(evidence, sample.policy);
    const baseFiles = ['capture.json', 'report.json', 'native-audit.json', 'manifest.json', 'worker-manifest.json', 'worker-final-state.json'];
    for (const path of baseFiles) initialHashes.set(join(directory, path), hash(join(directory, path)));
    const capture = read(join(directory, 'capture.json')), report = read(join(directory, 'report.json')), audit = read(join(directory, 'native-audit.json'));
    const state = read(join(directory, 'worker-final-state.json')), worker = read(join(directory, 'worker-manifest.json')), manifest = read(join(directory, 'manifest.json'));
    runtimeBinding = manifest.binding;
    assert.equal(state.exit_code, 0); assert.equal(report.status, 'pass'); assert.equal(audit.runs.length, 1); assert.equal(audit.runs[0].status, 'pass');
    assert.equal(worker.plan_sha256, hash(planPath)); assert.equal(worker.runner_sha256, hash(join(evidence, plan.runner))); assert.equal(worker.arm, sample.arm);
    assert.equal(worker.requested_model, plan.model); assert.equal(worker.effort, plan.effort); assert.equal(worker.codex_cli, '0.169.0');
    assert.deepEqual(audit.runs[0].model_ids, [plan.model]); assert.deepEqual(audit.runs[0].efforts, [plan.effort]); assert.deepEqual(audit.runs[0].versions, ['0.169.0']);
    assert.deepEqual(state.thread_ids, [audit.runs[0].session_id]);
    const sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
    const native = readdirSync(sessions, { recursive: true }).filter(path => path.endsWith(`-${state.thread_ids[0]}.jsonl`));
    assert.equal(native.length, 1);
    const nativePath = join(sessions, native[0]);
    assert.deepEqual(await auditMcpDirectory(nativePath, directory, policy), audit);
    initialHashes.set(nativePath, audit.source_sha256);
    for (const [path, expected] of Object.entries(audit.evidence_hashes)) {
      assert.equal(hash(join(directory, path)), expected);
      if (initialHashes.has(join(directory, path))) assert.equal(initialHashes.get(join(directory, path)), expected);
      initialHashes.set(join(directory, path), expected);
    }
    assert.equal(manifest.binding.root, plan.runtime_root); assert.equal(manifest.binding.commit, plan.runtime_commit); assertCandidateCommandUnchanged(manifest.binding);
    assert.equal(manifest.kind, 'rendering-artifact-workflow'); assert.equal(manifest.policy_sha256, hash(policy)); assert.equal(manifest.fixture_sha256, hash(fixturePath));
    assert.equal(manifest.task_sha256, hash(join(directory, 'task.json'))); assert.equal(manifest.harness_sha256, hash(join(root, plan.harness)));
    const grade = gradeRenderingCapture(capture, fixture);
    assert.deepEqual(grade, report.grade); assert.equal(grade.status, 'pass'); assert.equal(grade.cases.length, 14);
    const summary = manual.samples.filter(row => row.sample === sample.name); assert.equal(summary.length, 1); assert.equal(summary[0].status, 'pass');
    for (const row of summary[0].bindings) bind(row);
    const reviews = manual.case_reviews.filter(row => row.sample === sample.name);
    assert.deepEqual(reviews.map(row => row.case_id).sort(), fixture.cases.map(row => row.id).sort());
    const artifacts = [];
    for (const row of fixture.cases) {
      const artifactPath = join(directory, 'artifacts', row.id + '.md'), text = readFileSync(artifactPath, 'utf8');
      const produced = capture.outputs.filter(item => item.id === row.id); assert.equal(produced.length, 1); assert.equal(produced[0].text, text); assert.equal(produced[0].persisted_sha256, sha256(text));
      const review = reviews.find(item => item.case_id === row.id); assert.equal(review.status, 'pass'); assert.equal(review.artifact_sha256, sha256(text));
      const consumerDirectory = join(output, sample.name + '-' + row.id); mkdirSync(consumerDirectory);
      if (row.stored_profile !== null) { mkdirSync(join(consumerDirectory, '.faff')); write(join(consumerDirectory, '.faff/infra-profile.json'), row.stored_profile); }
      const shown = spawnSync(process.execPath, [join(plan.runtime_root, 'plugin/skills/faff/bin/faff'), 'profile', 'show', '--json', '--root', consumerDirectory], { cwd: consumerDirectory, encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH } });
      assert.equal(shown.status, row.source.profile_show.exit_code); assert.equal(shown.stdout, row.source.profile_show.stdout); assert.equal(shown.stderr, row.source.profile_show.stderr);
      const consumer = consumeArchitectureArtifact(plan.runtime_root, text, consumerDirectory); assert.equal(consumer.pass, true); assert.ok(row.recommendations.includes(consumer.producer_value.recommendation));
      const bad = { ...consumer.producer_value, recommendation: 'invented' };
      const mutation = consumeArchitectureArtifact(plan.runtime_root, '```faff-contract:architecture-proposal\n' + JSON.stringify(bad) + '\n```\n', consumerDirectory);
      assert.equal(mutation.pass, false); assert.equal(mutation.exit_code, 1);
      const consumptionPath = join(consumerDirectory, 'consumption.json');
      write(consumptionPath, { profile: { exit_code: shown.status, stdout: shown.stdout, stderr: shown.stderr }, consumer, invalid_recommendation: mutation });
      artifacts.push({ case_id: row.id, artifact_sha256: sha256(text), consumption_sha256: hash(consumptionPath), contract: 'pass', manual: 'pass' });
    }
    const files = [...new Set([...baseFiles, ...Object.keys(audit.evidence_hashes)])];
    samples.push({ sample: sample.name, arm: sample.arm, artifacts_passed: artifacts.length, decisions_passed: grade.cases.filter(row => row.kind === 'decision' && row.pass).length, native: 'pass', manual: 'pass', artifacts, hashes: Object.fromEntries(files.map(path => [path, initialHashes.get(join(directory, path))])) });
  }
  assertCandidateCommandUnchanged(runtimeBinding);
  for (const [path, expected] of [...initialHashes, ...Object.entries(plan.frozen_hashes)]) assert.equal(hash(path), expected, path + ' changed during gate');
  for (const row of manual.inputs) bind(row);
  for (const sample of samples) {
    for (const [path, expected] of Object.entries(sample.hashes)) assert.equal(hash(join(evidence, 'workflow-runs', sample.sample, path)), expected);
    for (const artifact of sample.artifacts) {
      assert.equal(hash(join(evidence, 'workflow-runs', sample.sample, 'artifacts', artifact.case_id + '.md')), artifact.artifact_sha256);
      assert.equal(hash(join(output, sample.sample + '-' + artifact.case_id, 'consumption.json')), artifact.consumption_sha256);
    }
  }
  const result = { schema: 1, status: 'pass', source_installed: false, scope: 'Bounded architecture proposals, exact native and source bindings, independent actual-output review, real profile-show and contract consumers. No architectural quality or full caller workflow claim.', verifier_sha256: hash(new URL(import.meta.url)), registration_sha256: hash(registrationPath), plan: { path: planPath, sha256: hash(planPath) }, manual: { path: manualPath, sha256: hash(manualPath) }, samples };
  write(join(output, 'gate.json'), result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [plan, manual, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: verify-architecture-mcp-arm-v1.mjs PLAN MANUAL NEW_DIRECTORY');
  const result = await verifyArchitectureArm(resolve(plan), resolve(manual), resolve(output));
  console.log(JSON.stringify({ status: result.status, samples: result.samples.length, artifacts: result.samples.reduce((n, row) => n + row.artifacts_passed, 0) }));
}
