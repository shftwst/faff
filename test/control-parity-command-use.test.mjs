import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommandAdapter, gradeCommandUse, readCommandEvents } from '../eval/control-parity/command-use.mjs';
import { createFixtureTracker } from '../eval/control-parity/tracker.mjs';
import { handleMessage } from '../eval/control-parity/tool-server.mjs';
import { CommandInputError } from '../eval/control-parity/candidate-command.mjs';

const fixture = { issue_id: 'ISS-1', faff_body: 'new $HOME `data`\r\n', tracker: { comments: [{ id: 'human', body: 'keep\r\nthis' }], next_comment_id: 'new', now: '2026-11-15T00:00:00Z' } };
const plan = { schema: 1, action: 'create', reason: 'created', comment_id: null, body: 'planned body', expectedDigest: null };
function setup(invoke = () => ({ plan, evidence: { error: null, elapsed_ms: 7 } })) {
  const directory = mkdtempSync(join(tmpdir(), 'faff-command-use-'));
  const tracker = createFixtureTracker({ directory, initialState: fixture.tracker, issueId: fixture.issue_id });
  const adapter = createCommandAdapter({ binding: {}, directory, tracker, invoke });
  const grade = () => gradeCommandUse({ commands: readCommandEvents(directory), events: tracker.readEvents(), fixture });
  const call = args => handleMessage(tracker, { id: 1, method: 'tools/call', params: { name: 'plan_review_comment', arguments: args } }, () => {}, adapter);
  const read = async () => ({ schema: 1, issue_id: fixture.issue_id, faff_body: fixture.faff_body, comments: (await tracker.ports.list_comments({ issue_id: fixture.issue_id })).comments });
  const apply = async (body = plan.body) => {
    await tracker.ports.create_comment({ issue_id: fixture.issue_id, body });
    await tracker.ports.finish({ status: 'completed', reason: plan.reason });
  };
  return { directory, tracker, adapter, grade, call, read, apply };
}

test('baseline tools remain unchanged; only the candidate gets the planner tool', async () => {
  const s = setup();
  const request = { id: 1, method: 'tools/list' };
  const baseline = await handleMessage(s.tracker, request);
  const candidate = await handleMessage(s.tracker, request, () => {}, s.adapter);
  assert.equal(baseline.result.tools.length, 4);
  assert.equal(candidate.result.tools.length, 5);
  assert.equal(candidate.result.tools.at(-1).name, 'plan_review_comment');
});

test('command inputs and results are durably recorded without becoming tracker effects', async () => {
  const s = setup();
  const input = await s.read();
  const result = await s.call(input);
  assert.equal(result.result.isError, false);
  assert.deepEqual(JSON.parse(result.result.content[0].text), plan);
  const events = readCommandEvents(s.directory);
  assert.equal(events.length, 2);
  assert.equal(events[0].after_event_seq, 1);
  assert.deepEqual(events[0].input, input);
  assert.equal(s.tracker.readEvents().length, 1);
  await s.apply();
  assert.deepEqual(s.grade(), { status: 'followed', calls: 1, command_ms: 7 });
});

test('a successful tracker operation without the command is not extraction evidence', async () => {
  const s = setup(); await s.read(); await s.apply();
  assert.equal(s.grade().status, 'not-used');
});

test('copying comments with CRLF normalised is an input mismatch', async () => {
  const s = setup(); const input = await s.read();
  input.comments[0].body = input.comments[0].body.replaceAll('\r\n', '\n');
  await s.call(input); await s.apply();
  assert.equal(s.grade().status, 'input-mismatch');
});

test('a planner called without reading current comments cannot count as followed', async () => {
  const s = setup();
  await s.call({ schema: 1, issue_id: fixture.issue_id, faff_body: fixture.faff_body, comments: fixture.tracker.comments });
  await s.apply(); assert.equal(s.grade().status, 'input-mismatch');
});

test('wrong body, wrong target, duplicate writes and wrong finish reason are not followed', async () => {
  for (const mutate of ['body', 'target', 'duplicate', 'reason']) {
    const s = setup(); await s.call(await s.read());
    if (mutate === 'target') await s.tracker.ports.save_comment({ id: 'human', body: plan.body });
    else await s.tracker.ports.create_comment({ issue_id: fixture.issue_id, body: mutate === 'body' ? 'wrong' : plan.body });
    if (mutate === 'duplicate') await s.tracker.ports.create_comment({ issue_id: fixture.issue_id, body: plan.body });
    await s.tracker.ports.finish({ status: 'completed', reason: mutate === 'reason' ? 'updated' : 'created' });
    assert.equal(s.grade().status, 'not-followed', mutate);
  }
});

test('a command failure returns an error and cannot be hidden by a later successful write', async () => {
  const s = setup(() => ({ plan: null, evidence: { error: 'invalid-plan', elapsed_ms: 3, exit_code: 0, stderr: '' } }));
  assert.equal((await s.call(await s.read())).result.isError, true);
  await s.apply(); assert.equal(s.grade().status, 'command-error');
});

test('a refused invocation is retained and invalidates the attempt', async () => {
  const s = setup(() => { throw new Error('candidate artifact changed'); });
  assert.equal((await s.call(await s.read())).result.isError, true);
  assert.match(readCommandEvents(s.directory)[1].evidence.error, /changed/);
  assert.ok(s.tracker.readEvents().some(e => e.kind === 'protocol-violation'));
  assert.equal(s.grade().status, 'incomplete');
});

test('model input errors are candidate failures, even if the model later completes a write', async () => {
  const s = setup(() => { throw new CommandInputError('invalid candidate command input'); });
  assert.equal((await s.call(await s.read())).result.isError, true);
  await s.apply();
  assert.equal(readCommandEvents(s.directory)[1].evidence.reason, 'command-input-invalid');
  assert.ok(!s.tracker.readEvents().some(e => e.kind === 'protocol-violation'));
  assert.equal(s.grade().status, 'command-error');
});

test('post-finish planner calls are refused and remain visible', async () => {
  const s = setup(); const input = await s.read(); await s.call(input); await s.apply();
  assert.equal((await s.call(input)).result.isError, true);
  assert.ok(s.tracker.readEvents().some(e => e.reason === 'post-finish-call'));
  assert.equal(s.grade().status, 'incomplete');
});

test('an unfinished command or stopped trace is incomplete', async () => {
  const s = setup(); await s.call(await s.read()); await s.apply();
  const commands = readCommandEvents(s.directory);
  assert.equal(gradeCommandUse({ commands: commands.slice(0, 1), events: s.tracker.readEvents(), fixture }).status, 'incomplete');
  assert.equal(gradeCommandUse({ commands, events: s.tracker.readEvents(), fixture, stop: { reason: 'timeout' } }).status, 'incomplete');
});

test('a command after the write does not establish use of the plan', async () => {
  const s = setup(); const input = await s.read();
  await s.tracker.ports.create_comment({ issue_id: fixture.issue_id, body: plan.body });
  await s.call(input); await s.tracker.ports.finish({ status: 'completed', reason: 'created' });
  assert.equal(s.grade().status, 'not-used');
});

test('the local command call cap refuses further work', async () => {
  const s = setup();
  const adapter = createCommandAdapter({ binding: {}, directory: s.directory, tracker: s.tracker, maxCalls: 1, invoke: () => ({ plan, evidence: { error: null, elapsed_ms: 1 } }) });
  const input = await s.read(); await adapter.call(input);
  await assert.rejects(adapter.call(input), /limit/);
  assert.equal(s.grade().status, 'command-error');
});
