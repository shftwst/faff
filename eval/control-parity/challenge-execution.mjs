import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { canonicalHash, sha256 } from './schema.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
function run(cli, root, args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 15000 });
  return { args, exit_code: r.status, stdout: r.stdout, stderr: r.stderr, ...(r.error ? { error: r.error.message } : {}) };
}

export function createChallengeEnvironment({ root, runtime, fixture }) {
  const cli = join(runtime, 'plugin/skills/faff/bin/faff');
  const events = [], errors = [], states = new Map();
  for (const row of fixture.cases) {
    const directory = join(root, row.id);
    mkdirSync(directory, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: directory });
    states.set(row.id, { row, directory, result: null, submitted: false });
  }
  return {
    async call(name, args) {
      if (name === 'finish') {
        if (!args || Object.keys(args).length) throw new Error('finish takes an empty object');
        return { finished: true };
      }
      const state = states.get(args?.case_id), event = { seq: events.length + 1, name, args, case_id: args?.case_id ?? null };
      events.push(event);
      try {
        if (!state) throw new Error('unknown fixture case');
        if (name === 'describe_contract') {
          if (Object.keys(args).join(',') !== 'case_id') throw new Error('describe_contract takes only case_id');
          event.result = run(cli, state.directory, ['contract', state.row.seam === 'adr-drift' ? 'adr-admission' : 'prdr-yagni', '--describe']);
        } else if (name === 'submit_challenge') {
          if (state.submitted || Object.keys(args).sort().join(',') !== 'case_id,ground,outcome,reason' || typeof args.reason !== 'string' || !args.reason.trim() || ![null, 'survived', 'overturned'].includes(args.outcome) || ![null, 'over-scope', 'unserved', 'other'].includes(args.ground)) throw new Error('invalid or duplicate challenge submission');
          state.submitted = true;
          const challengeArgs = args.outcome === null ? [] : ['--challenge', args.outcome];
          const calls = [];
          let upper = null, admission = null;
          if (state.row.seam === 'adr-drift') {
            const result = run(cli, state.directory, ['adr', 'admit', 'fixture', '--actor', 'loop', '--supersedes-provenance', 'loop', ...challengeArgs]);
            calls.push(result);
            if (result.exit_code === 0) admission = JSON.parse(result.stdout);
          } else {
            const row = state.row;
            const result = run(cli, state.directory, ['prdr', 'yagni', '--prd-goal', row.cited_goal, '--prd-goals', JSON.stringify(row.input.prd_goals), '--proposal', 'admit', '--proposal-reason', row.input.phase1_proposal.reason, ...challengeArgs, ...(args.ground === null ? [] : ['--challenge-ground', args.ground]), '--challenge-reason', args.reason, ...(row.dod_covers ? ['--dod-covers', JSON.stringify(row.dod_covers)] : [])]);
            calls.push(result);
            if (result.exit_code === 0) {
              upper = JSON.parse(result.stdout);
              const admit = run(cli, state.directory, ['prdr', 'admit', 'fixture', '--actor', 'loop', '--supersedes-provenance', 'loop', '--upper', JSON.stringify({ admit: upper.admit, reason: upper.reason })]);
              calls.push(admit);
              if (admit.exit_code === 0) admission = JSON.parse(admit.stdout);
            }
          }
          state.result = { challenge: args, calls, upper, admission };
          write(join(state.directory, 'challenge-result.json'), state.result);
          event.result = state.result;
        } else throw new Error('unknown fixture tool');
        return event.result;
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, case_id: event.case_id, message: error.message });
        throw error;
      }
    },
    capture() { return { events, errors, cases: [...states].map(([id, state]) => ({ id, result: state.result })) }; },
  };
}

export function gradeChallengeExecution(capture, fixture) {
  const cases = fixture.cases.map(row => {
    const result = capture.cases.find(c => c.id === row.id)?.result, problems = [];
    if (!result) problems.push('missing-challenge');
    if (result?.challenge.outcome !== row.expected.outcome) problems.push('challenge-outcome');
    if (result?.challenge.ground !== row.expected.ground) problems.push('challenge-ground');
    if (!result?.calls.length || result.calls.some(c => c.exit_code !== 0)) problems.push('consumer-error');
    if ((result?.admission?.disposition === 'admit') !== row.expected.admit || !result?.admission) problems.push('admission');
    if (capture.events.filter(e => e.case_id === row.id && e.name === 'submit_challenge').length !== 1) problems.push('submission-count');
    return { id: row.id, pass: problems.length === 0, problems, outcome: result?.challenge.outcome ?? null, ground: result?.challenge.ground ?? null, disposition: result?.admission?.disposition ?? null, upper_admit: result?.upper?.admit ?? null };
  });
  return { status: !capture.errors.length && cases.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const string = { type: 'string' }, nullable = { type: ['string', 'null'] };
const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const CHALLENGE_TOOLS = [
  { name: 'describe_contract', description: 'Read the canonical production contract description for this case.', inputSchema: schema({ case_id: string }) },
  { name: 'submit_challenge', description: 'Return the independent challenge outcome, optional overturn ground, and reasoning. Use null when an opinion was not obtained; ground is null when inapplicable. The fixture caller passes the result to the real admission CLI and persists its result. One submission per case.', inputSchema: schema({ case_id: string, outcome: nullable, ground: nullable, reason: string }) },
  { name: 'finish', description: 'Finish after every independent case has submitted its challenge.', inputSchema: schema({}) },
];

export async function runChallengeExecution({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), fixtureBytes = readFileSync(fixturePath), policyBytes = readFileSync(policyPath);
  const fixture = JSON.parse(fixtureBytes), work = mkdtempSync(join(tmpdir(), 'faff-challenge-workflow-'));
  mkdirSync(output);
  const env = createChallengeEnvironment({ root: work, runtime: root, fixture });
  try {
    const task = { instructions: 'For each independent case, occupy the ADR drift or PRDR YAGNI challenge interface in the supplied policy. The fixture primary was authored and reviewed by OpenAI; you are the independent reviewer. Judge the supplied proposal-shaped artifact; do not use the diff-shaped code-review transport. opinion_available=false represents an exhausted provider attempt with no independent opinion: preserve that absence. Submit the interface result through the tool; the fixture caller feeds it to the actual CLI and persists the admission outcome. Ground is only applicable to an overturned PRDR challenge. Do not edit the proposal or implement anything. Finish after all cases.', policy: policyBytes.toString('utf8'), tools: CHALLENGE_TOOLS, cases: fixture.cases.map(({ id, seam, input, opinion_available }) => ({ id, seam, input, opinion_available })) };
    write(join(output, 'task.json'), task);
    write(join(output, 'manifest.json'), { schema: 1, kind: 'challenge-judgement-and-consumption', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: canonicalHash(task), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
    write(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, env.call, { allowedTools: new Set(CHALLENGE_TOOLS.map(t => t.name)), maxRequests: 64, timeoutMs: 480000 });
    const capture = env.capture(), grade = gradeChallengeExecution(capture, fixture);
    assertCandidateCommandUnchanged(binding);
    write(join(output, 'capture.json'), capture);
    const report = { status: !bridge.stop && !bridge.rejected && grade.status === 'pass' ? 'pass' : 'fail', bridge, grade, scope: fixture.scope, accounting: 'unmetered' };
    write(join(output, 'report.json'), report);
    return report;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: challenge-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runChallengeExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
