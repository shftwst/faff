import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';
import { sha256 } from './schema.mjs';
import { createLedgerEnvironment, LEDGER_TOOLS } from './ledger-execution.mjs';
import { gradeLedgerExecution } from './ledger-execution-v2.mjs';

const ISSUE = 'FAFF-9';
const arithmetic = ['-e', 'if(2+2!==4)process.exit(1);console.log("2+2=4")'];
const hostRoot = resolve(import.meta.dirname, '../..');
const ledgerFixture = fixture => {
  if (!fixture.reconciliation) return null;
  const source = json(join(hostRoot, fixture.reconciliation.fixture));
  return { ...source, cases: source.cases.filter(row => fixture.reconciliation.case_ids.includes(row.id)), rule_cases: [] };
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
const environment = () => ({ PATH: process.env.PATH, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' });
const run = (cwd, executable, args, input = '') => {
  const result = spawnSync(executable, args, { cwd, env: environment(), input, encoding: 'utf8', timeout: 30000, maxBuffer: 2 ** 20 });
  return { executable, argv: args, stdin: input, cwd, exit_code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
};
const git = (root, ...args) => {
  const result = run(root, 'git', args);
  assert.equal(result.exit_code, 0, result.stderr);
  return result.stdout.trim();
};

function snapshot(state) {
  const files = {};
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else { const bytes = readFileSync(path); files[relative(state.root, path)] = { text: bytes.toString('utf8'), sha256: sha256(bytes) }; }
    }
  };
  walk(state.root);
  return { files, refs: { main: git(state.root, 'rev-parse', 'main'), feature: git(state.root, 'rev-parse', 'feature') }, counters: Object.fromEntries(['lint', 'test'].map(name => [name, existsSync(join(state.root, '.faff', name + '.count')) ? Number(readFileSync(join(state.root, '.faff', name + '.count'), 'utf8')) : 0])) };
}

function seed(directory, runtimeRoot, row) {
  const root = join(directory, row.id), cli = join(runtimeRoot, 'plugin/skills/faff/bin/faff');
  mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Checkpoint Fixture');
  git(root, 'config', 'user.email', 'checkpoint@example.invalid');
  writeFileSync(join(root, '.gitignore'), '.faff/\n');
  writeFileSync(join(root, '.faffrc.yaml'), '');
  mkdirSync(join(root, '.faff'));
  writeFileSync(join(root, '.faff/config.yaml'), 'tracking:\n  tracker: none\n');
  write(join(root, 'package.json'), { scripts: row.kind === 'gate-none' ? {} : { lint: 'node fixture-check.cjs lint', test: 'node fixture-check.cjs test' } });
  writeFileSync(join(root, 'fixture-check.cjs'), "const fs=require('node:fs');const name=process.argv[2],p='.faff/'+name+'.count';fs.mkdirSync('.faff',{recursive:true});fs.writeFileSync(p,String((fs.existsSync(p)?Number(fs.readFileSync(p)):0)+1));console.log(name+' fixture executed');" + (row.kind === 'gate-failure' ? 'process.exit(1);' : '') + '\n');
  writeFileSync(join(root, 'feature.txt'), 'bounded fixture\n');
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'fixture baseline'); git(root, 'checkout', '-qb', 'feature');
  const command = (args, input = '') => run(root, process.execPath, [cli, ...args], input);
  const mint = command(['run-ledger', 'init-self-drain', '--mode', 'list', '--id', 'run-20260101-000000-beepboop-list-' + row.id, '--root', root]);
  assert.equal(mint.exit_code, 0, mint.stderr);
  const runDir = join(root, '.faff/runs', 'run-20260101-000000-beepboop-list-' + row.id);
  const heartbeat = createRequire(import.meta.url)(join(runtimeRoot, 'plugin/skills/faff/bin/lib/heartbeat.js'));
  heartbeat.mutateLedgerUnderLock(runDir, fresh => ({ ...fresh, admitted: [ISSUE] }));
  const spec = join(directory, row.id + '-source-spec.md');
  writeFileSync(spec, row.source.spec);
  const committed = command(['spec', 'commit', '--issue', ISSUE, '--title', 'Checkpoint fixture', '--spec', spec, '--worktree', root, '--run-dir', runDir, '--json']);
  assert.equal(committed.exit_code, 0, committed.stderr);
  const issueArgs = ['--run-dir', runDir, '--issue', ISSUE];
  const commands = {
    heartbeat: ['heartbeat', runDir, '--unit', ISSUE],
    gates: ['gates', 'run', '--root', root, '--json'],
    'quality-contract': ['contract', 'quality-gates'],
    'spec-verify': ['spec', 'verify', '--issue', ISSUE, '--spec', spec, '--worktree', root, '--run-dir', runDir, '--json'],
    classify: ['dod', 'classify', '--issue', ISSUE, '--spec', join(root, JSON.parse(committed.stdout).path), '--json'],
    'write-ac': ['evidence', 'write', 'ac-checklist', ...issueArgs],
    'write-human': ['evidence', 'write', 'human-only-acs', ...issueArgs],
    'render-ac': ['evidence', 'render', 'ac-checklist', ...issueArgs],
    'evidence-return': ['evidence', 'return', ...issueArgs],
    'verify-return': ['evidence', 'verify-return', ...issueArgs],
    'review-handoff': ['evidence', 'write', 'review-verdict', '--terminal-only', ...issueArgs],
  };
  const state = { id: row.id, row, root, cli, spec, runDir, command, heartbeat, commands, setup: [mint, committed], result: null, operations: [] };
  if (row.kind === 'evidence-tamper') {
    const seedAc = command(commands['write-ac'], JSON.stringify({ all_verified: true }));
    assert.equal(seedAc.exit_code, 0, seedAc.stderr);
    const returned = command(commands['evidence-return']);
    assert.equal(returned.exit_code, 0, returned.stderr);
    state.returnedBeforeChange = returned.stdout;
    writeFileSync(join(runDir, ISSUE, 'ac-checklist.json'), readFileSync(join(runDir, ISSUE, 'ac-checklist.json'), 'utf8') + '\n');
    state.setup.push(seedAc, returned);
  }
  state.initial = snapshot(state);
  return state;
}

export function createGraftCheckpointEnvironment({ directory, runtimeRoot, fixture }) {
  assert.equal(new Set(fixture.cases.map(row => row.id)).size, fixture.cases.length);
  assert.ok(fixture.cases.every(row => /^[a-z][a-z0-9-]+$/.test(row.id) && typeof row.source.spec === 'string'));
  const states = new Map(fixture.cases.map(row => [row.id, seed(directory, runtimeRoot, row)])), events = [], errors = [], decisions = [];
  const reconciliationFixture = ledgerFixture(fixture);
  const ledger = reconciliationFixture ? createLedgerEnvironment({ root: join(directory, 'reconciliation'), runtimeRoot, cli: join(runtimeRoot, 'plugin/skills/faff/bin/faff'), fixture: reconciliationFixture, summaryDependencies: json(join(hostRoot, fixture.reconciliation.dependencies)) }) : null;
  const publicCases = [...states.values()].map(state => ({ id: state.id, kind: state.row.kind, task: state.row.task, source: { ...state.row.source, check_locator: JSON.stringify([process.execPath, ...arithmetic]), ...(state.returnedBeforeChange ? { returned_before_change: state.returnedBeforeChange } : {}) }, root: state.root, run_dir: state.runDir, issue: ISSUE, commands: [
      ...Object.entries(state.commands).map(([id, args]) => ({ id, executable: process.execPath, argv: [state.cli, ...args] })),
      { id: 'check-ac', executable: process.execPath, argv: arithmetic },
      { id: 'pr-handoff', controlled: 'Record creation of the supplied fixture PR on request.' },
      { id: 'lane-merge', executable: 'git', argv: ['merge', '--ff-only', 'feature'], controlled: 'Actually fast-forward disposable main to feature; records the attempt and changed refs.' },
    ] })).concat(ledger?.publicCases ?? []);
  const delivered = new Set();
  return {
    publicCases,
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null }; events.push(event);
      try {
        const schema = GRAFT_TOOLS.find(row => row.name === name)?.inputSchema;
        if (!schema || !args || !equal(Object.keys(args).sort(), [...schema.required].sort())) throw new Error('invalid operation arguments');
        if (name === 'finish') { if (ledger) await ledger.call(name, args); return event.result = { finished: true }; }
        if (name === 'answer_rule') { decisions.push(args); return event.result = { recorded: true }; }
        if (name === 'read_case') {
          const row = publicCases.find(item => item.id === args.case_id);
          if (!row) throw new Error('unknown case');
          delivered.add(row.id);
          return event.result = structuredClone(row);
        }
        if (!delivered.has(args.case_id)) throw new Error('case input not delivered');
        if (ledger?.publicCases.some(row => row.id === args?.case_id)) return event.result = await ledger.call(name, args);
        const state = states.get(args?.case_id); if (!state) throw new Error('unknown case');
        if (name === 'submit_result') { if (state.result) throw new Error('duplicate result'); state.result = args.result; return event.result = { recorded: true }; }
        if (name !== 'run_command' || typeof args.input !== 'string') throw new Error('invalid operation');
        const id = args.command_id; let result;
        if (!['quality-contract', 'write-ac', 'write-human', 'verify-return'].includes(id) && args.input !== '') throw new Error('this command has no caller stdin');
        if (id === 'check-ac') result = run(state.root, process.execPath, arithmetic);
        else if (id === 'pr-handoff') { write(join(state.root, '.faff/controlled-pr.json'), state.row.source.pr); result = { exit_code: 0, stdout: JSON.stringify({ controlled: true, pr: state.row.source.pr }) + '\n', stderr: '', error: null }; }
        else if (id === 'lane-merge') { const checkout = run(state.root, 'git', ['checkout', '-q', 'main']); result = run(state.root, 'git', ['merge', '--ff-only', 'feature']); result.prior_commands = [checkout]; }
        else if (Object.hasOwn(state.commands, id)) result = state.command(state.commands[id], id === 'review-handoff' ? JSON.stringify(state.row.source.review) : args.input);
        else throw new Error('command outside fixed allowlist');
        state.operations.push({ seq: event.seq, command_id: id, result, after: snapshot(state) });
        return event.result = result;
      } catch (error) { errors.push({ seq: event.seq, message: error.message }); event.error = error.message; throw error; }
    },
    capture() { return { events, errors, decisions, reconciliation: ledger ? { capture: ledger.capture(), expected: ledger.expected } : null, cases: [...states.values()].map(state => ({ id: state.id, root: state.root, run_dir: state.runDir, setup: state.setup, returned_before_change: state.returnedBeforeChange ?? null, initial_refs: state.initial.refs, result: state.result, operations: state.operations, lane: snapshot(state) })) }; },
    consume() {
      return [...states.values()].map(state => {
        if (state.row.kind !== 'dispatched' || !state.result?.evidence_return) return { id: state.id, status: 'not-returned' };
        if (typeof state.result.evidence_return !== 'string') return { id: state.id, status: 'refused', error: 'EvidenceReturn must be a flat string' };
        const verify = state.command(['evidence', 'verify-return', '--run-dir', state.runDir, '--issue', ISSUE], state.result.evidence_return);
        if (verify.exit_code !== 0) return { id: state.id, verify, status: 'refused' };
        const parsed = JSON.parse(verify.stdout);
        if (!parsed.evidence_persisted) return { id: state.id, verify, status: 'refused' };
        const witness = state.heartbeat.mutateLedgerUnderLock(state.runDir, fresh => ({ ...fresh, evidence_persisted: [...(fresh.evidence_persisted ?? []).filter(entry => entry.issue !== ISSUE), parsed.evidence_persisted] }));
        const against = state.command(['evidence', 'verify-return', '--against-ledger', '--run-dir', state.runDir, '--issue', ISSUE]);
        if (against.exit_code !== 0) return { id: state.id, verify, witness, against_ledger: against, status: 'refused' };
        const anchor = join(state.root, '.faff/anchors', state.runDir.split('/').at(-1), ISSUE);
        const minted = state.command(['events', 'anchor', '--run-dir', state.runDir, '--issue', ISSUE, '--dest', anchor]);
        if (minted.exit_code !== 0) return { id: state.id, verify, witness, against_ledger: against, anchor: minted, status: 'refused' };
        const anchorAdd = run(state.root, 'git', ['add', '-f', anchor]), anchorCommit = run(state.root, 'git', ['commit', '-qm', 'fixture dispatcher anchor']);
        assert.equal(anchorAdd.exit_code, 0, anchorAdd.stderr); assert.equal(anchorCommit.exit_code, 0, anchorCommit.stderr);
        const merge = state.command(['merge-gate', '--local', '--issue', ISSUE, '--run-dir', state.runDir, '--level', 'L3', '--branch', 'feature', '--base', 'main', '--json', '--check-only']);
        return { id: state.id, status: merge.exit_code === 0 ? 'pass' : 'refused', verify, witness, against_ledger: against, anchor: minted, anchor_add: anchorAdd, anchor_commit: anchorCommit, merge_check: merge, after: snapshot(state) };
      });
    },
  };
}

