// Readiness, schedule and stopping-rule checks with scripted drivers and a fake Claude probe. No
// model calls; a temporary git repository stands in for the pinned source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DEFAULT_LIMITS, ALLOWED_TOOLS, HARNESS_TOOLS, HARNESS_INSTRUCTION, buildPromptBundle, runtimeFingerprintOfBody } from '../eval/control-parity/claude-driver.mjs';
import { evaluateCapture, main, preflight, prepareExperiment, runBaseline, runPairs } from '../eval/control-parity/run.mjs';
import { createFixtureTracker, loadPolicyBytes } from '../eval/control-parity/tracker.mjs';
import { createCommandAdapter } from '../eval/control-parity/command-use.mjs';
import { TOOL_DEFINITIONS, CANDIDATE_TOOL_DEFINITIONS } from '../eval/control-parity/tool-server.mjs';
import { preparePairs, preflightPairs, runCommandPairs } from '../eval/control-parity/paired.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = ['plugin/skills/faff/references/review.md', 'eval/control-parity/schema.mjs', 'eval/control-parity/tracker.mjs', 'eval/control-parity/proxy.mjs', 'eval/control-parity/tool-server.mjs', 'eval/control-parity/claude-driver.mjs', 'eval/control-parity/run.mjs', 'eval/control-parity/registry.json', 'eval/control-parity/expected-outcomes.json', 'eval/control-parity/blocked-coverage.json', 'eval/control-parity/policy-decisions.json', 'eval/control-parity/fixtures/review-comments.json'];
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8' }).trim();
FILES.push('eval/control-parity/candidate-command.mjs', 'eval/control-parity/command-use.mjs');
FILES.push('eval/control-parity/paired.mjs', 'eval/control-parity/treatments.mjs', 'eval/control-parity/intended-differences.json', 'verification/experiments/2026-11-15-comment-policy-measure/run/run.json');
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
const LIMITS = { ...DEFAULT_LIMITS, attempts: 11 };
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
const prepared = ({ limits = LIMITS } = {}) => {
  const repo = makeRepo();
  const out = tmpOut('prepare');
  const manifest = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, settings: SETTINGS, limits, out, seed: 'fixed-seed', probe: fakeProbe });
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
  assert.equal(manifest.schedule.attempts.length, 11);
  assert.deepEqual(manifest.schedule.attempts.map(a => a.scenario).sort(), ['author-not-preferred', 'create-when-absent', 'crlf-outside-region', 'duplicate-reconcile', 'fenced-example', 'indented-and-trailing-whitespace', 'legacy-open-only', 'preserve-human-text', 'quoted-imitation', 'repeated-pairs', 'timestamp-ties']);
  const again = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, settings: SETTINGS, limits: LIMITS, out: tmpOut('again'), seed: 'fixed-seed', probe: fakeProbe });
  assert.deepEqual(again.schedule, manifest.schedule, 'the order is reproducible from the seed');
  assert.ok(!JSON.stringify(manifest).includes('present'), 'no credential value is stored');
});

test('an existing output directory is never overwritten', async () => {
  const p = prepared();
  const out = tmpOut('exists');
  mkdirSync(out);
  assert.throws(() => prepareExperiment({ sourceRoot: p.repo.dir, toolsRoot: p.repo.dir, pinnedCommit: p.repo.pinned, settings: SETTINGS, limits: LIMITS, out, seed: 's', probe: fakeProbe }), /exists/);
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
  ['a changed policy decision', p => commitChange(p.repo.dir, 'eval/control-parity/policy-decisions.json', s => s.replace('Authorship is never used.', 'Authorship is preferred.')), /tools/],
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

test('a commit that touches neither plugin nor the harness keeps readiness valid', async () => {
  const p = prepared();
  writeFileSync(join(p.repo.dir, 'NOTES.md'), 'evidence notes\n');
  git(p.repo.dir, 'add', 'NOTES.md');
  git(p.repo.dir, 'commit', '-q', '-m', 'notes');
  const readiness = await ready(p);
  assert.equal(readiness.status, 'ready_for_baseline_calibration', JSON.stringify(readiness.reasons));
});

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

test('a fixture committed before preparation cannot bypass its independent registry hash', async () => {
  const repo = makeRepo();
  commitChange(repo.dir, 'eval/control-parity/fixtures/review-comments.json', s => s.replace('Looks good to me', 'Altered input'));
  const manifest = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, settings: SETTINGS, limits: LIMITS, out: tmpOut('changed-fixture'), seed: 'fixed', probe: fakeProbe });
  let probes = 0;
  const readiness = await ready({ repo, manifest }, { liveProbe: async () => { probes++; return goodCapture(repo.dir); } });
  assert.equal(readiness.status, 'not_ready');
  assert.match(readiness.reasons.join(' '), /fixture.*hash|input.*hash/);
  assert.equal(probes, 0, 'invalid inputs must be rejected before invoking Claude');
});

