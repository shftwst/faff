import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const subset = (actual, expected) => Array.isArray(expected)
  ? Array.isArray(actual) && actual.length === expected.length && expected.every((v, i) => subset(actual[i], v))
  : expected && typeof expected === 'object'
    ? actual && typeof actual === 'object' && !Array.isArray(actual) && Object.entries(expected).every(([k, v]) => subset(actual[k], v))
    : isDeepStrictEqual(actual, expected);

export function gradeMethodologyOutput(value, oracle) {
  const problems = [];
  if (!subset(value, oracle.required)) problems.push('required-output');
  if (Array.isArray(value?.tickets) && value.tickets.some(ticket => typeof ticket.description !== 'string' || !ticket.description.trim())) problems.push('missing-ticket-description');
  const text = JSON.stringify(value) ?? '';
  for (const pattern of oracle.must_include ?? []) if (!new RegExp(pattern, 'i').test(text)) problems.push(`missing-source:${pattern}`);
  for (const pattern of oracle.must_avoid ?? []) if (new RegExp(pattern, 'i').test(text)) problems.push(`forbidden-content:${pattern}`);
  return { pass: !problems.length, problems };
}

export function consumeTerminationPolicy(root, value, scenarios) {
  const cwd = mkdtempSync(join(tmpdir(), 'faff-methodology-consumer-'));
  try {
    const command = join(root, 'plugin/skills/faff/bin/faff');
    return scenarios.map(scenario => {
      const args = ['run-done', ...scenario.args, '--policy', JSON.stringify(value)];
      const result = spawnSync(process.execPath, [command, ...args], { cwd, encoding: 'utf8', timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
      let output = null;
      try { output = JSON.parse(result.stdout); } catch { /* Retain malformed output as a failed consumption. */ }
      const validated = spawnSync(process.execPath, [command, 'contract', 'run-termination'], { cwd, encoding: 'utf8', input: result.stdout, timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
      return { id: scenario.id, args, exit_code: result.status, stdout: result.stdout, stderr: result.stderr, validation_exit: validated.status, validation_stdout: validated.stdout, validation_stderr: validated.stderr, value: output, pass: result.status === 0 && validated.status === 0 && subset(output, scenario.expected) };
    });
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}

export function createMethodologyEnvironment({ directory, fixture, root }) {
  mkdirSync(join(directory, 'artifacts'));
  const outputs = new Map(), events = [], errors = [];
  return {
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name === 'finish' && Object.keys(args).length === 0) return event.result = { finished: true };
        if (name !== 'submit_output' || Object.keys(args).sort().join(',') !== 'case_id,value' || !fixture.cases.some(c => c.id === args.case_id) || outputs.has(args.case_id)) throw new Error('invalid tool, case or duplicate output');
        const row = fixture.cases.find(c => c.id === args.case_id);
        const artifact = join(directory, 'artifacts', row.id + '.json');
        write(artifact, args.value);
        const consumed = row.consumer === 'run-done' ? consumeTerminationPolicy(root, args.value, row.consumer_scenarios) : [];
        outputs.set(row.id, { id: row.id, value: args.value, consumed });
        return event.result = { persisted: true, sha256: sha256(readFileSync(artifact)), consumer_calls: consumed.length };
      } catch (error) { event.error = error.message; errors.push({ seq: event.seq, message: error.message }); throw error; }
    },
    capture() {
      return { events, errors, outputs: [...outputs.values()].map(o => ({ ...o, persisted_sha256: sha256(readFileSync(join(directory, 'artifacts', o.id + '.json'))) })) };
    },
  };
}

export function gradeMethodologyCapture(capture, fixture) {
  const cases = fixture.cases.map(row => {
    const outputs = capture.outputs.filter(o => o.id === row.id), output = outputs[0], grade = gradeMethodologyOutput(output?.value, row.oracle);
    if (outputs.length !== 1 || output && output.persisted_sha256 !== sha256(JSON.stringify(output.value, null, 2) + '\n')) { grade.pass = false; grade.problems.push('persisted-artifact'); }
    if (row.consumer && (!output || output.consumed.length !== row.consumer_scenarios.length || output.consumed.some(c => !c.pass))) { grade.pass = false; grade.problems.push('consumer-result'); }
    return { id: row.id, kind: row.kind, ...grade, value: output?.value ?? null, consumer_results: output?.consumed.map(c => ({ id: c.id, pass: c.pass, verdict: c.value?.verdict, reason: c.value?.reason })) ?? [] };
  });
  return { status: !capture.errors.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
export const METHODOLOGY_TOOLS = [
  tool('submit_output', 'Persist one completed named output in the JSON shape requested by its case. The controlled caller consumes a termination policy through the real CLI. Submit once per case.', { case_id: { type: 'string' }, value: {} }),
  tool('write_tracker', 'Attempt a tracker mutation; this port records and refuses writes because these requests are read-only.', { case_id: { type: 'string' }, value: {} }),
  tool('finish', 'Finish after submitting all independent requested outputs.', {}),
];

export async function runMethodologyOutputs({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policy = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const reader = createPolicyReader(policy), env = createMethodologyEnvironment({ directory: output, fixture, root });
  const task = { instructions: 'Read the full policy bundle through read_policy. It includes unchanged shared context followed by the methodology being measured. Complete each independent named-output request in its requested JSON format and persist the result with submit_output. Cases are read-only producer requests; do not create tickets, change labels or invoke downstream skills. Shared topology and rendering rules remain applicable. Facts in each case are a fresh, isolated caller snapshot; no external fetch is required. A supplied termination policy is consumed by the real run-done CLI and contract validator. Finish after all cases are submitted.', tools: [POLICY_TOOL, ...METHODOLOGY_TOOLS], policy: reader.metadata, cases: fixture.cases.map(({ id, output, request, input }) => ({ id, output, request, input })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'methodology-output-consumption', binding, policy_sha256: sha256(policy), fixture_sha256: sha256(fixtureBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...METHODOLOGY_TOOLS.map(t => t.name)]), maxRequests: 150, timeoutMs: 720000 });
  const capture = env.capture(), grade = gradeMethodologyCapture(capture, fixture);
  assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: methodology-output.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const result = await runMethodologyOutputs({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
