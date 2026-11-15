// Preparation, readiness and scheduling for controlled skill runs.
//   node eval/control-parity/run.mjs prepare --source-root DIR --pinned-commit SHA --credential-env NAME --out DIR [--seed S] [--attempts N]
//   node eval/control-parity/run.mjs preflight --manifest FILE --out DIR
//   node eval/control-parity/run.mjs baseline --manifest FILE --readiness FILE --out DIR
// Every output directory must not exist yet; nothing is overwritten.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalHash, compareRuns, parseStrictJson, sha256, validateRegistry, validateTrace } from './schema.mjs';
import { REASON_CODES, captureScenario, createFixtureTracker, loadPolicyBytes } from './tracker.mjs';
import { OPUS_5_5_PRICING, createLedger } from './proxy.mjs';
import { ALLOWED_TOOLS, DEFAULT_LIMITS, HARNESS_INSTRUCTION, HARNESS_TOOLS, PARSER_VERSION, buildPromptBundle, probeClaude, runClaudeScenario, runtimeFingerprint, runtimeFingerprintOfBody } from './claude-driver.mjs';
import { TOOL_DEFINITIONS } from './tool-server.mjs';

const TOOL_FILES = ['schema.mjs', 'tracker.mjs', 'proxy.mjs', 'tool-server.mjs', 'candidate-command.mjs', 'command-use.mjs', 'claude-driver.mjs', 'run.mjs', 'registry.json', 'expected-outcomes.json', 'blocked-coverage.json', 'policy-decisions.json', 'fixtures/review-comments.json'].map(f => `eval/control-parity/${f}`);
const POLICY_PATH = 'plugin/skills/faff/references/review.md';
const PRICING = { 'claude-opus-5-5': OPUS_5_5_PRICING };
const READY = 'ready_for_baseline_calibration';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const fileHash = (root, rel) => sha256(readFileSync(join(root, rel)));
const readJson = path => parseStrictJson(readFileSync(path, 'utf8'));
const writeNew = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
function freshDirectory(out) {
  if (existsSync(out)) throw new Error(`Output directory ${out} already exists; choose a new one`);
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(out);
}

function bindings({ sourceRoot, toolsRoot, pinnedCommit }) {
  const data = rel => join(toolsRoot, 'eval/control-parity', rel);
  const dirty = [
    ...git(sourceRoot, 'status', '--porcelain', '--', 'plugin').split('\n').filter(Boolean),
    ...git(toolsRoot, 'status', '--porcelain', '--', 'eval/control-parity').split('\n').filter(Boolean),
  ];
  return {
    source: {
      root: sourceRoot,
      commit: git(sourceRoot, 'rev-parse', 'HEAD'),
      pinned_commit: pinnedCommit,
      plugin_tree: git(sourceRoot, 'rev-parse', 'HEAD:plugin'),
      pinned_plugin_tree: git(sourceRoot, 'rev-parse', `${pinnedCommit}:plugin`),
      policy_path: POLICY_PATH,
      policy_sha256: sha256(loadPolicyBytes(sourceRoot)),
    },
    tools: { root: toolsRoot, commit: git(toolsRoot, 'rev-parse', 'HEAD'), files: Object.fromEntries(TOOL_FILES.map(f => [f, fileHash(toolsRoot, f)])) },
    registry_sha256: sha256(readFileSync(data('registry.json'))),
    fixtures_sha256: sha256(readFileSync(data('fixtures/review-comments.json'))),
    expected_sha256: sha256(readFileSync(data('expected-outcomes.json'))),
    blocked_sha256: sha256(readFileSync(data('blocked-coverage.json'))),
    dirty,
  };
}

