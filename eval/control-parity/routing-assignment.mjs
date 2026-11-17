import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const exact = (args, keys) => args && typeof args === 'object' && !Array.isArray(args) && Object.keys(args).sort().join(',') === [...keys].sort().join(',');
function cli(root, directory, args, input) {
  const r = spawnSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), ...args], { cwd: directory, encoding: 'utf8', input: input === undefined ? undefined : JSON.stringify(input), timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
  let value = null;
  try { value = JSON.parse(r.stdout); } catch { /* Keep non-JSON failures visible to the grader. */ }
  return { args, exit_code: r.status, stdout: r.stdout, stderr: r.stderr, value };
}

export function createRoutingEnvironment({ directory, fixture, root }) {
  mkdirSync(join(directory, 'specs')); mkdirSync(join(directory, 'artifacts'));
  for (const c of fixture.cases) writeFileSync(join(directory, 'specs', c.id + '.md'), c.input.spec, { flag: 'wx' });
  const events = [], errors = [], reads = new Set(), scans = new Map(), assignments = new Map(), validations = new Map(), answers = new Map();
  return {
    async call(name, args) {
      const event = { seq: events.length + 1, name, args }; events.push(event);
      try {
        if (name === 'finish' && exact(args, [])) return event.result = { finished: true };
        if (name === 'describe_contract' && exact(args, [])) {
          const r = cli(root, directory, ['contract', 'automation-routing', '--describe']);
          if (r.exit_code !== 0) throw new Error('contract description unavailable');
          return event.result = { text: r.stdout };
        }
        const c = fixture.cases.find(c => c.id === args?.case_id);
        if (name === 'read_inputs' && c && exact(args, ['case_id'])) {
          reads.add(c.id);
          return event.result = { ...c.input, spec_path: join(directory, 'specs', c.id + '.md') };
        }
        if (name === 'scan_punts' && c && reads.has(c.id) && exact(args, ['case_id'])) {
          const r = cli(root, directory, ['punt-scan', join(directory, 'specs', c.id + '.md')]);
          scans.set(c.id, r); return event.result = r;
        }
        if (name === 'assign' && c && reads.has(c.id) && !assignments.has(c.id) && exact(args, ['case_id', 'extraction'])) {
          const result = cli(root, directory, ['contract', 'automation-routing'], args.extraction);
          const path = join(directory, 'artifacts', c.id + '.json');
          writeFileSync(path, result.stdout, { flag: 'wx' });
          assignments.set(c.id, { id: c.id, extraction: args.extraction, result, sha256: sha256(readFileSync(path)) });
          return event.result = result;
        }
        const v = fixture.validation_cases.find(c => c.id === args?.case_id);
        if (name === 'validate_supplied' && v && !validations.has(v.id) && exact(args, ['case_id'])) {
          const result = cli(root, directory, ['contract', 'automation-routing'], v.input);
          validations.set(v.id, { id: v.id, result }); return event.result = result;
        }
        if (name === 'answer_rule' && exact(args, ['case_id', 'value']) && fixture.rule_cases.some(c => c.id === args.case_id) && !answers.has(args.case_id)) {
          answers.set(args.case_id, args.value); return event.result = { recorded: true };
        }
        throw new Error('invalid tool, extra input, write, premature or duplicate assignment');
      } catch (error) { event.error = error.message; errors.push({ seq: event.seq, message: error.message }); throw error; }
    },
    capture() {
      return { events, errors, reads: [...reads], scans: [...scans].map(([id, result]) => ({ id, result })), assignments: [...assignments.values()].map(row => ({ ...row, persisted_sha256: sha256(readFileSync(join(directory, 'artifacts', row.id + '.json'))) })), validations: [...validations.values()], rule_answers: [...answers].map(([id, value]) => ({ id, value })) };
    },
  };
}