test('eleven pairs require twenty-two admitted attempts before any driver runs', async () => {
  const p = prepared();
  let calls = 0;
  const driverFactory = ctx => { calls++; return scripted()(ctx); };
  await assert.rejects(runPairs(p.manifest, p.repo.dir, p.repo.dir, await ready(p), { out: tmpOut('too-many-pairs'), driverFactory }), /attempt limit/);
  assert.equal(calls, 0);
});

for (const [name, path, mutate, pattern] of [
  ['policy', 'plugin/skills/faff/references/review.md', s => s.replace('Never delete', 'Do not delete'), /policy hash/],
  ['oracle', 'eval/control-parity/expected-outcomes.json', s => s.replace('Steering note:', 'Altered note:'), /expected outcomes/],
]) {
  test(`a ${name} changed before preparation is checked against the independent registry`, async () => {
    const repo = makeRepo();
    commitChange(repo.dir, path, mutate);
    const manifest = prepareExperiment({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: git(repo.dir, 'rev-parse', 'HEAD'), settings: SETTINGS, limits: LIMITS, out: tmpOut('changed-input'), probe: fakeProbe });
    const readiness = await ready({ repo, manifest }, { liveProbe: async () => { assert.fail('invalid inputs reached the capture probe'); } });
    assert.equal(readiness.status, 'not_ready');
    assert.match(readiness.reasons.join(' '), pattern);
  });
}

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
  assert.deepEqual(report.counts, { planned: 11, run: 11, pass: 11, fail: 0, incomplete: 0, not_run: 0 });
  const arm = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'));
  assert.equal(arm.traces.length, 11);
  for (const f of ['manifest.json', 'readiness.json', 'schedule.json', 'report.json', 'ledger.json']) assert.ok(existsSync(join(out, f)), f);
});

test('a failed obligation and an incomplete attempt stay in the denominator, and a stop ends the batch', async () => {
  const p = prepared();
  const order = p.manifest.schedule.attempts.map(a => a.scenario);
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('stops'), driverFactory: scripted({ wrongOn: order[1], stopOn: order[2] }) });
  assert.equal(report.status, 'incomplete');
  assert.deepEqual(report.counts, { planned: 11, run: 3, pass: 1, fail: 1, incomplete: 1, not_run: 8 });
  assert.equal(report.stopped_by, `${order[2]}: timeout`);
  assert.deepEqual(report.attempts.map(a => a.status), ['pass', 'fail', 'incomplete', ...Array(8).fill('not-run')]);
});

