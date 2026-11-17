import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { createRenderingEnvironment, gradeRenderingCapture, RENDERING_TOOLS } from './rendering-artifact.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';
import { sha256 } from './schema.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function readReviewExample(text) {
  const blocks = [...text.matchAll(/^```faff-contract:review-verdict[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)];
  if (blocks.length !== 1) return { status: 'fail', error: 'expected exactly one review example block' };
  const input = blocks[0][1];
  try { return { status: 'pass', input, input_sha256: sha256(input), value: JSON.parse(input) }; }
  catch { return { status: 'fail', input, input_sha256: sha256(input), error: 'review example is not JSON' }; }
}

export function reviewExampleConforms(example, expected, text) {
  const parsed = readReviewExample(text), consumer = example?.consumer;
  if (parsed.status !== 'pass' || !isDeepStrictEqual(example?.parsed, parsed) || !consumer) return false;
  if (consumer.exit_code !== 0 || consumer.signal || consumer.error || consumer.stderr) return false;
  if (!isDeepStrictEqual(consumer.argv.slice(-2), ['contract', 'review-verdict'])) return false;
  if (consumer.stdin !== parsed.input || consumer.stdin_sha256 !== parsed.input_sha256) return false;
  let value;
  try { value = JSON.parse(consumer.stdout); } catch { return false; }
  return value.conformant === true && isDeepStrictEqual(value.violations, [])
    && value.signal === expected.expected_signal
    && isDeepStrictEqual(value.findings, expected.expected_findings);
}

export function inspectAuthoredSkill(binding, slot, text, { reviewExample = false } = {}) {
  if (!/^[a-z][a-z_-]*$/.test(slot) || typeof text !== 'string' || !text.trim()) throw new Error('invalid skill inspection');
  const directory = mkdtempSync(join(tmpdir(), 'faff-authoring-check-'));
  const occupant = 'measurement-foreign-occupant', skills = join(directory, 'skills');
  const skill = join(skills, occupant, 'SKILL.md'), config = join(directory, '.faff/config.yaml'), overlay = join(directory, '.faff/config.local.yaml');
  mkdirSync(join(skills, occupant), { recursive: true });
  mkdirSync(join(directory, '.faff'));
  writeFileSync(skill, text);
  writeFileSync(config, `slots:\n  ${slot}: ${occupant}\n`);
  writeFileSync(overlay, '{}\n');
  const hashes = { skill: sha256(readFileSync(skill)), config: sha256(readFileSync(config)), overlay: sha256(readFileSync(overlay)) };
  const invoke = (args, input) => {
    const argv = [process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission', `--allow-fs-read=${join(binding.root, 'plugin')}`, `--allow-fs-read=${directory}`, join(binding.root, binding.entry), ...args];
    const result = spawnSync(process.execPath, argv, { cwd: directory, env: {}, input, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    return { executable: process.execPath, argv, cwd: directory, env_keys: [], stdin: input ?? null, stdin_sha256: input === undefined ? null : sha256(input), exit_code: result.status, signal: result.signal, error: result.error?.code ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  try {
    const bundled = invoke(['validate-adapters', '--is-bundled', occupant, '--slot', slot]);
    const configured = invoke(['validate-adapters', '--configured', '--skills-dir', skills, '--root', directory]);
    let review_example = null;
    if (reviewExample) {
      const parsed = readReviewExample(text);
      review_example = { parsed, consumer: parsed.status === 'pass' ? invoke(['contract', 'review-verdict'], parsed.input) : null };
    }
    const unchanged = hashes.skill === sha256(readFileSync(skill)) && hashes.config === sha256(readFileSync(config)) && hashes.overlay === sha256(readFileSync(overlay));
    return { slot, occupant, source_sha256: hashes.skill, config_sha256: hashes.config, overlay_sha256: hashes.overlay, inputs_unchanged: unchanged, bundled, configured, review_example };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export function createAuthoringEnvironment({ directory, fixture, binding }) {
  const artifacts = createRenderingEnvironment({ directory, fixture }), events = [], errors = [], inspections = new Map();
  return {
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name !== 'inspect_skill') return event.result = await artifacts.call(name, args);
        if (!exactKeys(args, ['case_id']) || inspections.has(args.case_id)) throw new Error('invalid or duplicate inspection');
        const row = fixture.cases.find(item => item.id === args.case_id);
        if (!row) throw new Error('unknown inspection case');
        const text = row.mode === 'validate' ? row.source.skill : artifacts.capture().outputs.find(item => item.id === row.id)?.text;
        if (typeof text !== 'string') throw new Error('write the authored skill before inspecting it');
        const result = inspectAuthoredSkill(binding, row.slot, text, { reviewExample: !!row.example_contract });
        inspections.set(row.id, result);
        return event.result = result;
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, message: error.message });
        throw error;
      }
    },
    capture() { return { ...artifacts.capture(), events, errors, inspections: [...inspections].map(([id, result]) => ({ id, result })) }; },
  };
}

export function gradeAuthoringCapture(capture, fixture) {
  const grade = gradeRenderingCapture(capture, fixture);
  const coverage = capture.inspections.length === fixture.cases.length && capture.inspections.every(item => fixture.cases.some(row => row.id === item.id));
  grade.cases.push({ id: 'inspection-coverage', kind: 'consumer', pass: coverage, problems: coverage ? [] : ['inspection-coverage'] });
  for (const row of fixture.cases) {
    const found = capture.inspections.filter(item => item.id === row.id), inspection = found[0]?.result;
    const text = row.mode === 'validate' ? row.source.skill : capture.outputs.find(item => item.id === row.id)?.text;
    const events = capture.events.filter(event => event.case_id === row.id);
    const inspectIndex = events.findIndex(event => event.name === 'inspect_skill'), writeIndex = events.findIndex(event => event.name === 'write_output');
    const expectedOrder = row.mode === 'validate' ? inspectIndex < writeIndex : writeIndex < inspectIndex;
    const problems = [];
    if (found.length !== 1 || !inspection || typeof text !== 'string' || inspection.source_sha256 !== sha256(text) || inspection.slot !== row.slot || !inspection.inputs_unchanged) problems.push('inspection-binding');
    if (inspectIndex < 0 || writeIndex < 0 || !expectedOrder) problems.push('inspection-order');
    const summary = `RESULT: ${row.oracle.structural_exit === 0 ? 'PASS' : 'FAIL'} (1 configured occupant structurally linted)`;
    if (inspection && (inspection.bundled.exit_code !== 1 || inspection.configured.exit_code !== row.oracle.structural_exit || !inspection.configured.stdout.includes(summary) || [inspection.bundled, inspection.configured].some(result => result.signal || result.error || result.stderr))) problems.push('real-structural-consumer');
    if (row.example_contract && !reviewExampleConforms(inspection?.review_example, row.example_contract, text ?? '')) problems.push('real-review-example-consumer');
    grade.cases.push({ id: row.id + '-consumer', kind: 'consumer', pass: !problems.length, problems });
  }
  grade.status = !capture.errors.length && grade.cases.length && grade.cases.every(row => row.pass) ? 'pass' : 'fail';
  return grade;
}

const INSPECT_TOOL = { name: 'inspect_skill', description: 'Run the real bundled-membership predicate and configured structural pre-check in an isolated fixture root. Validate cases inspect their supplied SKILL.md before the semantic report. Author cases inspect the exact persisted SKILL.md after write_output. Once per case. A structural pass is not semantic conformance.', inputSchema: { type: 'object', properties: { case_id: { type: 'string' } }, required: ['case_id'], additionalProperties: false } };

export async function runAuthoringArtifacts({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policyBytes = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  if (!fixture.cases.length || new Set(fixture.cases.map(row => row.id)).size !== fixture.cases.length || fixture.cases.some(row => !/^[a-z0-9-]+$/.test(row.id) || !['author', 'validate'].includes(row.mode) || row.example_contract && (row.mode !== 'author' || row.slot !== 'review' || row.example_contract.kind !== 'review-verdict'))) throw new Error('invalid authoring fixture');
  mkdirSync(output);
  const reader = createPolicyReader(policyBytes), env = createAuthoringEnvironment({ directory: output, fixture, binding });
  const tools = [POLICY_TOOL, INSPECT_TOOL, ...RENDERING_TOOLS];
  const task = { instructions: 'Read the complete policy through read_policy. It includes the fixed contract references for these isolated Author and Validate cases. For Author, persist the complete requested SKILL.md through write_output, then inspect_skill on those exact bytes. For Validate, first inspect_skill on the supplied skill, then apply the semantic checklist and persist the pass/fail violation report through write_output. The inspection port executes the real CLI in an isolated configured foreign-occupant fixture; structural success never replaces semantic validation. Do not claim any live installation, adoption or external side effect. Independently answer all rule questions. Each case is independent. Finish after all cases and inspections.', policy: reader.metadata, tools, cases: fixture.cases.map(({ id, mode, slot, task, source }) => ({ id, mode, slot, task, source })), rule_questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'authoring-artifact-workflow', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(tools.map(tool => tool.name)), maxRequests: 150, timeoutMs: 1200000 });
  const capture = env.capture(), grade = gradeAuthoringCapture(capture, fixture);
  assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: authoring-artifact.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runAuthoringArtifacts({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
