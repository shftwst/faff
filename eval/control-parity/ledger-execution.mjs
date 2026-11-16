import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(), [...keys].sort());
const producerFields = ['admitted', 'outcomes', 'discovered_scope_filed', 'review_adversarial_skipped', 'review_outage_pending', 'spec_review_outage_pending', 'spec_review_turn_budget_pending', 'landing_resumable', 'post_merge_verification_failures', 'post_merge_verification_unverified', 'outcome_details'];
const without = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !keys.includes(key)));
const cleanEnvironment = () => ({ PATH: process.env.PATH, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' });

function command(state, args, input = '') {
  const result = spawnSync(process.execPath, [state.cli, ...args], { cwd: state.root, env: { ...cleanEnvironment(), CLAUDE_CONFIG_DIR: state.config, CLAUDE_CODE_SESSION_ID: state.session }, input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 20 });
  return { args, input, exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
}

function transcript(state, transitionIndex, missing = false) {
  if (missing) { rmSync(state.transcript, { force: true }); return; }
  const usages = Array.from({ length: transitionIndex + 1 }, (_, index) => ({ input_tokens: 100 + index, output_tokens: 10 + index, cache_read_input_tokens: 4, cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 1 } }));
  writeFileSync(state.transcript, usages.map(usage => JSON.stringify({ type: 'assistant', sessionId: state.session, message: { model: 'claude-opus-4-6', usage } })).join('\n') + '\n');
}

function seed(root, cli, row, index) {
  mkdirSync(root, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q', root], { env: cleanEnvironment() }).status, 0);
  writeFileSync(join(root, '.faffrc.yaml'), '');
  const state = { root, cli, config: join(root, 'fixture-config'), session: 'ledger-measurement-session', runId: `run-20260101-000000-beepboop-list-abc10${index}`, row };
  const project = join(state.config, 'projects', root.replaceAll('/', '-'));
  mkdirSync(project, { recursive: true });
  state.transcript = join(project, state.session + '.jsonl');
  transcript(state, 0);
  const mint = command(state, ['run-ledger', 'init-self-drain', '--mode', 'list', '--id', state.runId, '--root', root]);
  assert.equal(mint.exit_code, 0, mint.stderr);
  state.runDir = join(root, '.faff', 'runs', state.runId);
  state.ledgerPath = join(state.runDir, 'run-ledger.json');
  state.eventsPath = join(state.runDir, 'events.jsonl');
  state.before = json(state.ledgerPath);
  state.beforeBytes = read(state.ledgerPath);
  state.initialEvents = read(state.eventsPath).trim().split('\n').map(JSON.parse);
  state.nextTransition = 0;
  state.reads = 0;
  state.commands = [mint];
  return state;
}

function eventArgs(state, tokens) {
  return ['events', 'append', '--run', state.runId, '--root', state.root, ...(tokens ? ['--tokens', '--session-id', state.session] : [])];
}

export function validEventInvocation(args, state) {
  if (!Array.isArray(args) || args[0] !== 'events' || args[1] !== 'append') return false;
  const flags = new Map();
  for (let index = 2; index < args.length; index++) {
    const flag = args[index];
    if (!['--run', '--root', '--tokens', '--session-id'].includes(flag) || flags.has(flag)) return false;
    if (flag === '--tokens') flags.set(flag, true);
    else {
      const value = args[++index];
      if (typeof value !== 'string' || value.startsWith('--')) return false;
      flags.set(flag, value);
    }
  }
  return flags.get('--run') === state.runId && flags.get('--root') === state.root
    && (!flags.has('--session-id') || flags.get('--session-id') === state.session)
    && (!flags.has('--tokens') || flags.get('--session-id') === state.session);
}

function append(state, payload, args) {
  const beforeBytes = read(state.ledgerPath), beforeEvents = read(state.eventsPath);
  const result = command(state, args, JSON.stringify(payload));
  state.commands.push(result);
  return { ...result, ledger_before_sha256: sha256(beforeBytes), ledger_after_sha256: sha256(read(state.ledgerPath)), prior_events_sha256: sha256(beforeEvents), events_after_sha256: sha256(read(state.eventsPath)), appended: read(state.eventsPath).slice(beforeEvents.length).trim().split('\n').filter(Boolean).map(JSON.parse) };
}

function consume(state, runtimeRoot, dependency) {
  const runcheck = command(state, ['runcheck', state.runDir, '--json']);
  const validate = command(state, ['events', 'validate', '--file', state.eventsPath]);
  const eventRead = command(state, ['events', 'read', '--run', state.runId, '--root', state.root, '--json']);
  const verify = command(state, ['events', 'verify', '--run-dir', state.runDir, '--json']);
  let summary = null;
  if (state.row.kind === 'ledger' && state.row.id === 'mixed-ledger' && runcheck.exit_code === 0) {
    const payload = join(state.root, 'summary-consumer.json');
    const factsPath = join(state.runDir, 'summary-facts.json');
    write(factsPath, dependency.facts);
    for (const [path, value] of Object.entries(dependency.records)) {
      mkdirSync(dirname(join(state.runDir, path)), { recursive: true });
      write(join(state.runDir, path), value);
    }
    write(payload, { runtimeRoot, args: ['--run-dir', state.runDir, '--root', state.root, '--facts', factsPath], dependencies: dependency.dependencies });
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'reporting-execution.mjs'), '--consume', payload], { cwd: state.root, env: cleanEnvironment(), encoding: 'utf8', timeout: 30000 });
    summary = { exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null, persisted: existsSync(join(state.runDir, 'summary.md')) ? read(join(state.runDir, 'summary.md')) : null };
  }
  return { runcheck, validate, verify, event_read: eventRead, summary };
}