function bindingProblems(manifest, current) {
  const problems = [];
  if (current.source.plugin_tree !== current.source.pinned_plugin_tree) problems.push('source plugin tree differs from the pinned commit');
  // Content is bound, not commits: a commit that touches neither plugin/ nor the harness keeps readiness.
  for (const [field, label] of [['plugin_tree', 'source plugin tree'], ['policy_sha256', 'source policy']]) {
    if (current.source[field] !== manifest.source[field]) problems.push(`${label} changed`);
  }
  if (canonicalHash(current.tools.files) !== canonicalHash(manifest.tools.files)) problems.push('tools changed');
  for (const field of ['registry', 'fixtures', 'expected', 'blocked']) {
    if (current[`${field}_sha256`] !== manifest[`${field}_sha256`]) problems.push(`${field} changed`);
  }
  if (current.dirty.length) problems.push(`uncommitted changes: ${current.dirty.join('; ')}`);
  return problems;
}

const seededOrder = (seed, items) => [...items].sort((a, b) => sha256(`${seed}:${a.scenario}:${a.attempt}`).localeCompare(sha256(`${seed}:${b.scenario}:${b.attempt}`)));

function loadInputs(toolsRoot) {
  const registry = validateRegistry(readJson(join(toolsRoot, 'eval/control-parity/registry.json')));
  const fixtures = readJson(join(toolsRoot, 'eval/control-parity/fixtures/review-comments.json'));
  const expected = readJson(join(toolsRoot, 'eval/control-parity/expected-outcomes.json'));
  return { registry, fixtures: new Map(fixtures.scenarios.map(s => [s.id, s])), fixtureEntries: fixtures.scenarios, expected };
}

function inputProblems(inputs, policyBytes) {
  const { registry, fixtures, fixtureEntries, expected } = inputs;
  const problems = [];
  if (fixtures.size !== fixtureEntries.length) problems.push('duplicate fixture identity');
  const known = new Set(registry.scenarios.map(s => s.id));
  for (const id of fixtures.keys()) if (!known.has(id)) problems.push(`unexpected fixture ${id}`);
  for (const id of Object.keys(expected.scenarios)) if (!known.has(id)) problems.push(`unexpected expectation ${id}`);
  for (const s of registry.scenarios) {
    const fixture = fixtures.get(s.id);
    if (!fixture || canonicalHash(fixture) !== s.input_sha256) problems.push(`${s.id}: fixture input hash differs from registry`);
    if (sha256(policyBytes) !== s.policy_sha256) problems.push(`${s.id}: policy hash differs from registry`);
    const outcome = expected.scenarios[s.id];
    if (!outcome || canonicalHash(outcome.effects) !== canonicalHash(s.expected.effects)
      || canonicalHash(outcome.terminal) !== canonicalHash(s.expected.terminal)
      || canonicalHash(outcome.final_comments) !== s.expected.final_state_sha256) {
      problems.push(`${s.id}: expected outcomes differ from registry`);
    }
  }
  return problems;
}

export function prepareExperiment({ sourceRoot, toolsRoot = sourceRoot, pinnedCommit, settings, limits = DEFAULT_LIMITS, out, seed = randomBytes(16).toString('hex'), repetitions = 1, probe = probeClaude }) {
  freshDirectory(out);
  const { registry } = loadInputs(toolsRoot);
  const bound = bindings({ sourceRoot, toolsRoot, pinnedCommit });
  const caps = probe({ binary: settings.binary, model: settings.model, effort: settings.effort });
  const runtime = {
    harness_sha256: sha256(HARNESS_INSTRUCTION),
    tool_definitions_sha256: canonicalHash(TOOL_DEFINITIONS),
    allowed_tools: [...ALLOWED_TOOLS],
    harness_tools: [...HARNESS_TOOLS],
    parser_version: PARSER_VERSION,
  };
  const claude = { version: caps.version, help_sha256: caps.help_sha256 };
  const pricing = PRICING[settings.model] ?? null;
  const attempts = registry.scenarios.flatMap(s => Array.from({ length: repetitions }, (_, i) => ({ scenario: s.id, attempt: i + 1 })));
  const manifest = {
    schema: 2,
    experiment_id: `control-parity-${sha256(`${seed}:${bound.source.commit}`).slice(0, 12)}`,
    created_at: new Date().toISOString(),
    source: (({ root, commit, pinned_commit, plugin_tree, policy_path, policy_sha256 }) => ({ root, commit, pinned_commit, plugin_tree, policy_path, policy_sha256 }))(bound.source),
    tools: { root: bound.tools.root, commit: bound.tools.commit, files: bound.tools.files },
    registry_sha256: bound.registry_sha256,
    fixtures_sha256: bound.fixtures_sha256,
    expected_sha256: bound.expected_sha256,
    blocked_sha256: bound.blocked_sha256,
    settings,
    claude,
    runtime,
    limits,
    pricing,
    runtime_sha256: canonicalHash({ settings, claude, runtime, limits, pricing }),
    schedule: { seed, repetitions, attempts: seededOrder(seed, attempts).map((a, i) => ({ n: i + 1, ...a })) },
  };
  writeNew(join(out, 'manifest.json'), manifest);
  return manifest;
}

