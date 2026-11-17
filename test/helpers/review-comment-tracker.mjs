// Local stdio tracker double for production connector tests; no model or evaluation runner.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
export function createFixtureTracker({ directory, initialState, issueId, faults = [] }) {
  const statePath = join(directory, 'state.json'), eventsPath = join(directory, 'events.jsonl');
  const save = value => writeFileSync(statePath, JSON.stringify(value));
  if (initialState) {
    if (existsSync(statePath)) throw new Error('fixture already exists');
    mkdirSync(directory, { recursive: true });
    save({ issues: { [issueId]: initialState.comments }, next_comment_id: initialState.next_comment_id, now: initialState.now, creates: 0, counts: {}, faults });
    writeFileSync(eventsPath, '');
  }
  const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const readEvents = () => readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const record = event => appendFileSync(eventsPath, JSON.stringify(event) + '\n');
  const ports = {
    list_comments(args) {
      const comments = readState().issues[args.issue_id];
      if (!comments) throw new Error('unknown issue');
      record({ kind: 'read', op: 'list_comments', args });
      return { comments };
    },
  };
  for (const op of ['create_comment', 'save_comment']) ports[op] = args => {
    const state = readState(), keys = op === 'create_comment' ? ['body', 'issue_id'] : ['body', 'id'];
    if (Object.keys(args).sort().join() !== keys.join() || !Object.values(args).every(x => typeof x === 'string')) throw new Error('invalid write');
    state.counts[op] = (state.counts[op] ?? 0) + 1;
    record({ kind: 'effect-attempt', op, args });
    let id;
    if (op === 'create_comment') {
      if (!state.issues[args.issue_id]) throw new Error('unknown issue');
      state.creates++;
      id = state.creates === 1 ? state.next_comment_id : `${state.next_comment_id}.${state.creates}`;
      state.issues[args.issue_id].push({ id, created_at: state.now, body: args.body });
    } else {
      const target = Object.values(state.issues).flat().find(c => c.id === args.id);
      if (!target) throw new Error('unknown comment');
      target.body = args.body;
      id = target.id;
    }
    save(state);
    const lost = state.faults.some(f => f.op === op && f.nth === state.counts[op] && f.mode === 'lose-ack');
    record({ kind: 'effect-result', outcome: 'applied', acknowledged: !lost });
    if (lost) throw new Error('timeout: no response from tracker');
    return { id };
  };
  return { ports, readState, readEvents };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const tracker = createFixtureTracker({ directory: resolve(process.argv[2]) });
  createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line);
    if (m.id === undefined) return;
    let result;
    if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'test-tracker', version: '1' } };
    else if (m.method === 'tools/list') result = { tools: Object.keys(tracker.ports).map(name => ({ name, inputSchema: { type: 'object' } })) };
    else if (m.method === 'tools/call') {
      try { result = { content: [{ type: 'text', text: JSON.stringify(tracker.ports[m.params.name](m.params.arguments)) }] }; }
      catch (e) { result = { isError: true, content: [{ type: 'text', text: e.message }] }; }
    } else return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n');
  });
}
