// New treatment: the committed production connector owns both tracker reads and writes.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { assertCandidateCommandUnchanged } from './candidate-command.mjs';
import { createFixtureTracker, TrackerError } from './tracker.mjs';
import { TOOL_DEFINITIONS } from './tool-server.mjs';
import { canonicalHash } from './schema.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = 'plugin/skills/faff/bin/lib/review-comment-server.js';
const same = (a, b) => canonicalHash(a) === canonicalHash(b);
export function readHandoffEvents(directory) {
  const file = join(directory, 'handoff.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
}
function append(directory, event) {
  const fd = openSync(join(directory, 'handoff.jsonl'), 'a');
  try { writeSync(fd, JSON.stringify(event) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
}

export async function openHandoff({ binding, directory }) {
  assertCandidateCommandUnchanged(binding);
  if (!binding.artifacts[ENTRY]) throw new Error('bound candidate has no production handoff');
  const production = await import(pathToFileURL(join(binding.root, ENTRY)));
  const tools = await production.openReviewCommentTools({
    schema: 1, command: process.execPath, args: [join(HERE, 'tool-server.mjs'), directory],
    tools: { list: 'list_comments', create: 'create_comment', update: 'save_comment' },
    issueArgument: 'issue_id', timestampField: 'created_at', listing: 'complete-comments',
  });
  const tracker = createFixtureTracker({ directory });
  let seq = 0, calls = 0;
  return {
    definitions: [...production.REVIEW_COMMENT_TOOLS, TOOL_DEFINITIONS.find(t => t.name === 'finish')],
    close: tools.close,
    async call(name, args) {
      append(directory, { seq: ++seq, kind: 'call', name, args, after_event_seq: tracker.readEvents().at(-1)?.seq ?? 0 });
      try {
        assertCandidateCommandUnchanged(binding);
        if (++calls > 16 || tracker.readState().finished) throw new Error('handoff calls exhausted or session finished');
        const result = name === 'finish' ? await tracker.ports.finish(args) : await tools.call(name, args);
        assertCandidateCommandUnchanged(binding);
        append(directory, { seq: ++seq, kind: 'result', name, result, after_event_seq: tracker.readEvents().at(-1)?.seq ?? 0 });
        return result;
      } catch (error) {
        append(directory, { seq: ++seq, kind: 'error', name, error: error.message, after_event_seq: tracker.readEvents().at(-1)?.seq ?? 0 });
        throw new TrackerError(error.message);
      }
    },
  };
}

export function gradeHandoff({ calls, events, fixture, stop = null }) {
  const result = status => ({ status, calls: calls.filter(c => c.kind === 'call').length });
  if (stop || events.some(e => e.kind === 'protocol-violation') || calls.some((c, i) => c.seq !== i + 1)) return result('incomplete');
  if (calls.length !== 6 || calls.some((c, i) => c.kind !== (i % 2 ? 'result' : 'call'))) return result('not-followed');
  const [prepare, prepared, apply, applied, finish, finished] = calls;
  if (prepare.name !== 'prepare_review_comment' || prepared.name !== prepare.name
    || !same(prepare.args, { issue_id: fixture.issue_id, faff_body: fixture.faff_body })
    || apply.name !== 'apply_review_comment' || applied.name !== apply.name
    || !same(apply.args, { plan_ref: prepared.result.plan_ref })
    || finish.name !== 'finish' || finished.name !== finish.name) return result('not-followed');
  const plan = prepared.result.plan;
  const expected = plan.action === 'create' ? { op: 'create_comment', args: { issue_id: fixture.issue_id, body: plan.body } }
    : { op: 'save_comment', args: { id: plan.comment_id, body: plan.body } };
  const writes = events.filter(e => e.kind === 'effect-attempt');
  const reads = events.filter(e => e.kind === 'read');
  if (writes.length !== 1 || !same({ op: writes[0].op, args: writes[0].args }, expected)) return result('effect-mismatch');
  if (reads.length !== 2 || reads.some(r => r.seq >= writes[0].seq || !same(r.args, { issue_id: fixture.issue_id }) || !same(r.result, { comments: fixture.tracker.comments }))
    || reads[0].seq <= prepare.after_event_seq || reads[0].seq > prepared.after_event_seq
    || reads[1].seq <= apply.after_event_seq || reads[1].seq > applied.after_event_seq) return result('read-mismatch');
  const outcomes = events.filter(e => e.kind === 'effect-result');
  if (outcomes.length !== 1 || !outcomes[0].acknowledged || outcomes[0].outcome !== 'applied'
    || applied.result.status !== 'acknowledged' || applied.result.reason !== plan.reason
    || !same(finish.args, { status: 'completed', reason: plan.reason })) return result('acknowledgement-mismatch');
  return result('followed');
}

export async function serveHandoff(directory, binding) {
  const handoff = await openHandoff({ binding, directory });
  const lines = createInterface({ input: process.stdin });
  let queue = Promise.resolve();
  const close = () => handoff.close();
  process.once('SIGTERM', () => { close(); process.exit(0); });
  process.once('SIGINT', () => { close(); process.exit(0); });
  lines.on('line', line => {
    queue = queue.then(async () => {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('oversized handoff request');
      const { id, method, params } = JSON.parse(line);
      if (id === undefined) return;
      let result;
      if (method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tracker', version: '3.0.0' } };
      else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools: handoff.definitions };
      else if (method === 'tools/call') {
        try {
          const value = await handoff.call(params.name, params.arguments);
          result = { content: [{ type: 'text', text: JSON.stringify(value) }], isError: false };
        } catch (error) { result = { content: [{ type: 'text', text: error.message }], isError: true }; }
      }
      process.stdout.write(JSON.stringify(result === undefined ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } } : { jsonrpc: '2.0', id, result }) + '\n');
    }).catch(error => { process.stderr.write(error.message + '\n'); close(); process.exitCode = 1; lines.close(); });
  });
  lines.once('close', () => { void queue.finally(close); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Fixture children receive no provider or host authentication environment.
  for (const key of Object.keys(process.env)) delete process.env[key];
  await serveHandoff(resolve(process.argv[2]), JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8')));
}
