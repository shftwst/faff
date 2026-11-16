import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const harness = resolve(process.argv[3]);
const moduleAt = name => import(pathToFileURL(join(harness, 'eval/control-parity', name)));
const { canonicalHash, validateTrace } = await moduleAt('schema.mjs');
const { gradeCommandUse, readCommandEvents } = await moduleAt('command-use.mjs');
const { parseSse } = await moduleAt('proxy.mjs');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const lines = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const run = join(root, 'run');
const registry = json(join(harness, 'eval/control-parity/registry.json'));
const fixtures = json(join(harness, 'eval/control-parity/fixtures/review-comments.json')).scenarios;
const manifest = json(join(run, 'manifest.json'));
const ledger = json(join(run, 'ledger.json'));
const report = existsSync(join(run, 'report.json')) ? json(join(run, 'report.json')) : null;
const rows = [];
for (const execution of manifest.schedule.executions) {
  const name = `${String(execution.n).padStart(2, '0')}-${execution.arm}-${execution.scenario}-${execution.attempt}`;
  const dir = join(run, 'attempts', name);
  if (!existsSync(join(dir, 'trace.json'))) continue;
  const trace = json(join(dir, 'trace.json'));
  const record = json(join(dir, 'evidence/attempt.json'));
  const events = lines(join(dir, 'tracker/events.jsonl'));
  const fixture = fixtures.find(f => f.id === execution.scenario);
  const checked = validateTrace(trace, registry.scenarios.find(s => s.id === execution.scenario), registry);
  const command = execution.arm === 'candidate' ? gradeCommandUse({ commands: readCommandEvents(join(dir, 'tracker')), events, fixture, stop: trace.stop }) : null;
  assert.equal(trace.accounting.usage_complete, true, name);
  assert.equal(record.proxy.other_paths.length, 0, name);
  assert.equal(record.proxy.requests.length, trace.accounting.requests, name);
  let cost = 0;
  let firstRuntime;
  const tokenTotals = { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
  for (const request of record.proxy.requests) {
    const prefix = join(dir, 'evidence/requests', String(request.n).padStart(3, '0'));
    const evidence = json(`${prefix}.request.json`);
    const parsed = parseSse(readFileSync(`${prefix}.response.txt`, 'utf8'));
    assert.equal(parsed.complete, true, name);
    assert.equal(parsed.model, manifest.settings.model, name);
    assert.equal(canonicalHash(parsed.usage), canonicalHash(request.usage), name);
    assert.equal(Object.keys(evidence.headers).some(k => /^(authorization|x-api-key|cookie|proxy-authorization)$/i.test(k)), false, name);
    const { messages, metadata, ...runtime } = evidence.body;
    if (metadata) { runtime.metadata = { ...metadata }; delete runtime.metadata.user_id; }
    const hash = canonicalHash(runtime);
    firstRuntime ??= hash;
    assert.equal(hash, firstRuntime, name);
    const u = parsed.usage;
    assert.equal(u.cache_creation_input_tokens, u.cache_creation.ephemeral_5m_input_tokens + u.cache_creation.ephemeral_1h_input_tokens, name);
    const tokens = { input: u.input_tokens, output: u.output_tokens, cache_read: u.cache_read_input_tokens, cache_write_5m: u.cache_creation.ephemeral_5m_input_tokens, cache_write_1h: u.cache_creation.ephemeral_1h_input_tokens };
    const costOfRequest = Object.entries(tokens).reduce((sum, [key, value]) => sum + value * manifest.pricing.nano_per_token[key], 0);
    assert.equal(costOfRequest, request.cost_nanos, name);
    for (const [key, value] of Object.entries(tokens)) tokenTotals[key] += value;
    cost += costOfRequest;
  }
  const summary = report?.attempts.find(a => a.execution === execution.execution);
  if (summary) {
    assert.equal(summary.status, checked.status, name);
    assert.equal(summary.observed_cost_nanos, cost, name);
    assert.equal(summary.runtime_matches_readiness, true, name);
    assert.equal(summary.requests_with_unknown_cost, 0, name);
    if (command) assert.deepEqual(summary.command_use, command, name);
  }
  rows.push({ execution: execution.execution, arm: execution.arm, scenario: execution.scenario, status: checked.status, failures: checked.failures, incomplete: checked.incomplete, command, requests: record.proxy.requests.length, cost_nanos: cost, tokens: tokenTotals });
}
const totalCost = rows.reduce((sum, row) => sum + row.cost_nanos, 0);
if (report) {
  assert.equal(rows.length, 22);
  assert.equal(report.counts.not_run, 0);
  assert.equal(report.observed_cost_nanos, totalCost);
  assert.equal(ledger.entries.every(e => e.state === 'reconciled'), true);
  assert.equal(ledger.entries.reduce((sum, e) => sum + e.actual_nanos, 0), totalCost);
  assert.equal(ledger.entries.length, rows.reduce((sum, row) => sum + row.requests, 0));
  assert.equal(report.held_reservation_nanos, 0);
  assert.equal(report.open_reservation_nanos, 0);
  assert.ok(totalCost <= manifest.limits.allowance_nanos);
}
console.log(JSON.stringify({ complete: Boolean(report), checked_attempts: rows.length, checked_requests: rows.reduce((sum, row) => sum + row.requests, 0), total_cost_nanos: totalCost, rows }, null, 2));
