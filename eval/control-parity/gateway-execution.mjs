import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { canonicalHash, sha256 } from './schema.mjs';
import { serveMailbox } from './interactive-handoff.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';

const INIT = ['config', 'init', '--set', 'tracking.spec_docs_path='];
const HOUSEKEEPING = [INIT, ['gitignore-ensure'], ['hooks-ensure']];
const tools = new Set(['run_faff', 'offer_onboarding', 'invoke_skill', 'finish']);
const canonicalSkill = name => name.replace(/^faff:/, '');
const commandArgs = args => args.filter(arg => arg !== '--json');
const scopedCommand = args => {
  if (isDeepStrictEqual(args, ['config', 'path'])) return true;
  if (args.length === 1 && ['gitignore-ensure', 'hooks-ensure'].includes(args[0])) return true;
  if (args[0] !== 'config' || args[1] !== 'init' || args.length > 34 || args.length % 2 !== 0) return false;
  for (let i = 2; i < args.length; i += 2) {
    if (args[i] !== '--set' || !/^[a-z_][a-z0-9_.]*=/.test(args[i + 1])) return false;
  }
  return true;
};
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function run(cli, root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
  });
  return { exit_code: result.status, stdout: result.stdout, stderr: result.stderr, ...(result.error ? { error: result.error.message } : {}) };
}

function seed(root, kind) {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'keep.txt'), 'Unrelated project content.\n');
  if (kind === 'existing-housekeeping') {
    mkdirSync(join(root, '.claude'));
    mkdirSync(join(root, '.faff'));
    write(join(root, '.claude/settings.json'), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo preserve-hook' }] }] }, fixture_note: 'preserve-setting' });
    writeFileSync(join(root, '.faff/.gitignore'), '# Keep this existing exception\n!/keep.txt\n');
    writeFileSync(join(root, '.faff/keep.txt'), 'Keep this existing local file.\n');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
  } else if (kind === 'decline-stub') {
    mkdirSync(join(root, '.faff'));
    writeFileSync(join(root, '.faff/config.yaml'), 'tracking:\n  spec_docs_path: ""\n');
  } else if (kind !== 'empty') throw new Error(`unknown seed ${kind}`);
}

function snapshot(root) {
  const files = {};
  function visit(relative) {
    for (const item of readdirSync(join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name === '.git') continue;
      const path = join(relative, item.name);
      if (item.isDirectory()) visit(path);
      else {
        assert.ok(item.isFile(), `unexpected non-file ${path}`);
        const bytes = readFileSync(join(root, path));
        files[path] = { bytes: bytes.length, sha256: sha256(bytes), mtime_ms: statSync(join(root, path)).mtimeMs, text: bytes.toString('utf8').split(root).join('<workspace>') };
      }
    }
  }
  visit('');
  return files;
}
const fileContents = files => Object.fromEntries(Object.entries(files).map(([path, value]) => [path, value.text]));
const cliAction = args => ({ name: 'run_faff', args: commandArgs(args) });
const skillAction = (name, args) => ({ name: 'invoke_skill', skill: canonicalSkill(name), args });

function stubOnboard(cli, root) {
  return [['config', 'init', '--set', 'tracking.spec_docs_path=records/specs'], ['gitignore-ensure'], ['hooks-ensure']].map(args => ({ args, result: run(cli, root, args) }));
}

