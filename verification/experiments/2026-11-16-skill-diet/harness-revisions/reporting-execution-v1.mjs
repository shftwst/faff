import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { canonicalHash, sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const SELF = fileURLToPath(import.meta.url);
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
const run = (args, cwd, input = '') => {
  const r = spawnSync(process.execPath, args, { cwd, input, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 20 });
  return { exit_code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error: r.error?.message ?? null };
};

function files(root) {
  const result = {};
  const visit = relative => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      if (entry.name === '.git' || ['summary.md', 'summary-facts.json'].includes(entry.name)) continue;
      const path = join(relative, entry.name);
      if (entry.isDirectory()) visit(path);
      else result[path] = sha256(readFileSync(join(root, path)));
    }
  };
  visit('');
  return result;
}

function seed(root, cli, row) {
  mkdirSync(root, { recursive: true });
  const git = spawnSync('git', ['init', '-q'], { cwd: root, env: { PATH: process.env.PATH } });
  assert.equal(git.status, 0);
  writeFileSync(join(root, '.faffrc.yaml'), '');
  const runId = `run-20260101-000000-beepboop-list-${row.entropy}`;
  const call = (args, input) => {
    const result = run([cli, ...args], root, input);
    assert.equal(result.exit_code, 0, JSON.stringify(result));
  };
  call(['run-ledger', 'init-self-drain', '--mode', 'list', '--id', runId, '--root', root]);
  const runDir = join(root, '.faff', 'runs', runId), ledgerPath = join(runDir, 'run-ledger.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.admitted = Object.keys(row.outcomes);
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  for (const [issue, outcome] of Object.entries(row.outcomes)) call(['run-ledger', 'record-outcome', '--issue', issue, '--outcome', outcome, '--run-dir', runDir]);
  const completed = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  Object.assign(completed, row.annotations, { stop_reason: row.stop_reason, level: 'L3' });
  completed.owner = { ...completed.owner, started_at: '2026-01-01T00:00:00.000Z', last_heartbeat: '2026-01-01T00:00:00.000Z' };
  writeFileSync(ledgerPath, JSON.stringify(completed, null, 2) + '\n');
  call(['events', 'append', '--run', runId, '--root', root, '--ts', '2026-01-01T01:00:00.000Z'], JSON.stringify({ phase: 'run', type: row.action === 'continue' ? 'budget-checkpoint' : 'run-end' }));
  writeFileSync(join(runDir, 'heartbeat'), '2026-01-01T01:00:00.000Z\n');
  for (const [path, value] of Object.entries(row.records)) {
    mkdirSync(dirname(join(runDir, path)), { recursive: true });
    write(join(runDir, path), value);
  }
  if (row.action === 'fault') writeFileSync(ledgerPath, '{ unreadable ledger');
  return { root, runDir, factsPath: join(runDir, 'summary-facts.json'), summaryPath: join(runDir, 'summary.md') };
}

function consumer(runtimeRoot, directory, row, args, nonce) {
  const payload = join(directory, `${nonce}.json`);
  write(payload, { runtimeRoot, args, dependencies: row.dependencies });
  return run([SELF, '--consume', payload], directory);
}

export function canonicalFacts(value) {
  const result = structuredClone(value);
  const empty = value => value === null || Array.isArray(value) && value.length === 0
    || value && typeof value === 'object' && Object.keys(value).length === 0;
  const fields = { tracker: ['titles', 'sibling_end_states', 'superseded_delivered'],
    run: ['gloss', 'methodology_findings', 'verdicts', 'resolve_attempts', 'park_records', 'reasons', 'inferred_deps', 'discovered_scope', 'follow_ups', 'prep_summary', 'tidy_log'] };
  for (const [section, keys] of Object.entries(fields)) {
    if (!result?.[section] || typeof result[section] !== 'object' || Array.isArray(result[section])) continue;
    for (const key of keys) if (Object.hasOwn(result[section], key) && empty(result[section][key])) delete result[section][key];
    if (Object.keys(result[section]).length === 0) delete result[section];
  }
  return result;
}

export function matchesEconomics(line, metrics, shipped) {
  const number = value => Number(value.replaceAll(',', '').replace(/K$/i, 'e3').replace(/M$/i, 'e6'));
  const parsed = line.match(/^Economics:\s*([\d.,]+[KM]?) tokens \((estimate|transcript)\)(?:,\s*\$([\d.,]+))?\s*·\s*(\d+) shipped\s*·\s*(.+)$/i);
  if (!parsed || number(parsed[1]) !== metrics.tokens_total || parsed[2] !== metrics.tokens_source || Number(parsed[4]) !== shipped) return false;
  if (metrics.cost_total === null ? parsed[3] !== undefined : parsed[3] === undefined || number(parsed[3]) !== metrics.cost_total) return false;
  if (shipped === 0) return parsed[5] === 'ZERO-SHIP';
  const money = parsed[5].match(/^\$([\d.,]+)(?:\s+(?:per shipped|each))?$/i);
  if (money) return metrics.cost_per_shipped.cost_each !== null && number(money[1]) === metrics.cost_per_shipped.cost_each;
  const units = parsed[5].match(/^([\d.,]+[KM]?)\s+tokens?(?:\s*[/,]\s*\$([\d.,]+))?(?:\s*(?:per shipped|\/shipped|each))?$/i);
  return !!units && number(units[1]) === metrics.cost_per_shipped.tokens_each
    && (metrics.cost_per_shipped.cost_each === null ? units[2] === undefined : units[2] !== undefined && number(units[2]) === metrics.cost_per_shipped.cost_each);
}

function assertMembership(text, row) {
  const headings = text.split('\n## ');
  for (const [id, wanted] of Object.entries(row.section_membership ?? {})) {
    const sections = headings.filter(section => new RegExp(`^- ${id}(?=[: ;]|$)`, 'm').test(section));
    assert.equal(sections.length, 1, 'duplicate or absent primary outcome for ' + id);
    assert.ok(sections[0].startsWith(wanted), 'wrong primary outcome for ' + id);
  }
  for (const id of row.not_admitted ?? []) assert.ok(!Object.hasOwn(row.outcomes, id), 'prep hold was admitted');
}

export function createReportingEnvironment({ root, runtimeRoot, cli, fixture }) {
  const events = [], errors = [], states = new Map(), publicCases = [], expected = [];
  for (const row of fixture.cases) {
    const actual = seed(join(root, 'cases', row.id), cli, row);
    const oracle = seed(join(root, 'oracles', row.id), cli, row);
    const argumentsFor = state => ['run', 'summary', '--run-dir', state.runDir, '--facts', state.factsPath, '--root', state.root];
    let reference = null;
    if (row.action !== 'continue') {
      write(oracle.factsPath, row.expected_facts);
      reference = consumer(runtimeRoot, root, row, argumentsFor(oracle).slice(2), `${row.id}-oracle`);
      assert.equal(reference.exit_code, row.action === 'fault' ? 2 : 0, JSON.stringify(reference));
      for (const pattern of row.output_patterns ?? []) assert.match(reference.stdout, new RegExp(pattern, 'm'));
      if (row.action === 'report') assertMembership(reference.stdout, row);
    }
    states.set(row.id, { row, ...actual, before: files(actual.root), normalised: [], calls: 0 });
    expected.push({ id: row.id, action: row.action, facts: row.expected_facts, reference, economics: row.economics_line,
      metrics: row.dependencies.economics, shipped: Object.values(row.outcomes).filter(value => value === 'shipped').length, target: row.target, args: argumentsFor(actual) });
    publicCases.push({ id: row.id, task: row.task, run_dir: actual.runDir, facts_path: actual.factsPath, root: actual.root,
      source: row.source, queue: row.queue, budget: row.budget, reporting_target: row.target });
  }
  return {
    expected, publicCases,
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name === 'finish' && exact(args, [])) return event.result = { finished: true };
        const state = states.get(args?.case_id);
        if (!state) throw new Error('unknown case');
        if (name === 'write_facts' && exact(args, ['case_id', 'value'])) {
          write(state.factsPath, args.value);
          return event.result = { written: true, path: state.factsPath, sha256: sha256(readFileSync(state.factsPath)) };
        }
        if (name === 'run_faff' && exact(args, ['case_id', 'executable', 'args'])) {
          if (args.executable !== cli || !isDeepStrictEqual(args.args, expected.find(row => row.id === args.case_id).args)) throw new Error('command outside reporting fixture scope');
          state.calls++;
          const result = consumer(runtimeRoot, root, state.row, args.args.slice(2), `${state.row.id}-actual-${state.calls}`);
          return event.result = { ...result, persisted: existsSync(state.summaryPath) ? readFileSync(state.summaryPath, 'utf8') : null };
        }
        if (name === 'normalise_output' && exact(args, ['case_id', 'channel', 'text']) && ['tracker', 'conversation'].includes(args.channel) && typeof args.text === 'string') {
          const id = `${args.case_id}:${args.channel}:${state.normalised.length}`;
          state.normalised.push({ id, channel: args.channel, text: args.text });
          return event.result = { id, text: args.text, dependency: 'controlled identity rendering adaptor' };
        }
        if (name === 'publish' && exact(args, ['case_id', 'channel', 'target', 'normalised_id'])) {
          const item = state.normalised.find(value => value.id === args.normalised_id && value.channel === args.channel);
          if (!item) throw new Error('publication requires the corresponding rendering result');
          return event.result = { acknowledged: true, channel: args.channel, target: args.target, text: item.text, dependency: 'controlled publication sink' };
        }
        if (name === 'continue_build' && exact(args, ['case_id', 'issue_ids'])) return event.result = { dispatched: args.issue_ids, dependency: 'controlled build continuation' };
        if (name === 'report_failure' && exact(args, ['case_id', 'reason']) && typeof args.reason === 'string') return event.result = { surfaced: true, reason: args.reason };
        throw new Error('invalid tool or arguments');
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, case_id: event.case_id, message: error.message });
        throw error;
      }
    },
    capture() {
      return { events, errors, cases: [...states.values()].map(state => ({ id: state.row.id, before: state.before, after: files(state.root),
        facts: existsSync(state.factsPath) ? JSON.parse(readFileSync(state.factsPath, 'utf8')) : null,
        summary: existsSync(state.summaryPath) ? readFileSync(state.summaryPath, 'utf8') : null })) };
    },
  };
}

