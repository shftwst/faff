import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditCodexEvents } from './codex-native-audit.mjs';
import { sha256 } from './schema.mjs';

export function auditExpectedModelEvents(events, sample) {
  const result = auditCodexEvents(events, sample);
  const problems = result.problems.filter(p => p.problem !== 'model-or-effort-differs');
  const supported = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra'].includes(sample.expected_model)
    && ['low', 'medium', 'high'].includes(sample.expected_effort);
  if (!supported || result.model_ids.length !== 1 || result.model_ids[0] !== sample.expected_model
      || result.efforts.length !== 1 || result.efforts[0] !== sample.expected_effort) {
    problems.push({ problem: 'model-or-effort-differs' });
  }
  return { ...result, expected_model: sample.expected_model ?? null, expected_effort: sample.expected_effort ?? null,
    status: problems.length ? 'fail' : result.complete ? 'pass' : 'incomplete', problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [rolloutPath, samplePath, outputPath] = process.argv.slice(2);
  if (!outputPath) throw Error('usage: codex-model-native-audit.mjs PRIVATE_ROLLOUT SAMPLE NEW_OUTPUT');
  const bytes = readFileSync(rolloutPath), sampleBytes = readFileSync(samplePath);
  const events = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const report = {
    schema: 1, scope: 'Metadata only. Explicit model/effort expectation with unchanged native transport and delivery checks.',
    auditor_sha256: sha256(readFileSync(new URL(import.meta.url))),
    core_auditor_sha256: sha256(readFileSync(new URL('./codex-native-audit.mjs', import.meta.url))),
    classifier_sha256: sha256(readFileSync(new URL('./native-tool-audit.mjs', import.meta.url))),
    expectation_sha256: sha256(sampleBytes), source_sha256: sha256(bytes),
    runs: [auditExpectedModelEvents(events, JSON.parse(sampleBytes))],
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ name: report.runs[0].name, status: report.runs[0].status }));
}
