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
export function consumePrdArtifact(root, text, cwd) {
  const blocks = [...text.matchAll(/^```faff-contract:prd-readiness\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
  if (blocks.length !== 1 || text.slice(blocks[0].index + blocks[0][0].length).trim()) return { pass: false, problem: 'one-contract-block-must-be-last' };
  let value;
  try { value = JSON.parse(blocks[0][1]); } catch { return { pass: false, problem: 'invalid-contract-json' }; }
  const args = ['contract', 'prd-readiness'];
  const result = spawnSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), ...args], { cwd, encoding: 'utf8', input: JSON.stringify(value), timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
  let output = null;
  try { output = JSON.parse(result.stdout); } catch { /* Capture a malformed validator response as a failed consumption. */ }
  return { pass: result.status === 0 && output?.conformant === true, args, exit_code: result.status, stdout: result.stdout, stderr: result.stderr, producer_value: value, value: output };
}

export function createPrdEnvironment({ directory, fixture, root }) {
  mkdirSync(join(directory, 'prds'));
  mkdirSync(join(directory, 'artifacts'));
  for (const c of fixture.cases) writeFileSync(join(directory, 'prds', c.id + '.md'), c.prd, { flag: 'wx' });
  const events = [], errors = [], reads = new Set(), outputs = new Map(), answers = new Map();
  return {
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null }; events.push(event);
      try {
        if (name === 'finish' && exact(args, [])) return event.result = { finished: true };
        if (name === 'describe_contract' && exact(args, [])) {
          const result = spawnSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), 'contract', 'prd-readiness', '--describe'], { cwd: directory, encoding: 'utf8', timeout: 15000 });
          if (result.status !== 0) throw new Error('contract description unavailable');
          return event.result = { text: result.stdout };
        }
        if (name === 'read_prd' && exact(args, ['case_id']) && fixture.cases.some(c => c.id === args.case_id)) {
          reads.add(args.case_id);
          return event.result = { path: join(directory, 'prds', args.case_id + '.md'), text: readFileSync(join(directory, 'prds', args.case_id + '.md'), 'utf8') };
        }
        if (name === 'submit_verdict' && exact(args, ['case_id', 'text']) && fixture.cases.some(c => c.id === args.case_id) && reads.has(args.case_id) && !outputs.has(args.case_id) && typeof args.text === 'string') {
          const path = join(directory, 'artifacts', args.case_id + '.md');
          writeFileSync(path, args.text, { flag: 'wx' });
          const consumer = consumePrdArtifact(root, args.text, directory);
          outputs.set(args.case_id, { id: args.case_id, text: args.text, consumer });
          return event.result = { persisted: true, sha256: sha256(readFileSync(path)), consumed_by: 'faff contract prd-readiness' };
        }
        if (name === 'answer_rule' && exact(args, ['case_id', 'value']) && fixture.rule_cases.some(c => c.id === args.case_id) && !answers.has(args.case_id)) {
          answers.set(args.case_id, args.value); return event.result = { recorded: true };
        }
        throw new Error('invalid tool, extra data source, write, premature submission or duplicate');
      } catch (error) { event.error = error.message; errors.push({ seq: event.seq, message: error.message }); throw error; }
    },
    capture() { return { events, errors, reads: [...reads], outputs: [...outputs.values()].map(o => ({ ...o, persisted_sha256: sha256(readFileSync(join(directory, 'artifacts', o.id + '.md'))) })), rule_answers: [...answers].map(([id, value]) => ({ id, value })) }; },
  };
}

export function gradePrdCapture(capture, fixture) {
  const cases = fixture.cases.map(c => {
    const rows = capture.outputs.filter(o => o.id === c.id), row = rows[0], problems = [];
    if (rows.length !== 1 || !capture.reads.includes(c.id)) problems.push('missing-prd-read-or-verdict');
    if (row && row.persisted_sha256 !== sha256(row.text)) problems.push('persisted-artifact');
    if (!row?.consumer.pass) problems.push('contract-consumption');
    if (!row || !Object.entries(c.expected).every(([key, value]) => isDeepStrictEqual(row.consumer.producer_value?.[key], value))) problems.push('judgement');
    return { id: c.id, kind: 'producer-artifact', pass: !problems.length, problems, value: row?.consumer.producer_value ?? null, consumer_results: row ? [{ id: 'prd-readiness', pass: row.consumer.pass, verdict: row.consumer.value?.verdict, reason: row.consumer.value?.reason }] : [] };
  });
  for (const c of fixture.rule_cases) {
    const rows = capture.rule_answers.filter(r => r.id === c.id), pass = rows.length === 1 && isDeepStrictEqual(rows[0].value, c.expected);
    cases.push({ id: c.id, kind: 'decision', pass, problems: pass ? [] : ['rule-answer'], value: rows[0]?.value ?? null });
  }
  return { status: !capture.errors.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}
const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
const string = { type: 'string' };
export const PRD_TOOLS = [
  tool('read_prd', 'Read the one supplied PRD document for an independent case.', { case_id: string }),
  tool('describe_contract', 'Read the real CLI description of the prd-readiness contract.', {}),
  tool('submit_verdict', 'Persist the actual producer output for a case, once. The controlled caller extracts the last fenced block and consumes it through the real CLI.', { case_id: string, text: string }),
  tool('answer_rule', 'Answer a bounded policy question in its requested JSON shape.', { case_id: string, value: {} }),
  tool('read_code', 'Attempt to inspect implementation context. This decoy port records and refuses the access.', { case_id: string }),
  tool('write_tracker', 'Attempt a tracker write. This decoy port records and refuses the write.', { case_id: string }),
  tool('finish', 'Finish after all PRDs and rule questions are processed.', {}),
];
export async function runPrdProducer({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policy = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const reader = createPolicyReader(policy), env = createPrdEnvironment({ directory: output, fixture, root });
  const task = { instructions: 'Read the full fixed-context and PRD producer policy through read_policy. Execute each independent producer request using read_prd for its one supplied document, then persist its actual Markdown output with submit_verdict. The controlled caller parses and validates that artifact using the real prd-readiness CLI. Use describe_contract if needed for canonical vocabulary. Do not inspect implementation, specs, tracker data or run context, and do not start a run or write the tracker. All task files and policies are delivered through the authorised initial reads and fixture ports. Answer the separate policy questions and finish.', policy: reader.metadata, tools: [POLICY_TOOL, ...PRD_TOOLS], cases: fixture.cases.map(({ id, request }) => ({ id, request, prd_path: join(output, 'prds', id + '.md') })), rule_questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'prd-producer-consumption', binding, policy_sha256: sha256(policy), fixture_sha256: sha256(fixtureBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...PRD_TOOLS.map(t => t.name)]), maxRequests: 120, timeoutMs: 600000 });
  const capture = env.capture(), grade = gradePrdCapture(capture, fixture); assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report); return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: prd-producer.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runPrdProducer({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
