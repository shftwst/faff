// Schema-2 controlled-run evidence: registry and trace validation, independent obligations and
// arm comparison. Supersedes the schema-1 draft at eval/control-parity.mjs for acceptance; the draft
// stays as it was and carries no acceptance authority.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 2;
const HASH = /^[a-f0-9]{64}$/;
const OUTCOMES = new Set(['applied', 'rejected', 'unknown']);
const STATUSES = new Set(['completed', 'blocked']);
const INTEGER = /^-?(0|[1-9]\d*)$/;

const fail = message => { throw new Error(message); };
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasKeys = (v, keys) => isObject(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const nonEmpty = v => typeof v === 'string' && v.trim() !== '';
const hash = (v, name) => { if (typeof v !== 'string' || !HASH.test(v)) fail(`Invalid ${name}`); };

export function validateJsonValue(value, path = '$', ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail(`${path}: numbers must be safe integers`);
    return;
  }
  if (typeof value !== 'object') fail(`${path}: non-JSON value`);
  if (ancestors.has(value)) fail(`${path}: cycle`);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail(`${path}: sparse or decorated array`);
  } else if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(`${path}: not a plain object`);
  }
  if (Reflect.ownKeys(value).some(k => typeof k !== 'string')) fail(`${path}: symbol key`);
  ancestors.add(value);
  for (const [k, child] of Object.entries(value)) validateJsonValue(child, `${path}.${k}`, ancestors);
  ancestors.delete(value);
}

// JSON.parse silently rounds unsafe integers and keeps the last of duplicate keys, either of which
// can make distinct evidence compare equal. Scan the source text before parsing.
export function parseStrictJson(text) {
  const stack = [];
  let i = 0;
  const readString = () => {
    let j = i + 1;
    while (text[j] !== '"') { if (j >= text.length) fail('Unterminated string'); j += text[j] === '\\' ? 2 : 1; }
    const raw = text.slice(i, j + 1);
    i = j + 1;
    return JSON.parse(raw);
  };
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const value = readString();
      const top = stack.at(-1);
      if (top?.type === 'object' && top.expectKey) {
        if (top.keys.has(value)) fail(`Duplicate key ${JSON.stringify(value)}`);
        top.keys.add(value);
        top.expectKey = false;
      }
    } else if (c === '{') { stack.push({ type: 'object', keys: new Set(), expectKey: true }); i++; }
    else if (c === '[') { stack.push({ type: 'array' }); i++; }
    else if (c === '}' || c === ']') { stack.pop(); i++; }
    else if (c === ',') { const top = stack.at(-1); if (top?.type === 'object') top.expectKey = true; i++; }
    else if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?[0-9][0-9eE.+-]*/.exec(text.slice(i))[0];
      if (!INTEGER.test(m) || m === '-0' || !Number.isSafeInteger(Number(m))) fail(`Number ${m} is not a safe integer`);
      i += m.length;
    } else i++;
  }
  return JSON.parse(text);
}

function order(value) {
  if (Array.isArray(value)) return value.map(order);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, order(value[k])]));
  return value;
}
export const canonical = value => { validateJsonValue(value); return JSON.stringify(order(value)); };
export const canonicalHash = value => createHash('sha256').update(canonical(value)).digest('hex');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateRegistry(registry) {
  validateJsonValue(registry);
  if (!hasKeys(registry, ['schema', 'registry_id', 'reason_codes', 'scenarios'])) fail('Unexpected registry shape');
  if (registry.schema !== SCHEMA || !nonEmpty(registry.registry_id)) fail('Registry must be schema 2 with an id');
  if (!Array.isArray(registry.reason_codes) || !registry.reason_codes.length || !registry.reason_codes.every(nonEmpty)) fail('Registry needs reason codes');
  if (!Array.isArray(registry.scenarios) || !registry.scenarios.length) fail('Registry needs scenarios');
  const ids = new Set();
  for (const s of registry.scenarios) {
    if (!hasKeys(s, ['id', 'synthetic', 'input_sha256', 'policy_sha256', 'source_rules', 'expected'])) fail('Unexpected scenario shape');
    if (!nonEmpty(s.id) || ids.has(s.id)) fail(`Missing or duplicate scenario ${s.id}`);
    ids.add(s.id);
    if (typeof s.synthetic !== 'boolean') fail(`${s.id}: synthetic must be boolean`);
    hash(s.input_sha256, `${s.id} input_sha256`);
    hash(s.policy_sha256, `${s.id} policy_sha256`);
    if (!Array.isArray(s.source_rules) || !s.source_rules.length || !s.source_rules.every(nonEmpty)) fail(`${s.id}: source rules required`);
    const e = s.expected;
    if (!hasKeys(e, ['reads_before_first_effect', 'effects', 'terminal', 'final_state_sha256'])) fail(`${s.id}: unexpected expectation shape`);
    for (const list of [e.reads_before_first_effect, e.effects]) {
      if (!Array.isArray(list) || !list.every(x => hasKeys(x, ['op', 'args']) && nonEmpty(x.op) && isObject(x.args))) fail(`${s.id}: malformed operation list`);
    }
    if (!hasKeys(e.terminal, ['status', 'reason']) || !STATUSES.has(e.terminal.status) || !registry.reason_codes.includes(e.terminal.reason)) fail(`${s.id}: malformed terminal expectation`);
    hash(e.final_state_sha256, `${s.id} final_state_sha256`);
  }
  return registry;
}