test('the first attempt doubles as the transport probe and ends the batch if the served model is wrong', async () => {
  const p = prepared();
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('transport'), driverFactory: scripted({ served: 'claude-sonnet-5-5' }) });
  assert.equal(report.live_transport, 'failed');
  assert.equal(report.counts.run, 1);
  assert.equal(report.counts.not_run, 10);
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
  assert.equal(report.counts.not_run, 9);
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
  const p = prepared({ limits: { ...LIMITS, attempts: 22 } });
  const readiness = await ready(p);
  const both = await runPairs(p.manifest, p.repo.dir, p.repo.dir, readiness, { out: tmpOut('pairs'), driverFactory: scripted() });
  assert.equal(both.comparison.status, 'pass');
  assert.equal(both.counts.pairs, 11);
  const seen = [];
  const recording = ctx => { seen.push([ctx.arm, ctx.scenario, ctx.settings.model, ctx.settings.effort]); return (ctx.arm === 'candidate' && ctx.scenario === 'duplicate-reconcile' ? scripted({ wrongOn: 'duplicate-reconcile' }) : scripted())(ctx); };
  const differing = await runPairs(p.manifest, p.repo.dir, p.repo.dir, readiness, { out: tmpOut('pairs-diff'), driverFactory: recording });
  assert.equal(differing.comparison.status, 'fail');
  assert.equal(seen.length, 22);
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
  assert.equal(report.counts.planned, 11);
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
  assert.equal(report.attempts[0].observed_cost_nanos, 1);
  assert.equal(report.attempts[0].observed_tokens.input, 5);
  assert.equal(report.attempts[0].requests_with_unknown_cost, 1);
  assert.equal(report.attempts[0].observed_token_request_counts.input, 1);
});

test('partial usage retains cache TTL buckets without claiming complete totals', async () => {
  const p = prepared();
  const requests = [{ usage: { input_tokens: 9, output_tokens: 4, cache_creation_input_tokens: 12, cache_creation: { ephemeral_5m_input_tokens: 7, ephemeral_1h_input_tokens: 5 } }, cost_nanos: 100 }, { usage: { input_tokens: 3, cache_creation_input_tokens: 2 }, cost_nanos: null }];
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('partial-ttl'), driverFactory: withEvidence(requests) });
  const attempt = report.attempts[0];
  assert.equal(attempt.tokens, null);
  assert.deepEqual(attempt.observed_tokens, { input: 12, output: 4, cache_read: null, cache_write: 14, cache_write_5m: 7, cache_write_1h: 5, cache_write_unknown_ttl: 2 });
  assert.equal(attempt.observed_cost_nanos, 100);
});

test('held reservations are reported separately from observed cost', async () => {
  const p = prepared();
  const report = await runBaseline(p.manifest, await ready(p), { out: tmpOut('held-spend'), driverFactory: ctx => async () => {
    const first = ctx.ledger.reserve(1000); ctx.ledger.reconcile(first, 100);
    const second = ctx.ledger.reserve(2000); ctx.ledger.reconcile(second, null);
    return { stop: { reason: 'usage-missing' }, accounting: { usage_complete: false, served_models: [], requests: 2 } };
  } });
  assert.equal(report.observed_cost_nanos, 100);
  assert.equal(report.held_reservation_nanos, 2000);
  assert.equal(report.allowance_committed_nanos, 2100);
  assert.equal(report.spend_nanos, 100);
});

test('paired arms in different cache strata are reported as separate strata', async () => {
  const p = prepared({ limits: { ...LIMITS, attempts: 22 } });
  const warm = [{ usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }, cost_nanos: 1 }];
  const cold = [{ usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 100 }, cost_nanos: 1 }];
  const report = await runPairs(p.manifest, p.repo.dir, p.repo.dir, await ready(p), { out: tmpOut('strata'), driverFactory: ctx => withEvidence(ctx.arm === 'baseline' ? warm : cold)(ctx) });
  assert.equal(report.strata_differ.length, 11);
});

test('the prepare command records a raised attempt limit in a new manifest', async () => {
  const repo = makeRepo();
  const out = tmpOut('cli-prepare');
  const code = await main(['prepare', '--source-root', repo.dir, '--pinned-commit', repo.pinned, '--credential-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--model', 'claude-opus-5-5', '--effort', 'medium', '--attempts', '11', '--out', out]);
  assert.equal(code, 0);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.limits.attempts, 11);
  assert.deepEqual({ ...manifest.limits, attempts: DEFAULT_LIMITS.attempts }, DEFAULT_LIMITS);
});

