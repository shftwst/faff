import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { gradeRenderedArtifact } from './rendering-artifact.mjs';
import { sha256 } from './schema.mjs';
import { bindCandidateCommand, assertCandidateCommandUnchanged } from './candidate-command.mjs';

const require = createRequire(import.meta.url);
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export function replayNlspec({ runtimeRoot, directory, text, row }) {
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(directory, '.faff'));
  writeFileSync(join(directory, '.faff/config.yaml'), 'tracking:\n  tracker: linear\nslots:\n  spec: faffter-dark-nlspec\n');
  const spec = join(directory, 'spec.md'), cli = join(runtimeRoot, 'plugin/skills/faff/bin/faff');
  writeFileSync(spec, text);
  const commands = [], problems = [], expected = row.consumer;
  const run = (name, args, input) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: directory, input, encoding: 'utf8', env: { ...process.env, FAFF_SESSION_ID: '', FAFF_RUN_DIR: '' } });
    let value;
    try { value = JSON.parse(result.stdout); } catch { value = null; }
    commands.push({ name, argv: args, stdin_sha256: input === undefined ? null : sha256(input), exit_code: result.status, stdout: result.stdout, stderr: result.stderr });
    return { code: result.status, value };
  };
  const check = (pass, name) => { if (!pass) problems.push(name); };
  const artifact = gradeRenderedArtifact(text, row.oracle);
  check(artifact.pass, 'artifact-rules');
  const { readinessBlocks, stampConfidence } = require(join(runtimeRoot, 'plugin/skills/faff/bin/lib/prep-attach.js'));
  const blocks = readinessBlocks(text);
  let payload;
  try { payload = blocks.length === 1 ? JSON.parse(blocks[0]) : null; } catch { payload = null; }
  check(blocks.length === 1 && payload, 'single-valid-contract');
  check(blocks.length === 1 && /^(?:`{3,}|~{3,})$/.test(text.slice(text.lastIndexOf(blocks[0]) + blocks[0].length).trim()), 'contract-is-last');
  const markerKeys = payload && Object.keys(payload).sort().join(',') === 'confidence,decisions';
  const decisions = payload?.decisions;
  check(markerKeys && payload.confidence === expected.confidence && stampConfidence(text) === expected.confidence, 'confidence-and-contract-shape');
  check(Array.isArray(decisions) && decisions.length > 0 && decisions.every(d => d && Object.keys(d).join(',') === 'marker' && ['chosen', 'punt'].includes(d.marker)) && decisions.some(d => d?.marker === 'chosen'), 'declared-decision-shape');
  check(Array.isArray(decisions) && decisions.filter(d => d?.marker === 'punt').length === expected.blocking_punts + expected.eligible_punts, 'declared-punt-count');
  if (payload) {
    const contract = run('contract', ['contract', 'spec-readiness'], JSON.stringify({ ...payload, provenance_present: true }));
    check(contract.code === 0 && contract.value?.markers_valid === true, 'real-contract-consumer');
  }
  const admissible = run('admissible', ['admissible', '--spec', spec, '--lights-out', '--json']);
  check(admissible.code === (expected.admissible ? 0 : 1) && admissible.value?.admissible === expected.admissible, 'admissibility');
  const dod = run('dod', ['dod', 'classify', '--spec', spec, '--json']);
  check(dod.code === 0 && Array.isArray(dod.value?.criteria), 'dod-classification');
  const criteria = dod.value?.criteria ?? [], scenarios = criteria.filter(c => c.source === 'scenarios');
  check(criteria.some(c => c.source === 'done'), 'done-present');
  check(scenarios.every(c => c.class !== 'prose' && !c.oracle_less), 'observable-scenarios');
  if (expected.holdouts) {
    const holdouts = scenarios.filter(c => c.holdout);
    const behavioural = scenarios.filter(c => c.class === 'scenario');
    check(behavioural.length === expected.behavioural_scenarios && behavioural.filter(c => !c.holdout).length === expected.visible_behavioural_scenarios, 'requested-behavioural-scenarios');
    check(holdouts.length === 1 && holdouts.length <= scenarios.length / 2 && scenarios.some(c => !c.holdout), 'holdout-selection');
    check(holdouts.every(c => c.verifier === 'holdout' && !/test\/|\.test\./.test(c.text)), 'holdout-observable-behaviour');
    check(scenarios.some(c => c.class === 'assertion' && /payload/i.test(c.text)), 'nonfunctional-scenario');
  } else check(!criteria.some(c => c.holdout), 'no-invented-holdout');
  if (!expected.admissible) check(scenarios.length === 0 && admissible.value?.checks?.find(c => c.id === 'R1.scenarios')?.pass === false, 'mechanical-no-forced-scenario');
  if (expected.review_test_item) {
    const repositoryChecks = criteria.filter(c => /test\/import-retry\.test\.ts/.test(c.text));
    check(repositoryChecks.length === 1 && repositoryChecks[0].source === 'done' && repositoryChecks[0].verifier === 'review-merge-floor', 'repository-test-floor');
    check(repositoryChecks.every(c => !/payload|attempt|original|transient|backoff/i.test(c.text)), 'repository-test-separated-from-behaviour');
  }
  const punt = run('punt', ['punt-scan', spec]);
  check(punt.code === 0 && punt.value?.blocking_open_count === expected.blocking_punts && punt.value?.eligible_count === expected.eligible_punts, 'punt-classification');
  check(Array.isArray(punt.value?.punts) && punt.value.punts.filter(p => p.non_blocking).length === expected.eligible_punts, 'punt-tag-kind');
  const attach = run('attach', ['prep', 'attach', '--issue', row.source.issue, '--spec', spec, '--mode', 'interactive', '--root', directory, '--json']);
  const attached = readFileSync(spec, 'utf8');
  check(attach.code === 0 && attach.value?.token === 'ready-to-post' && attach.value?.confidence === expected.confidence && attach.value?.admissibility?.admissible === expected.admissible, 'attach-consumption');
  check(attach.value?.spec_sha256 === sha256(attached) && readinessBlocks(attached).length === 1, 'attached-bytes');
  let marker;
  try { marker = JSON.parse(readFileSync(join(directory, '.faff/prep', row.source.issue + '.json'), 'utf8')); } catch { marker = null; }
  check(marker?.spec_produced === true && marker.attached === false && marker.spec_sha256 === sha256(attached), 'open-tracker-attach-marker');
  const result = { id: row.id, status: problems.length ? 'fail' : 'pass', problems, source_sha256: sha256(text), attached_sha256: sha256(attached), artifact, commands, expected };
  write(join(directory, 'replay.json'), result);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [runtimeRoot, commit, fixturePath, artifacts, output] = process.argv.slice(2);
  if (!output) throw new Error('usage: nlspec-replay.mjs RUNTIME_ROOT COMMIT FIXTURE ARTIFACT_DIRECTORY NEW_OUTPUT');
  const binding = bindCandidateCommand(resolve(runtimeRoot), commit);
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  mkdirSync(output);
  const cases = fixture.cases.map(row => replayNlspec({ runtimeRoot: resolve(runtimeRoot), directory: resolve(output, row.id), text: readFileSync(join(artifacts, row.id + '.md'), 'utf8'), row }));
  assertCandidateCommandUnchanged(binding);
  const report = { schema: 1, status: cases.every(c => c.status === 'pass') ? 'pass' : 'fail', binding, invoked_commands: ['contract spec-readiness', 'admissible', 'dod classify', 'punt-scan', 'prep attach'], fixture_sha256: sha256(readFileSync(fixturePath)), replay_sha256: sha256(readFileSync(new URL(import.meta.url))), cases, scope: 'Actual spec consumers in disposable local projects. Tracker attachment is staged but never published or confirmed; no full prep or self-review execution.' };
  write(join(output, 'report.json'), report);
  process.exitCode = report.status === 'pass' ? 0 : 1;
}
