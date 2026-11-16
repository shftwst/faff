// One source-bound CRLF diagnostic. Old failed runs and paired declarations stay unchanged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { buildPromptBundle, DEFAULT_LIMITS, probeClaude, runClaudeScenario, runtimeFingerprintOfBody } from './claude-driver.mjs';
import { gradeHandoff, readHandoffEvents } from './handoff-tools.mjs';
import { createLedger, OPUS_5_5_PRICING } from './proxy.mjs';
import { loadInputs, evaluateCapture, ledgerAccounting } from './run.mjs';
import { canonicalHash, sha256, validateTrace } from './schema.mjs';
import { captureScenario, createFixtureTracker, loadPolicyBytes, REASON_CODES } from './tracker.mjs';

const [candidatePath, commit, outputPath, mode] = process.argv.slice(2);
if (!candidatePath || !/^[a-f0-9]{40}$/.test(commit ?? '') || !outputPath || (mode !== undefined && mode !== '--prepare-only')) {
  throw new Error('usage: node run-handoff-diagnostic.mjs CANDIDATE_ROOT COMMIT NEW_OUTPUT_DIRECTORY [--prepare-only]');
}
const root = resolve(candidatePath), out = resolve(outputPath);
assert.equal(resolve(dirname(fileURLToPath(import.meta.url)), '../..'), root, 'run the harness from the candidate checkout');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
assert.equal(git('status', '--porcelain', '--untracked-files=all', '--', 'eval/control-parity').trim(), '', 'eval harness must be committed');
const binding = bindCandidateCommand(root, commit);
const harnessTree = git('rev-parse', 'HEAD:eval/control-parity').trim();
const inputs = loadInputs(root);
const scenario = inputs.registry.scenarios.find(s => s.id === 'crlf-outside-region');
const fixture = inputs.fixtures.get(scenario.id);
const policy = loadPolicyBytes(root);
const baselineCommit = '690546db64e3de7a68058a98a9945bfb731e68b3';
const releasedReference = git('show', `${baselineCommit}:plugin/skills/faff/references/review.md`);
const start = releasedReference.indexOf('### Review-findings comment identity');
const end = releasedReference.indexOf('### Producer slots', start);
assert.ok(start >= 0 && end > start);
const oraclePolicy = Buffer.from(releasedReference.slice(start, end));
assert.equal(sha256(oraclePolicy), scenario.policy_sha256);
const input = { issue_id: fixture.issue_id, faff_body: fixture.faff_body, reason_codes: [...REASON_CODES] };
const bundle = buildPromptBundle({ policyBytes: policy, input, handoff: true });
const limits = { ...DEFAULT_LIMITS, attempts: 1, allowance_nanos: 500_000_000 };
const settings = { binary: 'claude', model: 'claude-opus-5-5', effort: 'medium', credential_env: 'CLAUDE_CODE_OAUTH_TOKEN' };
const treatment = {
  id: 'review-comment-stored-handoff-v1',
  source_commit: commit, plugin_tree: binding.plugin_tree, harness_tree: harnessTree,
  oracle_policy_source: baselineCommit,
  policy_sha256: sha256(policy), policy_bytes: policy.length,
  fixture_sha256: canonicalHash(fixture), oracle_sha256: canonicalHash(scenario.expected),
  tools: bundle.allowed_tools, harness_sha256: bundle.hashes.harness_sha256,
  changes: ['replace list/create/save/plan model tools with prepare/apply', 'two connector-owned live reads before one stored-body write', 'session references and bounded upstream MCP process'],
  scope: 'one candidate CRLF diagnostic, fixture tracker only; no baseline, paired acceptance or hosted tracker qualification',
};
if (mode === '--prepare-only') {
  console.log(JSON.stringify({ treatment, limits, prompt_sha256: bundle.hashes.prompt_sha256, note: 'No provider request or output files.' }, null, 2));
  process.exit(0);
}
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('launch from the authenticated container environment');
const cli = probeClaude(settings);
assert.equal(cli.available, true, JSON.stringify(cli.reasons));
assert.equal(cli.version, '2.1.325');
mkdirSync(out);
const write = (file, value) => writeFileSync(join(out, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
write('manifest.json', { schema: 1, treatment, binding, settings, limits, cli, pricing: OPUS_5_5_PRICING });
const trackerDirectory = join(out, 'preflight', 'tracker');
const tracker = createFixtureTracker({ directory: trackerDirectory, initialState: fixture.tracker, issueId: fixture.issue_id });
const probe = await runClaudeScenario({ trackerDirectory, input, policyBytes: policy, settings, limits, evidenceDirectory: join(out, 'preflight', 'evidence'), ledger: createLedger(join(out, 'preflight', 'ledger.json'), 0), mode: 'capture-refuse', handoffBinding: binding });
const capture = { stop: probe.stop, captured: probe.proxy.captured, other_paths: probe.proxy.other_paths, tracker_events: tracker.readEvents().length };
const problems = evaluateCapture(capture, { model: settings.model, effort: settings.effort, output_tokens: limits.output_tokens, policy: policy.toString('utf8'), allowedTools: bundle.allowed_tools, harness: bundle.system });
write('preflight.json', { problems });
assert.deepEqual(problems, []);
const runtime = runtimeFingerprintOfBody(capture.captured[0].body, bundle.user);
assertCandidateCommandUnchanged(binding);
assert.equal(git('status', '--porcelain', '--untracked-files=all', '--', 'eval/control-parity').trim(), '');
const directory = join(out, 'attempt', 'tracker');
const evidenceDirectory = join(out, 'attempt', 'evidence');
const ledger = createLedger(join(out, 'ledger.json'), limits.allowance_nanos);
const started = Date.now();
const trace = await captureScenario({
  driver: ({ input }) => runClaudeScenario({ trackerDirectory: directory, input, policyBytes: policy, settings, limits, evidenceDirectory, ledger, handoffBinding: binding }),
  fixture, registryEntry: scenario, directory,
  // Registry policy is the immutable released oracle; the candidate prompt is recorded separately.
  policyBytes: oraclePolicy,
  promptSha256: bundle.hashes.prompt_sha256, runtimeSha256: runtime,
});
write('trace.json', trace);
const calls = readHandoffEvents(directory);
const events = createFixtureTracker({ directory }).readEvents();
const grade = validateTrace(trace, scenario, inputs.registry);
const handoff = gradeHandoff({ calls, events, fixture, stop: trace.stop });
const request = JSON.parse(readFileSync(join(evidenceDirectory, 'requests', '001.request.json'), 'utf8'));
const runtimeMatches = runtime === runtimeFingerprintOfBody(request.body, bundle.user);
const accounting = ledgerAccounting(ledger);
assertCandidateCommandUnchanged(binding);
const passed = grade.status === 'pass' && handoff.status === 'followed' && runtimeMatches
  && trace.accounting.usage_complete && accounting.held_reservation_nanos === 0 && accounting.open_reservation_nanos === 0;
const report = { kind: treatment.id, status: passed ? 'pass' : 'fail', grade, handoff, runtime_matches_preflight: runtimeMatches, elapsed_ms: Date.now() - started, ...accounting, scope: treatment.scope };
write('report.json', report);
console.log(JSON.stringify(report, null, 2));
process.exitCode = passed ? 0 : 1;