const textOf = value => (typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap(textOf) : value && typeof value === 'object' ? Object.values(value).flatMap(textOf) : []);

export function evaluateCapture(capture, { model, effort, output_tokens, policy }) {
  const problems = [];
  if (capture.captured?.length !== 1) return ['no-capture'];
  if (capture.stop?.reason !== 'probe-captured') problems.push('probe-stop');
  const { body, credential_headers } = capture.captured[0];
  if (body.model !== model) problems.push('model');
  if (body.max_tokens !== output_tokens) problems.push('output-ceiling');
  if (body.output_config?.effort !== effort) problems.push('effort');
  const tools = (body.tools ?? []).map(t => t.name).sort();
  if (JSON.stringify(tools) !== JSON.stringify([...ALLOWED_TOOLS, ...HARNESS_TOOLS].sort())) problems.push('tools');
  if (!credential_headers?.length) problems.push('credential');
  if (capture.other_paths?.length) problems.push('other-paths');
  if (capture.tracker_events !== 0) problems.push('tracker-touched');
  if (!textOf(body.system).some(t => t.includes(HARNESS_INSTRUCTION))) problems.push('harness');
  if (!textOf(body.messages).some(t => t.includes(policy))) problems.push('policy');
  return problems;
}

function probeUserPrompt(manifest, registry, fixtures) {
  const s = fixtures.get(registry.scenarios[0].id);
  return buildPromptBundle({ policyBytes: loadPolicyBytes(manifest.source.root), input: { issue_id: s.issue_id, faff_body: s.faff_body, reason_codes: [...REASON_CODES] } }).user;
}

async function claudeCaptureProbe({ manifest, out, registry, fixtures }) {
  const scenario = fixtures.get(registry.scenarios[0].id);
  const trackerDirectory = join(out, 'probe', 'tracker');
  createFixtureTracker({ directory: trackerDirectory, initialState: scenario.tracker, issueId: scenario.issue_id });
  const result = await runClaudeScenario({
    trackerDirectory,
    input: { issue_id: scenario.issue_id, faff_body: scenario.faff_body, reason_codes: [...REASON_CODES] },
    policyBytes: loadPolicyBytes(manifest.source.root),
    settings: manifest.settings,
    limits: manifest.limits,
    evidenceDirectory: join(out, 'probe', 'evidence'),
    ledger: createLedger(join(out, 'probe', 'ledger.json'), 0),
    mode: 'capture-refuse',
  });
  return { stop: result.stop, captured: result.proxy.captured, other_paths: result.proxy.other_paths, tracker_events: createFixtureTracker({ directory: trackerDirectory }).readEvents().length };
}