const fixturePlanner = `process.stdout.write(JSON.stringify({schema:1,action:'create',reason:'created',comment_id:null,body:'fixture command output',expectedDigest:null}));`;
function plannerRepo(candidate = false) {
  const repo = makeRepo();
  mkdirSync(join(repo.dir, 'plugin/skills/faff/bin'), { recursive: true });
  writeFileSync(join(repo.dir, 'plugin/skills/faff/bin/faff'), fixturePlanner);
  writeFileSync(join(repo.dir, 'plugin/skills/faff/build-manifest.json'), '{}');
  if (candidate) writeFileSync(join(repo.dir, 'plugin/skills/faff/references/review.md'), '### Review-findings comment identity\nUse the planner.\n### Producer slots\n');
  git(repo.dir, 'add', '.'); git(repo.dir, 'commit', '-qm', 'fixture planner');
  return { ...repo, pinned: git(repo.dir, 'rev-parse', 'HEAD') };
}
function pairPrepared() {
  const repo = plannerRepo();
  const candidate = plannerRepo(true);
  const manifest = preparePairs({ sourceRoot: repo.dir, toolsRoot: repo.dir, pinnedCommit: repo.pinned, candidateRoot: candidate.dir, candidateCommit: candidate.pinned, settings: SETTINGS, limits: { ...LIMITS, attempts: 22 }, out: tmpOut('paired-prepare'), seed: 'pair-seed', probe: fakeProbe });
  return { repo, candidate, manifest };
}
function captureBody(manifest, arm, input) {
  const root = arm === 'candidate' ? manifest.candidate.binding.root : manifest.source.root;
  const bundle = buildPromptBundle({ policyBytes: loadPolicyBytes(root), input, candidate: arm === 'candidate' });
  return { model: SETTINGS.model, max_tokens: 8192, output_config: { effort: 'medium' },
    system: [{ type: 'text', text: bundle.system }], messages: [{ role: 'user', content: [{ type: 'text', text: bundle.user }] }],
    tools: [...(arm === 'candidate' ? CANDIDATE_TOOL_DEFINITIONS : TOOL_DEFINITIONS).map(t => ({ name: `mcp__tracker__${t.name}`, description: t.description, input_schema: t.inputSchema })), ...HARNESS_TOOLS.map(name => ({ name }))],
  };
}
const pairedCapture = async ({ manifest, arm = 'baseline', registry, fixtures }) => {
  const f = fixtures.get(registry.scenarios[0].id);
  return { stop: { reason: 'probe-captured' }, other_paths: [], tracker_events: 0, captured: [{ credential_headers: ['authorization'], body: captureBody(manifest, arm, { issue_id: f.issue_id, faff_body: f.faff_body, reason_codes: ['created', 'updated', 'reconciled', 'blocked'] }) }] };
};
const pairsReady = p => preflightPairs(p.manifest, { out: tmpOut('paired-ready'), probe: fakeProbe, liveProbe: pairedCapture, env });
const pairedDriver = ({ skip = false, after = () => {}, runtimeChange = false } = {}) => ctx => async ({ ports, input }) => {
  const { comments } = await ports.list_comments({ issue_id: input.issue_id });
  if (ctx.arm === 'candidate' && !skip) {
    assert.ok(ctx.commandBinding, 'candidate binding must reach the driver');
    const adapter = createCommandAdapter({ ...ctx.commandBinding, directory: ctx.trackerDirectory, tracker: createFixtureTracker({ directory: ctx.trackerDirectory }) });
    const p = await adapter.call({ schema: 1, issue_id: input.issue_id, faff_body: input.faff_body, comments });
    await ports.create_comment({ issue_id: input.issue_id, body: p.body });
    await ports.finish({ status: 'completed', reason: p.reason });
  } else {
    for (const e of expected[ctx.scenario].effects) await ports[e.op](e.args);
    await ports.finish(expected[ctx.scenario].terminal);
  }
  const body = captureBody(ctx.manifest, ctx.arm, input);
  if (runtimeChange) body.temperature = 1;
  const bundle = buildPromptBundle({ policyBytes: ctx.promptBytes, input, candidate: ctx.arm === 'candidate' });
  mkdirSync(join(ctx.evidenceDirectory, 'requests'), { recursive: true });
  writeFileSync(join(ctx.evidenceDirectory, 'requests/001.request.json'), JSON.stringify({ body }));
  writeFileSync(join(ctx.evidenceDirectory, 'attempt.json'), JSON.stringify({ proxy: { requests: [{ usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, cost_nanos: 24000 }] } }));
  after(ctx);
  return { accounting: { usage_complete: true, served_models: [SETTINGS.model], requests: 1 }, observed_runtime_sha256: runtimeFingerprintOfBody(body, bundle.user) };
};

