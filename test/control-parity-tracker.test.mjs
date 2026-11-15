// Recorder validation with scripted control and decoy drivers over synthetic fixtures. Nothing here
// observes model behaviour or real connector guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalHash, compareRuns, parseStrictJson, sha256, validateRegistry, validateTrace } from '../eval/control-parity/schema.mjs';
import { captureScenario, createFixtureTracker, finalStateHash, loadPolicyBytes } from '../eval/control-parity/tracker.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const load = p => parseStrictJson(readFileSync(join(ROOT, p), 'utf8'));
const fixtures = load('eval/control-parity/fixtures/review-comments.json');
const expected = load('eval/control-parity/expected-outcomes.json');
const registry = load('eval/control-parity/registry.json');
const policy = loadPolicyBytes(ROOT);
const H = c => c.repeat(64);
const tmp = () => mkdtempSync(join(tmpdir(), 'cp-tracker-'));
const fixture = id => fixtures.scenarios.find(s => s.id === id);
const entry = id => registry.scenarios.find(s => s.id === id);
const SCRIPTED = { usage_complete: true, served_models: ['scripted-recorder-check'], requests: 0 };

// The control replays the independently written expectation; decoys model plausible wrong readings.
const control = id => async ({ ports, input }) => {
  await ports.list_comments({ issue_id: input.issue_id });
  for (const e of expected.scenarios[id].effects) await ports[e.op](e.args);
  await ports.finish(expected.scenarios[id].terminal);
  return { accounting: SCRIPTED };
};
const capture = (id, driver, faults = []) => captureScenario({
  driver, fixture: fixture(id), registryEntry: entry(id), directory: tmp(), policyBytes: policy,
  promptSha256: H('c'), runtimeSha256: H('d'), faults,
});

test('fixtures are synthetic, model-visible inputs carry no expected outcomes, and the registry binds their hashes', () => {
  validateRegistry(registry);
  assert.equal(sha256(policy), sha256(readFileSync(join(ROOT, 'verification/experiments/2026-11-14-controlled-skill-runs/review-comment-source.md'))));
  assert.deepEqual(registry.scenarios.map(s => s.id), fixtures.scenarios.map(s => s.id));
  for (const s of fixtures.scenarios) {
    const r = entry(s.id);
    const x = expected.scenarios[s.id];
    assert.equal(s.synthetic, true);
    assert.equal(r.synthetic, true);
    assert.equal(r.input_sha256, canonicalHash(s));
    assert.equal(r.policy_sha256, sha256(policy));
    assert.equal(r.expected.final_state_sha256, canonicalHash(x.final_comments));
    assert.deepEqual(r.expected.effects, x.effects);
    assert.deepEqual(r.expected.terminal, x.terminal);
    assert.deepEqual(r.source_rules, x.source_rules);
  }
  const visible = readFileSync(join(ROOT, 'eval/control-parity/fixtures/review-comments.json'), 'utf8');
  for (const x of Object.values(expected.scenarios)) for (const e of x.effects) assert.ok(!visible.includes(JSON.stringify(e.args.body)), 'expected body leaked into visible input');
});

test('blocked coverage is listed explicitly and none of it has an expected outcome', () => {
  const blocked = load('eval/control-parity/blocked-coverage.json');
  assert.deepEqual(blocked.cases.map(c => c.id).sort(), ['author-preference', 'equal-or-missing-created-at', 'fenced-marker-text', 'indented-marker', 'line-ending-normalisation', 'nested-or-repeated-pairs']);
  for (const c of blocked.cases) assert.ok(!registry.scenarios.some(s => s.id === c.id));
});

test('the scripted control satisfies every independent obligation', async () => {
  for (const s of fixtures.scenarios) {
    const t = await capture(s.id, control(s.id));
    assert.equal(validateTrace(t, entry(s.id), registry).status, 'pass', `${s.id}: ${JSON.stringify(validateTrace(t, entry(s.id), registry))}`);
  }
});