export async function preflight(manifest, { out, probe = probeClaude, liveProbe = claudeCaptureProbe, env = process.env }) {
  freshDirectory(out);
  const reasons = [];
  const current = bindings({ sourceRoot: manifest.source.root, toolsRoot: manifest.tools.root, pinnedCommit: manifest.source.pinned_commit });
  reasons.push(...bindingProblems(manifest, current));
  const inputs = loadInputs(manifest.tools.root);
  const { registry, fixtures } = inputs;
  reasons.push(...inputProblems(inputs, loadPolicyBytes(manifest.source.root)));
  const scheduled = manifest.schedule.attempts.map(a => a.scenario);
  for (const s of registry.scenarios) {
    if (!fixtures.has(s.id)) reasons.push(`fixture missing for ${s.id}`);
    for (let i = 1; i <= manifest.schedule.repetitions; i++) {
      if (!manifest.schedule.attempts.some(a => a.scenario === s.id && a.attempt === i)) reasons.push(`schedule missing ${s.id}#${i}`);
    }
  }
  for (const id of scheduled) if (!registry.scenarios.some(s => s.id === id)) reasons.push(`schedule has unexpected ${id}`);
  if (manifest.schedule.attempts.length > manifest.limits.attempts) reasons.push('schedule exceeds the attempt limit');
  if (manifest.limits.workers !== 1 || manifest.limits.retries !== 0) reasons.push('limits must be one worker and no retries');
  if (!manifest.pricing || manifest.pricing.model !== manifest.settings.model) reasons.push(`no verified pricing for ${manifest.settings.model}; the allowance cannot be enforced`);
  const caps = probe({ binary: manifest.settings.binary, model: manifest.settings.model, effort: manifest.settings.effort });
  if (!caps.available) reasons.push(...caps.reasons.map(r => `claude: ${r}`));
  if (caps.version !== manifest.claude.version || caps.help_sha256 !== manifest.claude.help_sha256) reasons.push('claude CLI changed since prepare');
  if (!env[manifest.settings.credential_env]) reasons.push(`credential variable ${manifest.settings.credential_env} is not set`);

  let captureProblems = ['not-run'];
  let capture = null;
  if (!reasons.length) {
    capture = await liveProbe({ manifest, out, registry, fixtures });
    captureProblems = evaluateCapture(capture, { model: manifest.settings.model, effort: manifest.settings.effort, output_tokens: manifest.limits.output_tokens, policy: loadPolicyBytes(manifest.source.root).toString('utf8') });
    reasons.push(...captureProblems.map(p => `capture: ${p}`));
  }
  const body = capture?.captured?.[0]?.body;
  const readiness = {
    schema: 2,
    status: reasons.length ? 'not_ready' : READY,
    reasons,
    manifest_sha256: canonicalHash(manifest),
    checked_at: new Date().toISOString(),
    claude: caps,
    bindings: current,
    fixture_transport: captureProblems.length ? 'failed' : 'capture-refuse-verified',
    live_transport: 'not-observed',
    observed_runtime_sha256: body ? runtimeFingerprintOfBody(body, probeUserPrompt(manifest, registry, fixtures)) : null,
    harness_overhead: body ? { system_sha256: canonicalHash(body.system), injected_messages_sha256: canonicalHash(body.messages.filter(m => m.role !== 'user')), tool_definitions_sha256: canonicalHash(body.tools), thinking: body.thinking ?? null } : null,
    note: 'Zero-cost checks only. The first calibration attempt is the live transport probe.',
  };
  writeNew(join(out, 'readiness.json'), readiness);
  return readiness;
}

const claudeDriverFactory = ctx => async ({ input }) => {
  const r = await runClaudeScenario({ trackerDirectory: ctx.trackerDirectory, input, policyBytes: ctx.promptBytes, settings: ctx.settings, limits: ctx.limits, evidenceDirectory: ctx.evidenceDirectory, ledger: ctx.ledger });
  return { stop: r.stop, accounting: r.accounting, observed_runtime_sha256: r.observed_runtime_sha256 };
};

function assertLaunchable(manifest, readiness) {
  if (readiness?.status !== READY || readiness.manifest_sha256 !== canonicalHash(manifest)) throw new Error('readiness does not match this manifest or is not ready');
  const problems = bindingProblems(manifest, bindings({ sourceRoot: manifest.source.root, toolsRoot: manifest.tools.root, pinnedCommit: manifest.source.pinned_commit }));
  if (problems.length) throw new Error(`bindings changed since readiness: ${problems.join('; ')}`);
  const inputs = inputProblems(loadInputs(manifest.tools.root), loadPolicyBytes(manifest.source.root));
  if (inputs.length) throw new Error(`invalid experiment inputs: ${inputs.join('; ')}`);
}