export function createGatewayEnvironment({ root, cli, fixture }) {
  const events = [], errors = [], states = new Map(), expected = { cases: [] };
  for (const row of fixture.cases) {
    const path = join(root, 'cases', row.id), oracle = join(root, 'reference', row.id);
    seed(path, row.seed);
    seed(oracle, row.seed);
    const initial = snapshot(path);
    const actions = [];
    if (row.expected_path !== 'no-write') actions.push({ name: 'offer_onboarding', message: fixture.offer });
    if (row.expected_path === 'decline') {
      for (const args of HOUSEKEEPING) {
        const result = run(cli, oracle, args);
        assert.equal(result.exit_code, 0, JSON.stringify(result));
        actions.push(cliAction(args));
      }
    } else if (row.expected_path === 'accept') {
      for (const { result } of stubOnboard(cli, oracle)) assert.equal(result.exit_code, 0, JSON.stringify(result));
      actions.push(skillAction('faff-onboard', []));
    }
    actions.push(skillAction(row.expected_skill, row.expected_args));
    expected.cases.push({ id: row.id, actions, final_files: fileContents(snapshot(oracle)), no_write: row.expected_path === 'no-write', path_exit: row.seed === 'decline-stub' ? 0 : 3 });
    states.set(row.id, { row, path, initial });
  }
  return {
    expected,
    async call(name, args) {
      if (name === 'finish') {
        if (!exactKeys(args, [])) throw new Error('finish takes an empty object');
        events.push({ seq: events.length + 1, name, args, result: { finished: true } });
        return { finished: true };
      }
      const state = states.get(args?.case_id);
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (!state) throw new Error('unknown fixture case');
        event.before_files = snapshot(state.path);
        if (name === 'run_faff') {
          if (!exactKeys(args, ['case_id', 'executable', 'args']) || args.executable !== cli || !Array.isArray(args.args) || !args.args.length || args.args.some(a => typeof a !== 'string')) throw new Error('invalid resolved CLI invocation');
          const argv = commandArgs(args.args);
          if (!scopedCommand(argv)) throw new Error('command outside gateway fixture scope');
          event.result = run(cli, state.path, args.args);
        } else if (name === 'offer_onboarding') {
          if (!exactKeys(args, ['case_id', 'message']) || typeof args.message !== 'string') throw new Error('invalid offer');
          event.result = { answer: state.row.reply };
        } else if (name === 'invoke_skill') {
          if (!exactKeys(args, ['case_id', 'name', 'args']) || typeof args.name !== 'string' || !Array.isArray(args.args) || args.args.some(a => typeof a !== 'string')) throw new Error('invalid skill invocation');
          if (canonicalSkill(args.name) === 'faff-onboard') {
            event.delegated_cli = stubOnboard(cli, state.path);
            if (event.delegated_cli.some(c => c.result.exit_code !== 0)) throw new Error('fixture onboard setup failed');
          }
          event.result = { completed: true, downstream: 'fixture-stub', config_path_exists: existsSync(join(state.path, '.faff/config.yaml')) };
        } else throw new Error('unknown gateway tool');
        event.after_files = snapshot(state.path);
        return event.result;
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, case_id: event.case_id, message: error.message });
        throw error;
      }
    },
    capture() {
      return { events, errors, cases: [...states].map(([id, state]) => ({ id, initial_files: state.initial, final_files: snapshot(state.path) })) };
    },
  };
}

export function gradeGatewayExecution(capture, expected) {
  const result = { status: 'fail', cases: [], errors: [...capture.errors] };
  for (const row of expected.cases) {
    const observed = capture.cases.find(c => c.id === row.id);
    const events = capture.events.filter(e => e.case_id === row.id);
    const actions = [], reads = [], problems = [];
    for (const event of events) {
      if (event.error) { problems.push('tool-error'); continue; }
      if (event.name === 'run_faff') {
        const args = commandArgs(event.args.args);
        if (isDeepStrictEqual(args, ['config', 'path'])) {
          reads.push({ seq: event.seq, exit_code: event.result.exit_code });
          if (![0, 3].includes(event.result.exit_code)) problems.push('path-read-error');
        } else {
          actions.push(cliAction(args));
          if (event.result.exit_code !== 0) problems.push('command-error');
        }
      } else if (event.name === 'offer_onboarding') actions.push({ name: event.name, message: event.args.message });
      else if (event.name === 'invoke_skill') actions.push(skillAction(event.args.name, event.args.args));
      else problems.push('unknown-operation');
    }
    if (!isDeepStrictEqual(actions, row.actions)) problems.push('operation-order-or-arguments');
    const firstEffect = events.find(e => e.name !== 'run_faff' || !isDeepStrictEqual(commandArgs(e.args.args), ['config', 'path']));
    if (!row.no_write && !reads.some(r => r.seq < firstEffect?.seq && r.exit_code === row.path_exit)) problems.push('missing-initial-read');
    if (!observed || !isDeepStrictEqual(fileContents(observed.final_files), row.final_files)) problems.push('final-state-differs');
    if (row.no_write && observed && !isDeepStrictEqual(observed.initial_files, observed.final_files)) problems.push('unexpected-write');
    result.cases.push({ id: row.id, pass: problems.length === 0, problems, actions, reads, final_files: observed ? fileContents(observed.final_files) : null });
  }
  if (!result.errors.length && result.cases.length && result.cases.every(c => c.pass)) result.status = 'pass';
  return result;
}

