import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeRenderedArtifact } from '../eval/control-parity/rendering-artifact.mjs';
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/intake-brief.json', import.meta.url)));
test('intake form rubric rejects wrong modes, omitted required sections, mixed forms and claimed ticket writes', () => {
  for (const c of fixture.cases) {
    const grade = text => gradeRenderedArtifact(text, c.oracle);
    assert.equal(grade(c.reference).pass, true, c.id);
    const otherMode = c.source.mode === 'greenfield' ? 'single-item' : 'greenfield';
    const otherSection = c.source.mode === 'greenfield' ? 'Item' : 'Capabilities';
    for (const bad of [c.reference.replace('mode: ' + c.source.mode, 'mode: ' + otherMode), c.reference.replace('## Constraints', '## Different'), c.reference.replace('## Out of scope', '## Different'), c.reference + '\n## ' + otherSection + '\nInvented content.\n', c.reference + '\nI created a ticket.\n', c.reference + '\nREPORT-999 must ship first.\n']) assert.equal(grade(bad).pass, false, c.id);
  }
});