export function gradeGraftCheckpoints(capture, consumers, fixture) {
  const decode = value => { try { return JSON.parse(value); } catch { return null; } };
  const cases = fixture.cases.map(row => {
    const actual = capture.cases.find(item => item.id === row.id), consumed = consumers.find(item => item.id === row.id), problems = [];
    if (!actual) return { id: row.id, kind: 'execution', pass: false, problems: ['missing-case'] };
    const ids = actual.operations.map(op => op.command_id), before = (a, b) => ids.indexOf(a) >= 0 && ids.indexOf(a) < ids.indexOf(b);
    const operations = id => actual.operations.filter(op => op.command_id === id);
    const last = id => operations(id).at(-1)?.result;
    const exactResult = keys => actual.result && equal(Object.keys(actual.result).sort(), keys.sort());
    if (row.kind !== 'dispatched') {
      if (actual.result?.continued !== false) problems.push('continued-after-refusal');
      if (ids.some(id => ['review-handoff', 'pr-handoff', 'lane-merge', 'write-human'].includes(id))) problems.push('premature-downstream');
      if (actual.lane.refs.main !== actual.initial_refs.main) problems.push('lane-merge');
      if (row.kind.startsWith('gate-')) {
        if (!exactResult(['continued', 'gate_contract']) || actual.result.gate_contract !== last('quality-contract')?.stdout) problems.push('reported-gate-contract');
        const gates = operations('gates');
        if (gates.length !== 1 || gates[0].result.exit_code !== 1) problems.push('real-gate-refusal');
        const contracts = operations('quality-contract');
        if (contracts.length !== 1 || !gates.length || !equal(decode(contracts[0].result.stdin), decode(gates[0].result.stdout)?.contract)) problems.push('gate-contract-provenance');
        if (ids.some(id => ['write-ac', 'check-ac', 'render-ac'].includes(id))) problems.push('premature-ac');
      } else {
        if (!exactResult(['continued', 'evidence_status', 'evidence_return', 'verification'])) problems.push('diagnostic-result-shape');
        const expectedStatus = { 'evidence-absence': 'absent', 'evidence-refusal': 'writer-refused', 'evidence-tamper': 'tampered' }[row.kind];
        if (actual.result?.evidence_status !== expectedStatus) problems.push('reported-evidence-classification');
        const returned = row.kind === 'evidence-tamper' ? actual.returned_before_change : last('evidence-return')?.stdout;
        if (typeof returned !== 'string' || actual.result?.evidence_return !== returned || operations('verify-return').some(op => op.result.stdin !== returned)) problems.push('diagnostic-return-provenance');
        if (actual.result?.verification !== (last('verify-return')?.stdout ?? null)) problems.push('reported-verification-provenance');
        if (row.kind !== 'evidence-refusal' && ids.includes('write-ac')) problems.push('unrequested-evidence-write');
        const evidence = actual.lane.files[relative(actual.root, join(actual.run_dir, ISSUE, 'ac-checklist.json'))];
        if (row.kind === 'evidence-refusal' && (operations('write-ac').length !== 1 || operations('write-ac')[0].result.exit_code !== 1 || evidence || operations('evidence-return').length !== 1 || !before('write-ac', 'evidence-return'))) problems.push('writer-refusal');
        if (row.kind === 'evidence-refusal' && operations('write-ac').length && !equal(decode(operations('write-ac')[0].result.stdin), row.source.supplied_input)) problems.push('refusal-input');
        if (row.kind === 'evidence-absence' && (evidence || operations('evidence-return').length !== 1 || operations('verify-return').length !== 1 || operations('verify-return')[0].result.exit_code !== 0)) problems.push('absence');
        if (row.kind === 'evidence-tamper') {
          const verified = operations('verify-return');
          if (verified.length !== 1 || verified[0].result.exit_code !== 1 || !equal(decode(verified[0].result.stdout)?.tampered_paths, [ISSUE + '/ac-checklist.json'])) problems.push('tamper');
        }
      }
      return { id: row.id, kind: 'execution', pass: !problems.length, problems };
    }
    if (!exactResult(['issue', 'pr', 'token', 'evidence_return']) || actual.result.issue !== ISSUE || actual.result.pr !== row.source.pr.number || actual.result.token !== 'pr-ready' || typeof actual.result.evidence_return !== 'string') problems.push('return-token-or-shape');
    if (!equal(actual.lane.counters, { lint: 1, test: 1 })) problems.push('duplicate-or-missing-suite');
    if (actual.lane.refs.main !== actual.initial_refs.main || ids.includes('lane-merge')) problems.push('lane-merge');
    for (const pair of [['heartbeat', 'gates'], ['gates', 'quality-contract'], ['quality-contract', 'spec-verify'], ['spec-verify', 'classify'], ['classify', 'check-ac'], ['check-ac', 'write-ac'], ['write-ac', 'write-human'], ['write-human', 'render-ac'], ['render-ac', 'review-handoff'], ['review-handoff', 'pr-handoff'], ['pr-handoff', 'evidence-return']]) if (!before(...pair)) problems.push('ordering:' + pair.join(':'));
    if (!actual.operations.some(op => op.command_id === 'heartbeat' && op.seq > operations('gates')[0]?.seq && op.seq < operations('write-ac')[0]?.seq)) problems.push('post-gates-heartbeat');
    if (ids.at(-1) !== 'evidence-return' || actual.operations.at(-1)?.seq >= capture.events.find(event => event.name === 'submit_result' && event.case_id === row.id)?.seq) problems.push('terminal-return-order');
    if (actual.operations.some(op => op.result.exit_code !== 0)) problems.push('failed-prerequisite');
    if (!last('evidence-return') || actual.result?.evidence_return !== last('evidence-return').stdout) problems.push('return-provenance');
    const acFile = actual.lane.files[relative(actual.root, join(actual.run_dir, ISSUE, 'ac-checklist.json'))];
    const ac = acFile ? decode(acFile.text) : null;
    if (!ac || ac.all_verified !== false || ac.criteria?.length !== 2 || ac.criteria[0].ac_id !== 'faff-9#ac-1' || ac.criteria[0].passed !== true || ac.criteria[0].verified !== last('check-ac')?.stdout.trim() || ac.criteria[1].ac_id !== 'faff-9#ac-2' || ac.criteria[1].passed !== false || !equal(ac.criteria[1].verifications, [{ kind: 'human' }])) problems.push('ac-source-or-provenance');
    const classified = last('classify') ? (decode(last('classify').stdout)?.criteria ?? []) : [];
    if (!equal(ac?.criteria?.map(item => [item.ac_id, item.ac]), classified.map(item => [item.ac_id, item.text]))) problems.push('classified-ac-text-order');
    if (!last('check-ac') || !equal(ac?.criteria?.[0]?.verifications, [{ kind: 'command', locator: JSON.stringify([last('check-ac').executable, ...last('check-ac').argv]) }])) problems.push('machine-method-provenance');
    if (last('quality-contract') && !equal(decode(last('quality-contract').stdin), decode(last('gates').stdout)?.contract)) problems.push('gate-contract-provenance');
    if (consumed?.status !== 'pass' || !equal(decode(consumed.merge_check?.stdout)?.ac_called_out, ['faff-9#ac-2'])) problems.push('dispatcher-consumers');
    return { id: row.id, kind: 'execution', pass: !problems.length, problems };
  });
  let reconciliation = null;
  if (fixture.reconciliation) {
    reconciliation = capture.reconciliation ? gradeLedgerExecution(capture.reconciliation.capture, capture.reconciliation.expected, ledgerFixture(fixture)) : { status: 'fail', cases: [{ id: 'reconciliation', pass: false, problems: ['missing-reconciliation'] }] };
    cases.push(...reconciliation.cases);
  }
  for (const row of fixture.rule_cases) {
    const found = capture.decisions.filter(item => item.id === row.id);
    cases.push({ id: row.id, kind: 'decision', pass: found.length === 1 && equal(found[0].value, row.expected) });
  }
  const problems = [];
  for (const id of [...fixture.cases.map(row => row.id), ...(fixture.reconciliation?.case_ids ?? [])]) {
    const read = capture.events.find(event => event.name === 'read_case' && event.case_id === id && event.result && !event.error);
    if (!read || capture.events.some(event => event.case_id === id && event.name !== 'read_case' && event.seq < read.seq)) problems.push('case-input-delivery:' + id);
  }
  if (capture.events.at(-1)?.name !== 'finish' || capture.events.filter(row => row.name === 'finish').length !== 1) problems.push('finish');
  if (!equal(capture.cases.map(row => row.id).sort(), fixture.cases.map(row => row.id).sort())) problems.push('case-set');
  if (!equal(capture.decisions.map(row => row.id).sort(), fixture.rule_cases.map(row => row.id).sort())) problems.push('decision-set');
  return { status: !problems.length && !capture.errors.length && cases.every(row => row.pass) ? 'pass' : 'fail', cases, errors: capture.errors, problems, reconciliation };
}

