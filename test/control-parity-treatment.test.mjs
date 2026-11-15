import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalHash, projection } from '../eval/control-parity/schema.mjs';
import { HARNESS_INSTRUCTION, CANDIDATE_HARNESS_INSTRUCTION } from '../eval/control-parity/claude-driver.mjs';
import { COMMAND_TOOL } from '../eval/control-parity/command-use.mjs';
import { treatmentRuntime, validateDeclarations, classifyPair } from '../eval/control-parity/treatments.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const registry = read('eval/control-parity/registry.json');
const decisions = read('eval/control-parity/policy-decisions.json');
const history = read('verification/experiments/2026-11-15-comment-policy-measure/run/run.json');
const fixtures = read('eval/control-parity/fixtures/review-comments.json');
const baselineBody = { model: 'm', max_tokens: 8192, system: [{ type: 'text', text: HARNESS_INSTRUCTION }], tools: [{ name: 'mcp__tracker__finish' }], messages: [{ role: 'user', content: [{ type: 'text', text: 'old prompt' }] }], metadata: { user_id: 'session-one' } };
const candidateBody = () => ({ ...structuredClone(baselineBody), system: [{ type: 'text', text: CANDIDATE_HARNESS_INSTRUCTION }], tools: [...baselineBody.tools, { name: `mcp__tracker__${COMMAND_TOOL.name}`, description: COMMAND_TOOL.description, input_schema: COMMAND_TOOL.inputSchema }], messages: [{ role: 'user', content: [{ type: 'text', text: 'new prompt' }] }], metadata: { user_id: 'session-two' } });

test('only the declared prompt, harness tool sentence, tool addition and session id normalise', () => {
  const baseline = treatmentRuntime(baselineBody, 'old prompt');
  const candidate = treatmentRuntime(candidateBody(), 'new prompt', { candidate: true });
  assert.deepEqual(baseline.problems, []);
  assert.deepEqual(candidate.problems, []);
  assert.equal(candidate.sha256, baseline.sha256);
  for (const mutate of [b => { b.max_tokens++; }, b => { b.temperature = 0.5; }, b => { b.tools[0].description = 'changed'; }, b => { b.system.push({ type: 'text', text: 'unrelated change' }); }, b => { b.metadata.extra = 'unknown'; }]) {
    const body = candidateBody(); mutate(body);
    assert.notEqual(treatmentRuntime(body, 'new prompt', { candidate: true }).sha256, baseline.sha256);
  }
});

test('a missing, duplicate, or changed planner tool cannot be treated as the declared addition', () => {
  for (const mutate of [b => b.tools.pop(), b => b.tools.push(b.tools.at(-1)), b => { b.tools.at(-1).input_schema = {}; }, b => { b.tools.at(-1).description = 'read the oracle'; }]) {
    const body = candidateBody(); mutate(body);
    assert.ok(treatmentRuntime(body, 'new prompt', { candidate: true }).problems.includes('candidate-tool'));
  }
});

test('missing or repeated prompt/harness content fails closed', () => {
  const body = candidateBody(); body.messages[0].content.push({ type: 'text', text: 'new prompt' });
  assert.ok(treatmentRuntime(body, 'new prompt', { candidate: true }).problems.includes('prompt'));
  body.system[0].text = 'different system';
  assert.ok(treatmentRuntime(body, 'new prompt', { candidate: true }).problems.includes('harness'));
});

const scenario = registry.scenarios.find(s => s.id === 'author-not-preferred');
const historical = history.traces.find(t => t.scenario === scenario.id);
const declaration = {
  scenario: scenario.id, input_sha256: scenario.input_sha256, policy_sha256: scenario.policy_sha256,
  candidate_expected_sha256: canonicalHash(scenario.expected), baseline_projection_sha256: canonicalHash(projection(historical)),
  candidate_projection_sha256: canonicalHash(projection(candidateTrace())),
  decision: 'author-preference', reason: 'Ignore authorship when selecting the first matching comment.',
};
const declarations = () => ({ schema: 1, decisions_sha256: canonicalHash(decisions), historical_run_sha256: canonicalHash(history), entries: [declaration] });

test('declarations bind the fixture, policy, candidate expectation, historical difference and operator decision', () => {
  assert.doesNotThrow(() => validateDeclarations(declarations(), { registry, decisions, history, fixtures }));
  for (const mutate of [
    d => { d.entries[0] = { ...declaration, scenario: '*' }; },
    d => { d.entries[0] = { ...declaration, decision: 'unknown' }; },
    d => { d.entries[0] = { ...declaration, candidate_expected_sha256: 'a'.repeat(64) }; },
    d => { d.entries[0] = { ...declaration, baseline_projection_sha256: 'a'.repeat(64) }; },
    d => { d.entries[0] = { ...declaration, allow_any: true }; },
    d => { d.entries.push(declaration); },
  ]) { const d = declarations(); mutate(d); assert.throws(() => validateDeclarations(d, { registry, decisions, history, fixtures })); }
});

function candidateTrace() {
  const e = scenario.expected.effects[0];
  return { ...historical, final_state_sha256: scenario.expected.final_state_sha256, stop: null, events: [
    historical.events[0], { seq: 2, kind: 'effect-attempt', id: 'e1', ...e },
    { seq: 3, kind: 'effect-result', attempt_id: 'e1', outcome: 'applied', acknowledged: true },
    { seq: 4, kind: 'terminal', ...scenario.expected.terminal, final_state_sha256: scenario.expected.final_state_sha256 },
  ] };
}
const grade = (overrides = {}) => classifyPair({ scenario, registry, baseline: historical, candidate: candidateTrace(), declaration, runtimeMatches: true, commandUse: 'followed', model: 'claude-opus-5-5', ...overrides });

test('an exact declared historical difference with a conforming candidate is classified separately', () => {
  assert.equal(grade().classification, 'declared-change');
  assert.equal(grade().baseline.status, 'fail');
  assert.equal(grade().candidate.status, 'pass');
  assert.ok(grade().event_differences.length > 0);
  assert.equal(grade({ baseline: candidateTrace() }).classification, 'preserved');
});

test('declared changes never waive candidate defects, skipped commands or missing evidence', () => {
  assert.equal(grade({ candidate: historical }).classification, 'candidate-failure');
  assert.equal(grade({ commandUse: 'not-used' }).classification, 'command-not-followed');
  assert.equal(grade({ runtimeMatches: false }).classification, 'incomplete');
  const incomplete = candidateTrace(); incomplete.accounting = { ...incomplete.accounting, usage_complete: false };
  assert.equal(grade({ candidate: incomplete }).classification, 'incomplete');
  const wrongModel = candidateTrace(); wrongModel.accounting = { ...wrongModel.accounting, served_models: ['other'] };
  assert.equal(grade({ candidate: wrongModel }).classification, 'incomplete');
  const extraWrite = structuredClone(historical); extraWrite.events[1].args.body += 'unapproved change';
  assert.equal(grade({ baseline: extraWrite }).classification, 'unexpected-difference');
  assert.equal(grade({ candidate: null }).classification, 'incomplete');
  const extraRead = candidateTrace();
  extraRead.events.splice(1, 0, structuredClone(extraRead.events[0]));
  extraRead.events.forEach((e, i) => { e.seq = i + 1; });
  assert.equal(grade({ candidate: extraRead }).classification, 'unexpected-difference');
});
