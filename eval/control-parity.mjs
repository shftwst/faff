import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KINDS = new Set(['read', 'decision', 'effect-attempt', 'effect-result', 'artifact', 'terminal']);
const HASH = /^[a-f0-9]{64}$/;
const keysEqual = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const canonical = value => JSON.stringify(order(value));
function validateJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') throw new Error('Payload contains a non-JSON value');
  if (ancestors.has(value)) throw new Error('Payload contains a cycle');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Payload must contain plain JSON objects');
  if (Reflect.ownKeys(value).some(k => typeof k !== 'string')) throw new Error('Payload contains symbol keys');
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || !Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean))) throw new Error('Payload contains a non-JSON array');
  ancestors.add(value);
  for (const child of Object.values(value)) validateJson(child, ancestors);
  ancestors.delete(value);
}
function order(value) {
  if (Array.isArray(value)) return value.map(order);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, order(value[k])]));
  return value;
}

export function validateSuite(suite) {
  if (!keysEqual(suite, ['schema', 'scenarios']) || suite.schema !== 1 || !Array.isArray(suite.scenarios) || !suite.scenarios.length) throw new Error('Expected non-empty schema:1 scenarios');
  const names = new Set();
  for (const trace of suite.scenarios) {
    if (!keysEqual(trace, ['scenario', 'inputs_sha256', 'policy_sha256', 'prompt_sha256', 'events'])) throw new Error('Unexpected trace shape');
    if (typeof trace.scenario !== 'string' || !trace.scenario.trim() || names.has(trace.scenario)) throw new Error('Missing or duplicate scenario');
    names.add(trace.scenario);
    for (const field of ['inputs_sha256', 'policy_sha256', 'prompt_sha256']) if (typeof trace[field] !== 'string' || !HASH.test(trace[field])) throw new Error(`Invalid ${field}`);
    if (!Array.isArray(trace.events) || trace.events.length < 2) throw new Error('Trace needs evidence and a terminal event');
    for (const event of trace.events) {
      if (!keysEqual(event, ['kind', 'target', 'payload']) || !KINDS.has(event.kind) || typeof event.target !== 'string' || !event.target.trim() || event.payload === null || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('Invalid event');
      validateJson(event.payload);
    }
    if (trace.events.filter(e => e.kind === 'terminal').length !== 1 || trace.events.at(-1).kind !== 'terminal') throw new Error('Exactly one final terminal event required');
  }
  return suite;
}

export function compareSuites(baseline, candidate) {
  validateSuite(baseline); validateSuite(candidate);
  const after = new Map(candidate.scenarios.map(t => [t.scenario, t]));
  const differences = [];
  for (const before of baseline.scenarios) {
    const next = after.get(before.scenario);
    after.delete(before.scenario);
    if (!next) { differences.push({ scenario: before.scenario, reason: 'missing-candidate' }); continue; }
    for (const field of ['inputs_sha256', 'policy_sha256']) if (before[field] !== next[field]) differences.push({ scenario: before.scenario, reason: `unpaired-${field}` });
    for (let i = 0; i < Math.max(before.events.length, next.events.length); i++) {
      if (canonical(before.events[i]) !== canonical(next.events[i])) differences.push({ scenario: before.scenario, reason: 'event-differs', index: i });
    }
  }
  for (const scenario of after.keys()) differences.push({ scenario, reason: 'missing-baseline' });
  return { schema: 1, pass: differences.length === 0, scenarios: baseline.scenarios.length, differences, scope: 'Equality of supplied normalised traces only. Does not execute a skill, establish capture completeness, validate oracle correctness, or prove live model parity.' };
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length !== 6 || argv[0] !== '--baseline' || argv[2] !== '--candidate' || argv[4] !== '--out') throw new Error('usage: node eval/control-parity.mjs --baseline FILE --candidate FILE --out FILE');
  const report = compareSuites(JSON.parse(readFileSync(argv[1], 'utf8')), JSON.parse(readFileSync(argv[3], 'utf8')));
  writeFileSync(argv[5], JSON.stringify(report, null, 2) + '\n');
  return report.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