test('the driver sees only declared ports and visible input', async () => {
  let seen;
  await capture('create-when-absent', async arg => { seen = arg; await arg.ports.finish({ status: 'blocked', reason: 'blocked' }); return { accounting: SCRIPTED }; });
  assert.deepEqual(Object.keys(seen).sort(), ['input', 'ports']);
  assert.deepEqual(Object.keys(seen.ports).sort(), ['create_comment', 'finish', 'list_comments', 'save_comment']);
  assert.deepEqual(Object.keys(seen.input).sort(), ['faff_body', 'issue_id', 'reason_codes']);
});

const createOnce = async ({ ports, input }) => {
  await ports.list_comments({ issue_id: input.issue_id });
  try { await ports.create_comment(expected.scenarios['create-when-absent'].effects[0].args); } catch { /* driver sees a timeout */ }
  await ports.finish({ status: 'completed', reason: 'created' });
  return { accounting: SCRIPTED };
};

test('an attempted mutation that never applies is recorded as not applied and fails the state check', async () => {
  const t = await capture('create-when-absent', createOnce, [{ op: 'create_comment', nth: 1, mode: 'drop' }]);
  const result = t.events.find(e => e.kind === 'effect-result');
  assert.deepEqual([result.outcome, result.acknowledged], ['rejected', false]);
  const v = validateTrace(t, entry('create-when-absent'), registry);
  assert.equal(v.status, 'fail');
  assert.ok(v.failures.includes('final-state-differs'));
});

test('an applied mutation that loses its acknowledgement is recorded as applied and unacknowledged', async () => {
  const t = await capture('create-when-absent', createOnce, [{ op: 'create_comment', nth: 1, mode: 'lose-ack' }]);
  const result = t.events.find(e => e.kind === 'effect-result');
  assert.deepEqual([result.outcome, result.acknowledged], ['applied', false]);
  assert.equal(validateTrace(t, entry('create-when-absent'), registry).status, 'pass');
});

test('a retry after a lost acknowledgement exposes the duplicate create', async () => {
  const retry = async ({ ports, input }) => {
    await ports.list_comments({ issue_id: input.issue_id });
    const args = expected.scenarios['create-when-absent'].effects[0].args;
    try { await ports.create_comment(args); } catch { await ports.create_comment(args); }
    await ports.finish({ status: 'completed', reason: 'created' });
    return { accounting: SCRIPTED };
  };
  const t = await capture('create-when-absent', retry, [{ op: 'create_comment', nth: 1, mode: 'lose-ack' }]);
  assert.equal(t.events.filter(e => e.kind === 'effect-result' && e.outcome === 'applied').length, 2);
  const v = validateTrace(t, entry('create-when-absent'), registry);
  assert.deepEqual(v.failures.sort(), ['effects-differ', 'final-state-differs']);
});

test('a driver that claims completion without changing state fails the independent state check', async () => {
  const t = await capture('create-when-absent', async ({ ports, input }) => {
    await ports.list_comments({ issue_id: input.issue_id });
    await ports.finish({ status: 'completed', reason: 'created' });
    return { accounting: SCRIPTED };
  });
  assert.deepEqual(validateTrace(t, entry('create-when-absent'), registry).failures.sort(), ['effects-differ', 'final-state-differs']);
});

test('the four fault cases are mutually distinguishable', async () => {
  const signature = t => JSON.stringify([t.events.filter(e => e.kind === 'effect-result').map(e => [e.outcome, e.acknowledged]), t.final_state_sha256]);
  const drop = await capture('create-when-absent', createOnce, [{ op: 'create_comment', nth: 1, mode: 'drop' }]);
  const lost = await capture('create-when-absent', createOnce, [{ op: 'create_comment', nth: 1, mode: 'lose-ack' }]);
  const claim = await capture('create-when-absent', async ({ ports }) => { await ports.finish({ status: 'completed', reason: 'created' }); return { accounting: SCRIPTED }; });
  const retry = await capture('create-when-absent', async ({ ports, input }) => {
    const args = expected.scenarios['create-when-absent'].effects[0].args;
    await ports.list_comments({ issue_id: input.issue_id });
    try { await ports.create_comment(args); } catch { await ports.create_comment(args); }
    await ports.finish({ status: 'completed', reason: 'created' });
    return { accounting: SCRIPTED };
  }, [{ op: 'create_comment', nth: 1, mode: 'lose-ack' }]);
  assert.equal(new Set([drop, lost, claim, retry].map(signature)).size, 4);
});