function snapshot(state, runtimeRoot, dependency) {
  return { id: state.row.id, root: state.root, run_dir: state.runDir, session_id: state.session, before: state.before, before_bytes: state.beforeBytes, initial_events: state.initialEvents, ledger: json(state.ledgerPath), ledger_bytes: read(state.ledgerPath), heartbeat: existsSync(join(state.runDir, 'heartbeat')) ? read(join(state.runDir, 'heartbeat')) : null, events: read(state.eventsPath).trim().split('\n').map(JSON.parse), commands: state.commands, consumer: consume(state, runtimeRoot, dependency) };
}

export function ledgerTaskCases(fixture, states) {
  return fixture.cases.map(row => {
    const state = states.get(row.id);
    return { id: row.id, kind: row.kind, task: row.task, source: row.source, root: state.root, run_id: state.runId, run_dir: state.runDir, session_id: state.session };
  });
}

export function createLedgerEnvironment({ root, runtimeRoot, cli, fixture, summaryDependencies }) {
  const states = new Map(), expected = [], events = [], errors = [], decisions = [];
  for (const [index, row] of fixture.cases.entries()) {
    const actual = seed(join(root, 'actual', row.id), cli, row, index);
    const oracle = seed(join(root, 'oracle', row.id), cli, row, index);
    if (row.kind === 'ledger') {
      write(oracle.ledgerPath, { ...oracle.before, ...row.oracle.patch });
      append(oracle, { phase: 'run', type: 'ledger-write' }, eventArgs(oracle, false));
    } else {
      for (const [transitionIndex, transition] of row.oracle.transitions.entries()) {
        transcript(oracle, transitionIndex + 1, transition.id === 'park');
        if (transition.expected) append(oracle, transition.expected, eventArgs(oracle, transition.tokens));
      }
    }
    expected.push(snapshot(oracle, runtimeRoot, summaryDependencies));
    states.set(row.id, actual);
  }
  return {
    expected, publicCases: ledgerTaskCases(fixture, states),
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name === 'finish' && exact(args, [])) return event.result = { finished: true };
        if (name === 'answer_rule' && exact(args, ['id', 'value'])) {
          if (!fixture.rule_cases.some(row => row.id === args.id)) throw new Error('unknown decision');
          decisions.push({ id: args.id, value: args.value });
          return event.result = { recorded: true };
        }
        const state = states.get(args?.case_id);
        if (!state) throw new Error('unknown case');
        if (name === 'read_ledger' && exact(args, ['case_id'])) {
          state.reads++;
          return event.result = { ledger: json(state.ledgerPath) };
        }
        if (name === 'write_ledger' && exact(args, ['case_id', 'patch']) && state.row.kind === 'ledger' && args.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) {
          if (Object.keys(args.patch).some(key => !producerFields.includes(key))) throw new Error('attempt to write command-owned or unknown field');
          write(state.ledgerPath, { ...json(state.ledgerPath), ...args.patch });
          return event.result = { written: true, sha256: sha256(read(state.ledgerPath)) };
        }
        if (name === 'append_event' && exact(args, ['case_id', 'transition_id', 'executable', 'args', 'payload'])) {
          if (args.executable !== cli || !validEventInvocation(args.args, state)) throw new Error('command outside isolated event scope');
          if (state.row.kind === 'ledger') {
            if (args.transition_id !== 'ledger-edit') throw new Error('unknown ledger transition');
          } else {
            const transition = state.row.source.transitions[state.nextTransition];
            if (transition?.id !== args.transition_id) throw new Error('transition missing, repeated or out of supplied order');
            transcript(state, state.nextTransition + 1, transition.id === 'park');
            state.nextTransition++;
          }
          return event.result = append(state, args.payload, args.args);
        }
        if (name === 'skip_transition' && exact(args, ['case_id', 'transition_id', 'reason']) && state.row.kind === 'events' && typeof args.reason === 'string') {
          const transition = state.row.source.transitions[state.nextTransition];
          if (transition?.id !== args.transition_id) throw new Error('transition missing, repeated or out of supplied order');
          transcript(state, state.nextTransition + 1, transition.id === 'park');
          state.nextTransition++;
          return event.result = { skipped: true };
        }
        throw new Error('invalid tool or arguments');
      } catch (error) {
        event.error = error.message; errors.push({ seq: event.seq, case_id: event.case_id, message: error.message }); throw error;
      }
    },
    capture() { return { events, errors, decisions, cases: [...states.values()].map(state => snapshot(state, runtimeRoot, summaryDependencies)) }; },
  };
}

