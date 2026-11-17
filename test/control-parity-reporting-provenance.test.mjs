import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyReportingProvenance } from '../verification/experiments/2026-11-16-skill-diet/verify-reporting-mcp-arm-v1.mjs';

const evidence = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet');
const json = name => JSON.parse(readFileSync(resolve(evidence, name)));
function fixture() {
  const run = 'workflow-runs/beep-reporting-mcp-v1-baseline-1/';
  const audit = json(run + 'native-audit.json'), assessment = json(run + 'draft-assessment-v1.json');
  return { audit, assessment, manifest: json(run + 'manifest.json'), plan: json('beep-reporting-mcp-v1-assessed-continuation-plan.json'), rawNativeHash: audit.source_sha256, auditorHash: audit.auditor_sha256, fixtureHash: assessment.fixture_sha256 };
}
test('genuine recorded reporting provenance matches its frozen bindings', () => { verifyReportingProvenance(fixture()); });
for (const [name, mutate] of [
  ['native evidence omission', value => { delete value.audit.evidence_hashes['capture.json']; }],
  ['empty native evidence map', value => { value.audit.evidence_hashes = {}; }],
  ['foreign native evidence entry', value => { value.audit.evidence_hashes.extra = 'unused'; }],
  ['changed native auditor', value => { value.audit.auditor_sha256 = 'different'; }],
  ['changed raw native capture', value => { value.audit.source_sha256 = 'different'; }],
  ['alternate runtime root', value => { value.manifest.binding.root += '-other'; }],
  ['alternate runtime commit', value => { value.manifest.binding.commit = '0'.repeat(40); }],
  ['assessment evidence omission', value => { delete value.assessment.source_hashes['native-audit.json']; }],
  ['empty assessment evidence map', value => { value.assessment.source_hashes = {}; }],
  ['changed assessment fixture', value => { value.assessment.fixture_sha256 = 'different'; }],
]) test(`reporting gate rejects ${name}`, () => { const value = fixture(); mutate(value); assert.throws(() => verifyReportingProvenance(value)); });
