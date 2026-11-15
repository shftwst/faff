// MCP stdio server exposing the fixture tracker as the only tools a controlled Claude run has.
// Usage: node eval/control-parity/tool-server.mjs <tracker-directory>
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { TrackerError, createFixtureTracker, REASON_CODES, STATUSES } from './tracker.mjs';
import { COMMAND_TOOL, createCommandAdapter } from './command-use.mjs';

const str = description => ({ type: 'string', description });
const TOOLS = [
  { name: 'list_comments', description: 'List every comment on an issue, in the order the tracker returns them, with each comment\'s fields as stored.', inputSchema: { type: 'object', properties: { issue_id: str('Issue id') }, required: ['issue_id'], additionalProperties: false } },
  { name: 'create_comment', description: 'Create a new comment on an issue.', inputSchema: { type: 'object', properties: { issue_id: str('Issue id'), body: str('Full comment body') }, required: ['issue_id', 'body'], additionalProperties: false } },
  { name: 'save_comment', description: 'Replace the full body of an existing comment.', inputSchema: { type: 'object', properties: { id: str('Comment id'), body: str('Full replacement body') }, required: ['id', 'body'], additionalProperties: false } },
  { name: 'finish', description: 'Report the outcome once the operation is complete or cannot proceed. No further tool calls are accepted afterwards.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...STATUSES] }, reason: { type: 'string', enum: [...REASON_CODES] } }, required: ['status', 'reason'], additionalProperties: false } },
];
export const TOOL_DEFINITIONS = TOOLS;
export const TOOL_NAMES = TOOLS.map(t => t.name);
export const CANDIDATE_TOOL_DEFINITIONS = [...TOOLS, COMMAND_TOOL];

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const text = (value, isError) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });

export async function handleMessage(tracker, message, log = () => {}, command = null) {
  const { id, method, params } = message ?? {};
  if (id === undefined) return null;
  if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tracker', version: '2.0.0' } });
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: command ? CANDIDATE_TOOL_DEFINITIONS : TOOLS });
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments ?? {};
    if (!TOOL_NAMES.includes(name) && !(command && name === COMMAND_TOOL.name)) {
      tracker.recordViolation('unknown-tool', typeof name === 'string' ? name : '<missing>', args);
      log({ name, arguments: args, isError: true, error: 'unknown-tool' });
      return reply(id, text(`unknown tool ${name}`, true));
    }
    try {
      const value = await (name === COMMAND_TOOL.name ? command.call(args) : tracker.ports[name](args));
      log({ name, arguments: args, isError: false });
      return reply(id, text(value, false));
    } catch (error) {
      log({ name, arguments: args, isError: true, error: error.message });
      if (!(error instanceof TrackerError)) throw error;
      return reply(id, text(error.message, true));
    }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
}

export function serve(directory, input = process.stdin, output = process.stdout, commandBinding = null) {
  const tracker = createFixtureTracker({ directory });
  const command = commandBinding ? createCommandAdapter({ binding: commandBinding, directory, tracker }) : null;
  const log = entry => appendFileSync(join(directory, 'tool-calls.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  const lines = createInterface({ input });
  let queue = Promise.resolve();
  lines.on('line', line => {
    queue = queue.then(async () => {
      let message;
      try { message = JSON.parse(line); } catch { log({ malformed: line }); return; }
      const response = await handleMessage(tracker, message, log, command);
      if (response) output.write(JSON.stringify(response) + '\n');
    }).catch(error => { log({ fatal: error.message }); process.exit(1); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  serve(resolve(process.argv[2]), process.stdin, process.stdout, process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]), 'utf8')) : null);
}
