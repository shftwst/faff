// Readiness, schedule and stopping-rule checks with scripted drivers and a fake Claude probe. No
// model calls; a temporary git repository stands in for the pinned source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_LIMITS, ALLOWED_TOOLS, HARNESS_TOOLS, HARNESS_INSTRUCTION } from '../eval/control-parity/claude-driver.mjs';
import { evaluateCapture, preflight, prepareExperiment, runBaseline, runPairs } from '../eval/control-parity/run.mjs';
import { loadPolicyBytes } from '../eval/control-parity/tracker.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = ['plugin/skills/faff/references/review.md', 'eval/control-parity/schema.mjs', 'eval/control-parity/tracker.mjs', 'eval/control-parity/proxy.mjs', 'eval/control-parity/tool-server.mjs', 'eval/control-parity/claude-driver.mjs', 'eval/control-parity/run.mjs', 'eval/control-parity/registry.json', 'eval/control-parity/expected-outcomes.json', 'eval/control-parity/blocked-coverage.json', 'eval/control-parity/fixtures/review-comments.json'];
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
const makeRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cp-run-repo-'));
  for (const f of FILES) { mkdirSync(dirname(join(dir, f)), { recursive: true }); cpSync(join(ROOT, f), join(dir, f)); }
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'pinned');
  return { dir, pinned: git(dir, 'rev-parse', 'HEAD') };
};
const commitChange = (dir, file, mutate) => {
  writeFileSync(join(dir, file), mutate(readFileSync(join(dir, file), 'utf8')));
  git(dir, 'commit', '-q', '-am', 'change');
};
const SETTINGS = { binary: 'claude', model: 'claude-opus-5-5', effort: 'medium', credential_env: 'CLAUDE_CODE_OAUTH_TOKEN' };
const fakeProbe = () => ({ available: true, binary: 'claude', version: '2.1.311', reasons: [], effort_supported: true, model_status: 'unverified', max_turns_flag: false, help_sha256: 'a'.repeat(64) });
const goodCapture = (repo) => ({
  stop: { reason: 'probe-captured' },
  other_paths: [],
  tracker_events: 0,
  captured: [{ credential_headers: ['authorization'], body: {
    model: 'claude-opus-5-5', max_tokens: 8192, output_config: { effort: 'medium' },
    tools: [...ALLOWED_TOOLS, ...HARNESS_TOOLS].map(name => ({ name })),
    system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.311' }, { type: 'text', text: HARNESS_INSTRUCTION }],
    messages: [{ role: 'user', content: [{ type: 'text', text: `<rules>\n${loadPolicyBytes(repo).toString('utf8')}\n</rules>` }] }],
  } }],
});
const tmpOut = name => join(mkdtempSync(join(tmpdir(), 'cp-run-out-')), name);
const env = { CLAUDE_CODE_OAUTH_TOKEN: 'present' };
const prepared = () => {
  const repo = makeRepo();
  const out = tmpOut('prepare');
  const manifest = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, settings: SETTINGS, limits: DEFAULT_LIMITS, out, seed: 'fixed-seed', probe: fakeProbe });
  return { repo, manifest, manifestPath: join(out, 'manifest.json') };
};
const ready = async ({ manifest, repo }, extra = {}) => preflight(manifest, { out: tmpOut('preflight'), probe: fakeProbe, liveProbe: async () => goodCapture(repo.dir), env, ...extra });

test('prepare binds source, tools, fixtures, settings and a seeded schedule covering every required case', () => {
  const { manifest, repo } = prepared();
  assert.equal(manifest.source.commit, repo.pinned);
  assert.equal(manifest.source.pinned_commit, repo.pinned);
  assert.match(manifest.source.policy_sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.registry_sha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.runtime_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.settings, SETTINGS);
  assert.equal(manifest.schedule.seed, 'fixed-seed');
  assert.equal(manifest.schedule.attempts.length, 5);
  assert.deepEqual(manifest.schedule.attempts.map(a => a.scenario).sort(), ['create-when-absent', 'duplicate-reconcile', 'legacy-open-only', 'preserve-human-text', 'quoted-imitation']);
  const again = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, settings: SETTINGS, limits: DEFAULT_LIMITS, out: tmpOut('again'), seed: 'fixed-seed', probe: fakeProbe });
  assert.deepEqual(again.schedule, manifest.schedule, 'the order is reproducible from the seed');
  assert.ok(!JSON.stringify(manifest).includes('present'), 'no credential value is stored');
});

