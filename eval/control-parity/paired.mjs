import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalHash, compareRuns, parseStrictJson, sha256 } from './schema.mjs';
import { assertCandidateCommandUnchanged, bindCandidateCommand, invokeCandidateCommand } from './candidate-command.mjs';
import { COMMAND_LIMITS } from './command-use.mjs';
import { buildPromptBundle, DEFAULT_LIMITS, probeClaude } from './claude-driver.mjs';
import { createLedger } from './proxy.mjs';
import { loadPolicyBytes, REASON_CODES } from './tracker.mjs';
import { classifyPair, treatmentRuntime, validateDeclarations } from './treatments.mjs';
import { assertLaunchable, claudeCaptureProbe, claudeDriverFactory, evaluateCapture, executeAttempt, freshDirectory, ledgerAccounting, loadInputs, preflight, prepareExperiment } from './run.mjs';

const HISTORY = 'verification/experiments/2026-11-15-comment-policy-measure/run/run.json';
const DECLARATIONS = 'eval/control-parity/intended-differences.json';
const read = path => parseStrictJson(readFileSync(path, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const READY = 'ready_for_command_pairs';
const inputOf = fixture => ({ issue_id: fixture.issue_id, faff_body: fixture.faff_body, reason_codes: [...REASON_CODES] });

function executionSchedule(schedule) {
  const offset = Number.parseInt(sha256(schedule.seed)[0], 16) % 2;
  return schedule.attempts.flatMap((item, i) => ((i + offset) % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']).map((arm, j) => ({ execution: i * 2 + j + 1, arm, ...item })));
}

function checkDeclarations(manifest) {
  const { registry, fixtureEntries } = loadInputs(manifest.tools.root);
  const current = read(join(manifest.tools.root, DECLARATIONS));
  if (canonicalHash(current) !== canonicalHash(manifest.declarations)) throw new Error('treatment declarations changed');
  return validateDeclarations(current, { registry, fixtures: { scenarios: fixtureEntries }, decisions: read(join(manifest.tools.root, 'eval/control-parity/policy-decisions.json')), history: read(join(manifest.tools.root, HISTORY)) });
}

function checkPairedBindings(manifest) {
  if (manifest.kind !== 'command-pairs') throw new Error('not a command-pairs manifest');
  assertCandidateCommandUnchanged(manifest.baseline_binding);
  assertCandidateCommandUnchanged(manifest.candidate.binding);
  if (sha256(loadPolicyBytes(manifest.candidate.binding.root)) !== manifest.candidate.policy_sha256) throw new Error('candidate policy changed');
  const caps = manifest.candidate.limits;
  if (Object.keys(caps).sort().join(',') !== Object.keys(COMMAND_LIMITS).sort().join(',')
    || Object.values(caps).some(v => !Number.isSafeInteger(v) || v < 1)) throw new Error('invalid command limits');
  const { attempts, executions, repetitions } = manifest.schedule;
  if (!Number.isSafeInteger(repetitions) || repetitions < 1
    || new Set(attempts.map(a => `${a.scenario}#${a.attempt}`)).size !== attempts.length
    || attempts.some((a, i) => a.n !== i + 1 || !Number.isSafeInteger(a.attempt) || a.attempt < 1 || a.attempt > repetitions)
    || canonicalHash(executions) !== canonicalHash(executionSchedule(manifest.schedule))
    || executions.length > manifest.limits.attempts) throw new Error('invalid paired schedule or total attempt limit');
  checkDeclarations(manifest);
}

export function preparePairs({ candidateRoot, candidateCommit, commandLimits = COMMAND_LIMITS, limits = { ...DEFAULT_LIMITS, attempts: 22 }, out, ...options }) {
  const candidate = { binding: bindCandidateCommand(candidateRoot, candidateCommit), limits: { ...commandLimits }, policy_sha256: sha256(loadPolicyBytes(candidateRoot)) };
  freshDirectory(out);
  const base = prepareExperiment({ ...options, limits, out: join(out, 'baseline-preparation') });
  const manifest = { ...base, kind: 'command-pairs', baseline_binding: bindCandidateCommand(base.source.root, base.source.commit), candidate,
    declarations: read(join(base.tools.root, DECLARATIONS)), schedule: { ...base.schedule, executions: executionSchedule(base.schedule) } };
  checkPairedBindings(manifest);
  write(join(out, 'manifest.json'), manifest);
  return manifest;
}

export async function preflightPairs(manifest, { out, liveProbe = claudeCaptureProbe, ...options }) {
  freshDirectory(out);
  const reasons = [];
  const result = { schema: 2, status: 'not_ready', manifest_sha256: canonicalHash(manifest), reasons, baseline: null, arms: {}, checked_at: new Date().toISOString() };
  try { checkPairedBindings(manifest); } catch (error) { reasons.push(error.message); }
  if (!reasons.length) {
    const { registry, fixtures } = loadInputs(manifest.tools.root);
    const fixture = fixtures.get(registry.scenarios[0].id);
    try {
      const probe = invokeCandidateCommand(manifest.candidate.binding, { schema: 1, issue_id: fixture.issue_id, faff_body: fixture.faff_body, comments: fixture.tracker.comments }, manifest.candidate.limits);
      write(join(out, 'command-probe.json'), probe);
      if (!probe.plan || probe.evidence.error) reasons.push(`command probe: ${probe.evidence.error}`);
    } catch (error) { reasons.push(`command probe: ${error.message}`); }
    if (!reasons.length) {
      let baselineCapture;
      result.baseline = await preflight(manifest, { ...options, out: join(out, 'baseline'), liveProbe: async ctx => { baselineCapture = await liveProbe({ ...ctx, arm: 'baseline' }); return baselineCapture; } });
      reasons.push(...result.baseline.reasons);
      if (!reasons.length) {
        const candidateCapture = await liveProbe({ manifest, out: join(out, 'candidate'), registry, fixtures, arm: 'candidate' });
        for (const [arm, capture] of [['baseline', baselineCapture], ['candidate', candidateCapture]]) {
          const root = arm === 'candidate' ? manifest.candidate.binding.root : manifest.source.root;
          const policyBytes = loadPolicyBytes(root);
          const bundle = buildPromptBundle({ policyBytes, input: inputOf(fixture), candidate: arm === 'candidate' });
          reasons.push(...evaluateCapture(capture, { model: manifest.settings.model, effort: manifest.settings.effort, output_tokens: manifest.limits.output_tokens, policy: policyBytes.toString('utf8'), allowedTools: bundle.allowed_tools, harness: bundle.system }).map(p => `${arm}: ${p}`));
          const body = capture.captured?.[0]?.body;
          if (body) {
            const observed = treatmentRuntime(body, bundle.user, { candidate: arm === 'candidate' });
            reasons.push(...observed.problems.map(p => `${arm} runtime: ${p}`));
            result.arms[arm] = { common_sha256: observed.sha256, raw_sha256: observed.raw_sha256 };
          }
        }
        if (!result.arms.baseline || !result.arms.candidate || result.arms.baseline.common_sha256 !== result.arms.candidate.common_sha256) reasons.push('unexplained runtime difference between arms');
      }
    }
  }
  if (!reasons.length) result.status = READY;
  write(join(out, 'readiness.json'), result);
  return result;
}

function assertPairedLaunch(manifest, readiness) {
  if (readiness.status !== READY || readiness.manifest_sha256 !== canonicalHash(manifest)) throw new Error('paired readiness does not match manifest');
  checkPairedBindings(manifest);
  assertLaunchable(manifest, readiness.baseline);
}

function observedRuntime(directory, bundle, candidate) {
  try {
    const { body } = read(join(directory, 'evidence/requests/001.request.json'));
    return treatmentRuntime(body, bundle.user, { candidate });
  } catch (error) { return { sha256: null, raw_sha256: null, problems: [error.message] }; }
}

function armTotals(attempts, arm) {
  const planned = attempts.filter(a => a.arm === arm);
  const rows = planned.filter(a => a.status !== 'not-run');
  const fields = [...new Set(rows.flatMap(a => Object.keys(a.observed_tokens ?? {})))];
  const sum = field => rows.reduce((total, row) => total + (row[field] ?? 0), 0);
  return {
    planned: planned.length, run: rows.length, elapsed_ms: sum('elapsed_ms'),
    command_ms: rows.reduce((total, row) => total + (row.command_use?.command_ms ?? 0), 0),
    observed_cost_nanos: sum('observed_cost_nanos'), requests_with_unknown_cost: sum('requests_with_unknown_cost'),
    cost_complete: rows.length > 0 && rows.every(r => Number.isSafeInteger(r.cost_nanos)),
    observed_tokens: Object.fromEntries(fields.map(field => {
      const values = rows.map(r => r.observed_tokens?.[field]).filter(v => Number.isSafeInteger(v));
      return [field, values.length ? values.reduce((a, b) => a + b, 0) : null];
    })),
    observed_token_request_counts: Object.fromEntries(fields.map(field => [field, rows.reduce((total, r) => total + (r.observed_token_request_counts?.[field] ?? 0), 0)])),
  };
}

export async function runCommandPairs(manifest, readiness, { out, driverFactory = claudeDriverFactory, clock = Date.now, probe = probeClaude } = {}) {
  assertPairedLaunch(manifest, readiness);
  const checkCli = () => {
    const caps = probe({ binary: manifest.settings.binary, model: manifest.settings.model, effort: manifest.settings.effort });
    if (!caps.available || caps.version !== manifest.claude.version || caps.help_sha256 !== manifest.claude.help_sha256) throw new Error('Claude CLI changed since readiness');
  };
  checkCli();
  freshDirectory(out);
  for (const [file, value] of [['manifest', manifest], ['readiness', readiness], ['schedule', manifest.schedule]]) write(join(out, `${file}.json`), value);
  const { registry, fixtures } = loadInputs(manifest.tools.root);
  const policyBytes = loadPolicyBytes(manifest.source.root);
  const prompts = { baseline: policyBytes, candidate: loadPolicyBytes(manifest.candidate.binding.root) };
  const ledger = createLedger(join(out, 'ledger.json'), manifest.limits.allowance_nanos);
  const started = clock();
  const traces = { baseline: [], candidate: [] };
  const attempts = [];
  let stopped_by = null;
  for (const item of manifest.schedule.executions) {
    if (!stopped_by) {
      try { assertPairedLaunch(manifest, readiness); checkCli(); } catch (error) { stopped_by = `bindings changed: ${error.message}`; }
      if (clock() - started + manifest.limits.attempt_ms > manifest.limits.batch_ms) stopped_by ??= 'batch-deadline';
    }
    if (stopped_by) { attempts.push({ ...item, status: 'not-run' }); continue; }
    const { trace, summary, directory, bundle } = await executeAttempt({ manifest, registry, fixtures, ledger, out, arm: item.arm, item, promptBytes: prompts[item.arm], policyBytes, driverFactory, clock, commandBinding: item.arm === 'candidate' ? manifest.candidate : null });
    const runtime = observedRuntime(directory, bundle, item.arm === 'candidate');
    summary.runtime_matches_readiness = !runtime.problems.length && runtime.raw_sha256 === readiness.arms[item.arm].raw_sha256 && runtime.sha256 === readiness.arms.baseline.common_sha256;
    summary.runtime_problems = runtime.problems;
    summary.execution = item.execution;
    attempts.push(summary);
    if (trace) traces[item.arm].push(trace);
    if (!trace) stopped_by = 'invalid-trace';
    else if (!summary.runtime_matches_readiness) stopped_by = 'unexplained-runtime-change';
    else if (!trace.accounting.usage_complete || trace.accounting.requests < 1 || trace.accounting.served_models.length !== 1 || trace.accounting.served_models[0] !== manifest.settings.model) stopped_by = 'transport-probe';
    else if (trace.stop) stopped_by = `${item.arm} ${item.scenario}: ${trace.stop.reason}`;
  }
  const run = arm => ({ schema: 2, run_id: `${manifest.experiment_id}-${arm}`, traces: traces[arm] });
  for (const arm of ['baseline', 'candidate']) write(join(out, `${arm}.json`), run(arm));
  const comparison = compareRuns(registry, run('baseline'), run('candidate'));
  write(join(out, 'comparison.json'), comparison);
  const allRuntimesMatch = attempts.every(a => a.runtime_matches_readiness === true);
  const matchedRun = arm => ({ ...run(arm), traces: traces[arm].map(t => ({ ...t, runtime_sha256: readiness.arms.baseline.common_sha256 })) });
  const comparison_with_declared_runtime = allRuntimesMatch ? compareRuns(registry, matchedRun('baseline'), matchedRun('candidate')) : null;
  write(join(out, 'declared-runtime-comparison.json'), comparison_with_declared_runtime ?? { status: 'unavailable', reason: 'missing or unmatched runtime evidence' });
  const pairs = manifest.schedule.attempts.map(item => {
    const trace = arm => traces[arm].find(t => t.scenario === item.scenario && t.attempt === item.attempt);
    const summaries = ['baseline', 'candidate'].map(arm => attempts.find(a => a.arm === arm && a.n === item.n));
    return { n: item.n, attempt: item.attempt, cache_strata: { baseline: summaries[0]?.cache_stratum ?? 'unknown', candidate: summaries[1]?.cache_stratum ?? 'unknown' }, ...classifyPair({ scenario: registry.scenarios.find(s => s.id === item.scenario), registry, baseline: trace('baseline'), candidate: trace('candidate'), declaration: manifest.declarations.entries.find(d => d.scenario === item.scenario), runtimeMatches: summaries.every(s => s?.runtime_matches_readiness === true), commandUse: summaries[1]?.command_use?.status, model: manifest.settings.model }) };
  });
  const counts = { planned: attempts.length, run: attempts.filter(a => a.status !== 'not-run').length, not_run: attempts.filter(a => a.status === 'not-run').length };
  const status = stopped_by || pairs.some(p => p.classification === 'incomplete') ? 'incomplete' : pairs.every(p => ['preserved', 'declared-change'].includes(p.classification)) ? 'complete' : 'failed';
  const report = { schema: 2, kind: 'command-pairs', status, stopped_by, counts, pairs, attempts, comparison, comparison_with_declared_runtime,
    comparison_note: 'Raw strict comparison retains unpaired-runtime entries for the declared tool and harness treatment. The derived comparison substitutes the verified common runtime only when every execution matches readiness. It still fails on declared event differences or baseline obligation failures; acceptance uses the separate pair classifications. Saved traces are unchanged.',
    arm_totals: Object.fromEntries(['baseline', 'candidate'].map(arm => [arm, armTotals(attempts, arm)])), elapsed_ms: clock() - started,
    ...ledgerAccounting(ledger),
    command_ms: attempts.reduce((sum, a) => sum + (a.command_use?.command_ms ?? 0), 0),
    command_time_complete: attempts.filter(a => a.status !== 'not-run').every(a => typeof a.command_use?.command_ms === 'number'),
    strata_differ: pairs.filter(p => p.cache_strata.baseline !== p.cache_strata.candidate).map(p => ({ n: p.n, scenario: p.scenario, ...p.cache_strata })),
  };
  write(join(out, 'report.json'), report);
  return report;
}
