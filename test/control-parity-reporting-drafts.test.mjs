import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessReportingDrafts } from '../verification/experiments/2026-11-16-skill-diet/assess-reporting-drafts-v1.mjs';

const evidence = resolve(import.meta.dirname, '../verification/experiments/2026-11-16-skill-diet');
const json = path => JSON.parse(readFileSync(resolve(evidence, path)));
function fixture() {
  return { capture: json('beep-reporting-mcp-preflight-v1/capture.json'), expected: json('beep-reporting-mcp-preflight-v1/expected.json'), fixture: json('workflow-fixtures/beep-reporting-v1.json') };
}
const assess = value => assessReportingDrafts(value.capture, value.expected, value.fixture);
const resequence = value => value.capture.events.forEach((event, index) => { event.seq = index + 1; });
function addDiscarded(value, channel = 'conversation') {
  const index = value.capture.events.findIndex(event => event.name === 'normalise_output' && event.args.channel === channel);
  const draft = structuredClone(value.capture.events[index]);
  draft.args.text = 'An unpublished draft with a factual copying error.';
  draft.result.text = draft.args.text;
  draft.result.id += ':unused';
  value.capture.events.splice(index, 0, draft); resequence(value);
  return draft;
}
const firstPost = value => value.capture.events.find(event => event.name === 'publish' && event.args.channel === 'conversation');
const firstChosen = value => value.capture.events.find(event => event.name === 'normalise_output' && event.result.id === firstPost(value).args.normalised_id);

test('draft assessment preserves all six canonical execution cases and raw grade', () => {
  const result = assess(fixture());
  assert.equal(result.raw.status, 'pass'); assert.equal(result.status, 'pass');
  assert.equal(result.discarded_drafts.length, 0);
});
for (const channel of ['tracker', 'conversation']) test(`unpublished corrected draft is allowed on ${channel}, retaining its raw failure and overhead`, () => {
  const value = fixture(); addDiscarded(value, channel);
  const before = JSON.stringify(value.capture), result = assess(value);
  assert.equal(result.raw.status, 'fail'); assert.equal(result.status, 'pass', JSON.stringify(result.errors));
  assert.equal(result.discarded_drafts.length, 1);
  assert.equal(result.normalisation_calls, 9);
  assert.equal(JSON.stringify(value.capture), before);
});

const mutations = [
  ['unknown operation', value => { const event = structuredClone(value.capture.events[0]); event.name = 'unknown_operation'; value.capture.events.splice(1, 0, event); resequence(value); }],
  ['publish typo draft', value => { const draft = addDiscarded(value), post = firstPost(value); post.args.normalised_id = draft.result.id; post.result.text = draft.result.text; }],
  ['publish both bad and corrected drafts', value => { const draft = addDiscarded(value), post = structuredClone(firstPost(value)); post.args.normalised_id = draft.result.id; post.result.text = draft.result.text; value.capture.events.splice(draft.seq, 0, post); resequence(value); }],
  ['cross-channel normalisation reference', value => { firstPost(value).args.normalised_id = value.capture.events.find(event => event.name === 'normalise_output' && event.args.channel === 'tracker').result.id; }],
  ['cross-case normalisation reference', value => { firstPost(value).args.normalised_id = value.capture.events.find(event => event.name === 'normalise_output' && event.case_id === 'review-holds' && event.args.channel === 'conversation').result.id; }],
  ['nonexistent normalisation reference', value => { firstPost(value).args.normalised_id = 'fabricated'; }],
  ['publication before normalisation', value => { const post = firstPost(value), index = value.capture.events.indexOf(post); value.capture.events.splice(index, 1); value.capture.events.splice(0, 0, post); resequence(value); }],
  ['altered publication bytes', value => { firstPost(value).result.text += ' Additional claim.'; }],
  ['post-publication correction', value => { const draft = addDiscarded(value), index = value.capture.events.indexOf(draft); value.capture.events.splice(index, 1); value.capture.events.splice(value.capture.events.indexOf(firstPost(value)) + 1, 0, draft); resequence(value); }],
  ['summary file changed', value => { value.capture.cases[0].summary += ' altered'; }],
  ['authority changed', value => { value.capture.cases[0].after.extra = 'mutation'; }],
  ['missing case', value => { value.capture.events = value.capture.events.filter(event => event.case_id !== 'dirty-install'); resequence(value); }],
  ['tool error', value => { value.capture.errors.push({ message: 'failure' }); }],
  ['duplicate normalisation id', value => { const draft = addDiscarded(value); draft.result.id = firstChosen(value).result.id; }],
  ['normalisation result differs from input', value => { firstChosen(value).result.text += ' altered'; }],
  ['publication not acknowledged', value => { firstPost(value).result.acknowledged = false; }],
  ['publication result channel differs', value => { firstPost(value).result.channel = 'tracker'; }],
  ['publication target differs', value => { firstPost(value).result.target = 'wrong'; }],
  ['duplicate summary command', value => { const event = structuredClone(value.capture.events.find(event => event.name === 'run_faff')); value.capture.events.splice(1, 0, event); resequence(value); }],
  ['missing tracker economics', value => { const post = value.capture.events.find(event => event.name === 'publish' && event.args.channel === 'tracker'), chosen = value.capture.events.find(event => event.name === 'normalise_output' && event.result.id === post.args.normalised_id); post.result.text = post.result.text.split('\n\nEconomics:')[0]; chosen.args.text = post.result.text; chosen.result.text = post.result.text; }],
  ['normalisation before canonical command', value => { const draft = addDiscarded(value); value.capture.events.splice(value.capture.events.indexOf(draft), 1); value.capture.events.unshift(draft); resequence(value); }],
  ['normalisation on continuation', value => { const draft = addDiscarded(value); draft.case_id = 'no-budget-continuation'; draft.args.case_id = draft.case_id; }],
  ['normalisation on unreadable ledger', value => { const draft = addDiscarded(value); draft.case_id = 'unreadable-ledger'; draft.args.case_id = draft.case_id; }],
  ['unknown normalisation channel', value => { addDiscarded(value).args.channel = 'unknown'; }],
];
for (const [name, mutate] of mutations) test(`draft assessment rejects ${name}`, () => {
  const value = fixture(); mutate(value);
  assert.equal(assess(value).status, 'fail');
});