const EVENT_KEYS = {
  read: ['seq', 'kind', 'op', 'args', 'result'],
  'effect-attempt': ['seq', 'kind', 'id', 'op', 'args'],
  'effect-result': ['seq', 'kind', 'attempt_id', 'outcome', 'acknowledged'],
  terminal: ['seq', 'kind', 'status', 'reason', 'final_state_sha256'],
};

function validateStructure(trace, registry) {
  validateJsonValue(trace);
  if (!hasKeys(trace, ['schema', 'scenario', 'attempt', 'input_sha256', 'policy_sha256', 'prompt_sha256', 'runtime_sha256', 'events', 'final_state_sha256', 'stop', 'accounting'])) fail('Unexpected trace shape');
  if (trace.schema !== SCHEMA || !nonEmpty(trace.scenario) || !Number.isSafeInteger(trace.attempt) || trace.attempt < 1) fail('Invalid trace identity');
  for (const f of ['input_sha256', 'policy_sha256', 'prompt_sha256', 'runtime_sha256', 'final_state_sha256']) hash(trace[f], f);
  if (trace.stop !== null && !(hasKeys(trace.stop, ['reason']) && nonEmpty(trace.stop.reason))) fail('Invalid stop record');
  const a = trace.accounting;
  if (!hasKeys(a, ['usage_complete', 'served_models', 'requests']) || typeof a.usage_complete !== 'boolean' || !Array.isArray(a.served_models) || !a.served_models.every(nonEmpty) || !Number.isSafeInteger(a.requests) || a.requests < 0) fail('Invalid accounting');
  if (!Array.isArray(trace.events)) fail('Events must be an array');
  const attempts = new Map();
  const resolved = new Set();
  let terminal = null;
  trace.events.forEach((e, index) => {
    const keys = EVENT_KEYS[e?.kind];
    if (!keys || !hasKeys(e, keys)) fail(`Event ${index}: unknown kind or shape`);
    if (e.seq !== index + 1) fail(`Event ${index}: sequence must be contiguous from 1`);
    if (terminal) fail(`Event ${index}: event after terminal`);
    if (e.kind === 'read' || e.kind === 'effect-attempt') {
      if (!nonEmpty(e.op) || !isObject(e.args)) fail(`Event ${index}: malformed operation`);
    }
    if (e.kind === 'effect-attempt') {
      if (!nonEmpty(e.id) || attempts.has(e.id)) fail(`Event ${index}: missing or repeated attempt id`);
      attempts.set(e.id, e);
    }
    if (e.kind === 'effect-result') {
      if (!attempts.has(e.attempt_id)) fail(`Event ${index}: result without a preceding attempt`);
      if (resolved.has(e.attempt_id)) fail(`Event ${index}: repeated result for ${e.attempt_id}`);
      if (!OUTCOMES.has(e.outcome) || typeof e.acknowledged !== 'boolean') fail(`Event ${index}: invalid outcome`);
      resolved.add(e.attempt_id);
    }
    if (e.kind === 'terminal') {
      if (!STATUSES.has(e.status) || !registry.reason_codes.includes(e.reason)) fail(`Event ${index}: terminal needs a status and a registry reason code`);
      hash(e.final_state_sha256, 'terminal final_state_sha256');
      if (e.final_state_sha256 !== trace.final_state_sha256) fail('Terminal final-state hash differs from the host-observed state');
      terminal = e;
    }
  });
  if (!terminal && trace.stop === null) fail('Trace has neither a terminal event nor a recorded stop');
  return { attempts, resolved, terminal };
}

// Obligations come from the registry, never from the other arm: equal arms can share a defect.
export function validateTrace(trace, scenario, registry) {
  const { attempts, resolved, terminal } = validateStructure(trace, registry);
  if (trace.scenario !== scenario.id) fail(`Trace scenario ${trace.scenario} is not ${scenario.id}`);
  if (trace.input_sha256 !== scenario.input_sha256) fail(`${scenario.id}: input hash differs from the registry`);
  if (trace.policy_sha256 !== scenario.policy_sha256) fail(`${scenario.id}: policy hash differs from the registry`);
  const failures = [];
  const incomplete = [];
  if (trace.stop) incomplete.push(`stopped:${trace.stop.reason}`);
  if (!trace.accounting.usage_complete) incomplete.push('usage-incomplete');
  if (!trace.accounting.served_models.length) incomplete.push('served-model-missing');
  const events = trace.events;
  const unresolved = [...attempts.keys()].filter(id => !resolved.has(id) || events.find(e => e.kind === 'effect-result' && e.attempt_id === id).outcome === 'unknown');
  if (unresolved.length) incomplete.push('unresolved-attempt');

  const firstEffect = events.findIndex(e => e.kind === 'effect-attempt');
  const before = firstEffect === -1 ? events : events.slice(0, firstEffect);
  const readsOk = scenario.expected.reads_before_first_effect.every(r => before.some(e => e.kind === 'read' && e.op === r.op && canonical(e.args) === canonical(r.args)));
  if (!readsOk) failures.push('read-before-effect');
  const applied = events.filter(e => e.kind === 'effect-result' && e.outcome === 'applied').map(e => ({ op: attempts.get(e.attempt_id).op, args: attempts.get(e.attempt_id).args }));
  if (!unresolved.length && canonical(applied) !== canonical(scenario.expected.effects)) failures.push('effects-differ');
  if (trace.final_state_sha256 !== scenario.expected.final_state_sha256) failures.push('final-state-differs');
  if (terminal && (terminal.status !== scenario.expected.terminal.status || terminal.reason !== scenario.expected.terminal.reason)) failures.push('terminal-differs');

  // An interrupted or unresolved run is never graded as behaviour: its failures are kept for the
  // report, but the attempt stays incomplete in the denominator.
  const interrupted = trace.stop !== null || unresolved.length > 0;
  const status = interrupted || (incomplete.length && !failures.length) ? 'incomplete' : failures.length ? 'fail' : 'pass';
  return { status, failures, incomplete };
}