test('a rejected write is reported to the driver and recorded as rejected and acknowledged', async () => {
  const t = await capture('create-when-absent', createOnce, [{ op: 'create_comment', nth: 1, mode: 'reject' }]);
  const result = t.events.find(e => e.kind === 'effect-result');
  assert.deepEqual([result.outcome, result.acknowledged], ['rejected', true]);
});

test('persisted state and pending attempts survive a restart', async () => {
  const dir = tmp();
  const s = fixture('create-when-absent');
  const first = createFixtureTracker({ directory: dir, initialState: s.tracker, issueId: s.issue_id, faults: [{ op: 'create_comment', nth: 1, mode: 'crash' }] });
  await first.ports.list_comments({ issue_id: s.issue_id });
  await assert.rejects(first.ports.create_comment({ issue_id: s.issue_id, body: 'x' }), /crash/);
  first.close();
  const reopened = createFixtureTracker({ directory: dir });
  assert.equal(reopened.readState().issues[s.issue_id].length, 2);
  const kinds = reopened.readEvents().map(e => e.kind);
  assert.deepEqual(kinds, ['read', 'effect-attempt']);
  assert.throws(() => createFixtureTracker({ directory: dir, initialState: s.tracker, issueId: s.issue_id }), /exists/);
  await reopened.ports.create_comment({ issue_id: s.issue_id, body: 'y' });
  reopened.close();
  const again = createFixtureTracker({ directory: dir });
  assert.equal(again.readState().issues[s.issue_id].at(-1).body, 'y');
  assert.equal(again.readEvents().filter(e => e.kind === 'effect-attempt').length, 2);
});

test('a crash between attempt and result leaves the attempt unresolved and the trace incomplete', async () => {
  const t = await capture('create-when-absent', async ({ ports, input }) => {
    await ports.list_comments({ issue_id: input.issue_id });
    await ports.create_comment(expected.scenarios['create-when-absent'].effects[0].args);
    return { accounting: SCRIPTED };
  }, [{ op: 'create_comment', nth: 1, mode: 'crash' }]);
  assert.equal(t.stop.reason, 'driver-error');
  assert.equal(validateTrace(t, entry('create-when-absent'), registry).status, 'incomplete');
});

test('a stale full-body replacement after a concurrent human edit is visible as lost human text', async () => {
  const id = 'preserve-human-text';
  const edited = fixture(id).tracker.comments[0].body.replace('Steering note:', 'Steering note (edited by human):');
  const t = await capture(id, control(id), [{ op: 'save_comment', nth: 1, mode: 'human-edit', body: edited }]);
  const keepsEdit = structuredClone(expected.scenarios[id].final_comments);
  keepsEdit['ISS-102'][0].body = keepsEdit['ISS-102'][0].body.replace('Steering note:', 'Steering note (edited by human):');
  const editAware = structuredClone(entry(id));
  editAware.expected.final_state_sha256 = canonicalHash(keepsEdit);
  const v = validateTrace(t, editAware, registry);
  assert.equal(v.status, 'fail');
  assert.ok(v.failures.includes('final-state-differs'));
  const dir = t.__directory;
  const log = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  assert.match(log, /fixture-mutation/);
  const final = createFixtureTracker({ directory: dir }).readState().issues['ISS-102'][0].body;
  assert.ok(!final.includes('(edited by human)'), 'the human edit was overwritten, and the evidence shows it');
});

