import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeRenderedArtifact } from '../eval/control-parity/rendering-artifact.mjs';
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/adr-body.json', import.meta.url)));
test('ADR body rubric keeps resolved section order and rejects invented sections, missing review and gated output', () => {
  for (const c of fixture.cases) {
    const grade = text => gradeRenderedArtifact(text, c.oracle);
    assert.equal(grade(c.reference).pass, true, c.id);
    const headings = [...c.reference.matchAll(/^## .+$/gm)].map(m => m[0]);
    const swapped = c.reference.replace(headings[0], '@FIRST@').replace(headings[1], headings[0]).replace('@FIRST@', headings[1]);
    for (const bad of [swapped, c.reference + '\n## Unrequested section\nNew facts.\n', c.reference.replace(/Self-review:[^\n]+/, ''), c.reference.replace(/confidence:[^\n]+/, ''), c.reference + '\n```faff-contract:prd-readiness\n{}\n```\n', c.reference + '\nADRWORK-999 was approved.\n']) assert.equal(grade(bad).pass, false, c.id);
  }
});
