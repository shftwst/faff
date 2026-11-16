import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const cli = fileURLToPath(new URL('../plugin/skills/faff/bin/faff', import.meta.url));
const fixture = JSON.parse(readFileSync(new URL('../eval/control-parity/fixtures/review-comments.json', import.meta.url)));
const oracle = JSON.parse(readFileSync(new URL('../eval/control-parity/expected-outcomes.json', import.meta.url)));
const open = '<!-- faff-review-findings:ISS-1 -->';
const close = '<!-- /faff-review-findings:ISS-1 -->';
const region = `${open}\nnew\n${close}`;
const input = (comments = [], faff_body = 'new') => ({ schema: 1, issue_id: 'ISS-1', faff_body, comments });
const hash = body => createHash('sha256').update(body).digest('hex');
function run(value, args = ['review-comment', 'plan', '--input', '-']) {
  return spawnSync(process.execPath, [cli, ...args], {
    input: typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
    encoding: 'utf8', timeout: 10_000, env: {}, cwd: '/tmp',
  });
}
function plan(value) {
  const result = run(value);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(parsed).sort(), ['action', 'body', 'comment_id', 'expectedDigest', 'reason', 'schema']);
  return parsed;
}

for (const scenario of fixture.scenarios) {
  test(`independent oracle: ${scenario.id}`, () => {
    const expected = oracle.scenarios[scenario.id];
    const effect = expected.effects[0];
    const selected = scenario.tracker.comments.find(c => c.id === effect.args.id);
    assert.deepEqual(plan({ schema: 1, issue_id: scenario.issue_id, faff_body: scenario.faff_body, comments: scenario.tracker.comments }), {
      schema: 1, action: effect.op === 'create_comment' ? 'create' : 'update',
      reason: expected.terminal.reason, comment_id: selected?.id ?? null,
      body: effect.args.body, expectedDigest: selected ? hash(selected.body) : null,
    });
  });
}

test('preserves Unicode, CRLF and shell-like text outside the first pair across repeated updates', () => {
  const prefix = 'café 🦊\r\n$(touch /tmp/never-run)\r\n';
  const suffix = `\nHuman steering\r\n${open}\nkeep later pair\n${close}\r\n`;
  const original = `${prefix}${open} \r\nold\r\n${close}\t\r${suffix}`;
  const replacement = 'new\r\nUnicode: 🦊\n`$(printf nope)`';
  const first = plan(input([{ id: 'one', body: original }], replacement));
  const wanted = `${prefix}${open}\n${replacement}\n${close}${suffix}`;
  assert.equal(first.body, wanted);
  assert.equal(first.expectedDigest, hash(original));
  const second = plan(input([{ id: 'one', body: first.body }], replacement));
  assert.equal(second.body, wanted);
  assert.equal(second.comment_id, 'one');
  assert.equal(second.expectedDigest, hash(wanted));
});

for (const [name, body, action] of [
  ['close before open', `${close}\n${open}\nold`, 'create'],
  ['foreign close before own open', `<!-- /faff-review-findings:OTHER -->\n${open}\nold`, 'update'],
  ['quoted marker', `> ${open}\nold\n> ${close}`, 'create'],
  ['inline marker', `text ${open}\nold`, 'create'],
  ['indented open', ` ${open}\nold\n${close}`, 'create'],
  ['tilde fenced pair', `~~~text\n${open}\nold\n${close}\n~~~`, 'create'],
  ['three-space fence', `   ~~~\n${open}\nold\n${close}\n   ~~~`, 'create'],
  ['four-space fence is ordinary text', `    ~~~\n${open}\nold\n${close}\n    ~~~`, 'update'],
  ['short closing fence stays open', `~~~~\n~~~\n${open}\nold\n${close}`, 'create'],
  ['wrong closing fence stays open', `~~~\n\x60\x60\x60\n${open}\nold\n${close}`, 'create'],
  ['closing fence with info stays open', `~~~\n~~~ trailing\n${open}\nold\n${close}`, 'create'],
  ['long closing fence closes', `~~~\nfenced\n~~~~ \t\n${open}\nold\n${close}`, 'update'],
  ['unclosed existing fence hides marker', `\x60\x60\x60js\n${open}\nold\n${close}`, 'create'],
  ['backtick in opening info disqualifies fence', `\x60\x60\x60 js\x60x\n${open}\nold\n${close}`, 'update'],
]) {
  test(`marker boundaries: ${name}`, () => {
    const result = plan(input([{ id: 'one', body }]));
    assert.equal(result.action, action);
    assert.equal(result.comment_id, action === 'update' ? 'one' : null);
    assert.equal(result.expectedDigest, action === 'update' ? hash(body) : null);
    if (action === 'create') assert.equal(result.body, region);
  });
}

