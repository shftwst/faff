import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = process.cwd(), E = 'verification/experiments/2026-11-16-skill-diet';
const { createGraftCheckpointEnvironment, gradeGraftCheckpoints } = await import(join(root, 'eval/control-parity/graft-checkpoint-execution.mjs'));
const fixturePath = join(E, 'workflow-fixtures/graft-checkpoints-v1-draft.json');
const fixture = JSON.parse(readFileSync(fixturePath));
const output = join(E, process.argv[2] ?? 'graft-checkpoints-v1-preflight-20261117');
mkdirSync(output);
const write = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const temporary = mkdtempSync('/var/tmp/graft-checkpoint-preflight-');
try {
  const env = createGraftCheckpointEnvironment({ directory: temporary, runtimeRoot: root, fixture });
  write('public-cases.json', env.publicCases);
  const command = (case_id, command_id, input = '') => env.call('run_command', { case_id, command_id, input });
  for (const row of fixture.cases) {
    const id = row.id;
    let result;
    if (row.kind === 'dispatched') {
      await command(id, 'heartbeat');
      const gates = await command(id, 'gates');
      await command(id, 'heartbeat');
      await command(id, 'quality-contract', JSON.stringify(JSON.parse(gates.stdout).contract));
      await command(id, 'spec-verify');
      const classified = JSON.parse((await command(id, 'classify')).stdout).criteria;
      const checked = await command(id, 'check-ac');
      const criteria = classified.map((ac, index) => ({ ac: ac.text, ac_id: ac.ac_id, passed: index === 0, verified: index === 0 ? checked.stdout.trim() : 'Needs human verification: published prices were not inspected', verifications: index === 0 ? [{ kind: 'command', locator: env.publicCases.find(value => value.id === id).source.check_locator }] : [{ kind: 'human' }] }));
      await command(id, 'write-ac', JSON.stringify({ all_verified: false, criteria }));
      await command(id, 'write-human', JSON.stringify({ issue: 'FAFF-9', level: 'L3', unattended: true, human_only: [classified[1].ac_id] }));
      for (const name of ['render-ac', 'review-handoff', 'pr-handoff']) await command(id, name);
      result = { issue: 'FAFF-9', pr: 11, token: 'pr-ready', evidence_return: (await command(id, 'evidence-return')).stdout };
    } else if (row.kind.startsWith('gate-')) {
      const gates = await command(id, 'gates');
      result = { continued: false, gate_contract: (await command(id, 'quality-contract', JSON.stringify(JSON.parse(gates.stdout).contract))).stdout };
    } else {
      let returned, verification = null, status;
      if (row.kind === 'evidence-refusal') {
        await command(id, 'write-ac', JSON.stringify(row.source.supplied_input));
        returned = (await command(id, 'evidence-return')).stdout;
        status = 'writer-refused';
      } else {
        returned = row.kind === 'evidence-tamper' ? env.publicCases.find(value => value.id === id).source.returned_before_change : (await command(id, 'evidence-return')).stdout;
        verification = (await command(id, 'verify-return', returned)).stdout;
        status = row.kind === 'evidence-tamper' ? 'tampered' : 'absent';
      }
      result = { continued: false, evidence_status: status, evidence_return: returned, verification };
    }
    await env.call('submit_result', { case_id: id, result });
  }
  const ledgerFixture = JSON.parse(readFileSync(fixture.reconciliation.fixture));
  for (const id of fixture.reconciliation.case_ids) {
    const publicCase = env.publicCases.find(row => row.id === id);
    await env.call('read_ledger', { case_id: id });
    await env.call('write_ledger', { case_id: id, patch: ledgerFixture.cases.find(row => row.id === id).oracle.patch });
    await env.call('append_event', { case_id: id, transition_id: 'ledger-edit', executable: join(root, 'plugin/skills/faff/bin/faff'), args: ['events', 'append', '--run', publicCase.run_id, '--root', publicCase.root], payload: { phase: 'run', type: 'ledger-write' } });
  }
  for (const row of fixture.rule_cases) await env.call('answer_rule', { id: row.id, value: row.expected });
  await env.call('finish', {});
  const capture = env.capture(); write('capture.json', capture);
  const consumers = env.consume(); write('consumers.json', consumers);
  const grade = gradeGraftCheckpoints(capture, consumers, fixture); write('grade.json', grade);
  const inputs = ['eval/control-parity/graft-checkpoint-execution.mjs', 'test/control-parity-graft-checkpoint.test.mjs', fixturePath, fixture.reconciliation.fixture, fixture.reconciliation.dependencies, join(E, 'graft-evidence-consumer-reuse-notes.json'), 'eval/control-parity/ledger-execution.mjs', 'eval/control-parity/ledger-execution-v2.mjs', 'eval/control-parity/candidate-command.mjs', 'eval/control-parity/policy-reader.mjs', 'eval/control-parity/interactive-handoff.mjs', 'eval/control-parity/schema.mjs', relative(root, import.meta.filename)];
  const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  write('preflight.json', { schema: 1, status: grade.status, scope: 'Deterministic controller round trip only; no model, policy delivery, native transport, hosted review/PR or lifecycle qualification.', root_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), commands: [[process.execPath, relative(root, import.meta.filename), ...(process.argv.slice(2))]], cases: grade.cases.length, inputs: inputs.map(path => ({ path, sha256: hash(path) })), outputs: ['public-cases.json', 'capture.json', 'consumers.json', 'grade.json'].map(name => ({ path: join(output, name), sha256: hash(join(output, name)) })), limitations: fixture.limits, manual_detail_gate_required: true });
  console.log(JSON.stringify({ status: grade.status, cases: grade.cases.length, problems: grade.problems, failed: grade.cases.filter(row => !row.pass), output }));
  if (grade.status !== 'pass') process.exitCode = 1;
} finally { rmSync(temporary, { recursive: true, force: true }); }