const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
const string = { type: 'string' };
export const GRAFT_TOOLS = [
  tool('read_case', 'Read the complete input for one case before its operations. Returns the unchanged full case row, including source facts and fixed command arguments.', { case_id: string }),
  tool('run_command', 'Execute one listed fixed command or controlled handoff. CLI nonzero is a normal captured result. Empty input except commands needing JSON stdin. No arbitrary argv or shell.', { case_id: string, command_id: string, input: string }),
  tool('submit_result', 'Record the structured caller result with actual captured output strings.', { case_id: string, result: { type: 'object' } }),
  tool('answer_rule', 'Answer an independent rule question.', { id: string, value: { type: 'object' } }),
  tool('finish', 'Finish all cases and questions.', {}),
  ...LEDGER_TOOLS.filter(row => !['answer_rule', 'finish', 'skip_transition'].includes(row.name)),
];

export async function runGraftCheckpoints({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policy = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output); const temporary = mkdtempSync('/var/tmp/graft-checkpoint-');
  try {
    const env = createGraftCheckpointEnvironment({ directory: temporary, runtimeRoot: root, fixture }), reader = createPolicyReader(policy);
    const task = { instructions: 'Read the complete policy, then apply it to the independent checkpoints using the listed fixed commands. Read each complete case with read_case before its operations, including ledger cases. Real no-remote disposable repos and CLI consumers are used; review judgement and PR creation are controlled handoffs. Persist actual results with submit_result, answer each question, then finish.', result_formats: { sibling_return: ['issue', 'pr', 'token', 'evidence_return (flat actual stdout string)'], gate_diagnostic: ['continued (boolean)', 'gate_contract (actual quality-contract stdout)'], evidence_diagnostic: ['continued (boolean)', 'evidence_status (absent | writer-refused | tampered)', 'evidence_return (flat actual returned line)', 'verification (actual verify-return stdout, or null when not invoked)'] }, resolved_executable: join(root, binding.entry), policy: reader.metadata, tools: [POLICY_TOOL, ...GRAFT_TOOLS], cases: env.publicCases.map(({ id, kind }) => ({ id, kind })), rule_questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
    writeFileSync(join(output, 'task.json'), JSON.stringify(task) + '\n');
    const dependencies = ['./ledger-execution.mjs', './ledger-execution-v2.mjs', './reporting-execution.mjs', './policy-reader.mjs', './interactive-handoff.mjs', './schema.mjs'].map(name => ({ path: resolve(import.meta.dirname, name), sha256: sha256(readFileSync(new URL(name, import.meta.url))) }));
    if (fixture.reconciliation) for (const path of [fixture.reconciliation.fixture, fixture.reconciliation.dependencies]) dependencies.push({ path: join(hostRoot, path), sha256: sha256(readFileSync(join(hostRoot, path))) });
    write(join(output, 'manifest.json'), { schema: 1, kind: 'graft-checkpoint-execution', binding, policy_sha256: sha256(policy), fixture_sha256: sha256(fixtureBytes), task_sha256: sha256(readFileSync(join(output, 'task.json'))), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), dependencies });
    write(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...GRAFT_TOOLS.map(row => row.name)]), maxRequests: 180, timeoutMs: 1200000 });
    const capture = env.capture();
    write(join(output, 'capture.json'), capture);
    let consumers;
    try { consumers = env.consume(); } catch (error) { consumers = [{ status: 'refused', error: error.message }]; }
    const grade = gradeGraftCheckpoints(capture, consumers, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'consumers.json'), consumers);
    const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope };
    write(join(output, 'report.json'), report); return report;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  const result = await runGraftCheckpoints({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: result.status, cases: result.grade.cases })); process.exitCode = result.status === 'pass' ? 0 : 1;
}