function attemptEvidence(dir, userPrompt) {
  const path = join(dir, 'evidence', 'attempt.json');
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, 'utf8'));
  const requests = record.proxy?.requests ?? [];
  const known = requests.length > 0 && requests.every(r => r.usage && Number.isSafeInteger(r.cost_nanos));
  const sum = key => requests.reduce((a, r) => a + (r.usage[key] ?? 0), 0);
  return {
    cost_nanos: known ? requests.reduce((a, r) => a + r.cost_nanos, 0) : null,
    tokens: known ? { input: sum('input_tokens'), cache_read: sum('cache_read_input_tokens'), cache_write: sum('cache_creation_input_tokens'), output: sum('output_tokens') } : null,
    cache_stratum: !known ? 'unknown' : sum('cache_read_input_tokens') > 0 ? 'cache-read-observed' : 'no-cache-read',
    observed_runtime_sha256: runtimeFingerprint(join(dir, 'evidence'), userPrompt),
    cli_reported_cost_usd: record.cli?.cli_reported_cost_usd ?? null,
  };
}

async function executeAttempt({ manifest, registry, fixtures, ledger, out, arm, item, promptBytes, policyBytes, driverFactory, clock }) {
  const entry = registry.scenarios.find(s => s.id === item.scenario);
  const fixture = fixtures.get(item.scenario);
  const dir = join(out, 'attempts', `${String(item.n).padStart(2, '0')}-${arm}-${item.scenario}-${item.attempt}`);
  mkdirSync(dir, { recursive: true });
  const input = { issue_id: fixture.issue_id, faff_body: fixture.faff_body, reason_codes: [...REASON_CODES] };
  const bundle = buildPromptBundle({ policyBytes: promptBytes, input });
  const promptSha256 = bundle.hashes.prompt_sha256;
  const driver = driverFactory({ arm, scenario: item.scenario, attempt: item.attempt, settings: manifest.settings, limits: manifest.limits, promptBytes, trackerDirectory: join(dir, 'tracker'), evidenceDirectory: join(dir, 'evidence'), ledger, manifest });
  const started = clock();
  const trace = await captureScenario({ driver, fixture, registryEntry: entry, directory: join(dir, 'tracker'), policyBytes, promptSha256, runtimeSha256: manifest.runtime_sha256, attempt: item.attempt });
  const elapsed_ms = clock() - started;
  writeNew(join(dir, 'trace.json'), trace);
  const base = { n: item.n, arm, scenario: item.scenario, attempt: item.attempt, stop: trace.stop, accounting: trace.accounting, elapsed_ms, ...(attemptEvidence(dir, bundle.user) ?? {}) };
  try {
    const v = validateTrace(trace, entry, registry);
    return { trace, summary: { ...base, status: v.status, failures: v.failures, incomplete: v.incomplete } };
  } catch (error) {
    return { trace: null, summary: { ...base, status: 'incomplete', invalid: error.message } };
  }
}

const tally = attempts => ({
  planned: attempts.length,
  run: attempts.filter(a => a.status !== 'not-run').length,
  pass: attempts.filter(a => a.status === 'pass').length,
  fail: attempts.filter(a => a.status === 'fail').length,
  incomplete: attempts.filter(a => a.status === 'incomplete').length,
  not_run: attempts.filter(a => a.status === 'not-run').length,
});

