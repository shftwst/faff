import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { consumeSpecReviewArtifact } from '../eval/control-parity/spec-review-artifact.mjs';
import { gradeRenderedArtifact } from '../eval/control-parity/rendering-artifact.mjs';

const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/spec-review-producer.json', import.meta.url)));
test('persisted spec-review artifacts pass real contract and route consumers, while malformed and unfounded verdicts fail', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'spec-review-artifact-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '..');
  const consume = text => consumeSpecReviewArtifact(root, text, cwd);
  for (const c of fixture.cases) {
    assert.equal(gradeRenderedArtifact(c.reference, c.oracle).pass, true, c.id);
    const good = consume(c.reference);
    assert.equal(good.pass, true, c.id);
    assert.equal(good.producer_value.verdict, c.expected_verdict);
    assert.equal(good.route?.value?.destination ?? null, c.expected_route);
    assert.equal(consume(c.reference.replaceAll('\n', '\r\n')).pass, true);
    for (const bad of ['', c.reference + c.reference, c.reference.replace('"verdict":', 'broken:')]) assert.equal(consume(bad).pass, false);
  }
  for (const value of [
    { verdict: 'revise', objections: [] },
    { verdict: 'approve', objections: [{ lens: 'QA', severity: 'major' }] },
    { verdict: 'invented', objections: [] },
    { verdict: 'revise', objections: [{ lens: 'invented', severity: 'major' }] },
    { verdict: 'revise', objections: [{ lens: 'QA', severity: 'invented' }] },
  ]) assert.equal(consume('```faff-contract:spec-review-verdict\n' + JSON.stringify(value) + '\n```\n').pass, false);
});