const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' }, strings = { type: 'array', items: string };
export const GATEWAY_TOOLS = [
  { name: 'run_faff', description: 'Run the already-resolved faff CLI in this case\'s isolated real git workspace. Returns real exit code and output.', inputSchema: schema({ case_id: string, executable: string, args: strings }) },
  { name: 'offer_onboarding', description: 'Present the onboarding offer to the fixture human and receive their reply.', inputSchema: schema({ case_id: string, message: string }) },
  { name: 'invoke_skill', description: 'Skill dispatch port. Downstream skills are stubs; onboard supplies fixture config, and other skills acknowledge dispatch.', inputSchema: schema({ case_id: string, name: string, args: strings }) },
  { name: 'finish', description: 'Finish after all independent gateway cases have reached their next skill dispatch.', inputSchema: schema({}) },
];

export async function runGatewayExecution({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit);
  const fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  const policyBytes = readFileSync(policyPath);
  const cli = join(root, 'plugin/skills/faff/bin/faff');
  const work = mkdtempSync(join(tmpdir(), 'faff-gateway-workflow-'));
  mkdirSync(output);
  const policyReader = createPolicyReader(policyBytes);
  const env = createGatewayEnvironment({ root: work, cli, fixture });
  const task = {
    instructions: 'First read the entire policy through read_policy, starting at offset 0 and following next_offset until null. Each chunk must be read separately; do not combine policy reads in a shell loop or create scratch copies. Execute each independent gateway entry using the supplied policy and fixture tools. Configuration state is unknown until read. Use the already-resolved executable for all CLI operations. Stop each case at downstream skill dispatch; if onboarding is invoked, resume the original request after it completes. Do not execute downstream workflows yourself. Make actual tool calls; do not answer with proposed actions. Read only this task file. All other filesystem access and commands are through the fixture bridge.',
    policy: policyReader.metadata, resolved_executable: cli, tools: [POLICY_TOOL, ...GATEWAY_TOOLS],
    cases: fixture.cases.map(({ id, user_message, autonomous }) => ({ id, user_message, autonomous })),
  };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'gateway-entry-execution', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), policy_bytes: policyBytes.length, task_sha256: canonicalHash(task), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, normalisations: fixture.normalisations, accounting: 'unmetered interactive Claude worker; no billed-cost claim' });
  write(join(output, 'ready.json'), { ready: true });
  try {
    const bridge = await serveMailbox(output, policyReader.guard(env.call), { allowedTools: new Set([...tools, 'read_policy']), maxRequests: 128, timeoutMs: 480000 });
    const capture = env.capture();
    const grade = gradeGatewayExecution(capture, env.expected);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture);
    write(join(output, 'expected.json'), env.expected);
    const report = { status: !bridge.stop && !bridge.rejected && policyReader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: policyReader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: gateway-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runGatewayExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases.map(({ id, pass, problems }) => ({ id, pass, problems })) }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
