import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditCodexEvents } from './codex-native-audit.mjs';
import { sha256 } from './schema.mjs';

export function auditSolEvents(events, sample) {
  const result = auditCodexEvents(events, sample);
  const problems = result.problems.filter(p => p.problem !== 'model-or-effort-differs');
  if (result.model_ids.length !== 1 || result.model_ids[0] !== 'gpt-6.1-sol'
      || result.efforts.length !== 1 || result.efforts[0] !== 'medium') {
    problems.push({ problem: 'model-or-effort-differs' });
  }
  return { ...result, status: problems.length ? 'fail' : result.complete ? 'pass' : 'incomplete', problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [rolloutPath, samplePath, outputPath] = process.argv.slice(2);
  if (!outputPath) throw Error('usage: codex-sol-native-audit.mjs PRIVATE_ROLLOUT SAMPLE NEW_OUTPUT');
  const bytes = readFileSync(rolloutPath), events = bytes.toString('utf8').trim().split('\n').map(JSON.parse);
  const report = {
    schema: 1, scope: 'Metadata only. Sol-medium expectation with the unchanged literal-tool and delivery checks. No reasoning or tool contents exported.',
    auditor_sha256: sha256(readFileSync(new URL(import.meta.url))),
    core_auditor_sha256: sha256(readFileSync(new URL('./codex-native-audit.mjs', import.meta.url))),
    classifier_sha256: sha256(readFileSync(new URL('./native-tool-audit.mjs', import.meta.url))),
    source_sha256: sha256(bytes), runs: [auditSolEvents(events, JSON.parse(readFileSync(samplePath)))],
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ name: report.runs[0].name, status: report.runs[0].status }));
}