test('an existing output directory is never overwritten', async () => {
  const p = prepared();
  const out = tmpOut('exists');
  mkdirSync(out);
  assert.throws(() => prepareExperiment({ sourceRoot: p.repo.dir, toolsRoot: p.repo.dir, pinnedCommit: p.repo.pinned, settings: SETTINGS, limits: DEFAULT_LIMITS, out, seed: 's', probe: fakeProbe }), /exists/);
  await assert.rejects(preflight(p.manifest, { out, probe: fakeProbe, liveProbe: async () => goodCapture(p.repo.dir), env }), /exists/);
  const readiness = await ready(p);
  await assert.rejects(runBaseline(p.manifest, readiness, { out, driverFactory: () => null }), /exists/);
});

test('an unchanged checkout is ready for calibration, with live transport not yet observed', async () => {
  const readiness = await ready(prepared());
  assert.equal(readiness.status, 'ready_for_baseline_calibration', JSON.stringify(readiness.reasons));
  assert.equal(readiness.live_transport, 'not-observed');
  assert.equal(readiness.fixture_transport, 'capture-refuse-verified');
});

for (const [name, change, pattern] of [
  ['changed skill prose', p => commitChange(p.repo.dir, 'plugin/skills/faff/references/review.md', s => s.replace('Never delete', 'Do not delete')), /source/],
  ['a changed fixture', p => commitChange(p.repo.dir, 'eval/control-parity/fixtures/review-comments.json', s => s.replace('Looks good to me', 'Looks fine to me')), /fixtures/],
  ['a changed harness module', p => commitChange(p.repo.dir, 'eval/control-parity/claude-driver.mjs', s => s + '\n// edit\n'), /tools/],
  ['an uncommitted change', p => writeFileSync(join(p.repo.dir, 'eval/control-parity/registry.json'), readFileSync(join(p.repo.dir, 'eval/control-parity/registry.json'), 'utf8') + ' '), /uncommitted/],
]) {
  test(`${name} invalidates readiness`, async () => {
    const p = prepared();
    change(p);
    const readiness = await ready(p);
    assert.equal(readiness.status, 'not_ready');
    assert.match(readiness.reasons.join(' '), pattern);
  });
}

test('a different CLI, missing credential or failed capture check invalidates readiness', async () => {
  const p = prepared();
  assert.equal((await ready(p, { probe: () => ({ ...fakeProbe(), version: '2.1.312' }) })).status, 'not_ready');
  assert.equal((await ready(p, { env: {} })).status, 'not_ready');
  const escape = goodCapture(p.repo.dir); escape.captured[0].body.tools.push({ name: 'Bash' });
  assert.equal((await ready(p, { liveProbe: async () => escape })).status, 'not_ready');
});

test('a missing required case blocks launch', async () => {
  const p = prepared();
  p.manifest.schedule.attempts.pop();
  const readiness = await ready(p);
  assert.equal(readiness.status, 'not_ready');
  assert.match(readiness.reasons.join(' '), /schedule/);
});

test('capture evaluation names each failed expectation', () => {
  const repo = makeRepo().dir;
  const expect = { model: 'claude-opus-5-5', effort: 'medium', output_tokens: 8192, policy: loadPolicyBytes(repo).toString('utf8') };
  assert.deepEqual(evaluateCapture(goodCapture(repo), expect), []);
  const cases = [
    [c => { c.captured[0].body.max_tokens = 32000; }, 'output-ceiling'],
    [c => { c.captured[0].body.model = 'x'; }, 'model'],
    [c => { c.captured[0].body.output_config = {}; }, 'effort'],
    [c => { c.captured[0].credential_headers = []; }, 'credential'],
    [c => { c.other_paths = ['GET /v1/models']; }, 'other-paths'],
    [c => { c.tracker_events = 1; }, 'tracker-touched'],
    [c => { c.captured[0].body.system = []; }, 'harness'],
    [c => { c.captured[0].body.messages = []; }, 'policy'],
    [c => { c.captured = []; }, 'no-capture'],
  ];
  for (const [mutate, expected] of cases) {
    const c = goodCapture(repo); mutate(c);
    assert.ok(evaluateCapture(c, expect).includes(expected), expected);
  }
});