test('complete pairs outrank older open-only comments without deleting duplicates', () => {
  const comments = [
    { id: 'old', body: `${open}\nold`, created_at: '2000-01-01T00:00:00Z' },
    { id: 'new', body: `${open}\nold\n${close}`, created_at: '2026-01-01T00:00:00Z' },
  ];
  const result = plan(input(comments));
  assert.equal(result.comment_id, 'new');
  assert.equal(result.reason, 'reconciled');
  assert.equal(result.body, region);
});

test('the pure planner leaves the supplied comments and their metadata unchanged', () => {
  const { planReviewComment } = createRequire(import.meta.url)('../plugin/skills/faff/bin/lib/review-comment.js');
  const original = input([
    { id: 'one', body: `${open}\nold\n${close}`, author: { name: 'human' } },
    { id: 'two', body: `${open}\nleave me\n${close}` },
  ]);
  const before = structuredClone(original);
  const result = planReviewComment(original);
  assert.equal(result.comment_id, 'one');
  assert.equal(result.body, region);
  assert.deepEqual(original, before);
});

test('orders actual timestamp instants, keeps ties in listing order, and puts missing dates last', () => {
  const body = `${open}\nold\n${close}`;
  const result = plan(input([
    { id: 'missing', body }, { id: 'null', body, created_at: null },
    { id: 'later', body, created_at: '2026-01-01T00:00:00Z', author: 'faff' },
    { id: 'first-tie', body, created_at: '2026-01-01T00:30:00+01:00' },
    { id: 'second-tie', body, created_at: '2025-12-31T23:30:00.000Z' },
  ]));
  assert.equal(result.comment_id, 'first-tie');
  assert.equal(result.reason, 'reconciled');
});

test('all missing timestamps keep listing order and authorship has no effect', () => {
  const body = `${open}\nold\n${close}`;
  assert.equal(plan(input([{ id: 'first', body }, { id: 'second', body, author: 'faff' }])).comment_id, 'first');
});

for (const replacement of ['', `\x60\x60\x60\n${open}\n${close}\n\x60\x60\x60`, `> ${open}\ntext ${close}`, '<!-- faff-review-findings:OTHER -->']) {
  test(`replacement data remains exact: ${JSON.stringify(replacement)}`, () => {
    const result = plan(input([], replacement));
    assert.equal(result.body, `${open}\n${replacement}\n${close}`);
    assert.equal(plan(input([{ id: 'one', body: result.body }], replacement)).body, result.body);
  });
}

const invalid = [
  ['schema', { ...input(), schema: 2 }], ['unknown field', { ...input(), surprise: true }],
  ['missing replacement', { schema: 1, issue_id: 'ISS-1', comments: [] }],
  ['non-string replacement', input([], 2)], ['comments object', input({})],
  ['missing comment body', input([{ id: 'one' }])], ['empty comment id', input([{ id: '', body: '' }])],
  ['duplicate ids', input([{ id: 'one', body: '' }, { id: 'one', body: '' }])],
  ['whitespace issue', { ...input(), issue_id: 'ISS 1' }], ['HTML issue', { ...input(), issue_id: 'ISS>1' }],
  ['C1 control in issue', { ...input(), issue_id: 'ISS\u00851' }],
  ['surrogate body', input([], '\ud800')], ['surrogate metadata', input([{ id: 'one', body: '', author: '\udc00' }])],
  ['active open in replacement', input([], open)], ['active close in replacement', input([], close)],
  ['unclosed replacement fence', input([], '~~~\nexample')],
  ['duplicate JSON keys', '{"schema":1,"schema":1,"issue_id":"ISS-1","faff_body":"new","comments":[]}'],
  ['escaped duplicate keys', '{"schema":1,"\\u0073chema":1,"issue_id":"ISS-1","faff_body":"new","comments":[]}'],
  ['nested duplicate keys', '{"schema":1,"issue_id":"ISS-1","faff_body":"new","comments":[{"id":"one","body":"","author":{"x":1,"x":2}}]}'],
  ['overflow number metadata', '{"schema":1,"issue_id":"ISS-1","faff_body":"new","comments":[{"id":"one","body":"","n":1e999}]}'],
  ['multiple JSON values', '{} {}'], ['malformed JSON', '{'], ['invalid UTF8', Buffer.from([0xff])],
  ['oversized input', ' '.repeat(1024 * 1024 + 1)],
];
for (const timestamp of ['', 'yesterday', 1, '2026-02-29T00:00:00Z', '2026-01-01', '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00.1234Z', '2026-01-01T00:00:00+24:00']) {
  invalid.push([`invalid timestamp ${JSON.stringify(timestamp)}`, input([{ id: 'one', body: '', created_at: timestamp }])]);
}
for (const [name, value] of invalid) {
  test(`refuses ${name} without a write plan`, () => {
    const result = run(value);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /review-comment/);
  });
}

for (const args of [[], ['plan'], ['plan', '--input', 'file.json'], ['plan', '--input', '-', '--extra'], ['plan', '--input', '-', '--input', '-']]) {
  test(`rejects unsupported arguments ${JSON.stringify(args)}`, () => {
    const result = run(input(), ['review-comment', ...args]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  });
}