export function gradeReportingExecution(capture, expected, fixture) {
  const cases = expected.map(row => {
    const actual = capture.cases.find(value => value.id === row.id), events = capture.events.filter(value => value.case_id === row.id);
    const named = name => events.filter(value => value.name === name), problems = [];
    const check = (condition, problem) => { if (!condition) problems.push(problem); };
    check(actual && isDeepStrictEqual(actual.before, actual.after), 'changed-authoritative-run-state');
    check(events.every(event => !event.error), 'tool-error');
    if (row.action === 'continue') {
      check(events.length === 1 && named('continue_build').length === 1, 'premature-final-report');
      check(isDeepStrictEqual(named('continue_build')[0]?.args.issue_ids, fixture.cases.find(value => value.id === row.id).queue), 'wrong-continuation');
      check(actual?.facts === null && actual?.summary === null, 'premature-report-files');
    } else {
      const command = named('run_faff')[0];
      check(named('write_facts').length === 1 && isDeepStrictEqual(canonicalFacts(actual?.facts), canonicalFacts(row.facts)), 'facts-source-or-authority');
      check(named('run_faff').length === 1 && isDeepStrictEqual(command?.args.args, row.args), 'summary-command');
      check(named('write_facts')[0]?.seq < command?.seq, 'facts-before-command');
      check(command?.result?.exit_code === row.reference.exit_code && command?.result?.error === null, 'command-exit');
      if (row.action === 'fault') {
        check(actual?.summary === null && named('publish').length === 0 && named('continue_build').length === 0, 'publication-after-ledger-fault');
        check(named('report_failure').length === 1 && /ledger|unreadable|cannot read/i.test(named('report_failure')[0]?.args.reason ?? ''), 'ledger-fault-not-surfaced');
      } else {
        check(actual?.summary === row.reference.stdout && command?.result?.stdout === actual?.summary && command?.result?.persisted === actual?.summary, 'canonical-summary-or-persisted-bytes');
        check(named('continue_build').length === 0 && named('report_failure').length === 0, 'unexpected-continuation-or-fault');
        check(named('publish').length === 2 && named('normalise_output').length === 2, 'publication-count');
        for (const channel of ['tracker', 'conversation']) {
          const post = named('publish').filter(event => event.args.channel === channel);
          const normalised = named('normalise_output').filter(event => event.args.channel === channel);
          check(post.length === 1 && normalised.length === 1 && command?.seq < normalised[0]?.seq && normalised[0]?.seq < post[0]?.seq, 'publication-order:' + channel);
          check(post[0]?.result?.target === (channel === 'tracker' ? row.target : 'conversation'), 'publication-target:' + channel);
          const text = post[0]?.result?.text, summary = row.reference.stdout.trimEnd();
          const equivalent = typeof text === 'string' && (channel === 'conversation' ? text.trimEnd() === summary
            : text.startsWith(summary + '\n\n') && matchesEconomics(text.slice(summary.length + 2).trimEnd(), row.metrics, row.shipped));
          check(equivalent, 'publication-facts-banner-economics:' + channel);
        }
      }
    }
    return { id: row.id, kind: 'execution', pass: !problems.length, problems };
  });
  return { status: !capture.errors.length && cases.every(row => row.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const string = { type: 'string' }, tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
export const REPORTING_TOOLS = [
  tool('write_facts', 'Write summary-facts.json once for a case. Use only supplied tracker observations and in-run judgements.', { case_id: string, value: {} }),
  tool('run_faff', 'Execute the pinned run summary command handler. External forge, install-health, metering and budget dependencies are fixed fixture responses; file reads and writes use the production implementation.', { case_id: string, executable: string, args: { type: 'array', items: string } }),
  tool('normalise_output', 'Invoke the already-resolved rendering adaptor for a publication channel. This fixture adaptor preserves bytes and returns a result identifier.', { case_id: string, channel: string, text: string }),
  tool('publish', 'Publish the corresponding normalised result to the controlled tracker or conversation sink.', { case_id: string, channel: string, target: string, normalised_id: string }),
  tool('continue_build', 'Dispatch ready issues through the controlled build continuation when this run must continue.', { case_id: string, issue_ids: { type: 'array', items: string } }),
  tool('report_failure', 'Surface an unreadable-ledger failure without successful publication.', { case_id: string, reason: string }),
  tool('finish', 'Finish after all independent cases are handled.', {}),
];

export async function runReportingExecution({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policyBytes = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const work = mkdtempSync('/var/tmp/faff-reporting-measure-'), cli = join(root, binding.entry);
  const env = createReportingEnvironment({ root: work, runtimeRoot: root, cli, fixture }), reader = createPolicyReader(policyBytes);
  const task = { instructions: 'Read the complete policy. Handle each independent reporting checkpoint from its supplied observations. Earlier workflow acquisition, run closure when appropriate and adaptor resolution are fixture preconditions. Use run summary with the exact supplied run-dir and facts paths and --root to scope the disposable project. For successful reports, this workload requests the full canonical summary in both publication channels, with the required condensed economics line appended to the tracker post. Use the controlled rendering and publication ports. If the queue must continue, dispatch it instead of finalising. No live tracker or forge operations, actual builds, profile acquisition, or reconstruction of previous phases. The command handler uses real file persistence and fixed external dependencies; the rendering port is an identity stub, not a test of rendering quality or pre-write normalisation inside the command. Finish after all cases.', policy: reader.metadata, resolved_executable: cli, tools: [POLICY_TOOL, ...REPORTING_TOOLS], cases: env.publicCases };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'reporting-command-handler-execution', binding, invoked_command: ['run', 'summary'], fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: canonicalHash(task), harness_sha256: sha256(readFileSync(SELF)), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  try {
    const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...REPORTING_TOOLS.map(value => value.name)]), maxRequests: 160, timeoutMs: 900000 });
    const capture = env.capture(), grade = gradeReportingExecution(capture, env.expected, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture);
    write(join(output, 'expected.json'), env.expected);
    const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--consume') {
    const payload = JSON.parse(readFileSync(process.argv[3], 'utf8')), d = payload.dependencies;
    const require = createRequire(import.meta.url), module = require(join(payload.runtimeRoot, 'plugin/skills/faff/bin/lib/run-summary.js'));
    const deps = { doctor: () => d.doctor, economics: () => d.economics, budget: () => d.budget, methodology: () => d.methodology,
      ghJson: args => d.forge[JSON.stringify(args)] ?? { ok: false, data: null, stderr: 'unregistered fixture forge read' } };
    process.exitCode = module.cmdRunSummary(payload.args, deps);
  } else {
    const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
    if (!output) throw new Error('usage: reporting-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
    const report = await runReportingExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
    console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
    process.exitCode = report.status === 'pass' ? 0 : 1;
  }
}