// The semantic projection: reads with results, effect attempts and results, terminal state. Raw
// model output and usage stay in separate capture and never enter equality.
export const projection = trace => trace.events.map(({ seq, ...rest }) => rest);

function indexArm(registry, arm, name) {
  validateJsonValue(arm);
  if (!hasKeys(arm, ['schema', 'run_id', 'traces']) || arm.schema !== SCHEMA || !Array.isArray(arm.traces)) fail(`${name}: unexpected run shape`);
  const known = new Map(registry.scenarios.map(s => [s.id, s]));
  const byKey = new Map();
  for (const t of arm.traces) {
    if (!known.has(t?.scenario)) fail(`${name}: unexpected scenario ${t?.scenario}`);
    const key = `${t.scenario}#${t.attempt}`;
    if (byKey.has(key)) fail(`${name}: duplicate trace ${key}`);
    byKey.set(key, t);
  }
  const results = new Map();
  for (const [key, t] of byKey) results.set(key, validateTrace(t, known.get(t.scenario), registry));
  const present = new Set([...byKey.values()].map(t => t.scenario));
  const missing = registry.scenarios.map(s => s.id).filter(id => !present.has(id));
  return { byKey, results, missing };
}

export function compareRuns(registry, baseline, candidate) {
  validateRegistry(registry);
  const arms = { baseline: indexArm(registry, baseline, 'baseline'), candidate: indexArm(registry, candidate, 'candidate') };
  const differences = [];
  let failed = false;
  let incomplete = arms.baseline.missing.length > 0 || arms.candidate.missing.length > 0;
  for (const [name, arm] of Object.entries(arms)) {
    for (const [key, r] of arm.results) {
      if (r.status === 'fail') { failed = true; differences.push({ arm: name, trace: key, reason: 'obligation', failures: r.failures }); }
      if (r.status === 'incomplete') { incomplete = true; differences.push({ arm: name, trace: key, reason: 'incomplete', details: r.incomplete }); }
    }
  }
  const keys = new Set([...arms.baseline.byKey.keys(), ...arms.candidate.byKey.keys()]);
  for (const key of keys) {
    const before = arms.baseline.byKey.get(key);
    const after = arms.candidate.byKey.get(key);
    if (!before || !after) { incomplete = true; differences.push({ trace: key, reason: 'unpaired-attempt' }); continue; }
    if (before.runtime_sha256 !== after.runtime_sha256) { incomplete = true; differences.push({ trace: key, reason: 'unpaired-runtime' }); continue; }
    if (arms.baseline.results.get(key).status === 'incomplete' || arms.candidate.results.get(key).status === 'incomplete') continue;
    const a = projection(before);
    const b = projection(after);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length || canonical(a[i]) !== canonical(b[i])) { failed = true; differences.push({ trace: key, reason: 'event-differs', index: i }); break; }
    }
  }
  const status = failed ? 'fail' : incomplete ? 'incomplete' : 'pass';
  const coverage = Object.fromEntries(Object.entries(arms).map(([n, a]) => [n, { required: registry.scenarios.length, traces: a.byKey.size, missing: a.missing }]));
  return { schema: SCHEMA, status, coverage, differences };
}

const EXIT = { pass: 0, fail: 1, incomplete: 2 };
export function main(argv = process.argv.slice(2)) {
  const args = Object.fromEntries([0, 2, 4, 6].map(i => [argv[i], argv[i + 1]]));
  if (argv.length !== 8 || !['--registry', '--baseline', '--candidate', '--out'].every(f => args[f])) {
    fail('usage: node eval/control-parity/schema.mjs --registry FILE --baseline FILE --candidate FILE --out FILE');
  }
  const read = p => parseStrictJson(readFileSync(p, 'utf8'));
  const report = compareRuns(read(args['--registry']), read(args['--baseline']), read(args['--candidate']));
  writeFileSync(args['--out'], JSON.stringify(report, null, 2) + '\n');
  return EXIT[report.status];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
}
