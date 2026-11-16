import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createChallengeEnvironment, gradeChallengeExecution } from '../eval/control-parity/challenge-execution.mjs';
const fixture = JSON.parse(readFileSync(new URL('../verification/experiments/2026-11-16-skill-diet/workflow-fixtures/challenges.json', import.meta.url)));

test('real challenge consumers admit a supported change and reject an absent skeptic', async () => {
  const root = mkdtempSync(join(tmpdir(), 'challenge-test-'));
  try {
    const f = { ...fixture, cases: fixture.cases.filter(c => ['adr-1', 'prdr-unavailable'].includes(c.id)) };
    const env = createChallengeEnvironment({ root, runtime: resolve('.'), fixture: f });
    const a = await env.call('submit_challenge', { case_id: 'adr-1', outcome: 'survived', ground: null, reason: 'The premise changed and the proposed layout addresses it.' });
    assert.equal(a.admission.disposition, 'admit');
    const p = await env.call('submit_challenge', { case_id: 'prdr-unavailable', outcome: 'absent', ground: null, reason: 'No independent opinion was obtained.' });
    assert.notEqual(p.admission.disposition, 'admit');
    assert.equal(gradeChallengeExecution(env.capture(), f).status, 'pass');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('misclassifying an unserved goal is caught even when the admission stays rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'challenge-test-'));
  try {
    const f = { ...fixture, cases: fixture.cases.filter(c => c.id === 'prdr-unserved') };
    const env = createChallengeEnvironment({ root, runtime: resolve('.'), fixture: f });
    const result = await env.call('submit_challenge', { case_id: 'prdr-unserved', outcome: 'overturned', ground: 'over-scope', reason: 'Incorrect ground for this test.' });
    assert.equal(result.admission.disposition, 'reject');
    const grade = gradeChallengeExecution(env.capture(), f);
    assert.equal(grade.status, 'fail');
    assert.ok(grade.cases[0].problems.includes('challenge-ground'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
