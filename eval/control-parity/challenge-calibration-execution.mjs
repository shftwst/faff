import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { canonicalHash, sha256 } from './schema.mjs';
import { serveMailbox } from './interactive-handoff.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { createChallengeEnvironment, gradeChallengeExecution, CHALLENGE_TOOLS } from './challenge-execution.mjs';

const scope = 'Offline same-provider-family judgement calibration and real CLI admission consumption. The fixture primary was authored and reviewed by OpenAI. This GPT treatment does not certify an independent provider opinion, production challenge eligibility, hosted transport or publication.';
const instructions = 'First read the entire policy through read_policy, starting at offset 0 and following next_offset until null. Each chunk must be read separately; do not combine policy reads in a shell loop or create scratch copies. For each independent case, occupy the ADR drift or PRDR YAGNI challenge interface in the supplied policy. The fixture primary was authored and reviewed by OpenAI; this same-provider-family run measures judgement and CLI consumption only. For this offline calibration, assess the supplied cases without claiming provider independence or production challenge eligibility; provider selection is outside this treatment. Judge the supplied proposal-shaped artifact; do not use the diff-shaped code-review transport. opinion_available=false represents an exhausted provider attempt with no independent opinion: preserve that absence. Submit the interface result through the tool; the fixture caller feeds it to the actual CLI and persists the admission outcome. Ground is only applicable to an overturned PRDR challenge. Do not edit the proposal or implement anything. Finish after all cases.';
const tools = CHALLENGE_TOOLS.map(tool => tool.name === 'submit_challenge'
  ? { ...tool, description: tool.description.replace('Return the independent challenge outcome', 'Return the calibration challenge outcome') }
  : tool);
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export async function runChallengeCalibration({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), fixtureBytes = readFileSync(fixturePath), policyBytes = readFileSync(policyPath);
  const fixture = JSON.parse(fixtureBytes), work = mkdtempSync(join(tmpdir(), 'faff-challenge-calibration-'));
  mkdirSync(output);
  const policyReader = createPolicyReader(policyBytes);
  const env = createChallengeEnvironment({ root: work, runtime: root, fixture });
  try {
    const task = { instructions, policy: policyReader.metadata, tools: [POLICY_TOOL, ...tools], cases: fixture.cases.map(({ id, seam, input, opinion_available }) => ({ id, seam, input, opinion_available })) };
    write(join(output, 'task.json'), task);
    write(join(output, 'manifest.json'), { schema: 1, kind: 'challenge-judgement-and-consumption', binding,
      fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: canonicalHash(task),
      harness_sha256: sha256(readFileSync(new URL(import.meta.url))),
      core_harness_sha256: sha256(readFileSync(new URL('./challenge-execution.mjs', import.meta.url))),
      policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))),
      scope, original_fixture_scope_is_not_claimed: fixture.scope, accounting: 'unmetered' });
    write(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, policyReader.guard(env.call), { allowedTools: new Set(['read_policy', ...tools.map(tool => tool.name)]), maxRequests: 64, timeoutMs: 480000 });
    const capture = env.capture(), grade = gradeChallengeExecution(capture, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture);
    const report = { status: !bridge.stop && !bridge.rejected && policyReader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: policyReader.capture(), grade, scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: challenge-calibration-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runChallengeCalibration({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