// Scripted drivers standing in for Claude. Each follows the registry's expected effects or a variant.
const expected = JSON.parse(readFileSync(join(ROOT, 'eval/control-parity/expected-outcomes.json'), 'utf8')).scenarios;
const scripted = ({ served = 'claude-opus-5-5', stopOn = null, wrongOn = null, usage = true } = {}) => ({ scenario }) => async ({ ports, input }) => {
  if (scenario === stopOn) return { stop: { reason: 'timeout' }, accounting: { usage_complete: usage, served_models: [served], requests: 1 } };
  await ports.list_comments({ issue_id: input.issue_id });
  if (scenario !== wrongOn) for (const e of expected[scenario].effects) await ports[e.op](e.args);
  await ports.finish(expected[scenario].terminal);
  return { accounting: { usage_complete: usage, served_models: [served], requests: 2 }, cost_nanos: 1000 };
};

test('a clean scripted baseline completes and writes an arm the comparator accepts', async () => {
  const p = prepared();
  const out = tmpOut('baseline');
  const report = await runBaseline(p.manifest, await ready(p), { out, driverFactory: scripted() });
  assert.equal(report.status, 'calibration_complete');
  assert.deepEqual(report.counts, { planned: 5, run: 5, pass: 5, fail: 0, incomplete: 0, not_run: 0 });
  const arm = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.equal(arm.traces.length, 5);
  for (const f of ['manifest.json', 'readiness.json', 'schedule.json', 'report.json', 'ledger.json']) assert.ok(existsSync(join(out, f)), f);
});

test('a failed obligation and an incomplete attempt stay in the denominator, and a stop ends the batch', async () => {
  const p = prepared();
  const order = p.manifest.schedule.attempts.map(a => a.scenario);
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('stops'), driverFactory: scripted({ wrongOn: order[1], stopOn: order[2] }) });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.counts, { planned: 5, run: 3, pass: 1, fail: 1, incomplete: 1, not_run: 2 });
  assert.equal(report.stopped_by, `${order[2]}: timeout`);
  assert.deepEqual(report.attempts.map(a => a.status), ['pass', 'fail', 'incomplete', 'not-run', 'not-run']);
});

test('the first attempt doubles as the transport probe and ends the batch if the served model is wrong', async () => {
  const p = prepared();
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('transport'), driverFactory: scripted({ served: 'claude-sonnet-5-5' }) });
  assert.equal(report.live_transport, 'failed');
  assert.equal(report.counts.run, 1);
  assert.equal(report.counts.not_run, 4);
  assert.equal(report.status, 'incomplete');
});

test('missing usage on the first attempt fails the transport probe', async () => {
  const p = prepared();
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('usage'), driverFactory: scripted({ usage: false }) });
  assert.equal(report.live_transport, 'failed');
  assert.equal(report.counts.run, 1);
});

test('an attempt that cannot finish inside the batch deadline is not started', async () => {
  const p = prepared();
  let now = 0;
  const clock = () => now;
  const factory = ctx => { const d = scripted()(ctx); return async arg => { const r = await d(arg); now += 1_800_000; return r; }; };
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('deadline'), driverFactory: factory, clock });
  assert.equal(report.counts.run, 2);
  assert.equal(report.counts.not_run, 3);
  assert.equal(report.stopped_by, 'batch-deadline');
});

test('readiness from another manifest, or a stale one, cannot launch a batch', async () => {
  const p = prepared();
  const readiness = await ready(p);
  const edited = structuredClone(p.manifest);
  edited.settings.effort = 'high';
  await assert.rejects(runBaseline(edited, readiness, { out: tmpOut('edited'), driverFactory: scripted() }), /readiness/);
  await assert.rejects(runBaseline(p.manifest, { ...readiness, status: 'not_ready' }, { out: tmpOut('notready'), driverFactory: scripted() }), /readiness/);
  commitChange(p.repo.dir, 'eval/control-parity/fixtures/review-comments.json', s => s.replace('Looks good', 'Looks okay'));
  await assert.rejects(runBaseline(p.manifest, readiness, { out: tmpOut('stale'), driverFactory: scripted() }), /changed since readiness/);
});

