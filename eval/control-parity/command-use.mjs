import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { CommandInputError, invokeCandidateCommand } from './candidate-command.mjs';
import { canonicalHash } from './schema.mjs';
import { TrackerError } from './tracker.mjs';

export const COMMAND_TOOL = {
  name: 'plan_review_comment',
  description: 'Run faff review-comment plan on the supplied current comments and replacement text. Returns a proposed write without changing the tracker.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['schema', 'issue_id', 'faff_body', 'comments'],
    properties: {
      schema: { type: 'integer', const: 1 }, issue_id: { type: 'string' }, faff_body: { type: 'string' },
      comments: { type: 'array', items: { type: 'object', required: ['id', 'body'], properties: { id: { type: 'string' }, body: { type: 'string' } }, additionalProperties: true } },
    },
  },
};

export function readCommandEvents(directory) {
  const path = join(directory, 'commands.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

function append(directory, event) {
  const fd = openSync(join(directory, 'commands.jsonl'), 'a');
  try { writeSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}

export function createCommandAdapter({ binding, directory, tracker, maxCalls = 16, invoke = invokeCandidateCommand }) {
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1) throw new Error('invalid command call limit');
  return { async call(input) {
    const prior = readCommandEvents(directory);
    const call_seq = prior.filter(e => e.kind === 'command-attempt').length + 1;
    append(directory, { seq: prior.length + 1, kind: 'command-attempt', call_seq, after_event_seq: tracker.readEvents().at(-1)?.seq ?? 0, input });
    let result;
    try {
      if (tracker.readState().finished) {
        tracker.recordViolation('post-finish-call', COMMAND_TOOL.name, input);
        throw new Error('session finished; no further calls are accepted');
      }
      if (call_seq > maxCalls) throw new CommandInputError('command call limit exceeded', 'command-call-limit');
      result = invoke(binding, input);
    } catch (error) {
      const modelError = error instanceof CommandInputError;
      result = { plan: null, evidence: { error: error.message, reason: modelError ? error.reason : 'command-refused', refused: !modelError, elapsed_ms: 0 } };
      if (!modelError) tracker.recordViolation('command-refused', COMMAND_TOOL.name, input);
    }
    append(directory, { seq: prior.length + 2, kind: 'command-result', call_seq, ...result });
    if (!result.plan || result.evidence.error) throw new TrackerError(JSON.stringify({ error: result.evidence.error, exit_code: result.evidence.exit_code ?? null, stderr: result.evidence.stderr ?? '' }));
    return result.plan;
  } };
}

export function gradeCommandUse({ commands, events, fixture, stop = null }) {
  const calls = commands.filter(e => e.kind === 'command-attempt');
  const results = commands.filter(e => e.kind === 'command-result');
  const base = { calls: calls.length, command_ms: results.reduce((sum, e) => sum + (e.evidence?.spawn_elapsed_ms ?? e.evidence?.elapsed_ms ?? 0), 0) };
  const grade = status => ({ status, ...base });
  if (stop || events.some(e => e.kind === 'protocol-violation') || results.some(r => r.evidence?.refused)
    || commands.some((e, i) => e.seq !== i + 1 || e.kind !== (i % 2 ? 'command-result' : 'command-attempt'))
    || calls.length !== results.length || calls.some((c, i) => c.call_seq !== i + 1 || results[i]?.call_seq !== c.call_seq)) return grade('incomplete');
  if (!calls.length) return grade('not-used');
  if (results.some(r => !r.plan || r.evidence?.error)) return grade('command-error');
  const effects = events.filter(e => e.kind === 'effect-attempt');
  if (!effects.length || calls.some(c => c.after_event_seq >= effects[0].seq)) return grade('not-used');
  for (const c of calls) {
    const read = events.filter(e => e.kind === 'read' && e.op === 'list_comments' && e.seq <= c.after_event_seq).at(-1);
    if (!read || read.args.issue_id !== fixture.issue_id || !read.result.comments
      || canonicalHash(c.input) !== canonicalHash({ schema: 1, issue_id: fixture.issue_id, faff_body: fixture.faff_body, comments: read.result.comments })) return grade('input-mismatch');
  }
  const plan = results.at(-1).plan;
  const expected = plan.action === 'create'
    ? { op: 'create_comment', args: { issue_id: fixture.issue_id, body: plan.body } }
    : { op: 'save_comment', args: { id: plan.comment_id, body: plan.body } };
  const outcomes = events.filter(e => e.kind === 'effect-result');
  const terminal = events.filter(e => e.kind === 'terminal');
  if (effects.length !== 1 || canonicalHash({ op: effects[0].op, args: effects[0].args }) !== canonicalHash(expected)
    || outcomes.length !== 1 || outcomes[0].attempt_id !== effects[0].id || outcomes[0].outcome !== 'applied' || !outcomes[0].acknowledged
    || terminal.length !== 1 || terminal[0].status !== 'completed' || terminal[0].reason !== plan.reason) return grade('not-followed');
  return grade('followed');
}
