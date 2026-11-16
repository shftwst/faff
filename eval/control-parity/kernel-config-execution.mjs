import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const run = (cli, cwd, args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  return { exit_code: result.status, stdout: result.stdout, stderr: result.stderr };
};
function snapshot(root) {
  const files = {};
  function visit(relative) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[path] = { text: readFileSync(join(root, path), 'utf8'), mtime_ms: statSync(join(root, path)).mtimeMs };
    }
  }
  visit('');
  return files;
}
const contents = files => Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.text]));
const normaliseArgs = args => {
  args = args.filter(a => a !== '--json');
  if (args[0] === 'config' && args[1] === 'get') {
    const fallback = args.indexOf('-d');
    if (fallback >= 0) args.splice(fallback, 2);
  }
  if (args[0] === 'dispatch' && args[1] === 'resolve') {
    const flags = [];
    for (let i = 3; i < args.length; i += 2) flags.push([args[i], args[i + 1]]);
    args = [...args.slice(0, 3), ...flags.sort(([a], [b]) => a.localeCompare(b)).flat()];
  }
  return args;
};
function seed(root, files) {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  for (const [path, text] of Object.entries({ 'keep.txt': 'Preserve unrelated content.\n', ...files })) {
    if (resolve(root, path) !== join(root, path) || path.includes('..') || path.startsWith('/')) throw new Error('invalid fixture path');
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export function createKernelConfigEnvironment({ root, cli, fixture }) {
  const states = new Map(), answers = new Map(), events = [], errors = [], expected = [];
  for (const row of fixture.cases) {
    const path = join(root, row.id), reference = join(root, 'reference', row.id);
    seed(path, row.files);
    seed(reference, row.files);
    for (const args of row.expected.writes ?? []) {
      const result = run(cli, reference, args);
      if (result.exit_code !== 0) throw new Error(`invalid fixture writer: ${JSON.stringify(result)}`);
    }
    states.set(row.id, { path, before: snapshot(path), files: Object.keys(row.files), submission: null });
    expected.push({ id: row.id, ...row.expected, files: contents(snapshot(reference)) });
  }
  return {
    expected, expectedRules: fixture.rule_cases ?? [],
    publicCases: fixture.cases.map(row => ({ id: row.id, task: row.task, available_files: states.get(row.id).files })),
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name === 'finish') {
          if (!exactKeys(args, [])) throw new Error('finish takes no arguments');
          return event.result = { finished: true };
        }
        if (name === 'answer_rule') {
          if (!exactKeys(args, ['case_id', 'value']) || !fixture.rule_cases?.some(row => row.id === args.case_id) || answers.has(args.case_id)) throw new Error('invalid or duplicate rule answer');
          answers.set(args.case_id, args.value);
          return event.result = { recorded: true };
        }
        const state = states.get(args?.case_id);
        if (!state) throw new Error('unknown case');
        if (name === 'run_faff') {
          if (!exactKeys(args, ['case_id', 'executable', 'args']) || args.executable !== cli || !Array.isArray(args.args) || args.args.some(a => typeof a !== 'string') || args.args.length > 12) throw new Error('invalid resolved CLI call');
          const argv = args.args;
          if (!(argv[0] === 'config' && ['get', 'path', 'resolved', 'set', 'check'].includes(argv[1]) || argv[0] === 'dispatch' && argv[1] === 'resolve')) throw new Error('command outside fixture scope');
          return event.result = run(cli, state.path, argv);
        }
        if (name === 'read_file' || name === 'write_file') {
          const keys = name === 'read_file' ? ['case_id', 'path'] : ['case_id', 'path', 'content'];
          if (!exactKeys(args, keys) || !state.files.includes(args.path)) throw new Error('file outside fixture scope');
          const path = join(state.path, args.path);
          if (name === 'read_file') return event.result = { text: readFileSync(path, 'utf8') };
          if (typeof args.content !== 'string') throw new Error('invalid content');
          writeFileSync(path, args.content);
          return event.result = { written: true };
        }
        if (name === 'invoke_skill') {
          if (!exactKeys(args, ['case_id', 'name']) || typeof args.name !== 'string') throw new Error('invalid skill invocation');
          return event.result = { completed: true, downstream: 'fixture-stub' };
        }
        if (name === 'dispatch_build') {
          if (!exactKeys(args, ['case_id', 'model', 'resolved_effort']) || typeof args.model !== 'string' || typeof args.resolved_effort !== 'string') throw new Error('invalid dispatch');
          return event.result = { completed: true, downstream: 'fixture-agent-stub', model: args.model, effort_applied: false };
        }
        if (name === 'submit_result') {
          if (!exactKeys(args, ['case_id', 'status', 'values', 'reason']) || !['complete', 'blocked'].includes(args.status) || !args.values || typeof args.values !== 'object' || Array.isArray(args.values) || typeof args.reason !== 'string' || state.submission) throw new Error('invalid or duplicate result');
          state.submission = args;
          return event.result = { recorded: true };
        }
        throw new Error('unknown tool');
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, case_id: event.case_id, message: error.message });
        throw error;
      }
    },
    capture() { return { events, errors, rule_answers: [...answers].map(([id, value]) => ({ id, value })), cases: [...states].map(([id, state]) => ({ id, before: state.before, after: snapshot(state.path), submission: state.submission })) }; },
  };
}