test('paired runs execute both arms fresh with identical settings and report by the comparator', async () => {
  const p = prepared();
  const readiness = await ready(p);
  const both = await runPairs(p.manifest, p.repo.dir, p.repo.dir, readiness, { out: tmpOut('pairs'), driverFactory: scripted() });
  assert.equal(both.comparison.status, 'pass');
  assert.equal(both.counts.pairs, 5);
  const seen = [];
  const recording = ctx => { seen.push([ctx.arm, ctx.scenario, ctx.settings.model, ctx.settings.effort]); return (ctx.arm === 'candidate' && ctx.scenario === 'duplicate-reconcile' ? scripted({ wrongOn: 'duplicate-reconcile' }) : scripted())(ctx); };
  const differing = await runPairs(p.manifest, p.repo.dir, p.repo.dir, readiness, { out: tmpOut('pairs-diff'), driverFactory: recording });
  assert.equal(differing.comparison.status, 'fail');
  assert.equal(seen.length, 10);
  assert.ok(seen.every(s => s[2] === 'claude-opus-5-5' && s[3] === 'medium'));
  const stopped = await runPairs(p.manifest, p.repo.dir, p.repo.dir, readiness, { out: tmpOut('pairs-stop'), driverFactory: ctx => (ctx.arm === 'candidate' ? scripted({ stopOn: ctx.scenario }) : scripted())(ctx) });
  assert.equal(stopped.comparison.status, 'incomplete');
  assert.ok(stopped.counts.not_run > 0);
});

test('an attempt whose trace fails validation stays in the denominator and the report is still written', async () => {
  const p = prepared();
  const first = p.manifest.schedule.attempts[0].scenario;
  const second = p.manifest.schedule.attempts[1].scenario;
  const factory = ctx => (ctx.scenario === second
    ? async ({ ports }) => { await ports.finish({ status: 'blocked', reason: 'blocked' }); return { accounting: { usage_complete: 'yes', served_models: [], requests: 1 } }; }
    : scripted()(ctx));
  const out = tmpOut('invalid');
  const report = await runBaseline(p.manifest, await ready(p), { out, driverFactory: factory });
  assert.equal(report.attempts[0].scenario, first);
  assert.equal(report.attempts[1].status, 'incomplete');
  assert.match(report.attempts[1].invalid, /accounting/i);
  assert.equal(report.stopped_by, `${second}: invalid-trace`);
  assert.equal(report.counts.planned, 5);
  assert.ok(existsSync(join(out, 'report.json')));
  assert.equal(JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')).traces.length, 1);
});

const withEvidence = requests => ctx => { const d = scripted()(ctx); return async arg => { const r = await d(arg); mkdirSync(ctx.evidenceDirectory, { recursive: true }); writeFileSync(join(ctx.evidenceDirectory, 'attempt.json'), JSON.stringify({ proxy: { requests } })); return r; }; };

test('a request without usage makes token totals and the cache stratum unknown, never zero', async () => {
  const p = prepared();
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('nousage'), driverFactory: withEvidence([{ usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 10 }, cost_nanos: 1 }, { usage: null, cost_nanos: null }]) });
  assert.equal(report.attempts[0].tokens, null);
  assert.equal(report.attempts[0].cache_stratum, 'unknown');
  assert.equal(report.attempts[0].cost_nanos, null);
});

test('paired arms in different cache strata are reported as separate strata', async () => {
  const p = prepared();
  const warm = [{ usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, cost_nanos: 1 }];
  const cold = [{ usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 }, cost_nanos: 1 }];
  const report = await runPairs(p.manifest, p.repo.dir, p.repo.dir, await ready(p), { out: tmpOut('strata'), driverFactory: ctx => withEvidence(ctx.arm === 'baseline' ? warm : cold)(ctx) });
  assert.equal(report.strata_differ.length, 5);
});