test('paired preparation binds both commits, command caps and a 22-execution schedule with both arm orders', async () => {
  const p = pairPrepared();
  assert.equal(p.manifest.candidate.binding.commit, p.candidate.pinned);
  assert.equal(p.manifest.baseline_binding.commit, p.repo.pinned);
  assert.equal(p.manifest.candidate.limits.maxCalls, 16);
  assert.equal(p.manifest.schedule.executions.length, 22);
  assert.deepEqual(new Set(p.manifest.schedule.executions.filter((_, i) => i % 2 === 0).map(e => e.arm)), new Set(['baseline', 'candidate']));
  const readiness = await pairsReady(p);
  assert.equal(readiness.status, 'ready_for_command_pairs', readiness.reasons.join('; '));
  assert.equal(readiness.arms.baseline.common_sha256, readiness.arms.candidate.common_sha256);
});

test('candidate drift blocks preflight before any capture and blocks launch after readiness', async () => {
  const p = pairPrepared(); const readiness = await pairsReady(p);
  writeFileSync(join(p.candidate.dir, 'plugin/skills/faff/bin/faff'), 'changed');
  let probes = 0;
  const invalid = await preflightPairs(p.manifest, { out: tmpOut('changed-pair'), probe: fakeProbe, liveProbe: async ctx => { probes++; return pairedCapture(ctx); }, env });
  assert.equal(invalid.status, 'not_ready'); assert.equal(probes, 0);
  await assert.rejects(runCommandPairs(p.manifest, readiness, { probe: fakeProbe, out: tmpOut('changed-launch'), driverFactory: pairedDriver() }), /dirty|changed/);
});

test('paired runner records actual command use separately from failed candidate conformance', async () => {
  const p = pairPrepared(); const out = tmpOut('command-pairs');
  const report = await runCommandPairs(p.manifest, await pairsReady(p), { out, probe: fakeProbe, driverFactory: pairedDriver() });
  assert.equal(report.counts.run, 22);
  assert.equal(report.pairs.length, 11);
  assert.ok(report.pairs.every(pair => pair.classification === 'candidate-failure'));
  assert.ok(report.attempts.filter(a => a.arm === 'candidate').every(a => a.command_use.status === 'followed' && a.command_use.calls === 1));
  assert.ok(report.attempts.every(a => a.runtime_matches_readiness === true));
  assert.equal(report.status, 'failed');
  assert.equal(report.comparison.differences.filter(d => d.reason === 'unpaired-runtime').length, 11);
  assert.ok(report.comparison_with_declared_runtime.differences.some(d => d.reason === 'event-differs'));
  const baselineTrace = JSON.parse(readFileSync(join(out, 'baseline.json'), 'utf8')).traces[0];
  const candidateTrace = JSON.parse(readFileSync(join(out, 'candidate.json'), 'utf8')).traces.find(t => t.scenario === baselineTrace.scenario);
  assert.notEqual(baselineTrace.runtime_sha256, candidateTrace.runtime_sha256, 'raw traces retain their observed arm runtimes');
  assert.equal(report.arm_totals.baseline.observed_cost_nanos, 264000);
  assert.equal(report.arm_totals.candidate.observed_token_request_counts.input, 11);
  for (const file of ['manifest.json', 'readiness.json', 'schedule.json', 'comparison.json', 'report.json', 'baseline.json', 'candidate.json']) assert.ok(existsSync(join(out, file)), file);
});

