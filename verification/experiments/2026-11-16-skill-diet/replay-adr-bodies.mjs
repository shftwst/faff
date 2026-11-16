import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from '../../../eval/control-parity/candidate-command.mjs';
import { sha256 } from '../../../eval/control-parity/schema.mjs';
import { gradeRenderedArtifact } from '../../../eval/control-parity/rendering-artifact.mjs';
const [baselineArg, candidateArg, outputArg, mode] = process.argv.slice(2);
if (!outputArg || mode && mode !== '--preflight') throw Error('usage: replay-adr-bodies.mjs BASELINE_PLAN CANDIDATE_PLAN NEW_DIRECTORY [--preflight]');
const root = import.meta.dirname, output = resolve(outputArg);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const plans = [baselineArg, candidateArg].map(path => ({ path: resolve(path), value: read(resolve(path)) }));
assert.equal(plans[0].value.runtime_root, plans[1].value.runtime_root);
assert.equal(plans[0].value.runtime_commit, plans[1].value.runtime_commit);
assert.equal(plans[0].value.fixture, plans[1].value.fixture);
const binding = bindCandidateCommand(plans[0].value.runtime_root, plans[0].value.runtime_commit);
const fixturePath = join(root, plans[0].value.fixture), fixture = read(fixturePath), inputs = [];
for (const plan of plans) {
  assert.equal(plan.value.samples.length, 5);
  for (const sample of plan.value.samples) {
    if (mode && inputs.length) break;
    const directory = join(root, 'workflow-runs', sample.name);
    if (!mode) {
      assert.equal(read(join(directory, 'report.json')).status, 'pass');
      assert.equal(read(join(directory, 'native-audit.json')).runs[0].status, 'pass');
    }
    for (const c of fixture.cases) {
      const path = join(directory, 'artifacts', c.id + '.md');
      const text = mode ? c.reference : readFileSync(path, 'utf8');
      inputs.push({ name: sample.name, arm: sample.arm, case_id: c.id, path: mode ? null : path, sha256: sha256(text), text, case: c, report_sha256: mode ? null : sha256(readFileSync(join(directory, 'report.json'))), native_audit_sha256: mode ? null : sha256(readFileSync(join(directory, 'native-audit.json'))) });
    }
  }
}
assert.equal(inputs.length, mode ? 6 : 60);
mkdirSync(output);
const publicInput = ({ text, case: c, ...row }) => row;
write(join(output, 'manifest.json'), { mode: mode ? 'preflight-reference-bodies' : 'actual-artifact-replay', binding, script_sha256: sha256(readFileSync(new URL(import.meta.url))), fixture_sha256: sha256(readFileSync(fixturePath)), plans: plans.map(p => ({ path: p.path, sha256: sha256(readFileSync(p.path)) })), inputs: inputs.map(publicInput) });
const results = [];
for (const input of inputs) {
  const directory = join(output, input.name + '-' + input.case_id);
  mkdirSync(directory);
  const c = input.case, calls = [];
  if (c.template !== null) { mkdirSync(join(directory, '.faff/templates'), { recursive: true }); writeFileSync(join(directory, '.faff/templates/adr.md'), c.template); }
  const call = args => {
    const result = spawnSync(process.execPath, [join(binding.root, 'plugin/skills/faff/bin/faff'), 'adr', ...args, '--root', directory], { cwd: directory, encoding: 'utf8', timeout: 15000, env: { ...process.env, FAFF_RUN_DIR: '' } });
    const row = { args: ['adr', ...args, '--root', '<case-root>'], exit_code: result.status, stdout: result.stdout, stderr: result.stderr };
    calls.push(row); return row;
  };
  const formatResult = call(['format', '--json']); assert.equal(formatResult.exit_code, 0);
  const format = JSON.parse(formatResult.stdout); assert.deepEqual(format, c.source.resolved_format);
  assert.equal(gradeRenderedArtifact(input.text, c.oracle).pass, true);
  const headings = [...input.text.matchAll(/^## ([^\r\n]+)$/gm)].map(m => m[1].trim());
  assert.deepEqual(headings, format.sections.map(s => s.name));
  const parts = input.text.split(/^## [^\r\n]+\r?$/m).slice(1); assert.equal(parts.length, headings.length); assert.ok(parts.every(s => s.trim()));
  const scaffold = call(['new', '--title', c.source.decision.title, '--date', '2026-11-16', '--issue', c.source.issue.id]); assert.equal(scaffold.exit_code, 0);
  const file = scaffold.stdout.trim(); assert.ok(file.startsWith(directory + '/'));
  const original = readFileSync(file, 'utf8'), boundary = original.search(/^## /m); assert.ok(boundary > 0);
  const finalText = original.slice(0, boundary) + input.text;
  writeFileSync(file, finalText); assert.equal(readFileSync(file, 'utf8').slice(boundary), input.text);
  const validation = call(['validate']); assert.equal(validation.exit_code, 0, validation.stdout + validation.stderr);
  const list = call(['list', '--json']); assert.equal(list.exit_code, 0); const entries = JSON.parse(list.stdout); assert.equal(entries.length, 1); assert.equal(entries[0].status, 'Proposed'); assert.equal(entries[0].title, c.source.decision.title);
  const forged = finalText.replace('- **Status:** Proposed', '- **Status:** Invented'); assert.notEqual(forged, finalText);
  writeFileSync(file, forged); const mutation = call(['validate']); assert.notEqual(mutation.exit_code, 0, 'invented status must be rejected');
  writeFileSync(file, finalText); assert.equal(sha256(readFileSync(file)), sha256(finalText));
  write(join(directory, 'calls.json'), calls);
  results.push({ ...publicInput(input), status: 'pass', format_sections: headings, scaffold_sha256: sha256(original), persisted_sha256: sha256(finalText), body_sha256: sha256(input.text), validation_exit: validation.exit_code, invalid_status_rejected: true, final_status: entries[0].status, calls_sha256: sha256(readFileSync(join(directory, 'calls.json'))) });
}
assertCandidateCommandUnchanged(binding);
write(join(output, 'report.json'), { status: 'pass', mode: mode ? 'preflight-reference-bodies' : 'actual-artifact-replay', artifacts: results.length, results, limits: ['Actual measured bodies are installed unchanged after real ADR scaffold metadata in private fixture roots. Real format, scaffold, validate and list commands run; invalid-status mutations are rejected.', 'The caller is controlled and local. No model acquisition, actual Git commit, supersession/status mutation in a user project, full graft proof or semantic quality certification by the metadata validator is claimed. Manual source-fact review is separate.'] });
console.log(JSON.stringify({ status: 'pass', artifacts: results.length, mode: mode ? 'preflight' : 'actual-artifact-replay' }));