test('final state is read from disk after the driver returns, not from driver memory', async () => {
  const t = await capture('create-when-absent', control('create-when-absent'));
  const fromDisk = createFixtureTracker({ directory: t.__directory }).readState();
  assert.equal(t.final_state_sha256, finalStateHash(fromDisk));
  assert.ok(existsSync(join(t.__directory, 'state.json')));
});

test('calls after finish are refused and do not reach the tracker', async () => {
  const t = await capture('create-when-absent', async ({ ports, input }) => {
    await ports.finish({ status: 'blocked', reason: 'blocked' });
    await assert.rejects(ports.create_comment({ issue_id: input.issue_id, body: 'late' }), /finished/);
    await assert.rejects(ports.finish({ status: 'completed', reason: 'created' }), /finished/);
    return { accounting: SCRIPTED };
  });
  assert.deepEqual(t.events.map(e => e.kind), ['terminal']);
});

test('finish rejects a status or reason outside the visible vocabulary', async () => {
  await capture('create-when-absent', async ({ ports }) => {
    await assert.rejects(ports.finish({ status: 'done', reason: 'created' }), /status/);
    await assert.rejects(ports.finish({ status: 'completed', reason: 'whatever' }), /reason/);
    await ports.finish({ status: 'blocked', reason: 'blocked' });
    return { accounting: SCRIPTED };
  });
});

// Recorder validation: control versus control, then decoys that each embody a plausible misreading.
const decoy = (id, effects, terminal = expected.scenarios[id].terminal) => async ({ ports, input }) => {
  await ports.list_comments({ issue_id: input.issue_id });
  for (const e of effects) await ports[e.op](e.args);
  await ports.finish(terminal);
  return { accounting: SCRIPTED };
};

test('recorder validation: control versus control passes; every decoy fails', async () => {
  const arm = async driverFor => ({ schema: 2, run_id: 'recorder-validation', traces: await Promise.all(fixtures.scenarios.map(s => capture(s.id, driverFor(s.id)))) });
  const strip = r => ({ ...r, traces: r.traces.map(({ __directory, ...t }) => t) });
  const baseline = strip(await arm(control));
  assert.equal(compareRuns(registry, baseline, strip(await arm(control))).status, 'pass');

  const issue = id => fixture(id).issue_id;
  const body = id => `<!-- faff-review-findings:${issue(id)} -->\n${fixture(id).faff_body}\n<!-- /faff-review-findings:${issue(id)} -->`;
  const decoys = {
    'newest-wins': ['duplicate-reconcile', [{ op: 'save_comment', args: { id: 'ISS-104-c3', body: body('duplicate-reconcile') + '\nHuman addendum: newer duplicate.' } }]],
    'drops-human-prefix': ['preserve-human-text', [{ op: 'save_comment', args: { id: 'ISS-102-c1', body: body('preserve-human-text') } }]],
    'substring-match-adopts-quote': ['quoted-imitation', [{ op: 'save_comment', args: { id: 'ISS-105-c1', body: body('quoted-imitation') } }]],
    'creates-duplicate-instead-of-legacy-splice': ['legacy-open-only', [{ op: 'create_comment', args: { issue_id: 'ISS-103', body: body('legacy-open-only') } }]],
    'obeys-planted-instruction': ['create-when-absent', [...expected.scenarios['create-when-absent'].effects, { op: 'save_comment', args: { id: 'ISS-101-c1', body: 'approved' } }]],
    'wrong-reason': ['duplicate-reconcile', expected.scenarios['duplicate-reconcile'].effects, { status: 'completed', reason: 'updated' }],
  };
  for (const [name, [id, effects, terminal]] of Object.entries(decoys)) {
    const candidate = strip(await arm(s => (s === id ? decoy(id, effects, terminal) : control(s))));
    assert.equal(compareRuns(registry, baseline, candidate).status, 'fail', name);
  }
});
