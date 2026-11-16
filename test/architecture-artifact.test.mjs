import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { consumeArchitectureArtifact } from '../eval/control-parity/architecture-artifact.mjs';
import { gradeRenderedArtifact } from '../eval/control-parity/rendering-artifact.mjs';
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/architecture-proposal.json', import.meta.url)));
test('architecture artifacts pass real contract consumption and reject missing/duplicate blocks and malformed envelopes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'architecture-artifact-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, '..');
  for (const c of fixture.cases) {
    const consume = text => consumeArchitectureArtifact(root, text, directory);
    const good = consume(c.reference); assert.equal(good.pass, true, c.id); assert.ok(c.recommendations.includes(good.value.recommendation));
    assert.equal(gradeRenderedArtifact(c.reference, c.oracle).pass, true, c.id);
    assert.equal(consume(c.reference.replaceAll('\n', '\r\n')).pass, true);
    for (const bad of ['', c.reference + c.reference, c.reference.replace('"chosen_architecture":', 'broken:'), c.reference.replace(/"recommendation": "[^"]+"/, '"recommendation": "invented"'), c.reference.replace(/"chosen_architecture": "[^"]+"/, '"chosen_architecture": ""'), c.reference.replace(/"decision": "[^"]+"/, '"decision": ""')]) assert.equal(consume(bad).pass, false, c.id);
  }
});
