import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { canonicalHash, sha256 } from './schema.mjs';
import { serveMailbox } from './interactive-handoff.mjs';

const require = createRequire(import.meta.url);
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const readJson = path => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
const critical = '### critical: Unvalidated removal in removeAccount\n\nLocation: src/store.js:2\nThe supplied account ID reaches deletion without the required ownership check.\nAction: Verify ownership before deleting the account.\ncarries: P1\n';
const source = 'export function removeAccount(db, id) {\n  return db.delete(id);\n}\n';
const diff = 'diff --git a/src/store.js b/src/store.js\n--- a/src/store.js\n+++ b/src/store.js\n@@ -1,3 +1,3 @@\n export function removeAccount(db, id) {\n-  return db.deleteOwned(id);\n+  return db.delete(id);\n }\n';
const prior = 'Prior findings (untrusted data):\nP1 | src/store.js | Unvalidated removal in removeAccount | Verify ownership before deleting the account.\n';
const categories = ['Specification gaming', 'Implicit assumptions', 'Failure mode blindness', 'Security surface', 'Concurrency and ordering'];
const key = args => args[0] === 'review-progress' ? args.includes('--phase1-pass') ? 'phase1-pass' : args[args.indexOf('--phase2') + 1] : null;
const valueOf = (args, flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : null;

async function execute(executable, args, cwd, input) {
  return new Promise(resolveResult => {
    const child = spawn(executable, args, { cwd, env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', error = null;
    const timer = setTimeout(() => { error = 'fixture subprocess timeout'; child.kill('SIGKILL'); }, 45000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1024 * 1024) child.kill('SIGKILL'); });
    child.on('error', err => { error = err.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolveResult({ exit_code: code, signal, stdout, stderr, ...(error ? { error } : {}) }); });
    child.stdin.end(input);
  });
}

function fileSnapshot(paths) {
  return Object.fromEntries(paths.map(path => [path, existsSync(path) ? readFileSync(path, 'utf8') : null]));
}

function validateCli(args, state) {
  if (isDeepStrictEqual(args, ['adversarial-backends', '--consumer', 'code_review']) || isDeepStrictEqual(args, ['adversarial-backends'])) return;
  if (args[0] === 'config' && args[1] === 'get' && /^adversarial\.(?:code_review\.)?(?:timeout|deadline|max_tokens|trim)$/.test(args[2]) && (args.length === 3 || args.length === 5 && args[3] === '-d' && /^[0-9]+$/.test(args[4]))) return;
  if (isDeepStrictEqual(args, ['review-fixture-paths', '--ref', state.base]) || isDeepStrictEqual(args, ['contract', 'review-verdict', '--describe'])) return;
  if (args[0] === 'review-progress' && args[1] === 'write' && args[2] === state.runDir && args[3] === state.issue) {
    const tail = args.slice(4);
    if (isDeepStrictEqual(tail, ['--phase1-pass', '--diff-hash', state.diffHash])) return;
    if (tail[0] === '--phase2' && ['in_flight', 'skipped_deadline', 'skipped_unreachable'].includes(tail[1]) && tail.length === 2) return;
    if (isDeepStrictEqual(tail, ['--phase2', 'complete', '--findings', state.files.findings])) return;
  }
  throw new Error('outside CLI fixture scope');
}

function validateReview(args, state, executables) {
  let inner = args;
  if (args[0] === executables.review_spawn) {
    const split = args.indexOf('--');
    const options = args.slice(1, split);
    if (split < 0 || options.length !== 2 || options[0] !== '--deadline' || !/^[0-9]+$/.test(options[1]) || +options[1] < 1 || +options[1] > 20 || !['node', executables.node].includes(args[split + 1])) throw new Error('outside wrapper fixture scope');
    inner = args.slice(split + 2);
  }
  if (inner[0] !== executables.review_call) throw new Error('outside executable fixture scope');
  const paths = new Map([['--backends-json', state.files.backends], ['--system', state.files.system], ['--diff', state.files.diff], ['--context', state.files.context], ['--run-dir', state.runDir]]);
  for (let i = 1; i < inner.length; i++) {
    const flag = inner[i];
    if (['--no-trim', '--lights-out'].includes(flag)) continue;
    const value = inner[++i];
    if (paths.has(flag) && value === paths.get(flag)) continue;
    if (['--deadline', '--timeout', '--max-tokens'].includes(flag) && /^[0-9]+$/.test(value) && +value > 0 && +value <= (flag === '--max-tokens' ? 4000 : 20)) continue;
    if (flag === '--fixture-path' && ['fixtures/', '__fixtures__/', 'testdata/'].includes(value)) continue;
    throw new Error('outside review argument fixture scope');
  }
  if (existsSync(state.files.backends)) {
    const chain = readJson(state.files.backends);
    if (!Array.isArray(chain) || chain.some(b => b.host !== state.host || b.provider !== 'openai' || b.model !== 'fixture-model' || b.api_key_env || b.apiKeyEnv || b.auth)) throw new Error('backend outside local fixture provider');
  }
}

export async function createAdversarialEnvironment({ root, runtime, fixture }) {
  const events = [], errors = [], requests = [], states = new Map();
  const executables = { faff: join(runtime, 'plugin/skills/faff/bin/faff'), node: process.execPath, review_spawn: join(runtime, 'plugin/skills/faffter-dark-adversarial-review/review-spawn.mjs'), review_call: join(runtime, 'plugin/skills/faffter-dark-adversarial-review/review-call.mjs') };
  const { evaluateMergeFloorLeg } = require(join(runtime, 'plugin/skills/faff/bin/lib/governance-check.js'));
  const reviewReference = readFileSync(join(runtime, 'plugin/skills/faff/references/review.md'), 'utf8');
  const fixtureGuidance = reviewReference.slice(reviewReference.indexOf('### Fixture data in review')).trim() + '\n';
  const server = createServer((req, res) => {
    const id = req.url.split('/')[1], state = states.get(id);
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      requests.push({ case_id: id, method: req.method, url: req.url, body: raw });
      if (!state) { res.writeHead(404); res.end(); return; }
      if (state.row.provider === 'outage') { res.writeHead(503); res.end('fixture unavailable'); return; }
      if (state.row.provider === 'auth') { res.writeHead(401); res.end('fixture authentication failure'); return; }
      if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
      if (state.row.provider === 'rate-limit') { res.writeHead(429); res.end('fixture rate limit'); return; }
      if (state.row.provider === 'deadline') return;
      const content = state.row.provider === 'empty' ? '' : critical;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const publicCases = [];
  for (const row of fixture.cases) {
    const cwd = join(root, row.id), runDir = join(cwd, 'run'), issue = 'FAFF-7001';
    mkdirSync(join(cwd, 'src'), { recursive: true });
    mkdirSync(join(runDir, issue), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd });
    writeFileSync(join(cwd, 'src/store.js'), source.replace('db.delete(id)', 'db.deleteOwned(id)'));
    execFileSync('git', ['add', 'src/store.js'], { cwd });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture base'], { cwd });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const host = `http://127.0.0.1:${server.address().port}/${row.id}/v1`;
    const deadline = row.provider === 'deadline' ? 1 : 12;
    writeFileSync(join(cwd, '.faffrc.yaml'), `adversarial:\n  provider: openai\n  model: fixture-model\n  host: ${host}\n  timeout: 10\n  deadline: ${deadline}\n  max_tokens: 2000\n${row.provider === 'malformed' ? '  fallbacks: "{bad"\n' : ''}`);
    writeJson(join(runDir, 'run-ledger.json'), { level: row.level });
    writeJson(join(runDir, issue, 'ac-checklist.json'), { all_verified: true });
    const files = { context: join(cwd, 'src/store.js'), diff: join(cwd, 'change.diff'), system: join(cwd, 'review-system.txt'), backends: join(cwd, 'backends.json'), findings: join(cwd, 'findings.md') };
    writeFileSync(files.context, source);
    writeFileSync(files.diff, diff);
    const protectedPaths = [files.context, files.diff, join(cwd, '.faffrc.yaml'), join(runDir, 'run-ledger.json'), join(runDir, issue, 'ac-checklist.json')];
    const state = { row, cwd, runDir, issue, base, host, deadline, files, diffHash: sha256(diff), protectedPaths, before: fileSnapshot(protectedPaths), verdict: null, submitted: false, writable: new Set([files.system, files.backends, files.findings]) };
    states.set(row.id, state);
    publicCases.push({ id: row.id, user_message: 'Review the supplied change through the two-phase review slot and return its final review output. Do not implement changes. The primary-review tool supplies the fixture reviewer result.', issue_id: issue, autonomous: row.autonomous, lights_out: false, ...(row.autonomous ? { run_dir: runDir } : {}), diff_hash: state.diffHash, review_base: base, files, spec: 'Deleting an account requires checking ownership before deletion.', prior_findings: prior, fixture_guidance: fixtureGuidance, implemented_by: 'Claude' });
  }
  const environment = {
    executables, publicCases,
    async call(name, args) {
      if (name === 'finish') { if (!args || Object.keys(args).length) throw new Error('finish takes an empty object'); return { finished: true }; }
      const state = states.get(args?.case_id);
      const event = { seq: events.length + 1, name, case_id: args?.case_id ?? null, args };
      events.push(event);
      try {
        if (!state) throw new Error('unknown fixture case');
        const tool = ADVERSARIAL_TOOLS.find(t => t.name === name);
        if (!tool || Object.keys(args).some(k => !(k in tool.inputSchema.properties)) || tool.inputSchema.required.some(k => !(k in args))) throw new Error('invalid fixture tool arguments');
        if (name === 'invoke_skill') {
          if (args.name.replace(/^faff:/, '') !== 'faffter-noon-review') throw new Error('outside delegated skill fixture scope');
          event.result = { signal: state.row.phase1, findings: state.row.phase1 === 'pass' ? [] : [{ title: 'Missing requirement', location: 'src/store.js:1', action: 'Implement the stated requirement.', location_present: true, action_present: true }], fixture_delegate: true };
        } else if (name === 'read_file') {
          if (![...Object.values(state.files)].includes(args.path)) throw new Error('outside readable fixture paths');
          event.result = { content: readFileSync(args.path, 'utf8') };
        } else if (name === 'write_file') {
          if (!state.writable.has(args.path) || typeof args.content !== 'string' || args.content.length > 100000) throw new Error('outside writable fixture paths');
          writeFileSync(args.path, args.content);
          event.result = { written: true, bytes: Buffer.byteLength(args.content), sha256: sha256(args.content) };
        } else if (name === 'run_command') {
          if (!Array.isArray(args.args) || args.args.some(a => typeof a !== 'string')) throw new Error('invalid command arguments');
          if (args.stdout_path && !state.writable.has(args.stdout_path)) throw new Error('outside writable output paths');
          if (args.executable === executables.faff) validateCli(args.args, state);
          else if (args.executable === executables.node) validateReview(args.args, state, executables);
          else throw new Error('outside executable fixture scope');
          event.command_kind = args.executable === executables.faff ? 'faff' : 'review';
          event.result = await execute(process.execPath, args.executable === executables.faff ? [executables.faff, ...args.args] : args.args, state.cwd);
          if (args.stdout_path) writeFileSync(args.stdout_path, event.result.stdout);
          if (event.command_kind === 'review') {
            event.system_text = existsSync(state.files.system) ? readFileSync(state.files.system, 'utf8') : null;
            event.backends_text = existsSync(state.files.backends) ? readFileSync(state.files.backends, 'utf8') : null;
          }
        } else if (name === 'submit_review') {
          if (state.submitted || typeof args.text !== 'string') throw new Error('invalid or duplicate final review');
          state.submitted = true;
          const blocks = [...args.text.matchAll(/^```faff-contract:review-verdict\s*\n([\s\S]*?)^```\s*$/gm)];
          if (blocks.length !== 1) throw new Error('exactly one final review-verdict fence is required');
          state.verdict = JSON.parse(blocks[0][1]);
          const path = join(state.runDir, state.issue, 'review-verdict.json');
          writeFileSync(join(state.cwd, 'review-output.md'), args.text);
          writeJson(path, state.verdict);
          event.result = { contract: await execute(process.execPath, [executables.faff, 'contract', 'review-verdict', '--in', path], state.cwd), gate: evaluateMergeFloorLeg(state.runDir, state.issue, state.row.level) };
          state.submission = event.result;
        } else throw new Error('unknown fixture tool');
        return event.result;
      } catch (error) {
        event.error = error.message;
        errors.push({ seq: event.seq, case_id: event.case_id, message: error.message });
        throw error;
      }
    },
    capture() {
      return { events, errors, requests, executables, cases: [...states].map(([id, s]) => ({ id, verdict: s.verdict, submission: s.submission ?? null, checkpoint: readJson(join(s.runDir, s.issue, 'review-progress.json')), before: s.before, after: fileSnapshot(s.protectedPaths), run_dir: s.runDir, files: s.files, findings_text: existsSync(s.files.findings) ? readFileSync(s.files.findings, 'utf8') : null, deadline: s.deadline, diff_hash: s.diffHash, source, diff, fixture_guidance: fixtureGuidance, prior_findings: prior })) };
    },
    async close() { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); },
  };
  return environment;
}

export function gradeAdversarialExecution(capture, fixture) {
  const cases = fixture.cases.map(row => {
    const c = capture.cases.find(c => c.id === row.id), events = capture.events.filter(e => e.case_id === row.id), problems = [];
    const phase1 = events.filter(e => e.name === 'invoke_skill');
    const helpers = events.filter(e => e.command_kind === 'review');
    const progress = events.filter(e => e.command_kind === 'faff' && e.args.args[0] === 'review-progress');
    const submitted = events.filter(e => e.name === 'submit_review');
    if (phase1.length !== 1) problems.push('phase1-invocation');
    if (phase1[0] && progress.some(e => e.seq < phase1[0].seq)) problems.push('checkpoint-before-primary');
    if (helpers.length !== (row.expected.helper_exit === null ? 0 : 1)) problems.push('helper-call-count');
    if (!isDeepStrictEqual(progress.map(e => key(e.args.args)), row.expected.checkpoint)) problems.push('checkpoint-sequence');
    if (progress.some(e => e.result?.exit_code !== 0)) problems.push('checkpoint-error');
    if (submitted.length !== 1 || c?.submission?.contract.exit_code !== 0) problems.push('invalid-contract');
    if (c?.verdict?.signal !== row.expected.signal) problems.push('signal');
    if (c?.submission?.gate.pass !== (row.expected.signal === 'pass') || c?.submission?.gate.review_verdict !== row.expected.signal) problems.push('merge-floor');
    if ((c?.verdict?.adversarial_outcome ?? null) !== (row.expected.outcome ?? null)) problems.push('outage-annotation');
    if (!c || !isDeepStrictEqual(c.before, c.after)) problems.push('protected-state-changed');
    if (row.expected.checkpoint.length && (c?.checkpoint?.phase1?.diff_hash !== c.diff_hash || c?.checkpoint?.phase2?.status !== (row.expected.checkpoint.at(-1) === 'phase1-pass' ? 'pending' : row.expected.checkpoint.at(-1)))) problems.push('checkpoint-final-state');
    if (!row.expected.checkpoint.length && c?.checkpoint !== null) problems.push('unexpected-checkpoint');
    for (const helper of helpers) {
      const args = helper.args.args;
      if (helper.result.exit_code !== row.expected.helper_exit) problems.push('helper-exit');
      if (args[0] !== capture.executables.review_spawn) problems.push('missing-wrapper');
      if (row.autonomous && valueOf(args, '--run-dir') !== c.run_dir) problems.push('missing-run-dir');
      if (!row.autonomous && args.includes('--run-dir')) problems.push('unexpected-run-dir');
      if (args.filter(a => a === '--deadline').length !== 2 || args.some((a, i) => a === '--deadline' && args[i + 1] !== String(c.deadline))) problems.push('deadline-forwarding');
      if (valueOf(args, '--timeout') !== '10' || valueOf(args, '--max-tokens') !== '2000') problems.push('settings-forwarding');
      if (valueOf(args, '--context') !== c.files.context || valueOf(args, '--diff') !== c.files.diff || valueOf(args, '--system') !== c.files.system || valueOf(args, '--backends-json') !== c.files.backends) problems.push('payload-files');
      const lens = helper.system_text ?? '';
      if (categories.some(category => !lens.includes(category)) || !lens.includes(c.fixture_guidance.trim()) || !lens.includes('P1') || !lens.includes('Fixture paths:')) problems.push('system-context');
      const resolution = events.find(e => e.command_kind === 'faff' && isDeepStrictEqual(e.args.args, ['adversarial-backends', '--consumer', 'code_review']));
      if (!resolution || resolution.result.exit_code !== 0 || resolution.seq > helper.seq) problems.push('backend-resolution');
      if (resolution && helper.backends_text !== resolution.result.stdout) problems.push('backend-bytes-changed');
      if (helper.result.exit_code === 0 && c.findings_text !== helper.result.stdout) problems.push('findings-bytes-changed');
      const fixtureRead = events.find(e => e.command_kind === 'faff' && e.args.args[0] === 'review-fixture-paths');
      const fixtureFlags = args.flatMap((a, i) => a === '--fixture-path' ? [args[i + 1]] : []);
      const resolvedPaths = fixtureRead?.result.exit_code === 0 ? fixtureRead.result.stdout.trim().split('\n').filter(Boolean) : [];
      if (!fixtureRead || fixtureRead.seq > helper.seq || !isDeepStrictEqual(fixtureFlags, resolvedPaths)) problems.push('fixture-path-forwarding');
      if (!phase1[0] || phase1[0].seq > helper.seq || row.autonomous && !progress.some(e => key(e.args.args) === 'in_flight' && e.seq < helper.seq)) problems.push('phase-order');
      const complete = progress.find(e => key(e.args.args) === 'complete');
      if (complete && complete.seq < helper.seq) problems.push('premature-completion');
    }
    if (row.provider === 'critical' && helpers.length) {
      const findings = c?.verdict?.findings ?? [];
      if (!findings.some(f => f.severity === 'critical' && f.source === 'adversarial' && f.model === 'openai/fixture-model' && f.location?.includes('src/store.js') && f.action && f.location_present === true && f.action_present === true && f.carried_id === 'P1')) problems.push('critical-finding-lost');
      if (row.autonomous && !(c?.verdict?.escalated_criticals ?? []).some(f => f.severity === 'critical' && f.location?.includes('src/store.js') && f.carried_id === 'P1')) problems.push('critical-escalation-lost');
      if (!row.autonomous && c?.verdict?.escalated_criticals?.length) problems.push('interactive-escalation');
    }
    if (row.provider === 'malformed') {
      const resolution = events.filter(e => e.command_kind === 'faff' && e.args.args[0] === 'adversarial-backends');
      if (resolution.length !== 1 || resolution[0].result.exit_code !== 2) problems.push('malformed-config-resolution');
    }
    if (row.phase1 !== 'pass' && capture.requests.some(r => r.case_id === row.id)) problems.push('phase1-short-circuit');
    if (events.some(e => e.error)) problems.push('tool-error');
    return { id: row.id, pass: problems.length === 0, problems, signal: c?.verdict?.signal ?? null, helper_exits: helpers.map(e => e.result.exit_code), checkpoints: progress.map(e => key(e.args.args)), gate: c?.submission?.gate ?? null };
  });
  return { status: !capture.errors.length && cases.length && cases.every(c => c.pass) ? 'pass' : 'fail', cases, errors: capture.errors };
}

const schema = properties => ({ type: 'object', properties, required: Object.keys(properties).filter(k => k !== 'stdout_path'), additionalProperties: false });
const string = { type: 'string' };
export const ADVERSARIAL_TOOLS = [
  { name: 'invoke_skill', description: 'Execute the delegated primary review fixture and receive its result.', inputSchema: schema({ case_id: string, name: string }) },
  { name: 'read_file', description: 'Read a supplied case file.', inputSchema: schema({ case_id: string, path: string }) },
  { name: 'write_file', description: 'Write a staging system, backends or findings file. Other paths are protected.', inputSchema: schema({ case_id: string, path: string, content: string }) },
  { name: 'run_command', description: 'Execute a real resolved faff command or node review helper in this case. Optional stdout_path captures stdout exactly into a staging file. Returns real exit code, stdout and stderr.', inputSchema: schema({ case_id: string, executable: string, args: { type: 'array', items: string }, stdout_path: string }) },
  { name: 'submit_review', description: 'Persist the final review text and its contract and run the production contract and merge-floor checks. One submission per case.', inputSchema: schema({ case_id: string, text: string }) },
  { name: 'finish', description: 'Finish after every independent case has submitted its review.', inputSchema: schema({}) },
];

export async function runAdversarialExecution({ root, commit, policyPath, fixturePath, output }) {
  const binding = bindCandidateCommand(root, commit), fixtureBytes = readFileSync(fixturePath), policyBytes = readFileSync(policyPath);
  const fixture = JSON.parse(fixtureBytes), work = mkdtempSync(join(tmpdir(), 'faff-adversarial-workflow-'));
  mkdirSync(output);
  const env = await createAdversarialEnvironment({ root: work, runtime: root, fixture });
  try {
    const task = { instructions: 'Execute each independent review case using the policy and fixture tools. Read context/diff files through read_file. The supplied file paths and executable paths are already resolved. Use run_command with an argv array in place of Bash; stdout_path implements shell redirection without changing stdout. Use the supplied fixture_guidance when the policy requests that shared review section. The primary review is a fixture delegate. The independent provider is a controlled local server reached by the real production helper. Submit the complete review output and contract for each case, then finish. Do not execute workflows outside these tools.', policy: policyBytes.toString('utf8'), executables: env.executables, tools: ADVERSARIAL_TOOLS, cases: env.publicCases };
    writeJson(join(output, 'task.json'), task);
    writeJson(join(output, 'manifest.json'), { schema: 1, kind: 'adversarial-review-execution', binding, fixture_sha256: sha256(fixtureBytes), policy_sha256: sha256(policyBytes), task_sha256: canonicalHash(task), harness_sha256: sha256(readFileSync(new URL(import.meta.url))), scope: fixture.scope, accounting: 'unmetered' });
    writeJson(join(output, 'ready.json'), { ready: true });
    const bridge = await serveMailbox(output, env.call, { allowedTools: new Set(ADVERSARIAL_TOOLS.map(t => t.name)), maxRequests: 512, timeoutMs: 900000 });
    const capture = env.capture(), grade = gradeAdversarialExecution(capture, fixture);
    assertCandidateCommandUnchanged(binding);
    writeJson(join(output, 'capture.json'), capture);
    const report = { status: !bridge.stop && !bridge.rejected && grade.status === 'pass' ? 'pass' : 'fail', bridge, grade, scope: fixture.scope, accounting: 'unmetered' };
    writeJson(join(output, 'report.json'), report);
    return report;
  } finally { await env.close(); rmSync(work, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, commit, policyPath, fixturePath, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: adversarial-execution.mjs ROOT COMMIT POLICY FIXTURE NEW_OUTPUT');
  const report = await runAdversarialExecution({ root: resolve(root), commit, policyPath: resolve(policyPath), fixturePath: resolve(fixturePath), output: resolve(output) });
  console.log(JSON.stringify({ status: report.status, cases: report.grade.cases }));
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