export async function runBaseline(manifest, readiness, { out, driverFactory = claudeDriverFactory, clock = Date.now } = {}) {
  assertLaunchable(manifest, readiness);
  freshDirectory(out);
  writeNew(join(out, 'manifest.json'), manifest);
  writeNew(join(out, 'readiness.json'), readiness);
  writeNew(join(out, 'schedule.json'), manifest.schedule);
  const { registry, fixtures } = loadInputs(manifest.tools.root);
  const policyBytes = loadPolicyBytes(manifest.source.root);
  const ledger = createLedger(join(out, 'ledger.json'), manifest.limits.allowance_nanos);
  const batchStart = clock();
  const attempts = [];
  const traces = [];
  let stopped_by = null;
  let live_transport = 'not-observed';
  for (const item of manifest.schedule.attempts) {
    if (!stopped_by && clock() - batchStart + manifest.limits.attempt_ms > manifest.limits.batch_ms) stopped_by = 'batch-deadline';
    if (stopped_by) { attempts.push({ n: item.n, arm: 'baseline', scenario: item.scenario, attempt: item.attempt, status: 'not-run' }); continue; }
    const { trace, summary } = await executeAttempt({ manifest, registry, fixtures, ledger, out, arm: 'baseline', item, promptBytes: policyBytes, policyBytes, driverFactory, clock });
    if (readiness.observed_runtime_sha256 && summary.observed_runtime_sha256) summary.runtime_matches_readiness = summary.observed_runtime_sha256 === readiness.observed_runtime_sha256;
    attempts.push(summary);
    if (!trace) { stopped_by = `${item.scenario}: invalid-trace`; continue; }
    traces.push(trace);
    if (live_transport === 'not-observed') {
      const a = trace.accounting;
      const ok = a.usage_complete && a.requests > 0 && a.served_models.length === 1 && a.served_models[0] === manifest.settings.model;
      live_transport = ok ? 'observed' : 'failed';
      if (!ok) { stopped_by = 'transport-probe'; continue; }
    }
    if (trace.stop) stopped_by = `${item.scenario}: ${trace.stop.reason}`;
  }
  const counts = tally(attempts);
  const status = counts.not_run || counts.incomplete ? 'incomplete' : counts.fail ? 'failed' : 'calibration_complete';
  writeNew(join(out, 'run.json'), { schema: 2, run_id: `${manifest.experiment_id}-baseline`, traces });
  const report = {
    schema: 2, kind: 'baseline-calibration', status, live_transport, stopped_by, counts, attempts,
    spend_nanos: manifest.limits.allowance_nanos - ledger.remaining(),
    held_reservations: ledger.entries().filter(e => e.state === 'held').length,
    elapsed_ms: clock() - batchStart,
    note: 'Calibration completion does not approve migration. Cache strata are observed, not controlled; no cold-cache claim is made.',
  };
  writeNew(join(out, 'report.json'), report);
  return report;
}

