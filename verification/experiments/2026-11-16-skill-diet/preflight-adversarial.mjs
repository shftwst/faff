import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAdversarialEnvironment, gradeAdversarialExecution } from '../../../eval/control-parity/adversarial-execution.mjs';

const root = resolve(import.meta.dirname, '../../..');
const runtime = resolve(root, '../review-comment-interactive');
const fixture = JSON.parse(readFileSync(new URL('./workflow-fixtures/adversarial.json', import.meta.url)));
const output = resolve(process.argv[2]);
mkdirSync(output);
const work = mkdtempSync(join(tmpdir(), 'adversarial-preflight-'));
const env = await createAdversarialEnvironment({ root: work, runtime, fixture });
try {
  for (const c of env.publicCases) {
    const row = fixture.cases.find(r => r.id === c.id);
    const call = (name, args) => env.call(name, { case_id: c.id, ...args });
    const cli = (args, stdout_path) => call('run_command', { executable: env.executables.faff, args, ...(stdout_path ? { stdout_path } : {}) });
    const primary = await call('invoke_skill', { name: 'faffter-noon-review' });
    let finding = primary.findings[0], helper;
    if (primary.signal === 'pass') {
      if (c.autonomous) await cli(['review-progress', 'write', c.run_dir, c.issue_id, '--phase1-pass', '--diff-hash', c.diff_hash]);
      const backends = await cli(['adversarial-backends', '--consumer', 'code_review'], c.files.backends);
      if (backends.exit_code === 0) {
        const paths = await cli(['review-fixture-paths', '--ref', c.review_base]);
        const prefixes = paths.exit_code === 0 ? paths.stdout.trim().split('\n').filter(Boolean) : [];
        const system = ['Specification gaming', 'Implicit assumptions', 'Failure mode blindness', 'Security surface', 'Concurrency and ordering'].join('\n') + '\n\n' + c.fixture_guidance + '\nFixture paths: ' + (prefixes.join(', ') || 'none') + '\n' + c.prior_findings;
        await call('write_file', { path: c.files.system, content: system });
        const deadline = row.provider === 'deadline' ? '1' : '12';
        if (c.autonomous) await cli(['review-progress', 'write', c.run_dir, c.issue_id, '--phase2', 'in_flight']);
        helper = await call('run_command', { executable: env.executables.node, args: [env.executables.review_spawn, '--deadline', deadline, '--', env.executables.node, env.executables.review_call, '--backends-json', c.files.backends, '--timeout', '10', '--deadline', deadline, '--max-tokens', '2000', ...prefixes.flatMap(p => ['--fixture-path', p]), ...(c.run_dir ? ['--run-dir', c.run_dir] : []), '--system', c.files.system, '--context', c.files.context, '--diff', c.files.diff], stdout_path: c.files.findings });
        assert.equal(helper.exit_code, row.expected.helper_exit, JSON.stringify({ case_id: c.id, helper }));
        if (c.autonomous && row.expected.checkpoint.length === 3) {
          const last = row.expected.checkpoint.at(-1);
          await cli(['review-progress', 'write', c.run_dir, c.issue_id, '--phase2', last, ...(last === 'complete' ? ['--findings', c.files.findings] : [])]);
        }
      } else assert.equal(row.provider, 'malformed');
    }
    if (!finding && helper?.exit_code === 0) finding = { title: 'Unvalidated removal in removeAccount', severity: 'critical', source: 'adversarial', model: 'openai/fixture-model', location: 'src/store.js:2', action: 'Verify ownership before deleting the account.', location_present: true, action_present: true, carried_id: 'P1', disposition: 'open' };
    if (!finding && row.expected.signal !== 'pass') finding = { title: 'Review unavailable', location: '.faffrc.yaml', action: 'Restore the configured review backend and retry independently.', location_present: true, action_present: true };
    const verdict = { signal: row.expected.signal, findings: finding ? [finding] : [], ...(row.expected.outcome ? { adversarial_outcome: row.expected.outcome } : {}), ...(row.provider === 'critical' && row.autonomous && helper?.exit_code === 0 ? { escalated_criticals: [{ severity: 'critical', location: finding.location, title: finding.title, carried_id: 'P1' }] } : {}) };
    const text = (helper?.stdout ?? 'Review result.') + '\n```faff-contract:review-verdict\n' + JSON.stringify(verdict) + '\n```\n';
    await call('submit_review', { text });
    console.log(JSON.stringify({ case_id: c.id, exit: helper?.exit_code ?? null, signal: verdict.signal }));
  }
  const capture = env.capture();
  const grade = gradeAdversarialExecution(capture, fixture);
  writeFileSync(join(output, 'capture.json'), JSON.stringify(capture, null, 2) + '\n');
  writeFileSync(join(output, 'report.json'), JSON.stringify(grade, null, 2) + '\n');
  console.log(JSON.stringify(grade));
  assert.equal(grade.status, 'pass');
} finally { writeFileSync(join(output, 'final-capture.json'), JSON.stringify(env.capture(), null, 2) + '\n'); await env.close(); rmSync(work, { recursive: true, force: true }); }
