// One diagnostic execution of the revised caller, not a paired acceptance run.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [candidatePath, commit, outputPath, mode] = process.argv.slice(2);
if (!candidatePath || !/^[a-f0-9]{40}$/.test(commit ?? '') || !outputPath) {
  throw new Error('usage: node run-crlf-recheck.mjs CANDIDATE_ROOT COMMIT NEW_OUTPUT_DIRECTORY [--prepare-only]');
}
if (mode !== undefined && mode !== '--prepare-only') throw new Error('Unknown mode');
const candidateRoot = resolve(candidatePath);
const out = resolve(outputPath);
const baselineRoot = '/Users/shftwst/workspace/shftwst/faff/.worktrees/review-comment-release-045';
const baselineCommit = '690546db64e3de7a68058a98a9945bfb731e68b3';
const moduleAt = name => import(pathToFileURL(join(candidateRoot, 'eval/control-parity', name)));
const { bindCandidateCommand, assertCandidateCommandUnchanged } = await moduleAt('candidate-command.mjs');
const { COMMAND_LIMITS } = await moduleAt('command-use.mjs');
const { DEFAULT_LIMITS, buildPromptBundle, probeClaude } = await moduleAt('claude-driver.mjs');
const { canonicalHash } = await moduleAt('schema.mjs');
const { createLedger, OPUS_5_5_PRICING } = await moduleAt('proxy.mjs');
const { loadPolicyBytes, REASON_CODES } = await moduleAt('tracker.mjs');
const { loadInputs, claudeCaptureProbe, evaluateCapture, executeAttempt, claudeDriverFactory, ledgerAccounting } = await moduleAt('run.mjs');
const { treatmentRuntime } = await moduleAt('treatments.mjs');
const inputs = loadInputs(candidateRoot);
const scenario = inputs.registry.scenarios.find(s => s.id === 'crlf-outside-region');
const fixture = inputs.fixtures.get(scenario.id);
const candidate = { binding: bindCandidateCommand(candidateRoot, commit), limits: COMMAND_LIMITS };
const baseline = bindCandidateCommand(baselineRoot, baselineCommit);
const settings = { binary: 'claude', model: 'claude-opus-5-5', effort: 'medium', credential_env: 'CLAUDE_CODE_OAUTH_TOKEN' };
const limits = { ...DEFAULT_LIMITS, attempts: 1, allowance_nanos: 500_000_000 };
const policy = loadPolicyBytes(candidateRoot);
const bundle = buildPromptBundle({ policyBytes: policy, input: { issue_id: fixture.issue_id, faff_body: fixture.faff_body, reason_codes: [...REASON_CODES] }, candidate: true });
if (mode === '--prepare-only') {
  console.log(JSON.stringify({ candidate_commit: candidate.binding.commit, scenario: scenario.id, limits, prompt_sha256: bundle.hashes.prompt_sha256, note: 'Preparation only; no provider requests or output files.' }, null, 2));
  process.exit(0);
}
if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw new Error('Start from the authenticated container environment');
const cli = probeClaude(settings);
assert.equal(cli.available, true, JSON.stringify(cli.reasons));
assert.equal(cli.version, '2.1.325');
const manifest = { kind: 'targeted-caller-diagnostic', scenario: scenario.id, source: { root: baselineRoot, commit: baselineCommit }, baseline, candidate, settings, limits, cli, pricing: OPUS_5_5_PRICING };
mkdirSync(out);
const write = (name, value) => writeFileSync(join(out, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
write('manifest.json', manifest);
const capture = await claudeCaptureProbe({ manifest, out: join(out, 'preflight'), registry: { scenarios: [scenario] }, fixtures: inputs.fixtures, arm: 'candidate' });
const reasons = evaluateCapture(capture, { model: settings.model, effort: settings.effort, output_tokens: limits.output_tokens, policy: policy.toString('utf8'), allowedTools: bundle.allowed_tools, harness: bundle.system });
write('preflight.json', { reasons });
assert.deepEqual(reasons, []);
const before = treatmentRuntime(capture.captured[0].body, bundle.user, { candidate: true });
assert.deepEqual(before.problems, []);
assertCandidateCommandUnchanged(candidate.binding);
assertCandidateCommandUnchanged(baseline);
const ledger = createLedger(join(out, 'ledger.json'), limits.allowance_nanos);
const attempt = await executeAttempt({ manifest: { ...manifest, runtime_sha256: canonicalHash({ settings, cli }) }, registry: inputs.registry, fixtures: inputs.fixtures, ledger, out, arm: 'candidate', item: { n: 1, scenario: scenario.id, attempt: 1 }, promptBytes: policy, policyBytes: loadPolicyBytes(baselineRoot), driverFactory: claudeDriverFactory, clock: Date.now, commandBinding: candidate });
const request = JSON.parse(readFileSync(join(attempt.directory, 'evidence/requests/001.request.json'), 'utf8'));
const after = treatmentRuntime(request.body, attempt.bundle.user, { candidate: true });
const runtimeMatches = !after.problems.length && after.raw_sha256 === before.raw_sha256;
const accounting = ledgerAccounting(ledger);
const passed = attempt.summary.status === 'pass' && attempt.summary.command_use.status === 'followed'
  && attempt.trace?.accounting.usage_complete === true && runtimeMatches
  && accounting.held_reservation_nanos === 0 && accounting.open_reservation_nanos === 0;
const report = { kind: manifest.kind, status: passed ? 'pass' : 'fail', runtime_matches_preflight: runtimeMatches, attempt: attempt.summary, ...accounting, note: 'One candidate case only. Does not supersede or pass the failed paired comparison.' };
write('report.json', report);
console.log(JSON.stringify({ status: report.status, observed_cost_nanos: report.observed_cost_nanos }, null, 2));
process.exitCode = passed ? 0 : 1;
