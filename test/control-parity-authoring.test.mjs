import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createAuthoringEnvironment, gradeAuthoringCapture, inspectAuthoredSkill, readReviewExample, reviewExampleConforms } from '../eval/control-parity/authoring-artifact.mjs';
import { sha256 } from '../eval/control-parity/schema.mjs';

const binding = { root: resolve(import.meta.dirname, '..'), entry: 'plugin/skills/faff/bin/faff' };
const renderer = '---\nname: test-renderer\njudgement_seam: none\n---\n# Test renderer\nFills rendering_adaptor, with no internal contract.\n## Define\nUse plain text.\n## Validate\nReturn pass for plain text, fail otherwise.\n';
const route = '---\nname: test-routing\njudgement_seam: routing\n---\n# Test routing\nFills routing_adaptor.\nRead sibling faff/references/kernel.md when standalone.\nAny recap is non-normative; gateway wins on conflict.\n';
const fixture = { cases: [
  { id: 'author', mode: 'author', slot: 'rendering_adaptor', source: {}, oracle: { structural_exit: 0, rubric: { must_include: ['rendering_adaptor'] } } },
  { id: 'validate', mode: 'validate', slot: 'routing_adaptor', source: { skill: route }, oracle: { structural_exit: 0, rubric: { must_include: ['signal: pass'] } } },
], rule_cases: [] };

async function captured(t) {
  const directory = mkdtempSync(join(tmpdir(), 'authoring-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = createAuthoringEnvironment({ directory, fixture, binding });
  await env.call('write_output', { case_id: 'author', text: renderer });
  await env.call('inspect_skill', { case_id: 'author' });
  await env.call('inspect_skill', { case_id: 'validate' });
  await env.call('write_output', { case_id: 'validate', text: 'signal: pass\n\n## Violations\nNone.\n' });
  return { env, capture: env.capture() };
}

test('authored and supplied exact skills pass real configured consumers without writes', async t => {
  const { capture } = await captured(t);
  assert.equal(gradeAuthoringCapture(capture, fixture).status, 'pass');
  for (const { result } of capture.inspections) {
    assert.equal(result.bundled.exit_code, 1);
    assert.equal(result.configured.exit_code, 0);
    assert.equal(result.configured.stderr, '');
    assert.equal(result.inputs_unchanged, true);
    assert.deepEqual(result.configured.env_keys, []);
    assert.ok(!result.configured.argv.includes('--allow-child-process'));
  }
});

test('real pre-check rejects a routing occupant without the refer-back', () => {
  const result = inspectAuthoredSkill(binding, 'routing_adaptor', route.replace('Read sibling faff/references/kernel.md when standalone.\n', ''));
  assert.equal(result.configured.exit_code, 1);
  assert.match(result.configured.stdout, /refer-back/);
});

test('structural success does not provide a semantic pass', async t => {
  const { capture } = await captured(t);
  const output = capture.outputs.find(row => row.id === 'validate');
  output.text = 'signal: fail\n';
  output.persisted_sha256 = sha256(output.text);
  assert.equal(gradeAuthoringCapture(capture, fixture).status, 'fail');
});

for (const [name, mutate] of [
  ['missing inspection', capture => { capture.inspections.pop(); }],
  ['duplicate inspection', capture => { capture.inspections.push(capture.inspections[0]); }],
  ['unexpected inspection', capture => { capture.inspections.push({ ...capture.inspections[0], id: 'unknown' }); }],
  ['different inspected bytes', capture => { capture.inspections[0].result.source_sha256 = '0'.repeat(64); }],
  ['inspection after Validate report', capture => { capture.events.reverse(); }],
  ['changed fixture config', capture => { capture.inspections[0].result.inputs_unchanged = false; }],
  ['command failure disguised as a lint exit', capture => { capture.inspections[0].result.configured.error = 'ETIMEDOUT'; }],
  ['CLI crash disguised as a lint exit', capture => { capture.inspections[0].result.configured.stderr = 'ERR_ACCESS_DENIED'; }],
  ['zero inspected occupants', capture => { capture.inspections[0].result.configured.stdout = 'RESULT: PASS (0 configured occupants structurally linted)'; }],
]) test(`qualification rejects ${name}`, async t => {
  const { capture } = await captured(t);
  mutate(capture);
  assert.equal(gradeAuthoringCapture(capture, fixture).status, 'fail');
});

test('inspection cannot precede an authored output or repeat', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'authoring-order-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = createAuthoringEnvironment({ directory, fixture, binding });
  await assert.rejects(env.call('inspect_skill', { case_id: 'author' }), /write the authored/);
  await env.call('inspect_skill', { case_id: 'validate' });
  await assert.rejects(env.call('inspect_skill', { case_id: 'validate' }), /duplicate/);
  assert.equal(env.capture().errors.length, 2);
});

const example = '```faff-contract:review-verdict\n{"signal":"pass","findings":[]}\n```\n';
const reviewExpected = { expected_signal: 'pass', expected_findings: [] };

test('the real fixed-contract consumer admits the exact converted review example', () => {
  const result = inspectAuthoredSkill(binding, 'review', example, { reviewExample: true });
  assert.equal(result.configured.exit_code, 0);
  assert.equal(reviewExampleConforms(result.review_example, reviewExpected, example), true);
  assert.equal(result.review_example.consumer.stdin, readReviewExample(example).input);
});

test('structural review success cannot admit an invented verdict', () => {
  const invalid = example.replace('"pass"', '"approved-with-risk"');
  const result = inspectAuthoredSkill(binding, 'review', invalid, { reviewExample: true });
  assert.equal(result.configured.exit_code, 0);
  assert.equal(result.review_example.consumer.exit_code, 1);
  assert.equal(reviewExampleConforms(result.review_example, reviewExpected, invalid), false);
});

test('missing, duplicate and malformed example blocks fail closed', () => {
  for (const text of ['', example + example, example.replace('"pass"', 'pass')]) {
    const result = inspectAuthoredSkill(binding, 'review', text || 'faff-contract:review-verdict', { reviewExample: true });
    assert.equal(result.review_example.parsed.status, 'fail');
    assert.equal(result.review_example.consumer, null);
  }
});

test('a conformant consumer result for different example bytes is rejected', () => {
  const result = inspectAuthoredSkill(binding, 'review', example, { reviewExample: true });
  const changed = example.replace('"pass"', '"fail"');
  assert.equal(reviewExampleConforms(result.review_example, reviewExpected, changed), false);
  result.review_example.consumer.stdin = '{}';
  assert.equal(reviewExampleConforms(result.review_example, reviewExpected, example), false);
});
