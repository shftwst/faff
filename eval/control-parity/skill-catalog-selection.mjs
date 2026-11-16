import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';
import { createMethodologyEnvironment, gradeMethodologyCapture, METHODOLOGY_TOOLS } from './methodology-output.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export async function runCatalogSelection({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policy = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const reader = createPolicyReader(policy), env = createMethodologyEnvironment({ directory: output, fixture, root });
  const tools = METHODOLOGY_TOOLS.filter(t => t.name !== 'write_tracker');
  const task = { instructions: 'Read the complete skill catalogue through read_policy. It contains the installed names, descriptions and user-invocable flags. For each independent request, select the one skill that fits its entry-command or configured-slot context. Use only the supplied catalogue and request. Submit the exact listed skill name as a JSON string value through submit_output, once per case. Do not execute or read any skill body, query a tracker, change files or perform the described work. These are discovery choices, not workflow execution. Finish after every selection is recorded.', policy: reader.metadata, tools: [POLICY_TOOL, ...tools], cases: fixture.cases.map(({ id, request, input }) => ({ id, request, input })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'skill-catalog-selection', binding, policy_sha256: sha256(policy), fixture_sha256: sha256(fixtureBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), environment_sha256: sha256(readFileSync(new URL('./methodology-output.mjs', import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...tools.map(t => t.name)]), maxRequests: 100, timeoutMs: 600000 });
  const capture = env.capture(), grade = gradeMethodologyCapture(capture, fixture);
  assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report);
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: skill-catalog-selection.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const result = await runCatalogSelection({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
