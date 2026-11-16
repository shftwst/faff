import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { gradeGloss } from '../grader.mjs';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { sha256 } from './schema.mjs';
import { createPolicyReader, POLICY_TOOL } from './policy-reader.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

export function gradeRenderedArtifact(text, oracle) {
  const problems = [];
  if (typeof text !== 'string' || !text.trim()) return { pass: false, problems: ['missing-output'] };
  const rubric = gradeGloss({ gloss: { output: text } }, oracle.rubric);
  if (rubric.score !== 1) problems.push('source-facts-or-forbidden-wording');
  for (const pattern of oracle.required_patterns ?? []) if (!new RegExp(pattern, 'mi').test(text)) problems.push(`missing-pattern:${pattern}`);
  for (const pattern of oracle.forbidden_patterns ?? []) if (new RegExp(pattern, 'mi').test(text)) problems.push(`forbidden-pattern:${pattern}`);
  if (oracle.first_line && !new RegExp(oracle.first_line, 'i').test(text.trim().split('\n')[0])) problems.push('governing-statement-not-first');
  if (oracle.minimum_bullets && (text.match(/^\s*(?:[-*]|\d+\.)\s/gm) ?? []).length < oracle.minimum_bullets) problems.push('enumeration-not-a-list');
  const knownIds = new Set(oracle.allowed_ids ?? []);
  if (oracle.allowed_ids && [...text.matchAll(/\b[A-Z]{2,}-\d+\b/g)].some(match => !knownIds.has(match[0]))) problems.push('invented-issue-id');
  return { pass: !problems.length, problems, rubric };
}

export function createRenderingEnvironment({ directory, fixture }) {
  const events = [], errors = [], outputs = new Map(), answers = new Map();
  mkdirSync(join(directory, 'artifacts'));
  return {
    async call(name, args) {
      const event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (name === 'finish' && exactKeys(args, [])) return event.result = { finished: true };
        if (name === 'write_output') {
          if (!exactKeys(args, ['case_id', 'text']) || !fixture.cases.some(c => c.id === args.case_id) || outputs.has(args.case_id) || typeof args.text !== 'string') throw new Error('invalid or duplicate artifact');
          writeFileSync(join(directory, 'artifacts', args.case_id + '.md'), args.text, { flag: 'wx' });
          outputs.set(args.case_id, args.text);
          return event.result = { written: true, bytes: Buffer.byteLength(args.text), sha256: sha256(args.text) };
        }
        if (name === 'answer_rule') {
          if (!exactKeys(args, ['case_id', 'value']) || !fixture.rule_cases.some(c => c.id === args.case_id) || answers.has(args.case_id)) throw new Error('invalid or duplicate rule answer');
          answers.set(args.case_id, args.value);
          return event.result = { recorded: true };
        }
        throw new Error('unknown tool or invalid arguments');
      } catch (error) { event.error = error.message; errors.push({ seq: event.seq, message: error.message }); throw error; }
    },
    capture() { return { events, errors, outputs: [...outputs].map(([id, text]) => ({ id, text, persisted_sha256: sha256(readFileSync(join(directory, 'artifacts', id + '.md'))) })), rule_answers: [...answers].map(([id, value]) => ({ id, value })) }; },
  };
}

export function gradeRenderingCapture(capture, fixture) {
  const cases = fixture.cases.map(row => {
    const outputs = capture.outputs.filter(o => o.id === row.id), output = outputs[0], grade = gradeRenderedArtifact(output?.text, row.oracle);
    if (outputs.length !== 1 || output && output.persisted_sha256 !== sha256(output.text)) { grade.pass = false; grade.problems.push('persisted-artifact'); }
    return { id: row.id, kind: 'artifact', ...grade };
  });
  for (const row of fixture.rule_cases) {
    const answers = capture.rule_answers.filter(a => a.id === row.id), pass = answers.length === 1 && isDeepStrictEqual(answers[0].value, row.expected);
    cases.push({ id: row.id, kind: 'decision', pass, problems: pass ? [] : ['rule-answer'], value: answers[0]?.value ?? null });
  }
  return { status: !capture.errors.length && cases.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const tool = (name, description, properties) => ({ name, description, inputSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
const string = { type: 'string' };
export const RENDERING_TOOLS = [
  tool('write_output', 'Persist the completed rendering for one artifact case. Write once per case; provide the actual normalised text or violation report requested.', { case_id: string, text: string }),
  tool('answer_rule', 'Answer one separate bounded policy question in its stated value shape. Do not perform hypothetical actions.', { case_id: string, value: {} }),
  tool('finish', 'Finish after all artifacts and rule answers are recorded.', {}),
];

export async function runRenderingArtifacts({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), policyBytes = readFileSync(policyPath), fixtureBytes = readFileSync(fixturePath), fixture = JSON.parse(fixtureBytes);
  mkdirSync(output);
  const reader = createPolicyReader(policyBytes), env = createRenderingEnvironment({ directory: output, fixture });
  const task = { instructions: 'Read the complete rendering policy through read_policy. For each independent artifact case, transform the supplied draft or source into the requested output and persist it through write_output. These are isolated human-facing outputs; preserve their facts and use the supplied source material. Do not query a tracker or read additional files. Separately answer every bounded rule question. Global operator guidance applies. Finish after every case is recorded.', policy: reader.metadata, tools: [POLICY_TOOL, ...RENDERING_TOOLS], cases: fixture.cases.map(({ id, task, source }) => ({ id, task, source })), rule_questions: fixture.rule_cases.map(({ id, question }) => ({ id, question })) };
  write(join(output, 'task.json'), task);
  write(join(output, 'manifest.json'), { schema: 1, kind: 'rendering-artifact-workflow', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: sha256(JSON.stringify(task, null, 2) + '\n'), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), policy_reader_sha256: sha256(readFileSync(new URL('./policy-reader.mjs', import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
  write(join(output, 'ready.json'), { ready: true });
  const bridge = await serveMailbox(output, reader.guard(env.call), { allowedTools: new Set(['read_policy', ...RENDERING_TOOLS.map(t => t.name)]), maxRequests: 100, timeoutMs: 480000 });
  const capture = env.capture(), grade = gradeRenderingCapture(capture, fixture);
  assertCandidateCommandUnchanged(binding);
  write(join(output, 'capture.json'), capture);
  const report = { status: !bridge.stop && !bridge.rejected && reader.capture().complete && grade.status === 'pass' ? 'pass' : 'fail', bridge, policy_delivery: reader.capture(), grade, scope: fixture.scope, accounting: 'unmetered' };
  write(join(output, 'report.json'), report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: rendering-artifact.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runRenderingArtifacts({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