test('oracle-conforming output without invoking the command cannot pass the paired report', async () => {
  const p = pairPrepared();
  const report = await runCommandPairs(p.manifest, await pairsReady(p), { probe: fakeProbe, out: tmpOut('skipped-command'), driverFactory: pairedDriver({ skip: true }) });
  assert.equal(report.status, 'failed');
  assert.ok(report.pairs.every(pair => pair.classification === 'command-not-followed'));
});

test('source drift between executions stops the batch and retains every planned execution', async () => {
  const p = pairPrepared(); let changed = false;
  const report = await runCommandPairs(p.manifest, await pairsReady(p), { probe: fakeProbe, out: tmpOut('mid-batch-drift'), driverFactory: pairedDriver({ after: () => { if (!changed) { changed = true; writeFileSync(join(p.candidate.dir, 'plugin/skills/faff/bin/faff'), 'changed'); } } }) });
  assert.equal(report.counts.run, 1); assert.equal(report.counts.not_run, 21);
  assert.match(report.stopped_by, /binding/); assert.equal(report.status, 'incomplete');
});

test('an unregistered runtime change stops the paired batch', async () => {
  const p = pairPrepared();
  const report = await runCommandPairs(p.manifest, await pairsReady(p), { probe: fakeProbe, out: tmpOut('runtime-drift'), driverFactory: pairedDriver({ runtimeChange: true }) });
  assert.equal(report.counts.run, 1); assert.equal(report.status, 'incomplete');
  assert.match(report.stopped_by, /runtime/);
});

test('the paired manifest refuses duplicate schedules, unbound limits and changed declarations', async () => {
  for (const change of [m => { m.schedule.attempts[1] = m.schedule.attempts[0]; }, m => { m.limits.attempts = 21; }, m => { m.candidate.limits.maxCalls = 0; }, m => { m.declarations.entries[0].reason = 'anything'; }]) {
    const p = pairPrepared(); change(p.manifest);
    let calls = 0;
    const report = await preflightPairs(p.manifest, { out: tmpOut('invalid-manifest'), probe: fakeProbe, liveProbe: async ctx => { calls++; return pairedCapture(ctx); }, env });
    assert.equal(report.status, 'not_ready'); assert.equal(calls, 0);
  }
});

test('a candidate capture with changed unrelated system context is refused before paid work', async () => {
  const p = pairPrepared();
  const report = await preflightPairs(p.manifest, { out: tmpOut('unrelated-context'), probe: fakeProbe, liveProbe: async ctx => {
    const result = await pairedCapture(ctx);
    if (ctx.arm === 'candidate') result.captured[0].body.system.push({ type: 'text', text: 'unregistered context' });
    return result;
  }, env });
  assert.equal(report.status, 'not_ready'); assert.match(report.reasons.join('; '), /unexplained runtime/);
});

test('a changed Claude CLI is refused before any paired execution', async () => {
  const p = pairPrepared(); let calls = 0;
  await assert.rejects(runCommandPairs(p.manifest, await pairsReady(p), { out: tmpOut('changed-cli'), probe: () => ({ ...fakeProbe(), version: 'changed' }), driverFactory: () => { calls++; } }), /CLI changed/);
  assert.equal(calls, 0);
});

test('the paired CLI entry prepares exactly 22 executions and requires paired readiness', async () => {
  const p = pairPrepared(); const out = tmpOut('cli-paired');
  assert.equal(await main(['prepare-pairs', '--source-root', p.repo.dir, '--pinned-commit', p.repo.pinned, '--candidate-root', p.candidate.dir, '--candidate-commit', p.candidate.pinned, '--credential-env', 'CLAUDE_CODE_OAUTH_TOKEN', '--model', SETTINGS.model, '--effort', 'medium', '--out', out]), 0);
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schedule.executions.length, 22);
  const invalid = join(out, 'invalid-readiness.json'); writeFileSync(invalid, '{"status":"not_ready"}');
  await assert.rejects(main(['pairs', '--manifest', join(out, 'manifest.json'), '--readiness', invalid, '--out', tmpOut('cli-paired-run')]), /readiness/);
});
