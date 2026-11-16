import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { homedir } from 'node:os';
import { auditMcpDirectory } from '../../../eval/control-parity/codex-mcp-native-audit.mjs';
import { assessReportingDrafts } from './assess-reporting-drafts-v1.mjs';
import { structuredHash } from '../../../eval/control-parity/mailbox-mcp.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
import { assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';

const evidence = import.meta.dirname, root = resolve(evidence, '../../..');
const read = path => readFileSync(path);
const json = path => JSON.parse(read(path));
const hash = path => sha256(read(path));
function binding(row) { assert.equal(hash(resolve(root, row.path)), row.sha256, row.path); }

export function verifyReportingProvenance({ audit, assessment, manifest, plan, rawNativeHash, auditorHash, fixtureHash }) {
  assert.equal(audit.auditor_sha256, auditorHash, 'native auditor hash');
  assert.equal(audit.source_sha256, rawNativeHash, 'raw native source hash');
  assert.deepEqual(Object.keys(audit.evidence_hashes).sort(), ['task.json', 'startup-binding.json', 'worker-manifest.json', 'worker-final-state.json', 'mcp-server-manifest.json', 'mcp-trace.jsonl', 'mcp-protocol-errors.jsonl', 'capture.json', 'report.json'].sort(), 'native evidence key set');
  assert.equal(manifest.binding.root, plan.runtime_root, 'registered runtime root');
  assert.equal(manifest.binding.commit, plan.runtime_commit, 'registered runtime commit');
  assert.deepEqual(Object.keys(assessment.source_hashes).sort(), ['capture.json', 'expected.json', 'report.json', 'native-audit.json'].sort(), 'assessment source key set');
  assert.equal(assessment.fixture_sha256, fixtureHash, 'assessment fixture hash');
}

export async function verifyReportingArm(arm, manualPath) {
  assert.ok(['baseline', 'candidate'].includes(arm));
  const registrationPath = join(evidence, 'beep-reporting-mcp-v1-draft-assessment-registration.json'), registration = json(registrationPath);
  for (const [name, expected] of Object.entries(registration.plan_hashes)) assert.equal(hash(join(evidence, name)), expected, name);
  for (const [sample, files] of Object.entries(registration.existing_samples)) for (const [name, expected] of Object.entries(files)) assert.equal(hash(join(evidence, 'workflow-runs', sample, name)), expected, sample + '/' + name);
  const planName = arm === 'baseline' ? 'beep-reporting-mcp-v1-assessed-continuation-plan.json' : 'beep-reporting-mcp-v1-assessed-candidate-plan.json';
  const plan = json(join(evidence, planName));
  for (const [path, expected] of Object.entries(plan.frozen_hashes)) assert.equal(hash(path), expected, path);
  const fixture = json(join(evidence, plan.fixture)), caseIds = fixture.cases.map(row => row.id).sort();
  const manual = json(manualPath);
  for (const row of manual.inputs) binding(row);
  assert.ok(manual.binding_checks.every(row => row.pass === true));
  const samples = [], allBindings = {};
  for (let index = 1; index <= 5; index++) {
    const name = `beep-reporting-mcp-v1-${arm}-${index}`, directory = join(evidence, 'workflow-runs', name);
    const report = json(join(directory, 'report.json')), capture = json(join(directory, 'capture.json')), expected = json(join(directory, 'expected.json'));
    const audit = json(join(directory, 'native-audit.json')), assessment = json(join(directory, 'draft-assessment-v1.json')), replay = json(join(directory, 'workflow-replay.json'));
    const state = json(join(directory, 'worker-final-state.json')), manifest = json(join(directory, 'manifest.json'));
    assert.equal(state.exit_code, 0, name + ' worker');
    assert.equal(audit.runs.length, 1); assert.equal(audit.runs[0].status, 'pass', name + ' native');
    assert.deepEqual(audit.runs[0].model_ids, ['gpt-6.1-sol']); assert.deepEqual(audit.runs[0].efforts, ['medium']);
    assert.deepEqual(audit.runs[0].versions, ['0.169.0']); assert.deepEqual(state.thread_ids, [audit.runs[0].session_id]);
    for (const [file, expectedHash] of Object.entries(audit.evidence_hashes)) assert.equal(hash(join(directory, file)), expectedHash, name + '/' + file);
    const sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
    const matches = readdirSync(sessions, { recursive: true }).filter(path => path.endsWith(`-${state.thread_ids[0]}.jsonl`));
    assert.equal(matches.length, 1, name + ' raw native capture');
    const nativePath = join(sessions, matches[0]);
    verifyReportingProvenance({ audit, assessment, manifest, plan, rawNativeHash: hash(nativePath), auditorHash: plan.frozen_hashes[join(root, 'eval/control-parity/codex-mcp-native-audit.mjs')], fixtureHash: hash(join(evidence, plan.fixture)) });
    assert.equal(manifest.kind, 'reporting-command-handler-execution'); assert.deepEqual(manifest.invoked_command, ['run', 'summary']);
    assertCandidateCommandUnchanged(manifest.binding);
    const policyPath = join(evidence, arm === 'baseline' ? 'baseline/beep-reporting-with-context.md' : 'candidates/beep-reporting-v1-with-context.md');
    const nativeReplay = await auditMcpDirectory(nativePath, directory, policyPath);
    assert.deepEqual(nativeReplay, audit, name + ' exact native audit replay');
    assert.equal(manifest.policy_sha256, hash(policyPath)); assert.equal(manifest.fixture_sha256, hash(join(evidence, plan.fixture)));
    assert.equal(manifest.harness_sha256, hash(join(root, plan.harness)));
    assert.equal(manifest.task_sha256, hash(join(directory, 'task.json')));
    assert.deepEqual(replay.grade, report.grade); assert.equal(replay.recorded_grade_matches, true);
    const fresh = assessReportingDrafts(capture, expected, fixture);
    assert.equal(fresh.status, 'pass', name + ' assessed');
    for (const [key, value] of Object.entries(fresh)) assert.deepEqual(assessment[key], value, name + ' assessment.' + key);
    assert.deepEqual(fresh.raw, report.grade); assert.equal(assessment.assessor_sha256, registration.assessor_sha256);
    for (const [file, expectedHash] of Object.entries(assessment.source_hashes)) assert.equal(hash(join(directory, file)), expectedHash, name + ' assessment source');
    const summaries = manual.samples.filter(row => row.sample === name); assert.equal(summaries.length, 1, name + ' manual sample');
    const summary = summaries[0]; assert.equal(summary.assessed_status, 'pass'); assert.equal(summary.raw_status, report.status); assert.deepEqual(summary.native_status, ['pass']);
    assert.equal(summary.normalisation_calls, fresh.normalisation_calls); assert.deepEqual(summary.discarded_drafts, fresh.discarded_drafts);
    for (const row of summary.bindings) binding(row);
    const reviews = manual.case_reviews.filter(row => row.sample === name);
    assert.deepEqual(reviews.map(row => row.case_id).sort(), caseIds, name + ' manual case coverage');
    for (const review of reviews) {
      const row = capture.cases.find(item => item.id === review.case_id), details = review.evidence;
      const discarded = fresh.discarded_drafts.filter(item => item.case_id === review.case_id);
      assert.equal(review.manual_status, discarded.length ? 'assessed-pass-with-retained-unused-draft' : 'pass', name + '/' + review.case_id + ' manual');
      assert.equal(review.authority_preserved, true); assert.equal(review.supplied_facts_preserved, true);
      assert.ok(review.unsupported_assertions.every(item => item.stage === 'unpublished intermediate rendering input' && discarded.some(draft => draft.seq === item.event_seq)), name + '/' + review.case_id + ' unsupported published assertion');
      binding(details.capture);
      assert.equal(details.capture.sha256, hash(join(directory, 'capture.json')));
      assert.equal(details.authoritative_before_sha256, structuredHash(row.before)); assert.equal(details.authoritative_after_sha256, structuredHash(row.after));
      assert.equal(details.facts_structured_sha256, structuredHash(row.facts));
      assert.equal(details.persisted_summary_utf8_sha256, row.summary === null ? null : sha256(row.summary));
      const publications = capture.events.filter(event => event.case_id === review.case_id && event.name === 'publish');
      assert.equal(details.publications.length, publications.length); assert.equal(review.selected_publication_checks.length, publications.length);
      for (const publication of publications) {
        const item = details.publications.find(item => item.event_seq === publication.seq);
        assert.ok(item); assert.equal(item.text_utf8_sha256, sha256(publication.result.text)); assert.equal(item.normalised_id, publication.args.normalised_id);
        const selected = review.selected_publication_checks.find(item => item.publication_seq === publication.seq);
        assert.ok(selected); assert.equal(selected.normalised_id, publication.args.normalised_id); assert.equal(selected.publication_text_utf8_sha256, sha256(publication.result.text));
        const normalised = capture.events.find(event => event.name === 'normalise_output' && event.result.id === publication.args.normalised_id);
        assert.equal(selected.normalisation_seq, normalised.seq); assert.equal(selected.normalised_text_utf8_sha256, sha256(normalised.result.text));
      }
    }
    const files = ['capture.json', 'expected.json', 'report.json', 'native-audit.json', 'workflow-replay.json', 'draft-assessment-v1.json', 'worker-final-state.json', 'manifest.json'];
    allBindings[name] = Object.fromEntries(files.map(file => [file, hash(join(directory, file))]));
    samples.push({ name, raw_cases_passed: fresh.raw.cases.filter(row => row.pass).length, assessed_cases_passed: fresh.assessed.cases.filter(row => row.pass).length, cases: fresh.assessed.cases.length, native: 'pass', manual_cases: reviews.length, normalisation_calls: fresh.normalisation_calls, discarded_drafts: fresh.discarded_drafts });
  }
  return { schema: 1, status: 'pass', arm, source_installed: false, scope: 'Five-sample controlled reporting arm, with strict native, unchanged runtime/source bindings, reproduced raw scores, frozen post-hoc draft assessment and independent actual-output reading. No provider-wide equivalence, rendering-quality, full-loop or hosted-publication claim.', verifier_sha256: hash(new URL(import.meta.url)), registration_sha256: hash(registrationPath), manual: { path: manualPath, sha256: hash(manualPath) }, samples, evidence_hashes: allBindings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [arm, manualPath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: verify-reporting-mcp-arm-v1.mjs ARM MANUAL NEW_OUTPUT');
  const result = await verifyReportingArm(arm, resolve(manualPath));
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, arm, samples: result.samples.length, raw_passed: result.samples.reduce((n, row) => n + row.raw_cases_passed, 0), assessed_passed: result.samples.reduce((n, row) => n + row.assessed_cases_passed, 0) }));
}
