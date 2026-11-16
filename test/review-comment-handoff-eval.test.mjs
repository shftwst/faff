import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bindCandidateCommand } from '../eval/control-parity/candidate-command.mjs';
import { buildPromptBundle, HANDOFF_ALLOWED_TOOLS } from '../eval/control-parity/claude-driver.mjs';
import { openHandoff, readHandoffEvents, gradeHandoff } from '../eval/control-parity/handoff-tools.mjs';
import { createFixtureTracker, loadPolicyBytes } from '../eval/control-parity/tracker.mjs';
import { loadInputs } from '../eval/control-parity/run.mjs';

test('handoff treatment removes model-authored tracker writes and preserves earlier tool treatments', () => {
  const input = { issue_id: 'X', faff_body: 'text', reason_codes: ['updated'] };
  const options = { input, policyBytes: Buffer.from('policy') };
  assert.deepEqual(buildPromptBundle({ ...options, handoff: true }).allowed_tools, HANDOFF_ALLOWED_TOOLS);
  assert.deepEqual(HANDOFF_ALLOWED_TOOLS, ['mcp__tracker__prepare_review_comment', 'mcp__tracker__apply_review_comment', 'mcp__tracker__finish']);
  assert.equal(buildPromptBundle(options).allowed_tools.length, 4);
  assert.equal(buildPromptBundle({ ...options, candidate: true }).allowed_tools.length, 5);
  assert.throws(() => buildPromptBundle({ ...options, candidate: true, handoff: true }), /treatment/);
});

test('bound eval executes shipped connector and catches an escaping mutation independently', async t => {
  const root = resolve('.');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const binding = bindCandidateCommand(root, commit);
  const { fixtures } = loadInputs(root);
  const fixture = fixtures.get('crlf-outside-region');
  const directory = mkdtempSync(join(tmpdir(), 'faff-handoff-eval-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const tracker = createFixtureTracker({ directory, issueId: fixture.issue_id, initialState: fixture.tracker });
  const handoff = await openHandoff({ binding, directory });
  t.after(() => handoff.close());
  const prepared = await handoff.call('prepare_review_comment', { issue_id: fixture.issue_id, faff_body: fixture.faff_body });
  const applied = await handoff.call('apply_review_comment', { plan_ref: prepared.plan_ref });
  await handoff.call('finish', { status: 'completed', reason: applied.reason });
  const calls = readHandoffEvents(directory);
  const events = tracker.readEvents();
  assert.equal(gradeHandoff({ calls, events, fixture }).status, 'followed');
  const tampered = structuredClone(events);
  const write = tampered.find(e => e.kind === 'effect-attempt');
  write.args.body = JSON.stringify(write.args.body).slice(1, -1);
  assert.equal(gradeHandoff({ calls, events: tampered, fixture }).status, 'effect-mismatch');
  assert.ok(loadPolicyBytes(root).includes('apply_review_comment'));
});
