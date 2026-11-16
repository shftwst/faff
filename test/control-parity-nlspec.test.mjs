import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { replayNlspec } from '../eval/control-parity/nlspec-replay.mjs';

const runtimeRoot = resolve(import.meta.dirname, '..');
const fixture = JSON.parse(readFileSync(join(runtimeRoot, 'verification/experiments/2026-11-16-skill-diet/workflow-fixtures/nlspec-format-v1.json'), 'utf8'));
function replay(row, text = row.reference) {
  const directory = mkdtempSync(join(tmpdir(), 'faff-nlspec-consumer-test-'));
  try { return replayNlspec({ runtimeRoot, directory, text, row }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('four reference specs preserve distinct real consumer outcomes', () => {
  for (const row of fixture.cases) assert.equal(replay(row).status, 'pass', row.id);
});

const retry = fixture.cases.find(c => c.id === 'retry-and-privacy');
const mutations = [
  ['missing contract', retry, s => s.replace(/```faff-contract:spec-readiness[\s\S]*$/, '')],
  ['text follows contract', retry, s => s + '\nAdditional unsupported appendix.\n'],
  ['duplicate contract', retry, s => s + s.slice(s.indexOf('```faff-contract:spec-readiness'))],
  ['contract confidence differs', retry, s => s.replace('"confidence": "high"', '"confidence": "low"')],
  ['prose confidence differs', retry, s => s.replace('confidence: high', 'confidence: low')],
  ['all scenarios withheld', retry, s => s.replace(/```\nGiven/g, '```holdout\nGiven')],
  ['required visible scenario omitted', retry, s => s.replace(/```\nGiven importOnce succeeds immediately[\s\S]*?```\n/, '')],
  ['scenario observable removed', retry, s => s.replace(/^Then .+$/gm, 'The desired result occurs.')],
  ['test file replaces holdout', retry, s => s.replace('Then it returns the third original error and makes no fourth attempt', 'Then test/import-retry.test.ts passes')],
  ['repository test mixes behaviour', retry, s => s.replace('test/import-retry.test.ts MUST pass.', 'test/import-retry.test.ts MUST pass and retries MUST return the original error.')],
  ['nonblocking punt loses tag', fixture.cases.find(c => c.id === 'deferred-punt'), s => s.replace('(non-blocking)', '')],
  ['blocking punt falsely deferred', fixture.cases.find(c => c.id === 'blocking-punt'), s => s.replace('**Punt:** SQLite', '**Punt:** SQLite (non-blocking)')],
];
for (const [name, row, mutate] of mutations) test('consumer replay rejects ' + name, () => {
  const changed = mutate(row.reference);
  assert.notEqual(changed, row.reference, 'mutation must change the artifact');
  assert.equal(replay(row, changed).status, 'fail');
});