export function gradeKernelConfigExecution(capture, expected, expectedRules = []) {
  const cases = expected.map(row => {
    const state = capture.cases.find(c => c.id === row.id), events = capture.events.filter(e => e.case_id === row.id), problems = [];
    const cli = events.filter(e => e.name === 'run_faff'), submission = state?.submission;
    if (events.some(e => ['read_file', 'write_file'].includes(e.name) && /^\.faff(?:\/config\.|rc)/.test(e.args.path))) problems.push('raw-config-access');
    if (events.some(e => e.error)) problems.push('tool-error');
    if (!submission || submission.status !== row.status || !isDeepStrictEqual(submission.values, row.values)) problems.push('result');
    if (row.status === 'blocked' && !submission?.reason.trim()) problems.push('missing-refusal-reason');
    const effectEvents = events.filter(e => ['invoke_skill', 'dispatch_build'].includes(e.name));
    const effects = effectEvents.map(e => ({ tool: e.name, ...Object.fromEntries(Object.entries(e.args).filter(([key]) => key !== 'case_id').map(([key, value]) => [key, key === 'name' ? value.replace(/^faff:/, '') : value])) }));
    if (!isDeepStrictEqual(effects, row.effects)) problems.push('dispatch');
    for (const required of row.reads) {
      const matched = cli.filter(e => {
        const args = normaliseArgs(e.args.args);
        if (isDeepStrictEqual(args, normaliseArgs(required.args))) return true;
        if (required.args[0] !== 'config' || args[0] !== 'config' || !['get', 'resolved', 'path'].includes(args[1])) return false;
        if (required.exit === 2) return true;
        return required.value !== undefined && args[1] !== 'path' && e.result?.stdout.includes(required.value);
      });
      const consumer = required.before_effect === undefined ? events.find(e => e.name === 'submit_result') : effectEvents[required.before_effect];
      if (!matched.some(e => e.result?.exit_code === required.exit && e.seq < consumer?.seq)) problems.push('required-cli-read');
    }
    const writes = cli.filter(e => e.args.args[1] === 'set');
    if (!isDeepStrictEqual(writes.map(e => e.args.args), row.writes ?? []) || writes.some(e => e.result.exit_code !== 0)) problems.push('config-mutation');
    if (!state || !isDeepStrictEqual(contents(state.after), row.files)) problems.push('final-files');
    if (!row.writes?.length && state && !isDeepStrictEqual(state.before, state.after)) problems.push('unexpected-write');
    return { id: row.id, kind: 'execution', pass: !problems.length, problems, effects, status: submission?.status ?? null, values: submission?.values ?? null, final_files: state ? contents(state.after) : null };
  });
  for (const row of expectedRules) {
    const observed = capture.rule_answers?.filter(answer => answer.id === row.id) ?? [];
    const pass = observed.length === 1 && isDeepStrictEqual(observed[0].value, row.expected);
    cases.push({ id: row.id, kind: 'decision', pass, problems: pass ? [] : ['rule-answer'], value: observed[0]?.value ?? null });
  }
  return { status: !capture.errors.length && cases.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const string = { type: 'string' }, strings = { type: 'array', items: string };
const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
export const KERNEL_CONFIG_TOOLS = [
  tool('run_faff', 'Execute the resolved CLI in the isolated case workspace. Config reads/writes and dispatch resolve are available.', { case_id: string, executable: string, args: strings }),
  tool('read_file', 'Read the contents of a listed fixture file.', { case_id: string, path: string }),
  tool('write_file', 'Replace a listed fixture file.', { case_id: string, path: string, content: string }),
  tool('invoke_skill', 'Invoke a downstream skill stub; it records the selected occupant.', { case_id: string, name: string }),
  tool('dispatch_build', 'Dispatch a build-agent stub with its selected model. Record resolved effort separately; this Agent transport has no effort parameter.', { case_id: string, model: string, resolved_effort: string }),
  tool('submit_result', 'Record a completed or blocked case, any requested scalar values and the reason for a refusal. Submit once per case.', { case_id: string, status: string, values: { type: 'object' }, reason: string }),
  tool('answer_rule', 'Answer one bounded policy question using its stated value shape. These questions are decision probes; do not execute their hypothetical actions.', { case_id: string, value: {} }),
  tool('finish', 'Finish after every case has a result.', {}),
];

export async function runKernelConfigExecution({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), cli = join(root, binding.entry);
  const fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes), policyBytes = readFileSync(policyPath);
  const work = mkdtempSync(join(tmpdir(), 'faff-kernel-config-'));
  mkdirSync(output);
  const env = createKernelConfigEnvironment({ root: work, cli, fixture }), reader = createPolicyReader(policyBytes);
  const task = { instructions: 'Read the full policy through read_policy before acting. Execute each independent workflow case using the supplied ports, then submit its result. Files and configuration state are initially unknown. Use the resolved executable for CLI calls. Downstream skills and build agents are stubs; stop at their dispatch. Separately answer every rule_question through answer_rule using its stated value shape; do not execute hypothetical actions from those questions. Only this task and mandatory operator guidance may be read natively; all case operations use fixture ports.', policy: reader.metadata, resolved_executable: cli, tools: [POLICY_TOOL, ...KERNEL_CONFIG_TOOLS], cases: env.publicCases, rule_questions: (fixture.rule_cases ?? []).map(({ id, question }) => ({ id, question })) };
  writeJson(join(output, 'task.json'), task);
  writeJson(join(output, 'manifest.json'), { schema: 1, kind: 'kernel-config-execution', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  writeJson(join(output, 'ready.json'), { ready: true });
  try {
    const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...KERNEL_CONFIG_TOOLS.map(t => t.name)]), maxRequests: 160, timeoutMs: 600000 });
    const capture = env.capture(), grade = gradeKernelConfigExecution(capture, env.expected, env.expectedRules);
    assertCandidateCommandUnchanged(binding);
    writeJson(join(output, 'capture.json'), capture);
    writeJson(join(output, 'expected.json'), env.expected);
    const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
    writeJson(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: kernel-config-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runKernelConfigExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