export async function runPairs(manifest, baselineRoot, candidateRoot, readiness, { out, driverFactory = claudeDriverFactory, clock = Date.now, promptBytesFor = loadPolicyBytes } = {}) {
  assertLaunchable(manifest, readiness);
  if (manifest.schedule.attempts.length * 2 > manifest.limits.attempts) throw new Error('paired schedule exceeds the total attempt limit');
  freshDirectory(out);
  writeNew(join(out, 'manifest.json'), manifest);
  const { registry, fixtures } = loadInputs(manifest.tools.root);
  const policyBytes = loadPolicyBytes(manifest.source.root);
  const roots = { baseline: baselineRoot, candidate: candidateRoot };
  const prompts = { baseline: promptBytesFor(baselineRoot), candidate: promptBytesFor(candidateRoot) };
  const arms = {
    baseline: { commit: git(baselineRoot, 'rev-parse', 'HEAD'), prompt_sha256: sha256(prompts.baseline) },
    candidate: { commit: git(candidateRoot, 'rev-parse', 'HEAD'), prompt_sha256: sha256(prompts.candidate) },
  };
  writeNew(join(out, 'arms.json'), { roots, arms });
  const ledger = createLedger(join(out, 'ledger.json'), manifest.limits.allowance_nanos);
  const batchStart = clock();
  const attempts = [];
  const traces = { baseline: [], candidate: [] };
  let stopped_by = null;
  for (const item of manifest.schedule.attempts) {
    const order = sha256(`${manifest.schedule.seed}:arm:${item.n}`) < '8' ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const arm of order) {
      if (!stopped_by && clock() - batchStart + manifest.limits.attempt_ms > manifest.limits.batch_ms) stopped_by = 'batch-deadline';
      if (stopped_by) { attempts.push({ n: item.n, arm, scenario: item.scenario, attempt: item.attempt, status: 'not-run' }); continue; }
      const { trace, summary } = await executeAttempt({ manifest, registry, fixtures, ledger, out, arm, item, promptBytes: prompts[arm], policyBytes, driverFactory, clock });
      attempts.push(summary);
      if (!trace) { stopped_by = `${arm} ${item.scenario}: invalid-trace`; continue; }
      traces[arm].push(trace);
      if (trace.stop) stopped_by = `${arm} ${item.scenario}: ${trace.stop.reason}`;
    }
  }
  const run = arm => ({ schema: 2, run_id: `${manifest.experiment_id}-${arm}`, traces: traces[arm] });
  writeNew(join(out, 'baseline.json'), run('baseline'));
  writeNew(join(out, 'candidate.json'), run('candidate'));
  const comparison = compareRuns(registry, run('baseline'), run('candidate'));
  writeNew(join(out, 'comparison.json'), comparison);
  const counts = { ...tally(attempts), pairs: manifest.schedule.attempts.filter(i => ['baseline', 'candidate'].every(arm => attempts.some(a => a.n === i.n && a.arm === arm && a.status !== 'not-run'))).length };
  const strata_differ = manifest.schedule.attempts.flatMap(i => {
    const [b, c] = ['baseline', 'candidate'].map(arm => attempts.find(a => a.n === i.n && a.arm === arm)?.cache_stratum);
    return b && c && b !== c ? [{ n: i.n, scenario: i.scenario, baseline: b, candidate: c }] : [];
  });
  const report = { schema: 2, kind: 'paired', comparison, stopped_by, counts, strata_differ, attempts, spend_nanos: manifest.limits.allowance_nanos - ledger.remaining(), elapsed_ms: clock() - batchStart };
  writeNew(join(out, 'report.json'), report);
  return report;
}

function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

const configValue = (root, key) => execFileSync(process.execPath, [join(root, 'plugin/skills/faff/bin/faff'), 'config', 'get', key], { encoding: 'utf8' }).trim();

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const f = flags(rest);
  const toolsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  if (command === 'prepare') {
    const sourceRoot = resolve(f['source-root']);
    const settings = { binary: f.binary ?? 'claude', model: f.model ?? configValue(sourceRoot, 'eval.model'), effort: f.effort ?? configValue(sourceRoot, 'eval.effort'), credential_env: f['credential-env'] };
    const limits = f.attempts ? { ...DEFAULT_LIMITS, attempts: Number.parseInt(f.attempts, 10) } : DEFAULT_LIMITS;
    if (!Number.isSafeInteger(limits.attempts) || limits.attempts < 1) throw new Error('--attempts must be a positive integer');
    prepareExperiment({ sourceRoot, toolsRoot, pinnedCommit: f['pinned-commit'], settings, limits, out: resolve(f.out), ...(f.seed ? { seed: f.seed } : {}) });
    return 0;
  }
  if (command === 'preflight') {
    const readiness = await preflight(readJson(resolve(f.manifest)), { out: resolve(f.out) });
    console.log(JSON.stringify({ status: readiness.status, reasons: readiness.reasons }, null, 2));
    return readiness.status === READY ? 0 : 2;
  }
  if (command === 'baseline') {
    const report = await runBaseline(readJson(resolve(f.manifest)), readJson(resolve(f.readiness)), { out: resolve(f.out) });
    console.log(JSON.stringify({ status: report.status, counts: report.counts, stopped_by: report.stopped_by, spend_nanos: report.spend_nanos }, null, 2));
    return { calibration_complete: 0, failed: 1 }[report.status] ?? 2;
  }
  throw new Error('usage: run.mjs prepare|preflight|baseline ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 2; });
}