function normalised(value, fields) {
  const copy = structuredClone(value);
  for (const field of fields ?? []) {
    const items = copy[field];
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string') || new Set(items).size !== items.length) return null;
    copy[field].sort();
  }
  return copy;
}

function callerPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = structuredClone(value);
  if (result.data && exact(result.data, [])) delete result.data;
  return result;
}

function semanticEvent(value) {
  const result = without(value, ['schema', 'run_id', 'seq', 'ts', 'prev']);
  if (result.data) result.data = without(result.data, ['ledger_sha256', 'ledger_sha256_before', 'ledger_sha256_after']);
  return result;
}

export function summaryBodyWithVerifiedClock(snapshot) {
  const lines = snapshot.consumer.summary.stdout.split('\n');
  const start = Date.parse(snapshot.ledger.owner.started_at);
  const endpoints = [snapshot.heartbeat, snapshot.ledger.owner.last_heartbeat, snapshot.events.at(-1)?.ts].map(value => Date.parse(value)).filter(Number.isFinite);
  const minutes = Math.max(0, Math.floor(((endpoints.length ? Math.max(...endpoints) : start) - start) / 60000));
  assert.equal(lines[0], '# Beep-Boop Run \u2014 ' + new Date(start).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
  assert.equal(lines[1], `Mode: explicit-list \u00b7 Duration: ${Math.floor(minutes / 60)}h ${minutes % 60}m`);
  return lines.slice(2).join('\n');
}

export function comparableLedgerSummary(snapshot) {
  const lines = summaryBodyWithVerifiedClock(snapshot).split('\n'), ids = new Set(Object.keys(snapshot.ledger.outcomes));
  const result = [], pending = [];
  const flush = () => { result.push(...pending.sort()); pending.length = 0; };
  for (const line of lines) {
    const match = /^- ([A-Za-z0-9_-]+)(?=[: (]|$)/.exec(line);
    if (match && ids.has(match[1])) pending.push(line);
    else { flush(); result.push(line); }
  }
  flush();
  return result.join('\n');
}

export function gradeLedgerExecution(capture, expected, fixture) {
  const cases = fixture.cases.map(row => {
    const problems = [], check = (condition, problem) => { if (!condition) problems.push(problem); };
    const matching = capture.cases.filter(item => item.id === row.id), actual = matching[0], reference = expected.find(item => item.id === row.id);
    const events = capture.events.filter(event => event.case_id === row.id), appends = events.filter(event => event.name === 'append_event');
    check(matching.length === 1 && !!reference, 'case-coverage');
    if (!actual || !reference) return { id: row.id, kind: 'execution', pass: false, problems };
    check(events.every(event => !event.error), 'tool-error');
    check(events[0]?.name === 'read_ledger', 'ledger-not-read-first');
    check(actual.consumer.validate.exit_code === 0 && actual.consumer.event_read.exit_code === 0 && actual.consumer.verify.exit_code === 0, 'event-consumers');
    check(equal(JSON.parse(actual.ledger_bytes), actual.ledger) && equal(JSON.parse(actual.before_bytes), actual.before), 'ledger-byte-snapshot');
    check(equal(JSON.parse(actual.consumer.event_read.stdout), actual.events), 'event-read-snapshot');
    check(equal(actual.events.slice(0, actual.initial_events.length), actual.initial_events), 'genesis-changed');
    check(actual.events.every((event, index) => event.seq === index && event.schema === 2 && event.run_id === actual.before.run_id), 'event-sequence');
    check(equal(appends.flatMap(event => event.result?.appended ?? []), actual.events.slice(actual.initial_events.length)), 'append-persistence');
    check(appends.every(event => (event.result?.appended ?? []).every(item => {
      if (item.type === 'ledger-write') return item.data.ledger_sha256 === event.result.ledger_after_sha256;
      if (item.data?.ledger_sha256_before) return item.data.ledger_sha256_before === event.result.ledger_before_sha256 && item.data.ledger_sha256_after === event.result.ledger_after_sha256;
      return true;
    })), 'append-ledger-hashes');
    if (row.kind === 'ledger') {
      check(equal(without(actual.ledger, producerFields), without(actual.before, producerFields)), 'command-owned-state');
      const actualFields = Object.fromEntries(producerFields.filter(key => Object.hasOwn(actual.ledger, key)).map(key => [key, actual.ledger[key]]));
      check(equal(normalised(actualFields, row.oracle.unordered_unique_fields), normalised(row.oracle.patch, row.oracle.unordered_unique_fields)), 'ledger-producer-fields');
      const writes = events.filter(event => event.name === 'write_ledger');
      check(writes.length > 0 && writes.every(event => appends.some(append => event.seq < append.seq && !writes.some(other => event.seq < other.seq && other.seq < append.seq))), 'ledger-write-after-each-edit');
      check(appends.length === writes.length && appends.every(event => event.args.transition_id === 'ledger-edit' && equal(callerPayload(event.args.payload), { phase: 'run', type: 'ledger-write' }) && !event.args.args.includes('--tokens')), 'ledger-write-payload');
      check(appends.every(event => event.result?.exit_code === 0 && event.result.appended.length === 1 && event.result.appended[0].data.ledger_sha256 === event.result.ledger_before_sha256 && event.result.ledger_before_sha256 === event.result.ledger_after_sha256), 'ledger-write-hash');
      check(actual.events.length === actual.initial_events.length + appends.length, 'unaccounted-ledger-events');
      check(actual.consumer.runcheck.exit_code === row.oracle.runcheck_exit_code, 'runcheck-exit');
      let audit; try { audit = JSON.parse(actual.consumer.runcheck.stdout); } catch { audit = null; }
      check(audit && equal([...(audit.undispatched ?? [])].sort(), [...row.oracle.undispatched].sort()) && (audit.invalid_outcomes ?? []).length === 0, 'runcheck-result');
      if (row.id === 'mixed-ledger') {
        let equivalent = false;
        try { equivalent = comparableLedgerSummary(actual) === comparableLedgerSummary(reference); } catch { /* Invalid source-derived header or duration fails the comparison. */ }
        check(actual.consumer.summary?.exit_code === 0 && actual.consumer.summary.persisted === actual.consumer.summary.stdout && equivalent, 'summary-consumer');
        check(!/could not read|claimed-shipped-unmerged|supersession record missing|unregistered fixture|sibling-check-unproven/.test(actual.consumer.summary?.stdout ?? ''), 'summary-reference-incomplete');
      } else check(actual.consumer.summary === null, 'summary-on-incomplete-work');
    } else {
      check(events.every(event => ['read_ledger', 'append_event', 'skip_transition'].includes(event.name)), 'unexpected-event-operation');
      const transitions = events.filter(event => ['append_event', 'skip_transition'].includes(event.name));
      check(equal(transitions.map(event => event.args.transition_id), row.oracle.transitions.map(item => item.id)), 'transition-coverage');
      for (const transition of row.oracle.transitions) {
        const matching = transitions.filter(event => event.args.transition_id === transition.id), event = matching[0];
        check(matching.length === 1, 'transition-count:' + transition.id);
        if (!event) continue;
        if (!transition.expected) { check(event.name === 'skip_transition', 'micro-action-emitted'); continue; }
        check(event.name === 'append_event' && equal(callerPayload(event.args.payload), transition.expected), 'caller-payload:' + transition.id);
        check(event.args.args?.includes('--tokens') === transition.tokens, 'token-flag:' + transition.id);
        check(event.result?.exit_code === 0 && event.result.error === null, 'event-exit:' + transition.id);
      }
      const produced = actual.events.slice(actual.initial_events.length), wanted = reference.events.slice(reference.initial_events.length);
      check(equal(produced.map(semanticEvent), wanted.map(semanticEvent)), 'persisted-event-data');
      check(equal(without(actual.ledger, ['budget']), without(actual.before, ['budget'])), 'event-changed-authority');
      check(equal(without(actual.ledger.budget, ['tokens_at_last_event']), without(actual.before.budget, ['tokens_at_last_event'])), 'event-changed-budget');
      check(equal(actual.ledger.budget?.tokens_at_last_event, reference.ledger.budget?.tokens_at_last_event), 'token-checkpoint');
    }
    return { id: row.id, kind: 'execution', pass: !problems.length, problems };
  });
  const decisions = fixture.rule_cases.map(row => {
    const matching = capture.decisions.filter(item => item.id === row.id);
    return { id: row.id, kind: 'decision', pass: matching.length === 1 && equal(normalised(matching[0].value, row.unordered_unique_fields), normalised(row.expected, row.unordered_unique_fields)) };
  });
  const problems = [];
  if (!equal(capture.cases.map(row => row.id).sort(), fixture.cases.map(row => row.id).sort())) problems.push('case-set');
  if (!equal(capture.decisions.map(row => row.id).sort(), fixture.rule_cases.map(row => row.id).sort())) problems.push('decision-set');
  if (capture.events.filter(event => event.name === 'finish').length !== 1 || capture.events.at(-1)?.name !== 'finish') problems.push('finish');
  if (capture.events.some(event => !['read_ledger', 'write_ledger', 'append_event', 'skip_transition', 'answer_rule', 'finish'].includes(event.name))) problems.push('unknown-operation');
  return { status: !capture.errors.length && !problems.length && [...cases, ...decisions].every(row => row.pass) ? 'pass' : 'fail', cases: [...cases, ...decisions], errors: capture.errors, problems };
}

const string = { type: 'string' }, tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
export const LEDGER_TOOLS = [
  tool('read_ledger', 'Read the existing command-created ledger for an independent case.', { case_id: string }),
  tool('write_ledger', 'Merge a producer-field patch into the actual ledger. Command-owned and unknown fields are refused and recorded as errors.', { case_id: string, patch: { type: 'object' } }),
  tool('append_event', 'Execute the real pinned events append CLI with the supplied JSON payload on stdin. Every invocation includes --run and --root for this case; token-tagged invocations also include --tokens and --session-id. Flag order is free; no other flags. For ledger edits use transition_id ledger-edit; for phase observations use their supplied id.', { case_id: string, transition_id: string, executable: string, args: { type: 'array', items: string }, payload: { type: 'object' } }),
  tool('skip_transition', 'Record an observation that does not warrant an event, with a brief reason.', { case_id: string, transition_id: string, reason: string }),
  tool('answer_rule', 'Record the requested structured answer to one independent policy question.', { id: string, value: { type: 'object' } }),
  tool('finish', 'Finish after all cases and questions. The harness then runs real runcheck, event validation/read and the completed-ledger summary consumer.', {}),
];

export async function runLedgerExecution({ root, commit, policyPath, fixturePath, dependencyPath, output }) {
  const binding = bindCandidateCommand(root, commit), policyBytes = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes), dependencyBytes = readFileSync(dependencyPath);
  mkdirSync(output);
  const work = mkdtempSync('/var/tmp/faff-ledger-measure-');
  try {
    const env = createLedgerEnvironment({ root: work, runtimeRoot: root, cli: join(root, binding.entry), fixture, summaryDependencies: JSON.parse(dependencyBytes) });
    const reader = createPolicyReader(policyBytes);
    const task = { instructions: 'Read the complete policy, then handle all independent producer checkpoints and questions. Read each existing ledger before work. Runs are already minted by the real CLI. Reconcile ledger observations and emit the required ledger mutation events. Handle event observations in supplied order, emitting or explicitly skipping each. Include all supplied gate/rework metadata as requested by this workload. Controlled transcripts advance between observations; their counts are measured by the CLI, never supplied by you. The harness runs real runcheck, event validation/read and a completed-ledger summary consumer after finish. No tracker, review, build, run-open/close, publication or lifecycle operations are requested. Finish after every case and question.', policy: reader.metadata, resolved_executable: join(root, binding.entry), tools: [POLICY_TOOL, ...LEDGER_TOOLS], cases: env.publicCases, questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
    write(join(output, 'task.json'), task);
    write(join(output, 'manifest.json'), { schema: 1, kind: 'ledger-event-producer-execution', binding, fixture_sha256: sha256(fixtureBytes), dependencies_sha256: sha256(dependencyBytes), policy_sha256: sha256(policyBytes), task_sha256: sha256(readFileSync(join(output, 'task.json'))), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
    write(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...LEDGER_TOOLS.map(row => row.name)]), maxRequests: 180, timeoutMs: 900000 });
    const capture = env.capture(), grade = gradeLedgerExecution(capture, env.expected, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture); write(join(output, 'expected.json'), env.expected);
    const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, dependencyPath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: ledger-execution.mjs ROOT COMMIT POLICY FIXTURE DEPENDENCIES NEW_OUTPUT');
  const result = await runLedgerExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), dependencyPath: resolve(dependencyPath), output: resolve(output) });
  console.log(JSON.stringify({ status: result.status, cases: result.grade.cases }));
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