export function gradeRoutingCapture(capture, fixture) {
  const cases = fixture.cases.map(c => {
    const rows = capture.assignments.filter(row => row.id === c.id), row = rows[0], scan = capture.scans.find(row => row.id === c.id), problems = [];
    if (rows.length !== 1 || !capture.reads.includes(c.id)) problems.push('missing-read-or-assignment');
    if (!row || !exact(row.extraction, ['verdict', 'root_cause']) || !Object.entries(c.expected).every(([key, value]) => isDeepStrictEqual(row.extraction[key], value))) problems.push('assignment');
    if (row?.result.exit_code !== 0 || row?.result.value?.conformant !== true) problems.push('contract-consumption');
    if (row && (row.persisted_sha256 !== row.sha256 || row.sha256 !== sha256(row.result.stdout))) problems.push('canonical-artifact');
    if (c.expected_blocking_punts !== undefined && (scan?.result.exit_code !== 0 || scan.result.value?.blocking_open_count !== c.expected_blocking_punts)) problems.push('required-real-punt-scan');
    if (c.expected_blocking_punts !== undefined) {
      const scanIndex = capture.events.findIndex(e => e.name === 'scan_punts' && e.args.case_id === c.id);
      const assignIndex = capture.events.findIndex(e => e.name === 'assign' && e.args.case_id === c.id);
      if (scanIndex < 0 || assignIndex <= scanIndex) problems.push('punt-scan-before-assignment');
    }
    return { id: c.id, kind: 'routing-assignment', pass: !problems.length, problems, extraction: row?.extraction ?? null, consumer_results: row ? [{ id: 'automation-routing', pass: row.result.exit_code === 0 && row.result.value?.conformant === true, value: row.result.value }] : [] };
  });
  for (const c of fixture.validation_cases) {
    const rows = capture.validations.filter(row => row.id === c.id), r = rows[0]?.result;
    const pass = rows.length === 1 && r.exit_code === c.expected_exit && (c.expected_root_cause === undefined || r.value?.root_cause === c.expected_root_cause);
    cases.push({ id: c.id, kind: 'validation', pass, problems: pass ? [] : ['validation-direction'], exit_code: r?.exit_code ?? null });
  }
  for (const c of fixture.rule_cases) {
    const rows = capture.rule_answers.filter(row => row.id === c.id), pass = rows.length === 1 && isDeepStrictEqual(rows[0].value, c.expected);
    cases.push({ id: c.id, kind: 'decision', pass, problems: pass ? [] : ['rule-answer'], value: rows[0]?.value ?? null });
  }
  return { status: !capture.errors.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}
const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
const string = { type: 'string' };
export const ROUTING_TOOLS = [
  tool('read_inputs', 'Read the complete caller snapshot for one Todo issue with a discoverable spec.', { case_id: string }),
  tool('scan_punts', 'Run the real faff punt-scan command over the supplied spec. It returns structured eligibility.', { case_id: string }),
  tool('describe_contract', 'Read the real routing contract description.', {}),
  tool('assign', 'Submit the assignment extraction once. The real automation-routing CLI validates it and its stdout is persisted verbatim for the caller.', { case_id: string, extraction: { type: 'object' } }),
  tool('validate_supplied', 'Run the real routing validator on the separately supplied extraction, without repairing it or manufacturing contract data.', { case_id: string }),
  tool('answer_rule', 'Answer a separate bounded policy question.', { case_id: string, value: {} }),
  tool('write_tracker', 'Attempt a tracker write. This decoy records and refuses it.', { case_id: string }),
  tool('finish', 'Finish after all assignments, validations and questions.', {}),
];
export async function runRoutingAssignment({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policy = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const reader = createPolicyReader(policy), env = createRoutingEnvironment({ directory: output, fixture, root });
  const task = { instructions: 'Read the complete fixed context and routing policy using read_policy. Assign each independent issue from its complete caller snapshot through read_inputs. Use scan_punts for canonical eligibility; the actual CLI is behind that port. Submit only the extraction through assign. The port persists the real contract stdout for the caller; do not invent conformance data. Run each separate supplied-validation request unchanged through validate_supplied. Do not write the tracker, resolve, park, build or recompute the supplied diagnostics. Display prose is outside this comparison and remains unchanged. Answer the separate policy questions and finish.', policy: reader.metadata, tools: [POLICY_TOOL, ...ROUTING_TOOLS], cases: fixture.cases.map(({ id, request }) => ({ id, request })), validation_cases: fixture.validation_cases.map(({ id, input }) => ({ id, input })), rule_questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'routing-assignment-consumption', binding, policy_sha256: sha256(policy), fixture_sha256: sha256(fixtureBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...ROUTING_TOOLS.map(t => t.name)]), maxRequests: 200, timeoutMs: 900000 });
  const capture = env.capture(), grade = gradeRoutingCapture(capture, fixture); assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: routing-assignment.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runRoutingAssignment({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
