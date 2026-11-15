// File-backed fixture tracker for controlled runs. Every call is recorded around the actual operation,
// state persists on disk, and final state is re-read from disk after the driver returns. This proves
// local simulated effects only: real connector pagination, compare-and-swap, readback and idempotency
// are separate qualification requirements.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalHash, sha256, validateJsonValue } from './schema.mjs';

export const REASON_CODES = Object.freeze(['created', 'updated', 'reconciled', 'blocked']);
export const STATUSES = Object.freeze(['completed', 'blocked']);
const TRACE_KINDS = new Set(['read', 'effect-attempt', 'effect-result', 'terminal']);
const POLICY_START = '### Review-findings comment identity';
const POLICY_END = '### Producer slots';

export class TrackerError extends Error {}

export function loadPolicyBytes(root) {
  const text = readFileSync(join(root, 'plugin/skills/faff/references/review.md'), 'utf8');
  const start = text.indexOf(POLICY_START);
  const end = text.indexOf(POLICY_END);
  if (start === -1 || end <= start) throw new Error('review.md policy section anchors moved');
  return Buffer.from(text.slice(start, end), 'utf8');
}

export const finalStateHash = state => canonicalHash(state.issues);

const writeAtomic = (path, value) => {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
};
const appendDurable = (path, value) => {
  const fd = openSync(path, 'a');
  try { writeSync(fd, JSON.stringify(value) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
};
const jsonSafe = value => {
  try { validateJsonValue(value); return value; } catch { return { unrepresentable: String(JSON.stringify(value)) }; }
};
const exactStrings = (args, keys) => args !== null && typeof args === 'object' && !Array.isArray(args)
  && Object.keys(args).sort().join(',') === [...keys].sort().join(',') && keys.every(k => typeof args[k] === 'string');

export function createFixtureTracker({ directory, initialState, issueId, faults = [] }) {
  const statePath = join(directory, 'state.json');
  const eventsPath = join(directory, 'events.jsonl');
  if (initialState) {
    if (existsSync(statePath)) throw new Error(`Fixture state already exists in ${directory}`);
    mkdirSync(directory, { recursive: true });
    writeAtomic(statePath, {
      schema: 2,
      issues: { [issueId]: structuredClone(initialState.comments) },
      next_comment_id: initialState.next_comment_id,
      now: initialState.now,
      creates: 0,
      op_counts: {},
      faults,
      finished: null,
    });
    writeFileSync(eventsPath, '');
  } else if (!existsSync(statePath)) {
    throw new Error(`No fixture state in ${directory}`);
  }

  const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const readEvents = () => readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const record = event => appendDurable(eventsPath, { seq: readEvents().length + 1, ...event });

  const open = () => {
    const state = readState();
    if (state.finished) throw new TrackerError('session finished; no further calls are accepted');
    return state;
  };

  const effect = async (op, args, keys, apply) => {
    const state = open();
    const n = (state.op_counts[op] ?? 0) + 1;
    state.op_counts[op] = n;
    writeAtomic(statePath, state);
    const id = `e${Object.values(state.op_counts).reduce((a, b) => a + b, 0)}`;
    record({ kind: 'effect-attempt', id, op, args: jsonSafe(args) });
    const result = (outcome, acknowledged) => record({ kind: 'effect-result', attempt_id: id, outcome, acknowledged });
    if (!exactStrings(args, keys)) { result('rejected', true); throw new TrackerError(`invalid arguments; expected string fields ${keys.join(', ')}`); }
    const fault = state.faults.find(f => f.op === op && f.nth === n);
    if (fault?.mode === 'crash') throw new Error('fixture crash after attempt was recorded');
    if (fault?.mode === 'reject') { result('rejected', true); throw new TrackerError('rejected by tracker'); }
    if (fault?.mode === 'drop') { result('rejected', false); throw new TrackerError('timeout: no response from tracker'); }
    if (fault?.mode === 'human-edit') {
      const target = Object.values(state.issues).flat().find(c => c.id === args.id);
      if (target) {
        target.body = fault.body;
        writeAtomic(statePath, state);
        record({ kind: 'fixture-mutation', target: args.id, note: 'concurrent human edit applied before the write' });
      }
    }
    const fresh = readState();
    const outcome = apply(fresh);
    if (outcome.error) { result('rejected', true); throw new TrackerError(outcome.error); }
    writeAtomic(statePath, fresh);
    if (fault?.mode === 'lose-ack') { result('applied', false); throw new TrackerError('timeout: no response from tracker'); }
    result('applied', true);
    return outcome.value;
  };

  const ports = {
    async list_comments(args) {
      const state = open();
      if (!exactStrings(args, ['issue_id'])) {
        record({ kind: 'read', op: 'list_comments', args: jsonSafe(args), result: { error: 'invalid-arguments' } });
        throw new TrackerError('invalid arguments; expected string field issue_id');
      }
      const comments = state.issues[args.issue_id];
      const result = comments ? { comments } : { error: 'unknown-issue' };
      record({ kind: 'read', op: 'list_comments', args, result });
      if (!comments) throw new TrackerError(`unknown issue ${args.issue_id}`);
      return structuredClone(result);
    },
    create_comment: args => effect('create_comment', args, ['issue_id', 'body'], state => {
      const comments = state.issues[args.issue_id];
      if (!comments) return { error: `unknown issue ${args.issue_id}` };
      state.creates += 1;
      const id = state.creates === 1 ? state.next_comment_id : `${state.next_comment_id}.${state.creates}`;
      comments.push({ id, created_at: state.now, body: args.body });
      return { value: { id } };
    }),
    save_comment: args => effect('save_comment', args, ['id', 'body'], state => {
      const target = Object.values(state.issues).flat().find(c => c.id === args.id);
      if (!target) return { error: `unknown comment ${args.id}` };
      target.body = args.body;
      return { value: { id: args.id } };
    }),
    async finish(args) {
      const state = open();
      if (!exactStrings(args, ['status', 'reason'])) throw new TrackerError('invalid arguments; expected string fields status, reason');
      if (!STATUSES.includes(args.status)) throw new TrackerError(`status must be one of ${STATUSES.join(', ')}`);
      if (!REASON_CODES.includes(args.reason)) throw new TrackerError(`reason must be one of ${REASON_CODES.join(', ')}`);
      state.finished = { status: args.status, reason: args.reason };
      writeAtomic(statePath, state);
      record({ kind: 'terminal', status: args.status, reason: args.reason });
      return { finished: true };
    },
  };

  return { ports, readState, readEvents, close() {} };
}

const MISSING_ACCOUNTING = Object.freeze({ usage_complete: false, served_models: [], requests: 0 });

export async function captureScenario({ driver, fixture, registryEntry, directory, policyBytes, promptSha256, runtimeSha256, faults = [], attempt = 1 }) {
  const tracker = createFixtureTracker({ directory, initialState: fixture.tracker, issueId: fixture.issue_id, faults });
  const input = { issue_id: fixture.issue_id, faff_body: fixture.faff_body, reason_codes: [...REASON_CODES] };
  let result;
  let stop = null;
  try {
    result = await driver({ ports: tracker.ports, input });
    stop = result?.stop ?? null;
  } catch (error) {
    stop = { reason: 'driver-error' };
    result = { accounting: error?.accounting };
  }
  tracker.close();

  const observed = createFixtureTracker({ directory });
  const state = observed.readState();
  const finalHash = finalStateHash(state);
  const events = observed.readEvents()
    .filter(e => TRACE_KINDS.has(e.kind))
    .map((e, i) => (e.kind === 'terminal' ? { ...e, seq: i + 1, final_state_sha256: finalHash } : { ...e, seq: i + 1 }));
  const trace = {
    schema: 2,
    scenario: registryEntry.id,
    attempt,
    input_sha256: canonicalHash(fixture),
    policy_sha256: sha256(policyBytes),
    prompt_sha256: promptSha256,
    runtime_sha256: runtimeSha256,
    events,
    final_state_sha256: finalHash,
    stop,
    accounting: result?.accounting ?? { ...MISSING_ACCOUNTING },
  };
  Object.defineProperty(trace, '__directory', { value: directory, enumerable: false });
  return trace;
}
