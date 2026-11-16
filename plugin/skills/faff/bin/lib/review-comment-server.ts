// === region:factory — review-comment-server - review comment MCP tools ===
import { connectReviewTracker, isRecord, readMcpMessages } from './review-comment-mcp.ts';
import { type Readable, type Writable } from 'node:stream';
import { createReviewCommentSession } from './review-comment-session.ts';

const string = (description: string) => ({ type: 'string', description });
export const REVIEW_COMMENT_TOOLS = [
  { name: 'prepare_review_comment', description: 'Live-read all issue comments and prepare one review-findings update. Returns a preview and a session-local plan reference. Does not write.', inputSchema: { type: 'object', properties: { issue_id: string('Issue identifier'), faff_body: string('Replacement review findings text') }, required: ['issue_id', 'faff_body'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'apply_review_comment', description: 'Apply the exact stored review comment once. Accepts only the prepared reference. Refuses stale, expired or reused plans. An uncertain write must be checked before any further write.', inputSchema: { type: 'object', properties: { plan_ref: string('Reference returned by prepare_review_comment in this session') }, required: ['plan_ref'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false } },
];

export async function openReviewCommentTools(config: unknown) {
  const upstream = await connectReviewTracker(config);
  const session = createReviewCommentSession(upstream.ports);
  return {
    close: upstream.close,
    async call(name: string, args: unknown) {
      if (name === 'prepare_review_comment') return session.prepare(args);
      if (name === 'apply_review_comment') return session.apply(args);
      throw new Error('unknown review comment tool');
    },
  };
}

export async function serveReviewComments(config: unknown, input: Readable = process.stdin, output: Writable = process.stdout): Promise<void> {
  const tools = await openReviewCommentTools(config);
  let initialized = false;
  let ready = false;
  let stopped = false;
  let pending = 0;
  let queue = Promise.resolve();
  const stop = () => { if (!stopped) { stopped = true; tools.close(); input.destroy(); } };
  const send = (value: unknown) => { if (!stopped) output.write(JSON.stringify(value) + '\n'); };
  output.on('error', stop);
  const signal = () => { stop(); };
  process.once('SIGTERM', signal);
  process.once('SIGINT', signal);
  try {
    await new Promise<void>(resolve => {
      input.once('close', () => { void queue.finally(() => { stop(); resolve(); }); });
      readMcpMessages(input, message => {
        if (++pending > 32) { stop(); return; }
        queue = queue.then(async () => {
          try {
            if (stopped) return;
            if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }); return; }
            const { id, method } = message;
            if (id === undefined) { if (method === 'notifications/initialized' && initialized) ready = true; return; }
            if (typeof id !== 'string' && typeof id !== 'number') { send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request id' } }); return; }
            const reply = (result: unknown) => send({ jsonrpc: '2.0', id, result });
            const error = (code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });
            if (method === 'initialize') {
              if (initialized) { error(-32600, 'session already initialized'); return; }
              initialized = true;
              reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'faff-review-comments', version: '1.0.0' } });
            } else if (method === 'ping') reply({});
            else if (!ready) error(-32002, 'session not initialized');
            else if (method === 'tools/list') reply({ tools: REVIEW_COMMENT_TOOLS });
            else if (method === 'tools/call') {
              try {
                if (!isRecord(message.params) || typeof message.params.name !== 'string') throw new Error('invalid tool call');
                const value = await tools.call(message.params.name, message.params.arguments);
                reply({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false });
              } catch (failure) { reply({ content: [{ type: 'text', text: failure instanceof Error ? failure.message : 'review comment operation failed' }], isError: true }); }
            } else error(-32601, 'method not found');
          } finally { pending--; }
        }).catch(stop);
      }, stop);
      input.once('end', () => { void queue.finally(() => { stop(); resolve(); }); });
    });
  } finally {
    stop();
    process.removeListener('SIGTERM', signal);
    process.removeListener('SIGINT', signal);
  }
}
